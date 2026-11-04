// Vỏ app web của level-tool-core (chung mọi game; phần riêng của game ở ../game/game.mjs — xem levelcore/README.md).
// Bố cục như Sand Jam / AntLevel: các màn Level (danh sách → level đang mở: Tổng quan / JSON / Lịch sử), Thư viện (lưới
// ảnh), Thứ tự, Tổng quan bộ, Hoạt động; bộ đang mở chung cho mọi màn. Khoá khi sửa, lưu theo If-Match (412 → so sánh),
// realtime qua SSE, nhập / xuất zip, kiểm định cả bộ, promote sang bộ production, xuất Level Hub.
import { api, ApiError, devUser, downloadBlob, downloadResponse, session, setStoragePrefix } from './api.mjs';
import { biSessionLogin } from './biauth.mjs';
import {
  groupId, groupName, hubIdOf, hubOptionText, listHubGroups, openLevelHubBrowser, syncHubPack, uploadToBi,
} from './levelhub_bi.mjs';
import { diffPaths, renderFields } from './fields.mjs';
import { parseLevelQuery, queryMatches } from './query.mjs';
import { $, $$, confirmDialog, esc, fmtTime, openDialog, shortUser, toast } from './ui.mjs';
import {
  currentBuild, highlight as gameHighlight, isPreviewing, isShowing, mountDock, onBuildEvent, openBuilds, refreshPreview, showLevel,
} from './webgame.mjs';
import * as sync from './sync.mjs';
import { mountWhatsNew, openWhatsNew } from './whatsnew.mjs';
import { mountActivity } from './activity.mjs';
import { openAdmin } from './adminui.mjs';
import { actionFor, bridgeMouseButtons, configureKeymap, openShortcuts, shortLabel } from './keymap.mjs';
import { configureLayout, layout, onLayout, openLayout, setLayout, wireGrips } from './layout.mjs';
import { checkState, mountLibrary } from './library.mjs';
import { mountOverview } from './overview.mjs';
import { openPalette } from './palette.mjs';
import { renderPlays } from './playsview.mjs';
import { mountOrder } from './reorder.mjs';
import { openShare } from './share.mjs';
import { openTrash } from './trash.mjs';
import game from '../game/game.mjs';

setStoragePrefix(game.storagePrefix);
const PACK_KEY = `${game.storagePrefix}.pack`;
const VIEW_KEY = `${game.storagePrefix}.view`;
const NOTICE_KEY = `${game.storagePrefix}.noticeSeen`;
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, v) => { try { localStorage.setItem(key, v); } catch { /* trình duyệt chặn lưu trữ */ } };
const THEME_KEY = `${game.storagePrefix}.theme`;
const VIEWS = ['level', 'library', 'order', 'overview', 'activity'];

const state = {
  me: null,
  packs: [],
  pack: null,
  levels: [],
  deleted: [],
  invalid: new Map(),   // name -> lỗi, sau lần kiểm định cả bộ gần nhất (state.checked)
  warned: new Map(),    // name -> cảnh báo
  checked: null,        // {pack, at}: bộ đã kiểm định lúc nào
  view: 'level',
  sel: null,            // tên level đang mở
  cur: null,            // bản trên server {rev, level, author, ...}
  draft: null,          // bản đang sửa
  dirty: false,
  editing: false,       // đang giữ khoá
  tab: 'overview',
  hover: null,
  highlight: null,
};

const clone = o => JSON.parse(JSON.stringify(o));
/** Tính năng server có (GET /api/me features); server cũ không trả → coi như có đủ. */
const features = () => ({ levelhub: true, bi: true, webgame: true, ...(state.me?.features || {}) });
/** Quyền theo việc (server Node); server cũ chỉ có cờ admin. */
const can = action => state.me?.rights?.[action] ?? !!state.me?.admin;

/** Dải thông báo chung của Quản trị; người đã bấm × thì không hiện lại cùng nội dung. */
function showNotice(n) {
  const el = $('#notice');
  el.hidden = !n?.text || stored(NOTICE_KEY) === n.text;
  $('.notice-text', el).textContent = n?.text || '';
  el.className = `notice ${n?.level === 'warn' ? 'warn' : ''}`;
  $('button', el).onclick = () => {
    store(NOTICE_KEY, n.text);
    el.hidden = true;
  };
}

/** Chế độ tập trung = ẩn danh sách level (một mục của Bố cục). */
function setFocus(on) {
  setLayout({ list: !on });
}
const focused = () => !layout().list;
const packInfo = () => state.packs.find(p => p.name === state.pack);
const packReadOnly = () => { const p = packInfo(); return !p || p.archived || p.production; };

// ───────────────────────────── màn ─────────────────────────────

/** Những gì các màn (library / reorder / overview / activity .mjs) dùng của vỏ. */
const shell = {
  state, game, features, can, packInfo, packReadOnly, stored, store,
  openLevel: async (name, opts) => { setView('level'); await openLevel(String(name), opts); },
  playLevel: async name => {
    setView('level');
    await openLevel(String(name));
    if (state.sel === String(name)) await play();
  },
  shareLevel: async name => {
    if (String(name) === state.sel) return share();
    const d = await api.level(state.pack, String(name));
    return openShare({ pack: state.pack, name: String(name), rev: d.rev, draft: d.level, dirty: false });
  },
  checkPack: () => checkPack(),
  promote: names => promote(names),
  deleteLevels: names => deleteLevels(names),
  levelHub: () => levelHub(),
  afterReorder: async () => {
    await loadLevels();
    if (state.sel) await openLevel(state.sel, { force: true });
  },
};

const views = {};
function viewOf(name) {
  const mount = { library: mountLibrary, order: mountOrder, overview: mountOverview, activity: mountActivity }[name];
  if (!views[name]) {
    views[name] = mount(shell, $(`#view-${name}`), $(`#${name}-tools`));
    wireGrips($(`#view-${name}`));
  }
  return views[name];
}

function renderView(show = false) {   // mở màn / đổi bộ / danh sách level tải lại: vẽ lại màn đang mở (trừ màn Level)
  if (state.view === 'level' || !state.pack) return;
  Promise.resolve(viewOf(state.view).render({ show })).catch(e => toast(e.message, 'err'));
}

/** Màn Level không bị ẩn hẳn khi sang màn khác: khung game trong đó vẫn chạy (chụp ảnh ở Thư viện, giữ game đã tải). */
function setView(name) {
  if (!VIEWS.includes(name)) name = 'level';
  const prev = state.view;
  state.view = name;
  store(VIEW_KEY, name);
  for (const b of $$('.views-nav button')) b.classList.toggle('active', b.dataset.view === name);
  for (const el of $$('.ctxbar .ctx')) el.hidden = el.dataset.view !== name;
  for (const v of VIEWS) if (v !== 'level') $(`#view-${v}`).hidden = v !== name;
  $('#view-level').classList.toggle('away', name !== 'level');
  $('#view-level').inert = name !== 'level';
  if (name !== 'level') renderView(true);
  else if (prev !== 'level' && state.sel && state.draft && !isShowing(state.pack, state.sel)) showInGame('preview').catch(() => {});
}

/** Kiểm định cả bộ trên server: chấm trạng thái ở danh sách, Thư viện, Tổng quan bộ. Đang chạy cho bộ này thì chờ lần đó. */
let checking = null;
function checkPack() {
  const pack = state.pack;
  if (checking?.pack === pack) return checking.run;
  const run = api.validatePack(pack).then(res => {
    if (pack !== state.pack) return null;
    state.invalid = new Map(res.filter(r => !r.isValid).map(r => [r.name, r.errors]));
    state.warned = new Map(res.filter(r => r.warnings?.length).map(r => [r.name, r.warnings]));
    state.checked = { pack, at: Date.now() };
    renderList();
    renderView();
    return res;
  }).finally(() => { if (checking?.run === run) checking = null; });
  checking = { pack, run };
  return run;
}

/** Kết quả kiểm định một level vừa biết trên trình duyệt (mở / lưu) thay cho kết quả cũ của lần kiểm định cả bộ. */
function noteCheck(name, v) {
  if (state.checked?.pack !== state.pack) return;
  if (v.isValid) state.invalid.delete(name); else state.invalid.set(name, v.errors);
  if (v.warnings?.length) state.warned.set(name, v.warnings); else state.warned.delete(name);
}

// ───────────────────────────── thanh trạng thái, gợi ý phím ─────────────────────────────

function renderCounts() {
  const live = state.packs.filter(p => !p.archived);
  $('#st-count').textContent = `${live.reduce((n, p) => n + (p.level_count || 0), 0)} level · ${live.length} bộ`;
}

async function renderGameStatus() {
  const el = $('#st-game');
  if (!features().webgame) return;
  const b = await currentBuild().catch(() => null);
  const when = b?.uploaded_at ? new Date(b.uploaded_at).toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
  el.hidden = false;
  el.textContent = b ? `▶ Bản game ${b.version || b.file || b.id || ''}${b.branch ? ` · ${b.branch}` : ''}${b.buildNumber ? ` #${b.buildNumber}` : ''}${when ? ` · ${when}` : ''}`
    : '▶ Chưa có bản game';
  el.title = can('gameBuilds') ? 'Bản game WebGL dùng để xem / chơi thử — bấm để chọn bản khác, tải bản mới' : 'Bản game WebGL dùng để xem / chơi thử';
  el.disabled = !can('gameBuilds');
}

const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = email => `<span class="avatar" style="--h:${hue(email)}" title="${esc(email)}">${esc(shortUser(email).slice(0, 2).toUpperCase())}</span>`;

function renderOnline(list = []) {
  const others = list.filter(e => e !== state.me?.email);
  $('#online').innerHTML = others.length ? `${others.slice(0, 6).map(avatar).join('')} ${others.length} người khác online` : 'chỉ mình bạn';
  $('#online').title = others.join('\n');
}

