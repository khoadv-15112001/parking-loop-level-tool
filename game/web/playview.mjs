// Màn Chơi thử (và ảnh bàn chơi ở Editor): vẽ ParkingModel giống bản Unity.
//  - Hình học, camera: layout.mjs (port ParkingLayout.cs), camera trực giao nghiêng 72° như scene Gameplay.
//  - Bàn: port ParkingBoardView.cs (nền, đường vòng Road_Vertical, vạch, mũi tên, cỏ, vạch bãi, vật cản của làn).
//  - Xe: model 3D của game vẽ bằng WebGL (carmesh.mjs), chuyển động port CarView.cs (carview.mjs).
//  - Luồng hình / VFX / âm thanh: port ParkingGameController.cs (SyncViews, transit, DrainEvents, ClearRoutine,
//    PopAndDestroy, ClearGlow) và các prefab FX_* (ParkingGeneratedFx.cs).
// Art, âm thanh, font, mesh xe: game/web/art/ (node game/tools/unity_art.mjs <repo Unity>).
import { Layout, LOOP_RADIUS, polyAt, polyLength } from './layout.mjs';
import { CarAnim, ease } from './carview.mjs';
import { CarRenderer, loadCarMesh, loadMesh, meshInfo, SIN, COS } from './carmesh.mjs';

const ART = new URL('./art/', import.meta.url);
export const artUrl = name => new URL(name, ART).href;
const TAU = Math.PI * 2;
const FONT = 'PLMikado, "Arial Rounded MT Bold", system-ui, sans-serif';
const clamp01 = v => Math.max(0, Math.min(1, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

// Màu thân xe (ParkingPalette.cs); '?' = xe ẩn.
export const PALETTE = {
  R: '#e4100c', Y: '#f9b80a', T: '#00c4cf', L: '#3aa6ff', G: '#0ac80a', N: '#7a4419', V: '#a27ee8', P: '#ff5fb2',
  O: '#ff7608', K: '#454952', U: '#7a22d0', M: '#d8128a', W: '#f4f5fb', C: '#f3e3b5', B: '#2f6cf0', '?': '#8478e6',
};
const pal = ch => PALETTE[String(ch || '?').toUpperCase()] || PALETTE['?'];
const COL = {
  ground: '#7d84c7', lane: '#d6d9f2', curbShade: '#b9bde3', lotLine: '#b6b8ce', ink: '#2d3046', grassFar: '#a1cc26',
  // crossway (đo trên ảnh level 200 của game gốc): đảo tối hơn đường, nét đứt / mũi tên mờ
  crossIsland: '#575978', crossDash: '#8a8eb2', crossArrow: '#8e92b2', crossRoad: '#6c709b', curb: '#f4f5fb',
  garageSide: '#6b54d1', garageLid: '#a8b8f5', elvFloor: '#bacce0', elvBump: '#dbe8f7', elvYellow: '#ffcc1a', elvBlack: '#292b38',
  warnCurb: [242, 51, 61], keyColor: '#ffcc33',
};

// ───────────────────────────── art ─────────────────────────────

const IMAGES = ['road', 'ground', 'grass_left', 'grass_right', 'fx_circle', 'fx_glow2', 'lock', 'lockkey', 'curtain_top', 'curtain_mid',
  'curtain_under', 'splash', 'platform', 'platform_under', 'badge', 'loop_sign', 'loop_sign_full', 'tap_hand', 'mascot_fail', 'ice_tex', 'rope',
  'barrier_plate', 'barrier_block', 'cone', 'question', 'ice_piece_1', 'ice_piece_2', 'ice_piece_3', 'ice_piece_4', 'ice_piece_5'];
const img = {};
let loading = null;
const ok = i => !!i && (i instanceof HTMLCanvasElement || (i.complete && i.naturalWidth > 0));
const iw = i => i.naturalWidth || i.width, ih = i => i.naturalHeight || i.height;

export function loadArt() {
  loading ??= Promise.all([
    ...IMAGES.map(n => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = artUrl(`${n}.png`); img[n] = i; })),
    loadCarMesh(artUrl('car_mesh.json')),
    loadMesh('sign', artUrl('sign_mesh.json')),
    (async () => { try { const f = new FontFace('PLMikado', `url(${artUrl('mikado.otf')})`); await f.load(); document.fonts.add(f); } catch { /* font hệ thống */ } })(),
  ]);
  return loading;
}

const tintCache = new Map();
function tinted(name, hex) {
  const i = img[name];
  if (!ok(i)) return null;
  const key = name + hex;
  let cv = tintCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas'); cv.width = iw(i); cv.height = ih(i);
    const c = cv.getContext('2d');
    c.drawImage(i, 0, 0);
    c.globalCompositeOperation = 'multiply'; c.fillStyle = hex; c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(i, 0, 0);
    tintCache.set(key, cv);
  }
  return cv;
}

// Bóng mờ dưới xe (CarView.ShadowTexture: chữ nhật bo tròn mềm).
let shadowTex = null;
function shadowSprite() {
  if (shadowTex) return shadowTex;
  const W = 32, H = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), d = c.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.abs((x + 0.5) / W * 2 - 1), v = Math.abs((y + 0.5) / H * 2 - 1), hx = 0.78, hy = 0.86, rr = 0.32;
    const qx = u - hx + rr, qy = v - hy + rr;
    const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    const a = clamp01(0.5 - dist / 0.28), o = (y * W + x) * 4;
    d.data[o] = 15; d.data[o + 1] = 20; d.data[o + 2] = 61; d.data[o + 3] = Math.round(a * a * (3 - 2 * a) * 255 * 0.42);
  }
  c.putImageData(d, 0, 0);
  return (shadowTex = cv);
}

// ───────────────────────────── âm thanh ─────────────────────────────

const SFX = { tap: 'sfx_tap.wav', go: 'sfx_go.ogg', bump: 'sfx_bump.ogg', honk: 'sfx_honk.wav', insert: 'sfx_insert.ogg', clear: 'sfx_clear.ogg',
  win: 'sfx_win.ogg', lose: 'sfx_lose.ogg', noroom: 'sfx_noroom.wav', click: 'sfx_click.ogg' };
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
  /** ParkingSound.Play / PlayVar: pitch < 0 = lệch ngẫu nhiên nhẹ như game. */
  play(name, vol = 1, pitch = -1) {
    if (!this.on) return;
    const a = this.ctx(), b = buffers[name], now = performance.now();
    if (!a || !(b instanceof AudioBuffer) || now - (lastPlayed[name] || 0) < 40) return;
    lastPlayed[name] = now;
    if (a.state === 'suspended') a.resume().catch(() => {});
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = b; s.playbackRate.value = pitch > 0 ? pitch : rnd(0.94, 1.06); g.gain.value = vol * 0.6;
    s.connect(g).connect(a.destination);
    s.start();
  },
};

// ───────────────────────────── hạt (thế giới) ─────────────────────────────

const G = 9.81;
const PARTICLE_COLORS = {
  debris: ['#c98a4b', '#a86d36', '#e2b27a'],
  ice: ['#d9f2ff', '#9ed9ff', '#ffffff'],
  confetti: ['R', 'Y', 'B', 'G', 'P', 'C'].map(pal),
};

class Particles {
  constructor() { this.list = []; }
  add(q) { this.list.push({ t: 0, vx: 0, vy: 0, vz: 0, drag: 0, gravity: 0, rot: rnd(0, TAU), vr: 0, alpha: 1, shape: 'dot', ...q }); }
  update(dt) {
    for (const q of this.list) {
      q.t += dt;
      q.vy -= q.gravity * dt;
      if (q.drag) { const k = Math.max(0, 1 - q.drag * dt); q.vx *= k; q.vy *= k; q.vz *= k; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rot += q.vr * dt;
    }
    this.list = this.list.filter(q => q.t < q.life);
  }
  /** Vòng hạt: 'dot' tròn trắng, 'flat' mảnh vuông / chữ nhật, 'smoke' khói, 'glow' quầng cộng sáng. */
  draw(c, P, s) {
    for (const q of this.list) {
      const k = q.t / q.life;
      let size = q.size, a = q.alpha;
      if (q.kind === 'smoke') { size *= lerp(0.6, 1.6, k); a *= 1 - k; }
      else if (q.kind === 'glow') { size *= lerp(0.75, 1.35, ease.inOutSine(k)); a *= k < 0.35 ? lerp(1, 0.75, k / 0.35) : lerp(0.75, 0, (k - 0.35) / 0.65); }
      else if (q.shrink !== undefined) size *= k < q.shrink ? 1 : 1 - (k - q.shrink) / (1 - q.shrink);
      if (q.fadeEnd) a *= k < q.fadeEnd ? 1 : 1 - (k - q.fadeEnd) / (1 - q.fadeEnd);
      if (size <= 0 || a <= 0) continue;
      const [x, y] = P(q.x, q.y, q.z), px = size * s;
      c.globalAlpha = Math.min(1, a);
      if (q.kind === 'glow' || q.kind === 'smoke') {
        const src = tinted(q.kind === 'glow' ? 'fx_glow2' : 'fx_circle', q.color || '#ffffff');
        c.globalCompositeOperation = q.kind === 'glow' ? 'lighter' : 'source-over';
        if (src) c.drawImage(src, x - px / 2, y - px / 2, px, px);
        c.globalCompositeOperation = 'source-over';
      } else if (q.kind === 'sprite') {
        const i = img[q.sprite];
        if (ok(i)) { c.save(); c.translate(x, y); c.rotate(q.rot); c.drawImage(i, -px / 2, -px / 2 * ih(i) / iw(i), px, px * ih(i) / iw(i)); c.restore(); }
      } else if (q.shape === 'flat') {
        c.save(); c.translate(x, y); c.rotate(q.rot); c.fillStyle = q.color;
        const h = q.size2 ? q.size2 * s * (size / q.size) : px;
        c.fillRect(-px / 2, -h / 2, px, h); c.restore();
      } else { c.fillStyle = q.color || '#fff'; c.beginPath(); c.arc(x, y, px / 2, 0, TAU); c.fill(); }
    }
    c.globalAlpha = 1;
  }
}

const unitDir = () => { const a = rnd(0, TAU); return [Math.cos(a), Math.sin(a)]; };
/** Hướng trong nón quanh trục +y (Cone/Hemisphere của ParticleSystem quay -90 quanh x). */
function coneDir(angleDeg) {
  const t = rnd(0, angleDeg) * Math.PI / 180, [cx, cz] = unitDir();
  return [Math.sin(t) * cx, Math.cos(t), Math.sin(t) * cz];
}

// ───────────────────────────── màn chơi ─────────────────────────────

let sharedGL = null;
const VISIBLE_LOT_ROWS = 2.8, LAG_STATIONS = 0.5, TICK = 0.16, TIME_SCALE = 1.25;
// Đường: cắt mép trong của Road_Vertical ở u 0.785 (tránh vệt bóng của lề); crossway: bước nét đứt, lề đảo cách tim đường giữa.
const INNER_CUT_U = 0.785, CROSS_DASH_STEP = 0.95, MID_CURB_D = 0.36, LOOP_R = LOOP_RADIUS;
const FEED_GAP = 0.15;          // khoảng giữa hai xe trên đường nhánh
const MIN_CAR_GAP = 0.1;        // khoảng cản trước tới cản sau của xe phía trước trên đường
const LANE_HOLD_MAX = 0.35, LANE_HOLD_SAFETY = 3, LANE_RELEASE_DIST = 2.2;
const wrapAngle = a => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI; return a; };

export class PlayView {
  constructor() {
    this.fx = new Particles();
    this.gl = sharedGL ??= new CarRenderer();   // một context WebGL cho mọi màn (trình duyệt giới hạn số context)
    this.views = new Map(); this.dying = new Set(); this.transits = []; this.jobs = []; this.bumps = new Map();
    this.skids = new Map();
    this.cam = { trauma: 0, kick: 0, kickVel: 0, seed: Math.random() * 100 };
    this.popup = null; this.toast = null; this.countdown = null;
    this.combo = 0; this.lastClear = -99; this.clock = 0;
    this.warn = false; this.warnT = 0; this.warnK = 0; this.signFlash = 0; this.signColor = 'red';
    this.sign = { used: -1, cap: -1, pulse: -1, shake: -1 };
    this.lane = []; this.endAt = 0; this.endState = ''; this.resultAt = 0;
    this.endgame = false;
    this.v = null; this.board = null;
  }

  // ---------- dựng ----------
  /** Dựng lại toàn bộ xe theo model (bắt đầu ván, hoàn tác). transits: [{ car, bus, dist, wait }]. */
  reset(m, transits = [], intro = true) {
    this.m = m; this.L = new Layout(m);
    this.views.clear(); this.dying.clear(); this.jobs = []; this.bumps.clear(); this.skids.clear();
    // trạng thái phía hình của ParkingGameController (xếp hàng nhập, chờ trong cột bãi, đường nhánh, giữ làn)
    this.lineUp = new Set(); this.waitAt = new Map(); this.waitOrder = []; this.release = new Map();
    this.feedD = new Map(); this.feedFromX = new Map(); this.feedStartZ = new Map();
    this.laneLeaving = new Map(); this.laneLeaveAt = new Map(); this.laneHoldStart = new Map(); this.laneEntering = new Map(); this.exitColOf = new Map();
    this.lane = Array.from({ length: m.W }, (_, x) => ({ lock: m.locked[x] > 0, ice: m.ice[x] > 0, cur: m.curN[x] > 0, openLock: -1, openIce: -1, openCur: -1, pulseIce: -1, pulseCur: -1, barrierT: m.closed[x] ? 1 : -1, wait: m.elvWait[x], riseAt: -1 }));
    this.board = null;
    const L = this.L;
    m.cols.forEach((col, x) => { let b = 0; for (const k of col) { this.spawn(k.id, k.len, k.c, L.colCenter(x, b, k.len), Math.PI, { hidden: k.hidden, key: k.key, coc: k.coc }); b += k.len; } });
    for (const b of m.buses) if (!b.out && b.inGen < 0) this.spawn(b.carId, b.len, b.c, L.busCenter(b), 0, { hidden: b.hidden, coc: b.coc, box: b.box, gen: b.gen });
    for (const k of m.loop) { const p = L.bodyOnLoop(k.st - LAG_STATIONS, k.len); this.spawn(k.id, k.len, k.c, p, p.yaw, {}); }
    for (const k of m.exits) {
      if (k.feeder) {
        // xe trên đường nhánh: đặt theo tiến độ travel của model
        this.feedFromX.set(k.id, k.feedFrom);
        const total = L.feederLength(k.feedFrom, k.len), d = total * (1 - (k.travelTotal ? k.travel / k.travelTotal : 0));
        this.feedD.set(k.id, d);
        const p = L.feederAt(k.feedFrom, k.len, d);
        this.spawn(k.id, k.len, k.c, p, p.yaw, {});
      } else this.spawn(k.id, k.len, k.c, this.mouthPos(k.exitCol, 0, k.len), Math.PI, {});
    }
    m.queue.forEach((k, i) => { const p = L.bayPos(i, k.len); this.spawn(k.id, k.len, k.c, p, p.yaw, {}); });
    this.transits = [];
    for (const t of transits) {
      const v = this.spawn(t.car.id, t.car.len, t.car.c, L.busCenter(t.bus), 0, {});
      this.transits.push({ ...t, view: v });
    }
    this.layoutTransits();
    for (const t of this.transits) { const p = polyAt(t.pts, t.dist); v3set(t.view, p); t.view.maxSpeed = 1000; }
    if (intro) {
      const list = [...this.views.values()].sort((a, b) => Math.round(b.tz * 2) - Math.round(a.tz * 2) || a.tx - b.tx);
      const stagger = Math.min(0.035, 0.45 / Math.max(1, list.length));
      list.forEach((v, n) => v.introIt(0.05 + stagger * n));
    }
    this.combo = 0; this.lastClear = -99; this.endgame = false; this.resetEnd();
  }

