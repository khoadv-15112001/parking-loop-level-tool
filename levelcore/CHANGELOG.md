# Changelog của level-tool-core

Người đọc là Dev Game khi nâng core. Quy tắc viết: [`AGENTS.md`](AGENTS.md) mục Changelog; kiểm bằng
`node levelcore/tools/releases.mjs check levelcore/CHANGELOG.md`.

## 0.2.0 · chưa phát hành · Hai server, game khai bằng manifest, CI và Level Hub

### Cần chú ý
- Nhập level: không ghi đè level đã sửa trong tool (bật "Ghi đè" nếu cần); file lỗi, level đang khoá báo riêng.
- Game khai bằng manifest: `<PREFIX>_ADMINS` rỗng là không ai làm admin, trừ máy DEV. Plugin Python cũ giữ luật cũ.
- Xuất Level Hub: Xuất và Đẩy lên BI dùng đúng bản lúc bấm Kiểm tra; đổi tham số thì phải Kiểm tra lại.
- Nhận bản game và level từ Jenkins: `<PREFIX>_CI_TOKEN` trên BI cùng giá trị Jenkins secret `<slug>-level-tool-token`.
- Server Node: level đã xoá và bộ lưu trữ bị xoá hẳn sau 30 ngày (đổi ở Quản trị); lưu trữ bộ phải ghi lý do.

### Mới
- Core sinh manifest, luật và test cho game mới, có mẫu Sand Jam với bố cục màn, popup và thành phần UI.
- Server Node đủ route như server Python; bản game từ Jenkins: nhánh theo dõi lên ngay, nhánh khác chờ admin chọn.
- Chơi thử: link + QR, ▶ Chơi rN, kích thước màn hình (cố định để chụp SS, 📷); lượt chơi được lưu, xuất JSONL.
- Màn Thư viện, Thứ tự, Tổng quan bộ, Hoạt động; Level Hub có chọn dải trực quan, ảnh game và lịch sử đẩy.
- Quản trị Node: sao lưu nén, tối đa 7 bản / 200 MB; thùng rác, quyền, phím tắt và bố cục tự chỉnh.

### Thay đổi
- Tìm level theo số, dải `10-20`, `2,5,9`, chữ không dấu; ô chọn bộ tìm được, có tóm tắt, 🔗 link; form từ `fields`.
- Lưu và nhập: xung đột có so sánh và "Lưu thành bản sao"; Nhập xem trước từng level trước khi ghi.
- Giao diện mặc định như Sand Jam / AntLevel: thanh màn, hàng của bộ, thanh trạng thái, gợi ý phím; Lưu chỉ hiện khi sửa.
- Đẩy lên BI: kiểm tên trùng, gợi ý version; lỗi 409/413 có gợi ý, mất phản hồi thì tìm lại bộ vừa tạo.
- Bản game: giữ 1 bản quay lại và 1 bản chờ trong 800 MB; kiểm tra chỗ trống dưới mốc 1,5 GB trước khi nhận.

### Sửa lỗi
- Server Python: không còn giữ kết nối SQLite của luồng đã kết thúc khiến RAM tăng dần.
- Level Hub: chặn snapshot trùng, level đã xoá và dải quá lớn; ảnh game kèm đúng nội dung level trên Node.
- Tài liệu Level Hub: ảnh đầy đủ của Sand Jam, phân biệt tiện ích đã có trong core và phần giao diện chưa có.

### Cho Dev
- Route mới (chỉ server Node): `/api/plays*`, `/api/links*`, `/p/<token>*`, `/api/thumbs/*`, `/reorder`, `/api/admin/*`.
- Biến `<PREFIX>_CI_*`; manifest thêm `slug`, `storagePrefix`, `webgame`, `app`, `overview`, `layout`, `uiTemplate`.
- DB: bảng `ci_levels`, `settings`, `plays`, `play_events`, `share_links`, `thumbs`; revision ghi `formatVersion`.
- Bridge: `ready {caps: ['capture']}`, lệnh `Capture`, sự kiện `{type: 'event'}` vào lượt chơi, `src=` ở `level_start`.
- Runtime: ưu tiên Node (`deploy/Dockerfile.node`, `RUNTIME`); Python giữ tương thích, UI thêm qua `game/web/ui.mjs`.
