// BI Level Hub (port từ AntLevel ui/levelhub_import_dialog.mjs + phần "Đẩy lên BI" của levelhub_dialog.mjs):
//   openLevelHubBrowser — dropdown các bộ (asset group) của game đang có trên Level Hub → chọn file level → nhập vào bộ đang mở.
//   uploadToBi          — đẩy gói Level Hub của dải level lên BI rồi theo dõi trạng thái xử lý.
import { api } from './api.mjs';
import { biLogin, clearBiLogin } from './biauth.mjs';
import { $, $$, confirmDialog, esc, fmtTime, openDialog, toast } from './ui.mjs';

// BI trả trang dạng {items, total, currentPage, totalPages, hasMore}; giữ đủ các tên trường AntLevel đã gặp.
const itemsOf = r => (Array.isArray(r) ? r : r?.items || r?.groups || r?.files || r?.data?.items || []);
const morePages = (r, page) => {
  if (r?.hasMore != null) return !!r.hasMore;
  if (r?.has_more != null) return !!r.has_more;
  const total = Number(r?.totalPages ?? r?.total_pages);
  return Number.isFinite(total) && total ? page < total : false;
};
const groupId = g => g.id ?? g.groupId ?? g._id;
const groupName = g => g.name ?? g.groupName ?? g.title ?? String(groupId(g));
const groupStatus = g => g.status ?? g.state ?? '';
// Nền tảng của bộ: metadata.os (BI parse từ tên) hoặc đoạn thứ 2 của tên Game_OS_… (A / I)
const osOf = g => {
  const os = String(g.metadata?.os ?? String(groupName(g)).split('_')[1] ?? '');
  return /^a/i.test(os) ? 'Android' : /^i/i.test(os) ? 'iOS' : os;
};
const fileId = f => f.fileId ?? f.id ?? f._id;
const fileLevel = f => {
  const n = Number(f.level ?? /(\d+)\.json$/i.exec(f.fileName ?? f.name ?? '')?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isJson = f => /json/i.test(f.contentType ?? f.mimeType ?? f.fileType ?? f.type ?? '') || /\.json$/i.test(f.fileName ?? f.name ?? '');

async function allPages(fetchPage) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetchPage(page);
    if (r?.warning && page === 1) toast(r.warning, 'err');   // vd appId iOS sai: server trả bộ Android kèm cảnh báo
    out.push(...itemsOf(r));
    if (!morePages(r, page)) break;
  }
  return out;
}

// ───── Bộ Level Hub = bộ riêng trong ô chọn bộ ─────
// Mỗi bộ (asset group) trên Level Hub được mở thành một bộ riêng của tool (nhóm "Level Hub", mô tả "levelhub:<id> …"),
// tách khỏi các bộ local. Bộ này là bản sao để xem / sửa / kiểm định; "↻ Cập nhật từ Level Hub" tải lại từ BI.
export const HUB_GROUP = 'Level Hub';
export const hubIdOf = p => /^levelhub:(\S+)/.exec(p?.description || '')?.[1] ?? null;
export const hubOptionText = g => `${groupName(g)} · ${osOf(g)}${groupStatus(g) ? ` — ${groupStatus(g)}` : ''}`;
export { groupId, groupName, groupStatus, osOf };

/** Danh sách bộ trên Level Hub (biLogin trước tiên — có thể mở popup). */
export async function listHubGroups() {
  const login = await biLogin();
  return allPages(page => api.biGroups(login.token, page, ''));
}

