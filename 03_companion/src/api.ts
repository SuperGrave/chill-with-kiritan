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

const post = (path: string, body?: unknown) =>
  req(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const put = (path: string, body?: unknown) =>
  req(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
const patch = (path: string, body?: unknown) =>
  req(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
const del = (path: string) => req(path, { method: "DELETE" });

// ── Types (mirror Rust models.rs, serde camelCase) ──────────────────────────
export type Todo = {
  id: string; title: string; done: boolean;
  priority?: string; dueAt?: string; createdAt: string; updatedAt: string;
};
export type Memo = {
  id: string; text: string; pinned: boolean; createdAt: string; updatedAt: string;
};
export type Bookmark = {
  id: string; title: string; url: string;
  icon?: string; category?: string; order?: number; createdAt: string; updatedAt: string;
};
export type ChatMessage = {
  id: string; role: "user" | "assistant" | "system"; text: string; createdAt: string;
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
  ai: { provider: string; model: string; systemPrompt: string };
  spotify: { clientId: string };
};
export type SecretsStatus = {
  openai: boolean; google: boolean; spotifyClientSecret: boolean; spotifyRefreshToken: boolean;
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

  // Config / secrets
  getSettings: () => req<AppSettings>("/settings"),
  putSettings: (partial: any) => put("/settings", partial),
  secretsStatus: () => req<SecretsStatus>("/secrets/status"),
  putSecrets: (secrets: Record<string, string>) => put("/secrets", secrets),

  // Data CRUD
  todos: () => req<Todo[]>("/todos"),
  addTodo: (title: string) => post("/todos", { title }),
  updateTodo: (id: string, patchBody: Partial<Todo>) => patch(`/todos/${id}`, patchBody),
  deleteTodo: (id: string) => del(`/todos/${id}`),

  memos: () => req<Memo[]>("/memos"),
  addMemo: (text: string) => post("/memos", { text }),
  updateMemo: (id: string, patchBody: Partial<Memo>) => patch(`/memos/${id}`, patchBody),
  deleteMemo: (id: string) => del(`/memos/${id}`),

  bookmarks: () => req<Bookmark[]>("/bookmarks"),
  addBookmark: (title: string, url: string, category?: string) =>
    post("/bookmarks", { title, url, category }),
  deleteBookmark: (id: string) => del(`/bookmarks/${id}`),

  // Chat
  chatHistory: () => req<ChatMessage[]>("/chat/history"),
  chatSend: (text: string) =>
    post("/chat/send", { text }) as Promise<{ ok: boolean; message?: ChatMessage; error?: string }>,
  chatClear: () => post("/chat/clear"),

  // Real data refresh
  newsRefresh: () => post("/news/refresh"),
  weatherRefresh: () => post("/weather/refresh"),
  spotifyAuthUrl: () => req<{ ok: boolean; authUrl?: string; redirectUri?: string; scope?: string; error?: string }>("/spotify/auth-url"),
  spotifyRefresh: () => post("/spotify/refresh"),
  spotifyControl: (action: string) => post("/spotify/control", { action }),
};
