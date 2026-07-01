# POSE COMPOSER 0.8 — 進捗（PROGRESS）

- **Date 開始**: 2026-06-24
- **監査**: [docs/POSE_COMPOSER_0_8_AUDIT.md](POSE_COMPOSER_0_8_AUDIT.md)
- **master方針(2026-06-24)**: Pose形式=pose/1に寄せる(内部quat→保存時T-pose絶対オイラー) ／ UI=素DOMパネル+`window.__poseComposer` ／ 各Stage末で型check+build

| Stage | 内容 | 状態 |
|------|------|------|
| 0 | 既存構造監査 | ✅ 完了（AUDIT.md） |
| 1 | Authoring Session 基盤 | ✅ 完了（本書 §1） |
| 2 | Bone選択＋数値編集＋素DOMパネル | ✅ 完了（本書 §2） |
| 3 | 3Dギズモ＋Undo/Redo | ✅ 完了（本書 §3・commit `3b71ca9`） |
| 4 | Pose Asset 保存/読込（pose/1書き出し・dev endpoint） | ✅ 完了（本書 §4・commit `ebe7c5f`） |
| 5 | Motion Key連携（qキー評価器拡張） | ⏸ **park**（2026-07-01・完成ルート復帰の判断） |
| 6 | DragPad / Hand Shape | ⏸ **park**（同上） |
| 7 | Copy / Mirror / QA | ⏸ **park**（同上） |

> **コミット**（branch `feat/pose-composer-0.8`, base `5220449`）: `d84fdd8`(Stage0-2 checkpoint) → `3b71ca9`(Stage3) → `ebe7c5f`(Stage4) → `a50080f`(Stage1-4統合配線, 2026-07-01) → `099b9cf`(production gate fix, 2026-07-01)。
> `vite.config.ts` は元々無変更だったので Stage4 で単独コミット済み。

## Pose Composer 0.8 — 2026-07-01 着地点（完成ルート復帰）

```text
Pose Composer 0.8:
- Stage 0〜4: completed / green
- Stage 5〜7: parked
- production completionには不要
- 再開条件: 製品版完成後に明示的な判断があった場合のみ
```

2026-06-24〜06-30 の間、Stage 1-4 のコミット (`d84fdd8`/`3b71ca9`/`ebe7c5f`) が参照する
`installPoseComposer`/`installPoseComposerPanel`/`window.__poseComposer` の実際の配線
（`VrmViewer.tsx` の `labHandles` 共有・freezeゲート拡張・cleanup、`motionLab.ts` の
`controls?`/`isSceneReady?`/`getRestHipsPosition` handle）が、無関係な実験
「work-hand-pin IK」と同一ファイル内で交錯したまま**作業ツリーに未コミットで放置**されていた
（Stage0-2/3/4のコミット単体をcheckoutしても Pose Composer は起動しない状態）。

2026-07-01 の完成ルート復帰作業で以下を実施:
1. 作業ツリーを rescue branch (`rescue/pre-split-2026-07-01`) へ退避コミットしてバックアップ。
2. Pose Composer統合行のみを抽出し `a50080f` としてコミット（Stage 0-4が単独チェックアウトで
   動作するようになった）。
3. work-hand-pin IK は無関係の別ブランチ `wip/work-hand-pin-ik-2026-07-01` (`dbf0812`) へ隔離。
4. `App.tsx` の `productionMode` 判定が `poseEdit` クエリを見ておらず、production URLに
   `?poseEdit=1` を付けると `production-mode` のまま `window.__poseComposer` が有効化される
   バグを発見・修正（`099b9cf`）。
5. 実機検証（`?poseEdit=1`）: begin→bone編集→inspect→resetAll→end、savePose→resetAll→loadPose
   の往復、production URL（クエリなし）で `__poseComposer`/`__motionLab` が共に未定義であること
   を確認。console error なし。
6. 全自動試験 green: motions 54 / director 90 / expression 263 / pose_math 133 /
   pose_codec 22 / pose_undo 32 = **594/594 PASS**。

