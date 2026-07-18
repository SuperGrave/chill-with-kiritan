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

import {
  capFrame,
  computeBeat,
  createTempoTrackerState,
  DEFAULT_TEMPO_CONFIG,
  expireTempoTracking,
  getTempoSnapshot,
  recordTempoBeat,
  WE_FRAME_LENGTH,
} from '../lib/spectrumMath';
import type {
  BeatState,
  TempoSnapshot,
  TempoTrackerConfig,
  TempoTrackerState,
} from '../lib/spectrumMath';

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
  /** Real-time BPM candidate and five-second stable lock state. */
  rhythm: AudioRhythmInfo;
}

export interface AudioRhythmInfo extends TempoSnapshot {
  source: AudioFrameSource;
}

export interface AudioBeatEventDetail {
  energy: number;
  at: number;
  source: AudioFrameSource;
  detectedBpm: number | null;
  lockedBpm: number | null;
}

/** Contract for the later character-motion consumer. No motion is applied here. */
export interface AudioBpmSyncEventDetail {
  bpm: number;
  detectedBpm: number;
  confidence: number;
  stableForMs: number;
  lockedAt: number;
  source: AudioFrameSource;
}

type Subscriber = (info: AudioFrameInfo) => void;

declare global {
  interface Window {
    wallpaperRegisterAudioListener?: (cb: (audioArray: ArrayLike<number>) => void) => void;
  }
  interface WindowEventMap {
    'kiritan:audio-beat': CustomEvent<AudioBeatEventDetail>;
    'kiritan:audio-rhythm': CustomEvent<AudioRhythmInfo>;
    'kiritan:audio-bpm-sync': CustomEvent<AudioBpmSyncEventDetail>;
  }
}

const frame = new Float32Array(WE_FRAME_LENGTH);
const beatState: BeatState = { avg: 0, cooldown: 0 };
let tempoState: TempoTrackerState = createTempoTrackerState();
let tempoConfig: TempoTrackerConfig = { ...DEFAULT_TEMPO_CONFIG };
const subscribers = new Set<Subscriber>();

const initialRhythm: AudioRhythmInfo = {
  ...getTempoSnapshot(tempoState, 0),
  source: 'none',
};

const info: AudioFrameInfo = {
  frame,
  seq: 0,
  at: 0,
  source: 'none',
  bassEnergy: 0,
  rhythm: initialRhythm,
};

let weRegistered = false;
let weFramesSeen = false;
let mockTimer: number | null = null;
let lastRhythmSignature = '';
let lastSyncLockedAt: number | null = null;

function rhythmSignature(rhythm: AudioRhythmInfo): string {
  return [
    rhythm.status,
    rhythm.detectedBpm === null ? '-' : Math.round(rhythm.detectedBpm),
    rhythm.lockedBpm ?? '-',
    Math.round(rhythm.confidence * 20),
    rhythm.source,
  ].join('|');
}

function publishRhythmState(rhythm: AudioRhythmInfo, force = false): void {
  const signature = rhythmSignature(rhythm);
  if (!force && signature === lastRhythmSignature) return;
  lastRhythmSignature = signature;
  window.dispatchEvent(new CustomEvent('kiritan:audio-rhythm', { detail: { ...rhythm } }));
}

function updateRhythm(snapshot: TempoSnapshot, source: AudioFrameSource, force = false): void {
  const rhythm: AudioRhythmInfo = { ...snapshot, source };
  info.rhythm = rhythm;
  publishRhythmState(rhythm, force);

  if (rhythm.lockedBpm !== null && rhythm.lockedAt !== null && rhythm.lockedAt !== lastSyncLockedAt) {
    lastSyncLockedAt = rhythm.lockedAt;
    window.dispatchEvent(
      new CustomEvent('kiritan:audio-bpm-sync', {
        detail: {
          bpm: rhythm.lockedBpm,
          detectedBpm: rhythm.detectedBpm ?? rhythm.lockedBpm,
          confidence: rhythm.confidence,
          stableForMs: rhythm.stableForMs,
          lockedAt: rhythm.lockedAt,
          source,
        },
      }),
    );
  } else if (rhythm.lockedBpm === null) {
    // A future re-lock at the same BPM is still a new handoff session.
    lastSyncLockedAt = null;
  }
}

function resetRhythmForSource(source: AudioFrameSource, at: number): void {
  tempoState = createTempoTrackerState();
  beatState.avg = 0;
  beatState.cooldown = 0;
  lastSyncLockedAt = null;
  updateRhythm(getTempoSnapshot(tempoState, at), source, true);
}

function publishFrame(raw: ArrayLike<number>, source: AudioFrameSource): void {
  const now = performance.now();
  if (info.source !== 'none' && info.source !== source) resetRhythmForSource(source, now);
  capFrame(raw, frame);
  const { bassEnergy, beat } = computeBeat(frame, beatState);
  info.seq += 1;
  info.at = now;
  info.source = source;
  info.bassEnergy = bassEnergy;
  const rhythm = beat
    ? recordTempoBeat(tempoState, now, tempoConfig)
    : expireTempoTracking(tempoState, now, tempoConfig);
  updateRhythm(rhythm, source, beat);
  if (beat) {
    // Fine-grained onset hook. The later motion code may use this only after it
    // has received kiritan:audio-bpm-sync; this module never touches the VRM.
    window.dispatchEvent(
      new CustomEvent('kiritan:audio-beat', {
        detail: {
          energy: bassEnergy,
          at: info.at,
          source,
          detectedBpm: rhythm.detectedBpm,
          lockedBpm: rhythm.lockedBpm,
        },
      }),
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
  const now = performance.now();
  const rhythm = expireTempoTracking(tempoState, now, tempoConfig);
  updateRhythm(rhythm, info.source);
  return info;
}

export function getLatestRhythmInfo(): AudioRhythmInfo {
  return getLatestFrameInfo().rhythm;
}

/** Configure the stability wait while preserving safe tempo bounds. */
export function configureTempoTracking(options: { stableMs?: number }): void {
  if (typeof options.stableMs === 'number' && Number.isFinite(options.stableMs)) {
    tempoConfig = {
      ...tempoConfig,
      stableMs: Math.max(2_000, Math.min(12_000, Math.round(options.stableMs))),
    };
  }
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
let mockStartedAt = 0;

function mockFrame(): void {
  // Derive the phase from the real monotonic clock. Advancing by a fixed 33 ms
  // per callback made the advertised 120 BPM slow down whenever a background
  // browser delivered the timer at less than 30 Hz (for example 71 BPM in QA).
  mockT = Math.max(0, (performance.now() - mockStartedAt) / 1000);
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
  mockStartedAt = performance.now();
  mockT = 0;
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
