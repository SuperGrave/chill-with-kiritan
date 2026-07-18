// Audio spectrum signal processing — pure functions only (no DOM, no THREE),
// so tools/test_audio_bands.mjs can compile this file standalone and assert on
// it the same way test_director.mjs does for the director modules.
//
// Input model: Wallpaper Engine's audio listener array — fixed length 128,
// [0..63] left channel, [64..127] right channel, each channel ordered low→high
// frequency, values ~0..1 with rare spikes above 1.

export const WE_FRAME_LENGTH = 128;
export const WE_CHANNEL_BUCKETS = 64;

/** Clamp one raw WE frame into 0..1 (spikes above 1.0 are documented). */
export function capFrame(raw: ArrayLike<number>, out?: Float32Array): Float32Array {
  const dst = out ?? new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    dst[i] = v > 1 ? 1 : v < 0 ? 0 : v;
  }
  return dst;
}

/** Average the two 64-bucket channels into one mono 64-bucket array. */
export function mixToMono(frame128: ArrayLike<number>, out?: Float32Array): Float32Array {
  const dst = out ?? new Float32Array(WE_CHANNEL_BUCKETS);
  for (let i = 0; i < WE_CHANNEL_BUCKETS; i++) {
    dst[i] = (frame128[i] + frame128[i + WE_CHANNEL_BUCKETS]) / 2;
  }
  return dst;
}

/**
 * Split the 64 mono buckets into `barCount` contiguous bands with a log-like
 * curve: low frequencies get fine resolution (1 bucket per bar), highs get
 * progressively wider groups. Returns per-bar [start, end) bucket ranges that
 * exactly tile 0..64 (every bucket belongs to exactly one bar).
 */
export function buildBandMap(barCount: number): Array<[number, number]> {
  const bars = Math.max(1, Math.min(WE_CHANNEL_BUCKETS, Math.floor(barCount)));
  // Cumulative bucket boundary via a power curve: boundary(i) = 64*(i/bars)^p.
  // p>1 skews resolution toward the low end. p chosen so the first bars map
  // 1:1 to buckets when barCount is around 24.
  const p = Math.log(WE_CHANNEL_BUCKETS) / Math.log(bars) > 1 ? 1.6 : 1.0;
  const bounds: number[] = [0];
  for (let i = 1; i <= bars; i++) {
    const b = Math.round(WE_CHANNEL_BUCKETS * Math.pow(i / bars, p));
    // Boundaries must be strictly increasing so no bar is empty.
    bounds.push(Math.max(b, bounds[i - 1] + 1));
  }
  // Renormalize the tail: the monotonic clamp can overflow past 64 when
  // barCount approaches 64, so walk back from the end.
  bounds[bars] = WE_CHANNEL_BUCKETS;
  for (let i = bars - 1; i >= 1; i--) {
    if (bounds[i] >= bounds[i + 1]) bounds[i] = bounds[i + 1] - 1;
  }
  const map: Array<[number, number]> = [];
  for (let i = 0; i < bars; i++) map.push([bounds[i], bounds[i + 1]]);
  return map;
}

/** Collapse mono buckets into bar levels (max of each band, scaled by sensitivity). */
export function groupBands(
  mono64: ArrayLike<number>,
  map: Array<[number, number]>,
  sensitivity: number,
  out?: Float32Array,
): Float32Array {
  const dst = out ?? new Float32Array(map.length);
  for (let i = 0; i < map.length; i++) {
    const [start, end] = map[i];
    let peak = 0;
    for (let b = start; b < end; b++) {
      const v = mono64[b];
      if (v > peak) peak = v;
    }
    const scaled = peak * sensitivity;
    dst[i] = scaled > 1 ? 1 : scaled;
  }
  return dst;
}

/**
 * Asymmetric smoothing: bars jump up fast (attack) and fall slowly (decay).
 * attack/decay are per-frame lerp factors in 0..1 (1 = instant).
 */
export function smoothBands(
  prev: Float32Array,
  target: ArrayLike<number>,
  attack: number,
  decay: number,
): Float32Array {
  for (let i = 0; i < prev.length; i++) {
    const t = target[i];
    const k = t > prev[i] ? attack : decay;
    prev[i] += (t - prev[i]) * k;
  }
  return prev;
}

/** Peak-hold dots: ride the bar up instantly, fall at fallPerFrame afterwards. */
export function updatePeaks(
  peaks: Float32Array,
  bands: ArrayLike<number>,
  fallPerFrame: number,
): Float32Array {
  for (let i = 0; i < peaks.length; i++) {
    const v = bands[i];
    peaks[i] = v >= peaks[i] ? v : Math.max(v, peaks[i] - fallPerFrame);
  }
  return peaks;
}

