/**
 * flood.js — Rising water scenario.
 * A translucent blue plane rises over time; agents flee to high ground.
 * Agents that remain submerged for 2+ seconds drown.
 */

import * as THREE from 'three';
import { createAgent, clearAgents, agents, STATE } from '../entities/agent.js';
import { sampleHeightWorld, getMaxTerrainHeight } from '../entities/terrain.js';
import { showSummary } from '../ui/stats.js';
import { startWaterAmbient, stopAmbient, playVictory } from '../utils/sound.js';

let waterMesh = null;
let waterY = 0;        // current water surface Y
let targetWaterY = 0;  // final water surface Y (scenario end)
let riseSpeed = 0;     // units/sec at 1x timescale
let started = false;
let done = false;
let drownCheckTimer = 0;

/** Build the water plane mesh. Called once on scenario init. */
function createWaterPlane(scene) {
  const geo = new THREE.PlaneGeometry(200, 200, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshPhongMaterial({
    color: 0x1a4aff,
    transparent: true,
    opacity: 0.52,
    shininess: 120,
    specular: new THREE.Color(0x88aaff),
    side: THREE.FrontSide,
  });

  waterMesh = new THREE.Mesh(geo, mat);
  waterMesh.position.y = -20; // start below terrain
  scene.add(waterMesh);
}

// ── Public scenario API ───────────────────────────────────────────────────────

export const flood = {
  /** Spawn agents and initialize water. */
  init(scene, params) {
    waterY = -20;
    done = false;
    started = false;

    const { agentCount = 100, risePercent = 80, speed = 0.8 } = params;
    const maxH = getMaxTerrainHeight();
    targetWaterY = (risePercent / 100) * maxH;
    riseSpeed = speed;

    createWaterPlane(scene);

    // Spawn agents randomly across the terrain
    for (let i = 0; i < agentCount; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const a = createAgent(scene, x, z, 'white', 4 + Math.random() * 3);
      a.state = STATE.FLEE;
    }

    started = true;
    startWaterAmbient();
  },

  /** Called every physics tick. dt is scaled sim-seconds. */
  update(dt, _simTime) {
    if (!started || done) return;

    // Rise water
    if (waterY < targetWaterY) {
      waterY = Math.min(waterY + riseSpeed * dt, targetWaterY);
      if (waterMesh) waterMesh.position.y = waterY;

      // Gentle wave animation on the water plane
      if (waterMesh) {
        waterMesh.rotation.x = -Math.PI / 2 + Math.sin(Date.now() * 0.0005) * 0.015;
      }
    }

    // Update agents with water level hint
    const hints = { waterY, allAgents: agents };
    for (const a of agents) {
      a.update(dt, hints);
    }

    // Drown check every 0.25 sim-sec (not every tick for perf)
    drownCheckTimer += dt;
    if (drownCheckTimer >= 0.25) {
      drownCheckTimer = 0;
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

    // End condition: all agents dead or water peaked and survivors remain
    const alive = agents.filter(a => a.alive).length;
    const total = agents.length;
    const waterDone = waterY >= targetWaterY;

    if (!done && alive === 0) {
      done = true;
      stopAmbient();
      showSummary({ result: 'All agents drowned', survivalPct: 0, simTime: _simTime });
    } else if (!done && waterDone) {
      done = true;
      stopAmbient();
      playVictory();
      showSummary({
        result: `${alive} survived the flood!`,
        survivalPct: Math.round((alive / total) * 100),
        simTime: _simTime,
      });
    }
  },

  /** Remove water plane and all agents. */
  teardown(scene) {
    if (waterMesh) { scene.remove(waterMesh); waterMesh = null; }
    clearAgents(scene);
    stopAmbient();
    waterY = 0;
    started = false;
    done = false;
  },

  /** Live agent counts for the stats panel. */
  getCounts() {
    const alive = agents.filter(a => a.alive).length;
    return { alive, dead: agents.length - alive };
  },
};
