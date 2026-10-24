import pytest
from fastapi.testclient import TestClient

from gameplugin import GAME
from levelcore import clock
from levelcore.app import create_app
from levelcore.config import Settings


@pytest.fixture(autouse=True)
def _clock():
    clock.reset()
    yield
    clock.reset()


@pytest.fixture
def A(tmp_path):
    app = create_app(GAME, Settings.for_game(GAME, db_path=str(tmp_path / "t.db"), dev=True, admins=["a@sonat.vn"]))
    with TestClient(app, headers={"X-Dev-User": "a@sonat.vn"}) as c:
        yield c
    app.state.db.close()
