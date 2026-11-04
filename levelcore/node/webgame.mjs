// Bản game WebGL (playtest) cho server Node — cùng cách lưu và cùng route với levelcore/server/levelcore/webgame.py:
// <GAME_DIR> là bản đang dùng (phục vụ ở /game/), <GAME_DIR>.builds/<id>/ là bản chờ chọn và bản trước để quay lại.
// Id cố định theo buildUrl → nhánh + số build → digest zip; gửi lại cùng bản không cài lần hai. Giải nén từng file bằng
// stream từ zip trên đĩa (bản game vài trăm MB), chọn bản = đổi chỗ thư mục, zip lỗi không đụng bản đang dùng.
// File *.br / *.gz trả kèm Content-Encoding và Content-Type theo đuôi thật (Unity tắt decompressionFallback).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ApiError } from './http.mjs';
import { iso, now } from './store.mjs';
import { extractZipEntry, listZipFile } from './zip.mjs';
import { BUILD_BUDGET, diskBytes, storageRoots, requireStorage } from './storage.mjs';

export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 2 * 1024 * 1024 * 1024;
const INFO_FILE = 'levelcore_game.json';
export const CHUNK_BYTES = 50 * 1024 * 1024;
const UPLOAD_TTL = 24 * 3600;
const KEEP_ROLLBACK = 1;
const KEEP_WAITING = 1;
const BUILD_ID = /^(b[0-9a-f]{12}|legacy-\d+)$/;
const BUILD_FIELDS = ['id', 'version', 'commit', 'branch', 'buildNumber', 'buildUrl', 'environment', 'digest', 'source',
  'uploaded_by', 'uploaded_at', 'activated_at', 'file', 'size'];
const TYPES = {
  '.js': 'application/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.bundle': 'application/octet-stream', '.hash': 'text/plain', '.txt': 'text/plain',
};
const ENCODINGS = { '.br': 'br', '.gz': 'gzip' };
const HASHED = /[0-9a-f]{32}/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

/** Windows: antivirus / indexer hay giữ thư mục vừa giải nén vài giây (EPERM) — thử lại trước khi bỏ cuộc. */
async function rename(src, dst) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(src, dst);
    } catch (e) {
      if (i === 19 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await sleep(500);
    }
  }
}

function readInfo(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, INFO_FILE), 'utf8'));
  } catch {
    return {};
  }
}

const writeInfo = (dir, meta) => fs.writeFileSync(path.join(dir, INFO_FILE), JSON.stringify(meta));

