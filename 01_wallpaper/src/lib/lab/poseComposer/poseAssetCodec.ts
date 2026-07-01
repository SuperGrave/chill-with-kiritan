// Pose Composer 0.8 — pose asset codec (Stage 4)
//
// Encode the live authoring override to a pose/1 asset, and decode a pose/1 back
// into overrides. master decision: stay on the existing `pose/1` schema (audit
// §A-2 option a) so a saved pose plugs straight into a motion's `posture`. The
// basis conversion lives in poseMath.ts; this module owns the pose/1 shape, the
// "changed vs T-pose" bone selection, and validation reuse on decode.
//
// "Changed-bones-only" (指示書 §8.2) is measured against the T-POSE identity, NOT
// the reference: a bone is written iff its absolute local (referenceQ·offsetQ) is
// not identity. That both matches the existing pose/1 files (stand_relaxed stores
// only the non-identity arm/shoulder bones) AND keeps a saved pose reproducible —
// the reference arm-drop is preserved even when the master only edited the head.

import * as THREE from 'three';
import type { PoseDef } from '../../motion/dsl/types';
import { validatePose } from '../../motion/dsl/validate';
import {
  poseEulerFromOffset,
  offsetFromPoseEuler,
  offsetToAbsoluteLocal,
  isIdentityQuat,
} from './poseMath';

const IDENTITY = new THREE.Quaternion();
const _abs = new THREE.Quaternion();

const round6 = (n: number): number => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

export interface EncodeParams {
  id: string;
  label?: string;
  notes?: string;
  /** Viewer reference quaternions (arm-dropped rest) — read-only. */
  reference: Map<string, THREE.Quaternion>;
  /** Live authoring override: bone -> reference-relative offset quaternion. */
  overrides: Map<string, THREE.Quaternion>;
  /** hips position offset (m) from rest, or null. */
  hipsOffset?: [number, number, number] | null;
}

/**
 * Encode to a pose/1 doc: every bone whose absolute local (reference·offset)
 * differs from the T-pose identity, written as its T-pose-absolute XYZ euler.
 */
export function encodePose(p: EncodeParams): PoseDef {
  const bones: PoseDef['bones'] = {};
  // Deterministic ordering: reference is insertion-ordered by the viewer's bone list.
  for (const [bone, refQ] of p.reference) {
    const offsetQ = p.overrides.get(bone) ?? IDENTITY;
    offsetToAbsoluteLocal(refQ, offsetQ, _abs);
    if (isIdentityQuat(_abs)) continue; // at T-pose ⇒ omit (changed-only)
    const e = poseEulerFromOffset(refQ, offsetQ);
    (bones as Record<string, [number, number, number]>)[bone] = [round6(e[0]), round6(e[1]), round6(e[2])];
  }
  const doc: PoseDef = { schema: 'pose/1', id: p.id, bones };
  if (p.label) doc.label = p.label;
  if (p.notes) doc.notes = p.notes;
  if (p.hipsOffset && (p.hipsOffset[0] !== 0 || p.hipsOffset[1] !== 0 || p.hipsOffset[2] !== 0)) {
    doc.hipsOffset = [round6(p.hipsOffset[0]), round6(p.hipsOffset[1]), round6(p.hipsOffset[2])];
  }
  return doc;
}

export interface DecodeResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** bone -> reference-relative offset quaternion (identity offsets are dropped). */
  overrides: Map<string, THREE.Quaternion>;
  hipsOffset: [number, number, number] | null;
  /** Bones present in the pose but absent from this model's reference (skipped). */
  missingBones: string[];
}

/**
 * Decode a pose/1 doc into overrides against the given reference. Validation
 * reuses the DSL's validatePose (single source of truth). Bones the model lacks
 * are reported in missingBones and skipped (never throws).
 */
export function decodePose(raw: unknown, reference: Map<string, THREE.Quaternion>): DecodeResult {
  const res = validatePose(raw);
  const fmt = (i: { path: string; message: string }) => `${i.path}: ${i.message}`;
  if (!res.ok) {
    return { ok: false, errors: res.errors.map(fmt), warnings: res.warnings.map(fmt), overrides: new Map(), hipsOffset: null, missingBones: [] };
  }
  const doc = raw as PoseDef;
  const overrides = new Map<string, THREE.Quaternion>();
  const missingBones: string[] = [];
  for (const [bone, e] of Object.entries(doc.bones)) {
    const refQ = reference.get(bone);
    if (!refQ) { missingBones.push(bone); continue; }
    const offset = offsetFromPoseEuler(refQ, e as [number, number, number]);
    // A bone whose saved pose == reference has an identity offset — leave it unedited.
    if (!isIdentityQuat(offset)) overrides.set(bone, offset);
  }
  return {
    ok: true,
    errors: [],
    warnings: res.warnings.map(fmt),
    overrides,
    hipsOffset: doc.hipsOffset ? [doc.hipsOffset[0], doc.hipsOffset[1], doc.hipsOffset[2]] : null,
    missingBones,
  };
}

/** Pretty-print a pose/1 doc for saving (stable 2-space JSON with a trailing newline). */
export function serializePose(doc: PoseDef): string {
  return JSON.stringify(doc, null, 2) + '\n';
}
