# PCM BPM経路の実用導入判断（2026-07-21）

> **2026-07-22 更新:** 比較結果を受け、本番方式は `PCM BEATROOT` に一本化した。以下の「必要なもの」は今回実装済みで、CompanionがWASAPIループバックを11,025 Hz mono PCMへ変換し、localhostの短いリングバッファ経由でOverlayのWeb Workerへ渡す。旧4方式は比較Labにだけ残す。

## 結論

BPM LabではPCM取得を追加セットアップなしで実現できる。音声ファイル、画面共有音声、マイク、合成音はすべてWeb Audioへ入るため、AudioWorklet方式とBeatRoot方式を同じ入力で比較できるようにした。

Wallpaper Engine本番は公式オーディオリスナーから左右64帯域ずつの値しか受け取れないため、Companion側にWindows WASAPIループバック録音を追加した。PCMは外部へ送信せず、127.0.0.1のCompanion APIから最大2秒ずつOverlayへ渡し、BeatRoot解析はWeb Workerで行う。

採用条件は信頼度70%以上。確定後はリセット世代ごとのテンポ統計を保持し、±3 BPMの近傍値を強化する。離れた値は既定9秒・3回以上続くまで変更候補として保留し、半分／2倍の一時誤認は現在のテンポ族へ戻す。70%未満は表示・モーションへ渡さないが、保持統計自体は消さない。

履歴リセットは、Spotifyの既存「曲終了予測+0.8秒」更新で曲切替を確認した時、設定した定期間隔、設定画面の手動ボタン、解析窓／解析間隔の変更時に発生する。WASAPIのデバイス切断や初期化失敗は2秒後に自動再接続する。

## 今回プレビューへ入れた方式

- `PCM REALTIME`: `realtime-bpm-analyzer` 5.0.15。Apache-2.0、AudioWorklet、依存パッケージなし。解析専用ゲインで小さい入力も補正する。
- `PCM BEATROOT`: `music-tempo` 1.0.3。MIT、ローリング8～14秒窓。FFTと拍仮説追跡はWeb Workerで実行する。

両方式とも波形はブラウザ内だけで処理し、Companion APIや外部サービスへ送らない。

## 本番移植で実装したもの

1. Tauri/RustへWASAPIループバックキャプチャを追加する。
2. 音声デバイス変更、スリープ復帰、無音、DRM保護音声を扱う。
3. PCM処理スレッドから短いi16 PCMチャンクだけを既存ローカルAPIへ公開する。
4. Overlayの本番BPM判定をCompanion PCM + BeatRootへ固定する。
5. 信頼度ゲート、履歴によるブレ抑制、Spotify／定期／手動リセットを設定へ追加する。

Rustの`wasapi` crate 0.23を使用する。実機スモークテストでは既定出力デバイスの初期化とPCMサンプル増加を確認済み。排他モードやDRM保護音声はWASAPI側の制約を受ける。

## 今回同梱しなかったAI方式

- `TempoCNN`: 公式方式は11025 Hz PCMと約6～12秒のパッチを使う。最小TFJSモデル自体は小さいが、公式モデルはCC BY-NC-SA 4.0で、商用利用・派生配布の条件を先に決める必要がある。
- `BeatNet`: リアルタイム追跡に対応するが、公式Windows手順はPython、PyTorch、librosa、madmom、PyAudio等を要求し、現行の単体配布方針と合わない。
- `Essentia.js`: ブラウザでTempoCNNの特徴抽出が可能だが、ライブラリ本体がAGPL-3.0。現行プロジェクトへ無条件に追加しない。

## 参照

- Microsoft: https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- Rust wasapi: https://docs.rs/wasapi/latest/wasapi/
- Realtime BPM Analyzer: https://github.com/dlepaux/realtime-bpm-analyzer
- Music Tempo: https://github.com/killercrush/music-tempo
- TempoCNN: https://essentia.upf.edu/reference/std_TempoCNN.html
- TempoCNN models: https://essentia.upf.edu/models/tempo/tempocnn/
- BeatNet: https://github.com/mjhydri/BeatNet
- Essentia.js: https://github.com/MTG/essentia.js
