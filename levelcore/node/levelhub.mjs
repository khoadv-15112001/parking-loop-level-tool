// Xuất gói Level Hub (package com.sonat.level.build 0.4.0) cho server Node — cùng luật với
// levelcore/server/levelcore/levelhub.py: zip `LevelMetadata.json` + `Raw/<n>.json`, tên zip 9 phần, snapshot để xuất đúng
// các revision đã kiểm tra.
import { ApiError } from './http.mjs';
import { createZip } from './zip.mjs';

export const OS_CODES = { Android: 'A', iOS: 'I' };
export const TEAMS = ['GD', 'CM'];
export const WHY_OPTIONS = ['retention', 'ftue', 'monetization', 'rrd7'];
export const GEO_OPTIONS = ['Tier1', 'Tier2', 'Tier3', 'Tier4', 'Global'];
const NO_OBSTACLES = 'N0';
const MAX_SNAPSHOT = 20000;
const VN_OFFSET = 7 * 3600 * 1000;
const FIELD_ORDER = ['game', 'os', 'team', 'designer', 'version', 'level', 'mechanics', 'difficulty', 'layout', 'uniqueColor',
  'totalBlock', 'obstacleInfos', 'time', 'date', 'geo', 'why', 'fromLv', 'toLv'];
const EMPTY = { mechanics: '', difficulty: 0, uniqueColor: 0, totalBlock: 0, time: 0, obstacleCounts: {} };

export class ExportBlocked extends Error {
  constructor(reason, report) {
    super(reason);
    this.report = report;
  }
}

export function specOf(game) {
  if (!game.levelhub) throw new ApiError(400, `${game.manifest.tool} chưa khai báo Level Hub (manifest "levelhub")`);
  return game.levelhub;
}

const describe = (game, level, n) => ({ ...EMPTY, ...(game.describeHub(level, n) || {}) });
const obstacleInfos = (counts, codes) => codes.filter(([key]) => (counts[key] || 0) > 0).map(([key, code]) => `${code}${counts[key]}`).join('') || NO_OBSTACLES;
const sanitize = text => String(text ?? '').replace(/[^A-Za-z0-9]/g, '');
export const normalizeVersion = v => `v${sanitize(v).replace(/^[vV]+/, '') || '1'}`;
export const joinGeo = tags => (tags || []).map(sanitize).filter(Boolean).join('-');

function vnParts(ms) {
  const d = new Date(ms + VN_OFFSET);
  const p = n => String(n).padStart(2, '0');
  return { dd: p(d.getUTCDate()), mm: p(d.getUTCMonth() + 1), yy: p(d.getUTCFullYear() % 100) };
}

export function composeZipName(acronym, os, fromLv, toLv, geo, why, designer, nowMs, version) {
  const { dd, mm } = vnParts(nowMs);
  return `${[sanitize(acronym), os, String(fromLv), String(toLv), joinGeo(geo), sanitize(why), sanitize(String(designer || '').split('@')[0]), `${dd}${mm}`, normalizeVersion(version)].join('_')}.zip`;
}

function rowDate(updatedAt) {
  const t = Date.parse(updatedAt || '');
  const { dd, mm, yy } = vnParts(Number.isFinite(t) ? t : Date.now());
  return `${dd}${mm}${yy}`;
}

/** Tham số xuất từ body; sai → 400 như server Python. */
export function parseRequest(pack, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Body phải là JSON object');
  const num = k => {
    const v = body[k];
    if (!Number.isInteger(v) || v < 1) throw new ApiError(400, `${k} phải là số nguyên ≥ 1`);
    return v;
  };
  const req = { pack, fromLv: num('from_lv'), toLv: num('to_lv'), os: body.os ?? 'Android', team: body.team ?? 'GD', designer: '', why: '', version: 'v1', geo: [], allowMissing: body.allow_missing === true, snapshot: null };
  if (req.fromLv > req.toLv) throw new ApiError(400, 'from_lv phải ≤ to_lv');
  if (!OS_CODES[req.os]) throw new ApiError(400, 'os phải là Android | iOS');
  if (!TEAMS.includes(req.team)) throw new ApiError(400, `team phải là ${TEAMS.join(' | ')}`);
  for (const k of ['designer', 'why', 'version']) {
    const v = body[k] ?? req[k];
    if (typeof v !== 'string' || v.length > 120) throw new ApiError(400, `${k} phải là chuỗi ≤ 120 ký tự`);
    req[k] = v;
  }
  const geo = body.geo ?? [];
  if (!Array.isArray(geo) || !geo.every(g => typeof g === 'string')) throw new ApiError(400, 'geo phải là mảng chuỗi');
  req.geo = geo;
  const snap = body.snapshot;
  if (snap != null) {
    if (!Array.isArray(snap) || snap.length > MAX_SNAPSHOT || !snap.every(x => x && typeof x.name === 'string' && Number.isInteger(x.rev)
      && typeof x.sha === 'string' && Number.isInteger(x.level))) {
      throw new ApiError(400, 'snapshot phải là mảng {level, name, rev, sha} lấy từ bước Kiểm tra');
    }
    req.snapshot = snap;
  }
  return req;
}

