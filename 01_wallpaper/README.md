# Tohoku Wallpaper Motion Probe 0.7

「ふらすこ式風東北きりたん.vrm」をPC背景として常駐表示するための、最小モーション検証用Probeです。
本ProbeはUIの完成やAPI連携を目的とせず、**VRM表示・モーション・小道具配置基盤**の安定稼働と負荷検証を行います。

> **モーションを作る人（エージェント含む）はまず [`MOTION_AUTHORING_GUIDE.md`](MOTION_AUTHORING_GUIDE.md) を読むこと。**
> `?lab=1` で開くと `window.__motionLab`（著作・検証API）が使えます。

現在は **Motion Probe 0.7（Motion DSL + Motion Lab）到達版**です。0.1〜0.7で以下を実装済み:

- **0.1** — VRM表示 ＋ 呼吸 / まばたき / LookAt / SpringBone、Custom Expression Bridge（このモデル特有のBlendShape問題への対処）
- **0.2** — Idle State Machine（5状態 ＋ 自動遷移 ＋ ポップレス・クロスフェード）
- **0.3** — External Motion（`.vrma` 読み込み ＋ 組み込み手続きクリップ、AnimationMixer ＋ ブレンド）
- **0.4** — Scene / Props Loader（`scene.json` 読み込み、小道具GLB配置、プレースホルダ・フォールバック、ライティング適用）
- **0.5** — Background / Window / Light Overlay（`scene.json` の背景レイヤーをHTML/CSSで実描画、欠損時fallback、ON/OFFトグル）
- **0.6** — Scene Layout Calibration（character/desk/chair/laptop/camera をキー＋ボタンで調整、可視ガイド、作業机向けカメラ候補、現配置の `scene.json` 形式 Export）
- **0.7** — Motion DSL + Motion Lab（`public/motions/dsl/*.motion.json` をアプリ内コンパイルして既存ミキサー経路で再生。`?lab=1` で著作API `window.__motionLab`：タイムライン・スクラブ／PNGキャプチャ保存／数値検証。手順とリグの実測符号表は `MOTION_AUTHORING_GUIDE.md`）

> 注: Companion App / UI_OVERLAY統合 / 天気・ニュース・音楽は未着手です。背景は0.5でHTML/CSSレイヤー描画まで（`windowVideo`・視差は未実装）。0.6の配置調整値は `scene.json` へ**手で反映**する運用（自動保存はしません）。

---

## ⚠ モデルのライセンスと配布についての最重要事項

対象モデル **ふらすこ式風東北きりたん** は **再配布禁止**（`licenseName: Redistribution_Prohibited`、ガイドライン: https://zunko.jp/ ）です。

- **`kiritan.vrm` をリポジトリ／配布パッケージに同梱してはいけません。**
- **`dist/` にもモデルを含めません。** Vite は `public/` を `dist/` に丸ごとコピーするため、`npm run build` の最後に [`scripts/strip-dist-vrm.cjs`](scripts/strip-dist-vrm.cjs) が `dist/**/*.vrm` を自動削除します。
- 配布時は **ユーザー自身が規約に同意の上でモデルを入手し、手動配置**する運用です（[`public/models/README_MODEL_PLACEMENT.md`](public/models/README_MODEL_PLACEMENT.md) を参照）。
- ビルド成果物の安全確認は `npm run check:dist-assets` で行えます（`dist/` に `.vrm` が残っていれば **exit 1** で失敗）。

詳細な監査は [`docs/VRM_MODEL_AUDIT_flasco_kiritan.md`](../docs/VRM_MODEL_AUDIT_flasco_kiritan.md)（リポジトリ・ルートの `docs/`）にあります。

---

## 起動手順

1. **VRMモデルを配置**: `public/models/` に対象VRMを `kiritan.vrm` というファイル名で置く（詳細は下記「アセット配置」）。
2. 依存関係のインストール: `npm install`
3. 開発サーバーの起動: `npm run dev`（既定で `http://localhost:5173` 付近。コンソールに表示されるURLを参照）
4. （任意）本番ビルド: `npm run build` → 成果物は `dist/`。続けて `npm run check:dist-assets` で `.vrm` 非混入を確認。

---

## アセット配置

