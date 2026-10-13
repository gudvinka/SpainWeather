// SpainWeather: один запуск — для каждого города кадр камеры, замер станции, небо и воздух, затем пересборка сайта.
// Запуск: node src/snap.ts
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { capture } from './camera.ts';
import { CITIES, type City } from './cities.ts';
import { ensureHistory } from './history.ts';
import { fetchSky } from './openmeteo.ts';
import { checkDayTotals, checkReading, hasErrors, type Issue, type Level } from './quality.ts';
import { buildSite, cityDir, SITE } from './report.ts';
import { appendLog, appendReading, mergeDaily, mergeSky, readReadings, type DayTotals, type Reading } from './store.ts';
import { dateOf, fileStamp, localIso, monthOf } from './time.ts';

const errorText = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

// Счётчики и вывод замечаний одного города.
class CityRun {
  errors = 0;
  warnings = 0;
  months = new Set<string>();
  readonly city: City;
  readonly now: Date;
  constructor(city: City, now: Date) {
    this.city = city;
    this.now = now;
  }

  ok(source: string, text: string) {
    console.log(`OK    ${this.city.id} ${source} -> ${text}`);
  }

  // Печатает замечание; замечания без своей записи (камера, сверки, недоступный источник) пишет в log.jsonl,
  // чтобы они появились в карточке дня как «данные под вопросом».
  async note(source: string, level: Level, message: string, toLog = true) {
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
  const { city, now } = run;
  const dir = cityDir(city);
  let result;
  try {
    result = await city.station.fetch(now);
  } catch (e) {
    return run.note('станция', 'error', `${city.station.label} недоступна: ${errorText(e)}`);
  }

  // Предыдущий замер сегодняшнего дня — для проверки скачков температуры.
  const today = dateOf(now);
  const prev = (await readReadings(path.join(dir, monthOf(now))))
    .filter((r) => r.time.startsWith(today) && !hasErrors(r.issues))
    .at(-1);

  const issues = checkReading(result.values, { now, stationTime: result.stationTime, prev });
  const reading: Reading = {
    ...result.values,
    time: localIso(now),
    stationTime: localIso(result.stationTime),
    stale: issues.some((i) => i.field === 'stationTime'),
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

  const daily: Record<string, DayTotals> = {};
  for (const [date, t] of Object.entries(result.daily)) {
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

async function collectSky(run: CityRun) {
  try {
    const sky = await fetchSky(run.city.coords, run.now);
    for (const [date, day] of Object.entries(sky)) await run.notes(`небо ${date}`, day.issues ?? [], false);
    for (const m of await mergeSky(cityDir(run.city), sky)) run.months.add(m);
    run.ok('небо и воздух', `${Object.keys(sky).length} дн.`);
  } catch (e) {
    await run.note('небо и воздух', 'error', `Open-Meteo недоступен: ${errorText(e)}`);
  }
}

async function collectFrame(run: CityRun, browser?: Browser) {
  const { city, now } = run;
  let context: BrowserContext | undefined;
  try {
    if (city.camera.kind === 'rtspEmbed') {
      if (!browser) throw new Error('браузер не запустился');
      context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    }
    const dir = path.join(cityDir(city), monthOf(now), 'screenshots');
    const frame = await capture(city.camera, dir, fileStamp(now), now, context);
    run.months.add(monthOf(now));
    await run.notes('камера', frame.issues, true);
    if (!hasErrors(frame.issues)) run.ok('камера', `${path.relative(SITE, frame.file)} (${Math.round(frame.bytes / 1024)} КБ)`);
  } catch (e) {
    await run.note('камера', 'error', `кадр не получен: ${errorText(e)}`);
  } finally {
    await context?.close();
  }
}

// Непредвиденная ошибка источника (например, испорченный файл данных) записывается как ошибка этого источника
// и не прерывает остальные источники и города.
async function guarded(run: CityRun, source: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (e) {
    await run.note(source, 'error', errorText(e), false);
  }
}

const now = new Date();
let browser: Browser | undefined;
if (CITIES.some((c) => c.camera.kind === 'rtspEmbed')) {
  try {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  } catch (e) {
    // Камеры-видео в этот раз не снимутся (collectFrame запишет ошибку), остальное собирается как обычно.
    console.log(`ERROR браузер не запустился: ${errorText(e)}`);
  }
}

const runs = CITIES.map((city) => new CityRun(city, now));
try {
  await Promise.all(
    runs.map((run) =>
      Promise.all([
        guarded(run, 'станция', () => collectStation(run)),
        guarded(run, 'небо и воздух', () => collectSky(run)),
        guarded(run, 'камера', () => collectFrame(run, browser)),
      ]),
    ),
  );
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

console.log(`\nИтог: ${runs.map((r) => r.summary()).join(' · ')}`);
console.log(`Сайт: ${path.join(SITE, 'index.html')}`);
process.exitCode = runs.some((r) => r.errors) ? 1 : 0;
