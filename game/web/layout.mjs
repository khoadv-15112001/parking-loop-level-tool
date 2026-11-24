// Hình học bàn chơi theo toạ độ thế giới của bản Unity: port View/ParkingLayout.cs (x sang phải, z lên trên màn hình,
// 1 đơn vị = 1 ô làn). Đường vòng là hình chữ nhật bo góc qua tâm các trạm; xe trên vòng cách đều perimeter / N.
export const CELL = 1, LOOP_RADIUS = 0.9, JC_RATIO = 1.05, PARKING_GAP = 0.07;
const BAY_ORDER = [0, -1, 1];

export class Layout {
  constructor(m) {
    this.m = m;
    const hasLong = m.buses.some(b => b.len > 1);
    this.jc = CELL * JC_RATIO;
    this.laneW = this.jc * 0.78;
    this.bayH = CELL * (hasLong ? 1.9 : 1.0);
    this.ringBottomZ = -1.5 * CELL;
    this.bayTopZ = this.ringBottomZ - 0.12;
    this.laneZ = this.bayTopZ - this.bayH - this.laneW / 2;
    this.lotTopZ = this.laneZ - this.laneW / 2 - 0.06;
    this.jamTopZ = this.lotTopZ - 0.24;
    this.gateX = (m.W - 1) / 2;
    this.jamLeftX = this.gateX - m.jw * this.jc / 2;
    this.sideLX = this.jamLeftX - 0.24 - this.laneW / 2;
    this.sideRX = this.jamLeftX + m.jw * this.jc + 0.24 + this.laneW / 2;
    this.botZ = this.jamTopZ - m.jh * this.jc - 0.28 - this.laneW / 2;
    const r = LOOP_RADIUS * CELL, x0 = -1, x1 = m.W, zT = m.H, zB = -1;
    this.segs = [];
    const line = (px, pz, dx, dz, len) => this.segs.push({ arc: false, px, pz, dx, dz, len });
    const arc = (cx, cz, a0) => this.segs.push({ arc: true, cx, cz, a0, len: Math.PI * r / 2 });
    // Ngược chiều kim đồng hồ: trên sang trái, xuống bên trái, dưới sang phải, lên bên phải.
    line(x1 - r, zT, -1, 0, x1 - x0 - 2 * r);
    arc(x0 + r, zT - r, Math.PI / 2);
    line(x0, zT - r, 0, -1, zT - zB - 2 * r);
    arc(x0 + r, zB + r, Math.PI);
    line(x0 + r, zB, 1, 0, x1 - x0 - 2 * r);
    arc(x1 - r, zB + r, -Math.PI / 2);
    line(x1, zB + r, 0, 1, zT - zB - 2 * r);
    arc(x1 - r, zT - r, 0);
    this.perimeter = this.segs.reduce((a, s) => a + s.len, 0);
    this.spacing = this.perimeter / m.N;
    this.sMid = 1 + (m.W - 1) / 2;
    this.dMid = (x1 - r) - (m.W - 1) / 2;
  }

  get directEntry() { return this.m.qcap === 0; }
  get lotLeftX() { return this.jamLeftX; }
  get lotRightX() { return this.jamLeftX + this.m.jw * this.jc; }
  get bayWidth() { return CELL * 0.98; }

  gp(gx, gy) { return { x: gx * CELL, z: gy * CELL }; }
  /** Tâm ô (x, y) của bãi; y = jh-1 là hàng đầu (sát đường). */
  jp(x, y) { return { x: this.jamLeftX + (x + 0.5) * this.jc, z: this.jamTopZ - (this.m.jh - 1 - y + 0.5) * this.jc }; }
  colCenter(x, base, len) {
    const o = this.m.H - this.m.hs[x], a = this.gp(x, base + o), b = this.gp(x, base + o + len - 1);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  }
  busCenter(b) {
    const a = this.jp(b.x, b.y), z = this.jp(b.x, b.y + (b.len - 1));
    return { x: (a.x + z.x) / 2, z: (a.z + z.z) / 2 };
  }
  lotCarLength(len) { return len * this.jc - this.jc * PARKING_GAP; }
  loopCarLength(len) { return (len - 1) * this.spacing + this.spacing * 0.8; }

  /** Vị trí + hướng (yaw, radian, 0 = +z) ở quãng đường d trên đường vòng. */
  pathAt(d) {
    const r = LOOP_RADIUS * CELL, P = this.perimeter;
    d = ((d % P) + P) % P;
    for (let i = 0; i < this.segs.length; i++) {
      const g = this.segs[i];
      if (d <= g.len || i === this.segs.length - 1) {
        if (!g.arc) return { x: g.px + g.dx * d, z: g.pz + g.dz * d, yaw: Math.atan2(g.dx, g.dz) };
        const th = g.a0 + d / r;
        return { x: g.cx + r * Math.cos(th), z: g.cz + r * Math.sin(th), yaw: Math.atan2(-Math.sin(th), Math.cos(th)) };
      }
      d -= g.len;
    }
    return { x: 0, z: 0, yaw: 0 };
  }

