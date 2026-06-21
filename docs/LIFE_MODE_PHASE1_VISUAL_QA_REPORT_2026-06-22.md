# きりたん生活モード Phase 1 — 実機ビジュアルQA 修正レポート

**日付:** 2026-06-22
**対象:** 「Phase 1 実機ビジュアルQA不合格項目 修正指示書」問題①〜⑮
**ブランチ:** `phase1-visual-qa`（push なし・ローカルcheckpoint運用）
**検証チャネル:** Motion Lab freeze-capture（静止ポーズ目視＝ヘッドレスでも実効）＋ Node機械テスト ＋ `?phase1Review=1` レビューUI（連続再生の実機目視はマスター用）

> **重要な環境制約:** ヘッドレスのプレビューは `document.visibilityState=hidden` で **rAF が凍結**する（実測: rAFカウンタが進まない）。よって連続再生・クロスフェード・microEvents発火・root前進の**動画的目視は当方では不可**。本レポートの目視は (1) Lab の freeze+toDataURL による**静止キーポーズ**、(2) `layoutSnapshot()` による**手・小道具のワールド座標の数値照合**で行った。連続再生の最終サインオフは §E のレビューUIでマスターが実施されたい。

---

## A. 問題別対応表

| # | 問題 | 原因 | 修正 | 検証 | 状態 |
|---|------|------|------|------|------|
| 1 | 再生後に立位へ戻る | Lab `play()` の単体一発再生は終了後 `notifyFinished()`→立位idleへフェード（Director経路は元々Loop復帰していた） | `motionContext.ts` レジストリ（ambient/transition→所属Loop、設計表から導出）＋ Lab `play(id,{settleToContextLoop:true})` ＋ host の `pendingSettle`。Director も同一 `PHASE1_MODE_LOOP` を共有 | Test C §9 で issue①の対応表を機械検証（amb/tr→正Loop）。`play` が `settleLoop` を返すことを確認 | **PASS**（連続目視＝§E） |
| 2 | 睡眠が机に突っ伏していない | `sit_desk_slump` に腕枕が無く、頭ドロップが背もたれ寄りに見えた | `loop_sleep_desk` 再制作: 両前腕を机上で枕に・頬を腕へ・顔は横向き(+y)で少し見える・閉眼・静かな寝息。`tr_sit_to_slump`/`tr_slump_wake` の腕端点を新Loopへ一致 | side/3-4 capture で前傾突っ伏し＋顔可視を確認。端点 delta 0 | **PASS** |
| 3 | 動画視聴が後傾に見えない | slouch postureが浅く、腕も作業と同じ下垂で差が出ない | `loop_video_relax` 再制作: spine/chest を追加 -x で明確に後傾・両手を膝へ脱力・打鍵停止。work(前傾＋前腕KB)と横シルエットで一目で別 | work_side と video_side の比較capture で明確差。loop seam 0 | **PASS** |
| 4 | 通常作業でキーボードを打っていない | ループが呼吸オシレータのみで腕トラック皆無（元notesに「content拡張で追加予定」） | `loop_work_normal` 再制作: 両前腕を内転(z>1.15)＋前(y-)＋肘曲げでキーボード高さへ収束・打鍵2バースト＋画面確認の小休止・呼吸・モニター視線 | topfront/side capture で前腕がノートPCへ収束。打鍵オシレータ peak 0.26/trough -0.02/休止 0.12 を数値確認 | **PASS** |
| 5 | 立ち座り・歩行が機械的 | 立ち座りに腕・手の支えが無く、腕端点も新Loop不一致 | `tr_sit_to_stand`/`tr_stand_to_sit` に腕トラック追加（起立/着座で手を腿へ press、着座端=タイピング腕）。**重心連動の本格再設計・椅子連動・歩行加減速の再磨きは未** | 端点 delta 0 で復帰時の腕ポップ解消。away往復 Test C §7 PASS | **一部PASS / 残** |
| 6 | シーン配置・スケール不統一 | 実効配置が scene.json＋variant＋item の実行時合成で、単一の正典記録が無かった | canonical layout を明文化 `layout.canonical.json`（resolved world座標）。Lab==本番のパリティ確認（variant registry default = localStorage選択） | `layoutSnapshot()` で desk top0.73 / chair / laptop / cup / camera を実測記録。build/起動再現 | **PASS** |
| 7 | カップを取る手が左右逆 | cupが本人の左(world +x)にrestし、sipも左手で著作 | cup rest を本人の右(world -x)へ。`amb_work_sip` を**右手**で全面再制作。library の旧 `hand_l` grip を削除 | sip が rightHand bone で attach。grip は hand_r のみ | **PASS** |
| 8 | 小道具取得位置を実配置へ | モーションが想定固定位置へ手を伸ばし、実prop位置と乖離 | `layoutSnapshot()` API で prop/手の実ワールド座標を著作時に取得。cup reach を**実測カップ位置**へ合わせて著作 | attach時 手-カップ距離 2.7cm / detach時 1.5cm（数値照合） | **PASS** |
| 9 | 「おっ」の口・視線が不足 | `amb_vid_eyes_widen` に `gaze` 無し・口 o が弱め | 再制作: ①視線が対象へ先行(t0.25, 体反応t0.6より前) ②目見開き(surprised_light=bikkuri0.50) ③上体craning ④口 o0.42 ⑤保持→overshoot→settle | face close capture で見開き＋o＋眉上げを確認。gaze が体に先行することを samplePose で確認 | **PASS** |
| 10 | 椅子も動作へ同期 | 椅子が静的prop。DSLに scene-prop transform track が無い | **未実装（設計のみ・§F）**。rootMotion機構の汎用化 or 新 `scenePropTrack` が必要 | — | **残（Major）** |
| 11 | きりたんと椅子の位置関係 | （#6に内包）座位hipsと座面の整合 | canonical layout基準で座位postureを確認（hips座面・前傾/後傾の差）。きりたんぽ↔椅子の重なりは指示通り非優先 | 各座りLoopのcapture で腰浮き・大貫通なしを確認 | **PASS**（重なりは許容） |
| 12 | カップが左後方へワープ・手につかない | **根因=カップが腕の到達範囲外(-0.52)** にあり、手が届かないまま attach がカップを手へテレポート | cup を**右手の到達域内**[-0.25,0.73,0.17]へ（実測reach envelope）。attach/detach は手がカップ位置に在る瞬間のみ | attach時 2.7cm / detach時 1.5cm = ワープ無し。grip 校正済 | **PASS** |
| 13 | Ambient全体の視線を自然に | 多くの ambient が legacy `lookAt:fixed`（死んだ目寄り） | `gaze` を付与: eyes_widen / chuckle(モニタ中央) / nod_watch / head_bob(焦点が落ちる→はっで上)。screen_scan/sip は既存。残4本(neck_roll/posture_reset/slow_blink/tilt_drift)は legacy のまま | 4本を harness 20/20。gaze marker(レビューUI)で動き確認可 | **一部PASS / 残(Minor)** |
| 14 | カップと腕が口元から遠い | 腕が到達域外＋飲み姿勢が低く口元へ届かない | 飲みポーズ=旧左手飲みのミラー（上腕を上げ内転・肘大屈曲）で手を口元高さへ＋頭をカップ側へ寄せ＋カップ傾け | 飲み capture で口元にカップ・傾き・隙間僅少を確認 | **PASS** |
| 15 | 全モーションの人間味再レビュー | JSON上12原則があっても完成映像で十分とは限らない | 再制作した全モーションは12原則(予備/フォロースルー/弧/副次/slow-in-out/時間差)で著作。**全モーションの連続映像での網羅再レビューは未** | 各キーポーズcapture。連続映像はレビューUI(§E) | **一部PASS / 残** |

