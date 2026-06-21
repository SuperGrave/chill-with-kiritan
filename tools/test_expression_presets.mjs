// Expression Preset System 0.1 — Node verification harness
//
// Usage:  node tools/test_expression_presets.mjs
//
// Compiles the framework-agnostic expression modules (plus the idle state
// machine that now references them) to CommonJS under <root>/.probe_tmp/ and
// asserts the brief's invariants:
//   1. preset ids unique / table keys consistent / all 18 required ids exist
//   2. every weight 0..1, every name known (standard + derived)
//   3. every derived morph NAME exists in the real kiritan.vrm (no fabrication)
//   4. merge clamps to 0..1 (max-blend)
//   5. cue envelope runs 0 -> 1 -> 0 with fadeIn/hold/fadeOut
//   6. preset OFF leaves zero residue in the overlay controller
//   7. derived registration: resolves, reports missing, never overwrites
//   8. idle states emit preset-derived overlays and crossfade continuously

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const outDir = path.join(root, '.probe_tmp', 'expr_test_build');

// --- 0. compile the modules under test (CommonJS so plain Node can require) ---
rmSync(outDir, { recursive: true, force: true });
const files = [
  'src/lib/expression/expressionPresets.ts',
  'src/lib/expression/expressionPresetEvaluator.ts',
  'src/lib/expression/registerDerivedExpressions.ts',
  'src/lib/motion/idleStateMachine.ts',
  'src/lib/motion/gazeController.ts',
  'src/lib/motion/dsl/evaluate.ts',
];
execSync(
  `npx tsc ${files.join(' ')} --ignoreConfig --outDir "${outDir}" --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);

const presets = require(path.join(outDir, 'expression', 'expressionPresets.js'));
const evaluator = require(path.join(outDir, 'expression', 'expressionPresetEvaluator.js'));
const reg = require(path.join(outDir, 'expression', 'registerDerivedExpressions.js'));
const idle = require(path.join(outDir, 'motion', 'idleStateMachine.js'));
const gaze = require(path.join(outDir, 'motion', 'gazeController.js'));
const ev = require(path.join(outDir, 'motion', 'dsl', 'evaluate.js'));

// --- tiny harness -------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- 1. preset table integrity --------------------------------------------------
console.log('[1] preset table integrity');
const table = presets.EXPRESSION_PRESETS;
const ids = presets.EXPRESSION_PRESET_IDS;
ok(new Set(ids).size === ids.length, 'preset ids are unique');
for (const [key, p] of Object.entries(table)) {
  ok(key === p.id, `table key matches id (${key})`);
}
// 0.2 (2026-06-13 user review): renamed glance_smile->smile, removed
// sleepy_soft_smile / pout / angry_light, merged yawn_* into yawn, added
// smile / wry_smile.
const required = [
  'neutral_soft', 'small_smile', 'smile', 'sleepy',
  'annoyed', 'sad_soft', 'surprised_light', 'thinking',
  'focused_monitor', 'bored', 'wry_smile', 'smug', 'embarrassed', 'yawn',
];
for (const id of required) ok(!!table[id], `required preset exists: ${id}`);
const removed = ['glance_smile', 'sleepy_soft_smile', 'pout', 'angry_light', 'yawn_start', 'yawn_peak', 'yawn_end'];
for (const id of removed) ok(!table[id], `removed preset is gone: ${id}`);

// --- 2. weights in range, names known -------------------------------------------
console.log('[2] weight ranges & known names');
const known = presets.ALL_EXPRESSION_NAMES;
for (const p of Object.values(table)) {
  for (const [name, w] of Object.entries(p.weights)) {
    ok(w > 0 && w <= 1, `${p.id}.weights.${name} in (0,1] (got ${w})`);
    ok(known.has(name), `${p.id}.weights.${name} is a known expression`);
  }
  for (const [k, v] of Object.entries(p.eyelid ?? {})) {
    ok(v >= 0 && v <= 1, `${p.id}.eyelid.${k} in 0..1 (got ${v})`);
  }
  if (p.lookAtHint?.strength !== undefined) {
    ok(p.lookAtHint.strength >= 0 && p.lookAtHint.strength <= 1, `${p.id}.lookAtHint.strength in 0..1`);
  }
  for (const [k, v] of Object.entries(p.timing ?? {})) {
    ok(v >= 0, `${p.id}.timing.${k} >= 0`);
  }
}

// --- 3. derived morph names exist in the REAL model ------------------------------
console.log('[3] derived morphs exist in kiritan.vrm');
const vrmPath = path.join(pkg, 'public', 'models', 'kiritan.vrm');
if (!existsSync(vrmPath)) {
  console.warn('  SKIP: kiritan.vrm not placed (redistribution-prohibited model) — name check skipped');
} else {
  const buf = readFileSync(vrmPath);
  ok(buf.readUInt32LE(0) === 0x46546c67, 'kiritan.vrm is a GLB');
  let offset = 12;
  let json = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      json = JSON.parse(buf.subarray(offset + 8, offset + 8 + len).toString('utf8'));
      break;
    }
    offset += 8 + len;
  }
  ok(!!json, 'GLB JSON chunk parsed');
  const targetNames = new Set();
  for (const mesh of json?.meshes ?? []) {
    const names = mesh.extras?.targetNames ?? mesh.primitives?.[0]?.extras?.targetNames ?? [];
    for (const n of names) targetNames.add(n);
  }
  for (const def of presets.DERIVED_EXPRESSIONS) {
    for (const m of def.morphs) {
      ok(targetNames.has(m.name), `derived "${def.id}" morph 「${m.name}」 exists in the model`);
    }
  }
  // standard names really are in blendShapeMaster
  const groups = json?.extensions?.VRM?.blendShapeMaster?.blendShapeGroups ?? [];
  const groupNames = new Set(groups.filter((g) => (g.binds ?? []).length > 0).map((g) => (g.presetName || g.name || '').toLowerCase()));
  for (const n of presets.STANDARD_EXPRESSION_NAMES) {
    const alias = { blinkleft: 'blink_l', blinkright: 'blink_r' }[n] ?? n;
    ok(groupNames.has(alias), `standard "${n}" has binds in blendShapeMaster`);
  }
}

// --- 4. merge clamps -------------------------------------------------------------
console.log('[4] mergeExpressionWeights clamps & max-blends');
const merged = evaluator.mergeExpressionWeights({ fun: 0.4, blink: 2.5 }, { fun: 0.9, jitome: -0.3 }, undefined, { fun: 0.2 });
ok(approx(merged.fun, 0.9), 'max-blend picks the largest (fun=0.9)');
ok(approx(merged.blink, 1), 'over-range input clamps to 1');
ok(!('jitome' in merged), 'negative weights are dropped');

// flatten: intensity scaling + eyelid collapse (0.2: sleepy halfLid 0.33, komaru 0.07)
const flatSleepy = presets.flattenPresetWeights(table.sleepy, 0.5);
ok(approx(flatSleepy.blink, 0.33 * 0.5), 'flatten: halfLid -> blink x intensity');
ok(approx(flatSleepy.komaru, 0.07 * 0.5, 1e-9), 'flatten: weights x intensity');
const overlaySleepy = presets.presetExprOverlay('sleepy');
ok(!('blink' in overlaySleepy), 'presetExprOverlay excludes the eyelid channel');
// smug asymmetry: a single-eye half-blink flattens onto blinkleft
const flatSmug = presets.flattenPresetWeights(table.smug, 1);
ok(approx(flatSmug.blinkleft, 0.25, 1e-9), 'flatten: eyelid.blinkLeft -> blinkleft (smug asymmetry)');

// flutter (0.2): sustained-state intensity wobble, pure in t
console.log('[4b] intensity flutter');
ok(approx(presets.flutterValue(table.sleepy, 1.5), 1.0, 1e-6), 'sleepy flutter peaks at max (1.0) at quarter period');
ok(approx(presets.flutterValue(table.sleepy, 4.5), 0.5, 1e-6), 'sleepy flutter troughs at min (0.5)');
ok(approx(presets.flutterValue(table.bored, 0), 0.9, 1e-6), 'bored flutter midpoint at t=0 (0.8..1.0)');
ok(presets.flutterValue(table.neutral_soft, 99) === 1, 'no-flutter preset returns 1');

// --- 5. cue envelope 0 -> 1 -> 0 ---------------------------------------------------
console.log('[5] cue envelope & timeline');
const cue = { presetId: 'smile', start: 2, fadeIn: 0.5, hold: 1.0, fadeOut: 0.5 };
const env = (t) => evaluator.cueEnvelope(cue, table.smile, t);
ok(env(0) === 0 && env(1.99) === 0, 'envelope is 0 before start');
ok(approx(env(2.25), 0.5), 'mid fadeIn = 0.5 (smoothstep)');
ok(env(2.5) === 1 && env(3.5) === 1, 'peak held through hold');
ok(approx(env(3.75), 0.5), 'mid fadeOut = 0.5');
ok(env(4.0) === 0 && env(99) === 0, 'envelope returns to 0 after fadeOut');
const openEnded = { presetId: 'sleepy', start: 0, fadeIn: 0.2, hold: Infinity };
ok(evaluator.cueEnvelope(openEnded, table.sleepy, 1000) === 1, 'hold: Infinity stays at 1');

const cuesOut = evaluator.evaluateExpressionCues(
  [cue, { presetId: 'surprised_light', start: 2.4, fadeIn: 0.1, hold: 1, fadeOut: 0.5 }],
  3.0,
);
ok(approx(cuesOut.weights.fun, table.smile.weights.fun, 1e-3), 'overlapping cues keep each weight (fun from smile)');
ok(approx(cuesOut.weights.bikkuri, table.surprised_light.weights.bikkuri, 1e-3), 'overlapping cues keep each weight (bikkuri from surprise)');
ok(cuesOut.activePresetId === 'surprised_light', 'higher-priority cue wins the active slot');
const unknownOut = evaluator.evaluateExpressionCues([{ presetId: 'no_such_preset', start: 0 }], 1);
ok(Object.keys(unknownOut.weights).length === 0 && unknownOut.activePresetId === null, 'unknown preset id is skipped safely');

// gaze hint flows from the winning cue's preset (0.2: thinking looks ちょい上)
const gazeCue = evaluator.evaluateExpressionCues([{ presetId: 'thinking', start: 0, fadeIn: 0.4, hold: 5 }], 2.0);
ok(gazeCue.gazeFix.k > 0.9 && approx(gazeCue.gazeFix.pitch, 18, 0.1) && approx(gazeCue.gazeFix.yaw, 12, 0.1), 'thinking cue emits its fixed upward gaze');
const wanderCue = evaluator.evaluateExpressionCues([{ presetId: 'bored', start: 0, fadeIn: 0.4, hold: 5 }], 2.0);
ok(approx(wanderCue.gazeWander, 0.5, 1e-6) && wanderCue.gazeFix.k === 0, 'bored cue damps wander to 0.5 with no fixed direction');

// --- 6. overlay controller: no residue after OFF -----------------------------------
console.log('[6] overlay controller envelope & OFF residue');
const ctl = new evaluator.ExpressionOverlayController();
let out = ctl.update(0.016);
ok(Object.keys(out.weights).length === 0, 'controller starts empty');
ok(out.gazeFix.k === 0 && out.gazeWander === 1, 'controller starts with neutral gaze');
ctl.setPreset('small_smile', 1);
for (let i = 0; i < 200; i++) out = ctl.update(0.016); // ~3.2s >> fadeIn 0.9
ok(approx(out.weights.fun ?? 0, 0.24, 1e-3), 'fade-in settles at preset weights (0.2: fun 0.24)');
ok(out.debug.presetId === 'small_smile' && !out.debug.fading, 'debug reports settled preset');
// mid-fade switch continuity (smile: both are flutter-free, so exact)
ctl.setPreset('smile', 1);
let prev = out.weights.joy ?? 0;
let maxStep = 0;
for (let i = 0; i < 200; i++) {
  out = ctl.update(0.016);
  const v = out.weights.joy ?? 0;
  maxStep = Math.max(maxStep, Math.abs(v - prev));
  prev = v;
}
ok(maxStep < 0.05, `crossfade is continuous (max per-frame step ${maxStep.toFixed(4)} < 0.05)`);
ok(approx(out.weights.joy ?? 0, 0.1, 1e-3), 'smile joy settles');
// sleepy halfLid arrives on blink, wobbled by its flutter (0.165..0.33)
ctl.setPreset('sleepy', 1);
for (let i = 0; i < 150; i++) out = ctl.update(0.016); // let the 1.2s crossfade settle first
let minBlink = 1, maxBlink = 0;
for (let i = 0; i < 800; i++) { out = ctl.update(0.016); const b = out.weights.blink ?? 0; minBlink = Math.min(minBlink, b); maxBlink = Math.max(maxBlink, b); }
ok(maxBlink <= 0.34 && maxBlink >= 0.30, `sleepy lid peaks near halfLid ceiling 0.33 (got ${maxBlink.toFixed(3)})`);
ok(minBlink <= 0.20 && minBlink >= 0.14, `sleepy lid troughs near 0.165 via flutter (got ${minBlink.toFixed(3)})`);
// thinking sets a fixed upward gaze on the overlay
ctl.setPreset('thinking', 1);
for (let i = 0; i < 120; i++) out = ctl.update(0.016);
ok(out.gazeFix.k > 0.9 && approx(out.gazeFix.pitch, 18, 0.5), 'thinking overlay sets upward gaze fix');
ctl.setPreset(null);
for (let i = 0; i < 400; i++) out = ctl.update(0.016);
ok(Object.keys(out.weights).length === 0, 'preset OFF -> zero residue (empty weights)');
ok(out.gazeFix.k < 1e-3, 'preset OFF -> gaze fix decays to 0');
ok(approx(out.gazeWander, 1, 1e-3), 'preset OFF -> wander multiplier returns to 1');
// intensity slider does not retrigger fades (smug: flutter-free)
ctl.setPreset('smug', 1);
for (let i = 0; i < 100; i++) out = ctl.update(0.016);
ctl.setIntensity(0.4);
out = ctl.update(0.016);
ok(approx(out.weights.niyari ?? 0, table.smug.weights.niyari * 0.4, 0.02), 'setIntensity scales live weights');

// --- 7. derived registration honesty ----------------------------------------------
console.log('[7] registerDerivedExpressions');
const map = { blink: [{ index: 13, weight: 1 }], jitome: [{ index: 99, weight: 1 }] };
const meshes = [{ morphTargetDictionary: { 'びっくり': 22, 'にやり': 31 } }];
const report = reg.registerDerivedExpressions(map, meshes);
ok(report.registered.includes('bikkuri') && map.bikkuri?.[0]?.index === 22, 'resolves by morph NAME');
ok(report.skipped.includes('jitome') && map.jitome[0].index === 99, 'never overwrites an existing entry');
ok(report.missing.some((m) => m.id === 'pukuu' && m.morphNames.includes('ぷくー')), 'missing morphs reported, not faked');
ok(!('pukuu' in map), 'unresolvable derived expression is NOT registered');
// glTF-JSON fallback: UniVRM puts targetNames on PRIMITIVE extras (GLTFLoader
// ignores those, so dictionaries are numeric) — names must resolve via JSON.
const gltfJson = { meshes: [{ name: 'face', primitives: [{ extras: { targetNames: ['真面目', 'ぷくー'] } }] }] };
const nameIndex = reg.buildMorphNameIndex(gltfJson);
ok(nameIndex['ぷくー'] === 1 && nameIndex['真面目'] === 0, 'buildMorphNameIndex reads primitive extras');
const map2 = {};
const report2 = reg.registerDerivedExpressions(map2, [{ morphTargetDictionary: { 0: 0 } }], nameIndex);
ok(report2.registered.includes('pukuu') && map2.pukuu?.[0]?.index === 1, 'falls back to glTF JSON names when dictionaries are numeric');
// real-model integration: the full kiritan.vrm JSON resolves EVERY derived id
if (existsSync(vrmPath)) {
  const bufR = readFileSync(vrmPath);
  let off = 12, jsonR = null;
  while (off < bufR.length) {
    const len = bufR.readUInt32LE(off), type = bufR.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) { jsonR = JSON.parse(bufR.subarray(off + 8, off + 8 + len).toString('utf8')); break; }
    off += 8 + len;
  }
  const realIndex = reg.buildMorphNameIndex(jsonR);
  const map3 = {};
  const report3 = reg.registerDerivedExpressions(map3, [], realIndex);
  ok(report3.missing.length === 0, `every derived expression resolves against the real model (missing: ${report3.missing.map((m) => m.id).join(',') || 'none'})`);
  ok(map3.bikkuri?.[0]?.index === 22 && map3.jitome?.[0]?.index === 20, 'real-model indices match the audited dump (びっくり=22, じと目=20)');
}

// --- 8. idle machine emits preset-derived overlays ----------------------------------
console.log('[8] idle state machine x presets');
const m = new idle.IdleStateMachine();
let pose = m.update(0.016);
ok(approx(pose.expr.fun ?? 0, 0.12, 1e-6), 'idle_breath carries neutral_soft (fun 0.12)');
ok(pose.gaze && pose.gaze.k === 0, 'idle_breath gaze = wander (k 0)');
m.requestState('idle_glance_user');
// oneshot: settled after the 0.6s crossfade, auto-returns at dwell 2.5s —
// sample at ~1.6s (inside the hold window).
for (let i = 0; i < 100; i++) pose = m.update(0.016);
ok(approx(pose.expr.fun ?? 0, 0.28, 1e-3) && approx(pose.expr.joy ?? 0, 0.1, 1e-3), 'glance state carries smile weights (renamed from glance_smile)');
ok(pose.gaze.k > 0.9, 'glance state commits the eyes to the viewer (gaze k -> 1)');
m.requestState('idle_sleepy');
// Let the 1.2s crossfade from glance settle before measuring the steady-state
// flutter trough (the ramp-in passes through near-zero lid values).
for (let i = 0; i < 150; i++) pose = m.update(0.016);
let maxLid = 0, minLid = 1, maxExprStep = 0;
let prevFun = pose.expr.fun ?? 0;
for (let i = 0; i < 1000; i++) {
  pose = m.update(0.016);
  maxLid = Math.max(maxLid, pose.extraBlink);
  minLid = Math.min(minLid, pose.extraBlink);
  const v = pose.expr.fun ?? 0;
  maxExprStep = Math.max(maxExprStep, Math.abs(v - prevFun));
  prevFun = v;
}
ok(maxLid <= 0.34 && maxLid >= 0.30, `sleepy lid peaks near 0.33 ceiling via flutter (got ${maxLid.toFixed(3)})`);
ok(minLid <= 0.20 && minLid >= 0.14, `sleepy lid troughs near 0.165 via flutter (got ${minLid.toFixed(3)})`);
ok((pose.expr.komaru ?? 0) > 0, 'sleepy carries komaru brow from the preset');
ok(pose.gaze.pitch < 0 && pose.gaze.k > 0, 'sleepy gaze drifts downward');
ok(maxExprStep < 0.02, `expression crossfade continuous (max step ${maxExprStep.toFixed(4)})`);

// --- 9. gaze controller: wander bounds + layer override (0.2) ----------------------------
console.log('[9] gaze controller');
// Deterministic RNG so wander assertions are reproducible.
let seed = 12345;
const lcg = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gc = new gaze.GazeController(lcg);
let maxYaw = 0, maxPitch = 0;
for (let i = 0; i < 2000; i++) {
  const d = gc.update(0.1, { idleWander: 1 });
  maxYaw = Math.max(maxYaw, Math.abs(d.yaw));
  maxPitch = Math.max(maxPitch, Math.abs(d.pitch));
}
ok(maxYaw <= 12 + 1e-6, `wander yaw stays within ±12° (got ${maxYaw.toFixed(2)})`);
ok(maxPitch <= 7 + 1e-6, `wander pitch stays within bounds (got ${maxPitch.toFixed(2)})`);
ok(maxYaw > 4, 'wander actually roams (yaw is not stuck at 0)');
// idle wander damped to 0 -> eyes park near center
const parked = gc.update(0.016, { idleWander: 0 });
ok(Math.abs(parked.yaw) < 1e-6 && Math.abs(parked.pitch) < 1e-6, 'idleWander 0 parks the eyes at center');
// a fixed layer pulls fully to its direction at k=1 (overrides wander)
const fixed = gc.update(0.016, { idleWander: 1, motionFix: { yaw: 20, pitch: -10, k: 1 } });
ok(approx(fixed.yaw, 20, 1e-6) && approx(fixed.pitch, -10, 1e-6), 'motionFix k=1 overrides wander completely');
// output clamps to the eye range even if a layer over-asks
const clamped = gc.update(0.016, { motionFix: { yaw: 90, pitch: 90, k: 1 } });
ok(clamped.yaw <= 35 + 1e-6 && clamped.pitch <= 25 + 1e-6, 'gaze output clamps to the usable eye range');
// panel <-> world round trip
const pt = gaze.gazeDirToPanelPoint({ yaw: 18, pitch: 0 });
ok(pt.z === 1 && approx(pt.x, Math.tan(18 * Math.PI / 180), 1e-6), 'gazeDirToPanelPoint maps yaw via tan at 1m');
const back = gaze.offsetToGazeDir(pt.x, pt.y - gaze.GAZE_ANCHOR_Y, pt.z);
ok(approx(back.yaw, 18, 1e-3), 'offsetToGazeDir inverts gazeDirToPanelPoint');

// --- 10. DSL face timeline (exprCues + gaze + legacy lookAt) -----------------------------
console.log('[10] DSL face timeline');
const motion = {
  schema: 'motion/1', id: 't', duration: 10, loop: false,
  exprCues: [
    { preset: 'smile', at: 2 },
    { preset: 'surprised_light', at: 5, hold: -1 }, // -1 = hold to the end
  ],
  gaze: { keys: [ { t: 0, to: 'front' }, { t: 3, to: 'up', move: 0.5 }, { t: 6, to: [25, 5] } ] },
};
const tl = ev.buildFaceTimeline(motion);
ok(!!tl, 'buildFaceTimeline returns a timeline when faces are present');
// exprCue produces weights at the right time (smile fades in over its 0.6s)
const f1 = ev.sampleFaceTimeline(tl, 2.7);
ok((f1.expressions.fun ?? 0) > 0 && f1.activeCuePreset === 'smile', 'smile cue active at t=2.7');
const f2 = ev.sampleFaceTimeline(tl, 2.0);
ok((f2.expressions.fun ?? 0) === 0, 'smile cue is silent before its start');
// hold:-1 cue still at peak far past its nominal hold (held to the end)
const f3 = ev.sampleFaceTimeline(tl, 9.5);
ok(approx(f3.expressions.bikkuri ?? 0, table.surprised_light.weights.bikkuri, 1e-3), 'hold:-1 cue holds to the end of the motion');
// gaze track: front held until t=3, then a 0.5s saccade to up
const g0 = ev.sampleFaceTimeline(tl, 1.0);
ok(g0.gaze && g0.gaze.k === 1 && g0.gaze.to.yaw === 0 && g0.gaze.to.pitch === 0, 'gaze holds front before the next key');
const g1 = ev.sampleFaceTimeline(tl, 3.25); // halfway through the 0.5s move
ok(approx(g1.gaze.k, 0.5, 1e-6) && g1.gaze.from.pitch === 0 && g1.gaze.to.pitch === 16, 'gaze saccade ramps front->up (smoothstep midpoint)');
const g2 = ev.sampleFaceTimeline(tl, 7.0); // raw degrees key
ok(g2.gaze.to.yaw === 25 && g2.gaze.to.pitch === 5, 'gaze accepts raw [yaw,pitch] degrees');
// gaze track WINS over the cue's preset gaze hint
const motionThink = { schema: 'motion/1', id: 't2', duration: 6, loop: false,
  exprCues: [{ preset: 'thinking', at: 0, hold: -1 }],
  gaze: { keys: [{ t: 0, to: 'down' }] } };
const tl2 = ev.buildFaceTimeline(motionThink);
const ft2 = ev.sampleFaceTimeline(tl2, 2.0);
ok(ft2.gaze.to.pitch < 0, 'explicit gaze track overrides the cue preset gaze hint (down beats thinking-up)');
// cue gaze hint used when there is NO gaze track
const tl3 = ev.buildFaceTimeline({ schema: 'motion/1', id: 't3', duration: 6, loop: false, exprCues: [{ preset: 'thinking', at: 0, hold: -1 }] });
const ft3 = ev.sampleFaceTimeline(tl3, 2.0);
ok(ft3.gaze && ft3.gaze.to.pitch === 18, 'with no gaze track, the cue preset gaze hint drives the eyes');
// legacy lookAt maps to a constant gaze
const tlLegacy = ev.buildFaceTimeline({ schema: 'motion/1', id: 't4', duration: 6, loop: false, lookAt: { mode: 'camera', strength: 0.7 } });
const fl = ev.sampleFaceTimeline(tlLegacy, 1.0);
ok(fl.gaze && fl.gaze.to === 'camera' && approx(fl.gaze.k, 0.7, 1e-6), 'legacy lookAt camera maps to gaze toward the camera');
// a motion with no face data builds no timeline
ok(ev.buildFaceTimeline({ schema: 'motion/1', id: 't5', duration: 6, loop: false }) === null, 'no face data -> null timeline (runtime skips the face channel)');

// --- summary --------------------------------------------------------------------------
console.log('');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
