// Trang đăng nhập Google của Firebase project BI — cách đăng nhập DUY NHẤT của tool level. Ba chế độ (?mode=):
//   session — popup mở từ hộp "Đăng nhập": đổi Firebase ID token lấy phiên của tool (POST /auth/firebase) → postMessage về app.
//   token   — popup mở từ nút "Đẩy lên BI": postMessage chính Firebase ID token (server chuyển tiếp lên BI Level Hub).
//   (không)  — cả trang (server chuyển sang đây khi chưa đăng nhập, ?next=): đổi lấy phiên, ghi token cho app rồi quay lại next.
// Phiên Firebase nhớ trong IndexedDB của origin này nên lần sau popup tự vào, không bấm gì. Token Firebase KHÔNG ghi localStorage / log.
(() => {
  const b = document.body.dataset;
  const q = new URLSearchParams(location.search);
  const mode = ['session', 'token'].includes(q.get('mode')) ? q.get('mode') : 'page';
  const $ = id => document.getElementById(id);
  $('env').textContent = b.env || '';
  const say = (t, bad) => { $('msg').textContent = t; $('msg').className = bad ? 'bad' : ''; };

  // chỉ quay về cùng origin (chống open-redirect): nhận URL tuyệt đối cùng origin hoặc đường dẫn gốc "/…"
  function nextUrl() {
    try {
      const u = new URL(q.get('next') || '/app/', location.origin);
      return u.origin === location.origin ? u.pathname + u.search + u.hash : '/app/';
    } catch { return '/app/'; }
  }

  if (mode !== 'page' && !window.opener) { say('Mở trang này từ tool level (nút đăng nhập / Đẩy lên BI).', true); return; }
  if (!window.firebase) { say('Không tải được Firebase SDK (kiểm tra mạng).', true); return; }

  firebase.initializeApp({ apiKey: b.apiKey, authDomain: b.authDomain, projectId: b.projectId, appId: b.appId });
  const auth = firebase.auth();

  const reply = msg => { window.opener.postMessage(msg, location.origin); say('Xong — đang đóng…'); setTimeout(() => window.close(), 200); };

  async function finish(user) {
    try {
      const idToken = await user.getIdToken();
      if (mode === 'token') return reply({ type: 'bi-token', token: idToken, email: user.email || '', env: b.env });
      const r = await fetch('/auth/firebase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }), cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // vd 403: email không thuộc allowlist → cho chọn tài khoản khác thay vì kẹt
        $('go').hidden = false; $('go').textContent = 'Chọn tài khoản khác';
        return say(j.detail || `Đăng nhập thất bại (HTTP ${r.status})`, true);
      }
      if (mode === 'session') return reply({ type: 'bi-session', token: j.token, email: j.email });
      // phiên đi theo cookie httponly do /auth/firebase đặt — trang không cần biết khoá localStorage của tool
      say('Đã đăng nhập — đang quay lại tool…');
      location.replace(nextUrl());
    } catch (e) { say('Không hoàn tất đăng nhập: ' + (e?.message || e), true); $('go').hidden = false; }
  }

  $('go').addEventListener('click', async () => {
    $('go').hidden = true; say('Đang mở đăng nhập Google…');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const res = await auth.signInWithPopup(provider);
      await finish(res.user);
    } catch (e) {
      $('go').hidden = false;
      const hint = e?.code === 'auth/unauthorized-domain'
        ? ` Domain "${location.hostname}" chưa nằm trong Authorized domains của Firebase BI — nhờ chủ BI thêm (dev local: dùng localhost, không dùng 127.0.0.1).` : '';
      say(`Đăng nhập lỗi: ${e?.code || e?.message || e}.${hint}`, true);
    }
  });

  const off = auth.onAuthStateChanged(user => {
    off();
    if (user) finish(user);
    else { say('Đăng nhập bằng tài khoản Google của BI.'); $('go').hidden = false; }
  });
})();
