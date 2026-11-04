# Cấu hình đọc từ biến môi trường <PREFIX>_* (PREFIX = GamePlugin.env_prefix, vd HOLELEVEL) — xem levelcore/README.md.
# Trên BI Center: biến SBP_* là mặc định, biến <PREFIX>_* (nếu đặt) thắng. Local không có SBP_* → mặc định bên dưới.
import os
from dataclasses import dataclass, field
from pathlib import Path

CORE = Path(__file__).resolve().parents[2]     # thư mục levelcore/
REPO = CORE.parent                             # gốc repo tool của game (levelcore/ + game/ là anh em)
DATA = REPO / "data"                           # dữ liệu local (gitignore): database DEV, bản game WebGL


def _bool(v: str | None) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    # ── tên (từ GamePlugin) ──
    tool_name: str = "LevelTool"
    env_prefix: str = "LEVELTOOL"
    # ── server ──
    db_path: str = str(DATA / "leveltool.db")
    dev: bool = False                      # <PREFIX>_DEV=1: nhận header X-Dev-User
    sso_secret: str = ""                   # VL_SSO_SECRET — cùng khoá với auth.luuvie.site (vlauth)
    sso_login_url: str = "https://auth.luuvie.site/login"
    public_base: str = "http://127.0.0.1:8880"
    web_root: str = ""                     # thư mục chứa levelcore/web + game/web; rỗng = chính repo này
    allowlist_path: str = ""               # file email (mỗi dòng 1, # comment); rỗng = mọi @allowed_domain
    allowed_domain: str = "sonat.vn"       # chặn thêm ở server (rỗng = bỏ qua)
    lock_ttl: int = 600                    # giây không heartbeat thì khoá tự hết
    sse_heartbeat: float = 25.0            # comment ": ping" giữ kết nối
    node_bin: str = "node"
    validate_runner: str = str(CORE / "runner" / "validate_runner.mjs")
    validator_module: str = ""             # module JS validateLevel của game (GamePlugin.validator_module, từ gốc repo)
    default_packs: list = field(default_factory=lambda: ["develop", "product"])
    admins: list = field(default_factory=list)   # email được phá khoá người khác / đổi cờ bộ
    admins_open: bool = True               # danh sách admin rỗng = mọi người (plugin Python cũ); game manifest: chỉ DEV
    cors_origins: list = field(default_factory=list)
    # Đăng nhập Google của BI (Firebase) + BI Level Hub. Dev và prod của BI tách biệt:
    # API URL, Firebase project và appId phải CÙNG môi trường. Firebase Web App config là công khai.
    session_secret: str = ""               # khoá ký phiên (rỗng = ngẫu nhiên mỗi lần chạy → khởi động lại là phải đăng nhập lại)
    bi_env: str = "dev"
    bi_api_url: str = ""                   # vd https://bi-be-dev.sonatgame.com
    bi_app_id: str = ""                    # app Android trên BI (mã OS "A" trong tên bộ) — mặc định GamePlugin.bi_app_id
    bi_app_id_ios: str = ""                # app iOS trên BI (mã "I") — BI tách appId theo nền tảng; trống = khoá đẩy bộ iOS
    bi_firebase_api_key: str = ""
    bi_firebase_auth_domain: str = ""
    bi_firebase_project_id: str = ""
    bi_firebase_app_id: str = ""
    # Bản game WebGL playtest phục vụ ở /game/ để xem / chơi thử level đang sửa
    game_dir: str = str(DATA / "game")
    version: str = "dev"                   # SBP_VERSION trên BI Center = tag phát hành
    format_version: int | None = None      # GamePlugin.format_version: ghi vào revision mới, đưa cho validator
    game_web: str = ""                     # GamePlugin.web_dir: module web của game (rỗng = <web_root>/game/web)

    @classmethod
    def for_game(cls, game, **kw) -> "Settings":
        """Settings mặc định theo plugin (tên, tiền tố, validator, bộ mặc định, app BI) — test dùng trực tiếp."""
        s = cls(tool_name=game.tool_name, env_prefix=game.env_prefix,
                db_path=str(DATA / f"{game.tool_name.lower()}.db"),
                validator_module=str(REPO / game.validator_module), default_packs=list(game.default_packs),
                bi_app_id=game.bi_app_id, admins_open=not game.from_manifest_file,
                format_version=game.format_version, game_web=game.web_dir)
        for k, v in kw.items():
            setattr(s, k, v)
        return s

    @classmethod
    def from_env(cls, game) -> "Settings":
        s = cls.for_game(game)
        p = game.env_prefix
        e = lambda k, d=None: os.environ.get(f"{p}_{k}", d)   # noqa: E731
        sbp = os.environ.get
        data_dir = sbp("SBP_DATA_DIR")   # volume BI Center / Docker (mặc định data/ của repo)
        default_db = str(Path(data_dir) / Path(s.db_path).name) if data_dir else s.db_path
        s.db_path = e("DB") or sbp("SBP_SQLITE_PATH") or default_db
        s.dev = _bool(e("DEV"))
        s.sso_secret = sbp("VL_SSO_SECRET", "")
        s.sso_login_url = e("SSO_LOGIN_URL", s.sso_login_url)
        s.public_base = (e("PUBLIC_BASE") or sbp("SBP_TOOL_URL") or s.public_base).rstrip("/")
        s.web_root = e("WEB_ROOT", "")
        s.allowlist_path = e("ALLOWLIST", "")
        s.allowed_domain = e("ALLOWED_DOMAIN", s.allowed_domain)
        s.lock_ttl = int(e("LOCK_TTL", s.lock_ttl))
        s.sse_heartbeat = float(e("SSE_HEARTBEAT", s.sse_heartbeat))
        s.node_bin = e("NODE", s.node_bin)
        s.admins = [a.strip().lower() for a in e("ADMINS", "").split(",") if a.strip()]
        s.session_secret = e("SESSION_SECRET", "")
        s.bi_env = e("BI_ENV", s.bi_env)
        s.bi_api_url = e("BI_API_URL", "")
        s.bi_app_id = e("BI_APP_ID", s.bi_app_id)
        s.bi_app_id_ios = e("BI_APP_ID_IOS", "")
        s.bi_firebase_api_key = e("BI_FIREBASE_API_KEY", "")
        s.bi_firebase_auth_domain = e("BI_FIREBASE_AUTH_DOMAIN", "")
        s.bi_firebase_project_id = e("BI_FIREBASE_PROJECT_ID", "")
        s.bi_firebase_app_id = e("BI_FIREBASE_APP_ID", "")
        s.version = sbp("SBP_VERSION") or s.version
        s.game_dir = e("GAME_DIR") or (str(Path(data_dir) / "game") if data_dir else s.game_dir)
        if e("CORS_ORIGINS"):
            s.cors_origins = [o.strip() for o in e("CORS_ORIGINS").split(",") if o.strip()]
        return s

    def var(self, name: str) -> str:
        """Tên biến môi trường đầy đủ cho thông báo lỗi / hướng dẫn: var("BI_APP_ID_IOS") → HOLELEVEL_BI_APP_ID_IOS."""
        return f"{self.env_prefix}_{name}"

    def web_root_dir(self) -> Path:
        """Thư mục chứa levelcore/web + game/web: cấu hình (Docker) hoặc chính repo (dev / test)."""
        return Path(self.web_root) if self.web_root else REPO

    def game_web_dir(self) -> Path:
        return Path(self.game_web) if self.game_web else self.web_root_dir() / "game" / "web"

    def is_admin(self, email: str) -> bool:
        if self.admins:
            return email.lower() in self.admins
        return self.admins_open or self.dev
