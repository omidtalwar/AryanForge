/**
 * terrain.js — Real-world terrain using open tile sources.
 *   Elevation : AWS Terrain Tiles (Terrarium RGB, free, no API key, CORS-enabled)
 *               Fetches a 3×3 tile grid for broad, high-detail coverage.
 *   Satellite : ESRI World Imagery (free for development, CORS-enabled)
 *               Uses a 2×2 tile grid stitched on a canvas for higher texture res.
 *   Fallback  : procedural FBM noise if network is unavailable
 *
 * Public API (unchanged):
 *   createTerrain(scene, locationKey?)  → Promise<Mesh>
 *   sampleHeightWorld(wx, wz)           → float
 *   sampleSlopeWorld(wx, wz)            → float
 *   findHighGroundDirection(wx, wz)     → { x, z, height }
 *   getMaxTerrainHeight()               → float
 */

import * as THREE from 'three';

// ── Location presets ──────────────────────────────────────────────────────────
export const LOCATIONS = {
  grand_canyon: { lat:  36.1069, lon: -112.1129, zoom: 13, name: 'Grand Canyon, USA' },
  everest:      { lat:  27.9881, lon:   86.9250, zoom: 13, name: 'Mount Everest' },
  swiss_alps:   { lat:  46.5197, lon:    7.9342, zoom: 13, name: 'Swiss Alps' },
  fuji:         { lat:  35.3606, lon:  138.7274, zoom: 13, name: 'Mount Fuji, Japan' },
  death_valley: { lat:  36.2397, lon: -116.8174, zoom: 13, name: 'Death Valley, USA' },
  iceland:      { lat:  64.1265, lon:  -21.8174, zoom: 13, name: 'Iceland Highlands' },
  dolomites:    { lat:  46.4102, lon:   11.8440, zoom: 13, name: 'Dolomites, Italy' },
  patagonia:    { lat: -41.1335, lon:  -71.3103, zoom: 13, name: 'Patagonia, Argentina' },
  afghanistan:  { lat:  35.2000, lon:   69.5000, zoom: 13, name: 'Afghanistan - Hindu Kush' },
  kabul_valley: { lat:  34.5553, lon:   69.2075, zoom: 13, name: 'Afghanistan - Kabul Valley' },
  wakhan:       { lat:  37.1000, lon:   73.5000, zoom: 13, name: 'Afghanistan - Wakhan Corridor' },
};

const MESH_SIZE = 100;  // world units across (agents live in ±48 units)
const MESH_SEG  = 200;  // 200×200 quads → 201×201 vertices (4× the old 128)
const MAX_H     = 22;   // max world-space height after normalisation

// Tile fetch configuration: we stitch a NxN grid of elevation tiles
const ELEV_GRID = 3;    // 3×3 grid = 9 tiles → much broader coverage
const SAT_GRID  = 2;    // 2×2 satellite tiles → 512×512 stitched texture

let heightData = null;  // Float32Array of normalised world-Y values
let maxWorldH  = MAX_H;
let _scene     = null;
let _mesh      = null;

// ── Public API ────────────────────────────────────────────────────────────────

export async function createTerrain(scene, locationKey = 'grand_canyon') {
  _scene = scene;

  if (_mesh) { scene.remove(_mesh); _mesh = null; }

  const loc  = LOCATIONS[locationKey] ?? LOCATIONS.grand_canyon;
  const tile = latLonToTile(loc.lat, loc.lon, loc.zoom);

  _setLoadingMsg(`Loading map: ${loc.name}…`);

  let elevPixels = null;
  try {
    elevPixels = await _fetchElevationGrid(tile.z, tile.x, tile.y, ELEV_GRID);
  } catch (e) {
    console.warn('[terrain] elevation fetch failed, using procedural:', e.message);
  }

  heightData = elevPixels
    ? _buildHeightmapFromGrid(elevPixels, ELEV_GRID * 256, MESH_SEG + 1)
    : _buildProceduralHeightmap(MESH_SEG + 1);

  _mesh = _buildMesh(scene);

  // Satellite texture loads non-blocking
  _setLoadingMsg('Loading satellite imagery…');
  _loadSatelliteGrid(tile.z, tile.x, tile.y, SAT_GRID).then(tex => {
    if (tex && _mesh) {
      _mesh.material.map          = tex;
      _mesh.material.vertexColors = false;
      _mesh.material.needsUpdate  = true;
    }
  });

  return _mesh;
}

