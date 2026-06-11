# 外部モーション (.vrma) の配置について  (Motion Probe 0.3)

このディレクトリ (`public/motions/`) に **VRM Animation (`.vrma`)** ファイルを置くと、
Motion Probe 0.3 の「External Motion」レイヤーから読み込めます。

**既定の読み込みパス**: `public/motions/sample_idle.vrma`
（UI の **Load .vrma** ボタン、またはコードの `VRMA_SAMPLE_PATH` を参照）

`.vrma` を置かなくても probe は動作します。その場合はコード生成の
**built-in クリップ**（head / neck / chest / spine をゆっくり動かす「見回し」）が
External Motion のクリップとして使われます。

## 配置手順

1. 任意の `.vrma` を入手（例: VRoid Hub の「VRMアニメーション」や、
   Unity / Blender から書き出した VRMC_vrm_animation 拡張付き glTF）。
2. ファイル名を `sample_idle.vrma` に変更し、本ディレクトリに置く。
3. アプリを起動し、**Load .vrma** を押す → **9: Ext Motion ON** → **P: Play**。

## 重要な仕様（0.3 の方針）

- `.vrma` は @pixiv/three-vrm-animation の `createVRMAnimationClip()` で
  本 VRM 0.x モデルの **正規化ヒューマノイド** にリターゲットされます
  （VRM 0.x ↔ 1.0 の座標差はライブラリ側が吸収）。
- 読み込んだクリップから、本 probe が再生するのは **ボーン回転トラックのみ** です。
  以下は意図的に**破棄**します（ログには件数を出します）:
  - **表情トラック** (`*.weight`): 0.1 の Custom Expression Bridge を優先するため。
  - **hips の位置トラック** (`*.position`): 壁紙用途で原点に留めるため（ルートモーション無効）。
  - **LookAt プロキシ** (`VRMLookAtQuaternionProxy.quaternion`): 視線は本体の VRMLookAt が担当。
- `.vrma` が **腕 (upperArm 等) を動かす**場合、Clip Weight を上げると腕がクリップの
  ポーズへ寄ります。元の `.vrma` が **T ポーズ起点**だと、weight=1 付近で腕が水平に
  開くことがあります（これは破綻ではなく、クリップ内容どおりの挙動）。
  待機時 (Return to Idle) には腕は 0.1 で適用した **下ろしたポーズ**へ戻ります。

## ライセンス

`.vrma` は各配布元の規約に従ってください。本リポジトリには `.vrma` を同梱しません
（ユーザー配置方式）。モデル同様、再配布禁止の素材を含めないでください。
