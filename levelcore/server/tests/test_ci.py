"""Phần hợp đồng CI không gọi được qua HTTP từ test hợp đồng (cần chỉnh đồng hồ) và giao diện riêng của game (manifest
"app"). Luồng CI đầy đủ nằm ở levelcore/contracts/v1/game.test.mjs, chạy với cả hai server."""
import io
import json
import zipfile

from fastapi.testclient import TestClient

from levelcore import clock
from levelcore.app import create_app
from levelcore.config import Settings
from levelcore.plugin import GamePlugin
from test_manifest import SAMPLE

TOKEN = {"Authorization": "Bearer ci-test-token"}


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _client(tmp_path, game):
    s = Settings.for_game(game, db_path=str(tmp_path / "t.db"), dev=True, admins=["a@sonat.vn"],
                          game_dir=str(tmp_path / "game"), ci_token="ci-test-token", ci_branch="main")
    app = create_app(game, s)
    return app, TestClient(app, headers={"X-Dev-User": "a@sonat.vn"})


def test_ci_levels_dropped_after_two_hours_without_player(tmp_path):
    app, c = _client(tmp_path, GamePlugin.from_manifest(SAMPLE))
    with c:
        body = _zip({"1.json": json.dumps({"level": 1, "time": 5, "items": ["gem"]})})
        r = c.post("/api/ci/levels?by=jenkins-7", content=body, headers=TOKEN)
        assert r.status_code == 200 and r.json()["status"] == "waiting"
        clock.advance(2 * 3600 + 1)
        rec = c.get("/api/game/builds").json()["levels"][0]
        assert rec["status"] == "dropped" and "2 giờ" in rec["detail"]["reason"]
        player = _zip({"index.html": "x", "Build/p.loader.js": "l"})
        p = c.post("/api/ci/webgl?by=jenkins-7&branch=main&buildNumber=7", content=player, headers=TOKEN)
        assert p.json()["status"] == "current" and p.json()["levels"] is None
        assert c.get("/api/packs/develop/levels/1").status_code == 404
    app.state.db.close()


def test_game_app_replaces_core_shell_and_core_modules_stay_importable(tmp_path):
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "rules.mjs").write_text((SAMPLE.parent / "web" / "rules.mjs").read_text(encoding="utf-8"),
                                               encoding="utf-8")
    (tmp_path / "ui").mkdir()
    (tmp_path / "ui" / "index.html").write_text("<html>game ui</html>", encoding="utf-8")
    manifest = json.loads(SAMPLE.read_text(encoding="utf-8"))
    (tmp_path / "manifest.json").write_text(json.dumps({**manifest, "app": "ui"}), encoding="utf-8")
    app, c = _client(tmp_path, GamePlugin.from_manifest(tmp_path / "manifest.json"))
    with c:
        assert c.get("/app/").text == "<html>game ui</html>"
        core = c.get("/core/js/api.mjs")
        assert core.status_code == 200 and "setStoragePrefix" in core.text
        assert "Content-Security-Policy" in core.headers
    app.state.db.close()