/** Dòng gợi ý phím ở đáy màn Level, theo việc đang làm; phím lấy từ bảng phím tắt (người dùng đổi thì đổi theo). */
function renderHints() {
  const own = (game.shortcuts || []).filter(a => a.hint !== false && a.scope !== 'global').map(a => [a.id, a.label]);
  const items = state.editing
    ? [['level.save', 'lưu'], ['level.edit', 'xong'], ['level.play', 'chơi bản nháp'], ...own]
    : state.sel
      ? [['level.edit', 'sửa'], ['level.play', 'chơi thử'], ['level.share', 'link điện thoại'], ['level.prev', 'level trước'],
        ['level.next', 'level sau'], ['global.search', 'tìm'], ['global.focus', 'tập trung'], ['global.palette', 'tìm nhanh']]
      : [['global.search', 'tìm level'], ['global.newLevel', 'level mới'], ['global.palette', 'tìm nhanh'], ['global.library', 'Thư viện']];
  $('#hintbar').innerHTML = items.filter(([id]) => shortLabel(id)).slice(0, 10)
    .map(([id, label]) => `<span><kbd>${esc(shortLabel(id))}</kbd> ${esc(label)}</span>`).join('')
    + '<span class="grow"></span><button data-keys class="link">⌨ Phím tắt</button>';
}

// ───────────────────────────── khởi động / đăng nhập ─────────────────────────────

function brand() {
  document.title = game.toolName;
  $('#login-title').textContent = game.toolName;
  $('#login-sub').textContent = game.subtitle || '';
  $('#brand-name').textContent = game.toolName;
  $('#filter-mode').innerHTML = '<option value="">Tất cả</option>'
    + (game.listFilters || []).map(f => `<option value="${esc(f.value)}">${esc(f.label)}</option>`).join('')
    + '<option value="invalid">Lỗi kiểm định</option><option value="deleted">Đã xoá (khôi phục)</option>';
}

async function boot() {
  brand();
  applyTheme(localStorage.getItem(THEME_KEY));
  try {
    state.me = await api.me();
  } catch (e) {
    return showLogin(e);
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#me').innerHTML = `${avatar(state.me.email)} ${esc(shortUser(state.me.email))}`;
  api.authStatus().then(st => {   // phiên bản trên BI = tag phát hành (<slug>-v0.1.0 → v0.1.0); local = dev
    const v = String(st.version || '');
    $('#app-version').textContent = `${game.toolName} ${game.versionPrefix && v.startsWith(game.versionPrefix) ? v.slice(game.versionPrefix.length) : v}`;
    return mountWhatsNew($('#app-version'), v.slice(game.versionPrefix?.length || 0), `${game.storagePrefix}.seenVersion`);
  }).catch(() => {});
  try {
    state.bi = await api.biConfig();
  } catch {
    state.bi = { configured: false };
  }
  $('#btn-levelhub-bi').hidden = !features().levelhub;
  if (!state.bi.configured) $('#btn-levelhub-bi').title = 'Chưa kết nối BI Level Hub — bấm để xem cách cấu hình';
  wire();
  configureKeymap({ storagePrefix: game.storagePrefix, scopes: game.shortcutScopes || [], actions: game.shortcuts || [] });
  bridgeMouseButtons();
  $('#btn-trash').hidden = !features().trash;
  $('#btn-admin').hidden = !(features().admin && state.me.admin);
  $('#btn-share').hidden = !(features().share && features().webgame);
  showNotice(state.me.notice);
  // Bố cục mặc định của game (ui.mjs / manifest `layout`); máy đã bật chế độ tập trung ở bản trước thì giữ.
  configureLayout({ storagePrefix: game.storagePrefix, gameDefaults: game.layout || {} });
  if (stored(`${game.storagePrefix}.focus`) === '1') {
    setFocus(true);
    try { localStorage.removeItem(`${game.storagePrefix}.focus`); } catch { /* bỏ qua */ }
  }
  onLayout(p => {
    $('#btn-focus').classList.toggle('active', !p.list);
    if (state.draft) layOverview();
  });
  $('#btn-focus').classList.toggle('active', focused());
  if (game.renderEditor) $('.level-head [data-tab="overview"]').textContent = 'Editor';
  renderOnline();
  renderHints();
  if (features().webgame) mountDock($('#game-dock'), { ...game.webgame, record: features().plays === true, manageBuilds: can('gameBuilds') });
  else {
    $('#game-dock').innerHTML = '<p class="muted small dock-off">Server này chưa có chơi thử bằng bản WebGL của game.</p>';
    $('#btn-play').hidden = true;
  }
  renderGameStatus();
  sync.startEvents();
  // Màn mở đầu: màn lần trước; lần đầu thì Level, hoặc Thư viện với game nhìn hình là nhận ra level (manifest listView: 'grid').
  state.view = VIEWS.includes(stored(VIEW_KEY)) ? stored(VIEW_KEY) : game.listView === 'grid' ? 'library' : 'level';
  await loadPacks(localStorage.getItem(PACK_KEY));
  setView(state.view);
}

async function showLogin(err) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-msg').textContent = err instanceof ApiError && err.status !== 401 ? err.message : '';
  if (err instanceof ApiError && err.status === 401) session.set('');   // phiên cũ hết hạn
  let st = { bi: false, dev: false };
  try {
    st = await api.authStatus();
  } catch { /* server cũ */ }
  // Đăng nhập chính: Google của BI (như AntLevel). Ô email chỉ có khi server chạy DEV.
  const google = $('#login-google');
  google.hidden = !st.bi;
  google.textContent = `Đăng nhập bằng Google (BI ${st.env || ''})`;
  google.onclick = async () => {
    try {
      const { token } = await biSessionLogin();
      devUser.set('');
      session.set(token);
      location.reload();
    } catch (e) {
      $('#login-msg').textContent = e.message;
    }
  };
  $('#login-dev').hidden = !st.dev;
  if (!st.bi && !st.dev && err instanceof ApiError && err.body?.login_url) {
    const a = $('#login-sso');
    a.hidden = false;
    a.href = err.body.login_url;
  }
  if (!st.bi && !st.dev) $('#login-msg').textContent ||= `Server chưa cấu hình đăng nhập BI (${game.envPrefix}_BI_*) — xem README.`;
  $('#login-email').value = devUser.get();
  $('#login-form').onsubmit = e => {
    e.preventDefault();
    if (!st.dev) return;
    devUser.set($('#login-email').value.trim().toLowerCase());
    location.reload();
  };
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ───────────────────────────── bộ level ─────────────────────────────

async function loadPacks(prefer) {
  state.packs = await api.packs();
  renderCounts();
  const visible = renderPackSelect(prefer);
  const name = visible.some(p => p.name === prefer) ? prefer : visible.find(p => !hubIdOf(p))?.name || visible[0]?.name;
  if (name) {
    $('#pack-select').value = name;
    await selectPack(name);
  }
}

/** Ô chọn bộ: nhóm "Bộ local" và nhóm "Level Hub" (bộ đã mở từ BI + bộ trên BI chưa mở, value "hub:<id>"). */
function renderPackSelect(keep = state.pack) {
  const visible = state.packs.filter(p => !p.archived || p.name === keep);
  const opt = p => `<option value="${esc(p.name)}">${esc(p.group && !hubIdOf(p) ? `${p.group} / ` : '')}${esc(p.name)}`
    + `${p.production ? ' (production)' : ''}${p.archived ? ' (lưu trữ)' : ''} — ${p.level_count}</option>`;
  const local = visible.filter(p => !hubIdOf(p)), hub = visible.filter(p => hubIdOf(p));
  let html = `<optgroup label="Bộ local">${local.map(opt).join('')}</optgroup>`;
  if (state.bi?.configured || hub.length) {
    const opened = new Set(hub.map(hubIdOf));
    const remote = (state.hub || []).filter(g => !opened.has(String(groupId(g))));
    html += `<optgroup label="Level Hub (BI ${esc(state.bi?.env || '')})">${hub.map(opt).join('')}`
      + remote.map(g => `<option value="hub:${esc(groupId(g))}">⇩ ${esc(hubOptionText(g))}</option>`).join('')
      + (state.bi?.configured ? `<option value="hub:">${state.hub ? '↻ Tải lại danh sách Level Hub…' : '⇩ Tải danh sách bộ trên Level Hub…'}</option>` : '')
      + '</optgroup>';
  }
  const sel = $('#pack-select');
  sel.innerHTML = html;
  if (keep && visible.some(p => p.name === keep)) sel.value = keep;
  return visible;
}

/** Chọn mục "hub:…" trong ô chọn bộ. Gọi ngay trong sự kiện change (biLogin có thể mở popup). */
async function pickHub(value) {
  $('#pack-select').value = state.pack;   // giữ bộ đang mở cho tới khi bộ Level Hub sẵn sàng
  const id = value.slice(4);
  if (!id) {
    try {
      state.hub = await listHubGroups();
    } catch (e) {
      return toast(`Không tải được danh sách Level Hub: ${e.message}`, 'err');
    }
    renderPackSelect();
    return toast(`Level Hub có ${state.hub.length} bộ — chọn trong mục "Level Hub" của ô Bộ để mở.`, 'ok');
  }
  const g = state.hub?.find(x => String(groupId(x)) === id);
  if (g) await openHubPack(g);
}

/** Mở bộ Level Hub g thành bộ riêng (tạo nếu chưa có, tải level về) rồi chuyển sang bộ đó. */
async function openHubPack(g, { refresh = false } = {}) {
  const existing = state.packs.find(p => hubIdOf(p) === String(groupId(g)));
  if (existing && !refresh) return loadPacks(existing.name);
  toast(`Đang tải bộ ${groupName(g)} từ Level Hub…`);
  try {
    const r = await syncHubPack(g, state.packs, (i, n) => { $('#list-stats').textContent = `Level Hub: ${i} / ${n}…`; });
    toast(`Bộ ${r.pack}: ${r.total} level từ Level Hub (${r.created} mới, ${r.updated} cập nhật, ${r.unchanged} giữ nguyên)`, 'ok');
    await loadPacks(r.pack);
  } catch (e) {
    toast(`Không mở được bộ Level Hub: ${e.message}`, 'err');
    await loadLevels().catch(() => {});
  }
}

async function selectPack(name) {
  if (!(await leaveLevel())) {
    $('#pack-select').value = state.pack;
    return;
  }
  state.pack = name;
  state.checked = null;
  state.invalid = new Map();
  state.warned = new Map();
  localStorage.setItem(PACK_KEY, name);
  closeLevel();
  await loadLevels();
  const p = packInfo();
  $('#btn-new-level').disabled = packReadOnly();
  $('#btn-import').disabled = packReadOnly();
  $('#btn-hub-sync').hidden = !hubIdOf(p) || !state.bi?.configured;
  if (p?.production) toast(`Bộ ${name} là production: chỉ nhận level promote từ bộ khác.`);
  checkPack().catch(() => {});   // chạy nền: chấm trạng thái ở danh sách, Thư viện, Tổng quan bộ
}

async function loadLevels() {
  const all = await api.levels(state.pack, true);
  state.levels = all.filter(l => !l.deleted);
  state.deleted = all.filter(l => l.deleted);
  renderList();
  const p = packInfo();
  if (p && p.level_count !== state.levels.length) {   // số level trên ô chọn bộ theo danh sách vừa tải
    p.level_count = state.levels.length;
    const opt = [...$('#pack-select').options].find(o => o.value === p.name);
    if (opt) opt.textContent = opt.textContent.replace(/ — \d+$/, ` — ${p.level_count}`);
    renderCounts();
  }
  renderView();
}

async function restoreDeleted(name) {
  if (packReadOnly()) return toast('Bộ này chỉ đọc', 'err');
  if (!(await confirmDialog(`Khôi phục level ${name}?`, 'Tạo revision mới có nội dung của bản cuối cùng trước khi xoá.', 'Khôi phục'))) return;
  try {
    const revs = await api.revisions(state.pack, name);
    const last = revs.find(r => r.sha);
    if (!last) throw new Error('Không có bản nào để khôi phục');
    await api.revert(state.pack, name, last.rev, revs[0].rev);
    $('#filter-mode').value = '';
    await loadLevels();
    await openLevel(name, { force: true });
  } catch (e) {
    toast(e.message, 'err');
  }
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadLevels().catch(() => {}), 300);
}

