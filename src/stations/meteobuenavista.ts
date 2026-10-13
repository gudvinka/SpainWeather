import type { DayTotals } from '../store.ts';
import { dateOf } from '../time.ts';
import { TIMEOUT, type Station, type StationResult } from './station.ts';

// Станция MeteoBuenavista, Овьедо (Davis + Weather Display). Форматы файлов:
// clientraw.txt — текущее состояние, поля через пробел, [0] === '12345'.
// clientrawdaily.txt — блоки по 31 значению за последние 31 день (от старого к новому, последний — вчера).
const BASE = 'https://www.meteobuenavista.es';

async function fetchFields(file: string) {
  const res = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const raw = (await res.text()).trim();
  const f = raw.split(/\s+/);
  if (f[0] !== '12345') throw new Error(`${file}: не похоже на файл Weather Display`);
  return { raw, f };
}

function num(f: string[], i: number) {
  const v = Number(f[i]);
  if (f[i] === undefined || !Number.isFinite(v)) throw new Error(`clientraw: поле ${i} не число: ${f[i]}`);
  return v;
}

// Итоги последних 31 дня. Отсчёт от даты станции, а не от часов компьютера:
// сразу после полуночи станция могла ещё не перевернуть сутки.
export function parseDaily(f: string[], stationDate: Date): Record<string, DayTotals> {
  const days: Record<string, DayTotals> = {};
  for (let i = 0; i < 31; i++) {
    const date = new Date(stationDate.getFullYear(), stationDate.getMonth(), stationDate.getDate() - (31 - i));
    days[dateOf(date)] = { tMax: num(f, 1 + i), tMin: num(f, 32 + i), rain: num(f, 63 + i) };
  }
  return days;
}

export const meteobuenavista: Station = {
  id: 'meteobuenavista',
  label: 'MeteoBuenavista',
  async fetch(): Promise<StationResult> {
    const { raw, f } = await fetchFields('clientraw.txt');

    // [74] DD/MM/YYYY, [29..31] часы, минуты, секунды
    const [d, m, y] = (f[74] ?? '').split('/').map(Number);
    const stationTime = new Date(y, m - 1, d, num(f, 29), num(f, 30), num(f, 31));
    if (Number.isNaN(stationTime.getTime())) throw new Error(`clientraw: дата станции не разобрана: ${f[74]}`);

    const result: StationResult = {
      values: {
        temp: num(f, 4),
        humidity: num(f, 5),
        dew: num(f, 72),
        rainToday: num(f, 7),
        rainMonth: num(f, 8),
        rainYear: num(f, 9),
        tMax: num(f, 46),
        tMin: num(f, 47),
      },
      stationTime,
      raw,
    };

    try {
      result.daily = parseDaily((await fetchFields('clientrawdaily.txt')).f, stationTime);
    } catch (e) {
      result.dailyError = e instanceof Error ? e.message : String(e);
    }
    return result;
  },
};
