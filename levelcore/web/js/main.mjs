// Vỏ app web của level-tool-core (chung mọi game; phần riêng của game ở ../game/game.mjs — xem levelcore/README.md).
// Bố cục như FishLevel: chọn bộ → danh sách level → panel level (Tổng quan / JSON / Lịch sử), khoá khi sửa, lưu theo If-Match (412 → so sánh),
// realtime qua SSE, nhập / xuất zip, kiểm định cả bộ, promote sang bộ production, xuất Level Hub.
import { api, ApiError, devUser, downloadBlob, downloadResponse, session } from './api.mjs';
import { biSessionLogin } from './biauth.mjs';
import {
  groupId, groupName, hubIdOf, hubOptionText, listHubGroups, openLevelHubBrowser, syncHubPack, uploadToBi,
} from './levelhub_bi.mjs';
import { diffPaths, renderFields } from './fields.mjs';
import { parseLevelQuery, queryMatches } from './query.mjs';
import { $, $$, confirmDialog, esc, fmtTime, openDialog, shortUser, toast } from './ui.mjs';
import { highlight as gameHighlight, isPreviewing, mountDock, refreshPreview, showLevel } from './webgame.mjs';
import * as sync from './sync.mjs';
import game from '../game/game.mjs';

const PACK_KEY = `${game.storagePrefix}.pack`;
const THEME_KEY = `${game.storagePrefix}.theme`;

const state = {
  me: null,
  packs: [],
  pack: null,
  levels: [],
  deleted: [],
  invalid: new Map(),   // name -> errors (sau "Kiểm định bộ")
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
const packInfo = () => state.packs.find(p => p.name === state.pack);
const packReadOnly = () => { const p = packInfo(); return !p || p.archived || p.production; };

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
  $('#me').textContent = shortUser(state.me.email);
  api.authStatus().then(st => {   // phiên bản trên BI = tag phát hành (<slug>-v0.1.0 → v0.1.0); local = dev
    const v = String(st.version || '');
    $('#app-version').textContent = game.versionPrefix && v.startsWith(game.versionPrefix) ? v.slice(game.versionPrefix.length) : v;
  }).catch(() => {});
  try {
    state.bi = await api.biConfig();
  } catch {
    state.bi = { configured: false };
  }
  $('#btn-levelhub-bi').hidden = !features().levelhub;
  $('#btn-levelhub').hidden = !features().levelhub;
  if (!state.bi.configured) $('#btn-levelhub-bi').title = 'Chưa kết nối BI Level Hub — bấm để xem cách cấu hình';
  wire();
  if (features().webgame) mountDock($('#game-dock'), game.webgame);
  else {
    $('#game-dock').innerHTML = '<p class="muted small dock-off">Server này chưa có chơi thử bằng bản WebGL của game.</p>';
    $('#btn-play').hidden = true;
  }
  sync.startEvents();
  await loadPacks(localStorage.getItem(PACK_KEY));
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
  state.invalid.clear();
  localStorage.setItem(PACK_KEY, name);
  closeLevel();
  await loadLevels();
  const p = packInfo();
  $('#btn-new-level').disabled = packReadOnly();
  $('#btn-import').disabled = packReadOnly();
  $('#btn-hub-sync').hidden = !hubIdOf(p) || !state.bi?.configured;
  if (p?.production) toast(`Bộ ${name} là production: chỉ nhận level promote từ bộ khác.`);
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
  }
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
  $('#list-stats').textContent = `${items.length} / ${state.levels.length} level`
    + (state.invalid.size ? ` · ${state.invalid.size} lỗi kiểm định` : '');
  $('#level-list').innerHTML = items.map(lv => {
    const it = game.listItem?.(lv.summary || {}) || {};
    const lock = lv.lock ? `<span class="badge warn" title="Đang sửa">🔒 ${esc(shortUser(lv.lock.holder))}</span>` : '';
    const bad = state.invalid.has(lv.name);
    return `<li data-name="${esc(lv.name)}" class="${lv.name === state.sel ? 'sel' : ''} ${bad ? 'invalid' : ''}">
      <span class="num">${esc(lv.name)}</span>
      <span class="tags">${it.tags || ''}${bad ? '<span class="badge err">lỗi</span>' : ''}${lock}</span>
      <span class="sub muted small">${it.sub ? `${esc(it.sub)} · ` : ''}r${esc(lv.head_rev)} · ${esc(shortUser(lv.author))} · ${esc(fmtTime(lv.updated_at))}</span>
    </li>`;
  }).join('') || '<li class="muted">Chưa có level — bấm Nhập để đưa level từ game vào.</li>';
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

