// Expression Presets (Expression Preset System 0.2)
//
// Reusable facial-expression templates for the live wallpaper, built ONLY from
// what the model already ships: the VRM 0.x blendShapeMaster expressions the
// Custom Expression Bridge exposes (joy / fun / sorrow / angry / a-o / blink…)
// plus a curated set of RAW morph targets that exist on the face mesh but were
// never wired into a blendShapeGroup (びっくり, じと目, にやり, ぷくー…).
// Nothing is baked into the VRM; nothing is added to the GLB. The raw morphs
// are resolved BY NAME from mesh.morphTargetDictionary at load time and merely
// registered as extra named entries in the same runtime expression map the
// bridge already uses — a missing name is skipped with a warning, never faked.
//
// A preset is a *combination of weights on those names* — the wallpaper-scale
// "small expression" the brief calls for. Presets are pure data: no THREE, no
// React, no DOM — Node can import the compiled module for verification.
//
// 0.2 (2026-06-13, user review pass): weights now BAKE each preset's usable
// ceiling — intensity 1.0 is always the strongest face that still looks right
// on this model, so callers (debug UI / idle / motion cues) never need to
// remember per-preset caps. New per-preset behaviors: `flutter` (sine-wobbled
// intensity for sustained states like sleepy/bored) and `gaze` (fixed eye
// direction / wander damping — the cursor-follow LookAt is gone).
//
// Naming note: this model is VRM 0.x, so the canonical expression names are
// the 0.x preset names (joy / angry / sorrow / fun / a i u e o / blink /
// blinkleft / blinkright). The three-vrm 1.0 names map as:
//   happy→joy, relaxed→fun, sad→sorrow, aa→a, ih→i, ou→u, ee→e, oh→o.

// --- Derived expressions (raw morphs exposed as named expressions) -------------

export interface DerivedExpressionDef {
  /** Lowercase id registered into the bridge's expression map. */
  id: string;
  /** Exact morph-target names (and partial weights) as authored in the model. */
  morphs: { name: string; weight?: number }[];
  /** What the morph visually does (実測 2026-06-12, Lab captures). */
  description: string;
}

/**
 * Raw face morphs promoted to named expressions at runtime. IDs are romaji of
 * the MMD-style morph names so the source stays traceable. Only morphs that
 * presets below actually need (plus a couple of obviously useful spares) are
 * registered — the model has 68; the rest stay untouched.
 */
export const DERIVED_EXPRESSIONS: DerivedExpressionDef[] = [
  // --- eyes ---
  { id: 'bikkuri', morphs: [{ name: 'びっくり' }], description: '目を見開く（驚き）' },
  { id: 'jitome', morphs: [{ name: 'じと目' }], description: '半目・ジト目（不満/退屈/集中の目）' },
  { id: 'hau', morphs: [{ name: 'はぅ' }], description: '＞＜目（照れ・くしゃっと閉じ）' },
  { id: 'nagomi', morphs: [{ name: 'なごみ' }], description: 'なごみ目（穏やかな細目）' },
  { id: 'jiro', morphs: [{ name: 'じろ' }], description: '横目で睨む' },
  { id: 'uruuru', morphs: [{ name: 'うるうる' }], description: '瞳うるうる（涙ぐむ手前）' },
  // --- brows ---
  { id: 'majime', morphs: [{ name: '真面目' }], description: '真面目眉（集中・思案）' },
  { id: 'komaru', morphs: [{ name: '困る' }], description: '困り眉' },
  { id: 'ikari_mayu', morphs: [{ name: '怒り' }], description: '怒り眉（単体）' },
  { id: 'nikori_mayu', morphs: [{ name: 'にこり' }], description: 'にこり眉（単体）' },
  { id: 'mayu_ue', morphs: [{ name: '上' }], description: '眉を上げる（驚き・興味）' },
  { id: 'mayu_shita', morphs: [{ name: '下' }], description: '眉を下げる' },
  // --- mouth ---
  { id: 'niyari', morphs: [{ name: 'にやり' }], description: 'ニヤリ口（得意げ）' },
  { id: 'nishishi', morphs: [{ name: 'にしし' }], description: 'にしし口（いたずら笑い）' },
  { id: 'pukuu', morphs: [{ name: 'ぷくー' }], description: '頬ふくらませ（ぷくー）' },
  { id: 'pukuku', morphs: [{ name: 'ぷくく' }], description: '笑いをこらえる口' },
  { id: 'omega', morphs: [{ name: 'ω' }], description: 'ω口（猫口・かわいい休め口）' },
  { id: 'nn', morphs: [{ name: 'ん' }], description: '口を結ぶ（ん）' },
  { id: 'akire', morphs: [{ name: '呆れ' }], description: '呆れ口（はぁ…）' },
  { id: 'mouth_up', morphs: [{ name: '∧' }], description: '∧口（むっ）' },
];

