# Fork, cập nhật từ core, đóng góp về core

## Quy tắc duy nhất

**Repo của game không sửa gì trong `levelcore/`** (và `ChayDev.bat`, `.gitignore`, `.dockerignore`, `.claude/skills/`).
Mọi thứ riêng của game nằm ở `game/`, `bi.yaml`, `README.md`, `AGENTS.md`, `CLAUDE.md`. Nhờ vậy merge từ core không đụng
file của game và ngược lại.

Cần core làm thêm điều gì cho game → thêm **điểm mở rộng** vào core (trường mới trong `GamePlugin` / object `game.mjs`, có
mặc định để game cũ không phải đổi), không rẽ nhánh `if game == …` trong core.

## Tạo tool cho game mới

```sh
# 1. Tạo repo trống trên GitHub (vd SonatGameProduct/fish-sort-level-tool), clone core về dưới tên mới
git clone git@github.com:SonatGameProduct/level-tool-core.git fish-sort-level-tool
cd fish-sort-level-tool
git remote rename origin core
git remote add origin git@github.com:SonatGameProduct/fish-sort-level-tool.git

# 2. Sinh phần riêng của game từ levelcore/template/ (server node hoặc python; py levelcore/tools/new_game.py = python)
node levelcore/tools/new_game.mjs --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort --runtime node
#    README.md, AGENTS.md của core ở gốc repo được thay bằng bản của game

# 3. Raw thật vào game/tests/raw/, viết game/web/rules.mjs, điền game/manifest.json, chạy node --test game/tests/*.test.mjs,
#    bấm đúp ChayDev.bat. Chi tiết: levelcore/AGENTS.md, skill levelcore-new-game.
git add -A && git commit -m "FishLevel: game"
git push -u origin main
```

Game sinh ra chỉ có dữ liệu và luật; giao diện là vỏ của core cho tới khi game tự làm (`levelcore/AGENTS.md`, mục Giao
diện). Game cũ viết bằng plugin Python (`game/server/gameplugin`) vẫn chạy như trước.

## Lấy bản mới của core

```sh
git fetch core
git merge core/main            # chỉ đổi levelcore/ (+ ChayDev.bat…) → không xung đột
node --test game/tests/*.test.mjs
```

Trước khi merge đọc phần **Cần chú ý** của các bản mới trong `levelcore/CHANGELOG.md` (`git show core/main:levelcore/CHANGELOG.md`):
đó là bước nâng cấp bắt buộc (biến mới, đổi hợp đồng hook). Xung đột chỉ có thể ở `README.md`, `AGENTS.md`, `CLAUDE.md`
gốc repo khi core đổi bản của nó: giữ bản của game (`git checkout --ours <file>`). Game cũ dùng plugin Python chạy thêm
`cd game/server && ../../.venv/Scripts/python -m pytest`.

### Repo game có trước core (lịch sử không chung gốc) — làm một lần

HoleLevel có lịch sử riêng trước khi có core. Lần đầu nối:

```sh
git remote add core git@github.com:SonatGameProduct/level-tool-core.git
git fetch core
git merge core/main --allow-unrelated-histories
# levelcore/ giống hệt → không xung đột. Xung đột thường chỉ ở README.md: giữ bản của game
git checkout --ours README.md && git add README.md && git commit
```

Từ lần sau là `git merge core/main` bình thường.

## Đóng góp sửa đổi về core

Sửa được phát hiện khi làm game (bug, tính năng chung) → làm ở **repo core**, không sửa thẳng `levelcore/` của game:

1. Trong clone của `level-tool-core`: nhánh mới, sửa, chạy `cd levelcore/server && pytest` (game mẫu + template), PR.
2. Merge PR vào `level-tool-core/main` → mỗi game `git fetch core && git merge core/main`.

Gấp quá phải sửa trong game trước: commit riêng chỉ đụng `levelcore/`, rồi `git cherry-pick` commit đó sang repo core —
khi merge lại từ core, git thấy cùng nội dung nên không xung đột.

## Chuyển AntLevel / FishLevel sang core

AntLevel (`antopia-level-tool`) và FishLevel (`Fish-Sort` nhánh `tools/fishlevel`) cùng gốc FishLevel với HoleLevel nên
phần lớn module server trùng tên / trùng vai trò. Đề xuất làm theo hai đợt, đợt nào cũng giữ test xanh.

### Đợt 1 — đưa phần đã có trong core về dùng core

