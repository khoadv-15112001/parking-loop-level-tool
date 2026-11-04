// Client cho test hợp đồng: gọi server đang chạy ở BASE_URL (Python hoặc Node) bằng fetch, đăng nhập kiểu DEV.
import { createZip, readZip } from '../../node/zip.mjs';

export const BASE = process.env.BASE_URL || 'http://127.0.0.1:8880';
export const ADMIN = 'a@sonat.vn';
export const OTHER = 'b@sonat.vn';
export { createZip, readZip };

export const level = (n, time = 60, items = ['gem', 'rock']) => ({ level: n, time, items });

let seq = 0;
export const uniquePack = prefix => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export async function call(user, method, path, { json, body, headers = {} } = {}) {
  const h = { ...(user ? { 'X-Dev-User': user } : {}), ...headers };
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(BASE + path, { method, headers: h, body });
  const bytes = Buffer.from(await res.arrayBuffer());
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json') && bytes.length) data = JSON.parse(bytes.toString('utf8'));
  return { status: res.status, headers: res.headers, data, bytes };
}

export const as = user => ({
  get: (p, o) => call(user, 'GET', p, o),
  post: (p, o) => call(user, 'POST', p, o),
  put: (p, o) => call(user, 'PUT', p, o),
  patch: (p, o) => call(user, 'PATCH', p, o),
  del: (p, o) => call(user, 'DELETE', p, o),
});

export const A = as(ADMIN);
export const B = as(OTHER);

export async function newPack(prefix, extra = {}) {
  const name = uniquePack(prefix);
  const r = await A.post('/api/packs', { json: { name, ...extra } });
  if (r.status !== 201) throw new Error(`tạo bộ ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  return name;
}

export async function create(pack, n, body = level(n), user = A) {
  const r = await user.post(`/api/packs/${pack}/levels/${n}`, { json: body });
  if (r.status !== 201) throw new Error(`tạo level ${pack}/${n}: ${r.status} ${JSON.stringify(r.data)}`);
  return r;
}

export const ifMatch = rev => ({ 'If-Match': `"r${rev}"` });

const ZIP_DATE = new Date(2026, 0, 1);

/** Zip cố định theo nội dung (cùng file → cùng byte, cùng digest). */
export function zipOf(files) {
  return createZip(Object.entries(files).map(([name, data]) => ({
    name, date: ZIP_DATE, data: Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data),
  })));
}

export const importZip = (pack, files, query = '') =>
  A.post(`/api/packs/${pack}/import${query}`, { body: zipOf(files), headers: { 'Content-Type': 'application/zip' } });
