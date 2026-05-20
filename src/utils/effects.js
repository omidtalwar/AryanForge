/**
 * effects.js — Visual effects pool: death particles, muzzle flash, bullet tracers.
 * Call updateEffects(dt) every frame. Call clearEffects(scene) on scenario teardown.
 */

import * as THREE from 'three';

const _effects = [];

// ── Death particle burst ───────────────────────────────────────────────────────

export function spawnDeathEffect(scene, x, y, z) {
  const COUNT = 24;
  const positions  = new Float32Array(COUNT * 3);
  const velocities = [];

  for (let i = 0; i < COUNT; i++) {
    positions[i*3]   = x;
    positions[i*3+1] = y;
    positions[i*3+2] = z;

    const ang  = Math.random() * Math.PI * 2;
    const elev = (Math.random() - 0.25) * Math.PI * 0.8;
    const spd  = 2.0 + Math.random() * 5.0;
    velocities.push({
      x: Math.cos(ang) * Math.cos(elev) * spd,
      y: Math.abs(Math.sin(elev)) * spd + 1.0,
      z: Math.sin(ang) * Math.cos(elev) * spd,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color:           0xff4400,
    size:            0.15,
    transparent:     true,
    opacity:         1.0,
    sizeAttenuation: true,
    depthWrite:      false,
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  _effects.push({ type: 'death', pts, velocities, positions, age: 0, maxAge: 1.2, scene });
}

// ── Muzzle flash ──────────────────────────────────────────────────────────────

export function spawnMuzzleFlash(scene, x, y, z) {
  const geo   = new THREE.SphereGeometry(0.09, 6, 5);
  const mat   = new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, depthWrite: false });
  const mesh  = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);

  const light = new THREE.PointLight(0xffcc44, 5.0, 9);
  light.position.set(x, y, z);

  scene.add(mesh, light);
  _effects.push({ type: 'flash', mesh, light, age: 0, maxAge: 0.09, scene });
}

// ── Bullet tracer ─────────────────────────────────────────────────────────────

export function spawnBulletTracer(scene, x1, y1, z1, x2, y2, z2) {
  const geo  = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1, y1, z1),
    new THREE.Vector3(x2, y2, z2),
  ]);
  const mat  = new THREE.LineBasicMaterial({ color: 0xffff88, transparent: true, opacity: 1.0, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  _effects.push({ type: 'tracer', line, age: 0, maxAge: 0.18, scene });
}

// ── Per-frame update ──────────────────────────────────────────────────────────

export function updateEffects(dt) {
  for (let i = _effects.length - 1; i >= 0; i--) {
    const ef = _effects[i];
    ef.age  += dt;
    const t  = Math.min(1, ef.age / ef.maxAge);

    if (ef.type === 'death') {
      for (let p = 0; p < ef.velocities.length; p++) {
        const v = ef.velocities[p];
        v.y -= 12 * dt;
        ef.positions[p*3]   += v.x * dt;
        ef.positions[p*3+1] += v.y * dt;
        ef.positions[p*3+2] += v.z * dt;
      }
      ef.pts.geometry.attributes.position.needsUpdate = true;
      ef.pts.material.opacity = 1.0 - t;
      ef.pts.material.color.setHSL(0.06 - t * 0.05, 0.9, 0.55 - t * 0.2);

    } else if (ef.type === 'flash') {
      ef.mesh.material.opacity = 1.0 - t;
      ef.light.intensity       = 5.0 * (1.0 - t);
      ef.mesh.scale.setScalar(1 + t * 1.8);

    } else if (ef.type === 'tracer') {
      ef.line.material.opacity = 1.0 - t;
    }

    if (ef.age >= ef.maxAge) {
      if (ef.pts)   { ef.scene.remove(ef.pts);  ef.pts.geometry.dispose();  ef.pts.material.dispose(); }
      if (ef.mesh)  { ef.scene.remove(ef.mesh); ef.mesh.geometry.dispose(); ef.mesh.material.dispose(); }
      if (ef.light) { ef.scene.remove(ef.light); }
      if (ef.line)  { ef.scene.remove(ef.line); ef.line.geometry.dispose(); ef.line.material.dispose(); }
      _effects.splice(i, 1);
    }
  }
}

export function clearEffects(scene) {
  for (const ef of _effects) {
    if (ef.pts)   { scene.remove(ef.pts);  ef.pts.geometry.dispose();  ef.pts.material.dispose(); }
    if (ef.mesh)  { scene.remove(ef.mesh); ef.mesh.geometry.dispose(); ef.mesh.material.dispose(); }
    if (ef.light) { scene.remove(ef.light); }
    if (ef.line)  { scene.remove(ef.line); ef.line.geometry.dispose(); ef.line.material.dispose(); }
  }
  _effects.length = 0;
}
