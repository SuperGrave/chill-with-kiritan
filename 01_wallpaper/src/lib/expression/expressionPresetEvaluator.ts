// Expression Preset Evaluator (Expression Preset System 0.2)
//
// The merge / envelope half of the preset system. Framework-agnostic (no
// THREE, no React) and deterministic, so the whole module is verifiable in
// Node — same policy as IdleStateMachine / ExternalMotionController.
//
// Two consumption styles:
//   * ExpressionOverlayController — small stateful controller for the LIVE
//     viewer path (debug UI today; motion cues use the stateless path below).
//     Snapshot-crossfades between presets exactly like the idle machine's
//     pose fades, so switching presets mid-fade never pops.
//   * evaluateExpressionCue(s) — stateless timeline evaluation for motion
//     cues (start/fadeIn/hold/fadeOut on a clip-local clock). This is the
//     contract the Motion DSL exprCues run through, both in the Lab preview
//     and at runtime; nothing in it assumes a running viewer.
//
// Merge policy: max-blend, weights clamped to 0..1. Max-blend is what the
// viewer already does for the idle overlay and blink, and it guarantees a
// preset can never *suppress* the user's manual expression — only add.
//
// 0.2: lookAtStrength is gone (cursor follow no longer exists). Presets now
// carry a `gaze` hint instead — outputs expose it as a GazeFix {yaw,pitch,k}
// plus a wander multiplier, eased by the same envelope as the weights, ready
// to feed the GazeController. Presets with `flutter` wobble their intensity
// on a slow sine (deterministic in t / controller-internal time).

import type { ExpressionPreset } from './expressionPresets';
import { flattenPresetWeights, flutterValue, getExpressionPreset } from './expressionPresets';
import type { GazeFix } from '../motion/gazeController';

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}

/**
 * Max-blend any number of name->weight maps into one, clamping every weight
 * to 0..1. Later layers can only raise a value, never lower it.
 */
export function mergeExpressionWeights(
  ...layers: (Record<string, number> | undefined)[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [name, w] of Object.entries(layer)) {
      const v = clamp01(w);
      if (v <= 0) continue;
      if (v > (out[name] ?? 0)) out[name] = v;
    }
  }
  return out;
}

/** Preset gaze hint -> GazeFix at envelope k (k carries the easing). */
function presetGazeFix(preset: ExpressionPreset | null | undefined, k: number): GazeFix {
  const g = preset?.gaze;
  if (!g || g.yaw === undefined && g.pitch === undefined) return { yaw: 0, pitch: 0, k: 0 };
  return { yaw: g.yaw ?? 0, pitch: g.pitch ?? 0, k: clamp01(k) };
}

/** Preset wander multiplier eased by envelope k (1 = no damping). */
function presetWander(preset: ExpressionPreset | null | undefined, k: number): number {
  const w = preset?.gaze?.wander;
  if (w === undefined) return 1;
  return 1 + (clamp01(w) - 1) * clamp01(k);
}

// --- Cue timeline (Motion DSL contract) --------------------------------------------

export interface ExpressionCue {
  presetId: string;
  /** Peak intensity 0..1 (default 1). */
  intensity?: number;
  /** Clip-local start time (s). */
  start: number;
  /** Seconds to ramp 0->1 from start (default: preset.timing.fadeIn, else 0.5). */
  fadeIn?: number;
  /**
   * Seconds held at peak after the ramp (default: preset.timing.hold, else 0).
   * Infinity = hold until something else takes over (open-ended cue).
   */
  hold?: number;
  /** Seconds to ramp back to 0 (default: preset.timing.fadeOut, else 0.5). */
  fadeOut?: number;
  /** Overlap tie-break; higher wins the gaze hint (default: preset.priority, else 0). */
  priority?: number;
}

