# AryanForge

A 3D scenario simulation sandbox built with **Vite + Three.js + Rapier.js (WASM physics)**.  
Runs entirely in the browser — no server required.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:5173
```

## How to Use

1. Pick a scenario from the dropdown (top-left panel)
2. Adjust parameters with the sliders
3. Click **RUN** — agents spawn and the simulation begins
4. Click **RESET** (or press `R`) to clear the scene
5. Press `SPACE` to pause/resume
6. Drag to orbit the camera, scroll to zoom, right-click drag to pan
7. Toggle **TIME-LAPSE** (top-right) to run 3600× faster (1 sim-hour = 1 real second)

## Scenarios

### Flood
Agents flee rising water. Any agent submerged for 2+ seconds drowns.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Agents | 10–500 | Number of agents spawned |
| Water Rise % | 0–100 | Final water height as % of max terrain height |
| Rise Speed | Slow / Medium / Fast | Rate of water rise (0.3 / 0.8 / 2.0 units/sec) |

### Battle
Team A (red) vs Team B (blue). Agents target nearest enemy and deal 1 HP/tick on contact.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Team A / Team B | 5–250 each | Number of agents per team |
| Speed | 1–15 | Movement speed |
| Attack Range | 1–8 | Distance at which agents start attacking |

### Endurance
Agents wander until their stamina drains to zero. Steep terrain drains stamina faster.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Agents | 10–500 | Number of agents |
| Duration | 1–24 sim-hours | How long the scenario runs |
| Terrain Difficulty | Easy / Medium / Hard | Stamina drain multiplier (0.5 / 1.0 / 2.0) |

## How to Add a New Scenario

1. Create `src/scenarios/my-scenario.js` — export an object with these four methods:

```js
export const myScenario = {
  // Called once when RUN is clicked. Spawn agents, create meshes, set state.
  init(scene, params) { ... },

  // Called every physics tick (60Hz). dt = scaled sim-seconds. simTime = total elapsed.
  update(dt, simTime) { ... },

  // Called on RESET. Remove all meshes and agents from scene.
  teardown(scene) { ... },

  // Return { alive, dead } for the stats panel.
  getCounts() { ... },
};
```

2. Register it in `src/scenarios/index.js`:

```js
import { myScenario } from './my-scenario.js';

export const SCENARIOS = {
  flood,
  battle,
  endurance,
  'my-scenario': myScenario,   // ← add this line
};
```

3. Add a `<option value="my-scenario">My Scenario</option>` in `index.html` inside `#scenario-select`.

4. Optionally add a `<div id="params-my-scenario" class="param-section">` block with sliders, and handle them in `src/ui/controlPanel.js` → `readParams()`.

## Project Structure

```
sim-sandbox/
├── index.html              UI layout, CSS, HTML elements
├── vite.config.js          Vite config (excludes Rapier from dep optimization)
└── src/
    ├── main.js             Bootstrap + scenario orchestration
    ├── engine/
    │   ├── scene.js        Three.js scene, camera, lights, OrbitControls
    │   ├── physics.js      Rapier world init, body helpers
    │   └── loop.js         Fixed-timestep animation loop
    ├── entities/
    │   ├── agent.js        Agent class: mesh, state machine, behaviors
    │   └── terrain.js      Procedural heightmap terrain
    ├── scenarios/
    │   ├── index.js        Scenario registry
    │   ├── flood.js        Rising water scenario
    │   ├── battle.js       Team vs team melee
    │   └── endurance.js    Stamina drain endurance run
    ├── ui/
    │   ├── controlPanel.js Slider/button wiring
    │   └── stats.js        Live stats + summary card
    └── utils/
        └── timeScale.js    Real-time / time-lapse toggle
```

## Performance Notes

- Agent cap: 500 (enforced by slider max)
- Physics runs at fixed 60Hz; rendering runs as fast as the GPU allows
- Rapier bodies are kinematic (position-based) — agents steer themselves, physics handles collision queries
- For counts > 100, consider switching to `InstancedMesh` in `agent.js` for better GPU performance
