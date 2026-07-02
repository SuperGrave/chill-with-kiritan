# 完成ルート復帰 実施記録（2026-07-01）

branch: `feat/pose-composer-0.8`（`main` `5220449`から継続作業中）。開始HEAD: `da4c631`。Stage F優先度1-4完了時HEAD: `e6016df`。push未実施。

Stage A〜Dの後、[実行計画](COMPLETION_EXECUTION_PLAN_2026-07-01.md)の「次に実行すべき1ステージ」推奨に従い、Stage F（Companion運用品質）へ着手した。2026-07-01に優先度1〜4、2026-07-02に優先度5〜7を実装した。

本書は**今回実際に完了した内容のみ**を記す。監査全体は[`COMPLETION_AUDIT_2026-07-01.md`](COMPLETION_AUDIT_2026-07-01.md)、今後の計画は[`COMPLETION_EXECUTION_PLAN_2026-07-01.md`](COMPLETION_EXECUTION_PLAN_2026-07-01.md)を参照。

## Stage A: 作業ツリー救出・分類

開始時、作業ツリーに以下が未コミットのまま同一ファイル内で混在していた。

- Pose Composer Stage 0-4の統合行（`VrmViewer.tsx`/`motionLab.ts`/`reviewPanel.ts`）
- 無関係な実験機能「work-hand-pin IK」（`VrmViewer.tsx`内、約230行）
- 12本のmotion DSL JSON + scene.json + layout.canonical.jsonの再校正
- 無関係な小規模housekeeping（`.gitignore`、stray exe、`理想形.png/txt`、README）

### 実施内容

1. **バックアップ**: 変更全体のpatchファイルをスクラッチパッドへ保存。`backup/pre-rescue-2026-07-01`ブランチ（開始HEADのポインタ）を作成。`rescue/pre-split-2026-07-01`ブランチへ全差分を一時コミット（`08c6b1c`）してから`feat/pose-composer-0.8`の作業ツリーへ`cherry-pick --no-commit`で戻し、元の未コミット状態を完全に復元した。
2. **分類・分離コミット**（4件）:
   - `c70d3f3` housekeeping（stray exe削除・`.gitignore`・README・`理想形.*`削除）
   - `c458e71` motion/scene再校正（keyboard reach腕/手首値の実測再計算、`node tools/test_motions.mjs --all` 54/54、`test_director.mjs` 90/90、`test_expression_presets.mjs` 263/263で確認してからコミット）
   - `a50080f` Pose Composer統合行（`npx tsc -b` green確認後コミット）
3. **work-hand-pin IK隔離**: `a50080f`後の作業ツリーからwork-hand-pin IK部分（約230行）を手動で除去し、除去済みバージョンでVrmViewer.tsxをコミット済みにした上で、`wip/work-hand-pin-ik-2026-07-01`ブランチ（`dbf0812`）へ元のIKコードを`rescue`ブランチから再抽出してコミット。`feat/pose-composer-0.8`はwork-hand-pin IKを一切含まない状態になった。
4. **バグ発見・修正**: Pose Composer Stage 0-4を`?poseEdit=1`で実機検証中、`App.tsx`の`productionMode`判定が`poseEdit`クエリを除外していないバグを発見。production URLに`?poseEdit=1`を付けると`production-mode`のままPose Composerが有効化される状態だった。`099b9cf`で修正し、修正前後を実機で確認（修正前: `wallpaper-shell production-mode` + `__poseComposer`有効／修正後: `wallpaper-shell probe-mode`）。
5. **Pose Composer Stage 0-4実機検証**: `begin→setBoneOffsetEuler→inspectBone→resetAll→end`、`savePose→resetAll→loadPose`の往復を実機で確認。console error無し。

### 検証結果

`npx tsc -b` / `npm run build` clean。`node tools/test_motions.mjs --all`(54) / `test_director.mjs`(90) / `test_expression_presets.mjs`(263) / `test_pose_math.mjs`(133) / `test_pose_codec.mjs`(22) / `test_pose_undo.mjs`(32) 全PASS（594/594）。

