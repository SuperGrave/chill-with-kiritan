# v0.8.6 post-release hotfix: background startup / personal news marquee

公開済みv0.8.6へ追加するローカルhotfix。GitHub Releaseの既存アセットは差し替えない。

## 自動起動

- `schtasks`、`reg`、PowerShellはWindowsの `CREATE_NO_WINDOW` で実行する。
- `PUT /api/settings` が登録を調整した直後、frontendから同じ登録処理を二重実行しない。
- 通常の状態確認・Run keyフォールバックは背景で処理し、UACは明示的な「管理者権限で登録」操作だけに限定する。

## 個人ニュース

- 通常の物理行と句点は同一BLOCKへ連結する。
- `[Break]`、`[Paragraph]`、`[段落]`、`---`、`[Topic: ...]`、`(Wait: ...)` だけを表示境界として扱う。
- marqueeは各BLOCKにつき1回だけ再生し、画面外へ抜けてから次へ進む。
- 旧LINE構造からの再読込時は、旧インデックスではなく絶対経過時間を新BLOCKへ写像する。
- Companion UIの前後操作と進捗表示は、LINEではなく段落／BLOCKとして案内する。

## 検証

- Rust unit 29件、API integration 6件: PASS
- 個人ニュース対象テスト12件: PASS
- Companion / Overlay production build: PASS
- 青空文庫「夢十夜」: 12章 / 12BLOCK
- AIエージェント特集: 7章 / 7BLOCK
- ローカルブラウザで長文BLOCKの単発animationと完走後の切替を確認
- Wallpaper Engine用zipと全部入りzipを全entry読み取り。VRM/VRMA・秘密情報の混入なし

ローカル配布物: `release/v0.8.6-hotfix-2026-07-15-background-news/`
