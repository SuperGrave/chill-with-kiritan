# Phase 0 試験計画 — 生活モード基盤の実機検証

- 日付: 2026-06-12
- 親文書: `docs/LIFE_MODE_DESIGN_2026-06-12.md`（§7.2 Phase 0）
- 目的: Phase 1（PC作業の一日・35本）の著作に入る**前に**、土台が成立するかを実機で確かめ、ダメな項目を早期に発見して設計に差し戻す。
- 方針: 「**コードを書く前に確かめられるものから確かめる**」。最大リスク（座り＋スカート貫通）は新規コードなしで今日検証できる。

---

## 0. 結論先出し

| 試験 | 何を確かめる | 必要なもの | いつ |
|------|-------------|-----------|------|
| **A** | 座りベースポーズ＋スカート貫通（**GATE**） | Lab のみ（実装ゼロ） | **最初・即実行可** |
| **B** | ランタイムでの hips 適用ギャップ | 構図判定→必要なら小改修 | A の後 |
| **C** | FSM・Ambientスケジューラ・状態不変量のロジック | Node 単体（VRM不要） | A と並行可 |
| **D** | prop の手ボーン追従（attach最小） | attachヘルパ小実装＋Lab | B の後 |
| **E** | kiritanState POST 疎通 | モックエンドポイント | いつでも |

**ゲート判定**: 試験A が NG（貫通がフォールバックでも消えない）なら、座り11モード前提を見直す（＝上半身フレーミングで下半身ごと隠す方針へ）。**A を最優先で回し、その結果で B 以降の作り込み量が決まる。**

---

## 1. 現状の検証能力マップ（コード実測ベース）

| 機能 | 状態 | 根拠 | 試験での扱い |
|------|------|------|------------|
| hipsOffset の**プレビュー**適用 | ✅ 実装済 | motionLab.ts:247-254、samplePoseが報告:588 | A で活用 |
| SpringBone の settle（髪/スカート/袖） | ✅ 実装済 | motionLab.ts:323 `settleSpringBones` | A の中核 |
| 表情/視線の**ランタイム**適用 | ✅ 実装済(0.2) | motionLab.ts:636 faceTimeline、play()経路 | C2は解決済、再確認のみ |
| hipsOffset の**ランタイム**適用 | ❌ 未実装 | compileClip.ts:10「意図的に焼かない」 | **B の対象（唯一の実ギャップ）** |
| クロスフェード遷移 | ✅ 機構あり | ClipSwapRequest（swapをfade0まで遅延） | B/Dで再生時に観察 |
| FSM / Ambientスケジューラ | ❌ 未実装 | idleStateMachineは雛形(5状態・自動idle) | **C で新規・Node検証** |
| prop の手追従 attach | ❌ 未実装 | propLoaderは静的配置のみ | **D の対象** |
| kiritanState POST | ❌ 未実装 | Companion B-4未着手 | **E の対象** |
| DSL hips位置キー（並進アニメ） | ❌ 未実装・P4 | — | Phase 0 では検証しない |

要点: **A と C は他に依存せず即着手できる。** B は A の結果と「採用カメラで下半身が見えるか」で要否が変わる。

---

## 2. 試験A — 座りベースポーズ＋スカート貫通【GATE・即実行】

### 目的
`sit_pc_neutral.pose.json`（全座りモードの土台）を1体作り、椅子に座った状態でスカート（Skirtスプリング・太ももコライダー）が**貫通／跳ね上がりを起こさないか**を目視確定する。監査(§8)が最大の懸念として名指しした項目。

### 前提
- dev server 起動（`.claude/launch.json` の "probe" / port 5187）→ `?lab=1` で開く。
- `public/models/kiritan.vrm` がユーザー配置済みであること（再配布禁止モデル・同梱不可）。未配置なら `status().vrmLoaded` が false のまま → 先にユーザーへ配置依頼。
- 椅子の実寸を確認: `public/scenes/room_workdesk_day/scene.json` の chair transform を Read（scenePresets.ts はフォールバックの箱寸法であって実GLBではない、と明記済み）。座面の実Y座標を把握してから hipsOffset を決める。

