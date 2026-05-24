/**
 * agentRenderer.js — InstancedMesh renderer for humanoid agents.
 *
 * Why: at 1000 agents the old approach (one Three.js Group per agent) generates
 * ~20 000 draw calls/frame and kills the GPU. InstancedMesh collapses all agents
 * sharing the same geometry into ONE draw call — ~23 draw calls total regardless
 * of agent count.
 *
 * Public API:
 *   initRenderer(scene, maxAgents)   — call once at startup
 *   registerAgent(agent)             — call inside createAgent; assigns agent.idx
 *   updateRenderer(agents)           — call every render frame
 *   resetRenderer()                  — call on scenario teardown / reset
 */

import * as THREE from 'three';

// ── Geometry library (shared across all instances) ─────────────────────────────
const G = {
  head:      new THREE.SphereGeometry(0.21, 12, 9),
  helmet:    new THREE.SphereGeometry(0.238, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
  torso:     new THREE.CylinderGeometry(0.20, 0.24, 0.52, 9),
  hip:       new THREE.CylinderGeometry(0.21, 0.19, 0.20, 9),
  uArm:      new THREE.CylinderGeometry(0.075, 0.068, 0.40, 7),
  fArm:      new THREE.CylinderGeometry(0.063, 0.053, 0.35, 7),
  hand:      new THREE.SphereGeometry(0.075, 7, 6),
  uLeg:      new THREE.CylinderGeometry(0.100, 0.088, 0.44, 7),
  lLeg:      new THREE.CylinderGeometry(0.082, 0.076, 0.40, 7),
  foot:      new THREE.BoxGeometry(0.13, 0.10, 0.26),
  sword:     new THREE.BoxGeometry(0.055, 0.72, 0.040),
  sGuard:    new THREE.BoxGeometry(0.28, 0.055, 0.055),
  knife:     new THREE.BoxGeometry(0.032, 0.26, 0.018),
  kGuard:    new THREE.BoxGeometry(0.11, 0.040, 0.032),
  gunBody:   new THREE.BoxGeometry(0.068, 0.60, 0.068),
  gunStock:  new THREE.BoxGeometry(0.055, 0.22, 0.055),
  gunBarrel: new THREE.CylinderGeometry(0.018, 0.018, 0.28, 6),
};

// ── Material library ───────────────────────────────────────────────────────────
const mBase     = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.70, metalness: 0.05 });
const mSkin     = new THREE.MeshStandardMaterial({ color: 0xf5c9a0, roughness: 0.82, metalness: 0.00 });
const mDark     = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.88, metalness: 0.12 });
const mBoot     = new THREE.MeshStandardMaterial({ color: 0x3a2810, roughness: 0.95, metalness: 0.00 });
const mSword    = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.25, metalness: 0.85 });
const mGunMetal = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.30, metalness: 0.90 });
const mGunWood  = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.92, metalness: 0.00 });

// Per-team colors (body and helmet separately)
const BODY_COL   = { red: new THREE.Color(0xcc2222), blue: new THREE.Color(0x2255cc), white: new THREE.Color(0xdddddd) };
const HELMET_COL = { red: new THREE.Color(0x881111), blue: new THREE.Color(0x113399), white: new THREE.Color(0x888888) };

// Parts that get per-instance team color
const _TEAM_PARTS    = ['torso', 'hip', 'luArm', 'ruArm', 'lThigh', 'rThigh'];
const _HELMET_PARTS  = ['helmet'];

// ── Module state ──────────────────────────────────────────────────────────────
let _max   = 1200;
let _count = 0;
let _scene = null;
const _im  = {};          // key → InstancedMesh
let _allMeshes = [];      // flat list for bulk ops

// ── Hidden matrix (scale=0 collapses geometry to a point) ─────────────────────
const _HIDDEN = new THREE.Matrix4();
_HIDDEN.makeScale(0, 0, 0);

// ── Preallocated helpers (zero-alloc per-frame math) ──────────────────────────
const _root = new THREE.Matrix4();
const _al   = new THREE.Matrix4();  // left arm pivot
const _ar   = new THREE.Matrix4();  // right arm pivot
const _el   = new THREE.Matrix4();  // left elbow pivot
const _er   = new THREE.Matrix4();  // right elbow pivot
const _ll   = new THREE.Matrix4();  // left leg pivot
const _lr   = new THREE.Matrix4();  // right leg pivot
const _kl   = new THREE.Matrix4();  // left knee pivot
const _kr   = new THREE.Matrix4();  // right knee pivot
const _wp   = new THREE.Matrix4();  // weapon pivot
const _tmp  = new THREE.Matrix4();  // general scratch
const _t1   = new THREE.Matrix4();  // translation temp
const _t2   = new THREE.Matrix4();  // rotation temp
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _rv   = new THREE.Vector3();
const _SCALE1 = new THREE.Vector3(1, 1, 1);

// ── Init ───────────────────────────────────────────────────────────────────────

