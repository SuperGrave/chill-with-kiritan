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
import type { MotionDoc, ValidationIssue } from '../motion/dsl/types';
import { loadMotionDoc } from '../motion/dsl/loadMotionDoc';
import type { MotionEvaluator, EvalFrame } from '../motion/dsl/evaluate';
import { compileDslClip, composeBoneQuaternion } from '../motion/dsl/compileClip';
import type { ExternalMotionController } from '../motion/externalMotionController';

// --- handles the viewer passes in -------------------------------------------------

export interface CameraPresetTable {
  [name: string]: { pos: [number, number, number]; look: [number, number, number] };
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
  switchClip: (clip: THREE.AnimationClip, boneNames: string[], source: 'builtin' | 'vrma' | 'dsl', hasExpressionTracks: boolean) => void;
  extController: ExternalMotionController;
  onStatus: (status: string) => void;
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
  private _v = new THREE.Vector3();

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

    // LookAt: resolve the directive deterministically ('cursor' previews as 'camera').
    const lookAt = frame.lookAt;
    const neutral = this._v.set(0, 1.2, 1.0);
    let target: THREE.Vector3 | null = null;
    if (lookAt.mode === 'camera' || lookAt.mode === 'cursor') target = this.h.camera.position;
    else if (lookAt.mode === 'fixed' && lookAt.point) target = new THREE.Vector3(...lookAt.point);
    if (target && lookAt.mode !== 'off') {
      this.h.lookAtTarget.position.lerpVectors(neutral, target, Math.min(Math.max(lookAt.strength, 0), 1));
    } else {
      this.h.lookAtTarget.position.copy(neutral);
    }
    vrm.lookAt?.update(1 / 60);

    // Expressions via the Custom Expression Bridge (same max-blend the viewer uses).
    const faceMeshes = this.h.getFaceMeshes();
    const map = this.h.getExpressionMap();
    for (const mesh of faceMeshes) {
      const influences = mesh.morphTargetInfluences;
      if (!influences) continue;
      for (let i = 0; i < influences.length; i++) influences[i] = 0;
      for (const [name, w] of Object.entries(frame.expressions)) {
        if (w <= 0) continue;
        const binds = map[name.toLowerCase()];
        if (!binds) continue;
        for (const { index, weight } of binds) {
          if (index < influences.length) influences[index] = Math.max(influences[index], weight * w);
        }
      }
    }
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
      lookAt: frame.lookAt.mode,
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
      lookAt: frame.lookAt,
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
    this.h.switchClip(compiled.clip, compiled.boneNames, 'dsl', false);
    const ext = this.h.extController;
    ext.setLoop(entry.evaluator.loop);
    ext.setClipWeight(opts?.weight ?? 1);
    ext.play();
    this.h.onStatus(`[LAB] playing "${id}" through the mixer path`);
    return {
      ok: true,
      id,
      playing: true,
      loop: entry.evaluator.loop,
      bones: compiled.boneNames.length,
      missingBones: compiled.missingBones,
      note: 'bone rotations only — expressions/lookAt/hips position preview in Lab show(); runtime support lands with the Motion Director (0.9).',
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