export const DERIVED_EXPRESSION_NAMES: readonly string[] = DERIVED_EXPRESSIONS.map((d) => d.id);

/** blendShapeMaster expressions with real binds on this model (lowercase). */
export const STANDARD_EXPRESSION_NAMES: readonly string[] = [
  'a', 'i', 'u', 'e', 'o',
  'blink', 'blinkleft', 'blinkright',
  'joy', 'angry', 'sorrow', 'fun',
];

/** Every expression name a preset is allowed to reference. */
export const ALL_EXPRESSION_NAMES: ReadonlySet<string> = new Set([
  ...STANDARD_EXPRESSION_NAMES,
  ...DERIVED_EXPRESSION_NAMES,
]);

// --- Preset type ----------------------------------------------------------------

/**
 * Eye-direction hint, in DEGREES on the gaze panel (see gazeController.ts):
 * yaw+ = 画面右（本人の左）, pitch+ = 上. When yaw/pitch are present the eyes
 * hold that fixed direction while the preset is active (eased by the preset's
 * fade envelope). `wander` instead scales the idle gaze-wander amplitude
 * (0 = eyes parked near center, 1 = full wander). Mouse tracking no longer
 * exists — gaze is preset / motion / wander-pattern driven (0.2).
 */
export interface GazeHint {
  yaw?: number;
  pitch?: number;
  wander?: number;
}

/**
 * Sustained-state liveliness: the preset's *intensity* is multiplied by a slow
 * sine that wobbles between min..max (period seconds). Deterministic in t, so
 * motion cues / Lab scrubbing / runtime all agree. Example: sleepy flutters
 * 0.5..1.0 so the lids drift 0.17..0.33 — "ふらふら" per the 0.2 review.
 */
export interface IntensityFlutter {
  min: number;
  max: number;
  period: number;
}

export interface ExpressionPreset {
  id: string;
  label: string;
  description: string;
  /**
   * Expression name -> weight 0..1. Names are the model's bridge names
   * (standard + derived above). Merged into the frame by max-blend, so a
   * preset can never *reduce* what the manual expression / idle overlay set.
   * Weights are calibrated so intensity 1.0 == this preset's usable ceiling.
   */
  weights: Record<string, number>;
  /**
   * Eyelid channel, kept separate so the viewer can max-blend it with the
   * auto-blink ("whichever closes more wins" — a preset half-lid never fights
   * a full blink). halfLid uses partial まばたき, the established 0.2 approach.
   */
  eyelid?: {
    blink?: number;
    blinkLeft?: number;
    blinkRight?: number;
    halfLid?: number;
  };
  /** Eye-direction behavior while active (fixed direction and/or wander damp). */
  gaze?: GazeHint;
  /** Slow sine wobble applied to intensity while active (sustained states). */
  flutter?: IntensityFlutter;
  /** Recommended envelope when cueing this preset from a motion (seconds). */
  timing?: {
    fadeIn: number;
    hold: number;
    fadeOut: number;
  };
  /**
   * Tie-break when several cues overlap: the highest-priority active cue wins
   * the gaze hint and the debug "current preset" slot. Weights themselves are
   * max-blended regardless, so priority never makes a face *less* expressive.
   */
  priority?: number;
  /** How to drive intensity (catalog guidance for motion-idea authors). */
  intensityHint?: string;
  /** Approximations / tuning notes (近似・妥協点). */
  notes?: string;
}