| 種類 | 置き場所 | 必須 | 備考 |
|------|----------|------|------|
| VRMキャラ本体 | `public/models/kiritan.vrm` | **必須** | **再配布禁止・同梱不可**。ユーザーが手動配置（[README_MODEL_PLACEMENT.md](public/models/README_MODEL_PLACEMENT.md)）。 |
| 小道具GLB (basic) | `public/models/props/*.glb` | 任意 | `desk.glb` / `chair.glb` / `laptop.glb`。同梱分は **CC0**（[ASSET_CREDITS.md](public/models/props/ASSET_CREDITS.md)）。無くてもプレースホルダ箱で代替。 |
| 小道具GLB (premium) | `public/models/props/premium/*.glb` | 任意 | **0.7で受け口準備**。豪華版・追加小道具をユーザーが後から配置（[README_PREMIUM_PROPS.md](public/models/props/premium/README_PREMIUM_PROPS.md)）。 |
| 素材インボックス | `public/models/props/candidates/` | 任意 | 受け入れ・検証前の素材置き場。手順は [README_ASSET_INBOX.md](public/models/props/candidates/README_ASSET_INBOX.md)。 |
| Scene定義 | `public/scenes/<id>/scene.json` | 同梱済 | 既定シーン `room_workdesk_day`。小道具の位置・回転・スケール・可視をJSONで調整（再ビルド不要、`G`で再読込）。 |
| 外部モーション | `public/motions/*.vrma` | 任意 | 既定読込パスは `public/motions/sample_idle.vrma`（[README_MOTION_PLACEMENT.md](public/motions/README_MOTION_PLACEMENT.md)）。 |
| 背景画像 | `public/scenes/<id>/*.png` | 任意 | `room_back.png` / `outside.png` / `light_overlay.png`（**0.5で実描画**）。無くても fallback。詳細は [README_SCENE_ASSETS.md](public/scenes/room_workdesk_day/README_SCENE_ASSETS.md)。 |

ポイント:

- **VRMモデルが無いと起動時に読込エラー表示**になります（手動配置が前提）。
- **小道具GLBが無くてもクラッシュしません** — `fallback: "box"` の小道具は半透明プレースホルダ箱で代替（`"none"` はその小道具のみ非表示）。
- **`scene.json` が壊れている／読めない場合**は組み込みデフォルトシーン（[`src/lib/scene/scenePresets.ts`](src/lib/scene/scenePresets.ts)）へ自動フォールバックし、アプリは落ちません。
- 小道具・背景素材は**ライセンス不明／再配布禁止のものを同梱しないでください**（モデル本体と同方針）。

---

## 小道具モデル: basic / premium / candidates（Premium Props Preparation Pack 0.7）

簡易 CC0 小道具（basic）を、将来の**豪華版モデル**へ安全に差し替え・追加できる基盤です。
**素材は勝手にダウンロード・同梱しません**（ユーザーがライセンス同意のうえ手動配置）。

| 区分 | 置き場所 | 中身 |
|------|----------|------|
| **basic** | `public/models/props/*.glb`（直下） | 同梱の CC0 Kenney 簡易モデル（`desk`/`chair`/`laptop`）。0.7 でも**移動していません**（`scene.json` パス・稼働中の表示を壊さないため） |
| **premium** | `public/models/props/premium/*.glb` | ユーザーが後から入手する豪華版・追加小道具（未同梱）。[README_PREMIUM_PROPS.md](public/models/props/premium/README_PREMIUM_PROPS.md) |
| **candidates** | `public/models/props/candidates/` | 受け入れ・検証前のインボックス。[README_ASSET_INBOX.md](public/models/props/candidates/README_ASSET_INBOX.md) |

- **slot 一覧**（[props.manifest.json](public/models/props/props.manifest.json) と一致）:
  - 優先度A: `desk` `chair` `laptop` `monitor` `keyboard` `mouse`
  - 優先度B: `mug` `book` `notebook` `desk_lamp` `speaker` `smartphone` `pen_stand` `plant`
- **ライセンス台帳**: 全 props を [ASSET_CREDITS.md](public/models/props/ASSET_CREDITS.md) の表へ記録（CC0 最優先 / CC-BY は出典必須 / 再配布禁止・不明は public 配下へ入れない）。
- **premium 反映例**: [scene.premium.example.json](public/scenes/room_workdesk_day/scene.premium.example.json)（**読み込まれない例**。未配置スロットは placeholder 箱に落ちる設計）。
- **検証**: `npm run check:props` … manifest の妥当性・台帳の存在・basic 3 点の存在を確認（basic 欠損や台帳欠損は **exit 1**、premium 欠損は警告のみ）。
- 注: manifest を**実行時に読む実装は 0.7 では未実装**（準備フェーズ）。現状の小道具読み込みは引き続き `scene.json` が駆動します。

---

## 操作一覧（キーボード / 画面内ボタン）

### Camera
| キー | 動作 |
|------|------|
| `1` | Desk（desk wide） |
| `2` | Face（face close） |
| `3` | Side / Monitor Side（monitor side） |

（画面内ボタンに `Free (Orbit)` と作業机向け候補 `WD Front` / `WD Side` / `WD Close`（0.6）あり。既存 1/2/3 は不変）

