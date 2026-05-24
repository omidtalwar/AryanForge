/**
 * spatialGrid.js — Spatial hash grid for O(1) nearest-neighbour queries.
 * Integer keys avoid per-query string allocation (faster than template-literal keys).
 */

const _OFFSET = 500; // cells offset so negative coords stay positive

export class SpatialGrid {
  constructor(cellSize = 12) {
    this.cellSize = cellSize;
    this._cells   = new Map();
  }

  clear() { this._cells.clear(); }

  insert(agent) {
    const k = this._key(agent.x, agent.z);
    let c = this._cells.get(k);
    if (!c) { c = []; this._cells.set(k, c); }
    c.push(agent);
  }

  query(x, z, radius) {
    const r   = Math.ceil(radius / this.cellSize);
    const cx  = Math.floor(x / this.cellSize);
    const cz  = Math.floor(z / this.cellSize);
    const out = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cell = this._cells.get((cx + dx + _OFFSET) * 1000 + (cz + dz + _OFFSET));
        if (cell) for (const a of cell) out.push(a);
      }
    }
    return out;
  }

  _key(x, z) {
    return (Math.floor(x / this.cellSize) + _OFFSET) * 1000 +
           (Math.floor(z / this.cellSize) + _OFFSET);
  }
}
