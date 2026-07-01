// Pose Composer 0.8 — Authoring Session (Stage 1)
//
// The hand-authoring counterpart to the Motion Lab: instead of playing a motion,
// the master poses the VRM's Humanoid bones directly (FK), and the result is
// saved as a pose asset / inserted into a motion as a keyframe (Stages 4/5). This
// module owns ONLY the authoring SESSION + the deterministic fixed-time render
// path with the Authoring Override on top. Bone selection / SVG map / gizmo /
// drag pad / save are layered on in later stages.
//
// Design invariants (指示書 §4):
//   * The override never touches the production compose order. While a session is
//     active the viewer's rAF yields (see VrmViewer's freeze gate), exactly like
//     the Motion Lab's freeze — so the override lives only in THIS render path.
//   * Each bone is REBUILT every frame as  node.quaternion = referenceQ * offsetQ
//     (never `multiply` onto the previous frame), so there is zero accumulation.
//   * Reference pose = the viewer's canonical arm-dropped rest (initialRotations),
//     NOT the raw T-pose. We read it through the shared handles; we never mutate it.
//
// Like the Lab, every public method returns JSON-serializable data and NEVER
// throws — failures come back as { ok:false, error }. Driven from ?lab=1 via
// window.__poseComposer (a DOM panel is added in Stage 2).

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { LabHandles, CameraPresetTable } from '../motionLab';
import { HUMANOID_BONE_SET } from '../../motion/dsl/types';
import { boneLabel } from './boneMapDefinition';

// --- session options ----------------------------------------------------------
// Which of the "rest of the rig" layers stay live while authoring. All OFF by
// default (指示書 §7.1): a frozen, fully-deterministic frame is the baseline, and
// the master re-enables each individually from the panel when a check needs it.
export interface PoseSessionOptions {
  /** Drive VRMLookAt from lookAtTarget (else eyes hold neutral front). */
  lookAt: boolean;
  /** Settle SpringBones (hair/skirt/sleeves) against the static pose each render. */
  springBone: boolean;
  /** Apply a single named expression through the Custom Expression Bridge. */
  expression: string | null;
}

const DEFAULT_OPTIONS: PoseSessionOptions = { lookAt: false, springBone: false, expression: null };

/** Editing sub-mode (指示書 §5). Stage 1 only needs basePose; the others slot in. */
export type PoseEditMode = 'basePose' | 'keyPose' | 'handPose';

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Handles the Pose Composer needs — a superset shares the Lab's handle bag. */
export type PoseComposerHandles = LabHandles;

export class PoseComposer {
  private h: PoseComposerHandles;
  private active = false;
  private dirty = false;
  private mode: PoseEditMode = 'basePose';
  private options: PoseSessionOptions = { ...DEFAULT_OPTIONS };

  // Authoring override: bone -> OFFSET quaternion relative to the reference pose
  // (identity = unchanged). The canonical edit data; saving converts it to the
  // pose/1 format later (Stage 4). A bone absent here renders at the reference.
  private overrides = new Map<string, THREE.Quaternion>();
  // hips POSITION offset (meters, normalized rig) from rest — basePose mode only.
  private hipsOffset: [number, number, number] | null = null;

  // Reference hips position, captured once when first needed (viewer-owned copy).
  private hipsRest: THREE.Vector3 | null = null;

  // Selected bone (Stage 2) + its dev-only 3D highlight overlay (a small sphere
  // + local axes parented to nothing — repositioned each render at the bone's
  // world transform). Created lazily, disposed on end(). Never touches VRM
  // materials (指示書 §10.1).
  private selectedBone: string | null = null;
  private overlay: THREE.Group | null = null;
  private overlaySphere: THREE.Mesh | null = null;
  private overlayAxes: THREE.AxesHelper | null = null;
  private _wpos = new THREE.Vector3();
  private _wquat = new THREE.Quaternion();

  // scratch (reused — no per-frame allocation, 指示書 §20)
  private _q = new THREE.Quaternion();
  private _qRef = new THREE.Quaternion();
  private _qOff = new THREE.Quaternion();
  private _euler = new THREE.Euler();

  constructor(handles: PoseComposerHandles) {
    this.h = handles;
  }

  isActive(): boolean {
    return this.active;
  }

  // ---- guards ----------------------------------------------------------------