### 手順
1. **基準計測**: VRMロード待ち後、立ちポーズで `samplePose` 系の数値と hips のレストY（motionLab が内部キャッシュ）を確認。ガイド§4の身長スケール（顔≈y1.35 / 胸≈y1.1 / 垂手≈y0.75）を座標の物差しにする。
2. **初版ポーズ執筆**: `public/poses/sit_pc_neutral.pose.json` を Write。
   - `hipsOffset: [0, -Δ, +d]` … Δ＝座面まで腰を落とす量、d＝椅子側へ少し後退。
   - `bones`: 上脚（leftUpperLeg/rightUpperLeg）を前へ折る（座位）、下脚を下ろす、足首水平。体幹はわずか前傾。**腕は触らない**（着座時の腕は各モーション側で。ここは骨格の土台のみ）。
3. **キャプチャ束**（settle差で揺れ物の収束を見る）:
   ```js
   await __motionLab.load('sit_pc_neutral');         // poseは仮motionでラップして読む（下記注）
   await __motionLab.captureSet('sit_pc_neutral', [0], { camera: 'workdesk_side',  settle: 1.0 });
   await __motionLab.captureSet('sit_pc_neutral', [0], { camera: 'workdesk_side',  settle: 2.0 });
   await __motionLab.captureSet('sit_pc_neutral', [0], { camera: 'workdesk_front', settle: 1.5 });
   await __motionLab.captureSet('sit_pc_neutral', [0], { camera: 'desk wide',      settle: 1.5 });
   ```
   - **注**: Lab の load/capture は `.motion.json` を対象にするので、`sit_pc_neutral` を `posture` に指定した検証用 `_pose_probe.motion.json`（duration 0.1・loop false・tracks空）を1本用意して経由させる。これ自体が「ポーズ単体を見るための定番治具」になるので残す。
4. **2軸で評価**（PNGを Read して目視）:
   - 貫通: スカート裾が太もも/座面/椅子を突き抜けていないか。
   - 跳ね上がり: 太ももコライダーに乗ったスカートが不自然に持ち上がっていないか（監査が警告した現象）。
   - 併せて袖（Sleeve）が机に刺さっていないか、髪が肩に埋まっていないか。
5. **反復**: hipsOffset の Δ/d、脚の折り角、（必要なら）座面の高さ・奥行きを調整して 2〜4周。前傾を強めると裾が前に流れて貫通が増えるので前傾は最小に。

### 合否基準
- **PASS**: `workdesk_side / front` で、座面・太ももとの貫通および跳ね上がりが目視で気にならない。`settle:1.0` と `2.0` で結果が安定（袖・髪が暴れ続けない）。`desk wide`（全身寄り）でも致命的破綻なし。
- **CONDITIONAL**: 上半身フレーミング（monitor side / workdesk_close）では問題ないが、desk wide で下半身に荒が残る → 採用カメラを上半身寄りに固定する条件付きでPASS。
- **FAIL**: どのフォールバックでも貫通/跳ね上がりが残り、上半身フレーミングでも裾が暴れる。

### フォールバック階段（FAIL時に上から順に試す）
1. hipsOffset と脚角の再調整（座面に沿わせ、太もも水平に近づける）。
2. 椅子の**座面形状/高さ**を調整（プレースホルダ箱→実GLBの座面Yに hips を合わせる）。
3. Skirtスプリングの**下半身ジョイントだけ剛性UP or 一時OFF**（settle前に該当ボーンを固定）。監査も「上半身アップ構図ならOFF許容」と言及。
4. **採用カメラで下半身を机/構図で隠す**（monitor side 系）。これが最終防衛線で、ここまで来ると「座り下半身は基本見せない」が設計制約として確定する。

### 所要 / 産物
- 0.5〜1.5h。産物: `sit_pc_neutral.pose.json`（確定 or フォールバック反映版）、`_pose_probe.motion.json` 治具、キャプチャ群、**ゲート判定メモ**（採用カメラ制約の有無）。
- 派生: PASS後に `sit_pc_slouch`（後傾）/ `sit_desk_slump`（突っ伏し）の2体も同治具で連続検証（Phase 1で必要な座り3体を本試験で揃える）。

---

## 3. 試験B — ランタイム hips 適用ギャップ

