// Prop Attach (INF-4) — parent a small prop to a hand/head bone so it follows
// the character, and return it to its desk rest later.
//
// Used by BOTH the Motion Lab (calibration surface) and the Motion Director
// (0.9 microEvents: attach/detach at clip times). Pure THREE — no React, no VRM
// import; callers pass the prop container (a propsRoot child, `prop:<id>`) and
// the target bone node.
//
// IMPORTANT: attach to the *raw* humanoid bone (vrm.humanoid.getRawBoneNode),
// not the normalized one — the visible skinned mesh follows the raw skeleton,
// while the normalized rig is the parallel construct the motion layer writes to.
// A prop parented to the normalized hand would float away from the visible hand.

import * as THREE from 'three';

/** Grip transform in the bone's local space (meters / radians). */
export interface GripOffset {
  position: [number, number, number];
  /** Euler XYZ radians. */
  rotation: [number, number, number];
  /**
   * Optional uniform LOCAL scale while held. Omit to keep the prop's baked
   * desk scale (correct when the bone's world scale is ~1). Set this if the
   * raw bone carries a non-unit scale and the held prop comes out wrong-sized.
   */
  scale?: number;
}

interface PropHome {
  parent: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

// Remember each prop's desk rest (parent + local transform) the first time it is
// attached, so detach can restore it exactly. WeakMap so a scene reload (which
// disposes the old containers) doesn't leak.
const HOME = new WeakMap<THREE.Object3D, PropHome>();

const _euler = new THREE.Euler();

/**
 * Find a loaded prop container by its propId (e.g. "item:cup"), searching the
 * whole subtree of `root`. Recursive (not just direct children) so it still
 * finds a prop that is currently ATTACHED to a hand bone (i.e. reparented out
 * of propsRoot) — detach needs this. Pass a root that contains both propsRoot
 * and the VRM scene (e.g. the THREE scene).
 */
export function findPropContainer(root: THREE.Object3D, propId: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && (o.userData as { propId?: string }).propId === propId) found = o;
  });
  return found;
}

/** Whether this prop is currently attached (has a saved home it isn't sitting in). */
export function isPropAttached(prop: THREE.Object3D): boolean {
  const home = HOME.get(prop);
  return !!home && prop.parent !== home.parent;
}

/**
 * Reparent `prop` onto `bone` and place it by `offset` (bone-local). Saves the
 * prop's desk rest on first attach. Idempotent-ish: re-attaching just updates
 * the placement (home is preserved from the first call).
 */
export function attachPropToBone(prop: THREE.Object3D, bone: THREE.Object3D, offset: GripOffset): void {
  if (!HOME.has(prop)) {
    HOME.set(prop, {
      parent: prop.parent ?? prop,
      position: prop.position.clone(),
      quaternion: prop.quaternion.clone(),
      scale: prop.scale.clone(),
    });
  }
  bone.add(prop); // THREE keeps the prop's local values on add; we overwrite them next.
  prop.position.set(offset.position[0], offset.position[1], offset.position[2]);
  prop.quaternion.setFromEuler(_euler.set(offset.rotation[0], offset.rotation[1], offset.rotation[2], 'XYZ'));
  if (offset.scale !== undefined) prop.scale.setScalar(offset.scale);
}

/** Restore `prop` to its saved desk rest (parent + local transform). No-op if never attached. */
export function detachPropToHome(prop: THREE.Object3D): void {
  const home = HOME.get(prop);
  if (!home) return;
  home.parent.add(prop);
  prop.position.copy(home.position);
  prop.quaternion.copy(home.quaternion);
  prop.scale.copy(home.scale);
}
