// Pose Composer 0.8 — pose math (Stage 4)
//
// The basis conversion at the heart of saving/loading, kept THREE-math-only so
// it is directly unit-testable in Node (tools/test_pose_math.mjs). This is the
// piece the master flagged as correctness-critical (テスト最優先): the authoring
// override lives in the REFERENCE basis (arm-dropped rest), but a pose/1 asset
// stores T-POSE-ABSOLUTE eulers (identity basis), the same convention the Motion
// DSL's `posture` layer uses. Getting the round-trip exactly right is what keeps
// a saved pose visually identical when reloaded or consumed as a motion posture.
//
// Two bases (audit §2.2 / §3.2):
//   * reference  = viewer initialRotations (arms dropped ±1.2). The composer edits
//                  bone -> OFFSET quaternion relative to this (identity = at rest).
//   * T-pose     = the normalized bone's identity local. pose/1 euler is measured
//                  from HERE, so an unedited arm still reads ~±1.15 (its drop).
//
// The bone's final LOCAL quaternion (what actually renders) is the bridge:
//     absoluteLocal = referenceQ · offsetQ            (compose, every frame)
//     poseEuler     = eulerXYZ(absoluteLocal)          (SAVE: reference→T-pose abs)
//     offsetQ       = inv(referenceQ) · quat(poseEuler) (LOAD: T-pose abs→reference)

import * as THREE from 'three';

const EULER_ORDER = 'XYZ' as const; // matches the DSL compose + composer editing.

// Module-scope scratch (pure functions, single-threaded — never aliased across calls).
const _e = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _identity = new THREE.Quaternion();

/** XYZ euler (radians) -> quaternion. */
export function eulerToQuat(e: readonly [number, number, number], out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromEuler(_e.set(e[0], e[1], e[2], EULER_ORDER));
}

/** Quaternion -> XYZ euler (radians) as a plain triple. */
export function quatToEuler(q: THREE.Quaternion): [number, number, number] {
  _e.setFromQuaternion(q, EULER_ORDER);
  return [_e.x, _e.y, _e.z];
}

/** absoluteLocal = referenceQ · offsetQ (the rendered local rotation). */
export function offsetToAbsoluteLocal(refQ: THREE.Quaternion, offsetQ: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.copy(refQ).multiply(offsetQ).normalize();
}

/** offsetQ = inv(referenceQ) · absoluteLocal (invert the compose). */
export function absoluteLocalToOffset(refQ: THREE.Quaternion, absQ: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.copy(refQ).invert().multiply(absQ).normalize();
}

/**
 * SAVE: reference-relative offset -> T-pose-absolute pose/1 euler.
 * poseEuler = eulerXYZ(referenceQ · offsetQ). Pass offsetQ = identity for an
 * unedited bone (its absolute local is still referenceQ, e.g. the arm drop).
 */
export function poseEulerFromOffset(refQ: THREE.Quaternion, offsetQ: THREE.Quaternion): [number, number, number] {
  offsetToAbsoluteLocal(refQ, offsetQ, _qa);
  return quatToEuler(_qa);
}

/**
 * LOAD: T-pose-absolute pose/1 euler -> reference-relative offset quaternion.
 * offsetQ = inv(referenceQ) · quat(poseEuler).
 */
export function offsetFromPoseEuler(refQ: THREE.Quaternion, poseEuler: readonly [number, number, number], out = new THREE.Quaternion()): THREE.Quaternion {
  eulerToQuat(poseEuler, _qb);
  return absoluteLocalToOffset(refQ, _qb, out);
}

/** True when a quaternion is (numerically) the identity rotation. */
export function isIdentityQuat(q: THREE.Quaternion, eps = 1e-6): boolean {
  // |dot(q, identity)| == |q.w| == 1 for the identity (and its -1 twin).
  return Math.abs(Math.abs(q.dot(_identity)) - 1) <= eps;
}

/** True when two quaternions describe the same rotation (q ≡ -q double-cover). */
export function quatsEqual(a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-6): boolean {
  return Math.abs(Math.abs(a.dot(b)) - 1) <= eps;
}
