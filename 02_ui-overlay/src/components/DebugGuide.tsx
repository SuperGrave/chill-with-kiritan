import React from 'react';

interface DebugGuideProps {
  layout: any;
}

const DebugGuide: React.FC<DebugGuideProps> = ({ layout }) => {
  return (
    <>
      <div 
        className="debug-safe-area"
        style={{
          left: layout.safeArea.padding,
          top: layout.safeArea.padding,
          width: layout.canvas.width - layout.safeArea.padding * 2,
          height: layout.canvas.height - layout.safeArea.padding * 2,
        }}
      />
      {/* Center crosshair */}
      <div className="debug-guide-line" style={{ left: '50%', top: 0, width: 1, height: '100%' }} />
      <div className="debug-guide-line" style={{ left: 0, top: '50%', width: '100%', height: 1 }} />
      
      {/* Rule of thirds (horizontal) */}
      <div className="debug-guide-line" style={{ left: '33.33%', top: 0, width: 1, height: '100%' }} />
      <div className="debug-guide-line" style={{ left: '66.66%', top: 0, width: 1, height: '100%' }} />
      
      {/* Labels */}
      <div style={{ position: 'absolute', top: 10, left: 10, color: '#0ff', fontSize: 12, fontFamily: 'monospace' }}>
        DEBUG MODE ON - {layout.canvas.width}x{layout.canvas.height}
      </div>
    </>
  );
};

export default DebugGuide;
