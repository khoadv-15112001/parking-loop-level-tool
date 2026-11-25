// Mô phỏng một ván Parking Loop: port từ bản Unity Core/ParkingModel.cs (chỉ bãi cột — định dạng Level_*.json không có
// bãi mũi tên, tường, cổng, đèn). Input là ParkingLevel từ format.mjs convert(). JS thuần (server + trình duyệt).
// Sửa luật ở Unity thì chép lại ở đây; test game/tests/model.test.mjs giữ các level mẫu thắng được như test của Unity.

export const CLEAR_TICKS = 6;
const EMPTY = -1;
/** Xe chờ ở đầu làn tối đa bấy nhiêu tick rồi vào luôn. */
const DOCK_WAIT_MAX = 8;
/** Crossway: xe nhánh chờ ở giao lộ bấy nhiêu tick thì vòng nhường (game gốc: starvation escalation). */
const JUNCTION_WAIT_MAX = 5;

// held: xe vòng không chạy ở tick trước (nhường xe ra làn). dockWait / dockTicks: xe đứng ở đầu làn chờ xe nó đẩy ra vào được
// đường ngay. feeder / travel / travelTotal / feedFrom: crossway, xe trên đường nhánh (đường dưới ngoài + cạnh phải dưới) còn
// travel tick nữa mới tới giao lộ, xuất phát từ cột feedFrom của đường dưới.
const car = (o) => ({ id: 0, c: '', len: 1, st: 0, hidden: false, key: false, coc: '', exitCol: -1, held: false, dockWait: false, dockTicks: 0, feeder: false, travel: 0, travelTotal: 0, feedFrom: 0, ...o });
const cloneCar = k => ({ ...k });
const sumLen = a => { let n = 0; for (const k of a) n += k.len; return n; };

export class ParkingModel {
  constructor(lv) {
    if (!lv) return;
    this.H = lv.grid.length; this.W = lv.grid[0].length;
    const { W, H } = this;
    this.cap = lv.loop; this.qcap = lv.queue || 0;
    this.jw = lv.lot.length; this.jh = 1;
    for (const s of lv.lot) if (s.length > this.jh) this.jh = s.length;
    this.hs = Array.from({ length: W }, (_, x) => (lv.heights?.length === W ? lv.heights[x] : H));
    this.setupGeometry(lv);
    this.nextId = 0;
    this.cols = []; this.peak = [];
    for (let x = 0; x < W; x++) {
      const col = [];
      for (let y = H - this.hs[x]; y < H; y++) {
        const ch = lv.grid[H - 1 - y][x];
        if (ch !== '.') col.push(car({ id: this.nextId++, c: ch.toUpperCase(), hidden: ch !== ch.toUpperCase() }));
      }
      this.cols.push(col); this.peak.push(col.length);
    }
    this.buses = [];
    lv.lot.forEach((s, x) => {
      for (let k = 0; k < s.length; k++) {
        const ch = s[k];
        this.buses.push({
          id: this.buses.length, x, y: this.jh - 1 - k, len: 1, c: ch.toUpperCase(), hidden: ch !== ch.toUpperCase(),
          carId: this.nextId++, out: false, ice: 0, box: false, gen: false, inGen: -1, link: -1, coc: '', frontOrder: -1,
        });
      }
    });
    for (const u of lv.lotUnits || []) {
      const b = this.buses.find(o => o.x === u.col && o.y === this.jh - 1 - u.i);
      if (!b) continue;
      b.box = !!u.box; b.gen = !!u.gen && !u.box; b.link = u.link ?? -1; b.coc = (u.coc || '').toUpperCase();
      if (b.box || b.gen) b.hidden = false;
    }
    for (const g of this.buses.filter(o => o.gen)) for (const b of this.buses) if (b.x === g.x && b.y < g.y && b.inGen < 0 && !b.gen) b.inGen = g.id;
    for (const g of this.buses.filter(o => o.gen)) if (!this.buses.some(b => b.inGen === g.id)) g.out = true;
    this.occ = Array.from({ length: this.jw }, () => Array(this.jh).fill(EMPTY));
    for (const b of this.buses) if (!b.out && b.inGen < 0) this.occ[b.x][b.y] = b.id;

    this.locked = Array(W).fill(0); this.lockC = Array(W).fill(''); this.only = Array(W).fill('');
    for (const k of lv.locks || []) {
      if (k.color) { this.locked[k.col] = 1; this.lockC[k.col] = k.color.toUpperCase(); } else this.locked[k.col] = k.after;
    }
    for (const k of lv.only || []) this.only[k.col] = k.c.toUpperCase();
    this.ice = Array(W).fill(0); this.barrier = Array(W).fill(false); this.closed = Array(W).fill(false);
    for (const k of lv.iceLanes || []) if (k.col >= 0 && k.col < W) this.ice[k.col] = Math.max(0, k.n);
    for (const x of lv.barriers || []) if (x >= 0 && x < W) this.barrier[x] = true;
    this.curC = Array(W).fill(''); this.curN = Array(W).fill(0);
    for (const k of lv.curtains || []) if (k.col >= 0 && k.col < W && k.n > 0 && k.c) { this.curC[k.col] = k.c.toUpperCase(); this.curN[k.col] = k.n; }
    for (const k of lv.laneCars || []) {
      if (k.col < 0 || k.col >= W || k.i < 0 || k.i >= this.cols[k.col].length) continue;
      const c = this.cols[k.col][k.i];
      c.key = !!k.key; c.coc = (k.coc || '').toUpperCase();
    }
    this.elvGroup = Array(W).fill(-1); this.elvWait = Array(W).fill(false); this.elvLevels = Array.from({ length: W }, () => []);
    for (const e of lv.elevators || []) {
      if (e.col < 0 || e.col >= W) continue;
      this.elvGroup[e.col] = e.group;
      for (const s of e.levels || []) {
        const cars = [];
        for (const ch of s || '') if (ch !== '.' && cars.length < this.hs[e.col]) cars.push(car({ id: this.nextId++, c: ch.toUpperCase(), hidden: ch !== ch.toUpperCase() }));
        this.elvLevels[e.col].push(cars);
      }
    }
    for (const g of new Set(this.elvGroup.filter(g => g >= 0))) {
      let n = 0;
      for (let x = 0; x < W; x++) if (this.elvGroup[x] === g) n = Math.max(n, this.elvLevels[x].length);
      for (let x = 0; x < W; x++) if (this.elvGroup[x] === g) while (this.elvLevels[x].length < n) this.elvLevels[x].push([]);
    }
    for (let x = 0; x < W; x++) if (this.covered(x)) for (const k of this.cols[x]) k.hidden = true;

    this.stackedKeys = 0; this.frontCounter = 0; this.clears = 0;
    this.clr = Array(W).fill(0);
    this.loop = []; this.queue = []; this.exits = [];
    this.transit = 0; this.inTransit = 0;
    this.state = 'play'; this.events = []; this.ticks = 0; this.idleTicks = 0; this.revives = 0;
    this.buildStations();
    this.reveal();
    this.updateBoxes();
    this.events = [];
  }

