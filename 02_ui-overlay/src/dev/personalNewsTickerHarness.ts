// Dev-only harness: mounts a PersonalNewsPanel with a synthetic, fully
// controlled PersonalNewsState so the conveyor ticker can be exercised without
// touching the user's live companion state (the real overlay heals its
// settings from the running companion, and the real script/panel visibility
// belong to the user).
//
// Usage from the dev console (vite serves it on demand; nothing imports it, so
// it never ships in a production build):
//   const h = await import('/src/dev/personalNewsTickerHarness.ts');
//   h.mount();                    // floating panel, synthetic looping script
//   const s = await h.sample(6000); // per-frame transform samples + stats
//   h.pause(); h.resume(); h.seek(3);
//   h.unmount();
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PersonalNewsPanel from '../components/panels/PersonalNewsPanel';
import type { PersonalNewsState } from '../types/panels';

const CHAR_MS = 180; // companion personal_news.rs reading pace

type HarnessLine = { id: string; kind: 'text'; text: string; topic: string; durationMs: number; positionMs: number };

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let state: PersonalNewsState | null = null;

const texts: Array<{ text: string; durationMs?: number }> = [
  { text: '本日の検証枠です。コンベア方式のティッカーが一定の読み速度で流れるかを確認しています。' },
  // Old-implementation killer #1: a very short block used to FLY across
  // (shellW dominated) and then leave dead air for the rest of its slot.
  { text: '短い行です。' },
  { text: '続いて長めの行。ブロックの境目で止まったり跳んだりせず、そのまま同じ速さで滑らかに流れ続けるかどうかを見ます。' },
  // Explicit-wait analog: tiny text, long slot — the conveyor should SLOW,
  // holding the previous text readable, instead of blanking the shell.
  { text: '間。', durationMs: 5_000 },
  { text: '最後の行です。ここまで来たらループして最初のブロックに戻ります。' },
];

function buildScript() {
  const lines: HarnessLine[] = [];
  let position = 0;
  texts.forEach((entry, index) => {
    const durationMs = entry.durationMs ?? entry.text.length * CHAR_MS;
    lines.push({ id: `hl_${index}`, kind: 'text', text: entry.text, topic: '検証', durationMs, positionMs: position });
    position += durationMs;
  });
  return {
    id: 'ticker-harness',
    title: 'TICKER HARNESS',
    fileName: 'ticker-harness.txt',
    lines,
    chapters: [{ id: 'hc_0', title: '検証チャプター', lineIndex: 0, positionMs: 0 }],
    sources: [],
    supplements: [],
    estimatedDurationMs: position,
  };
}

function render() {
  if (!root || !state) return;
  root.render(
    React.createElement(PersonalNewsPanel, {
      personalNews: state,
      settings: {
        show: true,
        showStatus: true,
        personalNewsShowTitle: true,
        personalNewsShowTopic: true,
        personalNewsShowBody: true,
        personalNewsShowSource: true,
        personalNewsShowProgress: true,
        personalNewsBodySize: 35,
      },
    }),
  );
}

export function mount(): string {
  unmount();
  host = document.createElement('div');
  host.id = 'ticker-harness-host';
  host.style.cssText = [
    'position:fixed', 'left:24px', 'bottom:24px', 'width:896px', 'height:225px',
    'z-index:99999', 'background:#14161c', 'border:1px solid #3a3f4a',
    'border-radius:10px', 'padding:14px', 'box-sizing:border-box',
  ].join(';');
  document.body.appendChild(host);
  const script = buildScript();
  state = {
    scripts: [],
    status: 'playing',
    selectedScriptId: script.id,
    loopEnabled: true,
    lineIndex: 0,
    lineElapsedMs: 0,
    elapsedMs: 0,
    lineStartedAt: new Date().toISOString(),
    durationMs: script.estimatedDurationMs,
    currentChapterIndex: 0,
    currentScript: script,
    updatedAt: new Date().toISOString(),
  };
  root = createRoot(host);
  render();
  return `mounted: ${script.lines.length} blocks, total ${script.estimatedDurationMs}ms`;
}

