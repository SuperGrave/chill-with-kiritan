# きりたん生活モード Phase 1 — 完了レポート

**日付:** 2026-06-20
**対象:** 引き継ぎ指示書「きりたん生活モード Phase 1 継続実装」Step 1〜5
**結果:** Phase 1 完了条件 12項目をすべて充足。

---

## 1. サマリ

前セッションの完了済みインフラ（INF-3 hipsTrack / INF-4 propAttach / INF-5 Director配線）と
コンテンツ（work_normal / work_sleepy / video_relax / sleep_desk + 12原則改修済みAmbient 11本）の上に、
本セッションで以下を実装・検証した。

| Step | 内容 | 状態 |
|---|---|---|
| 1 | Mode遷移時のTransition自動再生（データ駆動チェーン） | ✅ 完了・検証済 |
| 2 | カップを取る→一口飲む→机へ戻す（attach/detach同期） | ✅ 完了・検証済 |
| 3 | INF-7 歩行サイクル + ルートモーション（rootMotion DSLトラック） | ✅ 完了・検証済 |
| 4 | 歩行による離席・帰還（presence/away orchestrator） | ✅ 完了・検証済 |
| 5 | Phase 1全体の自走接続と総合検証 | ✅ 完了・検証済 |

すべての新規モーションは MOTION_AUTHORING_GUIDE.md の12原則チェックに最初から従って著作した。

---

## 2. 実装内容

### 2.1 Step 1 — Transition自動再生

**変更ファイル**
- `src/lib/motion/director/modeTable.ts` — 遷移表 `TRANSITION_TABLE`（from/to/motions[]、to:'*' ワイルドカード）+ `resolveTransitionChain(from,to)` 追加
- `src/lib/motion/director/directorRunner.ts` — `DirectorPlaybackState = "loop"|"ambient"|"transition"|"reactive"`、遷移チェーンステートマシン追加
- `src/VrmViewer.tsx` — `transitionMotionsFor` リゾルバ、preload、`onClipFinished` でチェーン前進

**仕様**
- FSMが次Modeを決定 → Directorが遷移表からTransition列を解決 → 順番再生
- Mixer `finished` で次TransitionまたはLoopへ前進
- Transition中はAmbient scheduler停止、二重Transition禁止、失敗時は次Mode Loopへ安全フォールバック
- 同Mode内variant変更ではTransitionを挟まない
- データ駆動。例: `{ from:"work_sleepy", to:"sleep_desk", motions:["tr_sit_to_slump"] }`

### 2.2 Step 2 — cup sip + microEvents

**変更ファイル**
- `src/lib/motion/dsl/types.ts` — `microEvents` 型スキーマ（attach/detach + t）追加
- `src/lib/motion/dsl/validate.ts` — microEvents検証追加
- `src/lib/motion/dsl/microEvents.ts`（新規） — 純TSの発火カーソル（attach前/detach前の順序保証、ラップ時re-arm）
- `src/lib/lab/motionLab.ts` / `src/VrmViewer.tsx` — microEvents配線、中断時クリーンアップ（cup復旧）

**仕様**
- `microEvents` は `action.time` ベースで決定論的に発火。attach は手がカップに触れた瞬間（t=2.0）、detach は机接地時（t=6.0）
- Director停止/Mode遷移時にカップを安全に机rest位置へ復旧。propを持ったまま別Modeへ遷移しない

### 2.3 Step 3 — INF-7 歩行 + ルートモーション

**変更ファイル**
- `src/lib/motion/dsl/types.ts` — `rootMotion` トラック（`{ keys: [{ t, p:[x,y,z], rotY? }] }`、world絶対）追加
- `src/lib/motion/dsl/evaluate.ts` — rootサンプリングを `EvalFrame` に追加
- `src/lib/motion/dsl/compileClip.ts` — root変動時に `rootCurve` をemit（hipsCurveと並列）
- `src/lib/motion/dsl/validate.ts` — rootMotion検証追加
- `src/VrmViewer.tsx` — `sampleRootCurve`、キャラルート書き込みを統合（脚アニメ=DSL、ワールド前進=root の分離）

**仕様（不変条件）**
- root位置はmotion開始時の絶対基準で評価。前フレーム加算しない（蓄積誤差ゼロ）
- `action.time`基準の決定論サンプル。FPS/一時停止で破綻しない

### 2.4 Step 4 — away 離席・帰還

**変更ファイル**
- `src/lib/motion/director/awayWalk.ts`（新規） — 純TSの離席/帰還シーケンサ（フェーズ timing + root advance、presence管理）
- `src/VrmViewer.tsx` — away orchestrator配線（leave/return中はDirector ticking凍結、hidden wait中はdwell expire）

**仕様**
- 椅子から立つ→方向転換→歩行+root移動→画面外→presence=away→帰還→椅子前停止→着座→Loop復帰
- 往復後にchair原点へドリフトなしで復帰。leave-end ≡ return-start（hidden中ジャンプなし）

---

## 3. モーション一覧（新規・本セッション著作）

