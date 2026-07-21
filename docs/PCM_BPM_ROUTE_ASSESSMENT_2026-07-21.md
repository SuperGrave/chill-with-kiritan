# PCM BPM経路の実用導入判断（2026-07-21）

## 結論

BPM LabではPCM取得を追加セットアップなしで実現できる。音声ファイル、画面共有音声、マイク、合成音はすべてWeb Audioへ入るため、AudioWorklet方式とBeatRoot方式を同じ入力で比較できるようにした。

一方、Wallpaper Engine本番は公式オーディオリスナーから左右64帯域ずつの値を受け取る構造で、生PCMは取得できない。PCM方式を本番へ入れるにはCompanion側にWindows WASAPIループバック録音を追加し、推定BPMだけをOverlayへ返す別経路が必要になる。これは実現可能だが「アルゴリズムを1個追加するだけ」ではない。

## 今回プレビューへ入れた方式

- `PCM REALTIME`: `realtime-bpm-analyzer` 5.0.15。Apache-2.0、AudioWorklet、依存パッケージなし。解析専用ゲインで小さい入力も補正する。
- `PCM BEATROOT`: `music-tempo` 1.0.3。MIT、ローリング8～14秒窓。FFTと拍仮説追跡はWeb Workerで実行する。

両方式とも波形はブラウザ内だけで処理し、Companion APIや外部サービスへ送らない。

## 本番移植に必要なもの

1. Tauri/RustへWASAPIループバックキャプチャを追加する。
2. 音声デバイス変更、スリープ復帰、無音、DRM保護音声を扱う。
3. PCM処理スレッドからBPM・信頼度だけを既存ローカルAPIへ公開する。
4. OverlayがWallpaper Engine帯域方式とCompanion PCM方式を選べるようにする。
5. 自動起動時のCPU使用率、複数出力デバイス、排他モードを実機検証する。

Rustの`wasapi` crateはループバック録音を公式機能として提供しており、Windows自体もWASAPI loopbackをサポートする。ただし録音経路の常駐化と障害復旧が必要なので、BPM Labで精度差を確認してから採用方式を1つに絞るのが安全。

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
