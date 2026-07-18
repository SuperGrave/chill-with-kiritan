# v0.8.8 Release Notes

v0.8.8は、Codex側の自動起動・個人用ニュース改善と、Claude側の卓上アンビエントモーション5本を含む公開v0.8.7を土台に、オーディオスペクトラム表示とBPM同期イベントを追加した統合リリースです。

## v0.8.7から継承する変更

- 自動起動の状態確認、タスク登録、Run keyフォールバックをコンソール非表示で実行。
- 設定保存後の自動起動登録の重複実行を解消し、UAC確認は管理者登録を明示した場合だけ表示。
- 個人用ニュースの通常行を一つの長いBLOCKへ連結し、電光掲示板のように一列で最後まで表示。
- `[Break]`、`[Paragraph]`、`[段落]`、`---`、`[Topic: ...]`、`(Wait: ...)` を明示的な表示境界として使用可能。
- rAF駆動の等速スクロールにより、各BLOCKを途中で切らず画面外まで完走してから次へ移行。
- `amb_work_wrist_flex`、`amb_work_window_gaze`、`amb_work_window_gaze_mirror`、`amb_vid_drowse`、`amb_slp_mumble` の卓上アンビエントモーション5本を追加。

## SPECTRUMパネル

- Wallpaper Engineの128バケット音声APIを使い、PCで再生中の音をLEDグラフィックイコライザ風に表示。
- バー数、セグメント数、間隔、感度、減衰、ピークホールド、ミラー配置、モノ／ヒート色をOverlayとCompanionから調整可能。
- 無音・音声入力待機中は `AUDIO STANDBY` へ自動移行。
- BPMをリアルタイム推定し、既定5秒の安定判定後に `KIRITAN SYNC` を表示。
- `kiritan:audio-beat`、`kiritan:audio-rhythm`、`kiritan:audio-bpm-sync` イベントを追加。今回のリリースではモーションへ直接適用せず、後続実装が安全に利用できるイベント境界までを提供。
- Wallpaper Engine用 `project.json` に `supportsaudioprocessing: true` を明示。

## 統合について

公開v0.8.7のPR #5は、Codex側の自動起動・個人用ニュース修正とClaude側の5モーションを同じツリーへまとめたものです。v0.8.8はその公開コミットを直接の親としているため、どちらかの変更を上書きする再マージや重複チェリーピックは行っていません。

## 配布物

- `Chill-with-Kiritan-v0.8.8-release.zip`
- `Chill-with-Kiritan-v0.8.8-source.zip`
- `Chill-with-Kiritan-WallpaperEngine-v0.8.8.zip`
- `Tohoku Companion_0.8.8_x64-setup.exe`
- `tohoku-companion.exe`

公開配布物にはVRM/VRMA、Spotify認証情報、APIキー、個人ニュース原稿、歌詞キャッシュを含めません。
