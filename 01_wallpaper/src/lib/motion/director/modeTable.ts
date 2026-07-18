// Motion Director — the design table as data (Phase 0, Test C).
//
// Faithful transcription of docs/LIFE_MODE_DESIGN_2026-06-12.md:
//   §2  mode list / dwell minutes / family
//   §3.2 ambient interval / interrupt policy / chat delay / posture
//   §3.4 transition matrix + daypart multipliers
//   §4  per-mode Ambient pools (id / weight / 🌙 night override)
//   §6.1 state invariant tuples
//
// Pure data + a couple of lookups. No THREE, no globals. If the design doc
// changes, this file is the single place to re-sync.

import type { Daypart, ModeId, ModeSpec } from './types';

// `to` sentinel for away_room's "prev .60" return weight (§3.4): replaced with
// the actual previous mode at pick time by the FSM.
export const PREV_SENTINEL = '__prev__' as const;

function dp(m: number, mid: number, e: number, n: number, ln: number): Record<Daypart, number> {
  return { morning: m, midday: mid, evening: e, night: n, lateNight: ln };
}

export const MODE_TABLE: Record<ModeId, ModeSpec> = {
  work_normal: {
    id: 'work_normal',
    label: '通常作業',
    family: 'A',
    dwellMin: [15, 30],
    ambientIntervalSec: [25, 70],
    interrupt: 'immediate',
    chatDelayMsRange: [500, 1500],
    state: { posture: 'sit_pc_neutral', hands: { l: 'type_natural', r: 'type_natural' }, held: [] },
    transitions: [
      { to: 'work_focus', weight: 0.15 },
      { to: 'work_sleepy', weight: 0.1, dcaptSensitive: true },
      { to: 'video_relax', weight: 0.15 },
      { to: 'sleep_desk', weight: 0.15 },
      { to: 'game_controller', weight: 0.1 },
      { to: 'read_book', weight: 0.08 },
      { to: 'phone_browse', weight: 0.12 },
      { to: 'phone_call', weight: 0.02 },
      { to: 'snack_break', weight: 0.07 },
      { to: 'music_listen', weight: 0.08 },
      { to: 'away_room', weight: 0.15 },
    ],
    daypart: dp(1.2, 1.0, 1.0, 1.0, 0.6),
    ambients: [
      { id: 'amb_work_type_burst', weight: 4 },
      { id: 'amb_work_mouse_drift', weight: 4 },
      { id: 'amb_work_screen_scan', weight: 4 },
      { id: 'amb_work_sip', weight: 3, requiresProp: 'cup' },
      { id: 'amb_work_stretch', weight: 2 },
      { id: 'amb_work_posture_reset', weight: 3 },
      { id: 'amb_work_enter_phew', weight: 3 },
      { id: 'amb_work_neck_roll', weight: 2 },
      { id: 'amb_work_cheek_scratch', weight: 2 },
      { id: 'amb_work_memo_glance', weight: 2 },
      { id: 'amb_work_hair_tuck', weight: 2 },
      { id: 'amb_work_lean_check', weight: 2 },
      { id: 'amb_work_wrist_flex', weight: 2 },
      { id: 'amb_work_yawn_small', weight: 1, nightWeight: 3 },
      { id: 'amb_work_window_gaze', weight: 1 },
      { id: 'amb_work_window_gaze_mirror', weight: 1 },
    ],
  },

  work_focus: {
    id: 'work_focus',
    label: '集中作業',
    family: 'A',
    dwellMin: [5, 15],
    ambientIntervalSec: [40, 90],
    interrupt: 'soft',
    chatDelayMsRange: [2000, 4000],
    state: { posture: 'sit_pc_neutral', hands: { l: 'type_natural', r: 'type_natural' }, held: [] },
    transitions: [
      { to: 'work_normal', weight: 0.7 },
      { to: 'work_sleepy', weight: 0.1 },
      { to: 'away_room', weight: 0.2 },
    ],
    daypart: dp(1.3, 1.0, 0.8, 1.3, 0.7),
    ambients: [
      { id: 'amb_focus_stare_still', weight: 4 },
      { id: 'amb_focus_lean_hold', weight: 3 },
      { id: 'amb_focus_brow_knit', weight: 3 },
      { id: 'amb_focus_enter_breath', weight: 3 },
      { id: 'amb_focus_mouse_micro', weight: 3 },
      { id: 'amb_focus_think_pause', weight: 3 },
      { id: 'amb_focus_nod_small', weight: 2 },
      { id: 'amb_focus_lips_tight', weight: 2 },
      { id: 'amb_focus_mutter', weight: 1 },
      { id: 'amb_focus_shoulder_drop', weight: 1 },
      { id: 'amb_focus_time_glance', weight: 1 },
    ],
  },

  work_sleepy: {
    id: 'work_sleepy',
    label: 'うとうと作業',
    family: 'A',
    dwellMin: [4, 10],
    ambientIntervalSec: [15, 40],
    interrupt: 'soft',
    chatDelayMsRange: [2000, 5000],
    state: { posture: 'sit_pc_neutral', hands: { l: 'type_natural', r: 'loose' }, held: [] },
    transitions: [
      { to: 'work_normal', weight: 0.25 },
      { to: 'video_relax', weight: 0.1 },
      { to: 'away_room', weight: 0.15 },
      { to: 'sleep_desk', weight: 0.5, dcaptSensitive: true },
    ],
    daypart: dp(0.5, 0.7, 1.0, 1.5, 3.0),
    ambients: [
      { id: 'amb_slpy_head_bob', weight: 5 },
      { id: 'amb_slpy_eye_rub', weight: 4 },
      { id: 'amb_slpy_yawn_big', weight: 4 },
      { id: 'amb_slpy_elbow_chin', weight: 4 },
      { id: 'amb_slpy_slow_blink', weight: 4 },
      { id: 'amb_slpy_weak_type', weight: 3 },
      { id: 'amb_slpy_tilt_drift', weight: 3 },
      { id: 'amb_slpy_slump_preview', weight: 2 },
      { id: 'amb_slpy_refocus_shake', weight: 2 },
      { id: 'amb_slpy_sigh', weight: 2 },
      { id: 'amb_slpy_wrist_rub', weight: 2 },
      { id: 'amb_slpy_clock_check', weight: 1 },
      { id: 'amb_slpy_hair_face', weight: 1 },
    ],
  },

  video_relax: {
    id: 'video_relax',
    label: '動画視聴',
    family: "A'",
    dwellMin: [15, 30],
    ambientIntervalSec: [20, 50],
    interrupt: 'soft',
    chatDelayMsRange: [1000, 2500],
    state: { posture: 'sit_pc_slouch', hands: { l: 'loose', r: 'loose' }, held: [] },
    transitions: [
      { to: 'work_normal', weight: 0.4 },
      { to: 'sleep_desk', weight: 0.4, dcaptSensitive: true },
      { to: 'work_sleepy', weight: 0.15, dcaptSensitive: true },
      { to: 'game_controller', weight: 0.25 },
      { to: 'snack_break', weight: 0.1 },
      { to: 'away_room', weight: 0.1 },
    ],
    daypart: dp(0.7, 1.0, 1.2, 1.3, 0.8),
    ambients: [
      { id: 'amb_vid_chuckle', weight: 4 },
      { id: 'amb_vid_cheek_rest', weight: 4 },
      { id: 'amb_vid_grin', weight: 3 },
      { id: 'amb_vid_sink_back', weight: 3 },
      { id: 'amb_vid_replay_reach', weight: 3 },
      { id: 'amb_vid_sip', weight: 2, requiresProp: 'cup' },
      { id: 'amb_vid_eyes_widen', weight: 2 },
      { id: 'amb_vid_nod_watch', weight: 2 },
      { id: 'amb_vid_mouth_open', weight: 2 },
      { id: 'amb_vid_leg_shift', weight: 2 },
      { id: 'amb_vid_point_smile', weight: 1 },
      { id: 'amb_vid_drowse', weight: 1, nightWeight: 3 },
    ],
  },

  game_controller: {
    id: 'game_controller',
    label: 'ゲーム',
    family: 'B',
    dwellMin: [10, 25],
    ambientIntervalSec: [12, 30],
    interrupt: 'queued',
    chatDelayMsRange: [6000, 18000],
    state: {
      posture: 'sit_game',
      hands: { l: 'controller_grip', r: 'controller_grip' },
      held: ['controller'],
    },
    transitions: [
      { to: 'work_normal', weight: 0.4 },
      { to: 'video_relax', weight: 0.2 },
      { to: 'snack_break', weight: 0.25 },
      { to: 'away_room', weight: 0.15 },
    ],
    daypart: dp(0.5, 0.9, 1.2, 1.5, 0.8),
    ambients: [
      { id: 'amb_game_grip_adjust', weight: 4 },
      { id: 'amb_game_lean_battle', weight: 4 },
      { id: 'amb_game_body_steer_big', weight: 4 },
      { id: 'amb_game_button_mash', weight: 3 },
      { id: 'amb_game_win_smug', weight: 3 },
      { id: 'amb_game_lose_slump', weight: 3 },
      { id: 'amb_game_mouth_focus', weight: 3 },
      { id: 'amb_game_frust_puff', weight: 2 },
      { id: 'amb_game_peer_close', weight: 2 },
      { id: 'amb_game_pause_stretch', weight: 2 },
      { id: 'amb_game_victory_fist', weight: 2 },
      { id: 'amb_game_breath_reset', weight: 2 },
      { id: 'amb_game_losing_desk', weight: 1 },
      { id: 'amb_game_sip_nolook', weight: 1, requiresProp: 'cup' },
    ],
  },

  read_book: {
    id: 'read_book',
    label: '読書',
    family: 'B',
    dwellMin: [8, 20],
    ambientIntervalSec: [20, 55],
    interrupt: 'soft',
    chatDelayMsRange: [2000, 4000],
    state: { posture: 'sit_book', hands: { l: 'book_hold', r: 'book_hold' }, held: ['book'] },
    transitions: [
      { to: 'work_normal', weight: 0.5 },
      { to: 'work_sleepy', weight: 0.2 },
      { to: 'phone_browse', weight: 0.15 },
      { to: 'away_room', weight: 0.15 },
    ],
    daypart: dp(0.8, 1.0, 1.4, 1.4, 0.6),
    ambients: [
      { id: 'amb_book_page_turn', weight: 5 },
      { id: 'amb_book_soft_smile', weight: 3 },
      { id: 'amb_book_line_trace', weight: 3 },
      { id: 'amb_book_posture_shift', weight: 3 },
      { id: 'amb_book_tilt_question', weight: 2 },
      { id: 'amb_book_puzzled', weight: 2 },
      { id: 'amb_book_closer', weight: 2 },
      { id: 'amb_book_down_think', weight: 2 },
      { id: 'amb_book_eye_rest', weight: 2 },
      { id: 'amb_book_reread', weight: 2 },
      { id: 'amb_book_bookmark_touch', weight: 1 },
      { id: 'amb_book_sleepy_nod', weight: 1, nightWeight: 3 },
    ],
  },

  phone_browse: {
    id: 'phone_browse',
    label: 'スマホ',
    family: 'B',
    dwellMin: [3, 6],
    ambientIntervalSec: [10, 30],
    interrupt: 'immediate',
    chatDelayMsRange: [500, 1000],
    state: { posture: 'sit_phone', hands: { l: 'phone_grip', r: 'relax' }, held: ['phone'] },
    transitions: [
      { to: 'work_normal', weight: 0.6 },
      { to: 'video_relax', weight: 0.15 },
      { to: 'phone_call', weight: 0.05 },
      { to: 'music_listen', weight: 0.1 },
      { to: 'away_room', weight: 0.1 },
    ],
    daypart: dp(1.0, 1.0, 1.0, 1.0, 0.7),
    ambients: [
      { id: 'amb_ph_smile_screen', weight: 3 },
      { id: 'amb_ph_type_thumb', weight: 2 },
      { id: 'amb_ph_freeze_stare', weight: 2 },
      { id: 'amb_ph_chuckle_shake', weight: 2 },
      { id: 'amb_ph_notif_open', weight: 2 },
      { id: 'amb_ph_close_face', weight: 2 },
      { id: 'amb_ph_time_peek', weight: 2 },
      { id: 'amb_ph_tilt_landscape', weight: 1 },
      { id: 'amb_ph_put_down_up', weight: 1 },
    ],
  },

  phone_call: {
    id: 'phone_call',
    label: '電話',
    family: 'B',
    dwellMin: [2, 4],
    ambientIntervalSec: [8, 20],
    interrupt: 'unavailable',
    chatDelayMsRange: null, // 通話終了後にまとめて処理
    state: { posture: 'sit_phone', hands: { l: 'phone_grip', r: 'relax' }, held: ['phone'] },
    transitions: [
      { to: 'work_normal', weight: 0.7 },
      { to: 'phone_browse', weight: 0.1 },
      { to: 'away_room', weight: 0.2 },
    ],
    daypart: dp(0.5, 1.2, 1.2, 1.0, 0.0),
    ambients: [
      { id: 'amb_call_nod_listen', weight: 5 },
      { id: 'amb_call_laugh', weight: 3 },
      { id: 'amb_call_gaze_wander', weight: 3 },
      { id: 'amb_call_bow', weight: 3 },
      { id: 'amb_call_hmm_trouble', weight: 3 },
      { id: 'amb_call_switch_ear', weight: 2 },
      { id: 'amb_call_cover_mouth', weight: 2 },
      { id: 'amb_call_fidget_sleeve', weight: 2 },
      { id: 'amb_call_memo_glance', weight: 1 },
      { id: 'amb_call_wrapup_nod', weight: 2 },
    ],
  },

  snack_break: {
    id: 'snack_break',
    label: '休憩（おやつ）',
    family: 'B',
    dwellMin: [5, 10],
    ambientIntervalSec: [12, 30],
    interrupt: 'soft',
    chatDelayMsRange: [1000, 2000],
    // 皿は desk_center アンカー（手持ちではない）。snackは一過性。held は空。
    state: { posture: 'sit_pc_slouch', hands: { l: 'relax', r: 'pinch_snack' }, held: [] },
    transitions: [
      { to: 'work_normal', weight: 0.5 },
      { to: 'video_relax', weight: 0.25 },
      { to: 'game_controller', weight: 0.15 },
      { to: 'music_listen', weight: 0.1 },
    ],
    daypart: dp(0.7, 1.0, 1.0, 1.0, 0.5),
    ambients: [
      { id: 'amb_snk_pick_eat', weight: 5 },
      { id: 'amb_snk_chew_happy', weight: 4 },
      { id: 'amb_snk_choose_hover', weight: 3 },
      { id: 'amb_snk_blank_stare', weight: 3 },
      { id: 'amb_snk_lean_back', weight: 3 },
      { id: 'amb_snk_sip', weight: 3, requiresProp: 'cup' },
      { id: 'amb_snk_pc_peek', weight: 2 },
      { id: 'amb_snk_satisfied', weight: 2 },
      { id: 'amb_snk_wipe_mouth', weight: 2 },
      { id: 'amb_snk_dust_fingers', weight: 2 },
      { id: 'amb_snk_crumb_catch', weight: 1 },
      { id: 'amb_snk_last_joy', weight: 1 },
    ],
  },

  music_listen: {
    id: 'music_listen',
    // §2の原案は「音楽鑑賞」。2026-07-18 マスター命名で「音楽ノリノリ」に改名
    // （BPM連動リズムモード実装時。ポーズも sit_back_relax+headphones から
    // 「PC前で右腕を置き左手を耳にかざす」に置き換わった — loop_music_listen 参照）。
    label: '音楽ノリノリ',
    family: "A'",
    dwellMin: [10, 25],
    ambientIntervalSec: [15, 40],
    interrupt: 'soft',
    chatDelayMsRange: [1000, 2000],
    state: { posture: 'sit_back_relax', hands: { l: 'loose', r: 'loose' }, held: ['headphones'] },
    transitions: [
      { to: 'work_normal', weight: 0.5 },
      { to: 'work_sleepy', weight: 0.2, dcaptSensitive: true },
      { to: 'video_relax', weight: 0.15 },
      { to: 'away_room', weight: 0.15 },
    ],
    daypart: dp(0.8, 1.0, 1.5, 1.5, 0.7),
    ambients: [
      { id: 'amb_mus_head_beat', weight: 4 },
      { id: 'amb_mus_eyes_closed', weight: 4 },
      { id: 'amb_mus_finger_tap', weight: 3 },
      { id: 'amb_mus_shoulder_groove', weight: 3 },
      { id: 'amb_mus_hp_adjust', weight: 3 },
      { id: 'amb_mus_hum', weight: 2 },
      { id: 'amb_mus_track_glance', weight: 2 },
      { id: 'amb_mus_lean_immerse', weight: 2 },
      { id: 'amb_mus_fav_smile', weight: 2 },
      { id: 'amb_mus_volume_reach', weight: 1 },
      { id: 'amb_mus_lyrics_mouth', weight: 1 },
      { id: 'amb_mus_air_baton', weight: 1 },
    ],
  },

  away_room: {
    id: 'away_room',
    label: '離席',
    family: 'special',
    dwellMin: [3, 20],
    ambientIntervalSec: null, // モデル非表示
    interrupt: 'offline',
    chatDelayMsRange: null, // 帰還後にまとめて返信
    state: { posture: null, hands: { l: 'empty', r: 'empty' }, held: [] },
    transitions: [], // 復帰は returnTable
    returnTable: [
      { to: PREV_SENTINEL as unknown as ModeId, weight: 0.6 },
      { to: 'work_normal', weight: 0.25 },
      { to: 'snack_break', weight: 0.15 },
    ],
    daypart: dp(1.0, 1.2, 1.0, 1.0, 0.3),
    ambients: [],
  },

  sleep_desk: {
    id: 'sleep_desk',
    label: '睡眠（突っ伏し）',
    family: 'special',
    dwellMin: [15, 30],
    ambientIntervalSec: [30, 90],
    interrupt: 'asleep',
    chatDelayMsRange: null, // 原則無反応
    state: { posture: 'sit_desk_slump', hands: { l: 'loose', r: 'loose' }, held: [] },
    transitions: [], // 起床は returnTable
    returnTable: [
      { to: 'work_normal', weight: 0.5 },
      { to: 'video_relax', weight: 0.5 },
      { to: 'away_room', weight: 0.3 },
      { to: 'work_sleepy', weight: 0.2 },
    ],
    daypart: dp(0.3, 0.2, 0.5, 1.5, 4.0),
    ambients: [
      { id: 'amb_slp_head_shift', weight: 4 },
      { id: 'amb_slp_arm_repos', weight: 3 },
      { id: 'amb_slp_dream_smile', weight: 2 },
      { id: 'amb_slp_mumble', weight: 2 },
      { id: 'amb_slp_twitch', weight: 2 },
      { id: 'amb_slp_half_wake', weight: 2 },
      { id: 'amb_slp_breath_change', weight: 2 },
      { id: 'amb_slp_ear_itch', weight: 1 },
    ],
  },
};

