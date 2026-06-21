# UI↔App 統合 + 実データ化 実装レポート (2026-06-19)

スケジュールタスク「tougou」の自動実行による実装レポート。計画は
[INTEGRATION_PLAN_2026-06-19.md](INTEGRATION_PLAN_2026-06-19.md) に基づく。
**3D 部 (`01_wallpaper`) には一切手を加えていない。**

---

## 1. 何を作ったか（サマリ）

companion(03) を「設定・データの唯一の真実(source of truth)」とし、UI部(02)が
そこからライブで設定・データを受け取って描画する構成に作り替えた。

1. **UI部↔app部の接続** … 02 が起動時/定期に companion の HTTP API から
   表示設定(layout/settings)とライブデータ(news/ai/spotify/memo)を取得して描画。
   02 側のスライダー変更は companion に書き戻され永続化される。companion 未起動時は
   従来通り localStorage / mock にフォールバック（単体動作は壊れない）。
2. **プリセット機能** … 表示設定を名前付きで 保存／適用／名前変更／削除／上書き。
   companion の新「表示」タブで管理。適用すると 02 にライブ反映される。
3. **実データ化** …
   - 天気: open-meteo（キー不要）→ **実データ・検証済**
   - ニュース: RSS（NHK 主要 既定、追加可）→ **実データ・検証済**
   - AI: OpenAI / Google Gemini（設定でキー投入）→ **実装済**（キーが要るため未通信検証）
   - Spotify: now-playing（refresh_token で更新）→ **実装済**（認可が要るため未通信検証）
4. **内部実装** … TODO / メモ / ブックマーク を永続 CRUD 化（ダミー配列を撤去）。
   チャット履歴・設定・シークレットもディスク永続化。

---

## 2. バックエンド (03_companion / Rust + axum) — 新規・改修

| ファイル | 内容 |
|----------|------|
| `src-tauri/src/models.rs` | データ型を全面拡張。`UiState`(layout/settings/presets/activePresetId)、`UiPreset`、`AppSettings`(weather/news/ai/spotify 公開設定)、`Secrets`(非公開・/api/state に出さない)、weather/spotify/news 型を実データ向けに拡張 |
| `src-tauri/src/state.rs` (新) | `AppState`(公開state + secrets + data_dir + reqwest client + spotifyトークンキャッシュ)。`<data_dir>/tohoku-companion/companion-data.json` への load/persist。初回起動時に既定ブックマーク投入 |
| `src-tauri/src/services.rs` (新) | 外部連携の純関数群。open-meteo / 自前RSSパーサ(quick-xml不要) / OpenAI / Gemini / Spotify(トークン更新+now-playing)。**Mutex を await 跨ぎで保持しない**設計 |
| `src-tauri/src/tasks.rs` (新) | バックグラウンドポーリング（天気=10分 / ニュース=15分 / spotify=15秒） |
| `src-tauri/src/api.rs` | スタブを全廃し実ハンドラ化。`build_router()` を分離（テスト共有）。下記API |
| `src-tauri/src/lib.rs` | store ロード→共有state、API+ポーラ起動。モジュール公開化 |
| `src-tauri/Cargo.toml` | `reqwest`(rustls-tls), `dirs`, `base64` 追加 |

### API（実装済み・全て稼働）
```
GET  /api/health, /api/state
GET/PUT /api/ui                         # 表示設定(layout/settings)
GET /api/presets  POST /api/presets     # 保存(現在のuiをスナップショット)
PUT /api/presets/:id (名前変更/上書き)  DELETE /api/presets/:id
POST /api/presets/:id/apply             # 適用→activePresetId 設定
GET/PUT /api/settings                   # 公開設定(merge更新)
GET /api/secrets/status  PUT /api/secrets   # 鍵の有無のみ公開 / 書込みは write-only
GET/POST /api/todos      PATCH/DELETE /api/todos/:id
GET/POST /api/memos      PATCH/DELETE /api/memos/:id
GET/POST /api/bookmarks  PATCH/DELETE /api/bookmarks/:id
POST /api/chat/send  GET /api/chat/history  POST /api/chat/clear
GET /api/news     POST /api/news/refresh
GET /api/weather/current  POST /api/weather/refresh
GET /api/spotify/now-playing  POST /api/spotify/refresh
```

> 注: 計画段階の `/api/bookmarks/:id/open` は実装しなかった。リンクオープンは
> Tauri opener プラグインでフロント側から開くのが適切なため（既存挙動を踏襲）。

