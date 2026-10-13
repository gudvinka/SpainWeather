// Проверки данных на здравый смысл.
// error — значение невозможно: запись сохраняется для истории, но в расчётах не участвует.
// warn  — значение подозрительно: используется, но в карточке дня помечается «данные под вопросом».

export type Level = 'error' | 'warn';
export type Issue = { level: Level; field: string; message: string };

const error = (field: string, message: string): Issue => ({ level: 'error', field, message });
const warn = (field: string, message: string): Issue => ({ level: 'warn', field, message });

export const hasErrors = (issues: Issue[] | undefined) => !!issues?.some((i) => i.level === 'error');

function range(issues: Issue[], field: string, name: string, v: number, min: number, max: number, unit: string) {
  if (!Number.isFinite(v)) issues.push(error(field, `${name}: не число`));
  else if (v < min || v > max) issues.push(error(field, `${name} ${v}${unit} вне допустимого ${min}…${max}${unit}`));
}

export type StationValues = {
  temp: number;
  humidity: number;
  dew: number;
  rainToday: number; // мм с полуночи
  rainMonth?: number;
  rainYear?: number;
  tMax: number; // макс/мин с полуночи
  tMin: number;
};

const STALE_MS = 60 * 60 * 1000;
// Скачок проверяем только между близкими замерами: за полдня температура законно меняется на 15–20°.
const TEMP_JUMP = 8;
const TEMP_JUMP_WINDOW_MS = 2 * 60 * 60 * 1000;

// Текущий замер станции. prev — предыдущий замер того же дня (для проверки скачков).
export function checkReading(
  v: StationValues,
  ctx: { now: Date; stationTime: Date; prev?: { temp: number; time: string } },
): Issue[] {
  const issues: Issue[] = [];
  range(issues, 'temp', 'температура', v.temp, -25, 50, '°');
  range(issues, 'dew', 'точка росы', v.dew, -35, 35, '°');
  range(issues, 'humidity', 'влажность', v.humidity, 1, 100, '%');
  range(issues, 'rainToday', 'дождь за сегодня', v.rainToday, 0, 300, ' мм');
  if (v.rainMonth !== undefined) range(issues, 'rainMonth', 'дождь за месяц', v.rainMonth, 0, 2000, ' мм');
  if (v.rainYear !== undefined) range(issues, 'rainYear', 'дождь за год', v.rainYear, 0, 5000, ' мм');
  range(issues, 'tMax', 'максимум за сегодня', v.tMax, -25, 50, '°');
  range(issues, 'tMin', 'минимум за сегодня', v.tMin, -25, 50, '°');
  if (v.tMin > v.tMax) issues.push(error('tMin', `минимум ${v.tMin}° выше максимума ${v.tMax}°`));
  if (issues.length) return issues; // дальше сравниваем значения между собой — только если сами они в порядке

  if (v.dew > v.temp + 0.5) issues.push(warn('dew', `точка росы ${v.dew}° выше температуры ${v.temp}°`));
  if (v.temp < v.tMin - 0.5 || v.temp > v.tMax + 0.5) {
    issues.push(warn('temp', `температура ${v.temp}° вне суточных мин/макс ${v.tMin}…${v.tMax}°`));
  }
  if (v.rainMonth !== undefined && v.rainToday > v.rainMonth + 0.1) {
    issues.push(warn('rainToday', `дождь за сегодня ${v.rainToday} мм больше, чем за месяц ${v.rainMonth} мм`));
  }
  if (v.rainMonth !== undefined && v.rainYear !== undefined && v.rainMonth > v.rainYear + 0.1) {
    issues.push(warn('rainMonth', `дождь за месяц ${v.rainMonth} мм больше, чем за год ${v.rainYear} мм`));
  }
  const lagMin = Math.round((ctx.now.getTime() - ctx.stationTime.getTime()) / 60_000);
  if (Math.abs(lagMin) * 60_000 > STALE_MS) {
    issues.push(warn('stationTime', `данные станции устарели: отстают на ${lagMin} мин`));
  }
  if (ctx.prev) {
    const [d, t] = ctx.prev.time.split('T');
    const prevAt = new Date(`${d}T${t}:00`); // местное время, как и ctx.now
    const close = ctx.now.getTime() - prevAt.getTime() <= TEMP_JUMP_WINDOW_MS;
    if (close && Math.abs(v.temp - ctx.prev.temp) > TEMP_JUMP) {
      issues.push(warn('temp', `скачок температуры ${ctx.prev.temp}° → ${v.temp}° с ${t}`));
    }
  }
  return issues;
}

// Итоги дня от станции.
export function checkDayTotals(t: { tMax: number; tMin: number; rain: number }): Issue[] {
  const issues: Issue[] = [];
  range(issues, 'tMax', 'максимум дня', t.tMax, -25, 50, '°');
  range(issues, 'tMin', 'минимум дня', t.tMin, -25, 50, '°');
  range(issues, 'rain', 'дождь за сутки', t.rain, 0, 300, ' мм');
  if (t.tMin > t.tMax) issues.push(error('tMin', `минимум дня ${t.tMin}° выше максимума ${t.tMax}°`));
  return issues;
}

// Небо и воздух за день от Open-Meteo.
export function checkSky(s: { cloud: number; sunHours: number; aqiMax?: number }): Issue[] {
  const issues: Issue[] = [];
  range(issues, 'cloud', 'облачность', s.cloud, 0, 100, '%');
  range(issues, 'sunHours', 'часы солнца', s.sunHours, 0, 16, ' ч');
  if (s.aqiMax !== undefined) range(issues, 'aqiMax', 'индекс воздуха', s.aqiMax, 0, 500, '');
  return issues;
}

// Кадр камеры: возраст картинки на сервере и её размер.
export function checkFrame(f: { ageMs?: number; bytes: number }): Issue[] {
  const issues: Issue[] = [];
  if (f.bytes < 5_000) issues.push(error('frame', `кадр подозрительно маленький: ${f.bytes} байт`));
  if (f.ageMs !== undefined && f.ageMs > STALE_MS) {
    issues.push(warn('frame', `кадр камеры старый: ${Math.round(f.ageMs / 60_000)} мин`));
  }
  return issues;
}
