# モーション量産パイプライン調査（MOTION PIPELINE RESEARCH）

- **日付**: 2026-06-11
- **目的**: 「座って寝る／本を読む／PC作業／ゲーム／窓を見る／髪をかきあげる…」といった多彩なモーションを大量に用意し、自然なタイミングでランダム再生するための **モーションデータの仕組みと量産アプローチ** の検討。
- **前提資料**: `docs/VRM_MODEL_AUDIT_flasco_kiritan.md` / `docs/STATUS_REPORT_2026-06-10.md`
- **結論（先に）**: 既存の手続きモーション基盤を発展させた **「Motion DSL（JSON）＋ エージェント著作ループ（Motion Lab）」を主軸** にし、苦手分野だけ **Webカメラ・モーキャプ（XR Animator）／AI生成（HY-Motion）／購入VRMA** で補う **ハイブリッド構成** を推奨する。

---

## 1. 現状の仕組みの整理 — モーションデータはどう流れているか

Motion Probe（0.6時点）のモーションは、すでに**3つの層**で合成されている。

```
[姿勢の初期ポーズ]  ← VRMロード時にキャッシュ（normalized humanoid rig）
      ↑
[外部クリップ層]    AnimationMixer + AnimationClip（.vrma or 組み込み手続きクリップ）
      ↑              weight エンベロープで idle ベースから slerp ブレンド
[手続きアイドル層]  IdleStateMachine: 時間の純関数オフセット（呼吸・揺れ・表情・LookAt強度）
                     クリップの上に「加算で」乗る
```

重要な既存資産:

| 資産 | 場所 | 量産との関係 |
|------|------|--------------|
| Idle State Machine（5状態、純関数、ポップレス・クロスフェード） | `src/lib/motion/idleStateMachine.ts` | スケジューラ（後述 Motion Director）の原型そのもの |
| 手続きクリップ生成（コード→`THREE.AnimationClip`） | `src/lib/motion/proceduralClip.ts` | **DSLコンパイラの原型**。トラック命名 `${normalizedBoneNode.name}.quaternion` が `.vrma` 経路と完全互換 |
| `.vrma` ローダ（VRM 0.x↔1.0 リターゲット込み、回転トラックのみ採用） | `src/lib/motion/vrmaClip.ts` | 外部調達モーションの受け口は完成済み |
| クロスフェード制御（THREE非依存・Node検証可能） | `src/lib/motion/externalMotionController.ts` | 再生制御は完成済み |
| Custom Expression Bridge / 自動まばたき / Bone LookAt | `src/VrmViewer.tsx` | 表情・視線は**クリップに焼かず**ランタイム合成する方針が確立済み |

つまり「**再生側はほぼ完成している。足りないのはクリップ（データ）を量産する仕組みだけ**」という状態。

---

## 2. `.vrma`（VRM Animation）フォーマットの解剖

手元の実ファイルをパースして確認した（pixiv公式 MotionPack 7本 + `sample_idle.vrma`）。

- 実体は **GLB（glTF 2.0 バイナリ）+ `VRMC_vrm_animation` 拡張**（specVersion 1.0）。
- 拡張部は `humanoid.humanBones`: **ヒューマノイドボーン名 → glTFノードindex** のマップ（52ボーン＝全指含む）。任意で `expressions`（表情weightアニメ）と `lookAt` も入れられる（公式パックは未使用）。
- アニメ本体は**ただの glTF アニメーション**: ボーンごとの `rotation`（クォータニオン）チャンネル ＋ hips のみ `translation`。VRMA_01 は rot=90ch / pos=1ch / 11.8秒。
- **重要な発見**: 公式パックの generator は `THREE.GLTFExporter`。つまり **three.js でスケルトンを組んで GLTFExporter で書き出し、JSONに拡張を注入する」自作VRMAエクスポータは公式実績のあるルート**（数百行で書ける）。
- 回転は normalized rig（VRM1.0座標）上のローカル回転。0.x モデルへの適用差分は `createVRMAnimationClip` が吸収済み（実装確認済み）。

→ **VRMA は「交換用フォーマット」として最適**。ただし中身はベイク済みキーフレームなので、**人間（やLLM）が直接書くフォーマットではない**。著作用にはもう一段抽象度の高い形式が要る。

---

## 3. 量産アプローチの比較

