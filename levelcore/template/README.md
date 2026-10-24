# __TOOL__ — tool quản lý & chỉnh sửa level __GAME__

Fork của **level-tool-core**. Phần chung (server đồng bộ, vỏ app web, BI Level Hub, playtest WebGL, deploy) ở
`levelcore/` — không sửa ở đây (xem [`levelcore/README.md`](levelcore/README.md), [`levelcore/FORK.md`](levelcore/FORK.md)).
Phần riêng của __GAME__ ở `game/`.

- Chạy local: bấm đúp `ChayDev.bat` → http://localhost:8880/app/
- Test: `cd game/server && ../../.venv/Scripts/python -m pytest`
- Deploy: `bi.yaml` (slug `__SLUG__`), phát hành bằng tag `__SLUG__-v0.1.0`
