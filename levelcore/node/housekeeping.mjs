// Thùng rác và dọn dữ liệu (server Node). Level đã xoá và bộ đã lưu trữ nằm trong thùng rác `trashDays` ngày (Quản trị,
// mặc định 30), khôi phục được; quá hạn thì xoá hẳn khỏi database sau khi chép nội dung ra <data>/purged/<ngày>/
// (level: <bộ>/<số>.json, bộ: <bộ>.zip). Blob không còn revision, lượt chơi hay link nào dùng thì xoá theo. Lượt chơi
// giữ mãi (dữ liệu cho phân tích, AI). Chạy lúc khởi động và mỗi 6 giờ; admin chạy ngay ở Quản trị.
import fs from 'node:fs';
import path from 'node:path';
import { iso, now, Store } from './store.mjs';

const EVERY_MS = 6 * 3600 * 1000;
const LINK_GRACE = 30 * 86400;

export class Housekeeping {
  constructor(db, store, admin, pruneBuilds = () => []) {
    Object.assign(this, { db, store, admin, pruneBuilds });
    this.purgedDir = path.join(path.dirname(db.file), 'purged');
  }

  start() {
    const tick = async () => {
      try {
        await this.admin.maintainBackups();
        this.run('system');
      } catch (e) {
        console.error(`[housekeeping] ${e.message}`);
      }
    };
    this.first = setTimeout(tick, 10000);
    this.timer = setInterval(tick, EVERY_MS);
    this.first.unref?.();
    this.timer.unref?.();
  }

  stop() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  trash() {
    const days = this.admin.settings().trashDays;
    const purgeAt = t => (t == null ? null : iso(t + days * 86400));
    const levels = this.db.all(`SELECT l.pack, l.name, l.updated_at, l.updated_by FROM levels l JOIN packs p ON p.name=l.pack
      WHERE l.deleted=1 AND p.archived=0 ORDER BY l.updated_at DESC LIMIT 2000`)
      .map(r => ({ pack: r.pack, name: r.name, deleted_at: iso(r.updated_at), deleted_by: r.updated_by, purge_at: purgeAt(r.updated_at) }));
    const packs = this.db.all(`SELECT p.*, (SELECT COUNT(*) FROM levels l WHERE l.pack=p.name AND l.deleted=0) n FROM packs p
      WHERE p.archived=1 ORDER BY p.archived_at DESC`)
      .map(r => ({ name: r.name, archived_at: iso(r.archived_at), archive_reason: r.archive_reason, level_count: r.n, purge_at: purgeAt(r.archived_at) }));
    return { days, levels, packs };
  }

  write(rel, data) {
    const file = path.join(this.purgedDir, new Date().toISOString().slice(0, 10), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }

  dropLevel(lv) {
    this.db.run('DELETE FROM locks WHERE pack=? AND name=?', lv.pack, lv.name);
    this.db.run('DELETE FROM revisions WHERE level_id=?', lv.id);
    this.db.run('DELETE FROM levels WHERE id=?', lv.id);
  }

  /** Xoá hẳn những gì quá hạn trong thùng rác. Trả số đã dọn. */
  run(user = 'system') {
    const cutoff = now() - this.admin.settings().trashDays * 86400;
    const out = { levels: 0, packs: 0, blobs: 0, thumbs: 0, links: 0, builds: this.pruneBuilds() };
    this.db.write(() => this.db.run('UPDATE packs SET archived_at=? WHERE archived=1 AND archived_at IS NULL', now()));
    for (const lv of this.db.all('SELECT l.* FROM levels l JOIN packs p ON p.name=l.pack WHERE l.deleted=1 AND p.archived=0 AND l.updated_at<?', cutoff)) {
      const last = this.db.get('SELECT blob_sha FROM revisions WHERE level_id=? AND blob_sha IS NOT NULL ORDER BY rev DESC LIMIT 1', lv.id);
      if (last) this.write(path.join(lv.pack, `${lv.name}.json`), `${JSON.stringify(Store.decode(this.store.blob(last.blob_sha)), null, 2)}\n`);
      this.db.write(() => {
        this.dropLevel(lv);
        this.store.audit(user, 'level.purge', lv.pack, lv.name, null, {});
      });
      out.levels++;
    }
    for (const p of this.db.all('SELECT * FROM packs WHERE archived=1 AND archived_at<?', cutoff)) {
      if (this.db.get('SELECT 1 x FROM levels WHERE pack=? AND deleted=0 LIMIT 1', p.name)) this.write(`${p.name}.zip`, this.store.exportPack(p.name));
      this.db.write(() => {
        for (const lv of this.db.all('SELECT * FROM levels WHERE pack=?', p.name)) this.dropLevel(lv);
        this.db.run('DELETE FROM packs WHERE name=?', p.name);
        this.store.audit(user, 'pack.purge', p.name, null, null, { archived_at: iso(p.archived_at), reason: p.archive_reason });
      });
      out.packs++;
    }
    this.db.write(() => {
      out.links = Number(this.db.run('DELETE FROM share_links WHERE expires_at<? OR revoked_at<?', now() - LINK_GRACE, now() - LINK_GRACE).changes);
      out.blobs = Number(this.db.run(`DELETE FROM blobs WHERE sha NOT IN (SELECT blob_sha FROM revisions WHERE blob_sha IS NOT NULL)
        AND sha NOT IN (SELECT sha FROM plays WHERE sha IS NOT NULL) AND sha NOT IN (SELECT sha FROM share_links)`).changes);
      out.thumbs = Number(this.db.run('DELETE FROM thumbs WHERE sha NOT IN (SELECT sha FROM blobs)').changes);
      if (out.levels || out.packs || out.blobs) this.store.audit(user, 'admin.housekeeping', null, null, null, out);
    });
    return out;
  }
}
