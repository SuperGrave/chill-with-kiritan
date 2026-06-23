# トーホク・ウォールペーパー短期完成に向けた現状監査

- 監査日: 2026-06-23
- 対象: `C:\Users\super\Desktop_Folders\制作\キリタン・ウォールペーパー`
- 監査基準HEAD: `1e9aeec85c77357a8d83fd42f8b361394ed67303`
- ブランチ: `phase1-visual-qa`
- 監査方針: 実装・リファクタ・format・依存更新・コミットは行わず、静的確認、ビルド、テスト、ローカルAPI、実画面、配布物生成までを確認
- 判定語:
  - **WORKING**: 現行コードと実行確認の両方で成立
  - **PARTIAL**: 基礎は動くが日常利用の要件を満たし切らない
  - **MOCK**: 見た目または代替データのみ
  - **BROKEN**: UIや設計はあるが、現行の製品経路では機能しない
  - **MISSING**: 実装または製品経路が存在しない
  - **UNKNOWN**: 外部アカウント、実機環境、権利確認などがなく確定できない
  - **DEFER**: 短期完成ラインから意図的に外すべきもの

## 1. エグゼクティブサマリー

### 結論

このプロジェクトは「技術デモの寄せ集め」ではなく、壁紙レンダラ、情報オーバーレイ、Companionの三要素それぞれに相当量の実装があります。3系統すべてがproduction buildでき、モーション系の自動試験も強い状態です。

一方で、**日常利用できる一つの製品としては未完成**です。最大の理由は、現在の3要素が別々の開発サーバ／別画面として存在し、壁紙本体とオーバーレイを一つの背景面へ合成するproduction entry pointがないことです。また、壁紙側のLife Mode / Motion Directorは通常起動されず、壁紙からCompanionへ状態を送るAPIはCompanion側に存在しないため、実E2EではHTTP 404になります。

短期完成の最適解は次です。

> **Unity化は今は行わない。01_wallpaperと02_ui-overlayを一つのWeb壁紙bundleへ統合し、Wallpaper Engineを最初の壁紙ホストとして使い、03_companionを別EXEとして完成させる。**

理由:

- Three.js / React / VRM / モーションDSL / Director / UIの大部分が既にWeb技術で完成している。
- Unity化は既存資産の移植ではなく、レンダラ、VRM、モーション、UI、API連携、保存、試験をほぼ再実装する計画になる。
- 昼夜表現はUnityでなくても、現行のscene preset、CSS背景、Three.js lightingで十分実装可能。
- Wallpaper Engine公式はHTML/CSS/JavaScriptによるWeb壁紙を正式サポートしている。
- 将来Wallpaper Engineなし版が必要になった時も、同じ統合Web bundleをTauriの壁紙ウィンドウへ載せられる。今Unityへ寄せる必要はない。

### 完成度の概算

| 領域 | 判定 | コメント |
|---|---|---|
| VRM表示・Three.js描画 | WORKING | 実画面でモデル、机、椅子、PC、小物を確認 |
| モーション基盤 | WORKING | Director 90、motions 54、expression 263、POST harness 15、合計422 checks PASS |
| Life Modeの製品起動 | BROKEN | DirectorはLab APIからのみ起動。通常画面ではbuilt-in motionのまま |
| 昼夜の行動変化 | PARTIAL | FSMの時間帯biasは実装済みだが、通常起動されない |
| 昼夜の見た目 | MISSING | sceneは昼1種類。背景画像も未配置でfallback gradient |
| 情報オーバーレイ | PARTIAL | 時計、天気、ニュース表示は動く。デバッグ表示、mock混入、未配線操作あり |
| Companion | PARTIAL | CRUD、設定、tray、API、live weather/news、installer buildは動く |
| 壁紙↔Companion | PARTIAL/BROKEN | 表示preset同期は動く。きりたん状態同期は404 |
| Wallpaper Engine投入 | PARTIAL/UNKNOWN | 技術選択は適合。現行の統合bundle/project.jsonがないため未試験 |
| スタンドアロン壁紙EXE | MISSING | Companion EXEのみ。デスクトップ背景へ埋め込むwall hostなし |
| 公開配布 | BLOCKED | VRM再配布禁止・商用不可、VRMA条件、CC-BY、フォント台帳、署名が未整理 |

## 2. 全体構造

### 現行構成

