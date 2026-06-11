# トーホク・ウォールペーパー 現状レポート（STATUS）

- **日付**: 2026-06-10
- **対象**: プロジェクト全体（中心は `TOHOKU_WALLPAPER_MOTION_PROBE_0_1` の Motion Probe 0.4）
- **位置づけ**: Motion Probe 0.4 到達状態を **安全に固定**するための現状スナップショット。
  本日の Safety / Docs Pack で、再配布禁止モデルの `dist/` 混入対策・README/ドキュメント整備を実施済み。

---

## 1. 全体構成

リポジトリ・ルートは Git 管理外。実体は **2つの独立した React + Vite + TypeScript アプリ** と支援素材／ツール群。

| 区分 | パス | 役割 | 規模 | 状態 |
|------|------|------|------|------|
| Motion Probe | `TOHOKU_WALLPAPER_MOTION_PROBE_0_1/` | VRMキャラ表示＋モーション＋小道具配置の検証 | src 約2,195行 | **0.4 到達** |
| UI Overlay | `TOHOKU_WALLPAPER_UI_OVERLAY/` | 時計・天気・右ドック・各パネルのUI | src 約1,853行 | 単体稼働 |
| Motion Pack | `VRMA_MotionPack/` | サンプル `.vrma` モーション7本 | — | 素材置き場 |
| Docs（全体） | `docs/` | VRMモデル監査・本STATUS | — | — |
| ツール | `parse_vrm.py` / `extract_metadata.py` ほか | VRMメタ抽出・監査 | — | 監査済 |

---

## 2. Motion Probe の到達点（中心）

`TOHOKU_WALLPAPER_MOTION_PROBE_0_1` は 0.1 → 0.4 の4段階で発展。各ソースのヘッダコメントに段階が明記されている。

主な到達点:

- **VRM表示**（`@pixiv/three-vrm` + three r184、React 19 + Vite）
- **Custom Expression Bridge** — MMD由来VRM 0.x特有の「68モーフが先頭レイヤーのみ／頂点バッファ共有」問題で標準 `expressionManager` が無効化されるのを、モーフ参照共有＋`blendShapeMaster` index 直接駆動で解決（`src/VrmViewer.tsx`）。
- **Idle State Machine** — 5状態（Breath/Monitor/Glance/Sleepy/Smile）＋自動遷移＋ポップレス・クロスフェード（`src/lib/motion/idleStateMachine.ts`）。
- **External Motion** — `.vrma` 読込＋組み込み手続きクリップ、AnimationMixer＋クロスフェードブレンド（`src/lib/motion/externalMotionController.ts` / `vrmaClip.ts` / `proceduralClip.ts`）。
- **Scene / Props Loader** — `scene.json` 読込、小道具GLB配置、プレースホルダ箱フォールバック、ライティング適用（`src/lib/scene/*`）。
- **scene.json 再読込** — `G` キーで再ビルド不要のホットリロード。
- **props placeholder fallback** — GLB欠損でもクラッシュせず半透明箱で代替。

設計上の強み:

- 全手続きモーションが「キャッシュ初期姿勢からの**時間の純関数オフセット**」で累積ドリフトゼロ（長時間常駐に安全）。
- モーション・シーンのコアロジックが **THREE 非依存**で、背景タブ（rAF間引き）でも **Node ヘッドレステスト**で検証可能（`.probe_tmp/`、リポジトリ非同梱）。

---

## 3. UI Overlay の位置づけ

`TOHOKU_WALLPAPER_UI_OVERLAY` は Wallpaper Engine 上に重ねる **UIレイヤー**（時計・天気コンパクト/詳細・右ドック・各パネル: Music/AI/News/Memo/Settings）。
現状は **Motion Probe とは別アプリ**として単体で動作。レイアウト/設定は `localStorage` 永続化。天気は自前サービス＋モックで、外部API連携（Companion App 経由）は未着手。

> 将来像: Companion App（Tauri）が `GET /api/state` を提供し、UI Overlay がそれをポーリングして表示する設計（別途メモリ参照）。本フェーズ範囲外。

---

## 4. VRMA_MotionPack の位置づけ

`VRMA_MotionPack/` は VRM Animation（`.vrma`）のサンプル7本（`VRMA_01`〜`VRMA_07`）＋ Readme(JP/EN) を収めた**素材置き場**。
現状、Probe が実際に読むのは `public/motions/sample_idle.vrma`（既定パス）の1本のみ。MotionPack からの選択UIは未実装。

---

## 5. 3系統のローダー

「アセットが無くても落ちない」を共通方針として、ローダーは3系統に整理されている。

### ① VRMキャラ本体
- `public/models/kiritan.vrm`（実物 約31.6MB）を `GLTFLoader + VRMLoaderPlugin` で読込（`src/VrmViewer.tsx`）。
- 読込後に Custom Expression Bridge をセットアップ。**モデルが無い場合は起動時に読込エラー表示**（手動配置前提）。

