import React from 'react';
import {
  newsPanelDefaults,
  musicPanelDefaults,
  lyricsPanelDefaults,
  personalNewsPanelDefaults,
  audioSpectrumPanelDefaults,
  memoPanelDefaults,
  timerPanelDefaults,
} from '../../config/uiSettings';

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

const ColorInput = ({ label, value, onChange }: any) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0', gap: '8px' }}>
    <span style={{ fontSize: '14px', opacity: 0.8 }}>{label}</span>
    <div style={{ display: 'grid', gridTemplateColumns: '40px 100px', gap: '8px', alignItems: 'center' }}>
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#b8dcff'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '40px', height: '30px', padding: '2px' }}
      />
      <input
        type="text"
        value={value || '#b8dcff'}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100px',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '4px',
          padding: '4px 8px'
        }}
      />
    </div>
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

  const [canvasW, canvasH] = (settings.baseResolution || '1920x1080').split('x').map(Number);

  // Merged views: saved values over defaults, so controls always show a value
  // even when the section is missing from an older localStorage snapshot.
  const np = { ...newsPanelDefaults, ...settings.newsPanel };
  const mp = { ...musicPanelDefaults, ...settings.musicPanel };
  const lp = { ...lyricsPanelDefaults, ...settings.lyricsPanel };
  const pp = { ...personalNewsPanelDefaults, ...settings.personalNewsPanel };
  const sp = { ...audioSpectrumPanelDefaults, ...settings.audioSpectrumPanel };
  const mm = { ...memoPanelDefaults, ...settings.memoPanel };
  const tp = { ...timerPanelDefaults, ...settings.timerPanel };

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
        <CheckRow label="Show Background" checked={settings.clock?.showBackground === true} onChange={(v: boolean) => updateClockSetting('showBackground', v)} />
        <SliderInput label="Background Opacity" value={settings.clock?.backgroundOpacity ?? 0.28} onChange={(v: number) => updateClockSetting('backgroundOpacity', v)} max={1} step={0.05} />
        <SliderInput label="Padding X" value={settings.clock?.paddingX ?? 0} onChange={(v: number) => updateClockSetting('paddingX', v)} max={120} />
        <SliderInput label="Padding Y" value={settings.clock?.paddingY ?? 0} onChange={(v: number) => updateClockSetting('paddingY', v)} max={120} />
        <SliderInput label="Date X Offset" value={settings.clock?.dateOffsetX ?? 0} onChange={(v: number) => updateClockSetting('dateOffsetX', v)} min={-400} max={400} />
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
              <CheckRow label="Show Background" checked={settings.weatherCompact?.showBackground === true} onChange={(v: boolean) => updateSection('weatherCompact', 'showBackground', v)} />
              <SliderInput label="Background Opacity" value={settings.weatherCompact?.backgroundOpacity ?? 0.28} onChange={(v: number) => updateSection('weatherCompact', 'backgroundOpacity', v)} max={1} step={0.05} />

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
                    <input type="checkbox" checked={settings.weatherDetail?.showBackground === true} onChange={(e) => updateSetting('weatherDetail', { ...settings.weatherDetail, showBackground: e.target.checked })} />
                  </div>
                  {settings.weatherDetail?.showBackground === true && (
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
        <CheckRow label="Source/Time In Title Row" checked={np.metaPlacement === 'titleLeft'} onChange={(v: boolean) => updateSection('newsPanel', 'metaPlacement', v ? 'titleLeft' : 'separate')} />
        <CheckRow label="Single-line Title Ellipsis" checked={np.singleLineTitle} onChange={(v: boolean) => updateSection('newsPanel', 'singleLineTitle', v)} />
        <SliderInput label="Max Items" value={np.maxItems} onChange={(v: number) => updateSection('newsPanel', 'maxItems', v)} min={1} max={20} />
        <SliderInput label="Max Title Lines (0=auto)" value={np.maxTitleLines} onChange={(v: number) => updateSection('newsPanel', 'maxTitleLines', v)} max={10} />
        <SliderInput label="Max Summary Lines (0=auto)" value={np.maxSummaryLines} onChange={(v: number) => updateSection('newsPanel', 'maxSummaryLines', v)} max={10} />
        <SectionDivider label="SIZES" />
        <SliderInput label="Header Content Gap" value={np.contentTopGap ?? 18} onChange={(v: number) => updateSection('newsPanel', 'contentTopGap', v)} max={160} />
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
        <SelectRow
          label="Artwork Mode"
          value={mp.artworkMode}
          onChange={(v: string) => updateSection('musicPanel', 'artworkMode', v)}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'topRight', label: 'Top Right' },
          ]}
        />
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
        <SliderInput label="Top-right Artwork Size" value={mp.artworkCornerSize ?? 0} onChange={(v: number) => updateSection('musicPanel', 'artworkCornerSize', v)} min={0} max={400} />
        <SliderInput label="Artwork Top Gap" value={mp.artworkTopGap ?? 0} onChange={(v: number) => updateSection('musicPanel', 'artworkTopGap', v)} min={0} max={160} />
        <SliderInput label="Artwork to Bar Gap" value={mp.artworkProgressGap ?? 20} onChange={(v: number) => updateSection('musicPanel', 'artworkProgressGap', v)} min={0} max={240} />
        <SliderInput label="Row Gap" value={mp.gap} onChange={(v: number) => updateSection('musicPanel', 'gap', v)} max={60} />
        <SliderInput label="Title Size" value={mp.titleSize} onChange={(v: number) => updateSection('musicPanel', 'titleSize', v)} min={10} max={60} />
        <SliderInput label="Artist Size" value={mp.artistSize} onChange={(v: number) => updateSection('musicPanel', 'artistSize', v)} min={8} max={40} />
        <SliderInput label="Time Size" value={mp.timeSize} onChange={(v: number) => updateSection('musicPanel', 'timeSize', v)} min={8} max={32} />
        <SliderInput label="Bar Height" value={mp.barHeight} onChange={(v: number) => updateSection('musicPanel', 'barHeight', v)} min={4} max={50} />
        <SliderInput label="Control Size" value={mp.controlSize} onChange={(v: number) => updateSection('musicPanel', 'controlSize', v)} min={12} max={60} />
      </Accordion>

      <Accordion title="Lyrics Panel" defaultOpen={false}>
        {renderPlacement('lyricsPanel', lp)}
        <SectionDivider label="DISPLAY" />
        <CheckRow label="Show Track Row" checked={lp.showTrack} onChange={(v: boolean) => updateSection('lyricsPanel', 'showTrack', v)} />
        <CheckRow label="Show Status Badge" checked={lp.showStatus} onChange={(v: boolean) => updateSection('lyricsPanel', 'showStatus', v)} />
        <SelectRow
          label="Text Align"
          value={lp.align}
          onChange={(v: string) => updateSection('lyricsPanel', 'align', v)}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
        />
        <SelectRow
          label="Long Line"
          value={lp.lineOverflowMode ?? 'wrap'}
          onChange={(v: string) => updateSection('lyricsPanel', 'lineOverflowMode', v)}
          options={[
            { value: 'wrap', label: 'Wrap' },
            { value: 'ellipsis', label: 'Ellipsis' },
          ]}
        />
        <SectionDivider label="SIZES" />
        <SliderInput label="Header Content Gap" value={lp.contentTopGap ?? 18} onChange={(v: number) => updateSection('lyricsPanel', 'contentTopGap', v)} max={160} />
        <SliderInput label="Current Line Size" value={lp.currentSize} onChange={(v: number) => updateSection('lyricsPanel', 'currentSize', v)} min={14} max={72} />
        <SliderInput label="Side Line Size" value={lp.sideSize} onChange={(v: number) => updateSection('lyricsPanel', 'sideSize', v)} min={10} max={48} />
        <SliderInput label="Meta Size" value={lp.metaSize} onChange={(v: number) => updateSection('lyricsPanel', 'metaSize', v)} min={8} max={28} />
        <SliderInput label="Line Gap" value={lp.lineGap} onChange={(v: number) => updateSection('lyricsPanel', 'lineGap', v)} max={60} />
        <SliderInput label="Side Opacity" value={lp.sideOpacity} onChange={(v: number) => updateSection('lyricsPanel', 'sideOpacity', v)} max={1} step={0.05} />
      </Accordion>

      <Accordion title="Personal News Panel" defaultOpen={false}>
        {renderPlacement('personalNewsPanel', pp)}
        <SectionDivider label="AUTO DISPLAY" />
        <CheckRow label="Show When Lyrics Unavailable" checked={pp.autoShowWhenLyricsUnavailable !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'autoShowWhenLyricsUnavailable', v)} />
        <CheckRow label="Hide Lyrics Panel When Auto Shown" checked={pp.hideLyricsWhenAutoShown !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'hideLyricsWhenAutoShown', v)} />
        <SectionDivider label="DISPLAY" />
        <CheckRow label="Show Status Badge" checked={pp.showStatus !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'showStatus', v)} />
        <CheckRow label="Show News Title" checked={pp.personalNewsShowTitle !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'personalNewsShowTitle', v)} />
        <CheckRow label="Show Topic" checked={pp.personalNewsShowTopic !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'personalNewsShowTopic', v)} />
        <CheckRow label="Show Body" checked={pp.personalNewsShowBody !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'personalNewsShowBody', v)} />
        <CheckRow label="Show Supplement" checked={pp.personalNewsShowSource !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'personalNewsShowSource', v)} />
        <CheckRow label="Show Progress" checked={pp.personalNewsShowProgress !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'personalNewsShowProgress', v)} />
        <CheckRow label="Show Chapter Marks" checked={pp.personalNewsShowChapterMarks !== false} onChange={(v: boolean) => updateSection('personalNewsPanel', 'personalNewsShowChapterMarks', v)} />
        <SliderInput label="News Title Size" value={pp.personalNewsTitleSize ?? 14} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsTitleSize', v)} min={8} max={32} />
        <SliderInput label="Topic Size" value={pp.personalNewsTopicSize ?? 17} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsTopicSize', v)} min={8} max={40} />
        <SliderInput label="Body Size" value={pp.personalNewsBodySize ?? 34} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsBodySize', v)} min={12} max={80} />
        <SliderInput label="Supplement Size" value={pp.personalNewsSourceSize ?? 12} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsSourceSize', v)} min={8} max={28} />
        <ColorInput label="Supplement Color" value={pp.personalNewsSupplementColor ?? '#b8dcff'} onChange={(v: string) => updateSection('personalNewsPanel', 'personalNewsSupplementColor', v)} />
        <SliderInput label="Progress Height" value={pp.personalNewsProgressHeight ?? 10} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsProgressHeight', v)} min={4} max={32} />
        <SliderInput label="News Gap" value={pp.personalNewsGap ?? 12} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsGap', v)} max={60} />
        <SliderInput label="Scroll Speed" value={pp.personalNewsScrollSpeed ?? 1} onChange={(v: number) => updateSection('personalNewsPanel', 'personalNewsScrollSpeed', v)} min={0.2} max={3} step={0.1} />
      </Accordion>

      <Accordion title="Audio Spectrum Panel" defaultOpen={false}>
        {renderPlacement('audioSpectrumPanel', sp)}
        <SectionDivider label="BARS" />
        <SliderInput label="Bar Count" value={sp.barCount ?? 24} onChange={(v: number) => updateSection('audioSpectrumPanel', 'barCount', v)} min={8} max={48} />
        <SliderInput label="Segments" value={sp.segmentCount ?? 14} onChange={(v: number) => updateSection('audioSpectrumPanel', 'segmentCount', v)} min={6} max={24} />
        <SliderInput label="Bar Gap" value={sp.barGap ?? 4} onChange={(v: number) => updateSection('audioSpectrumPanel', 'barGap', v)} min={1} max={16} />
        <SectionDivider label="RESPONSE" />
        <SliderInput label="Sensitivity" value={sp.sensitivity ?? 1} onChange={(v: number) => updateSection('audioSpectrumPanel', 'sensitivity', v)} min={0.2} max={3} step={0.1} />
        <SliderInput label="Decay Speed" value={sp.decaySpeed ?? 0.12} onChange={(v: number) => updateSection('audioSpectrumPanel', 'decaySpeed', v)} min={0.03} max={0.5} step={0.01} />
        <CheckRow label="Peak Hold" checked={sp.peakHold !== false} onChange={(v: boolean) => updateSection('audioSpectrumPanel', 'peakHold', v)} />
        <SliderInput label="Peak Fall Speed" value={sp.peakFallSpeed ?? 0.008} onChange={(v: number) => updateSection('audioSpectrumPanel', 'peakFallSpeed', v)} min={0.002} max={0.05} step={0.002} />
        <SectionDivider label="STYLE" />
        <CheckRow label="Mirror Layout" checked={sp.mirror === true} onChange={(v: boolean) => updateSection('audioSpectrumPanel', 'mirror', v)} />
        <SelectRow
          label="Color Mode"
          value={sp.colorMode ?? 'mono'}
          onChange={(v: string) => updateSection('audioSpectrumPanel', 'colorMode', v)}
          options={[
            { value: 'mono', label: 'Mono' },
            { value: 'heat', label: 'Heat' },
          ]}
        />
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
        <SliderInput label="Header Content Gap" value={mm.contentTopGap ?? 18} onChange={(v: number) => updateSection('memoPanel', 'contentTopGap', v)} max={160} />
        <SliderInput label="Text Size" value={mm.textSize} onChange={(v: number) => updateSection('memoPanel', 'textSize', v)} min={10} max={32} />
        <SliderInput label="Date Size" value={mm.dateSize} onChange={(v: number) => updateSection('memoPanel', 'dateSize', v)} min={8} max={24} />
        <SliderInput label="Card Gap" value={mm.cardGap} onChange={(v: number) => updateSection('memoPanel', 'cardGap', v)} max={60} />
        <SliderInput label="Card Padding" value={mm.cardPadding} onChange={(v: number) => updateSection('memoPanel', 'cardPadding', v)} max={40} />
      </Accordion>

      <Accordion title="Timer Panel" defaultOpen={false}>
        {renderPlacement('timerPanel', tp)}
        <SectionDivider label="DISPLAY" />
        <SelectRow
          label="Mode"
          value={tp.mode}
          onChange={(v: string) => updateSection('timerPanel', 'mode', v)}
          options={[
            { value: 'timer', label: 'Timer' },
            { value: 'pomodoro', label: 'Pomodoro' },
          ]}
        />
        <CheckRow label="Show Controls" checked={tp.showControls} onChange={(v: boolean) => updateSection('timerPanel', 'showControls', v)} />
        <CheckRow label="Show Cycle" checked={tp.showCycle} onChange={(v: boolean) => updateSection('timerPanel', 'showCycle', v)} />
        <SectionDivider label="DURATIONS" />
        <SliderInput label="Timer Minutes" value={tp.timerMinutes} onChange={(v: number) => updateSection('timerPanel', 'timerMinutes', v)} min={1} max={180} />
        <SliderInput label="Focus Minutes" value={tp.pomodoroMinutes} onChange={(v: number) => updateSection('timerPanel', 'pomodoroMinutes', v)} min={1} max={90} />
        <SliderInput label="Short Break Minutes" value={tp.shortBreakMinutes} onChange={(v: number) => updateSection('timerPanel', 'shortBreakMinutes', v)} min={1} max={30} />
        <SliderInput label="Long Break Minutes" value={tp.longBreakMinutes} onChange={(v: number) => updateSection('timerPanel', 'longBreakMinutes', v)} min={1} max={60} />
        <SectionDivider label="SIZES" />
        <SliderInput label="Header Content Gap" value={tp.contentTopGap ?? 18} onChange={(v: number) => updateSection('timerPanel', 'contentTopGap', v)} max={160} />
        <SliderInput label="Title Size" value={tp.titleSize} onChange={(v: number) => updateSection('timerPanel', 'titleSize', v)} min={10} max={52} />
        <SliderInput label="Time Size" value={tp.timeSize} onChange={(v: number) => updateSection('timerPanel', 'timeSize', v)} min={24} max={110} />
        <SliderInput label="Meta Size" value={tp.metaSize} onChange={(v: number) => updateSection('timerPanel', 'metaSize', v)} min={8} max={28} />
        <SliderInput label="Bar Height" value={tp.barHeight ?? 12} onChange={(v: number) => updateSection('timerPanel', 'barHeight', v)} min={4} max={50} />
        <SliderInput label="Element Gap" value={tp.itemGap ?? 6} onChange={(v: number) => updateSection('timerPanel', 'itemGap', v)} min={0} max={40} />
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
