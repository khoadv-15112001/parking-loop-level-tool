// Ghi một lượt chơi thử lên server (bảng plays): dùng chung cho khung game của app (webgame.mjs) và trang chơi trên điện
// thoại (phone/). Bắt đầu khi game báo level_start, gom sự kiện (dòng log của bridge, sự kiện có cấu trúc) rồi gửi theo
// lô mỗi vài giây, kết thúc khi game báo level_end. Lỗi mạng thì giữ lại gửi lần sau, không chặn người chơi.
const FLUSH_MS = 5000;

const newUid = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export class PlayRecorder {
  /** base: '/api' (app, cần đăng nhập) hoặc '/p/<token>' (link chơi thử); headers(): header gửi kèm. */
  constructor(base, headers = () => ({})) {
    this.base = base;
    this.headers = headers;
    this.play = null;
  }

  async post(path, body) {
    const text = JSON.stringify(body);
    // keepalive: lần gửi cuối lúc đóng trang / tải lại vẫn tới server (trình duyệt giới hạn ~64 KB)
    const res = await fetch(this.base + path, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...this.headers() }, body: text,
      keepalive: text.length < 60000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** info: {pack, level, rev, source, level_data, build, player}. Lượt cũ chưa kết thúc thì đóng là 'quit'. */
  start(info) {
    if (this.play) this.end({ result: 'quit' });
    const play = { uid: newUid(), t0: performance.now(), buffer: [], started: null, cheat: false, timer: null };
    play.started = this.post('/plays', { uid: play.uid, client: navigator.userAgent.slice(0, 80), ...info }).catch(() => null);
    play.timer = setInterval(() => this.flush(play), FLUSH_MS);
    this.play = play;
    return play.uid;
  }

  event(e) {
    if (this.play) this.play.buffer.push({ t: Math.round(performance.now() - this.play.t0), ...e });
  }

  markCheat() {
    if (this.play) this.play.cheat = true;
  }

  async flush(play, end = null) {
    if (!play || !(await play.started)) return;
    const events = play.buffer.splice(0);
    if (!events.length && !end) return;
    try {
      await this.post(`/plays/${play.uid}/events`, { events, ...(end ? { end } : {}) });
    } catch {
      play.buffer.unshift(...events);
    }
  }

  end({ result = null, summary = null } = {}) {
    const play = this.play;
    if (!play) return;
    this.play = null;
    clearInterval(play.timer);
    return this.flush(play, { result, summary, cheat: play.cheat, duration_ms: Math.round(performance.now() - play.t0) });
  }
}
