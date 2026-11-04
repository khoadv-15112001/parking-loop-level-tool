// Link chơi thử trên điện thoại (server Node): mỗi link ghim đúng nội dung một level (revision, hoặc bản nháp lúc tạo
// link), mở không cần đăng nhập ở /p/<token>, có hạn (mặc định linkDays trong Quản trị) và thu hồi được. Trang /p/<token>
// tải bản game đang dùng qua /p/<token>/game/ và ghi lượt chơi vào bảng plays (user `link:<token>`, tên người chơi tự nhập).
import crypto from 'node:crypto';
import { ApiError } from './http.mjs';
import { iso, now, Store } from './store.mjs';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,40}$/;
const canon = obj => Buffer.from(JSON.stringify(obj), 'utf8');

export class Links {
  constructor(db, store, admin) {
    Object.assign(this, { db, store, admin });
  }

  static row(r) {
    const t = now();
    return {
      token: r.token, path: `/p/${r.token}`, pack: r.pack, level: r.level, rev: r.rev, sha: r.sha, name: r.name,
      created_by: r.created_by, created_at: iso(r.created_at), expires_at: iso(r.expires_at), revoked_at: iso(r.revoked_at),
      opens: r.opens, active: r.revoked_at == null && r.expires_at > t,
    };
  }

  /** Link cho level `level` của bộ `pack`: `level_data` (bản nháp đang mở) hoặc revision `rev` hoặc head. */
  create(user, body) {
    const { pack, level } = body;
    Store.checkName(String(level ?? ''));
    const days = body.days == null ? this.admin.settings().linkDays : body.days;
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new ApiError(400, 'days là số ngày 1–90');
    const name = String(body.name ?? '').trim().slice(0, 80);
    return this.db.write(() => {
      this.store.pack(pack);
      const lv = this.store.level(pack, String(level));
      if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${level}`);
      let sha, rev = null;
      if (body.level_data != null) {
        if (typeof body.level_data !== 'object' || Array.isArray(body.level_data)) throw new ApiError(400, 'level_data phải là JSON object');
        sha = this.store.putBlob(canon(body.level_data));
      } else {
        rev = Number.isInteger(body.rev) ? body.rev : lv.head_rev;
        const r = this.db.get('SELECT blob_sha FROM revisions WHERE level_id=? AND rev=?', lv.id, rev);
        if (!r || r.blob_sha == null) throw new ApiError(404, `Không có r${rev} của level ${pack}/${level}`);
        sha = r.blob_sha;
      }
      const token = crypto.randomBytes(12).toString('base64url');
      const t = now();
      this.db.run(`INSERT INTO share_links(token,pack,level,rev,sha,name,created_by,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, token, pack, String(level), rev, sha, name, user, t, t + days * 86400);
      this.store.audit(user, 'link.create', pack, String(level), rev, { days, draft: rev == null });
      return Links.row(this.db.get('SELECT * FROM share_links WHERE token=?', token));
    });
  }

  list({ pack = null, level = null } = {}) {
    return this.db.all(`SELECT * FROM share_links WHERE (? IS NULL OR pack=?) AND (? IS NULL OR level=?)
      ORDER BY created_at DESC LIMIT 200`, pack, pack, level, level).map(Links.row);
  }

  revoke(user, token) {
    return this.db.write(() => {
      const r = this.db.get('SELECT * FROM share_links WHERE token=?', token);
      if (!r) throw new ApiError(404, 'Không có link này');
      if (r.created_by !== user && !this.admin.isAdmin(user)) throw new ApiError(403, 'Chỉ người tạo link hoặc admin được thu hồi');
      if (r.revoked_at == null) {
        this.db.run('UPDATE share_links SET revoked_at=? WHERE token=?', now(), token);
        this.store.audit(user, 'link.revoke', r.pack, r.level, r.rev, {});
      }
      return Links.row(this.db.get('SELECT * FROM share_links WHERE token=?', token));
    });
  }

  /** Link còn dùng được, không thì 404 / 410. */
  active(token) {
    if (!TOKEN_RE.test(String(token || ''))) throw new ApiError(404, 'Link không tồn tại');
    const r = this.db.get('SELECT * FROM share_links WHERE token=?', token);
    if (!r) throw new ApiError(404, 'Link không tồn tại');
    if (r.revoked_at != null) throw new ApiError(410, 'Link đã bị thu hồi');
    if (r.expires_at <= now()) throw new ApiError(410, 'Link đã hết hạn');
    return r;
  }

  /** Nội dung cho trang /p/<token>: level ghim trong link, tên tool, giao thức khung game. Đếm số lần mở. */
  info(token, game) {
    const r = this.active(token);
    this.db.write(() => this.db.run('UPDATE share_links SET opens=opens+1 WHERE token=?', token));
    const m = game.manifest;
    const storage = (m.storagePrefix || m.prefix).toLowerCase();
    return {
      tool: m.tool, game: m.game, pack: r.pack, level: r.level, rev: r.rev, name: r.name, expires_at: iso(r.expires_at),
      level_data: this.store.bodyOrNull(r.sha),
      webgame: { id: `${storage}-game`, tag: m.prefix, ...(m.webgame || {}) },
    };
  }
}