### ② Scene / Props GLB（0.4）
- `loadScenePreset(sceneId)` が `/scenes/<id>/scene.json` を fetch → `validateScenePreset`（純関数）で検証・正規化 → `loadSceneProps` が各GLBを並列ロード（`src/lib/scene/sceneLoader.ts` / `propLoader.ts`）。
- **多段フォールバック**: GLB欠損 → 半透明プレースホルダ箱（`fallback:"box"`）／`scene.json` 欠損・破損 → 組み込みデフォルトシーン。どの経路も reject しない。
- 同梱小道具は **CC0**（Kenney furniture kit。`public/models/props/ASSET_CREDITS.md`）: `desk.glb`(23KB) / `chair.glb`(40KB) / `laptop.glb`(13KB)。

### ③ 外部モーション `.vrma`（0.3）
- `@pixiv/three-vrm-animation` の `createVRMAnimationClip` で VRM 0.x↔1.0 の座標差を吸収しつつリターゲット（`src/lib/motion/vrmaClip.ts`）。
- **ボーン回転トラックのみ採用**し、表情(`weight`)・腰移動(`position`)・LookAtプロキシは除去（表情は Bridge 優先、移動はキャラを定位置保持）。

---

## 6. 0.1〜0.4 の進捗

| 段階 | 追加内容 | 状態 |
|------|----------|------|
| 0.1 | VRM表示・呼吸・まばたき・LookAt・SpringBone・Custom Expression Bridge | ✅ |
| 0.2 | Idle State Machine（5状態＋自動遷移＋クロスフェード） | ✅ |
| 0.3 | External Motion（`.vrma`/組み込みクリップ＋AnimationMixer＋ブレンド） | ✅ |
| 0.4 | Scene / Props Loader＋ライティング適用 | ✅ |
| — | **Safety / Docs Pack（本日）**: dist VRM除外（strip+check）・README 0.4化・本STATUS | ✅ |

---

## 7. 未実装 / 既知の制約

1. **背景合成は未実装** — `scene.json` の `room_back.png` / `outside.png` / `light_overlay.png` は参照のみで**ファイル未同梱・未描画**（受け口だけ）。背景は暗色のまま。
2. **シーンのカメラ／キャラ配置ブロック未適用** — `scene.json` の `camera` / `character` は読むがハードコードの 1/2/3 カメラが優先。
3. **シーンは1種類のみ**（`room_workdesk_day`）。切替UIなし。
4. **`.vrma` は固定1本のみ** — MotionPack 7本からの選択UIなし。
5. **2アプリ未統合** — Motion Probe（キャラ）と UI Overlay（時計・天気・ドック）は別アプリのまま。
6. **Companion App（Tauri）未着手** — API連携・状態管理は未実装。
7. 天気・ニュース・音楽・AIチャットの本実装は未着手（本フェーズ範囲外）。

---

## 8. ライセンス上の注意（最重要）

- 対象モデル **ふらすこ式風東北きりたん** は **再配布禁止**（`licenseName: Redistribution_Prohibited`、商用利用禁止・暴力/性的表現禁止。ガイドライン: https://zunko.jp/ ）。監査: `docs/VRM_MODEL_AUDIT_flasco_kiritan.md`。
- **`kiritan.vrm` をリポジトリ／配布物に同梱不可。** ユーザー手動配置が必須（`public/models/README_MODEL_PLACEMENT.md`）。
- **`dist/` への混入対策（本日実施）**: Vite は `public/` を `dist/` に丸ごとコピーするため、`npm run build` の末尾で `scripts/strip-dist-vrm.cjs` が `dist/**/*.vrm` を自動削除。さらに `npm run check:dist-assets`（`scripts/check-dist-assets.cjs`）で `dist/` に `.vrm` が残っていれば **exit 1** で失敗させる安全ゲートを追加。
- 小道具GLBは **CC0**（`ASSET_CREDITS.md` に出典記録）。ライセンス不明・再配布禁止素材は同梱しない方針。

---

## 9. 次の候補（私見・優先度順）

1. **背景合成の実装**（0.5想定）— 既に受け口がある `roomImage` / `outsideImage` / `lightOverlay` を実合成し、「自室・昼・作業机」を完成させる。
2. **`.vrma` 選択UI** — MotionPack 7本を切替可能に。
3. **シーンのカメラ/キャラ配置ブロックの適用** — `scene.json` 駆動のカメラへ寄せる。
4. **2アプリ統合 or Companion App 着手** — 壁紙としての最終形に向けた本筋。

---

## 10. 健全性確認（2026-06-10 時点）

- `npx tsc -b`: ✅（後述の実行ログ参照）
- `npm run build`: ✅（末尾で `.vrm` を自動 strip）
- `npm run check:dist-assets`: ✅（`dist/` に `.vrm` 無し）
- `public/models/README_MODEL_PLACEMENT.md`: 残存 ✅
- 既存機能（0.1〜0.3）: 非破壊（rig 合成・Scene 系コードは未変更、追加は scripts/docs/README のみ） ✅
