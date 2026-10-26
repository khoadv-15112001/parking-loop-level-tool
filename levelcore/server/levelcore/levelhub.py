"""Xuất gói Level Hub (package com.sonat.level.build 0.4.0): zip `LevelMetadata.json` + `Raw/<n>.json`.
Phần chung mọi game ở đây; phần riêng (acronym BI, mã vật cản, hàm mô tả level → mechanics/difficulty/…) do game
khai báo ở GamePlugin.levelhub (LevelHubSpec) — store.game.levelhub.

- Tên zip: {Game}_{OS}_{FromLv}_{ToLv}_{GEO}_{Why}_{Designer}_{Date ddMM}_{Ver}.zip (đoạn rỗng vẫn giữ dấu _).
- Mỗi dòng metadata: game, os, team, designer, version, level, mechanics, difficulty, layout, uniqueColor, totalBlock,
  obstacleInfos, time, date (ddMMyy giờ VN), geo, why, fromLv, toLv.
"""
import io
import json
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from .errors import ApiError
from .plugin import LevelHubSpec

VN_TZ = timezone(timedelta(hours=7), "ICT")
METADATA_FILE_NAME = "LevelMetadata.json"
RAW_FOLDER = "Raw"
OS_CODES = {"Android": "A", "iOS": "I"}
TEAMS = ("GD", "CM")
WHY_OPTIONS = ("retention", "ftue", "monetization", "rrd7")
GEO_OPTIONS = ("Tier1", "Tier2", "Tier3", "Tier4", "Global")
NO_OBSTACLES = "N0"
FIELD_ORDER = ("game", "os", "team", "designer", "version", "level", "mechanics", "difficulty", "layout", "uniqueColor",
               "totalBlock", "obstacleInfos", "time", "date", "geo", "why", "fromLv", "toLv")
_EMPTY = {"mechanics": "", "difficulty": 0, "uniqueColor": 0, "totalBlock": 0, "time": 0, "obstacleCounts": {}}


class RequestError(ValueError):
    """Tham số xuất sai (400)."""


class ExportBlocked(Exception):
    def __init__(self, reason: str, report: dict):
        super().__init__(reason)
        self.report = report


def spec_of(store) -> LevelHubSpec:
    spec = store.game.levelhub
    if spec is None:
        raise ApiError(400, f"{store.game.tool_name} chưa khai báo Level Hub (GamePlugin.levelhub)")
    return spec


def describe(spec: LevelHubSpec, level: dict, number: int) -> dict:
    """Trường tự động của một level theo game; thiếu khoá nào lấy mặc định rỗng."""
    out = dict(_EMPTY)
    if spec.describe:
        out.update(spec.describe(level, number) or {})
    return out


def obstacle_infos(counts: dict, codes) -> str:
    parts = [f"{code}{counts[key]}" for key, code in codes if counts.get(key, 0) > 0]
    return "".join(parts) if parts else NO_OBSTACLES


def _sanitize(text) -> str:
    return "".join(ch for ch in str(text or "") if ch.isascii() and ch.isalnum())


def normalize_version(value) -> str:
    stripped = _sanitize(value).lstrip("vV")
    return "v" + (stripped or "1")


def join_geo(tags) -> str:
    return "-".join(t for t in (_sanitize(x) for x in tags or []) if t)


def compose_zip_name(acronym, os_name, from_lv, to_lv, geo, why, designer, day: date, version) -> str:
    designer = str(designer or "")
    designer = designer.split("@", 1)[0]
    return "_".join((_sanitize(acronym), os_name, str(int(from_lv)), str(int(to_lv)), join_geo(geo),
                     _sanitize(why), _sanitize(designer), day.strftime("%d%m"), normalize_version(version))) + ".zip"


def _row_date(updated_at: str | None) -> str:
    if updated_at:
        try:
            dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            return dt.astimezone(VN_TZ).strftime("%d%m%y")
        except ValueError:
            pass
    return datetime.now(VN_TZ).strftime("%d%m%y")


