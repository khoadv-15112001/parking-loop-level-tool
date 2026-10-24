// Đồng bộ realtime (port ý tưởng sync.mjs của FishLevel): SSE /api/events đọc bằng fetch-stream (gửi được X-Dev-User,
// EventSource thì không), tự kết nối lại; khoá level + heartbeat 60 s, nhả khoá khi rời level / đóng trang.
import { api, authHeaders } from './api.mjs';

const listeners = new Map();   // type -> Set<fn>

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

function emit(type, data) {
  for (const fn of listeners.get(type) || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
  for (const fn of listeners.get('*') || []) {
    try { fn(type, data); } catch (e) { console.error(e); }
  }
}

let started = false;

export function startEvents() {
  if (started) return;
  started = true;
  (async function loop() {
    for (;;) {
      try {
        const res = await fetch('/api/events', { headers: authHeaders(), credentials: 'same-origin' });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        emit('connection', { online: true });
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let type = 'message', data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (data) {
              try { emit(type, JSON.parse(data)); } catch { /* bỏ dòng hỏng */ }
            }
          }
        }
      } catch (e) {
        console.warn('[sync] mất kết nối realtime', e);
      }
      emit('connection', { online: false });
      await new Promise(r => setTimeout(r, 3000));
    }
  })();
}

// ---------- khoá level ----------
const HEARTBEAT_MS = 60_000;
let held = null;   // {pack, name, timer}

export function heldLock() {
  return held && { pack: held.pack, name: held.name };
}

export async function acquire(pack, name) {
  if (held && (held.pack !== pack || held.name !== name)) await release();
  const out = await api.lock(pack, name);
  if (!held) {
    held = { pack, name };
    held.timer = setInterval(async () => {
      try {
        await api.heartbeat(pack, name);
      } catch (e) {
        emit('lock.lost', { pack, name, error: e });
        stopTimer();
      }
    }, HEARTBEAT_MS);
  }
  return out;
}

function stopTimer() {
  if (held?.timer) clearInterval(held.timer);
  held = null;
}

export async function release() {
  if (!held) return;
  const { pack, name } = held;
  stopTimer();
  try { await api.unlock(pack, name); } catch { /* hết hạn / đã bị phá — bỏ qua */ }
}

// Đóng tab: nhả khoá bằng keepalive (DELETE không chờ trả lời).
addEventListener('pagehide', () => {
  if (!held) return;
  const { pack, name } = held;
  fetch(`/api/locks/packs/${encodeURIComponent(pack)}/levels/${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: authHeaders(), keepalive: true, credentials: 'same-origin' }).catch(() => {});
});
