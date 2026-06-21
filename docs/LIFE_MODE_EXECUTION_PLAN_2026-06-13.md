# きりたん生活モード 実行方針 v1.1（35問マスター回答の反映）

- 日付: 2026-06-13
- 上位文書: `docs/LIFE_MODE_DESIGN_2026-06-12.md`（設計 v1.0）/ `docs/PHASE0_TEST_PLAN_2026-06-12.md`（Phase 0結果）
- 位置づけ: v1.0 への 35問回答を反映した**実装の順序と差分の正典**。設計表本体（モード/Ambient/Transition定義）は v1.0 が引き続き有効。本書は「何を・どの順で作るか」を確定する。

---

## 1. 結論: v1.0 から変わった5点（ここだけ読めば差分が分かる）

| # | 決定 | v1.0 | v1.1（確定） | 影響 |
|---|------|------|-------------|------|
| Δ1 | **離席は本物の「立ち去り」で開始**（Q7=B / Q28=B / Q13=B） | P1はフェード退場、立ち座り・歩きはP4 | **立ち座り(stand/sit)を前倒し**。away = 立ち上がる→振り向く→数歩で枠外へ→フェード。**完全な歩行サイクル(部屋横断)は不採用**（Q28はC未選択） | **新インフラ INF-3「DSL hips位置トラック」が必要**。away_room が P1 なので P1 の前提に昇格 |
| Δ2 | **おやつ皿は本当に持って戻る**（Q29=B） | フェード帰還時に机上出現させるチート | 帰還時、皿を持って枠端から入り、机へ置く | INF-3＋「遷移中の手持ちprop保持」。snack_break は P3 のまま |
| Δ3 | **カップを Phase 1 に入れる**（Q10=B） | P1は小道具ゼロ | **cup を P1 投入**。`amb_work_sip`/`amb_vid_sip` が P1 解禁 | **prop-attach 機構(旧試験D)を P1 前提に前倒し** |
| Δ4 | **Ambientのカメラ目線は機械禁止しない**（Q1=B / Q2=C / Q33=B） | lookAt:camera を非command категで validator禁止 | **ハード禁止を撤回**。著作ガイドライン＋目視レビューに格下げ。Ambientに**低頻度の自然な視線通過は許容**。通知/起動など一部イベントの**カメラ目線Reactiveを許可** | validate.ts に禁止規則を入れない。P1 DoD の該当条件を緩和（§5） |
| Δ5 | **離席返答を離席理由で変える**（Q23=D）＋**cmd_yareyare 追加**（Q24） | awayReason は文脈に渡すのみ。コマンドは7種 | away の AI 文脈に理由を強く反映し返答文を分岐。明示コマンドに「やれやれ/肩すくめ」を追加 | §5.7テンプレ強化、cmd 語彙に1つ追加 |

**それ以外（Q3,4,5,6,8,9,11,12,14〜22,25,26,27,30,31,32,34,35 ＝ "これでいい"系）は v1.0 のまま確定。** 主な確定事項: 4分類採用 / 12モード確定 / 睡眠独立 / 電話は着信Reactive起点P4 / Phase1=5モード / Phase2=focus・phone・game / Phase3=book・snack・music / 小道具6種全採用 / ヘッドホンP3 / AIスキーマ現状 / 時間帯・天気・音楽連動 現状。

---

## 2. ロコモーション(立ち座り＋歩行)のスコープ ← 2026-06-13 ユーザー確定: 歩行サイクルを作る

当初の「枠端＋フェードで移動を隠す」案は**却下**。ユーザーは**歩行サイクル（足の交互運び）まで作る**方針:

