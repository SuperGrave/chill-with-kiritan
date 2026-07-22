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
  DEFAULT_TEMPO_CONFIG,
  WE_FRAME_LENGTH,
} from '../lib/spectrumMath';
import type {
  TempoSnapshot,
} from '../lib/spectrumMath';
import {
  BpmAnalyzer,
} from '../lib/bpmAnalyzer';
import { pushAudioRhythmState } from './companionClient';
import { pcmBeatroot, type BeatrootSnapshot } from './pcmBeatroot';

export type AudioFrameSource = 'wallpaper-engine' | 'mock' | 'none';
export type AudioRhythmSource = AudioFrameSource | 'companion-pcm';
export type AudioBpmMethod = 'pcm-beatroot';

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
  source: AudioRhythmSource;
  method: AudioBpmMethod;
  support: number;
  contributors: string[];
  /** User taste adjustment (whole BPM, clamped ±10) applied to the locked bpm only. */
  bpmOffset: number;
  /** lockedBpm + bpmOffset — the value shown as final and handed to Kiritan. Null until locked. */
  outputBpm: number | null;
}

export interface AudioBeatEventDetail {
  energy: number;
  at: number;
  source: AudioFrameSource;
  detectedBpm: number | null;
  lockedBpm: number | null;
  method: AudioBpmMethod;
}

/** Contract for the later character-motion consumer. No motion is applied here. */
export interface AudioBpmSyncEventDetail {
  /** Final tempo for the character: locked bpm with the user offset applied. */
  bpm: number;
  /** Raw locked bpm before the user offset. */
  rawBpm: number;
  bpmOffset: number;
  detectedBpm: number;
  confidence: number;
  stableForMs: number;
  lockedAt: number;
  source: AudioRhythmSource;
  method: AudioBpmMethod;
  support: number;
  contributors: string[];
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
const selectedMethod: AudioBpmMethod = 'pcm-beatroot';
let stableMs = DEFAULT_TEMPO_CONFIG.stableMs;
let bpmOffset = 0;
const analyzer = new BpmAnalyzer({ stableMs });
const subscribers = new Set<Subscriber>();

export const BPM_OFFSET_RANGE = 10;

function clampBpmOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-BPM_OFFSET_RANGE, Math.min(BPM_OFFSET_RANGE, Math.round(value)));
}

function toOutputBpm(lockedBpm: number | null): number | null {
  if (lockedBpm === null) return null;
  return Math.max(30, Math.round(lockedBpm) + bpmOffset);
}

const initialRhythm: AudioRhythmInfo = {
  status: 'standby',
  detectedBpm: null,
  lockedBpm: null,
  confidence: 0,
  stableForMs: 0,
  lockedAt: null,
  lastBeatAt: null,
  source: 'none',
  method: selectedMethod,
  support: 0,
  contributors: [],
  bpmOffset: 0,
  outputBpm: null,
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
    rhythm.method,
    rhythm.support,
    rhythm.bpmOffset,
  ].join('|');
}

function publishRhythmState(rhythm: AudioRhythmInfo, force = false): void {
  const signature = rhythmSignature(rhythm);
  if (!force && signature === lastRhythmSignature) return;
  lastRhythmSignature = signature;
  window.dispatchEvent(new CustomEvent('kiritan:audio-rhythm', { detail: { ...rhythm } }));
}

function updateRhythm(estimate: BeatrootSnapshot, source: AudioRhythmSource, force = false): void {
  const rhythm: AudioRhythmInfo = {
    status: estimate.status,
    detectedBpm: estimate.detectedBpm,
    lockedBpm: estimate.lockedBpm,
    confidence: estimate.confidence,
    stableForMs: estimate.stableForMs,
    lockedAt: estimate.lockedAt,
    lastBeatAt: null,
    source,
    method: selectedMethod,
    support: estimate.accepted ? 1 : 0,
    contributors: estimate.accepted ? ['pcm-beatroot'] : [],
    bpmOffset,
    outputBpm: toOutputBpm(estimate.lockedBpm),
  };
  info.rhythm = rhythm;
  publishRhythmState(rhythm, force);

  if (rhythm.lockedBpm !== null && rhythm.outputBpm !== null && rhythm.lockedAt !== null && rhythm.lockedAt !== lastSyncLockedAt) {
    lastSyncLockedAt = rhythm.lockedAt;
    window.dispatchEvent(
      new CustomEvent('kiritan:audio-bpm-sync', {
        detail: {
          bpm: rhythm.outputBpm,
          rawBpm: rhythm.lockedBpm,
          bpmOffset,
          detectedBpm: rhythm.detectedBpm ?? rhythm.lockedBpm,
          confidence: rhythm.confidence,
          stableForMs: rhythm.stableForMs,
          lockedAt: rhythm.lockedAt,
          source,
          method: rhythm.method,
          support: rhythm.support,
          contributors: [...rhythm.contributors],
        },
      }),
    );
  } else if (rhythm.lockedBpm === null) {
    // A future re-lock at the same BPM is still a new handoff session.
    lastSyncLockedAt = null;
  }
}

