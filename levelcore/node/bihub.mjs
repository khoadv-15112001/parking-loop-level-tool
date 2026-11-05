// Client BI Level Hub và đăng nhập Google của BI cho server Node — cùng hợp đồng với levelcore/server/levelcore/bihub.py:
// Firebase ID token của project BI trong `Authorization: Bearer`, mọi route dưới `/level-hub`, response thành công
// `{"status": "success", "data": ...}`. Token BI do trình duyệt gửi trong header `X-BI-Token`; server chỉ chuyển tiếp,
// không lưu, không log. Lỗi của BI trả 502 (`bi_status` = mã gốc), không dùng 401/403 của BI làm 401/403 của tool.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CORE } from './config.mjs';
import { ApiError } from './http.mjs';

const STATIC = path.join(CORE, 'server', 'levelcore', 'static');
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
export const MIN_DESCRIPTION = 100;
const TOKEN_RE = /^[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE_LIMIT = 100;
export const GROUP_STATUSES = ['PROCESSING', 'READY', 'FAILED', 'ARCHIVED'];
export const GROUP_ACTIONS = { retry: 'Update Asset Group', build: 'Update Asset Group', archive: 'Manage Asset Group' };
const LOOKUP_URL = () => process.env.LEVELCORE_FIREBASE_LOOKUP_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

export class BiError extends Error {
  constructor(message, biStatus = null) {
    super(message);
    this.biStatus = biStatus;
  }
}

export function checkToken(token) {
  token = String(token || '').trim();
  if (!token) throw new ApiError(400, 'Chưa đăng nhập BI — bấm Đẩy lên BI để đăng nhập Google');
  if (!TOKEN_RE.test(token)) throw new ApiError(400, 'Token BI không hợp lệ');
  return token;
}

export const configured = s => !!(s.biApiUrl && s.biAppId && s.biFirebaseApiKey && s.biFirebaseAuthDomain && s.biFirebaseProjectId && s.biFirebaseAppId);

export function appIds(s) {
  const out = { Android: s.biAppId };
  if (s.biAppIdIos) out.iOS = s.biAppIdIos;
  return out;
}

export function publicConfig(s) {
  return {
    configured: configured(s), env: s.biEnv, appId: s.biAppId, apiUrl: s.biApiUrl, appIds: appIds(s),
    firebase: configured(s) ? { apiKey: s.biFirebaseApiKey, authDomain: s.biFirebaseAuthDomain, projectId: s.biFirebaseProjectId, appId: s.biFirebaseAppId } : null,
  };
}

export function requireConfigured(s) {
  if (!configured(s)) throw new ApiError(503, `Chưa cấu hình BI Level Hub (${s.envPrefix}_BI_* — xem README.md)`);
}

export function appForOs(s, os) {
  const app = appIds(s)[os];
  if (!app) throw new ApiError(400, `Chưa cấu hình appId BI cho ${os} (${s.envPrefix}_BI_APP_ID_IOS) — chưa đẩy bộ ${os} lên được`);
  return app;
}

function multipart(fields, fileField, fileName, fileBytes, contentType) {
  const boundary = `----levelcore${crypto.randomBytes(16).toString('hex')}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`, 'utf8'));
  parts.push(fileBytes, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return [Buffer.concat(parts), `multipart/form-data; boundary=${boundary}`];
}

function message(raw) {
  const text = Buffer.from(raw).toString('utf8');
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return text.slice(0, 200);
  }
  let m = j && typeof j === 'object' && !Array.isArray(j) ? j.message : null;
  if (Array.isArray(m)) m = m.join('; ');
  return String(m || JSON.stringify(j)).slice(0, 300);
}

async function send(url, init, timeout) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout * 1000) });
  } catch (e) {
    throw new BiError(`Không kết nối được BI: ${e.cause?.code || e.message}`);
  }
  let raw;
  try {
    raw = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new BiError(`Mất kết nối khi đọc phản hồi của BI: ${e.cause?.code || e.message}`);
  }
  if (!res.ok) throw new BiError(message(raw), res.status);
  return { res, raw };
}

