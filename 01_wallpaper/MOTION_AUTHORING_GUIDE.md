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

> **胴の大きな前後傾の符号（実測2026-06-24）**: 上の「+x=前傾」は**頭のうつむき**基準。`spine`/`chest` を大きく倒して上体を机へ寄せる/椅子へ反らす用途では逆で、**`spine −x` が上体を前(+z)へ、`+x` が後ろ(−z)へ**倒す（`loop_video_relax` の肘つき頬杖で確認）。胴を大きく動かすときは必ず `layoutSnapshot()` の head/shoulder z で前後を確認。

### 腕（upperArm）— T-pose（水平）が原点
| 左腕 | 右腕 | 動き |
|------|------|------|
| `z +1.15` | `z −1.15` | 自然に下ろす（= posture `stand_relaxed` の値） |
| offset `z −2.05` | offset `z +2.05` | 下ろした状態からほぼ頭上まで上げる（posture込み合成） |
| offset `y −` | offset `y +` | 前方向へ振る（下ろした腕では斜め前） |
| offset `x` | offset `x` | 腕軸まわりのロール（シルエットほぼ不変） |

### 肘（lowerArm）
左: `y −` / `z −` で曲げ（右はミラー）。伸び上げ経過の実証値: 左 `[0, −0.9, −0.55]`。曲げの見えかたは服（振袖）に隠れやすいので必ずキャプチャ確認。
**手首ロールには使わない**: 曲げ済み前腕に offset `x` を足すと、XYZオイラーで `x` が最外回転になり「前腕の長軸まわりの捻り」ではなく「手の横振り（手がキー上から外へ逃げる）」になる（実測2026-06-24）。回内は手首側で（下記）。

### 手首（hand ボーンの offsetトラック）— 0.9.1 追補（実測2026-06-24）
hand ボーンは posture も hand.json レイヤも持たない（指カールは指ボーン側）ので、**offset euler = 手首のローカル回転そのもの**。実測した軸: 指の長軸 = **local X** / 掌の法線 = **local Y**。したがって
| 値 | 動き |
|----|------|
| offset `x` | **手首ロール（回内/回外）**。タイピングの palm-down（掌を真下）は左右とも `x ≈ −1.04`（元の `0.1` は実質ほぼ無回転だった） |
| offset `y` / `z` | 手首のヨー/ピッチ（振り/あおり）。`x` でロールした後は軸が回るので必ずキャプチャ/数値確認 |

