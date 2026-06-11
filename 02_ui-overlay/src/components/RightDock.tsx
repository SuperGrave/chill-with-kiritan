import { Cloud, Music, Bot, Newspaper, NotebookPen, Settings } from 'lucide-react';
import '../styles/dock.css';

export type PanelId = 'WEATHER' | 'MUSIC' | 'AI' | 'NEWS' | 'MEMO';

interface RightDockProps {
  layout: { x: number; y: number; width: number; gap: number };
  debugMode: boolean;
  visibility: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

// The dock no longer swaps a shared panel — each button toggles the show/hide
// of its standalone floating panel (active = currently visible). The gear opens
// the Settings overlay.
const RightDock: React.FC<RightDockProps> = ({
  layout, debugMode, visibility, onTogglePanel, settingsOpen, onToggleSettings,
}) => {
  const buttons: { id: PanelId; label: string; icon: React.ReactNode }[] = [
    { id: 'WEATHER', label: 'WEATHER', icon: <Cloud size={20} strokeWidth={1.5} /> },
    { id: 'MUSIC', label: 'MUSIC', icon: <Music size={20} strokeWidth={1.5} /> },
    { id: 'AI', label: 'AI', icon: <Bot size={20} strokeWidth={1.5} /> },
    { id: 'NEWS', label: 'NEWS', icon: <Newspaper size={20} strokeWidth={1.5} /> },
    { id: 'MEMO', label: 'MEMO', icon: <NotebookPen size={20} strokeWidth={1.5} /> },
  ];

  return (
    <div
      className={`right-dock ${debugMode ? 'debug-mode' : ''}`}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        gap: layout.gap,
      }}
    >
      {buttons.map(btn => (
        <button
          key={btn.id}
          className={`dock-button ${visibility[btn.id] ? 'active' : ''}`}
          onClick={() => onTogglePanel(btn.id)}
          title={`Toggle ${btn.label}`}
        >
          {btn.icon}
          <span>{btn.label}</span>
        </button>
      ))}
      <button
        className={`dock-button ${settingsOpen ? 'active' : ''}`}
        onClick={onToggleSettings}
        title="Settings"
      >
        <Settings size={20} strokeWidth={1.5} />
        <span>SETTINGS</span>
      </button>
    </div>
  );
};

export default RightDock;
