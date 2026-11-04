"""levelcore/template + tools/new_game.py (lệnh cũ, gọi new_game.mjs với server Python): game mới chạy được ngay trên
server Python với giao diện mặc định của core."""
import subprocess
import sys
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from levelcore.app import create_app
from levelcore.config import Settings
from levelcore.plugin import GamePlugin

CORE = Path(__file__).resolve().parents[2]


def test_new_game_py_scaffolds_a_python_runtime_game(tmp_path):
    repo = tmp_path / "fishlevel"
    repo.mkdir()
    r = subprocess.run([sys.executable, str(CORE / "tools" / "new_game.py"), "--tool", "FishLevel", "--game", "Fish Sort",
                        "--prefix", "FISHLEVEL", "--slug", "fishsort", "--repo", str(repo)],
                       capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout + r.stderr
    text = "".join(p.read_text(encoding="utf-8") for p in repo.rglob("*") if p.is_file())
    assert "__" + "TOOL__" not in text and "__" + "PREFIX__" not in text
    assert not list((repo / "game").rglob("game.mjs")) and not list((repo / "game").rglob("*.css"))
    bi = yaml.safe_load((repo / "bi.yaml").read_text(encoding="utf-8"))
    assert bi["slug"] == "fishsort" and bi["env"]["FISHLEVEL_ADMINS"]["required"] is True
    assert bi["components"][0]["build"]["dockerfile"] == "levelcore/deploy/Dockerfile"
    assert bi["components"][0]["database"]["file"] == "fishlevel.db"
    assert "RUNTIME=python" in (repo / "game" / "game.env").read_text(encoding="utf-8")

    game = GamePlugin.from_manifest(repo / "game" / "manifest.json")
    app = create_app(game, Settings.for_game(game, db_path=str(tmp_path / "t.db"), dev=True, game_dir=str(tmp_path / "g")))
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        page = c.get("/app/game/game.mjs")
        assert page.status_code == 200 and "import * as rules from './rules.mjs'" in page.text
        assert page.headers["content-type"].startswith("text/javascript")
        assert c.get("/app/game/manifest.json").json()["tool"] == "FishLevel"
        assert c.get("/app/game/rules.mjs").status_code == 200
        assert c.get("/app/game/game.css").text == ""
        assert c.get("/app/game/releases.json").json()[0]["version"] == "0.1.0"
        assert c.post("/api/packs/develop/levels/1", json={"grid": [[1, 0], [0, 1]]}).status_code == 201
    app.state.db.close()
    game.rules.close()