/** Materialized elapsed inside the current block (mirror of the panel walk). */
function liveElapsed(): { lineIndex: number; lineElapsedMs: number } {
  const currentState = state;
  if (!currentState?.currentScript) return { lineIndex: 0, lineElapsedMs: 0 };
  const lines = currentState.currentScript.lines as HarnessLine[];
  let idx = currentState.lineIndex;
  let elapsed = currentState.lineElapsedMs;
  if (currentState.status === 'playing' && currentState.lineStartedAt) {
    elapsed += Math.max(0, Date.now() - Date.parse(currentState.lineStartedAt));
    while (elapsed >= lines[idx].durationMs) {
      elapsed -= lines[idx].durationMs;
      idx = (idx + 1) % lines.length;
    }
  }
  return { lineIndex: idx, lineElapsedMs: elapsed };
}

export function pause(): string {
  if (!state) return 'not mounted';
  const at = liveElapsed();
  state = { ...state, status: 'paused', ...at, lineStartedAt: new Date().toISOString() };
  render();
  return `paused at block ${at.lineIndex} +${Math.round(at.lineElapsedMs)}ms`;
}

export function resume(): string {
  if (!state) return 'not mounted';
  state = { ...state, status: 'playing', lineStartedAt: new Date().toISOString() };
  render();
  return 'resumed';
}

export function seek(lineIndex: number): string {
  if (!state) return 'not mounted';
  state = { ...state, status: 'playing', lineIndex, lineElapsedMs: 0, lineStartedAt: new Date().toISOString() };
  render();
  return `seeked to block ${lineIndex}`;
}

/**
 * Sample the row transform once per rAF for `ms`. Returns raw [t, x] pairs
 * plus quick stats the caller can assert on: forward jumps (x must be
 * monotonically non-increasing while playing), the largest per-frame step,
 * and per-visible-block pixel velocities.
 */
export function sample(ms = 6000): Promise<{
  frames: number;
  maxForwardStep: number;
  maxBackStep: number;
  stallStreakMs: number;
  velocities: Array<{ blockIndex: number; pxPerSec: number }>;
  samples: Array<[number, number]>;
}> {
  return new Promise((resolve) => {
    const row = host?.querySelector('.personal-news-ticker-row') as HTMLElement | null;
    if (!row) {
      resolve({ frames: 0, maxForwardStep: NaN, maxBackStep: NaN, stallStreakMs: NaN, velocities: [], samples: [] });
      return;
    }
    const samples: Array<[number, number, number]> = []; // t, x, blockIndex
    const started = performance.now();
    const step = () => {
      const now = performance.now();
      const m = /translate3d\((-?[\d.]+)px/.exec(row.style.transform);
      if (m) samples.push([now - started, Number(m[1]), liveElapsed().lineIndex]);
      if (now - started < ms) requestAnimationFrame(step);
      else finish();
    };
    const finish = () => {
      let maxForwardStep = 0;
      let maxBackStep = 0;
      let stallStreakMs = 0;
      let stallStart: number | null = null;
      for (let i = 1; i < samples.length; i += 1) {
        const dx = samples[i][1] - samples[i - 1][1]; // negative = leftward = good
        if (dx > maxForwardStep) maxForwardStep = dx;
        if (-dx > maxBackStep) maxBackStep = -dx;
        if (Math.abs(dx) < 0.01) {
          if (stallStart === null) stallStart = samples[i - 1][0];
          stallStreakMs = Math.max(stallStreakMs, samples[i][0] - stallStart);
        } else {
          stallStart = null;
        }
      }
      const velocities: Array<{ blockIndex: number; pxPerSec: number }> = [];
      let runStart = 0;
      for (let i = 1; i <= samples.length; i += 1) {
        if (i === samples.length || samples[i][2] !== samples[runStart][2]) {
          const a = samples[runStart];
          const b = samples[i - 1];
          if (b[0] - a[0] > 300) {
            velocities.push({
              blockIndex: a[2],
              pxPerSec: Math.round(((a[1] - b[1]) / (b[0] - a[0])) * 1000),
            });
          }
          runStart = i;
        }
      }
      resolve({
        frames: samples.length,
        maxForwardStep: Number(maxForwardStep.toFixed(2)),
        maxBackStep: Number(maxBackStep.toFixed(2)),
        stallStreakMs: Math.round(stallStreakMs),
        velocities,
        samples: samples.map(([t, x]) => [Math.round(t), Number(x.toFixed(1))]),
      });
    };
    requestAnimationFrame(step);
  });
}

export function unmount(): string {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  state = null;
  return 'unmounted';
}
