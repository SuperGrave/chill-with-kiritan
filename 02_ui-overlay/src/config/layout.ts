// Rendered height of the dock's single settings button plus container padding at
// gap 0; the dock's full height is DOCK_BASE_HEIGHT + DOCK_GAP_COUNT * gap. Used to keep
// the dock (the only entry into Settings) fully inside the canvas.
export const DOCK_BASE_HEIGHT = 82;
export const DOCK_GAP_COUNT = 0;

export const overlayLayout = {
  canvas: {
    width: 1920,
    height: 1200,
  },
  clock: {
    x: 0,
    y: 0,
    width: 642,
    dateSize: 76,
    timeSize: 129,
  },
  weatherCompact: {
    x: 16,
    y: 216,
    width: 531,
    fontSize: 24,
    barHeight: 22,
    rowGap: 10,
  },
  rightDock: {
    x: 1789,
    y: 100,
    width: 110,
    gap: 16,
  },
  detailPanel: {
    x: 1320,
    y: 70,
    width: 420,
    height: 900,
  },
  // Standalone element panels — each freely positioned like the clock/weather.
  // Default positions spread across the right/center so they don't overlap on
  // first run; users drag them anywhere via the Settings sliders.
  newsPanel: {
    x: 1396,
    y: 6,
    width: 520,
    height: 600,
  },
  musicPanel: {
    x: 1396,
    y: 611,
    width: 520,
    height: 305,
  },
  lyricsPanel: {
    x: 1020,
    y: 921,
    width: 896,
    height: 225,
  },
  personalNewsPanel: {
    x: 1020,
    y: 921,
    width: 896,
    height: 225,
  },
  memoPanel: {
    x: 514,
    y: 921,
    width: 500,
    height: 225,
  },
  audioSpectrumPanel: {
    x: 8,
    y: 696,
    width: 500,
    height: 200,
  },
  timerPanel: {
    x: 8,
    y: 921,
    width: 500,
    height: 225,
  },
  safeArea: {
    padding: 40,
  }
};
