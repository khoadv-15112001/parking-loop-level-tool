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

// ---- Crossway (pf.ic): hai khối làn, vòng giữa, đường nhánh (ParkingCrosswayTests.cs của Unity) ----
// Làn 0, 1 = khối dưới, 2, 3 = khối trên. Làn 0 (khối dưới, cột 0) đầy, trên cùng là G.
const cross = (loop, ...lot) => ({ grid: ['G...', 'Y...', 'RBBB'], loop, queue: 0, lot, lotUnits: [], locks: [], only: [], barriers: [], iceLanes: [], curtains: [], elevators: [], laneCars: [], heights: [], crossRow: [0, 0, 1, 1], crossCol: [0, 1, 0, 1] });
const tapDeliver = (m, id) => { const r = m.tap(id); assert.equal(r.r, 'released'); m.deliverAll(r); return r.car; };
const runUntil = (m, pred, n) => { const all = []; for (let i = 0; i < n; i++) { m.events = []; m.tick(); all.push(...m.events); if (pred(m.events)) break; } return all; };

test('crossway: converter chia làn thành hai khối, sâu 3', () => {
  const lv = convert(raw(200)).level;
  assert.equal(lv.grid.length, 3);
  assert.deepEqual(lv.crossRow, [0, 0, 1, 1]);
  assert.deepEqual(lv.crossCol, [0, 1, 0, 1]);
  const m = new ParkingModel(lv);
  assert.ok(m.cross);
  assert.equal(m.BW, 2);
});

test('crossway: khối trên nhận xe ở đường trên, khối dưới ở đường giữa; giao lộ ở cạnh phải', () => {
  const m = new ParkingModel(cross(5, 'G'));
  assert.equal(m.ringBottomY, m.H);
  const tops = new Map(m.stations.filter(s => s.top >= 0).map(s => [s.top, s]));
  assert.equal(tops.get(2).y, m.BH);
  assert.equal(tops.get(0).y, m.ringBottomY);
  assert.equal(m.stations[m.entry].x, m.BW);
  assert.equal(m.stations[m.entry].y, m.ringBottomY);
});

test('crossway: xe từ bãi đi đường nhánh rồi nhập ở giao lộ', () => {
  const m = new ParkingModel(cross(5, 'G'));
  const k = tapDeliver(m, 0);
  assert.equal(m.loop.length, 0);
  assert.equal(m.exits.length, 1);
  assert.ok(m.exits[0].feeder && m.exits[0].travel > 1);
  const ev = runUntil(m, e => e.some(o => o.t === 'merge' && o.id === k.id), 40);
  assert.ok(ev.some(o => o.t === 'merge' && o.id === k.id));
});

test('crossway: làn khối dưới đẩy xe ra đường nhánh, xe đó lên lại qua giao lộ', () => {
  const m = new ParkingModel(cross(5, 'G'));
  const bottom = m.cols[0][0].id;
  tapDeliver(m, 0);
  const ev = runUntil(m, e => e.some(o => o.t === 'insert' && o.col === 0), 80);
  assert.ok(ev.some(o => o.t === 'insert' && o.col === 0));
  const pushed = m.exits.find(c => c.id === bottom);
  assert.ok(pushed && pushed.feeder && pushed.exitCol === -1);
  runUntil(m, e => e.some(o => o.t === 'merge' && o.id === bottom), 40);
  assert.ok(m.loop.some(c => c.id === bottom));
});

test('Level 200 (crossway) giải được và lời giải chạy lại thắng', () => {
  const r = checkLevel(raw(200));
  assert.equal(r.verdict, 'Solvable', r.detail);
  assert.equal(replaySettled(convert(raw(200)).level, r.taps).state, 'won');
});
