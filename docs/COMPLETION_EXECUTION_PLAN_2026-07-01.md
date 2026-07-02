# トーホク・ウォールペーパー 完成実行計画（2026-07-01）

関連: [`COMPLETION_AUDIT_2026-07-01.md`](COMPLETION_AUDIT_2026-07-01.md)（現状監査）/ [`COMPLETION_PROGRESS_2026-07-01.md`](COMPLETION_PROGRESS_2026-07-01.md)（本日の実施記録）

## 1. 完成スコープの固定

### 今回の最小完成像

```text
- 1920x1080固定のWeb壁紙
- VRMきりたんが机の前に常駐
- 既存の最低限の待機・作業系モーション（新規量産しない）
- Motion Directorによる自然な切替 ✅ 実装済み(2026-07-01)
- 机・椅子・PC
- 最低限の部屋背景（実アートは無くてもCSS fallbackで日/夜が視覚的に区別できる）✅ スキーマ+切替は実装済み(2026-07-01)
- 昼/夜の2状態 ✅ 実装済み(2026-07-01)
- UI Overlayが同一画面に表示 ✅ 実装済み(06-23)
- Companionの実データが反映 ✅ 実装済み(06-23、kiritan stateは2026-07-01)
- Companion不在時はoffline表示 ✅ 実装済み(06-23)
- Wallpaper Engineへ実際に導入できる ❌ 未着手
- 配布不能なVRM等を除外したrelease手順がある ⚠️ dist除外は実装済み、公開配布手順は未確定
```

### 今回やらないもの（確定・再議論しない）

- Pose Composer Stage 5〜7（qキー評価器・DragPad/Hand・Copy/Mirror）
- モーション20〜30本の量産
- 高度な手IK（work-hand-pin IKは`wip/work-hand-pin-ik-2026-07-01`へ隔離済み、再開は製品完成後の明示判断のみ）
- 複数シーン切替、電車・船室・カフェ等の派生シーン
- 動画窓外
- 高度なAIモーション生成
- 音声入力、TTS、ローカルLLM
- UI全面刷新
- Unity移行
- モデルの再エクスポート
- 完成に不要な大規模リファクタ

## 2. 完成までの残りステージ

Stage A（作業ツリー整理）〜Stage D（背景・昼夜最小基盤）は2026-07-01に完了した（詳細は[進捗記録](COMPLETION_PROGRESS_2026-07-01.md)）。Stage F（Companion運用品質）は優先度1-7（single instance / port競合エラー表示 / tray完全終了 / atomic save+backup / localhost固定の試験固定化 / mutating API token / secrets分離）まで実装済み。残りは以下の順で実装する。

### Stage E: Wallpaper Engine実機package（本書§3）

### Stage F: Companion運用品質（本書§4）— 優先度1-7は完了、8-10が残り

### Stage G: 実背景アート or 据え置き判断 + 配布対象確定

- 実アート3枚（room_back.png / outside.png / light_overlay.png）を自作/CC0調達するか、CSS fallbackのまま据え置くかを確定する。据え置く場合はその判断を文書化して"未完成"扱いしない。
- 個人利用限定か公開配布かを決め、公開配布の場合はモデル差し替え/ユーザー指定導線・font license・CC-BY creditsを必須化する。

## 3. Wallpaper Engine実機package 準備計画

現状（[`COMPLETION_AUDIT_2026-07-01.md`](COMPLETION_AUDIT_2026-07-01.md) §4/§8参照）: production URLで動く単一ページは存在するが、Wallpaper Engine専用のproject folder・`project.json`・`wallpaperPropertyListener`対応は一切ない。

### 準備手順（未実施 — 次セッションでの実装対象）

