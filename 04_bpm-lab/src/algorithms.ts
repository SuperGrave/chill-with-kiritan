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

export type DetectorId =
  | 'legacy'
  | 'flux'
  | 'superflux'
  | 'autocorr'
  | 'comb'
  | 'dp'
  | 'pcm-realtime'
  | 'pcm-beatroot'
  | 'pulse'
  | 'consensus';

export const DETECTOR_DEFINITIONS: ReadonlyArray<{
  id: DetectorId;
  label: string;
  shortLabel: string;
  subtitle: string;
  family: 'baseline' | 'candidate' | 'combined';
}> = [
  { id: 'legacy', label: 'LOW-BAND IOI', shortLabel: 'LOW', subtitle: '現行方式 / 低域4バケット', family: 'baseline' },
  { id: 'flux', label: 'SPECTRAL FLUX', shortLabel: 'FLUX', subtitle: '全帯域差分 / 現行候補', family: 'baseline' },
  { id: 'superflux', label: 'SUPERFLUX-LITE', shortLabel: 'SFLUX', subtitle: '対数圧縮＋周波数最大値＋適応閾値', family: 'candidate' },
  { id: 'autocorr', label: 'AUTOCORRELATION', shortLabel: 'AUTO', subtitle: 'オンセット包絡の周期相関', family: 'baseline' },
  { id: 'comb', label: 'MULTIBAND COMB', shortLabel: 'COMB', subtitle: '低・中・高域の共鳴テンポバンク', family: 'candidate' },
  { id: 'dp', label: 'DYNAMIC PULSE', shortLabel: 'DP', subtitle: '拍位置列の大域スコア', family: 'candidate' },
  { id: 'pcm-realtime', label: 'PCM REALTIME', shortLabel: 'PCM-RT', subtitle: 'AudioWorklet / 低域ピーク間隔', family: 'candidate' },
  { id: 'pcm-beatroot', label: 'PCM BEATROOT', shortLabel: 'BEATROOT', subtitle: '生波形FFT＋拍仮説エージェント', family: 'candidate' },
  { id: 'pulse', label: 'STATE PULSE BANK', shortLabel: 'STATE', subtitle: '連続性を優先する状態遷移追跡', family: 'combined' },
  { id: 'consensus', label: '5-WAY CONSENSUS', shortLabel: 'VOTE', subtitle: '独立候補5方式の倍・半分補正合議', family: 'combined' },
];

export const DETECTOR_IDS = DETECTOR_DEFINITIONS.map((definition) => definition.id);

export interface DetectorEstimate {
  id: DetectorId;
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
  estimates: Record<DetectorId, DetectorEstimate>;
  legacy: DetectorEstimate;
  flux: DetectorEstimate;
  superflux: DetectorEstimate;
  autocorr: DetectorEstimate;
  comb: DetectorEstimate;
  dp: DetectorEstimate;
  pcmRealtime: DetectorEstimate;
  pcmBeatroot: DetectorEstimate;
  pulse: DetectorEstimate;
  consensus: DetectorEstimate;
  bassEnergy: number;
  fluxStrength: number;
  superFluxStrength: number;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

class StableEstimateTracker {
  private reference: number | null = null;
  private stableSince: number | null = null;
  private lockedBpm: number | null = null;

  constructor(
    private readonly config: LabConfig,
    private readonly toleranceRatio = 0.045,
    private readonly lockConfidence = 0.34,
  ) {}

  update(
    id: DetectorId,
    label: string,
    bpm: number | null,
    confidence: number,
    at: number,
    detail: string,
    onset = false,
    support?: number,
  ): DetectorEstimate {
    if (bpm === null || !Number.isFinite(bpm) || confidence < 0.1) {
      this.stableSince = null;
      this.lockedBpm = null;
      return {
        id, label, bpm: null, lockedBpm: null, confidence: clamp01(confidence),
        status: confidence > 0 ? 'detecting' : 'standby', onset, detail, support,
      };
    }
    const shifted = this.reference !== null
      && Math.abs(bpm - this.reference) / Math.max(1, this.reference) > this.toleranceRatio;
    if (this.reference === null || shifted) {
      this.reference = bpm;
      this.stableSince = at;
      this.lockedBpm = null;
    } else {
      this.reference = this.reference * 0.84 + bpm * 0.16;
    }
    if (
      this.lockedBpm === null
      && this.stableSince !== null
      && at - this.stableSince >= this.config.stableMs
      && confidence >= this.lockConfidence
    ) {
      this.lockedBpm = Math.round(this.reference);
    }
    return {
      id,
      label,
      bpm: this.reference,
      lockedBpm: this.lockedBpm,
      confidence: clamp01(confidence),
      status: this.lockedBpm !== null ? 'locked' : 'detecting',
      onset,
      detail,
      support,
    };
  }

