import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Issue, Level, StationValues } from './quality.ts';

// Данные города лежат по месяцам: site/<город>/<ГГГГ-ММ>/{weather.jsonl, daily.json, sky.json, log.jsonl}.
// Храним только сырые данные и замечания проверок; итоги дней считаются при сборке страниц.

export type Reading = StationValues & {
  time: string; // время запуска, 2026-10-12T14:40
  stationTime: string; // время данных станции
  stale: boolean; // станция отстаёт больше чем на час
  raw: string;
  issues?: Issue[]; // нет у замеров, сохранённых до появления проверок
};

export type DayTotals = { tMax: number; tMin: number; rain: number; issues?: Issue[] };

export type SkyDay = {
  cloud: number; // средняя облачность за светлые часы, %
  sunHours: number;
  aqiMax?: number; // худший европейский индекс качества воздуха за день
  sunrise: string;
  sunset: string;
  issues?: Issue[];
};

// Итоги месяца прошлого года из архива (для «как обычно» в шапке месяца). Хранятся в site/<город>/history.json.
export type MonthClimate = {
  days: number;
  tMax: number; // средний дневной максимум
  rainy: number;
  grey: number;
  heat: number;
  badAir: number;
  sunrise: string; // восход и закат 1-го числа
  sunset: string;
};

// Замечания запуска, не привязанные к конкретной записи: камера, недоступный источник, сверки.
export type LogEntry = { time: string; source: string; level: Level; message: string };

// Нет файла — значит, данных ещё нет. Любая другая ошибка (битый JSON, файл занят) — исключение:
// иначе mergeByDate перезаписал бы файл одними свежими датами и стёр историю.
async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T;
  } catch {
    throw new Error(`${file}: файл испорчен (не JSON) — не трогаю его, поправьте вручную`);
  }
}

// Битая строка (например, файл правили руками) пропускается с предупреждением, а не прячет весь файл.
async function readLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const rows: T[] = [];
  text
    .replace(/^\uFEFF/, '') // метка кодировки, которую добавляют некоторые редакторы
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        console.warn(`WARN  ${file}: строка ${i + 1} не разобрана и пропущена`);
      }
    });
  return rows;
}

async function appendLine(cityDir: string, month: string, file: string, value: unknown) {
  const dir = path.join(cityDir, month);
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, file), JSON.stringify(value) + '\n', 'utf8');
}

// Раскладывает записи по датам в файлы месяцев, перезаписывая те же даты. Возвращает затронутые месяцы.
async function mergeByDate<T>(cityDir: string, file: string, days: Record<string, T>) {
  const byMonth = Map.groupBy(Object.keys(days), (date) => date.slice(0, 7));
  for (const [month, dates] of byMonth) {
    const dir = path.join(cityDir, month);
    const existing = await readJson<Record<string, T>>(path.join(dir, file), {});
    for (const date of dates) existing[date] = days[date];
    const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  }
  return [...byMonth.keys()];
}

export const appendReading = (cityDir: string, r: Reading) => appendLine(cityDir, r.time.slice(0, 7), 'weather.jsonl', r);
export const appendLog = (cityDir: string, e: LogEntry) => appendLine(cityDir, e.time.slice(0, 7), 'log.jsonl', e);
export const mergeDaily = (cityDir: string, days: Record<string, DayTotals>) => mergeByDate(cityDir, 'daily.json', days);
export const mergeSky = (cityDir: string, days: Record<string, SkyDay>) => mergeByDate(cityDir, 'sky.json', days);

export const readReadings = (monthDir: string) => readLines<Reading>(path.join(monthDir, 'weather.jsonl'));
export const readLog = (monthDir: string) => readLines<LogEntry>(path.join(monthDir, 'log.jsonl'));
export const readDaily = (monthDir: string) => readJson<Record<string, DayTotals>>(path.join(monthDir, 'daily.json'), {});
export const readHistory = (cityDir: string) =>
  readJson<Record<string, MonthClimate>>(path.join(cityDir, 'history.json'), {});
export async function writeHistory(cityDir: string, history: Record<string, MonthClimate>) {
  const sorted = Object.fromEntries(Object.entries(history).sort(([a], [b]) => a.localeCompare(b)));
  await mkdir(cityDir, { recursive: true });
  await writeFile(path.join(cityDir, 'history.json'), JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}
export const readSky = (monthDir: string) => readJson<Record<string, SkyDay>>(path.join(monthDir, 'sky.json'), {});
