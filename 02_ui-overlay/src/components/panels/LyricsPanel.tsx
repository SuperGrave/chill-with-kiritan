import React from 'react';
import type { SpotifyState } from '../../types/panels';
import { mockSpotify } from '../../data/mockPanels';
import { lyricsPanelDefaults } from '../../config/uiSettings';
import { StatusBadge } from './shared';

interface LyricsPanelProps {
  spotify?: SpotifyState;
  settings?: any;
  offline?: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const pickLineIndex = (
  lines: NonNullable<SpotifyState['lyrics']>['lines'],
  synced: boolean,
  progressMs: number,
  durationMs?: number,
) => {
  if (!lines.length) return -1;
  if (synced) {
    const progressSec = progressMs / 1000;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const time = lines[i].time;
      if (typeof time === 'number' && progressSec >= time) return i;
    }
    return 0;
  }
  if (!durationMs || durationMs <= 0) return 0;
  return clamp(Math.floor((progressMs / durationMs) * lines.length), 0, lines.length - 1);
};

const LyricsPanel: React.FC<LyricsPanelProps> = ({ spotify = mockSpotify, settings, offline = false }) => {
  const s = { ...lyricsPanelDefaults, ...settings };
  const track = spotify.track;
  const lyrics = spotify.lyrics;
  const lines = lyrics?.lines ?? [];
  const [now, setNow] = React.useState(Date.now());
  const [anchor, setAnchor] = React.useState({
    key: '',
    progressMs: track?.progressMs ?? 0,
    seenAt: Date.now(),
    status: spotify.status,
  });

  const trackKey = `${track?.id ?? ''}|${track?.title ?? ''}|${track?.artist ?? ''}`;

  React.useEffect(() => {
    setAnchor({
      key: trackKey,
      progressMs: track?.progressMs ?? 0,
      seenAt: Date.now(),
      status: spotify.status,
    });
  }, [trackKey, track?.progressMs, spotify.status]);

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const progressMs =
    anchor.status === 'playing' && anchor.key === trackKey
      ? clamp(anchor.progressMs + (now - anchor.seenAt), 0, track?.durationMs ?? Number.MAX_SAFE_INTEGER)
      : track?.progressMs ?? 0;

  const currentIndex = pickLineIndex(lines, lyrics?.synced === true, progressMs, track?.durationMs);
  const prev = currentIndex > 0 ? lines[currentIndex - 1]?.text ?? '' : '';
  const current = currentIndex >= 0 ? lines[currentIndex]?.text || '♪' : '♪';
  const next = currentIndex >= 0 && currentIndex < lines.length - 1 ? lines[currentIndex + 1]?.text ?? '' : '';
  const hasLyrics = lines.length > 0;

  const statusText = offline
    ? 'OFFLINE'
    : !track
      ? 'NO TRACK'
      : lyrics?.status === 'error'
        ? 'LYRICS ERROR'
        : lyrics?.synced
          ? 'SYNCED'
          : lyrics?.status === 'plain'
            ? 'PLAIN'
            : 'WAITING';

  const rowStyle = (kind: 'prev' | 'current' | 'next'): React.CSSProperties => ({
    minHeight: kind === 'current' ? `${Math.max(s.currentSize * 1.45, 34)}px` : `${Math.max(s.sideSize * 1.35, 24)}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start',
    textAlign: s.align,
    overflow: 'hidden',
  });

  const textStyle = (kind: 'prev' | 'current' | 'next'): React.CSSProperties => ({
    maxWidth: '100%',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: kind === 'current' ? s.currentMaxLines : s.sideMaxLines,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    lineHeight: 1.18,
    fontSize: `${kind === 'current' ? s.currentSize : s.sideSize}px`,
    fontWeight: kind === 'current' ? 500 : 300,
    opacity: kind === 'current' ? 1 : s.sideOpacity,
    letterSpacing: kind === 'current' ? '0.02em' : '0.04em',
    textShadow: kind === 'current' ? '0 0 18px rgba(255,255,255,0.25)' : 'none',
  });

  return (
    <div style={{
      height: '100%',
      color: '#fff',
      fontFamily: 'var(--font-main)',
      display: 'flex',
      flexDirection: 'column',
      gap: `${s.lineGap}px`,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {s.showTrack && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          fontSize: `${s.metaSize}px`,
          opacity: 0.72,
          letterSpacing: '0.08em',
          minHeight: '20px',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track ? `${track.title} / ${track.artist}` : 'SPOTIFY'}
          </span>
          {s.showStatus && <StatusBadge tone={lyrics?.synced ? 'ok' : lyrics?.status === 'error' ? 'error' : 'neutral'}>{statusText}</StatusBadge>}
        </div>
      )}

      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: '1fr auto 1fr',
        gap: `${s.lineGap}px`,
      }}>
        {hasLyrics ? (
          <>
            <div style={rowStyle('prev')}>
              <span style={textStyle('prev')}>{prev}</span>
            </div>
            <div style={rowStyle('current')}>
              <span key={`${trackKey}-${currentIndex}`} className="lyrics-current-pulse" style={textStyle('current')}>
                {current}
              </span>
            </div>
            <div style={rowStyle('next')}>
              <span style={textStyle('next')}>{next}</span>
            </div>
          </>
        ) : (
          <div style={{
            gridRow: '1 / -1',
            display: 'grid',
            placeItems: 'center',
            minHeight: 0,
            textAlign: 'center',
            fontSize: `${s.currentSize}px`,
            opacity: 0.55,
            letterSpacing: '0.1em',
          }}>
            {track ? 'LYRICS STANDBY' : 'NO TRACK'}
          </div>
        )}
      </div>
    </div>
  );
};

export default LyricsPanel;
