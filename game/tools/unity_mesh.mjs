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