  spawn(id, len, c, p, yaw, o) {
    const v = new CarAnim(id, { len, color: c, lengthWorld: this.L.lotCarLength(len), width: 0.7, fx: this });
    Object.assign(v, o);
    v.setTarget(p, yaw);
    v.teleport();
    this.views.set(id, v);
    return v;
  }

  resetEnd() { this.endState = ''; this.endAt = 0; this.resultAt = 0; this.countdown = null; }

  // fx hooks cho CarAnim
  smoke(x, y, z, o) { this.fx.add({ kind: 'smoke', x, y, z, life: o.life, size: o.size, alpha: o.alpha, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, color: o.tint || '#ffffff' }); }
  skid(v, pts) {
    let s = this.skids.get(v.id);
    if (!s) this.skids.set(v.id, s = [[], []]);
    pts.forEach((p, i) => { const a = s[i], l = a[a.length - 1]; if (!l || (l.x - p.x) ** 2 + (l.z - p.z) ** 2 > 0.03 * 0.03) a.push({ x: p.x, z: p.z, t: this.clock, gap: !l || this.clock - l.t > 0.08 }); });
  }

  // ---------- khung, camera ----------
  /** Kích thước canvas (dọc như màn hình điện thoại, giữa khung) và tỉ lệ để vòng + 2.8 hàng bãi vừa khung (FitCamera). */
  fit(m, maxW, maxH, opts = {}) {
    const L = this.L || new Layout(m);
    const rows = opts.rows ?? VISIBLE_LOT_ROWS;
    const b = L.boardBounds(rows);
    const W = Math.floor(opts.wide ? maxW : Math.min(maxW, maxH * 0.62)), H = Math.floor(maxH);
    const topPad = opts.topPad ?? 0.05, botPad = opts.botPad ?? 0.02;
    const s = Math.min(W / (b.x1 - b.x0 + 0.6), H * (1 - topPad - botPad) / ((b.z1 - b.z0) * SIN + 0.3 * COS));
    const ox = W / 2 - (b.x0 + b.x1) / 2 * s;
    const oy = opts.center ? H / 2 + (b.z0 + b.z1) / 2 * SIN * s : H * (1 - botPad) + b.z0 * SIN * s;
    const v = { W, H, s, ox, oy, key: `${W}x${H}:${s.toFixed(3)}:${ox.toFixed(1)}:${oy.toFixed(1)}` };
    if (!this.v || this.v.key !== v.key) this.board = null;
    this.v = v;
    return v;
  }

  P = (x, y, z) => [this.v.ox + x * this.v.s, this.v.oy - (z * SIN + y * COS) * this.v.s];

  shake(a) { this.cam.trauma = clamp01(this.cam.trauma + a); }
  kick(a) { this.cam.kickVel += a * 30; }

  // ---------- đồng bộ với model (SyncViews) ----------
  get vloop() { return this.L.spacing / TICK * TIME_SCALE * (this.endgame ? 1.4 : 1); }

  sync(m, phase, dt = 0) {
    const L = this.L, VL = this.vloop;
    for (const b of m.buses) {
      if (b.out) continue;
      const v = this.views.get(b.carId);
      if (!v) continue;
      v.maxSpeed = 20; v.follow = false;
      v.setTarget(L.busCenter(b), 0);
      v.hidden = b.hidden; v.color = b.c; v.box = b.box; v.gen = b.gen; v.coc = b.coc;
      if (!b.gen && !b.box) v.exhaust();
      const bp = this.bumps.get(b.id);
      if (bp && !bp.shakeOnly) {
        const t = clamp01(bp.t / bp.d), f = t < 0.5 ? ease.outQuad(t / 0.5) : 1 - ease.outQuad((t - 0.5) / 0.5);
        v.offset = { x: 0, z: f * bp.dist };
      } else v.offset = { x: 0, z: 0 };
    }
    const fit = L.bayFit;
    m.queue.forEach((k, i) => {
      const v = this.views.get(k.id);
      if (!v) return;
      if (i === 0 && this.lineUp.size) for (const id of [...this.lineUp]) if (!m.loop.some(o => o.id === id) && !m.exits.some(o => o.id === id)) this.lineUp.delete(id);
      // Chỗ 0 bị chiếm khi có xe đang xếp để nhập. Xe ngoài cột cổng chờ trong cột bãi của nó và chỉ lên cổng khi ở cổng
      // còn chỗ, mỗi lần một xe (không có hàng hai bên để lách).
      const n = i + this.lineUp.size;
      if (this.waitOrRelease(k, v, L.bayPos(Math.min(n, fit - 1), k.len), n < fit && this.release.size === 0, dt)) return;
      const p = L.bayPos(n, k.len); v.setTarget(p, p.yaw); v.maxSpeed = VL * 1.5; v.follow = false;
    });
    for (const k of m.loop) {
      const v = this.views.get(k.id);
      if (!v) continue;
      // Game gốc: xe chỉ nhập từ điểm lề đường dưới cổng, quay mặt về đường. Xe model cho lên vòng khi còn đang xếp ở
      // chỗ chờ (quay ngang) chạy tới đó trước, nên không bao giờ quẹo sai hướng trước khi rẽ vào đường.
      if (this.lineUp.has(k.id)) {
        const bp = L.bayPos(0, k.len);
        if (this.waitOrRelease(k, v, bp, true, dt)) continue;
        if (!this.arrivedAt(v, bp)) { v.setTarget(bp, bp.yaw); v.maxSpeed = VL * 1.5; v.follow = false; v.hidden = false; continue; }
        this.lineUp.delete(k.id);
        if (m.cross) { this.feedStartZ.set(k.id, bp.z); this.feedFromX.set(k.id, bp.x); }
      }
      // Xe model đã cho nhập từ đường nhánh crossway: còn trên nhánh tới khi chỗ của nó trên vòng qua giao lộ.
      const u = k.st + (k.dockWait ? 0 : k.held ? 1 : phase) - LAG_STATIONS;
      if (this.feedD.has(k.id)) {
        if (this.feedD.get(k.id) < this.feedLen(k) - 0.02 || this.slotDelta(k, true, phase) < -0.05) continue;
        this.feedD.delete(k.id); this.feedFromX.delete(k.id); this.feedStartZ.delete(k.id);
      }
      const p = L.bodyOnLoop(u, k.len);
      v.setTarget(p, p.yaw); v.maxSpeed = VL * 2.2; v.key = false; v.coc = ''; v.follow = true; v.setLoop(L, u, k.len); v.hidden = false;
    }
    // Xe bị đẩy khỏi làn đầy chờ khe trên đường: khi làn còn giữ (dưới) thì chờ ngay trong ô của nó trong làn.
    const exitOff = new Map();
    this.syncFeeder(m, phase, dt);
    for (const k of m.exits) {
      if (k.feeder) continue;
      const v = this.views.get(k.id);
      if (!v) continue;
      const x = k.exitCol, off = exitOff.get(x) || 0;
      exitOff.set(x, off + k.len);
      v.setTarget(this.mouthPos(x, off, k.len), Math.PI); v.maxSpeed = VL * 1.6; v.follow = false;
      v.hidden = false; v.key = false; v.coc = '';
    }
    m.cols.forEach((col, x) => {
      // Xe trong làn đứng yên (dịch lên bằng độ dài xe đang ra) tới khi xe bị đẩy rời khỏi làn, để không chạy vào nó.
      const hold = this.laneHold(m, x), entering = this.laneEntering.get(x) ?? -1;
      let b = 0;
      for (const k of col) {
        const v = this.views.get(k.id), cell = k.id === entering ? b : b + hold;
        if (v) { v.setTarget(L.colCenter(x, cell, k.len), Math.PI); v.maxSpeed = VL * 1.6; v.follow = false; v.hidden = k.hidden; v.key = k.key; v.coc = k.coc; }
        b += k.len;
      }
    });
    this.updateYield(m);
  }

  arrivedAt(v, p) { return (v.x - p.x) ** 2 + (v.z - p.z) ** 2 < 0.15 * 0.15 && Math.abs(wrapAngle(v.yaw - p.yaw)) < 12 * Math.PI / 180; }

  // ---------- crossway: đường nhánh (đường dưới ngoài + cạnh phải dưới, một chiều, vào giao lộ) ----------
  // Model chỉ đếm tick (car.travel); ở đây mỗi xe chạy dọc đường nhánh theo chỗ (tương lai) của nó trên vòng, không lùi,
  // và giữ một thân xe với xe trước (xe từ các làn khác nhau đi chung).
  stopBack(len) { return this.L.junctionZ - this.L.feederEndZ(len); }
  feedStart(k) { return this.feedStartZ.has(k.id) ? this.feedStartZ.get(k.id) : NaN; }
  feedLen(k) { return this.L.feederLength(this.feedFromX.get(k.id), k.len, this.feedStart(k)); }
  feedRem(k) { return this.feedLen(k) - this.feedD.get(k.id) + this.stopBack(k.len); }

  syncFeeder(m, phase, dt) {
    if (!m.cross) return;
    const L = this.L, VL = this.vloop, buf = [];
    for (const k of m.exits) {
      if (!k.feeder) continue;
      if (!this.feedFromX.has(k.id)) {
        this.feedFromX.set(k.id, k.feedFrom); this.feedD.set(k.id, 0);
        // Xe bị đẩy khỏi làn khối dưới đi từ ô của nó rồi rẽ trái vào đường dưới.
        const sv = this.views.get(k.id);
        if (!this.lineUp.has(k.id) && sv && sv.z > L.roadBottomZ + 0.25) { this.feedStartZ.set(k.id, sv.z); this.feedFromX.set(k.id, sv.x); }
      }
      if (this.lineUp.has(k.id)) {
        // Xe bãi: tới điểm lề đường quay lên trước (như bàn thường), rồi đi đường nhánh từ đó.
        const lv = this.views.get(k.id);
        if (!lv) continue;
        const bp = L.bayPos(0, k.len);
        if (this.waitOrRelease(k, lv, bp, true, dt)) continue;
        if (!this.arrivedAt(lv, bp)) { lv.clearLoop(); lv.setTarget(bp, bp.yaw); lv.maxSpeed = VL * 1.5; lv.follow = false; lv.hidden = false; continue; }
        this.lineUp.delete(k.id);
        this.feedStartZ.set(k.id, bp.z); this.feedFromX.set(k.id, bp.x);
      }
      buf.push({ k, rem: this.feedRem(k), merged: false });
    }
    // Model đã cho nhập nhưng chưa lên vòng (sync): vẫn trên nhánh.
    for (const k of m.loop) if (this.feedD.has(k.id)) buf.push({ k, rem: this.feedRem(k), merged: true });
    buf.sort((a, b) => a.rem - b.rem);   // xe đầu trước (ít đường tới giao lộ nhất)
    let prevRem = -Infinity, prevLen = 1;
    for (const { k, merged } of buf) {
      const v = this.views.get(k.id);
      if (!v) continue;
      const fx = this.feedFromX.get(k.id), total = this.feedLen(k);
      // Theo chỗ (tương lai) của xe trên vòng: tới giao lộ cùng lúc với chỗ đó nên không phải dừng ở vạch. Chậm thì đuổi
      // (1.6× tốc vòng); giao lộ bị chặn thì đứng ở vạch.
      const want = total + this.slotDelta(k, merged, phase), cur = this.feedD.get(k.id);
      let d = Math.min(Math.max(want, cur), cur + VL * 1.6 * dt, total);
      if (prevRem > -Infinity) {
        const minRem = prevRem + (L.lotCarLength(prevLen) + L.lotCarLength(k.len)) / 2 + FEED_GAP;
        d = Math.min(d, total + this.stopBack(k.len) - minRem);
      }
      d = Math.max(cur, d);
      this.feedD.set(k.id, d);
      prevRem = total - d + this.stopBack(k.len); prevLen = k.len;
      const p = L.feederAt(fx, k.len, d, this.feedStart(k));
      v.clearLoop();
      v.setTarget(p, p.yaw); v.maxSpeed = VL * 3; v.follow = true;
      v.hidden = false; v.key = false; v.coc = '';
    }
  }

  /** Quãng đường từ giao lộ tới giữa chỗ của xe trên vòng (âm = chỗ chưa tới giao lộ). Trước khi model cho nhập: ước lượng
   * chỗ sẽ xuất hiện ở trạm entry khi hết travel tick. */
  slotDelta(k, merged, phase) {
    const L = this.L, m = this.m;
    let uMid, ticksLeft = 0;
    if (merged) uMid = k.st + (k.held ? 1 : phase) - LAG_STATIONS - (k.len - 1) / 2;
    else { uMid = m.entry - LAG_STATIONS - (k.len - 1) / 2; ticksLeft = Math.max(0, k.travel - phase) + (k.travel === 0 ? 0.5 : 0); }
    const per = L.perimeter;
    let delta = (L.distOf(uMid) - L.distOf(L.junctionU)) % per;
    if (delta > per / 2) delta -= per; else if (delta < -per / 2) delta += per;
    return delta - ticksLeft * L.spacing;
  }