/** Gọi `{biApiUrl}/level-hub{p}`, trả `data`. Lỗi → BiError (message của BI + mã HTTP). */
export async function call(s, method, p, token, { json, body, timeout = 30 } = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  let data;
  if (json !== undefined) {
    data = JSON.stringify(json);
    headers['Content-Type'] = 'application/json';
  } else if (body) {
    [data, headers['Content-Type']] = body;
  }
  const { raw } = await send(`${s.biApiUrl.replace(/\/+$/, '')}/level-hub${p}`, { method, headers, body: data }, timeout);
  let j;
  try {
    j = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BiError('BI trả dữ liệu không phải JSON');
  }
  return j && typeof j === 'object' && !Array.isArray(j) && 'data' in j ? j.data : j;
}

/** `step` = bước đang gọi (parse-name cần quyền Read Asset Group, tạo nhóm cần Create) — để biết xin quyền gì. */
export function asApiError(e, step = '', appId = '') {
  if (!(e instanceof BiError)) return e;
  const hint = {
    401: ' — token hết hạn / sai project, đăng nhập lại',
    403: ` — tài khoản chưa có quyền Level Hub cho bước này hoặc chưa được truy cập app ${appId || '?'}`,
    409: ' — BI đã có bộ cùng tên: đổi Version hoặc ngày rồi đẩy lại',
    413: ' — gói quá lớn với BI: chia nhỏ dải level',
  };
  return new ApiError(502, `BI${step ? ` [${step}]` : ''}: ${e.message}${hint[e.biStatus] || ''}`, { bi_status: e.biStatus, bi_step: step || null });
}

function checkedId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new ApiError(400, `id ${label} không hợp lệ`);
  return value;
}

const query = pairs => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

export const parseName = (s, token, name, appId = '') => call(s, 'POST', '/parse-name', token, { json: { appId: appId || s.biAppId, name } });

export async function checkName(s, token, name, appId) {
  try {
    await parseName(s, token, name, appId);
    return { name, available: true, suggestion: null };
  } catch (e) {
    if (!(e instanceof BiError) || e.biStatus !== 409) throw e;
  }
  const parts = name.split('_');
  const version = parts.pop();
  const n = Number(version.replace(/^v/i, '')) || 1;
  if (!Number.isSafeInteger(n) || n > Number.MAX_SAFE_INTEGER - 20) return { name, available: false, suggestion: null };
  for (let i = 1; i <= 20; i++) {
    const next = `v${String(n + i).padStart(version.slice(1).length, '0')}`;
    try {
      await parseName(s, token, [...parts, next].join('_'), appId);
      return { name, available: false, suggestion: next };
    } catch (e) {
      if (!(e instanceof BiError) || e.biStatus !== 409) throw e;
    }
  }
  return { name, available: false, suggestion: null };
}

export function createGroup(s, token, name, zip, description = '', appId = '') {
  if (zip.length > MAX_ZIP_BYTES) throw new BiError('Zip lớn hơn 200 MiB — chia nhỏ dải level hoặc bỏ ảnh preview');
  const fields = { appId: appId || s.biAppId, name };
  if (description) fields.description = description;
  return call(s, 'POST', '/asset-groups', token, { body: multipart(fields, 'file', `${name}.zip`, zip, 'application/zip'), timeout: 300 });
}

export const getGroup = (s, token, id) => call(s, 'GET', `/asset-groups/${checkedId(id, 'nhóm')}`, token);

export async function listGroups(s, token, page, search = '', statuses = []) {
  const apps = Object.values(appIds(s));
  const fetchPage = list => {
    const params = [...list.map(a => ['appIds', a]), ['page', page], ['limit', PAGE_LIMIT], ...statuses.filter(x => GROUP_STATUSES.includes(x)).map(x => ['statuses', x])];
    if (search) params.push(['search', search]);
    return call(s, 'GET', `/asset-groups?${query(params)}`, token);
  };
  try {
    return await fetchPage(apps);
  } catch (e) {
    if (apps.length < 2 || !(e instanceof BiError) || ![400, 403, 404].includes(e.biStatus)) throw e;
    const out = await fetchPage([s.biAppId]);
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      return { ...out, warning: `Không đọc được bộ iOS (appId ${s.biAppIdIos}) trên BI: ${e.message} — chỉ hiện bộ Android. Kiểm tra ${s.envPrefix}_BI_APP_ID_IOS / quyền Level Hub cho app iOS.` };
    }
    return out;
  }
}

const createdAt = g => {
  const t = Date.parse(String(g.createdAt || ''));
  return Number.isFinite(t) ? t / 1000 : 0;
};
const createdBy = g => String((g.createdBy && typeof g.createdBy === 'object' ? g.createdBy.email || g.createdBy.id : g.createdBy) || '').trim().toLowerCase();

