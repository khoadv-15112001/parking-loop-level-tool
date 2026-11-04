// Hộp Quản trị (chỉ admin): admin thêm trong app, quyền theo từng việc, dải thông báo chung, số ngày giữ thùng rác và hạn
// link chơi thử, dung lượng, sao lưu database, dọn thùng rác ngay, tải dữ liệu lượt chơi. Hai admin cùng sửa thì người lưu
// sau được báo (409) và tải lại.
import { api } from './api.mjs';
import { downloadPlays } from './playsview.mjs';
import { $, esc, openDialog, toast } from './ui.mjs';

const mb = n => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;

function form(s) {
  return `<h4>Admin</h4>
    ${s.env_admins.length ? `<p class="small muted">Cố định trên server (biến ADMINS): ${s.env_admins.map(esc).join(', ')}</p>` : ''}
    <label>Thêm admin (mỗi dòng một email)<textarea id="ad-admins" rows="3">${esc(s.admins.join('\n'))}</textarea></label>
    <h4>Quyền</h4><table>${Object.entries(s.actions).map(([k, label]) => `<tr><td>${esc(label)}</td><td><select data-perm="${esc(k)}">
      <option value="admin" ${s.permissions[k] === 'admin' ? 'selected' : ''}>Chỉ admin</option>
      <option value="everyone" ${s.permissions[k] === 'everyone' ? 'selected' : ''}>Mọi người</option></select></td></tr>`).join('')}</table>
    <h4>Thông báo chung</h4><div class="grid2"><label>Nội dung (trống = tắt)<input id="ad-notice" maxlength="300" value="${esc(s.notice.text)}"></label>
      <label>Mức<select id="ad-level"><option value="info">Thông tin</option><option value="warn" ${s.notice.level === 'warn' ? 'selected' : ''}>Cảnh báo</option></select></label></div>
    <h4>Giữ dữ liệu</h4><div class="grid2"><label>Thùng rác (ngày)<input id="ad-trash" type="number" min="1" max="365" value="${esc(s.trashDays)}"></label>
      <label>Hạn mặc định link chơi thử (ngày)<input id="ad-link" type="number" min="1" max="90" value="${esc(s.linkDays)}"></label></div>
    <h4>Dung lượng</h4><div id="ad-storage" class="small muted">Đang đo…</div>
    <p class="small muted">${s.updated_by ? `Lưu lần cuối bởi ${esc(s.updated_by)}` : ''}</p>`;
}

async function showStorage(dlg) {
  const st = await api.adminStorage();
  $('#ad-storage', dlg).innerHTML = `Database ${mb(st.database)} · bản game ${mb(st.game)} · sao lưu ${mb(st.backups)} · đã xoá hẳn ${mb(st.purged)}<br>
    ${st.counts.levels} level · ${st.counts.revisions} revision · ${st.counts.plays} lượt chơi · ${st.counts.thumbs} ảnh · ${st.counts.links} link còn hạn`;
}

export async function openAdmin() {
  let s = await api.adminSettings();
  const read = dlg => ({
    version: s.version,
    admins: $('#ad-admins', dlg).value.split(/[\s,;]+/).filter(Boolean),
    permissions: Object.fromEntries([...dlg.querySelectorAll('[data-perm]')].map(el => [el.dataset.perm, el.value])),
    notice: { text: $('#ad-notice', dlg).value, level: $('#ad-level', dlg).value },
    trashDays: Number($('#ad-trash', dlg).value), linkDays: Number($('#ad-link', dlg).value),
  });
  const reload = async dlg => {
    s = await api.adminSettings();
    $('#ad-body', dlg).innerHTML = form(s);
    showStorage(dlg).catch(() => {});
  };
  await openDialog({
    title: 'Quản trị', wide: true, html: `<div id="ad-body">${form(s)}</div>`,
    actions: [
      { label: 'Sao lưu DB', onClick: async dlg => { const r = await api.adminBackup(); toast(`Đã sao lưu ${r.file} (${mb(r.size)})`, 'ok'); await showStorage(dlg); return false; } },
      { label: 'Dọn thùng rác ngay', onClick: async dlg => { const r = await api.adminHousekeeping(); toast(`Đã dọn ${r.levels} level, ${r.packs} bộ quá hạn`, 'ok'); await showStorage(dlg); return false; } },
      { label: 'Tải dữ liệu lượt chơi', onClick: async () => { await downloadPlays(); return false; } },
      { label: 'Đóng', value: null },
      {
        label: 'Lưu', primary: true, onClick: async dlg => {
          try {
            s = await api.saveAdminSettings(read(dlg));
          } catch (e) {
            if (e.status !== 409) throw e;
            toast(e.message, 'err');
            await reload(dlg);
            return false;
          }
          toast('Đã lưu cài đặt', 'ok');
          return true;
        },
      },
    ],
    onOpen: dlg => showStorage(dlg).catch(e => { $('#ad-storage', dlg).textContent = e.message; }),
  });
}
