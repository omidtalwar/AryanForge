/**
 * agent.js — Humanoid agent: articulated mesh with knee/elbow joints,
 * PBR materials, terrain slope alignment, and state machine.
 */

import * as THREE from 'three';
import { createAgentBody, removeBody } from '../engine/physics.js';
import { sampleHeightWorld } from './terrain.js';
import { playDeath, playHit, playSplash } from '../utils/sound.js';

// ── Shared geometries (created once) ──────────────────────────────────────────
const G = {
  head:       new THREE.SphereGeometry(0.21, 14, 10),
  eyeWhite:   new THREE.SphereGeometry(0.046, 7, 6),
  eyePupil:   new THREE.SphereGeometry(0.030, 6, 5),
  helmet:     new THREE.SphereGeometry(0.238, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.58),
  torso:      new THREE.CylinderGeometry(0.20, 0.24, 0.52, 9),
  hip:        new THREE.CylinderGeometry(0.21, 0.19, 0.20, 9),
  upperArm:   new THREE.CylinderGeometry(0.075, 0.068, 0.40, 8),
  lowerArm:   new THREE.CylinderGeometry(0.063, 0.053, 0.35, 7),
  hand:       new THREE.SphereGeometry(0.075, 8, 6),
  upperLeg:   new THREE.CylinderGeometry(0.100, 0.088, 0.44, 8),
  lowerLeg:   new THREE.CylinderGeometry(0.082, 0.076, 0.40, 7),
  foot:       new THREE.BoxGeometry(0.13, 0.10, 0.26),
  sword:      new THREE.BoxGeometry(0.055, 0.72, 0.040),
  swordGuard: new THREE.BoxGeometry(0.28,  0.055, 0.055),
  backpack:   new THREE.BoxGeometry(0.22,  0.28,  0.12),
};

