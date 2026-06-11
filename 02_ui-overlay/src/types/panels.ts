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
  title: string;
  artist: string;
  album?: string;
  albumArtUrl?: string;
  durationMs?: number;
  progressMs?: number;
};

export type SpotifyState = {
  connected: boolean;
  status: 'idle' | 'playing' | 'paused' | 'error';
  track?: SpotifyTrack;
  error?: string;
};

export type MemoItem = {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};
