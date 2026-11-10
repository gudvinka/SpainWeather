// SpainWeather: один запуск — для каждого города кадры камер, замер станции, небо и воздух; для других мест
// (PLACES) — кадры камер и небо с температурой по модели; затем пересборка сайта.
// Запуск: node src/snap.ts
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { capture, type Camera } from './camera.ts';
import { ALL_PLACES, CITIES, PLACES, type City, type Place } from './cities.ts';
import { ensureHistory } from './history.ts';
import { fetchSky } from './openmeteo.ts';
import { checkDayTotals, checkReading, hasErrors, type Issue, type Level } from './quality.ts';
import { buildSite, cityDir, SITE } from './report.ts';
import {
  appendLog,
  appendReading,
  mergeDaily,
  mergeSky,
  primaryDownDates,
  readDaily,
  readLog,
  readReadings,
  type DayTotals,
  type Reading,
} from './store.ts';
import { dateOf, fileStamp, localIso, monthOf } from './time.ts';

const errorText = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

// Счётчики и вывод замечаний одного города (или другого места — тогда optional: ошибки считаются предупреждениями,
// запуск из-за необязательных мест не краснеет).
class CityRun<P extends Place = City> {
  errors = 0;
  warnings = 0;
  months = new Set<string>();
  readonly city: P;
  readonly now: Date;
  readonly optional: boolean;
  constructor(city: P, now: Date, optional = false) {
    this.city = city;
    this.now = now;
    this.optional = optional;
  }

  ok(source: string, text: string) {
    console.log(`OK    ${this.city.id} ${source} -> ${text}`);
  }

  // Печатает замечание; замечания без своей записи (камера, сверки, недоступный источник) пишет в log.jsonl,
  // чтобы они появились в карточке дня как «данные под вопросом».
  async note(source: string, given: Level, message: string, toLog = true) {
    const level: Level = this.optional ? 'warn' : given;
    if (level === 'error') this.errors++;
    else this.warnings++;
    console.log(`${level === 'error' ? 'ERROR' : 'WARN '} ${this.city.id} ${source}: ${message}`);
    if (toLog) {
      await appendLog(cityDir(this.city), { time: localIso(this.now), source, level, message });
      this.months.add(monthOf(this.now));
    }
  }

  async notes(source: string, issues: Issue[], toLog: boolean) {
    for (const i of issues) await this.note(source, i.level, i.message, toLog);
  }

  summary() {
    if (!this.errors && !this.warnings) return `${this.city.names.ru} — OK`;
    return `${this.city.names.ru} — ошибок ${this.errors}, предупреждений ${this.warnings}`;
  }
}

async function collectStation(run: CityRun) {
  await collectReading(run);
  await fillDailyGaps(run);
}

