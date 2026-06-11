import React from 'react';
import WeatherToneBar from './WeatherToneBar';

interface WeatherMetricRowProps {
  label: string;
  valueText: string;
  mode: "temperatureRange" | "progress" | "percent" | "scaled";
  value: number;
  min?: number;
  max?: number;
  rangeMin?: number;
  rangeMax?: number;
  pattern?: "diagonal" | "vertical" | "dot";
  showMarker?: boolean;
  labelSize?: number;
  valueSize?: number;
}

const WeatherMetricRow: React.FC<WeatherMetricRowProps> = ({
  label,
  valueText,
  mode,
  value,
  min,
  max,
  rangeMin,
  rangeMax,
  pattern = "diagonal",
  showMarker = false,
  labelSize = 14,
  valueSize = 14
}) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '16px' }}>
      <div style={{ width: '120px', letterSpacing: '0.1em', opacity: 0.8, fontSize: `${labelSize}px`, flexShrink: 0 }}>
        {label}
      </div>
      
      <div style={{ flexGrow: 1 }}>
        <WeatherToneBar 
          mode={mode}
          value={value}
          min={min}
          max={max}
          rangeMin={rangeMin}
          rangeMax={rangeMax}
          showMarker={showMarker}
          pattern={pattern}
          height={16} // slightly thinner for detailed panel
        />
      </div>

      <div style={{ width: '48px', textAlign: 'right', letterSpacing: '0.05em', fontSize: `${valueSize}px`, flexShrink: 0 }}>
        {valueText}
      </div>
    </div>
  );
};

export default WeatherMetricRow;
