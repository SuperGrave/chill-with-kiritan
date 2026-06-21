// kiritanState poster (Phase 0, Test E) — §5.7 wire delivery.
//
// Fire-and-forget client that pushes the kiritanState wire object to Companion
// (`POST /api/kiritan/state`) on every mode transition plus a heartbeat. It is
// the network half that complements the pure serialiser in `kiritanState.ts`.
//
// Contract (Test E acceptance):
//   * Emits on mode change AND on a fixed heartbeat interval (default 30 s).
//   * Fire-and-forget: a rejected/throwing/hung transport NEVER throws back into
//     the host and NEVER blocks it (the call returns synchronously; the promise
//     is detached). A missing receiver therefore has zero effect on the wallpaper.
//   * THREE-agnostic and dependency-injected (transport + clock) so the cadence
//     and resilience are reproducible in Node — same discipline as the rest of
//     src/lib/motion/director/.

import { buildKiritanState, type KiritanStateContext } from './kiritanState';
import type { FsmSnapshot } from './modeFsm';
import type { KiritanState } from './types';

/** Sends one wire object. May resolve/reject/hang — the poster never awaits it. */
export type KiritanPosterTransport = (url: string, body: KiritanState) => Promise<void> | void;

export interface KiritanPosterConfig {
  /** Companion receiver. Default matches the design's local port (§5.7). */
  url?: string;
  /** Heartbeat cadence in ms while the mode is unchanged. Default 30 s. */
  heartbeatMs?: number;
  /** Network sender. Default = fetch with a short timeout (see makeFetchTransport). */
  transport?: KiritanPosterTransport;
  /** Injected clock so cadence is testable. Default Date.now. */
  now?: () => number;
  /** Called for swallowed transport errors (telemetry hook). Default: noop. */
  onError?: (err: unknown) => void;
}

export type PostReason = 'transition' | 'heartbeat' | 'initial';

const DEFAULT_URL = 'http://127.0.0.1:40313/api/kiritan/state';
const DEFAULT_HEARTBEAT_MS = 30_000;

/**
 * Default transport: POST JSON with a hard timeout so a hung receiver can never
 * pile up requests. Uses AbortSignal.timeout where available (Node 18+, modern
 * browsers); degrades to a plain fetch otherwise.
 */
export function makeFetchTransport(timeoutMs = 2000): KiritanPosterTransport {
  return async (url, body) => {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // keepalive lets the final heartbeat survive a page unload.
      keepalive: true,
      ...(signal ? { signal } : {}),
    });
  };
}

export class KiritanPoster {
  private readonly url: string;
  private readonly heartbeatMs: number;
  private readonly transport: KiritanPosterTransport;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;

  private lastMode: string | null = null;
  private lastPostMs = Number.NEGATIVE_INFINITY;
  private sent = 0;
  private errors = 0;

  constructor(cfg: KiritanPosterConfig = {}) {
    this.url = cfg.url ?? DEFAULT_URL;
    this.heartbeatMs = cfg.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.transport = cfg.transport ?? makeFetchTransport();
    this.now = cfg.now ?? Date.now;
    this.onError = cfg.onError ?? (() => {});
  }

  /**
   * Call every host tick. Decides whether this snapshot is due (mode change or
   * heartbeat elapsed) and, if so, serialises + sends it fire-and-forget.
   * Returns the reason it posted, or null when nothing was due. Never throws.
   */
  maybePost(snap: FsmSnapshot, ctx: KiritanStateContext): PostReason | null {
    const t = this.now();
    let reason: PostReason | null = null;
    if (this.lastPostMs === Number.NEGATIVE_INFINITY) reason = 'initial';
    else if (snap.mode !== this.lastMode) reason = 'transition';
    else if (t - this.lastPostMs >= this.heartbeatMs) reason = 'heartbeat';
    if (reason === null) return null;

    this.lastMode = snap.mode;
    this.lastPostMs = t;
    this.sent++;

    // buildKiritanState derives `since`/`endsAt` from ctx.nowMs; keep them on the
    // same clock as the poster so a virtual-time test is fully deterministic.
    const state = buildKiritanState(snap, ctx);
    this.dispatch(state);
    return reason;
  }

  /** Force-send the current snapshot (e.g. on shutdown). Fire-and-forget. */
  flush(snap: FsmSnapshot, ctx: KiritanStateContext): void {
    this.lastMode = snap.mode;
    this.lastPostMs = this.now();
    this.sent++;
    this.dispatch(buildKiritanState(snap, ctx));
  }

  stats(): { sent: number; errors: number; lastMode: string | null } {
    return { sent: this.sent, errors: this.errors, lastMode: this.lastMode };
  }

  /** Detach the transport promise so neither rejection nor a hang reaches the host. */
  private dispatch(state: KiritanState): void {
    try {
      const p = this.transport(this.url, state);
      if (p && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).then(undefined, (e) => {
          this.errors++;
          this.onError(e);
        });
      }
    } catch (e) {
      // Synchronous throw from the transport itself — swallow it too.
      this.errors++;
      this.onError(e);
    }
  }
}
