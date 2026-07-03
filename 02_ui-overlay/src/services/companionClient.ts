// Client for the Companion App's localhost API. The Companion (03) is the
// single source of truth for live data (news/ai/spotify/memos) and for the
// overlay's own display settings + presets. Every call degrades gracefully:
// when the Companion isn't running, callers fall back to mock/localStorage.

import type { NewsItem, AiState, SpotifyState, MemoItem } from '../types/panels';

const API_BASE = 'http://127.0.0.1:40313/api';
const TOKEN_HEADER = 'X-Companion-Token';
let tokenPromise: Promise<string | null> | null = null;

export type CompanionState = {
  news: NewsItem[];
  ai: AiState;
  spotify: SpotifyState;
  memos: MemoItem[];
  updatedAt: string;
};

export type CompanionUi = {
  layout: Record<string, any>;
  settings: Record<string, any>;
  presets: { id: string; name: string }[];
  activePresetId?: string | null;
};

async function getJson<T>(path: string, timeoutMs = 2500): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: ctrl.signal });
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
    const s = await getJson<any>('/state');
    return {
      news: s.news ?? [],
      ai: s.ai,
      spotify: s.spotify,
      memos: s.memos ?? [],
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

export async function sendCompanionChat(text: string): Promise<boolean> {
  try {
    const token = await companionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(`${API_BASE}/chat/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
    });
    if (res.status === 401) tokenPromise = null;
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
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
