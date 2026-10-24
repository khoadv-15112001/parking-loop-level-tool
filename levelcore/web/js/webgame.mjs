// Xem / chơi level bằng game thật (bản WebGL playtest của game) — port từ FishLevel
// app/js/ui/webgame.mjs. Tên giao thức / tiêu đề / hướng dẫn build do game khai báo (game.mjs → webgame, mountDock).
// Game chạy trong <iframe src="/game/index.html"> cùng origin, gắn cố định ở cột preview của
// panel level (thay cho preview vẽ chấm), nói chuyện qua postMessage:
//   app → game  {target:<id>, method, arg:<chuỗi>}
//     LoadPack {pack, levels}        level đang xem của bộ mới (đổi bộ) — không gửi cả bộ
//     UpdateLevel {pack, level, data} đúng 1 level (chọn level khác, sửa bản nháp) — gửi cả bộ mỗi lần từng làm hết bộ nhớ
//     PreviewLevel n | LoadLevel n    xem (đứng yên, thấy cả level) | chơi thử
//     Highlight propId                làm nổi prop cùng loại (rỗng = bỏ)
//     SetOptions json | Cheat action
//   game → app  {source:<id>, type:'ready'|'packLoaded'|'line', line:'[<TAG>] …'}
// Luồng: ready → LoadPack → packLoaded → PreviewLevel N → preview_ready; chọn level / sửa: UpdateLevel → packLoaded → …
import { api } from './api.mjs';
import { $, esc, openDialog, toast } from './ui.mjs';

const ORIGIN = location.origin;
const OUTCOME = { win: ['Thắng', 'ok'], lose: ['Thua', 'err'], quit: ['Thoát', 'muted'] };
const INFO_TTL = 60_000;

let g = null;           // khung game đang gắn: {el, iframe, ready, pending, want, pack, levels, phase, mode, queued, highlight}
let dock = null;        // phần tử chứa khung game (cột preview)
let info = null, infoAt = 0;
let proto = { id: 'leveltool-game', tag: 'LEVELTOOL', title: 'Game — xem / chơi level', buildHint: '' };   // mountDock đặt lại

/** Dòng giao thức "[<TAG>] <cmd> <args…> k=v…" → {cmd, args, kv, rest}. */
export function parseLine(line) {
  const p = `[${proto.tag}]`;
  if (!line || !line.startsWith(p)) return null;
  const m = /^\s+(\S+)\s*(.*)$/.exec(line.slice(p.length));
  if (!m) return null;
  const words = m[2].split(/\s+/).filter(Boolean), args = [], kv = {};
  for (const w of words) {
    const i = w.indexOf('=');
    if (i > 0) kv[w.slice(0, i)] = w.slice(i + 1); else args.push(w);
  }
  return { cmd: m[1], args, kv, rest: m[2] };
}

function send(method, arg = '') {
  g?.iframe.contentWindow?.postMessage({ target: proto.id, method, arg: String(arg) }, ORIGIN);
}

function status(text, cls = '') {
  const s = $('.wg-status', g.el);
  s.textContent = text;
  s.title = text;   // 1 dòng cùng tiêu đề: dài thì cắt "…", rê chuột xem đủ
  s.className = `wg-status small ${cls}`;
}

function renderResults() {
  $('.wg-results', g.el).innerHTML = g.results.slice(-8).reverse().map(r => {
    const [label, cls] = OUTCOME[r.outcome] || [r.outcome, ''];
    return `<li><b class="${cls}">${esc(label)}</b> level ${esc(r.level)} · ${esc(r.kv.time ?? '?')}s`
      + `${r.kv.timeLeft != null ? ` · còn ${esc(r.kv.timeLeft)}s` : ''}${r.kv.boosters != null ? ` · booster ${esc(r.kv.boosters)}` : ''}`
      + `${r.kv.cause ? ` · ${esc(r.kv.cause)}` : ''}${r.kv.cheat ? ' · <span class="muted">cheat</span>' : ''}</li>`;
  }).join('');
}

const verb = () => (g.mode === 'preview' ? 'dựng' : 'mở');

function afterSettled() {   // game rảnh: chạy yêu cầu đang xếp hàng (level mới nhất được chọn / bản nháp mới nhất)
  if (!g.queued) return false;
  const q = g.queued;
  g.queued = null;
  if (q.mode) setMode(q.mode);
  sendUpdate(q.n, q.data);
  return true;
}

