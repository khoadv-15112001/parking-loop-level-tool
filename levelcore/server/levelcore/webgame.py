# Bản game WebGL (playtest) để app nhúng vào <iframe> cùng origin và chơi thử level đang sửa bằng game thật.
# Zip bản build WebGL của game (vd Hole-Master-2: PlaytestBuild/build-web.ps1), tải lên qua
# POST /api/game/upload (hoặc levelcore/tools/install_game.py), server giải nén vào <PREFIX>_GAME_DIR rồi phục vụ ở /game/.
# Qua link công ty (proxy giới hạn cỡ mỗi request) app tải theo từng phần CHUNK_BYTES: POST /api/game/uploads → PUT
# /api/game/uploads/{id}/{i} → POST /api/game/uploads/{id}/complete (giống Fish-Sort server/app/playtest.py).
# Unity nén Brotli (decompressionFallback = false) nên file *.br phải trả kèm Content-Encoding: br + đúng Content-Type.
#
# Nhiều bản build: <GAME_DIR> là bản đang dùng (phục vụ ở /game/), <GAME_DIR>.builds/<id>/ là bản chờ chọn (CI của nhánh
# không theo dõi) và bản trước để quay lại. Mỗi bản có id cố định theo buildUrl → nhánh + số build → digest zip, nên gửi
# lại cùng bản không cài lần hai. Chọn bản = đổi chỗ thư mục; zip lỗi không đụng bản đang dùng.
import hashlib
import io
import json
import re
import secrets
import shutil
import threading
import time
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response

from .errors import ApiError
from .storage import BUILD_BUDGET, disk_bytes, require_storage

MAX_ZIP_BYTES = 1024 * 1024 * 1024          # 1 GB nén
MAX_UNZIPPED_BYTES = 2 * 1024 * 1024 * 1024
INFO_FILE = "levelcore_game.json"
CHUNK_BYTES = 50 * 1024 * 1024              # mỗi phần tải lên (dưới giới hạn ~100 MB / request của proxy)
UPLOAD_TTL = 24 * 3600                      # phần tải dở quá 1 ngày thì dọn

# Content-Type theo đuôi THẬT của file (bỏ .br / .gz)
TYPES = {".js": "application/javascript", ".wasm": "application/wasm", ".data": "application/octet-stream",
         ".json": "application/json", ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png",
         ".jpg": "image/jpeg", ".ico": "image/x-icon", ".bundle": "application/octet-stream",
         ".hash": "text/plain", ".txt": "text/plain"}
ENCODINGS = {".br": "br", ".gz": "gzip"}
HASHED = re.compile(r"[0-9a-f]{32}")      # Unity: Build/<md5>.*, Addressables: <tên>_<md5>.bundle
KEEP_ROLLBACK = 1                           # bản đã dùng trước đây giữ lại để quay lại
KEEP_WAITING = 1
BUILD_ID = re.compile(r"b[0-9a-f]{12}|legacy-\d+")
BUILD_FIELDS = ("id", "version", "commit", "branch", "buildNumber", "buildUrl", "environment", "digest", "source",
                "uploaded_by", "uploaded_at", "activated_at", "file", "size")
lock = threading.RLock()                    # cài / chọn / xoá bản build và nhập level CI đi kèm: lần lượt từng việc


def game_dir(s) -> Path:
    return Path(s.game_dir)


def builds_dir(s) -> Path:
    d = game_dir(s)
    return d.with_name(d.name + ".builds")


def _iso(ts: float) -> str:
    from .store import iso
    return iso(ts)