- **作るもの**: 立ち上がる/座る（hips垂直移動＋脚伸展, **INF-3で実装済**）、振り向き、**歩行サイクル**（脚・腕の交互スイング＋hips上下バウンス＋前進移動）、その間の手持ちprop保持。
- **前進移動の実装**: INF-3 の hips 位置トラックは水平移動も担えるが、キャラを部屋内で大きく動かす「ルートモーション」はキャラルート(`vrm.scene`)を動かすのが素直。歩行用に**軽いルートモーション機構（INF-7）**を away 著作時に追加する（短距離の踏み出しは INF-3 の hips 水平移動で代替可）。脚・腕スイングは回転トラックで著作可能（既存機能）。
- **歩行サイクルの作り方（メモ）**: ループ motion として 1歩=左右対称の半周期で著作 → 接地足ロックは壁紙用途では省略しスタイライズ（足裏スライドはカメラ構図と速度で目立たなくする）。away leave = `tr_sit_to_stand` → 振り向き → `loop_walk` を数歩 → 枠外。return はその逆＋着席。
- **P1への影響**: away_room の立ち去り/帰還が歩行を使う。ただし**P1で残るインフラは INF-4(cup attach) と INF-5(director配線)**。歩行サイクル＋INF-7 は away 著作（content）として INF-4/INF-5 の後に着手。

---

## 3. 改訂インフラ一覧（前倒し分を含む）

| ID | 内容 | 状態 | 備考 |
|----|------|------|------|
| INF-1 | 座りベースポーズ3体 | ✅ 完了 | sit_pc_neutral / slouch / slump（試験A） |
| INF-2 | ランタイム静的 hips 適用 | ✅ 完了 | clip metadata→`hips=rest+offset×weight`（試験B） |
| **INF-3** | **DSL hips 位置トラック（時間変化）** | ✅ 完了(2026-06-13) | 立ち座り・枠端ステップ用。`hipsTrack`(絶対値・postureのhipsOffsetを上書き)をschema/evaluate/validateに追加、compileが変化検出時のみ`hipsCurve`を出力、viewerがaction.timeでサンプルしweight付き適用。検証: `tr_sit_to_stand.motion.json` で 3a) Lab captureが着座→前傾→上昇→直立のアークを描く 3b) ランタイムplay()でhips.yが−0.195→0へ上昇して直立で終わる。tsc clean |
| **INF-4** | prop-attach 機構（手/机アンカー＋microEvents） | ✅ 機構完了(2026-06-13) | `src/lib/scene/propAttach.ts`（**raw bone**へparent・装着/離脱/再帰探索）＋Lab `__motionLab.attachProp/detachProp`（校正面）＋library に `attach.hand_r/hand_l/head` スキーマ追加。検証(cup): raw右手に装着・腕の動きに追従(手+0.443m上昇にcup追従)・scale1維持・detachで机rest[0.52,0.73,0.286]へ正確復帰。cup.attach.hand_r は暫定値（飲むグリップは amb_work_sip 著作時に確定）。microEvents実行(時刻でのattach/detach)は INF-5 で配線 |
| **INF-5** | Director→viewer ランタイム配線 | ✅ 完了(2026-06-13) | `directorRunner.ts`(FSM＋scheduler を実時間tick→play action発行・Ambient中はscheduler停止・終了でループ復帰) ＋ VrmViewer配線(プリロード→`requestClipSwap`、mixer'finished'でループ復帰) ＋ Lab `__motionLab.director(true/false)`/`directorStatus()`。scheduler に `availableMotions` フィルタ追加（著作済みのみ抽選）。検証: 無操作で ambientCount 0→1→2、lastAmbient が別物に変化（抽選機能）、clip が loop↔ambient swap してループ復帰。Test C 30/30 回帰なし、tsc clean。**注**: rAFは前景時のみ進む(壁紙常駐では連続)／`monitor side`カメラはモニタが手前を覆う＝シーン配置の別課題 |
| INF-6 | lookAt:camera 方針 | 確定(Δ4) | **ハード禁止なし**。ガイドライン＋目視。自然な通過/一部イベントの目線可 |
| INF-7 | 歩行ルートモーション（キャラ前進） | ✅ 完了(2026-06-20) | DSL `rootMotion` トラック（world絶対 `{t,p,rotY}`）を types/evaluate/compile/validate に追加、viewer がキャラルート(`vrm.scene`)書き込みを「layout base + directorRoot(persistent) + clip root×weight」の絶対合成に統合（前フレーム加算なし＝drift0）。脚アニメ(loop_walk/tr_walk_start/tr_walk_stop)＝DSL、ワールド前進＝Directorの directorRoot を分離。検証: rootMotion 決定論(1000回drift0・単調)、away往復chair原点一致。詳細は `docs/LIFE_MODE_PHASE1_REPORT_2026-06-20.md` |