  private ensureVrm(): { vrm: VRM } | Fail {
    const vrm = this.h.getVrm();
    if (!vrm) return fail('VRM is not loaded yet — wait for the model (status shows "Loaded: ...") and retry.');
    if (!vrm.humanoid) return fail('VRM has no humanoid rig — cannot author bones on this model.');
    return { vrm };
  }

  private ensureActive(): { vrm: VRM } | Fail {
    if (!this.active) return fail('no active pose session — call __poseComposer.begin() first.');
    return this.ensureVrm();
  }

  /** Validate a humanoid bone name against the schema set (not model presence). */
  private checkBone(bone: string): Fail | null {
    if (!HUMANOID_BONE_SET.has(bone)) {
      return fail(`unknown humanoid bone "${bone}". Use VRM 1.0 camelCase names (e.g. "head", "leftUpperArm").`);
    }
    return null;
  }

  /** The reference quaternion for a bone (viewer's cached rest), or null. */
  private refQuat(bone: string): THREE.Quaternion | undefined {
    return this.h.getRestQuaternions().get(bone);
  }

  // ---- session lifecycle (指示書 §7.1 / §7.3) --------------------------------

  /**
   * Begin a pose-authoring session: take over the render loop (the viewer's rAF
   * yields while isActive()), stop live playback, default every "rest of the rig"
   * layer OFF, restore the reference pose, and render one clean frame.
   */
  begin(opts?: { mode?: PoseEditMode; camera?: string | { position: [number, number, number]; target: [number, number, number]; fov?: number } }): Record<string, unknown> {
    const ctx = this.ensureVrm();
    if ('ok' in ctx) return ctx;

    // 1-4. Stop live playback so resuming later is from a known idle, and so no
    //      mixer write fights our override. The viewer's rAF is suppressed by the
    //      freeze gate the moment active flips true (below), so nothing animates.
    this.h.extController.returnToIdle();

    // Capture the reference hips position once (viewer-owned authoritative copy).
    if (!this.hipsRest) {
      const rest = this.h.getRestHipsPosition();
      if (rest) this.hipsRest = rest.clone();
    }

    // 5-7. Default LookAt / SpringBone / blink OFF for a deterministic baseline.
    this.options = { ...DEFAULT_OPTIONS };
    this.mode = opts?.mode ?? 'basePose';
    this.overrides.clear();
    this.hipsOffset = null;
    this.dirty = false;

    // 8-9. Switch to fixed-time render: become active (viewer yields), set camera
    //      if asked, restore reference, draw.
    this.active = true;
    if (opts?.camera) {
      const cam = this.setCamera(opts.camera);
      if (!cam.ok) { this.active = false; return cam; }
    }
    this.drawFrame(ctx.vrm);
    this.h.onStatus(`[POSE] session started (${this.mode}) — author bones, then save/insert. __poseComposer.help()`);
    return { ok: true, active: true, mode: this.mode };
  }

  /**
   * End the session. Discards the override, restores the reference pose so NO
   * residual rotation survives into the resumed loop, and hands rendering back to
   * the viewer. Refuses if there are unsaved edits unless { discard:true }.
   */
  end(opts?: { discard?: boolean }): Record<string, unknown> {
    if (!this.active) return { ok: true, active: false };
    if (this.dirty && !opts?.discard) {
      return fail('unsaved pose edits — save/insert first, or call __poseComposer.end({ discard:true }) to drop them.');
    }
    const vrm = this.h.getVrm();
    this.overrides.clear();
    this.hipsOffset = null;
    this.selectedBone = null;
    this.disposeOverlay();
    if (vrm?.humanoid) this.restoreReference(vrm); // guarantee no residual
    this.dirty = false;
    this.active = false;
    // The viewer's rAF resumes next frame and rewrites every bone from idle/clip,
    // so the restored reference here is just belt-and-braces.
    this.h.onStatus('[POSE] session ended — returning to the normal loop');
    return { ok: true, active: false };
  }

  // ---- per-frame render (指示書 §7.2 A→K) ------------------------------------