  // ---------- xe chờ trong cột bãi (không còn chỗ ở cổng), rồi lần lượt lên cổng ----------
  addWait(id, x, len) { this.waitAt.set(id, { x, len }); this.waitOrder = this.waitOrder.filter(o => o !== id); this.waitOrder.push(id); }
  removeWait(id) { this.waitAt.delete(id); this.waitOrder = this.waitOrder.filter(o => o !== id); }

  waitPose(id) {
    const { x, len } = this.waitAt.get(id), L = this.L;
    let z = L.jamTopZ - 0.04;
    for (const o of this.waitOrder) {
      if (o === id) break;
      const w = this.waitAt.get(o);
      if (Math.abs(w.x - x) < 0.1) z -= L.lotCarLength(w.len) + 0.08;
    }
    return { x, z: z - L.lotCarLength(len) / 2, yaw: 0 };
  }

  /** Xe đang chờ / đang lên cổng: true khi được xử lý ở đây. mayGo: tới lượt rời chỗ chờ để tới dest. */
  waitOrRelease(k, v, dest, mayGo, dt) {
    if (this.waitAt.has(k.id)) {
      if (!mayGo) { const w = this.waitPose(k.id); v.setTarget(w, w.yaw); v.maxSpeed = this.vloop * 1.5; v.follow = false; return true; }
      const pts = this.L.releaseRoute({ x: v.x, z: v.z }, dest);
      this.release.set(k.id, { pts, d: 0, total: polyLength(pts) });
      this.removeWait(k.id);
    }
    const r = this.release.get(k.id);
    if (!r) return false;
    r.d = Math.min(r.total, r.d + this.vloop * 1.15 * dt * lerp(0.55, 1, clamp01(r.d / 0.6)));
    const p = polyAt(r.pts, r.d);
    v.setTarget(p, p.yaw); v.maxSpeed = 1000; v.follow = false;
    if (r.d >= r.total - 1e-3) this.release.delete(k.id);
    return true;
  }

  // ---------- nhường đường phía hình (UpdateRingTraffic + chặn ở điểm nhập của game gốc) ----------
  // Model chạy vòng đồng bộ; hình chậm hơn và xe nhập mất thời gian cua, nên xe trên đường có thể đè xe đang ra làn. Theo
  // thứ tự model: xe đang chạy không vượt đuôi xe trước, dừng trước điểm nhập của xe phía trước đang nhập rồi đuổi kịp;
  // xe đang nhập chờ (ở cửa làn) khi xe phía trước còn che điểm nhập của nó.
  gapCap(me, obstacles, wrap) {
    const L = this.L, uM = me.carU - (me.loopLen - 1) / 2;
    let bestDu = Infinity, lenO = 1;
    for (const o of obstacles) {
      if (o.v === me) continue;
      const du = wrap(o.u - uM);
      if (du > 0.01 && du < bestDu) { bestDu = du; lenO = o.len; }
    }
    if (bestDu > 6) return NaN;
    const dMax = L.distOf(uM + bestDu) - (L.lotCarLength(lenO) + L.lotCarLength(me.loopLen)) / 2 - MIN_CAR_GAP;
    return L.uOfDist(dMax) + (me.loopLen - 1) / 2;
  }

  /** u trên vòng của điểm nhập ngay trên lề đường (đường dưới phía trên chỗ 0). */
  entryJunctionU() { const m = this.m, L = this.L; return m.entry + (L.bayPos(0, 1).x - L.loopAt(m.entry).x); }

  updateYield(m) {
    const L = this.L, buf = [];
    for (const k of m.loop) { const v = this.views.get(k.id); if (v) { v.capU = NaN; v.holdJoin = false; v.holdPos = null; buf.push({ k, v }); } }
    const n = buf.length, obstacles = [];
    for (const { v } of buf) if (v.isRiding) obstacles.push({ u: v.carU - (v.loopLen - 1) / 2, len: v.loopLen, v });
    for (const v of this.views.values()) if (v.exitingLoop) obstacles.push({ u: v.exitU - (v.loopLen - 1) / 2, len: v.loopLen, v });
    // Xe đã bắt đầu cua vào đường giữ đoạn nó sẽ đáp xuống.
    for (const { v } of buf) if (v.isJoining && v.joinStarted) { const z = v.joinZone(); if (z) obstacles.push({ u: (z.a + z.b) / 2, len: v.loopLen, v }); }
    // Crossway: xe nhánh model đã cho nhập giữ chỗ của nó trên vòng khi còn trên nhánh, nên xe vòng phanh nhường.
    const feederViews = new Set();
    if (m.cross) for (const k of m.loop) if (this.feedD.has(k.id)) { const fv = this.views.get(k.id); if (fv) { obstacles.push({ u: L.uOfDist(L.distOf(L.junctionU) - this.feedRem(k)), len: k.len, v: fv }); feederViews.add(fv); } }
    if (n < 1) return;
    buf.sort((a, b) => a.k.st - b.k.st);
    const N = Math.max(1, m.N), wrap = d => { d %= N; if (d > N / 2) d -= N; else if (d < -N / 2) d += N; return d; };
    for (let i = 0; i < n; i++) {
      const me = buf[i].v, ahead = n > 1 ? buf[(i + 1) % n].v : null;
      if (me.isRiding) {
        let best = NaN;
        const take = cap => { if (wrap(cap - me.carU) <= -1) return; if (Number.isNaN(best) || wrap(cap - best) < 0) best = cap; };
        const az = ahead && ahead.joinZone();
        if (az) { if (wrap(me.carU - (az.a - 0.45)) < 0) take(az.a - 0.45); }
        else if (ahead && this.lineUp.has(buf[(i + 1) % n].k.id)) take(this.entryJunctionU() - 0.6 - 0.45);
        const gap = this.gapCap(me, obstacles, wrap);
        if (!Number.isNaN(gap)) take(gap);
        me.capU = best;
      } else if (me.isJoining && !me.joinStarted) {
        const z = me.joinZone();
        if (z) {
          const behind = n > 1 ? buf[(i - 1 + n) % n].v : null;
          let block = false;
          for (const o of obstacles) {
            // Không tính chính nó, cũng không tính xe còn trên nhánh. Chỉ trước khi bắt đầu cua (cua đã bắt đầu không dừng).
            if (o.v === me || feederViews.has(o.v)) continue;
            const head = o.u + (o.len - 1) / 2 + 0.45, tail = o.u - (o.len - 1) / 2 - 0.45;
            if (wrap(head - z.a) > 0 && wrap(tail - z.b) < 0) { block = true; break; }
          }
          if (!block && ahead && ahead !== me && !ahead.isRiding) { const p = ahead.joinZone(); if (p) block = wrap(p.b - z.a) > 0 && wrap(p.a - z.b) < 0; }
          if (!block) for (const { v: v2 } of buf) if (v2 !== me && v2 !== behind && v2.isRiding && wrap(z.a - v2.carU) > 0 && wrap(z.a - v2.carU) < 1.2 && v2.speed > 0.5) { block = true; break; }
          if (block) {
            me.holdJoin = true;
            const col = this.exitColOf.get(buf[i].k.id);
            if (col !== undefined && col >= 0 && col < m.W) me.holdPos = this.mouthPos(col, 0, buf[i].k.len);
          }
        }
      }
      if (me.isRiding) this.exitColOf.delete(buf[i].k.id);
    }
  }

  // ---------- giữ làn khi xe bị đẩy ra (sự kiện insert) ----------
  noteLaneExit(e, m) {
    if (e.col < 0 || !e.ejected?.length) return;
    const leaving = this.laneLeaving.get(e.col) || [];
    for (const id of e.ejected) if (!leaving.includes(id)) leaving.push(id);
    this.laneLeaving.set(e.col, leaving);
    // Làn khối dưới crossway đẩy xe ra đường nhánh: xe đó không chờ ở cửa làn.
    if (!m.feedsOut(e.col)) for (const id of e.ejected) this.exitColOf.set(id, e.col);
    this.laneLeaveAt.set(e.col, this.clock); this.laneHoldStart.set(e.col, this.clock);
    this.laneEntering.set(e.col, e.id);
  }

  /** Số ô xe trong làn còn dịch lên khi xe bị đẩy ra còn ở trong làn. */
  laneHold(m, x) {
    const ids = this.laneLeaving.get(x);
    if (!ids?.length) return 0;
    let waiting = false;
    for (const id of ids) {
      const wv = this.views.get(id);
      if (m.exits.some(c => c.id === id && !c.feeder) || (wv && wv.isJoining && !wv.joinStarted)) { waiting = true; break; }
    }
    if (waiting) this.laneLeaveAt.set(x, this.clock);
    const stuck = this.clock - (this.laneHoldStart.get(x) ?? this.clock) > LANE_HOLD_SAFETY;
    if (stuck || this.clock - this.laneLeaveAt.get(x) > LANE_HOLD_MAX) { ids.length = 0; return 0; }
    // Xe đang vào sắp tới ô của nó: làn phải nhường chỗ ngay (trừ khi xe bị đẩy còn chờ trong ô).
    const ev = this.views.get(this.laneEntering.get(x));
    if (!waiting && ev && (ev.x - ev.tx) ** 2 + (ev.z - ev.tz) ** 2 < LANE_RELEASE_DIST ** 2) { ids.length = 0; return 0; }
    const L = this.L, bottomZ = L.laneBottomEdgeZ(x), lx = L.lx(x);
    let hold = 0;
    for (let i = ids.length - 1; i >= 0; i--) {
      const len = this.lenOnRoad(m, ids[i]), v = this.views.get(ids[i]);
      if (len <= 0 || !v) { ids.splice(i, 1); continue; }
      if (v.z < bottomZ - L.lotCarLength(len) / 2 - 0.02 || Math.abs(v.x - lx) > L.jc * 0.8) { ids.splice(i, 1); continue; }
      hold += len;
    }
    return hold;
  }

  /** Chỗ xe bị đẩy khỏi làn x chờ khe: không có khoảng trống ở cửa làn (như game gốc) nên chờ ngay trong ô của nó. */
  mouthPos(x, off, len) { return this.L.colCenter(x, off, len); }

  lenOnRoad(m, id) {
    for (const c of m.exits) if (c.id === id) return c.len;
    for (const c of m.loop) if (c.id === id) return c.len;
    return 0;
  }

  // ---------- xe từ bãi ra cổng (StartTransit / UpdateTransits) ----------
  layoutTransits() {
    let slots = 0;
    for (const t of this.transits) {
      if (!t.pts) { t.pts = this.L.transitRoute(t.bus, this.m.queue.length + slots); t.total = polyLength(t.pts); }
      slots += 1;
    }
  }

  startTransit(m, busId, car) {
    const b = { ...m.buses[busId] };
    const v = this.views.get(b.carId);
    if (!v) return;
    const L = this.L, bay = m.queue.length + this.transits.length + this.lineUp.size;
    let pts;
    // Ở cổng hết chỗ: xe tiến lên trong chính cột bãi của nó và chờ tới lượt.
    if (bay >= L.bayFit) { this.addWait(car.id, L.waitX(b), b.len); pts = L.waitRoute(b, this.waitPose(car.id)); }
    else pts = L.transitRoute(b, bay);
    v.hidden = false; v.key = false; v.coc = ''; v.offset = { x: 0, z: 0 }; v.maxSpeed = 1000;
    v.exhaustBurst();
    this.transits.push({ car, bus: b, view: v, pts, total: polyLength(pts), dist: 0, wait: 0 });
  }

  /** Bản sao trạng thái xe đang chạy (để hoàn tác). */
  transitState() { return this.transits.map(t => ({ car: { ...t.car }, bus: { ...t.bus }, pts: t.pts, total: t.total, dist: t.dist, wait: t.wait })); }

  /** Một khung hình: VFX, camera, xe. Trả về các xe đã tới cổng (ui gọi m.deliver). */
  update(dt, m, phase, playing) {
    this.clock += dt;
    const arrived = [];
    if (playing) {
      const speed = this.vloop * 1.15;
      for (let i = 0; i < this.transits.length; i++) {
        const t = this.transits[i];
        if (t.wait > 0) { t.wait -= dt; continue; }
        t.dist = Math.min(t.total, t.dist + speed * dt * lerp(0.55, 1, clamp01(t.dist / 0.6)));
        const p = polyAt(t.pts, t.dist);
        t.view.setTarget(p, p.yaw);
        if (t.dist >= t.total - 1e-3) { this.transits.splice(i--, 1); arrived.push(t.car); }
      }
    }
    for (const [id, bp] of this.bumps) { bp.t += dt; if (bp.t >= bp.d) this.bumps.delete(id); }
    if (playing && !this.endgame && m.state === 'play' && this.level >= 3 && m.buses.every(b => b.out) && (m.loop.length || m.queue.length || this.transits.length)) {
      this.endgame = true;
      for (const k of m.loop) this.views.get(k.id)?.punch();
      this.showPopup('SPEED UP!', '#ffd959', 0.9);
    }
    this.sync(m, phase, dt);
    if (dt > 0) { for (const v of this.views.values()) v.step(dt); for (const v of this.dying) v.step(dt); }
    const jobs = this.jobs;
    this.jobs = [];
    const alive = jobs.filter(j => !j.next(dt).done);
    this.jobs = alive.concat(this.jobs);   // job mới (nổ từng xe) được thêm trong lúc chạy
    this.fx.update(dt);
    // camera (ParkingCameraRig)
    const cam = this.cam;
    cam.trauma = Math.max(0, cam.trauma - 1.6 * dt);
    cam.kickVel += (-cam.kick * 260 - cam.kickVel * 2 * 7) * dt;
    cam.kick += cam.kickVel * dt;
    // cảnh báo vòng đầy: viền ngoài đỏ nhấp nháy
    const on = m.state === 'play' && m.loopCells() + m.transit >= m.cap;
    if (on && !this.warn) this.warnT = 0;
    this.warn = on;
    if (on) { this.warnT = (this.warnT + dt) % 1.05; this.warnK = this.warnT < 0.4 ? ease.inOutSine(this.warnT / 0.4) : this.warnT < 0.8 ? 1 - ease.inOutSine((this.warnT - 0.4) / 0.4) : 0; }
    else this.warnK = Math.max(0, this.warnK - dt / 0.4);
    if (this.signFlash > 0) this.signFlash -= dt;
    this.signStep(m, dt);
    if (this.popup) { this.popup.t += dt; if (this.popup.t >= this.popup.d) this.popup = null; }
    if (this.toast) { this.toast.t += dt; if (this.toast.t >= this.toast.d) this.toast = null; }
    if (this.countdown) {
      const c = this.countdown, before = Math.ceil(c.left);
      c.left -= dt; c.t += dt;
      const now = Math.ceil(c.left);
      if (c.left <= 0) { this.countdown = null; this.endState = 'lost'; this.endAt = this.clock; }
      else if (now !== before) { c.n = now; c.t = 0; this.flashSign('red'); sound.play('noroom', 0.5, 0.8 + 0.1 * (3 - now)); }
    }
    if (this.resultAt && this.clock >= this.resultAt) { this.resultAt = 0; this.endState = 'won'; this.endAt = this.clock; }
    for (let x = 0; x < m.W; x++) this.laneState(m, x, dt);
    for (const [id, s] of this.skids) { for (const a of s) while (a.length && this.clock - a[0].t > 0.45) a.shift(); if (!s[0].length && !s[1].length) this.skids.delete(id); }
    return arrived;
  }

