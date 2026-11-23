import { DAY_FROM, DAY_TO } from './days.ts';
import { checkSky } from './quality.ts';
import { HttpError, withRetry } from './retry.ts';
import type { SkyDay } from './store.ts';
import { localIso } from './time.ts';

// Open-Meteo: модельные данные по координатам города, без ключа.
// Берём то, чего нет у станций: облачность, часы солнца, качество воздуха и в какие часы шёл дождь;
// и температуру по часам — для «других мест» без станции и как запасную под кадрами таймлапса.
const TIMEOUT = 20_000;
// Open-Meteo изредка не отвечает или отвечает 429 «слишком много запросов» — ещё две попытки: через 10 с и через минуту.
const RETRY_DELAYS = [10_000, 60_000];

export type Coords = { lat: number; lon: number };

// Облачность «как видит человек»: только низкие и средние облака — они делают небо серым и закрывают солнце.
// Высокие тонкие (перистые, 8–12 км) не учитываем: солнце светит сквозь них, день ощущается солнечным.
// Слои перекрываются, поэтому берём максимум, а не сумму.
export const VISIBLE_CLOUD_PARAMS = 'cloud_cover_low,cloud_cover_mid';
export const visibleCloud = (low: number, mid: number) => Math.max(low ?? 0, mid ?? 0);

type Point = { latitude: number; longitude: number }; // точка сетки модели, к которой Open-Meteo привязал запрос
type WeatherResponse = Point & {
  hourly: {
    time: string[];
    cloud_cover_low: number[];
    cloud_cover_mid: number[];
    sunshine_duration: number[];
    is_day: number[];
    precipitation: number[];
    temperature_2m?: (number | null)[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
};
type AirResponse = Point & { hourly: { time: string[]; european_aqi: (number | null)[] } };

async function getJsonOnce<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new HttpError('Open-Meteo', res.status);
  return res.json() as Promise<T>;
}

// Таймаут, 429 и ошибка сервера чаще всего разовые. Не вышло и с третьей попытки — ошибка.
const getJson = <T>(url: string) => withRetry(() => getJsonOnce<T>(url), RETRY_DELAYS);

// Небо и воздух сразу для всех мест — двумя запросами на весь сбор, а не двумя на каждое место: Open-Meteo принимает
// координаты списком через запятую и отвечает списком в том же порядке. Раньше 12 мест слали 24 запроса в одну секунду,
// и Open-Meteo то и дело отказывал всем сразу (429, «fetch failed»). Ответ на одно место — объект, на несколько — список.
export async function fetchSkyMany(places: Coords[], now: Date): Promise<Record<string, SkyDay>[]> {
  const q =
    `latitude=${places.map((c) => c.lat).join(',')}&longitude=${places.map((c) => c.lon).join(',')}` +
    '&timezone=Europe%2FMadrid&past_days=31&forecast_days=1';
  const [w, a] = await Promise.all([
    getJson<WeatherResponse | WeatherResponse[]>(
      `https://api.open-meteo.com/v1/forecast?${q}&hourly=${VISIBLE_CLOUD_PARAMS},sunshine_duration,is_day,precipitation,temperature_2m&daily=sunrise,sunset`,
    ),
    getJson<AirResponse | AirResponse[]>(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=european_aqi`),
  ]);
  const ws = Array.isArray(w) ? w : [w];
  const as = Array.isArray(a) ? a : [a];
  if (ws.length !== places.length || as.length !== places.length) {
    throw new Error(`Open-Meteo: ответ на ${ws.length}/${as.length} мест вместо ${places.length}`);
  }
  checkOrder(places, ws);
  checkOrder(places, as);
  return ws.map((wi, i) => skyDays(wi, as[i], now));
}

// Порядок ответа сверяем по координатам: Open-Meteo привязывает точку к своей сетке и сдвигает её не больше чем на
// ~0,05° (проверено 23.11.2026 на всех 12 местах). Дальше 0,1° (~10 км) — ответ не про это место: всё отбрасываем,
// чтобы небо и температура одного места не попали другому (Овьедо от ближайшего соседа, Хихона, — в 0,2°).
const MAX_SHIFT = 0.1;

export function checkOrder(places: Coords[], points: Point[]) {
  places.forEach((c, i) => {
    const p = points[i];
    const shift = Math.max(Math.abs(p?.latitude - c.lat), Math.abs(p?.longitude - c.lon));
    if (!(shift <= MAX_SHIFT)) {
      throw new Error(`Open-Meteo: ответ №${i + 1} не про то место — ${p?.latitude}, ${p?.longitude} вместо ${c.lat}, ${c.lon}`);
    }
  });
}

// Итоги по дням за последние 31 день + сегодня. Для сегодня берём только прошедшие часы, без прогноза.
export function skyDays(w: WeatherResponse, a: AirResponse, now: Date): Record<string, SkyDay> {
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
      temps: hours.map(({ i }) => w.hourly.temperature_2m?.[i] ?? null),
    };
    const issues = checkSky(day);
    days[date] = issues.length ? { ...day, issues } : day;
  });
  return days;
}
