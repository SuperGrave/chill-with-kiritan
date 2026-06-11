# Motion Probe 0.7 Progress
## Premium Props Preparation Pack — 実装ログ

> 目的: desk / chair / laptop の簡易 CC0 構成を、将来の**豪華版モデル**へ安全に差し替えられるようにする
> **受け入れ基盤**を整備する。**素材は勝手にダウンロードしない**。ユーザーが後で入手した GLB/glTF/zip を
> 安全に受け入れ・ライセンス記録・配置・`scene.json` 候補化・検証できる土台を作る。
> **新機能（ランタイム実装）は追加しない。** manifest を実行時に読む実装も今回はしない（準備のみ）。

---

## 追加・変更ファイル

### 新規（public/models/props/）
- `props.manifest.json` — 素材セットレジストリ。`version` / `activeSet:"basic"` / `slots`（優先度A・B）/
  `sets.basic`（実在 3 点の web パス）/ `sets.premium`（全 14 slot を `null` で予約）。
  **実行時読み込みは未実装**（将来の切替実装に使える形式）。
- `premium/README_PREMIUM_PROPS.md` ＋ `premium/.gitkeep` — 豪華版置き場（未同梱）。basic/premium/candidates の
  違い・受け入れ条件・slot 命名規約・反映フローを記載。
- `candidates/README_ASSET_INBOX.md` ＋ `candidates/.gitkeep` — 受け入れインボックス。8 手順の取り込みフロー
  （ライセンス確認 → CC0 最優先 → CC-BY 記録 → 禁止素材は public 外 → zip は展開前に出典記録 →
  構成維持 → まず candidates 記録 → 動作確認後 premium 昇格）。

### 新規（public/scenes/room_workdesk_day/）
- `scene.premium.example.json` — premium 構成の**例（読み込まれないテンプレート）**。
  desk/chair/monitor/keyboard/mouse/mug/book/desk_lamp の slot を含み、URL は将来パス
  `/models/props/premium/<slot>.glb`。未配置なので読み込めば placeholder 箱に落ちる（既存 fallback 設計の実演）。

### 新規（scripts/）
- `check-prop-assets.cjs` — `props.manifest.json` を読み、ASSET_CREDITS.md 存在・manifest 妥当性・
  **basic の desk/chair/laptop 実在**を必須化（欠ければ exit 1）。**premium 欠損は警告のみ**。
  `public/` のみ検査（`check-dist-assets.cjs` と同方針）。

### 変更
- `public/models/props/ASSET_CREDITS.md` — 指定列を持つ**台帳テーブル**を追加（slot / file / asset name /
  author / source URL / license / attribution required / commercial use / redistribution allowed /
  download date / notes）。現行 Kenney CC0（desk/chair/laptop）を記録。premium 追記テンプレも同梱。
- `public/models/props/README_PROPS.md` — （次項の通り）basic/premium/candidates・manifest・check:props を反映予定/反映。
- `package.json` — `"check:props": "node scripts/check-prop-assets.cjs"` を追加。
- `README.md`（probe ルート）— アセット配置表に premium/candidates 行、`basic/premium/candidates` セクション、
  slot 一覧、`npm run check:props`、「素材を勝手に同梱しない」方針を追記。
- `docs/` — 本 PROGRESS / REPORT / CHECKLIST を新規作成。

---

## 重要な設計判断

1. **basic GLB は移動しない**: 既存の `desk.glb`/`chair.glb`/`laptop.glb` は `public/models/props/` 直下のまま。
   `basic/` サブフォルダへ移すと `scene.json` の URL・組み込みデフォルト・稼働中の表示（0.6A 調整中）を壊すため、
   指示の逃げ道（「移動して破壊が大きくなるなら無理に移動しなくてよい。docs で方針だけ定める」）に従い、
   **方針を docs/manifest で明文化**する形にした。manifest の `sets.basic` は直下パスを指す。
   → これは指示のディレクトリ図（`basic/desk.glb`）からの**意図的な逸脱**。理由とともに REPORT §運用に明記。
2. **準備のみ・ランタイム不変**: manifest を読む実装・小道具切替 UI は作らない。小道具読み込みは引き続き
   `scene.json` が駆動。よって rig/morph/カメラ/モーション/既存シーンには一切触れていない。
3. **落ちない設計を維持**: premium 未配置 slot は `scene.json` 側 `fallback:"box"` で placeholder に落ちる
   （`scene.premium.example.json` がその実演）。`check:props` も premium 欠損は警告止まり。
4. **ライセンス安全**: 台帳必須化（`check:props` が ASSET_CREDITS.md 欠如で exit 1）。再配布禁止・不明素材は
   public 配下に入れない方針を README/各 README に明記。`dist` への VRM 混入防止（`check:dist-assets`）は不変。

---

## 検証結果（サマリ。詳細は REPORT / CHECKLIST）

| 項目 | 結果 |
|------|------|
| `npm install` | ✅ 脆弱性 0 |
| `npx tsc -b` | ✅ exit 0（ソース不変・型影響なし） |
| `npm run build` | ✅ exit 0（strip で `.vrm` 除去） |
| `npm run check:dist-assets` | ✅ `dist` に `.vrm` 無し |
| `npm run check:props` | ✅ exit 0（basic 3/3・台帳あり・manifest 妥当・premium 14 予約） |
| 既存 desk/chair/laptop | ✅ 直下のまま・`scene.json` 不変・表示維持 |