export function sampleHeightWorld(wx, wz) {
  if (!heightData) return 0;
  const half = MESH_SIZE / 2;
  const gx = ((wx + half) / MESH_SIZE) * MESH_SEG;
  const gz = ((wz + half) / MESH_SIZE) * MESH_SEG;
  const x0 = Math.max(0, Math.min(MESH_SEG - 1, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(MESH_SEG - 1, Math.floor(gz)));
  const x1 = Math.min(MESH_SEG, x0 + 1);
  const z1 = Math.min(MESH_SEG, z0 + 1);
  const fx = gx - x0, fz = gz - z0;
  const s  = MESH_SEG + 1;
  const h00 = heightData[z0 * s + x0];
  const h10 = heightData[z0 * s + x1];
  const h01 = heightData[z1 * s + x0];
  const h11 = heightData[z1 * s + x1];
  return h00*(1-fx)*(1-fz) + h10*fx*(1-fz) + h01*(1-fx)*fz + h11*fx*fz;
}

export function sampleSlopeWorld(wx, wz) {
  const e  = 1.5;
  const dx = sampleHeightWorld(wx + e, wz) - sampleHeightWorld(wx - e, wz);
  const dz = sampleHeightWorld(wx, wz + e) - sampleHeightWorld(wx, wz - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

export function findHighGroundDirection(wx, wz, radius = 12) {
  let bestH = -Infinity, bestX = wx, bestZ = wz;
  for (let i = 0; i < 12; i++) {
    const a  = (i / 12) * Math.PI * 2;
    const sx = wx + Math.cos(a) * radius;
    const sz = wz + Math.sin(a) * radius;
    const h  = sampleHeightWorld(sx, sz);
    if (h > bestH) { bestH = h; bestX = sx; bestZ = sz; }
  }
  return { x: bestX, z: bestZ, height: bestH };
}

export function getMaxTerrainHeight() { return maxWorldH; }

// ── Tile coordinate maths ─────────────────────────────────────────────────────

function latLonToTile(lat, lon, zoom) {
  const n   = Math.pow(2, zoom);
  const x   = Math.floor((lon + 180) / 360 * n);
  const lr  = lat * Math.PI / 180;
  const y   = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n);
  return { x, y, z: zoom };
}

// ── Elevation: fetch NxN tile grid and stitch into one large pixel array ──────

async function _fetchElevationGrid(z, cx, cy, n) {
  const half    = Math.floor(n / 2);
  const tileSize = 256;
  const gridPx  = n * tileSize;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = gridPx;
  const ctx = canvas.getContext('2d');

  const fetches = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const tx = cx + (col - half);
      const ty = cy + (row - half);
      fetches.push(
        _fetchElevationTile(z, tx, ty).then(imgData => ({ row, col, imgData }))
      );
    }
  }

  const results = await Promise.allSettled(fetches);

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.imgData) continue;
    const { row, col, imgData } = r.value;
    // Draw onto the stitched canvas via ImageData
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileCanvas.height = tileSize;
    const tileCtx = tileCanvas.getContext('2d');
    tileCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(tileCanvas, col * tileSize, row * tileSize);
  }

  return ctx.getImageData(0, 0, gridPx, gridPx).data;
}

function _fetchElevationTile(z, x, y) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.getContext('2d').getImageData(0, 0, 256, 256));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  });
}

function _terrariumToMeters(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}

function _buildHeightmapFromGrid(pixels, srcSize, dstSize) {
  const raw = new Float32Array(dstSize * dstSize);
  let minE = Infinity, maxE = -Infinity;

  for (let row = 0; row < dstSize; row++) {
    for (let col = 0; col < dstSize; col++) {
      const px = Math.floor((col / (dstSize - 1)) * (srcSize - 1));
      const py = Math.floor((row / (dstSize - 1)) * (srcSize - 1));
      const i  = (py * srcSize + px) * 4;
      const e  = _terrariumToMeters(pixels[i], pixels[i + 1], pixels[i + 2]);
      raw[row * dstSize + col] = e;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
    }
  }

  const range = Math.max(maxE - minE, 50);
  const scale = MAX_H / range;
  maxWorldH   = MAX_H;

  const data = new Float32Array(dstSize * dstSize);
  for (let i = 0; i < raw.length; i++) data[i] = (raw[i] - minE) * scale;
  return data;
}

// ── Satellite: stitch NxN tiles onto a single canvas → THREE.Texture ─────────

