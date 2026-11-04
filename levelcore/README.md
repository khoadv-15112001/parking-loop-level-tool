# level-tool-core

Phần chung của mọi tool level (HoleLevel, FishLevel, AntLevel…). Mỗi tool của một game là **fork** của repo
`level-tool-core`, gồm hai phần:

| Thư mục | Của ai | Nội dung |
| --- | --- | --- |
| `levelcore/` | **core** — game không sửa | hai server (Python, Node), vỏ app web, Docker, tools, starter game mới |
| `game/` | **game** | `manifest.json`, luật level `web/rules.mjs`, Có gì mới `web/releases.json`, test, `game.env`, `.env.example` |
| `ChayDev.bat`, `.gitignore`, `.dockerignore`, `.claude/skills/` | core | |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `bi.yaml` | game | (core chỉ có bản mẫu ở `levelcore/template/`) |
| `data/`, `.env`, `.venv` | local | không commit |

Quy tắc cho người và agent làm tool (chỗ được sửa, viết phần game, giao diện, changelog): [AGENTS.md](AGENTS.md).
Fork / đóng góp ngược về core: [FORK.md](FORK.md). Game mới: `node levelcore/tools/new_game.mjs …` hoặc skill
`levelcore-new-game`.

## Nâng core

1. Đọc phần **Cần chú ý** của các bản mới trong [CHANGELOG.md](CHANGELOG.md) của `core/main`: bước nâng cấp bắt buộc
   (biến mới trên BI, đổi hợp đồng hook) nằm ở đó.
2. `git fetch core && git merge core/main`. Merge chỉ đổi `levelcore/` và file của core; nếu xung đột ở `README.md`,
   `AGENTS.md`, `CLAUDE.md` gốc repo thì giữ bản của game.
3. `node --test game/tests/*.test.mjs`, mở tool bằng `ChayDev.bat`, thử một level. Không phải sửa `game/` trừ khi Cần chú
   ý ghi rõ.
4. Commit merge, phát hành như thường (thêm dòng Có gì mới nếu GD thấy khác).

## Có gì trong core

| Phần | |
| --- | --- |
| Bộ level | tạo / đổi tên / nhóm / nền tảng / production / lưu trữ; mặc định `develop` + `product` |
| Level | revision append-only (blob sha256 + zlib, dedupe), `ETag` / `If-Match` (412 kèm head), khoá sửa (TTL + heartbeat), xoá mềm, khôi phục, đổi số (swap / shift), promote qua validator, nhập / xuất zip, audit |
| Realtime | SSE: level / khoá / bộ / người online |
| Kiểm định | validator JS của game — app chạy trực tiếp, server chạy qua `node levelcore/runner/validate_runner.mjs <module>` |
| Đăng nhập | Google của BI (Firebase) → phiên ký HMAC; DEV: header `X-Dev-User`; SSO `vl_sso` |
| BI Level Hub | xuất gói `LevelMetadata.json` + `Raw/<n>.json` (hợp đồng `com.sonat.level.build` 0.4.0), đẩy lên BI, duyệt / nhập / lưu trữ bộ trên BI, mở bộ Level Hub thành bộ riêng |
| Playtest | bản WebGL của game ở `/game/` (upload theo phần, `.br`, cache), khung game trong app (xem / chơi thử / làm nổi / cheat) |
| CI | hợp đồng CI v1 của Jenkins: nhận player WebGL và level, build nhánh theo dõi lên ngay, nhánh khác chờ admin chọn |
| Deploy | `deploy/Dockerfile` (Python), `deploy/Dockerfile.node` (Node) cho BI Center (SBP_*), `deploy/docker-compose.yml` |
| Vỏ app web | chọn bộ, danh sách / lưới ảnh, panel level (Tổng quan / JSON / Lịch sử), sửa / lưu / xung đột, Có gì mới, phím tắt đổi được |
| Tổng quan bộ | số level theo nhóm, đường chỉ số theo số level, cảnh báo nhảy vọt / chuỗi dài, so 3 bộ (chạy trên web, cả hai server) |
| Chỉ server Node | link chơi trên điện thoại + QR, lưu mọi lượt chơi (xuất JSONL cho solver / AI), ảnh level, xếp thứ tự theo slot, thùng rác 30 ngày, quản trị trong app (admin, quyền theo việc, thông báo, dung lượng, sao lưu) — [`contracts/README.md`](contracts/README.md) |

## Hai cách khai game, hai server

| | Game khai bằng manifest (game mới) | Plugin Python (game cũ) |
| --- | --- | --- |
| Khai báo | `game/manifest.json` + một module luật JS (`rules`) | `game/server/gameplugin` (`GamePlugin(...)`) + validator JS |
| Server Python | có — hook JS chạy qua một tiến trình node thường trú | có |
| Server Node (`levelcore/node`) | có — đủ route như server Python | không |
| Giao diện | vỏ của core, hoặc giao diện riêng của game (`"app"` trong manifest) dùng module của core ở `/core/` | vỏ của core |

