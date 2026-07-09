# ドキュメント・ハブ

プロジェクト全体に関わるドキュメントの集約場所と、全体の命名・管理規則。

## 現在の本流

**本流バージョン**: v0.8.1。以前の `v4` を v0.8.0 として扱い、以降は
`v0.8.1`, `v0.8.2` のように v0.8 系で積み上げる。過去の `v2` / `v3`
表記はレガシー版として保持する。

バージョン規則は [MAINLINE_VERSIONING.md](MAINLINE_VERSIONING.md)、Gitツリー運用は
[GIT_TREE_POLICY.md](GIT_TREE_POLICY.md) を正典にする。

## 全体ドキュメント

**完成ルート（最新）**: [COMPLETION_AUDIT_2026-07-01.md](COMPLETION_AUDIT_2026-07-01.md)（現状監査・完成イメージ）→ [COMPLETION_EXECUTION_PLAN_2026-07-01.md](COMPLETION_EXECUTION_PLAN_2026-07-01.md)（残り実装計画）→ [COMPLETION_PROGRESS_2026-07-01.md](COMPLETION_PROGRESS_2026-07-01.md)（実施記録）。前身は [SHORT_COMPLETION_AUDIT_2026-06-23.md](SHORT_COMPLETION_AUDIT_2026-06-23.md) / [RELEASE_0.9_PRODUCTION_SHELL_REPORT_2026-06-23.md](RELEASE_0.9_PRODUCTION_SHELL_REPORT_2026-06-23.md)。

**最新版の見方**: ルートの `Run_All.bat` で `03_companion` と `01_wallpaper` を起動し、`http://localhost:5173/` をクエリなしで開く。`02_ui-overlay` は統合版では `01_wallpaper` に埋め込まれており、`Run_UI.bat` は単体プレビュー専用。

| ファイル | 内容 |
|----------|------|
| [STATUS_REPORT_2026-06-10.md](STATUS_REPORT_2026-06-10.md) | プロジェクト全体の現状スナップショット |
| [RELEASE_V0.8.1.md](RELEASE_V0.8.1.md) | v0.8.1 の変更点・検証メモ |
| [MAINLINE_VERSIONING.md](MAINLINE_VERSIONING.md) | v0.8 系の命名・表示・release生成ルール |
| [GIT_TREE_POLICY.md](GIT_TREE_POLICY.md) | main / tag / archive branch の運用ルール |
| [INFO_DISPLAY_UI_STYLE_REPORT_2026-07-09.md](INFO_DISPLAY_UI_STYLE_REPORT_2026-07-09.md) | 情報表示部UIの雰囲気・構成・Companion移植向けスタイルメモ |
| [MOTION_PIPELINE_RESEARCH_2026-06-11.md](MOTION_PIPELINE_RESEARCH_2026-06-11.md) | モーション・パイプラインの調査 |
| [model-audit/](model-audit/) | VRMモデルのライセンス／構造監査（md + json） |

## 各アプリのドキュメント
- ① 壁紙: [`../01_wallpaper/docs/`](../01_wallpaper/docs/) ＋ 正典ガイド `../01_wallpaper/MOTION_AUTHORING_GUIDE.md`
- ② UIオーバーレイ: [`../02_ui-overlay/docs/`](../02_ui-overlay/docs/)
- ③ コンパニオン: `../03_companion/README.md`

## 命名・管理規則
- **全体ドキュメント**（このフォルダ）: `TOPIC.md` または日付付き `TOPIC_YYYY-MM-DD.md`。
- **アプリ内フェーズ文書**: `<PHASE>_<TYPE>.md`、`TYPE ∈ {CHECKLIST, PROGRESS, REPORT}`（例: `MOTION_PROBE_0_7_PREMIUM_PROPS_REPORT.md`）。
- **完了したフェーズ文書**: そのアプリの `docs/_archive/` へ移動（履歴として保管）。
- **正典／恒久ガイド**: バージョンを付けずアプリ直下に常駐（例: `MOTION_AUTHORING_GUIDE.md`）。
- **本流バージョン規則**: `MAINLINE_VERSIONING.md` に集約し、実装・表示・生成スクリプトを同じ版にそろえる。
- **Gitツリー運用**: `GIT_TREE_POLICY.md` に集約し、`main` を現役本流、tag をチェックポイント、`archive/closed/` を閉じた過去ツリーとして扱う。
- **使い終わった非ドキュメント物**（インストーラ・一回限りスクリプト・検証出力など）: ルート `_archive/` へ移動（削除しない）。
- 各 `docs/` 直下に `README.md` 索引を置き、生きている最新文書へリンクする。
