// Motion DSL — schema types (Motion Probe 0.7)
//
// The DSL is the *authoring* format for motions: hand-written JSON under
// `public/motions/dsl/` (motions), `public/poses/` (full-body postures) and
// `public/poses/hands/` (hand shapes). It is designed to be written by an LLM
// agent from a text brief + sketch, so every concept maps to plain numbers and
// names — no binary data, no tool round-trips. See MOTION_AUTHORING_GUIDE.md
// for the authoring workflow and the verified axis/sign conventions.
//
// Compose model (per humanoid bone, all parts optional):
//     finalQ = Q(posture euler) * Q(hand-shape euler) * Q(track offset euler)
// applied to the *normalized* humanoid rig (T-pose = identity), exactly like
// the existing procedural/vrma clip paths. Expressions / lookAt / blink are
// NOT baked into bone data — they are timeline *directives* executed by the
// viewer's Custom Expression Bridge / VRMLookAt (consistent with the 0.3
// decision to strip expression tracks from external clips).

// --- Humanoid bones -----------------------------------------------------------
// VRM 1.0 humanoid bone names (three-vrm normalized rig uses these even for
// VRM 0.x models). Bones absent on a given model (e.g. this model lacks
// upperChest / toes) are skipped at apply time and reported by load().
export const HUMANOID_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftEye', 'rightEye', 'jaw',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export type HumanoidBoneName = (typeof HUMANOID_BONES)[number];

export const HUMANOID_BONE_SET: ReadonlySet<string> = new Set(HUMANOID_BONES);

// Side-less hand bone names used inside *.hand.json (resolved to left/right).
export const HAND_BONES = [
  'thumbMetacarpal', 'thumbProximal', 'thumbDistal',
  'indexProximal', 'indexIntermediate', 'indexDistal',
  'middleProximal', 'middleIntermediate', 'middleDistal',
  'ringProximal', 'ringIntermediate', 'ringDistal',
  'littleProximal', 'littleIntermediate', 'littleDistal',
] as const;

export type HandBoneName = (typeof HAND_BONES)[number];
export const HAND_BONE_SET: ReadonlySet<string> = new Set(HAND_BONES);

// --- Shared primitives --------------------------------------------------------

/** Euler offset in radians, XYZ order, applied on the normalized rig. */
export type E3 = [number, number, number];
export type V3 = [number, number, number];

export const EASING_NAMES = ['linear', 'step', 'sineInOut', 'easeIn', 'easeOut', 'cubicInOut'] as const;
export type EasingName = (typeof EASING_NAMES)[number];

// --- *.pose.json (posture base layer) ------------------------------------------

export interface PoseDef {
  schema: 'pose/1';
  id: string;
  label?: string;
  notes?: string;
  /** Normalized-rig hips position offset from rest, in meters (e.g. sit = lower Y). */
  hipsOffset?: V3;
  /** Absolute local euler offsets from T-pose (radians) per humanoid bone. */
  bones: Partial<Record<HumanoidBoneName, E3>>;
}

// --- *.hand.json (named hand shape) --------------------------------------------

export interface HandDef {
  schema: 'hand/1';
  id: string;
  label?: string;
  notes?: string;
  /**
   * 'both': side-less bone names; the LEFT hand gets [x,y,z] verbatim and the
   * RIGHT hand gets the mirror [x,-y,-z]. 'left'/'right': values apply to that
   * side only, verbatim.
   */
  side: 'left' | 'right' | 'both';
  bones: Partial<Record<HandBoneName, E3>>;
}

// --- *.motion.json --------------------------------------------------------------

export interface TrackKey {
  /** Key time in seconds, 0..duration. */
  t: number;
  /** Euler offset (radians) at this key. */
  e: E3;
  /** Easing INTO this key from the previous key. Default 'sineInOut'. */
  ease?: EasingName;
}

export interface BoneTrack {
  keys: TrackKey[];
}

/** A keyframe for the hips POSITION track (meters, normalized rig). */
export interface HipsKey {
  /** Key time in seconds, 0..duration. */
  t: number;
  /** Hips position offset from rest (meters) at this key. */
  p: V3;
  /** Easing INTO this key from the previous key. Default 'sineInOut'. */
  ease?: EasingName;
}

/**
 * A keyframe for the ROOT MOTION track (INF-7) — moves the whole character
 * (vrm.scene), not a bone. Used so a walk/step actually translates across the
 * room while the leg cycle plays in place. ABSOLUTE world-space offset from the
 * character's start position, sampled at clip time (no per-frame accumulation,
 * so FPS/pause never drifts it).
 */