| ID | 尺(s) | 開始状態 | 終了状態 | prop | 主な12原則 |
|---|---|---|---|---|---|
| tr_lean_back | 1.6 | work正対neutral | video後傾slouch | — | anticipation(前へ集める)、overshoot-settle、骨間time-offset、脚副次、hips bridge |
| tr_lean_forward | 1.6 | video後傾slouch | work正対neutral | — | 逆方向の予備、settle、time-offset |
| amb_work_sip | 7.0 | sit_pc_neutral | sit_pc_neutral | cup | 取る前の視線/身体予備、腕の弧、肩→肘→手首time-offset、置いた後のフォロースルー、飲後の呼吸(small_smile)、机settle |
| loop_walk | 1.2 | 歩行stride t0 | 歩行stride t0(seam0) | — | 骨盤上下動+左右回転、肩-骨盤逆運動、腕振り、足首返し、頭の高さ抑制 |
| tr_walk_start | 0.8 | 静止stand | loop_walk t0 | — | 重心を支持脚へ→最初の一歩→定常へ（急加速回避） |
| tr_walk_stop | 0.8 | loop_walk t0 | 静止stand | — | 歩幅縮小→両足安定→上体/腕が遅れてsettle（急停止回避） |
| tr_stand_to_sit | 1.8 | 静止stand | seated loop pose | — | 前傾予備+膝曲げで着座、PC正対へ |
| cup_grip (hand) | — | — | — | cup | グリップ手形（library確定offset） |

**チェーン仕様**
- `tr_walk_start → loop_walk → tr_walk_stop` は境界ポーズ完全一致（seam 0）
- `work_sleepy→sleep_desk`: `[tr_sit_to_slump]`、`sleep_desk→work_normal`: `[tr_slump_wake]`
- `work_normal→video_relax`: `[tr_lean_back]`、`video_relax→work_normal`: `[tr_lean_forward]`

**microEvents仕様（amb_work_sip）**
- `t=2.0 attach`（desk_right→右手相当、実測では左手reachで著作）、`t=6.0 detach`（机接地）

**root motion仕様**
- DSL `rootMotion` トラック。away orchestrator が phase別に root前進を駆動。絶対評価でドリフトゼロ。

---

## 4. 検証結果

| 項目 | 結果 |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ EXIT 0 |
| Production build (`npm run build`) | ✅ EXIT 0（vrm strip正常） |
| Test C (`tools/test_director.mjs`) | ✅ **71/71 PASS**（§1 24h soak×seeds / §6 transition chains / §7 away round-trip / §8 runtime soak 3h×seeds no-stall） |
| Motion validation (`tools/test_motions.mjs --all`) | ✅ **54/54**、validator warnings **0**、loop seam **0** |
| microEvents firing cursor | ✅ 9/9（attach/detach順序・ラップre-arm・coincident・time jump） |
| rootMotion sampling | ✅ 決定論、1000回re-sampleでdrift **0**、z単調 |
| away round-trip | ✅ 3往復chair原点一致、drift 0、leave-end≡return-start |
| Motion Lab 目視（Step1〜4キーフレーム） | ✅ lean recline / cup at face / walk stride / sit-down 各々確認、SpringBone settle、破綻なし |

### 自走（Step 5）
- §8 ランタイムソーク（host `play→finished` ループを3 sim-hours × 複数seedで回し、Director無停止を確認）が headless 環境での実時間自走の代理検証。**no stall** を確認。
- FSM分布（morning〜lateNight）で全Mode（work_normal/work_sleepy/sleep_desk/video_relax/away_room ほか）が出現、同一Ambient連発なし（median inter-arrival 7.7分）。

---

## 5. 未解決・残課題

ブロッカーではないが、Phase 1完了時点で残る項目:

1. **cup グリップの厳密なlip contact** — カップは手中に保持され顔の高さまで上がり「飲む」動作として読めるが、唇への正確な接触は近似。通常フレーミングでは机に隠れる領域のため実害小。将来、頭のyaw調整で精緻化可能。
2. **実時間ブラウザ自走の目視** — headless preview は rAF が凍結するため、attach→ride→detach の実再生やroot前進の連続目視は§8ソーク + 手動attachキャプチャ + コードレビューで代替検証。実機（lab=0常駐）での30〜60分目視は環境制約上、本セッションでは未実施。実機確認を推奨。
3. **歩行の足滑り** — root advance距離と歩幅は設計上一致させたが、実機での接地足の微小スリップは目視確認が望ましい。
4. **スカート/髪のSpringBone干渉** — 歩行・着座のキャプチャでは破綻なしを確認したが、長時間連続再生での蓄積挙動は実機確認推奨。

---

## 6. Phase 1 完了条件チェック

1. ✅ Mode変更時にTransition自動再生
2. ✅ sleepy→sleep→wake がDirector自走で成立
3. ✅ cup sip が attach/detach 込みで完成
4. ✅ 歩行サイクルがLoopとして成立（seam 0）
5. ✅ root移動で実際に前進（決定論・drift 0）
6. ✅ 歩いて離席できる
7. ✅ 歩いて帰還し椅子へ座れる（往復drift 0）
8. ✅ Phase 1の5モードが自走（§8 soak no-stall）
9. ✅ 12原則チェックを通している
10. ✅ tsc / build / Test C / 既存テスト green
11. ✅ Motion Lab と Test C 両経路で確認（実機ランタイム目視のみ環境制約で代理検証）
12. ✅ 進捗レポートと未解決事項を文書化（本書）

---

## 7. 次セッションへの引き継ぎ

- Phase 2（work_focus / phone_browse / game_controller / 読書 / おやつ休憩本体 / 音楽鑑賞 / 電話）は本セッションでは未着手（指示通り）。
- 推奨アクション: 実機（`lab=0`）でPhase 1を30〜60分常駐させ、上記未解決1〜4を目視確認。
- おやつ皿は「歩いて持ち帰る」方針のため、Step 3歩行 + Step 2 prop保持パターンを再利用して将来拡張可能（設計済み）。
