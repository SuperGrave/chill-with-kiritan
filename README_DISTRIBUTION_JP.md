# Chill with Kiritan v0.8.4 かんたん導入

## 1. Companionを入れる

`companion/Tohoku Companion_0.8.4_x64-setup.exe` を実行します。起動すると、操作用の小さなウィンドウとローカルAPIが立ち上がります。

## 2. Wallpaper Engineへ入れる

`wallpaper-engine/Chill with Kiritan/project.json` をWallpaper Engineから開きます。先にCompanionを起動しておくと、天気・ニュース・Spotify・メモ・表示設定が連動します。

## 3. きりたんの3Dモデルを置く

公開配布物には、ライセンス上 `kiritan.vrm` を同梱していません。手元のモデルを、Wallpaper Engineへ取り込んだフォルダの次の場所へ自分でコピーしてください。

```text
models/kiritan.vrm
```

モデルを含めたフォルダやzipは再配布しないでください。

## 4. 画面サイズを選ぶ

初回は「1920×1080用サンプル」が適用されています。1920×1200の画面では、Companionの表示設定から「1920×1200用サンプル」を選んでください。

## 5. 個人ニュースを使う

初回起動時に『銀河鉄道の夜』と「本日のニュース」のサンプル2本が `%APPDATA%\tohoku-companion\personal_news_scripts` に作られます。テキストを追加・編集してから「原稿を再読込」で反映できます。

歌詞がない間だけ個人ニュースを出す設定は、ホームの「いま更新」カード下部、または表示設定の「パネル表示」から切り替えられます。

## 困ったとき

- 壁紙がオフライン: Companionが起動しているか確認します。
- きりたんが出ない: 実際に読み込んだ壁紙フォルダに `models/kiritan.vrm` があるか確認します。
- 設定を戻したい: 表示プリセットを適用し直します。
- 詳しい説明: `START_GUIDE_JP.md` を参照します。