  /** Restore every cached humanoid bone (and hips position) to the reference. */
  private restoreReference(vrm: VRM): void {
    const humanoid = vrm.humanoid;
    if (!humanoid) return;
    for (const [bone, q] of this.h.getRestQuaternions()) {
      const node = humanoid.getNormalizedBoneNode(bone as never);
      if (node) node.quaternion.copy(q);
    }
    const hips = humanoid.getNormalizedBoneNode('hips' as never);
    if (hips && this.hipsRest) hips.position.copy(this.hipsRest);
  }

  /**
   * Build and render ONE authored frame. The whole pose is reconstructed from the
   * reference each call (no accumulation): reference -> override -> humanoid.update
   * -> optional LookAt/Expression/SpringBone -> updateMatrixWorld -> render.
   */
  private drawFrame(vrm: VRM): void {
    const humanoid = vrm.humanoid;
    if (!humanoid) return;

    // A. reference. (B/C — base-pose load + motion eval — land in Stages 4/5; for
    //    now the reference IS the base.)
    this.restoreReference(vrm);

    // D. authoring override: node.quaternion = referenceQ * offsetQ.
    for (const [bone, offsetQ] of this.overrides) {
      const node = humanoid.getNormalizedBoneNode(bone as never);
      const ref = this.refQuat(bone);
      if (!node || !ref) continue;
      node.quaternion.copy(ref).multiply(offsetQ);
    }
    if (this.hipsOffset) {
      const hips = humanoid.getNormalizedBoneNode('hips' as never);
      if (hips && this.hipsRest) {
        hips.position.set(
          this.hipsRest.x + this.hipsOffset[0],
          this.hipsRest.y + this.hipsOffset[1],
          this.hipsRest.z + this.hipsOffset[2],
        );
      }
    }

    // E. normalized -> raw.
    humanoid.update();

    // F. optional LookAt (else hold neutral front so the eyes don't wander).
    if (this.options.lookAt && vrm.lookAt) {
      vrm.lookAt.update(1 / 60);
    }

    // G. optional Expression Bridge (single named expression, or clear to neutral).
    this.applyExpression(this.options.expression);

    // H. optional SpringBone settle (static pose -> let hair/sleeves hang).
    if (this.options.springBone) this.settleSpringBones(vrm, 0.4);

    // I. commit world matrices, then K. update the selected-bone overlay so its
    //    sphere/axes sit on the bone's CURRENT world transform.
    this.h.scene.updateMatrixWorld(true);
    this.updateOverlay(vrm);

    // J. render.
    this.h.renderer.render(this.h.scene, this.h.camera);
  }

  // ---- selected-bone overlay (指示書 §10.1) ----------------------------------

  private ensureOverlay(): void {
    if (this.overlay) return;
    const grp = new THREE.Group();
    grp.renderOrder = 999;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0x3aa0ff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    sphere.renderOrder = 999;
    const axes = new THREE.AxesHelper(0.085);
    (axes.material as THREE.Material).depthTest = false;
    axes.renderOrder = 1000;
    grp.add(sphere, axes);
    grp.visible = false;
    this.overlay = grp;
    this.overlaySphere = sphere;
    this.overlayAxes = axes;
    this.h.scene.add(grp);
  }

  /** Place the overlay at the selected bone's world position + orientation. */
  private updateOverlay(vrm: VRM): void {
    if (!this.overlay) return;
    const node = this.selectedBone ? vrm.humanoid?.getNormalizedBoneNode(this.selectedBone as never) : null;
    if (!node) { this.overlay.visible = false; return; }
    node.getWorldPosition(this._wpos);
    node.getWorldQuaternion(this._wquat);
    this.overlay.position.copy(this._wpos);
    this.overlay.quaternion.copy(this._wquat);
    this.overlay.visible = true;
  }

  private disposeOverlay(): void {
    if (!this.overlay) return;
    this.h.scene.remove(this.overlay);
    this.overlaySphere?.geometry.dispose();
    (this.overlaySphere?.material as THREE.Material | undefined)?.dispose();
    this.overlayAxes?.dispose();
    this.overlay = null;
    this.overlaySphere = null;
    this.overlayAxes = null;
  }