  currentBpm(): number | null {
    return this.reference;
  }
}

class UniformHistory {
  readonly values: number[] = [];
  private previousAt: number | null = null;
  private previousValue = 0;
  private nextAt: number | null = null;

  constructor(private readonly sampleRate: number, private readonly seconds: number) {}

  push(value: number, at: number): void {
    const safe = Math.max(0, value);
    if (this.previousAt === null || this.nextAt === null || at <= this.previousAt) {
      this.previousAt = at;
      this.previousValue = safe;
      this.nextAt = at;
      this.values.push(safe);
      return;
    }
    const step = 1000 / this.sampleRate;
    while (this.nextAt + step <= at) {
      this.nextAt += step;
      const mix = clamp01((this.nextAt - this.previousAt) / Math.max(1, at - this.previousAt));
      this.values.push(this.previousValue * (1 - mix) + safe * mix);
    }
    const limit = Math.round(this.seconds * this.sampleRate);
    if (this.values.length > limit) this.values.splice(0, this.values.length - limit);
    this.previousAt = at;
    this.previousValue = safe;
  }
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

interface SuperFluxFrame {
  estimate: DetectorEstimate;
  strength: number;
  bandStrengths: [number, number, number];
}

class SuperFluxDetector {
  private previous = new Float32Array(LAB_BAND_COUNT);
  private initialized = false;
  private noveltyHistory: number[] = [];
  private lastOnsetAt = Number.NEGATIVE_INFINITY;
  private tempoState: TempoTrackerState = createTempoTrackerState();

  constructor(private readonly config: LabConfig) {}

