/**
 * battle.js — Team A vs Team B melee scenario.
 * Each agent targets the nearest enemy, moves toward them, and deals damage on contact.
 * The last team with survivors wins.
 */

import { createAgent, clearAgents, agents, STATE } from '../entities/agent.js';
import { showSummary } from '../ui/stats.js';
import { startBattleAmbient, stopAmbient, playVictory } from '../utils/sound.js';

let started = false;
let done = false;
let attackRange = 2;

export const battle = {
  init(scene, params) {
    done = false;
    started = false;
    attackRange = params.attackRange ?? 2;

    const teamACount = params.teamA ?? 50;
    const teamBCount = params.teamB ?? 50;
    const spd = params.speed ?? 5;

    // Spawn Team A on the left half, Team B on the right half
    for (let i = 0; i < teamACount; i++) {
      const x = -10 - Math.random() * 35;
      const z = (Math.random() - 0.5) * 70;
      const a = createAgent(scene, x, z, 'red', spd);
      a.state = STATE.FIGHT;
    }

    for (let i = 0; i < teamBCount; i++) {
      const x = 10 + Math.random() * 35;
      const z = (Math.random() - 0.5) * 70;
      const a = createAgent(scene, x, z, 'blue', spd);
      a.state = STATE.FIGHT;
    }

    started = true;
    startBattleAmbient();
  },

  update(dt, simTime) {
    if (!started || done) return;

    const hints = { attackRange, allAgents: agents };
    for (const a of agents) {
      a.update(dt, hints);
    }

    // Check win condition: one team wiped out
    const redAlive  = agents.filter(a => a.alive && a.team === 'red').length;
    const blueAlive = agents.filter(a => a.alive && a.team === 'blue').length;

    if (!done && (redAlive === 0 || blueAlive === 0)) {
      done = true;
      stopAmbient();
      playVictory();
      const total = agents.length;
      const winner = redAlive > 0 ? 'Team A (Red) wins!' : blueAlive > 0 ? 'Team B (Blue) wins!' : 'Draw!';
      const survivors = Math.max(redAlive, blueAlive);
      showSummary({
        result: winner,
        survivalPct: Math.round((survivors / total) * 100),
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
    const redAlive  = agents.filter(a => a.alive && a.team === 'red').length;
    const blueAlive = agents.filter(a => a.alive && a.team === 'blue').length;
    const alive = redAlive + blueAlive;
    return { alive, dead: agents.length - alive, redAlive, blueAlive };
  },
};
