import assert from 'node:assert/strict';
import test from 'node:test';
import { nameParts, nameProblems, pointerLevel, selectedReport, today } from '../../web/js/levelhub_model.mjs';

const body = { from_lv: 1, to_lv: 250, os: 'Android', geo: ['Tier1', 'Global'], why: 'update', designer: 'tester', date: '0511', version: 'v01' };

test('Level Hub name preview matches the nine server fields and Vietnam date', () => {
  assert.equal(nameParts('Sample', body).join('_'), 'Sample_A_1_250_Tier1-Global_update_tester_0511_v01');
  assert.equal(today(new Date('2026-11-04T18:00:00Z')), '0511');
  assert.equal(nameProblems('Sample', body).size, 0);
  for (const patch of [{ geo: [] }, { why: 'a_b' }, { designer: 'a@sonat.vn' }, { version: '' }, { date: '3213' }, { to_lv: 20001 }, { from_lv: 0 }]) {
    assert.ok(nameProblems('Sample', { ...body, ...patch }).size, JSON.stringify(patch));
  }
});

test('Level Hub selection counts real sparse level numbers and filters errors and warnings', () => {
  const report = { rows: [{ level: 2, difficulty: 0, preview: 'png' }, { level: 4, difficulty: 1 }, { level: 8, difficulty: 1 }],
    errors: [{ level: 8 }], warnings: [{ level: 4 }, { level: 8 }] };
  const r = selectedReport(report, 2, 4);
  assert.deepEqual(r.rows.map(x => x.level), [2, 4]);
  assert.deepEqual(r.missing, [3]);
  assert.equal(r.previewCount, 1);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.warnings, [{ level: 4 }]);
  assert.deepEqual([...r.groups], [[0, 1], [1, 1]]);
  assert.equal(pointerLevel(report.rows, -5, 300), 2);
  assert.equal(pointerLevel(report.rows, 200, 300), 8);
  assert.equal(pointerLevel(report.rows, 301, 300), 8);
  assert.equal(pointerLevel([], 0, 300), null);
});
