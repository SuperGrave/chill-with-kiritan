# POSE COMPOSER 0.8 — ハンドオフ / 再開ドキュメント（HANDOFF）

- **Date**: 2026-06-24（初版）／ **2026-07-01 更新**（Stage 3・4 完了を反映）
- **これは何**: Pose Composer 0.8 の作業を**中断→次回再開**するための1枚。現状(**Stage 0–4 完了**)・確定事項・絶対に踏むな落とし穴・残作業(Stage 5–7 具体手順) を自己完結でまとめる。
- **関連**: 監査=[POSE_COMPOSER_0_8_AUDIT.md](POSE_COMPOSER_0_8_AUDIT.md) ／ 進捗詳細=[POSE_COMPOSER_0_8_PROGRESS.md](POSE_COMPOSER_0_8_PROGRESS.md) ／ スキーマ=[POSE_ASSET_SCHEMA_V1.md](POSE_ASSET_SCHEMA_V1.md) ／ 指示書=「Motion Lab Pose Composer 設計・実装指示書」

---

## ▶ 次回の再開方法（これを貼る / これを読ませる）

> 新しいセッションで以下を渡す:
> 「`docs/POSE_COMPOSER_0_8_HANDOFF.md` と `docs/POSE_COMPOSER_0_8_AUDIT.md` を読んで、Pose Composer 0.8 の **Stage 5（Motion qキー連携）** から続けて。master決定（§2）と落とし穴（§4）は厳守。既存Motion DSLの後方互換（motions 54/director 90/expression 263 checks）を壊さないこと。各Stage末で `tsc -b`・`npm run build`・該当テストを green に。」

着工前にやること: ①本書 §2 決定 と §4 不変条件を確認 ②`01_wallpaper/src/lib/lab/poseComposer/` の現コードを読む ③§6 の起動・検証レシピで現状を一度動かす ④§7 の該当Stage手順で実装。

### 現状（2026-07-01）
- **Stage 0–4 完了**。branch `feat/pose-composer-0.8`（base `5220449`）に3コミット: `d84fdd8`(Stage0-2) → `3b71ca9`(Stage3: ギズモ+Undo/Redo) → `ebe7c5f`(Stage4: pose/1 保存/読込)。
- 動くもの: `?poseEdit=1` パネル / `window.__poseComposer`。FK編集・SVGボーンマップ・**3D回転ギズモ（hipsは移動）**・**Undo/Redo(Ctrl+Z/Shift+Z)**・**pose/1 保存/読込/Export/Import**・サンプル `public/poses/sample_wave.pose.json`。
- テスト: `tools/test_pose_undo.mjs`(32) / `test_pose_math.mjs`(133) / `test_pose_codec.mjs`(22) = 187 checks green。
- **⚠ 未コミットの統合行（触るな・別機能と混在）**: `VrmViewer.tsx`・`motionLab.ts` は Pose Composer の install/ゲート/handle行と、**無関係な未コミット機能「work-hand-pin IK」**（`WORK_HAND_PIN_POLICIES`/`applyWorkHandPins`/CCD-IK・`isSceneReady`）が同一ファイル内で交錯。ファイル単位で分離コミット不可のため作業ツリーに残置。`instruction #3`（無関係差分を触らない）遵守。**次セッションもこの2ファイルは単独コミット不可**。`vite.config.ts` は元々無変更→Stage4で単独コミット済み。

---

## 1. 現状サマリ（Stage 0–2 完了）

**動くもの（`?poseEdit=1` で左上にパネル）**:
- VRM Humanoid ボーンを **freeze セッション**で手動FK編集 → 画面に即反映（本番再生ループは凍結、override は本番合成順に混入しない）。
- 人型 **SVG ボーンマップ**（Front/Side 切替・22ボーン）でクリック選択 → 3Dに **選択ハイライト（青球＋ローカル軸）**。
- 選択ボーンの **XYZ°数値入力** で offset 編集、Reset selected / Reset all、dirty 表示、欠損ボーン(upperChest)無効化、編集済み=amber。
- `window.__poseComposer` API（パネル無しでも全操作可能・`help()` あり）。
- **保存系はまだ無い**（Stage 4）。Motion へのキー挿入も無い（Stage 5）。

