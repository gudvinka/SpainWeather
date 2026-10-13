import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { decodePage, parseUgr } from './ugr.ts';

// Настоящая страница станции, сохранённая 12.10.2026 в 17:13.
const fixture = path.join(import.meta.dirname, '..', '..', 'fixtures', 'ugr-index.htm');

test('разбор страницы UGR', async () => {
  const html = decodePage(await readFile(fixture));
  const r = parseUgr(html, new Date(2026, 9, 12, 17, 20));
  assert.deepEqual(r.values, {
    temp: 28.4,
    humidity: 24,
    dew: 5.9,
    rainToday: 0,
    rainMonth: 6,
    rainYear: 445.4,
    tMax: 28.7,
    tMin: 11.3,
  });
  assert.equal(r.stationTime.getHours(), 17);
  assert.equal(r.stationTime.getMinutes(), 13);
  assert.equal(r.stationTime.getDate(), 12);
});

test('около полуночи дата станции выбирается по ближайшему времени', async () => {
  const html = decodePage(await readFile(fixture)); // на странице 17:13
  assert.equal(parseUgr(html, new Date(2026, 9, 13, 0, 5)).stationTime.getDate(), 12); // компьютер уже 13-го
  assert.equal(parseUgr(html.replace('17:13', '00:02'), new Date(2026, 9, 12, 23, 58)).stationTime.getDate(), 13); // станция уже 13-го
});

test('поменялась вёрстка — понятная ошибка, а не мусор', () => {
  assert.throws(() => parseUgr('<html>Mantenimiento</html>', new Date()), /не найдено время обновления/);
  assert.throws(
    () => parseUgr('<p>17:13 (Hora local de actualización)</p><p>Temperatura 20 °C</p>', new Date(2026, 9, 12, 17, 20)),
    /не найдено поле «Temperatura máx\. y mín\.»/,
  );
});
