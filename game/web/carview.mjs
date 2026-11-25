// Chuyển động một xe trong màn Chơi thử: port View/CarView.cs của bản Unity (Step / UpdateBody / leg, merge, loop,
// drift, khói xả). Toạ độ thế giới (x, z) như layout.mjs; yaw radian (0 = +z, dương = quay phải); góc thân xe độ như Unity.
const DEG = 180 / Math.PI;
const CORNER_SHIFT = 0.3 * 0.6;
/** Chạy vòng liên tục cho mọi bàn (false: kiểu cũ dịch dần về chỗ). */
const USE_RING_DRIVE = true;
const RING_PULL = 3.5, RING_ACCEL = 2.5, RING_BRAKE = 9, RING_BRAKE_DIST = 0.55;
const ZONE_BACK = 0.6, ZONE_AHEAD = 0.45;
/** Bỏ (cua / dịch thường) nếu chưa thấy chỗ rẽ vào làn sau bấy nhiêu trạm. */
const EXIT_MAX_STATIONS = 3;
/** Điểm xa nhất trên tim đường mà cua nhập được nhắm tới (cửa làn cách tới ~3). */
const MERGE_REACH = 4;
export const ease = {
  outQuad: t => 1 - (1 - t) * (1 - t),
  outSine: t => Math.sin(t * Math.PI / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const sqr = v => v * v;
const wrapPi = a => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI; return a; };
const slerpYaw = (a, b, t) => a + wrapPi(b - a) * t;
const deltaDeg = (a, b) => wrapPi(b - a) * DEG;
const fwdOf = yaw => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const yawOf = (x, z) => Math.atan2(x, z);
const d2 = (a, b) => sqr(a.x - b.x) + sqr(a.z - b.z);
const bez = (a, b, c, u) => ({ x: (1 - u) * (1 - u) * a.x + 2 * u * (1 - u) * b.x + u * u * c.x, z: (1 - u) * (1 - u) * a.z + 2 * u * (1 - u) * b.z + u * u * c.z });

function spring(o, k, vk, target, stiff, damp, dt) {
  const step = 1 / 120;
  while (dt > 0) {
    const h = Math.min(dt, step);
    o[vk] += ((target - o[k]) * stiff - o[vk] * damp) * h;
    o[k] += o[vk] * h;
    dt -= h;
  }
}

function cornerLen(k) {
  let prev = k.c1, lc = 0;
  for (let j = 1; j <= 8; j++) { const p = bez(k.c1, k.i, k.c2, j / 8); lc += Math.sqrt(d2(prev, p)); prev = p; }
  return lc;
}

/** Góc lái kiểu game: thẳng tới điểm vào cua, cua bezier quanh góc, thẳng tới đích. */
function planCorner(s, f, e, fe) {
  const d = { x: e.x - s.x, z: e.z - s.z }, cross = f.x * fe.z - f.z * fe.x;
  if (Math.abs(cross) < 0.25) {
    const along = d.x * f.x + d.z * f.z;
    const off = { x: d.x - f.x * along, z: d.z - f.z * along };
    if (f.x * fe.x + f.z * fe.z < 0.9 || along <= 0 || sqr(off.x) + sqr(off.z) > 0.04 * 0.04) return null;
    return { s, f, fe: f, c1: e, i: e, c2: e, e, l1: Math.sqrt(sqr(d.x) + sqr(d.z)), lc: 0, l3: 0 };
  }
  const a = (d.x * fe.z - d.z * fe.x) / cross, b = (f.x * d.z - f.z * d.x) / cross;
  if (a < 0.03 || b < 0.03) return null;
  const r = Math.min(0.6, a, b), i = { x: s.x + f.x * a, z: s.z + f.z * a };
  const k = { s, f, fe, e, i, c1: { x: i.x - f.x * r, z: i.z - f.z * r }, c2: { x: i.x + fe.x * r, z: i.z + fe.z * r }, l1: a - r, l3: b - r, lc: 0 };
  k.lc = cornerLen(k);
  return k;
}

function cornerAt(k, t) {
  if (t <= k.l1 || k.lc + k.l3 <= 0) { const u = Math.min(t, k.l1); return { x: k.s.x + k.f.x * u, z: k.s.z + k.f.z * u, tan: k.f }; }
  t -= k.l1;
  if (t <= k.lc) {
    const u = k.lc > 0 ? t / k.lc : 1;
    const dv = { x: 2 * (1 - u) * (k.i.x - k.c1.x) + 2 * u * (k.c2.x - k.i.x), z: 2 * (1 - u) * (k.i.z - k.c1.z) + 2 * u * (k.c2.z - k.i.z) };
    const l = Math.hypot(dv.x, dv.z);
    const p = bez(k.c1, k.i, k.c2, u);
    return { x: p.x, z: p.z, tan: l > 1e-4 ? { x: dv.x / l, z: dv.z / l } : k.fe };
  }
  const u = Math.min(t - k.lc, k.l3);
  return { x: k.c2.x + k.fe.x * u, z: k.c2.z + k.fe.z * u, tan: k.fe };
}

export class CarAnim {
  /** fx: { smoke(x, y, z, o), skid(points) } của màn chơi. */
  constructor(id, o) {
    Object.assign(this, { id, len: 1, color: 'R', color2: '', lengthWorld: 1, width: 0.7, fx: null }, o);
    this.x = 0; this.z = 0; this.yaw = 0; this.tx = 0; this.tz = 0; this.tyaw = 0;
    this.maxSpeed = 12; this.follow = false; this.snap = false; this.followOn = false; this.followOff = { x: 0, z: 0 };
    this.offset = { x: 0, z: 0 };
    this.hidden = false; this.key = false; this.coc = ''; this.flash = 0; this.alpha = 1;
    this.wobble = 0; this.shake = 0; this.deny = -1; this.denyTilt = 0;
    this.squash = 0; this.squashVel = 0; this.pitch = 0; this.pitchVel = 0; this.roll = 0; this.rollVel = 0; this.lean = 0; this.leanVel = 0;
    this.hop = -1; this.hopH = 0; this.introDelay = -1; this.intro = 1;
    this.vel = { x: 0, z: 0 }; this.lastPos = { x: 0, z: 0 }; this.lastTarget = { x: 0, z: 0 };
    this.lastYaw = 0; this.moveSpeed = 0; this.accelSmooth = 0; this.yawRateSmooth = 0; this.moving = false;
    this.onLanded = null;
    this.leg = false; this.merging = false; this.braking = false; this.legK = null; this.legE = null; this.legD = 0; this.legSpeed = 0;
    this.brake = 0; this.brakeVel = 0; this.parkT = -1; this.swingT = -1; this.swingAmp = 0; this.swingLeg = 0.055; this.swingLegs = 0; this.swingYaw = 0;
    this.loopL = null; this.loopLen = 1; this.loopU = NaN; this.lastLoopU = NaN; this.carU = NaN; this.mergeU = 0; this.loopMerge = false;
    this.ringSpeed = 0; this.exitLoop = false; this.exitU = 0; this.exitRun = 0; this.zoneA = 0; this.zoneB = 0;
    // Nhường đường (controller đặt mỗi khung theo thứ tự xe vòng của model): capU = u xa nhất mũi xe được tới (NaN = không
    // giới hạn); holdJoin = xe sắp nhập chưa được cua vào đường; holdPos = chỗ nó đứng chờ (null = đứng yên).
    this.capU = NaN; this.holdJoin = false; this.holdPos = null;
    this.introDir = 1;
    this.driftYaw = 0; this.driftYawVel = 0; this.smokeT = 0; this.skidOn = false;
    this.exhaustAt = -10; this.exhaustT = -1; this.frame = 0;
    this.time = 0;
    this.body = { px: 0, py: 0, pz: 0, pitch: 0, yaw: 0, roll: 0, sx: 1, sy: 1, sz: 1, shadow: 1 };
  }

  get target() { return { x: this.tx, z: this.tz }; }
  setTarget(p, yaw) { this.tx = p.x; this.tz = p.z; if (yaw !== undefined) this.tyaw = yaw; }
  get driving() { return this.leg || this.merging; }
  get introDone() { return this.introDelay < 0 && this.intro >= 1; }
  get speed() { return this.moveSpeed; }

  punch() { this.squashVel -= 6; }
  squashIt(a = 1) { this.squashVel += 6 * a; }
  wobbleIt() { this.wobble = 1; }
  shakeIt() { this.shake = 1; }
  denyIt() { this.deny = 0; this.denyTilt = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 4); }
  hopIt(h = 0.35) { this.hop = 0; this.hopH = h; this.punch(); }
  park() { this.parkT = 0; }
  swing(amp = 14, legs = 4, legDur = 0.055) { this.swingT = 0; this.swingAmp = amp; this.swingLegs = legs; this.swingLeg = legDur; }
  introIt(delay) { this.introDelay = delay; this.intro = 0; this.introDir = 1; this.updateBody(0); }
  /** Thang máy: xe trồi lên từ dưới tấm nâng thay vì rơi xuống. */
  riseIt(delay) { this.introDelay = delay; this.intro = 0; this.introDir = -0.7; this.updateBody(0); }
  exhaust() { this.exhaustAt = this.frame; }
  exhaustBurst() { for (let i = 0; i < 4; i++) this.emitExhaust(1.6, i * 0.03); }
  setLoop(layout, u, len) { this.loopL = layout; this.loopU = u; this.loopLen = Math.max(1, len); }
  /** Ra khỏi vòng nhưng vẫn bám đích đang chạy (đường nhánh crossway): bỏ chỗ trên vòng để xe không chạy theo vòng. */
  clearLoop() { if (this.loopMerge) this.merging = false; this.loopU = NaN; this.carU = NaN; this.loopMerge = false; this.exitLoop = false; }
  get onLoop() { return this.follow && !!this.loopL && !Number.isNaN(this.loopU); }
  get isRiding() { return this.onLoop && !Number.isNaN(this.carU) && !this.loopMerge; }
  get isJoining() { return this.onLoop && (Number.isNaN(this.carU) || this.loopMerge); }
  get joinStarted() { return this.loopMerge; }
  /** Đang rời vòng vào làn, còn bám tim đường (exitU = u của mũi xe). */
  get exitingLoop() { return this.exitLoop && !!this.loopL; }

  teleport() {
    this.x = this.tx; this.z = this.tz; this.yaw = this.tyaw;
    this.vel = { x: 0, z: 0 }; this.lastPos = { x: this.x, z: this.z }; this.lastTarget = { x: this.tx, z: this.tz }; this.lastYaw = this.yaw;
    this.moving = false; this.followOff = { x: 0, z: 0 }; this.followOn = this.follow; this.accelSmooth = this.yawRateSmooth = 0;
    this.leg = this.merging = false; this.carU = NaN; this.loopMerge = false; this.exitLoop = false;
    this.driftYaw = this.driftYawVel = 0;
  }

  step(deltaTime) {
    const dt = Math.max(deltaTime, 1e-4);
    this.time += dt; this.frame++;
    const p0 = { x: this.x, z: this.z }, T = this.target;
    // Rời vòng vào làn: hình chậm hơn model nên xe có thể còn ở trước cửa làn (hay ở cạnh bên, đi ra xa làn). Bám tim đường
    // tới khi vào được làn bằng một cua gọn, thay vì đi chéo qua bàn.
    if (!this.follow && !this.snap && this.maxSpeed < 500 && this.loopL && !Number.isNaN(this.carU) && !this.exitLoop && !this.loopMerge) {
      this.exitLoop = true; this.exitU = this.carU; this.exitRun = 0; this.legSpeed = Math.max(this.moveSpeed, 1);
    }
    if (this.exitLoop && (this.follow || this.snap || this.maxSpeed >= 500)) this.exitLoop = false;
    if (!this.follow || this.snap || this.maxSpeed >= 500) { this.carU = NaN; this.loopMerge = false; }
    let moved = false;
    if (this.exitLoop && this.driveLoopExit(p0, dt)) { /* đã đi */ }
    else if (this.snap) { this.x = T.x; this.z = T.z; this.yaw = this.tyaw; this.followOn = false; }
    else if (this.follow && this.loopL && !Number.isNaN(this.loopU) && this.maxSpeed < 500) this.driveLoop(p0, dt);
    else if (this.follow && this.merging) this.driveMerge(p0, dt);
    else if (this.follow || this.maxSpeed >= 500) {
      const far = !this.followOn ? d2(T, p0) > 0.09 : d2(T, this.lastTarget) > sqr(Math.max(this.maxSpeed, 6) * 2 * dt);
      if (this.follow && this.maxSpeed < 500 && far && this.startMerge(p0)) { this.driveMerge(p0, dt); moved = true; }
      if (!moved) {
        if (!this.followOn) this.followOff = { x: p0.x - T.x, z: p0.z - T.z };
        else {
          const jx = T.x - this.lastTarget.x, jz = T.z - this.lastTarget.z;
          if (jx * jx + jz * jz > sqr(Math.max(this.maxSpeed, 6) * 2 * dt)) { this.followOff.x -= jx; this.followOff.z -= jz; }
        }
        const k = Math.exp(-9 * dt);
        this.followOff.x *= k; this.followOff.z *= k;
        if (sqr(this.followOff.x) + sqr(this.followOff.z) < 1e-6) this.followOff = { x: 0, z: 0 };
        this.x = T.x + this.followOff.x; this.z = T.z + this.followOff.z;
        this.yaw = slerpYaw(this.yaw, this.tyaw, 1 - Math.exp(-18 * dt));
        this.vel = { x: (this.x - p0.x) / dt, z: (this.z - p0.z) / dt };
        this.followOn = true;
      }
    } else if (this.planLeg(p0)) { this.followOn = false; this.driveLeg(dt); }
    else {
      this.followOn = false;
      let tv = { x: (T.x - this.lastTarget.x) / dt, z: (T.z - this.lastTarget.z) / dt };
      if (Math.hypot(tv.x, tv.z) > this.maxSpeed * 1.5) tv = { x: 0, z: 0 };
      const to = { x: T.x - p0.x, z: T.z - p0.z }, dist = Math.hypot(to.x, to.z);
      let want = { x: tv.x + to.x * 10, z: tv.z + to.z * 10 };
      const wl = Math.hypot(want.x, want.z);
      if (wl > this.maxSpeed) want = { x: want.x / wl * this.maxSpeed, z: want.z / wl * this.maxSpeed };
      const maxDelta = Math.max(this.maxSpeed, 6) * 8 * dt, dvx = want.x - this.vel.x, dvz = want.z - this.vel.z, dl = Math.hypot(dvx, dvz);
      this.vel = dl <= maxDelta ? want : { x: this.vel.x + dvx / dl * maxDelta, z: this.vel.z + dvz / dl * maxDelta };
      const sx = this.vel.x * dt, sz = this.vel.z * dt;
      if (sx * sx + sz * sz >= dist * dist) { this.x = T.x; this.z = T.z; } else { this.x = p0.x + sx; this.z = p0.z + sz; }
      this.yaw = slerpYaw(this.yaw, this.tyaw, 1 - Math.exp(-16 * dt));
    }
    this.lastTarget = { x: T.x, z: T.z };

    const v = Math.hypot(this.x - this.lastPos.x, this.z - this.lastPos.z) / dt;
    this.lastPos = { x: this.x, z: this.z };
    const yawRate = deltaDeg(this.lastYaw, this.yaw) / dt;
    this.lastYaw = this.yaw;
    const prev = this.moveSpeed;
    this.moveSpeed = lerp(this.moveSpeed, v, 1 - Math.exp(-20 * dt));
    const accel = (this.moveSpeed - prev) / Math.max(dt, 1 / 120);
    this.accelSmooth = lerp(this.accelSmooth, accel, 1 - Math.exp(-12 * dt));
    this.yawRateSmooth = lerp(this.yawRateSmooth, yawRate, 1 - Math.exp(-12 * dt));
    if (this.moveSpeed > 1.2) this.moving = true;
    else if (this.moving && this.moveSpeed < 0.25 && !this.leg && !this.merging) { this.moving = false; this.park(); this.squashIt(0.2); this.onLanded?.(this); }
    spring(this, 'brake', 'brakeVel', this.braking ? 1 : 0, 260, 22, dt);
    const pitchTarget = clamp(-this.accelSmooth * 0.35, -7, 7);
    const rollMax = this.follow ? 5 : 15;
    const rollTarget = clamp(this.yawRateSmooth * this.moveSpeed * 0.006, -rollMax, rollMax);
    const turn = clamp01(Math.abs(this.yawRateSmooth) / 240) * clamp01(this.moveSpeed / 3);
    spring(this, 'pitch', 'pitchVel', pitchTarget, 140, 10, dt);
    spring(this, 'roll', 'rollVel', rollTarget, 140, 10, dt);
    spring(this, 'lean', 'leanVel', this.follow && !this.merging ? 0 : turn * CORNER_SHIFT, 90, 12, dt);
    spring(this, 'squash', 'squashVel', 0, 320, 11, dt);
    this.updateDrift(dt);
    this.updateExhaust(dt);
    this.wobble = Math.max(0, this.wobble - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 3.5);
    this.updateBody(dt);
  }

  updateBody(dt) {
    let y = 0, introScale = 1;
    if (this.introDelay >= 0) { introScale = 0; if ((this.introDelay -= dt) < 0) this.introDelay = -1; }
    else if (this.intro < 1) {
      this.intro = Math.min(1, this.intro + dt / 0.32);
      y += (1 - ease.outQuad(this.intro)) * 1.6 * this.introDir;
      introScale = Math.min(1, this.intro * 1.6);
      if (this.intro >= 1) this.squashIt(0.9);
    }
    if (this.hop >= 0) {
      this.hop += dt / 0.28;
      if (this.hop >= 1) { this.hop = -1; this.squashIt(0.6); } else y += Math.sin(this.hop * Math.PI) * this.hopH;
    }
    let denyScale = 1, denyRoll = 0;
    if (this.deny >= 0) {
      this.deny += dt;
      const A = 0.08, B = 0.08, C = 0.1, t = this.deny, s = Math.sign(this.denyTilt);
      if (t < A) { const k = ease.outQuad(t / A); denyScale = lerp(1, 0.9, k); denyRoll = this.denyTilt * k; }
      else if (t < A + B) { const k = ease.outQuad((t - A) / B); denyScale = lerp(0.9, 1.06, k); denyRoll = lerp(this.denyTilt, -s * 6, k); }
      else if (t < A + B + C) { const k = ease.outBack((t - A - B) / C); denyScale = lerp(1.06, 1, k); denyRoll = lerp(-s * 6, 0, k); }
      else this.deny = -1;
    }
    let zs = 1 + 0.09 * clamp01(this.brake);
    if (this.parkT >= 0) {
      this.parkT += dt;
      const PA = 0.07, PB = 0.1, PC = 0.09, t = this.parkT;
      if (t < PA) zs = lerp(zs, 0.86, ease.outQuad(t / PA));
      else if (t < PA + PB) zs = lerp(0.86, 1.05, ease.outSine((t - PA) / PB));
      else if (t < PA + PB + PC) zs = lerp(1.05, 1, ease.inOutSine((t - PA - PB) / PC));
      else this.parkT = -1;
    }
    if (this.swingT >= 0) {
      this.swingT += dt;
      const i = Math.floor(this.swingT / this.swingLeg);
      if (i >= this.swingLegs) { this.swingT = -1; this.swingYaw = 0; }
      else {
        const peak = j => this.swingAmp * (j % 2 === 0 ? 1 : -1) / 1.7 ** j;
        const from = i === 0 ? 0 : peak(i - 1), to = i === this.swingLegs - 1 ? 0 : peak(i);
        this.swingYaw = lerp(from, to, ease.inOutSine(this.swingT / this.swingLeg - i));
      }
    }
    const s = clamp(this.squash, -0.35, 0.35);
    const xz = (1 + s * 0.6) * introScale * denyScale, sy = (1 - s) * introScale * denyScale;
    const wob = this.wobble > 0 ? Math.sin(this.time * 40) * this.wobble * 6 : 0;
    const sh = this.shake > 0 ? Math.sin(this.time * 60) * this.shake * 0.06 : 0;
    const b = this.body;
    b.pitch = this.pitch; b.yaw = wob + denyRoll + this.swingYaw + this.driftYaw; b.roll = this.roll;
    b.sx = xz; b.sy = sy; b.sz = xz * zs;
    // localPosition = offset + (sh, y, 0) + localRotation * forward * lean
    const ry = b.yaw / DEG, rp = b.pitch / DEG;
    const fx = Math.sin(ry) * Math.cos(rp), fy = -Math.sin(rp), fz = Math.cos(ry) * Math.cos(rp);
    b.px = this.offset.x + sh + fx * this.lean; b.py = y + fy * this.lean; b.pz = this.offset.z + fz * this.lean;
    b.shadow = introScale * clamp01(1 - y * 0.35);
    b.scale = introScale * denyScale;
    b.y = y;
  }

  planLeg(p0) {
    if (this.follow || this.maxSpeed >= 500) { this.leg = false; this.braking = false; return false; }
    if (this.leg && d2(this.target, this.legE) < 0.0025) return true;
    this.leg = false; this.braking = false;
    if (d2(this.target, p0) < 0.15 * 0.15) return false;
    const k = planCorner(p0, fwdOf(this.yaw), this.target, fwdOf(this.tyaw));
    if (!k) return false;
    this.legK = k; this.leg = true; this.legE = this.target; this.legD = 0; this.legSpeed = Math.max(this.moveSpeed, 0.5);
    return true;
  }

  driveLeg(dt) {
    const k = this.legK, len = k.l1 + k.lc + k.l3, rem = len - this.legD;
    const cruise = Math.min(this.maxSpeed, 10), brakeDist = clamp(len * 0.35, 0.3, 1.1);
    this.braking = len > 0.6 && rem < brakeDist;
    const want = this.braking ? Math.max(cruise * 0.2, cruise * Math.sqrt(rem / brakeDist)) : cruise;
    this.legSpeed += clamp(want - this.legSpeed, -cruise * 7 * dt, cruise * 7 * dt);
    this.legD = Math.min(len, this.legD + this.legSpeed * dt);
    const p = cornerAt(k, this.legD);
    if (this.legD >= len - 1e-4) {
      this.x = this.tx; this.z = this.tz; this.yaw = this.tyaw;
      this.leg = false; this.braking = false; this.vel = { x: 0, z: 0 };
      return;
    }
    this.x = p.x; this.z = p.z;
    this.yaw = slerpYaw(this.yaw, yawOf(p.tan.x, p.tan.z), 1 - Math.exp(-30 * dt));
    this.vel = { x: p.tan.x * this.legSpeed, z: p.tan.z * this.legSpeed };
  }

  startMerge(p0) {
    const f = fwdOf(this.yaw), fe = fwdOf(this.tyaw), T = this.target;
    const d = { x: T.x - p0.x, z: T.z - p0.z }, cross = f.x * fe.z - f.z * fe.x;
    if (Math.abs(cross) < 0.25) return false;
    const a = (d.x * fe.z - d.z * fe.x) / cross;
    if (a < 0.05) return false;
    const r = Math.min(0.65, a), i = { x: p0.x + f.x * a, z: p0.z + f.z * a };
    const k = { s: { ...p0 }, f, fe, i, e: T, c1: { x: i.x - f.x * r, z: i.z - f.z * r }, c2: { x: i.x + fe.x * r, z: i.z + fe.z * r }, l1: a - r, l3: 0, lc: 0 };
    k.lc = cornerLen(k);
    this.legK = k; this.merging = true; this.legD = 0; this.legSpeed = Math.max(this.moveSpeed, 1);
    return true;
  }

  driveMerge(p0, dt) {
    const k = this.legK, T = this.target;
    k.e = T;
    k.l3 = Math.max(0, (T.x - k.c2.x) * k.fe.x + (T.z - k.c2.z) * k.fe.z);
    const cruise = Math.max(this.maxSpeed * 0.75, 2);
    this.legSpeed += clamp(cruise - this.legSpeed, -cruise * 6 * dt, cruise * 6 * dt);
    this.legD += this.legSpeed * dt;
    if (this.legD >= k.l1 + k.lc + k.l3) {
      this.merging = false; this.followOn = true;
      const at = { x: k.c2.x + k.fe.x * k.l3, z: k.c2.z + k.fe.z * k.l3 };
      this.followOff = { x: at.x - T.x, z: at.z - T.z };
      this.x = at.x; this.z = at.z;
      this.yaw = slerpYaw(this.yaw, this.tyaw, 1 - Math.exp(-30 * dt));
      this.vel = { x: (this.x - p0.x) / dt, z: (this.z - p0.z) / dt };
      return;
    }
    const p = cornerAt(k, this.legD);
    this.x = p.x; this.z = p.z;
    this.yaw = slerpYaw(this.yaw, yawOf(p.tan.x, p.tan.z), 1 - Math.exp(-30 * dt));
    this.vel = { x: p.tan.x * this.legSpeed, z: p.tan.z * this.legSpeed };
    this.followOn = true;
  }

  // ---- đường vòng: xe giữ tham số u trên tim đường và dịch dần về chỗ của mình (như SplineAnimate của game mẫu) ----
  wrapU(d) {
    const n = Math.max(1, this.loopL.stations);
    d %= n;
    if (d > n / 2) d -= n; else if (d < -n / 2) d += n;
    return d;
  }

  projectU(p, around, back, ahead) {
    let best = around, bd = Infinity;
    for (let u = around - back; u <= around + ahead; u += 0.02) {
      const q = this.loopL.loopAt(u), d = d2(q, p);
      if (d < bd) { bd = d; best = u; }
    }
    return { u: best, dist: Math.sqrt(bd) };
  }

  driveLoop(p0, dt) {
    if (this.loopMerge) { if (this.driveLoopCorner(p0, dt)) return; }
    else if (Number.isNaN(this.carU)) {
      // u mũi của xe có thân giữa ở điểm chiếu (xe dài trải len-1 trạm).
      const pr = this.projectU(p0, this.loopU - (this.loopLen - 1) / 2, 6, 1.5);
      if (pr.dist > 0.12) {
        // Game gốc: xe sắp nhập đứng chờ (cửa làn / lề đường) tới khi đoạn đường ở điểm nhập trống.
        if (this.holdJoin) { this.holdJoinStep(p0, dt); return; }
        if (this.startLoopMerge(p0) && this.driveLoopCorner(p0, dt)) return;
      }
      if (Number.isNaN(this.carU)) { this.carU = pr.u + (this.loopLen - 1) / 2; this.lastLoopU = this.loopU; this.ringSpeed = this.moveSpeed; }
    }
    if (USE_RING_DRIVE) { this.driveRing(p0, dt); return; }
    const L = this.loopL, adv = this.wrapU(this.loopU - this.lastLoopU), per = Math.max(0.01, L.spacing);
    const maxStep = Math.max(this.maxSpeed, 6) * 2 * dt / per;
    const off = Math.abs(adv) > maxStep ? this.wrapU(this.carU - this.loopU) : this.wrapU(this.carU - this.lastLoopU);
    this.lastLoopU = this.loopU;
    const catchUp = Math.max(this.maxSpeed, 6) / per * dt;
    const eased = clamp(off * Math.exp(-9 * dt), off - catchUp, off + catchUp);
    let next = this.loopU + eased;
    if (this.wrapU(next - this.carU) < 0) next = this.carU;
    // Phanh sau xe phía trước / xe đang nhập phía trước.
    if (!Number.isNaN(this.capU) && this.wrapU(next - this.capU) > 0) next = this.wrapU(this.capU - this.carU) > 0 ? this.capU : this.carU;
    this.carU = next;
    const pose = L.bodyOnLoop(this.carU, this.loopLen);
    this.x = pose.x; this.z = pose.z; this.yaw = pose.yaw;
    this.vel = { x: (this.x - p0.x) / dt, z: (this.z - p0.z) / dt };
    this.followOn = true; this.merging = false;
  }

  // ---- chạy vòng liên tục (UpdateRingTraffic của game gốc: mỗi xe chạy trên spline với tốc độ thật). Xe giữ tốc độ theo
  // đơn vị thế giới dọc tim đường; tốc độ muốn = tốc độ của chỗ (slot) cộng lực kéo về chỗ; xe trước giới hạn bằng hãm
  // tuyến tính; đổi tốc có giới hạn nên không giật khi model giữ xe hay trạm dày / thưa. ----
  ringDelta(uA, uB) {
    const L = this.loopL, per = L.perimeter;
    let d = (L.distOf(uA) - L.distOf(uB)) % per;
    if (d > per / 2) d -= per; else if (d < -per / 2) d += per;
    return d;
  }

  driveRing(p0, dt) {
    const L = this.loopL, baseV = Math.max(0.5, this.maxSpeed / 2.2);   // controller đặt maxSpeed = tốc độ vòng × 2.2
    const slotV = clamp(this.ringDelta(this.loopU, this.lastLoopU) / dt, 0, baseV * 3);
    this.lastLoopU = this.loopU;
    const err = this.ringDelta(this.loopU, this.carU);   // + = chỗ ở phía trước
    let want = clamp(slotV + err * RING_PULL, 0, baseV * (err > 2 ? 1.8 : 1.45));
    if (err < -0.02) want = Math.min(want, Math.max(0, slotV * 0.6));   // tới sớm: để chỗ tự tới
    if (!Number.isNaN(this.capU)) {
      const room = this.ringDelta(this.capU, this.carU);
      want = Math.min(want, room <= 0 ? 0 : baseV * clamp01(room / RING_BRAKE_DIST) * 1.2);
    }
    const rate = (want > this.ringSpeed ? RING_ACCEL : RING_BRAKE) * baseV;
    this.ringSpeed += clamp(want - this.ringSpeed, -rate * dt, rate * dt);
    let step = this.ringSpeed * dt;
    if (!Number.isNaN(this.capU)) step = Math.min(step, Math.max(0, this.ringDelta(this.capU, this.carU)));
    this.carU = L.uOfDist(L.distOf(this.carU) + step);
    const pose = L.bodyOnLoop(this.carU, this.loopLen);
    this.x = pose.x; this.z = pose.z; this.yaw = pose.yaw;
    this.vel = { x: (this.x - p0.x) / dt, z: (this.z - p0.z) / dt };
    this.followOn = true; this.merging = false;
  }

  /** Một cua cố định từ hướng xe vào tim đường vòng, ở chỗ hướng xe gặp đường. */
  startLoopMerge(p0) {
    const f = fwdOf(this.yaw), j = this.findJunction(p0, f);
    if (!j) return this.startLoopCurve(p0, f);
    const { bu, fe, a, r } = j, i = { x: p0.x + f.x * a, z: p0.z + f.z * a };
    const k = { s: { ...p0 }, f, fe, i, c1: { x: i.x - f.x * r, z: i.z - f.z * r }, c2: { x: i.x + fe.x * r, z: i.z + fe.z * r }, l1: a - r, l3: 0, lc: 0 };
    k.e = k.c2; k.lc = cornerLen(k);
    this.legK = k; this.merging = true; this.loopMerge = true; this.legD = 0; this.legSpeed = Math.max(this.moveSpeed, 1);
    this.mergeU = bu;
    this.setZone(bu, r);
    return true;
  }

  /** Chỗ hướng xe gặp tim đường gần chỗ của chính nó (bu), hướng đường ở đó, khoảng cách theo hướng xe và bán kính cua;
   * null khi không vừa một cua 1/4 gọn (dùng đường cong thay). Chỉ tìm gần chỗ của xe: tìm rộng thì xe đang xếp hàng
   * quay ngang nhắm vào phía bên kia vòng và cắt qua bàn. */
  findJunction(s, f) {
    const L = this.loopL;
    let bu = NaN, bd = Infinity;
    for (let u = this.loopU - (this.loopLen - 1) - 8; u <= this.loopU + 1.5; u += 0.05) {
      const q = L.loopAt(u), dq = { x: q.x - s.x, z: q.z - s.z };
      if (dq.x * f.x + dq.z * f.z < 0.05 || dq.x * dq.x + dq.z * dq.z > MERGE_REACH * MERGE_REACH) continue;
      const side = Math.abs(dq.x * f.z - dq.z * f.x);
      if (side < bd) { bd = side; bu = u; }
    }
    if (Number.isNaN(bu) || bd > 0.3) return null;
    const at = L.loopAt(bu), fe = fwdOf(at.yaw), cross = f.x * fe.z - f.z * fe.x;
    if (Math.abs(cross) < 0.25) return null;
    const d = { x: at.x - s.x, z: at.z - s.z }, a = (d.x * fe.z - d.z * fe.x) / cross;
    if (a < 0.05) return null;
    // Xe ra làn bắt đầu trong làn nên cua vào đường được một góc 1/4 đầy đủ.
    return { bu, fe, a, r: Math.min(0.85, a) };
  }

  setZone(junctionU, r) {
    const land = junctionU + r / Math.max(0.01, this.loopL.spacing);
    this.zoneA = junctionU - ZONE_BACK;
    this.zoneB = land + (this.loopLen - 1) / 2 + ZONE_AHEAD;
  }

  /** Đoạn đường (u trên vòng) xe đang nhập quét qua khi cua vào; null khi không nhập. */
  joinZone() {
    if (!this.isJoining) return null;
    if (!this.loopMerge) {
      const j = this.findJunction({ x: this.x, z: this.z }, fwdOf(this.yaw));
      if (j) this.setZone(j.bu, j.r);
      else {
        const uE = this.loopU - (this.loopLen - 1) / 2;
        this.zoneA = uE - (this.loopLen - 1) / 2 - 0.8; this.zoneB = uE + (this.loopLen - 1) / 2 + ZONE_AHEAD;
      }
    }
    return { a: this.zoneA, b: this.zoneB };
  }

  holdJoinStep(p0, dt) {
    if (this.holdPos) {
      const dx = this.holdPos.x - p0.x, dz = this.holdPos.z - p0.z, l = Math.hypot(dx, dz), st = Math.max(this.maxSpeed * 0.5, 2) * dt;
      if (l <= st) { this.x = this.holdPos.x; this.z = this.holdPos.z; } else { this.x = p0.x + dx / l * st; this.z = p0.z + dz / l * st; }
    }
    this.vel = { x: (this.x - p0.x) / dt, z: (this.z - p0.z) / dt };
    this.followOn = true;
  }

  /** Bám tim đường từ chỗ rời vòng tới khi vào được làn đích bằng một cua bắt đầu ngay đó; false khi xong / bỏ. */
  driveLoopExit(p0, dt) {
    const L = this.loopL, per = Math.max(0.01, L.spacing), T = this.target;
    for (let pass = 0; pass < 2; pass++) {
      const pose = L.bodyOnLoop(this.exitU, this.loopLen), s = { x: pose.x, z: pose.z };
      const f = fwdOf(pose.yaw), fe = fwdOf(this.tyaw), cross = f.x * fe.z - f.z * fe.x;
      if (Math.abs(cross) > 0.85) {
        const d = { x: T.x - s.x, z: T.z - s.z };
        const a = (d.x * fe.z - d.z * fe.x) / cross, b = (f.x * d.z - f.z * d.x) / cross;
        const k = a >= 0.03 && a <= 0.62 && b > 0.03 ? planCorner(s, f, T, fe) : null;
        if (k) {
          this.exitLoop = false;
          this.x = s.x; this.z = s.z; this.yaw = pose.yaw;
          this.legK = k; this.leg = true; this.legE = { ...T }; this.legD = 0; this.legSpeed = Math.max(this.legSpeed, 1);
          this.followOn = false;
          this.driveLeg(dt);
          return true;
        }
      }
      if (pass === 1) break;
      if (this.exitRun >= EXIT_MAX_STATIONS) { this.exitLoop = false; return false; }
      const cruise = Math.max(this.maxSpeed * 0.6, 2);
      this.legSpeed += clamp(cruise - this.legSpeed, -cruise * 6 * dt, cruise * 6 * dt);
      const du = Math.min(this.legSpeed * dt / per, 0.25);
      this.exitU += du; this.exitRun += du;
      const np = L.bodyOnLoop(this.exitU, this.loopLen);
      this.x = np.x; this.z = np.z; this.yaw = np.yaw;
      this.vel = { x: (this.x - p0.x) / dt, z: (this.z - p0.z) / dt };
      this.followOn = false;
    }
    return true;
  }

  /** Nhập dự phòng (StartConveyorEntryMerge của game gốc): một đường cong mượt từ hướng xe tới điểm của chỗ nó trên tim
   * đường, tiếp tuyến với đường ở đó, nên xe không nhảy lên đường hay nhắm qua bàn. */
  startLoopCurve(s, f) {
    const L = this.loopL, uE = this.loopU - (this.loopLen - 1) / 2, at = L.loopAt(uE);
    const e = { x: at.x, z: at.z }, fe = fwdOf(at.yaw), dist = Math.hypot(e.x - s.x, e.z - s.z);
    if (dist < 0.05 || dist > 4 * MERGE_REACH) return false;
    const h = dist * 0.5;
    const k = { s: { ...s }, f, fe, c1: { ...s }, c2: e, e, l1: 0, l3: 0, lc: 0 };
    k.i = { x: ((s.x + f.x * h) + (e.x - fe.x * h)) / 2, z: ((s.z + f.z * h) + (e.z - fe.z * h)) / 2 };
    let prev = k.c1;
    for (let j = 1; j <= 12; j++) { const q = bez(k.c1, k.i, k.c2, j / 12); k.lc += Math.sqrt(d2(prev, q)); prev = q; }
    this.legK = k; this.merging = true; this.loopMerge = true; this.legD = 0; this.legSpeed = Math.max(this.moveSpeed, 1);
    this.mergeU = uE;
    this.zoneA = uE - (this.loopLen - 1) / 2 - 0.8; this.zoneB = uE + (this.loopLen - 1) / 2 + ZONE_AHEAD;
    return true;
  }

  driveLoopCorner(p0, dt) {
    const k = this.legK, cruise = Math.max(this.maxSpeed * 0.55, 1.5);
    this.legSpeed += clamp(cruise - this.legSpeed, -cruise * 6 * dt, cruise * 6 * dt);
    this.legD += this.legSpeed * dt;
    if (this.legD >= k.l1 + k.lc + k.l3) {
      this.loopMerge = false; this.merging = false;
      this.carU = this.projectU(k.c2, this.mergeU, 0.5, 2).u + (this.loopLen - 1) / 2;
      this.lastLoopU = this.loopU; this.ringSpeed = this.legSpeed;
      return false;
    }
    const p = cornerAt(k, this.legD);
    this.x = p.x; this.z = p.z; this.yaw = yawOf(p.tan.x, p.tan.z);
    this.vel = { x: p.tan.x * this.legSpeed, z: p.tan.z * this.legSpeed };
    this.followOn = true;
    return true;
  }

  // ---- drift: trượt đuôi khi cua vào làn / nhập đường, vệt bánh + khói ----
  updateDrift(dt) {
    const k = this.legK;
    let drifting = false, sign = 0, turnK = 0;
    if (k && (this.leg || this.merging)) {
      const cornerEnd = this.merging ? k.l1 + k.lc * 0.55 : k.l1 + k.lc + 0.2;
      const corner = k.lc > 0.05 && this.legD > k.l1 - 0.05 && this.legD < cornerEnd;
      // Theo độ gắt của cua: cua gần thẳng (xe nhánh crossway nhập vòng) không trượt.
      const ang = Math.acos(clamp(k.f.x * k.fe.x + k.f.z * k.fe.z, -1, 1)) * DEG;
      turnK = clamp01((ang - 20) / 50);
      drifting = corner && this.moveSpeed > 1.2 && turnK > 0;
      sign = Math.sign(k.f.z * k.fe.x - k.f.x * k.fe.z);   // Vector3.Cross(f, fe).y
    }
    spring(this, 'driftYaw', 'driftYawVel', drifting ? sign * (this.merging ? 14 : 24) * turnK : 0, 160, this.merging || this.follow ? 26 : 14, dt);
    this.skidOn = drifting || (this.leg && this.braking && k && k.l1 + k.lc + k.l3 > 1.2);
    if (this.skidOn) this.fx?.skid(this, this.skidPoints());
    if (!drifting || dt <= 0) return;
    if ((this.smokeT -= dt) > 0) return;
    this.smokeT = 0.035;
    for (const p of this.skidPoints()) {
      this.fx?.smoke(p.x + (Math.random() - 0.5) * 0.08, 0.02, p.z + (Math.random() - 0.5) * 0.08,
        { size: 0.14 + Math.random() * 0.1, life: 0.3 + Math.random() * 0.15, alpha: 0.6 });
    }
  }

  skidPoints() {
    const f = fwdOf(this.yaw), r = { x: f.z, z: -f.x }, back = -this.lengthWorld * 0.32;
    return [-1, 1].map(s => ({ x: this.x + r.x * s * this.width * 0.3 + f.x * back, z: this.z + r.z * s * this.width * 0.3 + f.z * back }));
  }

  emitExhaust(power, lead = 0) {
    const f = fwdOf(this.yaw), r = { x: f.z, z: -f.x }, back = this.lengthWorld / 2 + 0.03 + lead;
    const sp = (0.25 + Math.random() * 0.2) * power, side = (Math.random() - 0.5) * 0.1;
    this.fx?.smoke(this.x - f.x * back + r.x * this.width * 0.2, 0.12, this.z - f.z * back + r.z * this.width * 0.2, {
      vx: -f.x * sp + r.x * side, vy: 0.05, vz: -f.z * sp + r.z * side,
      size: (0.09 + Math.random() * 0.05) * Math.sqrt(power), life: 0.45 + Math.random() * 0.2, alpha: 0.55, tint: '#ebedff',
    });
  }

  updateExhaust(dt) {
    if (dt <= 0 || this.frame - this.exhaustAt > 1 || !this.introDone || this.hidden || this.moving) { this.exhaustT = -1; return; }
    if (this.exhaustT < 0) this.exhaustT = 0.1 + Math.random() * 0.8;
    if ((this.exhaustT -= dt) > 0) return;
    this.emitExhaust(1);
    if (Math.random() < 0.5) this.emitExhaust(0.8, 0.04);
    this.exhaustT = 0.5 + Math.random() * 0.5;
  }
}
