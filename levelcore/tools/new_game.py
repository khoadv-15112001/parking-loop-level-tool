"""Lệnh cũ để tạo phần riêng của game, giữ cho quen tay: gọi sang levelcore/tools/new_game.mjs với server Python.

    py levelcore/tools/new_game.py --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort [--storage fl]

Cần Node.js (luật level của game là JS, server Python cũng chạy luật qua node). Game chọn server Node thì gọi thẳng
`node levelcore/tools/new_game.mjs ... --runtime node`.
"""
import os
import subprocess
import sys
from pathlib import Path

CORE = Path(__file__).resolve().parents[1]


def main() -> int:
    args = [a for a in sys.argv[1:]]
    if "--runtime" not in args:
        args += ["--runtime", "python"]
    node = os.environ.get("NODE", "node")
    try:
        return subprocess.run([node, str(CORE / "tools" / "new_game.mjs"), *args]).returncode
    except FileNotFoundError:
        print("Cần Node.js >= 22.13 (lệnh node) — https://nodejs.org", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
