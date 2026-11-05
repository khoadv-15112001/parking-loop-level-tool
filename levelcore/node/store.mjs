// Nghiệp vụ của server Node, chép một-một từ levelcore/server/levelcore/store.py: pack, level, revision (append-only, blob
// sha256 + zlib), khoá, đổi số, promote, nhập / xuất, audit. Mỗi hàm ghi chạy trong một transaction; event SSE chỉ bắn
// sau commit. Kết quả trả về cùng hình với server Python (kiểm bằng levelcore/contracts).
import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { ApiError, stripBom } from './http.mjs';
import { createZip, readZip } from './zip.mjs';

const PACK_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const NAME_RE = /^[1-9][0-9]{0,8}$/;
const GROUP_MAX = 64;
const PLATFORMS = ['android', 'ios', 'both'];
const MAX_IMPORT_ENTRY = 16 * 1024 * 1024;
const MAX_IMPORT_TOTAL = 512 * 1024 * 1024;
const MAX_IMPORT_FILES = 20000;
export const IMPORT_STATUSES = ['created', 'updated', 'unchanged', 'conflict', 'waiting', 'locked', 'error'];

let clockOffset = 0;
export const now = () => Date.now() / 1000 + clockOffset;
export const advanceClock = seconds => { clockOffset += seconds; };

export const iso = ts => (ts == null ? null : new Date(ts * 1000).toISOString());
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const canon = obj => Buffer.from(JSON.stringify(obj), 'utf8');
const pretty = obj => Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, 'utf8');
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const jsonOrNull = text => (text ? JSON.parse(text) : null);

export function parseTime(v) {
  if (!v) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  if (Number.isNaN(t)) throw new ApiError(400, `since không hợp lệ: ${v}`);
  return t / 1000;
}

export function parseIfMatch(v) {
  if (v == null) return null;
  const m = /^\s*(?:W\/)?"?r(\d+)"?\s*$/.exec(v);
  if (!m) throw new ApiError(400, `If-Match phải dạng "r<rev>", nhận: ${v}`);
  return Number(m[1]);
}

function checkGroup(group) {
  if (typeof group !== 'string') throw new ApiError(400, 'group phải là chuỗi');
  const g = group.split(/\s+/).filter(Boolean).join(' ');
  if (g.length > GROUP_MAX || [...g].some(ch => ch.charCodeAt(0) < 32)) {
    throw new ApiError(400, `Tên nhóm bộ tối đa ${GROUP_MAX} ký tự, không có ký tự điều khiển`);
  }
  return g;
}

const changesDetail = res => (res.changes?.length ? { changes: res.changes } : {});
const importCounts = items => Object.fromEntries(IMPORT_STATUSES.map(k => [k, items.filter(it => it.status === k).length]));

export class Store {
  constructor(db, broker, settings, game) {
    this.db = db;
    this.broker = broker;
    this.s = settings;
    this.game = game;
  }

  // ---------- tiện ích nội bộ ----------
  putBlob(data) {
    const sha = sha256(data);
    this.db.run('INSERT OR IGNORE INTO blobs(sha,size,codec,data) VALUES(?,?,?,?)', sha, data.length, 'zlib', zlib.deflateSync(data, { level: 6 }));
    return sha;
  }

  blob(sha) {
    const r = this.db.get('SELECT codec,data FROM blobs WHERE sha=?', sha);
    return r.codec === 'zlib' ? zlib.inflateSync(r.data) : Buffer.from(r.data);
  }

  pack(name) {
    const r = this.db.get('SELECT * FROM packs WHERE name=?', name);
    if (!r) throw new ApiError(404, `Không có bộ '${name}'`);
    return r;
  }

  writable(pack, op = 'edit') {
    const p = this.pack(pack);
    if (p.archived) throw new ApiError(403, `Bộ '${pack}' đã lưu trữ — bỏ lưu trữ để sửa`);
    if (p.production && op !== 'copy' && op !== 'swap') {
      throw new ApiError(403, `Bộ '${pack}' là production: chỉ nhận level promote từ bộ khác (qua kiểm định) và đổi chỗ số level — không sửa trực tiếp`);
    }
    return p;
  }

  static checkName(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new ApiError(400, `Tên level phải là số nguyên dương: '${name}'`);
  }

  level(pack, name) {
    return this.db.get('SELECT * FROM levels WHERE pack=? AND name=?', pack, name);
  }

  head(lv) {
    return this.db.get('SELECT * FROM revisions WHERE level_id=? AND rev=?', lv.id, lv.head_rev);
  }

  lock(pack, name) {
    return this.db.get('SELECT * FROM locks WHERE pack=? AND name=? AND expires_at>?', pack, name, now());
  }

  static lockJson(l) {
    return l ? { holder: l.holder, since: iso(l.since), expires_at: iso(l.expires_at) } : null;
  }

  denyIfLocked(pack, name, user) {
    const l = this.lock(pack, name);
    if (l && l.holder !== user) {
      throw new ApiError(423, `Level ${pack}/${name} đang bị ${l.holder} khoá`, {
        pack, level: name, holder: l.holder, since: iso(l.since), expires_at: iso(l.expires_at),
      });
    }
    return !!l;
  }

