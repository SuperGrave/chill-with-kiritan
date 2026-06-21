# きりたん生活モード設計 v1.0 — Long Mode / Motion 体系

> **⚠ v1.1 更新あり（2026-06-13）**: 35問マスター回答により実装の順序と一部方針が更新された。**差分と実行順は `docs/LIFE_MODE_EXECUTION_PLAN_2026-06-13.md` が正典**。主な変更: 離席は本物の立ち去り（立ち座り前倒し）/ おやつ皿は本当に持ち帰る / カップをP1投入 / Ambientのカメラ目線は機械禁止せず目視運用 / 離席返答を理由で分岐＋cmd_yareyare追加。本書の設計表（モード/Ambient/Transition定義）は引き続き有効。

- 日付: 2026-06-12
- 入力: ユーザーブリーフ「生活モード / モーション設計 原案」(2026-06-12)
- 状態: **設計確定前のレビュー＋設計表**（実装コードなし）
- 関連: `01_wallpaper/MOTION_AUTHORING_GUIDE.md`（著作手順・実測符号表）/ `docs/MOTION_PIPELINE_RESEARCH_2026-06-11.md` / Companion設計（B-0〜B-7）

---

## 0. 技術前提（この設計の根拠になる現状制約）

設計表の「実装難易度」「優先度」はすべて以下の実測済み制約から導いている。

| # | 制約 | 設計への影響 |
|---|------|--------------|
| C1 | 表情モーフは `a i u e o blink blinkleft blinkright joy angry sorrow fun`（+neutral）のみ。**驚き・照れ・ウィンク専用モーフは無い** | 驚き＝`blink:0`+`o`+びくっポーズ、照れ＝`fun`+`sorrow`+視線そらし+手、で代用。§5.7にレシピ表 |
| C2 | 0.7ランタイム再生はボーン回転のみ。表情・lookAt・hipsOffset のランタイム適用は Motion Director（0.9）から | 本設計は0.9の存在を前提に書く。0.9のスコープ定義を§7 Phase 0に含めた |
| C3 | 座りポーズ（hipsOffset）は未制作。椅子位置合わせ＋スカート貫通検証が0.8の仕事 | **12モード中11が座り**。sit基礎ポーズが全モードの前提＝最優先 |
| C4 | DSLのトラックは回転のみ。腰の**並進**キーが無い | 「立つ/座る/歩く」は DSL拡張（hips位置キー）が必要。「突っ伏す」は回転のみで近似可 → 睡眠は安い、立ち歩きは高い |
| C5 | シーンの小道具は desk / chair / laptop の3つ。手持ち小道具・装着機構は未実装 | カップ/スマホ/コントローラー/本/ヘッドホン/皿 ＋ アンカー機構（§6.1）が新規。B族モード全部がこれ待ち |
| C6 | `MotionDef.microEvents` が予約済み（0.7では無視） | 小道具の表示/装着/取り外しイベントにこのフィールドを使う（§6.1に仕様案） |
| C7 | LookAtは `cursor / camera / fixed / off` + strength | Ambientでの `camera` は禁止できる（仕組みで「ユーザーを意識しない」を保証できる） |
| C8 | idleStateMachine（呼吸・5状態）が既存。`idle_glance_user` はカメラ目線oneshot | glance_userは**Ambient自動プールから外し** `cmd_` 系（明示コマンド）へ移管。呼吸はDSLループ内のオシレータで持つ |
| C9 | Companion: `/api/state` を2〜5sポーリング、チャット=B-4、WebSocket=B-6 | きりたん状態はリアルタイム性が要るので、Mode決定は壁紙側で行いCompanionへ報告する（§1.2-10） |
| C10 | 著作実績: `test_stretch` 1本 ≒ 15分（ブリーフ→執筆→キャプチャ→修正1周） | 単純oneshotで15分/本。ループ・小道具連動はその2〜3倍を見込む。総量200本は一括では無理→Phase分割（§7） |

---

## 1. この構成案への評価

### 1.1 そのまま採用すべき点

1. **4分類（Transition / Ambient / Long Mode / Reactive）は実装系と1:1で対応する。**
   - Long Mode = ループmotion（`loop:true`）＋滞在タイマー
   - Ambient = oneshot motion（`loop:false`）＋確率スケジューラ
   - Transition = oneshot motion＋propイベント＋FSMのエッジ
   - Reactive = 外部イベント→oneshot＋割込みポリシー
   分類そのものが Motion Director（0.9）のモジュール構成になる。変更不要。
2. **「日常はユーザーを意識しない／意識するのはReactive限定」は本企画の生命線。** 1か月常用で最初に飽きる（うざくなる）のは「見られてる感」。しかもC7のとおり、`lookAt.mode==='camera'` をAmbientカテゴリで禁止すれば**ルールを仕組みで強制できる**。バリデータに入れるべき（§8.4）。
3. **work_normal をハブにする遷移構造**は遷移ペア数を O(n²)→O(n) に落とす。著作コスト上の最重要判断。維持。
4. **離席＝モデル非表示期間**はコスパ最高の生活感。「いない時間」があるからこそ「いる時間」が生きる。採用。
5. **モードごとのAI文脈テンプレ＋演技情報つき応答**は Companion B-4 の設計とそのまま整合する。採用（スキーマは§5.7で1点だけ修正提案）。

### 1.2 修正・追加すべき点（10項目）

1. **規模の現実**: 12モード全装備は ループ12＋Ambient約140＋Transition約20＋Reactive約40 ≒ **200本**。C10のペースでも著作だけで数週間。→ §7のPhase分割で「最初の35本」に絞る。
2. **モードは「ポーズ族」で設計する**: 12モードは実質3つの座り姿勢族＋特殊2に縮退する。posture資産を族で共有し、モード差は表情・手・小道具・テンポで出す。
   - **A族 PC正対**: work_normal / work_focus / work_sleepy（共通 `sit_pc_neutral`、focusは前傾オフセット）
   - **A'族 後傾**: video_relax / music_listen（共通 `sit_back_relax` 系）
   - **B族 手元保持**: game / read_book / phone_browse / phone_call / snack_break（共通 `sit_hold` 系＋持ち物別ハンドシェイプ）
   - **特殊**: sleep_desk（突っ伏し）、away_room（非表示）
3. **小道具機構が先**: prop6種（カップ・スマホ・コントローラー・本・ヘッドホン・皿）と、アンカー（左右手・頭・机スロット）＋motion同期の表示/装着切替（§6.1）。これが無いとB族は1本も作れない。Phase 0の基盤に含める。
4. **立ち座りはDSL拡張待ち（C4）**: Phase 1は「座ったまま完結する遷移」＋「その場フェードの離席」で構成。歩いて退場する真の離席はPhase 4。
5. **表情の不足（C1）を仕様で埋める**: 驚き・照れの「代用レシピ」を§5.7で正式仕様化し、AIの `emotion` 語彙もそのレシピ表に閉じる。LLMに自由な感情名を出させない。
6. **睡眠は独立モードとして採用（12番目）**: Reactiveポリシーが他モードと根本的に違う（**無反応がデフォルト**）。「反応しない」をモード属性として持てるのは独立モードだけ。うとうと作業は睡眠への「玄関」モードと位置づける。
7. **phone_call は優先度を下げ、Reactive発火型に転用**: 自発的に電話を始めるより「電話がかかってきて中断される」方が演出として面白く、頻度制御もしやすい。自発版はP4。
8. **interruptPolicy はAIに出力させない**: 割込み可否は「きりたんの状態」の属性であり、モード設計表が所有する（§3.2の列）。AIが毎回判断すると不安定＆プロンプト浪費。AIは `urgent: true` の**要求**だけ出せる。原案JSONから `interruptPolicy` / `lookAtUser` を外したスキーマv2を§5.7に置いた。
9. **Ambientスケジューラのパラメタを定義**（原案は確率「低確率」のみ）: §3.1に間隔・重み・連発抑止・深夜減衰を仕様化。あわせて重要な線引きを追加した — **「8秒以下の周期で常時繰り返すモチーフ（タイピング、スクロール、リズム揺れ等）はAmbientではなく基本ループに内蔵する」**。これを分けないとAmbient発火が15秒間隔になり、壁紙が騒がしくなる。
10. **Mode決定の置き場所**: Long Mode FSM＋Motion Director は**壁紙側**。Transition連鎖はフレーム精度の制御が必要で、2〜5sポーリング越しの指示では破綻する。Companionは**イベント源**（チャット・曲・天気・コマンド・時刻）かつ**状態ミラー**（壁紙が `kiritanState` をPOST→AI文脈に使用）。「壁紙=表示、Companion=入力/状態」の原則は維持される（FSMは表示ロジックの一部とみなす）。

### 1.3 リスクと先回り

| リスク | 対応 |
|--------|------|
| 座り＋スカート貫通（C3） | 0.8で最初に検証。ダメなら椅子の座面形状・hipsOffsetで逃がす。**全Phaseの前提** |
| ヘッドホン装着と髪SpringBoneの干渉 | 未知数。music_listenをP3に置き、P2の段階でLabで装着テストだけ先行 |
| 咀嚼など口モーフの常用が安っぽい | 口モーフは weight ≤0.3・短時間。咀嚼は「頬・顎を動かさず口をu/o微振動」で雰囲気だけ |
| 歌詞ライセンス | 構想止め。スキーマにフィールドだけ予約し、取得実装はしない |
| 連続稼働でAmbient抽選が偏る | 直近2本除外＋同一motion最低90秒ルール（§3.1）。ソークテストをPhase 0 DoDに含む |

