"""Game khai bằng manifest + module luật JS (levelcore/contracts/sample): hook chạy qua runner node thường trú,
hook thiếu dùng mặc định, formatVersion ghi vào revision, DB tạo bởi bản core trước vẫn mở được."""
import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from levelcore.app import create_app
from levelcore.config import Settings
from levelcore.plugin import GamePlugin

CORE = Path(__file__).resolve().parents[2]
SAMPLE = CORE / "contracts" / "sample" / "manifest.json"

# Schema của levelcore main @ 647dc34 (trước khi có formatVersion) — chép nguyên để dựng DB cũ.
MAIN_647DC34_SCHEMA = """
CREATE TABLE packs(name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
  created_by TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, production INTEGER NOT NULL DEFAULT 0,
  platform TEXT NOT NULL DEFAULT 'android', grp TEXT NOT NULL DEFAULT '');
CREATE TABLE blobs(sha TEXT PRIMARY KEY, size INTEGER NOT NULL, codec TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE levels(id INTEGER PRIMARY KEY, pack TEXT NOT NULL REFERENCES packs(name), name TEXT NOT NULL,
  sort_key INTEGER, head_rev INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL, updated_at REAL NOT NULL, updated_by TEXT NOT NULL, summary TEXT, UNIQUE(pack, name));
CREATE TABLE revisions(level_id INTEGER NOT NULL REFERENCES levels(id), rev INTEGER NOT NULL,
  blob_sha TEXT REFERENCES blobs(sha), author TEXT NOT NULL, created_at REAL NOT NULL, kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '', unlocked_edit INTEGER NOT NULL DEFAULT 0, meta TEXT, PRIMARY KEY(level_id, rev));
CREATE TABLE locks(pack TEXT NOT NULL, name TEXT NOT NULL, holder TEXT NOT NULL, since REAL NOT NULL,
  expires_at REAL NOT NULL, PRIMARY KEY(pack, name));
CREATE TABLE audit(id INTEGER PRIMARY KEY, ts REAL NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL, pack TEXT,
  level TEXT, rev INTEGER, detail TEXT);
"""


def level(n, time=60, items=("gem", "rock")):
    return {"level": n, "time": time, "items": list(items)}


def make_client(tmp_path, game, db="t.db"):
    app = create_app(game, Settings.for_game(game, db_path=str(tmp_path / db), dev=True, admins=["a@sonat.vn"]))
    return app, TestClient(app, headers={"X-Dev-User": "a@sonat.vn"})


def test_manifest_hooks_run_in_node(tmp_path):
    game = GamePlugin.from_manifest(SAMPLE)
    assert (game.tool_name, game.env_prefix, game.format_version) == ("SampleLevel", "SAMPLELEVEL", 1)
    app, c = make_client(tmp_path, game)
    with c:
        assert c.post("/api/packs/develop/levels/1", json=level(1)).status_code == 201
        r = c.put("/api/packs/develop/levels/1", json=level(1, 90), headers={"If-Match": '"r1"'})
        assert r.json()["changes"] == ["time: 60 → 90"] and r.json()["summary"] == {"time": 90, "items": 2}
        assert c.get("/api/packs/develop/levels/1").json()["format"] == 1
        r = c.post("/api/promote", json={"from": "develop", "to": "product", "items": [{"name": "1", "to": "5"}]})
        assert r.status_code == 200 and c.get("/api/packs/product/levels/5").json()["level"]["level"] == 5
        body = {"from_lv": 1, "to_lv": 1, "designer": "khoadv@sonat.vn", "why": "retention", "geo": ["Tier1"]}
        zf = zipfile.ZipFile(io.BytesIO(c.post("/api/packs/develop/levelhub/export", json=body).content))
        row = json.loads(zf.read("LevelMetadata.json"))["Levels"][0]
        assert (row["game"], row["totalBlock"], row["obstacleInfos"]) == ("Sample", 2, "RK1")
        me = c.get("/api/me").json()
        assert me["runtime"] == "python" and me["features"]["levelhub"] is True
    app.state.db.close()


