// Định dạng level của Parking Loop (Assets/_Game/Levels/Level_NNNN[_v].json) và chuyển sang mô hình chơi.
// Port từ bản Unity: Core/LevelFormat/LevelModels.cs, LevelDecoder.NormalizeAfterDecode, Core/LoopLevelConverter.cs,
// Core/ParkingLevelValidator.cs. JS thuần (server + trình duyệt). Sửa luật ở Unity thì chép lại ở đây (AGENTS.md gốc).

/** Chữ màu: màu n (EntityColorTypes 1..15) = CODES[n - 1]. */
export const CODES = 'RYTLGNVPOKUMWCB';
export const COLOR_NAMES = ['', 'Red', 'Yellow', 'Turquoise', 'LightBlue', 'Green', 'Brown', 'Lavender', 'Pink', 'Orange',
  'Black', 'Purple', 'Magenta', 'White', 'Cream', 'Blue'];
export const COLOR_VN = ['', 'Đỏ', 'Vàng', 'Ngọc', 'Xanh nhạt', 'Lục', 'Nâu', 'Oải hương', 'Hồng', 'Cam', 'Đen', 'Tím',
  'Hồng sẫm', 'Trắng', 'Kem', 'Xanh dương'];
/** Màu vẽ (ParkingPalette.cs). */
export const COLOR_HEX = ['#9a9fb8', '#f2453f', '#ffc62e', '#2fd0d8', '#6ec3ff', '#4fc96a', '#8b5a2b', '#b79cf0', '#ff8fc8',
  '#ff8a2b', '#3a3f4f', '#8a3fd1', '#e0309a', '#f4f5fb', '#f3e3b5', '#2f6cf0'];
export const DIFFICULTY = [[0, 'Normal'], [1, 'Hard'], [2, 'SuperHard'], [3, 'UltraHard'], [1000, 'Tutorial']];
export const OBSTACLE = { Barrier: 1, ColoredLane: 2, IcedLane: 3, Curtain: 4 };
export const OBSTACLE_NAMES = { 1: 'Barrier', 2: 'ColoredLane', 3: 'IcedLane', 4: 'Curtain' };
/** pf.tl bị bỏ trong file gọn khi bằng mặc định của game. */
export const DEFAULT_LOOP = 5;

export const colorOf = code => (Number.isInteger(code) && code >= 1 && code <= CODES.length ? CODES[code - 1] : '');
export const codeOf = ch => CODES.indexOf(String(ch || '').toUpperCase()) + 1;
export const hexOf = ch => COLOR_HEX[codeOf(ch)] || COLOR_HEX[0];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isFinite(v) ? Math.trunc(v) : typeof v === 'boolean' ? +v : d);
const int2 = (p, d = { x: 0, y: 0 }) => (isObj(p) ? { x: int(p.x), y: int(p.y) } : { ...d });
const arr = v => (Array.isArray(v) ? v : []);

/**
 * Bản đã điền mặc định của raw (như Newtonsoft đọc vào LevelData): không đụng raw gốc. Trường thiếu = mặc định của class
 * C# (p = (0,0), cn thiếu = không nối (-1,0), tl = 0 → DEFAULT_LOOP lúc chuyển).
 */
export function normalize(raw) {
  const d = isObj(raw) ? raw : {};
  const pf = isObj(d.pf) ? d.pf : {}, ui = isObj(d.ui) ? d.ui : {};
  const elem = e => (isObj(e) ? { et: int(e.et), c: int(e.c), h: !!e.h, k: !!e.k, coc: int(e.coc) } : { et: 0, c: 0, h: false, k: false, coc: 0 });
  return {
    li: int(d.li), level_ab_variant: typeof d.level_ab_variant === 'string' ? d.level_ab_variant : '', lt: int(d.lt), ld: int(d.ld),
    bi: int(d.bi), ur: !!d.ur, ds: int(d.ds),
    pf: {
      cp: int(pf.cp), tl: int(pf.tl), ic: !!pf.ic,
      sd: arr(pf.sd).map(s => {
        s = isObj(s) ? s : {};
        return {
          d: int(s.d), t: int(s.t), sot: arr(s.sot).map(v => int(v)), lc: int(s.lc), ic: int(s.ic), p: int2(s.p),
          se: arr(s.se).map(elem), elid: int(s.elid),
          elv: arr(s.elv).map(l => ({ se: arr(isObj(l) ? l.se : null).map(elem) })),
          cd: isObj(s.cd) ? { coc: int(s.cd.coc), v: int(s.cd.v) } : { coc: 0, v: 0 },
        };
      }),
    },
    ui: {
      u: arr(ui.u).map(u => {
        u = isObj(u) ? u : {};
        return {
          co: int(u.co), et: int(u.et), ic: int(u.ic), gc: int(u.gc), sg: int(u.sg), h: !!u.h, l: !!u.l, coc: int(u.coc),
          p: int2(u.p), cn: int2(u.cn, { x: -1, y: 0 }),
        };
      }),
      c: arr(ui.c).map(c => (isObj(c) ? { o: int(c.o), uc: int(c.uc) } : { o: 0, uc: 0 })),
    },
  };
}

