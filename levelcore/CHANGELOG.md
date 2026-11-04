# Changelog của level-tool-core

Người đọc là Dev Game khi nâng core. Quy tắc viết: [`AGENTS.md`](AGENTS.md) mục Changelog; kiểm bằng
`node levelcore/tools/releases.mjs check levelcore/CHANGELOG.md`.

## 0.2.0 · chưa phát hành · Hai server, game khai bằng manifest, CI và Level Hub

### Cần chú ý
- Nhập level: không ghi đè level đã sửa trong tool (bật "Ghi đè" nếu cần); file lỗi, level đang khoá báo riêng.
- Game khai bằng manifest: `<PREFIX>_ADMINS` rỗng là không ai làm admin, trừ máy DEV. Plugin Python cũ giữ luật cũ.
- Xuất Level Hub: Xuất và Đẩy lên BI dùng đúng bản lúc bấm Kiểm tra; đổi tham số thì phải Kiểm tra lại.
- Nhận bản game và level từ Jenkins: thêm `<PREFIX>_CI_TOKEN` trên BI, cùng giá trị secret `LEVEL_TOOL_TOKEN` của Jenkins.
- Server Node: level đã xoá và bộ lưu trữ bị xoá hẳn sau 30 ngày (đổi ở Quản trị); lưu trữ bộ phải ghi lý do.

### Mới
- Game mới: `new_game.mjs` chỉ sinh manifest, luật JS, test; core dựng giao diện, game muốn riêng thì khai `app`.
- Server Node đủ route như server Python; bản game từ Jenkins: nhánh theo dõi lên ngay, nhánh khác chờ admin chọn.
- Chơi thử: link + QR cho điện thoại, ▶ Chơi rN trong Lịch sử, mọi lượt chơi được lưu (xuất JSONL cho phân tích, AI).
- Màn Thư viện (lưới ảnh, lọc, chọn nhiều), Thứ tự (kéo thả, ghim, hoàn tác), Tổng quan bộ, Hoạt động; tìm nhanh Ctrl+K.
- Thùng rác, Quản trị (quyền, thông báo, sao lưu), phím tắt đổi được; mỗi người tự chỉnh bố cục (cột, khung game).

### Thay đổi
- Tìm level theo số, dải `10-20`, danh sách `2,5,9` và chữ không dấu; form thuộc tính từ `fields` của game.
- Lưu và nhập: xung đột có so sánh và "Lưu thành bản sao"; Nhập xem trước từng level trước khi ghi.
- Giao diện mặc định như Sand Jam / AntLevel: thanh màn, hàng của bộ, thanh trạng thái, gợi ý phím; Lưu chỉ hiện khi sửa.
- Đẩy lên BI: lỗi 409 và 413 có gợi ý; BI không trả lời sau khi tạo bộ thì tool tự tìm lại bộ vừa tạo.
- Bản game: giữ một bản trước để quay lại; gửi lại cùng bản build không cài lần hai.

### Cho Dev
- Route mới (chỉ server Node): `/api/plays*`, `/api/links*`, `/p/<token>*`, `/api/thumbs/*`, `/reorder`, `/api/admin/*`.
- Biến `<PREFIX>_CI_*`; manifest thêm `slug`, `storagePrefix`, `webgame`, `app`, `overview`, `layout`.
- DB: bảng `ci_levels`, `settings`, `plays`, `play_events`, `share_links`, `thumbs`; revision ghi `formatVersion`.
- Bridge: `ready {caps: ['capture']}`, lệnh `Capture`, sự kiện `{type: 'event'}` vào lượt chơi, `src=` ở `level_start`.
- Mới: `deploy/Dockerfile.node`, `RUNTIME`, skill `levelcore-new-game`, `game/web/ui.mjs` (`renderEditor`, `levelDetail`).
