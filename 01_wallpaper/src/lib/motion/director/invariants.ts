// State-invariant checker (Phase 0, Test C) — §6.1 / §6.2 / §6.3.
//
// Every mode has a [posture, hands{L,R}, held props] tuple. The FSM may only
// cross an edge when the held-prop delta is reconciled by registered bridging
// Transitions (acquire / release). The headline invariant the design names is
// "away へ行く前に必ず両手が空" — i.e. no edge may land holding a prop without a
// return bridge. This module proves the §6.2 catalog covers every real edge.
//
// Posture changes are intentionally NOT treated as violations: crossfade (or a
// documented posture bridge) reconciles posture. The warp risk this guards is
// hands/props, per §6.1.

import type { ModeId, PropId } from './types';
import { MODE_TABLE, PREV_SENTINEL } from './modeTable';

// §6.2 — bridge that RETURNS a held prop (detach → desk/head/off). Presence in
// this map is what makes an edge that drops a prop legal.
export const PROP_RETURN_BRIDGE: Record<PropId, string> = {
  controller: 'tr_controller_away',
  book: 'tr_book_close',
  phone: 'tr_phone_down',
  headphones: 'tr_headphone_off',
  cup: 'tr_place_desk_r', // generic place (cup is ambient-scoped, listed for completeness)
  snack_plate: 'tr_plate_push',
};

// §6.2 — bridge that ACQUIRES a prop into the hands/head.
export const PROP_ACQUIRE_BRIDGE: Record<PropId, string> = {
  controller: 'tr_controller_ready',
  book: 'tr_book_open',
  phone: 'tr_phone_raise',
  headphones: 'tr_headphone_on',
  cup: 'tr_take_desk_r',
  snack_plate: 'tr_plate_pull',
};

export interface EdgeCheck {
  from: ModeId;
  to: ModeId;
  ok: boolean;
  /** Bridges that must be played, in order, to reconcile the tuples. */
  bridges: string[];
  /** Reasons the edge is illegal (empty when ok). */
  violations: string[];
}

function heldSet(mode: ModeId): Set<PropId> {
  return new Set(MODE_TABLE[mode].state.held);
}

/** Reconcile from→to. away/sleep entry implicitly requires empty hands. */
export function checkEdge(from: ModeId, to: ModeId): EdgeCheck {
  const fromHeld = heldSet(from);
  const toHeld = heldSet(to);
  const bridges: string[] = [];
  const violations: string[] = [];

  // Props to release (held in from, not in to).
  for (const p of fromHeld) {
    if (!toHeld.has(p)) {
      const bridge = PROP_RETURN_BRIDGE[p];
      if (bridge) bridges.push(bridge);
      else violations.push(`dangling prop '${p}' on ${from}→${to}: no return bridge`);
    }
  }
  // Props to acquire (held in to, not in from).
  for (const p of toHeld) {
    if (!fromHeld.has(p)) {
      const bridge = PROP_ACQUIRE_BRIDGE[p];
      if (bridge) bridges.push(bridge);
      else violations.push(`unacquirable prop '${p}' on ${from}→${to}: no acquire bridge`);
    }
  }
  // Headline invariant (§6.1): away/sleep must be reached with empty hands.
  if (to === 'away_room' || to === 'sleep_desk') {
    const toState = MODE_TABLE[to].state;
    if (toState.hands.l !== 'empty' && toState.hands.l !== 'loose') {
      violations.push(`${to} entry hand L not empty/loose`);
    }
    // After releasing, nothing from `from` should remain held.
    for (const p of fromHeld) {
      if (!PROP_RETURN_BRIDGE[p]) violations.push(`${to} reached still holding '${p}'`);
    }
  }

  return { from, to, ok: violations.length === 0, bridges, violations };
}

/** Every real FSM edge (transitions + return tables, prev expanded over all). */
export function allRealEdges(): { from: ModeId; to: ModeId }[] {
  const edges: { from: ModeId; to: ModeId }[] = [];
  for (const mode of Object.keys(MODE_TABLE) as ModeId[]) {
    const spec = MODE_TABLE[mode];
    const list = spec.returnTable ?? spec.transitions;
    for (const e of list) {
      if ((e.to as string) === PREV_SENTINEL) {
        // away return-to-prev: prev can be any mode that transitions to away.
        for (const prev of Object.keys(MODE_TABLE) as ModeId[]) {
          if (prev === 'away_room') continue;
          edges.push({ from: mode, to: prev });
        }
      } else {
        edges.push({ from: mode, to: e.to });
      }
    }
  }
  return edges;
}

/** Check the whole reachable graph. Returns only the failing edges. */
export function auditGraph(): EdgeCheck[] {
  return allRealEdges()
    .map(({ from, to }) => checkEdge(from, to))
    .filter((c) => !c.ok);
}