```text
01_wallpaper
  React + Vite + TypeScript + Three.js + three-vrm
  VRM表示、scene/props、motion DSL、Director、表情、視線、歩行

02_ui-overlay
  React + Vite + TypeScript
  時計、天気、ニュース、Spotify、AI、メモ、dock、表示設定

03_companion
  Tauri 2 + React + Rust + axum
  別窓UI、tray、localhost API、保存、TODO/メモ/リンク/AI/天気/RSS/Spotify
```

`Run_All.bat` は3つを別々の開発プロセスとして起動します。これは開発には便利ですが、完成品の起動経路ではありません。

### 現状のデータフロー

```text
Companion API :40313
  ├─ /api/state ───────> 02_ui-overlay（5秒poll）
  ├─ /api/ui <────────> 02_ui-overlay（3秒poll + 600ms debounce PUT）
  └─ weather/news/CRUD

01_wallpaper
  ├─ Director実装あり
  ├─ kiritanPoster実装あり
  └─ 製品経路に未配線

期待経路:
01_wallpaper POST /api/kiritan/state

実結果:
03_companion POST /api/kiritan/state -> HTTP 404
```

### 構造上の最重要問題

1. 01と02を重ねる製品ホストがない。
2. 01の通常起動が「Motion Probe 0.7」であり、壁紙モードではない。
3. 02は透明オーバーレイだが、別ウィンドウ／別ページのため、そのままでは01へ合成されない。
4. 03はCompanionとして成立し始めているが、壁紙本体を起動・監視・停止する責務を持っていない。
5. Wallpaper Engine用の専用フォルダ、`project.json`、ローカルasset完結、実機検証がない。

## 3. Git / worktree

### 監査終了時点

- branch: `phase1-visual-qa`
- HEAD: `1e9aeec`
- `origin/main`: `adb6c72`
- 差分: current branchがorigin/mainより **15 commits ahead / 0 behind**
- worktree: 1個
- upstream追跡: current branchには表示なし

### 未コミット変更

```text
M 01_wallpaper/public/motions/dsl/loop_sleep_desk.motion.json
M 01_wallpaper/public/motions/dsl/loop_work_normal.motion.json
M 01_wallpaper/public/poses/sit_desk_slump.pose.json
```

監査開始時には`loop_work_normal`の変更がなく、`_probe_spine.motion.json`がuntrackedでした。監査中に外部から作業ツリーが更新されたため、終了時点の内容で壁紙buildとmotion testを再実行しました。再実行結果はbuild PASS、motion 54/54 PASS、lintは既知の2 errorsです。

### リリース管理上の評価

- **BLOCKER**: 完成判定前に、3つの未コミットモーション変更を目視確認し、採用／破棄／再調整を決める必要がある。
- **BLOCKER**: 完成候補の実装がorigin/mainではなく、15 commits先のローカルbranchにのみ存在する。
- **SHOULD**: `phase1-visual-qa`にupstreamを設定し、release候補tagまたは専用branchを作る。
- **SHOULD**: Probe、review、productionをURL queryや手動操作で切り替えるのではなく、build modeで分離する。

## 4. 機能マトリクス

### 01_wallpaper

| 機能 | 判定 | 根拠・問題 |
|---|---|---|
| VRMロード | WORKING | 31.6MBモデルを実画面表示 |
| VRM0 expression bridge | WORKING | 自動試験263 checks PASS |
| 自動まばたき・視線 | WORKING/PARTIAL | 動作するがVRM loaderのmissing morph warningsが多数 |
| SpringBone | WORKING | normal / lightweight / off |
| 30fps制限 | WORKING/PARTIAL | 独自30fps設定あり。Wallpaper Engineのglobal FPS listener未対応 |
| basic props | WORKING | desk/chair/laptop load、placeholder 0 |
| item props | WORKING | cup等のlibraryとmicroEventsあり |
| scene preset | PARTIAL | `room_workdesk_day` 1種類のみ |
| 背景画像 | BROKEN/FALLBACK | `room_back.png`、`outside.png`、`light_overlay.png`が存在せずgradient fallback |
| 昼夜行動bias | WORKING in isolation | Director testでmorning〜lateNight分布を検証 |
| 昼夜行動の通常利用 | BROKEN | Directorは`__motionLab.director(true)`からのみ開始 |
| 昼夜の照明・背景変化 | MISSING | sceneとlightingは昼の固定値 |
| sleep/work/video/walk | WORKING structurally | motion sampler、loop seam、finite値はPASS |
| sleep/work最終見た目 | PARTIAL | 未コミット調整中。自動試験は見た目の接触品質を保証しない |
| away leave/return | WORKING in test | Director/root determinism PASS |
| 通常画面 | BROKEN as product | 起動直後にMotion Probe操作パネルが表示される |
| production asset list | PARTIAL | dev専用`/__lab/ls`へ依存。productionではfallbackする |
| Companion状態POST | BROKEN | posterはあるがviewerへ未配線。Companion routeもない |
| Wallpaper Engine lifecycle | MISSING | `wallpaperPropertyListener`、FPS、pause処理なし |

