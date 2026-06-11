import React, { useState, useEffect } from 'react';
import '../styles/clock.css';

interface ClockProps {
  layout: { x: number; y: number; width: number; dateSize?: number; timeSize?: number; detailsSize?: number };
  settings: any;
  debugMode: boolean;
}

const ClockWidget: React.FC<ClockProps> = ({ layout, settings, debugMode }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const day = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    return `${y} / ${m} / ${d} ${day}`;
  };

  const formatTimeStr = (date: Date) => {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return settings.showSeconds ? `${h}:${m}:${s}` : `${h}:${m}`;
  };

  const renderTimeChars = (timeStr: string) => {
    return timeStr.split('').map((char, i) => {
      if (char >= '0' && char <= '9') {
        return <span key={i} className="time-digit">{char}</span>;
      }
      if (char === ':') {
        return <span key={i} className="time-colon">{char}</span>;
      }
      return <span key={i} className="time-space">{char}</span>;
    });
  };



  return (
    <div 
      className={`clock-widget ${debugMode ? 'debug-mode' : ''}`}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
      }}
    >
      {settings.showDate && (
        <div className="clock-date" style={{ fontSize: `${layout.dateSize || 63}px` }}>
          {formatDate(time)}
        </div>
      )}
      <div className="clock-time" style={{ fontSize: `${layout.timeSize || 105}px` }}>
        {renderTimeChars(formatTimeStr(time))}
      </div>
    </div>
  );
};

export default ClockWidget;
