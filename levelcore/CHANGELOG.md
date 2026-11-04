# Changelog của level-tool-core

Người đọc là Dev Game khi nâng core. Quy tắc viết: [`AGENTS.md`](AGENTS.md) mục Changelog; kiểm bằng
`node levelcore/tools/releases.mjs check levelcore/CHANGELOG.md`.

## 0.2.0 · chưa phát hành · Hai server, game khai bằng manifest, CI và Level Hub

### Cần chú ý
- Nhập level: level đã sửa trong tool không còn bị ghi đè; muốn ghi đè phải bật "Ghi đè" hoặc gọi `?force=true`.
- Nhập level: file lỗi và level đang khoá được báo riêng trong kết quả, không còn chặn cả lượt nhập.
- Game khai bằng manifest: `<PREFIX>_ADMINS` rỗng là không ai làm admin, trừ máy DEV. Plugin Python cũ giữ luật cũ.
- Xuất Level Hub: Xuất và Đẩy lên BI dùng đúng bản lúc bấm Kiểm tra; đổi tham số thì phải Kiểm tra lại.
- Nhận bản game và level từ Jenkins: thêm `<PREFIX>_CI_TOKEN` trên BI, cùng giá trị secret `LEVEL_TOOL_TOKEN` của Jenkins.

### Mới
- Game mới: `new_game.mjs` chỉ sinh manifest, luật JS, test; core dựng giao diện, game muốn riêng thì khai `app`.
- Server Node `levelcore/node` đủ route như server Python; test hợp đồng chung: `node levelcore/contracts/run.mjs`.
- Bản game từ Jenkins: nhánh theo dõi lên ngay kèm level của lần chạy, nhánh khác chờ admin chọn ở ⬆ Bản game.
- Chơi thử: ▶ Chơi rN trong Lịch sử chơi đúng revision đó; khung game ghi rõ đang chơi bản nào.
- Có gì mới: bảng trong app đọc `game/web/releases.json`, test kiểm khung changelog cho game và core.

### Thay đổi
- Tìm level theo số, dải `10-20`, danh sách `2,5,9` và chữ không dấu; form thuộc tính từ `fields` của game.
- Lưu và nhập: xung đột có so sánh và "Lưu thành bản sao"; Nhập xem trước từng level trước khi ghi.
- Kiểm định bộ: bấm số level trong bảng lỗi để mở level đó.
- Đẩy lên BI: lỗi 409 và 413 có gợi ý; BI không trả lời sau khi tạo bộ thì tool tự tìm lại bộ vừa tạo.
- Bản game: giữ một bản trước để quay lại; gửi lại cùng bản build không cài lần hai.

### Cho Dev
- Route: `/api/ci/*` (token CI), `/api/game/builds`, `snapshot` trong `levelhub/*`; `/api/me` thêm `features`, `runtime`.
- Biến `<PREFIX>_CI_TOKEN|CI_BRANCH|CI_PACK`; manifest thêm `slug`, `storagePrefix`, `webgame`, `app`.
- DB: bảng `ci_levels`; revision mới ghi `formatVersion` vào `meta.format` (API `format`, revision cũ là `null`).
- Khung game gửi `source` (`draft` | `rN`) trong LoadPack / UpdateLevel; bridge ghi `src=` ở `level_start` để app kiểm.
- Mới: `deploy/Dockerfile.node`, `RUNTIME` trong `game.env`, `AGENTS.md`, skill `levelcore-new-game`; bỏ template plugin.
