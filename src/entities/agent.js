/**
 * agent.js — v1: capsule-based agents (simple geometry, no limb animation).
 */
import * as THREE from 'three';
import { createAgentBody, removeBody } from '../engine/physics.js';
import { sampleHeightWorld } from './terrain.js';

const TEAM_COLORS = {
  red:   new THREE.Color(0xff4444),
  blue:  new THREE.Color(0x4488ff),
  white: new THREE.Color(0xdddddd),
};

const BODY_GEO = new THREE.CapsuleGeometry(0.42, 1.2, 4, 8);
const HEAD_GEO = new THREE.SphereGeometry(0.28, 8, 6);

export const STATE = {
  IDLE: 'idle', FLEE: 'flee', FIGHT: 'fight',
  TIRED: 'tired', WANDER: 'wander', DEAD: 'dead',
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

class Agent {
  constructor(scene, x, z, team, speed) {
    this.team = team; this.speed = speed;
    this.hp = 100; this.stamina = 100;
    this.state = STATE.IDLE; this.alive = true;
    this.x = x; this.y = sampleHeightWorld(x, z) + 1.3; this.z = z;
    this.vx = 0; this.vz = 0;
    this.underWaterTime = 0; this.deadTimer = 0;
    this.wanderAngle = Math.random() * Math.PI * 2; this.wanderTimer = 0;
    this.attackTimer = 0; this.target = null;

    const color = TEAM_COLORS[team] ?? TEAM_COLORS.white;
    const mat = new THREE.MeshLambertMaterial({ color });
    this.bodyMesh = new THREE.Mesh(BODY_GEO, mat.clone());
    this.bodyMesh.castShadow = true;
    this.headMesh = new THREE.Mesh(HEAD_GEO, mat.clone());
    this.headMesh.position.y = 1.0;
    this.group = new THREE.Group();
    this.group.add(this.bodyMesh);
    this.group.add(this.headMesh);
    this.group.position.set(this.x, this.y, this.z);
    scene.add(this.group);
    const { rigidBody } = createAgentBody(this.x, this.y, this.z);
    this.rigidBody = rigidBody;
  }

  update(dt, hints = {}) {
    if (!this.alive) { this._updateDead(dt); return; }
    switch (this.state) {
      case STATE.FLEE:   this._updateFlee(dt, hints); break;
      case STATE.FIGHT:  this._updateFight(dt, hints); break;
      case STATE.TIRED:  this._updateTired(dt); break;
      case STATE.WANDER: this._updateWander(dt, hints); break;
    }
    const groundY = sampleHeightWorld(this.x, this.z) + 1.3;
    if (this.y < groundY) this.y = groundY;
    this.group.position.set(this.x, this.y, this.z);
    if (this.rigidBody) this.rigidBody.setNextKinematicTranslation({ x: this.x, y: this.y, z: this.z });
    if (Math.abs(this.vx) > 0.01 || Math.abs(this.vz) > 0.01)
      this.group.rotation.y = Math.atan2(this.vx, this.vz);
    const moving = Math.abs(this.vx) + Math.abs(this.vz) > 0.1;
    if (moving) this.bodyMesh.position.y = Math.sin(Date.now() * 0.01) * 0.06;
  }

  _updateFlee(dt, { waterY = -999 }) {
    const myGroundY = sampleHeightWorld(this.x, this.z);
    if (myGroundY <= waterY + 1.0) {
      let bestH = -Infinity, bestDx = 0, bestDz = 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + this.wanderAngle * 0.1;
        const h = sampleHeightWorld(this.x + Math.cos(ang) * 6, this.z + Math.sin(ang) * 6);
        if (h > bestH) { bestH = h; bestDx = Math.cos(ang); bestDz = Math.sin(ang); }
      }
      this.vx = bestDx * this.speed; this.vz = bestDz * this.speed;
    } else { this._wander(dt, 0.5); }
    this.x += this.vx * dt; this.z += this.vz * dt; this._clamp();
  }

  _updateFight(dt, { attackRange = 2, allAgents = [] }) {
    this.attackTimer -= dt;
    if (!this.target || !this.target.alive) this.target = this._nearestEnemy(allAgents);
    if (!this.target) { this.vx = 0; this.vz = 0; return; }
    const dx = this.target.x - this.x, dz = this.target.z - this.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist > attackRange) {
      this.vx = (dx/dist)*this.speed; this.vz = (dz/dist)*this.speed;
      this.x += this.vx*dt; this.z += this.vz*dt; this._clamp();
    } else {
      this.vx = 0; this.vz = 0;
      if (this.attackTimer <= 0) {
        this.target.hp -= 1; this.attackTimer = 1/12;
        if (this.target.hp <= 0) { this.target.die(); this.target = null; }
      }
    }
  }

  _updateTired(dt) { this.vx = 0; this.vz = 0; this.group.rotation.z = Math.PI/2; }

  _updateWander(dt, { difficulty = 1 }) {
    this._wander(dt, this.speed);
    const slope = sampleHeightWorld(this.x+0.5, this.z) - sampleHeightWorld(this.x-0.5, this.z);
    this.stamina = Math.max(0, this.stamina - (Math.abs(slope)*2+0.5)*difficulty*dt);
    if (this.stamina <= 0) { this.state = STATE.TIRED; this.die(); return; }
    this.x += this.vx*dt; this.z += this.vz*dt; this._clamp();
  }

  _updateDead(dt) {
    this.deadTimer += dt;
    const opacity = Math.max(0, 1 - this.deadTimer/3);
    this.bodyMesh.material.opacity = opacity;
    this.headMesh.material.opacity = opacity;
    this.group.position.y -= 0.5*dt;
  }

  _wander(dt, spd) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) { this.wanderAngle += (Math.random()-0.5)*Math.PI*0.8; this.wanderTimer = 1+Math.random()*2; }
    this.vx = Math.cos(this.wanderAngle)*spd; this.vz = Math.sin(this.wanderAngle)*spd;
  }

  _nearestEnemy(all) {
    let best = null, bestD = Infinity;
    for (const a of all) { if (!a.alive || a.team===this.team) continue; const d=(a.x-this.x)**2+(a.z-this.z)**2; if(d<bestD){bestD=d;best=a;} }
    return best;
  }

  _clamp() { const h=48; this.x=Math.max(-h,Math.min(h,this.x)); this.z=Math.max(-h,Math.min(h,this.z)); }

  die() {
    if (!this.alive) return;
    this.alive = false; this.state = STATE.DEAD; this.vx = 0; this.vz = 0;
    this.group.rotation.z = Math.PI/2;
    this.bodyMesh.material.transparent = true;
    this.headMesh.material.transparent = true;
    if (this.rigidBody) { removeBody(this.rigidBody); this.rigidBody = null; }
  }

  destroy(scene) {
    scene.remove(this.group);
    if (this.rigidBody) { removeBody(this.rigidBody); this.rigidBody = null; }
  }

  isDoneDecaying() { return !this.alive && this.deadTimer > 3.5; }
}
