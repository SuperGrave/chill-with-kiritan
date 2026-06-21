// Motion Lab (Motion Probe 0.7)
//
// The authoring loop for the Motion DSL: load + validate motion JSON, freeze
// the viewer's rAF loop, pose the model at an exact time t (deterministic —
// rAF-independent, so it works in a backgrounded preview tab), settle the
// SpringBones, render one frame, and save a PNG capture to disk through the
// dev-server middleware (`/__lab/save`, see vite.config.ts). Everything is
// exposed on `window.__motionLab` so an agent can drive the whole loop through
// preview_eval / the browser console without any UI.
//
// API contract (agent-friendly):
//   * Every call returns JSON-serializable data and NEVER throws — failures
//     come back as { ok: false, errors: [...] } with actionable messages.
//   * `help()` returns a usage cheat-sheet, so the API is discoverable even
//     without MOTION_AUTHORING_GUIDE.md at hand.
//
// Enabled only when the page is opened with `?lab=1` (see VrmViewer).

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { MotionDoc, ValidationIssue, MicroEvent } from '../motion/dsl/types';
import { loadMotionDoc } from '../motion/dsl/loadMotionDoc';
import type { MotionEvaluator, EvalFrame, MotionFaceTimeline, GazeState } from '../motion/dsl/evaluate';
import { compileDslClip, composeBoneQuaternion } from '../motion/dsl/compileClip';
import type { ExternalMotionController } from '../motion/externalMotionController';
// Expression Preset System 0.2: preset preview/capture loop (exprShow/exprCapture).
import { EXPRESSION_PRESETS, EXPRESSION_PRESET_IDS, getExpressionPreset, flattenPresetWeights } from '../expression/expressionPresets';
import { gazeDirToPanelPoint, offsetToGazeDir, GAZE_ANCHOR_Y } from '../motion/gazeController';
import { attachPropToBone, detachPropToHome, findPropContainer, type GripOffset } from '../scene/propAttach';
import type { DirectorStatus } from '../motion/director/directorRunner';
import type { ModeId } from '../motion/director/types';

// --- handles the viewer passes in -------------------------------------------------

export interface CameraPresetTable {
  [name: string]: { pos: [number, number, number]; look: [number, number, number] };
}

/**
 * A request to make `clip` the active external clip. The viewer defers the
 * actual swap until the crossfade envelope has reached 0 (fading the current
 * clip out first), so bones and spring bones never see a pose teleport.
 */
export interface ClipSwapRequest {
  clip: THREE.AnimationClip;
  boneNames: string[];
  source: 'builtin' | 'vrma' | 'dsl';
  hasExpressionTracks: boolean;
  /** Start playback (crossfade in) once the swap lands. */
  autoPlay: boolean;
  /** Controller loop flag (DSL motions declare it; undefined keeps current). */
  loop?: boolean;
  /** Clip weight ceiling (undefined keeps current). */
  clipWeight?: number;
  /** Crossfade sweep durations (DSL fadeIn/fadeOut; undefined = 0.6s). */
  fadeIn?: number;
  fadeOut?: number;
  /**
   * Face channel of a DSL motion (exprCues / expressions / gaze), sampled by
   * the viewer at clip-local time during playback (0.2). null/undefined = none.
   */
  faceTimeline?: MotionFaceTimeline | null;
  /**
   * Posture hips-position offset (meters, normalized rig) applied to hips.position
   * each frame scaled by clip weight (Phase 0 試験B). DSL postures only; null = none.
   */
  hipsOffset?: [number, number, number] | null;
  /**
   * Animated hips trajectory (INF-3 stand/sit/step) sampled at clip-local time.
   * When present the viewer samples it instead of the constant hipsOffset.
   */
  hipsCurve?: { times: number[]; values: [number, number, number][] } | null;
  /**
   * Sampled root-motion trajectory [x,y,z, rotY] (INF-7) the viewer applies to
   * vrm.scene at clip-local time, scaled by clip weight. null = the character
   * never moves. A looping walk keeps net-zero; the Director drives the advance.
   */
  rootCurve?: { times: number[]; values: [number, number, number, number][] } | null;
  /**
   * Timed prop attach/detach events (INF-4) the viewer fires at clip-local time
   * while this clip plays. Any prop still attached when the clip swaps out is
   * force-returned to its rest. null/undefined = none.
   */
  microEvents?: MicroEvent[] | null;
}

