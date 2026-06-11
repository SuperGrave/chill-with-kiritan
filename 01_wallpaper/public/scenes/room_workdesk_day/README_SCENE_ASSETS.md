# Scene アセットの配置について  (Background Probe 0.5 = Motion Probe 0.5)

このディレクトリ (`public/scenes/room_workdesk_day/`) は **Scene Preset** `room_workdesk_day`
（自室・昼・作業机）の定義と、その背景レイヤー素材を置く場所です。

## scene.json（必須・同梱済み）

`scene.json` が Scene Preset 本体です。アプリ起動時に
`sceneLoader.ts` が `/scenes/room_workdesk_day/scene.json` を fetch して読み込みます。

- 小道具（desk / chair / laptop）の **position / rotation / scale / visible / placeholderColor** を
  JSON で調整できます（再ビルド不要。**Reload Scene** ボタン or `G` キーで再読込）。
- `rotation` は **ラジアン（Euler XYZ）**、`scale` は数値または `[x, y, z]`。
- `fallback` が `"box"` の小道具は、GLB が無いときに **半透明プレースホルダ箱** を出します
  （`"none"` ならその小道具だけ非表示）。
- `scene.json` が壊れている／読めない場合は **built-in default scene**（`scenePresets.ts`）に
  自動フォールバックし、アプリは落ちません。

## 背景画像（任意・未同梱）→ **0.5 から実描画されます**

`scene.json` の `background` ブロックを、**0.5（Background Probe）から実際に描画**します。
描画は three.js ではなく **HTML/CSS レイヤー**で行い、透明な three.js canvas の**背後**に重ねます。

```jsonc
"background": {
  "roomImage":    "/scenes/room_workdesk_day/room_back.png",   // 部屋の壁・窓枠・床奥
  "outsideImage": "/scenes/room_workdesk_day/outside.png",     // 窓の外（風景）
  "lightOverlay": "/scenes/room_workdesk_day/light_overlay.png",// 光・日差し・色味（透明PNG）
  "windowVideo":  null                                          // 窓外を動画にする受け口（未実装）
}
```

### レイヤー構成（奥 → 手前）

| 重なり | scene.json キー | ファイル名（例） | 用途 |
|--------|-----------------|------------------|------|
| 最奥   | `background.outsideImage` | `outside.png`       | 窓の外の景色（room の窓部分から覗く） |
| 中     | `background.roomImage`    | `room_back.png`     | 部屋の奥・壁・窓枠・床奥。**窓部分を透明にすると outside が覗く** |
| 手前   | `background.lightOverlay` | `light_overlay.png` | 日差し・グレア・色味。**透明PNG**で上に乗せる |
| —      | `background.windowVideo`  | （動画）            | 窓外を動画にする受け口（現状 `null`・未実装） |

> この上にさらに three.js canvas（VRM + 小道具）→ UI/デバッグ の順で重なります。

### 推奨スペック

- **解像度: 1920×1080（フルHD）PNG** を基準に作成してください（将来の壁紙化を見据えた基準）。
- 表示は既定で `background-size: cover`（**アスペクト比を保ったまま画面を満たす**・はみ出しはトリミング）。
  プレビューウィンドウが小さくても歪みません。`Fit` ボタンで `cover` / `contain` を切替可能。
- `room_back.png`: 窓の部分を**透明（アルファ）**にすると、その奥の `outside.png` が見えます。
- `light_overlay.png`: **必ず透明PNG**（透明部分はそのまま下のレイヤーが見える）。不透明だと背景を覆ってしまいます。
- `outside.png`: 不透明でOK（最奥なので）。

### 画像が無い場合（fallback・落ちません）

各画像はプリロードして存在判定し、**無い／壊れている場合は fallback**します（アプリは落ちません）。

| 欠損したもの | fallback |
|--------------|----------|
| `roomImage` 欠損   | 暗いグラデーション背景（薄暗い部屋） |
| `outsideImage` 欠損 | 窓外風の青／夜色グラデーション |
| `lightOverlay` 欠損 | **透明扱い**（何も乗せない） |

画面のデバッグ表示（左の Controls / 下の status）に状態が出ます:

```
BG: ON | room fallback | outside fallback | light none | Light ON | fit cover
```

実画像を置いて `G`（Reload Scene）すると `room ok` / `outside ok` / `light ok` に変わります。
`K`= Background ON/OFF、`O`= Light Overlay ON/OFF で表示を切り替えられます。

## ライセンス（重要）

- 背景画像・小道具モデルは各配布元の規約に従ってください。
- **再配布不可・ライセンス不明の素材は同梱しないでください**（VRM モデル本体と同じ方針）。
- 推奨は次のいずれか:
  - **自作素材**（自分で描いた／撮影した／レンダリングした画像）
  - **CC0（パブリックドメイン）素材**（出典を `ASSET_CREDITS` 等に記録）
  - **AI 生成素材**（利用する生成サービスの規約・商用可否を確認の上で）
- まずは**仮画像**（単色やラフなグラデーションを書き出したPNG）で構図合わせをして構いません。

## ユーザーが後で用意する素材（このディレクトリ）

```
public/scenes/room_workdesk_day/room_back.png      # 1920x1080 推奨・窓部分を透明に
public/scenes/room_workdesk_day/outside.png        # 1920x1080 推奨・窓外の景色
public/scenes/room_workdesk_day/light_overlay.png  # 1920x1080 推奨・透明PNG（光/色味）
```
