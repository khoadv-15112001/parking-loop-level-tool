// Ảnh level cho Thư viện, Thứ tự và danh sách dạng lưới. Ảnh của mỗi level theo nội dung (sha): ảnh chụp từ bản game lưu
// trên server (Node), không có thì hook `thumbnail(level) → chuỗi SVG` của game vẽ ngay trên trình duyệt. "Chụp ảnh còn
// thiếu" lần lượt dựng từng level trong khung game rồi chụp (bridge khai caps: ['capture']).
import { api, authHeaders } from './api.mjs';
import { esc, toast } from './ui.mjs';
import { captureLevel, gameCaps } from './webgame.mjs';

const urls = new Map();      // sha → Promise<object URL | null> (nhớ cả lượt đang tải: vẽ lại liên tiếp không tải lặp)
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

function imageUrl(sha) {
  if (!urls.has(sha)) {
    urls.set(sha, fetch(`/api/thumbs/${sha}`, { headers: authHeaders(), credentials: 'same-origin' })
      .then(async res => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null)
      .then(url => { if (!url) urls.delete(sha); return url; }));
  }
  return urls.get(sha);
}

/** Sau khi có ảnh mới / đổi bộ: tải lại danh sách ảnh của bộ ở lần vẽ sau. */
export function invalidate(sha = null) {
  havePack = null;
  if (sha) have.add(sha);
}

/** Điền ảnh vào mọi `.thumb[data-sha]` trong root; ô chưa có ảnh giữ nguyên nội dung (vd số level). */
export async function fillThumbs(root, pack, items, { thumbs = false, thumbnail = null } = {}) {
  await loadHave(pack, thumbs);
  if (thumbnail && (bodiesPack !== pack || items.some(lv => !bodies.has(lv.sha)))) {
    bodiesPack = null;
    await loadBodies(pack).catch(() => {});
  }
  for (const box of root.querySelectorAll('.thumb[data-sha]')) {
    const sha = box.dataset.sha;
    if (have.has(sha)) {
      imageUrl(sha).then(url => { if (url && box.isConnected) box.innerHTML = `<img alt="" src="${url}">`; }).catch(() => {});
    } else if (thumbnail && bodies.has(sha)) {
      try {
        const svg = String(thumbnail(bodies.get(sha)) || '');
        if (svg) box.innerHTML = svg;
      } catch { /* hook ảnh của game lỗi: giữ ô trống */ }
    }
  }
}

/** Vẽ lưới vào ul. items: level của danh sách (có sha, summary); card(lv) → HTML phần chữ của thẻ. */
export async function renderGrid(ul, pack, items, card, opts = {}) {
  ul.classList.add('grid');
  ul.innerHTML = items.map(lv => `<li data-name="${esc(lv.name)}" class="${card.cls(lv)}">
    <div class="thumb" data-sha="${esc(lv.sha)}"></div>${card.html(lv)}</li>`).join('') || '<li class="muted">Không có level nào.</li>';
  await fillThumbs(ul, pack, items, opts);
}

export const hasImage = sha => have.has(sha);
export const missing = items => items.filter(lv => !have.has(lv.sha));

/** data:image/png;base64,… → Blob (CSP connect-src 'self' không cho fetch data: URL). */
export function dataUrlBlob(url) {
  const [head, data] = url.split(',', 2);
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(head)?.[1] || 'image/png' });
}

async function needCapture() {
  if (!(await gameCaps()).includes('capture')) throw new Error('Bản game trên server chưa chụp được ảnh (bridge chưa khai caps capture)');
}

/** Chụp ảnh các level chưa có ảnh trên server; onProgress(xong, tổng). Dừng khi gặp lỗi đầu tiên. */
export async function captureMissing(pack, items, onProgress = () => {}) {
  await needCapture();
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

/** Chụp lại ảnh một level (bản đã lưu). */
export async function captureOne(pack, lv) {
  await needCapture();
  const d = await api.level(pack, lv.name);
  const sha = d.sha || lv.sha;
  const blob = dataUrlBlob(await captureLevel(pack, lv.name, d.level));
  await api.putThumb(sha, blob, 'capture');
  const old = await urls.get(sha);
  if (old) URL.revokeObjectURL(old);
  urls.delete(sha);
  have.add(sha);
}