Stage 5（qキー評価器拡張・DSLへのMotion Key連携）以降は、今回の完成ルート方針により
**実装しない**。理由は「モーション制作は最低限で終了し、製品完成に直接必要な接続・配布・
運用品質へ移行する」という2026-07-01の明示判断（`docs/COMPLETION_AUDIT_2026-07-01.md` 参照）。
再開する場合は製品版完成後に改めて判断すること。

---

## 1. Stage 1 — Authoring Session 基盤（完了 2026-06-24）

### 1.1 何を作ったか
- **新規** `01_wallpaper/src/lib/lab/poseComposer/poseComposer.ts` … `class PoseComposer` ＋ `installPoseComposer()`。`window.__poseComposer` に載る dev 専用 API。Lab と同じ handle bag を共有。
- **改修** `01_wallpaper/src/lib/lab/motionLab.ts` … `LabHandles` に `getRestHipsPosition: () => THREE.Vector3 | null` を追加（reference hips 位置の供給口）。
- **改修** `01_wallpaper/src/VrmViewer.tsx`：
  - import＋`poseComposerRef`。
  - install ブロックを共有 `labHandles` 定数に整理し、`installMotionLab(labHandles)` の直後に `installPoseComposer(labHandles)`。`getRestHipsPosition: () => initialHipsPosRef.current` を供給。
  - **freeze ゲート拡張**（最重要・1行）：`if (labRef.current?.isFrozen() || poseComposerRef.current?.isActive()) return;` — セッション中は本番 rAF が pose/描画に触れず、override は本番合成順に構造的に混入しない。
  - unmount cleanup で `window.__poseComposer` を破棄。

### 1.2 Authoring Override の合成位置（実装どおり）
セッション中の1フレーム（`drawFrame`）：
```
restoreReference()                 // 全 cached bone → reference quaternion、hips → rest position
→ 各 override bone: node.quaternion = referenceQ * offsetQ   （毎フレーム再構築＝無蓄積）
→ hipsOffset があれば hips.position = restHips + offset
→ humanoid.update()
→ optional LookAt / Expression(Bridge) / SpringBone settle   （既定 OFF・個別 ON）
→ scene.updateMatrixWorld(true) → renderer.render()
```
- reference は viewer の `initialRotationsRef`（腕下ろし正典姿勢）を `getRestQuaternions()` 経由で読むだけ。**書き換えない**。
- override は bone→**offset quaternion**（reference 基準）の Map が正本。euler 入力は内部で quaternion 化して保持。

### 1.3 公開 API（Stage 1）
```
__poseComposer.begin({ mode?, camera? })            // freeze＋reference へ・session 開始
__poseComposer.setBoneOffsetEuler(bone, [x,y,z], { degrees? })   // 主編集単位（reference からの local offset）
__poseComposer.setBoneLocalQuaternion(bone, [x,y,z,w])           // 絶対 local → offset=inv(ref)*local（gizmo 用）
__poseComposer.setHipsOffset([x,y,z]|null)          // basePose のみ
__poseComposer.inspectBone(bone) / dumpPose()       // 読み出し（offset euler度＋quat）
__poseComposer.resetBone(bone) / resetAll()
__poseComposer.setLookAt(b)/setSpringBone(b)/setExpression(name|null)   // 「残りのリグ」を個別 ON
__poseComposer.setCamera(preset|{position,target,fov})
await __poseComposer.capture({ width?, height?, file? })   // PNG→.probe_tmp/captures/_pose/、絶対パス返す
__poseComposer.end({ discard? })                    // override 破棄＋reference 復元＋通常ループへ
__poseComposer.status() / help()
```
- 全メソッド `{ ok, ... }` を返し **throw しない**（Lab と同契約）。

### 1.4 検証（実機・headless チャネル）
`?lab=1` で起動し `__poseComposer` を driver。**rAF は headless preview タブで停止する**ため、検証は Lab と同じ「freeze＋手動 render→toDataURL→`/__lab/save`→PNG Read」経路で実施（連続再描画依存の `preview_screenshot` は使わない）。