  audit(user, action, pack = null, level = null, rev = null, detail = {}) {
    this.db.run('INSERT INTO audit(ts,user,action,pack,level,rev,detail) VALUES(?,?,?,?,?,?,?)', now(), user, action, pack,
      level, rev ?? null, Object.keys(detail).length ? JSON.stringify(detail) : null);
  }

  static decode(data) {
    return JSON.parse(stripBom(Buffer.from(data).toString('utf8')));
  }

  bodyOrNull(sha) {
    if (sha == null) return null;
    try {
      return Store.decode(this.blob(sha));
    } catch {
      return null;
    }
  }

  static parseBody(body) {
    let obj;
    try {
      obj = JSON.parse(stripBom(body.toString('utf8')));
    } catch (e) {
      throw new ApiError(400, `Body không phải JSON: ${e.message}`);
    }
    if (!isObject(obj)) throw new ApiError(400, 'Level phải là JSON object');
    return obj;
  }

  writeRev(pack, name, data, user, kind, { message = '', unlocked = false, meta = null, rev = null, diff = false } = {}) {
    const t = now();
    let lv = this.level(pack, name);
    const created = !lv || lv.deleted === 1;
    let changes = null;
    if (diff && !created && data) {
      const prev = this.head(lv).blob_sha;
      if (prev) changes = this.game.changes(this.bodyOrNull(prev), Store.decode(data));
    }
    if (!lv) {
      this.db.run('INSERT INTO levels(pack,name,sort_key,head_rev,deleted,created_at,updated_at,updated_by) VALUES(?,?,?,0,0,?,?,?)',
        pack, name, Number(name), t, t, user);
      lv = this.level(pack, name);
    }
    const newRev = rev ?? lv.head_rev + 1;
    const sha = data ? this.putBlob(data) : null;
    let m = meta;
    if (data && this.s.formatVersion != null && !(m && 'format' in m)) m = { ...(m || {}), format: this.s.formatVersion };
    this.db.run('INSERT INTO revisions(level_id,rev,blob_sha,author,created_at,kind,message,unlocked_edit,meta) VALUES(?,?,?,?,?,?,?,?,?)',
      lv.id, newRev, sha, user, t, kind, message || '', unlocked ? 1 : 0, m && Object.keys(m).length ? JSON.stringify(m) : null);
    const summary = data ? JSON.stringify(this.game.summary(Store.decode(data))) : null;
    this.db.run('UPDATE levels SET head_rev=?, deleted=?, updated_at=?, updated_by=?, summary=? WHERE id=?',
      newRev, data ? 0 : 1, t, user, summary, lv.id);
    return { rev: newRev, sha, created: created && !!data, summary: summary ? JSON.parse(summary) : null, changes };
  }

  conflict(lv, pack, name, expected) {
    const h = this.head(lv);
    throw new ApiError(412, `Level ${pack}/${name} đã đổi: bạn sửa từ r${expected}, head là r${lv.head_rev}`, {
      pack, level: name, head_rev: lv.head_rev, author: h.author, updated_at: iso(h.created_at), sha: h.blob_sha,
      deleted: !!lv.deleted, body: h.blob_sha == null ? null : Store.decode(this.blob(h.blob_sha)),
    });
  }

  revJson(r, withBody = false) {
    const meta = jsonOrNull(r.meta);
    const out = {
      rev: r.rev, author: r.author, created_at: iso(r.created_at), kind: r.kind, message: r.message,
      unlocked_edit: !!r.unlocked_edit, sha: r.blob_sha, meta, format: meta?.format ?? null,
    };
    if (withBody) out.level = r.blob_sha == null ? null : Store.decode(this.blob(r.blob_sha));
    return out;
  }

  validate(pairs) {
    return pairs.map(([n, obj]) => this.game.validate(obj, Number(n), this.s.formatVersion));
  }

  // ---------- pack ----------
  ensureDefaultPacks() {
    this.db.write(() => {
      if (this.db.get('SELECT 1 x FROM packs LIMIT 1')) return;
      for (const name of this.s.defaultPacks) {
        this.db.run('INSERT OR IGNORE INTO packs(name,created_at,created_by,production) VALUES(?,?,?,?)', name, now(), 'system', name === 'product' ? 1 : 0);
      }
    });
  }

  static packJson(r, n) {
    const out = {
      name: r.name, description: r.description, created_at: iso(r.created_at), created_by: r.created_by,
      archived: !!r.archived, production: !!r.production, platform: r.platform || 'android', group: r.grp || '',
      archived_at: iso(r.archived_at ?? null), archive_reason: r.archive_reason ?? null,
    };
    if (n != null) out.level_count = n;
    return out;
  }

  listPacks() {
    return this.db.all('SELECT p.*, (SELECT COUNT(*) FROM levels l WHERE l.pack=p.name AND l.deleted=0) n FROM packs p ORDER BY p.created_at, p.name')
      .map(r => Store.packJson(r, r.n));
  }

  createPack(user, name, description = '', platform = 'android', group = '') {
    if (typeof name !== 'string' || !PACK_RE.test(name)) throw new ApiError(400, 'Tên bộ chỉ gồm chữ/số/_ . - (tối đa 64)');
    if (!PLATFORMS.includes(platform)) throw new ApiError(400, 'platform phải là android | ios | both');
    const g = checkGroup(group || '');
    const p = this.db.write(() => {
      if (this.db.get('SELECT 1 x FROM packs WHERE name=?', name)) throw new ApiError(409, `Bộ '${name}' đã có`);
      this.db.run('INSERT INTO packs(name,description,created_at,created_by,platform,grp) VALUES(?,?,?,?,?,?)', name, description || '', now(), user, platform, g);
      this.audit(user, 'pack.create', name, null, null, { platform, ...(g ? { group: g } : {}) });
      return this.pack(name);
    });
    this.broker.publish('pack.created', { pack: name, author: user });
    return Store.packJson(p, 0);
  }

