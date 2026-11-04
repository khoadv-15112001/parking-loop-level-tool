import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

export const STORAGE_LIMIT = 1_500_000_000;
export const STORAGE_WARNING = 1_200_000_000;
export const STORAGE_RESERVE = 100_000_000;
export const BACKUP_BUDGET = 200_000_000;
export const BUILD_BUDGET = 800_000_000;

export const storageRoots = s => [path.dirname(path.resolve(s.dbPath)), s.gameDir, `${s.gameDir}.builds`, `${s.gameDir}.uploads`, `${s.gameDir}.ci`];

export function diskBytes(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(file).reduce((bytes, name) => bytes + diskBytes(path.join(file, name)), 0);
}

export function storageUsage(roots) {
  const unique = [...new Set(roots.map(root => path.resolve(root)))].sort((a, b) => a.length - b.length);
  const counted = [];
  let bytes = 0;
  for (const root of unique) {
    if (counted.some(parent => root.startsWith(parent + path.sep))) continue;
    counted.push(root);
    bytes += diskBytes(root);
  }
  return { bytes, limit: STORAGE_LIMIT, warning: STORAGE_WARNING, reserve: STORAGE_RESERVE, status: bytes >= STORAGE_LIMIT ? 'full' : bytes >= STORAGE_WARNING ? 'warning' : 'ok' };
}

export function requireStorage(roots, additional, ErrorType) {
  const usage = storageUsage(roots);
  if (usage.bytes + additional + STORAGE_RESERVE > STORAGE_LIMIT) {
    throw new ErrorType(507, 'Dung lượng gần giới hạn 1,5 GB; dọn bản game cũ hoặc chuyển dữ liệu lưu trữ trước khi thử lại.');
  }
  return usage;
}

async function digest(...streams) {
  const hash = crypto.createHash('sha256');
  await pipeline(...streams, new Writable({ write(chunk, encoding, done) { hash.update(chunk); done(); } }));
  return hash.digest('hex');
}

export async function compressBackup(file) {
  const target = `${file}.gz`;
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  const stat = fs.statSync(file);
  try {
    if (!fs.existsSync(target)) {
      await pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(temp, { flags: 'wx' }));
    }
    const packed = fs.existsSync(target) ? target : temp;
    const sourceHash = await digest(fs.createReadStream(file));
    if (await digest(fs.createReadStream(packed), zlib.createGunzip()) !== sourceHash) throw new Error('Bản sao lưu nén không khớp dữ liệu gốc');
    if (packed === temp) {
      const fd = fs.openSync(temp, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, target);
    }
    fs.utimesSync(target, stat.atime, stat.mtime);
    fs.rmSync(file);
    return target;
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function backupFiles(dir, match) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => match.test(name) && fs.lstatSync(path.join(dir, name)).isFile())
    .sort().reverse().map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, at: stat.mtime.toISOString() };
    });
}

export function pruneBackups(dir, match, keep = 7, budget = BACKUP_BUDGET) {
  let bytes = 0;
  const removed = [];
  for (const [index, file] of backupFiles(dir, match).entries()) {
    if (index > 0 && (index >= keep || bytes + file.size > budget)) {
      fs.rmSync(path.join(dir, file.name));
      removed.push(file.name);
    } else bytes += file.size;
  }
  return removed;
}

export async function maintainBackups(dir, match, keep = 7, budget = BACKUP_BUDGET) {
  for (const file of backupFiles(dir, match)) {
    if (file.name.endsWith('.db')) await compressBackup(path.join(dir, file.name));
  }
  return pruneBackups(dir, match, keep, budget);
}