/** Trapezoid envelope value (0..1, smoothstepped ramps) for a cue at local time t. */
export function cueEnvelope(cue: ExpressionCue, preset: ExpressionPreset | undefined, t: number): number {
  const fadeIn = Math.max(0, cue.fadeIn ?? preset?.timing?.fadeIn ?? 0.5);
  const hold = cue.hold ?? preset?.timing?.hold ?? 0;
  const fadeOut = Math.max(0, cue.fadeOut ?? preset?.timing?.fadeOut ?? 0.5);
  const dt = t - cue.start;
  if (dt < 0) return 0;
  if (dt < fadeIn) return smoothstep(fadeIn <= 0 ? 1 : dt / fadeIn);
  const afterRamp = dt - fadeIn;
  if (!Number.isFinite(hold)) return 1; // open-ended
  if (afterRamp <= hold) return 1;
  const fall = afterRamp - hold;
  if (fadeOut <= 0) return 0;
  if (fall >= fadeOut) return 0;
  return 1 - smoothstep(fall / fadeOut);
}

export interface CueEvalResult {
  /** Bridge-name weights (eyelid flattened), max-blended over all active cues. */
  weights: Record<string, number>;
  /** Winning cue's fixed-gaze hint, eased by its envelope (k=0 when none). */
  gazeFix: GazeFix;
  /** Wander amplitude multiplier from the winning cue (1 = no damping). */
  gazeWander: number;
  /** Highest-priority active cue's preset id, for debug display. null = none. */
  activePresetId: string | null;
}

/**
 * Evaluate a cue list at clip-local time. Stateless: same (cues, t) always
 * yields the same output, so a scrubbing Lab preview and the runtime agree.
 * Presets with `flutter` wobble their intensity on the same clock. Unknown
 * preset ids are skipped (the Lab/validator reports them upstream).
 */
export function evaluateExpressionCues(
  cues: readonly ExpressionCue[],
  localTime: number,
  resolve: (id: string) => ExpressionPreset | undefined = getExpressionPreset,
): CueEvalResult {
  const layers: Record<string, number>[] = [];
  let winner: { priority: number; envelope: number; preset: ExpressionPreset } | null = null;
  for (const cue of cues) {
    const preset = resolve(cue.presetId);
    if (!preset) continue;
    const env = cueEnvelope(cue, preset, localTime);
    if (env <= 0) continue;
    const intensity = clamp01(cue.intensity ?? 1) * env * flutterValue(preset, localTime);
    layers.push(flattenPresetWeights(preset, intensity));
    const priority = cue.priority ?? preset.priority ?? 0;
    if (!winner || priority > winner.priority || (priority === winner.priority && env > winner.envelope)) {
      winner = { priority, envelope: env, preset };
    }
  }
  return {
    weights: mergeExpressionWeights(...layers),
    gazeFix: presetGazeFix(winner?.preset, winner?.envelope ?? 0),
    gazeWander: presetWander(winner?.preset, winner?.envelope ?? 0),
    activePresetId: winner?.preset.id ?? null,
  };
}

/** Single-cue convenience (the brief's evaluateExpressionCue). */
export function evaluateExpressionCue(
  cue: ExpressionCue,
  localTime: number,
  resolve: (id: string) => ExpressionPreset | undefined = getExpressionPreset,
): CueEvalResult {
  return evaluateExpressionCues([cue], localTime, resolve);
}

// --- Live overlay controller (viewer / debug UI path) -------------------------------

export interface ExpressionOverlayDebug {
  presetId: string | null;
  intensity: number;
  /** Raw fade envelope 0..1 toward the current target. */
  envelope: number;
  fading: boolean;
}

export interface ExpressionOverlayOutput {
  /** Bridge-name weights to max-blend into the frame ({} when fully off). */
  weights: Record<string, number>;
  /** Fixed-gaze hint of the active preset, eased by the fade (k=0 when none). */
  gazeFix: GazeFix;
  /** Wander amplitude multiplier (1 = no damping). */
  gazeWander: number;
  debug: ExpressionOverlayDebug;
}

/**
 * Holds ONE active preset with fade-in/out envelopes (durations from the
 * preset's timing, overridable). Preset switches snapshot the currently
 * displayed weights and crossfade from that snapshot — the idle machine's
 * pop-free recipe. No accumulation: output is a pure function of envelope
 * state, and OFF decays to exactly {} (nothing can linger, because the
 * viewer clears influences every frame anyway).
 */