---

## 2. 修正したMode一覧（12モード確定）

| # | Mode ID | 表示名 | 族 | 滞在時間 | 新規小道具 | Phase |
|---|---------|--------|----|----------|-----------|-------|
| 1 | `work_normal` | 通常作業 | A | 8〜25分 | （カップ任意） | **P1** |
| 2 | `work_focus` | 集中作業 | A | 5〜15分 | − | P2 |
| 3 | `work_sleepy` | うとうと作業 | A | 4〜10分 | − | **P1** |
| 4 | `video_relax` | 動画視聴 | A' | 8〜20分 | − | **P1** |
| 5 | `game_controller` | ゲーム | B | 10〜25分 | コントローラー | P2 |
| 6 | `read_book` | 読書 | B | 8〜20分 | 本 | P3 |
| 7 | `phone_browse` | スマホ | B | 3〜6分 | スマホ | P2 |
| 8 | `phone_call` | 電話 | B | 2〜4分 | スマホ（共用） | P4 |
| 9 | `snack_break` | 休憩（おやつ） | B | 5〜10分 | 皿（＋カップ） | P3 |
| 10 | `music_listen` | 音楽鑑賞 | A' | 10〜25分 | ヘッドホン | P3 |
| 11 | `away_room` | 離席 | 特殊 | 3〜20分 | − | **P1**（フェード版） |
| 12 | `sleep_desk` | 睡眠（突っ伏し） | 特殊 | 10〜30分 | − | **P1** |

原案からの変更点:
- **睡眠を独立モードとして正式採用**（§1.2-6）。
- **phone_call を最後発に降格**、Reactive発火型（かかってくる）を本命に。
- 滞在時間の下限を少し引き上げ（3分切替の頻発はTransition再生回数＝著作コストとワープ感の両方を増やす）。
- スマホ・電話だけ意図的に短く（絵面が地味、原案どおり）。

---

## 3. Mode設計表

### 3.1 全モード共通仕様

- **基本ループ**: 各モード1本 `loop_<short>`。20〜40秒ループ、呼吸はオシレータ内蔵（`duration` は `period` の整数倍）。タイピング・スクロール・リズム揺れ・寝息など**8秒以下の周期で常時繰り返すモチーフはループに内蔵**し、Ambientにしない。
- **Ambient**: `amb_<short>_<name>`。2〜30秒のoneshot。終了で基本ループへクロスフェード復帰（0.6〜1.2s）。
- **スケジューラ**: モード別の間隔 `[min,max]` 秒から一様乱数で次の発火を決め、重み付き抽選。**直近2本は除外**、同一motionは**90秒以内に再抽選しない**。深夜帯（0〜6時）は間隔1.5倍。
- **視線の規範**:
  - Ambient/ループでの `lookAt: camera` は**禁止**（バリデータで機械チェック、§8.4）。
  - 許可: `fixed`（モニタ＝laptop位置 / 窓 / 手元の小道具）、`off`、弱い `cursor`。
  - `cursor` の再解釈: カーソル追従（strength 0.2〜0.35）は「ユーザーを見る」ではなく**「きりたんのPC画面の中の操作を目で追っている」**演出として、PC正対系モードでのみ使用可。strength > 0.5 はReactive専用。
- **表情の振幅**: Ambient中の最大 weight 0.5、Reactiveは0.8まで。`blink: 0`（見開き）は2秒以内。
- **滞在タイマー**: 滞在時間内の一様乱数。満了で§3.4の遷移表＋時間帯補正から次モードを抽選。
- **割込みポリシー語彙**（モード属性。AIは出力しない）:
  - `immediate` — 進行中Ambientを0.3sフェードで奪って即反応
  - `soft` — 進行中Ambientの完了を待つ（最大8秒）
  - `queued` — モードの「区切り」イベントまで保留（ゲームのラウンド終了等）
  - `unavailable` — モード継続中は反応しない（電話）。終了時にまとめて処理
  - `offline` — 不在。帰還時にまとめて処理
  - `asleep` — 原則無反応。`urgent` のみ起床分岐

### 3.2 概要マトリクス

| Mode | 滞在(分) | posture | 視線基準 | 必要prop | Amb間隔(秒) | chat反応遅延 | 割込み | 難易度 | 差別化 | 優先 |
|------|---------|---------|----------|----------|------------|------------|--------|--------|--------|------|
| work_normal | 8–25 | `sit_pc_neutral` | モニタ＋cursor 0.3 | (cup任意) | 25–70 | 0.5–1.5s | immediate | S | 中 | P1 |
| work_focus | 5–15 | 同＋前傾offset | モニタ＋cursor 0.35 | − | 40–90(少) | 2–4s | soft | S | 中 | P2 |
| work_sleepy | 4–10 | 同＋droop | モニタぼんやり0.15 | − | 15–40(多) | 2–5s | soft | S | 高 | P1 |
| video_relax | 8–20 | `sit_pc_slouch` | モニタ固定 | − | 20–50 | 1–2.5s | soft | S | 中 | P1 |
| game_controller | 10–25 | `sit_game` | モニタ固定(強) | controller | 12–30(多) | 6–18s(区切り) | queued | M | 高 | P2 |
| read_book | 8–20 | `sit_book` | 手元(本) | book | 20–55 | 2–4s | soft | M | 高 | P3 |
| phone_browse | 3–6 | `sit_phone` | 手元(スマホ) | phone | 10–30 | 0.5–1s | immediate | M | 中 | P2 |
| phone_call | 2–4 | `sit_phone`流用 | 泳ぐ(fixed乱択) | phone | 8–20 | 通話後 | unavailable | M | 高 | P4 |
| snack_break | 5–10 | `sit_pc_slouch`流用 | 皿⇄モニタ | plate(+cup) | 12–30 | 1–2s(ごくん後) | soft | M | 高 | P3 |
| music_listen | 10–25 | `sit_back_relax` | 目閉じ⇄宙 | headphones | 15–40 | 1–2s(片耳) | soft | M–L | 高 | P3 |
| away_room | 3–20 | −(非表示) | − | − | − | 帰還後 | offline | S(フェード) | 高 | P1 |
| sleep_desk | 10–30 | `sit_desk_slump` | off | − | 30–90(稀) | 原則無反応 | asleep | S–M | 高 | P1 |

**posture資産（新規6体＋既存1）**: `sit_pc_neutral` / `sit_pc_slouch` / `sit_back_relax` / `sit_game`（肘曲げ両手前） / `sit_book`（≒sit_gameの持ち上げ変形） / `sit_phone`（片手挙上） / `sit_desk_slump`。focus・sleepyは `sit_pc_neutral` ＋モーション側オフセットで出す（posture増殖を防ぐ）。

**hand資産（新規8＋既存1）**: `relax`(既存) / `type_natural` / `mouse_grip` / `controller_grip` / `book_hold` / `phone_grip` / `pinch_snack` / `cup_grip` / `loose`（脱力・寝用）。

### 3.3 モード詳細カード

各カードの「高頻度/抑制Ambient」は§4のidを参照。「AI文脈」は§5.7の共通ヘッダに続けてCompanionが注入するモード断片。

#### 1. work_normal（通常作業）— ハブ
- **シルエット**: 背筋ふつう、両手キーボード上。ループにタイピング波・画面読みの間（ま）を内蔵。
- **視線**: モニタ固定基調＋cursor 0.3（画面内活動の演出）。
- **高頻度Amb**: screen_scan / posture_reset / enter_phew。**抑制**: 眠気系（夜のみ解禁）。
- **Reactive許可**: chat即応、通知全段階、cmd全部。**禁止**: なし。
- **遷移先**: §3.4参照（全モードへのハブ）。
- **時間帯**: 終日基準値。深夜は重み0.6。
- **AI文脈断片**: 「きりたんはPCで作業中です。すぐに気づいて返信できます。口調は平常です。」
- **難易度根拠**: S — 小道具なし・座りポーズ1体目をそのまま使う基準モード。

#### 2. work_focus（集中作業）
- **シルエット**: 前傾＋肩がわずかに上がる。タイピング速度1.3倍、瞬き減。表情は `angry 0.15`＋`i 0.1` の「キリッ」。
- **視線**: モニタ固定強め、cursor 0.35。
- **高頻度Amb**: stare_still / enter_breath。**抑制**: 飲む・伸び・あくび（リストから除外済み）。
- **Reactive**: chatは2〜4秒遅れ＋`slightly_annoyed` 文脈をAIへ。通知lowは無視率70%。cmdは実行するが余韻短め。
- **遷移先**: work_normal(0.7) / work_sleepy(0.1) / away(0.2)。
- **時間帯**: 午前・夜に重み1.3（はかどる時間）。
- **AI文脈断片**: 「きりたんは集中して作業中です。返信は一拍遅れ、少しそっけなくて構いません。集中を切られた感を薄く出してもよいです。」
- **難易度根拠**: S — posture流用、差分は表情・テンポ・Ambient抑制のみ。**コスパ最良の2本目**。

