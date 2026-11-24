// Màn Chơi thử: vẽ ParkingModel (model.mjs) bằng art của bản Unity, có anim và VFX.
// Art, âm thanh, font: game/web/art/ (chép bằng node game/tools/unity_art.mjs <repo Unity>). Thiếu ảnh nào thì vẽ hình đơn giản.
import { CODES, COLOR_HEX } from './format.mjs';

const ART = new URL('./art/', import.meta.url);
export const artUrl = name => new URL(name, ART).href;
const codeOf = ch => CODES.indexOf(String(ch).toUpperCase()) + 1;
const hexOf = ch => COLOR_HEX[codeOf(ch)] || COLOR_HEX[0];
const TAU = Math.PI * 2;
const ease = t => 1 - (1 - t) ** 3;
const back = t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const rnd = (a, b) => a + Math.random() * (b - a);
const FONT = 'PLMikado, "Arial Rounded MT Bold", system-ui, sans-serif';

// ───────────────────────────── art ─────────────────────────────

const IMAGES = [
  ...Array.from({ length: 15 }, (_, i) => `car${i + 1}`), 'car_hidden', 'splash', 'lock', 'lockkey', 'lockbox', 'garage', 'ice_tex',
  'ice_piece1', 'ice_piece2', 'ice_piece3', 'ice_piece4', 'ice_piece5', 'blocker', 'platform', 'curtain_top', 'curtain_mid',
  'curtain_under', 'curtain_open1', 'curtain_open2', 'curtain_open3', 'rope', 'badge', 'asphalt', 'grass_left', 'grass_right',
  'ground', 'tap_hand', 'fx_star', 'fx_glow', 'fx_spark', 'fx_firework', 'fx_smoke', 'fx_confetti', 'mascot_fail', 'boost_hammer',
];
const img = {};
let loading = null;
const ok = i => !!i && i.complete && i.naturalWidth > 0;

export function loadArt() {
  loading ??= Promise.all([
    ...IMAGES.map(n => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = artUrl(`${n}.png`); img[n] = i; })),
    (async () => { try { const f = new FontFace('PLMikado', `url(${artUrl('mikado.otf')})`); await f.load(); document.fonts.add(f); } catch { /* dùng font hệ thống */ } })(),
  ]);
  return loading;
}

const tintCache = new Map();
/** Ảnh trắng nhuộm màu (rèm, vết sơn, confetti, glow). */
function tinted(name, hex) {
  const i = img[name];
  if (!ok(i)) return null;
  const key = `${name}${hex}`;
  let cv = tintCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = i.naturalWidth; cv.height = i.naturalHeight;
    const c = cv.getContext('2d');
    c.drawImage(i, 0, 0);
    c.globalCompositeOperation = 'multiply'; c.fillStyle = hex; c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(i, 0, 0);
    tintCache.set(key, cv);
  }
  return cv;
}

const patterns = new WeakMap();
function pattern(c, name, size) {
  const i = img[name];
  if (!ok(i)) return null;
  let p = patterns.get(c)?.[name];
  if (!p) { p = c.createPattern(i, 'repeat'); patterns.set(c, { ...patterns.get(c), [name]: p }); }
  p.setTransform(new DOMMatrix().scale(size / i.naturalWidth));
  return p;
}

// ───────────────────────────── âm thanh ─────────────────────────────

const SFX = { tap: 'sfx_tap.wav', go: 'sfx_go.ogg', bump: 'sfx_bump.ogg', insert: 'sfx_insert.ogg', clear: 'sfx_clear.ogg', win: 'sfx_win.ogg', lose: 'sfx_lose.ogg', noroom: 'sfx_noroom.wav', click: 'sfx_click.ogg' };
let actx = null;
const buffers = {}, lastPlayed = {};
export const sound = {
  get on() { try { return localStorage.getItem('parkinglevel.sound') !== '0'; } catch { return true; } },
  set on(v) { try { localStorage.setItem('parkinglevel.sound', v ? '1' : '0'); } catch { /* không lưu được */ } },
  ctx() { try { actx ??= new AudioContext(); } catch { actx = null; } return actx; },
  preload() {
    const a = this.ctx();
    if (!a) return;
    for (const [n, f] of Object.entries(SFX)) {
      if (buffers[n]) continue;
      buffers[n] = 'loading';
      fetch(artUrl(f)).then(r => r.arrayBuffer()).then(b => a.decodeAudioData(b)).then(d => { buffers[n] = d; }).catch(() => { buffers[n] = null; });
    }
  },
  play(name, vol = 0.55) {
    if (!this.on) return;
    const a = this.ctx(), b = buffers[name], now = performance.now();
    if (!a || !(b instanceof AudioBuffer) || now - (lastPlayed[name] || 0) < 60) return;
    lastPlayed[name] = now;
    if (a.state === 'suspended') a.resume().catch(() => {});
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = b; g.gain.value = vol;
    s.connect(g).connect(a.destination);
    s.start();
  },
};

