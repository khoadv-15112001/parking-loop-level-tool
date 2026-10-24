# Nghiệp vụ (port từ FishLevel server/app/store.py): pack, level, revision (append-only, blob dedupe sha256 + zlib), khoá,
# đổi số, promote, import/export, audit. Mọi hàm ghi chạy trong db.write() (1 transaction). Event SSE chỉ bắn SAU commit.
# Bỏ phần riêng của Fish: bộ gốc (orig), luật template, lịch mở obstacle, proof solver, thùng rác.
import hashlib
import io
import json
import logging
import re
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import PurePosixPath

from . import clock
from .db import DB
from .errors import ApiError
from .events import Broker
from .plugin import GamePlugin
from .validate import validate_levels

log = logging.getLogger("levelcore.store")

PACK_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
NAME_RE = re.compile(r"^[1-9][0-9]{0,8}$")
GROUP_MAX = 64
PLATFORMS = ("android", "ios", "both")

# Import zip: level lớn nhất ~1 MB. Trần chặn zip bomb.
MAX_IMPORT_ENTRY = 16 * 1024 * 1024
MAX_IMPORT_TOTAL = 512 * 1024 * 1024
MAX_IMPORT_FILES = 20000


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(v: str | None) -> float | None:
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        pass
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(400, f"since không hợp lệ: {v}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def canon(obj) -> bytes:
    """Dạng chuẩn để lưu + tính sha: JSON gọn, giữ thứ tự key (≈ JSON.stringify bên JS)."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def pretty(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode()


def parse_if_match(v: str | None) -> int | None:
    if v is None:
        return None
    m = re.fullmatch(r'\s*(?:W/)?"?r(\d+)"?\s*', v)
    if not m:
        raise ApiError(400, f'If-Match phải dạng "r<rev>", nhận: {v}')
    return int(m.group(1))


def _changes_detail(res) -> dict:
    return {"changes": res["changes"]} if res.get("changes") else {}


def _check_group(group) -> str:
    if not isinstance(group, str):
        raise ApiError(400, "group phải là chuỗi")
    g = " ".join(group.split())
    if len(g) > GROUP_MAX or any(ord(ch) < 32 for ch in g):
        raise ApiError(400, f"Tên nhóm bộ tối đa {GROUP_MAX} ký tự, không có ký tự điều khiển")
    return g


class Store:
    def __init__(self, db: DB, broker: Broker, settings, game: GamePlugin):
        self.db = db
        self.broker = broker
        self.s = settings
        self.game = game

    # ---------- tiện ích nội bộ ----------
    def _put_blob(self, c, data: bytes) -> str:
        sha = hashlib.sha256(data).hexdigest()
        c.execute("INSERT OR IGNORE INTO blobs(sha,size,codec,data) VALUES(?,?,?,?)",
                  (sha, len(data), "zlib", zlib.compress(data, 6)))
        return sha

    def _blob(self, c, sha: str) -> bytes:
        r = c.execute("SELECT codec,data FROM blobs WHERE sha=?", (sha,)).fetchone()
        return zlib.decompress(r["data"]) if r["codec"] == "zlib" else bytes(r["data"])

    def _pack(self, c, pack: str):
        r = c.execute("SELECT * FROM packs WHERE name=?", (pack,)).fetchone()
        if r is None:
            raise ApiError(404, f"Không có bộ '{pack}'")
        return r

    def _writable(self, c, pack: str, op: str = "edit"):
        """Bộ ghi được cho `op`: 'edit' (lưu / tạo / xoá / khôi phục / nhập / đổi số chèn) · 'swap' (đổi chỗ số) ·
        'copy' (nhận level từ bộ khác qua kiểm định = promote). Bộ lưu trữ: chỉ đọc. Bộ production: chỉ 'copy' và 'swap'."""
        p = self._pack(c, pack)
        if p["archived"]:
            raise ApiError(403, f"Bộ '{pack}' đã lưu trữ — bỏ lưu trữ để sửa")
        if p["production"] and op not in ("copy", "swap"):
            raise ApiError(403, f"Bộ '{pack}' là production: chỉ nhận level promote từ bộ khác (qua kiểm định) "
                                "và đổi chỗ số level — không sửa trực tiếp")
        return p

    def _can_write(self, c, pack, op="edit") -> bool:
        try:
            self._writable(c, pack, op)
            return True
        except ApiError:
            return False

    @staticmethod
    def _check_name(name: str):
        if not isinstance(name, str) or not NAME_RE.match(name):
            raise ApiError(400, f"Tên level phải là số nguyên dương: '{name}'")

    def _level(self, c, pack: str, name: str):
        return c.execute("SELECT * FROM levels WHERE pack=? AND name=?", (pack, name)).fetchone()

    def _head(self, c, lv):
        return c.execute("SELECT * FROM revisions WHERE level_id=? AND rev=?", (lv["id"], lv["head_rev"])).fetchone()

    def _lock(self, c, pack: str, name: str):
        """Khoá còn hiệu lực (hết hạn coi như không có)."""
        return c.execute("SELECT * FROM locks WHERE pack=? AND name=? AND expires_at>?",
                         (pack, name, clock.now())).fetchone()

    @staticmethod
    def _lock_json(l):
        if l is None:
            return None
        return {"holder": l["holder"], "since": iso(l["since"]), "expires_at": iso(l["expires_at"])}

    def _deny_if_locked(self, c, pack, name, user):
        """Người khác giữ khoá => 423. Trả True nếu chính user đang giữ khoá."""
        l = self._lock(c, pack, name)
        if l and l["holder"] != user:
            raise ApiError(423, f"Level {pack}/{name} đang bị {l['holder']} khoá", pack=pack, level=name,
                           holder=l["holder"], since=iso(l["since"]), expires_at=iso(l["expires_at"]))
        return l is not None

    def _audit(self, c, user, action, pack=None, level=None, rev=None, **detail):
        c.execute("INSERT INTO audit(ts,user,action,pack,level,rev,detail) VALUES(?,?,?,?,?,?,?)",
                  (clock.now(), user, action, pack, level, rev,
                   json.dumps(detail, ensure_ascii=False) if detail else None))

    def _write_rev(self, c, pack, name, data: bytes | None, user, kind, message="", unlocked=False, meta=None, rev=None,
                   diff=False):
        """Thêm revision mới (data=None nghĩa là xoá). Trả {rev, sha, created, summary, changes}."""
        now = clock.now()
        lv = self._level(c, pack, name)
        created = lv is None or lv["deleted"] == 1
        changes = None
        if diff and not created and data is not None:
            prev = self._head(c, lv)["blob_sha"]
            if prev:
                changes = self.game.level_changes(self._body_or_none(c, prev), self._decode(data))
        if lv is None:
            c.execute("INSERT INTO levels(pack,name,sort_key,head_rev,deleted,created_at,updated_at,updated_by)"
                      " VALUES(?,?,?,0,0,?,?,?)", (pack, name, int(name), now, now, user))
            lv = self._level(c, pack, name)
        rev = rev if rev is not None else lv["head_rev"] + 1
        sha = self._put_blob(c, data) if data is not None else None
        c.execute("INSERT INTO revisions(level_id,rev,blob_sha,author,created_at,kind,message,unlocked_edit,meta)"
                  " VALUES(?,?,?,?,?,?,?,?,?)",
                  (lv["id"], rev, sha, user, now, kind, message or "", int(unlocked),
                   json.dumps(meta, ensure_ascii=False) if meta else None))
        summary = None
        if data is not None:
            summary = json.dumps(self.game.level_summary(self._decode(data)), ensure_ascii=False, separators=(",", ":"))
        c.execute("UPDATE levels SET head_rev=?, deleted=?, updated_at=?, updated_by=?, summary=? WHERE id=?",
                  (rev, int(data is None), now, user, summary, lv["id"]))
        return {"rev": rev, "sha": sha, "created": created and data is not None,
                "summary": json.loads(summary) if summary else None, "changes": changes}

    def _conflict(self, c, lv, pack, name, expected):
        """412: trả kèm head để client hiện hộp so sánh."""
        h = self._head(c, lv)
        raise ApiError(412, f"Level {pack}/{name} đã đổi: bạn sửa từ r{expected}, head là r{lv['head_rev']}",
                       pack=pack, level=name, head_rev=lv["head_rev"], author=h["author"],
                       updated_at=iso(h["created_at"]), sha=h["blob_sha"], deleted=bool(lv["deleted"]),
                       body=None if h["blob_sha"] is None else self._decode(self._blob(c, h["blob_sha"])))

    @staticmethod
    def _decode(data: bytes):
        return json.loads(data.decode("utf-8-sig"))

    def _body_or_none(self, c, sha):
        if sha is None:
            return None
        try:
            return self._decode(self._blob(c, sha))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    @staticmethod
    def _parse_body(body: bytes):
        try:
            obj = json.loads(body.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ApiError(400, f"Body không phải JSON: {e}")
        if not isinstance(obj, dict):
            raise ApiError(400, "Level phải là JSON object")
        return obj

    def _rev_json(self, r, with_body=False, c=None):
        out = {"rev": r["rev"], "author": r["author"], "created_at": iso(r["created_at"]), "kind": r["kind"],
               "message": r["message"], "unlocked_edit": bool(r["unlocked_edit"]), "sha": r["blob_sha"],
               "meta": json.loads(r["meta"]) if r["meta"] else None}
        if with_body:
            out["level"] = None if r["blob_sha"] is None else self._decode(self._blob(c, r["blob_sha"]))
        return out

    def _validate(self, pairs) -> list[dict]:
        """pairs [(số level, obj)] -> kết quả validator JS của game (GamePlugin.validator_module)."""
        return validate_levels(self.s, [{"level": o, "levelNo": int(n)} for n, o in pairs])

    # ---------- pack ----------
    def ensure_default_packs(self):
        """Tạo bộ mặc định khi DB chưa có bộ nào. 'product' = production (chỉ nhận level promote)."""
        with self.db.write() as c:
            if c.execute("SELECT 1 FROM packs LIMIT 1").fetchone():
                return
            for name in self.s.default_packs:
                c.execute("INSERT OR IGNORE INTO packs(name,created_at,created_by,production) VALUES(?,?,?,?)",
                          (name, clock.now(), "system", int(name == "product")))

    @staticmethod
    def _pack_json(r, n=None) -> dict:
        out = {"name": r["name"], "description": r["description"], "created_at": iso(r["created_at"]),
               "created_by": r["created_by"], "archived": bool(r["archived"]), "production": bool(r["production"]),
               "platform": r["platform"] or "android", "group": r["grp"] or ""}
        if n is not None:
            out["level_count"] = n
        return out

    def list_packs(self):
        c = self.db.conn()
        rows = c.execute("SELECT p.*, (SELECT COUNT(*) FROM levels l WHERE l.pack=p.name AND l.deleted=0) n"
                         " FROM packs p ORDER BY p.created_at, p.name").fetchall()
        return [self._pack_json(r, r["n"]) for r in rows]

    def create_pack(self, user, name, description="", platform="android", group=""):
        if not isinstance(name, str) or not PACK_RE.match(name):
            raise ApiError(400, "Tên bộ chỉ gồm chữ/số/_ . - (tối đa 64)")
        if platform not in PLATFORMS:
            raise ApiError(400, "platform phải là android | ios | both")
        group = _check_group(group or "")
        with self.db.write() as c:
            if c.execute("SELECT 1 FROM packs WHERE name=?", (name,)).fetchone():
                raise ApiError(409, f"Bộ '{name}' đã có")
            c.execute("INSERT INTO packs(name,description,created_at,created_by,platform,grp) VALUES(?,?,?,?,?,?)",
                      (name, description or "", clock.now(), user, platform, group))
            self._audit(c, user, "pack.create", pack=name, platform=platform, **({"group": group} if group else {}))
            p = self._pack(c, name)
        out = self._pack_json(p, 0)
        self.broker.publish("pack.created", {"pack": name, "author": user})
        return out

    def update_pack(self, user, pack, archived=None, production=None, platform=None, group=None, description=None):
        for k, v in (("archived", archived), ("production", production)):
            if v is not None and not isinstance(v, bool):
                raise ApiError(400, f"{k} phải là true/false")
        if platform is not None and platform not in PLATFORMS:
            raise ApiError(400, "platform phải là android | ios | both")
        if group is not None:
            group = _check_group(group)
        if description is not None and not isinstance(description, str):
            raise ApiError(400, "description phải là chuỗi")
        changed = []
        with self.db.write() as c:
            p = self._pack(c, pack)
            for col, key, v, cur in (("archived", "archived", archived, bool(p["archived"])),
                                     ("production", "production", production, bool(p["production"])),
                                     ("platform", "platform", platform, p["platform"]),
                                     ("grp", "group", group, p["grp"]),
                                     ("description", "description", description, p["description"])):
                if v is None or v == cur:
                    continue
                c.execute(f"UPDATE packs SET {col}=? WHERE name=?", (int(v) if isinstance(v, bool) else v, pack))
                self._audit(c, user, f"pack.{key}", pack=pack, on=v)
                changed.append(key)
            if archived:
                c.execute("DELETE FROM locks WHERE pack=?", (pack,))
            p = self._pack(c, pack)
        out = {**self._pack_json(p), "changed": changed, "author": user}
        if changed:
            self.broker.publish("pack.updated", out)
        return out

    def rename_pack(self, user, pack, to):
        """Đổi tên bộ: level, lịch sử và audit đi theo. Chặn khi có người đang giữ khoá level trong bộ."""
        if not isinstance(to, str) or not PACK_RE.match(to):
            raise ApiError(400, "Tên bộ chỉ gồm chữ/số/_ . - (tối đa 64)")
        with self.db.write() as c:
            self._pack(c, pack)
            if to == pack:
                raise ApiError(400, "Tên mới trùng tên cũ")
            if c.execute("SELECT 1 FROM packs WHERE name=?", (to,)).fetchone():
                raise ApiError(409, f"Bộ '{to}' đã có")
            lk = c.execute("SELECT * FROM locks WHERE pack=? AND expires_at>? ORDER BY name LIMIT 1",
                           (pack, clock.now())).fetchone()
            if lk:
                raise ApiError(423, f"Level {pack}/{lk['name']} đang bị {lk['holder']} khoá — đổi tên bộ khi không ai đang sửa",
                               pack=pack, level=lk["name"], holder=lk["holder"])
            c.execute("INSERT INTO packs(name,description,created_at,created_by,archived,production,platform,grp)"
                      " SELECT ?,description,created_at,created_by,archived,production,platform,grp FROM packs WHERE name=?",
                      (to, pack))
            c.execute("UPDATE levels SET pack=? WHERE pack=?", (to, pack))
            c.execute("DELETE FROM locks WHERE pack=?", (pack,))
            c.execute("UPDATE audit SET pack=? WHERE pack=?", (to, pack))
            c.execute("DELETE FROM packs WHERE name=?", (pack,))
            self._audit(c, user, "pack.rename", pack=to, renamed_from=pack)
        out = {"from": pack, "to": to, "author": user}
        self.broker.publish("pack.renamed", out)
        return out

    # ---------- level: đọc ----------
    def list_levels(self, pack, include_deleted=False):
        c = self.db.conn()
        self._pack(c, pack)
        rows = c.execute(
            "SELECT l.*, r.blob_sha, r.author, r.unlocked_edit, k.holder, k.since, k.expires_at"
            " FROM levels l JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev"
            " LEFT JOIN locks k ON k.pack=l.pack AND k.name=l.name AND k.expires_at>?"
            " WHERE l.pack=? AND (?=1 OR l.deleted=0) ORDER BY l.sort_key, l.name",
            (clock.now(), pack, int(include_deleted))).fetchall()
        return [{"name": r["name"], "level": r["sort_key"], "head_rev": r["head_rev"], "sha": r["blob_sha"],
                 "author": r["author"], "updated_at": iso(r["updated_at"]), "deleted": bool(r["deleted"]),
                 "unlocked_edit": bool(r["unlocked_edit"]),
                 "lock": self._lock_json(r) if r["holder"] else None,
                 "summary": json.loads(r["summary"]) if r["summary"] else None} for r in rows]

    def get_level(self, pack, name):
        c = self.db.conn()
        self._pack(c, pack)
        lv = self._level(c, pack, name)
        if lv is None or lv["deleted"]:
            raise ApiError(404, f"Không có level {pack}/{name}")
        h = self._head(c, lv)
        return {"pack": pack, "name": name, "level_no": lv["sort_key"], **self._rev_json(h, with_body=True, c=c),
                "head_rev": lv["head_rev"], "lock": self._lock_json(self._lock(c, pack, name))}

    def bundle(self, pack):
        """Mọi level còn sống của bộ kèm body head — cho kiểm định cả bộ / tải cả bộ / LoadPack của playtest web."""
        c = self.db.conn()
        self._pack(c, pack)
        rows = c.execute(
            "SELECT l.name, l.sort_key, l.head_rev, l.updated_at, r.blob_sha, r.author"
            " FROM levels l JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev"
            " WHERE l.pack=? AND l.deleted=0 ORDER BY l.sort_key, l.name", (pack,)).fetchall()
        return {"pack": pack,
                "levels": [{"name": r["name"], "level_no": r["sort_key"], "rev": r["head_rev"], "sha": r["blob_sha"],
                            "author": r["author"], "updated_at": iso(r["updated_at"]),
                            "level": self._decode(self._blob(c, r["blob_sha"]))} for r in rows]}

    def list_revisions(self, pack, name):
        c = self.db.conn()
        self._pack(c, pack)
        lv = self._level(c, pack, name)
        if lv is None:
            raise ApiError(404, f"Không có level {pack}/{name}")
        rows = c.execute("SELECT * FROM revisions WHERE level_id=? ORDER BY rev DESC", (lv["id"],)).fetchall()
        out = [self._rev_json(r) for r in rows]
        bodies = [self._body_or_none(c, r["blob_sha"]) for r in rows]
        for i, item in enumerate(out):
            item["changes"] = self.game.level_changes(bodies[i + 1], bodies[i]) if i + 1 < len(rows) else None
        return out

    def get_revision(self, pack, name, rev):
        c = self.db.conn()
        self._pack(c, pack)
        lv = self._level(c, pack, name)
        r = lv and c.execute("SELECT * FROM revisions WHERE level_id=? AND rev=?", (lv["id"], rev)).fetchone()
        if not r:
            raise ApiError(404, f"Không có revision r{rev} của {pack}/{name}")
        return {"pack": pack, "name": name, **self._rev_json(r, with_body=True, c=c)}

    def revision_diff(self, pack, name, rev):
        """Revision `rev` + revision liền trước (body cả hai) + "đã sửa gì"."""
        c = self.db.conn()
        self._pack(c, pack)
        lv = self._level(c, pack, name)
        r = lv and c.execute("SELECT * FROM revisions WHERE level_id=? AND rev=?", (lv["id"], rev)).fetchone()
        if not r:
            raise ApiError(404, f"Không có revision r{rev} của {pack}/{name}")
        p = c.execute("SELECT * FROM revisions WHERE level_id=? AND rev<? ORDER BY rev DESC LIMIT 1",
                      (lv["id"], rev)).fetchone()
        cur, prev = self._body_or_none(c, r["blob_sha"]), p and self._body_or_none(c, p["blob_sha"])
        return {"pack": pack, "name": name, **self._rev_json(r), "level": cur,
                "prev": None if p is None else {**self._rev_json(p), "level": prev},
                "changes": self.game.level_changes(prev, cur)}

    # ---------- level: ghi ----------
    def save_level(self, user, pack, name, body: bytes, if_match: str | None, create: bool, message=""):
        """POST (create=True) tạo mới; PUT cập nhật, bắt buộc If-Match. Không chặn theo validator (bản nháp được lưu);
        bộ production không sửa trực tiếp được."""
        expected = parse_if_match(if_match)
        self._check_name(name)
        obj = self._parse_body(body)
        data = canon(obj)
        with self.db.write() as c:
            self._writable(c, pack)
            mine = self._deny_if_locked(c, pack, name, user)
            lv = self._level(c, pack, name)
            if create:
                if lv is not None and not lv["deleted"]:
                    raise ApiError(409, f"Level {pack}/{name} đã có (head r{lv['head_rev']}), dùng PUT",
                                   head_rev=lv["head_rev"])
            else:
                if lv is None or lv["deleted"]:
                    raise ApiError(404, f"Không có level {pack}/{name} (tạo mới dùng POST)")
                if expected is None:
                    raise ApiError(428, 'PUT cần header If-Match: "r<rev>"')
                if expected != lv["head_rev"]:
                    self._conflict(c, lv, pack, name, expected)
                if self._head(c, lv)["blob_sha"] == hashlib.sha256(data).hexdigest():
                    return {"pack": pack, "name": name, "rev": lv["head_rev"], "unchanged": True,
                            "sha": self._head(c, lv)["blob_sha"], "unlocked_edit": False}
            res = self._write_rev(c, pack, name, data, user, "create" if create else "update",
                                  message, unlocked=not mine, diff=True)
            self._audit(c, user, "level.create" if create else "level.update", pack, name, res["rev"],
                        unlocked_edit=not mine, if_match=expected, **_changes_detail(res))
        out = {"pack": pack, "name": name, "rev": res["rev"], "sha": res["sha"], "unlocked_edit": not mine,
               "author": user, "summary": res["summary"], "changes": res["changes"]}
        self.broker.publish("level.created" if create else "level.updated", out)
        return out

    def delete_level(self, user, pack, name, if_match):
        expected = parse_if_match(if_match)
        with self.db.write() as c:
            self._writable(c, pack)
            mine = self._deny_if_locked(c, pack, name, user)
            lv = self._level(c, pack, name)
            if lv is None or lv["deleted"]:
                raise ApiError(404, f"Không có level {pack}/{name}")
            if expected is None:
                raise ApiError(428, 'DELETE cần header If-Match: "r<rev>"')
            if expected != lv["head_rev"]:
                self._conflict(c, lv, pack, name, expected)
            res = self._write_rev(c, pack, name, None, user, "delete", unlocked=not mine)
            self._audit(c, user, "level.delete", pack, name, res["rev"], unlocked_edit=not mine)
        out = {"pack": pack, "name": name, "rev": res["rev"], "author": user}
        self.broker.publish("level.deleted", out)
        return out

    def revert(self, user, pack, name, to_rev: int, if_match, message=""):
        """Quay về nội dung của to_rev bằng 1 revision MỚI (lịch sử không bị xoá) — cũng là khôi phục level đã xoá."""
        expected = parse_if_match(if_match)
        with self.db.write() as c:
            self._writable(c, pack)
            mine = self._deny_if_locked(c, pack, name, user)
            lv = self._level(c, pack, name)
            if lv is None:
                raise ApiError(404, f"Không có level {pack}/{name}")
            if expected is None:
                raise ApiError(428, 'revert cần header If-Match: "r<rev>"')
            if expected != lv["head_rev"]:
                self._conflict(c, lv, pack, name, expected)
            t = c.execute("SELECT * FROM revisions WHERE level_id=? AND rev=?", (lv["id"], to_rev)).fetchone()
            if t is None:
                raise ApiError(404, f"Không có revision r{to_rev}")
            if t["blob_sha"] is None:
                raise ApiError(400, f"r{to_rev} là revision xoá, không revert về được")
            was_deleted = bool(lv["deleted"])
            res = self._write_rev(c, pack, name, self._blob(c, t["blob_sha"]), user, "revert",
                                  message or f"revert về r{to_rev}", unlocked=not mine, meta={"reverted_to": to_rev},
                                  diff=True)
            self._audit(c, user, "level.revert", pack, name, res["rev"], reverted_to=to_rev, unlocked_edit=not mine,
                        **_changes_detail(res))
        out = {"pack": pack, "name": name, "rev": res["rev"], "sha": res["sha"], "reverted_to": to_rev,
               "unlocked_edit": not mine, "author": user, "summary": res["summary"]}
        self.broker.publish("level.created" if was_deleted else "level.updated", out)
        return out

    # ---------- đổi số level ----------
    def _relevel_plan(self, c, pack, src, dst, mode, lv):
        """[(row, số mới)]: swap đổi chỗ, shift chèn src vào dst + dồn các level ở giữa 1 bước về phía src."""
        if mode == "swap":
            other = self._level(c, pack, dst)
            return [(lv, dst)] + ([(other, src)] if other else [])
        a, b = int(src), int(dst)
        lo, hi, step = (a + 1, b, -1) if a < b else (b, a - 1, 1)
        rows = c.execute("SELECT * FROM levels WHERE pack=? AND sort_key BETWEEN ? AND ? ORDER BY sort_key",
                         (pack, lo, hi)).fetchall()
        return [(lv, dst)] + [(r, str(r["sort_key"] + step)) for r in rows]

    def relevel(self, user, pack, src, dst, mode, if_match, dry_run=False):
        """Đổi số level trong 1 bộ. 'swap': src ↔ dst; 'shift': src chèn vào dst, các level ở giữa dồn 1 bước. Lịch sử đi
        theo level. Mỗi level còn sống bị đổi số nhận 1 revision 'relevel' (GamePlugin.set_level_number = số mới) với rev lớn hơn
        mọi rev của level đang giữ số đó trước (If-Match cũ theo số chắc chắn 412). dry_run: chỉ trả kế hoạch."""
        if mode not in ("swap", "shift"):
            raise ApiError(400, "mode phải là 'swap' hoặc 'shift'")
        for n in (src, dst):
            self._check_name(n)
        if src == dst:
            raise ApiError(400, "Số mới trùng số cũ")
        expected = parse_if_match(if_match)
        with self.db.write() as c:
            p = self._writable(c, pack, "swap" if mode == "swap" else "edit")
            lv = self._level(c, pack, src)
            if lv is None or lv["deleted"]:
                raise ApiError(404, f"Không có level {pack}/{src}")
            plan = self._relevel_plan(c, pack, src, dst, mode, lv)
            locked = []
            for n in sorted({r["name"] for r, _ in plan} | {n for _, n in plan}, key=int):
                lk = self._lock(c, pack, n)
                if lk:
                    locked.append({"level": n, "holder": lk["holder"], "since": iso(lk["since"])})
            if dry_run:
                return {"pack": pack, "mode": mode, "dry_run": True, "locked": locked,
                        "moves": [{"from": r["name"], "to": n, "deleted": bool(r["deleted"])} for r, n in plan]}
            if expected is None:
                raise ApiError(428, 'relevel cần header If-Match: "r<rev>"')
            if expected != lv["head_rev"]:
                self._conflict(c, lv, pack, src, expected)
            if locked:
                l0 = locked[0]
                raise ApiError(423, f"Level {pack}/{l0['level']} đang bị {l0['holder']} khoá", locked=locked)
            occupant = {r["name"]: r for r, _ in plan}
            objs = {r["id"]: self._decode(self._blob(c, self._head(c, r)["blob_sha"])) for r, _ in plan if not r["deleted"]}
            if p["production"]:   # bộ production: level ở số mới phải qua validator mới cho đổi chỗ
                finals = [(r, n) for r, n in plan if not r["deleted"]]
                vres = self._validate([(n, objs[r["id"]]) for r, n in finals])
                bad = [(r, n, v) for (r, n), v in zip(finals, vres) if not v["isValid"]]
                if bad:
                    r0, n0, v0 = bad[0]
                    raise ApiError(422, f"Bộ production: level {pack}/{r0['name']} ở số mới {n0} lỗi: {v0['errors'][0]}",
                                   validation=[{"level": r["name"], "to": n, "errors": v["errors"][:20]} for r, n, v in bad])
            for r, _ in plan:   # tên tạm trước: UNIQUE(pack, name) không vướng khi các số đổi vòng cho nhau
                c.execute("UPDATE levels SET name=? WHERE id=?", (f"~relevel~{r['id']}", r["id"]))
            moves = []
            for r, n in plan:
                c.execute("UPDATE levels SET name=?, sort_key=? WHERE id=?", (n, int(n), r["id"]))
                res = None
                if not r["deleted"]:
                    obj = objs[r["id"]]
                    self.game.set_level_number(obj, int(n))
                    prev = occupant.get(n)
                    res = self._write_rev(c, pack, n, canon(obj), user, "relevel", f"đổi số level {r['name']} → {n}",
                                          meta={"relevel_from": r["name"], "mode": mode},
                                          rev=max(r["head_rev"], prev["head_rev"] if prev else 0) + 1)
                self._audit(c, user, "level.relevel", pack, n, res and res["rev"], relevel_from=r["name"], mode=mode)
                moves.append({"from": r["name"], "to": n, "rev": res and res["rev"], "deleted": bool(r["deleted"])})
        out = {"pack": pack, "mode": mode, "moves": moves, "author": user}
        self.broker.publish("levels.renumbered", out)
        return out

    # ---------- khoá ----------
    def acquire_lock(self, user, pack, name):
        now = clock.now()
        self._check_name(name)
        with self.db.write() as c:
            self._writable(c, pack)
            mine = self._deny_if_locked(c, pack, name, user)
            if mine:  # đã giữ => coi như heartbeat, giữ nguyên since
                c.execute("UPDATE locks SET expires_at=? WHERE pack=? AND name=?", (now + self.s.lock_ttl, pack, name))
            else:
                c.execute("INSERT OR REPLACE INTO locks(pack,name,holder,since,expires_at) VALUES(?,?,?,?,?)",
                          (pack, name, user, now, now + self.s.lock_ttl))
                self._audit(c, user, "lock.acquire", pack, name)
            l = self._lock(c, pack, name)
        out = {"pack": pack, "level": name, "ttl": self.s.lock_ttl, **self._lock_json(l)}
        if not mine:
            self.broker.publish("lock.acquired", out)
        return out

    def heartbeat_lock(self, user, pack, name):
        with self.db.write() as c:
            self._pack(c, pack)
            l = self._lock(c, pack, name)
            if l is None or l["holder"] != user:
                raise ApiError(409, "Mất khoá (hết hạn hoặc người khác giữ) — khoá lại bằng POST",
                               lost=True, lock=self._lock_json(l))
            c.execute("UPDATE locks SET expires_at=? WHERE pack=? AND name=?",
                      (clock.now() + self.s.lock_ttl, pack, name))
            l = self._lock(c, pack, name)
        return {"pack": pack, "level": name, "ttl": self.s.lock_ttl, **self._lock_json(l)}

    def release_lock(self, user, pack, name, force=False):
        with self.db.write() as c:
            self._pack(c, pack)
            l = self._lock(c, pack, name)
            if l is None:
                c.execute("DELETE FROM locks WHERE pack=? AND name=?", (pack, name))  # dọn khoá hết hạn
                return {"released": False, "detail": "không có khoá"}
            forced = l["holder"] != user
            if forced and not force:
                raise ApiError(423, f"Khoá do {l['holder']} giữ — dùng ?force=1 để phá (có ghi audit)",
                               holder=l["holder"], since=iso(l["since"]), expires_at=iso(l["expires_at"]))
            c.execute("DELETE FROM locks WHERE pack=? AND name=?", (pack, name))
            if forced:
                self._audit(c, user, "lock.force_unlock", pack, name, previous_holder=l["holder"], since=iso(l["since"]))
            else:
                self._audit(c, user, "lock.release", pack, name)
        out = {"pack": pack, "level": name, "released": True, "by": user, "holder": l["holder"], "forced": forced}
        self.broker.publish("lock.released", out)
        return out

    # ---------- promote ----------
    def promote(self, user, src, dst, items, message=""):
        """Kiểm định (validator) rồi chép head của các level `items` ([{name, to?}]) từ bộ src sang bộ dst trong 1
        transaction. Đây là đường DUY NHẤT ghi vào bộ production. Level nào lỗi validator → 422, không chép gì."""
        if not isinstance(items, list) or not items:
            raise ApiError(400, 'Cần {"items": [{"name": "<số>", "to": "<số đích, mặc định cùng số>"}]}')
        if src == dst:
            raise ApiError(400, "Bộ nguồn trùng bộ đích")
        c0 = self.db.conn()
        self._pack(c0, src)
        pairs = []
        for it in items:
            name = str(it.get("name") if isinstance(it, dict) else it)
            to = str(it.get("to") or name) if isinstance(it, dict) else name
            self._check_name(name)
            self._check_name(to)
            lv = self._level(c0, src, name)
            if lv is None or lv["deleted"]:
                raise ApiError(404, f"Không có level {src}/{name}")
            h = self._head(c0, lv)
            obj = self._decode(self._blob(c0, h["blob_sha"]))
            self.game.set_level_number(obj, int(to))
            pairs.append((name, to, h["rev"], obj))
        if len({to for _, to, _, _ in pairs}) != len(pairs):
            raise ApiError(400, "Hai level cùng chép vào một số đích")
        vres = self._validate([(to, obj) for _, to, _, obj in pairs])
        bad = [(n, to, v) for (n, to, _, _), v in zip(pairs, vres) if not v["isValid"]]
        if bad:
            n0, to0, v0 = bad[0]
            raise ApiError(422, f"Level {src}/{n0} chưa qua kiểm định: {v0['errors'][0]}",
                           validation=[{"level": n, "to": to, "errors": v["errors"][:20]} for n, to, v in bad])
        results = []
        with self.db.write() as c:
            self._writable(c, dst, "copy")
            locked = []
            for _, to, _, _ in pairs:
                l = self._lock(c, dst, to)
                if l and l["holder"] != user:
                    locked.append({"level": to, "holder": l["holder"]})
            if locked:
                raise ApiError(423, f"{len(locked)} level ở bộ đích đang bị khoá — không chép gì", locked=locked)
            for name, to, src_rev, obj in pairs:
                data = canon(obj)
                lv = self._level(c, dst, to)
                if lv is not None and not lv["deleted"] and self._head(c, lv)["blob_sha"] == hashlib.sha256(data).hexdigest():
                    results.append({"name": name, "to": to, "rev": lv["head_rev"], "unchanged": True})
                    continue
                res = self._write_rev(c, dst, to, data, user, "promote", message or f"promote từ {src}/{name} r{src_rev}",
                                      meta={"from_pack": src, "from_level": name, "from_rev": src_rev}, diff=True)
                self._audit(c, user, "level.promote", dst, to, res["rev"], from_pack=src, from_level=name,
                            from_rev=src_rev, **_changes_detail(res))
                results.append({"name": name, "to": to, "rev": res["rev"], "created": res["created"]})
        out = {"from": src, "to": dst, "items": results, "author": user}
        self.broker.publish("pack.imported", {"pack": dst, "author": user,
                                              "changed": [r["to"] for r in results if not r.get("unchanged")]})
        return out

    def validate_pack(self, pack):
        """Chạy validator cho cả bộ — [{name, isValid, errors, warnings}]."""
        b = self.bundle(pack)
        res = self._validate([(lv["name"], lv["level"]) for lv in b["levels"]])
        return [{"name": lv["name"], **r} for lv, r in zip(b["levels"], res)]

    # ---------- import / export ----------
    @staticmethod
    def _read_import(body: bytes, content_type: str, folder: str | None):
        """Trả (entries: list[(name, bytes)], skipped: list[str]). Zip: mọi <n>.json (bỏ .meta / file khác)."""
        entries, skipped = [], []
        if body[:2] == b"PK" or "zip" in (content_type or ""):
            try:
                zf = zipfile.ZipFile(io.BytesIO(body))
            except zipfile.BadZipFile:
                raise ApiError(400, "File zip hỏng")
            seen, total = {}, 0
            for info in zf.infolist():
                path = PurePosixPath(info.filename.replace("\\", "/"))
                if info.is_dir() or path.suffix.lower() != ".json" or "__MACOSX" in path.parts \
                        or path.name.startswith("._"):
                    continue
                if folder and folder not in path.parts[:-1]:
                    continue
                name = path.stem
                if not NAME_RE.match(name):
                    skipped.append(str(path))
                    continue
                if name in seen:
                    raise ApiError(400, f"Trùng level '{name}': {seen[name]} và {path} — chọn ?folder=")
                seen[name] = str(path)
                total += info.file_size
                if info.file_size > MAX_IMPORT_ENTRY or total > MAX_IMPORT_TOTAL or len(entries) >= MAX_IMPORT_FILES:
                    raise ApiError(413, f"Zip quá lớn: tối đa {MAX_IMPORT_FILES} file, mỗi file "
                                        f"{MAX_IMPORT_ENTRY >> 20} MB, tổng {MAX_IMPORT_TOTAL >> 20} MB sau giải nén")
                try:
                    entries.append((name, zf.read(info)))
                except (zipfile.BadZipFile, zlib.error, EOFError) as e:
                    raise ApiError(400, f"File zip hỏng ở {path}: {e}")
        else:
            try:
                data = json.loads(body.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                raise ApiError(400, f"Body không phải JSON/zip: {e}")
            if isinstance(data, dict) and isinstance(data.get("levels"), dict):
                data = data["levels"]   # dạng LoadPack {"pack", "levels": {n: level}}
            if not isinstance(data, dict):
                raise ApiError(400, 'JSON import phải là object {"<số>": level}')
            entries = [(str(k), canon(v)) for k, v in data.items()]
        return entries, skipped

    def import_levels(self, user, pack, body: bytes, content_type: str, folder=None, message=""):
        c = self.db.conn()
        self._writable(c, pack)
        entries, skipped = self._read_import(body, content_type, folder)
        if not entries:
            raise ApiError(400, "Không có level nào để import", skipped=skipped)
        prepared = []
        for name, raw in entries:
            self._check_name(name)
            try:
                obj = self._decode(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                raise ApiError(400, f"{name}: không phải JSON ({e})")
            if not isinstance(obj, dict):
                raise ApiError(400, f"{name}: level phải là object")
            prepared.append((name, canon(obj)))
        stats = {"created": [], "updated": [], "unchanged": []}
        with self.db.write() as c:
            locked = []
            for name, _ in prepared:
                l = self._lock(c, pack, name)
                if l and l["holder"] != user:
                    locked.append({"level": name, "holder": l["holder"], "since": iso(l["since"])})
            if locked:
                raise ApiError(423, f"{len(locked)} level đang bị người khác khoá — không import gì", locked=locked)
            for name, data in prepared:
                lv = self._level(c, pack, name)
                if lv is not None and not lv["deleted"] and \
                        self._head(c, lv)["blob_sha"] == hashlib.sha256(data).hexdigest():
                    stats["unchanged"].append(name)
                    continue
                res = self._write_rev(c, pack, name, data, user, "import", message, diff=True)
                stats["created" if res["created"] else "updated"].append(name)
            self._audit(c, user, "pack.import", pack, None, None, created=len(stats["created"]),
                        updated=len(stats["updated"]), unchanged=len(stats["unchanged"]), skipped=len(skipped))
        out = {"pack": pack, **{k: len(v) for k, v in stats.items()}, "skipped": skipped}
        self.broker.publish("pack.imported", {"pack": pack, "author": user,
                                              "changed": stats["created"] + stats["updated"]})
        return out

    def export_pack(self, pack) -> bytes:
        """Zip <pack>/<n>.json (pretty 2-space) — chép thẳng vào thư mục level của game cũng được."""
        c = self.db.conn()
        self._pack(c, pack)
        rows = c.execute("SELECT l.name, r.blob_sha FROM levels l JOIN revisions r ON r.level_id=l.id"
                         " AND r.rev=l.head_rev WHERE l.pack=? AND l.deleted=0 ORDER BY l.sort_key", (pack,)).fetchall()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for r in rows:
                zf.writestr(f"{pack}/{r['name']}.json", pretty(self._decode(self._blob(c, r["blob_sha"]))))
        return buf.getvalue()

    # ---------- audit ----------
    def list_audit(self, user=None, since=None, level=None, pack=None, action=None, limit=200):
        q, args = "SELECT * FROM audit WHERE 1=1", []
        for col, v in (("user", user), ("level", level), ("pack", pack), ("action", action)):
            if v:
                q += f" AND {col}=?"
                args.append(v.lower() if col == "user" else v)
        if since is not None:
            q += " AND ts>=?"
            args.append(since)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(max(1, min(int(limit), 5000)))
        rows = self.db.conn().execute(q, args).fetchall()
        return [{"id": r["id"], "ts": iso(r["ts"]), "user": r["user"], "action": r["action"], "pack": r["pack"],
                 "level": r["level"], "rev": r["rev"], "detail": json.loads(r["detail"]) if r["detail"] else None}
                for r in rows]
