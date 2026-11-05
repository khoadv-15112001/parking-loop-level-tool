// Đăng nhập Google của Firebase project BI (port từ AntLevel app/js/biauth.mjs) qua popup /bi/login cùng origin:
//   biSessionLogin() — đổi Firebase ID token lấy phiên của tool (đăng nhập app).
//   biLogin()        — lấy Firebase ID token để gọi BI Level Hub (header X-BI-Token); nhớ trong bộ nhớ tới gần hạn.
// Firebase giữ phiên trong popup nên lần sau popup tự đăng nhập rồi tự đóng. Token BI KHÔNG ghi localStorage / log.
// PHẢI gọi ngay trong lúc xử lý click (trước await đầu tiên) — trình duyệt chỉ cho mở popup trong thao tác người dùng.

const TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
let cached = null, pending = null;

function popup(mode, type) {
  const url = new URL('/bi/login', location.href);
  url.searchParams.set('mode', mode);
  const w = window.open(url.href, 'levelcore-bi-login', 'popup,width=480,height=640');
  if (!w) return Promise.reject(new Error('Trình duyệt chặn cửa sổ đăng nhập — cho phép popup rồi thử lại.'));
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { clearInterval(poll); clearTimeout(timer); removeEventListener('message', onMsg); fn(v); };
    const onMsg = e => {
      if (e.origin !== location.origin || e.source !== w || e.data?.type !== type || !e.data.token) return;
      done(resolve, { token: e.data.token, email: e.data.email || '' });
    };
    const poll = setInterval(() => { if (w.closed) done(reject, new Error('Đã đóng cửa sổ đăng nhập BI.')); }, 500);
    const timer = setTimeout(() => done(reject, new Error('Đăng nhập BI quá hạn.')), TIMEOUT_MS);
    addEventListener('message', onMsg);
  });
}

function expiresAt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return Number(JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '='))).exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

export function biLogin() {
  if (cached && cached.expiresAt > Date.now() + REFRESH_SKEW_MS) return Promise.resolve(cached);
  if (pending) return pending;
  pending = popup('token', 'bi-token').then(login => {
    const exp = expiresAt(login.token);
    cached = exp > Date.now() ? { ...login, expiresAt: exp } : null;
    return login;
  }).finally(() => { pending = null; });
  return pending;
}

export const biSessionLogin = () => popup('session', 'bi-session');
export const currentBiLogin = () => cached && cached.expiresAt > Date.now() + REFRESH_SKEW_MS ? cached : null;
export const clearBiLogin = () => { cached = null; };
