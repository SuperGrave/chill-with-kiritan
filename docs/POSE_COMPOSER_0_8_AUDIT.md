# POSE COMPOSER 0.8 — Stage 0 既存構造監査（AUDIT）

- **Document type**: AUDIT（実装着手前の現状調査）
- **Date**: 2026-06-24
- **対象指示書**: 「Motion Lab Pose Composer — 設計・実装指示書」(Pose Composer 0.8)
- **対象コード**: `01_wallpaper/`（本番壁紙アプリ。Motion Lab はその dev 専用機能）
- **目的**: 指示書 §18 Stage 0 の必須項目を、推測ではなく実コードで確認し、Stage 1〜7 の着工前提を固定する。

> このドキュメントは「指示書のどこが現実と合っていて、どこが前提とズレているか」を正直に記録するためのもの。
> 一番価値があるのは末尾の §A「指示書の前提と実装の差分（要判断）」。**先にそこを読んでも良い。**

---

## 0. 結論サマリ（30秒）

- Motion Lab は **React の UI タブではなく、`window.__motionLab` のヘッドレス API**。可視 UI の前例は `reviewPanel.ts`＝**素の DOM フローティングパネル**（`?phase1Review=1` で注入、`window.__motionLab` を叩くだけ）。→ Pose Composer の UI も**この素 DOM パネル方式**に倣うべき。指示書 §14 の React `.tsx` ファイル構成は本リポにそぐわない。
- **Authoring Override の差し込み口は既にある**：`lab.isFrozen()` が true の間、VrmViewer の `animate()` は冒頭で return し（[VrmViewer.tsx:1267](../01_wallpaper/src/VrmViewer.tsx)）、ポーズ適用とレンダリングを Lab に丸ごと譲る。Pose Composer の毎フレーム描画は `MotionLab.applyFrame()` 系の「凍結レンダー」に override を1枚足す形で実現でき、本番合成順には一切残らない（指示書 §4.3 / §7 を自然に満たす）。
- **reference pose は T-pose ではない**。ロード時に腕を下ろした「正典化済み待機姿勢」を `initialRotationsRef` にキャッシュ（[VrmViewer.tsx:1027-1053](../01_wallpaper/src/VrmViewer.tsx)）。Lab へは `getRestQuaternions()` で渡り、`MotionLab.restoreRest()` が復元する。指示書 §9 の `AuthoringReferencePose` は**これを使えばよい**（新規生成不要）。
- **`.pose.json` は名前衝突する**。既存 `public/poses/*.pose.json` は `schema:"pose/1"`＝**T-pose 基準の絶対オイラー**。指示書の `PoseAssetV1` は**reference 基準の offset quaternion**。同じ拡張子・同じディレクトリに別スキーマを置くことになる → **要判断（§A-2）**。
- **dev 保存エンドポイントは `.probe_tmp/captures/` 限定**（[vite.config.ts:97-100](../01_wallpaper/vite.config.ts)）。`public/poses/` には書けない。指示書 §15.2 の `POST /__motion-lab/pose/save → public/poses/` は**新規/拡張エンドポイントが必要**（dev限定・ディレクトリ白名簿）。
- **テストランナーは無い**。`package.json` に `test` script 無し。テストは **`node tools/test_*.mjs`**（THREE非依存・CJSへ tsc コンパイルして require）。Pose Composer のテストも同形式で追加する。
- **ショートカットはほぼ満杯**。指示書 §17 候補の `F/S/G/K` は**全部使用済み**。空き単キーは実質 `d i q w y z` のみ。→ pose-edit 有効時だけ効く capture-phase リスナで隔離するのが安全（§9）。
- **q キー対応は評価器の設計変更**。現状 `offset` レイヤは**オイラー成分を線形補間**して最後に quaternion 合成（[evaluate.ts:149-169](../01_wallpaper/src/lib/motion/dsl/evaluate.ts) / [compileClip.ts:61-76](../01_wallpaper/src/lib/motion/dsl/compileClip.ts)）。q キーは slerp が要るので、レイヤ表現に手を入れる Stage 5 の本丸。