---

## B. canonical layout

- **使用ファイル:** `01_wallpaper/public/scenes/room_workdesk_day/layout.canonical.json`（リファレンス／正典記録。アプリ自体は従来どおり `scene.json` + variant + item を実行時合成し、Labも本番も同一経路を使う＝二重定義を避けた）
- **取り込み方法:** 実行時の実効ワールド座標を `window.__motionLab.layoutSnapshot()` で取得し記録。変更時は再取得して更新。
- **主要transform（world m, キャラは +Z 向き＝本人の右は world -x）:**
  - 床 y=0 / desk top y=**0.73** / character root [0,0,0] rotY=π
  - chair: backrest top 0.949, center[-0.01,0.47,-0.39]（座面〜0.45-0.47）
  - laptop(monitor): screen center[0,0.89,0.50], top1.056 / 本番camera [0.4,0.9,0.8]→[0,1,0] fov40
  - **cupRest（正典・右手用）: bottom[-0.25,0.73,0.17] / center[-0.25,0.78,0.17]** ← 右手reach実測域内
  - phoneRest center[0.63,0.73,0.14]
  - variant: desk_office_metal / chair_office / pc_laptop_modern（registry default＝本番でも同一）
- **旧配置との差分:** cup を [+0.52]（本人の左・到達域外）→ **[-0.25]（本人の右・到達域内）** へ移設（issue⑦⑫⑭の根本対応）。他のprop/desk/chair/laptopは現行の理想配置を正典として確定。

