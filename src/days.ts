import { hasErrors } from './quality.ts';
import type { DayTotals, LogEntry, Reading, SkyDay } from './store.ts';

// Тип дня — от него зависит цвет всей строки дня. Порядок важности: осадки → туман → небо.
export type SkyKind = 'clear' | 'partly' | 'cloudy' | 'overcast';
export type DayKind = 'none' | SkyKind | 'fog' | 'drizzle' | 'rain' | 'downpour';
export type AirKind = 'good' | 'fair' | 'poor';

// Правила возвращают смысл (коды), а не текст: слова на нужном языке подставляет src/i18n.ts при сборке страниц.
export type PrecipAmount = 'none' | 'sprinkle' | 'light' | 'rain' | 'heavy' | 'drizzleAllDay';
export type RainWhen = 'allDay' | 'day' | 'night';
export type Precip = { amount: PrecipAmount; when?: RainWhen };
export type FeelKind = 'dry' | 'comfortable' | 'normal' | 'humid' | 'muggy' | 'oppressive' | 'damp' | 'dampCold';
export type HeatingKind = 'evening' | 'needed';
export type Sky = { kind: SkyKind; sunHours: number };

export type DaySummary = {
  date: string;
  partial: boolean; // сегодняшний день, итоги ещё не окончательные
  tMin?: number;
  tMax?: number;
  rain?: number; // мм за сутки
  precip?: Precip;
  sky?: Sky;
  feel?: FeelKind;
  fog: boolean;
  air?: AirKind;
  heating?: HeatingKind;
  kind: DayKind;
  issues: string[]; // замечания проверок за этот день — «данные под вопросом» (служебные, на русском)
};

const RAIN_MIN = 0.2; // меньше — считаем, что дождя не было (одно опрокидывание ведёрка)

// Пороги сводки месяца — одни и те же для наших дней и для архива прошлых лет.
export const RAINY_MM = 1; // дождливый день — от 1 мм (как у AEMET)
export const GREY_CLOUD = 60; // серый день — облачность днём от 60 % («облачно» и «пасмурно»)
export const HEAT = 35; // «пекло» — максимум от 35°
export const BAD_AIR = 60; // плохой воздух — европейский индекс выше 60

function rainAmount(mm: number): PrecipAmount {
  if (mm < RAIN_MIN) return 'none';
  if (mm < 1) return 'sprinkle';
  if (mm < 5) return 'light';
  if (mm < 15) return 'rain';
  return 'heavy';
}

// Цвет дня. Осадки от 1 мм перекрашивают день; «покапало» — нет.
// Туман важнее неба, только если днём так и не прояснилось.
export function dayKind(rain: number | undefined, sky: SkyKind | undefined, fog: boolean): DayKind {
  if (rain !== undefined && rain >= 15) return 'downpour';
  if (rain !== undefined && rain >= 5) return 'rain';
  if (rain !== undefined && rain >= 1) return 'drizzle';
  if (fog && sky !== 'clear' && sky !== 'partly') return 'fog';
  if (sky) return sky;
  if (rain !== undefined && rain >= RAIN_MIN) return 'drizzle';
  return 'none';
}

// Когда шёл дождь, по замерам дня: интервалы между замерами — «днём», остальное до суммы за сутки — «ночью».
export function rainWhen(total: number, readings: Reading[]): RainWhen | undefined {
  if (readings.length < 2 || total < RAIN_MIN) return undefined;
  const steps = readings.slice(1).map((r, i) => r.rainToday - readings[i].rainToday);
  const day = steps.reduce((a, b) => a + b, 0);
  const night = total - day;

  if (night >= RAIN_MIN && steps.every((s) => s >= RAIN_MIN)) return 'allDay';
  if (day < RAIN_MIN) return 'night';
  if (night < RAIN_MIN) return 'day';
  return undefined;
}

// Осадки за сутки: сколько и когда. Мало, но весь день — это «моросит весь день».
export function precipOf(total: number, when?: RainWhen): Precip {
  const amount = rainAmount(total);
  if (amount === 'none') return { amount };
  if (when === 'allDay' && total < 5) return { amount: 'drizzleAllDay' };
  return when ? { amount, when } : { amount };
}

// Ощущение от влажности: в тепло по точке росы, в прохладу по близости воздуха к насыщению.
export function feel(temp: number, dew: number): FeelKind {
  if (temp >= 18) {
    if (dew < 10) return 'dry';
    if (dew < 13) return 'comfortable';
    if (dew < 16) return 'normal';
    if (dew < 18) return 'humid';
    if (dew < 21) return 'muggy';
    return 'oppressive';
  }
  const spread = temp - dew;
  if (spread > 5) return 'dry';
  if (spread >= 2) return 'damp';
  return 'dampCold';
}

export function heating(tMin: number, tMax: number): HeatingKind | undefined {
  const mean = (tMin + tMax) / 2;
  if (mean < 12) return 'needed';
  if (mean < 15) return 'evening';
  return undefined;
}

// Небо по средней облачности за светлое время (низкие и средние облака).
export function skyOf(cloud: number, sunHours: number): Sky {
  const kind: SkyKind = cloud < 20 ? 'clear' : cloud < GREY_CLOUD ? 'partly' : cloud < 90 ? 'cloudy' : 'overcast';
  return { kind, sunHours };
}

// Европейский индекс качества воздуха: до 40 — хорошо/удовлетворительно, до 60 — умеренно, выше — плохо.
export function airOf(aqi: number): AirKind {
  if (aqi <= 40) return 'good';
  if (aqi <= BAD_AIR) return 'fair';
  return 'poor';
}

