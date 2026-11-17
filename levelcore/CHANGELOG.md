# Changelog của level-tool-core

Người đọc là Dev Game khi nâng core. Quy tắc viết: [`AGENTS.md`](AGENTS.md) mục Changelog; kiểm bằng
`node levelcore/tools/releases.mjs check levelcore/CHANGELOG.md`.

## 0.2.0 · chưa phát hành · Hai server, game khai bằng manifest, CI và Level Hub

### Cần chú ý
- Nhập không ghi đè level đã sửa trong tool; Xuất / Đẩy BI dùng đúng bản lúc bấm Kiểm tra, đổi tham số phải Kiểm tra lại.
- Game khai bằng manifest: `<PREFIX>_ADMINS` rỗng là không ai làm admin, trừ máy DEV. Plugin Python cũ giữ luật cũ.
- Nhận bản game và level từ Jenkins: `<PREFIX>_CI_TOKEN` trên BI cùng giá trị Jenkins secret `<slug>-level-tool-token`.
- Server Node: level đã xoá và bộ lưu trữ bị xoá hẳn sau 30 ngày (đổi ở Quản trị); lưu trữ bộ phải ghi lý do.
- Server Node: bộ cũ được cấp mã khi nâng; ô Production / Lưu trữ thay bằng trạng thái ở Quản lý bộ, bộ chờ duyệt chỉ đọc.

### Mới
- Core sinh manifest, luật, test, mẫu UI Sand Jam cho game mới; server Node đủ route như Python, nhận bản từ Jenkins.
- Chơi thử: link + QR, ▶ Chơi rN, kích thước màn hình (cố định để chụp SS, 📷); lượt chơi được lưu, xuất JSONL.
- Màn Thư viện, Thứ tự, Tổng quan bộ, Hoạt động; Quản trị: sao lưu nén, thùng rác, quyền, phím tắt, bố cục tự chỉnh.
- Quản lý bộ: mã bộ cố định, mục đích, Nháp → Chờ duyệt → Live → Lưu trữ, bàn giao, version so sánh bằng ảnh, khôi phục.
- Level: bộ dùng cùng nội dung, bộ còn bản cũ để áp bản mới; số liệu người chơi từ BI, viền đỏ / cam level khó bất thường.

### Thay đổi
- Tìm level theo số, dải `10-20`, `2,5,9`, chữ không dấu; ô chọn bộ tìm được, có tóm tắt, 🔗 link; form từ `fields`.
- Lưu gặp xung đột có so sánh, "Lưu thành bản sao"; Nhập xem trước; Level Hub chọn dải trực quan, có ảnh game.
- Giao diện mặc định như Sand Jam / AntLevel: thanh màn, hàng của bộ, thanh trạng thái, gợi ý phím; Lưu chỉ hiện khi sửa.
- Đẩy lên BI: kiểm tên, gợi ý version, ghi chú thành version của bộ; lỗi 409/413 có gợi ý, mất phản hồi thì tìm lại bộ.
- Bản game: giữ 1 bản quay lại và 1 bản chờ trong 800 MB; kiểm tra chỗ trống dưới mốc 1,5 GB trước khi nhận.

### Sửa lỗi
- Server Python: không còn giữ kết nối SQLite của luồng đã kết thúc khiến RAM tăng dần.
- Level Hub: chặn snapshot trùng, level đã xoá và dải quá lớn; ảnh game kèm đúng nội dung level trên Node.
- Tài liệu Level Hub: ảnh đầy đủ của Sand Jam, phân biệt tiện ích đã có trong core và phần giao diện chưa có.

### Cho Dev
- Route Node: `/api/plays*`, `/api/links*`, `/p/<token>*`, `/api/thumbs/*`, `/reorder`, `/api/admin/*`, `/api/live*`.
- Route bộ: `/status`, `/handover`, `/clone`, `/versions*`, `/api/diff`, `/usage`, `/apply`; hook luật `suggestFromStats`.
- Manifest: `slug`, `storagePrefix`, `webgame`, `app`, `overview`, `layout`, `uiTemplate`, `packPurposes`; biến `*_CI_*`.
- Bridge: `ready {caps: ['capture']}`, lệnh `Capture`, sự kiện `{type: 'event'}` vào lượt chơi, `src=` ở `level_start`.
- Runtime ưu tiên Node, Python giữ tương thích; UI thêm qua `game/web/ui.mjs`; số liệu BI cần `BI_SERVICE_ACCOUNT_KEY`.
