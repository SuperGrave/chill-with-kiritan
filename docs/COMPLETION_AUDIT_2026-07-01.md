# トーホク・ウォールペーパー 完成ルート監査（2026-07-01 更新版）

- 監査日: 2026-07-01
- 対象: `C:\Users\super\Desktop_Folders\制作\キリタン・ウォールペーパー`
- 監査基準HEAD: `f0f4fb9`（branch `feat/pose-composer-0.8`、`main`から10 commits ahead）
- 前回監査: [`SHORT_COMPLETION_AUDIT_2026-06-23.md`](SHORT_COMPLETION_AUDIT_2026-06-23.md)（基準HEAD `1e9aeec`→`ba210b6`）— 本書はその**差分更新**。前回の判断根拠・配布/ライセンス節・WE packaging調査・完成3案の論拠は変更がない限り前回文書を正とする。
- 監査方針: 前回と同じ（実装・リファクタは監査の範囲外、静的確認＋ビルド＋テスト＋実機/実APIで確認）。ただし本書は「2026-07-01の完成ルート復帰作業」の実施記録も兼ねる（実施内容は [`COMPLETION_PROGRESS_2026-07-01.md`](COMPLETION_PROGRESS_2026-07-01.md) に詳細）。
- 判定語: 前回と同じ（WORKING / PARTIAL / MOCK / BROKEN / MISSING / UNKNOWN / DEFER）。

## 1. エグゼクティブサマリー

### 06-23からの変化

前回監査は「壁紙とCompanionは動くが、日常利用できる一つの製品としては未完成」と判定し、MUST 10項目を挙げた。本日(2026-07-01) 実施した完成ルート復帰作業で、そのうち**中核の3項目が実装・実機検証済みで完了**した。

| # | 06-23時点のMUST | 2026-07-01時点 |
|---|---|---|
| 2 | 01+02を1画面に統合 | ✅ **完了**（06-23監査時点で既に`5220449`として実装済みだった。前回監査はこのコミットを確認済みHEADとして記録している） |
| 3 | Directorを通常起動 | ✅ **完了**（本日実装・実機検証） |
| 4 | `POST /api/kiritan/state`実装・配線 | ✅ **完了**（本日実装・実機検証、実Companion.exeで確認） |
| 6 | 背景と昼夜の最低限 | ⚠️ **部分完了**（本日実装。スキーマ・切替ロジック・ライティングは実装・検証済みだが、実背景アートは依然ゼロ枚のまま） |
| 5, 1, 7, 8, 9, 10 | fake-real除去／方式確定／WE package／Companion運用品質／配布判断／dirty motion確定 | 変化なし（5は06-23で完了、1は文書確定のみで実装対象外、7-9-10は本日未着手） |

結論: **「壁紙が生活しているように見える」ラインの最後の壁（Director非稼働・Companion連携404）は本日で解消**。残る大物はWallpaper Engine実機package化とCompanion運用品質（single-instance・保存の安全性・認証）で、これは06-23監査時点から変化していない。

### 完成度の再測定

| 領域 | 06-23判定 | 2026-07-01判定 | 根拠 |
|---|---|---|---|
| VRM表示・Three.js描画 | WORKING | WORKING（変化なし） | |
| モーション基盤 | WORKING | WORKING（変化なし、Pose Composer Stage3-4追加で試験648/648 PASS） | §5 |
| Life Modeの製品起動 | BROKEN | ✅ **WORKING** | production URLでDirector自動起動、実機ログ確認 |
| 昼夜の行動変化 | PARTIAL | PARTIAL（変化なし。Director tickへの時刻biasは既存のまま） | |
| 昼夜の見た目 | MISSING | ⚠️ **PARTIAL**（スキーマ+CSS fallback+ライティング切替は実装。実アートは無し） | §4 |
| 情報オーバーレイ | PARTIAL | PARTIAL（変化なし） | |
| Companion | PARTIAL | PARTIAL（変化なし、kiritan受信ルートのみ追加） | |
| 壁紙↔Companion | PARTIAL/BROKEN | ✅ **WORKING** | 実Companion.exe + 実ブラウザで`GET /api/kiritan/state`にlive値を確認 |
| Wallpaper Engine投入 | PARTIAL/UNKNOWN | 変化なし（未着手） | |
| スタンドアロン壁紙EXE | MISSING | 変化なし | |
| 公開配布 | BLOCKED | 変化なし | |

