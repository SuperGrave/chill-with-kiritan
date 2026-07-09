# 情報表示部UIスタイル調査レポート

作成日: 2026-07-09

対象: `02_ui-overlay` の情報表示部UI、および `01_wallpaper` に埋め込まれる統合表示

## 要約

現在の情報表示部UIは、白黒を主軸にした「シックな工業計器 / 放送卓 / 半透明HUD」
の方向で成立している。かわいいキャラクター壁紙の上に乗るUIだが、UI自体は甘くせず、
数字、罫線、薄いグレー面、斜線ゲージ、英字ラベルで引き締めている。

雰囲気を言葉にすると、以下が近い。

- モノクロ、低彩度、白い発光文字、スモークガラス
- 工業計器、放送用テロップ、監視卓、ミキサー卓、古い電光表示
- 角は丸いが柔らかすぎず、情報カードは重く静かに浮く
- 色は基本的に意味のある状態表示だけに使う
- 装飾ではなく、罫線・番号・バー・余白で見せる

Companionに適用するなら、「アプリの便利さ」は保ちつつ、外観はこのHUD語彙へ寄せる。
つまり、操作画面を派手な管理アプリにせず、情報卓・調整卓として扱う。

## 調査方法

- `02_ui-overlay/src` のコンポーネント、CSS、デフォルト設定を確認。
- `02_ui-overlay` を `http://127.0.0.1:5174/` で起動。
- 設計解像度 `1920x1200` でスクリーンショット確認。
- 実画面の computed style を一部取得し、コード上の値と照合。

確認時の代表値:

| 要素 | 実測 / 実装値 |
|------|---------------|
| Floating panel | `rgba(0,0,0,0.34-0.4)`, `blur(16px)`, `border-radius: 24px` |
| Floating panel border | `1px solid rgba(255,255,255,0.15)` |
| Floating panel shadow | `0 12px 40px rgba(0,0,0,0.4)` |
| Header | `22px`, `letter-spacing: 0.15em`, bottom hairline |
| Clock | 背景なし、巨大な白文字、強い text-shadow |
| Weather compact | 背景なし、白文字、斜線ゲージ、英字ラベル |
| Right dock | `rgba(0,0,0,0.1)`, `blur(10px)`, `border-radius: 16px` |

## 画面構成

基本キャンバスは `1920x1200`。中央はキャラクターと背景のために広く空け、情報は
左上、右側、下端へ寄せている。

- 左上: 日付・時刻。背景面なし。巨大な白い発光文字。
- 左上の下: 天気compact。横長の斜線ゲージと数値。
- 右上: NEWS。縦長カードにニュース4件。
- 右中: MUSIC。アルバム枠と再生バー。
- 下端左: TIMER。大きな時間と進捗バー。
- 下端中央: MEMO。薄い小カード。
- 下端右: PERSONAL NEWS / LYRICS。横長ティッカー。

重要なのは、すべてをカードで埋めないこと。余白が大きいほど、UIが「壁紙の上の計器」
として見える。Companionでも余白を完全に消すより、密度を上げつつセクション間に
静かな間を残すと近い雰囲気になる。

## 色

色はほぼ白、黒、グレーで構成される。

主役:

- 文字: `#fff`
- 面: `rgba(0, 0, 0, 0.34)` から `rgba(0, 0, 0, 0.4)`
- 薄い面: `rgba(255,255,255,0.04)` から `rgba(255,255,255,0.08)`
- 罫線: `rgba(255,255,255,0.10)` から `rgba(255,255,255,0.34)`
- 強調罫線: `rgba(255,255,255,0.4)` 前後

例外色:

- live / ok: 透明グリーン
- warn: 透明オレンジ
- error: 透明レッド
- 天気の最高/最低: 赤と青
- personal newsの補足: 淡い水色

例外色は、装飾色ではなく状態色。常時見える面積はかなり小さい。Companionへ移植する時も、
タブや主要ボタンを色分けしすぎない方が近い。

## タイポグラフィ

表示の印象を一番作っているのはフォント。`WD-XLLubrifontJPN-Regular` がメインで、
英字・数字・日本語が少し機械的、少し古い電光表示のように見える。

基本:

- メインフォント: `WD-XLLubrifontJPN-Regular`, fallback `Noto Sans JP`
- 本文fallback: `Noto Sans JP`, `Zen Kaku Gothic New`
- ラベルは英大文字中心。
- 見出しは字間を広げる。
- 本文はやや細く、opacityを落として階層を作る。

