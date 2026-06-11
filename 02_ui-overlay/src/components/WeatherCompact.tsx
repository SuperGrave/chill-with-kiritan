import React from 'react';
import WeatherToneBar from './WeatherToneBar';
import type { WeatherSummary } from '../types/weather';

interface WeatherCompactProps {
  layout: { 
    x: number; 
    y: number; 
    width: number; 
    barHeight?: number; 
    fontSize?: number;
    rowGap?: number;
  };
  settings: any;
  weatherData: WeatherSummary;
  debugMode: boolean;
}

const WeatherCompact: React.FC<WeatherCompactProps> = ({ layout, settings, weatherData, debugMode }) => {
  if (!settings.showLocation && !settings.showWeather && !settings.showTemperature && !settings.showHumidity) {
    return null;
  }

  const {
    location,
    condition,
    currentTemperature,
    temperatureMin,
    temperatureMax,
    humidity
  } = weatherData;

  const barHeight = layout.barHeight || 22;
  const fontSize = layout.fontSize || 25;
  const rowGap = layout.rowGap !== undefined ? layout.rowGap : 8;

  const tempPadding = settings.temperaturePadding !== undefined ? settings.temperaturePadding : 5;
  const displayMin = temperatureMin - tempPadding;
  const displayMax = temperatureMax + tempPadding;
  
  const infoRowPosition = settings.infoRowPosition || 'top';

  const infoRow = (settings.showLocation || settings.showWeather || settings.showPressure) ? (
    <div className="weather-compact-row" key="infoRow">
      <div style={{ flexGrow: 1, letterSpacing: '0.2em' }}>
        {settings.showLocation && <span>{location}</span>}
        {settings.showLocation && settings.showWeather && <span style={{ margin: '0 8px' }}>/</span>}
        {settings.showWeather && <span>{condition}</span>}
        {(settings.showLocation || settings.showWeather) && settings.showPressure && weatherData.pressure && <span style={{ margin: '0 8px' }}>/</span>}
        {settings.showPressure && weatherData.pressure && <span>{weatherData.pressure}hPa</span>}
      </div>
    </div>
  ) : null;

  const tempRow = settings.showTemperature ? (
    <div className="weather-compact-row" key="tempRow">
      <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: '16px' }}>
        {settings.showMinMaxLabels && (
          <span style={{ fontSize: '0.6em', opacity: 0.7 }}>L {temperatureMin}°</span>
        )}
        
        <div style={{ flexGrow: 1 }}>
          <WeatherToneBar 
            mode="temperatureRange"
            value={currentTemperature}
            min={displayMin}
            max={displayMax}
            rangeMin={temperatureMin}
            rangeMax={temperatureMax}
            showMarker={settings.showCurrentMarker !== false}
            showTriangle={settings.showCurrentTriangle !== false}
            pattern={settings.pattern || "diagonal"}
            height={barHeight}
          />
        </div>
        
        {settings.showMinMaxLabels && (
          <span style={{ fontSize: '0.6em', opacity: 0.7 }}>H {temperatureMax}°</span>
        )}
      </div>
      <div className="weather-compact-value">
        {currentTemperature}°C
      </div>
    </div>
  ) : null;

  const humRow = settings.showHumidity ? (
    <div className="weather-compact-row" key="humRow">
      <div style={{ flexGrow: 1 }}>
        <WeatherToneBar 
          mode="progress"
          value={humidity}
          showMarker={settings.showCurrentMarker !== false}
          showTriangle={settings.showCurrentTriangle !== false}
          pattern={settings.pattern || "diagonal"}
          height={barHeight}
        />
      </div>
      <div className="weather-compact-value">
        <span>{humidity}%</span>
      </div>
    </div>
  ) : null;

  return (
    <div 
      className={`weather-compact ${debugMode ? 'debug-mode' : ''}`}
      style={{
        width: '100%',
        fontSize: `${fontSize}px`,
        gap: `${rowGap}px`,
      }}
    >
      {infoRowPosition === 'top' && infoRow}
      {tempRow}
      {humRow}
      {infoRowPosition === 'bottom' && infoRow}
    </div>
  );
};

export default WeatherCompact;
