import React from 'react';
import type { WeatherSummary, WeatherBundle } from '../../types/weather';
import { mockWeather } from '../../data/mockWeather';
import WeatherIcon from '../WeatherIcon';
import WeatherWindCompass from '../WeatherWindCompass';
import WeatherMetricRow from '../WeatherMetricRow';
import '../../styles/weather.css';

interface WeatherDetailPanelProps {
  weatherData?: WeatherSummary;
  weatherBundle?: WeatherBundle;
  pattern?: "diagonal" | "vertical" | "dot";
  settings?: any;
}

const WeatherDetailPanel: React.FC<WeatherDetailPanelProps> = ({ 
  weatherData = mockWeather,
  weatherBundle,
  pattern = "diagonal",
  settings = { gap: 24, fontSize: 1 }
}) => {
  const {
    location,
    condition,
    currentTemperature,
    apparentTemperature,
    temperatureMin,
    temperatureMax,
    humidity,
    pressure,
    windSpeed,
    windDirection,
    windDirectionDegrees,
    windGust,
    precipitationProbability,
    cloudCover,
    uvIndex,
    sunrise,
    sunset,
    updatedAt
  } = weatherData;

  // Format the updatedAt time to HH:MM:SS
  let formattedTime = "14:20:00"; // Default fallback
  if (updatedAt) {
    const d = new Date(updatedAt);
    if (!isNaN(d.getTime())) {
      formattedTime = d.toLocaleTimeString('ja-JP', { hour12: false });
    }
  }

  // Official sounding JMA style comments
  const getJmaNote = () => {
    if (humidity >= 70 && currentTemperature >= 25) return "大気の状態が不安定となっています。急な強い雨や落雷、突風に注意してください。";
    if (precipitationProbability && precipitationProbability >= 50) return "前線や湿った空気の影響により、雨の降る所が多くなる見込みです。外出の際は雨具をご用意ください。";
    if (uvIndex && uvIndex >= 5) return "日中の紫外線が非常に強くなります。屋外での活動はなるべく控え、十分な熱中症対策・紫外線対策を行ってください。";
    if (currentTemperature <= 5) return "強い寒気の影響により、気温が平年より低くなる見込みです。路面の凍結や水道管の凍結に十分注意してください。";
    if (currentTemperature >= 35) return "最高気温が35度以上の猛暑日となる所がある見込みです。熱中症の危険性が極めて高くなりますので、冷房を適切に使用してください。";
    return "高気圧に覆われ、概ね晴れる見込みです。空気が乾燥するため、火の取り扱いにご注意ください。";
  };

  // Fallbacks for new settings
  const s = {
    gap: 24,
    paddingTop: 16,
    paddingBottom: 24,
    paddingX: 32,
    mainTempSize: 96,
    minMaxTempSize: 28,
    feelsLikeSize: 24,
    metricLabelSize: 14,
    metricValueSize: 14,
    windSunSize: 24,
    noteSize: 15,
    footerSize: 18,
    mainIconSize: 84,
    compassSize: 84,
    sunIconSize: 28,
    ...settings
  };

  return (
    <div className="weather-detail-container" style={{ 
      color: '#fff', 
      fontFamily: 'var(--font-main)', 
      padding: `${s.paddingTop}px ${s.paddingX}px ${s.paddingBottom}px`, 
      display: 'flex', 
      flexDirection: 'column', 
      gap: `${s.gap}px`, 
      height: '100%', 
      boxSizing: 'border-box'
    }}>
      
      {/* ROW 1: Large Temp, Stacked Min/Max, Icon */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Main Temp */}
          <div style={{ fontSize: `${s.mainTempSize}px`, lineHeight: 0.8, fontWeight: 300, letterSpacing: '0.02em' }}>
            {currentTemperature}°C
          </div>
          {/* Min/Max Temp Column */}
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: `${s.minMaxTempSize}px`, lineHeight: 1.1, fontWeight: 400 }}>
            <span style={{ color: '#ff4d4d' }}>{temperatureMax}°C</span>
            <span style={{ color: '#4da6ff' }}>{temperatureMin}°C</span>
          </div>
        </div>
        {/* Weather Icon */}
        <div style={{ paddingRight: '16px' }}>
          <WeatherIcon type={condition} size={s.mainIconSize} opacity={0.9} />
        </div>
      </div>

      {/* ROW 2: Feels Like & Pressure */}
      <div style={{ fontSize: `${s.feelsLikeSize}px`, letterSpacing: '0.1em', opacity: 0.9 }}>
        FEELS {apparentTemperature}°C <span style={{ opacity: 0.5, margin: '0 8px' }}>/</span> {pressure} hPa
      </div>

      {/* ROW 3-6: Metric Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        <WeatherMetricRow 
          label="HUMIDITY" 
          valueText={`${humidity}%`} 
          mode="progress"
          value={humidity}
          pattern={pattern}
          showMarker={true}
          labelSize={s.metricLabelSize}
          valueSize={s.metricValueSize}
        />
        {cloudCover !== undefined && (
          <WeatherMetricRow 
            label="CLOUD COVER" 
            valueText={`${cloudCover}%`} 
            mode="progress"
            value={cloudCover}
            pattern={pattern}
            showMarker={true}
            labelSize={s.metricLabelSize}
            valueSize={s.metricValueSize}
          />
        )}
        {precipitationProbability !== undefined && (
          <WeatherMetricRow 
            label="RAIN PROB." 
            valueText={`${precipitationProbability}%`} 
            mode="progress"
            value={precipitationProbability}
            pattern={pattern}
            showMarker={true}
            labelSize={s.metricLabelSize}
            valueSize={s.metricValueSize}
          />
        )}
        {uvIndex !== undefined && (
          <WeatherMetricRow 
            label="UV INDEX" 
            valueText={uvIndex.toFixed(1)} 
            mode="scaled"
            value={uvIndex}
            min={0}
            max={11}
            pattern={pattern}
            showMarker={true}
            labelSize={s.metricLabelSize}
            valueSize={s.metricValueSize}
          />
        )}
      </div>

      {/* ROW 7: Wind & Sun Times */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
        {/* Left: Wind Compass */}
        <WeatherWindCompass 
          directionDegrees={windDirectionDegrees}
          directionLabel={windDirection}
          speed={windSpeed}
          gust={windGust}
          size={s.compassSize}
        />
        {/* Right: Sun Times */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: `${s.windSunSize}px`, letterSpacing: '0.1em' }}>
            <WeatherIcon type="sunrise" size={s.sunIconSize} opacity={0.8} />
            <span>{sunrise}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: `${s.windSunSize}px`, letterSpacing: '0.1em' }}>
            <WeatherIcon type="sunset" size={s.sunIconSize} opacity={0.8} />
            <span>{sunset}</span>
          </div>
        </div>
      </div>

      {/* ROW 8: FORECAST OVERVIEW & KIRITAN NOTE */}
      <div style={{ marginTop: 'auto', paddingTop: '24px', paddingBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {weatherBundle?.overview ? (
          <div style={{ borderLeft: '3px solid rgba(255,255,255,0.4)', paddingLeft: '12px' }}>
            <div style={{ fontSize: `${s.noteSize}px`, fontWeight: 'bold', letterSpacing: '0.1em', marginBottom: '4px', opacity: 0.9 }}>
              FORECAST OVERVIEW
            </div>
            <div style={{ fontSize: `${s.noteSize * 0.8}px`, opacity: 0.7, marginBottom: '8px', letterSpacing: '0.05em' }}>
              {weatherBundle.overview.publishingOffice} / UPDATED {new Date(weatherBundle.overview.reportDatetime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <p style={{ 
              fontSize: `${s.noteSize}px`, 
              lineHeight: 1.6, 
              opacity: 0.8, 
              letterSpacing: '0.05em',
              display: s.maxNoteLines && s.maxNoteLines > 0 ? '-webkit-box' : 'block',
              WebkitLineClamp: s.maxNoteLines && s.maxNoteLines > 0 ? s.maxNoteLines : 'none',
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {weatherBundle.overview.text}
            </p>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: `${s.noteSize * 0.9}px`, fontWeight: 'bold', letterSpacing: '0.1em', marginBottom: '4px', opacity: 0.7 }}>
              KIRITAN NOTE
            </div>
            <p style={{ fontSize: `${s.noteSize * 0.9}px`, lineHeight: 1.6, opacity: 0.7, letterSpacing: '0.05em' }}>
              {getJmaNote()}
            </p>
          </div>
        )}
      </div>

      {/* ROW 9: Location & Updated */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: `${s.footerSize}px`, letterSpacing: '0.1em', opacity: 0.9 }}>
        <div>@ {location}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>@ UPDATED: {formattedTime}</span>
          {weatherBundle && (
            <span style={{ 
              fontSize: '0.8em', 
              padding: '2px 6px', 
              borderRadius: '4px', 
              background: weatherBundle.source === 'live' ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 100, 0, 0.15)',
              border: `1px solid ${weatherBundle.source === 'live' ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 100, 0, 0.3)'}`
            }}>
              SOURCE: {weatherBundle.source.toUpperCase()}
            </span>
          )}
          {weatherBundle?.error && (
            <span style={{ fontSize: '0.8em', color: 'rgba(255, 100, 100, 0.9)' }}>
              FETCH FAILED
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default WeatherDetailPanel;
