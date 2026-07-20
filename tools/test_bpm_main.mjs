import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, '02_ui-overlay');
const outDir = path.join(root, '.probe_tmp', 'bpm_main_build');
rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/spectrumMath.ts src/lib/bpmAnalyzer.ts ../01_wallpaper/src/lib/motion/rhythmMotionController.ts --ignoreConfig --outDir "${outDir}" --rootDir .. --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: overlay, stdio: 'inherit' },
);

const { BpmAnalyzer, chooseConsensusCandidate } = require(
  path.join(outDir, '02_ui-overlay', 'src', 'lib', 'bpmAnalyzer.js'),
);
const { RhythmMotionController } = require(
  path.join(outDir, '01_wallpaper', 'src', 'lib', 'motion', 'rhythmMotionController.js'),
);

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

function syntheticFrame(bpm, elapsedMs, mode = 'full') {
  const frame = new Float32Array(128);
  const period = 60_000 / bpm;
  const phase = elapsedMs % period;
  const kick = Math.exp(-phase / 48);
  const body = Math.exp(-phase / 115);
  for (let channel = 0; channel < 2; channel++) {
    const base = channel * 64;
    for (let i = 0; i < 64; i++) {
      const floor = 0.012 + 0.006 * Math.sin(elapsedMs / 900 + i * 0.41 + channel * 0.2);
      const lowPulse = mode === 'full' && i < 4 ? kick * (0.92 - i * 0.08) : 0;
      const midPulse = i >= 10 && i < 28 ? body * (0.5 - Math.abs(i - 18) * 0.012) : 0;
      const highTick = i >= 34 && i < 48 ? kick * 0.16 : 0;
      frame[base + i] = Math.max(0, Math.min(1, floor + lowPulse + midPulse + highTick));
    }
  }
  return frame;
}

function analyze(bpm, mode = 'full', seconds = 16) {
  const analyzer = new BpmAnalyzer({ stableMs: 3_000 });
  let result;
  for (let at = 0; at <= seconds * 1_000; at += 1_000 / 30) {
    result = analyzer.process(syntheticFrame(bpm, at, mode), at);
  }
  return result;
}

console.log('\n=== Main BPM analyzer ===');
for (const bpm of [88, 120, 174]) {
  const result = analyze(bpm);
  const tolerance = bpm >= 160 ? 7 : 3;
  ok(Math.abs(result.estimates.consensus.lockedBpm - bpm) <= tolerance, `${bpm}: consensus locks near expected BPM`);
  ok(result.estimates.consensus.support >= 2, `${bpm}: consensus has two or more voters`);
}

{
  const result = analyze(120, 'bass-light');
  ok(result.estimates['low-band'].lockedBpm === null, 'bass-light: low-band may remain unlocked');
  ok(Math.abs(result.estimates['spectral-flux'].lockedBpm - 120) <= 3, 'bass-light: spectral flux locks');
  ok(Math.abs(result.estimates.autocorrelation.lockedBpm - 120) <= 5, 'bass-light: autocorrelation locks');
  ok(Math.abs(result.estimates.consensus.lockedBpm - 120) <= 3, 'bass-light: consensus still locks to 120');
}

{
  const candidate = chooseConsensusCandidate([
    { id: 'low-band', detectedBpm: 88, confidence: 0.8 },
    { id: 'spectral-flux', detectedBpm: 176, confidence: 0.75 },
    { id: 'autocorrelation', detectedBpm: 87, confidence: 0.9 },
  ], 50, 220);
  ok(candidate && Math.abs(candidate.bpm - 88) <= 2, 'half/double tempo votes normalize to one family');
  ok(candidate?.support === 3, 'harmonic consensus keeps all three votes');
}

console.log('\n=== Rhythm motion bridge ===');
{
  const controller = new RhythmMotionController();
  let frame = controller.update(0, 1 / 60, { enabled: true, strength: 1, mode: 'work_normal' });
  ok(!frame.active, 'motion stays idle before a stable BPM sync');
  controller.sync({ bpm: 120, lockedAt: 0 });
  controller.beat({ at: 500, lockedBpm: 120, energy: 1 });
  for (let i = 0; i < 30; i++) {
    frame = controller.update(500 + i * (1000 / 60), 1 / 60, { enabled: true, strength: 1, mode: 'work_normal' });
  }
  ok(frame.active && frame.weight > 0.2, 'stable BPM fades the additive motion in');
  const peak = Array.from({ length: 30 }, (_, i) =>
    controller.update(1000 + i * (1000 / 60), 1 / 60, { enabled: true, strength: 1, mode: 'work_normal' }).headPitch,
  ).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  ok(peak > 0 && peak < 0.04, 'head nod is visible but remains a small additive offset');
  const sleep = controller.update(1200, 1, { enabled: true, strength: 1, mode: 'sleep_desk' });
  ok(sleep.weight < frame.weight, 'sleep mode fades rhythm motion out');
  controller.rhythm({ status: 'detecting', lockedBpm: null });
  const unlocked = controller.update(1400, 1, { enabled: true, strength: 1, mode: 'work_normal' });
  ok(!unlocked.active, 'unlock stops producing rhythm offsets');
}

