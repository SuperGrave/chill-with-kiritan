// Injectable deterministic RNG for the Motion Director (Phase 0, Test C).
//
// Everything stochastic in the director (mode transition picks, Ambient
// lotteries, dwell/interval jitter) draws from an injected Rng so a fixed seed
// reproduces an entire 24h soak exactly. THREE-agnostic, no globals.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /**
   * Weighted pick: returns the index chosen with probability weights[i]/sum.
   * Throws on empty / all-zero weights so callers can't silently degrade.
   */
  weighted(weights: number[]): number;
}

// mulberry32 — tiny, fast, good enough for behaviour sampling (not crypto).
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (n) => Math.floor(next() * n),
    weighted: (weights) => {
      let sum = 0;
      for (const w of weights) sum += w > 0 ? w : 0;
      if (!(sum > 0)) throw new Error('weighted(): no positive weights');
      let r = next() * sum;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i] > 0 ? weights[i] : 0;
        if (r < w) return i;
        r -= w;
      }
      // Floating-point fall-through: return the last positive index.
      for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
      return 0;
    },
  };
}
