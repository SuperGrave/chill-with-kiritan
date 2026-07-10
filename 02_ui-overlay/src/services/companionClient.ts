// Client for the Companion App's localhost API. The Companion (03) is the
// single source of truth for live data (news/spotify/memos) and for the
// overlay's own display settings + presets. Every call degrades gracefully:
// when the Companion isn't running, callers fall back to mock/localStorage.

import type { NewsItem, SpotifyState, MemoItem, PersonalNewsState } from '../types/panels';

const API_BASE = 'http://127.0.0.1:40313/api';
const TOKEN_HEADER = 'X-Companion-Token';
let tokenPromise: Promise<string | null> | null = null;

export type CompanionState = {
  news: NewsItem[];
  personalNews: PersonalNewsState;
  spotify: SpotifyState;
  weather: CompanionWeatherState;
  memos: MemoItem[];
  timer: CompanionTimerState;
  updatedAt: string;
};

export type CompanionWeatherCurrent = {
  location: string;
  temperature: number;
  apparentTemperature: number;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  humidity: number;
  pressure: number;
  weatherCode: number;
  precipitationProbability?: number | null;
  precipitation?: number | null;
  rain?: number | null;
  snowfall?: number | null;
  cloudCover?: number | null;
  uvIndex?: number | null;
  windSpeed: number;
  windDirection: number;
  windGust?: number | null;
  isDay: boolean;
  sunrise?: string | null;
  sunset?: string | null;
};

export type CompanionWeatherHourly = {
  time: string;
  temperature: number;
  humidity?: number | null;
  weatherCode?: number | null;
  precipitationProbability?: number | null;
  windSpeed?: number | null;
};

export type CompanionWeatherOverview = {
  publishingOffice: string;
  reportDatetime: string;
  targetArea: string;
  text: string;
};

export type CompanionWeatherState = {
  source: 'live' | 'mock' | string;
  current?: CompanionWeatherCurrent | null;
  hourly?: CompanionWeatherHourly[];
  overview?: CompanionWeatherOverview | null;
  updatedAt?: string | null;
  error?: string | null;
};

export type CompanionTimerState = {
  mode: 'timer' | 'pomodoro' | string;
  phase: 'focus' | 'shortBreak' | 'longBreak' | string;
  status: 'idle' | 'running' | 'paused' | 'finished' | string;
  cycle: number;
  durationMs: number;
  remainingMs: number;
  startedAt?: string | null;
  updatedAt?: string | null;
  commandSeq: number;
};

const defaultTimerState = (): CompanionTimerState => ({
  mode: 'pomodoro',
  phase: 'focus',
  status: 'idle',
  cycle: 1,
  durationMs: 25 * 60_000,
  remainingMs: 25 * 60_000,
  startedAt: null,
  updatedAt: null,
  commandSeq: 0,
});

const defaultPersonalNewsState = (): PersonalNewsState => ({
  scripts: [],
  currentScript: null,
  selectedScriptId: null,
  status: 'idle',
  lineIndex: 0,
  lineStartedAt: null,
  lineElapsedMs: 0,
  elapsedMs: 0,
  durationMs: 0,
  currentChapterIndex: 0,
  loopEnabled: false,
  scriptDir: null,
  error: null,
  updatedAt: new Date().toISOString(),
});

export type CompanionUi = {
  layout: Record<string, any>;
  settings: Record<string, any>;
  presets: { id: string; name: string }[];
  activePresetId?: string | null;
};