字間の傾向:

- パネル見出し: `0.15em`
- 天気compact: `0.15em`、情報行は `0.2em`
- 状態メタ情報: `0.08em` から `0.12em`
- ニュース本文・メモ本文: `0.03em`

巨大数字は、時計とタイマーで特に効いている。数字は単なる数値ではなく、
計器盤の主表示として扱われている。

## サーフェス

主要カードは `FloatingPanel`。デフォルトの見た目は以下。

- absolute配置
- padding `26px`
- radius `24px`
- background `rgba(0,0,0,0.4)` または `0.34`
- backdrop blur `16px`
- border `1px solid rgba(255,255,255,0.15)`
- shadow `0 12px 40px rgba(0,0,0,0.4)`
- opacity fadeで表示/非表示

この面は、黒いカードというより「薄いスモークガラス」。背景が暗い時は沈み、
白い背景の上ではグレーの工業パネルに見える。

パネル内の見出しは、下罫線つき。

- font-size `22px`
- `letter-spacing: 0.15em`
- margin-bottom `18px`
- padding-bottom `10px`
- border-bottom `1px solid rgba(255,255,255,0.2)`

Companionでは、ウィンドウ全体の背景を少し暗くして、このカードを主要セクションに使うと
自然に移植できる。ただしカードの入れ子は避け、セクション帯かタブ面として扱う方が良い。

## 罫線とゲージ

工業感を出している細部は、太い装飾ではなく細い線とパターン。

- ニュースの項目区切り: `rgba(255,255,255,0.1)` の横罫線
- 最新ニュース / pinned memo / forecast note: 左罫線
- Weather / Music / Timer: 細い矩形トラック
- 進捗fill: 斜めストライプの `repeating-linear-gradient`
- Weather: diagonal / vertical / dot pattern
- 現在位置: 1px marker、または小さな三角マーカー

このUIでは「バー」が単なるプログレスバーではなく、温度・湿度・再生位置・タイマーを
同じ語彙で表す共通計器になっている。

## 情報階層

階層は色よりも、サイズ、opacity、番号、罫線で作る。

- 主要値: 大きい、白、opacity高め
- メタ情報: 小さい、字間広め、opacity `0.45-0.72`
- 補足文: 小さめ、line-height広め、opacity `0.55-0.7`
- 状態badge: 小さな角丸、薄い背景、細いborder
- 項目番号: `01`, `02` のように2桁、薄い白

ニュース欄はこの思想が特に強い。番号、時刻、source、LATEST badge、タイトル、summaryを
色面ではなく階層で整えている。

## パネル別の印象

### Clock

背景を持たない白い発光文字。日付も時刻も大きく、壁紙上の主計器として振る舞う。
`time-digit` が桁ごとの幅を持つため、数字が変わっても揺れにくい。

### Weather Compact

場所・天候・気圧を英字で横並びにし、その下に温度と湿度のゲージを置く。
温度の赤青以外はほぼ白黒。斜線パターンと細いmarkerで、工業計器らしさが強い。

### News

縦長の放送ニュース欄。`01` などの番号、時刻、source、LATEST badge、タイトル、
summaryが縦に並ぶ。最新項目だけ左罫線が入る。本文は薄く、見出しを邪魔しない。

### Music

アルバムアート枠が右上にあり、再生していない時は `NO ARTWORK` が薄く出る。
トラック名、アーティスト、再生バーだけの抑制された構成。操作ボタンはデフォルト非表示で、
壁紙側では鑑賞用の表示に寄っている。

### Lyrics / Personal News

下端の横長ティッカー。歌詞がある時は中央のcurrent lineを大きくし、前後行は薄くする。
Personal Newsではトピック行、本文marquee、補足テキスト、進捗markerが同じ面上に並ぶ。
ニュースというより、放送中のテロップに近い。

### Memo

最も控えめ。薄いカード、pinned左罫線、本文はやや大きい。情報の重さを上げず、
壁紙の邪魔をしないメモとして置かれている。

### Timer

小さなラベル、大きな `25:00`、細い進捗バー。数字が主役。
ボタンは表示可能だがデフォルトでは表示しない。壁紙上では操作より状態表示が中心。

## モーション

動きは控えめ。

- パネル表示: opacity `0.4s cubic-bezier(0.25, 0.8, 0.25, 1)`
- 歌詞current: 520msの軽いpulse
- personal news: 横スクロールmarquee
- progress fill: width変化のみ

