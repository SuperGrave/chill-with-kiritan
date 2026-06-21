#!/usr/bin/env node
// bake_spring_motion.mjs — アプローチC: バネ・ダンパー物理ベイク
//
// 著者は「モータープログラム」(関節ごとの目標ポーズのステップ列)だけを書き、
// 各関節を固有周波数ω・減衰比ζの2次系(バネ・ダンパー)で目標追従シミュレート。
// 加減速・オーバーシュート・関節間の遅れ(カスケード)・減衰振動が物理から
// 自動で生まれる。Cascadeur の AutoPhysics / Overgrowth(GDC2014)の
// 「少数キーポーズ+物理補間」系譜のミニマム実装。
//
// 出力は素の public/motions/dsl/stretch_spring.motion.json(12fps密キー・linear)
// なので、Motion Lab・ランタイムの扱いは手書きモーションと完全に同一。
//
// 再生成:  node tools/bake_spring_motion.mjs
//
// 調整ポイント:
//   - BONES の events(目標切替時刻と値)= 演技
//   - omega(キビキビさ)/ zeta(<1でオーバーシュート量)= 質感
//   - RIGHT_LEAD = 利き腕の先行秒数(左右非対称)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', '01_wallpaper', 'public', 'motions', 'dsl', 'stretch_spring.motion.json');

const DURATION = 12;
const SAMPLE_FPS = 12;       // バネ出力は滑らか — linear密キーで十分
const SIM_DT = 1 / 240;
const WARMUP_LOOPS = 2;      // 周期定常に収束させてから最終ループを記録
const RIGHT_LEAD = 0.2;      // 右(利き腕側)が先に動く

// ミラー [x,-y,-z]: stand_relaxed / relax.hand / test_stretch の左右対応と同一規約
const mirrorE = ([x, y, z]) => [x, -y, -z];
const mirrorEvents = (events, lead = 0) =>
  events.map(([t, e]) => [t === 0 ? 0 : Math.max(0.01, +(t - lead).toFixed(3)), mirrorE(e)]);

// --- モータープログラム(左基準。右は mirror + RIGHT_LEAD 先行) -------------
// 演技構造: 待機 → 1.2溜め → 2.2上昇(肘は深く曲げてから伸びる=弧) →
//           ピーク → 6.0もうひと押し → 6.9微サグ → 7.5脱力(肘先行) → 静定
const Z3 = [0, 0, 0];

/** @type {Record<string, {omega:number, zeta:number, events:[number, number[]][]}>} */
const BONES = {
  spine: { omega: 4.5, zeta: 1.0, events: [[0, Z3], [1.2, [0.05, 0, 0]], [2.4, [-0.13, 0, 0.025]], [6.0, [-0.17, 0, 0.03]], [7.5, [0.07, 0, 0.01]], [8.8, Z3]] },
  chest: { omega: 4.5, zeta: 1.0, events: [[0, Z3], [1.2, [0.03, 0, 0]], [2.4, [-0.07, 0, 0.015]], [6.0, [-0.09, 0, 0.02]], [7.5, [0.05, 0, 0.005]], [8.8, Z3]] },
  neck: { omega: 6, zeta: 0.95, events: [[0, Z3], [1.2, [0.05, 0, 0]], [2.45, [-0.11, 0, 0]], [6.0, [-0.13, 0, 0.01]], [7.55, [0.09, 0, 0.005]], [8.7, Z3]] },
  head: { omega: 7, zeta: 0.85, events: [[0, Z3], [1.2, [0.07, 0, 0]], [2.5, [-0.22, 0, 0.04]], [5.6, [-0.25, -0.02, 0.08]], [7.0, [-0.16, 0, 0.05]], [7.6, [0.12, 0, 0.01]], [8.6, Z3]] },
  leftShoulder: { omega: 6, zeta: 0.9, events: [[0, Z3], [1.2, [0, 0, -0.05]], [2.3, [0, 0, -0.15]], [6.0, [0, 0, -0.17]], [7.5, Z3]] },
  leftUpperArm: { omega: 7, zeta: 0.72, events: [[0, Z3], [1.2, [0, 0.06, 0.12]], [2.25, [0, -0.5, -1.1]], [3.0, [0, -0.33, -2.0]], [6.0, [0, -0.36, -2.1]], [6.9, [0, -0.3, -1.95]], [7.55, Z3]] },
  leftLowerArm: { omega: 10, zeta: 0.68, events: [[0, Z3], [1.2, [0, -0.3, -0.22]], [2.3, [0, -0.95, -0.6]], [3.6, [0, -0.12, -0.08]], [6.0, [0, -0.08, -0.05]], [7.5, [0, -0.5, -0.35]], [8.0, Z3]] },
  leftHand: { omega: 13, zeta: 0.6, events: [[0, Z3], [1.2, [0, 0, 0.06]], [2.4, [0, 0, 0.22]], [3.8, [0, 0, -0.1]], [7.5, [0, 0, 0.25]], [8.1, Z3]] },
};