---

## C. 作り直したモーション

| ID | 旧問題 | 新しい姿勢・演技 | 視線対象 | prop | 12原則 | 戻り先Loop |
|----|--------|----------------|---------|------|--------|-----------|
| loop_work_normal | 腕下垂・非タイピング | 前腕をKBへ収束・打鍵2バースト＋画面確認休止・呼吸 | モニター（時々KB） | — | slow-in-out/弧/時間差(肩-手) | (自身) |
| loop_video_relax | 作業と同一 | 明確後傾・両手膝・打鍵停止・緩い表情 | モニター | — | 後傾の重さ/副次の頭揺れ | (自身) |
| loop_sleep_desk | 背もたれ寝に見える | 机へ突っ伏し腕枕・頬を腕へ・横向き顔可視・閉眼・寝息 | 閉眼(off) | — | 呼吸の上下/重さ | (自身) |
| loop_work_sleepy | 腕下垂（不整合） | KB腕付与（work系一貫）＋既存の船漕ぎ | 下方(焦点低) | — | 既存 | (自身) |
| amb_work_sip | 左手・ワープ・口元遠い | **右手**でreach→口元→傾け飲み→机戻し→タイピング復帰 | カップ→前方→カップ | cup | 予備/弧/肩肘手首時間差/飲後の間 | loop_work_normal |
| amb_vid_eyes_widen | 口・視線不足 | 視線先行→見開き(bikkuri)→口o→craning→overshoot | 画面内対象(先行) | — | 予備/誇張/時間差/settle | loop_video_relax |
| amb_vid_chuckle / nod_watch / amb_slpy_head_bob | gaze無し | gaze付与（モニタ中央 / 内容 / 焦点落ち→はっ） | 各記載 | — | 既存＋視線 | 各mode loop |
| tr_lean_back / forward | 旧Loop端点 | 新Loop姿勢(腕含む)へ端点一致 | — | — | 予備/overshoot/hips bridge | video / work |
| tr_sit_to_slump / slump_wake | 旧Loop端点・腕無し | 腕KB↔腕枕を補間し端点一致 | — | — | 脱力/起き上がり | sleep / work |
| tr_sit_to_stand / stand_to_sit | 腕無し（復帰ポップ） | 腕端点をタイピングへ・起立/着座で手を腿press | — | — | 予備/手支え | (away/work) |

---

## D. 検証

| 項目 | 結果 |
|------|------|
| `tsc -b`（01_wallpaper） | ✅ EXIT 0 |
| production build（`npm run build`） | ✅ EXIT 0（vrm strip正常） |
| Test C（`tools/test_director.mjs`） | ✅ **90/90**（旧71 + §9 文脈Loop復帰レジストリ19件） |
| Motion validation（`tools/test_motions.mjs --all`） | ✅ **54/54**、validator warnings **0**、loop seam **0** |
| 文脈Loop復帰マッピング | ✅ issue①一覧と一致（Test C §9） |
| cup attach/detach ワープ | ✅ attach時手-カップ 2.7cm / detach時 1.5cm（数値） |
| transition 端点一致（lean/slump/stand-sit） | ✅ 新Loop腕値と delta 0 |
| 「おっ」表情 | ✅ bikkuri0.50/mayu_ue0.39/o0.42・gaze先行 |
| Lab 静止キーポーズ目視 | ✅ work/video/sleep/cup/おっ を各アングルで確認 |
| 連続再生（クロスフェード/microEvents/root前進） | ⏳ ヘッドレス不可 → §E レビューUIでマスター確認 |