### 02_ui-overlay

| 機能 | 判定 | 根拠・問題 |
|---|---|---|
| 時計 | WORKING | 実時刻・日付を表示 |
| 天気 | WORKING/PARTIAL | Open-Meteo + JMA live。Sapporo座標がソースに固定 |
| Companion側の天気設定反映 | BROKEN | overlayはCompanion weatherを使わず、独自weather serviceを直接呼ぶ |
| ニュース表示 | WORKING | CompanionからNHK RSS 7件取得、5件表示 |
| ニュースSOURCE表示 | BROKEN | live itemsでも`source` propを渡さず、実画面で`SOURCE: MOCK` |
| ニュースを開く | MISSING | URLはAPIにあるがpanelはリンクとして描画しない |
| Spotify表示 | PARTIAL/UNKNOWN | now playing表示経路あり。実アカウント未設定 |
| Spotify操作 | MOCK/BROKEN | 再生・停止・前後アイコンにonClickなし |
| AI履歴表示 | PARTIAL | Companion stateを表示可能 |
| overlay内AI送信 | MOCK/BROKEN | inputとsend buttonにstate / handlerなし |
| メモ表示 | PARTIAL | Companionに1件以上あればlive |
| 空メモ状態 | BROKEN | Companionが正常接続かつ0件でもmockメモ3件を表示 |
| offline fallback | PARTIAL | 壊れにくいが、mockが実データに見える |
| 表示preset同期 | WORKING | Companionでpreset apply後、約3秒でdebug mode切替を実確認 |
| direct UI更新同期 | PARTIAL | 初回またはactivePresetId変更時のみadopt |
| debug mode | BROKEN as release default | defaultがtrue、実画面にグリッドとDEBUG MODE ON |
| emergency reset | BROKEN as release UI | debug mode falseでも左上に常時表示 |
| 16:9 scaling | WORKING | 1920x1080基準で縮尺 |
| ultra-wide / non-16:9 | PARTIAL | `min(scaleX, scaleY)` + top-left固定で余白が生じる設計 |
| localStorage耐障害性 | PARTIAL | JSON.parse例外処理なし |
| Companion接続表示 | MISSING | stateは持つがユーザーへ表示しない |
| WebSocket | DEFER | pollingで短期完成は可能 |

### 03_companion

| 機能 | 判定 | 根拠・問題 |
|---|---|---|
| Tauri別窓 | WORKING | 440x700実寸でUI確認 |
| tray hide/show | WORKING structurally | closeでhide、tray clickでtoggle |
| localhost API | WORKING | `127.0.0.1:40313`, health 200 |
| weather | WORKING | live Sapporo、errorなし |
| RSS news | WORKING/PARTIAL | NHK 7件live。簡易文字列parser |
| TODO CRUD | WORKING | API integration testあり |
| メモ CRUD | WORKING/PARTIAL | add/pin/delete。既存本文editなし |
| Bookmark CRUD/open | WORKING/PARTIAL | CRUD、Tauri opener。URL validation不足 |
| AI OpenAI/Gemini | UNKNOWN | providerなしでUI/API経路は確認。実キーを使うlive callは未実施 |
| Spotify | UNKNOWN/PARTIAL | manual refresh token方式。OAuth導線・再生操作なし |
| preset管理 | WORKING | save/apply/rename/delete API test、実overlay反映を確認 |
| persistence | PARTIAL | JSON保存は動くが、atomic write、backup、corruption通知なし |
| secrets | PARTIAL/RISK | `/api/state`から除外されるが、平文JSON保存 |
| API認証 | MISSING | tokenなし |
| CORS | RISK | localhost全portと`null` originへ全mutation methodを許可 |
| きりたん状態受信 | MISSING | `/api/kiritan/state` routeなし |
| notifications | MISSING | state fieldのみでCRUDや通知生成なし |
| single instance | MISSING | 二重起動防止pluginなし |
| API port conflict UX | BROKEN | bind失敗はstderrのみで、画面はそのまま起動 |
| autostart | MISSING | plugin、設定、startup登録なし |
| update | MISSING/DEFER | updaterなし |
| export/import/backup | MISSING | 日常データ保全手段なし |
| installer | WORKING | MSIとNSISを実生成 |
| code signing | MISSING | exe/MSI/setupすべてNotSigned |