/** Mất phản hồi sau POST tạo bộ: tìm bộ cùng tên + appId tạo từ lúc bấm (lệch giờ 2 phút), do chính user tạo nếu BI trả createdBy. */
export async function findCreatedGroup(s, token, name, appId, since, user) {
  const params = [['appIds', appId], ['page', 1], ['limit', PAGE_LIMIT], ['search', name], ...GROUP_STATUSES.map(x => ['statuses', x])];
  const out = await call(s, 'GET', `/asset-groups?${query(params)}`, token);
  const items = Array.isArray(out) ? out : out?.items || [];
  return items.find(g => g && g.name === name && createdAt(g) >= since - 120 && [undefined, null, appId].includes(g.appId)
    && ['', user].includes(createdBy(g))) || null;
}

export const listGroupFiles = (s, token, id, page) => call(s, 'GET', `/asset-groups/${checkedId(id, 'nhóm')}/files?${query([['page', page], ['limit', PAGE_LIMIT]])}`, token);

export function groupAction(s, token, id, action) {
  if (!GROUP_ACTIONS[action]) throw new ApiError(400, 'action phải là retry | build | archive');
  return call(s, 'POST', `/asset-groups/${checkedId(id, 'nhóm')}/${action}`, token, { json: {}, timeout: 60 });
}

export async function getFileRaw(s, token, groupId, fileId) {
  const url = `${s.biApiUrl.replace(/\/+$/, '')}/level-hub/asset-groups/${checkedId(groupId, 'nhóm')}/files/${checkedId(fileId, 'file')}/raw`;
  const { res, raw } = await send(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, 30);
  let type = (res.headers.get('content-type') || 'application/json').trim();
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;\s*charset\s*=\s*["']?[a-z0-9._-]+["']?)?$/i.test(type)) type = 'application/json';
  return { raw, type };
}

/** Firebase ID token → email đã xác minh (accounts:lookup với apiKey của project BI). Chỉ gọi lúc đăng nhập. */
export async function verifyIdToken(s, idToken) {
  if (!TOKEN_RE.test(String(idToken || '').trim())) throw new ApiError(400, 'Token Firebase không hợp lệ');
  let res, j;
  try {
    res = await fetch(`${LOOKUP_URL()}?key=${encodeURIComponent(s.biFirebaseApiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idToken.trim() }), signal: AbortSignal.timeout(15000),
    });
    j = await res.json();
  } catch {
    throw new ApiError(502, 'Không kết nối được Firebase để xác minh đăng nhập');
  }
  if (!res.ok) throw new ApiError(401, 'Firebase từ chối token — đăng nhập lại');
  const user = (j && j.users && j.users[0]) || {};
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || user.emailVerified !== true) throw new ApiError(401, 'Tài khoản Google chưa xác minh email');
  return email;
}

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]));

/** Trang đăng nhập popup — công khai (chỉ chứa cấu hình Web App công khai). */
export function loginPage(s) {
  requireConfigured(s);
  const html = fs.readFileSync(path.join(STATIC, 'bi_login.html'), 'utf8')
    .replaceAll('{sdk}', FIREBASE_SDK).replaceAll('{apiKey}', escHtml(s.biFirebaseApiKey))
    .replaceAll('{authDomain}', escHtml(s.biFirebaseAuthDomain)).replaceAll('{projectId}', escHtml(s.biFirebaseProjectId))
    .replaceAll('{appId}', escHtml(s.biFirebaseAppId)).replaceAll('{env}', escHtml(s.biEnv));
  const csp = "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; "
    + `script-src 'self' ${FIREBASE_SDK.slice(0, FIREBASE_SDK.indexOf('/firebasejs'))} https://apis.google.com; `
    + "style-src 'unsafe-inline'; img-src data: https:; font-src https:; "
    + "connect-src 'self' https://*.googleapis.com https://*.google.com; "
    + `frame-src https://*.firebaseapp.com https://*.web.app https://accounts.google.com https://${escHtml(s.biFirebaseAuthDomain || 'invalid.invalid')}`;
  return {
    body: Buffer.from(html, 'utf8'),
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' },
  };
}

export const loginScript = () => fs.readFileSync(path.join(STATIC, 'bi_login.js'));
