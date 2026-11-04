---
name: levelcore-new-game
description: Đưa một game mới vào tool level dựng trên level-tool-core (repo fork của core, layout levelcore/ + game/) - sinh game/ bằng generator, viết luật level từ raw thật, chạy tool, rồi chuyển sang các skill bi-* để deploy. Dùng khi vừa fork level-tool-core cho game mới, hoặc khi hỏi game cần viết những gì để có tool level.
---

# Đưa game mới vào level-tool-core

Đọc `levelcore/AGENTS.md` trước (chỗ được sửa, giao diện, changelog). Không sửa gì trong `levelcore/`; thiếu gì ở core
thì ghi lại để đề xuất cho repo core.

## 1. Kiểm repo

- Có `levelcore/`, chưa có `game/`. Remote `core` trỏ `level-tool-core` (cách fork: `levelcore/FORK.md`).
- Có Node >= 22.13 (`node -v`). Server Python thì thêm Python 3.10+.

## 2. Hỏi người dùng (một lần, đủ các ý)

- Tên tool (vd FishLevel), tên game, tiền tố biến (vd FISHLEVEL), slug BI (vd fishsort), server `node` (mặc định) hay
  `python`.
- Raw level thật: lấy ở đâu, vài file mẫu, luật hợp lệ (Dev Game đưa). Không có raw thì dừng ở bước này.
- Bản WebGL: id và tag của bridge trong bản Unity (nếu đã có), app BI, acronym Level Hub và mã vật cản (nếu đẩy BI).

## 3. Sinh và viết phần của game

```sh
node levelcore/tools/new_game.mjs --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort --runtime node
```

1. Chép raw thật vào `game/tests/raw/<số>.json` (không sửa tay).
2. Viết `game/web/rules.mjs` từ raw và luật của Dev Game: `validateLevel`, `blankLevel`; thêm `levelSummary` (vài số cho
   danh sách), `setLevelNumber` nếu raw chứa số level, `fields` cho các thông số GD hay sửa, `describeHub` / `hubLayout`
   nếu đẩy Level Hub. Hợp đồng từng hook: `levelcore/contracts/README.md`.
3. Điền `game/manifest.json` (`levelhub`, `webgame`, `biAppId`) và `AGENTS.md` gốc (nguồn raw, định dạng).
4. `node --test game/tests/*.test.mjs` xanh. Test báo raw đổi qua JSON thì ghi lại cho người dùng.

Không chép luật, field hay giao diện từ `levelcore/contracts/sample` hay từ game khác.

## 4. Chạy thử

Bấm đúp `ChayDev.bat` (hoặc `node levelcore/node/server.mjs` với `<PREFIX>_DEV=1`), vào bằng email DEV. Nhập zip raw
thật, mở một level, sửa một field, lưu, xem Lịch sử. Có bản WebGL thì tải lên ở ⬆ trong khung game và chơi thử.

## 5. Giao diện

Mặc định là vỏ của core, không cần viết gì. Người dùng muốn giao diện riêng thì thiết kế cho đúng việc của GD với game
đó (không dựa theo vỏ của core), đặt ở `game/app/`, khai `"app": "app"` trong manifest, dùng module ở `/core/js/` như
`levelcore/AGENTS.md` mục Giao diện. Giữ các luồng khoá, `If-Match`, xung đột, xem trước khi nhập.

## 6. Deploy và bàn giao

- Thêm dòng vào `game/web/releases.json` theo khung changelog; test kiểm khung phải xanh.
- Deploy: skill `bi-onboard` / `bi-yaml` với `bi.yaml` đã sinh, phát hành bằng `bi-release`. Không push, tag khi chưa hỏi.
- Báo người dùng: các file đã viết trong `game/`, chỗ phải chép tay hay đoán, điều core còn thiếu.
