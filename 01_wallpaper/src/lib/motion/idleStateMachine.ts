// Idle Motion State Machine (Motion Probe 0.2)
//
// A framework-agnostic, procedural idle-motion state machine. It owns the
// "mood" of the character while idling: small body sway, a subtle expression
// overlay, how strongly the eyes track the cursor, and an optional half-lid.
//
// Design goals (carried over from Motion Probe 0.1):
//   * NEVER accumulate onto the previous frame's rotation. Every state is
//     evaluated as a pure function of absolute time, producing *offset* eulers
//     relative to the cached initial pose. The viewer then does
//     `node.quaternion = initQ * offsetQ` each frame, so there is zero drift
//     even over a multi-hour soak.
//   * Crossfades are snapshot-based: when a transition starts we freeze the
//     current blended output into `fromPose` and lerp from that frozen snapshot
//     toward the live target state. This is pop-free even if a new transition
//     is requested mid-fade (we just re-snapshot the current output).
//
// The machine knows nothing about THREE.js or VRM — it only emits plain
// numbers. VrmViewer converts the offsets to quaternions and the expression
// names to morph-target influences via the 0.1 Custom Expression Bridge.
//
// Expression overlays are resolved from the Expression Preset table (0.1) at
// module init, so idle states, the debug UI and future motion cues share ONE
// source of facial truth. The crossfade machinery below is unchanged — it
// lerps whatever weight maps the states emit.

import { presetExprOverlay, getExpressionPreset, flutterValue } from '../expression/expressionPresets';

// Resolved once (plain weight maps). The machine never mutates pose.expr and
// clonePose/lerpPose copy on write, so sharing these objects is safe.
const EXPR_NEUTRAL_SOFT = presetExprOverlay('neutral_soft');
const EXPR_FOCUSED_MONITOR = presetExprOverlay('focused_monitor');
const EXPR_SMILE = presetExprOverlay('smile'); // 旧 glance_smile（0.2で改名）
const EXPR_SLEEPY = presetExprOverlay('sleepy');
const EXPR_SMALL_SMILE = presetExprOverlay('small_smile');
// Sleepy half-lid ceiling + its flutter (sine 0.5..1.0 of the ceiling) come
// from the preset table, so the idle state and motion cues stay in sync.
const SLEEPY_PRESET = getExpressionPreset('sleepy');
const SLEEPY_LID_BASE = SLEEPY_PRESET?.eyelid?.halfLid ?? 0.33;

export type IdleState =
  | 'idle_breath'
  | 'idle_look_monitor'
  | 'idle_glance_user'
  | 'idle_sleepy'
  | 'idle_small_smile';

export const IDLE_STATES: IdleState[] = [
  'idle_breath',
  'idle_look_monitor',
  'idle_glance_user',
  'idle_sleepy',
  'idle_small_smile',
];

export const IDLE_STATE_LABELS: Record<IdleState, string> = {
  idle_breath: 'Breath',
  idle_look_monitor: 'Monitor',
  idle_glance_user: 'Glance',
  idle_sleepy: 'Sleepy',
  idle_small_smile: 'Smile',
};

// Bones the idle layer is allowed to touch. These match the cached bones in
// VrmViewer (upperChest and arms are intentionally excluded — arms keep the
// one-time T-pose drop applied at load).
export type IdleBoneName =
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder';

const IDLE_BONE_NAMES: IdleBoneName[] = [
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
];

export interface BoneEuler {
  x: number;
  y: number;
  z: number;
}

export type IdleBones = Record<IdleBoneName, BoneEuler>;

export interface IdlePose {
  // Per-bone offset eulers (radians), relative to the cached initial pose.
  bones: IdleBones;
  // Expression overlay: expression name (must exist in the model's expression
  // map, e.g. 'fun' / 'sorrow') -> weight 0..1. Max-blended over the user's
  // manual expression by the viewer.
  expr: Partial<Record<string, number>>;
  // 0..1 multiplier on the gaze-wander amplitude (0.2: cursor follow is gone;
  // this damps the random look-around — lower = eyes stay near center).
  lookAtStrength: number;
  // Fixed gaze of this state (degrees on the gaze panel; k = blend 0..1,
  // k 0 = pure wander). E.g. glance→front/camera, monitor→screen-down-right.
  gaze: { yaw: number; pitch: number; k: number };
  // 0..1 extra eye-close, max-blended with auto-blink (half-lid for sleepy).
  extraBlink: number;
}

