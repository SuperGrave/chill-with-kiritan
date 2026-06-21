// .vrma loader wrapper (Motion Probe 0.3)
//
// Loads a user-supplied VRM Animation (`.vrma`, the VRMC_vrm_animation glTF
// extension) via @pixiv/three-vrm-animation and retargets it onto the loaded
// VRM with createVRMAnimationClip. That helper already handles VRM 0.x <-> 1.0
// coordinate differences (it negates X/Z for metaVersion '0'), so a `.vrma`
// authored for VRM 1.0 retargets correctly onto this VRM 0.x model's normalized
// humanoid rig.
//
// We then FILTER the resulting clip down to humanoid bone rotations only:
//   * `.weight` (expression) tracks      -> stripped. The 0.1 Custom Expression
//     Bridge owns expressions; we only LOG that the clip carried them.
//   * `.position` (hips root motion)     -> stripped, to keep her planted as
//     wallpaper (logged).
//   * lookAt proxy `.quaternion`         -> stripped. Our VRMLookAt owns gaze.
// Only normalized-bone `.quaternion` tracks survive and reach the AnimationMixer.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';

export interface LoadedVrmaClip {
  clip: THREE.AnimationClip; // bone-rotation tracks only
  boneNames: string[]; // humanoid bone names the clip drives
  source: 'vrma';
  hasExpressionTracks: boolean; // detected in the raw clip (ignored, logged)
  strippedExpressionTracks: number;
  strippedPositionTracks: number;
  strippedOtherTracks: number; // e.g. lookAt proxy
  duration: number;
}

function trackNodeName(trackName: string): string {
  const i = trackName.lastIndexOf('.');
  return i >= 0 ? trackName.slice(0, i) : trackName;
}

function trackProperty(trackName: string): string {
  const i = trackName.lastIndexOf('.');
  return i >= 0 ? trackName.slice(i + 1) : '';
}

export async function loadVrmaClip(url: string, vrm: VRM): Promise<LoadedVrmaClip> {
  const loader = new GLTFLoader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader.register((parser: any) => new VRMAnimationLoaderPlugin(parser));

  // Pre-create the LookAt proxy so createVRMAnimationClip doesn't warn / mutate
  // the scene implicitly. We strip its track anyway, but this keeps it tidy.
  if (vrm.lookAt && !vrm.scene.children.find((o) => o instanceof VRMLookAtQuaternionProxy)) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'VRMLookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }

  const gltf = await loader.loadAsync(url);
  const vrmAnimations = gltf.userData.vrmAnimations as unknown[] | undefined;
  if (!vrmAnimations || vrmAnimations.length === 0) {
    throw new Error('No VRMC_vrm_animation extension found in the file.');
  }

  const rawClip = createVRMAnimationClip(vrmAnimations[0] as never, vrm);

  // Reverse map: normalized bone node.name -> humanoid bone name.
  const nodeNameToBone = new Map<string, string>();
  const humanBones = vrm.humanoid ? Object.keys((vrm.humanoid as { humanBones: object }).humanBones) : [];
  for (const bone of humanBones) {
    const node = vrm.humanoid?.getNormalizedBoneNode(bone as never);
    if (node) nodeNameToBone.set(node.name, bone);
  }

  const keptTracks: THREE.KeyframeTrack[] = [];
  const boneNames: string[] = [];
  let strippedExpressionTracks = 0;
  let strippedPositionTracks = 0;
  let strippedOtherTracks = 0;

  for (const track of rawClip.tracks) {
    const prop = trackProperty(track.name);
    const node = trackNodeName(track.name);
    if (prop === 'weight') {
      strippedExpressionTracks++;
    } else if (prop === 'position') {
      strippedPositionTracks++;
    } else if (prop === 'quaternion' && nodeNameToBone.has(node)) {
      keptTracks.push(track);
      boneNames.push(nodeNameToBone.get(node)!);
    } else {
      // lookAt proxy quaternion or anything else we don't drive.
      strippedOtherTracks++;
    }
  }

  const clip = new THREE.AnimationClip(rawClip.name || 'vrma_clip', rawClip.duration, keptTracks);

  return {
    clip,
    boneNames,
    source: 'vrma',
    hasExpressionTracks: strippedExpressionTracks > 0,
    strippedExpressionTracks,
    strippedPositionTracks,
    strippedOtherTracks,
    duration: rawClip.duration,
  };
}
