// App HTTP của server Node: cùng đường API, ETag / If-Match, lỗi JSON và SSE với server Python (levelcore/server).
// Gồm cả đăng nhập Google của BI, BI Level Hub, bản game WebGL (nhiều bản build) và hợp đồng CI v1.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Auth, COOKIE_NAME, SESSION_TTL } from './auth.mjs';
import * as bihub from './bihub.mjs';
import { Ci, cleanMeta, MAX_LEVELS_ZIP } from './ci.mjs';
import { isAdmin } from './config.mjs';
import { DB } from './db.mjs';
import { Broker } from './events.mjs';
import { ApiError, parseJson, queryBool, readBody, Router, sendBytes, sendJson, serveFile } from './http.mjs';
import * as levelhub from './levelhub.mjs';
import { iso, now, parseTime, Store } from './store.mjs';
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
  const db = new DB(s.dbPath);
  const broker = new Broker(now);
  const store = new Store(db, broker, s, game);
  const biConfigured = bihub.configured(s);
  const auth = new Auth(s, biConfigured);
  const builds = new Builds(s);
  const uploads = new ChunkUploads(builds);
  const ci = new Ci(s, db, store, broker, builds);
  store.ensureDefaultPacks();

  const pub = new URL(s.publicBase);
  const writeOrigins = new Set([pub.origin, ...s.corsOrigins]);
  if (s.dev && pub.port) {
    writeOrigins.add(`http://localhost:${pub.port}`);
    writeOrigins.add(`http://127.0.0.1:${pub.port}`);
  }

  const requireAdmin = (user, what) => {
    if (!isAdmin(s, user)) throw new ApiError(403, `Chỉ admin được ${what}`);
  };
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
    email: user, dev: s.dev, lock_ttl: s.lockTtl, online: broker.online(), admin: isAdmin(s, user), runtime: 'node',
    format_version: s.formatVersion, features: { levelhub: !!game.levelhub, bi: biConfigured, webgame: true },
  }));
  api.add('GET', '/api/packs', () => store.listPacks());
  api.add('POST', '/api/packs', async ({ req, user }) => {
    const b = await objectBody(req);
    return reply(201, store.createPack(user, b.name, b.description ?? '', b.platform ?? 'android', b.group ?? ''));
  });
  api.add('PATCH', '/api/packs/:pack', async ({ req, user, params }) => {
    const b = await objectBody(req);
    if (b.production != null || b.archived != null) requireAdmin(user, 'đổi cờ production / lưu trữ');
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
      if (l && l.holder !== user) requireAdmin(user, 'phá khoá của người khác');
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
      zip: biName, env: s.biEnv, app: appId, group: group?.id ?? null, levels: summary.levelCount, missing: summary.missingTotal,
      manifest: summary.manifest, newer: summary.newer, recovered,
    }));
    return { name: biName, group, levelCount: summary.levelCount, newer: summary.newer, recovered, checked_at: iso(Date.now() / 1000) };
  });

  // ----- Bản game WebGL: bản đang dùng, bản chờ chọn, tải tay (admin) -----
  api.add('GET', '/api/game', () => builds.info());
  api.add('POST', '/api/game/uploads', async ({ req, user }) => {
    requireAdmin(user, 'tải bản game lên');
    return uploads.start(user, await objectBody(req));
  });
  api.add('PUT', '/api/game/uploads/:id/:i', async ({ req, user, params }) => {
    requireAdmin(user, 'tải bản game lên');
    return uploads.part(params.id, params.i, await readBody(req, CHUNK_BYTES + 1));
  });
  api.add('POST', '/api/game/uploads/:id/complete', ({ user, params }) => {
    requireAdmin(user, 'tải bản game lên');
    return uploads.complete(params.id, user);
  });
  api.add('POST', '/api/game/upload', async ({ req, user, url }) => {
    requireAdmin(user, 'tải bản game lên');
    const tmp = tempZip('single');
    try {
      await streamToFile(req, tmp, MAX_ZIP_BYTES);
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
    requireAdmin(user, 'chọn bản game');
    return ci.activate(user, params.id);
  });
  api.add('DELETE', '/api/game/builds/:id', ({ user, params }) => {
    requireAdmin(user, 'xoá bản game');
    return ci.reject(user, params.id);
  });

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
      const digest = await streamToFile(req, tmp, MAX_ZIP_BYTES);
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
  const coreWebDir = path.join(s.webRoot, 'levelcore', 'web');
  const appDir = game.appDir || coreWebDir;
  // Game không có game.mjs riêng thì dùng game.mjs mặc định của core (dựng từ manifest + module luật).
  const gameWebFallback = {
    'game.mjs': path.join(coreWebDir, 'js', 'default_game.mjs'), 'manifest.json': game.manifestPath, 'rules.mjs': game.rulesPath,
  };

  function serveGameWeb(res, rel) {
    if (serveFile(res, game.webDir, rel, webHeaders)) return;
    const file = gameWebFallback[rel];
    if (file && serveFile(res, path.dirname(file), path.basename(file), webHeaders)) return;
    if (rel === 'game.css') return sendBytes(res, 200, Buffer.alloc(0), { 'Content-Type': 'text/css; charset=utf-8', ...webHeaders });
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
  server.on('close', () => db.close());
  return { server, store, broker, db, builds, ci };
}
