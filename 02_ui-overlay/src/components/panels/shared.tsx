import React from 'react';

// Same chip vocabulary as the weather panel's SOURCE badge,
// shared so every panel footer speaks the same language.

type BadgeTone = 'ok' | 'warn' | 'error' | 'neutral';

// -webkit-box clamp, same pattern WeatherDetailPanel uses for the note text.
// lines <= 0 means no clamping.
export const clampLines = (lines: number): React.CSSProperties =>
  lines > 0
    ? {
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }
    : {};

export const formatTimeHM = (iso?: string): string => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
};

const TONE_COLORS: Record<BadgeTone, { bg: string; border: string; color?: string }> = {
  ok: { bg: 'rgba(0, 255, 0, 0.15)', border: 'rgba(0, 255, 0, 0.3)' },
  warn: { bg: 'rgba(255, 100, 0, 0.15)', border: 'rgba(255, 100, 0, 0.3)' },
  error: { bg: 'rgba(255, 77, 77, 0.15)', border: 'rgba(255, 77, 77, 0.4)', color: 'rgba(255, 150, 150, 0.95)' },
  neutral: { bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.25)' },
};

export const StatusBadge: React.FC<{ tone?: BadgeTone; children: React.ReactNode }> = ({
  tone = 'neutral',
  children,
}) => {
  const c = TONE_COLORS[tone];
  return (
    <span
      style={{
        fontSize: '0.8em',
        padding: '2px 6px',
        borderRadius: '4px',
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.color,
        letterSpacing: '0.1em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};
