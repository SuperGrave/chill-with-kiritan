// Director Runner (INF-5) — drives the Long-Mode FSM + Ambient scheduler in
// real time and emits "play this clip now" actions for the host (VrmViewer) to
// execute via its external-clip swap path. THREE-agnostic and Rng-injected, so
// it stays Node-testable like the rest of src/lib/motion/director/.
//
// Model:
//   * The host plays a mode's BASE LOOP (loop_<mode>) continuously.
//   * The scheduler periodically fires an AMBIENT one-shot; the runner emits it,
//     the host crossfades it in over the loop, and on the clip's 'finished'
//     event calls onAmbientEnded() to resume the loop.
//   * Mode transitions (FSM) swap the base loop; they win over a playing ambient.
//   * The scheduler clock is NOT advanced while an ambient plays, so ambients are
//     spaced by LOOP time (the ambient's own duration doesn't count against the
//     interval) — which is what "every 25–70 s of working" should mean.

import { ModeFsm, type FsmSnapshot, type SleepinessConfig } from './modeFsm';
import { AmbientScheduler, type SchedulerConfig } from './scheduler';
import { makeRng } from './rng';
import type { ModeId } from './types';

/** Director playback phase. `reactive` is reserved for Phase-2 command/chat. */
export type DirectorPlaybackState = 'idle' | 'loop' | 'ambient' | 'transition' | 'reactive';

export type DirectorAction =
  | { kind: 'loop'; mode: ModeId; motionId: string }
  | { kind: 'ambient'; mode: ModeId; ambientId: string; motionId: string }
  | {
      kind: 'transition';
      /** Target mode the chain is heading INTO. */
      mode: ModeId;
      /** Mode the chain is leaving. */
      from: ModeId;
      motionId: string;
      /** 0-based position in the chain, and the chain length. */
      index: number;
      count: number;
    };

export interface DirectorRunnerConfig {
  seed?: number;
  initialMode?: ModeId;
  availableProps?: Set<string>;
  /** Authored ambient ids — restricts the scheduler pool to what can actually play. */
  availableMotions?: Set<string>;
  /**
   * Modes the FSM is allowed to transition into (host content gate). When set,
   * edges to any other mode are dropped so the character never lands on an
   * unauthored loop. Omit/empty = full design-table cycle (all 12 modes).
   */
  allowedModes?: Set<ModeId>;
  /** mode → base-loop motion id (null = no loop authored; the host keeps the current clip). */
  loopMotionFor: (mode: ModeId) => string | null;
  /** ambient id → motion id (default: identity — the file is named after the id). */
  ambientMotionFor?: (ambientId: string) => string;
  /**
   * Resolve the bridging Transition motion ids for a (from → to) mode change,
   * in play order (Step 1). The host returns only the chain it can actually
   * play (filtered by what is authored/preloaded), or [] to swap straight to
   * the target loop. Omit to disable transitions entirely (legacy behaviour).
   */
  transitionMotionsFor?: (from: ModeId, to: ModeId) => string[];
  sleepiness?: Partial<SleepinessConfig>;
  scheduler?: Partial<Pick<SchedulerConfig, 'recentExclusion' | 'cooldownSec' | 'lateNightIntervalMul'>>;
}

export interface DirectorStatus {
  mode: ModeId;
  state: DirectorPlaybackState;
  sinceMinutes: number;
  sleepiness: number;
  lastAmbient: string | null;
  ambientCount: number;
  /** Active transition chain progress (null unless state === 'transition'). */
  transition: { from: ModeId; motionId: string; index: number; count: number } | null;
  transitionCount: number;
}

export class DirectorRunner {
  private readonly fsm: ModeFsm;
  private readonly sched: AmbientScheduler;
  private readonly cfg: DirectorRunnerConfig;
  private mode: ModeId;
  private state: DirectorPlaybackState = 'idle';
  private lastAmbient: string | null = null;
  private ambientCount = 0;
  // Transition chain in flight (Step 1). `queue` is the REMAINING motions after
  // the one currently playing; `current` is what the host is playing now.
  private transitionFrom: ModeId | null = null;
  private transitionCurrent: string | null = null;
  private transitionQueue: string[] = [];
  private transitionTotal = 0;
  private transitionIndex = 0; // 0-based index of `current` within the chain
  private transitionCount = 0; // lifetime count of transition chains started

  constructor(cfg: DirectorRunnerConfig) {
    this.cfg = cfg;
    const rng = makeRng(cfg.seed ?? (Date.now() & 0xffffffff) >>> 0);
    this.mode = cfg.initialMode ?? 'work_normal';
    this.fsm = new ModeFsm(rng, this.mode, cfg.sleepiness, cfg.allowedModes);
    this.sched = new AmbientScheduler(rng, this.mode, {
      ...cfg.scheduler,
      availableProps: cfg.availableProps ?? new Set(),
      availableMotions: cfg.availableMotions,
    });
  }

  private motionForAmbient(id: string): string {
    return this.cfg.ambientMotionFor ? this.cfg.ambientMotionFor(id) : id;
  }

