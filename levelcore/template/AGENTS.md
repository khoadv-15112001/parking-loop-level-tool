# __TOOL__

Tool level của __GAME__, fork của level-tool-core. Quy tắc chung (chỗ được sửa, cách chạy, test, changelog, giao diện):
`levelcore/AGENTS.md`, đọc trước. File này chỉ ghi phần riêng của __GAME__; cập nhật khi biết thêm.

## Level của __GAME__

- Nguồn raw: chưa ghi (repo / thư mục game xuất level, cách lấy bản mới).
- Định dạng: formatVersion 1 (`game/manifest.json`); ghi lại khi game đổi định dạng.
- Luật: `game/web/rules.mjs`, kiểm bằng raw thật trong `game/tests/raw/`.

## Giao diện

Đang dùng vỏ của core. Khi làm giao diện riêng (`"app"` trong manifest), ghi thư mục và cách chạy ở đây.
