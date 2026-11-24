// Thao tác sửa raw Level_NNNN.json của Editor (ui.mjs), giữ kiểu file gọn (chỉ ghi trường cần). JS thuần, test được
// trong Node (game/tests/edit.test.mjs).
//  - Làn: pf.sd theo thứ tự game (p.y, p.x); se[0] = xe ở đáy làn (ra trước).
//  - Bãi: ui.u nhóm theo cột p.x; trong cột y lớn = sát đường (ra trước). Nối xe: cn trỏ vị trí (x, y) của xe khác.
import { CODES, lotOrder, normalize } from './format.mjs';

export const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const flag = (o, k, v) => { if (v) o[k] = true; else if (k in o) o[k] = false; };
export const num = (o, k, v) => { if (v) o[k] = v; else delete o[k]; };

export function ensure(raw) {
  if (!isObj(raw.pf)) raw.pf = {};
  if (!Array.isArray(raw.pf.sd)) raw.pf.sd = [];
  if (!isObj(raw.ui)) raw.ui = {};
  if (!Array.isArray(raw.ui.u)) raw.ui.u = [];
  for (const s of raw.pf.sd) { if (!Array.isArray(s.se)) s.se = []; }
  return raw;
}
export const pOf = o => ({ x: o?.p?.x | 0, y: o?.p?.y | 0 });
export const cnOf = u => (isObj(u.cn) ? { x: u.cn.x | 0, y: u.cn.y | 0 } : null);
export const setP = (o, p) => { if (p.x || p.y || o.p) o.p = { x: p.x, y: p.y }; };

/** Làn theo thứ tự game (p.y, p.x) → object sd trong raw. */
export function lanesOf(raw) {
  return raw.pf.sd.map((s, i) => [s, i]).sort((a, b) => pOf(a[0]).y - pOf(b[0]).y || pOf(a[0]).x - pOf(b[0]).x || a[1] - b[1]).map(([s]) => s);
}

/** Cột bãi theo thứ tự game → [{x, units: [object ui.u, trước (sát đường) → sau]}]. */
export function lotOf(raw) {
  const n = normalize(raw);
  return lotOrder(n).map(g => ({ x: g.x, units: g.units.map(i => raw.ui.u[i]) }));
}

export function syncColumns(raw) {
  const n = lotOf(raw).length, old = Array.isArray(raw.ui.c) ? raw.ui.c : [];
  raw.ui.c = Array.from({ length: n }, (_, i) => old[i] ?? (i ? { o: i } : {}));
}

export function dropLinksTo(raw, p) {
  for (const u of raw.ui.u) { const cn = cnOf(u); if (cn && cn.x === p.x && cn.y === p.y) delete u.cn; }
}

/**
 * Xếp lại bãi theo danh sách cột mới (mỗi cột: xe trước → sau): cột thứ i có x = i, y đếm từ đáy cột, mọi cn trỏ
 * vào xe đã dời được sửa theo. Xe mới thêm (chưa có chỗ) cần p ngoài bãi (vd x = -9) để không trùng khoá cũ.
 */
export function relayout(raw, cols) {
  const moved = new Map();
  cols = cols.filter(c => c.length);
  cols.forEach((units, x) => units.forEach((u, i) => { const o = pOf(u); moved.set(`${o.x},${o.y}`, { x, y: units.length - 1 - i }); }));
  cols.forEach((units, x) => units.forEach((u, i) => setP(u, { x, y: units.length - 1 - i })));
  for (const u of raw.ui.u) {
    const cn = cnOf(u);
    if (!cn || cn.x < 0) continue;
    const to = moved.get(`${cn.x},${cn.y}`);
    if (to) u.cn = { ...to }; else delete u.cn;
  }
  syncColumns(raw);
}

/** Đặt lại y trong một cột bãi theo thứ tự mới (trước → sau) và sửa mọi cn trỏ vào các ô đã dời. */
export function renumberColumn(raw, x, units) {
  const cols = lotOf(raw).map(c => (c.x === x ? units : c.units));
  if (!lotOf(raw).some(c => c.x === x)) cols.push(units);
  relayout(raw, cols);
}

const laneToUnit = e => { const u = { co: e.c, p: { x: -9, y: -9 } }; if (e.h) u.h = true; if (e.coc) u.coc = e.coc; return u; };
const unitToLane = u => { const e = { c: u.co }; if (u.h) e.h = true; if (u.coc) e.coc = u.coc; return e; };
const swapLook = (a, ka, b, kb) => {   // đổi màu + ẩn giữa xe làn và xe bãi (giữ chìa / nối tại chỗ)
  [a[ka], b[kb]] = [b[kb], a[ka]];
  const ha = !!a.h, hb = !!b.h;
  flag(a, 'h', hb); flag(b, 'h', ha);
};
const special = u => u.l || u.sg > 0;

