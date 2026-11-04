// Thùng rác: level đã xoá và bộ đã lưu trữ của mọi bộ, còn bao nhiêu ngày trước khi bị xoá hẳn (trashDays ở Quản trị),
// khôi phục level (revision mới có nội dung trước khi xoá) và bỏ lưu trữ bộ (cần quyền lưu trữ).
import { api } from './api.mjs';
import { esc, fmtTime, openDialog, shortUser, toast } from './ui.mjs';

const daysLeft = t => (t ? Math.max(0, Math.ceil((new Date(t) - Date.now()) / 86400000)) : null);
const left = t => (t == null ? '' : `còn ${daysLeft(t)} ngày`);

export async function restoreLevel(pack, name) {
  const revs = await api.revisions(pack, name);
  const alive = revs.find(r => r.sha);
  if (!alive) throw new Error(`Level ${pack}/${name} không còn bản nào để khôi phục`);
  await api.revert(pack, name, alive.rev, revs[0].rev);
  return alive.rev;
}

export async function openTrash({ canArchive, onChanged }) {
  let data = await api.trash();
  const render = dlg => {
    dlg.querySelector('#tr-body').innerHTML = `<p class="muted small">Level đã xoá và bộ đã lưu trữ bị xoá hẳn sau ${esc(data.days)} ngày
      (nội dung được chép ra thư mục purged trên server trước khi xoá).</p>
      <h4>Level đã xoá (${data.levels.length})</h4>${data.levels.length ? `<table>${data.levels.map(l => `<tr>
        <td>${esc(l.pack)} / <b>${esc(l.name)}</b></td><td>${esc(shortUser(l.deleted_by))} · ${esc(fmtTime(l.deleted_at))}</td>
        <td class="${daysLeft(l.purge_at) <= 3 ? 'warn' : 'muted'}">${esc(left(l.purge_at))}</td>
        <td><button data-level="${esc(l.name)}" data-pack="${esc(l.pack)}">Khôi phục</button></td></tr>`).join('')}</table>` : '<p class="muted small">Trống.</p>'}
      <h4>Bộ đã lưu trữ (${data.packs.length})</h4>${data.packs.length ? `<table>${data.packs.map(p => `<tr>
        <td><b>${esc(p.name)}</b> · ${esc(p.level_count)} level</td><td>${esc(p.archive_reason || '—')}</td>
        <td>${esc(fmtTime(p.archived_at))}</td><td class="${daysLeft(p.purge_at) <= 3 ? 'warn' : 'muted'}">${esc(left(p.purge_at))}</td>
        <td>${canArchive ? `<button data-unarchive="${esc(p.name)}">Bỏ lưu trữ</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted small">Trống.</p>'}`;
  };
  await openDialog({
    title: 'Thùng rác', wide: true, html: '<div id="tr-body"></div>',
    onOpen: dlg => {
      render(dlg);
      dlg.addEventListener('click', async e => {
        const b = e.target.closest('button[data-level], button[data-unarchive]');
        if (!b) return;
        b.disabled = true;
        try {
          if (b.dataset.level) {
            const rev = await restoreLevel(b.dataset.pack, b.dataset.level);
            toast(`Đã khôi phục level ${b.dataset.pack}/${b.dataset.level} (nội dung r${rev})`, 'ok');
          } else {
            await api.updatePack(b.dataset.unarchive, { archived: false });
            toast(`Đã bỏ lưu trữ bộ ${b.dataset.unarchive}`, 'ok');
          }
          data = await api.trash();
          render(dlg);
          await onChanged?.();
        } catch (err) {
          toast(err.message, 'err');
          b.disabled = false;
        }
      });
    },
  });
}
