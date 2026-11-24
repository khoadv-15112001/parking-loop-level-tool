// Thao tác xếp level của Editor (game/web/edit.mjs): kéo-thả xe, trộn màu, giữ nối xe và kiểu file gọn.
import assert from 'node:assert/strict';
import test from 'node:test';
import { colorCounts, lanesOf, lotOf, moveCar, shuffleColors } from '../web/edit.mjs';
import { convert } from '../web/format.mjs';

const level = () => ({
  li: 1,
  pf: { cp: 3, sd: [{ se: [{ c: 1 }, { c: 2, k: true }] }, { p: { x: 1, y: 0 }, se: [{ c: 3 }] }] },
  ui: {
    u: [
      { co: 1, p: { x: 0, y: 1 }, cn: { x: 1, y: 0 } }, { co: 2, p: { x: 0, y: 0 } },
      { co: 3, p: { x: 1, y: 0 } }, { co: 4, h: true, p: { x: 2, y: 0 }, l: true },
    ],
    c: [{}, { o: 1 }, { o: 2 }],
  },
});
const lanes = raw => lanesOf(raw).map(s => s.se.map(e => e.c));
const lot = raw => lotOf(raw).map(c => c.units.map(u => u.co));

test('kéo trong làn: thả lên xe khác thì đổi chỗ, vào ô trống thì lên đỉnh làn', () => {
  const raw = level();
  assert.equal(moveCar(raw, { kind: 'lane', x: 0, slot: 0 }, { kind: 'lane', x: 0, slot: 1 }), null);
  assert.deepEqual(lanes(raw), [[2, 1], [3]]);
  assert.equal(raw.pf.sd[0].se[0].k, true);   // chìa đi theo xe
  assert.equal(moveCar(raw, { kind: 'lane', x: 0, slot: 0 }, { kind: 'lane', x: 1, slot: 2 }), null);
  assert.deepEqual(lanes(raw), [[1], [3, 2]]);
});

test('kéo vào làn đầy bị từ chối, raw không đổi', () => {
  const raw = level();
  raw.pf.sd[1].se.push({ c: 5 }, { c: 6 });
  const before = JSON.stringify(raw);
  assert.equal(moveCar(raw, { kind: 'lane', x: 0, slot: 0 }, { kind: 'lane', x: 1, slot: 3 }), 'làn đã đầy');
  assert.equal(JSON.stringify(raw), before);
});

test('kéo trong bãi: đổi chỗ / dời sang cột khác, nối xe đi theo vị trí mới', () => {
  const raw = level();
  // xe (0,1) nối tới (1,0). Dời xe màu 3 ở cột 1 xuống cuối cột 0.
  assert.equal(moveCar(raw, { kind: 'lot', ci: 1, row: 0 }, { kind: 'lot', ci: 0, row: 5 }), null);
  assert.deepEqual(lot(raw), [[1, 2, 3], [4]]);
  const linked = raw.ui.u.find(u => u.co === 1), target = raw.ui.u.find(u => u.co === 3);
  assert.deepEqual(linked.cn, target.p);
  assert.deepEqual(target.p, { x: 0, y: 0 });
  assert.equal(raw.ui.c.length, 2);
  assert.ok(convert(raw).level);
});

test('kéo xe bãi lên làn và ngược lại: xe đổi loại, hộp khoá không rời bãi', () => {
  const raw = level();
  assert.equal(moveCar(raw, { kind: 'lot', ci: 0, row: 1 }, { kind: 'lane', x: 1, slot: 1 }), null);
  assert.deepEqual(lanes(raw), [[1, 2], [3, 2]]);
  assert.deepEqual(lot(raw), [[1], [3], [4]]);
  assert.equal(moveCar(raw, { kind: 'lane', x: 0, slot: 0 }, { kind: 'lot', ci: 3, row: 0 }), null);   // cột mới
  assert.deepEqual(lot(raw), [[1], [3], [4], [1]]);
  assert.match(moveCar(raw, { kind: 'lot', ci: 2, row: 0 }, { kind: 'lane', x: 0, slot: 2 }), /hộp khoá/);
  // thả xe làn lên xe bãi: đổi màu + ẩn, giữ chỗ
  assert.equal(moveCar(raw, { kind: 'lane', x: 1, slot: 0 }, { kind: 'lot', ci: 0, row: 0 }), null);
  assert.deepEqual(lanes(raw)[1], [1, 2]);
  assert.deepEqual(lot(raw)[0], [3]);
});

test('trộn màu giữ số xe mỗi màu, không đụng hộp khoá', () => {
  const raw = level(), before = colorCounts(raw);
  let k = 0;
  const n = shuffleColors(raw, () => [0.9, 0.1, 0.5, 0.3, 0.7][k++ % 5]);
  assert.equal(n, 6);
  assert.deepEqual([...colorCounts(raw)].sort(), [...before].sort());
  assert.equal(raw.ui.u[3].co, 4);
});