#### 3. work_sleepy（うとうと作業）
- **シルエット**: 首が前に落ち気味、まばたき重い（extraBlink 0.4基調）、頭がゆっくり傾いては戻る。
- **視線**: strength 0.15。焦点が合っていない感じ。
- **高頻度Amb**: head_bob_catch / eye_rub / yawn_big。**抑制**: きびきび系全部。
- **Reactive**: chatは眠そうに（AIへ `sleepy` 文脈）。通知lowスルー率50%。cmdは1テンポ遅い。
- **遷移先**: sleep_desk(0.5) / work_normal(0.25=持ち直す) / away(0.15=顔を洗いに) / video(0.1)。
- **時間帯**: 朝0.5 / 昼0.7 / 夜1.5 / 深夜3.0。`sleepiness` 変数（0..1、夜間と連続稼働で漸増）が重みに乗る。
- **AI文脈断片**: 「きりたんは眠気をこらえて作業しています。返信は短く、ぼんやりした口調で。誤変換を1つ混ぜても構いません。」
- **難易度根拠**: S — posture流用＋droopトラック。差別化は表情と速度で出る。

#### 4. video_relax（動画視聴）
- **シルエット**: 背もたれに体重、両手は膝/机に脱力（hand `loose`）。口元ゆるい。
- **視線**: モニタ固定。cursorは使わない（自分は操作していない）。
- **高頻度Amb**: chuckle / cheek_rest / grin_wide。**抑制**: タイピング系。
- **Reactive**: chatは「一時停止リーチ→向き直り」を挟んで返信。music.changedは無視。
- **遷移先**: work_normal(0.4) / game(0.25) / sleepy(0.15・夜) / snack(0.1) / away(0.1)。
- **時間帯**: 夜1.3 / 昼食後1.2。
- **AI文脈断片**: 「きりたんは動画を観てだらけています。動画を一時停止してから返信します。口調はゆるめです。」
- **難易度根拠**: S — `sit_pc_slouch` 1体追加のみ、小道具なし。**P1で姿勢差を出す担当**。

#### 5. game_controller（ゲーム）
- **シルエット**: コントローラー両手持ち、やや前傾、体が入力に合わせ左右に揺れる（ループ内蔵）。表情は豊か枠。
- **視線**: モニタ固定（強）。瞬き少なめ。
- **高頻度Amb**: body_steer系 / win_smug / lose_slump。**抑制**: 飲む（画面から目を離す版は禁止、目を離さない版のみP4）。
- **Reactive**: chatは `queued` — ラウンド区切り（30〜90秒ごとに内部発生する「区切りイベント」）まで保留→pause演技→返信。Companion側は**返信テキストの配信自体を遅延**させる（§5.1）。cmdはワンテンポ後。
- **遷移先**: work_normal(0.4) / snack(0.25) / video(0.2) / away(0.15)。
- **時間帯**: 夜1.5 / 休日昼1.3（休日判定はP4）。
- **AI文脈断片**: 「きりたんはゲーム中です。返信は一区切りついてから。テンション高め、勝敗に言及してよいです。」
- **難易度根拠**: M — コントローラーprop＋`controller_grip`＋構えTransition。**差別化と「遅延返信」演出の主役**。
- **prop状態**: コントローラーは普段 `desk_right` に置いてある。

#### 6. read_book（読書）
- **シルエット**: 本を両手で胸の高さに。背筋は伸び気味（文学少女感）。
- **視線**: fixed=本（手元）。ページ送りに合わせ視線が行を往復（ループ内蔵の微小視線）。
- **高頻度Amb**: page_turn / soft_smile / posture_shift。**抑制**: PC系全部。
- **Reactive**: chatは「しおり→本を伏せる→PCへ向く」で2〜4秒。notification lowは本から目を上げない。
- **遷移先**: work_normal(0.5) / sleepy(0.2) / phone(0.15) / away(0.15)。
- **時間帯**: 夕〜夜1.4 / 雨の日1.3（天気連動の隠し味）。
- **AI文脈断片**: 「きりたんは本を読んでいます。返信は落ち着いた口調で、少しだけ本の世界から戻ってきた感じを出してください。」
- **難易度根拠**: M — 本prop＋`book_hold`＋開閉Transition。ページめくりの説得力が品質の鍵。

#### 7. phone_browse（スマホ）
- **シルエット**: 片手（左）でスマホを顔の下あたりに、右手は机/膝。親指スクロールはループ内蔵。
- **視線**: fixed=スマホ。
- **高頻度Amb**: smile_screen / time_peek。**抑制**: PC系。
- **Reactive**: chatは即応（顔を上げてPCへ、または「スマホで返信する」演出のままでも可）。
- **遷移先**: work_normal(0.6) / video(0.15) / music(0.1) / away(0.1) / call(0.05)。
- **時間帯**: 終日均一。作業の合間の「箸休め」枠。
- **AI文脈断片**: 「きりたんはスマホを眺めて小休憩中です。すぐ反応できます。軽い口調で構いません。」
- **難易度根拠**: M — スマホprop＋`phone_grip`。propは小さく干渉リスク低、**B族の練習台に最適**。

#### 8. phone_call（電話）
- **シルエット**: スマホを耳に、視線は宙を泳ぐ。うなずき・相づちがループ内蔵。
- **視線**: fixed乱択（部屋のあちこち）。カメラ方向は通過のみ。
- **高頻度Amb**: nod_listen / bow_call（見えない相手にお辞儀）。
- **Reactive**: **chat不可（unavailable）**。Companionは「いま電話中みたいです…」の**定型文をLLMを呼ばずに返し**、通話終了後に本返信。cmdには人差し指で「ちょっと待って」ジェスチャ（これ自体がReactive演技）。
- **遷移先**: work_normal(0.7) / away(0.2) / phone_browse(0.1)。発生は主にReactive起点（かかってくる）。
- **時間帯**: 昼〜夜。深夜0。
- **AI文脈断片**: 「きりたんは電話中で手が離せません。通話が終わってから返信します。」
- **難易度根拠**: M — phone_browse資産を流用。ただし優先度はP4（頻度が低くてよいモード）。

#### 9. snack_break（休憩・おやつ）
- **シルエット**: 背もたれ寄り、机に皿。食べる→もぐもぐ→ぼーっのサイクル。
- **視線**: 皿⇄モニタ⇄宙。
- **高頻度Amb**: pick_eat / chew_happy / blank_stare。**抑制**: タイピング。
- **Reactive**: chatは「咀嚼停止→ごくん→指を払う→返信」（1〜2秒の演技遅延が可愛さの本体）。
- **遷移先**: work_normal(0.5) / video(0.25) / game(0.15) / music(0.1)。
- **時間帯**: 15時1.8（おやつの時間）/ 食後帯0.5。
- **AI文脈断片**: 「きりたんはおやつ休憩中です。機嫌は良めで、食べかけだったことに軽く触れても構いません。」
- **難易度根拠**: M — 皿prop＋手→口の往復精度。皿の搬入は§6.2のチート（フェード帰還時に机上出現→引き寄せ）で回避。

#### 10. music_listen（音楽鑑賞）
- **シルエット**: ヘッドホン装着、後傾、リズムの微揺れがループ内蔵（揺れ周期はBPM連動可能な設計に）。
- **視線**: 目を閉じる⇄薄目で宙。モニタはトラック替えの時だけ。
- **高頻度Amb**: rhythm_sway強化 / eyes_closed / finger_tap。**抑制**: PC作業系。
- **Reactive**: chatは「片耳ずらし→画面確認→返信」（ヘッドホンは外さない）。**music.changedに最も強く反応**してよい唯一のモード。曲名・アーティスト（取得可能なら曲調タグ）をAI文脈へ。
- **遷移先**: work_normal(0.5) / sleepy(0.2・夜) / video(0.15) / away(0.15)。
- **時間帯**: 夕〜夜1.5。
- **AI文脈断片**: 「きりたんはヘッドホンで音楽を聴いています。現在の曲: {{track}} / {{artist}}。返答で曲の雰囲気に少し触れて構いません。」
- **難易度根拠**: M–L — ヘッドホンprop装着が髪SpringBoneと干渉する懸念（C5・§1.3）。Spotify連携（B-5）と時期を合わせる。

#### 11. away_room（離席）
- **シルエット**: モデル非表示。椅子・机・小物だけの部屋。
- **Reactive**: すべて `offline`。チャット・通知はキューされ、帰還Transition後に「PC画面を確認→『あ』→まとめて返信」（`re_return_check`）。
- **離席理由**: Companionが時刻文脈から決定し `kiritanState.away.reason` に格納（12時台=ご飯×3.0 / 19時台=夕飯×3.0 / 15時台=おやつ探し / 雨の日=「傘持ってコンビニ」に文言変化）。原案の理由リストはそのまま採用。
- **遷移先**: 復帰時 prevMode(0.6) / work_normal(0.25) / snack(0.15・皿持ち帰り)。
- **時間帯**: 食事帯ブースト上記。深夜は離席ではなく睡眠に流す。
- **AI文脈断片**: 「きりたんは離席中です。理由: {{awayReason}}。戻りは{{expectedReturn}}頃。『戻ったら確認します』系の返答にしてください。」
  - **v1.1（Q23=D）**: 返答文を**理由で分岐**させる。例: コンビニ→「いま外なので、帰ったら返事します」/ ご飯→「ごはん中なので少し待ってね」/ おやつ探し→「ちょっと探し物中、すぐ戻ります」。`awayReason` を単に渡すだけでなく、理由カテゴリに応じた口調・帰還見込みを反映するよう指示する。
