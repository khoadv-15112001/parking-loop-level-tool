// Hộp thoại + thông báo dùng chung. Không dùng innerHTML với dữ liệu thô: mọi chuỗi từ level / server qua esc().

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 4000);
}

export function fmtTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function shortUser(email) {
  return String(email || '').split('@')[0];
}

/**
 * Mở hộp thoại. `html` = nội dung (đã esc). actions: [{label, primary?, danger?, onClick(dlg) → false để giữ hộp}].
 * Trả Promise resolve giá trị trả về của action (hoặc null khi đóng).
 */
export function openDialog({ title, html = '', actions = [{ label: 'Đóng' }], onOpen }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'dialog-backdrop';
    back.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>
      <div class="dlg-body">${html}</div><div class="actions"></div></div>`;
    const dlg = back.firstElementChild;
    const close = v => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      if (a.danger) b.className = 'danger';
      b.addEventListener('click', async () => {
        if (!a.onClick) return close(a.value ?? null);
        b.disabled = true;
        try {
          const v = await a.onClick(dlg);
          if (v !== false) close(v === undefined ? true : v);
        } catch (e) {
          toast(e.message || String(e), 'err');
        } finally {
          b.disabled = false;
        }
      });
      $('.actions', dlg).appendChild(b);
    }
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey);
    $('#dialog-root').appendChild(back);
    onOpen?.(dlg);
    ($('input, select, textarea', dlg) || $('button.primary', dlg))?.focus();
  });
}

export function confirmDialog(title, message, okLabel = 'Đồng ý', danger = false) {
  return openDialog({
    title, html: `<p>${esc(message)}</p>`,
    actions: [{ label: 'Huỷ', value: false }, { label: okLabel, primary: !danger, danger, value: true }],
  });
}
