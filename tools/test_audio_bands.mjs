// Audio spectrum math verification harness.
//
// Usage:  node tools/test_audio_bands.mjs
//
// Compiles 02_ui-overlay/src/lib/spectrumMath.ts to CommonJS (same approach as
// test_director.mjs) and asserts the plan §7 cases: band map tiling, log-like
// low-end resolution, grouping/sensitivity, asymmetric smoothing, peak-hold
// fall, and beat detection on a synthetic kick pattern.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '02_ui-overlay');
const outDir = path.join(root, '.probe_tmp', 'spectrum_build');

rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/spectrumMath.ts --ignoreConfig --outDir "${outDir}" --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);

const {
  WE_CHANNEL_BUCKETS,
  capFrame,
  mixToMono,
  buildBandMap,
  groupBands,
  smoothBands,
  updatePeaks,
  computeBeat,
  createTempoTrackerState,
  recordTempoBeat,
  expireTempoTracking,
} = require(path.join(outDir, 'spectrumMath.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

// --- 1. capFrame -------------------------------------------------------------
section('1. capFrame');
{
  const raw = new Array(128).fill(0.5);
  raw[0] = 3.2; // WE spike
  raw[1] = -0.1;
  const capped = capFrame(raw);
  ok(capped[0] === 1, 'spikes above 1.0 are capped to 1');
  ok(capped[1] === 0, 'negatives clamp to 0');
  ok(Math.abs(capped[64] - 0.5) < 1e-9, 'in-range values pass through');
}

// --- 2. mixToMono ------------------------------------------------------------
section('2. mixToMono');
{
  const frame = new Float32Array(128);
  frame[3] = 0.8; // L bucket 3
  frame[64 + 3] = 0.4; // R bucket 3
  const mono = mixToMono(frame);
  ok(mono.length === 64, 'mono output has 64 buckets');
  ok(Math.abs(mono[3] - 0.6) < 1e-6, 'mono bucket is the L/R average');
}

// --- 3. buildBandMap ---------------------------------------------------------
section('3. buildBandMap');
for (const bars of [8, 16, 24, 32, 48]) {
  const map = buildBandMap(bars);
  ok(map.length === bars, `barCount ${bars}: one range per bar`);
  let tiles = map[0][0] === 0 && map[map.length - 1][1] === WE_CHANNEL_BUCKETS;
  let nonEmpty = true;
  for (let i = 0; i < map.length; i++) {
    if (map[i][1] <= map[i][0]) nonEmpty = false;
    if (i > 0 && map[i][0] !== map[i - 1][1]) tiles = false;
  }
  ok(tiles, `barCount ${bars}: ranges tile 0..64 exactly (no gap/overlap)`);
  ok(nonEmpty, `barCount ${bars}: every bar owns at least one bucket`);
  const lowWidth = map[0][1] - map[0][0];
  const highWidth = map[map.length - 1][1] - map[map.length - 1][0];
  ok(lowWidth <= highWidth, `barCount ${bars}: low band is not wider than high band (log-like)`);
}

// --- 4. groupBands -----------------------------------------------------------
section('4. groupBands');
{
  const map = buildBandMap(16);
  const mono = new Float32Array(64);
  const [s0, e0] = map[5];
  mono[s0] = 0.3;
  if (e0 - s0 > 1) mono[e0 - 1] = 0.7; // band takes the max of its buckets
  const bands = groupBands(mono, map, 1);
  const expected = e0 - s0 > 1 ? 0.7 : 0.3;
  ok(Math.abs(bands[5] - expected) < 1e-6, 'band level = max of its buckets');
  const boosted = groupBands(mono, map, 2);
  ok(Math.abs(boosted[5] - Math.min(1, expected * 2)) < 1e-6, 'sensitivity scales and caps at 1');
  ok(bands.every((v, i) => (i === 5 ? true : v === 0)), 'untouched bands stay zero');
}

// --- 5. smoothBands ----------------------------------------------------------
section('5. smoothBands');
{
  const prev = new Float32Array([0, 0.8]);
  smoothBands(prev, [1, 0], 0.5, 0.1);
  ok(Math.abs(prev[0] - 0.5) < 1e-6, 'rising bar uses attack factor');
  ok(Math.abs(prev[1] - 0.72) < 1e-6, 'falling bar uses (slower) decay factor');
}

// --- 6. updatePeaks ----------------------------------------------------------
section('6. updatePeaks');
{
  const peaks = new Float32Array([0.5, 0.2]);
  updatePeaks(peaks, [0.9, 0.0], 0.05);
  ok(Math.abs(peaks[0] - 0.9) < 1e-6, 'peak rides the bar up instantly');
  ok(Math.abs(peaks[1] - 0.15) < 1e-6, 'peak falls by fallPerFrame when above the bar');
  for (let i = 0; i < 10; i++) updatePeaks(peaks, [0, 0], 0.05);
  ok(peaks[1] === 0, 'peak never falls below the bar (floor at 0)');
}

// --- 7. computeBeat ----------------------------------------------------------
section('7. computeBeat');
{
  const state = { avg: 0, cooldown: 0 };
  const silent = new Float32Array(128);
  const kickFrame = new Float32Array(128);
  for (let i = 0; i < 4; i++) {
    kickFrame[i] = 0.9;
    kickFrame[64 + i] = 0.9;
  }
  // Settle the average on silence, then hit a kick.
  for (let i = 0; i < 30; i++) computeBeat(silent, state);
  const hit = computeBeat(kickFrame, state);
  ok(hit.beat === true, 'clear bass onset after silence fires a beat');
  ok(hit.bassEnergy > 0.8, 'bass energy reflects the kick level');
  const immediate = computeBeat(kickFrame, state);
  ok(immediate.beat === false, 'refractory period suppresses back-to-back beats');
  // Sustained constant bass should stop firing once the average catches up.
  let lateBeats = 0;
  for (let i = 0; i < 120; i++) {
    if (computeBeat(kickFrame, state).beat) lateBeats++;
  }
  const tail = [];
  for (let i = 0; i < 30; i++) tail.push(computeBeat(kickFrame, state).beat);
  ok(tail.every((b) => b === false), 'constant sustained bass stops reading as onsets');
  // And a fresh kick after a quiet gap fires again.
  for (let i = 0; i < 60; i++) computeBeat(silent, state);
  ok(computeBeat(kickFrame, state).beat === true, 'kick after a quiet gap fires again');
}

// --- 8. BPM tracking + five-second sync lock --------------------------------
section('8. BPM tracking + stable sync');
{
  const state = createTempoTrackerState();
  let snapshot;
  for (let at = 0; at <= 6000; at += 500) snapshot = recordTempoBeat(state, at);
  ok(snapshot.detectedBpm !== null && Math.abs(snapshot.detectedBpm - 120) < 0.01,
    '120 BPM onsets produce a real-time 120 BPM candidate');
  ok(snapshot.status === 'detecting' && snapshot.lockedBpm === null,
    'candidate does not lock before five continuous stable seconds');
  snapshot = recordTempoBeat(state, 6500);
  ok(snapshot.status === 'locked' && snapshot.lockedBpm === 120,
    '120 BPM locks after five continuous stable seconds');
  ok(snapshot.confidence >= 0.95, 'clean periodic onsets reach high confidence');

  const jittered = createTempoTrackerState();
  let at = 0;
  const jitterPattern = [500, 508, 493, 504, 497, 506, 495, 502];
  let jitterSnapshot;
  for (let i = 0; i < 17; i++) {
    jitterSnapshot = recordTempoBeat(jittered, at);
    at += jitterPattern[i % jitterPattern.length];
  }
  ok(jitterSnapshot.detectedBpm !== null && Math.abs(jitterSnapshot.detectedBpm - 120) < 1,
    'median/outlier filtering keeps a jittered 120 BPM estimate stable');
  ok(jitterSnapshot.status === 'locked', 'small timing jitter still earns the stable lock');

  const duplicate = createTempoTrackerState();
  recordTempoBeat(duplicate, 0);
  const ignored = recordTempoBeat(duplicate, 100);
  ok(ignored.detectedBpm === null && duplicate.beatTimes.length === 1,
    'near-duplicate onsets from one kick are ignored');

  const expired = expireTempoTracking(state, 10_000);
  ok(expired.status === 'standby' && expired.detectedBpm === null && expired.lockedBpm === null,
    'stopped audio expires the candidate and sync lock');

  const changed = createTempoTrackerState();
  let changedSnapshot;
  for (let beatAt = 0; beatAt <= 6500; beatAt += 500) changedSnapshot = recordTempoBeat(changed, beatAt);
  ok(changedSnapshot.lockedBpm === 120, 'tempo-change fixture starts locked at 120 BPM');
  let shiftAt = 7100;
  for (let i = 0; i < 16; i++, shiftAt += 600) changedSnapshot = recordTempoBeat(changed, shiftAt);
  ok(changedSnapshot.detectedBpm !== null && Math.abs(changedSnapshot.detectedBpm - 100) < 1,
    'a sustained tempo change is detected as the new BPM');
  ok(changedSnapshot.lockedBpm === null,
    'a materially changed tempo must complete a fresh stability window before re-sync');
}

// --- summary -----------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`Spectrum math: ${pass} checks passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILURES:\n  ' + failures.join('\n  '));
  process.exit(1);
}
