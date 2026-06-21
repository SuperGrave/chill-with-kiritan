# UI↔App 統合 + 実データ化 実装計画 (2026-06-19)

## 背景

きりたん壁紙アプリは 3 つに分かれている。

| 役割 | フォルダ | 内容 |
|------|----------|------|
| html UI 部 | `02_ui-overlay/` | 壁紙に重ねる表示 UI（見た目のみ・設定は localStorage） |
| 3D モデル表示部 | `01_wallpaper/` | VRM レンダラ＋モーション（**今回は対象外＝触らない**） |
| app 部（入力担当） | `03_companion/` | Tauri 操作窓 + localhost HTTP API（B-0〜B-2 まで実装済・以降スタブ） |

## ゴール

1. **UI 部(02) と app 部(03) を接続**し、これまで 02 が localStorage で持っていた **各種表示設定を 03(companion) から行えるようにする**。
2. 表示設定に **プリセット機能**（保存・名前変更・削除・適用）を設ける。
3. AI / ニュース / Spotify など **ダミーを実データに**置き換える。
4. その他、内部実装可能な部分（TODO/メモ/ブックマークの永続 CRUD 等）を計画的に実装する。
5. **3D 部は対象外。**

## アーキテクチャ決定

**companion(03) を「設定・データの唯一の真実(source of truth)」にする。**

- 03 が表示設定・プリセット・各種データ・シークレット(APIキー)を保持し、localhost API で配信。
- 02 overlay は起動時/定期に `GET /api/state` から **設定とデータを受け取り描画**。companion 未起動時は localStorage / mock にフォールバック（単体動作を壊さない）。
- 02 の設定パネルからの変更は `PUT /api/ui` で 03 に書き戻し、03 が永続化。
- APIキー等シークレットは 03 内のみに保存し、`/api/state` には絶対に出さない。

### 永続化
`<data_dir>/tohoku-companion/companion-data.json`（serde_json）。
保持: `ui`(layout/settings/presets) / `settings`(公開設定) / `secrets` / `todos` / `memos` / `bookmarks` / `chat`。

## API 一覧（03 axum）

```
GET    /api/health
GET    /api/state                     # 公開状態すべて（secrets 除く）

# 表示設定（02 の layout/settings をそのまま JSON で授受）
GET    /api/ui                        # { layout, settings, presets, activePresetId }
PUT    /api/ui                        # { layout, settings } を保存

# プリセット
GET    /api/presets
POST   /api/presets                   # { name, layout, settings } を保存→新規 preset
PUT    /api/presets/{id}              # 名前変更 / 上書き
DELETE /api/presets/{id}
POST   /api/presets/{id}/apply        # preset を現在の ui に適用

# 公開設定 / シークレット
GET    /api/settings                  # weather/news/ai/spotify の公開設定
PUT    /api/settings
GET    /api/secrets/status            # 各キーの有無(bool)のみ
PUT    /api/secrets                   # キー書き込み（write-only）

# データ CRUD
GET/POST            /api/todos        ; PATCH/DELETE /api/todos/{id}
GET/POST            /api/memos        ; PATCH/DELETE /api/memos/{id}
GET/POST            /api/bookmarks    ; PATCH/DELETE /api/bookmarks/{id}
POST               /api/bookmarks/{id}/open

# 実データ
POST   /api/chat/send                 # OpenAI / Gemini 実呼び出し
GET    /api/chat/history ; POST /api/chat/clear
GET    /api/news     ; POST /api/news/refresh        # RSS
GET    /api/weather/current ; POST /api/weather/refresh   # open-meteo
GET    /api/spotify/now-playing ; POST /api/spotify/refresh
```

## 実データ取得方式（キー不要なものは即実データ）

| データ | ソース | キー |
|--------|--------|------|
| 天気 | open-meteo `/v1/forecast` | 不要 |
| ニュース | RSS（NHK 主要 等） | 不要 |
| AI | OpenAI chat/completions or Gemini generateContent | 要(設定で投入) |
| Spotify | `me/player/currently-playing`（refresh_token で更新） | 要(設定で投入) |

キー未設定時は `status:"unconfigured"` を返し UI 側で「未設定」を表示（クラッシュさせない）。
バックグラウンド更新: 天気=10分 / ニュース=15分 / spotify=15秒。

## 実装フェーズ

- **P1** backend: 永続化 store + models 拡張 + settings/secrets + UI設定 + preset CRUD
- **P2** backend: todos/memos/bookmarks CRUD + news(RSS) + weather + AI + spotify + 定期更新
- **P3** companion 前面: api client、各タブ実接続、Display/Preset 管理タブ追加
- **P4** overlay(02): /api/state からライブ受信（news/ai/spotify/memo + ui設定）、フォールバック維持
- **P5** ビルド検証(cargo check / tsc) + レポート

## 非対象

- 01_wallpaper の 3D/モーション
- WebSocket push（B-6・将来）
- OS keyring（当面は data_dir 内 JSON 保存。将来 stronghold へ）