async function collectReading(run: CityRun) {
  const { city, now } = run;
  const dir = cityDir(city);
  const today = dateOf(now);
  const todayReadings = (await readReadings(path.join(dir, monthOf(now)))).filter((r) => r.time.startsWith(today));

  // Основная станция не ответила — берём запасную. Это предупреждение, а не ошибка: замер дня всё равно есть.
  let station = city.station;
  let result;
  try {
    result = await station.fetch(now);
  } catch (e) {
    const failed = `${station.label} недоступна: ${errorText(e)}`;
    if (!city.backup) return run.note('станция', 'error', failed);
    const backup = city.backup;
    try {
      result = await backup.fetch(now, todayReadings.filter((r) => r.station === backup.id).map((r) => r.raw));
    } catch (e2) {
      await run.note('станция', 'error', failed);
      return run.note('станция', 'error', `запасная ${backup.label} тоже недоступна: ${errorText(e2)}`);
    }
    station = backup;
    await run.note('станция', 'warn', `${failed}; замер взят с запасной станции ${backup.label}`);
  }

  // Предыдущий замер сегодняшнего дня — для проверки скачков температуры.
  const prev = todayReadings.filter((r) => !hasErrors(r.issues)).at(-1);

  const issues = [
    ...(result.issues ?? []),
    ...checkReading(result.values, { now, stationTime: result.stationTime, staleMin: station.staleMin, prev }),
  ];
  const reading: Reading = {
    ...result.values,
    time: localIso(now),
    stationTime: localIso(result.stationTime),
    stale: issues.some((i) => i.field === 'stationTime'),
    ...(station !== city.station ? { station: station.id } : {}),
    raw: result.raw,
    ...(issues.length ? { issues } : {}),
  };
  await appendReading(dir, reading);
  run.months.add(monthOf(now));
  await run.notes('станция', issues, false); // замечания уже сохранены в самом замере
  if (!hasErrors(issues)) {
    const v = result.values;
    run.ok('станция', `${v.temp}°, роса ${v.dew}°, влажность ${v.humidity}%, дождь сегодня ${v.rainToday} мм`);
  }

  if (result.dailyError) await run.note('история станции', 'error', result.dailyError);
  if (!result.daily) return;

  // Итоги основной станции за дни, когда она стояла, не берём (их закроет запасная — см. fillDailyGaps).
  let entries = Object.entries(result.daily);
  if (station === city.station) {
    const months = [...new Set(entries.map(([date]) => date.slice(0, 7)))];
    const readings = (await Promise.all(months.map((m) => readReadings(path.join(dir, m))))).flat();
    const log = (await Promise.all(months.map((m) => readLog(path.join(dir, m))))).flat();
    const down = primaryDownDates(readings, log);
    entries = entries.filter(([date]) => !down.has(date));
  }

  const daily: Record<string, DayTotals> = {};
  for (const [date, t] of entries) {
    const dayIssues = checkDayTotals(t);
    daily[date] = dayIssues.length ? { ...t, issues: dayIssues } : t;
    await run.notes(`история ${date}`, dayIssues, false);
  }
  for (const m of await mergeDaily(dir, daily)) run.months.add(m);
  run.ok('история станции', `${Object.keys(daily).length} дн.`);

  // Сверка: дождь по дням этого месяца + сегодняшний должен совпасть со счётчиком станции «за месяц».
  // Месяц — по дате станции (около полуночи она может отличаться от часов компьютера); дни с ошибками не считаем.
  const rainMonth = result.values.rainMonth;
  if (rainMonth !== undefined && !hasErrors(issues)) {
    const month = monthOf(result.stationTime);
    const sum = Object.entries(daily)
      .filter(([date, d]) => date.startsWith(month) && !hasErrors(d.issues))
      .reduce((acc, [, d]) => acc + d.rain, result.values.rainToday);
    if (Math.abs(sum - rainMonth) > 0.5) {
      await run.note('история станции', 'warn', `сумма дождя по дням ${sum.toFixed(1)} мм ≠ счётчик месяца ${rainMonth} мм`);
    }
  }
}

// Дни без итогов за последние 10 дней (основная станция молчала) закрываем итогами запасной.
// AEMET публикует итоги с опозданием дня на 3 — пока их нет, день просто остаётся пустым до следующего сбора.
const GAP_DAYS = 10;

async function fillDailyGaps(run: CityRun) {
  const { city, now } = run;
  const backup = city.backup;
  if (!backup?.fetchDaily) return;
  const dir = cityDir(city);
  const dates = Array.from({ length: GAP_DAYS }, (_, i) =>
    dateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - GAP_DAYS + i)),
  );
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const have: Record<string, DayTotals> = Object.assign({}, ...(await Promise.all(months.map((m) => readDaily(path.join(dir, m))))));
  const missing = dates.filter((d) => !have[d]);
  if (!missing.length) return;

  let got;
  try {
    got = await backup.fetchDaily(missing[0], missing.at(-1)!);
  } catch (e) {
    // Не ошибка дня: итоги дозаполнятся следующим сбором. Только печать, без записи в журнал.
    return run.note('итоги дней', 'warn', `${backup.label}: ${errorText(e)}`, false);
  }
  const fill: Record<string, DayTotals> = {};
  for (const date of missing.filter((d) => got[d])) {
    const dayIssues = checkDayTotals(got[date]);
    fill[date] = dayIssues.length ? { ...got[date], issues: dayIssues } : got[date];
    await run.notes(`итоги ${date}`, dayIssues, false);
  }
  const filled = Object.keys(fill);
  if (filled.length) for (const m of await mergeDaily(dir, fill)) run.months.add(m);
  const waiting = missing.filter((d) => !fill[d]);
  run.ok(
    'итоги дней',
    `${backup.label}: ${filled.length ? `закрыто ${filled.join(', ')}` : 'новых нет'}${waiting.length ? `; ждём ${waiting.join(', ')}` : ''}`,
  );
}

