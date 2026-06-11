export type HourlyWeatherPoint = {
  time: string;
  temperature: number;
  condition: string;
  weatherCode?: number;
  precipitationProbability?: number;
  humidity?: number;
  windSpeed?: number;
};

export type WeatherSummary = {
  location: string;
  condition: string;
  weatherCode?: number;
  isDay?: boolean;
  rain?: number;
  snowfall?: number;

  currentTemperature: number;
  apparentTemperature?: number;

  temperatureMin: number;
  temperatureMax: number;

  humidity: number;
  pressure?: number;

  windSpeed?: number;
  windDirection?: string;
  windDirectionDegrees?: number;
  windGust?: number;

  precipitationProbability?: number;
  precipitation?: number;

  cloudCover?: number;
  cloudCoverLow?: number;
  cloudCoverMid?: number;
  cloudCoverHigh?: number;

  uvIndex?: number;

  sunrise?: string;
  sunset?: string;

  hourly?: HourlyWeatherPoint[];

  updatedAt?: string;
  source?: "live" | "mock";
};

export type ForecastOverview = {
  publishingOffice: string;
  reportDatetime: string;
  targetArea: string;
  text: string;
};

export type WeatherBundle = {
  summary: WeatherSummary;
  hourly: HourlyWeatherPoint[];
  overview?: ForecastOverview;
  source: "live" | "mock";
  updatedAt: string;
  error?: string;
};
