export interface RhythmSyncSignal {
  bpm: number;
  lockedAt: number;
}

export interface RhythmStateSignal {
  status: 'standby' | 'detecting' | 'locked';
  lockedBpm: number | null;
  /** Monotonic event time. Supplying it makes the BPM-loss grace period exact. */
  at?: number;
}

export interface RhythmBeatSignal {
  at: number;
  lockedBpm: number | null;
  energy: number;
}

export interface RhythmMotionInput {
  enabled: boolean;
  strength: number;
  /** Seconds to keep the selected motion bank running after BPM lock is lost. */
  holdSeconds?: number;
  mode?: string | null;
}

/**
 * Named rhythm figures for the music_listen (音楽ノリノリ) mode.
 * 'groove' is the subtle everywhere-nod that predates the figures.
 * (首振り 'headnod' is planned as the third figure — the tiny groove nod
 * already sketches it; promote it to a full figure later.)
 */
export type RhythmFigure = 'groove' | 'sway' | 'fingertap';

export interface RhythmMotionFrame {
  active: boolean;
  bpm: number | null;
  weight: number;
  /** Figure currently leading the blend (null when inactive). */
  figure: RhythmFigure | null;
  /** Beat phase 0..1 (0 = on the beat). Exposed for tests/verification. */
  beatPhase: number;
  headPitch: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  chestRoll: number;
  spineRoll: number;
  leftShoulderRoll: number;
  rightShoulderRoll: number;
  /** Right wrist raise (radians, magnitude — the viewer owns the sign/axis). */
  rightHandLift: number;
  /** Right finger raise (radians base — the viewer fans it per finger). */
  rightFingerLift: number;
  /** 0..1 'fun' morph target — she smiles while she is grooving. */
  smile: number;
}

const ZERO_FRAME: RhythmMotionFrame = {
  active: false,
  bpm: null,
  weight: 0,
  figure: null,
  beatPhase: 0,
  headPitch: 0,
  headRoll: 0,
  neckPitch: 0,
  chestPitch: 0,
  chestRoll: 0,
  spineRoll: 0,
  leftShoulderRoll: 0,
  rightShoulderRoll: 0,
  rightHandLift: 0,
  rightFingerLift: 0,
  smile: 0,
};