// --- Preset table ------------------------------------------------------------------
//
// Amplitude policy (wallpaper-grade): every preset's weights bake its usable
// ceiling — "もっと強く" はモデル実測上もう破綻する、が intensity 1.0。
// States are sustainable for minutes; moments carry timing.

export const EXPRESSION_PRESETS: Record<string, ExpressionPreset> = {
  // ---- states (常時表示に耐える) -------------------------------------------------
  neutral_soft: {
    id: 'neutral_soft',
    label: 'やわらか基本顔',
    description: '真顔より少しだけ柔らかい待機顔。idle_breath の基準。',
    weights: { fun: 0.12 },
    timing: { fadeIn: 1.0, hold: 0, fadeOut: 1.0 },
    priority: 1,
    intensityHint: '常に1.0でよい',
    notes: 'fun はにこり眉65%+なごみ目の複合。0.12なら口は動かず目元だけ和らぐ。',
  },
  small_smile: {
    id: 'small_smile',
    label: '小さなほほえみ',
    description: '壁紙向きの控えめな微笑み。idle_small_smile 用。',
    weights: { fun: 0.24, omega: 0.16 },
    timing: { fadeIn: 0.9, hold: 0, fadeOut: 0.9 },
    priority: 1,
    intensityHint: '0.6〜1.0',
    notes: '0.2で旧版の0.8相当を上限として焼き込み（旧 fun0.3/omega0.2 は強すぎた）。',
  },
  smile: {
    id: 'smile',
    label: '微笑み',
    description: 'はっきり嬉しそうな微笑み。small_smile の上位版。',
    weights: { fun: 0.28, joy: 0.1 },
    timing: { fadeIn: 0.6, hold: 1.2, fadeOut: 0.8 },
    priority: 2,
    intensityHint: '0.7〜1.0（1.0が標準）',
    notes: '旧 glance_smile を改名（「ちら見」の視線は廃止し、表情だけ残した）。',
  },
  focused_monitor: {
    id: 'focused_monitor',
    label: 'PC作業に集中',
    description: 'モニタを見て作業中の顔。眉を真面目に、目をわずかに細め、口元の微笑を消す。',
    weights: { majime: 0.5, jitome: 0.2, nn: 0.15 },
    gaze: { wander: 0.35 },
    timing: { fadeIn: 1.0, hold: 0, fadeOut: 1.0 },
    priority: 1,
    intensityHint: '0.7〜1.0',
    notes: '眉は前髪に透けて見える程度（実測）なので majime は強めでよい。じと目は0.25超で不機嫌に見える。',
  },
  sleepy: {
    id: 'sleepy',
    label: '眠そう',
    description: '半目でとろんとした顔。idle_sleepy 用。怖くならない範囲の半目。',
    weights: { komaru: 0.07 },
    eyelid: { halfLid: 0.33 },
    gaze: { wander: 0.2 },
    flutter: { min: 0.5, max: 1.0, period: 6.0 },
    timing: { fadeIn: 1.2, hold: 0, fadeOut: 1.2 },
    priority: 1,
    intensityHint: 'flutterに任せる（強度1.0固定で 0.17〜0.33 の半目を往復）',
    notes: '0.2で上限を旧0.6相当に再較正（旧halfLid0.55は目が細すぎた）。半目はpartial blink方式。じと目だと冷たい目になるため不使用。',
  },
  bored: {
    id: 'bored',
    label: '退屈',
    description: 'やることがなくて気の抜けた顔。じと目+呆れ口。',
    weights: { jitome: 0.5, akire: 0.45, komaru: 0.12 },
    eyelid: { halfLid: 0.2 },
    gaze: { wander: 0.5 },
    flutter: { min: 0.8, max: 1.0, period: 5.0 },
    timing: { fadeIn: 1.0, hold: 0, fadeOut: 1.0 },
    priority: 1,
    intensityHint: 'flutterに任せる（強度1.0固定で 0.8〜1.0 をゆっくり往復）',
    notes: '呆れ口は既定の微笑を消す効果も兼ねる（実測でこのモデルの口morphは控えめ）。',
  },
  thinking: {
    id: 'thinking',
    label: '考え中',
    description: '視線をちょい上に外して思案する顔。眉は真面目、口を結ぶ。',
    weights: { majime: 0.6, nn: 0.35, mayu_ue: 0.25 },
    gaze: { yaw: 12, pitch: 18 },
    timing: { fadeIn: 0.8, hold: 0, fadeOut: 0.8 },
    priority: 1,
    intensityHint: '0.8〜1.0',
    notes: '目を上に逸らすmorphは無い（lookupはバインド空）— 0.2から視線固定（gaze）で「ちょい上」を実現。',
  },
  wry_smile: {
    id: 'wry_smile',
    label: 'あきれた笑み',
    description: '「もう、しょうがないなあ」のじと目笑い。退屈の目+ニヤリ口。',
    weights: { jitome: 0.5, komaru: 0.12, niyari: 0.6 },
    eyelid: { halfLid: 0.2 },
    timing: { fadeIn: 0.7, hold: 1.5, fadeOut: 0.9 },
    priority: 2,
    intensityHint: '0.7〜1.0',
    notes: '0.2追加。bored の口（呆れ）を笑み（にやり）へ差し替えた構成。',
  },

  // ---- moments (瞬間イベント) ---------------------------------------------------
  surprised_light: {
    id: 'surprised_light',
    label: '軽い驚き',
    description: 'おっ、と目を見開く軽い驚き。口は小さく開く。',
    weights: { bikkuri: 0.63, mayu_ue: 0.49, a: 0.11 },
    timing: { fadeIn: 0.15, hold: 0.8, fadeOut: 0.6 },
    priority: 3,
    intensityHint: '0.5〜1.0',
    notes: '0.2で上限を旧0.7相当に再較正（全開は驚きすぎた）。びっくりmorphが実在するため blink での誤魔化しは不要。',
  },
  annoyed: {
    id: 'annoyed',
    label: 'むっ',
    description: '少しむっとした顔。ジト目+への字口。',
    weights: { jitome: 0.6, ikari_mayu: 0.35, mouth_up: 0.4 },
    timing: { fadeIn: 0.5, hold: 1.5, fadeOut: 0.8 },
    priority: 2,
    intensityHint: '0.7〜1.0。「u」の口と重ねると頬を膨らませた不満顔になって特にかわいい',
    notes: 'angry(複合)ではなく単体morphで「怒りの一歩前」を合成。',
  },
  sad_soft: {
    id: 'sad_soft',
    label: '弱い困り顔',
    description: 'しょんぼり、を弱く。目は開いたまま困り眉で訴える。常用ではなく短時間向け。',
    weights: { komaru: 0.6, bikkuri: 0.4, mouth_up: 0.3 },
    timing: { fadeIn: 0.8, hold: 2.0, fadeOut: 1.2 },
    priority: 2,
    intensityHint: '0.5〜1.0',
    notes: '0.2再構成: sorrow複合の「はぅ目」は少量でも目が黒く潰れるため不採用。軽い驚きと同じ「びっくり目」+困り眉+∧口で困りを表現。',
  },
  smug: {
    id: 'smug',
    label: 'どや顔',
    description: 'ちょっと得意げなニヤリ顔。眉を上げ、左目をわずかに細めるアシンメトリー。',
    weights: { niyari: 0.75, nikori_mayu: 0.35, jitome: 0.25, mayu_ue: 0.35 },
    eyelid: { blinkLeft: 0.25 },
    timing: { fadeIn: 0.5, hold: 1.8, fadeOut: 0.8 },
    priority: 2,
    intensityHint: '0.7〜1.0',
    notes: 'にやり口が主役。0.2で眉上げ+左目の片側細めを追加（したり顔の非対称）。',
  },
  embarrassed: {
    id: 'embarrassed',
    label: '照れ（わはー）',
    description: '＞＜になって照れる顔。「わはー！」のテンション。',
    weights: { hau: 0.9, komaru: 0.4, omega: 0.3, uruuru: 0.3 },
    timing: { fadeIn: 0.3, hold: 1.5, fadeOut: 1.0 },
    priority: 3,
    intensityHint: '0か1のみ（中間強度は「はぅ」が睨み顔に見える・実測）',
    notes: '頬染め（blush）morphはモデルに存在しないため近似。fadeIn/Outも短めに保つこと。',
  },
  yawn: {
    id: 'yawn',
    label: 'あくび',
    description: '大口でふぁ〜。強度0→1→0の1往復が「入り→最大→戻り」のあくび1回分。',
    weights: { a: 0.8, komaru: 0.3 },
    eyelid: { blink: 0.85 },
    timing: { fadeIn: 0.8, hold: 0.9, fadeOut: 1.0 },
    priority: 3,
    intensityHint: '強度エンベロープであくび全体を表現（0.4≒入り、1.0=最大）。瞬間0/1には使わない',
    notes: '0.2で旧yawn_start/peak/endを1プリセットの強度管理に統合（うるうるは画面で読めず削除）。blinkを1.0にしないのは白目固まり回避。',
  },
};