  process(bands: Float32Array, at: number): SuperFluxFrame {
    const current = new Float32Array(LAB_BAND_COUNT);
    for (let index = 0; index < LAB_BAND_COUNT; index++) {
      current[index] = Math.log1p(Math.max(0, bands[index]) * 12);
    }
    const perBand: [number, number, number] = [0, 0, 0];
    let raw = 0;
    if (this.initialized) {
      for (let index = 0; index < LAB_BAND_COUNT; index++) {
        let previousMax = this.previous[index];
        for (let neighbor = Math.max(0, index - 2); neighbor <= Math.min(LAB_BAND_COUNT - 1, index + 2); neighbor++) {
          previousMax = Math.max(previousMax, this.previous[neighbor]);
        }
        const delta = Math.max(0, current[index] - previousMax);
        raw += delta;
        perBand[index < 10 ? 0 : index < 34 ? 1 : 2] += delta;
      }
      raw /= LAB_BAND_COUNT;
      perBand[0] /= 10;
      perBand[1] /= 24;
      perBand[2] /= 30;
    } else {
      this.initialized = true;
    }
    this.previous = current;

    const window = this.noveltyHistory.slice(-45);
    const center = median(window);
    const deviation = median(window.map((value) => Math.abs(value - center)));
    const threshold = Math.max(0.003, center + deviation * 2.8);
    const strength = Math.max(0, raw - threshold);
    const onset = window.length >= 10 && raw > threshold && at - this.lastOnsetAt >= 170;
    this.noveltyHistory.push(raw);
    if (this.noveltyHistory.length > 90) this.noveltyHistory.shift();
    if (onset) this.lastOnsetAt = at;

    const snapshot = onset
      ? recordTempoBeat(this.tempoState, at, tempoConfig(this.config))
      : expireTempoTracking(this.tempoState, at, tempoConfig(this.config));
    return {
      estimate: snapshotEstimate(
        'superflux',
        'SUPERFLUX-LITE',
        snapshot,
        onset,
        `log差分＋最大値フィルタ / novelty ${raw.toFixed(4)} / 閾値 ${threshold.toFixed(4)}`,
      ),
      strength,
      bandStrengths: perBand.map((value) => Math.max(0, value - threshold * 0.55)) as [number, number, number],
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
    const candidateScores: Array<{ bpm: number; score: number }> = [];
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
      candidateScores.push({ bpm, score });
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }
    if (bestBpm !== null) {
      const baseBpm = bestBpm;
      const fastHarmonic = candidateScores
        .filter((entry) => entry.bpm > baseBpm * 1.85 && entry.bpm < baseBpm * 3.15 && entry.score >= bestScore * 0.68)
        .sort((a, b) => b.bpm - a.bpm)[0];
      if (fastHarmonic !== undefined) {
        bestBpm = fastHarmonic.bpm;
        bestScore = fastHarmonic.score;
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

function centered(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return values.map((value) => value - mean);
}

function periodicScore(values: number[], lag: number): number {
  const fundamental = Math.max(0, normalizedAutocorrelation(values, lag));
  const slower = lag * 2 < values.length ? Math.max(0, normalizedAutocorrelation(values, lag * 2)) : 0;
  const slower3 = lag * 3 < values.length ? Math.max(0, normalizedAutocorrelation(values, lag * 3)) : 0;
  const subdivision = lag / 2 >= 3 ? Math.max(0, normalizedAutocorrelation(values, lag / 2)) : 0;
  return fundamental + slower * 0.46 + slower3 * 0.16 - subdivision * 0.28;
}

function bestAndRunnerUp(scores: Array<{ bpm: number; score: number }>): {
  bpm: number | null;
  score: number;
  runnerUp: number;
} {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const rawBest = sorted[0];
  if (rawBest === undefined) return { bpm: null, score: 0, runnerUp: 0 };
  const fastHarmonic = sorted
    .filter((entry) => entry.bpm > rawBest.bpm * 1.85 && entry.bpm < rawBest.bpm * 3.15 && entry.score >= rawBest.score * 0.68)
    .sort((a, b) => b.bpm - a.bpm)[0];
  const best = fastHarmonic ?? rawBest;
  const runner = sorted.find((entry) => Math.abs(entry.bpm - best.bpm) > 4);
  return { bpm: best.bpm, score: best.score, runnerUp: runner?.score ?? 0 };
}

class MultiBandCombDetector {
  private histories: [UniformHistory, UniformHistory, UniformHistory];
  private tracker: StableEstimateTracker;
  private latest: DetectorEstimate;
  private lastCalculatedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: LabConfig) {
    this.histories = [0, 1, 2].map(() => new UniformHistory(config.sampleRate, HISTORY_SECONDS)) as typeof this.histories;
    this.tracker = new StableEstimateTracker(config);
    this.latest = this.tracker.update('comb', 'MULTIBAND COMB', null, 0, 0, '周期データ待ち');
  }

  process(strengths: [number, number, number], at: number): DetectorEstimate {
    strengths.forEach((value, index) => this.histories[index].push(value, at));
    const length = this.histories[0].values.length;
    if (length < this.config.sampleRate * AUTOCORR_MIN_SECONDS) {
      this.latest = {
        ...this.latest,
        status: strengths.some((value) => value > 0) ? 'detecting' : 'standby',
        detail: `3帯域テンポ窓 ${(length / this.config.sampleRate).toFixed(1)} / ${AUTOCORR_MIN_SECONDS}s`,
      };
      return this.latest;
    }
    if (at - this.lastCalculatedAt < 260) return this.latest;
    this.lastCalculatedAt = at;
    const envelopes = this.histories.map((history) => centered(history.values));
    const scores: Array<{ bpm: number; score: number }> = [];
    for (let bpm = this.config.minBpm; bpm <= this.config.maxBpm; bpm++) {
      const lag = this.config.sampleRate * 60 / bpm;
      const score = envelopes.reduce((sum, envelope, index) =>
        sum + periodicScore(envelope, lag) * ([0.38, 0.37, 0.25][index] ?? 0), 0);
      scores.push({ bpm, score });
    }
    const best = bestAndRunnerUp(scores);
    const historyWeight = Math.min(1, length / (this.config.sampleRate * 8));
    const separation = Math.max(0, best.score - best.runnerUp);
    const confidence = clamp01((best.score - 0.08) / 1.25 * historyWeight * (0.72 + separation * 0.7));
    this.latest = this.tracker.update(
      'comb', 'MULTIBAND COMB', confidence >= 0.1 ? best.bpm : null, confidence, at,
      `低中高3帯域 / score ${best.score.toFixed(3)} / 差 ${separation.toFixed(3)}`,
    );
    return this.latest;
  }
}

function pulsePhaseScore(values: number[], lag: number): number {
  if (values.length < 90 || lag < 3) return 0;
  const peak = Math.max(...values);
  if (peak <= 1e-8) return 0;
  let best = 0;
  const phaseSteps = Math.max(4, Math.round(lag * 2));
  for (let step = 0; step < phaseSteps; step++) {
    const phase = step / phaseSteps * lag;
    let sum = 0;
    let count = 0;
    for (let index = values.length - 1 - phase; index >= 0; index -= lag) {
      const sample = interpolate(values, index);
      const left = interpolate(values, index - 1);
      const right = interpolate(values, index + 1);
      sum += Math.max(sample, left * 0.72, right * 0.72);
      count++;
    }
    if (count >= 4) best = Math.max(best, sum / count / peak);
  }
  const centeredValues = centered(values);
  const subdivision = lag / 2 >= 3 ? Math.max(0, normalizedAutocorrelation(centeredValues, lag / 2)) : 0;
  return best - subdivision * 0.18;
}

class DynamicPulseDetector {
  private history: UniformHistory;
  private tracker: StableEstimateTracker;
  private latest: DetectorEstimate;
  private lastCalculatedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: LabConfig) {
    this.history = new UniformHistory(config.sampleRate, HISTORY_SECONDS);
    this.tracker = new StableEstimateTracker(config);
    this.latest = this.tracker.update('dp', 'DYNAMIC PULSE', null, 0, 0, '拍位置データ待ち');
  }

  process(strength: number, at: number): DetectorEstimate {
    this.history.push(strength, at);
    const length = this.history.values.length;
    if (length < this.config.sampleRate * AUTOCORR_MIN_SECONDS) {
      this.latest = {
        ...this.latest,
        status: strength > 0 ? 'detecting' : 'standby',
        detail: `拍位置窓 ${(length / this.config.sampleRate).toFixed(1)} / ${AUTOCORR_MIN_SECONDS}s`,
      };
      return this.latest;
    }
    if (at - this.lastCalculatedAt < 320) return this.latest;
    this.lastCalculatedAt = at;
    const scores: Array<{ bpm: number; score: number }> = [];
    for (let bpm = this.config.minBpm; bpm <= this.config.maxBpm; bpm++) {
      scores.push({ bpm, score: pulsePhaseScore(this.history.values, this.config.sampleRate * 60 / bpm) });
    }
    const best = bestAndRunnerUp(scores);
    const historyWeight = Math.min(1, length / (this.config.sampleRate * 8));
    const separation = Math.max(0, best.score - best.runnerUp);
    const confidence = clamp01((best.score - 0.14) / 0.72 * historyWeight * (0.7 + separation));
    this.latest = this.tracker.update(
      'dp', 'DYNAMIC PULSE', confidence >= 0.1 ? best.bpm : null, confidence, at,
      `拍位置列フィット / score ${best.score.toFixed(3)} / 差 ${separation.toFixed(3)}`,
    );
    return this.latest;
  }
}

class StatePulseBankTracker {
  private tracker: StableEstimateTracker;

  constructor(private readonly config: LabConfig) {
    this.tracker = new StableEstimateTracker(config, 0.032, 0.38);
  }

  process(inputs: DetectorEstimate[], at: number): DetectorEstimate {
    const previous = this.tracker.currentBpm();
    const candidate = chooseConsensusCandidate(inputs, this.config.minBpm, this.config.maxBpm, previous);
    if (candidate === null) {
      return this.tracker.update('pulse', 'STATE PULSE BANK', null, 0, at, '2状態以上の整合待ち');
    }
    const jump = previous === null ? 0 : Math.abs(candidate.bpm - previous) / Math.max(1, previous);
    const transitionWeight = previous === null ? 1 : Math.exp(-Math.pow(jump / 0.085, 2));
    const confidence = candidate.confidence * (0.52 + transitionWeight * 0.48);
    return this.tracker.update(
      'pulse', 'STATE PULSE BANK', candidate.bpm, confidence, at,
      `${candidate.support}/${inputs.length}状態 / 遷移尤度 ${transitionWeight.toFixed(2)} / ${candidate.contributors.join(' + ')}`,
      false,
      candidate.support,
    );
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
        label: '5-WAY CONSENSUS',
        bpm: null,
        lockedBpm: null,
        confidence: 0,
        status: inputs.some((input) => input.bpm !== null) ? 'detecting' : 'standby',
        onset: false,
        detail: '独立候補2方式以上の一致待ち',
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
      label: '5-WAY CONSENSUS',
      bpm: this.reference,
      lockedBpm: this.lockedBpm,
      confidence: candidate.confidence,
      status: this.lockedBpm !== null ? 'locked' : 'detecting',
      onset: false,
      detail: `${candidate.support}/${inputs.length}一致: ${candidate.contributors.join(' + ')}（倍/半分補正）`,
      support: candidate.support,
    };
  }
}

export class BpmComparisonAnalyzer {
  private readonly config: LabConfig;
  private legacy: LegacyBassDetector;
  private flux: SpectralFluxDetector;
  private superflux: SuperFluxDetector;
  private autocorr: AutocorrelationDetector;
  private comb: MultiBandCombDetector;
  private dp: DynamicPulseDetector;
  private pulse: StatePulseBankTracker;
  private consensus: ConsensusTracker;
  private pcmTrackers: Record<'pcm-realtime' | 'pcm-beatroot', StableEstimateTracker>;
  private pcmEstimates: Record<'pcm-realtime' | 'pcm-beatroot', DetectorEstimate>;
  private pcmUpdatedAt: Record<'pcm-realtime' | 'pcm-beatroot', number> = {
    'pcm-realtime': Number.NEGATIVE_INFINITY,
    'pcm-beatroot': Number.NEGATIVE_INFINITY,
  };

