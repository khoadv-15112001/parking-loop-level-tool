# ParkingLevel

Tool level của Parking Loop, fork của level-tool-core. Quy tắc chung (chỗ được sửa, cách chạy, test, changelog, giao diện):
`levelcore/AGENTS.md`, đọc trước. File này ghi kiến thức ổn định riêng của Parking Loop; `game/WORKLOG.md` ghi đang làm tới
đâu. Người dùng viết tiếng Việt: trả lời bằng tiếng Việt.

## Giữ tài liệu cho phiên sau (bắt buộc, mọi task)

Người dùng hay hết token và chuyển sang phiên Claude / tài khoản khác. Phiên mới chỉ biết những gì hai file này ghi, nên cuối
**mọi** task có sửa file (trước `wrap_up` / lời kết):

1. `game/WORKLOG.md`: thêm mục lên đầu "Nhật ký" (ngày, yêu cầu một dòng, đổi gì: file + số / quyết định chính, nguyên nhân
   nếu là sửa lỗi, cái gì **chưa kiểm**). Cập nhật "Trạng thái hiện tại"; xoá mục đã xong.
2. `AGENTS.md` (file này): chỉ khi kiến thức ổn định đổi (module mới, mốc commit Unity đã port, cách làm, bẫy mới).
3. Ngắn gọn: điều phiên mới cần biết, không chép diff. Mục nhật ký cũ hơn ~20 mục thì gộp thành một dòng.

## Repo

- Remote `origin` = `git@github.com:khoadv-15112001/parking-loop-level-tool.git` (tạm; repo trong `SonatGameProduct` chờ
  techlead tạo, khi có thì `git remote set-url origin …` rồi push). Remote `core` = level-tool-core (merge bản core mới).
- Hỏi trước mỗi lần commit / push / tag (levelcore/AGENTS.md). Commit kết thúc bằng dòng Co-Authored-By theo hướng dẫn phiên.
- Chạy dev tay (Git Bash, không cần ChayDev.bat):
  `PARKINGLEVEL_DEV=1 PARKINGLEVEL_PORT=8894 PARKINGLEVEL_PUBLIC_BASE=http://localhost:8894 PARKINGLEVEL_DB="$PWD/data/dev.db" node levelcore/node/server.mjs`
  rồi mở `http://localhost:8894/app/`. `data/` bị git bỏ qua (db dev, zip raw).

## Level của Parking Loop

- Nguồn raw: repo Unity `C:\Users\HIUU HIUU\Documents\my-unity-project\parking-loop` (GitHub `SonatGameProduct/parking-loop`,
  nhánh `khoadv/parking-loop`), thư mục `Assets/_Game/Levels/Level_NNNN[_v].json` (867 file, biến thể A/B: không hậu tố =
  `a`, còn lại `b c e f g h i j l m n x y z`).
- Tool lưu nguyên raw đó. Tên level trong tool = NNNN (bỏ số 0 đầu), mỗi biến thể là một bộ: `a` → bộ `develop`,
  biến thể khác → bộ `ab-<v>` (vd `ab-x`). `li` trong raw = số level (`setLevelNumber`).
- Đưa level vào / ra tool: `game/tools/unity_levels.mjs`
  - `node game/tools/unity_levels.mjs zip <Assets/_Game/Levels>` → `data/unity/<v>.zip`, nhập ở ⇪ Nhập của bộ tương ứng.
  - Xuất bộ từ tool (⇩ Tải) rồi `node game/tools/unity_levels.mjs unzip <zip> <Assets/_Game/Levels> --variant x [--dry]`.
- Định dạng: formatVersion 1. File gọn (Newtonsoft bỏ trường mặc định): thiếu `p` = (0,0), thiếu `cn` = không nối,
  `cn` (0,0) ghi rõ = nối, `pf.tl` 0 = vòng 5 chỗ. Editor chỉ ghi trường cần, giữ kiểu gọn.

## Luật (port từ bản Unity)

Chép tay từ `Assets/_Game/Scripts/Core/` của repo Unity (đã theo tới commit `923942cc` ngày 24/11/2026; Core không đổi từ
`2eb94342`: vòng chạy ngược chiều kim đồng hồ, cổng ở trạm dưới W/2, xe vào / ra vòng cần một trạm trống trước và sau):

| Unity | Tool |
| --- | --- |
| `LevelFormat/LevelModels.cs`, `LevelDecoder.NormalizeAfterDecode`, `LoopLevelConverter.cs`, `ParkingLevelValidator.cs` | `game/web/format.mjs` |
| `ParkingModel.cs` (chỉ bãi cột; bãi mũi tên / tường / cổng / đèn không có trong Level_*.json) | `game/web/model.mjs` |
| `ParkingLevelSolver.cs` (`SolveSettled`, `ReplaySettled`), `ParkingLevelChecker.cs` | `game/web/solver.mjs` |

