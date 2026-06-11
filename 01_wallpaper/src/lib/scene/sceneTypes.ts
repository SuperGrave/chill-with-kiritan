// Scene / Props Probe 0.1 (Motion Probe 0.4) — Scene preset type definitions.
//
// A "Scene Preset" is a JSON-described stage the VRM stands on: 3D props
// (desk / chair / laptop …) placed around her in the SAME three.js scene, plus
// future-facing receivers for background layers, camera, and lighting.
//
// Everything here is framework-agnostic (NO THREE import) so the loader +
// validator (sceneLoader.ts, scenePresets.ts) can be unit-tested headless in
// Node, exactly like the 0.2/0.3 motion modules (idleStateMachine /
// externalMotionController). See memory: verify-webgl-probe-via-node.

export type Vec3 = [number, number, number];

export type PropFallback = 'box' | 'none';

// One placeable prop. Transforms are world-space (the propsRoot group sits at the
// origin, alongside the VRM). `rotation` is Euler XYZ in radians. `scale` doubles
// as the placeholder box's dimensions when a number triple, or a uniform factor.
export interface SceneProp {
  id: string;
  label?: string;
  type: 'glb';
  url: string;
  fallback: PropFallback; // normalized to 'box' by the loader
  position: Vec3;
  rotation: Vec3;
  scale: number | Vec3;
  visible: boolean; // normalized to true by the loader
  placeholderColor?: string; // hex for the fallback box
}

// Background layers are receivers only this phase (see REPORT §8): parsed and
// carried, but not composited yet. Kept so scene.json can grow without churn.
export interface SceneBackground {
  roomImage?: string | null;
  outsideImage?: string | null;
  lightOverlay?: string | null;
  windowVideo?: string | null;
}

export interface SceneCharacterPlacement {
  position: Vec3;
  rotation: Vec3;
  scale: number | Vec3;
}

// Camera block is parsed and reported, but the existing 1/2/3 camera modes stay
// authoritative this phase (see REPORT §6). `preset` may name an existing mode.
export interface SceneCameraPreset {
  preset?: string;
  position?: Vec3;
  target?: Vec3;
  fov?: number;
}

export interface SceneLighting {
  ambientStrength: number;
  mainLightColor: string;
  mainLightStrength: number;
}

export interface ScenePreset {
  sceneId: string;
  label: string;
  background?: SceneBackground;
  props: SceneProp[];
  character?: SceneCharacterPlacement;
  camera?: SceneCameraPreset;
  lighting?: SceneLighting;
}

// --- Load results (recorded for the debug UI / report) -----------------------

// Outcome of loading one prop.
//   ok               : the GLB loaded successfully
//   usedPlaceholder  : a placeholder box was shown instead (missing/broken GLB)
//   source           : what actually went into the scene
export interface PropLoadResult {
  id: string;
  ok: boolean;
  usedPlaceholder: boolean;
  visible: boolean; // own JSON visibility (toggles applied separately)
  source: 'glb' | 'placeholder' | 'skipped';
  error?: string;
}

// Outcome of loading a whole scene preset. `usedDefault` => scene.json was
// missing/malformed and the built-in default scene was substituted.
export interface SceneLoadResult {
  sceneId: string;
  ok: boolean;
  usedDefault: boolean;
  warnings: string[];
  source: 'fetched' | 'default';
}

// Aggregated status the viewer reports to the UI on each (re)load. Reported once
// per load (NOT per frame) so it surfaces even in the hidden preview tab where
// the rAF loop is throttled (see memory: verify-webgl-probe-via-node).
export interface SceneDebug {
  sceneId: string;
  label: string;
  sceneOk: boolean;
  usedDefault: boolean;
  propTotal: number;
  propLoaded: number; // ok === true
  propMissing: number; // ok === false (placeholder + skipped)
  placeholders: number; // usedPlaceholder === true
  propsEnabled: boolean;
  placeholdersEnabled: boolean;
  warnings: string[];
  results: PropLoadResult[];
  // Background layer descriptor (Background Probe 0.5). Carried through to the
  // React HTML/CSS background layer (NOT rendered in three.js). May be undefined
  // when the scene omits a background block.
  background?: SceneBackground;
}
