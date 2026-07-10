// Thin client for the companion's own localhost HTTP API. The React UI and the
// wallpaper overlay both talk to the same backend (single source of truth).

export const API_BASE = "http://127.0.0.1:40313/api";
const TOKEN_HEADER = "X-Companion-Token";
let tokenPromise: Promise<string | null> | null = null;

async function companionToken(): Promise<string | null> {
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/token`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.token === "string" && body.token.length > 0 ? body.token : null;
    } catch {
      return null;
    }
  })();
  return tokenPromise;
}

function isMutating(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (isMutating(method)) {
    const token = await companionToken();
    if (token) headers.set(TOKEN_HEADER, token);
  }

  let res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && isMutating(method)) {
    tokenPromise = null;
    const token = await companionToken();
    if (token) {
      headers.set(TOKEN_HEADER, token);
      res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    }
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export type BackgroundUploadKind = "image" | "video" | "overlay";
export type BackgroundMediaItem = {
  url: string;
  type: "image" | "video";
  kind?: "background" | "overlay";
  name?: string;
  fileName?: string;
  size?: number;
};

async function uploadBinary<T>(path: string, file: File, mediaType: BackgroundUploadKind): Promise<T> {
  const headers = new Headers();
  headers.set("Content-Type", file.type || "application/octet-stream");
  const token = await companionToken();
  if (token) headers.set(TOKEN_HEADER, token);

  const query = new URLSearchParams({
    fileName: file.name || "background",
    mediaType,
  });

  let res = await fetch(`${API_BASE}${path}?${query.toString()}`, {
    method: "POST",
    headers,
    body: file,
  });
  if (res.status === 401) {
    tokenPromise = null;
    const retryToken = await companionToken();
    if (retryToken) {
      headers.set(TOKEN_HEADER, retryToken);
      res = await fetch(`${API_BASE}${path}?${query.toString()}`, {
        method: "POST",
        headers,
        body: file,
      });
    }
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body?.ok === false) throw new Error(body.error ?? "upload failed");
  return body as T;
}

const post = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const put = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
const patch = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
const del = <T = any>(path: string) => req<T>(path, { method: "DELETE" });

// ── Types (mirror Rust models.rs, serde camelCase) ──────────────────────────
export type Memo = {
  id: string; text: string; pinned: boolean; createdAt: string; updatedAt: string;
};
export type Bookmark = {
  id: string; title: string; url: string;
  icon?: string; category?: string; order?: number; createdAt: string; updatedAt: string;
};
export type UiPreset = {
  id: string; name: string; layout: any; settings: any; createdAt: string; updatedAt: string;
};
export type UiState = {
  layout: any; settings: any; presets: UiPreset[]; activePresetId?: string | null;
};
export type AppSettings = {
  weather: { latitude: number; longitude: number; timezone: string; locationLabel: string; jmaOffice: string };
  news: { feeds: string[]; maxItems: number };
  spotify: { clientId: string };
  startup: { launchAtLogin: boolean; launchWithHighestPrivileges: boolean };
};
export type SecretsStatus = {
  spotifyClientSecret: boolean; spotifyRefreshToken: boolean;
};
export type StartupStatus = {
  launchAtLogin: boolean;
  launchWithHighestPrivileges: boolean;
  taskRegistered: boolean;
  runKeyRegistered: boolean;
  method: string;
  taskName: string;
  exePath: string;
};
export type StartupElevatedRepairResult = {
  ok: boolean;
  launched: boolean;
  status: StartupStatus;
  error?: string;
};
export type TimerState = {
  mode: string;
  phase: string;
  status: string;
  cycle: number;
  durationMs: number;
  remainingMs: number;
  startedAt?: string | null;
  updatedAt?: string | null;
  commandSeq: number;
};

export type NewsItem = {
  id: string;
  title: string;
  source?: string | null;
  url: string;
  publishedAt?: string | null;
  summary?: string | null;
};

export type NewsFeedState = {
  feedUrl: string;
  source: string;
  status: string;
  items: NewsItem[];
  error?: string | null;
  updatedAt?: string | null;
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
  kind: string;
  topic?: string | null;
  text: string;
  durationMs: number;
  sourceId?: string | null;
  positionMs: number;
};

export type PersonalNewsSource = {
  id: string;
  title: string;
  url: string;
  lineIndex: number;
  chapterIndex: number;
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
  status: string;
  lineIndex: number;
  lineStartedAt?: string | null;
  lineElapsedMs: number;
  elapsedMs: number;
  durationMs: number;
  currentChapterIndex: number;
  loopEnabled: boolean;
  scriptDir?: string | null;
  error?: string | null;
  updatedAt: string;
};

export const api = {
  health: () => req<{ ok: boolean; app: string; version: string }>("/health"),
  state: () => req<any>("/state"),

  // UI settings + presets
  getUi: () => req<UiState>("/ui"),
  putUi: (layout: any, settings: any) => put("/ui", { layout, settings }),
  listPresets: () => req<UiPreset[]>("/presets"),
  createPreset: (name: string, layout?: any, settings?: any) =>
    post("/presets", { name, layout, settings }),
  renamePreset: (id: string, name: string) => put(`/presets/${id}`, { name }),
  overwritePreset: (id: string, layout: any, settings: any) =>
    put(`/presets/${id}`, { layout, settings }),
  deletePreset: (id: string) => del(`/presets/${id}`),
  applyPreset: (id: string) => post(`/presets/${id}/apply`),
  uploadBackground: (file: File, mediaType: BackgroundUploadKind) =>
    uploadBinary<{ ok: boolean; item: BackgroundMediaItem }>("/backgrounds/upload", file, mediaType),

  // Config / secrets
  getSettings: () => req<AppSettings>("/settings"),
  putSettings: (partial: any) => put("/settings", partial),
  startupStatus: () => req<{ ok: boolean; status: StartupStatus }>("/startup/status"),
  startupRepair: () => post<{ ok: boolean; status: StartupStatus; error?: string }>("/startup/repair"),
  startupRepairElevated: () => post<StartupElevatedRepairResult>("/startup/repair-elevated"),
  secretsStatus: () => req<SecretsStatus>("/secrets/status"),
  putSecrets: (secrets: Record<string, string>) => put("/secrets", secrets),

  // Wallpaper-reported kiritan runtime state (null until the wallpaper posts).
  kiritanState: () => req<{ receivedAt?: string } | null>("/kiritan/state"),

  // Data folder / backup
  dataDir: () => req<{ ok: boolean; path: string }>("/data-dir"),
  exportBackup: (includeSecrets: boolean) =>
    post<{ ok: boolean; path?: string; fileName?: string; error?: string }>("/backup/export", { includeSecrets }),
  importBackup: (bundle: unknown) =>
    post<{ ok: boolean; applied?: string[]; error?: string }>("/backup/import", bundle),

  memos: () => req<Memo[]>("/memos"),
  addMemo: (text: string) => post("/memos", { text }),
  updateMemo: (id: string, patchBody: Partial<Memo>) => patch(`/memos/${id}`, patchBody),
  deleteMemo: (id: string) => del(`/memos/${id}`),

  bookmarks: () => req<Bookmark[]>("/bookmarks"),
  addBookmark: (title: string, url: string, category?: string) =>
    post("/bookmarks", { title, url, category }),
  deleteBookmark: (id: string) => del(`/bookmarks/${id}`),

  // Real data refresh
  timer: () => req<TimerState>("/timer"),
  timerControl: (action: "start" | "pause" | "reset" | "toggle" | "next") =>
    post("/timer/control", { action }),
  news: () => req<NewsItem[]>("/news"),
  newsFeeds: () => req<NewsFeedState[]>("/news/feeds"),
  newsRefresh: () => post<{ ok: boolean; count: number; news: NewsItem[]; newsFeeds: NewsFeedState[]; error?: string }>("/news/refresh"),
  personalNews: () => req<PersonalNewsState>("/personal-news"),
  personalNewsReload: () => post("/personal-news/reload"),
  personalNewsSelect: (scriptId: string) => post("/personal-news/select", { scriptId }),
  personalNewsControl: (
    action: "play" | "pause" | "toggle" | "stop" | "restart" | "nextLine" | "previousLine" | "nextChapter" | "previousChapter" | "setLoop" | "jumpChapter",
    options?: { loopEnabled?: boolean; chapterIndex?: number },
  ) => post("/personal-news/control", { action, ...options }),
  weatherRefresh: () => post("/weather/refresh"),
  spotifyAuthUrl: () => req<{ ok: boolean; authUrl?: string; redirectUri?: string; scope?: string; error?: string }>("/spotify/auth-url"),
  spotifyRefresh: () => post("/spotify/refresh"),
  spotifyControl: (action: string) => post("/spotify/control", { action }),
};