  laneState(m, x, dt) {
    const a = this.lane[x];
    if (!a) return;
    const t = this.clock;
    if (a.lock && m.locked[x] <= 0) { a.lock = false; a.openLock = t; }
    if (a.ice && m.ice[x] <= 0) { a.ice = false; a.openIce = t; }
    if (a.cur && m.curN[x] <= 0) { a.cur = false; a.openCur = t; }
    if (m.closed[x] && a.barrierT < 0) a.barrierT = 0;
    if (a.barrierT >= 0 && a.barrierT < 1) a.barrierT = Math.min(1, a.barrierT + dt / 0.35);
    if (!m.closed[x]) a.barrierT = -1;
    a.wait = m.elvWait[x];
  }

  // ---------- phản hồi bấm (TapBus) ----------
  tapped(m, id, r) {
    const b = m.buses[id], v = b ? this.views.get(b.carId) : null;
    if (r.r !== 'released') v?.punch();
    switch (r.r) {
      case 'released': {
        sound.play('go');
        const ids = [id, ...(r.extraBus || [])];
        for (const bid of ids) { const bb = m.buses[bid], vv = this.views.get(bb.carId); vv?.hopIt(0.3); }
        const c = this.L.busCenter(b);
        this.tapFx(c.x, 0.3, c.z, '#ffffff');
        break;
      }
      case 'frozen': case 'locked': case 'linked': case 'ignored':
        sound.play('bump'); v?.denyIt();
        this.bumps.set(id, { t: 0, d: 0.3, shakeOnly: true });
        if (r.r === 'linked') for (const g of m.groupOf(id)) this.views.get(m.buses[g].carId)?.denyIt();
        this.showToast(r.r === 'linked' ? 'Nhóm xe nối phải ra cùng nhau' : b?.box ? 'Hộp khoá: xoá một xe có chìa trong làn' : b?.gen ? 'Máy phát: bấm xe nó nhả ra' : '');
        break;
      case 'blocked': {
        sound.play('bump'); sound.play('honk', 0.6);
        this.bumps.set(id, { t: 0, d: 0.42 + r.travel * 0.04, dist: r.travel * this.L.jc + 0.22 });
        if (r.blocker >= 0) { const bv = this.views.get(m.buses[r.blocker].carId); bv?.denyIt(); bv?.squashIt(0.8); }
        this.shake(0.32);
        break;
      }
      case 'noroom':
        sound.play('noroom'); v?.denyIt();
        this.bumps.set(id, { t: 0, d: 0.3, shakeOnly: true });
        this.flashSign('red');
        this.shake(0.2);
        break;
      default: break;
    }
  }

  /** z tâm làn x (theo ô dưới cùng của làn). */
  zc(x) { return this.L.lBottom(x) + (this.m.hs[x] - 1) / 2; }
  laneCenter(x) { return { x: this.L.lx(x), y: 0.3, z: this.zc(x) }; }

  // ---------- sự kiện model (DrainEvents) ----------
  onEvents(events, m) {
    const L = this.L;
    for (const e of events) {
      switch (e.t) {
        case 'insert': {
          const filled = m.cols[e.col]?.length || 0;
          sound.play('insert', 0.7, 0.9 + 0.06 * filled);
          const v = this.views.get(e.id);
          if (v) v.onLanded = cv => { cv.squashIt(0.35); cv.onLanded = null; };
          this.noteLaneExit(e, m);
          break;
        }
        case 'clear': this.parkCleared(e); this.jobs.push(this.clearRoutine(e)); break;
        case 'reveal': { const v = this.views.get(m.buses[e.bus].carId); if (v) { v.hidden = false; v.punch(); } break; }
        case 'revealCar': { const v = this.views.get(e.id); if (v) { v.hidden = false; v.hopIt(0.25); this.tapFx(v.x, 0.3, v.z, pal(e.c)); } break; }
        case 'shift':
          for (const b of m.buses) if (!b.out && b.x === e.col) { const v = this.views.get(b.carId); if (v) { v.maxSpeed = 8; v.onLanded = cv => { cv.squashIt(0.5); cv.onLanded = null; }; } }
          break;
        case 'enter': this.views.get(e.id)?.punch(); this.lineUp.add(e.id); this.removeWait(e.id); if (m.loopCells() >= m.cap) { this.flashSign('red'); } break;
        case 'thaw': {
          const a = this.lane[e.col];
          if (e.left === 0) { const c = this.laneCenter(e.col); this.burst('ice', c.x, c.y, c.z); this.iceShards(e.col); sound.play('bump', 0.6, 1.25); }
          else if (a) a.pulseIce = this.clock;
          break;
        }
        case 'barrier': sound.play('bump', 0.7, 0.8); break;
        case 'key': { const v = this.views.get(e.id); if (v) { v.key = false; v.hopIt(0.3); this.tapFx(v.x, 0.3, v.z, '#ffcc40'); } sound.play('click', 0.8, 1.3); break; }
        case 'unbox': {
          const b = m.buses[e.bus], v = this.views.get(b.carId);
          if (v) { this.burst('ice', v.x, 0.3, v.z, '#ffcc40'); this.views.delete(b.carId); this.jobs.push(this.popAndDestroy(v, '')); }
          sound.play('go', 0.8, 1.2); this.kick(0.02);
          break;
        }
        case 'emit': {
          const nb = m.buses[e.bus], gb = m.buses[e.i];
          const nv = this.spawn(nb.carId, nb.len, nb.c, L.busCenter(gb), 0, { hidden: nb.hidden, coc: nb.coc, box: nb.box });
          nv.maxSpeed = 6; nv.hopIt(0.25);
          this.views.get(gb.carId)?.squashIt(0.7);
          sound.play('tap', 0.6, 1.1);
          break;
        }
        case 'genEnd': { const g = m.buses[e.bus], v = this.views.get(g.carId); if (v) { this.views.delete(g.carId); this.jobs.push(this.popAndDestroy(v, '')); } break; }
        case 'curtain': {
          const a = this.lane[e.col];
          sound.play('click', 0.7, 1 + 0.1 * Math.max(0, 3 - e.left));
          if (e.left === 0) { const c = this.laneCenter(e.col); this.burst('clear', c.x, c.y, c.z, pal(e.c)); } else if (a) a.pulseCur = this.clock;
          break;
        }
        case 'rise': {
          let b = 0, n = 0;
          for (const k of m.cols[e.col]) {
            if (!this.views.has(k.id)) { const v = this.spawn(k.id, k.len, k.c, L.colCenter(e.col, b, k.len), Math.PI, { hidden: k.hidden, key: k.key, coc: k.coc }); v.riseIt(0.15 + 0.06 * n++); }
            b += k.len;
          }
          if (this.lane[e.col]) this.lane[e.col].riseAt = this.clock;   // cột sáng trắng khi tầng mới lên
          sound.play('go', 0.7, 0.9);
          break;
        }
        case 'unlock': sound.play('go', 0.7, 1.15); break;
        case 'hammer': { const v = this.views.get(e.id); if (v) { v.hopIt(0.6); v.wobbleIt(); this.burst('debris', v.x, 0.3, v.z); } this.shake(0.35); break; }
        case 'shuffle': for (const b of m.buses) if (!b.out) { const v = this.views.get(b.carId); v?.hopIt(0.55); if (v) v.hidden = b.hidden; } break;
        case 'revive':
          this.kick(0.05); this.showPopup(`Revive! Loop ${e.left}`, '#8cd9ff', 1.1);
          this.flashSign('blue');
          for (const v of this.views.values()) v.punch();
          this.resetEnd();
          break;
        case 'won':
          sound.play('win');
          this.burst('confetti', (m.BW - 1) / 2, 0.5, (L.topZ + L.roadBottomZ) / 2);
          this.kick(0.07); this.showPopup('Level Clear!', '#8cff99', 1.4);
          this.resultAt = this.clock + 1.2;
          break;
        case 'lost':
          sound.play('lose'); this.shake(0.55);
          for (const v of this.views.values()) v.wobbleIt();
          this.countdown = { left: 3, n: 3, t: 0 };
          this.showToast('Out of moves!', 1.2);
          this.flashSign('red');
          sound.play('noroom', 0.5, 0.8);
          break;
        default: break;
      }
    }
  }

  parkCleared(e) {
    let b = 0;
    for (const id of e.ids) {
      const v = this.views.get(id);
      if (v) { v.setTarget(this.L.colCenter(e.col, b, 1), Math.PI); v.maxSpeed = this.vloop * 1.6; v.follow = false; v.hidden = false; }
      b += 1;
    }
  }

  * wait(sec) { let t = 0; while (t < sec) t += yield; }

  /** Làn đầy một màu: chờ xe đỗ yên, sáng lên rồi nổ từ trên xuống (ClearRoutine). */
  * clearRoutine(e) {
    let waited = 0;
    const parked = () => e.ids.every(id => { const v = this.views.get(id); return !v || ((v.x - v.tx) ** 2 + (v.z - v.tz) ** 2 <= 0.03 * 0.03 && v.speed <= 0.4); });
    while (waited < 0.5 && !(waited >= 0.1 && parked())) waited += yield;
    yield* this.wait(0.06);
    this.combo = this.clock - this.lastClear <= 2.5 ? this.combo + 1 : 1;
    this.lastClear = this.clock;
    sound.play('clear', 1, 1 + 0.07 * Math.min(this.combo - 1, 6));
    if (this.combo >= 2) this.showPopup(this.combo >= 4 ? `AMAZING x${this.combo}` : this.combo === 3 ? 'AWESOME x3' : 'GREAT x2', pal(e.c));
    // Không rung / zoom camera khi xoá làn (Unity 25/11/2026): tiếng và hiệu ứng nổ đủ.
    for (const id of e.ids) { const v = this.views.get(id); if (v) { v.flash = 0.3; this.glow(v.x, v.z, pal(e.c), 0.45, false); } }
    yield* this.wait(0.05);
    let k = 0;
    for (let i = e.ids.length - 1; i >= 0; i--) {
      const v = this.views.get(e.ids[i]);
      if (v) {
        this.views.delete(e.ids[i]);
        this.jobs.push(this.popAndDestroy(v, e.c));
        if (k++ > 0) sound.play('tap', 0.45, 1.1 + 0.08 * k);
      }
      yield* this.wait(0.075);
    }
  }

  /** Xe trắng lên, phồng nhẹ rồi tan thành quầng màu (PopAndDestroy). */
  * popAndDestroy(v, color) {
    this.dying.add(v);
    v.snap = true;
    let t = 0;
    while (t < 0.05) { t += yield; const k = ease.outSine(clamp01(t / 0.05)); v.popScale = 1 + 0.1 * k; v.flash = k; }
    this.glow(v.x, v.z, color ? pal(color) : '#ffffff', 1, true);
    this.dying.delete(v);
  }

