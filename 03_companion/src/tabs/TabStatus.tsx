import { useEffect, useState } from "react";
import { RefreshIcon } from "../icons";
import { api } from "../api";

type Pill = { tone: "ok" | "err" | "warn"; text: string };
type KiritanStatus = {
  mode?: string;
  modeLabel?: string;
  receivedAt?: string;
  presence?: "present" | "away";
};

const WALLPAPER_STALE_MS = 90_000;

function formatAge(ms: number | null): string {
  if (ms == null || ms < 0) return "不明";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}分`;
  const hr = Math.round(min / 60);
  return `${hr}時間`;
}

function StatusRow({ label, pill, value }: { label: string; pill?: Pill; value?: string }) {
  return (
    <div className="status-row">
      <span className="status-label">{label}</span>
      {pill ? (
        <span className={`pill ${pill.tone}`}>{pill.text}</span>
      ) : (
        <span className="status-value">{value ?? "—"}</span>
      )}
    </div>
  );
}

export default function TabStatus() {
  const [health, setHealth] = useState<{ ok: boolean; version: string } | null>(null);
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ts, setTs] = useState("");

  const check = async () => {
    try {
      const [h, s] = await Promise.all([api.health(), api.state()]);
      setHealth(h);
      setState(s);
      setError(null);
    } catch (e: any) {
      setHealth(null);
      setState(null);
      setError(String(e));
    }
    setTs(new Date().toLocaleTimeString("ja-JP"));
  };

  // Manual refresh of live data sources.
  const refreshData = async () => {
    await Promise.allSettled([api.newsRefresh(), api.weatherRefresh(), api.spotifyRefresh()]);
    check();
  };

  useEffect(() => {
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const spotify = state?.spotify;
  const ai = state?.ai;
  const weather = state?.weather;
  const news = state?.news ?? [];
  const ui = state?.ui;
  const kiritan = state?.kiritan as KiritanStatus | undefined;
  const kiritanReceivedMs = kiritan?.receivedAt ? Date.parse(kiritan.receivedAt) : NaN;
  const kiritanAgeMs = Number.isFinite(kiritanReceivedMs) ? Date.now() - kiritanReceivedMs : null;

  const spotifyPill: Pill =
    spotify?.status === "playing" ? { tone: "ok", text: "再生中" }
    : spotify?.status === "paused" ? { tone: "warn", text: "一時停止" }
    : spotify?.status === "error" ? { tone: "err", text: "エラー" }
    : spotify?.status === "idle" ? { tone: "warn", text: "停止中" }
    : { tone: "warn", text: "未接続" };

  const aiPill: Pill =
    !ai || ai.provider === "none" ? { tone: "warn", text: "none" }
    : ai.status === "error" ? { tone: "err", text: `${ai.provider} (エラー)` }
    : { tone: "ok", text: ai.provider };

  const weatherPill: Pill =
    weather?.source === "live" ? { tone: "ok", text: "live" } : { tone: "warn", text: "mock" };

  const hasLiveUi = !!ui?.settings && Object.keys(ui.settings).length > 0;
  const overlayPill: Pill = hasLiveUi
    ? { tone: "ok", text: "同期中" }
    : { tone: "warn", text: "未同期" };

  const wallpaperPill: Pill =
    kiritanAgeMs != null && kiritanAgeMs <= WALLPAPER_STALE_MS ? { tone: "ok", text: "接続中" }
    : kiritan ? { tone: "warn", text: "受信停止" }
    : { tone: "warn", text: "未報告" };

  const kiritanMode = kiritan?.modeLabel ?? kiritan?.mode ?? "—";
  const kiritanPresence = kiritan?.presence === "away" ? "離席" : "在席";
  const kiritanReceivedAt = kiritan?.receivedAt
    ? new Date(kiritan.receivedAt).toLocaleTimeString("ja-JP")
    : "—";

  return (
    <section className="tab-panel">
      <header className="panel-head">
        <h2>ステータス</h2>
        <span className="panel-sub">5秒ごとに自動確認</span>
      </header>

      <div className="status-list">
        <StatusRow label="HTTP API"
          pill={health?.ok ? { tone: "ok", text: "稼働中" } : { tone: "err", text: "オフライン" }} />
        <StatusRow label="Version" value={health?.version} />
        <StatusRow label="Wallpaper" pill={wallpaperPill} />
        {kiritan && <StatusRow label="きりたん" value={`${kiritanMode} / ${kiritanPresence}`} />}
        {kiritan && <StatusRow label="最終受信" value={`${kiritanReceivedAt} (${formatAge(kiritanAgeMs)}前)`} />}
        <StatusRow label="Overlay UI" pill={overlayPill} />
        <StatusRow label="Spotify" pill={spotifyPill} />
        {spotify?.track && <StatusRow label="再生中" value={`${spotify.track.title} / ${spotify.track.artist}`} />}
        <StatusRow label="AI Provider" pill={aiPill} />
        <StatusRow label="Weather Source" pill={weatherPill} />
        {weather?.current && <StatusRow label="気温" value={`${Math.round(weather.current.temperature)}°C (${weather.current.location})`} />}
        <StatusRow label="News" value={`${news.length} 件`} />
      </div>

      {error && <p className="error-banner">⚠ {error}</p>}

      <div className="status-footer">
        <span className="ts">最終確認: {ts}</span>
        <button onClick={refreshData} className="secondary-btn">
          <RefreshIcon />
          データ更新
        </button>
      </div>
    </section>
  );
}
