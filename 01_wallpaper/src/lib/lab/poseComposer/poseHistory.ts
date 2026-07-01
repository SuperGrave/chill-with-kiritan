// Pose Composer 0.8 — Undo/Redo history (Stage 3)
//
// A pure snapshot stack for the authoring override, kept THREE-math-only (no VRM
// / renderer / DOM) so it is directly unit-testable in Node (tools/test_pose_undo.mjs),
// per the audit's testing guidance (§7). PoseComposer owns the live overrides and
// simply hands snapshots in / applies snapshots out; the command semantics live here.
//
// Command model (指示書 §11):
//   * One user gesture = one undo entry. A gizmo drag (or a panel numeric edit
//     between focus and blur) opens a command with begin(); the mutations in
//     between are folded together; commit() closes it and pushes ONE entry only
//     if the pose actually changed.
//   * A fresh commit clears the redo stack. The undo stack is capped (default 100).
//   * q and -q describe the same rotation, so equality compares |dot|.

import * as THREE from 'three';

/** A full authoring override state: bone -> reference-relative offset quaternion, plus hips position offset. */
export interface PoseSnapshot {
  overrides: Map<string, THREE.Quaternion>;
  hipsOffset: [number, number, number] | null;
}

const QUAT_EPS = 1e-6;
const POS_EPS = 1e-6;

/** Deep-clone a snapshot so the stack never aliases the live editing state. */
export function cloneSnapshot(s: PoseSnapshot): PoseSnapshot {
  const overrides = new Map<string, THREE.Quaternion>();
  for (const [bone, q] of s.overrides) overrides.set(bone, q.clone());
  return { overrides, hipsOffset: s.hipsOffset ? [s.hipsOffset[0], s.hipsOffset[1], s.hipsOffset[2]] : null };
}

/** True when two snapshots describe the same pose (q≡-q; small numeric tolerance). */
export function snapshotsEqual(a: PoseSnapshot, b: PoseSnapshot): boolean {
  if (a.overrides.size !== b.overrides.size) return false;
  for (const [bone, qa] of a.overrides) {
    const qb = b.overrides.get(bone);
    if (!qb) return false;
    // |dot| == 1 for identical rotations regardless of sign double-cover.
    if (Math.abs(Math.abs(qa.dot(qb)) - 1) > QUAT_EPS) return false;
  }
  const ha = a.hipsOffset;
  const hb = b.hipsOffset;
  if ((ha === null) !== (hb === null)) return false;
  if (ha && hb) {
    for (let i = 0; i < 3; i++) if (Math.abs(ha[i] - hb[i]) > POS_EPS) return false;
  }
  return true;
}

export class PoseHistory {
  private undoStack: PoseSnapshot[] = [];
  private redoStack: PoseSnapshot[] = [];
  private pending: PoseSnapshot | null = null;
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  /** Open a command (idempotent within a gesture): remember the pre-edit state. */
  begin(current: PoseSnapshot): void {
    if (!this.pending) this.pending = cloneSnapshot(current);
  }

  /**
   * Close the open command. Pushes ONE undo entry (and clears redo) only if the
   * pose changed since begin(). Returns true if an entry was pushed. No-op if no
   * command is open.
   */
  commit(current: PoseSnapshot): boolean {
    if (!this.pending) return false;
    const changed = !snapshotsEqual(this.pending, current);
    if (changed) {
      this.undoStack.push(this.pending);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.pending = null;
    return changed;
  }

  /**
   * Pop the last undo entry. Pushes `current` onto redo and returns the snapshot
   * to restore, or null if nothing to undo. Caller must have closed any open
   * command first (see PoseComposer.undo).
   */
  undo(current: PoseSnapshot): PoseSnapshot | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(cloneSnapshot(current));
    return this.undoStack.pop() ?? null;
  }

  /** Pop the last redo entry (pushing `current` onto undo), or null. */
  redo(current: PoseSnapshot): PoseSnapshot | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(cloneSnapshot(current));
    return this.redoStack.pop() ?? null;
  }

  /** Drop all history (e.g. session begin, or asset load in Stage 4). */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get hasPending(): boolean { return this.pending !== null; }
  get depth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