Unity đổi một trong các file trên thì chép lại thay đổi và chạy `node --test game/tests/*.test.mjs`: `model.test.mjs`
giữ các level mẫu mà test Unity (`ParkingLevelDataTests.LoopLevel_IsSolvable`) khẳng định giải được. Kiểm Unity đổi gì:
`git -C <repo Unity> log --oneline <commit đã port>..HEAD -- Assets/_Game/Scripts/Core Assets/_Game/Scripts/View`.
Chưa port: đọc level nén (gzip / brotli / binary), crossway hai hàng làn (game cũng chơi thành một hàng), xe ma `gc`, băng ở bãi `ic`.

## Hình, chuyển động, VFX (port từ `Assets/_Game/Scripts/View/`, theo tới `923942cc`)

Màn Chơi thử, ảnh bàn chơi ở Editor và ảnh nhỏ ở Thư viện dùng chung một renderer, vẽ như scene Gameplay của Unity:

| Unity | Tool |
| --- | --- |
| `ParkingLayout.cs` (toạ độ thế giới, đường vòng bo góc 0.9, `LoopAt`, `BodyOnLoop`, `BayPos`, `TransitRoute`) | `game/web/layout.mjs` |
| `CarView.cs` (`Step`, `UpdateBody`, leg / merge / loop follower, drift, khói xả, bóng) | `game/web/carview.mjs` |
| Model `Prefabs/Car.prefab` + vật liệu `Car_*.mat`, scene: camera trực giao nghiêng 72°, đèn Euler(55,-35) 1.15 + Euler(40,140) 0.45, ambient phẳng (0.55,0.58,0.62) | `game/web/carmesh.mjs` (WebGL, BRDF của URP Lit) |
| `ParkingLoopSign.cs` + object `Sign-ConveyorCount` trong `Gameplay.unity` (bảng đếm vòng 3D thay LoopBadge: chân cột ở (W+0.62, 0, -1.7), trượt ngang cho lọt khung, chữ used/cap nảy khi đổi, đỏ + đập khi đầy, lắc khi FlashLoop, hạt HitToSign khi thêm chỗ) | `playview.mjs` (`signPos`, `drawSign`, `flashSign`), mesh `art/sign_mesh.json` |
| `ParkingBoardView.cs` (Road_Vertical dọc tim đường, vạch, mũi tên, cỏ, vật cản làn), `ParkingGameController.cs` (`SyncViews`, transit, `DrainEvents`, `ClearRoutine`, `PopAndDestroy`, `ClearGlow`), `ParkingCameraRig.cs`, `ParkingHud.Popup / ShowCountdown`, `Editor/ParkingGeneratedFx.cs` (FX_Tap / Clear / Debris / Ice / Confetti), `ParkingPalette.cs` | `game/web/playview.mjs` |

- Toạ độ: x sang phải, z lên trên màn hình, 1 đơn vị = 1 ô làn; chiếu `screen = (ox + x·s, oy − (z·sin72 + y·cos72)·s)`.
  yaw radian, 0 = +z, dương = quay phải (như `transform.eulerAngles.y`); góc thân xe (pitch / roll / squash) bằng độ như Unity.
- Thứ tự vẽ mỗi khung (`PlayView.paint`): bàn tĩnh (vẽ một lần vào canvas phụ) → viền đỏ khi vòng đầy, tấm thang máy, vệt
  bánh, bóng xe, dây nối → canvas WebGL (khối thùng khoá / hộp khoá / gara / băng + xe 3D) → rèm, rào, số đếm, chìa khoá,
  vật rèm → hạt VFX → biển `n/cap` → chữ popup / đếm ngược / màn kết thúc.
- Đồng bộ với model như Unity: `PlayView.update(dt, m, phase, playing)` gọi `sync` (= SyncViews: đặt đích cho từng xe theo
  model) rồi `CarAnim.step`. Xe từ bãi ra cổng là **transit theo thời gian** (tốc độ VLoop·1.15) do PlayView giữ; tới nơi
  thì ui.mjs gọi `m.deliver(car)`. Tick model 128 ms (tick 0.16 / timeScale 1.25), ×1.4 khi bãi trống từ level 3
  (endgame). Băng chuyền dừng khi booster đang chờ chọn mục tiêu.
- Một context WebGL dùng chung cho mọi `PlayView` (`sharedGL`): trình duyệt giới hạn số context.
- Ảnh nhỏ: `rules.thumbnail` trả SVG (chạy cả server); trên trình duyệt `globalThis.parkingThumb` (đăng ký trong ui.mjs)
  đánh dấu SVG rồi vẽ dần ảnh như màn chơi lúc rảnh và thay vào.
