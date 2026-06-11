# Motion Probe 0.7 Report
## Premium Props Preparation Pack — 詳細レポート

対象: `TOHOKU_WALLPAPER_MOTION_PROBE_0_1`
前提: 0.1〜0.6 完了（VRM 表示 / Custom Expression Bridge / Idle State Machine / External Motion /
Scene・Props Loader / Background Layer / Layout Calibration UI / desk・chair・laptop の CC0 GLB 配置 /
Layout Export JSON / dist からの VRM 除外）。

> 本フェーズは **「豪華版小道具を後から安全に追加する受け入れ基盤」**の整備のみ。
> **素材を勝手にダウンロードしない／新機能（ランタイム実装）に進まない。** manifest を実行時に読む実装も今回はしない。

---

## 1. 素材管理方針

- **勝手に取得・同梱しない**: 外部サイトからの自動ダウンロードはしない。入手・配置はユーザーがライセンス同意のうえ手動。
- **CC0 最優先**。CC-BY は作者・URL・ライセンス・帰属文言を必ず記録。**再配布禁止・商用不可・ライセンス不明は
  `public/` 配下へ入れない**（VRM 本体・`.vrma` と同方針）。
- **台帳必須**: `public/models/props/ASSET_CREDITS.md` に全 props を記録。`npm run check:props` が台帳の存在を必須化
  （無ければ exit 1）。
- **インボックス経由**: 入手素材はまず `candidates/` で受け入れ・検証 → 問題なければ `premium/` へ昇格。
  `scene.json` へ直接入れない。
- **落ちない設計を維持**: 未配置 slot は `fallback:"box"` で placeholder 箱に落ちる（アプリは落ちない）。
- **配布安全を維持**: `dist` への再配布禁止 VRM 混入防止（`check:dist-assets`）は不変。

---

## 2. basic / premium / candidates の違い

| 区分 | 置き場所 | 中身 | scene.json への反映 | check:props 上の扱い |
|------|----------|------|---------------------|----------------------|
| **basic** | `public/models/props/*.glb`（直下） | 同梱 CC0 Kenney 簡易モデル（desk/chair/laptop） | 既定 `scene.json` が参照 | desk/chair/laptop の**実在を必須**（欠ければ exit 1） |
| **premium** | `public/models/props/premium/*.glb` | ユーザーが後から入手する豪華版・追加小道具 | `scene.premium.example.json` を雛形に**手で反映** | 欠損は**警告のみ**（未入手が前提） |
| **candidates** | `public/models/props/candidates/` | 受け入れ・**検証前**の素材インボックス | まだ入れない | 対象外（検証後 premium へ） |

> **basic は移動していない**（重要な運用判断）: 既存 GLB を `basic/` サブフォルダへ移すと `scene.json` の URL・
> 組み込みデフォルト・0.6A で調整中の表示を壊すため、指示の逃げ道（「移動して破壊が大きくなるなら無理に移動しなくてよい。
> docs で方針だけ定める」）に従い、**直下のまま**とし方針を docs/manifest で明文化した。`props.manifest.json` の
> `sets.basic` は直下パスを指す。これは指示のディレクトリ図（`basic/desk.glb`）からの**意図的な逸脱**。

---

## 3. 追加した slot 一覧

`props.manifest.json` の `slots` と各 README に定義。premium セットは全 slot を `null` で予約済み。

| 優先度 | slot |
|--------|------|
| **A** | `desk` `chair` `laptop` `monitor` `keyboard` `mouse` |
| **B** | `mug` `book` `notebook` `desk_lamp` `speaker` `smartphone` `pen_stand` `plant` |

`scene.premium.example.json` に含めた例: `desk` `chair` `monitor` `keyboard` `mouse` `mug` `book` `desk_lamp`
（残り `laptop`/`notebook`/`speaker`/`smartphone`/`pen_stand`/`plant` は slot 予約のみ）。

---

## 4. 現在足りない素材

- **basic 相当はあり**（desk/chair/laptop の CC0 GLB）。**premium はゼロ**（フォルダと slot 予約のみ）。
- 作業机 Chill Room を「豪華に」見せるための主要 slot が未充足:
  - **優先度A の未充足**: `monitor`（PC の主役・現状は laptop が代替）、`keyboard`、`mouse`。
  - **優先度B の未充足**: `mug` `book` `notebook` `desk_lamp` `speaker` `smartphone` `pen_stand` `plant`。

