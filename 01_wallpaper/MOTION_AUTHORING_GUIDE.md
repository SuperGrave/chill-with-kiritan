# MOTION AUTHORING GUIDE — Motion Lab 0.7

**対象読者: モーションを著作するエージェント（別セッションのClaude含む）。**
このガイドだけで、コールドスタートから「ブリーフ→ .motion.json 執筆 → キャプチャ目視 → 修正反復 → 確定」の著作ループを回せるように書いてある。記載の軸・符号はすべて 2026-06-11 に実機キャプチャで実測検証済み。

---

## 1. クイックスタート

```
# devサーバ起動（リポジトリルートの .claude/launch.json に "probe" 定義あり）
#   → preview_start("probe") / または:
npm --prefix 01_wallpaper run dev -- --port 5187 --strictPort

# Lab有効化: ブラウザで ?lab=1 を付けて開く
http://localhost:5187/?lab=1
```

エージェントは **preview_eval で `window.__motionLab` を直接叩く**（UI操作不要）。
ページロード直後はVRM（31.6MB）の読込待ちが必要：

```js
// 定型: VRMロード待ち
for (let i = 0; i < 60; i++) {
  if (window.__motionLab?.status().vrmLoaded) break;
  await new Promise(r => setTimeout(r, 500));
}
```

`__motionLab.help()` がAPI早見表を返す。**全APIは絶対にthrowせず `{ ok, ... }` を返す**。`ok:false` のときは `errors[].path` / `errors[].message` に修正方法が書いてある。

> **重要（既知の罠）**: `src/` のコードを編集した後は **必ず `window.location.reload()`**。viteのHMRはLabインスタンスを差し替えないことがある（旧コードのまま動き続ける）。`.motion.json` 等のデータ編集はリロード不要 — `load()` が毎回キャッシュバスト付きで再fetchする。

---

## 2. ファイル配置

| 種類 | 場所 | 命名 |
|------|------|------|
| モーション | `public/motions/dsl/` | `<id>.motion.json`（idとファイル名を一致させる） |
| ベースポーズ | `public/poses/` | `<id>.pose.json` |
| ハンドシェイプ | `public/poses/hands/` | `<id>.hand.json` |
| ブリーフ（依頼書） | `motion_briefs/` | `<id>.md` ＋ 任意のスケッチ画像（テンプレ: `_TEMPLATE.md`） |
| キャプチャ出力 | `.probe_tmp/captures/<id>/` | Lab が自動生成（リポジトリ非同梱） |

存在するアセットの一覧は `await __motionLab.ls()` で取れる。

---

## 3. 著作ループ（標準手順）

```js
// 1) ブリーフを読む（motion_briefs/<id>.md ＋ 画像があれば Read で見る）
// 2) public/motions/dsl/<id>.motion.json を書く（Writeツールで直接）

// 3) ロード＆バリデーション（編集のたびに再実行）
const r = await __motionLab.load('my_motion');   // r.ok / r.errors / r.warnings / r.info

// 4) ループ継ぎ目の数値チェック
__motionLab.checkLoop('my_motion');              // ok / maxBoneDelta / worstBone

// 5) キー時刻でまとめてキャプチャ → 返ってきた絶対パスのPNGを Read で目視
await __motionLab.captureSet('my_motion', [0, 2, 4, 6], {
  camera: { position: [0, 1.1, 2.1], target: [0, 1.0, 0], fov: 40 },  // 立ち全身の定番
  settle: 1.0,
});
// 顔の演技は: { camera: 'face close' }

// 6) 気になる箇所を JSON 修正 → 3) へ戻る（2〜4周が目安）

// 7) ランタイム経路（本物のAnimationMixer）で最終確認
__motionLab.play('my_motion');
// → status().external が { clipSource:'dsl', playing:true, weight:1 } になればOK
__motionLab.stop();   // アイドルへクロスフェード復帰

// 後片付け（凍結解除・小道具表示）
__motionLab.thaw(); __motionLab.setPropsVisible(true);
```

補助API:
- `samplePose(id, t)` — 全ボーンの数値ダンプ（posture/hand/offset別）
- `show(id, t, opts)` — 保存せず画面に表示だけ（rAF凍結）
- `capture(..., { file: 'my_motion/label.png' })` — 保存名の明示
- `setPropsVisible(false)` — 机・椅子・ノートPCを隠してポーズを見やすく
- カメラプリセット: `desk wide / face close / monitor side / workdesk_front / workdesk_side / workdesk_close`