確認済み（キャプチャ `.probe_tmp/captures/_pose/`）：
1. **override 反映**：`begin` → `head [14,0,8]°`・`rightUpperArm z+0.9`・`rightLowerArm y−0.7` → `stage1_edited.png` で頭のかしげ＋うつむき、右腕の挙上＋肘曲げが目視で確認。
2. **reference 復元**：`resetAll()` → `stage1_reset.png` が `stage1_base.png` と**画素一致**。
3. **残留なし**：`end()` 後 `status.overriddenBones=[]` / `dirty=false`、live `rightUpperArm` が reference `[0,0,-0.5646,0.8253]` と**厳密一致**（`armMatchesRef:true`）。
4. **euler↔quat 往復安定**：`head [14,0,8]°` 入力→保持→読み出しで `[14,0,8]°` 厳密復帰。
5. **凍結解除**：`end()` 後 `isActive()=false` / `__motionLab.isFrozen()=false`。ゲート変更は inactive 時に false の純加算 disjunct ＝ 既存 freeze/thaw 再開と挙動同値。

> 補足：headless では `requestAnimationFrame` のコールバックが 500ms で 0 回（throttle）。よって live idle/clip ループの再開は preview では観測不可だが、これは環境制約であり Stage 1 のコード起因ではない（手動 render の capture は全て正常）。live ループ再開の正しさはゲート変更が inactive 時 no-op であることから構造的に保証。

### 1.5 ビルド/型
- `npx tsc -b` → exit 0（green）
- `npm run build`（`tsc -b && vite build && strip-dist-vrm`）→ exit 0（green）。chunk>500kB 警告は既存・無関係。

### 1.6 既知の Stage 1 制約 / 次段送り
- **UI パネルなし**：Stage 1 は API のみ（指示書「最小ボタンでよい」）。素 DOM パネル（`?poseEdit=1`）は Stage 2。
- **dirty 意味**：現状「reference と差があるか」。saved pose 基準の dirty は load/save 実装（Stage 4）で精緻化。
- **base/motion 評価（§7.2 B/C）未実装**：今は reference が base。Base Pose 読込は Stage 4、Motion 固定時刻評価は Stage 5。
- **pure-math 抽出＋Node テスト未**：authoring math は現状 poseComposer 内（THREE/handle 結合）。`poseMath.ts` へ純関数抽出＋`tools/test_pose_*.mjs` は Stage 4（保存の基底変換 reference-offset↔T-pose絶対）と同時に。Stage 1 の no-drift/reset厳密復帰は実機で確認済み。
- **ショートカット**：未割当（§17）。Stage 2 のパネルで pose-edit 中のみ効く capture-phase リスナとして導入し記録。

### 1.7 すぐ試す手順（master 用）
```
# repルートで dev サーバ（probe）起動 → ブラウザで ?lab=1
# DevTools console:
__poseComposer.help()
__poseComposer.begin({ camera: { position:[1.0,1.05,1.5], target:[0,0.95,0], fov:40 } })
__motionLab.setPropsVisible(false)                      # クリーンに見たいとき
__poseComposer.setBoneOffsetEuler('head', [14,0,8], { degrees:true })
__poseComposer.setBoneOffsetEuler('rightUpperArm', [0,0,0.9])
await __poseComposer.capture({ file:'_pose/try.png' })  # 返り値の path を開く
__poseComposer.resetAll()
__poseComposer.end()
__motionLab.setPropsVisible(true)
```

### 1.8 ロールバック
Stage 1 変更ファイル: `poseComposer.ts`(新規) / `motionLab.ts`(LabHandles 1行) / `VrmViewer.tsx`(import・ref・install・gate・cleanup)。未コミット（master のコミット指示待ち）。

---

## 2. Stage 2 — Bone選択＋数値編集＋素DOMパネル（完了 2026-06-24）