- **難易度根拠**: S — **P1はその場フェード**（`tr_fade_away`）。歩き退場はP4（C4のDSL拡張後）。

#### 12. sleep_desk（睡眠・寝落ち）
- **シルエット**: 机に突っ伏し（回転のみで近似、C4）。腕を枕に、顔は横向き。寝息＝胸/背中の深いオシレータをループ内蔵。
- **視線**: off。目は閉じ（blink 1.0）。
- **高頻度Amb**: head_shift / dream_smile（間隔30〜90秒と稀にして「静けさ」を保つ）。
- **Reactive**: `asleep`。chat・通知は原則未読のまま積む。10%で「もぞっ＋寝言」だけ。`urgent` のみ `tr_slump_wake` → 寝ぼけ返信（AIに「寝起きで誤字っぽく」を要求できる）。
- **遷移先**: 起床→ work_normal(0.5) / away(0.3・顔を洗いに) / sleepy(0.2・二度寝コース)。
- **時間帯**: 深夜4.0 / 夜1.5 / 昼0.2（昼寝は稀にあると可愛い）。
- **AI文脈断片**: 「きりたんは机に突っ伏して眠っています。メッセージにすぐ気づけません。起きたら読む、という前提の返答にしてください。」
- **難易度根拠**: S–M — postureは1体、小道具なし、Ambient頻度も低い。**安いのに差別化最強**。P1の主役。

### 3.4 遷移マトリクスと時間帯補正

**遷移表**（行=現在、重みは正規化前の相対値。`*` は時間帯補正が強く乗る）:

| from \ to | work | focus | sleepy | video | game | book | phone | call | snack | music | away | sleep |
|-----------|------|-------|--------|-------|------|------|-------|------|-------|-------|------|-------|
| work_normal | − | .15 | .10* | .15 | .10 | .08 | .12 | .02 | .07 | .08 | .15 | − |
| work_focus | .70 | − | .10 | − | − | − | − | − | − | − | .20 | − |
| work_sleepy | .25 | − | − | .10 | − | − | − | − | − | − | .15 | .50* |
| video_relax | .40 | − | .15* | − | .25 | − | − | − | .10 | − | .10 | − |
| game | .40 | − | − | .20 | − | − | − | − | .25 | − | .15 | − |
| read_book | .50 | − | .20 | − | − | − | .15 | − | − | − | .15 | − |
| phone_browse | .60 | − | − | .15 | − | − | − | .05 | − | .10 | .10 | − |
| phone_call | .70 | − | − | − | − | − | .10 | − | − | − | .20 | − |
| snack_break | .50 | − | − | .25 | .15 | − | − | − | − | .10 | − | − |
| music_listen | .50 | − | .20* | .15 | − | − | − | − | − | − | .15 | − |
| away_room | 復帰: prev .60 / work .25 / snack .15 | | | | | | | | | | | |
| sleep_desk | 起床: work .50 / away .30 / sleepy .20 | | | | | | | | | | | |

**daypart定義と補正**（重み乗数）:

| Mode | 朝 6–10 | 昼 10–17 | 夕 17–20 | 夜 20–24 | 深夜 0–6 |
|------|---------|----------|----------|----------|-----------|
| work_normal | 1.2 | 1.0 | 1.0 | 1.0 | 0.6 |
| work_focus | 1.3 | 1.0 | 0.8 | 1.3 | 0.7 |
| work_sleepy | 0.5 | 0.7 | 1.0 | 1.5 | 3.0 |
| video_relax | 0.7 | 1.0 | 1.2 | 1.3 | 0.8 |
| game | 0.5 | 0.9 | 1.2 | 1.5 | 0.8 |
| read_book | 0.8 | 1.0 | 1.4 | 1.4 | 0.6 |
| phone_browse | 1.0 | 1.0 | 1.0 | 1.0 | 0.7 |
| phone_call | 0.5 | 1.2 | 1.2 | 1.0 | 0 |
| snack_break | 0.7 | 1.0(15時1.8) | 1.0 | 1.0 | 0.5 |
| music_listen | 0.8 | 1.0 | 1.5 | 1.5 | 0.7 |
| away_room | 1.0 | 1.2(12–13時3.0) | 1.0(19–20時3.0) | 1.0 | 0.3 |
| sleep_desk | 0.3 | 0.2 | 0.5 | 1.5 | 4.0 |

補助変数: `sleepiness`（0..1）— 20時以降と連続在席時間で漸増、睡眠・離席でリセット。`work_sleepy` と `sleep_desk` の重みに乗算。

---

## 4. ModeごとのAmbient Micro Motion候補

凡例: 尺=秒、w=抽選重み(1–5)、★=**基本ループに内蔵すべき**モチーフ（Ambientとしては作らない）、🌙=夜間のみ/夜間重みUP。表情はモーフ名(weight)で注記。

### 4.1 work_normal（15）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| ★(ループ内蔵) | タイピング波 | − | 打鍵→止まる→打鍵のリズムをループに内蔵 | − |
| amb_work_type_burst | 集中打鍵 | 4–8 | 普段より速いタイピングの一山 | 4 |
| amb_work_mouse_drift | マウス操作 | 3–6 | 右手マウスへ→視線が画面を追う(cursor 0.5一時増) | 4 |
| amb_work_screen_scan | 画面を読む | 5–10 | 手を止め視線だけ左右、まばたき普通 | 4 |
| amb_work_sip | 一口飲む | 6 | カップへ手→一口→戻す(cup prop導入後) | 3 |
| amb_work_stretch | 伸び | 8–12 | test_stretchの座り版移植 | 2 |
| amb_work_posture_reset | 座り直し | 3 | 腰を引いて背筋リセット | 3 |
| amb_work_enter_phew | エンターで一息 | 4 | ッターン→ふぅ(口e 0.2) | 3 |
| amb_work_neck_roll | 首こき | 5 | 首をゆっくり回す | 2 |
| amb_work_cheek_scratch | 頬をかく | 3 | 片手で頬を2かき | 2 |
| amb_work_memo_glance | メモを見る | 4 | 机の手元へ視線を落とす | 2 |
| amb_work_hair_tuck | 髪を耳に | 3 | 髪をかき上げ耳にかける | 2 |
| amb_work_lean_check | 画面に近づく | 4 | 一瞬前傾して確認→戻る | 2 |
| amb_work_wrist_flex | 手首ほぐし | 4 | グーパー＋手首ぶらぶら | 2 |
| amb_work_yawn_small | 小あくび | 4 | o 0.3、手は添えない | 1🌙3 |
| amb_work_window_gaze | 窓を見る | 6–8 | 窓方向へ視線→ぼんやり→戻る(カメラは通過のみ) | 1 |

### 4.2 work_focus（12）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| ★ | 高速打鍵 | − | ループ内蔵(通常の1.3倍速) | − |
| amb_focus_stare_still | 凝視 | 6 | 瞬きを減らし画面を見つめる | 4 |
| amb_focus_lean_hold | 前のめり維持 | 8 | さらに5cm前傾して保持 | 3 |
| amb_focus_brow_knit | 眉を寄せる | 4 | angry 0.2＋首を傾けず | 3 |
| amb_focus_enter_breath | エンター→深い息継ぎ | 5 | 打ち切り→肩が下がる→再開 | 3 |
| amb_focus_mouse_micro | 細かいマウス | 4 | ピクセル単位の調整風 | 3 |
| amb_focus_think_pause | 手が止まる | 5 | 視線が上へ2秒→打鍵再開 | 3 |
| amb_focus_nod_small | 画面に頷く | 3 | 「よし」の小さい首肯 | 2 |
| amb_focus_lips_tight | 口元きゅっ | 4 | i 0.15を薄く | 2 |
| amb_focus_mutter | 考え事の口 | 4 | a 0.1で口が微かに動く | 1 |
| amb_focus_shoulder_drop | 肩の力を抜く | 3 | ふっと脱力→構え直す | 1 |
| amb_focus_time_glance | 時計ちら | 2 | 画面隅へ視線0.5秒 | 1 |

（抑制: 飲む・伸び・あくび・窓はこのモードのプールに入れない）

### 4.3 work_sleepy（13）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| amb_slpy_head_bob | こくっ→はっ | 4 | 頭が落ち→びくっと戻る(blink 0を0.5秒) | 5 |
| amb_slpy_eye_rub | 目をこする | 4 | 片手の甲で片目ずつ | 4 |
| amb_slpy_yawn_big | 大あくび | 5 | o 0.5＋blink 0.4(涙目)＋手を口へ | 4 |
| amb_slpy_elbow_chin | 肘つき頬杖 | 8–15 | 片肘を机に、頬杖でぼー | 4 |
| amb_slpy_slow_blink | 重いまばたき | 6 | blink 0.6→0.2→0.7のゆっくり明滅 | 4 |
| amb_slpy_weak_type | のろのろ打鍵 | 6 | 打鍵が遅く・止まりがち | 3 |
| amb_slpy_tilt_drift | 首が傾いていく | 8 | じわじわ右へ→気づいて直す | 3 |
| amb_slpy_slump_preview | 突っ伏しかける | 5 | 上体が机へ→寸前でこらえる | 2 |
| amb_slpy_refocus_shake | 頭を振って覚醒 | 3 | ぶるっと2往復→姿勢正す | 2 |
| amb_slpy_sigh | 眠いため息 | 3 | 肩が落ちる＋e 0.15 | 2 |
| amb_slpy_wrist_rub | 手首で目元 | 3 | 袖ごと目元をこする | 2 |
| amb_slpy_clock_check | 時計→うんざり | 3 | 時刻確認→sorrow 0.2 | 1 |
| amb_slpy_hair_face | 髪を払う | 4 | 落ちた前髪をのろく払う | 1 |