export function preflight(store, req, nowMs = Date.now()) {
  const levels = req.snapshot == null ? store.bundle(req.pack).levels : store.snapshotLevels(req.pack, req.snapshot);
  const inRange = levels.filter(lv => req.fromLv <= lv.level_no && lv.level_no <= req.toLv);
  if (req.snapshot != null && inRange.length !== levels.length) throw new ApiError(400, 'snapshot có level ngoài dải from_lv..to_lv — bấm Kiểm tra lại');
  const have = new Set(inRange.map(lv => lv.level_no));
  const missing = [];
  for (let n = req.fromLv; n <= req.toLv; n++) if (!have.has(n)) missing.push(n);
  const spec = specOf(store.game);
  const checks = store.validate(inRange.map(lv => [lv.name, lv.level]));
  const errors = inRange.map((lv, i) => [lv, checks[i]]).filter(([, v]) => !v.isValid).map(([lv, v]) => ({ level: lv.level_no, errors: v.errors.slice(0, 10) }));
  const rows = inRange.map(lv => {
    const auto = describe(store.game, lv.level, lv.level_no);
    return { level: lv.level_no, rev: lv.rev, mechanics: auto.mechanics, difficulty: auto.difficulty, time: auto.time, uniqueColor: auto.uniqueColor, totalBlock: auto.totalBlock, obstacleInfos: obstacleInfos(auto.obstacleCounts, spec.obstacleCodes) };
  });
  return {
    zipName: composeZipName(spec.acronym, req.os, req.fromLv, req.toLv, req.geo, req.why, req.designer, nowMs, req.version),
    levelCount: inRange.length, missing: missing.slice(0, 500), missingTotal: missing.length, errors, rows, _levels: inRange,
    snapshot: inRange.map(lv => ({ level: lv.level_no, name: lv.name, rev: lv.rev, sha: lv.sha })),
  };
}

export const toPayload = report => Object.fromEntries(Object.entries(report).filter(([k]) => !k.startsWith('_')));

export function buildZip(store, req, nowMs = Date.now()) {
  const report = preflight(store, req, nowMs);
  if (report.levelCount === 0) throw new ExportBlocked('Không có level nào trong dải', report);
  if (report.errors.length) throw new ExportBlocked(`${report.errors.length} level còn lỗi kiểm định — sửa trước khi xuất`, report);
  if (report.missingTotal && !req.allowMissing) throw new ExportBlocked(`Thiếu ${report.missingTotal} level trong dải — xác nhận để xuất`, report);
  const spec = specOf(store.game);
  const rows = [], entries = [];
  for (const lv of report._levels) {
    const n = lv.level_no;
    const auto = describe(store.game, lv.level, n);
    const values = {
      game: spec.acronym, os: OS_CODES[req.os], team: req.team, designer: req.designer, version: normalizeVersion(req.version), level: n,
      mechanics: auto.mechanics, difficulty: auto.difficulty, layout: store.game.hubLayout(lv.level), uniqueColor: auto.uniqueColor,
      totalBlock: auto.totalBlock, obstacleInfos: obstacleInfos(auto.obstacleCounts, spec.obstacleCodes), time: auto.time,
      date: rowDate(lv.updated_at), geo: joinGeo(req.geo), why: req.why, fromLv: req.fromLv, toLv: req.toLv,
    };
    rows.push(Object.fromEntries(FIELD_ORDER.map(k => [k, values[k]])));
    entries.push({ name: `Raw/${n}.json`, data: Buffer.from(JSON.stringify(lv.level, null, 2), 'utf8') });
  }
  entries.push({ name: 'LevelMetadata.json', data: Buffer.from(JSON.stringify({ Levels: rows }, null, 4), 'utf8') });
  const summary = {
    zipName: report.zipName, levelCount: report.levelCount, missingTotal: report.missingTotal,
    manifest: report._levels.map(lv => ({ level: lv.level_no, rev: lv.rev, sha: lv.sha })),
    newer: report._levels.filter(lv => (lv.head_rev ?? lv.rev) !== lv.rev).map(lv => lv.level_no),
  };
  return { zipName: report.zipName, data: createZip(entries), summary };
}
