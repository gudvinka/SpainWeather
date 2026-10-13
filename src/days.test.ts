import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  airOf,
  archiveDayKind,
  dayKind,
  feel,
  heating,
  monthBreakdown,
  monthStats,
  precipOf,
  rainWhen,
  skyOf,
  summarizeDay,
} from './days.ts';
import { T } from './i18n.ts';
import type { Reading } from './store.ts';

const reading = (time: string, rainToday: number, temp = 15, dew = 10): Reading => ({
  time,
  stationTime: time,
  stale: false,
  temp,
  humidity: 80,
  dew,
  rainToday,
  rainMonth: 0,
  rainYear: 0,
  tMax: 0,
  tMin: 0,
  raw: '',
});

const SUN = { cloud: 10, sunHours: 9, aqiMax: 20, sunrise: '08:20', sunset: '20:00' };
const OVERCAST = { cloud: 100, sunHours: 0, aqiMax: 30, sunrise: '08:20', sunset: '19:20' };

const ru = T.ru;

test('ощущение: примеры из обсуждения', () => {
  const said = (temp: number, dew: number) => ru.feel[feel(temp, dew)];
  assert.equal(said(22.6, 18.9), 'душно');
  assert.equal(said(23, 12), 'комфортно');
  assert.equal(said(12, 11.5), 'сыро и зябко');
  assert.equal(said(10, 0), 'сухо');
  assert.equal(said(15, 10), 'сыро');
  assert.equal(said(30, 19), 'душно');
});

test('отопление по средней за сутки', () => {
  assert.equal(heating(9, 13), 'needed');
  assert.equal(ru.heating.needed, 'отопление: нужно');
  assert.equal(heating(8, 16), 'evening');
  assert.equal(heating(16, 23), undefined);
});

test('осадки: количество и когда', () => {
  const said = (mm: number, when?: Parameters<typeof precipOf>[1]) => ru.precip(precipOf(mm, when));
  const allDay = [reading('2026-10-13T09:30', 1), reading('2026-10-13T14:00', 1.6), reading('2026-10-13T17:30', 2.2)];
  assert.equal(rainWhen(3, allDay), 'allDay');
  assert.equal(said(3, 'allDay'), 'моросит весь день');
  assert.equal(said(18, 'allDay'), 'сильный дождь весь день');

  const nightOnly = [reading('2026-10-14T09:30', 2), reading('2026-10-14T14:00', 2), reading('2026-10-14T17:30', 2)];
  assert.equal(rainWhen(6, nightOnly), 'night');
  assert.equal(said(6, 'night'), 'дождь ночью');

  const dayOnly = [reading('2026-10-16T09:30', 0), reading('2026-10-16T14:00', 0.4), reading('2026-10-16T17:30', 0.6)];
  assert.equal(said(0.6, rainWhen(0.6, dayOnly)), 'покапало днём');

  assert.equal(said(0), 'без осадков');
  assert.equal(said(37.2), 'сильный дождь');
});

test('небо по облачности', () => {
  assert.equal(ru.sky(skyOf(10, 8.4)), 'ясно, 8 ч');
  assert.equal(ru.sky(skyOf(45, 3.6)), 'переменная облачность, 4 ч');
  assert.equal(ru.sky(skyOf(75, 0.5)), 'облачно');
  assert.equal(ru.sky(skyOf(98, 0)), 'пасмурно');
});

test('испанская версия: те же правила, другие слова', () => {
  const es = T.es;
  assert.equal(es.precip(precipOf(3, 'allDay')), 'llovizna todo el día');
  assert.equal(es.precip(precipOf(6, 'night')), 'lluvia de noche');
  assert.equal(es.feel[feel(12, 11.5)], 'húmedo y frío');
  assert.equal(es.sky(skyOf(10, 8.4)), 'despejado, 8 h');
  assert.equal(es.heating.evening, 'calefacción: por la tarde');
  // в словарях одинаковый набор ключей — ничего не забыто
  assert.deepEqual(Object.keys(es).sort(), Object.keys(T.ru).sort());
  assert.deepEqual(Object.keys(es.kind).sort(), Object.keys(T.ru.kind).sort());
});

test('воздух по европейскому индексу', () => {
  assert.equal(airOf(25), 'good');
  assert.equal(airOf(40), 'good');
  assert.equal(airOf(55), 'fair');
  assert.equal(airOf(63), 'poor');
});

