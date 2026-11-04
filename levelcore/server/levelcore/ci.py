"""Nhận player WebGL và level từ Jenkins (hợp đồng CI v1, sonat-game-cicd resources/python/level_tool_upload.py):

    GET  /api/ci/status                                   kiểm token trước khi build
    POST /api/ci/levels?by=jenkins-<N>                    zip level (mọi <số>.json), gửi trước player
    POST /api/ci/webgl?by&version&commit&branch&buildNumber&buildUrl&environment   zip player

Chỉ nhận `Authorization: Bearer <PREFIX>_CI_TOKEN`; token này không gọi được API người dùng và ngược lại.
Player nhánh <PREFIX>_CI_BRANCH (rỗng = mọi nhánh) thành bản đang dùng, nhánh khác nằm chờ admin chọn (webgame.py).
Level nằm chờ (bảng ci_levels + file <GAME_DIR>.ci/levels/<digest>.zip) tới khi player cùng `by` tới: player lên bản
đang dùng thì nhập ngay, player chờ thì nhập khi admin chọn bản đó; player lỗi / bị xoá / bị dọn hoặc quá 2 giờ chưa tới
thì bỏ. Level cùng digest đã nhập thì bỏ qua. Nhập theo luật chung của store: level GD đã sửa không bị ghi đè.
"""
import hashlib
import hmac
import json
import re
import secrets
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool

from . import clock, webgame
from .errors import ApiError
from .store import iso

LEVELS_WAIT = 2 * 3600
MAX_LEVELS_ZIP = 400 * 1024 * 1024
META_LIMITS = {"version": 40, "commit": 40, "branch": 120, "buildNumber": 20, "buildUrl": 300, "environment": 40}


def actor(by: str | None) -> str:
    who = re.sub(r"[^\w.@-]", "", str(by or ""))[:60] or "jenkins"
    return f"ci:{who}"


def clean_meta(get) -> dict:
    out = {k: str(get(k) or "").strip()[:n] for k, n in META_LIMITS.items()}
    if not re.match(r"https?://", out["buildUrl"]):
        out["buildUrl"] = ""
    return out


