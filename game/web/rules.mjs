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

/** Ảnh nhỏ cho lưới level: làn ở trên, bãi ở dưới. */
export function thumbnail(level) {
  const { level: lv } = tryConvert(level);
  if (!lv) return '';
  const W = lv.grid[0].length, H = lv.grid.length, cols = lv.lot.length;
  const depth = Math.min(8, Math.max(1, ...lv.lot.map(s => s.length)));
  const c = 10, gap = 2, w = Math.max(W, cols) * (c + gap) + 8, h = (H + depth) * (c + gap) + 20;
  const hex = ch => COLOR_HEX[CODES.indexOf(ch.toUpperCase()) + 1] || COLOR_HEX[0];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="4" fill="#7d84c7"/>`;
  const ox = (w - W * (c + gap)) / 2;
  s += `<rect x="${ox - 3}" y="2" width="${W * (c + gap) + 4}" height="${H * (c + gap) + 4}" rx="3" fill="#5c62a8"/>`;
  lv.grid.forEach((row, y) => [...row].forEach((ch, x) => {
    const covered = lv.locks.some(k => k.col === x) || lv.iceLanes.some(k => k.col === x) || lv.curtains.some(k => k.col === x);
    s += `<rect x="${ox + x * (c + gap)}" y="${4 + y * (c + gap)}" width="${c}" height="${c}" rx="2" fill="${ch === '.' ? '#4a4f93' : ch !== ch.toUpperCase() || covered ? '#9a9fb8' : hex(ch)}"/>`;
  }));
  const lx = (w - cols * (c + gap)) / 2, ly = H * (c + gap) + 14;
  const special = new Map(lv.lotUnits.map(u => [`${u.col},${u.i}`, u]));
  lv.lot.forEach((col, x) => [...col].slice(0, depth).forEach((ch, i) => {
    const u = special.get(`${x},${i}`);
    const fill = u?.box ? '#c8a050' : u?.gen ? '#2d3046' : ch !== ch.toUpperCase() ? '#9a9fb8' : hex(ch);
    s += `<rect x="${lx + x * (c + gap)}" y="${ly + i * (c + gap)}" width="${c}" height="${c}" rx="2" fill="${fill}"/>`;
  }));
  return `${s}</svg>`;
}
