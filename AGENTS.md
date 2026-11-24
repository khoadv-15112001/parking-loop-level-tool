# ParkingLevel

Tool level của Parking Loop, fork của level-tool-core. Quy tắc chung (chỗ được sửa, cách chạy, test, changelog, giao diện):
`levelcore/AGENTS.md`, đọc trước. File này chỉ ghi phần riêng của Parking Loop; cập nhật khi biết thêm.

## Level của Parking Loop

- Nguồn raw: repo Unity `parking-loop`, thư mục `Assets/_Game/Levels/Level_NNNN[_v].json` (867 file lúc làm tool,
  biến thể A/B: không hậu tố = `a`, còn lại `b c e f g h i j l m n x y z`).
- Tool lưu nguyên raw đó. Tên level trong tool = NNNN (bỏ số 0 đầu), mỗi biến thể là một bộ: `a` → bộ `develop`,
  biến thể khác → bộ `ab-<v>` (vd `ab-x`). `li` trong raw = số level (`setLevelNumber`).
- Đưa level vào / ra tool: `game/tools/unity_levels.mjs`
  - `node game/tools/unity_levels.mjs zip <Assets/_Game/Levels>` → `data/unity/<v>.zip`, nhập ở ⇪ Nhập của bộ tương ứng.
  - Xuất bộ từ tool (⇩ Tải) rồi `node game/tools/unity_levels.mjs unzip <zip> <Assets/_Game/Levels> --variant x [--dry]`.
- Định dạng: formatVersion 1. File gọn (Newtonsoft bỏ trường mặc định): thiếu `p` = (0,0), thiếu `cn` = không nối,
  `cn` (0,0) ghi rõ = nối, `pf.tl` 0 = vòng 5 chỗ. Editor chỉ ghi trường cần, giữ kiểu gọn.

## Luật (port từ bản Unity)

Chép tay từ `Assets/_Game/Scripts/Core/` của repo Unity (đã theo tới commit `2eb94342` ngày 24/11/2026: vòng chạy ngược chiều
kim đồng hồ, xe vào / ra vòng cần một trạm trống trước và sau):

| Unity | Tool |
| --- | --- |
| `LevelFormat/LevelModels.cs`, `LevelDecoder.NormalizeAfterDecode`, `LoopLevelConverter.cs`, `ParkingLevelValidator.cs` | `game/web/format.mjs` |
| `ParkingModel.cs` (chỉ bãi cột; bãi mũi tên / tường / cổng / đèn không có trong Level_*.json) | `game/web/model.mjs` |
| `ParkingLevelSolver.cs` (`SolveSettled`, `ReplaySettled`), `ParkingLevelChecker.cs` | `game/web/solver.mjs` |

Unity đổi một trong các file trên thì chép lại thay đổi và chạy `node --test game/tests/*.test.mjs`: `model.test.mjs`
giữ các level mẫu mà test Unity (`ParkingLevelDataTests.LoopLevel_IsSolvable`) khẳng định giải được. Chưa port:
đọc level nén (gzip / brotli / binary), crossway hai hàng làn (game cũng chơi thành một hàng), xe ma `gc`, băng ở bãi `ic`.

## Giao diện

Vỏ của core + `game/web/ui.mjs`:

- `renderEditor` (`game/web/ui.mjs`): tab Editor có hai chế độ. **Bàn chơi**: tô / xoá xe làn và bãi, xe ẩn, chìa khoá, hộp khoá, máy phát,
  nối xe, vật cản của làn (khoá màu, rào, làn màu, băng, rèm), thêm / xoá / dời làn và cột bãi. **Chơi thử**: chạy
  `model.mjs` trên canvas (tick 128 ms như bản Unity), vẽ bằng art của game (`game/web/playview.mjs`: sprite, anim, VFX, âm
  thanh), mặc định phủ cả cửa sổ với bàn chơi ở giữa; booster +1 chỗ / Xáo / Tay / Búa, hoàn tác; mỗi ván ghi lên
  `/api/plays` (build `web-sim`). **Giải**: solver chạy trong Web Worker (`solver_worker.mjs`), có Xem lời giải.
- Thang máy (`elv`) và vật rèm trên xe (`coc`) chỉ sửa ở tab JSON; editor hiện số tầng / chấm màu.
- Tab Chơi thử của core (khung WebGL) dùng khi có bản WebGL của game kèm bridge `parkinglevel-game` / tag `PARKINGLEVEL`.
- `game/web/game.css`: màu bàn theo `ParkingPalette.cs`.
- Art của màn Chơi thử nằm ở `game/web/art/`, chép từ repo Unity bằng `node game/tools/unity_art.mjs <repo Unity>` (danh sách
  file nguồn trong script: Sticker_Car_*, đường, cỏ, khoá, băng, rèm, booster, texture VFX của popup thắng, âm thanh, font
  Mikado). Ảnh được thu nhỏ bằng System.Drawing của Windows PowerShell. Art trong game đổi thì chạy lại rồi commit.
  Xe trong game là model 3D; tool dùng sticker 2D cùng màu nên dáng xe không giống hệt.
