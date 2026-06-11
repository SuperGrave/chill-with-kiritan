import React from 'react';

type WeatherToneBarProps = {
  mode: "temperatureRange" | "progress" | "percent" | "scaled";
  value: number;
  min?: number; // Display scale min (or scaled min)
  max?: number; // Display scale max (or scaled max)
  rangeMin?: number; // The actual lowest temp boundary
  rangeMax?: number; // The actual highest temp boundary
  percent?: number;
  showMarker?: boolean;
  showTriangle?: boolean;
  pattern?: "diagonal" | "vertical" | "dot";
  height?: number;
};

const WeatherToneBar: React.FC<WeatherToneBarProps> = ({
  mode,
  value,
  min = 0,
  max = 100,
  rangeMin = 0,
  rangeMax = 100,
  percent,
  showMarker = false,
  showTriangle = false,
  pattern = "diagonal",
  height = 22
}) => {
  if (mode === "progress" || mode === "percent") {
    let p = percent !== undefined ? percent : value;
    p = Math.max(0, Math.min(100, p));
    return (
      <div className="weather-tone-bar" style={{ height: `${height}px` }}>
        <div 
          className={`weather-tone-fill weather-tone-fill--${pattern}`} 
          style={{ width: `${p}%` }}
        />
        {showMarker && (
          <div 
            className="weather-tone-marker weather-tone-marker--current" 
            style={{ left: `${p}%` }}
          >
            {showTriangle && <div className="weather-tone-triangle" />}
          </div>
        )}
      </div>
    );
  }

  if (mode === "scaled") {
    let range = max - min;
    if (range <= 0) range = 1;
    let p = (value - min) / range;
    p = Math.max(0, Math.min(1, p)) * 100;
    return (
      <div className="weather-tone-bar" style={{ height: `${height}px` }}>
        <div 
          className={`weather-tone-fill weather-tone-fill--${pattern}`} 
          style={{ width: `${p}%` }}
        />
        {showMarker && (
          <div 
            className="weather-tone-marker weather-tone-marker--current" 
            style={{ left: `${p}%` }}
          >
            {showTriangle && <div className="weather-tone-triangle" />}
          </div>
        )}
      </div>
    );
  }

  // Temperature Range Mode
  let scaleRange = max - min;
  if (scaleRange <= 0) scaleRange = 1; // Prevent division by zero

  const calcPos = (val: number) => {
    let p = (val - min) / scaleRange;
    return Math.max(0, Math.min(1, p)) * 100;
  };

  const posMin = calcPos(rangeMin);
  const posMax = calcPos(rangeMax);
  const posCurrent = calcPos(value);

  return (
    <div className="weather-tone-bar" style={{ height: `${height}px` }}>
      {/* Outer Hatch: Below Min */}
      <div 
        className={`weather-tone-fill weather-tone-fill--${pattern} weather-tone-fill--min`} 
        style={{ width: `${posMin}%`, left: 0 }}
      />
      {/* Outer Hatch: Above Max */}
      <div 
        className={`weather-tone-fill weather-tone-fill--${pattern} weather-tone-fill--max`} 
        style={{ width: `${100 - posMax}%`, right: 0, left: 'auto' }}
      />
      
      {/* Min Boundary Marker (Blue-ish) */}
      <div 
        className="weather-tone-marker weather-tone-marker--min" 
        style={{ left: `${posMin}%` }}
      />
      
      {/* Max Boundary Marker (Red-ish) */}
      <div 
        className="weather-tone-marker weather-tone-marker--max" 
        style={{ left: `${posMax}%` }}
      />

      {/* Current Marker (White/Light) */}
      {showMarker && (
        <div 
          className="weather-tone-marker weather-tone-marker--current" 
          style={{ left: `${posCurrent}%` }}
        >
          {showTriangle && <div className="weather-tone-triangle" />}
        </div>
      )}
    </div>
  );
};

export default WeatherToneBar;