  // ---------- hình học bàn (đơn vị ô). Bàn thường: làn x ở cột x, đầu làn dưới đường trên (y = H), đường dưới của vòng
  // y = -1. Crossway (pf.ic, docs/reference-crossway.md của repo Unity): hai khối làn sâu 3; vòng là vòng GIỮA (đường trên,
  // hai cạnh trên, đường giữa y = ringBottomY); đường dưới ngoài + cạnh phải dưới là đường nhánh một chiều vào vòng ở giao
  // lộ (entry): xe từ bãi và xe bị đẩy khỏi khối dưới đi nhánh này (exits có feeder = true, travel tick) rồi mới nhập. ----------
  setupGeometry(lv) {
    const { W, H } = this;
    this.laneCol = Array(W).fill(0); this.laneTopY = Array(W).fill(0); this.laneRow = Array(W).fill(1);
    this.cross = lv.crossRow?.length === W && lv.crossCol?.length === W;
    if (!this.cross) {
      this.BW = W; this.BH = H; this.ringBottomY = -1;
      for (let x = 0; x < W; x++) { this.laneCol[x] = x; this.laneTopY[x] = H - 1; }
      return;
    }
    // Khối dưới y 0..H-1, đường giữa y = H, khối trên H+1..2H, đường trên 2H+1.
    this.BW = 1;
    for (let x = 0; x < W; x++) this.BW = Math.max(this.BW, lv.crossCol[x] + 1);
    this.ringBottomY = H; this.BH = 2 * H + 1;
    for (let x = 0; x < W; x++) {
      this.laneRow[x] = lv.crossRow[x] > 0 ? 1 : 0;
      this.laneCol[x] = lv.crossCol[x];
      this.laneTopY[x] = this.laneRow[x] === 1 ? 2 * H : H - 1;
    }
  }

  laneBottomY(x) { return this.laneTopY[x] - this.hs[x] + 1; }
  /** Crossway, làn khối dưới: xe bị đẩy ra đi đường nhánh, không vào thẳng vòng. */
  feedsOut(x) { return this.cross && this.laneRow[x] === 0; }
  /** Khoảng cách trên bàn giữa hai làn (số cột, cộng một bề rộng bàn nếu khác hàng crossway). */
  laneDist(a, b) { return Math.abs(this.laneCol[a] - this.laneCol[b]) + (this.laneRow[a] !== this.laneRow[b] ? this.BW : 0); }
  laneAt(row, col) {
    for (let x = 0; x < this.W; x++) if (this.laneRow[x] === row && this.laneCol[x] === col) return x;
    return -1;
  }
  /** Crossway: số tick đi đường nhánh từ đường dưới ở cột fromCol tới giao lộ (≈ độ dài đường vẽ tính theo trạm). */
  feederTicks(fromCol) { return Math.max(1, Math.ceil(this.BW - fromCol + (this.ringBottomY + 1) - 0.5)); }
  /** Trạm mà xe bị đẩy khỏi làn x nhập vòng (bàn thường / khối trên crossway). */
  exitStation(x) { return this.bottomIndex(this.laneCol[x]) - 1; }

  // ---------- trạm trên vòng, ngược chiều kim đồng hồ: trên (phải → trái), xuống bên trái, dưới (trái → phải) qua cổng,
  // lên bên phải ----------
  buildStations() {
    if (this.cross) { this.buildCrossStations(); return; }
    const { W, H } = this, s = [];
    const st = (x, y, top = -1, bottom = -1) => ({ x, y, top, bottom });
    s.push(st(W, H));
    for (let x = W - 1; x >= 0; x--) s.push(st(x, H, x));
    s.push(st(-1, H));
    for (let y = H - 1; y >= 0; y--) s.push(st(-1, y));
    s.push(st(-1, -1));
    this.bottomStart = s.length;
    for (let x = 0; x < W; x++) s.push(st(x, -1, -1, x));
    s.push(st(W, -1));
    for (let y = 0; y < H; y++) s.push(st(W, y));
    this.stations = s; this.N = s.length;
    this.entry = this.bottomIndex(Math.floor(W / 2));   // trạm dưới đầu tiên ở / bên phải cổng
  }

