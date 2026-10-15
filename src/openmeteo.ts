import { DAY_FROM, DAY_TO } from './days.ts';
import { checkSky } from './quality.ts';
import type { SkyDay } from './store.ts';
import { localIso } from './time.ts';

// Open-Meteo: модельные данные по координатам города, без ключа.
// Берём то, чего нет у станций: облачность, часы солнца, качество воздуха и в какие часы шёл дождь.
const TIMEOUT = 20_000;

export type Coords = { lat: number; lon: number };

// Облачность «как видит человек»: только низкие и средние облака — они делают небо серым и закрывают солнце.
// Высокие тонкие (перистые, 8–12 км) не учитываем: солнце светит сквозь них, день ощущается солнечным.
// Слои перекрываются, поэтому берём максимум, а не сумму.
export const VISIBLE_CLOUD_PARAMS = 'cloud_cover_low,cloud_cover_mid';
export const visibleCloud = (low: number, mid: number) => Math.max(low ?? 0, mid ?? 0);

type WeatherResponse = {
  hourly: { time: string[]; cloud_cover_low: number[]; cloud_cover_mid: number[]; sunshine_duration: number[]; is_day: number[]; precipitation: number[] };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
};
type AirResponse = { hourly: { time: string[]; european_aqi: (number | null)[] } };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Итоги по дням за последние 31 день + сегодня. Для сегодня берём только прошедшие часы, без прогноза.
export async function fetchSky(coords: Coords, now: Date): Promise<Record<string, SkyDay>> {
  const q = `latitude=${coords.lat}&longitude=${coords.lon}&timezone=Europe%2FMadrid&past_days=31&forecast_days=1`;
  const [w, a] = await Promise.all([
    getJson<WeatherResponse>(
      `https://api.open-meteo.com/v1/forecast?${q}&hourly=${VISIBLE_CLOUD_PARAMS},sunshine_duration,is_day,precipitation&daily=sunrise,sunset`,
    ),
    getJson<AirResponse>(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=european_aqi`),
  ]);
  if (!w.hourly?.time?.length || !w.daily?.time?.length) throw new Error('Open-Meteo: пустой ответ');

  const nowHour = localIso(now).slice(0, 13); // 2026-10-12T16
  const aqiByHour = new Map((a.hourly?.time ?? []).map((t, i) => [t, a.hourly.european_aqi[i]]));
  const days: Record<string, SkyDay> = {};

  w.daily.time.forEach((date, d) => {
    const hours = w.hourly.time
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.startsWith(date) && t.slice(0, 13) <= nowHour);
    const daylight = hours.filter(({ i }) => w.hourly.is_day[i] === 1);
    if (!daylight.length) return; // сегодня ещё не рассвело — про небо сказать нечего

    const clouds = daylight.map(({ i }) => visibleCloud(w.hourly.cloud_cover_low[i], w.hourly.cloud_cover_mid[i]));
    const rain = (hs: typeof hours) => Math.round(hs.reduce((s, { i }) => s + (w.hourly.precipitation?.[i] ?? 0), 0) * 10) / 10;
    const aqi = hours.map(({ t }) => aqiByHour.get(t)).filter((v): v is number => typeof v === 'number');

    const day: SkyDay = {
      cloud: Math.round(clouds.reduce((s, v) => s + v, 0) / clouds.length),
      sunHours: Math.round((hours.reduce((s, { i }) => s + w.hourly.sunshine_duration[i], 0) / 3600) * 10) / 10,
      aqiMax: aqi.length ? Math.max(...aqi) : undefined,
      rain: rain(hours),
      // Осадки в часе «10:00» выпали с 9 до 10 — поэтому днём считаются часы 10:00…21:00.
      rainDay: rain(hours.filter(({ t }) => +t.slice(11, 13) > DAY_FROM && +t.slice(11, 13) <= DAY_TO)),
      sunrise: w.daily.sunrise[d].slice(11),
      sunset: w.daily.sunset[d].slice(11),
    };
    const issues = checkSky(day);
    days[date] = issues.length ? { ...day, issues } : day;
  });
  return days;
}
