"""Cài bản game WebGL playtest vào server local (không qua HTTP).

    py levelcore/tools/install_game.py [zip]      # mặc định GamePlugin.extra["playtest_zip"] (từ gốc repo)

Giải nén vào <PREFIX>_GAME_DIR (mặc định data/game) — server đang chạy phục vụ ngay ở /game/, không cần khởi động lại.
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "levelcore" / "server"), str(REPO / "game" / "server")]
sys.stdout.reconfigure(encoding="utf-8")

from levelcore import webgame  # noqa: E402
from levelcore.config import Settings  # noqa: E402
from levelcore.errors import ApiError  # noqa: E402
from levelcore.main import load_game  # noqa: E402

game = load_game()
default = game.extra.get("playtest_zip")
if len(sys.argv) < 2 and not default:
    sys.exit("Cách dùng: py levelcore/tools/install_game.py <zip>")
zip_path = Path(sys.argv[1]) if len(sys.argv) > 1 else (REPO / default).resolve()
s = Settings.from_env(game)
try:
    out = webgame.install_zip(s, zip_path, "install_game.py", zip_path.name)
except ApiError as e:
    sys.exit(f"Lỗi: {e.body.get('detail', e)}")
print(f"Đã cài {zip_path} → {s.game_dir} ({out})")