def _read_info(d: Path) -> dict:
    try:
        return json.loads((d / INFO_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_info(d: Path, meta: dict):
    (d / INFO_FILE).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def build_key(meta: dict, digest: str) -> str:
    url = str(meta.get("buildUrl") or "")
    if re.match(r"https?://", url):
        return url[:300]
    if meta.get("branch") and meta.get("buildNumber"):
        return f"{meta['branch']}#{meta['buildNumber']}"
    return f"sha256:{digest}"


def build_id(key: str) -> str:
    return "b" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def _public(meta: dict, current: bool) -> dict:
    out = {k: meta.get(k) for k in BUILD_FIELDS}
    out["current"] = current
    out["status"] = "current" if current else ("rollback" if meta.get("activated_at") else "waiting")
    return out


def list_builds(s) -> list:
    """Bản đang dùng trước, rồi các bản khác mới nhất trước."""
    out = []
    if (game_dir(s) / "index.html").is_file():
        out.append(_public({"id": "legacy", **_read_info(game_dir(s))}, True))
    stored = []
    if builds_dir(s).is_dir():
        for d in builds_dir(s).iterdir():
            if d.is_dir() and BUILD_ID.fullmatch(d.name) and (d / "index.html").is_file():
                m = _read_info(d)
                stored.append((m.get("uploaded_ts") or 0, _public({**m, "id": d.name}, False)))
    return out + [b for _, b in sorted(stored, key=lambda x: -x[0])]


def find_build(s, bid: str) -> str | None:
    """'current' | 'stored' | None."""
    if (game_dir(s) / "index.html").is_file() and _read_info(game_dir(s)).get("id") == bid:
        return "current"
    if BUILD_ID.fullmatch(bid or "") and (builds_dir(s) / bid / "index.html").is_file():
        return "stored"
    return None


def info(s) -> dict:
    d = game_dir(s)
    if not (d / "index.html").is_file():
        return {"available": False}
    out = {"available": True, "url": "/game/index.html"}
    try:
        f = d / INFO_FILE
        if not f.is_file():   # bản cài trước khi tách level-tool-core: <tool>_game.json
            f = next(d.glob("*_game.json"), f)
        out.update(json.loads(f.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return out


def _check_zip(zf: zipfile.ZipFile) -> str:
    """Trả tiền tố thư mục chứa index.html (zip có thể bọc thêm 1 thư mục). Chặn zip-slip / zip bomb."""
    total = 0
    names = []
    for i in zf.infolist():
        p = PurePosixPath(i.filename.replace("\\", "/"))
        if p.is_absolute() or ".." in p.parts:
            raise ApiError(400, f"Zip có đường dẫn không hợp lệ: {i.filename}")
        total += i.file_size
        names.append(str(p))
    if total > MAX_UNZIPPED_BYTES:
        raise ApiError(413, "Bản game giải nén quá 2 GB")
    roots = sorted((n[: -len("index.html")] for n in names if n == "index.html" or n.endswith("/index.html")), key=len)
    if not roots:
        raise ApiError(400, "Zip không có index.html — cần zip bản build WebGL (Builds/playtest-web.zip)")
    root = roots[0]
    if not any(n.startswith(root + "Build/") and n.endswith((".loader.js", ".loader.js.br")) for n in names):
        raise ApiError(400, "Zip thiếu Build/*.loader.js — không phải bản build WebGL của Unity")
    return root


def _rename(src: Path, dst: Path):
    """Windows: antivirus / indexer hay giữ thư mục vừa giải nén vài giây (WinError 5) — thử lại trước khi bỏ cuộc."""
    for i in range(20):
        try:
            return src.rename(dst)
        except PermissionError:
            if i == 19:
                raise
            time.sleep(0.5)


def _clean_leftovers(d: Path):
    """Thư mục .new-* / .old-* còn lại khi lần cài trước bị ngắt giữa chừng (server khởi động lại, hết RAM…)."""
    for p in d.parent.glob(d.name + ".new-*"):
        shutil.rmtree(p, ignore_errors=True)
    for p in d.parent.glob(d.name + ".old-*"):
        shutil.rmtree(p, ignore_errors=True)


def _digest(src) -> str:
    if isinstance(src, (bytes, bytearray)):
        return hashlib.sha256(src).hexdigest()
    h = hashlib.sha256()
    with open(src, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def install_zip(s, src, user: str, name: str = "") -> dict:
    """Bản tải tay (admin / tools/install_game.py): luôn thành bản đang dùng. Trả info(s).
    src: bytes, hoặc Path của file zip trên đĩa — bản game ~300 MB: đọc thẳng từ file, không nạp cả zip vào RAM
    (container trên BI giới hạn bộ nhớ; nạp cả zip từng làm server bị tắt giữa lúc giải nén)."""
    install_build(s, src, user, name, {"source": "upload"}, activate=True, reuse_activates=True)
    return info(s)


def install_build(s, src, user: str, name: str = "", meta: dict | None = None, activate: bool = True,
                  reuse_activates: bool = False, digest: str | None = None) -> dict:
    """Cài một bản build. Trả {"status": "current" | "waiting" | "unchanged", "build", "pruned"}.
    Bản đã có (cùng id): CI → unchanged, không đổi gì; tải tay (reuse_activates) → chọn lại bản đó."""
    size = len(src) if isinstance(src, (bytes, bytearray)) else Path(src).stat().st_size
    if size > MAX_ZIP_BYTES:
        raise ApiError(413, "Zip quá 1 GB")
    try:
        zf = zipfile.ZipFile(io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else src)
    except zipfile.BadZipFile:
        raise ApiError(400, "File không phải zip")
    with zf:
        root = _check_zip(zf)
        meta = dict(meta or {})
        meta["digest"] = digest or _digest(src)
        key = build_key(meta, meta["digest"])
        bid = build_id(key)
        with lock:
            where = find_build(s, bid)
            if where == "current" or (where == "stored" and not (activate and reuse_activates)):
                d = game_dir(s) if where == "current" else builds_dir(s) / bid
                return {"status": "unchanged", "build": _public(_read_info(d), where == "current"), "pruned": []}
            if where == "stored":
                return {"status": "current", **activate_build(s, bid)}
            unpacked = sum(entry.file_size for entry in zf.infolist())
            if unpacked > BUILD_BUDGET:
                raise ApiError(413, "Bản WebGL vượt ngân sách 800 MB; nén bản game trước khi tải lên.")
            if not activate and disk_bytes(game_dir(s)) + unpacked > BUILD_BUDGET:
                raise ApiError(507, "Không đủ chỗ giữ bản game chờ trong ngân sách 800 MB.")
            require_storage(s, unpacked + 64 * 1024)
            now = time.time()
            meta.update({"id": bid, "key": key, "uploaded_by": user, "uploaded_at": _iso(now), "uploaded_ts": now,
                         "file": name or meta.get("file") or "", "size": size})
            tmp = _extract(s, zf, root, meta)
            try:
                if disk_bytes(tmp) + (0 if activate else disk_bytes(game_dir(s))) > BUILD_BUDGET:
                    raise ApiError(507, "Không đủ chỗ giữ bản game mới trong ngân sách 800 MB.")
                if activate:
                    _swap_in(s, tmp)
                else:
                    builds_dir(s).mkdir(parents=True, exist_ok=True)
                    _rename(tmp, builds_dir(s) / bid)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            d = game_dir(s) if activate else builds_dir(s) / bid
            return {"status": "current" if activate else "waiting", "build": _public(_read_info(d), activate),
                    "pruned": prune(s)}


def _extract(s, zf: zipfile.ZipFile, root: str, meta: dict) -> Path:
    d = game_dir(s)
    d.parent.mkdir(parents=True, exist_ok=True)
    _clean_leftovers(d)
    tmp = d.with_name(d.name + f".new-{int(time.time() * 1000)}")
    try:
        for i in zf.infolist():
            rel = i.filename.replace("\\", "/")
            if i.is_dir() or not rel.startswith(root):
                continue
            dst = tmp / rel[len(root):]
            dst.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(i) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out)
        _write_info(tmp, meta)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return tmp


def _swap_in(s, src: Path):
    """src thành bản đang dùng; bản đang dùng (nếu có) chuyển vào <GAME_DIR>.builds/ để quay lại."""
    d = game_dir(s)
    meta = _read_info(src)
    meta["activated_at"] = _iso(time.time())
    _write_info(src, meta)
    if (d / "index.html").is_file():
        cur = _read_info(d)
        cur_id = cur.get("id")
        if not BUILD_ID.fullmatch(str(cur_id or "")):
            cur_id = f"legacy-{int(time.time() * 1000)}"
            _write_info(d, {**cur, "id": cur_id, "activated_at": cur.get("uploaded_at") or _iso(0)})
        builds_dir(s).mkdir(parents=True, exist_ok=True)
        target = builds_dir(s) / cur_id
        shutil.rmtree(target, ignore_errors=True)
        _rename(d, target)
    elif d.exists():
        old = d.with_name(d.name + f".old-{int(time.time() * 1000)}")
        _rename(d, old)
        shutil.rmtree(old, ignore_errors=True)
    _rename(src, d)


def activate_build(s, bid: str) -> dict:
    """Chọn bản build làm bản đang dùng. Trả {"build", "pruned"}."""
    with lock:
        where = find_build(s, bid)
        if where is None:
            raise ApiError(404, "Không có bản build này (đã bị dọn hoặc chưa cài)")
        if where == "stored":
            _swap_in(s, builds_dir(s) / bid)
        return {"build": _public(_read_info(game_dir(s)), True), "pruned": prune(s)}


def remove_build(s, bid: str) -> dict:
    with lock:
        where = find_build(s, bid)
        if where == "current":
            raise ApiError(409, "Bản này đang dùng: chọn bản khác trước rồi mới xoá")
        if where is None:
            raise ApiError(404, "Không có bản build này")
        d = builds_dir(s) / bid
        out = _public({**_read_info(d), "id": bid}, False)
        shutil.rmtree(d, ignore_errors=True)
        return out


def prune(s) -> list:
    stored = [b for b in list_builds(s) if not b["current"]]
    old = sorted((b for b in stored if b["status"] == "rollback"), key=lambda b: b.get("activated_at") or "",
                 reverse=True)
    waiting = [b for b in stored if b["status"] == "waiting"]
    total = disk_bytes(game_dir(s))
    removed = []
    for group, keep in ((waiting, KEEP_WAITING), (old, KEEP_ROLLBACK)):
        for index, build in enumerate(group):
            size = disk_bytes(builds_dir(s) / build["id"])
            if index >= keep or total + size > BUILD_BUDGET:
                removed.append(build)
            else:
                total += size
    for b in removed:
        shutil.rmtree(builds_dir(s) / b["id"], ignore_errors=True)
    return [b["id"] for b in removed]


def create_router(s, current_user, require_admin) -> APIRouter:
    r = APIRouter()

    @r.get("/api/game")
    def game_info(request: Request):
        current_user(request)
        return info(s)

    uploads = game_dir(s).with_name(game_dir(s).name + ".uploads")

    def _upload(uid: str) -> Path:
        if not uid.isalnum() or not (uploads / uid / "meta.json").is_file():
            raise ApiError(404, "Không có lượt tải lên này (quá hạn hoặc đã xong) — tải lại từ đầu")
        return uploads / uid

    @r.post("/api/game/uploads")
    async def upload_start(request: Request):
        user = current_user(request)
        require_admin(user, "tải bản game lên")
        body = await request.json()
        size, name = body.get("size"), str(body.get("name") or "")[:200]
        if not isinstance(size, int) or not 0 < size <= MAX_ZIP_BYTES:
            raise ApiError(400, "size phải là số byte của zip (tối đa 1 GB)")
        now = time.time()
        if uploads.is_dir():
            for old in uploads.iterdir():
                if now - old.stat().st_mtime > UPLOAD_TTL:
                    shutil.rmtree(old, ignore_errors=True) if old.is_dir() else old.unlink(missing_ok=True)
        uid = secrets.token_hex(8)
        require_storage(s, size)
        (uploads / uid).mkdir(parents=True)
        (uploads / uid / "meta.json").write_text(json.dumps({"size": size, "name": name, "user": user}), encoding="utf-8")
        return {"id": uid, "chunk": CHUNK_BYTES, "parts": -(-size // CHUNK_BYTES)}

    @r.put("/api/game/uploads/{uid}/{i}")
    async def upload_part(uid: str, i: int, request: Request):
        require_admin(current_user(request), "tải bản game lên")
        d = _upload(uid)
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        parts = -(-meta["size"] // CHUNK_BYTES)
        if not 0 <= i < parts:
            raise ApiError(400, f"Phần {i} ngoài khoảng 0..{parts - 1}")
        data = await request.body()
        want = min(CHUNK_BYTES, meta["size"] - i * CHUNK_BYTES)
        if len(data) != want:
            raise ApiError(400, f"Phần {i} dài {len(data)} byte, cần {want}")
        require_storage(s, max(0, len(data) - disk_bytes(d / f"{i:05d}.part")))
        (d / f"{i:05d}.part").write_bytes(data)
        return {"ok": True, "part": i}

    @r.post("/api/game/uploads/{uid}/complete")
    async def upload_complete(uid: str, request: Request):
        user = current_user(request)
        require_admin(user, "tải bản game lên")
        d = _upload(uid)
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        parts = -(-meta["size"] // CHUNK_BYTES)
        missing = [i for i in range(parts) if not (d / f"{i:05d}.part").is_file()]
        if missing:
            raise ApiError(400, f"Còn thiếu phần {missing[:10]}")

        def assemble_and_install():
            # ghép các phần vào 1 file trên đĩa (xoá dần từng phần) rồi giải nén từ file — không giữ cả zip trong RAM
            zip_path = d / "upload.zip"
            try:
                with open(zip_path, "wb") as out:
                    for i in range(parts):
                        part = d / f"{i:05d}.part"
                        with open(part, "rb") as f:
                            shutil.copyfileobj(f, out, 1024 * 1024)
                        part.unlink()
                if zip_path.stat().st_size != meta["size"]:
                    raise ApiError(400, "Các phần ghép lại không đúng cỡ file — tải lại từ đầu")
                return install_zip(s, zip_path, user, meta["name"])
            finally:
                shutil.rmtree(d, ignore_errors=True)
        return await run_in_threadpool(assemble_and_install)

    @r.post("/api/game/upload")
    async def game_upload(request: Request, name: str = ""):
        user = current_user(request)
        require_admin(user, "tải bản game lên")
        # ghi luồng request ra file tạm (không nạp cả zip vào RAM), rồi cài từ file
        uploads.mkdir(parents=True, exist_ok=True)
        tmp_zip = uploads / f"single-{secrets.token_hex(6)}.zip"
        written = 0
        try:
            with open(tmp_zip, "wb") as out:
                async for chunk in request.stream():
                    written += len(chunk)
                    if written > MAX_ZIP_BYTES:
                        raise ApiError(413, "Zip quá 1 GB")
                    require_storage(s, len(chunk))
                    out.write(chunk)
            return await run_in_threadpool(install_zip, s, tmp_zip, user, name)
        finally:
            tmp_zip.unlink(missing_ok=True)

    @r.get("/game/{path:path}", include_in_schema=False)
    def game_file(request: Request, path: str = ""):
        d = game_dir(s).resolve()
        f = (d / (path or "index.html")).resolve()
        if d not in f.parents and f != d:
            raise ApiError(404, "Không có file")
        if f.is_dir():
            f = f / "index.html"
        if not f.is_file() or (f.parent == d and f.name.endswith("_game.json")):   # INFO_FILE (+ tên cũ)
            raise ApiError(404, "Chưa có bản game WebGL — tải bản build lên (README: Chơi thử bằng game thật)")
        headers = {}
        enc = ENCODINGS.get(f.suffix)
        inner = Path(f.stem).suffix if enc else f.suffix
        if enc:
            headers["Content-Encoding"] = enc
        # File có hash trong tên (Build/<hash>.wasm.br, aa/WebGL/props_assets_all_<hash>.bundle): nội dung đổi thì tên đổi →
        # trình duyệt giữ hẳn, không hỏi lại (bundle ~250 MB; trước đây tải lại mỗi lần mở game). File khác (index.html,
        # catalog.json…): no-cache + ETag, và trả 304 khi không đổi — FileResponse của Starlette không tự xử lý If-None-Match.
        st = f.stat()
        etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
        headers["ETag"] = etag
        if HASHED.search(f.name):
            headers["Cache-Control"] = "private, max-age=31536000, immutable"
        else:
            headers["Cache-Control"] = "no-cache"
        if etag in [t.strip().removeprefix("W/") for t in request.headers.get("if-none-match", "").split(",")]:
            return Response(status_code=304, headers={k: v for k, v in headers.items() if k != "Content-Encoding"})
        return FileResponse(f, media_type=TYPES.get(inner, "application/octet-stream"), headers=headers)

    return r
