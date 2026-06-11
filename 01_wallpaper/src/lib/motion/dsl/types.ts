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

export interface Oscillator {
  bone: HumanoidBoneName;
  axis: 'x' | 'y' | 'z';
  /** Amplitude in radians. */
  amp: number;
  /** Period in seconds. For loop motions, duration % period should be ~0. */
  period: number;
  /** Phase offset in radians. Default 0. */
  phase?: number;
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

export interface LookAtDirective {
  /**
   * cursor: runtime cursor-follow (Lab preview treats as 'camera').
   * camera: look toward the camera. fixed: look at `point` (world meters).
   * off: eyes stay centered.
   */
  mode: 'cursor' | 'camera' | 'fixed' | 'off';
  point?: V3;
  /** 0..1 multiplier (1 = full tracking). Default 1. */
  strength?: number;
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
  /** Loop-safe periodic offsets (breathing etc.), added to track offsets. */
  oscillators?: Oscillator[];
  expressions?: { keys: ExpressionKey[] };
  lookAt?: LookAtDirective;
  /** Reserved for the Motion Director (0.9). Accepted and ignored in 0.7. */
  microEvents?: Record<string, unknown>;
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