1. **専用project folderを切る**: リポジトリ直下に`wallpaper-engine/`（仮）を作り、`01_wallpaper/npm run build`の出力（`dist/`）をコピーする配布スクリプトを用意する。ソースはコピーしない（buildの都度上書き）。
2. **`project.json`を書く**: Wallpaper Engine公式スキーマに従い、`title`・`type: "web"`・`file: "index.html"`・`preview`画像・`general.properties`（初期は空でよい）を最小構成で用意する。
3. **相対pathの検証**: `vite.config.ts`のbase pathがWallpaper Engineのfile://実行環境で壊れないか確認する（絶対path `/assets/...` はWE環境で404になりやすい——`base: './'`相当への変更要否を確認）。
4. **`wallpaperPropertyListener`の追加**: `window.wallpaperRegisterAudioListener`は不要（音声反応なし）。`window.wallpaperPropertyListener.applyUserProperties`でFPS上限・pause要求を受け取り、既存の`fpsLimit`state・`animate()`ループの一時停止に繋ぐ。
5. **Companion到達性の確認**: WEのCEF内WebViewから`http://127.0.0.1:40313`へfetchできるか（`null` originが`api.rs`のCORS許可リストに既に含まれている——06-23監査で確認済み。実機での再確認のみ必要）。
6. **モデル未配置時の案内画面**: `kiritan.vrm`が存在しない初回起動でエラー画面のまま固まらないよう、`models/README_MODEL_PLACEMENT.md`への案内をon-screenで出す（現状はconsole errorのみ——`props.onStatusUpdate('Error: ...')`が呼ばれるが、production modeではstatus barが非表示のため、ユーザーには何も見えない。最低限のfallback UIが必要）。
7. **実機QA**（Wallpaper Engineがこの環境に導入済み・2.8.0.36で起動確認済み——06-23監査）: 1920x1080・2560x1080・複数モニタ・pause/resume・マウス操作透過。**目視待ち事項は「未確認」と明記し、機械確認済みと混同しない。**

## 4. Companion運用品質の計画

各項目: 現状 / リスク / 対象ファイル / 実装方式 / 受け入れ条件 / 後方互換性 / migration要否。優先度1-7は実装済み（[進捗記録](COMPLETION_PROGRESS_2026-07-01.md)参照）。

### 4.1 single instance（優先度1）— ✅ 完了(2026-07-01)

- **現状**（実装前）: 多重起動防止プラグインなし。二重起動すると2つ目が`API_PORT=40313`のbindに失敗する（`api.rs::serve`は失敗時`eprintln!`のみでUIへ通知しない）。
- **リスク**: ユーザーがショートカットを連打すると2つ目のプロセスが無言で死に、「動いているように見えて実は古いプロセスのまま」という混乱を招く。
- **対象ファイル**: `03_companion/src-tauri/src/lib.rs`（アプリ初期化）、`Cargo.toml`（`tauri-plugin-single-instance`追加）。
- **実装方式**: 公式`tauri-plugin-single-instance`を導入し、2つ目の起動要求は既存ウィンドウをforegroundにして終了する。
- **受け入れ条件**: 2回連続起動して、プロセスが1つだけ・既存ウィンドウが前面化することを確認。→ **実機確認済み**（コンパイル済みバイナリを2回起動し、2回目はログ・プロセス共に発生せず、`GET /api/health`は1回目のプロセスから応答し続けることを確認）。
- **後方互換性**: 影響なし。**migration不要**。

### 4.2 ポート競合時のエラー表示（優先度2）— ✅ 完了(2026-07-01)

