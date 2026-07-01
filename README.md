# Chill with Kiritan

東北きりたんの3Dモデルが、おしゃれなUIと一緒にデスクトップ背景として動く壁紙プロジェクト。
開発は **3つの方向**に分かれており、それぞれ独立したフォルダ（`01_` / `02_` / `03_`）で進める。

## 3つの開発方向

| # | フォルダ | 役割 | 種別 | 起動 |
|---|----------|------|------|------|
| ① | `01_wallpaper/`  | 壁紙本体。VRMキャラ表示＋モーション＋背景/小道具シーン | React + Vite + TS | `Run_Wallpaper.bat` |
| ② | `02_ui-overlay/` | 壁紙に重ねるUI（時計・天気・右ドック・各パネル）。**見た目のみ** | React + Vite + TS | `Run_UI.bat` |
| ③ | `03_companion/`  | 操作用の小型ウィンドウ。UIへ情報送信・キーボード入力・Spotify連携など | Tauri | `Run_Companion.bat` |

①〜③をまとめて起動: `Run_All.bat`（別ウィンドウで3つ立ち上げ。③はTauriのため初回はRustコンパイルあり）

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
