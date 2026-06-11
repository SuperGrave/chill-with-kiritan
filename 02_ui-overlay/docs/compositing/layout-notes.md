# LAYOUT NOTES

This document describes the intentional positioning of the UI overlay elements for compositing over the "TOHOKU WALLPAPER" character background.

## Global Design
The UI assumes a `1920x1080` screen resolution. The UI root is rendered at exactly this size, and scaled down proportionally if the browser window is smaller. When capturing via OBS or compositing in another app, set the capture resolution to 1920x1080.

## Component Positioning

### Left Clock Widget
- **Anchor:** Top-Left
- **Coordinates:** `x: 48`, `y: 40`
- **Width:** `520px`
- **Intent:** To sit in the upper left corner, providing essential information without obscuring the center of the screen where the character/room will likely be. The text shadow ensures readability against both dark and light backgrounds.

### Right Dock
- **Anchor:** Right-Center
- **Coordinates:** `x: 1770`, `y: 180`
- **Width:** `110px`
- **Intent:** Placed near the right edge to act as a sleek navigation bar. The gap (`16px`) keeps the buttons spread out cleanly.

### Detail Panel
- **Anchor:** Right-aligned (between center and dock)
- **Coordinates:** `x: 1320`, `y: 70`
- **Dimensions:** `420px` wide by `900px` tall
- **Intent:** Slides in or appears next to the dock. It acts as a glass overlay. It does not touch the right edge directly to leave room for the dock.

## Modifying Layout
If the character model covers the clock or panels, you can freely move them by editing `TOHOKU_WALLPAPER_UI_OVERLAY/src/config/layout.ts`. The UI components rely entirely on these injected coordinates, so no CSS digging is required.