/** Channels a figure writes; blended between two figures during a rotation. */
interface FigureChannels {
  headPitch: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  chestRoll: number;
  spineRoll: number;
  leftShoulderRoll: number;
  rightShoulderRoll: number;
  rightHandLift: number;
  rightFingerLift: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

function modeScale(mode: string | null | undefined): number {
  if (mode === 'away_room' || mode === 'sleep_desk') return 0;
  if (mode === 'video_relax') return 0.9;
  return 0.55;
}

// --- music_listen figure tuning ---------------------------------------------

/** Sway is a slow-tempo figure; above this BPM it leaves the rotation pool. */
const SWAY_MAX_BPM = 112;
/** One full left-right-left sway spans this many beats. */
const SWAY_CYCLE_BEATS = 2;
/** A figure holds the stage for this many beats (8 bars in 4/4). */
const FIGURE_SPAN_BEATS = 32;
/** Crossfade seconds when the figures rotate. */
const FIGURE_CROSSFADE_SEC = 1.4;
/** The strength slider default; figure amplitudes are authored at this value. */
const REFERENCE_STRENGTH = 0.35;
/** Fixed motion-bank range. Every entry is authored on a one-BPM grid. */
export const BPM_MOTION_BANK_MIN = 40;
export const BPM_MOTION_BANK_MAX = 240;
export const BPM_MOTION_BANK_STEP = 1;
export const DEFAULT_RHYTHM_MOTION_HOLD_SECONDS = 8;

export interface BpmMotionPreset {
  bpm: number;
  beatMs: number;
  swayCycleMs: number;
  tapBeats: 1 | 2;
  nodBeats: 1 | 2;
  openingFigure: Exclude<RhythmFigure, 'groove'>;
}

/**
 * Prepared one-BPM fixed-speed loops. Detection jitter can only select another entry;
 * it can no longer continuously stretch the motion on every estimate.
 */
export const BPM_MOTION_BANK: readonly BpmMotionPreset[] = Object.freeze(
  Array.from(
    { length: (BPM_MOTION_BANK_MAX - BPM_MOTION_BANK_MIN) / BPM_MOTION_BANK_STEP + 1 },
    (_, index): BpmMotionPreset => {
      const bpm = BPM_MOTION_BANK_MIN + index * BPM_MOTION_BANK_STEP;
      const beatMs = 60_000 / bpm;
      return Object.freeze({
        bpm,
        beatMs,
        swayCycleMs: beatMs * SWAY_CYCLE_BEATS,
        tapBeats: 1,
        nodBeats: 1,
        openingFigure: bpm <= SWAY_MAX_BPM ? 'sway' : 'fingertap',
      });
    },
  ),
);

export function selectBpmMotionPreset(rawBpm: number): BpmMotionPreset | null {
  if (!Number.isFinite(rawBpm) || rawBpm < 30 || rawBpm > 300) return null;
  const bucket = Math.max(
    BPM_MOTION_BANK_MIN,
    Math.min(BPM_MOTION_BANK_MAX, Math.round(rawBpm / BPM_MOTION_BANK_STEP) * BPM_MOTION_BANK_STEP),
  );
  return BPM_MOTION_BANK[(bucket - BPM_MOTION_BANK_MIN) / BPM_MOTION_BANK_STEP] ?? null;
}

/**
 * Percussive tap envelope over one tap period. 0 = fingers resting on the
 * keys; 1 = raised. The fall accelerates into phase 1 so the strike lands ON
 * the beat (phase wraps to 0 exactly at the onset).
 */
function tapLiftCurve(phase: number): number {
  const p = clamp01(phase);
  if (p < 0.08) return 0; // rest right after the strike
  if (p < 0.45) return smoothstep((p - 0.08) / 0.37); // ease the hand up
  if (p < 0.7) return 1; // hover
  const f = (p - 0.7) / 0.3; // accelerate down = the tap itself
  return 1 - f * f;
}

/**
 * Converts a locked BPM into upper-body rhythm motion.
 *
 * This deliberately never chooses or swaps a clip. The Motion Director and
 * authored DSL/VRMA stay authoritative; the controller only emits offsets for
 * the final normalized-bone composition pass (pre hand-pin IK, so a planted
 * wrist stays planted while the torso sways). That keeps hand pins, props,
 * transitions and authored motion intact.
 *
 * Everything is computed from one of the fixed one-BPM oscillators. A same-
 * bucket re-lock keeps the oscillator running; a real bucket change preserves
 * beat phase and crossfades the tempo-appropriate opening figure.
 *
 * Outside music_listen the controller keeps its original behaviour: a tiny
 * additive groove (small nod + sway) scaled well below the authored motion.
 * In music_listen (音楽ノリノリモード) it runs full figures — 横揺れ (sway)
 * and 指トントン (finger tap) — rotating every few bars with a crossfade.
 */
export class RhythmMotionController {
  private preset: BpmMotionPreset | null = null;
  private phaseAnchorMs = 0;
  private lostAtMs: number | null = null;
  private lastUpdateMs = 0;
  private weight = 0;
  private lastEnergy = 0.5;
  private smile = 0;

  // Figure rotation state (music_listen only).
  private figure: RhythmFigure = 'fingertap';
  private prevFigure: RhythmFigure | null = null;
  private figureStartBeat = 0;
  private figureBlend = 1; // 0 = fully prevFigure, 1 = fully current

