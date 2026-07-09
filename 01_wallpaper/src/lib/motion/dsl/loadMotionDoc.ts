// Motion DSL — browser-side document loader (Motion Probe 0.7)
//
// Fetches a *.motion.json plus its referenced posture / hand shapes, validates
// everything, and builds the pure evaluator. Shared by the Motion Lab
// (authoring, window.__motionLab) and the App's motion selector (playback), so
// both paths resolve and validate motions identically.
//
// Never throws; never caches (every call re-fetches with a cache-buster, which
// is what makes "edit JSON on disk -> load() again" work without a rebuild).

import type { MotionDef, PoseDef, HandDef, MotionDoc, ValidationIssue } from './types';
import { validateMotion, validatePose, validateHand } from './validate';
import { buildEvaluator } from './evaluate';
import type { MotionEvaluator } from './evaluate';
import { publicAssetUrl } from '../../assetUrl';

export interface LoadedMotion {
  ok: true;
  doc: MotionDoc;
  evaluator: MotionEvaluator;
  warnings: ValidationIssue[];
}

export interface LoadMotionFailure {
  ok: false;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type LoadMotionResult = LoadedMotion | LoadMotionFailure;

/** Optional directory listing used to enrich 404 errors with what DOES exist. */
export type LsHint = () => Promise<{ motions: string[]; poses: string[]; hands: string[] } | null>;

export async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} for ${url}` };
    try {
      return { ok: true, data: await res.json() };
    } catch (e) {
      return { ok: false, error: `${url} is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  } catch (e) {
    return { ok: false, error: `fetch failed for ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function loadMotionDoc(id: string, hintLs?: LsHint): Promise<LoadMotionResult> {
  const failure = (path: string, message: string, warnings: ValidationIssue[] = []): LoadMotionFailure => ({
    ok: false,
    errors: [{ path, message }],
    warnings,
  });
  const hint = async (kind: 'motions' | 'poses' | 'hands'): Promise<string> => {
    const listed = await hintLs?.().catch(() => null);
    if (!listed) return '';
    const label = { motions: 'motions', poses: 'postures', hands: 'hand shapes' }[kind];
    return ` Available ${label}: ${listed[kind].join(', ') || '(none yet)'}.`;
  };

  const motionRes = await fetchJson(publicAssetUrl(`/motions/dsl/${id}.motion.json`));
  if (!motionRes.ok) {
    return failure('$', `${motionRes.error}.${await hint('motions')} Files live in public/motions/dsl/<id>.motion.json.`);
  }
  const v = validateMotion(motionRes.data);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings };
  const motion = motionRes.data as MotionDef;
  if (motion.id !== id) {
    v.warnings.push({ path: 'id', message: `file is ${id}.motion.json but "id" is "${motion.id}" — keep them identical.` });
  }

  let posture: PoseDef | null = null;
  if (motion.posture) {
    const res = await fetchJson(publicAssetUrl(`/poses/${motion.posture}.pose.json`));
    if (!res.ok) return failure('posture', `${res.error}.${await hint('poses')}`, v.warnings);
    const pv = validatePose(res.data);
    if (!pv.ok) {
      return {
        ok: false,
        errors: pv.errors.map((e) => ({ path: `(pose ${motion.posture}) ${e.path}`, message: e.message })),
        warnings: pv.warnings,
      };
    }
    v.warnings.push(...pv.warnings.map((w) => ({ path: `(pose ${motion.posture}) ${w.path}`, message: w.message })));
    posture = res.data as PoseDef;
  }

  const loadHand = async (handId: string | undefined, side: 'left' | 'right'): Promise<HandDef | null | LoadMotionFailure> => {
    if (!handId) return null;
    const res = await fetchJson(publicAssetUrl(`/poses/hands/${handId}.hand.json`));
    if (!res.ok) return failure(`hands.${side}`, `${res.error}.${await hint('hands')}`, v.warnings);
    const hv = validateHand(res.data);
    if (!hv.ok) {
      return {
        ok: false,
        errors: hv.errors.map((e) => ({ path: `(hand ${handId}) ${e.path}`, message: e.message })),
        warnings: hv.warnings,
      };
    }
    v.warnings.push(...hv.warnings.map((w) => ({ path: `(hand ${handId}) ${w.path}`, message: w.message })));
    const def = res.data as HandDef;
    if (def.side !== 'both' && def.side !== side) {
      return failure(`hands.${side}`, `hand shape "${handId}" has side "${def.side}" and cannot be used as the ${side} hand. Use a "both" or "${side}" shape.`, v.warnings);
    }
    return def;
  };

  const left = await loadHand(motion.hands?.left, 'left');
  if (left && 'ok' in left) return left;
  const right = await loadHand(motion.hands?.right, 'right');
  if (right && 'ok' in right) return right;

  const doc: MotionDoc = { motion, posture, leftHand: left, rightHand: right };
  return { ok: true, doc, evaluator: buildEvaluator(doc), warnings: v.warnings };
}
