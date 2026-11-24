// Luật level của Parking Loop: server (Node) và trình duyệt cùng dùng file này, nên chỉ là JS thuần (không DOM, không node:*).
// Hook: levelcore/contracts/README.md, mục "Module luật". Raw = Assets/_Game/Levels/Level_NNNN[_v].json của bản Unity,
// tool lưu nguyên raw đó (tên level trong tool = NNNN, biến thể = bộ). Luật port ở format.mjs / model.mjs / solver.mjs.
import { CODES, COLOR_HEX, DEFAULT_LOOP, DIFFICULTY, OBSTACLE_NAMES, colorOf, lotOrder, normalize, tryConvert, validateModel, whyImpossible } from './format.mjs';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateLevel(level, { levelNo } = {}) {
  const errors = [], warnings = [];
  if (!isObj(level)) return { isValid: false, errors: ['Level phải là JSON object'], warnings };
  if (!isObj(level.pf)) errors.push('thiếu pf (bàn chơi)');
  else if (!Array.isArray(level.pf.sd) || !level.pf.sd.length) errors.push('pf.sd phải có ít nhất một làn');
  if (!isObj(level.ui) || !Array.isArray(level.ui.u)) errors.push('thiếu ui.u (xe trong bãi)');
  if (errors.length) return { isValid: false, errors, warnings };
  const n = normalize(level);
  if (n.pf.cp < 1) errors.push('pf.cp (chiều cao làn) phải ≥ 1');
  if (Number.isInteger(levelNo) && levelNo > 0 && Number.isInteger(level.li) && level.li !== levelNo) warnings.push(`li = ${level.li} khác số level ${levelNo}`);
  const seen = new Map();
  n.ui.u.forEach(u => {
    const k = `${u.p.x},${u.p.y}`;
    if (seen.has(k)) errors.push(`bãi: hai xe cùng ô (${k})`);
    seen.set(k, true);
  });
  n.ui.u.forEach(u => { if (u.cn.x >= 0 && u.cn.y >= 0 && !seen.has(`${u.cn.x},${u.cn.y}`)) warnings.push(`bãi (${u.p.x},${u.p.y}): nối tới ô trống (${u.cn.x},${u.cn.y})`); });
  const { level: lv, notes, error } = tryConvert(level);
  if (!lv) return { isValid: false, errors: [...errors, error], warnings };
  const v = validateModel(lv);
  errors.push(...v.errors);
  const why = whyImpossible(lv);
  if (why) warnings.push(`không xoá hết được: ${why}`);
  warnings.push(...v.warnings, ...notes);
  return { isValid: errors.length === 0, errors, warnings };
}

/** Level mới: 3 làn cao 3, bãi 2 cột (đủ để chơi thử ngay). Nhân bản: chép template, ghi số mới. */
export function blankLevel(n, template = null) {
  if (template) return setLevelNumber(structuredClone(template), n);
  return {
    li: n, lt: 0,
    pf: { cp: 3, sd: [{ se: [] }, { p: { x: 1, y: 0 }, se: [] }, { p: { x: 2, y: 0 }, se: [] }], ic: false },
    ui: {
      u: [
        { co: 1, p: { x: 0, y: 2 } }, { co: 15, p: { x: 0, y: 1 } }, { co: 1, p: { x: 0, y: 0 } },
        { co: 15, p: { x: 1, y: 2 } }, { co: 1, p: { x: 1, y: 1 } }, { co: 15, p: { x: 1, y: 0 } },
      ],
      c: [{}, { o: 1 }],
    },
  };
}

export function setLevelNumber(level, n) {
  if (isObj(level)) level.li = n;
  return level;
}

const diffName = ld => (DIFFICULTY.find(([v]) => v === ld) || [ld, String(ld)])[1];

/** Cơ chế có trong level (tên ngắn, dùng ở danh sách và Level Hub). */
export function mechanicsOf(level) {
  const n = normalize(level), m = new Set();
  for (const s of n.pf.sd) {
    for (const o of s.sot) if (OBSTACLE_NAMES[o]) m.add(OBSTACLE_NAMES[o]);
    if (s.t === 1 || s.lc) m.add('Lock');
    if (s.elv.length) m.add('Elevator');
    if (s.cd.v > 0) m.add('Curtain');
    if (s.se.some(e => e.k)) m.add('Key');
    if (s.se.some(e => e.h)) m.add('Hidden');
  }
  for (const u of n.ui.u) {
    if (u.l) m.add('LockBox');
    if (u.sg > 0) m.add('Generator');
    if (u.cn.x >= 0 && u.cn.y >= 0) m.add('Link');
    if (u.h && !u.l) m.add('Hidden');
    if (u.gc > 0) m.add('Ghost');
  }
  if (n.pf.ic) m.add('Crossway');
  return [...m];
}

