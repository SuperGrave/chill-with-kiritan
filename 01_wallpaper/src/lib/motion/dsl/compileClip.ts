// Motion DSL — THREE adapter (Motion Probe 0.7)
//
// Samples a MotionEvaluator into a THREE.AnimationClip with the exact same
// track-naming convention as proceduralClip.ts / vrmaClip.ts
// (`${normalizedBoneNode.name}.quaternion`), so a DSL clip flows through the
// SAME AnimationMixer + blend path in VrmViewer as a `.vrma`.
//
// Layer composition per bone (see evaluate.ts): Q = Qposture * Qhand * Qoffset.
// The result is the bone's ABSOLUTE normalized-rig local rotation, baked per
// sample. NOTE: the posture's hipsOffset (position) is deliberately NOT baked
// into the clip — the runtime mixer path is rotations-only as of 0.7
// (consistent with vrmaClip stripping position tracks); the Lab preview applies
// hipsOffset directly, and the Motion Director (0.9) will own posture properly.

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
}

const SAMPLE_FPS = 20; // slerp between samples smooths; calm motions don't need more

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
  return { clip, boneNames, source: 'dsl', hasExpressionTracks: false, missingBones };
}
