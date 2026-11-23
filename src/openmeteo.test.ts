import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOrder, visibleCloud } from './openmeteo.ts';

test('видимая облачность — без высоких тонких облаков, слои не складываются', () => {
  assert.equal(visibleCloud(10, 40), 40); // средние закрывают больше — берём их
  assert.equal(visibleCloud(80, 30), 80);
  assert.equal(visibleCloud(0, 0), 0); // только перистые сверху — небо ясное
});

test('ответ Open-Meteo не в том порядке — ошибка, данные не используются', () => {
  const oviedo = { lat: 43.36, lon: -5.85 };
  const granada = { lat: 37.18, lon: -3.59 };
  // Как отвечает Open-Meteo: точки сетки рядом с запрошенными.
  checkOrder([oviedo, granada], [
    { latitude: 43.36, longitude: -5.85 },
    { latitude: 37.20282, longitude: -3.5966372 },
  ]);
  assert.throws(
    () => checkOrder([oviedo, granada], [
      { latitude: 37.20282, longitude: -3.5966372 },
      { latitude: 43.36, longitude: -5.85 },
    ]),
    /ответ №1 не про то место/,
  );
  assert.throws(() => checkOrder([oviedo], [{} as never]), /не про то место/);
});
