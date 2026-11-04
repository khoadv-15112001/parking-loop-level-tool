"""Bản game WebGL playtest: tải zip lên, phục vụ /game/ đúng Content-Encoding / Content-Type."""
import io
import zipfile

from sample_game import GAME


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


BUILD = {"PlaytestWeb/index.html": "<html>game</html>", "PlaytestWeb/Build/w.loader.js": "loader",
         "PlaytestWeb/Build/w.wasm.br": b"\x00wasm", "PlaytestWeb/Build/w.data.br": b"data",
         "PlaytestWeb/StreamingAssets/aa/catalog.json": "{}"}


def test_no_game_yet(A):
    assert A.get("/api/game").json() == {"available": False}
    assert A.get("/game/index.html").status_code == 404


def test_upload_and_serve(A, B):
    assert B.post("/api/game/upload", content=_zip(BUILD)).status_code == 403          # chỉ admin
    r = A.post("/api/game/upload?name=playtest-web.zip", content=_zip(BUILD))
    assert r.status_code == 200 and r.json()["available"] and r.json()["uploaded_by"] == "a@sonat.vn"
    page = A.get("/game/index.html")
    assert page.text == "<html>game</html>" and "Content-Security-Policy" not in page.headers
    wasm = A.get("/game/Build/w.wasm.br")
    assert wasm.headers["content-encoding"] == "br" and wasm.headers["content-type"] == "application/wasm"
    assert A.get("/game/Build/w.loader.js").headers["content-type"].startswith("application/javascript")
    assert A.get("/game/StreamingAssets/aa/catalog.json").status_code == 200
    assert A.get("/game/levelcore_game.json").status_code == 404
    assert A.get("/game/..%2F..%2Fapp%2Fconfig.py").status_code == 404
    # tải bản mới thay hẳn bản cũ
    A.post("/api/game/upload", content=_zip({"index.html": "v2", "Build/x.loader.js": "l"}))
    assert A.get("/game/index.html").text == "v2" and A.get("/game/Build/w.wasm.br").status_code == 404


def test_reject_bad_zips(A):
    assert A.post("/api/game/upload", content=b"not a zip").status_code == 400
    assert A.post("/api/game/upload", content=_zip({"Build/x.loader.js": "l"})).status_code == 400   # thiếu index.html
    assert A.post("/api/game/upload", content=_zip({"index.html": "x"})).status_code == 400          # thiếu loader
    assert A.post("/api/game/upload", content=_zip({"index.html": "x", "Build/a.loader.js": "l",
                                                    "../evil.txt": "x"})).status_code == 400
    assert A.get("/api/game").json() == {"available": False}


def test_full_storage_rejects_build_and_preserves_current(A, settings, monkeypatch):
    from levelcore import storage
    assert A.post("/api/game/upload", content=_zip(BUILD)).status_code == 200
    current = A.get("/api/game").json()["id"]
    monkeypatch.setattr(storage, "STORAGE_LIMIT", storage.storage_usage(settings) + storage.STORAGE_RESERVE + 1)
    response = A.post("/api/game/upload", content=_zip({"index.html": "next", "Build/n.loader.js": "loader"}))
    assert response.status_code == 507
    assert A.get("/api/game").json()["id"] == current
    assert A.get("/game/index.html").text == "<html>game</html>"


def test_prune_builds_counts_bytes_and_always_keeps_current(settings, monkeypatch):
    from levelcore import webgame
    first = webgame.install_build(settings, _zip(BUILD), "admin")["build"]["id"]
    second = webgame.install_build(settings, _zip({"index.html": "next", "Build/n.loader.js": "l"}), "admin")["build"]["id"]
    measure = webgame.disk_bytes
    monkeypatch.setattr(webgame, "disk_bytes", lambda path: 500_000_000 if path.name == first else measure(path))
    monkeypatch.setattr(webgame, "BUILD_BUDGET", 100_000_000)
    assert webgame.prune(settings) == [first]
    assert webgame.find_build(settings, second) == "current"
    assert webgame.find_build(settings, first) is None


