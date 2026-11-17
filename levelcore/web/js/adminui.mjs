// Hộp Quản trị (chỉ admin): admin thêm trong app, quyền theo từng việc, dải thông báo chung, số ngày giữ thùng rác và hạn
// link chơi thử, dung lượng, sao lưu database, dọn thùng rác ngay, tải dữ liệu lượt chơi. Hai admin cùng sửa thì người lưu
// sau được báo (409) và tải lại.
import { api } from './api.mjs';
import { downloadPlays } from './playsview.mjs';
import { $, esc, openDialog, toast } from './ui.mjs';

const mb = n => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;
const LIVE_PLATFORMS = ['Android', 'iOS'];
const pct = v => Math.round((v ?? 0) * 100);

function liveForm(s, packs) {
  if (!s.live) return '';
  const l = s.live;
  const packOpts = sel => `<option value="">Tự chọn: bộ Live mục đích Main</option>${packs.filter(p => p.code).map(p =>
    `<option value="${esc(p.code)}" ${p.code === sel ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}${p.status === 'live' ? ' (Live)' : ''}</option>`).join('')}`;
  return `<h4>Số liệu người chơi (BI)</h4><div id="ad-live-status" class="small muted">Đang tải…</div>
    <div class="grid2">${LIVE_PLATFORMS.map(p => `<label>Bộ đang chạy ${p}<select data-live-pack="${p}">${packOpts(l.platforms[p]?.pack)}</select></label>
      <label>Bản app ${p} (ngăn bằng dấu phẩy, trống = mọi bản)<input data-live-ver="${p}" value="${esc((l.platforms[p]?.versions || []).join(', '))}"></label>`).join('')}
      <label>Số ngày gần nhất<input id="ad-live-days" type="number" min="1" max="90" value="${esc(l.days)}"></label>
      <label>Tối thiểu người chơi để đánh giá<input id="ad-live-min" type="number" min="1" value="${esc(l.minUsers)}"></label>
      <label>Viền đỏ khi thắng lần đầu dưới (%)<input id="ad-live-hard" type="number" min="0" max="100" value="${pct(l.hardWin)}"></label>
      <label>Viền cam khi thắng lần đầu dưới (%)<input id="ad-live-warn" type="number" min="0" max="100" value="${pct(l.warnWin)}"></label>
      <label>Rơi rụng: cam từ (%), gấp đôi thì đỏ<input id="ad-live-drop" type="number" min="0" max="100" value="${pct(l.warnDrop)}"></label>
      <label class="check"><input id="ad-live-auto" type="checkbox" ${l.auto ? 'checked' : ''}> Tự đồng bộ mỗi ngày</label></div>`;
}

function readLive(dlg) {
  if (!$('#ad-live-days', dlg)) return {};
  const num = id => Number($(id, dlg).value);
  return {
    live: {
      platforms: Object.fromEntries(LIVE_PLATFORMS.map(p => [p, {
        pack: $(`[data-live-pack="${p}"]`, dlg).value,
        versions: $(`[data-live-ver="${p}"]`, dlg).value.split(',').map(x => x.trim()).filter(Boolean),
      }])),
      days: num('#ad-live-days'), minUsers: num('#ad-live-min'),
      hardWin: num('#ad-live-hard') / 100, warnWin: num('#ad-live-warn') / 100, warnDrop: num('#ad-live-drop') / 100,
      auto: $('#ad-live-auto', dlg).checked,
    },
  };
}

async function showLive(dlg) {
  const el = $('#ad-live-status', dlg);
  if (!el) return;
  const st = await api.live();
  const src = LIVE_PLATFORMS.map(p => `${p}: ${st.appIds[p] ? (st.sources[p] ? `${esc(st.sources[p].code)} · ${esc(st.sources[p].name)}` : 'chưa có bộ') : 'chưa có appId'}`).join(' · ');
  const last = st.runs[0];
  el.innerHTML = `${st.configured ? `BI ${esc(st.env)} — ${src}` : '<span class="warn">Chưa có key service account BI (BI_SERVICE_ACCOUNT_KEY) hoặc BI_API_URL trên server.</span>'}
    ${st.job ? `<br>Đang đồng bộ: ${esc(st.job.message)} (${st.job.done}/${st.job.total})` : ''}
    ${last ? `<br>Lần gần nhất: ${esc(last.platform)} ${esc(last.code || '')} · ${esc(last.status)} · ${esc(last.message || '')} · ${esc(last.from)} → ${esc(last.to)}` : ''}`;
}

function form(s, packs = []) {
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
    ${liveForm(s, packs)}
    <h4>Dung lượng</h4><div id="ad-storage" class="small muted">Đang đo…</div>
    <p class="small muted">${s.updated_by ? `Lưu lần cuối bởi ${esc(s.updated_by)}` : ''}</p>`;
}

async function showStorage(dlg) {
  const st = await api.adminStorage();
  $('#ad-storage', dlg).innerHTML = `<span class="${st.status === 'ok' ? '' : 'warn'}">Tổng ${mb(st.totalBytes)} / 1,5 GB</span><br>
    Database ${mb(st.database)} · bản game ${mb(st.game)} · đang tải ${mb(st.uploads)} · sao lưu ${mb(st.backups)} · đã xoá hẳn ${mb(st.purged)}<br>
    Cảnh báo từ 1,2 GB; chừa 100 MB khi nhận bản game. Sao lưu nén: tối đa 7 bản / 200 MB, luôn giữ bản mới nhất.<br>
    ${st.counts.levels} level · ${st.counts.revisions} revision · ${st.counts.plays} lượt chơi · ${st.counts.thumbs} ảnh · ${st.counts.links} link còn hạn`;
}

export async function openAdmin() {
  let s = await api.adminSettings();
  const packs = s.live ? await api.packs().catch(() => []) : [];
  const read = dlg => ({
    version: s.version,
    admins: $('#ad-admins', dlg).value.split(/[\s,;]+/).filter(Boolean),
    permissions: Object.fromEntries([...dlg.querySelectorAll('[data-perm]')].map(el => [el.dataset.perm, el.value])),
    notice: { text: $('#ad-notice', dlg).value, level: $('#ad-level', dlg).value },
    trashDays: Number($('#ad-trash', dlg).value), linkDays: Number($('#ad-link', dlg).value),
    ...readLive(dlg),
  });
  const reload = async dlg => {
    s = await api.adminSettings();
    $('#ad-body', dlg).innerHTML = form(s, packs);
    showStorage(dlg).catch(() => {});
    showLive(dlg).catch(() => {});
  };
  await openDialog({
    title: 'Quản trị', wide: true, html: `<div id="ad-body">${form(s, packs)}</div>`,
    actions: [
      ...(s.live ? [{
        label: 'Đồng bộ BI ngay', onClick: async dlg => {
          await api.liveSync();
          toast('Đang đồng bộ số liệu người chơi từ BI', 'ok');
          await showLive(dlg);
          return false;
        },
      }] : []),
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
    onOpen: dlg => {
      showStorage(dlg).catch(e => { $('#ad-storage', dlg).textContent = e.message; });
      showLive(dlg).catch(e => { const el = $('#ad-live-status', dlg); if (el) el.textContent = e.message; });
    },
  });
}
