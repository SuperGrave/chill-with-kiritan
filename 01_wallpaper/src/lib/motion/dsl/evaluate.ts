// Motion DSL — pure evaluator (Motion Probe 0.7)
//
// Turns a resolved MotionDoc into a pure function of absolute time. Follows the
// 0.1/0.2 house rules: no internal state, no accumulation — evalAt(t) returns
// the same numbers for the same t forever, so there is zero drift and the
// output can be verified numerically (checkLoopSeam, Node tests) without THREE.
//
// Per-bone output keeps the three layers SEPARATE (posture / hand / offset);
// the THREE adapter composes quaternions as Qposture * Qhand * Qoffset. Euler
// components must not simply be added across layers — euler addition is not
// rotation composition (fine within one small-offset layer, wrong across
// layers like an arm posture at z≈1.2 plus a track offset).

import type {
  MotionDoc, MotionDef, E3, V3, EasingName, TrackKey, HipsKey, RootKey, HumanoidBoneName, HandDef, ExpressionKey, GazeKey,
} from './types';

/** Root-motion sample: world offset [x,y,z] + Y rotation (radians). */
export type RootSample = [number, number, number, number];
import { evaluateExpressionCues, mergeExpressionWeights } from '../../expression/expressionPresetEvaluator';
import type { ExpressionCue } from '../../expression/expressionPresetEvaluator';
import { GAZE_DIRECTIONS } from '../gazeController';
import type { GazeFix } from '../gazeController';

export interface BoneLayers {
  posture?: E3;
  hand?: E3;
  /** Track keys + oscillators, summed (both are small offsets by convention). */
  offset?: E3;
}

/**
 * A gaze direction sample: degrees on the gaze panel, or 'camera' (resolved
 * to the live camera direction by the consumer — viewer or Lab).
 */
export type GazeSample = 'camera' | { yaw: number; pitch: number };

/**
 * Resolved gaze state at a time t. `k` ramps 0->1 over the key's `move`
 * window; `from` is the previous key's direction (null = the ambient wander —
 * the consumer fades the fix in by k instead of lerping endpoints).
 */
export interface GazeState {
  from: GazeSample | null;
  to: GazeSample;
  k: number;
}

export interface EvalFrame {
  /** Every bone any layer touches. Missing bone = rest pose. */
  bones: Record<string, BoneLayers>;
  /** Normalized-rig hips position offset from rest (meters), from the posture. */
  hipsOffset: V3;
  /** Root-motion offset [x,y,z, rotY] (world meters / radians). All-zero = none. */
  root: RootSample;
  /** Expression name -> weight 0..1 at this time (raw keys + exprCues merged). */
  expressions: Record<string, number>;
  /** Eye direction at this time (null = idle wander). */
  gaze: GazeState | null;
  /** Highest-priority active expression cue's preset id (debug). */
  activeCuePreset: string | null;
}

export interface LoopSeamReport {
  ok: boolean;
  /** Max abs difference between t=0 and t=duration over all offset components (rad). */
  maxBoneDelta: number;
  worstBone: string | null;
  /** Max abs difference over expression weights. */
  maxExpressionDelta: number;
  notes: string[];
}

export interface MotionEvaluator {
  id: string;
  duration: number;
  loop: boolean;
  /** Bones any layer of this motion touches (posture + hands + tracks + oscillators). */
  boneNames: HumanoidBoneName[];
  /** Face channel (expr keys + cues + gaze) for the runtime player. null = none. */
  faceTimeline: MotionFaceTimeline | null;
  evalAt(t: number): EvalFrame;
  checkLoopSeam(): LoopSeamReport;
}

// --- easing ---------------------------------------------------------------------

function applyEase(name: EasingName, k: number): number {
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  switch (name) {
    case 'linear': return c;
    case 'step': return c >= 1 ? 1 : 0;
    case 'sineInOut': return 0.5 - 0.5 * Math.cos(Math.PI * c);
    case 'easeIn': return c * c;
    case 'easeOut': return 1 - (1 - c) * (1 - c);
    case 'cubicInOut': return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
  }
}

// --- oscillator helpers ---------------------------------------------------------
//
// Value noise, not Perlin proper, but the classic Perlin-style trick: layer a
// deterministic band-limited random signal on top of authored keys so a held
// pose keeps living (Perlin's Improv, 1996). Stateless on purpose — same t,
// same value, forever — so loop seams and numeric checks stay exact.

/** Deterministic lattice hash -> [-1, 1]. Not crypto, just decorrelated. */
function hashLattice(i: number, seed: number): number {
  const s = Math.sin((i + 1013.0) * 127.1 + seed * 311.7) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
}

