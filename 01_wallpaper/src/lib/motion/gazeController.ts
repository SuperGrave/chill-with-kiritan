// Gaze Controller (Expression Preset System 0.2 / Motion Director 前段)
//
// 視線の最終決定器。マウス追尾は 0.2 で廃止 — 視線のソースは
//   1. 待機ワンダー（数秒ごとに小さなサッカードで視線を移すランダムパターン）
//   2. アイドルステートの固定視線（glance→正面、monitor→画面右下 など）
//   3. 表情プリセットの gaze ヒント（thinking→ちょい上、UIオーバーレイ/モーションcue）
//   4. モーションDSLの gaze トラック（明示指定が最優先）
// で、後のレイヤほど強い。各レイヤは {yaw, pitch, k} （k=0..1 のブレンド率）で
// 渡され、k はそれぞれの持ち主（クロスフェード／cueエンベロープ／clip weight）が
// 育てるので、ここでは純粋に合成だけを行う。
//
// 座標系（"gaze panel"）: キャラ正面 1m の仮想平面上の注視点を度数で表す。
//   yaw+  = 画面右（本人の左） / pitch+ = 上 / (0,0) = 正面（目線やや下の既定）
// VrmViewer が tan() でワールド座標へ変換して VRMLookAt のターゲットに置く。
// 度数なのは著作・ブリーフ指示の単位を直感的にするため（ボーンはラジアンのまま）。
//
// House rules: フレームワーク非依存・THREE 非依存・蓄積なし（ワンダーの目標値
// 以外に状態を持たず、出力は毎フレーム合成し直す）。Node で検証可能。

export interface GazeDir {
  yaw: number;   // degrees
  pitch: number; // degrees
}

export interface GazeFix extends GazeDir {
  /** 0..1 — how strongly this layer pulls the gaze to its direction. */
  k: number;
}

export const GAZE_FIX_OFF: GazeFix = { yaw: 0, pitch: 0, k: 0 };

/**
 * Named gaze directions for briefs / the motion DSL. 画面基準
 * （left = 画面左 = 本人の右側を見る）。'camera' だけは特別扱いで、実カメラの
 * 方向（本当のカメラ目線）にランタイム/Labが解決する。
 */
export const GAZE_DIRECTIONS: Record<string, GazeDir | 'camera'> = {
  camera: 'camera',
  front: { yaw: 0, pitch: 0 },
  up: { yaw: 0, pitch: 16 },
  down: { yaw: 0, pitch: -18 },
  left: { yaw: -18, pitch: 0 },
  right: { yaw: 18, pitch: 0 },
  up_left: { yaw: -13, pitch: 13 },
  up_right: { yaw: 13, pitch: 13 },
  down_left: { yaw: -13, pitch: -14 },
  down_right: { yaw: 13, pitch: -14 },
  /** 遠くを見る（わずかに上向きで焦点を外した感じ） */
  away_left: { yaw: -26, pitch: 5 },
  away_right: { yaw: 26, pitch: 5 },
};

export const GAZE_DIRECTION_NAMES: readonly string[] = Object.keys(GAZE_DIRECTIONS);

/** Hard output clamp — VRMLookAt の rangeMap 外まで要求しても意味がないため。 */
const YAW_LIMIT = 35;
const PITCH_LIMIT = 25;

/** Wander pattern bounds (degrees) — 壁紙として落ち着く小さなきょろきょろ。 */
const WANDER_YAW = 12;
const WANDER_PITCH_UP = 7;
const WANDER_PITCH_DOWN = 5;

export interface GazeInputs {
  /** Idle machine: wander amplitude multiplier (its lookAtStrength, 0..1). */
  idleWander?: number;
  /** Idle state fixed gaze (e.g. glance→front). */
  idleFix?: GazeFix;
  /** Expression layer wander multiplier (preset gaze.wander, eased). */
  exprWander?: number;
  /** Debug-UI preset overlay fixed gaze. */
  overlayFix?: GazeFix;
  /** Motion expression-cue fixed gaze (winner preset's hint × clip weight). */
  cueFix?: GazeFix;
  /** Motion DSL gaze track (explicit author intent × clip weight) — strongest. */
  motionFix?: GazeFix;
}