---

## 1. Motion Lab 入口（指示書 §18: Motion Lab入口を特定）

| 項目 | 実体 |
|------|------|
| 有効化 | URL に `?lab=1`（または `?phase1Review=1`）。[VrmViewer.tsx:976-999](../01_wallpaper/src/VrmViewer.tsx) |
| 本体 | `class MotionLab`（[motionLab.ts](../01_wallpaper/src/lib/lab/motionLab.ts)）。`installMotionLab(handles)` が `window.__motionLab` に載せる |
| UI | **無し**（純 API）。可視 UI は `installReviewPanel(lab)`＝[reviewPanel.ts](../01_wallpaper/src/lib/lab/reviewPanel.ts) のみ、`?phase1Review=1` 限定 |
| 駆動 | `preview_eval` / ブラウザ console から `await __motionLab.xxx()`。全メソッドが `{ ok, ... }` を返し **throw しない** |
| 本番隔離 | `installMotionLab` は mount effect 内の query 判定でのみ呼ばれる。production build は `?lab=1` を付けない限り API も注入されない |

**Lab が VrmViewer から受け取るハンドル**（[motionLab.ts:88-114](../01_wallpaper/src/lib/lab/motionLab.ts) `LabHandles`）：
`renderer / scene / camera / cameraPresets / getVrm() / getRestQuaternions() / getFaceMeshes() / getExpressionMap() / lookAtTarget / propsRoot / requestClipSwap() / setPendingSettle() / extController / onStatus() / startDirector() / stopDirector() / getDirectorStatus()`

→ Pose Composer に必要なもの（VRM・reference quaternion・face mesh・renderer/scene/camera）は**すべて既にこのハンドル経由で取得可能**。Pose Composer は `MotionLab` のメソッド群として生やすか、`LabHandles` を共有する別クラス（`window.__poseComposer`）にするかの2択（§A-1）。

---

## 2. normalized bone の取得と reference pose（§18: VrmViewer の bone 取得 / reference cache）

### 2.1 bone ノードの取得 API
- 正規化ボーン: `vrm.humanoid.getNormalizedBoneNode(boneName)`（全編でこれ。例: [VrmViewer.tsx:1471](../01_wallpaper/src/VrmViewer.tsx)）。書き込みは `node.quaternion` / hips のみ `node.position`。
- raw ボーン: `(vrm.humanoid as any).getRawBoneNode(boneName)`（prop attach で使用。[motionLab.ts:924](../01_wallpaper/src/lib/lab/motionLab.ts)）。**著作の正本は normalized 側**（指示書 §4.1 と一致）。
- normalized → raw 反映: `vrm.humanoid.update()`（毎フレーム合成の最後。[VrmViewer.tsx:1569](../01_wallpaper/src/VrmViewer.tsx)）。
- bone 名集合: `HUMANOID_BONES`（[dsl/types.ts:22-39](../01_wallpaper/src/lib/motion/dsl/types.ts)、VRM1.0 camelCase 25本＋指30本）。本モデルは `upperChest` と `toes` を欠く（apply 時 skip、`load()` が `missingBones` で報告）。

### 2.2 reference pose の実体（＝指示書 §9 `AuthoringReferencePose`）
ロードコールバック [VrmViewer.tsx:1024-1053](../01_wallpaper/src/VrmViewer.tsx)：
1. **腕を T-pose から下ろす**：`leftUpperArm.rotation.z = 1.2` / `rightUpperArm.rotation.z = -1.2`。
2. その後で `initialRotationsRef`（`Map<boneName, THREE.Quaternion>`）に全 humanoid bone の `quaternion.clone()` をキャッシュ（**腕は下ろした後の値**が入る）。
3. hips の rest **position** も別に `initialHipsPosRef` に clone。