## 5. ビルド・テスト結果

### 01_wallpaper

| コマンド | 結果 |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | FAIL: 2 errors、1 warning |
| `npm run check:dist-assets` | PASS: dist内VRMなし |
| `npm run check:props` | PASS |

lint:

- `src/App.tsx:331`: effect内の同期setState
- `src/VrmViewer.tsx:937`: React hooks immutability
- `src/lib/lab/reviewPanel.ts:143`: unused eslint-disable warning

build warning:

- JS chunk 約1,154.68KB、gzip約312.48KB

### 02_ui-overlay

| コマンド | 結果 |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | FAIL: 44 errors |

主因:

- `any`多用
- effect内同期setState
- Fast Refresh rule
- `prefer-const`

短期完成では44件すべての美化は不要ですが、lintをrelease gateにするならゼロ化が必要です。

### 03_companion

| コマンド | 結果 |
|---|---|
| `npm run build` | PASS |
| `cargo check` | PASS |
| `cargo test` | PASS |
| `npm run tauri build` | PASS |

Rust tests:

- service unit tests: 2 PASS
- API integration test: 1 PASS

未テスト領域:

- memo/bookmark/chat/news/weather/Spotifyの失敗系
- persistence reload / corrupt JSON / atomicity
- fixed port conflict
- CORS/auth
- double launch
- Tauri UIの自動E2E

### モーション試験

| コマンド | 結果 |
|---|---|
| `node tools/test_director.mjs` | 90 PASS |
| `node tools/test_motions.mjs --all` | 54 PASS |
| `node tools/test_expression_presets.mjs` | 263 PASS |
| `node tools/test_kiritan_post.mjs` | 15 PASS |

合計: **422 PASS / 0 FAIL**

注意:

- `test_kiritan_post.mjs`はmock receiverへの単体疎通試験。実CompanionとのE2Eではない。
- motion testは数値、loop seam、finite値を保証するが、机・椅子・手の見た目接触は保証しない。
- gazeに「degree値として小さすぎる可能性」のwarningが1件ある。

### 生成されたproduction artifact

```text
C:\cargo-build\tohoku-companion\release\tohoku-companion.exe
  13.00 MiB / NotSigned

C:\cargo-build\tohoku-companion\release\bundle\msi\
  Tohoku Companion_0.1.0_x64_en-US.msi
  4.61 MiB / NotSigned

C:\cargo-build\tohoku-companion\release\bundle\nsis\
  Tohoku Companion_0.1.0_x64-setup.exe
  3.12 MiB / NotSigned
```

fresh release exeを直接起動し、`/api/health`が`ok: true`, version `0.1.0`を返すことまで確認しました。

リポジトリ直下の`03_companion/tohoku-companion.exe`は2026-06-12生成で、現行統合より古いstale artifactです。

## 6. E2E

### 実画面確認

#### 壁紙本体

- URL: `http://127.0.0.1:5173`
- VRM表示: 成功
- props: 5/5、placeholder 0
- 表示fps: 約25fps（監査時）
- 起動モーション: `builtin_look_around`
- Motion Director: 未起動
- 起動UI: Motion Probe 0.7パネルが表示
- 背景: room/outsideともfallback gradient

console:

- `THREE.Clock` deprecated warning
- VRM expression morph index missing warningsが多数
- fatal errorは確認されず

#### UI overlay

- URL: `http://127.0.0.1:5174`
- 時計: live
- 天気: live、Sapporo、Open-Meteo/JMA
- news: CompanionのNHK live items
- news badge: 誤って`SOURCE: MOCK`
- memos: Companionは0件だがmock 3件を表示
- AI input: 見た目のみ
- Spotify controls: 見た目のみ
- default: DEBUG MODE ON + grid
- debug false時もEmergency Resetは残る

#### Companion

- dev UIとfresh release exeの両方を確認
- 440x700固定ウィンドウで主要タブは表示可能
- 設定画面は縦scrollが必要だが操作可能
- preset管理画面は実用可能

### API実データ

監査用の初回起動時:

- health: OK
- version: `0.1.0`
- weather: `source=live`, SAPPORO, errorなし
- news: 7件、URLあり
- Spotify: unconfigured
- AI: provider none
- todos: 0
- memos: 0
- bookmarks: default 5
- notifications: 0
- `/api/state`にsecrets propertyなし