export interface LabHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraPresets: CameraPresetTable;
  getVrm: () => VRM | null;
  /** Cached rest quaternions (captured after the arm drop) — viewer-owned. */
  getRestQuaternions: () => Map<string, THREE.Quaternion>;
  getFaceMeshes: () => THREE.Mesh[];
  getExpressionMap: () => Record<string, { index: number; weight: number }[]>;
  lookAtTarget: THREE.Object3D;
  /** Root group of the scene props (desk/chair/laptop) — hidable for clean captures. */
  propsRoot: THREE.Object3D;
  requestClipSwap: (req: ClipSwapRequest) => void;
  extController: ExternalMotionController;
  onStatus: (status: string) => void;
  /** Director runner control (INF-5) — viewer-owned; null status when not running. */
  startDirector: (opts?: { seed?: number; initialMode?: ModeId }) => Promise<{ ok: boolean; loaded: string[]; error?: string }>;
  stopDirector: () => { ok: boolean };
  getDirectorStatus: () => DirectorStatus | null;
}

// --- result shapes ------------------------------------------------------------------

interface Fail {
  ok: false;
  errors: ValidationIssue[];
  warnings?: ValidationIssue[];
  // Keeps Fail assignable to the loose Record<string, unknown> results the
  // window API returns (everything must be JSON-serializable anyway).
  [key: string]: unknown;
}

interface LoadOk {
  ok: true;
  id: string;
  warnings: ValidationIssue[];
  info: {
    label: string;
    duration: number;
    loop: boolean;
    posture: string | null;
    hands: { left: string | null; right: string | null };
    bones: string[];
    missingBones: string[];
    expressionsUsed: string[];
    cuePresetsUsed: string[];
    gazeKeys: number;
  };
}

type LoadResult = LoadOk | Fail;

interface RegistryEntry {
  doc: MotionDoc;
  evaluator: MotionEvaluator;
  warnings: ValidationIssue[];
}

const fail = (path: string, message: string): Fail => ({ ok: false, errors: [{ path, message }] });

/** Camera option: a preset name or an explicit pose. */
type CameraOpt = string | { position: [number, number, number]; target: [number, number, number]; fov?: number };

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const roundE3 = (e: [number, number, number]) => e.map(round4) as [number, number, number];

// --- the lab ---------------------------------------------------------------------------

export class MotionLab {
  private h: LabHandles;
  private frozen = false;
  private registry = new Map<string, RegistryEntry>();
  private hipsRestPos: THREE.Vector3 | null = null;

  // scratch
  private _q = new THREE.Quaternion();

  constructor(handles: LabHandles) {
    this.h = handles;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  // ---- registry / loading ------------------------------------------------------------

  async load(id: string): Promise<LoadResult> {
    // Shared loader (also used by the App motion selector); the ls() adapter
    // enriches 404s with what actually exists on disk.
    const result = await loadMotionDoc(id, async () => {
      const listed = await this.ls();
      return listed.ok ? listed : null;
    });
    if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };
    const { doc, evaluator, warnings } = result;
    const motion = doc.motion;

    // Bones the model actually lacks (e.g. upperChest on this model).
    const vrm = this.h.getVrm();
    const missingBones = vrm
      ? evaluator.boneNames.filter((b) => !vrm.humanoid?.getNormalizedBoneNode(b as never))
      : [];

    this.registry.set(id, { doc, evaluator, warnings });
    this.h.onStatus(`[LAB] loaded "${id}" (${evaluator.duration}s, ${evaluator.boneNames.length} bones)`);

    const expressionsUsed = [...new Set((motion.expressions?.keys ?? []).flatMap((k) => Object.keys(k.set)))];
    const cuePresetsUsed = [...new Set((motion.exprCues ?? []).map((c) => c.preset))];
    return {
      ok: true,
      id,
      warnings,
      info: {
        label: motion.label ?? id,
        duration: evaluator.duration,
        loop: evaluator.loop,
        posture: motion.posture ?? null,
        hands: { left: motion.hands?.left ?? null, right: motion.hands?.right ?? null },
        bones: evaluator.boneNames,
        missingBones,
        expressionsUsed,
        cuePresetsUsed,
        gazeKeys: (motion.gaze?.keys ?? []).length,
      },
    };
  }

