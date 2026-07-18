# オーディオスペクトラムパネル 実装計画（2026-07-18）

## 1. 目的

PCで再生中の音（Spotify・動画・ゲームなんでも）をLEDグラフィックイコライザ風に可視化する「SPECTRUM」パネルを追加する。Wallpaper Engineが公式提供するオーディオAPIを使うため、追加の通信・権限・API키ーは一切不要。

今回の対象はパネル表示と信号処理の土台まで。**キリタンのリズム連動（ビートに合わせた首ノッド等のモーション）は次段階**とし、今回はその入口となるビート情報の算出とイベント発火フックだけを仕込む。

## 2. データ源: Wallpaper Engine Audio API

- `window.wallpaperRegisterAudioListener(callback)` に関数を渡すと、再生中音声の周波数データが**毎秒約30回**届く（[公式ドキュメント](https://docs.wallpaperengine.io/en/web/audio/visualizer.html)）。
- 配列は**固定長128**: `[0..63]`=左チャンネル、`[64..127]`=右チャンネル。各チャンネル内は低音→高音の64バケット。
- 値はおおむね `0.00〜1.00`、稀に1.0超のスパイクがあるため `Math.min(v, 1)` でキャップする。
- **`project.json` に `"supportsaudioprocessing": true` が必要**。本リポジトリのproject.jsonは `tools/package_wallpaper_engine.ps1` が生成するため、スクリプト側に明示的に追加する（WEの自動検出に依存しない）。
- 登録タイミングは `window.onload` 内を避ける（公式の注意）。バンドル評価時（モジュールトップレベル）に登録する。
- オーバーレイは `01_wallpaper/src/components/ProductionOverlay.tsx` 経由で壁紙と同一ページにバンドルされるため、オーバーレイのコードから直接このAPIに触れる。

### 開発時フォールバック

WE外（devサーバ・スタンドアロンプレビュー）ではAPIが存在しない。`productionMode=false` のときだけ、疑似音楽ジェネレータ（120BPMのビート＋中域のゆらぎ＋ノイズ）でバーを動かし、見た目のQAをWEなしで行えるようにする。productionでAPIから一定時間データが来ない場合は減光した `AUDIO STANDBY` 表示。

## 3. 画面仕様

LEDグラフィックイコライザ（電光掲示板と同系統の意匠）。

1. バー本数は既定24本（設定8〜48）。64バケットを対数風グルーピングで割り当てる（低域は細かく、高域はまとめる）。
2. 各バーは離散セグメントのLED（既定14段）。点灯数がレベルを表す。
3. **ピークホールド**: 各バーの最高到達点にドットが残り、ゆっくり落下する（実機グライコの挙動）。
4. 表示モード: モノ合成（L+R平均、既定）とステレオミラー（中央から左右へL/R対称）。
5. 色: 既定はオーバーレイ標準の白系LED＋ピークドットは補足色（`#b8dcff`）。オプションで下=白→上=暖色のヒートグラデーション。
6. 無音（全バケット≈0が数秒継続）で全体を減光し `AUDIO STANDBY` を小さく表示。
7. 描画は `<canvas>`（devicePixelRatio対応）＋rAFループ。Reactの再レンダーとは独立させ、毎フレームの状態はcanvasにのみ書く（個人ニュースティッカーと同じ思想）。

## 4. 信号処理

すべて純関数として `02_ui-overlay/src/lib/spectrumMath.ts` に置き、Nodeテスト可能にする。

- `capFrame(raw)`: 1.0キャップ。
- `mixToMono(raw128)`: L/R平均 → 64バケット。
- `buildBandMap(barCount)` / `groupBands(mono64, map)`: 対数風に64→N本へ集約（各バンドは担当バケットの最大値。低域の解像度を優先）。
- `smoothBands(prev, target, attack, decay)`: 立ち上がりは速く（attack）、減衰はゆっくり（decay）の非対称平滑。
- `updatePeaks(peaks, bands, fallPerFrame)`: ピークホールドの落下。
- `computeBeat(raw128, state)`: 低域バケット（0〜3, L+R）のエネルギーと移動平均との比からオンセット（ビート）判定。次段階のキリタン連動用。

サービス `02_ui-overlay/src/services/audioSpectrum.ts`（シングルトン）:

- モジュール評価時に `wallpaperRegisterAudioListener` を1回だけ登録（存在チェック付き）。
- 最新フレーム（Float32Array(128)）と受信シーケンス番号を保持し、`subscribe(cb)` で購読者へ通知。
- 疑似音楽ジェネレータ（`enableMock()` / dev専用）。
- ビート判定結果を保持し、`window` に `kiritan:audio-beat` CustomEventを発火（**今回は発火まで。壁紙側での消費＝モーション連動は次段階**）。

## 5. 設定

`audioSpectrumPanel` セクションを新設（既存パネルと同じ三層: overlay `uiSettings.ts` 既定値 / overlay `SettingsPanel` / Companion `TabDisplay`）。

- 表示: `show`（既定 **false**・オプトイン）、`showHeader`、`showBackground`、`backgroundOpacity`、`contentTopGap`
- 形: `barCount`（8〜48、既定24）、`segmentCount`（6〜24、既定14）、`barGap`（既定4px）
- 挙動: `peakHold`（既定ON）、`peakFallSpeed`、`sensitivity`（0.2〜3、既定1）、`decaySpeed`
- モード: `stereoMirror`（既定OFF）、`colorMode`（`mono`/`heat`、既定mono）
- 無音: `standbyText`（既定 "AUDIO STANDBY"）

レイアウトは `layout.ts` に `audioSpectrumPanel`（既定 x8 / y696 / w500 / h200 — タイマー上の左カラム空きへ）。パネルID `SPECTRUM` を `App.tsx` / `DetailPanel` のトグルに追加。

Companion側RustはUI設定をopaque JSONとして扱うため（models.rs方針）、**Rust変更は不要**。既存プリセット（built_in_ui_presets.json）に無いセクションはoverlay側既定値へフォールバックする。

## 6. 実装構成

- `02_ui-overlay/src/lib/spectrumMath.ts` — 純関数（バンド写像・平滑・ピーク・ビート）
- `02_ui-overlay/src/services/audioSpectrum.ts` — WEリスナー登録・購読・モック・ビートイベント
- `02_ui-overlay/src/components/panels/AudioSpectrumPanel.tsx` — canvas描画パネル
- `02_ui-overlay/src/config/uiSettings.ts` — `audioSpectrumPanelDefaults`
- `02_ui-overlay/src/config/layout.ts` — 既定配置
- `02_ui-overlay/src/App.tsx`・`components/DetailPanel.tsx` — PanelId `SPECTRUM`、FloatingPanel配線、トグル
- `02_ui-overlay/src/components/panels/SettingsPanel.tsx` — 設定アコーディオン
- `03_companion/src/tabs/TabDisplay.tsx` — Companion表示設定セクション
- `tools/package_wallpaper_engine.ps1` — project.jsonへ `supportsaudioprocessing: true`
- `tools/test_audio_bands.mjs` — 純関数のNodeテスト（test_director方式: tscでCJSへコンパイルしてrequire）

## 7. 検証

1. `node tools/test_audio_bands.mjs`: バンド写像の全単射性（64バケット全てがどこかのバンドに属す・低域ほど細かい）、平滑の非対称性、ピーク落下、ビート判定の合成波形テスト。
2. devサーバ（ui-overlay:5188）: モックで描画確認（バーの動き・ピークドット・STANDBY遷移・設定反映）。
3. WEスタブ検証: devページに `window.wallpaperRegisterAudioListener` のスタブを注入し、合成フレームを30Hzで供給 → **本番と同じ受信経路**が動くことを確認。
4. `npm run build`（01/02）+ tsc: PASS。WEパッケージ生成でproject.jsonにフラグが入ることを確認。
5. Wallpaper Engine実機での最終確認（音源再生→バー反応、無音→STANDBY）はリリース前にマスターが目視。

## 8. 受け入れ条件

- WE実機で再生中の音に合わせてバーが動く（Spotify以外の音源でも）。
- 無音時はSTANDBYの減光表示になり、音が戻ると復帰する。
- パネルの表示/非表示・位置・サイズ・バー本数・感度等をCompanion/Overlay両方から調整できる。
- 既存パネルの表示・設定・レイアウトに影響がない。
- 01/02のproduction buildとテストスクリプトが通る。
- 共有用WEパッケージにVRM等の混入がない（既存ゲート維持）。

## 9. 次段階（キリタン連動 — 今回は対象外）

1. `kiritan:audio-beat` イベントを壁紙側（VrmViewer）で購読し、ビートに同期した首の微小ノッド（音楽鑑賞の前哨）。
2. `music_listen` モード実装時に、ビート強度をアンビエント抽選の重み（ノリの深さ）へ反映。
3. Spotify再生中メタデータ（既存 `/api/ui`）と組み合わせ、「曲が流れている間だけノる」ゲート。