// Live BeatRoot snapshot for the Companion's スペクトラム settings tab. A
// throttled fire-and-forget POST carries the retained/challenger state; the tab
// treats a stale receivedAt as 停止中.
const AUDIO_RHYTHM_POST_MS = 1000;
let lastRhythmPostAt = 0;

function maybePostRhythmState(snapshot: BeatrootSnapshot, now: number): void {
  if (now - lastRhythmPostAt < AUDIO_RHYTHM_POST_MS) return;
  lastRhythmPostAt = now;
  const rhythm = info.rhythm;
  void pushAudioRhythmState({
    source: 'companion-pcm',
    method: selectedMethod,
    stableMs,
    bpmOffset,
    status: rhythm.status,
    detectedBpm: rhythm.detectedBpm,
    lockedBpm: rhythm.lockedBpm,
    outputBpm: rhythm.outputBpm,
    confidence: rhythm.confidence,
    stableForMs: rhythm.stableForMs,
    accepted: snapshot.accepted,
    retainedBpm: snapshot.retainedBpm,
    challengerBpm: snapshot.challengerBpm,
    challengerForMs: snapshot.challengerForMs,
    captureStatus: snapshot.captureStatus,
    resetGeneration: snapshot.resetGeneration,
    resetReason: snapshot.resetReason,
    resetAt: snapshot.resetAt,
    detail: snapshot.detail,
    estimates: [{
      id: 'pcm-beatroot',
      status: snapshot.status,
      detectedBpm: snapshot.detectedBpm,
      lockedBpm: snapshot.lockedBpm,
      retainedBpm: snapshot.retainedBpm,
      confidence: snapshot.confidence,
      accepted: snapshot.accepted,
      stableForMs: snapshot.stableForMs,
      support: snapshot.accepted ? 1 : 0,
      contributors: snapshot.accepted ? ['pcm-beatroot'] : [],
    }],
  });
}

pcmBeatroot.subscribe((snapshot) => {
  const now = performance.now();
  updateRhythm(snapshot, 'companion-pcm', true);
  maybePostRhythmState(snapshot, now);
});

function publishFrame(raw: ArrayLike<number>, source: AudioFrameSource): void {
  const now = performance.now();
  capFrame(raw, frame);
  const analysis = analyzer.process(frame, now);
  const onset = analysis.estimates['spectral-flux'].onset || analysis.estimates['low-band'].onset;
  info.seq += 1;
  info.at = now;
  info.source = source;
  info.bassEnergy = analysis.bassEnergy;
  if (onset) {
    // Fine-grained onset hook. The later motion code may use this only after it
    // has received kiritan:audio-bpm-sync; this module never touches the VRM.
    window.dispatchEvent(
      new CustomEvent('kiritan:audio-beat', {
        detail: {
          energy: Math.max(analysis.bassEnergy, Math.min(1, analysis.fluxStrength * 12)),
          at: info.at,
          source,
          detectedBpm: info.rhythm.detectedBpm,
          lockedBpm: info.rhythm.lockedBpm,
          method: selectedMethod,
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
  analyzer.expire(now);
  const snapshot = pcmBeatroot.getSnapshot();
  if (snapshot.lockedBpm !== info.rhythm.lockedBpm || snapshot.status !== info.rhythm.status) {
    updateRhythm(snapshot, 'companion-pcm');
  }
  return info;
}

export function getLatestRhythmInfo(): AudioRhythmInfo {
  return getLatestFrameInfo().rhythm;
}

/**
 * Configure the stability wait and selected detector. A detector/wait change
 * starts a clean listening session. A bpmOffset change keeps the current lock
 * and simply re-hands the adjusted tempo to Kiritan.
 */
export function configureTempoTracking(options: {
  stableMs?: number;
  bpmOffset?: number;
  confidenceThreshold?: number;
  windowSeconds?: number;
  analysisIntervalSeconds?: number;
  changeConfirmMs?: number;
  periodicResetMinutes?: number;
}): void {
  if (typeof options.stableMs === 'number' && Number.isFinite(options.stableMs)) {
    const nextStableMs = Math.max(3_000, Math.min(12_000, Math.round(options.stableMs)));
    if (nextStableMs !== stableMs) {
      stableMs = nextStableMs;
    }
  }
  let offsetChanged = false;
  if (typeof options.bpmOffset === 'number') {
    const nextOffset = clampBpmOffset(options.bpmOffset);
    if (nextOffset !== bpmOffset) {
      bpmOffset = nextOffset;
      offsetChanged = true;
    }
  }
  pcmBeatroot.configure({
    stableMs,
    confidenceThreshold: options.confidenceThreshold,
    windowSeconds: options.windowSeconds,
    analysisIntervalSeconds: options.analysisIntervalSeconds,
    changeConfirmMs: options.changeConfirmMs,
    periodicResetMinutes: options.periodicResetMinutes,
  });
  if (offsetChanged) {
    // Keep the analyzer (and any active lock); clearing lastSyncLockedAt makes
    // updateRhythm re-dispatch kiritan:audio-bpm-sync with the new output bpm.
    lastSyncLockedAt = null;
    updateRhythm(pcmBeatroot.getSnapshot(), 'companion-pcm', true);
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
