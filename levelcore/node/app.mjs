// App HTTP của server Node: cùng đường API, ETag / If-Match, lỗi JSON và SSE với server Python (levelcore/server).
// Gồm cả đăng nhập Google của BI, BI Level Hub, bản game WebGL (nhiều bản build) và hợp đồng CI v1.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ACTIONS, Admin } from './admin.mjs';
import { Auth, COOKIE_NAME, SESSION_TTL } from './auth.mjs';
import * as bihub from './bihub.mjs';
import { Ci, cleanMeta, MAX_LEVELS_ZIP } from './ci.mjs';
import { DB } from './db.mjs';
import { Broker } from './events.mjs';
import { Housekeeping } from './housekeeping.mjs';
import { ApiError, parseJson, queryBool, readBody, Router, sendBytes, sendJson, serveFile } from './http.mjs';
import * as levelhub from './levelhub.mjs';
import { Links } from './links.mjs';
import { Plays } from './plays.mjs';
import { MAX_THUMB_BYTES, Thumbs } from './thumbs.mjs';
import { iso, now, parseTime, Store } from './store.mjs';
import { resolveUiTemplate } from './ui-template.mjs';
import { Builds, CHUNK_BYTES, ChunkUploads, MAX_ZIP_BYTES, streamToFile } from './webgame.mjs';

const WEB_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
  + "frame-src 'self'; frame-ancestors 'none'";
const LEVEL_BODY_LIMIT = 32 * 1024 * 1024;
const IMPORT_BODY_LIMIT = 600 * 1024 * 1024;

