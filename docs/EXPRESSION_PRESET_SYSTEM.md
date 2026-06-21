# Expression Preset System 0.2 — 表情プリセットシステム

**作成: 2026-06-12（0.1）→ 2026-06-13 ユーザーレビューで 0.2 改修。対象: 01_wallpaper（きりたんライブ壁紙）。**
VRMファイルを一切改変せず、モデルが元々持っている expression / 生morph を Custom Expression Bridge 上でランタイム合成し、「コードから cue で呼べる表情テンプレート」を提供する。AITuber 的な「VRMへの表情焼き足し」ではない。

**0.2 の変更（ユーザーレビュー反映）**:
- プリセット 18→**14種**。改名（glance_smile→`smile`）／削除（sleepy_soft_smile・pout・angry_light）／統合（yawn 3段→`yawn` 1個の強度管理）／追加（`wry_smile`＝あきれた笑み）。
- **強度1.0＝各プリセットの上限**に再較正（呼ぶ側が上限を覚えなくてよい）。small_smile↓・sleepy 0.33・surprised_light 0.63 など。
- **`flutter`**: 状態系の強度をゆっくり正弦で揺らす（sleepy 半目0.17〜0.33、bored 0.8〜1.0）。
- **視線を刷新**: `lookAtStrength`（マウス追尾倍率）を廃止し **`gaze`**（固定方向＋ワンダー減衰）に。マウス追尾そのものを撤去（→ `gazeController.ts`）。
- **モーション再生中の表情/視線がランタイムで実効**（DSL `exprCues` / `gaze`、別ドキュメント `EXPRESSION_LIST_FOR_MOTION_IDEAS.md`）。
- 別AIに渡す表情カタログ: **`docs/EXPRESSION_LIST_FOR_MOTION_IDEAS.md`**（画像付き・指示テンプレ付き）。

---

## 1. 全体像

```
                    （毎フレーム、残留ゼロ保証）
influences 全クリア
  → 手動表情（currentExpression, 従来どおり）
  → アイドル mood オーバーレイ（idleOut.expr — プリセット表参照）          max-blend
  → ★表情プリセット オーバーレイ（ExpressionOverlayController・デバッグUI）  max-blend
  → ★モーション顔チャンネル（再生中DSLの exprCues/expressions × clip weight）max-blend
  → blink / half-lid（auto-blink と「より閉じる方が勝つ」）              max-blend

視線（0.2・別レイヤ）: GazeController が
  待機ワンダー → アイドル固定 → プリセットgaze → モーションgaze を弱→強で合成
```

- **max-blend**: どのレイヤも他レイヤの値を*下げられない*。手動表情を壊さない保証。
- すべての weight は 0..1 に clamp。
- `.vrma` の表情トラックは従来どおりロード時 strip（Bridge優先・0.3不変方針）。

### ファイル構成

| ファイル | 役割 |
|---|---|
| `01_wallpaper/src/lib/expression/expressionPresets.ts` | プリセット定義（純データ・THREE/React非依存）＋派生表情テーブル＋`gaze`/`flutter` |
| `01_wallpaper/src/lib/expression/expressionPresetEvaluator.ts` | merge / cueエンベロープ / オーバーレイコントローラ（gaze/flutter対応） |
| `01_wallpaper/src/lib/expression/registerDerivedExpressions.ts` | 生morphを名前解決してBridgeへ追加登録（モデル無改変） |
| `01_wallpaper/src/lib/motion/gazeController.ts` | **0.2新規**: 視線の最終決定器（待機ワンダー＋レイヤ合成＋度数↔ワールド変換） |
| `01_wallpaper/src/lib/motion/dsl/evaluate.ts` | DSL評価器＋**0.2の顔タイムライン**（exprCues/gaze/legacyを Lab・本番で共有） |
| `tools/test_expression_presets.mjs` | Node検証ハーネス（263アサーション） |
| `tools/dump_blendshapes.mjs` | 診断: VRMのblendShapeMaster/morph名一覧の読み出し（読み取りのみ） |
| `docs/EXPRESSION_LIST_FOR_MOTION_IDEAS.md` | **0.2新規**: 別AI/人間に渡す表情カタログ（画像・指示テンプレ付き） |

---

## 2. 利用できる表情名

### 標準（blendShapeMaster 由来、実バインドあり12種）

