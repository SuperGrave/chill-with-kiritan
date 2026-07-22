import React from 'react';
import type { PersonalNewsState, PersonalNewsScript, PersonalNewsSupplement } from '../../types/panels';
import { mockPersonalNews } from '../../data/mockPanels';
import { personalNewsPanelDefaults } from '../../config/uiSettings';
import { StatusBadge } from './shared';

interface PersonalNewsPanelProps {
  personalNews?: PersonalNewsState;
  settings?: any;
  offline?: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const fmtTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const supplementMarkerRegex = () => /\[(Supplement|補足|Source):\s*([^\]]+)\]/gi;

const stripSupplementMarkers = (text: string) =>
  text.replace(supplementMarkerRegex(), '').replace(/\s{2,}/g, ' ').trim();

const parseNumberPart = (value: string) => {
  const normalized = value.trim().replace(/s(ec(onds?)?)?$/i, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseSupplementBody = (body: string) => {
  const parts = body.split('|').map((part) => part.trim()).filter(Boolean);
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
  const text = textParts.join(' | ') || (urlIndex >= 0 ? parts[urlIndex] : '補足');

  return {
    title: text,
    text,
    url: urlIndex >= 0 ? parts[urlIndex] : undefined,
    durationMs: Math.max(500, Math.round(durationSeconds * 1000)),
  };
};

const chapterIndexForLine = (script: PersonalNewsScript, lineIndex: number) => {
  let index = 0;
  script.chapters.forEach((chapter, candidate) => {
    if (chapter.lineIndex <= lineIndex) index = candidate;
  });
  return index;
};

const supplementsFromLineMarkers = (script: PersonalNewsScript): PersonalNewsSupplement[] => {
  const result: PersonalNewsSupplement[] = [];
  script.lines.forEach((line, lineIndex) => {
    const matches = Array.from(line.text.matchAll(supplementMarkerRegex()));
    matches.forEach((match, markerIndex) => {
      const parsed = parseSupplementBody(match[2] ?? '');
      const offsetRatio = clamp((match.index ?? 0) / Math.max(line.text.length, 1), 0, 1);
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

const materialize = (state: PersonalNewsState, now: number) => {
  const script = state.currentScript;
  if (!script || script.lines.length === 0) {
    return { lineIndex: 0, lineElapsedMs: 0, elapsedMs: 0, status: state.status };
  }

  let lineIndex = clamp(state.lineIndex ?? 0, 0, script.lines.length - 1);
  let lineElapsedMs = state.lineElapsedMs ?? 0;
  let status = state.status;

  if (status === 'playing') {
    const startedAt = state.lineStartedAt ? Date.parse(state.lineStartedAt) : Number.NaN;
    if (Number.isFinite(startedAt)) {
      lineElapsedMs += Math.max(0, now - startedAt);
    }
    while (lineElapsedMs >= script.lines[lineIndex].durationMs && status === 'playing') {
      lineElapsedMs -= Math.max(script.lines[lineIndex].durationMs, 1);
      lineIndex += 1;
      if (lineIndex >= script.lines.length) {
        if (state.loopEnabled) {
          lineIndex = 0;
        } else {
          lineIndex = script.lines.length - 1;
          lineElapsedMs = script.lines[lineIndex].durationMs;
          status = 'finished';
        }
      }
    }
  }

  const line = script.lines[lineIndex];
  const elapsedMs = clamp((line?.positionMs ?? 0) + lineElapsedMs, 0, script.estimatedDurationMs || state.durationMs || 1);
  return { lineIndex, lineElapsedMs, elapsedMs, status };
};

const currentChapter = (script: PersonalNewsScript, lineIndex: number) => {
  let chapter = script.chapters[0];
  for (const candidate of script.chapters) {
    if (candidate.lineIndex <= lineIndex) chapter = candidate;
  }
  return chapter;
};

const supplementsFor = (script: PersonalNewsScript): PersonalNewsSupplement[] => {
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
    durationMs: 5_000,
  }));
};

const activeSupplement = (supplements: PersonalNewsSupplement[], elapsedMs: number) => {
  let current: PersonalNewsSupplement | null = null;
  for (const item of supplements) {
    const start = item.positionMs;
    const end = start + Math.max(item.durationMs, 1);
    if (elapsedMs >= start && elapsedMs < end) current = item;
  }
  return current;
};

interface TickerProps {
  script: PersonalNewsScript;
  /** State-synced current block + elapsed within it, captured at render time. */
  lineIndex: number;
  lineElapsedMs: number;
  playing: boolean;
  loopEnabled: boolean;
  fontSize: number;
}

/** Blocks kept flowing to the left of the current one (≫ shell width of text). */
const TICKER_PREV_KEEP = 12;
/** Blocks pre-rendered to the right of the current one (they sit off-screen
 *  until their timeline slot starts, so the rAF can cross block boundaries
 *  without waiting for the next React render). */
const TICKER_NEXT_KEEP = 2;

// LED-board conveyor ticker (rebuilt 2026-07-19, master FB 文字送りがおかしい).
//
// The old per-block pass — x(t) = shellW − (shellW+textW)·t/dur — had three
// visible defects: (1) each block traveled shellW+textW px in CHAR_MS×chars ms,
// so short blocks FLEW across (the shellW term dominates); (2) textW was padded
// to max(textW, shellW), so short blocks fully exited early and left dead air
// for the rest of their slot; (3) the rAF only extrapolated INSIDE the current
// block, so every block boundary stalled until the next 250ms React tick, then
// snapped.
//
// Now the blocks ride one continuous conveyor, head-to-tail with a ◆ separator:
// during block k, the conveyor advances by exactly w_k (that block's rendered
// width) over its timeline slot dur_k, i.e. block k's head crosses the shell's
// right edge exactly when its slot starts. Because dur_k = CHAR_MS×chars and
// w_k ≈ fontSize×chars for CJK text, the pixel speed stays near-constant across
// blocks; the shell stays full of flowing text (no resets, no dead air); and a
// long-duration short block (explicit Wait) simply slows the conveyor down.
// The rAF advances across block boundaries itself (the next blocks' spans are
// pre-rendered off-screen right), so boundaries are seamless; the 250ms React
// tick only re-anchors to the companion timeline and shifts the render window.
const PersonalNewsTicker: React.FC<TickerProps> = ({ script, lineIndex, lineElapsedMs, playing, loopEnabled, fontSize }) => {
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef(new Map<number, HTMLSpanElement>());
  // Anchor from the latest state render; the rAF loop extrapolates between
  // renders on the same wall clock, so re-anchoring is seamless while pause /
  // seek / block changes from the companion snap to the corrected position.
  const anchorRef = React.useRef({ script, lineIndex: 0, lineElapsedMs: 0, at: 0, playing: false, loopEnabled: false });
  React.useLayoutEffect(() => {
    anchorRef.current = { script, lineIndex, lineElapsedMs, at: performance.now(), playing, loopEnabled };
  }, [script, lineIndex, lineElapsedMs, playing, loopEnabled]);

  // Looping scripts use virtual slots outside 0..N-1.  For example, after the
  // last real block, slot N renders block 0 again.  Keeping those clones in the
  // same flex row is what lets the conveyor cross the loop seam without
  // briefly replaying/parking the final block until the next React state tick.
  const windowStart = loopEnabled ? lineIndex - TICKER_PREV_KEEP : Math.max(0, lineIndex - TICKER_PREV_KEEP);
  const windowEnd = loopEnabled ? lineIndex + TICKER_NEXT_KEEP : Math.min(script.lines.length - 1, lineIndex + TICKER_NEXT_KEEP);

  const place = React.useCallback(() => {
    const shell = shellRef.current;
    const row = rowRef.current;
    if (!shell || !row) return;
    const a = anchorRef.current;
    const lines = a.script.lines;
    if (lines.length === 0) return;

    // Advance (block, elapsed) across the script on the extrapolated clock —
    // the same walk materialize() does, kept here so boundaries never wait for
    // a React tick.
    let idx = clamp(a.lineIndex, 0, lines.length - 1);
    let slot = idx;
    let elapsed = a.lineElapsedMs + (a.playing ? performance.now() - a.at : 0);
    let guard = lines.length + 1;
    while (elapsed >= Math.max(lines[idx].durationMs || 1, 1) && guard-- > 0) {
      elapsed -= Math.max(lines[idx].durationMs || 1, 1);
      idx += 1;
      slot += 1;
      if (idx >= lines.length) {
        if (a.loopEnabled) {
          idx = 0;
        } else {
          idx = lines.length - 1;
          elapsed = Math.max(lines[idx].durationMs || 1, 1);
          break;
        }
      }
    }

    // Only blocks inside the rendered window can be measured; if the rAF ran
    // ahead of React (rare — two blocks inside one 250ms tick, or a loop
    // wrap), park at the window edge until the next render catches up.
    const first = itemRefs.current.get(slot);
    const firstRendered = itemRefs.current.size > 0 ? Math.min(...itemRefs.current.keys()) : slot;
    let head: HTMLSpanElement | undefined = first;
    let frac = clamp(elapsed / Math.max(lines[idx].durationMs || 1, 1), 0, 1);
    if (!first) {
      const last = itemRefs.current.size > 0 ? Math.max(...itemRefs.current.keys()) : -1;
      const parked = itemRefs.current.get(slot > last ? last : firstRendered);
      if (!parked) return;
      head = parked;
      frac = slot > last ? 1 : 0;
    }
    if (!head) return;

    // Conveyor: block k's head sits at the shell's right edge at frac 0 and has
    // advanced by its own width at frac 1 (offsetLeft/offsetWidth are layout-
    // space, unaffected by the transform we write).
    const x = shell.clientWidth - head.offsetLeft - head.offsetWidth * frac;
    row.style.transform = `translate3d(${x}px, 0, 0)`;
  }, []);

  React.useEffect(() => {
    let raf = 0;
    const step = () => {
      place();
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [place]);

  // Re-place synchronously whenever the render window shifts (or the script
  // swaps) so the row never paints one frame at a stale offset.
  React.useLayoutEffect(() => {
    place();
  });

  const items = Array.from({ length: windowEnd - windowStart + 1 }, (_, offset) => {
    const slot = windowStart + offset;
    const i = ((slot % script.lines.length) + script.lines.length) % script.lines.length;
    const line = script.lines[i];
    const text = stripSupplementMarkers(line.text);
    return (
      <span
        key={`${slot}:${line.id ?? i}`}
        className="personal-news-ticker-item"
        ref={(el) => {
          if (el) itemRefs.current.set(slot, el);
          else itemRefs.current.delete(slot);
        }}
      >
        {text || ' '}
        <span className="personal-news-ticker-sep" aria-hidden>
          ◆
        </span>
      </span>
    );
  });

  return (
    <div ref={shellRef} className="personal-news-marquee-shell continuous">
      <div
        ref={rowRef}
        className="personal-news-marquee personal-news-ticker-row"
        style={{
          fontSize: `${fontSize}px`,
          // Pre-rAF fallback: park off the right edge (first place() corrects it).
          transform: 'translate3d(100vw, 0, 0)',
        }}
      >
        {items}
      </div>
    </div>
  );
};

const PersonalNewsPanel: React.FC<PersonalNewsPanelProps> = ({
  personalNews = mockPersonalNews,
  settings,
  offline = false,
}) => {
  const s = { ...personalNewsPanelDefaults, ...settings };
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const script = personalNews.currentScript;

  if (!script || script.lines.length === 0) {
    return (
      <div className="personal-news-panel empty">
        <div className="personal-news-empty">PERSONAL NEWS STANDBY</div>
        {personalNews.error && <div className="personal-news-error">{personalNews.error}</div>}
      </div>
    );
  }

  const live = materialize(personalNews, now);
  const line = script.lines[live.lineIndex] ?? script.lines[0];
  const chapter = currentChapter(script, live.lineIndex);
  const chapterIndex = Math.max(0, script.chapters.findIndex((item) => item.id === chapter?.id));
  const durationMs = script.estimatedDurationMs || personalNews.durationMs || 1;
  const totalProgress = clamp(live.elapsedMs / durationMs, 0, 1);
  // NOTE: personalNewsScrollSpeed is deliberately NOT applied here — timing is
  // owned by the script timeline (CHAR_MS × chars + explicit waits); any
  // display-side speed scaling desyncs the ticker from the companion state
  // (v0.8.6 bug).
  const panelStatus = offline ? 'OFFLINE' : live.status.toUpperCase();
  const supplements = supplementsFor(script);
  const supplement = activeSupplement(supplements, live.elapsedMs);
  const supplementColor = /^#[0-9a-f]{6}$/i.test(s.personalNewsSupplementColor ?? '')
    ? s.personalNewsSupplementColor
    : personalNewsPanelDefaults.personalNewsSupplementColor;

  return (
    <div className="personal-news-panel" style={{
      gap: `${s.personalNewsGap}px`,
      fontFamily: 'var(--font-main)',
    }}>
      {(s.personalNewsShowTitle || s.showStatus) && (
        <div className="personal-news-top" style={{ fontSize: `${s.personalNewsTitleSize}px` }}>
          {s.personalNewsShowTitle && (
            <span className="personal-news-title">{script.title}</span>
          )}
          {s.showStatus && (
            <StatusBadge tone={live.status === 'playing' ? 'ok' : live.status === 'error' ? 'error' : 'neutral'}>
              {panelStatus}
            </StatusBadge>
          )}
        </div>
      )}

      {s.personalNewsShowTopic && (
        <div className="personal-news-topic" style={{ fontSize: `${s.personalNewsTopicSize}px` }}>
          <span className="personal-news-topic-caret">▸</span>
          <span>{chapter?.title ?? line.topic ?? 'Personal News'}</span>
        </div>
      )}

      {s.personalNewsShowBody && (
        <PersonalNewsTicker
          script={script}
          lineIndex={live.lineIndex}
          lineElapsedMs={live.lineElapsedMs}
          playing={live.status === 'playing'}
          loopEnabled={personalNews.loopEnabled === true}
          fontSize={s.personalNewsBodySize}
        />
      )}

      {s.personalNewsShowSource && (
        <div
          className={`personal-news-supplement ${supplement ? 'visible' : ''}`}
          style={{ fontSize: `${s.personalNewsSourceSize}px`, color: supplementColor }}
        >
          {supplement ? supplement.text : '\u00a0'}
        </div>
      )}

      {s.personalNewsShowProgress && (
        <div className="personal-news-progress-block">
          <div className="personal-news-progress-meta" style={{ fontSize: `${s.personalNewsSourceSize}px` }}>
            <span>{fmtTime(live.elapsedMs)}</span>
            <span>
              CH {String(chapterIndex + 1).padStart(2, '0')}/{String(script.chapters.length).padStart(2, '0')}
              {' · '}BLOCK {String(live.lineIndex + 1).padStart(3, '0')}/{String(script.lines.length).padStart(3, '0')}
            </span>
            <span>{fmtTime(durationMs)}</span>
          </div>
          <div className="personal-news-progress" style={{ height: `${s.personalNewsProgressHeight}px` }}>
            <span className="personal-news-progress-fill" style={{ width: `${totalProgress * 100}%` }} />
            <span className="personal-news-progress-line" style={{ left: `${totalProgress * 100}%` }} />
            {s.personalNewsShowChapterMarks && script.chapters.map((item) => (
              <span
                key={item.id}
                className="personal-news-progress-mark chapter"
                style={{ left: `${clamp(item.positionMs / durationMs, 0, 1) * 100}%` }}
                title={item.title}
              />
            ))}
            {s.personalNewsShowChapterMarks && supplements.map((item) => (
              <span
                key={item.id}
                className={`personal-news-progress-mark ${item.url ? 'source' : 'supplement'}`}
                style={{ left: `${clamp(item.positionMs / durationMs, 0, 1) * 100}%` }}
                title={item.title}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalNewsPanel;
