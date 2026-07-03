import { Settings } from 'lucide-react';
import '../styles/dock.css';

interface RightDockProps {
  layout: { x: number; y: number; width: number; gap: number };
  debugMode: boolean;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  showSettings?: boolean;
}

// The dock is now only the entry into Settings. Panel visibility shortcuts live
// at the top of the Settings surface so accidental wallpaper clicks don't hide UI.
const RightDock: React.FC<RightDockProps> = ({
  layout, debugMode, settingsOpen, onToggleSettings, showSettings = true,
}) => {
  if (!showSettings) return null;

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
