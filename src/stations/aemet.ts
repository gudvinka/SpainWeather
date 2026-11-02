import type { Issue } from '../quality.ts';
import type { DayTotals } from '../store.ts';
import { dateOf, localIso } from '../time.ts';
import { TIMEOUT, type Station, type StationResult } from './station.ts';

// Станции AEMET (официальная метеослужба Испании), открытые данные: https://opendata.aemet.es
// Нужен бесплатный ключ в переменной AEMET_API_KEY (на GitHub — секрет с тем же именем).
// Запрос в два шага: сначала API отвечает ссылкой `datos`, по ней — JSON-массив замеров по часам за последние 12 часов
// (в ISO-8859-15). Замер приходит с опозданием около часа. Каждая строка — итог часа, который кончается в `fint` (UTC):
// ta — температура, tamin/tamax — мин/макс за час, hr — влажность, tpr — точка росы, prec — дождь за час, мм.
// Итоги по дням (мин, макс, дождь, часы солнца) — отдельный запрос, публикуются с опозданием дня на 3.
const API = 'https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion';
const DAILY_API = 'https://opendata.aemet.es/opendata/api/valores/climatologicos/diarios/datos';

export type AemetHour = { fint: string; ta: number; tamin: number; tamax: number; hr: number; tpr: number; prec: number };

const FIELDS = ['ta', 'tamin', 'tamax', 'hr', 'tpr', 'prec'] as const;
const HOUR = 3600_000;

// «2026-11-01T23:00:00+0000» → момент времени. Двоеточие в зоне добавляем сами — так дату разбирает любой движок.
const endOf = (h: AemetHour) => new Date(h.fint.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));

// Оставляет только нужные поля; час без какого-то поля пропускаем (AEMET иногда не отдаёт отдельные датчики).
export function parseHours(rows: unknown): AemetHour[] {
  if (!Array.isArray(rows)) throw new Error('AEMET: ответ не список замеров');
  const hours: AemetHour[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r?.fint !== 'string' || !FIELDS.every((f) => typeof r[f] === 'number')) continue;
    const h = { fint: r.fint } as AemetHour;
    for (const f of FIELDS) h[f] = r[f] as number;
    if (!Number.isNaN(endOf(h).getTime())) hours.push(h);
  }
  return hours;
}

// Итоги «с полуночи» по часам сегодняшнего дня (по местному времени). Часы склеиваются из этого ответа и сохранённых
// прошлыми сборами (`raw` прошлых замеров): одного ответа на 12 часов на сборе в 17:00 не хватает до полуночи.
export function summarize(fresh: AemetHour[], earlier: AemetHour[], now: Date): StationResult {
  const byEnd = new Map<string, AemetHour>();
  for (const h of [...earlier, ...fresh]) byEnd.set(endOf(h).toISOString(), h);
  const all = [...byEnd.values()].sort((a, b) => endOf(a).getTime() - endOf(b).getTime());
  const last = all.at(-1);
  if (!last) throw new Error('AEMET: нет ни одного полного замера');

  const today = dateOf(now);
  // Час относится к тому дню, в котором начался: час 23:00–00:00 — ещё вчерашний.
  const hours = all.filter((h) => dateOf(new Date(endOf(h).getTime() - HOUR)) === today);
  if (!hours.length) throw new Error(`AEMET: нет замеров за сегодня, последний — ${localIso(endOf(last))}`);

  const issues: Issue[] = [];
  const firstStart = new Date(endOf(hours[0]).getTime() - HOUR);
  const v = hours.at(-1)!;
  const span = Math.round((endOf(v).getTime() - firstStart.getTime()) / HOUR);
  if (firstStart.getHours() > 0) {
    issues.push({
      level: 'warn',
      field: 'rainToday',
      message: `AEMET: нет часов 00:00–${localIso(firstStart).slice(11)}, дождь и мин/макс за сутки неполные`,
    });
  } else if (hours.length < span) {
    issues.push({ level: 'warn', field: 'rainToday', message: 'AEMET: в сутках пропущены часы, дождь за сутки неполный' });
  }

  return {
    values: {
      temp: v.ta,
      humidity: v.hr,
      dew: v.tpr,
      rainToday: Math.round(hours.reduce((a, h) => a + h.prec, 0) * 10) / 10,
      tMax: Math.max(...hours.map((h) => h.tamax)),
      tMin: Math.min(...hours.map((h) => h.tamin)),
    },
    stationTime: endOf(v),
    raw: JSON.stringify(hours),
    ...(issues.length ? { issues } : {}),
  };
}

// Числа в итогах — строками с запятой: «18,4». Дождь «Ip» — неизмеримо мало (меньше 0,1 мм), считаем 0.
const decimal = (v: unknown) => (typeof v === 'string' ? Number(v.replace(',', '.')) : NaN);

// День без мин/макс/дождя пропускаем (бывает «Acum» — дождь за несколько дней одной суммой).
export function parseDaily(rows: unknown, source: string): Record<string, DayTotals> {
  if (!Array.isArray(rows)) throw new Error('AEMET: итоги дней — не список');
  const days: Record<string, DayTotals> = {};
  for (const r of rows as Record<string, unknown>[]) {
    const rain = r?.prec === 'Ip' ? 0 : decimal(r?.prec);
    const t = { tMax: decimal(r?.tmax), tMin: decimal(r?.tmin), rain };
    if (typeof r?.fecha !== 'string' || !Object.values(t).every(Number.isFinite)) continue;
    const sun = decimal(r.sol);
    days[r.fecha] = { ...t, ...(Number.isFinite(sun) ? { sun } : {}), source };
  }
  return days;
}

async function getJson(url: string, key?: string) {
  const res = await fetch(url, { headers: key ? { api_key: key } : {}, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`AEMET: HTTP ${res.status}`);
  return JSON.parse(new TextDecoder('iso-8859-15').decode(await res.arrayBuffer()));
}

export function aemet(id: string, label: string): Station {
  return {
    id: `aemet-${id}`,
    label,
    staleMin: 150, // часовой замер с опозданием около часа — отставание до 2,5 ч нормально
    async fetch(now, earlierRaw = []) {
      const key = process.env.AEMET_API_KEY;
      if (!key) throw new Error('нет ключа AEMET_API_KEY');
      const meta = await getJson(`${API}/${id}`, key);
      if (typeof meta?.datos !== 'string') throw new Error(`AEMET: ${meta?.descripcion ?? 'нет ссылки на данные'}`);
      const earlier = earlierRaw.flatMap((raw) => {
        try {
          return parseHours(JSON.parse(raw));
        } catch {
          return [];
        }
      });
      return summarize(parseHours(await getJson(meta.datos)), earlier, now);
    },
    async fetchDaily(from, to) {
      const key = process.env.AEMET_API_KEY;
      if (!key) throw new Error('нет ключа AEMET_API_KEY');
      const meta = await getJson(`${DAILY_API}/fechaini/${from}T00:00:00UTC/fechafin/${to}T23:59:59UTC/estacion/${id}`, key);
      if (meta?.estado === 404) return {}; // «No hay datos» — итоги за эти дни ещё не опубликованы
      if (typeof meta?.datos !== 'string') throw new Error(`AEMET: ${meta?.descripcion ?? 'нет ссылки на данные'}`);
      return parseDaily(await getJson(meta.datos), `aemet-${id}`);
    },
  };
}
