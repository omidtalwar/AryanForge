/**
 * agent.js — Agent AI, state machine, and bone-value animation.
 * Rendering handled by agentRenderer.js (InstancedMesh). No Three.js Groups here.
 */

import { sampleHeightWorld } from './terrain.js';
import { playDeath, playHit, playSplash, playGunshot } from '../utils/sound.js';
import { spawnDeathEffect, spawnMuzzleFlash, spawnBulletTracer } from '../utils/effects.js';
import { registerAgent } from './agentRenderer.js';

export const STATE = {
  IDLE:   'idle',
  FLEE:   'flee',
  FIGHT:  'fight',
  TIRED:  'tired',
  WANDER: 'wander',
  DEAD:   'dead',
};

export const agents = [];

export function createAgent(scene, x, z, team = 'white', speed = 5, weaponType = 'none') {
  const a = new Agent(scene, x, z, team, speed, weaponType);
  registerAgent(a);
  agents.push(a);
  return a;
}

export function clearAgents() {
  agents.length = 0;
}

// ── Agent class ───────────────────────────────────────────────────────────────

class Agent {
  constructor(scene, x, z, team, speed, weaponType) {
    this._scene     = scene;
    this.team       = team;
    this.speed      = speed;
    this.weaponType = weaponType;
    this.hp         = 100;
    this.stamina    = 100;
    this.state      = STATE.IDLE;
    this.alive      = true;

    this.x = x;
    this.y = sampleHeightWorld(x, z);
    this.z = z;
    this.vx = 0;
    this.vz = 0;

    this.facing         = Math.random() * Math.PI * 2;
    this.underWaterTime = 0;
    this.deadTimer      = 0;
    this.wanderAngle    = Math.random() * Math.PI * 2;
    this.wanderTimer    = 0;
    this.attackTimer    = 0;
    this.target         = null;

    // Stagger retarget checks so they don't all hit the same frame
    this._retargetTimer = Math.random() * 0.5;
    this._recoilTimer   = 0;
    this._slopeTimer    = Math.floor(Math.random() * 6);

    // ── Bone values read by agentRenderer each frame ─────────────────────────
    this.lArmSwing  = 0;  this.rArmSwing  = 0;
    this.lElbowBend = 0;  this.rElbowBend = 0;
    this.rArmZ      = 0;
    this.lLegSwing  = 0;  this.rLegSwing  = 0;
    this.lKneeBend  = 0;  this.rKneeBend  = 0;
    this.walkPhase  = Math.random() * Math.PI * 2;

    this._pitch      = 0;
    this._roll       = 0;
    this._deathRoll  = 0;
    this._deathSinkY = 0;
  }

  // ── Per-tick update ────────────────────────────────────────────────────────

