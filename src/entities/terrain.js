/**
 * terrain.js — Real-world terrain using open tile sources.
 *   Elevation : AWS Terrain Tiles (Terrarium RGB, free, no API key, CORS-enabled)
 *   Satellite : ESRI World Imagery (free for development, CORS-enabled)
 *   Fallback  : procedural FBM noise if network is unavailable
 *
 * Public API is unchanged so all scenarios keep working:
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
  afghanistan:  { lat:  35.2000, lon:   69.5000, zoom: 12, name: 'Afghanistan - Hindu Kush' },
  kabul_valley: { lat:  34.5553, lon:   69.2075, zoom: 13, name: 'Afghanistan - Kabul Valley' },
  wakhan:       { lat:  37.1000, lon:   73.5000, zoom: 12, name: 'Afghanistan - Wakhan Corridor' },
};

const MESH_SIZE = 100;  // world units across (agents live in ±48 units)
const MESH_SEG  = 128;  // 128×128 quads → 129×129 vertices
const MAX_H     = 22;   // max world-space height after normalisation

let heightData = null;  // Float32Array of normalised world-Y values
let maxWorldH  = MAX_H;
let _scene     = null;
let _mesh      = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the terrain mesh and apply real satellite+elevation tiles.
 * locationKey matches a key in LOCATIONS (defaults to grand_canyon).
 * Async — awaiting it guarantees the elevation data is ready.
 * The satellite texture loads non-blocking and replaces vertex colours when done.
 */
export async function createTerrain(scene, locationKey = 'grand_canyon') {
  _scene = scene;

  // Remove previous mesh if reloading
  if (_mesh) { scene.remove(_mesh); _mesh = null; }

  const loc  = LOCATIONS[locationKey] ?? LOCATIONS.grand_canyon;
  const tile = latLonToTile(loc.lat, loc.lon, loc.zoom);

  // Update loading overlay message
  _setLoadingMsg(`Loading map: ${loc.name}…`);

  // Try real elevation; fall back to procedural
  let elevPixels = null;
  try { elevPixels = await _fetchElevationPixels(tile.z, tile.x, tile.y); }
  catch (e) { console.warn('[terrain] elevation fetch failed, using procedural:', e.message); }

  heightData = elevPixels
    ? _buildHeightmapFromTile(elevPixels, MESH_SEG + 1)
    : _buildProceduralHeightmap(MESH_SEG + 1);

  _mesh = _buildMesh(scene);

  // Satellite texture loads in background — mesh renders with vertex colours immediately
  _setLoadingMsg(`Loading satellite imagery…`);
  _loadSatelliteTexture(tile.z, tile.x, tile.y).then(tex => {
    if (tex && _mesh) {
      _mesh.material.map          = tex;
      _mesh.material.vertexColors = false;
      _mesh.material.needsUpdate  = true;
    }
  });

  return _mesh;
}

/** Sample terrain height (world Y) at world-space coordinates. */
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

/** Sample slope magnitude (used by Endurance to drain stamina). */
export function sampleSlopeWorld(wx, wz) {
  const e  = 1.5;
  const dx = sampleHeightWorld(wx + e, wz) - sampleHeightWorld(wx - e, wz);
  const dz = sampleHeightWorld(wx, wz + e) - sampleHeightWorld(wx, wz - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

/** Find the highest point within radius around (wx,wz) — used by Flood flee AI. */
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

/** Maximum Y of the terrain mesh — used by Flood to cap water level. */
export function getMaxTerrainHeight() { return maxWorldH; }

// ── Tile coordinate maths ─────────────────────────────────────────────────────

function latLonToTile(lat, lon, zoom) {
  const n   = Math.pow(2, zoom);
  const x   = Math.floor((lon + 180) / 360 * n);
  const lr  = lat * Math.PI / 180;
  const y   = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n);
  return { x, y, z: zoom };
}

// ── Elevation tile fetch (AWS Terrain Tiles, Terrarium RGB encoding) ──────────

function _fetchElevationPixels(z, x, y) {
  return new Promise((resolve, reject) => {
    const img   = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const ctx  = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, 256, 256).data);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('elevation tile 404'));
    // Terrarium tiles: R*256 + G + B/256 − 32768 = meters above sea level
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  });
}

