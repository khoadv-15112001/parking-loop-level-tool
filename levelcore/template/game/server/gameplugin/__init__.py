"""Plugin __TOOL__ cho level-tool-core — xem levelcore/server/levelcore/plugin.py (mọi trường + ý nghĩa).

Bắt đầu: sửa level_summary / level_changes / set_level_number theo định dạng level của game, viết validator ở
game/web/schema.mjs, rồi (nếu đẩy Level Hub) khai báo levelhub=LevelHubSpec(...). Ví dụ đầy đủ: HoleLevel (game/server/gameplugin).
"""
from levelcore.plugin import GamePlugin


def level_summary(level: dict) -> dict:
    """Vài số cho danh sách level (cột summary) — game/web/game.mjs listItem() vẽ ra badge."""
    return {"keys": len(level)}


def level_changes(prev, cur):
    """"Đã sửa gì" giữa 2 bản (Lịch sử / Audit). None = không so được (tạo / xoá)."""
    if not isinstance(prev, dict) or not isinstance(cur, dict):
        return None
    return [f"{k}" for k in sorted(set(prev) | set(cur)) if prev.get(k) != cur.get(k)]


def set_level_number(level: dict, n: int) -> None:
    """Ghi số level vào nội dung khi đổi số / promote sang số khác (bỏ trống nếu level không chứa số của nó)."""


GAME = GamePlugin(
    tool_name="__TOOL__",
    game_name="__GAME__",
    env_prefix="__PREFIX__",
    validator_module="game/web/schema.mjs",
    level_summary=level_summary,
    level_changes=level_changes,
    set_level_number=set_level_number,
    bi_app_id="",            # app Android trên BI Level Hub (vd com.company.game)
    levelhub=None,           # LevelHubSpec(acronym=..., obstacle_codes=..., describe=...) để xuất / đẩy Level Hub
)