function closeLevel() {
  state.sel = state.cur = state.draft = null;
  $('#panel-body').hidden = true;
  $('#panel-empty').hidden = false;
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
  renderList();
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
  $('#lv-lock').textContent = state.editing ? '✎ Bạn đang sửa' : lock ? `🔒 ${shortUser(lock.holder)} đang sửa` : 'Chỉ xem';
  const ro = packReadOnly();
  $('#btn-edit').hidden = state.editing;
  $('#btn-edit').disabled = ro;
  $('#btn-done').hidden = !state.editing;
  $('#btn-delete').disabled = ro;
  $('#btn-relevel').disabled = packInfo()?.archived;
  markDirty();
  renderOverview();
  if (state.tab === 'json') $('#json-text').value = JSON.stringify(state.draft, null, 2);
}

function renderOverview() {
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
  } else if (!game.fields?.length) {
    $('#lc-game-form', col).innerHTML = '<section class="card"><p class="muted small">Game chưa khai field nào — sửa ở tab JSON.</p></section>';
  }
  const v = game.validateLevel(state.draft, { levelNo: Number(state.sel) });
  $('#validation').innerHTML = v.errors.map(x => `<div class="err">${esc(x)}</div>`).join('')
    + v.warnings.map(x => `<div class="warn">${esc(x)}</div>`).join('')
    + (v.isValid ? '<div class="ok">Hợp lệ</div>' : '');
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
async function showInGame(mode = 'preview') {
  if (!state.sel || !state.draft || !features().webgame) return;
  if (mode === 'play') {
    const errs = game.validateLevel(state.draft).errors || [];
    if (errs.length && !(await confirmDialog('Level đang lỗi kiểm định', `${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} lỗi)` : ''}. `
      + 'Game có thể từ chối mở level này. Vẫn chơi thử?', 'Vẫn chơi'))) return;
  }
  const pack = state.pack;
  previewKey = visualKey(state.draft);
  await showLevel(pack, state.sel, clone(state.draft), mode);   // chỉ level này — không tải cả bộ
}

async function promote() {
  const targets = state.packs.filter(p => p.name !== state.pack && !p.archived);
  const def = targets.find(p => p.production)?.name || targets[0]?.name;
  if (!def) return toast('Chưa có bộ nào khác để promote sang');
  const html = `<p class="muted small">Chép bản đã lưu (r${esc(state.cur.rev)}) sang bộ khác sau khi qua kiểm định. Bộ production chỉ nhận level theo đường này.</p>
    <div class="grid2"><label>Sang bộ<select id="pm-to">${targets.map(p => `<option ${p.name === def ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label>Số level đích<input id="pm-num" type="number" min="1" value="${esc(state.sel)}"></label></div>
    <label>Ghi chú<input id="pm-msg" placeholder="vd: giảm time 10%"></label><div id="pm-err" class="err small"></div>`;
  const res = await openDialog({
    title: `Promote level ${state.sel}`, html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Promote', primary: true, onClick: async dlg => {
        if (state.dirty) throw new Error('Lưu thay đổi trước khi promote');
        try {
          return await api.promote(state.pack, $('#pm-to', dlg).value,
            [{ name: state.sel, to: $('#pm-num', dlg).value }], $('#pm-msg', dlg).value);
        } catch (e) {
          if (e.status === 422 && e.body.validation) {
            $('#pm-err', dlg).innerHTML = e.body.validation.map(v => v.errors.map(esc).join('<br>')).join('<br>');
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
  for (const id of ['overview', 'json', 'history']) $(`#tab-${id}`).hidden = id !== tab;
  if (tab === 'json' && state.draft) {
    $('#json-text').value = JSON.stringify(state.draft, null, 2);
    $('#json-text').readOnly = !editable();
    $('#json-msg').textContent = editable() ? '' : 'Chỉ xem — bấm ✎ Sửa để sửa JSON.';
  }
  if (tab === 'history' && state.sel) renderHistory();
  if (tab === 'overview' && state.draft) drawPreview();
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
    <label class="check"><input id="pm-prod" type="checkbox" ${p.production ? 'checked' : ''} ${state.me.admin ? '' : 'disabled'}> Production</label>
    <label class="check"><input id="pm-arch" type="checkbox" ${p.archived ? 'checked' : ''} ${state.me.admin ? '' : 'disabled'}> Lưu trữ (chỉ đọc)</label></div>
    <label>Mô tả<input id="pm-desc" value="${esc(p.description)}"></label>`;
  const res = await openDialog({
    title: `Bộ ${p.name}`, html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Lưu', primary: true, onClick: async dlg => {
        const patch = { platform: $('#pm-platform', dlg).value, group: $('#pm-group', dlg).value,
          description: $('#pm-desc', dlg).value };
        if (state.me.admin) Object.assign(patch, { production: $('#pm-prod', dlg).checked, archived: $('#pm-arch', dlg).checked });
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

async function validatePack() {
  toast('Đang kiểm định cả bộ…');
  const res = await api.validatePack(state.pack);
  state.invalid = new Map(res.filter(r => !r.isValid).map(r => [r.name, r.errors]));
  renderList();
  const bad = res.filter(r => !r.isValid);
  const pick = await openDialog({
    title: `Kiểm định bộ ${state.pack}: ${res.length - bad.length}/${res.length} hợp lệ`,
    html: bad.length ? `<p class="muted small">Bấm số level để mở level đó.</p><table><tr><th>Level</th><th>Lỗi</th></tr>${bad.map(r =>
      `<tr><td><button data-open="${esc(r.name)}">${esc(r.name)}</button></td><td>${r.errors.map(esc).join('<br>')}</td></tr>`).join('')}</table>`
      : '<p class="ok">Mọi level đều hợp lệ.</p>',
    onOpen: (dlg, close) => dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-open]');
      if (b) close({ open: b.dataset.open });
    }),
  });
  if (pick?.open) await openLevel(pick.open);
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
  const report = (dlg, r) => {
    $('#lh-report', dlg).innerHTML = `<p><b>${esc(r.zipName)}</b> · ${esc(r.levelCount)} level`
      + `${r.missingTotal ? ` · <span class="warn">thiếu ${esc(r.missingTotal)}: ${esc(r.missing.slice(0, 30).join(', '))}</span>` : ''}</p>`
      + (r.errors.length ? `<p class="err">${r.errors.map(e => `Level ${esc(e.level)}: ${esc(e.errors[0])}`).join('<br>')}</p>` : '')
      + `<table><tr><th>Lv</th><th>Mech</th><th>Diff</th><th>Time</th><th>Props</th><th>Obstacle</th></tr>${r.rows.slice(0, 200).map(x =>
        `<tr><td>${esc(x.level)}</td><td>${esc(x.mechanics)}</td><td>${esc(x.difficulty)}</td><td>${esc(x.time)}</td><td>${esc(x.uniqueColor)}</td><td>${esc(x.obstacleInfos)}</td></tr>`).join('')}</table>`;
  };
  const biAction = state.bi?.configured ? [{
    label: `⬆ Đẩy lên BI (${state.bi.env})`, onClick: async dlg => {
      try {
        await uploadToBi(state.pack, { ...body(dlg), description: $('#lh-desc', dlg).value.trim() }, $('#lh-report', dlg));
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
            await downloadResponse(await api.levelhubExport(state.pack, body(dlg)), 'levelhub.zip');
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

async function showAudit() {
  const items = await api.audit({ pack: state.pack, limit: 300 });
  openDialog({
    title: `Audit — bộ ${state.pack}`,
    html: `<table><tr><th>Lúc</th><th>Ai</th><th>Việc</th><th>Level</th><th>Chi tiết</th></tr>${items.map(a =>
      `<tr><td>${esc(fmtTime(a.ts))}</td><td>${esc(shortUser(a.user))}</td><td>${esc(a.action)}</td><td>${esc(a.level ?? '')}${a.rev ? ` r${esc(a.rev)}` : ''}</td>
        <td>${esc(a.detail?.changes ? a.detail.changes.join('; ') : a.detail ? JSON.stringify(a.detail).slice(0, 200) : '')}</td></tr>`).join('')}</table>`,
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

function onEvent(type, d) {
  if (type === 'connection') {
    $('#conn').classList.toggle('on', d.online);
    return;
  }
  if (type === 'presence') {
    $('#online').textContent = d.online ? `${d.online.length} online` : '';
    $('#online').title = (d.online || []).join('\n');
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
  $('#btn-validate').addEventListener('click', () => validatePack().catch(e => toast(e.message, 'err')));
  $('#btn-levelhub').addEventListener('click', () => levelHub().catch(e => toast(e.message, 'err')));
  $('#btn-audit').addEventListener('click', () => showAudit().catch(e => toast(e.message, 'err')));
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
  $('#btn-promote').addEventListener('click', promote);
  // menu ⋯: bấm một mục thì đóng menu; bấm ra ngoài cũng đóng
  $('.more-menu .menu').addEventListener('click', () => $('.more-menu').removeAttribute('open'));
  document.addEventListener('click', e => { if (!e.target.closest('.more-menu')) $('.more-menu').removeAttribute('open'); });
  $('#btn-play').addEventListener('click', () => showInGame('play').catch(e => toast(e.message, 'err')));
  $('#btn-download').addEventListener('click', () =>
    downloadBlob(new Blob([JSON.stringify(state.draft, null, 2) + '\n'], { type: 'application/json' }), `${state.sel}.json`));
  $('#btn-json-apply').addEventListener('click', applyJson);
  for (const b of $$('.tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.sel) {
      e.preventDefault();
      const i = state.levels.findIndex(l => l.name === state.sel) + (e.key === 'ArrowRight' ? 1 : -1);
      if (state.levels[i]) openLevel(state.levels[i].name);
    }
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