function _terrariumToMeters(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}

/** Decode a 256-px tile's RGBA pixels into a normalised (MESH_SEG+1)² heightmap. */
function _buildHeightmapFromTile(pixels, size) {
  const raw = new Float32Array(size * size);
  let minE = Infinity, maxE = -Infinity;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const px = Math.floor((col / (size - 1)) * 255);
      const py = Math.floor((row / (size - 1)) * 255);
      const i  = (py * 256 + px) * 4;
      const e  = _terrariumToMeters(pixels[i], pixels[i+1], pixels[i+2]);
      raw[row * size + col] = e;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
    }
  }

  const range = Math.max(maxE - minE, 50); // at least 50 m range
  const scale = MAX_H / range;
  maxWorldH   = MAX_H;

  const data  = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i++) data[i] = (raw[i] - minE) * scale;
  return data;
}

// ── Satellite texture (ESRI World Imagery, free, CORS-enabled) ────────────────

function _loadSatelliteTexture(z, x, y) {
  return new Promise(resolve => {
    const loader = new THREE.TextureLoader();
    // Note: ESRI tile URL uses y/x order (row/col)
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      tex => {
        tex.colorSpace  = THREE.SRGBColorSpace;
        tex.anisotropy  = 16;
        tex.minFilter   = THREE.LinearMipmapLinearFilter;
        tex.magFilter   = THREE.LinearFilter;
        tex.generateMipmaps = true;
        resolve(tex);
      },
      undefined,
      () => {
        console.warn('[terrain] satellite texture failed, keeping vertex colours');
        resolve(null);
      }
    );
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
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness:    0.88,
    metalness:    0.04,
    envMapIntensity: 0.4,
  });

  const mesh     = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/** Map normalised height (0–1) to a realistic terrain colour gradient. */
function _heightToColor(t) {
  if (t < 0.03) return new THREE.Color(0x1e2e18); // marsh / lowland
  if (t < 0.18) return new THREE.Color(0x3a5a28); // grass
  if (t < 0.42) return new THREE.Color(0x547830); // upper grass
  if (t < 0.62) return new THREE.Color(0x8a7050); // rock
  if (t < 0.80) return new THREE.Color(0xa09080); // high rock
  return new THREE.Color(0xdcdad6);                // snow cap
}

// ── Procedural fallback (identical algorithm to old terrain.js) ───────────────

function _buildProceduralHeightmap(size) {
  const data  = new Float32Array(size * size);
  const MARGIN = 0.15;
  let maxH = 0;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const nz = z / (size - 1);
      let h = 0;
      h += _fbm(nx*2.1, nz*2.1) * 1.0;
      h += _fbm(nx*4.3, nz*4.3) * 0.5;
      h += _fbm(nx*8.7, nz*8.7) * 0.25;
      h += _fbm(nx*17,  nz*17)  * 0.125;
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
  const fx = x-ix, fy = y-iy;
  const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
  const a=_h2(ix,iy),b=_h2(ix+1,iy),c=_h2(ix,iy+1),d=_h2(ix+1,iy+1);
  return ((a*(1-ux)+b*ux)*(1-uy)+(c*(1-ux)+d*ux)*uy)*2-1;
}
function _h2(x,y){let h=(x*374761393+y*668265263)|0;h=(h^(h>>>13))|0;h=(Math.imul(h,1274126177))|0;return((h^(h>>>16))>>>0)/0xFFFFFFFF;}
function _edgeMask(nx,nz,m){return Math.min(1,Math.min(nx,1-nx)/m)*Math.min(1,Math.min(nz,1-nz)/m);}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _setLoadingMsg(msg) {
  const el = document.querySelector('#loading p');
  if (el) el.textContent = msg;
}