export const hasLink = u => u.cn.x >= 0 && u.cn.y >= 0;

/** Thứ tự làn như game: theo p.y rồi p.x. Trả chỉ số trong pf.sd. */
export function laneOrder(n) {
  return n.pf.sd.map((s, i) => i).sort((a, b) => n.pf.sd[a].p.y - n.pf.sd[b].p.y || n.pf.sd[a].p.x - n.pf.sd[b].p.x);
}

/** Cột bãi như game: nhóm ui.u theo p.x (tăng dần), trong cột xếp p.y giảm dần (y lớn = sát đường). Trả [{x, units: [chỉ số ui.u]}]. */
export function lotOrder(n) {
  const groups = new Map();
  n.ui.u.forEach((u, i) => {
    if (!groups.has(u.p.x)) groups.set(u.p.x, []);
    groups.get(u.p.x).push(i);
  });
  return [...groups.keys()].sort((a, b) => a - b).map(x => ({ x, units: groups.get(x).slice().sort((a, b) => n.ui.u[b].p.y - n.ui.u[a].p.y) }));
}

/**
 * LoopLevelConverter.Convert: raw → ParkingLevel (mô hình chơi). Trả {level, notes, error}. notes là các điểm mô hình bỏ qua
 * (cảnh báo), error khi không chuyển được.
 */
export function convert(raw) {
  const d = normalize(raw), notes = [];
  const order = laneOrder(d);
  if (!order.length) return { level: null, notes, error: 'không có làn nào (pf.sd rỗng)' };
  const lanes = order.map(i => d.pf.sd[i]);
  const laneCars = lanes.map(s => s.se.filter(c => c.c !== 0));
  const W = lanes.length, H = Math.max(1, d.pf.cp);
  let dropped = 0;
  for (const l of laneCars) if (l.length > H) { dropped += l.length - H; l.length = H; }
  if (dropped > 0) notes.push(`${dropped} xe trong làn vượt quá chiều cao làn cp=${d.pf.cp} bị bỏ`);

  const rows = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < laneCars[x].length; y++) {
      const car = laneCars[x][y], ch = colorOf(car.c);
      if (!ch) return { level: null, notes, error: `làn ${x}: màu không rõ ${car.c}` };
      rows[H - 1 - y][x] = car.h ? ch.toLowerCase() : ch;
    }
  }

  // Xe nối (cn) thành chuỗi: union-find theo vị trí trong bãi.
  const key = p => `${p.x},${p.y}`;
  const parent = new Map();
  const find = k => { while (parent.has(k) && parent.get(k) !== k) k = parent.get(k); return k; };
  for (const u of d.ui.u) parent.set(key(u.p), key(u.p));
  const linked = d.ui.u.filter(u => hasLink(u) && parent.has(key(u.cn)));
  for (const u of linked) {
    const a = find(key(u.p)), b = find(key(u.cn));
    if (a !== b) parent.set(a, b);
  }
  const linkedRoots = new Set(linked.map(u => find(key(u.p))));
  const linkIds = new Map();

  const lot = [], lotUnits = [];
  let lotCol = 0;
  for (const g of lotOrder(d)) {
    let s = '';
    g.units.forEach((ui, i) => {
      const u = d.ui.u[ui];
      let ch = colorOf(u.co);
      if (!ch && (u.l || u.sg > 0)) ch = CODES[0];
      if (!ch) throw new ConvertError(`bãi (${u.p.x}, ${u.p.y}): màu không rõ ${u.co}`);
      s += u.h && !u.l ? ch.toLowerCase() : ch;
      const root = find(key(u.p));
      let link = -1;
      if (linkedRoots.has(root)) {
        if (!linkIds.has(root)) linkIds.set(root, linkIds.size);
        link = linkIds.get(root);
      }
      const coc = colorOf(u.coc);
      if (u.l || u.sg > 0 || link >= 0 || coc) lotUnits.push({ col: lotCol, i, box: u.l, gen: !u.l && u.sg > 0, link, coc });
    });
    lot.push(s);
    lotCol++;
  }

  const lv = {
    difficulty: d.ld === 1000 ? 0 : Math.max(0, Math.min(2, d.ld)),
    grid: rows.map(r => r.join('')), loop: d.pf.tl > 0 ? d.pf.tl : DEFAULT_LOOP, queue: 0, lot, lotUnits,
    locks: [], only: [], barriers: [], iceLanes: [], curtains: [], elevators: [], laneCars: [], heights: [],
  };
  for (let x = 0; x < W; x++) {
    const s = lanes[x];
    const lockColor = s.t === 1 || s.lc !== 0 ? colorOf(s.lc) : '';
    if (lockColor) lv.locks.push({ col: x, color: lockColor, after: 0 });
    else if (s.t === 1) lv.locks.push({ col: x, color: '', after: 1 });
    if (s.sot.includes(OBSTACLE.Barrier)) lv.barriers.push(x);
    if (s.sot.includes(OBSTACLE.ColoredLane) && laneCars[x].length > 0) lv.only.push({ col: x, c: colorOf(laneCars[x].at(-1).c) });
    if (s.sot.includes(OBSTACLE.IcedLane) && s.ic > 0) lv.iceLanes.push({ col: x, n: s.ic });
    const cur = colorOf(s.cd.coc);
    if (cur && s.cd.v > 0 && (s.sot.includes(OBSTACLE.Curtain) || s.sot.length === 0)) lv.curtains.push({ col: x, c: cur, n: s.cd.v });
    laneCars[x].forEach((car, i) => {
      const coc = colorOf(car.coc);
      if (car.k || coc) lv.laneCars.push({ col: x, i, key: car.k, coc });
    });
    if (s.elv.length > 0) {
      const levels = s.elv.map(l => l.se.filter(c => colorOf(c.c)).slice(0, H)
        .map(c => (c.h ? colorOf(c.c).toLowerCase() : colorOf(c.c))).join(''));
      lv.elevators.push({ col: x, group: s.elid, levels });
    }
  }
  if (d.pf.ic || new Set(lanes.map(s => s.p.y)).size > 1) notes.push('crossway: hai hàng làn được xếp thành một hàng');
  if (d.ui.u.some(u => u.gc > 0)) notes.push('xe ma (gc) được chơi như xe thường');
  if (d.ui.u.some(u => u.ic > 0)) notes.push('xe đóng băng trong bãi (ic) được chơi không có băng');
  return { level: lv, notes, error: null };
}

