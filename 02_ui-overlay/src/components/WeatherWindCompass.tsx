import React from 'react';
import { Navigation } from 'lucide-react';

interface WeatherWindCompassProps {
  directionDegrees?: number;
  directionLabel?: string;
  speed?: number;
  gust?: number;
  size?: number;
}

const WeatherWindCompass: React.FC<WeatherWindCompassProps> = ({
  directionDegrees = 0,
  directionLabel = "N",
  speed = 0,
  gust = 0,
  size = 64
}) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
      <div 
        style={{ 
          position: 'relative', 
          width: size, 
          height: size, 
          borderRadius: '50%', 
          border: '1px solid rgba(255,255,255,0.4)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}
        title="Arrow points in the direction of the flow (downwind)"
      >
        {/* The compass ring tick marks */}
        <div style={{ position: 'absolute', top: 4, width: 2, height: 4, background: 'rgba(255,255,255,0.5)' }} />
        <div style={{ position: 'absolute', bottom: 4, width: 2, height: 4, background: 'rgba(255,255,255,0.5)' }} />
        <div style={{ position: 'absolute', left: 4, width: 4, height: 2, background: 'rgba(255,255,255,0.5)' }} />
        <div style={{ position: 'absolute', right: 4, width: 4, height: 2, background: 'rgba(255,255,255,0.5)' }} />

        {/* Rotate the arrow. By convention, meteorology direction is where wind comes FROM. 
            If wind is NW (315°), it blows towards SE (135°).
            The Navigation icon points UP (0°).
            To point towards the flow, we rotate by directionDegrees + 180.
            But often "wind compasses" point TO the source. 
            The user prompt says: "Arrow points in the direction of the flow (downwind)".
            So if degrees = 0 (N), it blows South. Arrow points down (180).
        */}
        <div style={{ transform: `rotate(${directionDegrees + 180}deg)`, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Navigation size={size * 0.5} strokeWidth={1.5} fill="none" color="#fff" />
        </div>
      </div>

      <div>
        <div style={{ fontSize: '24px', letterSpacing: '0.1em', marginBottom: '8px' }}>
          {directionLabel}
        </div>
        <div style={{ fontSize: '14px', letterSpacing: '0.1em', opacity: 0.8, marginBottom: '4px' }}>
          SPEED <span style={{ color: '#fff', marginLeft: '8px' }}>{speed} M/S</span>
        </div>
        <div style={{ fontSize: '14px', letterSpacing: '0.1em', opacity: 0.8 }}>
          GUST <span style={{ color: '#fff', marginLeft: '14px' }}>{gust} M/S</span>
        </div>
      </div>
    </div>
  );
};

export default WeatherWindCompass;