  /** Vòng giữa, ngược chiều kim đồng hồ: đường trên (nhận khối trên), xuống cạnh trái, đường giữa trái → phải (nhận khối
   * dưới; xe bị đẩy khỏi khối trên ra đây), giao lộ (entry: đường nhánh nhập ở đây), lên cạnh phải. */
  buildCrossStations() {
    const { BW, BH, ringBottomY } = this, s = [];
    const st = (x, y, top = -1, bottom = -1) => ({ x, y, top, bottom });
    s.push(st(BW, BH));
    for (let x = BW - 1; x >= 0; x--) s.push(st(x, BH, this.laneAt(1, x)));
    s.push(st(-1, BH));
    for (let y = BH - 1; y > ringBottomY; y--) s.push(st(-1, y));
    s.push(st(-1, ringBottomY));
    this.bottomStart = s.length;
    for (let x = 0; x < BW; x++) s.push(st(x, ringBottomY, this.laneAt(0, x), x));
    this.entry = s.length;
    s.push(st(BW, ringBottomY));
    for (let y = ringBottomY + 1; y < BH; y++) s.push(st(BW, y));
    this.stations = s; this.N = s.length;
  }

  bottomIndex(x) { return this.bottomStart + x; }
  topIndex(x) { return 1 + (this.W - 1 - x); }

  clone() {
    const m = Object.create(ParkingModel.prototype);
    Object.assign(m, this);
    m.hs = this.hs; m.stations = this.stations; m.only = this.only; m.lockC = this.lockC; m.barrier = this.barrier;
    m.curC = this.curC; m.elvGroup = this.elvGroup;
    m.laneCol = this.laneCol; m.laneTopY = this.laneTopY; m.laneRow = this.laneRow;
    m.cols = this.cols.map(c => c.map(cloneCar));
    m.buses = this.buses.map(b => ({ ...b }));
    m.occ = this.occ.map(c => c.slice());
    m.loop = this.loop.map(cloneCar); m.queue = this.queue.map(cloneCar); m.exits = this.exits.map(cloneCar);
    m.locked = this.locked.slice(); m.ice = this.ice.slice(); m.closed = this.closed.slice(); m.curN = this.curN.slice();
    m.elvWait = this.elvWait.slice(); m.elvLevels = this.elvLevels.map(ls => ls.map(l => l.map(cloneCar)));
    m.clr = this.clr.slice(); m.peak = this.peak.slice();
    m.events = [];
    return m;
  }

  colCells(x) { return sumLen(this.cols[x]); }
  loopCells() { return sumLen(this.loop) + sumLen(this.exits); }
  queueCells() { return sumLen(this.queue); }

  carsLeft() {
    let n = this.loop.length + this.exits.length + this.queue.length + this.inTransit;
    for (const c of this.cols) n += c.length;
    for (const b of this.buses) if (!b.out && !b.box && !b.gen) n++;
    for (const ls of this.elvLevels) for (const l of ls) n += l.length;
    return n;
  }

  hasRoom(len) { return this.loopCells() + this.queueCells() + this.transit + Math.max(1, len) <= this.cap + this.qcap; }

  /** Làn bị che (khoá màu, băng, rào đã đóng, rèm, thang máy chờ): không nhận xe, không so màu, không xoá. */
  covered(x) { return this.locked[x] > 0 || this.ice[x] > 0 || this.closed[x] || this.curN[x] > 0 || this.elvWait[x]; }

  accepts(x, k) {
    if (k.len > this.hs[x] || this.covered(x) || this.clr[x] > 0) return false;
    if (this.only[x]) return k.c === this.only[x];
    const col = this.cols[x];
    if (col.length > 0) return col[col.length - 1].c === k.c;
    for (let i = 0; i < this.W; i++) {
      if (i === x) continue;
      if (this.only[i] === k.c && !this.closed[i]) return false;
      const o = this.cols[i];
      if (!this.only[i] && o.length > 0 && !this.covered(i) && o[o.length - 1].c === k.c) return false;
    }
    return true;
  }

  /** Xe ở bãi ra được không: mọi ô phía trước (y lớn hơn) trong cột phải trống. */
  probe(id) {
    const b = this.buses[id];
    for (let y = b.y + 1, steps = 0; y < this.jh; y++, steps++) {
      const o = this.occ[b.x][y];
      if (o !== EMPTY) return { r: 'blocked', travel: steps, blocker: o, atX: b.x, atY: y };
    }
    return { r: 'ok', travel: this.jh - 1 - b.y, blocker: -1 };
  }
  probeOk(id) { return this.probe(id).r === 'ok'; }

  reveal() {
    for (const b of this.buses) if (!b.out && b.inGen < 0 && b.hidden && this.probeOk(b.id)) { b.hidden = false; this.events.push({ t: 'reveal', bus: b.id }); }
  }

  compactLotColumn(x) {
    if (x < 0 || x >= this.jw) return;
    let moved = false;
    for (let pass = 0; pass < this.jh + 2; pass++) {
      let write = this.jh - 1, step = false;
      for (let y = this.jh - 1; y >= 0; y--) {
        const o = this.occ[x][y];
        if (o < 0) continue;
        if (this.buses[o].gen) { write = y - 1; continue; }
        if (y !== write) {
          this.occ[x][y] = EMPTY; this.occ[x][write] = o; this.buses[o].y = write;
          moved = step = true;
        }
        write--;
      }
      if (!this.emitFromGenerators(x) && !step) break;
    }
    if (moved) this.events.push({ t: 'shift', col: x });
    this.updateBoxes();
  }

