import { useState, useEffect, useRef } from 'react';
import { overlayLayout as defaultLayout, DOCK_BASE_HEIGHT } from './config/layout';
import { uiSettings as defaultUiSettings } from './config/uiSettings';
import ClockWidget from './components/ClockWidget';
import WeatherCompact from './components/WeatherCompact';
import WeatherDetailPanel from './components/panels/WeatherDetailPanel';
import RightDock from './components/RightDock';
import type { PanelId } from './components/RightDock';
import DetailPanel from './components/DetailPanel';
import FloatingPanel from './components/FloatingPanel';
import NewsPanel from './components/panels/NewsPanel';
import MusicPanel from './components/panels/MusicPanel';
import AiPanel from './components/panels/AiPanel';
import MemoPanel from './components/panels/MemoPanel';
import DebugGuide from './components/DebugGuide';
import { useWeatherData } from './hooks/useWeatherData';
import { useCompanionData } from './hooks/useCompanionData';
import { fetchCompanionUi, pushCompanionUi } from './services/companionClient';
import './styles/base.css';
import './styles/overlay.css';
import './styles/weather.css';

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scale, setScale] = useState(1);

  // Shallow-merge with defaults so settings sections added after a user's
  // localStorage snapshot (e.g. newsPanel/musicPanel) still get their defaults.
  const [layout, setLayout] = useState(() => {
    const saved = localStorage.getItem('tohoku_ui_layout');
    return saved ? { ...defaultLayout, ...JSON.parse(saved) } : defaultLayout;
  });

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('tohoku_ui_settings');
    return saved ? { ...defaultUiSettings, ...JSON.parse(saved) } : defaultUiSettings;
  });

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
  const companionSync = useRef<{ adopted: boolean; lastPresetId?: string | null; skipPush: boolean }>(
    { adopted: false, lastPresetId: undefined, skipPush: false }
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
      const presetChanged = (ui.activePresetId ?? null) !== (companionSync.current.lastPresetId ?? null);
      if (hasSettings && (first || presetChanged)) {
        companionSync.current.skipPush = true; // don't echo an adopted value back
        if (ui.layout && Object.keys(ui.layout).length) {
          setLayout({ ...defaultLayout, ...ui.layout });
        }
        setSettings({ ...defaultUiSettings, ...ui.settings });
      }
      companionSync.current.adopted = true;
      companionSync.current.lastPresetId = ui.activePresetId ?? null;
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Debounced push of local layout/settings to the Companion.
  useEffect(() => {
    if (!companionConnected) return;
    if (companionSync.current.skipPush) { companionSync.current.skipPush = false; return; }
    const id = setTimeout(() => { pushCompanionUi(layout, settings); }, 600);
    return () => clearTimeout(id);
  }, [layout, settings, companionConnected]);

  const [baseWidth, baseHeight] = (settings.baseResolution || '1920x1080').split('x').map(Number);

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
    baseWidth - dock.width, baseHeight - (DOCK_BASE_HEIGHT + 5 * dock.gap));
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

  // Each dock button maps to a settings flag. WEATHER reuses the existing left
  // module's flag; the rest use their panel's own `show`. `!== false` keeps an
  // older saved object (missing the key) visible by default.
  const PANEL_FLAG: Record<PanelId, [string, string]> = {
    WEATHER: ['weatherCompact', 'showCompactWeather'],
    MUSIC: ['musicPanel', 'show'],
    AI: ['aiPanel', 'show'],
    NEWS: ['newsPanel', 'show'],
    MEMO: ['memoPanel', 'show'],
  };

  const isPanelVisible = (id: PanelId) => {
    const [section, key] = PANEL_FLAG[id];
    return settings[section]?.[key] !== false;
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
    AI: isPanelVisible('AI'),
    NEWS: isPanelVisible('NEWS'),
    MEMO: isPanelVisible('MEMO'),
  };

  const { weatherBundle } = useWeatherData();

  // Use the live/mock bundle data directly
  const weatherData = weatherBundle.summary;

  // Live panel data from the Companion App (null while offline → mock fallback).
  const { data: companion } = useCompanionData();
  const liveNews = companion?.news?.length ? companion.news : undefined;
  const liveAi = companion?.ai;
  const liveSpotify = companion?.spotify;
  const liveMemos = companion?.memos?.length ? companion.memos : undefined;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: settings.debugMode ? 'rgba(0,0,0,0.8)' : 'transparent',
      display: 'flex',
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
      overflow: 'hidden'
    }}>
      {/* Emergency Reset Button */}
      <button 
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
      </button>

      <div 
        className={`overlay-container ${settings.debugMode ? 'debug-mode' : ''}`}
        style={{
          width: `${baseWidth}px`,
          height: `${baseHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          opacity: settings.overlay.opacity,
        }}
      >
        {settings.debugMode && <DebugGuide layout={{...layout, canvas: {width: baseWidth, height: baseHeight}}} />}

        <ClockWidget layout={layout.clock} settings={settings.clock} debugMode={settings.debugMode} />
        {layout.weatherCompact && settings.weatherCompact?.showCompactWeather && (
          <div style={{
          position: 'absolute',
          left: layout.weatherCompact.x,
          top: layout.weatherCompact.y,
          width: settings.weatherCompact.displayMode === 'detailed' ? Math.max(layout.weatherCompact.width, 360) : layout.weatherCompact.width,
          transform: settings.weatherCompact.displayMode === 'detailed' ? `scale(${settings.weatherDetail?.fontSize !== undefined ? settings.weatherDetail.fontSize : 1})` : 'none',
          transformOrigin: 'top left'
        }}>
            {settings.weatherCompact.displayMode === 'detailed' ? (
              <div 
                className={`weather-compact ${settings.debugMode ? 'debug-mode' : ''}`}
                style={{ 
                  width: '100%', 
                  background: settings.weatherDetail?.showBackground !== false ? `rgba(0,0,0,${settings.weatherDetail?.backgroundOpacity !== undefined ? settings.weatherDetail.backgroundOpacity : 0.4})` : 'transparent', 
                  borderRadius: '8px', 
                  backdropFilter: settings.weatherDetail?.showBackground !== false ? 'blur(8px)' : 'none', 
                  border: settings.weatherDetail?.showBackground !== false ? '1px solid rgba(255,255,255,0.1)' : 'none' 
                }}
              >
                <WeatherDetailPanel weatherData={weatherData} weatherBundle={weatherBundle} pattern={settings.weatherDetail?.pattern || "diagonal"} settings={settings.weatherDetail} />
              </div>
            ) : (
              <WeatherCompact 
                layout={layout.weatherCompact} 
                settings={settings.weatherCompact} 
                weatherData={weatherData}
                debugMode={settings.debugMode} 
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
            debugMode={settings.debugMode}
            showHeader={settings.newsPanel?.showHeader !== false}
            showBackground={settings.newsPanel?.showBackground !== false}
            backgroundOpacity={settings.newsPanel?.backgroundOpacity ?? 0.4}
          >
            <NewsPanel settings={settings.newsPanel} items={liveNews} updatedAt={liveNews ? companion?.updatedAt : undefined} />
          </FloatingPanel>
        )}
        {layout.musicPanel && (
          <FloatingPanel
            title="MUSIC"
            layout={layout.musicPanel}
            visible={panelVisibility.MUSIC}
            debugMode={settings.debugMode}
            showHeader={settings.musicPanel?.showHeader !== false}
            showBackground={settings.musicPanel?.showBackground !== false}
            backgroundOpacity={settings.musicPanel?.backgroundOpacity ?? 0.4}
          >
            <MusicPanel settings={settings.musicPanel} spotify={liveSpotify} />
          </FloatingPanel>
        )}
        {layout.aiPanel && (
          <FloatingPanel
            title="AI"
            layout={layout.aiPanel}
            visible={panelVisibility.AI}
            debugMode={settings.debugMode}
            showHeader={settings.aiPanel?.showHeader !== false}
            showBackground={settings.aiPanel?.showBackground !== false}
            backgroundOpacity={settings.aiPanel?.backgroundOpacity ?? 0.4}
          >
            <AiPanel settings={settings.aiPanel} ai={liveAi} />
          </FloatingPanel>
        )}
        {layout.memoPanel && (
          <FloatingPanel
            title="MEMO"
            layout={layout.memoPanel}
            visible={panelVisibility.MEMO}
            debugMode={settings.debugMode}
            showHeader={settings.memoPanel?.showHeader !== false}
            showBackground={settings.memoPanel?.showBackground !== false}
            backgroundOpacity={settings.memoPanel?.backgroundOpacity ?? 0.4}
          >
            <MemoPanel settings={settings.memoPanel} memos={liveMemos} />
          </FloatingPanel>
        )}

        <RightDock
          layout={layout.rightDock}
          debugMode={settings.debugMode}
          visibility={panelVisibility}
          onTogglePanel={togglePanel}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen(o => !o)}
        />

        <DetailPanel
          layout={layout.detailPanel}
          open={settingsOpen}
          debugMode={settings.debugMode}
          appLayout={layout}
          appSettings={settings}
          setLayout={setLayout}
          setSettings={setSettings}
          onReset={handleReset}
        />
      </div>
    </div>
  );
}

export default App;