const etag = rev => ({ ETag: `"r${rev}"` });
const REPLY = Symbol('reply');
const reply = (status, data, headers = {}) => ({ [REPLY]: true, status, data, headers });
const zipReply = (bytes, name) => ({ bytes, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` } });

function safeDecode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return '\0';
  }
}

function pageParam(url) {
  const v = url.searchParams.get('page') ?? '1';
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new ApiError(400, 'page phải là số nguyên ≥ 1');
  return Number(v);
}

export function createApp(game, s) {
  const coreWebDir = path.join(s.webRoot, 'levelcore', 'web');
  const uiTemplate = resolveUiTemplate(coreWebDir, game.manifest.uiTemplate);
  const db = new DB(s.dbPath);
  const broker = new Broker(now);
  const store = new Store(db, broker, s, game);
  const biConfigured = bihub.configured(s);
  const auth = new Auth(s, biConfigured);
  const builds = new Builds(s);
  const uploads = new ChunkUploads(builds);
  const ci = new Ci(s, db, store, broker, builds);
  const admin = new Admin(s, db, store);
  const plays = new Plays(db, store);
  const links = new Links(db, store, admin);
  const thumbs = new Thumbs(db, store);
  const housekeeping = new Housekeeping(db, store, admin, () => {
    const removed = builds.prune();
    ci.afterPrune(removed);
    return removed;
  });
  store.ensureDefaultPacks();

  const pub = new URL(s.publicBase);
  const writeOrigins = new Set([pub.origin, ...s.corsOrigins]);
  if (s.dev && pub.port) {
    writeOrigins.add(`http://localhost:${pub.port}`);
    writeOrigins.add(`http://127.0.0.1:${pub.port}`);
  }

  const requireAdmin = (user, what) => admin.requireAdmin(user, what);
  const objectBody = async req => {
    const body = parseJson(await readBody(req, LEVEL_BODY_LIMIT));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Body phải là JSON object');
    return body;
  };
  const revParam = v => {
    if (!/^\d+$/.test(v)) throw new ApiError(400, `rev phải là số: ${v}`);
    return Number(v);
  };
  const biToken = req => {
    bihub.requireConfigured(s);
    return bihub.checkToken(req.headers['x-bi-token']);
  };
  const tempZip = kind => path.join(builds.uploadsDir, `${kind}-${crypto.randomBytes(8).toString('hex')}.zip`);

  const api = new Router();
  api.add('GET', '/api/me', ({ user }) => ({
    email: user, dev: s.dev, lock_ttl: s.lockTtl, online: broker.online(), admin: admin.isAdmin(user), runtime: 'node',
    format_version: s.formatVersion, rights: admin.rights(user), notice: admin.settings().notice,
    features: {
      levelhub: !!game.levelhub, bi: biConfigured, webgame: true,
      plays: true, share: true, thumbs: true, reorder: true, trash: true, admin: true,
    },
  }));
  api.add('GET', '/api/packs', () => store.listPacks());
  api.add('POST', '/api/packs', async ({ req, user }) => {
    const b = await objectBody(req);
    return reply(201, store.createPack(user, b.name, b.description ?? '', b.platform ?? 'android', b.group ?? ''));
  });
  api.add('PATCH', '/api/packs/:pack', async ({ req, user, params }) => {
    const b = await objectBody(req);
    if (b.production != null) admin.require(user, 'production');
    if (b.archived != null) admin.require(user, 'archive');
    return store.updatePack(user, params.pack, b);
  });
  api.add('POST', '/api/packs/:pack/rename', async ({ req, user, params }) => store.renamePack(user, params.pack, (await objectBody(req)).to));

  api.add('GET', '/api/packs/:pack/levels', ({ params, url }) => store.listLevels(params.pack, queryBool(url, 'include_deleted')));
  api.add('GET', '/api/packs/:pack/bundle', ({ params }) => store.bundle(params.pack));
  api.add('GET', '/api/packs/:pack/validate', ({ params }) => store.validatePack(params.pack));
  api.add('GET', '/api/packs/:pack/levels/:name', ({ params }) => {
    const d = store.getLevel(params.pack, params.name);
    return reply(200, d, etag(d.rev));
  });
  const save = create => async ({ req, user, params, url }) => {
    const body = await readBody(req, LEVEL_BODY_LIMIT);
    const d = store.saveLevel(user, params.pack, params.name, body, req.headers['if-match'] ?? null, create, url.searchParams.get('message') || '');
    return reply(create ? 201 : 200, d, etag(d.rev));
  };
  api.add('POST', '/api/packs/:pack/levels/:name', save(true));
  api.add('PUT', '/api/packs/:pack/levels/:name', save(false));
  api.add('DELETE', '/api/packs/:pack/levels/:name', ({ req, user, params }) => {
    const d = store.deleteLevel(user, params.pack, params.name, req.headers['if-match'] ?? null);
    return reply(200, d, etag(d.rev));
  });
  api.add('GET', '/api/packs/:pack/levels/:name/revisions', ({ params }) => store.listRevisions(params.pack, params.name));
  api.add('GET', '/api/packs/:pack/levels/:name/revisions/:rev', ({ params }) => store.getRevision(params.pack, params.name, revParam(params.rev)));
  api.add('GET', '/api/packs/:pack/levels/:name/revisions/:rev/diff', ({ params }) => store.revisionDiff(params.pack, params.name, revParam(params.rev)));
  api.add('POST', '/api/packs/:pack/levels/:name/revert', async ({ req, user, params }) => {
    const b = await objectBody(req);
    if (!Number.isInteger(b.rev)) throw new ApiError(400, 'Cần {"rev": <int>}');
    const d = store.revert(user, params.pack, params.name, b.rev, req.headers['if-match'] ?? null, b.message || '');
    return reply(200, d, etag(d.rev));
  });
  api.add('POST', '/api/packs/:pack/levels/:name/relevel', async ({ req, user, params }) => {
    const b = await objectBody(req);
    const to = b.to;
    if ((typeof to !== 'string' && typeof to !== 'number') || to === '') throw new ApiError(400, 'Cần {"to": "<số mới>", "mode": "swap" | "shift"}');
    return store.relevel(user, params.pack, params.name, String(to), b.mode ?? 'swap', req.headers['if-match'] ?? null, b.dry_run === true);
  });

  api.add('POST', '/api/locks/packs/:pack/levels/:name', ({ user, params }) => store.acquireLock(user, params.pack, params.name));
  api.add('PUT', '/api/locks/packs/:pack/levels/:name', ({ user, params }) => store.heartbeatLock(user, params.pack, params.name));
  api.add('DELETE', '/api/locks/packs/:pack/levels/:name', ({ user, params, url }) => {
    const force = queryBool(url, 'force');
    if (force) {
      const l = store.lock(params.pack, params.name);
      if (l && l.holder !== user) admin.require(user, 'breakLock');
    }
    return store.releaseLock(user, params.pack, params.name, force);
  });

  api.add('POST', '/api/promote', async ({ req, user }) => {
    const b = parseJson(await readBody(req, LEVEL_BODY_LIMIT));
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'Cần {"from", "to", "items": [{name, to?}]}');
    return store.promote(user, b.from, b.to, b.items, b.message || '');
  });

  api.add('POST', '/api/packs/:pack/import', async ({ req, user, params, url }) => {
    const body = await readBody(req, IMPORT_BODY_LIMIT);
    return store.importLevels(user, params.pack, body, req.headers['content-type'] || '', {
      folder: url.searchParams.get('folder'), message: url.searchParams.get('message') || '',
      dryRun: queryBool(url, 'dry_run'), force: queryBool(url, 'force'),
    });
  });
  api.add('GET', '/api/packs/:pack/export', ({ params }) => zipReply(store.exportPack(params.pack), `${params.pack}.zip`));

  // ----- Xuất Level Hub: zip LevelMetadata.json + Raw/ cho LevelBuild / BI -----
  const exportBlocked = e => (e instanceof levelhub.ExportBlocked ? new ApiError(422, e.message, { report: levelhub.toPayload(e.report) }) : e);
  api.add('GET', '/api/levelhub/options', () => {
    const spec = levelhub.specOf(game);
    return {
      game: spec.acronym, os: Object.keys(levelhub.OS_CODES), teams: levelhub.TEAMS, why: levelhub.WHY_OPTIONS, geo: levelhub.GEO_OPTIONS,
      obstacleCodes: spec.obstacleCodes.map(([key, code]) => ({ key, code })),
    };
  });
  api.add('POST', '/api/packs/:pack/levelhub/preflight', async ({ req, params }) => (
    levelhub.toPayload(levelhub.preflight(store, levelhub.parseRequest(params.pack, await objectBody(req))))));
  api.add('POST', '/api/packs/:pack/levelhub/export', async ({ req, user, params }) => {
    const lreq = levelhub.parseRequest(params.pack, await objectBody(req));
    let out;
    try {
      out = levelhub.buildZip(store, lreq);
    } catch (e) {
      throw exportBlocked(e);
    }
    const { summary } = out;
    db.write(() => store.audit(user, 'levelhub.export', params.pack, null, null, {
      zip: out.zipName, levels: summary.levelCount, missing: summary.missingTotal, manifest: summary.manifest, newer: summary.newer,
    }));
    return zipReply(out.data, out.zipName);
  });

  // ----- BI Level Hub: token BI trong header X-BI-Token, server chỉ chuyển tiếp; lỗi của BI → 502 (bi_status, bi_step) -----
  api.add('GET', '/api/bi/config', () => bihub.publicConfig(s));
  api.add('POST', '/api/packs/:pack/levelhub/check', async ({ req, params }) => {
    const token = biToken(req);
    store.pack(params.pack);
    const r = levelhub.parseRequest(params.pack, await objectBody(req));
    if (!levelhub.joinGeo(r.geo)) throw new ApiError(400, 'Kiểm tra tên trên BI cần chọn GEO');
    const name = levelhub.composeZipName(levelhub.specOf(game).acronym, levelhub.OS_CODES[r.os], r.fromLv, r.toLv,
      r.geo, r.why, r.designer, Date.now(), r.version, r.date).slice(0, -4);
    const appId = bihub.appForOs(s, r.os);
    try {
      return await bihub.checkName(s, token, name, appId);
    } catch (e) {
      throw bihub.asApiError(e, 'kiểm tra tên (parse-name, quyền Read Asset Group)', appId);
    }
  });
  const biCall = async (step, fn) => {
    try {
      return await fn();
    } catch (e) {
      throw bihub.asApiError(e, step, s.biAppId);
    }
  };
  api.add('GET', '/api/bi/asset-groups', ({ req, url }) => {
    const token = biToken(req);
    const search = url.searchParams.get('search') || '';
    if (search.length > 200) throw new ApiError(400, 'search tối đa 200 ký tự');
    const statuses = queryBool(url, 'archived') ? bihub.GROUP_STATUSES : [];
    return biCall('đọc danh sách bộ (quyền Read Asset Group)', () => bihub.listGroups(s, token, pageParam(url), search, statuses));
  });
  api.add('GET', '/api/bi/groups/:id', ({ req, params }) => {
    const token = biToken(req);
    return biCall('đọc bộ', () => bihub.getGroup(s, token, params.id));
  });
  api.add('GET', '/api/bi/asset-groups/:id/files', ({ req, params, url }) => {
    const token = biToken(req);
    return biCall('đọc danh sách file', () => bihub.listGroupFiles(s, token, params.id, pageParam(url)));
  });
  api.add('GET', '/api/bi/asset-groups/:gid/files/:fid/raw', async ({ req, params }) => {
    const token = biToken(req);
    const { raw, type } = await biCall('đọc file', () => bihub.getFileRaw(s, token, params.gid, params.fid));
    return { bytes: raw, headers: { 'Content-Type': type } };
  });
  api.add('POST', '/api/bi/groups/:id/:action', async ({ req, user, params }) => {
    const token = biToken(req);
    const group = await biCall(`${params.action} (${bihub.GROUP_ACTIONS[params.action] || '?'})`, () => bihub.groupAction(s, token, params.id, params.action));
    db.write(() => store.audit(user, `levelhub.bi_${params.action}`, null, null, null, { group: params.id, env: s.biEnv }));
    return group;
  });
  api.add('POST', '/api/packs/:pack/levelhub/upload', async ({ req, user, params }) => {
    admin.require(user, 'levelhubUpload');
    const token = biToken(req);
    const body = await objectBody(req);
    const lreq = levelhub.parseRequest(params.pack, body);
    const description = body.description || '';
    if (typeof description !== 'string' || description.length > 2000) throw new ApiError(400, 'Mô tả tối đa 2000 ký tự');
    if (description && description.length < bihub.MIN_DESCRIPTION) throw new ApiError(400, `Mô tả (nếu nhập) tối thiểu ${bihub.MIN_DESCRIPTION} ký tự`);
    if (!levelhub.joinGeo(lreq.geo)) throw new ApiError(400, 'Đẩy lên BI cần chọn Geo (tên bộ trên BI không được có phần Geo rỗng)');
    const appId = bihub.appForOs(s, lreq.os);
    let out;
    try {
      out = levelhub.buildZip(store, lreq);
    } catch (e) {
      throw exportBlocked(e);
    }
    const parts = out.zipName.slice(0, -4).split('_');
    parts[1] = levelhub.OS_CODES[lreq.os];
    const biName = parts.join('_');
    try {
      await bihub.parseName(s, token, biName, appId);
    } catch (e) {
      throw bihub.asApiError(e, 'kiểm tra tên (parse-name, quyền Read Asset Group)', appId);
    }
    const started = Date.now() / 1000;
    let group, recovered = false;
    try {
      group = await bihub.createGroup(s, token, biName, out.data, description, appId);
    } catch (e) {
      if (!(e instanceof bihub.BiError) || e.biStatus != null) throw bihub.asApiError(e, 'tạo bộ (asset-groups, quyền Create Asset Group)', appId);
      try {
        group = await bihub.findCreatedGroup(s, token, biName, appId, started, user);
      } catch {
        group = null;
      }
      if (!group) {
        throw new ApiError(502, `BI không trả lời khi tạo bộ (${e.message}); chưa thấy bộ ${biName} trên BI — đẩy lại được`, {
          bi_status: null, bi_step: 'tạo bộ', checked_at: iso(Date.now() / 1000),
        });
      }
      recovered = true;
    }
    const { summary } = out;
    db.write(() => store.audit(user, 'levelhub.bi_upload', params.pack, null, null, {
      zip: biName, env: s.biEnv, app: appId, group: group?.id ?? group?._id ?? group?.groupId ?? null, levels: summary.levelCount, missing: summary.missingTotal,
      manifest: summary.manifest, newer: summary.newer, recovered,
    }));
    return { name: biName, group, levelCount: summary.levelCount, newer: summary.newer, recovered, checked_at: iso(Date.now() / 1000) };
  });

  // ----- Bản game WebGL: bản đang dùng, bản chờ chọn, tải tay (admin) -----
  api.add('GET', '/api/game', () => builds.info());
  api.add('POST', '/api/game/uploads', async ({ req, user }) => {
    admin.require(user, 'gameBuilds');
    return uploads.start(user, await objectBody(req));
  });
  api.add('PUT', '/api/game/uploads/:id/:i', async ({ req, user, params }) => {
    admin.require(user, 'gameBuilds');
    return uploads.part(params.id, params.i, await readBody(req, CHUNK_BYTES + 1));
  });
  api.add('POST', '/api/game/uploads/:id/complete', ({ user, params }) => {
    admin.require(user, 'gameBuilds');
    return uploads.complete(params.id, user);
  });
  api.add('POST', '/api/game/upload', async ({ req, user, url }) => {
    admin.require(user, 'gameBuilds');
    const tmp = tempZip('single');
    try {
      await streamToFile(req, tmp, MAX_ZIP_BYTES, builds.storageRoots);
      return await builds.installUpload(tmp, user, url.searchParams.get('name') || '');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
  api.add('GET', '/api/game/builds', () => {
    ci.expire();
    return { builds: builds.list(), levels: ci.receipts(), ci: { enabled: !!s.ciToken, branch: s.ciBranch || null, pack: ci.pack } };
  });
  api.add('POST', '/api/game/builds/:id/activate', ({ user, params }) => {
    admin.require(user, 'gameBuilds');
    return ci.activate(user, params.id);
  });
  api.add('DELETE', '/api/game/builds/:id', ({ user, params }) => {
    admin.require(user, 'gameBuilds');
    return ci.reject(user, params.id);
  });

  // ----- Quản trị trong app, thùng rác -----
  api.add('GET', '/api/admin/settings', ({ user }) => {
    requireAdmin(user, 'xem cài đặt quản trị');
    return { ...admin.settings(), actions: ACTIONS, env_admins: s.admins };
  });
  api.add('PUT', '/api/admin/settings', async ({ req, user }) => {
    requireAdmin(user, 'sửa cài đặt quản trị');
    const { version, ...patch } = await objectBody(req);
    if (!Number.isInteger(version)) throw new ApiError(400, 'Cần version của cài đặt đang sửa');
    return { ...admin.update(user, patch, version), actions: ACTIONS, env_admins: s.admins };
  });
  api.add('GET', '/api/admin/storage', ({ user }) => {
    requireAdmin(user, 'xem dung lượng');
    return admin.storage(builds);
  });
  api.add('POST', '/api/admin/backup', ({ user }) => {
    requireAdmin(user, 'sao lưu database');
    return admin.backup(user);
  });
  api.add('POST', '/api/admin/housekeeping', async ({ user }) => {
    requireAdmin(user, 'dọn thùng rác');
    await admin.maintainBackups();
    return housekeeping.run(user);
  });
  api.add('GET', '/api/trash', () => housekeeping.trash());

  // ----- Xếp thứ tự cả bộ -----
  api.add('POST', '/api/packs/:pack/reorder', async ({ req, user, params }) => {
    admin.require(user, 'reorder');
    const b = await objectBody(req);
    return store.reorder(user, params.pack, b.order, b.base ?? null, b.dry_run === true);
  });

  // ----- Lượt chơi thử (dữ liệu cho phân tích / AI) -----
  api.add('POST', '/api/plays', async ({ req, user }) => plays.start(user, await objectBody(req)));
  api.add('POST', '/api/plays/:uid/events', async ({ req, user, params }) => plays.append(params.uid, await objectBody(req), user));
  api.add('GET', '/api/plays/export', ({ url }) => ({
    lines: plays.exportLines({ since: parseTime(url.searchParams.get('since')), pack: url.searchParams.get('pack') }),
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="plays.jsonl"' },
  }));
  api.add('GET', '/api/plays', ({ url }) => {
    const q = k => url.searchParams.get(k);
    return plays.list({ pack: q('pack'), level: q('level'), sha: q('sha'), user: q('user'), limit: q('limit') });
  });
  api.add('GET', '/api/plays/:id', ({ params }) => plays.detail(params.id));
  api.add('GET', '/api/packs/:pack/playstats', ({ params }) => plays.stats(params.pack));

  // ----- Link chơi thử trên điện thoại -----
  api.add('POST', '/api/links', async ({ req, user }) => {
    admin.require(user, 'shareLinks');
    return reply(201, links.create(user, await objectBody(req)));
  });
  api.add('GET', '/api/links', ({ url }) => links.list({ pack: url.searchParams.get('pack'), level: url.searchParams.get('level') }));
  api.add('DELETE', '/api/links/:token', ({ user, params }) => links.revoke(user, params.token));

  // ----- Ảnh level -----
  api.add('GET', '/api/packs/:pack/thumbs', ({ params }) => ({ have: thumbs.have(params.pack) }));
  api.add('GET', '/api/thumbs/:sha', ({ params }) => thumbs.get(params.sha));
  api.add('PUT', '/api/thumbs/:sha', async ({ req, user, params, url }) => (
    thumbs.put(user, params.sha, req.headers['content-type'], await readBody(req, MAX_THUMB_BYTES), url.searchParams.get('source'))));

  api.add('GET', '/api/audit', ({ url }) => {
    const q = k => url.searchParams.get(k);
    return store.listAudit({ user: q('user'), since: parseTime(q('since')), level: q('level'), pack: q('pack'), action: q('action'), limit: Number(q('limit') || 200) });
  });

  // ----- CI (hợp đồng v1): chỉ nhận token CI, không qua đăng nhập người dùng -----
  const ciApi = new Router();
  ciApi.add('GET', '/api/ci/status', () => ci.status());
  ciApi.add('POST', '/api/ci/levels', async ({ req, url }) => ci.receiveLevels(url.searchParams.get('by'), await readBody(req, MAX_LEVELS_ZIP)));
  ciApi.add('POST', '/api/ci/webgl', async ({ req, url }) => {
    const tmp = tempZip('ci');
    try {
      const digest = await streamToFile(req, tmp, MAX_ZIP_BYTES, builds.storageRoots);
      return await ci.receivePlayer(url.searchParams.get('by'), tmp, cleanMeta(url), digest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  function events(req, res, user) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    res.write(broker.format('presence', { online: broker.online() }));
    const sub = broker.subscribe(user, res);
    const timer = setInterval(() => res.write(': ping\n\n'), s.sseHeartbeat * 1000);
    req.on('close', () => {
      clearInterval(timer);
      broker.unsubscribe(sub);
    });
  }

  function send(res, out) {
    if (out && out[REPLY]) return sendJson(res, out.status, out.data, out.headers);
    if (out && out.lines) {
      res.writeHead(200, out.headers);
      for (const line of out.lines) res.write(line);
      return res.end();
    }
    if (out && out.bytes) return sendBytes(res, 200, out.bytes, out.headers);
    return sendJson(res, 200, out);
  }

  async function dispatch(router, method, p, ctx) {
    const m = router.match(method, p);
    if (!m) throw new ApiError(404, 'Not Found');
    if (m.notAllowed) throw new ApiError(405, 'Method Not Allowed');
    return send(ctx.res, await m.handler({ ...ctx, params: m.params }));
  }

  async function firebaseLogin(req, res) {
    bihub.requireConfigured(s);
    if (!writeOrigins.has(req.headers.origin)) throw new ApiError(403, `Yêu cầu đăng nhập không đến từ app ${s.toolName} (Origin không hợp lệ)`);
    const body = parseJson(await readBody(req, 64 * 1024));
    const email = await bihub.verifyIdToken(s, body && typeof body === 'object' ? body.idToken : '');
    auth.requireAllowed(email);
    const token = auth.issue(email);
    const secure = s.publicBase.startsWith('https://') ? '; Secure' : '';
    return sendJson(res, 200, { token, email }, { 'Set-Cookie': `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; SameSite=Lax${secure}` });
  }

  const webHeaders = { 'Content-Security-Policy': WEB_CSP, 'Cache-Control': 'private, no-cache' };
  const appDir = game.appDir || coreWebDir;
  // Game không có game.mjs riêng thì dùng game.mjs mặc định của core (dựng từ manifest + module luật).
  const gameWebFallback = {
    'game.mjs': path.join(coreWebDir, 'js', 'default_game.mjs'), 'manifest.json': game.manifestPath, 'rules.mjs': game.rulesPath,
    'ui.mjs': path.join(coreWebDir, 'js', 'empty_ui.mjs'),
  };

  function serveGameWeb(res, rel) {
    if (serveFile(res, game.webDir, rel, webHeaders)) return;
    const file = gameWebFallback[rel];
    if (file && serveFile(res, path.dirname(file), path.basename(file), webHeaders)) return;
    if (rel === 'game.css') return sendBytes(res, 200, Buffer.alloc(0), { 'Content-Type': 'text/css; charset=utf-8', ...webHeaders });
    if (rel === 'releases.json') return sendJson(res, 200, [], webHeaders);
    throw new ApiError(404, 'Not Found');
  }

  // Trang chơi thử trên điện thoại: công khai, chỉ cần token còn hạn. /p/assets/* là file của trang, /p/<token>/game/* là
  // bản game đang dùng, lượt chơi ghi với user link:<token>.
  const phoneDir = path.join(coreWebDir, 'phone');
  async function phone(req, res, url, p) {
    if (p === '/p/assets/playrecorder.mjs' && serveFile(res, path.join(coreWebDir, 'js'), 'playrecorder.mjs', webHeaders)) return;
    if (p.startsWith('/p/assets/') && req.method === 'GET' && serveFile(res, phoneDir, p.slice('/p/assets/'.length), webHeaders)) return;
    const m = /^\/p\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(p);
    if (!m) throw new ApiError(404, 'Not Found');
    const [, token, rest = '/'] = m;
    if ((rest === '/' || rest === '') && req.method === 'GET') {
      links.active(token);
      if (serveFile(res, phoneDir, 'index.html', { ...webHeaders, 'Referrer-Policy': 'no-referrer' })) return;
    }
    if (rest === '/info' && req.method === 'GET') return sendJson(res, 200, links.info(token, game));
    if (rest.startsWith('/game/') && (req.method === 'GET' || req.method === 'HEAD')) {
      links.active(token);
      if (builds.serve(req, res, safeDecode(rest.slice('/game/'.length)))) return;
      throw new ApiError(404, 'Chưa có bản game WebGL trên tool');
    }
    const who = `link:${token}`;
    if (rest === '/plays' && req.method === 'POST') {
      links.active(token);
      const b = parseJson(await readBody(req, LEVEL_BODY_LIMIT));
      return sendJson(res, 200, plays.start(who, { ...b, source: 'link' }, { link: token, player: b?.player }));
    }
    const ev = /^\/plays\/([A-Za-z0-9_-]+)\/events$/.exec(rest);
    if (ev && req.method === 'POST') {
      links.active(token);
      return sendJson(res, 200, plays.append(ev[1], parseJson(await readBody(req, LEVEL_BODY_LIMIT)) || {}, who));
    }
    throw new ApiError(404, 'Not Found');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && String(req.headers.cookie || '').includes(`${COOKIE_NAME}=`)
      && !req.headers.authorization && !writeOrigins.has(req.headers.origin)) {
      throw new ApiError(403, `Yêu cầu ghi không đến từ app ${s.toolName} (Origin không hợp lệ)`);
    }
    if (p === '/healthz') {
      db.get('SELECT 1 x');
      return sendJson(res, 200, { ok: true, version: s.version });
    }
    if (p === '/auth/status') return sendJson(res, 200, { bi: biConfigured, env: s.biEnv, dev: s.dev, version: s.version });
    if (p === '/auth/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Max-Age=0; Path=/` });
    }
    if (p === '/auth/firebase' && req.method === 'POST') return firebaseLogin(req, res);
    if (p === '/bi/login' && req.method === 'GET') {
      const page = bihub.loginPage(s);
      return sendBytes(res, 200, page.body, page.headers);
    }
    if (p === '/bi/login.js' && req.method === 'GET') return sendBytes(res, 200, bihub.loginScript(), { 'Content-Type': 'text/javascript; charset=utf-8' });
    if (p.startsWith('/p/')) return phone(req, res, url, p);
    if (p.startsWith('/api/ci/')) {
      ci.checkToken(req);
      return dispatch(ciApi, req.method, p, { req, res, url });
    }
    if (p.startsWith('/api/')) {
      const user = auth.identify(req, url);
      if (p === '/api/events' && req.method === 'GET') return events(req, res, user);
      return dispatch(api, req.method, p, { req, res, url, user });
    }
    if (p === '/') {
      res.writeHead(302, { Location: '/app/' });
      return res.end();
    }
    const isGame = p.startsWith('/game/');
    const isWeb = p === '/app' || p.startsWith('/app/') || p.startsWith('/core/') || isGame;
    if (isWeb && (isGame || !biConfigured) && !s.dev) {
      try {
        auth.identify(req, url);
      } catch (e) {
        const login = e instanceof ApiError && e.status === 401 && req.method === 'GET' && !isGame ? auth.loginUrl(s.publicBase + p) : null;
        if (!login) throw e;
        res.writeHead(302, { Location: login });
        return res.end();
      }
    }
    if (p === '/app') {
      res.writeHead(307, { Location: '/app/' });
      return res.end();
    }
    if (isGame && builds.serve(req, res, safeDecode(p.slice('/game/'.length)))) return;
    if (isGame) throw new ApiError(404, 'Chưa có bản game WebGL — tải bản build lên (README: Chơi thử bằng game thật)');
    if (p === '/core/ui-template.css') {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'Method Not Allowed');
      if (!uiTemplate) return sendBytes(res, 200, Buffer.alloc(0), { 'Content-Type': 'text/css; charset=utf-8', ...webHeaders });
      if (serveFile(res, path.dirname(uiTemplate), path.basename(uiTemplate), webHeaders)) return;
      throw new ApiError(404, 'Not Found');
    }
    if (p.startsWith('/app/game/')) return serveGameWeb(res, p.slice('/app/game/'.length));
    if (p.startsWith('/core/') && serveFile(res, coreWebDir, p.slice('/core/'.length), webHeaders)) return;
    if (p.startsWith('/app/') && !p.startsWith('/app/game/') && serveFile(res, appDir, p.slice('/app/'.length), webHeaders)) return;
    throw new ApiError(404, 'Not Found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      if (res.headersSent) return res.destroy();
      if (e instanceof ApiError) return sendJson(res, e.status, e.body);
      console.error(e);
      return sendJson(res, 500, { detail: `Lỗi server: ${e.message}` });
    });
  });
  server.on('close', () => {
    housekeeping.stop();
    db.close();
  });
  housekeeping.start();
  return { server, store, broker, db, builds, ci };
}
