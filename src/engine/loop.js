/**
 * loop.js — Main animation loop with fixed-timestep physics and variable render.
 * Physics runs at 60Hz regardless of frame rate; rendering runs as fast as possible.
 */

import { stepPhysics } from './physics.js';
import { getTimeScale } from '../utils/timeScale.js';

const FIXED_DT = 1 / 60; // 60Hz physics tick

let running = false;
let paused = false;
let lastTime = 0;
let accumulator = 0;
let simTime = 0; // total simulation seconds elapsed
let frameCount = 0;
let fpsTimer = 0;
let currentFPS = 0;

let updateCallback = null; // called each physics tick with (dt, simTime)
let renderCallback = null; // called each frame for Three.js render

/** Start the animation loop. updateFn(dt, simTime) and renderFn() are user-supplied. */
export function startLoop(updateFn, renderFn) {
  updateCallback = updateFn;
  renderCallback = renderFn;
  running = true;
  paused = false;
  lastTime = performance.now();
  accumulator = 0;
  requestAnimationFrame(tick);
}

/** Stop the loop entirely (on reset). */
export function stopLoop() {
  running = false;
  simTime = 0;
  accumulator = 0;
}

export function pauseLoop() { paused = true; }
export function resumeLoop() { paused = false; lastTime = performance.now(); }
export function togglePause() { paused ? resumeLoop() : pauseLoop(); }
export function isPaused() { return paused; }
export function getSimTime() { return simTime; }
export function getFPS() { return currentFPS; }

function tick(now) {
  if (!running) return;
  requestAnimationFrame(tick);

  // FPS counter
  frameCount++;
  fpsTimer += now - lastTime;
  if (fpsTimer >= 500) {
    currentFPS = Math.round((frameCount / fpsTimer) * 1000);
    frameCount = 0;
    fpsTimer = 0;
  }

  if (!paused) {
    const rawDelta = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms to prevent spiral
    const scaledDelta = rawDelta * getTimeScale();
    accumulator += scaledDelta;

    // Fixed-step physics: step as many times as needed
    while (accumulator >= FIXED_DT) {
      stepPhysics();
      if (updateCallback) updateCallback(FIXED_DT, simTime);
      simTime += FIXED_DT;
      accumulator -= FIXED_DT;
    }
  }

  lastTime = now;
  if (renderCallback) renderCallback();
}