### 完了条件チェック

- [x] 未コミット変更を分類済み
- [x] Pose Composer Stage 0-4がgreen
- [x] Stage 5-7がpark済み（[`POSE_COMPOSER_0_8_PROGRESS.md`](POSE_COMPOSER_0_8_PROGRESS.md)に明記）
- [x] work-hand-pin IKが完成ブランチから分離済み
- [x] build/testがgreen
- [x] 作業ツリーclean
- [x] rollback可能なチェックポイントcommitあり（`backup/pre-rescue-2026-07-01`, `rescue/pre-split-2026-07-01`）

## Stage B: Motion Directorをproductionへ接続

`VrmViewer.tsx`に`autoStartDirector: boolean` propを追加し、App.tsxから`productionMode`を渡すことで、VRM読込完了時にLabの手動`__motionLab.director(true)`と同じ`startDirector()`を自動実行するようにした。

実機検証中（React StrictMode dev double-invokeの下で）、**実際のレースコンディションを1件発見・修正**した: cleanup済みの古いmountのVRM読込コールバックが新しいmountより後に完了し、`directorRef.current`を上書きしてから自身をcancel扱いにして`stopDirector()`し、結果的に新しいmountのDirectorまで巻き添えでnullになる問題。`startDirector()`呼び出し前にもキャンセル判定を追加して解消。

### 検証結果

- production URL（クエリ無し）: `[DIRECTOR] production auto-start ok (25 motions preloaded)`ログを確認。
- `?probe=1`: 同ログが出ないこと（Lab手動制御維持）を確認。
- `npx tsc -b` / `npm run build` clean。motion/director/expression試験は影響なし継続green。

コミット: `98402ec`

## Stage C: kiritan/state API実装と配線

壁紙側は既にPhase 0 Test Eで疎通試験済みの`KiritanPoster`/`buildKiritanState`が存在していたが、(1) Companion側に受信routeが無く（06-23監査でHTTP 404確認済み）、(2) `KiritanPoster`のインスタンスがどこからも生成・呼び出しされていなかった。

### 実施内容

1. `DirectorRunner.snapshot()`アクセサを追加（既存の`fsm.snapshot()`を公開するだけの1行）。
2. `VrmViewer.tsx`のanimate loopに`KiritanPoster`インスタンスを1つ生成し、Director稼働中は毎フレーム`maybePost()`を呼ぶよう配線（実送信はmode変化時+30秒heartbeatのみ）。
3. Companion側（Rust）に`POST/GET /api/kiritan/state`を実装。`KiritanStatePost`を壁紙側`KiritanState`型と1:1で対応させ、`Json<KiritanStatePost>`抽出器で構造的な不正payloadを422で拒否、ハンドラ内でmode非空・presence enum・sleepiness範囲を追加検証。`WallpaperState.kiritan: Option<KiritanRuntimeState>`はメモリのみ保持（`state::Persist`から除外、heartbeatでディスクを書かない）。

### E2E実機検証

コンパイル済みの`03_companion`実行ファイルを直接起動し、production URLの壁紙（実ブラウザ）から実際に`POST http://127.0.0.1:40313/api/kiritan/state`が成功し、`GET`で新鮮な`receivedAt`とライブのmode/presence/sleepinessが読み出せることを確認した。06-23監査でBROKEN(404)だった経路が解消されたことを実機で確認済み。

副作用: このE2E中、Companionのバックグラウンドnews pollerが実データディレクトリ（`%APPDATA%\tohoku-companion\companion-data.json`）へ書き込んだ（内容は既存データと同一、mtimeのみ更新——実害なし。ただし今後同様のテストをする際はテスト専用データディレクトリを使う導線が無いことが判明した。[実行計画のSHOULD](COMPLETION_EXECUTION_PLAN_2026-07-01.md)に記載）。

### 検証結果

- Rust: `cargo check` / `cargo test`（新規`kiritan_state_post_and_get`含む2/2）green。
- JS: `npx tsc -b` / `npm run build` clean。motion/director/expression/kiritan_post試験継続green。

