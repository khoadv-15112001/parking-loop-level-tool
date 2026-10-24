"""Hợp đồng giữa level-tool-core và game: mỗi repo tool của một game cung cấp package `gameplugin` (thư mục
game/server/gameplugin/) có biến `GAME = GamePlugin(...)`. Core (store, levelhub, app) chỉ gọi game qua đây.

Core đọc plugin ở `levelcore.main.get_app()` (biến môi trường LEVELCORE_GAME_MODULE đổi tên module, mặc định
"gameplugin"). Test của core dùng game mẫu ở levelcore/server/tests/sample_game.
"""
from dataclasses import dataclass, field
from typing import Callable


def _no_summary(level) -> dict:
    return {}


def _no_changes(prev, cur) -> list[str] | None:
    return None if not isinstance(prev, dict) or not isinstance(cur, dict) else []


def _keep_number(level, n) -> None:
    pass


@dataclass
class LevelHubSpec:
    """Phần riêng của game trong gói Level Hub (package com.sonat.level.build): acronym trên BI, mã vật cản, và hàm
    mô tả một level → các trường tự động của dòng metadata."""
    acronym: str
    # ((khoá đếm trong describe, mã in ra obstacleInfos), …) — thứ tự = thứ tự in
    obstacle_codes: tuple = ()
    # describe(level_json, level_number) -> {"mechanics", "difficulty", "uniqueColor", "totalBlock", "time",
    #                                        "obstacleCounts": {khoá: số}}
    describe: Callable[[dict, int], dict] | None = None
    layout: Callable[[dict], str] | None = None


@dataclass
class GamePlugin:
    # ── tên ──
    tool_name: str                       # "HoleLevel" — hiện trong UI, lỗi, log
    game_name: str                       # "Frenzy Hole"
    env_prefix: str                      # "HOLELEVEL" → HOLELEVEL_DB, HOLELEVEL_BI_* …
    # ── level ──
    validator_module: str                # đường dẫn (từ gốc repo) tới module JS có validateLevel(level, {levelNo})
    level_summary: Callable[[dict], dict] = _no_summary          # tóm tắt cho danh sách (cột levels.summary)
    level_changes: Callable[[dict, dict], list | None] = _no_changes   # "đã sửa gì" giữa 2 bản (Lịch sử / Audit)
    # ghi số level vào chính nội dung khi đổi số / chép sang số khác (vd Hole: levelConfig.Level = n); sửa tại chỗ
    set_level_number: Callable[[dict, int], None] = _keep_number
    default_packs: tuple = ("develop", "product")                # tạo khi DB trống; "product" = production
    # ── BI / Level Hub ──
    bi_app_id: str = ""                  # app Android trên BI (mặc định của <PREFIX>_BI_APP_ID)
    levelhub: LevelHubSpec | None = None
    # ── khác ──
    extra: dict = field(default_factory=dict)
