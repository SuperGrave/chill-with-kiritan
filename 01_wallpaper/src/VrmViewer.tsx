import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { IdleStateMachine } from './lib/motion/idleStateMachine';
import type { IdleState, IdleDebug, IdleBoneName } from './lib/motion/idleStateMachine';
import { ExternalMotionController } from './lib/motion/externalMotionController';
import type { ExternalMotionDebug, ExternalMotionAction } from './lib/motion/externalMotionController';
import { buildProceduralClip } from './lib/motion/proceduralClip';
import { loadVrmaClip } from './lib/motion/vrmaClip';
// Motion selector (0.7 UI): DSL motions are loaded/compiled through the same
// shared loader the Motion Lab uses, then played via the existing clip path.
import { loadMotionDoc } from './lib/motion/dsl/loadMotionDoc';
import { compileDslClip } from './lib/motion/dsl/compileClip';
// Scene / Props (Motion Probe 0.4)
import { loadScenePreset } from './lib/scene/sceneLoader';
import { loadSceneProps, applyPropVisibility } from './lib/scene/propLoader';
import type { SceneLighting, SceneDebug } from './lib/scene/sceneTypes';
import type { Daypart } from './lib/scene/daypart';
// Prop Variants 0.8: per-slot model swaps picked in the panel.
import { applyVariantsToScene, BASIC_VARIANT_ID } from './lib/scene/propVariants';
import type { PropVariantsRegistry, VariantSelection } from './lib/scene/propVariants';
// Prop Library 0.9: small motion-use desk items appended at their rest poses.
import { libraryItemsToSceneProps } from './lib/scene/propLibrary';
import type { PropLibrary, ItemSelection } from './lib/scene/propLibrary';
// Prop Attach (INF-4): parent a held prop (cup) to a hand bone at a clip time and
// return it to its desk rest — driven by a motion's microEvents (Director, Step 2).
import { attachPropToBone, detachPropToHome, findPropContainer } from './lib/scene/propAttach';
import type { GripOffset } from './lib/scene/propAttach';
import type { MicroEvent } from './lib/motion/dsl/types';
import { advanceMicroEvents, makeMicroCursor } from './lib/motion/dsl/microEvents';
import type { MicroEventCursor } from './lib/motion/dsl/microEvents';
// Scene Layout Calibration (Motion Probe 0.6)
import { toTransformEntry } from './lib/scene/layoutCalibration';
import type { LayoutTransforms, CameraEntry, PropTargetId, TransformEntry } from './lib/scene/layoutCalibration';
import { createLayoutGuides } from './lib/scene/layoutGuides';
import type { LayoutGuides } from './lib/scene/layoutGuides';
// Motion Lab (Motion Probe 0.7): DSL authoring loop on window.__motionLab,
// installed only when the page is opened with ?lab=1 (see mount effect).
import { installMotionLab } from './lib/lab/motionLab';
import { installReviewPanel } from './lib/lab/reviewPanel';
// Pose Composer 0.8 (Stage 1): hand-author bones (FK) in a frozen session that
// shares the Lab's handles. Installed alongside the Lab under ?lab=1.
import { installPoseComposer } from './lib/lab/poseComposer/poseComposer';
import type { PoseComposer } from './lib/lab/poseComposer/poseComposer';
import { installPoseComposerPanel } from './lib/lab/poseComposer/poseComposerPanel';
import { DirectorRunner } from './lib/motion/director/directorRunner';
import { KiritanPoster } from './lib/motion/director/kiritanPoster';
import { resolveTransitionChain } from './lib/motion/director/modeTable';
import { PHASE1_MODE_LOOP, contextReturnLoop } from './lib/motion/director/motionContext';
import {
  LEAVE_SEQ, RETURN_SEQ, AWAY_MOTIONS, seqAt, seqDuration, leaveRoot, returnRoot,
} from './lib/motion/director/awayWalk';
import type { ModeId } from './lib/motion/director/types';
import type { MotionLab, ClipSwapRequest } from './lib/lab/motionLab';
// Expression Preset System 0.2: raw-morph derived expressions + the preset
// overlay layer (max-blended between the idle mood overlay and the blink).
import { registerDerivedExpressions, buildMorphNameIndex } from './lib/expression/registerDerivedExpressions';
import { ExpressionOverlayController } from './lib/expression/expressionPresetEvaluator';
import type { ExpressionOverlayDebug } from './lib/expression/expressionPresetEvaluator';
// Gaze (0.2): cursor follow is gone — eyes are driven by a wander pattern,
// idle-state / preset hints and the motion's gaze track, composed per frame.
import { GazeController, gazeDirToPanelPoint, offsetToGazeDir, GAZE_ANCHOR_Y } from './lib/motion/gazeController';
// Motion face channel (0.2): exprCues / expressions / gaze of the playing DSL
// clip, sampled at clip-local time and scaled by the external clip weight.
import { sampleFaceTimeline, gazeStateToFix } from './lib/motion/dsl/evaluate';
import type { MotionFaceTimeline, FaceSample } from './lib/motion/dsl/evaluate';

// Workdesk presets (0.6) are added alongside the original 1/2/3 modes; the
// existing three names keep their exact behavior. 'free' is the orbit / camera-
// calibration mode (where camera nudges apply and the live pose is read back).
export type CameraMode =
  | 'desk wide'
  | 'face close'
  | 'monitor side'
  | 'workdesk_front'
  | 'workdesk_side'
  | 'workdesk_close'
  | 'ideal'
  | 'free';
export type SpringBoneMode = 'normal' | 'lightweight' | 'off';

// External-motion UI commands: the controller-handled ones plus the two
// clip-source switches handled directly by the viewer (they rebuild the action).
export type ExternalRequestAction = ExternalMotionAction | 'loadVrma' | 'useBuiltin';

// Motion selector request (0.7 UI): pick a clip source by kind + ref and
// optionally start playing it immediately. `ref` is a DSL motion id for 'dsl',
// a fetchable URL for 'vrma', and ignored for 'builtin'.
export interface MotionRequest {
  kind: 'builtin' | 'vrma' | 'dsl';
  ref: string;
  label?: string;
  play: boolean;
  seq: number;
}

// Path a user-supplied VRM Animation is loaded from (see public/motions/README).
const VRMA_SAMPLE_PATH = '/motions/sample_idle.vrma';

// Bones the idle layer applies, in the established 0.2 order. Also the set the
// external clip blends *additively under* (idle breath rides on top).
const IDLE_APPLY_BONES: IdleBoneName[] = ['chest', 'spine', 'neck', 'head', 'leftShoulder', 'rightShoulder'];
const IDLE_BONE_SET = new Set<string>(IDLE_APPLY_BONES);

type WorkHandPinPolicy = {
  group: 'keyboard';
  left: boolean;
  right: boolean;
};

// Keyboard-work clips keep the hand origins planted while the torso breathes.
// The sip animation releases the cup hand, but retains the other hand's target
// and rejoins the same pin group when the base typing loop resumes.
const WORK_HAND_PIN_POLICIES: Record<string, WorkHandPinPolicy> = {
  dsl_loop_work_normal: { group: 'keyboard', left: true, right: true },
  dsl_amb_work_neck_roll: { group: 'keyboard', left: true, right: true },
  dsl_amb_work_screen_scan: { group: 'keyboard', left: true, right: true },
  dsl_amb_work_posture_reset: { group: 'keyboard', left: true, right: true },
  dsl_amb_work_sip: { group: 'keyboard', left: false, right: true },
};

const getWorkHandPinPolicy = (clipName: string | undefined): WorkHandPinPolicy | null =>
  clipName ? WORK_HAND_PIN_POLICIES[clipName] ?? null : null;

// Camera presets, extracted to module scope (0.7) so the animate loop and the
// Motion Lab share ONE table. Values are unchanged from 0.1/0.6.
const CAMERA_PRESETS: Record<Exclude<CameraMode, 'free'>, { pos: [number, number, number]; look: [number, number, number] }> = {
  'desk wide': { pos: [0, 0.8, 1.2], look: [0, 0.8, 0] },
  'face close': { pos: [0, 1.35, 0.5], look: [0, 1.35, 0] },
  'monitor side': { pos: [0.4, 0.9, 0.8], look: [0, 1.0, 0] },
  // Master's IDEAL production view (理想形.txt 2026-06-21): 3/4 front-right, laptop sideways
  // so the face/body/hands read; this is the default boot camera.
  ideal: { pos: [1.116, 0.912, 0.845], look: [0, 0.9, 0] },
  // Chill-room front: desk edge in the foreground, body + face behind it.
  workdesk_front: { pos: [0.0, 1.05, 1.5], look: [0.0, 1.0, -0.1] },
  // Angled side: laptop/monitor reads as facing the wallpaper.
  workdesk_side: { pos: [0.95, 1.0, 1.05], look: [0.0, 0.95, -0.2] },
  // Close: face + upper body + hands-on-desk, leaving UI margin.
  workdesk_close: { pos: [0.0, 1.15, 0.95], look: [0.0, 1.05, -0.1] },
};

// Director (INF-5) Phase-1 demo content: which authored motions each mode may
// schedule. Modes absent here have no base loop yet, so the director keeps the
// current clip on a transition into them (graceful until more content lands).
// mode → base-loop motion id. Single source of truth lives in motionContext.ts
// (shared with the Lab's context-loop settle and the Node test harness, issue #1).
const DIRECTOR_LOOPS: Partial<Record<ModeId, string>> = PHASE1_MODE_LOOP;
const DIRECTOR_AMBIENTS: Partial<Record<ModeId, string[]>> = {
  work_normal: ['amb_work_neck_roll', 'amb_work_posture_reset', 'amb_work_screen_scan', 'amb_work_sip'],
  work_sleepy: ['amb_slpy_head_bob', 'amb_slpy_slow_blink', 'amb_slpy_tilt_drift'],
  video_relax: ['amb_vid_chuckle', 'amb_vid_nod_watch', 'amb_vid_eyes_widen'],
  sleep_desk: ['amb_slp_head_shift', 'amb_slp_dream_smile'],
};
// Ambients that need a held prop (gated by availableProps in the scheduler).
const DIRECTOR_PROP_AMBIENTS = new Set<string>(['amb_work_sip']);
// Authored Transition motions (Step 1) the director may insert between mode
// loops (preloaded like loops/ambients; the runner's chain is filtered to the
// ones that actually loaded). Sourced from TRANSITION_TABLE in modeTable.ts.
const DIRECTOR_TRANSITIONS: string[] = [
  'tr_sit_to_slump', // work_sleepy → sleep_desk
  'tr_slump_wake',   // sleep_desk → (sitting)
  'tr_lean_back',    // work → video (recline)
  'tr_lean_forward', // video → work (sit up)
];

function sittingFallbackLoop(posture: string | null | undefined, currentMode: ModeId | null): string | null {
  if (!posture?.startsWith('sit_')) return null;
  return (currentMode ? DIRECTOR_LOOPS[currentMode] : null) ?? DIRECTOR_LOOPS.work_normal ?? null;
}

