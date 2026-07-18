import {
  computeBeat,
  createTempoTrackerState,
  expireTempoTracking,
  recordTempoBeat,
  type BeatState,
  type TempoSnapshot,
  type TempoTrackerConfig,
  type TempoTrackerState,
  WE_CHANNEL_BUCKETS,
} from './spectrumMath';

export type BpmDetectionMethod = 'consensus' | 'low-band' | 'spectral-flux' | 'autocorrelation';
export type BpmDetectorId = Exclude<BpmDetectionMethod, 'consensus'>;

export const BPM_METHOD_LABELS: Record<BpmDetectionMethod, string> = {
  consensus: '2/3 CONSENSUS',
  'low-band': 'LOW-BAND IOI',
  'spectral-flux': 'SPECTRAL FLUX',
  autocorrelation: 'AUTOCORRELATION',
};

export interface BpmAnalyzerConfig {
  minBpm: number;
  maxBpm: number;
  stableMs: number;
  sampleRate: number;
}

export interface BpmDetectorEstimate extends TempoSnapshot {
  id: BpmDetectionMethod;
  onset: boolean;
  support: number;
  contributors: BpmDetectorId[];
}

export interface BpmAnalysisFrame {
  bassEnergy: number;
  fluxStrength: number;
  estimates: Record<BpmDetectionMethod, BpmDetectorEstimate>;
}

const DEFAULT_CONFIG: BpmAnalyzerConfig = {
  minBpm: 50,
  maxBpm: 220,
  stableMs: 5_000,
  sampleRate: 30,
};

const HISTORY_SECONDS = 12;
const AUTOCORR_MIN_SECONDS = 4;
const FLUX_HISTORY_FRAMES = 48;
const FLUX_REFRACTORY_MS = 180;

function trackerConfig(config: BpmAnalyzerConfig): TempoTrackerConfig {
  return {
    minBpm: config.minBpm,
    maxBpm: config.maxBpm,
    stableMs: config.stableMs,
    staleMs: 3_000,
    toleranceRatio: 0.055,
  };
}

function estimateFromSnapshot(
  id: BpmDetectionMethod,
  snapshot: TempoSnapshot,
  onset = false,
  support = 1,
  contributors: BpmDetectorId[] = id === 'consensus' ? [] : [id],
): BpmDetectorEstimate {
  return { id, ...snapshot, onset, support, contributors };
}

function emptyEstimate(id: BpmDetectionMethod): BpmDetectorEstimate {
  return estimateFromSnapshot(id, {
    status: 'standby',
    detectedBpm: null,
    lockedBpm: null,
    confidence: 0,
    stableForMs: 0,
    lockedAt: null,
    lastBeatAt: null,
  }, false, 0, []);
}

class LowBandDetector {
  private readonly config: BpmAnalyzerConfig;
  private readonly beatState: BeatState = { avg: 0, cooldown: 0 };
  private readonly tempoState: TempoTrackerState = createTempoTrackerState();

  constructor(config: BpmAnalyzerConfig) {
    this.config = config;
  }

  process(frame: ArrayLike<number>, at: number): { estimate: BpmDetectorEstimate; bassEnergy: number } {
    const beat = computeBeat(frame, this.beatState);
    const snapshot = beat.beat
      ? recordTempoBeat(this.tempoState, at, trackerConfig(this.config))
      : expireTempoTracking(this.tempoState, at, trackerConfig(this.config));
    return {
      estimate: estimateFromSnapshot('low-band', snapshot, beat.beat),
      bassEnergy: beat.bassEnergy,
    };
  }

  expire(at: number): BpmDetectorEstimate {
    return estimateFromSnapshot('low-band', expireTempoTracking(this.tempoState, at, trackerConfig(this.config)));
  }
}

