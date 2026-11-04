"""Hợp đồng giữa level-tool-core và game: mỗi repo tool của một game cung cấp package `gameplugin` (thư mục
game/server/gameplugin/) có biến `GAME = GamePlugin(...)`. Core (store, levelhub, app) chỉ gọi game qua đây.

Core đọc plugin ở `levelcore.main.get_app()` (biến môi trường LEVELCORE_GAME_MODULE đổi tên module, mặc định
"gameplugin"). Test của core dùng game mẫu ở levelcore/server/tests/sample_game.

Game mới không cần Python: khai game/manifest.json và viết luật bằng một module JS (`GamePlugin.from_manifest`), dùng
được cho cả server Python lẫn server Node (levelcore/node).
"""
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


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
    # ── game khai bằng manifest ──
    format_version: int | None = None    # ghi vào mỗi revision mới (revisions.meta.format); None = không ghi
    web_dir: str = ""                    # thư mục module web của game; rỗng = game/web của repo
    rules: Any = None                    # JsRules chạy module luật JS (from_manifest); None = plugin Python
    from_manifest_file: bool = False     # game mới: <PREFIX>_ADMINS rỗng không cấp quyền admin cho ai

    @classmethod
    def from_manifest(cls, path: str | os.PathLike) -> "GamePlugin":
        """Game chỉ có manifest + module luật JS. Hook thiếu trong module thì dùng mặc định của core."""
        from .jsgame import JsRules

        path = Path(path).resolve()
        m = json.loads(path.read_text(encoding="utf-8"))
        for k in ("tool", "game", "prefix", "rules"):
            if not m.get(k):
                raise RuntimeError(f"{path}: thiếu trường '{k}'")
        base = path.parent
        rules_path = (base / m["rules"]).resolve()
        js = JsRules(rules_path, node=os.environ.get(f"{m['prefix']}_NODE", "node"))

        def level_summary(level):
            found, v = js.one("levelSummary", level)
            return v if found and isinstance(v, dict) else {}

        def level_changes(prev, cur):
            found, v = js.one("levelChanges", prev, cur)
            return v if found else _no_changes(prev, cur)

        def set_level_number(level, n):
            found, v = js.one("setLevelNumber", level, n)
            if found and isinstance(v, dict):
                level.clear()
                level.update(v)

        hub = None
        if m.get("levelhub"):
            h = m["levelhub"]

            def describe(level, n):
                found, v = js.one("describeHub", level, n)
                return v if found and isinstance(v, dict) else {}

            def layout(level):
                found, v = js.one("hubLayout", level)
                return str(v or "") if found else ""

            hub = LevelHubSpec(acronym=h["acronym"], obstacle_codes=tuple(tuple(x) for x in h.get("obstacleCodes", ())),
                               describe=describe, layout=layout)
        return cls(tool_name=m["tool"], game_name=m["game"], env_prefix=m["prefix"], validator_module=str(rules_path),
                   level_summary=level_summary, level_changes=level_changes, set_level_number=set_level_number,
                   default_packs=tuple(m.get("defaultPacks") or ("develop", "product")), bi_app_id=m.get("biAppId", ""),
                   levelhub=hub, format_version=m.get("formatVersion"),
                   web_dir=str((base / m["web"]).resolve()) if m.get("web") else "", rules=js, from_manifest_file=True)
