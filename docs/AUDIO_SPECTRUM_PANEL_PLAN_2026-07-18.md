# オーディオスペクトラムパネル 実装計画（2026-07-18）

## 1. 目的

PCで再生中の音（Spotify・動画・ゲームなんでも）をLEDグラフィックイコライザ風に可視化する「SPECTRUM」パネルを追加する。Wallpaper Engineが公式提供するオーディオAPIを使うため、追加の通信・権限・API키ーは一切不要。

初回実装はパネル表示、信号処理、BPM推定、同期イベントまで。follow-upで3方式のコンセンサス推定と、既存モーションを差し替えない加算型リズム連動まで接続した。

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
- `recordTempoBeat(state, at)`: 拍間隔の中央値と外れ値除去からBPM候補をリアルタイム推定。近接した二重オンセットは除外する。
- BPM候補が許容誤差内で約5秒継続した場合だけ `locked` とし、無音・曲変更・大きなテンポ変化では解除して再検知する。

サービス `02_ui-overlay/src/services/audioSpectrum.ts`（シングルトン）:

- モジュール評価時に `wallpaperRegisterAudioListener` を1回だけ登録（存在チェック付き）。
- 最新フレーム（Float32Array(128)）と受信シーケンス番号を保持し、`subscribe(cb)` で購読者へ通知。
- 疑似音楽ジェネレータ（`enableMock()` / dev専用）。
- ビート判定結果を保持し、`window` に `kiritan:audio-beat` CustomEventを発火。
- BPM候補と安定時間を `kiritan:audio-rhythm` で通知し、安定ロック時だけ `kiritan:audio-bpm-sync` を1回発火（**今回は発火まで。壁紙側での消費＝モーション連動は次段階**）。
- 実時間で120 BPMを生成する開発用モックを使う。ブラウザのタイマー頻度が30 Hzを下回ってもBPM自体は遅くならない。

## 5. 設定

`audioSpectrumPanel` セクションを新設（既存パネルと同じ三層: overlay `uiSettings.ts` 既定値 / overlay `SettingsPanel` / Companion `TabDisplay`）。

- 表示: `show`（既定 **false**・オプトイン）、`showHeader`、`showBackground`、`backgroundOpacity`、`contentTopGap`
- 形: `barCount`（8〜48、既定24）、`segmentCount`（6〜24、既定14）、`barGap`（既定4px）
- 挙動: `peakHold`（既定ON）、`peakFallSpeed`、`sensitivity`（0.2〜3、既定1）、`decaySpeed`
- モード: `stereoMirror`（既定OFF）、`colorMode`（`mono`/`heat`、既定mono）
- 無音: `standbyText`（既定 "AUDIO STANDBY"）
- BPM: `showBpm`（既定ON）、`bpmMethod`（既定 `consensus`）、`bpmLockSeconds`（既定5秒、3〜12秒）、`bpmOffset`（既定0、-10〜+10の整数。**確定BPMにのみ**加算するユーザー好み補正 — 検知は常に生信号で行い、表示と `kiritan:audio-bpm-sync` の `bpm` に反映。ロック中に変更すると同じロックのまま新しい補正値で即再送信）
- モーション: `rhythmMotionEnabled`（既定ON）、`rhythmMotionStrength`（既定0.35）

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

1. `node tools/test_audio_bands.mjs`: バンド写像の全単射性（64バケット全てがどこかのバンドに属す・低域ほど細かい）、平滑の非対称性、ピーク落下、ビート判定、BPM推定、5秒安定ロック、ジッター耐性、停止時解除、テンポ変更時の再検知をテスト。
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

## 9. BPM同期イベント契約（実装済み）

