# TOHOKU WALLPAPER - COMPOSITE GUIDE

This directory contains resources for compositing the UI overlay with the main character background.

## Resolution Setup
- The UI overlay is strictly designed for **1920x1080** (16:9).
- If your 3D/character background is at a different base resolution, please adjust the base canvas size in `src/config/layout.ts` accordingly.

## How to use the Overlay
1. Start the UI project (`npm run dev`) or build it (`npm run build`).
2. The UI background is completely transparent by design.
3. In OBS or compositing software, capture the browser window or use a Browser Source pointing to the local dev server / exported HTML.
4. If you need to align the characters, turn on **Debug Mode** in the UI settings or by editing `src/config/uiSettings.ts` (`debugMode: true`). This will draw safe areas, a center crosshair, and rule-of-thirds lines.

## Generating Guide Images
We recommend taking screenshots of the UI once you are satisfied with the layout:
1. Turn ON debug mode -> save as `overlay-guide.png`
2. Turn OFF debug mode -> save as `overlay-clean.png`

## Layout Configuration
All element positions (Clock, Right Dock, Detail Panel) are explicitly managed in `src/config/layout.ts`. You can fine-tune pixel values without having to touch CSS files directly.
