// Quản trị trong app (server Node): cài đặt lưu trong bảng settings, sửa ở hộp Quản trị của web.
//   admins       email admin thêm trong app (cộng với <PREFIX>_ADMINS); cả hai rỗng thì chỉ máy DEV là admin
//   permissions  ai được làm từng việc: 'admin' | 'everyone'
//   notice       dải thông báo chung {text, level}
//   trashDays    số ngày giữ level đã xoá / bộ đã lưu trữ trước khi xoá hẳn; linkDays: hạn mặc định link chơi thử
// Mỗi lần lưu tăng `version`; lưu từ bản cũ thì 409 (hai admin cùng sửa).
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './http.mjs';
import { iso, now } from './store.mjs';
import { storageRoots, storageUsage, requireStorage, maintainBackups, compressBackup, diskBytes } from './storage.mjs';

export const ACTIONS = {
  production: 'Bật / tắt bộ production',
  archive: 'Lưu trữ bộ, khôi phục bộ đã lưu trữ',
  breakLock: 'Phá khoá level của người khác',
  gameBuilds: 'Tải lên, chọn, xoá bản game WebGL',
  levelhubUpload: 'Đẩy bộ lên BI Level Hub',
  shareLinks: 'Tạo link chơi thử trên điện thoại',
  reorder: 'Xếp lại thứ tự level của bộ',
};
const DEFAULT_PERMISSIONS = {
  production: 'admin', archive: 'admin', breakLock: 'admin', gameBuilds: 'admin',
  levelhubUpload: 'everyone', shareLinks: 'everyone', reorder: 'everyone',
};
const DEFAULTS = { admins: [], permissions: DEFAULT_PERMISSIONS, notice: { text: '', level: 'info' }, trashDays: 30, linkDays: 14 };
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const KEEP_BACKUPS = 7;
const BACKUP_NAME = /^[\w.-]+-\d{8}-\d{6}\.db(?:\.gz)?$/;

function dirSize(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((n, name) => n + dirSize(path.join(p, name)), 0);
  } catch {
    return 0;
  }
}

export class Admin {
  constructor(s, db, store) {
    Object.assign(this, { s, db, store });
    this.dataDir = path.dirname(db.file);
  }

  settings() {
    const out = { ...structuredClone(DEFAULTS), version: 0, updated_by: null, updated_at: null };
    for (const r of this.db.all('SELECT * FROM settings')) {
      if (r.key === '_version') {
        out.version = Number(r.value);
        out.updated_by = r.updated_by;
        out.updated_at = iso(r.updated_at);
      } else if (r.key in DEFAULTS) out[r.key] = JSON.parse(r.value);
    }
    out.permissions = { ...DEFAULT_PERMISSIONS, ...out.permissions };
    return out;
  }

  /** Lưu các khoá có trong patch. `version` phải bằng bản đang có. */
  update(user, patch, version) {
    const clean = {};
    if (patch.admins != null) {
      if (!Array.isArray(patch.admins)) throw new ApiError(400, 'admins phải là mảng email');
      clean.admins = [...new Set(patch.admins.map(a => String(a).trim().toLowerCase()).filter(Boolean))];
      const bad = clean.admins.find(a => !EMAIL_RE.test(a));
      if (bad) throw new ApiError(400, `Email không hợp lệ: ${bad}`);
    }
    if (patch.permissions != null) {
      clean.permissions = {};
      for (const [k, v] of Object.entries(patch.permissions)) {
        if (!ACTIONS[k]) throw new ApiError(400, `Không có việc '${k}'`);
        if (v !== 'admin' && v !== 'everyone') throw new ApiError(400, `${k}: chỉ 'admin' hoặc 'everyone'`);
        clean.permissions[k] = v;
      }
    }
    if (patch.notice != null) {
      const text = String(patch.notice.text ?? '').trim();
      if (text.length > 300) throw new ApiError(400, 'Thông báo tối đa 300 ký tự');
      clean.notice = { text, level: ['info', 'warn'].includes(patch.notice.level) ? patch.notice.level : 'info' };
    }
    for (const [k, lo, hi] of [['trashDays', 1, 365], ['linkDays', 1, 90]]) {
      if (patch[k] == null) continue;
      if (!Number.isInteger(patch[k]) || patch[k] < lo || patch[k] > hi) throw new ApiError(400, `${k} phải là số ngày ${lo}–${hi}`);
      clean[k] = patch[k];
    }
    const out = this.db.write(() => {
      const cur = this.settings();
      if (version !== cur.version) {
        throw new ApiError(409, `${cur.updated_by || 'Người khác'} vừa lưu cài đặt — tải lại rồi sửa tiếp`, { settings: cur });
      }
      if (clean.admins && this.s.admins.length === 0 && clean.admins.length && !clean.admins.includes(user) && !this.s.dev) {
        throw new ApiError(400, 'Danh sách admin phải có chính bạn, không thì bạn tự mất quyền admin');
      }
      const t = now();
      for (const [k, v] of Object.entries(clean)) {
        this.db.run('INSERT OR REPLACE INTO settings(key,value,updated_by,updated_at) VALUES(?,?,?,?)', k, JSON.stringify(v), user, t);
      }
      this.db.run('INSERT OR REPLACE INTO settings(key,value,updated_by,updated_at) VALUES(?,?,?,?)', '_version', String(cur.version + 1), user, t);
      this.store.audit(user, 'admin.settings', null, null, null, { keys: Object.keys(clean) });
      return this.settings();
    });
    this.store.broker.publish('settings.updated', { author: user, version: out.version, notice: out.notice });
    return out;
  }

