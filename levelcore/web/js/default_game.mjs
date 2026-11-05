// game.mjs mặc định của game khai bằng manifest: server phục vụ file này ở /app/game/game.mjs khi thư mục web của game
// không có game.mjs riêng, nên repo game không phải giữ bản sao code giao diện nào. Tên, tiền tố, giao thức khung game
// lấy từ manifest (/app/game/manifest.json); luật và `fields` (nếu có) lấy từ module luật (/app/game/rules.mjs).
// Danh sách level hiện `levelSummary` của game dạng "khoá giá trị". Hook giao diện của game (editor riêng, chip ở thẻ
// Thư viện, bố cục mặc định…) đặt ở game/web/ui.mjs (export default {...}); không có thì server trả một object rỗng.
import * as rules from './rules.mjs';
import ui from './ui.mjs';

const manifest = await (await fetch(new URL('./manifest.json', import.meta.url))).json();
const storagePrefix = manifest.storagePrefix || manifest.prefix.toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const summaryText = s => Object.entries(s || {}).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(' · ');

const base = {
  toolName: manifest.tool,
  subtitle: manifest.subtitle || `Level ${manifest.game}`,
  envPrefix: manifest.prefix,
  storagePrefix,
  versionPrefix: manifest.slug ? `${manifest.slug}-` : '',
  webgame: {
    id: `${storagePrefix}-game`, tag: manifest.prefix, title: `${manifest.game} — xem / chơi level`,
    buildHint: 'Build bản WebGL của game thành zip', ...(manifest.webgame || {}),
  },
  validateLevel: rules.validateLevel,
  blankLevel: rules.blankLevel,
  fields: rules.fields || [],
  thumbnail: rules.thumbnail || null,
  overview: manifest.overview || {},
  levelhub: manifest.levelhub || {},
  listView: manifest.listView || 'list',
  searchText: summary => summaryText(summary),
  listItem: summary => ({ tags: '', sub: summaryText(summary) }),
};

export default {
  ...base, ...ui,
  webgame: { ...base.webgame, ...(ui.webgame || {}) },
  layout: { ...(manifest.layout || {}), ...(ui.layout || {}) },
};
