// Scene / Props Probe 0.1 (Motion Probe 0.4) — built-in scene registry + default.
//
// The built-in default scene is the safety net required by the brief's top
// directive: "the app must NOT crash when a prop GLB (or the whole scene.json)
// is absent". If public/scenes/<id>/scene.json can't be fetched or parsed,
// sceneLoader falls back to buildDefaultScene() — which mirrors the shipped
// room_workdesk_day, so missing asset files still yield placeholder boxes in
// roughly the right places. NO THREE import (Node-testable).

import type { ScenePreset } from './sceneTypes';

export const DEFAULT_SCENE_ID = 'room_workdesk_day';

// Scene ids the UI knows about. One real preset this phase; the default below
// backs it when scene.json is missing.
export const KNOWN_SCENE_IDS = ['room_workdesk_day'] as const;

// Built-in fallback preset, used ONLY when public/scenes/<id>/scene.json can't be
// fetched/parsed (see sceneLoader). It is intentionally NOT byte-identical to that
// shipped file and they have diverged since the real GLBs landed: the prop
// transforms here are placeholder-box dimensions (non-uniform slab sizes) chosen so
// the fallback boxes land in roughly the right places when the GLBs are absent,
// whereas scene.json uses uniform scales tuned for the actual CC0 GLBs (e.g. desk
// scale 1.9 vs the slab [1.4,0.12,0.55] below). Treat this as a "roughly-right
// safety net", not a mirror of scene.json. The label is also marked "built-in".
export function buildDefaultScene(sceneId: string = DEFAULT_SCENE_ID): ScenePreset {
  return {
    sceneId,
    label: '自室・昼・作業机 (built-in default)',
    background: { roomImage: null, outsideImage: null, lightOverlay: null, windowVideo: null },
    props: [
      {
        id: 'desk',
        label: 'Desk',
        type: 'glb',
        url: '/models/props/desk.glb',
        fallback: 'box',
        position: [0.0, -0.85, -0.45],
        rotation: [0.0, 0.0, 0.0],
        scale: [1.4, 0.12, 0.55],
        visible: true,
        placeholderColor: '#6b4a32',
      },
      {
        id: 'chair',
        label: 'Chair',
        type: 'glb',
        url: '/models/props/chair.glb',
        fallback: 'box',
        position: [0.0, -0.9, 0.15],
        rotation: [0.0, 0.0, 0.0],
        scale: [0.65, 0.8, 0.55],
        visible: true,
        placeholderColor: '#333333',
      },
      {
        id: 'laptop',
        label: 'Laptop',
        type: 'glb',
        url: '/models/props/laptop.glb',
        fallback: 'box',
        position: [0.28, -0.35, -0.62],
        rotation: [0.0, 0.25, 0.0],
        scale: [0.45, 0.05, 0.32],
        visible: true,
        placeholderColor: '#202020',
      },
    ],
    character: { position: [0.0, 0.0, 0.0], rotation: [0.0, 0.0, 0.0], scale: [1.0, 1.0, 1.0] },
    camera: { preset: 'monitor_side', position: [0.4, 0.9, 0.8], target: [0.0, 1.0, 0.0], fov: 40 },
    lighting: { ambientStrength: 0.8, mainLightColor: '#ffffff', mainLightStrength: 1.0 },
  };
}