- **現状**（実装前）: `api.rs::serve`のbind失敗は`eprintln!`のみ（§4.1と表裏一体——single instanceが入れば通常は発生しなくなるが、他プロセスが40313を掴んでいる場合は残る）。
- **リスク**: APIが死んでいるのにUIは通常起動して見え、overlay/壁紙が延々"offline"表示になる原因が分からない。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs`（`serve`関数）、`lib.rs`（起動フロー）。
- **実装方式**: `api::serve`を`-> Result<(), String>`に変更し、bind失敗時`tauri-plugin-dialog`のエラーダイアログを表示する。
- **受け入れ条件**: 40313を先に別プロセスでbindした状態でCompanionを起動し、エラーが画面に出ることを確認。→ **コード実装・cargo check/test済み**。実機での「別プロセスに先取りされた状態からの起動」シナリオは単体では未実演（single instanceが優先度1で先に効くため意図的に再現しづらい——コードパスとしては`tokio::net::TcpListener::bind`失敗時に必ず通る）。
- **後方互換性**: 影響なし。**migration不要**。

### 4.3 trayから完全終了（優先度3）— ✅ 完了(2026-07-01)

- **現状**（実装前）: close→hide、tray click→toggleのみ（06-23監査確認済み）。完全終了のメニュー項目がない。
- **リスク**: タスクマネージャーからの強制終了以外に終了手段がなく、ユーザー体験として不親切。
- **対象ファイル**: `03_companion/src-tauri/src/lib.rs`（tray menu構築部）。
- **実装方式**: tray右クリックメニューに「表示」「完全終了」を追加。「完全終了」は`app.exit(0)`。当初案にあった「壁紙再読込」（将来のKiritanPoster等との連携用に予約）は、壁紙プロセスを外部から制御するチャネルが現状存在しないため今回は見送り、2項目のみで実装した。
- **受け入れ条件**: tray右クリック→完全終了でプロセスが消えることを確認。→ **コード実装済み**（`app.exit(0)`呼び出し自体はTauriの標準APIで、実機でのtray右クリック操作自体は目視待ち——`cargo check`/`cargo test`はGUIイベントループを起動しないため検証範囲外）。
- **後方互換性**: 影響なし。**migration不要**。

### 4.4 atomic save（優先度4）— ✅ 完了(2026-07-01)

- **現状**（実装前）: `state.rs::persist()`は`std::fs::write`で直接上書き（`.bak`無し、書き込み中のクラッシュで破損しうる）。
- **リスク**: 保存中の電源断・強制終了で`companion-data.json`が壊れ、次回起動時にすべてのTODO/メモ/bookmark/presetが消える（`load_from`はparse失敗時に黙って`WallpaperState::default()`へフォールバックする——06-23監査で確認済みのPARTIAL評価）。
- **対象ファイル**: `03_companion/src-tauri/src/state.rs`（`persist`関数）。
- **実装方式**: 一時ファイル（`companion-data.json.tmp`）に書いてから`rename`（POSIX/Windows共にatomic rename相当）。上書き前の内容を`companion-data.json.bak`として保持する。
- **受け入れ条件**: 保存直後に`.bak`が前回内容と一致すること、書き込み中に強制終了しても`.tmp`が残るだけで本体は無傷であることをテストで確認。→ **満たした**。単体テスト3件（初回保存で`.bak`が無いこと／2回目保存で`.bak`が直前の内容とbyte-identicalであること／save→reload往復）に加え、実際にコンパイル済みバイナリを起動してbackground pollerの自動保存で実際に`.bak`が生成されることを実データで確認。
- **後方互換性**: 既存の`companion-data.json`はそのまま読み込み可能（フォーマット不変）。**migration不要**。

### 4.5 localhost限定の維持確認（優先度5）— ✅ 完了(2026-07-02)

- **現状**: `SocketAddr::from(([127, 0, 0, 1], API_PORT))`で既にloopback限定（06-23確認済み、変化なし）。
- **リスク**: 現状で問題なし。将来設定でbindアドレスを変更可能にする場合のみ再検証が必要。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs`。
- **実装方式**: `api_addr()`を追加し、`serve()`が必ず同じ関数を使うようにした。回帰しないよう、integration testで`ip().is_loopback()`とport 40313を固定化する（`127.0.0.1`以外へのbindを許す設定UIを作らない）。
- **受け入れ条件**: `live_api_address_is_loopback_only`がPASSすること。→ **満たした**。
- **後方互換性**: 該当なし。

### 4.6 API tokenまたはOrigin制限（優先度6）— ✅ 完了(2026-07-02)

