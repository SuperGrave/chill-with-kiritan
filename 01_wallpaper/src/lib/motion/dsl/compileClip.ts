// Motion DSL — THREE adapter (Motion Probe 0.7)
//
// Samples a MotionEvaluator into a THREE.AnimationClip with the exact same
// track-naming convention as proceduralClip.ts / vrmaClip.ts
// (`${normalizedBoneNode.name}.quaternion`), so a DSL clip flows through the
// SAME AnimationMixer + blend path in VrmViewer as a `.vrma`.
//
// Layer composition per bone (see evaluate.ts): Q = Qposture * Qhand * Qoffset.
// The result is the bone's ABSOLUTE normalized-rig local rotation, baked per
// sample. The mixer path stays rotations-only (no hips POSITION track, like
// vrmaClip strips position tracks); instead the posture's constant hipsOffset
// is exposed as clip metadata so the viewer can apply it to hips.position each
// frame, scaled by the external-clip weight (Phase 0 試験B: a seated pose with
// no hip-drop sits ~0.2 m too high and the legs poke above the desk). DSL
// motions never animate hips, so a single offset sampled at t=0 is exact.

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { MotionEvaluator, BoneLayers } from './evaluate';

export interface CompiledDslClip {
  clip: THREE.AnimationClip;
  boneNames: string[];
  source: 'dsl';
  hasExpressionTracks: boolean; // always false — expressions stay runtime-side
  /** Bones the motion wanted but the model doesn't have (e.g. upperChest). */
  missingBones: string[];
  /**
   * Posture hips-position offset (meters, normalized rig), constant for the
   * motion. The viewer applies it to hips.position scaled by clip weight —
   * NOT baked into the clip's tracks (rotations only). [0,0,0] when no posture.
   * For motions whose hips ANIMATE (hipsTrack), this holds the t=0 value and
   * `hipsCurve` carries the full trajectory.
   */
  hipsOffset: [number, number, number];
  /**
   * Sampled hips-position trajectory (meters) for motions whose hips animate
   * over time (INF-3 stand/sit/step). null when the hips are constant — the
   * viewer then uses `hipsOffset`. Sampled at SAMPLE_FPS, linearly
   * interpolatable (the source curve is already eased by the evaluator).
   */
  hipsCurve: { times: number[]; values: [number, number, number][] } | null;
  /**
   * Sampled root-motion trajectory [x,y,z, rotY] (INF-7) for motions that move
   * the whole character (walk/step/turn). null when the root never moves. The
   * viewer applies it to vrm.scene at clip-local time, scaled by clip weight.
   */
  rootCurve: { times: number[]; values: [number, number, number, number][] } | null;
}

// slerp between samples smooths; 30 keeps tremor-class noise layers (~5 Hz,
// see Oscillator.kind 'noise') above ~6 samples/cycle. 20 was fine for calm
// keyframe-only motions but aliases a 0.2 s-period quiver.
const SAMPLE_FPS = 30;

const _qPosture = new THREE.Quaternion();
const _qHand = new THREE.Quaternion();
const _qOffset = new THREE.Quaternion();
const _euler = new THREE.Euler();

export function composeBoneQuaternion(layers: BoneLayers, out: THREE.Quaternion): THREE.Quaternion {
  out.identity();
  if (layers.posture) {
    _qPosture.setFromEuler(_euler.set(layers.posture[0], layers.posture[1], layers.posture[2], 'XYZ'));
    out.multiply(_qPosture);
  }
  if (layers.hand) {
    _qHand.setFromEuler(_euler.set(layers.hand[0], layers.hand[1], layers.hand[2], 'XYZ'));
    out.multiply(_qHand);
  }
  if (layers.offset) {
    _qOffset.setFromEuler(_euler.set(layers.offset[0], layers.offset[1], layers.offset[2], 'XYZ'));
    out.multiply(_qOffset);
  }
  return out;
}

export function compileDslClip(evaluator: MotionEvaluator, vrm: VRM): CompiledDslClip {
  const sampleCount = Math.max(2, Math.round(evaluator.duration * SAMPLE_FPS));
  const times = new Float32Array(sampleCount + 1);
  for (let i = 0; i <= sampleCount; i++) times[i] = (i / sampleCount) * evaluator.duration;

  // Evaluate once per sample, then split into per-bone tracks.
  const frames = Array.from(times, (t) => evaluator.evalAt(Math.min(t, evaluator.duration - 1e-6)));

  const tracks: THREE.KeyframeTrack[] = [];
  const boneNames: string[] = [];
  const missingBones: string[] = [];
  const q = new THREE.Quaternion();

  for (const bone of evaluator.boneNames) {
    const node = vrm.humanoid?.getNormalizedBoneNode(bone as never);
    if (!node) {
      missingBones.push(bone);
      continue;
    }
    const values = new Float32Array((sampleCount + 1) * 4);
    for (let i = 0; i <= sampleCount; i++) {
      const layers = frames[i].bones[bone] ?? {};
      composeBoneQuaternion(layers, q);
      values[i * 4 + 0] = q.x;
      values[i * 4 + 1] = q.y;
      values[i * 4 + 2] = q.z;
      values[i * 4 + 3] = q.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, Array.from(times), Array.from(values)));
    boneNames.push(bone);
  }

  const clip = new THREE.AnimationClip(`dsl_${evaluator.id}`, evaluator.duration, tracks);
  // Hips position: constant from the posture in most motions; a stand/sit/step
  // transition (hipsTrack, INF-3) animates it. Detect variation across the
  // samples — if it moves, emit the full trajectory as hipsCurve; else just the
  // t=0 constant (keeps loops/static motions lightweight).
  const hipsOffset = [...frames[0].hipsOffset] as [number, number, number];
  let hipsVaries = false;
  for (const f of frames) {
    if (
      Math.abs(f.hipsOffset[0] - hipsOffset[0]) > 1e-4 ||
      Math.abs(f.hipsOffset[1] - hipsOffset[1]) > 1e-4 ||
      Math.abs(f.hipsOffset[2] - hipsOffset[2]) > 1e-4
    ) {
      hipsVaries = true;
      break;
    }
  }
  const hipsCurve = hipsVaries
    ? { times: Array.from(times), values: frames.map((f) => [...f.hipsOffset] as [number, number, number]) }
    : null;
  // Root motion (INF-7): emit the trajectory only when it actually moves.
  let rootVaries = false;
  for (const f of frames) {
    if (f.root[0] !== 0 || f.root[1] !== 0 || f.root[2] !== 0 || f.root[3] !== 0) {
      rootVaries = true;
      break;
    }
  }
  const rootCurve = rootVaries
    ? { times: Array.from(times), values: frames.map((f) => [...f.root] as [number, number, number, number]) }
    : null;
  return { clip, boneNames, source: 'dsl', hasExpressionTracks: false, missingBones, hipsOffset, hipsCurve, rootCurve };
}