**確認済み**: `tsc -b` green / `npm run build` green。実機(`?poseEdit=1`)でパネル実DOMハンドラ叩き＋capture PNG 目視（ポーズ反映・選択オーバーレイ・状態色・Front/Side・Reset）。

---

## 2. master 決定（確定・踏襲する）

| # | 論点 | 決定 |
|---|------|------|
| 1 | Pose Asset 保存形式 | **既存 `pose/1` に寄せる**。内部は quaternion で編集/Undo、保存時に reference基準offset → **T-pose絶対オイラー**へ変換して既存 `public/poses/*.pose.json`(schema `pose/1`) で書く。基底変換の正しさが要 → **テスト最優先**。 |
| 2 | UI 方式 | **素DOMパネル**（`reviewPanel.ts` 流儀）＋ `window.__poseComposer`、`?poseEdit=1` 注入。React state を増やさない。指示書 §14 の React `.tsx` 構成は**使わない**。 |
| 3 | 進め方 | **Stage 単位**で実装し各末で型check+build。 |

---

## 3. アーキテクチャ要点（最重要・5行）

1. **差込口=freezeゲート**: `?poseEdit/?lab` 時、`poseComposerRef.current?.isActive()` が true の間 VrmViewer.animate() が冒頭 return（[VrmViewer.tsx](../01_wallpaper/src/VrmViewer.tsx) のゲート）。描画は PoseComposer が手動で行う。
2. **1フレーム** = `restoreReference()`(全bone→reference, hips→rest) → 各override `node.quaternion = referenceQ * offsetQ` → `humanoid.update()` → optional LookAt/Expr/SpringBone → `updateMatrixWorld` → overlay配置 → render。**毎フレーム再構築で無蓄積**。
3. **reference pose** = 腕下ろし正典姿勢（VrmViewer `initialRotationsRef`）。`getRestQuaternions()`/`getRestHipsPosition()` で読むだけ。**T-poseではない**。
4. **DSL合成は別基底**: `Q=Q(posture)*Q(hand)*Q(offset)` 全部 **T-pose=identity 絶対オイラー**。保存(Stage4)は「reference基準offset」→「T-pose絶対」へ変換が要。
5. **正本データ** = `overrides: Map<bone, offsetQuaternion>`（reference基準）。euler入力は内部でquat化。

---

## 4. 絶対に踏むな（落とし穴・不変条件）

- **本番 animate() の合成順を変えない**。override は freeze 経路のみ。reference(`initialRotationsRef`)は読むだけ。`vrm.scene` root transform に触らない。
- **前フレームへ `multiply` 累積しない**（毎回 restoreReference から）。end() で override 破棄＋reference復元＝**残留ゼロ**。
- **既存 e-key motion は無改修で動くこと**（Stage5 の q-key 追加は後方互換厳守）。
- **headless preview は rAF 完全停止**（500msで0回）。live ループは観測不可。**可視化は freeze＋手動render→`toDataURL`→`POST /__lab/save`→PNG Read**（`__poseComposer.capture()` / `__motionLab.capture()`）。`preview_screenshot` は WebGL ページで固まる（使うな）。
- **StrictMode/HMR インスタンス分裂**: `<StrictMode>`(main.tsx) で VrmViewer effect が二度走り `window.__poseComposer` は2個目になる。DOMパネルは1個目closureを握りがち。→ **パネルは常に `window.__poseComposer`(生インスタンス)を駆動**（`const PC=()=>window.__poseComposer??pc`）。新規UI/コールバックも同パターンで。
- **dev保存先サンドボックス**: 既存 `/__lab/save` は `.probe_tmp/captures/` 限定（[vite.config.ts](../01_wallpaper/vite.config.ts)）。`public/poses/` には書けない → Stage4 で新endpoint追加（dev限定・dir白名簿・`..`拒否・production非同梱）。
- **テスト/ビルド**: `01_wallpaper/` で `npx --no-install tsc -b`（型）/ `npm run build`（本番）。ロジックテストは repoルート `node tools/test_*.mjs`（THREE非依存・CJS化してrequire）。`npm test` は無い。

