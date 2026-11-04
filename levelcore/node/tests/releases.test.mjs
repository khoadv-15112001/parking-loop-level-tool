// Khung changelog (levelcore/web/js/releases.mjs): CHANGELOG.md của core đúng khung, entry sai bị chặn.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReleases, tagMessage } from '../../web/js/releases.mjs';
import { readReleases } from '../../tools/releases.mjs';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ok = { version: '1.0.4', date: '03/11/2026', title: 'Chơi thử và phân tích', notice: ['Slot dùng chung được tự tách.'], added: ['Chơi thử: nút Chơi lại.'], fixed: ['Chơi thử không còn báo thua khi cửa sổ mất focus.'], dev: ['Route `/api/play`.'] };

test('CHANGELOG.md của core đúng khung', () => {
  assert.deepEqual(checkReleases(readReleases(path.join(CORE, 'CHANGELOG.md')), { audience: 'dev' }), []);
});

test('entry đúng khung qua được; message của tag theo đúng thứ tự phần', () => {
  assert.deepEqual(checkReleases([ok]), []);
  assert.equal(tagMessage(ok), '1.0.4 · 03/11/2026 · Chơi thử và phân tích\n\nCần chú ý\n- Slot dùng chung được tự tách.\n\nMới\n- Chơi thử: nút Chơi lại.'
    + '\n\nSửa lỗi\n- Chơi thử không còn báo thua khi cửa sổ mất focus.\n\nCho Dev\n- Route `/api/play`.');
});

test('entry sai khung bị chặn', () => {
  const bad = (patch, re) => {
    const problems = checkReleases([{ ...ok, ...patch }]);
    assert.ok(problems.some(p => re.test(p)), `${JSON.stringify(patch).slice(0, 60)} → ${problems.join(' | ')}`);
  };
  bad({ title: 'x'.repeat(61) }, /title/);
  bad({ added: ['x'.repeat(121)] }, /dòng dài/);
  bad({ added: ['a', 'b', 'c', 'd', 'e', 'f'] }, /tối đa 5/);
  bad({ added: ['Sửa file store.mjs'] }, /Cho Dev/);
  bad({ added: ['Thêm biến FISHLEVEL_CI_TOKEN'] }, /Cho Dev/);
  bad({ date: '2026-11-03' }, /date/);
  bad({ extra: [] }, /trường lạ/);
  const reordered = { version: '1.0.5', date: '', title: 'Sai thứ tự', fixed: ['Một lỗi.'], added: ['Một việc.'] };
  assert.ok(checkReleases([reordered]).some(p => /thứ tự/.test(p)));
  assert.ok(checkReleases([ok, { ...ok, version: '1.0.3', date: '' }]).some(p => /date/.test(p)));
});
