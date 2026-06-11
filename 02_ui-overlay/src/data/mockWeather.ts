import type { WeatherSummary, HourlyWeatherPoint } from '../types/weather';

export const mockWeather: WeatherSummary = {
  location: "SAPPORO",
  condition: "CLOUDY",
  weatherCode: 3,

  currentTemperature: 18,
  apparentTemperature: 16,

  temperatureMin: 13,
  temperatureMax: 22,

  humidity: 62,
  pressure: 1012,

  windSpeed: 3.1,
  windDirection: "NW",
  windDirectionDegrees: 315,
  windGust: 5.4,

  precipitationProbability: 20,
  precipitation: 0.0,

  cloudCover: 74,
  cloudCoverLow: 22,
  cloudCoverMid: 48,
  cloudCoverHigh: 70,

  uvIndex: 2.8,

  sunrise: "04:02",
  sunset: "19:12",

  updatedAt: "2026-06-09T14:28:00+09:00",
};

export const mockHourlyWeather: HourlyWeatherPoint[] = [
  {
    time: "14:00",
    temperature: 18,
    condition: "CLOUDY",
    weatherCode: 3,
    precipitationProbability: 20,
    humidity: 62,
    windSpeed: 3.1,
  },
  {
    time: "15:00",
    temperature: 17,
    condition: "CLOUDY",
    weatherCode: 3,
    precipitationProbability: 20,
    humidity: 64,
    windSpeed: 3.3,
  },
  {
    time: "16:00",
    temperature: 16,
    condition: "RAIN",
    weatherCode: 61,
    precipitationProbability: 50,
    humidity: 68,
    windSpeed: 3.8,
  },
  {
    time: "17:00",
    temperature: 15,
    condition: "RAIN",
    weatherCode: 61,
    precipitationProbability: 60,
    humidity: 72,
    windSpeed: 4.0,
  },
  {
    time: "18:00",
    temperature: 14,
    condition: "CLOUDY",
    weatherCode: 3,
    precipitationProbability: 40,
    humidity: 74,
    windSpeed: 3.6,
  },
  {
    time: "19:00",
    temperature: 13,
    condition: "CLOUDY",
    weatherCode: 3,
    precipitationProbability: 20,
    humidity: 76,
    windSpeed: 3.0,
  },
];
