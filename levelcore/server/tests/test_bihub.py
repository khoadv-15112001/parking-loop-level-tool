"""BI Level Hub + đăng nhập Firebase với BI GIẢ (không gọi BI / Firebase thật)."""
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from levelcore import bihub
from levelcore.config import Settings
from levelcore.app import create_app
from sample_game import GAME, level
from conftest import create

TOKEN = "aaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc"   # hình dạng JWT — BI giả không giải mã


@pytest.fixture
def bi(monkeypatch):
    """BI giả: ghi lại mọi lời gọi, trả dữ liệu Level Hub mẫu."""
    calls = []
    files = {f"f{n}": n for n in (1, 2, 3)}

    def call(s, method, path, token, *, json_body=None, multipart=None, timeout=30.0):
        calls.append((method, path, token, json_body, multipart))
        if path.startswith("/asset-groups?"):
            return {"items": [{"id": "g1", "name": "Sample_A_1_21_Tier1_retention_khoadv_0910_v1", "status": "READY"},
                              {"id": "g2", "name": "Sample_I_1_50_Global__khoadv_0110_v2", "status": "PROCESSING"}],
                    "total": 2, "currentPage": 1, "totalPages": 1, "hasMore": False}
        if path.startswith("/asset-groups/g1/files"):
            return {"items": [{"id": fid, "fileName": f"{n}.json", "contentType": "application/json", "level": n}
                              for fid, n in files.items()] + [{"id": "meta", "fileName": "LevelMetadata.json"}],
                    "hasMore": False}
        if path == "/asset-groups/g1":
            return {"id": "g1", "status": "READY"}
        if path == "/parse-name":
            return {"valid": True}
        if path == "/asset-groups" and method == "POST":
            return {"id": "new-group", "status": "PROCESSING"}
        if method == "POST" and path.startswith("/asset-groups/g1/"):
            return {"id": "g1", "status": "ARCHIVED" if path.endswith("archive") else "PROCESSING"}
        raise bihub.BiError("không có", 404)

    def raw(s, token, group_id, file_id):
        return json.dumps(level(files[file_id])).encode(), "application/json"

    monkeypatch.setattr(bihub, "call", call)
    monkeypatch.setattr(bihub, "get_file_raw", raw)
    monkeypatch.setattr(bihub, "verify_id_token", lambda s, t: "gd@sonat.vn")
    return calls


@pytest.fixture
def bi_settings(tmp_path):
    return Settings.for_game(GAME, db_path=str(tmp_path / "bi.db"), dev=True, admins=["a@sonat.vn"], public_base="http://127.0.0.1:8880",
                    session_secret="test-secret", bi_api_url="https://bi.example", bi_firebase_api_key="k",
                    bi_firebase_auth_domain="x.firebaseapp.com", bi_firebase_project_id="p", bi_firebase_app_id="1:2:web:3")


@pytest.fixture
def C(bi_settings, bi):
    app = create_app(GAME, bi_settings)
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        yield c
    app.state.db.close()


def test_not_configured(A):
    assert A.get("/api/bi/config").json()["configured"] is False
    assert A.get("/api/bi/asset-groups", headers={"X-BI-Token": TOKEN}).status_code == 503
    assert A.get("/auth/status").json()["bi"] is False


def test_group_list_needs_token(C):
    assert C.get("/api/bi/asset-groups").status_code == 400
    assert C.get("/api/bi/asset-groups", headers={"X-BI-Token": "xx"}).status_code == 400


def test_list_groups_files_and_import(C, bi):
    groups = C.get("/api/bi/asset-groups", headers={"X-BI-Token": TOKEN}).json()
    assert [g["id"] for g in groups["items"]] == ["g1", "g2"]
    method, path, token, *_ = bi[-1]
    assert token == TOKEN and "appIds=com.sample.game" in path
    files = C.get("/api/bi/asset-groups/g1/files", headers={"X-BI-Token": TOKEN}).json()["items"]
    lvl = C.get(f"/api/bi/asset-groups/g1/files/{files[0]['id']}/raw", headers={"X-BI-Token": TOKEN}).json()
    assert lvl["level"] == files[0]["level"]
    # app nhập các file đã chọn vào bộ đang mở qua đường import JSON {"levels": {...}}
    r = C.post("/api/packs/develop/import?message=Level%20Hub", json={"levels": {str(files[0]["level"]): lvl}})
    assert r.status_code == 200 and r.json()["created"] == 1


