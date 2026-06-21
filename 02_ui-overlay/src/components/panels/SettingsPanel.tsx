import React from 'react';
import {
  newsPanelDefaults,
  musicPanelDefaults,
  aiPanelDefaults,
  memoPanelDefaults,
} from '../../config/uiSettings';
import { DOCK_BASE_HEIGHT } from '../../config/layout';

interface SettingsPanelProps {
  layout: any;
  settings: any;
  setLayout: (layout: any) => void;
  setSettings: (settings: any) => void;
  onReset: () => void;
}

const SliderInput = ({ label, value, onChange, min = 0, max = 2000, step = 1 }: any) => (
  <div style={{ margin: '8px 0' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
      <span style={{ fontSize: '14px', opacity: 0.8 }}>{label}</span>
      <input 
        type="number" 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        style={{
          width: '60px',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '4px',
          padding: '2px 4px',
          textAlign: 'right'
        }}
      />
    </div>
    <input 
      type="range"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      style={{ width: '100%', cursor: 'pointer' }}
    />
  </div>
);

const TextInput = ({ label, value, onChange }: any) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
    <span style={{ fontSize: '14px', opacity: 0.8 }}>{label}</span>
    <input 
      type="text" 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '120px',
        background: 'rgba(0,0,0,0.5)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '4px',
        padding: '4px 8px'
      }}
    />
  </div>
);

const CheckRow = ({ label, checked, onChange }: any) => (
  <div className="settings-row" style={{ marginBottom: '4px', padding: '8px 0' }}>
    <span>{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{ width: '18px', height: '18px' }}
    />
  </div>
);