/** Phase-1 mode subset (§7.3) — the "PC作業の一日" set. */
export const PHASE1_MODES: ModeId[] = [
  'work_normal',
  'work_sleepy',
  'sleep_desk',
  'video_relax',
  'away_room',
];

// --- Transition chains (Step 1 / Δ1) ----------------------------------------
//
// A mode change usually needs bridging one-shot Transition motions before the
// target loop can start (posture / prop / presence reconciliation, §6.1). This
// table is DATA: which authored transitions bridge which (from → to) edge, in
// play order. `to: '*'` is a wildcard fallback used only when no exact (from,to)
// row matches — e.g. waking from sleep_desk plays tr_slump_wake regardless of
// which sitting mode the FSM picked next.
//
// The Director resolves a chain here and the HOST filters it by what is actually
// authored/preloaded (like loopMotionFor); a not-yet-authored chain degrades
// gracefully to a direct loop swap. The `away_room` leave/return chains are the
// locomotion content (INF-7) and are resolved specially by the host in Step 4,
// so they are intentionally absent here.

export interface TransitionChain {
  from: ModeId;
  to: ModeId | '*';
  /** Authored transition motion ids, in play order (each loop:false). */
  motions: string[];
}

export const TRANSITION_TABLE: TransitionChain[] = [
  // work_sleepy → sleep_desk: lean onto the desk (slump). Authored.
  { from: 'work_sleepy', to: 'sleep_desk', motions: ['tr_sit_to_slump'] },
  // sleep_desk → any sitting mode: wake up off the desk first. Authored.
  { from: 'sleep_desk', to: '*', motions: ['tr_slump_wake'] },
  // work (neutral) ⇄ video (slouch): a short lean so the posture swap reads as
  // a deliberate recline / sit-up rather than an instant crossfade.
  { from: 'work_normal', to: 'video_relax', motions: ['tr_lean_back'] },
  { from: 'video_relax', to: 'work_normal', motions: ['tr_lean_forward'] },
  // Current primary runtime: the three completed loops can rotate directly.
  // video→sleep first sits back into the work pose, then folds onto the desk;
  // sleep→video wakes to sitting, then leans into the viewing pose.
  { from: 'work_normal', to: 'sleep_desk', motions: ['tr_sit_to_slump'] },
  { from: 'video_relax', to: 'sleep_desk', motions: ['tr_lean_forward', 'tr_sit_to_slump'] },
  { from: 'sleep_desk', to: 'video_relax', motions: ['tr_slump_wake', 'tr_lean_back'] },
  { from: 'work_sleepy', to: 'video_relax', motions: ['tr_lean_back'] },
  { from: 'video_relax', to: 'work_sleepy', motions: ['tr_lean_forward'] },
];

/**
 * Resolve the bridging transition chain for a (from → to) mode change. Returns
 * the authored ids in play order, or [] when no bridge is defined (the caller
 * then swaps straight to the target loop). Exact (from,to) wins over a `*` row.
 */
export function resolveTransitionChain(from: ModeId, to: ModeId): string[] {
  const exact = TRANSITION_TABLE.find((e) => e.from === from && e.to === to);
  if (exact) return exact.motions.slice();
  const wild = TRANSITION_TABLE.find((e) => e.from === from && e.to === '*');
  return wild ? wild.motions.slice() : [];
}
