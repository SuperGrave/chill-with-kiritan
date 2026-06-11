import type { WeatherSummary, HourlyWeatherPoint, ForecastOverview, WeatherBundle } from '../types/weather';
import { mockWeather, mockHourlyWeather } from '../data/mockWeather';

// Open-Meteo options for Sapporo
const OPEN_METEO_LAT = 43.0642;
const OPEN_METEO_LON = 141.3469;
const OPEN_METEO_TZ = 'Asia/Tokyo';

// JMA Office Code for Sapporo
const JMA_OFFICE_CODE = '016000';

/**
 * Maps wind direction degrees to a compass label.
 */
function getWindDirectionLabel(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 45) % 8;
  return directions[index];
}

/**
 * Maps Open-Meteo weather codes to our UI conditions.
 */
function mapWeatherCodeToCondition(code: number): string {
  if (code === 0) return 'SUNNY';
  if (code === 1 || code === 2) return 'PARTLY CLOUDY';
  if (code === 3) return 'CLOUDY';
  if (code === 45 || code === 48) return 'FOG';
  if (code === 51 || code === 53 || code === 55) return 'DRIZZLE';
  if (code === 61 || code === 63 || code === 65) return 'RAIN';
  if (code === 71 || code === 73 || code === 75 || code === 77) return 'SNOW';
  if (code === 80 || code === 81 || code === 82) return 'SHOWERS';
  if (code === 85 || code === 86) return 'SNOW';
  if (code === 95 || code === 96 || code === 99) return 'THUNDER';
  return 'UNKNOWN';
}

/**
 * Formats an ISO datetime string into HH:MM (useful for sunrise/sunset).
 */
function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export async function fetchOpenMeteoWeather(): Promise<{ summary: WeatherSummary; hourly: HourlyWeatherPoint[] }> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${OPEN_METEO_LAT}&longitude=${OPEN_METEO_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm&timezone=${encodeURIComponent(OPEN_METEO_TZ)}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo API Error: ${response.status}`);
  }
  const data = await response.json();

  const current = data.current;
  const daily = data.daily;
  const hourlyData = data.hourly;

  const summary: WeatherSummary = {
    location: "SAPPORO", // Static for now, matching the original requirement
    condition: mapWeatherCodeToCondition(current.weather_code),
    weatherCode: current.weather_code,
    isDay: current.is_day === 1,
    precipitation: current.precipitation,
    rain: current.rain,
    snowfall: current.snowfall,
    
    currentTemperature: Math.round(current.temperature_2m),
    apparentTemperature: Math.round(current.apparent_temperature),
    
    temperatureMin: Math.round(daily.temperature_2m_min[0]),
    temperatureMax: Math.round(daily.temperature_2m_max[0]),
    
    humidity: current.relative_humidity_2m,
    pressure: current.pressure_msl,
    
    windSpeed: parseFloat(current.wind_speed_10m.toFixed(1)),
    windDirectionDegrees: current.wind_direction_10m,
    windDirection: getWindDirectionLabel(current.wind_direction_10m),
    windGust: parseFloat(current.wind_gusts_10m.toFixed(1)),
    
    precipitationProbability: daily.precipitation_probability_max[0],
    cloudCover: current.cloud_cover,
    
    uvIndex: daily.uv_index_max[0],
    
    sunrise: formatTime(daily.sunrise[0]),
    sunset: formatTime(daily.sunset[0]),
    
    updatedAt: new Date().toISOString(),
    source: "live"
  };

  const hourly: HourlyWeatherPoint[] = [];
  // Fallback to taking next 6 hours from index 0 if not matching precisely
  const startIndex = Math.max(0, hourlyData.time.findIndex((t: string) => new Date(t).getTime() >= Date.now()) - 1);
  
  for (let i = 0; i < 6; i++) {
    const idx = startIndex + i;
    if (idx < hourlyData.time.length) {
      hourly.push({
        time: formatTime(hourlyData.time[idx]),
        temperature: Math.round(hourlyData.temperature_2m[idx]),
        condition: mapWeatherCodeToCondition(hourlyData.weather_code[idx]),
        weatherCode: hourlyData.weather_code[idx],
        precipitationProbability: hourlyData.precipitation_probability[idx],
        humidity: hourlyData.relative_humidity_2m[idx],
        windSpeed: parseFloat(hourlyData.wind_speed_10m[idx].toFixed(1)),
      });
    }
  }

  return { summary, hourly };
}

export async function fetchJmaForecastOverview(): Promise<ForecastOverview> {
  const url = `https://www.jma.go.jp/bosai/forecast/data/overview_forecast/${JMA_OFFICE_CODE}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`JMA API Error: ${response.status}`);
  }
  const data = await response.json();
  
  return {
    publishingOffice: data.publishingOffice,
    reportDatetime: data.reportDatetime,
    targetArea: data.targetArea,
    text: data.text,
  };
}

export async function fetchWeatherBundle(): Promise<WeatherBundle> {
  let openMeteoSuccess = false;
  let summary = { ...mockWeather };
  let hourly = [...mockHourlyWeather];
  let overview: ForecastOverview | undefined = undefined;
  let errors: string[] = [];

  try {
    const meteoData = await fetchOpenMeteoWeather();
    summary = meteoData.summary;
    hourly = meteoData.hourly;
    openMeteoSuccess = true;
  } catch (err: any) {
    console.error("Failed to fetch Open-Meteo data", err);
    errors.push("Meteo: " + err.message);
  }

  try {
    overview = await fetchJmaForecastOverview();
  } catch (err: any) {
    console.error("Failed to fetch JMA overview", err);
    errors.push("JMA: " + err.message);
  }

  const isLive = openMeteoSuccess; // consider it live if we at least got the main numeric data
  
  return {
    summary: {
      ...summary,
      source: isLive ? "live" : "mock"
    },
    hourly,
    overview,
    source: isLive ? "live" : "mock",
    updatedAt: new Date().toISOString(),
    error: errors.length > 0 ? errors.join(", ") : undefined
  };
}