### セキュリティ設計
- APIキー・Spotifyシークレット・refresh_token は `Secrets` に保持し、
  **`/api/state` には決して含めない**（テストで `sk-test` が state 応答に出ないことを検証）。
- `secrets/status` は真偽値のみ返す。フロントの鍵入力欄は write-only（空欄=変更なし）。

---

## 3. フロントエンド

### 3-1. companion (03) — タブをAPI接続化
- `src/api.ts` (新) … localhost API クライアント（型付き）。
- `TabChat` … 履歴ロード＋送信（バックエンドが OpenAI/Gemini を実呼び出し）。履歴消去。
- `TabTodo` / `TabMemo` / `TabBookmark` … ダミー撤去、実 CRUD（楽観更新＋失敗時リロード）。
- `TabSettings` … AIプロバイダ/モデル/プロンプト、各種APIキー(有無バッジ付)、Spotify、
  天気の緯度経度/表示名/JMA、ニュースRSS(改行区切り)/最大件数 を保存。
- `TabStatus` … `/api/state` から Spotify/AI/天気ソース/ニュース件数を実表示。「データ更新」ボタン。
- `TabDisplay` (新) … **プリセット管理**（保存/適用/上書/名前変更/削除、適用中はハイライト）。
- `icons.tsx`/`App.tsx`/`App.css` … 表示タブ追加・select/textarea・preset 一覧のスタイル。

### 3-2. overlay (02) — companion からライブ受信
- `src/services/companionClient.ts` (新) … `/api/state`・`/api/ui` 取得、`/api/ui` への push。全てタイムアウト付きで失敗時 null（→フォールバック）。
- `src/hooks/useCompanionData.ts` (新) … 5秒ポーリングで news/ai/spotify/memo を供給。
- `src/App.tsx` …
  - パネル(News/Music/Ai/Memo)に live データを props 注入（offline/空なら既存 mock 既定値）。
  - **設定同期**: 起動時に companion の設定を採用。activePresetId 変化時に再採用（=プリセット適用がライブ反映）。ローカル変更は 600ms デバウンスで push（採用直後の echo は skip）。

---

## 4. 検証結果（すべて実行・合格）

| 対象 | コマンド | 結果 |
|------|----------|------|
| Rust バックエンド | `cargo check` | ✅ pass（警告0） |
| Rust ユニット/結合 | `cargo test` | ✅ 3 tests pass |
| companion 前面 | `npm run build` (tsc + vite) | ✅ build OK |
| overlay 前面 | `npm run build` (tsc -b + vite) | ✅ build OK |
| 天気API実到達 | node fetch open-meteo | ✅ current 取得 |
| ニュースRSS実到達 | node fetch NHK cat0.xml | ✅ item×7 / タイトル取得 |

### 結合テスト (`tests/api_test.rs`) が捉えた実バグ
param ルートが axum 0.8 構文 `/{id}` で書かれていたが、解決された axum は **0.7.9**
（捕捉は `:id`）。そのため todos/memos/bookmarks/presets の **個別操作ルートが一切
マッチしていなかった**。`:id` へ修正し、結合テスト（todo CRUD・preset 保存/適用/名前変更/削除・
secrets 非漏洩）が全合格。一時ディレクトリを使い実ユーザーデータには触れない。

---

## 5. 未完了 / 要ユーザー操作

- **AI 実通信**: OpenAI/Gemini はコードパス実装済みだが、鍵がないため実応答は未検証。
  設定タブでプロバイダ選択＋キー投入で動作する想定。
- **Spotify 実通信**: client_id/secret/refresh_token を設定すれば now-playing 取得。
  refresh_token 取得（OAuth 認可コードフロー）は別途必要。現状は手動で貼り付ける方式。
- **02 の詳細設定UIの companion 移植**: 細かいスライダー群は引き続き 02 の設定パネルで操作する
  （結果は companion に保存）。フル GUI を companion 側へ複製するのは今回の範囲外（プリセット
  管理は companion 側に新設済み）。
- **Tauri ウィンドウの実起動**: GUI 実行は本自動タスク環境では行っていない。検証はビルド＋
  HTTP 結合テスト＋実エンドポイント到達確認で代替。

## 6. 次の一歩（推奨）
1. companion を `npm run tauri dev` で起動し、02 と並べて手動E2E（プリセット適用→壁紙反映）。
2. Spotify OAuth 認可フロー（PKCE）を companion 内に実装し refresh_token を自動取得。
3. `/ws/events`（WebSocket push）で 02 のポーリングを置き換え（B-6）。
4. シークレットを data_dir 平文JSONから OS keyring / Tauri Stronghold へ移行。
