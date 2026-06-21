# 伸びモーション人間味付け — 3アプローチ比較(2026-06-12)

「test_stretch がポン出し感(定量的・直線的・指が死んでる・手がぎこちない)」という課題に対し、
**開発方法(DSL+Motion Lab著作ループ)を変えずに**、3つの異なる系譜の手法で同じ伸びを作り直した。

## 見比べ方

```
npm --prefix 01_wallpaper run dev -- --port 5187 --strictPort
# ブラウザで http://localhost:5187/?lab=1 を開き、DevToolsコンソールで:
__motionLab.play('stretch_principles')   // 案A
__motionLab.play('stretch_noise')        // 案B
__motionLab.play('stretch_spring')       // 案C
__motionLab.play('test_stretch')         // 比較元(変更なし)
__motionLab.stop()                       // アイドルへ戻す
```
LabパネルのモーションセレクタからでもOK。**タブを前面に出しておくこと**
(非表示タブはrAFが止まり再生が進まない — ヘッドレス検証で確認済みの罠)。

## 3案の概要

### 案A `stretch_principles` — アニメーション12原則の手作りキーフレーム
- **系譜**: ディズニーの12原則(Anticipation / Follow-through / Overlapping action / Secondary action / Slow-out Fast-in)
- **エンジン変更**: なし(純粋にキーの打ち方)
- **中身**: 伸びる前に一度縮む「溜め」→ 右腕0.25s先行・左右振幅差 → 体幹→肩→肘→手首→指のカスケード遅延 →
  ピーク中の「もうひと押し」(人間は保持中に再加圧する) → 重力で加速する速い脱力(easeIn)が静止位置を通り越して
  振り子のように2回揺れて馴染む → 指はピークでピンと開き(relaxカールをoffsetで打ち消し、指ごとに振幅と時刻を微差)、
  脱力時は余分にカールしてから戻る。手首は上げで遅れて垂れ、下ろしでフロップ。
- **トラック数**: 32(うち指20)・手打ち
- **キャプチャ所見**: 右腕先行・再加圧・速い脱力・揺り戻し・満足げな余韻、指の開きすべて確認。演技の情報量は3案中最大。

### 案B `stretch_noise` — プロシージャルノイズのレトロフィット
- **系譜**: Ken Perlin の Improv(1996)以来の「関節角にノイズを重ねる」古典手法
- **エンジン変更**: oscillator拡張(後方互換) — `kind:"noise"`(決定的バリューノイズ、ループ時は格子をdurationにラップ=継ぎ目厳密一致)、`window:[t0,t1]`+`attack`/`release`(時間窓エンベロープ)、`seed`。あわせてランタイムベイクを20→30fpsへ(5Hz tremorのエイリアス防止)
- **中身**: **ベースのキーフレームは test_stretch と1キーも変えていない**。ピーク保持窓[4.5–7.2]だけ両腕・胸に約5Hz・0.006〜0.014radの筋緊張tremor(左右は別seed/別周期で非相関)、保持中の姿勢の迷い(spine y)、常時の生体ゆらぎ(head/spine)、手首・指のもぞもぞ(全期間・低速ノイズ)。
- **キャプチャ所見**: 保持中(キーフレームは静止区間)に上腕zが±0.015radで揺れ、指も常時微動 — 数値で確認。姿勢破綻なし。
- **意味**: 既存モーション資産を作り直さず救済できる唯一の案。ただし演技構造(左右対称・指が開かない等)は元のまま。

### 案C `stretch_spring` — バネ・ダンパー物理シミュからベイク
- **系譜**: Cascadeur の AutoPhysics、Overgrowth(GDC 2014)の「少数キーポーズ+物理補間」、ゲーム業界のspring-damper二次モーション
- **エンジン変更**: なし(オフライン生成)。`tools/bake_spring_motion.mjs`(依存なしNode)が、関節ごとの目標ポーズのステップ列(モータープログラム)を 体幹ω4.5/ζ1.0 〜 指ω16/ζ0.62 の2次系で追従シミュレートし、2周ウォームアップで周期定常に収束させてから12fps密キーの標準.motion.jsonへベイク(280KB・手編集禁止・再生成は `node tools/bake_spring_motion.mjs`)
- **中身**: 加減速・オーバーシュート(ピーク到達で-2.02→-2.00へ揺り戻し、脱力で0を+0.056まで通り越して減衰振動)・関節カスケード(ωの勾配が自動で生む)がすべて物理由来。右0.2s先行と指の開閉はイベント定義で表現。
- **キャプチャ所見**: 上昇中の肘カスケード、ピークのオーバーシュート、肘が畳まれながらのドロップ、揺り戻しを確認。速度プロファイルの「正しさ」は3案中随一。

## 評価まとめ(著者所見 — 最終判断はユーザーの目視で)

| 観点 | A 12原則 | B ノイズ | C バネ物理 |
|------|---------|---------|-----------|
| 演技の情報量(指・表情・非対称) | ◎ 最大 | △ 元のまま | ○ イベントで表現 |
| 速度プロファイルの自然さ | ○ 手打ちの限界あり | △ 元のまま | ◎ 物理由来 |
| 微細な「生きてる感」(静止しない) | △ オシレータ2本のみ | ◎ tremor+常時ゆらぎ | ○ 減衰振動の尻尾 |
| 制作コスト | 高(32トラック手打ち) | 最小(レイヤ追記のみ) | 中(イベント+ω/ζ調整) |
| 既存資産への適用 | 作り直し | ◎ そのまま足せる | 作り直し(生成) |
| 量産・再現性 | 職人芸 | ◎ レシピ化容易 | ◎ パラメータ化済み |

**提言**: 本命は **C をベース軌道生成に、B のノイズ層を上掛け**(bakeスクリプトの出力に
noiseオシレータを足すだけ — 2手法は完全に直交)。A は「演技設計の正解集」として、
ピーク再加圧・ため息・指の開閉タイミングなどを C のイベント列に移植するのが効率的。

## 関連ファイル
- ブリーフ: `01_wallpaper/motion_briefs/stretch_{principles,noise,spring}.md`
- モーション: `01_wallpaper/public/motions/dsl/stretch_{principles,noise,spring}.motion.json`
- 生成器: `tools/bake_spring_motion.mjs`
- エンジン拡張: `src/lib/motion/dsl/{types,evaluate,validate}.ts`(oscillator)、`compileClip.ts`(30fps)
- キャプチャ: `01_wallpaper/.probe_tmp/captures/stretch_*/`(リポジトリ非同梱)

## 先行事例(調査メモ)
- Perlinノイズによる関節角の有機的ゆらぎ — 業界標準の古典([参考](https://www.numberanalytics.com/blog/procedural-animation-techniques))
- David Rosen "An Indie Approach to Procedural Animation"(GDC 2014、Overgrowth) — 少数キーポーズ+手続き補間([参考](https://blog.littlepolygon.com/posts/loco1/))
- Cascadeur AutoPhysics — ラフなキーフレームへ物理ソルバで人間味を後付け、「元の意図を最小限の変更で物理的に正しく」([公式](https://cascadeur.com/))
- 現代の制作現場はMoCapベース+プロシージャル上掛けのレイヤリングが主流([参考](https://mocaponline.com/blogs/mocap-news/procedural-animation-generation-guide))
