# Changelog của level-tool-core

Người đọc là Dev Game khi nâng core. Quy tắc viết: mục 6 của [`docs/KE-HOACH-CORE.md`](docs/KE-HOACH-CORE.md).

## Chưa phát hành · nhánh feature/core-v1 · Hai server và game khai bằng manifest

### Cần chú ý
- Nhập level: level đã sửa trong tool không còn bị ghi đè; muốn ghi đè phải bật "Ghi đè" hoặc gọi `?force=true`.
- Nhập level: file lỗi và level đang khoá được báo riêng trong kết quả, không còn chặn cả lượt nhập.
- Game khai bằng manifest: `<PREFIX>_ADMINS` rỗng là không ai làm admin, trừ máy DEV. Plugin Python cũ giữ luật cũ.

### Mới
- Game mới chỉ cần `game/manifest.json` và một module luật JS; không cần viết Python.
- Server Node `levelcore/node`: cùng route với server Python cho bộ, level, lịch sử, khoá, nhập / xuất, SSE.
- Test hợp đồng chung cho hai server: `node levelcore/contracts/run.mjs`.
- Form thuộc tính: game khai `fields`, core tự dựng form ở tab Tổng quan.
- Nhập: xem trước từng level (tạo mới, cập nhật, xung đột, chờ game, đang khoá, lỗi) trước khi ghi.

### Thay đổi
- Tìm level theo số, dải `10-20`, danh sách `2,5,9` và chữ không dấu.
- Xung đột khi lưu: thêm so sánh với bản server và lựa chọn "Lưu thành bản sao".
- Kiểm định bộ: bấm số level trong bảng lỗi để mở level đó.
- Mỗi revision mới ghi `formatVersion` của game (`format` trong API); revision cũ là `null`.
- `GET /api/me` trả thêm `runtime`, `format_version` và `features`; web ẩn nút của tính năng server chưa có.