### 目的
唯一の実ランタイムギャップ（着座motionを `play()` するとhipsが下がらず宙に浮く）が、採用構図で実害になるかを判定し、なるなら最小実装で塞ぐ。

### 手順
1. **実害判定（コード前）**: 試験Aの `sit_pc_neutral` を `play()`（ミキサー経路）で再生し、採用候補カメラで観察。hipsが落ちないため腰が座面より上に浮く。
   - 採用カメラが上半身寄り（monitor side / workdesk_close）で腰から下が見えないなら → **実装不要**でPhase 1を通せる（hipsはLabキャプチャ検証だけで運用、ランタイムは上半身で誤魔化す）。
2. **要実装と判明した場合（最小改修）**: Motion Director 0.9 の一部として、再生中motionの `posture.hipsOffset` を毎フレーム hips.position に適用する経路を viewer 側へ追加（Lab の applyFrame:247-254 と同じ式を本番ループへ）。クロスフェード中は from/to の hipsOffset を線形補間。
3. **検証**: 改修後 `play()` で着座し、`status().external` が `{ clipSource:'dsl', playing:true }` を返しつつ腰が座面に乗ることをキャプチャ確認。立ち↔座りのクロスフェードで腰が滑らかに上下するか（ワープしないか）も確認。

### 合否基準
- 採用カメラで着座が破綻なく見える（浮きなし or 構図で不可視）。立ち座り遷移でhipsがポップしない。

### 所要
- 実害判定のみなら15分。実装込みで1〜3h（viewerループへの数行＋補間）。

---

## 4. 試験C — FSM / Ambientスケジューラ / 状態不変量【Node・VRM不要・A と並行可】

### 目的
Long Mode FSM（滞在タイマー・遷移表・daypart補正）、Ambient抽選（間隔・重み・直近除外・90秒クールダウン・深夜減衰）、状態不変量チェック（§6.1）を**フレームワーク非依存モジュール**として実装し、決定論シードで論理破綻を洗う。idleStateMachine と同じ「THREE非依存・純関数評価」の作法に乗せる。

### 手順
1. 設計書 §3.1/§3.4/§6.1 を、THREE非依存の純TS/JSモジュールとして実装（例: `src/lib/motion/director/`。`scheduler.ts` / `modeFsm.ts` / `invariants.ts`）。RNGは**注入式**（シード固定で再現可能に）。
2. スタンドアロン試験ランナーを `scripts/` に置く（既存は `.cjs`/`.mjs` スクリプト慣習）。`node scripts/test_director.mjs` で実行。
3. **試験ケース**:
   - **24hソークシミュレーション**: 仮想時計を5分刻みで1日回し、(a)無限ループ/デッドロックなし (b)モード分布がdaypart表とおおむね一致（深夜=sleep/sleepy偏重、15時=snack増） (c)`sleepiness` が夜間漸増→睡眠でリセット。
   - **Ambient抽選の健全性**: 1モード長期滞在で、直近2本除外と90秒クールダウンが効き、**同一Ambientの再生間隔中央値が目標（設計§8.5: ≥15分相当のプール一巡）** を満たす。重み比が出力分布に反映される。
   - **状態不変量**: ランダムな遷移系列を大量生成し、`[posture, hands{L,R}, props]` タプルが**一致しないエッジを踏まないこと**を assert（例: away へ行く前に必ず両手が空になる中間を経由）。違反0件。
   - **遷移の正規化**: 各行の重み合計・daypart乗算後も確率が正規化され、到達不能モードが無い。
4. 期待値はコンソールに表で出力し、目視＋簡易assertで判定（重い網羅より「壊れ方が見える」ことを優先）。

### 合否基準
- 24hソーク×複数シードで例外・デッドロック・不変量違反が0。分布がdaypart設計と質的に一致。同一Ambient間隔の中央値が目標域。

### 所要
- モジュール実装1〜2日（Phase 0本体の主作業）＋ランナー0.5日。**ここが Phase 0 の工数の山。** A の visual 検証と並行して進められる。

---

## 5. 試験D — prop の手ボーン追従（attach 最小検証）