function renderList() {
  const query = parseLevelQuery($('#search').value);
  const mode = $('#filter-mode').value;
  if (mode === 'deleted') {
    $('#list-stats').textContent = `${state.deleted.length} level đã xoá — bấm để khôi phục`;
    $('#level-list').innerHTML = state.deleted.map(lv => `<li data-deleted="${esc(lv.name)}"><span class="num">${esc(lv.name)}</span>
      <span class="tags"><span class="badge err">đã xoá</span></span>
      <span class="sub muted small">r${esc(lv.head_rev)} · ${esc(shortUser(lv.author))} · ${esc(fmtTime(lv.updated_at))}</span></li>`).join('')
      || '<li class="muted">Không có level nào bị xoá.</li>';
    return;
  }
  const items = state.levels.filter(lv => {
    const s = lv.summary || {};
    if (mode === 'invalid' && !state.invalid.has(lv.name)) return false;
    if (mode && mode !== 'invalid' && !game.matchFilter?.(s, mode)) return false;
    return query.empty || queryMatches(query, lv.level, `${game.searchText?.(s) || ''} ${lv.author || ''}`);
  });
  const checked = state.checked?.pack === state.pack;
  $('#list-stats').textContent = `${items.length === state.levels.length ? '' : `${items.length} / `}${state.levels.length} level`
    + (checked && state.invalid.size ? ` · ${state.invalid.size} lỗi` : '') + (checked && state.warned.size ? ` · ${state.warned.size} cảnh báo` : '');
  const DOT = { err: 'Có lỗi kiểm định', warn: 'Có cảnh báo', ok: 'Hợp lệ' };
  $('#level-list').innerHTML = items.map(lv => {
    const it = game.listItem?.(lv.summary || {}) || {};
    const lock = lv.lock ? `<span class="badge warn" title="Đang sửa">🔒 ${esc(shortUser(lv.lock.holder))}</span>` : '';
    const st = checkState(state, lv.name);
    return `<li data-name="${esc(lv.name)}" class="${lv.name === state.sel ? 'sel' : ''} ${st === 'err' ? 'invalid' : ''}">
      <span class="num">${st ? `<span class="dot ${st}" title="${DOT[st]}"></span>` : ''}${esc(lv.name)}</span>
      <span class="tags">${it.tags || ''}${lock}</span>
      <span class="sub muted small">${it.sub ? `${esc(it.sub)} · ` : ''}r${esc(lv.head_rev)} · ${esc(shortUser(lv.author))} · ${esc(fmtTime(lv.updated_at))}</span>
    </li>`;
  }).join('') || '<li class="muted">Chưa có level — bấm ⇪ Nhập ở dưới để đưa level từ game vào.</li>';
}

// ───────────────────────────── level đang mở ─────────────────────────────

/** Rời level hiện tại (hỏi nếu còn thay đổi chưa lưu), nhả khoá. false = người dùng ở lại. */
async function leaveLevel() {
  if (state.dirty && !(await confirmDialog('Bỏ thay đổi?', `Level ${state.sel} còn thay đổi chưa lưu.`, 'Bỏ thay đổi', true))) {
    return false;
  }
  await sync.release();
  state.editing = false;
  state.dirty = false;
  return true;
}

/** Hàng ngữ cảnh của màn Level: có level mở thì hiện tên, kiểm định, tab, thao tác; không thì một dòng hướng dẫn. */
function showHead(on) {
  $('#lv-none').hidden = on;
  for (const sel of ['#btn-prev', '#lv-title', '#btn-next', '#lv-valid', '.level-head .tabs', '#lv-actions']) $(sel).hidden = !on;
  if (!on) {
    $('#lv-meta').textContent = '';
    $('#lv-lock').hidden = $('#lv-dirty').hidden = true;
  }
}

function closeLevel() {
  closeEditor();
  state.sel = state.cur = state.draft = null;
  $('#panel-body').hidden = true;
  $('#panel-empty').hidden = false;
  showHead(false);
  renderHints();
}

