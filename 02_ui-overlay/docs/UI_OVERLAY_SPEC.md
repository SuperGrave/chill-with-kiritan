# UI OVERLAY SPECIFICATION

## Design Principles
- **Vibe:** Chill with you, modern, minimal, white text.
- **Color Palette:** Pure white for text. Glassmorphism/Transparent black for panels (`rgba(0,0,0,0.4)` with blur).
- **Fonts:** 
  - `WD-XLLubrifontJPN-Regular` for Clock, headers, labels.
  - `Noto Sans JP` (fallback) for detailed text bodies.
- **Resolution:** Base `1920x1080` to match standard 16:9 displays and the 3D character background.

## Architecture
- React frontend (Vite).
- Absolute positioning via `layout.ts` for pixel-perfect compositing.
- The root background is transparent so the HTML canvas can be overlaid onto video/WebGL.

## Adjustment Guide for Compositing
1. Open `src/config/layout.ts`.
2. To move the clock, adjust `overlayLayout.clock.x` and `y`.
3. To move the dock, adjust `overlayLayout.rightDock.x` and `y`.
4. Ensure `uiSettings.debugMode` is temporarily set to `true` to view the bounding boxes against the background.
