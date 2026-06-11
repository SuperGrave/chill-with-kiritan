# Premium Props (`public/models/props/premium/`)

このフォルダは、`desk` / `chair` / `laptop` の簡易 CC0 モデル（**basic**）を、将来の**豪華版モデル**へ
差し替える・小道具を追加するための置き場です（Premium Props Preparation Pack 0.7）。

## いまの状態

- **まだモデルはありません**（このフォルダは `.gitkeep` のみ）。0.7 は「後から安全に追加できる基盤」を作る
  フェーズで、**素材を勝手にダウンロード・同梱しません**。
- basic（簡易版）は `public/models/props/desk.glb` / `chair.glb` / `laptop.glb`（このフォルダの 1 つ上）に
  あります。0.7 では**移動していません**（`scene.json` のパスと稼働中の表示を壊さないため）。

## basic / premium / candidates の違い

| 区分 | 置き場所 | 中身 | scene.json への反映 |
|------|----------|------|---------------------|
| **basic** | `public/models/props/*.glb`（直下） | 同梱の CC0 Kenney 簡易モデル（desk/chair/laptop） | 既定の `scene.json` が参照 |
| **premium** | `public/models/props/premium/*.glb` | ユーザーが後から入手する豪華版・追加小道具 | `scene.premium.example.json` を参考に手で反映 |
| **candidates** | `public/models/props/candidates/` | **動作未確認・検証前**の受け入れ素材（インボックス） | まだ scene には入れない |

## premium へ入れてよい素材（厳守）

1. **ライセンスが明確**で、**再配布可**なもののみ（CC0 最優先、CC-BY は出典記録必須）。
2. **再配布禁止・商用不可・ライセンス不明**は **public 配下へ入れない**（VRM 本体・`.vrma` と同方針）。
3. 入れる前に必ず `../ASSET_CREDITS.md` の表へ 1 行追記（slot / file / author / source / license / …）。
4. まず `../candidates/` で受け入れ → 動作確認 → 問題なければ premium へ「昇格」。手順は
   `../candidates/README_ASSET_INBOX.md`。

## ファイル名の規約（slot 名に合わせる）

`premium/<slot>.glb`。slot は以下（`../props.manifest.json` と一致させる）:

- **優先度A**: `desk` `chair` `laptop` `monitor` `keyboard` `mouse`
- **優先度B**: `mug` `book` `notebook` `desk_lamp` `speaker` `smartphone` `pen_stand` `plant`

例: `premium/monitor.glb` / `premium/keyboard.glb` / `premium/desk_lamp.glb`

## 反映の流れ

1. `premium/<slot>.glb` を配置（上の規約・ライセンス順守）。
2. `../props.manifest.json` の `sets.premium.<slot>` を `"/models/props/premium/<slot>.glb"` に更新。
3. `npm run check:props` で参照ファイルの存在を確認（**premium の欠損は警告のみ**／basic 3 点欠損は失敗）。
4. `scene.premium.example.json`（`public/scenes/room_workdesk_day/`）を参考に、`scene.json` の `props` へ追加。
5. アプリで **Reload Scene（G）** → Layout Calibration UI（0.6）で位置・回転・スケールを調整 → Export → `scene.json` へ反映。
   - **注意**: 実 GLB の `scale` は「モデル本来サイズへの倍率」です（プレースホルダ箱の寸法とは意味が違います）。
     豪華版は basic と原点・寸法・前向き軸が異なることが多いので、必ず再調整してください。