export function initRenderer(scene, maxAgents = 1200) {
  _max   = maxAgents;
  _count = 0;
  _scene = scene;

  const mk = (geo, mat) => {
    const im = new THREE.InstancedMesh(geo, mat, _max);
    im.count = 0;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow    = true;
    im.receiveShadow = false;
    // Hide all slots initially
    for (let i = 0; i < _max; i++) im.setMatrixAt(i, _HIDDEN);
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return im;
  };

  _im.head    = mk(G.head,      mSkin);
  _im.torso   = mk(G.torso,     mBase);
  _im.hip     = mk(G.hip,       mBase);
  _im.helmet  = mk(G.helmet,    mBase);
  _im.luArm   = mk(G.uArm,      mBase);
  _im.lfArm   = mk(G.fArm,      mSkin);
  _im.lHand   = mk(G.hand,      mSkin);
  _im.ruArm   = mk(G.uArm,      mBase);
  _im.rfArm   = mk(G.fArm,      mSkin);
  _im.rHand   = mk(G.hand,      mSkin);
  _im.lThigh  = mk(G.uLeg,      mBase);
  _im.lShin   = mk(G.lLeg,      mDark);
  _im.lFoot   = mk(G.foot,      mBoot);
  _im.rThigh  = mk(G.uLeg,      mBase);
  _im.rShin   = mk(G.lLeg,      mDark);
  _im.rFoot   = mk(G.foot,      mBoot);
  _im.sword   = mk(G.sword,     mSword);
  _im.sGuard  = mk(G.sGuard,    mDark);
  _im.knife   = mk(G.knife,     mSword);
  _im.kGuard  = mk(G.kGuard,    mDark);
  _im.gunBody = mk(G.gunBody,   mGunMetal);
  _im.gunStck = mk(G.gunStock,  mGunWood);
  _im.gunBrl  = mk(G.gunBarrel, mGunMetal);

  _allMeshes = Object.values(_im);

  // Pre-fill instanceColor buffers so no slot is ever uninitialized black
  const _white = new THREE.Color(1, 1, 1);
  for (const k of [..._TEAM_PARTS, ..._HELMET_PARTS]) {
    for (let i = 0; i < _max; i++) _im[k].setColorAt(i, _white);
    _im[k].instanceColor.needsUpdate = true;
  }
}

// ── Register a new agent (called once per createAgent) ─────────────────────────

export function registerAgent(agent) {
  if (_count >= _max) return; // cap
  agent.idx = _count++;

  const bc = BODY_COL[agent.team]   ?? BODY_COL.white;
  const hc = HELMET_COL[agent.team] ?? HELMET_COL.white;

  for (const k of _TEAM_PARTS)   { _im[k].setColorAt(agent.idx, bc); }
  for (const k of _HELMET_PARTS) { _im[k].setColorAt(agent.idx, hc); }
}

// ── Per-frame update ───────────────────────────────────────────────────────────

export function updateRenderer(agentsList) {
  const n = agentsList.length;

  for (let i = 0; i < n; i++) {
    const a = agentsList[i];

    if (a.isDoneDecaying()) {
      // Slot is inactive — keep hidden (was set to _HIDDEN in die() → no work needed)
      continue;
    }

    // ── Root matrix ──────────────────────────────────────────────────────────
    const deathRoll  = a.alive ? a._roll        : a._deathRoll;
    const deathSinkY = a.alive ? 0              : a._deathSinkY;
    const pitchVal   = a.alive ? a._pitch       : 0;

    _euler.set(pitchVal, a.facing, deathRoll, 'YXZ');
    _quat.setFromEuler(_euler);
    _rv.set(a.x, a.y + deathSinkY, a.z);
    _root.compose(_rv, _quat, _SCALE1);

    // ── Head ─────────────────────────────────────────────────────────────────
    _set(_im.head, i, _root, 0, 1.60, 0);

    // ── Torso + hip ───────────────────────────────────────────────────────────
    _set(_im.torso, i, _root, 0, 1.13, 0);
    _set(_im.hip,   i, _root, 0, 0.84, 0);

    // ── Helmet (battle agents only) ───────────────────────────────────────────
    if (a.team !== 'white') _set(_im.helmet, i, _root, 0, 1.665, 0);
    else                    _im.helmet.setMatrixAt(i, _HIDDEN);

    // ── Left arm ─────────────────────────────────────────────────────────────
    _mrx(_root, -0.295, 1.36, 0, a.lArmSwing, _al);
    _set(_im.luArm, i, _al, 0, -0.20, 0);
    _mrx(_al, 0, -0.40, 0, a.lElbowBend, _el);
    _set(_im.lfArm, i, _el, 0, -0.175, 0);
    _set(_im.lHand, i, _el, 0, -0.36,  0);

    // ── Right arm (X + optional Z rotation for fight stance) ─────────────────
    _mrx(_root, 0.295, 1.36, 0, a.rArmSwing, _ar);
    if (a.rArmZ !== 0) { _t2.makeRotationZ(a.rArmZ); _ar.multiply(_t2); }
    _set(_im.ruArm, i, _ar, 0, -0.20, 0);
    _mrx(_ar, 0, -0.40, 0, a.rElbowBend, _er);
    _set(_im.rfArm, i, _er, 0, -0.175, 0);
    _set(_im.rHand, i, _er, 0, -0.36,  0);

    // ── Weapon ────────────────────────────────────────────────────────────────
    _writeWeapon(a, i, _er);

    // ── Left leg ─────────────────────────────────────────────────────────────
    _mrx(_root, -0.13, 0.84, 0, a.lLegSwing, _ll);
    _set(_im.lThigh, i, _ll, 0, -0.22, 0);
    _mrx(_ll, 0, -0.44, 0, a.lKneeBend, _kl);
    _set(_im.lShin, i, _kl, 0, -0.20, 0);
    _set(_im.lFoot, i, _kl, 0, -0.42, 0.06);

    // ── Right leg ────────────────────────────────────────────────────────────
    _mrx(_root, 0.13, 0.84, 0, a.rLegSwing, _lr);
    _set(_im.rThigh, i, _lr, 0, -0.22, 0);
    _mrx(_lr, 0, -0.44, 0, a.rKneeBend, _kr);
    _set(_im.rShin, i, _kr, 0, -0.20, 0);
    _set(_im.rFoot, i, _kr, 0, -0.42, 0.06);
  }

  // Mark all matrices dirty and set draw count
  for (const im of _allMeshes) {
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  }
  // Flush instance colors (only meaningful data)
  for (const k of [..._TEAM_PARTS, ..._HELMET_PARTS]) {
    if (_im[k].instanceColor) _im[k].instanceColor.needsUpdate = true;
  }
}

