# Hợp đồng v1 của level-tool-core

Hai server của core phải trả cùng hình dữ liệu cho các route dưới đây:

- Python: `levelcore/server` (FastAPI), chạy bằng `uvicorn --factory levelcore.main:get_app`.
- Node: `levelcore/node` (không dependency, cần Node >= 22.13), chạy bằng `node levelcore/node/server.mjs`.

Bộ test `v1/*.test.mjs` gọi server qua HTTP nên chạy được với cả hai. Game dùng cho test là `sample/` (manifest + luật JS):
đó là dữ liệu test của core, không phải mẫu để game chép. Game mới bắt đầu từ `levelcore/tools/new_game.mjs`.

## Chạy

```sh
node levelcore/contracts/run.mjs          # Python rồi Node
node levelcore/contracts/run.mjs python
node levelcore/contracts/run.mjs node
```

Mỗi runtime: dựng server trên DB tạm với đăng nhập DEV (`a@sonat.vn` là admin, `b@sonat.vn` không), BI và Firebase giả
(`fake_bi.mjs`), token CI và nhánh CI `main`; đợi `/healthz`, chạy test rồi tắt. Python lấy từ `$PYTHON`, nếu không có
thì `.venv` của repo. Muốn chạy test với một server đang chạy sẵn: `BASE_URL=http://127.0.0.1:8880 node --test
levelcore/contracts/v1/*.test.mjs` (test BI và CI cần thêm `FAKE_BI_URL`, `CI_TOKEN` như `run.mjs` đặt).

Test riêng từng server (phần cần chỉnh đồng hồ, giao diện riêng của game): `pytest` trong `levelcore/server` và
`node --test levelcore/node/tests/*.test.mjs`.

## Route

| Route | Python | Node |
| --- | --- | --- |
| `GET /healthz`, `GET /auth/status`, `POST /auth/logout` | có | có |
| `GET /api/me` (kèm `runtime`, `format_version`, `features`) | có | có |
| `GET/POST /api/packs`, `PATCH /api/packs/{pack}`, `POST /api/packs/{pack}/rename` | có | có |
| `GET /api/packs/{pack}/levels[?include_deleted]`, `/bundle`, `/validate` | có | có |
| `GET/POST/PUT/DELETE /api/packs/{pack}/levels/{n}` (ETag, `If-Match: "r<rev>"`) | có | có |
| `…/levels/{n}/revisions[/{rev}[/diff]]`, `POST …/revert`, `POST …/relevel` | có | có |
| `POST/PUT/DELETE /api/locks/packs/{pack}/levels/{n}[?force=1]` | có | có |
| `POST /api/promote` | có | có |
| `POST /api/packs/{pack}/import[?dry_run&force&folder&message]`, `GET …/export` | có | có |
| `GET /api/audit`, `GET /api/events` (SSE) | có | có |
| `GET /app/*` (vỏ web hoặc giao diện riêng của game), `/app/game/*` (module web của game), `/core/*` (module của core) | có | có |
| Đăng nhập Google của BI: `GET /bi/login`, `POST /auth/firebase` | có | có |
| Level Hub: `GET /api/levelhub/options`, `POST /api/packs/{pack}/levelhub/preflight\|export\|upload` | có | có |
| BI: `GET /api/bi/config`, `/api/bi/asset-groups[/{id}/files[/{file}/raw]]`, `/api/bi/groups/{id}`, `POST /api/bi/groups/{id}/{action}` | có | có |
| Bản game: `GET /api/game`, `POST /api/game/upload`, `/api/game/uploads…` (theo phần), `GET /game/*` | có | có |
| Bản build: `GET /api/game/builds`, `POST /api/game/builds/{id}/activate`, `DELETE /api/game/builds/{id}` (admin) | có | có |
| CI v1: `GET /api/ci/status`, `POST /api/ci/levels?by`, `POST /api/ci/webgl?by&version&commit&branch&buildNumber&buildUrl` | có | có |

Web đọc `features` trong `/api/me` để ẩn nút của tính năng server không có. Server cũ không trả `features` thì coi như đủ.

## Giao diện riêng của game

Manifest có `"app": "<thư mục>"` thì `/app/` phục vụ thư mục đó thay vỏ của core: game tự làm giao diện, không theo bố
cục của core. Module của core vẫn mở ở `/core/` để import: `/core/js/api.mjs` (client API, gọi `setStoragePrefix` trước),
`query.mjs` (tìm theo số, dải, chữ không dấu), `fields.mjs` (form field), `webgame.mjs` (khung game WebGL),
`levelhub_bi.mjs`, `biauth.mjs`, `sync.mjs` (SSE, khoá). Không khai `app` thì dùng vỏ của core.

## Xuất Level Hub theo snapshot

`preflight` trả thêm `snapshot: [{level, name, rev, sha}]`. Gửi lại đúng `snapshot` đó trong body của `export` / `upload`
thì gói dùng đúng các revision đã kiểm tra, dù có người sửa level sau đó (`newer` trong kết quả upload liệt kê level
đã có bản mới hơn). Revision không còn hoặc sha khác: 409. Không gửi `snapshot` thì dùng head như trước.