  // ---------- VFX ----------
  tapFx(x, y, z, color) {   // FX_Tap: 12 chấm trắng toả vòng
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU, sp = rnd(2.2, 3), cx = Math.cos(a), cz = Math.sin(a);
      this.fx.add({ x: x + cx * 0.25, y, z: z + cz * 0.25, vx: cx * sp, vz: cz * sp, life: rnd(0.25, 0.35), size: rnd(0.12, 0.18), color, shrink: 0.2, drag: 6 });
    }
  }

  burst(kind, x, y, z, tint) {
    if (kind === 'clear') {   // FX_Clear
      for (let i = 0; i < 22; i++) { const [dx, dy, dz] = coneDir(90), sp = rnd(1.5, 3.2); this.fx.add({ x: x + dx * 0.3, y: y + dy * 0.3, z: z + dz * 0.3, vx: dx * sp, vy: dy * sp, vz: dz * sp, life: rnd(0.4, 0.65), size: rnd(0.14, 0.3), color: tint || '#fff', gravity: 0.6 * G, shrink: 0.2, drag: 2 }); }
    } else if (kind === 'debris' || kind === 'ice') {   // FX_Debris / FX_Ice
      const ice = kind === 'ice', cols = tint ? [tint] : PARTICLE_COLORS[kind];
      for (let i = 0; i < (ice ? 18 : 16); i++) {
        const [dx, dy, dz] = coneDir(ice ? 60 : 50), sp = ice ? rnd(2, 3.8) : rnd(2, 3.5), r = ice ? 0.3 : 0.25;
        this.fx.add({ x: x + dx * r, y, z: z + dz * r, vx: dx * sp, vy: dy * sp, vz: dz * sp, life: ice ? rnd(0.4, 0.6) : rnd(0.45, 0.7), size: ice ? rnd(0.07, 0.16) : rnd(0.08, 0.17),
          shape: 'flat', color: cols[i % cols.length], gravity: (ice ? 1.8 : 2.2) * G, vr: rnd(-1, 1) * (ice ? 540 : 360) * Math.PI / 180, shrink: ice ? 0.5 : 0.6 });
      }
    } else if (kind === 'confetti') {   // FX_Confetti: 90 + 70 mảnh
      const emit = n => { for (let i = 0; i < n; i++) { const [dx, dy, dz] = coneDir(35), sp = rnd(5, 8), [ox, oz] = unitDir(), rr = rnd(0, 1.2);
        this.fx.add({ x: x + ox * rr, y, z: z + oz * rr, vx: dx * sp, vy: dy * sp, vz: dz * sp, life: rnd(2, 2.8), size: rnd(0.12, 0.2), size2: rnd(0.2, 0.32), shape: 'flat',
          color: PARTICLE_COLORS.confetti[i % 6], gravity: 0.9 * G, drag: 1.6, vr: rnd(-1, 1) * 400 * Math.PI / 180, fadeEnd: 0.75 }); } };
      emit(90);
      this.jobs.push((function* (self) { yield* self.wait(0.25); emit(70); })(this));
    }
  }

  /** Băng vỡ: mảnh băng (ice_piece_01..05) bắn ra khỏi làn rồi rơi (ParkingBoardView.IceShards). */
  iceShards(x) {
    const L = this.L, n = 4 * this.m.hs[x] + 4;
    for (let i = 0; i < n; i++) {
      const life = rnd(0.55, 0.8);
      this.fx.add({ kind: 'sprite', sprite: `ice_piece_${i % 5 + 1}`, x: L.lx(x) + rnd(-0.4, 0.4), y: 0.5, z: L.lBottom(x) - 0.4 + rnd(0, this.m.hs[x]),
        vx: rnd(-1.6, 1.6), vy: rnd(2.2, 3.8), vz: rnd(-0.8, 0.8), gravity: 9, life, size: rnd(0.12, 0.22), shrink: 0, fadeEnd: 0.6, vr: rnd(-6, 6) });
    }
  }

  /** Quầng sáng mềm khi xoá làn (ClearGlow). */
  glow(x, z, hex, strength, sparks) {
    const c = hexMix(hex, '#ffffff', 0.4), jc = this.L.jc;
    this.fx.add({ kind: 'glow', x, y: 0.35, z, life: 0.45, size: 1.25 * jc * strength, alpha: 0.9 * strength, color: c });
    if (sparks) for (let i = 0; i < 6; i++) {
      const [dx, dz] = unitDir(), sp = rnd(0.8, 1.6) * jc;
      this.fx.add({ x, y: 0.35, z, vx: dx * sp, vz: dz * sp, life: rnd(0.25, 0.4), size: rnd(0.08, 0.14) * jc, color: hexMix(c, '#ffffff', 0.5) });
    }
  }

  showPopup(text, color, d = 0.9) { this.popup = { text, color, d, t: 0 }; }
  showToast(text, d = 2) { this.toast = text ? { text, d, t: 0 } : null; }

  // ---------- vẽ ----------
  /** Bàn tĩnh (nền, đường, vạch, cỏ) vẽ một lần vào canvas phụ. */
  buildBoard(dpr) {
    const { W, H, s } = this.v, m = this.m, L = this.L;
    const cv = document.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // nền (background.png lát mỗi 3 đơn vị)
    c.fillStyle = COL.ground; c.fillRect(0, 0, W, H);
    const gi = img.ground;
    if (ok(gi)) {
      const pat = c.createPattern(gi, 'repeat'), k = 3 * s;
      pat.setTransform(new DOMMatrix().translate(this.v.ox, this.v.oy).scale(k / iw(gi), k * SIN / ih(gi)));
      c.fillStyle = pat; c.fillRect(0, 0, W, H);
    }
    // cỏ hai bên bãi (GrassArt): hai sprite có lề, phía ngoài lặp nửa ngoài của sprite (lật xen kẽ) tới mép màn hình
    const gTop = L.jamTopZ + 0.02;
    for (const left of [true, false]) {
      const top = img[left ? 'grass_right' : 'grass_left'], under = img[left ? 'grass_left' : 'grass_right'];
      if (!ok(top)) continue;
      const w = 3, h = w * ih(top) / iw(top), inset = 24 / 642 * w;
      const edge = left ? L.lotLeftX : L.lotRightX, cx = left ? edge - w / 2 + inset : edge + w / 2 - inset;
      this.flatRect(c, cx + (left ? -0.05 : 0.05), gTop - h * 2 - 20 + 0.05, 40, 40, COL.grassFar);
      this.grassStrips(c, left, top, false, cx, w, gTop - h / 2);
      this.flatImage(c, top, cx, gTop - h / 2, w, h, false);
      if (ok(under)) { this.grassStrips(c, left, under, true, cx, w, gTop - h * 1.5 + 0.02); this.flatImage(c, under, cx, gTop - h * 1.5 + 0.02, w, h, true); }
    }
    // vạch chia cột bãi
    const lotLen = m.jh * L.jc + 14, lotCz = L.jamTopZ + 0.15 - lotLen / 2;
    for (let x = 1; x < m.jw; x++) this.flatRect(c, L.jamLeftX + x * L.jc, lotCz - 0.1, 0.035, lotLen - 0.2, COL.lotLine);
    // crossway: mọi chỗ trong đường ngoài là nhựa đường (đường vòng ngoài vẽ đè lên)
    if (m.cross) {
      const ins = ok(img.road) ? 1.15 * (INNER_CUT_U - 0.5) - 0.02 : 0.5;
      const fx0 = -1 + ins, fx1 = m.BW - ins, fz0 = L.roadBottomZ + ins, fz1 = L.topZ - ins;
      this.flatRect(c, (fx0 + fx1) / 2, (fz0 + fz1) / 2, fx1 - fx0, fz1 - fz0, COL.crossRoad);
    }
    // đường vòng (Road_Vertical trải dọc tim đường; mép trong mở trên các làn, mép ngoài mở ở cổng)
    this.drawRoad(c);
    // nét đứt mờ đều cả vòng (mọi level dùng kiểu nét của game gốc)
    const per = L.outerPerimeter, dashN = Math.max(4, Math.round(per / (m.cross ? CROSS_DASH_STEP : 0.6))), step = per / dashN;
    for (let i = 0; i < dashN; i++) { const p = L.outerAt((i + 0.5) * step); this.flatRect(c, p.x, p.z, 0.055, 0.16, COL.crossDash, p.yaw); }
    if (m.cross) this.drawMiddleRoad(c);
    // vạch chia làn, mũi tên, làn màu, rào
    for (let x = 0; x < m.W; x++) {
      const lx = L.lx(x);
      if (m.laneCol[x] > 0) {
        let top = L.lTop(x) + 0.5 + L.laneEndGap * 0.75, bot = L.blockBottom(x) - 0.5 - L.laneEndGap * 0.75;
        if (m.cross) {
          // vạch nằm trong đảo của nó (không cắt qua đường giữa)
          const upper = m.laneRow[x] === 1, cd = this.curbD;
          top = upper ? Math.min(top, L.topZ - cd) : Math.min(top, L.middleZ - MID_CURB_D);
          bot = upper ? Math.max(bot, L.middleZ + MID_CURB_D) : Math.max(bot, L.roadBottomZ + cd);
        }
        this.flatRect(c, lx - 0.5, (top + bot) / 2, 0.035, top - bot, COL.curbShade);
      }
      const barrierArt = m.barrier[x] && ok(img.barrier_plate);
      if (m.only[x]) {
        // làn màu (game gốc): mũi tên vào làn nằm trên ô màu của làn
        const col = pal(m.only[x]), tz = L.topGapZ(x);
        this.flatRound(c, lx, tz, 0.36, 0.26, 0.05, hexMix(col, '#000000', 0.15));
        this.flatRound(c, lx, tz + 0.012, 0.33, 0.23, 0.045, col);
        this.arrow(c, lx, tz, '#ffffff', 0.18, 0.12);
      } else if (!barrierArt) this.arrow(c, lx, L.topGapZ(x));
      if (!barrierArt) this.arrow(c, lx, L.bottomGapZ(x));
      if (barrierArt) {
        // rào (game gốc): tấm chắn ở hai đầu làn, dấu X sơn trong mỗi ô
        const pi = img.barrier_plate, pw = 0.8, ph = pw * ih(pi) / iw(pi);
        for (const z of [L.topGapZ(x), L.bottomGapZ(x)]) this.flatImage(c, pi, lx, z, pw, ph, false);
        for (let i = 0; i < m.hs[x]; i++) for (const yaw of [Math.PI / 4, -Math.PI / 4]) this.flatRect(c, lx, L.lBottom(x) + i, 0.05, 0.42, COL.curbShade, yaw);
      }
      if (m.elvGroup[x] >= 0) this.drawElevator(c, x);
    }
    this.board = cv;
  }

  get curbD() { return ok(img.road) ? 1.15 * (0.5 - 0.1175) : 0.55; }

  /** Cỏ chạy tiếp ra ngoài: nửa ngoài của sprite lặp 16 lần, bản xen kẽ lật gương để mép khớp. */
  grassStrips(c, left, i, turned, cx, w, z) {
    const rightHalf = left === turned, sw = w / 2, h = w * ih(i) / iw(i), dir = left ? -1 : 1, s = this.v.s;
    for (let k = 0; k < 16; k++) {
      const x = cx + dir * (w / 2 + sw / 2 + k * sw) - dir * 0.005 * (k + 1), [px, py] = this.P(x, 0, z);
      if (px + sw * s < 0 || px - sw * s > this.v.W) continue;
      c.save(); c.translate(px, py); if (turned) c.rotate(Math.PI); if (k % 2 === 0) c.scale(-1, 1);
      c.drawImage(i, rightHalf ? iw(i) / 2 : 0, 0, iw(i) / 2, ih(i), -sw * s / 2, -h * s * SIN / 2, sw * s, h * s * SIN);
      c.restore();
    }
  }

  /** Crossway: đường giữa giữa hai đảo làn (đảo nền tối, lề trắng hai cạnh bên), nét đứt, cua trái chấm, mũi tên giao lộ, rào. */
  drawMiddleRoad(c) {
    const m = this.m, L = this.L, x0 = -1, x1 = m.BW, z = L.middleZ, cd = this.curbD;
    for (let row = 0; row <= 1; row++) {
      if (!m.laneRow.some(r => r === row)) continue;
      const bot = row === 0 ? L.roadBottomZ + cd : z + MID_CURB_D, top = row === 0 ? z - MID_CURB_D : L.topZ - cd;
      const il = x0 + cd, ir = x1 - cd, cz = (bot + top) / 2, len = top - bot, icx = (il + ir) / 2, hw = (ir - il) / 2, rad = Math.min(0.72, len / 2 - 0.01);
      this.flatRound(c, icx, cz, ir - il, len, rad, COL.crossIsland);
      // lề trắng: chỉ hai cạnh bên + móc ngắn vào góc (|x - tâm| ≥ hw - 0.4·rad)
      const P = this.P, s = this.v.s;
      c.lineWidth = 0.07 * s; c.lineCap = 'butt'; c.strokeStyle = COL.curb;
      for (const sd of [-1, 1]) {
        const ex = icx + sd * hw, cut = hw - 0.4 * rad;
        c.beginPath();
        const pts = [];
        // cung trên → cạnh → cung dưới, chỉ phần |x - icx| ≥ cut
        for (let k = 0; k <= 12; k++) { const a = Math.PI / 2 * k / 12; pts.push([icx + sd * (hw - rad + rad * Math.sin(a)), cz + len / 2 - rad + rad * Math.cos(a)]); }
        for (let k = 0; k <= 12; k++) { const a = Math.PI / 2 * k / 12; pts.push([icx + sd * (hw - rad + rad * Math.cos(a)), cz - len / 2 + rad - rad * Math.sin(a)]); }
        let on = false;
        for (const [px, pz] of pts) {
          if (Math.abs(px - icx) < cut) { on = false; continue; }
          const q = P(px, 0, pz);
          if (on) c.lineTo(...q); else { c.moveTo(...q); on = true; }
        }
        c.stroke();
        void ex;
      }
    }
    // nét đứt đường giữa, đều từ cuối cua trái tới đầu mũi tên
    const dA = x0 + LOOP_R + 0.06, dB = x1 - 0.5 - 0.45 - 0.12, n = Math.max(1, Math.round((dB - dA) / CROSS_DASH_STEP)), st = (dB - dA) / n;
    for (let i = 0; i < n; i++) this.flatRect(c, dA + (i + 0.5) * st, z, 0.055, 0.16, COL.crossDash, Math.PI / 2);
    // chấm cong chỗ vòng rẽ từ cạnh trái vào đường giữa
    const r = LOOP_R, arc = Math.PI * r / 2, d3 = (x1 - x0 - 2 * r) + arc + (L.topZ - z - 2 * r);
    for (let i = 0; i < 3; i++) { const p = L.pathAt(d3 + (i + 0.5) * arc / 3); this.flatRect(c, p.x, p.z, 0.055, 0.16, COL.crossDash, p.yaw); }
    // mũi tên lớn mờ ở cạnh phải trên giao lộ chỉ đường lên
    const ar = 0.5, P = this.P, s = this.v.s, line = [];
    for (let ax = x1 - ar - 0.45; ax < x1 - ar; ax += 0.05) line.push(P(ax, 0, z));
    for (let k = 0; k <= 12; k++) { const th = -Math.PI / 2 + k * Math.PI / 24; line.push(P(x1 - ar + ar * Math.cos(th), 0, z + ar + ar * Math.sin(th))); }
    const tipZ = z + ar + 0.85;
    line.push(P(x1, 0, tipZ));
    c.strokeStyle = COL.crossArrow; c.lineWidth = 0.06 * s; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); line.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.stroke();
    c.beginPath(); c.moveTo(...P(x1 - 0.2, 0, tipZ - 0.2)); c.lineTo(...P(x1, 0, tipZ)); c.lineTo(...P(x1 + 0.2, 0, tipZ - 0.2)); c.stroke();
    // cạnh trái ngoài dưới đường giữa bị chắn (rào hồi sinh): cột ở mép ngoài, tay chắn ngang đường
    this.poleBarrier(c, x0 - 0.47, z - 0.62, 0, Math.PI);
  }

  /** Thang máy (game gốc): sàn thép gân, sọc vàng đen hai mép dài, nắp hai đầu (Platform_Top / Platform_Under). */
  drawElevator(c, x) {
    const L = this.L, lx = L.lx(x), zc = this.zc(x), len = this.m.hs[x] + L.laneEndGap * 1.6;
    this.flatRound(c, lx, zc, 0.9, len, 0.12, COL.elvFloor);
    let row = 0;
    for (let z = -len / 2 + 0.2; z < len / 2 - 0.15; z += 0.17, row++)
      for (let bx = -0.27 + (row % 2) * 0.09; bx <= 0.28; bx += 0.18) this.flatRect(c, lx + bx, zc + z, 0.05, 0.15, COL.elvBump, ((row + Math.round(bx * 10)) % 2 === 0 ? 40 : -40) * Math.PI / 180);
    for (const sd of [-1, 1]) { let i = 0; for (let z = -len / 2 + 0.16; z < len / 2 - 0.1; z += 0.11, i++) this.flatRect(c, lx + sd * 0.4, zc + z, 0.07, 0.11, i % 2 ? COL.elvBlack : COL.elvYellow); }
    const topZ = zc + len / 2 - 0.13, botZ = zc - len / 2 + 0.13, pt = img.platform, pu = ok(img.platform_under) ? img.platform_under : pt;
    if (ok(pt)) { this.flatImage(c, pt, lx, topZ, 0.78, 0.78 * ih(pt) / iw(pt), true); this.flatImage(c, pu, lx, botZ, 0.78, 0.78 * ih(pu) / iw(pu), false); }
    else { this.flatRound(c, lx, topZ, 0.78, 0.22, 0.08, COL.elvBump); this.flatRound(c, lx, botZ, 0.78, 0.22, 0.08, COL.elvBump); }
  }

  /** Rào cột + tay chắn đỏ trắng (Parking_Barrier): cột ở (x, z), tay về -x (quay yaw), nâng ang (0 = đóng ngang). */
  poleBarrier(c, px, pz, ang, yaw = 0, s0 = null) {
    const P = this.P, s = s0 ?? this.v.s, py = 0.243, len = 0.92, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const at = (u, y) => P(px - u * cy, y, pz + u * sy);
    const dx = Math.cos(ang), dy = -Math.sin(ang);
    const [bx0, by0] = P(px, 0, pz), [bx1, by1] = P(px, py, pz);
    c.strokeStyle = '#b8282b'; c.lineWidth = 0.08 * s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(bx0, by0); c.lineTo(bx1, by1); c.stroke();
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = at(dx * len * k / 4, py + dy * len * k / 4), [ex, ey] = at(dx * len * (k + 1) / 4, py + dy * len * (k + 1) / 4);
      c.strokeStyle = k % 2 ? '#fff7de' : '#e63333'; c.lineWidth = 0.07 * s; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.stroke();
    }
    c.fillStyle = '#2d3046'; c.beginPath(); c.arc(bx1, by1, 0.06 * s, 0, TAU); c.fill();
  }

  drawRoad(c) {
    const L = this.L, m = this.m, P = this.P, ri = img.road;
    const pts = [];
    for (let d = 0; d < L.outerPerimeter - 1e-3; d += 0.05) pts.push(L.outerAt(d));
    const rw = 1.15, half = rw / 2, darkU = 0.173, bw = L.bayWidth, gx = L.gateX;
    const inGate = p => p.z < L.roadBottomZ + 0.05 && Math.abs(p.x - gx) < (L.directEntry ? bw * 1.2 : bw * 1.5 + 0.02);
    // mép trong mở trên các làn (crossway: không có mép trong, đảo có lề riêng); cắt ở u 0.785, tránh vệt bóng tối của lề
    const overCols = m.cross ? () => true : p => (p.z > L.topZ - 0.05 || p.z < L.roadBottomZ + 0.05) && p.x > -0.5 && p.x < m.BW - 0.5;
    const tile = (() => { const t = ok(ri) ? rw * ih(ri) / iw(ri) : 1; return L.outerPerimeter / Math.max(2, 2 * Math.round(L.outerPerimeter / (2 * t))); })();
    const warn = [];
    let run = null, along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      // pháp tuyến ra ngoài = bên phải hướng chạy (vòng ngược chiều kim đồng hồ)
      const nx = Math.cos(a.yaw), nz = -Math.sin(a.yaw);
      const oOut = inGate(a) ? half - darkU * rw : half, uOut = inGate(a) ? darkU : 0;
      const oIn = overCols(a) ? half - (1 - INNER_CUT_U) * rw : half, uIn = overCols(a) ? INNER_CUT_U : 1;
      const A = P(a.x + nx * oOut, 0, a.z + nz * oOut), B = P(a.x - nx * oIn, 0, a.z - nz * oIn);
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), ext = seg * 1.6 + 0.01;
      const D = P(a.x + nx * oOut + fx * ext, 0, a.z + nz * oOut + fz * ext);
      if (ok(ri)) {
        const v0 = (along % tile) / tile, v1 = v0 + ext / tile;
        c.save();
        c.transform(B[0] - A[0], B[1] - A[1], D[0] - A[0], D[1] - A[1], A[0], A[1]);
        const H = ih(ri), sy = Math.min(Math.floor(v0 * H), H - 1), sh = Math.max(1, Math.min(Math.ceil((v1 - v0) * H), H - sy));
        c.drawImage(ri, uOut * iw(ri), sy, (uIn - uOut) * iw(ri), sh, 0, 0, 1, 1);
        c.restore();
      } else {
        c.fillStyle = '#5c62a8'; c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.lineTo(...P(b.x - nx * oIn, 0, b.z - nz * oIn)); c.lineTo(...P(b.x + nx * oOut, 0, b.z + nz * oOut)); c.fill();
      }
      along += seg;
      // viền ngoài để nháy đỏ khi vòng đầy (mép ngoài 0.055 .. 0.18 của Road_Vertical)
      if (!inGate(a)) { const o = half - 0.1175 * rw; (run ??= []).push(P(a.x + nx * o, 0, a.z + nz * o)); } else if (run) { warn.push(run); run = null; }
    }
    if (run) warn.push(run);
    this.warnPaths = warn; this.warnWidth = 0.125 * rw;
  }

  flatRect(c, x, z, w, h, color, yaw = 0) {
    const P = this.P, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const pt = (u, v) => P(x + u * cs + v * sn, 0, z - u * sn + v * cs);
    c.fillStyle = color; c.beginPath(); c.moveTo(...pt(-w / 2, -h / 2)); c.lineTo(...pt(w / 2, -h / 2)); c.lineTo(...pt(w / 2, h / 2)); c.lineTo(...pt(-w / 2, h / 2)); c.closePath(); c.fill();
  }

  /** Hình chữ nhật bo góc nằm trên mặt đất. */
  flatRound(c, x, z, w, h, r, color) {
    const [x0, y0] = this.P(x - w / 2, 0, z + h / 2), [x1, y1] = this.P(x + w / 2, 0, z - h / 2), s = this.v.s;
    c.save(); c.translate(x0, y0); c.scale(1, SIN); round(c, 0, 0, x1 - x0, (y1 - y0) / SIN, r * s); c.restore();
    c.fillStyle = color; c.fill();
  }

  flatImage(c, i, x, z, w, h, turn) {
    const [px, py] = this.P(x, 0, z), s = this.v.s;
    c.save(); c.translate(px, py); if (turn) c.rotate(Math.PI);
    c.drawImage(i, -w * s / 2, -h * s * SIN / 2, w * s, h * s * SIN);
    c.restore();
  }

  arrow(c, x, z, color = COL.curbShade, w = 0.2, h = 0.13) {   // ParkingMesh.Arrow(0.2, 0.13) quay 180°: mũi chỉ xuống
    const P = this.P;
    c.fillStyle = color; c.beginPath(); c.moveTo(...P(x, 0, z - h / 2)); c.lineTo(...P(x - w / 2, 0, z + h / 2)); c.lineTo(...P(x + w / 2, 0, z + h / 2)); c.closePath(); c.fill();
  }

  /** Vẽ một khung. o: { dpr, hint (bus id), edit: { lane, empty } }. Trả về vùng bấm (px CSS). */
  paint(c, m, o = {}) {
    const dpr = o.dpr || 1, { W, H, s } = this.v, P = this.P, L = this.L;
    if (!this.board) this.buildBoard(dpr);
    const cam = this.cam, sh = cam.trauma * cam.trauma, tt = this.clock * 22;
    const noise = k => Math.sin(tt * 1.13 + this.cam.seed + k * 7.1) * 0.6 + Math.sin(tt * 2.31 + k * 3.7) * 0.4;
    const zoom = 1 / (1 - Math.max(-0.2, Math.min(0.2, cam.kick)));
    c.save();
    c.clearRect(0, 0, W, H);
    c.translate(W / 2 + noise(0) * 0.35 * sh * s, H / 2 + noise(1) * 0.35 * sh * s);
    c.rotate(noise(2) * 1.2 * sh * Math.PI / 180);
    c.scale(zoom, zoom);
    c.translate(-W / 2, -H / 2);
    c.drawImage(this.board, 0, 0, W, H);
    // viền ngoài đỏ khi vòng đầy
    if (this.warnK > 0.001 && this.warnPaths) {
      c.strokeStyle = `rgba(${COL.warnCurb.join(',')},${this.warnK})`; c.lineWidth = this.warnWidth * s; c.lineJoin = 'round';
      for (const run of this.warnPaths) { c.beginPath(); run.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.stroke(); }
    }
    // thang máy: số tầng còn lại trên nắp dưới (đỏ cam khi đang chờ cả nhóm), cột sáng trắng khi tầng mới lên
    for (let x = 0; x < m.W; x++) {
      if (m.elvGroup[x] < 0) continue;
      const lv = m.elvLevels[x]?.length || 0, len = m.hs[x] + L.laneEndGap * 1.6, z = this.zc(x) - len / 2 + 0.13;
      if (lv) { const [lx, ly] = P(L.lx(x), 0.15, z - 0.02); label(c, `x${lv}`, lx, ly, 0.22 * s, this.lane[x]?.wait ? '#ffb38a' : '#ffffff'); }
    }
    // vệt bánh
    c.lineCap = 'round';
    for (const sk of this.skids.values()) for (const a of sk) {
      for (let i = 1; i < a.length; i++) {
        if (a[i].gap) continue;
        const k = 1 - (this.clock - a[i].t) / 0.45;
        c.strokeStyle = `rgba(255,255,255,${0.85 * k})`; c.lineWidth = 0.07 * s;
        c.beginPath(); c.moveTo(...P(a[i - 1].x, 0.015, a[i - 1].z)); c.lineTo(...P(a[i].x, 0.015, a[i].z)); c.stroke();
      }
    }
    // bóng xe
    const cars = [...this.views.values(), ...this.dying];
    const visible = v => v.tz > L.jamTopZ - (VISIBLE_LOT_ROWS + 1.6) * L.jc || v.z > L.jamTopZ - (VISIBLE_LOT_ROWS + 1.6) * L.jc;
    const shadow = shadowSprite();
    for (const v of cars) {
      if (v.box || v.gen || !visible(v)) continue;
      const b = v.body, k = b.shadow;
      if (k <= 0.01) continue;
      const w = 0.7 * 1.12 * b.sx * k * (v.popScale || 1), l = v.lengthWorld * 1.06 * b.sz * k * (v.popScale || 1);
      const [px, py] = P(v.x + 0.07, 0.012, v.z - 0.11);
      c.save(); c.translate(px, py); c.scale(1, SIN); c.rotate(v.yaw);
      c.drawImage(shadow, -w * s / 2, -l * s / 2, w * s, l * s);
      c.restore();
    }
    // dây nối các xe cùng nhóm
    this.drawRopes(c, m);
    // xe + khối (WebGL)
    const gl = this.gl;
    if (gl.begin({ w: Math.round(W * dpr), h: Math.round(H * dpr), s: s * dpr, ox: this.v.ox * dpr, oy: this.v.oy * dpr })) {
      this.drawLaneBoxes(m, false);
      for (const v of cars) {
        if (!visible(v)) continue;
        if (v.box) continue;   // hộp khoá: ổ khoá vàng lớn đứng trong ô (vẽ 2D bên dưới)
        if (v.gen) { this.garage(v); continue; }
        const ps = v.popScale || 1, b = v.body;
        gl.draw({ x: v.x, z: v.z, yaw: v.yaw, len: v.len, lengthWorld: v.lengthWorld, color: pal(v.hidden ? '?' : v.color), flash: v.flash,
          body: ps === 1 ? b : { ...b, sx: b.sx * ps, sy: b.sy * ps, sz: b.sz * ps } });
      }
      this.drawLaneBoxes(m, true);
      const sg = this.signPos(m);
      this.signMesh = !!sg && gl.drawMesh('sign', { x: sg.x, z: sg.z, roll: sg.roll });
      c.drawImage(gl.canvas, 0, 0, W, H);
    }
    // vật cản phủ lên xe, nhãn, chìa khoá, vật rèm
    const covered = new Set();   // xe trong làn bị che (gara, băng, rèm, thang máy chờ): không vẽ dấu '?'
    m.cols.forEach((col, x) => { if (m.covered(x)) for (const k of col) covered.add(k.id); });
    for (let x = 0; x < m.W; x++) this.drawLaneOverlay(c, m, x);
    for (const v of cars) {
      const k = v.body.scale ?? 1;
      if (!visible(v) || k < 0.05) continue;
      // chìa vàng nằm dọc trên nóc xe (trên nóc thật, không chìm), không bóng
      if (v.key) { const [kx, ky] = P(v.x, 0.78 + v.body.y, v.z); const ki = img.lockkey; if (ok(ki)) { const w = 0.4 * s * k; c.drawImage(ki, kx - w / 2, ky - w * 0.6, w, w * ih(ki) / iw(ki)); } }
      // xe ẩn (game gốc): vỏ bóng tím nhạt quanh xe + dấu '?' trắng lớn phía trên
      if (v.hidden && !v.box && !v.gen && !covered.has(v.id)) {
        const [hx, hy] = P(v.x, 0.3 + v.body.y, v.z), rw = 0.86 * s * k / 2, rl = (v.lengthWorld + 0.14) * s * k / 2;
        c.save(); c.translate(hx, hy); c.scale(1, SIN); c.rotate(v.yaw); c.globalAlpha = 0.38; c.fillStyle = '#dbd6ff';
        c.beginPath(); c.ellipse(0, 0, rw, rl, 0, 0, TAU); c.fill(); c.restore(); c.globalAlpha = 1;
        const qi = img.question;
        if (ok(qi)) { const [qx, qy] = P(v.x, 0.87 + v.body.y, v.z), w = 0.3 * s * k; c.drawImage(qi, qx - w / 2, qy - w * ih(qi) / iw(qi) / 2, w, w * ih(qi) / iw(qi)); }
      }
      if (v.coc) { const f = 0.1 * v.lengthWorld, [ox, oy] = P(v.x + Math.sin(v.yaw) * f, 0.67 + v.body.y, v.z + Math.cos(v.yaw) * f); const sp = tinted('splash', pal(v.coc)); if (sp) { const w = 0.44 * s * k; c.drawImage(sp, ox - w / 2, oy - w / 2, w, w * ih(sp) / iw(sp)); } }
      if (v.box) { const [lx, ly] = P(v.x, 0.3, v.z); const li = img.lock; if (ok(li)) { const w = 0.78 * s * k; c.drawImage(li, lx - w / 2, ly - w / 2, w, w * ih(li) / iw(li)); } }
      if (v.gen) { const [lx, ly] = P(v.x, 0.82, v.z); label(c, String(m.generatorLeft(m.buses.find(b => b.carId === v.id)?.id ?? -1)), lx, ly, 0.34 * s, '#ffffff'); }
    }
    // gợi ý bấm
    if (o.hint !== undefined && o.hint !== null) {
      const b = m.buses[o.hint], v = b && this.views.get(b.carId), hi = img.tap_hand;
      if (v && ok(hi)) { const [hx, hy] = P(v.x + 0.25, 0.3, v.z - 0.35), bob = Math.sin(this.clock * 7) * 0.08 * s, w = 0.75 * s; c.drawImage(hi, hx - w * 0.2, hy + bob - w * 0.1, w, w * ih(hi) / iw(hi)); }
    }
    this.fx.draw(c, P, s);
    // biển số xe trên vòng (LoopBadge ở (W + 0.62, -1.7))
    this.drawSign(c, m);
    if (o.edit) this.drawEdit(c, m, o.edit);
    c.restore();
    // chữ trên màn hình
    if (this.popup) {
      const p = this.popup, k = p.t / p.d, sc = p.t < 0.25 ? ease.outBack(p.t / 0.25) : 1;
      c.globalAlpha = k < 0.7 ? 1 : clamp01(1 - (k - 0.7) / 0.3);
      title(c, p.text, W / 2, H * 0.4 - Math.max(0, k - 0.6) * H * 0.08, Math.min(W * 0.11, s * 0.9) * sc, p.color);
      c.globalAlpha = 1;
    }
    if (this.countdown) {
      const cd = this.countdown, k = clamp01(cd.t / 0.3), sc = lerp(1.8, 1, ease.outBack(k));
      c.globalAlpha = clamp01(1.2 - Math.max(0, cd.t - 0.5));
      title(c, String(cd.n), W / 2, H * 0.48, W * 0.22 * sc, '#ff7366');
      c.globalAlpha = 1;
    }
    if (this.toast) label(c, this.toast.text, W / 2, H * 0.62, Math.max(12, s * 0.3), '#ffffff', 'rgba(20,20,60,.75)');
    if (this.endState) this.drawEnd(c, m, o);
    return this.hits(m);
  }

  drawRopes(c, m) {
    const groups = new Map();
    for (const b of m.buses) if (b.link >= 0 && !b.out && b.inGen < 0) (groups.get(b.link) || groups.set(b.link, []).get(b.link)).push(b);
    const ri = img.rope, s = this.v.s;
    for (const list of groups.values()) {
      list.sort((a, b) => a.x - b.x || b.y - a.y);
      for (let k = 1; k < list.length; k++) {
        const va = this.views.get(list[k - 1].carId), vb = this.views.get(list[k].carId);
        if (!va || !vb) continue;
        const [x0, y0] = this.P(va.x, 0.28, va.z), [x1, y1] = this.P(vb.x, 0.28, vb.z), len = Math.hypot(x1 - x0, y1 - y0), th = 0.16 * s;
        c.save(); c.translate(x0, y0); c.rotate(Math.atan2(y1 - y0, x1 - x0));
        // mỗi nửa dây theo màu xe của nó (game gốc: cùng màu thì một màu, khác thì nửa này nửa kia); xe ẩn = màu '?'
        if (ok(ri)) {
          const t = th * iw(ri) / ih(ri), half = len / 2;
          const tint = b => tinted('rope', hexMix(pal(b.hidden ? '?' : b.c), '#ffffff', 0.15)) || ri;
          for (const [src, from, to] of [[tint(list[k - 1]), 0, half], [tint(list[k]), half, len]])
            for (let d = from; d < to; d += t) c.drawImage(src, 0, 0, Math.min(1, (to - d) / t) * iw(ri), ih(ri), d, -th / 2, Math.min(t, to - d), th);
        }
        else { c.fillStyle = '#d8c39a'; c.fillRect(0, -th / 2, len, th); }
        c.restore();
      }
    }
  }

  garage(v) {   // SetGen: gara (màu vật liệu của prefab Garage Obstacle)
    const gl = this.gl, L = v.lengthWorld, b = v.body, f = { x: Math.sin(v.yaw), z: Math.cos(v.yaw) };
    gl.box({ x: v.x, y: 0.3 * b.sy + b.y, z: v.z, sx: 0.9 * b.sx, sy: 0.6 * b.sy, sz: L * 0.95 * b.sz, yaw: v.yaw, color: [0.33, 0.4, 0.68] });
    gl.box({ x: v.x, y: 0.62 * b.sy + b.y, z: v.z, sx: 0.96 * b.sx, sy: 0.07, sz: L * b.sz, yaw: v.yaw, color: [0.46, 0.51, 0.83] });
    gl.box({ x: v.x + f.x * L * 0.47, y: 0.25 * b.sy + b.y, z: v.z + f.z * L * 0.47, sx: 0.66 * b.sx, sy: 0.46 * b.sy, sz: 0.04, yaw: v.yaw, color: [0.12, 0.14, 0.2] });
  }

  laneAnim(at) {
    if (at < 0) return null;
    const k = (this.clock - at) / 0.45;
    if (k >= 1) return null;
    return { up: ease.outQuad(k) * 0.8, sc: k < 0.35 ? 1 + 0.15 * (k / 0.35) : lerp(1.15, 0, inBack((k - 0.35) / 0.65)) };
  }

  pulse(at, peak) {
    if (at < 0) return 1;
    const e = this.clock - at;
    if (e >= 0.3) return 1;
    return e < 0.1 ? lerp(1, peak, ease.outQuad(e / 0.1)) : lerp(peak, 1, ease.outQuad(clamp01((e - 0.1) / 0.2)));
  }

  /** Gara khoá (BuildContainer) và tấm băng (BuildIce): khối 3D phủ kín xe trong làn. */
  drawLaneBoxes(m, transparent) {
    const gl = this.gl, L = this.L;
    for (let x = 0; x < m.W; x++) {
      const a = this.lane[x], h = m.hs[x], zc = this.zc(x), lx = L.lx(x);
      if (!a) continue;
      if (!transparent) {
        const an = a.lock ? { up: 0, sc: 1 } : this.laneAnim(a.openLock);
        if (an) {
          // Gara (game gốc): khối tím, nắp xanh nhạt có rãnh, cột tròn bốn góc; icon xe màu mở khoá trên nóc. Đủ cao che nóc xe.
          const byColor = !!m.lockC[x], shell = byColor ? COL.garageSide : COL.ink, lid = byColor ? COL.garageLid : hexMix(shell, '#ffffff', 0.25);
          const sc = an.sc, y0 = an.up, Hh = 0.78 * sc, Wd = 0.9 * sc, len = (h - 0.04) * sc;
          gl.box({ x: lx, y: y0 + Hh / 2, z: zc, sx: Wd, sy: Hh, sz: len, color: shell });
          gl.box({ x: lx, y: y0 + Hh + 0.02 * sc, z: zc, sx: Wd - 0.1 * sc, sy: 0.05 * sc, sz: len - 0.12 * sc, color: lid });
          const groove = hexMix(lid, COL.garageSide, 0.55);
          for (let z = -len / 2 + 0.28 * sc; z < len / 2 - 0.2 * sc; z += 0.26 * sc) gl.box({ x: lx, y: y0 + Hh + 0.05 * sc, z: zc + z, sx: Wd * 0.62, sy: 0.012 * sc, sz: 0.07 * sc, color: groove });
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) gl.box({ x: lx + sx * (Wd / 2 - 0.02 * sc), y: y0 + Hh / 2 + 0.03 * sc, z: zc + sz * (len / 2 - 0.02 * sc), sx: 0.13 * sc, sy: Hh + 0.06 * sc, sz: 0.13 * sc, color: hexMix(shell, '#ffffff', 0.12) });
          if (byColor) gl.draw({ x: lx, y: y0 + Hh + 0.05 * sc, z: zc, yaw: 0, len: 1, lengthWorld: 0.62, color: pal(m.lockC[x]), body: { sx: 0.75 * sc, sy: 0.75 * sc, sz: 0.75 * sc } });
        }
      } else {
        const an = a.ice ? { up: 0, sc: this.pulse(a.pulseIce, 1.06) } : this.laneAnim(a.openIce);
        if (an) gl.box({ x: lx, y: an.up + 0.43 * an.sc, z: zc, sx: 0.94 * an.sc, sy: 0.86 * an.sc, sz: (h + 0.02) * an.sc, color: [0.75, 0.92, 1], alpha: 0.62, rough: 0.1 });
      }
    }
  }

  drawLaneOverlay(c, m, x) {
    const a = this.lane[x], P = this.P, s = this.v.s, L = this.L;
    if (!a) return;
    const h = m.hs[x], zc = this.zc(x), lx = L.lx(x);
    // số lần xoá còn lại của khoá đếm
    if (a.lock && !m.lockC[x]) { const [px, py] = P(lx, 0.9, zc); label(c, String(m.locked[x]), px, py, 0.4 * s, '#ffffff'); }
    // băng: vân băng trên mặt + số
    const ice = a.ice ? { up: 0, sc: this.pulse(a.pulseIce, 1.06) } : this.laneAnim(a.openIce);
    if (ice) {
      const tex = img.ice_tex, y = ice.up + 0.86 * ice.sc, hw = 0.47 * ice.sc, hl = (h + 0.02) / 2 * ice.sc;
      const [x0, y0] = P(lx - hw, y, zc + hl), [x1, y1] = P(lx + hw, y, zc - hl);
      if (ok(tex)) {
        c.save(); c.globalAlpha = 0.45; c.globalCompositeOperation = 'screen';
        const pat = c.createPattern(tex, 'repeat'); pat.setTransform(new DOMMatrix().translate(x0, y0).scale(s * 1.2 / iw(tex)));
        c.fillStyle = pat; c.fillRect(x0, y0, x1 - x0, y1 - y0); c.restore();
      }
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = Math.max(1, s * 0.03); c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      if (a.ice) {
        const [bx, by] = P(lx, 0.96, zc), k = this.pulse(a.pulseIce, 1.3);
        badge(c, bx, by, String(m.ice[x]), 0.5 * s * k);
      }
    }
    // rèm (CurtainArt): các mảnh vải quay về camera, giữ trên xe; số vật còn cần trên vết sơn màu
    const cur = a.cur ? { up: 0, sc: this.pulse(a.pulseCur, 1.05) } : this.laneAnim(a.openCur);
    if (cur) {
      const mid = img.curtain_mid, under = img.curtain_under, top = img.curtain_top;
      if (ok(mid)) {
        const w = 1.06 * cur.sc * s, ph = w * ih(mid) / iw(mid);
        for (let i = h - 1; i >= 0; i--) {
          const z = zc - (h - 1) / 2 + i, [px, py] = P(lx, 0.75 + cur.up, z), src = i === 0 && ok(under) ? under : mid;
          const hh = w * ih(src) / iw(src);
          c.drawImage(src, px - w / 2, py - hh / 2, w, hh);
          if (i === h - 1 && ok(top)) { const th = w * ih(top) / iw(top); c.drawImage(top, px - w / 2, py - ph / 2 - th * 0.55, w, th); }
        }
      }
      if (a.cur) {
        const fz = zc - (h - 1) / 2, [sx, sy] = P(lx, 0.87 + cur.up, fz), sp = tinted('splash', pal(m.curC[x])), k = this.pulse(a.pulseCur, 1.3);
        if (sp) { const w = 0.62 * s * k; c.drawImage(sp, sx - w / 2, sy - w / 2, w, w * ih(sp) / iw(sp)); }
        label(c, String(m.curN[x]), sx, sy, 0.36 * s * k, '#ffffff');
      }
    }
    // rào
    if (m.barrier[x]) {
      if (ok(img.barrier_plate) && ok(img.barrier_block)) {
        // đóng: khối sọc vàng đen bật vào mỗi tấm chắn, nón giao thông giữa làn (CloseBarrierArt)
        if (a.barrierT >= 0) {
          const k = Math.max(0, ease.outBack(a.barrierT)), bi = img.barrier_block, w = 0.8 * 0.62 * k;
          for (const z of [L.topGapZ(x), L.bottomGapZ(x)]) this.flatImage(c, bi, lx, z, w, w * ih(bi) / iw(bi), false);
          const ci = img.cone;
          if (ok(ci)) { const [px, py] = P(lx, 0.01, zc), cw = 0.34 * s * k; c.drawImage(ci, px - cw / 2, py - cw * ih(ci) / iw(ci) / 2, cw, cw * ih(ci) / iw(ci)); }
        }
      } else {
        // không có art: thanh đỏ trắng xoay quanh trụ, hạ xuống sau lần xoá đầu (SwingShut)
        const t = a.barrierT < 0 ? 0 : a.barrierT, ang = lerp(-70, 0, a.barrierT < 0 ? 0 : ease.outBack(t)) * Math.PI / 180;
        this.poleBarrier(c, lx + 0.45, L.lTop(x) + 0.65 + L.laneEndGap, ang);
      }
    }
    // thang máy: cột sáng trắng trên làn khi tầng mới lên (ElevatorRiseFx)
    if (a.riseAt >= 0) {
      const k = clamp01((this.clock - a.riseAt) / 0.55);
      if (k >= 1) a.riseAt = -1;
      else {
        const w = 0.9 * (1 - 0.25 * k), [x0, y0] = P(lx - w / 2, 0.62, zc + h / 2), [x1, y1] = P(lx + w / 2, 0.62, zc - h / 2);
        c.fillStyle = `rgba(255,255,255,${0.85 * (1 - k) * (1 - k)})`; round(c, x0, y0, x1 - x0, y1 - y0, 0.2 * s); c.fill();
      }
    }
  }

  // ---------- bảng đếm vòng (ParkingLoopSign.cs, Sign-ConveyorCount) ----------
  /** Sáng / lắc bảng như ParkingHud.FlashLoop: màu xanh (thêm chỗ: booster, hồi sinh) bắn hạt HitToSign, mọi lần đều lắc. */
  flashSign(color) {
    this.signFlash = 0.6; this.signColor = color;
    this.sign.shake = 0;
    if (color !== 'red') this.signHit();
  }

  signStep(m, dt) {
    const g = this.sign, used = m.loopCells(), cap = m.cap;
    if (g.used >= 0 && (used !== g.used || cap !== g.cap)) g.pulse = 0;   // SetCount: đổi số thì nảy chữ
    g.used = used; g.cap = cap; g.W = m.W; g.BW = m.BW;
    if (g.pulse >= 0 && (g.pulse += dt) >= 0.18) g.pulse = -1;
    if (g.shake >= 0 && (g.shake += dt) >= 0.45) g.shake = -1;
  }

  /** Chân cột ở (BW + 0.62, 0, đường dưới - 0.7) (LoopBadgeDz), trượt ngang để cả bảng nằm trong khung (m_ScreenMargin 0.03). */
  signPos(m) {
    const info = meshInfo('sign');
    if (!info || !this.v) return null;
    const { s, ox, W } = this.v, g = this.sign;
    let x = (m.BW ?? m.W) + 0.62;
    const lo = ox + (x + info.lo[0]) * s, hi = ox + (x + info.hi[0]) * s, mg = 0.03 * W;
    let shift = 0;
    if (hi > W - mg) shift = W - mg - hi;
    if (lo + shift < mg) shift = mg - lo;
    x += shift / s;
    const k = g.shake >= 0 ? g.shake / 0.45 : 1;
    const roll = g.shake >= 0 ? Math.sin(g.shake * 40) * 9 * (1 - k) * Math.PI / 180 : 0;
    return { x, z: (this.L?.roadBottomZ ?? -1.45) - 0.7, roll, info };
  }

  signHit() {
    const p = this.signPos({ W: this.sign.W ?? 0, BW: this.sign.BW ?? this.sign.W ?? 0 });
    if (!p) return;
    const [hx, hy, hz] = p.info.hit, x = p.x + hx, y = hy, z = p.z + hz;
    this.fx.add({ kind: 'glow', x, y, z, life: 0.5, size: 1.6, alpha: 1, color: '#fff3a8' });
    for (let i = 0; i < 14; i++) {
      const a = rnd(0, TAU), sp = rnd(1.6, 3);
      this.fx.add({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0, drag: 4, life: rnd(0.35, 0.55), size: rnd(0.07, 0.13),
        color: i % 3 ? '#fff6c8' : '#ffd23f', shrink: 0.3 });
    }
  }

  drawSign(c, m) {
    const p = this.signMesh && this.signPos(m);
    if (p) {
      // chữ used/cap trên mặt bảng (SlotAmountText): khung chữ theo mặt nghiêng của bảng, chữ trắng, vòng đầy thì đỏ và đập nhẹ
      const g = this.sign, t = p.info.text, cr = Math.cos(p.roll), sr = Math.sin(p.roll);
      const rz = ([vx, vy, vz]) => [vx * cr - vy * sr, vx * sr + vy * cr, vz];
      const [cx, cy, cz] = rz(t.center), R = rz(t.right), U = rz(t.up);
      const s = this.v.s, P = this.P, [px, py] = P(p.x + cx, cy, p.z + cz);
      const [rx, ry] = P(p.x + cx + R[0], cy + R[1], p.z + cz + R[2]), [ux, uy] = P(p.x + cx + U[0], cy + U[1], p.z + cz + U[2]);
      const wR = Math.hypot(...t.right), wU = Math.hypot(...t.up);
      const used = m.loopCells(), cap = m.cap, full = cap > 0 && used >= cap;
      let sc = 1;
      if (g.pulse >= 0) { const u = g.pulse / 0.09; sc = u < 1 ? 1 + 0.18 * ease.outQuad(u) : 1 + 0.18 * (1 - ease.outQuad(u - 1)); }
      if (full) { const q = (this.clock * 2 / 0.9) % 2; sc *= 1 + 0.06 * ease.inOutSine(q < 1 ? q : 2 - q); }
      c.save();
      c.transform((rx - px) / (wR * s), (ry - py) / (wR * s), -(ux - px) / (wU * s), -(uy - py) / (wU * s), px, py);
      c.scale(sc, sc);
      const text = `${used}/${cap}`;
      c.font = `100px ${FONT}`;
      const size = Math.min(wU * 0.78, wR * 0.92 * 100 / Math.max(1, c.measureText(text).width)) * s;
      label(c, text, 0, 0, size, full ? '#ff594d' : '#ffffff');
      c.restore();
      return;
    }
    const s = this.v.s, [x, y] = this.P(m.BW + 0.62, 0, this.L.roadBottomZ - 0.7);
    const full = m.loopCells() >= m.cap, fl = this.signFlash > 0 ? Math.abs(((this.signFlash * 6) % 2) - 1) : 0;
    const i = img[full || (fl > 0.5 && this.signColor === 'red') ? 'loop_sign_full' : 'loop_sign'];
    // LoopBadge của HUD: bảng tối viền tím trên cột, nghiêng 6°.
    const w = 1.45 * s * (1 + 0.12 * fl), hgt = ok(i) ? w * ih(i) / iw(i) : w * 0.7;
    c.save(); c.translate(x, y);
    c.fillStyle = '#3a3d52'; round(c, -0.07 * s, -hgt * 0.1, 0.14 * s, 0.5 * s, 0.05 * s); c.fill();
    c.translate(0, -hgt * 0.45); c.rotate(6 * Math.PI / 180);
    if (ok(i)) c.drawImage(i, -w / 2, -hgt / 2, w, hgt); else { c.fillStyle = '#2d3046'; round(c, -w / 2, -hgt / 2, w, hgt, hgt * 0.2); c.fill(); }
    label(c, `${m.loopCells()}/${m.cap}`, 0, hgt * 0.02, hgt * 0.48, this.signColor === 'blue' && fl > 0.5 ? '#8cd9ff' : '#ffffff', null, false);
    c.restore();
  }

  drawEnd(c, m, o) {
    const { W, H, s } = this.v, k = clamp01((this.clock - this.endAt) / 0.5), big = Math.min(W / 7, s * 1.3);
    c.fillStyle = `rgba(15,15,45,${0.45 * k})`; c.fillRect(0, 0, W, H);
    if (this.endState === 'won') {
      const sc = ease.outBack(k);
      c.save(); c.translate(W / 2, H * 0.42); c.scale(sc, sc); c.rotate(Math.sin(this.clock * 2) * 0.03);
      title(c, 'WELL DONE!', 0, 0, big, '#ffd23f');
      c.restore();
      if (o.summary) label(c, o.summary, W / 2, H * 0.42 + big * 0.95, s * 0.32, '#ffffff', 'rgba(20,20,60,.75)');
    } else {
      const i = img.mascot_fail;
      if (ok(i)) { const w = Math.min(W * 0.5, s * 4) * ease.outBack(k); c.drawImage(i, W / 2 - w / 2, H * 0.36 - w * ih(i) / iw(i) / 2 - big * 0.4, w, w * ih(i) / iw(i)); }
      title(c, 'HẾT CHỖ!', W / 2, H * 0.36 + big * 1.6, big * 0.8, '#ff6b6b');
      if (o.summary) label(c, o.summary, W / 2, H * 0.36 + big * 2.5, s * 0.32, '#ffffff', 'rgba(20,20,60,.75)');
    }
  }

  /** Vùng bấm: xe trong bãi, làn (búa / editor), ô trống (editor). */
  hits(m) {
    const L = this.L, P = this.P, s = this.v.s, ids = [];
    for (const b of m.buses) {
      if (b.out || b.inGen >= 0) continue;
      const v = this.views.get(b.carId), c = v ? { x: v.x, z: v.z } : L.busCenter(b), [x, y] = P(c.x, 0.3, c.z);
      if (y < this.v.H + s * 0.5) ids.push([b.id, x, y]);
    }
    // làn: [điểm trên, điểm dưới] (px), crossway là hai khối
    const lanes = Array.from({ length: m.W }, (_, x) => [P(L.lx(x), 0, L.lTop(x) + 0.5), P(L.lx(x), 0, L.lBottom(x) - 0.5)]);
    return { ids, s, rx: L.jc * s * 0.5, ry: L.jc * s * SIN * 0.5, lanes };
  }

  drawEdit(c, m, e) {
    const P = this.P, s = this.v.s, L = this.L;
    if (e.slots) {
      // ô trống của làn (bấm để tô) và "+" cuối mỗi cột bãi (thêm xe)
      c.setLineDash([s * 0.08, s * 0.07]); c.lineWidth = Math.max(1, s * 0.025); c.strokeStyle = 'rgba(255,255,255,.55)';
      for (let x = 0; x < m.W; x++) for (let k = m.colCells(x); k < m.hs[x]; k++) {
        const z = L.lBottom(x) + k, lx = L.lx(x), [x0, y0] = P(lx - 0.36, 0, z + 0.42), [x1, y1] = P(lx + 0.36, 0, z - 0.42);
        round(c, x0, y0, x1 - x0, y1 - y0, s * 0.12); c.stroke();
      }
      c.setLineDash([]);
      for (let x = 0; x < m.jw; x++) {
        const n = m.buses.filter(b => b.x === x).length;   // model mới dựng: mọi ô của cột (kể cả xe trong máy phát)
        const p = L.jp(x, m.jh - 1 - n), [px, py] = P(p.x, 0, p.z);
        if (py > this.v.H) continue;
        c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.arc(px, py, s * 0.3, 0, TAU); c.fill();
        label(c, '+', px, py, s * 0.4, '#ffffff');
      }
    }
    if (e.lane >= 0 && e.lane < m.W) {
      const lx = L.lx(e.lane), [x0, y0] = P(lx - 0.5, 0, L.lTop(e.lane) + 0.5), [x1, y1] = P(lx + 0.5, 0, L.lBottom(e.lane) - 0.5);
      c.strokeStyle = '#ffd23f'; c.lineWidth = Math.max(2, s * 0.06); c.setLineDash([s * 0.15, s * 0.1]);
      c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.setLineDash([]);
    }
    if (e.linkFrom) {
      const b = m.buses.find(o => o.x === e.linkFrom.x && o.y === e.linkFrom.y);
      if (b) { const p = this.L.busCenter(b), [x, y] = P(p.x, 0.3, p.z); c.strokeStyle = '#ffd23f'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, s * 0.45, 0, TAU); c.stroke(); }
    }
    if (e.drag) this.drawDrag(c, m, e.drag);
  }

  /** Kéo xe trong Editor: khung ô nguồn, ô đích (vàng = thả được), xe "ma" theo con trỏ. */
  drawDrag(c, m, d) {
    const P = this.P, s = this.v.s, L = this.L;
    const cellAt = h => {
      if (!h) return null;
      if (h.kind === 'lane') { const k = Math.min(h.slot, m.colCells(h.x)); return { x: L.lx(h.x), z: L.lBottom(h.x) + k, w: 0.8, l: 0.92 }; }
      if (h.kind === 'lot') { const n = m.buses.filter(b => b.x === h.ci).length, p = L.jp(h.ci, m.jh - 1 - Math.min(h.row, n)); return { x: p.x, z: p.z, w: 0.8, l: L.jc * 0.92 }; }
      return null;
    };
    const box = (q, color, dash) => {
      const [x0, y0] = P(q.x - q.w / 2, 0, q.z + q.l / 2), [x1, y1] = P(q.x + q.w / 2, 0, q.z - q.l / 2);
      c.setLineDash(dash ? [s * 0.1, s * 0.07] : []); c.strokeStyle = color; c.lineWidth = Math.max(2, s * 0.06);
      round(c, x0, y0, x1 - x0, y1 - y0, s * 0.14); c.stroke(); c.setLineDash([]);
    };
    const a = cellAt(d.src), b = cellAt(d.dst);
    if (a) box(a, 'rgba(255,255,255,.85)', true);
    if (b) { c.fillStyle = 'rgba(255,210,63,.25)'; const [x0, y0] = P(b.x - b.w / 2, 0, b.z + b.l / 2), [x1, y1] = P(b.x + b.w / 2, 0, b.z - b.l / 2); round(c, x0, y0, x1 - x0, y1 - y0, s * 0.14); c.fill(); box(b, '#ffd23f', false); }
    // xe "ma": thân màu xe nhìn từ trên, viền trắng
    const w = 0.62 * s, l = 0.8 * s * SIN;
    c.save(); c.globalAlpha = 0.85; c.translate(d.sx, d.sy);
    c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = s * 0.2; c.shadowOffsetY = s * 0.08;
    c.fillStyle = d.car.hidden ? PALETTE['?'] : d.car.hex; round(c, -w / 2, -l / 2, w, l, s * 0.16); c.fill();
    c.shadowColor = 'transparent';
    c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(2, s * 0.04); c.stroke();
    c.fillStyle = 'rgba(30,40,70,.55)'; round(c, -w * 0.36, -l * 0.18, w * 0.72, l * 0.32, s * 0.08); c.fill();
    if (d.car.hidden) label(c, '?', 0, 0, s * 0.4, '#ffffff');
    c.restore();
  }
}

