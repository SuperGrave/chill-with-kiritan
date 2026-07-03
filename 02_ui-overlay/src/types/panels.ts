// Mirrors tohoku-companion src-tauri/src/models.rs (serde camelCase).
// When Companion App integration (Phase B-2) lands, GET /api/state slots
// straight into these types.

export type NewsItem = {
  id: string;
  title: string;
  source?: string;
  url: string;
  publishedAt?: string;
  summary?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
};

export type AiState = {
  provider: 'openai' | 'google' | 'none';
  status: 'idle' | 'thinking' | 'responding' | 'error';
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  messages: ChatMessage[];
  error?: string;
};

export type SpotifyTrack = {
  id?: string;
  title: string;
  artist: string;
  album?: string;
  albumArtUrl?: string;
  durationMs?: number;
  progressMs?: number;
  isPlaying?: boolean;
};

export type LyricLine = {
  time?: number | null;
  text: string;
};

export type SpotifyLyricsState = {
  trackId?: string | null;
  source?: string | null;
  status: 'idle' | 'synced' | 'plain' | 'empty' | 'error';
  synced: boolean;
  lines: LyricLine[];
  error?: string | null;
};

export type SpotifyState = {
  connected: boolean;
  status: 'idle' | 'playing' | 'paused' | 'error' | 'unconfigured';
  track?: SpotifyTrack;
  lyrics?: SpotifyLyricsState;
  error?: string;
};

export type MemoItem = {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};