初回起動で生成された監査用`companion-data.json`は、監査終了時に削除して起動前の状態へ戻しました。

### 表示preset同期

一時presetをAPIで作成・適用し、overlayのdebug表示が約3秒で消えることを実画面で確認しました。試験presetは削除し、server-side UI設定も元へ戻しました。

判定: **WORKING**

### きりたん状態同期

実Companionへ次を送信:

```text
POST http://127.0.0.1:40313/api/kiritan/state
```

結果:

```text
HTTP 404
```

さらに壁紙通常起動では`KiritanPoster`自体がviewerへ接続されていません。

判定: **BROKEN**

### 01 + 02の合成

現行では別URL、別React app、別dev serverです。TauriにもWallpaper Engineにも、両方を一つの背景面へ載せる設定がありません。

判定: **MISSING**

## 7. 日常利用までの不足

### 起動・終了

- 1クリックの完成品launcherがない。
- `Run_All.bat`は開発サーバを3窓で開く。
- 壁紙本体をWindows desktopへ埋め込むhostがない。
- Companionはcloseでtrayへ隠れるが、UIから完全終了する導線がない。
- single-instanceがなく、二重起動時に固定port conflictが起きる。
- autostartがない。

### 障害時

- Companion API停止時、overlayはmockへ静かに落ちるため、ユーザーが障害を認識できない。
- mockデータが現実のメモ・ニュースのように見える。
- API port bind失敗をUIへ出さない。
- 保存JSON破損時は通知なくdefaultへ戻る。
- backup / import / exportなし。
- network timeoutの明示設定がなく、外部API待ち時間が制御されていない。

### セキュリティ

- APIはloopback限定だが認証なし。
- CORSは任意のlocalhost portと`null` originに対し、GETだけでなくPOST/PUT/PATCH/DELETEも許可する。
- secretsは平文JSON。
- Gemini keyをquery stringに入れている。transport error文字列が公開stateへ保存される経路があるため、URLを含むerror表現ではkeyが露出する可能性がある。少なくともheader方式またはerror sanitizeが必要。
- CSPが`null`。

### 見た目・UX

- 壁紙本体がProbe UIで起動する。
- overlayがdebug modeで起動する。
- emergency resetが常時表示。
- scene背景素材が未配置。
- overlayの空データ表示がmock。
- live newsがmock表記。
- AIとSpotifyの操作が押せそうに見えるが動かない。
- 01と02のデザインを重ねた最終画面が存在しない。

### 性能

- 01 bundleは1.15MB。
- VRMは33MB。
- WebGL + overlay + Companionの同時常駐負荷を長時間計測していない。
- Wallpaper EngineのFPS settingを受け取らない。
- pause時の独自network poll停止や状態整理がない。
- multi-monitor / 21:9 / 16:10の実機確認がない。

## 8. 配布・ライセンス

### VRMモデル

`ふらすこ式風東北きりたん`:

- redistribution prohibited
- commercial use disallowed
- violent / sexual use disallowed

現行buildは`strip-dist-vrm`でVRMをdistから除外し、`check:dist-assets`もPASSします。これは正しい安全策です。

ただし、その結果として配布物だけでは壁紙が動きません。公開配布するなら次のどちらかが必要です。

1. ユーザーが権利元からモデルを取得し、初回起動で指定・コピーする導線
2. 配布可能な別モデル／自作モデルへ差し替える

### VRMA MotionPack

- 改変可
- 商用利用はcredit必須
- モーションまたは改変物を取り出せる状態で二次配布禁止

現行の配布構成で生VRMAをそのまま同梱する場合は再確認が必要です。自作DSL motionだけをproduction poolへ含める方が短期的に安全です。

### props

- basic setはCC0
- variant/itemにはCC-BY 3.0が複数あり、credit必須
- `ASSET_CREDITS.md`の台帳自体は良好
- production UIまたは同梱CREDITSに必須表記を集約する必要がある

### フォント

`WD-XLLubrifontJPN-Regular.otf`が2か所に同梱されていますが、リポジトリ内にフォントlicense / attribution文書を確認できませんでした。

判定: **配布前BLOCKER**

### アプリ本体

- repository rootにプロジェクト全体のLICENSE / NOTICEを確認できない。
- third-party notices生成物がない。
- installer / exeは未署名。
- uninstall、data保存先、privacy、network access、API key保存方法の説明がない。

本節は法的助言ではなく、リポジトリに存在するメタデータと配布物の技術監査です。