  isAdmin(email) {
    const e = String(email || '').toLowerCase();
    const extra = this.settings().admins;
    if (this.s.admins.length || extra.length) return this.s.admins.includes(e) || extra.includes(e);
    return this.s.dev;
  }

  can(email, action) {
    return this.settings().permissions[action] === 'everyone' || this.isAdmin(email);
  }

  require(email, action) {
    if (!this.can(email, action)) throw new ApiError(403, `Chỉ admin được: ${(ACTIONS[action] || action).toLowerCase()}`);
  }

  requireAdmin(email, what) {
    if (!this.isAdmin(email)) throw new ApiError(403, `Chỉ admin được ${what}`);
  }

  /** Quyền của một người, cho web ẩn nút. */
  rights(email) {
    return Object.fromEntries(Object.keys(ACTIONS).map(k => [k, this.can(email, k)]));
  }

  storage(builds) {
    const db = ['', '-wal', '-shm'].reduce((n, x) => n + dirSize(this.db.file + x), 0);
    const count = sql => this.db.get(sql).n;
    const { bytes: totalBytes, ...policy } = storageUsage(storageRoots(this.s));
    return {
      totalBytes, ...policy,
      database: db, game: dirSize(builds.dir) + dirSize(builds.buildsDir), uploads: dirSize(builds.uploadsDir),
      backups: dirSize(path.join(this.dataDir, 'backups')), purged: dirSize(path.join(this.dataDir, 'purged')),
      counts: {
        levels: count('SELECT COUNT(*) n FROM levels'), revisions: count('SELECT COUNT(*) n FROM revisions'),
        plays: count('SELECT COUNT(*) n FROM plays'), thumbs: count('SELECT COUNT(*) n FROM thumbs'),
        links: count('SELECT COUNT(*) n FROM share_links WHERE revoked_at IS NULL AND expires_at>' + now()),
      },
    };
  }

  backup(user) {
    if (this.backupPending) return this.backupPending;
    this.backupPending = this.createBackup(user).finally(() => { this.backupPending = null; });
    return this.backupPending;
  }

  maintainBackups() {
    if (this.backupWriting) return Promise.resolve([]);
    if (this.maintenancePending) return this.maintenancePending;
    this.maintenancePending = maintainBackups(path.join(this.dataDir, 'backups'), BACKUP_NAME, KEEP_BACKUPS)
      .finally(() => { this.maintenancePending = null; });
    return this.maintenancePending;
  }

  async createBackup(user) {
    await this.maintainBackups();
    const dir = path.join(this.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const file = path.join(dir, `${path.basename(this.db.file, '.db')}-${stamp}.db`);
    if (fs.existsSync(file) || fs.existsSync(`${file}.gz`)) throw new ApiError(409, 'Vừa sao lưu xong, đợi một giây rồi thử lại');
    requireStorage(storageRoots(this.s), diskBytes(this.db.file) * 2, ApiError);
    this.backupWriting = true;
    try {
      this.db.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      await compressBackup(file);
      await maintainBackups(dir, BACKUP_NAME, KEEP_BACKUPS);
    } catch (error) {
      fs.rmSync(file, { force: true });
      throw error;
    } finally {
      this.backupWriting = false;
    }
    this.db.write(() => this.store.audit(user, 'admin.backup', null, null, null, { file: path.basename(`${file}.gz`) }));
    return { file: path.basename(`${file}.gz`), size: fs.statSync(`${file}.gz`).size, kept: KEEP_BACKUPS };
  }
}