Đẩy lên BI mà mất phản hồi sau khi gửi (BI không trả lời, mạng đứt): server tìm bộ cùng tên và appId vừa tạo từ lúc bấm.
Thấy thì trả như thành công kèm `recovered: true`; không thấy thì 502 với `bi_status: null`, `checked_at`, đẩy lại được.
Lỗi của BI luôn là 502 kèm `bi_status` gốc (401, 403, 409, 413 có gợi ý riêng), không thành 401/403 của tool.

## CI v1 và bản build

Jenkins (`sonat-game-cicd` `level_tool_upload.py`) gửi `Authorization: Bearer <PREFIX>_CI_TOKEN`. Token CI chỉ dùng được
cho `/api/ci/*`; phiên người dùng không gọi được `/api/ci/*` và ngược lại.

- **Bản build**: id cố định theo `buildUrl`, thiếu thì `branch#buildNumber`, thiếu nữa thì digest zip. Gửi lại bản đã có
  trả `unchanged`, kể cả hai request đồng thời. Build nhánh `<PREFIX>_CI_BRANCH` (rỗng = mọi nhánh) thành bản đang dùng;
  nhánh khác `waiting`, admin chọn ở `POST /api/game/builds/{id}/activate`. Giữ 1 bản trước để quay lại và 3 bản chờ mới
  nhất. Zip lỗi trả 400 và không đụng bản đang dùng.
- **Level CI**: zip mọi `<số>.json` vào bộ `<PREFIX>_CI_PACK` (rỗng = bộ mặc định đầu). Nằm chờ tới khi player cùng `by`
  tới (theo thứ tự nhận): player lên bản đang dùng thì nhập ngay, player chờ thì nhập khi admin chọn bản đó. Player lỗi, bản
  bị xoá / bị dọn, hoặc quá 2 giờ chưa có player thì bỏ (`dropped`, kèm lý do). Zip cùng digest đã nhập trả `duplicate`.
  Nhập theo luật ở mục Nhập level: level GD đã sửa thành `conflict`, không bị ghi đè.
- Hai lần chạy Jenkins khác nhánh cùng số build gửi cùng `by` (`jenkins-57`): level đi theo player tới trước. Thứ tự đúng
  khi mỗi lần chạy gửi level rồi player, như `level_tool_upload.py`.

Mỗi lần bản game đổi, server phát SSE `game.build` `{status, build, author, levels}`; web báo và tải lại khung game.

## Lỗi

Luôn là JSON `{"detail": "…", …}`: 400 dữ liệu sai · 401 chưa đăng nhập · 403 không có quyền hoặc bộ chỉ đọc ·
404 · 409 trùng hoặc mất khoá · 412 sửa từ bản cũ (kèm `head_rev`, `author`, `body` của head) · 413 quá lớn ·
422 lỗi kiểm định (kèm `validation`) · 423 đang bị khoá (kèm `holder`) · 428 thiếu `If-Match`.

## Gọi API bằng tay (DEV)

Server chạy với `<PREFIX>_DEV=1` nhận header `X-Dev-User`. Body là dữ liệu thô, không bọc multipart:

```sh
node levelcore/tools/zip_raw.mjs game/tests/raw data/raw.zip            # zip mọi <số>.json, chạy được trên mọi hệ điều hành
curl -X POST -H "X-Dev-User: a@sonat.vn" -H "Content-Type: application/zip" --data-binary @data/raw.zip \
  "http://localhost:8880/api/packs/develop/import?dry_run=true"          # bỏ dry_run để ghi
curl -H "X-Dev-User: a@sonat.vn" http://localhost:8880/api/packs/develop/levels/2
#   → {pack, name, level_no, rev, author, …, level: {…raw…}, lock}; ETag "r<rev>"
curl -X PUT -H "X-Dev-User: a@sonat.vn" -H 'If-Match: "r1"' -H "Content-Type: application/json" \
  --data-binary @level2.json http://localhost:8880/api/packs/develop/levels/2   # body là raw của level, không bọc
```

`PUT` thiếu `If-Match` → 428, `If-Match` cũ → 412 kèm head. Sửa không giữ khoá vẫn lưu được nhưng revision ghi
`unlocked_edit: true`; vỏ web luôn khoá trước khi sửa (`POST /api/locks/packs/{pack}/levels/{n}`).

## Nhập level

`POST /api/packs/{pack}/import` nhận zip (mọi `<số>.json`, `Content-Type: application/zip`) hoặc JSON `{"<số>": level}` /
`{"levels": {…}}`. Trả số đếm theo trạng thái và `items: [{name, status, …}]`. Mốc so sánh là revision `import` gần nhất.