interface StateConfig {
  // Recommended crossfade-in duration when transitioning INTO this state (s).
  crossfade: number;
  // Seconds to dwell once settled before auto-idle picks a new state. For a
  // oneshot state this is how long it holds before auto-returning to breath.
  autoDwell: number;
  // Oneshot states auto-return to idle_breath after autoDwell regardless of
  // whether auto-idle is enabled (e.g. a quick glance at the user).
  oneshot?: boolean;
  // Pure evaluator: absolute time (s) -> pose. No internal state, no drift.
  evaluate: (t: number) => IdlePose;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroBones(): IdleBones {
  return {
    spine: { x: 0, y: 0, z: 0 },
    chest: { x: 0, y: 0, z: 0 },
    neck: { x: 0, y: 0, z: 0 },
    head: { x: 0, y: 0, z: 0 },
    leftShoulder: { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 },
  };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}

function clonePose(p: IdlePose): IdlePose {
  const bones = zeroBones();
  for (const n of IDLE_BONE_NAMES) {
    bones[n] = { x: p.bones[n].x, y: p.bones[n].y, z: p.bones[n].z };
  }
  return {
    bones,
    expr: { ...p.expr },
    lookAtStrength: p.lookAtStrength,
    gaze: { ...p.gaze },
    extraBlink: p.extraBlink,
  };
}

function lerpPose(a: IdlePose, b: IdlePose, k: number): IdlePose {
  const bones = zeroBones();
  for (const n of IDLE_BONE_NAMES) {
    bones[n] = {
      x: lerp(a.bones[n].x, b.bones[n].x, k),
      y: lerp(a.bones[n].y, b.bones[n].y, k),
      z: lerp(a.bones[n].z, b.bones[n].z, k),
    };
  }
  const expr: Record<string, number> = {};
  for (const name of new Set([...Object.keys(a.expr), ...Object.keys(b.expr)])) {
    expr[name] = lerp(a.expr[name] ?? 0, b.expr[name] ?? 0, k);
  }
  // Gaze angles only matter while k > 0 on either side; lerping the raw
  // components is fine because a k=0 side carries yaw/pitch 0 (center).
  return {
    bones,
    expr,
    lookAtStrength: lerp(a.lookAtStrength, b.lookAtStrength, k),
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, k),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, k),
      k: lerp(a.gaze.k, b.gaze.k, k),
    },
    extraBlink: lerp(a.extraBlink, b.extraBlink, k),
  };
}

const GAZE_WANDER = { yaw: 0, pitch: 0, k: 0 };

// ---------------------------------------------------------------------------
// State evaluators
// ---------------------------------------------------------------------------
//
// All states share a slow breathing oscillator so the baseline body motion is
// continuous across crossfades. Amplitudes are intentionally tiny (radians):
// this is a calm, wallpaper-friendly idle, not a performance.

