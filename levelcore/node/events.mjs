// Broker SSE trong tiến trình: ai đang online, đẩy event sau khi ghi DB. Cùng định dạng event với server Python.
export class Broker {
  constructor(now) {
    this.now = now;
    this.subs = new Set();
    this.counts = new Map();
    this.nextId = 1;
  }

  online() {
    return [...this.counts.entries()].filter(([, n]) => n > 0).map(([u]) => u).sort();
  }

  format(type, data) {
    return `id: ${this.nextId++}\nevent: ${type}\ndata: ${JSON.stringify({ type, ts: this.now(), ...data })}\n\n`;
  }

  subscribe(user, res) {
    const sub = { user, res };
    const n = (this.counts.get(user) || 0) + 1;
    this.counts.set(user, n);
    if (n === 1) this.publish('presence', { online: this.online(), joined: user });
    this.subs.add(sub);
    return sub;
  }

  unsubscribe(sub) {
    if (!this.subs.delete(sub)) return;
    const n = (this.counts.get(sub.user) || 1) - 1;
    if (n > 0) {
      this.counts.set(sub.user, n);
      return;
    }
    this.counts.delete(sub.user);
    this.publish('presence', { online: this.online(), left: sub.user });
  }

  publish(type, data) {
    const msg = this.format(type, data);
    for (const s of this.subs) {
      try {
        s.res.write(msg);
      } catch {
        this.subs.delete(s);
      }
    }
  }
}