const hourOf = (r: Reading) => Number(r.time.slice(11, 13)) + Number(r.time.slice(14, 16)) / 60;

export type DayInput = {
  date: string;
  totals?: DayTotals;
  readings: Reading[];
  isToday: boolean;
  sky?: SkyDay;
  log?: LogEntry[];
};

export function summarizeDay(input: DayInput): DaySummary {
  const { date, isToday } = input;
  // Записи с ошибками проверки (невозможные значения) и устаревшие замеры в расчётах не участвуют.
  const totals = hasErrors(input.totals?.issues) ? undefined : input.totals;
  const skyDay = hasErrors(input.sky?.issues) ? undefined : input.sky;
  const readings = input.readings
    .filter((r) => !r.stale && !hasErrors(r.issues))
    .sort((a, b) => a.time.localeCompare(b.time));
  const last = readings.at(-1);

  const issues = [
    ...input.readings.flatMap((r) => (r.issues ?? []).map((i) => `${r.time.slice(11)} станция: ${i.message}`)),
    ...(input.totals?.issues ?? []).map((i) => `итоги дня: ${i.message}`),
    ...(input.sky?.issues ?? []).map((i) => `небо/воздух: ${i.message}`),
    ...(input.log ?? []).map((e) => `${e.time.slice(11)} ${e.source}: ${e.message}`),
  ];

  const tMin = totals?.tMin ?? last?.tMin;
  const tMax = totals?.tMax ?? last?.tMax;
  const rain = totals?.rain ?? last?.rainToday;

  // «Лицо дня» — замер ближе всего к 14:00, но только в окне 12–17.
  const midday = readings
    .filter((r) => hourOf(r) >= 12 && hourOf(r) < 17)
    .sort((a, b) => Math.abs(hourOf(a) - 14) - Math.abs(hourOf(b) - 14))[0];

  const morning = readings.find((r) => hourOf(r) < 11);
  const sky = skyDay && skyOf(skyDay.cloud, skyDay.sunHours);
  const fog = !!morning && morning.temp - morning.dew < 1;

  return {
    date,
    partial: isToday,
    tMin,
    tMax,
    rain,
    precip: rain === undefined ? undefined : precipOf(rain, isToday ? undefined : rainWhen(rain, readings)),
    sky,
    feel: midday && feel(midday.temp, midday.dew),
    fog,
    air: skyDay?.aqiMax === undefined ? undefined : airOf(skyDay.aqiMax),
    heating: tMin !== undefined && tMax !== undefined ? heating(tMin, tMax) : undefined,
    kind: dayKind(rain, sky?.kind, fog),
    issues: [...new Set(issues)],
  };
}

// Итоги месяца для главной страницы: по дням, у которых есть данные.
export function monthStats(summaries: DaySummary[]) {
  const withTemps = summaries.filter((s) => s.tMin !== undefined && s.tMax !== undefined);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);
  const counts = {} as Record<DayKind, number>;
  for (const s of summaries) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  return {
    days: summaries.length,
    avgMin: avg(withTemps.map((s) => s.tMin!)),
    avgMax: avg(withTemps.map((s) => s.tMax!)),
    counts,
    rain: Math.round(summaries.reduce((a, s) => a + (s.rain ?? 0), 0)),
    heatingDays: summaries.filter((s) => s.heating).length,
  };
}

// Сводка месяца для шапки: дни делятся на непересекающиеся группы — дождливые / серые (без дождя) / остальные.
export type MonthBreakdown = { days: number; tMax?: number; rainy: number; grey: number; heat: number; badAir: number };

export function monthBreakdown(summaries: DaySummary[]): MonthBreakdown {
  const maxes = summaries.map((s) => s.tMax).filter((v): v is number => v !== undefined);
  const rainy = (s: DaySummary) => (s.rain ?? 0) >= RAINY_MM;
  return {
    days: summaries.length,
    tMax: maxes.length ? maxes.reduce((a, b) => a + b, 0) / maxes.length : undefined,
    rainy: summaries.filter(rainy).length,
    grey: summaries.filter((s) => !rainy(s) && (s.kind === 'cloudy' || s.kind === 'overcast' || s.kind === 'fog')).length,
    heat: maxes.filter((v) => v >= HEAT).length,
    badAir: summaries.filter((s) => s.air === 'poor').length,
  };
}

// День из архива прошлых лет — по тем же порогам, что и наши дни.
export function archiveDayKind(rainMm: number, daylightCloud: number): 'rainy' | 'grey' | 'other' {
  if (rainMm >= RAINY_MM) return 'rainy';
  if (daylightCloud >= GREY_CLOUD) return 'grey';
  return 'other';
}

// Палитра от тёплого к холодному: цвет строки дня и цвет текста на ней. Названия — в src/i18n.ts.
// Гроза (фиолетовый #6b2fa0) — когда появятся данные о грозах.
const INK = '#1d2433';
const WHITE = '#ffffff';
export const KIND_STYLE: Record<DayKind, { bg: string; fg: string }> = {
  clear: { bg: '#ffc93c', fg: INK },
  partly: { bg: '#8ec9ee', fg: INK },
  cloudy: { bg: '#b4c2cf', fg: INK },
  overcast: { bg: '#9aa4ae', fg: INK },
  fog: { bg: '#d9d6e4', fg: INK },
  drizzle: { bg: '#4db6ac', fg: INK },
  rain: { bg: '#2f7fe0', fg: WHITE },
  downpour: { bg: '#1b2f8a', fg: WHITE },
  none: { bg: '#e5e7eb', fg: INK },
};