### 4.4 video_relax（12）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| amb_vid_chuckle | ふふっ | 3 | fun 0.4＋肩が2回揺れる | 4 |
| amb_vid_cheek_rest | 頬杖 | 10–20 | 片手頬杖で視聴継続 | 4 |
| amb_vid_grin | にやにや | 6 | fun 0.5を持続→緩める | 3 |
| amb_vid_sink_back | ずるっと沈む | 5 | 背もたれへさらに体重 | 3 |
| amb_vid_replay_reach | 操作して戻る | 6 | 前傾→マウス→後傾へ復帰 | 3 |
| amb_vid_sip | 一口 | 6 | cup prop(導入後) | 2 |
| amb_vid_eyes_widen | おっ | 2 | blink 0＋o 0.3で展開に反応 | 2 |
| amb_vid_nod_watch | 内容に頷く | 3 | うんうん | 2 |
| amb_vid_mouth_open | ぽかん | 5 | a 0.2で見入る | 2 |
| amb_vid_leg_shift | 座り替え | 4 | 腰yaw＋脚の組み替え風 | 2 |
| amb_vid_point_smile | 画面へ指差し | 3 | 小さく指して笑う(画面方向なのでOK) | 1 |
| amb_vid_drowse | まぶた重く | 8 | 夜のみ。sleepyへの布石 | 1🌙3 |

### 4.5 game_controller（15）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| ★ | 入力の体揺れ | − | 左右へ体が入るのはループ内蔵 | − |
| amb_game_grip_adjust | 握り直し | 2 | コントローラーを持ち替えカチャ | 4 |
| amb_game_lean_battle | ぐっと前のめり | 6 | 山場の前傾保持 | 4 |
| amb_game_body_steer_big | 大きく体が入る | 4–8 | コーナリングで体ごと傾く | 4 |
| amb_game_button_mash | 連打 | 3 | 腕と指が細かく震える | 3 |
| amb_game_win_smug | 小ドヤ | 4 | fun 0.4＋顎上げ＋胸張り | 3 |
| amb_game_lose_slump | 肩を落とす | 4 | sorrow 0.4＋上体が沈む | 3 |
| amb_game_mouth_focus | 口が半開き | 6 | a 0.15で無自覚集中 | 3 |
| amb_game_frust_puff | むっ | 3 | angry 0.2＋u 0.3(頬ふくらまし風) | 2 |
| amb_game_peer_close | 覗き込み | 4 | 画面に顔を寄せ目を細める | 2 |
| amb_game_pause_stretch | ポーズして伸び | 8 | 一時停止→伸び→再開 | 2 |
| amb_game_victory_fist | 小ガッツポーズ | 2 | 胸の前で小さく握る | 2 |
| amb_game_breath_reset | 深呼吸 | 4 | ふーっ→構え直す | 2 |
| amb_game_losing_desk | 連敗で沈む | 6 | 前へ倒れ込み→むくっと復帰 | 1 |
| amb_game_sip_nolook | 目を離さず一口 | 7 | 片手持ち替え＋手探りカップ(P4・高難度) | 1 |

### 4.6 read_book（12）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| amb_book_page_turn | ページをめくる | 3 | 右手でめくり→持ち直す | 5 |
| amb_book_soft_smile | ふっと笑う | 3 | fun 0.3、視線は本のまま | 3 |
| amb_book_line_trace | 行を指で追う | 5 | 人差し指が紙面をなぞる | 3 |
| amb_book_posture_shift | 持ち替え | 4 | 持ち手交代＋座り直し | 3 |
| amb_book_tilt_question | ん？ | 3 | 首かしげ＋眉動き | 2 |
| amb_book_puzzled | 難しい顔→戻る | 5 | angry 0.15→ページを少し戻す | 2 |
| amb_book_closer | 本を近づける | 4 | 目に近づけて凝視 | 2 |
| amb_book_down_think | 本を下げて宙 | 6 | 余韻に浸る視線(宙) | 2 |
| amb_book_eye_rest | 目を休める | 5 | 目を閉じ→深呼吸→再開 | 2 |
| amb_book_reread | 視線が往復 | 4 | 同じ行を2度なぞる目の動き | 2 |
| amb_book_bookmark_touch | しおり紐いじり | 3 | 指先でくるくる | 1 |
| amb_book_sleepy_nod | 本ごとこくり | 5 | 夜のみ。本を持ったまま船を漕ぐ | 1🌙3 |

### 4.7 phone_browse（10）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| ★ | 親指スクロール | − | ループ内蔵 | − |
| amb_ph_smile_screen | ふふ | 3 | fun 0.35、画面見たまま | 3 |
| amb_ph_type_thumb | フリック返信風 | 5 | 親指が細かく動く | 2 |
| amb_ph_freeze_stare | 真顔で固まる | 4 | 表情が消えてスクロール停止 | 2 |
| amb_ph_chuckle_shake | 笑って肩揺れ | 3 | fun 0.4＋肩2回 | 2 |
| amb_ph_notif_open | 通知を開く | 5 | 手が止まり→タップ→読む | 2 |
| amb_ph_close_face | 顔に近づける | 3 | 細部を見る | 2 |
| amb_ph_time_peek | 時刻だけ確認 | 2 | ちらっ→戻す | 2 |
| amb_ph_tilt_landscape | 横持ちへ | 4 | 持ち方を変える(動画でも見るか) | 1 |
| amb_ph_put_down_up | 置いてまた取る | 6 | 一旦机へ→3秒で結局また取る | 1 |

### 4.8 phone_call（10）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| amb_call_nod_listen | うんうん | 3 | 相づちの首肯2回 | 5 |
| amb_call_laugh | あはは | 3 | fun 0.4＋仰け反り小 | 3 |
| amb_call_gaze_wander | 視線が泳ぐ | 5 | fixed乱択で部屋を見回す | 3 |
| amb_call_bow | 見えない相手にお辞儀 | 3 | 通話相手にぺこり(日本人みが出る) | 3 |
| amb_call_hmm_trouble | えー…困り | 4 | sorrow 0.3＋首かしげ | 3 |
| amb_call_switch_ear | 持ち替え | 3 | 左右の耳を替える | 2 |
| amb_call_cover_mouth | 口元に手 | 4 | 内緒話っぽく | 2 |
| amb_call_fidget_sleeve | 袖いじり | 4 | 空いた手が袖をいじる | 2 |
| amb_call_memo_glance | メモへ視線 | 5 | 机のメモを見ながら話す | 1 |
| amb_call_wrapup_nod | 「うん、じゃあ」 | 4 | 切る前の連続頷き | 2 |

### 4.9 snack_break（12）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| amb_snk_pick_eat | つまんで食べる | 5 | 皿→口、pinch_snackハンド | 5 |
| amb_snk_chew_happy | もぐもぐ | 4 | u/o 0.2交互の微振動＋fun 0.3 | 4 |
| amb_snk_choose_hover | どれにしよう | 4 | 皿の上で手が迷う | 3 |
| amb_snk_blank_stare | ぼーっ | 6–10 | 視線が宙、呼吸だけ | 3 |
| amb_snk_lean_back | もたれる | 8 | 背もたれでひと息 | 3 |
| amb_snk_sip | 飲む | 5 | cup prop | 3 |
| amb_snk_pc_peek | 画面ちら見 | 3 | 食べながらモニタ確認 | 2 |
| amb_snk_satisfied | ふぅ…満足 | 3 | fun 0.25＋目を細める | 2 |
| amb_snk_wipe_mouth | 口元を拭う | 3 | 指先で口角 | 2 |
| amb_snk_dust_fingers | 指を払う | 2 | ぱっぱと2回 | 2 |
| amb_snk_crumb_catch | かけらを取る | 3 | 口元のかけらを指で | 1 |
| amb_snk_last_joy | 最後の一個 | 4 | 見つけてfun 0.5→大事に食べる | 1 |