export interface GazeDebug {
  yaw: number;
  pitch: number;
  wanderTarget: GazeDir;
  holdRemaining: number;
}

// --- panel <-> world conversion (THREE-free plain math) -----------------------------
//
// The gaze panel hangs 1m in front of the face anchor (0, GAZE_ANCHOR_Y, 0).
// A GazeDir maps to the world point the VRMLookAt target is placed at; the
// inverse maps a world offset (e.g. toward the camera) back into degrees.

export const GAZE_ANCHOR_Y = 1.35;
export const GAZE_PANEL_DIST = 1.0;

const DEG = Math.PI / 180;

/** GazeDir -> world-ish target point for the VRMLookAt target object. */
export function gazeDirToPanelPoint(dir: GazeDir): { x: number; y: number; z: number } {
  return {
    x: Math.tan(clamp(dir.yaw, -YAW_LIMIT, YAW_LIMIT) * DEG) * GAZE_PANEL_DIST,
    y: GAZE_ANCHOR_Y + Math.tan(clamp(dir.pitch, -PITCH_LIMIT, PITCH_LIMIT) * DEG) * GAZE_PANEL_DIST,
    z: GAZE_PANEL_DIST,
  };
}

/** World offset from the face anchor (dx, dy, dz) -> GazeDir (e.g. toward the camera). */
export function offsetToGazeDir(dx: number, dy: number, dz: number): GazeDir {
  const z = Math.max(1e-3, dz);
  return {
    yaw: Math.atan2(dx, z) / DEG,
    pitch: Math.atan2(dy, Math.max(1e-3, Math.hypot(dx, z))) / DEG,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mixToward(base: GazeDir, fix: GazeFix | undefined): GazeDir {
  if (!fix || fix.k <= 0) return base;
  const k = clamp(fix.k, 0, 1);
  return {
    yaw: base.yaw + (fix.yaw - base.yaw) * k,
    pitch: base.pitch + (fix.pitch - base.pitch) * k,
  };
}

/**
 * Owns the wander pattern and composes the gaze layers each frame. The wander
 * is a saccade-and-hold random walk: pick a small offset, hold it 1.2–4s,
 * sometimes return to center (people re-center far more often than they roam).
 * The OUTPUT is the instantaneous *target* direction — the viewer applies its
 * own exponential smoothing toward it, which turns the discrete saccade jumps
 * into quick natural eye darts.
 */
export class GazeController {
  private time = 0;
  private holdUntil = 0;
  private wanderTarget: GazeDir = { yaw: 0, pitch: 0 };
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  update(dt: number, inputs: GazeInputs): GazeDir {
    this.time += dt;

    // Advance the wander pattern (saccade + hold).
    if (this.time >= this.holdUntil) {
      this.holdUntil = this.time + 1.2 + this.rng() * 2.8;
      if (this.rng() < 0.35) {
        this.wanderTarget = { yaw: 0, pitch: 0 }; // re-center
      } else {
        this.wanderTarget = {
          yaw: (this.rng() * 2 - 1) * WANDER_YAW,
          pitch: -WANDER_PITCH_DOWN + this.rng() * (WANDER_PITCH_UP + WANDER_PITCH_DOWN),
        };
      }
    }

    const wanderAmp = clamp(inputs.idleWander ?? 1, 0, 1) * clamp(inputs.exprWander ?? 1, 0, 1);
    let dir: GazeDir = {
      yaw: this.wanderTarget.yaw * wanderAmp,
      pitch: this.wanderTarget.pitch * wanderAmp,
    };

    // Layer the fixed-direction sources, weakest -> strongest.
    dir = mixToward(dir, inputs.idleFix);
    dir = mixToward(dir, inputs.overlayFix);
    dir = mixToward(dir, inputs.cueFix);
    dir = mixToward(dir, inputs.motionFix);

    return {
      yaw: clamp(dir.yaw, -YAW_LIMIT, YAW_LIMIT),
      pitch: clamp(dir.pitch, -PITCH_LIMIT, PITCH_LIMIT),
    };
  }

  getDebug(): GazeDebug {
    return {
      yaw: this.wanderTarget.yaw,
      pitch: this.wanderTarget.pitch,
      wanderTarget: { ...this.wanderTarget },
      holdRemaining: Math.max(0, this.holdUntil - this.time),
    };
  }
}
