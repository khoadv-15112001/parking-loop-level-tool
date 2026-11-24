// Đọc model xe 3D của bản Unity (Prefabs/Car.prefab → mesh .asset dạng YAML) và ghi game/web/art/car_mesh.json cho
// màn Chơi thử (game/web/carmesh.mjs vẽ bằng WebGL, cùng góc camera / ánh sáng với game). Gọi từ unity_art.mjs.
import fs from 'node:fs';
import path from 'node:path';

const guidIndex = new Map();
function indexGuids(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) indexGuids(p);
    else if (e.name.endsWith('.meta')) {
      const m = /^guid: ([0-9a-f]{32})/m.exec(fs.readFileSync(p, 'utf8'));
      if (m) guidIndex.set(m[1], p.slice(0, -5));
    }
  }
}

const num = (s, k) => Number(new RegExp(`${k}: ([-0-9.eE]+)`).exec(s)[1]);
const vec = (s, k) => { const m = new RegExp(`${k}: \\{x: ([-0-9.eE]+), y: ([-0-9.eE]+), z: ([-0-9.eE]+)(?:, w: ([-0-9.eE]+))?\\}`).exec(s); return m.slice(1).filter(v => v !== undefined).map(Number); };
const hex = h => Buffer.from(h.trim(), 'hex');

function rotQ([x, y, z, w], [vx, vy, vz]) {
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
// Unity Quaternion.Euler(0, a, 0): x' = x cos a + z sin a, z' = -x sin a + z cos a
const yaw = (a, [x, y, z]) => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; };
const color = (mat, k) => { const m = new RegExp(`- ${k}: \\{r: ([-0-9.eE]+), g: ([-0-9.eE]+), b: ([-0-9.eE]+)`).exec(mat); return m ? m.slice(1).map(Number) : [0, 0, 0]; };

