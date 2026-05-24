/**
 * loop.js — Main animation loop.
 * Agent simulation updates ONCE per render frame at variable dt (no accumulator spiral).
 * Rapier physics still steps at fixed 60 Hz but is decoupled from agent logic.
 */

import { stepPhysics } from './physics.js';
import { getTimeScale } from '../utils/timeScale.js';

const FIXED_DT = 1 / 60;

let running  = false;
let paused   = false;
let lastTime = 0;
let physAccum = 0;
let simTime   = 0;
let frameCount = 0;
let fpsTimer   = 0;
let currentFPS = 0;

let updateCallback = null;
let renderCallback = null;

export function startLoop(updateFn, renderFn) {
  updateCallback = updateFn;
  renderCallback = renderFn;
  running   = true;
  paused    = false;
  lastTime  = performance.now();
  physAccum = 0;
  requestAnimationFrame(tick);
}

export function stopLoop()   { running = false; simTime = 0; physAccum = 0; }
export function pauseLoop()  { paused = true; }
export function resumeLoop() { paused = false; lastTime = performance.now(); }
export function togglePause(){ paused ? resumeLoop() : pauseLoop(); }
export function isPaused()   { return paused; }
export function getSimTime() { return simTime; }
export function getFPS()     { return currentFPS; }

function tick(now) {
  if (!running) return;
  requestAnimationFrame(tick);

  // FPS counter
  frameCount++;
  fpsTimer += now - lastTime;
  if (fpsTimer >= 500) {
    currentFPS = Math.round((frameCount / fpsTimer) * 1000);
    frameCount = 0;
    fpsTimer   = 0;
  }

  if (!paused) {
    // Real elapsed time, capped to avoid giant dt spikes on tab-switch
    const rawDt     = Math.min((now - lastTime) / 1000, 0.05);
    const scaledDt  = rawDt * getTimeScale();

    // Rapier physics: step at most ONCE per frame (no accumulator spiral).
    // Agent bodies have been removed so this is nearly free; kept for ground plane.
    physAccum += rawDt;
    if (physAccum >= FIXED_DT) {
      stepPhysics();
      physAccum -= FIXED_DT;
    }

    // Agent simulation: one call per render frame.
    // Using scaledDt means time-lapse simply gives agents a larger dt — correct behaviour.
    if (updateCallback) updateCallback(scaledDt, simTime);
    simTime += scaledDt;
  }

  lastTime = now;
  if (renderCallback) renderCallback();
}
