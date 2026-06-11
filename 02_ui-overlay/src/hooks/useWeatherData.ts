import { useState, useEffect, useCallback } from 'react';
import { fetchWeatherBundle } from '../services/weatherService';
import type { WeatherBundle } from '../types/weather';
import { mockWeather, mockHourlyWeather } from '../data/mockWeather';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function useWeatherData() {
  const [weatherBundle, setWeatherBundle] = useState<WeatherBundle>({
    summary: { ...mockWeather, source: "mock" },
    hourly: [...mockHourlyWeather],
    source: "mock",
    updatedAt: new Date().toISOString()
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const bundle = await fetchWeatherBundle();
      setWeatherBundle(bundle);
      setError(bundle.error);
    } catch (err: any) {
      console.error("Critical error in fetchWeatherBundle", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    
    const interval = setInterval(() => {
      refresh();
    }, REFRESH_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    weatherBundle,
    loading,
    error,
    refresh,
    lastUpdatedAt: weatherBundle.updatedAt
  };
}