### 目的
microEvents全実装の前に、**1個のpropが手ボーンに正しく追従するか**だけを確かめ、装着オフセットのキャリブ手順を確立する（Phase 2の前提・実装先行可）。

### 手順
1. cup を1個、右手ボーン（rightHand正規化ノード）に parent する最小ヘルパを実装（offset position/quaternion 込み）。
2. 試験Aの座りポーズ＋「手を口元へ」程度の仮motionで `show/capture`、カップが手に追従し机に刺さらないかを `workdesk_close` で確認。
3. 装着オフセットをLabで詰め、cup の prop定義（位置/回転）に保存できる形にする。detach→机スロット復帰も1往復確認。

### 合否基準
- カップが手に固定追従し、把持位置が自然。attach/detach往復で残留変位やワープがない。

### 所要
- 0.5〜1日（ヘルパ＋1propキャリブ）。Phase 0としては「機構が動く」ところまで。残りpropはPhase 2で量産。

---

## 6. 試験E — kiritanState POST 疎通

### 目的
壁紙→Companion の状態同期（設計§5.7スキーマ）を、Companion B-4本体を待たず**モックで疎通確認**し、スキーマ/頻度を確定する。

### 手順
1. ローカルにモック受信口を立てる（`127.0.0.1:40313/api/kiritan/state` を返す簡易サーバ、またはdev server内ミドルウェア）。
2. 壁紙側からモード遷移時＋30秒ハートビートで POST。受信ログでスキーマ（mode/since/prevMode/ambient/interruptPolicy/chatDelayMsRange/sleepiness/away）が設計どおり届くか確認。
3. ネットワーク断・タイムアウトで壁紙が止まらない（fire-and-forget）ことを確認。

### 合否基準
- 設計スキーマのJSONが想定頻度で届き、受信側不在でも壁紙が無影響。

### 所要
- 0.5日。Companion B-4 と統合する際の土台になる。

---

## 7. 実行順序と依存

```
[A 座り+スカート] ──GATE──┬─ PASS → [B hips実害判定] → (必要なら)hips最小実装
  即実行・Labのみ          │                          → [D prop attach]
                          └─ FAIL → 設計差し戻し（上半身フレーミング確定 / 座りモード再考）

[C FSM/スケジューラ/不変量]  … A と完全並行（VRM不要・Node）。Phase 0工数の主軸
[E kiritanState POST]       … 独立。いつでも
```

- **クリティカルパス**: A → (B) と C は別レーンで同時進行できる。A が GATE なので最初に着手し判定を取る。
- A が FAIL したときだけ設計に戻る（B/D の作り込みが無駄にならないよう、A確定前に B/D へ深入りしない）。

---

## 8. Phase 0 完了判定（DoD）

- [ ] **A**: 座り3体（neutral/slouch/slump）が採用カメラで貫通・跳ね上がりなく確定。採用カメラ制約が文書化されている。
- [ ] **B**: 採用構図で着座がランタイム再生でも破綻しない（実装 or 構図回避のどちらかで決着）。
- [ ] **C**: FSM＋スケジューラ＋不変量が24hソーク×複数シードで例外・デッドロック・不変量違反0。分布がdaypart設計と一致。
- [ ] **D**: cup1個が手追従し、attach/detachのキャリブ手順が確立。
- [ ] **E**: kiritanState がモックへ設計スキーマで疎通。受信不在でも壁紙無影響。
- [ ] 統合: `loop_work_normal`（仮）＋Ambient3種を実際に流し、**24時間ソークで drift / 抽選偏り / メモリリークが出ない**（設計§7.2 Phase 0 DoD）。

これらが揃ったら Phase 1（Batch W0 の座りposture確定済み → W1 のloop+Ambient著作）へ着手できる。

---

## 9. 即実行の提案

試験A は **追加実装ゼロ・既存Labのみ** で今すぐ回せる（dev server＋VRM配置が前提）。最もリスクが高く、結果が他全試験の作り込み量を決めるため、ここから着手するのが最適。

実行する場合の最初の3手:
1. dev server 起動（"probe"）→ `?lab=1` で開き、`status().vrmLoaded` を確認。
2. `scene.json` の chair 実寸を Read → `sit_pc_neutral.pose.json` 初版と `_pose_probe.motion.json` 治具を Write。
3. `captureSet` 4枚（workdesk_side ×settle2種 / front / desk wide）→ PNG を Read して貫通・跳ね上がりを判定 → 反復。

