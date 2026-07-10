# Chill with Kiritan

東北きりたんの3Dモデルが、おしゃれなUIと一緒にデスクトップ背景として動く壁紙プロジェクト。
開発は **3つの方向**に分かれているが、最新版の壁紙プレビューは
`01_wallpaper` の中に `02_ui-overlay` を埋め込んだ統合画面で見る。

## 現在の本流

現在の開発本流は **v0.8.3**。以前 `v4` と呼んでいた積み上げを
`v0.8.0` として扱い、以後の小さな更新は `v0.8.1`, `v0.8.2`, `v0.8.3` のように
v0.8 系で進める。`v2` / `v3` など過去の版名はレガシー版としてそのまま残す。

Git上の現役開発ラインは `main`。節目は `v0.8.0`, `v0.8.1`, `v0.8.3` のようなtagで残し、
閉じた過去ブランチは `archive/closed/` にまとめる。詳しくは
`docs/GIT_TREE_POLICY.md`。

Companion の表示バージョンは `03_companion/src-tauri/Cargo.toml` の
`package.version` を `/api/health` 経由で表示する。npm/Tauri/Cargo の
バージョンは同じ値にそろえる。

## 最新版を見る

通常確認は `Run_All.bat`。

これで以下の2つだけを起動する。

- `03_companion`: Tauri Companion + localhost API
- `01_wallpaper`: VRM / 部屋 / モーション / **埋め込み済みUI overlay**

壁紙は `01_wallpaper` のVite URLをクエリなしで開く。

```text
http://localhost:5173/
```

この画面が「完成版に一番近い統合プレビュー」。画面上の `COMPANION: LIVE / OFFLINE`
でCompanion接続を確認できる。

`Run_UI.bat` は `02_ui-overlay` 単体の開発プレビュー専用で、VRMモデルとは重ならない。
統合済みの壁紙確認には使わない。

## 3つの開発方向

| # | フォルダ | 役割 | 種別 | 起動 |
|---|----------|------|------|------|
| ① | `01_wallpaper/`  | 壁紙本体。VRMキャラ表示＋モーション＋背景/小道具シーン＋統合済みUI overlay | React + Vite + TS | `Run_Wallpaper.bat`（`5173`） |
| ② | `02_ui-overlay/` | 壁紙に重ねるUIの単体開発面。**統合版では①に埋め込まれる** | React + Vite + TS | `Run_UI.bat`（`5174`、単体確認用） |
| ③ | `03_companion/`  | 操作用の小型ウィンドウ。UIへ情報送信・キーボード入力・Spotify連携など | Tauri | `Run_Companion.bat` |

統合確認: `Run_All.bat`（①+③だけを起動）。

全開発面をまとめて起動: `Run_Dev_All.bat`（①+②+③を別ウィンドウで起動。②は単体確認用）。

## 実用パッケージ生成

Wallpaper Engine 用のWeb壁紙フォルダ、zip、Companionインストーラをまとめて作る。

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_release.ps1 -Version 0.8.3
```

出力先は `release/v0.8.3/`。このフォルダは生成物なのでGit管理しない。
次の小更新は `-Version 0.8.4` のように指定する。

- `release/v0.8.3/wallpaper-engine/Chill with Kiritan/`: Wallpaper Engineへ取り込むフォルダ
- `release/v0.8.3/Chill-with-Kiritan-WallpaperEngine-v0.8.3.zip`: 共有用zip
- `release/v0.8.3/companion/`: Companionのexe/installer
- `release/v0.8.3/Chill-with-Kiritan-v0.8.3-release.zip`: まとめzip

配布用パッケージには `kiritan.vrm` と `.vrma` を入れない。自分のPCだけで使う場合は、
Wallpaper Engineに取り込んだフォルダへ手元の `kiritan.vrm` を
`models/kiritan.vrm` としてコピーする。

CompanionのSpotify設定・メモ・UIプリセットなどをクリーンに戻す時:

```powershell
powershell -ExecutionPolicy Bypass -File tools/reset_companion_clean_state.ps1
```

## フォルダ構成

| パス | 中身 |
|------|------|
| `01_wallpaper/` `02_ui-overlay/` `03_companion/` | 上記3アプリ。各自 `node_modules` / `package.json` / `docs/` を持つ独立プロジェクト |
| `docs/` | **プロジェクト全体**のドキュメント・索引・命名規則（→ `docs/README.md`） |
| `assets/` | 共有ソース素材。`fonts/`（UI用フォント原本）・`motion-pack/`（VRMAサンプル7本） |
| `tools/` | VRM解析ユーティリティ（`parse_vrm.py` ほか）と生成物 `output/` |
| `Run_*.bat`（リポジトリ直下） | 起動用バッチ。`%~dp0` 基準なのでどこから実行してもOK |
| `_archive/` | 使い終わったもの（インストーラ・展開済みzip・一回限りスクリプト・検証用PNG等）。**削除せず保管** |

## ドキュメントの置き場所
- プロジェクト全体に関わるもの → `docs/`（命名規則は `docs/README.md`）
- 各アプリ固有のもの → そのアプリの `docs/`（完了した古いフェーズ文書は各 `docs/_archive/`）

## ⚠ ライセンス上の注意（最重要）
- 対象モデル **ふらすこ式風東北きりたん**（`01_wallpaper/public/models/kiritan.vrm`）は **再配布禁止**。商用・暴力/性的表現も禁止（ガイドライン: https://zunko.jp/ ）。
- `kiritan.vrm` は**リポジトリ／配布物に同梱不可**。ユーザーが手動配置する前提。
- 詳細監査: `docs/model-audit/VRM_MODEL_AUDIT_flasco_kiritan.md`