  /** Select a bone (drives the 3D highlight + the panel inspector). null clears. */
  selectBone(bone: string | null): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    if (bone === null) {
      this.selectedBone = null;
      this.drawFrame(ctx.vrm);
      return { ok: true, selected: null };
    }
    const bad = this.checkBone(bone);
    if (bad) return bad;
    this.selectedBone = bone;
    this.ensureOverlay();
    this.drawFrame(ctx.vrm);
    return { ok: true, selected: bone, label: boneLabel(bone), present: !!this.refQuat(bone), ...this.boneReadout(bone) };
  }

  getSelected(): Record<string, unknown> {
    return { ok: true, selected: this.selectedBone, ...(this.selectedBone ? this.boneReadout(this.selectedBone) : {}) };
  }

  /** Switch editing sub-mode (basePose / keyPose / handPose). */
  setMode(mode: PoseEditMode): Record<string, unknown> {
    this.mode = mode;
    return { ok: true, mode };
  }

  /**
   * Per-bone state for the panel UI: whether the model has the bone (present) and
   * whether it carries an authored override (edited). Keyed by bone name.
   */
  boneStates(): Record<string, { present: boolean; edited: boolean }> {
    const rest = this.h.getRestQuaternions();
    const out: Record<string, { present: boolean; edited: boolean }> = {};
    for (const bone of HUMANOID_BONE_SET) out[bone] = { present: rest.has(bone), edited: this.overrides.has(bone) };
    return out;
  }

  /** Public render trigger (Stage 2 UI / external callers). No-op when inactive. */
  render(): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    this.drawFrame(ctx.vrm);
    return { ok: true, rendered: true };
  }

  // ---- override editing (minimal setters; full UI in Stages 2/3) -------------

  /**
   * Set a bone's authored rotation as a LOCAL-OFFSET euler (radians, XYZ) from
   * the reference pose — the primary editing unit (指示書 §6.6). [0,0,0] clears it.
   */
  setBoneOffsetEuler(bone: string, e: [number, number, number], opts?: { degrees?: boolean }): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    const bad = this.checkBone(bone);
    if (bad) return bad;
    if (!this.refQuat(bone)) return fail(`bone "${bone}" is not in the reference pose (model may lack it) — cannot author it.`);
    if (!e || e.length !== 3 || !e.every((n) => Number.isFinite(n))) return fail(`euler must be 3 finite numbers [x,y,z], got ${JSON.stringify(e)}.`);
    const k = opts?.degrees ? DEG2RAD : 1;
    const [x, y, z] = [e[0] * k, e[1] * k, e[2] * k];
    if (x === 0 && y === 0 && z === 0) {
      this.overrides.delete(bone);
    } else {
      this._qOff.setFromEuler(this._euler.set(x, y, z, 'XYZ'));
      this.overrides.set(bone, this._qOff.clone().normalize());
    }
    return this.afterEdit(bone);
  }

  /**
   * Set a bone's authored rotation as an absolute LOCAL quaternion; stored as the
   * offset = inv(reference) * local. Used by the gizmo path (Stage 3).
   */
  setBoneLocalQuaternion(bone: string, q: [number, number, number, number]): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    const bad = this.checkBone(bone);
    if (bad) return bad;
    const ref = this.refQuat(bone);
    if (!ref) return fail(`bone "${bone}" is not in the reference pose (model may lack it) — cannot author it.`);
    if (!q || q.length !== 4 || !q.every((n) => Number.isFinite(n))) return fail(`quaternion must be 4 finite numbers [x,y,z,w], got ${JSON.stringify(q)}.`);
    this._q.set(q[0], q[1], q[2], q[3]);
    if (this._q.lengthSq() < 1e-12) return fail('quaternion has zero length.');
    this._q.normalize();
    // offset = inv(ref) * local
    this._qOff.copy(this._qRef.copy(ref).invert()).multiply(this._q);
    this.overrides.set(bone, this._qOff.clone().normalize());
    return this.afterEdit(bone);
  }

  /** Reset one bone to the reference (clears its override). */
  resetBone(bone: string): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    const bad = this.checkBone(bone);
    if (bad) return bad;
    this.overrides.delete(bone);
    return this.afterEdit(bone);
  }

  /** Reset the whole pose to the reference (clears all overrides + hips). */
  resetAll(): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    this.overrides.clear();
    this.hipsOffset = null;
    this.dirty = false;
    this.drawFrame(ctx.vrm);
    return { ok: true, reset: 'all' };
  }

  /** Set the hips POSITION offset (meters) from rest — basePose mode only. */
  setHipsOffset(offset: [number, number, number] | null): Record<string, unknown> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
    if (this.mode !== 'basePose') return fail(`hips translation is only editable in basePose mode (current: ${this.mode}).`);
    if (offset && (offset.length !== 3 || !offset.every((n) => Number.isFinite(n)))) return fail(`hips offset must be 3 finite numbers or null, got ${JSON.stringify(offset)}.`);
    this.hipsOffset = offset && (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) ? [offset[0], offset[1], offset[2]] : null;
    this.dirty = true;
    this.drawFrame(ctx.vrm);
    return { ok: true, hipsOffset: this.hipsOffset };
  }

  private afterEdit(bone: string): Record<string, unknown> {
    this.dirty = true;
    const vrm = this.h.getVrm();
    if (vrm) this.drawFrame(vrm);
    return { ok: true, bone, ...this.boneReadout(bone) };
  }

  /** Current authored value of a bone as offset euler(deg) + quaternion. */
  private boneReadout(bone: string): Record<string, unknown> {
    const offsetQ = this.overrides.get(bone);
    if (!offsetQ) return { offsetEulerDeg: [0, 0, 0], offsetQuat: [0, 0, 0, 1], edited: false };
    this._euler.setFromQuaternion(offsetQ, 'XYZ');
    return {
      offsetEulerDeg: [round4(this._euler.x * RAD2DEG), round4(this._euler.y * RAD2DEG), round4(this._euler.z * RAD2DEG)],
      offsetQuat: [round4(offsetQ.x), round4(offsetQ.y), round4(offsetQ.z), round4(offsetQ.w)],
      edited: true,
    };
  }

  /** Inspect a bone (read-only) — euler(deg) + quaternion offset from reference. */
  inspectBone(bone: string): Record<string, unknown> {
    const bad = this.checkBone(bone);
    if (bad) return bad;
    return { ok: true, bone, present: !!this.refQuat(bone), ...this.boneReadout(bone) };
  }

  // ---- "rest of the rig" toggles (指示書 §7.1) -------------------------------

  setLookAt(on: boolean): Record<string, unknown> {
    this.options.lookAt = on;
    return this.renderIfActive({ lookAt: on });
  }
  setSpringBone(on: boolean): Record<string, unknown> {
    this.options.springBone = on;
    return this.renderIfActive({ springBone: on });
  }
  setExpression(name: string | null): Record<string, unknown> {
    this.options.expression = name;
    return this.renderIfActive({ expression: name });
  }

  private renderIfActive(extra: Record<string, unknown>): Record<string, unknown> {
    const vrm = this.h.getVrm();
    if (this.active && vrm?.humanoid) this.drawFrame(vrm);
    return { ok: true, ...extra };
  }

  // ---- camera (mirrors the Lab; handy for verification captures) -------------

  setCamera(preset: string | { position: [number, number, number]; target: [number, number, number]; fov?: number }): { ok: true; camera: string } | Fail {
    const camera = this.h.camera;
    const presets: CameraPresetTable = this.h.cameraPresets;
    if (typeof preset === 'string') {
      const p = presets[preset];
      if (!p) return fail(`unknown camera preset "${preset}". Available: ${Object.keys(presets).join(', ')} — or pass { position, target, fov? }.`);
      camera.position.set(...p.pos);
      camera.lookAt(new THREE.Vector3(...p.look));
      (camera.userData.target as THREE.Vector3 | undefined)?.set(...p.look);
      if (this.active) this.render();
      return { ok: true, camera: preset };
    }
    camera.position.set(...preset.position);
    camera.lookAt(new THREE.Vector3(...preset.target));
    (camera.userData.target as THREE.Vector3 | undefined)?.set(...preset.target);
    if (preset.fov) { camera.fov = preset.fov; camera.updateProjectionMatrix(); }
    if (this.active) this.render();
    return { ok: true, camera: 'custom' };
  }

  // ---- expression bridge (subset of the Lab's apply; single name) ------------

  /** Clear all face morphs, then apply one named expression at weight 1 (max-blend). */
  private applyExpression(name: string | null): void {
    const faceMeshes = this.h.getFaceMeshes();
    if (faceMeshes.length === 0) return;
    const map = this.h.getExpressionMap();
    const binds = name ? map[name.toLowerCase()] : undefined;
    for (const mesh of faceMeshes) {
      const influences = mesh.morphTargetInfluences;
      if (!influences) continue;
      for (let i = 0; i < influences.length; i++) influences[i] = 0;
      if (binds) for (const { index, weight } of binds) if (index < influences.length) influences[index] = weight;
    }
  }

  private settleSpringBones(vrm: VRM, seconds: number): void {
    const manager = vrm.springBoneManager as { reset?: () => void; update: (dt: number) => void } | undefined;
    if (!manager) return;
    manager.reset?.();
    const dt = 1 / 60;
    const steps = Math.max(0, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) manager.update(dt);
  }

  // ---- capture (reuse the Lab's working visual channel) ----------------------

  /**
   * Render the current authored pose to a PNG under .probe_tmp/captures/_pose/
   * via the dev-server middleware (the headless-safe visual channel), and return
   * the absolute path. Mirrors MotionLab.capture's resize/restore dance.
   */
  async capture(opts?: { width?: number; height?: number; file?: string }): Promise<Record<string, unknown>> {
    const ctx = this.ensureActive();
    if ('ok' in ctx) return ctx;
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
    try {
      this.drawFrame(ctx.vrm);
      dataUrl = renderer.domElement.toDataURL('image/png');
    } finally {
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      this.drawFrame(ctx.vrm); // restore on-screen size
    }
    const file = opts?.file ?? `_pose/pose_${Date.now()}.png`;
    try {
      const res = await fetch('/__lab/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, dataUrl }),
      });
      const saved = await res.json();
      if (!res.ok || !saved.ok) return fail(`saving failed: ${saved.error ?? `HTTP ${res.status}`}`);
      return { ok: true, file: saved.path, width, height };
    } catch (e) {
      return fail(`POST /__lab/save failed: ${e instanceof Error ? e.message : String(e)} (dev server only).`);
    }
  }

  // ---- introspection ---------------------------------------------------------

  status(): Record<string, unknown> {
    return {
      ok: true,
      active: this.active,
      mode: this.mode,
      dirty: this.dirty,
      selectedBone: this.selectedBone,
      options: this.options,
      overriddenBones: [...this.overrides.keys()],
      hipsOffset: this.hipsOffset,
      vrmLoaded: !!this.h.getVrm(),
    };
  }

  /** Full authored pose as offset eulers (deg) — debug / pre-save inspection. */
  dumpPose(): Record<string, unknown> {
    const bones: Record<string, unknown> = {};
    for (const bone of this.overrides.keys()) bones[bone] = this.boneReadout(bone);
    return { ok: true, mode: this.mode, hipsOffset: this.hipsOffset, bones };
  }

  help(): string {
    return [
      'Pose Composer 0.8 — hand-author VRM bones (FK). All calls return { ok, ... } and never throw.',
      'Stage 1 (session + override). Typical loop:',
      '  __poseComposer.begin({ camera: "face close" })          // freeze + take over render, reference pose',
      '  __poseComposer.setBoneOffsetEuler("head", [10,0,0], { degrees:true })   // nod (offset from rest)',
      '  __poseComposer.setBoneOffsetEuler("rightUpperArm", [0,0,0.6])           // radians by default',
      '  __poseComposer.selectBone("head")                       // highlight in 3D + drive the panel inspector',
      '  __poseComposer.inspectBone("head")                      // read current offset (euler deg + quat)',
      '  __poseComposer.setLookAt(true) / setSpringBone(true) / setExpression("joy")  // re-enable a layer',
      '  await __poseComposer.capture({ file: "_pose/test.png" }) // PNG -> .probe_tmp/captures/, returns path',
      '  __poseComposer.resetBone("head") / resetAll()',
      '  __poseComposer.end()                                    // restore + hand back to the normal loop',
      '  __poseComposer.status() / dumpPose()',
      'Save to .pose.json and Motion keyframe insertion arrive in Stages 4/5.',
    ].join('\n');
  }
}

declare global {
  interface Window {
    __poseComposer?: PoseComposer;
  }
}

export function installPoseComposer(handles: PoseComposerHandles): PoseComposer {
  const pc = new PoseComposer(handles);
  window.__poseComposer = pc;
  console.log('[POSE] Pose Composer installed — run __poseComposer.help() for usage.');
  return pc;
}