## 2. Pose Composer 0.8 の着地点

2026-06-24〜06-30にStage 0-4が実装されたが、**統合行が別機能（work-hand-pin IK）と同一ファイル内で未コミットのまま交錯しており、Stage 0-4のコミット単体をcheckoutしてもPose Composerは起動しない状態**だった。本日、次の3つに分離した。

1. **Pose Composer統合行** → `a50080f`でコミット。これでStage 0-4が単独で動作する状態になった。
2. **work-hand-pin IK**（実験的なランタイムIK、完成に不要と明示指示） → 別ブランチ `wip/work-hand-pin-ik-2026-07-01`（commit `dbf0812`）へ隔離。`feat/pose-composer-0.8`の作業ツリーはクリーン。
3. **モーション/シーン再校正**（既存work系motionの腕・手首リーチ値の実測再計算） → `c458e71`でコミット。全自動試験green。

さらに、`App.tsx`の`productionMode`判定が`poseEdit`クエリを除外していないバグを発見・修正した（`099b9cf`）。修正前は production URL に `?poseEdit=1` を付けると `production-mode` のまま `window.__poseComposer` が有効化されていた。

**Pose Composer 0.8の今後の方針**: Stage 0-4で完成・park。Stage 5(qキー評価器)/6(DragPad)/7(Copy/Mirror)は**今回実装しない**（完成ルート優先のため）。詳細は [`POSE_COMPOSER_0_8_PROGRESS.md`](POSE_COMPOSER_0_8_PROGRESS.md) 末尾。

## 3. Git / worktree

### 監査終了時点

- branch: `feat/pose-composer-0.8`
- HEAD: `f0f4fb9`
- `main`: `5220449`（`origin/main`と同じ）— 現ブランチは **10 commits ahead**
- worktree: 1個、作業ツリー **clean**
- 未コミット変更: なし

### 本日作成したブランチ・バックアップ

| ブランチ/タグ | 内容 |
|---|---|
| `backup/pre-rescue-2026-07-01` | 作業開始時点(`da4c631`)のポインタ |
| `rescue/pre-split-2026-07-01`（commit `08c6b1c`） | 開始時点の未コミット差分（22ファイル）を丸ごと退避した一時コミット |
| `wip/work-hand-pin-ik-2026-07-01`（commit `dbf0812`） | 完成に不要と判断したwork-hand-pin IK実装の隔離先 |

pushは未実施。

### 本日のコミット一覧（`feat/pose-composer-0.8`、`5220449`からの10 commits）

```text
c70d3f3 chore: clean up stray root exe and superseded layout reference files
c458e71 content: recalibrate work-motion arm/wrist reach for the final laptop rig
a50080f fix: wire pose composer stage 0-4 integration + dev panel lifecycle
099b9cf fix: exclude ?poseEdit=1 from production mode
434fdc6 docs(pose-composer): record Stage 0-4 green + park Stage 5-7
98402ec feat: start motion director in production lifecycle
ad0f23e feat: add companion kiritan state API
7bfb4bb feat: post runtime kiritan state from wallpaper
4076412 feat: add minimal day/night scene background support
f0f4fb9 fix: move daypart relight effect after its own dependency
```

## 4. 接続表（実際に到達することを確認したもののみ）