const STATES: Record<IdleState, StateConfig> = {
  // Baseline calm breathing — this is the exact 0.1 idle, refactored.
  idle_breath: {
    crossfade: 1.0,
    autoDwell: 8.0,
    evaluate: (t) => {
      const breath = Math.sin(t * Math.PI * 0.5) * 0.05;
      const sway = Math.sin(t * Math.PI * 0.2) * 0.02;
      const bones = zeroBones();
      bones.chest.x = breath;
      bones.spine.x = breath * 0.5;
      bones.neck.x = -breath * 0.5;
      bones.neck.y = sway;
      bones.head.x = -breath * 0.5;
      bones.head.y = sway * 1.5;
      bones.head.z = sway;
      bones.leftShoulder.z = -breath * 0.3;
      bones.rightShoulder.z = breath * 0.3;
      return { bones, expr: EXPR_NEUTRAL_SOFT, lookAtStrength: 1.0, gaze: GAZE_WANDER, extraBlink: 0 };
    },
  },

  // Calmly turns the head toward the "monitor" side and slowly searches it.
  // LookAt is weakened so the procedural head turn isn't fought by the eyes.
  // NOTE: the yaw sign here is cosmetic (there is no monitor object in the
  // probe); flip the sign of `yaw` if the head should turn the other way.
  idle_look_monitor: {
    crossfade: 1.0,
    autoDwell: 7.0,
    evaluate: (t) => {
      const breath = Math.sin(t * Math.PI * 0.5) * 0.04;
      const drift = Math.sin(t * Math.PI * 0.15) * 0.03;
      const yaw = 0.12 + drift; // hold turned to the side, slowly drifting
      const bones = zeroBones();
      bones.chest.x = breath;
      bones.spine.x = breath * 0.5;
      bones.neck.x = -breath * 0.4;
      bones.neck.y = yaw * 0.5;
      bones.head.x = 0.04 - breath * 0.4; // slight look-down at a screen
      bones.head.y = yaw;
      bones.head.z = drift * 0.4;
      bones.leftShoulder.z = -breath * 0.25;
      bones.rightShoulder.z = breath * 0.25;
      // focused_monitor preset: serious brow + slight squint. Eyes hold the
      // head-turn direction (画面右やや下 = モニタ) instead of wandering.
      return {
        bones,
        expr: EXPR_FOCUSED_MONITOR,
        lookAtStrength: 0.35,
        gaze: { yaw: 9, pitch: -7, k: 0.8 },
        extraBlink: 0,
      };
    },
  },

  // Short, cute glance toward the user/camera with a slight head tilt and a
  // touch of "fun". Oneshot: auto-returns to idle_breath after a couple of
  // seconds (see config below).
  idle_glance_user: {
    crossfade: 0.6,
    autoDwell: 2.5,
    oneshot: true,
    evaluate: (t) => {
      const breath = Math.sin(t * Math.PI * 0.5) * 0.04;
      const bones = zeroBones();
      bones.chest.x = breath;
      bones.spine.x = breath * 0.5;
      bones.neck.x = -breath * 0.4;
      bones.neck.y = -0.04; // turn back toward the user
      bones.head.x = -0.03; // small chin-up
      bones.head.y = -0.06;
      bones.head.z = 0.05; // cute tilt
      bones.leftShoulder.z = -breath * 0.25;
      bones.rightShoulder.z = breath * 0.25;
      // Glance: the eyes commit to the viewer (front/camera) for the oneshot.
      return { bones, expr: EXPR_SMILE, lookAtStrength: 1.0, gaze: { yaw: 0, pitch: 0, k: 1 }, extraBlink: 0 };
    },
  },

  // Drowsy: head droops with a slow nod, half-lidded eyes, a hint of sorrow.
  // LookAt is heavily weakened (barely tracks). Not spooky — kept gentle.
  idle_sleepy: {
    crossfade: 1.2,
    autoDwell: 9.0,
    evaluate: (t) => {
      const breath = Math.sin(t * Math.PI * 0.4) * 0.05; // slower, deeper
      const nod = (Math.sin(t * Math.PI * 0.25) * 0.5 + 0.5) * 0.06; // 0..0.06
      // Half-lid = preset ceiling × the preset's own flutter (sine 0.5..1.0),
      // so the idle lid drifts ~0.17..0.33 exactly like a motion-cued sleepy.
      const lid = SLEEPY_LID_BASE * flutterValue(SLEEPY_PRESET, t);
      const bones = zeroBones();
      bones.chest.x = breath;
      bones.spine.x = breath * 0.5;
      bones.neck.x = 0.06 + nod * 0.5; // chin down
      bones.head.x = 0.1 + nod; // head droops
      bones.head.z = Math.sin(t * Math.PI * 0.1) * 0.02; // gentle sway
      bones.leftShoulder.z = 0.03; // shoulders relax/drop slightly
      bones.rightShoulder.z = -0.03;
      // sleepy preset: soft troubled brow (こまり眉) instead of the old sorrow
      // composite — sorrow's はぅ eyes fought the half-lid. Gaze drifts low.
      return {
        bones,
        expr: EXPR_SLEEPY,
        lookAtStrength: 0.2,
        gaze: { yaw: 0, pitch: -8, k: 0.5 },
        extraBlink: lid,
      };
    },
  },

  // A small, content smile. Minimal body movement so it stays unobtrusive as
  // wallpaper; expression carries it.
  idle_small_smile: {
    crossfade: 0.9,
    autoDwell: 7.0,
    evaluate: (t) => {
      const breath = Math.sin(t * Math.PI * 0.5) * 0.03; // smaller than breath
      const sway = Math.sin(t * Math.PI * 0.18) * 0.02;
      const bones = zeroBones();
      bones.chest.x = breath;
      bones.spine.x = breath * 0.4;
      bones.neck.x = -breath * 0.4;
      bones.neck.y = sway * 0.75;
      bones.head.x = -breath * 0.3 - 0.01;
      bones.head.y = sway;
      bones.head.z = 0.025; // slight happy tilt
      bones.leftShoulder.z = -breath * 0.2;
      bones.rightShoulder.z = breath * 0.2;
      return { bones, expr: EXPR_SMALL_SMILE, lookAtStrength: 1.0, gaze: GAZE_WANDER, extraBlink: 0 };
    },
  },
};

