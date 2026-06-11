// Scene Layout Calibration Probe 0.6 (Motion Probe 0.6) — pure layout core.
//
// Calibration tooling for positioning character / desk / chair / laptop / camera
// so the "Chill Room" composition reads correctly: the desk front edge sits in
// front of the body/arms, the laptop rests on the desk, the chair shows behind,
// the monitor-side angle faces the wallpaper, the face + upper body are visible,
// and UI margin is left for later.
//
// This module is the PURE core: the target list, per-target transform state, the
// keyboard-nudge math, and scene.json export formatting. It has NO THREE / NO
// React import, so it is unit-tested headless in Node (see memory:
// verify-webgl-probe-via-node). The live 3D binding — applying these transforms
// to three.js objects, driving the camera, and the visual guides — lives in
// VrmViewer (layoutGuides.ts for the helper meshes).

import type { Vec3 } from './sceneTypes';

// Selectable calibration targets, in cycle order ([ = prev, ] = next).
export const LAYOUT_TARGETS = ['character', 'desk', 'chair', 'laptop', 'camera'] as const;
export type LayoutTargetId = (typeof LAYOUT_TARGETS)[number];
// Everything except the camera is a placeable transform (position/rotation/scale).
export type PropTargetId = Exclude<LayoutTargetId, 'camera'>;

export const LAYOUT_TARGET_LABELS: Record<LayoutTargetId, string> = {
  character: 'Character (きりたん)',
  desk: 'Desk',
  chair: 'Chair',
  laptop: 'Laptop',
  camera: 'Camera',
};

// One key press steps. Position/scale in scene units; rotation in radians.
export const POS_STEP = 0.05;
export const ROT_STEP = Math.PI / 36; // 5°
export const SCALE_FACTOR = 1.05; // multiplicative per press (keeps proportions)
export const CAM_PAN_STEP = 0.05;
export const CAM_DOLLY_STEP = 0.08;

// A placeable transform. `scale` is stored as xyz internally so non-uniform slab
// placeholders can be edited; export collapses it to a single number when uniform.
export interface TransformEntry {
  position: Vec3;
  rotation: Vec3; // Euler XYZ, radians
  scale: Vec3;
}

export interface CameraEntry {
  preset: string; // the active camera mode name (e.g. 'workdesk_front', 'free')
  position: Vec3;
  target: Vec3;
  fov: number;
}

export type LayoutTransforms = Record<PropTargetId, TransformEntry>;

const cloneVec3 = (v: Vec3): Vec3 => [v[0], v[1], v[2]];

// Keep editing state tidy (kill float crud like 0.15000000002 after repeated adds).
const r4 = (n: number): number => {
  const v = Math.round(n * 1e4) / 1e4;
  return Object.is(v, -0) ? 0 : v;
};

// Round for display / export: 3 decimals, no negative zero.
export function r3(n: number): number {
  const v = Math.round(n * 1e3) / 1e3;
  return Object.is(v, -0) ? 0 : v;
}

// Normalize scene.json scale (number | Vec3) to an xyz triple.
export function normalizeScale(scale: number | Vec3): Vec3 {
  return typeof scale === 'number' ? [scale, scale, scale] : cloneVec3(scale);
}

export const identityTransform = (): TransformEntry => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

// Build a TransformEntry from a (possibly partial) scene preset placement.
export function toTransformEntry(src?: {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
}): TransformEntry {
  return {
    position: src?.position ? cloneVec3(src.position) : [0, 0, 0],
    rotation: src?.rotation ? cloneVec3(src.rotation) : [0, 0, 0],
    scale: src?.scale !== undefined ? normalizeScale(src.scale) : [1, 1, 1],
  };
}

// Cycle the selected target by +1 (]) / -1 ([), wrapping.
export function cycleTarget(current: LayoutTargetId, dir: 1 | -1): LayoutTargetId {
  const i = LAYOUT_TARGETS.indexOf(current);
  const n = LAYOUT_TARGETS.length;
  return LAYOUT_TARGETS[(i + dir + n) % n];
}

// --- Pure nudge helpers (return NEW vectors; never mutate the input) ---------

export function nudgePosition(p: Vec3, axis: 0 | 1 | 2, delta: number): Vec3 {
  const out = cloneVec3(p);
  out[axis] = r4(out[axis] + delta);
  return out;
}

