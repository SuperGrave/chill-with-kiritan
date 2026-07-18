// Wallpaper Engine audio feed — one module-level singleton.
//
// WE calls the registered listener ~30×/s with a 128-float frequency frame
// ([0..63] L, [64..127] R, low→high per channel). Registration must happen
// during initial script execution (the docs warn against window.onload), so
// this module registers as a top-level side effect of being imported — the
// overlay bundle evaluates inside the wallpaper page in production, which is
// exactly the timing WE expects.
//
// Outside Wallpaper Engine (dev server / standalone preview) the API does not
// exist; callers can enable a synthetic music generator instead so the panel
// can be QA'd without WE. The panel decides when to do that (dev only).

import { capFrame, computeBeat, WE_FRAME_LENGTH } from '../lib/spectrumMath';
import type { BeatState } from '../lib/spectrumMath';

export type AudioFrameSource = 'wallpaper-engine' | 'mock' | 'none';

export interface AudioFrameInfo {
  /** Latest capped frame (length 128). Reused buffer — copy if you keep it. */
  frame: Float32Array;
  /** Monotonic count of frames received since page load. */
  seq: number;
  /** Milliseconds timestamp (performance.now()) of the latest frame. */
  at: number;
  source: AudioFrameSource;
  /** Instant bass energy 0..1 of the latest frame. */
  bassEnergy: number;
}

type Subscriber = (info: AudioFrameInfo) => void;

declare global {
  interface Window {
    wallpaperRegisterAudioListener?: (cb: (audioArray: ArrayLike<number>) => void) => void;
  }
}

const frame = new Float32Array(WE_FRAME_LENGTH);
const beatState: BeatState = { avg: 0, cooldown: 0 };
const subscribers = new Set<Subscriber>();

const info: AudioFrameInfo = {
  frame,
  seq: 0,
  at: 0,
  source: 'none',
  bassEnergy: 0,
};

let weRegistered = false;
let weFramesSeen = false;
let mockTimer: number | null = null;

function publishFrame(raw: ArrayLike<number>, source: AudioFrameSource): void {
  capFrame(raw, frame);
  const { bassEnergy, beat } = computeBeat(frame, beatState);
  info.seq += 1;
  info.at = performance.now();
  info.source = source;
  info.bassEnergy = bassEnergy;
  if (beat) {
    // Future Kiritan rhythm hook (plan §9): the wallpaper side can subscribe to
    // this event to nod along. Dispatching is cheap and has no listener today.
    window.dispatchEvent(
      new CustomEvent('kiritan:audio-beat', { detail: { energy: bassEnergy, at: info.at, source } }),
    );
  }
  for (const cb of subscribers) cb(info);
}

// --- Wallpaper Engine registration (top-level side effect) -------------------

if (typeof window !== 'undefined' && typeof window.wallpaperRegisterAudioListener === 'function') {
  window.wallpaperRegisterAudioListener((audioArray) => {
    if (!audioArray || audioArray.length !== WE_FRAME_LENGTH) return;
    weFramesSeen = true;
    // Real WE data always wins over the dev mock.
    if (mockTimer !== null) stopMock();
    publishFrame(audioArray as ArrayLike<number>, 'wallpaper-engine');
  });
  weRegistered = true;
}

/** True when running inside Wallpaper Engine (listener API present). */
export function isWallpaperEngineAudioAvailable(): boolean {
  return weRegistered;
}

/** True once at least one real WE frame has arrived. */
export function hasReceivedWallpaperEngineFrames(): boolean {
  return weFramesSeen;
}

export function getLatestFrameInfo(): AudioFrameInfo {
  return info;
}

export function subscribeAudioFrames(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// --- dev-only synthetic music -----------------------------------------------
// A plausible-looking signal so the panel can be designed and QA'd without WE:
// 120 BPM bass kicks, a wandering mid-band melody, sparkling highs, noise floor.

const MOCK_INTERVAL_MS = 33;
const mockRaw = new Float32Array(WE_FRAME_LENGTH);
let mockT = 0;

function mockFrame(): void {
  mockT += MOCK_INTERVAL_MS / 1000;
  const beatPhase = (mockT * 2) % 1; // 120 BPM
  const kick = Math.max(0, 1 - beatPhase * 5.5); // sharp decay after each beat
  const melody = 8 + Math.round((Math.sin(mockT * 0.7) * 0.5 + 0.5) * 20); // bucket 8..28
  for (let ch = 0; ch < 2; ch++) {
    const base = ch * 64;
    for (let i = 0; i < 64; i++) {
      const noise = Math.random() * 0.04;
      const bass = i < 4 ? kick * (1 - i / 5) * 0.95 : 0;
      const mel =
        Math.max(0, 1 - Math.abs(i - melody) / 3) * (0.35 + 0.25 * Math.sin(mockT * 3.1 + ch));
      const highs = i > 40 ? Math.random() * 0.12 * (0.5 + 0.5 * Math.sin(mockT * 5)) : 0;
      const falloff = 1 - (i / 64) * 0.35;
      mockRaw[base + i] = Math.min(1, (bass + mel + highs + noise) * falloff);
    }
  }
  publishFrame(mockRaw, 'mock');
}

/** Start the synthetic generator (dev preview only; ignored under real WE data). */
export function startMock(): void {
  if (mockTimer !== null || weFramesSeen) return;
  mockTimer = window.setInterval(mockFrame, MOCK_INTERVAL_MS);
}

export function stopMock(): void {
  if (mockTimer === null) return;
  window.clearInterval(mockTimer);
  mockTimer = null;
}

export function isMockRunning(): boolean {
  return mockTimer !== null;
}
