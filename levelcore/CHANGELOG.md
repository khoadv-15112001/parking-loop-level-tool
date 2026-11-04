# Changelog của level-tool-core

Người đọc là Dev Game khi nâng core. Quy tắc viết: mục 6 của [`docs/KE-HOACH-CORE.md`](docs/KE-HOACH-CORE.md).

## Chưa phát hành · nhánh feature/core-v1 · Hai server, game khai bằng manifest, CI và Level Hub

### Cần chú ý
- Nhập level: level đã sửa trong tool không còn bị ghi đè; muốn ghi đè phải bật "Ghi đè" hoặc gọi `?force=true`.
- Nhập level: file lỗi và level đang khoá được báo riêng trong kết quả, không còn chặn cả lượt nhập.
- Game khai bằng manifest: `<PREFIX>_ADMINS` rỗng là không ai làm admin, trừ máy DEV. Plugin Python cũ giữ luật cũ.
- Xuất Level Hub: Xuất và Đẩy lên BI dùng đúng bản lúc bấm Kiểm tra; đổi tham số thì phải Kiểm tra lại.
- Nhận bản game và level từ Jenkins: thêm `<PREFIX>_CI_TOKEN` trên BI, cùng giá trị secret `LEVEL_TOOL_TOKEN` của Jenkins.

### Mới
- Game mới chỉ cần `game/manifest.json` và một module luật JS; giao diện riêng thì khai `app` và dùng module ở `/core/`.
- Server Node `levelcore/node` đủ route như server Python; test hợp đồng chung: `node levelcore/contracts/run.mjs`.
- Bản game từ Jenkins: build nhánh theo dõi lên ngay kèm level của lần chạy đó, nhánh khác chờ admin chọn ở ⬆ Bản game.
- Chơi thử: ▶ Chơi rN trong Lịch sử chơi đúng revision đó; khung game ghi rõ đang chơi bản nào.
- Form thuộc tính từ `fields` của game; Nhập có bước xem trước từng level trước khi ghi.

### Thay đổi
- Tìm level theo số, dải `10-20`, danh sách `2,5,9` và chữ không dấu.
- Xung đột khi lưu: thêm so sánh với bản server và lựa chọn "Lưu thành bản sao".
- Kiểm định bộ: bấm số level trong bảng lỗi để mở level đó.
- Đẩy lên BI: lỗi 409 và 413 có gợi ý; BI không trả lời sau khi tạo bộ thì tool tự tìm lại bộ vừa tạo.
- Bản game: giữ một bản trước để quay lại; gửi lại cùng bản build không cài lần hai.

### Cho Dev
- Route: `/api/ci/status|levels|webgl` (token CI), `/api/game/builds[/{id}/activate]`, `snapshot` trong `levelhub/*`.
- Biến: `<PREFIX>_CI_TOKEN`, `<PREFIX>_CI_BRANCH`, `<PREFIX>_CI_PACK`; manifest thêm `app`.
- DB: bảng `ci_levels`; revision mới ghi `formatVersion` vào `meta.format` (API `format`, revision cũ là `null`).
- `GET /api/me` trả thêm `runtime`, `format_version` và `features`; web ẩn nút của tính năng server không có.
- Khung game gửi `source` (`draft` | `rN`) trong LoadPack / UpdateLevel; bridge ghi `src=` ở `level_start` để app kiểm.
