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
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS plays(
  id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, pack TEXT, level TEXT, rev INTEGER, sha TEXT, source TEXT NOT NULL,
  user TEXT NOT NULL, link TEXT, player TEXT, build TEXT, client TEXT, started_at REAL NOT NULL, ended_at REAL,
  result TEXT, duration_ms INTEGER, cheat INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0, summary TEXT);
CREATE INDEX IF NOT EXISTS plays_level ON plays(pack, level, started_at);
CREATE INDEX IF NOT EXISTS plays_sha ON plays(sha);
CREATE TABLE IF NOT EXISTS play_events(
  play_id INTEGER NOT NULL REFERENCES plays(id), seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(play_id, seq));
CREATE TABLE IF NOT EXISTS share_links(
  token TEXT PRIMARY KEY, pack TEXT NOT NULL, level TEXT NOT NULL, rev INTEGER, sha TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL,
  revoked_at REAL, opens INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS thumbs(
  sha TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, source TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pack_versions(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL, no INTEGER NOT NULL, pack TEXT NOT NULL, kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, reviewer TEXT, created_at REAL NOT NULL,
  from_lv INTEGER, to_lv INTEGER, levels INTEGER NOT NULL, detail TEXT, UNIQUE(code, no));
CREATE TABLE IF NOT EXISTS pack_version_levels(
  version_id INTEGER NOT NULL REFERENCES pack_versions(id), level INTEGER NOT NULL, name TEXT NOT NULL,
  rev INTEGER NOT NULL, sha TEXT NOT NULL, PRIMARY KEY(version_id, level));
CREATE INDEX IF NOT EXISTS pack_version_levels_sha ON pack_version_levels(sha);
CREATE TABLE IF NOT EXISTS live_runs(
  id INTEGER PRIMARY KEY, at REAL NOT NULL, by TEXT NOT NULL, platform TEXT NOT NULL, pack TEXT, code TEXT,
  start_date TEXT, end_date TEXT, status TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, message TEXT);
CREATE TABLE IF NOT EXISTS live_stats(
  platform TEXT NOT NULL, slot INTEGER NOT NULL, code TEXT, pack TEXT, name TEXT, rev INTEGER, sha TEXT,
  content_key TEXT, data TEXT NOT NULL, run_id INTEGER, PRIMARY KEY(platform, slot));
CREATE INDEX IF NOT EXISTS live_stats_key ON live_stats(content_key);
`;

// Cột thêm sau khi DB đã chạy (DB do bản trước hoặc server Python tạo vẫn mở được): ALTER TABLE ADD COLUMN khi thiếu.
const COLUMNS = [['packs', 'archived_at', 'REAL'], ['packs', 'archive_reason', 'TEXT'],
  ['packs', 'code', 'TEXT'], ['packs', 'purpose', "TEXT NOT NULL DEFAULT ''"], ['packs', 'owner', 'TEXT'], ['packs', 'notes', 'TEXT'],
  ['packs', 'deploy', 'TEXT'], ['packs', 'base', 'TEXT'], ['packs', 'review_by', 'TEXT'], ['packs', 'review_at', 'REAL'],
  ['packs', 'review_note', 'TEXT'], ['packs', 'approved_by', 'TEXT'], ['packs', 'approved_at', 'REAL'],
  ['levels', 'content_key', 'TEXT']];
const INDEXES = ['CREATE UNIQUE INDEX IF NOT EXISTS packs_code ON packs(code)',
  'CREATE INDEX IF NOT EXISTS levels_content ON levels(content_key)'];

export class DB {
  constructor(file) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=30000');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(SCHEMA);
    for (const [table, col, decl] of COLUMNS) {
      const have = this.db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
      if (!have) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    }
    for (const sql of INDEXES) this.db.exec(sql);
    this.file = path.resolve(file);
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