→ **reference pose = この arm-dropped 正典姿勢**であって T-pose ではない。
→ Lab 側は `getRestQuaternions()` で同じ Map を参照し、`MotionLab.restoreRest()`（[motionLab.ts:258-267](../01_wallpaper/src/lib/lab/motionLab.ts)）で「全 bone を reference へ・hips position も rest へ」復元する。**指示書 §9.1 の「全 normalized bone の quaternion を clone 保持」は既に満たされている**。
→ 再構築タイミング（§9.2）：reference は VRM ロード時に一度だけ作られる。VRM 再ロードが無い限り不変（Scene Preset 変更では作り直さない＝§9.2 と合致）。

> **重要な座標系の注意**：reference は arm-dropped だが、**DSL の合成モデルは T-pose=identity 基準の絶対値**（§3.2）。つまり「reference からの offset」と「T-pose からの絶対」は**別基底**。Pose Composer の保存形（§A-2）と DSL への書き戻し（§5）で、この2基底の変換を必ず明示すること。

---

## 3. Motion DSL：型・評価器・コンパイラ（§18: DSL型とcompiler）

### 3.1 ファイルと責務
| ファイル | 役割 |
|------|------|
| [dsl/types.ts](../01_wallpaper/src/lib/motion/dsl/types.ts) | スキーマ型。`MotionDef` / `PoseDef`(`pose/1`) / `HandDef`(`hand/1`) / `TrackKey{t,e,ease}` ほか |
| [dsl/validate.ts](../01_wallpaper/src/lib/motion/dsl/validate.ts) | 手書き validator。`Issues` クラス＋`checkV3`/`checkBoneName`＋levenshtein `suggest`。**Zod 不使用** |
| [dsl/evaluate.ts](../01_wallpaper/src/lib/motion/dsl/evaluate.ts) | 純評価器。`buildEvaluator(doc)` → `evalAt(t):EvalFrame`。状態無し・無蓄積 |
| [dsl/compileClip.ts](../01_wallpaper/src/lib/motion/dsl/compileClip.ts) | THREE adapter。`compileDslClip()` が `evalAt` を SAMPLE_FPS=30 でサンプルし `QuaternionKeyframeTrack` 化 |
| [dsl/loadMotionDoc.ts](../01_wallpaper/src/lib/motion/dsl/loadMotionDoc.ts) | fetch＋validate＋`buildEvaluator`。posture は `/poses/<id>.pose.json`、hand は `/poses/hands/<id>.hand.json` |

### 3.2 合成モデル（これが全ての基礎）
```
ボーン最終回転 Q = Q(posture euler) * Q(hand euler) * Q(offset euler)   // 全部 XYZ オイラー
```
- [compileClip.ts:61-76](../01_wallpaper/src/lib/motion/dsl/compileClip.ts) `composeBoneQuaternion(layers, out)`。各レイヤは **T-pose=identity からの絶対オイラー**。
- `offset` レイヤ＝トラックキー補間値＋オシレータ（[evaluate.ts:469-492](../01_wallpaper/src/lib/motion/dsl/evaluate.ts)）。
- **キー補間はオイラー成分の線形補間**（[evaluate.ts:149-169](../01_wallpaper/src/lib/motion/dsl/evaluate.ts) `sampleKeys`）→ 各 t で合成して quaternion 化。
- 実測の軸・符号は **[MOTION_AUTHORING_GUIDE.md §4](../01_wallpaper/MOTION_AUTHORING_GUIDE.md)** が正典（体幹/腕/肘/手首/指それぞれの ±符号と見え方。指示書 §6.5 `BoneDragProfiles`・§13 soft limits はこの表から起こすべき）。

