// Scene Background Layer (Background Probe 0.5 = Motion Probe 0.5)
//
// Renders the scene.json `background` block as stacked HTML/CSS layers BEHIND the
// transparent three.js canvas (the canvas is created with alpha:true, so whatever
// this draws shows through). Background compositing is deliberately kept OUT of
// the three.js scene this phase (per brief): it is a DOM layer at z-index 0, the
// canvas is z-index 1, the UI is z-index 10.
//
// Layer order (far -> near):
//   outside : window view — real image, else a blue/night sky gradient fallback.
//   room    : room back wall + window frame — may have a transparent window
//             cutout so `outside` shows through; real image, else a dim gradient.
//   light   : light/glare overlay — only when the image exists AND it is enabled.
//             A missing light overlay is simply transparent (never a fallback).
//
// Never crashes on a missing asset: each image URL is preloaded with an
// HTMLImageElement; on error (or a null/empty url) the layer falls back to a CSS
// gradient (room/outside) or renders nothing (light). The resolved per-asset
// status is reported via onBgDebug for the debug HUD.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SceneBackground } from '../lib/scene/sceneTypes';
import type { Daypart } from '../lib/scene/daypart';
import { publicAssetUrl } from '../lib/assetUrl';

export type BgFit = 'cover' | 'contain';

export interface BackgroundOverlay {
  url: string;
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: CSSProperties['mixBlendMode'];
  fit?: BgFit;
}

// Resolved status of one background asset (for the debug HUD).
//   ok       : the image loaded and is shown
//   fallback : the image is missing/broken -> CSS gradient shown (room/outside)
//   none     : no image and no fallback needed -> transparent (light overlay)
//   loading  : preload in flight
export type BgAssetStatus = 'ok' | 'fallback' | 'none' | 'loading';

export interface BgDebug {
  room: BgAssetStatus;
  outside: BgAssetStatus;
  light: BgAssetStatus;
  enabled: boolean;
  lightOverlayEnabled: boolean;
  fit: BgFit;
}

export interface SceneBackgroundLayerProps {
  // The scene's background descriptor (from scene.json via SceneDebug). When
  // undefined/empty, every layer resolves to its fallback (or transparent).
  background?: SceneBackground;
  enabled: boolean;
  lightOverlayEnabled: boolean;
  fit?: BgFit;
  videoMuted?: boolean;
  videoLoop?: boolean;
  fadeSeconds?: number;
  overlays?: BackgroundOverlay[];
  onVideoEnded?: () => void;
  onBgDebug?: (debug: BgDebug) => void;
  // Stage D (2026-07-01): 'night' swaps in background.night.* images (when
  // present — each falls back to the day image, same as a missing day image
  // falls back to the CSS gradient) AND selects the night fallback gradient,
  // so day/night is visible even with zero background art authored.
  daypart?: Daypart;
}

// Preload an image url and report whether it resolves. A null/empty url short-
// circuits to 'missing' with no network request.
function useImageStatus(url: string | null | undefined): 'loading' | 'ok' | 'missing' {
  // Result is keyed by url so a stale load from a previous url is ignored. The
  // no-url and pending states are derived during render, so the effect only
  // setStates from the async image callbacks (never synchronously on mount).
  const [resolved, setResolved] = useState<{ url: string; status: 'ok' | 'missing' } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setResolved({ url, status: 'ok' });
    };
    img.onerror = () => {
      if (!cancelled) setResolved({ url, status: 'missing' });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!url) return 'missing';
  return resolved && resolved.url === url ? resolved.status : 'loading';
}

