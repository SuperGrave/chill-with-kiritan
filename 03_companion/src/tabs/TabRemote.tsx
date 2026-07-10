import { useEffect, useState, type ReactNode } from "react";
import { api, type KiritanRuntimeState, type TimerState, type UiState } from "../api";
import { Button, Card, IconButton, Pill, ToggleTile } from "../controls";
import {
  BroadcastIcon,
  ClockIcon,
  CloudIcon,
  LyricsIcon,
  MemoIcon,
  MusicIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  RssIcon,
  TimerIcon,
} from "../icons";
import { uiSettings as defaultSettings } from "../../../02_ui-overlay/src/config/uiSettings";

type PanelSwitch = { section: string; keyName: string; label: string; icon: ReactNode };

const PANELS: PanelSwitch[] = [
  { section: "clock", keyName: "showClock", label: "時計", icon: <ClockIcon /> },
  { section: "weatherCompact", keyName: "showCompactWeather", label: "天気", icon: <CloudIcon /> },
  { section: "newsPanel", keyName: "show", label: "ニュース", icon: <RssIcon /> },
  { section: "musicPanel", keyName: "show", label: "音楽", icon: <MusicIcon /> },
  { section: "lyricsPanel", keyName: "show", label: "歌詞", icon: <LyricsIcon /> },
  { section: "personalNewsPanel", keyName: "show", label: "個人ニュース", icon: <BroadcastIcon /> },
  { section: "memoPanel", keyName: "show", label: "メモ", icon: <MemoIcon /> },
  { section: "timerPanel", keyName: "show", label: "タイマー", icon: <TimerIcon /> },
];

const formatClock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

// ── きりたんは今（壁紙からの kiritan state 報告の可視化） ────────────────────
// 報告が新鮮なら LIVE、古ければ受信停止、無ければ未報告。しぐさ(ambient)は
// 壁紙側の著作済み一式のみ日本語化し、未知のidはそのまま出す。
const KIRITAN_STALE_MS = 90_000;

const AMBIENT_LABELS: Record<string, string> = {
  amb_work_neck_roll: "首を回す",
  amb_work_posture_reset: "姿勢を直す",
  amb_work_stretch: "伸びをする",
  amb_work_screen_scan: "画面を見回す",
  amb_work_sip: "ひと口飲む",
  amb_vid_chuckle: "くすっと笑う",
  amb_vid_nod_watch: "うなずき視聴",
  amb_vid_eyes_widen: "目を見開く",
  amb_slp_head_shift: "頭を動かす",
  amb_slp_dream_smile: "夢見て微笑む",
};

const AWAY_REASON_LABELS: Record<string, string> = {
  leaving: "席を立つところ",
  "out-of-room": "部屋の外",
  returning: "戻ってくるところ",
};