Companion側では、タブ切替やパネル展開に同じ `0.18s-0.4s` の短いfade/slideを使うと合う。
派手なbounce、強いscale、カラフルなhoverは合わない。

## Companionへ適用する時の設計指針

### 守りたいもの

- 背景は深い黒/チャコールを基調にする。
- セクション面は `rgba(0,0,0,0.34-0.4)` に近いスモークガラス。
- borderは白の `0.10-0.20` alpha程度。
- 大見出しは英大文字、広い字間、下罫線。
- 日本語本文にも同じ機械的フォントを使うが、長文は読みやすいfallbackを混ぜる。
- 主要値は大きく、補足は薄く。
- リストは番号・時刻・source・status badgeで整理する。
- 進捗や数値は斜線/ドットの細いゲージで表す。
- 状態色は小面積に限定する。

### Companion向けの調整

Companionは操作アプリなので、壁紙UIよりもクリック対象をはっきりさせる必要がある。
ただし、見た目は以下の範囲に収める。

- ボタン: 透明または `rgba(255,255,255,0.04-0.08)`、border `rgba(255,255,255,0.14-0.22)`。
- active: 白文字、border alphaを上げる、必要なら内側1px glow。
- destructive/error: 赤全面ではなく、赤いborder/badgeに留める。
- 入力欄: 黒面、白罫線、radius `4-8px`。
- tab: dock buttonやvisibility buttonの語彙を使い、色つきpillにしない。
- card: 個別リスト項目だけに使い、ページ全体をカードだらけにしない。

### 避けたいもの

- 紫/青の大きなグラデーション
- クリーム色、ベージュ、かわいいパステル
- 丸すぎるpillだらけのUI
- 太いborder、強いドロップシャドウ、派手な発光
- カラフルなアイコン群
- 説明文の多いランディングページ風構成

## Companion用デザイントークン案

```css
:root {
  --kw-bg: #101010;
  --kw-bg-elevated: rgba(0, 0, 0, 0.38);
  --kw-bg-subtle: rgba(255, 255, 255, 0.05);
  --kw-line: rgba(255, 255, 255, 0.15);
  --kw-line-soft: rgba(255, 255, 255, 0.10);
  --kw-line-strong: rgba(255, 255, 255, 0.34);
  --kw-text: #ffffff;
  --kw-text-muted: rgba(255, 255, 255, 0.58);
  --kw-text-faint: rgba(255, 255, 255, 0.38);
  --kw-radius-panel: 24px;
  --kw-radius-control: 8px;
  --kw-blur-panel: blur(16px);
  --kw-shadow-panel: 0 12px 40px rgba(0, 0, 0, 0.4);
  --kw-font-main: 'WD-XLLubrifontJPN-Regular', 'Noto Sans JP', sans-serif;
  --kw-font-body: 'Noto Sans JP', 'Zen Kaku Gothic New', sans-serif;
  --kw-track-fill: repeating-linear-gradient(
    -45deg,
    rgba(255, 255, 255, 0.9) 0,
    rgba(255, 255, 255, 0.9) 6px,
    rgba(255, 255, 255, 0.18) 6px,
    rgba(255, 255, 255, 0.18) 11px
  );
}
```

## 実装上の参照元

- `02_ui-overlay/src/components/FloatingPanel.tsx`: panel面の基本値。
- `02_ui-overlay/src/styles/panel.css`: floating panel、personal news、timer、scrollbar。
- `02_ui-overlay/src/styles/weather.css`: weather compact、tone bar、斜線/ドットpattern。
- `02_ui-overlay/src/styles/clock.css`: 時計の巨大発光文字。
- `02_ui-overlay/src/styles/dock.css`: 設定dockとactive表示。
- `02_ui-overlay/src/styles/fonts.css`: メインフォント定義。
- `02_ui-overlay/src/config/layout.ts`: 1920x1200上の配置。
- `02_ui-overlay/src/config/uiSettings.ts`: 各panelのデフォルトサイズ、透明度、表示項目。
- `02_ui-overlay/src/components/panels/shared.tsx`: status badgeの語彙。

## まとめ

このUIの本質は「キャラのかわいさを、UI側が冷静な計器感で支える」こと。
Companionも同じ雰囲気にするなら、かわいい操作アプリではなく、
きりたん壁紙を調律するための小さな放送卓・制御卓として作るのが一番近い。
