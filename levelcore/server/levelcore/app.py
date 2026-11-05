# App FastAPI của level-tool-core (cùng đường API / ETag / If-Match / SSE với FishLevel / AntLevel).
# Chạy: uvicorn --factory levelcore.main:get_app --workers 1  (broker SSE + khoá ghi nằm trong tiến trình).
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, Depends, FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse

from . import auth as auth_mod
from . import bihub, ci as ci_mod, levelhub, webgame
from .auth import Auth
from .config import Settings
from .db import DB
from .errors import ApiError
from .events import Broker
from .plugin import GamePlugin
from .store import Store, parse_time
from .store import iso as store_iso
from .vl_sso import COOKIE_NAME

log = logging.getLogger("levelcore.app")

# CSP cho bản web /app/: script chỉ từ file cùng origin (không inline, không eval).
WEB_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
           "connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
           "frame-src 'self'; frame-ancestors 'none'")


def _etag(rev: int) -> dict:
    return {"ETag": f'"r{rev}"'}


def create_app(game: GamePlugin, settings: Settings | None = None) -> FastAPI:
    s = settings or Settings.from_env(game)
    db = DB(s.db_path)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        db.close()
        if game.rules is not None:
            game.rules.close()

    docs = {} if s.dev else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title=f"{s.tool_name} sync server", version="0.1", lifespan=lifespan, **docs)
    if s.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
                           allow_methods=["*"], allow_headers=["*"], expose_headers=["ETag", "Content-Disposition"])

    # CSRF: request ghi dựa vào cookie vl_sso phải có Origin = chính server (header Authorization / X-Dev-User không tự đính).
    pub = urlsplit(s.public_base)
    write_origins = {f"{pub.scheme}://{pub.netloc}", *s.cors_origins}
    if s.dev and pub.port:   # máy dev: Firebase chỉ cho sẵn domain localhost — mở http://localhost:<cổng>/app/ cũng là app này
        write_origins |= {f"http://localhost:{pub.port}", f"http://127.0.0.1:{pub.port}"}

    @app.middleware("http")
    async def _csrf_origin(request: Request, call_next):
        if (request.method not in ("GET", "HEAD", "OPTIONS") and COOKIE_NAME in request.cookies
                and not request.headers.get("authorization") and request.headers.get("origin") not in write_origins):
            e = ApiError(403, f"Yêu cầu ghi không đến từ app {s.tool_name} (Origin không hợp lệ)")
            return JSONResponse(e.body, status_code=e.status)
        return await call_next(request)

    broker = Broker()
    store = Store(db, broker, s, game)
    ci = ci_mod.Ci(s, db, store, broker)
    auth = Auth(s)
    store.ensure_default_packs()
    app.state.settings, app.state.db, app.state.broker, app.state.store, app.state.auth = s, db, broker, store, auth

    @app.exception_handler(ApiError)
    async def _api_error(_req: Request, e: ApiError):
        return JSONResponse(e.body, status_code=e.status)

    def current_user(request: Request) -> str:
        return app.state.auth.identify(request)

    def require_admin(user: str, what: str) -> None:
        if not s.is_admin(user):
            raise ApiError(403, f"Chỉ admin được {what}")

    async def _json_body(request: Request):
        try:
            return json.loads((await request.body()).decode("utf-8-sig") or "null")
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ApiError(400, f"Body không phải JSON: {e}")

    api = APIRouter(prefix="/api", dependencies=[Depends(current_user)])

    @app.get("/healthz")
    def healthz():
        db.conn().execute("SELECT 1")
        return {"ok": True, "version": s.version}

    @api.get("/me")
    def me(user: str = Depends(current_user)):
        return {"email": user, "dev": s.dev, "lock_ttl": s.lock_ttl, "online": broker.online(),
                "admin": s.is_admin(user), "runtime": "python", "format_version": s.format_version,
                "features": {"levelhub": game.levelhub is not None, "bi": bihub.configured(s), "webgame": True}}

    # ----- pack -----
    @api.get("/packs")
    def packs():
        return store.list_packs()

    @api.post("/packs", status_code=201)
    def create_pack(body: dict = Body(...), user: str = Depends(current_user)):
        return store.create_pack(user, body.get("name"), body.get("description", ""), body.get("platform", "android"),
                                 body.get("group", ""))

    @api.patch("/packs/{pack}")
    def update_pack(pack: str, body: dict = Body(...), user: str = Depends(current_user)):
        if body.get("production") is not None or body.get("archived") is not None:
            require_admin(user, "đổi cờ production / lưu trữ")
        return store.update_pack(user, pack, body.get("archived"), body.get("production"), body.get("platform"),
                                 body.get("group"), body.get("description"))

    @api.post("/packs/{pack}/rename")
    def rename_pack(pack: str, body: dict = Body(...), user: str = Depends(current_user)):
        return store.rename_pack(user, pack, body.get("to"))

    # ----- level -----
    @api.get("/packs/{pack}/levels")
    def levels(pack: str, include_deleted: bool = False):
        return store.list_levels(pack, include_deleted)

    @api.get("/packs/{pack}/bundle")
    def bundle(pack: str):
        return store.bundle(pack)

    @api.get("/packs/{pack}/validate")
    async def validate_pack(pack: str):
        return await run_in_threadpool(store.validate_pack, pack)

    @api.get("/packs/{pack}/levels/{name}")
    def get_level(pack: str, name: str):
        d = store.get_level(pack, name)
        return JSONResponse(d, headers=_etag(d["rev"]))

    async def _save(request: Request, pack, name, user, create: bool, message: str):
        body = await request.body()
        d = await run_in_threadpool(store.save_level, user, pack, name, body, request.headers.get("if-match"), create,
                                    message)
        return JSONResponse(d, status_code=201 if create else 200, headers=_etag(d["rev"]))

    @api.post("/packs/{pack}/levels/{name}")
    async def create_level(pack: str, name: str, request: Request, message: str = "", user: str = Depends(current_user)):
        return await _save(request, pack, name, user, True, message)

    @api.put("/packs/{pack}/levels/{name}")
    async def update_level(pack: str, name: str, request: Request, message: str = "", user: str = Depends(current_user)):
        return await _save(request, pack, name, user, False, message)

    @api.delete("/packs/{pack}/levels/{name}")
    def delete_level(pack: str, name: str, request: Request, user: str = Depends(current_user)):
        d = store.delete_level(user, pack, name, request.headers.get("if-match"))
        return JSONResponse(d, headers=_etag(d["rev"]))

    @api.get("/packs/{pack}/levels/{name}/revisions")
    def revisions(pack: str, name: str):
        return store.list_revisions(pack, name)

    @api.get("/packs/{pack}/levels/{name}/revisions/{rev}")
    def revision(pack: str, name: str, rev: int):
        return store.get_revision(pack, name, rev)

    @api.get("/packs/{pack}/levels/{name}/revisions/{rev}/diff")
    def revision_diff(pack: str, name: str, rev: int):
        return store.revision_diff(pack, name, rev)

    @api.post("/packs/{pack}/levels/{name}/revert")
    def revert(pack: str, name: str, request: Request, body: dict = Body(...), user: str = Depends(current_user)):
        if not isinstance(body.get("rev"), int):
            raise ApiError(400, "Cần {\"rev\": <int>}")
        d = store.revert(user, pack, name, body["rev"], request.headers.get("if-match"), body.get("message", ""))
        return JSONResponse(d, headers=_etag(d["rev"]))

    @api.post("/packs/{pack}/levels/{name}/relevel")
    def relevel(pack: str, name: str, request: Request, body: dict = Body(...), user: str = Depends(current_user)):
        to, mode = body.get("to"), body.get("mode", "swap")
        if not isinstance(to, (str, int)) or isinstance(to, bool):
            raise ApiError(400, 'Cần {"to": "<số mới>", "mode": "swap" | "shift"}')
        return store.relevel(user, pack, name, str(to), mode, request.headers.get("if-match"),
                             dry_run=body.get("dry_run") is True)

    # ----- khoá -----
    @api.post("/locks/packs/{pack}/levels/{name}")
    def lock(pack: str, name: str, user: str = Depends(current_user)):
        return store.acquire_lock(user, pack, name)

    @api.put("/locks/packs/{pack}/levels/{name}")
    def heartbeat(pack: str, name: str, user: str = Depends(current_user)):
        return store.heartbeat_lock(user, pack, name)

    @api.delete("/locks/packs/{pack}/levels/{name}")
    def unlock(pack: str, name: str, force: bool = False, user: str = Depends(current_user)):
        if force:
            l = store._lock(db.conn(), pack, name)
            if l is not None and l["holder"] != user:
                require_admin(user, "phá khoá của người khác")
        return store.release_lock(user, pack, name, force)

    # ----- promote -----
    @api.post("/promote")
    async def promote(request: Request, user: str = Depends(current_user)):
        body = await _json_body(request)
        if not isinstance(body, dict):
            raise ApiError(400, 'Cần {"from", "to", "items": [{name, to?}]}')
        return await run_in_threadpool(store.promote, user, body.get("from"), body.get("to"), body.get("items"),
                                       body.get("message", ""))

    # ----- import / export -----
    @api.post("/packs/{pack}/import")
    async def import_(pack: str, request: Request, folder: str | None = None, message: str = "", dry_run: bool = False,
                      force: bool = False, user: str = Depends(current_user)):
        body = await request.body()
        return await run_in_threadpool(store.import_levels, user, pack, body, request.headers.get("content-type", ""),
                                       folder, message, dry_run, force)

    @api.get("/packs/{pack}/export")
    def export(pack: str):
        data = store.export_pack(pack)
        return Response(data, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{pack}.zip"'})

    # ----- Xuất Level Hub: zip LevelMetadata.json + Raw/ cho LevelBuild / BI -----
    @api.get("/levelhub/options")
    def levelhub_options():
        spec = levelhub.spec_of(store)
        return {"game": spec.acronym, "os": list(levelhub.OS_CODES), "teams": list(levelhub.TEAMS),
                "why": list(levelhub.WHY_OPTIONS), "geo": list(levelhub.GEO_OPTIONS),
                "obstacleCodes": [{"key": k, "code": c} for k, c in spec.obstacle_codes]}

    def _lh_request(pack, body):
        if not isinstance(body, dict):
            raise ApiError(400, "Body phải là JSON object")
        try:
            return levelhub.ExportRequest.parse(pack, body)
        except levelhub.RequestError as e:
            raise ApiError(400, str(e))

    @api.post("/packs/{pack}/levelhub/preflight")
    async def levelhub_preflight(pack: str, request: Request):
        req = _lh_request(pack, await _json_body(request))
        report = await run_in_threadpool(levelhub.preflight, store, req)
        return levelhub.to_payload(report)

    @api.post("/packs/{pack}/levelhub/export")
    async def levelhub_export(pack: str, request: Request, user: str = Depends(current_user)):
        req = _lh_request(pack, await _json_body(request))
        try:
            zip_name, data, summary = await run_in_threadpool(levelhub.build_zip, store, req)
        except levelhub.ExportBlocked as e:
            raise ApiError(422, str(e), report=levelhub.to_payload(e.report))
        with db.write() as c:
            store._audit(c, user, "levelhub.export", pack=pack, zip=zip_name, levels=summary["levelCount"],
                         missing=summary["missingTotal"], manifest=summary["manifest"], newer=summary["newer"])
        return Response(data, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'})

    # ----- BI Level Hub (bihub.py, port từ AntLevel): Firebase ID token của BI gửi trong header X-BI-Token, server chỉ
    # chuyển tiếp — không lưu, không log. Quyền đọc / tạo nhóm do BI kiểm; lỗi của BI trả 502 (bi_status, bi_step).
    @api.get("/bi/config")
    def bi_config():
        return bihub.public_config(s)

    def _bi_token(request: Request) -> str:
        bihub.require_configured(s)
        return bihub.check_token(request.headers.get("x-bi-token"))

    @api.get("/bi/asset-groups")
    async def bi_asset_groups(request: Request, page: int = Query(1, ge=1), search: str = Query("", max_length=200),
                              archived: bool = False):
        """Danh sách bộ (asset group) của game trên Level Hub — dropdown "Bộ trên Level Hub"."""
        token = _bi_token(request)
        try:
            return await run_in_threadpool(bihub.list_groups, s, token, page, search,
                                           bihub.GROUP_STATUSES if archived else ())
        except bihub.BiError as e:
            raise bihub.as_api_error(e, "đọc danh sách bộ (quyền Read Asset Group)", s.bi_app_id)

    @api.post("/packs/{pack}/levelhub/check")
    async def levelhub_check(pack: str, request: Request):
        token = _bi_token(request)
        store.list_levels(pack)
        req = _lh_request(pack, await _json_body(request))
        if not levelhub.join_geo(req.geo):
            raise ApiError(400, "Kiểm tra tên trên BI cần chọn GEO")
        app_id = bihub.app_for_os(s, req.os_name)
        name = levelhub.compose_zip_name(levelhub.spec_of(store).acronym, levelhub.OS_CODES[req.os_name],
                                        req.from_lv, req.to_lv, req.geo, req.why, req.designer,
                                        datetime.now(levelhub.VN_TZ).date(), req.version, req.date)[:-4]
        try:
            return await run_in_threadpool(bihub.check_name, s, token, name, app_id)
        except bihub.BiError as e:
            raise bihub.as_api_error(e, "kiểm tra tên (parse-name, quyền Read Asset Group)", app_id)

    @api.get("/bi/groups/{group_id}")
    async def bi_group(group_id: str, request: Request):
        token = _bi_token(request)
        try:
            return await run_in_threadpool(bihub.get_group, s, token, group_id)
        except bihub.BiError as e:
            raise bihub.as_api_error(e, "đọc bộ", s.bi_app_id)

    @api.get("/bi/asset-groups/{group_id}/files")
    async def bi_asset_group_files(group_id: str, request: Request, page: int = Query(1, ge=1)):
        token = _bi_token(request)
        try:
            return await run_in_threadpool(bihub.list_group_files, s, token, group_id, page)
        except bihub.BiError as e:
            raise bihub.as_api_error(e, "đọc danh sách file", s.bi_app_id)

    @api.get("/bi/asset-groups/{group_id}/files/{file_id}/raw")
    async def bi_asset_group_file_raw(group_id: str, file_id: str, request: Request):
        token = _bi_token(request)
        try:
            raw, content_type = await run_in_threadpool(bihub.get_file_raw, s, token, group_id, file_id)
        except bihub.BiError as e:
            raise bihub.as_api_error(e, "đọc file", s.bi_app_id)
        return Response(raw, media_type=content_type)

    @api.post("/bi/groups/{group_id}/{action}")
    async def bi_group_action(group_id: str, action: str, request: Request, user: str = Depends(current_user)):
        """retry · build · archive một bộ trên Level Hub (quyền Update / Manage Asset Group do BI kiểm)."""
        token = _bi_token(request)
        try:
            group = await run_in_threadpool(bihub.group_action, s, token, group_id, action)
        except bihub.BiError as e:
            raise bihub.as_api_error(e, f"{action} ({bihub.GROUP_ACTIONS.get(action, '?')})", s.bi_app_id)
        with db.write() as c:
            store._audit(c, user, f"levelhub.bi_{action}", group=group_id, env=s.bi_env)
        return group

    @api.post("/packs/{pack}/levelhub/upload")
    async def levelhub_upload(pack: str, request: Request, user: str = Depends(current_user)):
        """Đóng gói như /levelhub/export rồi đẩy thẳng lên BI: parse-name (kiểm tên 9 phần) → asset-groups (tạo bộ)."""
        token = _bi_token(request)
        body = await _json_body(request)
        req = _lh_request(pack, body)
        description = body.get("description") or ""
        if not isinstance(description, str) or len(description) > 2000:
            raise ApiError(400, "Mô tả tối đa 2000 ký tự")
        if description and len(description) < bihub.MIN_DESCRIPTION:
            raise ApiError(400, f"Mô tả (nếu nhập) tối thiểu {bihub.MIN_DESCRIPTION} ký tự")
        if not levelhub.join_geo(req.geo):
            raise ApiError(400, "Đẩy lên BI cần chọn Geo (tên bộ trên BI không được có phần Geo rỗng)")
        app_id = bihub.app_for_os(s, req.os_name)   # BI tách app theo nền tảng: bộ iOS vào app iOS
        try:
            zip_name, data, summary = await run_in_threadpool(levelhub.build_zip, store, req)
        except levelhub.ExportBlocked as e:
            raise ApiError(422, str(e), report=levelhub.to_payload(e.report))
        # Tên bộ trên BI: đoạn OS là mã A/I (zip kiểu Unity ghi Android/iOS) — phần còn lại giữ nguyên
        parts = zip_name[:-4].split("_")
        parts[1] = levelhub.OS_CODES[req.os_name]
        bi_name = "_".join(parts)
        try:
            await run_in_threadpool(bihub.parse_name, s, token, bi_name, app_id)
        except bihub.BiError as e:
            raise bihub.as_api_error(e, "kiểm tra tên (parse-name, quyền Read Asset Group)", app_id)
        started, recovered = time.time(), False
        try:
            group = await run_in_threadpool(bihub.create_group, s, token, bi_name, data, description, app_id)
        except bihub.BiError as e:
            if e.bi_status is not None:
                raise bihub.as_api_error(e, "tạo bộ (asset-groups, quyền Create Asset Group)", app_id)
            try:
                group = await run_in_threadpool(bihub.find_created_group, s, token, bi_name, app_id, started, user)
            except bihub.BiError:
                group = None
            if group is None:
                raise ApiError(502, f"BI không trả lời khi tạo bộ ({e}); chưa thấy bộ {bi_name} trên BI — đẩy lại được",
                               bi_status=None, bi_step="tạo bộ", checked_at=store_iso(time.time()))
            recovered = True
        with db.write() as c:
            store._audit(c, user, "levelhub.bi_upload", pack=pack, zip=bi_name, env=s.bi_env, app=app_id,
                         group=(group or {}).get("id") or (group or {}).get("_id") or (group or {}).get("groupId"),
                         levels=summary["levelCount"], missing=summary["missingTotal"],
                         manifest=summary["manifest"], newer=summary["newer"], recovered=recovered)
        return {"name": bi_name, "group": group, "levelCount": summary["levelCount"], "newer": summary["newer"],
                "recovered": recovered, "checked_at": store_iso(time.time())}

    # ----- audit -----
    @api.get("/audit")
    def audit(user: str | None = None, since: str | None = None, level: str | None = None,
              pack: str | None = None, action: str | None = None, limit: int = Query(200, ge=1, le=5000)):
        return store.list_audit(user, parse_time(since), level, pack, action, limit)

    # ----- SSE -----
    @api.get("/events")
    async def events(request: Request, user: str = Depends(current_user)):
        sub = broker.subscribe(user)

        async def gen():
            try:
                yield "retry: 3000\n\n"
                yield broker.format("presence", {"online": broker.online()})
                while True:
                    try:
                        msg = await asyncio.wait_for(sub.queue.get(), timeout=s.sse_heartbeat)
                    except asyncio.TimeoutError:
                        if await request.is_disconnected():
                            break
                        yield ": ping\n\n"
                        continue
                    yield msg
            finally:
                broker.unsubscribe(sub)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    app.include_router(api)

    # ----- đăng nhập Google (Firebase của BI): popup /bi/login lấy Firebase ID token → đổi lấy phiên của tool -----
    app.include_router(bihub.create_router(s))
    app.include_router(webgame.create_router(s, current_user, require_admin))
    app.include_router(ci_mod.create_router(s, ci, current_user, require_admin))

    @app.post("/auth/firebase")
    async def auth_firebase(request: Request):
        bihub.require_configured(s)
        # luôn đòi Origin của app: chặn trang lạ đăng nhập trình duyệt người dùng vào tài khoản khác (login-CSRF)
        if request.headers.get("origin") not in write_origins:
            raise ApiError(403, f"Yêu cầu đăng nhập không đến từ app {s.tool_name} (Origin không hợp lệ)")
        body = await _json_body(request)
        id_token = body.get("idToken") if isinstance(body, dict) else None
        email = await run_in_threadpool(bihub.verify_id_token, s, id_token or "")
        auth.require_allowed(email)
        token = auth.issue(email)
        resp = JSONResponse({"token": token, "email": email})
        resp.set_cookie(COOKIE_NAME, token, max_age=auth_mod.SESSION_TTL, httponly=True, samesite="lax",
                        secure=s.public_base.startswith("https://"))
        return resp

    @app.post("/auth/logout")
    def auth_logout():
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE_NAME)
        return resp

    @app.get("/auth/status")
    def auth_status():
        """Công khai: trang đăng nhập của app biết hiện nút Google (BI đã cấu hình) và / hoặc ô email DEV."""
        return {"bi": bihub.configured(s), "env": s.bi_env, "dev": s.dev, "version": s.version}

    # ----- bản web: /app/* = levelcore/web (vỏ chung) hoặc giao diện riêng của game (manifest "app"),
    # /app/game/* = game/web (module riêng của game), /core/* = levelcore/web cho giao diện riêng import -----
    web = s.web_root_dir()
    if (web / "levelcore" / "web" / "index.html").is_file():
        from fastapi.staticfiles import StaticFiles

        # Game không có game.mjs riêng thì dùng game.mjs mặc định của core (dựng từ manifest + module luật).
        core_web = web / "levelcore" / "web"
        fallbacks = {"game.mjs": core_web / "js" / "default_game.mjs", "ui.mjs": core_web / "js" / "empty_ui.mjs"}
        if game.manifest_file:
            fallbacks.update({"manifest.json": Path(game.manifest_file), "rules.mjs": Path(game.validator_module)})
        web_types = {".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".css": "text/css"}

        @app.get("/app/game/{name}", include_in_schema=False)
        def _game_web(name: str):
            own = s.game_web_dir() / name
            f = own if own.is_file() and own.resolve().parent == s.game_web_dir().resolve() else fallbacks.get(name)
            if f is not None and f.is_file():
                return FileResponse(f, media_type=web_types.get(f.suffix, "application/octet-stream"))
            if name == "game.css":
                return Response("", media_type="text/css")
            if name == "releases.json":
                return JSONResponse([])
            raise ApiError(404, "Not Found")

        # trước /app; repo core không có game/ (check_dir=False: chỉ 404)
        app.mount("/app/game", StaticFiles(directory=s.game_web_dir(), check_dir=False), name="web-game")
        app.mount("/core", StaticFiles(directory=web / "levelcore" / "web"), name="web-core")
        app.mount("/app", StaticFiles(directory=s.game_app or web / "levelcore" / "web", html=True), name="web-app")

        @app.middleware("http")
        async def _gate_web(request: Request, call_next):
            p = request.url.path
            is_game = p.startswith("/game/")   # bản game WebGL trong iframe: cùng cổng đăng nhập, KHÔNG CSP của app
            is_web = p == "/app" or p.startswith("/app/") or p.startswith("/core/") or is_game
            # DEV: trang tự đăng nhập bằng email (header X-Dev-User) nên file tĩnh không cần danh tính.
            # Có BI: giao diện /app công khai (app tự hiện nút Google; dữ liệu /api/* vẫn bắt đăng nhập) — chỉ
            # bản game /game/ cần phiên (cookie đặt lúc POST /auth/firebase, iframe cùng origin gửi kèm).
            gated = is_game or not bihub.configured(s)
            if is_web and gated and not s.dev:
                try:
                    auth.identify(request)
                except ApiError as e:
                    if e.status == 401 and request.method == "GET" and not is_game:
                        return RedirectResponse(auth.login_url(s.public_base + p), 302)
                    return JSONResponse(e.body, status_code=e.status)
            resp = await call_next(request)
            if is_web and not is_game:
                resp.headers["Content-Security-Policy"] = WEB_CSP
            if is_web and not is_game:
                resp.headers["Cache-Control"] = "private, no-cache"
            return resp

        @app.get("/", include_in_schema=False)
        def _root():
            return RedirectResponse("/app/", 302)

    return app