- 検知中: パネル左に `BPM 121`、右に `DETECTING 80%` のようにリアルタイム表示。
- 安定後: `KIRITAN SYNC` へ切り替え、`kiritan:audio-bpm-sync` を発火。
- `kiritan:audio-bpm-sync.detail`: `bpm`（= `rawBpm` + `bpmOffset`、キャラクターが使う最終テンポ）, `rawBpm`, `bpmOffset`, `detectedBpm`, `confidence`, `stableForMs`, `lockedAt`, `source`, `method`, `support`, `contributors`。
- ロック中の表示は補正後BPMで、補正が非0のときは `BPM 123 (+3)` のように内訳を併記。`bpmOffset` の変更はアナライザとロックを保持したまま `lockedAt` 据え置きで再送信される（壁紙側は `bpm` 差分±6超で開幕フィギュアを再選択、以下は位相アンカー更新のみ）。
- `kiritan:audio-beat.detail`: `energy`, `at`, `source`, `detectedBpm`, `lockedBpm`, `method`。
- 無音または大きなテンポ変更でロックは解除される。再ロック時は同じBPMでも新しい同期イベントを発火する。
- 推定方式は `consensus` / `low-band` / `spectral-flux` / `autocorrelation` から設定で選べる。コンセンサスは倍・半分補正後に2方式以上が一致した時だけ候補を出す。

## 10. キリタン連動（follow-upで実装済み）

1. `kiritan:audio-bpm-sync` で同期セッションを開始し、`kiritan:audio-beat` でローカル位相を補正する。
2. `RhythmMotionController` はクリップを選択・交換せず、VrmViewerのNormalizedBone最終合成段に首・頭・胸・肩の微小回転を加算する。
3. 加算値は毎フレーム絶対計算するためドリフトしない。Director、DSL/VRMA、クロスフェード、手の接地、propイベントが引き続き主系統となる。
4. `sleep_desk` / `away_room` では自動的にフェードアウトする。`video_relax` は少し強め、作業中は控えめにする。
5. ロック解除時は即座に新規オフセット生成を止める。設定のON/OFF・強度変更はクリップ再起動を伴わない。

## 10.5 音楽ノリノリモード（music_listen、2026-07-18実装）

設計表の未実装モード `music_listen` を「音楽ノリノリ」として実装。Companionの固定モード選択からのみ入る（自動ローテーション対象外 — 音楽が鳴っていない時に勝手に入らないため）。

- **待機ループ `loop_music_listen`**: sit_pc_neutral + 右腕は `loop_work_normal` のタイピング姿勢の静止版（右手首は既存 keyboard ピンで接地維持、打鍵バーストなし）。左手は新規手形状 `ear_cup` で左耳の横にかざす（腕オイラーはライブランタイムFKソルバで校正: upper [1.062,0.391,0.782] / lower [0.634,-2.695,0.452] / hand [-1.149,0.393,0.25]、手首は耳横 (0.135,0.972,0.008)、掌は頭向き14°以内）。
- **リズムフィギュア**（`RhythmMotionController` 内、全てビート位相駆動 = BPM変更に即追従）:
  - 横揺れ `sway`: 112 BPM以下限定、2拍1周期の正弦で spine/chest ロール＋頭は軽く逆位相。80→112 BPMで振幅を35%テーパー。
  - 指トントン `fingertap`: 毎拍（150 BPM超は2拍に1回）、掌の持ち上げ（rightHand +x）＋右指4本の伸展（右手はカール=−zなので+zが持ち上げ）。打点は拍頭に着地する打楽器型エンベロープ。
  - フィギュアは32拍（8小節）ごとに交代、1.4秒クロスフェード。再ロックでテンポが6 BPM超変わると開幕フィギュアを選び直す。
  - グルーヴ中は `fun` モーフを0.38まで漸増（微笑み）。ロック解除で全て減衰し待機ループへ。
- 加算はピンIK前に適用されるため、横揺れ中も右手首は接地したまま体だけが揺れる（実測ドリフト2.8mm）。
- 実測（ライブランタイム）: 横揺れ周期1204ms@100BPM（理論1200）、タップ周期465ms@128BPM（理論469）、指先は上方向に12.9mm持ち上がりキー面貫通なし、モード切替（通常作業→ノリノリ）境界の手首ジャンプ最大2.8mm/フレーム、指先と髪のクリアランス≥29.7mm、アンロック後残留0.0mm。

## 11. 追加検証結果

- 数値テスト: spectrum 49 checks、main BPM＋motion 37 checks（リズムフィギュア20含む）、比較ラボ21 checks PASS。
- Wallpaper / Overlay / Companion production build: PASS。
- devモック実測: 約120 BPMを `BPM 121` として検知し、`DETECTING` 進捗後に `KIRITAN SYNC` へ遷移。
- 既存motion 62 checks（loop_music_listen含む）、Director 91 checks、Companion Rust tests 37件 PASS。