// ── PBR materials ──────────────────────────────────────────────────────────────
const M = {
  skin:   new THREE.MeshStandardMaterial({ color: 0xf5c9a0, roughness: 0.82, metalness: 0.00 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.88, metalness: 0.12 }),
  boot:   new THREE.MeshStandardMaterial({ color: 0x3a2810, roughness: 0.95, metalness: 0.00 }),
  sword:  new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.25, metalness: 0.85 }),
  eye:    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.50, metalness: 0.00 }),
  pupil:  new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.50, metalness: 0.00 }),
  red:    new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.70, metalness: 0.05 }),
  redH:   new THREE.MeshStandardMaterial({ color: 0x881111, roughness: 0.55, metalness: 0.25 }),
  blue:   new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.70, metalness: 0.05 }),
  blueH:  new THREE.MeshStandardMaterial({ color: 0x113399, roughness: 0.55, metalness: 0.25 }),
  white:  new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.78, metalness: 0.04 }),
  whiteH: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.65, metalness: 0.15 }),
};

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
    this.y = sampleHeightWorld(x, z);   // group.position.y = feet on ground
    this.z = z;

    this.vx = 0;
    this.vz = 0;
    this.underWaterTime = 0;
    this.deadTimer      = 0;
    this.wanderAngle    = Math.random() * Math.PI * 2;
    this.wanderTimer    = 0;
    this.attackTimer    = 0;
    this.target         = null;

    this.walkPhase = Math.random() * Math.PI * 2;
    this._pitch    = 0;   // forward tilt from slope
    this._roll     = 0;   // lateral tilt from slope

    this._buildMesh(scene, team);

    const { rigidBody } = createAgentBody(this.x, this.y + 0.9, this.z);
    this.rigidBody = rigidBody;
  }

  // ── Mesh construction ──────────────────────────────────────────────────────

  _buildMesh(scene, team) {
    const [bodyMat, helmetMat] = TEAM_MATS[team] ?? TEAM_MATS.white;
    const isBattle = (team === 'red' || team === 'blue');

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';   // facing first, then slope tilt

    // HEAD
    this.headMesh = new THREE.Mesh(G.head, M.skin);
    this.headMesh.position.set(0, 1.60, 0);
    this.headMesh.castShadow = true;
    this.group.add(this.headMesh);

    // Eyes
    const lEye   = new THREE.Mesh(G.eyeWhite, M.eye);
    lEye.position.set(-0.078, 1.615, 0.175);
    const lPupil = new THREE.Mesh(G.eyePupil, M.pupil);
    lPupil.position.set(-0.078, 1.612, 0.198);
    const rEye   = new THREE.Mesh(G.eyeWhite, M.eye);
    rEye.position.set( 0.078, 1.615, 0.175);
    const rPupil = new THREE.Mesh(G.eyePupil, M.pupil);
    rPupil.position.set( 0.078, 1.612, 0.198);
    this.group.add(lEye, lPupil, rEye, rPupil);

    // Helmet for battle agents
    if (isBattle) {
      const helm = new THREE.Mesh(G.helmet, helmetMat);
      helm.position.set(0, 1.665, 0);
      helm.castShadow = true;
      this.group.add(helm);
    }

    // TORSO — tapered cylinder for better body silhouette
    this.torsoMesh = new THREE.Mesh(G.torso, bodyMat);
    this.torsoMesh.position.set(0, 1.13, 0);
    this.torsoMesh.castShadow = true;
    this.group.add(this.torsoMesh);

    // HIP
    const hipMesh = new THREE.Mesh(G.hip, bodyMat);
    hipMesh.position.set(0, 0.84, 0);
    this.group.add(hipMesh);

    // ── LEFT ARM  (shoulder → elbow pivot → forearm + hand) ──────────────────
    this.lArmPivot = new THREE.Group();
    this.lArmPivot.position.set(-0.295, 1.36, 0);
    const lUpperArm = new THREE.Mesh(G.upperArm, bodyMat);
    lUpperArm.position.y = -0.20;
    lUpperArm.castShadow = true;
    this.lArmPivot.add(lUpperArm);

    this.lElbowPivot = new THREE.Group();
    this.lElbowPivot.position.y = -0.40;
    const lForearm = new THREE.Mesh(G.lowerArm, M.skin);
    lForearm.position.y = -0.175;
    this.lElbowPivot.add(lForearm);
    const lHand = new THREE.Mesh(G.hand, M.skin);
    lHand.position.y = -0.36;
    this.lElbowPivot.add(lHand);
    this.lArmPivot.add(this.lElbowPivot);
    this.group.add(this.lArmPivot);

    // ── RIGHT ARM ─────────────────────────────────────────────────────────────
    this.rArmPivot = new THREE.Group();
    this.rArmPivot.position.set(0.295, 1.36, 0);
    const rUpperArm = new THREE.Mesh(G.upperArm, bodyMat);
    rUpperArm.position.y = -0.20;
    rUpperArm.castShadow = true;
    this.rArmPivot.add(rUpperArm);

    this.rElbowPivot = new THREE.Group();
    this.rElbowPivot.position.y = -0.40;
    const rForearm = new THREE.Mesh(G.lowerArm, M.skin);
    rForearm.position.y = -0.175;
    this.rElbowPivot.add(rForearm);
    const rHand = new THREE.Mesh(G.hand, M.skin);
    rHand.position.y = -0.36;
    this.rElbowPivot.add(rHand);
    this.rArmPivot.add(this.rElbowPivot);
    this.group.add(this.rArmPivot);

    // Sword for battle agents (attached to right forearm)
    if (isBattle) {
      const swordGrp = new THREE.Group();
      swordGrp.position.set(0, -0.36, 0);
      const blade = new THREE.Mesh(G.sword, M.sword);
      blade.position.y = 0.36;
      swordGrp.add(blade);
      const guard = new THREE.Mesh(G.swordGuard, M.dark);
      guard.position.y = 0.02;
      swordGrp.add(guard);
      this.rElbowPivot.add(swordGrp);
      this.swordGrp = swordGrp;
    }

    // Backpack for flood/endurance agents
    if (team === 'white') {
      const bp = new THREE.Mesh(G.backpack, M.dark);
      bp.position.set(0, 1.10, -0.19);
      this.group.add(bp);
    }

    // ── LEFT LEG  (hip pivot → thigh → knee pivot → shin + foot) ─────────────
    this.lLegPivot = new THREE.Group();
    this.lLegPivot.position.set(-0.13, 0.84, 0);
    const lThigh = new THREE.Mesh(G.upperLeg, bodyMat);
    lThigh.position.y = -0.22;
    lThigh.castShadow = true;
    this.lLegPivot.add(lThigh);

    this.lKneePivot = new THREE.Group();
    this.lKneePivot.position.y = -0.44;
    const lShin = new THREE.Mesh(G.lowerLeg, M.dark);
    lShin.position.y = -0.20;
    this.lKneePivot.add(lShin);
    const lFoot = new THREE.Mesh(G.foot, M.boot);
    lFoot.position.set(0, -0.42, 0.06);
    this.lKneePivot.add(lFoot);
    this.lLegPivot.add(this.lKneePivot);
    this.group.add(this.lLegPivot);

    // ── RIGHT LEG ────────────────────────────────────────────────────────────
    this.rLegPivot = new THREE.Group();
    this.rLegPivot.position.set(0.13, 0.84, 0);
    const rThigh = new THREE.Mesh(G.upperLeg, bodyMat);
    rThigh.position.y = -0.22;
    rThigh.castShadow = true;
    this.rLegPivot.add(rThigh);

    this.rKneePivot = new THREE.Group();
    this.rKneePivot.position.y = -0.44;
    const rShin = new THREE.Mesh(G.lowerLeg, M.dark);
    rShin.position.y = -0.20;
    this.rKneePivot.add(rShin);
    const rFoot = new THREE.Mesh(G.foot, M.boot);
    rFoot.position.set(0, -0.42, 0.06);
    this.rKneePivot.add(rFoot);
    this.rLegPivot.add(this.rKneePivot);
    this.group.add(this.rLegPivot);

    // Collect all meshes for death fade (traverse entire hierarchy)
    this._parts = [];
    this.group.traverse(obj => { if (obj.isMesh) this._parts.push(obj); });

    this.group.position.set(this.x, this.y, this.z);
    scene.add(this.group);
  }

  // ── Walk-cycle animation ───────────────────────────────────────────────────

  _animateWalk(dt, moving, fighting) {
    const spd = moving ? this.speed : 0;
    this.walkPhase += spd * dt * 2.5;

    const swing    = moving ? Math.sin(this.walkPhase) * 0.55 : 0;
    const bodyBob  = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : 0;

    // Legs: swing at hip + knee bend for foot clearance during forward swing
    this.lLegPivot.rotation.x  = -swing;
    this.lKneePivot.rotation.x =  Math.max(0,  swing) * 0.55;
    this.rLegPivot.rotation.x  =  swing;
    this.rKneePivot.rotation.x =  Math.max(0, -swing) * 0.55;

    // Arms: swing opposite to legs + slight elbow bend
    if (fighting && this.swordGrp) {
      this.rArmPivot.rotation.x   = -1.0 + Math.sin(this.walkPhase * 3) * 0.35;
      this.rArmPivot.rotation.z   = -0.30;
      this.rElbowPivot.rotation.x =  0.55 + Math.sin(this.walkPhase * 3) * 0.18;
      this.lArmPivot.rotation.x   =  swing * 0.50;
      this.lElbowPivot.rotation.x =  Math.max(0,  swing * 0.5) * 0.25;
    } else {
      this.lArmPivot.rotation.x   =  swing;
      this.lElbowPivot.rotation.x =  Math.max(0,  swing) * 0.28;
      this.rArmPivot.rotation.x   = -swing;
      this.rArmPivot.rotation.z   =  0;
      this.rElbowPivot.rotation.x =  Math.max(0, -swing) * 0.28;
    }

    this.group.position.y = this.y + bodyBob;
  }

  // ── Terrain slope alignment ────────────────────────────────────────────────

  _alignToSlope() {
    const e  = 1.0;
    const fy = this.group.rotation.y;
    const sx = Math.sin(fy), cz = Math.cos(fy);

    const hFwd = sampleHeightWorld(this.x + sx * e, this.z + cz * e);
    const hBwd = sampleHeightWorld(this.x - sx * e, this.z - cz * e);
    const hR   = sampleHeightWorld(this.x + cz * e, this.z - sx * e);
    const hL   = sampleHeightWorld(this.x - cz * e, this.z + sx * e);

    const targetPitch = Math.atan2(hFwd - hBwd, 2 * e) * 0.60;
    const targetRoll  = Math.atan2(hL   - hR,   2 * e) * 0.55;

    this._pitch += (targetPitch - this._pitch) * 0.12;
    this._roll  += (targetRoll  - this._roll)  * 0.12;

    this.group.rotation.x = this._pitch;
    this.group.rotation.z = this._roll;
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
      case STATE.FLEE:   this._updateFlee(dt, hints);  moving   = true; break;
      case STATE.FIGHT:  this._updateFight(dt, hints); fighting = true; break;
      case STATE.TIRED:  this._updateTired(dt); break;
      case STATE.WANDER: this._updateWander(dt, hints); moving  = true; break;
    }

    // Keep feet on terrain surface
    const groundY = sampleHeightWorld(this.x, this.z);
    if (this.y < groundY) this.y = groundY;

    // Facing direction, then slope tilt (YXZ order handles these independently)
    const spd = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (spd > 0.05) {
      this.group.rotation.y = Math.atan2(this.vx, this.vz);
    }

    this._alignToSlope();
    this._animateWalk(dt, moving || (fighting && spd > 0.05), fighting);

    // position.y is set by _animateWalk; set x/z here
    this.group.position.x = this.x;
    this.group.position.z = this.z;

    if (this.rigidBody) {
      this.rigidBody.setNextKinematicTranslation({ x: this.x, y: this.y + 0.9, z: this.z });
    }
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  _updateFlee(dt, { waterY = -999 }) {
    const myGroundY = sampleHeightWorld(this.x, this.z);
    const safe = myGroundY > waterY + 1.0;

    if (!safe) {
      let bestH = -Infinity, bestDx = 0, bestDz = 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + this.wanderAngle * 0.12;
        const tx  = this.x + Math.cos(ang) * 7;
        const tz  = this.z + Math.sin(ang) * 7;
        const h   = sampleHeightWorld(tx, tz);
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

    const dx   = this.target.x - this.x;
    const dz   = this.target.z - this.z;
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
        this.target.hp     -= 1;
        this.attackTimer    = 1 / 10;
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
      this.wanderTimer  = 1.2 + Math.random() * 2;
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
