// Scene / Props Probe 0.1 (Motion Probe 0.4) — prop GLB loader.
//
// Role (per brief §3):
//   * load each prop's GLB via the GLTFLoader passed in
//   * apply position / rotation / scale / visible
//   * on failure, substitute a placeholder box (fallback "box") or skip it
//     (fallback "none") — the app must NEVER crash on a missing asset
//   * record a PropLoadResult per prop
//
// Props load INDEPENDENTLY of the VRM (the viewer kicks this off separately), so
// a missing prop never blocks the character. Imports THREE (for Group/Mesh
// transforms + disposal) but NOT the GLTFLoader itself — the loader is injected
// as a structural `PropGltfLoader`, which keeps this module headless-friendly
// and lets the viewer reuse whichever loader it already has.

import * as THREE from 'three';
import type { SceneProp, PropLoadResult } from './sceneTypes';
import { createPlaceholderProp } from './placeholderProps';

// Structural slice of three's GLTFLoader we actually use (avoids the ts-ignored
// example-module import leaking into this file's types).
export interface PropGltfLoader {
  loadAsync(url: string): Promise<{ scene: THREE.Object3D }>;
}

export interface LoadPropsOptions {
  propsEnabled: boolean;
  placeholdersEnabled: boolean;
}

function applyTransform(obj: THREE.Object3D, prop: SceneProp): void {
  obj.position.set(prop.position[0], prop.position[1], prop.position[2]);
  obj.rotation.set(prop.rotation[0], prop.rotation[1], prop.rotation[2]);
  if (typeof prop.scale === 'number') obj.scale.setScalar(prop.scale);
  else obj.scale.set(prop.scale[0], prop.scale[1], prop.scale[2]);
}

// Wrap a prop's visual (GLB scene or placeholder) in a container Group, apply
// the transform, and tag it so toggles + clears can find it later.
function wrap(child: THREE.Object3D, prop: SceneProp, usedPlaceholder: boolean): THREE.Group {
  const container = new THREE.Group();
  container.add(child);
  applyTransform(container, prop);
  container.name = `prop:${prop.id}`;
  container.userData.propId = prop.id;
  container.userData.usedPlaceholder = usedPlaceholder;
  container.userData.ownVisible = prop.visible;
  return container;
}

function makePlaceholder(prop: SceneProp, error: string): { object: THREE.Object3D | null; result: PropLoadResult } {
  if (prop.fallback === 'none') {
    return { object: null, result: { id: prop.id, ok: false, usedPlaceholder: false, visible: false, source: 'skipped', error } };
  }
  return {
    object: wrap(createPlaceholderProp(prop), prop, true),
    result: { id: prop.id, ok: false, usedPlaceholder: true, visible: prop.visible, source: 'placeholder', error },
  };
}

// Some prop GLBs ship their own punctual lights / cameras straight from the
// authoring tool. items/controller.glb carried a POINT LIGHT at intensity 1000
// (KHR_lights_punctual), which three instantiates verbatim — in physical light
// units that floods the whole scene to white the moment the controller loads
// ("コントローラーを出すと画面が白飛び"). Props are passive geometry: the scene
// owns all lighting and the render camera. Strip both on load so no prop, now or
// later, can inject them. Light/camera nodes carry no geometry/material to free.
function stripLightsAndCameras(root: THREE.Object3D): number {
  const doomed: THREE.Object3D[] = [];
  root.traverse((o) => {
    const node = o as THREE.Object3D & { isLight?: boolean; isCamera?: boolean };
    if (node.isLight || node.isCamera) doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();
  return doomed.length;
}

// Load one prop. Never throws — resolves to a placeholder/skip on any problem.
async function loadOneProp(prop: SceneProp, loader: PropGltfLoader): Promise<{ object: THREE.Object3D | null; result: PropLoadResult }> {
  if (!prop.url) return makePlaceholder(prop, 'no url');
  try {
    const gltf = await loader.loadAsync(prop.url);
    const stripped = stripLightsAndCameras(gltf.scene);
    if (stripped > 0) console.info(`[PROP] ${prop.id}: removed ${stripped} embedded light/camera node(s) from the GLB`);
    const container = wrap(gltf.scene, prop, false);
    return { object: container, result: { id: prop.id, ok: true, usedPlaceholder: false, visible: prop.visible, source: 'glb' } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return makePlaceholder(prop, msg);
  }
}

// Dispose + detach every child of `parent` (geometries and materials), so a
// scene reload doesn't leak GPU resources.
export function clearProps(parent: THREE.Object3D): void {
  for (let i = parent.children.length - 1; i >= 0; i--) {
    const child = parent.children[i];
    parent.remove(child);
    child.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }
}

// Resolve visibility for every loaded prop from the current toggles.
//   * Toggle Props OFF  -> hide the whole group (incl. placeholders) at once.
//   * Toggle Placeholders OFF -> hide only placeholder boxes; real GLBs stay.
//   * a prop's own JSON `visible:false` always hides it.
export function applyPropVisibility(parent: THREE.Object3D, opts: LoadPropsOptions): void {
  parent.visible = opts.propsEnabled;
  for (const child of parent.children) {
    const ud = child.userData as { ownVisible?: boolean; usedPlaceholder?: boolean };
    const own = ud.ownVisible !== false;
    const isPlaceholder = ud.usedPlaceholder === true;
    child.visible = own && (isPlaceholder ? opts.placeholdersEnabled : true);
  }
}

// Clear `parent`, load all props into it (in parallel), apply visibility, and
// return one result per prop. Always resolves.
export async function loadSceneProps(
  props: SceneProp[],
  parent: THREE.Object3D,
  loader: PropGltfLoader,
  opts: LoadPropsOptions,
): Promise<PropLoadResult[]> {
  clearProps(parent);
  const loaded = await Promise.all(props.map((p) => loadOneProp(p, loader)));
  const results: PropLoadResult[] = [];
  for (const { object, result } of loaded) {
    if (object) parent.add(object);
    results.push(result);
  }
  applyPropVisibility(parent, opts);
  return results;
}
