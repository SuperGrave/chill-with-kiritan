// Rendered height of the dock's six buttons plus container padding at
// gap 0; the dock's full height is DOCK_BASE_HEIGHT + 5 * gap. Used to keep
// the dock (the only entry into Settings) fully inside the canvas.
export const DOCK_BASE_HEIGHT = 380;

export const overlayLayout = {
  canvas: {
    width: 1920,
    height: 1080,
  },
  clock: {
    x: 39,
    y: 39,
    width: 479,
    dateSize: 63,
    timeSize: 105,
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
    height: 600,
  },
  musicPanel: {
    x: 1430,
    y: 685,
    width: 450,
    height: 340,
  },
  aiPanel: {
    x: 985,
    y: 380,
    width: 405,
    height: 645,
  },
  memoPanel: {
    x: 55,
    y: 560,
    width: 450,
    height: 465,
  },
  safeArea: {
    padding: 40,
  }
};
