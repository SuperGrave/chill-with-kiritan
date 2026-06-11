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
}

const formatMs = (ms?: number): string => {
  if (ms === undefined) return '-:--';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${m}:${sec}`;
};

const MusicPanel: React.FC<MusicPanelProps> = ({ spotify = mockSpotify, settings }) => {
  const s = { ...musicPanelDefaults, ...settings };
  const track = spotify.track;

  const progressPercent =
    track?.durationMs && track.progressMs !== undefined
      ? (track.progressMs / track.durationMs) * 100
      : 0;

  const statusTone =
    spotify.status === 'playing' ? 'ok'
    : spotify.status === 'error' ? 'error'
    : 'neutral';

  return (
    <div style={{
      color: '#fff',
      fontFamily: 'var(--font-main)',
      display: 'flex',
      flexDirection: 'column',
      gap: `${s.gap}px`,
      minHeight: '100%',
      boxSizing: 'border-box',
    }}>
      {s.showArtwork && (
        <div style={{
          width: `${s.artworkScale * 100}%`,
          margin: '0 auto',
          aspectRatio: '1',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.25) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {track?.albumArtUrl ? (
            <img
              src={track.albumArtUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '14px' }}>
              NO ARTWORK
            </span>
          )}
        </div>
      )}

      <div>
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

      <div>
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
            <span>{formatMs(track?.progressMs)}</span>
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
        }}>
          <SkipBack size={s.controlSize} strokeWidth={1.5} style={{ cursor: 'pointer', opacity: 0.7 }} />
          {spotify.status === 'playing' ? (
            <Pause size={s.controlSize * 1.2} strokeWidth={1.5} style={{ cursor: 'pointer' }} />
          ) : (
            <Play size={s.controlSize * 1.2} strokeWidth={1.5} style={{ cursor: 'pointer' }} />
          )}
          <SkipForward size={s.controlSize} strokeWidth={1.5} style={{ cursor: 'pointer', opacity: 0.7 }} />
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
          <StatusBadge tone={statusTone}>STATUS: {spotify.status.toUpperCase()}</StatusBadge>
          {!spotify.connected && <StatusBadge tone="error">NOT CONNECTED</StatusBadge>}
        </div>
      )}
    </div>
  );
};

export default MusicPanel;
