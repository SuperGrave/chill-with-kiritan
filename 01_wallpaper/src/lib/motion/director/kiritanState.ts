// kiritanState serializer (Phase 0, Test E groundwork) — §5.7.
//
// Pure function: FSM snapshot + context → the wire object the wallpaper POSTs
// to Companion (`POST /api/kiritan/state`, on every mode transition + a 30s
// heartbeat). No network, no globals — the POST plumbing is Companion B-4; this
// pins the schema so the mock-endpoint疎通 (Test E) has a fixed target.

import type { FsmSnapshot } from './modeFsm';
import { MODE_TABLE } from './modeTable';
import type { KiritanState, KiritanStateAway } from './types';

export interface KiritanStateContext {
  /** Wall-clock epoch ms used to derive `since` and ambient `endsAt`. */
  nowMs: number;
  /** Currently-playing ambient, if any. */
  ambient?: { id: string; endsInSec: number } | null;
  /** Required when snapshot.mode === 'away_room'. */
  away?: { reason: string; expectedReturnInMin: number } | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function buildKiritanState(snap: FsmSnapshot, ctx: KiritanStateContext): KiritanState {
  const spec = MODE_TABLE[snap.mode];
  const sinceMs = ctx.nowMs - snap.sinceMinutes * 60_000;

  const ambient =
    ctx.ambient != null
      ? { id: ctx.ambient.id, endsAt: iso(ctx.nowMs + ctx.ambient.endsInSec * 1000) }
      : null;

  let away: KiritanStateAway | null = null;
  if (snap.mode === 'away_room' && ctx.away != null) {
    away = {
      reason: ctx.away.reason,
      expectedReturnAt: iso(ctx.nowMs + ctx.away.expectedReturnInMin * 60_000),
    };
  }

  return {
    mode: snap.mode,
    modeLabel: spec.label,
    since: iso(sinceMs),
    prevMode: snap.prevMode,
    presence: snap.mode === 'away_room' ? 'away' : 'present',
    ambient,
    interruptPolicy: spec.interrupt,
    chatDelayMsRange: spec.chatDelayMsRange,
    sleepiness: Math.round(snap.sleepiness * 100) / 100,
    away,
  };
}

/** Structural schema check used by Test E (no external validator dep). */
export function validateKiritanState(s: unknown): string[] {
  const errs: string[] = [];
  const o = s as Record<string, unknown>;
  const req = (k: string, t: string): void => {
    if (!(k in o)) errs.push(`missing '${k}'`);
    else if (t === 'array') {
      if (o[k] !== null && !Array.isArray(o[k])) errs.push(`'${k}' not array|null`);
    } else if (o[k] !== null && typeof o[k] !== t) errs.push(`'${k}' not ${t}|null`);
  };
  req('mode', 'string');
  req('modeLabel', 'string');
  req('since', 'string');
  req('prevMode', 'string'); // string|null
  req('presence', 'string');
  req('interruptPolicy', 'string');
  req('chatDelayMsRange', 'array'); // [number,number]|null
  req('sleepiness', 'number');
  if (!('ambient' in o)) errs.push("missing 'ambient'");
  if (!('away' in o)) errs.push("missing 'away'");
  if (o.presence !== 'present' && o.presence !== 'away') errs.push("presence not present|away");
  const s2 = o.sleepiness as number;
  if (typeof s2 === 'number' && (s2 < 0 || s2 > 1)) errs.push('sleepiness out of 0..1');
  return errs;
}