---

## 5. ユーザーが次にダウンロードすべき素材

入手はユーザー手動・ライセンス確認のうえで。推奨は **CC0**（例: Kenney / Poly Pizza の CC0、Quaternius など）。

1. **最優先（A）**: `monitor`（モニタ/ディスプレイ）、`keyboard`、`mouse`。
   - これで「PC 作業机」「monitor side で壁紙向き」の構図が作れる（現状 laptop 代替を解消）。
2. **次点（B・Chill 感）**: `desk_lamp`（間接照明）、`mug`、`book`/`notebook`、`plant`。
3. （任意）`speaker` `smartphone` `pen_stand` で密度を追加。

取り込み手順は `public/models/props/candidates/README_ASSET_INBOX.md`（8 手順）。
配置後の流れ: candidates 記録 → 検証 → `premium/<slot>.glb` 昇格 → `props.manifest.json` 更新 →
`scene.json` へ反映（`scene.premium.example.json` 参照）→ 0.6 Layout UI で位置/回転/スケール調整 → Export。

> **注意（スケール）**: `scene.premium.example.json` の `scale` は placeholder 箱用の寸法です。
> 実 GLB を入れたら `scale` は「モデル本来サイズへの倍率」として 0.6 Layout UI で再調整してください。

---

## 6. ライセンス上の注意

- **CC0**: 帰属不要・商用可・再配布可。最も安全。`ASSET_CREDITS.md` には出所のみ記録（任意だが推奨）。
- **CC-BY**: 帰属表示が**必須**。`ASSET_CREDITS.md` に作者・URL・ライセンス・**表示文言**を必ず記録し、
  最終成果物でも表示する運用を検討。
- **再配布禁止・商用不可・ライセンス不明**: **`public/` 配下へ入れない**（リポジトリ・`dist` に出さない）。
  個人検証は public の外で。
- **zip 素材**: 展開前に出典・ライセンス・取得日を `ASSET_CREDITS.md` に記録。`.gltf`＋`.bin`＋`textures/` は
  相対参照を壊さない（フォルダごと配置）。
- **VRM 本体**: 引き続き再配布禁止・同梱不可。`dist` 除外は `check:dist-assets` で担保（本フェーズ不変）。

---

## 7. 次フェーズ候補

1. **manifest ランタイム読み込み＋セット切替**: `activeSet`（basic/premium）を読み、欠損 slot は basic か placeholder に
   フォールバックする loader 拡張。UI に「basic ⇄ premium」トグル。
2. **monitor 導入＋ monitor-side 構図の確定**（0.6A の Layout Lock と連携）。
3. **slot ごとの推奨 transform プリセット**（豪華版の原点・向き差異を吸収するデフォルト）。
4. **candidates → premium 昇格の半自動チェック**（glb/gltf 構成・bbox・原点の簡易検査を `check:props` に追加）。
5. （将来）UI_OVERLAY 統合・Companion・Wallpaper Engine 化（**本フェーズ対象外**）。

---

## 8. やらなかったこと（スコープ厳守）

外部からの素材自動取得 / ライセンス不明・再配布禁止素材の配置 / VRM 改変・再エクスポート /
モーション実装変更 / manifest のランタイム実装 / UI_OVERLAY 統合 / Companion App /
Wallpaper Engine・Electron 化 / 大規模リファクタ — いずれも未着手。

---

## 9. 検証

```powershell
npm install               # 脆弱性 0
npx tsc -b                # exit 0（ソース不変）
npm run build             # exit 0 / strip-dist-vrm が .vrm 除去
npm run check:dist-assets # dist に .vrm 無し
npm run check:props       # 台帳あり・manifest 妥当・basic 3/3・premium 14 予約（exit 0）
```

| 確認項目 | 結果 |
|----------|------|
| 既存 desk/chair/laptop が壊れていない | ✅ 直下のまま・`scene.json` 不変 |
| `scene.json` が壊れていない | ✅ 不変（premium は別ファイル例として追加） |
| `ASSET_CREDITS.md` が存在する | ✅ 台帳テーブル化 |
| `props.manifest.json` が妥当 | ✅ parse 可・basic/premium 定義あり |
| basic の必須 3 点が存在 | ✅ desk/chair/laptop |
| `dist` に `.vrm` 無し | ✅ |
| 新機能実装に進んでいない | ✅ ランタイム不変（manifest 未読込） |