  emitFromGenerators(x) {
    let any = false;
    for (const g of this.buses) {
      if (!g.gen || g.out || g.x !== x) continue;
      let next = null;
      for (const b of this.buses) if (b.inGen === g.id && (!next || b.y > next.y)) next = b;
      if (!next) {
        g.out = true; this.occ[g.x][g.y] = EMPTY;
        this.events.push({ t: 'genEnd', bus: g.id });
        any = true;
        continue;
      }
      const fy = g.y + 1;
      if (fy >= this.jh || this.occ[x][fy] !== EMPTY) continue;
      next.inGen = -1; next.x = x; next.y = fy;
      this.occ[x][fy] = next.id;
      this.events.push({ t: 'emit', bus: next.id, i: g.id, left: this.generatorLeft(g.id) });
      any = true;
    }
    return any;
  }

  generatorLeft(genId) { let n = 0; for (const b of this.buses) if (b.inGen === genId) n++; return n; }

  updateBoxes() {
    for (let x = 0; x < this.jw; x++) {
      for (let y = this.jh - 1; y >= 0; y--) {
        const o = this.occ[x][y];
        if (o < 0) continue;
        const b = this.buses[o];
        if (b.box && b.frontOrder < 0 && this.probeOk(o)) b.frontOrder = this.frontCounter++;
        break;
      }
    }
    while (this.stackedKeys > 0) {
      const b = this.nextBox();
      if (!b) break;
      this.stackedKeys--;
      this.openBox(b);
    }
  }

  nextBox() {
    let best = null;
    for (const b of this.buses) if (b.box && !b.out && b.frontOrder >= 0 && (!best || b.frontOrder < best.frontOrder)) best = b;
    return best;
  }

  openNextBox() { const b = this.nextBox(); if (!b) return false; this.openBox(b); return true; }

  openBox(b) {
    b.out = true; this.occ[b.x][b.y] = EMPTY;
    this.events.push({ t: 'unbox', bus: b.id });
    this.compactLotColumn(b.x);
    this.reveal();
  }

  leaveLane(k, x) {
    if (k.key) {
      k.key = false;
      this.events.push({ t: 'key', id: k.id, col: x });
      if (!this.openNextBox()) this.stackedKeys++;
    }
    if (k.coc) { const c = k.coc; k.coc = ''; this.dropObject(c, x); }
  }

  dropObject(c, fromCol) {
    let best = -1;
    for (let x = 0; x < this.W; x++) if (this.curC[x] === c && this.curN[x] > 0 && (best < 0 || this.laneDist(x, fromCol) < this.laneDist(best, fromCol))) best = x;
    if (best < 0) { this.events.push({ t: 'objLost', c, col: fromCol }); return; }
    this.curN[best]--;
    this.events.push({ t: 'curtain', col: best, c, left: this.curN[best] });
    if (this.curN[best] === 0 && !this.covered(best)) this.uncovered(best);
  }

  uncovered(x) {
    this.revealLane(x);
    this.peak[x] = this.cols[x].length;
    if (this.uniformFull(x)) this.checkClear(x);
  }

  release(id) {
    const b = this.buses[id];
    this.occ[b.x][b.y] = EMPTY;
    b.out = true; b.hidden = false; b.ice = 0;
    this.inTransit++; this.transit += b.len;
    this.idleTicks = 0;
    this.compactLotColumn(b.x);
    this.reveal();
    if (b.coc) { const oc = b.coc; b.coc = ''; this.dropObject(oc, Math.floor((this.W - 1) / 2)); }
    return car({ id: b.carId, c: b.c, len: b.len });
  }

  tap(id) {
    if (this.state !== 'play' || id < 0 || id >= this.buses.length || this.buses[id].out) return { r: 'ignored', blocker: -1 };
    const b = this.buses[id];
    if (b.box || b.gen || b.inGen >= 0) return { r: 'locked', blocker: -1 };
    if (b.link >= 0) return this.tapGroup(id);
    if (!this.hasRoom(b.len)) return { r: 'noroom', blocker: -1 };
    const p = this.probe(id);
    if (p.r !== 'ok') return p;
    return { r: 'released', travel: p.travel, blocker: -1, car: this.release(id), bus: id };
  }

  groupOf(id) {
    const res = [id], link = this.buses[id].link;
    if (link < 0) return res;
    for (const o of this.buses) if (o.id !== id && o.link === link && !o.out) res.push(o.id);
    return res;
  }

  tapGroup(id) {
    const group = this.groupOf(id);
    let len = 0;
    for (const g of group) {
      const o = this.buses[g];
      if (o.box || o.gen || o.inGen >= 0) return { r: 'locked', blocker: -1 };
      len += o.len;
    }
    const first = this.probe(id);
    if (first.r !== 'ok') return first;
    const byCol = new Map();
    for (const g of group) { const o = this.buses[g]; if (!byCol.has(o.x)) byCol.set(o.x, []); byCol.get(o.x).push(o); }
    for (const list of byCol.values()) {
      const ordered = list.slice().sort((a, b) => b.y - a.y);
      const p = this.probe(ordered[0].id);
      if (p.r !== 'ok') return { ...p, r: 'linked' };
      for (let k = 1; k < ordered.length; k++) if (ordered[k].y !== ordered[k - 1].y - 1) return { r: 'linked', blocker: -1, atX: ordered[k].x, atY: ordered[k].y };
    }
    if (!this.hasRoom(len)) return { r: 'noroom', blocker: -1 };
    const order = group.map(g => this.buses[g]).sort((a, b) => b.y - a.y).map(o => o.id);
    const res = { r: 'released', travel: first.travel, blocker: -1, bus: id, extra: [], extraBus: [] };
    for (const g of order) {
      const k = this.release(g);
      if (g === id) res.car = k; else { res.extra.push(k); res.extraBus.push(g); }
    }
    return res;
  }

