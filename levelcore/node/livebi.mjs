// Số liệu người chơi thật từ BI (server Node), chuyển từ Sand Jam (server/livebi.mjs). Service account chỉ đọc gọi
// /levels/win, /dropoff, /loss-cause, /failure-types, /booster-used theo app Android / iOS cho bộ đang chạy của nền tảng
// đó, rồi gắn số liệu vào nội dung level (khoá nội dung): bộ nào chứa cùng level đều thấy; level sửa sau khi đo thì
// số liệu ghi "live cũ". Đồng bộ tay (quyền liveBi) hoặc tự động mỗi ngày.
import crypto from 'node:crypto';
import { appIds } from './bihub.mjs';
import { ApiError } from './http.mjs';
import { statusOf } from './packmeta.mjs';
import { iso, now } from './store.mjs';

export const PLATFORMS = ['Android', 'iOS'];
export const LIVE_DEFAULTS = {
  platforms: { Android: { pack: '', versions: [] }, iOS: { pack: '', versions: [] } },
  days: 14, minUsers: 20, hardWin: 0.25, warnWin: 0.4, warnDrop: 0.08, auto: true,
};
const CHECK_EVERY_MS = 3600 * 1000;
const AUTO_AFTER_S = 20 * 3600;
const STEPS = 5;

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const isoDay = date => date.toISOString().slice(0, 10);

export function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return null;
  const p = Math.min(1, Math.max(0, k / n));
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round(Math.max(0, c - half)), round(Math.min(1, c + half))];
}

export function winMetrics(row, minUsers) {
  if (!row) return null;
  const users = Math.round(num(row.user_start_count));
  if (users <= 0) return null;
  const starts = Math.round(num(row.start_count));
  const wins = Math.round(num(row.win_count));
  const firstWins = Math.round(num(row.user_first_win));
  return {
    users, starts, wins, userWins: Math.round(num(row.user_win)), firstWins,
    firstWinRate: round(firstWins / users), firstWinCi: wilson(firstWins, users),
    userWinRate: round(Math.round(num(row.user_win)) / users),
    winPerAttempt: starts ? round(wins / starts) : null,
    attemptsPerUser: round(starts / users, 3),
    playTimeAvg: round(num(row.play_time_avg), 2),
    moveCountAvg: round(num(row.move_count_avg), 2),
    boosterAvg: round(num(row.use_booster_count_avg), 3),
    enough: users >= minUsers,
  };
}

export function byLevel(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const level = Math.round(num(row.level));
    if (!level) continue;
    if (!map.has(level)) map.set(level, []);
    map.get(level).push(row);
  }
  return map;
}

export function lossCauses(rows) {
  const out = {};
  for (const row of rows ?? []) {
    let cause = String(row.lose_cause ?? '');
    if (['', '0', 'None', 'null'].includes(cause)) cause = 'quit';
    out[cause] ??= { loseCount: 0, users: 0 };
    out[cause].loseCount += Math.round(num(row.lose_count));
    out[cause].users += Math.round(num(row.user_lose));
  }
  return Object.keys(out).length ? out : null;
}

export function failureTypes(rows) {
  const out = {};
  for (const row of rows ?? []) {
    const key = { fail_to_start: 'f2p', fail_to_stop: 'f2s' }[row.failure_type];
    if (!key) continue;
    out[key] ??= { users: 0, fails: 0 };
    for (const detail of row.details ?? []) {
      const n = Math.round(num(detail.count));
      out[key].users += n;
      out[key].fails += n * Math.round(num(detail.agg));
    }
  }
  return Object.keys(out).length ? out : null;
}

export function boosters(rows) {
  const out = {};
  for (const row of rows ?? []) {
    const name = String(row.std_name ?? row.name ?? '?');
    out[name] ??= { uses: 0, users: 0 };
    out[name].uses += Math.round(num(row.use_booster_count));
    out[name].users += Math.round(num(row.user_use_booster_count));
  }
  return Object.keys(out).length ? out : null;
}

export function dropoff(rows) {
  const row = rows?.[0];
  if (!row) return null;
  const users = Math.round(num(row.user_count));
  return users > 0 ? { users, dropRate: round(num(row.drop_rate)), drops: Math.round(users * num(row.drop_rate)) } : null;
}

/** Mức cảnh báo của một level: 'bad' (viền đỏ), 'warn' (viền cam) hoặc null; chưa đủ người chơi thì không xét. */
export function flagOf(data, cfg) {
  if (!data?.enough) return null;
  const drop = data.drop?.dropRate ?? 0;
  if (data.firstWinRate < cfg.hardWin || drop >= cfg.warnDrop * 2) return 'bad';
  if (data.firstWinRate < cfg.warnWin || drop >= cfg.warnDrop) return 'warn';
  return null;
}

