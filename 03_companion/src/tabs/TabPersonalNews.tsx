import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BookmarkIcon, RefreshIcon } from "../icons";
import { api, type PersonalNewsState, type PersonalNewsSupplement } from "../api";

const formatMs = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const supplementMarkerRegex = () => /\[(Supplement|補足|Source):\s*([^\]]+)\]/gi;

const stripSupplementMarkers = (text: string) =>
  text.replace(supplementMarkerRegex(), "").replace(/\s{2,}/g, " ").trim();

const parseNumberPart = (value: string) => {
  const normalized = value.trim().replace(/s(ec(onds?)?)?$/i, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseSupplementBody = (body: string) => {
  const parts = body.split("|").map((part) => part.trim()).filter(Boolean);
  let durationSeconds = 5;
  let durationIndex = -1;
  const firstSeconds = parts[0] ? parseNumberPart(parts[0]) : null;
  const lastSeconds = parts.length > 1 ? parseNumberPart(parts[parts.length - 1]) : null;
  if (firstSeconds !== null) {
    durationSeconds = firstSeconds;
    durationIndex = 0;
  } else if (lastSeconds !== null) {
    durationSeconds = lastSeconds;
    durationIndex = parts.length - 1;
  }

  const urlIndex = parts.findIndex((part) => /^https?:\/\//i.test(part));
  const textParts = parts.filter((_part, index) => index !== durationIndex && index !== urlIndex);
  const text = textParts.join(" | ") || (urlIndex >= 0 ? parts[urlIndex] : "補足");

  return {
    title: text,
    text,
    url: urlIndex >= 0 ? parts[urlIndex] : undefined,
    durationMs: Math.max(500, Math.round(durationSeconds * 1000)),
  };
};

const chapterIndexForLine = (script: NonNullable<PersonalNewsState["currentScript"]>, lineIndex: number) => {
  let index = 0;
  script.chapters.forEach((chapter, candidate) => {
    if (chapter.lineIndex <= lineIndex) index = candidate;
  });
  return index;
};

const supplementsFromLineMarkers = (script: NonNullable<PersonalNewsState["currentScript"]>): PersonalNewsSupplement[] => {
  const result: PersonalNewsSupplement[] = [];
  script.lines.forEach((line, lineIndex) => {
    const matches = Array.from(line.text.matchAll(supplementMarkerRegex()));
    matches.forEach((match, markerIndex) => {
      const parsed = parseSupplementBody(match[2] ?? "");
      const offsetRatio = Math.min(Math.max((match.index ?? 0) / Math.max(line.text.length, 1), 0), 1);
      result.push({
        id: `marker_${line.id}_${markerIndex}`,
        title: parsed.title,
        text: parsed.text,
        url: parsed.url,
        lineIndex,
        chapterIndex: chapterIndexForLine(script, lineIndex),
        positionMs: (line.positionMs ?? 0) + Math.round((line.durationMs ?? 0) * offsetRatio),
        durationMs: parsed.durationMs,
      });
    });
  });
  return result;
};

const currentLineText = (state: PersonalNewsState | null) => {
  const script = state?.currentScript;
  if (!script || script.lines.length === 0) return "原稿が読み込まれていません";
  const line = script.lines[Math.min(state.lineIndex, script.lines.length - 1)];
  const text = stripSupplementMarkers(line?.text ?? "");
  if (line?.kind === "wait" || line?.kind === "source") {
    return "本文は連続スクロール中です";
  }
  return text || "本文は連続スクロール中です";
};

const supplementsFor = (state: PersonalNewsState | null): PersonalNewsSupplement[] => {
  const script = state?.currentScript;
  if (!script) return [];
  if (script.supplements && script.supplements.length > 0) return script.supplements;
  const inlineSupplements = supplementsFromLineMarkers(script);
  if (inlineSupplements.length > 0) return inlineSupplements;
  return script.sources.map((source) => ({
    id: source.id,
    title: source.title,
    text: source.title,
    url: source.url,
    lineIndex: source.lineIndex,
    chapterIndex: source.chapterIndex,
    positionMs: source.positionMs,
    durationMs: 5000,
  }));
};

const currentSupplement = (state: PersonalNewsState | null, supplements: PersonalNewsSupplement[]) => {
  const elapsed = state?.elapsedMs ?? 0;
  let current: PersonalNewsSupplement | null = null;
  for (const item of supplements) {
    if (elapsed >= item.positionMs && elapsed < item.positionMs + Math.max(item.durationMs, 1)) {
      current = item;
    }
  }
  return current;
};

export default function TabPersonalNews() {
  const [state, setState] = useState<PersonalNewsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setState(await api.personalNews());
      setError(null);
    } catch {
      setError("個人ニュースAPIに接続できませんでした");
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, []);

  const script = state?.currentScript ?? null;
  const currentChapter = useMemo(() => {
    if (!script || !state) return null;
    let chapter = script.chapters[0] ?? null;
    for (const item of script.chapters) {
      if (item.lineIndex <= state.lineIndex) chapter = item;
    }
    return chapter;
  }, [script, state]);
  const supplements = useMemo(() => supplementsFor(state), [state]);
  const supplement = useMemo(() => currentSupplement(state, supplements), [state, supplements]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const res: any = await fn();
      if (res?.personalNews) setState(res.personalNews);
      else await load();
      setError(null);
    } catch {
      setError("操作に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const selectScript = (scriptId: string) => run(() => api.personalNewsSelect(scriptId));
  const control = (action: Parameters<typeof api.personalNewsControl>[0], loopEnabled?: boolean) =>
    run(() => api.personalNewsControl(action, loopEnabled === undefined ? undefined : { loopEnabled }));
  const jumpChapter = (chapterIndex: number) =>
    run(() => api.personalNewsControl("jumpChapter", { chapterIndex }));

  const playing = state?.status === "playing";

  return (
    <section className="tab-panel personal-news-tab">
      <header className="panel-head">
        <h2>個人ニュース</h2>
        <span className="panel-sub">原稿選択・再生操作</span>
      </header>

      {error && <p className="error-banner">⚠ {error}</p>}
      {state?.error && <p className="error-banner">⚠ {state.error}</p>}

      <div className="settings-group">
        <div className="group-head">
          <span className="group-icon"><BookmarkIcon /></span>
          <h3>原稿</h3>
        </div>
        <label className="field">
          <span>読み込みフォルダ</span>
          <input className="mono" readOnly value={state?.scriptDir ?? ""} />
        </label>
        <label className="field">
          <span>原稿ファイル</span>
          <select
            value={state?.selectedScriptId ?? ""}
            onChange={(e) => { void selectScript(e.target.value); }}
            disabled={busy || !state?.scripts.length}
          >
            <option value="">未選択</option>
            {state?.scripts.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => run(api.personalNewsReload)}>
          <RefreshIcon />
          原稿を再読込
        </button>
      </div>

      <div className="personal-news-now">
        <div>
          <span className="panel-sub">{currentChapter?.title ?? "NO TOPIC"}</span>
          <strong>{script?.title ?? "Personal News"}</strong>
        </div>
        <span className={`pill ${playing ? "ok" : state?.status === "error" ? "err" : "warn"}`}>{state?.status?.toUpperCase() ?? "OFFLINE"}</span>
        <p>{currentLineText(state)}</p>
        <p className="panel-sub">補足: {supplement?.text ?? "なし"}</p>
        <div className="personal-news-time-row">
          <span>{formatMs(state?.elapsedMs ?? 0)}</span>
          <span>{String((state?.currentChapterIndex ?? 0) + 1).padStart(2, "0")} / {String(script?.chapters.length ?? 0).padStart(2, "0")}</span>
          <span>{formatMs(state?.durationMs ?? 0)}</span>
        </div>
      </div>

      <div className="personal-news-controls">
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => control("restart")}>最初から</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => control("previousChapter")}>前章</button>
        <button type="button" className="primary-btn" disabled={busy} onClick={() => control("toggle")}>{playing ? "一時停止" : "再生"}</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => control("nextChapter")}>次章</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => control("stop")}>停止</button>
      </div>

      <button
        type="button"
        className={`home-toggle ${state?.loopEnabled ? "active" : ""}`}
        onClick={() => control("setLoop", !(state?.loopEnabled ?? false))}
        onDoubleClick={(e) => e.preventDefault()}
      >
        <span className="home-toggle-icon"><RefreshIcon /></span>
        <span className="home-toggle-text">
          <strong>リピート</strong>
          <small>最後まで行ったら最初に戻る</small>
        </span>
        <span className={`pill ${state?.loopEnabled ? "ok" : "warn"}`}>{state?.loopEnabled ? "ON" : "OFF"}</span>
      </button>

      {script && script.chapters.length > 0 && (
        <div className="settings-group">
          <div className="group-head"><h3>チャプター</h3></div>
          <div className="personal-news-list">
            {script.chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                type="button"
                className={`personal-news-list-item ${currentChapter?.id === chapter.id ? "active" : ""}`}
                onClick={() => { void jumpChapter(index); }}
                disabled={busy}
              >
                <span>{chapter.title}</span>
                <small>{formatMs(chapter.positionMs)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {script && supplements.length > 0 && (
        <div className="settings-group">
          <div className="group-head"><h3>補足</h3></div>
          <div className="personal-news-list">
            {supplements.map((item) => (
              <button
                key={item.id}
                type="button"
                className="personal-news-list-item"
                onClick={() => { if (item.url) void openUrl(item.url); }}
                disabled={!item.url}
              >
                <span>{item.text}</span>
                <small>{formatMs(item.positionMs)} / {formatMs(item.durationMs)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
