/**
 * controlPanel.js — Wires up scenario picker, parameter sliders, and RUN/RESET buttons.
 * Calls back into main.js via onRun(scenarioKey, params) and onReset().
 */

/** Attach all UI event listeners. onRun and onReset are callbacks from main.js. */
export function initControlPanel(onRun, onReset) {
  const scenarioSelect = document.getElementById('scenario-select');

  // Show/hide param sections when scenario changes
  scenarioSelect.addEventListener('change', () => {
    document.querySelectorAll('.param-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`params-${scenarioSelect.value}`)?.classList.add('active');
  });

  // Sync all sliders to their display spans
  wireSlider('flood-count',    'flood-count-val');
  wireSlider('flood-rise',     'flood-rise-val');
  wireSlider('battle-a',       'battle-a-val');
  wireSlider('battle-b',       'battle-b-val');
  wireSlider('battle-speed',   'battle-speed-val');
  wireSlider('battle-range',   'battle-range-val');
  wireSlider('end-count',      'end-count-val');
  wireSlider('end-dur',        'end-dur-val');

  // RUN button
  document.getElementById('btn-run').addEventListener('click', () => {
    const key = scenarioSelect.value;
    onRun(key, readParams(key));
  });

  // RESET button
  document.getElementById('btn-reset').addEventListener('click', onReset);
}

/** Read current parameter values for the given scenario key. */
export function readParams(key) {
  switch (key) {
    case 'flood':
      return {
        agentCount:  +document.getElementById('flood-count').value,
        risePercent: +document.getElementById('flood-rise').value,
        speed:       +document.getElementById('flood-speed').value,
      };
    case 'battle':
      return {
        teamA:       +document.getElementById('battle-a').value,
        teamB:       +document.getElementById('battle-b').value,
        speed:       +document.getElementById('battle-speed').value,
        attackRange: +document.getElementById('battle-range').value,
      };
    case 'endurance':
      return {
        agentCount:    +document.getElementById('end-count').value,
        durationHours: +document.getElementById('end-dur').value,
        difficulty:    +document.getElementById('end-terrain').value,
      };
    default:
      return {};
  }
}

function wireSlider(sliderId, displayId) {
  const slider  = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  if (!slider || !display) return;
  slider.addEventListener('input', () => { display.textContent = slider.value; });
}