/**
 * 1D value noise at time t with feature wavelength `period`.
 * `cells` > 0 wraps the lattice every `cells` steps (periodic noise — used on
 * loop motions so t=0 and t=duration sample identical lattice points).
 */
function periodicValueNoise(t: number, period: number, cells: number, seed: number): number {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  let i0 = i;
  let i1 = i + 1;
  if (cells > 0) {
    i0 = ((i0 % cells) + cells) % cells;
    i1 = ((i1 % cells) + cells) % cells;
  }
  const u = f * f * (3 - 2 * f); // smoothstep
  return hashLattice(i0, seed) * (1 - u) + hashLattice(i1, seed) * u;
}

/** Smoothstep envelope: 0 outside [w0, w1], ramps over attack/release inside. */
function windowEnvelope(t: number, w0: number, w1: number, attack: number, release: number): number {
  if (t <= w0 || t >= w1) return 0;
  let env = 1;
  if (attack > 0 && t < w0 + attack) {
    const k = (t - w0) / attack;
    env = Math.min(env, k * k * (3 - 2 * k));
  }
  if (release > 0 && t > w1 - release) {
    const k = (w1 - t) / release;
    env = Math.min(env, k * k * (3 - 2 * k));
  }
  return env;
}

// --- track sampling ----------------------------------------------------------------

function sampleKeys(keys: TrackKey[], t: number): E3 {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (t <= first.t) return [first.e[0], first.e[1], first.e[2]];
  if (t >= last.t) return [last.e[0], last.e[1], last.e[2]];
  // keys are validated strictly increasing; linear scan is fine at our sizes.
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t > b.t) continue;
    const a = keys[i - 1];
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 1;
    const w = applyEase(b.ease ?? 'sineInOut', k);
    return [
      a.e[0] + (b.e[0] - a.e[0]) * w,
      a.e[1] + (b.e[1] - a.e[1]) * w,
      a.e[2] + (b.e[2] - a.e[2]) * w,
    ];
  }
  return [last.e[0], last.e[1], last.e[2]];
}

/** Sample the hips POSITION track at t (meters). Mirrors sampleKeys for V3 `p`. */
function sampleHipsKeys(keys: HipsKey[], t: number): V3 {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (t <= first.t) return [first.p[0], first.p[1], first.p[2]];
  if (t >= last.t) return [last.p[0], last.p[1], last.p[2]];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t > b.t) continue;
    const a = keys[i - 1];
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 1;
    const w = applyEase(b.ease ?? 'sineInOut', k);
    return [
      a.p[0] + (b.p[0] - a.p[0]) * w,
      a.p[1] + (b.p[1] - a.p[1]) * w,
      a.p[2] + (b.p[2] - a.p[2]) * w,
    ];
  }
  return [last.p[0], last.p[1], last.p[2]];
}

/** Sample the root-motion track at t → [x,y,z, rotY]. Mirrors sampleHipsKeys. */
function sampleRootKeys(keys: RootKey[], t: number): RootSample {
  const at = (k: RootKey): RootSample => [k.p[0], k.p[1], k.p[2], k.rotY ?? 0];
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (t <= first.t) return at(first);
  if (t >= last.t) return at(last);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t > b.t) continue;
    const a = keys[i - 1];
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 1;
    const w = applyEase(b.ease ?? 'sineInOut', k);
    const ra = at(a);
    const rb = at(b);
    return [ra[0] + (rb[0] - ra[0]) * w, ra[1] + (rb[1] - ra[1]) * w, ra[2] + (rb[2] - ra[2]) * w, ra[3] + (rb[3] - ra[3]) * w];
  }
  return at(last);
}

// --- expression timeline -------------------------------------------------------------
//
// Each key declares the FULL target state reached at key.t; the transition fades
// in over key.fade seconds ending at key.t (default 0.5). Before the first key
// the state is {} (neutral) unless the first key sits at t<=0. Names missing
// from a key's set fade to 0.

