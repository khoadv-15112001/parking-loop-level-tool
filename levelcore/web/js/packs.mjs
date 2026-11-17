// Quản lý bộ (server Node, features.packflow): danh sách bộ có mã cố định, mục đích, trạng thái, người phụ trách, nơi đang
// chạy; chi tiết một bộ: gửi duyệt / duyệt, bàn giao, ghi chú, version (so sánh bằng ảnh, khôi phục), nhân bản. Thẻ
// "Bộ khác & người chơi" của một level: bộ cùng nội dung, bộ đang giữ bản cũ (áp bản mới), số liệu người chơi từ BI.
import { api, authHeaders } from './api.mjs';
import { $, esc, fmtTime, openDialog, shortUser, toast } from './ui.mjs';

export const STATUS_LABEL = { draft: 'Nháp', review: 'Chờ duyệt', live: 'Live', archived: 'Lưu trữ' };
const STATUS_CLASS = { draft: '', review: 'warn', live: 'ok', archived: 'muted' };
const KIND_LABEL = { push: 'Đẩy BI', snapshot: 'Chốt tay', apply: 'Duyệt bản nháp', restore: 'Khôi phục' };
const DIFF_LABEL = { edited: ['Sửa', 'warn'], replaced: ['Thay', 'err'], moved: ['Đổi chỗ', ''], added: ['Thêm', 'ok'], removed: ['Bớt', 'err'] };
const DEPLOY_FIELDS = [['remote_config', 'Remote Config key'], ['ab_group', 'Nhóm AB'], ['app_version', 'Bản app']];
const NOTE_FIELDS = [['goal', 'Mục tiêu độ khó'], ['design', 'Lưu ý thiết kế'], ['todo', 'Việc đang dở']];
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);

export const statusChip = s => `<span class="chip ${STATUS_CLASS[s] || ''}">${esc(STATUS_LABEL[s] || s)}</span>`;
export const packLabel = p => (p.code ? `${p.code} · ${p.name}` : p.name);
const purposeLabel = (shell, key) => (shell.state.me?.pack_purposes || []).find(x => x.key === key)?.label || key || '';
const deployText = d => DEPLOY_FIELDS.filter(([k]) => d?.[k]).map(([k]) => d[k]).join(' · ');

