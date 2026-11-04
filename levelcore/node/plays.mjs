// Lượt chơi thử trên tool (server Node): mỗi lượt giữ đúng nội dung level đã chơi (blob theo sha, cả bản nháp chưa lưu),
// ai chơi (người dùng tool hoặc người mở link chơi thử), bản game, kết quả và chuỗi sự kiện game gửi về qua bridge
// (dòng log `[TAG] …` và sự kiện có cấu trúc `{type: 'event'}`). Dữ liệu dành cho phân tích, solver, AI: xuất JSONL.
//   bắt đầu: POST /api/plays {uid, pack, level, rev, source, level_data, build}
//   gửi dần: POST /api/plays/{uid}/events {events: [...], end?: {result, duration_ms, cheat, summary}}
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { ApiError } from './http.mjs';
import { iso, now } from './store.mjs';

const UID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RESULTS = ['win', 'lose', 'quit'];
const MAX_EVENTS = 20000;
const MAX_BATCH = 2000;
const MAX_EVENT_BYTES = 4096;

const canon = obj => Buffer.from(JSON.stringify(obj), 'utf8');
const short = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

export class Plays {
  constructor(db, store) {
    Object.assign(this, { db, store });
  }

  static row(r) {
    return {
      id: r.id, uid: r.uid, pack: r.pack, level: r.level, rev: r.rev, sha: r.sha, source: r.source, user: r.user,
      link: r.link, player: r.player, build: r.build, client: r.client, started_at: iso(r.started_at), ended_at: iso(r.ended_at),
      result: r.result, duration_ms: r.duration_ms, cheat: !!r.cheat, events: r.events, summary: r.summary ? JSON.parse(r.summary) : null,
    };
  }

  byUid(uid) {
    if (!UID_RE.test(String(uid || ''))) throw new ApiError(400, 'uid lượt chơi không hợp lệ');
    return this.db.get('SELECT * FROM plays WHERE uid=?', uid);
  }

