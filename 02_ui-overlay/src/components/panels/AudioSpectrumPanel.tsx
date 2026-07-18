import React from 'react';
import { audioSpectrumPanelDefaults } from '../../config/uiSettings';
import {
  buildBandMap,
  groupBands,
  mixToMono,
  smoothBands,
  updatePeaks,
  WE_CHANNEL_BUCKETS,
} from '../../lib/spectrumMath';
import {
  getLatestFrameInfo,
  isWallpaperEngineAudioAvailable,
  startMock,
  stopMock,
} from '../../services/audioSpectrum';

interface AudioSpectrumPanelProps {
  settings?: any;
  /** Standalone dev preview may animate a synthetic signal; production never does. */
  allowMock?: boolean;
}

// LED graphic-equalizer bars on a canvas. The draw loop runs on rAF and only
// writes to the canvas — React renders just the shell (same decoupling as the
// personal-news ticker). All spectral math lives in lib/spectrumMath.ts.

const ATTACK = 0.55; // per-frame rise lerp — fast but not twitchy
// WE delivers ~30 frames/s; a couple of missed frames means the feed stopped,
// so the bars start decaying right away instead of freezing on the last frame.
const FRAME_STALE_MS = 400;
const STANDBY_AFTER_MS = 2600; // silence/no-feed for this long → standby
const SILENCE_LEVEL = 0.015;

// Overlay LED palette (matches panel.css whites + the supplement blue accent).
const COLOR_LIT = 'rgba(255, 255, 255, 0.92)';
const COLOR_LIT_DIM = 'rgba(255, 255, 255, 0.55)';
const COLOR_UNLIT = 'rgba(255, 255, 255, 0.10)';
const COLOR_PEAK = 'rgba(184, 220, 255, 0.95)';
const HEAT_STOPS: Array<[number, string]> = [
  [0.0, 'rgba(184, 220, 255, 0.9)'],
  [0.55, 'rgba(255, 255, 255, 0.92)'],
  [0.8, 'rgba(255, 214, 170, 0.95)'],
  [1.0, 'rgba(255, 158, 158, 0.95)'],
];

function heatColor(t: number): string {
  for (let i = HEAT_STOPS.length - 1; i >= 0; i--) {
    if (t >= HEAT_STOPS[i][0]) return HEAT_STOPS[i][1];
  }
  return HEAT_STOPS[0][1];
}

const AudioSpectrumPanel: React.FC<AudioSpectrumPanelProps> = ({ settings, allowMock = false }) => {
  const s = { ...audioSpectrumPanelDefaults, ...settings };
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Settings snapshot for the rAF loop (refreshed every React render).
  const cfgRef = React.useRef(s);
  cfgRef.current = s;

  React.useEffect(() => {
    if (allowMock && !isWallpaperEngineAudioAvailable()) startMock();
    return () => stopMock();
  }, [allowMock]);

  React.useEffect(() => {
    let raf = 0;
    // Working buffers, resized when barCount changes.
    let bandMap = buildBandMap(1);
    let mono: Float32Array = new Float32Array(WE_CHANNEL_BUCKETS);
    let target: Float32Array = new Float32Array(0);
    let bands: Float32Array = new Float32Array(0);
    let peaks: Float32Array = new Float32Array(0);
    let lastLoudAt = performance.now();

    const ensureBuffers = (barCount: number) => {
      if (bands.length === barCount) return;
      bandMap = buildBandMap(barCount);
      target = new Float32Array(barCount);
      bands = new Float32Array(barCount);
      peaks = new Float32Array(barCount);
    };

    const draw = () => {
      raf = window.requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const shell = shellRef.current;
      if (!canvas || !shell) return;
      const cfg = cfgRef.current;

      const cssW = shell.clientWidth;
      const cssH = shell.clientHeight;
      if (cssW < 4 || cssH < 4) return;
      const dpr = window.devicePixelRatio || 1;
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const barCount = Math.max(8, Math.min(48, Math.round(cfg.barCount ?? 24)));
      ensureBuffers(barCount);

      const info = getLatestFrameInfo();
      const now = performance.now();
      const fresh = info.seq > 0 && now - info.at < FRAME_STALE_MS;
      if (fresh) {
        mono = mixToMono(info.frame, mono);
        groupBands(mono, bandMap, cfg.sensitivity ?? 1, target);
      } else {
        target.fill(0);
      }
      smoothBands(bands, target, ATTACK, cfg.decaySpeed ?? 0.12);
      if (cfg.peakHold !== false) updatePeaks(peaks, bands, cfg.peakFallSpeed ?? 0.008);

      let loud = false;
      for (let i = 0; i < bands.length; i++) {
        if (bands[i] > SILENCE_LEVEL) { loud = true; break; }
      }
      if (loud && fresh) lastLoudAt = now;
      const standby = now - lastLoudAt > STANDBY_AFTER_MS;

      // --- render ------------------------------------------------------------
      ctx.clearRect(0, 0, pxW, pxH);
      ctx.save();
      ctx.scale(dpr, dpr);
      if (standby) ctx.globalAlpha = 0.35;

      const gap = Math.max(1, cfg.barGap ?? 4);
      const segments = Math.max(6, Math.min(24, Math.round(cfg.segmentCount ?? 14)));
      const segGap = 2;
      const barW = (cssW - gap * (barCount - 1)) / barCount;
      const segH = (cssH - segGap * (segments - 1)) / segments;
      const mirror = cfg.mirror === true;

      for (let i = 0; i < barCount; i++) {
        // Mirror mode folds the spectrum outward from the center: the center
        // bars show bass, edges show treble, symmetric left/right.
        const bandIndex = mirror
          ? Math.min(
              bands.length - 1,
              Math.round(Math.abs(i - (barCount - 1) / 2) * (2 * (bands.length - 1)) / (barCount - 1)),
            )
          : i;
        const level = bands[bandIndex];
        const lit = Math.round(level * segments);
        const x = i * (barW + gap);
        for (let sIdx = 0; sIdx < segments; sIdx++) {
          const y = cssH - (sIdx + 1) * segH - sIdx * segGap;
          const frac = (sIdx + 1) / segments;
          let fill = COLOR_UNLIT;
          if (sIdx < lit) {
            fill = cfg.colorMode === 'heat' ? heatColor(frac) : sIdx === lit - 1 ? COLOR_LIT : COLOR_LIT_DIM;
          }
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, barW, segH);
        }
        if (cfg.peakHold !== false) {
          const peak = peaks[bandIndex];
          if (peak > 0.02) {
            const segIdx = Math.min(segments - 1, Math.round(peak * segments) - 1);
            const y = cssH - (segIdx + 1) * segH - segIdx * segGap;
            ctx.fillStyle = COLOR_PEAK;
            ctx.fillRect(x, y, barW, Math.max(2, segH * 0.35));
          }
        }
      }

      if (standby) {
        ctx.globalAlpha = 0.8;
        ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillText(String(cfg.standbyText ?? 'AUDIO STANDBY'), cssW / 2, cssH / 2);
      }
      ctx.restore();
    };

    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={shellRef} className="audio-spectrum-panel">
      <canvas ref={canvasRef} className="audio-spectrum-canvas" />
    </div>
  );
};

export default AudioSpectrumPanel;
