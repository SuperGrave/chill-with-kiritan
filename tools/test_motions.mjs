// Motion DSL — Node validation/seam/sample harness (no browser, no THREE).
//
// Usage:
//   node tools/test_motions.mjs <id> [<id> ...] [--samples t0,t1,...]
//   node tools/test_motions.mjs --all            (every *.motion.json)
//
// Mirrors loadMotionDoc.ts but reads from disk with fs (loadMotionDoc uses
// fetch, browser-only). For each motion it: validates (motion + posture + hand),
// builds the pure evaluator, checks the loop seam, samples poses at key/explicit
// times, and asserts no NaN / finite output. Prints offsets+hipsOffset at the
// ends so transition endpoints can be eyeballed numerically. Exits non-zero on
// any validation ERROR (warnings are listed but non-fatal) or seam failure.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const pub = path.join(pkg, 'public');
const outDir = path.join(root, '.probe_tmp', 'motion_build');

// --- compile the THREE-free DSL chain to CJS --------------------------------
rmSync(outDir, { recursive: true, force: true });
const files = [
  'src/lib/motion/dsl/types.ts',
  'src/lib/motion/dsl/validate.ts',
  'src/lib/motion/dsl/evaluate.ts',
  'src/lib/motion/dsl/microEvents.ts',
  'src/lib/motion/gazeController.ts',
  'src/lib/expression/expressionPresets.ts',
  'src/lib/expression/expressionPresetEvaluator.ts',
];
execSync(
  `npx tsc ${files.join(' ')} --ignoreConfig --outDir "${outDir}" --rootDir src/lib ` +
    `--module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);
const D = (m) => require(path.join(outDir, m));
const { validateMotion, validatePose, validateHand } = D('motion/dsl/validate.js');
const { buildEvaluator } = D('motion/dsl/evaluate.js');

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
let samples = null;
const ids = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--samples') samples = argv[++i].split(',').map(Number);
  else if (argv[i] === '--all') {
    for (const f of readdirSync(path.join(pub, 'motions', 'dsl'))) {
      if (f.endsWith('.motion.json') && !f.startsWith('_')) ids.push(f.replace('.motion.json', ''));
    }
  } else ids.push(argv[i]);
}
if (ids.length === 0) {
  console.error('usage: node tools/test_motions.mjs <id> [<id> ...] [--samples t0,t1] | --all');
  process.exit(2);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
let pass = 0;
let fail = 0;
const r3 = (e) => (e ? `[${e.map((n) => Math.round(n * 1000) / 1000).join(', ')}]` : '—');

for (const id of ids) {
  console.log(`\n=== ${id} ===`);
  const mFile = path.join(pub, 'motions', 'dsl', `${id}.motion.json`);
  if (!existsSync(mFile)) { console.error(`  ✗ missing ${mFile}`); fail++; continue; }
  const motion = readJson(mFile);

  const v = validateMotion(motion);
  for (const w of v.warnings) console.warn(`  ⚠ ${w.path}: ${w.message}`);
  if (!v.ok) { for (const e of v.errors) console.error(`  ✗ ERROR ${e.path}: ${e.message}`); fail++; continue; }
  if (motion.id !== id) console.warn(`  ⚠ id "${motion.id}" != file "${id}"`);

  // posture + hands
  let posture = null;
  if (motion.posture) {
    const pFile = path.join(pub, 'poses', `${motion.posture}.pose.json`);
    if (!existsSync(pFile)) { console.error(`  ✗ missing posture ${motion.posture}`); fail++; continue; }
    posture = readJson(pFile);
    const pv = validatePose(posture);
    if (!pv.ok) { for (const e of pv.errors) console.error(`  ✗ posture ${e.path}: ${e.message}`); fail++; continue; }
  }
  const loadHand = (hid) => {
    if (!hid) return null;
    const hFile = path.join(pub, 'poses', 'hands', `${hid}.hand.json`);
    if (!existsSync(hFile)) { console.error(`  ✗ missing hand ${hid}`); return undefined; }
    const h = readJson(hFile);
    const hv = validateHand(h);
    if (!hv.ok) { for (const e of hv.errors) console.error(`  ✗ hand ${e.path}: ${e.message}`); return undefined; }
    return h;
  };
  const leftHand = loadHand(motion.hands?.left);
  const rightHand = loadHand(motion.hands?.right);
  if (leftHand === undefined || rightHand === undefined) { fail++; continue; }

  const evalr = buildEvaluator({ motion, posture, leftHand, rightHand });

  // loop seam (loops only)
  if (evalr.loop) {
    const seam = evalr.checkLoopSeam();
    if (seam.ok) { pass++; console.log(`  ✓ loop seam ok (maxBoneDelta ${seam.maxBoneDelta.toFixed(4)})`); }
    else { fail++; console.error(`  ✗ loop seam FAIL: bones ${seam.maxBoneDelta.toFixed(4)} worst=${seam.worstBone} expr ${seam.maxExpressionDelta.toFixed(4)}`); }
  }

  // sample at key times + explicit + ends; assert finite.
  const keyTs = new Set([0, evalr.duration]);
  for (const tr of motion.tracks ? Object.values(motion.tracks) : []) for (const k of tr.keys) keyTs.add(k.t);
  if (motion.hipsTrack) for (const k of motion.hipsTrack.keys) keyTs.add(k.t);
  const ts = samples ?? [...keyTs].sort((a, b) => a - b);
  let finite = true;
  for (const t of ts) {
    const f = evalr.evalAt(t);
    for (const layers of Object.values(f.bones)) {
      for (const layer of [layers.posture, layers.hand, layers.offset]) {
        if (layer && layer.some((n) => !Number.isFinite(n))) finite = false;
      }
    }
    if (f.hipsOffset.some((n) => !Number.isFinite(n))) finite = false;
  }
  if (finite) pass++; else { fail++; console.error('  ✗ non-finite sample detected'); }
  console.log(`  ✓ sampled ${ts.length} times, all finite`);

  // endpoint dump (transition sanity): offsets + hipsOffset at start/end.
  for (const t of [0, evalr.duration]) {
    const f = evalr.evalAt(t);
    const offs = Object.entries(f.bones)
      .filter(([, l]) => l.offset && l.offset.some((n) => Math.abs(n) > 1e-4))
      .map(([b, l]) => `${b}${r3(l.offset)}`)
      .join(' ');
    console.log(`  t=${t.toFixed(2)} hips=${r3(f.hipsOffset)} offsets: ${offs || '(all ~0)'}`);
  }
}

// --- microEvent firing cursor unit test (INF-4) -----------------------------
{
  console.log('\n=== microEvents firing cursor ===');
  const { advanceMicroEvents, makeMicroCursor } = D('motion/dsl/microEvents.js');
  const evs = [
    { t: 2.0, action: 'attach', prop: 'cup', bone: 'leftHand' },
    { t: 6.0, action: 'detach', prop: 'cup' },
  ];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cur = makeMicroCursor();
  const chk = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.error(`  ✗ ${label}`); } };
  chk('t=1.0 → nothing yet', eq(advanceMicroEvents(evs, 1.0, cur), []));
  chk('t=2.0 → attach (idx 0)', eq(advanceMicroEvents(evs, 2.0, cur), [0]));
  chk('t=2.5 → already fired, nothing', eq(advanceMicroEvents(evs, 2.5, cur), []));
  chk('t=6.0 → detach (idx 1)', eq(advanceMicroEvents(evs, 6.0, cur), [1]));
  chk('t=6.5 → nothing (both fired)', eq(advanceMicroEvents(evs, 6.5, cur), []));
  // Loop wrap re-arms (time runs backwards).
  chk('t=0.1 (wrap) → re-armed, nothing yet', eq(advanceMicroEvents(evs, 0.1, cur), []));
  chk('t=2.0 (cycle 2) → attach again', eq(advanceMicroEvents(evs, 2.0, cur), [0]));
  // Two events at the same time fire together, in order.
  const cur2 = makeMicroCursor();
  const evs2 = [{ t: 1, action: 'detach', prop: 'a' }, { t: 1, action: 'attach', prop: 'b', bone: 'rightHand' }];
  chk('coincident events fire together in order', eq(advanceMicroEvents(evs2, 1.0, cur2), [0, 1]));
  // A big time jump still fires everything passed, in order.
  const cur3 = makeMicroCursor();
  chk('time jump fires all passed events in order', eq(advanceMicroEvents(evs, 9.0, cur3), [0, 1]));
}

// --- rootMotion determinism (INF-7) -----------------------------------------
{
  console.log('\n=== rootMotion sampling (INF-7) ===');
  const ev = buildEvaluator({
    motion: {
      schema: 'motion/1', id: '_rt', duration: 2, loop: false,
      rootMotion: { keys: [{ t: 0, p: [0, 0, 0], rotY: 0 }, { t: 2, p: [0, 0, 0.5], rotY: 0.4, ease: 'linear' }] },
    },
    posture: null, leftHand: null, rightHand: null,
  });
  const chk = (label, cond) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.error(`  ✗ ${label}`); } };
  const r0 = ev.evalAt(0).root;
  const r1a = ev.evalAt(1).root;
  const r1b = ev.evalAt(1).root;
  const r2 = ev.evalAt(2).root;
  chk('t=0 root is origin', JSON.stringify(r0) === JSON.stringify([0, 0, 0, 0]));
  chk('t=2 root reaches [0,0,0.5,0.4]', Math.abs(r2[2] - 0.5) < 1e-9 && Math.abs(r2[3] - 0.4) < 1e-9);
  chk('t=1 (linear midpoint) = half', Math.abs(r1a[2] - 0.25) < 1e-9 && Math.abs(r1a[3] - 0.2) < 1e-9);
  chk('sampling is deterministic (same t → same value)', JSON.stringify(r1a) === JSON.stringify(r1b));
  // No drift: re-sampling many times never accumulates (absolute eval).
  let drift = 0;
  for (let i = 0; i < 1000; i++) { const r = ev.evalAt(1.37).root; drift = Math.max(drift, Math.abs(r[2] - ev.evalAt(1.37).root[2])); }
  chk(`no drift over 1000 re-samples (${drift})`, drift === 0);
  // Monotonic advance over time.
  chk('root z monotonic in t', ev.evalAt(0.5).root[2] < ev.evalAt(1.5).root[2]);
  // A motion with no rootMotion samples all-zero root.
  const ev2 = buildEvaluator({ motion: { schema: 'motion/1', id: '_n', duration: 1, loop: true }, posture: null, leftHand: null, rightHand: null });
  chk('no rootMotion → root all-zero', JSON.stringify(ev2.evalAt(0.5).root) === JSON.stringify([0, 0, 0, 0]));
}

console.log(`\n${'='.repeat(50)}\nMotions: ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
