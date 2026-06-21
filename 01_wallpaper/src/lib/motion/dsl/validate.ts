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
import { DERIVED_EXPRESSION_NAMES, EXPRESSION_PRESET_IDS, EXPRESSION_PRESETS } from '../../expression/expressionPresets';
import { GAZE_DIRECTION_NAMES } from '../gazeController';

// Expressions known to exist on this model (audit + Custom Expression Bridge).
// 'neutral' is accepted as "all zero". Unknown names are warnings, not errors,
// because the bridge map is built from the model at load time. The derived
// names (じと目/びっくり… raw morphs promoted by the Expression Preset System)
// come from the same table the runtime registers, so the two can't drift.
const KNOWN_EXPRESSIONS = new Set([
  'neutral', 'a', 'i', 'u', 'e', 'o', 'blink', 'blinkleft', 'blinkright',
  'joy', 'angry', 'sorrow', 'fun', 'lookup', 'lookdown', 'lookleft', 'lookright',
  ...DERIVED_EXPRESSION_NAMES,
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

  // hipsTrack (INF-3 — animated hips position, meters; ABSOLUTE, overrides posture hipsOffset)
  if (m.hipsTrack !== undefined) {
    const ht = m.hipsTrack as Record<string, unknown>;
    if (!isObj(ht) || !Array.isArray(ht.keys)) {
      iss.err('hipsTrack', 'expected { "keys": [ { "t": seconds, "p": [x,y,z] }, ... ] } — hips position offset in meters (e.g. sit p.y ≈ -0.2, stand p.y = 0).');
    } else if ((ht.keys as unknown[]).length === 0) {
      iss.err('hipsTrack.keys', 'must contain at least one key (or omit hipsTrack to use the posture hipsOffset).');
    } else {
      let prevT = -Infinity;
      (ht.keys as unknown[]).forEach((k, i) => {
        const kpath = `hipsTrack.keys[${i}]`;
        if (!isObj(k)) { iss.err(kpath, `expected { "t": seconds, "p": [x,y,z], "ease"?: name }, got ${JSON.stringify(k)}.`); return; }
        const key = k as Record<string, unknown>;
        if (!isNum(key.t)) iss.err(`${kpath}.t`, `required: key time in seconds, got ${JSON.stringify(key.t)}.`);
        else {
          if ((key.t as number) < 0 || (key.t as number) > duration) iss.err(`${kpath}.t`, `key time ${key.t} is outside 0..duration (${duration}).`);
          if ((key.t as number) <= prevT) iss.err(`${kpath}.t`, `key times must be strictly increasing (previous key is at ${prevT}).`);
          prevT = key.t as number;
        }
        checkV3(iss, `${kpath}.p`, key.p, 'position');
        if (key.ease !== undefined && !(EASING_NAMES as readonly string[]).includes(key.ease as string)) {
          iss.err(`${kpath}.ease`, `unknown easing ${JSON.stringify(key.ease)}. Available: ${EASING_NAMES.join(', ')}.${suggest(String(key.ease), EASING_NAMES)}`);
        }
        const knownHipsKey = new Set(['t', 'p', 'ease']);
        for (const kk of Object.keys(key)) {
          if (!knownHipsKey.has(kk)) iss.warn(`${kpath}.${kk}`, `unknown hipsTrack key field "${kk}" — ignored.${suggest(kk, [...knownHipsKey])}`);
        }
      });
      if (loop && (ht.keys as unknown[]).length >= 2) {
        const first = (ht.keys as unknown[])[0] as Record<string, unknown>;
        const last = (ht.keys as unknown[])[(ht.keys as unknown[]).length - 1] as Record<string, unknown>;
        if (Array.isArray(first.p) && Array.isArray(last.p) && (first.p as unknown[]).every(isNum) && (last.p as unknown[]).every(isNum)) {
          const d = Math.max(...(first.p as number[]).map((v, i) => Math.abs(v - (last.p as number[])[i])));
          if (d > 1e-3) iss.warn('hipsTrack.keys', `loop=true but first key p=${JSON.stringify(first.p)} and last key p=${JSON.stringify(last.p)} differ (max ${d.toFixed(3)} m) — hips will pop at the seam.`);
        }
      }
    }
  }

  // rootMotion (INF-7 — whole-character world offset; ABSOLUTE from start)
  if (m.rootMotion !== undefined) {
    const rt = m.rootMotion as Record<string, unknown>;
    if (!isObj(rt) || !Array.isArray(rt.keys)) {
      iss.err('rootMotion', 'expected { "keys": [ { "t": seconds, "p": [x,y,z], "rotY"?: radians }, ... ] } — world-space character offset in meters.');
    } else if ((rt.keys as unknown[]).length === 0) {
      iss.err('rootMotion.keys', 'must contain at least one key (or omit rootMotion).');
    } else {
      let prevT = -Infinity;
      (rt.keys as unknown[]).forEach((k, i) => {
        const kpath = `rootMotion.keys[${i}]`;
        if (!isObj(k)) { iss.err(kpath, `expected { "t": seconds, "p": [x,y,z], "rotY"?: radians, "ease"?: name }, got ${JSON.stringify(k)}.`); return; }
        const key = k as Record<string, unknown>;
        if (!isNum(key.t)) iss.err(`${kpath}.t`, `required: key time in seconds, got ${JSON.stringify(key.t)}.`);
        else {
          if ((key.t as number) < 0 || (key.t as number) > duration) iss.err(`${kpath}.t`, `key time ${key.t} is outside 0..duration (${duration}).`);
          if ((key.t as number) <= prevT) iss.err(`${kpath}.t`, `key times must be strictly increasing (previous key is at ${prevT}).`);
          prevT = key.t as number;
        }
        checkV3(iss, `${kpath}.p`, key.p, 'position');
        if (key.rotY !== undefined && !isNum(key.rotY)) iss.err(`${kpath}.rotY`, `must be radians, got ${JSON.stringify(key.rotY)}.`);
        if (key.ease !== undefined && !(EASING_NAMES as readonly string[]).includes(key.ease as string)) {
          iss.err(`${kpath}.ease`, `unknown easing ${JSON.stringify(key.ease)}. Available: ${EASING_NAMES.join(', ')}.${suggest(String(key.ease), EASING_NAMES)}`);
        }
        const knownRootKey = new Set(['t', 'p', 'rotY', 'ease']);
        for (const kk of Object.keys(key)) {
          if (!knownRootKey.has(kk)) iss.warn(`${kpath}.${kk}`, `unknown rootMotion key field "${kk}" — ignored.${suggest(kk, [...knownRootKey])}`);
        }
      });
      // A looping motion should keep net-zero root (walk in place; the across-room
      // advance is driven separately) so it doesn't teleport at the seam.
      if (loop && (rt.keys as unknown[]).length >= 2) {
        const first = (rt.keys as unknown[])[0] as Record<string, unknown>;
        const last = (rt.keys as unknown[])[(rt.keys as unknown[]).length - 1] as Record<string, unknown>;
        if (Array.isArray(first.p) && Array.isArray(last.p) && (first.p as unknown[]).every(isNum) && (last.p as unknown[]).every(isNum)) {
          const d = Math.max(...(first.p as number[]).map((v, i) => Math.abs(v - (last.p as number[])[i])));
          if (d > 1e-3) iss.warn('rootMotion.keys', `loop=true but first key p=${JSON.stringify(first.p)} and last key p=${JSON.stringify(last.p)} differ (max ${d.toFixed(3)} m) — a looping walk should return to its start (net-zero); drive the across-room advance from the Director instead.`);
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
        else if (Math.abs(osc.amp as number) > 0.5) iss.warn(`${opath}.amp`, `amplitude ${osc.amp} rad is large for an oscillator (breathing-class layers are ~0.02..0.08, tremor-class noise ~0.005..0.02). Intentional?`);
        if (osc.kind !== undefined && osc.kind !== 'sine' && osc.kind !== 'noise') {
          iss.err(`${opath}.kind`, `must be "sine" (default) or "noise", got ${JSON.stringify(osc.kind)}.`);
        }
        const isNoise = osc.kind === 'noise';
        let hasWindow = false;
        if (osc.window !== undefined) {
          if (!Array.isArray(osc.window) || osc.window.length !== 2 || !osc.window.every(isNum)) {
            iss.err(`${opath}.window`, `expected [startSeconds, endSeconds], got ${JSON.stringify(osc.window)}.`);
          } else {
            hasWindow = true;
            const [w0, w1] = osc.window as [number, number];
            if (w0 < 0 || w1 > duration || w0 >= w1) {
              iss.err(`${opath}.window`, `window [${w0}, ${w1}] must satisfy 0 <= start < end <= duration (${duration}).`);
            }
          }
        }
        for (const f of ['attack', 'release'] as const) {
          if (osc[f] !== undefined && (!isNum(osc[f]) || (osc[f] as number) < 0)) {
            iss.err(`${opath}.${f}`, `must be seconds >= 0, got ${JSON.stringify(osc[f])}.`);
          }
        }
        if (osc.seed !== undefined && !isNum(osc.seed)) iss.err(`${opath}.seed`, `must be a number, got ${JSON.stringify(osc.seed)}.`);
        if (!isNum(osc.period) || (osc.period as number) <= 0) iss.err(`${opath}.period`, `required: seconds > 0, got ${JSON.stringify(osc.period)}.`);
        else if (loop && duration > 0 && !isNoise && !hasWindow) {
          // noise wraps its lattice to the duration; a windowed layer fades to
          // zero before the seam — only a bare sine can pop here.
          const ratio = duration / (osc.period as number);
          if (Math.abs(ratio - Math.round(ratio)) > 1e-3) {
            iss.warn(`${opath}.period`, `duration (${duration}s) is not an integer multiple of period (${osc.period}s) — the oscillator will pop at the loop seam. Use a period that divides the duration (e.g. ${duration} / ${Math.max(1, Math.round(ratio))} = ${(duration / Math.max(1, Math.round(ratio))).toFixed(3)}).`);
          }
        }
        if (osc.phase !== undefined) {
          if (!isNum(osc.phase)) iss.err(`${opath}.phase`, `must be radians, got ${JSON.stringify(osc.phase)}.`);
          else if (isNoise) iss.warn(`${opath}.phase`, 'phase is ignored for kind:"noise" — use seed to decorrelate noise channels.');
        }
        const knownOsc = new Set(['bone', 'axis', 'amp', 'period', 'phase', 'kind', 'window', 'attack', 'release', 'seed']);
        for (const k of Object.keys(osc)) {
          if (!knownOsc.has(k)) iss.warn(`${opath}.${k}`, `unknown oscillator field "${k}" — ignored.${suggest(k, [...knownOsc])}`);
        }
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

  // exprCues (0.2 — preset-based expression cues)
  if (m.exprCues !== undefined) {
    if (!Array.isArray(m.exprCues)) {
      iss.err('exprCues', 'expected an array of { "preset": id, "at": seconds, "intensity"?, "fadeIn"?, "hold"?, "fadeOut"? }.');
    } else {
      m.exprCues.forEach((c, i) => {
        const cpath = `exprCues[${i}]`;
        if (!isObj(c)) { iss.err(cpath, `expected an object, got ${JSON.stringify(c)}.`); return; }
        const cue = c as Record<string, unknown>;
        if (typeof cue.preset !== 'string' || cue.preset.length === 0) {
          iss.err(`${cpath}.preset`, `required: an Expression Preset id. Available: ${EXPRESSION_PRESET_IDS.join(', ')}.`);
        } else if (!EXPRESSION_PRESETS[cue.preset]) {
          iss.err(`${cpath}.preset`, `unknown preset "${cue.preset}". Available: ${EXPRESSION_PRESET_IDS.join(', ')}.${suggest(cue.preset, EXPRESSION_PRESET_IDS)}`);
        }
        if (!isNum(cue.at)) iss.err(`${cpath}.at`, `required: start time in seconds, got ${JSON.stringify(cue.at)}.`);
        else if (cue.at < 0 || cue.at > duration) iss.err(`${cpath}.at`, `start ${cue.at} is outside 0..duration (${duration}).`);
        if (cue.intensity !== undefined && (!isNum(cue.intensity) || cue.intensity < 0 || cue.intensity > 1)) {
          iss.err(`${cpath}.intensity`, `must be 0..1, got ${JSON.stringify(cue.intensity)}.`);
        }
        for (const f of ['fadeIn', 'fadeOut'] as const) {
          if (cue[f] !== undefined && (!isNum(cue[f]) || (cue[f] as number) < 0)) {
            iss.err(`${cpath}.${f}`, `must be seconds >= 0, got ${JSON.stringify(cue[f])}.`);
          }
        }
        if (cue.hold !== undefined && (!isNum(cue.hold) || ((cue.hold as number) < 0 && cue.hold !== -1))) {
          iss.err(`${cpath}.hold`, `must be seconds >= 0, or -1 (= hold until the end of the motion), got ${JSON.stringify(cue.hold)}.`);
        }
        if (cue.priority !== undefined && !isNum(cue.priority)) iss.err(`${cpath}.priority`, `must be a number, got ${JSON.stringify(cue.priority)}.`);
        // Envelope overrun: warn when the cue can't finish inside the clip.
        if (isNum(cue.at) && typeof cue.preset === 'string' && EXPRESSION_PRESETS[cue.preset]) {
          const p = EXPRESSION_PRESETS[cue.preset];
          const fadeIn = (cue.fadeIn as number | undefined) ?? p.timing?.fadeIn ?? 0.5;
          const hold = cue.hold === -1 ? 0 : ((cue.hold as number | undefined) ?? p.timing?.hold ?? 0);
          const fadeOut = (cue.fadeOut as number | undefined) ?? p.timing?.fadeOut ?? 0.5;
          const end = (cue.at as number) + fadeIn + hold + (cue.hold === -1 ? 0 : fadeOut);
          if (cue.hold !== -1 && end > duration + 1e-6) {
            iss.warn(`${cpath}`, `cue runs until ${end.toFixed(2)}s but the motion ends at ${duration}s — it will be cut mid-envelope${loop ? ' at the loop seam (visible pop)' : ''}. Shorten hold/fades or start earlier.`);
          }
        }
        const knownCue = new Set(['preset', 'at', 'intensity', 'fadeIn', 'hold', 'fadeOut', 'priority']);
        for (const k of Object.keys(cue)) {
          if (!knownCue.has(k)) iss.warn(`${cpath}.${k}`, `unknown cue field "${k}" — ignored.${suggest(k, [...knownCue])}`);
        }
      });
    }
  }

  // gaze (0.2 — eye-direction keys)
  if (m.gaze !== undefined) {
    const g = m.gaze as Record<string, unknown>;
    if (!isObj(g) || !Array.isArray(g.keys)) {
      iss.err('gaze', 'expected { "keys": [ { "t": seconds, "to": "<direction>"|[yawDeg,pitchDeg], "move"?: seconds }, ... ] }.');
    } else {
      let prevT = -Infinity;
      (g.keys as unknown[]).forEach((k, i) => {
        const kpath = `gaze.keys[${i}]`;
        if (!isObj(k)) { iss.err(kpath, `expected an object, got ${JSON.stringify(k)}.`); return; }
        const key = k as Record<string, unknown>;
        if (!isNum(key.t)) iss.err(`${kpath}.t`, `required: time in seconds, got ${JSON.stringify(key.t)}.`);
        else {
          if (key.t < 0 || key.t > duration) iss.err(`${kpath}.t`, `time ${key.t} is outside 0..duration (${duration}).`);
          if ((key.t as number) <= prevT) iss.err(`${kpath}.t`, `key times must be strictly increasing (previous key is at ${prevT}).`);
          prevT = key.t as number;
        }
        if (typeof key.to === 'string') {
          if (!GAZE_DIRECTION_NAMES.includes(key.to)) {
            iss.err(`${kpath}.to`, `unknown gaze direction "${key.to}". Named directions (screen-relative): ${GAZE_DIRECTION_NAMES.join(', ')} — or a raw [yawDeg, pitchDeg] pair.${suggest(key.to, GAZE_DIRECTION_NAMES)}`);
          }
        } else if (Array.isArray(key.to) && key.to.length === 2 && key.to.every(isNum)) {
          const [yaw, pitch] = key.to as [number, number];
          if (Math.abs(yaw) <= 1.0 && Math.abs(pitch) <= 1.0 && (yaw !== 0 || pitch !== 0)) {
            iss.warn(`${kpath}.to`, `[${yaw}, ${pitch}] looks like radians — gaze directions are DEGREES (ちょい上 = [0, 15] 程度). Bones use radians; gaze does not.`);
          }
          if (Math.abs(yaw) > 90 || Math.abs(pitch) > 90) {
            iss.err(`${kpath}.to`, `[${yaw}, ${pitch}] is out of range — degrees, usable range is about yaw ±35 / pitch ±25 (the eyes clamp beyond that).`);
          }
        } else {
          iss.err(`${kpath}.to`, `required: a named direction (${GAZE_DIRECTION_NAMES.join(', ')}) or [yawDeg, pitchDeg], got ${JSON.stringify(key.to)}.`);
        }
        if (key.move !== undefined && (!isNum(key.move) || (key.move as number) < 0)) {
          iss.err(`${kpath}.move`, `must be seconds >= 0 (saccade duration, default 0.25), got ${JSON.stringify(key.move)}.`);
        }
        const knownGaze = new Set(['t', 'to', 'move']);
        for (const kk of Object.keys(key)) {
          if (!knownGaze.has(kk)) iss.warn(`${kpath}.${kk}`, `unknown gaze key field "${kk}" — ignored.${suggest(kk, [...knownGaze])}`);
        }
      });
      const first = (g.keys as unknown[])[0];
      if (loop && isObj(first) && isNum((first as Record<string, unknown>).t) && ((first as Record<string, unknown>).t as number) > 0.1) {
        iss.warn('gaze.keys', `loop=true but the first gaze key is at t=${(first as Record<string, unknown>).t} — between the seam and that key the eyes fall back to idle wander each cycle. Put a key at t=0 (matching the last key) for a stable loop.`);
      }
    }
  }

  // lookAt
  if (m.lookAt !== undefined && m.gaze !== undefined) {
    iss.warn('lookAt', 'both "gaze" and legacy "lookAt" are present — lookAt is ignored. Remove it.');
  }
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

  // microEvents (INF-4 — timed prop attach/detach executed at clip-local time)
  if (m.microEvents !== undefined) {
    if (!Array.isArray(m.microEvents)) {
      iss.err('microEvents', 'expected an array of { "t": seconds, "action": "attach"|"detach", "prop": id, "bone"?, "grip"? }.');
    } else {
      const knownBones = new Set(['rightHand', 'leftHand', 'head']);
      m.microEvents.forEach((ev, i) => {
        const epath = `microEvents[${i}]`;
        if (!isObj(ev)) { iss.err(epath, `expected an object, got ${JSON.stringify(ev)}.`); return; }
        const e = ev as Record<string, unknown>;
        if (!isNum(e.t)) iss.err(`${epath}.t`, `required: clip-local time in seconds, got ${JSON.stringify(e.t)}.`);
        else if ((e.t as number) < 0 || (e.t as number) > duration) iss.err(`${epath}.t`, `time ${e.t} is outside 0..duration (${duration}).`);
        if (e.action !== 'attach' && e.action !== 'detach') iss.err(`${epath}.action`, `must be "attach" or "detach", got ${JSON.stringify(e.action)}.`);
        if (typeof e.prop !== 'string' || e.prop.length === 0) iss.err(`${epath}.prop`, 'required: a prop id string (e.g. "cup").');
        if (e.bone !== undefined && !knownBones.has(e.bone as string)) {
          iss.err(`${epath}.bone`, `must be one of ${[...knownBones].join(', ')}, got ${JSON.stringify(e.bone)}.${suggest(String(e.bone), [...knownBones])}`);
        }
        if (e.grip !== undefined) {
          if (e.action === 'detach') iss.warn(`${epath}.grip`, 'grip is ignored for a detach event.');
          const g = e.grip as Record<string, unknown>;
          if (!isObj(g)) iss.err(`${epath}.grip`, 'expected { "position": [x,y,z], "rotation": [x,y,z], "scale"?: number }.');
          else {
            checkV3(iss, `${epath}.grip.position`, g.position, 'position');
            checkV3(iss, `${epath}.grip.rotation`, g.rotation, 'euler');
            if (g.scale !== undefined && (!isNum(g.scale) || (g.scale as number) <= 0)) iss.err(`${epath}.grip.scale`, `must be a number > 0, got ${JSON.stringify(g.scale)}.`);
          }
        }
        const knownEv = new Set(['t', 'action', 'prop', 'bone', 'grip']);
        for (const k of Object.keys(e)) {
          if (!knownEv.has(k)) iss.warn(`${epath}.${k}`, `unknown microEvent field "${k}" — ignored.${suggest(k, [...knownEv])}`);
        }
      });
      // Sanity: events should be time-ordered, and a detach should follow an
      // attach of the same prop (so nothing is left attached at clip end).
      const held = new Map<string, number>();
      let prevT = -Infinity;
      (m.microEvents as unknown as Record<string, unknown>[]).forEach((e, i) => {
        if (isNum(e.t)) { if ((e.t as number) < prevT) iss.warn(`microEvents[${i}].t`, `events are out of time order (previous at ${prevT}) — they fire in array order; sort by t.`); prevT = e.t as number; }
        if (typeof e.prop === 'string') {
          if (e.action === 'attach') held.set(e.prop, i);
          else if (e.action === 'detach') held.delete(e.prop);
        }
      });
      for (const [prop] of held) iss.warn('microEvents', `prop "${prop}" is attached but never detached — it will be force-returned to its rest when the clip ends/swaps, but author an explicit detach for a clean placement.`);
    }
  }

  // Anything we don't know about is probably a typo — surface it.
  const knownTop = new Set(['schema', 'id', 'label', 'notes', 'category', 'tags', 'posture', 'duration', 'loop',
    'fadeIn', 'fadeOut', 'hands', 'tracks', 'hipsTrack', 'rootMotion', 'oscillators', 'expressions', 'exprCues', 'gaze', 'lookAt', 'microEvents']);
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