Hợp đồng chung của hai server, cách chạy test hợp đồng, bảng route, định dạng manifest, snapshot Level Hub và CI:
[`contracts/README.md`](contracts/README.md). Kế hoạch đang làm: [`docs/KE-HOACH-CORE.md`](docs/KE-HOACH-CORE.md); chạy game
mẫu trên từng server và kịch bản kiểm tay: [`docs/SMOKE-DOT1.md`](docs/SMOKE-DOT1.md), [`docs/SMOKE-DOT2.md`](docs/SMOKE-DOT2.md);
kết quả thử game thứ hai và nâng core bằng merge: [`docs/DOT3-KET-QUA.md`](docs/DOT3-KET-QUA.md).

Server Node: `node levelcore/node/server.mjs` (game ở `game/manifest.json` hoặc `LEVELCORE_GAME_MANIFEST`; cổng
`<PREFIX>_PORT`, mặc định 8880; cùng biến môi trường `<PREFIX>_*` như bảng dưới). Server Python tự nạp `game/manifest.json`
nếu có, không thì nạp plugin Python.

Game khai bằng manifest không cần module web: vỏ của core tự dựng `game.mjs` từ manifest và module luật
(`web/js/default_game.mjs`). Module luật export `fields: [{path, label, type: 'number' | 'text' | 'bool' | 'select',
options?, min?, max?}]` thì core dựng form ở tab Tổng quan, chỉ ghi đúng field vừa sửa. Game có `web/game.mjs` riêng thì
dùng file đó (các trường ở mục Plugin web).

## Plugin server — `game/server/gameplugin` (game cũ)

Game cũ (HoleLevel) khai bằng plugin Python; game mới dùng manifest. Core vẫn chạy plugin như trước.

Package `gameplugin` có biến `GAME = GamePlugin(...)` ([`server/levelcore/plugin.py`](server/levelcore/plugin.py)):

| Trường | |
| --- | --- |
| `tool_name`, `game_name` | hiện trong UI / lỗi / log; `tool_name.lower()` + `.db` là tên database mặc định |
| `env_prefix` | tiền tố biến môi trường: `HOLELEVEL` → `HOLELEVEL_DB`, `HOLELEVEL_BI_*`… |
| `validator_module` | đường dẫn (từ gốc repo) tới module JS có `validateLevel(level, {levelNo})` |
| `level_summary(level)` | dict nhỏ cho danh sách (cột `summary`) |
| `level_changes(prev, cur)` | "đã sửa gì" (list chuỗi; `None` = không so được) |
| `set_level_number(level, n)` | ghi số mới vào nội dung khi đổi số / promote sang số khác |
| `default_packs`, `bi_app_id` | |
| `levelhub` | `LevelHubSpec(acronym, obstacle_codes, describe, layout)` — `describe(level, n)` trả `mechanics`, `difficulty`, `uniqueColor`, `totalBlock`, `time`, `obstacleCounts` |
| `extra` | tuỳ game (vd `playtest_zip` cho `tools/install_game.py`) |

Server: `uvicorn --factory levelcore.main:get_app` với `PYTHONPATH=levelcore/server;game/server`
(`LEVELCORE_GAME_MODULE` đổi tên module plugin).

## Plugin web — `game/web/game.mjs` (game cũ, hoặc game cần danh sách / tab Tổng quan riêng)

Core phục vụ `levelcore/web` ở `/app/` và `game/web` ở `/app/game/`. Vỏ app nạp `/app/game/game.mjs` (export default)
và `/app/game/game.css`:

| Trường | |
| --- | --- |
| `toolName`, `subtitle`, `envPrefix` | tiêu đề, trang đăng nhập, hướng dẫn cấu hình BI |
| `storagePrefix` | khoá localStorage (`<prefix>.token`, `.pack`, `.theme`, `.devUser`) |
| `versionPrefix` | bỏ tiền tố tag phát hành khi hiện phiên bản |
| `webgame` | `{id, tag, title, buildHint}` — giao thức postMessage với bản WebGL (`target/source: id`, dòng log `[TAG] …`) |
| `validateLevel`, `blankLevel(n, template)` | |
| `visualKey(level)` | đổi giá trị này thì khung game dựng lại level |
| `listFilters`, `matchFilter(summary, value)`, `searchText(summary)`, `listItem(summary) → {tags, sub}` | danh sách level |
| `renderOverview(ctx)` | tab Tổng quan: vẽ `ctx.form` (cột trái) + `ctx.info` (dưới thẻ Kiểm định, cột phải). `ctx = {level, editable, highlight, setHighlight(id), changed(), toast}` — sửa `ctx.level` tại chỗ rồi gọi `ctx.changed()` |

