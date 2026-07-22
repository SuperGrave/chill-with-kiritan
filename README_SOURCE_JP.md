# Chill with Kiritan 制作版ガイド

この制作版は、機能を変更したい方、UIやモーションを試したい方、Pull Requestを作りたい方向けのソース一式です。

## 制作版に含まれないもの

- `kiritan.vrm` および `.vrma` ファイル
- APIキー、Spotify Client Secret / Refresh Token
- Companionが生成するAPIトークン
- `%APPDATA%\tohoku-companion` の個人設定、メモ、ニュース原稿、取得済み歌詞キャッシュ
- `node_modules`、`dist`、Rust `target`、インストーラーなどの生成物

値をソースへ直接書き込まず、Companionの設定画面またはローカル設定を利用してください。秘密情報、モデル、個人データをIssueやPull Requestへ添付しないでください。

## 必要な環境

- Windows 10 / 11
- Node.js + npm
- Rust toolchain（stable）
- TauriのWindows向けビルド要件（Microsoft C++ Build Tools / WebView2）
- 壁紙として利用する場合はWallpaper Engine

## 開発プレビュー

リポジトリ直下で次を実行します。

```bat
Run_All.bat
```

Companionと統合壁紙を起動します。UI単体も含めてすべて起動する場合は `Run_Dev_All.bat` を使います。

個別に起動する場合:

```powershell
cd 01_wallpaper
npm install
npm run dev

cd ..\02_ui-overlay
npm install
npm run dev

cd ..\03_companion
npm install
npm run tauri dev
```

3Dキャラクターをローカルで確認する場合は、自分で正規に入手したモデルを `01_wallpaper/public/models/kiritan.vrm` に置きます。このファイルはGitに追加されません。

## ビルドと検査

```powershell
cd 01_wallpaper
npm run build
npm run check:dist-assets

cd ..\02_ui-overlay
npm run build

cd ..\03_companion
npm run build
cd src-tauri
cargo test
cargo fmt --check
```

v0.9.2の配布セットを再生成する場合:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_release.ps1 -Version 0.9.2
```

出力先はGit管理外の `release/v0.9.2/` です。共有用パッケージにVRM/VRMAが入っていないことを必ず確認してください。

モデル・キー・個人データを含まない制作版zipを作る場合:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_source.ps1 -Version 0.9.2
```

## 変更箇所の目安

| やりたいこと | 主な場所 |
|---|---|
| 壁紙、3D、背景、モーション | `01_wallpaper/src/` |
| BPM方式の比較ラボ | `04_bpm-lab/`（ルートの `Run_BPM_Lab.bat` で起動） |
| 情報パネルの見た目 | `02_ui-overlay/src/` および統合先 |
| Companionの画面 | `03_companion/src/` |
| localhost API、設定保存、外部サービス | `03_companion/src-tauri/src/` |

作業前に関連する各フォルダのREADMEと `docs/README.md` も確認してください。

## Issue / Pull Request

- 変更はできるだけ1テーマに絞ってください。
- 変更理由、利用者への影響、確認方法を記載してください。
- ビルドやテストを実行できなかった場合は、その理由を記載してください。
- モデル、認証情報、個人用データはコミットしないでください。

現時点ではリポジトリ全体を一括許諾するオープンソースライセンスを明示していません。公開・再配布を伴う利用は、各素材・キャラクター・依存物の条件を確認し、必要に応じてリポジトリ所有者へ相談してください。