async function openLevel(name, { force = false } = {}) {
  if (!force && name === state.sel) return;
  if (!(await leaveLevel())) return;
  try {
    state.cur = await api.level(state.pack, name);
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  state.sel = name;
  state.draft = clone(state.cur.level);
  state.dirty = false;
  state.highlight = null;
  $('#panel-empty').hidden = true;
  $('#panel-body').hidden = false;
  showHead(true);
  renderList();
  $(`#level-list li[data-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest' });
  renderPanel();
  if (state.tab === 'history') renderHistory();
  showInGame('preview').catch(e => toast(e.message, 'err'));   // mở level là xem luôn bằng game thật
}

/** ↺ Hoàn tác: bỏ mọi thay đổi chưa lưu, bản nháp trở về bản đã lưu (state.cur); vẫn giữ khoá sửa để sửa tiếp. */
async function revertDraft() {
  if (!state.dirty) return;
  if (!(await confirmDialog('Hoàn tác thay đổi?', `Bỏ mọi thay đổi chưa lưu của level ${state.sel}, trở về bản đã lưu `
    + `(r${state.cur.rev}).`, 'Hoàn tác', true))) return;
  state.draft = clone(state.cur.level);
  renderPanel();
  markDirty();   // hết "Chưa lưu"; khung xem bằng game tự dựng lại nếu map / prop đã đổi
  toast(`Đã hoàn tác level ${state.sel} về r${state.cur.rev}`, 'ok');
}

function editable() {
  return state.editing && !packReadOnly();
}

function markDirty() {
  state.dirty = JSON.stringify(state.draft) !== JSON.stringify(state.cur.level);
  $('#lv-dirty').hidden = !state.dirty;
  $('#btn-save').disabled = !state.dirty || !editable();
  $('#btn-revert').disabled = !state.dirty;
  schedulePreviewRefresh();
}

// 👁 Xem bằng game: sửa bản nháp thì khung game dựng lại level (gộp các thay đổi liên tiếp trong 1,2 s).
// Chỉ dựng lại khi đổi thứ nhìn thấy trên map (prop, vị trí lỗ, ô môi trường, map / theme) — đổi target, thời gian,
// độ khó… không đổi hình nên không dựng lại (trước đây chọn target mới là khung game tải lại cả level).
let previewTimer = null, previewKey = '';
const visualKey = lv => (game.visualKey ? game.visualKey(lv) : JSON.stringify(lv));
function schedulePreviewRefresh() {
  if (!isPreviewing(state.pack, state.sel) || visualKey(state.draft) === previewKey) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!isPreviewing(state.pack, state.sel)) return;
    previewKey = visualKey(state.draft);
    refreshPreview(clone(state.draft));
  }, 1200);
}

function renderPanel() {
  const cur = state.cur;
  $('#lv-title').textContent = `Level ${state.sel}`;
  $('#lv-title').title = `${state.pack} / Level ${state.sel}`;   // tên bộ đã có ở ô Bộ trên cùng
  const meta = `r${cur.rev} · ${shortUser(cur.author)} · ${fmtTime(cur.created_at)}${cur.message ? ` · ${cur.message}` : ''}`;
  $('#lv-meta').textContent = meta;
  $('#lv-meta').title = meta;
  const lock = cur.lock && cur.lock.holder !== state.me.email ? cur.lock : null;
  // Đang xem: chỉ Sửa / Chơi thử. Đang sửa: Lưu / Hoàn tác / Xong. Chip khoá chỉ hiện khi có người đang sửa.
  $('#lv-lock').textContent = state.editing ? '✎ Bạn đang sửa' : lock ? `🔒 ${shortUser(lock.holder)} đang sửa` : '';
  $('#lv-lock').hidden = !state.editing && !lock;
  const at = state.levels.findIndex(l => l.name === state.sel);
  $('#btn-prev').disabled = at <= 0;
  $('#btn-next').disabled = at < 0 || at >= state.levels.length - 1;
  const ro = packReadOnly();
  $('#btn-edit').hidden = state.editing;
  $('#btn-edit').disabled = ro || !!lock;
  $('#btn-edit').title = ro ? 'Bộ chỉ đọc (production / lưu trữ)' : lock ? `${shortUser(lock.holder)} đang sửa level này` : 'Khoá level để sửa (E)';
  $('#btn-done').hidden = !state.editing;
  $('#btn-save').hidden = !state.editing;
  $('#btn-revert').hidden = !state.editing;
  $('#btn-delete').disabled = ro;
  $('#btn-relevel').disabled = packInfo()?.archived;
  markDirty();
  renderOverview();
  renderHints();
  if (state.tab === 'json') $('#json-text').value = JSON.stringify(state.draft, null, 2);
}

// ───── editor riêng của game (ui.mjs renderEditor): dựng một lần cho mỗi level, bản nháp đổi từ chỗ khác thì update ─────
let editor = null;   // {key, handle}

function closeEditor() {
  try { editor?.handle?.destroy?.(); } catch { /* editor của game lỗi khi gỡ: bỏ qua */ }
  editor = null;
  $('#editor-host').replaceChildren();
}

function syncEditor() {
  if (!game.renderEditor || !state.draft) return;
  const key = `${state.pack}/${state.sel}`;
  if (editor?.key === key && editor.handle?.update) {
    editor.handle.update(state.draft, { editable: editable() });
    return;
  }
  closeEditor();
  const ctx = {
    el: $('#editor-host'), level: state.draft, editable: editable(), pack: state.pack, name: state.sel, toast,
    changed: () => { markDirty(); renderOverview({ fromEditor: true }); },
    setHighlight: id => { state.highlight = state.highlight === id ? null : id; drawPreview(); },
  };
  try {
    editor = { key, handle: game.renderEditor(ctx) || {} };
  } catch (e) {
    editor = { key, handle: {} };
    $('#editor-host').innerHTML = `<p class="err small">Editor của game lỗi: ${esc(e.message)}</p>`;
  }
}

/**
 * Xếp các cột của tab Tổng quan theo bố cục của người dùng (layout.mjs). Cột ẩn của khung game dùng class off (vẫn chạy,
 * để xem / chụp ảnh nền), các cột khác hidden. Tab Chơi thử (game có editor, khung game để ở tab) = chỉ khung game.
 */
function layOverview() {
  const p = layout(), ov = $('.overview');
  const hasEditor = !!game.renderEditor, playTab = hasEditor && p.game === 'tab', playing = playTab && state.tab === 'play';
  const hasInfo = $('#game-info').childElementCount > 0;
  const show = {
    form: p.form !== 'hide' && !playing, info: p.info && hasInfo && !playing,
    editor: hasEditor && !playing, game: !hasEditor || playing || p.game === 'right',
  };
  $('.level-head [data-tab="play"]').hidden = !playTab;
  const cols = [];
  const put = (sel, width, edge) => {
    const el = $(sel);
    el.style.order = cols.length;
    cols.push(width);
    const grip = $('.grip', el);
    if (grip) {
      grip.hidden = !edge;
      if (edge) grip.dataset.edge = edge;
    }
  };
  if (show.form && p.form === 'left') put('.col-form', 'var(--lc-form-w)', 'right');
  if (show.editor) put('#editor-host', 'minmax(0, 1fr)');
  if (show.game) put('.col-game', show.editor ? 'var(--lc-game-w)' : 'minmax(0, 1fr)', show.editor ? 'left' : '');
  if (show.info) put('.col-info', 'var(--lc-info-w)', 'left');
  if (show.form && p.form === 'right') put('.col-form', 'var(--lc-form-w)', 'left');
  ov.style.gridTemplateColumns = cols.join(' ');
  $('.col-form').hidden = !show.form;
  $('.col-info').hidden = !show.info;
  $('#editor-host').hidden = !show.editor;
  $('.col-game').classList.toggle('off', !show.game);
}

function renderOverview({ fromEditor = false } = {}) {
  const col = $('#game-form');
  col.innerHTML = '<div id="lc-fields"></div><div id="lc-game-form"></div>';
  if (game.fields?.length) {   // form thuộc tính của core: chỉ ghi đúng field vừa sửa
    renderFields($('#lc-fields', col), game.fields, state.draft, { readOnly: !editable(), onChange: () => { markDirty(); renderOverview(); } });
  }
  if (game.renderOverview) {
    game.renderOverview({
      level: state.draft, editable: editable(), highlight: state.highlight, toast,
      form: $('#lc-game-form', col), info: $('#game-info'),
      setHighlight: id => { state.highlight = state.highlight === id ? null : id; renderOverview(); },   // bấm lại = tắt
      changed: () => { markDirty(); renderOverview(); },
    });
  } else if (!game.fields?.length && !game.renderEditor) {
    $('#lc-game-form', col).innerHTML = '<section class="card"><p class="muted small">Game chưa khai field nào — sửa ở tab JSON.</p></section>';
  }
  if (!fromEditor) syncEditor();
  const v = game.validateLevel(state.draft, { levelNo: Number(state.sel) });
  $('#validation').innerHTML = v.errors.map(x => `<div class="err">${esc(x)}</div>`).join('')
    + v.warnings.map(x => `<div class="warn">${esc(x)}</div>`).join('')
    + (v.isValid ? '<div class="ok">Hợp lệ</div>' : '');
  const chip = $('#lv-valid');
  chip.textContent = !v.isValid ? `✗ ${v.errors.length} lỗi` : v.warnings.length ? `! ${v.warnings.length} cảnh báo` : '✓ Hợp lệ';
  chip.className = `chip ${!v.isValid ? 'err' : v.warnings.length ? 'warn' : 'ok'}`;
  chip.title = [...v.errors, ...v.warnings].join('\n') || 'Level qua kiểm định';
  layOverview();
  drawPreview();
}

function drawPreview() {   // preview = khung game thật (webgame.mjs): chỉ cần báo prop đang làm nổi
  gameHighlight(state.highlight);
}

// ───────────────────────────── sửa / lưu ─────────────────────────────

async function startEdit() {
  try {
    await sync.acquire(state.pack, state.sel);
  } catch (e) {
    return toast(e.message, 'err');
  }
  state.editing = true;
  // Người khác vừa lưu trước khi mình khoá: tải bản mới nhất để sửa trên đó.
  const fresh = await api.level(state.pack, state.sel);
  if (fresh.rev !== state.cur.rev) {
    state.cur = fresh;
    state.draft = clone(fresh.level);
    toast(`Đã tải bản mới nhất r${fresh.rev}`);
  }
  state.cur.lock = fresh.lock;
  renderPanel();
}

async function stopEdit() {
  if (!(await leaveLevel())) return;
  state.draft = clone(state.cur.level);
  await openLevel(state.sel, { force: true });
}

async function save() {
  if (!state.dirty || !editable()) return;
  const v = game.validateLevel(state.draft, { levelNo: Number(state.sel) });
  if (!v.isValid && !(await confirmDialog('Lưu bản còn lỗi?', `Level còn ${v.errors.length} lỗi kiểm định: ${v.errors[0]}. `
    + 'Vẫn lưu được (bản nháp) nhưng sẽ không promote / xuất Level Hub được.', 'Vẫn lưu'))) return;
  try {
    const res = await api.saveLevel(state.pack, state.sel, state.draft, state.cur.rev);
    applySaved(res);
  } catch (e) {
    if (e.status === 412) return conflict(e.body);
    toast(e.message, 'err');
  }
}

function applySaved(res) {
  state.cur = { ...state.cur, rev: res.rev, level: clone(state.draft), author: res.author || state.me.email,
    created_at: new Date().toISOString(), message: '' };
  noteCheck(state.sel, game.validateLevel(state.draft, { levelNo: Number(state.sel) }));
  toast(res.unchanged ? 'Không có gì thay đổi' : `Đã lưu r${res.rev}${res.changes?.length ? `: ${res.changes.slice(0, 3).join('; ')}` : ''}`, 'ok');
  renderPanel();
  scheduleReload();
}

/** Lưu gặp 412: bản nháp vẫn còn trên màn hình cho tới khi chọn. Ghi đè vẫn an toàn vì lịch sử chỉ thêm, không xoá. */
async function conflict(body) {
  const diffs = body.body ? diffPaths(body.body, state.draft) : [];
  const html = `<p>${esc(shortUser(body.author))} đã ${body.deleted ? 'xoá level' : 'lưu'} r${esc(body.head_rev)} lúc ${esc(fmtTime(body.updated_at))}`
    + ` trong khi bạn sửa từ r${esc(state.cur.rev)}. Bản của bạn vẫn còn.</p>`
    + (diffs.length ? `<p class="small">Khác bản server ở: <b>${diffs.map(esc).join(', ')}</b></p>` : '')
    + (body.body ? `<details><summary class="small">JSON bản server r${esc(body.head_rev)}</summary><pre>${esc(JSON.stringify(body.body, null, 2))}</pre></details>` : '');
  const choice = await openDialog({
    title: `Level ${state.sel} đã bị sửa`,
    html,
    actions: [
      { label: 'Huỷ', value: null },
      ...(body.body ? [{ label: `Giữ bản server (r${body.head_rev})`, value: 'theirs' }] : []),
      { label: 'Lưu thành bản sao', value: 'copy' },
      { label: `Giữ bản của tôi (ghi đè r${body.head_rev})`, primary: true, value: 'mine' },
    ],
  });
  if (choice === 'theirs') {
    state.cur = { ...state.cur, rev: body.head_rev, level: body.body, author: body.author, created_at: body.updated_at };
    state.draft = clone(body.body);
    renderPanel();
  } else if (choice === 'mine') {
    try {
      applySaved(await api.saveLevel(state.pack, state.sel, state.draft, body.head_rev, `ghi đè r${body.head_rev}`));
    } catch (e) {
      if (e.status === 412) return conflict(e.body);
      toast(e.message, 'err');
    }
  } else if (choice === 'copy') {
    await saveAsCopy();
  }
}

/** Lưu bản nháp thành level mới ở số trống đầu tiên; level đang mở giữ bản trên server. */
async function saveAsCopy() {
  const used = new Set(state.levels.map(l => l.level));
  let n = 1;
  while (used.has(n)) n++;
  try {
    await api.createLevel(state.pack, String(n), game.blankLevel(n, state.draft), `bản sao từ ${state.sel} khi xung đột`);
  } catch (e) {
    return toast(e.message, 'err');
  }
  state.dirty = false;
  toast(`Đã lưu bản của bạn thành level ${n}`, 'ok');
  await loadLevels();
  await openLevel(String(n), { force: true });
}

// ───────────────────────────── level: thao tác ─────────────────────────────

async function newLevel() {
  const used = new Set(state.levels.map(l => l.level));
  let n = 1;
  while (used.has(n)) n++;
  const html = `<div class="grid2"><label>Số level<input id="nl-num" type="number" min="1" value="${n}"></label>
    <label class="check"><input id="nl-copy" type="checkbox" ${state.cur ? 'checked' : ''} ${state.cur ? '' : 'disabled'}>
      Sao chép level đang mở${state.cur ? ` (${esc(state.sel)})` : ''}</label></div>`;
  const ok = await openDialog({
    title: 'Level mới', html, actions: [{ label: 'Huỷ', value: false }, {
      label: 'Tạo', primary: true, onClick: async dlg => {
        const num = Number($('#nl-num', dlg).value);
        if (!Number.isInteger(num) || num < 1) throw new Error('Số level phải là số nguyên ≥ 1');
        const tpl = $('#nl-copy', dlg).checked ? state.draft : null;
        await api.createLevel(state.pack, String(num), game.blankLevel(num, tpl), tpl ? `sao chép từ ${state.sel}` : '');
        return num;
      },
    }],
  });
  if (ok) {
    await loadLevels();
    await openLevel(String(ok));
  }
}

/** Xoá nhiều level (Thư viện): xoá mềm từng level, level đang khoá hoặc vừa bị sửa thì bỏ qua và báo. */
async function deleteLevels(names) {
  if (!(await confirmDialog(`Xoá ${names.length} level?`, `Level ${names.slice(0, 12).join(', ')}${names.length > 12 ? '…' : ''}. Xoá mềm: `
    + 'lịch sử vẫn giữ, khôi phục được ở bộ lọc "Đã xoá" của danh sách hoặc Thùng rác.', 'Xoá', true))) return false;
  if (names.includes(state.sel) && !(await leaveLevel())) return false;
  const failed = [];
  for (const name of names) {
    const lv = state.levels.find(l => l.name === name);
    try {
      await api.deleteLevel(state.pack, name, lv?.head_rev);
    } catch (e) {
      failed.push(`${name} (${e.message})`);
    }
  }
  if (names.includes(state.sel)) closeLevel();
  toast(failed.length ? `Không xoá được: ${failed.join('; ')}` : `Đã xoá ${names.length} level`, failed.length ? 'err' : 'ok');
  await loadLevels();
  return true;
}

async function deleteLevel() {
  if (!(await confirmDialog(`Xoá level ${state.sel}?`, 'Xoá mềm: lịch sử vẫn giữ, khôi phục được ở bộ lọc "Đã xoá" của danh sách.', 'Xoá', true))) return;
  try {
    await api.deleteLevel(state.pack, state.sel, state.cur.rev);
    await sync.release();
    state.editing = state.dirty = false;
    closeLevel();
    await loadLevels();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function relevel() {
  const html = `<div class="grid2"><label>Số mới<input id="rl-to" type="number" min="1"></label>
    <label>Cách đổi<select id="rl-mode"><option value="swap">Đổi chỗ (swap)</option><option value="shift">Chèn + dồn (shift)</option></select></label></div>
    <div id="rl-plan" class="small muted">Nhập số mới để xem trước.</div>`;
  const preview = async dlg => {
    const to = $('#rl-to', dlg).value;
    if (!to) return;
    try {
      const plan = await api.relevel(state.pack, state.sel, to, $('#rl-mode', dlg).value, state.cur.rev, true);
      $('#rl-plan', dlg).innerHTML = `${plan.moves.map(m => `${esc(m.from)} → ${esc(m.to)}`).join(', ')}`
        + (plan.locked.length ? `<div class="err">Đang bị khoá: ${plan.locked.map(l => `${esc(l.level)} (${esc(shortUser(l.holder))})`).join(', ')}</div>` : '');
    } catch (e) {
      $('#rl-plan', dlg).innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
  };
  const res = await openDialog({
    title: `Đổi số level ${state.sel}`, html,
    onOpen: dlg => { for (const el of $$('input, select', dlg)) el.addEventListener('change', () => preview(dlg)); },
    actions: [{ label: 'Huỷ', value: null }, {
      label: 'Đổi số', primary: true, onClick: async dlg => {
        if (state.dirty) throw new Error('Lưu hoặc bỏ thay đổi trước khi đổi số');
        await sync.release();
        state.editing = false;
        return api.relevel(state.pack, state.sel, $('#rl-to', dlg).value, $('#rl-mode', dlg).value, state.cur.rev);
      },
    }],
  });
  if (res) {
    toast(`Đã đổi số: ${res.moves.map(m => `${m.from}→${m.to}`).join(', ')}`, 'ok');
    const dest = res.moves[0].to;
    await loadLevels();
    await openLevel(dest, { force: true });
  }
}

/** ▶ Chơi thử: gửi cả bộ vào game thật (WebGL), level đang mở thay bằng bản nháp (chưa lưu cũng được) rồi mở level đó. */
/** Khung game ở cột preview: mode 'preview' = xem level đứng yên (mở level là tự xem), 'play' = ▶ Chơi thử. */
/** ▶ Chơi thử: game có editor riêng và khung game để ở tab thì sang tab Chơi thử trước. */
async function play() {
  if (game.renderEditor && layout().game === 'tab') setTab('play');
  await showInGame('play');
}

function layoutDialog() {
  return openLayout({ hasEditor: !!game.renderEditor });
}

async function showInGame(mode = 'preview') {
  if (!state.sel || !state.draft || !features().webgame) return;
  if (mode === 'play') {
    const errs = game.validateLevel(state.draft).errors || [];
    if (errs.length && !(await confirmDialog('Level đang lỗi kiểm định', `${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} lỗi)` : ''}. `
      + 'Game có thể từ chối mở level này. Vẫn chơi thử?', 'Vẫn chơi'))) return;
  }
  const pack = state.pack;
  previewKey = visualKey(state.draft);
  await showLevel(pack, state.sel, clone(state.draft), mode, 'draft', state.cur?.rev ?? null);   // chỉ level này — không tải cả bộ
}