export function buildKey(meta, digest) {
  const url = String(meta.buildUrl || '');
  if (/^https?:\/\//.test(url)) return url.slice(0, 300);
  if (meta.branch && meta.buildNumber) return `${meta.branch}#${meta.buildNumber}`;
  return `sha256:${digest}`;
}

export const buildId = key => `b${crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 12)}`;

function publicBuild(meta, current) {
  const out = Object.fromEntries(BUILD_FIELDS.map(k => [k, meta[k] ?? null]));
  out.current = current;
  out.status = current ? 'current' : meta.activated_at ? 'rollback' : 'waiting';
  return out;
}

export async function fileDigest(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

/** Trả tiền tố thư mục chứa index.html (zip có thể bọc thêm 1 thư mục). Chặn zip-slip / zip bomb. */
function checkZip(entries) {
  let total = 0;
  for (const e of entries) {
    const n = e.name.replace(/\\/g, '/');
    if (n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split('/').includes('..')) throw new ApiError(400, `Zip có đường dẫn không hợp lệ: ${e.name}`);
    total += e.size;
  }
  if (total > MAX_UNZIPPED_BYTES) throw new ApiError(413, 'Bản game giải nén quá 2 GB');
  const names = entries.map(e => e.name.replace(/\\/g, '/'));
  const roots = names.filter(n => n === 'index.html' || n.endsWith('/index.html')).map(n => n.slice(0, -'index.html'.length)).sort((a, b) => a.length - b.length);
  if (!roots.length) throw new ApiError(400, 'Zip không có index.html — cần zip bản build WebGL (Builds/playtest-web.zip)');
  const root = roots[0];
  if (!names.some(n => n.startsWith(`${root}Build/`) && (n.endsWith('.loader.js') || n.endsWith('.loader.js.br')))) {
    throw new ApiError(400, 'Zip thiếu Build/*.loader.js — không phải bản build WebGL của Unity');
  }
  return root;
}

export class Builds {
  constructor(s) {
    this.storageRoots = storageRoots(s);
    this.dir = path.resolve(s.gameDir);
    this.buildsDir = `${this.dir}.builds`;
    this.uploadsDir = `${this.dir}.uploads`;
    this.queue = Promise.resolve();
  }

  /** Cài / chọn / xoá bản build và nhập level CI đi kèm: lần lượt từng việc. */
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  info() {
    if (!isFile(path.join(this.dir, 'index.html'))) return { available: false };
    return { available: true, url: '/game/index.html', ...readInfo(this.dir) };
  }

  list() {
    const out = [];
    if (isFile(path.join(this.dir, 'index.html'))) out.push(publicBuild({ id: 'legacy', ...readInfo(this.dir) }, true));
    let names = [];
    try {
      names = fs.readdirSync(this.buildsDir).filter(n => BUILD_ID.test(n) && isFile(path.join(this.buildsDir, n, 'index.html')));
    } catch {}
    const stored = names.map(n => { const m = readInfo(path.join(this.buildsDir, n)); return [m.uploaded_ts || 0, publicBuild({ ...m, id: n }, false)]; });
    return [...out, ...stored.sort((a, b) => b[0] - a[0]).map(x => x[1])];
  }

  /** 'current' | 'stored' | null */
  find(id) {
    if (isFile(path.join(this.dir, 'index.html')) && readInfo(this.dir).id === id) return 'current';
    if (BUILD_ID.test(String(id || '')) && isFile(path.join(this.buildsDir, id, 'index.html'))) return 'stored';
    return null;
  }

  cleanLeftovers() {
    const parent = path.dirname(this.dir), base = path.basename(this.dir);
    let names = [];
    try { names = fs.readdirSync(parent); } catch {}
    for (const n of names) if (n.startsWith(`${base}.new-`) || n.startsWith(`${base}.old-`)) fs.rmSync(path.join(parent, n), { recursive: true, force: true });
  }

  async extract(file, entries, root, meta) {
    fs.mkdirSync(path.dirname(this.dir), { recursive: true });
    this.cleanLeftovers();
    const tmp = `${this.dir}.new-${Date.now()}`;
    try {
      for (const e of entries) {
        const rel = e.name.replace(/\\/g, '/');
        if (!rel.startsWith(root) || rel.endsWith('/')) continue;
        const target = path.resolve(tmp, rel.slice(root.length));
        if (!target.startsWith(path.resolve(tmp) + path.sep)) throw new ApiError(400, `Zip có đường dẫn không hợp lệ: ${e.name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try {
          await extractZipEntry(file, e, target);
        } catch (err) {
          throw new ApiError(400, `Zip bản WebGL hỏng: ${err.message}`);
        }
      }
      writeInfo(tmp, meta);
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
    return tmp;
  }

  /** src thành bản đang dùng; bản đang dùng (nếu có) chuyển vào <GAME_DIR>.builds/ để quay lại. */
  async swapIn(src) {
    writeInfo(src, { ...readInfo(src), activated_at: iso(now()) });
    if (isFile(path.join(this.dir, 'index.html'))) {
      const cur = readInfo(this.dir);
      let id = cur.id;
      if (!BUILD_ID.test(String(id || ''))) {
        id = `legacy-${Date.now()}`;
        writeInfo(this.dir, { ...cur, id, activated_at: cur.uploaded_at || iso(0) });
      }
      fs.mkdirSync(this.buildsDir, { recursive: true });
      const target = path.join(this.buildsDir, id);
      fs.rmSync(target, { recursive: true, force: true });
      await rename(this.dir, target);
    } else if (fs.existsSync(this.dir)) {
      const old = `${this.dir}.old-${Date.now()}`;
      await rename(this.dir, old);
      fs.rmSync(old, { recursive: true, force: true });
    }
    await rename(src, this.dir);
  }

  /** Cài một bản build (gọi trong serial). Trả {status: current | waiting | unchanged, build, pruned}. */
  async installNow(file, user, { name = '', meta = {}, activate = true, reuseActivates = false, digest = null } = {}) {
    const size = fs.statSync(file).size;
    if (size > MAX_ZIP_BYTES) throw new ApiError(413, 'Zip quá 1 GB');
    let entries;
    try {
      entries = await listZipFile(file);
    } catch (e) {
      throw new ApiError(400, /không an toàn/.test(e.message) ? `Zip có đường dẫn không hợp lệ: ${e.message}` : 'File không phải zip');
    }
    const root = checkZip(entries);
    const m = { ...meta, digest: digest || await fileDigest(file) };
    const key = buildKey(m, m.digest);
    const id = buildId(key);
    const where = this.find(id);
    if (where === 'current' || (where === 'stored' && !(activate && reuseActivates))) {
      return { status: 'unchanged', build: publicBuild(readInfo(where === 'current' ? this.dir : path.join(this.buildsDir, id)), where === 'current'), pruned: [] };
    }
    if (where === 'stored') return { status: 'current', ...(await this.activateNow(id)) };
    const unpacked = entries.reduce((bytes, entry) => bytes + entry.size, 0);
    if (unpacked > BUILD_BUDGET) throw new ApiError(413, 'Bản WebGL vượt ngân sách 800 MB; nén bản game trước khi tải lên.');
    if (!activate && diskBytes(this.dir) + unpacked > BUILD_BUDGET) throw new ApiError(507, 'Không đủ chỗ giữ bản game chờ trong ngân sách 800 MB.');
    requireStorage(this.storageRoots, unpacked + 64 * 1024, ApiError);
    const t = now();
    Object.assign(m, { id, key, uploaded_by: user, uploaded_at: iso(t), uploaded_ts: t, file: name || m.file || '', size });
    const tmp = await this.extract(file, entries, root, m);
    try {
      if (diskBytes(tmp) + (activate ? 0 : diskBytes(this.dir)) > BUILD_BUDGET) throw new ApiError(507, 'Không đủ chỗ giữ bản game mới trong ngân sách 800 MB.');
      if (activate) {
        await this.swapIn(tmp);
      } else {
        fs.mkdirSync(this.buildsDir, { recursive: true });
        await rename(tmp, path.join(this.buildsDir, id));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    const build = publicBuild(readInfo(activate ? this.dir : path.join(this.buildsDir, id)), activate);
    return { status: activate ? 'current' : 'waiting', build, pruned: this.prune() };
  }

  /** Bản tải tay (admin): luôn thành bản đang dùng. Trả info(). */
  async installUpload(file, user, name) {
    await this.serial(() => this.installNow(file, user, { name, meta: { source: 'upload' }, activate: true, reuseActivates: true }));
    return this.info();
  }

  async activateNow(id) {
    const where = this.find(id);
    if (!where) throw new ApiError(404, 'Không có bản build này (đã bị dọn hoặc chưa cài)');
    if (where === 'stored') await this.swapIn(path.join(this.buildsDir, id));
    return { build: publicBuild(readInfo(this.dir), true), pruned: this.prune() };
  }

  removeNow(id) {
    const where = this.find(id);
    if (where === 'current') throw new ApiError(409, 'Bản này đang dùng: chọn bản khác trước rồi mới xoá');
    if (!where) throw new ApiError(404, 'Không có bản build này');
    const dir = path.join(this.buildsDir, id);
    const out = publicBuild({ ...readInfo(dir), id }, false);
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  }

  prune() {
    const stored = this.list().filter(b => !b.current);
    const old = stored.filter(b => b.status === 'rollback').sort((a, b) => String(b.activated_at || '').localeCompare(String(a.activated_at || '')));
    const waiting = stored.filter(b => b.status === 'waiting');
    let bytes = diskBytes(this.dir);
    const removed = [];
    for (const [group, keep] of [[waiting, KEEP_WAITING], [old, KEEP_ROLLBACK]]) {
      for (const [index, build] of group.entries()) {
        const size = diskBytes(path.join(this.buildsDir, build.id));
        if (index >= keep || bytes + size > BUILD_BUDGET) removed.push(build);
        else bytes += size;
      }
    }
    for (const b of removed) fs.rmSync(path.join(this.buildsDir, b.id), { recursive: true, force: true });
    return removed.map(b => b.id);
  }

  /** File của bản đang dùng ở /game/<rel>. Trả false nếu không có. */
  serve(req, res, rel) {
    const base = this.dir;
    let file = path.resolve(base, `.${path.posix.normalize(`/${rel || 'index.html'}`)}`);
    if (file !== base && !file.startsWith(base + path.sep)) return false;
    let st;
    try {
      st = fs.statSync(file, { bigint: true });
      if (st.isDirectory()) {
        file = path.join(file, 'index.html');
        st = fs.statSync(file, { bigint: true });
      }
    } catch {
      return false;
    }
    if (!st.isFile() || (path.dirname(file) === base && path.basename(file).endsWith('_game.json'))) return false;
    const ext = path.extname(file).toLowerCase();
    const enc = ENCODINGS[ext];
    const inner = enc ? path.extname(path.basename(file, ext)).toLowerCase() : ext;
    const etag = `"${st.mtimeNs.toString(16)}-${st.size.toString(16)}"`;
    const headers = { ETag: etag, 'Cache-Control': HASHED.test(path.basename(file)) ? 'private, max-age=31536000, immutable' : 'no-cache' };
    const given = String(req.headers['if-none-match'] || '').split(',').map(t => t.trim().replace(/^W\//, ''));
    if (given.includes(etag)) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    if (enc) headers['Content-Encoding'] = enc;
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[inner] || 'application/octet-stream', 'Content-Length': String(st.size) });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
  }
}

/** Ghi body request ra file (không nạp vào RAM), giới hạn cỡ; trả sha256. */
export function streamToFile(req, file, limit, roots = [path.dirname(file)]) {
  requireStorage(roots, Number(req.headers['content-length'] || 0), ApiError);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > limit) {
      req.resume();
      reject(new ApiError(413, `Zip quá ${limit >> 20} MB`));
      return;
    }
    const h = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let size = 0, failed = false, checkedBytes = 0;
    const fail = e => {
      if (failed) return;
      failed = true;
      out.destroy();
      req.destroy();
      reject(e);
    };
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) return fail(new ApiError(413, `Zip quá ${limit >> 20} MB`));
      if (size > checkedBytes) {
        try {
          requireStorage(roots, Math.max(chunk.length, 8 * 1024 * 1024), ApiError);
          checkedBytes = size + 8 * 1024 * 1024;
        } catch (error) { return fail(error); }
      }
      h.update(chunk);
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    });
    let ended = false;
    req.on('end', () => {
      ended = true;
      if (!failed) out.end(() => resolve(h.digest('hex')));
    });
    req.on('close', () => {
      if (!ended) fail(new ApiError(400, 'Mất kết nối khi đang tải lên — gửi lại'));
    });
    req.on('error', fail);
    out.on('error', fail);
  });
}

/** Tải bản game lên theo phần (qua proxy giới hạn cỡ mỗi request): bắt đầu → từng phần → ghép rồi cài. */
export class ChunkUploads {
  constructor(builds) {
    this.builds = builds;
    this.dir = builds.uploadsDir;
  }

  folder(id) {
    if (!/^[A-Za-z0-9]+$/.test(String(id)) || !isFile(path.join(this.dir, id, 'meta.json'))) {
      throw new ApiError(404, 'Không có lượt tải lên này (quá hạn hoặc đã xong) — tải lại từ đầu');
    }
    return path.join(this.dir, id);
  }

  start(user, body) {
    const size = body?.size;
    const name = String(body?.name || '').slice(0, 200);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_ZIP_BYTES) throw new ApiError(400, 'size phải là số byte của zip (tối đa 1 GB)');
    try {
      for (const n of fs.readdirSync(this.dir)) {
        const p = path.join(this.dir, n);
        if (Date.now() / 1000 - fs.statSync(p).mtimeMs / 1000 > UPLOAD_TTL) fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {}
    requireStorage(this.builds.storageRoots, size, ApiError);
    const id = crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(path.join(this.dir, id), { recursive: true });
    fs.writeFileSync(path.join(this.dir, id, 'meta.json'), JSON.stringify({ size, name, user }));
    return { id, chunk: CHUNK_BYTES, parts: Math.ceil(size / CHUNK_BYTES) };
  }

  part(id, i, data) {
    const dir = this.folder(id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const parts = Math.ceil(meta.size / CHUNK_BYTES);
    if (!/^\d+$/.test(String(i)) || Number(i) >= parts) throw new ApiError(400, `Phần ${i} ngoài khoảng 0..${parts - 1}`);
    const want = Math.min(CHUNK_BYTES, meta.size - Number(i) * CHUNK_BYTES);
    if (data.length !== want) throw new ApiError(400, `Phần ${i} dài ${data.length} byte, cần ${want}`);
    requireStorage(this.builds.storageRoots, Math.max(0, data.length - diskBytes(path.join(dir, `${String(i).padStart(5, '0')}.part`))), ApiError);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.part`), data);
    return { ok: true, part: Number(i) };
  }

  async complete(id, user) {
    const dir = this.folder(id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const parts = Math.ceil(meta.size / CHUNK_BYTES);
    const missing = [];
    for (let i = 0; i < parts; i++) if (!isFile(path.join(dir, `${String(i).padStart(5, '0')}.part`))) missing.push(i);
    if (missing.length) throw new ApiError(400, `Còn thiếu phần [${missing.slice(0, 10).join(', ')}]`);
    const zip = path.join(dir, 'upload.zip');
    try {
      const out = fs.openSync(zip, 'w');
      try {
        for (let i = 0; i < parts; i++) {
          const part = path.join(dir, `${String(i).padStart(5, '0')}.part`);
          fs.writeSync(out, fs.readFileSync(part));
          fs.rmSync(part);
        }
      } finally {
        fs.closeSync(out);
      }
      if (fs.statSync(zip).size !== meta.size) throw new ApiError(400, 'Các phần ghép lại không đúng cỡ file — tải lại từ đầu');
      return await this.builds.installUpload(zip, user, meta.name);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
