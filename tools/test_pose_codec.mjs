// Pose Composer 0.8 — Stage 4 pose asset codec verification harness.
//
// Usage:  node tools/test_pose_codec.mjs
//
// Compiles poseAssetCodec.ts (+ its poseMath / DSL validate deps) to CommonJS and
// asserts encode/decode against the pose/1 schema:
//   1. changed-vs-T-pose selection: identity bones omitted, the arm-drop kept.
//   2. encode -> decode round-trips the authoring override exactly.
//   3. validation reuse: bad schema rejected; unknown bones reported (not thrown).
//   4. hipsOffset written iff non-zero.
//   5. real-file round-trip: public/poses/stand_relaxed.pose.json decodes under the
//      viewer's ±1.2 arm reference and re-encodes to the same ~1.15 arm eulers.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const outDir = path.join(pkg, '.probe_tmp', 'pose_codec_build');

rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/lab/poseComposer/poseAssetCodec.ts src/lib/lab/poseComposer/poseMath.ts ` +
    `--ignoreConfig --rootDir src --outDir "${outDir}" --module commonjs --target es2022 ` +
    `--moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'package.json'), '{"type":"commonjs"}\n');

const THREE = require(path.join(pkg, 'node_modules', 'three'));
const codec = require(path.join(outDir, 'lib', 'lab', 'poseComposer', 'poseAssetCodec.js'));
const poseMath = require(path.join(outDir, 'lib', 'lab', 'poseComposer', 'poseMath.js'));
const { encodePose, decodePose, serializePose } = codec;
const { quatsEqual } = poseMath;

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) { if (cond) pass++; else { fail++; failures.push(label); console.error(`  ✗ FAIL: ${label}`); } }
function section(t) { console.log(`\n=== ${t} ===`); }

const qE = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));

/** A viewer-like reference: identity everywhere except the ±1.2 upper-arm drop. */
function makeReference() {
  const ref = new Map();
  for (const b of ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'rightShoulder',
    'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg']) {
    ref.set(b, new THREE.Quaternion());
  }
  ref.set('leftUpperArm', qE(0, 0, 1.2));
  ref.set('rightUpperArm', qE(0, 0, -1.2));
  return ref;
}

// ===========================================================================
section('1. changed-vs-T-pose bone selection');
{
  const ref = makeReference();
  const overrides = new Map([['head', qE(0.2, 0, 0.1)]]);
  const doc = encodePose({ id: 'p1', reference: ref, overrides });
  ok(doc.schema === 'pose/1' && doc.id === 'p1', 'encodes a pose/1 doc with id');
  ok('head' in doc.bones, 'edited bone (head) is written');
  ok('leftUpperArm' in doc.bones && 'rightUpperArm' in doc.bones, 'arm-drop bones are written (non-identity vs T-pose)');
  ok(!('spine' in doc.bones) && !('neck' in doc.bones) && !('hips' in doc.bones), 'identity bones are omitted (changed-only)');
  // the arm eulers are the T-pose-absolute drop, not zero
  ok(Math.abs(doc.bones.leftUpperArm[2] - 1.2) < 1e-4, 'leftUpperArm writes its ~1.2 rad absolute drop');
}

// ===========================================================================
section('2. encode -> decode round-trips the override');
{
  const ref = makeReference();
  const overrides = new Map([
    ['head', qE(0.2, -0.1, 0.15)],
    ['rightLowerArm', qE(0, -0.5, 0)],
    ['spine', qE(0.05, 0, 0.05)],
  ]);
  const doc = encodePose({ id: 'p2', reference: ref, overrides });
  const dec = decodePose(doc, ref);
  ok(dec.ok, 'decode ok');
  // arms encode to non-identity but decode to identity offset (already at reference)
  // ⇒ decoded overrides == the original authored set, exactly.
  ok(dec.overrides.size === overrides.size, `decoded override count matches (${dec.overrides.size} vs ${overrides.size})`);
  let allMatch = true;
  for (const [bone, q] of overrides) {
    const q2 = dec.overrides.get(bone);
    if (!q2 || !quatsEqual(q, q2, 1e-5)) { allMatch = false; console.error(`    mismatch: ${bone}`); }
  }
  ok(allMatch, 'every authored bone round-trips to the same offset');
  ok(!dec.overrides.has('leftUpperArm'), 'unedited arm decodes to reference (no override)');
}

// ===========================================================================
section('3. validation reuse (never throws)');
{
  const ref = makeReference();
  const bad = decodePose({ schema: 'nope', id: 'x', bones: {} }, ref);
  ok(!bad.ok && bad.errors.length > 0, 'bad schema rejected with errors');

  const noId = decodePose({ schema: 'pose/1', bones: { head: [0, 0, 0] } }, ref);
  ok(!noId.ok, 'missing id rejected');

  const missing = decodePose({ schema: 'pose/1', id: 'm', bones: { head: [0.1, 0, 0], leftToes: [0.2, 0, 0] } }, ref);
  ok(missing.ok, 'valid doc with an absent bone still decodes ok');
  ok(missing.missingBones.includes('leftToes'), 'a model-absent bone is reported in missingBones');
  ok(missing.overrides.has('head') && !missing.overrides.has('leftToes'), 'absent bone is skipped, present bone applied');
}

// ===========================================================================
section('4. hipsOffset written iff non-zero');
{
  const ref = makeReference();
  const withHips = encodePose({ id: 'h1', reference: ref, overrides: new Map(), hipsOffset: [0, -0.08, 0] });
  ok(Array.isArray(withHips.hipsOffset) && Math.abs(withHips.hipsOffset[1] + 0.08) < 1e-6, 'non-zero hips offset is written');
  const zeroHips = encodePose({ id: 'h2', reference: ref, overrides: new Map(), hipsOffset: [0, 0, 0] });
  ok(zeroHips.hipsOffset === undefined, 'zero hips offset is omitted');
  const decoded = decodePose(withHips, ref);
  ok(decoded.hipsOffset && Math.abs(decoded.hipsOffset[1] + 0.08) < 1e-6, 'hips offset round-trips through decode');
}

// ===========================================================================
section('5. real-file round-trip (stand_relaxed under the ±1.2 arm reference)');
{
  const ref = makeReference();
  const raw = JSON.parse(readFileSync(path.join(pkg, 'public', 'poses', 'stand_relaxed.pose.json'), 'utf8'));
  const dec = decodePose(raw, ref);
  ok(dec.ok, 'stand_relaxed decodes ok');
  // leftUpperArm z=1.15 with reference 1.2 ⇒ small non-identity offset ⇒ override.
  ok(dec.overrides.has('leftUpperArm'), 'the 1.15 arm differs from the 1.2 reference ⇒ override captured');
  const re = encodePose({ id: 'stand_relaxed', reference: ref, overrides: dec.overrides });
  ok(Math.abs(re.bones.leftUpperArm[2] - 1.15) < 1e-4, 're-encoded leftUpperArm reproduces the 1.15 absolute');
  ok(Math.abs(re.bones.rightUpperArm[2] + 1.15) < 1e-4, 're-encoded rightUpperArm reproduces the -1.15 absolute');
  ok(typeof serializePose(re) === 'string' && serializePose(re).endsWith('\n'), 'serializePose emits trailing-newline JSON');
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Pose Composer Stage 4 (pose codec): ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('ALL PASS — pose/1 encode/decode (changed-only, round-trip, validation) verified.');