## 9. MUST / SHOULD / LATER

### MUST — 短期完成ライン

1. **完成方式を固定する**
   - 推奨: Wallpaper Engine Web wallpaper + Tauri Companion。
   - Unity移行はしない。

2. **01と02を一つのproduction pageへ統合する**
   - Three canvasの上にoverlayを同一DOMで重ねる。
   - 2つのdev serverを完成品から除外。
   - production entryではProbe UI、DebugGuide、Emergency Resetを非表示。

3. **通常起動でMotion Directorを開始する**
   - Lab query不要。
   - productionで使うmotionだけを明示したallow-listにする。

4. **`POST /api/kiritan/state`を実Companionへ実装・配線する**
   - mode、ambient、presence、sleepinessをstateへ保持。
   - Companionの状態タブとAI contextへ反映。

5. **fake-real表示を除去する**
   - Companion接続中かつ0件ならempty state。
   - offline時は`DEMO` / `OFFLINE`を明示。
   - live newsへ`source="live"`を渡す。
   - 未配線のAI/Spotify操作は隠すかdisabled表記。

6. **背景と昼夜の最低限を完成させる**
   - 朝／昼／夕／夜の4 visual preset、または色・light overlayだけでもよい。
   - 欠落PNG参照を残さない。
   - Life Modeのdaypartとvisual daypartを同じ時計から切替。

7. **Wallpaper Engine実機packageを作る**
   - 専用project folder
   - `project.json`
   - local assets完結
   - 16:9、21:9、multi-monitor、pause、FPS、mouse interactionを確認
   - `wallpaperPropertyListener`でFPS / pauseへ対応

8. **Companionの最低限の運用品質**
   - single-instance
   - port bind失敗の画面表示
   - 完全終了メニュー
   - 保存のatomic write + `.bak`
   - API mutationの認証または明確なorigin/token設計
   - secrets error sanitize

9. **配布対象を確定する**
   - private personal buildか、public distributionかを分ける。
   - publicならモデル差し替え／ユーザー指定導線、font license、CC-BY credits、NOTICEを必須化。

10. **dirty motionを確定し、release commitを作る**

### SHOULD — 完成直後

- Companion autostart
- 壁紙／Companion接続status表示
- network timeout / retry / last-success cache
- news click
- Spotify OAuth導線
- memo edit
- backup export/import
- 02 lintの主要型修正
- 01 bundle code splitting
- actual performance soak
- installer表示名、icon、version、Japanese locale
- code signing

### LATER / DEFER

- Unity全面移行
- WebSocket
- 自動update
- 高度な通知システム
- 追加の複雑な立ち座り／接触motion
- AI生成motion pipeline
- 複数部屋の高品質3D asset制作
- Wallpaper EngineなしのWorkerW standalone host
- mobile版

## 10. 完成ライン3案

### 案A: Wallpaper Engine Web壁紙 + 別EXE Companion

```text
統合Web壁紙（01+02） ─ localhost API ─ Tauri Companion
```

- 既存資産の再利用率: 最大
- 短期完成性: 最大
- Wallpaper Engine依存: あり
- standalone化: 後から同じbundleをTauri wall hostへ載せられる
- 最大課題: モデル配布、API security、WE実機packaging

判定: **最短・推奨**

### 案B: Tauri standalone壁紙EXE + Companion別窓

```text
Tauri main process
  ├─ background wallpaper window（統合Web bundle）
  └─ companion window
```

- Wallpaper Engine不要
- 同じWeb実装を再利用可能
- Windows desktopのWorkerW埋め込み、multi-monitor、Explorer再起動復旧が必要
- Tauri 1process / 2windowsにするか、wall hostとCompanionを別processにする設計判断が必要

判定: **次段階として有力。短期完成には案Aより重い**

### 案C: Unity application wallpaper + 別EXE Companion

```text
Unity wall application ─ localhost API ─ Companion
```

- 3D scene、lighting、animation toolingは強い
- Wallpaper Engine application wallpaperへ載せる選択肢はある
- 現行Three.js renderer、React overlay、motion runtime、試験資産を大幅移植
- build size、常駐負荷、二重UI技術、開発期間が増える

判定: **短期完成目的には不適。新作として作り直す時のみ検討**

## 11. 推奨ライン

> **案Aで完成させる。Unity化はしない。01_wallpaperと02_ui-overlayを一つのproduction Web wallpaperへ統合し、03_companionを別EXEとして残す。Wallpaper Engineなし版は、完成後に同じWeb bundleをTauri/WorkerW hostへ載せる。**

