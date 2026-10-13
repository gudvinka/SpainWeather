import { archiveDayKind, BAD_AIR, HEAT } from './days.ts';
import { VISIBLE_CLOUD_PARAMS, visibleCloud, type Coords } from './openmeteo.ts';
import { readHistory, writeHistory, type MonthClimate } from './store.ts';

// «Как обычно» для шапки месяца: тот же месяц прошлых лет из архива Open-Meteo (модель, без ключа).
// Прошлое не меняется, поэтому каждый месяц качается один раз и хранится в site/<город>/history.json.
export const PAST_YEARS = 4;
const TIMEOUT = 30_000;

type ArchiveWeather = {
  daily: { time: string[]; temperature_2m_max: number[]; precipitation_sum: number[]; sunrise: string[]; sunset: string[] };
  hourly: { time: string[]; cloud_cover_low: number[]; cloud_cover_mid: number[]; is_day: number[] };
};
type ArchiveAir = { hourly: { time: string[]; european_aqi: (number | null)[] } };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`архив Open-Meteo: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Итоги одного месяца прошлого года: средний дневной максимум и сколько каких дней.
export async function fetchMonthClimate(coords: Coords, month: string): Promise<MonthClimate> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const q = `latitude=${coords.lat}&longitude=${coords.lon}&timezone=Europe%2FMadrid&start_date=${month}-01&end_date=${month}-${last}`;
  const [w, a] = await Promise.all([
    getJson<ArchiveWeather>(
      `https://archive-api.open-meteo.com/v1/archive?${q}&daily=temperature_2m_max,precipitation_sum,sunrise,sunset&hourly=${VISIBLE_CLOUD_PARAMS},is_day`,
    ),
    getJson<ArchiveAir>(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=european_aqi`),
  ]);
  if (w.daily?.time?.length !== last) throw new Error(`архив Open-Meteo: за ${month} не все дни`);

  const cloudByDay = Map.groupBy(
    w.hourly.time.map((t, i) => ({
      day: t.slice(0, 10),
      cloud: visibleCloud(w.hourly.cloud_cover_low[i], w.hourly.cloud_cover_mid[i]),
      light: w.hourly.is_day[i] === 1,
    })),
    (h) => h.day,
  );
  const aqiByDay = Map.groupBy(
    a.hourly.time.map((t, i) => ({ day: t.slice(0, 10), aqi: a.hourly.european_aqi[i] })),
    (h) => h.day,
  );

  const c: MonthClimate = { days: last, tMax: 0, rainy: 0, grey: 0, heat: 0, badAir: 0, sunrise: '', sunset: '' };
  w.daily.time.forEach((day, i) => {
    const light = (cloudByDay.get(day) ?? []).filter((h) => h.light);
    const cloud = light.length ? light.reduce((s, h) => s + h.cloud, 0) / light.length : 0;
    const kind = archiveDayKind(w.daily.precipitation_sum[i] ?? 0, cloud);
    if (kind === 'rainy') c.rainy++;
    if (kind === 'grey') c.grey++;
    const tMax = w.daily.temperature_2m_max[i];
    c.tMax += tMax / last;
    if (tMax >= HEAT) c.heat++;
    const aqi = Math.max(0, ...(aqiByDay.get(day) ?? []).map((h) => h.aqi ?? 0));
    if (aqi > BAD_AIR) c.badAir++;
  });
  c.tMax = Math.round(c.tMax * 10) / 10;
  c.sunrise = w.daily.sunrise[0].slice(11);
  c.sunset = w.daily.sunset[0].slice(11);
  return c;
}

// Тот же месяц за PAST_YEARS прошлых лет: 2026-10 → 2022-10 … 2025-10.
export const pastMonths = (month: string) => {
  const [y, m] = month.split('-');
  return Array.from({ length: PAST_YEARS }, (_, i) => `${Number(y) - PAST_YEARS + i}-${m}`);
};

// Докачивает недостающие прошлые месяцы в history.json. Возвращает, сколько скачано.
export async function ensureHistory(cityDir: string, coords: Coords, month: string) {
  const history = await readHistory(cityDir);
  const missing = pastMonths(month).filter((m) => !history[m]);
  for (const m of missing) history[m] = await fetchMonthClimate(coords, m);
  if (missing.length) await writeHistory(cityDir, history);
  return missing.length;
}
