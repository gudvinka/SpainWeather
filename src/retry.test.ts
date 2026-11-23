import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorText, HttpError, withRetry } from './retry.ts';

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

test('errorText достаёт настоящую причину из fetch failed', () => {
  const dns = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.open-meteo.com'), { code: 'ENOTFOUND' }) });
  assert.equal(errorText(dns), 'fetch failed (getaddrinfo ENOTFOUND api.open-meteo.com)');
  const reset = new TypeError('fetch failed', { cause: Object.assign(new Error('read'), { code: 'ECONNRESET' }) });
  assert.equal(errorText(reset), 'fetch failed (ECONNRESET: read)');
  const many = new TypeError('fetch failed', {
    cause: Object.assign(new AggregateError([Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' })]), { code: 'ETIMEDOUT' }),
  });
  assert.equal(errorText(many), 'fetch failed (connect ETIMEDOUT 1.2.3.4:443)');
  assert.equal(errorText(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'нет ответа (тайм-аут)');
  assert.equal(errorText(new HttpError('AEMET', 429)), 'AEMET: HTTP 429');
});