export interface VrmViewerProps {
  cameraMode: CameraMode;
  lookAtEnabled: boolean;
  springBoneMode: SpringBoneMode;
  fpsLimit: boolean;
  currentExpression: string;
  autoBlink: boolean;
  idleMotion: boolean;
  // Expression Preset System 0.1. The active preset overlay (null = off);
  // intensity is forwarded continuously like the clip-weight slider.
  expressionPresetId: string | null;
  expressionPresetIntensity: number;
  // Idle state machine (Motion Probe 0.2). idleRequest is a {state, seq} nonce
  // so the same state can be re-requested (seq always changes on user action).
  idleRequest: { state: IdleState; seq: number };
  autoIdle: boolean;
  // External Motion (Motion Probe 0.3). clipWeight is forwarded continuously;
  // discrete commands arrive as an {action, seq} nonce (seq changes per action).
  externalClipWeight: number;
  externalRequest: { action: ExternalRequestAction; seq: number };
  // Motion selector (0.7 UI): load a clip by kind/ref and optionally auto-play.
  motionRequest: MotionRequest;
  // Scene / Props (Motion Probe 0.4). The scene is (re)loaded on mount, when
  // sceneId changes, or when sceneReloadSeq bumps. Props/Placeholders toggles
  // only flip visibility (no GLB refetch).
  sceneId: string;
  propsEnabled: boolean;
  placeholdersEnabled: boolean;
  sceneReloadSeq: number;
  // Prop Variants 0.8. App owns the registry (fetched once) + selection
  // (persisted); the viewer applies them to the preset on each scene (re)load.
  // A null registry / 'basic' selections are no-ops (scene.json as-is).
  variantRegistry: PropVariantsRegistry | null;
  variantSelection: VariantSelection;
  // Prop Library 0.9. Small motion-use desk items (cup/phone/…); enabled ones
  // are appended to the scene as rest-posed props on each (re)load. Null library
  // / empty selection adds nothing.
  propLibrary: PropLibrary | null;
  itemSelection: ItemSelection;
  // Prop Layout 1.0. Live placement for the enabled small items, keyed by their
  // `item:<id>` scene-prop id. Seeds each item's initial SceneProp transform and
  // is applied to the item containers every frame (so nudges are immediate). The
  // App persists the user's edits; an absent id means "registry REST pose".
  itemLayout: Record<string, TransformEntry>;
  // Scene Layout Calibration (Motion Probe 0.6). App owns the calibration state
  // and feeds the current transforms back down; the viewer applies them to the
  // live prop containers / character each frame (no-op when null, i.e. before the
  // first scene load seeds them). selectedTarget + guidesEnabled drive the visual
  // guides. Camera nudges arrive as an {dx,dy,dz,dolly,seq} nonce (free mode only).
  layoutTransforms: LayoutTransforms | null;
  selectedTarget: string;
  guidesEnabled: boolean;
  cameraNudge: { dx: number; dy: number; dz: number; dolly: number; seq: number };
  onFpsUpdate: (fps: number) => void;
  onStatusUpdate: (status: string) => void;
  onIdleDebug: (debug: IdleDebug) => void;
  onExternalDebug: (debug: ExternalMotionDebug) => void;
  onExpressionPresetDebug: (debug: ExpressionOverlayDebug) => void;
  onSceneDebug: (debug: SceneDebug) => void;
  // Initial layout (from the loaded scene preset), reported once per scene
  // (re)load so App can seed/reset its calibration state to scene.json values.
  onLayoutInit: (init: { transforms: LayoutTransforms; camera: CameraEntry }) => void;
  // Live camera pose, reported (throttled) so the HUD + JSON export reflect the
  // actual camera — including orbit-dragging and preset lerps, not just nudges.
  onCameraReadback: (cam: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void;
  // Production wallpaper (Stage B, 2026-07-01): auto-start the Motion Director
  // once the VRM finishes loading, instead of requiring ?lab=1's manual
  // __motionLab.director(true). Dev/probe/lab entries leave this false so the
  // Lab keeps full manual control (no competing auto-start).
  autoStartDirector: boolean;
  // Stage D (2026-07-01): which lighting/background variant to show. App
  // derives this from the local clock (see lib/scene/daypart.ts); changing it
  // relights the current scene without a reload.
  daypart: Daypart;
}

const VrmViewer: React.FC<VrmViewerProps> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const lookAtTargetRef = useRef<THREE.Object3D>(new THREE.Object3D());
  // Gaze (0.2): wander pattern + layer composition (replaces cursor follow).
  const gazeCtrlRef = useRef(new GazeController());

  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  // Idle Motion state machine (Motion Probe 0.2). Stable across re-renders.
  const idleMachineRef = useRef(new IdleStateMachine());
  const idleDebugTimerRef = useRef(0);

  // Forward state-change requests / auto-idle toggles into the machine. The
  // machine is the source of truth for the *current* state (auto-idle changes
  // it internally); App displays it back via onIdleDebug.
  useEffect(() => {
    if (props.idleRequest.seq === 0) return; // initial mount: machine already at idle_breath
    idleMachineRef.current.requestState(props.idleRequest.state);
  }, [props.idleRequest]);
  useEffect(() => {
    idleMachineRef.current.setAutoIdle(props.autoIdle);
  }, [props.autoIdle]);

  // Cache for idle motion
  const initialRotationsRef = useRef<Map<string, THREE.Quaternion>>(new Map());

  // --- External Motion (Motion Probe 0.3) ---
  // AnimationMixer drives the external clip; the controller owns intent + the
  // crossfade envelope. The mixer is bound to vrm.scene and writes to the SAME
  // normalized bone nodes the idle layer uses (see proceduralClip / vrmaClip).
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const extControllerRef = useRef(new ExternalMotionController());
  const clipBoneNamesRef = useRef<string[]>([]); // humanoid bone names the clip drives
  const clipBoneSetRef = useRef<Set<string>>(new Set());
  // PURE clip rotations per clip bone (0.7.2). THREE's PropertyMixer skips
  // setValue on a bone whose blended result didn't change since the last
  // apply, so "read node.quaternion after mixer.update" can return OUR
  // composed write from the previous frame instead of clip data — the idle
  // offset then compounds frame over frame (spine/neck bent by whole radians
  // within a second, worst during the constant t=0 lead-in and the clamped
  // hold after a oneshot). Invariant: restore these before mixer.update,
  // re-capture after — reads below always see clip data, never our writes.
  const clipPoseRef = useRef<Map<string, { node: THREE.Object3D; q: THREE.Quaternion }>>(new Map());
  // Face channel of the ACTIVE DSL clip (0.2): exprCues / expressions / gaze,
  // sampled each frame at action.time and scaled by the external weight.
  const clipFaceRef = useRef<MotionFaceTimeline | null>(null);
  // Hips rest position (normalized rig), captured once at load. The active DSL
  // clip's posture hipsOffset is applied to hips.position scaled by ext.weight
  // (Phase 0 試験B) — a seated posture lowers the hips so the legs tuck under
  // the desk; without it the body sits ~0.2 m too high. null = no seated offset.
  const initialHipsPosRef = useRef<THREE.Vector3 | null>(null);
  const clipHipsOffsetRef = useRef<[number, number, number] | null>(null);
  // Animated hips trajectory (INF-3): when set, sampled at clip-local time
  // instead of the constant offset — drives stand/sit/step over the motion.
  const clipHipsCurveRef = useRef<{ times: number[]; values: [number, number, number][] } | null>(null);
  // Root-motion trajectory (INF-7): the active clip's whole-character world
  // offset [x,y,z, rotY], sampled at clip time and applied to vrm.scene scaled by
  // weight. directorRoot is a PERSISTENT base the Director sets (away/return walk
  // advance + off-screen placement) that survives clip swaps; clip + director +
  // layout-base compose into one absolute write each frame (no accumulation).
  const clipRootCurveRef = useRef<{ times: number[]; values: [number, number, number, number][] } | null>(null);
  const directorRootRef = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  // Away orchestrator (Step 4): drives the leave/return locomotion sequence
  // (stand → walk off-screen → hide → walk back → sit) keyed on the Director's
  // away_room entry/exit. Pure timing/root come from awayWalk.ts; this state is
  // the live phase + elapsed. directorRoot + vrm.scene.visible are the outputs.
  const awayRef = useRef<{ active: boolean; stage: 'leave' | 'hidden' | 'return'; elapsed: number; segIndex: number; returnTo: ModeId }>(
    { active: false, stage: 'leave', elapsed: 0, segIndex: -1, returnTo: 'work_normal' },
  );
  // Last Director mode the host saw (null until first tick) — to detect away
  // entry/exit edges. Off-screen target / facing are tunable constants.
  const prevDirModeRef = useRef<ModeId | null>(null);
  const AWAY_PARAMS = { off: [-2.5, 0] as [number, number], chair: [0, 0] as [number, number], faceY: Math.PI / 2 };
  // Director (INF-5): the runtime runner + a cache of swap-ready clips by motion id.
  const directorRef = useRef<DirectorRunner | null>(null);
  const directorClipsRef = useRef<Map<string, ClipSwapRequest>>(new Map());
  // Prop microEvents (INF-4) of the ACTIVE DSL clip: timed attach/detach fired at
  // action.time. `fired` tracks which indices already ran (reset on swap / loop
  // wrap); `attached` tracks props this clip parented so an interrupted clip can
  // return them to rest on swap (no cup left floating in mid-air).
  const clipMicroEventsRef = useRef<MicroEvent[] | null>(null);
  const microCursorRef = useRef<MicroEventCursor>(makeMicroCursor());
  const attachedByClipRef = useRef<Set<string>>(new Set());

  // Capture a bone's rest/drop quaternion if not already cached (for .vrma clips
  // that touch bones outside the idle set, e.g. arms — so they can return home).
  const ensureCached = (boneName: string) => {
    const cache = initialRotationsRef.current;
    if (cache.has(boneName)) return;
    const node = vrmRef.current?.humanoid?.getNormalizedBoneNode(boneName as never);
    if (node) cache.set(boneName, node.quaternion.clone());
  };