### 2.1 何を作ったか
- **新規** `poseComposer/boneMapDefinition.ts` … 人型SVGの静的レイアウト（`BoneMapNode[]`：front/side座標・JPラベル・parent・group）。MVPボーン22本（指は除外＝Stage 6のHandパネル）。viewBox 120×240。向きは画面と一致（本人左＝画面右 x>60）。
- **改修** `poseComposer/poseComposer.ts` … 選択＋3Dオーバーレイ＋パネル供給API追加:
  - `selectBone(name|null)` / `getSelected()` / `setMode()` / `boneStates()`（bone→{present,edited}）。
  - 選択ボーン3Dハイライト（小球＋ローカル軸 `AxesHelper`）。`drawFrame` 毎に選択ボーンの world transform へ配置。lazy生成、`end()` で dispose（VRM material は触らない＝§10.1）。`status()` に `selectedBone` 追加。
- **新規** `poseComposer/poseComposerPanel.ts` … 素DOMフローティングパネル（reviewPanel流儀）。`?poseEdit=1` で注入。Begin/End・mode選択・dirty/activeピル・Front/Side切替の人型SVG（クリックで選択、状態色: 通常/編集=amber/選択=青枠/欠損=disabled）・選択ボーンのXYZ°数値入力・Reset selected/all。`[H]` で隠す。
- **改修** `VrmViewer.tsx` … install条件に `?poseEdit=1` を追加し、pose composer の直後にパネルを install（poseEditのみ）。

### 2.2 重要な修正（StrictMode/HMR インスタンス分裂）
`<StrictMode>`（main.tsx）で VrmViewer の mount effect が二度走り、`window.__poseComposer` は2個目のインスタンス(B)になる一方、パネルDOMは1個目(A)のinstall時の closure を握ったまま（installガードで再wireされない）。各インスタンスは別の `active` フラグを持ち、viewerのfreezeゲートはBを見るため「パネルのBeginがAを起こすが画面はBを見て凍結しない」分裂が起きた。
**修正**: パネルは常に**生きているインスタンス**を駆動する。`const PC = () => window.__poseComposer ?? pc` を導入し、全ハンドラを `PC().…` 経由に。これでパネルは viewer のゲートが見るインスタンス＝`poseComposerRef.current` と必ず一致。HMR再マウントにも頑健。

### 2.3 検証（?poseEdit=1・実機headlessチャネル）
パネルの**実DOMハンドラ**を直接叩いて確認（API直叩きではなく Begin ボタン click・SVG circle click・input イベント）:
- パネル設置: bone円22・skeleton線21・VRM load 済。
- Beginボタン → `active:true`。circle click(`rightUpperArm`) → `selectedBone` 反映。XYZ入力(Z=52°) → `overriddenBones` に追加・`dirty:true`。
- 選択円=青枠 r4.6 / 編集円=amber `#e0a23a` / 欠損 `upperChest`=pointerEvents none。
- Front/Side切替: head cx 60↔64。Reset selected: head のみ override 解除（rightUpperArm 残）・入力欄 0,0,0。
- キャプチャ `_pose/stage2_panel.png`: 頭うつむき＋かしげ・右腕挙上の**ポーズ反映**＋頭ボーンに**選択オーバーレイ（青球＋RGBローカル軸）**が目視確認。
- `tsc -b` green / `npm run build` green（bundle +12KB）。

### 2.4 既知の Stage 2 制約 / 次段
- **3D→SVG 逆選択（3Dクリックでボーン選択）未**: ギズモ/レイキャストが入る Stage 3 で。現状 SVG/API→3D ハイライトの一方向。
- **人型SVGは静的座標**（実VRM投影は §25 1.1）。side viewの左右はdepthで微オフセットの簡易版。
- **数値入力はlive(input)適用**: Undo単位の確定（blur/Enter=1件）は Undo を入れる Stage 3 で。
- パネルの disabled 反映は自前ハンドラ＋1秒poll。API直叩きと混ぜると一時的にstaleに見えるが実害なし（テスト時の注意）。
- ショートカット: パネルは `H` のみ（INPUTフォーカス時は無効化）。pose-edit専用キーの本格導入は Stage 3。

### 2.5 すぐ試す（master 用）
```
# dev起動 → ブラウザで ?poseEdit=1（左上にパネル）
# Begin → 人型でボーンをクリック → XYZ°を入力 → 形が変わる
# Front/Side でビュー切替、Reset で戻す、End で通常へ
# 補足: クリーンに見たいときは console: __motionLab.setPropsVisible(false)
```