| | アプローチ | 品質 | 量産性 | 今回の用途（座位・小動作・小道具）との相性 | コスト/リスク |
|---|---|---|---|---|---|
| **A** | **Motion DSL + エージェント著作**（JSON→クリップにコンパイル。アイデア/図からLLMがデータ化、プレビュー画像で自己検証） | 中〜高（小振幅ループは得意） | **◎**（1本15〜30分想定） | **◎** 座位・上半身・表情・ループが主戦場 | ツール構築が初期投資（Probe 1段分）。大振幅の全身遷移は苦手 |
| **B** | **Webカメラ・モーキャプ**: [XR Animator](https://github.com/ButzYung/SystemAnimatorOnline)（無料、MediaPipeベース、**VRMA直接エクスポート対応**） | 中（人間らしい揺らぎ◎、指・接触は粗い） | ○（自分で演技→録る） | ○ 「伸びをする」「キョロキョロ」等の有機的ループに強い | ジッタ除去が必要。椅子・机との接触は合わない |
| **C** | **AI text-to-motion**: [HY-Motion 1.0](https://github.com/Tencent-Hunyuan/HY-Motion-1.0)（Tencent、2025末OSS化、1Bパラメータ、テキスト→SMPL→**BVH/FBX出力**） | 中（立ち・移動系は高品質） | ○（プロンプト→生成） | **△** 椅子・机・小道具との接触、微細な指作業は最も苦手な領域 | NVIDIA GPU必要。SMPL→VRMリターゲット（Blender経由）の整備が必要。ライセンス要確認 |
| **D** | **既存VRMA資産の購入/取得**（pixiv公式パック、BOOTH、[VRM Posing Desktop](https://elvneko.com/posts/vpd-vrma-blender/) 等） | 高 | △（欲しい題材があるかは運） | △ 汎用ジェスチャ向け。「机で本を読む」等のピンポイントは見つかりにくい | パックごとにライセンス確認。pixivパックは商用可（クレジット表記必須）・単体再配布不可 |
| **E** | **MMD用VMDモーション変換** | 高（ダンス系） | △ | ✕ 題材が合わない上、**利用規約が作者ごとにバラバラで再配布・変換禁止が多い** | 権利リスクが高く、原則見送り |
| **F** | **Blender手付け**（[VRM Add-on for Blender](https://vrm-addon-for-blender.info/en-us/ui/export_scene.vrma/) が **VRMA import/export 対応**） | 最高 | ✕（1本に数時間） | ○ | 修理工場（B/Cの出力の手直し）として使うのが現実的 |

### 判断のポイント

欲しいモーションの性質を分解すると——

- **ほぼ全部が「座位ベース」**（寝る・読書・PC・ゲーム・窓見・髪direct）→ 立ち・移動系が得意なC（AI生成）の長所が活きない
- **小道具との接触**（本・キーボード・マウス）が多い → モーキャプ/AI生成が最も苦手な領域
- **小振幅・ループ・長時間鑑賞**が前提 → 「時間の純関数」プロシージャルの得意分野（既に0.2で実証済み）
- **数十本** 必要 → 1本ごとの人手コストが支配的。著作の自動化が効く

→ **主軸はA**。これは「既存コードの自然な延長」でもある（`proceduralClip.ts` がほぼコンパイラの雛形、`idleStateMachine.ts` がほぼスケジューラの雛形）。

---

## 4. 推奨アーキテクチャ — Motion DSL ＋ Motion Lab

### 4.1 全体像

```
ユーザー: アイデア＋説明図（motion_briefs/<id>/ にテキスト・スケッチ画像）
   ↓
エージェント(Claude): brief を読んで .motion.json（DSL）を執筆
   ↓
DSLコンパイラ(アプリ内): pose + keys + oscillators → THREE.AnimationClip
   ↓                                （トラック命名は既存 .vrma 経路と互換）
Motion Lab(開発用パネル): ホットリロード / タイムライン・スクラブ /
   固定時刻レンダ → PNGキャプチャ保存（エージェントが目視検証して反復）
   ↓
確定: モーションは JSON のまま本番ロード（または VRMA エクスポートして交換用に）
   ↓
Motion Director(スケジューラ): カテゴリ・重み・滞留時間・時間帯でランダム再生
```

「図からデータに起こす」のはエージェント（私）の仕事になる。**鍵はDSLの表現力ではなく、エージェントが結果を“見て”直せるフィードバックループ**（Motion Lab のキャプチャAPI）。

### 4.2 DSL スキーマ案（`motions/read_book.motion.json`）

```jsonc
{
  "id": "read_book",
  "label": "本を読む",
  "category": "desk_activity",        // スケジューラ用
  "tags": ["calm", "day", "prop:book"],
  "posture": "sit_chair_v1",          // 共有ベースポーズ（poses/）への参照
  "duration": 16.0,
  "loop": true,
  "fadeIn": 1.2,
  "fadeOut": 1.0,

  // 名前付きハンドシェイプ（poses/hands/）。指30本を個別キーにしない
  "hands": { "left": "hold_book_L", "right": "relax_R" },

  // 小道具を手ボーンへアタッチ（オフセット付き）
  "props": [{ "id": "book", "attach": "leftHand", "pos": [0.02, 0.05, 0.08], "rot": [0.3, 0, 0] }],

  // ボーンごとのキーフレーム（初期ポーズからのオフセットEuler、rad）
  "tracks": {
    "head":          { "keys": [ { "t": 0, "e": [0.22, 0, 0] },
                                  { "t": 6, "e": [0.25, 0.06, 0.02], "ease": "sineInOut" },
                                  { "t": 12, "e": [0.22, -0.04, 0] },
                                  { "t": 16, "e": [0.22, 0, 0] } ] },
    "rightUpperArm": { "keys": [ /* ページをめくる動き … */ ] }
  },

  // ループ安全な周期レイヤー（呼吸など）はキーにせず宣言で
  "oscillators": [ { "bone": "chest", "axis": "x", "amp": 0.04, "period": 4.0 } ],

  // 表情・視線はクリップに焼かずタイムライン指示（Bridge / LookAtが実行）
  "expressions": { "keys": [ { "t": 9, "set": { "fun": 0.25 }, "fade": 0.8 } ] },
  "lookAt": { "mode": "prop", "target": "book", "strength": 0.9 },
  "microEvents": { "blink": "auto", "glanceUser": { "chance": 0.15, "cooldownSec": 20 } }
}
```

設計判断:

1. **姿勢（posture）とアクティビティを分離** — 座りベースポーズ（全ボーン＋hips位置）は `poses/sit_chair_v1.pose.json` として1回だけ丁寧に作り、静的レイヤーとして適用。各モーションは**上半身オフセットだけ**書く。
   - 「座って寝る／読書／PC／ゲーム／窓見／髪」は全部 *同じ座りベース+上半身差分* なので、著作コストが激減し、遷移も常に安全（ベース共通→クロスフェードで破綻しない）。
   - hips の translation はベースポーズ側が持つので、`vrmaClip.ts` が position トラックを strip する既存方針とも矛盾しない。
   - スカートSpringBone問題（監査§8）も、机で下半身を隠す構図＋ベース固定で回避。
2. **指はハンドシェイプ名で指定** — 指15関節×2手を個別キーにせず、`fist / relax / point / hold_book / type_home` のような名前付きプリセット（これもJSON）を参照しlerpで切替。タイピングは2〜3シェイプの交互で十分それらしく見える。
3. **表情・視線・まばたきはDSLでは“指示”だけ** — 実行は既存の Bridge / LookAt / autoBlink。0.3で確立した「外部クリップの表情トラックは捨てる」方針と一貫。
4. **oscillator を一級市民に** — ループ安全（周期が duration の整数分の一）な揺らぎはキーフレームにせず宣言的に。0.1〜0.2 の「純関数・無累積」哲学をそのまま継承。
5. **将来の拡張枠**: 手先IK（`"ik": [{ "target": "rightHand", "pos": [...] }]` → コンパイル時に two-bone IK で肩肘回転へ解決）。キーボード位置に手を置く等の精度が欲しくなったら v2 で。

### 4.3 Motion Lab（著作ループの要）

開発ビルド限定のパネル＋APIを追加:

- **ホットリロード**: `motions/*.motion.json` を Vite の import.meta.glob か fetch で読み、`G`キー再読込と同様の仕組みで再コンパイル。
- **タイムライン・スクラブ**: rAFを止めて `t` を固定し、決定論的に1フレームだけレンダ。
- **キャプチャAPI**: `window.__motionLab.capture(motionId, t, cameraPreset)` → `renderer.render()` 直後に `canvas.toDataURL('image/png')` → dev サーバのミドルウェア（Viteプラグイン）経由で `\.probe_tmp/captures/<motion>/<t>_<cam>.png` に保存。
  - ※ ライブWebGLキャンバスは `preview_screenshot` がタイムアウトする既知問題があるため、**スクショではなく自前キャプチャ**にするのが必須（既存のNodeヘッドレス検証方針とも一致）。
  - 数値検証用に `window.__motionLab.samplePose(motionId, t)` → 全ボーンEulerのJSONダンプも用意（Nodeテストでループ継ぎ目・振幅上限を機械チェック）。
- **エージェントの作業手順（1モーションあたり）**:
  1. `motion_briefs/<id>/` の説明テキスト＋図（画像はReadで読める）を読む
  2. `.motion.json` を執筆
  3. capture を 3〜5 時点 × 2カメラで撮って目視
  4. 角度・タイミングを修正して反復（2〜4周）
  5. ループ継ぎ目と振幅をNodeチェックで機械検証して確定

### 4.4 Motion Director（ランダム再生）

`IdleStateMachine` の設計（dwell→重み付き抽選→snapshot crossfade）をクリッププールに一般化:

- モーションのメタ（category / tags / 重み / dwell範囲 / クールダウン）で抽選。同カテゴリ連発の抑制。
- **時間帯バイアス**: 夜は `sleepy` 系の重みを上げる、など（`tags: ["night"]`）。
- 既存5状態のアイドルは「マイクロアイドル」としてクリップの上に加算で乗り続ける（現行合成順そのまま）。
- 将来: Companion App のイベント（通知・時報・音楽再生中…）でカテゴリを切り替える受け口だけ用意。

### 4.5 補完ルート（DSLが苦手なものだけ）

- **XR Animator**（無料）: 自分で演技→VRMAエクスポート→既存ローダで取り込み。「伸び」「あくび」など全身の有機的な動きに。
- **HY-Motion 1.0**: 立ちモーションが欲しくなったら。テキスト→BVH→Blender（VRM Add-on）→VRMA。GPUとリターゲット整備が必要なので**必要になるまで着手しない**。
- **購入/公式VRMA**: 挨拶等の汎用エモートはパックで済ませる。pixivパックは商用利用時クレジット必須（`Animation credits to pixiv Inc.'s VRoid Project`）。
- いずれも `.vrma` → 既存 `vrmaClip.ts` → Director のプールに合流（**VRMAを共通交換フォーマットにする**）。

---

## 5. ロードマップ案

| Probe | 内容 | 成果物 |
|-------|------|--------|
| **0.7 Motion Lab** | DSL v1（posture/tracks/oscillators/hands/expressions）＋コンパイラ＋ホットリロード＋スクラブ＋キャプチャAPI＋Nodeループ検証 | 著作環境一式。サンプル1本（`read_book`）を通しで著作して実証 |
| **0.8 First Batch** | 座りベースポーズ＋ハンドシェイプ集＋小道具アタッチ（本GLB追加）。ブリーフ→著作ループで **5本**（寝る/読書/PC/窓見/髪） | `motions/` 5本＋`poses/` 資産 |
| **0.9 Motion Director** | カテゴリ抽選・dwell・クールダウン・時間帯バイアス。VRMAエクスポータ（任意）と外部VRMA合流 | ランダム自然再生の完成 |
| **1.0 量産** | ブリーフを流し込んで残り（目標20〜30本）。XR Animator補完も随時 | モーションライブラリ |

---

## 6. ライセンスメモ（モーション関連）

- **モデル**（ふらすこ式風きりたん）: 再配布禁止・商用禁止 → 既存の strip ゲート維持。モーションJSON/VRMAは**モデルと独立したデータ**なので同梱・配布可能（自作分は自分に権利）。
- **pixiv MotionPack**: 改変自由・商用可（クレジット必須）・モーション単体での再配布不可 → アプリ同梱するならクレジット表記を設定画面等に。
- **HY-Motion 1.0**: Tencent コミュニティライセンス。個人利用は問題ないが、配布物に生成モーションを含める場合は条項確認。
- **VMD流用は原則しない**（作者ごとの規約リスク）。

---

## 7. 参考リンク

- VRM Animation 仕様: https://vrm.dev/en/vrma/
- VRM Add-on for Blender — VRMA export: https://vrm-addon-for-blender.info/en-us/ui/export_scene.vrma/
- XR Animator (SystemAnimatorOnline): https://github.com/ButzYung/SystemAnimatorOnline
- HY-Motion 1.0 (Tencent): https://github.com/Tencent-Hunyuan/HY-Motion-1.0 / https://huggingface.co/tencent/HY-Motion-1.0
- VRM Posing Desktop の VRMA を Blender で使う例: https://elvneko.com/posts/vpd-vrma-blender/
- `@pixiv/three-vrm-animation`（読込・リターゲットに使用中、v3.5.3）
