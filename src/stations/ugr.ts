import { TIMEOUT, pick, type Station, type StationResult } from './station.ts';

// Станция Университета Гранады, Альбайсин (Davis Vantage Pro2, 730 м).
// Файлов с данными нет — разбираем HTML-страницу, где значения подписаны словами:
// «Temperatura 28.4 °C», «Lluvia hoy 0.0 mm», «Temperatura máx. y mín. 28.7 °C (14:57) +2h 11.3 °C ( 5:47) +2h».
// Истории по дням нет: итоги дня берутся из последнего замера дня.
const URL = 'https://www.ugr.es/~velilla/meteo-albayzin/index.htm';

// Страница в Latin-1; если вдруг перейдут на UTF-8 — поймём это сами.
export function decodePage(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&deg;/g, '°')
    .replace(/\s+/g, ' ');
}

const N = '(-?\\d+(?:\\.\\d+)?)';

export function parseUgr(html: string, now: Date): StationResult {
  const text = pageText(html);

  // Время на странице без даты: «17:13 (Hora local de actualización, CET)». Около полуночи часы станции
  // и компьютера могут оказаться по разные стороны суток — выбираем дату, при которой разница меньше 12 часов.
  const t = /(\d{1,2}):(\d{2}) \(Hora local de actualizaci/.exec(text);
  if (!t) throw new Error('не найдено время обновления');
  const stationTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(t[1]), Number(t[2]));
  const diff = stationTime.getTime() - now.getTime();
  if (diff > 12 * 3600_000) stationTime.setDate(stationTime.getDate() - 1);
  else if (diff < -12 * 3600_000) stationTime.setDate(stationTime.getDate() + 1);

  const maxMin = new RegExp(`Temperatura máx\\. y mín\\. ${N} °C \\(\\s*\\d{1,2}:\\d{2}\\) \\+\\dh ${N} °C`).exec(text);
  if (!maxMin) throw new Error('не найдено поле «Temperatura máx. y mín.»');

  const start = text.indexOf('Temperatura ');
  return {
    values: {
      temp: pick(text, new RegExp(`Temperatura ${N} °C`), 'Temperatura'),
      humidity: pick(text, new RegExp(`Humedad ${N} %`), 'Humedad'),
      dew: pick(text, new RegExp(`Punto de rocío ${N} °C`), 'Punto de rocío'),
      rainToday: pick(text, new RegExp(`Lluvia hoy ${N} mm`), 'Lluvia hoy'),
      rainMonth: pick(text, new RegExp(`Lluvia mensual ${N} mm`), 'Lluvia mensual'),
      rainYear: pick(text, new RegExp(`Lluvia año natural ${N} mm`), 'Lluvia año natural'),
      tMax: Number(maxMin[1]),
      tMin: Number(maxMin[2]),
    },
    stationTime,
    raw: text.slice(start, start + 1200),
  };
}

export const ugr: Station = {
  id: 'ugr',
  label: 'UGR Albayzín',
  async fetch(now: Date) {
    const res = await fetch(URL, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseUgr(decodePage(new Uint8Array(await res.arrayBuffer())), now);
  },
};