  get stations() { return this.m.N; }
  loopAt(u) { return this.pathAt(this.dMid + (u - this.sMid) * this.spacing); }
  bodyOnLoop(uHead, len) {
    if (len <= 1) return this.loopAt(uHead);
    const h = this.loopAt(uHead), t = this.loopAt(uHead - (len - 1));
    let dx = h.x - t.x, dz = h.z - t.z;
    if (dx * dx + dz * dz < 1e-6) { dx = 0; dz = 1; }
    return { x: (h.x + t.x) / 2, z: (h.z + t.z) / 2, yaw: Math.atan2(dx, dz) };
  }

  /** Chỗ chờ ở cổng (hàng chờ queue). */
  bayPos(k, len) {
    const head = this.bayTopZ - 0.08;
    if (this.directEntry) {
      const step = this.loopCarLength(1) + 0.12;
      const z = head - k * step - this.loopCarLength(len) / 2;
      if (z >= this.laneZ) return { x: this.gateX, z, yaw: 0 };
      let fit = 0;
      while (head - fit * step - this.loopCarLength(1) / 2 >= this.laneZ) fit++;
      const extra = Math.max(0, k - fit), dir = extra % 2 === 0 ? -1 : 1, slot = Math.floor(extra / 2);
      return { x: this.gateX + dir * this.bayWidth * (1.1 + slot), z: this.laneZ, yaw: dir < 0 ? Math.PI / 2 : -Math.PI / 2 };
    }
    if (k < 3) {
      const z = len > 1 ? Math.min(head - this.loopCarLength(len) / 2, this.bayTopZ - this.bayH / 2) : head - this.loopCarLength(1) / 2;
      return { x: this.gateX + BAY_ORDER[k] * this.bayWidth, z, yaw: 0 };
    }
    const j = k - 3, side = j % 2 === 1 ? 1 : -1, n = Math.floor(j / 2);
    return { x: this.gateX + side * this.bayWidth * (2.1 + n), z: this.laneZ, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  /** Đường xe chạy từ ô bãi tới chỗ chờ ở cổng (bãi cột: thẳng lên làn ngang, sang cổng, lên). */
  transitRoute(b, bay) {
    const start = this.busCenter(b), pose = this.bayPos(bay, b.len);
    const pts = [start, { x: start.x, z: this.laneZ }];
    if (bay < 3 || this.directEntry) { pts.push({ x: pose.x, z: this.laneZ }); pts.push({ x: pose.x, z: pose.z }); } else pts.push({ x: pose.x, z: pose.z });
    return roundPoly(dedupe(pts));
  }

  /** Khung cần thấy: vòng + `rows` hàng đầu của bãi (game: 2.8 hàng, phần còn lại khuất dưới mép màn hình). */
  boardBounds(rows = 0) {
    let low = this.botZ - this.laneW;
    if (rows > 0) low = this.jamTopZ - rows * this.jc;
    const left = Math.min(-1.5, this.lotLeftX - 0.45), right = Math.max(this.m.W + 0.5, this.lotRightX + 0.45);
    return { x0: left, x1: right, z0: low, z1: this.m.H + 0.5 };
  }
}

function dedupe(p) {
  const r = [];
  for (const q of p) if (!r.length || (q.x - r[r.length - 1].x) ** 2 + (q.z - r[r.length - 1].z) ** 2 > 1e-4) r.push(q);
  return r;
}

/** Bo mọi góc của đường gấp khúc (game: xe rời bãi bằng một cua mượt). */
function roundPoly(p, radius = 0.45) {
  if (p.length < 3) return p;
  const r = [p[0]], dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const k = Math.min(radius, dist(a, b) / 2, dist(b, c) / 2);
    if (k < 0.02) { r.push(b); continue; }
    const la = dist(a, b), lc = dist(b, c);
    const s = { x: b.x + (a.x - b.x) / la * k, z: b.z + (a.z - b.z) / la * k }, e = { x: b.x + (c.x - b.x) / lc * k, z: b.z + (c.z - b.z) / lc * k };
    for (let j = 0; j <= 6; j++) {
      const u = j / 6;
      r.push({ x: (1 - u) ** 2 * s.x + 2 * u * (1 - u) * b.x + u * u * e.x, z: (1 - u) ** 2 * s.z + 2 * u * (1 - u) * b.z + u * u * e.z });
    }
  }
  r.push(p[p.length - 1]);
  return dedupe(r);
}

/** Điểm + hướng ở quãng đường d trên đường gấp khúc. */
export function polyAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= l || i === pts.length - 1) {
      const k = l > 0 ? Math.min(1, Math.max(0, d / l)) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: l > 0 ? Math.atan2(b.x - a.x, b.z - a.z) : 0 };
    }
    d -= l;
  }
  const e = pts[pts.length - 1];
  return { x: e.x, z: e.z, yaw: 0 };
}

export const polyLength = pts => { let t = 0; for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return t; };
