"""Tạo phần riêng của game cho repo tool vừa fork từ level-tool-core: chép levelcore/template/ ra gốc repo
(game/, bi.yaml, README.md) rồi thay tên.

    py levelcore/tools/new_game.py --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort [--storage fl]

Không ghi đè: dừng nếu game/ đã có (README.md / bi.yaml có sẵn thì giữ, in ra để tự sửa).
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

CORE = Path(__file__).resolve().parents[1]
TEMPLATE = CORE / "template"


def scaffold(repo: Path, tool: str, game: str, prefix: str, slug: str, storage: str) -> list[str]:
    if (repo / "game").exists():
        raise SystemExit(f"{repo / 'game'} đã có — không ghi đè")
    subs = {"__TOOL__": tool, "__GAME__": game, "__PREFIX__": prefix, "__SLUG__": slug, "__STORAGE__": storage,
            "__DBFILE__": f"{tool.lower()}.db"}
    kept = []
    for src in sorted(TEMPLATE.rglob("*")):
        if src.is_dir() or "__pycache__" in src.parts:
            continue
        dst = repo / src.relative_to(TEMPLATE)
        if dst.exists():
            kept.append(str(dst.relative_to(repo)))
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        text = src.read_text(encoding="utf-8")
        for k, v in subs.items():
            text = text.replace(k, v)
        dst.write_text(text, encoding="utf-8", newline="\n")
    return kept


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tool", required=True, help="tên tool, vd FishLevel")
    ap.add_argument("--game", required=True, help="tên game, vd 'Fish Sort'")
    ap.add_argument("--prefix", required=True, help="tiền tố biến môi trường, vd FISHLEVEL")
    ap.add_argument("--slug", required=True, help="slug BI Center (chữ thường, gạch nối), vd fishsort")
    ap.add_argument("--storage", help="tiền tố localStorage (mặc định = prefix viết thường)")
    ap.add_argument("--repo", default=str(CORE.parent), help="gốc repo tool (mặc định: repo chứa levelcore/)")
    a = ap.parse_args()
    if not re.fullmatch(r"[A-Z][A-Z0-9]*", a.prefix):
        ap.error("--prefix chỉ gồm chữ HOA / số, vd FISHLEVEL")
    if not re.fullmatch(r"[a-z][a-z0-9]*(-[a-z0-9]+)*", a.slug):
        ap.error("--slug chỉ gồm chữ thường / số / gạch nối")
    kept = scaffold(Path(a.repo), a.tool, a.game, a.prefix, a.slug, a.storage or a.prefix.lower())
    print(f"Đã tạo game/ cho {a.tool}.")
    for k in kept:
        print(f"  giữ nguyên {k} (đã có) — so với levelcore/template/{k} rồi tự sửa")
    print("Tiếp: sửa game/server/gameplugin + game/web/schema.mjs, rồi bấm đúp ChayDev.bat.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
