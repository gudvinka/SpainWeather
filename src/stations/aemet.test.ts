import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseDaily, parseHours, summarize, type AemetHour } from './aemet.ts';

// fixtures/aemet-1249X.json — сохранённый ответ AEMET по станции Овьедо: часы 12:00–24:00 (по Мадриду) 01.11.2026.
const fixture = async () => parseHours(JSON.parse(await readFile('fixtures/aemet-1249X.json', 'utf8')));
const lateEvening = new Date(2026, 10, 1, 23, 50);

// Час по местному времени: начало hour:00, в формате AEMET (конец часа, UTC).
const hourAt = (date: Date, hour: number, prec = 0, t = 10): AemetHour => {
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1);
  return { fint: end.toISOString().slice(0, 19) + '+0000', ta: t, tamin: t, tamax: t, hr: 90, tpr: 8, prec };
};

test('AEMET: последний час, мин/макс и дождь за сегодняшние часы', async () => {
  const r = summarize(await fixture(), [], lateEvening);
  assert.deepEqual(r.values, { temp: 8.7, humidity: 96, dew: 8.1, rainToday: 0, tMax: 15.9, tMin: 8.6 });
  assert.equal(r.stationTime.toISOString(), '2026-11-01T23:00:00.000Z');
});

test('AEMET: если часов с полуночи нет — пометка «сутки неполные»', async () => {
  const r = summarize(await fixture(), [], lateEvening);
  assert.equal(r.issues?.length, 1);
  assert.match(r.issues![0].message, /нет часов 00:00–12:00/);
});

test('AEMET: утренние часы из прошлых сборов склеиваются, дождь суммируется', async () => {
  const morning = Array.from({ length: 12 }, (_, h) => hourAt(lateEvening, h, h === 3 ? 1.2 : 0, 6 + h * 0.1));
  const r = summarize(await fixture(), morning, lateEvening);
  assert.equal(r.issues, undefined);
  assert.equal(r.values.rainToday, 1.2);
  assert.equal(r.values.tMin, 6);
  assert.equal(JSON.parse(r.raw).length, 24);
});

test('AEMET: дыра посреди суток тоже помечается', async () => {
  const r = summarize(await fixture(), [hourAt(lateEvening, 0), hourAt(lateEvening, 1)], lateEvening);
  assert.match(r.issues![0].message, /пропущены часы/);
});

test('AEMET: после полуночи вчерашние часы не считаются', async () => {
  const hours = await fixture();
  assert.throws(() => summarize([], [], lateEvening), /нет ни одного полного замера/);
  assert.throws(() => summarize(hours, [], new Date(2026, 10, 2, 0, 30)), /нет замеров за сегодня/);
});

test('AEMET: часы без нужных полей пропускаются', () => {
  const hours = parseHours([{ fint: '2026-11-01T12:00:00+0000', ta: 10 }, { idema: '1249X' }]);
  assert.equal(hours.length, 0);
  assert.throws(() => parseHours({ estado: 404 }), /не список/);
});

test('AEMET: итоги дней — числа с запятой, «Ip» = 0, дни без данных пропускаются', () => {
  const rows = [
    { fecha: '2026-10-28', tmax: '18,4', tmin: '11,5', prec: '0,0', sol: '6,6' },
    { fecha: '2026-10-29', tmax: '18,4', tmin: '9,9', prec: 'Ip' },
    { fecha: '2026-10-30', tmax: '17,0', tmin: '10,1', prec: 'Acum' },
  ];
  assert.deepEqual(parseDaily(rows, 'aemet-1249X'), {
    '2026-10-28': { tMax: 18.4, tMin: 11.5, rain: 0, sun: 6.6, source: 'aemet-1249X' },
    '2026-10-29': { tMax: 18.4, tMin: 9.9, rain: 0, source: 'aemet-1249X' },
  });
});
