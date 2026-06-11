// Motion DSL — validator (Motion Probe 0.7)
//
// Validates raw parsed JSON for *.motion.json / *.pose.json / *.hand.json.
// Never throws: always returns { ok, errors, warnings } where every issue has
// a JSON-path-ish `path` and a message written for the AUTHOR (an LLM agent in
// another session) — including did-you-mean suggestions for bone names. Keep
// messages actionable: say what was found, what was expected, and how to fix.

import {
  HUMANOID_BONES, HUMANOID_BONE_SET, HAND_BONES, HAND_BONE_SET, EASING_NAMES,
} from './types';
import type {
  MotionDef, PoseDef, HandDef, ValidationIssue, ValidationResult, TrackKey,
} from './types';

// Expressions known to exist on this model (audit + Custom Expression Bridge).
// 'neutral' is accepted as "all zero". Unknown names are warnings, not errors,
// because the bridge map is built from the model at load time.
const KNOWN_EXPRESSIONS = new Set([
  'neutral', 'a', 'i', 'u', 'e', 'o', 'blink', 'blinkleft', 'blinkright',
  'joy', 'angry', 'sorrow', 'fun', 'lookup', 'lookdown', 'lookleft', 'lookright',
]);

// Amplitude sanity: a single euler component beyond this is almost certainly a
// degrees-vs-radians mistake (warn, don't block — arms legitimately reach ~1.6).
const EULER_WARN_RAD = 2.6;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

function suggest(name: string, candidates: readonly string[]): string {
  let best = '';
  let bestD = Infinity;
  const lower = name.toLowerCase();
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(name.length / 3)) ? ` Did you mean "${best}"?` : '';
}

