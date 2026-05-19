/**
 * physics.js — Rapier physics world initialization.
 * Uses the WASM-compatible compat build so no async setup is needed after init.
 */

import RAPIER from '@dimforge/rapier3d-compat';

let world = null;
let rapier = null;

/** Initialize Rapier WASM and create the physics world with gravity. */
export async function initPhysics() {
  await RAPIER.init();
  rapier = RAPIER;
  world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  return { world, RAPIER };
}

/** Step the physics world forward by dt seconds (called in the fixed-step loop). */
export function stepPhysics() {
  if (world) world.step();
}

/** Create a static ground collider at y=0 (infinite plane). */
export function createGroundCollider() {
  const groundDesc = rapier.ColliderDesc.cuboid(200, 0.1, 200).setTranslation(0, -0.1, 0);
  world.createCollider(groundDesc);
}

/**
 * Create a kinematic capsule rigid body + collider for an agent.
 * Returns { rigidBody, collider }.
 */
export function createAgentBody(x, y, z) {
  const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z);
  const rigidBody = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.capsule(0.75, 0.5);
  const collider = world.createCollider(colliderDesc, rigidBody);
  return { rigidBody, collider };
}

/** Remove a rigid body from the world (on agent death). */
export function removeBody(rigidBody) {
  if (world && rigidBody) {
    world.removeRigidBody(rigidBody);
  }
}

export function getWorld() { return world; }
export function getRapier() { return rapier; }