### 3.3 q キー追加（指示書 §8.3）の影響範囲
現状 `TrackKey` は `{t, e:[x,y,z], ease}` のオイラーのみ。指示書は `{t, q:[x,y,z,w], ease}` の追加を要求。
- **評価器の壁**：`offset` レイヤは `E3`（オイラー）で、成分線形補間。q キーを正しく扱う（slerp）には `offset` を「quaternion を持てる」表現に拡張するか、`offset` とは別の「絶対 quaternion トラック」レイヤを新設する必要がある。**単純な型追加では済まない**。
- 後方互換要件（§8.3「既存 e-key motion は無改変で読める」）は維持必須 → e/q 排他、両者を quaternion 化してから補間、という指示書の方針自体は妥当。**Stage 5 の設計の核**。
- compiler 側（`compileClip`）は最終的に quaternion track を吐くので、評価器が各 t で正しい quaternion を返せれば下流は無改修で通る。

---

## 4. 凍結プレビュー / キャプチャ（§18: fixed-time preview / capture）

### 4.1 freeze ゲートと所有権の移譲
- `MotionLab.freeze()`/`thaw()` が `this.frozen` を立てる（[motionLab.ts:235-245](../01_wallpaper/src/lib/lab/motionLab.ts)）。
- VrmViewer の `animate()` は冒頭で `if (labRef.current?.isFrozen()) return;`（[VrmViewer.tsx:1267](../01_wallpaper/src/VrmViewer.tsx)）。**凍結中は rAF が pose を一切触らない** → Lab が `applyFrame`＋`render` を能動的に呼ぶ。
- これが **Authoring Override の正しい差し込み口**。本番の合成順（idle→clip→idle offset→`humanoid.update`→LookAt→Expr→SpringBone→render、[VrmViewer.tsx:1362-1723](../01_wallpaper/src/VrmViewer.tsx)）には override が**構造的に混入し得ない**（指示書 §4.3 を構造で保証）。

### 4.2 既存「凍結→ポーズ→撮影」の流れ（Pose Composer が踏襲すべき型）
`MotionLab.applyFrame(frame, vrm)`（[motionLab.ts:271-301](../01_wallpaper/src/lib/lab/motionLab.ts)）：
```
restoreRest()                    // 全 bone を reference へ（= 前フレーム残留を完全に排除）
→ 各 bone: composeBoneQuaternion(layers) を node.quaternion へ
→ hips.position = rest + frame.hipsOffset
→ humanoid.update()
→ applyGaze() / applyExpressionWeights()    // どちらも個別に呼ぶ＝オプション化済み
（呼び出し側で settleSpringBones() → renderer.render()）
```
→ 指示書 §7.2 の毎フレーム列（reference 復元→override→`humanoid.update`→optional LookAt/Expr/SpringBone→render）と**ほぼ同型**。Pose Composer は「`frame` の代わりに authoring override を適用する applyFrame 変種」を1つ足せばよい。**前フレーム入力への依存はゼロ**（毎回 `restoreRest` から再構築）＝指示書 §4.2「累積禁止」を既存実装が体現している。

### 4.3 可視チャネル（ヘッドレスでの目視）
- `capture(id,t,opts)` → canvas を `toDataURL('image/png')` → `POST /__lab/save` → `.probe_tmp/captures/...` に保存し**絶対パスを返す**（agent が Read 可能）。[motionLab.ts:405-452](../01_wallpaper/src/lib/lab/motionLab.ts)。
- `filmstrip()` は複数 t を1枚のグリッド PNG に。`downloadCanvas()` は実ブラウザでの DL。
- メモリ既知の罠：**`preview_screenshot` は連続再描画ページで固まる**。Pose Composer の目視 QA も**この `?lab=1`→freeze→toDataURL→`/__lab/save`→Read** 経路を使うこと（指示書 §19.3 のキャプチャ群もこの経路で生成）。

---

## 5. Motion へのキー書き戻し経路（指示書 §8.3 / Stage 5）

- 現状、Lab から motion JSON を**書き出す API は無い**（読み込み `load()` と再生 `play()` のみ）。`/__lab/save` は **png/json** を受けるが保存先は `.probe_tmp/captures/` 限定。
- したがって「Add Keyframe → motion JSON に q キー挿入 → 保存」を完結させるには：
  1. ブラウザ側：対象 motion の JSON を保持/編集する状態（`load()` 済みの `registry` に raw `doc` はある）。
  2. q キーの sorted insert / epsilon replace / delete（指示書 §6.7・§19 Keyframe bridge）。
  3. 保存：**`public/motions/dsl/` に書ける dev エンドポイント**が必要（§A-3）。