  sync(signal: RhythmSyncSignal): void {
    const next = selectBpmMotionPreset(signal.bpm);
    if (!next) return;
    const at = Number.isFinite(signal.lockedAt) ? signal.lockedAt : this.lastUpdateMs;
    const previous = this.preset;
    this.lostAtMs = null;

    // Re-locking into the same one-BPM entry only cancels the loss timer.
    // Keeping the oscillator and figure state intact prevents a visible jump.
    if (previous?.bpm === next.bpm) return;

    const oldBeatFloat = previous ? this.beatFloat(at) : 0;
    const oldBeatPhase = ((oldBeatFloat % 1) + 1) % 1;
    this.preset = next;
    // A bank change preserves the current fractional beat so tempo switches
    // do not snap the body back to the first frame. A fresh lock starts at 0.
    this.phaseAnchorMs = previous ? at - oldBeatPhase * next.beatMs : at;
    this.figureStartBeat = this.beatFloat(at);

    const nextFigure = next.openingFigure;
    if (!previous) {
      this.figure = nextFigure;
      this.prevFigure = null;
      this.figureBlend = 1;
    } else if (this.figure !== nextFigure) {
      this.prevFigure = this.figure;
      this.figure = nextFigure;
      this.figureBlend = 0;
    }
  }

  rhythm(signal: RhythmStateSignal): void {
    if (signal.status === 'locked' && signal.lockedBpm !== null) return;
    if (this.preset !== null && this.lostAtMs === null) {
      const at = Number(signal.at);
      this.lostAtMs = Number.isFinite(at) ? at : this.lastUpdateMs;
    }
  }

  beat(signal: RhythmBeatSignal): void {
    if (this.preset === null || signal.lockedBpm === null) return;
    // The selected motion bank owns phase after lock. Per-onset corrections
    // made noisy snare/subdivision detections visibly tug the character.
    this.lastEnergy = clamp01(Number.isFinite(signal.energy) ? signal.energy : 0.5);
  }

  /** Continuous beats elapsed since the phase anchor (fractional). */
  private beatFloat(nowMs: number): number {
    if (this.preset === null) return 0;
    return (nowMs - this.phaseAnchorMs) / this.preset.beatMs;
  }

  private rotateFigureIfDue(nowMs: number): void {
    if (this.preset === null) return;
    const beats = this.beatFloat(nowMs) - this.figureStartBeat;
    if (beats < FIGURE_SPAN_BEATS) return;
    const next: RhythmFigure =
      this.preset.bpm <= SWAY_MAX_BPM ? (this.figure === 'sway' ? 'fingertap' : 'sway') : 'fingertap';
    if (next === this.figure) {
      this.figureStartBeat += FIGURE_SPAN_BEATS; // stay, restart the span
      return;
    }
    this.prevFigure = this.figure;
    this.figure = next;
    this.figureStartBeat += FIGURE_SPAN_BEATS;
    this.figureBlend = 0;
  }

