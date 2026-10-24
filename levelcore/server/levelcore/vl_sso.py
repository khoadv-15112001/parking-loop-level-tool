#!/usr/bin/env python3
"""Cookie SSO dùng chung cho các trang *.luuvie.site — chỉ stdlib.

Cookie `vl_sso` = base64url(payload_json) + "." + base64url(HMAC-SHA256).
Payload: {"email": ..., "iat": ..., "exp": ...}. Chỉ vlauth (auth.luuvie.site)
ký cookie; mọi app khác chỉ VERIFY bằng cùng VL_SSO_SECRET — không app nào cần
gọi mạng để biết ai đang đăng nhập.
"""
import base64
import hashlib
import hmac
import json
import os
import time

COOKIE_NAME = "vl_sso"
COOKIE_DOMAIN = ".luuvie.site"
MAX_AGE = 30 * 24 * 3600  # 30 ngày


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


ENV_FILE = os.environ.get("VL_SSO_ENV_FILE", os.path.expanduser("~/Sync/vlauth/.env"))


def secret() -> bytes:
    """Khoá ký, lấy từ env VL_SSO_SECRET; nếu không có thì đọc file .env của
    vlauth (các service chạy bằng LaunchAgent không có env nào cả). Thiếu cả hai
    thì raise — không bao giờ có khoá mặc định."""
    s = os.environ.get("VL_SSO_SECRET", "")
    if not s:
        try:
            for line in open(ENV_FILE, encoding="utf-8"):
                k, _, v = line.strip().partition("=")
                if k == "VL_SSO_SECRET":
                    s = v.strip().strip('"\'')
                    break
        except OSError:
            pass
    if not s:
        raise RuntimeError("VL_SSO_SECRET chưa set (env hoặc %s) — từ chối chạy." % ENV_FILE)
    return s.encode()


def sign(email: str, max_age: int = MAX_AGE, key: bytes = None) -> str:
    key = key or secret()
    now = int(time.time())
    payload = _b64e(json.dumps({"email": email, "iat": now, "exp": now + max_age}).encode())
    sig = _b64e(hmac.new(key, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify(token: str, key: bytes = None) -> str:
    """→ email nếu chữ ký đúng và chưa hết hạn, ngược lại "" (không raise)."""
    if not token or "." not in token:
        return ""
    try:
        key = key or secret()
        payload, _, sig = token.partition(".")
        expect = _b64e(hmac.new(key, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            return ""
        data = json.loads(_b64d(payload))
        if int(data.get("exp", 0)) < time.time():
            return ""
        return str(data.get("email", "")).strip().lower()
    except (ValueError, TypeError, RuntimeError):
        return ""


def from_cookie_header(header: str, key: bytes = None) -> str:
    """Đọc thẳng email từ header `Cookie:` của request."""
    for part in (header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE_NAME:
            return verify(v, key)
    return ""
