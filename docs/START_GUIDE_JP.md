# Chill with Kiritan 使用開始マニュアル

この文書は、配布パッケージを受け取った人が Windows PC で壁紙として使い始めるための手順です。
まず本システムと Wallpaper Engine を入れ、必要なら Companion と Spotify 連携を設定します。

## 1. 用意するもの

- Windows PC
- Steam アカウント
- Steam 版 Wallpaper Engine
- Chill with Kiritan の配布パッケージ
- 任意: 自分で正規に入手した `.vrm` モデル（きりたん以外も読み込みを試せます）
- 任意: Spotify 連携用の Spotify アカウントと Spotify Developer Dashboard

重要: 共有用パッケージには `models/kiritan.vrm` と `.vrma` は入っていません。対象モデルは再配布禁止のため、壁紙を使う本人が規約に同意して入手し、自分の PC にだけ配置してください。`local-personal` と付いた zip や `LOCAL_PERSONAL_VRM_INCLUDED.txt` が入ったフォルダは、個人利用専用です。再配布しないでください。

## 2. 本システムをダウンロードする

1. ブラウザで配布ページ、GitHub Releases、または共有リンクを開きます。
2. まとめ版がある場合は `Chill-with-Kiritan-vX.X.X-release.zip` をダウンロードします。
3. 分割配布の場合は、次の両方をダウンロードします。
   - `Chill-with-Kiritan-WallpaperEngine-vX.X.X.zip`
   - `Tohoku Companion_*_x64-setup.exe` または companion フォルダ
4. ダウンロードした zip を右クリックし、`すべて展開` で任意の場所へ展開します。例: `ドキュメント\Chill with Kiritan`

Windows SmartScreen が表示された場合は、配布元が信頼できることを確認してから実行してください。このアプリは未署名ビルドの場合があります。

## 3. Steam と Wallpaper Engine を入れる

1. ブラウザで Steam の公式サイトを開き、Steam クライアントをインストールします。
   - https://store.steampowered.com/about/
2. Steam にログインします。
3. Steam ストアで Wallpaper Engine を開き、購入またはインストールします。
   - https://store.steampowered.com/app/431960/Wallpaper_Engine/
4. Steam ライブラリから Wallpaper Engine を起動します。

## 4. VRM モデルを選ぶ

共有用パッケージを使う場合、この手順を行わないとキャラクター本体は表示されません。v0.8.5以降は、Companionのファイル選択から読み込む方法が簡単です。

1. Companionを起動します。
2. `STUDIO（調律）> 3Dモデル` を開きます。
3. `VRMファイル` の選択欄で、自分の `.vrm` を選びます。
4. 選択したファイルは `%APPDATA%\tohoku-companion\models` にローカル保存され、壁紙側で読み込みを試します。

VRM 0.x / 1.0の基本読み込みを試しますが、モデルによってヒューマノイドボーン、表情、モーション、小物位置の互換性は異なります。うまく動かない場合は別のVRMを試すか、`既定モデルに戻す` を押してください。

従来方式を使う場合は、自分で入手したVRMを `kiritan.vrm` にリネームし、展開した壁紙フォルダまたはWallpaper Engineが実際に参照しているフォルダの `models\kiritan.vrm` へコピーします。この既定モデル方式はCompanionが起動していない時にも使えます。

すでに Wallpaper Engine に取り込んだ後で追加する場合は、Wallpaper Engine の対象壁紙を選び、編集画面から `Open in Explorer` または `エクスプローラーで開く` を使って、実際に Wallpaper Engine が参照しているフォルダへ `models\kiritan.vrm` を入れてください。

## 5. Wallpaper Engine に取り込む

1. Wallpaper Engine を開きます。
2. `Create Wallpaper`、`Open from File`、またはローカルファイルから開く操作を選びます。
3. 展開した `Chill with Kiritan` フォルダの `index.html` を選びます。
   - `project.json` を選べる環境では `project.json` でも構いません。
   - うまく取り込めない場合は `index.html` を選んでください。
4. 種類が聞かれた場合は Web wallpaper として取り込みます。
5. Wallpaper Engine 上で壁紙を選択し、デスクトップに適用します。

取り込み時、Wallpaper Engine は元フォルダを自分のプロジェクトフォルダへコピーします。後から VRM を足す場合や更新する場合は、Wallpaper Engine が実際に開いているコピー先フォルダを確認してください。

## 6. Companion を起動する

Companion は、ニュース、天気、メモ、タイマー、Spotify、表示設定を壁紙へ渡すための小型アプリです。壁紙だけでも起動できますが、右側パネルや音楽連携を生かすには Companion を起動します。

1. 展開した配布物の `companion` フォルダを開きます。
2. `Tohoku Companion_*_x64-setup.exe` がある場合はインストールします。
3. インストーラがない場合は `tohoku-companion.exe` を直接起動します。
4. Companion が起動したら、壁紙側の表示が `COMPANION: LIVE` になるか確認します。
   Companion 側では `REMOTE（操作）` の先頭にある `きりたんは今` が `LIVE` になれば、
   壁紙のキャラクター本体（VRM）まで含めて正常に動いています。