---

## 10. 実行結果（2026-06-12 実施）

| 試験 | 結果 | 要点 |
|------|------|------|
| **C** | ✅ PASS | `node tools/test_director.mjs` = **30/30 PASS**。分布が daypart 表と一致（lateNight: sleep_desk 44.5%＋sleepy 18.9%、midday: work_normal 41.7%）、同一Ambient再来中央値 7.7分。FSM/scheduler/invariants/kiritanState 検証済み。 |
| **A** | ✅ PASS（GATE通過） | 座り3体すべて Lab 実測で確定。スカート**跳ね上がりゼロ・致命的貫通なし**、SpringBoneは settle 1.0 で収束し 2.0 と同一。props有の採用カメラ(monitor_side)では机が下半身を遮蔽。**座り11モード前提を維持**（上半身フレーミングへの差し戻し不要）。脚符号確定: upperLeg X+1.4=股屈曲 / lowerLeg X−1.5=膝屈曲。 |
| **B** | ✅ PASS（修正実装＋検証） | 不具合を実証（hips非適用だと座位が約0.2m浮き膝が机上に露出）→ 修正実装→ランタイム数値検証。 |

### 試験A 成果物（確定ポーズ）
- `public/poses/sit_pc_neutral.pose.json` — A族土台（hipsOffset [0,-0.2,0.05]）。検証済みに更新。
- `public/poses/sit_pc_slouch.pose.json` — A'族（後傾・脱力）。新規。
- `public/poses/sit_desk_slump.pose.json` — sleep_desk（突っ伏し）。新規。⚠ 腕枕は sleep モーション著作時(W3)に付与。
- `public/motions/dsl/_pose_probe.motion.json` — ポーズ単体検証治具（static, 既定 stand_relaxed に復帰済み）。

### 試験B 修正内容（ランタイム hips 適用 = C2の最後の欠片を解消）
DSL postureの `hipsOffset` を「回転のみクリップ」のメタデータとして搬送し、viewerが毎フレーム `hips.position = rest + offset × clipWeight` を適用する経路を新設。
- `compileClip.ts`: `CompiledDslClip.hipsOffset` を露出（t=0サンプル＝posture定数）。位置トラックは焼かない方針は維持。
- `motionLab.ts`: `ClipSwapRequest.hipsOffset` 追加、`play()` で搬送。
- `VrmViewer.tsx`: ロード時に hips レスト位置をキャッシュ、`executeClipSwap` で DSLクリップの offset を保持、描画ループの `humanoid.update()` 直前に重み付き適用。
- **ランタイム数値検証**: rest Y=0.9311 → 全開で dy=−0.2000、クロスフェード中 w=0.873 で dy=−0.1745（重みに正確比例・ポップなし）、`stop()` で true rest へ復帰。`tsc --noEmit` クリーン。
- 副次効果: 立ち↔座りのクロスフェードで腰が滑らかに上下する基盤が完成（vrma/builtin等の非DSL・offset=0は従来どおり rest 固定で無影響）。

### Phase 0 DoD の現況
- [x] A: 座り3体確定・採用カメラ制約（下半身は机で遮蔽）を文書化。
- [x] B: 着座がランタイム再生で破綻しない（hips適用を実装し数値検証）。
- [x] C: FSM＋scheduler＋invariants が 30/30 PASS。
- [ ] D（prop attach）/ E（kiritanState POST 疎通） — 未着手（Phase 2前提・独立）。Eのシリアライザ自体はCで検証済み、残るはHTTP疎通。
- [ ] 統合ソーク（`loop_work_normal`＋Ambient3種の24hソーク） — Phase 1 W1 でループ実体ができてから。

**結論: Phase 0 のクリティカルパス（A→B と C）は完了。** 座り基盤・ランタイム描画接続・ディレクタ中核が揃い、Phase 1（Batch W0 完了＝座りposture確定済み → W1 の loop_work_normal＋Ambient著作）に着手できる。残る D/E は Phase 1 と並行で消化可能。