// --- beat detection (the future Kiritan rhythm hook) -------------------------

export interface BeatState {
  /** Exponential moving average of bass energy. */
  avg: number;
  /** Frames remaining in the refractory period after an onset. */
  cooldown: number;
}

export interface BeatResult {
  /** Instant bass energy 0..1 (mean of the lowest buckets, both channels). */
  bassEnergy: number;
  /** True on onset frames: bass jumped clearly above its recent average. */
  beat: boolean;
}

export const BEAT_BASS_BUCKETS = 4;
const BEAT_THRESHOLD = 1.4; // onset when energy > avg * threshold
const BEAT_MIN_ENERGY = 0.05; // ignore silence-level flutter
const BEAT_AVG_K = 0.06; // EMA factor (~0.5 s memory at 30 fps)
const BEAT_COOLDOWN_FRAMES = 6; // ≥200 ms between onsets (max ~300 BPM)

export function computeBeat(frame128: ArrayLike<number>, state: BeatState): BeatResult {
  let sum = 0;
  for (let i = 0; i < BEAT_BASS_BUCKETS; i++) {
    sum += Math.min(frame128[i], 1) + Math.min(frame128[i + WE_CHANNEL_BUCKETS], 1);
  }
  const bassEnergy = sum / (BEAT_BASS_BUCKETS * 2);

  let beat = false;
  if (state.cooldown > 0) {
    state.cooldown -= 1;
  } else if (bassEnergy > BEAT_MIN_ENERGY && bassEnergy > state.avg * BEAT_THRESHOLD) {
    beat = true;
    state.cooldown = BEAT_COOLDOWN_FRAMES;
  }
  state.avg += (bassEnergy - state.avg) * BEAT_AVG_K;
  return { bassEnergy, beat };
}

// --- tempo tracking ---------------------------------------------------------
//
// Beat onsets are deliberately kept separate from tempo estimation. A single
// onset is useful for flashing an LED, but handing a tempo to the character
// needs a much higher confidence bar: several consistent inter-beat intervals,
// robust outlier rejection, then a continuous stability window.

export type TempoStatus = 'standby' | 'detecting' | 'locked';

export interface TempoTrackerConfig {
  minBpm: number;
  maxBpm: number;
  stableMs: number;
  staleMs: number;
  toleranceRatio: number;
}

export interface TempoTrackerState {
  beatTimes: number[];
  candidateBpm: number | null;
  referenceBpm: number | null;
  lockedBpm: number | null;
  confidence: number;
  stableSince: number | null;
  lockedAt: number | null;
  lastBeatAt: number | null;
}

export interface TempoSnapshot {
  status: TempoStatus;
  /** Robust real-time estimate, available before the five-second lock. */
  detectedBpm: number | null;
  /** Stable integer tempo safe to hand to a later motion consumer. */
  lockedBpm: number | null;
  confidence: number;
  stableForMs: number;
  lockedAt: number | null;
  lastBeatAt: number | null;
}

export const DEFAULT_TEMPO_CONFIG: TempoTrackerConfig = {
  minBpm: 50,
  maxBpm: 220,
  stableMs: 5_000,
  // The dynamic expiry below also allows four expected beats, which keeps
  // genuinely slow tracks alive while still clearing a stopped feed quickly.
  staleMs: 3_000,
  toleranceRatio: 0.055,
};

const TEMPO_HISTORY_BEATS = 18;
const TEMPO_MIN_INTERVALS = 2;
const TEMPO_STABLE_INTERVALS = 3;