5. Windows 起動時にも使う場合は、Companion の `SYSTEM（環境）` で `Windowsを起動したときにCompanionも起動する` を ON にして保存します。

Companion のウィンドウを `×` で閉じるとタスクトレイへ格納されます。完全に終了するには、トレイアイコンを右クリックして `完全終了` を選びます。

Companion のローカル API は `http://127.0.0.1:40313` で動きます。ファイアウォールやセキュリティソフトが確認を出した場合は、ローカル通信を許可してください。

## 7. 表示や地域を調整する

Companion の画面は、左のアイコンレールで4つのセクションに分かれています。

| セクション | できること |
|---|---|
| `REMOTE（操作）` | `きりたんは今`（現在の行動・しぐさ・報告の鮮度）、壁紙パネル8種の表示ON/OFF、タイマー操作、天気・ニュースのいま更新 |
| `CONTENT（中身）` | メモ、リンク集、RSSニュースの閲覧、個人ニュースの選択と再生 |
| `STUDIO（調律）` | 壁紙の見た目調整。きりたん・背景・レイアウト・カメラ・モーション・システムの各項目と、プリセットの保存・適用 |
| `SYSTEM（環境）` | 起動設定、Spotify連携、天気・地域、RSSフィード管理、データ / バックアップ |

1. `SYSTEM（環境）` で地域とニュース RSS を調整します。都道府県プリセットを選ぶだけでも設定できます。
2. 天気は `保存して天気更新`、ニュースは保存後に `REMOTE` の `いま更新` でその場で確認できます。
3. `REMOTE（操作）` と `STUDIO（調律）` から、壁紙上のパネル表示、プリセット、メモ、タイマーなどを操作できます。
4. 背景を変えたい場合は `STUDIO > 背景` で好きな画像・動画を追加できます（スライドショー対応）。
5. 4Kディスプレイでは、`STUDIO` 上部の画面サイズから `3840x2160` を選び、必要に応じてパネル位置を調整してプリセット保存します。
6. 別のキャラクターを試す場合は、`STUDIO > 3Dモデル > VRMファイル` から選びます。

設定、メモ、プリセット、Spotify 認証情報、取得済み歌詞キャッシュは `%APPDATA%\tohoku-companion` に保存されます。配布 zip にはこれらの個人データは含まれません。
設定一式は `SYSTEM > データ / バックアップ` の `書き出し` / `読み込み` でバックアップ・復元できます（APIキー類は既定で含まれません）。

## 8. 任意: Spotify と同期表示する

Spotify 連携を入れると、壁紙の MUSIC / LYRICS パネルに現在再生中の曲、アートワーク、再生位置、歌詞候補が表示されます。再生、一時停止、次へ、前へも Companion 経由で操作できます。

### 8.1 Spotify Developer Dashboard でアプリを作る

1. ブラウザで Spotify Developer Dashboard を開きます。
   - https://developer.spotify.com/dashboard
2. `Create app` から新しいアプリを作ります。
3. Redirect URI に次を追加します。完全一致が必要です。

```text
http://127.0.0.1:40313/spotify/callback
```

4. 作成後、アプリの `Client ID` と `Client Secret` を確認します。

### 8.2 Companion にキーを入れて認証する

1. Companion を起動します。
2. `設定` を開きます。
3. Spotify 欄に `Client ID` を貼り付けます。
4. `Client Secret` にシークレットを貼り付けます。
5. `Spotify認証を開く` を押します。
6. ブラウザで Spotify の許可画面が開いたら、ログインして許可します。
7. `Spotify connected` と表示されたら、そのタブを閉じて Companion に戻ります。
8. `Spotify接続確認` を押します。
9. Spotify 公式アプリまたは Web Player で曲を再生します。
10. 同期間隔はSpotify欄の `再生情報の同期間隔（秒）` で1〜60秒に調整できます。既定は2秒です。
11. 曲切替を早く拾いたい場合は `曲の終了予測から0.8秒後にも更新する` をONにします。通信失敗やSpotify側の制限時は自動的に間隔が延びます。

LRCLIBから一度取得できた同期歌詞・通常歌詞は `%APPDATA%\tohoku-companion\lyrics-cache.json` に最大500曲まで自動保存されます。同じ曲を再生したときは通信を待たずに表示されます。歌詞が見つからなかった結果や通信エラーはキャッシュしないため、後日の再取得を妨げません。

このシステムが要求する Spotify スコープは次の3つです。

```text
user-read-currently-playing user-read-playback-state user-modify-playback-state
```

`Client Secret` と `Refresh Token` は Companion のローカルファイルに保存され、壁紙側へは送信されません。共有用 zip や release フォルダにも含まれません。

## 9. 任意: 個人ニュースを流す

自分で書いたテキスト原稿を、壁紙のニュース欄でゆっくり読み上げ表示できる機能です。

