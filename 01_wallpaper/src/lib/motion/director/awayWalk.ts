// Away leave/return locomotion sequencer (Step 4, INF-7).
//
// Pure + THREE-agnostic so it is Node-testable: given the elapsed time since the
// away sequence started, it returns which leg-cycle clip should be playing and
// the ABSOLUTE character root offset [x,y,z, rotY] (world meters / radians).
//
// Leg animation (stand/walk/stop/sit clips) is DSL; the across-room WORLD
// translation is driven here as a deterministic linear ramp (position = lerp of
// fixed endpoints by clamped progress) so FPS / pause never accumulate drift,
// and every round trip starts and ends at EXACTLY the chair (0,0,0,0). The host
// applies the returned root to vrm.scene (directorRoot) and toggles visibility.

export type Root4 = [number, number, number, number]; // x, y, z, rotY

export interface AwaySegment {
  phase: string;
  /** Seconds this segment lasts. */
  dur: number;
  /** DSL motion id to (cross)fade in when this segment becomes active. */
  motion: string;
}

// Leave: stand up at the chair → start walking → walk (leg loop) → stop.
export const LEAVE_SEQ: AwaySegment[] = [
  { phase: 'leave_stand', dur: 1.8, motion: 'tr_sit_to_stand' },
  { phase: 'leave_walk_start', dur: 0.8, motion: 'tr_walk_start' },
  { phase: 'leave_walk', dur: 2.4, motion: 'loop_walk' },
  { phase: 'leave_walk_stop', dur: 0.8, motion: 'tr_walk_stop' },
];

// Return: walk in from off-screen → stop at the chair → sit down.
export const RETURN_SEQ: AwaySegment[] = [
  { phase: 'return_walk_start', dur: 0.8, motion: 'tr_walk_start' },
  { phase: 'return_walk', dur: 2.4, motion: 'loop_walk' },
  { phase: 'return_walk_stop', dur: 0.8, motion: 'tr_walk_stop' },
  { phase: 'return_sit', dur: 1.8, motion: 'tr_stand_to_sit' },
];

/** All motion ids the away sequences play (for host preload). */
export const AWAY_MOTIONS: string[] = [
  ...new Set([...LEAVE_SEQ, ...RETURN_SEQ].map((s) => s.motion)),
];

export function seqDuration(seq: AwaySegment[]): number {
  return seq.reduce((a, s) => a + s.dur, 0);
}

export interface SeqPos {
  index: number;
  phase: string;
  motion: string;
  /** Time within the active segment. */
  localT: number;
  /** Elapsed has passed the last segment. */
  done: boolean;
}

/** Which segment is active at `elapsed` (clamped to the last on overrun). */
export function seqAt(seq: AwaySegment[], elapsed: number): SeqPos {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    if (elapsed < acc + seq[i].dur || i === seq.length - 1) {
      return { index: i, phase: seq[i].phase, motion: seq[i].motion, localT: elapsed - acc, done: elapsed >= seqDuration(seq) };
    }
    acc += seq[i].dur;
  }
  const last = seq[seq.length - 1];
  return { index: seq.length - 1, phase: last.phase, motion: last.motion, localT: last.dur, done: true };
}

export interface AwayRootParams {
  /** Off-screen target [x,z] in world meters (where she walks to). */
  off: [number, number];
  /** Chair [x,z] — usually [0,0] (the layout base is the seat). */
  chair: [number, number];
  /** Facing offset (radians, added to base +Z) while walking OUT. */
  faceY: number;
}

const smooth = (k: number): number => {
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  return c * c * (3 - 2 * c);
};

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * LEAVE root at `elapsed`: stand at the chair, turn to the walk facing during
 * walk_start, advance chair→off across the whole walk span, then hold at off.
 */
export function leaveRoot(elapsed: number, p: AwayRootParams): Root4 {
  const stand = LEAVE_SEQ[0].dur; // 1.8
  const walkSpan = seqDuration(LEAVE_SEQ) - stand; // 4.0
  const turnDur = LEAVE_SEQ[1].dur; // 0.8 (walk_start)
  if (elapsed <= stand) return [p.chair[0], 0, p.chair[1], 0];
  const into = elapsed - stand;
  const adv = smooth(into / walkSpan);
  const turn = smooth(into / turnDur);
  return [lerp(p.chair[0], p.off[0], adv), 0, lerp(p.chair[1], p.off[1], adv), p.faceY * turn];
}

/**
 * RETURN root at `elapsed`: walk off→chair (facing the walk-in direction =
 * opposite of leave), then sit while turning back to face the monitor (rotY 0).
 * At/after the end it is EXACTLY [chair, 0, chair, 0] (no drift on repeats).
 */
export function returnRoot(elapsed: number, p: AwayRootParams): Root4 {
  const walk = RETURN_SEQ[0].dur + RETURN_SEQ[1].dur + RETURN_SEQ[2].dur; // 4.0
  const sit = RETURN_SEQ[3].dur; // 1.8
  const faceIn = -p.faceY; // walking back faces the opposite way
  if (elapsed <= walk) {
    const adv = smooth(elapsed / walk);
    return [lerp(p.off[0], p.chair[0], adv), 0, lerp(p.off[1], p.chair[1], adv), faceIn];
  }
  const k = smooth((elapsed - walk) / sit);
  return [p.chair[0], 0, p.chair[1], faceIn * (1 - k)];
}