export interface RootKey {
  /** Key time in seconds, 0..duration. */
  t: number;
  /** World-space position offset from the motion's start, meters [x,y,z]. */
  p: V3;
  /** Extra Y rotation (radians) added to the base facing — turning. Default 0. */
  rotY?: number;
  /** Easing INTO this key from the previous key. Default 'sineInOut'. */
  ease?: EasingName;
}

export interface Oscillator {
  bone: HumanoidBoneName;
  axis: 'x' | 'y' | 'z';
  /** Amplitude in radians. */
  amp: number;
  /**
   * Period in seconds. sine: the exact cycle length — for windowless loop
   * motions, duration % period should be ~0. noise: the feature wavelength;
   * on loop motions the noise lattice is wrapped to the duration so the seam
   * is always clean (the effective wavelength is rounded to duration/N).
   */
  period: number;
  /** Phase offset in radians (sine only; ignored for noise — use seed). Default 0. */
  phase?: number;
  /**
   * 'sine' (default): smooth periodic wave — breathing-class layers.
   * 'noise': deterministic 1D value noise — organic wander / muscle tremor.
   * Same t always yields the same value (stateless, loop-safe).
   */
  kind?: 'sine' | 'noise';
  /**
   * Active time range [start, end] in seconds. Outside it the layer is zero;
   * inside it ramps in/out over attack/release seconds (smoothstep), so a
   * windowed layer never pops — including at the loop seam.
   */
  window?: [number, number];
  /** Envelope fade-in seconds from window start. Default 0.4. */
  attack?: number;
  /** Envelope fade-out seconds before window end. Default = attack. */
  release?: number;
  /** Decorrelates noise channels sharing a bone/axis/period. Default 0. */
  seed?: number;
}

export interface ExpressionKey {
  /** The state below is fully reached at this time. */
  t: number;
  /**
   * Full target state at time t: expression name -> weight 0..1. Names known
   * to the model: a/i/u/e/o, blink, blinkleft, blinkright, joy, angry, sorrow,
   * fun, plus 'neutral' (= all zero). Names omitted fade to 0.
   */
  set: Record<string, number>;
  /** Seconds spent fading from the previous state, ending at t. Default 0.5. */
  fade?: number;
}

/**
 * Preset-based expression cue (0.2 — the RECOMMENDED way to author faces).
 * References an Expression Preset by id; envelope defaults come from the
 * preset's timing, so `{ "preset": "smile", "at": 8.0 }` is a full cue.
 * Cues max-blend with each other and with the raw `expressions` track.
 */
export interface ExpressionCueDef {
  /** Expression Preset id (see docs/EXPRESSION_LIST_FOR_MOTION_IDEAS.md). */
  preset: string;
  /** Clip-local start time in seconds. */
  at: number;
  /** Peak intensity 0..1 (default 1). */
  intensity?: number;
  /** Seconds to fade in from `at` (default: preset timing). */
  fadeIn?: number;
  /** Seconds held at peak. -1 = hold until the end of the motion. (default: preset timing). */
  hold?: number;
  /** Seconds to fade back out (default: preset timing). */
  fadeOut?: number;
  /** Overlap tie-break for the gaze hint (default: preset priority). */
  priority?: number;
}

/**
 * Gaze key (0.2): at time `t` the eyes START moving to `to`, arriving after
 * `move` seconds (default 0.25 — a quick natural saccade), then HOLD that
 * direction until the next key. `to` is a named direction (front/up/down/
 * left/right/up_left/up_right/down_left/down_right/away_left/away_right/
 * camera — screen-relative, see gazeController.GAZE_DIRECTIONS) or a raw
 * [yawDeg, pitchDeg] pair in DEGREES (yaw+ = 画面右, pitch+ = 上).
 * Before the first key the idle gaze-wander runs.
 */
export interface GazeKey {
  t: number;
  to: string | [number, number];
  move?: number;
}

/**
 * Legacy lookAt directive (0.7). Superseded by `gaze` in 0.2 — still accepted
 * and mapped: camera→gaze 'camera', fixed→direction of `point`, off→front,
 * cursor→(wander; cursor follow no longer exists). Prefer `gaze` for new work.
 */
export interface LookAtDirective {
  mode: 'cursor' | 'camera' | 'fixed' | 'off';
  point?: V3;
  /** 0..1 multiplier (1 = full strength). Default 1. */
  strength?: number;
}

