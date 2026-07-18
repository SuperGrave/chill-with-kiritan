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