function layerStyle(url: string, fit: BgFit): CSSProperties {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: fit,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

function clamp01(value: number | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export default function SceneBackgroundLayer({
  background,
  enabled,
  lightOverlayEnabled,
  fit = 'cover',
  videoMuted = true,
  videoLoop = true,
  fadeSeconds = 1,
  overlays = [],
  onVideoEnded,
  onBgDebug,
  daypart = 'day',
}: SceneBackgroundLayerProps) {
  const isNight = daypart === 'night';
  const videoUrl = publicAssetUrl(background?.windowVideo ?? null);
  // A night image, if the scene authored one, wins; otherwise fall through to
  // the day image (which itself falls back to the CSS gradient below when
  // missing/broken — see useImageStatus). No art authored yet = always this
  // fallback path, but the gradient itself still switches with isNight.
  const roomUrl = publicAssetUrl((isNight ? background?.night?.roomImage : null) ?? background?.roomImage ?? null);
  const outsideUrl = publicAssetUrl((isNight ? background?.night?.outsideImage : null) ?? background?.outsideImage ?? null);
  const lightUrl = publicAssetUrl((isNight ? background?.night?.lightOverlay : null) ?? background?.lightOverlay ?? null);

  const roomRaw = useImageStatus(videoUrl ? null : roomUrl);
  const outsideRaw = useImageStatus(videoUrl ? null : outsideUrl);
  const lightRaw = useImageStatus(lightUrl);

  const room: BgAssetStatus = videoUrl ? 'ok' : roomRaw === 'loading' ? 'loading' : roomRaw === 'ok' ? 'ok' : 'fallback';
  const outside: BgAssetStatus = videoUrl ? 'none' : outsideRaw === 'loading' ? 'loading' : outsideRaw === 'ok' ? 'ok' : 'fallback';
  // A missing light overlay is transparent (no fallback) -> 'none', not 'fallback'.
  const light: BgAssetStatus = lightRaw === 'loading' ? 'loading' : lightRaw === 'ok' ? 'ok' : 'none';

  useEffect(() => {
    onBgDebug?.({ room, outside, light, enabled, lightOverlayEnabled, fit });
  }, [room, outside, light, enabled, lightOverlayEnabled, fit, onBgDebug]);

  // Background OFF -> render nothing; the app's base dark background (#1a1a1a)
  // shows through the transparent canvas, i.e. the pre-0.5 look.
  if (!enabled) return null;

  const nightFallback = isNight ? ' scene-bg--night' : '';
  const transitionStyle = { '--scene-bg-fade-seconds': `${Math.max(0, fadeSeconds)}s` } as CSSProperties;
  const renderOverlays = () => overlays
    .filter((overlay) => overlay.visible !== false && overlay.url)
    .map((overlay, index) => {
      const overlayUrl = publicAssetUrl(overlay.url);
      if (!overlayUrl) return null;
      const overlayFit = overlay.fit === 'cover' || overlay.fit === 'contain' ? overlay.fit : fit;
      return (
        <div
          key={`${overlayUrl}:${index}`}
          className="scene-bg-custom-overlay"
          style={{
            ...layerStyle(overlayUrl, overlayFit),
            opacity: clamp01(overlay.opacity, 0.65),
            mixBlendMode: overlay.blendMode ?? 'screen',
          }}
        />
      );
    });

  if (videoUrl) {
    return (
      <div className="scene-bg-layer" aria-hidden="true" style={transitionStyle}>
        <video
          key={videoUrl}
          className="scene-bg-video"
          src={videoUrl}
          autoPlay
          muted={videoMuted}
          loop={videoLoop}
          playsInline
          style={{ objectFit: fit }}
          onEnded={onVideoEnded}
        />
        {light === 'ok' && lightOverlayEnabled && lightUrl && (
          <div className="scene-bg-light" style={layerStyle(lightUrl, fit)} />
        )}
        {renderOverlays()}
      </div>
    );
  }

  return (
    <div className="scene-bg-layer" aria-hidden="true" style={transitionStyle}>
      <div
        key={`outside:${outsideUrl ?? 'fallback'}:${daypart}`}
        className={outside === 'ok' ? 'scene-bg-outside' : `scene-bg-outside scene-bg-outside--fallback${nightFallback}`}
        style={outside === 'ok' && outsideUrl ? layerStyle(outsideUrl, fit) : undefined}
      />
      <div
        key={`room:${roomUrl ?? 'fallback'}:${daypart}`}
        className={room === 'ok' ? 'scene-bg-room' : `scene-bg-room scene-bg-room--fallback${nightFallback}`}
        style={room === 'ok' && roomUrl ? layerStyle(roomUrl, fit) : undefined}
      />
      {light === 'ok' && lightOverlayEnabled && lightUrl && (
        <div className="scene-bg-light" style={layerStyle(lightUrl, fit)} />
      )}
      {renderOverlays()}
    </div>
  );
}