  /** Channels for one figure at the current beat position. Amplitudes are in
   *  radians at reference strength; the caller applies weight/energy/gain. */
  private figureChannels(figure: RhythmFigure, beatFloat: number, out: FigureChannels): FigureChannels {
    out.headPitch = 0; out.headRoll = 0; out.neckPitch = 0;
    out.chestPitch = 0; out.chestRoll = 0; out.spineRoll = 0;
    out.leftShoulderRoll = 0; out.rightShoulderRoll = 0;
    out.rightHandLift = 0; out.rightFingerLift = 0;
    const preset = this.preset;
    const bpm = preset?.bpm ?? 120;
    const beatPhase = ((beatFloat % 1) + 1) % 1;

    // Groove keeps its original decaying pulse (test/back-compat for the
    // subtle non-music groove). The MUSIC figures ride a continuous cosine
    // instead: the old quarter-beat pulse spent 75% of every beat dead still
    // and popped back on the next onset, which read as カクカク (master FB
    // 2026-07-19). cos(2π·phase) peaks exactly ON the beat, is smooth across
    // the wrap. High tempi intentionally stay at one motion cycle per beat;
    // silently halving the apparent tempo made the character feel unsynced.
    const nod = Math.sin(Math.min(1, beatPhase * 4) * Math.PI) * Math.exp(-beatPhase * 4.2);
    const nodBeats = preset?.nodBeats ?? 1;
    const nodPhase = ((beatFloat / nodBeats) % 1 + 1) % 1;
    const smoothNod = Math.cos(nodPhase * Math.PI * 2);

    if (figure === 'sway') {
      // 腰より上をゆっくり横揺れ: full cycle over 2 beats, throw tapering as
      // the tempo rises so a 110 BPM sway never whips.
      const cycle = ((beatFloat / SWAY_CYCLE_BEATS) % 1 + 1) % 1;
      const s = Math.sin(cycle * Math.PI * 2);
      const taper = 1 - 0.35 * clamp01((bpm - 80) / (SWAY_MAX_BPM - 80));
      out.spineRoll = s * 0.052 * taper;
      out.chestRoll = s * 0.042 * taper;
      // The head stays a touch more level than the torso (natural balance).
      out.headRoll = -s * 0.024 * taper;
      out.leftShoulderRoll = s * 0.012 * taper;
      out.rightShoulderRoll = s * 0.012 * taper;
      out.headPitch = smoothNod * 0.008;
      out.neckPitch = smoothNod * 0.005;
    } else if (figure === 'fingertap') {
      // 指トントン: palm + fingers lift together and drop ON every beat.
      const tapBeats = preset?.tapBeats ?? 1;
      const tapPhase = ((beatFloat / tapBeats) % 1 + 1) % 1;
      const lift = tapLiftCurve(tapPhase);
      out.rightHandLift = lift * 0.085;
      out.rightFingerLift = lift * 0.30;
      out.headPitch = smoothNod * 0.013;
      out.neckPitch = smoothNod * 0.0075;
      out.chestPitch = smoothNod * 0.0035;
    } else {
      // 'groove' — the original subtle everywhere motion.
      const sway = Math.sin(beatPhase * Math.PI * 2);
      out.headPitch = nod * 0.034;
      out.neckPitch = nod * 0.019;
      out.chestPitch = nod * 0.008;
      out.chestRoll = sway * 0.006;
      out.leftShoulderRoll = sway * 0.008;
      out.rightShoulderRoll = -sway * 0.008;
    }
    return out;
  }

  private readonly _chA: FigureChannels = {
    headPitch: 0, headRoll: 0, neckPitch: 0, chestPitch: 0, chestRoll: 0,
    spineRoll: 0, leftShoulderRoll: 0, rightShoulderRoll: 0, rightHandLift: 0, rightFingerLift: 0,
  };
  private readonly _chB: FigureChannels = {
    headPitch: 0, headRoll: 0, neckPitch: 0, chestPitch: 0, chestRoll: 0,
    spineRoll: 0, leftShoulderRoll: 0, rightShoulderRoll: 0, rightHandLift: 0, rightFingerLift: 0,
  };

