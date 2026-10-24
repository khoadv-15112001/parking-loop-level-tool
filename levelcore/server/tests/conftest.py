"""Test của level-tool-core chạy với game mẫu (tests/sample_game) — không phụ thuộc game thật nào."""
import pytest
from fastapi.testclient import TestClient

from levelcore import clock
from levelcore.app import create_app
from levelcore.config import Settings
from sample_game import GAME, level

ADMINS = ["a@sonat.vn"]


@pytest.fixture(autouse=True)
def _clock():
    clock.reset()
    yield
    clock.reset()


@pytest.fixture
def settings(tmp_path):
    return Settings.for_game(GAME, db_path=str(tmp_path / "t.db"), dev=True, sse_heartbeat=0.3, admins=list(ADMINS),
                             game_dir=str(tmp_path / "game"))


@pytest.fixture
def app(settings):
    a = create_app(GAME, settings)
    yield a
    a.state.db.close()


def client_for(app, user: str) -> TestClient:
    return TestClient(app, headers={"X-Dev-User": user})


@pytest.fixture
def A(app):
    with client_for(app, "a@sonat.vn") as c:
        yield c


@pytest.fixture
def B(app):
    with client_for(app, "b@sonat.vn") as c:
        yield c


def create(c, pack, n, body=None):
    r = c.post(f"/api/packs/{pack}/levels/{n}", json=body or level(int(n)))
    assert r.status_code == 201, r.text
    return r