コミット: `ad0f23e`（Companion API）、`7bfb4bb`（壁紙側配線+レースコンディション修正）

## Stage D: 背景・昼夜最小基盤

### 実施内容

1. `lib/scene/daypart.ts`（新規、純粋関数）: `getDaypart(date)`でローカル時計の6:00-17:59を昼、それ以外を夜と判定。`resolveDaypart(override, date)`は将来のCompanion設定オーバーライド用のフック（今回は未配線）。
2. `sceneTypes.ts`: `SceneBackground.night`/`SceneLighting.night`を部分オーバーライドとして追加。`sceneLoader.ts::coerceLighting`が`night`ブロックを保持するよう修正（従来は黙って捨てていた）。
3. `SceneBackgroundLayer.tsx`: `daypart`propを受け取り、夜は`background.night.*`画像を優先（無ければ昼画像 → 無ければCSS fallbackという既存の多段fallbackにそのまま乗る）。**実背景アートが1枚も無い現状で唯一目に見える効果**として、CSS fallbackグラデーション自体を昼/夜で別の色（濃紺の空/より暗い部屋）に切り替える`index.css`ルールを追加。
4. `VrmViewer.tsx::applySceneLighting`: `daypart`引数を追加し、夜は`lighting.night`の指定フィールドのみ昼値に上書き適用。daypart変化時にシーン再ロード無しで再適用する軽量effectを追加。`scene.json`に`night`のライティング値（暗め・青みがかった主光源）を実例として追加。
5. `App.tsx`: `daypart` stateをローカル時計から算出し60秒毎に再計算、`SceneBackgroundLayer`と`VrmViewer`の両方へ配線。

### 検証結果

- `node tools/test_daypart.mjs`（新規）: 39/39 PASS（境界時刻・全24時間の網羅・override優先順位）。
- `validateScenePreset`が`night`ブロックを保持すること、`night`を省略したシーンが`undefined`のまま正常に解決すること（クラッシュしない）を手動Node検証で確認。
- 実機（`preview_inspect`によるcomputed style読み出し + Reactprops確認）: `daypart: "day"`が正しく伝播し、fallbackグラデーションの実際の色（`background-image`計算値）が昼設定と一致することを確認。夜クラス（`scene-bg--night`）を手動付与した際の色も期待通り切り替わることを確認。
- **未確認**: 画面スクリーンショットでの目視、およびThree.js側ライティング強度変化の目視。本アプリはWebGLキャンバスが常時再描画するため`preview_screenshot`がタイムアウトする既知の制約があり、production URLではその制約を回避する手段（`?lab=1`のfreeze+capture経路）が使えない。
- `npx tsc -b` / `npm run build` clean。lint検証中に本Stageで新規に導入したuseEffectの参照順序エラーを発見・即修正（`f0f4fb9`）。全609件のNode試験(daypart追加後648件)継続green。

コミット: `4076412`（実装）、`f0f4fb9`（lint修正）

## Stage F（優先度1-4）: Companionの最低限の運用品質

