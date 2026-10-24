// Weather from Open-Meteo (free, no API key, no account). Only contacted when a weather widget
// exists and a city has been chosen; the only data sent is that city's coordinates.
import { net } from 'electron';
import type { WeatherData } from '../../shared/types';
import { log } from '../logger';

const REFRESH_MS = 30 * 60_000;

export interface GeoResult { name: string; country: string; latitude: number; longitude: number }

export class WeatherService {
  private cache: WeatherData | null = null;

  async geocode(query: string, lang: 'fr' | 'en'): Promise<GeoResult[]> {
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=5&language=${lang}&name=${encodeURIComponent(query.slice(0, 80))}`;
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`geocoding HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { name: string; country?: string; latitude: number; longitude: number }[] };
    return (data.results ?? []).map((r) => ({ name: r.name, country: r.country ?? '', latitude: r.latitude, longitude: r.longitude }));
  }

  async get(city: string, lat: number, lon: number, unit: 'c' | 'f', force = false): Promise<WeatherData | null> {
    if (!force && this.cache && this.cache.city === city && this.cache.unit === unit && Date.now() - this.cache.updatedAt < REFRESH_MS) return this.cache;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto` +
      (unit === 'f' ? '&temperature_unit=fahrenheit' : '');
    try {
      const res = await net.fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as {
        current: { temperature_2m: number; weather_code: number };
        daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
      };
      this.cache = {
        city,
        unit,
        temperature: Math.round(d.current.temperature_2m),
        code: d.current.weather_code,
        high: Math.round(d.daily.temperature_2m_max[0]),
        low: Math.round(d.daily.temperature_2m_min[0]),
        updatedAt: Date.now(),
        daily: d.daily.time.map((date, i) => ({
          date,
          code: d.daily.weather_code[i],
          high: Math.round(d.daily.temperature_2m_max[i]),
          low: Math.round(d.daily.temperature_2m_min[i]),
        })),
      };
      return this.cache;
    } catch (err) {
      log.warn('weather', 'fetch failed', err);
      return this.cache;
    }
  }
}
