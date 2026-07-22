# Mainline Versioning

## Current Mainline

The active development line started at **v0.8.0**. The current mainline build is
**v0.9.2**.

What used to be called `v4` is now treated as `v0.8.0`. Older folders and notes
named `v2` or `v3` remain legacy releases and do not need to be renamed.

Git branch / tag operations are documented in [GIT_TREE_POLICY.md](GIT_TREE_POLICY.md).

## Version Rules

- Use semantic `vX.Y.Z` tags for versioned builds. v0.9.0 begins the next
  feature checkpoint after the v0.8.x release series.
- Keep `main` as the active development branch and leave version checkpoints as
  annotated Git tags, for example `v0.8.0` and `v0.8.1`.
- Keep Companion npm, Tauri, and Cargo versions aligned.
- Companion displays the backend version returned by `/api/health`, which comes
  from `03_companion/src-tauri/Cargo.toml`.
- Generate releases into versioned folders under `release/`, for example:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_release.ps1 -Version 0.9.2
```

## Release Folder Shape

```text
release/
  v0.9.2/
    wallpaper-engine/Chill with Kiritan/
    companion/
    Chill-with-Kiritan-WallpaperEngine-v0.9.2.zip
    Chill-with-Kiritan-v0.9.2-release.zip
    README_RELEASE.md
```

`release/` is local generated output and is not committed. Shareable Wallpaper
Engine zips must not contain `.vrm` or `.vrma` files.