// 右半身: 左のミラー + 先行
for (const [left, right] of [
  ['leftShoulder', 'rightShoulder'],
  ['leftUpperArm', 'rightUpperArm'],
  ['leftLowerArm', 'rightLowerArm'],
  ['leftHand', 'rightHand'],
]) {
  BONES[right] = { ...BONES[left], events: mirrorEvents(BONES[left].events, RIGHT_LEAD) };
}

// 指: ピークでピンと開く(relaxカールをoffsetで打ち消す)→ 脱力で余分にカール→静定。
// ω16/ζ0.62 なので目標切替のたびに小さくバウンスする(プルプル感は物理由来)。
const FINGER_SPLAY = { index: 0.38, middle: 0.46, ring: 0.43, little: 0.37 };
const fingerEvents = (amp) => [
  [0, Z3], [4.2, [0, 0, -amp]], [6.0, [0, 0, -(amp + 0.04)]], [7.45, [0, 0, 0.10]], [8.2, Z3],
];
for (const [finger, amp] of Object.entries(FINGER_SPLAY)) {
  const cap = finger[0].toUpperCase() + finger.slice(1);
  const prox = fingerEvents(amp);
  const inter = fingerEvents(amp + 0.04);
  BONES[`left${cap}Proximal`] = { omega: 16, zeta: 0.62, events: prox };
  BONES[`left${cap}Intermediate`] = { omega: 16, zeta: 0.62, events: inter };
  BONES[`right${cap}Proximal`] = { omega: 16, zeta: 0.62, events: mirrorEvents(prox, 0.15) };
  BONES[`right${cap}Intermediate`] = { omega: 16, zeta: 0.62, events: mirrorEvents(inter, 0.15) };
}
const thumbEvents = (a, b, flop) => [
  [0, Z3], [4.2, [0, -a, 0]], [6.0, [0, -b, 0]], [7.45, [0, flop, 0]], [8.2, Z3],
];
BONES.leftThumbMetacarpal = { omega: 16, zeta: 0.62, events: thumbEvents(0.15, 0.17, 0.05) };
BONES.leftThumbProximal = { omega: 16, zeta: 0.62, events: thumbEvents(0.17, 0.19, 0.06) };
BONES.rightThumbMetacarpal = { omega: 16, zeta: 0.62, events: mirrorEvents(BONES.leftThumbMetacarpal.events, 0.15) };
BONES.rightThumbProximal = { omega: 16, zeta: 0.62, events: mirrorEvents(BONES.leftThumbProximal.events, 0.15) };

// --- バネ・ダンパー シミュレーション(semi-implicit Euler, 軸独立) ------------
function simulateBone({ omega, zeta, events }) {
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  const targetAt = (tm) => {
    let tg = sorted[0][1];
    for (const [et, e] of sorted) {
      if (et <= tm + 1e-9) tg = e;
      else break;
    }
    return tg;
  };

  const x = [...sorted[0][1]];
  const v = [0, 0, 0];
  const total = DURATION * (WARMUP_LOOPS + 1);
  const recordStart = DURATION * WARMUP_LOOPS;
  const sampleCount = DURATION * SAMPLE_FPS; // +1 for the end sample
  const samples = [];
  let nextSampleIdx = 0;

  for (let step = 0, t = 0; t <= total + SIM_DT / 2; step++, t = step * SIM_DT) {
    while (nextSampleIdx <= sampleCount) {
      const st = recordStart + nextSampleIdx / SAMPLE_FPS;
      if (t < st - 1e-9) break;
      samples.push({
        t: Math.round((nextSampleIdx / SAMPLE_FPS) * 10000) / 10000,
        e: x.map((c) => Math.round(c * 10000) / 10000),
      });
      nextSampleIdx++;
    }
    const tg = targetAt(t % DURATION);
    for (let i = 0; i < 3; i++) {
      const a = omega * omega * (tg[i] - x[i]) - 2 * zeta * omega * v[i];
      v[i] += a * SIM_DT;
      x[i] += v[i] * SIM_DT;
    }
  }
  if (samples.length !== sampleCount + 1) {
    throw new Error(`sample count mismatch: ${samples.length} != ${sampleCount + 1}`);
  }
  return samples;
}