### Idle Motion
| キー | 動作 |
|------|------|
| `4` | Breath |
| `5` | Monitor |
| `6` | Glance |
| `7` | Sleepy |
| `8` | Smile |
| `R` | Auto Idle ON/OFF |
| `Space` | Idle ON/OFF |

### External Motion（.vrma / 組み込みクリップ）
| キー | 動作 |
|------|------|
| `9` | External Motion ON/OFF |
| `0` | Return to Idle |
| `P` | Play / Stop |

（画面内ボタンに Loop ON/OFF・Crossfade → Clip・Built-in clip / Load .vrma・Clip Weight スライダーあり）

### Scene / Props
| キー | 動作 |
|------|------|
| `V` | Props ON/OFF |
| `C` | Placeholder ON/OFF |
| `G` | Reload Scene（`scene.json` を再読込） |

### Background（0.5）
| キー | 動作 |
|------|------|
| `K` | Background ON/OFF |
| `O` | Light Overlay ON/OFF |

（画面内ボタンに `Fit: cover/contain` 切替あり。背景素材の配置は [README_SCENE_ASSETS.md](public/scenes/room_workdesk_day/README_SCENE_ASSETS.md)）

### Scene Layout Calibration（0.6）
調整対象（character / desk / chair / laptop / camera）を選び、配置を詰めて `scene.json` 形式で Export する。

| キー | 動作 |
|------|------|
| `[` / `]` | 調整対象 前 / 次 |
| `←` `→` | X 移動（camera は Pan X） |
| `↑` `↓` | Z 移動 奥/手前（camera は Pan Z） |
| `PageUp` / `PageDown` | Y 移動 上/下（camera は Pan Y） |
| `Shift`＋`←``→` / `Shift`＋`↑``↓` | 回転 Y（yaw）/ 回転 X（pitch） |
| `+` / `-` | スケール ±（camera は Dolly in/out） |
| `T` | Layout Guides ON/OFF（grid / axes / bbox / 注視点 / 机上面） |
| `Ctrl`＋`S` | 現配置を `scene.json` 形式で Export（textarea 表示＋クリップボード＋console） |

（画面内ボタンに対象選択・各軸 nudge・camera の Pan/Dolly・`Export JSON` あり。ステップ: 位置 0.05 / 回転 5° / スケール ×1.05。
Export 値は `public/scenes/<id>/scene.json` の各 `props[]` / `character` / `camera` に手で転記。`G`（Reload Scene）で scene.json から再 seed）

### Expression
| キー | 動作 |
|------|------|
| `N` | Neutral |
| `J` | Joy |
| `U` | Fun |
| `S` | Sorrow |
| `A` | Angry |
| `B` | Blink ON/OFF（オートまばたき） |

（画面内ボタンに 母音 A/I/U/E/O・Blink_L / Blink_R あり）

### Other
| キー | 動作 |
|------|------|
| `L` | LookAt ON/OFF |
| `M` | SpringBone mode（normal → lightweight → off） |
| `F` | FPS Limit（30fps ⇄ 上限なし） |

---

## npm スクリプト

| コマンド | 内容 |
|----------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | `tsc -b` → `vite build` → `dist/**/*.vrm` を自動削除（再配布禁止モデルの混入防止） |
| `npm run check:dist-assets` | `dist/` に `.vrm` が無いことを検査（あれば exit 1） |
| `npm run check:props` | 小道具レジストリ検査（`props.manifest.json` 妥当性・`ASSET_CREDITS.md` 存在・basic 3点存在。premium 欠損は警告） |
| `npm run preview` | ビルド成果物のプレビュー |
| `npm run lint` | ESLint |

---

## 注意事項 / 既知の制約

- 本Probeは**検証用**で、最終的な壁紙アプリ（常駐・Wallpaper Engine 等）への組み込みは未対応です。
- プレビュータブが背景化されると `requestAnimationFrame` が間引かれるため、モーション/シーンのロジック検証は **Node ヘッドレステスト**で行っています（`.probe_tmp/`、リポジトリには非同梱）。3D 構図の**見た目最終調整は可視ウィンドウでの目視が前提**です。
- `scene.json` の `character` 配置は 0.6 で適用（VRM の +Z 基準回転に合成）、`camera` は作業机向け候補を追加しました（既存 1/2/3 は不変）。背景画像合成（`background.*`）は 0.5 で実描画（`windowVideo`・視差は未実装）。
- 実 props は desk / chair / laptop の 3 点のみで、**モニタ等の小道具は未調達**です（[docs/MOTION_PROBE_0_6_LAYOUT_CALIBRATION_REPORT.md](docs/MOTION_PROBE_0_6_LAYOUT_CALIBRATION_REPORT.md) §7/§8）。