// ── Reset (teardown / scenario switch) ────────────────────────────────────────

export function resetRenderer() {
  _count = 0;
  for (const im of _allMeshes) im.count = 0;
}

// ── Matrix helpers (zero-alloc) ───────────────────────────────────────────────

// result = parent * T(x,y,z) * Rx(rx)
function _mrx(parent, x, y, z, rx, result) {
  _t1.makeTranslation(x, y, z);
  result.multiplyMatrices(parent, _t1);
  if (rx !== 0) { _t1.makeRotationX(rx); result.multiply(_t1); }
}

// write parent * T(x,y,z) into instancedMesh slot i
function _set(im, i, parent, x, y, z) {
  _t1.makeTranslation(x, y, z);
  _tmp.multiplyMatrices(parent, _t1);
  im.setMatrixAt(i, _tmp);
}

function _writeWeapon(a, i, elbowMat) {
  // Weapon group origin: (0, -0.36, 0) from elbow pivot
  _t1.makeTranslation(0, -0.36, 0);
  _wp.multiplyMatrices(elbowMat, _t1);

  const w = a.weaponType;

  if (w === 'sword') {
    _set(_im.sword,   i, _wp, 0, 0.36, 0);
    _set(_im.sGuard,  i, _wp, 0, 0.02, 0);
    _im.knife.setMatrixAt(i,   _HIDDEN);
    _im.kGuard.setMatrixAt(i,  _HIDDEN);
    _im.gunBody.setMatrixAt(i, _HIDDEN);
    _im.gunStck.setMatrixAt(i, _HIDDEN);
    _im.gunBrl.setMatrixAt(i,  _HIDDEN);
  } else if (w === 'knife') {
    _set(_im.knife,   i, _wp, 0, 0.15, 0);
    _set(_im.kGuard,  i, _wp, 0, 0.02, 0);
    _im.sword.setMatrixAt(i,   _HIDDEN);
    _im.sGuard.setMatrixAt(i,  _HIDDEN);
    _im.gunBody.setMatrixAt(i, _HIDDEN);
    _im.gunStck.setMatrixAt(i, _HIDDEN);
    _im.gunBrl.setMatrixAt(i,  _HIDDEN);
  } else if (w === 'gun') {
    _set(_im.gunBody, i, _wp, 0.02, -0.18, 0.03);
    _set(_im.gunBrl,  i, _wp, 0.02, -0.43, 0.03);
    _set(_im.gunStck, i, _wp, 0.02,  0.10, -0.02);
    _im.sword.setMatrixAt(i,  _HIDDEN);
    _im.sGuard.setMatrixAt(i, _HIDDEN);
    _im.knife.setMatrixAt(i,  _HIDDEN);
    _im.kGuard.setMatrixAt(i, _HIDDEN);
  } else {
    _im.sword.setMatrixAt(i,   _HIDDEN);
    _im.sGuard.setMatrixAt(i,  _HIDDEN);
    _im.knife.setMatrixAt(i,   _HIDDEN);
    _im.kGuard.setMatrixAt(i,  _HIDDEN);
    _im.gunBody.setMatrixAt(i, _HIDDEN);
    _im.gunStck.setMatrixAt(i, _HIDDEN);
    _im.gunBrl.setMatrixAt(i,  _HIDDEN);
  }
}
