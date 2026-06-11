// Scene / Props Probe 0.1 (Motion Probe 0.4) — placeholder prop meshes.
//
// When a prop's GLB is missing/broken (and its fallback is "box"), the loader
// substitutes one of these so the app keeps running and the prop's slot is still
// visible for front/back + depth + camera-fit checks (brief §4, §7). It is a
// plain semi-transparent BoxGeometry — the point is placement, NOT looks.
//
// The box is a unit cube (1×1×1); propLoader applies the prop's position /
// rotation / scale to the wrapping container, so `scale` doubles as the box's
// dimensions (e.g. desk scale [1.4, 0.12, 0.55] => a 1.4×0.12×0.55 slab).

import * as THREE from 'three';
import type { SceneProp } from './sceneTypes';

// Fallback tints when a prop omits placeholderColor, keyed by the common ids.
const DEFAULT_COLORS: Record<string, string> = {
  desk: '#6b4a32',
  chair: '#333333',
  laptop: '#202020',
};

// Build a placeholder box mesh for one prop. The caller (propLoader) wraps it in
// a container Group and applies the transform, so this only owns geometry +
// material. Semi-transparent so it reads as scaffolding, but depthWrite stays on
// (three's default) so occlusion vs. the VRM body is still demonstrable.
export function createPlaceholderProp(prop: SceneProp): THREE.Mesh {
  const color = prop.placeholderColor ?? DEFAULT_COLORS[prop.id] ?? '#808080';
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.6,
    roughness: 0.9,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `placeholder:${prop.id}`;
  mesh.userData.isPlaceholderMesh = true;
  return mesh;
}
