import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFields } from './meteobuenavista.ts';

test('clientraw: обычный файл разбирается', () => {
  const { f } = parseFields('clientraw.txt', '12345 0.0 0.0 180 13.2 88\n', null);
  assert.equal(f[4], '13.2');
});

test('clientraw: пустой файл — понятная ошибка с датой последнего обновления', () => {
  const lm = new Date(2026, 9, 31, 3, 6).toUTCString();
  assert.throws(
    () => parseFields('clientraw.txt', '  \n', lm),
    /clientraw\.txt: станция отдала пустой файл, файл не обновлялся с 2026-10-31 03:06/,
  );
  assert.throws(() => parseFields('clientraw.txt', '', null), /станция отдала пустой файл$/);
});

test('clientraw: чужой формат — ошибка с началом файла', () => {
  assert.throws(() => parseFields('clientraw.txt', '<html>oops</html>', null), /не похоже на файл Weather Display \(начало: <html>/);
});
