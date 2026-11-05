export const NAME_LABELS = ['Game', 'OS', 'Từ', 'Đến', 'GEO', 'Why', 'Designer', 'Ngày', 'Ver'];
export const today = (date = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(date).replace('/', '');
export const normalizeVersion = value => `v${String(value).replace(/[^A-Za-z0-9]/g, '').replace(/^[vV]+/, '') || '1'}`;
const clean = value => String(value ?? '').replace(/[^A-Za-z0-9]/g, '');

export function nameParts(game, body) {
  return [clean(game), body.os === 'iOS' ? 'I' : 'A', body.from_lv, body.to_lv,
    body.geo.map(clean).filter(Boolean).join('-'), clean(body.why), clean(body.designer.split('@')[0]), body.date || today(), normalizeVersion(body.version)];
}

export function nameProblems(game, body) {
  const parts = nameParts(game, body);
  const problems = new Map();
  for (const i of [0, 4, 5, 6]) if (!parts[i]) problems.set(i, `${NAME_LABELS[i]} trống`);
  for (const [i, value] of [[4, body.geo.join('-')], [5, body.why], [6, body.designer]]) {
    if (value && !/^[A-Za-z0-9-]+$/.test(value)) problems.set(i, `${NAME_LABELS[i]} chỉ dùng chữ không dấu, số hoặc dấu -`);
  }
  if (!Number.isSafeInteger(body.from_lv) || body.from_lv < 1) problems.set(2, 'Số đầu phải là số nguyên ≥ 1');
  if (!Number.isSafeInteger(body.to_lv) || body.to_lv < body.from_lv || body.to_lv - body.from_lv >= 20000) problems.set(3, 'Dải phải tăng dần, tối đa 20000 level');
  if (!/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])$/.test(body.date)) problems.set(7, 'Ngày phải dạng ddMM');
  if (!/^[vV]\d{1,8}$/.test(body.version)) problems.set(8, 'Version dạng v1, v02…');
  return problems;
}

export function selectedReport(report, from, to) {
  const rows = report.rows.filter(x => x.level >= from && x.level <= to);
  const inside = x => x.level >= from && x.level <= to;
  const groups = new Map();
  for (const row of rows) groups.set(row.difficulty, (groups.get(row.difficulty) || 0) + 1);
  const present = new Set(rows.map(x => x.level));
  const missing = [];
  if (Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 1 && to >= from && to - from < 20000) {
    for (let n = from; n <= to; n++) if (!present.has(n)) missing.push(n);
  }
  return { rows, groups, errors: report.errors.filter(inside), warnings: (report.warnings || []).filter(inside),
    previewCount: rows.filter(x => x.preview).length, missing };
}

export function pointerLevel(rows, x, width) {
  if (!rows.length || width <= 0) return null;
  return rows[Math.max(0, Math.min(rows.length - 1, Math.floor(x / width * rows.length)))].level;
}
