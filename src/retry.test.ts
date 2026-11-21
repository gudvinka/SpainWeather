import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError, withRetry } from './retry.ts';

const failing = (errors: Error[]) => {
  let calls = 0;
  const fn = async () => {
    calls++;
    const e = errors.shift();
    if (e) throw e;
    return 'ok';
  };
  return { fn, calls: () => calls };
};

test('429 и сбой сети — повторяем, пока не выйдет', async () => {
  const f = failing([new HttpError('AEMET', 429), new Error('fetch failed')]);
  assert.equal(await withRetry(f.fn, [0, 0]), 'ok');
  assert.equal(f.calls(), 3);
});

test('попытки кончились — ошибка последней попытки', async () => {
  const f = failing([new HttpError('AEMET', 429), new HttpError('AEMET', 429), new HttpError('AEMET', 503)]);
  await assert.rejects(withRetry(f.fn, [0, 0]), /HTTP 503/);
  assert.equal(f.calls(), 3);
});

test('неверный ключ (401) не повторяем', async () => {
  const f = failing([new HttpError('AEMET', 401)]);
  await assert.rejects(withRetry(f.fn, [0, 0]), /HTTP 401/);
  assert.equal(f.calls(), 1);
});