async function collectSky(run: CityRun<Place>) {
  try {
    const sky = await fetchSky(run.city.coords, run.now);
    for (const [date, day] of Object.entries(sky)) await run.notes(`небо ${date}`, day.issues ?? [], false);
    for (const m of await mergeSky(cityDir(run.city), sky)) run.months.add(m);
    run.ok('небо и воздух', `${Object.keys(sky).length} дн.`);
  } catch (e) {
    await run.note('небо и воздух', 'error', `Open-Meteo недоступен: ${errorText(e)}`);
  }
}

// Кадр одной камеры. У города с несколькими камерами в журнале источник — «камера <имя>».
async function collectFrame(run: CityRun<Place>, cam: Camera, browser?: Browser) {
  const { city, now } = run;
  const source = city.cameras.length > 1 ? `камера ${cam.name}` : 'камера';
  let context: BrowserContext | undefined;
  try {
    if (cam.kind !== 'image') {
      if (!browser) throw new Error('браузер не запустился');
      context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    }
    const dir = path.join(cityDir(city), monthOf(now), 'screenshots');
    const frame = await capture(cam, dir, fileStamp(now), now, context);
    run.months.add(monthOf(now));
    await run.notes(source, frame.issues, true);
    if (!hasErrors(frame.issues)) run.ok(source, `${path.relative(SITE, frame.file)} (${Math.round(frame.bytes / 1024)} КБ)`);
  } catch (e) {
    await run.note(source, 'error', `кадр не получен: ${errorText(e)}`);
  } finally {
    await context?.close();
  }
}

// Непредвиденная ошибка источника (например, испорченный файл данных) записывается как ошибка этого источника
// и не прерывает остальные источники и города.
async function guarded(run: CityRun<Place>, source: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (e) {
    await run.note(source, 'error', errorText(e), false);
  }
}

const now = new Date();
let browser: Browser | undefined;
if (ALL_PLACES.some((c) => c.cameras.some((cam) => cam.kind !== 'image'))) {
  try {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  } catch (e) {
    // Камеры-видео в этот раз не снимутся (collectFrame запишет ошибку), остальное собирается как обычно.
    console.log(`ERROR браузер не запустился: ${errorText(e)}`);
  }
}

const runs = CITIES.map((city) => new CityRun(city, now));
const placeRuns = PLACES.map((place) => new CityRun<Place>(place, now, true));
const frames = (run: CityRun<Place>) => run.city.cameras.map((cam) => guarded(run, 'камера', () => collectFrame(run, cam, browser)));
try {
  await Promise.all([
    ...runs.map((run) =>
      Promise.all([guarded(run, 'станция', () => collectStation(run)), guarded(run, 'небо и воздух', () => collectSky(run)), ...frames(run)]),
    ),
    ...placeRuns.map((run) => Promise.all([guarded(run, 'небо и воздух', () => collectSky(run)), ...frames(run)])),
  ]);
} finally {
  await browser?.close();
}

// «Как обычно» для шапок затронутых месяцев: прошлые годы из архива, качаются один раз.
// Без архива страница всё равно строится (без «обычно»), поэтому сбой — предупреждение.
for (const run of runs) {
  let fetched = 0;
  try {
    for (const month of run.months) fetched += await ensureHistory(cityDir(run.city), run.city.coords, month);
    if (fetched) run.ok('архив прошлых лет', `скачано месяцев: ${fetched}`);
  } catch (e) {
    await run.note('архив прошлых лет', 'warn', `не загружен: ${errorText(e)}`, false);
  }
}

const touched = new Map(runs.map((r) => [r.city.id, r.months]));
for (const file of await buildSite(now, touched)) console.log(`PAGE  ${path.relative(SITE, file)}`);

console.log(`\nИтог: ${[...runs, ...placeRuns].map((r) => r.summary()).join(' · ')}`);
console.log(`Сайт: ${path.join(SITE, 'index.html')}`);
process.exitCode = runs.some((r) => r.errors) ? 1 : 0;
