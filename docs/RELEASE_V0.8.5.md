# v0.8.5 Release Notes

v0.8.5はSpotify同期、個人ニュース再生、4K表示、VRM差し替えを中心にした安定化リリースです。

## Changes

- Spotifyの再生情報同期間隔を設定画面から1〜60秒で変更可能にし、既定値を2秒へ短縮。
- 通信失敗・レート制限時にSpotify更新間隔を自動で延ばすバックオフを追加。
- 任意で、現在位置と曲長から終了時刻を予測し、終了約0.8秒後に更新する機能を追加。
- 通常のSpotify自動更新、手動更新、再生操作後更新を直列化し、同時リクエストを抑制。
- 個人ニュースを500ms単位でバックグラウンド進行させ、画面のポーリングが一時的に途切れても再生状態を維持。
- 個人ニュースの再生位置を定期保存し、Companion再起動・原稿再読込後に同じ位置から復旧。
- 個人ニュース原稿を読み込み時に文単位の表示行へ正規化し、Overlayも現在行だけを行番号と同期して表示するよう修正。
- Spotify歌詞が再取得された際に個人ニュースの時間軸まで停止する挙動を廃止し、行/章の移動ボタンと現在のLINE番号表示を追加。
- 表示設定の画面サイズに4K `3840x2160` を追加。
- `STUDIO > 3Dモデル` から任意の `.vrm` を選択し、壁紙側で読み込みを試せるファイル選択UIを追加。
- 選択VRMは `%APPDATA%\tohoku-companion\models` に保存し、localhost経由で壁紙へ配信。公開zipにはVRMを含めない。
- VRM選択の変更時に3Dビューを再初期化し、選択直後に新しいモデルを読み直すよう改善。

## Notes

- VRM 0.x / 1.0の基本読み込みを試しますが、モデル固有のボーン、表情、モーション、小物配置は完全互換を保証しません。
- 公開パッケージは従来どおりVRM/VRMA、Spotify認証情報、個人設定を含みません。

## Public Assets

- `Chill-with-Kiritan-v0.8.5-release.zip`
- `Chill-with-Kiritan-WallpaperEngine-v0.8.5.zip`
- `Tohoku.Companion_0.8.5_x64-setup.exe`
- `tohoku-companion.exe`
- `Chill-with-Kiritan-v0.8.5-source.zip`
