# Quy tắc chung của tool level (level-tool-core)

Mỗi tool level là một fork của `level-tool-core`. File này là của core và đi theo mỗi lần merge core; phần riêng của
game ghi ở `AGENTS.md` gốc repo.

## Chỗ được sửa

| Của ai | File |
| --- | --- |
| core, game không sửa | `levelcore/`, `ChayDev.bat`, `.gitignore`, `.dockerignore`, `.claude/skills/` |
| game | `game/`, `bi.yaml`, `README.md`, `AGENTS.md`, `CLAUDE.md` |

Game cần core làm thêm việc gì thì thêm điểm mở rộng ở repo core (có mặc định, game cũ không phải đổi), không sửa
`levelcore/` trong repo game. Gấp thì commit riêng chỉ đụng `levelcore/` rồi cherry-pick sang core (`levelcore/FORK.md`).

## Chạy và test

- Chạy: bấm đúp `ChayDev.bat` (server theo `RUNTIME` trong `game/game.env`, đăng nhập DEV bằng email), mở `/app/`.
  Tay: `node levelcore/node/server.mjs` hoặc server Python như `levelcore/README.md`.
- Test của game: `node --test game/tests/*.test.mjs`. Phải xanh trước khi commit.
- Sửa core (ở repo core): `node levelcore/contracts/run.mjs` chạy hợp đồng chung với cả hai server.
- Game mẫu `levelcore/contracts/sample` chỉ là dữ liệu test của core: không chép luật, field hay giao diện từ đó.

## Viết phần của game

1. Lấy vài level raw thật đặt vào `game/tests/raw/<số>.json` (`new_game.mjs --raw <thư mục>` chép sẵn). Luật viết theo
   raw thật, không đoán.
2. `game/web/rules.mjs`: `validateLevel(level, {levelNo, formatVersion})` và `blankLevel(n, template)` là bắt buộc. Hook
   thêm khi cần (`levelSummary`, `levelChanges`, `setLevelNumber`, `describeHub`, `hubLayout`, danh sách `fields`): bảng
   "Module luật" trong `levelcore/contracts/README.md`. File này chạy cả ở server lẫn trình duyệt: JS thuần, không DOM,
   không `node:*`; được import file khác trong `game/web/`. Dùng lại validator sẵn có của repo game thì chép các module
   cần vào `game/web/` và ghi commit nguồn trong `AGENTS.md` gốc, để biết khi nào phải chép lại.
3. `game/manifest.json`: tên, tiền tố biến, `formatVersion`, `levelhub` (acronym, mã vật cản), `webgame` (id, tag của
   bridge trong bản Unity). Game đổi định dạng level thì tăng `formatVersion`.
4. Chạy test, mở tool, nhập một zip raw thật, sửa một level, chơi thử nếu đã có bản WebGL.

## Giao diện

- Chưa làm gì thì tool dùng vỏ của core (danh sách, form từ `fields`, JSON, lịch sử, nhập / xuất, Level Hub, chơi thử).
  Vỏ này nằm trong `levelcore/`; không chép nó hay code giao diện của game khác vào `game/`.
- Game muốn giao diện riêng thì tự thiết kế cho đúng cách GD làm việc với game đó: thư mục riêng (vd `game/app/`), khai
  `"app": "app"` trong manifest. Khi đó `/app/` là giao diện của game; module của core import ở `/core/js/`: `api.mjs`
  (gọi `setStoragePrefix` trước), `sync.mjs` (SSE, khoá), `query.mjs` (tìm theo số, dải, chữ không dấu), `fields.mjs`,
  `webgame.mjs` (khung game WebGL), `playrecorder.mjs` (ghi lượt chơi), `keymap.mjs`, `palette.mjs` (tìm nhanh Ctrl+K),
  `gallery.mjs` (ảnh level, chụp ảnh), `share.mjs`, `levelhub_bi.mjs`, `biauth.mjs`, `releases.mjs`; hàm thuần của
  `overview.mjs` (`numericKeys`, `groupKeys`, `lineChart`, `warnings`) và `reorder.mjs` (`moveItems`, `undoOrder`).
- Bridge của bản WebGL nên khai `caps: ['capture']` (ảnh level) và gửi `{type: 'event'}` cho mỗi nước đi: dữ liệu lượt
  chơi dùng cho phân tích, solver, AI về sau (`levelcore/contracts/README.md`, mục Bridge).