**品質チェックリスト（確定前に全部YES）**
- [ ] `load()` warnings ゼロ（radians警告・seam警告は必ず解消）
- [ ] `checkLoop()` ok（loop=true時）
- [ ] キー時刻すべて＋経過の中間1〜2点をキャプチャ目視（経過ポーズの硬直に注意 — 直線軌道はキーを1個足して弧にする）
- [ ] 顔アップ1枚（表情・視線）
- [ ] `play()` でミキサー経路の再生確認

---

## 4. 実測済み 軸・符号 早見表（このモデル・このリグでの検証値）

座標はすべて **normalized rig のボーンローカル、ラジアン、XYZオイラー**。キャラは常にカメラ正面向き（**画面右 = 本人の左**）。

### 体幹・頭（head / neck / spine / chest）
| 値 | 動き |
|----|------|
| `+x` | うつむく・前傾（0.2ではっきり、0.4で深い） |
| `−x` | 見上げる・反る |
| `+y` | **本人の左**（画面右）へ回す |
| `+z` | 頭頂が**本人の右肩**側（画面左）へ傾く（かしげ） |

### 腕（upperArm）— T-pose（水平）が原点
| 左腕 | 右腕 | 動き |
|------|------|------|
| `z +1.15` | `z −1.15` | 自然に下ろす（= posture `stand_relaxed` の値） |
| offset `z −2.05` | offset `z +2.05` | 下ろした状態からほぼ頭上まで上げる（posture込み合成） |
| offset `y −` | offset `y +` | 前方向へ振る（下ろした腕では斜め前） |
| offset `x` | offset `x` | 腕軸まわりのロール（シルエットほぼ不変） |

### 肘（lowerArm）
左: `y −` / `z −` で曲げ（右はミラー）。伸び上げ経過の実証値: 左 `[0, −0.9, −0.55]`。曲げの見えかたは服（振袖）に隠れやすいので必ずキャプチャ確認。

### 指（hand.json、side:"both" の左手基準値）
| 値 | 動き |
|----|------|
| `z +` | カール（握る方向）。relaxは0.2〜0.35 |
| thumb `y +` | 親指の内曲げ |
| 右手 | `[x, −y, −z]` ミラーが自動適用 |

### レイヤ合成の仕組み（重要）
```
ボーン最終回転 Q = Q(posture) * Q(hand) * Q(offsetトラック+オシレータ)
```
- 各レイヤは **T-pose=ゼロからの絶対値**。`offset` は **postureを掛けた後のボーンローカル系**で効く（垂らした腕の `x` がロールになるのはこのため）。
- 同軸の回転は加算的（posture z+1.15 + offset z−2.05 = 実質 z−0.9 ≈ 頭上）。
- トラックに書かないボーンは**キャッシュ済みレスト**（腕下ろし済みの待機ポーズ）のまま。

### 便利な数値
- 身長スケール: 顔の中心 ≈ y1.35 / 胸 ≈ y1.1 / 下ろした手 ≈ y0.75
- 立ち全身カメラ: `{ position:[0,1.1,2.1], target:[0,1.0,0], fov:40 }`
- 手元アップ（左）: `{ position:[0.5,0.85,0.45], target:[0.21,0.74,0.02], fov:25 }`

---

## 5. DSLスキーマ要約

実証済みの完全な実例: **`public/motions/dsl/test_stretch.motion.json`（伸びをする12秒ループ）** — まずこれを読むのが早い。軸検証用: `_axis_probe.motion.json`。

