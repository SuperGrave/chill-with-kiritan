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
  configureTempoTracking,
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
const BPM_STATUS_HEIGHT = 26;

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

  const bpmLockSeconds = Math.max(3, Math.min(12, Number(s.bpmLockSeconds ?? 5)));
  const bpmOffset = Math.max(-10, Math.min(10, Math.round(Number(s.bpmOffset ?? 0) || 0)));
  const bpmConfidenceThreshold = Math.max(0.5, Math.min(0.95, Number(s.bpmConfidenceThreshold ?? 0.7)));
  const bpmAnalysisWindowSeconds = Math.max(8, Math.min(24, Number(s.bpmAnalysisWindowSeconds ?? 14)));
  const bpmAnalysisIntervalSeconds = Math.max(1, Math.min(10, Number(s.bpmAnalysisIntervalSeconds ?? 3)));
  const bpmChangeConfirmSeconds = Math.max(3, Math.min(30, Number(s.bpmChangeConfirmSeconds ?? 9)));
  const bpmPeriodicResetMinutes = Math.max(0, Math.min(120, Number(s.bpmPeriodicResetMinutes ?? 0)));
  React.useEffect(() => {
    configureTempoTracking({
      stableMs: bpmLockSeconds * 1000,
      bpmOffset,
      confidenceThreshold: bpmConfidenceThreshold,
      windowSeconds: bpmAnalysisWindowSeconds,
      analysisIntervalSeconds: bpmAnalysisIntervalSeconds,
      changeConfirmMs: bpmChangeConfirmSeconds * 1000,
      periodicResetMinutes: bpmPeriodicResetMinutes,
    });
  }, [
    bpmLockSeconds,
    bpmOffset,
    bpmConfidenceThreshold,
    bpmAnalysisWindowSeconds,
    bpmAnalysisIntervalSeconds,
    bpmChangeConfirmSeconds,
    bpmPeriodicResetMinutes,
  ]);

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

      const showBpm = cfg.showBpm !== false;
      const statusHeight = showBpm ? Math.min(BPM_STATUS_HEIGHT, Math.max(20, cssH * 0.22)) : 0;
      const graphTop = statusHeight;
      const graphHeight = Math.max(1, cssH - graphTop);
      const gap = Math.max(1, cfg.barGap ?? 4);
      const segments = Math.max(6, Math.min(24, Math.round(cfg.segmentCount ?? 14)));
      const segGap = 2;
      const barW = (cssW - gap * (barCount - 1)) / barCount;
      const segH = Math.max(0.5, (graphHeight - segGap * (segments - 1)) / segments);
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
          const y = graphTop + graphHeight - (sIdx + 1) * segH - sIdx * segGap;
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
            const y = graphTop + graphHeight - (segIdx + 1) * segH - segIdx * segGap;
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
        ctx.fillText(String(cfg.standbyText ?? 'AUDIO STANDBY'), cssW / 2, graphTop + graphHeight / 2);
      }

      if (showBpm) {
        // The first label is the live estimate. It appears before lock so the
        // user can watch detection settle. Only the five-second stable state
        // says KIRITAN SYNC — that is the moment the sync event was handed off.
        ctx.globalAlpha = standby ? 0.62 : 1;
        const rhythm = info.rhythm;
        // Locked → show the final (user-offset) tempo, i.e. what Kiritan received.
        const bpm = rhythm.status === 'locked'
          ? rhythm.outputBpm ?? rhythm.lockedBpm
          : rhythm.lockedBpm ?? rhythm.detectedBpm;
        const lockMs = Math.max(3_000, Math.min(12_000, Number(cfg.bpmLockSeconds ?? 5) * 1000));
        const progress = rhythm.status === 'locked'
          ? 100
          : Math.min(99, Math.round((rhythm.stableForMs / lockMs) * 100));
        const offsetTag = rhythm.status === 'locked' && rhythm.bpmOffset
          ? ` (${rhythm.bpmOffset > 0 ? '+' : ''}${rhythm.bpmOffset})`
          : '';
        const left = bpm === null ? 'BPM ---' : `BPM ${Math.round(bpm)}${offsetTag}`;
        const right = standby
          ? 'WAITING FOR AUDIO'
          : rhythm.status === 'locked'
            ? 'KIRITAN SYNC'
            : rhythm.detectedBpm !== null
              ? `DETECTING ${progress}%`
              : 'LISTENING';
        ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = rhythm.status === 'locked' ? COLOR_PEAK : 'rgba(255, 255, 255, 0.76)';
        ctx.fillText(left, 2, statusHeight / 2 - 1);
        ctx.textAlign = 'right';
        ctx.fillStyle = rhythm.status === 'locked' ? COLOR_PEAK : 'rgba(255, 255, 255, 0.52)';
        ctx.fillText(right, cssW - 2, statusHeight / 2 - 1);
        ctx.globalAlpha = standby ? 0.24 : 0.38;
        ctx.fillStyle = 'rgba(184, 220, 255, 0.8)';
        ctx.fillRect(0, statusHeight - 1, cssW, 1);
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
