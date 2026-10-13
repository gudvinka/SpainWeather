import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDayTotals, checkFrame, checkReading, checkSky, type StationValues } from './quality.ts';

const now = new Date(2026, 9, 12, 14, 0);
const ok: StationValues = { temp: 21, humidity: 70, dew: 15, rainToday: 0, rainMonth: 84, rainYear: 605, tMax: 23, tMin: 16 };
const levels = (issues: { level: string; field: string }[]) => issues.map((i) => `${i.level}:${i.field}`);

test('нормальный замер — без замечаний', () => {
  assert.deepEqual(checkReading(ok, { now, stationTime: now }), []);
});

test('невозможные значения — ошибки', () => {
  assert.deepEqual(levels(checkReading({ ...ok, humidity: 150 }, { now, stationTime: now })), ['error:humidity']);
  assert.deepEqual(levels(checkReading({ ...ok, temp: 80 }, { now, stationTime: now })), ['error:temp']);
  assert.deepEqual(levels(checkReading({ ...ok, rainToday: -1 }, { now, stationTime: now })), ['error:rainToday']);
  assert.deepEqual(levels(checkReading({ ...ok, temp: NaN }, { now, stationTime: now })), ['error:temp']);
  assert.deepEqual(levels(checkReading({ ...ok, tMin: 25, tMax: 20, temp: 22 }, { now, stationTime: now })), ['error:tMin']);
});

test('подозрительные значения — предупреждения', () => {
  assert.deepEqual(levels(checkReading({ ...ok, dew: 22 }, { now, stationTime: now })), ['warn:dew']);
  assert.deepEqual(levels(checkReading({ ...ok, temp: 26 }, { now, stationTime: now })), ['warn:temp']);
  assert.deepEqual(levels(checkReading({ ...ok, rainToday: 90 }, { now, stationTime: now })), ['warn:rainToday']);
  assert.deepEqual(levels(checkReading({ ...ok, rainMonth: 700 }, { now, stationTime: now })), ['warn:rainMonth']);

  const old = new Date(2026, 9, 12, 12, 30);
  assert.deepEqual(levels(checkReading(ok, { now, stationTime: old })), ['warn:stationTime']);

  // скачок за час — подозрительно; та же разница с утра до обеда — обычное потепление
  assert.deepEqual(levels(checkReading(ok, { now, stationTime: now, prev: { temp: 8, time: '2026-10-12T13:00' } })), [
    'warn:temp',
  ]);
  assert.deepEqual(checkReading(ok, { now, stationTime: now, prev: { temp: 8, time: '2026-10-12T09:30' } }), []);
});

test('итоги дня, небо, кадр', () => {
  assert.deepEqual(checkDayTotals({ tMax: 22, tMin: 16, rain: 37.2 }), []);
  assert.deepEqual(levels(checkDayTotals({ tMax: 12, tMin: 16, rain: 0 })), ['error:tMin']);
  assert.deepEqual(levels(checkDayTotals({ tMax: 22, tMin: 16, rain: 400 })), ['error:rain']);

  assert.deepEqual(checkSky({ cloud: 40, sunHours: 7, aqiMax: 30 }), []);
  assert.deepEqual(levels(checkSky({ cloud: 140, sunHours: 7 })), ['error:cloud']);
  assert.deepEqual(levels(checkSky({ cloud: 40, sunHours: 30, aqiMax: 900 })), ['error:sunHours', 'error:aqiMax']);

  assert.deepEqual(checkFrame({ bytes: 150_000, ageMs: 60_000 }), []);
  assert.deepEqual(levels(checkFrame({ bytes: 150_000, ageMs: 3 * 3600_000 })), ['warn:frame']);
  assert.deepEqual(levels(checkFrame({ bytes: 300 })), ['error:frame']);
});