  update(dt, hints = {}) {
    if (!this.alive) { this._updateDead(dt); return; }

    let moving = false, fighting = false;

    switch (this.state) {
      case STATE.FLEE:   this._updateFlee(dt, hints);   moving   = true; break;
      case STATE.FIGHT:  this._updateFight(dt, hints);  fighting = true; break;
      case STATE.TIRED:  this.vx = 0; this.vz = 0;      break;
      case STATE.WANDER: this._updateWander(dt, hints); moving   = true; break;
    }

    const groundY = sampleHeightWorld(this.x, this.z);
    if (this.y < groundY) this.y = groundY;

    // Face movement direction smoothly
    const spd = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (spd > 0.05) {
      const target = Math.atan2(this.vx, this.vz);
      // Shortest-path angle lerp to avoid 360° spin
      let diff = target - this.facing;
      if (diff >  Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, 12 * dt);
    }

    // Slope alignment every 6 frames (staggered)
    if (--this._slopeTimer <= 0) { this._slopeTimer = 6; this._alignToSlope(); }

    this._animateWalk(dt, moving || (fighting && spd > 0.05), fighting);
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  _updateFlee(dt, { waterY = -999 }) {
    const myY  = sampleHeightWorld(this.x, this.z);
    const safe = myY > waterY + 1.0;

    if (!safe) {
      let bestH = -Infinity, bestDx = 0, bestDz = 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + this.wanderAngle * 0.12;
        const h   = sampleHeightWorld(this.x + Math.cos(ang) * 7, this.z + Math.sin(ang) * 7);
        if (h > bestH) { bestH = h; bestDx = Math.cos(ang); bestDz = Math.sin(ang); }
      }
      this._smoothVel(bestDx * this.speed, bestDz * this.speed, dt, 8);
    } else {
      this._wander(dt, 0.6);
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this._clamp();
  }

  _updateFight(dt, { attackRange = 2, allAgents = [] }) {
    this.attackTimer    -= dt;
    this._retargetTimer -= dt;

    // Re-acquire target: immediately when dead, otherwise every 0.5s (staggered)
    if (!this.target?.alive && this._retargetTimer <= 0) {
      this.target = this._nearestEnemy(allAgents);
      // Short delay before next search to spread CPU cost across frames
      this._retargetTimer = 0.4 + Math.random() * 0.2;
    }
    if (!this.target) { this._smoothVel(0, 0, dt, 6); return; }

    const dx   = this.target.x - this.x;
    const dz   = this.target.z - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (this.weaponType === 'gun') {
      const ideal = 10, maxRange = 20;
      if (dist > maxRange) {
        this._smoothVel((dx / dist) * this.speed, (dz / dist) * this.speed, dt, 6);
      } else {
        const pullIn  = dist > ideal + 3.5;
        const backOff = dist < ideal - 2.5;
        if (pullIn)      this._smoothVel((dx / dist) * this.speed * 0.6,  (dz / dist) * this.speed * 0.6,  dt, 6);
        else if (backOff) this._smoothVel(-(dx / dist) * this.speed * 0.5, -(dz / dist) * this.speed * 0.5, dt, 6);
        else              this._smoothVel(0, 0, dt, 6);
        if (this.attackTimer <= 0) this._fireAtTarget();
      }
    } else {
      const mRange = this.weaponType === 'knife' ? attackRange * 0.75 : attackRange;
      if (dist > mRange) {
        this._smoothVel((dx / dist) * this.speed, (dz / dist) * this.speed, dt, 8);
      } else {
        this._smoothVel(0, 0, dt, 10);
        if (this.attackTimer <= 0) {
          const dmg  = this.weaponType === 'knife' ? 2    : 1;
          const rate = this.weaponType === 'knife' ? 1/14 : 1/10;
          this.target.hp -= dmg;
          this.attackTimer = rate;
          playHit();
          if (this.target.hp <= 0) { this.target.die(); this.target = null; }
        }
      }
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this._clamp();
  }

  _fireAtTarget() {
    if (!this.target?.alive) return;
    this.attackTimer  = 0.45;
    this._recoilTimer = 0.14;
    playGunshot();

    const fwdX   = Math.sin(this.facing);
    const fwdZ   = Math.cos(this.facing);
    spawnMuzzleFlash(this._scene, this.x + fwdX * 0.5, this.y + 1.25, this.z + fwdZ * 0.5);
    spawnBulletTracer(
      this._scene,
      this.x + fwdX * 0.5, this.y + 1.25, this.z + fwdZ * 0.5,
      this.target.x, this.target.y + 0.9, this.target.z,
    );

    this.target.hp -= 20;
    if (this.target.hp <= 0) { this.target.die(); this.target = null; }
  }

  _updateWander(dt, { difficulty = 1 }) {
    this._wander(dt, this.speed);
    const slope = sampleHeightWorld(this.x + 0.5, this.z) - sampleHeightWorld(this.x - 0.5, this.z);
    this.stamina = Math.max(0, this.stamina - (Math.abs(slope) * 2 + 0.5) * difficulty * dt);
    if (this.stamina <= 0) { this.state = STATE.TIRED; this.die(); return; }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this._clamp();
  }

  _updateDead(dt) {
    this.deadTimer   += dt;
    this._deathRoll   = Math.min(this.deadTimer * 3, Math.PI / 2);
    if (this.deadTimer > 1.0) this._deathSinkY -= 0.35 * dt;
  }

  // ── Walk-cycle animation ───────────────────────────────────────────────────

  _animateWalk(dt, moving, fighting) {
    const spd = moving ? this.speed : 0;
    this.walkPhase += spd * dt * 2.5;

    const swing = moving ? Math.sin(this.walkPhase) * 0.55 : 0;

    this.lLegSwing = -swing;
    this.lKneeBend = Math.max(0,  swing) * 0.55;
    this.rLegSwing =  swing;
    this.rKneeBend = Math.max(0, -swing) * 0.55;

    if (this._recoilTimer > 0) this._recoilTimer -= dt;

    if (this.weaponType === 'gun' && fighting && this.target?.alive) {
      const kick = this._recoilTimer > 0 ? this._recoilTimer * 3.5 : 0;
      this.rArmSwing  = -0.82 + kick;  this.rArmZ      = -0.12;
      this.rElbowBend =  0.36;         this.lArmSwing  = -0.52;
      this.lElbowBend =  0.62;
    } else if (this.weaponType === 'gun') {
      this.rArmSwing  = -swing * 0.28; this.rArmZ      = -0.10;
      this.rElbowBend =  0.18;         this.lArmSwing  =  swing * 0.28;
      this.lElbowBend =  Math.max(0, swing * 0.28) * 0.20;
    } else if ((this.weaponType === 'sword' || this.weaponType === 'knife') && fighting) {
      const m = this.weaponType === 'knife' ? 1.45 : 1.0;
      this.rArmSwing  = -1.0 + Math.sin(this.walkPhase * 3) * 0.35 * m;
      this.rArmZ      = -0.30;
      this.rElbowBend =  0.55 + Math.sin(this.walkPhase * 3) * 0.18 * m;
      this.lArmSwing  =  swing * 0.50;
      this.lElbowBend =  Math.max(0, swing * 0.5) * 0.25;
    } else {
      this.lArmSwing  =  swing;        this.lElbowBend = Math.max(0,  swing) * 0.28;
      this.rArmSwing  = -swing;        this.rArmZ      = 0;
      this.rElbowBend =  Math.max(0, -swing) * 0.28;
    }
  }

  // ── Slope alignment ────────────────────────────────────────────────────────

  _alignToSlope() {
    const e  = 1.0;
    const sx = Math.sin(this.facing), cz = Math.cos(this.facing);
    const hF = sampleHeightWorld(this.x + sx * e, this.z + cz * e);
    const hB = sampleHeightWorld(this.x - sx * e, this.z - cz * e);
    const hR = sampleHeightWorld(this.x + cz * e, this.z - sx * e);
    const hL = sampleHeightWorld(this.x - cz * e, this.z + sx * e);
    this._pitch += (Math.atan2(hF - hB, 2 * e) * 0.60 - this._pitch) * 0.20;
    this._roll  += (Math.atan2(hL - hR, 2 * e) * 0.55 - this._roll)  * 0.20;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Scan ALL living enemies — correct regardless of map size. Rate-limited via _retargetTimer. */
  _nearestEnemy(allAgents) {
    let best = null, bestD = Infinity;
    for (const a of allAgents) {
      if (!a.alive || a.team === this.team) continue;
      const d = (a.x - this.x) ** 2 + (a.z - this.z) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** Smooth velocity toward (tvx, tvz) at rate `k` (higher = snappier). */
  _smoothVel(tvx, tvz, dt, k = 8) {
    const t  = Math.min(1, k * dt);
    this.vx += (tvx - this.vx) * t;
    this.vz += (tvz - this.vz) * t;
  }

  _wander(dt, spd) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderAngle += (Math.random() - 0.5) * Math.PI * 0.9;
      this.wanderTimer  = 1.2 + Math.random() * 2;
    }
    this._smoothVel(Math.cos(this.wanderAngle) * spd, Math.sin(this.wanderAngle) * spd, dt, 5);
  }

  _clamp() {
    const h = 48;
    this.x = Math.max(-h, Math.min(h, this.x));
    this.z = Math.max(-h, Math.min(h, this.z));
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state = STATE.DEAD;
    this.vx = 0; this.vz = 0;
    if (this.underWaterTime > 0) playSplash(); else playDeath();
    spawnDeathEffect(this._scene, this.x, this.y + 0.9, this.z);
  }

  isDoneDecaying() {
    return !this.alive && this.deadTimer > 2.5;
  }
}