const SelectRow = ({ label, value, onChange, options }: any) => (
  <div style={{ margin: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: '14px', opacity: 0.8 }}>{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '4px', padding: '4px 8px'
      }}
    >
      {options.map((o: { value: string; label: string }) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

const SectionDivider = ({ label }: any) => (
  <div style={{ marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
    <span style={{ fontSize: '12px', color: '#888' }}>{label}</span>
  </div>
);

const Accordion = ({ title, defaultOpen = false, children }: any) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  return (
    <div style={{ marginBottom: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          padding: '12px 16px', 
          cursor: 'pointer', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: isOpen ? 'rgba(255,255,255,0.05)' : 'transparent',
          transition: 'background 0.2s'
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.05em', color: isOpen ? '#fff' : '#aaa' }}>{title}</span>
        <span style={{ fontSize: '12px', opacity: 0.5, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </div>
      {isOpen && (
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {children}
        </div>
      )}
    </div>
  );
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ layout, settings, setLayout, setSettings, onReset }) => {

  const updateSetting = (key: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }));
  };

  const updateClockSetting = (key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      clock: { ...prev.clock, [key]: value }
    }));
  };

  const updateSection = (section: string, key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value }
    }));
  };

  // The dock and the settings overlay are the only way back into this panel,
  // so their position sliders must not be able to push them off-canvas.
  const [canvasW, canvasH] = (settings.baseResolution || '1920x1080').split('x').map(Number);
  const dockMaxX = canvasW - (layout.rightDock.width ?? 110);
  const dockMaxY = canvasH - (DOCK_BASE_HEIGHT + 5 * (layout.rightDock.gap ?? 16));

  // Merged views: saved values over defaults, so controls always show a value
  // even when the section is missing from an older localStorage snapshot.
  const np = { ...newsPanelDefaults, ...settings.newsPanel };
  const mp = { ...musicPanelDefaults, ...settings.musicPanel };
  const ap = { ...aiPanelDefaults, ...settings.aiPanel };
  const mm = { ...memoPanelDefaults, ...settings.memoPanel };

  const updateLayout = (component: string, key: string, value: number) => {
    setLayout((prev: any) => ({
      ...prev,
      [component]: {
        ...prev[component],
        [key]: value
      }
    }));
  };

  // Shared PLACEMENT block — every standalone panel gets the same free-position
  // controls as the clock/weather: show toggle, X/Y/W/H, header & background.
  const renderPlacement = (section: string, merged: any) => {
    const lo = layout[section] || { x: 0, y: 0, width: 0, height: 0 };
    return (
      <>
        <SectionDivider label="PLACEMENT" />
        <CheckRow label="Show Panel" checked={merged.show !== false} onChange={(v: boolean) => updateSection(section, 'show', v)} />
        <SliderInput label="X Position" value={lo.x} onChange={(v: number) => updateLayout(section, 'x', v)} />
        <SliderInput label="Y Position" value={lo.y} onChange={(v: number) => updateLayout(section, 'y', v)} />
        <SliderInput label="Width" value={lo.width} onChange={(v: number) => updateLayout(section, 'width', v)} />
        <SliderInput label="Height" value={lo.height} onChange={(v: number) => updateLayout(section, 'height', v)} max={1200} />
        <CheckRow label="Show Header" checked={merged.showHeader !== false} onChange={(v: boolean) => updateSection(section, 'showHeader', v)} />
        <CheckRow label="Show Background" checked={merged.showBackground !== false} onChange={(v: boolean) => updateSection(section, 'showBackground', v)} />
        {merged.showBackground !== false && (
          <SliderInput label="Background Opacity" value={merged.backgroundOpacity ?? 0.4} onChange={(v: number) => updateSection(section, 'backgroundOpacity', v)} max={1} step={0.05} />
        )}
      </>
    );
  };

  return (
    <div style={{ paddingBottom: '40px', overflowY: 'auto', height: '100%', paddingRight: '8px' }}>
      
      <Accordion title="General / Debug" defaultOpen={false}>
        <div style={{ margin: '8px 0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', opacity: 0.8 }}>Base Resolution</span>
          <select 
            value={settings.baseResolution || '1920x1080'} 
            onChange={(e) => updateSetting('baseResolution', e.target.value)}
            style={{
              background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px', padding: '4px 8px'
            }}
          >
            <option value="1920x1080">1920x1080 (16:9)</option>
            <option value="2560x1440">2560x1440 (16:9)</option>
            <option value="1366x768">1366x768 (16:9)</option>
            <option value="1920x1200">1920x1200 (16:10)</option>
            <option value="2240x1400">2240x1400 (16:10)</option>
            <option value="2560x1600">2560x1600 (16:10)</option>
            <option value="1440x900">1440x900 (16:10)</option>
            <option value="3440x1440">3440x1440 (21:9)</option>
          </select>
        </div>

        <div className="settings-row" style={{ marginBottom: '8px' }}>
          <span>Debug Guide Overlay</span>
          <input 
            type="checkbox" 
            checked={settings.debugMode} 
            onChange={(e) => updateSetting('debugMode', e.target.checked)} 
            style={{ width: '20px', height: '20px' }}
          />
        </div>
      </Accordion>

      <Accordion title="Clock Widget" defaultOpen={true}>
        <div className="settings-row" style={{ marginBottom: '16px' }}>
          <span>Show Seconds</span>
          <input 
            type="checkbox" 
            checked={settings.clock.showSeconds} 
            onChange={(e) => updateClockSetting('showSeconds', e.target.checked)} 
            style={{ width: '20px', height: '20px' }}
          />
        </div>
        <SliderInput label="X Position" value={layout.clock.x} onChange={(v: number) => updateLayout('clock', 'x', v)} />
        <SliderInput label="Y Position" value={layout.clock.y} onChange={(v: number) => updateLayout('clock', 'y', v)} />
        <SliderInput label="Width" value={layout.clock.width} onChange={(v: number) => updateLayout('clock', 'width', v)} />
        <SliderInput label="Date Font Size" value={layout.clock.dateSize || 24} onChange={(v: number) => updateLayout('clock', 'dateSize', v)} max={100} />
        <SliderInput label="Time Font Size" value={layout.clock.timeSize || 72} onChange={(v: number) => updateLayout('clock', 'timeSize', v)} max={200} />
      </Accordion>

      {layout.weatherCompact && settings.weatherCompact && (
        <Accordion title="Left Weather Module" defaultOpen={false}>
          <div className="settings-row" style={{ marginBottom: '16px' }}>
            <span>Show Left Weather</span>
            <input 
              type="checkbox" 
              checked={settings.weatherCompact?.showCompactWeather !== false} 
              onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showCompactWeather: e.target.checked })} 
              style={{ width: '20px', height: '20px' }}
            />
          </div>

          {settings.weatherCompact?.showCompactWeather !== false && (
            <>
              <div style={{ margin: '8px 0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', opacity: 0.8 }}>Display Mode</span>
                <select 
                  value={settings.weatherCompact.displayMode || 'compact'} 
                  onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, displayMode: e.target.value })}
                  style={{
                    background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px', padding: '4px 8px'
                  }}
                >
                  <option value="compact">Compact (Simplified)</option>
                  <option value="detailed">Detailed (Full Panel)</option>
                </select>
              </div>

              <SliderInput label="X Position" value={layout.weatherCompact.x} onChange={(v: number) => updateLayout('weatherCompact', 'x', v)} />
              <SliderInput label="Y Position" value={layout.weatherCompact.y} onChange={(v: number) => updateLayout('weatherCompact', 'y', v)} />
              <SliderInput label="Width" value={layout.weatherCompact.width} onChange={(v: number) => updateLayout('weatherCompact', 'width', v)} />

              {settings.weatherCompact.displayMode !== 'detailed' ? (
                <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Compact Mode Settings</div>
                  <SliderInput label="Bar Height" value={layout.weatherCompact.barHeight || 22} onChange={(v: number) => updateLayout('weatherCompact', 'barHeight', v)} max={100} />
                  <SliderInput label="Row Gap" value={layout.weatherCompact.rowGap || 8} onChange={(v: number) => updateLayout('weatherCompact', 'rowGap', v)} max={50} />
                  <SliderInput label="Font Size" value={layout.weatherCompact.fontSize || 25} onChange={(v: number) => updateLayout('weatherCompact', 'fontSize', v)} max={100} />
                  
                  <div className="settings-row" style={{ margin: '12px 0 4px' }}><span>Show Location</span><input type="checkbox" checked={settings.weatherCompact.showLocation} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showLocation: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Temp Bar</span><input type="checkbox" checked={settings.weatherCompact.showTemperature} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showTemperature: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Condition</span><input type="checkbox" checked={settings.weatherCompact.showWeather} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showWeather: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Humidity Bar</span><input type="checkbox" checked={settings.weatherCompact.showHumidity} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showHumidity: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Pressure</span><input type="checkbox" checked={settings.weatherCompact.showPressure} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showPressure: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Min/Max Labels</span><input type="checkbox" checked={settings.weatherCompact.showMinMaxLabels} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showMinMaxLabels: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Current Temp Marker</span><input type="checkbox" checked={settings.weatherCompact.showCurrentMarker !== false} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showCurrentMarker: e.target.checked })} /></div>
                  <div className="settings-row" style={{ marginBottom: '4px' }}><span>Show Current Temp Triangle</span><input type="checkbox" checked={settings.weatherCompact.showCurrentTriangle !== false} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, showCurrentTriangle: e.target.checked })} /></div>
                  <SliderInput label="Temp Scale Padding" value={settings.weatherCompact.temperaturePadding || 5} onChange={(v: number) => updateSetting('weatherCompact', { ...settings.weatherCompact, temperaturePadding: v })} max={20} />

                  <div style={{ margin: '16px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', opacity: 0.8 }}>Bar Pattern</span>
                    <select value={settings.weatherCompact.pattern || 'diagonal'} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, pattern: e.target.value })} style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px' }}>
                      <option value="diagonal">Diagonal Hatch</option><option value="vertical">Vertical Lines</option><option value="dot">Dots</option>
                    </select>
                  </div>
                  <div style={{ margin: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', opacity: 0.8 }}>Info Row Position</span>
                    <select value={settings.weatherCompact.infoRowPosition || 'top'} onChange={(e) => updateSetting('weatherCompact', { ...settings.weatherCompact, infoRowPosition: e.target.value })} style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px' }}>
                      <option value="top">Top (Line 1)</option><option value="bottom">Bottom (Line 3)</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Detailed Mode Settings</div>
                  <SliderInput label="Row Gap" value={settings.weatherDetail?.gap || 24} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, gap: v })} max={100} />
                  <SliderInput label="Global Scale" value={settings.weatherDetail?.fontSize || 1} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, fontSize: v })} max={3} step={0.1} />
                  
                  <div style={{ marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}><span style={{ fontSize: '12px', color: '#888' }}>PADDING</span></div>
                  <SliderInput label="Padding Top" value={settings.weatherDetail?.paddingTop || 16} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, paddingTop: v })} max={100} />
                  <SliderInput label="Padding Bottom" value={settings.weatherDetail?.paddingBottom || 24} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, paddingBottom: v })} max={100} />
                  <SliderInput label="Padding Left/Right" value={settings.weatherDetail?.paddingX || 32} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, paddingX: v })} max={100} />

                  <div style={{ marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}><span style={{ fontSize: '12px', color: '#888' }}>FONT SIZES</span></div>
                  <SliderInput label="Main Temp Size" value={settings.weatherDetail?.mainTempSize || 96} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, mainTempSize: v })} max={200} />
                  <SliderInput label="Min/Max Temp Size" value={settings.weatherDetail?.minMaxTempSize || 28} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, minMaxTempSize: v })} max={100} />
                  <SliderInput label="Feels Like Size" value={settings.weatherDetail?.feelsLikeSize || 24} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, feelsLikeSize: v })} max={100} />
                  <SliderInput label="Metric Label Size" value={settings.weatherDetail?.metricLabelSize || 14} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, metricLabelSize: v })} max={50} />
                  <SliderInput label="Metric Value Size" value={settings.weatherDetail?.metricValueSize || 14} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, metricValueSize: v })} max={50} />
                  <SliderInput label="Wind & Sun Size" value={settings.weatherDetail?.windSunSize || 24} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, windSunSize: v })} max={100} />
                  <SliderInput label="Note Text Size" value={settings.weatherDetail?.noteSize || 15} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, noteSize: v })} max={50} />
                  <SliderInput label="Max Note Lines (0=auto)" value={settings.weatherDetail?.maxNoteLines || 0} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, maxNoteLines: v })} max={20} />
                  <SliderInput label="Footer Size" value={settings.weatherDetail?.footerSize || 18} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, footerSize: v })} max={50} />

                  <div style={{ marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}><span style={{ fontSize: '12px', color: '#888' }}>ICON SIZES</span></div>
                  <SliderInput label="Main Icon Size" value={settings.weatherDetail?.mainIconSize || 84} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, mainIconSize: v })} max={200} />
                  <SliderInput label="Compass Size" value={settings.weatherDetail?.compassSize || 84} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, compassSize: v })} max={200} />
                  <SliderInput label="Sun Icon Size" value={settings.weatherDetail?.sunIconSize || 28} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, sunIconSize: v })} max={100} />

                  <div style={{ marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}><span style={{ fontSize: '12px', color: '#888' }}>APPEARANCE</span></div>
                  <div className="settings-row" style={{ marginTop: '8px', marginBottom: '8px' }}>
                    <span>Show Background</span>
                    <input type="checkbox" checked={settings.weatherDetail?.showBackground !== false} onChange={(e) => updateSetting('weatherDetail', { ...settings.weatherDetail, showBackground: e.target.checked })} />
                  </div>
                  {settings.weatherDetail?.showBackground !== false && (
                    <SliderInput label="Background Opacity" value={settings.weatherDetail?.backgroundOpacity || 0.4} onChange={(v: number) => updateSetting('weatherDetail', { ...settings.weatherDetail, backgroundOpacity: v })} max={1} step={0.1} />
                  )}

                  <div style={{ margin: '16px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', opacity: 0.8 }}>Bar Pattern</span>
                    <select value={settings.weatherDetail?.pattern || 'diagonal'} onChange={(e) => updateSetting('weatherDetail', { ...settings.weatherDetail, pattern: e.target.value })} style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px' }}>
                      <option value="diagonal">Diagonal Hatch</option><option value="vertical">Vertical Lines</option><option value="dot">Dots</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
        </Accordion>
      )}

      <Accordion title="Right Dock" defaultOpen={false}>
        <SliderInput label="X Position" value={layout.rightDock.x} onChange={(v: number) => updateLayout('rightDock', 'x', v)} max={dockMaxX} />
        <SliderInput label="Y Position" value={layout.rightDock.y} onChange={(v: number) => updateLayout('rightDock', 'y', v)} max={dockMaxY} />
        <SliderInput label="Button Gap" value={layout.rightDock.gap} onChange={(v: number) => updateLayout('rightDock', 'gap', v)} max={100} />
      </Accordion>

      <Accordion title="Settings Overlay" defaultOpen={false}>
        <SliderInput label="X Position" value={layout.detailPanel.x} onChange={(v: number) => updateLayout('detailPanel', 'x', v)} max={canvasW - 100} />
        <SliderInput label="Y Position" value={layout.detailPanel.y} onChange={(v: number) => updateLayout('detailPanel', 'y', v)} max={canvasH - 100} />
        <SliderInput label="Width" value={layout.detailPanel.width} onChange={(v: number) => updateLayout('detailPanel', 'width', v)} />
        <SliderInput label="Height" value={layout.detailPanel.height} onChange={(v: number) => updateLayout('detailPanel', 'height', v)} />
      </Accordion>

      <Accordion title="News Panel" defaultOpen={false}>
        {renderPlacement('newsPanel', np)}
        <SectionDivider label="DISPLAY" />
        <CheckRow label="Show Index Number" checked={np.showIndex} onChange={(v: boolean) => updateSection('newsPanel', 'showIndex', v)} />
        <CheckRow label="Show Time" checked={np.showTime} onChange={(v: boolean) => updateSection('newsPanel', 'showTime', v)} />
        <CheckRow label="Show Source" checked={np.showSource} onChange={(v: boolean) => updateSection('newsPanel', 'showSource', v)} />
        <CheckRow label="Show Summary" checked={np.showSummary} onChange={(v: boolean) => updateSection('newsPanel', 'showSummary', v)} />
        <CheckRow label="Show Divider" checked={np.showDivider} onChange={(v: boolean) => updateSection('newsPanel', 'showDivider', v)} />
        <CheckRow label="Show Footer" checked={np.showFooter} onChange={(v: boolean) => updateSection('newsPanel', 'showFooter', v)} />
        <CheckRow label="Highlight Latest" checked={np.highlightLatest} onChange={(v: boolean) => updateSection('newsPanel', 'highlightLatest', v)} />
        <SliderInput label="Max Items" value={np.maxItems} onChange={(v: number) => updateSection('newsPanel', 'maxItems', v)} min={1} max={20} />
        <SliderInput label="Max Title Lines (0=auto)" value={np.maxTitleLines} onChange={(v: number) => updateSection('newsPanel', 'maxTitleLines', v)} max={10} />
        <SliderInput label="Max Summary Lines (0=auto)" value={np.maxSummaryLines} onChange={(v: number) => updateSection('newsPanel', 'maxSummaryLines', v)} max={10} />
        <SectionDivider label="SIZES" />
        <SliderInput label="Item Gap" value={np.itemGap} onChange={(v: number) => updateSection('newsPanel', 'itemGap', v)} max={60} />
        <SliderInput label="Index Size" value={np.indexSize} onChange={(v: number) => updateSection('newsPanel', 'indexSize', v)} min={10} max={60} />
        <SliderInput label="Time Size" value={np.timeSize} onChange={(v: number) => updateSection('newsPanel', 'timeSize', v)} min={8} max={40} />
        <SliderInput label="Title Size" value={np.titleSize} onChange={(v: number) => updateSection('newsPanel', 'titleSize', v)} min={10} max={40} />
        <SliderInput label="Summary Size" value={np.summarySize} onChange={(v: number) => updateSection('newsPanel', 'summarySize', v)} min={8} max={32} />
        <SliderInput label="Footer Size" value={np.footerSize} onChange={(v: number) => updateSection('newsPanel', 'footerSize', v)} min={8} max={32} />
      </Accordion>

      <Accordion title="Music Panel" defaultOpen={false}>
        {renderPlacement('musicPanel', mp)}
        <SectionDivider label="DISPLAY" />
        <CheckRow label="Show Artwork" checked={mp.showArtwork} onChange={(v: boolean) => updateSection('musicPanel', 'showArtwork', v)} />
        <CheckRow label="Show Album Name" checked={mp.showAlbum} onChange={(v: boolean) => updateSection('musicPanel', 'showAlbum', v)} />
        <CheckRow label="Show Time Codes" checked={mp.showTimeCodes} onChange={(v: boolean) => updateSection('musicPanel', 'showTimeCodes', v)} />
        <CheckRow label="Show Controls" checked={mp.showControls} onChange={(v: boolean) => updateSection('musicPanel', 'showControls', v)} />
        <CheckRow label="Show Footer" checked={mp.showFooter} onChange={(v: boolean) => updateSection('musicPanel', 'showFooter', v)} />
        <CheckRow label="Show Progress Marker" checked={mp.showMarker} onChange={(v: boolean) => updateSection('musicPanel', 'showMarker', v)} />
        <SelectRow
          label="Bar Pattern"
          value={mp.pattern}
          onChange={(v: string) => updateSection('musicPanel', 'pattern', v)}
          options={[
            { value: 'diagonal', label: 'Diagonal Hatch' },
            { value: 'vertical', label: 'Vertical Lines' },
            { value: 'dot', label: 'Dots' },
          ]}
        />
        <SectionDivider label="SIZES" />
        <SliderInput label="Artwork Scale" value={mp.artworkScale} onChange={(v: number) => updateSection('musicPanel', 'artworkScale', v)} min={0.3} max={1} step={0.05} />
        <SliderInput label="Row Gap" value={mp.gap} onChange={(v: number) => updateSection('musicPanel', 'gap', v)} max={60} />
        <SliderInput label="Title Size" value={mp.titleSize} onChange={(v: number) => updateSection('musicPanel', 'titleSize', v)} min={10} max={60} />
        <SliderInput label="Artist Size" value={mp.artistSize} onChange={(v: number) => updateSection('musicPanel', 'artistSize', v)} min={8} max={40} />
        <SliderInput label="Time Size" value={mp.timeSize} onChange={(v: number) => updateSection('musicPanel', 'timeSize', v)} min={8} max={32} />
        <SliderInput label="Bar Height" value={mp.barHeight} onChange={(v: number) => updateSection('musicPanel', 'barHeight', v)} min={4} max={50} />
        <SliderInput label="Control Size" value={mp.controlSize} onChange={(v: number) => updateSection('musicPanel', 'controlSize', v)} min={12} max={60} />
      </Accordion>

      <Accordion title="AI Panel" defaultOpen={false}>
        {renderPlacement('aiPanel', ap)}
        <SectionDivider label="DISPLAY" />
        <CheckRow label="Show Role Labels" checked={ap.showLabels} onChange={(v: boolean) => updateSection('aiPanel', 'showLabels', v)} />
        <CheckRow label="Show Timestamps" checked={ap.showTimestamps} onChange={(v: boolean) => updateSection('aiPanel', 'showTimestamps', v)} />
        <CheckRow label="Show Status Row" checked={ap.showStatus} onChange={(v: boolean) => updateSection('aiPanel', 'showStatus', v)} />
        <CheckRow label="Show Input Row" checked={ap.showInput} onChange={(v: boolean) => updateSection('aiPanel', 'showInput', v)} />
        <SectionDivider label="SIZES" />
        <SliderInput label="Text Size" value={ap.textSize} onChange={(v: number) => updateSection('aiPanel', 'textSize', v)} min={10} max={32} />
        <SliderInput label="Label Size" value={ap.labelSize} onChange={(v: number) => updateSection('aiPanel', 'labelSize', v)} min={8} max={24} />
        <SliderInput label="Timestamp Size" value={ap.timeSize} onChange={(v: number) => updateSection('aiPanel', 'timeSize', v)} min={8} max={24} />
        <SliderInput label="Message Gap" value={ap.msgGap} onChange={(v: number) => updateSection('aiPanel', 'msgGap', v)} max={60} />
        <SliderInput label="Bubble Opacity" value={ap.bubbleOpacity} onChange={(v: number) => updateSection('aiPanel', 'bubbleOpacity', v)} max={1} step={0.02} />
      </Accordion>

      <Accordion title="Memo Panel" defaultOpen={false}>
        {renderPlacement('memoPanel', mm)}
        <SectionDivider label="DISPLAY" />
        <CheckRow label="Show Dates" checked={mm.showDates} onChange={(v: boolean) => updateSection('memoPanel', 'showDates', v)} />
        <CheckRow label="Pinned Section" checked={mm.showPinnedSection} onChange={(v: boolean) => updateSection('memoPanel', 'showPinnedSection', v)} />
        <CheckRow label="Show Footer" checked={mm.showFooter} onChange={(v: boolean) => updateSection('memoPanel', 'showFooter', v)} />
        <SliderInput label="Max Items (0=all)" value={mm.maxItems} onChange={(v: number) => updateSection('memoPanel', 'maxItems', v)} max={20} />
        <SliderInput label="Max Lines / Memo (0=auto)" value={mm.maxLines} onChange={(v: number) => updateSection('memoPanel', 'maxLines', v)} max={20} />
        <SectionDivider label="SIZES" />
        <SliderInput label="Text Size" value={mm.textSize} onChange={(v: number) => updateSection('memoPanel', 'textSize', v)} min={10} max={32} />
        <SliderInput label="Date Size" value={mm.dateSize} onChange={(v: number) => updateSection('memoPanel', 'dateSize', v)} min={8} max={24} />
        <SliderInput label="Card Gap" value={mm.cardGap} onChange={(v: number) => updateSection('memoPanel', 'cardGap', v)} max={60} />
        <SliderInput label="Card Padding" value={mm.cardPadding} onChange={(v: number) => updateSection('memoPanel', 'cardPadding', v)} max={40} />
      </Accordion>

      <Accordion title="Test Data Overrides" defaultOpen={false}>
        <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px', lineHeight: 1.4 }}>These override the live API data for layout testing purposes. Clear them to see live data again.</div>
        <TextInput label="Location" value={settings.clock.customLocation || ""} onChange={(v: string) => updateClockSetting('customLocation', v)} />
        <TextInput label="Temp" value={settings.clock.customWeatherTemp || ""} onChange={(v: string) => updateClockSetting('customWeatherTemp', v)} />
        <TextInput label="Weather" value={settings.clock.customWeatherDesc || ""} onChange={(v: string) => updateClockSetting('customWeatherDesc', v)} />
        <TextInput label="Humidity" value={settings.clock.customHumidity || ""} onChange={(v: string) => updateClockSetting('customHumidity', v)} />
      </Accordion>

      <button 
        onClick={onReset}
        style={{
          width: '100%',
          padding: '12px',
          background: 'rgba(255, 50, 50, 0.2)',
          border: '1px solid rgba(255, 50, 50, 0.5)',
          color: '#fff',
          borderRadius: '8px',
          cursor: 'pointer',
          marginTop: '16px'
        }}
      >
        Reset to Defaults
      </button>

    </div>
  );
};

export default SettingsPanel;