// --- ベイク -----------------------------------------------------------------
const tracks = {};
let worstSeam = 0;
let worstBone = null;
for (const [bone, cfg] of Object.entries(BONES)) {
  const keys = simulateBone(cfg);
  const first = keys[0];
  const last = keys[keys.length - 1];
  const seam = Math.max(...first.e.map((c, i) => Math.abs(c - last.e[i])));
  if (seam > worstSeam) { worstSeam = seam; worstBone = bone; }
  last.e = [...first.e]; // 定常化済みの微小残差を数値的に閉じる
  tracks[bone] = { keys };
}
if (worstSeam > 0.02) {
  console.warn(`⚠ seam residual ${worstSeam.toFixed(4)} rad (${worstBone}) — WARMUP_LOOPS を増やすこと`);
}

const doc = {
  schema: 'motion/1',
  id: 'stretch_spring',
  label: '伸び・改(バネ物理ベイク)',
  notes: `アプローチC: tools/bake_spring_motion.mjs が生成(手編集禁止・再生成は node tools/bake_spring_motion.mjs)。関節ごとのバネ・ダンパー(ω=剛性, ζ=減衰)が少数の目標ポーズ列を追従した軌道を${SAMPLE_FPS}fpsでベイク。オーバーシュート・カスケード遅延・減衰振動は物理由来。ブリーフ: motion_briefs/stretch_spring.md`,
  category: 'idle_break',
  tags: ['calm', 'cute', 'v2-spring', 'generated'],
  posture: 'stand_relaxed',
  duration: DURATION,
  loop: true,
  fadeIn: 1.0,
  fadeOut: 1.0,
  hands: { left: 'relax', right: 'relax' },
  tracks,
  oscillators: [
    { bone: 'chest', axis: 'x', amp: 0.03, period: 4.0 },
  ],
  expressions: {
    keys: [
      { t: 0, set: {} },
      { t: 3.0, set: { blink: 0.4 }, fade: 1.0 },
      { t: 4.8, set: { blink: 1.0, u: 0.3 }, fade: 1.0 },
      { t: 6.2, set: { blink: 1.0, u: 0.2, fun: 0.15 }, fade: 0.8 },
      { t: 7.5, set: { blink: 0.85, a: 0.25 }, fade: 0.35 },
      { t: 8.5, set: { blink: 0.4, a: 0.12, fun: 0.3 }, fade: 0.8 },
      { t: 9.7, set: { fun: 0.45 }, fade: 1.0 },
      { t: 11.6, set: {}, fade: 1.4 },
    ],
  },
  lookAt: { mode: 'camera', strength: 0.7 },
};

// --- シリアライズ(キー1行ずつ = 差分と目視に優しい) -------------------------
function serialize(d) {
  const top = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === 'tracks') {
      const boneLines = Object.entries(v).map(([bone, track]) => {
        const keyLines = track.keys.map((key) => `        { "t": ${key.t}, "e": [${key.e.join(', ')}], "ease": "linear" }`);
        return `    "${bone}": { "keys": [\n${keyLines.join(',\n')}\n    ] }`;
      });
      top.push(`  "tracks": {\n${boneLines.join(',\n')}\n  }`);
    } else if (k === 'oscillators') {
      top.push(`  "oscillators": [\n${v.map((o) => `    ${JSON.stringify(o)}`).join(',\n')}\n  ]`);
    } else if (k === 'expressions') {
      top.push(`  "expressions": { "keys": [\n${v.keys.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ] }`);
    } else {
      top.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
  }
  return `{\n${top.join(',\n')}\n}\n`;
}

const json = serialize(doc);
JSON.parse(json); // self-check
writeFileSync(OUT_PATH, json, 'utf8');

const keyTotal = Object.values(tracks).reduce((n, tr) => n + tr.keys.length, 0);
console.log(`✔ stretch_spring.motion.json baked`);
console.log(`  bones: ${Object.keys(tracks).length}, keys: ${keyTotal}, size: ${(json.length / 1024).toFixed(0)} KB`);
console.log(`  loop-seam residual before clamp: ${worstSeam.toFixed(5)} rad (${worstBone ?? '-'})`);