function counts(level) {
  const n = normalize(level), colors = new Map();
  let lane = 0, lot = 0;
  const add = c => { if (c) colors.set(c, (colors.get(c) || 0) + 1); };
  for (const s of n.pf.sd) {
    for (const e of s.se.slice(0, Math.max(1, n.pf.cp))) if (e.c) { add(e.c); lane++; }
    for (const l of s.elv) for (const e of l.se) if (e.c) { add(e.c); lane++; }
  }
  for (const u of n.ui.u) if (!u.l && !(u.sg > 0) && u.co) { add(u.co); lot++; }
  return { n, colors, lane, lot };
}

export function levelSummary(level) {
  if (!isObj(level)) return {};
  const { n, colors, lane, lot } = counts(level);
  return {
    variant: n.level_ab_variant || 'a', diff: diffName(n.ld), lanes: n.pf.sd.length, cp: n.pf.cp,
    loop: n.pf.tl > 0 ? n.pf.tl : DEFAULT_LOOP, cols: lotOrder(n).length, cars: lane + lot, colors: colors.size,
    time: n.lt, mech: mechanicsOf(level).join(' '),
  };
}

export function levelChanges(prev, cur) {
  if (!isObj(prev) || !isObj(cur)) return null;
  const a = normalize(prev), b = normalize(cur), out = [];
  const cmp = (label, x, y) => { if (x !== y) out.push(`${label}: ${x} → ${y}`); };
  cmp('Độ khó', diffName(a.ld), diffName(b.ld));
  cmp('Thời gian', a.lt, b.lt);
  cmp('Chiều cao làn', a.pf.cp, b.pf.cp);
  cmp('Sức chứa vòng', a.pf.tl || DEFAULT_LOOP, b.pf.tl || DEFAULT_LOOP);
  cmp('Số làn', a.pf.sd.length, b.pf.sd.length);
  cmp('Biến thể', a.level_ab_variant || 'a', b.level_ab_variant || 'a');
  const lane = s => s.se.map(e => colorOf(e.c) + (e.h ? '?' : '') + (e.k ? '*' : '')).join('') + (s.sot.length ? ` [${s.sot.map(o => OBSTACLE_NAMES[o] || o).join(',')}]` : '') + (s.lc ? ` lock ${colorOf(s.lc)}` : '') + (s.ic ? ` ice ${s.ic}` : '');
  for (let i = 0; i < Math.min(a.pf.sd.length, b.pf.sd.length); i++) cmp(`Làn ${i + 1}`, lane(a.pf.sd[i]), lane(b.pf.sd[i]));
  const lot = n => lotOrder(n).map(g => g.units.map(i => { const u = n.ui.u[i]; return u.l ? '#' : u.sg > 0 ? '@' : colorOf(u.co) + (u.h ? '?' : ''); }).join(''));
  const la = lot(a), lb = lot(b);
  for (let i = 0; i < Math.max(la.length, lb.length); i++) cmp(`Bãi cột ${i + 1}`, la[i] ?? '—', lb[i] ?? '—');
  if (!out.length && JSON.stringify(prev) !== JSON.stringify(cur)) out.push('Sửa chi tiết khác (xem JSON)');
  return out;
}

export const fields = [
  { path: 'level_ab_variant', label: 'Biến thể A/B', type: 'text', hint: 'a = file Level_NNNN.json; x, y… = Level_NNNN_x.json' },
  { path: 'ld', label: 'Độ khó', type: 'select', options: DIFFICULTY.map(([value, label]) => ({ value, label })) },
  { path: 'lt', label: 'Thời gian (giây)', type: 'number', min: 0, step: 1, hint: '0 = không giới hạn' },
  { path: 'pf.cp', label: 'Chiều cao làn (cp)', type: 'number', min: 1, max: 12, step: 1 },
  { path: 'pf.tl', label: 'Sức chứa vòng (tl)', type: 'number', min: 0, max: 60, step: 1, hint: `0 = mặc định ${DEFAULT_LOOP}` },
  { path: 'ur', label: 'ur', type: 'bool' },
  { path: 'pf.ic', label: 'Crossway (ic)', type: 'bool' },
];

