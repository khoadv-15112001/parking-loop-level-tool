// Ảnh level (server Node), lưu theo sha nội dung: cùng nội dung ở bộ / số khác dùng chung một ảnh, sửa level thì sha đổi
// nên ảnh cũ không bị hiện nhầm. Nguồn: `capture` (bản WebGL chụp qua bridge) hoặc `render` (hook `thumbnail` của game
// vẽ SVG trong trình duyệt). SVG trả kèm CSP cấm script để mở thẳng cũng an toàn.
import { ApiError } from './http.mjs';
import { now } from './store.mjs';

const SHA_RE = /^[0-9a-f]{64}$/;
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export class Thumbs {
  constructor(db, store) {
    Object.assign(this, { db, store });
  }

  static checkSha(sha) {
    if (!SHA_RE.test(String(sha || ''))) throw new ApiError(400, 'sha ảnh không hợp lệ');
  }

  put(user, sha, type, data, source) {
    Thumbs.checkSha(sha);
    const t = String(type || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(t)) throw new ApiError(415, `Ảnh phải là ${TYPES.join(', ')}`);
    if (!data.length || data.length > MAX_THUMB_BYTES) throw new ApiError(413, 'Ảnh rỗng hoặc quá 2 MB');
    if (!this.db.get('SELECT 1 x FROM blobs WHERE sha=?', sha)) throw new ApiError(404, 'Không có level nào có nội dung này');
    this.db.write(() => this.db.run('INSERT OR REPLACE INTO thumbs(sha,type,data,source,created_by,created_at) VALUES(?,?,?,?,?,?)',
      sha, t, data, source === 'capture' ? 'capture' : 'render', user, now()));
    return { sha, type: t, size: data.length };
  }

  get(sha) {
    Thumbs.checkSha(sha);
    const r = this.db.get('SELECT type,data FROM thumbs WHERE sha=?', sha);
    if (!r) throw new ApiError(404, 'Chưa có ảnh');
    return {
      bytes: Buffer.from(r.data),
      headers: {
        'Content-Type': r.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
        ...(r.type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
      },
    };
  }

  /** sha của level còn sống trong bộ đã có ảnh. */
  have(pack) {
    return this.db.all(`SELECT r.blob_sha sha FROM levels l JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev
      JOIN thumbs t ON t.sha=r.blob_sha WHERE l.pack=? AND l.deleted=0`, pack).map(r => r.sha);
  }
}