export function exportCarMesh(repo, outFile) {
  const assets = path.join(repo, 'Assets');
  indexGuids(path.join(assets, '_Game'));
  const prefab = fs.readFileSync(path.join(assets, '_Game/Prefabs/Car.prefab'), 'utf8');
  const cfg = fs.readFileSync(path.join(assets, '_Game/Resources/ParkingGameConfig.asset'), 'utf8');
  const yawOffset = num(cfg, 'modelYawOffset') * Math.PI / 180;
  // Transform của Car-Mesh (con duy nhất có MeshFilter) + vật liệu theo thứ tự submesh.
  const tr = prefab.slice(prefab.indexOf('m_Name: Car-Mesh'));
  const q = vec(tr, 'm_LocalRotation'), scale = vec(tr, 'm_LocalScale');
  const meshGuid = /m_Mesh: \{fileID: \d+, guid: ([0-9a-f]{32})/.exec(prefab)[1];
  const mats = [...prefab.slice(prefab.indexOf('m_Materials:')).matchAll(/- \{fileID: 2100000, guid: ([0-9a-f]{32})/g)].map(m => m[1]);
  const mesh = fs.readFileSync(guidIndex.get(meshGuid), 'utf8');

  const n = num(mesh, 'm_VertexCount'), size = num(mesh, 'm_DataSize');
  const stride = size / n;
  const chans = [...mesh.slice(mesh.indexOf('m_Channels:')).matchAll(/- stream: (\d+)\s+offset: (\d+)\s+format: (\d+)\s+dimension: (\d+)/g)].map(m => m.slice(1).map(Number));
  const [pos, nrm] = chans;   // kênh 0 = vị trí, 1 = pháp tuyến (float32 x3)
  if (pos[2] !== 0 || nrm[2] !== 0 || pos[3] !== 3 || nrm[3] !== 3) throw new Error('mesh xe: định dạng đỉnh không hỗ trợ');
  const data = hex(/_typelessdata: ([0-9a-f]+)/.exec(mesh)[1]);
  const index = hex(/m_IndexBuffer: ([0-9a-f]+)/.exec(mesh)[1]);
  if (/m_IndexFormat: 1/.test(mesh)) throw new Error('mesh xe: chỉ số 32 bit chưa hỗ trợ');

  const P = new Float32Array(n * 3), N = new Int8Array(n * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    let p = [0, 1, 2].map(k => data.readFloatLE(o + pos[1] + k * 4) * scale[k]);
    let v = [0, 1, 2].map(k => data.readFloatLE(o + nrm[1] + k * 4));
    p = yaw(yawOffset, rotQ(q, p)); v = yaw(yawOffset, rotQ(q, v));
    const l = Math.hypot(...v) || 1;
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = p[k]; N[i * 3 + k] = Math.round(v[k] / l * 127); lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  // Tâm theo x / z, đáy ở y = 0 (như CarView.AddModel).
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  for (let i = 0; i < n; i++) { P[i * 3] -= cx; P[i * 3 + 1] -= lo[1]; P[i * 3 + 2] -= cz; }

  const subs = [...mesh.slice(mesh.indexOf('m_SubMeshes:'), mesh.indexOf('m_Shapes:')).matchAll(/firstByte: (\d+)\s+indexCount: (\d+)/g)]
    .map(([, fb, ic], k) => {
      const mat = fs.readFileSync(guidIndex.get(mats[k]), 'utf8');
      return { start: Number(fb) / 2, count: Number(ic), name: path.basename(guidIndex.get(mats[k]), '.mat'), color: color(mat, '_BaseColor'),
        emission: color(mat, '_EmissionColor'), smoothness: num(mat, '_Smoothness'), body: k === num(cfg, 'bodyMaterialIndex') };
    });
  const out = {
    source: 'Assets/_Game/Prefabs/Car.prefab', vertices: n, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    car: { width: num(cfg, 'carWidth'), uniformScale: num(cfg, 'uniformScale') === 1 },
    subs, pos: Buffer.from(P.buffer).toString('base64'), nrm: Buffer.from(N.buffer).toString('base64'),
    idx: index.toString('base64'),
  };
  fs.writeFileSync(outFile, JSON.stringify(out));
  return out;
}

// ───────────────────────────── bảng đếm vòng (Sign-ConveyorCount) ─────────────────────────────
// Scene Gameplay.unity: Sign-ConveyorCount (scale gốc) → Sign-Content → sign (MeshFilter Cube.asset, xoay, scale) →
// SlotAmountText (chữ used/cap). Nướng transform vào đỉnh: gốc toạ độ = chân cột (điểm neo ParkingLoopSign.Place).

function sceneObjects(scene) {
  const docs = new Map();
  for (const part of scene.split(/\n--- /)) {
    const m = /^!u!(\d+) &(-?\d+)[^\n]*\n([\s\S]*)$/.exec(part);
    if (m) docs.set(m[2], { cls: Number(m[1]), body: m[3] });
  }
  const byName = name => {
    for (const [id, d] of docs) if (d.cls === 1 && d.body.split('\n').some(l => l.trim() === `m_Name: ${name}`)) return id;
    throw new Error(`scene: không thấy ${name}`);
  };
  const comps = goId => [...docs.get(goId).body.matchAll(/component: \{fileID: (-?\d+)\}/g)].map(m => docs.get(m[1]));
  const transform = goId => comps(goId).find(d => d && (d.cls === 4 || d.cls === 224)).body;
  return { byName, comps, transform };
}

const mulQ = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];

export function exportSignMesh(repo, outFile) {
  const assets = path.join(repo, 'Assets');
  if (!guidIndex.size) indexGuids(path.join(assets, '_Game'));
  const scene = sceneObjects(fs.readFileSync(path.join(assets, '_Game/Scenes/Gameplay.unity'), 'utf8'));
  const rootS = vec(scene.transform(scene.byName('Sign-ConveyorCount')), 'm_LocalScale')[0];
  const signGo = scene.byName('sign'), st = scene.transform(signGo);
  const q = vec(st, 'm_LocalRotation'), sc = vec(st, 'm_LocalScale');
  const mf = scene.comps(signGo).find(d => d && d.cls === 33).body, mr = scene.comps(signGo).find(d => d && d.cls === 23).body;
  const meshGuid = /m_Mesh: \{fileID: \d+, guid: ([0-9a-f]{32})/.exec(mf)[1];
  const mats = [...mr.slice(mr.indexOf('m_Materials:')).matchAll(/- \{fileID: 2100000, guid: ([0-9a-f]{32})/g)].map(m => m[1]);
  const mesh = fs.readFileSync(guidIndex.get(meshGuid), 'utf8');
  const tt = scene.transform(scene.byName('SlotAmountText'));
  const tq = vec(tt, 'm_LocalRotation'), tz = vec(tt, 'm_LocalPosition')[2];
  const ta = /m_AnchoredPosition: \{x: ([-0-9.eE]+), y: ([-0-9.eE]+)\}/.exec(tt).slice(1).map(Number);
  const ts = /m_SizeDelta: \{x: ([-0-9.eE]+), y: ([-0-9.eE]+)\}/.exec(tt).slice(1).map(Number);
  const hitT = scene.transform(scene.byName('Particle-HitToSign (0)'));

  const n = num(mesh, 'm_VertexCount'), stride = num(mesh, 'm_DataSize') / n;
  const chans = [...mesh.slice(mesh.indexOf('m_Channels:')).matchAll(/- stream: (\d+)\s+offset: (\d+)\s+format: (\d+)\s+dimension: (\d+)/g)].map(m => m.slice(1).map(Number));
  const [pos, nrm] = chans;
  if (pos[2] !== 0 || nrm[2] !== 0) throw new Error('mesh bảng: định dạng đỉnh không hỗ trợ');
  const data = hex(/_typelessdata: ([0-9a-f]+)/.exec(mesh)[1]);
  const index = hex(/m_IndexBuffer: ([0-9a-f]+)/.exec(mesh)[1]);
  const bake = p => rotQ(q, p.map((v, k) => v * sc[k])).map(v => v * rootS);
  const P = new Float32Array(n * 3), N = new Int8Array(n * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    const p = bake([0, 1, 2].map(k => data.readFloatLE(o + pos[1] + k * 4)));
    const v = rotQ(q, [0, 1, 2].map(k => data.readFloatLE(o + nrm[1] + k * 4) / sc[k]));
    const l = Math.hypot(...v) || 1;
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = p[k]; N[i * 3 + k] = Math.round(v[k] / l * 127); lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  const subs = [...mesh.slice(mesh.indexOf('m_SubMeshes:'), mesh.indexOf('m_Shapes:')).matchAll(/firstByte: (\d+)\s+indexCount: (\d+)/g)]
    .map(([, fb, ic], k) => {
      const mat = fs.readFileSync(guidIndex.get(mats[k]), 'utf8');
      return { start: Number(fb) / 2, count: Number(ic), name: path.basename(guidIndex.get(mats[k]), '.mat'), color: color(mat, '_BaseColor'),
        emission: [0, 0, 0], smoothness: num(mat, '_Smoothness') };
    });
  // Chữ: tâm, trục ngang / dọc (đơn vị thế giới, đã nhân kích thước khung chữ) sau khi nướng.
  const tr = mulQ(q, tq);
  const k = sc[0] * rootS;
  const out = {
    source: 'Assets/_Game/Scenes/Gameplay.unity › Sign-ConveyorCount', vertices: n, lo, hi, subs,
    text: { center: bake([ta[0], ta[1], tz]), right: rotQ(tr, [ts[0] * k, 0, 0]), up: rotQ(tr, [0, ts[1] * k, 0]) },
    hit: vec(hitT, 'm_LocalPosition').map(v => v * rootS),
    pos: Buffer.from(P.buffer).toString('base64'), nrm: Buffer.from(N.buffer).toString('base64'), idx: index.toString('base64'),
  };
  fs.writeFileSync(outFile, JSON.stringify(out));
  return out;
}