---

## E. マスター確認手順（`?phase1Review=1` レビューUI）

開発専用（本番非汚染）。`http://localhost:5187/?lab=1&phase1Review=1` で右上にパネル。

```
1. dev起動: npm --prefix 01_wallpaper run dev -- --port 5187
2. ブラウザで ?lab=1&phase1Review=1 を開く（VRMロード待ち）
3. [モードLoop] work_normal を押し 10秒観察 → タイピングに見えるか
4. [モードLoop] video_relax → 明確に後傾・手が膝か（workと一目で違うか）
5. [モードLoop] sleep_desk → 机へ突っ伏し・顔が少し見えるか
6. [Ambient] amb_work_sip を「▶再生 →Loop復帰」→ 右手で取り口元で飲み、机へ戻し、**立位に戻らず work_normal Loopへ復帰**するか（issue①⑦⑫⑭）
7. [Ambient] amb_vid_eyes_widen →「おっ」の見開き＋口＋視線先行、終了後 video_relax へ復帰
8. [Transition] tr_lean_back/tr_sit_to_slump を「→Loop復帰」→ 遷移先Loopへ繋がるか・腕がポップしないか
9. [Director] work_normal から ▶開始 → 無操作で ambient/遷移/離席(away)が自走するか
10. [デバッグ表示] 視線マーカー ON で各Ambient再生 → 目が動くか／カメラ目線が混ざらないか
11. [デバッグ表示] propアンカー/手 ON → cupアンカーに右手が届くか
```

console派は `__motionLab.help()` / `__motionLab.layoutSnapshot()` も利用可。

---

## F. 残課題（重大度別）

**Blocker:** なし（機械テスト全green・主要ビジュアル不整合は解消）

**Major:**
- **issue⑩ 椅子の動作同期（未実装）**: 椅子を可動propとして立つ/座る/机寄せに同期させる機構が未。設計案=DSLに `scenePropTrack`（`{t,position?,rotation?}` 絶対評価）を追加し、compile→viewer が `prop:chair` コンテナへ毎フレーム適用（rootMotion同様の絶対評価で前フレーム加算しない）。または既存 rootMotion 機構の汎用化。実装後 tr_sit_to_stand/stand_to_sit に椅子引き/寄せを同期。
- **issue⑤/⑮ 立ち座り・歩行の本格的人間化**: 立ち座りの腕端点・手支えは入れたが、重心移動の段階(足引き→前傾→椅子後退→hips上昇→胸頭遅れ)・歩行の加減速/接地足の再磨きは連続映像での調整が必要（ヘッドレス不可）。レビューUIでの目視→反復を推奨。

**Minor:**
- **issue⑬ 残4 ambient の gaze 化**: `amb_work_neck_roll` / `amb_work_posture_reset` / `amb_slpy_slow_blink` / `amb_slpy_tilt_drift` は legacy `lookAt:fixed` のまま（破綻ではないが「生きた目」化の余地）。`gaze` へ変換推奨。
- 連続再生でのみ判る項目（クロスフェードの滑らかさ・microEvents実発火・root足滑り・SpringBone長時間挙動）は §E でマスター確認。

**Polish:**
- sleep の腕枕は頬と前腕の接触がノートPCに一部隠れ近似。頭yawの微調整余地。
- 本番camera(monitor_side)はノートPCが手元を大きく遮蔽するため、タイピング/カップは上体・腕で読ませる設計。必要ならcamera見直し（canonical camera は別途）。

---

## 付録: コミット系列（branch `phase1-visual-qa`・未push）

```
2559639 checkpoint: green baseline
52c9f80 Stage 1 文脈Loop復帰
2ba3c8b Stage 2 canonical layout + cup右
e9f3ca1 Stage 3 主要Loop3本再制作
7ef53e1 Stage 4 transition端点
1b3bec2 Stage 5 cup右手再制作
49528dc Stage 6 + Review UI（gaze/表情 + ?phase1Review）
2bb0641 Stage 7(部分) 立ち座り腕端点
```