function onMessage(e) {
  if (!g || e.source !== g.iframe.contentWindow || e.origin !== ORIGIN) return;
  const d = e.data;
  if (!d || d.source !== proto.id) return;
  if (d.type === 'ready') {
    g.ready = true;
    if (g.pending) { send('LoadPack', g.pending); g.pending = null; status('Đang nạp bộ level vào game…'); }
    else status('Game sẵn sàng');
  } else if (d.type === 'packLoaded') {
    if (g.want != null) {
      send(g.mode === 'preview' ? 'PreviewLevel' : 'LoadLevel', g.want);
      g.phase = 'loading';
      status(`Đang ${verb()} level ${g.want}…`);
    }
  } else if (d.type === 'line') {
    const p = parseLine(d.line);
    if (!p) return;
    const n = Number(p.args[0]);
    if (p.cmd === 'preview_ready') {
      g.phase = 'ready';
      if (afterSettled()) return;
      status(`Level ${n} · ${p.kv.props ?? '?'} prop · sửa level hoặc bấm 👁 ở target để làm nổi prop`, 'ok');
      if (g.highlight) send('Highlight', g.highlight);
    } else if (p.cmd === 'highlight') {
      if (g.highlight) status(`Level ${g.want} · làm nổi ${p.args[0]}: ${p.kv.count ?? 0} prop`, 'ok');
    } else if (p.cmd === 'level_start') {
      if (n === g.want) { g.phase = 'play'; status(`Đang chơi level ${n}`, 'ok'); afterSettled(); }
      else status(`Game đang ở level ${n} — chờ mở level ${g.want}…`);
    } else if (p.cmd === 'level_end') {
      g.results.push({ level: n, outcome: p.args[1], kv: p.kv });
      renderResults();
      const [label] = OUTCOME[p.args[1]] || [p.args[1]];
      status(`Level ${n}: ${label} sau ${p.kv.time ?? '?'}s`, (OUTCOME[p.args[1]] || [])[1] || '');
    } else if (p.cmd === 'load_error') {
      g.phase = 'ready';
      if (afterSettled()) return;
      status(`Không mở được level ${p.args[0]}: ${p.rest.slice(p.args[0].length).trim()}`, 'err');
    } else if (p.cmd === 'stuck') {
      status(`Level ${n} bị kẹt (${p.kv.cause || '?'})`, 'warn');
    } else if (p.cmd === 'cheat_error') {
      toast(`Cheat lỗi: ${p.rest}`, 'err');
    }
  }
}

function build() {
  const el = document.createElement('section');
  el.className = 'webgame docked';
  el.innerHTML = `<header class="wg-head"><b class="wg-title"></b><span class="wg-status small"></span>
      <button data-act="mode" class="wg-mode" title="Đổi giữa xem level (đứng yên, thấy cả map) và chơi thử"></button>
      <button data-act="win" title="Thắng ngay (cheat)">Thắng</button>
      <button data-act="lose" title="Thua ngay (cheat)">Thua</button>
      <button data-act="restart" title="Chơi lại level">↺</button>
      <select class="wg-speed" title="Tốc độ game"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>
      <button data-act="reload" title="Tải lại game">⟳</button>
      <button data-act="upload" title="Tải bản build game mới lên server (admin)">⬆</button></header>
    <div class="wg-frame"><iframe title="${esc(proto.title)}" allow="autoplay; fullscreen"></iframe></div>
    <ul class="wg-results small"></ul>`;
  dock.replaceChildren(el);
  const iframe = $('iframe', el);
  g = { el, iframe, ready: false, pending: null, want: null, pack: '', levels: null, phase: 'idle', results: [],
    mode: 'preview', queued: null, highlight: null };
  setMode('preview');
  iframe.src = `/game/index.html?parent=${encodeURIComponent(ORIGIN)}`;
  el.addEventListener('click', e => {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'upload') return askForBuild(true);
    if (act === 'mode') {
      setMode(g.mode === 'preview' ? 'play' : 'preview');
      if (g.ready && g.want != null && g.levels) {   // bộ đã nạp: chỉ cần ra lệnh xem / chơi level đang mở
        g.phase = 'loading';
        send(g.mode === 'preview' ? 'PreviewLevel' : 'LoadLevel', g.want);
        status(`Đang ${verb()} level ${g.want}…`);
      }
      return;
    }
    if (act === 'reload') return reload();
    if (!g.ready) return toast('Game chưa sẵn sàng');
    send('Cheat', act);
  });
  $('.wg-speed', el).addEventListener('change', e => g.ready && send('SetOptions', JSON.stringify({ speed: Number(e.target.value) })));
  addEventListener('message', onMessage);
  status('Đang tải game… (lần đầu vài trăm MB, các lần sau lấy từ cache)');
}

function reload() {
  g.ready = false;
  g.queued = null;
  g.pending = g.levels ? JSON.stringify({ pack: g.pack, levels: g.levels }) : null;
  g.phase = g.pending ? 'pack' : 'idle';
  g.iframe.src = g.iframe.src;
  status('Đang tải lại game…');
}

function setMode(mode) {
  g.mode = mode;
  g.el.classList.toggle('preview', mode === 'preview');
  $('.wg-title', g.el).textContent = mode === 'preview' ? '👁 Xem bằng game' : '▶ Chơi thử';
  $('.wg-mode', g.el).textContent = mode === 'preview' ? '▶ Chơi' : '👁 Xem';
}

/** Gửi đúng 1 level vào bộ đã nạp (UpdateLevel) rồi game báo packLoaded → xem / chơi level đó. */
function sendUpdate(n, data) {
  g.want = Number(n);
  g.levels[n] = data;
  g.phase = 'pack';
  if (g.ready) send('UpdateLevel', JSON.stringify({ pack: g.pack, level: String(n), data }));
  else g.pending = JSON.stringify({ pack: g.pack, levels: g.levels });
}