  /** Begin: returns the initial mode's loop action (or null if none authored). */
  start(): DirectorAction | null {
    this.state = 'loop';
    const m = this.cfg.loopMotionFor(this.mode);
    return m ? { kind: 'loop', mode: this.mode, motionId: m } : null;
  }

  /**
   * Advance by dt seconds at clock `hour` (0..24). Returns at most one action to
   * execute now: a mode-change transition/loop swap (wins) or an ambient one-shot.
   */
  tick(dtSec: number, hour: number): DirectorAction | null {
    // While a transition chain is playing, freeze the FSM dwell + scheduler so a
    // transition is never preempted by another mode change or an ambient (no
    // double-transition, no ambient during a transition). The chain advances
    // only on onClipFinished(); the host owns its timing.
    if (this.state === 'transition') return null;

    // Mode transitions run on the FSM's minute clock and win over ambients.
    const t = this.fsm.stepMinutes(dtSec / 60, hour);
    if (t) return this.beginModeChange(t.from, t.to, hour);

    // Ambients only fire from the loop state; the scheduler clock pauses during
    // an ambient (we simply don't tick it), so the interval is loop-time.
    if (this.state === 'loop') {
      const f = this.sched.tickSeconds(dtSec, hour);
      if (f) {
        this.state = 'ambient';
        this.lastAmbient = f.id;
        this.ambientCount++;
        return { kind: 'ambient', mode: this.mode, ambientId: f.id, motionId: this.motionForAmbient(f.id) };
      }
    }
    return null;
  }

  /**
   * Commit a mode change: switch the scheduler pool to the target, then either
   * begin its bridging transition chain (if authored) or swap straight to the
   * target loop. Returns the first action to play.
   */
  private beginModeChange(from: ModeId, to: ModeId, hour: number): DirectorAction | null {
    this.mode = to;
    this.sched.setMode(to, hour);
    const chain = this.cfg.transitionMotionsFor ? this.cfg.transitionMotionsFor(from, to) : [];
    if (chain.length > 0) {
      this.state = 'transition';
      this.transitionFrom = from;
      this.transitionTotal = chain.length;
      this.transitionIndex = 0;
      this.transitionCurrent = chain[0];
      this.transitionQueue = chain.slice(1);
      this.transitionCount++;
      return { kind: 'transition', mode: to, from, motionId: chain[0], index: 0, count: chain.length };
    }
    return this.enterLoop();
  }

  /** Land in the loop state and emit the target loop action (null = none authored). */
  private enterLoop(): DirectorAction | null {
    this.state = 'loop';
    this.transitionFrom = null;
    this.transitionCurrent = null;
    this.transitionQueue = [];
    const m = this.cfg.loopMotionFor(this.mode);
    return m ? { kind: 'loop', mode: this.mode, motionId: m } : null;
  }

  /**
   * The host's one-shot clip finished. Advances a transition chain (next link
   * or, when the chain is done, the target loop) or resumes the mode loop after
   * an ambient. Loops never fire 'finished', so this only sees transition/ambient
   * ends. Returns the next action to play, or null when nothing changes.
   */
  onClipFinished(): DirectorAction | null {
    if (this.state === 'transition') {
      const next = this.transitionQueue.shift();
      if (next) {
        this.transitionIndex++;
        this.transitionCurrent = next;
        return {
          kind: 'transition',
          mode: this.mode,
          from: this.transitionFrom ?? this.mode,
          motionId: next,
          index: this.transitionIndex,
          count: this.transitionTotal,
        };
      }
      return this.enterLoop(); // chain complete → target loop
    }
    if (this.state === 'ambient') {
      this.state = 'loop';
      const m = this.cfg.loopMotionFor(this.mode);
      return m ? { kind: 'loop', mode: this.mode, motionId: m } : null;
    }
    return null;
  }

  /** @deprecated Use onClipFinished() — kept so older host wiring still resolves. */
  onAmbientEnded(): DirectorAction | null {
    return this.onClipFinished();
  }

  /**
   * Abort any in-flight transition chain and force the mode loop (safety
   * fallback — e.g. the host could not play a transition clip). Returns the
   * loop action so the host can recover deterministically.
   */
  abortTransition(): DirectorAction | null {
    if (this.state !== 'transition') return null;
    return this.enterLoop();
  }

  /** Raw FSM snapshot (mode/prevMode/sinceMinutes/sleepiness) — the shape
   * kiritanPoster.ts needs for the Companion wire object (Stage C). */
  snapshot(): FsmSnapshot {
    return this.fsm.snapshot();
  }

  status(): DirectorStatus {
    const s = this.fsm.snapshot();
    return {
      mode: this.mode,
      state: this.state,
      sinceMinutes: Math.round(s.sinceMinutes * 100) / 100,
      sleepiness: Math.round(s.sleepiness * 1000) / 1000,
      lastAmbient: this.lastAmbient,
      ambientCount: this.ambientCount,
      transition:
        this.state === 'transition' && this.transitionCurrent
          ? {
              from: this.transitionFrom ?? this.mode,
              motionId: this.transitionCurrent,
              index: this.transitionIndex,
              count: this.transitionTotal,
            }
          : null,
      transitionCount: this.transitionCount,
    };
  }
}
