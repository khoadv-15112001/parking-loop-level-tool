# Kết quả đợt 3 — game thứ hai từ README và skill

Ngày 04/11/2026. Kết quả **mock** (Claude làm cả vai dev game, raw lấy từ repo Antopia); phần **thật** chưa chạy, ghi ở cuối.

## Cách thử

- Fork tạm của core tại `c1eae94` (nhánh `main` của game, remote `core`), ngoài repo này.
- Một phiên Claude mới (Sonnet), chỉ được dùng `README.md`, `levelcore/README.md`, `levelcore/AGENTS.md`,
  `levelcore/contracts/README.md` và skill `levelcore-new-game`; không đọc code core.
- Game: Antopia (lưới pixel, schema khác hẳn game mẫu). Raw thật: `antopia-level-tool/tests/fixtures_ant/Classic`.
  Luật: validator của game `core/schema/validate.mjs`, chỉ yêu cầu port phần tối thiểu.

## Số đo

| | |
| --- | --- |
| Thời gian từ checkout tới lần nhập và sửa level đầu (qua API) | 3 phút 20 giây (Claude làm; người làm sẽ lâu hơn) |
| File game tự viết | `game/web/rules.mjs` (122 dòng), thêm vào `game/tests/rules.test.mjs` (+23), `AGENTS.md` gốc (+11), `releases.json` (+2) |
| File generator sinh, không sửa | `manifest.json`, `game.env`, `.env.example`, `bi.yaml`, `README.md`, `CLAUDE.md`, `releases.test.mjs` |
| Sửa trong `levelcore/` | 0 |
| Test của game | 6/6 xanh |
| Luồng chạy được | nhập zip (xem trước rồi ghi), danh sách có tóm tắt, sửa với `If-Match`, 412 khi sửa từ bản cũ, kiểm định bộ, nhập lại báo "chờ game" |
| Nâng core bằng merge | 2 lần (`c1eae94` → `2172432` → `6a0df46`), không xung đột, không đụng file nào của game, test vẫn xanh |

## Chỗ phải chép tay hoặc đoán → đã sửa ở core

| Vướng | Sửa |
| --- | --- |
| Không rõ chữ ký, kết quả của `levelSummary`, `levelChanges`, `setLevelNumber`, `blankLevel(n, template)` | Bảng "Module luật" trong `contracts/README.md` |
| Không rõ cú pháp `path` và `options` của `fields`; game khai `path: 'time'` làm tab Tổng quan trống (chỉ thấy khi mở trình duyệt) | `path` nhận cả chuỗi có dấu chấm; field thiếu path bị bỏ qua kèm dòng báo; tài liệu ghi rõ |
| Không rõ cách gửi zip khi nhập, body của `PUT`, khi nào có 422 | Mục "Gọi API bằng tay" và "Lưu level lỗi kiểm định" |
| Không có lệnh zip trên Windows | `levelcore/tools/zip_raw.mjs` |
| Cổng 8880 trùng tool khác, chép raw bằng tay | `new_game.mjs --port`, `--raw` (chép tối đa 8 raw, giữ nguyên byte) |
| Git đổi xuống dòng của raw | `.gitattributes` trong starter: `game/tests/raw/** -text` |

## Ứng viên cải tiến tiếp (chưa làm)

- Dùng lại validator của repo game thay vì chép hằng số: hiện chỉ có hướng dẫn chép module vào `game/web/` và ghi commit
  nguồn. Đáng làm khi có game thứ hai thật cần.
- `levelcore/tools/smoke.mjs` làm trọn luồng DB tạm → nhập → sửa → kiểm định → tắt (hôm nay gõ tay bằng curl).
- Khung `rules.mjs` sinh từ raw (khoá bắt buộc, kiểu, min/max): phần kiểm trường giống nhau giữa các game. Chưa làm vì
  sinh từ raw là đoán luật; để Dev Game quyết.

## Chưa chạy (phần thật)

- Dev Game tự làm với game thật của team, đo thời gian người làm.
- Build và chạy container (`Dockerfile`, `Dockerfile.node`): máy làm đợt này không có Docker.
- Restore DB và nạp lại player trên BI; smoke bi-dev (đăng nhập, Level Hub), Jenkins, bản Unity thật: chờ quyền và
  project theo `SMOKE-DOT2.md` phần B.