1. エクスプローラーのアドレス欄に `%APPDATA%\tohoku-companion\personal_news_scripts` と入力して開きます（無ければCompanionの次回起動時に作成されます）。初期状態では青空文庫6本、興味別オリジナル8本、日付入りニュース1本の計15候補が入ります。
2. UTF-8 の `.txt` ファイルとして原稿を置きます。通常の本文行は改行や句点で分断せず、一続きの長い電光掲示板として連結されます。次の表示へ切り替えたい場所だけ、独立した行に `[Break]` と書きます。`[Paragraph]`、`[段落]`、`---` も同じ区切りとして使え、`[Topic: 見出し]` は章見出し兼区切りになります。元ファイルは書き換えません。
3. Companion の `CONTENT（中身）> 個人ニュース` で原稿を選び、再生ボタンで開始します。段落送り・章送り・一時停止・リピートも操作でき、現在の `BLOCK` 番号も確認できます。
4. 書き方（章立てやトピック指定）は、同梱の青空文庫サンプル原稿（走れメロスなど）を開くと分かります。

## 10. 更新するとき

1. 新しい配布 zip をダウンロードして展開します。
2. Wallpaper Engine に新しい `index.html` または `project.json` を取り込み直します。
3. 共有用パッケージを使う場合は、更新後の実フォルダにも `models\kiritan.vrm` を入れ直します。
4. Companion は通常、既存の `%APPDATA%\tohoku-companion` を読み続けます。Spotify や表示設定は再入力不要です。

更新作業で自分用の `models\kiritan.vrm` を消さないよう、Wallpaper Engine の実フォルダを上書きする前にモデルファイルを控えておくと安全です。

## 11. 困ったとき

### キャラクターが出ない

- `STUDIO > 3Dモデル` で選択したVRMのパスが表示されているか確認し、別の `.vrm` でも試します。
- 選択モデルから戻す場合は `既定モデルに戻す` を押します。
- Wallpaper Engine が実際に参照しているフォルダに `models\kiritan.vrm` があるか確認します。
- 壁紙のニュースや UI だけは動くのにカメラやキャラ状態が動かない場合も、まず `models\kiritan.vrm` の場所を確認してください。
- Companion の `REMOTE（操作）> きりたんは今` が `未報告` のままなら、壁紙からキャラクターの状態が届いていません。ほとんどの場合 VRM 未配置が原因です。`LIVE` なら本体は動いています。
- Companionのファイル選択方式では元のファイル名のままで構いません。フォルダ配置方式だけ `kiritan.vrm` にします。

### `COMPANION: OFFLINE` のまま

- Companion が起動しているか確認します。
- `tohoku-companion.exe` を再起動します。
- Windows のファイアウォールやセキュリティソフトで `127.0.0.1:40313` のローカル通信が止められていないか確認します。
- Wallpaper Engine 側で壁紙を一度別のものにしてから戻す、または Wallpaper Engine を再起動します。

### Spotify 認証 URL を作れない

- Companion の Spotify 欄で `Client ID` が空になっていないか確認します。
- 入力後に `設定を保存` または `Spotify認証を開く` を押して、保存してから認証します。

### Spotify callback でエラーになる

- Spotify Developer Dashboard の Redirect URI が次と完全一致しているか確認します。

```text
http://127.0.0.1:40313/spotify/callback
```

- `Client Secret` が Companion に保存されているか確認します。
- うまくいかない場合は、`Spotify認証を開く` からもう一度認証します。

### 曲名が出ない、または idle のまま

- Spotify 公式アプリまたは Web Player で一度曲を再生します。
- 再生デバイスがない状態では、Spotify API が現在再生中を返さない場合があります。
- Companion の `Spotify接続確認` を押します。

### 歌詞が出ない

- 歌詞は LRCLIB から候補を取得します。曲によっては歌詞が見つからない場合があります。
- 曲名やアーティスト表記の違いで見つからないこともあります。

## 12. 配布する人向けの注意

- 公開配布する zip には `models/kiritan.vrm` と `.vrma` を入れないでください。
- `local-personal` zip は自分の PC 専用です。共有しないでください。
- Companion の `%APPDATA%\tohoku-companion` には個人データや認証情報が入ります。配布物へ混ぜないでください。
- 配布前に、共有用パッケージと個人用パッケージのファイル名が混ざっていないか確認してください。
- 東北きりたんはキャラクター利用ガイドラインの対象です。利用条件（商用・暴力/性的表現の禁止など）は https://zunko.jp/ を確認してください。

## 参考リンク

- Wallpaper Engine Steam: https://store.steampowered.com/app/431960/Wallpaper_Engine/
- Wallpaper Engine Web wallpaper documentation: https://docs.wallpaperengine.io/en/web/first/gettingstarted.html
- Spotify Developer Dashboard: https://developer.spotify.com/dashboard
- Spotify Redirect URI documentation: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Spotify scopes documentation: https://developer.spotify.com/documentation/web-api/concepts/scopes
