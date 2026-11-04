// Khung changelog (mục 6 của docs/KE-HOACH-CORE.md) dùng chung cho bảng "Có gì mới" của tool (game/web/releases.json,
// người đọc là GD) và levelcore/CHANGELOG.md (người đọc là Dev Game): kiểm khung, đọc markdown, dựng message của tag.
// Module thuần: chạy được trong trình duyệt, Node (levelcore/tools/releases.mjs) và test.

export const SECTIONS = [
  ['notice', 'Cần chú ý'], ['added', 'Mới'], ['changed', 'Thay đổi'], ['fixed', 'Sửa lỗi'], ['dev', 'Cho Dev'],
];
const KEYS = SECTIONS.map(([k]) => k);
const LABELS = Object.fromEntries(SECTIONS);
const MAX_TITLE = 60;
const MAX_LINE = 120;
const MAX_LINES = 5;
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Phần cho GD không nhắc tên file, route, hàm hay biến môi trường.
const DEV_WORDS = /`|\/api\/|\.(mjs|js|py|json|cs)\b|\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/;

const len = s => [...String(s)].length;

/**
 * Lỗi khung của danh sách entry (mới nhất trước). audience 'gd': phần cho GD không được có tên file, route, biến.
 * Entry mới nhất được để trống `date` (chưa phát hành); các entry khác phải có ngày dd/MM/yyyy.
 */
export function checkReleases(entries, { audience = 'gd' } = {}) {
  const problems = [];
  if (!Array.isArray(entries)) return ['Dữ liệu phải là mảng entry, mới nhất trước'];
  entries.forEach((e, i) => {
    const at = `${e?.version || `entry ${i + 1}`}`;
    if (!e || typeof e !== 'object') return problems.push(`${at}: entry phải là object`);
    if (!VERSION_RE.test(String(e.version || ''))) problems.push(`${at}: version phải dạng X.Y.Z`);
    if (!(DATE_RE.test(String(e.date || '')) || (i === 0 && !e.date))) problems.push(`${at}: date phải dạng dd/MM/yyyy (chỉ entry mới nhất được để trống)`);
    if (!e.title || len(e.title) > MAX_TITLE) problems.push(`${at}: title bắt buộc, tối đa ${MAX_TITLE} ký tự`);
    const order = Object.keys(e).filter(k => KEYS.includes(k));
    if (order.join() !== KEYS.filter(k => order.includes(k)).join()) problems.push(`${at}: các phần phải theo thứ tự ${SECTIONS.map(([, l]) => l).join(', ')}`);
    for (const k of Object.keys(e)) if (!['version', 'date', 'title', ...KEYS].includes(k)) problems.push(`${at}: trường lạ "${k}"`);
    let lines = 0;
    for (const k of KEYS) {
      const list = e[k];
      if (list == null) continue;
      if (!Array.isArray(list) || !list.every(x => typeof x === 'string' && x.trim())) {
        problems.push(`${at} ▸ ${LABELS[k]}: phải là mảng câu`);
        continue;
      }
      lines += list.length;
      if (list.length > MAX_LINES) problems.push(`${at} ▸ ${LABELS[k]}: ${list.length} dòng, tối đa ${MAX_LINES} — gộp theo tính năng`);
      for (const line of list) {
        if (len(line) > MAX_LINE) problems.push(`${at} ▸ ${LABELS[k]}: dòng dài ${len(line)} ký tự (tối đa ${MAX_LINE}): ${line.slice(0, 40)}…`);
        if (audience === 'gd' && k !== 'dev' && DEV_WORDS.test(line)) problems.push(`${at} ▸ ${LABELS[k]}: phần cho GD có tên file / route / biến — chuyển sang Cho Dev: ${line.slice(0, 40)}…`);
      }
    }
    if (!lines) problems.push(`${at}: entry không có dòng nào`);
  });
  const versions = entries.map(e => String(e?.version || ''));
  if (new Set(versions).size !== versions.length) problems.push('Có version lặp lại');
  return problems;
}

/** levelcore/CHANGELOG.md → entry. Tiêu đề entry: `## <version> · <dd/MM/yyyy | chưa phát hành> · <tiêu đề>`. */
export function parseMarkdown(text) {
  const byLabel = Object.fromEntries(SECTIONS.map(([k, l]) => [l.toLowerCase(), k]));
  const entries = [];
  let entry = null, key = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = /^## (.+)$/.exec(line);
    if (head) {
      const [version, date, ...title] = head[1].split(' · ');
      entry = { version: version.trim(), date: DATE_RE.test(date?.trim() || '') ? date.trim() : '', title: title.join(' · ').trim() };
      entries.push(entry);
      key = null;
      continue;
    }
    const section = /^### (.+)$/.exec(line);
    if (section && entry) {
      key = byLabel[section[1].trim().toLowerCase()] || `?${section[1].trim()}`;
      entry[key] = [];
      continue;
    }
    if (line.startsWith('- ') && entry && key) entry[key].push(line.slice(2));
  }
  return entries;
}

/** Message của tag = chính entry, dạng text theo đúng thứ tự phần (kể cả Cho Dev). */
export function tagMessage(entry) {
  const out = [`${entry.version}${entry.date ? ` · ${entry.date}` : ''} · ${entry.title}`];
  for (const [k, label] of SECTIONS) {
    if (!entry[k]?.length) continue;
    out.push('', label, ...entry[k].map(x => `- ${x}`));
  }
  return out.join('\n');
}

/** Phần cho GD (bỏ Cho Dev) — bảng Có gì mới trong app. */
export const visibleSections = entry => SECTIONS.filter(([k]) => k !== 'dev' && entry[k]?.length);