- Giao diện riêng vẫn phải giữ các luồng an toàn của core: khoá khi sửa, lưu với `If-Match`, xử lý 412 (xung đột) và 423
  (đang khoá), nhập qua bước xem trước.
- Bố cục giữ quen tay với Sand Jam / AntLevel, như vỏ của core: hàng trên là các màn (Level, Thư viện, Thứ tự, Tổng quan
  bộ, Hoạt động) và tìm nhanh Ctrl+K; hàng dưới là bộ đang mở rồi công cụ của màn; đáy là thanh trạng thái (kết nối, số
  level, bản game, phiên bản, người online) và dòng gợi ý phím của màn sửa level.
- Theo người dùng và tần suất: việc GD / Creative làm hằng ngày (tìm, mở, sửa, chơi thử, lưu) luôn thấy; việc ít dùng
  (nhập / tải, thùng rác) ở cuối danh sách hoặc menu; việc của admin (Quản trị, bản game) chỉ hiện với người có quyền
  (`rights` trong `/api/me`). Nút chỉ hiện khi dùng được ở trạng thái đó (Lưu chỉ khi đang sửa). Phần nhìn level (khung
  game, editor của game) chiếm nhiều chỗ nhất; level có trạng thái kiểm định (chấm xanh / cam / đỏ) ở mọi danh sách.

## Deploy và phát hành

- Deploy lên BI Center bằng `bi.yaml`; dùng các skill BI chính thức: `bi-new`, `bi-onboard`, `bi-yaml`, `bi-release`.
- Trên BI bắt buộc có `<PREFIX>_SESSION_SECRET`, `<PREFIX>_ADMINS`, các biến `<PREFIX>_BI_*`. Nhận bản game và level từ
  Jenkins: `<PREFIX>_CI_TOKEN` (cùng giá trị secret `LEVEL_TOOL_TOKEN` của Jenkins), `<PREFIX>_CI_BRANCH`.
- Tag phát hành `<slug>-vX.Y.Z`. Không push, tag hay mở PR khi chưa hỏi người dùng.

## Changelog

Viết cho người đọc, không phải nhật ký commit. Tool: bảng **Có gì mới** trong app, dữ liệu ở `game/web/releases.json`,
người đọc là GD. Core: `levelcore/CHANGELOG.md`, người đọc là Dev Game. Test kiểm khung (`levelcore/web/js/releases.mjs`).

- Entry: `version`, `date` (dd/MM/yyyy, để trống tới khi tag), `title` (tối đa 60 ký tự, nói chủ đề chính), rồi các phần
  theo đúng thứ tự, phần trống thì bỏ:
  - `notice` **Cần chú ý**: việc phải làm sau khi lên bản (tải lại trang, thêm biến) và thay đổi dễ gây nhầm (số liệu
    đổi cách tính, dữ liệu tự chuyển). Ở core: bước nâng cấp bắt buộc.
  - `added` **Mới**: việc trước đây chưa làm được.
  - `changed` **Thay đổi**: việc cũ nay làm khác.
  - `fixed` **Sửa lỗi**: lỗi đã gặp nay không còn.
  - `dev` **Cho Dev**: route, biến môi trường, migration, hook. Không hiện trong app, chỉ vào message của tag.
- Mỗi dòng một thay đổi, một câu, tối đa 120 ký tự, không giải thích cách làm. Mở đầu bằng chỗ thấy được, đúng nhãn trong
  app (`Chơi thử:`, `Nhập:`).
- Các phần cho GD ghi điều người dùng thấy; không có tên file, hàm, route, biến môi trường hay thuật toán.
- Sửa lỗi viết theo hiện tượng: "Chơi thử không còn báo thua khi cửa sổ mất focus."
- Mỗi phần tối đa 5 dòng; nhiều hơn thì gộp theo tính năng. Lỗi sinh ra và đã sửa trong cùng phiên bản thì không ghi.
- Commit có thay đổi người dùng thấy thì thêm hoặc sửa dòng trong entry của phiên bản kế tiếp. Trước khi tag: đọc lại cả
  entry, gộp dòng cùng tính năng, chỉ giữ trạng thái cuối, đặt `date`. Message của tag là chính entry đó:
  `node levelcore/tools/releases.mjs tag <version>`.