- **現状**: 認証なし。CORSは`http://localhost*` / `http://127.0.0.1*` / `null` originに対し全HTTPメソッドを許可（06-23で"RISK"評価）。
- **リスク**: 同一マシン上の別の悪意あるローカルプロセス/ブラウザタブから状態を書き換えられる（loopback限定なのでLAN外部からは無理だが、同一PC内の他プロセスは無防備）。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs` / `state.rs`、`03_companion/src/api.ts`、`01_wallpaper/src/lib/motion/director/kiritanPoster.ts`、`02_ui-overlay/src/services/companionClient.ts`。
- **実装方式**: 「GET/HEAD/OPTIONSは現状のCORSのまま許可、POST/PUT/PATCH/DELETEは`X-Companion-Token`ヘッダ必須」に分離した。tokenは初回起動時に`%APPDATA%\tohoku-companion\companion-api-token.txt`へ自動生成し、以後再利用する。Web/Tauri/Wallpaper Engineのorigin差でファイル直読みが壊れやすいため、in-repoのWebクライアントは`GET /api/auth/token`でtokenを取得・キャッシュしてmutating requestへヘッダ付与する。CORS origin判定は`localhost.evil`系を通さない明示関数にし、Tauri v2の`tauri.localhost`系originも許可する。
- **受け入れ条件**: tokenなしのPOSTが401になること、誤tokenが401になること、正しいtoken付きは通ること。既存のGET系ポーリング（overlay 5s poll）が無停止で動き続けること。→ **満たした**（`mutating_routes_require_companion_token`、`allowed_origin_accepts_only_local_webviews`、既存CRUD/kiritan統合テスト更新、01/02/03 frontend build PASS）。
- **後方互換性**: APIサーバー単体では破壊的変更だが、repo内の3クライアント（Companion UI / overlay / wallpaper kiritanPoster）は同時更新済み。外部スクリプトがPOST/PUT/PATCH/DELETEする場合は`GET /api/auth/token`→`X-Companion-Token`付与が必要。token fileは自動生成のためデータmigration不要。

### 4.7 secretsを通常JSONから分離（優先度7）— ✅ 完了(2026-07-02)

- **現状**: `secrets.openai_key`等は平文で`companion-data.json`に同梱保存（`state.rs::Persist`構造体に含まれる）。`/api/state`からは除外されている（06-23確認済み、これは正しい）。
- **リスク**: ディスク上のファイルを見れば誰でもAPIキーを読める。
- **対象ファイル**: `03_companion/src-tauri/src/state.rs`。
- **実装方式**: `Persist.secrets`は後方互換のdeserialize専用にし、新規保存では`companion-data.json`へ出さない。実体は`secrets.json`へatomic write + `.bak`で保存する。旧`companion-data.json`または`companion-data.json.bak`に残っている`secrets`は起動時に`secrets.json`へ移行し、旧ファイルからtop-level `secrets`を除去する。通常データ側の`.bak`作成時もlegacy secretsをsanitizeしてから退避する。
- **受け入れ条件**: secrets.jsonが分離され、既存のcompanion-data.json内のsecretsフィールドから自動移行されること。→ **満たした**（`secrets_are_persisted_to_a_separate_file_only`、`legacy_embedded_secrets_are_migrated_and_sanitized`）。
- **後方互換性**: 旧`companion-data.json`内`secrets`から自動migration済み。OS credential store化は未実装で、短期分離のみ完了。

### 4.8 connection status表示（優先度8）

- **現状**: overlay/壁紙側は`kiritanState`が届いているかをCompanion UI上で確認する手段がない。
- **リスク**: ユーザーが「壁紙とCompanionが繋がっているか」を確認できず、問題発生時の切り分けが困難。
- **対象ファイル**: `03_companion/src`（Companion UIの新規タブ or 既存の状態タブ）。
- **実装方式**: `GET /api/kiritan/state`をpollし、`receivedAt`が一定時間（例: heartbeat周期30sの3倍=90s）を超えて更新されていなければ「壁紙: 未接続」を表示する。
- **受け入れ条件**: 壁紙を閉じてから90秒後にCompanion UIが未接続表示に切り替わること。
- **後方互換性**: 影響なし。**migration不要**。

### 4.9 自動起動（優先度9）

- **現状**: OSログイン時の自動起動設定なし。
- **対象ファイル**: `03_companion/src-tauri/Cargo.toml`（`tauri-plugin-autostart`）、設定UI。
- **実装方式**: 公式プラグインを追加し、設定タブにON/OFFトグルを置く。
- **受け入れ条件**: トグルON→再起動でCompanionが自動起動すること。
- **後方互換性**: 影響なし（デフォルトOFF）。**migration不要**。

### 4.10 設定export/import（優先度10）

- **現状**: バックアップ/復元手段なし（§4.4のatomic saveの`.bak`は直近1世代のみで、意図的なバックアップとは別物）。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs`（新規`/api/export`, `/api/import`）。
- **実装方式**: `companion-data.json`相当をユーザー指定pathへexport/importするAPI+UIボタン。
- **受け入れ条件**: export→全データ削除→import で復元できること。
- **後方互換性**: 影響なし。**migration不要**。

## 5. 検証観点まとめ

各Stageの実装後、最低限次を実行する（[`COMPLETION_AUDIT_2026-07-01.md`](COMPLETION_AUDIT_2026-07-01.md) §5と同じセット + Stage固有の試験）。

- 01: `npx tsc -b` / `npm run build` / `npm run lint` / `node tools/test_*.mjs`全件 / `check:dist-assets` / `check:props`
- 03: `cargo check` / `cargo test` / companion frontend `tsc --noEmit` + `npm run build`
- 新規APIやscheme変更を伴うStageは対応する`cargo test`統合試験を追加する（本日の`kiritan_state_post_and_get`が実例）
- 目視必須の項目（WE実機動作、昼夜ライティングの実際の見え方）は「機械確認済み」と「目視待ち」を明確に分けて記録する