  async ls(): Promise<{ ok: true; motions: string[]; poses: string[]; hands: string[] } | { ok: false; error: string }> {
    try {
      const res = await fetch(`/__lab/ls?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return { ok: false, error: `/__lab/ls returned HTTP ${res.status} — is the vite dev server running with the motion-lab plugin?` };
      return { ok: true, ...(await res.json()) };
    } catch (e) {
      return { ok: false, error: `/__lab/ls failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ---- freeze / restore ---------------------------------------------------------------

  freeze(): { ok: true; frozen: true } {
    this.frozen = true;
    return { ok: true, frozen: true };
  }

  /** Unfreeze and restore the rest pose so the normal loop resumes cleanly. */
  thaw(): { ok: true; frozen: false } {
    this.restoreRest();
    this.frozen = false;
    return { ok: true, frozen: false };
  }

  private ensureVrm(): { vrm: VRM } | Fail {
    const vrm = this.h.getVrm();
    if (!vrm) return fail('$', 'VRM is not loaded yet — wait for the model (status shows "Loaded: ...") and retry.');
    if (!this.hipsRestPos) {
      const hips = vrm.humanoid?.getNormalizedBoneNode('hips' as never);
      if (hips) this.hipsRestPos = hips.position.clone();
    }
    return { vrm };
  }

  /** Reset every cached humanoid bone (and hips position) to its rest pose. */
  private restoreRest(): void {
    const vrm = this.h.getVrm();
    if (!vrm?.humanoid) return;
    for (const [bone, q] of this.h.getRestQuaternions()) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone as never);
      if (node) node.quaternion.copy(q);
    }
    const hips = vrm.humanoid.getNormalizedBoneNode('hips' as never);
    if (hips && this.hipsRestPos) hips.position.copy(this.hipsRestPos);
  }

  // ---- pose application ------------------------------------------------------------------

  private applyFrame(frame: EvalFrame, vrm: VRM): void {
    this.restoreRest();
    const humanoid = vrm.humanoid;
    if (!humanoid) return;

    for (const [bone, layers] of Object.entries(frame.bones)) {
      const node = humanoid.getNormalizedBoneNode(bone as never);
      if (!node) continue; // model lacks this bone (reported by load())
      composeBoneQuaternion(layers, this._q);
      node.quaternion.copy(this._q);
    }

    const hips = humanoid.getNormalizedBoneNode('hips' as never);
    if (hips && this.hipsRestPos) {
      hips.position.set(
        this.hipsRestPos.x + frame.hipsOffset[0],
        this.hipsRestPos.y + frame.hipsOffset[1],
        this.hipsRestPos.z + frame.hipsOffset[2],
      );
    }

    humanoid.update();

    // Gaze (0.2): resolve the GazeState deterministically. 'camera' resolves
    // to the real camera direction (true eye contact in captures); null =
    // wander at runtime, previewed as neutral front.
    this.applyGaze(frame.gaze, vrm);

    // Expressions via the Custom Expression Bridge (same max-blend the viewer uses).
    this.applyExpressionWeights(frame.expressions);
  }

  /** Place the lookAt target for a GazeState (null = neutral front) and update VRMLookAt. */
  private applyGaze(state: GazeState | null, vrm: VRM): void {
    const resolveCam = () => {
      const cam = this.h.camera.position;
      return offsetToGazeDir(cam.x, cam.y - GAZE_ANCHOR_Y, cam.z);
    };
    let dir = { yaw: 0, pitch: 0 };
    if (state) {
      const to = state.to === 'camera' ? resolveCam() : state.to;
      if (state.from === null) {
        // Fade in from neutral by k.
        dir = { yaw: to.yaw * state.k, pitch: to.pitch * state.k };
      } else {
        const from = state.from === 'camera' ? resolveCam() : state.from;
        dir = { yaw: from.yaw + (to.yaw - from.yaw) * state.k, pitch: from.pitch + (to.pitch - from.pitch) * state.k };
      }
    }
    const p = gazeDirToPanelPoint(dir);
    this.h.lookAtTarget.position.set(p.x, p.y, p.z);
    vrm.lookAt?.update(1 / 60);
  }

  /**
   * Clear all face-morph influences, then max-blend `weights` through the
   * bridge map — the exact per-frame contract the viewer uses. Returns which
   * names resolved and which the bridge doesn't know (honest reporting).
   */
  private applyExpressionWeights(weights: Record<string, number>): { applied: string[]; unknown: string[] } {
    const faceMeshes = this.h.getFaceMeshes();
    const map = this.h.getExpressionMap();
    const applied: string[] = [];
    const unknown: string[] = [];
    for (const name of Object.keys(weights)) {
      if (weights[name] <= 0) continue;
      (map[name.toLowerCase()] ? applied : unknown).push(name);
    }
    for (const mesh of faceMeshes) {
      const influences = mesh.morphTargetInfluences;
      if (!influences) continue;
      for (let i = 0; i < influences.length; i++) influences[i] = 0;
      for (const [name, w] of Object.entries(weights)) {
        if (w <= 0) continue;
        const binds = map[name.toLowerCase()];
        if (!binds) continue;
        for (const { index, weight } of binds) {
          if (index < influences.length) influences[index] = Math.max(influences[index], weight * w);
        }
      }
    }
    return { applied, unknown };
  }

  /**
   * Settle SpringBones against the (static) applied pose with fixed steps so
   * hair/skirt/sleeves hang naturally in the capture. Deterministic per pose.
   */
  private settleSpringBones(vrm: VRM, seconds: number): void {
    const manager = vrm.springBoneManager as { reset?: () => void; update: (dt: number) => void } | undefined;
    if (!manager) return;
    manager.reset?.();
    const dt = 1 / 60;
    const steps = Math.max(0, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) manager.update(dt);
  }

  // ---- show / capture ----------------------------------------------------------------------

  /** Freeze + pose the model at time t and render one frame to the canvas. */
  show(id: string, t: number, opts?: { camera?: CameraOpt; settle?: number }): Record<string, unknown> {
    const entry = this.registry.get(id);
    if (!entry) return fail('$', `motion "${id}" is not loaded — call await __motionLab.load("${id}") first.`);
    const ctx = this.ensureVrm();
    if ('ok' in ctx) return ctx;

    this.frozen = true;
    if (opts?.camera) {
      const cam = this.setCamera(opts.camera);
      if (!cam.ok) return cam;
    }
    const frame = entry.evaluator.evalAt(t);
    this.applyFrame(frame, ctx.vrm);
    this.settleSpringBones(ctx.vrm, opts?.settle ?? 1.0);
    this.h.renderer.render(this.h.scene, this.h.camera);

    return {
      ok: true,
      id,
      t,
      frozen: true,
      bonesPosed: Object.keys(frame.bones).length,
      expressions: frame.expressions,
      activeCuePreset: frame.activeCuePreset,
      gaze: frame.gaze
        ? { to: frame.gaze.to, k: Math.round(frame.gaze.k * 100) / 100 }
        : null,
    };
  }

  /**
   * show() then save the canvas as PNG under .probe_tmp/captures/<id>/.
   * Returns the absolute file path so the agent can Read it directly.
   */
  async capture(
    id: string,
    t: number,
    opts?: { camera?: CameraOpt; settle?: number; width?: number; height?: number; file?: string },
  ): Promise<Record<string, unknown>> {
    const width = opts?.width ?? 960;
    const height = opts?.height ?? 540;
    const renderer = this.h.renderer;
    const camera = this.h.camera;
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    const prevAspect = camera.aspect;

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    let dataUrl = '';
    let shown: Record<string, unknown>;
    try {
      shown = this.show(id, t, opts);
      if (shown.ok === true) dataUrl = renderer.domElement.toDataURL('image/png');
    } finally {
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      // Re-render at the restored size so the on-screen canvas isn't stretched.
      if (this.frozen) this.h.renderer.render(this.h.scene, this.h.camera);
    }
    if (shown.ok !== true) return shown;

    const cameraLabel = (typeof opts?.camera === 'string' ? opts.camera : opts?.camera ? 'custom' : 'current').replace(/[^\w-]+/g, '_');
    const file = opts?.file ?? `${id}/t${String(t).replace('.', '_')}_${cameraLabel}.png`;
    try {
      const res = await fetch('/__lab/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, dataUrl }),
      });
      const saved = await res.json();
      if (!res.ok || !saved.ok) {
        return fail('save', `saving failed: ${saved.error ?? `HTTP ${res.status}`}`);
      }
      return { ok: true, id, t, file: saved.path, width, height };
    } catch (e) {
      return fail('save', `POST /__lab/save failed: ${e instanceof Error ? e.message : String(e)} (dev server only — not available in a production build).`);
    }
  }

