/**
 * terrain.js — Procedural low-poly terrain with heightmap.
 * Generates a grid mesh with smoothed random heights, used for hill detection and agent navigation.
 */

import * as THREE from 'three';

// Terrain grid resolution and world size
const GRID = 64;    // number of vertices per side
const SIZE = 100;   // world units across (so half-size = 50)
const MAX_HEIGHT = 18;

// Flat Float32Array heightmap for fast lookup
let heightData = null;

/**
 * Generate the terrain mesh and return it along with a height-query function.
 * The mesh origin is at world center (0,0,0).
 */
export function createTerrain(scene) {
  heightData = generateHeightmap(GRID + 1, GRID + 1);

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, GRID, GRID);
  geo.rotateX(-Math.PI / 2);

  // Apply heights to vertices
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, sampleHeightWorld(x, z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Vertex coloring based on height for a natural look
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / MAX_HEIGHT; // 0..1
    const c = heightToColor(h);
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);

  return mesh;
}

/** Map normalized height (0–1) to a terrain color (rock → grass → snow). */
function heightToColor(h) {
  if (h < 0.08) return new THREE.Color(0x2a3a2a); // lowland dark
  if (h < 0.25) return new THREE.Color(0x3a5a30); // grass
  if (h < 0.55) return new THREE.Color(0x5a7a40); // upper grass
  if (h < 0.75) return new THREE.Color(0x7a6a50); // rock
  return new THREE.Color(0xc8c8c8);                // snow cap
}

/**
 * Sample terrain height at world position (wx, wz).
 * Returns 0 if out of bounds.
 */
export function sampleHeightWorld(wx, wz) {
  if (!heightData) return 0;
  // Map world coords to heightmap grid coords
  const half = SIZE / 2;
  const gx = ((wx + half) / SIZE) * GRID;
  const gz = ((wz + half) / SIZE) * GRID;

  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(x0 + 1, GRID);
  const z1 = Math.min(z0 + 1, GRID);

  const fx = gx - x0;
  const fz = gz - z0;

  // Bilinear interpolation across the quad
  const h00 = heightData[z0 * (GRID + 1) + x0];
  const h10 = heightData[z0 * (GRID + 1) + x1];
  const h01 = heightData[z1 * (GRID + 1) + x0];
  const h11 = heightData[z1 * (GRID + 1) + x1];

  return h00 * (1 - fx) * (1 - fz)
       + h10 * fx * (1 - fz)
       + h01 * (1 - fx) * fz
       + h11 * fx * fz;
}

/**
 * Sample the terrain slope (gradient magnitude) at a world position.
 * Used by Endurance scenario to drain stamina faster on steep terrain.
 */
export function sampleSlopeWorld(wx, wz) {
  const eps = 1.5;
  const dx = sampleHeightWorld(wx + eps, wz) - sampleHeightWorld(wx - eps, wz);
  const dz = sampleHeightWorld(wx, wz + eps) - sampleHeightWorld(wx, wz - eps);
  return Math.sqrt(dx * dx + dz * dz) / (2 * eps);
}

/**
 * Returns the highest terrain Y within a radius around (wx, wz).
 * Agents in the Flood scenario flee toward the point with the highest nearby ground.
 */
export function findHighGroundDirection(wx, wz, radius = 12) {
  let bestH = -Infinity;
  let bestX = wx;
  let bestZ = wz;

  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const sx = wx + Math.cos(angle) * radius;
    const sz = wz + Math.sin(angle) * radius;
    const h = sampleHeightWorld(sx, sz);
    if (h > bestH) { bestH = h; bestX = sx; bestZ = sz; }
  }

  return { x: bestX, z: bestZ, height: bestH };
}

/** Return the maximum terrain height value (used to cap water rise). */
export function getMaxTerrainHeight() {
  return MAX_HEIGHT;
}

// ── Internal: heightmap generation ───────────────────────────────────────────

function generateHeightmap(cols, rows) {
  const data = new Float32Array(cols * rows);

  // Multi-octave noise using stacked sinusoids (no external noise lib needed)
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const nx = x / GRID;
      const nz = z / GRID;
      let h = 0;
      h += fbmNoise(nx * 2.1, nz * 2.1) * 1.0;
      h += fbmNoise(nx * 4.3, nz * 4.3) * 0.5;
      h += fbmNoise(nx * 8.7, nz * 8.7) * 0.25;
      h += fbmNoise(nx * 17.0, nz * 17.0) * 0.125;
      h = (h + 1) / 2; // remap to 0..1
      // Edge fade so the terrain bowl doesn't go off-screen
      const edgeFade = edgeMask(nx, nz, 0.15);
      h *= edgeFade;
      data[z * cols + x] = h * MAX_HEIGHT;
    }
  }
  return data;
}

// Simple value noise for a heightmap — deterministic, no library needed
function fbmNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const a = hash2(ix,     iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix,     iy + 1);
  const d = hash2(ix + 1, iy + 1);

  const ux = smoothstep(fx);
  const uy = smoothstep(fy);

  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h  = (h ^ (h >>> 13)) | 0;
  h  = (Math.imul(h, 1274126177)) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
}

function smoothstep(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Smooth edge mask: returns 1 in the center, fades to 0 at the border. */
function edgeMask(nx, nz, margin) {
  const dx = Math.min(nx, 1 - nx) / margin;
  const dz = Math.min(nz, 1 - nz) / margin;
  return Math.min(1, dx) * Math.min(1, dz);
}
