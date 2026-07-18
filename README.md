# Chill with Kiritan

東北きりたんの3Dモデル、情報パネル、音楽・天気・ニュース連携を組み合わせた、Windows / Wallpaper Engine向けのデスクトップ壁紙プロジェクトです。

現在公開している動作確認済みセットは **v0.8.8** です。

## どちらを使いますか？

### そのまま使いたい方

[v0.8.8 Release](https://github.com/SuperGrave/chill-with-kiritan/releases/tag/v0.8.8) から、用途に合うファイルを入手してください。

- `Chill-with-Kiritan-v0.8.8-release.zip`: Wallpaper Engine用データ、Companion、説明書の全部入り
- `Chill-with-Kiritan-WallpaperEngine-v0.8.8.zip`: Wallpaper Engine用データのみ
- `Tohoku Companion_0.8.8_x64-setup.exe`: Companionインストーラー
- `tohoku-companion.exe`: Companionポータブル版

導入手順は [README_DISTRIBUTION_JP.md](README_DISTRIBUTION_JP.md) を参照してください。

### 機能を改造・開発したい方

このリポジトリの `main`、またはv0.8.8 Releaseの `Chill-with-Kiritan-v0.8.8-source.zip` が制作版です。コンパイル済みアプリ、再配布できないVRM/VRMA、APIキー、Spotify認証情報、個人設定、個人用原稿は含みません。

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
| `docs/` | 利用・設計・検証ドキュメント |
| `tools/` | ビルド、検査、リリース作成用スクリプト |

## バージョンとサポート範囲

- 公開配布版: v0.8.8
- 制作版: `main`（変更途中の場合があります）
- 対象OS: Windows
- Wallpaper Engineは別途必要です

不具合報告では、使用したファイル名、Windows / Wallpaper Engineのバージョン、再現手順を添えてください。APIキーや認証トークン、モデル本体は添付しないでください。

## 権利と再配布

このリポジトリには、出典や条件が異なる素材・依存ライブラリに関する記述があります。コードや素材を再配布・公開する前に、各ファイルと [docs/model-audit/VRM_MODEL_AUDIT_flasco_kiritan.md](docs/model-audit/VRM_MODEL_AUDIT_flasco_kiritan.md) の条件を確認してください。東北ずん子・ずんだもんプロジェクトのキャラクター利用については、公式ガイドラインにも従ってください。