export function serviceAccountHeaders(raw) {
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new ApiError(503, 'BI_SERVICE_ACCOUNT_KEY không phải file JSON key của service account BI');
  }
  if (!key?.private_key_id || !key?.private_key) throw new ApiError(503, 'Key service account BI thiếu private_key_id / private_key');
  const pem = Buffer.from(String(key.private_key), 'base64').toString('utf8');
  let signature;
  try {
    signature = crypto.sign('sha256', Buffer.from('nonce'), { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING });
  } catch {
    throw new ApiError(503, 'private_key của service account BI không phải PEM hợp lệ');
  }
  return { 'x-private-key-id': String(key.private_key_id), 'x-signature': signature.toString('base64') };
}

export class BiAnalyticsClient {
  constructor(s, fetchImpl = globalThis.fetch) {
    this.s = s;
    this.fetch = fetchImpl;
    this.calls = 0;
    this.auth = null;
  }

  headers() {
    if (!this.s.biServiceAccountKey) throw new ApiError(503, `Chưa có key service account BI (BI_SERVICE_ACCOUNT_KEY hoặc ${this.s.envPrefix}_BI_KEY_FILE)`);
    if (!this.auth) this.auth = serviceAccountHeaders(this.s.biServiceAccountKey);
    const origin = this.s.biEnv === 'prod' ? 'https://bi.sonatgame.com' : 'https://bi-dev.sonatgame.com';
    return { origin, referer: `${origin}/`, accept: 'application/json', 'user-agent': `${this.s.toolName}-live-bi/1`, ...this.auth };
  }

  async get(path, params, { timeoutMs = 90000, attempts = 4 } = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
    }
    const url = `${this.s.biApiUrl.replace(/\/+$/, '')}${path}?${query}`;
    let last = '';
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await this.fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
        this.calls++;
        if (res.ok) {
          const body = await res.json();
          if (Array.isArray(body)) return body;
          if (Array.isArray(body?.data)) return body.data;
          return [];
        }
        if (res.status === 401) throw new ApiError(502, `BI ${path} trả 401: key service account sai hoặc đã thu hồi`);
        if (res.status === 403) throw new ApiError(502, `BI ${path} trả 403: service account thiếu quyền đọc hoặc chưa được gán app`);
        if (res.status < 500 && res.status !== 429) throw new ApiError(502, `BI ${path} trả ${res.status}: ${(await res.text()).slice(0, 200)}`);
        last = `HTTP ${res.status}`;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        last = error.message;
      }
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1) ** 2));
    }
    throw new ApiError(502, `BI ${path} lỗi sau ${attempts} lần: ${last}`);
  }
}

export class LiveBi {
  constructor(s, db, store, admin, broker) {
    Object.assign(this, { s, db, store, admin, broker });
    this.client = new BiAnalyticsClient(s);
    this.job = null;
  }

  configured() {
    return !!(this.s.biServiceAccountKey && this.s.biApiUrl);
  }

  config() {
    return this.admin.settings().live;
  }

  /** Bộ đang chạy của nền tảng: bộ chọn ở Quản trị, không chọn thì bộ Live duy nhất có mục đích Main cho nền tảng đó. */
  sourcePack(platform, cfg = this.config()) {
    const code = cfg.platforms?.[platform]?.pack;
    if (code) return this.db.get('SELECT * FROM packs WHERE code=?', code);
    const os = platform === 'iOS' ? 'ios' : 'android';
    const live = this.db.all("SELECT * FROM packs WHERE production=1 AND archived=0 AND purpose='main' AND platform IN (?, 'both')", os)
      .filter(p => statusOf(p) === 'live');
    return live.length === 1 ? live[0] : null;
  }

  status() {
    const cfg = this.config();
    const runs = this.db.all('SELECT * FROM live_runs ORDER BY id DESC LIMIT 10').map(r => ({
      id: r.id, at: iso(r.at), by: r.by, platform: r.platform, pack: r.pack, code: r.code, from: r.start_date, to: r.end_date,
      status: r.status, calls: r.calls, message: r.message,
    }));
    const counts = Object.fromEntries(this.db.all('SELECT platform, COUNT(*) n FROM live_stats GROUP BY platform').map(r => [r.platform, r.n]));
    const sources = Object.fromEntries(PLATFORMS.map(p => {
      const pack = this.sourcePack(p, cfg);
      return [p, pack ? { name: pack.name, code: pack.code } : null];
    }));
    return { configured: this.configured(), env: this.s.biEnv, appIds: appIds(this.s), config: cfg, sources, runs, counts, job: this.job };
  }