class SpectralFluxDetector {
  private readonly config: BpmAnalyzerConfig;
  private readonly previous = new Float32Array(WE_CHANNEL_BUCKETS);
  private readonly history: number[] = [];
  private readonly tempoState: TempoTrackerState = createTempoTrackerState();
  private initialized = false;
  private lastOnsetAt = Number.NEGATIVE_INFINITY;

  constructor(config: BpmAnalyzerConfig) {
    this.config = config;
  }

  process(mono: Float32Array, at: number): { estimate: BpmDetectorEstimate; strength: number; rawFlux: number } {
    let rawFlux = 0;
    if (this.initialized) {
      for (let i = 0; i < mono.length; i++) {
        const delta = mono[i] - this.previous[i];
        if (delta <= 0) continue;
        const weight = i < 8 ? 1.25 : i < 32 ? 1 : 0.72;
        rawFlux += delta * weight;
      }
      rawFlux /= mono.length;
    } else {
      this.initialized = true;
    }
    this.previous.set(mono);

    const baseline = this.history.length
      ? this.history.reduce((sum, value) => sum + value, 0) / this.history.length
      : 0;
    const variance = this.history.length
      ? this.history.reduce((sum, value) => sum + (value - baseline) ** 2, 0) / this.history.length / this.history.length
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
      ? recordTempoBeat(this.tempoState, at, trackerConfig(this.config))
      : expireTempoTracking(this.tempoState, at, trackerConfig(this.config));
    return {
      estimate: estimateFromSnapshot('spectral-flux', snapshot, onset),
      strength,
      rawFlux,
    };
  }

