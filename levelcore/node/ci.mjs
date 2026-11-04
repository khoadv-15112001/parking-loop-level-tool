// Nhận player WebGL và level từ Jenkins cho server Node — cùng hợp đồng CI v1 và cùng luật với
// levelcore/server/levelcore/ci.py: token riêng <PREFIX>_CI_TOKEN, nhánh <PREFIX>_CI_BRANCH tự lên bản đang dùng,
// level chờ player cùng `by` (quá 2 giờ, player lỗi / bị xoá / bị dọn thì bỏ), level cùng digest đã nhập thì bỏ qua.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './http.mjs';
import { iso, now, Store } from './store.mjs';
import { requireStorage, diskBytes } from './storage.mjs';

const LEVELS_WAIT = 2 * 3600;
export const MAX_LEVELS_ZIP = 400 * 1024 * 1024;
const META_LIMITS = { version: 40, commit: 40, branch: 120, buildNumber: 20, buildUrl: 300, environment: 40 };
const COUNTS = ['created', 'updated', 'unchanged', 'conflict', 'waiting', 'locked', 'error'];

export const actor = by => `ci:${String(by || '').replace(/[^\w.@-]/g, '').slice(0, 60) || 'jenkins'}`;

export function cleanMeta(url) {
  const out = Object.fromEntries(Object.entries(META_LIMITS).map(([k, n]) => [k, String(url.searchParams.get(k) || '').trim().slice(0, n)]));
  if (!/^https?:\/\//.test(out.buildUrl)) out.buildUrl = '';
  return out;
}

export class Ci {
  constructor(s, db, store, broker, builds) {
    Object.assign(this, { s, db, store, broker, builds });
    this.pack = s.ciPack || s.defaultPacks[0] || 'develop';
    this.levelsDir = path.join(`${builds.dir}.ci`, 'levels');
  }

  checkToken(req) {
    if (!this.s.ciToken) throw new ApiError(503, `Server chưa bật nhận dữ liệu từ CI (thiếu ${this.s.envPrefix}_CI_TOKEN)`);
    const h = String(req.headers.authorization || '');
    const given = Buffer.from(h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '', 'utf8');
    const expected = Buffer.from(this.s.ciToken, 'utf8');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new ApiError(401, 'Token CI không đúng');
  }

  static row(r) {
    return {
      digest: r.digest, by: r.by, received_at: iso(r.received_at), status: r.status, build: r.build ?? null, pack: r.pack ?? null,
      detail: r.detail ? JSON.parse(r.detail) : null, updated_at: iso(r.updated_at),
    };
  }

  get(digest) {
    return this.db.get('SELECT * FROM ci_levels WHERE digest=?', digest);
  }

  finish(digest, status, detail, pack = null) {
    this.db.run('UPDATE ci_levels SET status=?, detail=?, pack=COALESCE(?, pack), updated_at=? WHERE digest=?', status, JSON.stringify(detail), pack, now(), digest);
    fs.rmSync(path.join(this.levelsDir, `${digest}.zip`), { force: true });
  }

  drop(where, args, reason) {
    return this.db.write(() => {
      const rows = this.db.all(`SELECT digest FROM ci_levels WHERE status='waiting' AND ${where}`, ...args);
      for (const r of rows) this.finish(r.digest, 'dropped', { reason });
      return rows.map(r => r.digest);
    });
  }

  expire() {
    this.drop('build IS NULL AND received_at<?', [now() - LEVELS_WAIT], 'quá 2 giờ chưa có player cùng lần chạy');
  }

  receipts(limit = 20) {
    return this.db.all('SELECT * FROM ci_levels ORDER BY updated_at DESC LIMIT ?', limit).map(Ci.row);
  }

  status() {
    const builds = this.builds.list();
    return {
      ok: true, tool: this.s.toolName, version: this.s.version, branch: this.s.ciBranch || null, pack: this.pack,
      current: builds.find(b => b.current) ?? null, waitingBuilds: builds.filter(b => b.status === 'waiting').length,
      waitingLevels: this.db.get("SELECT COUNT(*) n FROM ci_levels WHERE status='waiting'").n,
    };
  }

  receiveLevels(by, body) {
    if (body[0] !== 0x50 || body[1] !== 0x4b) throw new ApiError(400, 'Level từ CI phải là zip các file <số>.json');
    const { entries } = Store.readImport(body, 'application/zip', null);
    if (!entries.length) throw new ApiError(400, 'Zip level từ CI không có file <số>.json nào');
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const who = actor(by);
    return this.builds.serial(() => {
      this.expire();
      const r = this.get(digest);
      if (r && r.status === 'imported') return { status: 'duplicate', levels: Ci.row(r) };
      if (r && r.status === 'waiting' && r.by === who) return { status: 'waiting', levels: Ci.row(r) };
      fs.mkdirSync(this.levelsDir, { recursive: true });
      requireStorage(this.builds.storageRoots, Math.max(0, body.length - diskBytes(path.join(this.levelsDir, `${digest}.zip`))), ApiError);
      fs.writeFileSync(path.join(this.levelsDir, `${digest}.zip`), body);
      const t = now();
      this.db.write(() => {
        if (!r) this.db.run("INSERT INTO ci_levels(digest,by,received_at,status,updated_at) VALUES(?,?,?,'waiting',?)", digest, who, t, t);
        else this.db.run("UPDATE ci_levels SET by=?, received_at=?, status='waiting', build=NULL, pack=NULL, detail=NULL, updated_at=? WHERE digest=?", who, t, t, digest);
        this.store.audit(who, 'ci.levels', null, null, null, { digest, files: entries.length });
      });
      return { status: 'waiting', levels: Ci.row(this.get(digest)) };
    });
  }

  importLevels(digest, build) {
    const r = this.get(digest);
    let status, detail;
    try {
      const body = fs.readFileSync(path.join(this.levelsDir, `${digest}.zip`));
      const res = this.store.importLevels(r.by, this.pack, body, 'application/zip', { message: `CI ${r.by.slice(3)} · build ${build}` });
      detail = Object.fromEntries(COUNTS.map(k => [k, res[k]]));
      status = 'imported';
    } catch (e) {
      detail = { reason: e instanceof ApiError ? e.body.detail : e.message };
      status = 'error';
    }
    this.db.write(() => {
      this.db.run('UPDATE ci_levels SET build=? WHERE digest=?', build, digest);
      this.finish(digest, status, detail, this.pack);
    });
    return Ci.row(this.get(digest));
  }

  afterPrune(pruned) {
    for (const id of pruned) this.drop('build=?', [id], 'player đi kèm đã bị dọn');
  }

  publish(who, status, build, levels) {
    this.broker.publish('game.build', { status, build, author: who, levels: Array.isArray(levels) ? levels : levels ? [levels] : [] });
  }

  receivePlayer(by, file, meta, digest) {
    const who = actor(by);
    const tracked = !this.s.ciBranch || meta.branch === this.s.ciBranch;
    return this.builds.serial(async () => {
      this.expire();
      let out;
      try {
        out = await this.builds.installNow(file, who, { meta: { ...meta, source: 'ci', by: who }, activate: tracked, digest });
      } catch (e) {
        this.drop('by=? AND build IS NULL', [who], `player lỗi: ${e instanceof ApiError ? e.body.detail : e.message}`);
        throw e;
      }
      let levels = null;
      if (out.status !== 'unchanged') {
        const r = this.db.get("SELECT digest FROM ci_levels WHERE status='waiting' AND build IS NULL AND by=? ORDER BY received_at LIMIT 1", who);
        const id = out.build.id;
        if (r && out.status === 'current') {
          levels = this.importLevels(r.digest, id);
        } else if (r) {
          this.db.write(() => this.db.run('UPDATE ci_levels SET build=?, updated_at=? WHERE digest=?', id, now(), r.digest));
          levels = Ci.row(this.get(r.digest));
        }
        this.afterPrune(out.pruned);
        this.db.write(() => this.store.audit(who, 'ci.webgl', null, null, null, {
          build: id, status: out.status, branch: meta.branch, buildNumber: meta.buildNumber, levels: levels ? levels.digest : null,
        }));
        this.publish(who, out.status, out.build, levels);
      }
      return { status: out.status, build: out.build, levels };
    });
  }

  activate(user, id) {
    return this.builds.serial(async () => {
      const out = await this.builds.activateNow(id);
      const rows = this.db.all("SELECT digest FROM ci_levels WHERE status='waiting' AND build=? ORDER BY received_at", id);
      const levels = rows.map(r => this.importLevels(r.digest, id));
      this.afterPrune(out.pruned);
      this.db.write(() => this.store.audit(user, 'game.activate', null, null, null, { build: id, levels: levels.map(x => x.digest) }));
      this.publish(user, 'current', out.build, levels);
      return { build: out.build, levels };
    });
  }

  reject(user, id) {
    return this.builds.serial(() => {
      const build = this.builds.removeNow(id);
      const dropped = this.drop('build=?', [id], 'player đi kèm đã bị xoá');
      this.db.write(() => this.store.audit(user, 'game.remove', null, null, null, { build: id, dropped }));
      return { build, dropped };
    });
  }
}