| Producer | Endpoint/Event | Consumer | 現状 | 起動条件 | fallback | 必要修正 |
|---|---|---|---|---|---|---|
| 01 Motion Director | `startDirector()`（内部呼び出し） | 01 render loop | ✅ WORKING | production URL（`?probe`/`?lab`/`?phase1Review`/`?poseEdit`いずれも無し）で自動起動。VRM load完了後、25 motion preload成功で起動 | VRM未ロード時は`{ok:false}`を返し起動しない。二重起動はStrictMode競合を修正済み（下記§6参照） | なし（実装済み） |
| 01 KiritanPoster | `POST http://127.0.0.1:40313/api/kiritan/state` | 03 Companion | ✅ WORKING | Directorが稼働中、毎フレーム`maybePost()`呼び出し（実送信はmode変化時+30s heartbeat） | Companion不在→fetch失敗をfire-and-forgetで握り潰す（`onError`のみ、壁紙は無停止） | なし（実装済み・実機E2E確認済み） |
| 03 Companion | `GET /api/kiritan/state` | 未実装のCompanion UI（将来） | ✅ WORKING（API層のみ） | Companion起動中は常時応答。壁紙が未報告なら`null` | — | Companion側UIタブでの表示は未実装（SHOULD） |
| 03 Companion | `GET/PUT /api/ui`, `POST /api/presets/*` | 02 UI Overlay | ✅ WORKING（06-23で確認済み、変化なし） | | | |
| 02 UI Overlay | `GET /api/state`（5s poll） | 03 Companion | ✅ WORKING（変化なし） | | | |
| 01 SceneBackgroundLayer | `daypart` prop（Appのローカル時計、60s毎再計算） | 01 background CSS layer | ✅ WORKING | 常時。`background.night.*`が無ければCSS fallbackグラデーションのみ切替 | 実画像0枚 → 常にCSS fallback | 実アート未着手（LATER） |
| 01 applySceneLighting | `daypart` prop | 01 Three.js ambient/directional light | ✅ WORKING（コード検証・型検証のみ、画面での輝度目視は未実施） | シーンロード時＋daypart変化時 | `lighting.night`未指定なら昼値のまま | 目視確認は次回のUI/QAパスで（screenshot経路が本アプリでは詰まる既知の制約。§6参照） |

## 5. ビルド・テスト結果

### 01_wallpaper

| コマンド | 結果 |
|---|---|
| `npx tsc -b` | PASS |
| `npm run build` | PASS（bundle 1,301.20 KB / gzip 353.33 KB） |
| `npm run lint` | 5 problems（3 errors, 2 warnings）— **すべて本セッション開始前からの既知の問題**（App.tsx sync-setState-in-effect、VrmViewer.tsx hooks-immutability、Pose Composer Stage2/4由来の2件）。新規追加はゼロ |
| `npm run check:dist-assets` | PASS（distにVRM無し） |
| `npm run check:props` | PASS |

### 02_ui-overlay

| コマンド | 結果 |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | 44 problems（44 errors）— 06-23と同数、変化なし（未着手・SHOULD） |

### 03_companion

| コマンド | 結果 |
|---|---|
| `cargo check` | PASS |
| `cargo test` | PASS（unit 2 + integration 2、うち1件が今回追加した`kiritan_state_post_and_get`） |
| `cargo fmt --check` | 差分あり（`build.rs`・`api.rs`の既存コード全域に及ぶ。プロジェクトで`cargo fmt`が一度も適用されていない状態で、今回の追加コードのみの問題ではない。ゲートとして扱われていない） |
| `npm run build`（companion frontend） | PASS |
| `npx tsc --noEmit`（companion frontend） | PASS |

### Node動作試験（`tools/*.mjs`）

| コマンド | 結果 |
|---|---|
| `node tools/test_motions.mjs --all` | 54 PASS |
| `node tools/test_director.mjs` | 90 PASS |
| `node tools/test_expression_presets.mjs` | 263 PASS |
| `node tools/test_kiritan_post.mjs` | 15 PASS |
| `node tools/test_pose_math.mjs` | 133 PASS |
| `node tools/test_pose_codec.mjs` | 22 PASS |
| `node tools/test_pose_undo.mjs` | 32 PASS |
| `node tools/test_daypart.mjs`（新規） | 39 PASS |

