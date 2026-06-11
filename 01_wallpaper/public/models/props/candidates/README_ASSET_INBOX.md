# Asset Inbox — candidates (`public/models/props/candidates/`)

ユーザーが**後で入手した素材（GLB / glTF / zip）を、安全に受け入れて検証するための一時置き場**です。
ここはインボックス（受信箱）で、**まだ scene.json には入れません**。検証して問題なければ `../premium/` へ昇格します。

> ⚠ **このプロジェクトは素材を勝手に外部サイトからダウンロードしません。** 入手・配置はユーザーが
> ライセンスに同意のうえ手動で行います。再配布禁止・商用不可・ライセンス不明の素材は **public 配下へ入れない**でください
> （VRM 本体・`.vrma` と同方針。`dist` への混入防止は `npm run check:dist-assets`）。

## 受け入れ手順（順守）

1. **ダウンロード前にライセンスを確認する。** 配布ページのライセンス表記・利用規約を必ず読む。
2. **CC0 を最優先する。** 帰属不要・再配布可・商用可で最も扱いやすい。
3. **CC-BY の場合は、作者・URL・ライセンスを必ず記録する。** 帰属表示が必要なので
   `../ASSET_CREDITS.md` の表へ漏れなく記入する。
4. **再配布禁止・商用不可・ライセンス不明は public 配下へ入れない。** どうしても試したい場合でも
   public の外（リポジトリ非同梱・`dist` に出ない場所）で個人検証にとどめる。
5. **zip 素材は展開前に出典を記録する。** ダウンロード元 URL・ライセンス・取得日を先に
   `../ASSET_CREDITS.md` へ控えてから展開する。
6. **glb / gltf / bin / textures の構成を壊さない。** `.gltf` は `.bin` と `textures/` への相対参照を
   持つことがある。フォルダごと（相対パス維持で）置く。`.glb` は単一ファイルで自己完結。
7. **取り込み後、scene.json へ直接入れない。まず candidates として記録する。** ここ（candidates）に置き、
   `../ASSET_CREDITS.md` に 1 行追記。slot 名（desk/chair/laptop/monitor/keyboard/mouse/mug/book/notebook/
   desk_lamp/speaker/smartphone/pen_stand/plant）を割り当てる。
8. **動作確認後に premium へ昇格する。** 検証（下記）で表示・スケール・原点・前向きが問題なければ
   `../premium/<slot>.glb` へ移動し、`../props.manifest.json` の `sets.premium.<slot>` を更新、
   `scene.premium.example.json` を参考に `scene.json` へ追加 → Layout UI（0.6）で再調整。

## 検証のしかた（候補 → premium 昇格の前）

- **ライセンス記録**: `../ASSET_CREDITS.md` の表に行があるか。
- **構成**: `.glb` 単体、または `.gltf`＋`.bin`＋`textures/` が揃っているか（相対参照切れがないか）。
- **読み込みテスト（任意）**: 一時的に `scene.json` の該当 prop の `url` を candidates のパスに向け、
  `G`（Reload Scene）で表示確認 → 確認できたら url を premium パスへ。
  - 落ちない設計: 読めない場合は `fallback: "box"` でプレースホルダ箱に落ちます（アプリは落ちません）。
- **`npm run check:props`**: basic 3 点の存在と manifest 妥当性を確認（candidates 自体は対象外）。

## ファイル名・slot

- 最終的なファイル名は **slot 名**に合わせる（例 `monitor.glb` `keyboard.glb` `desk_lamp.glb`）。
- candidates 段階では元のファイル名のままでもよいが、`ASSET_CREDITS.md` にどの slot 候補かを必ずメモする。
