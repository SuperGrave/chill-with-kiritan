// kiritanState POST 疎通 — Phase 0 Test E verification harness.
//
// Usage:  node tools/test_kiritan_post.mjs
//
// Proves the design's §5.7 state sync over a REAL HTTP round-trip (Node's http
// server + the global fetch transport), without the wallpaper/WebGL app:
//   1. 疎通 + cadence: the director POSTs on every mode transition and on the
//      30 s heartbeat; every received body validates against the §5.7 schema.
//   2. Fire-and-forget resilience: a missing receiver (dead port), a rejecting
//      transport, and a hung (never-resolving) transport none of them throw back
//      into the host nor block it — the host loop keeps ticking unaffected.
//
// Compiles the THREE-agnostic director modules + kiritanPoster to CommonJS under
// <root>/.probe_tmp/poster_build (same pattern as tools/test_director.mjs).

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const outDir = path.join(root, '.probe_tmp', 'poster_build');

// --- 0. compile -------------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });
const files = [
  'src/lib/motion/director/rng.ts',
  'src/lib/motion/director/types.ts',
  'src/lib/motion/director/modeTable.ts',
  'src/lib/motion/director/modeFsm.ts',
  'src/lib/motion/director/kiritanState.ts',
  'src/lib/motion/director/kiritanPoster.ts',
];
execSync(
  `npx tsc ${files.join(' ')} --ignoreConfig --outDir "${outDir}" --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);

const D = (m) => require(path.join(outDir, m));
const { makeRng } = D('rng.js');
const { ModeFsm } = D('modeFsm.js');
const { validateKiritanState } = D('kiritanState.js');
const { KiritanPoster, makeFetchTransport } = D('kiritanPoster.js');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A virtual clock the poster reads; the test drives it forward in sim time.
let clock = Date.parse('2026-06-12T14:00:00+09:00');
const now = () => clock;

// Mock Companion receiver: records every body it gets.
function startReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/kiritan/state') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        received.push(JSON.parse(raw));
      } catch (e) {
        received.push({ __parseError: String(e) });
      }
      res.writeHead(204).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, received });
    });
  });
}

function startAuthReceiver() {
  const received = [];
  const postTokens = [];
  const state = { tokenHits: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/auth/token') {
      state.tokenHits++;
      if (state.tokenHits === 1) {
        res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ token: 'fresh-token' }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/kiritan/state') {
      res.writeHead(404).end();
      return;
    }

    const token = req.headers['x-companion-token'];
    postTokens.push(typeof token === 'string' ? token : '');
    if (token !== 'fresh-token') {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }));
      return;
    }

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        received.push(JSON.parse(raw));
      } catch (e) {
        received.push({ __parseError: String(e) });
      }
      res.writeHead(204).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, received, postTokens, state });
    });
  });
}

async function main() {
  // =========================================================================
  // 1. 疎通 + cadence (transition + 30 s heartbeat), schema valid on the wire
  // =========================================================================
  section('1. HTTP 疎通 + cadence (real fetch → mock receiver)');
  {
    const { server, port, received } = await startReceiver();
    const url = `http://127.0.0.1:${port}/api/kiritan/state`;

    const poster = new KiritanPoster({ url, heartbeatMs: 30_000, now });
    const fsm = new ModeFsm(makeRng(7), 'work_normal');

    // Drive 20 sim-minutes at 1 s ticks. The poster reads `now()`; we advance the
    // virtual clock and `ctx.nowMs` together so `since`/`endsAt` stay coherent.
    let transitions = 0;
    const reasons = { initial: 0, transition: 0, heartbeat: 0 };
    const STEP_S = 1;
    for (let s = 0; s < 20 * 60; s += STEP_S) {
      clock += STEP_S * 1000;
      const t = fsm.stepMinutes(STEP_S / 60, 14);
      if (t) transitions++;
      const r = poster.maybePost(fsm.snapshot(), { nowMs: clock, ambient: null, away: null });
      if (r) reasons[r]++;
    }
    // Let the in-flight fire-and-forget POSTs land.
    await sleep(150);

    ok(reasons.initial === 1, `exactly one initial sync POST (got ${reasons.initial})`);
    ok(transitions > 0, `FSM produced transitions to push (${transitions})`);
    ok(reasons.transition === transitions, `one POST per transition (${reasons.transition}/${transitions})`);
    // 20 min / 30 s heartbeat ≈ up to 40 ticks, minus any consumed by transition
    // resets. Just assert the heartbeat actually fired on a sustained dwell.
    ok(reasons.heartbeat > 0, `heartbeat POSTs fired during dwell (${reasons.heartbeat})`);

    const totalSent = reasons.initial + reasons.transition + reasons.heartbeat;
    ok(received.length === totalSent, `every POST was received (${received.length}/${totalSent})`);

    const schemaErrs = received.flatMap((b) => validateKiritanState(b));
    ok(schemaErrs.length === 0, `all received bodies valid §5.7 schema (${schemaErrs.length} errors)`);
    ok(
      received.every((b) => typeof b.mode === 'string' && typeof b.since === 'string'),
      'received bodies carry mode + ISO since',
    );

    // Heartbeat spacing: consecutive same-mode posts are ≥ ~30 s apart in `since`
    // is not directly observable, but we can confirm we didn't spam every tick.
    ok(totalSent < 20 * 60, `did not POST every tick — cadence gated (${totalSent} ≪ 1200)`);

    console.log(`  posted: initial=${reasons.initial} transition=${reasons.transition} heartbeat=${reasons.heartbeat}; received=${received.length}`);
    console.log('  sample wire body:', JSON.stringify(received[received.length - 1]));
    server.close();
  }

  // =========================================================================
  // 1b. Activity cadence (v0.8.3 A11): ambient start/end and away-stage
  //     changes post immediately; unchanged activity does not re-post.
  // =========================================================================
  section('1b. Activity cadence (ambient start/end, away stage)');
  {
    const sent = [];
    const poster = new KiritanPoster({
      transport: (_url, body) => { sent.push(body); },
      heartbeatMs: 30_000,
      now,
    });
    const fsm = new ModeFsm(makeRng(11), 'work_normal');
    const snap = () => fsm.snapshot();

    clock += 1000;
    ok(poster.maybePost(snap(), { nowMs: clock, ambient: null, away: null }) === 'initial', 'activity: first post is initial');

    // Ambient starts → immediate 'activity' post carrying the ambient.
    clock += 1000;
    const r1 = poster.maybePost(snap(), { nowMs: clock, ambient: { id: 'amb_work_neck_roll', endsInSec: 4 }, away: null });
    ok(r1 === 'activity', `ambient start posts immediately as 'activity' (got ${r1})`);
    ok(sent[sent.length - 1].ambient?.id === 'amb_work_neck_roll', 'activity post carries the ambient id');

    // Same ambient still playing (endsInSec counting down) → no re-post.
    clock += 1000;
    const r2 = poster.maybePost(snap(), { nowMs: clock, ambient: { id: 'amb_work_neck_roll', endsInSec: 3 }, away: null });
    ok(r2 === null, `unchanged ambient (only endsInSec moved) does not re-post (got ${r2})`);

    // Ambient ends → immediate 'activity' post with ambient null again.
    clock += 1000;
    const r3 = poster.maybePost(snap(), { nowMs: clock, ambient: null, away: null });
    ok(r3 === 'activity', `ambient end posts immediately as 'activity' (got ${r3})`);
    ok(sent[sent.length - 1].ambient === null, 'ambient-end post carries ambient=null');

    // Away stage change (reason string) → 'activity'; drifting
    // expectedReturnInMin alone → no re-post.
    clock += 1000;
    const away1 = poster.maybePost(snap(), { nowMs: clock, ambient: null, away: { reason: 'leaving', expectedReturnInMin: 5 } });
    ok(away1 === 'activity', `away stage appearing posts as 'activity' (got ${away1})`);
    clock += 1000;
    const away2 = poster.maybePost(snap(), { nowMs: clock, ambient: null, away: { reason: 'leaving', expectedReturnInMin: 4.9 } });
    ok(away2 === null, `away with same reason (only ETA moved) does not re-post (got ${away2})`);
    clock += 1000;
    const away3 = poster.maybePost(snap(), { nowMs: clock, ambient: null, away: { reason: 'out-of-room', expectedReturnInMin: 4.8 } });
    ok(away3 === 'activity', `away stage change posts as 'activity' (got ${away3})`);

    // Heartbeat still fires on a sustained unchanged activity.
    clock += 31_000;
    const hb = poster.maybePost(snap(), { nowMs: clock, ambient: null, away: { reason: 'out-of-room', expectedReturnInMin: 4 } });
    ok(hb === 'heartbeat', `heartbeat still fires with unchanged activity (got ${hb})`);

    const schemaErrs = sent.flatMap((b) => validateKiritanState(b));
    ok(schemaErrs.length === 0, `all activity-cadence bodies valid §5.7 schema (${schemaErrs.length} errors)`);
  }

  // =========================================================================
  // 2. Fire-and-forget resilience (receiver absent / rejecting / hung)
  // =========================================================================
  section('2. Fire-and-forget resilience (host must never throw or block)');
  {
    const fsm = new ModeFsm(makeRng(2), 'work_normal');
    const ctx = { nowMs: clock, ambient: null, away: null };

    // (a) Dead port via the REAL fetch transport — connection refused.
    {
      let errors = 0;
      const poster = new KiritanPoster({
        url: 'http://127.0.0.1:9/api/kiritan/state', // discard port, nothing listening
        now,
        onError: () => errors++,
      });
      let threw = false;
      const t0 = Date.now();
      try {
        for (let i = 0; i < 50; i++) {
          clock += 31_000; // force a post each iteration
          poster.maybePost(fsm.snapshot(), ctx);
        }
      } catch {
        threw = true;
      }
      const elapsed = Date.now() - t0;
      ok(!threw, 'dead-receiver: maybePost never throws into the host');
      ok(elapsed < 500, `dead-receiver: host loop not blocked (${elapsed}ms for 50 posts)`);
      await sleep(300); // allow async connection-refused rejections to settle
      ok(errors > 0, `dead-receiver: rejections routed to onError, not thrown (${errors})`);
    }

    // (b) Transport that throws synchronously.
    {
      let errors = 0;
      const poster = new KiritanPoster({
        transport: () => {
          throw new Error('boom');
        },
        now,
        onError: () => errors++,
      });
      let threw = false;
      try {
        clock += 31_000;
        poster.maybePost(fsm.snapshot(), ctx);
      } catch {
        threw = true;
      }
      ok(!threw && errors === 1, 'sync-throwing transport swallowed (onError fired, host unaffected)');
    }

    // (c) Transport that rejects asynchronously.
    {
      let errors = 0;
      const poster = new KiritanPoster({
        transport: () => Promise.reject(new Error('async-down')),
        now,
        onError: () => errors++,
      });
      clock += 31_000;
      const ret = poster.maybePost(fsm.snapshot(), ctx);
      ok(ret === 'heartbeat' || ret === 'initial', 'rejecting transport: maybePost returns normally');
      await sleep(20);
      ok(errors === 1, 'async-rejecting transport routed to onError');
    }

    // (d) Hung transport (never resolves) must not block the synchronous call.
    {
      let resolved = false;
      const poster = new KiritanPoster({
        transport: () => new Promise(() => {}), // never settles
        now,
      });
      const t0 = Date.now();
      clock += 31_000;
      poster.maybePost(fsm.snapshot(), ctx);
      const elapsed = Date.now() - t0;
      resolved = true;
      ok(resolved && elapsed < 50, `hung transport: call returns immediately (${elapsed}ms, not awaited)`);
    }
  }

  // =========================================================================
  // 3. Auth token retry: failed lookup must not poison the cache forever
  // =========================================================================
  section('3. Auth token retry after transient lookup failure');
  {
    const { server, port, received, postTokens, state } = await startAuthReceiver();
    const url = `http://127.0.0.1:${port}/api/kiritan/state`;
    const fsm = new ModeFsm(makeRng(5), 'work_normal');
    let errors = 0;
    const poster = new KiritanPoster({
      url,
      heartbeatMs: 30_000,
      now,
      transport: makeFetchTransport(1000),
      onError: () => errors++,
    });

    clock += 31_000;
    poster.maybePost(fsm.snapshot(), { nowMs: clock, ambient: null, away: null });
    await sleep(150);

    clock += 31_000;
    poster.maybePost(fsm.snapshot(), { nowMs: clock, ambient: null, away: null });
    await sleep(150);

    ok(state.tokenHits >= 2, `token lookup retried after first failure (${state.tokenHits} hits)`);
    ok(postTokens[0] === '' && postTokens[1] === 'fresh-token', 'second POST used freshly fetched token');
    ok(errors === 1, `first 401 was reported once and did not poison later posts (${errors} errors)`);
    ok(received.length === 1 && validateKiritanState(received[0]).length === 0, 'second authenticated POST landed with valid body');
    server.close();
  }

  // --- summary --------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Phase 0 Test E: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('FAILURES:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('ALL PASS — kiritanState POST 疎通 + fire-and-forget resilience verified.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