export function createTempoTrackerState(): TempoTrackerState {
  return {
    beatTimes: [],
    candidateBpm: null,
    referenceBpm: null,
    lockedBpm: null,
    confidence: 0,
    stableSince: null,
    lockedAt: null,
    lastBeatAt: null,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clearTempoEstimate(state: TempoTrackerState, keepLastBeat = false): void {
  state.beatTimes.length = 0;
  state.candidateBpm = null;
  state.referenceBpm = null;
  state.lockedBpm = null;
  state.confidence = 0;
  state.stableSince = null;
  state.lockedAt = null;
  if (!keepLastBeat) state.lastBeatAt = null;
}

export function getTempoSnapshot(state: TempoTrackerState, now: number): TempoSnapshot {
  const status: TempoStatus = state.lockedBpm !== null
    ? 'locked'
    : state.lastBeatAt !== null
      ? 'detecting'
      : 'standby';
  return {
    status,
    detectedBpm: state.candidateBpm,
    lockedBpm: state.lockedBpm,
    confidence: state.confidence,
    stableForMs: state.stableSince === null ? 0 : Math.max(0, now - state.stableSince),
    lockedAt: state.lockedAt,
    lastBeatAt: state.lastBeatAt,
  };
}

/**
 * Add one accepted onset timestamp and update the robust BPM estimate.
 * Mutates `state` so callers can keep one allocation-free tracker.
 */
export function recordTempoBeat(
  state: TempoTrackerState,
  at: number,
  config: TempoTrackerConfig = DEFAULT_TEMPO_CONFIG,
): TempoSnapshot {
  const minInterval = 60_000 / config.maxBpm;
  const maxInterval = 60_000 / config.minBpm;
  const previousBeat = state.beatTimes[state.beatTimes.length - 1];
  if (previousBeat !== undefined) {
    const interval = at - previousBeat;
    // A very close duplicate is most likely another low-frequency onset from
    // the same kick. Ignore it instead of corrupting the interval history.
    if (interval < minInterval * 0.8) return getTempoSnapshot(state, at);
    // A long break is a new listening session. It must earn its own five-second
    // lock and must not inherit the previous track's BPM.
    if (interval > maxInterval * 1.35) clearTempoEstimate(state);
  }

  state.beatTimes.push(at);
  if (state.beatTimes.length > TEMPO_HISTORY_BEATS) state.beatTimes.shift();
  state.lastBeatAt = at;

  const intervals: number[] = [];
  for (let i = 1; i < state.beatTimes.length; i++) {
    const interval = state.beatTimes[i] - state.beatTimes[i - 1];
    if (interval >= minInterval && interval <= maxInterval) intervals.push(interval);
  }
  if (intervals.length < TEMPO_MIN_INTERVALS) return getTempoSnapshot(state, at);

  const center = median(intervals);
  const outlierLimit = Math.max(24, center * 0.16);
  const inliers = intervals.filter((interval) => Math.abs(interval - center) <= outlierLimit);
  if (inliers.length < TEMPO_MIN_INTERVALS) return getTempoSnapshot(state, at);

  const robustInterval = median(inliers);
  const detectedBpm = 60_000 / robustInterval;
  const deviations = inliers.map((interval) => Math.abs(interval - robustInterval));
  const relativeJitter = robustInterval > 0 ? median(deviations) / robustInterval : 1;
  const consistency = Math.max(0, 1 - relativeJitter / 0.08);
  const sampleStrength = Math.min(1, inliers.length / 6);
  state.confidence = Math.min(1, sampleStrength * 0.65 + consistency * 0.35);
  state.candidateBpm = detectedBpm;

  const reference = state.referenceBpm;
  const shifted = reference !== null
    && Math.abs(detectedBpm - reference) / Math.max(reference, 1) > config.toleranceRatio;
  if (reference === null || shifted) {
    state.referenceBpm = detectedBpm;
    state.stableSince = inliers.length >= TEMPO_STABLE_INTERVALS ? at : null;
    state.lockedBpm = null;
    state.lockedAt = null;
  } else {
    // Follow small musical/measurement drift without letting display jitter
    // reset the stability clock on every beat.
    state.referenceBpm = reference * 0.82 + detectedBpm * 0.18;
    if (state.stableSince === null && inliers.length >= TEMPO_STABLE_INTERVALS) {
      state.stableSince = at;
    }
  }

  const stableForMs = state.stableSince === null ? 0 : at - state.stableSince;
  if (
    state.lockedBpm === null
    && state.referenceBpm !== null
    && stableForMs >= config.stableMs
    && state.confidence >= 0.65
  ) {
    state.lockedBpm = Math.round(state.referenceBpm);
    state.lockedAt = at;
  }

  return getTempoSnapshot(state, at);
}

/** Clear a stale candidate/lock after playback or the audio feed stops. */
export function expireTempoTracking(
  state: TempoTrackerState,
  now: number,
  config: TempoTrackerConfig = DEFAULT_TEMPO_CONFIG,
): TempoSnapshot {
  if (state.lastBeatAt !== null) {
    const bpm = state.candidateBpm ?? state.lockedBpm;
    const expectedInterval = bpm ? 60_000 / bpm : 0;
    const timeout = Math.max(config.staleMs, expectedInterval * 4.2);
    if (now - state.lastBeatAt > timeout) clearTempoEstimate(state);
  }
  return getTempoSnapshot(state, now);
}