### 4.10 music_listen（13）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| ★ | リズム微揺れ | − | ループ内蔵(周期はBPM連動設計) | − |
| amb_mus_head_beat | 首でリズム | 6 | 拍に合わせた首肯 | 4 |
| amb_mus_eyes_closed | 目を閉じ浸る | 8–15 | blink 1.0＋微笑 | 4 |
| amb_mus_finger_tap | 指タップ | 6 | 机/膝で拍を刻む | 3 |
| amb_mus_shoulder_groove | 肩でリズム | 5 | 左右交互に小さく | 3 |
| amb_mus_hp_adjust | ヘッドホン直し | 3 | 両手で位置調整 | 3 |
| amb_mus_hum | 口ずさみ | 6 | a/u 0.15交互、声は出ていない体 | 2 |
| amb_mus_track_glance | 曲変わり確認 | 3 | モニタへ視線→戻る | 2 |
| amb_mus_lean_immerse | 浸りのけぞり | 8 | 背もたれ＋顔やや上向き | 2 |
| amb_mus_fav_smile | この曲！ | 3 | イントロでfun 0.5 | 2 |
| amb_mus_volume_reach | 音量調整 | 4 | 机へ手→つまみ操作風→戻す | 1 |
| amb_mus_lyrics_mouth | サビで口が動く | 5 | 口モーフがやや大きく | 1 |
| amb_mus_air_baton | 小さく指揮 | 5 | 指先が宙で揺れる | 1 |

### 4.11 away_room
モデル非表示のためAmbientなし。**P4オプション**（部屋側の生活感演出）: モニタがスクリーンセーバーに変わる / 通知バッジが点滅する / （UIオーバーレイ）机に「コンビニ行ってきます」の書き置き付箋。

### 4.12 sleep_desk（10）
| id | 名称 | 尺 | 内容 | w |
|----|------|----|------|---|
| ★ | 寝息 | − | 深くゆっくりした胸・背オシレータをループ内蔵 | − |
| amb_slp_head_shift | 頭の向き替え | 4 | 顔の向きを反対側へ | 4 |
| amb_slp_arm_repos | 腕枕組み替え | 5 | 腕の位置をもぞっと | 3 |
| amb_slp_dream_smile | 夢で薄笑い | 5 | fun 0.2がふわっと出て消える | 2 |
| amb_slp_mumble | 寝言 | 4 | 口が微かに動く(a 0.1) | 2 |
| amb_slp_twitch | ぴくっ | 1 | 肩か指先が一瞬動く | 2 |
| amb_slp_half_wake | 薄目→再入眠 | 6 | blink 0.7→もぞ→1.0へ | 2 |
| amb_slp_breath_change | 呼吸が変わる | 10 | オシレータ周期の切替で寝の深さを演出 | 2 |
| amb_slp_ear_itch | 寝たまま耳かき | 3 | 無意識に耳の横をかく | 1 |
| （SpringBone任せ） | 髪が流れる | − | 頭の動きに追従、専用motion不要 | − |

---

## 5. ModeごとのReactive Motion候補

### 5.1 chat.received（AIチャット受信）

返信の流れ: ①気づき演技 → ②返信演技（`re_reply_typing` 等のループ）→ ③LLM応答到着 → ④Companionが**モード遅延に合わせて配信** → ⑤余韻→日常復帰。ゲーム等の長遅延は「LLMは即呼ぶが配信を遅らせる」方式（体感の自然さとAPI待ち時間を分離できる）。

| Mode | 遅延 | 演技シーケンス | 備考 |
|------|------|----------------|------|
| work_normal | 0.5–1.5s | 打鍵停止→姿勢正す→`re_reply_typing` | 基準形 |
| work_focus | 2–4s | 打鍵続行→止まる→小さくため息(angry 0.1)→返信 | AIへ「集中を切られた」文脈 |
| work_sleepy | 2–5s | のそっと顔上げ→目こすり→ゆっくり返信 | AIへ「眠い」文脈 |
| video_relax | 1–2.5s | 一時停止リーチ→向き直り→返信 | 終了後に再生再開の演技 |
| game_controller | 6–18s | 区切りイベントまで継続→pause→ふー→返信 | `queued`。配信遅延の主役 |
| read_book | 2–4s | しおり→本を伏せる→PCへ向く→返信 | 終了後また本を開く |
| phone_browse | 0.5–1s | 顔を上げ即返信 or そのままスマホで返信演出 | 最速モード |
| phone_call | 通話終了後 | （定型文「いま電話中みたいです…」をLLM呼ばず返す）→通話後 `re_call_end`→既読→本返信 | コストゼロの面白枠 |
| snack_break | 1–2s | 咀嚼停止→ごくん→指を払う→返信 | 「ごくん」が本体 |
| music_listen | 1–2s | 片耳ずらし→画面確認→返信 | ヘッドホンは外さない。曲情報をAIへ |
| away_room | 帰還後 | キュー→帰還Transition→`re_return_check`(画面確認→「あ」)→まとめ返信 | 「戻ったら確認します」定型可 |
| sleep_desk | 原則なし | 未読で積む。10%で「もぞ＋寝言」のみ。`urgent` 時のみ `tr_slump_wake`→寝ぼけ返信 | AIに「寝起きの誤字」を要求できる |

### 5.2 user.command.motion（明示コマンド — カメラ意識を許可する唯一の入口）

コマンド語彙（ホワイトリスト。これ以外の「こっちを見る」系は実行しない）:

| cmd id | 内容 | 尺 |
|--------|------|----|
| `cmd_wave` | カメラに手を振る | 3 |
| `cmd_look_smile` | カメラを見てにこっ(fun 0.5) | 2.5 |
| `cmd_peace` | ピース | 3 |
| `cmd_nod` / `cmd_shake` | はい / いいえ | 2 |
| `cmd_surprise` | 驚き演技(§5.7レシピ: blink0＋o＋びくっ) | 2.5 |
| `cmd_shy` | 照れ演技(§5.7レシピ) | 4 |
| `cmd_cheer` | 小さく応援(両手グー、えいえいおー) | 4 |
| `cmd_yareyare` | やれやれ/肩すくめ（片手を上げ首を振る・呆れ＋薄い笑み。v1.1追加 Q24） | 2.5 |

モード別の扱い: 通常系=即実行 / focus=実行するが余韻短い / game=ワンテンポ後 / **call=人差し指で「ちょっと待ってね」ジェスチャのみ**(コマンド自体は保留) / sleep=無視(寝返りだけ。設定で「起こす」を許可可) / **away=帰還後に実行＋きょろきょろ「呼ばれた気がした」**。実行後は必ず日常へ復帰し、カメラ目線の余韻は2秒まで。

### 5.3 notification.received（重要度3段階）

| 重要度 | 既定動作 | モード上書き |
|--------|----------|--------------|
| low | 視線だけ画面隅へ1秒(モード継続) | game/music: 70%無視。sleep/away: 無反応 |
| mid | 顔を上げ画面確認3秒→元のモードへ | focus: 50%で後回し(手を止めない)。book: 目だけ上げる |
| high | モード中断→work_normalへ遷移→`re_notif_urgent`(画面確認・angry 0.1) | sleep: びくっと起床(`tr_slump_wake`の短縮版)。away: 帰還後最優先で確認 |

### 5.4 music.changed（Spotify曲変化）

- **music_listen中**: `amb_mus_track_glance` 発火＋曲調タグで分岐（up-tempo→揺れ周期短縮＋fun 0.2 / ballad→eyes_closed率UP＋sorrow 0.1）。お気に入り登録曲なら `amb_mus_fav_smile`。曲名・アーティストをAI文脈に常時注入。
- **他モード中**: 原則無反応（5%で指タップが1回出る、くらいの「漏れ」だけ許す）。

### 5.5 time.changed（時刻・daypart）

- daypart境界: 遷移重みの再計算のみ（演技なし）。
- **特定時刻演出**: 12:00 `re_lunch_urge`（お腹に手→away誘発） / 0:00 `re_midnight_notice`（時計を見て遠い目→sorrow 0.15→sleepy重み×2） / 15:00 snack重み1.8。
- **追加提案 — session.start / session.resume**: PC起動・スリープ復帰をCompanionが検知。**1日初回のみ**きりたんが座り直して一度だけ軽く会釈（明示的なユーザー行為への反応＝Reactiveなのでカメラ意識OK）。2回目以降は姿勢を正すだけで気づかない体。「おかえり感」を出す最小コストの演出。

### 5.6 weather.changed

| イベント | 反応 | 備考 |
|----------|------|------|
| rain_start | 窓へ視線4秒→戻る | away理由が「傘持ってコンビニ」に変化。read_book重み1.3 |
| thunder | 驚きレシピ(肩びくっ＋blink0＋o) | high通知扱い。sleep中は50%で起きない |
| snow_start | 窓を見てfun 0.4、少し長め6秒 | 冬の特別感 |
| clear_after_rain | 窓ちら見2秒 | 低優先 |

実装は視線 `fixed`（窓座標）のみで成立。窓の見た目変化はBG側の既存仕組みに任せる。

### 5.7 AI連携仕様（感情レシピ・スキーマ）

**感情→表情レシピ表**（C1の不足モーフを代用で埋める。AIの語彙はこの9種に固定）:

| emotion | 表情モーフ | 体・視線 |
|---------|-----------|----------|
| neutral | {} | − |
| happy | fun 0.45（強→joy 0.25追加） | 軽く弾む |
| shy（照れ） | fun 0.3 + sorrow 0.25 | 視線そらし(yaw)＋頬に手 or 袖で口元。lookAt off |
| annoyed | angry 0.3 + u 0.2 | 顔を小さくそむける |
| proud（ドヤ） | fun 0.4 + i 0.15 | 顎上げ＋胸張り |
| sad | sorrow 0.5 | 俯き |
| surprised | **blink 0 + o 0.6** | 肩びくっ＋のけぞり0.1rad（2秒以内） |
| sleepy | sorrow 0.15 + 半目(extraBlink 0.5) | 頭ゆらゆら |
| thinking | u 0.15 | 視線上＋頬に指 |