- epsilon 同時刻判定 `KEY_TIME_EPSILON = 1/120` は指示書通りで良い。既存 validator は「key時刻は厳密増加」を要求するので、挿入後は時刻ソート必須。

---

## 6. 既存キーボードショートカット一覧（§18: 既存ショートカット）

App レベル window リスナ（[App.tsx:514-618](../01_wallpaper/src/App.tsx)、**productionMode では無効**だが dev では常時有効）：

| キー | 機能 | | キー | 機能 |
|------|------|---|------|------|
| Ctrl/⌘+S | layout export | | `m` | springbone モード |
| `[` `]` | layout target 巡回 | | space | idle motion トグル |
| `t` | guides トグル | | `4`-`8` | idle 状態（`IDLE_KEYS`）|
| 矢印/PgUp/PgDn/`+`/`-` | layout nudge | | `r` | autoIdle |
| `1` `2` `3` | カメラ preset | | `9` `0` `p` | external motion |
| `b` `l` `f` | blink/lookAt/fps | | `v` `c` `g` | props/placeholder/**reload scene** |
| `n j u s a` | 表情(neutral/joy/fun/sorrow/angry) | | `k` `o` `h` | bg/light/panel |
| `e` `x` | 表情preset cycle/off | | (reviewPanel) `p` | パネル隠す |

- **空き単キー**: 実質 `d` `i` `q` `w` `y` `z` のみ。
- 指示書 §17 候補は**全滅**：`F`=fps / `S`=sorrow / `G`=reload scene / `K`=bg / `P`=play。
- **対策**：Pose Composer のキーは「pose-edit 有効時のみ効く」隔離が必須。`reviewPanel` 同様にパネル自前のリスナを持ち、pose-edit 中は**capture phase で intercept→`stopPropagation()`** して App ハンドラへ流さない。最終割当は実装時に §17 形式で記録する。

---

## 7. テスト・ビルド・型チェック（§18: テストコマンド）

| 目的 | コマンド | 備考 |
|------|----------|------|
| 型チェック | `npx tsc -b`（または `npm run build` の前段）| `01_wallpaper/` で実行 |
| 本番ビルド | `npm run build` | `tsc -b && vite build && node scripts/strip-dist-vrm.cjs` |
| lint | `npm run lint` | eslint |
| ロジックテスト | `node tools/test_*.mjs` | **repo ルートの `tools/`**。`test_motions.mjs` `test_director.mjs` `test_expression_presets.mjs` `test_kiritan_post.mjs` |
| アセット検査 | `npm run check:dist-assets` / `check:props` | |

- **`package.json` に `test` script は無い**（[package.json:6-13](../01_wallpaper/package.json)）。テストは Node スクリプト直叩き文化。
- テスト方式（[tools/test_motions.mjs](../tools/test_motions.mjs)）：対象 TS を `npx tsc ... --module commonjs` で `.probe_tmp/motion_build` にコンパイル→`require()`→assert→`process.exit(fail?1:0)`。**THREE 非依存**（DSL 評価器が純数値だから成立）。
- **Pose Composer のテスト方針**：
  - pose codec / keyframe bridge / undo-redo は純数値ロジックに切り出せば同形式でいける。
  - **authoring math（reference*offset, mirror 行列）と mirror は quaternion/Matrix4 必須**。`three` の math クラスは Node で WebGL 無しに動くので `import * as THREE from 'three'` を test 内で使うのが現実的（既存テストが THREE を避けているのは評価器が純数値なだけで、禁止ではない）。→ **pose-math モジュールは THREE math のみ依存に保ち**、テストから直接 import できる純関数群にすること。

---

## 8. 推奨ファイル配置（指示書 §14 の現実適合版）

指示書 §14 は `src/features/motionLab/poseComposer/*.tsx`（React）を提案するが、本リポに `src/features/` は無く、Lab は素 DOM。**大規模リファクタ禁止**（§14 末尾）に従い、既存 `src/lib/lab/` に同居させる：

```
01_wallpaper/src/lib/lab/
  motionLab.ts            （既存）
  reviewPanel.ts          （既存・UIパネルの前例）
  poseComposer/
    poseComposer.ts        … window.__poseComposer 本体（freeze/override/save）。LabHandles 共有
    poseComposerPanel.ts   … 素DOMフローティングパネル（reviewPanel流儀。?poseEdit=1 で注入）
    poseAssetTypes.ts      … PoseAssetV1 / HandPose 型
    poseAssetCodec.ts      … validate/normalize/encode（validate.ts の Issues 流儀を流用）
    poseMath.ts            … reference*offset / q⇔euler / mirror（THREE math のみ依存・テスト対象）
    boneMapDefinition.ts   … SVG front/side 座標（静的）
    boneDragProfiles.ts    … §6.5（GUIDE §4 から起こす）
    boneSoftLimits.ts      … §13（config 化）
    poseKeyframeBridge.ts  … motion への q キー挿入/置換/削除
src/lib/motion/dsl/
  types.ts / evaluate.ts / compileClip.ts / validate.ts  … q キー対応で限定的に改修（Stage 5）
vite.config.ts            … dev save エンドポイント拡張（Stage 4/§15.2）
tools/
  test_pose_codec.mjs / test_pose_math.mjs / test_keyframe_bridge.mjs / test_pose_mirror.mjs  … 追加
docs/
  POSE_COMPOSER_0_8_AUDIT.md（本書）/ PROGRESS / REPORT / CHECKLIST / POSE_ASSET_SCHEMA_V1.md
```

---

## 9. Authoring Override の合成位置（確定見解）

```
[Pose Edit 中・凍結レンダー1フレーム]
  restoreRest()                         // reference へ全 bone 復元（残留ゼロ保証）
  → (Base Pose) 読込 pose を reference 基準 offset として適用
  → (Motion Key) その時刻 t の motion を決定論評価 → その上に authoring override
  → authoring override（選択中の編集 quaternion を node.quaternion へ）
  → humanoid.update()
  → optional: LookAt / Expression / SpringBone（右パネルで個別ON。既定OFF＝§7.1）
  → scene.updateMatrixWorld(true)
  → renderer.render()
  → bone overlay 更新（CSS2D / 開発用 overlay scene）
```
- 本番 `animate()` は freeze 中 return するので、override は**本番合成順に存在しない**。
- 各 bone は毎フレーム `referenceQ * authoredOffsetQ`（または `evaluatedMotionQ * authoredDeltaQ`）で**再構築**＝指示書 §4.2 完全準拠。前フレームへの `multiply` 蓄積は構造的に発生しない。
- ギズモ操作中だけ OrbitControls を無効化（既存 `controls.enabled` を流用可。free モードのみ orbit 有効＝[VrmViewer.tsx:1333-1352](../01_wallpaper/src/VrmViewer.tsx)）。

---

## 10. Stage 別 着工レディネス

| Stage | 前提 | 状態 | 留意 |
|------|------|------|------|
| 1 Authoring Session | freeze/thaw/restoreRest/applyFrame | **ほぼ即着工可** | LookAt/SpringBone/blink の個別 override トグルを足すだけ |
| 2 Bone選択+数値 | getNormalizedBoneNode / 素DOM panel | 可 | SVG bone map は静的座標（§A-4）|
| 3 Gizmo+Undo | TransformControls 同梱確認済 | 可 | orbit 排他は既存 controls 流用 |
| 4 Pose Asset | codec＋**dev save 拡張** | エンドポイント追加要 | §A-2/§A-3 の判断後 |
| 5 Motion Key連携 | **評価器 q キー拡張** | 設計要 | 本丸。後方互換厳守 |
| 6 DragPad/Hand | boneDragProfiles（GUIDE §4）| 可 | 左右符号を明示 |
| 7 Copy/Mirror/QA | poseMath＋テスト | 可 | Mirror は安全に作れねば flag off（§12 指示書）|

---

## 11. 既存機能を壊さないための不変条件チェックリスト（着工時に常時参照）

- [ ] 本番 `animate()` の合成順（[VrmViewer.tsx:1362-1723](../01_wallpaper/src/VrmViewer.tsx)）を変更しない。override は freeze 経路のみ。
- [ ] reference (`initialRotationsRef` / `getRestQuaternions`) を書き換えない。読むだけ。
- [ ] `vrm.scene` の root transform（position/rotation/scale）に触らない（Scene Preset/Director の責務）。
- [ ] 首ねじれ防止・腕落とし・Custom Expression Bridge・LookAt・SpringBone・クロスフェードに副作用を出さない。
- [ ] 既存 e-key motion JSON は無改修でロード/再生できる（validator・evaluator の後方互換）。
- [ ] dev エンドポイント追加は `apply:'serve'` 限定＋パストラバーサル拒否＋書込先白名簿＋production build に含めない。
- [ ] Pose Edit 終了時に override 破棄＋開始前の再生状態へ復帰＋残留回転ゼロ。

---

## A. 指示書の前提と実装の差分（**要判断**・最重要）

実装着手前に master の方針確認が要る/設計判断が分岐する点を明示する。各項に推奨を添える。

### A-1. UI アーキテクチャ：React タブ ではなく 素DOMパネル
- **差分**：指示書 §6・§14 は「Motion Lab に POSE EDIT **タブ**を追加」「React `.tsx` コンポーネント群」を想定。実際の Motion Lab は **`window.__motionLab` のヘッドレス API**で、可視 UI は `reviewPanel.ts` の**素 DOM フローティングパネル**しか前例が無い（App.tsx の React UI は本番壁紙の HUD であって Lab ではない）。
- **推奨**：`reviewPanel` 流儀を踏襲し、**`?poseEdit=1`（または `?lab=1` 内のサブパネル）で注入する素 DOM パネル**＋`window.__poseComposer` API。React state は増やさない（本番バンドル/HUD に混ぜない）。指示書 §6 の人型 SVG/ギズモ/ドラッグパッドは素 DOM＋SVG＋Three TransformControls で実現可能。
- **影響**：§14 のファイル構成は §8 の配置に読み替える。

### A-2. `.pose.json` フォーマット衝突（**最優先判断**）
- **差分**：
  - 既存：`public/poses/<id>.pose.json` = `schema:"pose/1"`、`bones: {bone:[x,y,z]}`＝**T-pose 基準の絶対オイラー**、`hipsOffset:[x,y,z]`。motion から `posture` 参照（[loadMotionDoc.ts:73-86](../01_wallpaper/src/lib/motion/dsl/loadMotionDoc.ts)）。`stand_relaxed` 等4種が稼働中。
  - 指示書：`PoseAssetV1` = `schemaVersion:1`、`coordinateSpace:"normalized-local-offset"`、`bones:{bone:{rotation:quat}}`＝**reference 基準の offset quaternion**。
  - 同じ `public/poses/` に同じ `.pose.json` 拡張子で**別スキーマ2種が混在**することになる。さらに既存 `pose/1` は **arm-drop を含まない**（reference は arm-drop 済み）ので基底もズレる。
- **選択肢**：
  - (a) **既存 `pose/1` を正本に寄せる**：Pose Composer は内部 quaternion 編集だが、保存時に reference 基準 offset を quaternion→XYZ オイラーへ落として `pose/1` で書き出す。→ motion の `posture` 参照とそのまま繋がる。難点：quaternion→euler は値の自由度/特異点があり「正本は quaternion」という指示書 §8.1 とズレる。基底変換（reference⇔T-pose）を厳密実装すれば既存 motion 互換が最大。
  - (b) **新形式を別拡張子/別dir**：例 `public/poses/composer/<id>.posepack.json`(=PoseAssetV1)。既存 `pose/1` と完全分離。難点：motion の `posture` は `pose/1` を期待するので、Motion Key で使うには結局 `pose/1` への変換器が要る。
  - (c) **`pose/1` を v2 拡張**：`bones[bone]` に `[x,y,z]`（既存）と `{q:[...]}` の両方を許す union 化＋`coordinateSpace` 追加。loader/validator を後方互換で広げる。
- **推奨**：**(a) を基本線**（既存 motion パイプラインとの地続きを最優先）。内部は quaternion で編集・Undo し、`pose.json` 書き出し時に reference-offset→T-pose絶対オイラーへ変換して `pose/1` を出す。`eulerDegHint` 相当は `notes` か別 sidecar に。**ただしこの基底変換の正しさが全体の要**なので、§7 のテスト（reference*offset 同値・10000回無ドリフト・reset 厳密復帰）を最初に通す。
- **要 master 判断**：a/b/c のどれにするか。これで Stage 4 のデータモデルが確定する。

### A-3. dev 保存先：`public/poses/` / `public/motions/` への書込
- **差分**：指示書 §15.2 は `POST /__motion-lab/pose/save → public/poses/`。実際の `/__lab/save` は **`.probe_tmp/captures/` 限定**（[vite.config.ts:97-100](../01_wallpaper/vite.config.ts) の `target.startsWith(capturesRoot)` ガード）。
- **推奨**：`motionLabApi()` に**新 route を追加**（既存を緩めない）：`POST /__lab/pose/save`（白名簿 `public/poses/` と `public/poses/hands/`）、必要なら `POST /__lab/motion/save`（`public/motions/dsl/`）。既存と同じ「`apply:'serve'`・正規表現＋`..` 拒否・`path.resolve` 後に whitelist dir で `startsWith` 検査・production 非同梱」を踏襲。上書き前バックアップ（§15.2）も付ける。
- ブラウザ単体機能（Export/Import JSON, File System Access）は dev 非依存なので先に出せる（§15.1）。

### A-4. 動的スケルトン投影は後回し（指示書も 1.1 送り）
- 指示書 §10.2/MVP は SVG 静的配置で可、実 bone world 投影は後続（§25 1.1）。**MVP は静的座標**で割り切る。`layoutSnapshot()`（[motionLab.ts:999-1046](../01_wallpaper/src/lib/lab/motionLab.ts)）が bone world 位置を返すので、動的版が要るときの素地はある。

### A-5. q キー評価器拡張は「型追加」では済まない（再掲・設計確定が要る）
- §3.3 の通り、`offset` レイヤのオイラー線形補間を quaternion slerp 対応にする設計が Stage 5 の前提。`offset` を quaternion 化すると GUIDE §4 の「オイラー直書き文化」と二重になるため、**「q トラックは offset とは別の絶対 quaternion レイヤ」**として足すのが破綻が少ない（既存 e トラックは無改修）。Stage 5 着手時に PROGRESS で確定。

---

## B. Stage 0 完了判定（指示書 §18 Stage 0 成果物）

- [x] Motion Lab 入口を特定（§1）
- [x] VrmViewer の normalized bone 取得箇所を特定（§2.1）
- [x] reference pose cache を確認（§2.2＝`initialRotationsRef`/`getRestQuaternions`/`restoreRest`）
- [x] Motion DSL 型と compiler を確認（§3）
- [x] fixed-time preview / capture の実装を確認（§4）
- [x] 既存ショートカット一覧を確認（§6）
- [x] テストコマンドを確認（§7）
- [x] 成果物 `docs/POSE_COMPOSER_0_8_AUDIT.md` を作成（本書）

**次アクション**：§A-1/A-2/A-3 の方針を master が確定 → Stage 1（Authoring Session 基盤）着工。Stage 1 は既存 freeze/restoreRest 上に override トグルを足すだけで、A-2 の保存形確定を待たずに並行可能。
