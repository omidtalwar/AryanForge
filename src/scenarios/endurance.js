/**
 * endurance.js — Agents wander until their stamina is exhausted.
 * Steeper terrain drains stamina faster. Scenario ends when time runs out or all collapse.
 */

import { createAgent, clearAgents, agents, STATE } from '../entities/agent.js';
import { showSummary } from '../ui/stats.js';
import { startWindAmbient, stopAmbient, playVictory } from '../utils/sound.js';

let started = false;
let done = false;
let durationSecs = 0; // sim-seconds

export const endurance = {
  init(scene, params) {
    done = false;
    started = false;

    const { agentCount = 80, durationHours = 8, difficulty = 1.0 } = params;
    durationSecs = durationHours * 3600; // convert sim-hours to sim-seconds

    for (let i = 0; i < agentCount; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      const a = createAgent(scene, x, z, 'white', 3 + Math.random() * 2);
      a.state = STATE.WANDER;
      a._difficulty = difficulty; // attach for use in update hints
    }

    started = true;
    startWindAmbient();
  },

  update(dt, simTime) {
    if (!started || done) return;

    const hints = { difficulty: agents[0]?._difficulty ?? 1 };
    for (const a of agents) {
      a.update(dt, hints);
    }

    // Scenario ends when time runs out
    if (!done && simTime >= durationSecs) {
      done = true;
      stopAmbient();
      playVictory();
      const alive = agents.filter(a => a.alive).length;
      const total = agents.length;
      showSummary({
        result: `${alive} of ${total} survived`,
        survivalPct: Math.round((alive / total) * 100),
        simTime,
      });
    }

    // Or if everyone collapses early
    const alive = agents.filter(a => a.alive).length;
    if (!done && alive === 0) {
      done = true;
      stopAmbient();
      showSummary({
        result: 'All agents collapsed',
        survivalPct: 0,
        simTime,
      });
    }
  },

  teardown(scene) {
    clearAgents(scene);
    stopAmbient();
    started = false;
    done = false;
  },

  getCounts() {
    const alive = agents.filter(a => a.alive).length;
    return { alive, dead: agents.length - alive };
  },
};