  // Make `clip` the active external clip: rebuild the AnimationAction, arm it
  // (paused until activated), record its bone set, and inform the controller.
  const switchClip = (
    clip: THREE.AnimationClip,
    boneNames: string[],
    source: 'builtin' | 'vrma' | 'dsl',
    hasExpressionTracks: boolean,
  ) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    if (actionRef.current) {
      actionRef.current.stop();
      mixer.uncacheAction(actionRef.current.getClip());
    }
    // Reset the outgoing clip's bones to their cached rest, so any bone the new
    // clip no longer drives (e.g. a previous .vrma's arms) doesn't stay posed.
    const vrm = vrmRef.current;
    if (vrm?.humanoid) {
      for (const b of clipBoneNamesRef.current) {
        const initQ = initialRotationsRef.current.get(b);
        const node = vrm.humanoid.getNormalizedBoneNode(b as never);
        if (initQ && node) node.quaternion.copy(initQ);
      }
    }
    for (const b of boneNames) ensureCached(b);
    const action = mixer.clipAction(clip);
    action.play(); // enabled; actual advance is gated by isActive() each frame
    action.paused = true;
    actionRef.current = action;
    clipBoneNamesRef.current = boneNames;
    clipBoneSetRef.current = new Set(boneNames);
    // Seed the pure-clip cache at rest; the first mixer.update overwrites it.
    const poseCache = new Map<string, { node: THREE.Object3D; q: THREE.Quaternion }>();
    if (vrm?.humanoid) {
      for (const b of boneNames) {
        const node = vrm.humanoid.getNormalizedBoneNode(b as never);
        if (!node) continue;
        const initQ = initialRotationsRef.current.get(b);
        poseCache.set(b, { node, q: initQ ? initQ.clone() : node.quaternion.clone() });
      }
    }
    clipPoseRef.current = poseCache;
    extControllerRef.current.setClipInfo({ loaded: true, name: clip.name, source, hasExpressionTracks });
  };

  // Clip-swap queue (0.7.2 replay-glitch fix). switchClip() hard-resets the
  // outgoing bones, which is only invisible while the external weight is 0 —
  // swapping mid-blend teleported the pose and sent the spring bones (hair /
  // sleeves) flailing. So: requests fade the current clip out first and the
  // rAF loop executes the swap on the frame the envelope reaches 0. A newer
  // request simply replaces the pending one (last selection wins).
  const pendingSwapRef = useRef<ClipSwapRequest | null>(null);
  // Lab context-loop settle (issue #1): a loop the host swaps to when the
  // current standalone one-shot finishes, instead of fading to the standing
  // idle. Armed/cleared by the Lab via setPendingSettle; consumed once on finish.
  const pendingSettleRef = useRef<ClipSwapRequest | null>(null);

  // --- Prop microEvents (INF-4) ----------------------------------------------
  // Resolve the grip for an attach: the event's inline grip wins, else the prop
  // library's attach offset for the target bone's anchor slot.
  const BONE_TO_ANCHOR: Record<string, 'hand_r' | 'hand_l' | 'head'> = {
    rightHand: 'hand_r',
    leftHand: 'hand_l',
    head: 'head',
  };
  const resolveMicroGrip = (ev: MicroEvent): GripOffset | null => {
    if (ev.grip) return { position: ev.grip.position, rotation: ev.grip.rotation, ...(ev.grip.scale !== undefined ? { scale: ev.grip.scale } : {}) };
    const anchor = BONE_TO_ANCHOR[ev.bone ?? 'rightHand'];
    const item = propsRef.current.propLibrary?.items.find((it) => it.id === ev.prop);
    const grip = item?.attach?.[anchor];
    return grip ? { position: grip.position, rotation: grip.rotation, ...(grip.scale !== undefined ? { scale: grip.scale } : {}) } : null;
  };

  // Execute one attach/detach. Finds the prop's container anywhere in the scene
  // (resting in propsRoot OR already on a bone), so re-runs are safe.
  const runMicroEvent = (ev: MicroEvent) => {
    const vrm = vrmRef.current;
    const root = sceneRef.current;
    if (!vrm?.humanoid || !root) return;
    const prop = findPropContainer(root, `item:${ev.prop}`);
    if (!prop) return; // prop not enabled in the scene — silently skip
    if (ev.action === 'detach') {
      detachPropToHome(prop);
      attachedByClipRef.current.delete(ev.prop);
      return;
    }
    const boneName = ev.bone ?? 'rightHand';
    const bone = (vrm.humanoid as unknown as { getRawBoneNode?: (n: string) => THREE.Object3D | null }).getRawBoneNode?.(boneName);
    const grip = resolveMicroGrip(ev);
    if (!bone || !grip) return;
    attachPropToBone(prop, bone, grip);
    attachedByClipRef.current.add(ev.prop);
  };

  // Force every prop the active clip parented back to its desk rest. Called when
  // a clip swaps out so an interrupted sip never leaves the cup floating.
  const cleanupAttachedProps = () => {
    if (attachedByClipRef.current.size === 0) return;
    const root = sceneRef.current;
    for (const propId of attachedByClipRef.current) {
      const prop = root ? findPropContainer(root, `item:${propId}`) : null;
      if (prop) detachPropToHome(prop);
    }
    attachedByClipRef.current.clear();
  };

  const executeClipSwap = (req: ClipSwapRequest) => {
    // Return any prop the OUTGOING clip still holds before swapping (no float).
    cleanupAttachedProps();
    switchClip(req.clip, req.boneNames, req.source, req.hasExpressionTracks);
    // Prop microEvents travel with a DSL clip; reset the firing cursor.
    clipMicroEventsRef.current = req.source === 'dsl' ? (req.microEvents ?? null) : null;
    microCursorRef.current = makeMicroCursor();
    // Face channel travels with the clip (DSL only; builtin/vrma carry none).
    clipFaceRef.current = req.source === 'dsl' ? (req.faceTimeline ?? null) : null;
    // Hips position offset likewise travels with a DSL clip (試験B). A zero
    // offset is treated as "none" so we leave hips.position untouched.
    {
      const ho = req.source === 'dsl' ? (req.hipsOffset ?? null) : null;
      clipHipsOffsetRef.current = ho && (ho[0] !== 0 || ho[1] !== 0 || ho[2] !== 0) ? ho : null;
      clipHipsCurveRef.current = req.source === 'dsl' ? (req.hipsCurve ?? null) : null;
      clipRootCurveRef.current = req.source === 'dsl' ? (req.rootCurve ?? null) : null;
    }
    const ext = extControllerRef.current;
    ext.setFadeDurations(req.fadeIn, req.fadeOut);
    if (req.loop !== undefined) ext.setLoop(req.loop);
    if (req.clipWeight !== undefined) ext.setClipWeight(req.clipWeight);
    if (req.autoPlay) ext.play();
  };

  const requestClipSwap = (req: ClipSwapRequest) => {
    const ext = extControllerRef.current;
    if (!actionRef.current || ext.getDebug().blend <= 1e-4) {
      pendingSwapRef.current = null;
      executeClipSwap(req); // nothing visible to fade — swap on the spot
    } else {
      pendingSwapRef.current = req;
      ext.returnToIdle(); // fade out with the OUTGOING motion's declared fadeOut
    }
  };

  const loadDslSwapRequest = async (motionId: string, autoPlay: boolean): Promise<ClipSwapRequest | null> => {
    const vrm = vrmRef.current;
    if (!vrm) return null;
    const result = await loadMotionDoc(motionId);
    if (!result.ok) {
      console.warn(`[EXT] DSL settle load failed: ${motionId}`, result.errors);
      return null;
    }
    const compiled = compileDslClip(result.evaluator, vrm);
    return {
      clip: compiled.clip,
      boneNames: compiled.boneNames,
      source: 'dsl',
      hasExpressionTracks: false,
      autoPlay,
      loop: result.evaluator.loop,
      fadeIn: result.doc.motion.fadeIn,
      fadeOut: result.doc.motion.fadeOut,
      faceTimeline: result.evaluator.faceTimeline,
      hipsOffset: compiled.hipsOffset,
      hipsCurve: compiled.hipsCurve,
      rootCurve: compiled.rootCurve,
      microEvents: result.doc.motion.microEvents ?? null,
    };
  };

  const activateBuiltinClip = (autoPlay = false) => {
    const vrm = vrmRef.current;
    if (!vrm) return;
    pendingSettleRef.current = null;
    const built = buildProceduralClip(vrm);
    requestClipSwap({
      clip: built.clip,
      boneNames: built.boneNames,
      source: built.source,
      hasExpressionTracks: built.hasExpressionTracks,
      autoPlay,
    });
    console.log(`[EXT] built-in clip active: bones=${built.boneNames.join(',')}`);
    propsRef.current.onStatusUpdate('External clip: built-in look-around');
  };

  const loadVrmaFrom = (url: string, opts?: { label?: string; autoPlay?: boolean }) => {
    const vrm = vrmRef.current;
    if (!vrm) return;
    pendingSettleRef.current = null;
    propsRef.current.onStatusUpdate(`Loading .vrma ${opts?.label ?? url} ...`);
    loadVrmaClip(url, vrm)
      .then((loaded) => {
        requestClipSwap({
          clip: loaded.clip,
          boneNames: loaded.boneNames,
          source: loaded.source,
          hasExpressionTracks: loaded.hasExpressionTracks,
          autoPlay: opts?.autoPlay ?? false,
        });
        console.log(
          `[EXT] .vrma loaded "${loaded.clip.name}" dur=${loaded.duration.toFixed(2)}s bones=${loaded.boneNames.length}` +
            ` | stripped expr=${loaded.strippedExpressionTracks} pos=${loaded.strippedPositionTracks} other=${loaded.strippedOtherTracks}`,
        );
        if (loaded.hasExpressionTracks) {
          console.log(
            `[EXT] NOTE: .vrma carried ${loaded.strippedExpressionTracks} expression track(s) — ignored; the Custom Expression Bridge has priority.`,
          );
        }
        propsRef.current.onStatusUpdate(
          `External clip: ${opts?.label ?? loaded.clip.name} (.vrma, ${loaded.boneNames.length} bones)`,
        );
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[EXT] .vrma load failed:', msg);
        propsRef.current.onStatusUpdate(`.vrma load failed (${msg}) — see public/motions/README. Built-in clip kept.`);
      });
  };

  // Motion selector (0.7 UI): resolve kind/ref to a clip via the established
  // paths (builtin / vrma loader / shared DSL loader + compiler) and optionally
  // auto-play. DSL motions also apply their declared loop flag.
  const handleMotionRequest = (req: MotionRequest) => {
    if (req.kind === 'builtin') {
      activateBuiltinClip(req.play);
      return;
    }
    if (req.kind === 'vrma') {
      loadVrmaFrom(req.ref, { label: req.label, autoPlay: req.play });
      return;
    }
    // kind === 'dsl'
    const vrm = vrmRef.current;
    if (!vrm) {
      propsRef.current.onStatusUpdate('VRM not loaded yet — retry once the model is in.');
      return;
    }
    propsRef.current.onStatusUpdate(`Loading motion "${req.ref}" ...`);
    loadMotionDoc(req.ref)
      .then(async (result) => {
        if (!result.ok) {
          const first = result.errors[0];
          console.warn('[EXT] DSL motion load failed:', result.errors);
          propsRef.current.onStatusUpdate(`Motion "${req.ref}" failed: ${first.path}: ${first.message}`);
          return;
        }
        const compiled = compileDslClip(result.evaluator, vrm);
        const swapReq: ClipSwapRequest = {
          clip: compiled.clip,
          boneNames: compiled.boneNames,
          source: 'dsl',
          hasExpressionTracks: false,
          autoPlay: req.play,
          loop: result.evaluator.loop,
          fadeIn: result.doc.motion.fadeIn,
          fadeOut: result.doc.motion.fadeOut,
          faceTimeline: result.evaluator.faceTimeline,
          hipsOffset: compiled.hipsOffset,
          hipsCurve: compiled.hipsCurve,
          rootCurve: compiled.rootCurve,
          microEvents: result.doc.motion.microEvents ?? null,
        };
        pendingSettleRef.current = null;
        let settleLoop: string | null = null;
        if (req.play && !result.evaluator.loop) {
          const currentMode = directorRef.current?.status().mode ?? null;
          settleLoop = contextReturnLoop(req.ref) ?? sittingFallbackLoop(result.doc.motion.posture, currentMode);
          if (settleLoop) {
            pendingSettleRef.current =
              directorClipsRef.current.get(settleLoop) ?? (await loadDslSwapRequest(settleLoop, true));
          }
        }
        requestClipSwap(swapReq);
        const label = req.label ?? result.doc.motion.label ?? req.ref;
        console.log(
          `[EXT] DSL motion "${req.ref}" compiled: ${compiled.boneNames.length} bones, ${result.evaluator.duration}s` +
            (compiled.missingBones.length ? ` (model lacks: ${compiled.missingBones.join(',')})` : ''),
        );
        propsRef.current.onStatusUpdate(
          `External clip: ${label} (DSL, ${result.evaluator.duration}s)` +
            (pendingSettleRef.current ? ` → ${settleLoop}` : ''),
        );
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        propsRef.current.onStatusUpdate(`Motion "${req.ref}" failed: ${msg}`);
      });
  };

  // --- Director (INF-5): self-running mode loop + scheduled ambients ----------
  // Preload a DSL motion into a swap-ready ClipSwapRequest (compiled once, reused
  // for repeated plays). Returns false on load/compile failure.
  const preloadDirectorMotion = async (motionId: string): Promise<boolean> => {
    const vrm = vrmRef.current;
    if (!vrm) return false;
    if (directorClipsRef.current.has(motionId)) return true;
    const result = await loadMotionDoc(motionId);
    if (!result.ok) {
      console.warn(`[DIRECTOR] preload failed: ${motionId}`, result.errors);
      return false;
    }
    const compiled = compileDslClip(result.evaluator, vrm);
    directorClipsRef.current.set(motionId, {
      clip: compiled.clip,
      boneNames: compiled.boneNames,
      source: 'dsl',
      hasExpressionTracks: false,
      autoPlay: true,
      loop: result.evaluator.loop,
      fadeIn: result.doc.motion.fadeIn,
      fadeOut: result.doc.motion.fadeOut,
      faceTimeline: result.evaluator.faceTimeline,
      hipsOffset: compiled.hipsOffset,
      hipsCurve: compiled.hipsCurve,
      rootCurve: compiled.rootCurve,
      microEvents: result.doc.motion.microEvents ?? null,
    });
    return true;
  };

  const playDirectorMotion = (motionId: string): void => {
    const req = directorClipsRef.current.get(motionId);
    if (req) requestClipSwap({ ...req, autoPlay: true });
  };

  // Start the director: preload the demo content, build the runner, play the
  // first loop. Exposed via the Lab handle (`__motionLab.director(true)`).
  const startDirector = async (opts?: { seed?: number; initialMode?: ModeId }): Promise<{ ok: boolean; loaded: string[]; error?: string }> => {
    if (!vrmRef.current) return { ok: false, loaded: [], error: 'VRM not loaded yet' };
    // Reset away/presence so a (re)start is clean.
    pendingSettleRef.current = null; // drop any Lab context-loop settle
    awayRef.current = { active: false, stage: 'leave', elapsed: 0, segIndex: -1, returnTo: 'work_normal' };
    prevDirModeRef.current = null;
    directorRootRef.current = [0, 0, 0, 0];
    if (vrmRef.current) vrmRef.current.scene.visible = true;
    const ids = new Set<string>();
    for (const m of Object.values(DIRECTOR_LOOPS)) if (m) ids.add(m);
    for (const list of Object.values(DIRECTOR_AMBIENTS)) for (const a of list ?? []) ids.add(a);
    for (const t of DIRECTOR_TRANSITIONS) ids.add(t);
    for (const m of AWAY_MOTIONS) ids.add(m); // leave/return locomotion clips
    const loaded: string[] = [];
    for (const id of ids) if (await preloadDirectorMotion(id)) loaded.push(id);
    const authoredAmbients = new Set<string>(
      Object.values(DIRECTOR_AMBIENTS).flat().filter((a): a is string => !!a && directorClipsRef.current.has(a)),
    );
    // Prop gating: a prop-requiring ambient (amb_*_sip) is only eligible when its
    // prop is actually in the scene. Cup is the only Phase-1 held prop.
    const availableProps = new Set<string>();
    if (findPropContainer(sceneRef.current ?? propsRootRef.current, 'item:cup')) availableProps.add('cup');
    // If the cup isn't present, drop the prop-gated ambients from the authored
    // pool too (belt-and-braces with the scheduler's requiresProp gate).
    if (!availableProps.has('cup')) for (const id of DIRECTOR_PROP_AMBIENTS) authoredAmbients.delete(id);
    const runner = new DirectorRunner({
      seed: opts?.seed,
      initialMode: opts?.initialMode ?? 'work_normal',
      availableMotions: authoredAmbients,
      availableProps,
      loopMotionFor: (mode) => DIRECTOR_LOOPS[mode] ?? null,
      // Resolve a (from→to) bridge from the design table, but only commit to it
      // when EVERY motion in the chain actually preloaded (else swap straight to
      // the loop — a partial chain would leave the posture mismatched).
      transitionMotionsFor: (from, to) => {
        const chain = resolveTransitionChain(from, to);
        if (chain.length === 0) return [];
        return chain.every((id) => directorClipsRef.current.has(id)) ? chain : [];
      },
    });
    directorRef.current = runner;
    const first = runner.start();
    if (first) playDirectorMotion(first.motionId);
    propsRef.current.onStatusUpdate(
      `[DIRECTOR] running — ${first?.motionId ?? 'no loop'} + ${authoredAmbients.size} ambients` +
        `${availableProps.size ? ` + props[${[...availableProps].join(',')}]` : ''}`,
    );
    return { ok: true, loaded };
  };

  const stopDirector = (): { ok: boolean } => {
    directorRef.current = null;
    cleanupAttachedProps(); // never leave the cup mid-air on a stop
    // Reset away state + presence so a restart is clean.
    awayRef.current = { active: false, stage: 'leave', elapsed: 0, segIndex: -1, returnTo: 'work_normal' };
    prevDirModeRef.current = null;
    directorRootRef.current = [0, 0, 0, 0];
    if (vrmRef.current) vrmRef.current.scene.visible = true;
    pendingSettleRef.current = null; // drop any Lab context-loop settle
    extControllerRef.current.returnToIdle();
    propsRef.current.onStatusUpdate('[DIRECTOR] stopped — returning to idle');
    return { ok: true };
  };

  // --- Away orchestrator (Step 4) --------------------------------------------
  const startAwayLeave = (): void => {
    awayRef.current = { active: true, stage: 'leave', elapsed: 0, segIndex: -1, returnTo: 'work_normal' };
    if (vrmRef.current) vrmRef.current.scene.visible = true;
    propsRef.current.onStatusUpdate('[DIRECTOR] away: standing up to leave…');
  };
  const startAwayReturn = (to: ModeId): void => {
    awayRef.current = { active: true, stage: 'return', elapsed: 0, segIndex: -1, returnTo: to };
    if (vrmRef.current) vrmRef.current.scene.visible = true;
    propsRef.current.onStatusUpdate(`[DIRECTOR] away: walking back to ${to}…`);
  };

  /** Advance the away locomotion phase machine; drives clips, root, visibility. */
  const tickAway = (dt: number): void => {
    const a = awayRef.current;
    if (!a.active) return;
    if (a.stage === 'hidden') {
      directorRootRef.current = [AWAY_PARAMS.off[0], 0, AWAY_PARAMS.off[1], AWAY_PARAMS.faceY];
      return; // wait (invisible) until the FSM picks a return target
    }
    a.elapsed += dt;
    if (a.stage === 'leave') {
      const pos = seqAt(LEAVE_SEQ, a.elapsed);
      if (pos.index !== a.segIndex) { a.segIndex = pos.index; playDirectorMotion(pos.motion); }
      directorRootRef.current = leaveRoot(a.elapsed, AWAY_PARAMS);
      if (a.elapsed >= seqDuration(LEAVE_SEQ)) {
        a.stage = 'hidden';
        a.elapsed = 0;
        directorRootRef.current = [AWAY_PARAMS.off[0], 0, AWAY_PARAMS.off[1], AWAY_PARAMS.faceY];
        cleanupAttachedProps(); // any held prop returns to the desk before she's gone
        if (vrmRef.current) vrmRef.current.scene.visible = false;
        propsRef.current.onStatusUpdate('[DIRECTOR] away: out of the room');
      }
    } else if (a.stage === 'return') {
      const pos = seqAt(RETURN_SEQ, a.elapsed);
      if (pos.index !== a.segIndex) { a.segIndex = pos.index; playDirectorMotion(pos.motion); }
      directorRootRef.current = returnRoot(a.elapsed, AWAY_PARAMS);
      if (a.elapsed >= seqDuration(RETURN_SEQ)) {
        directorRootRef.current = [0, 0, 0, 0]; // exactly back at the chair
        const loop = DIRECTOR_LOOPS[a.returnTo] ?? DIRECTOR_LOOPS.work_normal ?? null;
        if (loop) playDirectorMotion(loop);
        a.active = false;
        propsRef.current.onStatusUpdate(`[DIRECTOR] back — ${a.returnTo}`);
      }
    }
  };

  const handleExternalAction = (action: ExternalRequestAction) => {
    if (action === 'loadVrma') return loadVrmaFrom(VRMA_SAMPLE_PATH);
    if (action === 'useBuiltin') return activateBuiltinClip();
    extControllerRef.current.apply(action);
  };

  // Forward the Clip Weight slider continuously; dispatch discrete commands.
  useEffect(() => {
    extControllerRef.current.setClipWeight(props.externalClipWeight);
  }, [props.externalClipWeight]);
  useEffect(() => {
    if (props.externalRequest.seq === 0) return;
    handleExternalAction(props.externalRequest.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.externalRequest]);
  useEffect(() => {
    if (props.motionRequest.seq === 0) return;
    handleMotionRequest(props.motionRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.motionRequest]);

  // Blink state
  const blinkStateRef = useRef<{ time: number; phase: 'open' | 'closing' | 'closed' | 'opening'; nextBlink: number }>({
    time: 0, phase: 'open', nextBlink: 3.0
  });

  // Expression preset overlay (Expression Preset System 0.1). The controller
  // owns the fade envelope; the animate loop max-blends its weights each frame
  // (clear -> manual -> idle overlay -> preset overlay -> blink, no residue).
  const exprOverlayRef = useRef(new ExpressionOverlayController());
  useEffect(() => {
    exprOverlayRef.current.setPreset(props.expressionPresetId, props.expressionPresetIntensity);
    // intensity is intentionally NOT a dep: live slider moves go through
    // setIntensity below without re-triggering the preset crossfade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.expressionPresetId]);
  useEffect(() => {
    exprOverlayRef.current.setIntensity(props.expressionPresetIntensity);
  }, [props.expressionPresetIntensity]);

  // SpringBone lightweight state
  const sbTimeRef = useRef(0);

  // Custom Expression Bridge
  // (vrm.expressionManager is bypassed for this model — see load callback)
  const faceMeshesRef = useRef<THREE.Mesh[]>([]);
  const expressionMapRef = useRef<Record<string, { index: number; weight: number }[]>>({});

  // --- Scene / Props (Motion Probe 0.4) ---
  // propsRoot holds all loaded props as a sibling of vrm.scene in the SAME
  // THREE.Scene. Prop loading is independent of the VRM load, so a missing prop
  // never blocks the character. The loader is a plain GLTFLoader (no VRM plugin),
  // created in the mount effect. Status is reported once per (re)load
  // (rAF-independent), so it surfaces even in the hidden preview tab.
  const propsRootRef = useRef<THREE.Group>(new THREE.Group());
  // The THREE.Scene root (set on mount). Needed to find prop containers whether
  // they are resting in propsRoot or attached to a hand bone (reparented into
  // vrm.scene) — used by the Director's prop microEvents (INF-4 attach/detach).
  const sceneRef = useRef<THREE.Scene | null>(null);
  const propLoaderRef = useRef<{ loadAsync(url: string): Promise<{ scene: THREE.Object3D }> } | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  // Stage D: the active scene's raw (day) lighting block, cached so a daypart
  // flip can re-derive + re-apply the night overrides without a scene reload.
  const currentSceneLightingRef = useRef<SceneLighting | undefined>(undefined);

  // --- Scene Layout Calibration (Motion Probe 0.6) ---
  // Live handles the per-frame layout apply / guides / camera nudge reach into.
  // The camera + controls are created inside the mount effect; these refs expose
  // them to the camera-nudge effect and the readback. propContainers maps a prop
  // id to its wrapping container Group (rebuilt on each scene load) so the
  // calibration state can drive it directly.
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const propContainersRef = useRef<Partial<Record<PropTargetId, THREE.Object3D>>>({});
  // Prop Layout 1.0: the live containers for the enabled small items, keyed by
  // `item:<id>`, plus the set tracked last load so a removed item's guide box can
  // be nulled out on the next scene (re)load.
  const itemContainersRef = useRef<Record<string, THREE.Object3D>>({});
  const trackedItemIdsRef = useRef<Set<string>>(new Set());
  const guidesRef = useRef<LayoutGuides | null>(null);

  // --- Motion Lab (Motion Probe 0.7) ---
  // Present only with ?lab=1. While lab.isFrozen() the animate loop yields the
  // pose + render to the Lab (see the freeze gate at the top of animate()).
  const labRef = useRef<MotionLab | null>(null);
  // Pose Composer (0.8): hand-authoring session. While isActive() the animate
  // loop yields the pose + render to it, exactly like the Lab's freeze gate.
  const poseComposerRef = useRef<PoseComposer | null>(null);

  // Apply a scene's lighting block to the existing lights (no-op if absent, so
  // the 0.1 defaults are preserved). Cosmetic only — never touches the rig.
  // Stage D: at 'night', a present `lighting.night.*` field overrides the day
  // value; a field the scene author left out of `night` keeps the day value
  // (partial override, not a full second lighting block).
  const applySceneLighting = (lighting?: SceneLighting, daypart?: Daypart) => {
    const amb = ambientLightRef.current;
    const dir = directionalLightRef.current;
    const night = daypart === 'night' ? lighting?.night : undefined;
    if (lighting && amb) amb.intensity = night?.ambientStrength ?? lighting.ambientStrength;
    if (lighting && dir) {
      dir.intensity = night?.mainLightStrength ?? lighting.mainLightStrength;
      dir.color.set(night?.mainLightColor ?? lighting.mainLightColor);
    }
  };

  // Stage D: re-derive lighting from the cached scene block when the daypart
  // flips (App re-computes it off the local clock — see daypart.ts) — no scene
  // reload needed, day<->night is just a relight of the existing lights.
  useEffect(() => {
    applySceneLighting(currentSceneLightingRef.current, props.daypart);
  }, [props.daypart]);

  // Scene loads are SERIALIZED through this chain: loadSceneProps clears then
  // appends into the shared propsRoot, so two overlapping loads (StrictMode's
  // dev double-effect, a quick variant change + reload, ...) would otherwise
  // both append and leave duplicate props in the scene (observed: 6 children).
  const sceneLoadChainRef = useRef<Promise<void>>(Promise.resolve());
  const sceneLoadsPendingRef = useRef(0);

  // Fetch a scene preset, (re)load its props into propsRoot, apply lighting +
  // visibility, and report the aggregated status. Never throws / never blocks
  // the render loop — load failures resolve to the built-in default + placeholders.
  const loadSceneAndProps = (sceneId: string) => {
    sceneLoadsPendingRef.current += 1;
    sceneLoadChainRef.current = sceneLoadChainRef.current
      .then(() => loadSceneAndPropsNow(sceneId))
      .finally(() => {
        sceneLoadsPendingRef.current = Math.max(0, sceneLoadsPendingRef.current - 1);
      });
  };

  const loadSceneAndPropsNow = (sceneId: string): Promise<void> => {
    const parent = propsRootRef.current;
    const loader = propLoaderRef.current;
    if (!loader) return Promise.resolve(); // mount effect hasn't created the loader yet
    propsRef.current.onStatusUpdate(`Loading scene "${sceneId}" ...`);
    return loadScenePreset(sceneId)
      .then(async ({ scene: baseScene, result }) => {
        // Prop Variants 0.8: swap in the selected per-slot models BEFORE props
        // load + layout seeding, so containers, guides, calibration and the
        // debug report all reflect what is actually on screen.
        const scene = applyVariantsToScene(
          baseScene,
          propsRef.current.variantRegistry,
          propsRef.current.variantSelection,
        );
        for (const p of scene.props) {
          const base = baseScene.props.find((b) => b.id === p.id);
          if (base && base.url !== p.url) console.log(`[VARIANTS] ${p.id}: ${p.url}`);
        }
        // Prop Library 0.9: append the enabled small desk items (cup/phone/…) as
        // rest-posed props. They flow through the same loader/placeholder/toggle
        // path; their `item:`-prefixed ids keep them out of the layout-calibration
        // desk/chair/laptop indexing below.
        const libraryProps = libraryItemsToSceneProps(
          propsRef.current.propLibrary,
          propsRef.current.itemSelection,
          propsRef.current.itemLayout,
        );
        if (libraryProps.length > 0) console.log(`[ITEMS] +${libraryProps.length}: ${libraryProps.map((p) => p.id).join(', ')}`);
        const allProps = [...scene.props, ...libraryProps];
        currentSceneLightingRef.current = scene.lighting;
        applySceneLighting(scene.lighting, propsRef.current.daypart);
        const opts = {
          propsEnabled: propsRef.current.propsEnabled,
          placeholdersEnabled: propsRef.current.placeholdersEnabled,
        };
        const results = await loadSceneProps(allProps, parent, loader, opts);

        // Scene Layout (0.6): index the freshly-loaded prop containers by id and
        // rebind the guides' bounding boxes to them. Then seed App's calibration
        // state from the (validated) preset so edits start at scene.json values.
        const containers: Partial<Record<PropTargetId, THREE.Object3D>> = {};
        const itemContainers: Record<string, THREE.Object3D> = {};
        for (const child of parent.children) {
          const id = (child.userData as { propId?: string }).propId;
          if (id === 'desk' || id === 'chair' || id === 'laptop') containers[id] = child;
          else if (typeof id === 'string' && id.startsWith('item:')) itemContainers[id] = child;
        }
        propContainersRef.current = containers;
        itemContainersRef.current = itemContainers;
        // Guides: track desk/chair/laptop + every live small item, and null out any
        // item box from the previous load whose item is no longer present.
        const trackedObjs: Record<string, THREE.Object3D | null> = {
          desk: containers.desk ?? null,
          chair: containers.chair ?? null,
          laptop: containers.laptop ?? null,
          ...itemContainers,
        };
        for (const oldId of trackedItemIdsRef.current) {
          if (!(oldId in itemContainers)) trackedObjs[oldId] = null;
        }
        trackedItemIdsRef.current = new Set(Object.keys(itemContainers));
        guidesRef.current?.setTracked(trackedObjs);
        const findProp = (id: string) => scene.props.find((p) => p.id === id);
        const transforms: LayoutTransforms = {
          character: toTransformEntry(scene.character),
          desk: toTransformEntry(findProp('desk')),
          chair: toTransformEntry(findProp('chair')),
          laptop: toTransformEntry(findProp('laptop')),
        };
        const camEntry: CameraEntry = {
          preset: scene.camera?.preset ?? 'monitor_side',
          position: scene.camera?.position ?? [0.4, 0.9, 0.8],
          target: scene.camera?.target ?? [0.0, 1.0, 0.0],
          fov: scene.camera?.fov ?? 45,
        };
        propsRef.current.onLayoutInit({ transforms, camera: camEntry });

        const propLoaded = results.filter((r) => r.ok).length;
        const placeholders = results.filter((r) => r.usedPlaceholder).length;
        const propMissing = results.filter((r) => !r.ok).length;
        const debug: SceneDebug = {
          sceneId: scene.sceneId,
          label: scene.label,
          sceneOk: result.ok,
          usedDefault: result.usedDefault,
          propTotal: results.length,
          propLoaded,
          propMissing,
          placeholders,
          propsEnabled: opts.propsEnabled,
          placeholdersEnabled: opts.placeholdersEnabled,
          warnings: result.warnings,
          results,
          // 0.5: forward the background block so App's SceneBackgroundLayer can
          // (re)render room/outside/light layers. Updates on G: Reload Scene too.
          background: scene.background,
        };
        propsRef.current.onSceneDebug(debug);
        console.log(
          `[SCENE] "${scene.sceneId}" loaded (${result.source}) | props ${propLoaded}/${results.length} ok,` +
            ` placeholders ${placeholders}, missing ${propMissing}`,
        );
        for (const r of results) {
          if (!r.ok) console.log(`[SCENE]   - ${r.id}: ${r.source}${r.error ? ` (${r.error})` : ''}`);
        }
        for (const w of result.warnings) console.warn(`[SCENE] warning: ${w}`);
        propsRef.current.onStatusUpdate(
          `Scene: ${scene.label} — props ${propLoaded}/${results.length} (placeholder ${placeholders})`,
        );
      })
      .catch((err: unknown) => {
        // loadScenePreset / loadSceneProps don't reject; guard anyway so a bug
        // here can never take down the render loop.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[SCENE] unexpected scene load error:', msg);
        propsRef.current.onStatusUpdate(`Scene load error: ${msg}`);
      });
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    // Production auto-start (Stage B) cancellation flag for THIS mount cycle.
    // A plain closure local, not a ref: StrictMode's dev double-invoke runs
    // mount -> cleanup -> mount on the same component instance, so a ref would
    // be shared across cycles and the first cleanup's cancellation would wrongly
    // poison the second mount's own in-flight startDirector() too.
    let autoStartCancelled = false;

    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20.0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enabled = false;
    // Scene Layout (0.6): expose camera + controls to the nudge effect / readback.
    cameraRef.current = camera;
    controlsRef.current = controls;

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(1, 2, 3);
    scene.add(directionalLight);
    directionalLightRef.current = directionalLight;
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    scene.add(lookAtTargetRef.current);

    // Scene / Props (0.4): propsRoot is a sibling group in the SAME scene; a
    // dedicated plain GLTFLoader (no VRM plugin) loads prop GLBs. The actual
    // scene load is driven by the [sceneId, sceneReloadSeq] effect below, which
    // runs right after this mount effect (so the loader/group already exist).
    scene.add(propsRootRef.current);
    propLoaderRef.current = new GLTFLoader();

    // Scene Layout (0.6): visual guides group (grid / axes / bboxes / markers).
    // Hidden until toggled (T). Added to the same scene; updated each frame only
    // while visible. Prop boxes are bound on scene load; character box on VRM load.
    const guides = createLayoutGuides();
    guidesRef.current = guides;
    scene.add(guides.group);
    guides.setVisible(propsRef.current.guidesEnabled);
    guides.setSelected(propsRef.current.selectedTarget);

    // Motion Lab (0.7): install the authoring API when ?lab=1. The Lab reads
    // the VRM and bridge tables lazily through the refs, so installing before
    // the async VRM load is safe (calls before load fail with a clear message).
    const _reviewQuery = new URLSearchParams(window.location.search);
    let removeReviewPanel: (() => void) | null = null;
    if (_reviewQuery.has('lab') || _reviewQuery.has('phase1Review') || _reviewQuery.has('poseEdit')) {
      // One handle bag shared by the Lab and the Pose Composer (both dev-only).
      const labHandles = {
        renderer,
        scene,
        camera,
        cameraPresets: CAMERA_PRESETS,
        controls,
        getVrm: () => vrmRef.current,
        isSceneReady: () => sceneLoadsPendingRef.current === 0,
        getRestQuaternions: () => initialRotationsRef.current,
        getRestHipsPosition: () => initialHipsPosRef.current,
        getFaceMeshes: () => faceMeshesRef.current,
        getExpressionMap: () => expressionMapRef.current,
        lookAtTarget: lookAtTargetRef.current,
        propsRoot: propsRootRef.current,
        requestClipSwap,
        setPendingSettle: (req: ClipSwapRequest | null) => { pendingSettleRef.current = req; },
        extController: extControllerRef.current,
        onStatus: (s: string) => propsRef.current.onStatusUpdate(s),
        startDirector,
        stopDirector,
        getDirectorStatus: () => directorRef.current?.status() ?? null,
      };
      labRef.current = installMotionLab(labHandles);
      // Pose Composer 0.8 (Stage 1): window.__poseComposer, sharing the handles.
      poseComposerRef.current = installPoseComposer(labHandles);
      // Stage 2: the bone-select + numeric DOM panel, only with ?poseEdit=1.
      if (_reviewQuery.has('poseEdit')) installPoseComposerPanel(poseComposerRef.current);
      // Phase 1 visual-QA review panel (dev-only; never in the production wallpaper).
      if (_reviewQuery.has('phase1Review') && labRef.current) removeReviewPanel = installReviewPanel(labRef.current);
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    props.onStatusUpdate('Loading VRM...');

    loader.load(
      '/models/kiritan.vrm',
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        vrmRef.current = vrm;
        scene.add(vrm.scene);
        vrm.scene.rotation.y = Math.PI; // Face +Z
        // Scene Layout (0.6): bind the character bbox guide to the loaded VRM.
        guides.setTracked({ character: vrm.scene });

        // Setup LookAt
        if (vrm.lookAt) {
          vrm.lookAt.target = lookAtTargetRef.current;
        }



        // Cache initial rotations for idle motion
        const humanoid = vrm.humanoid;
        if (humanoid) {
          // Drop arms from T-pose
          const lArm = humanoid.getNormalizedBoneNode('leftUpperArm' as never);
          const rArm = humanoid.getNormalizedBoneNode('rightUpperArm' as never);
          if (lArm) lArm.rotation.z = 1.2;
          if (rArm) rArm.rotation.z = -1.2;

          const bonesToCache = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm']; // upperChest is intentionally omitted
          bonesToCache.forEach(boneName => {
            const node = humanoid.getNormalizedBoneNode(boneName as never);
            if (node) {
              initialRotationsRef.current.set(boneName, node.quaternion.clone());
            }
          });

          // Hips rest POSITION (not just rotation): the base for a seated
          // posture's hipsOffset, applied each frame in the render loop (試験B).
          const hipsNode = humanoid.getNormalizedBoneNode('hips' as never);
          if (hipsNode) initialHipsPosRef.current = hipsNode.position.clone();

          // Additionally cache every other humanoid bone's rest/drop pose so an
          // external .vrma clip that drives bones outside the idle set (arms,
          // hips, legs…) can blend in and slerp back home on Return to Idle.
          // Captured AFTER the arm-drop, so arms cache their dropped pose.
          Object.keys((humanoid as unknown as { humanBones: Record<string, unknown> }).humanBones).forEach((boneName) => {
            if (initialRotationsRef.current.has(boneName)) return;
            const node = humanoid.getNormalizedBoneNode(boneName as never);
            if (node) initialRotationsRef.current.set(boneName, node.quaternion.clone());
          });
        }

        // Ensure arm rotation is propagated to raw bones immediately
        vrm.humanoid?.update();

        // --- Custom Expression Bridge setup ---
        // This MMD-derived VRM 0.x model breaks the standard expression path on
        // two counts, so vrm.expressionManager renders nothing:
        //   1. The face is built from ~13 primitives ("layers": skin, eye
        //      variants, tears) that all share ONE vertex buffer, but the
        //      exporter stored the 68 morph targets on only the first layer
        //      ("0.eye"). The visible skin/mouth layers carry no morphs.
        //   2. Because the other layers lack the indexed morph, three-vrm drops
        //      every expression bind during load (the "morph not found" warnings).
        // Fix: since every layer shares the same POSITION attribute, the first
        // layer's morph deltas apply verbatim to the rest — we attach them to
        // each sibling, then drive all layers' morphTargetInfluences directly
        // using the indices declared in the model's own VRM blendShapeMaster.

        // 1. Find morph-owning meshes and propagate their morphs to sibling
        //    layers that share the same vertices.
        const faceMeshes: THREE.Mesh[] = [];
        const morphSources: THREE.Mesh[] = [];
        vrm.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.geometry?.morphAttributes?.position) morphSources.push(obj);
        });
        for (const src of morphSources) {
          const srcPos = src.geometry.attributes.position;
          const siblings = (src.parent?.children ?? []).filter(
            (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry?.attributes?.position === srcPos
          );
          for (const mesh of siblings) {
            if (!mesh.geometry.morphAttributes.position) {
              // Share (by reference) the source layer's morph deltas + normals.
              mesh.geometry.morphAttributes = src.geometry.morphAttributes;
              mesh.geometry.morphTargetsRelative = src.geometry.morphTargetsRelative;
              mesh.updateMorphTargets(); // rebuild influences/dictionary from geometry
            }
            if (!faceMeshes.includes(mesh)) faceMeshes.push(mesh);
          }
        }
        // These layer materials were first compiled without morph support, so
        // force a one-time shader recompile now that every layer has morphs.
        for (const mesh of faceMeshes) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) mat.needsUpdate = true;
        }
        faceMeshesRef.current = faceMeshes;

        // 2. Build expression -> [{index, weight}] from blendShapeMaster so the
        //    indices and partial weights stay faithful to the source VRM.
        const expressionMap: Record<string, { index: number; weight: number }[]> = {};
        const groups = gltf.parser?.json?.extensions?.VRM?.blendShapeMaster?.blendShapeGroups ?? [];
        const presetAlias: Record<string, string> = { blink_l: 'blinkleft', blink_r: 'blinkright' };
        for (const g of groups) {
          const binds = (g.binds ?? []).map((b: { index: number; weight?: number }) => ({ index: b.index, weight: (b.weight ?? 100) / 100 }));
          const preset = (g.presetName || g.name || '').toLowerCase();
          if (preset) expressionMap[preset] = binds;
          if (presetAlias[preset]) expressionMap[presetAlias[preset]] = binds;
        }
        // Fallback (verified against this model) if blendShapeMaster is absent.
        if (Object.keys(expressionMap).length === 0) {
          const w = (index: number, weight = 1) => ({ index, weight });
          Object.assign(expressionMap, {
            a: [w(25)], i: [w(26)], u: [w(27)], e: [w(28)], o: [w(29)],
            blink: [w(13)], joy: [w(3), w(14)], angry: [w(1), w(20, 0.612), w(47)],
            sorrow: [w(2), w(21), w(44)], fun: [w(3, 0.654), w(19)],
            blinkleft: [w(18)], blinkright: [w(17)],
          });
        }
        // 3. Expression Preset System 0.1: promote curated RAW morphs (e.g.
        //    びっくり/じと目/にやり — present on the mesh but absent from
        //    blendShapeMaster) to named entries, resolved BY NAME. UniVRM puts
        //    targetNames on the primitive extras, which GLTFLoader ignores, so
        //    the glTF JSON is the name source of truth here. Additive only;
        //    missing names are reported, never faked. The model is untouched.
        const derived = registerDerivedExpressions(expressionMap, faceMeshes, buildMorphNameIndex(gltf.parser?.json));
        if (derived.missing.length > 0) {
          console.warn(
            `[EXPR] derived expressions unavailable on this model: ` +
              derived.missing.map((m) => `${m.id}(${m.morphNames.join('/')})`).join(', '),
          );
        }
        expressionMapRef.current = expressionMap;
        console.log(`[DIAG] Expression layers: ${faceMeshes.length}, expressions: ${Object.keys(expressionMap).join(', ')}`);
        console.log(`[EXPR] derived expressions registered: ${derived.registered.join(', ') || '(none)'}`);

        // --- External Motion setup (Motion Probe 0.3) ---
        // Bind the mixer to vrm.scene so clip tracks (named `${normalizedNode.
        // name}.quaternion`) resolve to the same normalized nodes the idle layer
        // drives. Arm a built-in code clip so the probe is fully exercisable even
        // with no user .vrma present (External Motion stays OFF until requested).
        mixerRef.current = new THREE.AnimationMixer(vrm.scene);
        // Oneshot end (LoopOnce reaches its last frame): in director mode this is
        // an ambient finishing — resume the mode loop; otherwise tell the
        // controller to fade back to idle. The mixer outlives clip swaps, so one
        // listener covers every future action.
        mixerRef.current.addEventListener('finished', () => {
          // The away orchestrator switches clips on its own time-based schedule,
          // so ignore one-shot 'finished' while it runs (else it would fade to
          // idle between leave/return steps).
          if (awayRef.current.active) return;
          const director = directorRef.current;
          if (director) {
            // A one-shot finished under the director: advance a transition chain
            // (next link or the target loop) or resume the mode loop after an
            // ambient. onClipFinished() returns the next action to play.
            const next = director.onClipFinished();
            if (next) {
              playDirectorMotion(next.motionId);
              return;
            }
          }
          // Lab standalone play({settleToContextLoop}): land in the armed context
          // loop instead of fading to the standing idle pose (issue #1).
          const settle = pendingSettleRef.current;
          if (settle) {
            pendingSettleRef.current = null;
            requestClipSwap(settle);
            return;
          }
          extControllerRef.current.notifyFinished();
        });
        const built = buildProceduralClip(vrm);
        switchClip(built.clip, built.boneNames, built.source, built.hasExpressionTracks);
        console.log(`[EXT] mixer ready; built-in clip armed (bones=${built.boneNames.join(',')}). External Motion OFF by default.`);

        props.onStatusUpdate('Loaded: ふらすこ式風きりたん (VRM 0.x)');

        // Production wallpaper (Stage B): start the Motion Director the same
        // way the Lab's `__motionLab.director(true)` does, minus the manual
        // trigger. Dev/probe/lab entries pass autoStartDirector=false and keep
        // full manual control. Guarded against StrictMode's dev double-invoke:
        // this VRM-load callback can itself fire AFTER this mount's own cleanup
        // (GLTFLoader has no abort hook, so a stale mount's in-flight fetch
        // still resolves) — checking autoStartCancelled here, not just in the
        // .then() below, stops a long-dead mount from ever calling
        // startDirector() and clobbering directorRef.current out from under
        // the surviving mount's own runner.
        if (props.autoStartDirector && !directorRef.current && !autoStartCancelled) {
          startDirector().then((result) => {
            if (autoStartCancelled) {
              stopDirector();
              return;
            }
            if (result.ok) {
              console.log(`[DIRECTOR] production auto-start ok (${result.loaded.length} motions preloaded)`);
            } else {
              console.warn('[DIRECTOR] production auto-start failed:', result.error);
            }
          });
        }
      },
      (progress: ProgressEvent) => {
        const pct = Math.round(100.0 * (progress.loaded / progress.total));
        props.onStatusUpdate(`Loading VRM... ${pct}%`);
      },
      (error: unknown) => {
        console.error(error);
        props.onStatusUpdate('Error: Failed to load /models/kiritan.vrm. Please check models/README_MODEL_PLACEMENT.md.');
      }
    );

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    // (0.2) No mousemove listener — cursor-follow gaze was removed by design.

    const clock = new THREE.Clock();
    // Stage C: fire-and-forget kiritanState sync to Companion, gated on the
    // director's own mode-change/heartbeat cadence (see kiritanPoster.ts).
    // A missing/offline Companion has zero effect on the wallpaper.
    const kiritanPoster = new KiritanPoster();
    let frameCount = 0;
    let lastFpsTime = 0;
    let timeAccumulator = 0;
    let animationFrameId: number;

    // Reused scratch objects for the external-clip blend (avoid per-frame allocs).
    const _extClipQ = new THREE.Quaternion();
    const _extBaseQ = new THREE.Quaternion();
    const _extOffsetQ = new THREE.Quaternion();
    const _extEuler = new THREE.Euler();
    const _hipsPos = new THREE.Vector3();

    // Runtime end-effector pinning for keyboard work. Targets live in world
    // space because the keyboard is a scene prop, not part of the character
    // hierarchy. Only upper/lower arms are corrected; hand/finger rotations
    // remain authored by the motion clip.
    let workHandPinGroup: WorkHandPinPolicy['group'] | null = null;
    let hasLeftHandTarget = false;
    let hasRightHandTarget = false;
    const leftHandTarget = new THREE.Vector3();
    const rightHandTarget = new THREE.Vector3();
    const keyboardSlideAxis = new THREE.Vector3();
    let hasKeyboardSlideAxis = false;
    let leftKeyboardSlide = 0;
    let rightKeyboardSlide = 0;
    const _ikEffectorPos = new THREE.Vector3();
    const _ikJointPos = new THREE.Vector3();
    const _ikCurrentDir = new THREE.Vector3();
    const _ikTargetDir = new THREE.Vector3();
    const _ikWorldTarget = new THREE.Vector3();
    const _ikJointWorldQ = new THREE.Quaternion();
    const _ikParentWorldQ = new THREE.Quaternion();
    const _ikDeltaQ = new THREE.Quaternion();
    const _ikNewWorldQ = new THREE.Quaternion();
    const _ikIdentityQ = new THREE.Quaternion();

    const clearWorkHandPins = () => {
      workHandPinGroup = null;
      hasLeftHandTarget = false;
      hasRightHandTarget = false;
      hasKeyboardSlideAxis = false;
      leftKeyboardSlide = 0;
      rightKeyboardSlide = 0;
    };

    const smoothStep01 = (v: number) => {
      const t = THREE.MathUtils.clamp(v, 0, 1);
      return t * t * (3 - 2 * t);
    };

    const heldPulse = (
      t: number,
      start: number,
      arrive: number,
      leave: number,
      end: number,
    ) => {
      if (t <= start || t >= end) return 0;
      if (t < arrive) return smoothStep01((t - start) / (arrive - start));
      if (t <= leave) return 1;
      return 1 - smoothStep01((t - leave) / (end - leave));
    };

    const sampleKeyboardSlide = (
      clipName: string | undefined,
      clipTime: number,
      side: 'left' | 'right',
    ) => {
      if (clipName !== 'dsl_loop_work_normal') return 0;
      // Two restrained key-region changes per 16 s loop. The asymmetric
      // distances keep the hands from reading as a rigid pair translation.
      const towardRight = heldPulse(clipTime, 3.2, 4.0, 5.2, 6.0);
      const towardLeft = heldPulse(clipTime, 10.0, 10.8, 12.2, 13.1);
      if (side === 'left') return towardRight * 0.045 - towardLeft * 0.034;
      return towardRight * 0.034 - towardLeft * 0.05;
    };

    const rotateArmJointToward = (
      joint: THREE.Object3D,
      effector: THREE.Object3D,
      target: THREE.Vector3,
    ) => {
      effector.getWorldPosition(_ikEffectorPos);
      joint.getWorldPosition(_ikJointPos);
      _ikCurrentDir.copy(_ikEffectorPos).sub(_ikJointPos);
      _ikTargetDir.copy(target).sub(_ikJointPos);
      if (_ikCurrentDir.lengthSq() < 1e-10 || _ikTargetDir.lengthSq() < 1e-10) return;

      _ikCurrentDir.normalize();
      _ikTargetDir.normalize();
      _ikDeltaQ.setFromUnitVectors(_ikCurrentDir, _ikTargetDir);

      // Bound one CCD correction so a bad/temporarily unreachable target can
      // never snap the arm. Four small iterations are ample for breathing drift.
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(_ikDeltaQ.w, -1, 1));
      const maxStep = 0.12;
      if (angle > maxStep) {
        _ikDeltaQ.slerpQuaternions(_ikIdentityQ, _ikDeltaQ, maxStep / angle);
      }

      joint.getWorldQuaternion(_ikJointWorldQ);
      _ikNewWorldQ.copy(_ikDeltaQ).multiply(_ikJointWorldQ);
      if (joint.parent) {
        joint.parent.getWorldQuaternion(_ikParentWorldQ).invert();
        joint.quaternion.copy(_ikParentWorldQ).multiply(_ikNewWorldQ).normalize();
      } else {
        joint.quaternion.copy(_ikNewWorldQ).normalize();
      }
    };

    const pinArmToTarget = (
      humanoid: NonNullable<VRM['humanoid']>,
      side: 'left' | 'right',
      target: THREE.Vector3,
    ) => {
      const upperArm = humanoid.getNormalizedBoneNode(`${side}UpperArm` as never);
      const lowerArm = humanoid.getNormalizedBoneNode(`${side}LowerArm` as never);
      const hand = humanoid.getNormalizedBoneNode(`${side}Hand` as never);
      if (!upperArm || !lowerArm || !hand) return;

      // CCD order: wrist-side joint first, then shoulder-side joint.
      for (let i = 0; i < 4; i++) {
        vrmRef.current?.scene.updateMatrixWorld(true);
        rotateArmJointToward(lowerArm, hand, target);
        vrmRef.current?.scene.updateMatrixWorld(true);
        rotateArmJointToward(upperArm, hand, target);
      }
    };

    const applyWorkHandPins = (
      vrm: VRM,
      policy: WorkHandPinPolicy | null,
      weight: number,
      clipName: string | undefined,
      clipTime: number,
      delta: number,
    ) => {
      const humanoid = vrm.humanoid;
      if (!humanoid || !policy) {
        clearWorkHandPins();
        return;
      }

      // Capture only after the work clip has essentially reached its authored
      // contact pose. Targets survive swaps within the keyboard-work group.
      if (workHandPinGroup !== policy.group) {
        clearWorkHandPins();
        if (weight < 0.98) return;
        workHandPinGroup = policy.group;
      }

      vrm.scene.updateMatrixWorld(true);
      const leftHand = humanoid.getNormalizedBoneNode('leftHand' as never);
      const rightHand = humanoid.getNormalizedBoneNode('rightHand' as never);
      if (policy.left && !hasLeftHandTarget && leftHand) {
        leftHand.getWorldPosition(leftHandTarget);
        hasLeftHandTarget = true;
      }
      if (policy.right && !hasRightHandTarget && rightHand) {
        rightHand.getWorldPosition(rightHandTarget);
        hasRightHandTarget = true;
      }
      if (!hasKeyboardSlideAxis && hasLeftHandTarget && hasRightHandTarget) {
        keyboardSlideAxis.copy(rightHandTarget).sub(leftHandTarget);
        if (keyboardSlideAxis.lengthSq() > 1e-8) {
          keyboardSlideAxis.normalize();
          hasKeyboardSlideAxis = true;
        }
      }

      // Ease the authored key-region targets so clip swaps never jerk the
      // wrists back to center. Ambient clips naturally settle the slide to 0.
      const slideK = 1 - Math.exp(-7 * Math.max(0, delta));
      leftKeyboardSlide += (
        sampleKeyboardSlide(clipName, clipTime, 'left') - leftKeyboardSlide
      ) * slideK;
      rightKeyboardSlide += (
        sampleKeyboardSlide(clipName, clipTime, 'right') - rightKeyboardSlide
      ) * slideK;

      if (policy.left && hasLeftHandTarget) {
        _ikWorldTarget.copy(leftHandTarget);
        if (hasKeyboardSlideAxis) {
          _ikWorldTarget.addScaledVector(keyboardSlideAxis, leftKeyboardSlide);
        }
        pinArmToTarget(humanoid, 'left', _ikWorldTarget);
      }
      if (policy.right && hasRightHandTarget) {
        _ikWorldTarget.copy(rightHandTarget);
        if (hasKeyboardSlideAxis) {
          _ikWorldTarget.addScaledVector(keyboardSlideAxis, rightKeyboardSlide);
        }
        pinArmToTarget(humanoid, 'right', _ikWorldTarget);
      }
      vrm.scene.updateMatrixWorld(true);
    };

    // Sample an animated hips trajectory (INF-3) at clip-local time. The source
    // curve is dense (SAMPLE_FPS) and already eased, so linear interpolation
    // between samples is faithful. Oneshot transitions clamp at the ends.
    const sampleHipsCurve = (
      curve: { times: number[]; values: [number, number, number][] },
      t: number,
    ): [number, number, number] => {
      const { times, values } = curve;
      const n = times.length;
      if (t <= times[0]) return values[0];
      if (t >= times[n - 1]) return values[n - 1];
      for (let i = 1; i < n; i++) {
        if (t <= times[i]) {
          const a = times[i - 1];
          const k = (t - a) / (times[i] - a);
          const va = values[i - 1];
          const vb = values[i];
          return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k];
        }
      }
      return values[n - 1];
    };

    // Sample a root-motion trajectory (INF-7) [x,y,z, rotY] at clip-local time.
    // Same dense/eased contract as sampleHipsCurve.
    const sampleRootCurve = (
      curve: { times: number[]; values: [number, number, number, number][] },
      t: number,
    ): [number, number, number, number] => {
      const { times, values } = curve;
      const n = times.length;
      if (t <= times[0]) return values[0];
      if (t >= times[n - 1]) return values[n - 1];
      for (let i = 1; i < n; i++) {
        if (t <= times[i]) {
          const a = times[i - 1];
          const k = (t - a) / (times[i] - a);
          const va = values[i - 1];
          const vb = values[i];
          return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k, va[3] + (vb[3] - va[3]) * k];
        }
      }
      return values[n - 1];
    };

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();

      // Motion Lab (0.7): while frozen, the Lab owns the pose + rendering
      // (deterministic scrub/captures). Keep the rAF alive and keep consuming
      // the clock so thawing doesn't deliver a giant delta to the idle layer.
      // Pose Composer (0.8): same yield while a hand-authoring session is active.
      if (labRef.current?.isFrozen() || poseComposerRef.current?.isActive()) return;

      timeAccumulator += delta;

      const currentProps = propsRef.current;

      // 30 FPS throttle
      const targetDelta = currentProps.fpsLimit ? 1 / 30 : 1 / 60; // 60 is effectively uncapped here
      if (currentProps.fpsLimit && timeAccumulator < targetDelta) {
        return;
      }
      
      const updateDelta = timeAccumulator;
      timeAccumulator = 0;

      // FPS tracking
      frameCount++;
      const now = clock.elapsedTime;
      if (now - lastFpsTime >= 1.0) {
        currentProps.onFpsUpdate(Math.round(frameCount / (now - lastFpsTime)));
        frameCount = 0;
        lastFpsTime = now;
      }

      // Scene Layout (0.6): drive prop containers + character from the calibration
      // state every frame, so live edits and a scene-reload reseed are reflected
      // immediately. No-op until App seeds layoutTransforms (after the first scene
      // load), so until then props keep the transforms propLoader applied.
      const lt = currentProps.layoutTransforms;
      if (lt) {
        const containers = propContainersRef.current;
        for (const id of ['desk', 'chair', 'laptop'] as const) {
          const t = lt[id];
          const obj = containers[id];
          if (t && obj) {
            obj.position.set(t.position[0], t.position[1], t.position[2]);
            obj.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
            obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
          }
        }
        // (Character root transform is written below, in the vrm block, so it can
        // compose the layout base with the active clip's root motion + Director
        // root in one absolute write — see "Character root transform".)
      }

      // Prop Layout 1.0: drive the small-item containers from itemLayout (keyed
      // `item:<id>`), the same per-frame contract as desk/chair/laptop above so
      // live nudges + a scene-reload reseed show immediately. Empty map = no-op.
      {
        const il = currentProps.itemLayout;
        const itemContainers = itemContainersRef.current;
        for (const id in itemContainers) {
          const t = il[id];
          const obj = itemContainers[id];
          if (t && obj) {
            obj.position.set(t.position[0], t.position[1], t.position[2]);
            obj.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
            obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
          }
        }
      }

      if (vrmRef.current) {
        const vrm = vrmRef.current;

        // Camera Update
        if (currentProps.cameraMode !== 'free') {
          controls.enabled = false;
          const preset = CAMERA_PRESETS[currentProps.cameraMode];
          const targetCamPos = new THREE.Vector3(...preset.pos);
          const targetCamLook = new THREE.Vector3(...preset.look);

          camera.position.lerp(targetCamPos, 5.0 * updateDelta);
          
          // We need to lerp the lookAt target as well
          // But simply looking at the lerped target is fine
          if (!camera.userData.target) camera.userData.target = new THREE.Vector3(0, 1, 0);
          camera.userData.target.lerp(targetCamLook, 5.0 * updateDelta);
          camera.lookAt(camera.userData.target);
          
          // Keep controls target synced so switching to 'free' is seamless
          controls.target.copy(camera.userData.target);
        } else {
          controls.enabled = true;
          controls.update(); // required for damping
        }

        // Scene Layout (0.6): the camera look target is controls.target in free
        // mode, else the lerped preset target. Guides follow the live objects.
        const camLook =
          currentProps.cameraMode === 'free'
            ? controls.target
            : ((camera.userData.target as THREE.Vector3 | undefined) ?? controls.target);
        guidesRef.current?.update(camLook);

        // 1. Tick the procedural idle machine + external-motion controller +
        //    expression preset overlay. Always tick all three so crossfades /
        //    auto-idle / preset fades advance even when gated.
        const machine = idleMachineRef.current;
        const idleOut = machine.update(updateDelta);
        const extCtrl = extControllerRef.current;
        const ext = extCtrl.update(updateDelta);
        const presetOut = exprOverlayRef.current.update(updateDelta);

        // 1a'. Deferred clip swap (0.7.2): land the pending swap on the frame
        //      the envelope reaches 0 — the hard bone reset inside switchClip
        //      is invisible at weight 0 and the spring bones see no teleport.
        if (pendingSwapRef.current && ext.blend <= 1e-4) {
          const req = pendingSwapRef.current;
          pendingSwapRef.current = null;
          executeClipSwap(req);
        }

        // 1a-dir. Director (INF-5): advance the FSM + ambient scheduler in real
        //         time and execute its play actions through the same swap path.
        //         Ambient end is handled by the mixer 'finished' listener.
        const director = directorRef.current;
        if (director) {
          // Stage C: report mode/presence/sleepiness to Companion. The poster's
          // own cadence gate (mode-change or ~30s heartbeat) decides whether
          // this frame actually sends anything.
          kiritanPoster.maybePost(director.snapshot(), { nowMs: Date.now(), ambient: null, away: null });
          // Tick the FSM/scheduler during normal play AND while hidden (so the
          // away dwell still expires and a return target is chosen) — but NOT
          // mid leave/return, where the host orchestrator owns the clips (else a
          // suppressed scheduler ambient would strand the runner in 'ambient').
          const a = awayRef.current;
          if (!a.active || a.stage === 'hidden') {
            const now = new Date();
            const hour = now.getHours() + now.getMinutes() / 60;
            const action = director.tick(updateDelta, hour);
            // Detect away_room entry/exit edges → drive the leave/return walk.
            const mode = director.status().mode;
            const prev = prevDirModeRef.current;
            if (prev !== null && mode !== prev) {
              if (mode === 'away_room') startAwayLeave();
              else if (prev === 'away_room') startAwayReturn(mode);
            }
            prevDirModeRef.current = mode;
            if (!awayRef.current.active && action) playDirectorMotion(action.motionId);
          }
        }
        // Away locomotion phase machine (drives its own clips/root/visibility).
        tickAway(updateDelta);

        // 1a. External clip layer. Compose order "A": the external clip is the
        //     BASE pose, the procedural idle is an ADDITIVE offset on top. Advance
        //     the AnimationMixer first so its bones hold the clip pose (clipQ)
        //     before we read + blend them below.
        const action = actionRef.current;
        const mixer = mixerRef.current;
        let clipActive = false;
        if (action && mixer) {
          action.loop = ext.loop ? THREE.LoopRepeat : THREE.LoopOnce;
          action.clampWhenFinished = true;
          if (extCtrl.consumeRestart()) {
            action.reset();
            action.play();
          }
          if (extCtrl.isActive()) {
            // Advance only while playing; after a stop / oneshot end the action
            // holds its pose (clampWhenFinished) and melts out via the envelope.
            // (Unpausing a finished LoopOnce action would also re-fire the
            // mixer 'finished' event every frame.)
            action.paused = !extCtrl.isPlaying();
            // Restore pure clip rotations, let the mixer write the bones it
            // considers changed, then re-capture. See clipPoseRef — without
            // this, write-skipped frames feed our composed pose back into the
            // blend and the idle offset accumulates.
            for (const { node, q } of clipPoseRef.current.values()) node.quaternion.copy(q);
            mixer.update(updateDelta);
            for (const { node, q } of clipPoseRef.current.values()) q.copy(node.quaternion);
            clipActive = ext.weight > 0;
          } else {
            action.paused = true;
          }
        }
        const workHandPinPolicy = getWorkHandPinPolicy(
          clipActive ? action?.getClip().name : undefined,
        );

        // 1a''. Motion face channel (0.2): sample the DSL clip's exprCues /
        //       expressions / gaze at clip-local time. Applied below scaled by
        //       ext.weight, so the face fades in/out exactly with the clip.
        let motionFace: FaceSample | null = null;
        if (clipActive && clipFaceRef.current && action) {
          motionFace = sampleFaceTimeline(clipFaceRef.current, action.time);
        }

        // 1a'''. Prop microEvents (INF-4): fire timed attach/detach at clip-local
        //        time while the clip advances. Each event fires once, in order; a
        //        loop wrap (time runs backwards) re-arms them. Any prop still held
        //        when the clip swaps out is force-returned in executeClipSwap.
        if (clipMicroEventsRef.current && action && extCtrl.isPlaying()) {
          const events = clipMicroEventsRef.current;
          for (const i of advanceMicroEvents(events, action.time, microCursorRef.current)) {
            runMicroEvent(events[i]);
          }
        }

        // 1b. Compose bones. For each idle bone: base = slerp(initQ, clipQ, weight)
        //     when the clip drives it (else the cached rest), then ride the idle
        //     breath/sway additively (base * offsetQ). Both endpoints are pure
        //     functions of time, so there is zero accumulation / drift.
        if (vrm.humanoid) {
          const cache = initialRotationsRef.current;
          const clipSet = clipBoneSetRef.current;
          const w = ext.weight;

          for (const boneName of IDLE_APPLY_BONES) {
            const initQ = cache.get(boneName);
            const node = vrm.humanoid.getNormalizedBoneNode(boneName as never);
            if (!initQ || !node) continue;
            const pure = clipActive && clipSet.has(boneName) ? clipPoseRef.current.get(boneName) : undefined;
            if (pure) {
              _extClipQ.copy(pure.q); // PURE clip rotation (cache invariant — never our own write)
              _extBaseQ.copy(initQ).slerp(_extClipQ, w);
            } else {
              _extBaseQ.copy(initQ);
            }
            if (currentProps.idleMotion) {
              const e = idleOut.bones[boneName];
              // Work clips retain a subtle living motion, but suppress the
              // large global idle sway that otherwise moves both shoulders and
              // hands through the torso hierarchy. The IK below removes the
              // remaining end-effector drift.
              const workIdleScale = workHandPinPolicy
                ? (boneName === 'head' || boneName === 'neck' ? 0.38 : 0.28)
                : 1;
              _extOffsetQ.setFromEuler(_extEuler.set(
                e.x * workIdleScale,
                e.y * workIdleScale,
                e.z * workIdleScale,
              ));
              node.quaternion.copy(_extBaseQ).multiply(_extOffsetQ);
            } else {
              node.quaternion.copy(_extBaseQ);
            }
          }

          // Clip-only bones (outside the idle set; e.g. a .vrma's arms/hips/legs):
          // slerp rest->clip by weight, or hold the cached rest when not active
          // (so arms return to the drop pose, never a T-pose).
          for (const boneName of clipBoneNamesRef.current) {
            if (IDLE_BONE_SET.has(boneName)) continue;
            const initQ = cache.get(boneName);
            const node = vrm.humanoid.getNormalizedBoneNode(boneName as never);
            if (!initQ || !node) continue;
            const pure = clipActive ? clipPoseRef.current.get(boneName) : undefined;
            if (pure) {
              _extClipQ.copy(pure.q); // PURE clip rotation (cache invariant)
              node.quaternion.copy(initQ).slerp(_extClipQ, w);
            } else {
              node.quaternion.copy(initQ);
            }
          }

          // Hips POSITION for a seated DSL posture (試験B). A rotations-only
          // clip never writes hips.position, so this is the sole writer:
          // hips = rest + offset * weight, fading in/out exactly with the clip
          // bone blend. When no seated offset is active, hold the rest position.
          const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as never);
          const hipsRest = initialHipsPosRef.current;
          if (hipsNode && hipsRest) {
            // Prefer the animated trajectory (stand/sit/step) sampled at clip
            // time; else the constant posture offset. Both scale by weight.
            let ho: [number, number, number] | null = null;
            if (clipActive) {
              const curve = clipHipsCurveRef.current;
              ho = curve && action ? sampleHipsCurve(curve, action.time) : clipHipsOffsetRef.current;
            }
            if (ho) {
              _hipsPos.set(hipsRest.x + ho[0] * w, hipsRest.y + ho[1] * w, hipsRest.z + ho[2] * w);
              hipsNode.position.copy(_hipsPos);
            } else {
              hipsNode.position.copy(hipsRest);
            }
          }

          // Character root transform (INF-7): ONE absolute write composing the
          // layout base (or identity), the persistent Director root (away/return
          // walk advance + off-screen placement, survives clip swaps), and the
          // active clip's root motion (sampled at clip time, scaled by weight).
          // Absolute every frame → FPS/pause never accumulate drift. rotation.y
          // folds in the model's baseline +Z facing (Math.PI, set at load).
          {
            const ctp = currentProps.layoutTransforms?.character;
            const dr = directorRootRef.current;
            let rx = 0, ry = 0, rz = 0, rRotY = 0;
            if (clipActive && clipRootCurveRef.current && action) {
              const r = sampleRootCurve(clipRootCurveRef.current, action.time);
              rx = r[0] * w; ry = r[1] * w; rz = r[2] * w; rRotY = r[3] * w;
            }
            const bp = ctp ? ctp.position : ([0, 0, 0] as const);
            const brot = ctp ? ctp.rotation : ([0, 0, 0] as const);
            const bsc = ctp ? ctp.scale : ([1, 1, 1] as const);
            vrm.scene.position.set(bp[0] + dr[0] + rx, bp[1] + dr[1] + ry, bp[2] + dr[2] + rz);
            vrm.scene.rotation.set(brot[0], Math.PI + brot[1] + dr[3] + rRotY, brot[2]);
            vrm.scene.scale.set(bsc[0], bsc[1], bsc[2]);
          }
        }

        // Report idle + external state back to the UI (throttled, ~8Hz).
        idleDebugTimerRef.current += updateDelta;
        if (idleDebugTimerRef.current >= 0.12) {
          idleDebugTimerRef.current = 0;
          currentProps.onIdleDebug(machine.getDebug());
          currentProps.onExternalDebug(extCtrl.getDebug());
          currentProps.onExpressionPresetDebug(presetOut.debug);
          // Scene Layout (0.6): report the live camera pose (rounded, to avoid
          // jittery re-renders) for the HUD + JSON export.
          const rc = (n: number) => Math.round(n * 1000) / 1000;
          currentProps.onCameraReadback({
            position: [rc(camera.position.x), rc(camera.position.y), rc(camera.position.z)],
            target: [rc(camLook.x), rc(camLook.y), rc(camLook.z)],
            fov: camera.fov,
          });
        }

        // 1c. Keep keyboard hand positions fixed in world space. This runs
        // after torso/root composition and before normalized -> raw transfer,
        // allowing the elbows and upper arms to absorb the residual breathing.
        applyWorkHandPins(
          vrm,
          workHandPinPolicy,
          ext.weight,
          action?.getClip().name,
          action?.time ?? 0,
          updateDelta,
        );

        // 2. Apply NormalizedBone rotations to RawBones
        vrm.humanoid?.update();

        // 3. Gaze update (0.2 — no cursor follow). Compose, weakest first:
        //    wander pattern (damped by idle state × preset hints) → idle-state
        //    fixed gaze → debug-UI preset gaze → the motion's gaze (track or
        //    cue hint, already prioritized inside sampleFaceTimeline) — the
        //    motion layer is scaled by ext.weight so eyes hand over smoothly.
        if (currentProps.lookAtEnabled && vrm.lookAt) {
          const resolveCameraDir = () =>
            offsetToGazeDir(camera.position.x, camera.position.y - GAZE_ANCHOR_Y, camera.position.z);
          const motionFix =
            motionFace?.gaze ? gazeStateToFix(motionFace.gaze, resolveCameraDir, ext.weight) : undefined;
          const motionWander = motionFace ? 1 + (motionFace.gazeWander - 1) * ext.weight : 1;
          const gazeDir = gazeCtrlRef.current.update(updateDelta, {
            idleWander: currentProps.idleMotion ? idleOut.lookAtStrength : 1,
            idleFix: currentProps.idleMotion ? idleOut.gaze : undefined,
            exprWander: presetOut.gazeWander * motionWander,
            overlayFix: presetOut.gazeFix,
            motionFix,
          });
          const p = gazeDirToPanelPoint(gazeDir);
          // Exponential approach — turns wander saccade jumps into quick darts.
          const k = Math.min(1, 8.0 * updateDelta);
          lookAtTargetRef.current.position.x += (p.x - lookAtTargetRef.current.position.x) * k;
          lookAtTargetRef.current.position.y += (p.y - lookAtTargetRef.current.position.y) * k;
          lookAtTargetRef.current.position.z = p.z;
        } else {
          lookAtTargetRef.current.position.set(0, GAZE_ANCHOR_Y, 1.0);
        }

        // Apply LookAt rotations to raw bones
        if (currentProps.lookAtEnabled) {
          vrm.lookAt?.update(updateDelta);
        } else {
          // If disabled, eye bones will remain as humanoid.update() left them (initial state)
        }

        // 4. Expression (BlendShape) update via Custom Expression Bridge.
        //    See the load callback for why vrm.expressionManager is bypassed.
        const faceMeshes = faceMeshesRef.current;
        if (faceMeshes.length > 0) {
          const expressionMap = expressionMapRef.current;
          const reqExp = currentProps.currentExpression.toLowerCase();
          const activeBinds = expressionMap[reqExp] || [];

          // Advance the auto-blink state machine once per frame and resolve weight.
          let blinkValue = 0;
          if (currentProps.autoBlink) {
            const blinkState = blinkStateRef.current;
            blinkState.time += updateDelta;

            if (blinkState.phase === 'open' && blinkState.time > blinkState.nextBlink) {
              blinkState.phase = 'closing';
              blinkState.time = 0;
            } else if (blinkState.phase === 'closing') {
              blinkValue = blinkState.time / 0.05;
              if (blinkState.time > 0.05) { blinkState.phase = 'closed'; blinkState.time = 0; blinkValue = 1; }
            } else if (blinkState.phase === 'closed') {
              blinkValue = 1;
              if (blinkState.time > 0.05) { blinkState.phase = 'opening'; blinkState.time = 0; }
            } else if (blinkState.phase === 'opening') {
              blinkValue = 1.0 - (blinkState.time / 0.1);
              if (blinkState.time > 0.1) {
                blinkState.phase = 'open';
                blinkState.time = 0;
                blinkState.nextBlink = 2.0 + Math.random() * 5.0; // 2 to 7 seconds
                blinkValue = 0;
              }
            }
          }
          const blinkBinds = expressionMap['blink'] || [];

          // The idle state can add a half-lid (sleepy); max-blend it with the
          // auto-blink so whichever closes the eyes more wins.
          const effectiveBlink = Math.max(blinkValue, currentProps.idleMotion ? idleOut.extraBlink : 0);

          for (const mesh of faceMeshes) {
            const influences = mesh.morphTargetInfluences!;

            // Reset all influences to 0
            for (let i = 0; i < influences.length; i++) influences[i] = 0;

            // Apply the requested expression at its authored weights
            for (const { index, weight } of activeBinds) {
              if (index < influences.length) influences[index] = weight;
            }

            // Idle "mood" overlay (e.g. a hint of fun/sorrow). Max-blended over
            // the manual expression so it never overrides an explicit choice.
            if (currentProps.idleMotion) {
              for (const exprName in idleOut.expr) {
                const w = idleOut.expr[exprName] ?? 0;
                if (w <= 0) continue;
                const binds = expressionMap[exprName];
                if (!binds) continue;
                for (const { index, weight } of binds) {
                  if (index < influences.length) influences[index] = Math.max(influences[index], weight * w);
                }
              }
            }

            // Expression preset overlay (0.1). Same max-blend contract as the
            // idle overlay; weights already carry intensity x fade envelope.
            // Its eyelid channel arrives flattened onto 'blink', so the binds
            // below max naturally with auto-blink ("more closed wins").
            for (const exprName in presetOut.weights) {
              const w = presetOut.weights[exprName];
              if (w <= 0) continue;
              const binds = expressionMap[exprName];
              if (!binds) continue;
              for (const { index, weight } of binds) {
                if (index < influences.length) influences[index] = Math.max(influences[index], weight * w);
              }
            }

            // Motion face channel (0.2): the playing DSL clip's exprCues +
            // raw expression keys, scaled by the clip weight so the face
            // rides the same fade envelope as the bones. Max-blend as usual.
            if (motionFace) {
              for (const exprName in motionFace.expressions) {
                const w = motionFace.expressions[exprName] * ext.weight;
                if (w <= 0) continue;
                const binds = expressionMap[exprName.toLowerCase()];
                if (!binds) continue;
                for (const { index, weight } of binds) {
                  if (index < influences.length) influences[index] = Math.max(influences[index], weight * w);
                }
              }
            }

            // Overlay blink/half-lid (max-blend so it coexists with the expression)
            if (effectiveBlink > 0) {
              for (const { index } of blinkBinds) {
                if (index < influences.length) influences[index] = Math.max(influences[index], effectiveBlink);
              }
            }
          }
        }

        // 5. Update SpringBones
        if (currentProps.springBoneMode === 'normal') {
          vrm.springBoneManager?.update(updateDelta);
        } else if (currentProps.springBoneMode === 'lightweight') {
          // Update less frequently (e.g. every 2 frames)
          sbTimeRef.current += updateDelta;
          if (sbTimeRef.current > 1/15) { // 15fps for springbones
             vrm.springBoneManager?.update(sbTimeRef.current);
             sbTimeRef.current = 0;
          }
        } else if (currentProps.springBoneMode === 'off') {
          // do not update
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      autoStartCancelled = true;
      if (directorRef.current) stopDirector();
      removeReviewPanel?.();
      if (labRef.current) {
        labRef.current = null;
        delete window.__motionLab;
      }
      if (poseComposerRef.current) {
        poseComposerRef.current = null;
        delete window.__poseComposer;
      }
      controls.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once setup; reads refs and must not re-init three.js on prop changes
  }, []); // Run once on mount

  // Camera preset updater
  useEffect(() => {
    // We don't have direct access to camera from outside the mount effect,
    // so we store it on the canvas element or use a ref. Let's just modify the camera inside the effect above?
    // Actually, it's easier to just pass props and read them inside the render loop,
    // but camera pos is stateful. We can just set it continuously in the render loop or via a ref.
  }, [props.cameraMode]);

  // Scene / Props (0.4): (re)load the scene on mount, on a scene switch, and on
  // an explicit Reload Scene (sceneReloadSeq bump). Declared AFTER the mount
  // effect, so it runs after the loader + propsRoot are created. loadSceneProps
  // clears propsRoot first, so this is the "scene changed -> clear + reload" path.
  //
  // Prop Variants 0.8: also reload when the selection changes, and once when the
  // async registry arrives while a stored non-basic selection is waiting (the
  // all-basic case skips that extra reload — the result would be identical).
  // Prop Library 0.9: same deal — reload on an item toggle, and once when the
  // library arrives (so default-on items appear without needing a manual reload).
  const variantKey = JSON.stringify(props.variantSelection);
  const variantsArmed =
    props.variantRegistry !== null &&
    Object.values(props.variantSelection).some((v) => v && v !== BASIC_VARIANT_ID);
  const itemKey = JSON.stringify(props.itemSelection);
  const libraryReady = props.propLibrary !== null;
  useEffect(() => {
    loadSceneAndProps(props.sceneId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sceneId, props.sceneReloadSeq, variantKey, variantsArmed, itemKey, libraryReady]);

  // Props / Placeholders toggles only flip visibility (no GLB refetch). Safe on
  // an empty propsRoot before the first load completes (load re-applies after).
  useEffect(() => {
    applyPropVisibility(propsRootRef.current, {
      propsEnabled: props.propsEnabled,
      placeholdersEnabled: props.placeholdersEnabled,
    });
  }, [props.propsEnabled, props.placeholdersEnabled]);

  // Scene Layout (0.6): toggle the guides group and recolor the selected box.
  useEffect(() => {
    guidesRef.current?.setVisible(props.guidesEnabled);
  }, [props.guidesEnabled]);
  useEffect(() => {
    guidesRef.current?.setSelected(props.selectedTarget);
  }, [props.selectedTarget]);

  // Scene Layout (0.6): apply a camera nudge (pan + dolly). Only meaningful in
  // free mode — in a preset mode the per-frame lerp would immediately override
  // it, so we no-op there (App switches to free before nudging the camera).
  useEffect(() => {
    if (props.cameraNudge.seq === 0) return;
    if (propsRef.current.cameraMode !== 'free') return;
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;
    const { dx, dy, dz, dolly } = props.cameraNudge;
    // Pan: shift both eye and target so the framing translates.
    cam.position.x += dx;
    cam.position.y += dy;
    cam.position.z += dz;
    controls.target.x += dx;
    controls.target.y += dy;
    controls.target.z += dz;
    // Dolly: move the eye toward / away from the target along the view ray.
    if (dolly !== 0) {
      const dir = new THREE.Vector3().subVectors(controls.target, cam.position);
      const len = dir.length();
      if (len > 1e-4) cam.position.addScaledVector(dir.multiplyScalar(1 / len), dolly);
    }
    controls.update();
  }, [props.cameraNudge]);

  return <canvas ref={canvasRef} className="canvas-container" />;
};

export default VrmViewer;