const busy = () => g.phase === 'pack' || g.phase === 'loading';

async function available() {
  if (!info || Date.now() - infoAt > INFO_TTL || !info.available) {
    try { info = await api.gameInfo(); infoAt = Date.now(); } catch { info = { available: false }; }
  }
  return info.available;
}

function showMissing() {
  dock.innerHTML = `<div class="game-missing"><p>Chưa có bản game WebGL trên server để xem level bằng game thật.</p>
    <button class="primary">⬆ Tải bản game lên</button></div>`;
  dock.querySelector('button').addEventListener('click', () => askForBuild(false));
}

/** Gắn khung game vào cột preview của panel level. */
/** opts = game.webgame {id, tag, title, buildHint} (game/web/game.mjs). */
export function mountDock(container, opts = {}) {
  dock = container;
  proto = { ...proto, ...opts };
}

/**
 * Hiện level n của bộ pack trong khung game (mode 'preview' = xem đứng yên, 'play' = chơi thử). data = bản đang mở (nháp).
 * Chỉ gửi đúng level cần xem: gửi cả bộ (bộ 600 level ~66 MB) làm tool tải lâu và WebGL hết bộ nhớ (abort "OOM").
 * Đổi bộ → LoadPack chỉ chứa level này (game xoá file level cũ của bộ trước); cùng bộ → UpdateLevel.
 */
export async function showLevel(pack, n, data, mode = 'preview') {
  if (!dock) return;
  if (!(await available())) { close(); return showMissing(); }
  if (!g) build();
  g.highlight = null;
  if (g.levels && g.pack === pack) {
    if (busy()) { g.queued = { n, data, mode }; return; }
    setMode(mode);
    sendUpdate(n, data);
    status(`Đang ${verb()} level ${n}…`);
    return;
  }
  setMode(mode);
  g.pack = pack;
  g.levels = { [n]: data };
  g.want = Number(n);
  g.queued = null;
  g.phase = 'pack';
  const payload = JSON.stringify({ pack, levels: g.levels });
  if (g.ready) { send('LoadPack', payload); status(`Đang ${verb()} level ${n}…`); }
  else g.pending = payload;
}

/** Đang xem (preview) đúng level này của bộ này? — main.mjs gọi khi bản nháp đổi để cập nhật khung game. */
export const isPreviewing = (pack, levelNo) => !!g && g.mode === 'preview' && g.pack === pack && g.want === Number(levelNo);

/** Bản nháp đổi khi đang xem: cập nhật level đó trong game rồi dựng lại. Đang dựng dở thì xếp hàng bản mới nhất. */
export function refreshPreview(data) {
  if (!g || g.mode !== 'preview' || !g.levels) return;
  if (busy()) g.queued = { n: g.want, data };
  else { sendUpdate(g.want, data); status(`Đang cập nhật level ${g.want}…`); }
}

/** Làm nổi prop có ID này trong khung xem (null = bỏ). Đang dựng dở thì gửi khi dựng xong (preview_ready). */
export function highlight(propId) {
  if (!g || (propId || null) === g.highlight) return;
  g.highlight = propId || null;
  if (g.mode === 'preview' && g.phase === 'ready') send('Highlight', g.highlight || '');
}

export function close() {
  if (!g) return;
  removeEventListener('message', onMessage);
  g.el.remove();
  g = null;
}

/** Hộp tải bản build game lên (admin) — khi chưa có game, hoặc nút ⬆ để thay bản mới. */
async function askForBuild(replace = false) {
  await openDialog({
    title: replace ? 'Cập nhật bản game WebGL' : 'Chưa có bản game WebGL',
    html: `<p>${replace ? 'Thay bản game đang có trên server (mọi người dùng bản mới từ lần mở sau).'
      : 'Server chưa có bản game để xem / chơi thử.'} ${proto.buildHint || 'Build bản WebGL playtest của game thành zip'}, rồi tải lên đây
      (cần quyền admin) hoặc chạy <code>levelcore\\tools\\install_game.py</code>.</p>
      <label>Zip bản build WebGL<input id="wg-zip" type="file" accept=".zip"></label><p id="wg-up" class="small"></p>`,
    actions: [{ label: 'Đóng', value: null }, {
      label: 'Tải lên', primary: true, onClick: async dlg => {
        const f = $('#wg-zip', dlg).files[0];
        if (!f) throw new Error('Chọn file zip');
        const mb = (f.size / 1048576).toFixed(0);
        $('#wg-up', dlg).textContent = `Đang tải ${mb} MB lên…`;
        await api.gameUpload(f, (i, k) => { $('#wg-up', dlg).textContent = `Đang tải ${mb} MB lên… ${i}/${k} phần${i === k ? ' — đang giải nén' : ''}`; });
        info = null;
        toast('Đã cài bản game — chọn lại level để xem', 'ok');
        if (g) reload();
        return true;
      },
    }],
  });
}