function sampleExpressions(keys: ExpressionKey[] | undefined, t: number): Record<string, number> {
  if (!keys || keys.length === 0) return {};
  const states: Record<string, number>[] = keys.map((k) => {
    const s: Record<string, number> = {};
    for (const [name, w] of Object.entries(k.set)) {
      if (name.toLowerCase() === 'neutral') continue; // neutral == all zero
      s[name.toLowerCase()] = w;
    }
    return s;
  });

  let prevState: Record<string, number> = {};
  let prevT = -Infinity;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (t >= key.t) {
      prevState = states[i];
      prevT = key.t;
      continue;
    }
    // t is before key i: fade prevState -> states[i] over [key.t - fade, key.t].
    const fade = key.fade ?? 0.5;
    const start = Math.max(prevT, key.t - fade);
    if (t <= start) return { ...prevState };
    const k = fade > 0 ? (t - start) / (key.t - start) : 1;
    const out: Record<string, number> = {};
    for (const name of new Set([...Object.keys(prevState), ...Object.keys(states[i])])) {
      const a = prevState[name] ?? 0;
      const b = states[i][name] ?? 0;
      const v = a + (b - a) * k;
      if (v > 1e-4) out[name] = v;
    }
    return out;
  }
  return { ...prevState };
}

// --- face timeline (exprCues + gaze, 0.2) ---------------------------------------------
//
// The shared face channel for the Lab preview AND the runtime player: both
// sample the same pure functions at clip-local time, so what a capture shows
// is exactly what playback does. Kept separate from the bone evaluator so the
// runtime can sample faces every frame without re-evaluating bone layers.

/** Map a DSL ExpressionCueDef list to evaluator ExpressionCues (hold -1 = open-ended). */
export function compileExprCues(defs: MotionDef['exprCues']): ExpressionCue[] {
  if (!defs) return [];
  return defs.map((d) => ({
    presetId: d.preset,
    start: d.at,
    intensity: d.intensity,
    fadeIn: d.fadeIn,
    hold: d.hold !== undefined && d.hold < 0 ? Infinity : d.hold,
    fadeOut: d.fadeOut,
    priority: d.priority,
  }));
}

/** Resolve a GazeKey's `to` into a sample (named direction / raw degrees). */
function resolveGazeTo(to: string | [number, number]): GazeSample | null {
  if (Array.isArray(to)) return { yaw: to[0], pitch: to[1] };
  const named = GAZE_DIRECTIONS[to];
  if (named === undefined) return null; // validator warns upstream
  if (named === 'camera') return 'camera';
  return { yaw: named.yaw, pitch: named.pitch };
}

/**
 * Sample the gaze track at time t. Keys are "start moving at t, arrive after
 * move seconds, hold until the next key". Before the first key: null (wander).
 * Unknown named directions are skipped as if the key didn't exist.
 */
export function sampleGazeKeys(keys: GazeKey[] | undefined, t: number): GazeState | null {
  if (!keys || keys.length === 0) return null;
  let prev: GazeSample | null = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const to = resolveGazeTo(key.to);
    if (!to) continue;
    const next = keys[i + 1];
    const end = next ? next.t : Infinity;
    if (t < key.t) break;
    if (t < end) {
      const move = Math.max(1e-3, key.move ?? 0.25);
      const k = Math.min(1, (t - key.t) / move);
      // smoothstep the saccade ramp
      const ks = k * k * (3 - 2 * k);
      return { from: prev, to, k: ks };
    }
    prev = to;
  }
  // t before the first usable key (or none usable): wander.
  return prev ? { from: prev, to: prev, k: 1 } : null;
}

/** Map the legacy lookAt directive (0.7) onto a constant gaze state. */
export function legacyLookAtGaze(m: MotionDef): GazeState | null {
  const l = m.lookAt;
  if (!l || m.gaze) return null; // `gaze` wins when both exist
  const strength = Math.min(1, Math.max(0, l.strength ?? 1));
  if (l.mode === 'camera') return { from: null, to: 'camera', k: strength };
  if (l.mode === 'off') return { from: null, to: { yaw: 0, pitch: 0 }, k: 1 };
  if (l.mode === 'fixed' && l.point) {
    // Direction from the face anchor (~y 1.35) to the world point, in degrees.
    const [px, py, pz] = l.point;
    const horiz = Math.hypot(px, pz);
    const yaw = (Math.atan2(px, Math.max(1e-3, pz)) * 180) / Math.PI;
    const pitch = (Math.atan2(py - 1.35, Math.max(1e-3, horiz)) * 180) / Math.PI;
    return { from: null, to: { yaw, pitch }, k: strength };
  }
  return null; // 'cursor' -> wander (cursor follow no longer exists)
}

/**
 * Everything the runtime needs to drive the face/eyes of a playing DSL clip,
 * extracted once at load. Pure data + pure sampling — Node-testable.
 */
export interface MotionFaceTimeline {
  duration: number;
  loop: boolean;
  exprKeys: ExpressionKey[];
  cues: ExpressionCue[];
  gazeKeys: GazeKey[];
  legacyGaze: GazeState | null;
}

