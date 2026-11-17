// Thông tin quản lý của bộ (server Node): mã bộ cố định, mục đích, trạng thái, người phụ trách, ghi chú bàn giao, nơi đang
// chạy. Trạng thái suy ra từ cờ production / archived (hợp đồng chung với server Python) và cờ chờ duyệt.
import crypto from 'node:crypto';
import { ApiError } from './http.mjs';

export const STATUSES = ['draft', 'review', 'live', 'archived'];
export const DEFAULT_PURPOSES = [
  { key: 'main', label: 'Main' }, { key: 'daily', label: 'Daily' }, { key: 'ab', label: 'AB test' }, { key: 'event', label: 'Event' },
];
export const NOTE_KEYS = ['goal', 'design', 'todo'];
export const DEPLOY_KEYS = ['remote_config', 'ab_group', 'app_version'];
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function purposesOf(manifest) {
  const list = Array.isArray(manifest.packPurposes) && manifest.packPurposes.length ? manifest.packPurposes : DEFAULT_PURPOSES;
  return list.map(p => (typeof p === 'string' ? { key: p, label: p } : { key: String(p.key), label: String(p.label ?? p.key) }));
}

export function codePrefix(manifest) {
  const raw = manifest.packCodePrefix || manifest.levelhub?.acronym || manifest.slug || manifest.tool || '';
  return String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12) || 'PACK';
}

export const formatCode = (prefix, n) => `${prefix}-S${String(n).padStart(2, '0')}`;

export function statusOf(row) {
  if (row.archived) return 'archived';
  if (row.production) return 'live';
  return row.review_at != null ? 'review' : 'draft';
}

export function cleanFields(value, keys, what, max) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, `${what} phải là object`);
  const out = {};
  for (const k of keys) {
    const v = value[k] ?? '';
    if (typeof v !== 'string') throw new ApiError(400, `${what}.${k} phải là chuỗi`);
    const t = v.trim();
    if (t.length > max) throw new ApiError(400, `${what}.${k} tối đa ${max} ký tự`);
    if (t) out[k] = t;
  }
  return out;
}

export function checkPurpose(manifest, purpose) {
  if (typeof purpose !== 'string') throw new ApiError(400, 'purpose phải là chuỗi');
  if (purpose && !purposesOf(manifest).some(p => p.key === purpose)) {
    throw new ApiError(400, `Mục đích phải là một trong: ${purposesOf(manifest).map(p => p.key).join(', ')}`);
  }
  return purpose;
}

export function checkEmail(value, what = 'Email') {
  const e = String(value ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new ApiError(400, `${what} không hợp lệ: ${value}`);
  return e;
}

export function checkNote(value, { required = false, max = 500, what = 'Ghi chú' } = {}) {
  if (value != null && typeof value !== 'string') throw new ApiError(400, `${what} phải là chuỗi`);
  const t = String(value ?? '').trim();
  if (required && t.length < 3) throw new ApiError(400, `Cần ${what.toLowerCase()} (ít nhất 3 ký tự)`);
  if (t.length > max) throw new ApiError(400, `${what} tối đa ${max} ký tự`);
  return t;
}

/** Khoá nội dung không phụ thuộc số level: hai level giống nhau chỉ khác số (do setLevelNumber) có cùng khoá. */
export function contentKey(game, obj) {
  let o = obj;
  try {
    o = game.setNumber(JSON.parse(JSON.stringify(obj)), 0);
  } catch {
    o = obj;
  }
  return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 32);
}
