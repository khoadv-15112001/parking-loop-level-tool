# ParkingLevel — tool level của Parking Loop

Fork của **level-tool-core**. Phần chung (server, giao diện mặc định, BI Level Hub, chơi thử WebGL, CI, deploy) ở
`levelcore/`, không sửa ở đây: [`levelcore/README.md`](levelcore/README.md), [`levelcore/AGENTS.md`](levelcore/AGENTS.md).
Phần riêng của Parking Loop ở `game/`:

| File | |
| --- | --- |
| `game/manifest.json` | tên tool, tiền tố biến `PARKINGLEVEL_*`, formatVersion, Level Hub, giao thức khung game |
| `game/web/rules.mjs` | luật level: `validateLevel`, `blankLevel`, hook thêm khi cần |
| `game/web/releases.json` | bảng Có gì mới trong app |
| `game/tests/` | test của game, raw thật ở `game/tests/raw/` |

- Chạy local: bấm đúp `ChayDev.bat` → http://localhost:8894/app/ (server node, đổi ở `game/game.env`)
- Test: `node --test game/tests/*.test.mjs`
- Deploy: `bi.yaml` (slug `parkingloop`), phát hành bằng tag `parkingloop-v0.1.0`
- Lấy bản mới của core: `git fetch core && git merge core/main` ([`levelcore/FORK.md`](levelcore/FORK.md))
