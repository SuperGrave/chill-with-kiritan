import {
  computeBeat,
  createTempoTrackerState,
  expireTempoTracking,
  recordTempoBeat,
  type BeatState,
  type TempoSnapshot,
  type TempoTrackerConfig,
  type TempoTrackerState,
} from '../../02_ui-overlay/src/lib/spectrumMath';

export const LAB_BAND_COUNT = 64;
const HISTORY_SECONDS = 12;
const AUTOCORR_MIN_SECONDS = 4;
const FLUX_HISTORY_FRAMES = 48;
const FLUX_REFRACTORY_MS = 180;

export interface LabConfig {
  minBpm: number;
  maxBpm: number;
  stableMs: number;
  sampleRate: number;
}

export interface DetectorEstimate {
  id: 'legacy' | 'flux' | 'autocorr' | 'consensus';
  label: string;
  bpm: number | null;
  lockedBpm: number | null;
  confidence: number;
  status: 'standby' | 'detecting' | 'locked';
  onset: boolean;
  detail: string;
  support?: number;
}

export interface AnalysisFrame {
  at: number;
  legacy: DetectorEstimate;
  flux: DetectorEstimate;
  autocorr: DetectorEstimate;
  consensus: DetectorEstimate;
  bassEnergy: number;
  fluxStrength: number;
}

const DEFAULT_CONFIG: LabConfig = {
  minBpm: 50,
  maxBpm: 220,
  stableMs: 5_000,
  sampleRate: 30,
};

function tempoConfig(config: LabConfig): TempoTrackerConfig {
  return {
    minBpm: config.minBpm,
    maxBpm: config.maxBpm,
    stableMs: config.stableMs,
    staleMs: 3_000,
    toleranceRatio: 0.055,
  };
}

function snapshotEstimate(
  id: DetectorEstimate['id'],
  label: string,
  snapshot: TempoSnapshot,
  onset: boolean,
  detail: string,
): DetectorEstimate {
  return {
    id,
    label,
    bpm: snapshot.detectedBpm,
    lockedBpm: snapshot.lockedBpm,
    confidence: snapshot.confidence,
    status: snapshot.status,
    onset,
    detail,
  };
}

class LegacyBassDetector {
  private beatState: BeatState = { avg: 0, cooldown: 0 };
  private tempoState: TempoTrackerState = createTempoTrackerState();
  private frame = new Float32Array(128);

  constructor(private readonly config: LabConfig) {}

  process(bands: Float32Array, at: number): { estimate: DetectorEstimate; bassEnergy: number } {
    for (let i = 0; i < LAB_BAND_COUNT; i++) {
      const value = Math.max(0, Math.min(1, bands[i] ?? 0));
      this.frame[i] = value;
      this.frame[i + LAB_BAND_COUNT] = value;
    }
    const { bassEnergy, beat } = computeBeat(this.frame, this.beatState);
    const snapshot = beat
      ? recordTempoBeat(this.tempoState, at, tempoConfig(this.config))
      : expireTempoTracking(this.tempoState, at, tempoConfig(this.config));
    return {
      estimate: snapshotEstimate(
        'legacy',
        'LOW-BAND IOI',
        snapshot,
        beat,
        `低域4バケット / energy ${bassEnergy.toFixed(3)}`,
      ),
      bassEnergy,
    };
  }
}

class SpectralFluxDetector {
  private previous = new Float32Array(LAB_BAND_COUNT);
  private initialized = false;
  private history: number[] = [];
  private lastOnsetAt = Number.NEGATIVE_INFINITY;
  private tempoState: TempoTrackerState = createTempoTrackerState();

  constructor(private readonly config: LabConfig) {}