**AI応答スキーマ v2**（原案から `interruptPolicy`・`lookAtUser` を削除 — §1.2-8）:

```json
{
  "replyText": "……いま集中してたんですけど。まあ、答えますよ。",
  "emotion": "annoyed",
  "motionCue": "reply_typing",
  "urgent": false
}
```

- `emotion`: 上表の9種enum。
- `motionCue`: 抽象動詞enum `reply_typing / look_up_think / pause_activity / resume_activity / shy_react / wave / none`。**壁紙側が現在モード×cueで実モーションに解決**する（例: `pause_activity` はゲーム中ならpause演技、読書中なら本を伏せる）。`wave` 等のユーザー意識系cueは、**ユーザーメッセージに明示要求があるとCompanionが判定した時だけ**有効化して渡す。
- `urgent`: 睡眠・離席をまたいで届けたい時の要求フラグ（許可判定はモード表）。

**kiritanState スキーマ**（壁紙→Companion `POST /api/kiritan/state`、モード遷移時＋30秒ハートビート。B-4で追加）:

```json
{
  "mode": "game_controller",
  "modeLabel": "ゲーム中",
  "since": "2026-06-12T21:04:00+09:00",
  "prevMode": "video_relax",
  "presence": "present",
  "ambient": { "id": "amb_game_win_smug", "endsAt": "2026-06-12T21:10:04+09:00" },
  "interruptPolicy": "queued",
  "chatDelayMsRange": [6000, 18000],
  "sleepiness": 0.2,
  "away": null
}
```

`away` 例: `{ "reason": "おやつが切れたのでコンビニに行っています", "expectedReturnAt": "..." }`

**AIプロンプトの組み立て**（Companion B-4）: 共通ヘッダ＋モード断片（§3.3の各カード）＋動的変数。

```text
[共通ヘッダ]
現在時刻: {{time}}（{{daypart}}） / 天気: {{weather}}
きりたんの状態: {{modeLabel}}（{{sinceMinutes}}分経過 / 直前: {{prevModeLabel}}）
直前の動作: {{ambientLabel}}
日常モーション中は、明示指示がない限りユーザー側へ手を振る等の演技をしません。
[モード断片] ← §3.3の「AI文脈断片」
[追加変数] 音楽: {{track}} / {{artist}}（music時のみ） 離席: {{awayReason}}（away時のみ）
```

---

## 6. Transition Motion一覧

### 6.1 前提機構: 小道具アンカー＋microEvents

- **prop追加（6種）**: `cup`（マグカップ）/ `phone` / `controller` / `book` / `headphones` / `snack_plate`。既存のpropLoader系に載せる（GLB＋placeholder box）。
- **アンカー**: `desk_left` / `desk_center` / `desk_right`（机上の定位置）、`hand_l` / `hand_r`（手ボーンへのparenting＋prop別オフセット）、`head`（ヘッドホン）、`off`（非表示）。装着オフセットはLabでキャリブして prop定義に保存。
- **microEvents仕様案**（C6の予約フィールドを使用。Motion Director 0.9が実行）:

```jsonc
"microEvents": {
  "props": [
    { "t": 1.2, "action": "attach", "prop": "controller", "anchor": "hand_r" },
    { "t": 1.2, "action": "attach", "prop": "controller", "anchor": "hand_l" },   // 両手持ちは主従で表現
    { "t": 5.0, "action": "detach", "prop": "controller", "restoreTo": "desk_right" },
    { "t": 0.0, "action": "show",   "prop": "snack_plate", "anchor": "desk_center" }
  ]
}
```

- **状態不変量（ワープ防止の機械検証）**: 各モード・各Transitionの前後状態を `[posture, hands{L,R}, props{...}]` タプルで定義し、FSMは**タプルが一致するエッジだけ遷移可**。例: 「awayへは必ず両手が空（持ち物をdesk/headに返却済み）の状態を経由する」。Motion Director 0.9のコア仕様。

### 6.2 Transition部品表

| id | 内容 | 尺 | 前提 | 難易度 | Phase |
|----|------|----|------|--------|-------|
| `tr_lean_forward` / `tr_lean_back` | A族⇄A'族の前傾/後傾移行 | 2 | − | S | P1 |
| `tr_sit_to_slump` | 机に突っ伏す（回転のみ近似） | 4 | − | S | P1 |
| `tr_slump_wake` | むくっ→目こすり→伸び→PCへ向き直る | 6 | − | S–M | P1 |
| `tr_fade_away` | その場フェードアウト（椅子だけ残る） | 3 | 透明度制御 | S | P1 |
| `tr_fade_return` | フェードイン（着席状態で出現） | 3 | 同上 | S | P1 |
| `tr_take_desk_r` / `_l` | 机の物へ手を伸ばし把持（attach） | 2.5 | §6.1機構 | S | P2 |
| `tr_place_desk_r` / `_l` | 置く（detach→desk slot） | 2.5 | 同 | S | P2 |
| `tr_controller_ready` | 取る→両手で構える | 4 | take汎用＋`controller_grip` | M | P2 |
| `tr_controller_away` | 構え解除→置く | 3 | 同 | M | P2 |
| `tr_phone_raise` / `tr_phone_down` | スマホを顔前へ / 置く | 2 | phone prop | S | P2 |
| `tr_phone_to_ear` | 顔前→耳（通話開始） | 2 | 同 | S | P4 |
| `tr_book_open` | 本を取り両手で開く | 4 | book prop | M | P3 |
| `tr_book_close` | 閉じて置く（しおり演技含む） | 4 | 同 | M | P3 |
| `tr_headphone_on` | 両手で頭へ装着 | 5 | head anchor・**髪SpringBone干渉検証先行** | M–L | P3 |
| `tr_headphone_off` | 外して机へ（or 首掛け） | 4 | 同 | M | P3 |
| `tr_plate_pull` | 机上の皿を手前に引き寄せる | 3 | ※チート: 皿は `tr_fade_return` 時に机上へ出現させる | S | P3 |
| `tr_plate_push` | 皿を端へ寄せる（休憩終了） | 2 | 同 | S | P3 |
| `tr_sit_to_stand` / `tr_stand_to_sit` | 立つ / 座る | 3 | **DSL hips位置キー拡張（C4）** | L | P4 |
| `tr_walk_exit` / `tr_walk_enter` | 歩いて画面外へ / 戻る | 4–6 | 同上＋ルートモーション | L | P4 |

**Transition不要の遷移**（クロスフェード1.5秒で成立 — 作らないことを明記してコスト削減）:
- work_normal ⇄ work_focus / work_sleepy（同posture、表情とテンポ差のみ）
- phone_browse ⇄ phone_call（持ち替え `tr_phone_to_ear` だけ）

### 6.3 主要モードペア→必要Transition対応表

| 遷移 | 再生順 |
|------|--------|
| work ⇄ focus / sleepy | （クロスフェードのみ） |
| work ⇄ video | `tr_lean_back` / `tr_lean_forward` |
| work/video → game | `tr_take_desk_r`＋`tr_controller_ready` |
| game → work/video/snack | `tr_controller_away`（→snackなら続けて `tr_plate_pull`※帰還経由） |
| work → phone_browse | `tr_phone_raise` |
| phone_browse → work | `tr_phone_down` |
| phone_browse → call | `tr_phone_to_ear` |
| work → read_book | `tr_take_desk_l`＋`tr_book_open` |
| read_book → work | `tr_book_close` |
| work → music | `tr_take_desk_l`＋`tr_headphone_on` |
| music → work | `tr_headphone_off` |
| sleepy → sleep | `tr_sit_to_slump` |
| sleep → work/away | `tr_slump_wake`（→awayなら続けて `tr_fade_away`） |
| any → away | （B族なら持ち物返却 `tr_place_*` / `tr_headphone_off` を前置）→ `tr_fade_away` |
| away → prev | `tr_fade_return`（→snack復帰なら机上に皿出現＋`tr_plate_pull`） |

---

## 7. 最初に作るべき優先セット

### 7.1 採点表（各1–5、合計30点満点）

基準: ①見た目の差別化 ②実装難易度の低さ ③小道具の少なさ ④生活感 ⑤AIチャット連動の面白さ ⑥1か月の見飽き耐性

| Mode | ① | ② | ③ | ④ | ⑤ | ⑥ | 計 | 判定 |
|------|---|---|---|---|---|---|----|------|
| work_normal | 2 | 5 | 5 | 5 | 4 | 5 | 26 | **P1**（基準ハブ） |
| work_sleepy | 4 | 4 | 5 | 5 | 3 | 4 | 25 | **P1** |
| sleep_desk | 4 | 4 | 5 | 5 | 3 | 4 | 25 | **P1** |
| away_room | 4 | 5 | 5 | 5 | 3 | 4 | 26 | **P1**（フェード版） |
| video_relax | 3 | 4 | 5 | 4 | 3 | 4 | 23 | **P1** |
| work_focus | 3 | 5 | 5 | 3 | 4 | 3 | 23 | P2 |
| game_controller | 5 | 2 | 3 | 4 | 5 | 4 | 23 | P2 |
| phone_browse | 3 | 3 | 4 | 4 | 3 | 3 | 20 | P2 |
| music_listen | 4 | 2 | 3 | 4 | 5 | 4 | 22 | P3（Spotify B-5と同期） |
| read_book | 4 | 2 | 3 | 4 | 3 | 3 | 19 | P3 |
| snack_break | 4 | 2 | 2 | 5 | 3 | 3 | 19 | P3 |
| phone_call | 4 | 2 | 4 | 3 | 2 | 2 | 17 | P4 |