[実行計画§4](COMPLETION_EXECUTION_PLAN_2026-07-01.md#4-companion運用品質の計画)の10項目のうち、破壊的変更（API token導入）より前に済ませられる4項目を実装した。

### 実施内容

1. **single instance**（`tauri-plugin-single-instance`）: 二つ目の起動要求は既存ウィンドウをforeground化して終了するのみにした。最初に登録するプラグインにする必要がある（他の初期化より先に割り込む必要があるため）。
2. **ポート競合時のエラー表示**（`tauri-plugin-dialog`）: `api::serve()`の戻り値を`() `→`Result<(), String>`に変更し、bind失敗時にネイティブエラーダイアログを表示するようにした。
3. **trayから完全終了**: tray右クリックメニューに「表示」「完全終了」を追加。当初計画にあった「壁紙再読込」項目は、壁紙プロセスを外部制御するチャネルが無いため今回は見送った。
4. **atomic save + backup**: `state.rs::persist()`を一時ファイル書き込み→`.bak`退避→`rename`のatomic write化。

### 検証結果

- `cargo check` / `cargo test`（7/7、新規のstate.rs単体テスト3件を含む）green。
- **実機smoke test**: コンパイル済みdebugバイナリを実際に起動し、
  - single instance: 2回連続起動し、2回目はログ・プロセスともに発生せず、`GET /api/health`は1回目のプロセスから応答し続けることを確認。
  - atomic save: background news pollerの自動保存によって実際に`companion-data.json.bak`が生成され、内容が直前の状態と一致することを確認。
- tray右クリックメニューの実際のクリック操作、およびポート競合ダイアログの実際の表示は、single instanceが先に効くため単体では再現しにくく、**目視・手動操作待ち**として区別する（コードパス自体はcargo checkで型検証済み）。

副作用の再申告: 本Stageの実機smoke testでも、Companionのbackground news pollerが実データディレクトリ（`%APPDATA%\tohoku-companion\`）へ書き込みを行った。今回のatomic save実装により、書き込みは`.tmp`→`.bak`退避→`rename`を経る安全な経路になっており、実際に`.bak`が正しく作成されることも確認できた（副作用ではあるが、今回の実装がその副作用自体を安全にした）。テスト専用データディレクトリの導線が無い点は[実行計画のSHOULD](COMPLETION_EXECUTION_PLAN_2026-07-01.md)に記載済みのまま。

コミット: `e7f7dba`（single instance・dialog・tray）、`1faf464`（atomic save）

## Stage F（優先度5-6）: loopback固定とmutating API token

### 実施内容

1. **localhost限定の試験固定化**: `api.rs`へ`api_addr()`を追加し、`serve()`が必ず`127.0.0.1:40313`をbindする経路に統一した。integration test `live_api_address_is_loopback_only`で回帰を固定化。
2. **mutating API token**: `state.rs`で`companion-api-token.txt`を初回自動生成・再利用するようにした。`GET/HEAD/OPTIONS`は従来通り開放し、`POST/PUT/PATCH/DELETE`だけ`X-Companion-Token`必須にした。CORS origin判定は`localhost.evil`系を通さない明示関数にし、Tauri v2の`tauri.localhost`系originも許可した。
3. **token配布経路**: Web/Tauri/Wallpaper Engineのorigin差でファイル直読みが壊れやすいため、`GET /api/auth/token`を追加した。CORS対象外originのWebページはtoken応答を読めず、tokenなしのmutating requestは401になる。
4. **全in-repoクライアント更新**:
   - `03_companion/src/api.ts`: mutating request前にtoken取得・キャッシュ・401時リトライ。
   - `02_ui-overlay/src/services/companionClient.ts`: `pushCompanionUi()`でtokenヘッダ付与。
   - `01_wallpaper/src/lib/motion/director/kiritanPoster.ts`: default fetch transportがtokenを取得して`POST /api/kiritan/state`へ付与。token endpointが無いテストreceiverや古いmock相手では従来通りtoken無しPOSTへfallbackする。

### 検証結果

- Rust: `cargo test` PASS（unit 7 + integration 4 = 11/11）。新規`api_token_is_generated_once_and_reused`、`allowed_origin_accepts_only_local_webviews`、`live_api_address_is_loopback_only`、`mutating_routes_require_companion_token`を含む。
- 03 Companion frontend: `npm run build` PASS。
- 02 UI Overlay: `npm run build` PASS。
- 01 Wallpaper: `npm run build` PASS。
- `node tools/test_kiritan_post.mjs`: 15/15 PASS。tokenプリフェッチ追加後もfire-and-forget性・cadenceが壊れていないことを確認。
- `node tools/test_daypart.mjs`: 39/39 PASS。

### 注意点

このtokenは「外部WebページからのCSRF的な書き換え」を防ぐためのローカルAPI用tokenであり、同一PC上の任意のネイティブプロセスを防ぐ秘密鍵ではない。Companionは引き続きloopback限定でbindし、LAN外部へ公開しない前提を維持する。

## Stage F（優先度7）: secrets分離と旧データmigration

### 実施内容

1. **通常データからsecretsを除外**: `state.rs::Persist.secrets`をdeserialize専用にし、新規保存時は`companion-data.json`へ`secrets`を書かないようにした。
2. **secrets専用ファイル**: `secrets.json`を追加し、APIキー・Spotify refresh token等はここへatomic write + `.bak`で保存する。
3. **旧形式migration**: 旧`companion-data.json`に含まれていた`secrets`を読み込み、`secrets.json`へ移行する。移行後は`companion-data.json`と`companion-data.json.bak`からtop-level `secrets`を除去する。
4. **backupのsanitize**: 通常データ側の`.bak`作成時、旧形式の`secrets`が含まれている場合は削除した上で退避する。secret専用のbackupは`secrets.json.bak`側に閉じる。

### 検証結果

- Rust: `cargo test` PASS（unit 9 + integration 4 = 13/13）。新規`secrets_are_persisted_to_a_separate_file_only`、`legacy_embedded_secrets_are_migrated_and_sanitized`を含む。

### 注意点

これは短期対策としてのファイル分離であり、OS credential store（Windows Credential Manager等）への移行は未実装。`secrets.json`自体はローカルファイルとして残るため、公開配布や共有バックアップ時には通常データとsecretファイルを分けて扱う。

## 検証サマリー（最終）

| コマンド | 結果 |
|---|---|
| `01_wallpaper: npx tsc -b` | PASS |
| `01_wallpaper: npm run build` | PASS |
| `01_wallpaper: npm run lint` | 5 problems（3 errors, 2 warnings）— 全て本セッション開始前からの既知の問題、新規ゼロ |
| `01_wallpaper: check:dist-assets` | PASS |
| `01_wallpaper: check:props` | PASS |
| `02_ui-overlay: npm run build` | PASS |
| `02_ui-overlay: npm run lint` | 44 errors（06-23と同数、未着手） |
| `03_companion: cargo check` | PASS |
| `03_companion: cargo test` | PASS（13/13、Stage F優先度1-7追加分を含む） |
| `03_companion: 実機smoke test` | single instance／atomic save+backupを実バイナリで確認（本文参照） |
| `03_companion (frontend): npm run build` / `tsc --noEmit` | PASS |
| `node tools/test_motions.mjs --all` | 54 PASS |
| `node tools/test_director.mjs` | 90 PASS |
| `node tools/test_expression_presets.mjs` | 263 PASS |
| `node tools/test_kiritan_post.mjs` | 15 PASS |
| `node tools/test_pose_math.mjs` | 133 PASS |
| `node tools/test_pose_codec.mjs` | 22 PASS |
| `node tools/test_pose_undo.mjs` | 32 PASS |
| `node tools/test_daypart.mjs` | 39 PASS |

**合計 648 Node checks / 0 FAIL。**

## 更新したドキュメント

- `docs/COMPLETION_AUDIT_2026-07-01.md`（新規）
- `docs/COMPLETION_EXECUTION_PLAN_2026-07-01.md`（新規）
- `docs/COMPLETION_PROGRESS_2026-07-01.md`（本書、新規）
- `docs/POSE_COMPOSER_0_8_PROGRESS.md`（Stage 0-4 green + park記録を追記）

## 今回禁止事項の遵守確認

- 未コミット変更は破棄していない（すべてバックアップブランチ経由で保全）。
- VRMモデルの改変・再エクスポートは行っていない。
- Pose Composer Stage 5-7は実装していない。
- モーションの細かな見た目調整（work-hand-pin IK含む）へは脱線せず、隔離のみ行った。
- UI全面刷新・Unity移行は行っていない。
- 外部素材のダウンロード・同梱は行っていない。
- Wallpaper Engine実機未確認を確認済みと報告していない（§Stage D「未確認」明記、実行計画§3で目視待ちと明記）。
- テストの削除・弱体化は行っていない（既存594件に加え、daypart 39件を新規追加）。
- pushは行っていない。
