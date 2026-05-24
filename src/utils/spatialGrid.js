/**
 * spatialGrid.js — Spatial hash grid for O(1) nearest-neighbour queries.
 * Converts O(n²) "find nearest enemy" to O(1) per agent.
 */

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

  /** Return all agents within radius around (x, z). */
  query(x, z, radius) {
    const r   = Math.ceil(radius / this.cellSize);
    const cx  = Math.floor(x / this.cellSize);
    const cz  = Math.floor(z / this.cellSize);
    const out = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cell = this._cells.get(`${cx + dx},${cz + dz}`);
        if (cell) for (const a of cell) out.push(a);
      }
    }
    return out;
  }

  _key(x, z) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }
}
