import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// @ts-ignore
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
// Scene Layout Calibration (Motion Probe 0.6)
import { toTransformEntry } from './lib/scene/layoutCalibration';
import type { LayoutTransforms, LayoutTargetId, CameraEntry, PropTargetId } from './lib/scene/layoutCalibration';
import { createLayoutGuides } from './lib/scene/layoutGuides';
import type { LayoutGuides } from './lib/scene/layoutGuides';
// Motion Lab (Motion Probe 0.7): DSL authoring loop on window.__motionLab,
// installed only when the page is opened with ?lab=1 (see mount effect).
import { installMotionLab } from './lib/lab/motionLab';
import type { MotionLab } from './lib/lab/motionLab';

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

// Camera presets, extracted to module scope (0.7) so the animate loop and the
// Motion Lab share ONE table. Values are unchanged from 0.1/0.6.
const CAMERA_PRESETS: Record<Exclude<CameraMode, 'free'>, { pos: [number, number, number]; look: [number, number, number] }> = {
  'desk wide': { pos: [0, 0.8, 1.2], look: [0, 0.8, 0] },
  'face close': { pos: [0, 1.35, 0.5], look: [0, 1.35, 0] },
  'monitor side': { pos: [0.4, 0.9, 0.8], look: [0, 1.0, 0] },
  // Chill-room front: desk edge in the foreground, body + face behind it.
  workdesk_front: { pos: [0.0, 1.05, 1.5], look: [0.0, 1.0, -0.1] },
  // Angled side: laptop/monitor reads as facing the wallpaper.
  workdesk_side: { pos: [0.95, 1.0, 1.05], look: [0.0, 0.95, -0.2] },
  // Close: face + upper body + hands-on-desk, leaving UI margin.
  workdesk_close: { pos: [0.0, 1.15, 0.95], look: [0.0, 1.05, -0.1] },
};