  deliverAll(r) {
    if (r.car) this.deliver(r.car);
    if (r.extra) for (const k of r.extra) this.deliver(k);
  }

  deliver(k) {
    if (!k || this.inTransit <= 0) return;
    this.inTransit--; this.transit -= k.len;
    this.queue.push(car({ id: k.id, c: k.c, len: k.len }));
    this.idleTicks = 0;
    this.tryEnter();
    this.evaluate();
  }

  covers(st, len, s) { const d = (((st - s) % this.N) + this.N) % this.N; return d < len; }

  stationsFree(head, len) {
    for (const o of this.loop) for (let k = 0; k < len; k++) if (this.covers(o.st, o.len, (head - k + this.N) % this.N)) return false;
    return true;
  }

  // Xe vào vòng cần một trạm trống phía trước và một phía sau: xe không chạy dính đuôi nhau.
  canEnter(len) { return this.loopCells() + len <= this.cap && (this.cross || this.stationsFree((this.entry + 1) % this.N, len + 2)); }

  tryEnter() {
    if (!this.queue.length) return false;
    const k = this.queue[0];
    if (!this.canEnter(k.len)) return false;
    this.queue.shift();
    if (this.cross) {
      // Crossway: xe từ bãi đi đường dưới ngoài và cạnh phải dưới tới giao lộ trước.
      const gate = (this.BW - 1) / 2, t = this.feederTicks(gate);
      this.exits.push(car({ id: k.id, c: k.c, len: k.len, st: this.entry, feeder: true, travel: t, travelTotal: t, feedFrom: gate }));
    } else this.loop.push(car({ id: k.id, c: k.c, len: k.len, st: this.entry }));
    this.events.push({ t: 'enter', id: k.id });
    return true;
  }

  /** Crossway: xe bị đẩy khỏi làn khối dưới đi đường nhánh (không vào vòng) tới giao lộ. */
  feed(k, x) {
    const t = this.feederTicks(this.laneCol[x]);
    return car({ id: k.id, c: k.c, len: k.len, st: this.entry, feeder: true, travel: t, travelTotal: t, feedFrom: this.laneCol[x] });
  }

  uniformFull(x) {
    const col = this.cols[x];
    if (!col.length || sumLen(col) !== this.hs[x]) return false;
    return col.every(k => k.c === col[0].c);
  }

  revealLane(x) {
    for (const k of this.cols[x]) if (k.hidden) { k.hidden = false; this.events.push({ t: 'revealCar', id: k.id, col: x, c: k.c }); }
  }

  checkClear(x) {
    const col = this.cols[x];
    if (this.covered(x) || !col.length || sumLen(col) !== this.hs[x]) return false;
    const c = col[0].c;
    if (!col.every(k => k.c === c)) return false;
    this.events.push({ t: 'clear', col: x, c, ids: col.map(k => k.id) });
    const leaving = col;
    this.cols[x] = [];
    this.peak[x] = 0;
    this.clears++;
    this.clr[x] = CLEAR_TICKS;
    if (this.elvGroup[x] >= 0 && this.elvLevels[x].length > 0) { this.elvWait[x] = true; this.events.push({ t: 'elvWait', col: x }); }
    else if (this.barrier[x] && !this.closed[x]) { this.closed[x] = true; this.events.push({ t: 'barrier', col: x }); }
    const opened = [];
    for (let lx = 0; lx < this.W; lx++) {
      if (lx === x || this.ice[lx] <= 0) continue;
      this.ice[lx]--;
      this.events.push({ t: 'thaw', col: lx, left: this.ice[lx] });
      if (this.ice[lx] === 0 && !this.covered(lx)) opened.push(lx);
    }
    for (let lx = 0; lx < this.W; lx++) {
      if (!(this.locked[lx] > 0)) continue;
      if (this.lockC[lx]) { if (this.lockC[lx] === c) this.locked[lx] = 0; } else this.locked[lx]--;
      if (this.locked[lx] === 0) {
        this.events.push({ t: 'unlock', col: lx });
        if (!this.covered(lx) && !opened.includes(lx)) opened.push(lx);
      }
    }
    for (const lx of opened) if (!this.covered(lx)) this.uncovered(lx);
    for (const k of leaving) this.leaveLane(k, x);
    return true;
  }

  riseElevators() {
    let any = false;
    for (let x0 = 0; x0 < this.W; x0++) {
      const g = this.elvGroup[x0];
      if (g < 0 || !this.elvLevels[x0].length) continue;
      let first = true, ready = true;
      for (let x = 0; x < this.W; x++) {
        if (this.elvGroup[x] !== g) continue;
        if (x < x0) { first = false; break; }
        if (this.clr[x] > 0 || !(this.elvWait[x] || this.cols[x].length === 0)) ready = false;
      }
      if (!first || !ready) continue;
      for (let x = 0; x < this.W; x++) {
        if (this.elvGroup[x] !== g) continue;
        const level = this.elvLevels[x].shift();
        this.elvWait[x] = false;
        const col = this.cols[x];
        col.push(...level);
        if (sumLen(col) > this.hs[x]) col.length = this.hs[x];
        this.peak[x] = col.length;
        this.events.push({ t: 'rise', col: x, ids: col.map(k => k.id), left: this.elvLevels[x].length });
      }
      for (let x = 0; x < this.W; x++) if (this.elvGroup[x] === g && !this.covered(x) && this.uniformFull(x)) this.checkClear(x);
      any = true;
    }
    return any;
  }

