// Vẽ xe bằng model 3D của game (art/car_mesh.json, xuất bằng game/tools/unity_art.mjs) trên một canvas WebGL trong suốt.
// Camera, ánh sáng, vật liệu theo scene Gameplay của bản Unity: camera trực giao nghiêng 72°, đèn chính Euler(55,-35)
// 1.15, đèn phụ Euler(40,140) 0.45, ánh sáng nền phẳng (0.55, 0.58, 0.62), shader URP Lit (BRDF của URP, không bóng đổ).
export const PITCH = 72 * Math.PI / 180, SIN = Math.sin(PITCH), COS = Math.cos(PITCH);
const DEG = Math.PI / 180;

// Project Unity để Gamma color space (m_ActiveColorSpace 0): ánh sáng tính thẳng trên màu sRGB, không chuyển tuyến tính.
const toLin = c => c;
export const hexRgb = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
function lightDir(ex, ey) {
  // hướng tới đèn = -(Quaternion.Euler(ex, ey, 0) * forward)
  const x = Math.cos(ex * DEG) * Math.sin(ey * DEG), y = -Math.sin(ex * DEG), z = Math.cos(ex * DEG) * Math.cos(ey * DEG);
  return [-x, -y, -z];
}
const L1 = lightDir(55, -35), L2 = lightDir(40, 140);
const C1 = [1, 0.97, 0.92].map(c => toLin(c) * 1.15), C2 = [0.8, 0.87, 1].map(c => toLin(c) * 0.45);
const AMB = [0.55, 0.58, 0.62].map(toLin);

