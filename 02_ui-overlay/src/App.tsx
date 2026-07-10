import { useState, useEffect, useRef } from 'react';
import { overlayLayout as defaultLayout, DOCK_BASE_HEIGHT, DOCK_GAP_COUNT } from './config/layout';
import { uiSettings as defaultUiSettings } from './config/uiSettings';
import ClockWidget from './components/ClockWidget';
import WeatherCompact from './components/WeatherCompact';
import WeatherDetailPanel from './components/panels/WeatherDetailPanel';
import RightDock from './components/RightDock';
import DetailPanel from './components/DetailPanel';
import FloatingPanel from './components/FloatingPanel';
import NewsPanel from './components/panels/NewsPanel';
import MusicPanel from './components/panels/MusicPanel';
import LyricsPanel from './components/panels/LyricsPanel';
import PersonalNewsPanel from './components/panels/PersonalNewsPanel';
import MemoPanel from './components/panels/MemoPanel';
import TimerPanel from './components/panels/TimerPanel';
import DebugGuide from './components/DebugGuide';
import { useWeatherData } from './hooks/useWeatherData';
import { useCompanionData } from './hooks/useCompanionData';
import {
  subscribeCompanionUi,
  pushCompanionUi,
  sendSpotifyControl,
  sendTimerControl,
} from './services/companionClient';
import type { CompanionWeatherState } from './services/companionClient';
import type { SpotifyState } from './types/panels';
import type { WeatherBundle } from './types/weather';
import './styles/base.css';
import './styles/overlay.css';
import './styles/weather.css';

interface OverlayAppProps {
  productionMode?: boolean;
}

export type PanelId = 'WEATHER' | 'MUSIC' | 'LYRICS' | 'PERSONAL_NEWS' | 'NEWS' | 'MEMO' | 'TIMER';

const OFFLINE_SPOTIFY: SpotifyState = {
  connected: false,
  status: 'idle',
};

const weatherCondition = (code: number): string => {
  if (code === 0) return 'SUNNY';
  if (code === 1 || code === 2) return 'PARTLY CLOUDY';
  if (code === 3) return 'CLOUDY';
  if (code === 45 || code === 48) return 'FOG';
  if (code >= 51 && code <= 55) return 'DRIZZLE';
  if (code >= 61 && code <= 65) return 'RAIN';
  if (code >= 71 && code <= 77) return 'SNOW';
  if (code >= 80 && code <= 82) return 'SHOWERS';
  if (code === 85 || code === 86) return 'SNOW';
  if (code >= 95) return 'THUNDER';
  return 'UNKNOWN';
};

const windDirectionLabel = (degrees: number): string => {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 45) % 8];
};

const liveNumber = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const companionWeatherToBundle = (weather?: CompanionWeatherState | null): WeatherBundle | null => {
  const current = weather?.current;
  if (!current || weather?.source !== 'live') return null;
  const temperature = Math.round(current.temperature);
  const updatedAt = weather.updatedAt ?? new Date().toISOString();
  const temperatureMin = liveNumber(current.temperatureMin);
  const temperatureMax = liveNumber(current.temperatureMax);
  const hourly = (weather.hourly ?? []).map((point) => ({
    time: point.time,
    temperature: Math.round(point.temperature),
    condition: typeof point.weatherCode === 'number' ? weatherCondition(point.weatherCode) : 'UNKNOWN',
    weatherCode: liveNumber(point.weatherCode) === undefined ? undefined : Number(point.weatherCode),
    precipitationProbability: liveNumber(point.precipitationProbability),
    humidity: liveNumber(point.humidity),
    windSpeed: liveNumber(point.windSpeed),
  }));
  return {
    summary: {
      location: current.location,
      condition: weatherCondition(current.weatherCode),
      weatherCode: current.weatherCode,
      isDay: current.isDay,
      currentTemperature: temperature,
      apparentTemperature: Math.round(current.apparentTemperature),
      temperatureMin: temperatureMin === undefined ? temperature : Math.round(temperatureMin),
      temperatureMax: temperatureMax === undefined ? temperature : Math.round(temperatureMax),
      humidity: Math.round(current.humidity),
      pressure: Number(current.pressure.toFixed(1)),
      precipitationProbability: liveNumber(current.precipitationProbability),
      precipitation: liveNumber(current.precipitation),
      rain: liveNumber(current.rain),
      snowfall: liveNumber(current.snowfall),
      cloudCover: liveNumber(current.cloudCover),
      uvIndex: liveNumber(current.uvIndex),
      windSpeed: Number(current.windSpeed.toFixed(1)),
      windDirection: windDirectionLabel(current.windDirection),
      windDirectionDegrees: current.windDirection,
      windGust: liveNumber(current.windGust),
      sunrise: current.sunrise ?? undefined,
      sunset: current.sunset ?? undefined,
      updatedAt,
      source: 'live',
    },
    hourly,
    overview: weather.overview ?? undefined,
    source: 'live',
    updatedAt,
    error: weather.error ?? undefined,
  };
};

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? { ...fallback, ...JSON.parse(saved) } : fallback;
  } catch {
    return fallback;
  }
};

