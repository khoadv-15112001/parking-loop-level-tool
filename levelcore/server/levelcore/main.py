"""Điểm vào server: nạp plugin của game rồi dựng app.

    uvicorn --factory levelcore.main:get_app --workers 1     (PYTHONPATH = levelcore/server + game/server)

Game khai bằng manifest (game/manifest.json, hoặc đường dẫn trong LEVELCORE_GAME_MANIFEST) được nạp trước; không có
manifest thì nạp plugin Python: LEVELCORE_GAME_MODULE đổi tên module (mặc định "gameplugin" — game/server/gameplugin/).
"""
import importlib
import os
from pathlib import Path

from .config import REPO
from .plugin import GamePlugin


def manifest_path() -> Path | None:
    explicit = os.environ.get("LEVELCORE_GAME_MANIFEST")
    if explicit:
        return Path(explicit)
    default = REPO / "game" / "manifest.json"
    return default if default.is_file() and not os.environ.get("LEVELCORE_GAME_MODULE") else None


def load_game(module: str | None = None) -> GamePlugin:
    manifest = None if module else manifest_path()
    if manifest is not None:
        return GamePlugin.from_manifest(manifest)
    name = module or os.environ.get("LEVELCORE_GAME_MODULE", "gameplugin")
    game = getattr(importlib.import_module(name), "GAME", None)
    if not isinstance(game, GamePlugin):
        raise RuntimeError(f"Module '{name}' phải có biến GAME = GamePlugin(...)")
    return game


def get_app():
    from .app import create_app
    return create_app(load_game())
