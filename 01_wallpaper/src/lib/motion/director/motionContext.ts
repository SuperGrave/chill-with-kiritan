// Motion playback-context registry (Phase 1 visual-QA, Stage 1 — issue #1).
//
// Single source of truth for "after this one-shot finishes, which Loop should
// the character settle into?" so a standalone Ambient / Transition never falls
// back to the standing rest pose. THREE-free + pure data, so the host
// (VrmViewer), the Motion Lab and the Node test harness all share ONE table and
// nothing has to guess from the motion-id string.
//
// Derivation:
//   * loop_<mode>  → settles into itself.
//   * ambient      → its owning mode's base loop (reverse-indexed from the
//                    design table MODE_TABLE, so adding an ambient there is the
//                    only edit needed).
//   * transition   → an explicit target mode (a transition id can bridge several
//                    FSM edges but its END posture — hence its settle loop — is
//                    fixed; wildcard / locomotion targets are pinned here).

import type { ModeId } from './types';
import { MODE_TABLE } from './modeTable';

/**
 * Phase-1 playback-context mode → base-loop motion id. This registry is wider
 * than the current production auto-run set: VrmViewer may choose a smaller
 * "primary" subset while keeping these return-loop mappings for Lab playback
 * and secondary clips.
 */
export const PHASE1_MODE_LOOP: Partial<Record<ModeId, string>> = {
  work_normal: 'loop_work_normal',
  work_sleepy: 'loop_work_sleepy',
  video_relax: 'loop_video_relax',
  sleep_desk: 'loop_sleep_desk',
};

export type MotionCategory =
  | 'loop'
  | 'ambient'
  | 'transition'
  | 'reactive'
  | 'command'
  | 'unknown';

/** Resolved playback context for a motion id (see file header). */
export interface MotionPlaybackContext {
  motionId: string;
  category: MotionCategory;
  /** Mode the motion belongs to / leaves from (ambient owner, transition source). */
  sourceMode?: ModeId;
  /** Mode a transition heads into. */
  targetMode?: ModeId;
  /**
   * Loop to settle into when this motion is a finished one-shot, or null when it
   * has no sitting context (e.g. it ends standing / mid-stride, or it is itself
   * a loop with no separate target).
   */
  returnLoop: string | null;
}

// Explicit transition contexts. `target: null` = ends out of any sitting loop
// (stand / walk locomotion), so it has no settle loop. Mappings follow the
// issue #1 list (e.g. tr_slump_wake → loop_work_normal, tr_sit_to_slump →
// loop_sleep_desk, tr_lean_back → loop_video_relax, tr_lean_forward → loop_work_normal).
const TRANSITION_CONTEXT: Record<string, { source?: ModeId; target: ModeId | null }> = {
  tr_sit_to_slump: { source: 'work_sleepy', target: 'sleep_desk' },
  tr_slump_wake: { source: 'sleep_desk', target: 'work_normal' },
  tr_lean_back: { source: 'work_normal', target: 'video_relax' },
  tr_lean_forward: { source: 'video_relax', target: 'work_normal' },
  tr_stand_to_sit: { target: 'work_normal' },
  // Locomotion / stand-up transitions END standing or mid-stride — no sitting loop.
  tr_sit_to_stand: { source: 'work_normal', target: null },
  tr_walk_start: { target: null },
  tr_walk_stop: { target: null },
};

// ambient id → owning mode, built once from the design table (every mode's pool).
const AMBIENT_MODE = new Map<string, ModeId>();
for (const spec of Object.values(MODE_TABLE)) {
  for (const a of spec.ambients) AMBIENT_MODE.set(a.id, spec.id);
}

function categoryFromPrefix(id: string): MotionCategory {
  if (id.startsWith('loop_')) return 'loop';
  if (id.startsWith('amb_')) return 'ambient';
  if (id.startsWith('tr_')) return 'transition';
  if (id.startsWith('re_')) return 'reactive';
  if (id.startsWith('cmd_')) return 'command';
  return 'unknown';
}

/** Full playback context for a motion id. Never throws; unknown ids degrade. */
export function resolveMotionContext(id: string): MotionPlaybackContext {
  // Loop: settles into itself.
  for (const mode of Object.keys(PHASE1_MODE_LOOP) as ModeId[]) {
    if (PHASE1_MODE_LOOP[mode] === id) {
      return { motionId: id, category: 'loop', sourceMode: mode, targetMode: mode, returnLoop: id };
    }
  }
  // Transition: explicit target mode → that mode's loop.
  const tr = TRANSITION_CONTEXT[id];
  if (tr) {
    return {
      motionId: id,
      category: 'transition',
      sourceMode: tr.source,
      targetMode: tr.target ?? undefined,
      returnLoop: tr.target ? PHASE1_MODE_LOOP[tr.target] ?? null : null,
    };
  }
  // Ambient: settle back into its mode's loop.
  const mode = AMBIENT_MODE.get(id);
  if (mode) {
    return { motionId: id, category: 'ambient', sourceMode: mode, returnLoop: PHASE1_MODE_LOOP[mode] ?? null };
  }
  // Unknown / not Phase-1 content.
  return { motionId: id, category: categoryFromPrefix(id), returnLoop: null };
}

/** Convenience: the loop a finished one-shot `id` should settle into, or null. */
export function contextReturnLoop(id: string): string | null {
  return resolveMotionContext(id).returnLoop;
}