function App({ productionMode = false }: OverlayAppProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scale, setScale] = useState(1);

  // Shallow-merge with defaults so settings sections added after a user's
  // localStorage snapshot (e.g. newsPanel/musicPanel) still get their defaults.
  const [layout, setLayout] = useState(() =>
    readStored('tohoku_ui_layout', defaultLayout)
  );

  const [settings, setSettings] = useState(() =>
    readStored('tohoku_ui_settings', defaultUiSettings)
  );

  // Production is a presentation surface, not an authoring surface. Companion
  // presets may still contain old debug/dead-control flags, so enforce the
  // release contract at render time without overwriting the stored preset.
  const effectiveSettings = productionMode
    ? {
        ...settings,
        debugMode: false,
      }
    : settings;

  useEffect(() => {
    localStorage.setItem('tohoku_ui_layout', JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    localStorage.setItem('tohoku_ui_settings', JSON.stringify(settings));
  }, [settings]);

  // ── Companion App sync (single source of truth when running) ──────────────
  // The Companion (03) owns display settings + presets. On mount we adopt its
  // stored settings; we re-adopt whenever its active preset changes (so
  // applying a preset from the Companion reflects here live). Local edits are
  // pushed back so the Companion can snapshot them as presets. Everything
  // degrades gracefully: when the Companion is offline, localStorage is used.
  const [companionConnected, setCompanionConnected] = useState(false);
  const companionSync = useRef<{ adopted: boolean; lastSignature?: string; skipPush: boolean }>(
    { adopted: false, lastSignature: undefined, skipPush: false }
  );

  useEffect(() => {
    // Fed by the page-wide shared poller (companionClient) — the integrated
    // wallpaper subscribes too, so only ONE /api/ui request loop runs per page.
    return subscribeCompanionUi((ui) => {
      if (!ui) { setCompanionConnected(false); return; }
      setCompanionConnected(true);
      const hasSettings = ui.settings && Object.keys(ui.settings).length > 0;
      const first = !companionSync.current.adopted;
      const signature = JSON.stringify({
        activePresetId: ui.activePresetId ?? null,
        layout: ui.layout ?? {},
        settings: ui.settings ?? {},
      });
      const remoteChanged = signature !== companionSync.current.lastSignature;
      if (hasSettings && (first || remoteChanged)) {
        companionSync.current.skipPush = true; // don't echo an adopted value back
        if (ui.layout && Object.keys(ui.layout).length) {
          setLayout({ ...defaultLayout, ...ui.layout });
        }
        setSettings({ ...defaultUiSettings, ...ui.settings });
      }
      companionSync.current.adopted = true;
      companionSync.current.lastSignature = signature;
    });
  }, []);

  // Debounced push of local layout/settings to the Companion.
  useEffect(() => {
    if (!companionConnected) return;
    if (companionSync.current.skipPush) { companionSync.current.skipPush = false; return; }
    const id = setTimeout(() => { pushCompanionUi(layout, settings); }, 600);
    return () => clearTimeout(id);
  }, [layout, settings, companionConnected]);

  const [baseWidth, baseHeight] = (effectiveSettings.baseResolution || '1920x1080').split('x').map(Number);

  useEffect(() => {
    const handleResize = () => {
      const scaleX = window.innerWidth / baseWidth;
      const scaleY = window.innerHeight / baseHeight;
      setScale(Math.min(scaleX, scaleY));
    };
    
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [baseWidth, baseHeight]);

  // The right dock is the only way into Settings, and the canvas clips
  // anything outside it (overflow: hidden) — so a saved layout that places
  // the dock off-canvas (old slider ranges allowed up to 2000px, and smaller
  // base resolutions shrink the canvas under the default position) locks the
  // user out of the menu entirely. Pull the dock and the settings overlay
  // back inside the canvas whenever their position would hide them. This is
  // a render-phase adjustment (React's "adjusting state when props change"
  // pattern): the clamped layout re-renders before commit, and the persist
  // effect then writes the healed values back to localStorage.
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo), Math.max(lo, hi));
  const pullIn = <T extends { x: number; y: number }>(
    rect: T | undefined, fallback: T, maxX: number, maxY: number,
  ): T => {
    const cur = { ...fallback, ...rect };
    const x = clamp(Number.isFinite(cur.x) ? cur.x : fallback.x, 0, maxX);
    const y = clamp(Number.isFinite(cur.y) ? cur.y : fallback.y, 0, maxY);
    return !rect || x !== rect.x || y !== rect.y ? { ...cur, x, y } : rect;
  };
  const dock = { ...defaultLayout.rightDock, ...layout.rightDock };
  const safeRightDock = pullIn(layout.rightDock, defaultLayout.rightDock,
    baseWidth - dock.width, baseHeight - (DOCK_BASE_HEIGHT + DOCK_GAP_COUNT * dock.gap));
  const safeDetailPanel = pullIn(layout.detailPanel, defaultLayout.detailPanel,
    baseWidth - 100, baseHeight - 100);
  if (safeRightDock !== layout.rightDock || safeDetailPanel !== layout.detailPanel) {
    setLayout({ ...layout, rightDock: safeRightDock, detailPanel: safeDetailPanel });
  }

  const handleReset = () => {
    setLayout(defaultLayout);
    setSettings(defaultUiSettings);
    localStorage.removeItem('tohoku_ui_layout');
    localStorage.removeItem('tohoku_ui_settings');
  };

  // Panel visibility shortcuts map to settings flags. WEATHER reuses the
  // existing left module's flag; the rest use their panel's own `show`.
  // `!== false` keeps older saved objects (missing the key) visible by default.
  const PANEL_FLAG: Record<PanelId, [string, string]> = {
    WEATHER: ['weatherCompact', 'showCompactWeather'],
    MUSIC: ['musicPanel', 'show'],
    LYRICS: ['lyricsPanel', 'show'],
    PERSONAL_NEWS: ['personalNewsPanel', 'show'],
    NEWS: ['newsPanel', 'show'],
    MEMO: ['memoPanel', 'show'],
    TIMER: ['timerPanel', 'show'],
  };

  const isPanelVisible = (id: PanelId) => {
    const [section, key] = PANEL_FLAG[id];
    const sections = effectiveSettings as unknown as Record<string, Record<string, unknown> | undefined>;
    return sections[section]?.[key] !== false;
  };

  const togglePanel = (id: PanelId) => {
    const [section, key] = PANEL_FLAG[id];
    setSettings((prev: any) => {
      const current = prev[section]?.[key] !== false;
      return { ...prev, [section]: { ...prev[section], [key]: !current } };
    });
  };

  const panelVisibility = {
    WEATHER: isPanelVisible('WEATHER'),
    MUSIC: isPanelVisible('MUSIC'),
    LYRICS: isPanelVisible('LYRICS'),
    PERSONAL_NEWS: isPanelVisible('PERSONAL_NEWS'),
    NEWS: isPanelVisible('NEWS'),
    MEMO: isPanelVisible('MEMO'),
    TIMER: isPanelVisible('TIMER'),
  };

  const { weatherBundle: localWeatherBundle } = useWeatherData();

  // In production, null means OFFLINE and [] means a real connected empty
  // state. Mock data remains available only to the standalone overlay preview.
  const { data: companion, online: companionOnline, refresh: refreshCompanion } = useCompanionData();
  const connected = companionOnline;
  const liveNews = companion ? companion.news : productionMode ? [] : undefined;
  const livePersonalNews = companion?.personalNews;
  const liveSpotify = companion?.spotify ?? (productionMode ? OFFLINE_SPOTIFY : undefined);
  const liveMemos = companion ? companion.memos : productionMode ? [] : undefined;
  const liveTimer = companion?.timer ?? null;
  const newsSource = companion ? 'live' : productionMode ? 'offline' : undefined;
  const lyricsHasLines = (liveSpotify?.lyrics?.lines?.length ?? 0) > 0;
  const personalNewsSettings = {
    ...defaultUiSettings.personalNewsPanel,
    ...(effectiveSettings.personalNewsPanel ?? {}),
  };
  const personalNewsAutoActive =
    !lyricsHasLines &&
    personalNewsSettings.autoShowWhenLyricsUnavailable !== false &&
    livePersonalNews?.currentScript;
  const showPersonalNewsPanel = panelVisibility.PERSONAL_NEWS || Boolean(personalNewsAutoActive);
  const showLyricsPanel =
    panelVisibility.LYRICS &&
    !(personalNewsAutoActive && personalNewsSettings.hideLyricsWhenAutoShown !== false);
  const personalNewsPanelTitle = `PERSONAL NEWS${livePersonalNews?.currentScript?.title ? ` : ${livePersonalNews.currentScript.title}` : ''}`;
  const companionWeatherBundle = companionWeatherToBundle(companion?.weather);

  // Companion is the production source of truth for weather. The old local
  // Open-Meteo path remains only as a standalone-preview/offline fallback.
  const weatherBundle = companionWeatherBundle ?? localWeatherBundle;
  const weatherData = weatherBundle.summary;
  const weatherAvailable = productionMode
    ? companionWeatherBundle?.source === 'live'
    : weatherBundle.source === 'live' || weatherBundle.source === 'mock';
  const weatherDisplayMode = effectiveSettings.weatherCompact?.displayMode ?? 'compact';
  const weatherChrome =
    weatherDisplayMode === 'detailed'
      ? effectiveSettings.weatherDetail
      : effectiveSettings.weatherCompact;
  const showWeatherBackground = weatherChrome?.showBackground === true;
  const weatherBackgroundOpacity = weatherChrome?.backgroundOpacity ?? 0.28;

  return (
    <div className={`overlay-app-root ${productionMode ? 'production-mode' : ''}`} style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: effectiveSettings.debugMode ? 'rgba(0,0,0,0.8)' : 'transparent',
      display: 'flex',
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
      overflow: 'hidden'
    }}>
      {/* Emergency Reset Button */}
      {!productionMode && <button
        onClick={handleReset}
        style={{
          position: 'fixed',
          top: '10px',
          left: '10px',
          zIndex: 99999,
          background: 'rgba(255, 0, 0, 0.5)',
          color: 'white',
          border: '1px solid rgba(255, 0, 0, 0.8)',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
          opacity: 0.5,
          transition: 'opacity 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
        title="Emergency Reset"
      >
        ⚠️ Reset
      </button>}

      <div 
        className={`overlay-container ${effectiveSettings.debugMode ? 'debug-mode' : ''}`}
        style={{
          width: `${baseWidth}px`,
          height: `${baseHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          opacity: effectiveSettings.overlay.opacity,
        }}
      >
        {effectiveSettings.debugMode && <DebugGuide layout={{...layout, canvas: {width: baseWidth, height: baseHeight}}} />}

        {effectiveSettings.clock?.showClock !== false && (
          <ClockWidget layout={layout.clock} settings={effectiveSettings.clock} debugMode={effectiveSettings.debugMode} />
        )}
        {layout.weatherCompact && effectiveSettings.weatherCompact?.showCompactWeather && (
          <div style={{
          position: 'absolute',
          left: layout.weatherCompact.x,
          top: layout.weatherCompact.y,
          width: weatherDisplayMode === 'detailed' ? Math.max(layout.weatherCompact.width, 360) : layout.weatherCompact.width,
          transform: weatherDisplayMode === 'detailed' ? `scale(${effectiveSettings.weatherDetail?.fontSize !== undefined ? effectiveSettings.weatherDetail.fontSize : 1})` : 'none',
          transformOrigin: 'top left',
          pointerEvents: 'auto',
          background: showWeatherBackground && weatherDisplayMode === 'compact' ? `rgba(0,0,0,${weatherBackgroundOpacity})` : 'transparent',
          borderRadius: showWeatherBackground && weatherDisplayMode === 'compact' ? '24px' : undefined,
          padding: showWeatherBackground && weatherDisplayMode === 'compact' ? '16px' : undefined,
          backdropFilter: showWeatherBackground && weatherDisplayMode === 'compact' ? 'blur(16px)' : undefined,
          WebkitBackdropFilter: showWeatherBackground && weatherDisplayMode === 'compact' ? 'blur(16px)' : undefined,
          border: showWeatherBackground && weatherDisplayMode === 'compact' ? '1px solid rgba(255,255,255,0.15)' : undefined,
          boxShadow: showWeatherBackground && weatherDisplayMode === 'compact' ? '0 12px 40px rgba(0,0,0,0.32)' : undefined,
          boxSizing: 'border-box',
        }}>
            {!weatherAvailable ? (
              <div className="overlay-empty-state">WEATHER / OFFLINE</div>
            ) : weatherDisplayMode === 'detailed' ? (
              <div 
                className={`weather-compact ${effectiveSettings.debugMode ? 'debug-mode' : ''}`}
                style={{ 
                  width: '100%', 
                  background: showWeatherBackground ? `rgba(0,0,0,${weatherBackgroundOpacity})` : 'transparent',
                  borderRadius: showWeatherBackground ? '24px' : undefined,
                  backdropFilter: showWeatherBackground ? 'blur(16px)' : 'none',
                  WebkitBackdropFilter: showWeatherBackground ? 'blur(16px)' : 'none',
                  border: showWeatherBackground ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  boxShadow: showWeatherBackground ? '0 12px 40px rgba(0,0,0,0.32)' : 'none',
                }}
              >
                <WeatherDetailPanel weatherData={weatherData} weatherBundle={weatherBundle} pattern={effectiveSettings.weatherDetail?.pattern || "diagonal"} settings={effectiveSettings.weatherDetail} />
              </div>
            ) : (
              <WeatherCompact 
                layout={layout.weatherCompact} 
                settings={effectiveSettings.weatherCompact}
                weatherData={weatherData}
                debugMode={effectiveSettings.debugMode}
              />
            )}
          </div>
        )}

        {/* Standalone element panels — each freely positioned & toggleable */}
        {layout.newsPanel && (
          <FloatingPanel
            title="NEWS"
            layout={layout.newsPanel}
            visible={panelVisibility.NEWS}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.newsPanel?.showHeader !== false}
            showBackground={effectiveSettings.newsPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.newsPanel?.backgroundOpacity ?? 0.4}
            contentTopGap={effectiveSettings.newsPanel?.contentTopGap ?? defaultUiSettings.newsPanel.contentTopGap}
          >
            <NewsPanel settings={effectiveSettings.newsPanel} items={liveNews} updatedAt={companion?.updatedAt ?? ''} source={newsSource} />
          </FloatingPanel>
        )}
        {layout.musicPanel && (
          <FloatingPanel
            title="MUSIC"
            layout={layout.musicPanel}
            visible={panelVisibility.MUSIC}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.musicPanel?.showHeader !== false}
            showBackground={effectiveSettings.musicPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.musicPanel?.backgroundOpacity ?? 0.4}
          >
            <MusicPanel
              settings={effectiveSettings.musicPanel}
              spotify={liveSpotify}
              offline={productionMode && !connected}
              onControl={async (action) => {
                const ok = await sendSpotifyControl(action);
                await refreshCompanion();
                return ok;
              }}
            />
          </FloatingPanel>
        )}
        {layout.lyricsPanel && (
          <FloatingPanel
            title="LYRICS"
            layout={layout.lyricsPanel}
            visible={showLyricsPanel}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.lyricsPanel?.showHeader !== false}
            showBackground={effectiveSettings.lyricsPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.lyricsPanel?.backgroundOpacity ?? 0.34}
            contentTopGap={effectiveSettings.lyricsPanel?.contentTopGap ?? defaultUiSettings.lyricsPanel.contentTopGap}
          >
            <LyricsPanel
              settings={effectiveSettings.lyricsPanel}
              spotify={liveSpotify}
              offline={productionMode && !connected}
            />
          </FloatingPanel>
        )}
        {layout.personalNewsPanel && (
          <FloatingPanel
            title={personalNewsPanelTitle}
            layout={layout.personalNewsPanel}
            visible={showPersonalNewsPanel}
            debugMode={effectiveSettings.debugMode}
            showHeader={personalNewsSettings.showHeader !== false}
            showBackground={personalNewsSettings.showBackground !== false}
            backgroundOpacity={personalNewsSettings.backgroundOpacity ?? 0.34}
            contentTopGap={personalNewsSettings.contentTopGap ?? defaultUiSettings.personalNewsPanel.contentTopGap}
          >
            <PersonalNewsPanel
              settings={personalNewsSettings}
              personalNews={livePersonalNews}
              offline={productionMode && !connected}
            />
          </FloatingPanel>
        )}
        {layout.memoPanel && (
          <FloatingPanel
            title="MEMO"
            layout={layout.memoPanel}
            visible={panelVisibility.MEMO}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.memoPanel?.showHeader !== false}
            showBackground={effectiveSettings.memoPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.memoPanel?.backgroundOpacity ?? 0.4}
            contentTopGap={effectiveSettings.memoPanel?.contentTopGap ?? defaultUiSettings.memoPanel.contentTopGap}
          >
            <MemoPanel settings={effectiveSettings.memoPanel} memos={liveMemos} offline={productionMode && !connected} />
          </FloatingPanel>
        )}
        {layout.timerPanel && (
          <FloatingPanel
            title="TIMER"
            layout={layout.timerPanel}
            visible={panelVisibility.TIMER}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.timerPanel?.showHeader !== false}
            showBackground={effectiveSettings.timerPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.timerPanel?.backgroundOpacity ?? 0.4}
            contentTopGap={effectiveSettings.timerPanel?.contentTopGap ?? defaultUiSettings.timerPanel.contentTopGap}
          >
            <TimerPanel
              settings={effectiveSettings.timerPanel}
              timer={liveTimer}
              offline={productionMode && !connected}
              onControl={async (action) => {
                const ok = await sendTimerControl(action);
                await refreshCompanion();
                return ok;
              }}
            />
          </FloatingPanel>
        )}

        <RightDock
          layout={layout.rightDock}
          debugMode={effectiveSettings.debugMode}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen(o => !o)}
          showSettings={!productionMode}
        />

        {!productionMode && <DetailPanel
          layout={layout.detailPanel}
          open={settingsOpen}
          debugMode={effectiveSettings.debugMode}
          appLayout={layout}
          appSettings={settings}
          setLayout={setLayout}
          setSettings={setSettings}
          panelVisibility={panelVisibility}
          onTogglePanel={togglePanel}
          onReset={handleReset}
        />}

      </div>
    </div>
  );
}

export default App;