class Ci:
    def __init__(self, s, db, store, broker):
        self.s, self.db, self.store, self.broker = s, db, store, broker

    @property
    def pack(self) -> str:
        return self.s.ci_pack or (list(self.s.default_packs) or ["develop"])[0]

    def levels_dir(self) -> Path:
        d = webgame.game_dir(self.s)
        return d.with_name(d.name + ".ci") / "levels"

    def check_token(self, request: Request):
        if not self.s.ci_token:
            raise ApiError(503, f"Server chưa bật nhận dữ liệu từ CI (thiếu {self.s.var('CI_TOKEN')})")
        h = request.headers.get("authorization") or ""
        given = h[7:].strip() if h.lower().startswith("bearer ") else ""
        if not hmac.compare_digest(given.encode(), self.s.ci_token.encode()):
            raise ApiError(401, "Token CI không đúng")

    @staticmethod
    def _row(r) -> dict:
        return {"digest": r["digest"], "by": r["by"], "received_at": iso(r["received_at"]), "status": r["status"],
                "build": r["build"], "pack": r["pack"], "detail": json.loads(r["detail"]) if r["detail"] else None,
                "updated_at": iso(r["updated_at"])}

    def _get(self, digest: str):
        return self.db.conn().execute("SELECT * FROM ci_levels WHERE digest=?", (digest,)).fetchone()

    def _finish(self, c, digest: str, status: str, detail: dict, pack: str | None = None):
        c.execute("UPDATE ci_levels SET status=?, detail=?, pack=COALESCE(?, pack), updated_at=? WHERE digest=?",
                  (status, json.dumps(detail, ensure_ascii=False), pack, clock.now(), digest))
        (self.levels_dir() / f"{digest}.zip").unlink(missing_ok=True)

    def _drop(self, where: str, args: tuple, reason: str) -> list:
        with self.db.write() as c:
            rows = c.execute(f"SELECT digest FROM ci_levels WHERE status='waiting' AND {where}", args).fetchall()
            for r in rows:
                self._finish(c, r["digest"], "dropped", {"reason": reason})
        return [r["digest"] for r in rows]

    def expire(self):
        self._drop("build IS NULL AND received_at<?", (clock.now() - LEVELS_WAIT,), "quá 2 giờ chưa có player cùng lần chạy")

    def receipts(self, limit: int = 20) -> list:
        rows = self.db.conn().execute("SELECT * FROM ci_levels ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()
        return [self._row(r) for r in rows]

    def status(self) -> dict:
        builds = webgame.list_builds(self.s)
        waiting = self.db.conn().execute("SELECT COUNT(*) n FROM ci_levels WHERE status='waiting'").fetchone()["n"]
        return {"ok": True, "tool": self.s.tool_name, "version": self.s.version, "branch": self.s.ci_branch or None,
                "pack": self.pack, "current": next((b for b in builds if b["current"]), None),
                "waitingBuilds": sum(b["status"] == "waiting" for b in builds), "waitingLevels": waiting}

    def receive_levels(self, by: str, body: bytes) -> dict:
        if body[:2] != b"PK":
            raise ApiError(400, "Level từ CI phải là zip các file <số>.json")
        entries, _ = self.store._read_import(body, "application/zip", None)
        if not entries:
            raise ApiError(400, "Zip level từ CI không có file <số>.json nào")
        digest, who = hashlib.sha256(body).hexdigest(), actor(by)
        with webgame.lock:
            self.expire()
            r = self._get(digest)
            if r is not None and r["status"] == "imported":
                return {"status": "duplicate", "levels": self._row(r)}
            if r is not None and r["status"] == "waiting" and r["by"] == who:
                return {"status": "waiting", "levels": self._row(r)}
            self.levels_dir().mkdir(parents=True, exist_ok=True)
            webgame.require_storage(self.s, max(0, len(body) - webgame.disk_bytes(self.levels_dir() / f"{digest}.zip")))
            (self.levels_dir() / f"{digest}.zip").write_bytes(body)
            now = clock.now()
            with self.db.write() as c:
                if r is None:
                    c.execute("INSERT INTO ci_levels(digest,by,received_at,status,updated_at) VALUES(?,?,?,'waiting',?)",
                              (digest, who, now, now))
                else:
                    c.execute("UPDATE ci_levels SET by=?, received_at=?, status='waiting', build=NULL, pack=NULL, "
                              "detail=NULL, updated_at=? WHERE digest=?", (who, now, now, digest))
                self.store._audit(c, who, "ci.levels", digest=digest, files=len(entries))
            return {"status": "waiting", "levels": self._row(self._get(digest))}

    def _import(self, digest: str, build: str) -> dict:
        r = self._get(digest)
        f = self.levels_dir() / f"{digest}.zip"
        try:
            res = self.store.import_levels(r["by"], self.pack, f.read_bytes(), "application/zip",
                                           message=f"CI {r['by'][3:]} · build {build}")
            detail = {k: res[k] for k in ("created", "updated", "unchanged", "conflict", "waiting", "locked", "error")}
            status = "imported"
        except (ApiError, OSError) as e:
            detail, status = {"reason": e.body.get("detail") if isinstance(e, ApiError) else str(e)}, "error"
        with self.db.write() as c:
            c.execute("UPDATE ci_levels SET build=? WHERE digest=?", (build, digest))
            self._finish(c, digest, status, detail, self.pack)
        return self._row(self._get(digest))

    def _after_prune(self, pruned: list):
        for bid in pruned:
            self._drop("build=?", (bid,), "player đi kèm đã bị dọn")

    def _publish(self, who: str, status: str, build: dict, levels):
        self.broker.publish("game.build", {"status": status, "build": build, "author": who,
                                           "levels": levels if isinstance(levels, list) else [levels] if levels else []})

    def receive_player(self, by: str, path: Path, meta: dict, digest: str) -> dict:
        who = actor(by)
        tracked = not self.s.ci_branch or meta.get("branch") == self.s.ci_branch
        with webgame.lock:
            self.expire()
            try:
                out = webgame.install_build(self.s, path, who, "", {**meta, "source": "ci", "by": who},
                                            activate=tracked, digest=digest)
            except ApiError as e:
                self._drop("by=? AND build IS NULL", (who,), f"player lỗi: {e.body.get('detail')}")
                raise
            levels = None
            if out["status"] != "unchanged":
                r = self.db.conn().execute("SELECT digest FROM ci_levels WHERE status='waiting' AND build IS NULL AND by=?"
                                           " ORDER BY received_at LIMIT 1", (who,)).fetchone()
                bid = out["build"]["id"]
                if r is not None and out["status"] == "current":
                    levels = self._import(r["digest"], bid)
                elif r is not None:
                    with self.db.write() as c:
                        c.execute("UPDATE ci_levels SET build=?, updated_at=? WHERE digest=?", (bid, clock.now(), r["digest"]))
                    levels = self._row(self._get(r["digest"]))
                self._after_prune(out["pruned"])
                with self.db.write() as c:
                    self.store._audit(c, who, "ci.webgl", build=bid, status=out["status"], branch=meta.get("branch"),
                                      buildNumber=meta.get("buildNumber"), levels=levels and levels["digest"])
                self._publish(who, out["status"], out["build"], levels)
            return {"status": out["status"], "build": out["build"], "levels": levels}

    def activate(self, user: str, bid: str) -> dict:
        with webgame.lock:
            out = webgame.activate_build(self.s, bid)
            rows = self.db.conn().execute("SELECT digest FROM ci_levels WHERE status='waiting' AND build=?"
                                          " ORDER BY received_at", (bid,)).fetchall()
            levels = [self._import(r["digest"], bid) for r in rows]
            self._after_prune(out["pruned"])
            with self.db.write() as c:
                self.store._audit(c, user, "game.activate", build=bid, levels=[x["digest"] for x in levels])
            self._publish(user, "current", out["build"], levels)
            return {"build": out["build"], "levels": levels}

    def reject(self, user: str, bid: str) -> dict:
        with webgame.lock:
            build = webgame.remove_build(self.s, bid)
            dropped = self._drop("build=?", (bid,), "player đi kèm đã bị xoá")
            with self.db.write() as c:
                self.store._audit(c, user, "game.remove", build=bid, dropped=dropped)
            return {"build": build, "dropped": dropped}


async def _read_limited(request: Request, limit: int) -> bytes:
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise ApiError(413, f"Dữ liệu gửi lên quá lớn (tối đa {limit >> 20} MB)")
        chunks.append(chunk)
    return b"".join(chunks)


async def _stream_to_file(request: Request, path: Path, limit: int, settings=None) -> str:
    h, size = hashlib.sha256(), 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as out:
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise ApiError(413, f"Zip quá {limit >> 20} MB")
            if settings is not None:
                webgame.require_storage(settings, len(chunk))
            h.update(chunk)
            out.write(chunk)
    return h.hexdigest()


def create_router(s, ci: Ci, current_user, require_admin) -> APIRouter:
    r = APIRouter()

    @r.get("/api/ci/status")
    def ci_status(request: Request):
        ci.check_token(request)
        return ci.status()

    @r.post("/api/ci/levels")
    async def ci_levels(request: Request, by: str = ""):
        ci.check_token(request)
        body = await _read_limited(request, MAX_LEVELS_ZIP)
        return await run_in_threadpool(ci.receive_levels, by, body)

    @r.post("/api/ci/webgl")
    async def ci_webgl(request: Request, by: str = ""):
        ci.check_token(request)
        meta = clean_meta(request.query_params.get)
        d = webgame.game_dir(s)
        tmp = d.with_name(d.name + ".uploads") / f"ci-{secrets.token_hex(8)}.zip"
        try:
            digest = await _stream_to_file(request, tmp, webgame.MAX_ZIP_BYTES, s)
            return await run_in_threadpool(ci.receive_player, by, tmp, meta, digest)
        finally:
            tmp.unlink(missing_ok=True)

    @r.get("/api/game/builds")
    def builds(request: Request):
        current_user(request)
        ci.expire()
        return {"builds": webgame.list_builds(s), "levels": ci.receipts(),
                "ci": {"enabled": bool(s.ci_token), "branch": s.ci_branch or None, "pack": ci.pack}}

    @r.post("/api/game/builds/{bid}/activate")
    async def activate(bid: str, request: Request):
        user = current_user(request)
        require_admin(user, "chọn bản game")
        return await run_in_threadpool(ci.activate, user, bid)

    @r.delete("/api/game/builds/{bid}")
    async def remove(bid: str, request: Request):
        user = current_user(request)
        require_admin(user, "xoá bản game")
        return await run_in_threadpool(ci.reject, user, bid)

    return r