export interface IdleDebug {
  current: IdleState; // the state we are settling on / settled at
  from: IdleState; // the state we are fading away from
  progress: number; // 0..1 raw crossfade progress
  blendWeight: number; // smoothstep(progress) — actual blend applied
  duration: number; // current crossfade duration (s)
  dwell: number; // seconds spent settled in the current state
  autoIdle: boolean;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export class IdleStateMachine {
  private currentState: IdleState = 'idle_breath';
  private fromState: IdleState = 'idle_breath';
  private fromPose: IdlePose;
  private lastOutput: IdlePose;
  private progress = 1; // start fully settled in idle_breath
  private duration = STATES.idle_breath.crossfade;
  private time = 0;
  private dwellTimer = 0;
  private autoIdle = false;

  constructor(initial: IdleState = 'idle_breath') {
    this.currentState = initial;
    this.fromState = initial;
    this.duration = STATES[initial].crossfade;
    this.lastOutput = STATES[initial].evaluate(0);
    this.fromPose = clonePose(this.lastOutput);
  }

  /**
   * Advance the machine by dt seconds and return the blended idle pose.
   * Safe to call every rendered frame; crossfades and auto-idle advance here.
   */
  update(dt: number): IdlePose {
    this.time += dt;

    // Advance any in-flight crossfade.
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / this.duration);
    }

    // Scheduling only happens once we've fully settled into a state.
    if (this.progress >= 1) {
      this.dwellTimer += dt;
      const cfg = STATES[this.currentState];
      if (cfg.oneshot) {
        // A oneshot always falls back to breathing once its hold elapses.
        if (this.dwellTimer >= cfg.autoDwell && this.currentState !== 'idle_breath') {
          this.transitionTo('idle_breath');
        }
      } else if (this.autoIdle && this.dwellTimer >= cfg.autoDwell) {
        this.transitionTo(this.pickRandomNext());
      }
    }

    const toPose = STATES[this.currentState].evaluate(this.time);
    const out = lerpPose(this.fromPose, toPose, smoothstep(this.progress));
    this.lastOutput = out;
    return out;
  }

  /** Request a transition to `state`. No-op (re-arms dwell) if already settled there. */
  requestState(state: IdleState): void {
    if (state === this.currentState && this.progress >= 1) {
      this.dwellTimer = 0;
      return;
    }
    this.transitionTo(state);
  }

  setAutoIdle(on: boolean): void {
    if (on && !this.autoIdle) this.dwellTimer = 0; // give the current state a full dwell
    this.autoIdle = on;
  }

  getDebug(): IdleDebug {
    return {
      current: this.currentState,
      from: this.fromState,
      progress: this.progress,
      blendWeight: smoothstep(this.progress),
      duration: this.duration,
      dwell: this.dwellTimer,
      autoIdle: this.autoIdle,
    };
  }

  // Snapshot the current displayed pose and start fading toward `state`. Using
  // the live blended output as the fade source keeps transitions pop-free even
  // when a new request arrives mid-fade.
  private transitionTo(state: IdleState): void {
    this.fromPose = clonePose(this.lastOutput);
    this.fromState = this.currentState;
    this.currentState = state;
    this.duration = STATES[state].crossfade;
    this.progress = 0;
    this.dwellTimer = 0;
  }

  private pickRandomNext(): IdleState {
    const choices = IDLE_STATES.filter((s) => s !== this.currentState);
    return choices[Math.floor(Math.random() * choices.length)];
  }
}
