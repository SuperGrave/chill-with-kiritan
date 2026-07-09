// Long Mode FSM (Phase 0, Test C).
//
// Owns which Long Mode kiritan is in: dwell timer, transition selection with
// daypart correction (§3.4) and the `sleepiness` variable, plus the special
// return/wake tables for away_room and sleep_desk. THREE-agnostic and driven
// by an injected Rng so a seeded soak is fully reproducible.
//
// Time model: the host advances the FSM with stepMinutes(dt, hour). The FSM
// keeps its own elapsed-minutes clock for `since`; `hour` (0..24 float) is
// supplied by the host so a virtual clock and the real clock share one path.

import type { Daypart, ModeId } from './types';
import { daypartForHour } from './types';
import { MODE_TABLE, PREV_SENTINEL } from './modeTable';
import type { Rng } from './rng';

export interface SleepinessConfig {
  /** Baseline accrual per minute while present and awake. */
  perMinute: number;
  /** Extra per-minute accrual during 夜20–24 / 深夜0–6. */
  nightPerMinute: number;
  /** Multiplier applied to work_sleepy / sleep_desk weights: w *= 1 + s*gain. */
  weightGain: number;
  /** Host override for every mode's dwell target. Omit to use MODE_TABLE. */
  dwellMinutes?: [number, number] | null;
}

const DEFAULT_SLEEPINESS: SleepinessConfig = {
  // ~0 at session start → ~1 after ~3h awake at night; tuned so nights tilt
  // toward sleepy/sleep without instantly pinning. (§3.4 補助変数)
  perMinute: 1 / 600, // ~10h to saturate from daytime alone
  nightPerMinute: 1 / 150, // ~2.5h of night to saturate
  weightGain: 2.0,
};

export interface FsmSnapshot {
  mode: ModeId;
  prevMode: ModeId | null;
  sinceMinutes: number; // elapsed in the current mode
  dwellTargetMinutes: number; // sampled dwell for the current visit
  sleepiness: number; // 0..1
}

export interface TransitionLogEntry {
  atMinutes: number; // absolute sim minutes
  hour: number;
  daypart: Daypart;
  from: ModeId;
  to: ModeId;
}

/**
 * Resolve one mode's outgoing candidates after daypart + sleepiness weighting.
 * When `allowedModes` is supplied, edges whose target isn't authored/enabled are
 * dropped (the host gates the FSM to the modes it actually has content for — an
 * unauthored target would otherwise leave the character on the wrong loop). The
 * design table (MODE_TABLE) is never edited for this; the gate is host-supplied.
 */
export function resolveTransitionWeights(
  mode: ModeId,
  hour: number,
  sleepiness: number,
  prevMode: ModeId | null,
  weightGain = DEFAULT_SLEEPINESS.weightGain,
  allowedModes?: ReadonlySet<ModeId>,
): { to: ModeId; weight: number }[] {
  const spec = MODE_TABLE[mode];
  const daypart = daypartForHour(hour);
  const edges = spec.returnTable ?? spec.transitions;
  const out: { to: ModeId; weight: number }[] = [];
  for (const e of edges) {
    let to = e.to;
    if ((to as string) === PREV_SENTINEL) {
      to = prevMode && prevMode !== 'away_room' ? prevMode : 'work_normal';
    }
    if (allowedModes && !allowedModes.has(to)) continue;
    const destDaypart = MODE_TABLE[to].daypart[daypart];
    let w = e.weight * destDaypart;
    if (to === 'work_sleepy' || to === 'sleep_desk') w *= 1 + sleepiness * weightGain;
    if (w > 0) out.push({ to, weight: w });
  }
  return out;
}

export class ModeFsm {
  private mode: ModeId;
  private prevMode: ModeId | null = null;
  private sinceMin = 0;
  private dwellTarget: number;
  private sleepiness = 0;
  private readonly rng: Rng;
  private readonly cfg: SleepinessConfig;
  /** When set, the FSM only ever transitions into these modes (host content gate). */
  private readonly allowedModes: ReadonlySet<ModeId> | null;

  constructor(
    rng: Rng,
    initial: ModeId = 'work_normal',
    cfg: Partial<SleepinessConfig> = {},
    allowedModes?: ReadonlySet<ModeId>,
  ) {
    this.rng = rng;
    this.cfg = { ...DEFAULT_SLEEPINESS, ...cfg };
    this.allowedModes = allowedModes && allowedModes.size > 0 ? allowedModes : null;
    this.mode = initial;
    this.dwellTarget = this.sampleDwell(initial);
  }

  snapshot(): FsmSnapshot {
    return {
      mode: this.mode,
      prevMode: this.prevMode,
      sinceMinutes: this.sinceMin,
      dwellTargetMinutes: this.dwellTarget,
      sleepiness: this.sleepiness,
    };
  }

  get currentMode(): ModeId {
    return this.mode;
  }
  get currentSleepiness(): number {
    return this.sleepiness;
  }

  /**
   * Advance by dt minutes at clock `hour` (0..24). Returns a transition entry
   * if a mode change fired this step, else null. May fire at most once per
   * call (dt should be small relative to dwell — 5 min in the soak).
   */
  stepMinutes(dt: number, hour: number): TransitionLogEntry | null {
    this.accrueSleepiness(dt, hour);
    this.sinceMin += dt;
    if (this.sinceMin < this.dwellTarget) return null;

    const from = this.mode;
    const to = this.pickNext(hour);
    const entry: TransitionLogEntry = {
      atMinutes: 0, // host fills absolute time if it wants; sinceMin reset below
      hour,
      daypart: daypartForHour(hour),
      from,
      to,
    };
    this.prevMode = from;
    this.mode = to;
    this.sinceMin = 0;
    this.dwellTarget = this.sampleDwell(to);
    // Entering sleep or away resets the sleep debt (§3.4).
    if (to === 'sleep_desk' || to === 'away_room') this.sleepiness = 0;
    return entry;
  }

  /** Advance timers/sleepiness without allowing a mode transition. */
  holdMinutes(dt: number, hour: number): void {
    this.accrueSleepiness(dt, hour);
    this.sinceMin += dt;
  }

  private pickNext(hour: number): ModeId {
    const cand = resolveTransitionWeights(
      this.mode,
      hour,
      this.sleepiness,
      this.prevMode,
      this.cfg.weightGain,
      this.allowedModes ?? undefined,
    );
    // Gated to empty (no authored target reachable) → stay on a safe, always-
    // authored sink rather than deadlocking. work_normal is the Phase-1 base.
    if (cand.length === 0) return 'work_normal'; // safety net; should never hit
    const idx = this.rng.weighted(cand.map((c) => c.weight));
    return cand[idx].to;
  }

  private sampleDwell(mode: ModeId): number {
    const override = this.cfg.dwellMinutes;
    const [lo, hi] = override && override[0] > 0 && override[1] >= override[0] ? override : MODE_TABLE[mode].dwellMin;
    return this.rng.range(lo, hi);
  }

  private accrueSleepiness(dt: number, hour: number): void {
    // Away/asleep don't accrue (they're the reset states); the soak resets on
    // entry anyway, but guard so a long away/sleep dwell stays at ~0.
    if (this.mode === 'away_room' || this.mode === 'sleep_desk') {
      this.sleepiness = 0;
      return;
    }
    const dpart = daypartForHour(hour);
    const night = dpart === 'night' || dpart === 'lateNight';
    const rate = this.cfg.perMinute + (night ? this.cfg.nightPerMinute : 0);
    this.sleepiness = Math.min(1, this.sleepiness + rate * dt);
  }
}