  process(bands: Float32Array, at: number): { estimate: DetectorEstimate; strength: number; rawFlux: number } {
    let rawFlux = 0;
    if (this.initialized) {
      for (let i = 0; i < LAB_BAND_COUNT; i++) {
        const delta = bands[i] - this.previous[i];
        if (delta > 0) {
          // Keep bass relevant, but let snare/vocal/guitar attacks vote too.
          const weight = i < 8 ? 1.25 : i < 32 ? 1 : 0.72;
          rawFlux += delta * weight;
        }
      }
      rawFlux /= LAB_BAND_COUNT;
    } else {
      this.initialized = true;
    }
    this.previous.set(bands);

    const baseline = this.history.length
      ? this.history.reduce((sum, value) => sum + value, 0) / this.history.length
      : 0;
    const variance = this.history.length
      ? this.history.reduce((sum, value) => sum + (value - baseline) ** 2, 0) / this.history.length
        / this.history.length
      : 0;
    const threshold = Math.max(0.0025, baseline + Math.sqrt(variance) * 1.35);
    const strength = Math.max(0, rawFlux - threshold);
    const onset = this.history.length >= 10
      && strength > 0
      && at - this.lastOnsetAt >= FLUX_REFRACTORY_MS;

    this.history.push(rawFlux);
    if (this.history.length > FLUX_HISTORY_FRAMES) this.history.shift();
    if (onset) this.lastOnsetAt = at;

    const snapshot = onset
      ? recordTempoBeat(this.tempoState, at, tempoConfig(this.config))
      : expireTempoTracking(this.tempoState, at, tempoConfig(this.config));
    return {
      estimate: snapshotEstimate(
        'flux',
        'SPECTRAL FLUX',
        snapshot,
        onset,
        `全帯域変化 / flux ${rawFlux.toFixed(4)} / threshold ${threshold.toFixed(4)}`,
      ),
      strength,
      rawFlux,
    };
  }
}

function interpolate(values: number[], index: number): number {
  if (index <= 0) return values[0] ?? 0;
  if (index >= values.length - 1) return values[values.length - 1] ?? 0;
  const left = Math.floor(index);
  const mix = index - left;
  return values[left] * (1 - mix) + values[left + 1] * mix;
}

function normalizedAutocorrelation(values: number[], lag: number): number {
  const start = Math.ceil(lag);
  if (values.length - start < 30) return 0;
  let cross = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = start; i < values.length; i++) {
    const a = values[i];
    const b = interpolate(values, i - lag);
    cross += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  const denominator = Math.sqrt(energyA * energyB);
  return denominator > 1e-9 ? cross / denominator : 0;
}

class AutocorrelationDetector {
  private history: number[] = [];
  private latest: DetectorEstimate = {
    id: 'autocorr',
    label: 'AUTOCORRELATION',
    bpm: null,
    lockedBpm: null,
    confidence: 0,
    status: 'standby',
    onset: false,
    detail: '周期データ待ち',
  };
  private lastCalculatedAt = Number.NEGATIVE_INFINITY;
  private reference: number | null = null;
  private stableSince: number | null = null;
  private lockedBpm: number | null = null;

  constructor(private readonly config: LabConfig) {}

  process(onsetEnvelope: number, at: number): DetectorEstimate {
    this.history.push(Math.max(0, onsetEnvelope));
    const maxSamples = Math.round(HISTORY_SECONDS * this.config.sampleRate);
    if (this.history.length > maxSamples) this.history.shift();
    if (this.history.length < AUTOCORR_MIN_SECONDS * this.config.sampleRate) {
      this.latest = {
        ...this.latest,
        status: this.history.some((value) => value > 0) ? 'detecting' : 'standby',
        detail: `周期窓 ${(this.history.length / this.config.sampleRate).toFixed(1)} / ${AUTOCORR_MIN_SECONDS}s`,
      };
      return this.latest;
    }
    if (at - this.lastCalculatedAt < 220) return this.latest;
    this.lastCalculatedAt = at;

    const mean = this.history.reduce((sum, value) => sum + value, 0) / this.history.length;
    const centered = this.history.map((value) => value - mean);
    let bestBpm: number | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let bpm = this.config.minBpm; bpm <= this.config.maxBpm; bpm += 1) {
      const lag = (this.config.sampleRate * 60) / bpm;
      const fundamental = normalizedAutocorrelation(centered, lag);
      const harmonic2 = lag * 2 < centered.length
        ? Math.max(0, normalizedAutocorrelation(centered, lag * 2))
        : 0;
      const harmonic3 = lag * 3 < centered.length
        ? Math.max(0, normalizedAutocorrelation(centered, lag * 3))
        : 0;
      const fasterSubdivision = lag / 2 >= 3
        ? Math.max(0, normalizedAutocorrelation(centered, lag / 2))
        : 0;
      const fasterThird = lag / 3 >= 3
        ? Math.max(0, normalizedAutocorrelation(centered, lag / 3))
        : 0;
      // A pulse train correlates at 1/2 and 1/3 tempos too. Penalise a slower
      // candidate when an equally periodic faster subdivision exists.
      const score = fundamental
        + harmonic2 * 0.48
        + harmonic3 * 0.2
        - fasterSubdivision * 0.24
        - fasterThird * 0.55;
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }

    const historyStrength = Math.min(1, this.history.length / (this.config.sampleRate * 8));
    const confidence = Math.max(0, Math.min(1, ((bestScore - 0.08) / 1.25) * historyStrength));
    if (bestBpm === null || confidence < 0.12) {
      this.reference = null;
      this.stableSince = null;
      this.lockedBpm = null;
      this.latest = {
        ...this.latest,
        bpm: null,
        lockedBpm: null,
        confidence,
        status: 'detecting',
        detail: `周期相関 score ${bestScore.toFixed(3)}`,
      };
      return this.latest;
    }

    const shifted = this.reference !== null
      && Math.abs(bestBpm - this.reference) / Math.max(1, this.reference) > 0.055;
    if (this.reference === null || shifted) {
      this.reference = bestBpm;
      this.stableSince = at;
      this.lockedBpm = null;
    } else {
      this.reference = this.reference * 0.82 + bestBpm * 0.18;
    }
    if (
      this.lockedBpm === null
      && this.stableSince !== null
      && at - this.stableSince >= this.config.stableMs
      && confidence >= 0.48
    ) {
      this.lockedBpm = Math.round(this.reference);
    }
    this.latest = {
      ...this.latest,
      bpm: this.reference,
      lockedBpm: this.lockedBpm,
      confidence,
      status: this.lockedBpm !== null ? 'locked' : 'detecting',
      detail: `約${(this.history.length / this.config.sampleRate).toFixed(1)}秒自己相関 / score ${bestScore.toFixed(3)}`,
    };
    return this.latest;
  }
}

export interface ConsensusCandidate {
  bpm: number;
  confidence: number;
  support: number;
  contributors: string[];
}

export function chooseConsensusCandidate(
  inputs: Array<Pick<DetectorEstimate, 'id' | 'bpm' | 'confidence'>>,
  minBpm: number,
  maxBpm: number,
  previousBpm: number | null = null,
): ConsensusCandidate | null {
  const usable = inputs.filter((input): input is typeof input & { bpm: number } =>
    input.bpm !== null && Number.isFinite(input.bpm) && input.confidence >= 0.12,
  );
  if (usable.length < 2) return null;
  const rawSorted = usable.map((input) => input.bpm).sort((a, b) => a - b);
  const rawMedian = rawSorted[Math.floor(rawSorted.length / 2)];
  const hypotheses: number[] = [];
  for (const input of usable) {
    for (const factor of [0.5, 1, 2]) {
      const value = input.bpm * factor;
      if (value >= minBpm && value <= maxBpm) hypotheses.push(value);
    }
  }

  let best: (ConsensusCandidate & { score: number }) | null = null;
  for (const hypothesis of hypotheses) {
    const votes: Array<{ id: string; bpm: number; confidence: number }> = [];
    for (const input of usable) {
      let nearest = input.bpm;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const factor of [0.5, 1, 2]) {
        const adjusted = input.bpm * factor;
        if (adjusted < minBpm || adjusted > maxBpm) continue;
        const distance = Math.abs(adjusted - hypothesis) / Math.max(1, hypothesis);
        if (distance < nearestDistance) {
          nearest = adjusted;
          nearestDistance = distance;
        }
      }
      if (nearestDistance <= 0.045) votes.push({ id: input.id, bpm: nearest, confidence: input.confidence });
    }
    if (votes.length < 2) continue;
    const confidenceSum = votes.reduce((sum, vote) => sum + vote.confidence, 0);
    const bpm = votes.reduce((sum, vote) => sum + vote.bpm * vote.confidence, 0) / confidenceSum;
    const continuity = previousBpm === null
      ? 0
      : Math.max(0, 1 - Math.abs(bpm - previousBpm) / Math.max(1, previousBpm)) * 0.35;
    const medianAffinity = Math.max(0, 1 - Math.abs(bpm - rawMedian) / Math.max(1, rawMedian)) * 0.22;
    const commonRange = bpm >= 70 && bpm <= 180 ? 0.08 : 0;
    const score = votes.length * 2 + confidenceSum + continuity + medianAffinity + commonRange;
    if (best === null || score > best.score) {
      best = {
        bpm,
        confidence: Math.min(1, confidenceSum / votes.length),
        support: votes.length,
        contributors: votes.map((vote) => vote.id),
        score,
      };
    }
  }
  if (best === null) return null;
  const { score: _score, ...candidate } = best;
  return candidate;
}

