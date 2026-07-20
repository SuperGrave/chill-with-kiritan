# Chill with Kiritan

東北きりたんの3Dモデル、情報パネル、音楽・天気・ニュース連携を組み合わせた、Windows / Wallpaper Engine向けのデスクトップ壁紙プロジェクトです。

現在公開している動作確認済みセットは **v0.9.0** です。

## どちらを使いますか？

### そのまま使いたい方

[v0.9.0 Release](https://github.com/SuperGrave/chill-with-kiritan/releases/tag/v0.9.0) から、用途に合うファイルを入手してください。

- `Chill-with-Kiritan-v0.9.0-release.zip`: Wallpaper Engine用データ、Companion、説明書の全部入り
- `Chill-with-Kiritan-WallpaperEngine-v0.9.0.zip`: Wallpaper Engine用データのみ
- `Tohoku Companion_0.9.0_x64-setup.exe`: Companionインストーラー
- `tohoku-companion.exe`: Companionポータブル版

導入手順は [README_DISTRIBUTION_JP.md](README_DISTRIBUTION_JP.md) を参照してください。

### 機能を改造・開発したい方

このリポジトリの `main`、またはv0.9.0 Releaseの `Chill-with-Kiritan-v0.9.0-source.zip` が制作版です。コンパイル済みアプリ、再配布できないVRM/VRMA、APIキー、Spotify認証情報、個人設定、個人用原稿は含みません。

セットアップ、構成、ビルド方法は [README_SOURCE_JP.md](README_SOURCE_JP.md) にまとめています。IssueやPull Requestも歓迎します。

## 重要: 3Dモデルは同梱していません

公開物には、モデルの利用条件により `kiritan.vrm` を含めていません。利用者自身が正規に入手したモデルを、Wallpaper Engineへ取り込んだフォルダの次の場所へ置いてください。

```text
models/kiritan.vrm
```

モデル入りのフォルダやzipは再配布しないでください。VRMAモーションも公開物には含まれません。

## 構成

| パス | 内容 |
|---|---|
| `01_wallpaper/` | React + Vite + TypeScript製の壁紙本体。3D表示と統合UI |
| `02_ui-overlay/` | オーバーレイUIの単体開発・確認用画面 |
| `03_companion/` | Tauri製Companionとlocalhost API |
| `04_bpm-lab/` | 4方式のBPM推定を同じ音源で比較する独立ラボ |
| `docs/` | 利用・設計・検証ドキュメント |
| `tools/` | ビルド、検査、リリース作成用スクリプト |

制作版 `main` のスペクトラム機能は、低域ビート間隔・スペクトルフラックス・自己相関のコンセンサスBPM推定に対応しています。3〜12秒の安定待ち、判定方式、確定BPMへのユーザー補正（±10）、きりたんの加算型リズムモーションはCompanionのスペクトラム設定から変更できます。さらに固定モード「音楽ノリノリ」を選ぶと、きりたんが左手を耳にかざして待機し、BPM確定と同時にテンポへ位相同期した横揺れ（低テンポ時）と右手の指トントン（毎拍、高速時は半拍）を数小節ごとに切り替えながらリズムを刻みます。

## バージョンとサポート範囲

- 公開配布版: v0.9.0
- 制作版: `main`（変更途中の場合があります）
- 対象OS: Windows
- Wallpaper Engineは別途必要です

不具合報告では、使用したファイル名、Windows / Wallpaper Engineのバージョン、再現手順を添えてください。APIキーや認証トークン、モデル本体は添付しないでください。

## 権利と再配布

このリポジトリには、出典や条件が異なる素材・依存ライブラリに関する記述があります。コードや素材を再配布・公開する前に、各ファイルと [docs/model-audit/VRM_MODEL_AUDIT_flasco_kiritan.md](docs/model-audit/VRM_MODEL_AUDIT_flasco_kiritan.md) の条件を確認してください。東北ずん子・ずんだもんプロジェクトのキャラクター利用については、公式ガイドラインにも従ってください。
