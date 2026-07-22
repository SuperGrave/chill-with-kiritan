# BPM判定アルゴリズム調査 2026-07-21

## 結論

現在の入力経路を維持するなら、次の本命は単純な「4票目」ではなく、以下を一体化した新しい推定器です。

1. SuperFlux型の多帯域オンセット強度
2. 実際のタイムスタンプへ再サンプリングしたテンポグラム／共振コームフィルタバンク
3. BPMと拍位相を同時に保持する状態空間トラッカー
4. 1 BPMごとの尤度と、半分／倍テンポを別候補として保持するメトリカル選択

この構成を仮称 `pulse-bank` としてBPMラボへ追加し、現行3方式と実音源で比較するのが最も現実的です。現在のコンセンサスは3方式を等価な独立票として扱っていますが、実際にはスペクトルフラックスの出力を自己相関にも渡しているため、同じ誤検出を複数票として数える場合があります。

## 入力上の制約

Wallpaper EngineのWeb壁紙APIが渡すのは、左右それぞれ64帯域、合計128個の音量値で、コールバックは「およそ毎秒30回」です。生PCM、位相、正確なSTFT窓、固定フレームレートは得られません。

- [Wallpaper Engine Audio Visualization](https://docs.wallpaperengine.io/en/web/audio/visualizer.html)

したがって、PCMや100 fpsのメルスペクトログラムを前提に学習されたモデルを、そのまま壁紙内へ移植することはできません。現在の128値だけで動かす軽量DSP経路と、将来Companion側でWindows音声を取得してニューラル推定する経路は分けて考える必要があります。

## 現行実装が弱くなるポイント

### 1. 3票が独立していない

- `low-band`: 最低4帯域の立ち上がりを離散ビートへ変換。
- `spectral-flux`: 全64帯域の正方向差分を離散ビートへ変換。
- `autocorrelation`: `spectral-flux`で作った強度列を自己相関。

スペクトルフラックスの誤反応は、フラックス票と自己相関票の両方へ現れます。多数決の票数より、各BPM候補の連続的な尤度を統合する方が適切です。

### 2. 30 fps固定として自己相関している

コードでは1秒30サンプルとしてラグをBPMへ変換していますが、API仕様は「roughly 30 times per second」です。バックグラウンド負荷やFPS制限で実間隔が変わると、配列上の周期と実時間の周期がずれます。`performance.now()`を使って一定間隔へ再サンプリングしてから周期解析すべきです。

### 3. スペクトルフラックスの閾値が不安定

現行の分散計算は二重に履歴長で割っており、履歴が長いほど標準偏差が過小になります。また「正の値であればオンセット」としており、局所最大ピークであることを要求していません。結果として細かな楽器音や残響を拍として拾いやすい構造です。

### 4. 半分／倍テンポの選択がヒューリスティック

現行コンセンサスは各候補へ0.5倍・1倍・2倍を展開し、70〜180 BPMと直前値を少し優遇します。合議しやすい一方で、曲が持つ拍階層のどれを人間がBPMとして感じるかは直接推定していません。

## 候補方式

### A. SuperFlux型オンセット強度 — 最初に導入

SuperFluxは、直前フレームの同じ周波数だけでなく近隣周波数の最大値と比較します。ビブラート等によるスペクトル移動を新しい音の開始と誤認しにくく、論文では誤検出を大幅に減らしつつオンライン処理可能とされています。

- [Böck & Widmer, Maximum Filter Vibrato Suppression for Onset Detection](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf)
- [Essentia SuperFluxExtractor](https://essentia.upf.edu/reference/std_SuperFluxExtractor.html)

現在の64帯域でも、対数圧縮、周波数方向最大フィルタ、過去フレームとの差分、適応閾値、局所ピーク選択を近似実装できます。低域・中域・高域で別々の強度列を作ると、キックが弱い曲にも対応しやすくなります。

### B. テンポグラム／共振コームフィルタバンク — 本命

1個の離散ビート列ではなく、連続したオンセット強度を40〜240 BPMの周期フィルタへ同時に通し、各BPMの共振強度を比較します。RNNのビート活性をコームフィルタへ渡す研究では、離散ビートへ早期変換すると誤検出の影響が大きいこと、連続値の方が周期推定に有利であることが示されています。

- [Böck, Krebs & Widmer, Accurate Tempo Estimation based on RNNs and Resonating Comb Filters](https://ismir2015.uma.es/articles/196_Paper.pdf)
- [Essentia BpmHistogram](https://essentia.upf.edu/reference/streaming_BpmHistogram.html)

ニューラル部分を使わなくても、SuperFlux型の多帯域強度を入力にすれば、現在の単純自己相関より候補分布を安定して保持できます。1 BPM刻みのモーションとも自然に接続できます。

### C. 動的計画法による拍列選択 — 位相安定に有効

librosaの標準ビートトラッカーは、オンセット強度、自己相関によるテンポ推定、推定テンポに整合するピーク列の動的計画法、という3段階です。

- [librosa.beat.beat_track](https://librosa.org/doc/latest/generated/librosa.beat.beat_track.html)
- [Ellis, Beat Tracking by Dynamic Programming](https://www.labrosa.org/~dpwe/pubs/Ellis06-beattrack.pdf)

これはBPM数値だけでなく「次の拍がいつか」を安定させるのに向きます。今回のモーションは固定速度化したため、推定器からはBPMと初期位相だけを渡し、その後は頻繁に補正しない設計が合います。

### D. HMM／DBN／粒子フィルタ — BPMの飛び防止に有効

madmomはRNNビート活性とDBNを組み合わせ、BPMと拍位置の遷移確率を状態として追跡します。BeatNetはオンライン用CRNNと粒子フィルタを組み合わせています。

- [madmom beat tracking implementation](https://github.com/CPJKU/madmom/blob/main/madmom/features/beats.py)
- [BeatNet paper](https://arxiv.org/abs/2108.03576)
- [BeatNet official implementation](https://github.com/mjhydri/BeatNet)

壁紙内ではニューラル前段をそのまま使えませんが、「BPMは隣接値へは移りやすく、突然の半分／倍への移動は十分な証拠が必要」という状態遷移部分は軽量に移植できます。

### E. TempoCNN／Essentia RhythmExtractor2013 — CompanionでPCMを取る場合

TempoCNNは約11.9秒の音声からテンポを直接分類し、半分／倍テンポの混同改善を狙った方式です。EssentiaのTempoCNN実装は約6秒ごとの局所推定と確率を返し、一定テンポでは多数決集約を推奨しています。RhythmExtractor2013の`multifeature`は複数のビートトラッカーの合意を利用します。

- [Schreiber & Müller, A Single-Step Approach to Musical Tempo Estimation](https://www.tagtraum.com/download/2018_schreiber_tempo_cnn.pdf)
- [Essentia TempoCNN](https://essentia.upf.edu/reference/std_TempoCNN.html)
- [Essentia RhythmExtractor2013 example](https://essentia.upf.edu/essentia_python_examples.html)

精度の上限は高い一方、PCM取得、モデル同梱、推論ランタイム、CPU使用率、ライセンス確認が必要です。現行Wallpaper Engine入力だけを使う最初の改善には向きません。

## 推奨実装順

### Phase 1: 現行経路の基礎修正

1. フラックス分散計算を修正。
2. 適応閾値に中央値／MADを使い、局所ピークだけをオンセットとして採用。
3. `performance.now()`基準で30 Hzの等間隔系列へ再サンプリング。
4. 低・中・高域別の連続オンセット強度を作る。

### Phase 2: `pulse-bank` 推定器

1. 40〜240 BPMを1 BPM刻みで評価するコームフィルタ／テンポグラム。
2. 直前BPMからの遷移コストを持つViterbiまたは軽量HMM。
3. BPM、2倍、半分を消去せず、個別確率として保持。
4. 一定時間トップ候補が優位になった時だけロック。

### Phase 3: 実曲評価

既存のBPMラボへ`pulse-bank`を追加し、正解BPMを入力して曲ごとに記録します。「正確なBPM」と「半分／倍も許容」の成績を分けます。テンポ推定の評価研究でも、使用目的に合ったデータと指標を明示する重要性が指摘されています。

- [Music Tempo Estimation: Are We Done Yet?](https://transactions.ismir.net/articles/10.5334/tismir.43)

最低限、苦手だった曲、キックが弱い曲、倍テンポになりやすい曲、高速曲、歌や弦の持続音が多い曲を各数曲ずつ残し、方式追加のたびに回帰試験します。

## 採用判断

| 方式 | 現行128値で実装 | リアルタイム | 半分／倍対策 | 推奨 |
|---|---:|---:|---:|---:|
| SuperFlux近似 | 可能 | 可能 | 間接的 | Phase 1 |
| 多帯域コーム／テンポグラム | 可能 | 可能 | 候補を保持可能 | 本命 |
| 動的計画法 | 可能 | 遅延を調整すれば可能 | 時系列整合で改善 | 本命補助 |
| HMM／粒子フィルタ | 可能 | 可能 | 強い | Phase 2 |
| TempoCNN／RNN／BeatNet | PCM経路が必要 | モデル次第 | 強い | 将来のCompanion経路 |

最初の実装目標は、`SuperFlux近似 + 多帯域コームフィルタ + BPM状態遷移`です。これは現行入力で実現でき、弱いキック、細かな音の誤検出、コールバック間隔の揺れ、BPMの突然の飛びをまとめて扱えます。