  checkLaneReveal(x) {
    const col = this.cols[x];
    if (col.length < this.peak[x]) for (const k of col) if (k.hidden) { k.hidden = false; this.events.push({ t: 'revealCar', id: k.id, col: x, c: k.c }); }
    this.peak[x] = col.length;
  }

  tick() {
    if (this.state !== 'play') return;
    const { N, W } = this;
    this.ticks++;
    let changed = false;
    for (let i = 0; i < W; i++) if (this.clr[i] > 0) { this.clr[i]--; changed = true; }
    if (this.riseElevators()) changed = true;
    this.advanceLoop();
    const stOcc = Array(N).fill(EMPTY), laneUsed = Array(W).fill(false), ejectedBuf = [];
    const mark = (head, len, id) => { for (let j = 0; j < len; j++) stOcc[(head - j + N) % N] = id; };
    const stationsEmpty = (head, len) => { for (let j = 0; j < len; j++) if (stOcc[(head - j + N) % N] !== EMPTY) return false; return true; };
    for (const k of this.loop) mark(k.st, k.len, k.id);
    if (this.mergeExits(mark, stationsEmpty)) changed = true;
    for (let i = 0; i < this.loop.length; i++) {
      const k = this.loop[i];
      const st = this.stations[k.st];
      if (st.top < 0 || laneUsed[st.top] || !this.accepts(st.top, k)) continue;
      const x = st.top, col = this.cols[x];
      let free = this.hs[x] - sumLen(col), cut = 0, outCells = 0;
      while (free < k.len) { free += col[cut].len; outCells += col[cut].len; cut++; }
      if (this.loopCells() - k.len + outCells > this.cap) continue;
      const bi = this.exitStation(x), feeds = this.feedsOut(x);
      let off = 0;
      // Game gốc: xe bị đẩy ra đi ngay (xe trên đường phanh nhường). Khi nó chưa vào được đường ngay, xe sắp vào làn đứng chờ
      // ở đầu làn (advanceLoop giữ nó và giữ trống đoạn đường dưới làn), nên làn không bao giờ giữ nhiều xe hơn số ô. Sau
      // DOCK_WAIT_MAX tick thì vào luôn, xe bị đẩy chờ ở cửa làn như cũ.
      if (cut > 0 && !feeds && k.dockTicks < DOCK_WAIT_MAX
        && (this.exits.some(e => e.exitCol === x) || !stationsEmpty((bi + 1) % N, col[0].len + 2))) {
        k.dockWait = true; k.dockTicks++;
        laneUsed[x] = true;
        continue;
      }
      k.dockWait = false; k.dockTicks = 0;
      laneUsed[x] = true;
      for (let j = 0; j < k.len; j++) { const s = (k.st - j + N) % N; if (stOcc[s] === k.id) stOcc[s] = EMPTY; }
      this.loop.splice(i--, 1);
      const ejected = [];
      // Xe bị đẩy ra nhập lại vòng ở dưới làn; chỗ đó có xe (vòng chạy đồng bộ nên có thể kẹt mãi) thì chờ ở cửa làn và
      // nhập vào khe trống kế tiếp.
      let wait = this.exits.some(e => e.exitCol === x);
      for (let q = 0; q < cut; q++) {
        const o = col[q];
        ejected.push(o.id);
        if (feeds) {
          this.exits.push(this.feed(o, x));
          if (o.hidden) this.events.push({ t: 'revealCar', id: o.id, col: x, c: o.c });
          continue;
        }
        const nc = car({ id: o.id, c: o.c, len: o.len, st: (bi - off + N) % N });
        off += o.len;
        if (!wait && stationsEmpty((nc.st + 1) % N, nc.len + 2)) { mark(nc.st, nc.len, nc.id); ejectedBuf.push(nc); }
        else { wait = true; nc.st = bi; nc.exitCol = x; this.exits.push(nc); }
        if (o.hidden) this.events.push({ t: 'revealCar', id: o.id, col: x, c: o.c });
      }
      const pushedOut = cut > 0 ? col.splice(0, cut) : null;
      col.push(car({ id: k.id, c: k.c, len: k.len }));
      this.events.push({ t: 'insert', id: k.id, col: x, ejected });
      changed = true;
      if (!this.checkClear(x)) this.checkLaneReveal(x);
      if (pushedOut) for (const o of pushedOut) this.leaveLane(o, x);
    }
    for (const k of ejectedBuf) this.loop.push(k);
    if (this.tryEnter()) changed = true;
    this.idleTicks = changed ? 0 : this.idleTicks + 1;
    this.evaluate();
  }

  /**
   * MergeExits: xe chờ ở cửa làn vào vòng khi chỗ trống (mỗi cửa một xe mỗi tick). Crossway: xe trên đường nhánh đếm ngược
   * travel rồi mới nhập ở giao lộ; mọi xe nhánh dùng chung một giao lộ (theo thứ tự, mỗi tick một xe).
   */
  mergeExits(mark, stationsEmpty) {
    if (!this.exits.length) return false;
    const N = this.N, blocked = new Set(), FEEDER = 'f';
    let any = false;
    for (let e = 0; e < this.exits.length; e++) {
      const c = this.exits[e], key = c.feeder ? FEEDER : c.exitCol;
      // Xe nhánh còn đang chạy tới giao lộ không chặn các xe đã tới.
      if (c.feeder && c.travel > 0) { c.travel--; any = true; if (c.travel > 0) continue; }
      if (blocked.has(key)) continue;
      if (!stationsEmpty((c.st + 1) % N, c.len + 2)) { blocked.add(key); if (c.feeder) c.dockTicks++; continue; }
      this.exits.splice(e--, 1);
      const col = c.exitCol, fed = c.feeder;
      c.exitCol = -1; c.feeder = false; c.dockTicks = 0;
      mark(c.st, c.len, c.id);
      this.loop.push(c);
      this.events.push({ t: 'merge', id: c.id, col, i: fed ? 1 : 0 });
      blocked.add(key);
      any = true;
    }
    return any;
  }

