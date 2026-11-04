// Trang chơi thử trên điện thoại /p/<token>: mở không cần đăng nhập, nạp đúng level ghim trong link vào bản game đang
// dùng (cùng giao thức postMessage với khung game của app, levelcore/web/js/webgame.mjs) và ghi từng lượt chơi.
import { PlayRecorder } from '/p/assets/playrecorder.mjs';

const token = location.pathname.split('/')[2];
const base = `/p/${token}`;
const $ = sel => document.querySelector(sel);
const PLAYER_KEY = 'levelcore.phone.player';
const DEVICE_KEY = 'levelcore.phone.device';
const OUTCOME = { win: ['Thắng', 'ok'], lose: ['Thua', 'err'], quit: ['Thoát', 'muted'] };

let info = null, frame = null, ready = false, phase = 'idle';
const recorder = new PlayRecorder(base);

const status = (text, cls = '') => {
  $('#status').textContent = text;
  $('#status').className = `small ${cls || 'muted'}`;
};
// Không bắt nhập tên: mỗi máy có mã ẩn danh (nhớ trên máy) để gom lượt chơi; tên đặt rồi thì dùng tên, nhớ cho mọi link.
const stored = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const store = (key, v) => { try { localStorage.setItem(key, v); } catch { /* trình duyệt chặn lưu trữ */ } };
let name = stored(PLAYER_KEY);
let device = stored(DEVICE_KEY);
if (!device) {
  device = Math.random().toString(16).slice(2, 8);
  store(DEVICE_KEY, device);
}
const player = () => name || `#${device}`;

function showName() {
  $('#who').textContent = name ? `👤 ${name}` : '👤 Đặt tên';
}

function send(method, arg = '') {
  frame?.contentWindow?.postMessage({ target: info.webgame.id, method, arg: String(arg) }, location.origin);
}

function parseLine(line) {
  const p = `[${info.webgame.tag}]`;
  if (!line || !line.startsWith(p)) return null;
  const m = /^\s+(\S+)\s*(.*)$/.exec(line.slice(p.length));
  if (!m) return null;
  const args = [], kv = {};
  for (const w of m[2].split(/\s+/).filter(Boolean)) {
    const i = w.indexOf('=');
    if (i > 0) kv[w.slice(0, i)] = w.slice(i + 1); else args.push(w);
  }
  return { cmd: m[1], args, kv };
}

function load() {
  phase = 'pack';
  send('LoadPack', JSON.stringify({ pack: info.pack, levels: { [info.level]: info.level_data }, source: 'link' }));
  status('Đang mở level…');
}

function onMessage(e) {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.source !== info.webgame.id) return;
  if (d.type === 'ready') {
    ready = true;
    $('#again').disabled = false;
    load();
  } else if (d.type === 'packLoaded') {
    phase = 'loading';
    send('LoadLevel', info.level);
  } else if (d.type === 'event') {
    if (d.event && typeof d.event === 'object') recorder.event({ type: 'event', ...d.event });
  } else if (d.type === 'line') {
    const p = parseLine(d.line);
    if (!p) return;
    if (phase === 'play' || p.cmd === 'level_end') recorder.event({ line: d.line });
    if (p.cmd === 'level_start') {
      phase = 'play';
      recorder.start({ pack: info.pack, level: info.level, rev: info.rev, level_data: info.level_data, player: player() });
      recorder.event({ line: d.line });
      status(`Đang chơi level ${info.level}`, 'ok');
    } else if (p.cmd === 'level_end') {
      phase = 'done';
      recorder.end({ result: p.args[1], summary: p.kv });
      const [label, cls] = OUTCOME[p.args[1]] || [p.args[1], ''];
      $('#results').insertAdjacentHTML('afterbegin', `<li><b class="${cls}">${label}</b> · ${p.kv.time ?? '?'}s</li>`);
      status(`${label} — bấm Chơi lại để chơi tiếp`, cls);
    } else if (p.cmd === 'load_error') {
      status(`Game không mở được level: ${d.line.slice(d.line.indexOf(p.cmd) + p.cmd.length).trim()}`, 'err');
    }
  }
}

async function main() {
  showName();
  $('#who').addEventListener('click', () => {
    const v = prompt('Tên của bạn (không bắt buộc, để trống thì ẩn danh):', name);
    if (v == null) return;
    name = v.trim().slice(0, 40);
    store(PLAYER_KEY, name);
    showName();
  });
  const res = await fetch(`${base}/info`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    $('#frame').innerHTML = `<p class="center">${res.status === 410 ? 'Link đã hết hạn hoặc bị thu hồi.' : 'Link không tồn tại.'}<br><span class="muted small">${body.detail || ''}</span></p>`;
    return;
  }
  info = body;
  document.title = `${info.tool} · level ${info.level}`;
  $('#tool').textContent = info.tool;
  $('#what').textContent = `level ${info.level}${info.name ? ` · ${info.name}` : ''}${info.rev ? ` · r${info.rev}` : ' · bản nháp'}`;
  frame = document.createElement('iframe');
  frame.title = `${info.game} — chơi thử`;
  frame.allow = 'autoplay; fullscreen';
  frame.src = `${base}/game/index.html?parent=${encodeURIComponent(location.origin)}`;
  $('#frame').replaceChildren(frame);
  addEventListener('message', onMessage);
  addEventListener('pagehide', () => recorder.end({ result: 'quit' }));
  $('#again').addEventListener('click', () => ready && load());
  status('Đang tải game… (lần đầu hơi lâu)');
}

main().catch(e => status(e.message, 'err'));