async function ask(title, label, { required = true, value = '', placeholder = '', multiline = false, hint = '' } = {}) {
  const input = multiline
    ? `<textarea id="ask-v" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input id="ask-v" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return openDialog({
    title, html: `${hint ? `<p class="muted small">${hint}</p>` : ''}<label>${esc(label)}${input}</label>`,
    actions: [{ label: 'Huỷ', value: null }, {
      label: 'Đồng ý', primary: true, onClick: async dlg => {
        const v = $('#ask-v', dlg).value.trim();
        if (required && v.length < 3) throw new Error(`Cần ${label.toLowerCase()} (ít nhất 3 ký tự)`);
        return v;
      },
    }],
  });
}

// ───────────────────────────── danh sách bộ ─────────────────────────────

function listHtml(shell, f) {
  const me = shell.state.me?.email;
  const counts = { active: 0, draft: 0, review: 0, live: 0, archived: 0 };
  for (const p of shell.state.packs) {
    counts[p.status] = (counts[p.status] || 0) + 1;
    if (p.status !== 'archived') counts.active++;
  }
  const q = f.q.toLowerCase();
  const rows = shell.state.packs.filter(p => {
    if (f.status === 'active' ? p.status === 'archived' : p.status !== f.status) return false;
    if (f.purpose && p.purpose !== f.purpose) return false;
    if (f.mine && p.owner !== me) return false;
    return !q || [p.code, p.name, p.owner, p.group, deployText(p.deploy)].some(x => String(x || '').toLowerCase().includes(q));
  });
  const facet = (key, label) => `<button data-status="${key}" class="${f.status === key ? 'active' : ''}">${esc(label)} <span class="muted">${counts[key] || 0}</span></button>`;
  return `<div class="pm-tools"><input id="pm-q" type="search" placeholder="Tìm mã, tên, người phụ trách, nơi chạy…" value="${esc(f.q)}">
      <span class="facets">${facet('active', 'Đang dùng')}${['draft', 'review', 'live', 'archived'].map(s => facet(s, STATUS_LABEL[s])).join('')}</span>
      <select id="pm-purpose"><option value="">Mọi mục đích</option>${(shell.state.me?.pack_purposes || []).map(x =>
        `<option value="${esc(x.key)}" ${f.purpose === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      <label class="check inline"><input id="pm-mine" type="checkbox" ${f.mine ? 'checked' : ''}> Của tôi</label></div>
    <div class="pm-scroll"><table class="pm-table"><thead><tr><th>Mã</th><th>Bộ</th><th>Mục đích</th><th>Trạng thái</th><th>Nền tảng</th>
      <th>Phụ trách</th><th>Nơi đang chạy</th><th class="num">Level</th><th>Version</th></tr></thead><tbody>
      ${rows.map(p => `<tr data-pack="${esc(p.name)}" class="${p.name === shell.state.pack ? 'current' : ''}">
        <td><b>${esc(p.code || '')}</b></td><td>${esc(p.name)}${p.base ? `<div class="small muted">nháp của ${esc(p.base.code)}</div>` : ''}</td>
        <td>${esc(purposeLabel(shell, p.purpose))}</td><td>${statusChip(p.status)}</td><td>${esc(p.platform)}</td>
        <td>${esc(shortUser(p.owner))}</td><td class="small">${esc(deployText(p.deploy))}</td><td class="num">${esc(p.level_count ?? '')}</td>
        <td class="small">${p.version ? `v${esc(p.version.no)} · ${esc(KIND_LABEL[p.version.kind] || p.version.kind)} · ${esc(fmtTime(p.version.at))}` : ''}</td></tr>`).join('')
        || '<tr><td colspan="9" class="muted">Không có bộ nào khớp bộ lọc.</td></tr>'}
    </tbody></table></div>`;
}

// ───────────────────────────── chi tiết bộ ─────────────────────────────

function statusActions(shell, p) {
  const me = shell.state.me?.email, can = shell.can;
  const b = (act, label, cls = '', title = '') => `<button data-act="${act}" class="${cls}" title="${esc(title)}">${esc(label)}</button>`;
  const out = [];
  if (p.status === 'draft') {
    out.push(b('review', 'Gửi duyệt…', 'primary', 'Khoá bộ lại, chờ người có quyền duyệt'));
    if (can('production')) out.push(b('live', p.base ? `Duyệt vào ${p.base.code}` : 'Bật Live ngay', '', 'Duyệt không qua bước chờ'));
  }
  if (p.status === 'review') {
    if (can('production')) out.push(b('live', p.base ? `Duyệt vào ${p.base.code}` : 'Duyệt → Live', 'primary'));
    if (can('production') || p.review?.by === me) out.push(b('draft-back', p.review?.by === me ? 'Rút lại' : 'Trả về Nháp…'));
  }
  if (p.status === 'live' && can('production')) out.push(b('draft', 'Về Nháp', '', 'Mở khoá để sửa trực tiếp (nên Nhân bản để sửa)'));
  if (p.status !== 'archived' && can('archive')) out.push(b('archive', 'Lưu trữ…'));
  if (p.status === 'archived' && can('archive')) out.push(b('unarchive', 'Bỏ lưu trữ'));
  return out.join('');
}

function versionsHtml(p, versions) {
  if (!versions.length) return '<p class="muted small">Chưa có version. Mỗi lần đẩy BI, duyệt bản nháp hoặc khôi phục tự thành một version; bấm Chốt version để lưu tay.</p>';
  return `<ul class="pm-versions">${versions.map((v, i) => {
    const prev = versions[i + 1];
    const range = v.from_lv != null ? ` · level ${v.from_lv}–${v.to_lv}` : '';
    const bi = v.detail?.bi?.name ? `<div class="small muted">BI: ${esc(v.detail.bi.name)}${v.detail.bi.env ? ` (${esc(v.detail.bi.env)})` : ''}</div>` : '';
    const from = v.detail?.from ? `<div class="small muted">từ bản nháp ${esc(v.detail.from.code)} · ${esc(v.detail.from.name)}</div>` : '';
    return `<li><div><b>v${esc(v.no)}</b> <span class="badge">${esc(KIND_LABEL[v.kind] || v.kind)}</span> ${esc(v.note)}
        <div class="small muted">${esc(shortUser(v.author))}${v.reviewer ? ` · duyệt ${esc(shortUser(v.reviewer))}` : ''} · ${esc(fmtTime(v.created_at))} · ${esc(v.levels)} level${range}</div>${bi}${from}</div>
      <div class="pm-vact"><button data-diff="${esc(p.name)}@${esc(v.no)}|${esc(p.name)}" title="Level nào khác giữa version này và bộ bây giờ">So với hiện tại</button>
        ${prev ? `<button data-diff="${esc(p.name)}@${esc(prev.no)}|${esc(p.name)}@${esc(v.no)}" title="Version này đổi gì so với version trước">So với v${esc(prev.no)}</button>` : ''}
        <button data-restore="${esc(v.no)}" title="Đưa bộ về đúng nội dung version này (thành một version mới)">Khôi phục</button></div></li>`;
  }).join('')}</ul>`;
}

function detailHtml(shell, p, versions, handovers) {
  const purposes = shell.state.me?.pack_purposes || [];
  const ro = p.status === 'archived';
  return `<div class="pm-head"><button data-act="back" class="icon" title="Về danh sách bộ">‹</button>
      <h4>${esc(packLabel(p))}</h4>${statusChip(p.status)}<span class="muted small">${esc(purposeLabel(shell, p.purpose))} · ${esc(p.platform)} · ${esc(p.level_count ?? 0)} level</span>
      <span class="grow"></span><button data-act="open">Mở bộ</button><button data-act="clone" title="Tạo bản nháp để sửa; duyệt bản nháp sẽ thay nội dung bộ này">Nhân bản…</button>
      <button data-act="compare">So với bộ khác…</button></div>
    ${p.base ? `<p class="pm-note">Bản nháp của <b>${esc(p.base.code)} · ${esc(p.base.name || '(đã xoá)')}</b>: duyệt sẽ thay nội dung bộ gốc bằng bộ này (thành một version), bộ này vào lưu trữ.</p>` : ''}
    ${p.review ? `<p class="pm-note warn">Chờ duyệt — ${esc(shortUser(p.review.by))} gửi ${esc(fmtTime(p.review.at))}: “${esc(p.review.note)}”</p>` : ''}
    ${p.status === 'live' ? `<p class="pm-note">Bộ Live chỉ nhận level promote từ bộ khác. Muốn sửa: Nhân bản, sửa bản nháp rồi gửi duyệt.${p.approved ? ` Duyệt lần cuối: ${esc(shortUser(p.approved.by))} · ${esc(fmtTime(p.approved.at))}.` : ''}</p>` : ''}
    ${p.status === 'archived' && p.archive_reason ? `<p class="pm-note">Lưu trữ: ${esc(p.archive_reason)}</p>` : ''}
    <div class="pm-actions">${statusActions(shell, p)}</div>
    <div class="pm-grid">
      <section class="card"><h3>Thông tin bàn giao</h3>
        <label>Mục đích<select id="pd-purpose" ${ro ? 'disabled' : ''}><option value="">(chưa đặt)</option>${purposes.map(x =>
          `<option value="${esc(x.key)}" ${p.purpose === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        ${NOTE_FIELDS.map(([k, l]) => `<label>${esc(l)}<textarea data-note="${k}" rows="2" ${ro ? 'disabled' : ''}>${esc(p.notes?.[k] || '')}</textarea></label>`).join('')}
        <h4>Nơi đang chạy</h4><div class="grid2">${DEPLOY_FIELDS.map(([k, l]) =>
          `<label>${esc(l)}<input data-deploy="${k}" maxlength="120" value="${esc(p.deploy?.[k] || '')}" ${ro ? 'disabled' : ''}></label>`).join('')}</div>
        ${ro ? '' : '<div class="row"><button data-act="save-info" class="primary">Lưu thông tin</button></div>'}</section>
      <section class="card"><h3>Phụ trách</h3>
        <p>${p.owner ? `<b>${esc(p.owner)}</b>` : '<span class="muted">Chưa có người phụ trách</span>'}</p>
        <div class="grid2"><label>Bàn giao cho (email)<input id="pd-to" placeholder="ten@sonat.vn"></label>
          <label>Lời nhắn<input id="pd-ho-note" maxlength="1000" placeholder="việc đang dở, chỗ cần xem"></label></div>
        <div class="row"><button data-act="handover">Bàn giao</button></div>
        <ul class="pm-handovers small">${handovers.map(h => `<li>${esc(fmtTime(h.at))}: ${esc(shortUser(h.from) || '–')} → <b>${esc(shortUser(h.to))}</b>${h.note ? ` — ${esc(h.note)}` : ''}
          <span class="muted">(${esc(shortUser(h.by))})</span></li>`).join('') || '<li class="muted">Chưa bàn giao lần nào.</li>'}</ul></section>
      <section class="card pm-vcard"><h3>Version <button data-act="snapshot" title="Lưu nội dung bộ bây giờ thành một version">Chốt version…</button></h3>
        ${versionsHtml(p, versions)}</section>
    </div>`;
}

/** Hộp Quản lý bộ. shell: {state, can, features, openPack(name), reloadPacks(prefer)}. */
export async function openPacks(shell, { pack = null } = {}) {
  const f = { q: '', status: 'active', purpose: '', mine: false };
  let current = pack;
  await openDialog({
    title: 'Quản lý bộ', wide: true, html: '<div id="pm-body" class="pm"></div>', actions: [{ label: 'Đóng' }],
    onOpen: (dlg, close) => {
      const body = $('#pm-body', dlg);
      const find = name => shell.state.packs.find(p => p.name === name);
      async function render() {
        const p = current && find(current);
        if (!p) {
          current = null;
          body.innerHTML = listHtml(shell, f);
          return;
        }
        body.innerHTML = '<p class="muted">Đang tải…</p>';
        const [versions, handovers] = await Promise.all([api.versions(p.name).catch(() => []), api.handovers(p.name).catch(() => [])]);
        if (current === p.name) body.innerHTML = detailHtml(shell, p, versions, handovers);
      }
      const refresh = async (prefer = current) => {
        await shell.reloadPacks();
        current = prefer;
        await render();
      };
      const run = fn => fn().catch(e => toast(e.message, 'err'));
      body.addEventListener('input', e => {
        if (e.target.id !== 'pm-q') return;
        f.q = e.target.value;
        const pos = e.target.selectionStart;
        render().then(() => { const q = $('#pm-q', body); q?.focus(); q?.setSelectionRange(pos, pos); });
      });
      body.addEventListener('change', e => {
        if (e.target.id === 'pm-purpose') f.purpose = e.target.value;
        else if (e.target.id === 'pm-mine') f.mine = e.target.checked;
        else return;
        render();
      });
      body.addEventListener('click', e => run(async () => {
        const row = e.target.closest('tr[data-pack]');
        if (row && !current) {
          current = row.dataset.pack;
          return render();
        }
        const facet = e.target.closest('[data-status]');
        if (facet) {
          f.status = facet.dataset.status;
          return render();
        }
        const diff = e.target.closest('[data-diff]');
        if (diff) {
          const [a, b] = diff.dataset.diff.split('|');
          return openDiff(shell, a, b);
        }
        const restore = e.target.closest('[data-restore]');
        const p = find(current);
        if (restore && p) {
          const note = await ask(`Khôi phục ${packLabel(p)} về v${restore.dataset.restore}`, 'Lý do', {
            required: false, hint: 'Các level khác version đó được ghi lại đúng nội dung cũ (lịch sử vẫn giữ). Bộ đã đẩy lên BI thì phải đẩy lại.',
          });
          if (note == null) return;
          const r = await api.restoreVersion(p.name, restore.dataset.restore, note);
          toast(`Đã khôi phục về v${r.restored_from}: ${r.changed} level đổi, thành v${r.version.no}`, 'ok');
          return refresh();
        }
        const act = e.target.closest('button[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'back') {
          current = null;
          return render();
        }
        if (!p) return;
        if (act === 'open') {
          close(null);
          return shell.openPack(p.name);
        }
        if (act === 'review') {
          const note = await ask(`Gửi duyệt ${packLabel(p)}`, 'Nội dung thay đổi', { multiline: true, hint: 'Bộ bị khoá tới khi được duyệt hoặc trả về Nháp.' });
          if (note == null) return;
          await api.packStatus(p.name, 'review', note);
          toast(`Đã gửi duyệt ${p.code}`, 'ok');
          return refresh();
        }
        if (act === 'live') {
          const r = await api.packStatus(p.name, 'live');
          if (r.applied_to) {
            toast(`Đã duyệt vào ${r.applied_to.code} · ${r.applied_to.name}: ${r.changed} level đổi, thành v${r.version.no}`, 'ok');
            return refresh(r.applied_to.name);
          }
          toast(`${p.code} đã Live`, 'ok');
          return refresh();
        }
        if (act === 'draft-back') {
          const note = p.review?.by === shell.state.me?.email ? '' : await ask(`Trả ${packLabel(p)} về Nháp`, 'Lý do', { required: false });
          if (note == null) return;
          await api.packStatus(p.name, 'draft', note);
          return refresh();
        }
        if (act === 'draft' || act === 'unarchive') {
          await api.packStatus(p.name, 'draft');
          return refresh();
        }
        if (act === 'archive') {
          const note = await ask(`Lưu trữ ${packLabel(p)}`, 'Lý do lưu trữ', { hint: 'Bộ lưu trữ chỉ đọc và bị xoá hẳn sau số ngày ở Thùng rác.' });
          if (note == null) return;
          await api.packStatus(p.name, 'archived', note);
          return refresh();
        }
        if (act === 'save-info') {
          const notes = Object.fromEntries([...body.querySelectorAll('[data-note]')].map(el => [el.dataset.note, el.value]));
          const deploy = Object.fromEntries([...body.querySelectorAll('[data-deploy]')].map(el => [el.dataset.deploy, el.value]));
          await api.updatePack(p.name, { purpose: $('#pd-purpose', body).value, notes, deploy });
          toast('Đã lưu thông tin bộ', 'ok');
          return refresh();
        }
        if (act === 'handover') {
          const to = $('#pd-to', body).value.trim();
          if (!to) throw new Error('Nhập email người nhận');
          await api.handover(p.name, to, $('#pd-ho-note', body).value);
          toast(`Đã bàn giao ${p.code} cho ${shortUser(to)}`, 'ok');
          return refresh();
        }
        if (act === 'snapshot') {
          const note = await ask(`Chốt version cho ${packLabel(p)}`, 'Ghi chú version');
          if (note == null) return;
          const v = await api.snapshot(p.name, note);
          toast(`Đã chốt v${v.no}`, 'ok');
          return refresh();
        }
        if (act === 'clone') {
          const name = await ask(`Nhân bản ${packLabel(p)}`, 'Tên bộ mới', {
            value: `${p.name}-nhap`, hint: p.status === 'live' ? 'Bản nháp nhớ bộ gốc: duyệt bản nháp sẽ thay nội dung bộ gốc.' : '',
          });
          if (name == null) return;
          const c = await api.clonePack(p.name, { name });
          toast(`Đã tạo ${c.code} · ${c.name}`, 'ok');
          return refresh(c.name);
        }
        if (act === 'compare') {
          const others = shell.state.packs.filter(x => x.name !== p.name);
          const other = await openDialog({
            title: `So ${packLabel(p)} với…`, html: `<label>Bộ<select id="cmp-pack">${others.map(x => `<option value="${esc(x.name)}">${esc(packLabel(x))} (${esc(STATUS_LABEL[x.status])})</option>`).join('')}</select></label>`,
            actions: [{ label: 'Huỷ', value: null }, { label: 'So sánh', primary: true, onClick: async dlg => $('#cmp-pack', dlg).value }],
          });
          if (other) await openDiff(shell, other, p.name);
        }
      }));
      render();
    },
  });
}

// ───────────────────────────── so sánh bằng ảnh ─────────────────────────────

const thumbUrls = new Map();
function thumbUrl(sha) {
  if (!thumbUrls.has(sha)) {
    thumbUrls.set(sha, fetch(`/api/thumbs/${sha}`, { headers: authHeaders(), credentials: 'same-origin' })
      .then(async res => (res.ok ? URL.createObjectURL(await res.blob()) : null)).catch(() => null));
  }
  return thumbUrls.get(sha);
}

async function fillThumb(box, shell, pack, side) {
  const url = await thumbUrl(side.sha);
  if (url) {
    box.innerHTML = `<img alt="" src="${url}">`;
    return;
  }
  if (!shell.game.thumbnail) return;
  try {
    const r = await api.revision(pack, side.name, side.rev);
    if (r.sha === side.sha && r.level) box.innerHTML = String(shell.game.thumbnail(r.level) || '');
  } catch { /* level đã đổi số hoặc xoá hẳn: giữ ô số */ }
}

export async function openDiff(shell, a, b) {
  const d = await api.diff(a, b);
  const total = d.items.length;
  const cell = (side, pack, other) => (side
    ? `<div class="df-side"><div class="thumb" data-pack="${esc(pack)}" data-name="${esc(side.name)}" data-rev="${esc(side.rev)}" data-sha="${esc(side.sha)}"><span class="ph">${esc(side.name)}</span></div>
        <span class="small muted">#${esc(side.name)} r${esc(side.rev)}</span></div>`
    : `<div class="df-side empty muted small">${other ? 'không có' : ''}</div>`);
  const html = `<p>${esc(d.a.label)} (${esc(d.a.pack)}) → <b>${esc(d.b.label)}</b> (${esc(d.b.pack)})${d.range ? ` · level ${esc(d.range[0])}–${esc(d.range[1])}` : ''}</p>
    <p class="facets">${Object.entries(DIFF_LABEL).map(([k, [l, cls]]) => `<span class="badge ${cls}">${esc(l)} ${esc(d.counts[k])}</span>`).join(' ')}
      <span class="muted small">giữ nguyên ${esc(d.counts.same)}</span></p>
    ${total ? `<ul class="df-list">${d.items.slice(0, 200).map(it => `<li><b class="df-lv">#${esc(it.level)}</b>
        <span class="badge ${DIFF_LABEL[it.kind][1]}">${esc(DIFF_LABEL[it.kind][0])}${it.from != null ? ` từ #${esc(it.from)}` : ''}</span>
        ${cell(it.a, d.a.pack, it.b)}<span class="df-arrow">→</span>${cell(it.b, d.b.pack, it.a)}</li>`).join('')}</ul>
      ${total > 200 ? `<p class="muted small">Hiện 200 / ${total} level khác.</p>` : ''}` : '<p class="muted">Hai bên giống hệt nhau.</p>'}`;
  await openDialog({
    title: 'So sánh', wide: true, html, actions: [{ label: 'Đóng' }],
    onOpen: dlg => {
      for (const box of dlg.querySelectorAll('.thumb[data-sha]')) {
        const { pack, name, rev, sha } = box.dataset;
        fillThumb(box, shell, pack, { name, rev: Number(rev), sha }).catch(() => {});
      }
    },
  });
}

// ───────────────────────────── level: bộ khác & người chơi ─────────────────────────────

/** Mục số liệu BI gọn của một level (ưu tiên Android) cho thẻ ở Thư viện, Thứ tự: {flag, text} hoặc null. */
export function liveBrief(entry) {
  const x = entry?.Android || entry?.iOS;
  if (!x) return null;
  const text = `Thắng lần đầu ${pct(x.firstWinRate)}${x.dropRate != null ? ` · rơi ${pct(x.dropRate)}` : ''}`;
  return { flag: x.stale ? 'stale' : x.flag || (x.enough ? '' : 'few'), text, x };
}

function platformLive(s) {
  const top = obj => Object.entries(obj || {}).sort((p, q) => (q[1].loseCount ?? q[1].uses ?? 0) - (p[1].loseCount ?? p[1].uses ?? 0)).slice(0, 3);
  const loss = top(s.loss).map(([k, v]) => `${k} ${v.loseCount}`).join(', ');
  const boost = top(s.boosters).map(([k, v]) => `${k} ${v.uses}`).join(', ');
  return `<div class="li-live ${s.stale ? 'stale' : s.flag || ''}"><b>${esc(s.platform)}</b> · level ${esc(s.slot)} của ${esc(s.code || s.pack)}
      · ${esc(s.users)} người${s.enough ? '' : ' (chưa đủ mẫu)'}${s.stale ? ' · <span class="warn">đo trên bản cũ — level đã sửa sau khi đo</span>' : ''}
    <div class="stats">
      <div class="stat"><span>Thắng lần đầu</span><b>${pct(s.firstWinRate)}</b>${s.firstWinCi ? `<small>${pct(s.firstWinCi[0])}–${pct(s.firstWinCi[1])}</small>` : ''}</div>
      <div class="stat"><span>Lượt / người</span><b>${esc(s.attemptsPerUser ?? '–')}</b></div>
      <div class="stat"><span>Rơi rụng</span><b>${pct(s.dropRate)}</b></div>
      <div class="stat"><span>Thời gian TB</span><b>${s.playTimeAvg ? `${Math.round(s.playTimeAvg)} s` : '–'}</b></div></div>
    ${loss ? `<div class="small">Thua vì: ${esc(loss)}</div>` : ''}${boost ? `<div class="small">Booster: ${esc(boost)}</div>` : ''}
    <div class="small muted">${esc(s.window?.from || '')} → ${esc(s.window?.to || '')}</div></div>`;
}

/** Điền thẻ "Bộ khác & người chơi" của level name (bộ đang mở). shell: {state, can, features, openLevelIn(pack, name)}. */
export async function fillLevelInfo(el, shell, pack, name) {
  if (!shell.features().packflow) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<p class="muted small">Đang tải…</p>';
  const [usage, live] = await Promise.all([api.usage(pack, name).catch(() => null), shell.features().live ? api.levelLive(pack, name).catch(() => null) : null]);
  if (shell.state.pack !== pack || !el.isConnected) return;
  const chip = x => `<button class="chip li-go ${x.status === 'archived' ? 'muted' : ''}" data-pack="${esc(x.pack)}" data-name="${esc(x.name)}"
    title="${esc(STATUS_LABEL[x.status])} — mở level này">${esc(x.code || x.pack)} #${esc(x.name)}</button>`;
  const usable = (usage?.older || []).filter(x => x.status === 'draft' || (x.status === 'live' && shell.can('production')));
  const parts = [];
  if (usage) {
    parts.push(usage.same.length ? `<div class="li-row"><span class="muted small">Cùng nội dung ở</span> ${usage.same.map(chip).join(' ')}</div>` : '');
    parts.push(usage.older.length ? `<div class="li-row"><span class="warn small">Đang giữ bản cũ</span> ${usage.older.map(chip).join(' ')}
      ${usable.length ? '<button data-li="apply" title="Chép bản đã lưu này sang các bộ đang giữ bản cũ (qua kiểm định)">Áp bản này sang…</button>' : ''}</div>` : '');
    if (!usage.same.length && !usage.older.length) parts.push('<p class="muted small">Level này chưa có ở bộ khác.</p>');
  }
  if (live?.stats?.length) {
    parts.push(live.stats.map(platformLive).join(''));
    if (live.suggestions?.length) parts.push(`<ul class="li-suggest small">${live.suggestions.map(s => `<li>${esc(s.text)}</li>`).join('')}</ul>`);
  } else if (shell.features().live) parts.push('<p class="muted small">Chưa có số liệu người chơi cho nội dung này.</p>');
  el.innerHTML = parts.join('');
  el.onclick = e => {
    const go = e.target.closest('.li-go');
    if (go) return shell.openLevelIn(go.dataset.pack, go.dataset.name);
    if (e.target.closest('[data-li="apply"]')) applyDialog(shell, pack, name, usable).then(done => { if (done) fillLevelInfo(el, shell, pack, name); });
    return null;
  };
}

async function applyDialog(shell, pack, name, targets) {
  const html = `<p class="muted small">Chép bản đã lưu của ${esc(pack)} #${esc(name)} sang các bộ đã chọn, giữ số level ở mỗi bộ. Bộ Live cần quyền duyệt.</p>
    ${targets.map((x, i) => `<label class="check"><input type="checkbox" data-i="${i}" checked> ${esc(x.code || '')} · ${esc(x.pack)} #${esc(x.name)} ${statusChip(x.status)}</label>`).join('')}`;
  const res = await openDialog({
    title: 'Áp bản mới sang bộ khác', html, actions: [{ label: 'Huỷ', value: null }, {
      label: 'Áp', primary: true, onClick: async dlg => {
        const picked = [...dlg.querySelectorAll('input[data-i]:checked')].map(el => targets[Number(el.dataset.i)]);
        if (!picked.length) throw new Error('Chọn ít nhất một bộ');
        return api.applyLevel(pack, name, picked.map(x => ({ pack: x.pack, name: x.name })));
      },
    }],
  });
  if (!res) return false;
  const bad = res.results.filter(r => r.error);
  toast(`Đã áp ${res.results.length - bad.length} nơi${bad.length ? `; ${bad.length} lỗi: ${bad[0].error}` : ''}`, bad.length ? 'err' : 'ok');
  return true;
}
