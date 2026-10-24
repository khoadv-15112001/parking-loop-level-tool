"""levelcore/template + tools/new_game.py: game mới tạo ra chạy được ngay (test của chính nó xanh)."""
import os
import subprocess
import sys
from pathlib import Path

import yaml

CORE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(CORE / "tools"))
import new_game  # noqa: E402

def test_scaffold_runs_its_own_tests(tmp_path):
    repo = tmp_path / "fishlevel"
    (repo / "levelcore").mkdir(parents=True)
    kept = new_game.scaffold(repo, "FishLevel", "Fish Sort", "FISHLEVEL", "fishsort", "fl")
    assert kept == []
    text = "".join(p.read_text(encoding="utf-8") for p in repo.rglob("*") if p.is_file())
    assert "__" + "TOOL__" not in text and "__" + "PREFIX__" not in text
    bi = yaml.safe_load((repo / "bi.yaml").read_text(encoding="utf-8"))
    assert bi["slug"] == "fishsort" and "FISHLEVEL_BI_APP_ID" in bi["env"]
    assert bi["components"][0]["database"]["file"] == "fishlevel.db"
    # test của game mới, chạy với core thật (REPO trỏ repo tạm: validator_module = game/web/schema.mjs của game mới)
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(CORE / "server"), str(repo / "game" / "server")])}
    code = ("import sys, pytest; from levelcore import config; from pathlib import Path; "
            f"config.REPO = Path(r'{repo}'); sys.exit(pytest.main(['-q', '-p', 'no:cacheprovider', r'{repo / 'game' / 'server' / 'tests'}']))")
    r = subprocess.run([sys.executable, "-c", code], cwd=repo / "game" / "server", env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
