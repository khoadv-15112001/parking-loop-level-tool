// Cấu hình server Node từ biến môi trường <PREFIX>_* (PREFIX = manifest.prefix) — cùng tên biến với server Python
// (levelcore/README.md). Trên BI Center: SBP_* là mặc định, <PREFIX>_* (nếu đặt) thắng.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.dirname(CORE);

const bool = v => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
const list = v => String(v ?? '').split(',').map(x => x.trim()).filter(Boolean);

export function settingsFromEnv(manifest, env = process.env) {
  const p = manifest.prefix;
  const e = (k, d) => env[`${p}_${k}`] ?? d;
  const dataDir = env.SBP_DATA_DIR;
  const dbName = `${manifest.tool.toLowerCase()}.db`;
  const port = Number(e('PORT', env.PORT || 8880));
  return {
    toolName: manifest.tool,
    envPrefix: p,
    dev: bool(e('DEV')),
    port,
    host: e('HOST', env.HOST || '127.0.0.1'),
    dbPath: e('DB') || env.SBP_SQLITE_PATH || (dataDir ? path.join(dataDir, dbName) : path.join(REPO, 'data', dbName)),
    publicBase: (e('PUBLIC_BASE') || env.SBP_TOOL_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    webRoot: e('WEB_ROOT', '') || REPO,
    allowlistPath: e('ALLOWLIST', ''),
    allowedDomain: e('ALLOWED_DOMAIN', 'sonat.vn'),
    lockTtl: Number(e('LOCK_TTL', 600)),
    sseHeartbeat: Number(e('SSE_HEARTBEAT', 25)),
    admins: list(e('ADMINS', '')).map(a => a.toLowerCase()),
    sessionSecret: e('SESSION_SECRET', ''),
    corsOrigins: list(e('CORS_ORIGINS', '')),
    biEnv: e('BI_ENV', 'dev'),
    biApiUrl: e('BI_API_URL', ''),
    biAppId: e('BI_APP_ID', manifest.biAppId || ''),
    biAppIdIos: e('BI_APP_ID_IOS', ''),
    biFirebaseApiKey: e('BI_FIREBASE_API_KEY', ''),
    biFirebaseAuthDomain: e('BI_FIREBASE_AUTH_DOMAIN', ''),
    biFirebaseProjectId: e('BI_FIREBASE_PROJECT_ID', ''),
    biFirebaseAppId: e('BI_FIREBASE_APP_ID', ''),
    gameDir: e('GAME_DIR') || (dataDir ? path.join(dataDir, 'game') : path.join(REPO, 'data', 'game')),
    ciToken: String(e('CI_TOKEN', '')).trim(),
    ciBranch: String(e('CI_BRANCH', '')).trim(),
    ciPack: String(e('CI_PACK', '')).trim(),
    version: env.SBP_VERSION || 'dev',
    formatVersion: manifest.formatVersion ?? null,
    defaultPacks: manifest.defaultPacks || ['develop', 'product'],
  };
}

/** Danh sách admin rỗng: chỉ máy DEV là admin (tool trên BI phải khai <PREFIX>_ADMINS). */
export function isAdmin(s, email) {
  return s.admins.length ? s.admins.includes(String(email).toLowerCase()) : s.dev;
}
