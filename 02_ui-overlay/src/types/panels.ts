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

export type PersonalNewsScriptSummary = {
  id: string;
  title: string;
  fileName: string;
  description?: string | null;
  chapterCount: number;
  lineCount: number;
  sourceCount: number;
  supplementCount?: number;
  estimatedDurationMs: number;
  modifiedAt?: string | null;
};

export type PersonalNewsChapter = {
  id: string;
  title: string;
  lineIndex: number;
  positionMs: number;
};

export type PersonalNewsLine = {
  id: string;
  kind: 'text' | 'wait' | 'source' | string;
  topic?: string | null;
  text: string;
  durationMs: number;
  sourceId?: string | null;
  positionMs: number;
};

export type PersonalNewsSupplement = {
  id: string;
  title: string;
  text: string;
  url?: string | null;
  lineIndex: number;
  chapterIndex: number;
  positionMs: number;
  durationMs: number;
};

export type PersonalNewsSource = {
  id: string;
  title: string;
  url: string;
  lineIndex: number;
  chapterIndex: number;
  positionMs: number;
};

export type PersonalNewsScript = {
  id: string;
  title: string;
  fileName: string;
  description?: string | null;
  chapters: PersonalNewsChapter[];
  lines: PersonalNewsLine[];
  supplements?: PersonalNewsSupplement[];
  sources: PersonalNewsSource[];
  estimatedDurationMs: number;
  modifiedAt?: string | null;
};

export type PersonalNewsState = {
  scripts: PersonalNewsScriptSummary[];
  currentScript?: PersonalNewsScript | null;
  selectedScriptId?: string | null;
  status: 'idle' | 'playing' | 'paused' | 'finished' | 'error' | string;
  lineIndex: number;
  lineStartedAt?: string | null;
  lineElapsedMs: number;
  elapsedMs: number;
  durationMs: number;
  currentChapterIndex: number;
  loopEnabled: boolean;
  autoPlayActive?: boolean;
  scriptDir?: string | null;
  error?: string | null;
  updatedAt: string;
};

export type SpotifyTrack = {
  id?: string;
  title: string;
  artist: string;
  album?: string;
  albumArtUrl?: string;
  durationMs?: number;
  progressMs?: number;
  sampledAt?: string;
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
