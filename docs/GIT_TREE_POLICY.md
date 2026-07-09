# Git Tree Policy

このリポジトリの開発ツリー運用ルール。2026-07-09 時点で、最新の開発線を
`main` に集約し、過去の作業線は閉じたアーカイブとして扱う。

## 基本方針

- `main` を唯一の現役開発ラインにする。
- 小さな更新は `main` に積み上げ、チェックポイントごとに Git tag を残す。
- バージョン名は `v0.8.0`, `v0.8.1`, `v0.8.2` の形式でそろえる。
- `release/vX.Y.Z/` はパッケージ生成物であり、Git にはコミットしない。
- 使い終わった作業ブランチは削除せず、`archive/closed/YYYY-MM-DD/<name>` に移して凍結する。

## 現在の現役ライン

| 種別 | 名前 | 内容 |
|------|------|------|
| branch | `main` | 最新の開発本流。現在は v0.8.1 まで反映済み |
| tag | `v0.8.0` | 旧 `v4` を本流化したチェックポイント |
| tag | `v0.8.1` | 自動起動修復、壁紙fallback、天気retry、RSS一覧追加のチェックポイント |

`main` はローカルで `origin/main` より進んでいる。GitHub など外部へ同期する場合は、
内容を確認したうえで別途 push する。

## 閉じたアーカイブブランチ

以下は過去ツリーとして閉じる。直接開発を続けず、必要な内容がある場合だけ
`main` へ取り込むか、新しい短命ブランチを切って確認する。

| branch | 元の位置 / 用途 |
|--------|------------------|
| `archive/closed/2026-07-01/phase1-visual-qa` | Phase 1 visual QA 時点 |
| `archive/closed/2026-07-01/pre-rescue` | rescue 前の保存点 |
| `archive/closed/2026-07-01/rescue-pre-split` | mixed worktree 分割前の rescue 保存点 |
| `archive/closed/2026-07-01/wip-work-hand-pin-ik` | hand-pin IK 実験WIP |
| `archive/closed/2026-07-09/feat-pose-composer-0.8` | v0.8.0 本流化済みの旧作業線 |
| `archive/closed/2026-07-09/main-before-v0.8.0` | v0.8.0 本流化前の main 保存点 |
| `archive/closed/2026-07-09/pre-mainline-v0.8.0` | mainline 整理前の保存点 |

## 今後の進め方

1. 通常作業は `main` で行う。
2. まとまった実験や壊れやすい変更だけ、短命ブランチを作る。
3. 実装・検証が済んだら `main` に戻し、必要なら短命ブランチを
   `archive/closed/YYYY-MM-DD/<name>` へ移す。
4. 動作確認できる節目ごとに annotated tag を作る。
5. Companion / npm / Tauri / Cargo / release package のバージョンを同じ値にそろえる。

タグ作成例:

```powershell
git tag -a v0.8.2 -m "release: v0.8.2"
```

過去アーカイブから内容を拾う場合は、アーカイブブランチ上で作業を進めず、
`git show`, `git cherry-pick`, `git checkout <branch> -- <path>` などで必要分だけ扱う。
