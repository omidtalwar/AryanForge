/**
 * agent.js — Humanoid agent: articulated mesh (head, torso, arms, legs),
 * kinematic physics body, walk-cycle animation, and state machine.
 */

import * as THREE from 'three';
import { createAgentBody, removeBody } from '../engine/physics.js';
import { sampleHeightWorld } from './terrain.js';
import { playDeath, playHit, playSplash } from '../utils/sound.js';

// ── Shared geometries (created once, reused by every agent) ───────────────────
const G = {
  head:       new THREE.SphereGeometry(0.21, 12, 9),
  helmet:     new THREE.SphereGeometry(0.235, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  torso:      new THREE.BoxGeometry(0.46, 0.52, 0.24),
  hip:        new THREE.BoxGeometry(0.38, 0.2, 0.22),
  upperArm:   new THREE.CylinderGeometry(0.075, 0.075, 0.4, 7),
  lowerArm:   new THREE.CylinderGeometry(0.065, 0.055, 0.35, 7),
  hand:       new THREE.SphereGeometry(0.075, 7, 6),
  upperLeg:   new THREE.CylinderGeometry(0.1, 0.09, 0.44, 7),
  lowerLeg:   new THREE.CylinderGeometry(0.085, 0.08, 0.4, 7),
  foot:       new THREE.BoxGeometry(0.13, 0.1, 0.24),
  sword:      new THREE.BoxGeometry(0.06, 0.7, 0.04),
  swordGuard: new THREE.BoxGeometry(0.28, 0.055, 0.055),
  backpack:   new THREE.BoxGeometry(0.22, 0.28, 0.12),
};

// ── Shared materials per team + skin/dark ──────────────────────────────────────
const M = {
  skin: new THREE.MeshLambertMaterial({ color: 0xf0c090 }),
  dark: new THREE.MeshLambertMaterial({ color: 0x2a2a2a }),
  boot: new THREE.MeshLambertMaterial({ color: 0x3a2810 }),
  sword: new THREE.MeshLambertMaterial({ color: 0xc8c8c8, metalness: 0 }),
  red:   new THREE.MeshLambertMaterial({ color: 0xcc2222 }),
  redH:  new THREE.MeshLambertMaterial({ color: 0x991111 }),
  blue:  new THREE.MeshLambertMaterial({ color: 0x2255cc }),
  blueH: new THREE.MeshLambertMaterial({ color: 0x113399 }),
  white: new THREE.MeshLambertMaterial({ color: 0xcccccc }),
  whiteH:new THREE.MeshLambertMaterial({ color: 0x888888 }),
};

// Per-team: [bodyMat, helmetMat]
const TEAM_MATS = {
  red:   [M.red,   M.redH],
  blue:  [M.blue,  M.blueH],
  white: [M.white, M.whiteH],
};

// Agent states
export const STATE = {
  IDLE:   'idle',
  FLEE:   'flee',
  FIGHT:  'fight',
  TIRED:  'tired',
  WANDER: 'wander',
  DEAD:   'dead',
};

export const agents = [];

export function createAgent(scene, x, z, team = 'white', speed = 5) {
  const a = new Agent(scene, x, z, team, speed);
  agents.push(a);
  return a;
}

export function clearAgents(scene) {
  for (const a of agents) a.destroy(scene);
  agents.length = 0;
}

// ── Agent class ───────────────────────────────────────────────────────────────

class Agent {
  constructor(scene, x, z, team, speed) {
    this.team    = team;
    this.speed   = speed;
    this.hp      = 100;
    this.stamina = 100;
    this.state   = STATE.IDLE;
    this.alive   = true;

    this.x = x;
    this.y = sampleHeightWorld(x, z) + 1.55;
    this.z = z;

    this.vx = 0;
    this.vz = 0;
    this.underWaterTime = 0;
    this.deadTimer = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.attackTimer = 0;
    this.target = null;

    // Walk animation accumulator
    this.walkPhase = Math.random() * Math.PI * 2;

    // Build the humanoid mesh hierarchy
    this._buildMesh(scene, team);

    // Physics body
    const { rigidBody } = createAgentBody(this.x, this.y, this.z);
    this.rigidBody = rigidBody;
  }

  // ── Mesh construction ──────────────────────────────────────────────────────

  _buildMesh(scene, team) {
    const [bodyMat, helmetMat] = TEAM_MATS[team] ?? TEAM_MATS.white;
    const isBattle = (team === 'red' || team === 'blue');

    this.group = new THREE.Group();

    // --- Head ---
    this.headMesh = new THREE.Mesh(G.head, M.skin);
    this.headMesh.position.set(0, 1.62, 0);
    this.headMesh.castShadow = true;
    this.group.add(this.headMesh);

    // Helmet (battle) or hat-brim (endurance/flood)
    if (isBattle) {
      const helm = new THREE.Mesh(G.helmet, helmetMat);
      helm.position.set(0, 1.69, 0);
      helm.castShadow = true;
      this.group.add(helm);
    }

    // --- Torso ---
    this.torsoMesh = new THREE.Mesh(G.torso, bodyMat);
    this.torsoMesh.position.set(0, 1.15, 0);
    this.torsoMesh.castShadow = true;
    this.group.add(this.torsoMesh);

    // --- Hip ---
    const hipMesh = new THREE.Mesh(G.hip, bodyMat);
    hipMesh.position.set(0, 0.84, 0);
    this.group.add(hipMesh);

    // --- Left Arm pivot (attached at shoulder) ---
    this.lArmPivot = new THREE.Group();
    this.lArmPivot.position.set(-0.3, 1.36, 0);
    const lUpper = new THREE.Mesh(G.upperArm, bodyMat);
    lUpper.position.y = -0.2;
    lUpper.castShadow = true;
    this.lArmPivot.add(lUpper);
    const lLower = new THREE.Mesh(G.lowerArm, M.skin);
    lLower.position.y = -0.58;
    this.lArmPivot.add(lLower);
    const lHand = new THREE.Mesh(G.hand, M.skin);
    lHand.position.y = -0.77;
    this.lArmPivot.add(lHand);
    this.group.add(this.lArmPivot);

    // --- Right Arm pivot ---
    this.rArmPivot = new THREE.Group();
    this.rArmPivot.position.set(0.3, 1.36, 0);
    const rUpper = new THREE.Mesh(G.upperArm, bodyMat);
    rUpper.position.y = -0.2;
    rUpper.castShadow = true;
    this.rArmPivot.add(rUpper);
    const rLower = new THREE.Mesh(G.lowerArm, M.skin);
    rLower.position.y = -0.58;
    this.rArmPivot.add(rLower);
    const rHand = new THREE.Mesh(G.hand, M.skin);
    rHand.position.y = -0.77;
    this.rArmPivot.add(rHand);
    this.group.add(this.rArmPivot);

    // Sword in right hand for battle agents
    if (isBattle) {
      const swordGrp = new THREE.Group();
      swordGrp.position.set(0, -0.77, 0);
      const blade = new THREE.Mesh(G.sword, M.sword);
      blade.position.y = 0.35;
      swordGrp.add(blade);
      const guard = new THREE.Mesh(G.swordGuard, M.dark);
      guard.position.y = 0.02;
      swordGrp.add(guard);
      this.rArmPivot.add(swordGrp);
      this.swordGrp = swordGrp;
    }

    // Backpack for endurance agents
    if (team === 'white') {
      const bp = new THREE.Mesh(G.backpack, M.dark);
      bp.position.set(0, 1.1, -0.19);
      this.group.add(bp);
    }

    // --- Left Leg pivot ---
    this.lLegPivot = new THREE.Group();
    this.lLegPivot.position.set(-0.13, 0.84, 0);
    const lThigh = new THREE.Mesh(G.upperLeg, bodyMat);
    lThigh.position.y = -0.22;
    lThigh.castShadow = true;
    this.lLegPivot.add(lThigh);
    const lShin = new THREE.Mesh(G.lowerLeg, M.dark);
    lShin.position.y = -0.62;
    this.lLegPivot.add(lShin);
    const lFoot = new THREE.Mesh(G.foot, M.boot);
    lFoot.position.set(0, -0.85, 0.06);
    this.lLegPivot.add(lFoot);
    this.group.add(this.lLegPivot);

    // --- Right Leg pivot ---
    this.rLegPivot = new THREE.Group();
    this.rLegPivot.position.set(0.13, 0.84, 0);
    const rThigh = new THREE.Mesh(G.upperLeg, bodyMat);
    rThigh.position.y = -0.22;
    rThigh.castShadow = true;
    this.rLegPivot.add(rThigh);
    const rShin = new THREE.Mesh(G.lowerLeg, M.dark);
    rShin.position.y = -0.62;
    this.rLegPivot.add(rShin);
    const rFoot = new THREE.Mesh(G.foot, M.boot);
    rFoot.position.set(0, -0.85, 0.06);
    this.rLegPivot.add(rFoot);
    this.group.add(this.rLegPivot);

    // Collect all part meshes for fade-out on death
    this._parts = this.group.children.flatMap(c =>
      c.isMesh ? [c] : c.children.filter(cc => cc.isMesh)
    );

    this.group.position.set(this.x, this.y, this.z);
    scene.add(this.group);
  }

  // ── Walk-cycle animation ───────────────────────────────────────────────────

  _animateWalk(dt, moving, fighting) {
    const speed = moving ? this.speed : 0;
    this.walkPhase += speed * dt * 2.8;

    const swing = moving ? Math.sin(this.walkPhase) * 0.6 : 0;
    const bodyBob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : 0;

    // Arms swing opposite to legs (natural gait)
    this.lArmPivot.rotation.x =  swing;
    this.rArmPivot.rotation.x = -swing;
    this.lLegPivot.rotation.x = -swing;
    this.rLegPivot.rotation.x =  swing;

    this.group.position.y = this.y + bodyBob;

    // Fighting: raise sword arm
    if (fighting && this.swordGrp) {
      this.rArmPivot.rotation.x = -1.1 + Math.sin(this.walkPhase * 3) * 0.4;
      this.rArmPivot.rotation.z = -0.3;
    } else if (this.rArmPivot) {
      this.rArmPivot.rotation.z = 0;
    }
  }

  // ── Per-tick update ────────────────────────────────────────────────────────

  update(dt, hints = {}) {
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }

    let moving   = false;
    let fighting = false;

    switch (this.state) {
      case STATE.FLEE:   this._updateFlee(dt, hints);  moving = true; break;
      case STATE.FIGHT:  this._updateFight(dt, hints); fighting = true; break;
      case STATE.TIRED:  this._updateTired(dt); break;
      case STATE.WANDER: this._updateWander(dt, hints); moving = true; break;
    }

    // Clamp agent to terrain surface
    const groundY = sampleHeightWorld(this.x, this.z) + 1.55;
    if (this.y < groundY) this.y = groundY;

    // Sync position to mesh + physics
    this.group.position.set(this.x, this.y, this.z);
    if (this.rigidBody) {
      this.rigidBody.setNextKinematicTranslation({ x: this.x, y: this.y, z: this.z });
    }

    // Face movement direction
    const spd = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (spd > 0.05) {
      this.group.rotation.y = Math.atan2(this.vx, this.vz);
    }

    this._animateWalk(dt, moving || (fighting && spd > 0.05), fighting);
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  _updateFlee(dt, { waterY = -999 }) {
    const myGroundY = sampleHeightWorld(this.x, this.z);
    const safe = myGroundY > waterY + 1.0;

    if (!safe) {
      let bestH = -Infinity, bestDx = 0, bestDz = 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + this.wanderAngle * 0.12;
        const tx = this.x + Math.cos(ang) * 7;
        const tz = this.z + Math.sin(ang) * 7;
        const h = sampleHeightWorld(tx, tz);
        if (h > bestH) { bestH = h; bestDx = Math.cos(ang); bestDz = Math.sin(ang); }
      }
      this.vx = bestDx * this.speed;
      this.vz = bestDz * this.speed;
    } else {
      this._wander(dt, 0.6);
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this._clamp();
  }

  _updateFight(dt, { attackRange = 2, allAgents = [] }) {
    this.attackTimer -= dt;

    if (!this.target || !this.target.alive) {
      this.target = this._nearestEnemy(allAgents);
    }

    if (!this.target) { this.vx = 0; this.vz = 0; return; }

    const dx = this.target.x - this.x;
    const dz = this.target.z - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > attackRange) {
      this.vx = (dx / dist) * this.speed;
      this.vz = (dz / dist) * this.speed;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this._clamp();
    } else {
      this.vx = 0; this.vz = 0;
      if (this.attackTimer <= 0) {
        this.target.hp -= 1;
        this.attackTimer = 1 / 10;
        playHit();
        if (this.target.hp <= 0) {
          this.target.die();
          this.target = null;
        }
      }
    }
  }

  _updateTired(dt) {
    this.vx = 0; this.vz = 0;
  }

  _updateWander(dt, { difficulty = 1 }) {
    this._wander(dt, this.speed);

    const slope = sampleHeightWorld(this.x + 0.5, this.z) - sampleHeightWorld(this.x - 0.5, this.z);
    const drain = (Math.abs(slope) * 2 + 0.5) * difficulty * dt;
    this.stamina = Math.max(0, this.stamina - drain);

    if (this.stamina <= 0) { this.state = STATE.TIRED; this.die(); return; }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this._clamp();
  }

  _updateDead(dt) {
    this.deadTimer += dt;

    const fallAngle = Math.min(this.deadTimer * 3, Math.PI / 2);
    this.group.rotation.z = fallAngle;

    if (this.deadTimer > 1) {
      this.group.position.y -= 0.4 * dt;
      const opacity = Math.max(0, 1 - (this.deadTimer - 1) / 2.5);
      for (const m of this._parts) {
        if (m.material && !m.material._fadePrepared) {
          m.material = m.material.clone();
          m.material.transparent = true;
          m.material._fadePrepared = true;
        }
        if (m.material?._fadePrepared) m.material.opacity = opacity;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _wander(dt, spd) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderAngle += (Math.random() - 0.5) * Math.PI * 0.9;
      this.wanderTimer = 1.2 + Math.random() * 2;
    }
    this.vx = Math.cos(this.wanderAngle) * spd;
    this.vz = Math.sin(this.wanderAngle) * spd;
  }

  _nearestEnemy(all) {
    let best = null, bestD = Infinity;
    for (const a of all) {
      if (!a.alive || a.team === this.team) continue;
      const d = (a.x - this.x) ** 2 + (a.z - this.z) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
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

    if (this.underWaterTime > 0) playSplash();
    else playDeath();

    if (this.rigidBody) { removeBody(this.rigidBody); this.rigidBody = null; }
  }

  destroy(scene) {
    scene.remove(this.group);
    if (this.rigidBody) { removeBody(this.rigidBody); this.rigidBody = null; }
  }

  isDoneDecaying() {
    return !this.alive && this.deadTimer > 3.8;
  }
}
