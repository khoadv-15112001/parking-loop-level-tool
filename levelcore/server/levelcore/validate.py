# Kiểm level bằng đúng validator JS của app (module game: GamePlugin.validator_module) qua node — một nguồn luật
# cho app và server.
import json
import subprocess

from .errors import ApiError


def validate_levels(s, items: list[dict]) -> list[dict]:
    """items: [{"level": obj, "levelNo": int}] -> [{"isValid", "errors", "warnings"}] cùng thứ tự."""
    if not items:
        return []
    try:
        p = subprocess.run([s.node_bin, s.validate_runner, s.validator_module],
                           input=json.dumps(items, ensure_ascii=False).encode("utf-8"), capture_output=True, timeout=120)
    except FileNotFoundError:
        raise ApiError(500, f"Không chạy được node ('{s.node_bin}') để kiểm level — cài Node.js hoặc đặt {s.var('NODE')}")
    except subprocess.TimeoutExpired:
        raise ApiError(504, "Kiểm level quá lâu")
    if p.returncode != 0:
        raise ApiError(500, f"validate_runner lỗi: {p.stderr.decode('utf-8', 'replace')[:500]}")
    return json.loads(p.stdout.decode("utf-8"))
