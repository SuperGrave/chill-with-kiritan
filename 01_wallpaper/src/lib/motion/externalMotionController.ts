// External Motion Controller (Motion Probe 0.3)
//
// A framework-agnostic controller for the *external clip* layer that sits on top
// of the 0.2 procedural idle. It owns only intent + a crossfade envelope; it
// knows nothing about THREE.js, AnimationMixer or VRM. VrmViewer reads the
// emitted weight each frame and applies it to a real AnimationAction / blend.
//
// Design goals (carried over from the 0.2 idle state machine):
//   * No accumulation across frames. The blend envelope is advanced by dt toward
//     a discrete target (0 = procedural idle, 1 = external clip), so the output
//     is a pure function of elapsed transition time — pop-free and drift-free.
//   * Deterministic + THREE-agnostic so it can be unit-tested in Node (the
//     preview tab is backgrounded, so motion/time logic is verified in Node, not
//     by screenshot — see docs).
//
// The effective applied weight is:
//     weight = enabled ? smoothstep(blend) * clipWeight : 0
// where `blend` is the crossfade envelope and `clipWeight` is the user-set
// ceiling (Clip Weight slider). VrmViewer slerps each clip-driven bone from the
// procedural-idle base toward the clip pose by `weight`, then rides the idle
// breath/sway additively on top (compose order "A" — see REPORT).

export type ExternalClipSource = 'none' | 'builtin' | 'vrma' | 'dsl';

// Discrete user commands the controller can apply. Clip-source switches
// ('loadVrma' / 'useBuiltin') are handled by the viewer (they rebuild the
// AnimationAction), not here.
export type ExternalMotionAction =
  | 'toggleEnabled'
  | 'togglePlay'
  | 'toggleLoop'
  | 'crossfadeToClip'
  | 'returnToIdle';

export interface ExternalMotionDebug {
  enabled: boolean; // master switch (key 9)
  playing: boolean; // Play/Stop intent (drives the AnimationAction)
  loop: boolean; // Loop ON/OFF
  clipLoaded: boolean;
  clipName: string;
  clipSource: ExternalClipSource;
  hasExpressionTracks: boolean; // external clip carried expression tracks (ignored, see REPORT)
  clipWeight: number; // user ceiling 0..1 (Clip Weight slider)
  blend: number; // raw crossfade envelope 0..1 (0 = idle, 1 = clip)
  weight: number; // effective applied weight 0..1
  crossfading: boolean; // blend has not yet reached its target
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}

export class ExternalMotionController {
  private enabled = false;
  private playing = false;
  private loop = true;
  private clipWeight = 1.0;

  private blend = 0; // raw envelope
  private blendTarget = 0; // 0 idle / 1 clip
  // Directional sweep durations. A motion can declare its own (DSL fadeIn /
  // fadeOut); the viewer applies them when the clip is swapped in.
  private fadeInDuration = 0.6;
  private fadeOutDuration = 0.6;

  private clipLoaded = false;
  private clipName = '';
  private clipSource: ExternalClipSource = 'none';
  private hasExpressionTracks = false;

  // One-shot pulse the viewer consumes to restart the AnimationAction at t=0.
  private restartPending = false;

  constructor(crossfadeDuration = 0.6) {
    this.fadeInDuration = crossfadeDuration;
    this.fadeOutDuration = crossfadeDuration;
  }

  // --- Clip metadata (set by the viewer once a clip is built/loaded) ---------
  setClipInfo(info: {
    loaded: boolean;
    name: string;
    source: ExternalClipSource;
    hasExpressionTracks: boolean;
  }): void {
    this.clipLoaded = info.loaded;
    this.clipName = info.name;
    this.clipSource = info.source;
    this.hasExpressionTracks = info.hasExpressionTracks;
    if (!info.loaded) {
      // Lost the clip: collapse back to idle.
      this.playing = false;
      this.blendTarget = 0;
    }
  }

  setCrossfadeDuration(seconds: number): void {
    const s = Math.max(0.01, seconds);
    this.fadeInDuration = s;
    this.fadeOutDuration = s;
  }