const formatAge = (ms: number | null): string => {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間`;
};

function timerTitle(timer: TimerState | null, s: any): string {
  if (!timer) return "Pomodoro";
  if (timer.mode === "timer") return s.timerTitle ?? "Countdown";
  if (timer.phase === "shortBreak") return s.shortBreakTitle ?? "Rest";
  if (timer.phase === "longBreak") return s.longBreakTitle ?? "Long Rest";
  return s.focusTitle ?? "Pomodoro";
}

function timerLabel(timer: TimerState | null, s: any): string {
  if (!timer) return "IDLE";
  if (timer.mode === "timer") return s.timerLabel ?? "TIMER";
  if (timer.phase === "shortBreak") return s.shortBreakLabel ?? "BREAK";
  if (timer.phase === "longBreak") return s.longBreakLabel ?? "LONG BREAK";
  return s.focusLabel ?? "FOCUS";
}

export default function TabRemote() {
  const [ui, setUi] = useState<UiState | null>(null);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [kiritan, setKiritan] = useState<KiritanRuntimeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = async () => {
    try {
      const [next, state, k] = await Promise.all([
        api.getUi(),
        api.timer().catch(() => null),
        api.kiritanState().catch(() => null),
      ]);
      setUi(next);
      if (state) setTimer(state);
      setKiritan(k);
      setError(null);
    } catch {
      setError("表示設定APIに接続できませんでした");
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(async () => {
      // Toggles stay usable even if a poll misses (per-call catch).
      const [t, k] = await Promise.all([
        api.timer().catch(() => null),
        api.kiritanState().catch(() => null),
      ]);
      if (t) setTimer(t);
      setKiritan(k);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const settings: any = { ...defaultSettings, ...(ui?.settings ?? {}) };
  const timerSettings = settings.timerPanel ?? {};
  const timerRunning = timer?.status === "running";

  const togglePanel = async (item: PanelSwitch) => {
    const section = { ...(settings[item.section] ?? {}) };
    const visible = section[item.keyName] !== false;
    const nextSettings = { ...settings, [item.section]: { ...section, [item.keyName]: !visible } };
    try {
      const nextUi = (await api.putUi(ui?.layout ?? {}, nextSettings)) as UiState;
      setUi(nextUi);
    } catch {
      setError("壁紙への反映に失敗しました");
    }
  };

  const controlTimer = async (action: "toggle" | "reset" | "next") => {
    try {
      const result = (await api.timerControl(action)) as { timer?: TimerState };
      if (result.timer) setTimer(result.timer);
    } catch {
      setStatus("タイマー操作に失敗しました");
    }
  };

  const refresh = async (kind: "weather" | "news" | "all") => {
    setStatus(kind === "all" ? "全データを更新中…" : kind === "weather" ? "天気を更新中…" : "ニュースを更新中…");
    try {
      if (kind === "all") {
        await Promise.allSettled([api.newsRefresh(), api.weatherRefresh(), api.spotifyRefresh()]);
      } else if (kind === "weather") {
        await api.weatherRefresh();
      } else {
        await api.newsRefresh();
      }
      setStatus("更新しました");
    } catch {
      setStatus("更新に失敗しました");
    }
  };

  const cycleLabel =
    timer && timer.mode !== "timer" ? ` · SET ${String(Math.max(1, timer.cycle)).padStart(2, "0")}` : "";

  const kiritanMs = kiritan?.receivedAt ? Date.parse(kiritan.receivedAt) : NaN;
  const kiritanAge = Number.isFinite(kiritanMs) ? Date.now() - kiritanMs : null;
  const kiritanLive = kiritanAge != null && kiritanAge <= KIRITAN_STALE_MS;
  const sinceMs = kiritan?.since ? Date.parse(kiritan.since) : NaN;
  const kiritanSinceMin = Number.isFinite(sinceMs)
    ? Math.max(0, Math.floor((Date.now() - sinceMs) / 60_000))
    : null;
  const ambientLabel = kiritan?.ambient?.id
    ? AMBIENT_LABELS[kiritan.ambient.id] ?? kiritan.ambient.id
    : null;
  const awayLabel =
    kiritan?.presence === "away"
      ? kiritan.away?.reason
        ? AWAY_REASON_LABELS[kiritan.away.reason] ?? kiritan.away.reason
        : "離席中"
      : null;
  const sleepinessPct =
    typeof kiritan?.sleepiness === "number" ? Math.round(kiritan.sleepiness * 100) : null;

  return (
    <section className="tab-panel">
      {error && <p className="error-banner">⚠ {error}</p>}

      <Card className="remote-kiritan">
        <div className="remote-kiritan-head">
          <span className="eyebrow">きりたんは今</span>
          <Pill tone={kiritanLive ? "ok" : "warn"}>
            {kiritanLive ? "LIVE" : kiritan ? "受信停止" : "未報告"}
          </Pill>
        </div>
        {kiritan ? (
          <div className="remote-kiritan-body">
            <strong className="remote-kiritan-main">
              {kiritan.modeLabel ?? kiritan.mode}
              {kiritan.presence === "away" ? "（離席）" : ""}
            </strong>
            <span className="remote-kiritan-sub">
              {kiritanSinceMin != null && <span>{kiritanSinceMin}分経過</span>}
              {ambientLabel && <span>しぐさ: {ambientLabel}</span>}
              {awayLabel && <span>{awayLabel}</span>}
              {sleepinessPct != null && sleepinessPct > 0 && <span>眠気 {sleepinessPct}%</span>}
              <span>受信 {formatAge(kiritanAge)}前</span>
            </span>
          </div>
        ) : (
          <p className="remote-kiritan-empty">
            壁紙からの報告がまだありません。壁紙の起動と models/kiritan.vrm の配置を確認してください。
          </p>
        )}
      </Card>

      <div className="sec-label">パネル表示</div>
      <div className="remote-tiles">
        {PANELS.map((item) => {
          const section = settings[item.section] ?? {};
          const on = section[item.keyName] !== false;
          return (
            <ToggleTile
              key={`${item.section}.${item.keyName}`}
              icon={item.icon}
              name={item.label}
              on={on}
              onClick={() => { void togglePanel(item); }}
            />
          );
        })}
      </div>

      <div className="remote-two">
        <Card className="remote-timer">
          <div className="remote-timer-meta">
            <span className="eyebrow">{timerLabel(timer, timerSettings)}{cycleLabel}</span>
            <strong>{timerTitle(timer, timerSettings)}</strong>
          </div>
          <div className="remote-readout">{formatClock(timer?.remainingMs ?? 0)}</div>
          <div className="remote-transport">
            <IconButton
              size="lg"
              label={timerRunning ? "一時停止" : "開始"}
              icon={timerRunning ? <PauseIcon /> : <PlayIcon />}
              onClick={() => { void controlTimer("toggle"); }}
            />
            <IconButton label="リセット" icon={<RefreshIcon />} onClick={() => { void controlTimer("reset"); }} />
            <IconButton label="次へ" icon={<NextIcon />} onClick={() => { void controlTimer("next"); }} />
          </div>
        </Card>

        <Card className="remote-refresh">
          <span className="eyebrow">いま更新</span>
          <div className="remote-refresh-btns">
            <Button onClick={() => { void refresh("weather"); }}><CloudIcon />天気</Button>
            <Button onClick={() => { void refresh("news"); }}><RssIcon />ニュース</Button>
            <Button onClick={() => { void refresh("all"); }}><RefreshIcon />全部</Button>
          </div>
          {status && <p className="remote-status">{status}</p>}
        </Card>
      </div>
    </section>
  );
}