---

## 5. ファイルマップ（Pose Composer 関連のみ）

```
01_wallpaper/src/lib/lab/poseComposer/
  poseComposer.ts          window.__poseComposer 本体（session/override/overlay/capture/select/gizmo/undo/save/load）
  poseComposerPanel.ts     ?poseEdit=1 の素DOMパネル（PC()ゲッター・gizmo/undo/save-load UI）
  boneMapDefinition.ts     人型SVG静的座標 22本（front/side・JPラベル・parent・group）
  poseHistory.ts           【Stage3】純THREE-math Undo/Redo スナップショットスタック（テスト対象）
  poseMath.ts              【Stage4】基底変換 reference-offset⇄T-pose絶対euler（純関数・テスト対象）
  poseAssetCodec.ts        【Stage4】pose/1 encode/decode（validatePose流用）
01_wallpaper/src/lib/lab/motionLab.ts   LabHandles に getRestHipsPosition + controls? 追加（★未コミット・混在）
01_wallpaper/src/VrmViewer.tsx          install・freezeゲート拡張・controls handle・cleanup（★未コミット・混在）
01_wallpaper/vite.config.ts             【Stage4】POST /__lab/pose/save（dev白名簿・コミット済）
01_wallpaper/public/poses/sample_wave.pose.json  【Stage4】サンプル
tools/test_pose_undo.mjs / test_pose_math.mjs / test_pose_codec.mjs   【Stage3/4】
docs/POSE_COMPOSER_0_8_{AUDIT,PROGRESS,HANDOFF}.md / POSE_ASSET_SCHEMA_V1.md
```
**未作成（Stage 5+で追加予定）**: `poseKeyframeBridge.ts` / `boneDragProfiles.ts` / `boneSoftLimits.ts` / `tools/test_keyframe_bridge.mjs` / `test_pose_mirror.mjs` / `public/poses/hands/*`。DSL側 `evaluate.ts`/`types.ts`/`compileClip.ts`/`validate.ts` の q キー拡張（Stage 5・後方互換厳守）。

**変更外（触るな）**: motion/scene の `*.json`・`MOTION_AUTHORING_GUIDE.md`・`reviewPanel.ts`・`README.md`・`.gitignore`・staged deletions は本作業と無関係（別機能 work-hand-pin ほか）。

---

## 6. 起動・検証レシピ（毎回これで現状確認）

```
# 1) dev起動（repoルートの .claude/launch.json "probe"）→ ブラウザ ?poseEdit=1
# 2) パネルが左上に出る。Begin → 人型クリック → XYZ°入力 → 形が変わる
# 3) headless/agent検証は console(preview_eval)で:
const pc = window.__poseComposer;
pc.begin({ camera: { position:[1.0,1.05,1.5], target:[0,0.95,0], fov:40 } });
window.__motionLab.setPropsVisible(false);          // クリーン背景
pc.selectBone('rightUpperArm'); pc.setBoneOffsetEuler('rightUpperArm',[0,0,0.9]);
pc.setBoneOffsetEuler('head',[12,0,8],{degrees:true});
await pc.capture({ file:'_pose/check.png' });        // 返り値 path を Read で目視
pc.resetAll(); pc.end();
# 注: file編集後はフル reload（location.reload）で StrictMode/HMR 分裂を回避
```

---

## 7. 次回以降の作業（Stage 3–7 具体手順）

各Stage末で `tsc -b` + `npm run build` green、PROGRESS.md 追記、可能なら capture 目視。