/**
 * A bone-local grip transform for a held prop (INF-4). Mirrors
 * scene/propAttach.GripOffset and propLibrary.PropGrip — duplicated here so the
 * DSL stays self-contained (no scene import). position in meters, rotation in
 * euler XYZ radians, optional uniform local scale.
 */
export interface MicroGrip {
  position: V3;
  rotation: V3;
  scale?: number;
}

/**
 * A timed prop event executed by the runtime at clip-local time (Motion
 * Director, INF-4/INF-6). `attach` parents the prop onto a hand/head bone with
 * the grip offset; `detach` returns it to its desk rest. The host maps `prop`
 * (a Director PropId such as "cup") to its scene container ("item:<prop>"). When
 * `grip` is omitted, the host falls back to the prop library's attach offset for
 * the chosen bone. Used to synchronise cup pickup/placement with the sip motion.
 */
export interface MicroEvent {
  /** Clip-local time in seconds (0..duration) to fire. */
  t: number;
  action: 'attach' | 'detach';
  /** Director PropId (cup/phone/…). Resolved to scene container "item:<prop>". */
  prop: string;
  /** Target humanoid bone for attach (default "rightHand"). Ignored for detach. */
  bone?: 'rightHand' | 'leftHand' | 'head';
  /** Grip offset (attach only). Omit to use the prop library's attach offset. */
  grip?: MicroGrip;
}

export interface MotionDef {
  schema: 'motion/1';
  id: string;
  label?: string;
  notes?: string;
  /** Free-form scheduler metadata (used by the Motion Director, 0.9). */
  category?: string;
  tags?: string[];
  /** Posture id -> /poses/<id>.pose.json. Omit for "rest pose" (standing, arms dropped). */
  posture?: string;
  duration: number;
  loop: boolean;
  fadeIn?: number;
  fadeOut?: number;
  /** Hand-shape ids -> /poses/hands/<id>.hand.json. */
  hands?: { left?: string; right?: string };
  /** Keyframed euler-offset tracks per humanoid bone (on top of posture/hands). */
  tracks?: Partial<Record<HumanoidBoneName, BoneTrack>>;
  /**
   * Animated hips POSITION track (meters, normalized rig). ABSOLUTE — when
   * present it OVERRIDES the posture's constant hipsOffset for the whole motion
   * (sample at t). For stand/sit/step transitions where the hips must translate
   * over time (INF-3); the runtime applies it to hips.position scaled by clip
   * weight, never baked into the rotation tracks.
   */
  hipsTrack?: { keys: HipsKey[] };
  /**
   * Root-motion track (INF-7): animates the whole character's world position /
   * facing over the motion (vrm.scene), ABSOLUTE from the start. Used by walk /
   * step / turn so the body actually advances while the leg cycle plays. The
   * runtime samples it at clip time and applies it to vrm.scene scaled by clip
   * weight, on top of the layout base. A looping walk keeps net zero (in place);
   * the across-room advance is driven separately by the Director. Omit = none.
   */
  rootMotion?: { keys: RootKey[] };
  /** Loop-safe periodic offsets (breathing etc.), added to track offsets. */
  oscillators?: Oscillator[];
  /** Raw full-state expression keys (advanced; for vowels / single morphs). */
  expressions?: { keys: ExpressionKey[] };
  /** Preset-based expression cues (0.2 — recommended). Max-blends with `expressions`. */
  exprCues?: ExpressionCueDef[];
  /** Eye-direction keys (0.2). Wins over exprCues' preset gaze hints. */
  gaze?: { keys: GazeKey[] };
  /** Legacy (0.7) — prefer `gaze`. Ignored when `gaze` is present. */
  lookAt?: LookAtDirective;
  /**
   * Timed prop attach/detach events executed by the runtime at clip-local time
   * (Motion Director). Used to pick up / place the cup in sync with the sip
   * motion (INF-4). Empty/omitted = none.
   */
  microEvents?: MicroEvent[];
}

// --- Resolved document (motion + referenced assets), produced by the loader ----

export interface MotionDoc {
  motion: MotionDef;
  posture: PoseDef | null;
  leftHand: HandDef | null;
  rightHand: HandDef | null;
}

// --- Validation result ----------------------------------------------------------

export interface ValidationIssue {
  /** JSON-path-ish location, e.g. `tracks.head.keys[2].e`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
