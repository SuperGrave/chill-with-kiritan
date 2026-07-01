// Pose Composer 0.8 — Stage 4 pose math verification harness.
//
// Usage:  node tools/test_pose_math.mjs
//
// Compiles poseMath.ts (THREE-math only) to CommonJS and asserts the basis
// conversion the master flagged as correctness-critical (テスト最優先):
//   1. euler <-> quat round-trips (XYZ, away from gimbal lock).
//   2. offset <-> absolute-local are exact inverses for any reference.
//   3. SAVE/LOAD (reference-offset <-> T-pose-absolute euler) round-trips the offset.
//   4. A loaded pose reproduces the saved absolute local, regardless of reference.
//   5. 10000x save->load->save has no drift.
//   6. reset is exact (identity offset survives the round-trip as identity).
//   7. q ≡ -q double-cover; arm-drop is preserved as its T-pose-absolute euler.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
// Compile INSIDE the package so the emitted `require('three')` resolves against
// 01_wallpaper/node_modules (poseMath constructs THREE.Quaternion at runtime).
const outDir = path.join(pkg, '.probe_tmp', 'pose_build');

rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/lab/poseComposer/poseMath.ts --ignoreConfig --outDir "${outDir}" ` +
    `--module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);
// 01_wallpaper/package.json is "type":"module"; mark this build dir as CommonJS
// so Node runs the commonjs emit as CJS (require/exports) while `three` still
// resolves upward via 01_wallpaper/node_modules.
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'package.json'), '{"type":"commonjs"}\n');

const THREE = require(path.join(pkg, 'node_modules', 'three'));
const M = require(path.join(outDir, 'poseMath.js'));
const {
  eulerToQuat, quatToEuler, offsetToAbsoluteLocal, absoluteLocalToOffset,
  poseEulerFromOffset, offsetFromPoseEuler, isIdentityQuat, quatsEqual,
} = M;

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) { if (cond) pass++; else { fail++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); } }
function section(t) { console.log(`\n=== ${t} ===`); }

const qE = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
const EPS = 1e-6;

// A spread of reference bases (identity, the arm drop, and an arbitrary rotation)
// and offsets, all away from gimbal lock (|y| < ~1.4).
const refs = [qE(0, 0, 0), qE(0, 0, 1.2), qE(0, 0, -1.2), qE(0.3, -0.5, 0.2)];
const offs = [
  qE(0, 0, 0), qE(0.4, 0, 0), qE(0, 0.5, 0), qE(0, 0, 0.6),
  qE(0.25, -0.3, 0.15), qE(-0.7, 0.2, -0.4), qE(1.0, 0, 0.5),
];

// ===========================================================================
section('1. euler <-> quat round-trip');
{
  const eulers = [[0,0,0],[0.3,0,0],[0,0.4,0],[0,0,0.5],[0.2,-0.3,0.4],[1.0,0.6,-0.8]];
  for (const e of eulers) {
    const q = eulerToQuat(e);
    const e2 = quatToEuler(q);
    ok(quatsEqual(q, eulerToQuat(e2), EPS), `euler ${e} survives quat round-trip`);
  }
}

// ===========================================================================
section('2. offset <-> absolute-local are exact inverses');
{
  for (const ref of refs) for (const off of offs) {
    const abs = offsetToAbsoluteLocal(ref, off);
    const off2 = absoluteLocalToOffset(ref, abs);
    ok(quatsEqual(off, off2, EPS), `abs->offset inverts offset->abs`);
    // and the other direction
    const abs2 = offsetToAbsoluteLocal(ref, off2);
    ok(quatsEqual(abs, abs2, EPS), `offset->abs inverts abs->offset`);
  }
}

// ===========================================================================
section('3. SAVE/LOAD round-trips the offset (reference-offset <-> T-pose absolute)');
{
  for (const ref of refs) for (const off of offs) {
    const poseEuler = poseEulerFromOffset(ref, off);   // SAVE
    const off2 = offsetFromPoseEuler(ref, poseEuler);  // LOAD
    ok(quatsEqual(off, off2, EPS), `offset survives save->load for a reference basis`);
  }
}

// ===========================================================================
section('4. a loaded pose reproduces the saved absolute local (any reference)');
{
  // A pose file stores absolute-from-T-pose eulers. Loading it under ANY reference
  // must reproduce that exact absolute local on screen.
  const savedAbs = [[0,0,1.15],[0.2,0,0.1],[0,-0.3,0.5],[0.6,0.4,-0.2]];
  for (const ref of refs) for (const pe of savedAbs) {
    const off = offsetFromPoseEuler(ref, pe);
    const abs = offsetToAbsoluteLocal(ref, off);
    ok(quatsEqual(abs, eulerToQuat(pe), EPS), `loaded pose ${pe} reproduces its absolute local`);
    // and re-saving yields the same pose euler
    const pe2 = poseEulerFromOffset(ref, off);
    ok(quatsEqual(eulerToQuat(pe), eulerToQuat(pe2), EPS), `re-save reproduces the pose euler`);
  }
}

// ===========================================================================
section('5. 10000x save->load->save : no drift');
{
  const ref = qE(0, 0, 1.2);        // the arm-drop basis (worst case: ref != identity)
  const orig = qE(0.35, -0.22, 0.5);
  let off = orig.clone();
  let drift = false;
  for (let i = 0; i < 10000; i++) {
    const pe = poseEulerFromOffset(ref, off);
    off = offsetFromPoseEuler(ref, pe);
    if (i % 1000 === 0 && !quatsEqual(off, orig, 1e-5)) drift = true;
  }
  ok(!drift, 'no drift sampled across 10000 iterations');
  ok(quatsEqual(off, orig, 1e-5), 'final offset equals the original after 10000 iterations');
}

// ===========================================================================
section('6. reset is exact');
{
  const ID = new THREE.Quaternion();
  for (const ref of refs) {
    // identity offset -> pose euler -> offset must return identity.
    const pe = poseEulerFromOffset(ref, ID);
    const off = offsetFromPoseEuler(ref, pe);
    ok(isIdentityQuat(off, EPS), 'identity offset round-trips to identity (exact reset)');
  }
  // identity reference + identity offset -> [0,0,0]
  const pe0 = poseEulerFromOffset(new THREE.Quaternion(), new THREE.Quaternion());
  ok(Math.hypot(pe0[0], pe0[1], pe0[2]) < EPS, 'identity/identity encodes to [0,0,0]');
}

// ===========================================================================
section('7. q ≡ -q double-cover + arm-drop preservation');
{
  const q = qE(0.4, 0.3, -0.5);
  const neg = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w);
  ok(quatsEqual(q, neg, EPS), 'q and -q compare equal');
  ok(!quatsEqual(q, qE(0.4, 0.3, -0.51), EPS), 'a genuinely different rotation compares unequal');

  // Arm at reference (offset identity) still saves as its T-pose-absolute drop.
  const pe = poseEulerFromOffset(qE(0, 0, 1.2), new THREE.Quaternion());
  ok(quatsEqual(eulerToQuat(pe), qE(0, 0, 1.2), EPS), 'unedited arm saves as its ~1.2 rad drop (not identity)');
  ok(!isIdentityQuat(qE(0, 0, 1.2), EPS), 'the arm-drop absolute is non-identity (so it is written)');
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Pose Composer Stage 4 (pose math): ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('ALL PASS — reference-offset <-> T-pose-absolute basis conversion verified.');