昼夜についても、まず以下で十分です。

```text
daypart
  morning -> warm light + morning outside
  midday  -> current day scene
  evening -> orange/purple overlay
  night   -> dark blue room + monitor light
```

Three.js light、CSS background、scene JSONを切り替えるだけなので、Unityへ移る根拠にはなりません。

Wallpaper Engine 2.8.0.36がこのPCで実際に起動中であることは確認しました。ただし現行repoにはWE用の統合projectがないため、実投入試験は未実施です。

公式資料:

- Web wallpaperはHTML/CSS/JavaScriptで作成可能  
  https://docs.wallpaperengine.io/web/overview.html
- 必要assetはproject folderへ同梱し、offlineでも壊れない構成が推奨  
  https://github.com/Wallpaper-Engine-Team/wallpaper-engine-docs/blob/master/docs/en/web/first/gettingstarted.md
- `wallpaperPropertyListener`でuser properties、FPS、pauseを受信可能  
  https://github.com/Wallpaper-Engine-Team/wallpaper-engine-docs/blob/master/docs/en/web/api/propertylistener.md
- complex web wallpaperではWallpaper Engine側のFPS limitを適用することが推奨  
  https://github.com/Wallpaper-Engine-Team/wallpaper-engine-docs/blob/master/docs/en/web/performance/fps.md

## 12. Yes / No 完成チェックリスト

| 質問 | 現在 | 完成条件 |
|---|---:|---|
| 1つの操作で壁紙とCompanionを起動できるか | No | production launcher / WE project |
| 01と02が同じ背景面に表示されるか | No | 統合page |
| 起動直後に開発UIが出ないか | No | production mode |
| Directorが通常起動するか | No | auto start |
| 時間帯で行動が変わるか | No in product | Director通常配線 |
| 時間帯で背景・照明が変わるか | No | visual daypart |
| 壁紙状態がCompanionへ届くか | No | API route + poster wiring |
| Companion presetがoverlayへ届くか | Yes | 実E2E確認済み |
| 天気がliveか | Yes | 現在Sapporo固定 |
| Companionの地域変更がoverlay天気へ反映されるか | No | data source統一 |
| ニュースがliveか | Yes | 表示badge修正必要 |
| 空データでfake memo/newsが出ないか | No | empty/offline state |
| overlayのAI送信が動くか | No | handler追加または非表示 |
| Spotify操作が動くか | No | endpoint/handler追加または非表示 |
| 16:9以外で保証されるか | No | responsive QA |
| Wallpaper Engine projectがあるか | No | project作成 |
| Wallpaper Engineでpause/FPSに追従するか | No | listener対応 |
| standalone wallpaper EXEがあるか | No | 後段Tauri wall host |
| Companion installerが生成できるか | Yes | MSI/NSIS PASS |
| installerが署名済みか | No | signing |
| 二重起動を防げるか | No | single-instance |
| 保存データにbackupがあるか | No | atomic + backup |
| API keyがOS credential storeにあるか | No | keyring等 |
| VRMを合法に公開配布できるか | No | 別モデルまたはuser-supplied |
| font licenseが同梱されているか | No | license確認・追加 |
| CC-BY creditが完成品に表示されるか | No | CREDITS/NOTICE |
| worktreeがcleanか | No | 3 modified files |
| 全lintが通るか | No | 01:2 errors、02:44 errors |
| production buildが通るか | Yes | 3系統PASS |
| motion regression testが通るか | Yes | 422 checks PASS |
| 「日常使いできる完成品」と言えるか | **No** | MUST完了後 |

## 13. 根拠ファイル

### ルート・起動

- `README.md:8-34`
- `Run_All.bat`
- `Run_Wallpaper.bat`
- `Run_UI.bat`
- `Run_Companion.bat`

### 壁紙

- `01_wallpaper/src/App.tsx:340` — Probe panel default visible
- `01_wallpaper/src/App.tsx:394` — dev `__lab/ls`
- `01_wallpaper/src/VrmViewer.tsx:589-639` — Director start/stop
- `01_wallpaper/src/VrmViewer.tsx:976-998` — Lab query時だけAPI install
- `01_wallpaper/src/VrmViewer.tsx:1392-1393` — 実時間hourをDirectorへ渡す
- `01_wallpaper/src/lib/motion/director/kiritanPoster.ts`
- `01_wallpaper/public/scenes/room_workdesk_day/scene.json`
- `01_wallpaper/src/components/SceneBackgroundLayer.tsx`
- `01_wallpaper/scripts/strip-dist-vrm.cjs`
- `01_wallpaper/scripts/check-dist-assets.cjs`

