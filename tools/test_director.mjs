// Motion Director — Phase 0 Test C verification harness.
//
// Usage:  node tools/test_director.mjs
//
// Compiles the THREE-agnostic director modules to CommonJS under
// <root>/.probe_tmp/director_build and asserts the Phase 0 §4 test cases:
//   1. 24h soak × multiple seeds: no exception / no deadlock; mode distribution
//      qualitatively matches the daypart table; sleepiness rises at night and
//      resets on sleep/away.
//   2. Ambient lottery health: recent-2 exclusion + 90s cooldown hold; weight
//      ratio is reflected in output; same-ambient inter-arrival median.
//   3. State invariants (§6.1): graph audit + random-sequence fuzz = 0 violations
//      (away/sleep reached only with returnable hands).
//   4. Transition normalisation & reachability: every row normalises, all 12
//      modes reachable from work_normal.
//   5. kiritanState (§5.7): serialiser emits the schema; validator passes.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const outDir = path.join(root, '.probe_tmp', 'director_build');

// --- 0. compile -------------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });
const files = [
  'src/lib/motion/director/rng.ts',
  'src/lib/motion/director/types.ts',
  'src/lib/motion/director/modeTable.ts',
  'src/lib/motion/director/modeFsm.ts',
  'src/lib/motion/director/scheduler.ts',
  'src/lib/motion/director/invariants.ts',
  'src/lib/motion/director/kiritanState.ts',
  'src/lib/motion/director/directorRunner.ts',
  'src/lib/motion/director/awayWalk.ts',
  'src/lib/motion/director/motionContext.ts',
];
execSync(
  `npx tsc ${files.join(' ')} --ignoreConfig --outDir "${outDir}" --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);

const D = (m) => require(path.join(outDir, m));
const { makeRng } = D('rng.js');
const { daypartForHour, MODE_IDS } = D('types.js');
const { MODE_TABLE, PHASE1_MODES } = D('modeTable.js');
const { ModeFsm, resolveTransitionWeights } = D('modeFsm.js');
const { AmbientScheduler } = D('scheduler.js');
const { auditGraph, checkEdge, allRealEdges } = D('invariants.js');
const { buildKiritanState, validateKiritanState } = D('kiritanState.js');

// --- tiny harness -----------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ===========================================================================
// 1. 24h soak × multiple seeds
// ===========================================================================
section('1. 24h soak × seeds (FSM, distribution, sleepiness)');
{
  const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234];
  const DAYS = 7;
  const STEP = 5; // minutes
  const startHour = 8;

  // minutes occupancy[daypart][mode]
  const occ = {};
  for (const dpart of ['morning', 'midday', 'evening', 'night', 'lateNight']) {
    occ[dpart] = Object.fromEntries(MODE_IDS.map((m) => [m, 0]));
  }
  let transitions = 0;
  let exception = null;
  let maxSleepiness = 0;
  let resetsChecked = 0;
  let resetOk = 0;

  try {
    for (const seed of SEEDS) {
      const rng = makeRng(seed);
      const fsm = new ModeFsm(rng, 'work_normal');
      const totalSteps = (DAYS * 24 * 60) / STEP;
      for (let i = 0; i < totalSteps; i++) {
        const absMin = i * STEP;
        const hour = (startHour + absMin / 60) % 24;
        const dpart = daypartForHour(hour);
        const before = fsm.snapshot();
        occ[dpart][before.mode] += STEP;
        maxSleepiness = Math.max(maxSleepiness, before.sleepiness);
        const t = fsm.stepMinutes(STEP, hour);
        if (t) {
          transitions++;
          if (t.to === 'sleep_desk' || t.to === 'away_room') {
            resetsChecked++;
            if (fsm.snapshot().sleepiness === 0) resetOk++;
          }
        }
      }
    }
  } catch (e) {
    exception = e;
  }

  ok(exception === null, `soak ran without exception ${exception ? `(${exception.message})` : ''}`);
  ok(transitions > SEEDS.length * DAYS * 5, `progress: ${transitions} transitions (no deadlock)`);
  ok(resetsChecked > 0 && resetOk === resetsChecked, `sleepiness resets on sleep/away (${resetOk}/${resetsChecked})`);
  ok(maxSleepiness > 0, `sleepiness accrues (max observed ${maxSleepiness.toFixed(2)})`);

  // Distribution tables + qualitative daypart assertions.
  const share = (dpart, mode) => {
    const tot = MODE_IDS.reduce((s, m) => s + occ[dpart][m], 0);
    return tot ? occ[dpart][mode] / tot : 0;
  };
  for (const dpart of ['morning', 'midday', 'evening', 'night', 'lateNight']) {
    const rows = MODE_IDS.map((m) => [m, share(dpart, m)])
      .filter(([, s]) => s > 0.005)
      .sort((a, b) => b[1] - a[1]);
    console.log(`  [${dpart}] ` + rows.map(([m, s]) => `${m}:${pct(s)}`).join('  '));
  }
  const lnSleep = share('lateNight', 'sleep_desk') + share('lateNight', 'work_sleepy');
  ok(lnSleep > 0.45, `lateNight is sleep-dominated: sleep+sleepy=${pct(lnSleep)} (>45%)`);
  ok(share('lateNight', 'sleep_desk') > share('midday', 'sleep_desk'), 'sleep_desk heavier at lateNight than midday');
  ok(share('midday', 'work_normal') > share('lateNight', 'work_normal'), 'work_normal heavier at midday than lateNight');
  const middayWorkFam = share('midday', 'work_normal') + share('midday', 'work_focus');
  ok(middayWorkFam > 0.2, `midday has substantial work-family presence (${pct(middayWorkFam)})`);
}

// ===========================================================================
// 2. Ambient lottery health
// ===========================================================================
section('2. Ambient scheduler (recent-2, 90s cooldown, weights, interval)');
{
  // Long single-mode dwell at a fixed daytime hour.
  const rng = makeRng(2024);
  const sched = new AmbientScheduler(rng, 'work_normal', { availableProps: new Set() });
  const HOUR = 14;
  const DT = 1; // 1s ticks
  const DURATION = 4 * 3600; // 4 sim hours in work_normal
  const fires = [];
  for (let s = 0; s < DURATION; s += DT) {
    const f = sched.tickSeconds(DT, HOUR);
    if (f) fires.push(f);
  }
  ok(fires.length > 100, `fired enough ambients to test (${fires.length})`);

  // recent-2: no fire equals either of the two before it.
  let recentViol = 0;
  for (let i = 2; i < fires.length; i++) {
    if (fires[i].id === fires[i - 1].id || fires[i].id === fires[i - 2].id) recentViol++;
  }
  ok(recentViol === 0, `recent-2 exclusion holds (${recentViol} violations)`);

  // 90s cooldown: same id never within 90s.
  const lastAt = new Map();
  let cdViol = 0;
  const gapsById = new Map();
  for (const f of fires) {
    if (lastAt.has(f.id)) {
      const gap = f.atSec - lastAt.get(f.id);
      if (gap < 90 - 1e-6) cdViol++;
      if (!gapsById.has(f.id)) gapsById.set(f.id, []);
      gapsById.get(f.id).push(gap);
    }
    lastAt.set(f.id, f.atSec);
  }
  ok(cdViol === 0, `90s cooldown holds (${cdViol} violations)`);

  // Same-ambient inter-arrival median (§8.5 target: feel ≥ minutes apart).
  const allGaps = [...gapsById.values()].flat();
  const medGap = median(allGaps);
  console.log(`  median same-ambient inter-arrival: ${(medGap / 60).toFixed(1)} min  (target ≥ a few min)`);
  ok(medGap >= 120, `same-ambient median interval comfortably spaced (${(medGap / 60).toFixed(1)} min ≥ 2 min)`);

  // Weight ratio reflected: a weight-5/4 id fires more than a weight-1 id.
  const counts = new Map();
  for (const f of fires) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
  const hi = counts.get('amb_work_type_burst') ?? 0; // weight 4
  const lo = counts.get('amb_work_window_gaze') ?? 0; // weight 1
  ok(hi > lo, `weight ratio reflected: w4 ${hi} > w1 ${lo}`);

  // Prop gating: amb_work_sip (requires cup) never fires without cup.
  ok(!counts.has('amb_work_sip'), 'prop-gated ambient excluded when prop unavailable');

  // With cup available it becomes eligible.
  const rng2 = makeRng(2024);
  const sched2 = new AmbientScheduler(rng2, 'work_normal', { availableProps: new Set(['cup']) });
  let sawSip = false;
  for (let s = 0; s < DURATION; s += DT) {
    const f = sched2.tickSeconds(DT, HOUR);
    if (f && f.id === 'amb_work_sip') sawSip = true;
  }
  ok(sawSip, 'prop-gated ambient becomes eligible when prop available');

  // lateNight stretches the interval (×1.5): fewer fires in same window.
  const rngDay = makeRng(7);
  const rngNight = makeRng(7);
  const sDay = new AmbientScheduler(rngDay, 'work_normal');
  const sNight = new AmbientScheduler(rngNight, 'work_normal');
  let dayN = 0;
  let nightN = 0;
  for (let s = 0; s < 3600; s += DT) {
    if (sDay.tickSeconds(DT, 14)) dayN++;
    if (sNight.tickSeconds(DT, 3)) nightN++;
  }
  ok(nightN < dayN, `lateNight interval ×1.5 → fewer fires (night ${nightN} < day ${dayN})`);
}

// ===========================================================================
// 3. State invariants (§6.1)
// ===========================================================================
section('3. State invariants (graph audit + fuzz)');
{
  const bad = auditGraph();
  if (bad.length) for (const b of bad) console.error(`    ${b.from}→${b.to}: ${b.violations.join('; ')}`);
  ok(bad.length === 0, `reachable-graph audit: ${bad.length} violating edges`);

  // Explicit: every B-family → away/sleep edge yields return bridges, ok.
  const holders = MODE_IDS.filter((m) => MODE_TABLE[m].state.held.length > 0);
  let bridgedOk = 0;
  for (const m of holders) {
    const c = checkEdge(m, 'away_room');
    if (c.ok && c.bridges.length > 0) bridgedOk++;
  }
  ok(bridgedOk === holders.length, `prop-holding modes return props before away (${bridgedOk}/${holders.length})`);

  // Fuzz: random transition sequences over the real edge set, 0 violations.
  const edges = allRealEdges();
  const rng = makeRng(555);
  let fuzzViol = 0;
  for (let i = 0; i < 50000; i++) {
    const e = edges[rng.int(edges.length)];
    if (!checkEdge(e.from, e.to).ok) fuzzViol++;
  }
  ok(fuzzViol === 0, `50k random-edge fuzz: ${fuzzViol} violations`);
}

// ===========================================================================
// 4. Transition normalisation & reachability
// ===========================================================================
section('4. Transition normalisation & reachability');
{
  let normBad = 0;
  for (const m of MODE_IDS) {
    for (const hour of [3, 8, 14, 18, 22]) {
      for (const s of [0, 0.5, 1]) {
        const cand = resolveTransitionWeights(m, hour, s, 'work_normal');
        if (cand.length === 0) {
          normBad++;
          continue;
        }
        const sum = cand.reduce((a, c) => a + c.weight, 0);
        if (!(sum > 0)) normBad++;
        // normalised probabilities must sum to 1 and each be in (0,1].
        const probs = cand.map((c) => c.weight / sum);
        const psum = probs.reduce((a, p) => a + p, 0);
        if (Math.abs(psum - 1) > 1e-9) normBad++;
        if (probs.some((p) => p <= 0 || p > 1 + 1e-9)) normBad++;
      }
    }
  }
  ok(normBad === 0, `all rows normalise to valid distributions (${normBad} bad)`);

  // Reachability: BFS over union of all daypart edges from work_normal.
  const reach = new Set(['work_normal']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of [...reach]) {
      for (const hour of [3, 14, 22]) {
        for (const c of resolveTransitionWeights(m, hour, 0.5, 'work_normal')) {
          if (!reach.has(c.to)) {
            reach.add(c.to);
            grew = true;
          }
        }
      }
    }
  }
  ok(reach.size === MODE_IDS.length, `all ${MODE_IDS.length} modes reachable from work_normal (got ${reach.size})`);

  // sleepiness monotonicity contract: more sleepy → heavier sleep/sleepy pull.
  const wAt = (s) => {
    const cand = resolveTransitionWeights('work_sleepy', 22, s, 'work_normal');
    const e = cand.find((c) => c.to === 'sleep_desk');
    return e ? e.weight : 0;
  };
  ok(wAt(1) > wAt(0.5) && wAt(0.5) > wAt(0), 'sleepiness raises sleep_desk weight monotonically');
}

// ===========================================================================
// 5. kiritanState schema (§5.7)
// ===========================================================================
section('5. kiritanState serialiser (§5.7)');
{
  const rng = makeRng(1);
  const fsm = new ModeFsm(rng, 'game_controller');
  fsm.stepMinutes(1, 21); // accrue a little since-time
  const snap = fsm.snapshot();
  const nowMs = Date.parse('2026-06-12T21:04:00+09:00');
  const st = buildKiritanState(snap, {
    nowMs,
    ambient: { id: 'amb_game_win_smug', endsInSec: 4 },
    away: null,
  });
  const errs = validateKiritanState(st);
  if (errs.length) console.error('    ' + errs.join('; '));
  ok(errs.length === 0, `valid schema (${errs.length} errors)`);
  ok(typeof st.modeLabel === 'string' && st.modeLabel.length > 0, 'modeLabel resolved');
  ok(Array.isArray(st.chatDelayMsRange) && st.chatDelayMsRange.length === 2, 'chatDelayMsRange shape');
  ok(st.interruptPolicy === 'queued', 'interruptPolicy from mode table (game→queued)');
  ok(st.presence === 'present' && st.ambient && st.ambient.id === 'amb_game_win_smug', 'ambient + presence');

  // away variant carries the away block + presence flip.
  const fsm2 = new ModeFsm(makeRng(3), 'away_room');
  const st2 = buildKiritanState(fsm2.snapshot(), {
    nowMs,
    ambient: null,
    away: { reason: 'おやつが切れたのでコンビニに行っています', expectedReturnInMin: 12 },
  });
  ok(st2.presence === 'away' && st2.away && st2.away.reason.length > 0, 'away block populated');
  ok(validateKiritanState(st2).length === 0, 'away variant valid');
  ok(st2.chatDelayMsRange === null, 'away chatDelayMsRange null (handled out-of-band)');

  console.log('  sample:', JSON.stringify(st));
}

// ===========================================================================
// 6. Director runner — transition chains (Step 1)
// ===========================================================================
section('6. Director runner — transition chains (Step 1)');
{
  const { DirectorRunner } = D('directorRunner.js');
  const { resolveTransitionChain } = D('modeTable.js');
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // 6a. resolveTransitionChain: exact wins, wildcard fallback, none = [].
  ok(eq(resolveTransitionChain('work_sleepy', 'sleep_desk'), ['tr_sit_to_slump']), 'chain sleepy→sleep = [tr_sit_to_slump]');
  ok(eq(resolveTransitionChain('sleep_desk', 'work_normal'), ['tr_slump_wake']), 'chain sleep→work (wildcard) = [tr_slump_wake]');
  ok(eq(resolveTransitionChain('sleep_desk', 'work_sleepy'), ['tr_slump_wake']), 'chain sleep→sleepy (wildcard) = [tr_slump_wake]');
  ok(eq(resolveTransitionChain('work_normal', 'video_relax'), ['tr_lean_back']), 'chain work→video = [tr_lean_back]');
  ok(eq(resolveTransitionChain('video_relax', 'work_normal'), ['tr_lean_forward']), 'chain video→work = [tr_lean_forward]');
  ok(resolveTransitionChain('work_normal', 'game_controller').length === 0, 'chain work→game = [] (graceful fallback)');

  // 6b. Mechanism on a runner whose every mode change has a 2-step chain.
  const TWO = ['tr_a', 'tr_b'];
  const mk = (cfg = {}) =>
    new DirectorRunner({ seed: 42, loopMotionFor: (m) => `loop_${m}`, transitionMotionsFor: () => TWO, ...cfg });

  // Tick until a transition fires; consume any ambients that fire first.
  const driveToTransition = (r) => {
    for (let i = 0; i < 1000; i++) {
      const a = r.tick(60, 14); // 1 sim-minute per tick at 14:00
      if (a && a.kind === 'transition') return a;
      if (a && a.kind === 'ambient') r.onClipFinished(); // resume loop, keep going
    }
    return null;
  };

  const r = mk();
  const first = r.start();
  ok(first && first.kind === 'loop', 'start() → loop action');
  ok(r.status().state === 'loop', 'state=loop after start');

  const t0 = driveToTransition(r);
  ok(t0 && t0.kind === 'transition' && t0.index === 0 && t0.count === 2, 'mode change → transition[0/2]');
  ok(r.status().state === 'transition', 'state=transition during chain');
  ok(r.status().transition && r.status().transition.motionId === 'tr_a', 'status.transition reports current link');
  const target = t0 ? t0.mode : null;

  // 6c. tick() is frozen during a transition: no ambient, no second transition.
  let leaked = null;
  for (let i = 0; i < 500 && !leaked; i++) leaked = r.tick(60, 14);
  ok(leaked === null, 'tick frozen during transition (no ambient/transition leak)');
  ok(r.status().state === 'transition', 'still transition after 500 frozen ticks');

  // 6d. onClipFinished advances the chain, then lands the target loop.
  const step2 = r.onClipFinished();
  ok(step2 && step2.kind === 'transition' && step2.index === 1 && step2.count === 2, 'finished → transition[1/2]');
  const land = r.onClipFinished();
  ok(land && land.kind === 'loop' && land.motionId === `loop_${target}`, 'finished → target loop swap');
  ok(r.status().state === 'loop' && r.status().transition === null, 'state=loop after chain, transition cleared');

  // 6e. A mode change with no authored chain swaps straight to the loop.
  const r2 = mk({ transitionMotionsFor: () => [] });
  r2.start();
  let act2 = null;
  for (let i = 0; i < 1000 && !act2; i++) {
    const a = r2.tick(60, 14);
    if (a && a.kind === 'loop') act2 = a;
    else if (a && a.kind === 'ambient') r2.onClipFinished();
  }
  ok(act2 && act2.kind === 'loop', 'no-chain mode change → direct loop');
  ok(r2.status().state === 'loop', 'state=loop (transition skipped)');

  // 6f. abortTransition() is a safe fallback to the target loop.
  const r3 = mk();
  r3.start();
  const t3 = driveToTransition(r3);
  ok(t3 && t3.kind === 'transition', 'r3 entered a transition');
  const ab = r3.abortTransition();
  ok(ab && ab.kind === 'loop' && r3.status().state === 'loop', 'abortTransition → loop fallback');

  // 6g. transitionCount accrues; ambient end still resumes the loop.
  ok(r.status().transitionCount >= 1, `transitionCount accrues (${r.status().transitionCount})`);
}

// ===========================================================================
// 7. Away leave/return locomotion sequencer (Step 4)
// ===========================================================================
section('7. Away leave/return sequencer (root determinism + round-trip)');
{
  const { LEAVE_SEQ, RETURN_SEQ, seqAt, seqDuration, leaveRoot, returnRoot, AWAY_MOTIONS } = D('awayWalk.js');
  const P = { off: [-2.5, 0], chair: [0, 0], faceY: Math.PI / 2 };
  const eqf = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
  const r4eq = (a, b, e = 1e-9) => a.every((v, i) => eqf(v, b[i], e));

  // 7a. Sequence segment lookup.
  ok(seqAt(LEAVE_SEQ, 0).motion === 'tr_sit_to_stand', 'leave@0 = tr_sit_to_stand');
  ok(seqAt(LEAVE_SEQ, 2.0).motion === 'tr_walk_start', 'leave@2.0 = tr_walk_start');
  ok(seqAt(LEAVE_SEQ, 3.0).motion === 'loop_walk', 'leave@3.0 = loop_walk');
  ok(seqAt(LEAVE_SEQ, 5.5).motion === 'tr_walk_stop', 'leave@5.5 = tr_walk_stop');
  ok(seqAt(LEAVE_SEQ, 99).done === true, 'leave overrun → done');
  ok(seqAt(RETURN_SEQ, 99).motion === 'tr_stand_to_sit', 'return ends on tr_stand_to_sit');
  ok(AWAY_MOTIONS.includes('loop_walk') && AWAY_MOTIONS.length === 5, `AWAY_MOTIONS = 5 unique (${AWAY_MOTIONS.length})`);

  // 7b. Leave root: chair → off, facing ramps to faceY.
  ok(r4eq(leaveRoot(0, P), [0, 0, 0, 0]), 'leaveRoot(0) = chair, facing 0');
  ok(r4eq(leaveRoot(1.8, P), [0, 0, 0, 0]), 'leaveRoot(stand end) still at chair');
  const lend = leaveRoot(seqDuration(LEAVE_SEQ), P);
  ok(r4eq(lend, [-2.5, 0, 0, Math.PI / 2]), 'leaveRoot(end) = off-screen, faced out');

  // 7c. Return root: off → chair, ends EXACTLY at origin facing forward.
  ok(r4eq(returnRoot(0, P), [-2.5, 0, 0, -Math.PI / 2]), 'returnRoot(0) = off, facing in');
  const rend = returnRoot(seqDuration(RETURN_SEQ), P);
  ok(r4eq(rend, [0, 0, 0, 0]), 'returnRoot(end) = chair, facing monitor (exact origin)');

  // 7d. Determinism + no drift over many re-samples.
  let drift = 0;
  for (let i = 0; i < 2000; i++) drift = Math.max(drift, Math.abs(leaveRoot(3.21, P)[0] - leaveRoot(3.21, P)[0]));
  ok(drift === 0, `leaveRoot deterministic, no drift over 2000 samples (${drift})`);

  // 7e. Round trip: 3 leave→return cycles all land back at EXACT origin (no accumulation).
  let roundOk = true;
  for (let n = 0; n < 3; n++) {
    if (!r4eq(returnRoot(seqDuration(RETURN_SEQ), P), [0, 0, 0, 0])) roundOk = false;
  }
  ok(roundOk, '3 round-trips end at exact chair origin (no drift on repeats)');

  // 7f. Continuity: leave end position == return start position (off-screen handoff).
  ok(eqf(lend[0], returnRoot(0, P)[0]) && eqf(lend[2], returnRoot(0, P)[2]), 'leave-end ≡ return-start position (no jump while hidden)');
}

// ===========================================================================
// 8. Director runtime integration soak (Step 5 proxy)
// ===========================================================================
section('8. Director runtime soak — host play→finished loop, no stall (3h × seeds)');
{
  const { DirectorRunner } = D('directorRunner.js');
  const { resolveTransitionChain } = D('modeTable.js');
  // Current production auto-run content: the three completed loops only.
  const PRIMARY_MODES = new Set(['work_normal', 'video_relax', 'sleep_desk']);
  const LOOPS = { work_normal: 'loop_work_normal', video_relax: 'loop_video_relax', sleep_desk: 'loop_sleep_desk' };
  const AUTHORED_TR = new Set(['tr_sit_to_slump', 'tr_slump_wake', 'tr_lean_back', 'tr_lean_forward']);
  const ONESHOT = 3; // seconds a transition/ambient clip "plays" before finishing

  let exception = null;
  let totTrans = 0, totAmb = 0, totLoop = 0, maxChain = 0;
  const seenModes = new Set();
  const badModes = new Set();
  for (const seed of [1, 5, 42, 777]) {
    const r = new DirectorRunner({
      seed,
      allowedModes: PRIMARY_MODES,
      availableMotions: new Set([
        'amb_work_neck_roll',
        'amb_work_posture_reset',
        'amb_work_stretch',
        'amb_vid_chuckle',
        'amb_vid_nod_watch',
        'amb_vid_eyes_widen',
        'amb_slp_head_shift',
        'amb_slp_dream_smile',
      ]),
      loopMotionFor: (m) => LOOPS[m] ?? null,
      transitionMotionsFor: (f, t) => {
        const c = resolveTransitionChain(f, t);
        return c.length && c.every((id) => AUTHORED_TR.has(id)) ? c : [];
      },
    });
    let cur = r.start();
    let remaining = cur && cur.kind !== 'loop' ? ONESHOT : Infinity;
    let chainLen = 0;
    try {
      for (let s = 0; s < 3 * 3600; s += 1) {
        const hour = (14 + s / 3600) % 24;
        const act = r.tick(1, hour);
        if (act) {
          if (act.kind === 'transition') { totTrans++; chainLen++; maxChain = Math.max(maxChain, chainLen); }
          else { totAmb += act.kind === 'ambient' ? 1 : 0; totLoop += act.kind === 'loop' ? 1 : 0; chainLen = 0; }
          remaining = act.kind === 'loop' ? Infinity : ONESHOT;
        } else if (Number.isFinite(remaining)) {
          remaining -= 1;
          if (remaining <= 0) {
            const nxt = r.onClipFinished();
            if (nxt) {
              if (nxt.kind === 'transition') { totTrans++; chainLen++; maxChain = Math.max(maxChain, chainLen); }
              else {
                totAmb += nxt.kind === 'ambient' ? 1 : 0;
                totLoop += nxt.kind === 'loop' ? 1 : 0;
                chainLen = 0;
              }
              remaining = nxt.kind === 'loop' ? Infinity : ONESHOT;
            } else remaining = Infinity;
          }
        }
        // Invariant: never wedged in 'transition' without a playing clip.
        if (r.status().state === 'transition' && !Number.isFinite(remaining)) throw new Error('stuck in transition with no clip');
        seenModes.add(r.status().mode);
        if (!PRIMARY_MODES.has(r.status().mode)) badModes.add(r.status().mode);
      }
    } catch (e) { exception = e; break; }
  }
  ok(exception === null, `soak ran without stall/exception ${exception ? `(${exception.message})` : ''}`);
  ok(badModes.size === 0, `production auto-run stayed in primary modes (${[...seenModes].sort().join(', ')})`);
  ok(totTrans > 0, `transitions auto-played (${totTrans})`);
  ok(totAmb > 0, `ambients fired between transitions (${totAmb})`);
  ok(totLoop > 0, `loops resumed after chains/ambients (${totLoop})`);
  ok(maxChain >= 1 && maxChain <= 4, `transition chains bounded (max links ${maxChain})`);
}

// ===========================================================================
// 9. Motion playback-context registry (Phase 1 visual-QA, Stage 1 — issue #1)
// ===========================================================================
section('9. Context-loop return registry (issue #1)');
{
  const { resolveMotionContext, contextReturnLoop, PHASE1_MODE_LOOP } = D('motionContext.js');

  // 9a. Exact mappings from the issue #1 list (ambient/transition → settle loop).
  const expect = {
    amb_slp_dream_smile: 'loop_sleep_desk',
    amb_slp_head_shift: 'loop_sleep_desk',
    amb_vid_chuckle: 'loop_video_relax',
    amb_vid_nod_watch: 'loop_video_relax',
    amb_work_screen_scan: 'loop_work_normal',
    amb_work_sip: 'loop_work_normal',
    tr_sit_to_slump: 'loop_sleep_desk',
    tr_slump_wake: 'loop_work_normal',
    tr_lean_back: 'loop_video_relax',
    tr_lean_forward: 'loop_work_normal',
    tr_stand_to_sit: 'loop_work_normal',
  };
  for (const [id, loop] of Object.entries(expect)) {
    ok(contextReturnLoop(id) === loop, `${id} → ${loop} (got ${contextReturnLoop(id)})`);
  }

  // 9b. Category classification.
  ok(resolveMotionContext('loop_work_normal').category === 'loop', 'loop_ classified as loop');
  ok(resolveMotionContext('amb_work_sip').category === 'ambient', 'amb_ classified as ambient');
  ok(resolveMotionContext('tr_lean_back').category === 'transition', 'tr_ classified as transition');

  // 9c. A loop settles into ITSELF (a Lab loop play is stable, never reverts).
  ok(contextReturnLoop('loop_video_relax') === 'loop_video_relax', 'loop settles into itself');

  // 9d. Every Phase-1 ambient resolves to a loop (never the standing rest pose).
  const phase1Ambients = ['amb_work_neck_roll', 'amb_work_posture_reset', 'amb_work_screen_scan', 'amb_work_sip', 'amb_slpy_head_bob', 'amb_slpy_slow_blink', 'amb_slpy_tilt_drift', 'amb_vid_chuckle', 'amb_vid_nod_watch', 'amb_vid_eyes_widen', 'amb_slp_head_shift', 'amb_slp_dream_smile'];
  ok(phase1Ambients.every((a) => contextReturnLoop(a) !== null), 'all Phase-1 ambients return to a loop (no standing fallback)');

  // 9e. Locomotion / stand-up transitions END standing → no sitting settle loop.
  ok(contextReturnLoop('tr_sit_to_stand') === null, 'tr_sit_to_stand has no sitting settle loop');
  ok(contextReturnLoop('tr_walk_stop') === null, 'tr_walk_stop has no sitting settle loop');

  // 9f. Context registry keeps both primary and secondary loop return targets.
  ok(
    PHASE1_MODE_LOOP.work_normal === 'loop_work_normal' &&
      PHASE1_MODE_LOOP.video_relax === 'loop_video_relax' &&
      PHASE1_MODE_LOOP.sleep_desk === 'loop_sleep_desk' &&
      PHASE1_MODE_LOOP.work_sleepy === 'loop_work_sleepy',
    'PHASE1_MODE_LOOP defines return targets for primary and secondary loops',
  );
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Phase 0 Test C: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('ALL PASS — Director foundation (FSM / scheduler / invariants / kiritanState) verified.');