console.log('\n=== music_listen rhythm figures ===');

const musicInput = (strength = 0.35) => ({ enabled: true, strength, mode: 'music_listen' });

/** Run the controller at 60fps up to endMs, returning the last frame. */
function settleMusic(controller, fromMs, endMs) {
  let frame = null;
  for (let at = fromMs; at <= endMs; at += 1000 / 60) {
    frame = controller.update(at, 1 / 60, musicInput());
  }
  return frame;
}

{
  // Sway figure: slow tempo opens with 横揺れ, cycle = 2 beats, phase-locked.
  const c = new RhythmMotionController();
  c.sync({ bpm: 90, lockedAt: 0 });
  const settled = settleMusic(c, 0, 2000);
  ok(settled.active && settled.figure === 'sway', '90 BPM opens with the sway figure');
  ok(Math.abs(settled.smile - 0.38) < 0.08, 'grooving raises the smile toward its target');
  const beatMs = 60_000 / 90;
  const cycleMs = beatMs * 2;
  const sample = (ms) => c.update(ms, 1 / 60, musicInput()).spineRoll;
  const s0 = sample(3000);
  const sHalf = sample(3000 + cycleMs / 2);
  const sFull = sample(3000 + cycleMs);
  ok(Math.abs(s0) > 0.005 || Math.abs(sHalf) > 0.005, 'sway actually rolls the spine');
  ok(Math.abs(s0 - sFull) < 0.004, 'sway repeats after exactly 2 beats (tempo-locked)');
  ok(Math.abs(s0 + sHalf) < 0.004, 'sway mirrors after 1 beat (sinusoidal cycle)');
  ok(settled.rightFingerLift === 0, 'sway leaves the tapping hand alone');
}

{
  // Tempo change: the SAME controller speeds up when a faster BPM re-locks.
  const c = new RhythmMotionController();
  c.sync({ bpm: 60, lockedAt: 0 });
  settleMusic(c, 0, 2000);
  const slowCycle = (60_000 / 60) * 2;
  const a0 = c.update(3000, 1 / 60, musicInput()).spineRoll;
  const a1 = c.update(3000 + slowCycle, 1 / 60, musicInput()).spineRoll;
  ok(Math.abs(a0 - a1) < 0.004, '60 BPM sway repeats after 2s');
  c.sync({ bpm: 100, lockedAt: 4000 });
  settleMusic(c, 4000, 5000);
  const fastCycle = (60_000 / 100) * 2;
  const b0 = c.update(6000, 1 / 60, musicInput()).spineRoll;
  const b1 = c.update(6000 + fastCycle, 1 / 60, musicInput()).spineRoll;
  ok(Math.abs(b0 - b1) < 0.004, 're-lock at 100 BPM shortens the sway cycle to 1.2s');
}

{
  // Finger tap: mid tempo taps once per beat; the wrist lift rides along.
  const c = new RhythmMotionController();
  c.sync({ bpm: 128, lockedAt: 0 });
  const settled = settleMusic(c, 0, 2000);
  ok(settled.figure === 'fingertap', '128 BPM opens with the finger-tap figure');
  ok(settled.spineRoll === 0 && settled.chestRoll === 0, 'finger tap does not roll the torso');
  const beatMs = 60_000 / 128;
  let crossings = 0;
  let prev = c.update(3000, 1 / 60, musicInput()).rightFingerLift;
  let maxHand = 0;
  for (let at = 3000 + 1000 / 60; at < 3000 + beatMs * 4; at += 1000 / 60) {
    const f = c.update(at, 1 / 60, musicInput());
    if (prev < 0.1 && f.rightFingerLift >= 0.1) crossings++;
    maxHand = Math.max(maxHand, f.rightHandLift);
    prev = f.rightFingerLift;
  }
  ok(crossings === 4, 'fingers lift once per beat over 4 beats');
  ok(maxHand > 0.02 && maxHand < 0.2, 'palm lift is visible but small');
}