**合計: 648 checks / 0 FAIL**

## 6. E2E実機検証

### Motion Director production自動起動

`http://localhost:5187/`（クエリ無し = production URL）を開き、`[DIRECTOR] production auto-start ok (25 motions preloaded)`ログを確認。`?probe=1`では同ログが出ないこと（Lab手動制御のまま）も確認。

検証中に**実際のStrictMode二重起動レースを1件発見・修正した**: 開発モードのReact StrictModeがmount→cleanup→mountを行う際、cleanup済みの1回目のmountのVRM読込コールバックが（GLTFLoaderに中断機構が無いため）2回目のmountより後に完了することがあり、その古いmountの`startDirector()`が`directorRef.current`を上書きしてから自分自身をcancelしてnullに戻してしまい、**「起動成功ログは出るのに実際はDirectorが死んでいる」状態**になり得た。キャンセル済みかどうかのチェックを`startDirector()`呼び出し前にも追加して修正（`98402ec`〜`7bfb4bb`の過程で発見・修正）。

### kiritan/state 実E2E（06-23で404だった経路）

1. `03_companion`をdebug buildして直接起動（`C:/cargo-build/tohoku-companion/debug/tohoku-companion.exe`）。`[companion] HTTP API ready → http://127.0.0.1:40313`を確認。
2. production URLの壁紙をロードし、Director自動起動を待った。
3. `curl http://127.0.0.1:40313/api/kiritan/state`で、壁紙が実際に送信した`mode: "work_normal"`・新鮮な`receivedAt`タイムスタンプを確認。

判定: **WORKING**（06-23はBROKEN=HTTP 404だった経路が解消）。

副作用の申告: このE2E検証中、Companionのバックグラウンドnews pollerが起動直後に実データディレクトリ（`%APPDATA%\tohoku-companion\companion-data.json`）へ書き込みを行った（`persist()`はkiritan以外の項目も含めて全体を書き直す実装のため）。内容を確認したところ既存のユーザーデータ（ui/レイアウト/bookmarks等）に変化はなく、mtimeのみ更新されていた。実害は無いが、次回以降の実機テストではテスト専用データディレクトリを確実に使う導線が無いことが判明した（`AppState::load()`は環境変数オーバーライドを持たない）。SHOULD項目として追記する。

### 昼夜切替

`daypart`propが`day`/`night`で正しく伝播すること、CSS fallbackグラデーションの色が実際に切り替わることを`preview_inspect`（computed style）とReact props読み出しで確認。**画面スクリーンショットでの目視は未実施**——本アプリはWebGLキャンバスが常時再描画するため`preview_screenshot`がタイムアウトする既知の制約があり（`?lab=1`のfreeze+capture経路以外はスクリーンショットが機能しない）、production URLではその経路が使えないため。ライティング強度変化（Three.js側）も同様に未目視。

## 7. 配布・ライセンス（06-23から変化なし）

VRMモデル・VRMA・props・フォントのライセンス状況は前回監査から変更していない。[`SHORT_COMPLETION_AUDIT_2026-06-23.md`](SHORT_COMPLETION_AUDIT_2026-06-23.md) §8を正とする。

## 8. MUST / SHOULD / LATER（更新）

### MUST — 残り

