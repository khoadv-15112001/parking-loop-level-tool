"""Luồng chính của core với game mẫu: CRUD + ETag, hook plugin (summary / changes / số level), validator JS qua node,
nhập / xuất, đổi số, đẩy production, Level Hub, env prefix."""
import io
import json
import zipfile
from datetime import date

from fastapi.testclient import TestClient

from conftest import create
from levelcore import levelhub
from levelcore.app import create_app
from levelcore.config import Settings
from levelcore.plugin import GamePlugin
from sample_game import GAME, level


def test_auth_and_default_packs(app, A):
    with TestClient(app) as c:
        assert c.get("/api/me").status_code == 401
    with TestClient(app, headers={"X-Dev-User": "x@gmail.com"}) as c:
        assert c.get("/api/me").status_code == 403
    packs = {p["name"]: p for p in A.get("/api/packs").json()}
    assert set(packs) == {"develop", "product"} and packs["product"]["production"]


def test_crud_uses_plugin_hooks(A, B):
    r = create(A, "develop", 1)
    assert r.headers["etag"] == '"r1"'
    assert A.put("/api/packs/develop/levels/1", json=level(1, 90)).status_code == 428          # thiếu If-Match
    r = A.put("/api/packs/develop/levels/1", json=level(1, 90), headers={"If-Match": '"r1"'})
    assert r.status_code == 200 and r.json()["changes"] == ["time: 60 → 90"]                   # GamePlugin.level_changes
    assert A.get("/api/packs/develop/levels").json()[0]["summary"] == {"time": 90, "items": 2}  # GamePlugin.level_summary
    c = B.put("/api/packs/develop/levels/1", json=level(1, 5), headers={"If-Match": '"r1"'})
    assert c.status_code == 412


def test_validator_module_from_plugin(A):
    create(A, "develop", 1)
    create(A, "develop", 2, level(2, time=0, items=()))
    res = {x["name"]: x for x in A.get("/api/packs/develop/validate").json()}
    assert res["1"]["isValid"] and res["2"]["errors"] == ["time phải > 0", "items trống"]
    r = A.post("/api/promote", json={"from": "develop", "to": "product", "items": [{"name": "2"}]})
    assert r.status_code == 422
    r = A.post("/api/promote", json={"from": "develop", "to": "product", "items": [{"name": "1", "to": "7"}]})
    assert r.status_code == 200 and A.get("/api/packs/product/levels/7").json()["level"]["level"] == 7   # set_level_number


def test_import_export_relevel(A):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for n in (1, 2, 3):
            zf.writestr(f"Any/Folder/{n}.json", json.dumps(level(n, 10 * n)))
    assert A.post("/api/packs/develop/import", content=buf.getvalue(),
                  headers={"Content-Type": "application/zip"}).json()["created"] == 3
    zf = zipfile.ZipFile(io.BytesIO(A.get("/api/packs/develop/export").content))
    assert json.loads(zf.read("develop/2.json")) == level(2, 20)
    r = A.post("/api/packs/develop/levels/1/relevel", json={"to": "3", "mode": "shift"}, headers={"If-Match": '"r1"'})
    assert r.status_code == 200, r.text
    lv3 = A.get("/api/packs/develop/levels/3").json()["level"]
    assert lv3 == level(3, 10)


def test_levelhub_from_spec(A):
    for n in (1, 2):
        create(A, "develop", n, level(n, items=("rock", "rock", "gem")))
    opts = A.get("/api/levelhub/options").json()
    assert opts["game"] == "Sample" and opts["obstacleCodes"] == [{"key": "Rock", "code": "RK"}]
    body = {"from_lv": 1, "to_lv": 2, "designer": "khoadv@sonat.vn", "why": "retention", "geo": ["Tier1"]}
    r = A.post("/api/packs/develop/levelhub/export", json=body)
    assert r.status_code == 200, r.text
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    rows = json.loads(zf.read("LevelMetadata.json"))["Levels"]
    assert list(rows[0]) == list(levelhub.FIELD_ORDER)
    assert (rows[1]["game"], rows[1]["difficulty"], rows[1]["totalBlock"], rows[1]["obstacleInfos"]) == ("Sample", 2, 3, "RK2")
    assert levelhub.compose_zip_name("Sample", "iOS", 1, 2, [], "", "", date(2026, 10, 9), "") == "Sample_iOS_1_2____0910_v1.zip"


def test_game_without_levelhub(tmp_path):
    bare = GamePlugin(tool_name="Bare", game_name="Bare", env_prefix="BARE", validator_module=GAME.validator_module)
    app = create_app(bare, Settings.for_game(bare, db_path=str(tmp_path / "b.db"), dev=True))
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        assert c.get("/api/levelhub/options").status_code == 400
        assert c.post("/api/packs/develop/levels/1", json={"anything": 1}).status_code == 201
    app.state.db.close()


def test_env_prefix(monkeypatch):
    monkeypatch.setenv("SAMPLELEVEL_ADMINS", "x@sonat.vn")
    monkeypatch.setenv("SAMPLELEVEL_BI_APP_ID_IOS", "id1")
    s = Settings.from_env(GAME)
    assert s.admins == ["x@sonat.vn"] and s.bi_app_id == "com.sample.game" and s.bi_app_id_ios == "id1"
    assert s.var("NODE") == "SAMPLELEVEL_NODE" and s.tool_name == "SampleLevel"