export function describeHub(level) {
  const { n, colors, lane, lot } = counts(level);
  const obstacleCounts = {};
  for (const m of mechanicsOf(level)) obstacleCounts[m] = 0;
  for (const s of n.pf.sd) for (const o of s.sot) if (OBSTACLE_NAMES[o]) obstacleCounts[OBSTACLE_NAMES[o]]++;
  for (const u of n.ui.u) { if (u.l) obstacleCounts.LockBox++; if (u.sg > 0) obstacleCounts.Generator++; }
  return {
    mechanics: mechanicsOf(level).join(', '), difficulty: n.ld, uniqueColor: colors.size, totalBlock: lane + lot,
    time: n.lt, obstacleCounts,
  };
}

export function hubLayout(level) {
  const n = normalize(level);
  return `${n.pf.sd.length}x${n.pf.cp}`;
}

/**
 * Ảnh nhỏ cho lưới level, bố cục như màn chơi của game: đường vòng (viền sáng, vạch giữa) quanh các làn, bãi giữa hai
 * bãi cỏ ở dưới, xe nhìn từ trên (màu ParkingPalette.cs). Trên trình duyệt, ui.mjs thay ảnh này bằng ảnh vẽ đúng như
 * màn Chơi thử (globalThis.parkingThumb) khi đã vẽ xong.
 */
export function thumbnail(level) {
  const { level: lv } = tryConvert(level);
  if (!lv) return '';
  const svg = thumbSvg(lv);
  return typeof globalThis.parkingThumb === 'function' ? globalThis.parkingThumb(level, svg) : svg;
}

const THUMB_COLORS = {
  R: '#e4100c', Y: '#f9b80a', T: '#00c4cf', L: '#3aa6ff', G: '#0ac80a', N: '#7a4419', V: '#a27ee8', P: '#ff5fb2',
  O: '#ff7608', K: '#454952', U: '#7a22d0', M: '#d8128a', W: '#f4f5fb', C: '#f3e3b5', B: '#2f6cf0',
};

