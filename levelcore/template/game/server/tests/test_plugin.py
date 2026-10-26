"""Kiểm nhanh plugin chạy được với core: lưu level, tóm tắt, validator JS của game (qua node)."""
from gameplugin import GAME


def test_roundtrip(A):
    lvl = {"level": 1}
    assert A.post("/api/packs/develop/levels/1", json=lvl).status_code == 201
    assert A.get("/api/packs/develop/levels").json()[0]["summary"] == GAME.level_summary(lvl)
    res = A.get("/api/packs/develop/validate").json()
    assert res[0]["name"] == "1" and "isValid" in res[0]