def test_upload_to_bi(C, bi):
    for n in (1, 2, 3):
        create(C, "develop", n)
    body = {"from_lv": 1, "to_lv": 3, "designer": "khoadv@sonat.vn", "why": "retention"}
    assert C.post("/api/packs/develop/levelhub/upload", json=body, headers={"X-BI-Token": TOKEN}).status_code == 400  # thiếu geo
    body["geo"] = ["Tier1"]
    short = C.post("/api/packs/develop/levelhub/upload", json={**body, "description": "ngắn"}, headers={"X-BI-Token": TOKEN})
    assert short.status_code == 400
    r = C.post("/api/packs/develop/levelhub/upload", json=body, headers={"X-BI-Token": TOKEN})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["name"].startswith("Sample_A_1_3_Tier1_retention_khoadv_") and out["group"]["id"] == "new-group"
    steps = [(m, p) for m, p, *_ in bi]
    assert steps[-2:] == [("POST", "/parse-name"), ("POST", "/asset-groups")]
    _, _, _, parse_body, _ = bi[-2]
    assert parse_body == {"appId": "com.sample.game", "name": out["name"]}
    data, ctype = bi[-1][4]
    assert ctype.startswith("multipart/form-data") and f'filename="{out["name"]}.zip"'.encode() in data
    zstart = data.index(b"PK\x03\x04")
    zf = zipfile.ZipFile(io.BytesIO(data[zstart:data.rindex(b"\r\n--")]))
    assert sorted(zf.namelist()) == ["LevelMetadata.json", "Raw/1.json", "Raw/2.json", "Raw/3.json"]
    assert json.loads(zf.read("LevelMetadata.json"))["Levels"][0]["game"] == "Sample"
    assert C.get("/api/audit?action=levelhub.bi_upload").json()[0]["detail"]["group"] == "new-group"


def test_bi_errors_become_502(C, monkeypatch):
    def deny(*a, **k):
        raise bihub.BiError("Your account is not authorized", 403)
    monkeypatch.setattr(bihub, "call", deny)
    r = C.get("/api/bi/asset-groups", headers={"X-BI-Token": TOKEN})
    assert r.status_code == 502 and r.json()["bi_status"] == 403 and "quyền" in r.json()["detail"]