### 7.2 Phase 0 — 基盤（モーション著作の前に。0.8/0.9に対応）

1. **座りポーズ校正**（0.8）: `sit_pc_neutral` を椅子に合わせてキャリブ、スカート貫通検証。→ これが通らないと全部止まる。
2. **Motion Director MVP**（0.9）: ループ再生＋Ambientスケジューラ（§3.1仕様）＋表情/lookAt/hipsOffsetのランタイム適用（C2解消）＋Long Mode FSM（滞在タイマー・遷移表・daypart補正）＋クロスフェード遷移＋状態不変量チェック（§6.1）。
3. **propアンカー＋microEvents実行系**（§6.1）— P1では使わないがP2の前提。実装だけ先行可。
4. **kiritanState POST**（Companion B-4と同時）。
5. DSL拡張（hips位置キー）は**P4まで不要**（フェード離席で回避するため後回しでよい）。

**DoD**: `loop_work_normal`＋Ambient3種が24時間ソークで破綻しない（drift・抽選偏り・メモリ）。

### 7.3 Phase 1 — 「PC作業の一日」セット（モーション約35本）

モード: **work_normal / work_sleepy / sleep_desk / video_relax / away_room**。
小道具ゼロ（カップのみ任意で後乗せ）。これだけで「朝作業→昼離席→午後作業→夜だらだら動画→うとうと→寝落ち→起きて離席」の1日サイクルが自走し、夜の物語（sleepy→sleep）が成立する。

| 種別 | 本数 | 内訳 |
|------|------|------|
| posture | 3 | sit_pc_neutral / sit_pc_slouch / sit_desk_slump |
| hand | 2 | type_natural / loose |
| loop | 4 | loop_work_normal / loop_work_sleepy / loop_video_relax / loop_sleep_desk |
| ambient | 20 | work: type_burst, screen_scan, stretch, posture_reset, enter_phew ／ sleepy: head_bob, eye_rub, yawn_big, elbow_chin, slow_blink ／ video: chuckle, cheek_rest, sink_back, replay_reach, grin ／ sleep: head_shift, arm_repos, dream_smile, mumble, twitch |
| transition | 6 | tr_lean_back / tr_lean_forward / tr_sit_to_slump / tr_slump_wake / tr_fade_away / tr_fade_return |
| reactive | 5 | re_reply_typing / re_chat_sleepy / re_chat_video_pause / re_notif_glance / re_return_check |
| cmd | 2 | cmd_wave / cmd_look_smile（Reactive原則の実証用） |

計: posture 3＋hand 2＋motion 37。著作ペース（C10: 単純15分、複雑×2〜3）でモーションのみ正味12〜18時間 ≒ 著作セッション3〜5日分。

**DoD**: ①1日サイクルが無操作で自走 ②チャットに3モード以上で反応差が出る ③Ambient中にカメラ目線が一度も発生しない（ログで機械確認）。

### 7.4 Phase 2 — 差別化の柱（＋prop機構の実戦投入）

- **work_focus**（最安の追加: posture流用、Ambient6本＋ループ1本）
- **phone_browse**（B族の練習台: 小さいprop1個、attach/detach検証）
- **game_controller**（差別化最大＋「遅延返信」演出の主役）
- 汎用 `tr_take_desk_* / tr_place_desk_*`、cup prop追加（amb_*_sip解禁）
- 追加 約25本。**DoD**: ゲーム中チャット→区切り→pause→返信のデモが通る。

### 7.5 Phase 3 — 趣味の幅

- **read_book** / **snack_break** / **music_listen**（Spotify B-5のNow Playingと同時リリース）
- ヘッドホン×髪の干渉検証はPhase 2中に先行スパイク。
- 追加 約35本＋prop 4種。**DoD**: music_listen中にmusic.changedで表情・揺れが変わる。

### 7.6 Phase 4 — 仕上げ

- phone_call（着信Reactive起点）/ DSL hips拡張→立ち座り・歩き退場 / 窓の天気演出強化 / session.start挨拶 / 部屋側away演出 / 歌詞コンテキスト（ライセンス調査が通れば）。

---

## 8. Motion DSL / Motion Lab へのブリーフ化方針

### 8.1 命名・カテゴリ規約

| prefix | category | 例 | 備考 |
|--------|----------|----|------|
| `loop_` | `loop` | `loop_work_normal` | モードごとに1本（将来 `_a/_b` バリアント） |
| `amb_<short>_` | `ambient` | `amb_work_type_burst` | shortは work/focus/slpy/vid/game/book/ph/call/snk/mus/slp |
| `tr_` | `transition` | `tr_sit_to_slump` | 汎用部品はモード名を含めない |
| `re_` | `reactive` | `re_reply_typing` | イベント駆動 |
| `cmd_` | `command` | `cmd_wave` | カメラ意識OKの唯一のカテゴリ |

`tags` の値域: `mode:<id>`（複数可）/ `daypart:night` / `family:A|A'|B` / `bpm-sync`（music用）。Motion Director（0.9）のスケジューラは category＋tags で抽選プールを構成する。

### 8.2 ブリーフテンプレ拡張（`motion_briefs/_TEMPLATE.md` への追加セクション）

```markdown
## 分類とスケジューラ
- category: ambient / loop / transition / reactive / command
- tags: mode:work_normal, daypart:night …
- 抽選重み: 3 / 想定発火間隔: §3.1のモード値

## 前提状態（不変量）
- posture: sit_pc_neutral / hands: L=type_natural R=type_natural
- props: cup@desk_left（このmotionの開始時点で成立していること）
- 終了状態: 開始と同じ（ambient） / 〜に変える（transition）

## propイベント（transitionのみ）
- t=1.2 attach controller → hand_r …（§6.1スキーマで列挙）

## 禁止事項（生活モード共通）
- lookAt: camera 禁止（cmd_系以外）
- 表情weight ≤ 0.5（ambient）
- 2連発再生されても破綻しない（開始・終了ポーズ＝基準ループの姿勢）
```

### 8.3 発行バッチ計画（Phase 1の場合）

1. **Batch W0**: posture先行ブリーフ3本（sit_pc_neutral → 椅子キャリブ → slouch / slump 派生）。カメラプリセット `workdesk_front` / `workdesk_side` で検収観点を固定。
2. **Batch W1**: `loop_work_normal`＋amb_work×5。同一posture・同一カメラなので検収を使い回せる。
3. **Batch W2**: sleepy系（loop＋amb×5＋tr_sit_to_slump）。
4. **Batch W3**: sleep系＋video系＋tr残り。
5. **Batch W4**: reactive＋cmd。

**1バッチ＝同一posture共有群**でまとめるのが鉄則（Labのカメラ設定・目視観点・hand資産を使い回せて、1本あたりの検収コストが下がる）。

### 8.4 検収チェックリスト（AUTHORING_GUIDE §3に生活モード固有を追加）

- [ ] `load()` warnings 0 / `checkLoop()` ok（loop時）
- [ ] **lookAt目視レビュー（v1.1 Q33=B で機械禁止は撤回）**: validateに `mode:'camera'` 禁止規則は**入れない**。Ambientに低頻度の自然な視線通過は可。レビューで「貼り付くような対ユーザー凝視・手振り等の演技がAmbientに無い」ことを確認する運用に変更
- [ ] 表情weight ≤ 0.5（ambient）/ blink:0 は2秒以内
- [ ] ループ呼吸はoscillatorで（duration＝period整数倍）
- [ ] 開始・終了ポーズが基準ループと一致（2連発・割込みフェード耐性）
- [ ] propイベントの t がキー時刻と一致（手が触れる前にattachしない）
- [ ] キャプチャ目視: キー時刻全部＋中間1–2点＋顔アップ1枚
- [ ] `play()` でミキサー経路確認

### 8.5 「見飽きない」ための数値設計の考え方

- 体感の単調さは「**同一モチーフの再生間隔**」で決まる。目標: 同一Ambientの再生間隔の中央値 ≥ 15分（モード滞在をまたいで）。Phase 1の20本＋間隔25–70秒なら概ね達成。足りなくなったら本数を増やすのではなく**ループバリアント**（`loop_work_normal_a/b`）と**daypart限定Ambient**（🌙）で「組み合わせの一巡」を引き延ばす方が安い。
- 1か月で一巡する変化の層: ①分単位=Ambient ②十分単位=Long Mode遷移 ③時間単位=daypart補正 ④日単位=天気・曜日（P4）⑤不定期=Reactive。層が独立しているほど「今日は違う日」感が出る。

---

*この設計表の§4の各行（id・尺・内容・表情視線・重み）は、そのまま `motion_briefs/<id>.md` 1本に展開できる粒度で書いてある。Phase 1着手時はBatch W0のposture 3本のブリーフから発行すること。*