{
  // Fast tempo: sway is gated out and the tap drops to half time.
  const c = new RhythmMotionController();
  c.sync({ bpm: 170, lockedAt: 0 });
  const settled = settleMusic(c, 0, 2000);
  ok(settled.figure === 'fingertap', '170 BPM never picks the sway figure');
  const beatMs = 60_000 / 170;
  let crossings = 0;
  let prev = c.update(3000, 1 / 60, musicInput()).rightFingerLift;
  for (let at = 3000 + 1000 / 60; at < 3000 + beatMs * 8; at += 1000 / 60) {
    const f = c.update(at, 1 / 60, musicInput());
    if (prev < 0.1 && f.rightFingerLift >= 0.1) crossings++;
    prev = f.rightFingerLift;
  }
  ok(crossings === 4, 'above 150 BPM the tap rides every 2nd beat');
}

{
  // 首振り smoothness (master FB 2026-07-19): the music-figure head nod is a
  // continuous cosine — the motion spreads across the whole beat instead of
  // the old quarter-beat pulse that parked the head for the rest of the beat.
  const c = new RhythmMotionController();
  c.sync({ bpm: 128, lockedAt: 0 });
  settleMusic(c, 0, 3000);
  const beatMs = 60_000 / 128;
  const deltas = [];
  let prev = c.update(3000, 1 / 60, musicInput()).headPitch;
  for (let at = 3000 + 1000 / 60; at < 3000 + beatMs * 4; at += 1000 / 60) {
    const f = c.update(at, 1 / 60, musicInput());
    deltas.push(Math.abs(f.headPitch - prev));
    prev = f.headPitch;
  }
  const maxD = Math.max(...deltas);
  const meanD = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  ok(maxD < meanD * 1.8, 'nod frame deltas stay uniform (sine wave, not a pulse)');
  const still = deltas.filter((d) => d < maxD * 0.05).length;
  ok(still < deltas.length * 0.2, 'the head never parks mid-beat');
  const h0 = c.update(5000, 1 / 60, musicInput()).headPitch;
  const hHalf = c.update(5000 + beatMs / 2, 1 / 60, musicInput()).headPitch;
  const h1 = c.update(5000 + beatMs, 1 / 60, musicInput()).headPitch;
  ok(Math.abs(h0 - h1) < 0.0015, 'nod repeats after exactly 1 beat');
  ok(Math.abs(h0 + hHalf) < 0.0015, 'nod mirrors after half a beat (pure sinusoid)');
}

{
  // Fast tempo: the nod drops to half time with the tap so it never buzzes.
  const c = new RhythmMotionController();
  c.sync({ bpm: 170, lockedAt: 0 });
  settleMusic(c, 0, 3000);
  const beatMs = 60_000 / 170;
  const n0 = c.update(4000, 1 / 60, musicInput()).headPitch;
  const n1 = c.update(4000 + beatMs, 1 / 60, musicInput()).headPitch;
  const n2 = c.update(4000 + beatMs * 2, 1 / 60, musicInput()).headPitch;
  ok(Math.abs(n0 - n2) < 0.0015, '170 BPM nod repeats after 2 beats (half-time)');
  ok(Math.abs(n0 + n1) < 0.0015, '170 BPM nod mirrors after 1 beat');
}

{
  // Figure rotation: after 32 beats at a slow tempo, sway hands over to tap.
  const c = new RhythmMotionController();
  c.sync({ bpm: 120, lockedAt: 0 });
  settleMusic(c, 0, 1000);
  c.sync({ bpm: 100, lockedAt: 1000 });
  let early = null;
  let late = null;
  const beatMs = 60_000 / 100;
  for (let at = 1000; at <= 1000 + beatMs * 36; at += 1000 / 60) {
    const f = c.update(at, 1 / 60, musicInput());
    if (at < 1000 + beatMs * 30 && !early) early = f.figure;
    late = f;
  }
  ok(early === 'sway', '100 BPM re-lock restarts with sway');
  ok(late.figure === 'fingertap', 'after 32 beats the figure rotates to finger tap');
  ok(late.rightFingerLift >= 0 && Math.abs(late.spineRoll) < 0.02, 'rotation crossfades the sway out');
}

{
  // Unlock: losing the BPM fades everything out, including the smile.
  const c = new RhythmMotionController();
  c.sync({ bpm: 96, lockedAt: 0 });
  const grooving = settleMusic(c, 0, 2000);
  ok(grooving.active, 'locked BPM grooves in music_listen');
  c.rhythm({ status: 'detecting', lockedBpm: null });
  let frame = null;
  for (let at = 2000; at <= 5000; at += 1000 / 60) {
    frame = c.update(at, 1 / 60, musicInput());
  }
  ok(!frame.active, 'unlock returns her to the listening idle');
  ok(frame.smile < 0.03, 'the smile relaxes after the music stops');
}

console.log(`\nMain BPM + motion: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
