import { AudioLines, Captions, Cloud, Music, Newspaper, NotebookPen, Timer } from 'lucide-react';
import SettingsPanel from './panels/SettingsPanel';
import '../styles/panel.css';

type PanelId = 'WEATHER' | 'MUSIC' | 'LYRICS' | 'PERSONAL_NEWS' | 'SPECTRUM' | 'NEWS' | 'MEMO' | 'TIMER';

interface DetailPanelProps {
  layout: { x: number; y: number; width: number; height: number };
  open: boolean;
  debugMode: boolean;
  appLayout: any;
  appSettings: any;
  setLayout: (layout: any) => void;
  setSettings: (settings: any) => void;
  panelVisibility: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  onReset: () => void;
}

// The display panels (News/Music/Lyrics/Memo/Weather/Timer) are now standalone floating
// modules. This overlay is just the Settings surface, opened from the dock gear.
const DetailPanel: React.FC<DetailPanelProps> = ({
  layout, open, debugMode, appLayout, appSettings, setLayout, setSettings, panelVisibility, onTogglePanel, onReset,
}) => {
  const shortcuts: { id: PanelId; label: string; icon: React.ReactNode }[] = [
    { id: 'WEATHER', label: 'WEATHER', icon: <Cloud size={18} strokeWidth={1.5} /> },
    { id: 'MUSIC', label: 'MUSIC', icon: <Music size={18} strokeWidth={1.5} /> },
    { id: 'LYRICS', label: 'LYRICS', icon: <Captions size={18} strokeWidth={1.5} /> },
    { id: 'PERSONAL_NEWS', label: 'P-NEWS', icon: <Newspaper size={18} strokeWidth={1.5} /> },
    { id: 'SPECTRUM', label: 'SPECTRUM', icon: <AudioLines size={18} strokeWidth={1.5} /> },
    { id: 'NEWS', label: 'NEWS', icon: <Newspaper size={18} strokeWidth={1.5} /> },
    { id: 'MEMO', label: 'MEMO', icon: <NotebookPen size={18} strokeWidth={1.5} /> },
    { id: 'TIMER', label: 'TIMER', icon: <Timer size={18} strokeWidth={1.5} /> },
  ];

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
        <div className="panel-visibility-shortcuts" aria-label="Panel visibility shortcuts">
          {shortcuts.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`panel-visibility-button ${panelVisibility[item.id] ? 'active' : ''}`}
              onClick={() => onTogglePanel(item.id)}
              title={`${item.label} visibility`}
              aria-pressed={panelVisibility[item.id]}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
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