  update(nowMs: number, deltaSeconds: number, input: RhythmMotionInput): RhythmMotionFrame {
    this.lastUpdateMs = nowMs;
    const holdSeconds = Number.isFinite(Number(input.holdSeconds))
      ? Math.max(0, Math.min(60, Number(input.holdSeconds)))
      : DEFAULT_RHYTHM_MOTION_HOLD_SECONDS;
    if (this.preset !== null && this.lostAtMs !== null && nowMs - this.lostAtMs >= holdSeconds * 1000) {
      this.preset = null;
    }
    const bpm = this.preset?.bpm ?? null;
    const music = input.mode === 'music_listen';
    const target = input.enabled && this.preset !== null
      ? clamp01(input.strength) * (music ? 1 : modeScale(input.mode))
      : 0;
    const response = target > this.weight ? 5.5 : 3.2;
    const dt = Math.max(0, deltaSeconds);
    const blend = 1 - Math.exp(-dt * response);
    this.weight += (target - this.weight) * blend;

    // Smile eases in while she grooves in music mode, out everywhere else.
    const smileTarget = music && target > 0 ? 0.38 : 0;
    const smileResponse = smileTarget > this.smile ? 1.6 : 3.5;
    this.smile += (smileTarget - this.smile) * (1 - Math.exp(-dt * smileResponse));
    if (this.smile < 0.001) this.smile = 0;

    if (this.weight < 0.0001 || this.preset === null) {
      if (target === 0 && this.weight < 0.0001) this.weight = 0;
      return { ...ZERO_FRAME, bpm, weight: this.weight, smile: this.smile };
    }

    const beatFloat = this.beatFloat(nowMs);
    const beatPhase = ((beatFloat % 1) + 1) % 1;
    const energy = 0.72 + this.lastEnergy * 0.28;

    if (music) {
      this.rotateFigureIfDue(nowMs);
      if (this.figureBlend < 1) {
        this.figureBlend = Math.min(1, this.figureBlend + dt / FIGURE_CROSSFADE_SEC);
      }
      // Figure amplitudes are authored at the default slider value; the gain
      // keeps the default install expressive while the slider still scales.
      const gain = Math.min(1.6, clamp01(input.strength) / REFERENCE_STRENGTH);
      // weight carries strength (shared envelope with the subtle groove); the
      // division recovers the pure 0..1 fade, gain reapplies the slider.
      const envelope = this.weight / Math.max(0.0001, clamp01(input.strength));
      const w = Math.min(1, envelope) * gain * energy;
      const a = this.figureChannels(this.figure, beatFloat, this._chA);
      let mixed = a;
      if (this.prevFigure && this.figureBlend < 1) {
        const b = this.figureChannels(this.prevFigure, beatFloat, this._chB);
        const t = smoothstep(this.figureBlend);
        mixed = a; // blend into _chA in place
        mixed.headPitch = b.headPitch + (a.headPitch - b.headPitch) * t;
        mixed.headRoll = b.headRoll + (a.headRoll - b.headRoll) * t;
        mixed.neckPitch = b.neckPitch + (a.neckPitch - b.neckPitch) * t;
        mixed.chestPitch = b.chestPitch + (a.chestPitch - b.chestPitch) * t;
        mixed.chestRoll = b.chestRoll + (a.chestRoll - b.chestRoll) * t;
        mixed.spineRoll = b.spineRoll + (a.spineRoll - b.spineRoll) * t;
        mixed.leftShoulderRoll = b.leftShoulderRoll + (a.leftShoulderRoll - b.leftShoulderRoll) * t;
        mixed.rightShoulderRoll = b.rightShoulderRoll + (a.rightShoulderRoll - b.rightShoulderRoll) * t;
        mixed.rightHandLift = b.rightHandLift + (a.rightHandLift - b.rightHandLift) * t;
        mixed.rightFingerLift = b.rightFingerLift + (a.rightFingerLift - b.rightFingerLift) * t;
      } else if (this.prevFigure) {
        this.prevFigure = null;
      }
      return {
        active: true,
        bpm,
        weight: this.weight,
        figure: this.figure,
        beatPhase,
        headPitch: mixed.headPitch * w,
        headRoll: mixed.headRoll * w,
        neckPitch: mixed.neckPitch * w,
        chestPitch: mixed.chestPitch * w,
        chestRoll: mixed.chestRoll * w,
        spineRoll: mixed.spineRoll * w,
        leftShoulderRoll: mixed.leftShoulderRoll * w,
        rightShoulderRoll: mixed.rightShoulderRoll * w,
        rightHandLift: mixed.rightHandLift * w,
        rightFingerLift: mixed.rightFingerLift * w,
        smile: this.smile,
      };
    }

    // Original subtle groove for every other mode (weight already carries
    // strength * modeScale, exactly as before the figures existed).
    const g = this.figureChannels('groove', beatFloat, this._chA);
    const w = this.weight * energy;
    return {
      active: true,
      bpm,
      weight: this.weight,
      figure: 'groove',
      beatPhase,
      headPitch: g.headPitch * w,
      headRoll: 0,
      neckPitch: g.neckPitch * w,
      chestPitch: g.chestPitch * w,
      chestRoll: g.chestRoll * w,
      spineRoll: 0,
      leftShoulderRoll: g.leftShoulderRoll * w,
      rightShoulderRoll: g.rightShoulderRoll * w,
      rightHandLift: 0,
      rightFingerLift: 0,
      smile: this.smile,
    };
  }
}