  /** Batch capture: one call -> several times x one camera. */
  async captureSet(
    id: string,
    times: number[],
    opts?: { camera?: CameraOpt; settle?: number; width?: number; height?: number },
  ): Promise<Record<string, unknown>> {
    const files: unknown[] = [];
    for (const t of times) {
      const r = await this.capture(id, t, opts);
      if (r.ok !== true) return { ...r, completed: files };
      files.push({ t, file: r.file });
    }
    return { ok: true, id, files };
  }

  // ---- expression presets (Expression Preset System 0.1) -----------------------------------

  /** List the expression presets (id / label / weights) for the authoring loop. */
  exprPresets(): Record<string, unknown> {
    return {
      ok: true,
      presets: EXPRESSION_PRESET_IDS.map((id) => {
        const p = EXPRESSION_PRESETS[id];
        return {
          id,
          label: p.label,
          description: p.description,
          weights: p.weights,
          eyelid: p.eyelid ?? null,
          gaze: p.gaze ?? null,
          flutter: p.flutter ?? null,
          intensityHint: p.intensityHint ?? null,
          notes: p.notes ?? null,
        };
      }),
    };
  }

  /**
   * Freeze + apply an expression preset (or a raw name->weight map) at rest
   * pose and render one frame. The visual half of the preset tuning loop.
   */
  exprShow(
    presetOrWeights: string | Record<string, number>,
    opts?: { intensity?: number; camera?: CameraOpt },
  ): Record<string, unknown> {
    const ctx = this.ensureVrm();
    if ('ok' in ctx) return ctx;

    let weights: Record<string, number>;
    let label: string;
    let gazeDir = { yaw: 0, pitch: 0 };
    if (typeof presetOrWeights === 'string') {
      const preset = getExpressionPreset(presetOrWeights);
      if (!preset) {
        return fail('preset', `unknown expression preset "${presetOrWeights}". Available: ${EXPRESSION_PRESET_IDS.join(', ')} — or pass a raw { name: weight } map.`);
      }
      weights = flattenPresetWeights(preset, opts?.intensity ?? 1);
      label = preset.id;
      // Fixed-gaze presets (e.g. thinking) show their eye direction in the
      // capture; wander damping has no visual in a frozen frame.
      if (preset.gaze && (preset.gaze.yaw !== undefined || preset.gaze.pitch !== undefined)) {
        gazeDir = { yaw: preset.gaze.yaw ?? 0, pitch: preset.gaze.pitch ?? 0 };
      }
    } else {
      weights = presetOrWeights;
      label = 'custom';
    }

    this.frozen = true;
    if (opts?.camera) {
      const cam = this.setCamera(opts.camera);
      if (!cam.ok) return cam;
    }
    // Rest body, preset gaze (or neutral front), then the expression.
    this.restoreRest();
    ctx.vrm.humanoid?.update();
    const gp = gazeDirToPanelPoint(gazeDir);
    this.h.lookAtTarget.position.set(gp.x, gp.y, gp.z);
    ctx.vrm.lookAt?.update(1 / 60);
    const { applied, unknown } = this.applyExpressionWeights(weights);
    this.settleSpringBones(ctx.vrm, 0.5);
    this.h.renderer.render(this.h.scene, this.h.camera);

    return { ok: true, preset: label, frozen: true, weights, gaze: gazeDir, applied, unknown };
  }