export interface VrmViewerProps {
  cameraMode: CameraMode;
  lookAtEnabled: boolean;
  springBoneMode: SpringBoneMode;
  fpsLimit: boolean;
  currentExpression: string;
  autoBlink: boolean;
  idleMotion: boolean;
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
  // Scene Layout Calibration (Motion Probe 0.6). App owns the calibration state
  // and feeds the current transforms back down; the viewer applies them to the
  // live prop containers / character each frame (no-op when null, i.e. before the
  // first scene load seeds them). selectedTarget + guidesEnabled drive the visual
  // guides. Camera nudges arrive as an {dx,dy,dz,dolly,seq} nonce (free mode only).
  layoutTransforms: LayoutTransforms | null;
  selectedTarget: LayoutTargetId;
  guidesEnabled: boolean;
  cameraNudge: { dx: number; dy: number; dz: number; dolly: number; seq: number };
  onFpsUpdate: (fps: number) => void;
  onStatusUpdate: (status: string) => void;
  onIdleDebug: (debug: IdleDebug) => void;
  onExternalDebug: (debug: ExternalMotionDebug) => void;
  onSceneDebug: (debug: SceneDebug) => void;
  // Initial layout (from the loaded scene preset), reported once per scene
  // (re)load so App can seed/reset its calibration state to scene.json values.
  onLayoutInit: (init: { transforms: LayoutTransforms; camera: CameraEntry }) => void;
  // Live camera pose, reported (throttled) so the HUD + JSON export reflect the
  // actual camera — including orbit-dragging and preset lerps, not just nudges.
  onCameraReadback: (cam: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void;
}

const VrmViewer: React.FC<VrmViewerProps> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const lookAtTargetRef = useRef<THREE.Object3D>(new THREE.Object3D());
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  
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
    extControllerRef.current.setClipInfo({ loaded: true, name: clip.name, source, hasExpressionTracks });
  };

  const useBuiltinClip = () => {
    const vrm = vrmRef.current;
    if (!vrm) return;
    const built = buildProceduralClip(vrm);
    switchClip(built.clip, built.boneNames, built.source, built.hasExpressionTracks);
    console.log(`[EXT] built-in clip active: bones=${built.boneNames.join(',')}`);
    propsRef.current.onStatusUpdate('External clip: built-in look-around');
  };

  const loadVrmaFrom = (url: string, opts?: { label?: string; autoPlay?: boolean }) => {
    const vrm = vrmRef.current;
    if (!vrm) return;
    propsRef.current.onStatusUpdate(`Loading .vrma ${opts?.label ?? url} ...`);
    loadVrmaClip(url, vrm)
      .then((loaded) => {
        switchClip(loaded.clip, loaded.boneNames, loaded.source, loaded.hasExpressionTracks);
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
        if (opts?.autoPlay) extControllerRef.current.play();
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
      useBuiltinClip();
      if (req.play) extControllerRef.current.play();
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
      .then((result) => {
        if (!result.ok) {
          const first = result.errors[0];
          console.warn('[EXT] DSL motion load failed:', result.errors);
          propsRef.current.onStatusUpdate(`Motion "${req.ref}" failed: ${first.path}: ${first.message}`);
          return;
        }
        const compiled = compileDslClip(result.evaluator, vrm);
        switchClip(compiled.clip, compiled.boneNames, 'dsl', false);
        extControllerRef.current.setLoop(result.evaluator.loop);
        if (req.play) extControllerRef.current.play();
        const label = req.label ?? result.doc.motion.label ?? req.ref;
        console.log(
          `[EXT] DSL motion "${req.ref}" compiled: ${compiled.boneNames.length} bones, ${result.evaluator.duration}s` +
            (compiled.missingBones.length ? ` (model lacks: ${compiled.missingBones.join(',')})` : ''),
        );
        propsRef.current.onStatusUpdate(`External clip: ${label} (DSL, ${result.evaluator.duration}s)`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        propsRef.current.onStatusUpdate(`Motion "${req.ref}" failed: ${msg}`);
      });
  };

  const handleExternalAction = (action: ExternalRequestAction) => {
    if (action === 'loadVrma') return loadVrmaFrom(VRMA_SAMPLE_PATH);
    if (action === 'useBuiltin') return useBuiltinClip();
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
  const propLoaderRef = useRef<{ loadAsync(url: string): Promise<{ scene: THREE.Object3D }> } | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);

  // --- Scene Layout Calibration (Motion Probe 0.6) ---
  // Live handles the per-frame layout apply / guides / camera nudge reach into.
  // The camera + controls are created inside the mount effect; these refs expose
  // them to the camera-nudge effect and the readback. propContainers maps a prop
  // id to its wrapping container Group (rebuilt on each scene load) so the
  // calibration state can drive it directly.
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const propContainersRef = useRef<Partial<Record<PropTargetId, THREE.Object3D>>>({});
  const guidesRef = useRef<LayoutGuides | null>(null);

  // --- Motion Lab (Motion Probe 0.7) ---
  // Present only with ?lab=1. While lab.isFrozen() the animate loop yields the
  // pose + render to the Lab (see the freeze gate at the top of animate()).
  const labRef = useRef<MotionLab | null>(null);

  // Apply a scene's lighting block to the existing lights (no-op if absent, so
  // the 0.1 defaults are preserved). Cosmetic only — never touches the rig.
  const applySceneLighting = (lighting?: SceneLighting) => {
    const amb = ambientLightRef.current;
    const dir = directionalLightRef.current;
    if (lighting && amb) amb.intensity = lighting.ambientStrength;
    if (lighting && dir) {
      dir.intensity = lighting.mainLightStrength;
      dir.color.set(lighting.mainLightColor);
    }
  };

  // Fetch a scene preset, (re)load its props into propsRoot, apply lighting +
  // visibility, and report the aggregated status. Never throws / never blocks
  // the render loop — load failures resolve to the built-in default + placeholders.
  const loadSceneAndProps = (sceneId: string) => {
    const parent = propsRootRef.current;
    const loader = propLoaderRef.current;
    if (!loader) return; // mount effect hasn't created the loader yet
    propsRef.current.onStatusUpdate(`Loading scene "${sceneId}" ...`);
    loadScenePreset(sceneId)
      .then(async ({ scene, result }) => {
        applySceneLighting(scene.lighting);
        const opts = {
          propsEnabled: propsRef.current.propsEnabled,
          placeholdersEnabled: propsRef.current.placeholdersEnabled,
        };
        const results = await loadSceneProps(scene.props, parent, loader, opts);

        // Scene Layout (0.6): index the freshly-loaded prop containers by id and
        // rebind the guides' bounding boxes to them. Then seed App's calibration
        // state from the (validated) preset so edits start at scene.json values.
        const containers: Partial<Record<PropTargetId, THREE.Object3D>> = {};
        for (const child of parent.children) {
          const id = (child.userData as { propId?: string }).propId;
          if (id === 'desk' || id === 'chair' || id === 'laptop') containers[id] = child;
        }
        propContainersRef.current = containers;
        guidesRef.current?.setTracked({
          desk: containers.desk ?? null,
          chair: containers.chair ?? null,
          laptop: containers.laptop ?? null,
        });
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

    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    const scene = new THREE.Scene();
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
    if (new URLSearchParams(window.location.search).has('lab')) {
      labRef.current = installMotionLab({
        renderer,
        scene,
        camera,
        cameraPresets: CAMERA_PRESETS,
        getVrm: () => vrmRef.current,
        getRestQuaternions: () => initialRotationsRef.current,
        getFaceMeshes: () => faceMeshesRef.current,
        getExpressionMap: () => expressionMapRef.current,
        lookAtTarget: lookAtTargetRef.current,
        propsRoot: propsRootRef.current,
        switchClip,
        extController: extControllerRef.current,
        onStatus: (s) => propsRef.current.onStatusUpdate(s),
      });
    }

    const loader = new GLTFLoader();
    loader.register((parser: any) => new VRMLoaderPlugin(parser));

    props.onStatusUpdate('Loading VRM...');

    loader.load(
      '/models/kiritan.vrm',
      (gltf: any) => {
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
          const lArm = humanoid.getNormalizedBoneNode('leftUpperArm' as any);
          const rArm = humanoid.getNormalizedBoneNode('rightUpperArm' as any);
          if (lArm) lArm.rotation.z = 1.2;
          if (rArm) rArm.rotation.z = -1.2;

          const bonesToCache = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm']; // upperChest is intentionally omitted
          bonesToCache.forEach(boneName => {
            const node = humanoid.getNormalizedBoneNode(boneName as any);
            if (node) {
              initialRotationsRef.current.set(boneName, node.quaternion.clone());
            }
          });

          // Additionally cache every other humanoid bone's rest/drop pose so an
          // external .vrma clip that drives bones outside the idle set (arms,
          // hips, legs…) can blend in and slerp back home on Return to Idle.
          // Captured AFTER the arm-drop, so arms cache their dropped pose.
          Object.keys((humanoid as unknown as { humanBones: Record<string, unknown> }).humanBones).forEach((boneName) => {
            if (initialRotationsRef.current.has(boneName)) return;
            const node = humanoid.getNormalizedBoneNode(boneName as any);
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
        vrm.scene.traverse((obj: any) => {
          if (obj.isMesh && obj.geometry?.morphAttributes?.position) morphSources.push(obj);
        });
        for (const src of morphSources) {
          const srcPos = src.geometry.attributes.position;
          const siblings = (src.parent?.children ?? []).filter(
            (c: any) => c.isMesh && c.geometry?.attributes?.position === srcPos
          ) as THREE.Mesh[];
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
          const binds = (g.binds ?? []).map((b: any) => ({ index: b.index, weight: (b.weight ?? 100) / 100 }));
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
        expressionMapRef.current = expressionMap;
        console.log(`[DIAG] Expression layers: ${faceMeshes.length}, expressions: ${Object.keys(expressionMap).join(', ')}`);

        // --- External Motion setup (Motion Probe 0.3) ---
        // Bind the mixer to vrm.scene so clip tracks (named `${normalizedNode.
        // name}.quaternion`) resolve to the same normalized nodes the idle layer
        // drives. Arm a built-in code clip so the probe is fully exercisable even
        // with no user .vrma present (External Motion stays OFF until requested).
        mixerRef.current = new THREE.AnimationMixer(vrm.scene);
        const built = buildProceduralClip(vrm);
        switchClip(built.clip, built.boneNames, built.source, built.hasExpressionTracks);
        console.log(`[EXT] mixer ready; built-in clip armed (bones=${built.boneNames.join(',')}). External Motion OFF by default.`);

        props.onStatusUpdate('Loaded: ふらすこ式風きりたん (VRM 0.x)');
      },
      (progress: any) => {
        const pct = Math.round(100.0 * (progress.loaded / progress.total));
        props.onStatusUpdate(`Loading VRM... ${pct}%`);
      },
      (error: any) => {
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

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const clock = new THREE.Clock();
    let frameCount = 0;
    let lastFpsTime = 0;
    let timeAccumulator = 0;
    let animationFrameId: number;

    // Reused scratch objects for the external-clip blend (avoid per-frame allocs).
    const _extClipQ = new THREE.Quaternion();
    const _extBaseQ = new THREE.Quaternion();
    const _extOffsetQ = new THREE.Quaternion();
    const _extEuler = new THREE.Euler();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();

      // Motion Lab (0.7): while frozen, the Lab owns the pose + rendering
      // (deterministic scrub/captures). Keep the rAF alive and keep consuming
      // the clock so thawing doesn't deliver a giant delta to the idle layer.
      if (labRef.current?.isFrozen()) return;

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
        // Character: compose the calibration Y-rotation with the model's baseline
        // +Z facing (vrm.scene.rotation.y = Math.PI, set at load). An identity
        // character block therefore reproduces the pre-0.6 pose exactly.
        const ct = lt.character;
        const vrmScene = vrmRef.current?.scene;
        if (ct && vrmScene) {
          vrmScene.position.set(ct.position[0], ct.position[1], ct.position[2]);
          vrmScene.rotation.set(ct.rotation[0], Math.PI + ct.rotation[1], ct.rotation[2]);
          vrmScene.scale.set(ct.scale[0], ct.scale[1], ct.scale[2]);
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

        // 1. Tick the procedural idle machine + external-motion controller.
        //    Always tick both so crossfades / auto-idle advance even when gated.
        const machine = idleMachineRef.current;
        const idleOut = machine.update(updateDelta);
        const extCtrl = extControllerRef.current;
        const ext = extCtrl.update(updateDelta);

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
            action.paused = false;
            mixer.update(updateDelta); // writes clipQ to the clip-driven bones
            clipActive = ext.weight > 0;
          } else {
            action.paused = true;
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
            const node = vrm.humanoid.getNormalizedBoneNode(boneName as any);
            if (!initQ || !node) continue;
            if (clipActive && clipSet.has(boneName)) {
              _extClipQ.copy(node.quaternion); // clipQ the mixer just wrote
              _extBaseQ.copy(initQ).slerp(_extClipQ, w);
            } else {
              _extBaseQ.copy(initQ);
            }
            if (currentProps.idleMotion) {
              const e = idleOut.bones[boneName];
              _extOffsetQ.setFromEuler(_extEuler.set(e.x, e.y, e.z));
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
            const node = vrm.humanoid.getNormalizedBoneNode(boneName as any);
            if (!initQ || !node) continue;
            if (clipActive) {
              _extClipQ.copy(node.quaternion);
              node.quaternion.copy(initQ).slerp(_extClipQ, w);
            } else {
              node.quaternion.copy(initQ);
            }
          }
        }

        // Report idle + external state back to the UI (throttled, ~8Hz).
        idleDebugTimerRef.current += updateDelta;
        if (idleDebugTimerRef.current >= 0.12) {
          idleDebugTimerRef.current = 0;
          currentProps.onIdleDebug(machine.getDebug());
          currentProps.onExternalDebug(extCtrl.getDebug());
          // Scene Layout (0.6): report the live camera pose (rounded, to avoid
          // jittery re-renders) for the HUD + JSON export.
          const rc = (n: number) => Math.round(n * 1000) / 1000;
          currentProps.onCameraReadback({
            position: [rc(camera.position.x), rc(camera.position.y), rc(camera.position.z)],
            target: [rc(camLook.x), rc(camLook.y), rc(camLook.z)],
            fov: camera.fov,
          });
        }

        // 2. Apply NormalizedBone rotations to RawBones
        vrm.humanoid?.update();

        // 3. LookAt update
        if (currentProps.lookAtEnabled && vrm.lookAt) {
          // Idle states can weaken cursor tracking (e.g. monitor/sleepy) so the
          // procedural head turn and the eyes don't fight each other.
          const s = currentProps.idleMotion ? idleOut.lookAtStrength : 1.0;
          // Lerp target position
          const targetX = mouseRef.current.x * 1.5 * s;
          const targetY = mouseRef.current.y * 1.0 * s + 1.2;
          lookAtTargetRef.current.position.x += (targetX - lookAtTargetRef.current.position.x) * 5.0 * updateDelta;
          lookAtTargetRef.current.position.y += (targetY - lookAtTargetRef.current.position.y) * 5.0 * updateDelta;
          lookAtTargetRef.current.position.z = 1.0;
        } else {
          lookAtTargetRef.current.position.set(0, 1.2, 1.0);
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
      window.removeEventListener('mousemove', handleMouseMove);
      if (labRef.current) {
        labRef.current = null;
        delete window.__motionLab;
      }
      controls.dispose();
      renderer.dispose();
    };
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
  useEffect(() => {
    loadSceneAndProps(props.sceneId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sceneId, props.sceneReloadSeq]);

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
