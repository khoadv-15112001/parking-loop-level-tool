// Hộp "Link chơi trên điện thoại": tạo link /p/<token> ghim bản đang mở (nháp) hoặc bản đã lưu, có hạn, kèm mã QR;
// danh sách link của level với số lần mở và nút thu hồi. Người mở link không cần đăng nhập; lượt chơi của họ ghi vào tool.
import { api } from './api.mjs';
import { $, esc, fmtTime, openDialog, shortUser, toast } from './ui.mjs';

let qrLoader = null;

function loadQr() {
  qrLoader ||= new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const script = document.createElement('script');
    script.src = '/core/vendor/qrcode-generator/qrcode.js';
    script.onload = () => resolve(window.qrcode);
    script.onerror = () => {
      qrLoader = null;
      reject(new Error('Không tải được thư viện QR'));
    };
    document.head.appendChild(script);
  });
  return qrLoader;
}

async function qrImage(url) {
  const qrcode = await loadQr();
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createDataURL(6, 2);
}

const linkRow = l => `<tr data-token="${esc(l.token)}"><td>${l.rev ? `r${esc(l.rev)}` : 'nháp'}${l.name ? ` · ${esc(l.name)}` : ''}</td>
  <td>${esc(shortUser(l.created_by))} · ${esc(fmtTime(l.created_at))}</td><td>${esc(l.opens)} lần mở</td>
  <td>${l.active ? `hết hạn ${esc(fmtTime(l.expires_at))}` : `<span class="muted">${l.revoked_at ? 'đã thu hồi' : 'hết hạn'}</span>`}</td>
  <td>${l.active ? '<button data-act="show">QR</button> <button data-act="revoke">Thu hồi</button>' : ''}</td></tr>`;

/** level: {pack, name, rev (bản đã lưu), draft (bản đang mở), dirty}. */
export async function openShare({ pack, name, rev, draft, dirty, linkDays = 14 }) {
  let links = [];
  const refresh = async dlg => {
    links = await api.links({ pack, level: name });
    $('#sh-list', dlg).innerHTML = links.length ? `<table>${links.map(linkRow).join('')}</table>` : '<p class="muted small">Chưa có link nào cho level này.</p>';
  };
  const show = async (dlg, link) => {
    const url = `${location.origin}${link.path}`;
    $('#sh-out', dlg).innerHTML = `<div class="share-out"><img alt="Mã QR của link chơi thử" class="qr">
      <div><input id="sh-url" readonly value="${esc(url)}"><p class="small muted">Quét mã bằng điện thoại hoặc gửi link. Không cần đăng nhập;
      hết hạn ${esc(fmtTime(link.expires_at))}.${['localhost', '127.0.0.1'].includes(location.hostname) ? ' <b class="warn">Tool đang chạy trên máy này: điện thoại chỉ mở được khi dùng link LAN / BI.</b>' : ''}</p>
      <button id="sh-copy">Chép link</button></div></div>`;
    $('#sh-copy', dlg).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Đã chép link', 'ok');
      } catch {
        $('#sh-url', dlg).select();
      }
    });
    try {
      $('img.qr', $('#sh-out', dlg)).src = await qrImage(url);
    } catch (e) {
      $('img.qr', $('#sh-out', dlg)).replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: e.message }));
    }
  };
  await openDialog({
    title: `Chơi level ${name} trên điện thoại`,
    html: `<div class="grid2"><label>Bản<select id="sh-src">
        <option value="draft">Bản đang mở${dirty ? ' (có thay đổi chưa lưu)' : ''}</option>
        ${rev ? `<option value="saved" ${dirty ? '' : 'selected'}>Bản đã lưu r${esc(rev)}</option>` : ''}</select></label>
      <label>Hạn (ngày)<input id="sh-days" type="number" min="1" max="90" value="${esc(linkDays)}"></label></div>
      <label>Ghi chú (hiện trên điện thoại)<input id="sh-name" maxlength="80" placeholder="vd: thử time 90s"></label>
      <div id="sh-out"></div><h4>Link đã tạo</h4><div id="sh-list" class="small"></div>`,
    actions: [{ label: 'Đóng', value: null }, {
      label: 'Tạo link', primary: true, onClick: async dlg => {
        const saved = $('#sh-src', dlg).value === 'saved';
        const link = await api.createLink({
          pack, level: name, days: Number($('#sh-days', dlg).value), name: $('#sh-name', dlg).value,
          ...(saved ? { rev } : { level_data: draft }),
        });
        await show(dlg, link);
        await refresh(dlg);
        return false;
      },
    }],
    onOpen: dlg => {
      refresh(dlg).catch(e => toast(e.message, 'err'));
      $('#sh-list', dlg).addEventListener('click', async e => {
        const b = e.target.closest('button[data-act]');
        const token = b?.closest('tr')?.dataset.token;
        const link = links.find(l => l.token === token);
        if (!link) return;
        try {
          if (b.dataset.act === 'show') await show(dlg, link);
          else {
            await api.revokeLink(token);
            toast('Đã thu hồi link', 'ok');
            await refresh(dlg);
          }
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    },
  });
}