@dataclass
class ExportRequest:
    pack: str
    from_lv: int
    to_lv: int
    os_name: str = "Android"
    team: str = "GD"
    designer: str = ""
    why: str = ""
    geo: list = field(default_factory=list)
    version: str = "v1"
    allow_missing: bool = False

    @classmethod
    def parse(cls, pack: str, body: dict) -> "ExportRequest":
        def num(k):
            v = body.get(k)
            if not isinstance(v, int) or isinstance(v, bool) or v < 1:
                raise RequestError(f"{k} phải là số nguyên ≥ 1")
            return v

        req = cls(pack=pack, from_lv=num("from_lv"), to_lv=num("to_lv"))
        if req.from_lv > req.to_lv:
            raise RequestError("from_lv phải ≤ to_lv")
        req.os_name = body.get("os", "Android")
        if req.os_name not in OS_CODES:
            raise RequestError("os phải là Android | iOS")
        req.team = body.get("team", "GD")
        if req.team not in TEAMS:
            raise RequestError(f"team phải là {' | '.join(TEAMS)}")
        for k in ("designer", "why", "version"):
            v = body.get(k, getattr(req, k))
            if not isinstance(v, str) or len(v) > 120:
                raise RequestError(f"{k} phải là chuỗi ≤ 120 ký tự")
            setattr(req, k, v)
        geo = body.get("geo", [])
        if not isinstance(geo, list) or not all(isinstance(g, str) for g in geo):
            raise RequestError("geo phải là mảng chuỗi")
        req.geo = geo
        req.allow_missing = body.get("allow_missing") is True
        return req


def preflight(store, req: ExportRequest, today: date | None = None) -> dict:
    """Báo cáo trước khi xuất: level trong dải, level thiếu, lỗi validator, tên zip."""
    bundle = store.bundle(req.pack)
    in_range = [lv for lv in bundle["levels"] if req.from_lv <= lv["level_no"] <= req.to_lv]
    have = {lv["level_no"] for lv in in_range}
    missing = [n for n in range(req.from_lv, req.to_lv + 1) if n not in have]
    spec = spec_of(store)
    vres = store._validate([(lv["name"], lv["level"]) for lv in in_range])
    errors = [{"level": lv["level_no"], "errors": v["errors"][:10]} for lv, v in zip(in_range, vres) if not v["isValid"]]
    rows = []
    for lv in in_range:
        auto = describe(spec, lv["level"], lv["level_no"])
        rows.append({"level": lv["level_no"], "rev": lv["rev"], "mechanics": auto["mechanics"],
                     "difficulty": auto["difficulty"], "time": auto["time"], "uniqueColor": auto["uniqueColor"],
                     "totalBlock": auto["totalBlock"], "obstacleInfos": obstacle_infos(auto["obstacleCounts"], spec.obstacle_codes)})
    day = today or datetime.now(VN_TZ).date()
    return {"zipName": compose_zip_name(spec.acronym, req.os_name, req.from_lv, req.to_lv, req.geo, req.why, req.designer,
                                        day, req.version),
            "levelCount": len(in_range), "missing": missing[:500], "missingTotal": len(missing), "errors": errors,
            "rows": rows, "_levels": in_range}


def to_payload(report: dict) -> dict:
    return {k: v for k, v in report.items() if not k.startswith("_")}


def build_zip(store, req: ExportRequest, today: date | None = None) -> tuple[str, bytes, dict]:
    report = preflight(store, req, today)
    if report["levelCount"] == 0:
        raise ExportBlocked("Không có level nào trong dải", report)
    if report["errors"]:
        raise ExportBlocked(f"{len(report['errors'])} level còn lỗi kiểm định — sửa trước khi xuất", report)
    if report["missingTotal"] and not req.allow_missing:
        raise ExportBlocked(f"Thiếu {report['missingTotal']} level trong dải — xác nhận để xuất", report)
    spec = spec_of(store)
    rows = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for lv in report["_levels"]:
            n = lv["level_no"]
            auto = describe(spec, lv["level"], n)
            values = {"game": spec.acronym, "os": OS_CODES[req.os_name], "team": req.team, "designer": req.designer,
                      "version": normalize_version(req.version), "level": n, "mechanics": auto["mechanics"],
                      "difficulty": auto["difficulty"],
                      "layout": spec.layout(lv["level"]) if spec.layout else "", "uniqueColor": auto["uniqueColor"],
                      "totalBlock": auto["totalBlock"], "obstacleInfos": obstacle_infos(auto["obstacleCounts"], spec.obstacle_codes),
                      "time": auto["time"], "date": _row_date(lv["updated_at"]), "geo": join_geo(req.geo),
                      "why": req.why, "fromLv": req.from_lv, "toLv": req.to_lv}
            rows.append({k: values[k] for k in FIELD_ORDER})
            archive.writestr(f"{RAW_FOLDER}/{n}.json", json.dumps(lv["level"], ensure_ascii=False, indent=2).encode("utf-8"))
        archive.writestr(METADATA_FILE_NAME, json.dumps({"Levels": rows}, indent=4, ensure_ascii=False).encode("utf-8"))
    summary = {"zipName": report["zipName"], "levelCount": report["levelCount"], "missingTotal": report["missingTotal"],
               "manifest": [{"level": lv["level_no"], "rev": lv["rev"], "sha": lv["sha"]} for lv in report["_levels"]]}
    return report["zipName"], buf.getvalue(), summary