// ───────────────────────────── hạt (VFX) ─────────────────────────────

class Particles {
  constructor() { this.list = []; }
  /** n hạt ảnh `name` toả từ (x, y). */
  burst(name, x, y, o = {}) {
    const { n = 8, speed = 120, life = 0.6, size = 16, grow = 0, gravity = 0, tint = null, add = false, spin = 0, dir = -Math.PI / 2,
      spread = TAU, cells = 0, drag = 0, fade = 1, jitter = 0.4 } = o;
    for (let k = 0; k < n; k++) {
      const a = dir + (Math.random() - 0.5) * spread, v = speed * rnd(1 - jitter, 1 + jitter);
      this.list.push({
        name, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: life * rnd(0.75, 1.25), size: size * rnd(0.7, 1.3), grow, gravity,
        tint: Array.isArray(tint) ? tint[k % tint.length] : tint, add, rot: rnd(0, TAU), vr: spin * rnd(-1, 1), drag, fade,
        cell: cells ? (Math.random() * cells * cells) | 0 : -1, cells,
      });
    }
  }
  update(dt) {
    for (const q of this.list) {
      q.t += dt; q.vy += q.gravity * dt;
      if (q.drag) { const k = Math.max(0, 1 - q.drag * dt); q.vx *= k; q.vy *= k; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt; q.size += q.grow * dt;
    }
    this.list = this.list.filter(q => q.t < q.life);
  }
  draw(c) {
    for (const q of this.list) {
      const src = q.tint ? tinted(q.name, q.tint) : img[q.name];
      if (!src || (src instanceof Image && !ok(src))) continue;
      const k = q.t / q.life;
      c.globalAlpha = Math.max(0, Math.min(1, q.fade ? (1 - k) * 1.4 : 1));
      c.globalCompositeOperation = q.add ? 'lighter' : 'source-over';
      c.save(); c.translate(q.x, q.y); c.rotate(q.rot);
      const s = Math.max(0.5, q.size);
      if (q.cell >= 0) {
        const w = (src.width || src.naturalWidth) / q.cells, h = (src.height || src.naturalHeight) / q.cells;
        c.drawImage(src, (q.cell % q.cells) * w, ((q.cell / q.cells) | 0) * h, w, h, -s / 2, -s / 2, s, s * h / w);
      } else c.drawImage(src, -s / 2, -s / 2, s, s);
      c.restore();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
}

const CONFETTI = ['#ff4d6d', '#ffd23f', '#3ec1ff', '#6ee36a', '#b388ff', '#ff9f43', '#ffffff'];

// ───────────────────────────── màn chơi ─────────────────────────────

export class PlayView {
  constructor() {
    this.fx = new Particles();
    this.shakes = new Map();     // bus id → thời điểm bắt đầu rung (bấm không được)
    this.laneFx = [];            // { col, kind, t0 }
    this.busFx = [];             // { bus, kind, t0 }
    this.dir = new Map();        // id xe trên vòng → quay sang phải
    this.signShake = 0;
    this.endAt = 0; this.endState = '';
    this.last = performance.now();
    this.g = null;
  }

  now() { return performance.now() / 1000; }

  /** Kích thước bàn chơi vừa khung maxW × maxH. */
  layout(m, maxW, maxH) {
    const visRows = Math.min(m.jh, 7);
    const cols = Math.max(m.W + 2, m.jw + 2) + 0.4;
    const rows = m.H + 2 + 0.55 + visRows + 0.55;
    const s = Math.max(16, Math.min(64, Math.floor(Math.min(maxW / cols, maxH / rows))));
    const W = Math.ceil(cols * s), H = Math.ceil(rows * s);
    const ox = (W - (m.W + 2) * s) / 2, oy = 0;
    const ly = oy + (m.H + 2) * s + 0.55 * s;
    const lx = (W - m.jw * s) / 2;
    this.g = { s, W, H, ox, oy, lx, ly, visRows, m };
    return this.g;
  }

  pos(x, y) { const g = this.g; return [g.ox + (x + 1) * g.s + g.s / 2, g.oy + (g.m.H - y) * g.s + g.s / 2]; }

  busPos(b) { const g = this.g; return [g.lx + b.x * g.s + g.s / 2, g.ly + (g.m.jh - 1 - b.y) * g.s + g.s / 2]; }

  /** Chỗ xe bắt đầu chạy ra vòng (ô của xe trong bãi). */
  carOrigin(m, carId) {
    const b = m.buses.find(o => o.carId === carId);
    if (!b) return this.pos(m.stations[m.entry].x, m.stations[m.entry].y - 1);
    const p = this.busPos(b);
    return [p[0], Math.min(p[1], this.g.ly + (this.g.visRows - 0.5) * this.g.s)];
  }

  laneCenter(x) { const m = this.g.m, [tx, ty] = this.pos(x, m.hs[x] - 1), [, by] = this.pos(x, 0); return [tx, (ty + by) / 2, ty, by]; }

  // ---------- sự kiện của model → VFX + âm thanh ----------
  onTap(m, r) {
    sound.play('go');
    const cars = [r.car, ...(r.extra || [])].filter(Boolean);
    for (const k of cars) {
      const [x, y] = this.carOrigin(m, k.id);
      this.fx.burst('fx_smoke', x, y + this.g.s * 0.2, { n: 6, speed: 40, life: 0.5, size: this.g.s * 0.5, grow: this.g.s * 0.8, tint: '#ffffff', fade: 1 });
    }
  }

  onFail(kind, res, m) {
    if (kind === 'noroom') { sound.play('noroom'); this.signShake = this.now(); return; }
    sound.play('bump');
    if (res?.blocker >= 0) this.shakes.set(res.blocker, this.now());
    if (res?.bus >= 0) this.shakes.set(res.bus, this.now());
  }

  shakeBus(id) { this.shakes.set(id, this.now()); }

  onEvents(events, m) {
    if (!this.g) return;
    const s = this.g.s, t0 = this.now();
    for (const e of events) {
      switch (e.t) {
        case 'insert': {
          sound.play('insert', 0.4);
          const [x, , ty] = this.laneCenter(e.col);
          this.fx.burst('fx_spark', x, ty, { n: 5, speed: 70, life: 0.35, size: s * 0.3, add: true, tint: '#fff6c0' });
          break;
        }
        case 'clear': {
          sound.play('clear');
          const [x, cy, ty, by] = this.laneCenter(e.col), hex = hexOf(e.c);
          this.laneFx.push({ col: e.col, kind: 'clear', t0, c: e.c });
          for (let y = ty; y <= by + 1; y += s) this.fx.burst('fx_star', x, y, { n: 3, speed: 150, life: 0.7, size: s * 0.45, add: true, spin: 6, tint: '#fff2b0' });
          this.fx.burst('fx_glow', x, cy, { n: 1, speed: 0, life: 0.6, size: s * 1.6, grow: s * 3, add: true, tint: hex });
          this.fx.burst('fx_confetti', x, ty, { n: 14, speed: 220, life: 1.1, size: s * 0.28, gravity: 500, spin: 8, cells: 4, tint: [hex, '#ffffff', '#ffd23f'], dir: -Math.PI / 2, spread: 1.6 });
          break;
        }
        case 'unlock': {
          sound.play('click');
          const [x, cy] = this.laneCenter(e.col);
          this.laneFx.push({ col: e.col, kind: 'unlock', t0 });
          this.fx.burst('fx_spark', x, cy, { n: 12, speed: 180, life: 0.5, size: s * 0.3, add: true, tint: '#ffd23f' });
          break;
        }
        case 'thaw': {
          sound.play('bump', 0.35);
          const [x, cy, ty, by] = this.laneCenter(e.col);
          for (let k = 0; k < (e.left ? 4 : 12); k++) {
            this.fx.burst(`ice_piece${1 + (k % 5)}`, x + rnd(-s * 0.3, s * 0.3), rnd(ty, by), { n: 1, speed: 200, life: 0.8, size: s * 0.4, gravity: 700, spin: 8, dir: -Math.PI / 2, spread: 2.4 });
          }
          break;
        }
        case 'barrier': this.laneFx.push({ col: e.col, kind: 'barrier', t0 }); sound.play('bump', 0.4); break;
        case 'curtain': {
          const [x, cy] = this.laneCenter(e.col);
          this.laneFx.push({ col: e.col, kind: e.left ? 'curtainHit' : 'curtainOpen', t0, c: e.c });
          this.fx.burst('splash', x, cy, { n: 4, speed: 120, life: 0.5, size: s * 0.4, tint: hexOf(e.c), spin: 4 });
          break;
        }
        case 'rise': {
          const [x, , , by] = this.laneCenter(e.col);
          this.fx.burst('fx_spark', x, by, { n: 10, speed: 140, life: 0.5, size: s * 0.3, add: true, dir: -Math.PI / 2, spread: 1.2, tint: '#c8f0ff' });
          break;
        }
        case 'key': case 'unbox': case 'reveal': case 'emit': {
          const b = e.bus !== undefined ? m.buses[e.bus] : null;
          const [x, y] = b ? this.busPos(b) : this.laneCenter(e.col);
          if (e.t === 'unbox') { this.busFx.push({ bus: e.bus, kind: 'unbox', t0 }); sound.play('click'); }
          this.fx.burst(e.t === 'unbox' || e.t === 'key' ? 'fx_spark' : 'fx_smoke', x, y,
            e.t === 'unbox' || e.t === 'key' ? { n: 12, speed: 160, life: 0.5, size: s * 0.3, add: true, tint: '#ffd23f' }
              : { n: 7, speed: 50, life: 0.6, size: s * 0.6, grow: s, tint: '#ffffff' });
          break;
        }
        case 'revealCar': {
          const [x, y] = this.pos(e.col, 0);
          this.fx.burst('fx_smoke', x, y, { n: 6, speed: 50, life: 0.5, size: s * 0.5, grow: s, tint: '#ffffff' });
          break;
        }
        case 'hammer': {
          sound.play('bump');
          const [x, , , by] = this.laneCenter(e.col);
          this.laneFx.push({ col: e.col, kind: 'hammer', t0 });
          this.fx.burst('fx_star', x, by, { n: 10, speed: 220, life: 0.5, size: s * 0.4, add: true, spin: 6, tint: '#fff2b0' });
          break;
        }
        case 'shuffle': this.busFx.push({ bus: -1, kind: 'shuffle', t0 }); sound.play('click'); break;
        case 'revive': sound.play('click'); this.signShake = 0; break;
        case 'won': this.end('won'); break;
        case 'lost': this.end('lost'); break;
        default: break;
      }
    }
  }

  end(state) {
    this.endState = state; this.endAt = this.now();
    if (state === 'won') {
      sound.play('win', 0.7);
      const g = this.g;
      for (let k = 0; k < 6; k++) this.fx.burst('fx_confetti', rnd(0, g.W), -10, { n: 14, speed: 120, life: 2.6, size: g.s * 0.32, gravity: 260, spin: 9, cells: 4, tint: CONFETTI, dir: Math.PI / 2, spread: 1.4, fade: 0, drag: 0.6 });
    } else sound.play('lose', 0.7);
  }

  resetEnd() { this.endState = ''; this.endAt = 0; }

  // ---------- vẽ ----------
  paint(c, m, p) {
    const g = this.g, { s } = g, t = this.now();
    const dt = Math.min(0.05, (performance.now() - this.last) / 1000);
    this.last = performance.now();
    this.fx.update(dt);
    c.clearRect(0, 0, g.W, g.H);
    this.drawGround(c, m);
    // xe trong làn
    for (let x = 0; x < m.W; x++) {
      m.cols[x].forEach((k, y) => {
        const [cx, cy] = this.pos(x, y);
        this.car(c, k.c, cx, cy, s * 0.86, { hidden: k.hidden, key: k.key, coc: k.coc });
      });
    }
    for (let x = 0; x < m.W; x++) this.drawLaneObstacles(c, m, x, t);
    // xe trên vòng (nội suy giữa hai tick)
    const ph = p.phase;
    for (const k of m.loop) {
      const a = m.stations[k.st], prevSt = p.prev.get(k.id);
      let [x, y] = this.pos(a.x, a.y), dx = 0;
      if (prevSt !== undefined && prevSt !== k.st) {
        const b = m.stations[prevSt], [px, py] = this.pos(b.x, b.y);
        dx = x - px;
        if ((prevSt + 1) % m.N === k.st) { x = px + (x - px) * ph; y = py + (y - py) * ph; }
      }
      if (dx) this.dir.set(k.id, dx > 0);
      this.car(c, k.c, x, y, s * 0.78, { flip: this.dir.get(k.id) });
    }
    for (const k of m.exits) { const a = m.stations[k.st], [x, y] = this.pos(a.x, a.y); this.car(c, k.c, x, y + s * 0.15, s * 0.62, { alpha: 0.85, hidden: k.hidden }); }
    // xe đang chạy từ bãi ra cổng + hàng chờ ở cổng
    const [ex, ey] = this.pos(m.stations[m.entry].x, m.stations[m.entry].y);
    for (const tr of p.transit) {
      const k = Math.min(1, Math.max(0, (tr.total - tr.left + ph) / tr.total)), e = ease(k);
      const [fx, fy] = tr.from, mx = (fx + ex) / 2, my = Math.min(fy, ey + s) - s * 0.6;
      const x = (1 - e) ** 2 * fx + 2 * (1 - e) * e * mx + e * e * ex, y = (1 - e) ** 2 * fy + 2 * (1 - e) * e * my + e * e * (ey + s * 0.2);
      if (Math.random() < 0.35) this.fx.burst('fx_smoke', x, y + s * 0.25, { n: 1, speed: 15, life: 0.45, size: s * 0.35, grow: s * 0.6, tint: '#ffffff' });
      this.car(c, tr.car.c, x, y, s * (0.92 - 0.14 * e), { flip: ex > fx });
    }
    m.queue.forEach((k, i) => this.car(c, k.c, ex + (i + 1) * s * 0.55, ey + s * 0.75, s * 0.5, {}));
    this.drawLot(c, m, p, t);
    this.fx.draw(c);
    if (m.state !== 'play') this.drawEnd(c, m, p, t);
    return { ids: this.hitIds, s, lanes: Array.from({ length: m.W }, (_, x) => [this.pos(x, m.hs[x] - 1), this.pos(x, 0)]) };
  }

  drawGround(c, m) {
    const g = this.g, { s } = g;
    c.fillStyle = pattern(c, 'ground', s * 3) || '#7d84c7';
    c.fillRect(0, 0, g.W, g.H);
    // cỏ hai bên bãi
    const gy = g.ly - s * 0.35, gh = g.H - gy;
    const grass = (name, x, w) => {
      const i = img[name];
      if (!ok(i) || w <= 2) return;
      c.drawImage(i, x, gy, w, gh);
    };
    const lotL = g.lx - s * 0.3, lotR = g.lx + m.jw * s + s * 0.3;
    grass('grass_right', Math.min(0, lotL - s * 1.6), lotL - Math.min(0, lotL - s * 1.6));
    grass('grass_left', lotR, Math.max(s * 1.6, g.W - lotR));
    // nền bãi
    c.fillStyle = pattern(c, 'asphalt', s * 2.2) || '#5c62a8';
    round(c, lotL, gy, lotR - lotL, gh + s, s * 0.3); c.fill();
    c.fillStyle = 'rgba(30,30,80,.18)'; c.fill();
    // vòng đường
    const [x0, y0] = this.pos(-1, m.H), [x1, y1] = this.pos(m.W, -1);
    const [ex] = this.pos(m.stations[m.entry].x, -1);
    c.fillStyle = pattern(c, 'asphalt', s * 2.2) || '#5c62a8';
    c.fillRect(ex - s * 0.45, y1, s * 0.9, gy - y1 + 2);   // cổng xuống bãi
    c.lineJoin = 'round';
    round(c, x0, y0, x1 - x0, y1 - y0, s * 0.7);
    c.lineWidth = s * 1.02; c.strokeStyle = '#d9dbf6'; c.stroke();
    c.lineWidth = s * 0.84; c.strokeStyle = pattern(c, 'asphalt', s * 2.2) || '#5c62a8'; c.stroke();
    c.setLineDash([s * 0.22, s * 0.28]); c.lineWidth = Math.max(1, s * 0.04); c.strokeStyle = 'rgba(255,255,255,.35)'; c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(ex - s * 0.45, y1 + s * 0.42, s * 0.9, Math.max(1, s * 0.05));
    // nền làn
    const bx = x0 + s * 0.5, by0 = y0 + s * 0.5, bw = x1 - x0 - s, bh = y1 - y0 - s;
    c.fillStyle = '#d9dbf6'; round(c, bx - 2, by0 - 2, bw + 4, bh + 4, s * 0.25); c.fill();
    c.fillStyle = pattern(c, 'asphalt', s * 2.2) || '#4a4f93'; round(c, bx, by0, bw, bh, s * 0.22); c.fill();
    c.fillStyle = 'rgba(20,20,70,.28)'; c.fill();
    for (let x = 0; x < m.W; x++) {
      const [cx] = this.pos(x, 0);
      for (let y = m.hs[x]; y < m.H; y++) { const [, cy] = this.pos(x, y); c.fillStyle = 'rgba(20,20,60,.35)'; c.fillRect(cx - s / 2, cy - s / 2, s, s); }
      if (x > 0) { c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(cx - s / 2 - 1, by0 + s * 0.08, 2, bh - s * 0.16); }
    }
  }

  drawLaneObstacles(c, m, x, t) {
    const { s } = this.g, [cx, cy, ty, by] = this.laneCenter(x);
    const top = ty - s * 0.48, h = by - ty + s * 0.96, w = s * 0.94, left = cx - w / 2;
    const fx = this.laneFx.filter(f => f.col === x && t - f.t0 < 0.8);
    // khoá màu / khoá đếm
    const unlock = fx.find(f => f.kind === 'unlock');
    if (m.locked[x] > 0 || unlock) {
      const k = unlock ? Math.min(1, (t - unlock.t0) / 0.45) : 0;
      c.globalAlpha = 1 - k;
      c.fillStyle = 'rgba(25,25,60,.55)'; round(c, left, top, w, h, s * 0.15); c.fill();
      const sz = s * 0.7 * (1 + k * 0.6);
      if (m.lockC[x]) { c.fillStyle = hexOf(m.lockC[x]); c.beginPath(); c.arc(cx, cy, sz * 0.62, 0, TAU); c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
      this.sprite(c, 'lock', cx, cy - k * s * 0.4, sz);
      if (!m.lockC[x] && m.locked[x] > 0) this.badge(c, cx, cy + s * 0.5, String(m.locked[x]));
      c.globalAlpha = 1;
    }
    // băng
    if (m.ice[x] > 0) {
      round(c, left, top, w, h, s * 0.15);
      c.fillStyle = 'rgba(175,228,255,.62)'; c.fill();
      const tex = pattern(c, 'ice_tex', s * 1.6);
      if (tex) { c.globalAlpha = 0.45; c.globalCompositeOperation = 'screen'; c.fillStyle = tex; c.fill(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
      c.lineWidth = Math.max(1.5, s * 0.05); c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.beginPath(); c.moveTo(left + w * 0.18, top + s * 0.15); c.lineTo(left + w * 0.38, top + s * 0.15); c.lineTo(left + w * 0.2, top + h - s * 0.2); c.lineTo(left + w * 0.08, top + h - s * 0.2); c.closePath(); c.fill();
      this.badge(c, cx, cy, String(m.ice[x]));
    }
    // rèm
    const curOpen = fx.find(f => f.kind === 'curtainOpen');
    if (m.curN[x] > 0) {
      const hex = hexOf(m.curC[x]);
      const hit = fx.find(f => f.kind === 'curtainHit'), wob = hit ? Math.sin((t - hit.t0) * 30) * (1 - (t - hit.t0) / 0.8) * s * 0.05 : 0;
      const top_ = tinted('curtain_top', '#ffffff'), mid = tinted('curtain_mid', hex), under = tinted('curtain_under', hex);
      if (mid) {
        const cells = Math.max(1, Math.round(h / s));
        for (let k = 0; k < cells; k++) c.drawImage(k === cells - 1 && under ? under : mid, left + wob, top + k * h / cells, w, h / cells + 1);
        if (top_) c.drawImage(top_, left - s * 0.06, top - s * 0.18, w + s * 0.12, s * 0.3);
      } else { c.fillStyle = `${hex}dd`; round(c, left, top, w, h, 6); c.fill(); }
      this.sprite(c, 'splash', cx, cy - s * 0.15, s * 0.62, hex);
      this.badge(c, cx, cy + s * 0.45, String(m.curN[x]));
    } else if (curOpen) {
      const k = (t - curOpen.t0) / 0.8, frame = `curtain_open${1 + Math.min(2, Math.floor(k * 3))}`;
      c.globalAlpha = 1 - k * 0.6;
      this.sprite(c, frame, cx, top + s * 0.2 - k * s * 0.4, s * 1.1, hexOf(curOpen.c));
      c.globalAlpha = 1;
    }
    // rào
    const drop = fx.find(f => f.kind === 'barrier');
    if (m.closed[x]) {
      const k = drop ? back(Math.min(1, (t - drop.t0) / 0.4)) : 1;
      c.fillStyle = `rgba(20,20,45,${0.45 * Math.min(1, k)})`; round(c, left, top, w, h, s * 0.15); c.fill();
      this.sprite(c, 'blocker', cx, top + s * 0.25, s * 1.05, null, 1, Math.max(0.05, k));
    } else if (m.barrier[x]) {
      c.save(); c.translate(left + s * 0.08, top - s * 0.06); c.rotate(-0.9);
      this.sprite(c, 'blocker', s * 0.45, 0, s * 0.9, null, 1, 0.45);
      c.restore();
    }
    // làn màu
    if (m.only[x]) {
      const hex = hexOf(m.only[x]);
      c.lineWidth = Math.max(2, s * 0.08); c.strokeStyle = hex; round(c, left, top, w, h, s * 0.15); c.stroke();
      this.sprite(c, 'splash', cx, top - s * 0.02, s * 0.42, hex);
    }
    // thang máy
    const lv = m.elvLevels[x]?.length || 0;
    if (lv || m.elvWait[x]) {
      this.sprite(c, 'platform', cx, by + s * 0.42, s * 0.8);
      this.label(c, `▲${lv}`, cx, by + s * 0.47, s * 0.26, '#2c3170');
    }
    // làn đang xoá: sáng lên
    if (m.clr[x] > 0) {
      const glow = tinted('fx_glow', hexOf(fx.find(f => f.kind === 'clear')?.c || 'W'));
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, m.clr[x] / 6);
      if (glow) c.drawImage(glow, left - s * 0.4, top - s * 0.4, w + s * 0.8, h + s * 0.8);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    // búa
    const ham = fx.find(f => f.kind === 'hammer');
    if (ham) {
      const k = (t - ham.t0) / 0.8;
      c.save(); c.translate(cx + s * 0.3, by - s * 0.2); c.rotate(-1.2 + Math.min(1, k * 3) * 1.4); c.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
      const hi = img.boost_hammer; if (ok(hi)) c.drawImage(hi, -s * 0.2, -s * 0.9, s * 0.8, s * 0.8);
      c.restore(); c.globalAlpha = 1;
    }
  }

  drawLot(c, m, p, t) {
    const g = this.g, { s } = g;
    const ids = [];
    const shuffle = this.busFx.find(f => f.kind === 'shuffle' && t - f.t0 < 0.5);
    const visible = b => !b.out && b.inGen < 0 && m.jh - 1 - b.y < g.visRows;
    // dây nối giữa các xe cùng nhóm
    const groups = new Map();
    for (const b of m.buses) if (b.link >= 0 && visible(b)) (groups.get(b.link) || groups.set(b.link, []).get(b.link)).push(b);
    for (const list of groups.values()) {
      list.sort((a, b) => a.x - b.x || b.y - a.y);
      for (let k = 1; k < list.length; k++) this.rope(c, this.busPos(list[k - 1]), this.busPos(list[k]));
    }
    for (const b of m.buses) {
      if (!visible(b)) continue;
      let [cx, cy] = this.busPos(b);
      const sh = this.shakes.get(b.id);
      if (sh !== undefined) { const k = (t - sh) / 0.4; if (k < 1) cx += Math.sin(k * 40) * s * 0.09 * (1 - k); else this.shakes.delete(b.id); }
      let scale = 1;
      if (shuffle) { const k = (t - shuffle.t0) / 0.5; scale = 1 - Math.sin(k * Math.PI) * 0.35; }
      const unbox = this.busFx.find(f => f.kind === 'unbox' && f.bus === b.id && t - f.t0 < 0.4);
      if (b.box) {
        this.sprite(c, 'lockbox', cx, cy, s * 0.9 * scale);
      } else if (b.gen) {
        this.sprite(c, 'garage', cx, cy, s * 0.95 * scale);
        this.badge(c, cx + s * 0.28, cy - s * 0.3, String(m.generatorLeft(b.id)), s * 0.34);
      } else {
        if (unbox) scale *= back(Math.min(1, (t - unbox.t0) / 0.4));
        this.car(c, b.c, cx, cy, s * 0.92 * scale, { hidden: b.hidden, coc: b.coc });
      }
      if (p.res?.blocker === b.id && t - (p.resAt || 0) < 0.6) { c.strokeStyle = '#ff4d4d'; c.lineWidth = 3; round(c, cx - s * 0.48, cy - s * 0.48, s * 0.96, s * 0.96, s * 0.2); c.stroke(); }
      ids.push([b.id, cx, cy]);
    }
    // số xe còn dưới các hàng đang thấy
    for (let x = 0; x < m.jw; x++) {
      const more = m.buses.filter(b => !b.out && b.inGen < 0 && b.x === x && m.jh - 1 - b.y >= g.visRows).length;
      if (more) this.label(c, `+${more}`, g.lx + x * s + s / 2, g.ly + g.visRows * s + s * 0.25, s * 0.3, '#ffffff', 'rgba(30,30,80,.7)');
    }
    // gợi ý bấm: bàn tay chỉ vào xe kế tiếp của lời giải
    const hint = p.hint;
    if (hint !== undefined && hint !== null) {
      const b = m.buses[hint];
      if (b && visible(b)) {
        const [cx, cy] = this.busPos(b), bob = Math.sin(t * 7) * s * 0.08;
        this.sprite(c, 'tap_hand', cx + s * 0.25, cy + s * 0.45 + bob, s * 0.75);
      }
    }
    this.hitIds = ids;
    this.busFx = this.busFx.filter(f => t - f.t0 < 1);
    this.laneFx = this.laneFx.filter(f => t - f.t0 < 1);
  }

  drawEnd(c, m, p, t) {
    const g = this.g, { s } = g, k = Math.min(1, (t - (this.endAt || t)) / 0.5);
    c.fillStyle = `rgba(15,15,45,${0.45 * k})`; c.fillRect(0, 0, g.W, g.H);
    const big = Math.min(g.W / 7, s * 1.3);
    if (m.state === 'won') {
      if (t - this.endAt < 1.6 && Math.random() < 0.12) {
        const x = rnd(g.W * 0.15, g.W * 0.85), y = rnd(g.H * 0.15, g.H * 0.5);
        this.fx.burst('fx_firework', x, y, { n: 18, speed: 220, life: 0.9, size: s * 0.22, gravity: 120, add: true, tint: CONFETTI, drag: 1.5 });
        this.fx.burst('fx_glow', x, y, { n: 1, speed: 0, life: 0.4, size: s, grow: s * 3, add: true, tint: '#fff2b0' });
      }
      const sc = back(k);
      c.save(); c.translate(g.W / 2, g.H * 0.42); c.scale(sc, sc); c.rotate(Math.sin(t * 2) * 0.03);
      this.title(c, 'WELL DONE!', 0, 0, big, '#ffd23f');
      c.restore();
      this.label(c, `${p.taps} lần bấm · ${p.seconds.toFixed(1)} s${p.boosters ? ` · ${p.boosters} booster` : ''}`, g.W / 2, g.H * 0.42 + big * 0.95, s * 0.36, '#ffffff', 'rgba(20,20,60,.75)');
    } else {
      const i = img.mascot_fail;
      if (ok(i)) { const w = Math.min(g.W * 0.5, s * 4) * back(k); c.drawImage(i, g.W / 2 - w / 2, g.H * 0.36 - w * i.naturalHeight / i.naturalWidth / 2 - big * 0.4, w, w * i.naturalHeight / i.naturalWidth); }
      this.title(c, 'HẾT CHỖ!', g.W / 2, g.H * 0.36 + big * 1.6, big * 0.8, '#ff6b6b');
      this.label(c, p.canRevive ? 'Bấm “+1 chỗ” để hồi sinh' : 'Hồi sinh không cứu được', g.W / 2, g.H * 0.36 + big * 2.5, s * 0.36, '#ffffff', 'rgba(20,20,60,.75)');
    }
  }

  // ---------- mảnh vẽ ----------
  car(c, ch, x, y, w, o = {}) {
    const code = codeOf(ch), i = o.hidden ? img.car_hidden : img[`car${code}`];
    const h = ok(i) ? w * i.naturalHeight / i.naturalWidth : w * 0.8;
    c.globalAlpha = o.alpha ?? 1;
    c.fillStyle = 'rgba(10,10,50,.28)'; c.beginPath(); c.ellipse(x, y + h * 0.36, w * 0.42, h * 0.16, 0, 0, TAU); c.fill();
    if (ok(i)) {
      c.save(); c.translate(x, y); if (o.flip) c.scale(-1, 1);
      c.drawImage(i, -w / 2, -h / 2, w, h);
      c.restore();
    } else {
      c.fillStyle = o.hidden ? '#9a9fb8' : hexOf(ch); round(c, x - w * 0.42, y - h * 0.45, w * 0.84, h * 0.9, w * 0.2); c.fill();
      if (o.hidden) this.label(c, '?', x, y, w * 0.4, '#fff');
    }
    if (o.key) this.sprite(c, 'lockkey', x + w * 0.28, y - h * 0.3, w * 0.5);
    if (o.coc) this.sprite(c, 'splash', x - w * 0.3, y - h * 0.32, w * 0.42, hexOf(o.coc));
    c.globalAlpha = 1;
  }

  sprite(c, name, x, y, w, tint = null, sx = 1, sy = 1) {
    const src = tint ? tinted(name, tint) : img[name];
    if (!src || (src instanceof Image && !ok(src))) return;
    const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height, h = w * ih / iw;
    c.drawImage(src, x - w * sx / 2, y - h * sy / 2, w * sx, h * sy);
  }

  rope(c, [x0, y0], [x1, y1]) {
    const i = img.rope, len = Math.hypot(x1 - x0, y1 - y0), th = this.g.s * 0.16;
    c.save(); c.translate(x0, y0); c.rotate(Math.atan2(y1 - y0, x1 - x0));
    if (ok(i)) { const tile = th * i.naturalWidth / i.naturalHeight; for (let d = 0; d < len; d += tile) c.drawImage(i, 0, 0, Math.min(1, (len - d) / tile) * i.naturalWidth, i.naturalHeight, d, -th / 2, Math.min(tile, len - d), th); } else { c.fillStyle = '#d8c39a'; c.fillRect(0, -th / 2, len, th); }
    c.restore();
  }

  badge(c, x, y, text, size = this.g.s * 0.38) {
    const i = img.badge;
    if (ok(i)) c.drawImage(i, x - size / 2, y - size / 2, size, size); else { c.fillStyle = '#2c3170'; c.beginPath(); c.arc(x, y, size / 2, 0, TAU); c.fill(); }
    this.label(c, text, x, y + size * 0.03, size * 0.58, '#ffffff');
  }

  label(c, text, x, y, size, color, bg = null) {
    c.font = `${Math.round(size)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (bg) { const w = c.measureText(text).width + size; c.fillStyle = bg; round(c, x - w / 2, y - size * 0.75, w, size * 1.5, size * 0.6); c.fill(); }
    c.lineWidth = Math.max(2, size * 0.18); c.strokeStyle = 'rgba(20,20,60,.65)'; c.lineJoin = 'round'; c.strokeText(text, x, y);
    c.fillStyle = color; c.fillText(text, x, y);
  }

  title(c, text, x, y, size, color) {
    c.font = `${Math.round(size)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.lineWidth = size * 0.28; c.strokeStyle = '#3b2a6b'; c.strokeText(text, x, y + size * 0.06);
    c.lineWidth = size * 0.14; c.strokeStyle = '#ffffff'; c.strokeText(text, x, y);
    c.fillStyle = color; c.fillText(text, x, y);
  }
}

export function round(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