/** ▶ Chơi rN (Lịch sử): chơi đúng revision đã chọn để tái hiện lỗi, bản đang mở giữ nguyên. */
async function playRevision(rev) {
  const r = await api.revision(state.pack, state.sel, rev);
  if (!r.level) return toast(`r${rev} là bản xoá, không có nội dung để chơi`, 'err');
  await showLevel(state.pack, state.sel, r.level, 'play', `r${rev}`, rev);
}

/** Promote một level (số đích chọn được) hoặc nhiều level (giữ nguyên số) sang bộ khác. */
async function promote(names = [state.sel]) {
  const targets = state.packs.filter(p => p.name !== state.pack && !p.archived);
  const def = targets.find(p => p.production)?.name || targets[0]?.name;
  if (!def) return toast('Chưa có bộ nào khác để promote sang');
  const one = names.length === 1;
  const html = `<p class="muted small">Chép bản đã lưu sang bộ khác sau khi qua kiểm định. Bộ production chỉ nhận level theo đường này.</p>
    ${one ? '' : `<p>${esc(names.length)} level: ${esc(names.slice(0, 20).join(', '))}${names.length > 20 ? '…' : ''} — giữ nguyên số ở bộ đích.</p>`}
    <div class="grid2"><label>Sang bộ<select id="pm-to">${targets.map(p => `<option ${p.name === def ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${one ? `<label>Số level đích<input id="pm-num" type="number" min="1" value="${esc(names[0])}"></label>` : ''}</div>
    <label>Ghi chú<input id="pm-msg" placeholder="vd: giảm time 10%"></label><div id="pm-err" class="err small"></div>`;
  const res = await openDialog({
    title: one ? `Promote level ${names[0]}` : `Promote ${names.length} level`, html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Promote', primary: true, onClick: async dlg => {
        if (state.dirty && names.includes(state.sel)) throw new Error(`Lưu thay đổi của level ${state.sel} trước khi promote`);
        try {
          return await api.promote(state.pack, $('#pm-to', dlg).value,
            names.map(name => ({ name, to: one ? $('#pm-num', dlg).value : name })), $('#pm-msg', dlg).value);
        } catch (e) {
          if (e.status === 422 && e.body.validation) {
            $('#pm-err', dlg).innerHTML = e.body.validation.map(v => v.errors.map(x => `${v.name && !one ? `Level ${esc(v.name)}: ` : ''}${esc(x)}`).join('<br>')).join('<br>');
            return false;
          }
          throw e;
        }
      },
    }],
  });
  if (res) toast(`Đã promote sang ${res.to}: ${res.items.map(i => `${i.name}→${i.to}${i.unchanged ? ' (không đổi)' : ` r${i.rev}`}`).join(', ')}`, 'ok');
}

// ───────────────────────────── JSON + lịch sử ─────────────────────────────

function applyJson() {
  if (!editable()) return toast('Bấm ✎ Sửa trước', 'err');
  try {
    const obj = JSON.parse($('#json-text').value);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Level phải là JSON object');
    state.draft = obj;
    markDirty();
    renderOverview();
    $('#json-msg').textContent = 'Đã áp vào bản nháp — bấm Lưu để ghi lên server.';
    $('#json-msg').className = 'small ok';
  } catch (e) {
    $('#json-msg').textContent = e.message;
    $('#json-msg').className = 'small err';
  }
}

async function renderHistory() {
  const ul = $('#history-list');
  ul.innerHTML = '<li class="muted">Đang tải…</li>';
  let revs;
  try {
    revs = await api.revisions(state.pack, state.sel);
  } catch (e) {
    ul.innerHTML = `<li class="err">${esc(e.message)}</li>`;
    return;
  }
  ul.innerHTML = revs.map(r => `<li><b>r${esc(r.rev)}</b> · ${esc(r.kind)} · ${esc(shortUser(r.author))} · ${esc(fmtTime(r.created_at))}
      ${r.message ? `· <i>${esc(r.message)}</i>` : ''}${r.unlocked_edit ? ' <span class="badge warn">sửa không khoá</span>' : ''}
      ${r.sha && r.rev !== state.cur.rev && !packReadOnly() ? `<button data-revert="${esc(r.rev)}">Khôi phục bản này</button>` : ''}
      ${r.sha ? `<button data-view="${esc(r.rev)}">Xem JSON</button>` : ''}
      ${r.sha && features().webgame ? `<button data-play="${esc(r.rev)}" title="Chơi đúng bản này bằng game thật (bản đang mở giữ nguyên)">▶ Chơi r${esc(r.rev)}</button>` : ''}
      ${r.changes?.length ? `<ul class="changes">${r.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</li>`).join('');
  for (const b of $$('[data-revert]', ul)) {
    b.addEventListener('click', async () => {
      if (state.dirty) return toast('Lưu hoặc bỏ thay đổi trước', 'err');
      if (!(await confirmDialog(`Khôi phục r${b.dataset.revert}?`, 'Tạo một revision mới có nội dung của bản đó (lịch sử giữ nguyên).'))) return;
      try {
        await api.revert(state.pack, state.sel, Number(b.dataset.revert), state.cur.rev);
        await openLevel(state.sel, { force: true });
        renderHistory();
        scheduleReload();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }
  for (const b of $$('[data-play]', ul)) {
    b.addEventListener('click', () => playRevision(Number(b.dataset.play)).catch(e => toast(e.message, 'err')));
  }
  $('#plays-box').hidden = !features().plays;
  if (features().plays) renderPlays($('#plays-list'), state.pack, state.sel, state.cur?.rev).catch(e => { $('#plays-list').textContent = e.message; });
  for (const b of $$('[data-view]', ul)) {
    b.addEventListener('click', async () => {
      const r = await api.revision(state.pack, state.sel, Number(b.dataset.view));
      openDialog({ title: `Level ${state.sel} r${r.rev}`, html: `<pre>${esc(JSON.stringify(r.level, null, 2))}</pre>` });
    });
  }
}

function setTab(tab) {
  state.tab = tab;
  for (const b of $$('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  // Tab Tổng quan chứa khung game: tab khác chỉ che (class off), không display:none, để game vẫn chạy.
  $('#tab-overview').classList.toggle('off', tab !== 'overview' && tab !== 'play');
  for (const id of ['json', 'history']) $(`#tab-${id}`).hidden = id !== tab;
  if (state.draft) layOverview();
  if (tab === 'json' && state.draft) {
    $('#json-text').value = JSON.stringify(state.draft, null, 2);
    $('#json-text').readOnly = !editable();
    $('#json-msg').textContent = editable() ? '' : 'Chỉ xem — bấm ✎ Sửa để sửa JSON.';
  }
  if (tab === 'history' && state.sel) renderHistory();
  if ((tab === 'overview' || tab === 'play') && state.draft) drawPreview();
}

// ───────────────────────────── bộ: thao tác ─────────────────────────────

async function newPack() {
  const html = `<div class="grid2"><label>Tên bộ<input id="np-name" placeholder="vd: tuning_oct"></label>
    <label>Nền tảng<select id="np-platform"><option>android</option><option>ios</option><option>both</option></select></label>
    <label>Nhóm<input id="np-group" placeholder="(tuỳ chọn)"></label></div>
    <label>Mô tả<input id="np-desc"></label>`;
  const name = await openDialog({
    title: 'Bộ level mới', html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Tạo', primary: true, onClick: async dlg => {
        const n = $('#np-name', dlg).value.trim();
        await api.createPack(n, { platform: $('#np-platform', dlg).value, group: $('#np-group', dlg).value,
          description: $('#np-desc', dlg).value });
        return n;
      },
    }],
  });
  if (name) await loadPacks(name);
}

async function packMenu() {
  const p = packInfo();
  if (!p) return;
  const html = `<p class="muted small">Tạo bởi ${esc(shortUser(p.created_by))} · ${esc(fmtTime(p.created_at))} · ${esc(p.level_count)} level</p>
    <div class="grid2"><label>Đổi tên<input id="pm-rename" value="${esc(p.name)}"></label>
    <label>Nền tảng<select id="pm-platform">${['android', 'ios', 'both'].map(x => `<option ${x === p.platform ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Nhóm<input id="pm-group" value="${esc(p.group)}"></label>
    <label class="check"><input id="pm-prod" type="checkbox" ${p.production ? 'checked' : ''} ${can('production') ? '' : 'disabled'}> Production</label>
    <label class="check"><input id="pm-arch" type="checkbox" ${p.archived ? 'checked' : ''} ${can('archive') ? '' : 'disabled'}> Lưu trữ (chỉ đọc)</label></div>
    ${features().trash && !p.archived ? '<label>Lý do lưu trữ (bắt buộc khi lưu trữ; bộ lưu trữ bị xoá hẳn sau số ngày ở Thùng rác)<input id="pm-reason" maxlength="300"></label>' : ''}
    <label>Mô tả<input id="pm-desc" value="${esc(p.description)}"></label>`;
  const res = await openDialog({
    title: `Bộ ${p.name}`, html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Lưu', primary: true, onClick: async dlg => {
        const patch = { platform: $('#pm-platform', dlg).value, group: $('#pm-group', dlg).value,
          description: $('#pm-desc', dlg).value };
        if (can('production')) patch.production = $('#pm-prod', dlg).checked;
        if (can('archive')) patch.archived = $('#pm-arch', dlg).checked;
        if (patch.archived && !p.archived && features().trash) {
          patch.archive_reason = $('#pm-reason', dlg)?.value.trim() || '';
          if (patch.archive_reason.length < 3) throw new Error('Ghi lý do lưu trữ bộ');
        }
        await api.updatePack(p.name, patch);
        const to = $('#pm-rename', dlg).value.trim();
        if (to && to !== p.name) await api.renamePack(p.name, to);
        return to || p.name;
      },
    }],
  });
  if (res) await loadPacks(res);
}

const IMPORT_LABELS = {
  created: ['Tạo mới', 'ok'], updated: ['Cập nhật', 'ok'], unchanged: ['Giữ nguyên', 'muted'],
  conflict: ['Xung đột', 'err'], waiting: ['Chờ game', 'warn'], locked: ['Đang khoá', 'warn'], error: ['Lỗi', 'err'],
};

function importNote(it) {
  if (it.status === 'conflict' && it.base_rev == null) return `Level đã có trong tool (r${it.head_rev}, ${shortUser(it.author)}), chưa từng nhập từ file`;
  if (it.status === 'conflict') return `Tool đã sửa (r${it.head_rev}, ${shortUser(it.author)}) và file cũng khác bản nhập trước`;
  if (it.status === 'waiting') return `Tool đã sửa (r${it.head_rev}), file vẫn là bản nhập trước`;
  if (it.status === 'locked') return `${shortUser(it.holder)} đang sửa`;
  return it.detail || '';
}

/** Nhập file: xem trước trạng thái từng level rồi mới ghi. Level đã sửa trong tool chỉ bị ghi đè khi chọn rõ. */
async function importFile(file) {
  if (!file) return;
  let preview;
  try {
    preview = await api.importLevels(state.pack, file, { dryRun: true });
  } catch (e) {
    return toast(e.message, 'err');
  }
  const counts = Object.keys(IMPORT_LABELS).filter(k => preview[k]).map(k => `${preview[k]} ${IMPORT_LABELS[k][0].toLowerCase()}`);
  const kept = (preview.conflict || 0) + (preview.waiting || 0);
  const rows = preview.items.filter(it => it.status !== 'unchanged').slice(0, 300).map(it => {
    const [label, cls] = IMPORT_LABELS[it.status];
    const errs = it.errors?.length ? `<div class="err">${it.errors.map(esc).join('<br>')}</div>` : '';
    return `<tr><td>${esc(it.name)}</td><td class="${cls}">${esc(label)}</td><td>${esc(importNote(it))}${errs}</td></tr>`;
  }).join('');
  const html = `<p>${esc(file.name)} → bộ <b>${esc(state.pack)}</b>: ${esc(counts.join(', ') || 'không có level')}`
    + `${preview.skipped.length ? `; bỏ qua ${esc(preview.skipped.length)} file không phải level` : ''}.</p>`
    + (rows ? `<table><tr><th>Level</th><th>Trạng thái</th><th>Ghi chú</th></tr>${rows}</table>` : '')
    + (kept ? `<label class="check"><input id="imp-force" type="checkbox"> Ghi đè cả ${esc(kept)} level đã sửa trong tool (lịch sử vẫn giữ)</label>` : '')
    + '<p class="muted small">Level lỗi kiểm định vẫn nhập được dưới dạng bản nháp.</p>';
  const r = await openDialog({
    title: 'Xem trước khi nhập', html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Nhập', primary: true, onClick: async dlg => api.importLevels(state.pack, file, { force: !!$('#imp-force', dlg)?.checked }),
    }],
  });
  if (!r) return;
  const notWritten = (r.conflict || 0) + (r.waiting || 0) + (r.locked || 0) + (r.error || 0);
  toast(`Nhập ${file.name}: ${r.created} mới, ${r.updated} cập nhật, ${r.unchanged} giữ nguyên`
    + (notWritten ? `, ${notWritten} level không ghi (xung đột, đang khoá hoặc lỗi)` : ''), notWritten ? '' : 'ok');
  await loadLevels();
  if (state.sel && !state.dirty) await openLevel(state.sel, { force: true });
}

async function levelHub() {
  const opt = await api.levelhubOptions();
  const nums = state.levels.map(l => l.level);
  const from = nums.length ? Math.min(...nums) : 1, to = nums.length ? Math.max(...nums) : 1;
  const sel = (id, list, def) => `<select id="${id}">${list.map(x => `<option ${x === def ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  const html = `<p class="muted small">Gói zip LevelMetadata.json + Raw/&lt;n&gt;.json cho LevelBuild / BI (game ${esc(opt.game)}).</p>
    <div class="grid2"><label>Từ level<input id="lh-from" type="number" min="1" value="${from}"></label>
    <label>Đến level<input id="lh-to" type="number" min="1" value="${to}"></label>
    <label>OS${sel('lh-os', opt.os, packInfo()?.platform === 'ios' ? 'iOS' : 'Android')}</label>
    <label>Team${sel('lh-team', opt.teams, 'GD')}</label>
    <label>Why${sel('lh-why', ['', ...opt.why], '')}</label>
    <label>Geo${sel('lh-geo', ['', ...opt.geo], '')}</label>
    <label>Designer<input id="lh-designer" value="${esc(state.me.email)}"></label>
    <label>Version<input id="lh-ver" value="v1"></label></div>
    <label class="check"><input id="lh-missing" type="checkbox"> Cho phép thiếu level trong dải</label>
    ${state.bi?.configured ? `<label>Mô tả khi đẩy lên BI (bỏ trống, hoặc ≥ 100 ký tự)<textarea id="lh-desc"></textarea></label>
      <p class="muted small">Đẩy lên BI (${esc(state.bi.env)}) bắt buộc chọn Geo. Tên bộ trên BI dùng mã OS A / I.</p>` : ''}
    <div id="lh-report" class="small"></div>`;
  const body = dlg => ({
    from_lv: Number($('#lh-from', dlg).value), to_lv: Number($('#lh-to', dlg).value), os: $('#lh-os', dlg).value,
    team: $('#lh-team', dlg).value, why: $('#lh-why', dlg).value, geo: $('#lh-geo', dlg).value ? [$('#lh-geo', dlg).value] : [],
    designer: $('#lh-designer', dlg).value, version: $('#lh-ver', dlg).value, allow_missing: $('#lh-missing', dlg).checked,
  });
  // Kiểm tra chốt snapshot (revision từng level); Xuất / Đẩy với cùng tham số dùng đúng các bản đó dù có người sửa sau.
  let checked = null;
  const withSnapshot = dlg => {
    const b = body(dlg);
    if (checked && checked.key === JSON.stringify(b)) b.snapshot = checked.snapshot;
    return b;
  };
  const report = (dlg, r) => {
    if (r.snapshot) checked = { key: JSON.stringify(body(dlg)), snapshot: r.snapshot, at: new Date() };
    $('#lh-report', dlg).innerHTML = `${r.snapshot ? `<p class="muted">Đã chốt ${esc(r.snapshot.length)} level lúc ${esc(checked.at.toLocaleTimeString('vi-VN'))}: Xuất / Đẩy dùng đúng các bản này (đổi tham số thì kiểm tra lại).</p>` : ''}`
      + `<p><b>${esc(r.zipName)}</b> · ${esc(r.levelCount)} level`
      + `${r.missingTotal ? ` · <span class="warn">thiếu ${esc(r.missingTotal)}: ${esc(r.missing.slice(0, 30).join(', '))}</span>` : ''}</p>`
      + (r.errors.length ? `<p class="err">${r.errors.map(e => `Level ${esc(e.level)}: ${esc(e.errors[0])}`).join('<br>')}</p>` : '')
      + `<table><tr><th>Lv</th><th>Mech</th><th>Diff</th><th>Time</th><th>Props</th><th>Obstacle</th></tr>${r.rows.slice(0, 200).map(x =>
        `<tr><td>${esc(x.level)}</td><td>${esc(x.mechanics)}</td><td>${esc(x.difficulty)}</td><td>${esc(x.time)}</td><td>${esc(x.uniqueColor)}</td><td>${esc(x.obstacleInfos)}</td></tr>`).join('')}</table>`;
  };
  const biAction = state.bi?.configured ? [{
    label: `⬆ Đẩy lên BI (${state.bi.env})`, onClick: async dlg => {
      try {
        await uploadToBi(state.pack, { ...withSnapshot(dlg), description: $('#lh-desc', dlg).value.trim() }, $('#lh-report', dlg));
      } catch (e) {
        if (e.status === 422 && e.body.report) report(dlg, e.body.report);
        $('#lh-report', dlg).insertAdjacentHTML('afterbegin', `<p class="err">${esc(e.message)}</p>`);
        toast(e.message, 'err');
      }
      return false;
    },
  }] : [];
  await openDialog({
    title: `Xuất Level Hub — bộ ${state.pack}`, html, actions: [
      { label: 'Đóng', value: null },
      { label: 'Kiểm tra', onClick: async dlg => { report(dlg, await api.levelhubPreflight(state.pack, body(dlg))); return false; } },
      ...biAction,
      {
        label: 'Xuất zip', primary: true, onClick: async dlg => {
          try {
            await downloadResponse(await api.levelhubExport(state.pack, withSnapshot(dlg)), 'levelhub.zip');
            toast('Đã xuất gói Level Hub', 'ok');
          } catch (e) {
            if (e.status === 422 && e.body.report) {
              report(dlg, e.body.report);
              toast(e.message, 'err');
              return false;
            }
            throw e;
          }
        },
      },
    ],
  });
}

function showBiSetup() {
  openDialog({
    title: 'Chưa kết nối BI Level Hub',
    html: `<p>Server ${esc(game.toolName)} chưa có cấu hình BI nên chưa đọc được danh sách bộ trên Level Hub (đang chỉ có bộ local).</p>
      <ol class="small">
        <li>Copy <code>game/.env.example</code> thành <code>.env</code> ở gốc repo.</li>
        <li>Điền <code>${esc(game.envPrefix)}_BI_API_URL</code> (dev: <code>https://bi-be-dev.sonatgame.com</code>) và 4 giá trị
          <code>${esc(game.envPrefix)}_BI_FIREBASE_*</code> — Firebase Web App config của BI, cùng bộ với các tool level khác
          trên BI Center (tab Variables) hoặc hỏi team BI.</li>
        <li>Tắt server rồi chạy lại <code>ChayDev.bat</code>, mở <b>${esc(location.origin)}/app/</b> và đăng nhập bằng Google.</li>
      </ol>
      <p class="muted small">Tài khoản cần quyền Level Hub (Read / Create Asset Group) cho app <code>${esc(state.bi?.appId || '')}</code>.</p>`,
  });
}

// ───────────────────────────── realtime ─────────────────────────────

function share() {
  if (!state.sel) return toast('Mở một level trước');
  return openShare({ pack: state.pack, name: state.sel, rev: state.cur?.rev, draft: clone(state.draft), dirty: state.dirty });
}

const stepLevel = d => {
  const i = state.levels.findIndex(l => l.name === state.sel) + d;
  if (state.levels[i]) return openLevel(state.levels[i].name);
};

const VIEW_LABELS = { level: 'Level', library: 'Thư viện', order: 'Thứ tự', overview: 'Tổng quan bộ', activity: 'Hoạt động' };
const VIEW_ACTION = { level: 'global.level', library: 'global.library', order: 'global.reorder', overview: 'global.overview', activity: 'global.activity' };
const VIEW_WORDS = { level: 'sua editor', library: 'gallery anh luoi kho', order: 'xep sap xep reorder slot', overview: 'do kho chi so duong cong overview',
  activity: 'audit nhat ky ai sua' };

function showShortcuts() {
  return openShortcuts().then(renderHints);
}

/** Tìm nhanh (Ctrl+K): level của bộ đang mở, các bộ, các màn và mọi lệnh (kể cả lệnh nằm trong menu). */
function palette() {
  const ro = packReadOnly();
  const cmd = (group, label, run, { key = '', words = '', hidden = null } = {}) => ({ group, label, run, key: key && shortLabel(key), words, hidden });
  openPalette({
    levels: () => state.levels,
    searchText: lv => `${game.searchText?.(lv.summary || {}) || ''} ${lv.author || ''}`,
    onLevel: name => shell.openLevel(name).catch(e => toast(e.message, 'err')),
    commands: [
      ...VIEWS.map(v => cmd('Màn', `Màn ${VIEW_LABELS[v]}`, () => setView(v), { key: VIEW_ACTION[v], words: `man view ${VIEW_WORDS[v]}` })),
      ...state.packs.filter(p => !p.archived && p.name !== state.pack).map(p => cmd('Bộ', `Mở bộ ${p.name}`, () => {
        $('#pack-select').value = p.name;
        return selectPack(p.name);
      }, { words: `bo pack ${p.group || ''}` })),
      cmd('Lệnh', 'Level mới…', () => newLevel(), { key: 'global.newLevel', words: 'tao them', hidden: () => ro }),
      cmd('Lệnh', 'Nhập level từ file (zip / json)…', () => $('#file-import').click(), { words: 'import', hidden: () => ro }),
      cmd('Lệnh', 'Tải cả bộ về máy (zip)', () => $('#btn-export').click(), { words: 'export xuat download' }),
      cmd('Lệnh', 'Kiểm định cả bộ', () => setView('overview'), { words: 'validate loi' }),
      cmd('Lệnh', 'Xuất Level Hub…', () => levelHub(), { words: 'levelhub bi day upload', hidden: () => !features().levelhub }),
      cmd('Lệnh', 'Mở bộ từ BI Level Hub…', () => $('#btn-levelhub-bi').click(), { words: 'levelhub bi', hidden: () => !features().levelhub }),
      cmd('Lệnh', 'Thùng rác…', () => $('#btn-trash').click(), { words: 'trash khoi phuc da xoa', hidden: () => !features().trash }),
      cmd('Lệnh', 'Tạo bộ mới…', () => newPack(), { words: 'pack' }),
      cmd('Lệnh', 'Cài đặt bộ…', () => packMenu(), { words: 'pack doi ten production luu tru' }),
      cmd('Lệnh', 'Bản game WebGL…', () => openBuilds(), { words: 'build unity', hidden: () => !(features().webgame && can('gameBuilds')) }),
      cmd('Lệnh', 'Quản trị…', () => openAdmin(), { words: 'admin quyen', hidden: () => $('#btn-admin').hidden }),
      cmd('Lệnh', 'Phím tắt…', () => showShortcuts(), { key: 'global.shortcuts', words: 'keymap' }),
      cmd('Lệnh', 'Có gì mới…', () => openWhatsNew(), { words: 'release changelog' }),
      cmd('Lệnh', 'Đổi giao diện sáng / tối', () => $('#btn-theme').click(), { key: 'global.theme', words: 'theme dark light' }),
      cmd('Lệnh', 'Bố cục màn Level…', () => layoutDialog(), { words: 'layout cot an hien do rong' }),
      cmd('Lệnh', 'Chế độ tập trung (ẩn danh sách level)', () => setFocus(!focused()), { key: 'global.focus', words: 'focus' }),
    ],
  });
}

/** Lệnh của phím tắt (keymap.mjs); game thêm lệnh của mình qua game.shortcuts + game.onShortcut. */
const ACTIONS_RUN = {
  'global.palette': () => palette(),
  'global.search': () => {
    if (state.view === 'library') return views.library?.focusSearch();
    setView('level');
    $('#search').focus();
  },
  'global.newLevel': () => !packReadOnly() && newLevel(),
  'global.level': () => setView('level'),
  'global.library': () => setView('library'),
  'global.reorder': () => setView('order'),
  'global.overview': () => setView('overview'),
  'global.activity': () => setView('activity'),
  'global.theme': () => $('#btn-theme').click(),
  'global.shortcuts': () => showShortcuts(),
  'global.focus': () => { setView('level'); setFocus(!focused()); },
  'level.save': () => save(),
  'level.edit': () => (state.editing ? stopEdit() : startEdit()),
  'level.play': () => features().webgame && play(),
  'level.share': () => features().share && share(),
  'level.prev': () => stepLevel(-1),
  'level.next': () => stepLevel(1),
  'level.tabOverview': () => setTab('overview'),
  'level.tabJson': () => setTab('json'),
  'level.tabHistory': () => setTab('history'),
};
for (const a of game.shortcuts || []) ACTIONS_RUN[a.id] ||= () => game.onShortcut?.(a.id, { state });

function onEvent(type, d) {
  if (type === 'connection') {
    $('#conn').classList.toggle('on', d.online);
    $('#conn-text').textContent = d.online ? 'Đã kết nối' : 'Mất kết nối — đang thử lại';
    return;
  }
  if (type === 'presence') {
    renderOnline(d.online || []);
    return;
  }
  if (type === 'game.build') {
    if (features().webgame) onBuildEvent(d, d.author === state.me.email);
    renderGameStatus();
    return;
  }
  if (type === 'settings.updated') {
    showNotice(d.notice);
    api.me().then(me => { state.me = me; }).catch(() => {});
    return;
  }
  if (type.startsWith('pack.') && type !== 'pack.imported') {
    loadPacks(type === 'pack.renamed' && d.from === state.pack ? d.to : state.pack).catch(() => {});
    return;
  }
  if (d.pack !== state.pack) return;
  scheduleReload();
  const mine = d.author === state.me.email || d.by === state.me.email;
  if ((type === 'level.updated' || type === 'level.created') && d.name === state.sel && !mine && state.cur && d.rev !== state.cur.rev) {
    if (state.dirty) toast(`${shortUser(d.author)} vừa lưu level ${d.name} r${d.rev} — bạn sẽ gặp xung đột khi lưu`, 'err');
    else openLevel(state.sel, { force: true });
  }
  if (type === 'level.deleted' && d.name === state.sel && !mine) toast(`${shortUser(d.author)} đã xoá level ${d.name}`, 'err');
  if (type === 'levels.renumbered' && !mine && state.sel && d.moves.some(m => m.from === state.sel || m.to === state.sel)) {
    toast(`${shortUser(d.author)} vừa đổi số level — tải lại`, 'err');
  }
  if ((type === 'lock.acquired' || type === 'lock.released') && d.level === state.sel && state.cur && !mine) {
    state.cur.lock = type === 'lock.acquired' ? { holder: d.holder } : null;
    renderPanel();
  }
}

// ───────────────────────────── gắn sự kiện ─────────────────────────────

function wire() {
  $('#pack-select').addEventListener('change', e => (e.target.value.startsWith('hub:') ? pickHub(e.target.value)
    : selectPack(e.target.value)));
  $('#btn-hub-sync').addEventListener('click', async () => {
    const p = packInfo(), id = hubIdOf(p);
    if (!id) return;
    const ok = await confirmDialog('Cập nhật từ Level Hub?', `Tải lại toàn bộ level của bộ ${p.name} từ BI. Level khác bản trên `
      + 'Level Hub (kể cả bản bạn đã sửa ở đây) thành revision mới — lịch sử vẫn giữ, có thể khôi phục.', 'Cập nhật');
    if (ok) await openHubPack({ id, name: p.description.split(' ').slice(1).join(' ') || p.name }, { refresh: true });
  });
  $('#btn-new-pack').addEventListener('click', newPack);
  $('#btn-pack-menu').addEventListener('click', packMenu);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
  $('#btn-export').addEventListener('click', async () => downloadResponse(await api.exportPack(state.pack), `${state.pack}.zip`));
  $('#btn-trash').addEventListener('click', () => openTrash({ canArchive: can('archive'), onChanged: () => loadPacks(state.pack) }).catch(e => toast(e.message, 'err')));
  $('#btn-admin').addEventListener('click', () => openAdmin().catch(e => toast(e.message, 'err')));
  $('#btn-keys').addEventListener('click', () => showShortcuts());
  $('#hintbar').addEventListener('click', e => { if (e.target.closest('[data-keys]')) showShortcuts(); });
  $('#btn-share').addEventListener('click', () => Promise.resolve(share()).catch(e => toast(e.message, 'err')));
  $('#btn-palette').addEventListener('click', () => palette());
  for (const b of $$('.views-nav button')) b.addEventListener('click', () => setView(b.dataset.view));
  $('#st-game').addEventListener('click', () => openBuilds().then(renderGameStatus).catch(e => toast(e.message, 'err')));
  $('#btn-prev').addEventListener('click', () => stepLevel(-1));
  $('#btn-next').addEventListener('click', () => stepLevel(1));
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    if (state.draft) drawPreview();
  });
  $('#btn-logout').addEventListener('click', async () => {
    devUser.set('');
    session.set('');
    try { await api.logout(); } catch { /* bỏ qua */ }
    location.reload();
  });
  $('#btn-levelhub-bi').addEventListener('click', () => !state.bi?.configured ? showBiSetup() :
    openLevelHubBrowser(state.pack, packReadOnly(), async () => {
      await loadLevels();
      if (state.sel && !state.dirty) await openLevel(state.sel, { force: true });
    }, g => openHubPack(g, { refresh: true })));

  $('#search').addEventListener('input', renderList);
  $('#filter-mode').addEventListener('change', renderList);
  $('#btn-new-level').addEventListener('click', () => newLevel().catch(e => toast(e.message, 'err')));
  $('#level-list').addEventListener('click', e => {
    const li = e.target.closest('li[data-name]');
    if (li) openLevel(li.dataset.name);
    const del = e.target.closest('li[data-deleted]');
    if (del) restoreDeleted(del.dataset.deleted);
  });

  $('#btn-edit').addEventListener('click', startEdit);
  $('#btn-done').addEventListener('click', stopEdit);
  $('#btn-save').addEventListener('click', save);
  $('#btn-revert').addEventListener('click', () => revertDraft().catch(e => toast(e.message, 'err')));
  $('#btn-delete').addEventListener('click', deleteLevel);
  $('#btn-relevel').addEventListener('click', relevel);
  $('#btn-promote').addEventListener('click', () => promote());
  // menu (⋯, tài khoản): bấm một mục thì đóng; bấm ra ngoài hoặc mở menu khác cũng đóng
  for (const m of $$('.more-menu')) {
    $('.menu', m).addEventListener('click', () => m.removeAttribute('open'));
    m.addEventListener('toggle', () => { if (m.open) for (const o of $$('.more-menu')) if (o !== m) o.removeAttribute('open'); });
  }
  document.addEventListener('click', e => { for (const m of $$('.more-menu')) if (!m.contains(e.target)) m.removeAttribute('open'); });
  $('#btn-whatsnew').addEventListener('click', () => openWhatsNew());
  $('#btn-focus').addEventListener('click', () => setFocus(!focused()));
  $('#lv-valid').addEventListener('click', () => {
    setTab('overview');
    const card = $('#valid-card');
    card.scrollIntoView({ block: 'nearest' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1200);
  });
  $('#btn-play').addEventListener('click', () => play().catch(e => toast(e.message, 'err')));
  $('#btn-layout').addEventListener('click', () => layoutDialog());
  $('#btn-layout-menu').addEventListener('click', () => { setView('level'); layoutDialog(); });
  wireGrips($('#view-level'));
  $('#btn-download').addEventListener('click', () =>
    downloadBlob(new Blob([JSON.stringify(state.draft, null, 2) + '\n'], { type: 'application/json' }), `${state.sel}.json`));
  $('#btn-json-apply').addEventListener('click', applyJson);
  for (const b of $$('.level-head .tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

  document.addEventListener('keydown', e => {
    if ($('.dialog-backdrop, .palette-backdrop')) return;
    const id = actionFor(e);
    const run = ACTIONS_RUN[id];
    if (!run || (id.startsWith('level.') && (!state.sel || state.view !== 'level'))) return;
    e.preventDefault();
    Promise.resolve(run()).catch(err => toast(err.message, 'err'));
  });
  addEventListener('beforeunload', e => { if (state.dirty) e.preventDefault(); });
  addEventListener('resize', () => { if (state.draft && state.tab === 'overview') drawPreview(); });
  sync.on('*', onEvent);
  sync.on('lock.lost', () => {
    state.editing = false;
    toast('Mất khoá level (hết hạn hoặc bị phá) — bấm ✎ Sửa để khoá lại', 'err');
    if (state.cur) renderPanel();
  });
}

boot();
