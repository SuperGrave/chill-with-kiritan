import React from 'react';
import '../styles/panel.css';

interface FloatingPanelProps {
  title: string;
  layout: { x: number; y: number; width: number; height: number };
  visible: boolean;
  debugMode?: boolean;
  showHeader?: boolean;
  showBackground?: boolean;
  backgroundOpacity?: number;
  contentTopGap?: number;
  children: React.ReactNode;
}

// A standalone, freely-positioned card on the wallpaper canvas — same role the
// weather/clock modules play, but reusable for any element panel. Visibility is
// a CSS fade so toggling on/off feels consistent with the detail overlay.
const FloatingPanel: React.FC<FloatingPanelProps> = ({
  title,
  layout,
  visible,
  debugMode = false,
  showHeader = true,
  showBackground = true,
  backgroundOpacity = 0.4,
  contentTopGap,
  children,
}) => {
  return (
    <div
      className={`floating-panel ${visible ? 'visible' : ''} ${debugMode ? 'debug-mode' : ''}`}
      style={{
        position: 'absolute',
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        padding: '26px',
        boxSizing: 'border-box',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '24px',
        background: showBackground ? `rgba(0, 0, 0, ${backgroundOpacity})` : 'transparent',
        backdropFilter: showBackground ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: showBackground ? 'blur(16px)' : 'none',
        border: showBackground ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
        boxShadow: showBackground ? '0 12px 40px rgba(0, 0, 0, 0.4)' : 'none',
      }}
    >
      {showHeader && (
        <div
          className="floating-panel-header"
          style={typeof contentTopGap === 'number' ? { marginBottom: contentTopGap } : undefined}
        >
          <span style={{
            display: 'block',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </span>
        </div>
      )}
      <div className="floating-panel-content">{children}</div>
    </div>
  );
};

export default FloatingPanel;