1. ~~完成方式を固定する~~ → 確定済み（案A、06-23）
2. ~~01と02を統合する~~ → 完了（06-23実装、確認継続）
3. ~~Directorを通常起動~~ → **完了（本日）**
4. ~~`POST /api/kiritan/state`実装~~ → **完了（本日）**
5. ~~fake-real表示除去~~ → 完了（06-23実装、確認継続）
6. **背景と昼夜の最低限** → スキーマ・切替ロジックは完了。**実背景アート3枚（room_back.png/outside.png/light_overlay.png）は依然未着手**——これは"最終素材制作に深入りしない"という今回の方針で意図的に据え置き
7. **Wallpaper Engine実機packageを作る** → 未着手
8. **Companionの最低限の運用品質** → 未着手（single-instance / port bind失敗UI / atomic write / API認証 / secrets error sanitize）
9. **配布対象を確定する** → 未着手
10. ~~dirty motionを確定~~ → 完了（06-23実装分）。ただしPose Composer統合で新たに発生した混在は本日解消

### SHOULD — 追加分

- Companion実データディレクトリを汚さずにテストする導線（`TOHOKU_COMPANION_DATA_DIR`的な環境変数オーバーライド、または`--data-dir`起動引数）— 本日のE2E検証で判明
- Companion状態タブ/AI contextへのkiritan state表示（APIは完成、UI側は未着手）
- 昼夜のThree.jsライティング変化の実機目視QA

### LATER / DEFER（06-23から変化なし）

Unity全面移行、WebSocket、自動update、高度な通知、複雑な立ち座り／接触motion、AI生成motion pipeline、複数部屋、WorkerW standalone host、mobile版。

## 9. Yes/No 完成チェックリスト（更新差分のみ）

| 質問 | 06-23 | 2026-07-01 |
|---|---:|---:|
| Directorが通常起動するか | No | **Yes** |
| 壁紙状態がCompanionへ届くか | No | **Yes** |
| 時間帯で背景・照明が変わるか（スキーマ・ロジック） | No | **Yes**（実アートはまだ無い） |
| worktreeがcleanか | No（3 modified） | **Yes** |
| 全lintが通るか | No（01:2 errors, 02:44 errors） | No（01:3 errors=既知, 02:44 errors=変化なし） |
| production buildが通るか | Yes | Yes（継続） |
| motion regression testが通るか | Yes（422 checks） | Yes（**648 checks**） |
| 「日常使いできる完成品」と言えるか | No | **No（ただし壁紙の"生活している"感の中核は今回で揃った。残りはWE package化とCompanion運用品質）** |

## 10. 根拠ファイル（本日分の追加）

- `01_wallpaper/src/VrmViewer.tsx`（Director auto-start・kiritanPoster配線・daypart lighting）
- `01_wallpaper/src/App.tsx`（productionMode修正・daypart state）
- `01_wallpaper/src/lib/motion/director/directorRunner.ts`（`snapshot()`accessor追加）
- `01_wallpaper/src/lib/scene/daypart.ts`（新規）
- `01_wallpaper/src/lib/scene/sceneTypes.ts`, `sceneLoader.ts`（night override schema）
- `01_wallpaper/src/components/SceneBackgroundLayer.tsx`, `01_wallpaper/src/index.css`（night fallback表示）
- `03_companion/src-tauri/src/api.rs`, `models.rs`, `tests/api_test.rs`（kiritan state route）
- `tools/test_daypart.mjs`（新規）
- `docs/POSE_COMPOSER_0_8_PROGRESS.md`（Stage 0-4 green + park記録）

## 11. 次の実装順（推奨）

1. **Companion運用品質（MUST #8）**: single-instance → port競合UI → tray完全終了 → atomic save+backup → API認証/CORS絞り込み。ここが終わると個人利用での「壊れにくさ」が揃う。
2. **Wallpaper Engine実機package（MUST #7）**: 専用project folder、`project.json`、`wallpaperPropertyListener`（FPS/pause）。実機導入試験は目視待ちとして明確に区別する。
3. **背景アート3枚の調達 or 差し替え判断（MUST #6残り）**: 自作/CC0調達/据え置きのいずれかを確定。
4. **配布対象確定（MUST #9）**: 個人利用限定か公開配布かで、モデル差し替え導線・font license・CC-BY creditsの要否が変わる。
