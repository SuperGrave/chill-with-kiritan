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
const { BpmComparisonAnalyzer, DETECTOR_IDS, chooseConsensusCandidate, makeSyntheticBands } = algorithms;
const MusicTempo = require(path.join(root, '04_bpm-lab', 'node_modules', 'music-tempo'));

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

function runBeatrootPcm(bpm, seconds = 12) {
  const sampleRate = 44_100;
  const samples = new Float32Array(sampleRate * seconds);
  for (let index = 0; index < samples.length; index++) {
    const phase = (index / sampleRate) % (60 / bpm);
    const kick = Math.sin(2 * Math.PI * 62 * phase) * Math.exp(-phase / 0.075);
    const tick = Math.sin(2 * Math.PI * 1_250 * phase) * Math.exp(-phase / 0.018);
    samples[index] = kick * 0.82 + tick * 0.24;
  }
  const tracker = new MusicTempo(samples, {
    hopSize: 441,
    timeStep: 0.01,
    minBeatInterval: 60 / 220,
    maxBeatInterval: 60 / 50,
  });
  return Number(tracker.tempo);
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

console.log('\n=== PCM fixtures ===');
ok(DETECTOR_IDS.length === 10, 'comparison registry exposes eight band and two PCM methods');
for (const bpm of [88, 120, 174]) {
  ok(Math.abs(runBeatrootPcm(bpm) - bpm) <= 2, `PCM BeatRoot finds ${bpm} BPM`);
}
{
  const analyzer = new BpmComparisonAnalyzer({ stableMs: 1000 });
  analyzer.updatePcmEstimate('pcm-realtime', 127, 0.75, 1000, 'test PCM event');
  const frame = analyzer.process(makeSyntheticBands(120, 1000), 1000);
  ok(frame.estimates['pcm-realtime'].bpm === 127, 'external PCM event is included in comparison frames');
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
