import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_PLACES } from './cities.ts';

test('имена камер уникальны на весь сайт — по ним адрес таймлапса и имена файлов кадров', () => {
  const names = ALL_PLACES.flatMap((p) => p.cameras.map((c) => c.name));
  assert.deepEqual(names, [...new Set(names)]);
  for (const n of names) assert.match(n, /^[a-z0-9]+$/, `имя камеры «${n}» — только латиница и цифры`);
});

test('id городов и мест уникальны — это папки в site/', () => {
  const ids = ALL_PLACES.map((p) => p.id);
  assert.deepEqual(ids, [...new Set(ids)]);
});
