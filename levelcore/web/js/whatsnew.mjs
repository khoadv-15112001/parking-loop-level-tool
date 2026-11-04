// Bảng "Có gì mới" của vỏ app: dữ liệu ở /app/game/releases.json (game/web/releases.json, khung ở releases.mjs).
// Bấm số phiên bản ở góc trái để mở; lên bản mới thì tự mở một lần cho mỗi người. Game không có file thì không hiện gì.
import { visibleSections } from './releases.mjs';
import { esc, openDialog } from './ui.mjs';

let entries = null;

async function load() {
  if (entries) return entries;
  try {
    const res = await fetch('/app/game/releases.json', { credentials: 'same-origin', cache: 'no-cache' });
    entries = res.ok ? await res.json() : [];
  } catch {
    entries = [];
  }
  return Array.isArray(entries) ? entries : [];
}

function render(list) {
  return list.slice(0, 8).map(e => `<section class="whatsnew"><h3>${esc(e.version)}${e.date ? ` · ${esc(e.date)}` : ''} · ${esc(e.title)}</h3>
    ${visibleSections(e).map(([k, label]) => `<p class="small ${k === 'notice' ? 'warn' : 'muted'}"><b>${esc(label)}</b></p>
      <ul class="small">${e[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</section>`).join('');
}

export async function openWhatsNew() {
  const list = await load();
  if (!list.length) return;
  await openDialog({ title: 'Có gì mới', html: render(list) });
}

/** Gắn vào nhãn phiên bản; version là bản đang chạy (đã bỏ tiền tố tag, vd "v1.2.0"). */
export async function mountWhatsNew(label, version, storageKey) {
  const list = await load();
  if (!list.length) return;
  label.classList.add('clickable');
  label.title = 'Có gì mới';
  label.addEventListener('click', openWhatsNew);
  const running = String(version || '').replace(/^v/, '');
  if (!list.some(e => e.version === running)) return;
  let seen = '';
  try { seen = localStorage.getItem(storageKey) || ''; } catch { /* bỏ qua */ }
  if (seen === running) return;
  try { localStorage.setItem(storageKey, running); } catch { /* bỏ qua */ }
  if (seen) openWhatsNew();
}