async function getJson<T>(path: string, timeoutMs = 2500): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}ts=${Date.now()}`;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function companionToken(): Promise<string | null> {
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    try {
      const token = await getJson<{ token?: unknown }>('/auth/token', 2500);
      return typeof token.token === 'string' && token.token.length > 0 ? token.token : null;
    } catch {
      return null;
    }
  })();
  return tokenPromise;
}

export async function fetchCompanionState(): Promise<CompanionState | null> {
  try {
    const s = await getJson<any>('/runtime').catch(() => getJson<any>('/state'));
    return {
      news: s.news ?? [],
      personalNews: s.personalNews ?? defaultPersonalNewsState(),
      spotify: s.spotify,
      weather: s.weather ?? { source: 'mock', current: null },
      memos: s.memos ?? [],
      timer: s.timer ?? defaultTimerState(),
      updatedAt: s.updatedAt,
    };
  } catch {
    return null; // Companion offline → caller uses mock
  }
}

export async function fetchCompanionUi(): Promise<CompanionUi | null> {
  try {
    return await getJson<CompanionUi>('/ui');
  } catch {
    return null;
  }
}

// ── Shared /api/ui poller ─────────────────────────────────────────────────
// The integrated wallpaper page has TWO consumers of the display settings
// (the wallpaper app itself + the embedded overlay). Each used to run its own
// interval; this store runs ONE polling loop per page and fans each result
// out to every subscriber. Subscribers receive every tick (CompanionUi, or
// null while the Companion is offline) and do their own cheap change
// detection — the overlay keeps its adopt/echo signature logic, the
// wallpaper gates on a settings signature so an unchanged payload never
// re-renders its tree.

export type CompanionUiListener = (ui: CompanionUi | null) => void;

const UI_POLL_MS = 700;
const uiListeners = new Set<CompanionUiListener>();
let uiPollTimer: number | undefined;
let uiPollInFlight = false;
let uiLastResult: { ui: CompanionUi | null } | null = null;

async function pollCompanionUiOnce(): Promise<void> {
  if (uiPollInFlight) return;
  uiPollInFlight = true;
  try {
    const ui = await fetchCompanionUi();
    uiLastResult = { ui };
    for (const listener of [...uiListeners]) listener(ui);
  } finally {
    uiPollInFlight = false;
  }
}

function scheduleUiPoll(): void {
  if (uiPollTimer !== undefined || uiListeners.size === 0) return;
  uiPollTimer = window.setTimeout(async () => {
    uiPollTimer = undefined;
    await pollCompanionUiOnce();
    scheduleUiPoll();
  }, UI_POLL_MS);
}

/**
 * Subscribe to the shared poll. The latest known result (if any) is delivered
 * on a microtask so a subscribing effect never sets React state synchronously;
 * fresh results follow every ~700ms. Returns the unsubscribe function.
 */
export function subscribeCompanionUi(listener: CompanionUiListener): () => void {
  uiListeners.add(listener);
  if (uiLastResult) {
    const snapshot = uiLastResult.ui;
    queueMicrotask(() => {
      if (uiListeners.has(listener)) listener(snapshot);
    });
  }
  if (uiListeners.size === 1) {
    void pollCompanionUiOnce().then(scheduleUiPoll);
  }
  return () => {
    uiListeners.delete(listener);
    if (uiListeners.size === 0 && uiPollTimer !== undefined) {
      window.clearTimeout(uiPollTimer);
      uiPollTimer = undefined;
    }
  };
}

/** Persist the overlay's current layout+settings to the Companion (best effort). */
export async function pushCompanionUi(layout: any, settings: any): Promise<boolean> {
  try {
    const token = await companionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(`${API_BASE}/ui`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ layout, settings }),
    });
    if (res.status === 401) tokenPromise = null;
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendSpotifyControl(action: 'toggle' | 'next' | 'previous' | 'play' | 'pause'): Promise<boolean> {
  try {
    const token = await companionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(`${API_BASE}/spotify/control`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action }),
    });
    if (res.status === 401) tokenPromise = null;
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

export async function sendTimerControl(action: 'start' | 'pause' | 'reset' | 'toggle' | 'next'): Promise<boolean> {
  try {
    const token = await companionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(`${API_BASE}/timer/control`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action }),
    });
    if (res.status === 401) tokenPromise = null;
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

export async function sendPersonalNewsControl(
  action: 'play' | 'pause' | 'toggle' | 'stop' | 'restart' | 'nextLine' | 'previousLine' | 'nextChapter' | 'previousChapter',
  options?: { loopEnabled?: boolean },
): Promise<boolean> {
  try {
    const token = await companionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(`${API_BASE}/personal-news/control`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...options }),
    });
    if (res.status === 401) tokenPromise = null;
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}