| Ant / Fish hiện tại | Core | Ghi chú |
| --- | --- | --- |
| `server/app/{db,clock,errors,events,vl_sso}.py` | `levelcore/server/levelcore/` | gần như giống hệt |
| `server/app/auth.py`, `bihub.py` (Ant) | `auth.py`, `bihub.py` | thông báo dùng `s.tool_name` / `s.var(...)` |
| `server/app/config.py` (`ANTLEVEL_*` / `FISHLEVEL_*`) | `config.py` | `GamePlugin.env_prefix = "ANTLEVEL"` / `"FISHLEVEL"`; biến SBP_* giữ nguyên |
| `server/app/store.py` | `store.py` | gọi `game.level_summary` / `level_changes` / `set_level_number` thay vì import thẳng |
| `server/app/summary.py`, `leveldiff.py` | `game/server/gameplugin/` | riêng game |
| `server/app/validate.py` + `server/validate_runner.mjs` | `validate.py` + `levelcore/runner/` | runner nhận đường dẫn module validator |
| `core/schema/*.mjs` (validator) | `game/web/schema.mjs` | `GamePlugin.validator_module` |
| `server/app/levelhub/{naming,metadata,packager,preflight,contract}.py` | `levelhub.py` | chung |
| `server/app/levelhub/{describe,obstacle_codes,config}.py` | `game/server/gameplugin` → `LevelHubSpec` | riêng game |
| `server/app/playtest.py` (+ `playtest_cli.py`) | `webgame.py` + `tools/install_game.py` | giao thức `fishlevel-game` / `antlevel-game` → `game.mjs` `webgame.id/tag` |
| `app/js/{api,biauth,sync,ui}.mjs` | `levelcore/web/js/` | khoá localStorage → `storagePrefix` (giữ tiền tố cũ để không bắt đăng nhập lại) |
| `server/Dockerfile`, `ChayDev.bat` | `levelcore/deploy/`, `ChayDev.bat` | `bi.yaml`: `build.dockerfile: levelcore/deploy/Dockerfile` |

Cách làm (như HoleLevel đã làm, xem lịch sử nhánh `refactor/level-tool-core`): nối remote `core`, merge
`--allow-unrelated-histories`, `git mv` file riêng game sang `game/`, xoá bản cũ của file đã có trong core, viết
`gameplugin/__init__.py` + `game/web/game.mjs`, sửa test import `levelcore.*` / `gameplugin`.

**Vướng:** vỏ app web của Ant / Fish lớn hơn HoleLevel nhiều (editor, engine, i18n, nhiều màn). Đợt 1 có thể giữ nguyên
app web của game (phục vụ từ `game/web`) và chỉ dùng core cho server — core phục vụ `/app/` từ `levelcore/web`, nên
cần thêm một điểm mở rộng "game tự cung cấp toàn bộ app web" (vd `GamePlugin.web_app_dir`) trước khi chuyển.

### Đợt 2 — đưa phần chung chỉ Ant / Fish có vào core

Có trong cả Ant lẫn Fish, không riêng game → nên thành module core (mỗi cái kèm test với game mẫu):

| Module | Vai trò |
| --- | --- |
| `activity.py` (+ `activity.mjs`) | người online / đang xem level nào |
| `playlinks.py`, `playsessions.py` | link chơi thử chia sẻ, phiên chơi thử + kết quả |
| `livebi.py`, `livefeat.py`, `livehash.py` | số liệu BI Live theo level |
| `assettest.py` (Asset Hub / test) | |
| `features.py`, `redact.py` | cờ tính năng, che dữ liệu nhạy cảm trong log / audit |
| `pack_cli.py` | thao tác bộ từ dòng lệnh |
| `app/js/i18n*.mjs` (lõi), `appupdate.mjs`, `appver.mjs`, `bus.mjs` | i18n, thông báo bản mới |
| `shell/` (Tauri) | app desktop |
| Kho preset (`ddapresets`, `genpresets`, `retrypresets`, `templates`… — cùng một mẫu lặp 5 lần ở Fish) | một "preset store" chung, game khai báo loại preset |

Riêng game, giữ ở `game/`: editor / engine / solver, DDA, generator, art (`fishart`, `fishcatalog`, `wildfish`),
`ant2convert`, `levelfmt`, `unlocks` / `unlocksched`, `level_defaults`, `xlsxtemplates`, mô tả Level Hub.
