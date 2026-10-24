// Module web của __TOOL__ cho vỏ app level-tool-core (levelcore/web/js/main.mjs). Mọi trường: levelcore/README.md
// mục "Plugin web". Ví dụ đầy đủ: HoleLevel game/web/game.mjs (form levelConfig, bảng target, prop trên map).
import { blankLevel, validateLevel } from './schema.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default {
  toolName: '__TOOL__',
  subtitle: 'Quản lý & chỉnh sửa level __GAME__',
  envPrefix: '__PREFIX__',
  storagePrefix: '__STORAGE__',        // khoá localStorage (<prefix>.token, .pack, .theme…)
  versionPrefix: '__SLUG__-',          // tag phát hành trên BI Center (__SLUG__-v0.1.0 → hiện v0.1.0)
  webgame: {                           // bản WebGL playtest trong <iframe> (giao thức: levelcore/web/js/webgame.mjs)
    id: '__STORAGE__-game',
    tag: '__PREFIX__',
    title: '__GAME__ — xem / chơi level',
    buildHint: 'Build bản WebGL playtest của game thành zip',
  },

  validateLevel,
  blankLevel,
  visualKey: lv => JSON.stringify(lv),   // đổi giá trị này thì khung game dựng lại level

  listFilters: [],                        // [{value, label}] thêm vào ô lọc danh sách
  matchFilter: (summary, value) => false,
  searchText: summary => '',
  listItem: s => ({ tags: `<span class="badge">${esc(s.keys)} khoá</span>`, sub: '' }),

  /** Tab Tổng quan: vẽ cột trái (ctx.form) + phần dưới cột phải (ctx.info). Sửa ctx.level tại chỗ rồi gọi ctx.changed(). */
  renderOverview(ctx) {
    ctx.form.innerHTML = `<section class="card"><h3>Level</h3><p class="muted small">Chưa có form riêng — sửa ở tab JSON.</p></section>`;
    ctx.info.innerHTML = '';
  },
};
