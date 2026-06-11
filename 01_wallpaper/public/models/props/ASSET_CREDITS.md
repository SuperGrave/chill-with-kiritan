# Asset Credits — Props (license ledger)

このファイルは props 素材の**ライセンス台帳**です。`public/models/props/` 配下に置く全モデルを
ここへ記録します（`npm run check:props` はこのファイルの存在を必須にしています）。

**方針**: 素材は勝手に同梱・ダウンロードしません。**CC0 最優先**。CC-BY は作者・URL・ライセンスを必ず記録。
**再配布禁止・商用不可・ライセンス不明は public 配下へ入れません**（VRM 本体・`.vrma` と同方針）。

凡例: attribution required / commercial use / redistribution allowed = `yes` / `no` / `?`（不明＝配置不可）。

---

## 台帳（全 props 共通の表）

| slot | file | asset name | author | source URL | license | attribution required | commercial use | redistribution allowed | download date | notes |
|------|------|-----------|--------|-----------|---------|----------------------|----------------|------------------------|---------------|-------|
| desk | `desk.glb` | Desk | Kenney (kenney.nl) | https://poly.pizza/m/6PbVkqPzEU | CC0 1.0 | no | yes | yes | 2026-06-10 | **basic** set / Furniture Kit。無変換 |
| chair | `chair.glb` | Desk Chair | Kenney (kenney.nl) | https://poly.pizza/m/CKSz6PB1vO | CC0 1.0 | no | yes | yes | 2026-06-10 | **basic** set / Furniture Kit。無変換 |
| laptop | `laptop.glb` | Laptop | Kenney (kenney.nl) | https://poly.pizza/m/GnbwSUiVty | CC0 1.0 | no | yes | yes | 2026-06-10 | **basic** set / Furniture Kit。無変換 |
| monitor | _premium/監視中_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _?_ | _?_ | _?_ | _TBD_ | premium 候補（未入手） |
| keyboard | _premium/監視中_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _?_ | _?_ | _?_ | _TBD_ | premium 候補（未入手） |
| mouse | _premium/監視中_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _?_ | _?_ | _?_ | _TBD_ | premium 候補（未入手） |

> premium / candidates の素材を入れたら、上の表へ **1 行追記**してください（`?` のまま放置しない）。
> 優先度B slot（`mug` `book` `notebook` `desk_lamp` `speaker` `smartphone` `pen_stand` `plant`）も同様。
> CC0 でない素材（例 CC-BY）は `attribution required: yes` とし、表示文言を notes に明記すること。

---

## 詳細（provenance）

同梱GLB（basic）は全て **CC0 1.0 Universal**（パブリックドメイン）です。
法的な帰属表示は不要ですが、出所の記録として残します。

### desk.glb （slot: desk / set: basic）

- **Asset name**: Desk
- **Author**: Kenney (kenney.nl)
- **Source URL**: https://poly.pizza/m/6PbVkqPzEU
- **Original source**: https://kenney.nl/assets/furniture-kit
- **License**: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- **Required attribution**: None (CC0)
- **Download date**: 2026-06-10
- **Original file format**: GLB (GLTF binary)
- **Converted file path**: public/models/props/desk.glb (no conversion needed)

### chair.glb （slot: chair / set: basic）

- **Asset name**: Desk Chair
- **Author**: Kenney (kenney.nl)
- **Source URL**: https://poly.pizza/m/CKSz6PB1vO
- **Original source**: https://kenney.nl/assets/furniture-kit
- **License**: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- **Required attribution**: None (CC0)
- **Download date**: 2026-06-10
- **Original file format**: GLB (GLTF binary)
- **Converted file path**: public/models/props/chair.glb (no conversion needed)

### laptop.glb （slot: laptop / set: basic）

- **Asset name**: Laptop
- **Author**: Kenney (kenney.nl)
- **Source URL**: https://poly.pizza/m/GnbwSUiVty
- **Original source**: https://kenney.nl/assets/furniture-kit
- **License**: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- **Required attribution**: None (CC0)
- **Download date**: 2026-06-10
- **Original file format**: GLB (GLTF binary)
- **Converted file path**: public/models/props/laptop.glb (no conversion needed)

### premium props （未入手 — 入れたらここへ追記）

テンプレ（コピーして使う）:

```
### <file>.glb （slot: <slot> / set: premium）
- Asset name:
- Author:
- Source URL:
- Original source:
- License:                     # CC0 / CC-BY-4.0 / その他（明記）
- Required attribution:        # CC-BY なら表示文言をそのまま書く
- Commercial use:              # yes / no
- Redistribution allowed:      # yes / no  ← no や不明は public 配下に入れない
- Download date:
- Original file format:
- Converted file path:
- Notes:
```
