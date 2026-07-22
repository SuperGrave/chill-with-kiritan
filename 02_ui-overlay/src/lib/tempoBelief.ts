export interface TempoBeliefConfig {
  stableMs: number;
  confidenceThreshold: number;
  changeConfirmMs: number;
  sameTempoBpm?: number;
}

export interface TempoBeliefResult {
  accepted: boolean;
  detectedBpm: number;
  lockedBpm: number | null;
  retainedBpm: number | null;
  stableForMs: number;
  lockedAt: number | null;
  challengerBpm: number | null;
  challengerForMs: number;
}

function weightedMedian(values: Array<{ bpm: number; confidence: number }>): number {
  const sorted = [...values].sort((a, b) => a.bpm - b.bpm);
  const total = sorted.reduce((sum, value) => sum + value.confidence, 0);
  let cursor = 0;
  for (const value of sorted) {
    cursor += value.confidence;
    if (cursor >= total / 2) return Math.round(value.bpm);
  }
  return Math.round(sorted.at(-1)?.bpm ?? 0);
}

/**
 * Sticky tempo statistics for one reset generation (normally one song).
 * A low-confidence reading is never emitted, but the retained belief survives.
 * A distant high-confidence reading must remain coherent for changeConfirmMs
 * before it can replace the current tempo.
 */
export class TempoBelief {
  private candidateStartedAt: number | null = null;
  private candidateValues: Array<{ bpm: number; confidence: number }> = [];
  private retainedBpm: number | null = null;
  private lockedAt: number | null = null;
  private challengerStartedAt: number | null = null;
  private challengerValues: Array<{ bpm: number; confidence: number }> = [];

  reset(): void {
    this.candidateStartedAt = null;
    this.candidateValues = [];
    this.retainedBpm = null;
    this.lockedAt = null;
    this.challengerStartedAt = null;
    this.challengerValues = [];
  }

  apply(rawBpm: number, confidence: number, now: number, config: TempoBeliefConfig): TempoBeliefResult {
    const sameTempoBpm = config.sameTempoBpm ?? 3;
    if (confidence < config.confidenceThreshold) {
      return this.result(false, rawBpm, confidence, now);
    }

    let bpm = rawBpm;
    if (this.retainedBpm !== null) {
      for (const folded of [rawBpm / 2, rawBpm * 2]) {
        if (Math.abs(folded - this.retainedBpm) <= sameTempoBpm) {
          bpm = this.retainedBpm;
          break;
        }
      }
    }

    if (this.retainedBpm === null) {
      const center = this.candidateValues.length > 0 ? weightedMedian(this.candidateValues) : bpm;
      if (this.candidateStartedAt === null || Math.abs(bpm - center) > sameTempoBpm) {
        this.candidateStartedAt = now;
        this.candidateValues = [];
      }
      this.candidateValues.push({ bpm, confidence });
      this.candidateValues = this.candidateValues.slice(-8);
      if (now - (this.candidateStartedAt ?? now) >= config.stableMs && this.candidateValues.length >= 2) {
        this.retainedBpm = weightedMedian(this.candidateValues);
        this.lockedAt = now;
      }
      return this.result(true, bpm, confidence, now);
    }

    if (Math.abs(bpm - this.retainedBpm) <= sameTempoBpm) {
      this.candidateValues.push({ bpm, confidence });
      this.candidateValues = this.candidateValues.slice(-12);
      const retained = this.retainedBpm;
      this.retainedBpm = weightedMedian(
        this.candidateValues.filter((value) => Math.abs(value.bpm - retained) <= sameTempoBpm),
      );
      this.challengerStartedAt = null;
      this.challengerValues = [];
      return this.result(true, bpm, confidence, now);
    }

    const challengerCenter = this.challengerValues.length > 0 ? weightedMedian(this.challengerValues) : bpm;
    if (this.challengerStartedAt === null || Math.abs(bpm - challengerCenter) > sameTempoBpm) {
      this.challengerStartedAt = now;
      this.challengerValues = [];
    }
    this.challengerValues.push({ bpm, confidence });
    this.challengerValues = this.challengerValues.slice(-8);
    const challengerForMs = now - (this.challengerStartedAt ?? now);
    if (challengerForMs >= config.changeConfirmMs && this.challengerValues.length >= 3) {
      this.retainedBpm = weightedMedian(this.challengerValues);
      this.candidateValues = [...this.challengerValues];
      this.lockedAt = now;
      this.challengerStartedAt = null;
      this.challengerValues = [];
    }
    return this.result(true, bpm, confidence, now);
  }

  private result(accepted: boolean, bpm: number, _confidence: number, now: number): TempoBeliefResult {
    const challengerForMs = this.challengerStartedAt === null ? 0 : now - this.challengerStartedAt;
    return {
      accepted,
      detectedBpm: Math.round(bpm),
      lockedBpm: accepted ? this.retainedBpm : null,
      retainedBpm: this.retainedBpm,
      stableForMs: this.retainedBpm === null
        ? this.candidateStartedAt === null ? 0 : now - this.candidateStartedAt
        : now - (this.lockedAt ?? now),
      lockedAt: this.lockedAt,
      challengerBpm: this.challengerValues.length > 0 ? weightedMedian(this.challengerValues) : null,
      challengerForMs,
    };
  }
}
