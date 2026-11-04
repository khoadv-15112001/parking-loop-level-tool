// Màn Hoạt động (như Audit của AntLevel): ai làm gì, lúc nào — lọc theo bộ, người, level, việc, từ ngày. Bấm số level để
// mở level đó. Dữ liệu là nhật ký audit của server (GET /api/audit, cả hai server).
import { api } from './api.mjs';
import { $, esc, fmtTime, shortUser } from './ui.mjs';

const ACTIONS = [
  ['Level', [['level.update', 'sửa level'], ['level.create', 'tạo level'], ['level.delete', 'xoá level'], ['level.revert', 'khôi phục bản cũ'],
    ['level.relevel', 'đổi số'], ['level.promote', 'promote'], ['level.purge', 'xoá hẳn level']]],
  ['Khoá', [['lock.acquire', 'khoá'], ['lock.release', 'nhả khoá'], ['lock.force_unlock', 'phá khoá']]],
  ['Bộ', [['pack.create', 'tạo bộ'], ['pack.rename', 'đổi tên bộ'], ['pack.import', 'nhập level'], ['pack.reorder', 'xếp thứ tự'],
    ['pack.production', 'production'], ['pack.archived', 'lưu trữ bộ'], ['pack.purge', 'xoá hẳn bộ']]],
  ['Level Hub, game', [['levelhub.export', 'xuất Level Hub'], ['levelhub.bi_upload', 'đẩy lên BI'], ['ci.levels', 'level từ CI'],
    ['ci.webgl', 'bản game từ CI'], ['game.activate', 'chọn bản game'], ['game.remove', 'xoá bản game'],
    ['link.create', 'tạo link điện thoại'], ['link.revoke', 'thu hồi link']]],
  ['Quản trị', [['admin.settings', 'đổi cài đặt'], ['admin.backup', 'sao lưu'], ['admin.housekeeping', 'dọn thùng rác']]],
];
const LABEL = new Map(ACTIONS.flatMap(([, list]) => list));
const KIND = { level: 'k-level', lock: 'k-lock', pack: 'k-pack', admin: 'k-admin' };
const QUIET = new Set(['unlocked_edit', 'if_match', 'changes', 'before']);

function detailText(a) {
  const d = a.detail || {};
  const changes = Array.isArray(d.changes) ? d.changes : [];
  const list = changes.length ? `<ul class="changes">${changes.slice(0, 4).map(c => `<li>${esc(c)}</li>`).join('')}${changes.length > 4 ? `<li class="muted">+${changes.length - 4} mục nữa</li>` : ''}</ul>` : '';
  const rest = Object.entries(d).filter(([k, v]) => !QUIET.has(k) && v != null && v !== '' && !(Array.isArray(v) && !v.length));
  const kv = rest.length ? `<span class="muted">${esc(rest.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ').slice(0, 240))}</span>` : '';
  const unlocked = d.unlocked_edit && a.action !== 'level.create';   // tạo level không cần khoá
  return `${unlocked ? '<span class="badge warn" title="Lưu khi không giữ khoá level (vd qua API)">sửa không khoá</span> ' : ''}${list}${kv}`;
}

/** shell: {state, openLevel(name), selectPack(name)}. root: thân màn, tools: thanh lọc ở hàng ngữ cảnh. Trả {render}. */
export function mountActivity(shell, root, tools) {
  let pack = null, loading = false;
  tools.innerHTML = `<select id="act-scope" title="Bộ"><option value="pack">Bộ đang mở</option><option value="">Mọi bộ</option></select>
    <input id="act-user" placeholder="Người (email)" title="Email người làm">
    <input id="act-level" placeholder="Level" class="narrow" title="Số level">
    <select id="act-action" title="Việc"><option value="">Mọi việc</option>${ACTIONS.map(([g, list]) =>
      `<optgroup label="${esc(g)}">${list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</optgroup>`).join('')}</select>
    <label class="inline">Từ ngày <input id="act-since" type="date"></label>
    <label class="inline">Tối đa <input id="act-limit" type="number" min="10" max="5000" value="300" class="narrow"></label>
    <button id="act-go" class="primary">Lọc</button><span class="grow"></span><span id="act-count" class="muted small"></span>`;
  root.innerHTML = '<div class="page"><table class="tbl act"><thead><tr><th>Lúc</th><th>Người</th><th>Việc</th><th>Bộ</th><th>Level</th><th>Rev</th><th>Chi tiết</th></tr></thead><tbody></tbody></table></div>';
  const tbody = $('tbody', root);

  async function load() {
    if (loading) return;
    loading = true;
    const q = { limit: $('#act-limit', tools).value || 300 };
    if ($('#act-scope', tools).value === 'pack' && shell.state.pack) q.pack = shell.state.pack;
    const user = $('#act-user', tools).value.trim().toLowerCase(), level = $('#act-level', tools).value.trim();
    const action = $('#act-action', tools).value, since = $('#act-since', tools).value;
    if (user) q.user = user;
    if (level) q.level = level;
    if (action) q.action = action;
    if (since) q.since = new Date(`${since}T00:00:00`).toISOString();
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Đang tải…</td></tr>';
    try {
      const items = await api.audit(q);
      $('#act-count', tools).textContent = `${items.length} dòng`;
      tbody.innerHTML = items.map(a => {
        const kind = KIND[String(a.action).split('.')[0]] || '';
        const openable = a.level != null && a.pack === shell.state.pack && /^level\.(update|create|revert|relevel|promote)$/.test(a.action);
        return `<tr><td class="nowrap">${esc(fmtTime(a.ts))}</td><td title="${esc(a.user)}">${esc(shortUser(a.user))}</td>
          <td><span class="act-chip ${kind}" title="${esc(a.action)}">${esc(LABEL.get(a.action) || a.action)}</span></td>
          <td>${esc(a.pack ?? '')}</td><td>${openable ? `<button class="link" data-open="${esc(a.level)}">${esc(a.level)}</button>` : esc(a.level ?? '')}</td>
          <td>${a.rev != null ? `r${esc(a.rev)}` : ''}</td><td class="small">${detailText(a)}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">Không có hoạt động nào khớp bộ lọc.</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="err">${esc(e.message)}</td></tr>`;
    } finally {
      loading = false;
    }
  }

  tools.addEventListener('click', e => { if (e.target.id === 'act-go') load(); });
  tools.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) load(); });
  tools.addEventListener('change', e => { if (e.target.matches('select')) load(); });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-open]');
    if (b) shell.openLevel(b.dataset.open);
  });

  return {
    render({ show = false } = {}) {   // mở màn hoặc đổi bộ thì tải lại; level đổi (SSE) thì không
      if (show || pack !== shell.state.pack) {
        pack = shell.state.pack;
        load();
      }
    },
    reload: load,
  };
}