  updatePack(user, pack, { archived = null, production = null, platform = null, group = null, description = null, archive_reason = null } = {}) {
    for (const [k, v] of [['archived', archived], ['production', production]]) {
      if (v != null && typeof v !== 'boolean') throw new ApiError(400, `${k} phải là true/false`);
    }
    if (platform != null && !PLATFORMS.includes(platform)) throw new ApiError(400, 'platform phải là android | ios | both');
    const g = group != null ? checkGroup(group) : null;
    if (description != null && typeof description !== 'string') throw new ApiError(400, 'description phải là chuỗi');
    const changed = [];
    const p = this.db.write(() => {
      const cur = this.pack(pack);
      for (const [col, key, v, old] of [['archived', 'archived', archived, !!cur.archived], ['production', 'production', production, !!cur.production],
        ['platform', 'platform', platform, cur.platform], ['grp', 'group', g, cur.grp], ['description', 'description', description, cur.description]]) {
        if (v == null || v === old) continue;
        this.db.run(`UPDATE packs SET ${col}=? WHERE name=?`, typeof v === 'boolean' ? Number(v) : v, pack);
        this.audit(user, `pack.${key}`, pack, null, null, { on: v });
        changed.push(key);
      }
      if (archived && changed.includes('archived')) {
        this.db.run('UPDATE packs SET archived_at=?, archive_reason=? WHERE name=?', now(), String(archive_reason || '').trim().slice(0, 300) || null, pack);
      }
      if (archived === false && changed.includes('archived')) this.db.run('UPDATE packs SET archived_at=NULL, archive_reason=NULL WHERE name=?', pack);
      if (archived) this.db.run('DELETE FROM locks WHERE pack=?', pack);
      return this.pack(pack);
    });
    const out = { ...Store.packJson(p), changed, author: user };
    if (changed.length) this.broker.publish('pack.updated', out);
    return out;
  }

  renamePack(user, pack, to) {
    if (typeof to !== 'string' || !PACK_RE.test(to)) throw new ApiError(400, 'Tên bộ chỉ gồm chữ/số/_ . - (tối đa 64)');
    this.db.write(() => {
      this.pack(pack);
      if (to === pack) throw new ApiError(400, 'Tên mới trùng tên cũ');
      if (this.db.get('SELECT 1 x FROM packs WHERE name=?', to)) throw new ApiError(409, `Bộ '${to}' đã có`);
      const lk = this.db.get('SELECT * FROM locks WHERE pack=? AND expires_at>? ORDER BY name LIMIT 1', pack, now());
      if (lk) {
        throw new ApiError(423, `Level ${pack}/${lk.name} đang bị ${lk.holder} khoá — đổi tên bộ khi không ai đang sửa`, { pack, level: lk.name, holder: lk.holder });
      }
      this.db.run(`INSERT INTO packs(name,description,created_at,created_by,archived,production,platform,grp,archived_at,archive_reason)
        SELECT ?,description,created_at,created_by,archived,production,platform,grp,archived_at,archive_reason FROM packs WHERE name=?`, to, pack);
      this.db.run('UPDATE levels SET pack=? WHERE pack=?', to, pack);
      this.db.run('DELETE FROM locks WHERE pack=?', pack);
      this.db.run('UPDATE audit SET pack=? WHERE pack=?', to, pack);
      this.db.run('DELETE FROM packs WHERE name=?', pack);
      this.audit(user, 'pack.rename', to, null, null, { renamed_from: pack });
    });
    const out = { from: pack, to, author: user };
    this.broker.publish('pack.renamed', out);
    return out;
  }

  // ---------- level: đọc ----------
  listLevels(pack, includeDeleted = false) {
    this.pack(pack);
    return this.db.all(`SELECT l.*, r.blob_sha, r.author, r.unlocked_edit, k.holder, k.since, k.expires_at
      FROM levels l JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev
      LEFT JOIN locks k ON k.pack=l.pack AND k.name=l.name AND k.expires_at>?
      WHERE l.pack=? AND (?=1 OR l.deleted=0) ORDER BY l.sort_key, l.name`, now(), pack, includeDeleted ? 1 : 0)
      .map(r => ({
        name: r.name, level: r.sort_key, head_rev: r.head_rev, sha: r.blob_sha, author: r.author, updated_at: iso(r.updated_at),
        deleted: !!r.deleted, unlocked_edit: !!r.unlocked_edit, lock: r.holder ? Store.lockJson(r) : null,
        summary: jsonOrNull(r.summary),
      }));
  }

