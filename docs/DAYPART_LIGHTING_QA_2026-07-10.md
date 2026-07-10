# 昼夜ライティング 実機目視QA（2026-07-10 / v0.8.3 A10）

完成監査 2026-07-01 §6 の積み残し「昼夜のThree.jsライティング変化の実機目視QA」を実施した記録。
判定: **PASS（調整不要）**。

## 検証方法

- `?daypart=day|night` URLオーバーライドを新規配線（`resolveDaypart()` が最初から持っていた
  override フックを `01_wallpaper/src/App.tsx` に接続。QA・スクリーンショット・「夜の見た目固定」用）。
- devサーバ（`?lab=1`）で `window.__motionLab` の freeze + 明示レンダー + `/__lab/save` により
  昼・夜のキャンバスPNGを同一カメラ（idealプリセット位置）で保存し目視比較。
- Three.js のライト実値は `lab.h.scene.traverse` で読み出し、`scene.json` の定義値×lightScaleと照合。
- CSSフォールバック背景は computed style とクラス適用で確認。

## 結果

### Three.js ライティング（実測。lightScale=2.4、Companion実設定で確認）

| ライト | 昼 | 夜 | scene.json定義との一致 |
|---|---|---|---|
| AmbientLight | 1.92 / #ffffff | 0.84 / #ffffff | ✅ 0.8→0.35 ×2.4 |
| DirectionalLight | 2.40 / #ffffff | 1.08 / **#7f9be0** | ✅ 1.0→0.45 ×2.4、夜色も適用 |

### 目視（キャプチャ: [docs/screenshots/daypart-qa/](screenshots/daypart-qa/)）

- `day_canvas.png`: 白色光で明るく、白い袖・机がニュートラル。
- `night_canvas.png`: 明確に減光し、青みの月光トーン。**暗いがキャラクターの視認性は保たれる**。
- 両者の差は一目で分かる。夜値（ambient 0.35 / main 0.45 / #7f9be0）は調整不要と判断。

### CSSフォールバック背景（背景アート未著作時の昼夜表現）

- `scene-bg--night` クラスが夜に正しく付与され、窓外グラデーションが
  昼（#2a4a6e→#3d6189→#20324a）→ 夜（#050a16→#0b1530→#131b2e）へ切替わることを computed style で確認。

## 付記（バグではない挙動メモ）

1. **ヘッドレス/バックグラウンドタブでは背景レイヤの `scene-bg-fade-in` アニメーションが
   進まず opacity 0 に見える**。`animation: none` を強制すると opacity 1 になることを確認済みで、
   前面ウィンドウ（Wallpaper Engine 実機含む）ではフェードインして表示される。ヘッドレス検証時の既知アーティファクト。
2. **Companion から背景画像を設定している場合、部屋レイヤはその画像を昼夜共通で表示**する
   （フォールバックグラデーションは出ない）。その場合の昼夜の見た目差はライティングのみ。
   実背景アート（room_back/outside/light_overlay、監査MUST#6の残り）を将来入れる場合は
   `background.night.*` に夜画像を指定すれば画像ごと切替わる（ローダ実装済み）。

## 使い方メモ

- 夜の見た目を昼間に確認: `http://localhost:5173/?daypart=night`（本番URLでも有効な表示オーバーライド）
- 自動（ローカル時計 6:00–18:00=昼）に戻す: クエリを外す
