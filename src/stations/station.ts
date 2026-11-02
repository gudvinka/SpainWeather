import type { Issue, StationValues } from '../quality.ts';
import type { DayTotals } from '../store.ts';

export type StationResult = {
  values: StationValues;
  stationTime: Date; // время, к которому относятся данные
  raw: string; // исходная строка/фрагмент — чтобы пересчитать что-то задним числом
  daily?: Record<string, DayTotals>; // итоги прошлых дней, если станция их отдаёт
  dailyError?: string; // итоги не получены (текущий замер при этом в порядке)
  issues?: Issue[]; // замечания самой станции (например, AEMET: не хватает часов с полуночи)
};

export type Station = {
  id: string;
  label: string;
  staleMin?: number; // через сколько минут отставания замер считается устаревшим (по умолчанию 60)
  // earlierRaw — `raw` прошлых сегодняшних замеров этой же станции (AEMET склеивает из них часы с полуночи)
  fetch(now: Date, earlierRaw?: string[]): Promise<StationResult>;
};

export const TIMEOUT = 15_000;

// Достаёт число по регулярке с одной группой; если не нашлось — ошибка с понятным именем поля.
export function pick(text: string, re: RegExp, field: string): number {
  const m = re.exec(text);
  if (!m) throw new Error(`не найдено поле «${field}»`);
  const v = Number(m[1]);
  if (!Number.isFinite(v)) throw new Error(`поле «${field}» не число: ${m[1]}`);
  return v;
}
