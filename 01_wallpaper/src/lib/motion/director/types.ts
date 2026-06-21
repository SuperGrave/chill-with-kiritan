// Motion Director — shared types (Phase 0, Test C).
//
// Mirrors docs/LIFE_MODE_DESIGN_2026-06-12.md §2/§3/§5.7/§6.1. THREE-agnostic:
// these types describe the *behaviour* layer (which mode, which ambient, what
// the body is holding) and never touch THREE/VRM. The render layer (Motion
// Director 0.9) consumes the resolved ids to drive clips.

// ---- Modes (§2, 12 modes) --------------------------------------------------

export type ModeId =
  | 'work_normal'
  | 'work_focus'
  | 'work_sleepy'
  | 'video_relax'
  | 'game_controller'
  | 'read_book'
  | 'phone_browse'
  | 'phone_call'
  | 'snack_break'
  | 'music_listen'
  | 'away_room'
  | 'sleep_desk';

export const MODE_IDS: ModeId[] = [
  'work_normal',
  'work_focus',
  'work_sleepy',
  'video_relax',
  'game_controller',
  'read_book',
  'phone_browse',
  'phone_call',
  'snack_break',
  'music_listen',
  'away_room',
  'sleep_desk',
];

// ---- Daypart (§3.4) --------------------------------------------------------

export type Daypart = 'morning' | 'midday' | 'evening' | 'night' | 'lateNight';

// Hour ranges per §3.4: 朝6–10 / 昼10–17 / 夕17–20 / 夜20–24 / 深夜0–6.
export function daypartForHour(hour: number): Daypart {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 10) return 'morning';
  if (h >= 10 && h < 17) return 'midday';
  if (h >= 17 && h < 20) return 'evening';
  if (h >= 20 && h < 24) return 'night';
  return 'lateNight'; // 0–6
}

/** 深夜帯 0–6時: Ambient間隔1.5倍（§3.1）。 */
export function isLateNight(hour: number): boolean {
  return daypartForHour(hour) === 'lateNight';
}

// ---- Interrupt policy (§3.1 vocabulary; mode-owned, never AI-emitted) -------

export type InterruptPolicy =
  | 'immediate'
  | 'soft'
  | 'queued'
  | 'unavailable'
  | 'offline'
  | 'asleep';

// ---- State invariant tuple (§6.1) ------------------------------------------
//
// Every mode (and every transition endpoint) is characterised by what the body
// is doing. The FSM may only cross an edge when the bridging Transitions that
// reconcile two tuples exist. `posture: null` = model hidden (away).

export type HandShape =
  | 'relax'
  | 'type_natural'
  | 'mouse_grip'
  | 'controller_grip'
  | 'book_hold'
  | 'phone_grip'
  | 'pinch_snack'
  | 'cup_grip'
  | 'loose'
  | 'empty';

export type PropId =
  | 'cup'
  | 'phone'
  | 'controller'
  | 'book'
  | 'headphones'
  | 'snack_plate';

export type PropAnchor =
  | 'desk_left'
  | 'desk_center'
  | 'desk_right'
  | 'hand_l'
  | 'hand_r'
  | 'head'
  | 'off';

export interface StateTuple {
  posture: string | null; // null = hidden (away)
  hands: { l: HandShape; r: HandShape };
  /** Props currently bound to a body/head anchor (not desk-resting ones). */
  held: PropId[];
}

// ---- Mode spec (the design table as data) ----------------------------------

export interface AmbientDef {
  id: string;
  /** Base lottery weight 1..5 (§4). */
  weight: number;
  /** Night-only weight override (🌙). When set and lateNight, replaces weight. */
  nightWeight?: number;
  /** Requires a prop the base Phase-1 set may not have yet (e.g. cup). */
  requiresProp?: PropId;
}

export interface TransitionEdge {
  to: ModeId;
  /** Pre-normalisation relative weight (§3.4). */
  weight: number;
  /** `*` in §3.4 — daypart correction lands especially hard here. */
  dcaptSensitive?: boolean;
}

export interface ModeSpec {
  id: ModeId;
  label: string;
  family: 'A' | "A'" | 'B' | 'special';
  /** Dwell minutes [min,max] (§2). */
  dwellMin: [number, number];
  /** Ambient interval seconds [min,max] (§3.2). away/sleep may be null. */
  ambientIntervalSec: [number, number] | null;
  interrupt: InterruptPolicy;
  /** chat reply delay window ms; null = handled out-of-band (call/away/sleep). */
  chatDelayMsRange: [number, number] | null;
  /** Entry-state invariant tuple (§6.1). */
  state: StateTuple;
  /** Outgoing transition row (§3.4). Special modes use returnTable instead. */
  transitions: TransitionEdge[];
  /** Return/wake table for away_room & sleep_desk (§3.4 bottom rows). */
  returnTable?: TransitionEdge[];
  /** Daypart multiplier (§3.4). Order: morning/midday/evening/night/lateNight. */
  daypart: Record<Daypart, number>;
  /** Ambient pool (§4). Empty for away. */
  ambients: AmbientDef[];
}

// ---- kiritanState wire schema (§5.7; wallpaper → Companion) -----------------

export interface KiritanStateAway {
  reason: string;
  expectedReturnAt: string; // ISO
}

export interface KiritanState {
  mode: ModeId;
  modeLabel: string;
  since: string; // ISO
  prevMode: ModeId | null;
  presence: 'present' | 'away';
  ambient: { id: string; endsAt: string } | null;
  interruptPolicy: InterruptPolicy;
  chatDelayMsRange: [number, number] | null;
  sleepiness: number; // 0..1
  away: KiritanStateAway | null;
}
