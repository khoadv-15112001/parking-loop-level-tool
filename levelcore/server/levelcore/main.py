"""Điểm vào server: nạp plugin của game rồi dựng app.

    uvicorn --factory levelcore.main:get_app --workers 1     (PYTHONPATH = levelcore/server + game/server)

LEVELCORE_GAME_MODULE đổi tên module plugin (mặc định "gameplugin" — thư mục game/server/gameplugin/).
"""
import importlib
import os

from .plugin import GamePlugin


def load_game(module: str | None = None) -> GamePlugin:
    name = module or os.environ.get("LEVELCORE_GAME_MODULE", "gameplugin")
    game = getattr(importlib.import_module(name), "GAME", None)
    if not isinstance(game, GamePlugin):
        raise RuntimeError(f"Module '{name}' phải có biến GAME = GamePlugin(...)")
    return game


def get_app():
    from .app import create_app
    return create_app(load_game())