  start(user) {
    if (!this.configured()) throw new ApiError(503, `Chưa cấu hình số liệu BI: cần ${this.s.envPrefix}_BI_API_URL và key service account (BI_SERVICE_ACCOUNT_KEY)`);
    if (this.job) return this.status();
    const cfg = this.config();
    const ids = appIds(this.s);
    const platforms = PLATFORMS.filter(p => ids[p] && this.sourcePack(p, cfg));
    if (!platforms.length) throw new ApiError(400, 'Chưa có bộ đang chạy: đặt một bộ Live mục đích Main, hoặc chọn bộ cho Android / iOS ở Quản trị ▸ Số liệu BI');
    this.job = { by: user, started_at: iso(now()), done: 0, total: platforms.length * STEPS, message: 'Bắt đầu' };
    this.sync(platforms, cfg, user)
      .catch(e => console.error(`[live] ${e.message}`))
      .finally(() => {
        this.job = null;
        this.broker.publish('live.synced', { author: user });
      });
    return this.status();
  }

  async sync(platforms, cfg, user) {
    const end = new Date(Date.now() - 24 * 3600 * 1000);
    const start = new Date(end.getTime() - (cfg.days - 1) * 24 * 3600 * 1000);
    const window = { from: isoDay(start), to: isoDay(end) };
    const ids = appIds(this.s);
    const summary = {};
    for (const platform of platforms) {
      const pack = this.sourcePack(platform, cfg);
      const versions = cfg.platforms?.[platform]?.versions || [];
      const runId = Number(this.db.write(() => this.db.run(`INSERT INTO live_runs(at,by,platform,pack,code,start_date,end_date,status)
        VALUES(?,?,?,?,?,?,?,'running')`, now(), user || 'system', platform, pack.name, pack.code, window.from, window.to)).lastInsertRowid);
      const callsBefore = this.client.calls;
      try {
        const heads = this.db.all(`SELECT l.name, l.sort_key level, l.head_rev rev, l.content_key, r.blob_sha sha FROM levels l
          JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev WHERE l.pack=? AND l.deleted=0 ORDER BY l.sort_key`, pack.name);
        if (!heads.length) throw new Error(`Bộ ${pack.name} trống`);
        const maxLevel = heads.at(-1).level;
        const base = {
          appId: ids[platform], startDate: window.from, endDate: window.to, startLevel: 1, endLevel: maxLevel, forceRefresh: 'false',
          ...(versions.length ? { appVersion: versions } : {}),
        };
        const step = async (label, path, params) => {
          this.job = { ...this.job, message: `${platform}: ${label}` };
          const rows = await this.client.get(path, params);
          this.job = { ...this.job, done: this.job.done + 1 };
          return byLevel(rows);
        };
        const win = await step('thắng / bắt đầu', '/levels/win', base);
        const drop = await step('rơi rụng', '/levels/dropoff', { ...base, endLevel: maxLevel + 1 });
        const loss = await step('nguyên nhân thua', '/levels/loss-cause', base);
        const fail = await step('kiểu thua', '/levels/failure-types', base);
        const boost = await step('booster', '/levels/booster-used', base);
        let filled = 0;
        this.db.write(() => {
          this.db.run('DELETE FROM live_stats WHERE platform=?', platform);
          for (const h of heads) {
            const metrics = winMetrics(win.get(h.level)?.[0], cfg.minUsers);
            if (!metrics) continue;
            const data = {
              ...metrics, drop: dropoff(drop.get(h.level)), loss: lossCauses(loss.get(h.level)), fail: failureTypes(fail.get(h.level)),
              boosters: boosters(boost.get(h.level)), window, versions,
            };
            this.db.run(`INSERT INTO live_stats(platform,slot,code,pack,name,rev,sha,content_key,data,run_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
              platform, h.level, pack.code, pack.name, h.name, h.rev, h.sha, h.content_key, JSON.stringify(data), runId);
            filled++;
          }
          this.db.run("UPDATE live_runs SET status='done', calls=?, message=? WHERE id=?", this.client.calls - callsBefore, `${filled}/${heads.length} level có số liệu`, runId);
        });
        summary[platform] = { pack: pack.name, code: pack.code, levels: filled, of: heads.length };
      } catch (error) {
        this.db.write(() => this.db.run("UPDATE live_runs SET status='error', calls=?, message=? WHERE id=?",
          this.client.calls - callsBefore, String(error.message).slice(0, 300), runId));
        throw error;
      }
    }
    this.db.write(() => this.store.audit(user || 'system', 'live.sync', null, null, null, { window, summary }));
    return { window, summary };
  }

  schedule() {
    const tick = () => {
      if (!this.configured() || this.job || !this.config().auto) return;
      const last = this.db.get("SELECT MAX(at) t FROM live_runs WHERE status='done'")?.t ?? 0;
      if (now() - last < AUTO_AFTER_S) return;
      try {
        this.start('system');
      } catch (e) {
        if (!(e instanceof ApiError)) console.error(`[live] ${e.message}`);
      }
    };
    this.first = setTimeout(tick, 60000);
    this.timer = setInterval(tick, CHECK_EVERY_MS);
    this.first.unref?.();
    this.timer.unref?.();
  }

  stop() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  brief(row, cfg, stale) {
    const d = JSON.parse(row.data);
    return {
      platform: row.platform, slot: row.slot, code: row.code, pack: row.pack, name: row.name, stale,
      users: d.users, firstWinRate: d.firstWinRate, firstWinCi: d.firstWinCi, attemptsPerUser: d.attemptsPerUser,
      winPerAttempt: d.winPerAttempt, dropRate: d.drop?.dropRate ?? null, playTimeAvg: d.playTimeAvg, enough: d.enough,
      window: d.window, flag: stale ? null : flagOf(d, cfg),
    };
  }

  /** Số liệu cho từng level của bộ: khớp theo nội dung; level của chính bộ được đo mà nay đã sửa thì ghi live cũ. */
  packStats(pack) {
    const p = this.store.pack(pack);
    const cfg = this.config();
    const levels = this.db.all('SELECT name, content_key FROM levels WHERE pack=? AND deleted=0', pack);
    const keys = [...new Set(levels.map(l => l.content_key).filter(Boolean))];
    const byKey = new Map();
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      for (const r of this.db.all(`SELECT * FROM live_stats WHERE content_key IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
        if (!byKey.has(r.content_key)) byKey.set(r.content_key, []);
        byKey.get(r.content_key).push(r);
      }
    }
    const own = new Map(p.code ? this.db.all('SELECT * FROM live_stats WHERE code=?', p.code).map(r => [`${r.platform}:${r.name}`, r]) : []);
    const out = {};
    for (const lv of levels) {
      const entry = {};
      for (const r of byKey.get(lv.content_key) || []) {
        const cur = entry[r.platform];
        const mine = r.code === p.code && r.name === lv.name;
        if (!cur || (mine && !cur.mine) || (mine === !!cur.mine && JSON.parse(r.data).users > cur.users)) entry[r.platform] = { ...this.brief(r, cfg, false), mine };
      }
      for (const v of Object.values(entry)) delete v.mine;
      for (const platform of PLATFORMS) {
        const r = own.get(`${platform}:${lv.name}`);
        if (!entry[platform] && r) entry[platform] = this.brief(r, cfg, true);
      }
      if (Object.keys(entry).length) out[lv.name] = entry;
    }
    const last = this.db.get("SELECT * FROM live_runs WHERE status='done' ORDER BY id DESC LIMIT 1");
    return { configured: this.configured(), synced_at: last ? iso(last.at) : null, window: last ? { from: last.start_date, to: last.end_date } : null, levels: out };
  }

  levelStats(pack, name) {
    this.store.pack(pack);
    const lv = this.store.level(pack, name);
    if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${name}`);
    const cfg = this.config();
    const p = this.store.pack(pack);
    const exact = lv.content_key ? this.db.all('SELECT * FROM live_stats WHERE content_key=? ORDER BY platform, slot', lv.content_key) : [];
    const stale = p.code ? this.db.all('SELECT * FROM live_stats WHERE code=? AND name=? ORDER BY platform', p.code, name)
      .filter(r => r.content_key !== lv.content_key) : [];
    const rows = [...exact.map(r => [r, false]), ...stale.map(r => [r, true])];
    const stats = rows.map(([r, isStale]) => ({ ...JSON.parse(r.data), ...this.brief(r, cfg, isStale) }));
    const level = this.store.bodyOrNull(this.store.head(lv).blob_sha);
    const fresh = stats.filter(x => !x.stale);
    return { pack, name, stats, suggestions: fresh.length ? this.store.game.suggest(level, fresh) : [] };
  }
}
