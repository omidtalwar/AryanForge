/**
 * main.js — Entry point. Initializes scene, physics, terrain, UI, and the main loop.
 * Orchestrates scenario lifecycle: run, update, reset.
 */

import { initScene }         from './engine/scene.js';
import { initPhysics, createGroundCollider } from './engine/physics.js';
import { startLoop, togglePause, getSimTime, getFPS } from './engine/loop.js';
import { createTerrain }     from './entities/terrain.js';
import { getScenario }       from './scenarios/index.js';
import { initControlPanel, readLocation } from './ui/controlPanel.js';
import { updateStats, hideSummary } from './ui/stats.js';
import { toggleTimeScale, isTimelapse } from './utils/timeScale.js';
import { resumeAudio } from './utils/sound.js';
import { updateEffects, clearEffects } from './utils/effects.js';
import { initRenderer, updateRenderer, resetRenderer } from './entities/agentRenderer.js';
import { agents } from './entities/agent.js';

let sceneCtx       = null;
let activeScenario = null;
let activeKey      = null;

async function bootstrap() {
  // ── Scene ──────────────────────────────────────────────────────────────────
  sceneCtx = initScene();
  const { renderer, scene, camera, controls } = sceneCtx;

  // ── Physics ────────────────────────────────────────────────────────────────
  await initPhysics();
  createGroundCollider();

  // ── Real-world terrain (async tile fetch) ──────────────────────────────────
  await createTerrain(scene, readLocation());

  // ── Instanced agent renderer (supports 1000+ agents) ─────────────────────
  initRenderer(scene, 1200);

  // ── UI ─────────────────────────────────────────────────────────────────────
  initControlPanel(handleRun, handleReset, handleLoadMap);

  document.getElementById('time-scale-toggle').addEventListener('click', () => {
    const scale = toggleTimeScale();
    const btn = document.getElementById('time-scale-toggle');
    btn.textContent = isTimelapse() ? `TIME-LAPSE (${scale}x)` : `REAL-TIME (1x)`;
  });

  // Unblock AudioContext on first user gesture
  document.addEventListener('click', resumeAudio, { once: true });
  document.addEventListener('keydown', resumeAudio, { once: true });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'KeyR')  { handleReset(); }
  });

  // ── Main loop ─────────────────────────────────────────────────────────────
  startLoop(
    (dt, simTime) => { if (activeScenario) activeScenario.update(dt, simTime); updateEffects(dt); },
    () => {
      controls.update();
      updateRenderer(agents);
      const counts = activeScenario?.getCounts() ?? { alive: 0, dead: 0 };
      updateStats({ alive: counts.alive, dead: counts.dead, simTime: getSimTime(), fps: getFPS() });
      renderer.render(scene, camera);
    }
  );

  document.getElementById('loading').style.display = 'none';
}

function handleRun(key, params) {
  const scenario = getScenario(key);
  if (!scenario) return;
  if (activeScenario) activeScenario.teardown(sceneCtx.scene);
  hideSummary();
  activeKey      = key;
  activeScenario = scenario;
  activeScenario.init(sceneCtx.scene, params);
}

function handleReset() {
  if (activeScenario) {
    activeScenario.teardown(sceneCtx.scene);
    activeScenario = null;
    activeKey      = null;
  }
  clearEffects(sceneCtx.scene);
  resetRenderer();
  hideSummary();
}

/** Reload terrain from the currently selected location, reset any active scenario. */
async function handleLoadMap() {
  handleReset();
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'flex';
  await createTerrain(sceneCtx.scene, readLocation());
  if (loadingEl) loadingEl.style.display = 'none';
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err);
  const p = document.querySelector('#loading p');
  if (p) p.textContent = 'Error: ' + err.message;
});
