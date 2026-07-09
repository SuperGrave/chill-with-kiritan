import React from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import type { SpotifyState } from '../../types/panels';
import { mockSpotify } from '../../data/mockPanels';
import { musicPanelDefaults } from '../../config/uiSettings';
import WeatherToneBar from '../WeatherToneBar';
import { StatusBadge } from './shared';

interface MusicPanelProps {
  spotify?: SpotifyState;
  settings?: any;
  offline?: boolean;
  onControl?: (action: 'toggle' | 'next' | 'previous') => Promise<boolean>;
}

const formatMs = (ms?: number): string => {
  if (ms === undefined) return '-:--';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${m}:${sec}`;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const sampledAtMs = (sampledAt?: string): number => {
  const parsed = sampledAt ? Date.parse(sampledAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const MusicPanel: React.FC<MusicPanelProps> = ({ spotify = mockSpotify, settings, offline = false, onControl }) => {
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const s = { ...musicPanelDefaults, ...settings };
  const track = spotify.track;
  const trackKey = `${track?.id ?? ''}|${track?.title ?? ''}|${track?.artist ?? ''}`;
  const [now, setNow] = React.useState(Date.now());
  const [anchor, setAnchor] = React.useState({
    key: trackKey,
    progressMs: track?.progressMs ?? 0,
    seenAt: sampledAtMs(track?.sampledAt),
    status: spotify.status,
  });

  React.useEffect(() => {
    setAnchor({
      key: trackKey,
      progressMs: track?.progressMs ?? 0,
      seenAt: sampledAtMs(track?.sampledAt),
      status: spotify.status,
    });
  }, [trackKey, track?.progressMs, track?.sampledAt, spotify.status]);

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const progressMs =
    anchor.status === 'playing' && anchor.key === trackKey
      ? clamp(anchor.progressMs + (now - anchor.seenAt), 0, track?.durationMs ?? Number.MAX_SAFE_INTEGER)
      : track?.progressMs ?? 0;

  const progressPercent =
    track?.durationMs
      ? (progressMs / track.durationMs) * 100
      : 0;

  const statusTone =
    spotify.status === 'playing' ? 'ok'
    : spotify.status === 'error' ? 'error'
    : 'neutral';

  const controlsDisabled = offline || !spotify.connected || !onControl || busyAction !== null;
  const runControl = async (action: 'toggle' | 'next' | 'previous') => {
    if (controlsDisabled) return;
    setBusyAction(action);
    try {
      await onControl?.(action);
    } finally {
      setBusyAction(null);
    }
  };

  const controlButtonStyle: React.CSSProperties = {
    width: `${s.controlSize * 1.8}px`,
    height: `${s.controlSize * 1.8}px`,
    display: 'grid',
    placeItems: 'center',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    cursor: controlsDisabled ? 'not-allowed' : 'pointer',
    opacity: controlsDisabled ? 0.35 : 0.78,
    padding: 0,
  };

  const isTopRightArtwork = s.showArtwork !== false && s.artworkMode === 'topRight';
  const cornerArtworkRaw = Number(s.artworkCornerSize ?? 0);
  const cornerArtworkSize = Number.isFinite(cornerArtworkRaw) ? Math.max(0, cornerArtworkRaw) : 0;
  const hasCornerArtwork = isTopRightArtwork && cornerArtworkSize > 0;
  const artworkTopGap = Math.max(0, Number(s.artworkTopGap ?? 0));
  const artworkProgressGap = Math.max(0, Number(s.artworkProgressGap ?? s.gap ?? 20));
  const renderArtworkBox = (style: React.CSSProperties, placeholderSize = '14px') => (
    <div style={{
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.15)',
      background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.25) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
      ...style,
    }}>
      {track?.albumArtUrl ? (
        <img
          src={track.albumArtUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: placeholderSize }}>
          NO ARTWORK
        </span>
      )}
    </div>
  );

  return (
    <div style={{
      color: '#fff',
      fontFamily: 'var(--font-main)',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      minHeight: '100%',
      boxSizing: 'border-box',
      position: 'relative',
    }}>
      {hasCornerArtwork && renderArtworkBox({
        position: 'absolute',
        top: `${artworkTopGap}px`,
        right: 0,
        width: `${cornerArtworkSize}px`,
        height: `${cornerArtworkSize}px`,
        zIndex: 0,
        pointerEvents: 'none',
      }, `${Math.max(8, cornerArtworkSize * 0.08)}px`)}

      {s.showArtwork !== false && !isTopRightArtwork && (
        renderArtworkBox({
          width: `${s.artworkScale * 100}%`,
          margin: `0 auto ${s.gap}px`,
          aspectRatio: '1',
        })
      )}

      <div style={{
        position: 'relative',
        zIndex: 1,
        boxSizing: 'border-box',
        minHeight: hasCornerArtwork ? `${artworkTopGap + cornerArtworkSize}px` : undefined,
        paddingTop: hasCornerArtwork ? `${artworkTopGap}px` : undefined,
        paddingRight: hasCornerArtwork ? `${cornerArtworkSize + 16}px` : undefined,
        display: hasCornerArtwork ? 'flex' : undefined,
        flexDirection: hasCornerArtwork ? 'column' : undefined,
        justifyContent: hasCornerArtwork ? 'center' : undefined,
        minWidth: 0,
        marginBottom: `${hasCornerArtwork ? artworkProgressGap : s.gap}px`,
      }}>
        <div style={{
          fontSize: `${s.titleSize}px`,
          fontWeight: 300,
          letterSpacing: '0.05em',
          lineHeight: 1.2,
          marginBottom: '6px',
        }}>
          {track?.title ?? 'NOT PLAYING'}
        </div>
        <div style={{
          fontSize: `${s.artistSize}px`,
          letterSpacing: '0.08em',
          opacity: 0.7,
        }}>
          {track?.artist ?? '—'}
          {s.showAlbum && track?.album && (
            <span style={{ opacity: 0.6 }}>
              <span style={{ margin: '0 8px' }}>/</span>
              {track.album}
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: s.showControls ? `${s.gap}px` : 0 }}>
        <WeatherToneBar
          mode="progress"
          value={progressPercent}
          pattern={s.pattern}
          showMarker={s.showMarker}
          height={s.barHeight}
        />
        {s.showTimeCodes && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: `${s.timeSize}px`,
            letterSpacing: '0.1em',
            opacity: 0.7,
          }}>
            <span>{formatMs(track ? progressMs : undefined)}</span>
            <span>{formatMs(track?.durationMs)}</span>
          </div>
        )}
      </div>

      {s.showControls && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '32px',
          marginTop: '4px',
          marginBottom: s.showFooter ? `${s.gap}px` : 0,
        }}>
          <button type="button" aria-label="Previous track" title="Previous track" style={controlButtonStyle} disabled={controlsDisabled} onClick={() => runControl('previous')}>
            <SkipBack size={s.controlSize} strokeWidth={1.5} />
          </button>
          <button type="button" aria-label="Play or pause" title="Play or pause" style={{ ...controlButtonStyle, width: `${s.controlSize * 2.2}px`, height: `${s.controlSize * 2.2}px`, opacity: controlsDisabled ? 0.35 : 1 }} disabled={controlsDisabled} onClick={() => runControl('toggle')}>
            {spotify.status === 'playing' ? (
              <Pause size={s.controlSize * 1.2} strokeWidth={1.5} />
            ) : (
              <Play size={s.controlSize * 1.2} strokeWidth={1.5} />
            )}
          </button>
          <button type="button" aria-label="Next track" title="Next track" style={controlButtonStyle} disabled={controlsDisabled} onClick={() => runControl('next')}>
            <SkipForward size={s.controlSize} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {s.showFooter && (
        <div style={{
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '15px',
          letterSpacing: '0.1em',
          opacity: 0.9,
        }}>
          <span>@ SPOTIFY</span>
          {offline && <StatusBadge tone="warn">OFFLINE</StatusBadge>}
          <StatusBadge tone={statusTone}>STATUS: {spotify.status.toUpperCase()}</StatusBadge>
          {!spotify.connected && <StatusBadge tone="error">NOT CONNECTED</StatusBadge>}
        </div>
      )}
    </div>
  );
};

export default MusicPanel;