class ConvertError extends Error {}

/** convert() không ném lỗi. */
export function tryConvert(raw) {
  try {
    return convert(raw);
  } catch (e) {
    return { level: null, notes: [], error: e instanceof ConvertError ? e.message : `không đọc được level: ${e.message}` };
  }
}

const isColor = ch => ch !== '.' && CODES.includes(String(ch).toUpperCase());

/** ParkingLevelValidator.Validate (chỉ phần bãi cột: định dạng Level_*.json không có bãi mũi tên). */
export function validateModel(lv) {
  const errors = [], warnings = [];
  const H = lv.grid.length, W = H ? lv.grid[0].length : 0;
  if (!H) return { errors: ['lưới làn rỗng'], warnings };
  if (!W) return { errors: ['không có làn'], warnings };
  const counts = new Map();
  const count = ch => { ch = ch.toUpperCase(); counts.set(ch, (counts.get(ch) || 0) + 1); };
  for (let y = 0; y < H; y++) for (const ch of lv.grid[y]) if (ch !== '.') isColor(ch) ? count(ch) : errors.push(`màu không rõ '${ch}' trong làn`);
  if (lv.loop < 1) errors.push(`sức chứa vòng ${lv.loop} phải ≥ 1`);
  let cars = 0;
  lv.lot.forEach((col, i) => {
    if (!col.length) warnings.push(`cột bãi ${i} trống`);
    for (const ch of col) { count(ch); cars++; }
  });
  if (cars === 0) errors.push('bãi trống: không có xe nào để gửi');
  for (const k of lv.locks) if (k.color && !counts.has(k.color)) warnings.push(`làn ${k.col} khoá chờ màu ${k.color}, màu này không có trong level`);
  for (const k of lv.locks) for (const o of lv.only) if (k.col === o.col && k.color && k.color !== o.c) warnings.push(`làn ${k.col} chờ ${k.color} nhưng chỉ nhận ${o.c}`);
  if (new Set(lv.locks.map(k => k.col)).size >= W) errors.push('mọi làn đều khoá: không xe nào đỗ được');
  return { errors, warnings };
}

/** ParkingLevelChecker.WhyImpossible: đếm mọi xe (làn, bãi trừ hộp khoá / máy phát, thang máy) theo màu. */
export function whyImpossible(lv) {
  const h = lv.grid.length;
  const counts = new Map();
  const count = ch => { ch = ch.toUpperCase(); counts.set(ch, (counts.get(ch) || 0) + 1); };
  for (const row of lv.grid) for (const ch of row) if (ch !== '.') count(ch);
  const notCars = new Set(lv.lotUnits.filter(u => u.box || u.gen).map(u => `${u.col},${u.i}`));
  lv.lot.forEach((col, x) => [...col].forEach((ch, i) => { if (!notCars.has(`${x},${i}`)) count(ch); }));
  for (const e of lv.elevators) for (const s of e.levels) for (const ch of s) if (ch !== '.') count(ch);
  const bad = [...counts].filter(([, n]) => n % h !== 0).sort().map(([c, n]) => `${c}=${n}`);
  return bad.length ? `chiều cao làn ${h}, nhưng số xe ${bad.join(' ')} không chia hết cho ${h}` : null;
}