### オーバーレイ

- `02_ui-overlay/src/App.tsx:48-89` — Companion UI sync
- `02_ui-overlay/src/App.tsx:177-180` — live/empty時のmock fallback
- `02_ui-overlay/src/App.tsx:194-217` — 常時Emergency Reset
- `02_ui-overlay/src/App.tsx:276` — NewsPanelへsource未指定
- `02_ui-overlay/src/config/uiSettings.ts:86-87` — debug true / 1920x1080
- `02_ui-overlay/src/services/weatherService.ts:5-6` — Sapporo固定
- `02_ui-overlay/src/components/panels/NewsPanel.tsx:14-17,132`
- `02_ui-overlay/src/components/panels/MusicPanel.tsx`
- `02_ui-overlay/src/components/panels/AiPanel.tsx`
- `02_ui-overlay/src/services/companionClient.ts`

### Companion

- `03_companion/src-tauri/src/api.rs:16,22-64` — fixed port、CORS、routes
- `03_companion/src-tauri/src/state.rs:39-103` — data dir、平文JSON、direct write
- `03_companion/src-tauri/src/services.rs:184-210` — Gemini URL key
- `03_companion/src-tauri/src/lib.rs:17-64` — server、tasks、tray、close hide
- `03_companion/src-tauri/src/models.rs`
- `03_companion/src-tauri/tests/api_test.rs`
- `03_companion/src-tauri/tauri.conf.json`
- `03_companion/src/App.tsx`

### ライセンス

- `docs/model-audit/VRM_MODEL_AUDIT_flasco_kiritan.md:17-24`
- `01_wallpaper/public/models/props/ASSET_CREDITS.md`
- `assets/motion-pack/Readme_VRMA_MotionPack_JP.txt`
- `02_ui-overlay/public/fonts/WD-XLLubrifontJPN-Regular.otf`

### 試験

- `tools/test_director.mjs`
- `tools/test_motions.mjs`
- `tools/test_expression_presets.mjs`
- `tools/test_kiritan_post.mjs`

## 14. 次の実装順

### Step 0 — release基準を固定

1. 現在の3 dirty motionを目視確認。
2. 採用値を確定。
3. motion 54/54、director 90/90、expression 263/263を再実行。
4. release候補commitを作る。

### Step 1 — production wallpaper shell

1. 01を親appにする。
2. 02の主要componentを01へ組み込むか、共通package化する。
3. 同一DOM上で`background -> Three canvas -> overlay`の順に重ねる。
4. productionではProbe panel、debug guide、reset buttonを隠す。
5. mockを`demoMode`明示時だけ使う。

### Step 2 — Life Modeを通常起動

1. VRM/scene/motions preload完了後にDirector start。
2. production motion allow-listを固定。
3. daypartをReact stateへ公開。
4. morning/day/evening/nightのlight/background presetを切替。

### Step 3 — Companion E2Eを閉じる

1. `/api/kiritan/state`追加。
2. `KiritanPoster`をviewerへ接続。
3. Companion状態タブへmode/presence/ambientを表示。
4. overlay weatherをCompanion stateへ一本化。
5. live/mock/offline badgeを正しくする。

### Step 4 — 日常利用の安全策

1. single-instance。
2. port conflict UI。
3. trayに「表示」「壁紙再読込」「完全終了」。
4. atomic save + backup。
5. API auth/token、CORS read/write分離。
6. Gemini error sanitize。

### Step 5 — Wallpaper Engine package

1. 専用project folderを作る。
2. production buildを配置。
3. `project.json`作成。
4. `wallpaperPropertyListener`追加。
5. FPS / pause / mouse / offline / CEF console確認。
6. 1920x1080、2560x1080、複数monitorでQA。
7. Companion起動中／停止中の両方を試す。

### Step 6 — 配布判断

#### 個人利用完成

- user local VRM配置でよい。
- unsigned installerでも本人利用は可能。
- creditsは同梱推奨。

#### 公開配布完成

- 配布可能モデルまたはfirst-run model import必須。
- font license必須。
- CC-BY credits必須。
- VRMA同梱形態の再確認。
- LICENSE / NOTICE / privacy / data path説明。
- code signing推奨。

### Step 7 — 完成後

Wallpaper Engine版が安定してから、同じproduction bundleをTauriのbackground windowへ載せるstandalone版を作る。この段階でもUnity移行は不要です。
