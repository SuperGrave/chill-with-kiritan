# Release Baseline 0.9 + Production Wallpaper Shell 実施レポート

- 実施日: 2026-06-23
- branch: `phase1-visual-qa`
- Stage 0開始時HEAD: `1e9aeec85c77357a8d83fd42f8b361394ed67303`
- visual QA最終値commit: `5138a50fc17797303dbe44e222e314053e84a551`
- Release Baseline checkpoint: `ba210b6dc6d5d43b7244f7ef7e00c2aed2924ea6`
- push: 未実施

## Stage 0: Release Baseline

### Git / worktree

開始時は指定3ファイルに加え、同じvisual QA系列の3ファイルと監査レポートが未コミットだった。
調査中の2026-06-23 19:36:49 JSTに、別作業からvisual QA最終値9ファイルをまとめた
`5138a50` が現在branchへ作成されたため、以後はこのHEADを基準に全検証を再実行した。

監査レポートを固定したgreen checkpointが `ba210b6`。

### 指定3差分の採否

#### `loop_sleep_desk.motion.json`

- 頭のpitchを減らし、横向きを強めた。
- 上腕の開きを抑え、前腕を腕枕方向へ寄せた。
- 影響: 顔の横向きと腕枕の端点が明確になり、`tr_sit_to_slump` / `tr_slump_wake` と一致する。
- 判定: 採用。

#### `loop_work_normal.motion.json`

- 上腕をPC方向へ寄せ、下腕の曲げ量を再調整した。
- 影響: 移動後のノートPCに両手が届き、通常作業がタイピングとして読める。
- 判定: 採用。

#### `sit_desk_slump.pose.json`

- spine / chest / neckのx符号を反転し、実座標系で机方向へ深く前傾する値へ変更した。
- 影響: 旧値の逆向き傾斜を解消し、机への突っ伏し姿勢になる。
- 判定: 採用。
- 既知の見た目課題: 深い前傾に追従して背面の「きりたん砲」がカメラ前景へ大きく入る。
  モデル固有アクセサリの専用補正が必要であり、本Stageの「追加モーション調整禁止」を越えるため未対応。

### Stage 0検証

- `01_wallpaper npm run build`: PASS
- `02_ui-overlay npm run build`: PASS
- `03_companion npm run build`: PASS
- `cargo check --manifest-path src-tauri/Cargo.toml`: PASS
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS（unit 2 + integration 1）
- Director tests: 90 PASS
- Motion tests: 54 PASS
- Expression preset tests: 263 PASS

## Stage 1: Production Wallpaper Shell

### 実装方式

- `01_wallpaper`を親アプリにした。
- `02_ui-overlay/src/App.tsx`と既存component/configを、薄い
  `ProductionOverlay` componentから直接再利用した。
- 既定URL `/` をproduction entryに変更した。
- `?probe=1`、`?lab=1`、`?phase1Review=1` は従来の開発画面を維持する。
- z-orderを `scene background: 0` → `Three.js canvas: 1` → `production overlay: 20` に固定した。
- React / ReactDOMはVite側でdedupeし、同一DOM・単一React runtimeで合成した。

### Production表示制御

production entryでは次を非表示にした。

- Motion Probe / Motion Lab panel
- statusbarなど壁紙側の開発ステータス
- Debug grid / `DEBUG MODE ON`
- Emergency Reset
- Overlay設定画面のdebug/test-data controls
- 未配線のAI入力・送信ボタン
- 未配線のSpotify再生操作

DockのWEATHER / MUSIC / AI / NEWS / MEMOは実際に各panelを表示切替するため残した。

### live / empty / offline

- Companion `/api/state` が接続済みで0件の場合:
  - News: `NO NEWS ITEMS`
  - Memo: `NO MEMOS`
  - `SOURCE: LIVE`
- Companion未接続:
  - mock news / memo / AI履歴 / Spotify曲を表示しない。
  - `COMPANION: OFFLINE`、`SOURCE: OFFLINE`、各panelの`OFFLINE` badgeを表示する。
- Weather:
  - live取得時だけ実値を表示する。
  - fallback中はmock値を表示せず `WEATHER / OFFLINE` とする。
- ローカルfake APIで「接続済み・news 0件・memo 0件」を実画面検証し、
  mock非表示、empty state、`SOURCE: LIVE`を確認した。

### 1920x1080実画面確認

- `window.innerWidth x innerHeight`: `1920 x 1080`
- root / shell / overlay: `1920 x 1080`
- canvas: 1枚、`1920 x 1080`
- Probe / Debug / Reset: 非表示
- AI input: 0件
- Settings button: 非表示
- News panel toggle: opacity `1 → 0 → 1`
- VRM / props / gaze / expression / SpringBone / current built-in motion: 読み込み維持

### スクリーンショット

- 統合前: `docs/screenshots/release-0.9/before-wallpaper-probe-preview-1280x720.png`
- 統合後preview: `docs/screenshots/release-0.9/after-production-shell-preview-1280x720.png`
- 統合後1920x1080: `docs/screenshots/release-0.9/after-production-shell-1920x1080.png`
- Stage 0 work pose: `docs/screenshots/release-0.9/stage0-work-normal.png`
- Stage 0 sleep pose: `docs/screenshots/release-0.9/stage0-sleep-desk.png`

注: in-app browserの1920x1080 raw captureでは画面右側が重複するcapture artifactが発生した。
DOM計測ではroot / canvas / overlayはいずれも単一の1920x1080であり、比較用previewでは重複しない実レイアウトを確認している。

### Stage 1最終検証

- `01_wallpaper npm run build`: PASS
- `npm run check:dist-assets`: PASS
- `npm run check:props`: PASS
- `02_ui-overlay npm run build`: PASS
- Director tests: 90 PASS
- Motion tests: 54 PASS
- Expression preset tests: 263 PASS
- `git diff --check`: PASS

## 主な変更ファイル

- `01_wallpaper/src/App.tsx`
- `01_wallpaper/src/components/ProductionOverlay.tsx`
- `01_wallpaper/src/index.css`
- `01_wallpaper/vite.config.ts`
- `02_ui-overlay/src/App.tsx`
- `02_ui-overlay/src/components/RightDock.tsx`
- `02_ui-overlay/src/components/panels/AiPanel.tsx`
- `02_ui-overlay/src/components/panels/MemoPanel.tsx`
- `02_ui-overlay/src/components/panels/MusicPanel.tsx`
- `02_ui-overlay/src/components/panels/NewsPanel.tsx`
- `02_ui-overlay/src/styles/base.css`
- `02_ui-overlay/src/styles/overlay.css`

## 残課題（次Stage以降）

1. Motion Directorのproduction通常起動。
2. `/api/kiritan/state` のCompanion実routeとposter配線。
3. sleep姿勢で背面きりたん砲が前景を覆うモデル固有問題。
4. scene背景画像3点の欠損。現在はgradient fallback。
5. VRM再配布禁止のためdistからモデルを除外している。配布時のユーザー配置導線が必要。
6. custom fontはライセンス台帳とpackage方針の確定が必要。
7. 統合後JS bundleは約1.23MB。必要なら後段でcode splitする。

禁止事項のWorkerW、Wallpaper Engine package、Tauri二窓化、WebSocket、新規モーション、
Motion DSL拡張、Spotify OAuth/操作、AI新規実装、複数scene、Unity移行、pushは実施していない。
