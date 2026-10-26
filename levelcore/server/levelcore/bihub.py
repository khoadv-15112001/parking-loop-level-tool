"""Client BI Level Hub (port từ AntLevel server/app/bihub.py): đọc danh sách bộ (asset group) của game, tải level, đẩy zip
release lên BI thay vì tải zip về rồi upload tay + trang đăng nhập Firebase.

Hợp đồng: Firebase ID token của project BI trong `Authorization: Bearer`, mọi route dưới `/level-hub`, response thành công
`{"status": "success", "data": ...}`. Token do trình duyệt lấy (popup /bi/login) và gửi kèm request upload trong header
`X-BI-Token`; server chỉ chuyển tiếp một lần — KHÔNG lưu, KHÔNG log. Lỗi của BI trả về 502 (`bi_status` = mã gốc), không
dùng 401/403 của BI làm 401/403 của tool (401 làm app tưởng hết phiên đăng nhập tool).
"""

import html
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse

from .errors import ApiError

STATIC = Path(__file__).parent / "static"
LOGIN_HTML = (STATIC / "bi_login.html").read_text(encoding="utf-8")
FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.14.1"
MAX_ZIP_BYTES = 200 * 1024 * 1024
MIN_DESCRIPTION = 100
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class BiError(Exception):
    def __init__(self, message: str, bi_status: Optional[int] = None):
        super().__init__(message)
        self.bi_status = bi_status


def check_token(token: Optional[str]) -> str:
    """Hình dạng JWT thôi (không giải mã, không tin nội dung) — BI mới là bên xác thực."""
    token = (token or "").strip()
    if not token:
        raise ApiError(400, "Chưa đăng nhập BI — bấm Đẩy lên BI để đăng nhập Google")
    if not _TOKEN_RE.match(token):
        raise ApiError(400, "Token BI không hợp lệ")
    return token


def configured(s) -> bool:
    return bool(s.bi_api_url and s.bi_app_id and s.bi_firebase_api_key and s.bi_firebase_auth_domain
                and s.bi_firebase_project_id and s.bi_firebase_app_id)


def public_config(s) -> Dict[str, Any]:
    """Firebase Web App config is public; no token or secret is exposed."""
    return {"configured": configured(s), "env": s.bi_env, "appId": s.bi_app_id, "apiUrl": s.bi_api_url,
            "appIds": app_ids(s),
            "firebase": {"apiKey": s.bi_firebase_api_key, "authDomain": s.bi_firebase_auth_domain,
                         "projectId": s.bi_firebase_project_id, "appId": s.bi_firebase_app_id} if configured(s) else None}


def require_configured(s) -> None:
    if not configured(s):
        raise ApiError(503, f"Chưa cấu hình BI Level Hub ({s.var('BI_*')} — xem README.md)")


