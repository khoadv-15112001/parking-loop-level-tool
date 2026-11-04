// Danh sách level dạng lưới ảnh. Ảnh của mỗi level theo nội dung (sha): ảnh chụp từ bản game lưu trên server (Node), không
// có thì hook `thumbnail(level) → chuỗi SVG` của game vẽ ngay trên trình duyệt. "Chụp ảnh còn thiếu" lần lượt dựng từng
// level trong khung game rồi chụp (bridge khai caps: ['capture']).
import { api, authHeaders } from './api.mjs';
import { esc, toast } from './ui.mjs';
import { canCapture, captureLevel } from './webgame.mjs';

const urls = new Map();      // sha → object URL ảnh đã tải
let have = new Set();        // sha có ảnh trên server
let havePack = null;
let bodies = new Map();      // sha → level (để vẽ SVG)
let bodiesPack = null;

async function loadHave(pack, enabled) {
  if (!enabled || havePack === pack) return;
  havePack = pack;
  try {
    have = new Set((await api.thumbsHave(pack)).have);
  } catch {
    have = new Set();
  }
}

async function loadBodies(pack, items = []) {
  if (bodiesPack === pack && items.every(lv => bodies.has(lv.sha))) return;
  bodiesPack = pack;
  const b = await api.bundle(pack);
  bodies = new Map(b.levels.map(l => [l.sha, l.level]));
}

async function imageUrl(sha) {
  if (urls.has(sha)) return urls.get(sha);
  const res = await fetch(`/api/thumbs/${sha}`, { headers: authHeaders(), credentials: 'same-origin' });
  if (!res.ok) return null;
  const url = URL.createObjectURL(await res.blob());
  urls.set(sha, url);
  return url;
}

/** Sau khi có ảnh mới / đổi bộ: tải lại danh sách ảnh của bộ ở lần vẽ sau. */
export function invalidate(sha = null) {
  havePack = null;
  if (sha) have.add(sha);
}

/** Vẽ lưới vào ul. items: level của danh sách (có sha, summary); card(lv) → HTML phần chữ của thẻ. */
export async function renderGrid(ul, pack, items, card, { thumbs = false, thumbnail = null } = {}) {
  ul.classList.add('grid');
  ul.innerHTML = items.map(lv => `<li data-name="${esc(lv.name)}" data-sha="${esc(lv.sha)}" class="${card.cls(lv)}">
    <div class="thumb"></div>${card.html(lv)}</li>`).join('') || '<li class="muted">Không có level nào.</li>';
  await loadHave(pack, thumbs);
  if (thumbnail && (bodiesPack !== pack || items.some(lv => !bodies.has(lv.sha)))) {
    bodiesPack = null;
    await loadBodies(pack).catch(() => {});
  }
  for (const li of ul.querySelectorAll('li[data-sha]')) {
    const sha = li.dataset.sha, box = li.querySelector('.thumb');
    if (have.has(sha)) {
      imageUrl(sha).then(url => { if (url) box.innerHTML = `<img alt="" src="${url}">`; }).catch(() => {});
    } else if (thumbnail && bodies.has(sha)) {
      try {
        box.innerHTML = String(thumbnail(bodies.get(sha)) || '');
      } catch {
        box.textContent = '';
      }
    }
  }
}

export const missing = items => items.filter(lv => !have.has(lv.sha));

/** data:image/png;base64,… → Blob (CSP connect-src 'self' không cho fetch data: URL). */
export function dataUrlBlob(url) {
  const [head, data] = url.split(',', 2);
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(head)?.[1] || 'image/png' });
}

/** Chụp ảnh các level chưa có ảnh trên server; onProgress(xong, tổng). Dừng khi gặp lỗi đầu tiên. */
export async function captureMissing(pack, items, onProgress = () => {}) {
  if (!canCapture()) throw new Error('Bản game đang mở chưa chụp được ảnh (bridge chưa khai caps capture)');
  await loadBodies(pack, items);
  const todo = missing(items);
  let done = 0;
  for (const lv of todo) {
    const level = bodies.get(lv.sha);
    if (!level) continue;
    const blob = dataUrlBlob(await captureLevel(pack, lv.name, structuredClone(level)));
    await api.putThumb(lv.sha, blob, 'capture');
    have.add(lv.sha);
    onProgress(++done, todo.length);
  }
  toast(`Đã chụp ${done} ảnh`, 'ok');
  return done;
}
