/**
 * flood.js — Rising water scenario.
 * Water is a multi-segment mesh with animated vertex-wave displacement.
 * Agents flee to high ground; submersion for 2+ sec = drown.
 */

import * as THREE from 'three';
import { createAgent, clearAgents, agents, STATE } from '../entities/agent.js';
import { sampleHeightWorld, getMaxTerrainHeight } from '../entities/terrain.js';
import { showSummary } from '../ui/stats.js';
import { startWaterAmbient, stopAmbient, playVictory } from '../utils/sound.js';

const WATER_SEGS = 48; // enough verts for smooth wave animation

let waterMesh  = null;
let waterY     = 0;
let targetWaterY = 0;
let riseSpeed  = 0;
let started    = false;
let done       = false;
let drownTimer = 0;
let waveTime   = 0;

// ── Water plane ───────────────────────────────────────────────────────────────

function createWaterPlane(scene) {
  const geo = new THREE.PlaneGeometry(220, 220, WATER_SEGS, WATER_SEGS);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshPhongMaterial({
    color:      new THREE.Color(0x0055aa),
    emissive:   new THREE.Color(0x001133),
    transparent: true,
    opacity:    0.72,
    shininess:  180,
    specular:   new THREE.Color(0x88ccff),
    side:       THREE.FrontSide,
    depthWrite: false,
  });

  waterMesh = new THREE.Mesh(geo, mat);
  waterMesh.position.y = -20;
  scene.add(waterMesh);
}

/** Displace water vertices using overlapping sine waves and recompute normals. */
function animateWater(dt) {
  if (!waterMesh) return;
  waveTime += dt;
  const pos = waterMesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const wave =
      Math.sin(x * 0.14 + waveTime * 1.8) * 0.10 +
      Math.sin(z * 0.11 + waveTime * 1.4) * 0.08 +
      Math.sin((x + z) * 0.07 + waveTime * 2.2) * 0.05 +
      Math.sin((x - z) * 0.09 + waveTime * 1.1) * 0.04;
    pos.setY(i, wave);
  }
  pos.needsUpdate = true;
  waterMesh.geometry.computeVertexNormals();

  // Subtle colour pulse to simulate depth variation
  const t = waveTime * 0.3;
  waterMesh.material.color.setHSL(0.59, 0.85, 0.28 + Math.sin(t) * 0.03);
  waterMesh.material.emissive.setHSL(0.62, 0.9, 0.04 + Math.sin(t * 1.3) * 0.015);
}

// ── Scenario API ──────────────────────────────────────────────────────────────

export const flood = {
  init(scene, params) {
    waterY = -20; done = false; started = false; waveTime = 0;

    const { agentCount = 100, risePercent = 80, speed = 0.8 } = params;
    targetWaterY = (risePercent / 100) * getMaxTerrainHeight();
    riseSpeed    = speed;

    createWaterPlane(scene);

    for (let i = 0; i < agentCount; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const a = createAgent(scene, x, z, 'white', 4 + Math.random() * 3);
      a.state = STATE.FLEE;
    }

    started = true;
    startWaterAmbient();
  },

  update(dt, simTime) {
    if (!started || done) return;

    // Rise
    if (waterY < targetWaterY) {
      waterY = Math.min(waterY + riseSpeed * dt, targetWaterY);
      if (waterMesh) waterMesh.position.y = waterY;
    }

    animateWater(dt);

    // Agent update
    for (const a of agents) a.update(dt, { waterY, allAgents: agents });

    // Drown check (every 0.25 sim-sec)
    drownTimer += dt;
    if (drownTimer >= 0.25) {
      drownTimer = 0;
      for (const a of agents) {
        if (!a.alive) continue;
        if (a.y <= waterY + 0.5) {
          a.underWaterTime += 0.25;
          if (a.underWaterTime >= 2) a.die();
        } else {
          a.underWaterTime = 0;
        }
      }
    }

    // End conditions
    const alive = agents.filter(a => a.alive).length;
    const total = agents.length;
    if (!done && alive === 0) {
      done = true; stopAmbient();
      showSummary({ result: 'All agents drowned', survivalPct: 0, simTime });
    } else if (!done && waterY >= targetWaterY) {
      done = true; stopAmbient(); playVictory();
      showSummary({
        result: `${alive} survived the flood!`,
        survivalPct: Math.round((alive / total) * 100),
        simTime,
      });
    }
  },

  teardown(scene) {
    if (waterMesh) { scene.remove(waterMesh); waterMesh = null; }
    clearAgents(scene);
    stopAmbient();
    waterY = 0; started = false; done = false;
  },

  getCounts() {
    const alive = agents.filter(a => a.alive).length;
    return { alive, dead: agents.length - alive };
  },
};