test('цвет дня: осадки → туман → небо', () => {
  assert.equal(dayKind(37.2, 'cloudy', false), 'downpour');
  assert.equal(dayKind(9.2, 'overcast', false), 'rain');
  assert.equal(dayKind(1.6, 'partly', false), 'drizzle');
  assert.equal(dayKind(0.6, 'partly', false), 'partly'); // покапало день не перекрашивает
  assert.equal(dayKind(0, 'overcast', true), 'fog'); // туман и так и не прояснилось
  assert.equal(dayKind(0, 'clear', true), 'clear'); // утренний туман, потом солнце
  assert.equal(dayKind(0, undefined, false), 'none');

  const day = summarizeDay({
    date: '2026-10-09',
    totals: { tMin: 10, tMax: 19, rain: 0.6 },
    readings: [],
    isToday: false,
    sky: OVERCAST,
  });
  assert.equal(day.kind, 'overcast');
  assert.equal(ru.precip(day.precip!), 'покапало');
});

test('итоги месяца', () => {
  const day = (date: string, tMin: number, tMax: number, rain: number) =>
    summarizeDay({ date, totals: { tMin, tMax, rain }, readings: [], isToday: false, sky: SUN });
  const st = monthStats([day('2026-10-01', 12, 19, 0), day('2026-10-04', 16, 22, 37.2), day('2026-10-08', 12, 15, 9.2)]);
  assert.equal(st.days, 3);
  assert.equal(st.avgMin, 13);
  assert.equal(st.avgMax, 19);
  assert.deepEqual(st.counts, { clear: 1, downpour: 1, rain: 1 });
  assert.equal(st.rain, 46);
  assert.equal(st.heatingDays, 1);
});

test('сводка месяца для шапки: дождливые / серые / пекло / плохой воздух', () => {
  const grey = { cloud: 95, sunHours: 0, aqiMax: 20, sunrise: '08:20', sunset: '20:00' };
  const smog = { cloud: 10, sunHours: 9, aqiMax: 75, sunrise: '08:20', sunset: '20:00' };
  const day = (date: string, tMax: number, rain: number, sky = SUN) =>
    summarizeDay({ date, totals: { tMin: 10, tMax, rain }, readings: [], isToday: false, sky });
  const b = monthBreakdown([
    day('2026-07-01', 36, 0), // пекло, солнце
    day('2026-07-02', 30, 4, grey), // дождливый (не серый, хоть и пасмурно)
    day('2026-07-03', 28, 0.6, grey), // покапало + пасмурно → серый
    day('2026-07-04', 34, 0, smog), // плохой воздух
  ]);
  assert.deepEqual({ ...b, tMax: Math.round(b.tMax!) }, { days: 4, tMax: 32, rainy: 1, grey: 1, heat: 1, badAir: 1 });
});

test('день архива по тем же порогам', () => {
  assert.equal(archiveDayKind(1.2, 100), 'rainy');
  assert.equal(archiveDayKind(0.5, 75), 'grey');
  assert.equal(archiveDayKind(0, 30), 'other');
});

test('карточка дня целиком', () => {
  const day = summarizeDay({
    date: '2026-10-13',
    totals: { tMin: 9, tMax: 13, rain: 18 },
    readings: [
      reading('2026-10-13T09:30', 4, 9.5, 9),
      reading('2026-10-13T14:10', 10, 12, 11.5),
      reading('2026-10-13T17:40', 14, 11, 10.5),
    ],
    isToday: false,
  });
  assert.equal(ru.precip(day.precip!), 'сильный дождь весь день');
  assert.equal(day.feel, 'dampCold');
  assert.equal(day.fog, true);
  assert.equal(day.heating, 'needed');
  assert.equal(day.kind, 'downpour');
  assert.deepEqual(day.issues, []);
});

test('данные с ошибками не участвуют в расчёте, но попадают в «данные под вопросом»', () => {
  const bad: Reading = {
    ...reading('2026-10-13T14:10', 0, 30, 10),
    issues: [{ level: 'error', field: 'humidity', message: 'влажность 150% вне допустимого 1…100%' }],
  };
  const odd: Reading = {
    ...reading('2026-10-13T09:30', 0, 9, 9.8),
    issues: [{ level: 'warn', field: 'dew', message: 'точка росы 9.8° выше температуры 9°' }],
  };
  const day = summarizeDay({
    date: '2026-10-13',
    totals: { tMin: 30, tMax: 10, rain: 0, issues: [{ level: 'error', field: 'tMin', message: 'минимум выше максимума' }] },
    readings: [odd, bad],
    isToday: false,
    log: [{ time: '2026-10-13T14:10', source: 'камера', level: 'warn', message: 'кадр камеры старый: 95 мин' }],
  });
  assert.equal(day.feel, undefined); // единственный дневной замер — с ошибкой
  assert.equal(day.fog, true); // предупреждение не мешает использовать утренний замер
  assert.equal(day.tMin, 0); // итоги дня с ошибкой отброшены — взяты из замера с предупреждением
  assert.equal(day.issues.length, 4);
  assert.match(day.issues.join('\n'), /влажность 150%/);
  assert.match(day.issues.join('\n'), /кадр камеры старый/);
});