def test_bi_center_env_defaults(monkeypatch, tmp_path):
    from levelcore.config import Settings
    for k in ("SAMPLELEVEL_DB", "SAMPLELEVEL_PUBLIC_BASE", "SAMPLELEVEL_GAME_DIR"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("SBP_SQLITE_PATH", str(tmp_path / "samplelevel.db"))
    monkeypatch.setenv("SBP_TOOL_URL", "https://sample.tools.sonatgame.com/")
    monkeypatch.setenv("SBP_DATA_DIR", str(tmp_path))
    s = Settings.from_env(GAME)
    assert s.db_path == str(tmp_path / "samplelevel.db") and s.public_base == "https://sample.tools.sonatgame.com"
    assert s.game_dir == str(tmp_path / "game")
    monkeypatch.setenv("SAMPLELEVEL_PUBLIC_BASE", "http://localhost:8880")   # biến của tool thắng
    assert Settings.from_env(GAME).public_base == "http://localhost:8880"


def test_chunked_upload(A, B, monkeypatch):
    from levelcore import webgame as game
    monkeypatch.setattr(game, "CHUNK_BYTES", 100)
    data = _zip(BUILD)
    assert B.post("/api/game/uploads", json={"size": len(data)}).status_code == 403
    up = A.post("/api/game/uploads", json={"size": len(data), "name": "playtest-web.zip"}).json()
    parts = [data[i:i + 100] for i in range(0, len(data), 100)]
    assert up["parts"] == len(parts) > 1
    for i, p in enumerate(parts[:-1]):
        assert A.put(f"/api/game/uploads/{up['id']}/{i}", content=p).status_code == 200
    assert A.post(f"/api/game/uploads/{up['id']}/complete").status_code == 400          # thiếu phần cuối
    assert A.put(f"/api/game/uploads/{up['id']}/{len(parts) - 1}", content=b"x").status_code == 400   # sai độ dài
    A.put(f"/api/game/uploads/{up['id']}/{len(parts) - 1}", content=parts[-1])
    r = A.post(f"/api/game/uploads/{up['id']}/complete")
    assert r.status_code == 200 and r.json()["file"] == "playtest-web.zip"
    assert A.get("/game/index.html").text == "<html>game</html>"
    assert A.post(f"/api/game/uploads/{up['id']}/complete").status_code == 404          # đã dọn


def test_install_from_disk_cleans_leftovers(A, settings, tmp_path):
    from levelcore import webgame as game
    from pathlib import Path
    d = Path(settings.game_dir)
    stale = d.with_name(d.name + ".new-123")
    (stale / "Build").mkdir(parents=True)                      # lần cài trước bị ngắt giữa chừng
    z = tmp_path / "playtest-web.zip"
    z.write_bytes(_zip(BUILD))
    out = game.install_zip(settings, z, "a@sonat.vn", z.name)
    assert out["available"] and out["size"] == z.stat().st_size and not stale.exists()
    assert A.get("/game/index.html").text == "<html>game</html>"


def test_game_caching(A):
    A.post("/api/game/upload", content=_zip({**BUILD, "PlaytestWeb/StreamingAssets/aa/WebGL/props_assets_all_"
                                                      "62aba30c71708d50a759bbdb15e1631a.bundle": b"bundle"}))
    hashed = A.get("/game/StreamingAssets/aa/WebGL/props_assets_all_62aba30c71708d50a759bbdb15e1631a.bundle")
    assert hashed.headers["cache-control"] == "private, max-age=31536000, immutable"
    page = A.get("/game/index.html")
    assert page.headers["cache-control"] == "no-cache"
    again = A.get("/game/index.html", headers={"If-None-Match": page.headers["etag"]})
    assert again.status_code == 304 and again.content == b""
    assert A.get("/game/index.html", headers={"If-None-Match": '"other"'}).status_code == 200
