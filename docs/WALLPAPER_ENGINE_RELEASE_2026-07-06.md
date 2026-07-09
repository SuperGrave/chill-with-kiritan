# Wallpaper Engine Release Notes 2026-07-06

## 目的

この版は制作版を日常利用しやすい形にまとめるための配布準備版。
Wallpaper Engine へ取り込める Web wallpaper package と、別起動の
Tohoku Companion を分けて扱う。

## 生成コマンド

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_release.ps1
```

Wallpaper Engine パッケージだけ作る場合:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_wallpaper_engine.ps1
```

Companion のローカルデータをクリーン化する場合:

```powershell
powershell -ExecutionPolicy Bypass -File tools/reset_companion_clean_state.ps1
```

## 出力

```text
release/
  Chill-with-Kiritan-WallpaperEngine.zip
  wallpaper-engine/Chill with Kiritan/
    index.html
    project.json
    README_WALLPAPER_ENGINE.md
  companion/
    Tohoku Companion_0.1.0_x64-setup.exe
    tohoku-companion.exe
```

`release/` は生成物なので Git 管理しない。

## Wallpaper Engine

`release/wallpaper-engine/Chill with Kiritan/project.json` または
`index.html` を Wallpaper Engine の Web wallpaper として取り込む。

Vite の production build は `base: './'` にしてあり、ローカルHTML取り込みで
`/assets/...` のようなルート絶対パスに依存しない。

## ライセンス制限

`models/kiritan.vrm` と `.vrma` は配布パッケージに入れない。
`npm run build` 後に `scripts/strip-dist-vrm.cjs` が `dist/` から
`.vrm` と `.vrma` を削除し、`scripts/check-dist-assets.cjs` が残留を検査する。

個人利用で自分のPCにだけ入れる場合は、Wallpaper Engine に取り込んだフォルダへ
手元の `kiritan.vrm` を `models/kiritan.vrm` としてコピーする。
`tools/package_wallpaper_engine.ps1 -IncludeLocalVrmForPersonalUse` でもコピーできるが、
その成果物は再配布しない。

`/api/ui` やニュースは更新されるのにカメラ変更と Companion の
`/api/kiritan/state` 報告だけが動かない場合、まず Wallpaper Engine が実際に参照している
フォルダ内の `models/kiritan.vrm` を確認する。VRM が無いとキャラ本体がロードされず、
カメラ適用と state poster の両方が VRM ロード後の処理に入らない。

## クリーンデータ

生成した release folder には、Companion の Spotify 設定、refresh token、
API key、メモ、UI preset、ローカルAPI token を含めない。

制作環境の `%APPDATA%\tohoku-companion` は
`tools/reset_companion_clean_state.ps1` でバックアップ付き初期化できる。
Personal News の原稿フォルダは消さない。

## デフォルト表示

1920x1200 を基準に、右列に NEWS/MUSIC、下段に TIMER/MEMO/LYRICS または
PERSONAL NEWS が並ぶよう初期配置を調整した。初期 `debugMode` は false。