### Stage 3 — 3Dギズモ + Undo/Redo（✅ 完了 2026-07-01・commit `3b71ca9`・詳細は PROGRESS §3）
- **TransformControls**（`three/examples/jsm/controls/TransformControls.js` 同梱確認済）を選択ボーンの normalized node に attach。`mode='rotate'`, `space='local'`。translate は hips のみ許可、scale 禁止。
- ギズモは scene に add（freeze render に写る）。**ドラッグ中の値取り込み**: `objectChange` で node.quaternion を読み `offset = inv(ref)*local` を `setBoneLocalQuaternion` 相当で overrides に格納（drawFrame が `ref*offset` で再構築＝整合）。
- **描画駆動**: 実ブラウザでは poseComposer active 中 viewer rAF は止まる。連続ループは持たず、**TransformControls `change` / OrbitControls `change` イベントで drawFrame をrender**（イベント駆動）。
- **Orbit排他**: ギズモ `dragging-changed` 中は OrbitControls を無効化。※pose編集中にカメラを回すには PoseComposer がカメラを回せる必要がある→ handles に `controls` を出すか、pose専用の簡易orbitを持つ（設計判断・PROGRESSに記録）。
- **Undo/Redo（§11）**: overrides(+hipsOffset) のスナップショット方式。**ギズモ1ドラッグ=1コマンド**（drag開始でsnapshot、`dragging-changed=false`でcommit）。数値入力は確定(blur/Enter)で1件。最大100。Undo後の新操作で redo破棄。asset load(Stage4)で履歴clear。
- パネル: Undo/Redo/Gizmoトグル ボタン。pose-edit有効時のみ効く capture-phase キー（`Ctrl+Z`/`Ctrl+Shift+Z`、§17 衝突回避＝App handlerより先に intercept+stopPropagation）。最終キー割当を PROGRESS に記録。

### Stage 4 — Pose Asset 保存/読込（✅ 完了 2026-07-01・commit `ebe7c5f`・詳細は PROGRESS §4 / スキーマは POSE_ASSET_SCHEMA_V1.md）
- `poseMath.ts`(純関数・THREE math のみ): `offset⇄localQ`、`euler⇄quat`、**reference基準offset → T-pose絶対オイラー**(=`euler(ref*offset)`)、その逆(load: `offset=inv(ref)*Q(poseEuler)`)。`q`と`-q`同値は `|dot|` 比較。
- `poseAssetCodec.ts`: 書き=各**編集ボーンのみ**を `pose/1`(`bones:{bone:[x,y,z]}`,`hipsOffset`,`schema:"pose/1"`,`id`,`label`)へ。読み=`validatePose` 流用＋offsetへ逆変換して overrides に load（reference は不変）。changed-bones-only を既定（§8.2）。
- **dev endpoint 追加**（[vite.config.ts](../01_wallpaper/vite.config.ts) `motionLabApi`）: `POST /__lab/pose/save`（白名簿 `public/poses/` と `public/poses/hands/`、`ap/serve`限定、`..`拒否、`path.resolve`後 dir で startsWith 検査、上書き前backup）。Export/Import JSON はブラウザ blob/file input（dev非依存）。
- **テスト**: `tools/test_pose_codec.mjs` / `test_pose_math.mjs`（valid/invalid・normalize・10000回無drift・reset厳密復帰・**ref*offset⇔Tpose絶対の往復一致**・changed-only・hand混入拒否）。
- QA: `pose保存→reload→同一姿勢`（capture 比較）。`public/poses/samples/*` 作成。

### Stage 5 — Motion Key 連携（q キー）
- **評価器拡張**（[evaluate.ts](../01_wallpaper/src/lib/motion/dsl/evaluate.ts)/[types.ts](../01_wallpaper/src/lib/motion/dsl/types.ts)/[compileClip.ts](../01_wallpaper/src/lib/motion/dsl/compileClip.ts)/[validate.ts](../01_wallpaper/src/lib/motion/dsl/validate.ts)）: `TrackKey = {t,e,ease} | {t,q,ease}`（排他）。**audit A-5 推奨=q は offset とは別の「絶対quaternionトラック層」**として足し、既存 e-track は無改修。サンプリングは e→quat / q を**slerp**（全eトラックは現行euler線形補間のまま＝数値完全後方互換、qが混ざる時のみslerp経路）。compiler は最終 quaternion track なので下流無改修。
- `poseKeyframeBridge.ts`: registry の raw doc に q キーを **sorted insert / epsilon(1/120) replace / delete**。Motion Key mode（§5.2）= Lab timeline 固定時刻 t で motion を決定論評価して base にし、その上に override → 現在t へ q キー挿入。`POST /__lab/motion/save`（`public/motions/dsl/` 白名簿）。
- **テスト**: `test_keyframe_bridge.mjs`（e既存互換・q compile・sorted insert・epsilon replace・delete・loop端キー保護）。

