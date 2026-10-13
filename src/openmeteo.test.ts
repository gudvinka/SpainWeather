import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleCloud } from './openmeteo.ts';

test('видимая облачность — без высоких тонких облаков, слои не складываются', () => {
  assert.equal(visibleCloud(10, 40), 40); // средние закрывают больше — берём их
  assert.equal(visibleCloud(80, 30), 80);
  assert.equal(visibleCloud(0, 0), 0); // только перистые сверху — небо ясное
});
