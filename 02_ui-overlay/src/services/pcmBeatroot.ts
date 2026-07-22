import {
  fetchAudioPcmChunk,
  requestAudioRhythmReset,
  type CompanionPcmChunk,
} from './companionClient';
import { TempoBelief } from '../lib/tempoBelief';

export interface BeatrootConfig {
  stableMs: number;
  confidenceThreshold: number;
  windowSeconds: number;
  analysisIntervalSeconds: number;
  changeConfirmMs: number;
  periodicResetMinutes: number;
}

export interface BeatrootSnapshot {
  status: 'standby' | 'detecting' | 'locked';
  detectedBpm: number | null;
  lockedBpm: number | null;
  retainedBpm: number | null;
  confidence: number;
  accepted: boolean;
  stableForMs: number;
  lockedAt: number | null;
  challengerBpm: number | null;
  challengerForMs: number;
  captureStatus: string;
  resetGeneration: number;
  resetReason: string;
  resetAt: string | null;
  detail: string;
}

type Listener = (snapshot: BeatrootSnapshot) => void;

const DEFAULT_CONFIG: BeatrootConfig = {
  stableMs: 5_000,
  confidenceThreshold: 0.7,
  windowSeconds: 14,
  analysisIntervalSeconds: 3,
  changeConfirmMs: 9_000,
  periodicResetMinutes: 0,
};
const POLL_MS = 500;
const PCM_STALE_MS = 5_000;

function initialSnapshot(): BeatrootSnapshot {
  return {
    status: 'standby',
    detectedBpm: null,
    lockedBpm: null,
    retainedBpm: null,
    confidence: 0,
    accepted: false,
    stableForMs: 0,
    lockedAt: null,
    challengerBpm: null,
    challengerForMs: 0,
    captureStatus: 'starting',
    resetGeneration: -1,
    resetReason: 'startup',
    resetAt: null,
    detail: 'PCM待機中',
  };
}

function decodePcm16(encoded: string): Float32Array {
  if (!encoded) return new Float32Array(0);
  const binary = atob(encoded);
  const output = new Float32Array(Math.floor(binary.length / 2));
  for (let index = 0; index < output.length; index++) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    const unsigned = low | (high << 8);
    const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    output[index] = signed / 32768;
  }
  return output;
}

class PcmBeatrootService {
  private config = { ...DEFAULT_CONFIG };
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private pollTimer: number | null = null;
  private periodicTimer: number | null = null;
  private pollInFlight = false;
  private nextSeq = 0;
  private sampleRate = 11_025;
  private lastPcmAt = 0;
  private snapshot = initialSnapshot();
  private belief = new TempoBelief();

