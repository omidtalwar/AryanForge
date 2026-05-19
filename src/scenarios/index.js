/**
 * index.js — Scenario registry.
 * To add a new scenario: import it here and add an entry to SCENARIOS.
 * Each scenario must implement: init(scene, params), update(dt, simTime), teardown(scene), getCounts().
 */

import { flood }     from './flood.js';
import { battle }    from './battle.js';
import { endurance } from './endurance.js';

export const SCENARIOS = {
  flood,
  battle,
  endurance,
};

/** Return the scenario object by key, or null if not found. */
export function getScenario(key) {
  return SCENARIOS[key] ?? null;
}
