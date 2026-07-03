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
    x: 39,
    y: 39,
    width: 642,
    dateSize: 67,
    timeSize: 107,
  },
  weatherCompact: {
    x: 39,
    y: 226,
    width: 442,
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
    x: 1430,
    y: 55,
    width: 450,
    height: 525,
  },
  musicPanel: {
    x: 1430,
    y: 586,
    width: 450,
    height: 327,
  },
  lyricsPanel: {
    x: 1083,
    y: 919,
    width: 800,
    height: 210,
  },
  aiPanel: {
    x: 1432,
    y: 56,
    width: 448,
    height: 857,
  },
  memoPanel: {
    x: 481,
    y: 918,
    width: 596,
    height: 210,
  },
  safeArea: {
    padding: 40,
  }
};
