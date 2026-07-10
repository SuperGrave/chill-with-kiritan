import { useEffect, useState, type ReactNode } from "react";
import "./App.css";
import TabRemote from "./tabs/TabRemote";
import TabContent from "./tabs/TabContent";
import TabDisplay from "./tabs/TabDisplay";
import TabSettings from "./tabs/TabSettings";
import { api } from "./api";
import { HomeIcon, LayersIcon, SettingsIcon, GearIcon, RefreshIcon } from "./icons";

type Section = "remote" | "content" | "studio" | "system";
type Tone = "ok" | "warn" | "err";

const WALLPAPER_STALE_MS = 90_000;

const SECTIONS: { id: Section; title: string; sub: string; label: string; icon: ReactNode }[] = [
  { id: "remote",  title: "REMOTE",  sub: "状態と毎日の操作",       label: "操作", icon: <HomeIcon /> },
  { id: "content", title: "CONTENT", sub: "メモ・リンク・ニュース", label: "中身", icon: <LayersIcon /> },
  { id: "studio",  title: "STUDIO",  sub: "壁紙の見た目を調律",     label: "調律", icon: <SettingsIcon /> },
  { id: "system",  title: "SYSTEM",  sub: "環境とバックアップ",     label: "環境", icon: <GearIcon /> },
];

// 接続状態はどのセクションでもヘッダーに常設する（旧 Status タブの常設化）。
function useStatus() {
  const [health, setHealth] = useState<{ ok: boolean; version: string } | null>(null);
  const [state, setState] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const [h, s] = await Promise.all([api.health().catch(() => null), api.state().catch(() => null)]);
      if (!alive) return;
      setHealth(h);
      setState(s);
    };
    check();
    const id = window.setInterval(check, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  return { health, state };
}

function StatusDots({ health, state }: { health: { ok: boolean } | null; state: any }) {
  const spotify = state?.spotify;
  const weather = state?.weather;
  const kiritan = state?.kiritan;
  const kiritanMs = kiritan?.receivedAt ? Date.parse(kiritan.receivedAt) : NaN;
  const kiritanAge = Number.isFinite(kiritanMs) ? Date.now() - kiritanMs : null;

  const dots: { label: string; tone: Tone }[] = [
    { label: "API", tone: health?.ok ? "ok" : "err" },
    { label: "壁紙", tone: kiritanAge != null && kiritanAge <= WALLPAPER_STALE_MS ? "ok" : "warn" },
    { label: "天気", tone: weather?.source === "live" ? "ok" : "warn" },
    {
      label: "Spotify",
      tone: spotify?.status === "playing" ? "ok" : spotify?.status === "error" ? "err" : "warn",
    },
  ];

  return (
    <div className="status-dots" aria-label="接続状態">
      {dots.map((d) => (
        <span className="sdot" key={d.label}><i className={d.tone} />{d.label}</span>
      ))}
    </div>
  );
}

function App() {
  const [active, setActive] = useState<Section>("remote");
  const { health, state } = useStatus();
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  const refreshAll = async () => {
    await Promise.allSettled([api.newsRefresh(), api.weatherRefresh(), api.spotifyRefresh()]);
  };

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-top">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`rail-btn ${active === s.id ? "active" : ""}`}
              onClick={() => setActive(s.id)}
              aria-pressed={active === s.id}
              aria-label={s.label}
              title={s.label}
            >
              {s.icon}
            </button>
          ))}
        </div>
        <div className="rail-bottom">
          <button className="rail-btn" onClick={() => { void refreshAll(); }} title="全データを更新" aria-label="更新">
            <RefreshIcon />
          </button>
          {/* /api/health is the single version source (Cargo.toml) — no hardcoded
              fallback string to forget at release time; show a dash until it loads. */}
          <div className="rail-ver">{health?.version ? `v${health.version}` : "—"}</div>
        </div>
      </nav>

      <div className="main">
        <header className="head">
          <div className="head-l">
            <h1 className="head-title">{current.title}</h1>
            <span className="head-sub">{current.sub}</span>
          </div>
          <StatusDots health={health} state={state} />
        </header>

        <main className="content">
          {active === "remote" && <div className="content-page"><TabRemote /></div>}
          {active === "content" && <div className="content-page"><TabContent /></div>}
          {active === "studio" && <div className="content-page"><TabDisplay /></div>}
          {active === "system" && <div className="content-page"><TabSettings showDisplay={false} /></div>}
        </main>
      </div>
    </div>
  );
}

export default App;