INF-3/4/5 が P1 自走の3前提（INF-3 完了）。INF-7 は away の歩行 content と一緒に後追い。

---

## 4. 改訂フェーズ計画

### Phase 1 —「PC作業の一日」＋立ち去り＋カップ（改訂）
- **モード**: work_normal / work_sleepy / sleep_desk / video_relax / away_room（Q9=A）
- **追加要素**: cup prop＋sip系Ambient（Δ3）/ away は立ち上がり→振り向き→ステップ＋フェードの本物の立ち去り、帰還は枠端から入り着席（Δ1）
- **前提**: INF-3（hips曲線）→ INF-4（cup attach）→ INF-5（director配線）
- **著作量**: v1.0の37本 ＋ 立ち座り/away遷移（tr_sit_to_stand / tr_stand_to_sit / tr_away_leave / tr_return_sit）＋ cup関連（hand cup_grip / amb_work_sip / amb_vid_sip）≒ +8本

### Phase 2 — work_focus / phone_browse / game_controller（Q11=A）
汎用 take/place 遷移、controller・phone prop。

### Phase 3 — read_book / snack_break / music_listen（Q12=A）
- snack_break は**皿を持って戻る**実装（Δ2、INF-3のステップイン＋手持ちprop）
- music_listen はヘッドホン装着（Q27=A、髪Spring干渉はP2中に先行スパイク）
- book prop。

### Phase 4 —（縮小: 立ち座り/ステップは前倒し済み）
phone_call（着信Reactive）/ 完全歩行サイクル（必要なら）/ 窓の天気演出 / session.start挨拶（Q2=Cでカメラ目線可）/ 部屋側away演出 / 歌詞連動。

---

## 5. 検収・DoD の調整（Δ4 に伴う整合）

Q35=A（Phase1完了条件は現状維持）だが、第3条件の文言は Q1=B / Q33=B と矛盾するため**より新しく具体的な Q1/Q33 を優先して緩和**する:

- 旧: 「Ambient中にカメラ目線が一度も出ない（ログで機械確認）」
- 新: 「**Ambient中にカメラ目線が氾濫していない（目視確認）**。自然な視線通過は可、貼り付くような凝視・手振り等の対ユーザー演技がAmbientにないことをレビューでOKとする」

他のPhase1 DoD（1日サイクル自走 / チャット3モード以上で反応差）は維持。Ambient間隔（同一90秒CD・直近2除外・中央値15分目標）も維持（Q34=A）。

---

## 6. 反映する正典編集（最小）

本書を差分の正典とし、設計v1.0本体への編集は最小限に留める:
- `LIFE_MODE_DESIGN_2026-06-12.md` 冒頭に v1.1 への参照バナーを追加（済）。
- §5.2 コマンド表に `cmd_yareyare`（やれやれ/肩すくめ・2.5s・camera目線可）を追加。
- §5.7 away文脈テンプレを「理由で返答分岐」に強化（Δ5）。
- §8.4 validatorの lookAt:camera 禁止規則は**入れない**旨に変更（Δ4）。
- modeTable.ts の away/snack 等の state/transition は INF-3/INF-5 着手時に遷移実体へ合わせて更新（now は据え置き）。

---

## 7. 今セッションの着手（取り掛かり）

1. 本書 ＋ 設計v1.0へのバナー ＋ §5.2/§5.7/§8.4 の差分反映。
2. **INF-3 着手**: DSL hips位置トラックを実装（schema→evaluate→compile→viewer、INF-2のRoute Bを曲線化）。Lab で `sit_pc_neutral → 立ち上がり` の hips 垂直移動を数値＋目視で検証。
3. 続けて INF-4（cup attach 最小）→ INF-5（director配線）→ P1 W1 著作、の順で進める。

---

*補足: 立ち座り(INF-3)は away/snack/sleep起床など複数で必要になるため、解釈が多少ズレても作って損のない土台。先行着手は低リスク。*