/**
 * Kéo xe từ src thả vào dst (Editor, thao tác xếp level). src / dst: {kind: 'lane', x, slot} | {kind: 'lot', ci, row}
 * (x = thứ tự làn, slot 0 = đáy làn; ci = thứ tự cột bãi, row 0 = sát đường; ci = số cột → cột mới).
 *  - Thả lên xe khác: đổi chỗ hai xe (khác loại làn / bãi thì đổi màu và ẩn).
 *  - Thả vào ô trống: làn → xe lên đỉnh làn; bãi → xe xuống cuối cột. Khác loại thì xe đổi loại.
 * Trả null khi xong, chuỗi lý do khi không làm được (raw không đổi).
 */
export function moveCar(raw, src, dst) {
  ensure(raw);
  const cp = Math.max(1, raw.pf.cp | 0), lanes = lanesOf(raw), cols = lotOf(raw).map(c => c.units.slice());
  if (src.kind === dst.kind && (src.kind === 'lane' ? src.x === dst.x && src.slot === dst.slot : src.ci === dst.ci && src.row === dst.row)) return 'cùng chỗ';
  if (src.kind === 'lane') {
    const se = lanes[src.x]?.se, e = se?.[src.slot];
    if (!e) return 'không có xe';
    if (dst.kind === 'lane') {
      const de = lanes[dst.x]?.se;
      if (!de) return 'không có làn';
      const t = de[dst.slot];
      if (t) { de[dst.slot] = e; se[src.slot] = t; return null; }
      if (de !== se && de.length >= cp) return 'làn đã đầy';
      se.splice(src.slot, 1); de.push(e);
      return null;
    }
    if (dst.ci > cols.length) return 'ngoài bãi';
    const col = cols[dst.ci] ?? (cols[dst.ci] = []), t = col[dst.row];
    if (t) { if (special(t)) return 'hộp khoá / máy phát không đổi chỗ với xe làn'; swapLook(e, 'c', t, 'co'); return null; }
    se.splice(src.slot, 1);
    const u = laneToUnit(e);
    raw.ui.u.push(u); col.push(u);
    relayout(raw, cols);
    return null;
  }
  const col = cols[src.ci], u = col?.[src.row];
  if (!u) return 'không có xe';
  if (dst.kind === 'lot') {
    if (dst.ci > cols.length) return 'ngoài bãi';
    const dc = cols[dst.ci] ?? (cols[dst.ci] = []), t = dc[dst.row];
    if (t) { dc[dst.row] = u; col[src.row] = t; } else { col.splice(src.row, 1); dc.push(u); }
    relayout(raw, cols);
    return null;
  }
  if (special(u)) return 'hộp khoá / máy phát chỉ nằm trong bãi';
  const de = lanes[dst.x]?.se;
  if (!de) return 'không có làn';
  const t = de[dst.slot];
  if (t) { swapLook(t, 'c', u, 'co'); return null; }
  if (de.length >= cp) return 'làn đã đầy';
  dropLinksTo(raw, pOf(u));
  col.splice(src.row, 1);
  raw.ui.u.splice(raw.ui.u.indexOf(u), 1);
  de.push(unitToLane(u));
  relayout(raw, cols);
  return null;
}

/** Trộn màu mọi xe (làn + bãi, trừ hộp khoá / máy phát), giữ số xe mỗi màu, chỗ xe ẩn / chìa / nối. Trả số xe. */
export function shuffleColors(raw, rand = Math.random) {
  ensure(raw);
  const slots = [];
  for (const s of raw.pf.sd) for (const e of s.se) if (e?.c) slots.push([e, 'c']);
  for (const u of raw.ui.u) if (u.co && !special(u)) slots.push([u, 'co']);
  const colors = slots.map(([o, k]) => o[k]);
  for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
  slots.forEach(([o, k], i) => { o[k] = colors[i]; });
  return slots.length;
}

/** Số xe mỗi màu (chữ CODES) trong làn + bãi, để Editor báo màu không chia hết. */
export function colorCounts(raw) {
  const out = new Map();
  const add = c => { const ch = CODES[c - 1]; if (ch) out.set(ch, (out.get(ch) || 0) + 1); };
  for (const s of raw?.pf?.sd || []) for (const e of s.se || []) if (e?.c) add(e.c);
  for (const u of raw?.ui?.u || []) if (u.co && !special(u)) add(u.co);
  return out;
}