  expire(at: number): BpmDetectorEstimate {
    return estimateFromSnapshot('spectral-flux', expireTempoTracking(this.tempoState, at, trackerConfig(this.config)));
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
  private readonly config: BpmAnalyzerConfig;
  private readonly history: number[] = [];
  private latest = emptyEstimate('autocorrelation');
  private lastCalculatedAt = Number.NEGATIVE_INFINITY;
  private lastOnsetAt: number | null = null;
  private reference: number | null = null;
  private stableSince: number | null = null;
  private lockedBpm: number | null = null;
  private lockedAt: number | null = null;

  constructor(config: BpmAnalyzerConfig) {
    this.config = config;
  }

  private clear(): void {
    this.history.length = 0;
    this.reference = null;
    this.stableSince = null;
    this.lockedBpm = null;
    this.lockedAt = null;
    this.lastOnsetAt = null;
    this.latest = emptyEstimate('autocorrelation');
  }

  process(onsetEnvelope: number, onset: boolean, at: number): BpmDetectorEstimate {
    if (onset) this.lastOnsetAt = at;
    this.history.push(Math.max(0, onsetEnvelope));
    const maxSamples = Math.round(HISTORY_SECONDS * this.config.sampleRate);
    if (this.history.length > maxSamples) this.history.shift();
    return this.calculate(at);
  }

  expire(at: number): BpmDetectorEstimate {
    const bpm = this.reference ?? this.lockedBpm;
    const expectedInterval = bpm ? 60_000 / bpm : 0;
    const timeout = Math.max(3_000, expectedInterval * 4.2);
    if (this.lastOnsetAt !== null && at - this.lastOnsetAt > timeout) this.clear();
    return this.latest;
  }

  private calculate(at: number): BpmDetectorEstimate {
    if (this.history.length < AUTOCORR_MIN_SECONDS * this.config.sampleRate) {
      this.latest = {
        ...this.latest,
        status: this.lastOnsetAt === null ? 'standby' : 'detecting',
        lastBeatAt: this.lastOnsetAt,
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
      const harmonic2 = lag * 2 < centered.length ? Math.max(0, normalizedAutocorrelation(centered, lag * 2)) : 0;
      const harmonic3 = lag * 3 < centered.length ? Math.max(0, normalizedAutocorrelation(centered, lag * 3)) : 0;
      const fasterSubdivision = lag / 2 >= 3 ? Math.max(0, normalizedAutocorrelation(centered, lag / 2)) : 0;
      const fasterThird = lag / 3 >= 3 ? Math.max(0, normalizedAutocorrelation(centered, lag / 3)) : 0;
      const score = fundamental + harmonic2 * 0.48 + harmonic3 * 0.2
        - fasterSubdivision * 0.24 - fasterThird * 0.55;
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
      this.lockedAt = null;
    } else {
      const shifted = this.reference !== null
        && Math.abs(bestBpm - this.reference) / Math.max(1, this.reference) > 0.055;
      if (this.reference === null || shifted) {
        this.reference = bestBpm;
        this.stableSince = at;
        this.lockedBpm = null;
        this.lockedAt = null;
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
        this.lockedAt = at;
      }
    }

    this.latest = estimateFromSnapshot('autocorrelation', {
      status: this.lockedBpm !== null ? 'locked' : this.lastOnsetAt === null ? 'standby' : 'detecting',
      detectedBpm: this.reference,
      lockedBpm: this.lockedBpm,
      confidence,
      stableForMs: this.stableSince === null ? 0 : Math.max(0, at - this.stableSince),
      lockedAt: this.lockedAt,
      lastBeatAt: this.lastOnsetAt,
    });
    return this.latest;
  }
}

export interface ConsensusCandidate {
  bpm: number;
  confidence: number;
  support: number;
  contributors: BpmDetectorId[];
}

export function chooseConsensusCandidate(
  inputs: Array<Pick<BpmDetectorEstimate, 'id' | 'detectedBpm' | 'confidence'>>,
  minBpm: number,
  maxBpm: number,
  previousBpm: number | null = null,
): ConsensusCandidate | null {
  const usable = inputs.filter((input): input is typeof input & { detectedBpm: number; id: BpmDetectorId } =>
    input.id !== 'consensus'
      && input.detectedBpm !== null
      && Number.isFinite(input.detectedBpm)
      && input.confidence >= 0.12,
  );
  if (usable.length < 2) return null;
  const rawSorted = usable.map((input) => input.detectedBpm).sort((a, b) => a - b);
  const rawMedian = rawSorted[Math.floor(rawSorted.length / 2)];
  const hypotheses: number[] = [];
  for (const input of usable) {
    for (const factor of [0.5, 1, 2]) {
      const value = input.detectedBpm * factor;
      if (value >= minBpm && value <= maxBpm) hypotheses.push(value);
    }
  }

  let best: (ConsensusCandidate & { score: number }) | null = null;
  for (const hypothesis of hypotheses) {
    const votes: Array<{ id: BpmDetectorId; bpm: number; confidence: number }> = [];
    for (const input of usable) {
      let nearest = input.detectedBpm;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const factor of [0.5, 1, 2]) {
        const adjusted = input.detectedBpm * factor;
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
  private readonly config: BpmAnalyzerConfig;
  private reference: number | null = null;
  private stableSince: number | null = null;
  private lockedBpm: number | null = null;
  private lockedAt: number | null = null;

  constructor(config: BpmAnalyzerConfig) {
    this.config = config;
  }

  process(inputs: BpmDetectorEstimate[], at: number): BpmDetectorEstimate {
    const candidate = chooseConsensusCandidate(inputs, this.config.minBpm, this.config.maxBpm, this.reference);
    if (candidate === null) {
      this.reference = null;
      this.stableSince = null;
      this.lockedBpm = null;
      this.lockedAt = null;
      const lastBeatAt = inputs.reduce<number | null>((latest, input) =>
        input.lastBeatAt !== null && (latest === null || input.lastBeatAt > latest) ? input.lastBeatAt : latest, null);
      return estimateFromSnapshot('consensus', {
        status: inputs.some((input) => input.detectedBpm !== null) ? 'detecting' : 'standby',
        detectedBpm: null,
        lockedBpm: null,
        confidence: 0,
        stableForMs: 0,
        lockedAt: null,
        lastBeatAt,
      }, inputs.some((input) => input.onset), 0, []);
    }

    const shifted = this.reference !== null
      && Math.abs(candidate.bpm - this.reference) / Math.max(1, this.reference) > 0.045;
    if (this.reference === null || shifted) {
      this.reference = candidate.bpm;
      this.stableSince = at;
      this.lockedBpm = null;
      this.lockedAt = null;
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
      this.lockedAt = at;
    }
    const lastBeatAt = inputs.reduce<number | null>((latest, input) =>
      input.lastBeatAt !== null && (latest === null || input.lastBeatAt > latest) ? input.lastBeatAt : latest, null);
    return estimateFromSnapshot('consensus', {
      status: this.lockedBpm !== null ? 'locked' : 'detecting',
      detectedBpm: this.reference,
      lockedBpm: this.lockedBpm,
      confidence: candidate.confidence,
      stableForMs: this.stableSince === null ? 0 : Math.max(0, at - this.stableSince),
      lockedAt: this.lockedAt,
      lastBeatAt,
    }, inputs.some((input) => input.onset), candidate.support, candidate.contributors);
  }
}

function toMono(frame: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let i = 0; i < WE_CHANNEL_BUCKETS; i++) {
    out[i] = (Math.max(0, Math.min(1, Number(frame[i] ?? 0)))
      + Math.max(0, Math.min(1, Number(frame[i + WE_CHANNEL_BUCKETS] ?? 0)))) * 0.5;
  }
  return out;
}

export class BpmAnalyzer {
  private readonly config: BpmAnalyzerConfig;
  private readonly mono = new Float32Array(WE_CHANNEL_BUCKETS);
  private readonly low: LowBandDetector;
  private readonly flux: SpectralFluxDetector;
  private readonly autocorrelation: AutocorrelationDetector;
  private readonly consensus: ConsensusTracker;
  private latest: BpmAnalysisFrame;

  constructor(config: Partial<BpmAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.low = new LowBandDetector(this.config);
    this.flux = new SpectralFluxDetector(this.config);
    this.autocorrelation = new AutocorrelationDetector(this.config);
    this.consensus = new ConsensusTracker(this.config);
    this.latest = {
      bassEnergy: 0,
      fluxStrength: 0,
      estimates: {
        consensus: emptyEstimate('consensus'),
        'low-band': emptyEstimate('low-band'),
        'spectral-flux': emptyEstimate('spectral-flux'),
        autocorrelation: emptyEstimate('autocorrelation'),
      },
    };
  }

  process(frame: ArrayLike<number>, at: number): BpmAnalysisFrame {
    const low = this.low.process(frame, at);
    const flux = this.flux.process(toMono(frame, this.mono), at);
    const autocorrelation = this.autocorrelation.process(flux.strength, flux.estimate.onset, at);
    const inputs = [low.estimate, flux.estimate, autocorrelation];
    const consensus = this.consensus.process(inputs, at);
    this.latest = {
      bassEnergy: low.bassEnergy,
      fluxStrength: flux.rawFlux,
      estimates: {
        consensus,
        'low-band': low.estimate,
        'spectral-flux': flux.estimate,
        autocorrelation,
      },
    };
    return this.latest;
  }

  expire(at: number): BpmAnalysisFrame {
    const low = this.low.expire(at);
    const flux = this.flux.expire(at);
    const autocorrelation = this.autocorrelation.expire(at);
    const consensus = this.consensus.process([low, flux, autocorrelation], at);
    this.latest = {
      ...this.latest,
      estimates: {
        consensus,
        'low-band': low,
        'spectral-flux': flux,
        autocorrelation,
      },
    };
    return this.latest;
  }

  snapshot(): BpmAnalysisFrame {
    return this.latest;
  }
}

export function isBpmDetectionMethod(value: unknown): value is BpmDetectionMethod {
  return value === 'consensus' || value === 'low-band' || value === 'spectral-flux' || value === 'autocorrelation';
}
