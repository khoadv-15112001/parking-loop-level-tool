from pathlib import Path

from .errors import ApiError

STORAGE_LIMIT = 1_500_000_000
STORAGE_WARNING = 1_200_000_000
STORAGE_RESERVE = 100_000_000
BUILD_BUDGET = 800_000_000


def disk_bytes(file):
    file = Path(file)
    if file.is_symlink() or not file.exists():
        return 0
    if file.is_dir():
        return sum(disk_bytes(child) for child in file.iterdir())
    return file.stat().st_size


def storage_roots(s):
    game = Path(s.game_dir)
    return [Path(s.db_path).parent, game, *(game.with_name(game.name + suffix) for suffix in (".builds", ".uploads", ".ci"))]


def storage_usage(s):
    counted = []
    total = 0
    for root in sorted(set(path.resolve() for path in storage_roots(s)), key=lambda path: len(path.parts)):
        if any(root.is_relative_to(parent) for parent in counted):
            continue
        counted.append(root)
        total += disk_bytes(root)
    return total


def require_storage(s, additional):
    if storage_usage(s) + additional + STORAGE_RESERVE > STORAGE_LIMIT:
        raise ApiError(507, "Dung lượng gần giới hạn 1,5 GB; dọn bản game cũ hoặc chuyển dữ liệu lưu trữ trước khi thử lại.")
