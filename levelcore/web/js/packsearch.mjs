// Ô chọn bộ: tóm tắt một dòng cho mỗi bộ (local, Level Hub đã mở, Level Hub chưa mở) và tìm theo mọi thông tin đó.
import { fold } from './query.mjs';

const PLATFORM_LABEL = { android: 'Android', ios: 'iOS', both: 'Android + iOS' };
const OS_LABEL = { a: 'Android', android: 'Android', i: 'iOS', ios: 'iOS' };

/** Tên bộ Level Hub theo quy ước Game_OS_từ_đến_Vùng_MụcĐích_Người_ddMM_vN; null nếu không theo quy ước. */
export function parseHubName(name) {
  const m = /^([^_]+)_([^_]+)_(\d+)_(\d+)_([^_]*)(?:_(.*))?$/.exec(String(name ?? ''));
  if (!m) return null;
  const rest = (m[6] ?? '').split('_').filter(Boolean);
  const version = /^v\d+$/i.test(rest.at(-1) ?? '') ? rest.pop() : null;
  const date = /^\d{4}$/.test(rest.at(-1) ?? '') ? rest.pop() : null;
  const designer = rest.length > 1 ? rest.pop() : null;
  return {
    game: m[1], os: OS_LABEL[m[2].toLowerCase()] ?? m[2], from: Number(m[3]), to: Number(m[4]),
    geo: m[5] || null, why: rest.join('_') || null, designer, date, version,
  };
}

const hubFacts = hub => (hub ? [hub.geo, `Level ${hub.from}–${hub.to}`, hub.why, hub.designer, hub.version].filter(Boolean) : []);

/** Bộ của tool. hub: bộ mở từ Level Hub. */
export function packEntry(p, { hub = false } = {}) {
  const parsed = hub ? parseHubName(p.name) : null;
  const facts = [
    p.archived ? 'Lưu trữ' : p.production ? 'Production' : 'Nháp',
    parsed?.os ?? PLATFORM_LABEL[p.platform] ?? p.platform,
    `${p.level_count ?? 0} level`,
    ...hubFacts(parsed),
    hub ? 'Level Hub' : 'Local',
    p.group && !hub ? `Nhóm ${p.group}` : null,
  ].filter(Boolean);
  const note = hub ? String(p.description || '').replace(/^levelhub:\S+\s*/, '') : p.description;
  return {
    value: p.name, title: p.name, facts, note: note || '', icon: p.production ? '🔒' : p.archived ? '🗄' : '',
    hay: fold([p.name, p.group, p.description, p.created_by, ...facts].filter(Boolean).join(' ')),
  };
}

/** Bộ trên Level Hub chưa mở trong tool: bấm vào là tải về thành bộ. */
export function remoteEntry({ id, name, os, status }) {
  const parsed = parseHubName(name);
  const facts = ['Chưa mở', os || parsed?.os, status, ...hubFacts(parsed), 'Level Hub'].filter(Boolean);
  return { value: `hub:${id}`, title: name, facts, note: '', icon: '⇩', hay: fold([name, id, ...facts].join(' ')) };
}

export function entryMatches(entry, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.every(word => entry.hay.includes(word));
}

/** Link mở thẳng bộ `name` trên trang `href` (giữ các tham số khác). */
export function packLink(href, name) {
  const url = new URL(href);
  url.hash = '';
  url.searchParams.set('pack', name);
  return url.toString();
}
