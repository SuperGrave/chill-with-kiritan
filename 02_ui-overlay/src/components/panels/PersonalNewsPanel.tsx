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
  const lineText = stripSupplementMarkers(line.text) || script.title;
  const lineDurationMs = Math.max(line.durationMs || 1, 1);
  const scrollSpeed = Math.max(s.personalNewsScrollSpeed ?? 1, 0.2);
  const marqueeSeconds = clamp((lineDurationMs / 1000) / scrollSpeed, 2, 180);
  const marqueeDelay = -Math.max(0, live.lineElapsedMs / 1000 / scrollSpeed);
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
        <div className="personal-news-marquee-shell continuous">
          <div
            key={`${script.id}-${line.id}-${live.lineIndex}`}
            className="personal-news-marquee"
            style={{
              animationDuration: `${marqueeSeconds}s`,
              animationDelay: `${marqueeDelay}s`,
              animationIterationCount: 'infinite',
              animationPlayState: live.status === 'playing' ? 'running' : 'paused',
              fontSize: `${s.personalNewsBodySize}px`,
            }}
          >
            {lineText}
          </div>
        </div>
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
              {' · '}LINE {String(live.lineIndex + 1).padStart(3, '0')}/{String(script.lines.length).padStart(3, '0')}
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