function thumbSvg(lv) {
  const W = lv.grid[0].length, H = lv.grid.length, cols = lv.lot.length;
  const depth = Math.min(5, Math.max(1, ...lv.lot.map(s => s.length)));
  const c = 12, jc = 1.05;
  const lotL = (W - 1) / 2 - cols * jc / 2, lotTop = -3.74;
  const x0 = Math.min(-1.7, lotL - 0.6), x1 = Math.max(W + 0.7, lotL + cols * jc + 0.6), z1 = H + 0.7, z0 = lotTop - depth * jc - 0.2;
  const X = x => ((x - x0) * c).toFixed(1), Z = z => ((z1 - z) * c).toFixed(1), n = v => (v * c).toFixed(1);
  const w = (x1 - x0) * c, h = (z1 - z0) * c;
  const col = ch => THUMB_COLORS[ch.toUpperCase()] || '#9a9fb8';
  const car = (x, z, fill, up) => {
    const cx = (x - x0) * c, cy = (z1 - z) * c, bw = 0.62 * c, bl = 0.84 * c, wz = (up ? -0.16 : 0.16) * c;
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(cy - bl / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bl.toFixed(1)}" rx="${(bw * 0.38).toFixed(1)}" fill="${fill}"/>`
      + `<rect x="${(cx - bw * 0.32).toFixed(1)}" y="${(cy + wz - c * 0.09).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${n(0.18)}" rx="1.5" fill="#1f2a3d"/>`
      + `<rect x="${(cx - bw * 0.22).toFixed(1)}" y="${(cy - wz * 0.6 - c * 0.1).toFixed(1)}" width="${(bw * 0.44).toFixed(1)}" height="${n(0.2)}" rx="1.5" fill="#fff" opacity=".28"/>`;
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}"><rect width="100%" height="100%" fill="#7d84c7"/>`;
  // cỏ hai bên bãi (viền đá ở mép trong và mép trên)
  const lotR = lotL + cols * jc;
  s += `<rect x="${X(x0 - 1)}" y="${Z(lotTop + 0.02)}" width="${n(lotL - x0 + 1)}" height="${h.toFixed(1)}" rx="${n(0.5)}" fill="#d9d4c4"/>`;
  s += `<rect x="${X(x0 - 1)}" y="${Z(lotTop - 0.1)}" width="${n(lotL - x0 + 1 - 0.12)}" height="${h.toFixed(1)}" rx="${n(0.4)}" fill="#7cc243"/>`;
  s += `<rect x="${X(lotR)}" y="${Z(lotTop + 0.02)}" width="${n(x1 - lotR + 1)}" height="${h.toFixed(1)}" rx="${n(0.5)}" fill="#d9d4c4"/>`;
  s += `<rect x="${X(lotR + 0.12)}" y="${Z(lotTop - 0.1)}" width="${n(x1 - lotR + 1)}" height="${h.toFixed(1)}" rx="${n(0.4)}" fill="#7cc243"/>`;
  for (let x = 1; x < cols; x++) s += `<rect x="${X(lotL + x * jc - 0.02)}" y="${Z(lotTop)}" width="${n(0.035)}" height="${h.toFixed(1)}" fill="#b6b8ce"/>`;
  // đường vòng qua tâm các trạm, góc bo 0.9, mở ở cổng
  const rx = X(-1), ry = Z(H), rw = n(W + 1), rh = n(H + 1), r = n(0.9);
  s += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r}" fill="none" stroke="#dcdcf7" stroke-width="${n(1.15)}"/>`;
  s += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r}" fill="none" stroke="#5d62a6" stroke-width="${n(0.75)}"/>`;
  s += `<rect x="${X((W - 1) / 2 - 0.55)}" y="${Z(-1 - 0.2)}" width="${n(1.1)}" height="${n(0.42)}" fill="#5d62a6"/>`;
  s += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${r}" fill="none" stroke="#d6d9f2" stroke-width="${n(0.06)}" stroke-dasharray="${n(0.24)} ${n(0.36)}"/>`;
  for (let x = 1; x < W; x++) s += `<rect x="${X(x - 0.52)}" y="${Z(H - 0.25)}" width="${n(0.035)}" height="${n(H - 0.5)}" fill="#b9bde3"/>`;
  // xe trong làn (mũi xuống), vật cản phủ làn
  const cover = x => lv.locks.find(k => k.col === x) || lv.iceLanes.find(k => k.col === x) || lv.curtains.find(k => k.col === x);
  lv.grid.forEach((row, gy) => [...row].forEach((ch, x) => {
    if (ch !== '.') s += car(x, H - 1 - gy, ch !== ch.toUpperCase() || cover(x) ? '#cfd2e6' : col(ch), false);
  }));
  for (let x = 0; x < W; x++) {
    const k = cover(x);
    if (!k) continue;
    const ice = lv.iceLanes.includes(k), cur = lv.curtains.includes(k);
    s += `<rect x="${X(x - 0.45)}" y="${Z(H - 0.45)}" width="${n(0.9)}" height="${n(H - 0.1)}" rx="3" fill="${ice ? '#dff3ff' : cur ? '#f3e7d2' : k.color ? col(k.color) : '#2d3046'}" opacity="${ice ? 0.7 : 0.85}"/>`;
  }
  for (const k of lv.only || []) for (const d of [-0.4, 0.4]) s += `<rect x="${X(k.col + d - 0.03)}" y="${Z(H - 0.4)}" width="${n(0.06)}" height="${n(H - 0.2)}" fill="${col(k.c)}"/>`;
  // bãi (mũi lên)
  const special = new Map(lv.lotUnits.map(u => [`${u.col},${u.i}`, u]));
  lv.lot.forEach((line, x) => [...line].slice(0, depth).forEach((ch, i) => {
    const u = special.get(`${x},${i}`), cx = lotL + (x + 0.5) * jc, cz = lotTop - (i + 0.5) * jc;
    if (u?.box) s += `<rect x="${X(cx - 0.42)}" y="${Z(cz + 0.45)}" width="${n(0.84)}" height="${n(0.9)}" rx="2" fill="#a8774b"/><circle cx="${X(cx)}" cy="${Z(cz)}" r="${n(0.18)}" fill="#ffcc33"/>`;
    else if (u?.gen) s += `<rect x="${X(cx - 0.45)}" y="${Z(cz + 0.47)}" width="${n(0.9)}" height="${n(0.94)}" rx="2" fill="#7582d4"/>`;
    else s += car(cx, cz, ch !== ch.toUpperCase() ? '#cfd2e6' : col(ch), true);
  }));
  return `${s}</svg>`;
}