  /** exprShow() then save a PNG under .probe_tmp/captures/_expressions/. */
  async exprCapture(
    presetOrWeights: string | Record<string, number>,
    opts?: { intensity?: number; camera?: CameraOpt; width?: number; height?: number; file?: string },
  ): Promise<Record<string, unknown>> {
    const width = opts?.width ?? 720;
    const height = opts?.height ?? 720;
    const renderer = this.h.renderer;
    const camera = this.h.camera;
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    const prevAspect = camera.aspect;

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    let dataUrl = '';
    let shown: Record<string, unknown>;
    try {
      shown = this.exprShow(presetOrWeights, { intensity: opts?.intensity, camera: opts?.camera ?? 'face close' });
      if (shown.ok === true) dataUrl = renderer.domElement.toDataURL('image/png');
    } finally {
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      if (this.frozen) this.h.renderer.render(this.h.scene, this.h.camera);
    }
    if (shown.ok !== true) return shown;

    const label = typeof presetOrWeights === 'string' ? presetOrWeights : 'custom';
    const intensityTag = `i${String(opts?.intensity ?? 1).replace('.', '_')}`;
    const file = opts?.file ?? `_expressions/${label}_${intensityTag}.png`;
    try {
      const res = await fetch('/__lab/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, dataUrl }),
      });
      const saved = await res.json();
      if (!res.ok || !saved.ok) {
        return fail('save', `saving failed: ${saved.error ?? `HTTP ${res.status}`}`);
      }
      return { ok: true, preset: label, file: saved.path, width, height, unknown: shown.unknown };
    } catch (e) {
      return fail('save', `POST /__lab/save failed: ${e instanceof Error ? e.message : String(e)} (dev server only — not available in a production build).`);
    }
  }

  /** Batch: capture several presets (or all) with one call. */
  async exprCaptureSet(
    ids?: string[],
    opts?: { intensity?: number; camera?: CameraOpt; width?: number; height?: number },
  ): Promise<Record<string, unknown>> {
    const list = ids ?? [...EXPRESSION_PRESET_IDS];
    const files: unknown[] = [];
    for (const id of list) {
      const r = await this.exprCapture(id, opts);
      if (r.ok !== true) return { ...r, completed: files };
      files.push({ id, file: r.file });
    }
    return { ok: true, files };
  }

  // ---- numeric inspection -------------------------------------------------------------------

  samplePose(id: string, t: number): Record<string, unknown> {
    const entry = this.registry.get(id);
    if (!entry) return fail('$', `motion "${id}" is not loaded — call await __motionLab.load("${id}") first.`);
    const frame = entry.evaluator.evalAt(t);
    const bones: Record<string, unknown> = {};
    for (const [bone, layers] of Object.entries(frame.bones)) {
      bones[bone] = {
        ...(layers.posture ? { posture: roundE3(layers.posture) } : {}),
        ...(layers.hand ? { hand: roundE3(layers.hand) } : {}),
        ...(layers.offset ? { offset: roundE3(layers.offset) } : {}),
      };
    }
    return {
      ok: true,
      id,
      t,
      bones,
      hipsOffset: roundE3(frame.hipsOffset),
      expressions: Object.fromEntries(Object.entries(frame.expressions).map(([k, v]) => [k, round4(v)])),
      activeCuePreset: frame.activeCuePreset,
      gaze: frame.gaze ? { from: frame.gaze.from, to: frame.gaze.to, k: round4(frame.gaze.k) } : null,
    };
  }

  checkLoop(id: string): Record<string, unknown> {
    const entry = this.registry.get(id);
    if (!entry) return fail('$', `motion "${id}" is not loaded — call await __motionLab.load("${id}") first.`);
    const report = entry.evaluator.checkLoopSeam();
    return { ...report, maxBoneDelta: round4(report.maxBoneDelta), maxExpressionDelta: round4(report.maxExpressionDelta) };
  }

  // ---- runtime-path playback -------------------------------------------------------------------

  /** Compile through the REAL AnimationMixer path and play live (thaws the loop). */
  play(id: string, opts?: { weight?: number }): Record<string, unknown> {
    const entry = this.registry.get(id);
    if (!entry) return fail('$', `motion "${id}" is not loaded — call await __motionLab.load("${id}") first.`);
    const ctx = this.ensureVrm();
    if ('ok' in ctx) return ctx;

    const compiled = compileDslClip(entry.evaluator, ctx.vrm);
    this.thaw();
    this.h.requestClipSwap({
      clip: compiled.clip,
      boneNames: compiled.boneNames,
      source: 'dsl',
      hasExpressionTracks: false,
      autoPlay: true,
      loop: entry.evaluator.loop,
      clipWeight: opts?.weight ?? 1,
      fadeIn: entry.doc.motion.fadeIn,
      fadeOut: entry.doc.motion.fadeOut,
      faceTimeline: entry.evaluator.faceTimeline,
      hipsOffset: compiled.hipsOffset,
      hipsCurve: compiled.hipsCurve,
      rootCurve: compiled.rootCurve,
      microEvents: entry.doc.motion.microEvents ?? null,
    });
    this.h.onStatus(`[LAB] playing "${id}" through the mixer path`);
    return {
      ok: true,
      id,
      playing: true,
      loop: entry.evaluator.loop,
      bones: compiled.boneNames.length,
      missingBones: compiled.missingBones,
      face: entry.evaluator.faceTimeline
        ? { cues: entry.evaluator.faceTimeline.cues.length, exprKeys: entry.evaluator.faceTimeline.exprKeys.length, gazeKeys: entry.evaluator.faceTimeline.gazeKeys.length }
        : null,
      note: 'bone rotations via the mixer; expressions/gaze sampled live from the face timeline (0.2); hips position applied at runtime scaled by clip weight (試験B).',
    };
  }

  stop(): Record<string, unknown> {
    this.h.extController.returnToIdle();
    return { ok: true, playing: false };
  }

  // ---- camera -------------------------------------------------------------------------------------

  setCamera(preset: CameraOpt): { ok: true; camera: string } | Fail {
    const camera = this.h.camera;
    if (typeof preset === 'string') {
      const p = this.h.cameraPresets[preset];
      if (!p) {
        return fail('camera', `unknown camera preset "${preset}". Available: ${Object.keys(this.h.cameraPresets).join(', ')} — or pass { position: [x,y,z], target: [x,y,z], fov? }.`);
      }
      camera.position.set(...p.pos);
      camera.lookAt(new THREE.Vector3(...p.look));
      (camera.userData.target as THREE.Vector3 | undefined)?.set(...p.look);
      return { ok: true, camera: preset };
    }
    camera.position.set(...preset.position);
    camera.lookAt(new THREE.Vector3(...preset.target));
    (camera.userData.target as THREE.Vector3 | undefined)?.set(...preset.target);
    if (preset.fov) {
      camera.fov = preset.fov;
      camera.updateProjectionMatrix();
    }
    return { ok: true, camera: 'custom' };
  }

  /** Hide/show the desk/chair/laptop props (handy for clean pose captures). */
  setPropsVisible(visible: boolean): Record<string, unknown> {
    this.h.propsRoot.visible = visible;
    if (this.frozen) this.h.renderer.render(this.h.scene, this.h.camera);
    return { ok: true, propsVisible: visible };
  }

  // ---- prop attach (INF-4) — calibration surface for hand-held props -----------------------

  /**
   * Parent a loaded prop (e.g. "item:cup") onto a RAW humanoid bone with a
   * bone-local grip offset, so it follows the visible hand. Re-renders if
   * frozen. Iterate the offset here, then bake it into props.library.json.
   * boneName defaults to the right hand.
   */
  attachProp(propId: string, offset: GripOffset, boneName = 'rightHand'): Record<string, unknown> {
    const ctx = this.ensureVrm();
    if ('ok' in ctx) return ctx;
    const prop = findPropContainer(this.h.scene, propId);
    if (!prop) return fail('prop', `no loaded prop "${propId}" in the scene. Enable it (props.library defaultOn / item toggle) and check the id (library items are "item:<id>", e.g. "item:cup").`);
    const bone = (ctx.vrm.humanoid as unknown as { getRawBoneNode?: (n: string) => THREE.Object3D | null })?.getRawBoneNode?.(boneName);
    if (!bone) return fail('bone', `no raw bone "${boneName}". Use a humanoid bone name like "rightHand" / "leftHand".`);
    attachPropToBone(prop, bone, offset);
    ctx.vrm.humanoid?.update();
    if (this.frozen) this.h.renderer.render(this.h.scene, this.h.camera);
    return { ok: true, attached: propId, to: boneName, offset, boneWorldScale: round4(bone.getWorldScale(new THREE.Vector3()).x) };
  }

  /** Return a held prop to its desk rest. */
  detachProp(propId: string): Record<string, unknown> {
    const prop = findPropContainer(this.h.scene, propId);
    if (!prop) return fail('prop', `no loaded prop "${propId}".`);
    detachPropToHome(prop);
    if (this.frozen) this.h.renderer.render(this.h.scene, this.h.camera);
    return { ok: true, detached: propId };
  }

  // ---- director (INF-5) — self-running mode loop + scheduled ambients -----------------------

  /**
   * Start/stop the Motion Director. When on, kiritan plays her mode's base loop
   * and the scheduler injects ambient one-shots with no user input. thaw()s the
   * viewer first (the director needs the live rAF loop, not a frozen frame).
   */
  async director(on: boolean, opts?: { seed?: number; initialMode?: ModeId }): Promise<Record<string, unknown>> {
    if (!on) return { ...this.h.stopDirector(), ok: true };
    const ctx = this.ensureVrm();
    if ('ok' in ctx) return ctx;
    this.thaw(); // run live; the director drives the AnimationMixer each frame
    const r = await this.h.startDirector(opts);
    return { ...r, note: r.ok ? 'director running — watch __motionLab.directorStatus() for mode/state/ambientCount' : undefined };
  }

  /** Live director state (mode / loop|ambient / sleepiness / ambient count). */
  directorStatus(): Record<string, unknown> {
    const s = this.h.getDirectorStatus();
    return s ? { ok: true, ...s } : { ok: true, running: false };
  }

  // ---- introspection ----------------------------------------------------------------------------

  status(): Record<string, unknown> {
    const vrm = this.h.getVrm();
    return {
      ok: true,
      vrmLoaded: !!vrm,
      frozen: this.frozen,
      loadedMotions: [...this.registry.keys()],
      cameraPresets: Object.keys(this.h.cameraPresets),
      // Live mixer-path state (weight/blend/source) — lets the agent verify
      // play() is actually driving the AnimationMixer without any UI access.
      external: this.h.extController.getDebug(),
    };
  }

  help(): string {
    return [
      'Motion Lab — authoring loop for public/motions/dsl/*.motion.json (see MOTION_AUTHORING_GUIDE.md).',
      'All calls return { ok, ... } and never throw. Typical loop:',
      '  await __motionLab.ls()                                  // discover files',
      '  await __motionLab.load("my_motion")                     // fetch + validate + register (re-call after editing the JSON)',
      '  __motionLab.checkLoop("my_motion")                      // numeric loop-seam check',
      '  __motionLab.samplePose("my_motion", 2.0)                // numeric pose dump',
      '  await __motionLab.capture("my_motion", 2.0, { camera: "face close" })   // PNG -> .probe_tmp/captures/, returns absolute path',
      '  await __motionLab.captureSet("my_motion", [0, 2, 4, 6], { camera: "desk wide" })',
      '  await __motionLab.capture("my_motion", 2.0, { camera: { position: [0,1,2.2], target: [0,0.9,0], fov: 40 } })  // custom camera',
      '  __motionLab.setPropsVisible(false)                      // hide desk/chair/laptop for clean pose captures',
      '  __motionLab.play("my_motion")                           // live playback through the real mixer path',
      '  __motionLab.stop(); __motionLab.thaw()                  // back to the normal idle loop',
      'Expression presets (Expression Preset System 0.2):',
      '  __motionLab.exprPresets()                               // list preset ids/labels/weights/gaze/flutter',
      '  await __motionLab.exprCapture("small_smile", { intensity: 1 })          // PNG (face close camera)',
      '  await __motionLab.exprCapture({ jitome: 0.5, akire: 0.3 })              // raw name->weight map',
      '  await __motionLab.exprCaptureSet()                      // every preset in one call',
      'Faces in motions (0.2): "exprCues" (preset cues) / "gaze" (eye keys) preview in show()/capture()',
      'and ALSO run at runtime during play() — sampled at clip-local time, scaled by the clip weight.',
      'Notes: show()/capture() freeze the rAF loop (deterministic, works in a background tab); thaw() resumes.',
      'Edit the JSON on disk, then load() again — no rebuild needed.',
    ].join('\n');
  }
}

declare global {
  interface Window {
    __motionLab?: MotionLab;
  }
}

export function installMotionLab(handles: LabHandles): MotionLab {
  const lab = new MotionLab(handles);
  window.__motionLab = lab;
  console.log('[LAB] Motion Lab installed — run __motionLab.help() for usage.');
  handles.onStatus('Motion Lab active (?lab=1) — __motionLab.help()');
  return lab;
}
