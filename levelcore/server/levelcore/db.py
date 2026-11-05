# SQLite WAL. Đọc: kết nối riêng mỗi thread (song song được).
# Ghi: 1 khoá tiến trình + BEGIN IMMEDIATE => không bao giờ gặp "database is locked". (Port từ FishLevel.)
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
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
"""

# Cột thêm sau khi DB đã chạy: ALTER TABLE ADD COLUMN (không chép lại bảng, chạy 1 lần).
COLUMNS: list[tuple[str, str, str]] = []


def migrate(c: sqlite3.Connection) -> None:
    for table, col, decl in COLUMNS:
        have = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
        if col not in have:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


class DB:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._all: list[tuple[threading.Thread, sqlite3.Connection]] = []
        self._all_lock = threading.Lock()
        self.write_lock = threading.Lock()
        self._gen = 0
        c = self.conn()
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        migrate(c)

    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "c", None)
        if c is None or getattr(self._local, "gen", -1) != self._gen:  # sau close() thì mở lại
            with self._all_lock:
                alive = []
                for owner, previous in self._all:
                    if owner.is_alive():
                        alive.append((owner, previous))
                    else:
                        previous.close()
                self._all = alive
                c = sqlite3.connect(self.path, isolation_level=None, timeout=30, check_same_thread=False)
                try:
                    c.row_factory = sqlite3.Row
                    c.execute("PRAGMA busy_timeout=30000")
                    c.execute("PRAGMA synchronous=NORMAL")
                    c.execute("PRAGMA foreign_keys=ON")
                except BaseException:
                    c.close()
                    raise
                self._local.c, self._local.gen = c, self._gen
                self._all.append((threading.current_thread(), c))
        return c

    @contextmanager
    def write(self):
        """Transaction ghi: lỗi bất kỳ => ROLLBACK toàn bộ."""
        with self.write_lock:
            c = self.conn()
            c.execute("BEGIN IMMEDIATE")
            try:
                yield c
            except BaseException:
                c.execute("ROLLBACK")
                raise
            c.execute("COMMIT")

    def close(self):
        with self._all_lock:
            for _, c in self._all:
                try:
                    c.close()
                except Exception:
                    pass
            self._all.clear()
            self._gen += 1
