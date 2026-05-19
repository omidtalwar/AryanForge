/**
 * main.js — Entry point. Initializes scene, physics, terrain, UI, and the main loop.
 * Orchestrates scenario lifecycle: run, update, reset.
 */

import { initScene }         from './engine/scene.js';
import { initPhysics, createGroundCollider } from './engine/physics.js';
import { startLoop, stopLoop, togglePause, getSimTime, getFPS, isPaused } from './engine/loop.js';
import { createTerrain }     from './entities/terrain.js';
import { getScenario }       from './scenarios/index.js';
import { initControlPanel }  from './ui/controlPanel.js';
import { updateStats, hideSummary } from './ui/stats.js';
import { toggleTimeScale, getTimeScale, isTimelapse } from './utils/timeScale.js';
import { resumeAudio } from './utils/sound.js';

let sceneCtx   = null;   // { renderer, scene, camera, controls }
let activeScenario = null;
let activeKey  = null;
let isRunning  = false;

async function bootstrap() {
  // ── Initialize Three.js scene ─────────────────────────────────────────────
  sceneCtx = initScene();
  const { renderer, scene, camera, controls } = sceneCtx;

  // ── Initialize Rapier physics ─────────────────────────────────────────────
  await initPhysics();
  createGroundCollider();

  // ── Generate terrain ──────────────────────────────────────────────────────
  createTerrain(scene);

  // ── UI wiring ─────────────────────────────────────────────────────────────
  initControlPanel(handleRun, handleReset);

  document.getElementById('time-scale-toggle').addEventListener('click', () => {
    const scale = toggleTimeScale();
    const btn = document.getElementById('time-scale-toggle');
    btn.textContent = isTimelapse()
      ? `TIME-LAPSE (${scale}x)`
      : `REAL-TIME (1x)`;
  });

  // Unblock AudioContext on first user gesture (browser autoplay policy)
  document.addEventListener('click', resumeAudio, { once: true });
  document.addEventListener('keydown', resumeAudio, { once: true });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'KeyR')  { handleReset(); }
  });

  // ── Main loop: update + render ────────────────────────────────────────────
  startLoop(
    // Physics update tick
    (dt, simTime) => {
      if (activeScenario) activeScenario.update(dt, simTime);
    },
    // Render frame
    () => {
      controls.update();

      // Update stats every frame
      const counts = activeScenario?.getCounts() ?? { alive: 0, dead: 0 };
      updateStats({
        alive:   counts.alive,
        dead:    counts.dead,
        simTime: getSimTime(),
        fps:     getFPS(),
      });

      renderer.render(scene, camera);
    }
  );

  // ── Hide loading overlay ──────────────────────────────────────────────────
  document.getElementById('loading').style.display = 'none';
}

/** Start or restart the selected scenario with current params. */
function handleRun(key, params) {
  const scenario = getScenario(key);
  if (!scenario) return;

  // Teardown any currently running scenario
  if (activeScenario) {
    activeScenario.teardown(sceneCtx.scene);
  }

  hideSummary();
  activeKey = key;
  activeScenario = scenario;
  activeScenario.init(sceneCtx.scene, params);
  isRunning = true;
}

/** Reset: teardown scenario, clear summary. */
function handleReset() {
  if (activeScenario) {
    activeScenario.teardown(sceneCtx.scene);
    activeScenario = null;
    activeKey = null;
  }
  hideSummary();
  isRunning = false;
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err);
  const loading = document.getElementById('loading');
  if (loading) loading.querySelector('p').textContent = 'Error: ' + err.message;
});