export function getExpressionPreset(id: string): ExpressionPreset | undefined {
  return EXPRESSION_PRESETS[id];
}

export const EXPRESSION_PRESET_IDS: readonly string[] = Object.keys(EXPRESSION_PRESETS);

/**
 * Flutter multiplier at absolute/clip-local time t (1 when the preset has no
 * flutter). Pure in t — Lab scrubbing, runtime and Node tests all agree.
 */
export function flutterValue(preset: ExpressionPreset | undefined, t: number): number {
  const f = preset?.flutter;
  if (!f) return 1;
  const s = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / Math.max(1e-3, f.period));
  return f.min + (f.max - f.min) * s;
}

/**
 * Flatten a preset to bridge-name weights at a given intensity, eyelid
 * included (blink/halfLid collapse onto 'blink' by max — "more closed wins").
 * This is THE shape every downstream consumer merges with.
 */
export function flattenPresetWeights(preset: ExpressionPreset, intensity = 1): Record<string, number> {
  const k = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  const out: Record<string, number> = {};
  for (const [name, w] of Object.entries(preset.weights)) {
    const v = (w < 0 ? 0 : w > 1 ? 1 : w) * k;
    if (v > 0) out[name] = v;
  }
  const lid = preset.eyelid;
  if (lid) {
    const blink = Math.max(lid.blink ?? 0, lid.halfLid ?? 0) * k;
    if (blink > 0) out.blink = Math.max(out.blink ?? 0, blink);
    if (lid.blinkLeft) out.blinkleft = Math.max(out.blinkleft ?? 0, lid.blinkLeft * k);
    if (lid.blinkRight) out.blinkright = Math.max(out.blinkright ?? 0, lid.blinkRight * k);
  }
  return out;
}

/**
 * Idle-state helper: weights WITHOUT the eyelid channel (the idle machine
 * routes lids through its own extraBlink so the breathing-lid oscillation can
 * ride on top). Returns a fresh object safe to mutate.
 */
export function presetExprOverlay(id: string, intensity = 1): Record<string, number> {
  const preset = EXPRESSION_PRESETS[id];
  if (!preset) return {};
  const k = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  const out: Record<string, number> = {};
  for (const [name, w] of Object.entries(preset.weights)) {
    const v = (w < 0 ? 0 : w > 1 ? 1 : w) * k;
    if (v > 0) out[name] = v;
  }
  return out;
}