数値検証の定石: `__motionLab.h.getVrm()`（TS private は実行時に素通し）で指ボーンの world 位置を取り、掌法線 = `cross(normalize(middleProx−wrist), normalize(littleProx−indexProx))` の y が **−1 で真下**。`leftMiddleDistal` の world y を desk top(0.73) と比べてキー接地、`leftHand` world y で机貫通を判定（オクルージョンに強い）。

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
人間味付けの3アプローチ実例（2026-06-12、同じ「伸び」をそれぞれ別の手法で制作）:
- `stretch_principles` — DSL無変更のキーフレーム芸（予備動作/左右非対称/関節カスケード/オーバーシュート/指トラック直書き）
- `stretch_noise` — test_stretch のキーを変えずノイズオシレータだけ重ねたレトロフィット
- `stretch_spring` — `tools/bake_spring_motion.mjs`（バネ・ダンパー物理）が生成した密キー。**手編集禁止**、.mjs の events/ω/ζ を直して再ベイク

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
  "fadeIn": 1.0, "fadeOut": 1.0,    // 0.7.2からランタイムのクロスフェード実時間として実効

  "hands": { "left": "relax", "right": "relax" },   // poses/hands/ 参照（省略可）
  "tracks": {
    "head": { "keys": [
      { "t": 0, "e": [0,0,0] },
      { "t": 4.5, "e": [-0.22,0,0], "ease": "cubicInOut" },  // easeは「このキーへ入る」補間
      { "t": 12, "e": [0,0,0] }                              // loop時は最初と同値に
    ] }
  },
  "oscillators": [                      // ループ安全な周期揺らぎ（呼吸など）
    { "bone": "chest", "axis": "x", "amp": 0.03, "period": 4.0 },
    // loop時: duration が period の整数倍であること（validatorが警告する）
    // 0.7.1拡張（後方互換）: kind:"noise" = 決定的バリューノイズ（生体ゆらぎ・筋緊張tremor用）。
    //   loop時は格子がdurationにラップされ継ぎ目は常に厳密一致（period整除は不要）。
    //   window:[t0,t1] = 時間窓。窓外ゼロ、attack/release秒のsmoothstepで出入り（既定0.4）。
    //   seed = ノイズチャンネルの非相関化（phaseはnoiseでは無視）。
    //   実例: ピーク保持中だけ腕を約5Hzで震わせる（人間の伸びの筋緊張）
    { "bone": "leftUpperArm", "axis": "z", "amp": 0.014, "period": 0.19,
      "kind": "noise", "window": [4.5, 7.2], "attack": 0.5, "seed": 1 }
  ],
  "exprCues": [                         // ★0.2: 表情はこれが本命（プリセット参照）
    { "preset": "focused_monitor", "at": 0, "intensity": 0.8 },
    { "preset": "surprised_light", "at": 3.2, "intensity": 0.8 },  // envelopeはプリセット既定
    { "preset": "smile", "at": 5.0 }                               // intensity省略=1.0
  ],
  "gaze": { "keys": [                    // ★0.2: 視線（度数 or 名前。マウス追尾は廃止）
    { "t": 0, "to": "away_left" },       // 遠くを見る
    { "t": 3.0, "to": "camera", "move": 0.2 },  // こちらを見る（移動0.2秒のサッカード）
    { "t": 5.5, "to": "front" }
  ] }
  // 旧 "lookAt":{...} も後方互換で動くが、新規は "gaze" を使う
}
```

- easing: `linear / step / sineInOut(既定) / easeIn / easeOut / cubicInOut`

### 表情（0.2 で刷新）— 2通りの書き方

1. **`exprCues`（推奨）= 表情プリセットを時間に置くだけ**。`{ "preset": "<id>", "at": 秒 }` が最小形。
   - `intensity` 0..1（省略=1.0。各プリセットは**1.0が上限**に調整済み）／`fadeIn` `hold` `fadeOut`（省略時はプリセット既定）。
   - `hold: -1` ＝ モーション終端まで保持。
   - 使えるプリセット（14種）と作例は **`docs/EXPRESSION_LIST_FOR_MOTION_IDEAS.md`**（別AI／人間に渡すカタログ・画像付き）が正典。
     `neutral_soft / small_smile / smile / focused_monitor / sleepy / bored / thinking / wry_smile / surprised_light / annoyed / sad_soft / smug / embarrassed / yawn`。
   - **特殊運用**: `embarrassed` は強度0か1のみ／`yawn` は強度エンベロープであくび1回を表現。
2. **`expressions.keys`（低レベル）= フル状態を直接**。母音や生morphを細かく当てたい時だけ。
   使える名: `a i u e o blink blinkleft blinkright joy angry sorrow fun neutral` ＋派生
   `bikkuri jitome hau nagomi jiro uruuru majime komaru ikari_mayu nikori_mayu mayu_ue mayu_shita niyari nishishi pukuu pukuku omega nn akire mouth_up`。
   - `exprCues` と併用可（max-blendで合成）。
   - Labでの目視: `__motionLab.exprPresets()` / `await __motionLab.exprCapture("smile")` / `await __motionLab.exprCapture({ jitome: 0.5 })`。

### 視線（0.2 新規 `gaze`）— マウス追尾は廃止

- `{ "t": 秒, "to": <方向>, "move": 移動秒 }`。`to` は**名前**か `[yawDeg, pitchDeg]`（度数・`+yaw`=画面右/`+pitch`=上）。
  名前: `front camera up down left right up_left up_right down_left down_right away_left away_right`。
- キーを置かない間は**待機ワンダー**（自動の小さなきょろきょろ）。最初に1キー置けばそこに固定。
- `move` 省略=0.25秒の自然なサッカード。`loop=true` は t=0 にも最終キーと同じ方向を置くと継ぎ目が安定。
- **ランタイム実効**（0.2〜）: `exprCues`/`gaze` は **Lab の show/capture だけでなく play() の本番再生でも効く**（クリップ時刻でサンプルし、クリップweightでフェード）。
- pose.json: `bones: { ボーン名: [x,y,z] }` ＋ `hipsOffset:[x,y,z]`（座りで使用、m単位）
- 振幅 > 2.6rad で「度数法では？」警告が出る（ボーンはラジアン。**ただし gaze は度数**）

---

## 6. 設計ルール（守ると破綻しない）

1. **ループは最初と最後のキーを同値に**（`checkLoop` で機械検証）。oneshot（loop:false）は最後のキーで保持。
2. **小さく作る**: 壁紙用途の体幹オフセットは ±0.05〜0.25 rad で十分。腕だけ大きく動かせる。
3. **表情・視線・瞬きはDSLの指示で**書き、ボーンに焼かない（実行系がBridge/LookAtを所有 — 0.3からの不変方針）。
4. **指を個別キーにしない**: ハンドシェイプ（hand.json）を作って参照。
5. 経過ポーズ問題: 2キー間の直線補間が硬く見えたら**中間キーを1つ足して弧を描く**（test_stretch の t3.3 がその実例）。
6. SpringBone（髪・スカート・袖）はキャプチャ時 `settle`（既定1.0秒）で馴染ませる。袖が荒ぶって見えたら `settle: 2` で再確認。

### 6.5 アニメ12原則チェック（micro-motion 必須 — 2026-06-13）

壁紙の小動作も**12原則**に則って作る。振幅は小さく（壁紙の落ち着き）、しかし原則は効かせる。oneshot Ambient／Transition は確定前に下記を満たすこと:

1. **Anticipation（予備動作）**: 主動作の前に、逆方向の小さなタメを1キー入れる。例: 頷く前に頭をほんの少し上げる(−x)、右へ回す前に左へ僅かに。振幅は主動作の 10〜20%。
2. **Follow-through / Overlap（フォロースルー・重なり）**: (a) 終わりで目標を僅かに**オーバーシュート**してから戻して**settle**する（最後にもう1キー）。(b) 連なるボーンは**時間差**で動かす（首が頭を 0.1〜0.15秒リードする／視線が頭をリードする＝『目で見てから顔が向く』）。SpringBone(髪/袖/裾)は物理で自動フォロースルー。
3. **Arcs（弧）**: 直線軌道は硬い。2キー間に**垂直成分の中間キー**を足して弧にする（§6-5 の経過ポーズ問題）。頷き・首振りも僅かに弧を描かせる。
4. **Secondary action（副次動作）**: 主動作を支える小さな別ボーンを1つ添える（例: 頭を上げると胸が僅かに開く、笑うと肩が弾む、眠気で頭が落ちると肩も落ちる）。
5. **Slow in / Slow out**: キーの `ease` を必ず指定（`sineInOut`/`easeIn`/`easeOut`/`cubicInOut`）。瞬発は `easeOut`、タメは `easeIn`。
6. **Timing / Exaggeration / Staging / Appeal**: 速さで重さと気分を出す（眠い=遅い、驚き=速い）。読めるギリギリまで僅かに誇張。1モーション1主動作で見せ場を明確に。表情で訴求。
7. **Squash&Stretch / Solid / Pose-to-Pose**: リグに squash は無いので、呼吸や予備の沈み込みで代替。各キーが3Dとして破綻しない（キャプチャ確認）。

検収追加チェック: 「予備動作・オーバーシュート・重なり時間差・弧・副次動作」の5点が入っているか各 oneshot で確認。ループは周期オシレータ＝本質的に slow-in/out＋弧なので①②③は不要だが、**呼吸の位相をボーン間でずらす**(phase)と overlap が出て生きる。

## 7. 既知の制約（0.7→0.2 表情/視線で更新）

- **ランタイム再生で効くもの（0.2〜 / Phase1拡張）**: ボーン回転 ＋ **expressions / exprCues / gaze**（クリップ時刻でサンプル、クリップweightでフェード）＋
  **`hipsOffset`/`hipsTrack`**（座り・立ち座り、INF-3）＋ **`rootMotion`**（キャラ前進、INF-7。world絶対 `{t,p:[x,y,z],rotY?}`、loop時はnet-zero／across-roomはDirector駆動）＋ **`microEvents`**（prop attach/detach、INF-4。`{t,action,prop,bone?,grip?}` を `action.time` で発火、中断時は自動復旧）。
  これらはすべて play() 本番再生でも効く（座位ポーズ0.8 / Motion Director 0.9 実装済み）。
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
- 人間味付け3アプローチ比較（2026-06-12）: `stretch_principles` / `stretch_noise` / `stretch_spring`（§5参照）。
  比較レポート: `../docs/STRETCH_HUMANIZE_COMPARISON_2026-06-12.md`。ランタイムベイクは30fpsに引き上げ済み（5Hz級tremorのエイリアス防止）。
- 検証ログ: `.probe_tmp/captures/_axis_probe/`（軸検証）, `.probe_tmp/captures/test_stretch/`
- パイプライン調査レポート: `../docs/MOTION_PIPELINE_RESEARCH_2026-06-11.md`
- 注意: ヘッドレスプレビューはタブ非表示で rAF が止まるため `play()` のクロスフェードが進まない（weight が0のまま）。
  ミキサー経路の確認は clipSource:'dsl' / playing:true まで。動きの目視はユーザーのブラウザで行うこと。
- 0.7.2 再生遷移の修正（2026-06-12）: ①ミキサー'finished'をコントローラへ通知（oneshot終了で自動的に待機へフェード、playing も false に）
  ②クリップ差し替えは「現行クリップをフェードアウト→エンベロープ0のフレームでスワップ→フェードイン」のペンディング方式
  （旧実装は blend=1 のまま瞬間スワップ＝ポーズがテレポートし、SpringBone（髪・袖）が暴れて首がねじれて見えた）
  ③ DSL の fadeIn/fadeOut がクロスフェード実時間として効くようになった。検証: コントローラ単体のNodeシナリオテスト全PASS。
- **0.7.2追補 — 最重要の根本原因（同日）**: THREE.PropertyMixer は「ブレンド結果が前フレームと同値」のボーンへの setValue を
  **スキップ**する。ビューアは mixer.update 後の node.quaternion を「クリップの生値」として読み戻して合成していたため、
  スキップされたフレームでは**自分が書いた合成値（クリップ×アイドルオフセット）をクリップ値と誤認**→アイドルオフセットが
  毎フレーム乗算され、1秒で約3rad も背骨・首が曲がった（実測: `.probe_tmp/mixer_skip_test.mjs`、60fps×60frで3.00rad）。
  同値フレームが発生するのは モーション冒頭の静止区間（=再生開始時）/ oneshot終了後のクランプ保持・停止後のポーズ保持
  （=再生終了後）/ 中間プラトー。修正: 純クリップ値キャッシュ（VrmViewer.clipPoseRef）を mixer.update 前に復元・後に再キャプチャし、
  合成はキャッシュからのみ読む。**今後も「mixerが書いた値をノードから読み戻す」設計は禁止**（スキップ最適化に裏切られる）。
