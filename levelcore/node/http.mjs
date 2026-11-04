// Phần HTTP tối thiểu của server Node (không dependency): lỗi API, router theo mẫu đường dẫn, đọc body, file tĩnh.
// Lỗi luôn là JSON {"detail": …, …} như server Python.
import fs from 'node:fs';
import path from 'node:path';

export class ApiError extends Error {
  constructor(status, detail, extra = {}) {
    super(detail);
    this.status = status;
    this.body = { detail, ...extra };
  }
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  match(method, pathname) {
    let allowed = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      allowed = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return allowed ? { notAllowed: true } : null;
  }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new ApiError(413, `Dữ liệu gửi lên quá lớn (tối đa ${limit >> 20} MB)`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, `Dữ liệu gửi lên quá lớn (tối đa ${limit >> 20} MB)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseJson(buf, what = 'Body') {
  try {
    return JSON.parse(stripBom(buf.toString('utf8')) || 'null');
  } catch (e) {
    throw new ApiError(400, `${what} không phải JSON: ${e.message}`);
  }
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function queryBool(url, key, fallback = false) {
  const v = url.searchParams.get(key);
  if (v === null) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(v.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off', ''].includes(v.toLowerCase())) return false;
  throw new ApiError(400, `${key} phải là true / false`);
}

export function sendJson(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers });
  res.end(body);
}

export function sendBytes(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Length': body.length, ...headers });
  res.end(body);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

/** File tĩnh trong `root` (chặn ../); thư mục → index.html. Trả false nếu không có file. */
export function serveFile(res, root, rel, headers = {}) {
  const base = path.resolve(root);
  let file = path.resolve(base, `.${path.posix.normalize(`/${rel}`)}`);
  if (file !== base && !file.startsWith(base + path.sep)) return false;
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const body = fs.readFileSync(file);
    sendBytes(res, 200, body, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', ...headers });
    return true;
  } catch {
    return false;
  }
}