Biến màu CSS của core: `--lc-*` (`--lc-surface`, `--lc-border`, `--lc-sel`, `--lc-accent`, `--lc-err`…).

## Chạy local

Bấm đúp `ChayDev.bat` (đọc `game/game.env`: `NAME`, `PREFIX`, `PORT`, `RUNTIME` = `node` | `python`; nạp `.env`; DB
`data/dev.db`). Server Node: `node levelcore/node/server.mjs` với `<PREFIX>_DEV=1`. Server Python chạy tay:

```sh
py -m venv .venv
.venv/Scripts/python -m pip install -r levelcore/server/requirements-dev.txt
set PYTHONPATH=levelcore/server;game/server
set <PREFIX>_DEV=1
.venv/Scripts/python -m uvicorn --factory levelcore.main:get_app --port 8880 --workers 1
```

1 worker là bắt buộc (broker SSE + khoá ghi SQLite nằm trong tiến trình). Cần Node.js (validator).

## Test

```sh
cd levelcore/server && ../../.venv/Scripts/python -m pytest   # core, với game mẫu tests/sample_game + template
cd game/server && ../../.venv/Scripts/python -m pytest        # riêng game
node levelcore/contracts/run.mjs                              # hợp đồng chung, chạy với server Python rồi Node
node --test levelcore/node/tests/*.test.mjs                   # riêng server Node
```

## Biến môi trường (`<PREFIX>_*`)

| Biến | Mặc định | |
| --- | --- | --- |
| `DEV` | `0` | `1` = nhận `X-Dev-User` (KHÔNG bật trên production) |
| `DB` | `SBP_SQLITE_PATH`, `$SBP_DATA_DIR/<tool>.db` hoặc `data/<tool>.db` | |
| `PUBLIC_BASE` | `SBP_TOOL_URL` hoặc `http://127.0.0.1:8880` | URL công khai (CSRF, cookie Secure) |
| `GAME_DIR` | `$SBP_DATA_DIR/game` hoặc `data/game` | bản WebGL playtest |
| `ALLOWLIST`, `ALLOWED_DOMAIN` | — / `sonat.vn` | ai được vào |
| `ADMINS` | rỗng = mọi người (plugin Python), chỉ máy DEV (game manifest) | tải bản game, phá khoá, production / lưu trữ |
| `LOCK_TTL`, `SSE_HEARTBEAT`, `NODE`, `CORS_ORIGINS`, `WEB_ROOT` | | |
| `SESSION_SECRET` | ngẫu nhiên mỗi lần chạy | bắt buộc khi deploy |
| `CI_TOKEN`, `CI_BRANCH`, `CI_PACK` | tắt / mọi nhánh / bộ mặc định đầu | nhận player + level từ Jenkins (hợp đồng CI v1) |
| `BI_ENV`, `BI_API_URL`, `BI_APP_ID`, `BI_APP_ID_IOS`, `BI_FIREBASE_API_KEY/_AUTH_DOMAIN/_PROJECT_ID/_APP_ID` | | BI Level Hub + đăng nhập Google |

Không tiền tố: `VL_SSO_SECRET`; BI Center: `SBP_SQLITE_PATH`, `SBP_TOOL_URL`, `SBP_DATA_DIR`, `SBP_VERSION`.

## Tools

- `tools/new_game.mjs` — tạo `game/`, `bi.yaml`, `README.md`, `AGENTS.md` cho tool mới từ `template/` (`--runtime node | python`);
  `tools/new_game.py` là lệnh cũ, gọi sang với server Python.
- `tools/releases.mjs check | tag <version>` — kiểm khung Có gì mới / CHANGELOG, in message của tag.
- `tools/install_game.py [zip]` — cài bản WebGL playtest vào `GAME_DIR` không qua HTTP.

## API

`/api/me` · `/api/packs` (GET, POST, PATCH `/{pack}`, POST `/{pack}/rename`) · `/api/packs/{pack}/levels[?include_deleted]` ·
`/levels/{n}` GET / POST / PUT (`If-Match: "r<rev>"`) / DELETE · `/levels/{n}/revisions[/{rev}[/diff]]` · `/revert` ·
`/relevel` (`swap` | `shift`, `dry_run`) · `/api/locks/…` · `/api/promote` · `/import` (`dry_run`, `force`) · `/export` · `/bundle` · `/validate` ·
`/levelhub/preflight|export|upload` (`snapshot`) · `/api/levelhub/options` · `/api/bi/*` · `/api/game*` · `/api/game/builds` ·
`/api/ci/status|levels|webgl` (token CI) · `/api/audit` · `/api/events` (SSE).
Lỗi luôn là JSON `{"detail": …}`: 412 kèm head, 423 kèm người giữ khoá, 422 kèm lỗi kiểm định.
