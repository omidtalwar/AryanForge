/**
 * stats.js — Live stats panel updates and end-of-scenario summary card.
 */

const elAlive    = document.getElementById('stat-alive');
const elDead     = document.getElementById('stat-dead');
const elTime     = document.getElementById('stat-time');
const elFps      = document.getElementById('stat-fps');
const summaryCard = document.getElementById('summary-card');
const sumResult   = document.getElementById('sum-result');
const sumSurvival = document.getElementById('sum-survival');
const sumDuration = document.getElementById('sum-duration');

/** Update the live stat counters. simTime is in sim-seconds. */
export function updateStats({ alive, dead, simTime, fps }) {
  if (elAlive) elAlive.textContent = alive;
  if (elDead)  elDead.textContent  = dead;
  if (elTime)  elTime.textContent  = formatTime(simTime);
  if (elFps)   elFps.textContent   = fps;
}

/** Display the end-of-scenario summary card. */
export function showSummary({ result, survivalPct, simTime }) {
  if (!summaryCard) return;
  summaryCard.style.display = 'block';
  if (sumResult)   sumResult.textContent   = result;
  if (sumSurvival) sumSurvival.textContent = `Survival: ${survivalPct}%`;
  if (sumDuration) sumDuration.textContent = `Duration: ${formatTime(simTime)}`;
}

/** Hide the summary card. */
export function hideSummary() {
  if (summaryCard) summaryCard.style.display = 'none';
}

/** Format sim-seconds as HH:MM:SS. */
function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