- Editor (`renderEditor`, chế độ Bàn chơi): canvas `paintEdit` vẽ toàn bộ bãi, `editHit` đổi điểm bấm ra ô
  (`{kind: 'lane', x, slot}` / `{kind: 'lot', ci, row}` / `{kind: 'head', x}`; slot 0 = đáy làn, row 0 = sát đường). Bấm
  gọi `laneClick` / `lotClick` theo công cụ; kéo xe quá 6 px rồi thả = `moveCar`. Bấm đầu làn (sát đường trên) để chọn
  làn, chuột phải = bật / tắt xe ẩn. Thanh dưới công cụ: cao làn (pf.cp), sức chứa vòng (pf.tl), trộn màu. Level không
  dựng được thì hiện lưới ô màu cũ.
- Khung "Cách xếp một level" (`helpPanel`) ở đầu Editor: sửa luồng làm level hay đổi nút thì sửa cả chữ ở đây.
- Khung hình (`PlayView.fit`) căn theo `boardBounds`, không chừa chỗ cho bảng đếm vòng (bảng tự trượt vào khung).
- `game/web/edit.mjs`: mọi thao tác sửa raw của Editor (JS thuần, test ở `game/tests/edit.test.mjs`). Bãi xếp lại bằng
  `relayout(raw, cols)` (cột i có x = i, sửa mọi `cn` theo vị trí mới); xe mới thêm vào bãi phải có p tạm ngoài bãi
  (x = -9) để không trùng khoá vị trí cũ. Xếp thứ tự level trong bộ là màn Thứ tự của core (dùng `setLevelNumber`).
- Thang máy (`elv`) và vật rèm trên xe (`coc`) chỉ sửa ở tab JSON.
- Tab Chơi thử của core (khung WebGL) dùng khi có bản WebGL của game kèm bridge `parkinglevel-game` / tag `PARKINGLEVEL`.
- `game/web/game.css`: màu giao diện editor / thanh chơi.

### Art (`game/web/art/`)

Chép từ repo Unity bằng `node game/tools/unity_art.mjs "<repo Unity>"`: ảnh (danh sách `IMAGES` trong script, thu nhỏ bằng
System.Drawing của Windows PowerShell), âm thanh, font Mikado, `car_mesh.json` (mesh xe đọc từ `Car.prefab` → mesh
`.asset` YAML) và `sign_mesh.json` (bảng đếm vòng: `Sign-ConveyorCount` trong `Gameplay.unity`, nướng scale / xoay vào
đỉnh, kèm khung chữ và chỗ bắn hạt), cả hai ở `game/tools/unity_mesh.mjs`. Art trong game đổi thì chạy lại rồi commit. Thêm ảnh mới: thêm vào `IMAGES`
của script và `IMAGES` của playview.mjs.

### Bẫy đã gặp

- Project Unity để **Gamma color space** (`m_ActiveColorSpace: 0`): shader tính sáng thẳng trên màu sRGB, không chuyển tuyến
  tính, không gamma-correct đầu ra. Đã đo ảnh chụp game: nóc xe sáng ≈ 1.7 lần màu gốc, nên xe ẩn (#9a9fb8) gần trắng là đúng.
- Mesh Unity cuộn ngược chiều so với phép chiếu của tool: không lật pháp tuyến theo `gl_FrontFacing` (lật là xe tối hẳn).
- Job (generator) của PlayView có thể tạo job con (`clearRoutine` → `popAndDestroy`): khi chạy job phải giữ job mới thêm.
- Khung trình duyệt của Claude bị ẩn thì `requestAnimationFrame` bị hãm (đồng hồ ván gần như đứng): kiểm hình bằng cách
  import `/app/game/playview.mjs`, `model.mjs`, `format.mjs` trong `javascript_tool`, dựng `PlayView` trên canvas riêng rồi
  gọi `update(1/60, …)` từng bước và `paint` (level lấy qua `/api/packs/<bộ>/levels/<số>` với `authHeaders()` của
  `/app/js/api.mjs`).
- Heredoc của Git Bash hỏng với chuỗi có nhiều dấu nháy / backtick và ăn mất dấu gạch chéo ngược: ghi script ra scratchpad
  bằng Write (tên file mới, scratchpad có thể còn file cũ cùng tên) rồi chạy node.
- Ảnh chụp của khung trình duyệt bị thu nhỏ so với toạ độ CSS: khi giả lập chuột bằng `javascript_tool`, tính toạ độ từ
  `getBoundingClientRect()` + `view.P(...)`, không lấy toạ độ trên ảnh chụp.