def test_missing_hooks_use_core_defaults(tmp_path):
    (tmp_path / "rules.mjs").write_text(
        "export function validateLevel(l) { return { isValid: !!l.ok, errors: l.ok ? [] : ['chưa ok'], warnings: [] }; }\n"
        "export function blankLevel(n) { return { ok: true }; }\n", encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({"tool": "Bare", "game": "Bare", "prefix": "BARE", "rules": "rules.mjs"}),
                                             encoding="utf-8")
    game = GamePlugin.from_manifest(tmp_path / "manifest.json")
    app, c = make_client(tmp_path, game)
    with c:
        assert c.post("/api/packs/develop/levels/1", json={"ok": True}).status_code == 201
        r = c.put("/api/packs/develop/levels/1", json={"ok": False}, headers={"If-Match": '"r1"'})
        assert r.json()["summary"] == {} and r.json()["changes"] == []
        assert c.get("/api/packs/develop/validate").json()[0]["errors"] == ["chưa ok"]
        assert c.get("/api/packs/develop/levels/1").json()["format"] is None
        assert c.get("/api/levelhub/options").status_code == 400
    app.state.db.close()
    game.rules.close()


def test_empty_admins_is_nobody_outside_dev():
    game = GamePlugin.from_manifest(SAMPLE)
    s = Settings.for_game(game, dev=False)
    assert not s.is_admin("x@sonat.vn")
    s.dev = True
    assert s.is_admin("x@sonat.vn")


def ui_manifest(tmp_path, name):
    manifest = json.loads(SAMPLE.read_text(encoding="utf-8"))
    manifest["rules"] = str(SAMPLE.parent / manifest["rules"])
    manifest["web"] = "web"
    manifest["uiTemplate"] = name
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_selected_ui_template(tmp_path):
    own = ":root { --lc-accent: rebeccapurple; }"
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "game.css").write_text(own, encoding="utf-8")
    game = GamePlugin.from_manifest(ui_manifest(tmp_path, "sand-jam"))
    _, client = make_client(tmp_path, game)
    with client:
        selected = client.get("/core/ui-template.css")
        direct = client.get("/core/ui-templates/sand-jam/template.css")
        assert selected.status_code == direct.status_code == 200
        assert selected.headers["content-type"].startswith("text/css")
        assert "--lc-accent" in selected.text and selected.content == direct.content
        assert client.get("/app/game/game.css").text == own


@pytest.mark.parametrize("name", [None, {}, "", "../sand-jam", "Sand-Jam"])
def test_invalid_ui_template_id(tmp_path, name):
    with pytest.raises(RuntimeError, match="uiTemplate phải là tên mẫu"):
        GamePlugin.from_manifest(ui_manifest(tmp_path, name))


def test_unknown_ui_template_id(tmp_path):
    game = GamePlugin.from_manifest(ui_manifest(tmp_path, "missing-template"))
    with pytest.raises(RuntimeError, match='uiTemplate "missing-template" không có'):
        make_client(tmp_path, game)


def test_opens_db_from_main_647dc34(tmp_path):
    db = tmp_path / "old.db"
    c = sqlite3.connect(db)
    c.executescript(MAIN_647DC34_SCHEMA)
    data = json.dumps(level(3, 30), separators=(",", ":")).encode()
    import hashlib
    import zlib
    sha = hashlib.sha256(data).hexdigest()
    c.execute("INSERT INTO packs(name,created_at,created_by) VALUES('develop',1,'system')")
    c.execute("INSERT INTO packs(name,created_at,created_by,production) VALUES('product',1,'system',1)")
    c.execute("INSERT INTO blobs VALUES(?,?,?,?)", (sha, len(data), "zlib", zlib.compress(data)))
    c.execute("INSERT INTO levels(pack,name,sort_key,head_rev,created_at,updated_at,updated_by) VALUES('develop','3',3,1,1,1,'x@sonat.vn')")
    c.execute("INSERT INTO revisions VALUES(1,1,?,'x@sonat.vn',1,'import','',0,NULL)", (sha,))
    c.commit()
    c.close()
    app, client = make_client(tmp_path, GamePlugin.from_manifest(SAMPLE), db="old.db")
    with client:
        old = client.get("/api/packs/develop/levels/3").json()
        assert old["level"] == level(3, 30) and old["format"] is None
        r = client.post("/api/packs/develop/import", json={"levels": {"3": level(3, 31)}})
        assert r.json()["updated"] == 1   # revision 'import' cũ vẫn là mốc đồng bộ
        assert client.get("/api/packs/develop/levels/3/revisions").json()[0]["format"] == 1
    app.state.db.close()