  /** Per-motion sweep durations (DSL fadeIn/fadeOut). Undefined keeps 0.6. */
  setFadeDurations(fadeIn?: number, fadeOut?: number): void {
    this.fadeInDuration = Math.max(0.01, fadeIn ?? 0.6);
    this.fadeOutDuration = Math.max(0.01, fadeOut ?? 0.6);
  }

  // --- User intents ----------------------------------------------------------

  /** External Motion ON/OFF (key 9). Turning OFF hard-returns to procedural idle. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.playing = false;
      this.blendTarget = 0;
    }
  }

  toggleEnabled(): void {
    this.setEnabled(!this.enabled);
  }

  /** Play from the start of the clip and crossfade in. Arms External Motion. */
  play(): void {
    if (!this.clipLoaded) return;
    this.enabled = true;
    this.playing = true;
    this.restartPending = true;
    this.blendTarget = 1;
  }

  /** Stop playback and crossfade back out to idle. */
  stop(): void {
    this.playing = false;
    this.blendTarget = 0;
  }

  togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  setLoop(on: boolean): void {
    this.loop = on;
  }

  toggleLoop(): void {
    this.loop = !this.loop;
  }

  setClipWeight(w: number): void {
    this.clipWeight = clamp01(w);
  }

  /** Crossfade toward the clip without restarting it (continues from current time). */
  crossfadeToClip(): void {
    if (!this.clipLoaded) return;
    this.enabled = true;
    this.playing = true;
    this.blendTarget = 1;
  }

  /** Return to procedural idle (key 0): crossfade the clip out, keep it armed. */
  returnToIdle(): void {
    this.playing = false;
    this.blendTarget = 0;
  }

  /**
   * The AnimationAction reached the end of a oneshot (mixer 'finished' event):
   * fade back to idle. Without this the controller kept reporting playing=true
   * and the envelope sat at 1 forever, so the next replay swapped clips at full
   * weight — the pose teleported and the spring bones (hair/sleeves) flailed.
   */
  notifyFinished(): void {
    this.playing = false;
    this.blendTarget = 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Dispatch a discrete UI command. */
  apply(action: ExternalMotionAction): void {
    switch (action) {
      case 'toggleEnabled':
        this.toggleEnabled();
        break;
      case 'togglePlay':
        this.togglePlay();
        break;
      case 'toggleLoop':
        this.toggleLoop();
        break;
      case 'crossfadeToClip':
        this.crossfadeToClip();
        break;
      case 'returnToIdle':
        this.returnToIdle();
        break;
    }
  }

  // --- Frame update ----------------------------------------------------------

  /** Advance the crossfade envelope by dt and return the current debug/output. */
  update(dt: number): ExternalMotionDebug {
    // If we have nothing to show, force the envelope toward idle.
    const target = this.enabled && this.clipLoaded ? this.blendTarget : 0;

    if (this.blend !== target) {
      if (this.blend < target) this.blend = Math.min(target, this.blend + dt / this.fadeInDuration);
      else this.blend = Math.max(target, this.blend - dt / this.fadeOutDuration);
    }

    return this.getDebug();
  }

  getDebug(): ExternalMotionDebug {
    const weight = this.enabled && this.clipLoaded ? smoothstep(this.blend) * this.clipWeight : 0;
    return {
      enabled: this.enabled,
      playing: this.playing,
      loop: this.loop,
      clipLoaded: this.clipLoaded,
      clipName: this.clipName,
      clipSource: this.clipSource,
      hasExpressionTracks: this.hasExpressionTracks,
      clipWeight: this.clipWeight,
      blend: this.blend,
      weight,
      crossfading: Math.abs(this.blend - (this.enabled && this.clipLoaded ? this.blendTarget : 0)) > 1e-4,
    };
  }

  /** True exactly once after play(); the viewer uses it to action.reset(). */
  consumeRestart(): boolean {
    if (this.restartPending) {
      this.restartPending = false;
      return true;
    }
    return false;
  }

  /** Whether the viewer should be ticking the AnimationMixer at all. */
  isActive(): boolean {
    return this.enabled && this.clipLoaded && (this.playing || this.blend > 1e-4);
  }
}