  getLevel(pack, name) {
    this.pack(pack);
    const lv = this.level(pack, name);
    if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${name}`);
    return { pack, name, level_no: lv.sort_key, ...this.revJson(this.head(lv), true), head_rev: lv.head_rev, lock: Store.lockJson(this.lock(pack, name)) };
  }

  bundle(pack) {
    this.pack(pack);
    const rows = this.db.all(`SELECT l.name, l.sort_key, l.head_rev, l.updated_at, r.blob_sha, r.author
      FROM levels l JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev
      WHERE l.pack=? AND l.deleted=0 ORDER BY l.sort_key, l.name`, pack);
    return {
      pack,
      levels: rows.map(r => ({
        name: r.name, level_no: r.sort_key, rev: r.head_rev, sha: r.blob_sha, author: r.author, updated_at: iso(r.updated_at),
        level: Store.decode(this.blob(r.blob_sha)),
      })),
    };
  }

  /** Đúng các revision đã chốt (Level Hub): [{level, name, rev, sha}] → giống bundle(); không còn / sha khác → 409. */
  snapshotLevels(pack, items) {
    this.pack(pack);
    const out = items.map(it => {
      const lv = this.level(pack, it.name);
      const r = lv && this.db.get('SELECT * FROM revisions WHERE level_id=? AND rev=?', lv.id, it.rev);
      if (!lv || lv.deleted || !r || r.blob_sha == null || r.blob_sha !== it.sha) throw new ApiError(409, `Level ${it.name} r${it.rev} không khớp bản đã kiểm tra — bấm Kiểm tra lại`);
      return {
        name: it.name, level_no: it.level, rev: it.rev, sha: r.blob_sha, author: r.author, updated_at: iso(r.created_at),
        head_rev: lv.head_rev, level: Store.decode(this.blob(r.blob_sha)),
      };
    });
    return out.sort((a, b) => a.level_no - b.level_no || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  listRevisions(pack, name) {
    this.pack(pack);
    const lv = this.level(pack, name);
    if (!lv) throw new ApiError(404, `Không có level ${pack}/${name}`);
    const rows = this.db.all('SELECT * FROM revisions WHERE level_id=? ORDER BY rev DESC', lv.id);
    const bodies = rows.map(r => this.bodyOrNull(r.blob_sha));
    return rows.map((r, i) => ({ ...this.revJson(r), changes: i + 1 < rows.length ? this.game.changes(bodies[i + 1], bodies[i]) : null }));
  }

  revisionRow(pack, name, rev) {
    this.pack(pack);
    const lv = this.level(pack, name);
    const r = lv && this.db.get('SELECT * FROM revisions WHERE level_id=? AND rev=?', lv.id, rev);
    if (!r) throw new ApiError(404, `Không có revision r${rev} của ${pack}/${name}`);
    return { lv, r };
  }

  getRevision(pack, name, rev) {
    const { r } = this.revisionRow(pack, name, rev);
    return { pack, name, ...this.revJson(r, true) };
  }

  revisionDiff(pack, name, rev) {
    const { lv, r } = this.revisionRow(pack, name, rev);
    const p = this.db.get('SELECT * FROM revisions WHERE level_id=? AND rev<? ORDER BY rev DESC LIMIT 1', lv.id, rev);
    const cur = this.bodyOrNull(r.blob_sha);
    const prev = p ? this.bodyOrNull(p.blob_sha) : null;
    return {
      pack, name, ...this.revJson(r), level: cur, prev: p ? { ...this.revJson(p), level: prev } : null,
      changes: this.game.changes(prev, cur),
    };
  }

  // ---------- level: ghi ----------
  saveLevel(user, pack, name, body, ifMatch, create, message = '') {
    const expected = parseIfMatch(ifMatch);
    Store.checkName(name);
    const data = canon(Store.parseBody(body));
    let mine;
    const res = this.db.write(() => {
      this.writable(pack);
      mine = this.denyIfLocked(pack, name, user);
      const lv = this.level(pack, name);
      if (create) {
        if (lv && !lv.deleted) throw new ApiError(409, `Level ${pack}/${name} đã có (head r${lv.head_rev}), dùng PUT`, { head_rev: lv.head_rev });
      } else {
        if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${name} (tạo mới dùng POST)`);
        if (expected == null) throw new ApiError(428, 'PUT cần header If-Match: "r<rev>"');
        if (expected !== lv.head_rev) this.conflict(lv, pack, name, expected);
        const h = this.head(lv);
        if (h.blob_sha === sha256(data)) return { unchanged: true, rev: lv.head_rev, sha: h.blob_sha };
      }
      const r = this.writeRev(pack, name, data, user, create ? 'create' : 'update', { message, unlocked: !mine, diff: true });
      this.audit(user, create ? 'level.create' : 'level.update', pack, name, r.rev, { unlocked_edit: !mine, if_match: expected, ...changesDetail(r) });
      return r;
    });
    if (res.unchanged) return { pack, name, rev: res.rev, unchanged: true, sha: res.sha, unlocked_edit: false };
    const out = { pack, name, rev: res.rev, sha: res.sha, unlocked_edit: !mine, author: user, summary: res.summary, changes: res.changes };
    this.broker.publish(create ? 'level.created' : 'level.updated', out);
    return out;
  }

  deleteLevel(user, pack, name, ifMatch) {
    const expected = parseIfMatch(ifMatch);
    const rev = this.db.write(() => {
      this.writable(pack);
      const mine = this.denyIfLocked(pack, name, user);
      const lv = this.level(pack, name);
      if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${name}`);
      if (expected == null) throw new ApiError(428, 'DELETE cần header If-Match: "r<rev>"');
      if (expected !== lv.head_rev) this.conflict(lv, pack, name, expected);
      const r = this.writeRev(pack, name, null, user, 'delete', { unlocked: !mine });
      this.audit(user, 'level.delete', pack, name, r.rev, { unlocked_edit: !mine });
      return r.rev;
    });
    const out = { pack, name, rev, author: user };
    this.broker.publish('level.deleted', out);
    return out;
  }

  revert(user, pack, name, toRev, ifMatch, message = '') {
    const expected = parseIfMatch(ifMatch);
    let mine, wasDeleted;
    const res = this.db.write(() => {
      this.writable(pack);
      mine = this.denyIfLocked(pack, name, user);
      const lv = this.level(pack, name);
      if (!lv) throw new ApiError(404, `Không có level ${pack}/${name}`);
      if (expected == null) throw new ApiError(428, 'revert cần header If-Match: "r<rev>"');
      if (expected !== lv.head_rev) this.conflict(lv, pack, name, expected);
      const t = this.db.get('SELECT * FROM revisions WHERE level_id=? AND rev=?', lv.id, toRev);
      if (!t) throw new ApiError(404, `Không có revision r${toRev}`);
      if (t.blob_sha == null) throw new ApiError(400, `r${toRev} là revision xoá, không revert về được`);
      wasDeleted = !!lv.deleted;
      const r = this.writeRev(pack, name, this.blob(t.blob_sha), user, 'revert', {
        message: message || `revert về r${toRev}`, unlocked: !mine, diff: true,
        meta: { reverted_to: toRev, format: jsonOrNull(t.meta)?.format ?? null },
      });
      this.audit(user, 'level.revert', pack, name, r.rev, { reverted_to: toRev, unlocked_edit: !mine, ...changesDetail(r) });
      return r;
    });
    const out = { pack, name, rev: res.rev, sha: res.sha, reverted_to: toRev, unlocked_edit: !mine, author: user, summary: res.summary };
    this.broker.publish(wasDeleted ? 'level.created' : 'level.updated', out);
    return out;
  }

  // ---------- đổi số level ----------
  relevelPlan(pack, src, dst, mode, lv) {
    if (mode === 'swap') {
      const other = this.level(pack, dst);
      return [[lv, dst], ...(other ? [[other, src]] : [])];
    }
    const a = Number(src), b = Number(dst);
    const [lo, hi, step] = a < b ? [a + 1, b, -1] : [b, a - 1, 1];
    const rows = this.db.all('SELECT * FROM levels WHERE pack=? AND sort_key BETWEEN ? AND ? ORDER BY sort_key', pack, lo, hi);
    return [[lv, dst], ...rows.map(r => [r, String(r.sort_key + step)])];
  }

  relevel(user, pack, src, dst, mode, ifMatch, dryRun = false) {
    if (mode !== 'swap' && mode !== 'shift') throw new ApiError(400, "mode phải là 'swap' hoặc 'shift'");
    for (const n of [src, dst]) Store.checkName(n);
    if (src === dst) throw new ApiError(400, 'Số mới trùng số cũ');
    const expected = parseIfMatch(ifMatch);
    const run = () => {
      const p = this.writable(pack, mode === 'swap' ? 'swap' : 'edit');
      const lv = this.level(pack, src);
      if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${src}`);
      const plan = this.relevelPlan(pack, src, dst, mode, lv);
      const names = [...new Set([...plan.map(([r]) => r.name), ...plan.map(([, n]) => n)])].sort((x, y) => Number(x) - Number(y));
      const locked = names.map(n => [n, this.lock(pack, n)]).filter(([, lk]) => lk).map(([n, lk]) => ({ level: n, holder: lk.holder, since: iso(lk.since) }));
      if (dryRun) return { pack, mode, dry_run: true, locked, moves: plan.map(([r, n]) => ({ from: r.name, to: n, deleted: !!r.deleted })) };
      if (expected == null) throw new ApiError(428, 'relevel cần header If-Match: "r<rev>"');
      if (expected !== lv.head_rev) this.conflict(lv, pack, src, expected);
      if (locked.length) throw new ApiError(423, `Level ${pack}/${locked[0].level} đang bị ${locked[0].holder} khoá`, { locked });
      return { pack, mode, moves: this.applyMoves(pack, p, plan, user, mode), author: user };
    };
    if (dryRun) return run();
    const out = this.db.write(run);
    this.broker.publish('levels.renumbered', out);
    return out;
  }

  /** Ghi một kế hoạch đổi số [[level, số mới]] (trong transaction): mỗi level còn sống nhận revision 'relevel'. */
  applyMoves(pack, p, plan, user, mode) {
    const occupant = new Map(plan.map(([r]) => [r.name, r]));
    const objs = new Map(plan.filter(([r]) => !r.deleted).map(([r]) => [r.id, Store.decode(this.blob(this.head(r).blob_sha))]));
    if (p.production) {
      const finals = plan.filter(([r]) => !r.deleted);
      const checks = this.validate(finals.map(([r, n]) => [n, objs.get(r.id)]));
      const bad = finals.map(([r, n], i) => [r, n, checks[i]]).filter(([, , v]) => !v.isValid);
      if (bad.length) {
        const [r0, n0, v0] = bad[0];
        throw new ApiError(422, `Bộ production: level ${pack}/${r0.name} ở số mới ${n0} lỗi: ${v0.errors[0]}`, {
          validation: bad.map(([r, n, v]) => ({ level: r.name, to: n, errors: v.errors.slice(0, 20) })),
        });
      }
    }
    for (const [r] of plan) this.db.run('UPDATE levels SET name=? WHERE id=?', `~relevel~${r.id}`, r.id);
    const moves = [];
    for (const [r, n] of plan) {
      this.db.run('UPDATE levels SET name=?, sort_key=? WHERE id=?', n, Number(n), r.id);
      let res = null;
      if (!r.deleted) {
        const obj = this.game.setNumber(objs.get(r.id), Number(n));
        const prev = occupant.get(n);
        res = this.writeRev(pack, n, canon(obj), user, 'relevel', {
          message: `đổi số level ${r.name} → ${n}`, meta: { relevel_from: r.name, mode },
          rev: Math.max(r.head_rev, prev ? prev.head_rev : 0) + 1,
        });
      }
      this.audit(user, 'level.relevel', pack, n, res?.rev ?? null, { relevel_from: r.name, mode });
      moves.push({ from: r.name, to: n, rev: res?.rev ?? null, deleted: !!r.deleted });
    }
    return moves;
  }

  /**
   * Xếp lại cả bộ: `order` là tên các level còn sống theo thứ tự mới, các số (slot) của bộ giữ nguyên, level thứ i nhận
   * số nhỏ thứ i. `base` là thứ tự client đang thấy: bộ đã đổi kể từ đó thì 409 kèm thứ tự hiện tại.
   */
  reorder(user, pack, order, base, dryRun = false) {
    if (!Array.isArray(order) || !order.every(n => typeof n === 'string')) throw new ApiError(400, 'order phải là mảng tên level');
    const run = () => {
      const p = this.writable(pack, 'swap');
      const alive = this.db.all('SELECT * FROM levels WHERE pack=? AND deleted=0 ORDER BY sort_key, name', pack);
      const current = alive.map(r => r.name);
      if (Array.isArray(base) && base.join() !== current.join()) {
        throw new ApiError(409, 'Bộ vừa có người đổi số hoặc thêm / xoá level — tải lại rồi xếp lại', { order: current });
      }
      if (order.length !== current.length || new Set(order).size !== order.length || order.some(n => !current.includes(n))) {
        throw new ApiError(400, 'order phải gồm đúng mỗi level còn sống của bộ một lần', { order: current });
      }
      const byName = new Map(alive.map(r => [r.name, r]));
      const plan = order.map((n, i) => [byName.get(n), current[i]]).filter(([r, to]) => r.name !== to);
      const locked = plan.map(([r]) => [r.name, this.lock(pack, r.name)]).filter(([, lk]) => lk && lk.holder !== user)
        .map(([n, lk]) => ({ level: n, holder: lk.holder }));
      if (dryRun) return { pack, dry_run: true, locked, moves: plan.map(([r, to]) => ({ from: r.name, to })) };
      if (locked.length) throw new ApiError(423, `Level ${pack}/${locked[0].level} đang bị ${locked[0].holder} khoá`, { locked });
      const moves = plan.length ? this.applyMoves(pack, p, plan, user, 'reorder') : [];
      if (moves.length) this.audit(user, 'pack.reorder', pack, null, null, { moved: moves.length, before: current });
      return { pack, mode: 'reorder', moves, before: current, author: user };
    };
    if (dryRun) return run();
    const out = this.db.write(run);
    if (out.moves.length) this.broker.publish('levels.renumbered', out);
    return out;
  }

  // ---------- khoá ----------
  acquireLock(user, pack, name) {
    Store.checkName(name);
    let mine;
    const l = this.db.write(() => {
      const t = now();
      this.writable(pack);
      mine = this.denyIfLocked(pack, name, user);
      if (mine) {
        this.db.run('UPDATE locks SET expires_at=? WHERE pack=? AND name=?', t + this.s.lockTtl, pack, name);
      } else {
        this.db.run('INSERT OR REPLACE INTO locks(pack,name,holder,since,expires_at) VALUES(?,?,?,?,?)', pack, name, user, t, t + this.s.lockTtl);
        this.audit(user, 'lock.acquire', pack, name);
      }
      return this.lock(pack, name);
    });
    const out = { pack, level: name, ttl: this.s.lockTtl, ...Store.lockJson(l) };
    if (!mine) this.broker.publish('lock.acquired', out);
    return out;
  }

  heartbeatLock(user, pack, name) {
    const l = this.db.write(() => {
      this.pack(pack);
      const cur = this.lock(pack, name);
      if (!cur || cur.holder !== user) {
        throw new ApiError(409, 'Mất khoá (hết hạn hoặc người khác giữ) — khoá lại bằng POST', { lost: true, lock: Store.lockJson(cur) });
      }
      this.db.run('UPDATE locks SET expires_at=? WHERE pack=? AND name=?', now() + this.s.lockTtl, pack, name);
      return this.lock(pack, name);
    });
    return { pack, level: name, ttl: this.s.lockTtl, ...Store.lockJson(l) };
  }

  releaseLock(user, pack, name, force = false) {
    const r = this.db.write(() => {
      this.pack(pack);
      const l = this.lock(pack, name);
      if (!l) {
        this.db.run('DELETE FROM locks WHERE pack=? AND name=?', pack, name);
        return null;
      }
      const forced = l.holder !== user;
      if (forced && !force) {
        throw new ApiError(423, `Khoá do ${l.holder} giữ — dùng ?force=1 để phá (có ghi audit)`, { holder: l.holder, since: iso(l.since), expires_at: iso(l.expires_at) });
      }
      this.db.run('DELETE FROM locks WHERE pack=? AND name=?', pack, name);
      if (forced) this.audit(user, 'lock.force_unlock', pack, name, null, { previous_holder: l.holder, since: iso(l.since) });
      else this.audit(user, 'lock.release', pack, name);
      return { holder: l.holder, forced };
    });
    if (!r) return { released: false, detail: 'không có khoá' };
    const out = { pack, level: name, released: true, by: user, holder: r.holder, forced: r.forced };
    this.broker.publish('lock.released', out);
    return out;
  }

  // ---------- promote ----------
  promote(user, src, dst, items, message = '') {
    if (!Array.isArray(items) || !items.length) throw new ApiError(400, 'Cần {"items": [{"name": "<số>", "to": "<số đích, mặc định cùng số>"}]}');
    if (src === dst) throw new ApiError(400, 'Bộ nguồn trùng bộ đích');
    this.pack(src);
    const pairs = [];
    for (const it of items) {
      const name = String(isObject(it) ? it.name : it);
      const to = isObject(it) ? String(it.to || name) : name;
      Store.checkName(name);
      Store.checkName(to);
      const lv = this.level(src, name);
      if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${src}/${name}`);
      const h = this.head(lv);
      pairs.push([name, to, h.rev, this.game.setNumber(Store.decode(this.blob(h.blob_sha)), Number(to))]);
    }
    if (new Set(pairs.map(([, to]) => to)).size !== pairs.length) throw new ApiError(400, 'Hai level cùng chép vào một số đích');
    const checks = this.validate(pairs.map(([, to, , obj]) => [to, obj]));
    const bad = pairs.map(([n, to], i) => [n, to, checks[i]]).filter(([, , v]) => !v.isValid);
    if (bad.length) {
      const [n0, , v0] = bad[0];
      throw new ApiError(422, `Level ${src}/${n0} chưa qua kiểm định: ${v0.errors[0]}`, {
        validation: bad.map(([n, to, v]) => ({ level: n, to, errors: v.errors.slice(0, 20) })),
      });
    }
    const results = this.db.write(() => {
      this.writable(dst, 'copy');
      const locked = pairs.map(([, to]) => [to, this.lock(dst, to)]).filter(([, l]) => l && l.holder !== user).map(([to, l]) => ({ level: to, holder: l.holder }));
      if (locked.length) throw new ApiError(423, `${locked.length} level ở bộ đích đang bị khoá — không chép gì`, { locked });
      const out = [];
      for (const [name, to, srcRev, obj] of pairs) {
        const data = canon(obj);
        const lv = this.level(dst, to);
        if (lv && !lv.deleted && this.head(lv).blob_sha === sha256(data)) {
          out.push({ name, to, rev: lv.head_rev, unchanged: true });
          continue;
        }
        const r = this.writeRev(dst, to, data, user, 'promote', {
          message: message || `promote từ ${src}/${name} r${srcRev}`, meta: { from_pack: src, from_level: name, from_rev: srcRev }, diff: true,
        });
        this.audit(user, 'level.promote', dst, to, r.rev, { from_pack: src, from_level: name, from_rev: srcRev, ...changesDetail(r) });
        out.push({ name, to, rev: r.rev, created: r.created });
      }
      return out;
    });
    this.broker.publish('pack.imported', { pack: dst, author: user, changed: results.filter(r => !r.unchanged).map(r => r.to) });
    return { from: src, to: dst, items: results, author: user };
  }

  validatePack(pack) {
    const b = this.bundle(pack);
    const res = this.validate(b.levels.map(lv => [lv.name, lv.level]));
    return b.levels.map((lv, i) => ({ name: lv.name, ...res[i] }));
  }

  // ---------- nhập / xuất ----------
  static readImport(body, contentType, folder) {
    const entries = [], skipped = [];
    if ((body[0] === 0x50 && body[1] === 0x4b) || String(contentType || '').includes('zip')) {
      let files;
      try {
        files = readZip(body, { maxTotalBytes: MAX_IMPORT_TOTAL });
      } catch (e) {
        throw new ApiError(/quá lớn|quá nhiều/.test(e.message) ? 413 : 400, `File zip hỏng: ${e.message}`);
      }
      const seen = new Map();
      for (const f of files) {
        const p = path.posix.normalize(f.name.replace(/\\/g, '/'));
        const parts = p.split('/');
        const file = parts.at(-1);
        if (path.posix.extname(file).toLowerCase() !== '.json' || parts.includes('__MACOSX') || file.startsWith('._')) continue;
        if (folder && !parts.slice(0, -1).includes(folder)) continue;
        const name = file.slice(0, -5);
        if (!NAME_RE.test(name)) {
          skipped.push(p);
          continue;
        }
        if (seen.has(name)) throw new ApiError(400, `Trùng level '${name}': ${seen.get(name)} và ${p} — chọn ?folder=`);
        seen.set(name, p);
        if (f.data.length > MAX_IMPORT_ENTRY || entries.length >= MAX_IMPORT_FILES) {
          throw new ApiError(413, `Zip quá lớn: tối đa ${MAX_IMPORT_FILES} file, mỗi file ${MAX_IMPORT_ENTRY >> 20} MB, tổng ${MAX_IMPORT_TOTAL >> 20} MB sau giải nén`);
        }
        entries.push([name, f.data]);
      }
    } else {
      let data;
      try {
        data = JSON.parse(stripBom(body.toString('utf8')));
      } catch (e) {
        throw new ApiError(400, `Body không phải JSON/zip: ${e.message}`);
      }
      if (isObject(data) && isObject(data.levels)) data = data.levels;
      if (!isObject(data)) throw new ApiError(400, 'JSON import phải là object {"<số>": level}');
      for (const [k, v] of Object.entries(data)) entries.push([String(k), canon(v)]);
    }
    return { entries, skipped };
  }

  importStatus(pack, name, sha, user, force) {
    const lv = this.level(pack, name);
    const alive = !!lv && !lv.deleted;
    const head = alive ? this.head(lv).blob_sha : null;
    if (head === sha) return ['unchanged', {}];
    const lk = this.lock(pack, name);
    if (lk && lk.holder !== user) return ['locked', { holder: lk.holder }];
    if (!alive) return ['created', {}];
    const base = this.db.get("SELECT rev, blob_sha FROM revisions WHERE level_id=? AND kind='import' ORDER BY rev DESC LIMIT 1", lv.id);
    if (force || (base && base.blob_sha === head)) return ['updated', {}];
    const info = { head_rev: lv.head_rev, author: this.head(lv).author, base_rev: base ? base.rev : null };
    return [base && base.blob_sha === sha ? 'waiting' : 'conflict', info];
  }

  importLevels(user, pack, body, contentType, { folder = null, message = '', dryRun = false, force = false } = {}) {
    this.writable(pack);
    const { entries, skipped } = Store.readImport(body, contentType, folder);
    if (!entries.length) throw new ApiError(400, 'Không có level nào để import', { skipped });
    const errors = [], prepared = [];
    for (const [name, raw] of entries) {
      if (!NAME_RE.test(name)) {
        errors.push({ name, status: 'error', detail: 'Tên level phải là số nguyên dương' });
        continue;
      }
      let obj;
      try {
        obj = Store.decode(raw);
      } catch (e) {
        errors.push({ name, status: 'error', detail: `Không phải JSON: ${e.message}` });
        continue;
      }
      if (!isObject(obj)) {
        errors.push({ name, status: 'error', detail: 'Level phải là JSON object' });
        continue;
      }
      prepared.push([name, obj, canon(obj)]);
    }
    const checks = this.validate(prepared.map(([n, o]) => [n, o]));
    const plan = () => prepared.map(([name, , data], i) => {
      const [status, info] = this.importStatus(pack, name, sha256(data), user, force);
      const item = { name, status, ...info };
      if (!checks[i].isValid) item.errors = checks[i].errors.slice(0, 5);
      return [item, data];
    });
    let items;
    if (dryRun) {
      items = [...plan().map(([it]) => it), ...errors];
    } else {
      items = this.db.write(() => {
        const planned = plan();
        for (const [item, data] of planned) {
          if (item.status !== 'created' && item.status !== 'updated') continue;
          item.rev = this.writeRev(pack, item.name, data, user, 'import', { message: message || 'nhập từ file', diff: true }).rev;
        }
        const all = [...planned.map(([it]) => it), ...errors];
        const counts = importCounts(all);
        this.audit(user, 'pack.import', pack, null, null, {
          skipped: skipped.length, force, ...Object.fromEntries(Object.entries(counts).filter(([, v]) => v)),
        });
        return all;
      });
    }
    items.sort((a, b) => (Number(a.name) || 0) - (Number(b.name) || 0) || String(a.name).localeCompare(String(b.name)));
    const out = { pack, dry_run: dryRun, ...importCounts(items), items, skipped };
    if (!dryRun) this.broker.publish('pack.imported', { pack, author: user, changed: items.filter(it => 'rev' in it).map(it => it.name) });
    return out;
  }

  exportPack(pack) {
    this.pack(pack);
    const rows = this.db.all(`SELECT l.name, r.blob_sha FROM levels l JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev
      WHERE l.pack=? AND l.deleted=0 ORDER BY l.sort_key`, pack);
    return createZip(rows.map(r => ({ name: `${pack}/${r.name}.json`, data: pretty(Store.decode(this.blob(r.blob_sha))) })));
  }

  // ---------- audit ----------
  listAudit({ user = null, since = null, level = null, pack = null, action = null, limit = 200 } = {}) {
    let q = 'SELECT * FROM audit WHERE 1=1';
    const args = [];
    for (const [col, v] of [['user', user], ['level', level], ['pack', pack], ['action', action]]) {
      if (!v) continue;
      q += ` AND ${col}=?`;
      args.push(col === 'user' ? v.toLowerCase() : v);
    }
    if (since != null) {
      q += ' AND ts>=?';
      args.push(since);
    }
    q += ' ORDER BY id DESC LIMIT ?';
    args.push(Math.max(1, Math.min(Number(limit) || 200, 5000)));
    return this.db.all(q, ...args).map(r => ({
      id: r.id, ts: iso(r.ts), user: r.user, action: r.action, pack: r.pack, level: r.level, rev: r.rev, detail: jsonOrNull(r.detail),
    }));
  }
}
