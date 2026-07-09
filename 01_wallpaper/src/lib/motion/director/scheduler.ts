// Ambient Micro-Motion scheduler (Phase 0, Test C).
//
// Implements §3.1: per-mode interval [min,max] (uniform), weighted lottery,
// 直近2本除外, 同一motion 90秒クールダウン, 深夜帯 ×1.5 間隔, 🌙 night weight
// override. Prop-gated ambients (e.g. amb_*_sip needs cup) are excluded unless
// the host marks the prop available. THREE-agnostic, Rng-injected.

import { daypartForHour } from './types';
import type { ModeId } from './types';
import { MODE_TABLE } from './modeTable';
import type { Rng } from './rng';

export interface SchedulerConfig {
  /** 直近何本を除外するか（§3.1 = 2）。 */
  recentExclusion: number;
  /** 同一motion再抽選クールダウン秒（§3.1 = 90）。 */
  cooldownSec: number;
  /** 深夜帯の間隔倍率（§3.1 = 1.5）。 */
  lateNightIntervalMul: number;
  /** Host override for every mode's ambient interval. Omit to use MODE_TABLE. */
  intervalSeconds?: [number, number] | null;
  /** Props the host has available (gates amb_*_sip etc.). */
  availableProps: Set<string>;
  /** Treat availableMotions as an allow-list even when it is empty. */
  restrictAvailableMotions: boolean;
  /**
   * When restrictAvailableMotions is true, restrict the eligible pool to
   * ambient ids whose motion file is actually authored/enabled. Empty then
   * means "play no ambients"; false keeps the full design pool for tests.
   */
  availableMotions?: Set<string>;
}

const DEFAULTS: Omit<SchedulerConfig, 'availableProps'> = {
  recentExclusion: 2,
  cooldownSec: 90,
  lateNightIntervalMul: 1.5,
  restrictAvailableMotions: false,
};

export interface AmbientFire {
  id: string;
  /** Absolute sim seconds the fire occurred. */
  atSec: number;
}

export class AmbientScheduler {
  private mode: ModeId;
  private clockSec = 0;
  private nextFireAt = 0;
  private recent: string[] = [];
  private lastPlayed = new Map<string, number>();
  private readonly rng: Rng;
  private readonly cfg: SchedulerConfig;

  constructor(rng: Rng, mode: ModeId, cfg: Partial<SchedulerConfig> = {}) {
    this.rng = rng;
    this.cfg = { ...DEFAULTS, availableProps: new Set<string>(), ...cfg };
    this.mode = mode;
    this.armNext(0); // hour filled on first tick; arm with neutral interval
  }

  /** Switch mode (clears recent/cooldown history per the new pool). */
  setMode(mode: ModeId, hour: number): void {
    this.mode = mode;
    this.recent = [];
    this.lastPlayed.clear();
    this.armNext(hour);
  }

  /**
   * Advance by dt seconds at clock `hour`. Returns the fired ambient (or null).
   * Modes with no pool (away) or null interval never fire.
   */
  tickSeconds(dt: number, hour: number): AmbientFire | null {
    this.clockSec += dt;
    const spec = MODE_TABLE[this.mode];
    const interval = this.intervalFor(spec.ambientIntervalSec);
    if (!interval || spec.ambients.length === 0) return null;
    if (this.clockSec < this.nextFireAt) return null;

    const id = this.pick(hour);
    this.armNext(hour);
    if (!id) return null;

    this.lastPlayed.set(id, this.clockSec);
    this.recent.push(id);
    if (this.recent.length > this.cfg.recentExclusion) this.recent.shift();
    return { id, atSec: this.clockSec };
  }

  private armNext(hour: number): void {
    const spec = MODE_TABLE[this.mode];
    const interval = this.intervalFor(spec.ambientIntervalSec);
    if (!interval) {
      this.nextFireAt = Number.POSITIVE_INFINITY;
      return;
    }
    const [lo, hi] = interval;
    const mul = daypartForHour(hour) === 'lateNight' ? this.cfg.lateNightIntervalMul : 1;
    this.nextFireAt = this.clockSec + this.rng.range(lo, hi) * mul;
  }

  private intervalFor(modeInterval: [number, number] | null): [number, number] | null {
    if (!modeInterval) return null;
    const override = this.cfg.intervalSeconds;
    return override && override[0] > 0 && override[1] >= override[0] ? override : modeInterval;
  }

  // Build the eligible candidate list, relaxing constraints only if everything
  // is excluded, so a small pool can always fire something.
  private pick(hour: number): string | null {
    const spec = MODE_TABLE[this.mode];
    const lateNight = daypartForHour(hour) === 'lateNight';

    const motions = this.cfg.availableMotions;
    const restrict = this.cfg.restrictAvailableMotions && motions != null;
    const eligible = spec.ambients.filter((a) => {
      if (a.requiresProp && !this.cfg.availableProps.has(a.requiresProp)) return false;
      if (restrict && !motions.has(a.id)) return false;
      return true;
    });
    if (eligible.length === 0) return null;

    const weightOf = (a: (typeof eligible)[number]): number =>
      lateNight && a.nightWeight != null ? a.nightWeight : a.weight;

    // Tier 1: honour recent-2 AND cooldown.
    let pool = eligible.filter(
      (a) =>
        !this.recent.includes(a.id) &&
        this.clockSec - (this.lastPlayed.get(a.id) ?? -Infinity) >= this.cfg.cooldownSec,
    );
    // Tier 2: drop recent-2 (keep cooldown).
    if (pool.length === 0) {
      pool = eligible.filter(
        (a) => this.clockSec - (this.lastPlayed.get(a.id) ?? -Infinity) >= this.cfg.cooldownSec,
      );
    }
    // Tier 3: drop cooldown too (avoid only the immediately previous one).
    if (pool.length === 0) {
      const last = this.recent[this.recent.length - 1];
      pool = eligible.filter((a) => a.id !== last);
    }
    if (pool.length === 0) pool = eligible;

    const idx = this.rng.weighted(pool.map(weightOf));
    return pool[idx].id;
  }
}
