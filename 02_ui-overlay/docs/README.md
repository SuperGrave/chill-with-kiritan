# 02_ui-overlay ドキュメント索引

壁紙に重ねるUIレイヤー（時計・天気・右ドック・各パネル）の開発ドキュメント。
**見た目のみ**を担当し、実データ連携は ③ コンパニオン経由（将来）。

## 文書
- [UI_OVERLAY_SPEC.md](UI_OVERLAY_SPEC.md) … 仕様
- [UI_OVERLAY_PROGRESS.md](UI_OVERLAY_PROGRESS.md) … 進捗
- [compositing/](compositing/) … 壁紙へ重ねる際の合成・レイアウト指南（旧ルート `docs2`）
  - `README.md`（合成手順）/ `layout-notes.md`（各要素の座標意図）/ `position-reference.json`

## 命名規則
仕様・進捗は `UI_OVERLAY_<TYPE>.md`。合成関連は `compositing/` にまとめる。
