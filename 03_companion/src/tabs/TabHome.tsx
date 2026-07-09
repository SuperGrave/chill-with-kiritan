import { useEffect, useState, type ReactNode } from "react";
import { api, type TimerState, type UiState } from "../api";
import {
  BookmarkIcon,
  CloudIcon,
  MemoIcon,
  MusicIcon,
  RefreshIcon,
  StatusIcon,
} from "../icons";
import { uiSettings as defaultSettings } from "../../../02_ui-overlay/src/config/uiSettings";

type PanelSwitch = {
  section: string;
  keyName: string;
  label: string;
  note: string;
  icon: ReactNode;
};

const PANEL_SWITCHES: PanelSwitch[] = [
  { section: "clock", keyName: "showClock", label: "時計", note: "日時パネル", icon: <StatusIcon /> },
  { section: "weatherCompact", keyName: "showCompactWeather", label: "天気", note: "地域情報", icon: <CloudIcon /> },
  { section: "newsPanel", keyName: "show", label: "ニュース", note: "RSS見出し", icon: <BookmarkIcon /> },
  { section: "musicPanel", keyName: "show", label: "音楽", note: "Spotify", icon: <MusicIcon /> },
  { section: "lyricsPanel", keyName: "show", label: "歌詞", note: "同期歌詞", icon: <MusicIcon /> },
  { section: "personalNewsPanel", keyName: "show", label: "個人ニュース", note: "読み上げ原稿", icon: <BookmarkIcon /> },
  { section: "memoPanel", keyName: "show", label: "メモ", note: "固定メモ", icon: <MemoIcon /> },
  { section: "timerPanel", keyName: "show", label: "タイマー", note: "Pomodoro", icon: <StatusIcon /> },
];

const mergedSettings = (ui: UiState | null) => ({
  ...defaultSettings,
  ...(ui?.settings ?? {}),
});

const formatMs = (ms: number) => {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  return `${minutes}分`;
};

function timerTitle(timer: TimerState | null, settings: any): string {
  if (!timer) return "Pomodoro";
  if (timer.mode === "timer") return settings.timerTitle ?? "Countdown";
  if (timer.phase === "shortBreak") return settings.shortBreakTitle ?? "Rest";
  if (timer.phase === "longBreak") return settings.longBreakTitle ?? "Long Rest";
  return settings.focusTitle ?? "Pomodoro";
}

function timerLabel(timer: TimerState | null, settings: any): string {
  if (!timer) return "IDLE";
  if (timer.mode === "timer") return settings.timerLabel ?? "TIMER";
  if (timer.phase === "shortBreak") return settings.shortBreakLabel ?? "BREAK";
  if (timer.phase === "longBreak") return settings.longBreakLabel ?? "LONG BREAK";
  return settings.focusLabel ?? "FOCUS";
}

export default function TabHome() {
  const [ui, setUi] = useState<UiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [version, setVersion] = useState("");

  const load = async () => {
    try {
      const [health, next, state] = await Promise.all([
        api.health().catch(() => null),
        api.getUi(),
        api.timer().catch(() => null),
      ]);
      setVersion(health?.version ?? "");
      setUi(next);
      if (state) setTimer(state);
      setError(null);
    } catch {
      setError("表示設定APIに接続できませんでした");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(async () => {
      try {
        setTimer(await api.timer());
      } catch {
        // Home toggles remain usable even if the timer poll misses once.
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const togglePanel = async (item: PanelSwitch) => {
    const current = mergedSettings(ui);
    const section = { ...(current[item.section] ?? {}) };
    const visible = section[item.keyName] !== false;
    const nextSettings = {
      ...current,
      [item.section]: {
        ...section,
        [item.keyName]: !visible,
      },
    };
    const nextUi = await api.putUi(ui?.layout ?? {}, nextSettings) as UiState;
    setUi(nextUi);
    setStatus(`${item.label}を${visible ? "非表示" : "表示"}にしました`);
  };

  const settings = mergedSettings(ui);
  const timerSettings = settings.timerPanel ?? {};
  const timerRunning = timer?.status === "running";

  const controlTimer = async (action: "start" | "pause" | "reset" | "toggle" | "next") => {
    try {
      const result = await api.timerControl(action) as { ok?: boolean; timer?: TimerState };
      if (result.timer) setTimer(result.timer);
      setStatus("タイマーを更新しました");
    } catch {
      setStatus("タイマー操作に失敗しました");
    }
  };

  return (
    <section className="tab-panel home-panel">
      <header className="panel-head">
        <h2>ホーム</h2>
        <span className="panel-sub">{version ? `v${version} / ` : ""}表示の即時切替</span>
      </header>

      {loading && <p className="note">読み込み中…</p>}
      {error && <p className="error-banner">⚠ {error}</p>}

      <div className="home-grid">
        {PANEL_SWITCHES.map((item) => {
          const section = settings[item.section] ?? {};
          const active = section[item.keyName] !== false;
          return (
            <button
              key={`${item.section}.${item.keyName}`}
              type="button"
              className={`home-toggle ${active ? "active" : ""}`}
              onClick={() => { void togglePanel(item); }}
              aria-pressed={active}
            >
              <span className="home-toggle-icon">{item.icon}</span>
              <span className="home-toggle-text">
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </span>
              <span className={`pill ${active ? "ok" : "warn"}`}>{active ? "ON" : "OFF"}</span>
            </button>
          );
        })}
      </div>

      <div className="home-timer-card">
        <div>
          <span className="panel-sub">{timerLabel(timer, timerSettings)} {timer?.mode !== "timer" && timer ? `/ SET ${String(Math.max(1, timer.cycle)).padStart(2, "0")}` : ""}</span>
          <strong>{timerTitle(timer, timerSettings)}</strong>
        </div>
        <div className="home-timer-time">{formatMs(timer?.remainingMs ?? 0)}</div>
        <div className="home-action-row">
          <button type="button" className="secondary-btn" onClick={() => { void controlTimer("toggle"); }}>
            {timerRunning ? "一時停止" : "開始"}
          </button>
          <button type="button" className="secondary-btn" onClick={() => { void controlTimer("reset"); }}>リセット</button>
          <button type="button" className="secondary-btn" onClick={() => { void controlTimer("next"); }}>次へ</button>
        </div>
      </div>

      <button type="button" className="secondary-btn" onClick={() => { void load(); }}>
        <RefreshIcon />
        再読込
      </button>
      {status && <p className="hint">{status}</p>}
    </section>
  );
}
