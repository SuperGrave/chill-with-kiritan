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

Stage A（作業ツリー整理）〜Stage D（背景・昼夜最小基盤）は2026-07-01に完了した（詳細は[進捗記録](COMPLETION_PROGRESS_2026-07-01.md)）。残りは以下の順で実装する。

### Stage E: Wallpaper Engine実機package（本書§3）

### Stage F: Companion運用品質（本書§4）

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

各項目: 現状 / リスク / 対象ファイル / 実装方式 / 受け入れ条件 / 後方互換性 / migration要否。

### 4.1 single instance（優先度1）

- **現状**: 多重起動防止プラグインなし。二重起動すると2つ目が`API_PORT=40313`のbindに失敗する（`api.rs::serve`は失敗時`eprintln!`のみでUIへ通知しない）。
- **リスク**: ユーザーがショートカットを連打すると2つ目のプロセスが無言で死に、「動いているように見えて実は古いプロセスのまま」という混乱を招く。
- **対象ファイル**: `03_companion/src-tauri/src/lib.rs`（アプリ初期化）、`Cargo.toml`（`tauri-plugin-single-instance`追加）。
- **実装方式**: 公式`tauri-plugin-single-instance`を導入し、2つ目の起動要求は既存ウィンドウをforegroundにして終了する。
- **受け入れ条件**: 2回連続起動して、プロセスが1つだけ・既存ウィンドウが前面化することを確認。
- **後方互換性**: 影響なし。**migration不要**。

### 4.2 ポート競合時のエラー表示（優先度2）

- **現状**: `api.rs::serve`のbind失敗は`eprintln!`のみ（§4.1と表裏一体——single instanceが入れば通常は発生しなくなるが、他プロセスが40313を掴んでいる場合は残る）。
- **リスク**: APIが死んでいるのにUIは通常起動して見え、overlay/壁紙が延々"offline"表示になる原因が分からない。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs`（`serve`関数）、`lib.rs`（起動フロー）。
- **実装方式**: bind失敗時、Tauriのnative dialog（`tauri-plugin-dialog`）でエラーを表示するか、メインウィンドウに固定バナーを出す。
- **受け入れ条件**: 40313を先に別プロセスでbindした状態でCompanionを起動し、エラーが画面に出ることを確認。
- **後方互換性**: 影響なし。**migration不要**。

### 4.3 trayから完全終了（優先度3）

- **現状**: close→hide、tray click→toggleのみ（06-23監査確認済み）。完全終了のメニュー項目がない。
- **リスク**: タスクマネージャーからの強制終了以外に終了手段がなく、ユーザー体験として不親切。
- **対象ファイル**: `03_companion/src-tauri/src/lib.rs`（tray menu構築部）。
- **実装方式**: tray右クリックメニューに「表示」「壁紙再読込」（将来のKiritanPoster等との連携用に予約）「完全終了」を追加。「完全終了」は`app.exit(0)`。
- **受け入れ条件**: tray右クリック→完全終了でプロセスが消えることを確認。
- **後方互換性**: 影響なし。**migration不要**。

### 4.4 atomic save（優先度4）

- **現状**: `state.rs::persist()`は`std::fs::write`で直接上書き（`.bak`無し、書き込み中のクラッシュで破損しうる）。
- **リスク**: 保存中の電源断・強制終了で`companion-data.json`が壊れ、次回起動時にすべてのTODO/メモ/bookmark/presetが消える（`load_from`はparse失敗時に黙って`WallpaperState::default()`へフォールバックする——06-23監査で確認済みのPARTIAL評価）。
- **対象ファイル**: `03_companion/src-tauri/src/state.rs`（`persist`関数）。
- **実装方式**: 一時ファイル（`companion-data.json.tmp`）に書いてから`rename`（POSIX/Windows共にatomic rename相当）。上書き前の内容を`companion-data.json.bak`として保持する。
- **受け入れ条件**: 保存直後に`.bak`が前回内容と一致すること、書き込み中に強制終了しても`.tmp`が残るだけで本体は無傷であることをテストで確認。
- **後方互換性**: 既存の`companion-data.json`はそのまま読み込み可能（フォーマット不変）。**migration不要**。

### 4.5 localhost限定の維持確認（優先度5）

- **現状**: `SocketAddr::from(([127, 0, 0, 1], API_PORT))`で既にloopback限定（06-23確認済み、変化なし）。
- **リスク**: 現状で問題なし。将来設定でbindアドレスを変更可能にする場合のみ再検証が必要。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs`。
- **実装方式**: 変更不要。回帰しないよう試験に固定化する（`127.0.0.1`以外へのbindを許す設定UIを作らない）。
- **受け入れ条件**: 該当なし（現状維持）。
- **後方互換性**: 該当なし。

### 4.6 API tokenまたはOrigin制限（優先度6）

- **現状**: 認証なし。CORSは`http://localhost*` / `http://127.0.0.1*` / `null` originに対し全HTTPメソッドを許可（06-23で"RISK"評価）。
- **リスク**: 同一マシン上の別の悪意あるローカルプロセス/ブラウザタブから状態を書き換えられる（loopback限定なのでLAN外部からは無理だが、同一PC内の他プロセスは無防備）。
- **対象ファイル**: `03_companion/src-tauri/src/api.rs`（CORS設定・route定義）。
- **実装方式**: 段階的に導入する。まず「GETは現状のCORSのまま許可、POST/PUT/PATCH/DELETEは`X-Companion-Token`ヘッダ必須」に分離する。tokenは起動時に生成し、壁紙/overlay/kiritanPosterへは同一マシン上のファイル（`%APPDATA%\tohoku-companion\.token`のような）経由で配布する。
- **受け入れ条件**: tokenなしのPOSTが401になること、正しいtoken付きは通ること。既存のGET系ポーリング（overlay 5s poll）が無停止で動き続けること。
- **後方互換性**: **破壊的変更**。壁紙側`kiritanPoster.ts`とoverlay側`companionClient.ts`の両方にtoken読み込みを追加する必要がある。migration要（両者を同時にデプロイしないと壁紙のPOSTが401で失敗し始める）。

### 4.7 secretsを通常JSONから分離（優先度7）

- **現状**: `secrets.openai_key`等は平文で`companion-data.json`に同梱保存（`state.rs::Persist`構造体に含まれる）。`/api/state`からは除外されている（06-23確認済み、これは正しい）。
- **リスク**: ディスク上のファイルを見れば誰でもAPIキーを読める。
- **対象ファイル**: `03_companion/src-tauri/src/state.rs`。
- **実装方式**: 短期的にはファイルを分離するだけでも効果がある（`secrets.json`を`companion-data.json`と別ファイルにし、パーミッションを絞る）。中期的にはOS credential store（Windows Credential Manager、`keyring`クレート）へ移行する。
- **受け入れ条件**: secrets.jsonが分離され、既存のcompanion-data.json内のsecretsフィールドから自動移行されること。
- **後方互換性**: 初回起動時に旧`companion-data.json`内の`secrets`を新ファイルへ一度だけmigrateするコードが必要。**migration要**。

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