const VS = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform mat4 uM; uniform mat3 uN; uniform vec4 uView; uniform vec2 uSize;
varying vec3 vN;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vN = uN * aNrm;
  float sx = uView.y + w.x * uView.x;
  float sy = uView.z - (w.z * ${SIN.toFixed(6)} + w.y * ${COS.toFixed(6)}) * uView.x;
  float d = -w.y * ${SIN.toFixed(6)} + w.z * ${COS.toFixed(6)};
  gl_Position = vec4(sx / uSize.x * 2.0 - 1.0, 1.0 - sy / uSize.y * 2.0, clamp(d / 400.0, -1.0, 1.0), 1.0);
}`;
const v3 = a => `vec3(${a.map(n => n.toFixed(5)).join(',')})`;
const FS = `
precision mediump float;
uniform vec3 uAlbedo; uniform vec3 uEmit; uniform float uRough; uniform float uAlpha;
varying vec3 vN;
const vec3 L1 = normalize(${v3(L1)}); const vec3 L2 = normalize(${v3(L2)});
const vec3 C1 = ${v3(C1)}; const vec3 C2 = ${v3(C2)}; const vec3 AMB = ${v3(AMB)};
const vec3 V = vec3(0.0, ${SIN.toFixed(6)}, ${(-COS).toFixed(6)});
float spec(vec3 n, vec3 l) {
  vec3 h = normalize(l + V);
  float nh = max(dot(n, h), 0.0), lh = max(dot(l, h), 0.0);
  float r2 = uRough * uRough, d = nh * nh * (r2 - 1.0) + 1.00001;
  return 0.04 * r2 / (d * d * max(lh * lh, 0.1) * (uRough * 4.0 + 2.0));
}
void main() {
  vec3 n = normalize(vN);
  float n1 = max(dot(n, L1), 0.0), n2 = max(dot(n, L2), 0.0);
  vec3 dif = uAlbedo * 0.96;
  vec3 col = dif * AMB + (dif + spec(n, L1)) * C1 * n1 + (dif + spec(n, L2)) * C2 * n2 + uEmit;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * uAlpha, uAlpha);
}`;

let meshData = null, meshLoading = null;
export function loadCarMesh(url) {
  meshLoading ??= fetch(url).then(r => r.json()).then(j => { meshData = j; return j; }).catch(() => null);
  return meshLoading;
}

/** Mesh phụ (bảng đếm vòng…): đã nướng transform, gốc ở chân. */
const extra = new Map(), extraLoading = new Map();
export function loadMesh(name, url) {
  if (!extraLoading.has(name)) extraLoading.set(name, fetch(url).then(r => r.json()).then(j => { extra.set(name, j); return j; }).catch(() => null));
  return extraLoading.get(name);
}
export const meshInfo = name => extra.get(name) || null;

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ---- ma trận 4x4 cột (như WebGL) ----
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const RX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const RY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const RZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
/** Quaternion.Euler(x, y, z) của Unity (độ): Ry * Rx * Rz. */
const euler = (x, y, z) => mul(RY(y * DEG), mul(RX(x * DEG), RZ(z * DEG)));
function normalMat(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // (M^-1)^T
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}

export class CarRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    this.ok = !!this.gl;
    this.fits = new Map();
  }

  get ready() { return this.ok && !!meshData && this.init(); }

  init() {
    if (this.prog) return true;
    const gl = this.gl, m = meshData;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { this.ok = false; return false; }
    this.prog = p;
    this.loc = Object.fromEntries(['uM', 'uN', 'uView', 'uSize', 'uAlbedo', 'uEmit', 'uRough', 'uAlpha'].map(n => [n, gl.getUniformLocation(p, n)]));
    this.aPos = gl.getAttribLocation(p, 'aPos'); this.aNrm = gl.getAttribLocation(p, 'aNrm');
    const pos = new Float32Array(b64(m.pos).buffer), nrm = new Int8Array(b64(m.nrm).buffer), idx = new Uint16Array(b64(m.idx).buffer);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    this.nbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.nbo); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
    this.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const cp = [], cn = [], ci = [];
    for (const [ax, sg] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const b = cp.length / 3, u = (ax + 1) % 3, v = (ax + 2) % 3;
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0]; p[ax] = sg * 0.5; p[u] = a * 0.5; p[v] = c * 0.5;
        const nn = [0, 0, 0]; nn[ax] = sg * 127;
        cp.push(...p); cn.push(...nn);
      }
      ci.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.cvbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cvbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cp), gl.STATIC_DRAW);
    this.cnbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cnbo); gl.bufferData(gl.ARRAY_BUFFER, new Int8Array(cn), gl.STATIC_DRAW);
    this.cibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ci), gl.STATIC_DRAW);
    this.subs = m.subs.map(s => ({ ...s, lin: s.color.map(toLin), emit: s.emission.map(toLin), rough: Math.max((1 - s.smoothness) ** 2, 0.0078) }));
    this.size = m.size; this.carWidth = m.car.width; this.uniform = m.car.uniformScale;
    return true;
  }

  /** Buffer của mesh phụ (tạo lần đầu dùng). */
  extraMesh(name) {
    this.extras ??= new Map();
    let e = this.extras.get(name);
    if (e) return e;
    const j = extra.get(name);
    if (!j || !this.ready) return null;
    const gl = this.gl, buf = (t, a) => { const b = gl.createBuffer(); gl.bindBuffer(t, b); gl.bufferData(t, a, gl.STATIC_DRAW); return b; };
    e = {
      v: buf(gl.ARRAY_BUFFER, new Float32Array(b64(j.pos).buffer)), n: buf(gl.ARRAY_BUFFER, new Int8Array(b64(j.nrm).buffer)),
      i: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(b64(j.idx).buffer)),
      subs: j.subs.map(s => ({ ...s, rough: Math.max((1 - s.smoothness) ** 2, 0.0078) })),
    };
    this.extras.set(name, e);
    this.bound = '';
    return e;
  }

  /** Vẽ mesh phụ tại (x, y, z), quay roll (rad, quanh trục z của vật như Sign-Content), phóng scale. */
  drawMesh(name, o) {
    const e = this.extraMesh(name);
    if (!e) return false;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, e.v); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, e.n); gl.vertexAttribPointer(this.aNrm, 3, gl.BYTE, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e.i);
    this.bound = name;
    let M = mul(T(o.x, o.y || 0, o.z), RZ(o.roll || 0));
    if (o.scale && o.scale !== 1) M = mul(M, S(o.scale, o.scale, o.scale));
    gl.uniformMatrix4fv(this.loc.uM, false, new Float32Array(M));
    gl.uniformMatrix3fv(this.loc.uN, false, new Float32Array(normalMat(M)));
    gl.uniform1f(this.loc.uAlpha, 1);
    gl.uniform3f(this.loc.uEmit, 0, 0, 0);
    for (const s of e.subs) {
      gl.uniform3f(this.loc.uAlbedo, s.color[0], s.color[1], s.color[2]);
      gl.uniform1f(this.loc.uRough, s.rough);
      gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_SHORT, s.start * 2);
    }
    return true;
  }

  /** Tỉ lệ mesh → kích thước xe (CarView.AddModel): rộng carWidth, dài lengthWorld, xe 1 ô giữ tỉ lệ. */
  fit(lengthWorld, len) {
    const key = `${lengthWorld.toFixed(3)}:${len}`;
    let f = this.fits.get(key);
    if (!f) {
      const [X, , Z] = this.size, sz = lengthWorld / Z, sx = this.carWidth / X;
      if (len === 1 && this.uniform) { const k = Math.min(sz, sx * 1.15); f = [k, k, k]; } else { const s1 = Math.min(sx, sz); f = [s1, s1, sz]; }
      this.fits.set(key, f);
    }
    return f;
  }

  /** view: { w, h (px thiết bị), s (px / đơn vị), ox, oy (px của gốc thế giới) }. */
  begin(view) {
    const gl = this.gl, c = this.canvas;
    if (c.width !== view.w || c.height !== view.h) { c.width = view.w; c.height = view.h; }
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.ready) return false;
    gl.useProgram(this.prog);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enableVertexAttribArray(this.aPos); gl.enableVertexAttribArray(this.aNrm);
    this.bound = '';
    gl.uniform4f(this.loc.uView, view.s, view.ox, view.oy, 0);
    gl.uniform2f(this.loc.uSize, c.width, c.height);
    this.view = view;
    return true;
  }

  /**
   * Một xe. o: { x, z, yaw (rad), body: { px, py, pz, pitch, yaw, roll (độ), sx, sy, sz }, lengthWorld, len,
   * color '#rrggbb', flash 0..1, alpha }.
   */
  bind(which) {
    if (this.bound === which) return;
    const gl = this.gl, car = which === 'car';
    gl.bindBuffer(gl.ARRAY_BUFFER, car ? this.vbo : this.cvbo); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, car ? this.nbo : this.cnbo); gl.vertexAttribPointer(this.aNrm, 3, gl.BYTE, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, car ? this.ibo : this.cibo);
    this.bound = which;
  }

  /** Khối hộp có ánh sáng (như ParkingUtil.Prim Cube của game). o: { x, y, z (tâm), sx, sy, sz, yaw, color, alpha, rough }. */
  box(o) {
    const gl = this.gl;
    this.bind('box');
    let M = mul(T(o.x, o.y, o.z), RY(o.yaw || 0));
    if (o.roll) M = mul(M, RZ(o.roll));
    M = mul(M, S(o.sx, o.sy, o.sz));
    gl.uniformMatrix4fv(this.loc.uM, false, new Float32Array(M));
    gl.uniformMatrix3fv(this.loc.uN, false, new Float32Array(normalMat(M)));
    const c = typeof o.color === 'string' ? hexRgb(o.color) : o.color;
    gl.uniform1f(this.loc.uAlpha, o.alpha ?? 1);
    gl.uniform3f(this.loc.uAlbedo, toLin(c[0]), toLin(c[1]), toLin(c[2]));
    gl.uniform3f(this.loc.uEmit, 0, 0, 0);
    gl.uniform1f(this.loc.uRough, o.rough ?? 0.42);
    if ((o.alpha ?? 1) < 1) gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
  }

  draw(o) {
    const gl = this.gl, b = o.body || {};
    this.bind('car');
    const f = this.fit(o.lengthWorld, o.len || 1);
    let M = mul(T(o.x, o.y || 0, o.z), RY(o.yaw));
    M = mul(M, T(b.px || 0, b.py || 0, b.pz || 0));
    M = mul(M, euler(b.pitch || 0, b.yaw || 0, b.roll || 0));
    M = mul(M, S((b.sx ?? 1) * f[0], (b.sy ?? 1) * f[1], (b.sz ?? 1) * f[2]));
    if (o.zOff) M = mul(M, T(0, 0, o.zOff / f[2]));
    gl.uniformMatrix4fv(this.loc.uM, false, new Float32Array(M));
    gl.uniformMatrix3fv(this.loc.uN, false, new Float32Array(normalMat(M)));
    const alpha = o.alpha ?? 1;
    gl.uniform1f(this.loc.uAlpha, alpha);
    let body = hexRgb(o.color || '#9a9fb8');
    if (o.flash) body = body.map(c => c + (1 - c) * o.flash);
    for (const s of this.subs) {
      const base = s.body ? body : s.color;
      const k = 1;
      gl.uniform3f(this.loc.uAlbedo, toLin(base[0]) * k, toLin(base[1]) * k, toLin(base[2]) * k);
      gl.uniform3f(this.loc.uEmit, s.emit[0] * k, s.emit[1] * k, s.emit[2] * k);
      gl.uniform1f(this.loc.uRough, s.rough);
      gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_SHORT, s.start * 2);
    }
  }
}