  configure(patch: Partial<BeatrootConfig>): void {
    const previous = this.config;
    this.config = {
      stableMs: Math.max(3_000, Math.min(12_000, Math.round(patch.stableMs ?? previous.stableMs))),
      confidenceThreshold: Math.max(0.5, Math.min(0.95, patch.confidenceThreshold ?? previous.confidenceThreshold)),
      windowSeconds: Math.max(8, Math.min(24, patch.windowSeconds ?? previous.windowSeconds)),
      analysisIntervalSeconds: Math.max(1, Math.min(10, patch.analysisIntervalSeconds ?? previous.analysisIntervalSeconds)),
      changeConfirmMs: Math.max(3_000, Math.min(30_000, Math.round(patch.changeConfirmMs ?? previous.changeConfirmMs))),
      periodicResetMinutes: Math.max(0, Math.min(120, patch.periodicResetMinutes ?? previous.periodicResetMinutes)),
    };
    this.ensureStarted();
    const workerConfigChanged = previous.windowSeconds !== this.config.windowSeconds
      || previous.analysisIntervalSeconds !== this.config.analysisIntervalSeconds;
    if (workerConfigChanged && this.worker) this.resetLocal('settings-change', this.snapshot.resetGeneration);
    this.schedulePeriodicReset();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ ...this.snapshot });
    this.ensureStarted();
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): BeatrootSnapshot {
    if (this.lastPcmAt > 0 && performance.now() - this.lastPcmAt > PCM_STALE_MS) {
      this.snapshot = {
        ...this.snapshot,
        status: 'standby',
        detectedBpm: null,
        lockedBpm: null,
        accepted: false,
        confidence: 0,
        detail: 'PCM入力待ち（統計は保持中）',
      };
    }
    return this.snapshot;
  }

  private ensureStarted(): void {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/pcmBeatroot.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => this.onWorkerMessage(event.data);
      this.postWorkerReset();
    }
    if (this.pollTimer === null) {
      void this.poll();
      this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
    }
  }

  private postWorkerReset(): void {
    this.worker?.postMessage({
      type: 'reset',
      sampleRate: this.sampleRate,
      windowSeconds: this.config.windowSeconds,
      analysisIntervalSeconds: this.config.analysisIntervalSeconds,
    });
  }

  private resetLocal(reason: string, generation: number, resetAt: string | null = null): void {
    this.belief.reset();
    this.snapshot = {
      ...initialSnapshot(),
      captureStatus: this.snapshot.captureStatus,
      resetGeneration: generation,
      resetReason: reason,
      resetAt,
    };
    this.postWorkerReset();
    this.emit();
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const chunk = await fetchAudioPcmChunk(this.nextSeq);
      if (!chunk) return;
      this.acceptChunk(chunk);
    } finally {
      this.pollInFlight = false;
    }
  }

  private acceptChunk(chunk: CompanionPcmChunk): void {
    const previousCaptureStatus = this.snapshot.captureStatus;
    this.snapshot = {
      ...this.snapshot,
      captureStatus: chunk.status,
      resetReason: chunk.resetReason,
      resetAt: chunk.resetAt,
    };
    if (chunk.resetGeneration !== this.snapshot.resetGeneration) {
      this.nextSeq = chunk.from;
      this.sampleRate = chunk.sampleRate;
      this.resetLocal(chunk.resetReason, chunk.resetGeneration, chunk.resetAt);
    }
    if (chunk.from !== this.nextSeq) this.nextSeq = chunk.from;
    const samples = decodePcm16(chunk.samplesB64);
    this.nextSeq = chunk.to;
    if (samples.length > 0) {
      this.lastPcmAt = performance.now();
      if (previousCaptureStatus === 'reconnecting' && chunk.status === 'running') {
        this.snapshot = { ...this.snapshot, detail: 'PCM入力を再開しました（BPM再解析中）' };
        this.emit();
      }
      this.worker?.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    } else if (chunk.status === 'error' || chunk.status === 'reconnecting') {
      this.snapshot = {
        ...this.snapshot,
        status: 'standby',
        detail: chunk.status === 'reconnecting'
          ? `音声デバイスへ再接続中…${chunk.error ? ` (${chunk.error})` : ''}`
          : chunk.error ?? 'PCM取得エラー',
      };
      this.emit();
    }
  }

  private onWorkerMessage(message: Record<string, unknown>): void {
    if (message.type === 'error') {
      this.snapshot = { ...this.snapshot, status: 'standby', detail: String(message.error ?? 'BeatRoot error') };
      this.emit();
      return;
    }
    if (message.type !== 'estimate') return;
    const bpm = Number(message.bpm);
    const confidence = Number(message.confidence);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 260 || !Number.isFinite(confidence)) return;
    this.applyEstimate(bpm, confidence, Number(message.duration), Number(message.beats));
  }

  private applyEstimate(rawBpm: number, confidence: number, duration: number, beats: number): void {
    const now = performance.now();
    const belief = this.belief.apply(rawBpm, confidence, now, {
      stableMs: this.config.stableMs,
      confidenceThreshold: this.config.confidenceThreshold,
      changeConfirmMs: this.config.changeConfirmMs,
    });
    this.snapshot = {
      ...this.snapshot,
      status: belief.lockedBpm !== null ? 'locked' : 'detecting',
      detectedBpm: belief.detectedBpm,
      lockedBpm: belief.lockedBpm,
      retainedBpm: belief.retainedBpm,
      confidence,
      accepted: belief.accepted,
      stableForMs: belief.stableForMs,
      lockedAt: belief.lockedAt,
      challengerBpm: belief.challengerBpm,
      challengerForMs: belief.challengerForMs,
      detail: !belief.accepted
        ? `信頼度 ${Math.round(confidence * 100)}%（閾値未満・不採用）`
        : belief.challengerBpm !== null
          ? `BeatRoot ${duration.toFixed(1)}秒窓 / ${beats}拍・変更候補を検証中`
          : `BeatRoot ${duration.toFixed(1)}秒窓 / ${beats}拍`,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener({ ...this.snapshot });
  }

  private schedulePeriodicReset(): void {
    if (this.periodicTimer !== null) {
      window.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.config.periodicResetMinutes <= 0) return;
    this.periodicTimer = window.setInterval(
      () => void requestAudioRhythmReset('periodic'),
      this.config.periodicResetMinutes * 60_000,
    );
  }
}

export const pcmBeatroot = new PcmBeatrootService();
