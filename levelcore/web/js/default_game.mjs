// game.mjs mặc định của game khai bằng manifest: server phục vụ file này ở /app/game/game.mjs khi thư mục web của game
// không có game.mjs riêng, nên repo game không phải giữ bản sao code giao diện nào. Tên, tiền tố, giao thức khung game
// lấy từ manifest (/app/game/manifest.json); luật và `fields` (nếu có) lấy từ module luật (/app/game/rules.mjs).
// Danh sách level hiện `levelSummary` của game dạng "khoá giá trị".
import * as rules from './rules.mjs';

const manifest = await (await fetch(new URL('./manifest.json', import.meta.url))).json();
const storagePrefix = manifest.storagePrefix || manifest.prefix.toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const summaryText = s => Object.entries(s || {}).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(' · ');

export default {
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
  searchText: summary => summaryText(summary),
  listItem: summary => ({ tags: '', sub: esc(summaryText(summary)) }),
};
