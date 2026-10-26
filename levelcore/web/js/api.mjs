// Client REST của server tool level (cùng origin). DEV: header X-Dev-User; production: cookie vl_sso tự đi kèm.
import game from '../game/game.mjs';

const DEV_KEY = `${game.storagePrefix}.devUser`;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.detail || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}

export const devUser = {
  get: () => { try { return localStorage.getItem(DEV_KEY) || ''; } catch { return ''; } },
  set: v => { try { v ? localStorage.setItem(DEV_KEY, v) : localStorage.removeItem(DEV_KEY); } catch { /* bỏ qua */ } },
};

// Phiên của tool sau khi đăng nhập Google của BI (POST /auth/firebase) — gửi kèm Authorization: Bearer.
const TOKEN_KEY = `${game.storagePrefix}.token`;
export const session = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set: v => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ } },
};

export function authHeaders() {
  const u = devUser.get();
  if (u) return { 'X-Dev-User': u };
  const t = session.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request(method, path, { json, body, headers = {}, raw = false } = {}) {
  const h = { ...authHeaders(), ...headers };
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(path, { method, headers: h, body, credentials: 'same-origin' });
  if (raw && res.ok) return res;
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { detail: text }; }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  const etag = res.headers.get('ETag');
  if (data && typeof data === 'object' && etag) Object.defineProperty(data, '_etag', { value: etag });
  return data;
}

const enc = encodeURIComponent;
const lv = (pack, name) => `/api/packs/${enc(pack)}/levels/${enc(name)}`;

export const api = {
  me: () => request('GET', '/api/me'),
  packs: () => request('GET', '/api/packs'),
  createPack: (name, extra = {}) => request('POST', '/api/packs', { json: { name, ...extra } }),
  updatePack: (pack, patch) => request('PATCH', `/api/packs/${enc(pack)}`, { json: patch }),
  renamePack: (pack, to) => request('POST', `/api/packs/${enc(pack)}/rename`, { json: { to } }),
  levels: (pack, includeDeleted = false) => request('GET', `/api/packs/${enc(pack)}/levels${includeDeleted ? '?include_deleted=true' : ''}`),
  bundle: pack => request('GET', `/api/packs/${enc(pack)}/bundle`),
  validatePack: pack => request('GET', `/api/packs/${enc(pack)}/validate`),
  level: (pack, name) => request('GET', lv(pack, name)),
  createLevel: (pack, name, level, message = '') =>
    request('POST', `${lv(pack, name)}?message=${enc(message)}`, { json: level }),
  saveLevel: (pack, name, level, rev, message = '') =>
    request('PUT', `${lv(pack, name)}?message=${enc(message)}`, { json: level, headers: { 'If-Match': `"r${rev}"` } }),
  deleteLevel: (pack, name, rev) => request('DELETE', lv(pack, name), { headers: { 'If-Match': `"r${rev}"` } }),
  revisions: (pack, name) => request('GET', `${lv(pack, name)}/revisions`),
  revision: (pack, name, rev) => request('GET', `${lv(pack, name)}/revisions/${rev}`),
  revisionDiff: (pack, name, rev) => request('GET', `${lv(pack, name)}/revisions/${rev}/diff`),
  revert: (pack, name, toRev, headRev) =>
    request('POST', `${lv(pack, name)}/revert`, { json: { rev: toRev }, headers: { 'If-Match': `"r${headRev}"` } }),
  relevel: (pack, name, to, mode, headRev, dryRun = false) =>
    request('POST', `${lv(pack, name)}/relevel`, {
      json: { to: String(to), mode, dry_run: dryRun }, headers: dryRun ? {} : { 'If-Match': `"r${headRev}"` },
    }),
  lock: (pack, name) => request('POST', `/api/locks/packs/${enc(pack)}/levels/${enc(name)}`),
  heartbeat: (pack, name) => request('PUT', `/api/locks/packs/${enc(pack)}/levels/${enc(name)}`),
  unlock: (pack, name, force = false) =>
    request('DELETE', `/api/locks/packs/${enc(pack)}/levels/${enc(name)}${force ? '?force=1' : ''}`),
  promote: (from, to, items, message = '') => request('POST', '/api/promote', { json: { from, to, items, message } }),
  importLevels: (pack, file) => request('POST', `/api/packs/${enc(pack)}/import`, {
    body: file, headers: { 'Content-Type': file.type || (file.name?.endsWith('.zip') ? 'application/zip' : 'application/json') },
  }),
  exportPack: pack => request('GET', `/api/packs/${enc(pack)}/export`, { raw: true }),
  levelhubOptions: () => request('GET', '/api/levelhub/options'),
  levelhubPreflight: (pack, body) => request('POST', `/api/packs/${enc(pack)}/levelhub/preflight`, { json: body }),
  levelhubExport: (pack, body) => request('POST', `/api/packs/${enc(pack)}/levelhub/export`, { json: body, raw: true }),
  audit: (params = {}) => request('GET', `/api/audit?${new URLSearchParams(params)}`),
  importJson: (pack, obj, message = '') =>
    request('POST', `/api/packs/${enc(pack)}/import?message=${enc(message)}`, { json: obj }),

  // ----- đăng nhập + BI Level Hub (token BI trong X-BI-Token, server chỉ chuyển tiếp) -----
  authStatus: () => request('GET', '/auth/status'),
  logout: () => request('POST', '/auth/logout'),
  biConfig: () => request('GET', '/api/bi/config'),
  biGroups: (token, page = 1, search = '', archived = false) =>
    request('GET', `/api/bi/asset-groups?page=${page}&search=${enc(search)}${archived ? '&archived=true' : ''}`,
      { headers: { 'X-BI-Token': token } }),
  biGroupAction: (token, id, action) =>
    request('POST', `/api/bi/groups/${enc(id)}/${enc(action)}`, { headers: { 'X-BI-Token': token } }),
  biGroup: (token, id) => request('GET', `/api/bi/groups/${enc(id)}`, { headers: { 'X-BI-Token': token } }),
  biFiles: (token, id, page = 1) =>
    request('GET', `/api/bi/asset-groups/${enc(id)}/files?page=${page}`, { headers: { 'X-BI-Token': token } }),
  biFileRaw: (token, id, fileId) =>
    request('GET', `/api/bi/asset-groups/${enc(id)}/files/${enc(fileId)}/raw`, { headers: { 'X-BI-Token': token } }),
  gameInfo: () => request('GET', '/api/game'),
  /** Tải zip bản game theo từng phần (proxy của link công ty giới hạn cỡ mỗi request); onProgress(phần xong, tổng phần). */
  gameUpload: async (file, onProgress = () => {}) => {
    const up = await request('POST', '/api/game/uploads', { json: { size: file.size, name: file.name || '' } });
    for (let i = 0; i < up.parts; i++) {
      const part = file.slice(i * up.chunk, Math.min(file.size, (i + 1) * up.chunk));
      await request('PUT', `/api/game/uploads/${up.id}/${i}`, { body: part, headers: { 'Content-Type': 'application/octet-stream' } });
      onProgress(i + 1, up.parts);
    }
    return request('POST', `/api/game/uploads/${up.id}/complete`);
  },
  levelhubUpload: (pack, body, token) =>
    request('POST', `/api/packs/${enc(pack)}/levelhub/upload`, { json: body, headers: { 'X-BI-Token': token } }),
};

/** Tải Response (zip) về máy với tên file trong Content-Disposition. */
export async function downloadResponse(res, fallback) {
  const blob = await res.blob();
  const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  downloadBlob(blob, m ? m[1] : fallback);
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
