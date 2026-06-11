# TOHOKU WALLPAPER UI OVERLAY

This project is a dedicated UI overlay intended to be composited over the MMD/VRM character background for the "TOHOKU WALLPAPER" project. 
It provides a minimal, chill, modern, glassmorphism-inspired UI with the specified "WD-XL Lubrifont".

## Setup
1. `npm install`
2. `npm run dev`

## Configuration
- Global Layout: `src/config/layout.ts` - All anchor coordinates for the Clock, Right Dock, and Panels.
- General Settings: `src/config/uiSettings.ts` - Toggles for Debug Mode, seconds display, etc.

## Debug Mode
Set `uiSettings.debugMode = true` to reveal safe areas, UI bounding boxes, and crosshairs to help align the UI precisely with the background character in your compositing tool.
