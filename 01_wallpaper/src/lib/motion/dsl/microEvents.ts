// Motion DSL — prop microEvent firing cursor (INF-4).
//
// Pure scheduling logic split out of the viewer so it is Node-testable without
// THREE/the mixer: given the clip-local time each frame, decide which timed
// attach/detach events to run NOW. The viewer owns the side effects (parenting
// the cup to a bone / returning it to rest); this only tracks WHAT and WHEN.
//
// Contract: each event fires exactly once, in array order, the first frame the
// clip time has reached its `t`. A loop wrap (time runs backwards) re-arms every
// event so a looping clip re-fires each cycle. Stateless except the passed
// cursor, so the same time sequence always yields the same firings.

import type { MicroEvent } from './types';

export interface MicroEventCursor {
  /** Indices already fired this pass (cleared on a loop wrap). */
  fired: Set<number>;
  /** Last clip-local time seen, to detect a backwards wrap. */
  lastTime: number;
}

export function makeMicroCursor(): MicroEventCursor {
  return { fired: new Set<number>(), lastTime: 0 };
}

/**
 * Advance the cursor to clip-local time `tNow` and return the indices of events
 * to fire now, in array order. Mutates `cursor` (fired set + lastTime). A small
 * epsilon makes a key authored exactly at a frame time fire on that frame.
 */
export function advanceMicroEvents(
  events: MicroEvent[],
  tNow: number,
  cursor: MicroEventCursor,
): number[] {
  if (tNow < cursor.lastTime - 1e-3) cursor.fired = new Set<number>(); // loop wrapped → re-arm
  cursor.lastTime = tNow;
  const out: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (cursor.fired.has(i)) continue;
    if (tNow + 1e-6 >= events[i].t) {
      out.push(i);
      cursor.fired.add(i);
    }
  }
  return out;
}
