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
import AiPanel from './components/panels/AiPanel';
import MemoPanel from './components/panels/MemoPanel';
import DebugGuide from './components/DebugGuide';
import { useWeatherData } from './hooks/useWeatherData';
import { useCompanionData } from './hooks/useCompanionData';
import { fetchCompanionUi, pushCompanionUi, sendCompanionChat, sendSpotifyControl } from './services/companionClient';
import type { AiState, SpotifyState } from './types/panels';
import './styles/base.css';
import './styles/overlay.css';
import './styles/weather.css';

interface OverlayAppProps {
  productionMode?: boolean;
}

export type PanelId = 'WEATHER' | 'MUSIC' | 'LYRICS' | 'AI' | 'NEWS' | 'MEMO';

const OFFLINE_AI: AiState = {
  provider: 'none',
  status: 'idle',
  messages: [],
};

const OFFLINE_SPOTIFY: SpotifyState = {
  connected: false,
  status: 'idle',
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
    let alive = true;
    const tick = async () => {
      const ui = await fetchCompanionUi();
      if (!alive) return;
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
    };
    tick();
    const id = setInterval(tick, 700);
    return () => { alive = false; clearInterval(id); };
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
    AI: ['aiPanel', 'show'],
    NEWS: ['newsPanel', 'show'],
    MEMO: ['memoPanel', 'show'],
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
    AI: isPanelVisible('AI'),
    NEWS: isPanelVisible('NEWS'),
    MEMO: isPanelVisible('MEMO'),
  };

  const { weatherBundle } = useWeatherData();

  // Weather may still be loading or offline. Production never renders the
  // bundled mock values as though they were current observations.
  const weatherData = weatherBundle.summary;
  const weatherAvailable = !productionMode || weatherBundle.source === 'live';

  // In production, null means OFFLINE and [] means a real connected empty
  // state. Mock data remains available only to the standalone overlay preview.
  const { data: companion, online: companionOnline, refresh: refreshCompanion } = useCompanionData();
  const connected = companionOnline;
  const liveNews = companion ? companion.news : productionMode ? [] : undefined;
  const liveAi = companion?.ai ?? (productionMode ? OFFLINE_AI : undefined);
  const liveSpotify = companion?.spotify ?? (productionMode ? OFFLINE_SPOTIFY : undefined);
  const liveMemos = companion ? companion.memos : productionMode ? [] : undefined;
  const newsSource = companion ? 'live' : productionMode ? 'offline' : undefined;

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
          width: effectiveSettings.weatherCompact.displayMode === 'detailed' ? Math.max(layout.weatherCompact.width, 360) : layout.weatherCompact.width,
          transform: effectiveSettings.weatherCompact.displayMode === 'detailed' ? `scale(${effectiveSettings.weatherDetail?.fontSize !== undefined ? effectiveSettings.weatherDetail.fontSize : 1})` : 'none',
          transformOrigin: 'top left'
        }}>
            {!weatherAvailable ? (
              <div className="overlay-empty-state">WEATHER / OFFLINE</div>
            ) : effectiveSettings.weatherCompact.displayMode === 'detailed' ? (
              <div 
                className={`weather-compact ${effectiveSettings.debugMode ? 'debug-mode' : ''}`}
                style={{ 
                  width: '100%', 
                  background: effectiveSettings.weatherDetail?.showBackground !== false ? `rgba(0,0,0,${effectiveSettings.weatherDetail?.backgroundOpacity !== undefined ? effectiveSettings.weatherDetail.backgroundOpacity : 0.4})` : 'transparent',
                  borderRadius: '8px', 
                  backdropFilter: effectiveSettings.weatherDetail?.showBackground !== false ? 'blur(8px)' : 'none',
                  border: effectiveSettings.weatherDetail?.showBackground !== false ? '1px solid rgba(255,255,255,0.1)' : 'none'
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
            visible={panelVisibility.LYRICS}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.lyricsPanel?.showHeader !== false}
            showBackground={effectiveSettings.lyricsPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.lyricsPanel?.backgroundOpacity ?? 0.34}
          >
            <LyricsPanel settings={effectiveSettings.lyricsPanel} spotify={liveSpotify} offline={productionMode && !connected} />
          </FloatingPanel>
        )}
        {layout.aiPanel && (
          <FloatingPanel
            title="AI"
            layout={layout.aiPanel}
            visible={panelVisibility.AI}
            debugMode={effectiveSettings.debugMode}
            showHeader={effectiveSettings.aiPanel?.showHeader !== false}
            showBackground={effectiveSettings.aiPanel?.showBackground !== false}
            backgroundOpacity={effectiveSettings.aiPanel?.backgroundOpacity ?? 0.4}
          >
            <AiPanel
              settings={effectiveSettings.aiPanel}
              ai={liveAi}
              offline={productionMode && !connected}
              onSend={async (text) => {
                const ok = await sendCompanionChat(text);
                await refreshCompanion();
                return ok;
              }}
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
          >
            <MemoPanel settings={effectiveSettings.memoPanel} memos={liveMemos} offline={productionMode && !connected} />
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

        {productionMode && (
          <div className={`companion-connection ${connected ? 'is-live' : 'is-offline'}`}>
            COMPANION: {connected ? 'LIVE' : 'OFFLINE'}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
