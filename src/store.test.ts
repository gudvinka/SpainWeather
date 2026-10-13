import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mergeDaily, readLog } from './store.ts';

test('испорченный daily.json не перезаписывается — история не теряется', async (t) => {
  const city = await mkdtemp(path.join(tmpdir(), 'spainweather-'));
  t.after(() => rm(city, { recursive: true, force: true }));
  const file = path.join(city, '2026-09', 'daily.json');
  await mkdir(path.dirname(file));
  const broken = '{ "2026-09-01": { "tMax": 24, "tMin": 15, "rain": 0 }, }'; // лишняя запятая
  await writeFile(file, broken, 'utf8');

  await assert.rejects(mergeDaily(city, { '2026-09-30': { tMax: 20, tMin: 12, rain: 1 } }), /файл испорчен/);
  assert.equal(await readFile(file, 'utf8'), broken);
});

test('журнал читается, даже если в начале BOM, а одна строка испорчена', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'spainweather-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(console, 'warn', () => {});

  const a = { time: '2026-10-12T17:22', source: 'камера', level: 'warn', message: 'кадр старый' };
  const b = { time: '2026-10-12T17:30', source: 'станция', level: 'error', message: 'недоступна' };
  await writeFile(path.join(dir, 'log.jsonl'), `\uFEFF${JSON.stringify(a)}\r\n{битая строка\n${JSON.stringify(b)}\n`, 'utf8');

  assert.deepEqual(await readLog(dir), [a, b]);
});
