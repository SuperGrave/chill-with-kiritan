# Motion Probe 0.7 Checklist
## Premium Props Preparation Pack — 検証チェックリスト

実行ディレクトリ: `TOHOKU_WALLPAPER_MOTION_PROBE_0_1` / 日付: 2026-06-11

---

## A. 必須コマンド

| # | コマンド | 期待 | 結果 |
|---|----------|------|------|
| A1 | `npm install` | 脆弱性 0 / 正常終了 | ✅ |
| A2 | `npx tsc -b` | exit 0（ソース不変・型影響なし） | ✅ |
| A3 | `npm run build` | exit 0・`strip-dist-vrm` 実行 | ✅ |
| A4 | `npm run check:dist-assets` | `dist` に `.vrm` 無し | ✅ |
| A5 | `npm run check:props` | 台帳あり・manifest 妥当・basic 3/3（exit 0） | ✅ premium 14 予約 |

---

## B. 確認項目（完了条件）

| # | 項目 | 期待 | 結果 |
|---|------|------|------|
| B1 | premium props を後から入れられるフォルダ構成 | `premium/` 作成・README・.gitkeep | ✅ |
| B2 | candidates inbox 運用の docs 化 | `candidates/README_ASSET_INBOX.md`（8 手順） | ✅ |
| B3 | `props.manifest.json` がある | basic（実パス）/ premium（14 slot 予約） | ✅ |
| B4 | `ASSET_CREDITS.md` が拡張されている | 指定 11 列の台帳テーブル＋Kenney CC0 記録 | ✅ |
| B5 | `check:props` が成功する | basic 必須・premium 警告・台帳必須 | ✅ exit 0 |
| B6 | basic の desk/chair/laptop が維持 | 直下のまま・`scene.json` 不変 | ✅ |
| B7 | build 成功 / dist に `.vrm` 無し | | ✅ |
| B8 | docs 作成済み | PROGRESS / REPORT / CHECKLIST | ✅ |

---

## C. ディレクトリ構成（実際に作成したもの）

```text
public/models/props/
  README_PROPS.md            ← 0.7 セクション追記
  ASSET_CREDITS.md           ← 台帳テーブル化（拡張）
  props.manifest.json        ← 新規（basic/premium、slot 定義）
  desk.glb  chair.glb  laptop.glb   ← basic（移動せず直下のまま）
  premium/
    README_PREMIUM_PROPS.md  ← 新規
    .gitkeep                 ← 新規
  candidates/
    README_ASSET_INBOX.md    ← 新規（8 手順）
    .gitkeep                 ← 新規

public/scenes/room_workdesk_day/
  scene.premium.example.json ← 新規（読み込まれない例・premium slot 雛形）

scripts/
  check-prop-assets.cjs      ← 新規（check:props）
```

> **指示のディレクトリ図との差異**: 図は `basic/desk.glb` だが、既存 GLB は `public/models/props/` 直下のまま
> （移動は `scene.json`/稼働表示を壊すため。指示の逃げ道に従い docs/manifest で方針明文化）。
> よって **`basic/` サブフォルダは作成していない**。manifest の `sets.basic` は直下パスを指す。

---

## D. スコープ厳守（やらないこと）

| # | 項目 | 状態 |
|---|------|------|
| D1 | 外部から素材を勝手にダウンロード | していない ✅ |
| D2 | ライセンス不明・再配布禁止素材を public 配下へ配置 | していない ✅ |
| D3 | VRM 改変・再エクスポート | していない ✅ |
| D4 | モーション実装変更 | していない ✅ |
| D5 | manifest のランタイム実装 / 新機能 | していない ✅（準備のみ） |
| D6 | UI_OVERLAY / Companion / Wallpaper Engine / Electron / 大規模リファクタ | していない ✅ |

---

## E. 申し送り

- premium はゼロ（フォルダ＋slot 予約のみ）。次に入手すべきは **monitor / keyboard / mouse**（優先度A）→
  desk_lamp / mug / book / plant（B）。手順は `candidates/README_ASSET_INBOX.md`、雛形は
  `scene.premium.example.json`（REPORT §5）。
- `scene.premium.example.json` の `scale` は placeholder 箱寸法。実 GLB 投入後は 0.6 Layout UI で倍率として再調整。
- `props.manifest.json` の実行時読み込み（basic⇄premium 切替）は次フェーズ候補（REPORT §7）。
- 0.6A（Layout Lock）は **Export JSON 待ち**で別途継続中（`scene.json` は未変更）。本 0.7 とは独立。
