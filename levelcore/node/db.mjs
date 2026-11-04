// SQLite của server Node (node:sqlite, WAL). Cùng các bảng với server Python (levelcore/server/levelcore/db.py) để
// logic chép qua lại một-một; hai runtime chưa cam kết dùng chung một file DB. Node chạy một luồng nên mỗi lần ghi
// chỉ cần BEGIN IMMEDIATE … COMMIT, lỗi bất kỳ thì ROLLBACK.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS packs(
  name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, created_by TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, production INTEGER NOT NULL DEFAULT 0,
  platform TEXT NOT NULL DEFAULT 'android', grp TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS blobs(
  sha TEXT PRIMARY KEY, size INTEGER NOT NULL, codec TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS levels(
  id INTEGER PRIMARY KEY, pack TEXT NOT NULL REFERENCES packs(name), name TEXT NOT NULL,
  sort_key INTEGER, head_rev INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL, updated_at REAL NOT NULL, updated_by TEXT NOT NULL, summary TEXT,
  UNIQUE(pack, name));
CREATE TABLE IF NOT EXISTS revisions(
  level_id INTEGER NOT NULL REFERENCES levels(id), rev INTEGER NOT NULL,
  blob_sha TEXT REFERENCES blobs(sha), author TEXT NOT NULL, created_at REAL NOT NULL,
  kind TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', unlocked_edit INTEGER NOT NULL DEFAULT 0,
  meta TEXT, PRIMARY KEY(level_id, rev));
CREATE TABLE IF NOT EXISTS locks(
  pack TEXT NOT NULL, name TEXT NOT NULL, holder TEXT NOT NULL,
  since REAL NOT NULL, expires_at REAL NOT NULL, PRIMARY KEY(pack, name));
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL,
  pack TEXT, level TEXT, rev INTEGER, detail TEXT);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
CREATE INDEX IF NOT EXISTS audit_user ON audit(user, ts);
CREATE TABLE IF NOT EXISTS ci_levels(
  digest TEXT PRIMARY KEY, by TEXT NOT NULL, received_at REAL NOT NULL, status TEXT NOT NULL,
  build TEXT, pack TEXT, detail TEXT, updated_at REAL NOT NULL);
`;

export class DB {
  constructor(file) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=30000');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(SCHEMA);
    this.statements = new Map();
  }

  q(sql) {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.statements.set(sql, st);
    }
    return st;
  }

  get(sql, ...args) {
    return this.q(sql).get(...args) ?? null;
  }

  all(sql, ...args) {
    return this.q(sql).all(...args);
  }

  run(sql, ...args) {
    return this.q(sql).run(...args);
  }

  write(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this.db.close();
  }
}
