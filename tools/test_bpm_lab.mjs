import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, '02_ui-overlay');
const outDir = path.join(root, '.probe_tmp', 'bpm_lab_build');
rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc ../04_bpm-lab/src/algorithms.ts src/lib/spectrumMath.ts --ignoreConfig --outDir "${outDir}" --rootDir .. --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: overlay, stdio: 'inherit' },
);

const algorithms = require(path.join(outDir, '04_bpm-lab', 'src', 'algorithms.js'));
const { BpmComparisonAnalyzer, chooseConsensusCandidate, makeSyntheticBands } = algorithms;

let passed = 0;
const failures = [];
function ok(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function runSynthetic(bpm, mode = 'full', seconds = 16) {
  const analyzer = new BpmComparisonAnalyzer({ stableMs: 3000 });
  let frame = null;
  for (let at = 0; at <= seconds * 1000; at += 1000 / 30) {
    frame = analyzer.process(makeSyntheticBands(bpm, at, mode), at);
  }
  return frame;
}

function runJitteredSynthetic(bpm, seconds = 16) {
  const analyzer = new BpmComparisonAnalyzer({ stableMs: 3000 });
  const steps = [27, 39, 31, 36, 29, 42, 33];
  let frame = null;
  let at = 0;
  let index = 0;
  while (at <= seconds * 1000) {
    frame = analyzer.process(makeSyntheticBands(bpm, at), at);
    at += steps[index % steps.length];
    index++;
  }
  return frame;
}

console.log('\n=== Full-band synthetic fixtures ===');
for (const bpm of [88, 120, 174]) {
  const frame = runSynthetic(bpm);
  // At 30 analysis frames/s a 174 BPM onset falls on alternating 333/367 ms
  // frames, so a single-frame detector may quantize it near 180 BPM.
  const tolerance = bpm >= 160 ? 7 : 3;
  ok(Math.abs(frame.legacy.bpm - bpm) <= tolerance, `${bpm}: legacy detector`);
  ok(Math.abs(frame.flux.bpm - bpm) <= tolerance, `${bpm}: spectral-flux detector`);
  ok(Math.abs(frame.superflux.bpm - bpm) <= tolerance, `${bpm}: SuperFlux-lite detector`);
  ok(Math.abs(frame.autocorr.bpm - bpm) <= Math.max(5, tolerance), `${bpm}: autocorrelation detector`);
  ok(Math.abs(frame.comb.bpm - bpm) <= Math.max(5, tolerance), `${bpm}: multiband comb detector`);
  ok(Math.abs(frame.dp.bpm - bpm) <= Math.max(5, tolerance), `${bpm}: dynamic pulse detector`);
  ok(Math.abs(frame.pulse.bpm - bpm) <= Math.max(5, tolerance), `${bpm}: state pulse bank`);
  ok(Math.abs(frame.consensus.bpm - bpm) <= tolerance, `${bpm}: consensus detector`);
  ok(frame.consensus.support >= 2, `${bpm}: consensus has at least two votes`);
}

console.log('\n=== Bass-light fixture ===');
{
  const frame = runSynthetic(120, 'bass-light');
  ok(frame.legacy.bpm === null || Math.abs(frame.legacy.bpm - 120) > 4,
    'legacy low-band detector is allowed to miss bass-light material');
  ok(Math.abs(frame.flux.bpm - 120) <= 3, 'spectral flux still finds 120 BPM');
  ok(Math.abs(frame.superflux.bpm - 120) <= 3, 'SuperFlux-lite still finds bass-light 120 BPM');
  ok(Math.abs(frame.autocorr.bpm - 120) <= 5, 'autocorrelation still finds 120 BPM');
  ok(Math.abs(frame.comb.bpm - 120) <= 5, 'multiband comb still finds bass-light 120 BPM');
  ok(Math.abs(frame.dp.bpm - 120) <= 5, 'dynamic pulse still finds bass-light 120 BPM');
  ok(Math.abs(frame.pulse.bpm - 120) <= 5, 'state pulse bank recovers bass-light 120 BPM');
  ok(Math.abs(frame.consensus.bpm - 120) <= 4, '5-way consensus recovers bass-light 120 BPM');
}

console.log('\n=== Callback jitter fixture ===');
{
  const frame = runJitteredSynthetic(120);
  ok(Math.abs(frame.superflux.bpm - 120) <= 4, 'SuperFlux-lite tolerates irregular callbacks');
  ok(Math.abs(frame.comb.bpm - 120) <= 5, 'multiband comb resamples callback jitter');
  ok(Math.abs(frame.dp.bpm - 120) <= 5, 'dynamic pulse resamples callback jitter');
  ok(Math.abs(frame.pulse.bpm - 120) <= 5, 'state pulse bank remains stable with callback jitter');
  ok(Math.abs(frame.consensus.bpm - 120) <= 5, 'consensus remains stable with callback jitter');
}

console.log('\n=== Harmonic consensus ===');
{
  const candidate = chooseConsensusCandidate([
    { id: 'legacy', bpm: 88, confidence: 0.8 },
    { id: 'flux', bpm: 176, confidence: 0.7 },
    { id: 'autocorr', bpm: 87, confidence: 0.9 },
  ], 50, 220);
  ok(candidate !== null && Math.abs(candidate.bpm - 88) <= 2,
    '88 / 176 / 87 normalizes to the 88 BPM family');
  ok(candidate?.support === 3, 'all three harmonic votes are retained');
}

console.log(`\nBPM Lab: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
