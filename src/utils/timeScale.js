/**
 * timeScale.js — Toggle between real-time (1x) and time-lapse (1 sim-hour = 1 real second = 3600x).
 */

let scale = 1;
const TIMELAPSE = 3600; // 1 sim-hour per real second

export function getTimeScale() { return scale; }

export function setTimeScale(s) { scale = s; }

export function toggleTimeScale() {
  scale = scale === 1 ? TIMELAPSE : 1;
  return scale;
}

export function isTimelapse() { return scale !== 1; }