export function nudgeRotation(rot: Vec3, axis: 0 | 1 | 2, delta: number): Vec3 {
  const out = cloneVec3(rot);
  out[axis] = r4(out[axis] + delta);
  return out;
}

export function scaleBy(s: Vec3, factor: number): Vec3 {
  return [r4(s[0] * factor), r4(s[1] * factor), r4(s[2] * factor)];
}

// Apply one transform nudge to a TransformEntry, returning a new entry. `op`
// chooses the channel; `axis` the component; `delta` the signed step (ignored for
// scale, which uses `factor`).
export type NudgeOp = 'pos' | 'rot' | 'scale';
export function applyNudge(
  entry: TransformEntry,
  op: NudgeOp,
  axis: 0 | 1 | 2,
  deltaOrFactor: number,
): TransformEntry {
  if (op === 'pos') return { ...entry, position: nudgePosition(entry.position, axis, deltaOrFactor) };
  if (op === 'rot') return { ...entry, rotation: nudgeRotation(entry.rotation, axis, deltaOrFactor) };
  return { ...entry, scale: scaleBy(entry.scale, deltaOrFactor) };
}

// --- Export formatting (scene.json-shaped) -----------------------------------

const radToDeg = (r: number): number => r3((r * 180) / Math.PI);
const fmtVec3 = (v: Vec3): string => `[${r3(v[0])}, ${r3(v[1])}, ${r3(v[2])}]`;

// Collapse a uniform xyz scale back to a single number (as scene.json allows),
// else keep the triple.
function fmtScale(s: Vec3): string {
  const x = r3(s[0]);
  const y = r3(s[1]);
  const z = r3(s[2]);
  return x === y && y === z ? String(x) : `[${x}, ${y}, ${z}]`;
}

export interface ExportInput {
  character: TransformEntry;
  // props in scene.json order; ids are the prop ids (desk/chair/laptop/…)
  props: { id: string; transform: TransformEntry }[];
  camera: CameraEntry;
}

// Produce a copy-pasteable, scene.json-shaped snippet of the current layout. The
// transform fields (position/rotation/scale for character + each prop, and the
// camera block) drop straight into public/scenes/<id>/scene.json. Rotations are
// also annotated in degrees as a trailing comment-free companion (`rotationDeg`)
// purely for human reading — scene.json itself uses the radian arrays.
export function exportSceneLayout(input: ExportInput): string {
  const lines: string[] = [];
  lines.push('{');
  // character
  lines.push('  "character": {');
  lines.push(`    "position": ${fmtVec3(input.character.position)},`);
  lines.push(`    "rotation": ${fmtVec3(input.character.rotation)},`);
  lines.push(`    "scale": ${fmtScale(input.character.scale)}`);
  lines.push('  },');
  // props
  lines.push('  "props": [');
  input.props.forEach((p, i) => {
    const comma = i < input.props.length - 1 ? ',' : '';
    lines.push('    {');
    lines.push(`      "id": ${JSON.stringify(p.id)},`);
    lines.push(`      "position": ${fmtVec3(p.transform.position)},`);
    lines.push(`      "rotation": ${fmtVec3(p.transform.rotation)},`);
    lines.push(`      "scale": ${fmtScale(p.transform.scale)}`);
    lines.push(`    }${comma}`);
  });
  lines.push('  ],');
  // camera
  lines.push('  "camera": {');
  lines.push(`    "preset": ${JSON.stringify(input.camera.preset)},`);
  lines.push(`    "position": ${fmtVec3(input.camera.position)},`);
  lines.push(`    "target": ${fmtVec3(input.camera.target)},`);
  lines.push(`    "fov": ${r3(input.camera.fov)}`);
  lines.push('  }');
  lines.push('}');

  // Human-readable rotation-in-degrees footer (not valid JSON; for the operator).
  const degFooter: string[] = [];
  degFooter.push('');
  degFooter.push('// rotations in degrees (reference only):');
  degFooter.push(
    `//   character: [${radToDeg(input.character.rotation[0])}, ${radToDeg(
      input.character.rotation[1],
    )}, ${radToDeg(input.character.rotation[2])}]`,
  );
  for (const p of input.props) {
    degFooter.push(
      `//   ${p.id}: [${radToDeg(p.transform.rotation[0])}, ${radToDeg(
        p.transform.rotation[1],
      )}, ${radToDeg(p.transform.rotation[2])}]`,
    );
  }
  return lines.join('\n') + '\n' + degFooter.join('\n') + '\n';
}