export interface FaceSample {
  /** Expression name -> weight (raw keys + cues, max-blended). */
  expressions: Record<string, number>;
  /** Fixed gaze from the gaze track (wins) or the cue winner's preset hint. */
  gaze: GazeState | null;
  /** Wander damp from the winning cue's preset (1 = none). */
  gazeWander: number;
  activeCuePreset: string | null;
}

export function buildFaceTimeline(m: MotionDef): MotionFaceTimeline | null {
  const exprKeys = m.expressions?.keys ?? [];
  const cues = compileExprCues(m.exprCues);
  const gazeKeys = m.gaze?.keys ?? [];
  const legacyGaze = legacyLookAtGaze(m);
  if (exprKeys.length === 0 && cues.length === 0 && gazeKeys.length === 0 && !legacyGaze) return null;
  return { duration: m.duration, loop: m.loop, exprKeys, cues, gazeKeys, legacyGaze };
}

/** Sample the face timeline at raw clip time (wraps/clamps like the evaluator). */
export function sampleFaceTimeline(tl: MotionFaceTimeline, rawT: number): FaceSample {
  const t = tl.loop
    ? ((rawT % tl.duration) + tl.duration) % tl.duration
    : Math.min(Math.max(rawT, 0), tl.duration);
  const cueOut = evaluateExpressionCues(tl.cues, t);
  const expressions = mergeExpressionWeights(sampleExpressions(tl.exprKeys, t), cueOut.weights);
  // Gaze priority: explicit gaze track > cue preset hint > legacy lookAt.
  let gaze = sampleGazeKeys(tl.gazeKeys, t);
  if (!gaze && cueOut.gazeFix.k > 0) {
    gaze = { from: null, to: { yaw: cueOut.gazeFix.yaw, pitch: cueOut.gazeFix.pitch }, k: cueOut.gazeFix.k };
  }
  if (!gaze) gaze = tl.legacyGaze;
  return { expressions, gaze, gazeWander: cueOut.gazeWander, activeCuePreset: cueOut.activePresetId };
}

/** Convenience: GazeState -> GazeFix for the controller, with 'camera' resolved by the caller. */
export function gazeStateToFix(
  state: GazeState,
  resolveCamera: () => { yaw: number; pitch: number },
  weight = 1,
): GazeFix {
  const res = (s: GazeSample) => (s === 'camera' ? resolveCamera() : s);
  const to = res(state.to);
  if (state.from === null) {
    return { yaw: to.yaw, pitch: to.pitch, k: state.k * weight };
  }
  const from = res(state.from);
  return {
    yaw: from.yaw + (to.yaw - from.yaw) * state.k,
    pitch: from.pitch + (to.pitch - from.pitch) * state.k,
    k: weight,
  };
}

// --- hand resolution ----------------------------------------------------------------

function resolveHand(def: HandDef | null, side: 'left' | 'right'): Record<string, E3> {
  const out: Record<string, E3> = {};
  if (!def) return out;
  if (def.side !== 'both' && def.side !== side) return out;
  const mirror = def.side === 'both' && side === 'right';
  const prefix = side;
  for (const [bone, e] of Object.entries(def.bones)) {
    if (!e) continue;
    const full = prefix + bone.charAt(0).toUpperCase() + bone.slice(1);
    out[full] = mirror ? [e[0], -e[1], -e[2]] : [e[0], e[1], e[2]];
  }
  return out;
}

// --- evaluator --------------------------------------------------------------------

