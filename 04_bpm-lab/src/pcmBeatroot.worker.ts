/// <reference lib="webworker" />

import MusicTempo from 'music-tempo';

type InputMessage =
  | { type: 'reset'; sampleRate: number }
  | { type: 'chunk'; samples: Float32Array };

let sampleRate = 44_100;
let chunks: Float32Array[] = [];
let totalSamples = 0;
let samplesSinceAnalysis = 0;
let analyzing = false;

function trimWindow(): void {
  const maxSamples = Math.round(sampleRate * 16);
  while (chunks.length > 1 && totalSamples - chunks[0].length >= maxSamples) {
    const removed = chunks.shift();
    if (removed) totalSamples -= removed.length;
  }
}

function copyRecentWindow(): Float32Array {
  const wanted = Math.min(totalSamples, Math.round(sampleRate * 14));
  const result = new Float32Array(wanted);
  let writeAt = wanted;
  for (let index = chunks.length - 1; index >= 0 && writeAt > 0; index--) {
    const chunk = chunks[index];
    const take = Math.min(writeAt, chunk.length);
    writeAt -= take;
    result.set(chunk.subarray(chunk.length - take), writeAt);
  }
  return result;
}

function analyze(): void {
  if (analyzing || totalSamples < sampleRate * 8 || samplesSinceAnalysis < sampleRate * 3) return;
  analyzing = true;
  samplesSinceAnalysis = 0;
  const audio = copyRecentWindow();
  try {
    const tracker = new MusicTempo(audio, {
      bufferSize: 2048,
      hopSize: Math.max(1, Math.round(sampleRate * 0.01)),
      timeStep: 0.01,
      minBeatInterval: 60 / 220,
      maxBeatInterval: 60 / 50,
      initPeriod: Math.min(5, audio.length / sampleRate * 0.45),
      expiryTime: 8,
    });
    const bpm = Number(tracker.tempo);
    const duration = audio.length / sampleRate;
    const expectedBeats = Number.isFinite(bpm) ? duration * bpm / 60 : 0;
    const coverage = expectedBeats > 0 ? tracker.beats.length / expectedBeats : 0;
    const confidence = Math.max(0.1, Math.min(0.95, coverage * 0.82));
    self.postMessage({
      bpm,
      confidence,
      detail: `BeatRoot ${duration.toFixed(1)}秒窓 / beats ${tracker.beats.length}`,
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    analyzing = false;
  }
}

self.onmessage = (event: MessageEvent<InputMessage>) => {
  if (event.data.type === 'reset') {
    sampleRate = Math.max(8_000, event.data.sampleRate);
    chunks = [];
    totalSamples = 0;
    samplesSinceAnalysis = 0;
    analyzing = false;
    return;
  }
  const copy = new Float32Array(event.data.samples);
  for (let index = 0; index < copy.length; index++) {
    copy[index] = Math.max(-1, Math.min(1, copy[index]));
  }
  chunks.push(copy);
  totalSamples += copy.length;
  samplesSinceAnalysis += copy.length;
  trimWindow();
  analyze();
};

export {};