`a i u e o blink blinkleft blinkright joy angry sorrow fun`（＋`neutral`=全ゼロ）

このモデルは VRM 0.x なので 0.x 名が正。three-vrm 1.0 標準名との対応:
**happy→joy / relaxed→fun / sad→sorrow / aa→a / ih→i / ou→u / ee→e / oh→o**。
`lookup/lookdown/lookleft/lookright` はバインド空（瞳はボーン駆動）のため**使用不可**。

### 派生（生morphの昇格、20種 — Expression Preset System 0.1 追加）

モデルの顔メッシュには68個のmorphが実在するが、blendShapeMasterに収録されているのは一部のみ。
未収録morphを**モデル著者の付けた名前で**解決し、Bridgeの表へ追加登録する（捏造なし・無いものはスキップ＆警告）。

| 派生名 | 元morph | 見え方（2026-06-12 実測） |
|---|---|---|
| `bikkuri` | びっくり | 目を見開く。**このモデルでは控えめ** |
| `jitome` | じと目 | 上瞼が平らに。ジト目・不満・集中 |
| `hau` | はぅ | ＞＜目。**強い**。中間値(0.4-0.5)は睨みに見えるので注意 |
| `nagomi` | なごみ | 細目で穏やか（funの目はこれの部分適用） |
| `jiro` | じろ | 横目睨み |
| `uruuru` | うるうる | 瞳に潤みハイライト |
| `majime` | 真面目 | 真面目眉（前髪に透ける程度） |
| `komaru` | 困る | 困り眉。よく読める |
| `ikari_mayu` | 怒り | 怒り眉（単体） |
| `nikori_mayu` | にこり | にこり眉（単体） |
| `mayu_ue` / `mayu_shita` | 上 / 下 | 眉の上下（前髪でかなり隠れる） |
| `niyari` | にやり | ニヤリ口。読める |
| `nishishi` | にしし | いたずら笑い口 |
| `pukuu` | ぷくー | 頬ふくらまし＋口すぼみ（頬は髪で隠れ気味、口元で読む） |
| `pukuku` | ぷくく | 笑いこらえ口 |
| `omega` | ω | ω口。かわいい。読める |
| `nn` | ん | 口を結ぶ＝既定の微笑を消す（真顔化に便利） |
| `akire` | 呆れ | 呆れた半開き口 |
| `mouth_up` | ∧ | ∧口（むっ）。読める |

> **実装メモ（重要）**: UniVRM系エクスポートは targetNames を**primitive extras**に置くが、three の GLTFLoader は**mesh extras**しか読まない → ランタイムの `morphTargetDictionary` は数字キーになる。そのため名前→index の解決は glTF JSON（`gltf.parser.json`）から直接行う（`buildMorphNameIndex()`）。
> 正しさの証明: `angry` を派生名で再構成（`{ikari_mayu:1, jitome:0.612, mouth_up:1}`）した描画が blendShapeMaster 経由と**PNGハッシュ完全一致**。

---

## 3. 表情プリセット一覧（14種・0.2）

重みは全て実機キャプチャで目視調整済み（`docs/expressions/<id>_i1.png` / `_i0_5.png`）。
**weights は 1.0 がそのプリセットの上限**。`flutter` 付きは強度を内部で揺らす（指示不要）。
各プリセットの「いつ・どう使うか」と作例は **`docs/EXPRESSION_LIST_FOR_MOTION_IDEAS.md`** が正典。

### 状態系（常時表示に耐える・分単位で保持可）

| id | 意味 | weights | eyelid | gaze / flutter |
|---|---|---|---|---|
| `neutral_soft` | やわらか基本顔 | fun 0.12 | — | wander |
| `small_smile` | 小さなほほえみ | fun 0.24, omega 0.16 | — | wander |
| `smile` | 微笑み（旧 glance_smile 改名） | fun 0.28, joy 0.1 | — | — |
| `focused_monitor` | PC作業に集中 | majime 0.5, jitome 0.2, nn 0.15 | — | wander 0.35 |
| `sleepy` | 眠そう | komaru 0.07 | halfLid 0.33 | gaze 下/ flutter 0.5–1.0 |
| `bored` | 退屈 | jitome 0.5, akire 0.45, komaru 0.12 | halfLid 0.2 | wander 0.5 / flutter 0.8–1.0 |
| `thinking` | 考え中 | majime 0.6, nn 0.35, mayu_ue 0.25 | — | **gaze 上 (yaw12,pitch18)** |
| `wry_smile` | あきれた笑み（新規） | jitome 0.5, komaru 0.12, niyari 0.6 | halfLid 0.2 | — |