  constructor(config: Partial<LabConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.legacy = new LegacyBassDetector(this.config);
    this.flux = new SpectralFluxDetector(this.config);
    this.superflux = new SuperFluxDetector(this.config);
    this.autocorr = new AutocorrelationDetector(this.config);
    this.comb = new MultiBandCombDetector(this.config);
    this.dp = new DynamicPulseDetector(this.config);
    this.pulse = new StatePulseBankTracker(this.config);
    this.consensus = new ConsensusTracker(this.config);
    this.pcmTrackers = {
      'pcm-realtime': new StableEstimateTracker(this.config),
      'pcm-beatroot': new StableEstimateTracker(this.config),
    };
    this.pcmEstimates = {
      'pcm-realtime': this.pcmTrackers['pcm-realtime'].update(
        'pcm-realtime', 'PCM REALTIME', null, 0, 0, 'PCM入力待ち',
      ),
      'pcm-beatroot': this.pcmTrackers['pcm-beatroot'].update(
        'pcm-beatroot', 'PCM BEATROOT', null, 0, 0, 'PCM入力待ち',
      ),
    };
  }

  updatePcmEstimate(
    id: 'pcm-realtime' | 'pcm-beatroot',
    bpm: number | null,
    confidence: number,
    at: number,
    detail: string,
  ): void {
    this.pcmUpdatedAt[id] = at;
    this.pcmEstimates[id] = this.pcmTrackers[id].update(
      id,
      id === 'pcm-realtime' ? 'PCM REALTIME' : 'PCM BEATROOT',
      bpm,
      confidence,
      at,
      detail,
    );
  }