```jsonc
// <id>.motion.json
{
  "schema": "motion/1",
  "id": "<ファイル名と同一>",
  "label": "日本語名", "notes": "自由メモ",
  "category": "idle_break",            // スケジューラ用（0.9〜）
  "tags": ["calm"],
  "posture": "stand_relaxed",          // poses/<id>.pose.json 参照（省略可）
  "duration": 12, "loop": true,
  "fadeIn": 1.0, "fadeOut": 1.0,
  "hands": { "left": "relax", "right": "relax" },   // poses/hands/ 参照（省略可）
  "tracks": {
    "head": { "keys": [
      { "t": 0, "e": [0,0,0] },
      { "t": 4.5, "e": [-0.22,0,0], "ease": "cubicInOut" },  // easeは「このキーへ入る」補間
      { "t": 12, "e": [0,0,0] }                              // loop時は最初と同値に
    ] }
  },
  "oscillators": [                      // ループ安全な周期揺らぎ（呼吸など）
    { "bone": "chest", "axis": "x", "amp": 0.03, "period": 4.0 }
    // loop時: duration が period の整数倍であること（validatorが警告する）
  ],
  "expressions": { "keys": [            // キーは「t時点で到達する完全な状態」
    { "t": 0, "set": {} },              // {} = 真顔
    { "t": 4.5, "set": { "blink": 0.75, "fun": 0.2 }, "fade": 1.2 },  // fade秒かけてtで到達
    { "t": 11.8, "set": {}, "fade": 1.5 }
  ] },
  "lookAt": { "mode": "camera", "strength": 0.8 }   // cursor|camera|fixed|off
}
```

- easing: `linear / step / sineInOut(既定) / easeIn / easeOut / cubicInOut`
- 使える表情: `a i u e o blink blinkleft blinkright joy angry sorrow fun`（＋`neutral`=全ゼロ）
- pose.json: `bones: { ボーン名: [x,y,z] }` ＋ `hipsOffset:[x,y,z]`（座りで使用、m単位）
- 振幅 > 2.6rad で「度数法では？」警告が出る（ラジアンで書くこと）

---

## 6. 設計ルール（守ると破綻しない）

1. **ループは最初と最後のキーを同値に**（`checkLoop` で機械検証）。oneshot（loop:false）は最後のキーで保持。
2. **小さく作る**: 壁紙用途の体幹オフセットは ±0.05〜0.25 rad で十分。腕だけ大きく動かせる。
3. **表情・視線・瞬きはDSLの指示で**書き、ボーンに焼かない（実行系がBridge/LookAtを所有 — 0.3からの不変方針）。
4. **指を個別キーにしない**: ハンドシェイプ（hand.json）を作って参照。
5. 経過ポーズ問題: 2キー間の直線補間が硬く見えたら**中間キーを1つ足して弧を描く**（test_stretch の t3.3 がその実例）。
6. SpringBone（髪・スカート・袖）はキャプチャ時 `settle`（既定1.0秒）で馴染ませる。袖が荒ぶって見えたら `settle: 2` で再確認。

## 7. 既知の制約（0.7時点）

- **ランタイム再生（play/ミキサー経路）はボーン回転のみ**。expressions / lookAt / hipsOffset は Lab の show/capture では効くが、ランタイム適用は Motion Director（0.9）で実装予定。
- モデルに `upperChest` / `leftToes` / `rightToes` は無い（`load()` の `missingBones` に出る。使っても安全にスキップされる）。
- 座りポーズ（hipsOffset）はまだ未制作。椅子との位置合わせ＋スカート貫通の確認が必要（0.8の仕事）。
- `?lab=1` は本番ビルドでも有効になるが、`/__lab/*`（保存・一覧）はdevサーバ専用。

## 8. トラブルシュート

| 症状 | 対処 |
|------|------|
| `load()` が HTTP 404 | id・ファイル名・配置を確認。`await __motionLab.ls()` で実在一覧が出る |
| `__motionLab` が undefined | URLに `?lab=1` が付いてるか。`window.location.href` を確認 |
| `vrmLoaded: false` のまま | `public/models/kiritan.vrm` が手動配置されているか（再配布禁止モデルのため同梱されない） |
| コード編集が反映されない | **ページを `reload()`**（HMRはLabを差し替えない） |
| キャプチャが真っ白/欠ける | カメラが近すぎ/遠すぎ。§4の定番カメラから始める |
| 画面上のプレビューが固まった | 仕様（凍結中）。`__motionLab.thaw()` で再開 |

## 9. 実績

- 著作実証: `test_stretch`（ブリーフ→執筆→キャプチャ→修正1周→確定、計約15分・キャプチャ12枚）
- 検証ログ: `.probe_tmp/captures/_axis_probe/`（軸検証）, `.probe_tmp/captures/test_stretch/`
- パイプライン調査レポート: `../docs/MOTION_PIPELINE_RESEARCH_2026-06-11.md`
