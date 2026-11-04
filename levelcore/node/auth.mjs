// Danh tính trên server Node, cùng luật với levelcore/server/levelcore/auth.py:
//   - DEV (<PREFIX>_DEV=1): header X-Dev-User (hoặc ?dev_user= cho SSE);
//   - phiên của tool: token payload.HMAC (định dạng vl_sso, khoá <PREFIX>_SESSION_SECRET) trong Authorization: Bearer
//     hoặc cookie vl_sso.
// Chỉ email trong <PREFIX>_ALLOWLIST (nếu có) hoặc thuộc <PREFIX>_ALLOWED_DOMAIN mới vào được.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ApiError } from './http.mjs';

export const COOKIE_NAME = 'vl_sso';
export const SESSION_TTL = 7 * 24 * 3600;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const b64 = buf => Buffer.from(buf).toString('base64url');

export function signSession(email, key, maxAge = SESSION_TTL) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({ email, iat: now, exp: now + maxAge }));
  return `${payload}.${b64(crypto.createHmac('sha256', key).update(payload).digest())}`;
}

export function verifySession(token, key) {
  if (!token || !token.includes('.')) return '';
  const [payload, sig] = token.split('.', 2);
  const expect = b64(crypto.createHmac('sha256', key).update(payload).digest());
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return '';
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Number(data.exp || 0) < Date.now() / 1000) return '';
    return String(data.email || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export class Auth {
  constructor(s, biConfigured = false) {
    this.s = s;
    this.biConfigured = biConfigured;
    this.key = s.sessionSecret ? Buffer.from(s.sessionSecret) : crypto.randomBytes(32);
    this.allow = new Set();
    this.allowMtime = null;
  }

  allowed(email) {
    if (!EMAIL_RE.test(email)) return false;
    if (!this.s.allowlistPath) return !this.s.allowedDomain || email.split('@')[1] === this.s.allowedDomain;
    let mtime;
    try {
      mtime = fs.statSync(this.s.allowlistPath).mtimeMs;
    } catch {
      return false;
    }
    if (mtime !== this.allowMtime) {
      const lines = fs.readFileSync(this.s.allowlistPath, 'utf8').split(/\r?\n/);
      this.allow = new Set(lines.map(l => l.split('#')[0].trim().toLowerCase()).filter(Boolean));
      this.allowMtime = mtime;
    }
    return this.allow.has(email);
  }

  requireAllowed(email) {
    if (!this.allowed(email)) throw new ApiError(403, `${email} không có quyền dùng ${this.s.toolName} — nhờ admin thêm vào allowlist`);
  }

  tokenOf(req) {
    const h = String(req.headers.authorization || '');
    if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
    return cookieOf(req, COOKIE_NAME);
  }

  issue(email) {
    return signSession(email, this.key);
  }

  /** Trang đăng nhập Google của BI; chưa cấu hình BI thì null (chỉ vào được bằng DEV). */
  loginUrl(next) {
    return this.biConfigured ? `${this.s.publicBase}/bi/login?next=${encodeURIComponent(next)}` : null;
  }

  identify(req, url) {
    let email = null;
    if (this.s.dev) email = String(req.headers['x-dev-user'] || url.searchParams.get('dev_user') || '').trim().toLowerCase() || null;
    if (!email) {
      email = verifySession(this.tokenOf(req), this.key);
      if (!email) {
        throw new ApiError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn', {
          login_url: this.loginUrl(`${this.s.publicBase}/app/`), bi_login: this.biConfigured, dev: this.s.dev,
        });
      }
    }
    this.requireAllowed(email);
    return email;
  }
}