function _loadSatelliteGrid(z, cx, cy, n) {
  return new Promise(resolve => {
    const half    = Math.floor(n / 2);
    const tileSize = 256;
    const gridPx  = n * tileSize;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = gridPx;
    const ctx = canvas.getContext('2d');

    let loaded = 0;
    const total = n * n;

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const tx  = cx + (col - half);
        const ty  = cy + (row - half);
        const img = new Image();
        img.crossOrigin = 'anonymous';

        const onDone = () => {
          loaded++;
          if (loaded === total) {
            if (canvas.width === 0) { resolve(null); return; }
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace       = THREE.SRGBColorSpace;
            tex.anisotropy       = 16;
            tex.minFilter        = THREE.LinearMipmapLinearFilter;
            tex.magFilter        = THREE.LinearFilter;
            tex.generateMipmaps  = true;
            tex.needsUpdate      = true;
            resolve(tex);
          }
        };

        img.onload = () => {
          try { ctx.drawImage(img, col * tileSize, row * tileSize); } catch {}
          onDone();
        };
        img.onerror = onDone;  // keep counting even on failure
        // ESRI tile URL: z / y / x  (row then column)
        img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
      }
    }
  });
}

// ── Mesh construction ─────────────────────────────────────────────────────────

function _buildMesh(scene) {
  const geo = new THREE.PlaneGeometry(MESH_SIZE, MESH_SIZE, MESH_SEG, MESH_SEG);
  geo.rotateX(-Math.PI / 2);

  const pos    = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const h = heightData[i] ?? 0;
    pos.setY(i, h);
    const c = _heightToColor(h / maxWorldH);
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors:    true,
    roughness:       0.88,
    metalness:       0.04,
    envMapIntensity: 0.4,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/** Smooth height-to-colour gradient that mimics realistic satellite tones. */
function _heightToColor(t) {
  // Lerp between colour stops for smooth gradients (no sharp bands)
  const stops = [
    { t: 0.00, r: 0.09, g: 0.16, b: 0.07 },  // deep lowland / marsh
    { t: 0.08, r: 0.18, g: 0.30, b: 0.12 },  // lowland grass
    { t: 0.22, r: 0.26, g: 0.40, b: 0.16 },  // mid grass
    { t: 0.42, r: 0.32, g: 0.46, b: 0.18 },  // upper grass / scrub
    { t: 0.58, r: 0.52, g: 0.43, b: 0.29 },  // rocky brown
    { t: 0.74, r: 0.62, g: 0.57, b: 0.50 },  // grey rock
    { t: 0.88, r: 0.78, g: 0.75, b: 0.72 },  // light rock / scree
    { t: 1.00, r: 0.88, g: 0.87, b: 0.86 },  // snow / ice
  ];

  t = Math.max(0, Math.min(1, t));

  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      lo = stops[i]; hi = stops[i + 1]; break;
    }
  }

  const f = lo.t === hi.t ? 0 : (t - lo.t) / (hi.t - lo.t);
  return new THREE.Color(
    lo.r + (hi.r - lo.r) * f,
    lo.g + (hi.g - lo.g) * f,
    lo.b + (hi.b - lo.b) * f,
  );
}

// ── Procedural fallback ───────────────────────────────────────────────────────

function _buildProceduralHeightmap(size) {
  const data   = new Float32Array(size * size);
  const MARGIN = 0.15;
  let maxH = 0;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const nz = z / (size - 1);
      let h = 0;
      h += _fbm(nx * 2.1, nz * 2.1) * 1.00;
      h += _fbm(nx * 4.3, nz * 4.3) * 0.50;
      h += _fbm(nx * 8.7, nz * 8.7) * 0.25;
      h += _fbm(nx * 17,  nz * 17)  * 0.125;
      h  = (h + 1) / 2;
      h *= _edgeMask(nx, nz, MARGIN);
      const wh = h * MAX_H;
      data[z * size + x] = wh;
      if (wh > maxH) maxH = wh;
    }
  }
  maxWorldH = maxH;
  return data;
}

function _fbm(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = _h2(ix,   iy),   b = _h2(ix+1, iy);
  const c = _h2(ix,   iy+1), d = _h2(ix+1, iy+1);
  return ((a*(1-ux)+b*ux)*(1-uy)+(c*(1-ux)+d*ux)*uy)*2-1;
}
function _h2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
}
function _edgeMask(nx, nz, m) {
  return Math.min(1, Math.min(nx, 1 - nx) / m) * Math.min(1, Math.min(nz, 1 - nz) / m);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _setLoadingMsg(msg) {
  const el = document.querySelector('#loading p');
  if (el) el.textContent = msg;
}
