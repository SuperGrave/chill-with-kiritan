# POSE ASSET SCHEMA v1 — Pose Composer 0.8

- **Date**: 2026-07-01
- **What**: The on-disk format the Pose Composer reads/writes, and the basis
  conversion between the composer's editing model and the file. master decision
  (audit §A-2 option **a**): **stay on the existing `pose/1` schema** so a saved
  pose plugs straight into a motion's `posture` with no adapter.
- **Related**: [POSE_COMPOSER_0_8_HANDOFF.md](POSE_COMPOSER_0_8_HANDOFF.md) ·
  [POSE_COMPOSER_0_8_AUDIT.md](POSE_COMPOSER_0_8_AUDIT.md) ·
  code: `01_wallpaper/src/lib/lab/poseComposer/{poseMath,poseAssetCodec}.ts`

---

## 1. `pose/1` file format (unchanged — this is the existing schema)

```jsonc
{
  "schema": "pose/1",
  "id": "sample_wave",              // must match the file name <id>.pose.json
  "label": "見本・右手を上げて挨拶",   // optional
  "notes": "…",                      // optional
  "hipsOffset": [0, -0.08, 0],       // optional; hips POSITION offset (m) from rest
  "bones": {                         // T-POSE-ABSOLUTE local euler (radians), XYZ order
    "head": [0.08, 0.2, 0.06],
    "leftUpperArm": [0, 0, 1.2],
    "rightUpperArm": [0, 0, -0.4],
    "rightLowerArm": [0, -1, 0]
  }
}
```

- Location: `public/poses/<id>.pose.json`. Hand assets: `public/poses/hands/<id>.hand.json` (`hand/1`, Stage 6).
- `bones[bone]` is the bone's **absolute local rotation measured from the T-pose
  identity**, as `[x, y, z]` XYZ euler radians — the same convention the Motion
  DSL `posture` layer consumes (`compileClip.composeBoneQuaternion`).
- Validation: reuse `validatePose` (`src/lib/motion/dsl/validate.ts`) — single
  source of truth. Unknown / model-absent bones are reported, never thrown.

## 2. Two bases (the crux)

| basis | where | identity means |
|-------|-------|----------------|
| **reference** | viewer `initialRotations` (arms dropped ±1.2) | bone at the canonical arm-dropped rest |
| **T-pose** | the normalized bone's identity local | bone at raw T-pose (arms out) |

The Pose Composer **edits in the reference basis**: `overrides[bone]` is an
**offset quaternion relative to the reference**. But `pose/1` stores **T-pose
absolute** eulers. The bridge is the bone's final LOCAL quaternion:

```
absoluteLocal = referenceQ · offsetQ           // what actually renders each frame
poseEuler     = eulerXYZ(absoluteLocal)          // SAVE  (reference → T-pose absolute)
offsetQ       = inv(referenceQ) · quat(poseEuler) // LOAD  (T-pose absolute → reference)
```

Implemented in `poseMath.ts` (`poseEulerFromOffset` / `offsetFromPoseEuler`),
THREE-math only, unit-tested in `tools/test_pose_math.mjs` (133 checks incl.
10000× no-drift, exact reset, q≡−q).

## 3. "Changed-bones-only" = changed vs the **T-pose identity**

`encodePose` writes a bone **iff its `absoluteLocal` differs from the T-pose
identity** (not merely iff the master edited it). Consequences:

- An **unedited arm** (referenceQ = ±1.2, offset = identity) → absolute ≠ identity
  → **written** (`leftUpperArm:[0,0,1.2]`). The pose stays **standalone-reproducible**.
- An **unedited identity bone** (spine/neck/…) → absolute = identity → **omitted**.
- This exactly matches the existing files (`stand_relaxed` stores only the
  non-identity arm/shoulder bones).

On **load**, a bone whose saved value equals the reference decodes to an identity
offset and is therefore **not** added as an override (e.g. loading `sample_wave`
yields overrides for `head`/`rightUpperArm`/`rightLowerArm` only — the written
`leftUpperArm:1.2` matches the reference and produces no override). Verified end
to end in `tools/test_pose_codec.mjs` (22 checks) and in-app (author→save→reload
is pixel-identical).

## 4. Round-trip guarantees (tested)

- `offset → save → load → offset` is stable for any reference basis (no drift over 10000×).
- A loaded pose reproduces its saved `absoluteLocal` **regardless of reference**.
- Reset is exact: identity offset ⇄ identity.
- Rounding: eulers are written at 1e-6 precision; `-0` is normalized to `0`.

## 5. Dev write path (dev server only)

`POST /__lab/pose/save { file, json }` (`vite.config.ts`, `apply:'serve'`):
whitelisted to `public/poses/` and `public/poses/hands/`, rejects `..`, matches
`^(hands/)?[\w-]+\.(pose|hand)\.json$`, backs up any existing file into
`.probe_tmp/pose_backups/` before overwriting. Never included in a production build.
Browser Export/Import (Blob / file input) needs no server.

## 6. `q` keyframe track (Stage 5 — NOT YET IMPLEMENTED)

Planned, recorded here for continuity (audit §A-5, HANDOFF §7 Stage 5):
`TrackKey = {t,e,ease} | {t,q,ease}` (exclusive). `q` is a **separate absolute
quaternion track layer** added on top; existing `e` (euler) tracks stay
byte-for-byte compatible and keep their current linear interpolation. Only when a
`q` key is present does that bone's track sample via **slerp**. The compiler emits
a final quaternion track, so downstream is unchanged. This is the Stage 5 design
to confirm in PROGRESS before implementing.