export function buildEvaluator(doc: MotionDoc): MotionEvaluator {
  const m = doc.motion;
  const duration = m.duration;
  const loop = m.loop;

  const postureBones: Record<string, E3> = {};
  if (doc.posture) {
    for (const [bone, e] of Object.entries(doc.posture.bones)) {
      if (e) postureBones[bone] = [e[0], e[1], e[2]];
    }
  }
  const hipsOffset: V3 = doc.posture?.hipsOffset
    ? [...doc.posture.hipsOffset] as V3
    : [0, 0, 0];
  // Animated hips track (INF-3) overrides the posture's constant offset when present.
  const hipsTrack = m.hipsTrack && m.hipsTrack.keys.length > 0 ? m.hipsTrack : null;
  // Root-motion track (INF-7) — whole-character world offset over the motion.
  const rootTrack = m.rootMotion && m.rootMotion.keys.length > 0 ? m.rootMotion : null;

  const handBones: Record<string, E3> = {
    ...resolveHand(doc.leftHand, 'left'),
    ...resolveHand(doc.rightHand, 'right'),
  };

  const tracks = m.tracks ?? {};
  const oscillators = m.oscillators ?? [];

  const boneSet = new Set<string>([
    ...Object.keys(postureBones),
    ...Object.keys(handBones),
    ...Object.keys(tracks),
    ...oscillators.map((o) => o.bone),
  ]);
  const boneNames = [...boneSet] as HumanoidBoneName[];

  // Face channel (raw expression keys + preset cues + gaze) — shared with the
  // runtime player via buildFaceTimeline, so preview == playback.
  const faceTimeline = buildFaceTimeline(m);

  function evalAt(rawT: number): EvalFrame {
    const t = loop
      ? ((rawT % duration) + duration) % duration
      : Math.min(Math.max(rawT, 0), duration);

    const bones: Record<string, BoneLayers> = {};
    const ensure = (bone: string): BoneLayers => (bones[bone] ??= {});

    for (const [bone, e] of Object.entries(postureBones)) ensure(bone).posture = [e[0], e[1], e[2]];
    for (const [bone, e] of Object.entries(handBones)) ensure(bone).hand = [e[0], e[1], e[2]];

    for (const [bone, track] of Object.entries(tracks)) {
      if (!track || track.keys.length === 0) continue;
      ensure(bone).offset = sampleKeys(track.keys, t);
    }
    for (const o of oscillators) {
      const layers = ensure(o.bone);
      const offset: E3 = layers.offset ?? [0, 0, 0];
      let v: number;
      if (o.kind === 'noise') {
        // Wrap the lattice to the loop so the seam is exact even without a window.
        const cells = loop ? Math.max(1, Math.round(duration / o.period)) : 0;
        v = o.amp * periodicValueNoise(t, loop ? duration / Math.max(1, cells) : o.period, cells, o.seed ?? 0);
      } else {
        v = o.amp * Math.sin((2 * Math.PI * t) / o.period + (o.phase ?? 0));
      }
      if (o.window) {
        const attack = o.attack ?? 0.4;
        v *= windowEnvelope(t, o.window[0], o.window[1], attack, o.release ?? attack);
      }
      if (o.axis === 'x') offset[0] += v;
      else if (o.axis === 'y') offset[1] += v;
      else offset[2] += v;
      layers.offset = offset;
    }

    const face = faceTimeline
      ? sampleFaceTimeline(faceTimeline, t)
      : { expressions: {}, gaze: null, gazeWander: 1, activeCuePreset: null };

    return {
      bones,
      hipsOffset: hipsTrack ? sampleHipsKeys(hipsTrack.keys, t) : ([...hipsOffset] as V3),
      root: rootTrack ? sampleRootKeys(rootTrack.keys, t) : [0, 0, 0, 0],
      expressions: face.expressions,
      gaze: face.gaze,
      activeCuePreset: face.activeCuePreset,
    };
  }

  function checkLoopSeam(): LoopSeamReport {
    const notes: string[] = [];
    if (!loop) {
      return { ok: true, maxBoneDelta: 0, worstBone: null, maxExpressionDelta: 0, notes: ['loop=false — no seam to check.'] };
    }
    // Evaluate just inside both ends (loop wrapping maps t=duration to t=0).
    const eps = 1e-4;
    const a = evalAt(eps);
    const b = evalAt(duration - eps);
    let maxBoneDelta = 0;
    let worstBone: string | null = null;
    for (const bone of new Set([...Object.keys(a.bones), ...Object.keys(b.bones)])) {
      const ea = a.bones[bone]?.offset ?? [0, 0, 0];
      const eb = b.bones[bone]?.offset ?? [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const d = Math.abs(ea[i] - eb[i]);
        if (d > maxBoneDelta) { maxBoneDelta = d; worstBone = bone; }
      }
    }
    let maxExpressionDelta = 0;
    for (const name of new Set([...Object.keys(a.expressions), ...Object.keys(b.expressions)])) {
      maxExpressionDelta = Math.max(maxExpressionDelta, Math.abs((a.expressions[name] ?? 0) - (b.expressions[name] ?? 0)));
    }
    const ok = maxBoneDelta <= 0.02 && maxExpressionDelta <= 0.05;
    if (!ok) {
      notes.push(`seam mismatch — make the last keyframe equal the first, and ensure every oscillator period divides the duration. Threshold: bones 0.02 rad, expressions 0.05.`);
    }
    return { ok, maxBoneDelta, worstBone, maxExpressionDelta, notes };
  }

  return { id: m.id, duration, loop, boneNames, faceTimeline, evalAt, checkLoopSeam };
}
