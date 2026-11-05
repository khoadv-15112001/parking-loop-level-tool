import { api, authHeaders, downloadResponse } from './api.mjs';
import { biLogin, clearBiLogin, currentBiLogin } from './biauth.mjs';
import { groupId } from './levelhub_bi.mjs';
import { NAME_LABELS, nameParts, nameProblems, pointerLevel, selectedReport, today } from './levelhub_model.mjs';
import { $, confirmDialog, esc, fmtTime, openDialog, toast } from './ui.mjs';

const COLORS = ['var(--lc-ok)', 'var(--lc-warn)', 'var(--lc-err)', 'var(--lc-accent)'];
const MAX_THUMBS = 300;
const options = (list, value) => list.map(x => `<option${x === value ? ' selected' : ''}>${esc(x)}</option>`).join('');

export async function openLevelHub({ pack, levels, packInfo = {}, email = '', bi = {}, game = {}, canUpload = true, onOpenLevel }) {
  const opt = await api.levelhubOptions();
  let why = opt.why[0] || '';
  if (!levels.length) return toast('Bộ chưa có level để xuất');
  const numbers = levels.map(x => x.level).filter(Number.isInteger).sort((a, b) => a - b);
  const first = numbers[0], last = numbers.at(-1);
  if (!first || !last) return toast('Bộ chưa có số level hợp lệ');
  let dlg, closeDialog, busy = false, closed = false, loading = true, checked = null, requestId = 0;
  let nameCheck = null, checkId = 0, checkTimer = null, trackTimer = null, dragStart = null;
  let report = { rows: [], errors: [], warnings: [], previewsSupported: false };
  const urls = new Map(), controllers = new Set();
  const labels = game.levelhub?.difficultyLabels || ['Normal', 'Hard', 'VeryHard'];
  const labelOf = value => labels[value] ?? `Độ khó ${value}`;
  const colorOf = value => COLORS[Math.abs(Number(value) || 0) % COLORS.length];
  const html = `<fieldset id="hub-form" class="hub-grid"><div class="hub-main">
    <section class="hub-card"><h4><span class="hub-step">1</span> Chọn level</h4>
      <div class="hub-range"><label>Từ số<input id="lh-from" type="number" min="1" value="${first}"></label><span>→</span>
      <label>Đến số<input id="lh-to" type="number" min="1" value="${last}"></label><div id="lh-presets" class="hub-chips"></div></div>
      <canvas id="lh-strip" class="hub-strip" aria-label="Kéo để chọn dải level, Shift+bấm để nới dải"></canvas>
      <div id="lh-legend" class="hub-chips small muted"></div><div id="lh-stats" class="hub-chips" aria-live="polite"></div>
      <div id="lh-problems"></div><div id="lh-thumbs" class="hub-thumbs"></div></section>
    <section class="hub-card"><h4><span class="hub-step">2</span> Thông tin group</h4><div class="hub-fields">
      <label>Nền tảng<select id="lh-os">${options(opt.os, packInfo.platform === 'ios' ? 'iOS' : 'Android')}</select></label>
      <label>Designer<input id="lh-designer" value="${esc(email.split('@')[0].replace(/[^A-Za-z0-9]/g, ''))}" maxlength="120"></label>
      <label>Team<select id="lh-team">${options(opt.teams, 'GD')}</select></label>
      <label>Ngày (ddMM)<span class="hub-inline"><input id="lh-date" value="${today()}" maxlength="4"><button type="button" id="lh-today">Hôm nay</button></span></label>
      <label>Version<span class="hub-inline"><button type="button" id="lh-minus" aria-label="Giảm version">−</button><input id="lh-ver" value="v01" maxlength="9"><button type="button" id="lh-plus" aria-label="Tăng version">+</button></span></label>
      </div><div><span class="muted small">GEO (chọn nhiều)</span><div id="lh-geos" class="hub-chips">${opt.geo.map(x => `<button type="button" data-geo="${esc(x)}" aria-pressed="${x === 'Global'}" class="${x === 'Global' ? 'active' : ''}">${esc(x)}</button>`).join('')}
      <input id="lh-custom-geo" aria-label="GEO khác, ngăn bằng dấu phẩy" placeholder="GEO khác" title="Nhiều GEO ngăn bằng dấu phẩy"></div></div>
      <div><span class="muted small">Why</span><div id="lh-whys" class="hub-chips">${opt.why.map((x, i) => `<button type="button" data-why="${esc(x)}" aria-pressed="${i === 0}" class="${i === 0 ? 'active' : ''}">${esc(x)}</button>`).join('')}
      <input id="lh-why" aria-label="Lý do khác" placeholder="Lý do khác" maxlength="120"></div></div>
      <label>Mô tả<textarea id="lh-desc" rows="3" maxlength="2000" placeholder="Không bắt buộc; nếu nhập thì tối thiểu 100 ký tự"></textarea><span id="lh-desc-count" class="small muted"></span></label>
      <label class="check"><input id="lh-previews" type="checkbox" checked> Kèm ảnh game (Previews/)</label><div id="lh-preview-note" class="small muted"></div>
      <label class="check"><input id="lh-missing" type="checkbox"> Cho phép thiếu level trong dải</label>
      <div id="lh-checked" class="small muted" aria-live="polite"></div></section></div>
    <aside class="hub-side"><section class="hub-card"><h4>Tên group</h4><div id="lh-name" class="hub-name"></div>
      <div id="lh-name-errors" class="err small"></div><div id="lh-name-check" class="small" aria-live="polite"></div></section>
      <section class="hub-card"><h4>Sẽ gửi</h4><div id="lh-summary" class="hub-summary"></div>
      <div id="lh-bi" class="small muted"></div></section><div id="lh-report" class="small" aria-live="polite"></div>
      <section class="hub-card"><h4>Các lần đẩy của bộ này</h4><div id="lh-history" class="hub-history small">Đang tải…</div></section></aside></fieldset>`;
  const field = id => $(`#lh-${id}`, dlg);
  const body = () => ({ from_lv: Number(field('from').value), to_lv: Number(field('to').value), os: field('os').value,
    team: field('team').value, designer: field('designer').value.trim(), date: field('date').value.trim(), version: field('ver').value.trim(),
    geo: [...new Set([...dlg.querySelectorAll('[data-geo][aria-pressed="true"]')].map(x => x.dataset.geo)
      .concat(field('custom-geo').value.split(',').map(x => x.trim()).filter(Boolean)))], why: field('why').value.trim() || why,
    previews: report.previewsSupported && field('previews').checked, allow_missing: field('missing').checked });
  const key = b => JSON.stringify(b);
  const selection = () => { const b = body(); return selectedReport(report, b.from_lv, b.to_lv); };
  const invalid = () => !dlg || loading || nameProblems(opt.game, body()).size > 0;
  const blocked = () => invalid() || !selection().rows.length || selection().errors.length > 0 || (selection().missing.length > 0 && !body().allow_missing);
  const needsCheck = () => !checked || checked.key !== key(body());
  const pushDisabled = () => busy || blocked() || !bi.configured || !canUpload || needsCheck()
    || (nameCheck?.key === key(body()) && nameCheck.available === false)
    || (field('desc').value.trim().length > 0 && field('desc').value.trim().length < 100);
  function updateButtons() {
    const buttons = dlg.querySelectorAll(':scope > .actions > button');
    buttons[0].disabled = busy;
    buttons[1].disabled = busy || invalid();
    buttons[2].disabled = busy || blocked() || needsCheck();
    buttons[3].disabled = pushDisabled();
    $('#hub-form', dlg).disabled = busy || loading;
  }
  function draw() {
    const canvas = field('strip'), width = canvas.clientWidth, height = 64;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = height * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const b = body(), rows = report.rows;
    const errors = new Set(report.errors.map(x => x.level));
    const max = Math.max(1, ...rows.map(x => Number(x.time) || 0));
    const color = v => getComputedStyle(dlg).getPropertyValue(v.slice(4, -1)).trim();
    rows.forEach((row, i) => {
      const h = 16 + Math.max(0, Number(row.time) || 0) / max * 44;
      ctx.globalAlpha = row.level >= b.from_lv && row.level <= b.to_lv ? 1 : .25;
      ctx.fillStyle = color(errors.has(row.level) ? 'var(--lc-err)' : colorOf(row.difficulty));
      ctx.fillRect(i * width / rows.length, height - h, Math.max(1, width / rows.length - 1), h);
    });
    ctx.globalAlpha = 1;
  }
  function fillImages() {
    imageObserver.disconnect();
    for (const box of field('thumbs').querySelectorAll('[data-image]')) imageObserver.observe(box);
  }
  const imageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const box = entry.target;
      imageObserver.unobserve(box);
      const sha = box.dataset.image;
      if (!urls.has(sha)) {
        const controller = new AbortController(); controllers.add(controller);
        urls.set(sha, fetch(`/api/thumbs/${sha}`, { headers: authHeaders(), credentials: 'same-origin', signal: controller.signal })
          .then(async r => r.ok ? URL.createObjectURL(await r.blob()) : null).catch(() => null)
          .finally(() => controllers.delete(controller)));
      }
      urls.get(sha).then(url => {
        if (closed && url) { URL.revokeObjectURL(url); return; }
        if (url && box.isConnected) box.innerHTML = `<img src="${url}" loading="lazy" decoding="async" alt="Ảnh game">`;
      });
    }
  }, { rootMargin: '80px' });
  function render() {
    if (closed) return;
    const b = body(), s = selection(), problems = nameProblems(opt.game, b);
    field('name').innerHTML = nameParts(opt.game, b).map((value, i) => `<span class="hub-token ${problems.has(i) ? 'err' : ''}"><b>${esc(value || '∅')}</b><small>${NAME_LABELS[i]}</small></span>${i < 8 ? '<span class="muted">_</span>' : ''}`).join('');
    field('name-errors').innerHTML = [...problems.values()].map(esc).join('<br>');
    const groupOrder = (a, c) => String(a).localeCompare(String(c), 'vi', { numeric: true });
    field('legend').innerHTML = [...new Set(report.rows.map(x => x.difficulty))].sort(groupOrder).map(x => `<span><i style="background:${colorOf(x)}"></i>${esc(labelOf(x))}</span>`).join('') + '<span>Kéo để chọn · Shift+bấm để nới · cột cao theo thời gian</span>';
    field('stats').innerHTML = `<b class="hub-stat">${s.rows.length} level</b>` + [...s.groups].sort(([a], [c]) => groupOrder(a, c)).map(([v, n]) => `<span class="hub-stat"><i style="background:${colorOf(v)}"></i><b>${n}</b> ${esc(labelOf(v))}</span>`).join('')
      + `<span class="hub-stat">${s.previewCount}/${s.rows.length} có ảnh</span><span class="hub-stat ${s.errors.length || s.missing.length ? 'err' : 'ok'}">${s.errors.length} lỗi · ${s.missing.length} thiếu</span>`;
    const link = (x, text) => `<button type="button" class="link" data-level="${esc(x.name ?? s.rows.find(r => r.level === x.level)?.name ?? x.level)}">Level ${esc(x.level)}: ${esc(text)}</button>`;
    field('problems').innerHTML = (s.errors.length ? `<div class="hub-callout err"><b>${s.errors.length} level lỗi: sửa trước khi gửi</b>${s.errors.slice(0, 24).map(x => link(x, x.errors.join('; '))).join('')}</div>` : '')
      + (s.missing.length ? `<div class="hub-callout warn">Thiếu ${s.missing.length} số level: ${s.missing.slice(0, 30).join(', ')}${s.missing.length > 30 ? '…' : ''}</div>` : '')
      + (s.warnings.length ? `<div class="hub-callout warn"><b>${s.warnings.length} điểm cần xem lại (vẫn đẩy được)</b>${s.warnings.slice(0, 12).map(x => link(x, x.text)).join('')}${s.warnings.length > 12 ? `<span>+${s.warnings.length - 12} điểm khác</span>` : ''}</div>` : '');
    field('thumbs').innerHTML = s.rows.slice(0, MAX_THUMBS).map(x => `<button type="button" class="hub-thumb" data-level="${esc(x.name)}" title="Level ${esc(x.level)} · r${x.rev}">
      <span class="hub-image"${x.preview ? ` data-image="${esc(x.sha)}"` : ''} style="border-color:${colorOf(x.difficulty)}">${x.preview ? '…' : '—'}</span><small>${esc(x.level)}</small></button>`).join('') + (s.rows.length > MAX_THUMBS ? `<span class="hub-stat">+${s.rows.length - MAX_THUMBS}</span>` : '');
    field('summary').innerHTML = `<b>${esc(pack)}</b><span>Gửi <b>${s.rows.length} level</b> · số ${esc(b.from_lv)}–${esc(b.to_lv)}</span><span>${b.previews ? `${s.previewCount} ảnh game` : 'Không kèm ảnh'}</span>
      <span>Tới <b>${esc(b.os)}</b> · BI ${esc(bi.env || 'chưa cấu hình')}</span><span class="muted">${checked && !needsCheck() ? 'Đúng revision đã kiểm tra' : 'Chưa chốt revision: bấm Kiểm tra'}</span>`;
    field('preview-note').textContent = report.previewsSupported ? 'Chỉ kèm ảnh game đã chụp của đúng nội dung level; thiếu ảnh vẫn gửi được.' : 'Server này chưa hỗ trợ kèm ảnh game; ZIP vẫn có raw và metadata.';
    field('previews').disabled = !report.previewsSupported;
    field('checked').textContent = checked && !needsCheck() ? `Đã chốt ${checked.snapshot.length} level lúc ${checked.at}; Xuất / Đẩy dùng đúng các bản này.` : 'Bấm Kiểm tra sau khi chọn dải và thông tin group để chốt bản gửi.';
    const length = field('desc').value.trim().length;
    field('desc-count').textContent = length ? `${length}/100 ký tự tối thiểu${length < 100 ? ' — chưa đủ để đẩy' : ''}` : '';
    field('desc-count').classList.toggle('warn', length > 0 && length < 100);
    field('bi').textContent = bi.configured ? `BI ${bi.env} · ${bi.apiUrl} · ${currentBiLogin()?.email || 'Chưa đăng nhập BI'}` : 'Chưa cấu hình BI; vẫn tải ZIP được.';
    if (!canUpload) field('bi').textContent += ' Bạn chưa có quyền đẩy Level Hub.';
    field('name-check').innerHTML = nameCheck?.key === key(b) ? nameCheck.html : bi.configured ? '<button type="button" id="lh-check-name">Đăng nhập BI / kiểm tra tên</button>' : '<span class="muted">BI chưa cấu hình: chỉ tải ZIP</span>';
    for (const preset of field('presets').children) preset.classList.toggle('active', Number(preset.dataset.from) === b.from_lv && Number(preset.dataset.to) === b.to_lv);
    updateButtons(); draw(); fillImages();
  }
  function changed() {
    checked = null; checkId++; nameCheck = null;
    render(); clearTimeout(checkTimer);
    if (bi.configured && currentBiLogin() && !invalid()) checkTimer = setTimeout(() => checkName(false), 700);
  }
  async function checkName(interactive = true) {
    if (invalid() || !bi.configured) return;
    const login = interactive ? biLogin() : Promise.resolve(currentBiLogin());
    const id = ++checkId, b = body(), k = key(b);
    nameCheck = { key: k, html: '<span class="muted">Đang kiểm tra tên trên BI…</span>' }; render();
    try {
      const account = await login;
      if (!account) return;
      const result = await api.levelhubCheck(pack, b, account.token);
      if (closed || id !== checkId || k !== key(body())) return;
      nameCheck = { key: k, available: result.available, html: result.available ? '<span class="ok">Tên hợp lệ, chưa có trên BI</span>' : `<span class="warn">Tên đã có trên BI.</span>${result.suggestion ? ` <button type="button" data-version="${esc(result.suggestion)}">Dùng ${esc(result.suggestion)}</button>` : ' Đổi version rồi kiểm tra lại.'}` };
    } catch (e) {
      if (e.body?.bi_status === 401) clearBiLogin();
      if (!closed && id === checkId) nameCheck = { key: k, html: `<span class="err">${esc(e.message)}</span><button type="button" id="lh-check-name">Thử lại</button>` };
    }
    render();
  }
  async function check() {
    const b = body(), k = key(b), id = ++requestId;
    const r = await api.levelhubPreflight(pack, b);
    if (closed || id !== requestId || k !== key(body())) throw new Error('Thông tin đã đổi; bấm Kiểm tra lại');
    const outside = x => x.level < b.from_lv || x.level > b.to_lv;
    report = { ...r, rows: report.rows.filter(outside).concat(r.rows).sort((a, c) => a.level - c.level),
      errors: report.errors.filter(outside).concat(r.errors), warnings: (report.warnings || []).filter(outside).concat(r.warnings || []) };
    checked = { key: k, snapshot: r.snapshot, at: new Date().toLocaleTimeString('vi-VN') };
    render();
    return { ...b, snapshot: r.snapshot };
  }
  async function history() {
    try {
      const rows = await api.audit({ pack, action: 'levelhub.bi_upload', limit: 8 });
      if (closed) return;
      field('history').innerHTML = rows.map(x => `<div class="hub-history-item"><b>${esc(x.detail?.zip)}</b><span class="muted">${esc(x.detail?.levels)} level · ${esc(x.user)} · ${fmtTime(x.ts)} · ${esc(x.detail?.env)}</span>${x.detail?.group && x.detail.env === bi.env ? `<button type="button" data-track="${esc(x.detail.group)}">Xem trạng thái trên BI</button>` : ''}</div>`).join('') || '<span class="muted">Bộ này chưa đẩy lần nào</span>';
    } catch (e) { if (!closed) field('history').textContent = e.message; }
  }
  async function track(id, interactive = false) {
    clearTimeout(trackTimer);
    try {
      const login = interactive ? await biLogin() : currentBiLogin();
      if (!login || closed) return;
      const g = await api.biGroup(login.token, id);
      if (closed) return;
      field('report').innerHTML = `<div class="hub-callout ${g.status === 'FAILED' ? 'err' : g.status === 'READY' ? 'ok' : ''}"><b>${esc(g.status || 'Đã gửi')}</b><span>${esc(g.name || g.groupName || '')}</span>${g.failureReason ? `<span>${esc(g.failureReason)}</span>` : ''}${g.status === 'PROCESSING' ? '<span>BI đang xử lý; tự cập nhật mỗi 5 giây.</span>' : ''}</div>`;
      if (g.status === 'PROCESSING') trackTimer = setTimeout(() => track(id), 5000);
    } catch (e) { if (e.body?.bi_status === 401) clearBiLogin(); if (!closed) field('report').textContent = e.message; }
  }
  async function run(action) {
    const login = action === 'push' ? biLogin() : null;
    busy = true; updateButtons();
    try {
      const account = login ? await login : null;
      if (action === 'check') await check();
      else {
        if (needsCheck()) throw new Error('Thông tin đã đổi; bấm Kiểm tra trước khi gửi');
        const b = { ...body(), snapshot: checked.snapshot };
        if (action === 'zip') { await downloadResponse(await api.levelhubExport(pack, b), 'levelhub.zip'); toast('Đã tải gói Level Hub', 'ok'); }
        else {
          const name = nameParts(opt.game, b).join('_');
          if (!(await confirmDialog('Đẩy bộ lên BI?', `${name}\n${selection().rows.length} level · ${b.os} · BI ${bi.env}\nĐúng revision đã kiểm tra.`, '⇧ Đẩy lên BI'))) return false;
          const result = await api.levelhubUpload(pack, { ...b, description: field('desc').value.trim() }, account.token);
          field('report').innerHTML = `<div class="hub-callout ok">Đã gửi ${esc(result.name)} (${result.levelCount} level).${result.recovered ? ' Đã tìm lại bộ sau khi BI mất phản hồi.' : ''}${result.newer?.length ? ` Level ${esc(result.newer.join(', '))} đã có bản mới; gói dùng bản đã kiểm tra.` : ''}</div>`;
          toast(`Đã gửi ${result.name}`, 'ok');
          const id = result.group && groupId(result.group);
          if (id) track(id);
          history(); nameCheck = { key: key(body()), available: false, html: '<span class="warn">Đã đẩy tên này. Tăng version hoặc đổi thông tin group để gửi bộ mới.</span>' };
        }
      }
    } catch (e) {
      field('report').innerHTML = `<div class="hub-callout err">${esc(e.message)}</div>`;
      if (e.body?.bi_status === 401) clearBiLogin();
      if (e.status === 409 || e.body?.report) checked = null;
      toast(e.message, 'err');
    } finally { busy = false; render(); }
    return false;
  }
  const resize = new ResizeObserver(() => { if (dlg && !closed) draw(); });
  return openDialog({ title: `Level Hub · ${pack}${packInfo.production ? ' · Production' : ' · Nháp'}`, html, wide: true,
    canClose: () => !busy,
    onClose: () => { closed = true; checkId++; requestId++; clearTimeout(checkTimer); clearTimeout(trackTimer); resize.disconnect(); imageObserver.disconnect();
      for (const controller of controllers) controller.abort(); for (const url of urls.values()) url.then(x => { if (x) URL.revokeObjectURL(x); }); },
    actions: [ { label: 'Đóng', disabled: () => busy }, { label: 'Kiểm tra', disabled: () => busy || invalid(), onClick: () => run('check') },
      { label: '⇩ Tải ZIP', disabled: () => busy || blocked() || needsCheck(), onClick: () => run('zip') },
      { label: '⇧ Đẩy lên BI', primary: true, disabled: () => !dlg || pushDisabled(), onClick: () => run('push') } ],
    onOpen: (root, close) => {
      dlg = root; closeDialog = close; dlg.classList.add('hub-dialog');
      field('presets').innerHTML = [[first, last, 'Cả bộ'], ...[50, 100, 200].filter(n => n >= first && n < last).map(n => [first, n, `${first}–${n}`])]
        .map(([a, b, label]) => `<button type="button" data-from="${a}" data-to="${b}">${label}</button>`).join('');
      const setRange = (a, b) => { field('from').value = Math.min(a, b); field('to').value = Math.max(a, b); changed(); };
      dlg.addEventListener('input', e => {
        if (e.target.id === 'lh-why') for (const x of dlg.querySelectorAll('[data-why]')) {
          const active = !field('why').value.trim() && x.dataset.why === why;
          x.classList.toggle('active', active); x.setAttribute('aria-pressed', active);
        }
        if (e.target.id === 'lh-desc') render(); else changed();
      });
      dlg.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') changed(); });
      dlg.addEventListener('click', e => {
        const button = e.target.closest('button'); if (!button || busy || loading) return;
        if (button.dataset.from) setRange(Number(button.dataset.from), Number(button.dataset.to));
        if (button.dataset.geo) { const pressed = button.getAttribute('aria-pressed') !== 'true'; button.setAttribute('aria-pressed', pressed); button.classList.toggle('active', pressed); changed(); }
        if (button.dataset.why) { why = button.dataset.why; field('why').value = ''; for (const x of dlg.querySelectorAll('[data-why]')) { x.classList.toggle('active', x === button); x.setAttribute('aria-pressed', x === button); } changed(); }
        if (button.id === 'lh-today') { field('date').value = today(); changed(); }
        if (button.id === 'lh-plus' || button.id === 'lh-minus') { const n = Math.max(1, Math.min(99999999, (Number(field('ver').value.replace(/^v/i, '')) || 1) + (button.id === 'lh-plus' ? 1 : -1))); field('ver').value = `v${String(n).padStart(2, '0')}`; changed(); }
        if (button.id === 'lh-check-name') checkName();
        if (button.dataset.version) { field('ver').value = button.dataset.version; changed(); }
        if (button.dataset.level) { closeDialog(); onOpenLevel?.(button.dataset.level); }
        if (button.dataset.track) track(button.dataset.track, true);
      });
      const canvas = field('strip');
      const levelAt = e => { const rect = canvas.getBoundingClientRect(); return pointerLevel(report.rows, e.clientX - rect.left, rect.width); };
      canvas.addEventListener('pointerdown', e => { if (busy || loading) return; const n = levelAt(e); if (n == null) return;
        dragStart = e.shiftKey ? (Math.abs(n - body().from_lv) < Math.abs(n - body().to_lv) ? body().to_lv : body().from_lv) : n;
        canvas.setPointerCapture(e.pointerId); setRange(dragStart, n); });
      canvas.addEventListener('pointermove', e => { if (dragStart != null) setRange(dragStart, levelAt(e)); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { dragStart = null; });
      resize.observe(canvas); render(); history();
      api.levelhubPreflight(pack, body()).then(r => { if (!closed) { report = r; loading = false; render(); } })
        .catch(e => { if (!closed) { loading = false; field('report').textContent = e.message; render(); } });
    },
  });
}