  /** Bắt đầu lượt chơi (gửi lại cùng uid trả lượt đã có). Nội dung level lưu theo sha để chơi lại / phân tích sau. */
  start(user, body, { link = null, player = null } = {}) {
    const uid = String(body.uid || '');
    const existing = this.byUid(uid);
    if (existing) return Plays.row(existing);
    const level = body.level_data;
    if (!level || typeof level !== 'object' || Array.isArray(level)) throw new ApiError(400, 'Cần level_data (level đang chơi)');
    const data = canon(level);
    if (data.length > 16 * 1024 * 1024) throw new ApiError(413, 'Level quá lớn');
    const source = /^(draft|r\d+|link)$/.test(String(body.source)) ? String(body.source) : 'draft';
    return this.db.write(() => {
      const sha = this.store.putBlob(data);
      this.db.run(`INSERT INTO plays(uid,pack,level,rev,sha,source,user,link,player,build,client,started_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, uid, short(body.pack, 64), short(body.level, 16), Number.isInteger(body.rev) ? body.rev : null,
      sha, source, user, link, short(player, 40), short(body.build, 32), short(body.client, 80), now());
      return Plays.row(this.byUid(uid));
    });
  }

  /** Thêm sự kiện (theo lô, thứ tự gửi) và kết thúc lượt nếu có `end`. Lượt đã kết thúc thì không nhận thêm. */
  append(uid, body, owner) {
    const r = this.byUid(uid);
    if (!r) throw new ApiError(404, 'Không có lượt chơi này');
    if (owner && r.user !== owner) throw new ApiError(403, 'Lượt chơi của người khác');
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length > MAX_BATCH) throw new ApiError(413, `Tối đa ${MAX_BATCH} sự kiện mỗi lần gửi`);
    const clean = events.map(e => (JSON.stringify(e)?.length > MAX_EVENT_BYTES ? { type: 'dropped', reason: 'quá 4 KB' } : e));
    if (r.ended_at != null) return Plays.row(r);
    if (r.events + clean.length > MAX_EVENTS) throw new ApiError(413, `Một lượt tối đa ${MAX_EVENTS} sự kiện`);
    const end = body.end && typeof body.end === 'object' ? body.end : null;
    return this.db.write(() => {
      if (clean.length) {
        const seq = (this.db.get('SELECT MAX(seq) m FROM play_events WHERE play_id=?', r.id).m ?? -1) + 1;
        this.db.run('INSERT INTO play_events(play_id,seq,data) VALUES(?,?,?)', r.id, seq, zlib.deflateRawSync(canon(clean)));
        this.db.run('UPDATE plays SET events=events+? WHERE id=?', clean.length, r.id);
      }
      if (end) {
        const summary = end.summary && typeof end.summary === 'object' ? JSON.stringify(end.summary).slice(0, 4000) : null;
        this.db.run('UPDATE plays SET ended_at=?, result=?, duration_ms=?, cheat=?, summary=? WHERE id=?', now(),
          RESULTS.includes(end.result) ? end.result : null, Number.isFinite(end.duration_ms) ? Math.round(end.duration_ms) : null,
          end.cheat ? 1 : 0, summary, r.id);
      }
      return Plays.row(this.db.get('SELECT * FROM plays WHERE id=?', r.id));
    });
  }

  list({ pack = null, level = null, sha = null, user = null, limit = 100 } = {}) {
    const where = [], args = [];
    for (const [col, v] of [['pack', pack], ['level', level], ['sha', sha], ['user', user]]) {
      if (v) {
        where.push(`${col}=?`);
        args.push(v);
      }
    }
    const n = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    return this.db.all(`SELECT * FROM plays ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ${n}`, ...args).map(Plays.row);
  }

  events(id) {
    return this.db.all('SELECT data FROM play_events WHERE play_id=? ORDER BY seq', id)
      .flatMap(r => JSON.parse(zlib.inflateRawSync(Buffer.from(r.data)).toString('utf8')));
  }

  detail(id) {
    const r = this.db.get('SELECT * FROM plays WHERE id=?', Number(id));
    if (!r) throw new ApiError(404, 'Không có lượt chơi này');
    return { ...Plays.row(r), level_data: this.store.bodyOrNull(r.sha), event_list: this.events(r.id) };
  }

  /** Mọi lượt (từ `since`, theo bộ nếu có) dạng JSONL: mỗi dòng {play, level, events} — dữ liệu cho solver / AI. */
  *exportLines({ since = null, pack = null } = {}) {
    const rows = this.db.all(`SELECT * FROM plays WHERE started_at>=? ${pack ? 'AND pack=?' : ''} ORDER BY id`, since ?? 0, ...(pack ? [pack] : []));
    for (const r of rows) {
      yield `${JSON.stringify({ play: Plays.row(r), level: this.store.bodyOrNull(r.sha), events: this.events(r.id) })}\n`;
    }
  }

  /** Thống kê nhanh theo nội dung level (sha): số lượt, thắng, thua, thời gian trung vị — cho danh sách và tổng quan bộ. */
  stats(pack) {
    const rows = this.db.all(`SELECT p.sha, p.result, p.duration_ms, p.cheat FROM plays p
      JOIN levels l ON l.pack=? AND l.deleted=0 JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev AND r.blob_sha=p.sha
      WHERE p.ended_at IS NOT NULL`, pack);
    const by = new Map();
    for (const r of rows) {
      const s = by.get(r.sha) || { plays: 0, wins: 0, losses: 0, durations: [] };
      if (r.cheat) continue;
      s.plays++;
      if (r.result === 'win') s.wins++;
      if (r.result === 'lose') s.losses++;
      if (r.duration_ms != null) s.durations.push(r.duration_ms);
      by.set(r.sha, s);
    }
    return Object.fromEntries([...by].map(([sha, s]) => {
      const d = s.durations.sort((a, b) => a - b);
      return [sha, { plays: s.plays, wins: s.wins, losses: s.losses, median_ms: d.length ? d[Math.floor(d.length / 2)] : null }];
    }));
  }

  static newUid() {
    return crypto.randomBytes(12).toString('base64url');
  }
}
