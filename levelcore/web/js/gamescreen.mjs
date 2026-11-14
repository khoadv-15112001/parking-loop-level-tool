// Kích thước màn hình của khung game (webgame.mjs), như Game view của Unity: theo tỉ lệ, hoặc cố định số pixel
// (ảnh SS cho UA / MKT). Cố định: game render đúng W×H pixel (ép devicePixelRatio = 1 trong iframe) rồi thu nhỏ bằng
// transform cho vừa khung; nút 📷 lưu PNG đúng W×H. Kích thước tự thêm lưu trên trình duyệt (localStorage).
import { storageKey } from './api.mjs';
import { $, esc, openDialog, toast } from './ui.mjs';

const MAX_FIXED_SIDE = 4096;
const BUILT_IN = [
  { id: 'fill', label: 'Vừa khung', fill: true },
  { id: '9x16', label: '9:16', w: 9, h: 16 },
  { id: '9x19.5', label: '9:19.5 (1080×2340)', w: 9, h: 19.5 },
  { id: '3x4', label: '3:4 (iPad)', w: 3, h: 4 },
  { id: 'ss', label: 'SS', w: 1080, h: 1920, fixed: true },
  { id: 'cpp', label: 'CPP', w: 2048, h: 2732, fixed: true },
  { id: '1290x2796', label: '', w: 1290, h: 2796, fixed: true },
];

const read = key => { try { return localStorage.getItem(storageKey(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(storageKey(key), value); } catch { /* bỏ qua */ } };

function customScreens() {
  try {
    const list = JSON.parse(read('gameScreens') || '[]');
    return Array.isArray(list) ? list.filter(s => s && s.id && s.w > 0 && s.h > 0) : [];
  } catch {
    return [];
  }
}

export const allScreens = () => [...BUILT_IN, ...customScreens().map(s => ({ ...s, custom: true }))];

export function currentScreen() {
  const id = read('gameScreen');
  return allScreens().find(s => s.id === id) || BUILT_IN[0];
}

export function screenName(s) {
  if (s.fill) return s.label;
  if (!s.fixed) return s.label || `${s.w}:${s.h}`;
  return `${s.label ? `${s.label} · ` : ''}${s.w}×${s.h}`;
}

/** <option> của ô chọn kích thước (kèm "＋ Thêm / xoá…" value="+"). */
export function screenOptions() {
  const cur = currentScreen().id, all = allScreens();
  const opts = list => list.map(s => `<option value="${esc(s.id)}"${s.id === cur ? ' selected' : ''}>${esc(screenName(s))}</option>`).join('');
  return `${opts(all.filter(s => s.fill))}<optgroup label="Tỉ lệ">${opts(all.filter(s => !s.fill && !s.fixed))}</optgroup>`
    + `<optgroup label="Cố định (pixel)">${opts(all.filter(s => s.fixed))}</optgroup><option value="+">＋ Thêm / xoá kích thước…</option>`;
}

export const selectScreen = id => write('gameScreen', id);

/** Đặt khung `box` theo tỉ lệ và iframe theo kích thước cố định (thu nhỏ cho vừa). */
export function fitGame(box, iframe, s = currentScreen()) {
  box.classList.toggle('fill', !!s.fill);
  box.classList.toggle('fixed', !!s.fixed);
  if (!s.fill) box.style.setProperty('--screen-ratio', String(s.w / s.h));
  if (!s.fixed) { iframe.style.width = iframe.style.height = iframe.style.transform = ''; return null; }
  iframe.style.width = `${s.w}px`;
  iframe.style.height = `${s.h}px`;
  const scale = box.clientWidth / s.w;
  iframe.style.transform = `scale(${scale})`;
  return scale;
}

/** Gọi khi iframe tải xong trang game: cố định thì game render 1 pixel CSS = 1 pixel ảnh. */
export function applyPixelRatio(iframe, s = currentScreen()) {
  if (!s.fixed) return;
  try { iframe.contentWindow.devicePixelRatio = 1; } catch { /* trang khác origin */ }
}

const parseSide = v => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

/** Hộp thêm / xoá kích thước tự thêm. Trả id kích thước vừa thêm (null nếu không thêm). */
export async function editScreens() {
  const listHtml = () => {
    const list = customScreens();
    return list.length ? list.map(s => `<li>${esc(screenName(s))} <span class="muted small">${s.fixed ? 'cố định' : 'tỉ lệ'}</span>
      <button data-del="${esc(s.id)}" title="Xoá kích thước này">✕</button></li>`).join('') : '<li class="muted">Chưa có kích thước tự thêm</li>';
  };
  return openDialog({
    title: 'Kích thước màn hình game',
    html: `<ul class="gs-list">${listHtml()}</ul>
      <label>Tên<input id="gs-label" placeholder="VD: SS Android"></label>
      <label>Kiểu<select id="gs-type"><option value="fixed">Cố định (pixel)</option><option value="ratio">Tỉ lệ</option></select></label>
      <div class="gs-size"><label>Rộng<input id="gs-w" type="number" min="1" step="any" placeholder="1080"></label>
      <span>×</span><label>Cao<input id="gs-h" type="number" min="1" step="any" placeholder="1920"></label></div>
      <p class="small muted">Lưu trên trình duyệt này. Cố định: game render đúng số pixel, nút 📷 lưu ảnh đúng kích thước đó.</p>`,
    onOpen: dlg => dlg.addEventListener('click', e => {
      const id = e.target.closest('[data-del]')?.dataset.del;
      if (!id) return;
      write('gameScreens', JSON.stringify(customScreens().filter(s => s.id !== id)));
      if (read('gameScreen') === id) selectScreen(BUILT_IN[0].id);
      $('.gs-list', dlg).innerHTML = listHtml();
    }),
    actions: [{ label: 'Đóng', value: null }, {
      label: 'Thêm và dùng', primary: true, onClick: dlg => {
        const w = parseSide($('#gs-w', dlg).value), h = parseSide($('#gs-h', dlg).value);
        const fixed = $('#gs-type', dlg).value === 'fixed';
        if (!w || !h) throw new Error('Nhập rộng và cao lớn hơn 0');
        if (fixed && (!Number.isInteger(w) || !Number.isInteger(h) || Math.max(w, h) > MAX_FIXED_SIDE)) {
          throw new Error(`Kích thước cố định là số nguyên, tối đa ${MAX_FIXED_SIDE} pixel mỗi cạnh`);
        }
        const s = { id: `c${Date.now().toString(36)}`, label: $('#gs-label', dlg).value.trim(), w, h, fixed };
        write('gameScreens', JSON.stringify([...customScreens(), s]));
        selectScreen(s.id);
        return s.id;
      },
    }],
  });
}

function blank(canvas) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 16;
  const ctx = probe.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 16, 16);
  return ctx.getImageData(0, 0, 16, 16).data.every((v, i) => i % 4 === 3 || v === 0);
}

/** Ảnh PNG của canvas game ngay sau khi game vẽ xong 1 khung hình; null nếu không đọc được (buffer đã xoá). */
export function grabCanvas(iframe) {
  const win = iframe?.contentWindow, canvas = win?.document?.querySelector('canvas');
  if (!canvas) return Promise.resolve(null);
  return new Promise(resolve => win.requestAnimationFrame(() => {
    if (blank(canvas)) return resolve(null);
    canvas.toBlob(blob => resolve(blob ? { blob, width: canvas.width, height: canvas.height } : null), 'image/png');
  }));
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const savedToast = (w, h) => toast(`Đã lưu ảnh ${w}×${h}`, 'ok');