### 2.6 ロールバック
Stage 2 追加/変更: `boneMapDefinition.ts`(新規) / `poseComposerPanel.ts`(新規) / `poseComposer.ts`(選択+overlay) / `VrmViewer.tsx`(panel install)。未コミット。

---

## 3. Stage 3 — 3Dギズモ＋Undo/Redo（完了 2026-07-01・commit `3b71ca9`）

### 3.1 何を作ったか
- **新規** `poseHistory.ts` … 純THREE-math の Undo/Redo スナップショットスタック（VRM/renderer/DOM非依存＝Nodeで単体テスト可）。`PoseSnapshot`(overrides + hipsOffset) / `cloneSnapshot` / `snapshotsEqual`(q≡−q は `|dot|` 比較) / `class PoseHistory`(begin/commit/undo/redo/clear、上限100)。
- **改修** `poseComposer.ts`:
  - **ギズモ**: `three/examples/jsm/controls/TransformControls`(r0.184)を選択ボーンの normalized node に `attach`。`rotate`＋`local` space、hips のみ `translate` 可（root motion）。`getHelper()` を scene に add＝**freeze render に写る**。ドラッグ中は `objectChange` で `node.quaternion` を読み `offset = inv(ref)·local` を override へ格納→`drawFrame` が `ref·offset` で再構築（整合・無蓄積）。
  - **描画駆動**: viewer rAF は session中停止のため**イベント駆動**。gizmo `change`/`objectChange`・orbit `change` で `drawFrame`。ドラッグ中は `change` を抑止し `objectChange` に描画を一本化（先発の `change` が bone quaternion を stale で上書きするのを回避）。
  - **カメラ周回**: viewer の OrbitControls を handle 経由で借用（`h.controls`）。session中 `enableDamping=false`＋`enabled=true`、ギズモ `dragging-changed` 中は `enabled=false`。`end()` で元の状態へ復元。handle が無くても劣化動作（ギズモ/undoは有効）。
  - **Undo/Redo**: 全 mutating setter を `withUndo()` 経由で「1操作=1コマンド」。ギズモ1ドラッグ=drag開始→drag終了で1件、パネル数値=focus→blur で1件（`beginCommandGroup`/`endCommandGroup`）。`undo()`/`redo()` は snapshot 復元→`recomputeDirty`→gizmo再同期→`drawFrame`。
- **改修** `poseComposerPanel.ts`: ギズモtoggle＋回転/移動(hips)ボタン、Undo/Redoボタン、数値inputの focus/blur/Enter でコマンド境界、**capture-phase の `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y`**（pose-active時のみ・INPUT時除外・`stopPropagation` で App ハンドラと隔離＝§17）。
- **改修（未コミット・混在ファイル）** `motionLab.ts`(`LabHandles.controls?: OrbitControls`) / `VrmViewer.tsx`(`controls,` を labHandles へ)。

### 3.2 ショートカット最終割当（§17）
- `Ctrl/⌘+Z` = Undo、`Ctrl/⌘+Shift+Z` / `Ctrl+Y` = Redo。**pose-edit active 時のみ** capture-phase で intercept＋`stopPropagation`（App の window ハンドラより先）。INPUT/TEXTAREA フォーカス時はネイティブundoに委ねる。ギズモtoggle・rotate/translate はパネルボタン（単キー空きが `d i q w y z` のみのため単キー割当は見送り）。

### 3.3 検証
- `tsc -b` green / `npm run build` green。
- `node tools/test_pose_undo.mjs` = **32/32 PASS**（snapshotsEqual の q≡−q・1操作1件・no-change無push・undo/redo往復・redo無効化・上限100・clear・deep-copy分離）。
- 実機（`?poseEdit=1`・freeze capture）: base→編集2件→undo×2→redo→ギズモ表示 を capture。**ギズモのRGB回転リングが選択ボーン(rightUpperArm)に描画**され、undoが編集を視覚的に巻き戻すことを確認。`status` の undo/redo 段数遷移・`end({discard})` 後の残留ゼロ（active/gizmo/overrides/history すべて空、`__motionLab.isFrozen()=false`）を確認。console error なし。

