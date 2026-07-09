# Chill with Kiritan v0.8.1

Generated: 2026-07-09

## Changes

- Added an elevated Windows startup registration path. The Settings tab can now
  request UAC and let an elevated Companion process register the Task Scheduler
  logon task.
- Hardened wallpaper-only startup by repairing all-zero camera adjustment and
  identity object/item placement back to the bundled default wallpaper layout.
- Changed the weather poller to retry every minute while the state is still
  `mock`; once live weather is available, it returns to the normal 10-minute
  interval.
- Added an RSS tab to Companion. It shows fetched normal news per configured RSS
  feed, including feed status, item count, and clickable article rows.

## Validation

- `npm run build` passed in `01_wallpaper`, `02_ui-overlay`, and `03_companion`.
- `cargo test` passed in `03_companion/src-tauri`.
- `npm run tauri -- build --bundles nsis` produced
  `Tohoku Companion_0.8.1_x64-setup.exe`.
- `release/v0.8.1` shareable zips were checked for restricted `.vrm` / `.vrma`
  files.