### Stage 6 — DragPad / Hand Shape
- `boneDragProfiles.ts`: **GUIDE §4 実測符号表**から front/side/twist の `AxisBinding`(axis/sign/radPerPixel) をボーン毎に。左右は符号明示。汎用固定マップ禁止。
- パネルに 2D RotationPad（Front/Side/Twist、Shift=0.1x、ダブルクリックreset）。drag量→profile→選択ボーン回転。
- Hand Shape mode: 指＋手首のみ対象の専用パネル、左右明示。保存は `hand/1`（side対応、`both`は右ミラー `[x,-y,-z]`）。body bone 混入を弾く。

### Stage 7 — Copy / Mirror / QA
- Copy to Opposite（同 offsetQ を反対側へ）。Mirror to Opposite（YZ反射 `S*R*S`＋反対側 parent で local 解決、§12）。**Mirror は安全に作れねば feature-flag OFF**（中途半端を出荷しない）。`test_pose_mirror.mjs`（L→R→L 近似復帰・identity→identity・左右対称world）必須。
- `boneSoftLimits.ts`（config・警告のみ・肘/膝の逆関節・首twist、GUIDE §4 由来）。Safe mode 時のみ clamp。
- 回帰・残提出物（下記）。

---

## 8. 残提出物（指示書 §23）
- [ ] `docs/POSE_COMPOSER_0_8_REPORT.md`（完了レポート §24 必須項目）
- [ ] `docs/POSE_COMPOSER_0_8_CHECKLIST.md`（§22 完了条件）
- [ ] `docs/POSE_ASSET_SCHEMA_V1.md`（保存スキーマ＝pose/1 と q キー仕様）
- [ ] サンプル資産 `public/poses/samples/*`, `public/poses/hands/*`
- [ ] テスト群（pose codec / authoring math / keyframe bridge / undo-redo / mirror）

---

## 9. ロールバック / コミット
- **branch** `feat/pose-composer-0.8`（base `5220449` "feat: add production wallpaper shell"）。コミット3件:
  - `d84fdd8` checkpoint(Stage 0-2): `poseComposer/{poseComposer,poseComposerPanel,boneMapDefinition}.ts` + docs3。
  - `3b71ca9` Stage 3: `poseComposer.ts`(gizmo+undo) / `poseComposerPanel.ts` / `poseHistory.ts`(新) / `tools/test_pose_undo.mjs`(新)。
  - `ebe7c5f` Stage 4: `poseMath.ts`(新) / `poseAssetCodec.ts`(新) / `poseComposer.ts` / `poseComposerPanel.ts` / `vite.config.ts` / `public/poses/sample_wave.pose.json`(新) / `test_pose_math.mjs` `test_pose_codec.mjs`(新)。
- **未コミット残置（意図的）**: `VrmViewer.tsx` / `motionLab.ts`。理由=無関係の未コミット機能「work-hand-pin IK」と同一ファイル内で交錯し、ファイル単位で分離不可（instruction #3）。**作業ツリーは全green**（tsc/build/tests）だが、branchのコミット状態だけでは統合行が欠けるため単体ビルド不可＝これは制約の必然。Stage 0-2 から同状態。
- **doc更新のコミット**: 本 HANDOFF / PROGRESS / POSE_ASSET_SCHEMA_V1.md はStage完了ごとに pose-composer doc として単独コミット可。