---

## 4. Stage 4 — Pose Asset 保存/読込（完了 2026-07-01・commit `ebe7c5f`）

### 4.1 何を作ったか
- **新規** `poseMath.ts`（純THREE-math）… 基底変換の要。`eulerToQuat`/`quatToEuler`/`offsetToAbsoluteLocal`(=ref·offset)/`absoluteLocalToOffset`(=inv(ref)·abs)/`poseEulerFromOffset`(**SAVE**: reference基準offset→T-pose絶対euler)/`offsetFromPoseEuler`(**LOAD**: 逆)/`isIdentityQuat`/`quatsEqual`。
- **新規** `poseAssetCodec.ts` … `encodePose`（**changed-vs-T-pose**: `ref·offset` が identity でないボーンのみ書く＝未編集の腕ドロップ±1.2は保持しつつ identity ボーンは省略）/ `decodePose`（`validatePose` 流用・model欠損ボーンは `missingBones` 報告・saved==reference は offset identity で override化しない）/ `serializePose`。
- **改修** `poseComposer.ts`: `savePose`/`loadPose`/`exportPose`/`listPoses`＋`buildPoseDoc`。**dirty を精緻化**＝`savedBaseline`（begin/save/load時点）からの差分（`snapshotsEqual`）。help更新。
- **改修** `poseComposerPanel.ts`: 「保存/読込」セクション（id/label 入力・Save(POST)・Export(Blob DL)・Load(id)・Import(file)）。
- **改修** `vite.config.ts`（元々無変更＝単独コミット可）: `POST /__lab/pose/save`。白名簿 `public/poses/` `public/poses/hands/`・`..`拒否・正規表現・上書き前に `.probe_tmp/pose_backups/` へバックアップ・`apply:'serve'`（本番非同梱）。
- **新規サンプル** `public/poses/sample_wave.pose.json`。

### 4.2 master方針の解釈（changed-only の意味）
指示書「編集ボーンのみ/changed-only」は、pose/1 の基底では **「絶対local が T-pose identity と異なるボーン」** と解釈するのが正（既存 `stand_relaxed` が非identityボーンのみを持つのと一致し、かつ**単独で再現可能**）。単に overrides のみを書くと未編集の腕がT-pose化して壊れるため。編集ボーンは非identityの部分集合として自然に含まれる。

### 4.3 検証
- `tsc -b` green / `npm run build` green。
- `node tools/test_pose_math.mjs` = **133/133 PASS**（euler⇄quat往復・offset⇄absolute逆写像・save/load往復・**任意referenceで保存絶対値を再現**・**10000回無drift**・厳密reset・q≡−q・腕ドロップ保持）。
- `node tools/test_pose_codec.mjs` = **22/22 PASS**（changed-vs-Tpose選別・encode→decode往復・不正schema拒否/欠損ボーン報告・hipsOffset非零のみ・**実ファイル stand_relaxed の ±1.2 reference下での往復で 1.15 を再現**）。
- 実機: 編集(head+右腕)→`savePose('sample_wave')`→`resetAll`→`loadPose`。**authored と reloaded が画素一致**、`overriddenBones` 一致、`dirty` は save/load 後 false。保存ファイルは `rightUpperArm=-0.4`(=−1.2+0.8)・`leftUpperArm=1.2`(未編集ドロップ)で正。console error なし。既存回帰: motions 54 / director 90 / expression 263 すべて PASS（DSL無改修）。

### 4.4 既知の制約 / 次段
- **samples ディレクトリ非対応**: 現endpointは `public/poses/` 直下と `hands/` のみ白名簿。サンプルは直下に置いた（`sample_wave`）。`samples/` サブdirが要るなら白名簿追加。
- **hand bone 混入拒否は pose 側では未実装**: pose/1 は指ボーンも正当なため強制排除しない（hand/1 側の Stage 6 で扱う）。
- Motion への q キー挿入（Stage 5）は未。Copy/Mirror（Stage 7）は未。
