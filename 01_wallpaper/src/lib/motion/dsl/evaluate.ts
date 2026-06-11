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
  MotionDoc, E3, V3, EasingName, TrackKey, HumanoidBoneName, HandDef, ExpressionKey,
} from './types';

export interface BoneLayers {
  posture?: E3;
  hand?: E3;
  /** Track keys + oscillators, summed (both are small offsets by convention). */
  offset?: E3;
}

export interface ResolvedLookAt {
  mode: 'cursor' | 'camera' | 'fixed' | 'off';
  point: V3 | null;
  strength: number;
}

export interface EvalFrame {
  /** Every bone any layer touches. Missing bone = rest pose. */
  bones: Record<string, BoneLayers>;
  /** Normalized-rig hips position offset from rest (meters), from the posture. */
  hipsOffset: V3;
  /** Expression name -> weight 0..1 at this time. */
  expressions: Record<string, number>;
  lookAt: ResolvedLookAt;
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

  const lookAt: ResolvedLookAt = {
    mode: m.lookAt?.mode ?? 'cursor',
    point: m.lookAt?.point ? ([...m.lookAt.point] as V3) : null,
    strength: m.lookAt?.strength ?? 1.0,
  };

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
      const v = o.amp * Math.sin((2 * Math.PI * t) / o.period + (o.phase ?? 0));
      if (o.axis === 'x') offset[0] += v;
      else if (o.axis === 'y') offset[1] += v;
      else offset[2] += v;
      layers.offset = offset;
    }

    return {
      bones,
      hipsOffset: [...hipsOffset] as V3,
      expressions: sampleExpressions(m.expressions?.keys, t),
      lookAt,
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

  return { id: m.id, duration, loop, boneNames, evalAt, checkLoopSeam };
}
