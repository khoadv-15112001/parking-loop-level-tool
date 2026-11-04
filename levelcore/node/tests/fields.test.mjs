// Đường dẫn field của form thuộc tính (levelcore/web/js/fields.mjs): mảng hoặc chuỗi có dấu chấm, chỉ ghi đúng chỗ đó.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getPath, pathOf, setPath } from '../../web/js/fields.mjs';

test('path nhận mảng hoặc chuỗi có dấu chấm; chỉ số mảng thành số', () => {
  assert.deepEqual(pathOf('time'), ['time']);
  assert.deepEqual(pathOf('goals.0.count'), ['goals', 0, 'count']);
  assert.deepEqual(pathOf(['settings', 'time']), ['settings', 'time']);
  assert.deepEqual(pathOf(undefined), []);
});

test('ghi một field không đụng field khác, ô trống bỏ khoá', () => {
  const level = { time: 60, goals: [{ count: 3, color: 'red' }], extra: { keep: true } };
  setPath(level, 'goals.0.count', 5);
  setPath(level, ['time'], undefined);
  assert.deepEqual(level, { goals: [{ count: 5, color: 'red' }], extra: { keep: true } });
  assert.equal(getPath(level, 'goals.0.color'), 'red');
  setPath(level, 'settings.hard', true);
  assert.deepEqual(level.settings, { hard: true });
});