function v3set(v, p) { v.setTarget(p, p.yaw); v.teleport(); }

const inBack = t => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; };

function hexMix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = sh => Math.round(lerp(pa >> sh & 255, pb >> sh & 255, t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function label(c, text, x, y, size, color, bg = null, outline = true) {
  c.font = `${Math.round(size)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (bg) { const w = c.measureText(text).width + size; c.fillStyle = bg; round(c, x - w / 2, y - size * 0.75, w, size * 1.5, size * 0.6); c.fill(); }
  if (outline) { c.lineWidth = Math.max(2, size * 0.2); c.strokeStyle = 'rgba(20,20,60,.75)'; c.lineJoin = 'round'; c.strokeText(text, x, y); }
  c.fillStyle = color; c.fillText(text, x, y);
}

function badge(c, x, y, text, size) {
  const i = img.badge;
  if (ok(i)) c.drawImage(i, x - size / 2, y - size / 2, size, size); else { c.fillStyle = '#2c3170'; c.beginPath(); c.arc(x, y, size / 2, 0, TAU); c.fill(); }
  label(c, text, x, y + size * 0.03, size * 0.58, '#ffffff', null, false);
}

function title(c, text, x, y, size, color) {
  c.font = `${Math.round(size)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = size * 0.28; c.strokeStyle = '#3b2a6b'; c.strokeText(text, x, y + size * 0.06);
  c.lineWidth = size * 0.14; c.strokeStyle = '#ffffff'; c.strokeText(text, x, y);
  c.fillStyle = color; c.fillText(text, x, y);
}

export function round(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