function hubPackName(g, packs) {
  const id = String(groupId(g));
  const base = String(groupName(g)).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64) || `hub_${id}`;
  if (!packs.some(p => p.name === base)) return base;
  const tag = `_${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
  return base.slice(0, 64 - tag.length) + tag;
}

/** Tạo (nếu chưa có) bộ riêng cho bộ Level Hub g rồi tải toàn bộ level của nó về. Trả {pack, total, created, updated, unchanged}. */
export async function syncHubPack(g, packs, onProgress = () => {}) {
  const login = await biLogin();
  const id = String(groupId(g));
  let pack = packs.find(p => hubIdOf(p) === id)?.name;
  const files = (await allPages(page => api.biFiles(login.token, id, page)))
    .filter(f => isJson(f) && fileLevel(f) && fileId(f) != null).sort((a, b) => fileLevel(a) - fileLevel(b));
  if (!pack) {
    pack = hubPackName(g, packs);
    await api.createPack(pack, { group: HUB_GROUP, platform: osOf(g) === 'iOS' ? 'ios' : 'android',
      description: `levelhub:${id} ${groupName(g)}` });
  }
  const out = { pack, total: files.length, created: 0, updated: 0, unchanged: 0 };
  for (let i = 0; i < files.length; i += 25) {   // tải 25 level / lượt, 5 request song song
    const chunk = files.slice(i, i + 25), levels = {};
    for (let j = 0; j < chunk.length; j += 5) {
      await Promise.all(chunk.slice(j, j + 5).map(async f => {
        levels[fileLevel(f)] = await api.biFileRaw(login.token, id, fileId(f));
      }));
      onProgress(Math.min(i + j + 5, files.length), files.length);
    }
    const r = await api.importJson(pack, { levels }, `Level Hub: ${groupName(g)}`, { force: true });   // bộ riêng = bản sao của BI
    for (const k of ['created', 'updated', 'unchanged']) out[k] += r[k] || 0;
  }
  return out;
}

/** Nút "⇩ Level Hub": phải gọi trong lúc xử lý click (biLogin mở popup).
 *  onOpenPack(g) — mở cả bộ Level Hub g thành bộ riêng. */
export async function openLevelHubBrowser(pack, readOnly, onImported, onOpenPack) {
  let login;
  try {
    login = await biLogin();
  } catch (e) {
    return toast(`Đăng nhập BI lỗi: ${e.message}`, 'err');
  }
  let groups;
  const fetchGroups = archived => allPages(page => api.biGroups(login.token, page, '', archived));
  try {
    groups = await fetchGroups(false);
  } catch (e) {
    return toast(`Không tải được danh sách bộ trên Level Hub: ${e.message}`, 'err');
  }
  if (!groups.length) return toast('Level Hub chưa có bộ nào của game này (bộ đã lưu trữ bị ẩn).');

  let files = [], picked = new Set(), seq = 0;
  const options = list => list.map(g => `<option value="${esc(groupId(g))}">${esc(groupName(g))} · ${esc(osOf(g))}`
    + `${groupStatus(g) ? ` — ${esc(groupStatus(g))}` : ''}</option>`).join('');
  const html = `<p class="muted small" id="lhb-count"></p>
    <div class="grid2"><label>Tìm bộ<input id="lhb-search" type="search" placeholder="vd: 1_21, retention, khoadv"></label>
    <label>Bộ trên Level Hub<select id="lhb-group">${options(groups)}</select></label></div>
    <div class="row"><label class="check"><input id="lhb-archived" type="checkbox"> Hiện cả bộ đã lưu trữ</label></div>
    <div id="lhb-info" class="small"></div>
    <div class="row" id="lhb-actions">
      <button id="lhb-retry" title="Chạy lại bộ FAILED từ ZIP đã lưu (quyền Update Asset Group)">↻ Chạy lại</button>
      <button id="lhb-build" title="Yêu cầu Unity CI dựng bundle (quyền Update Asset Group)">⚙ Yêu cầu build</button>
      <button id="lhb-archive" class="danger" title="Lưu trữ mềm, không xoá file (quyền Manage Asset Group)">Lưu trữ bộ</button>
    </div>
    <div class="row"><label class="check"><input id="lhb-all" type="checkbox"> Chọn tất cả</label><span id="lhb-sum" class="small"></span></div>
    <div id="lhb-files" class="lhb-files"></div>`;

  const current = dlg => groups.find(x => String(groupId(x)) === $('#lhb-group', dlg).value);
  const paintInfo = dlg => {
    const g = current(dlg);
    $('#lhb-count', dlg).textContent = `${groups.length} bộ trên Level Hub (${login.email}). Chọn bộ để xem các level trong đó.`;
    if (!g) return void ($('#lhb-info', dlg).textContent = '');
    const st = groupStatus(g);
    $('#lhb-info', dlg).innerHTML = `<b class="${st === 'FAILED' ? 'err' : st === 'READY' ? 'ok' : 'warn'}">${esc(st || '?')}</b>`
      + [osOf(g), g.createdBy || g.owner, fmtTime(g.createdAt || g.updatedAt)].filter(Boolean).map(x => ` · ${esc(x)}`).join('')
      + (g.currentStep ? ` · đang ở bước <b>${esc(g.currentStep)}</b>` : '')
      + (st === 'FAILED' ? `<div class="err">Lỗi${g.failedStep ? ` ở bước ${esc(g.failedStep)}` : ''}: ${esc(g.failureReason || '(BI không ghi lý do)')}</div>` : '')
      + (g.description ? `<div class="muted">${esc(g.description)}</div>` : '');
    $('#lhb-retry', dlg).disabled = st !== 'FAILED';
    $('#lhb-build', dlg).disabled = st !== 'PROCESSING' && st !== 'FAILED';
    $('#lhb-archive', dlg).disabled = st === 'ARCHIVED';
  };
  const act = async (dlg, action, label) => {
    const g = current(dlg);
    if (!g) return;
    if (action === 'archive' && !(await confirmDialog(`Lưu trữ bộ ${groupName(g)}?`,
      'Lưu trữ mềm trên Level Hub (không xoá file). Bộ sẽ ẩn khỏi danh sách mặc định.', 'Lưu trữ', true))) return;
    try {
      const upd = await api.biGroupAction(login.token, groupId(g), action);
      toast(`${label}: ${groupName(g)} → ${groupStatus({ ...g, ...upd }) || 'đã gửi'}`, 'ok');
      // tải lại danh sách: bộ vừa lưu trữ sẽ ẩn khi chưa bật "Hiện cả bộ đã lưu trữ"
      groups = await fetchGroups($('#lhb-archived', dlg).checked);
      const sel = $('#lhb-group', dlg), id = String(groupId(g));
      sel.innerHTML = options(groups);
      $('#lhb-search', dlg).value = '';
      if (groups.some(x => String(groupId(x)) === id)) { sel.value = id; paintInfo(dlg); } else load(dlg);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const load = async dlg => {
    const my = ++seq;
    const id = $('#lhb-group', dlg).value;
    paintInfo(dlg);
    $('#lhb-files', dlg).innerHTML = '<div class="muted">Đang tải…</div>';
    picked.clear();
    $('#lhb-all', dlg).checked = false;
    try {
      const list = await allPages(page => api.biFiles(login.token, id, page));
      if (my !== seq) return;
      files = list.filter(f => isJson(f) && fileLevel(f) && fileId(f) != null).sort((a, b) => fileLevel(a) - fileLevel(b));
      $('#lhb-files', dlg).innerHTML = files.length ? files.map((f, i) => `<label class="check"><input type="checkbox" data-i="${i}">
          <b>${esc(fileLevel(f))}</b> <span class="muted small">${esc(f.fileName || f.name || '')}</span></label>`).join('')
        : '<div class="muted">Bộ này không có file level JSON (có thể đang chờ xử lý).</div>';
      summary(dlg);
    } catch (e) {
      if (my === seq) $('#lhb-files', dlg).innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
  const summary = dlg => {
    const ns = [...picked].map(i => fileLevel(files[i])).sort((a, b) => a - b);
    $('#lhb-sum', dlg).textContent = ns.length ? `Đã chọn ${ns.length}: ${ns.slice(0, 40).join(', ')}${ns.length > 40 ? '…' : ''}` : '';
  };

  await openDialog({
    title: 'Bộ trên Level Hub',
    html,
    onOpen: dlg => {
      const sel = $('#lhb-group', dlg);
      sel.addEventListener('change', () => load(dlg));
      $('#lhb-search', dlg).addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        const keep = groups.filter(g => !q || groupName(g).toLowerCase().includes(q));
        const cur = sel.value;
        sel.innerHTML = options(keep);
        if (keep.some(g => String(groupId(g)) === cur)) sel.value = cur;
        else if (keep.length) load(dlg);
      });
      $('#lhb-archived', dlg).addEventListener('change', async e => {
        try {
          groups = await fetchGroups(e.target.checked);
        } catch (err) {
          return toast(err.message, 'err');
        }
        sel.innerHTML = options(groups);
        $('#lhb-search', dlg).value = '';
        if (groups.length) load(dlg); else paintInfo(dlg);
      });
      $('#lhb-retry', dlg).addEventListener('click', () => act(dlg, 'retry', 'Chạy lại'));
      $('#lhb-build', dlg).addEventListener('click', () => act(dlg, 'build', 'Yêu cầu build'));
      $('#lhb-archive', dlg).addEventListener('click', () => act(dlg, 'archive', 'Lưu trữ'));
      $('#lhb-files', dlg).addEventListener('change', e => {
        const i = Number(e.target.dataset.i);
        if (!Number.isInteger(i)) return;
        if (e.target.checked) picked.add(i); else picked.delete(i);
        summary(dlg);
      });
      $('#lhb-all', dlg).addEventListener('change', e => {
        picked = e.target.checked ? new Set(files.map((_, i) => i)) : new Set();
        for (const cb of $$('#lhb-files input[type=checkbox]', dlg)) cb.checked = e.target.checked;
        summary(dlg);
      });
      load(dlg);
    },
    actions: [{ label: 'Đóng', value: null }, {
      label: `Nhập level đã chọn vào ${pack}`, onClick: async dlg => {
        if (readOnly) throw new Error(`Bộ ${pack} chỉ đọc (production / lưu trữ) — chọn bộ khác để nhập`);
        if (!picked.size) throw new Error('Chọn ít nhất một level');
        const chosen = [...picked].map(i => files[i]);
        const g = groups.find(x => String(groupId(x)) === $('#lhb-group', dlg).value);
        const ns = chosen.map(fileLevel).sort((a, b) => a - b);
        if (!(await confirmDialog('Nhập từ Level Hub?', `Bộ đích: ${pack}. Bộ Level Hub: ${groupName(g)}. ${ns.length} level `
          + `(${ns.slice(0, 30).join(', ')}${ns.length > 30 ? '…' : ''}). Level cùng số chưa sửa trong tool được cập nhật bằng `
          + 'revision mới; level đã sửa trong tool hoặc đang có người khoá thì giữ nguyên.', 'Nhập'))) return false;
        const levels = {};
        for (const f of chosen) levels[fileLevel(f)] = await api.biFileRaw(login.token, groupId(g), fileId(f));
        const r = await api.importJson(pack, { levels }, `Level Hub: ${groupName(g)}`);
        const kept = (r.conflict || 0) + (r.waiting || 0) + (r.locked || 0);
        toast(`Đã nhập từ Level Hub vào ${pack}: ${r.created} mới, ${r.updated} cập nhật, ${r.unchanged} giữ nguyên`
          + (kept ? `, ${kept} level đã sửa trong tool hoặc đang khoá nên không ghi` : ''), kept ? '' : 'ok');
        await onImported?.();
        return true;
      },
    }, {
      label: 'Mở thành bộ riêng', primary: true, onClick: async dlg => {
        const g = current(dlg);
        if (!g) throw new Error('Chọn một bộ');
        onOpenPack?.(g);
        return true;
      },
    }],
  });
}

/** "Đẩy lên BI" trong hộp Xuất Level Hub: body = tham số xuất (from_lv, to_lv, os, geo, …) + description. */
export async function uploadToBi(pack, body, reportEl, { track = true, signal } = {}) {
  signal?.throwIfAborted();
  const login = await biLogin();   // việc đầu tiên trong click: popup chỉ mở được lúc còn thao tác người dùng
  signal?.throwIfAborted();
  let res;
  try {
    res = await api.levelhubUpload(pack, body, login.token);
  } catch (e) {
    if (e.body?.bi_status === 401) clearBiLogin();
    throw e;
  }
  const id = res.group && groupId(res.group);
  reportEl.innerHTML = `<p class="ok">Đã gửi bộ <b>${esc(res.name)}</b> (${esc(res.levelCount)} level) lên BI. `
    + 'BI đang xử lý (chờ Unity CI dựng bundle — PROCESSING lâu là bình thường).</p>'
    + (res.recovered ? '<p class="warn">BI không trả lời lúc tạo bộ, nhưng đã thấy bộ này trên BI — không cần đẩy lại.</p>' : '')
    + (res.newer?.length ? `<p class="muted">Level ${esc(res.newer.join(', '))} đã được sửa sau khi kiểm tra; gói dùng bản đã kiểm tra.</p>` : '');
  toast(`Đã đẩy ${res.name} lên BI Level Hub`, 'ok');
  if (!id || !track) return res;
  for (let i = 0; i < 12; i++) {   // theo dõi ~1 phút
    await new Promise(r => setTimeout(r, 5000));
    if (signal?.aborted || !reportEl.isConnected) return res;
    let g;
    try {
      g = await api.biGroup(login.token, id);
    } catch {
      continue;
    }
    if (signal?.aborted || !reportEl.isConnected) return res;
    const st = groupStatus(g);
    if (st === 'READY' || st === 'FAILED') {
      reportEl.insertAdjacentHTML('beforeend', `<p class="${st === 'READY' ? 'ok' : 'err'}">Trạng thái: ${esc(st)}`
        + `${g.failedStep ? ` ở bước ${esc(g.failedStep)}` : ''}${g.failureReason ? ` — ${esc(g.failureReason)}` : ''}`
        + `${st === 'FAILED' ? ' (sửa rồi đẩy lại, hoặc ↻ Chạy lại trong ⇩ Level Hub)' : ''}</p>`);
      return res;
    }
  }
  reportEl.insertAdjacentHTML('beforeend', '<p class="muted">BI vẫn đang xử lý — xem tiếp trên trang Level Hub của BI.</p>');
  return res;
}