export class ExpressionOverlayController {
  private preset: ExpressionPreset | null = null;
  private intensity = 1;
  // Crossfade progress 0->1 from the snapshot toward the current target
  // (target = the preset's weights, or {} when off).
  private envelope = 0;
  private duration = 0.5;
  // Internal clock for the flutter wobble (never resets — phase continuity).
  private time = 0;
  // Snapshot of the displayed weights when the preset switched (crossfade source).
  private fromWeights: Record<string, number> = {};
  private fromGazeFix: GazeFix = { yaw: 0, pitch: 0, k: 0 };
  private fromWander = 1;

  /**
   * Activate `presetId` (null = off) at `intensity`. Re-setting the same
   * preset only updates intensity (no re-fade); a different preset crossfades
   * from the current displayed output. Fade duration: incoming preset's
   * timing.fadeIn when turning on, OUTGOING preset's timing.fadeOut when
   * turning off (overridable via opts).
   */
  setPreset(presetId: string | null, intensity = 1, opts?: { fadeIn?: number; fadeOut?: number }): void {
    this.intensity = clamp01(intensity);
    const next = presetId ? (getExpressionPreset(presetId) ?? null) : null;
    if ((next?.id ?? null) === (this.preset?.id ?? null)) return;
    // Freeze what is currently displayed as the fade source.
    const current = this.compute();
    this.fromWeights = current.weights;
    this.fromGazeFix = current.gazeFix;
    this.fromWander = current.gazeWander;
    const outgoingFadeOut = opts?.fadeOut ?? this.preset?.timing?.fadeOut ?? 0.5;
    this.preset = next;
    this.envelope = 0;
    this.duration = Math.max(0.01, next ? (opts?.fadeIn ?? next.timing?.fadeIn ?? 0.5) : outgoingFadeOut);
  }

  /** Live intensity (slider) without re-triggering fades. */
  setIntensity(intensity: number): void {
    this.intensity = clamp01(intensity);
  }

  /** Advance the crossfade by dt seconds and return the current overlay output. */
  update(dt: number): ExpressionOverlayOutput {
    this.time += dt;
    if (this.envelope < 1) {
      this.envelope = Math.min(1, this.envelope + dt / this.duration);
    }
    return this.compute();
  }

  getDebug(): ExpressionOverlayDebug {
    return this.compute().debug;
  }

  // The displayed output: lerp(snapshot, target preset, smoothstep(envelope)).
  // With preset=null the target is {} — the envelope ramps the snapshot out.
  private compute(): ExpressionOverlayOutput {
    const k = smoothstep(this.envelope);
    const effIntensity = this.intensity * flutterValue(this.preset ?? undefined, this.time);
    const toWeights = this.preset ? flattenPresetWeights(this.preset, effIntensity) : {};
    const toGazeFix = presetGazeFix(this.preset, 1);
    const toWander = presetWander(this.preset, 1);
    const weights: Record<string, number> = {};
    for (const name of new Set([...Object.keys(this.fromWeights), ...Object.keys(toWeights)])) {
      const v = (this.fromWeights[name] ?? 0) + ((toWeights[name] ?? 0) - (this.fromWeights[name] ?? 0)) * k;
      if (v > 1e-4) weights[name] = clamp01(v);
    }
    // Gaze: lerp the blend factor; angles lerp only while the target is live
    // (a fading-out fix keeps its last direction and just loses influence).
    const gk = this.fromGazeFix.k + (toGazeFix.k - this.fromGazeFix.k) * k;
    const gazeFix: GazeFix =
      toGazeFix.k > 0
        ? {
            yaw: this.fromGazeFix.k > 0 ? this.fromGazeFix.yaw + (toGazeFix.yaw - this.fromGazeFix.yaw) * k : toGazeFix.yaw,
            pitch: this.fromGazeFix.k > 0 ? this.fromGazeFix.pitch + (toGazeFix.pitch - this.fromGazeFix.pitch) * k : toGazeFix.pitch,
            k: gk,
          }
        : { yaw: this.fromGazeFix.yaw, pitch: this.fromGazeFix.pitch, k: gk };
    const gazeWander = this.fromWander + (toWander - this.fromWander) * k;
    return {
      weights,
      gazeFix,
      gazeWander,
      debug: {
        presetId: this.preset?.id ?? null,
        intensity: this.intensity,
        envelope: this.envelope,
        fading: this.envelope < 1,
      },
    };
  }
}
