# level-tool-core

Base logic for all level tools — phần chung của mọi tool level của Sonat (HoleLevel, FishLevel, AntLevel…).

Mỗi game fork repo này và chỉ thêm phần riêng ở `game/`; `levelcore/` là của core, game không sửa.

- Tài liệu core (plugin server / web, chạy local, biến môi trường, API): [levelcore/README.md](levelcore/README.md)
- Tạo tool cho game mới, lấy bản mới của core, đóng góp về core, chuyển AntLevel / FishLevel: [levelcore/FORK.md](levelcore/FORK.md)
- Ví dụ đầy đủ: HoleLevel (`SonatGameProduct/frenzy-hole-level-tool`)

```sh
py -m venv .venv && .venv/Scripts/python -m pip install -r levelcore/server/requirements-dev.txt
cd levelcore/server && ../../.venv/Scripts/python -m pytest
```