def _multipart(fields: Dict[str, str], file_field: str, file_name: str, file_bytes: bytes,
               content_type: str) -> Tuple[bytes, str]:
    boundary = "----levelcore" + secrets.token_hex(16)
    out = bytearray()
    for k, v in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n'.encode() + v.encode("utf-8") + b"\r\n"
    out += (f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{file_name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n").encode() + file_bytes + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def _message(raw: bytes) -> str:
    try:
        j = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        return raw.decode("utf-8", "replace")[:200]
    m = j.get("message") if isinstance(j, dict) else None
    if isinstance(m, list):
        m = "; ".join(str(x) for x in m)
    return str(m or j)[:300]


def call(s, method: str, path: str, token: str, *, json_body: Any = None, multipart: Optional[Tuple[bytes, str]] = None,
         timeout: float = 30.0) -> Any:
    """Gọi `{bi_api_url}/level-hub{path}`, trả `data`. Lỗi → BiError (message của BI + mã HTTP)."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    body = None
    if json_body is not None:
        body, headers["Content-Type"] = json.dumps(json_body).encode("utf-8"), "application/json"
    elif multipart is not None:
        body, headers["Content-Type"] = multipart
    req = urllib.request.Request(f"{s.bi_api_url.rstrip('/')}/level-hub{path}", data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
    except urllib.error.HTTPError as e:
        raise BiError(_message(e.read()), e.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise BiError(f"Không kết nối được BI: {getattr(e, 'reason', e)}") from None
    try:
        j = json.loads(raw.decode("utf-8"))
    except ValueError:
        raise BiError("BI trả dữ liệu không phải JSON") from None
    return j.get("data") if isinstance(j, dict) and "data" in j else j


def as_api_error(e: BiError, step: str = "", app_id: str = "") -> ApiError:
    """`step` = bước đang gọi (parse-name cần quyền Read Asset Group, tạo nhóm cần Create) — để biết xin quyền gì."""
    hint = {401: " — token hết hạn / sai project, đăng nhập lại",
            403: f" — tài khoản chưa có quyền Level Hub cho bước này hoặc chưa được truy cập app {app_id or '?'}"}
    where = f" [{step}]" if step else ""
    return ApiError(502, f"BI{where}: {e}{hint.get(e.bi_status, '')}", bi_status=e.bi_status, bi_step=step or None)


def parse_name(s, token: str, name: str, app_id: str = "") -> Dict[str, Any]:
    return call(s, "POST", "/parse-name", token, json_body={"appId": app_id or s.bi_app_id, "name": name})


def create_group(s, token: str, name: str, zip_bytes: bytes, description: str = "", app_id: str = "") -> Dict[str, Any]:
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise BiError("Zip lớn hơn 200 MiB — chia nhỏ dải level hoặc bỏ ảnh preview")
    fields = {"appId": app_id or s.bi_app_id, "name": name}
    if description:
        fields["description"] = description
    # Không retry: chưa biết request đã tạo group hay chưa thì thử lại sẽ tạo trùng / báo 409.
    return call(s, "POST", "/asset-groups", token, multipart=_multipart(fields, "file", f"{name}.zip", zip_bytes, "application/zip"),
                timeout=300.0)


def _checked_id(value: str, label: str) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise ApiError(400, f"id {label} không hợp lệ")
    return value


def get_group(s, token: str, group_id: str) -> Dict[str, Any]:
    return call(s, "GET", f"/asset-groups/{_checked_id(group_id, 'nhóm')}", token)


PAGE_LIMIT = 100                                  # trần limit của BI (mặc định 20)
GROUP_STATUSES = ("PROCESSING", "READY", "FAILED", "ARCHIVED")
GROUP_ACTIONS = {"retry": "Update Asset Group", "build": "Update Asset Group", "archive": "Manage Asset Group"}


def app_ids(s) -> Dict[str, str]:
    """appId của game trên BI theo nền tảng (BI tách app Android / iOS — mã OS A / I trong tên bộ)."""
    out = {"Android": s.bi_app_id}
    if s.bi_app_id_ios:
        out["iOS"] = s.bi_app_id_ios
    return out


def app_for_os(s, os_name: str) -> str:
    app = app_ids(s).get(os_name)
    if not app:
        raise ApiError(400, f"Chưa cấu hình appId BI cho {os_name} ({s.var('BI_APP_ID_IOS')}) — chưa đẩy bộ {os_name} lên được")
    return app


def list_groups(s, token: str, page: int, search: str = "", statuses=()) -> Any:
    # Mảng query của BI (appIds, statuses) lặp lại key, KHÔNG nối bằng dấu phẩy. Không truyền statuses = ẩn ARCHIVED.
    apps = list(app_ids(s).values())

    def fetch(app_list):
        params = [("appIds", a) for a in app_list] + [("page", page), ("limit", PAGE_LIMIT)]
        params += [("statuses", st) for st in statuses if st in GROUP_STATUSES]
        if search:
            params.append(("search", search))
        return call(s, "GET", "/asset-groups?" + urllib.parse.urlencode(params), token)

    try:
        return fetch(apps)
    except BiError as e:
        # appId iOS sai / tài khoản chưa được cấp app iOS: vẫn trả bộ Android, kèm cảnh báo cho app hiện ra.
        if len(apps) < 2 or e.bi_status not in (400, 403, 404):
            raise
        out = fetch([s.bi_app_id])
        if isinstance(out, dict):
            out = {**out, "warning": f"Không đọc được bộ iOS (appId {s.bi_app_id_ios}) trên BI: {e} — chỉ hiện bộ Android. "
                                     f"Kiểm tra {s.var('BI_APP_ID_IOS')} / quyền Level Hub cho app iOS."}
        return out


def list_group_files(s, token: str, group_id: str, page: int) -> Any:
    group_id = _checked_id(group_id, "nhóm")
    return call(s, "GET", f"/asset-groups/{group_id}/files?" + urllib.parse.urlencode({"page": page, "limit": PAGE_LIMIT}),
                token)


def group_action(s, token: str, group_id: str, action: str) -> Dict[str, Any]:
    """retry (chạy lại bộ FAILED từ ZIP đã lưu) · build (yêu cầu Unity CI dựng bundle) · archive (lưu trữ mềm)."""
    if action not in GROUP_ACTIONS:
        raise ApiError(400, "action phải là retry | build | archive")
    return call(s, "POST", f"/asset-groups/{_checked_id(group_id, 'nhóm')}/{action}", token, json_body={}, timeout=60.0)


def get_file_raw(s, token: str, group_id: str, file_id: str) -> Tuple[bytes, str]:
    group_id = _checked_id(group_id, "nhóm")
    file_id = _checked_id(file_id, "file")
    url = f"{s.bi_api_url.rstrip('/')}/level-hub/asset-groups/{group_id}/files/{file_id}/raw"
    req = urllib.request.Request(url, method="GET", headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30.0) as res:
            raw = res.read()
            content_type = res.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as e:
        raise BiError(_message(e.read()), e.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise BiError(f"Không kết nối được BI: {getattr(e, 'reason', e)}") from None
    # Only forward JSON media types and harmless charset parameters; discard unsafe or misleading headers.
    if not re.fullmatch(r"(?i)application/(?:[a-z0-9.+-]+\+)?json(?:\s*;\s*charset\s*=\s*[\"']?[a-z0-9._-]+[\"']?)?", content_type.strip()):
        content_type = "application/json"
    return raw, content_type

_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"


def verify_id_token(s, id_token: str) -> str:
    """Firebase ID token → email đã xác minh. Hỏi chính Firebase (accounts:lookup với apiKey của project BI): token của
    project khác / hết hạn / giả đều bị từ chối, không cần thư viện mã hoá. Chỉ gọi lúc đăng nhập, không phải mỗi request."""
    if not _TOKEN_RE.match((id_token or "").strip()):
        raise ApiError(400, "Token Firebase không hợp lệ")
    req = urllib.request.Request(f"{_LOOKUP_URL}?key={urllib.parse.quote(s.bi_firebase_api_key, safe='')}", method="POST",
                                 data=json.dumps({"idToken": id_token.strip()}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            users = json.loads(res.read().decode("utf-8")).get("users") or []
    except urllib.error.HTTPError:
        raise ApiError(401, "Firebase từ chối token — đăng nhập lại") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise ApiError(502, "Không kết nối được Firebase để xác minh đăng nhập") from None
    user = users[0] if users else {}
    email = str(user.get("email") or "").strip().lower()
    if not email or user.get("emailVerified") is not True:
        raise ApiError(401, "Tài khoản Google chưa xác minh email")
    return email


def create_router(s) -> APIRouter:
    """Trang đăng nhập popup — công khai (chỉ chứa cấu hình Web App công khai, không có phiên/token)."""
    r = APIRouter()
    csp = ("default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; "
           f"script-src 'self' {FIREBASE_SDK[:FIREBASE_SDK.index('/firebasejs')]} https://apis.google.com; "
           "style-src 'unsafe-inline'; img-src data: https:; font-src https:; "
           "connect-src 'self' https://*.googleapis.com https://*.google.com; "
           "frame-src https://*.firebaseapp.com https://*.web.app https://accounts.google.com "
           f"https://{html.escape(s.bi_firebase_auth_domain or 'invalid.invalid')}")

    @r.get("/bi/login", include_in_schema=False)
    def login_page():
        require_configured(s)
        page = (LOGIN_HTML.replace("{sdk}", FIREBASE_SDK)
                .replace("{apiKey}", html.escape(s.bi_firebase_api_key, quote=True))
                .replace("{authDomain}", html.escape(s.bi_firebase_auth_domain, quote=True))
                .replace("{projectId}", html.escape(s.bi_firebase_project_id, quote=True))
                .replace("{appId}", html.escape(s.bi_firebase_app_id, quote=True))
                .replace("{env}", html.escape(s.bi_env, quote=True)))
        return HTMLResponse(page, headers={"Content-Security-Policy": csp, "X-Frame-Options": "DENY",
                                           "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})

    @r.get("/bi/login.js", include_in_schema=False)
    def login_js():
        return FileResponse(STATIC / "bi_login.js", media_type="text/javascript")

    return r
