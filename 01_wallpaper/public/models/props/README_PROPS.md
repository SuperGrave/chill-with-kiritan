# 小道具モデル (props GLB) の配置について  (Scene / Props Probe 0.1 = Motion Probe 0.4)

このディレクトリ (`public/models/props/`) に **小道具の GLB** を置くと、
Scene Preset（`public/scenes/<id>/scene.json`）の各 prop が GLB を読み込んで表示します。

## 配置済みGLB

| prop id | ファイル名 | 素材元 | ライセンス |
|---------|-----------|--------|-----------|
| `desk`   | `desk.glb`   | Kenney Furniture Kit | CC0 |
| `chair`  | `chair.glb`  | Kenney Furniture Kit (Desk Chair) | CC0 |
| `laptop` | `laptop.glb` | Kenney Furniture Kit | CC0 |

スタイル: **ローポリ・フラットカラー**（Kenney スタイル）。
詳細は `ASSET_CREDITS.md` を参照。

## GLB が無くても動きます（最重要方針）

GLB を **置かなくても** probe は動作します。GLB が見つからない場合は、その prop の
`fallback` に従って以下のどちらかになります（アプリは落ちません）:

- `fallback: "box"`（既定） → **半透明プレースホルダ箱** を表示（`scale` が箱の寸法になります）。
- `fallback: "none"` → その prop だけ **非表示**（UI / console に missing として記録）。

console には読み込み結果が出ます（例）:

```
[SCENE] "room_workdesk_day" loaded (fetched) | props 3/3 ok, placeholders 0, missing 0
```

## 配置手順

1. 任意の GLB（`.glb`）を入手 or 作成（ライセンスに同意できるもののみ）。
2. ファイル名を `desk.glb` / `chair.glb` / `laptop.glb` にして本ディレクトリへ置く。
3. アプリを起動（or **Reload Scene** / `G` キー）→ GLB があれば箱の代わりに GLB が出ます。
4. 位置・向き・大きさは `scene.json` の `position` / `rotation`（ラジアン）/ `scale` で調整。
   - GLB の場合 `scale` は **モデル本来のサイズへの倍率** です（箱と違い寸法ではありません）。
     モデルのスケール感に合わせて調整してください。

## ライセンス

同梱GLBは全て **CC0 1.0 Universal**（パブリックドメイン）です。
出典・ライセンスの詳細は `ASSET_CREDITS.md` を参照してください。

**外部サイトのモデルを勝手に同梱しないでください。** 各配布元の規約に従い、
ライセンスが確認できるもののみ配置してください。再配布禁止・ライセンス不明の素材は同梱しません
（VRM 本体・`.vrma` と同じ方針）。

---

## basic / premium / candidates（Premium Props Preparation Pack 0.7）

豪華版モデルを後から安全に差し替え・追加するためのフォルダ構成です。

| 区分 | 置き場所 | 中身 |
|------|----------|------|
| **basic** | このフォルダ直下（`desk.glb`/`chair.glb`/`laptop.glb`） | 同梱の CC0 Kenney 簡易モデル。0.7 でも**移動していません**（`scene.json` のパス・稼働中の表示を壊さないため） |
| **premium** | `premium/*.glb` | ユーザーが後から入手する豪華版・追加小道具（未同梱）。`premium/README_PREMIUM_PROPS.md` |
| **candidates** | `candidates/` | 受け入れ・検証前のインボックス。`candidates/README_ASSET_INBOX.md` |

- **slot 一覧**（`props.manifest.json` と一致させる）:
  - 優先度A: `desk` `chair` `laptop` `monitor` `keyboard` `mouse`
  - 優先度B: `mug` `book` `notebook` `desk_lamp` `speaker` `smartphone` `pen_stand` `plant`
- **`props.manifest.json`**: 素材セットレジストリ（`basic` / `premium`）。**実行時に読む実装は 0.7 では未実装**
  （準備のみ）。小道具読み込みは引き続き `scene.json` が駆動します。
- **`scene.premium.example.json`**（`public/scenes/room_workdesk_day/`）: premium 構成の**例（読み込まれない）**。
  `scene.json` へ手で反映する際の雛形。未配置 slot は placeholder 箱に落ちます。
- **検証**: リポジトリルートで `npm run check:props`（台帳・manifest・basic 3 点を検査）。
- **ライセンス**: すべて `ASSET_CREDITS.md` の表へ記録（CC0 最優先 / CC-BY は出典必須 / 再配布禁止・不明は public 配下に入れない）。
