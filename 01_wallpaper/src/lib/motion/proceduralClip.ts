// Built-in procedural AnimationClip (Motion Probe 0.3)
//
// When no user-supplied `.vrma` is present, this generates a small, seamless
// THREE.AnimationClip in code so the external-clip layer can still be exercised
// end-to-end (AnimationMixer playback + crossfade + compose-order verification).
//
// It only animates HEAD / NECK / CHEST / SPINE — deliberately NO arm/shoulder/
// hand tracks — so the built-in clip can never reintroduce a T-pose. The motion
// is a gentle "look around + nod", clearly distinct from the 0.2 idle breath so
// the takeover is visible.
//
// Track-naming convention matches @pixiv/three-vrm-animation's
// createVRMAnimationClip exactly: each track is `${normalizedBoneNode.name}.
// quaternion`, bound against vrm.scene. So the built-in clip and a real `.vrma`
// flow through the *same* AnimationMixer + blend path in VrmViewer.

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export interface BuiltClip {
  clip: THREE.AnimationClip;
  // Humanoid bone names this clip drives (used by the viewer to cache rest
  // quaternions and to route bones through the idle-additive vs clip-only path).
  boneNames: string[];
  source: 'builtin';
  hasExpressionTracks: boolean;
}

// Bones the built-in clip is allowed to touch (all are also 0.2 idle bones, so
// the idle breath rides additively on top of them via the viewer's blend).
const CLIP_BONES = ['spine', 'chest', 'neck', 'head'] as const;

const PERIOD = 4.0; // seconds — full seamless loop
const FPS = 15; // keyframe sampling rate (slerp smooths between samples)

// Per-bone offset eulers (radians) as a pure function of loop phase. All terms
// use integer multiples of the base frequency so value(PERIOD) === value(0)
// (seamless loop). Constants (bias) are loop-safe too.
function boneEuler(bone: (typeof CLIP_BONES)[number], t: number): THREE.Euler {
  const w = (2 * Math.PI) / PERIOD; // 1 cycle / loop
  switch (bone) {
    case 'head':
      return new THREE.Euler(
        0.05 * Math.sin(2 * w * t) - 0.02, // gentle double-nod, slight look-down bias
        0.2 * Math.sin(w * t), // yaw: look left <-> right
        0.04 * Math.sin(w * t + Math.PI / 2), // slight roll synced with the turn
        'XYZ',
      );
    case 'neck':
      return new THREE.Euler(0.03 * Math.sin(2 * w * t), 0.1 * Math.sin(w * t), 0, 'XYZ');
    case 'chest':
      return new THREE.Euler(0.025 * Math.sin(w * t), 0, 0, 'XYZ');
    case 'spine':
      return new THREE.Euler(0, 0.05 * Math.sin(w * t), 0, 'XYZ'); // slight torso twist with the turn
    default:
      return new THREE.Euler(0, 0, 0, 'XYZ');
  }
}

export function buildProceduralClip(vrm: VRM): BuiltClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const boneNames: string[] = [];

  const sampleCount = Math.round(PERIOD * FPS); // last sample == first (loop close)
  const times = new Float32Array(sampleCount + 1);
  for (let i = 0; i <= sampleCount; i++) times[i] = (i / sampleCount) * PERIOD;

  const q = new THREE.Quaternion();

  for (const bone of CLIP_BONES) {
    const node = vrm.humanoid?.getNormalizedBoneNode(bone as never);
    if (!node) continue;

    const values = new Float32Array((sampleCount + 1) * 4);
    for (let i = 0; i <= sampleCount; i++) {
      q.setFromEuler(boneEuler(bone, times[i]));
      values[i * 4 + 0] = q.x;
      values[i * 4 + 1] = q.y;
      values[i * 4 + 2] = q.z;
      values[i * 4 + 3] = q.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, Array.from(times), Array.from(values)));
    boneNames.push(bone);
  }

  const clip = new THREE.AnimationClip('builtin_look_around', PERIOD, tracks);
  return { clip, boneNames, source: 'builtin', hasExpressionTracks: false };
}
