/// <reference lib="webworker" />

import MusicTempo from 'music-tempo';

type InputMessage =
  | {
      type: 'reset';
      sampleRate: number;
      windowSeconds: number;
      analysisIntervalSeconds: number;
    }
  | { type: 'chunk'; samples: Float32Array };

let sampleRate = 11_025;
let windowSeconds = 14;
let analysisIntervalSeconds = 3;
let chunks: Float32Array[] = [];
let totalSamples = 0;
let samplesSinceAnalysis = 0;
let analyzing = false;

function trimWindow(): void {
  const maxSamples = Math.round(sampleRate * (windowSeconds + 2));
  while (chunks.length > 1 && totalSamples - chunks[0].length >= maxSamples) {
    const removed = chunks.shift();
    if (removed) totalSamples -= removed.length;
  }
}

function copyRecentWindow(): Float32Array {
  const wanted = Math.min(totalSamples, Math.round(sampleRate * windowSeconds));
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
  const minimumSeconds = Math.min(8, Math.max(5, windowSeconds * 0.6));
  if (
    analyzing
    || totalSamples < sampleRate * minimumSeconds
    || samplesSinceAnalysis < sampleRate * analysisIntervalSeconds
  ) return;
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
    const confidence = Math.max(0, Math.min(0.95, coverage * 0.82));
    self.postMessage({
      type: 'estimate',
      bpm,
      confidence,
      beats: tracker.beats.length,
      duration,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    analyzing = false;
  }
}

self.onmessage = (event: MessageEvent<InputMessage>) => {
  if (event.data.type === 'reset') {
    sampleRate = Math.max(8_000, event.data.sampleRate);
    windowSeconds = Math.max(8, Math.min(24, event.data.windowSeconds));
    analysisIntervalSeconds = Math.max(1, Math.min(10, event.data.analysisIntervalSeconds));
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
