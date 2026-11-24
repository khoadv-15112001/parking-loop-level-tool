// Phần hình của màn Chơi thử chạy được trong Node: layout.mjs (ParkingLayout.cs) và carview.mjs (CarView.cs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CarAnim } from '../web/carview.mjs';
import { convert } from '../web/format.mjs';
import { Layout, polyAt, polyLength } from '../web/layout.mjs';
import { ParkingModel } from '../web/model.mjs';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'raw');
const model = n => new ParkingModel(convert(JSON.parse(fs.readFileSync(path.join(RAW, `${n}.json`), 'utf8'))).level);

test('layout: đường vòng khép kín, xe cách đều perimeter / N, tâm trên đỉnh ở giữa hàng trên', () => {
  const m = model(70), L = new Layout(m);
  const a = L.pathAt(0), b = L.pathAt(L.perimeter);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6);
  assert.ok(Math.abs(L.spacing * m.N - L.perimeter) < 1e-9);
  const top = L.loopAt(L.sMid);
  assert.ok(Math.abs(top.x - (m.W - 1) / 2) < 1e-6 && Math.abs(top.z - m.H) < 1e-6);
  assert.ok(Math.abs(Math.abs(top.yaw) - Math.PI / 2) < 1e-6);   // hàng trên chạy ngang
  // bãi nằm dưới vòng, hàng đầu cao nhất
  const front = L.jp(0, m.jh - 1), back = L.jp(0, 0);
  assert.ok(front.z < -1 && back.z < front.z);
});

test('layout: đường từ bãi ra cổng đi lên rồi tới chỗ chờ dưới cổng', () => {
  const m = model(70), L = new Layout(m), b = m.buses.find(o => o.y === m.jh - 1);
  const pts = L.transitRoute(b, 0), end = polyAt(pts, polyLength(pts)), bay = L.bayPos(0, 1);
  assert.ok(Math.hypot(end.x - bay.x, end.z - bay.z) < 1e-6);
  assert.ok(Math.abs(bay.x - L.gateX) < 1e-6 && bay.z < -1);
});

test('CarAnim: chạy tới đích bằng leg có phanh rồi đỗ (squash khi dừng)', () => {
  const v = new CarAnim(1, { lengthWorld: 0.98 });
  v.setTarget({ x: 0, z: 0 }, 0); v.teleport();
  v.setTarget({ x: 2, z: 3 }, Math.PI / 2); v.maxSpeed = 8;
  let landed = false;
  v.onLanded = () => { landed = true; };
  for (let i = 0; i < 240; i++) v.step(1 / 60);
  assert.ok(Math.hypot(v.x - 2, v.z - 3) < 1e-3);
  assert.ok(landed);
});

test('CarAnim: trên vòng xe bám tim đường và không chạy lùi', () => {
  const m = model(70), L = new Layout(m), v = new CarAnim(1, { lengthWorld: 0.98 });
  const p0 = L.loopAt(3);
  v.setTarget(p0, p0.yaw); v.teleport();
  v.follow = true; v.maxSpeed = L.spacing / 0.128 * 2.2;
  let u = 3, prev = null;
  for (let i = 0; i < 120; i++) {
    u += (1 / 60) / 0.128;
    const p = L.bodyOnLoop(u, 1);
    v.setTarget(p, p.yaw); v.setLoop(L, u, 1); v.step(1 / 60);
    if (prev !== null) assert.ok(v.wrapU(v.carU - prev) >= -1e-9);
    prev = v.carU;
    const q = L.loopAt(v.carU);
    assert.ok(Math.hypot(q.x - v.x, q.z - v.z) < 1e-6);
  }
});