  process(bands: Float32Array, at: number): AnalysisFrame {
    for (const id of ['pcm-realtime', 'pcm-beatroot'] as const) {
      if (at - this.pcmUpdatedAt[id] > 6_000 && this.pcmEstimates[id].bpm !== null) {
        this.updatePcmEstimate(id, null, 0, at, 'PCM推定が6秒以上更新されていません');
      }
    }
    const legacy = this.legacy.process(bands, at);
    const flux = this.flux.process(bands, at);
    const superflux = this.superflux.process(bands, at);
    // The onset envelope retains amplitude, unlike the binary IOI detector.
    const autocorr = this.autocorr.process(flux.strength, at);
    const comb = this.comb.process(superflux.bandStrengths, at);
    const dp = this.dp.process(superflux.strength, at);
    const independent = [legacy.estimate, superflux.estimate, autocorr, comb, dp];
    const pulse = this.pulse.process([superflux.estimate, autocorr, comb, dp], at);
    const consensus = this.consensus.process(independent, at);
    const estimates: Record<DetectorId, DetectorEstimate> = {
      legacy: legacy.estimate,
      flux: flux.estimate,
      superflux: superflux.estimate,
      autocorr,
      comb,
      dp,
      'pcm-realtime': this.pcmEstimates['pcm-realtime'],
      'pcm-beatroot': this.pcmEstimates['pcm-beatroot'],
      pulse,
      consensus,
    };
    return {
      at,
      estimates,
      legacy: legacy.estimate,
      flux: flux.estimate,
      superflux: superflux.estimate,
      autocorr,
      comb,
      dp,
      pcmRealtime: this.pcmEstimates['pcm-realtime'],
      pcmBeatroot: this.pcmEstimates['pcm-beatroot'],
      pulse,
      consensus,
      bassEnergy: legacy.bassEnergy,
      fluxStrength: flux.rawFlux,
      superFluxStrength: superflux.strength,
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