  /**
   * Vòng chạy một trạm. Game gốc (giới hạn tốc độ ở điểm nhập): xe trên đường phanh nhường xe đang chờ ra khỏi làn. Xe ra
   * đầu tiên giữ chỗ đoạn nó nhập vào (một trạm trống trước, thân xe, một trạm sau); xe sắp chạy vào đoạn đó đứng yên, và xe
   * nào sẽ đâm vào xe đứng yên cũng đứng yên. Xe đã ở trong đoạn chạy tiếp cho thoát. Mỗi lúc chỉ một xe ra giữ chỗ nên
   * đường không bao giờ khoá vòng tròn. Crossway: xe vòng đi trước ở giao lộ; xe nhánh chờ JUNCTION_WAIT_MAX tick thì được
   * giữ chỗ giao lộ.
   */
  advanceLoop() {
    const { N, loop } = this;
    for (const c of loop) c.held = false;
    // Xe chờ ở đầu làn chỉ còn chờ khi làn đó vẫn nhận nó.
    for (const c of loop) {
      if (!c.dockWait) continue;
      const top = this.stations[c.st].top;
      if (top < 0 || !this.accepts(top, c)) { c.dockWait = false; c.dockTicks = 0; }
    }
    const zones = [];
    for (const e of this.exits) {
      if (e.exitCol >= 0 || (e.feeder && e.travel === 0 && e.dockTicks >= JUNCTION_WAIT_MAX)) { zones.push([e.st, e.len]); break; }
    }
    for (const c of loop) {
      if (!c.dockWait) continue;
      const x = this.stations[c.st].top;
      if (this.cols[x].length > 0) zones.push([this.exitStation(x), this.cols[x][0].len]);
    }
    const anyDock = loop.some(c => c.dockWait);
    if ((zones.length === 0 && !anyDock) || loop.length === 0) {
      for (const c of loop) c.st = (c.st + 1) % N;
      return;
    }
    // Trạm giữ chỗ: head + 1 xuống head - len (như mergeExits / kiểm tra chờ đầu làn).
    const reserved = s => zones.some(([head, len]) => (head + 1 - s + N) % N <= len + 1);
    const at = Array(N).fill(-1);
    loop.forEach((c, i) => { for (let j = 0; j < c.len; j++) at[(c.st - j + N) % N] = i; });
    const stay = loop.map(c => c.dockWait || (reserved((c.st + 1) % N) && !reserved(c.st)));
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < loop.length; i++) {
        if (stay[i]) continue;
        const ahead = at[(loop[i].st + 1) % N];
        if (ahead >= 0 && ahead !== i && stay[ahead]) { stay[i] = true; again = true; }
      }
    }
    const anyMoves = stay.some(s => !s);
    // An toàn: đường kín cả vòng thì không thoát được đoạn giữ chỗ; khi đó mọi xe chạy như cũ.
    loop.forEach((c, i) => { if (stay[i] && anyMoves) c.held = true; else c.st = (c.st + 1) % N; });
  }

  clearing() { return this.clr.some(v => v > 0); }

  canAnyInsert() {
    for (const k of this.loop) for (let x = 0; x < this.W; x++) if (this.accepts(x, k)) return true;
    return false;
  }

  canStillSend(extraCap = 0) {
    const c = this.cap + extraCap, lc = this.loopCells();
    if (this.queue.length) return lc + this.queue[0].len <= c;
    const pending = this.queueCells() + this.transit;
    for (const b of this.buses) {
      if (b.out || b.ice > 0 || b.box || b.gen || b.inGen >= 0) continue;
      let len = b.len;
      if (b.link >= 0) { len = 0; for (const g of this.groupOf(b.id)) len += this.buses[g].len; }
      if (lc + len <= c && lc + pending + len <= c + this.qcap && this.probeOk(b.id)) return true;
    }
    return false;
  }

  key() {
    const p = [];
    p.push(this.cols.map(col => col.map(k => k.c + k.len + (k.key ? 'k' : '') + (k.coc ? 'o' : '')).join('')).join('/'));
    p.push(this.loop.map(k => `${k.st}${k.c}${k.len}${k.dockWait ? 'w' + k.dockTicks : ''}`).sort().join(','));
    p.push(this.queue.map(k => k.c + k.len).join(''));
    if (this.exits.length) p.push('x' + this.exits.map(k => `${k.exitCol}:${k.c}${k.len}${k.feeder ? 'f' + k.travel + '.' + k.dockTicks : ''}`).join(''));
    p.push(this.buses.map(b => (b.out ? '-' : b.inGen >= 0 ? 'g' : `${b.x}.${b.y}${b.c}${b.frontOrder >= 0 ? 'f' + b.frontOrder : ''}`)).join(','));
    let s = this.locked.join('') + 'i' + this.ice.join('');
    for (let x = 0; x < this.W; x++) if (this.closed[x]) s += 'x' + x;
    for (let x = 0; x < this.W; x++) if (this.curN[x] > 0 || this.elvWait[x] || this.elvLevels[x].length) s += `e${x}:${this.curN[x]}${this.elvWait[x] ? 'w' : '-'}${this.elvLevels[x].length}`;
    if (this.stackedKeys > 0) s += 'K' + this.stackedKeys;
    p.push(s);
    if (this.clearing()) p.push('c' + this.clr.join(','));
    p.push(String(this.cap));
    return p.join('|');
  }

  get cycled() { return this.idleTicks >= this.N; }

  evaluate() {
    if (this.state !== 'play') return;
    if (this.carsLeft() === 0) { this.state = 'won'; this.events.push({ t: 'won' }); return; }
    if (this.inTransit > 0 || this.exits.length > 0 || this.clearing()) return;
    const stuck = this.cycled || !this.canAnyInsert();
    if (!stuck || this.canStillSend()) return;
    this.state = 'lost';
    this.events.push({ t: 'lost' });
  }

  isSettled() {
    return this.inTransit === 0 && !this.queue.length && !this.exits.length && !this.clearing() && (!this.canAnyInsert() || this.cycled);
  }

  canReviveHelp(extra) { return this.state === 'lost' && extra > 0 && this.carsLeft() > 0 && this.canStillSend(extra); }

  revive(extra) {
    if (this.state !== 'lost' || extra < 1) return false;
    this.state = 'play'; this.cap += extra; this.revives++; this.idleTicks = 0;
    this.events.push({ t: 'revive', left: this.cap });
    return true;
  }

  addLoop(n = 1) { if (n < 1) return; this.cap += n; this.idleTicks = 0; }

  // ---------- booster ----------

  /** Tay: gửi bất kỳ xe nào trong bãi (cả nhóm nối) lên vòng. */
  pushOut(id) {
    if (this.state !== 'play' || id < 0 || id >= this.buses.length || this.buses[id].out) return { r: 'ignored' };
    const group = this.groupOf(id);
    let len = 0;
    for (const g of group) {
      const o = this.buses[g];
      if (o.box || o.gen || o.inGen >= 0) return { r: 'locked' };
      len += o.len;
    }
    if (!this.hasRoom(len)) return { r: 'noroom' };
    const res = { r: 'released', travel: 0, bus: id, extra: [], extraBus: [] };
    for (const g of group.slice().sort((a, b) => this.buses[b].y - this.buses[a].y)) {
      const k = this.release(g);
      if (g === id) res.car = k; else { res.extra.push(k); res.extraBus.push(g); }
    }
    return res;
  }

  /** Búa: xe vào làn đầu tiên (đáy) bị đẩy ra cửa làn, chờ vào vòng. */
  hammerLane(x) {
    if (this.state !== 'play' || x < 0 || x >= this.W) return { r: 'ignored' };
    const col = this.cols[x];
    if (this.clr[x] > 0) return { r: 'clearing' };
    if (!col.length) return { r: 'empty' };
    if (this.covered(x)) return { r: 'locked' };
    const first = col.shift();
    this.exits.push(this.feedsOut(x) ? this.feed(first, x) : car({ id: first.id, c: first.c, len: first.len, st: this.exitStation(x), exitCol: x }));
    this.events.push({ t: 'hammer', id: first.id, col: x, c: first.c });
    this.checkLaneReveal(x);
    this.leaveLane(first, x);
    this.idleTicks = 0;
    this.evaluate();
    return { r: 'released' };
  }

  /** Xáo: hoán vị (không điểm cố định) các xe tự do ở 6 hàng đầu bãi; ô giữ trạng thái ẩn của nó. */
  shuffleLot(rnd = Math.random) {
    if (this.state !== 'play') return 0;
    const rows = 6;
    const ok = b => !b.out && !b.box && !b.gen && b.inGen < 0 && b.ice <= 0 && b.link < 0 && b.y >= Math.max(0, this.jh - rows);
    const free = this.buses.filter(ok);
    if (free.length < 2) return 0;
    let best = null, bestScore = -1;
    for (let t = 0; t < 60; t++) {
      const perm = derangement(free.length, rnd);
      const plan = new Map(free.map((b, i) => [b.id, { x: free[perm[i]].x, y: free[perm[i]].y }]));
      const probe = this.clone();
      probe.applyShuffle(plan);
      const score = probe.shuffleScore();
      if (score > bestScore) { bestScore = score; best = plan; }
      if (score >= 2) break;
    }
    const moved = this.applyShuffle(best);
    this.idleTicks = 0;
    this.events.push({ t: 'shuffle', left: moved });
    this.reveal();
    this.updateBoxes();
    return moved;
  }

  applyShuffle(plan) {
    const hiddenAt = new Map();
    for (const id of plan.keys()) { const b = this.buses[id]; hiddenAt.set(`${b.x},${b.y}`, b.hidden); this.occ[b.x][b.y] = EMPTY; }
    let moved = 0;
    for (const [id, p] of plan) {
      const b = this.buses[id];
      if (b.x !== p.x || b.y !== p.y) moved++;
      b.x = p.x; b.y = p.y; b.hidden = !!hiddenAt.get(`${p.x},${p.y}`);
      this.occ[b.x][b.y] = b.id;
    }
    return moved;
  }

  shuffleScore() {
    let best = 0;
    for (const b of this.buses) {
      if (b.out || b.box || b.gen || b.inGen >= 0 || !this.probeOk(b.id) || !this.hasRoom(b.len)) continue;
      let enters = false;
      for (let x = 0; x < this.W && !enters; x++) if (this.accepts(x, { c: b.c, len: b.len })) enters = true;
      best = Math.max(best, enters ? 2 : 1);
      if (best === 2) break;
    }
    return best;
  }
}

function derangement(n, rnd) {
  const p = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return p;
  for (let tries = 0; tries < 50; tries++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    if (p.every((v, i) => v !== i)) return p;
  }
  return p.map((_, i) => (i + 1) % n);
}