class ConsensusTracker {
  private reference: number | null = null;
  private stableSince: number | null = null;
  private lockedBpm: number | null = null;

  constructor(private readonly config: LabConfig) {}

  process(inputs: DetectorEstimate[], at: number): DetectorEstimate {
    const candidate = chooseConsensusCandidate(inputs, this.config.minBpm, this.config.maxBpm, this.reference);
    if (candidate === null) {
      this.stableSince = null;
      this.lockedBpm = null;
      return {
        id: 'consensus',
        label: '2/3 CONSENSUS',
        bpm: null,
        lockedBpm: null,
        confidence: 0,
        status: inputs.some((input) => input.bpm !== null) ? 'detecting' : 'standby',
        onset: false,
        detail: '2方式以上の一致待ち',
        support: 0,
      };
    }
    const shifted = this.reference !== null
      && Math.abs(candidate.bpm - this.reference) / Math.max(1, this.reference) > 0.045;
    if (this.reference === null || shifted) {
      this.reference = candidate.bpm;
      this.stableSince = at;
      this.lockedBpm = null;
    } else {
      this.reference = this.reference * 0.84 + candidate.bpm * 0.16;
    }
    if (
      this.lockedBpm === null
      && this.stableSince !== null
      && at - this.stableSince >= this.config.stableMs
      && candidate.confidence >= 0.35
    ) {
      this.lockedBpm = Math.round(this.reference);
    }
    return {
      id: 'consensus',
      label: '2/3 CONSENSUS',
      bpm: this.reference,
      lockedBpm: this.lockedBpm,
      confidence: candidate.confidence,
      status: this.lockedBpm !== null ? 'locked' : 'detecting',
      onset: false,
      detail: `${candidate.support}/3一致: ${candidate.contributors.join(' + ')}（倍/半分補正）`,
      support: candidate.support,
    };
  }
}

export class BpmComparisonAnalyzer {
  private readonly config: LabConfig;
  private legacy: LegacyBassDetector;
  private flux: SpectralFluxDetector;
  private autocorr: AutocorrelationDetector;
  private consensus: ConsensusTracker;

  constructor(config: Partial<LabConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.legacy = new LegacyBassDetector(this.config);
    this.flux = new SpectralFluxDetector(this.config);
    this.autocorr = new AutocorrelationDetector(this.config);
    this.consensus = new ConsensusTracker(this.config);
  }

  process(bands: Float32Array, at: number): AnalysisFrame {
    const legacy = this.legacy.process(bands, at);
    const flux = this.flux.process(bands, at);
    // The onset envelope retains amplitude, unlike the binary IOI detector.
    const autocorr = this.autocorr.process(flux.strength, at);
    const consensus = this.consensus.process([legacy.estimate, flux.estimate, autocorr], at);
    return {
      at,
      legacy: legacy.estimate,
      flux: flux.estimate,
      autocorr,
      consensus,
      bassEnergy: legacy.bassEnergy,
      fluxStrength: flux.rawFlux,
    };
  }
}

export function makeSyntheticBands(
  bpm: number,
  elapsedMs: number,
  mode: 'full' | 'bass-light' = 'full',
): Float32Array {
  const bands = new Float32Array(LAB_BAND_COUNT);
  const period = 60_000 / bpm;
  const phase = elapsedMs % period;
  const kick = Math.exp(-phase / 48);
  const body = Math.exp(-phase / 115);
  for (let i = 0; i < LAB_BAND_COUNT; i++) {
    const floor = 0.012 + 0.006 * Math.sin(elapsedMs / 900 + i * 0.41);
    const lowPulse = mode === 'full' && i < 4 ? kick * (0.92 - i * 0.08) : 0;
    const midPulse = i >= 10 && i < 28 ? body * (0.5 - Math.abs(i - 18) * 0.012) : 0;
    const highTick = i >= 34 && i < 48 ? kick * 0.16 : 0;
    bands[i] = Math.max(0, Math.min(1, floor + lowPulse + midPulse + highTick));
  }
  return bands;
}
