// Hình học bàn chơi theo toạ độ thế giới của bản Unity: port View/ParkingLayout.cs (x sang phải, z lên trên màn hình,
// 1 đơn vị = 1 ô làn). Đường vòng là hình chữ nhật bo góc; mỗi trạm của model đặt vào điểm gần nhất trên đường (trạm trên /
// dưới nằm ngay trên làn của nó, hai cạnh bên giãn ra). Crossway: vòng là vòng GIỮA (đường trên, hai cạnh trên, đường giữa
// nằm giữa hai khối làn); đường vẽ là vòng ngoài quanh cả hai khối cộng đường giữa; đường dưới ngoài + cạnh phải dưới là
// đường nhánh (feederAt) vào giao lộ.
export const CELL = 1, LOOP_RADIUS = 0.9, JC_RATIO = 1.05, PARKING_GAP = 0.07;
/** Chỗ trống giữa đầu làn và đường (game: ô làn dài hơn xe; mũi tên vào làn, tấm rào, ô màu nằm ở đây). */
export const LANE_END_GAP_PLAIN = 0.45, LANE_END_GAP_CROSS = 0.1;
const LANE_MOUTH = 0;
const BAY_ORDER = [0, -1, 1];

/** Hình chữ nhật bo góc ngược chiều kim đồng hồ: trên sang trái, xuống bên trái, dưới sang phải, lên bên phải. */
function rect(segs, x0, x1, zT, zB) {
  const r = LOOP_RADIUS * CELL;
  const line = (px, pz, dx, dz, len) => segs.push({ arc: false, px, pz, dx, dz, len });
  const arc = (cx, cz, a0) => segs.push({ arc: true, cx, cz, a0, len: Math.PI * r / 2 });
  line(x1 - r, zT, -1, 0, x1 - x0 - 2 * r);
  arc(x0 + r, zT - r, Math.PI / 2);
  line(x0, zT - r, 0, -1, zT - zB - 2 * r);
  arc(x0 + r, zB + r, Math.PI);
  line(x0 + r, zB, 1, 0, x1 - x0 - 2 * r);
  arc(x1 - r, zB + r, -Math.PI / 2);
  line(x1, zB + r, 0, 1, zT - zB - 2 * r);
  arc(x1 - r, zT - r, 0);
  return segs.reduce((a, s) => a + s.len, 0);
}

