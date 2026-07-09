# Mainline Versioning

## Current Mainline

The active development line starts at **v0.8.0**.

What used to be called `v4` is now treated as `v0.8.0`. Older folders and notes
named `v2` or `v3` remain legacy releases and do not need to be renamed.

## Version Rules

- Use `v0.8.x` for incremental builds from this tree, for example `v0.8.1`.
- Keep Companion npm, Tauri, and Cargo versions aligned.
- Companion displays the backend version returned by `/api/health`, which comes
  from `03_companion/src-tauri/Cargo.toml`.
- Generate releases into versioned folders under `release/`, for example:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_release.ps1 -Version 0.8.1
```

## Release Folder Shape

```text
release/
  v0.8.0/
    wallpaper-engine/Chill with Kiritan/
    companion/
    Chill-with-Kiritan-WallpaperEngine-v0.8.0.zip
    Chill-with-Kiritan-v0.8.0-release.zip
    README_RELEASE.md
```

`release/` is local generated output and is not committed. Shareable Wallpaper
Engine zips must not contain `.vrm` or `.vrma` files.
