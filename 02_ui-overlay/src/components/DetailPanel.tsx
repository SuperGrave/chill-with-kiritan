import SettingsPanel from './panels/SettingsPanel';
import '../styles/panel.css';

interface DetailPanelProps {
  layout: { x: number; y: number; width: number; height: number };
  open: boolean;
  debugMode: boolean;
  appLayout: any;
  appSettings: any;
  setLayout: (layout: any) => void;
  setSettings: (settings: any) => void;
  onReset: () => void;
}

// The display panels (News/Music/AI/Memo/Weather) are now standalone floating
// modules. This overlay is just the Settings surface, opened from the dock gear.
const DetailPanel: React.FC<DetailPanelProps> = ({
  layout, open, debugMode, appLayout, appSettings, setLayout, setSettings, onReset,
}) => {
  return (
    <div
      className={`detail-panel-container ${open ? 'visible' : ''} ${debugMode ? 'debug-mode' : ''}`}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
    >
      <div className="panel-header">SETTINGS</div>
      <div className="panel-content">
        <SettingsPanel
          layout={appLayout}
          settings={appSettings}
          setLayout={setLayout}
          setSettings={setSettings}
          onReset={onReset}
        />
      </div>
    </div>
  );
};

export default DetailPanel;
