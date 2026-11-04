// App HTTP của server Node: cùng đường API, ETag / If-Match, lỗi JSON và SSE với server Python (levelcore/server).
// Chưa có ở runtime Node: đăng nhập Google của BI, BI Level Hub, bản game WebGL — /api/me trả `features` để web ẩn.
import http from 'node:http';
import path from 'node:path';
import { Auth, COOKIE_NAME } from './auth.mjs';
import { isAdmin } from './config.mjs';
import { DB } from './db.mjs';
import { Broker } from './events.mjs';
import { ApiError, parseJson, queryBool, readBody, Router, sendBytes, sendJson, serveFile } from './http.mjs';
import { now, parseTime, Store } from './store.mjs';

const WEB_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
  + "frame-src 'self'; frame-ancestors 'none'";
const LEVEL_BODY_LIMIT = 32 * 1024 * 1024;
const IMPORT_BODY_LIMIT = 600 * 1024 * 1024;

const etag = rev => ({ ETag: `"r${rev}"` });
const REPLY = Symbol('reply');
const reply = (status, data, headers = {}) => ({ [REPLY]: true, status, data, headers });

export function createApp(game, s) {
  const db = new DB(s.dbPath);
  const broker = new Broker(now);
  const store = new Store(db, broker, s, game);
  const auth = new Auth(s);
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

  const api = new Router();
  api.add('GET', '/api/me', ({ user }) => ({
    email: user, dev: s.dev, lock_ttl: s.lockTtl, online: broker.online(), admin: isAdmin(s, user), runtime: 'node',
    format_version: s.formatVersion, features: { levelhub: false, bi: false, webgame: false },
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
  api.add('GET', '/api/packs/:pack/export', ({ params }) => ({
    bytes: store.exportPack(params.pack),
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${params.pack}.zip"` },
  }));

  api.add('GET', '/api/audit', ({ url }) => {
    const q = k => url.searchParams.get(k);
    return store.listAudit({ user: q('user'), since: parseTime(q('since')), level: q('level'), pack: q('pack'), action: q('action'), limit: Number(q('limit') || 200) });
  });
  api.add('GET', '/api/bi/config', () => ({ configured: false, env: s.biEnv, appId: '', apiUrl: '', appIds: [], firebase: null }));
  api.add('GET', '/api/game', () => ({ available: false }));
  api.add('GET', '/api/levelhub/options', () => {
    throw new ApiError(501, 'Level Hub chưa có ở runtime Node');
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

  const webHeaders = { 'Content-Security-Policy': WEB_CSP, 'Cache-Control': 'private, no-cache' };
  const appDir = path.join(s.webRoot, 'levelcore', 'web');

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
    if (p === '/auth/status') return sendJson(res, 200, { bi: false, env: s.biEnv, dev: s.dev, version: s.version });
    if (p === '/auth/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Max-Age=0; Path=/` });
    }
    if (p.startsWith('/api/')) {
      const user = auth.identify(req, url);
      if (p === '/api/events' && req.method === 'GET') return events(req, res, user);
      const m = api.match(req.method, p);
      if (!m) throw new ApiError(404, 'Not Found');
      if (m.notAllowed) throw new ApiError(405, 'Method Not Allowed');
      return send(res, await m.handler({ req, res, url, user, params: m.params }));
    }
    if (p === '/') {
      res.writeHead(302, { Location: '/app/' });
      return res.end();
    }
    if (p === '/app') {
      res.writeHead(307, { Location: '/app/' });
      return res.end();
    }
    if (p.startsWith('/app/game/') && serveFile(res, game.webDir, p.slice('/app/game/'.length), webHeaders)) return;
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
  return { server, store, broker, db };
}