### 瞬間イベント系（timing でフェードして引っ込める）

| id | 意味 | weights | timing (in/hold/out) |
|---|---|---|---|
| `surprised_light` | 軽い驚き（上限0.7相当に再較正） | bikkuri 0.63, mayu_ue 0.49, a 0.11 | 0.15 / 0.8 / 0.6 |
| `annoyed` | むっ（「u」口と重ねると頬ふくれ風） | jitome 0.6, ikari_mayu 0.35, mouth_up 0.4 | 0.5 / 1.5 / 0.8 |
| `sad_soft` | 弱い困り顔（再構成） | komaru 0.6, bikkuri 0.4, mouth_up 0.3 | 0.8 / 2.0 / 1.2 |
| `smug` | どや顔（眉上げ＋左目細めの非対称） | niyari 0.75, nikori_mayu 0.35, jitome 0.25, mayu_ue 0.35 ＋ blinkLeft 0.25 | 0.5 / 1.8 / 0.8 |
| `embarrassed` | 照れ＝「わはー！」（**強度0/1のみ**） | hau 0.9, komaru 0.4, omega 0.3, uruuru 0.3 | 0.3 / 1.5 / 1.0 |
| `yawn` | あくび（**強度0→1→0で1回分**） | a 0.8, komaru 0.3 ＋ blink 0.85 | 0.8 / 0.9 / 1.0 |

### 近似で妥協したもの / 実現できなかったもの

- **`embarrassed`（照れ）= 近似**: 頬染め（blush）morph がモデルに存在しない。＞＜目＋困り眉＋うるうる＋ω口で表現。中間強度は「はぅ」が睨み顔になるため 0/1 運用。
- **`thinking` の「目を上に逸らす」= 0.2 で実現**: 旧版は LookAt 弱体化だけだったが、`gaze`（固定方向 yaw12/pitch18）で実際に目を上へ向けるようになった。
- **`sad_soft` 再構成**: 旧 sorrow 複合は「はぅ目」で目が黒く潰れたため、`surprised_light` と同じ「びっくり目」＋困り眉＋∧口に置換。
- **`surprised_light` の上限再較正**: 旧 weight 0.9 は驚きすぎ。0.63 で「軽い驚き」に収めた。
- **eyeWideLeft/Right 単眼の見開き**: morph が無いため未対応（`smug` の片目細めは `blinkleft` で代用）。
- **頬染め・特殊目**（ハート/しいたけ等）は壁紙の品位に合わないため登録対象外（必要なら `DERIVED_EXPRESSIONS` に1行追加で使える）。

---

## 4. Idle State との対応（適用済み）

idleStateMachine.ts のハードコード表情はプリセット参照に置換済み（クロスフェード機構は不変）:

| Idle State | Preset | 備考 |
|---|---|---|
| `idle_breath` | `neutral_soft` | 基準。fun 0.12 で常時ほんのり柔らかく。視線=ワンダー |
| `idle_look_monitor` | `focused_monitor` | 視線を画面右下に固定（gaze yaw9/pitch-7, k0.8） |
| `idle_glance_user` | `smile` | oneshot 2.5s。視線を正面に固定（gaze k1） |
| `idle_sleepy` | `sleepy` | halfLid 0.33 × flutter(0.5–1.0)＝0.17–0.33。視線やや下 |
| `idle_small_smile` | `small_smile` | 視線=ワンダー |

モーションからの推奨対応（DSL `exprCues` で）:

| Motion | exprCues |
|---|---|
| read_book | `focused_monitor` / `small_smile` |
| game_play | `focused_monitor` / `annoyed` / `smug` |
| yawn | `yawn` 1つを fadeIn0.8/hold0.9/fadeOut1.0 のエンベロープで |

---

## 5. 呼び出し方

### A. デバッグUI（実装済み）

表情セクション → プリセット select / 強度スライダー / OFF。
**キー: `E` = プリセット送り（OFF→…→OFF）, `X` = OFF**（既存キーと衝突なし）。