| Trạng thái | Nghĩa | Có ghi? |
| --- | --- | --- |
| `created` | level chưa có (hoặc đã xoá) | có |
| `updated` | tool chưa sửa gì kể từ lần nhập trước | có |
| `unchanged` | giống hệt bản đang có | không |
| `conflict` | tool đã sửa và file cũng khác mốc (hoặc level tạo trong tool, chưa từng nhập) | chỉ khi `force` |
| `waiting` | tool đã sửa, file vẫn là bản của mốc ("chờ game") | chỉ khi `force` |
| `locked` | người khác đang khoá level | không |
| `error` | tên không phải số, không phải JSON hoặc không phải object | không |

`dry_run=true` chỉ trả danh sách, không ghi. Level lỗi kiểm định vẫn được nhập (kèm `errors` để xem trước). Level không
có trong file thì giữ nguyên.

## Game khai bằng manifest

`game/manifest.json` (hoặc đường dẫn trong `LEVELCORE_GAME_MANIFEST`), đường dẫn tính từ thư mục của manifest:

```json
{
  "tool": "SampleLevel", "game": "Sample", "prefix": "SAMPLELEVEL", "slug": "sample", "storagePrefix": "sample",
  "formatVersion": 1, "rules": "web/rules.mjs", "web": "web", "app": "app",
  "defaultPacks": ["develop", "product"], "biAppId": "com.sample.game",
  "levelhub": { "acronym": "Sample", "obstacleCodes": [["Rock", "RK"]] },
  "webgame": { "id": "sample-game", "tag": "SAMPLE" }
}
```

Bắt buộc: `tool`, `game`, `prefix`, `rules`. `web` (mặc định thư mục chứa `rules`) phục vụ ở `/app/game/`, trình duyệt
đọc được mọi file trong đó. Không có `web/game.mjs` thì core dựng nó từ manifest (`slug`, `storagePrefix`, `webgame`) và
module luật (`fields`). `app` là giao diện riêng của game (bỏ thì dùng vỏ của core). `web/releases.json` là bảng Có gì mới.

### Module luật (`rules`)

Node import thẳng; Python gọi qua một tiến trình node thường trú (`levelcore/runner/game_runner.mjs`); trình duyệt import ở
`/app/game/rules.mjs`. Module có thể import file cùng thư mục `web`, không import `node:*` hay DOM. Hook không export thì
core dùng mặc định ở cột cuối.

| Export | Chữ ký → kết quả | Core dùng ở | Không có thì |
| --- | --- | --- | --- |
| `validateLevel` | `(level, {levelNo, formatVersion}) → {isValid, errors: string[], warnings: string[]}` | Kiểm định, promote, xuất Level Hub, nhập (báo `errors`) | bắt buộc |
| `blankLevel` | `(n, template) → level`. `template` là level đang mở khi Nhân bản (hoặc `null` khi Mới); hàm tự ghi số `n` nếu raw chứa số | nút Mới / Nhân bản / lưu thành bản sao | bắt buộc |
| `levelSummary` | `(level) → {khoá: số hoặc chuỗi}` phẳng, vài giá trị | danh sách level (vỏ của core hiện "khoá giá trị"), ô tìm | `{}` |
| `levelChanges` | `(prev, cur) → string[]`, `null` = không so được | Lịch sử, kết quả lưu (`changes`), audit | `[]` |
| `setLevelNumber` | `(level, n) → level` (trả bản đã ghi số mới; sửa tại chỗ rồi trả lại cũng được) | đổi số, promote sang số khác | giữ nguyên level |
| `describeHub` | `(level, n) → {mechanics, difficulty, uniqueColor, totalBlock, time, obstacleCounts: {khoá: số}}` | metadata Level Hub | các giá trị 0 / rỗng |
| `hubLayout` | `(level) → string` | cột `layout` của Level Hub | `""` |
| `fields` | mảng `{path, label, type, options?, min?, max?, step?, hint?}` | form tab Tổng quan (vỏ của core) | không có form |

`fields`: `path` là mảng khoá / chỉ số (`['settings', 'time']`, `['goals', 0, 'count']`); `type` là `number`, `text`,
`bool` hoặc `select`; `options` của `select` là mảng giá trị hoặc `{value, label}`, giá trị giữ đúng kiểu (số vẫn là số).
Form chỉ ghi đúng field vừa sửa, field khác của level giữ nguyên.

Mỗi revision mới ghi `formatVersion` của manifest vào `meta.format`; revision cũ không có thì `format` là `null`.

### Lưu level lỗi kiểm định

Bộ thường lưu được cả level lỗi kiểm định (để GD lưu bản nháp dở); lỗi hiện ở thẻ Kiểm định và Kiểm định bộ. 422 chỉ ở
nơi level đi ra ngoài: promote sang bộ production, đổi số trong bộ production, xuất / đẩy Level Hub (kèm báo cáo).

Với game khai bằng manifest, `<PREFIX>_ADMINS` rỗng nghĩa là không ai là admin (trừ máy DEV). Plugin Python cũ giữ luật
cũ: rỗng là mọi người.
