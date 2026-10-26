# Danh tính (port từ AntLevel): đăng nhập Google của Firebase project BI (popup /bi/login → POST /auth/firebase, bihub.py).
# Server xác minh Firebase ID token MỘT lần lúc đăng nhập rồi cấp phiên của chính nó: token = payload.HMAC (vl_sso.py, khoá
# riêng <PREFIX>_SESSION_SECRET — không có thì ngẫu nhiên mỗi lần chạy), verify không gọi mạng.
#   - trình duyệt: cookie `vl_sso` (host-only, HttpOnly) hoặc header `Authorization: Bearer <token phiên>`
# Còn nhận cookie SSO auth.luuvie.site khi đặt VL_SSO_SECRET (như FishLevel).
# DEV (<PREFIX>_DEV=1): header X-Dev-User (hoặc ?dev_user= cho SSE).
import os
import re
import secrets
import threading
from urllib.parse import quote

from fastapi import Request

from . import bihub, vl_sso
from .config import Settings
from .errors import ApiError

SESSION_TTL = 7 * 24 * 3600
EMAIL_RE = re.compile(r"[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+")


class Auth:
    def __init__(self, s: Settings):
        self.s = s
        self._allow: set[str] = set()
        self._allow_mtime: float | None = None
        self._lock = threading.Lock()
        self.key = s.session_secret.encode() or secrets.token_bytes(32)

    def login_url(self, next_url: str) -> str:
        if bihub.configured(self.s):
            return f"{self.s.public_base}/bi/login?next={quote(next_url, safe='')}"
        return f"{self.s.sso_login_url}?next={quote(next_url, safe='')}"

    def issue(self, email: str) -> str:
        return vl_sso.sign(email, max_age=SESSION_TTL, key=self.key)

    def require_allowed(self, email: str) -> None:
        if not self._allowed(email):
            raise ApiError(403, f"{email} không có quyền dùng {self.s.tool_name} — nhờ admin thêm vào allowlist")

    def _allowed(self, email: str) -> bool:
        """Có <PREFIX>_ALLOWLIST: đọc lại theo mtime, thiếu file = chặn hết. Không cấu hình: mọi email @allowed_domain."""
        if not EMAIL_RE.fullmatch(email):
            return False
        path = self.s.allowlist_path
        if not path:
            dom = self.s.allowed_domain
            return not dom or email.split("@")[1] == dom
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return False
        with self._lock:
            if mtime != self._allow_mtime:
                lines = open(path, encoding="utf-8").read().splitlines()
                self._allow = {l.split("#")[0].strip().lower() for l in lines} - {""}
                self._allow_mtime = mtime
            return email in self._allow

    def token_of(self, request: Request) -> str:
        h = request.headers.get("authorization") or ""
        if h.lower().startswith("bearer "):
            return h[7:].strip()
        return request.cookies.get(vl_sso.COOKIE_NAME) or ""

    def identify(self, request: Request) -> str:
        email = None
        if self.s.dev:
            email = request.headers.get("x-dev-user") or request.query_params.get("dev_user")
            email = (email or "").strip().lower() or None
        if email is None:
            token = self.token_of(request)
            email = vl_sso.verify(token, self.key)
            if not email and self.s.sso_secret:
                email = vl_sso.verify(token, self.s.sso_secret.encode())
            if not email:
                raise ApiError(401, "Chưa đăng nhập hoặc phiên đã hết hạn",
                               login_url=self.login_url(self.s.public_base + "/app/"),
                               bi_login=bihub.configured(self.s), dev=self.s.dev)
        self.require_allowed(email)
        return email