### B. コードから（VrmViewer props）

```tsx
<VrmViewer
  expressionPresetId={'small_smile'}   // null = off
  expressionPresetIntensity={1.0}
  onExpressionPresetDebug={setDebug}
  ...
/>
```

内部は `ExpressionOverlayController`。プリセット切替は「表示中weightのスナップショット → 新プリセットへクロスフェード」なのでポップしない（idle機と同レシピ）。フェード時間はプリセットの `timing.fadeIn`／切替前の `timing.fadeOut`。

### C. Motion Lab（著作ループ、?lab=1）

```js
__motionLab.exprPresets()                                  // 一覧
await __motionLab.exprCapture('smug')                      // PNG保存（face close）
await __motionLab.exprCapture({ jitome: 0.5, akire: 0.3 }) // 生weight直指定
await __motionLab.exprCaptureSet()                         // 全プリセット一括
__motionLab.thaw()                                         // 通常ループへ復帰
```

### D. Motion DSL からの cue（0.2 でランタイム実効）

`.motion.json` に `exprCues` / `gaze` を書くだけ（著作の正典は `MOTION_AUTHORING_GUIDE.md` §5、カタログは `EXPRESSION_LIST_FOR_MOTION_IDEAS.md`）:

```jsonc
{
  "exprCues": [
    { "preset": "focused_monitor", "at": 0, "intensity": 0.8 },
    { "preset": "embarrassed", "at": 4.2, "hold": 2.0 },   // 強度0/1運用
    { "preset": "smile", "at": 7.0 }
  ],
  "gaze": { "keys": [ { "t": 0, "to": "away_left" }, { "t": 3, "to": "up" }, { "t": 7, "to": "front" } ] }
}
```

内部実装（評価関数）:

```ts
import { buildFaceTimeline, sampleFaceTimeline } from './lib/motion/dsl/evaluate';
// load 時に MotionEvaluator.faceTimeline へ格納 → 再生中フレームで
const face = sampleFaceTimeline(timeline, action.time);  // { expressions, gaze, gazeWander, activeCuePreset }
// VrmViewer が face.expressions を clip weight でスケールして max-blend、
// face.gaze を GazeController.motionFix へ渡す（gazeStateToFix で 'camera' を実カメラへ解決）。
```

- エンベロープは台形（smoothstep昇降）**0→1→0**。`hold: -1` で終端まで保持。
- 重なった cue は weight を max-blend、`priority` 最大の cue が gaze ヒントと「現在プリセット」表示権を取る。
- **Lab show/capture と play() 本番再生は同じ `sampleFaceTimeline` を通る** → キャプチャで見た顔＝再生される顔。
- `flutter` 付きプリセット（sleepy/bored）はクリップ時刻に対して強度が揺れる（決定的）。
- 視線は `gaze` トラック ＞ cue のプリセット gaze ヒント ＞ 旧 `lookAt` の優先順。

---

## 6. 検証（0.2・2026-06-13）

- `npx tsc -b` ✓ / `npm run build` ✓（チャンクサイズ警告は既存）
- `node tools/test_expression_presets.mjs` — **263 PASS / 0 FAIL**
  （14プリセット存在＋削除7種の不在確認・weight 0..1・未知名なし・実モデル名突合せ・flutter範囲・cue/gaze評価・gazeコントローラのワンダー境界とクランプ・DSL顔タイムライン＝exprCues/gaze/legacy・idle機の参照値）
- 目視: 全14プリセット×強度1.0/0.5 を実機キャプチャ → `docs/expressions/`（git同梱）。
  `thinking` の視線上向き・`sad_soft`/`smug` 再構成・`wry_smile` 新規を確認済み。
- 既知の制約: ヘッドレスプレビューはタブ非表示で rAF が止まるため、ランタイムのフェード進行は実ブラウザで目視（モーション play() と同じ制約・ガイド§7）。

## 7. 今後

- **Motion Director (0.9)**: 表情/視線のランタイム適用は 0.2 で前倒し実装済み。残るは hipsOffset（座位）とスケジューラ（生活モード）。
- 微調整は `expressionPresets.ts` の数値を変えて `exprCapture` で確認、が最短ループ。`gaze`/`flutter` も同ファイル。
