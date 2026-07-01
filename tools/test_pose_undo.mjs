// Pose Composer 0.8 — Stage 3 Undo/Redo history verification harness.
//
// Usage:  node tools/test_pose_undo.mjs
//
// Compiles the THREE-math-only history module (poseHistory.ts) to CommonJS under
// <root>/.probe_tmp/pose_build and asserts the §11 command semantics:
//   1. snapshotsEqual: identity, q≡-q double-cover, bone-set / hips differences.
//   2. begin/commit: one gesture = one entry; no-op commit when unchanged.
//   3. undo/redo round-trips restore the exact snapshot; redo cleared by a new commit.
//   4. history cap (limit) bounds the undo depth; clear() empties everything.
//   5. cloneSnapshot deep-copies (stack never aliases live editing state).
//
// THREE math runs in Node with no WebGL, so this exercises the real code path.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const outDir = path.join(root, '.probe_tmp', 'pose_build');

// --- 0. compile -------------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/lab/poseComposer/poseHistory.ts --ignoreConfig --outDir "${outDir}" ` +
    `--module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);

const THREE = require(path.join(pkg, 'node_modules', 'three'));
const { PoseHistory, cloneSnapshot, snapshotsEqual } = require(path.join(outDir, 'poseHistory.js'));

// --- tiny harness -----------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

// snapshot builders --------------------------------------------------------
const qEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
/** snap({ bone: [x,y,z]rad, ... }, hipsOffset?) */
function snap(bones = {}, hipsOffset = null) {
  const overrides = new Map();
  for (const [bone, e] of Object.entries(bones)) overrides.set(bone, qEuler(e[0], e[1], e[2]));
  return { overrides, hipsOffset: hipsOffset ? [...hipsOffset] : null };
}

// ===========================================================================
// 1. snapshotsEqual
// ===========================================================================
section('1. snapshotsEqual (identity / q≡-q / differences)');
{
  ok(snapshotsEqual(snap(), snap()), 'empty == empty');
  ok(snapshotsEqual(snap({ head: [0.3, 0, 0.1] }), snap({ head: [0.3, 0, 0.1] })), 'same override == same override');

  // q and -q describe the same rotation → equal.
  const a = snap({ head: [0.5, 0.2, -0.3] });
  const b = cloneSnapshot(a);
  const q = b.overrides.get('head');
  q.set(-q.x, -q.y, -q.z, -q.w); // negate = double-cover twin
  ok(snapshotsEqual(a, b), 'q and -q are treated as equal (|dot|=1)');

  ok(!snapshotsEqual(snap({ head: [0.3, 0, 0] }), snap({ head: [0.3, 0, 0], neck: [0.1, 0, 0] })), 'different bone count != ');
  ok(!snapshotsEqual(snap({ head: [0.3, 0, 0] }), snap({ neck: [0.3, 0, 0] })), 'different bone name != ');
  ok(!snapshotsEqual(snap({ head: [0.3, 0, 0] }), snap({ head: [0.4, 0, 0] })), 'different rotation != ');
  ok(!snapshotsEqual(snap({}, [0, 0.1, 0]), snap({}, null)), 'hips offset present vs null != ');
  ok(!snapshotsEqual(snap({}, [0, 0.1, 0]), snap({}, [0, 0.2, 0])), 'different hips offset != ');
  ok(snapshotsEqual(snap({}, [0.05, -0.1, 0.2]), snap({}, [0.05, -0.1, 0.2])), 'same hips offset ==');
}

// ===========================================================================
// 2. begin/commit — one gesture = one entry
// ===========================================================================
section('2. begin / commit (one gesture = one entry)');
{
  const h = new PoseHistory(100);
  let live = snap();
  ok(!h.canUndo && !h.canRedo, 'fresh history: nothing to undo/redo');

  // A change folded across several mutations commits ONE entry.
  h.begin(live);
  live = snap({ head: [0.1, 0, 0] });
  live = snap({ head: [0.2, 0, 0] }); // keystrokes within the same group
  const pushed = h.commit(live);
  ok(pushed === true, 'commit after a real change pushes one entry');
  ok(h.depth.undo === 1, 'undo depth is 1 after one committed gesture');

  // A group with no net change pushes nothing.
  h.begin(live);
  const pushed2 = h.commit(cloneSnapshot(live));
  ok(pushed2 === false, 'commit with no change pushes nothing');
  ok(h.depth.undo === 1, 'unchanged gesture leaves depth at 1');

  // commit with no open group is a no-op.
  ok(h.commit(live) === false && h.depth.undo === 1, 'commit without begin is a no-op');
}

// ===========================================================================
// 3. undo / redo round-trips + redo invalidation
// ===========================================================================
section('3. undo / redo round-trips');
{
  const h = new PoseHistory(100);
  const s0 = snap();
  const s1 = snap({ head: [0.2, 0, 0] });
  const s2 = snap({ head: [0.2, 0, 0], neck: [0.1, 0, 0] });

  h.begin(s0); h.commit(s1); // entry: s0 -> s1
  h.begin(s1); h.commit(s2); // entry: s1 -> s2
  ok(h.depth.undo === 2 && h.depth.redo === 0, 'two committed edits, no redo');

  // undo from current s2 → restores s1
  let restored = h.undo(s2);
  ok(snapshotsEqual(restored, s1), 'undo #1 restores s1');
  ok(h.depth.undo === 1 && h.depth.redo === 1, 'stacks: undo 1 / redo 1');

  // undo again → restores s0
  restored = h.undo(restored);
  ok(snapshotsEqual(restored, s0), 'undo #2 restores s0 (original)');
  ok(!h.canUndo, 'nothing left to undo at the base state');
  ok(h.undo(s0) === null, 'undo past the base returns null');

  // redo → back to s1, then s2
  restored = h.redo(s0);
  ok(snapshotsEqual(restored, s1), 'redo #1 restores s1');
  restored = h.redo(restored);
  ok(snapshotsEqual(restored, s2), 'redo #2 restores s2');
  ok(h.redo(s2) === null, 'redo past the top returns null');

  // A NEW commit after undo invalidates redo (§11).
  restored = h.undo(s2); // back to s1, redo now has s2
  ok(h.canRedo, 'redo available after an undo');
  h.begin(restored); h.commit(snap({ head: [0.9, 0, 0] })); // new branch
  ok(!h.canRedo, 'a fresh commit clears the redo stack');
}

// ===========================================================================
// 4. history cap + clear
// ===========================================================================
section('4. history cap (limit) + clear');
{
  const h = new PoseHistory(100);
  let prev = snap();
  // Steps of 0.05 rad are well above the snapshot epsilon so every commit is a
  // distinct entry (small sub-epsilon deltas are intentionally deduped — tested above).
  for (let i = 1; i <= 130; i++) {
    const next = snap({ head: [i * 0.05, 0, 0] });
    h.begin(prev); h.commit(next);
    prev = next;
  }
  ok(h.depth.undo === 100, `undo depth capped at 100 (got ${h.depth.undo})`);

  // The oldest entries were dropped: we can undo exactly 100 times, no more.
  let steps = 0;
  let cur = prev;
  while (h.canUndo) { cur = h.undo(cur); steps++; if (steps > 200) break; }
  ok(steps === 100, `exactly 100 undo steps available after cap (got ${steps})`);

  h.clear();
  ok(!h.canUndo && !h.canRedo && !h.hasPending, 'clear() empties undo/redo/pending');
}

// ===========================================================================
// 5. cloneSnapshot deep-copies
// ===========================================================================
section('5. cloneSnapshot isolation');
{
  const original = snap({ head: [0.3, 0, 0] }, [0, 0.1, 0]);
  const copy = cloneSnapshot(original);
  // mutate the copy's quaternion + hips; the original must be untouched.
  copy.overrides.get('head').set(9, 9, 9, 9);
  copy.hipsOffset[1] = 99;
  ok(Math.abs(original.overrides.get('head').x - 0.14944) < 0.01, 'original quaternion unchanged by copy mutation');
  ok(original.hipsOffset[1] === 0.1, 'original hips offset unchanged by copy mutation');
  ok(copy.overrides !== original.overrides, 'override maps are distinct instances');
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Pose Composer Stage 3 (undo/redo): ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('ALL PASS — PoseHistory snapshot/command semantics verified.');