class Issues {
  errors: ValidationIssue[] = [];
  warnings: ValidationIssue[] = [];
  err(path: string, message: string) { this.errors.push({ path, message }); }
  warn(path: string, message: string) { this.warnings.push({ path, message }); }
  result(): ValidationResult {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Validate a [x,y,z] number triple; returns true when usable.
function checkV3(iss: Issues, path: string, v: unknown, kind: 'euler' | 'position'): boolean {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) {
    iss.err(path, `expected an array of exactly 3 finite numbers [x, y, z], got ${JSON.stringify(v)}.`);
    return false;
  }
  if (kind === 'euler') {
    for (let i = 0; i < 3; i++) {
      const n = v[i] as number;
      if (Math.abs(n) > EULER_WARN_RAD) {
        iss.warn(path, `component ${'xyz'[i]} = ${n} rad is unusually large — euler values are RADIANS (90° = 1.5708). Was this written in degrees?`);
      }
    }
  }
  return true;
}

function checkBoneName(iss: Issues, path: string, name: string): boolean {
  if (HUMANOID_BONE_SET.has(name)) return true;
  iss.err(path, `unknown humanoid bone "${name}". Bone names are camelCase VRM 1.0 names (e.g. "head", "leftUpperArm", "rightIndexProximal").${suggest(name, HUMANOID_BONES)}`);
  return false;
}

// --- motion ---------------------------------------------------------------------

export function validateMotion(raw: unknown): ValidationResult {
  const iss = new Issues();
  if (!isObj(raw)) {
    iss.err('$', `expected a JSON object, got ${Array.isArray(raw) ? 'an array' : typeof raw}.`);
    return iss.result();
  }
  const m = raw as Partial<MotionDef> & Record<string, unknown>;

  if (m.schema !== 'motion/1') iss.err('schema', `expected "motion/1", got ${JSON.stringify(m.schema)}.`);
  if (typeof m.id !== 'string' || m.id.length === 0) iss.err('id', 'required: a non-empty string matching the file name (<id>.motion.json).');
  if (!isNum(m.duration) || (m.duration as number) <= 0) iss.err('duration', `required: seconds > 0, got ${JSON.stringify(m.duration)}.`);
  if (typeof m.loop !== 'boolean') iss.err('loop', `required: true (seamless repeat) or false (oneshot, holds last key), got ${JSON.stringify(m.loop)}.`);
  if (m.posture !== undefined && typeof m.posture !== 'string') iss.err('posture', 'must be a posture id string (file /poses/<id>.pose.json).');
  for (const f of ['fadeIn', 'fadeOut'] as const) {
    if (m[f] !== undefined && (!isNum(m[f]) || (m[f] as number) < 0)) iss.err(f, `must be seconds >= 0, got ${JSON.stringify(m[f])}.`);
  }
  if (m.hands !== undefined) {
    if (!isObj(m.hands)) iss.err('hands', `expected { "left"?: "<hand id>", "right"?: "<hand id>" }, got ${JSON.stringify(m.hands)}.`);
    else {
      for (const side of ['left', 'right'] as const) {
        const v = (m.hands as Record<string, unknown>)[side];
        if (v !== undefined && typeof v !== 'string') iss.err(`hands.${side}`, `must be a hand-shape id string (file /poses/hands/<id>.hand.json), got ${JSON.stringify(v)}.`);
      }
    }
  }

  const duration = isNum(m.duration) ? (m.duration as number) : 0;
  const loop = m.loop === true;

  // tracks
  if (m.tracks !== undefined) {
    if (!isObj(m.tracks)) {
      iss.err('tracks', 'expected an object mapping humanoid bone name -> { "keys": [...] }.');
    } else {
      for (const [bone, trackRaw] of Object.entries(m.tracks)) {
        const tpath = `tracks.${bone}`;
        checkBoneName(iss, tpath, bone);
        if (!isObj(trackRaw) || !Array.isArray((trackRaw as Record<string, unknown>).keys)) {
          iss.err(tpath, `expected { "keys": [ { "t": seconds, "e": [x,y,z] }, ... ] }, got ${JSON.stringify(trackRaw)}.`);
          continue;
        }
        const keys = (trackRaw as { keys: unknown[] }).keys;
        if (keys.length === 0) {
          iss.err(`${tpath}.keys`, 'must contain at least one key.');
          continue;
        }
        let prevT = -Infinity;
        keys.forEach((k, i) => {
          const kpath = `${tpath}.keys[${i}]`;
          if (!isObj(k)) { iss.err(kpath, `expected { "t": seconds, "e": [x,y,z], "ease"?: name }, got ${JSON.stringify(k)}.`); return; }
          const key = k as Partial<TrackKey> & Record<string, unknown>;
          if (!isNum(key.t)) iss.err(`${kpath}.t`, `required: key time in seconds, got ${JSON.stringify(key.t)}.`);
          else {
            if (key.t < 0 || key.t > duration) iss.err(`${kpath}.t`, `key time ${key.t} is outside 0..duration (${duration}).`);
            if (key.t <= prevT) iss.err(`${kpath}.t`, `key times must be strictly increasing (previous key is at ${prevT}).`);
            prevT = key.t;
          }
          checkV3(iss, `${kpath}.e`, key.e, 'euler');
          if (key.ease !== undefined && !(EASING_NAMES as readonly string[]).includes(key.ease as string)) {
            iss.err(`${kpath}.ease`, `unknown easing ${JSON.stringify(key.ease)}. Available: ${EASING_NAMES.join(', ')}.${suggest(String(key.ease), EASING_NAMES)}`);
          }
        });
        // Loop-seam check: first and last key values should match for loops.
        if (loop && keys.length >= 2) {
          const first = keys[0] as Partial<TrackKey>;
          const last = keys[keys.length - 1] as Partial<TrackKey>;
          if (Array.isArray(first.e) && Array.isArray(last.e) && first.e.every(isNum) && last.e.every(isNum)) {
            const d = Math.max(...first.e.map((v, i) => Math.abs((v as number) - (last.e as number[])[i])));
            if (d > 1e-3) {
              iss.warn(`${tpath}.keys`, `loop=true but first key e=${JSON.stringify(first.e)} and last key e=${JSON.stringify(last.e)} differ (max ${d.toFixed(3)} rad) — the loop will pop at the seam. Make the last key equal the first.`);
            }
          }
        }
      }
    }
  }

  // oscillators
  if (m.oscillators !== undefined) {
    if (!Array.isArray(m.oscillators)) {
      iss.err('oscillators', 'expected an array of { "bone", "axis", "amp", "period", "phase"? }.');
    } else {
      m.oscillators.forEach((o, i) => {
        const opath = `oscillators[${i}]`;
        if (!isObj(o)) { iss.err(opath, `expected an object, got ${JSON.stringify(o)}.`); return; }
        const osc = o as Record<string, unknown>;
        if (typeof osc.bone !== 'string') iss.err(`${opath}.bone`, 'required: humanoid bone name.');
        else checkBoneName(iss, `${opath}.bone`, osc.bone);
        if (osc.axis !== 'x' && osc.axis !== 'y' && osc.axis !== 'z') iss.err(`${opath}.axis`, `must be "x", "y" or "z", got ${JSON.stringify(osc.axis)}.`);
        if (!isNum(osc.amp)) iss.err(`${opath}.amp`, `required: amplitude in radians, got ${JSON.stringify(osc.amp)}.`);
        else if (Math.abs(osc.amp as number) > 0.5) iss.warn(`${opath}.amp`, `amplitude ${osc.amp} rad is large for an oscillator (breathing-class layers are ~0.02..0.08). Intentional?`);
        if (!isNum(osc.period) || (osc.period as number) <= 0) iss.err(`${opath}.period`, `required: seconds > 0, got ${JSON.stringify(osc.period)}.`);
        else if (loop && duration > 0) {
          const ratio = duration / (osc.period as number);
          if (Math.abs(ratio - Math.round(ratio)) > 1e-3) {
            iss.warn(`${opath}.period`, `duration (${duration}s) is not an integer multiple of period (${osc.period}s) — the oscillator will pop at the loop seam. Use a period that divides the duration (e.g. ${duration} / ${Math.max(1, Math.round(ratio))} = ${(duration / Math.max(1, Math.round(ratio))).toFixed(3)}).`);
          }
        }
        if (osc.phase !== undefined && !isNum(osc.phase)) iss.err(`${opath}.phase`, `must be radians, got ${JSON.stringify(osc.phase)}.`);
      });
    }
  }

  // expressions
  if (m.expressions !== undefined) {
    const e = m.expressions as Record<string, unknown>;
    if (!isObj(e) || !Array.isArray(e.keys)) {
      iss.err('expressions', 'expected { "keys": [ { "t": seconds, "set": { name: weight }, "fade"?: seconds }, ... ] }.');
    } else {
      let prevT = -Infinity;
      (e.keys as unknown[]).forEach((k, i) => {
        const kpath = `expressions.keys[${i}]`;
        if (!isObj(k)) { iss.err(kpath, `expected an object, got ${JSON.stringify(k)}.`); return; }
        const key = k as Record<string, unknown>;
        if (!isNum(key.t)) iss.err(`${kpath}.t`, `required: time in seconds, got ${JSON.stringify(key.t)}.`);
        else {
          if (key.t < 0 || key.t > duration) iss.err(`${kpath}.t`, `time ${key.t} is outside 0..duration (${duration}).`);
          if ((key.t as number) <= prevT) iss.err(`${kpath}.t`, `key times must be strictly increasing (previous key is at ${prevT}).`);
          prevT = key.t as number;
        }
        if (!isObj(key.set)) iss.err(`${kpath}.set`, `required: { "<expression>": weight 0..1 } (use {} or {"neutral": 1} for a plain face), got ${JSON.stringify(key.set)}.`);
        else {
          for (const [name, w] of Object.entries(key.set)) {
            if (!KNOWN_EXPRESSIONS.has(name.toLowerCase())) {
              iss.warn(`${kpath}.set.${name}`, `expression "${name}" is not in the model's known set (${[...KNOWN_EXPRESSIONS].join(', ')}). It will be ignored if missing at runtime.${suggest(name, [...KNOWN_EXPRESSIONS])}`);
            }
            if (!isNum(w) || w < 0 || w > 1) iss.err(`${kpath}.set.${name}`, `weight must be a number 0..1, got ${JSON.stringify(w)}.`);
          }
        }
        if (key.fade !== undefined && (!isNum(key.fade) || (key.fade as number) < 0)) iss.err(`${kpath}.fade`, `must be seconds >= 0, got ${JSON.stringify(key.fade)}.`);
      });
    }
  }

  // lookAt
  if (m.lookAt !== undefined) {
    const l = m.lookAt as unknown as Record<string, unknown>;
    if (!isObj(l)) iss.err('lookAt', 'expected { "mode": "cursor"|"camera"|"fixed"|"off", "point"?: [x,y,z], "strength"?: 0..1 }.');
    else {
      if (l.mode !== 'cursor' && l.mode !== 'camera' && l.mode !== 'fixed' && l.mode !== 'off') {
        iss.err('lookAt.mode', `must be "cursor", "camera", "fixed" or "off", got ${JSON.stringify(l.mode)}.`);
      }
      if (l.mode === 'fixed') {
        if (l.point === undefined) iss.err('lookAt.point', 'required when mode is "fixed": world-space point [x,y,z] in meters (character origin is at [0,0,0], face is around y=1.35).');
        else checkV3(iss, 'lookAt.point', l.point, 'position');
      }
      if (l.strength !== undefined && (!isNum(l.strength) || (l.strength as number) < 0 || (l.strength as number) > 1)) {
        iss.err('lookAt.strength', `must be 0..1, got ${JSON.stringify(l.strength)}.`);
      }
    }
  }

  if (m.microEvents !== undefined) {
    iss.warn('microEvents', 'accepted but not executed yet (Motion Director lands in 0.9).');
  }

  // Anything we don't know about is probably a typo — surface it.
  const knownTop = new Set(['schema', 'id', 'label', 'notes', 'category', 'tags', 'posture', 'duration', 'loop',
    'fadeIn', 'fadeOut', 'hands', 'tracks', 'oscillators', 'expressions', 'lookAt', 'microEvents']);
  for (const k of Object.keys(m)) {
    if (!knownTop.has(k)) iss.warn(k, `unknown top-level field "${k}" — ignored.${suggest(k, [...knownTop])}`);
  }

  return iss.result();
}

// --- pose -------------------------------------------------------------------------

export function validatePose(raw: unknown): ValidationResult {
  const iss = new Issues();
  if (!isObj(raw)) {
    iss.err('$', `expected a JSON object, got ${Array.isArray(raw) ? 'an array' : typeof raw}.`);
    return iss.result();
  }
  const p = raw as Partial<PoseDef> & Record<string, unknown>;
  if (p.schema !== 'pose/1') iss.err('schema', `expected "pose/1", got ${JSON.stringify(p.schema)}.`);
  if (typeof p.id !== 'string' || p.id.length === 0) iss.err('id', 'required: a non-empty string matching the file name (<id>.pose.json).');
  if (p.hipsOffset !== undefined) checkV3(iss, 'hipsOffset', p.hipsOffset, 'position');
  if (!isObj(p.bones)) {
    iss.err('bones', 'required: an object mapping humanoid bone name -> [x,y,z] euler radians.');
  } else {
    for (const [bone, e] of Object.entries(p.bones)) {
      if (checkBoneName(iss, `bones.${bone}`, bone)) checkV3(iss, `bones.${bone}`, e, 'euler');
    }
  }
  return iss.result();
}

// --- hand --------------------------------------------------------------------------

export function validateHand(raw: unknown): ValidationResult {
  const iss = new Issues();
  if (!isObj(raw)) {
    iss.err('$', `expected a JSON object, got ${Array.isArray(raw) ? 'an array' : typeof raw}.`);
    return iss.result();
  }
  const h = raw as Partial<HandDef> & Record<string, unknown>;
  if (h.schema !== 'hand/1') iss.err('schema', `expected "hand/1", got ${JSON.stringify(h.schema)}.`);
  if (typeof h.id !== 'string' || h.id.length === 0) iss.err('id', 'required: a non-empty string matching the file name (<id>.hand.json).');
  if (h.side !== 'left' && h.side !== 'right' && h.side !== 'both') {
    iss.err('side', `must be "left", "right" or "both" (both = side-less bone names, right hand mirrored as [x,-y,-z]), got ${JSON.stringify(h.side)}.`);
  }
  if (!isObj(h.bones)) {
    iss.err('bones', `required: an object mapping ${h.side === 'both' ? 'side-less' : 'side-less'} finger bone name -> [x,y,z] euler radians (e.g. "indexProximal").`);
  } else {
    for (const [bone, e] of Object.entries(h.bones)) {
      if (!HAND_BONE_SET.has(bone)) {
        iss.err(`bones.${bone}`, `unknown hand bone "${bone}". Use side-less names: ${HAND_BONES.join(', ')}.${suggest(bone, HAND_BONES)}`);
        continue;
      }
      checkV3(iss, `bones.${bone}`, e, 'euler');
    }
  }
  return iss.result();
}
