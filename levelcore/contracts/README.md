# Hợp đồng v1 của level-tool-core

Hai server của core phải trả cùng hình dữ liệu cho các route dưới đây:

- Python: `levelcore/server` (FastAPI), chạy bằng `uvicorn --factory levelcore.main:get_app`.
- Node: `levelcore/node` (không dependency, cần Node >= 22.13), chạy bằng `node levelcore/node/server.mjs`.

Bộ test `v1/*.test.mjs` gọi server qua HTTP nên chạy được với cả hai. Game dùng cho test là `sample/` (manifest + luật JS).

## Chạy

```sh
node levelcore/contracts/run.mjs          # Python rồi Node
node levelcore/contracts/run.mjs python
node levelcore/contracts/run.mjs node
```

Mỗi runtime: dựng server trên DB tạm với đăng nhập DEV (`a@sonat.vn` là admin, `b@sonat.vn` không), đợi `/healthz`, chạy
test rồi tắt. Python lấy từ `$PYTHON`, nếu không có thì `.venv` của repo. Muốn chạy test với một server đang chạy sẵn:
`BASE_URL=http://127.0.0.1:8880 node --test levelcore/contracts/v1/*.test.mjs`.

## Route của mốc 1

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
| `GET /app/*` (vỏ web), `GET /app/game/*` (module web của game) | có | có |
| Đăng nhập Google của BI: `/bi/login`, `POST /auth/firebase` | có | chưa |
| BI Level Hub: `/api/levelhub/*`, `/api/bi/*`, `/api/packs/{pack}/levelhub/*` | có | chưa (`features.levelhub = false`) |
| Bản WebGL chơi thử: `/api/game*`, `/game/*` | có | chưa (`features.webgame = false`) |

Web đọc `features` trong `/api/me` để ẩn nút của tính năng server chưa có. Server cũ không trả `features` thì coi như đủ.

## Lỗi

Luôn là JSON `{"detail": "…", …}`: 400 dữ liệu sai · 401 chưa đăng nhập · 403 không có quyền hoặc bộ chỉ đọc ·
404 · 409 trùng hoặc mất khoá · 412 sửa từ bản cũ (kèm `head_rev`, `author`, `body` của head) · 413 quá lớn ·
422 lỗi kiểm định (kèm `validation`) · 423 đang bị khoá (kèm `holder`) · 428 thiếu `If-Match`.

## Nhập level

`POST /api/packs/{pack}/import` nhận zip (mọi `<số>.json`) hoặc JSON `{"<số>": level}` / `{"levels": {…}}`. Trả số đếm theo
trạng thái và `items: [{name, status, …}]`. Mốc so sánh là revision `import` gần nhất của level.

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
  "tool": "SampleLevel", "game": "Sample", "prefix": "SAMPLELEVEL", "formatVersion": 1,
  "rules": "web/rules.mjs", "web": "web",
  "defaultPacks": ["develop", "product"], "biAppId": "com.sample.game",
  "levelhub": { "acronym": "Sample", "obstacleCodes": [["Rock", "RK"]] }
}
```

Module `rules` bắt buộc có `validateLevel(level, {levelNo, formatVersion}) → {isValid, errors, warnings}` và
`blankLevel(n, template?)`. Thêm khi cần: `levelSummary(level)`, `levelChanges(prev, cur)`, `setLevelNumber(level, n) → level`,
`describeHub(level, n)`, `hubLayout(level)`. Node gọi thẳng; Python gọi qua một tiến trình node thường trú
(`levelcore/runner/game_runner.mjs`). Mỗi revision mới ghi `formatVersion` vào `meta.format`; revision cũ không có thì
`format` là `null`.

Với game khai bằng manifest, `<PREFIX>_ADMINS` rỗng nghĩa là không ai là admin (trừ máy DEV). Plugin Python cũ giữ luật
cũ: rỗng là mọi người.
