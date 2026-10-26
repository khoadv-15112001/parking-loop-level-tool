"""Game mẫu cho test của level-tool-core — cũng là ví dụ tối thiểu một game/server/gameplugin phải khai báo.
Level: {"level": n, "time": giây, "items": ["rock", "gem", …]}."""
from levelcore.plugin import GamePlugin, LevelHubSpec


def summary(level: dict) -> dict:
    return {"time": level.get("time"), "items": len(level.get("items") or [])}


def changes(prev, cur):
    if not isinstance(prev, dict) or not isinstance(cur, dict):
        return None
    out = [f"{k}: {prev.get(k)} → {cur.get(k)}" for k in ("time",) if prev.get(k) != cur.get(k)]
    if prev.get("items") != cur.get("items"):
        out.append("items")
    return out


def set_number(level: dict, n: int) -> None:
    level["level"] = n


def describe(level: dict, n: int) -> dict:
    items = level.get("items") or []
    return {"mechanics": "M01", "difficulty": n % 3, "uniqueColor": len(set(items)), "totalBlock": len(items),
            "time": level.get("time") or 0, "obstacleCounts": {"Rock": items.count("rock")}}


def level(n: int, time: int = 60, items=("gem", "rock")) -> dict:
    return {"level": n, "time": time, "items": list(items)}


GAME = GamePlugin(tool_name="SampleLevel", game_name="Sample", env_prefix="SAMPLELEVEL",
                  validator_module="levelcore/server/tests/sample_game/schema.mjs",
                  level_summary=summary, level_changes=changes, set_level_number=set_number, bi_app_id="com.sample.game",
                  levelhub=LevelHubSpec(acronym="Sample", obstacle_codes=(("Rock", "RK"),), describe=describe))