function segAt(segs, P, d) {
  const r = LOOP_RADIUS * CELL;
  d = ((d % P) + P) % P;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i];
    if (d <= g.len || i === segs.length - 1) {
      if (!g.arc) return { x: g.px + g.dx * d, z: g.pz + g.dz * d, yaw: Math.atan2(g.dx, g.dz) };
      const th = g.a0 + d / r;
      return { x: g.cx + r * Math.cos(th), z: g.cz + r * Math.sin(th), yaw: Math.atan2(-Math.sin(th), Math.cos(th)) };
    }
    d -= g.len;
  }
  return { x: 0, z: 0, yaw: 0 };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Layout {
  constructor(m) {
    this.m = m;
    this.laneEndGap = m.cross ? LANE_END_GAP_CROSS : LANE_END_GAP_PLAIN;
    const hasLong = m.buses.some(b => b.len > 1);
    this.jc = CELL * JC_RATIO;
    this.laneW = this.jc * 0.78;
    this.bayH = CELL * (hasLong ? 1.9 : 1.0);
    this.roadBottomZ = (-1 - LANE_MOUTH) * CELL - this.laneEndGap;
    this.ringBottomZ = this.roadBottomZ - 0.5 * CELL;
    this.bayTopZ = this.ringBottomZ - 0.12;
    this.laneZ = this.bayTopZ - this.bayH - this.laneW / 2;
    this.lotTopZ = this.laneZ - this.laneW / 2 - 0.06;
    this.jamTopZ = this.lotTopZ - 0.24;
    this.gateX = (m.BW - 1) / 2;
    this.jamLeftX = this.gateX - m.jw * this.jc / 2;
    this.sideLX = this.jamLeftX - 0.24 - this.laneW / 2;
    this.sideRX = this.jamLeftX + m.jw * this.jc + 0.24 + this.laneW / 2;
    this.botZ = this.jamTopZ - m.jh * this.jc - 0.28 - this.laneW / 2;
    // Crossway: khối trên cao thêm 2 khoảng trống (mỗi bên đường giữa một khoảng).
    this.topBlockDz = m.cross ? 2 * this.laneEndGap : 0;
    const x0 = -1, x1 = m.BW, zT = m.BH + (this.topBlockDz + this.laneEndGap) / CELL;
    const zB = m.cross ? m.ringBottomY + this.laneEndGap / CELL : this.roadBottomZ / CELL;
    this.middleZ = zB * CELL; this.topZ = zT * CELL;
    this.segs = []; this.perimeter = rect(this.segs, x0, x1, zT, zB);
    this.outerSegs = []; this.outerPerimeter = rect(this.outerSegs, x0, x1, zT, this.roadBottomZ / CELL);
    this.spacing = this.perimeter / m.N;
    this.stationD = this.mapStations(zT, zB);
    // Giao lộ crossway (chân cạnh phải, chỗ đường nhánh lên): đoạn 6 của vòng là cạnh phải, bắt đầu ở đó.
    let dJ = 0;
    for (let k = 0; k < 6 && k < this.segs.length; k++) dJ += this.segs[k].len;
    while (dJ < this.stationD[0]) dJ += this.perimeter;
    this.junctionU = this.uOfDist(dJ);
  }

  get cross() { return this.m.cross; }

  /** Mỗi trạm của model vào điểm gần nhất trên đường; quãng đường tăng theo chỉ số (N+1 phần tử, cuối = đầu + chu vi). */
  mapStations(zT, zB) {
    const m = this.m, n = m.N, d = new Array(n + 1).fill(0), P = this.perimeter;
    const samples = Math.max(8, Math.ceil(P / 0.01)), pts = new Array(samples);
    for (let k = 0; k < samples; k++) pts[k] = this.pathAt(k * P / samples);
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const s = m.stations[i];
      let y = s.y;
      if (s.y <= m.ringBottomY) y = zB;
      else if (s.y >= m.BH) y = zT;
      else if (s.x < 0 || s.x >= m.BW) y = zB + (s.y - m.ringBottomY) * (zT - zB) / (m.BH - m.ringBottomY);
      const tx = s.x * CELL, tz = y * CELL;
      let best = 0, bd = Infinity;
      const from = prev < 0 ? 0 : prev, count = prev < 0 ? samples : Math.floor(samples / 2);
      for (let j = 0; j < count; j++) {
        const p = pts[(from + j) % samples], dd = (p.x - tx) ** 2 + (p.z - tz) ** 2;
        if (dd < bd) { bd = dd; best = from + j; }
      }
      d[i] = best * P / samples;
      prev = best;
    }
    for (let i = 1; i < n; i++) while (d[i] < d[i - 1]) d[i] += P;
    d[n] = d[0] + P;
    if (d[n] <= d[n - 1]) d[n] = d[n - 1] + this.spacing;
    return d;
  }

  // ---- làn (model laneCol / laneTopY: bàn thường = cột x, crossway = hai khối) ----
  /** x thế giới của làn x. */
  lx(x) { return this.m.laneCol[x] * CELL; }
  blockDz(x) { return this.m.cross && this.m.laneRow[x] === 1 ? this.topBlockDz : 0; }
  /** z tâm ô trên cùng / dưới cùng của làn. */
  lTop(x) { return this.m.laneTopY[x] * CELL + this.blockDz(x); }
  lBottom(x) { return this.m.laneBottomY(x) * CELL + this.blockDz(x); }
  /** z tâm ô thấp nhất của khối chứa làn (vạch chia làn chạy hết khối). */
  blockBottom(x) { return (this.m.laneTopY[x] - this.m.H + 1) * CELL + this.blockDz(x); }
  laneBottomEdgeZ(x) { return this.lBottom(x) - 0.5 * CELL; }
  /** Tâm khoảng trống giữa đầu trên / dưới của làn và đường. */
  topGapZ(x) { return this.lTop(x) + 0.5 * CELL + this.laneEndGap / 2; }
  bottomGapZ(x) { return this.lBottom(x) - 0.5 * CELL - this.laneEndGap / 2; }

  // ---- crossway: vòng ngoài / đường nhánh ----
  outerAt(d) { return segAt(this.outerSegs, this.outerPerimeter, d); }
  /** Chỗ đường nhánh gặp vòng: chân cạnh phải. */
  get junctionZ() { return this.middleZ + LOOP_RADIUS * CELL; }
  /** Vạch dừng của đường nhánh (z tâm xe chờ): mũi xe còn dưới đường giữa, không chạm xe vòng đang cua lên cạnh phải. */
  feederEndZ(len) { return this.middleZ - 0.55 * CELL - this.lotCarLength(len) / 2; }

  /** Đoạn dẫn khi đường nhánh bắt đầu ngoài đường (startZ): thẳng tới đường dưới rồi 1/4 cung rẽ sang phải. */
  feederLead(startZ) {
    if (startZ == null || Number.isNaN(startZ)) return { straight: 0, rr: 0, dir: 0 };
    const dz = startZ - this.roadBottomZ, rr = Math.min(0.6 * CELL, Math.abs(dz));
    return { straight: Math.abs(dz) - rr, rr, dir: dz < 0 ? 1 : -1 };
  }

  feederLength(fromX, len, startZ) {
    const r = LOOP_RADIUS * CELL, x1 = this.m.BW * CELL, { straight, rr } = this.feederLead(startZ);
    return straight + Math.PI * rr / 2 + Math.max(0, x1 - r - fromX - rr) + Math.PI * r / 2 + Math.max(0, this.feederEndZ(len) - (this.roadBottomZ + r));
  }

  /** Vị trí trên đường nhánh sau quãng d (kẹp ở vạch dừng). */
  feederAt(fromX, len, d, startZ) {
    const r = LOOP_RADIUS * CELL, x1 = this.m.BW * CELL;
    d = clamp(d, 0, this.feederLength(fromX, len, startZ));
    const { straight, rr, dir } = this.feederLead(startZ);
    if (rr > 0 || straight > 0) {
      if (d <= straight) return { x: fromX, z: startZ + dir * d, yaw: dir > 0 ? 0 : Math.PI };
      d -= straight;
      const leadArc = Math.PI * rr / 2;
      if (d <= leadArc && rr > 1e-4) {
        const a = d / rr, cx = fromX + rr, cz = this.roadBottomZ - dir * rr;
        return { x: cx - rr * Math.cos(a), z: cz + dir * rr * Math.sin(a), yaw: Math.atan2(Math.sin(a), dir * Math.cos(a)) };
      }
      d -= leadArc;
      fromX += rr;
    }
    const run = Math.max(0, x1 - r - fromX);
    if (d <= run) return { x: fromX + d, z: this.roadBottomZ, yaw: Math.PI / 2 };
    d -= run;
    const arc = Math.PI * r / 2;
    if (d <= arc) {
      const th = -Math.PI / 2 + d / r;
      return { x: x1 - r + r * Math.cos(th), z: this.roadBottomZ + r + r * Math.sin(th), yaw: Math.atan2(-Math.sin(th), Math.cos(th)) };
    }
    d -= arc;
    return { x: x1, z: this.roadBottomZ + r + d, yaw: 0 };
  }

  get directEntry() { return this.m.qcap === 0; }
  get lotLeftX() { return this.jamLeftX; }
  get lotRightX() { return this.jamLeftX + this.m.jw * this.jc; }
  get bayWidth() { return CELL * 0.98; }

  gp(gx, gy) { return { x: gx * CELL, z: gy * CELL }; }
  /** Tâm ô (x, y) của bãi; y = jh-1 là hàng đầu (sát đường). */
  jp(x, y) { return { x: this.jamLeftX + (x + 0.5) * this.jc, z: this.jamTopZ - (this.m.jh - 1 - y + 0.5) * this.jc }; }
  /** Tâm xe dài len đứng từ ô base của làn x (0 = đáy). */
  colCenter(x, base, len) {
    return { x: this.lx(x), z: this.lBottom(x) + (base + (len - 1) / 2) * CELL };
  }
  busCenter(b) {
    const a = this.jp(b.x, b.y), z = this.jp(b.x, b.y + (b.len - 1));
    return { x: (a.x + z.x) / 2, z: (a.z + z.z) / 2 };
  }
  lotCarLength(len) { return len * this.jc - this.jc * PARKING_GAP; }
  loopCarLength(len) { return (len - 1) * this.spacing + this.spacing * 0.8; }

  /** Vị trí + hướng (yaw, radian, 0 = +z) ở quãng đường d trên vòng (vòng giữa khi crossway). */
  pathAt(d) { return segAt(this.segs, this.perimeter, d); }

  get stations() { return this.m.N; }

  /** Quãng đường của vị trí u trên vòng (tăng đơn điệu: một vòng u = một chu vi), để đo khoảng cách theo đơn vị thế giới. */
  distOf(u) {
    const n = this.m.N, k = Math.floor(u / n), w = u - k * n, i = clamp(Math.floor(w), 0, n - 1);
    return k * this.perimeter + this.stationD[i] + (this.stationD[i + 1] - this.stationD[i]) * (w - i);
  }

  uOfDist(d) {
    const n = this.m.N, sd = this.stationD, k = Math.floor((d - sd[0]) / this.perimeter), r = d - k * this.perimeter;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sd[mid] <= r) lo = mid; else hi = mid; }
    const span = Math.max(1e-5, sd[lo + 1] - sd[lo]);
    return k * n + lo + clamp((r - sd[lo]) / span, 0, 1);
  }

  /** Vị trí trên vòng ở u (trạm; số lẻ là giữa hai trạm, giá trị bất kỳ quay vòng). */
  loopAt(u) {
    const n = this.m.N;
    let w = u % n; if (w < 0) w += n;
    const i = Math.min(Math.floor(w), n - 1), t = w - i;
    return this.pathAt(this.stationD[i] + (this.stationD[i + 1] - this.stationD[i]) * t);
  }

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
      const fit = this.bayFit, extra = Math.max(0, k - fit), dir = extra % 2 === 0 ? -1 : 1, slot = Math.floor(extra / 2);
      return { x: this.gateX + dir * this.bayWidth * (1.1 + slot), z: this.laneZ, yaw: dir < 0 ? Math.PI / 2 : -Math.PI / 2 };
    }
    if (k < 3) {
      const z = len > 1 ? Math.min(head - this.loopCarLength(len) / 2, this.bayTopZ - this.bayH / 2) : head - this.loopCarLength(1) / 2;
      return { x: this.gateX + BAY_ORDER[k] * this.bayWidth, z, yaw: 0 };
    }
    const j = k - 3, side = j % 2 === 1 ? 1 : -1, n = Math.floor(j / 2);
    return { x: this.gateX + side * this.bayWidth * (2.1 + n), z: this.laneZ, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  /** Số chỗ chờ trong cột ở cổng; xe sau đó chờ trong cột bãi của nó. */
  get bayFit() {
    if (!this.directEntry) return 3;
    const head = this.bayTopZ - 0.08, step = this.loopCarLength(1) + 0.12;
    let fit = 0;
    while (head - fit * step - this.loopCarLength(1) / 2 >= this.laneZ) fit++;
    return fit;
  }

  /** x chỗ xe bãi chờ tới lượt: chính cột của nó (bãi cột luôn đi thẳng lên). */
  waitX(b) { return this.busCenter(b).x; }

  /** Từ ô bãi tới chỗ chờ w (dưới làn ngang, không chắn xe đang ra cổng). */
  waitRoute(b, w) {
    const start = this.busCenter(b);
    return roundPoly(dedupe([start, { x: w.x, z: Math.max(w.z, start.z) }]));
  }

  /** Từ chỗ chờ lên làn ngang, dọc theo nó tới cột cổng rồi lên đích. */
  releaseRoute(from, dest) {
    return roundPoly(dedupe([from, { x: from.x, z: this.laneZ }, { x: dest.x, z: this.laneZ }, { x: dest.x, z: dest.z }]));
  }

  /** Đường xe chạy từ ô bãi tới chỗ chờ ở cổng (bãi cột: thẳng lên làn ngang, sang cổng, lên). */
  transitRoute(b, bay, at) {
    const start = this.busCenter(b), pose = at || this.bayPos(bay, b.len);
    const pts = [start, { x: start.x, z: this.laneZ }];
    if (bay < 3 || this.directEntry) { pts.push({ x: pose.x, z: this.laneZ }); pts.push({ x: pose.x, z: pose.z }); } else pts.push({ x: pose.x, z: pose.z });
    return roundPoly(dedupe(pts));
  }

  /** Khung cần thấy: vòng + `rows` hàng đầu của bãi (game: 2.8 hàng, phần còn lại khuất dưới mép màn hình). */
  boardBounds(rows = 0) {
    let low = this.botZ - this.laneW;
    if (rows > 0) low = this.jamTopZ - rows * this.jc;
    const left = Math.min(-1.5, this.lotLeftX - 0.45), right = Math.max(this.m.BW + 0.5, this.lotRightX + 0.45);
    return { x0: left, x1: right, z0: low, z1: this.topZ + 0.5 };
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
