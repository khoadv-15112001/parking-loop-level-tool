// Luật port từ bản Unity (format.mjs, model.mjs, solver.mjs): giữ đúng kết luận của test Unity
// (Assets/_Game/Tests/EditMode/ParkingLevelDataTests.cs) trên raw thật trong game/tests/raw.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { convert } from '../web/format.mjs';
import { ParkingModel } from '../web/model.mjs';
import { checkLevel, replaySettled, settle } from '../web/solver.mjs';
import { blankLevel, levelChanges, levelSummary, setLevelNumber, thumbnail, validateLevel } from '../web/rules.mjs';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'raw');
const raw = n => JSON.parse(fs.readFileSync(path.join(RAW, `${n}.json`), 'utf8'));

test('converter: làn se[0] ở đáy, xe ẩn = chữ thường, y lớn = đầu cột bãi, tl mặc định 5', () => {
  const lv = convert({ li: 7, pf: { cp: 2, sd: [{ se: [{ c: 1 }, { c: 2 }] }, { p: { x: 1, y: 0 }, se: [{ c: 2 }, { c: 1, h: true }] }] }, ui: { u: [{ co: 1, p: { x: 0, y: 1 } }, { co: 2, p: { x: 0, y: 0 } }], c: [{}] } }).level;
  assert.equal(lv.loop, 5);
  assert.deepEqual(lv.grid, ['Yr', 'RY']);
  assert.deepEqual(lv.lot, ['RY']);
});

test('cn thiếu = không nối, cn (0,0) ghi rõ = nối', () => {
  const lv = convert({ pf: { cp: 1, sd: [{ se: [] }] }, ui: { u: [{ co: 1, p: { x: 0, y: 1 } }, { co: 1, p: { x: 0, y: 0 }, cn: { x: 0, y: 1 } }, { co: 2, p: { x: 1, y: 0 } }] } }).level;
  assert.equal(lv.lotUnits.filter(u => u.link >= 0).length, 2);
});

// Cùng danh sách LoopLevel_IsSolvable của Unity (raw có trong game/tests/raw).
for (const n of [1, 15, 30, 50, 70, 100, 151, 250, 300]) {
  test(`Level ${n} giải được và lời giải chạy lại thắng`, () => {
    const r = checkLevel(raw(n));
    assert.equal(r.verdict, 'Solvable', r.detail);
    assert.equal(replaySettled(convert(raw(n)).level, r.taps).state, 'won');
  });
}

test('level không thể: số xe một màu không chia hết chiều cao làn', () => {
  const r = checkLevel({ pf: { cp: 2, sd: [{ se: [] }, { p: { x: 1, y: 0 }, se: [] }] }, ui: { u: [{ co: 1, p: { x: 0, y: 2 } }, { co: 1, p: { x: 0, y: 1 } }, { co: 15, p: { x: 0, y: 0 } }] } });
  assert.equal(r.verdict, 'Impossible');
});

test('bị kẹt khi vòng đầy: báo thua', () => {
  // 1 làn cao 2 đang có G B; bãi chỉ có R R → không làn nào nhận R, vòng 1 chỗ.
  const lv = convert({ pf: { cp: 2, tl: 1, sd: [{ se: [{ c: 5 }, { c: 15 }] }] }, ui: { u: [{ co: 1, p: { x: 0, y: 1 } }, { co: 1, p: { x: 0, y: 0 } }] } }).level;
  const m = new ParkingModel(lv);
  const r = m.tap(m.buses.find(b => b.y === m.jh - 1).id);
  assert.equal(r.r, 'released');
  m.deliverAll(r);
  settle(m, 400);
  assert.equal(m.state, 'lost');
});

test('vòng ngược chiều kim đồng hồ, cổng ở trạm dưới W/2 (Unity 24/11/2026)', () => {
  const m = new ParkingModel(convert(raw(1)).level);
  assert.ok(m.W >= 2);
  assert.equal(m.topIndex(0), m.topIndex(1) + 1);   // hàng trên chạy phải → trái
  assert.equal(m.bottomIndex(1), m.bottomIndex(0) + 1);   // hàng dưới chạy trái → phải
  assert.equal(m.stations[m.entry].x, Math.floor(m.W / 2));
  assert.equal(m.stations[m.entry].y, -1);
});

test('clone độc lập với bản gốc', () => {
  const m = new ParkingModel(convert(raw(1)).level), c = m.clone();
  const r = c.tap(c.buses.find(b => b.y === c.jh - 1).id);
  c.deliverAll(r);
  assert.notEqual(m.key(), c.key());
  assert.equal(m.inTransit, 0);
});

test('hook phụ: summary, changes, số level, ảnh nhỏ', () => {
  const lv = raw(30);
  const sm = levelSummary(lv);
  assert.ok(sm.lanes > 0 && sm.cars > 0);
  assert.match(sm.mech, /Link/);
  const b = structuredClone(lv);
  b.pf.cp += 1;
  assert.ok(levelChanges(lv, b).some(s => s.startsWith('Chiều cao làn')));
  assert.equal(setLevelNumber(structuredClone(lv), 99).li, 99);
  assert.match(thumbnail(lv), /^<svg/);
  const blank = blankLevel(3);
  assert.equal(validateLevel(blank, { levelNo: 3 }).isValid, true);
  assert.equal(checkLevel(blank).verdict, 'Solvable');
});