def test_firebase_login_issues_session(bi_settings, bi):
    app = create_app(GAME, bi_settings)
    with TestClient(app) as c:
        assert c.get("/api/me").status_code == 401
        assert c.post("/auth/firebase", json={"idToken": TOKEN}).status_code == 403          # thiếu Origin của app
        r = c.post("/auth/firebase", json={"idToken": TOKEN}, headers={"Origin": "http://localhost:8880"})
        assert r.status_code == 200 and r.json()["email"] == "gd@sonat.vn"
        session = r.json()["token"]
        c.cookies.clear()
        assert c.get("/api/me", headers={"Authorization": f"Bearer {session}"}).json()["email"] == "gd@sonat.vn"
        assert c.get("/api/me", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 401   # token Firebase không phải phiên
        page = c.get("/bi/login")
        assert page.status_code == 200 and 'data-project-id="p"' in page.text and "test-secret" not in page.text
    app.state.db.close()


def test_list_uses_repeated_app_ids_and_limit(bi_settings, bi):
    bi_settings.bi_app_id_ios = "id6804568435"
    app = create_app(GAME, bi_settings)
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        assert c.get("/api/bi/config").json()["appIds"] == {"Android": "com.sample.game", "iOS": "id6804568435"}
        c.get("/api/bi/asset-groups?archived=true", headers={"X-BI-Token": TOKEN})
        path = bi[-1][1]
        # mảng query BI: lặp key, không nối dấu phẩy; archived=true thì truyền đủ statuses (kể cả ARCHIVED)
        assert "appIds=com.sample.game&appIds=id6804568435" in path and "limit=100" in path
        assert "statuses=ARCHIVED" in path and "statuses=READY" in path
    app.state.db.close()


def test_ios_upload_uses_ios_app(bi_settings, bi):
    app = create_app(GAME, bi_settings)
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        c.post("/api/packs/develop/levels/1", json=level(1))
        body = {"from_lv": 1, "to_lv": 1, "designer": "khoadv", "geo": ["Tier1"], "os": "iOS"}
        r = c.post("/api/packs/develop/levelhub/upload", json=body, headers={"X-BI-Token": TOKEN})
        assert r.status_code == 400 and "SAMPLELEVEL_BI_APP_ID_IOS" in r.json()["detail"]   # chưa cấu hình app iOS
    app.state.db.close()
    bi_settings.bi_app_id_ios = "id6804568435"
    app = create_app(GAME, bi_settings)
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        r = c.post("/api/packs/develop/levelhub/upload", json=body, headers={"X-BI-Token": TOKEN})
        assert r.status_code == 200 and r.json()["name"].startswith("Sample_I_1_1_Tier1__khoadv_")
        assert bi[-2][3] == {"appId": "id6804568435", "name": r.json()["name"]}
        assert b'name="appId"\r\n\r\nid6804568435' in bi[-1][4][0]
    app.state.db.close()


def test_group_actions(C, bi):
    assert C.post("/api/bi/groups/g1/delete", headers={"X-BI-Token": TOKEN}).status_code == 400
    r = C.post("/api/bi/groups/g1/archive", headers={"X-BI-Token": TOKEN})
    assert r.status_code == 200 and r.json()["status"] == "ARCHIVED"
    assert bi[-1][:2] == ("POST", "/asset-groups/g1/archive")
    assert C.post("/api/bi/groups/g1/retry", headers={"X-BI-Token": TOKEN}).json()["status"] == "PROCESSING"
    assert C.get("/api/audit?action=levelhub.bi_archive").json()[0]["detail"]["group"] == "g1"


def test_ios_app_rejected_falls_back_to_android(bi_settings, bi, monkeypatch):
    bi_settings.bi_app_id_ios = "id0000000000"
    inner = bihub.call

    def picky(s, method, path, token, **kw):
        if "id0000000000" in path:
            raise bihub.BiError("App not found", 404)
        return inner(s, method, path, token, **kw)
    monkeypatch.setattr(bihub, "call", picky)
    app = create_app(GAME, bi_settings)
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        r = c.get("/api/bi/asset-groups", headers={"X-BI-Token": TOKEN})
        assert r.status_code == 200 and len(r.json()["items"]) == 2 and "id0000000000" in r.json()["warning"]
    app.state.db.close()


def test_prod_pages_public_game_needs_session(bi_settings, bi, tmp_path):
    bi_settings.dev = False
    bi_settings.game_dir = str(tmp_path / "game")
    (tmp_path / "game").mkdir()
    (tmp_path / "game" / "index.html").write_text("game")
    app = create_app(GAME, bi_settings)
    with TestClient(app, follow_redirects=False) as c:
        page = c.get("/app/")
        assert page.status_code == 200 and "Content-Security-Policy" in page.headers   # app tự hiện nút Google
        assert c.get("/api/me").status_code == 401                                      # dữ liệu vẫn khoá
        assert c.get("/game/index.html").status_code == 401                             # game cần phiên, không redirect
        r = c.post("/auth/firebase", json={"idToken": TOKEN}, headers={"Origin": "http://127.0.0.1:8880"})
        assert r.status_code == 200
        assert c.get("/game/index.html").text == "game"                                 # cookie phiên từ /auth/firebase
    app.state.db.close()
