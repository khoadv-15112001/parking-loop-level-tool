# WORKLOG — ParkingLevel (tool level Parking Loop)

Nhật ký để phiên Claude mới biết tool đang ở đâu. Đọc cùng `AGENTS.md` (kiến thức ổn định) và `levelcore/AGENTS.md`
(quy tắc chung). Mỗi task xong: thêm mục lên **đầu** phần "Nhật ký" và cập nhật "Trạng thái hiện tại".

## Trạng thái hiện tại

- Nhánh `main`, push lên `origin` = `khoadv-15112001/parking-loop-level-tool`. Repo trong `SonatGameProduct` chờ techlead tạo.
- Unity đã port tới `d1adb3de` (25/11/2026) cả Core (luật, có crossway) lẫn View (hình, chuyển động, VFX).
- Bản phát hành: tag `parkingloop-v0.1.0` (26/11/2026). Tag phải đúng dạng `parkingloop-v{semver}` của bi.yaml; tag `1.0.0` đặt nhầm đã xoá.
- **Chờ người dùng so với game thật** (chưa ai xem cạnh nhau trên máy):
  - Cảm giác chơi: tốc độ xe ra cổng, cua nhập vòng, trượt đuôi, nổ khi xoá làn, rung / zoom camera, popup combo.
  - Xe trong làn khoá nhô cao hơn thùng khoá (xe cao 0.66, thùng 0.49, đúng số đo trong code Unity), cần xem game có vậy không.
  - Độ sáng xe (xe đen hơi xám, xe ẩn gần trắng): đã khớp ảnh chụp game ở mức ≈1.7 lần màu gốc, chưa so nhiều màu.
  - Thùng hộp khoá, gara máy phát, rào, thang máy là bản vẽ gần đúng (khối hộp / sprite), không phải mesh 3D của game.
  - Bảng đếm vòng 3D: cỡ, chỗ đặt, chỗ bắn hạt HitToSign (theo số trong scene; hạt nằm trước mặt bảng). Hạt chỉ là quầng +
    chấm sáng, chưa phải prefab StarBurst / Spikes.
  - Editor kéo-thả: mới thử bằng chuột giả lập trên level 7 (đổi chỗ làn ↔ làn, bãi → làn), chưa có người dùng thật thử.
  - Crossway (level 200+): bàn, đường nhánh, xe nhập giao lộ; hình vật cản mới (rào tấm chắn, ô màu, gara tím, thang
    máy, xe ẩn "?"); xe chờ trong cột bãi khi cổng hết chỗ. Editor crossway: chưa thử sửa / kéo trên level crossway.
- Chưa làm: âm nhạc nền; haptic (web không có); chụp ảnh level vào server ("Chụp ảnh" của core cần bridge WebGL của game).

## Nhật ký

### 26/11/2026 — Tag phát hành
- Build BI fail sau khi tạo tag `1.0.0`: không khớp kênh `parkingloop-v{semver}` trong bi.yaml (file build đủ: bi.yaml + Dockerfile.node). Xoá `1.0.0`, đặt date 0.1.0, tag `parkingloop-v0.1.0`. Chưa xem log build BI; repo vẫn ở GitHub cá nhân.

### 25/11/2026 — Gameplay Unity mới (crossway, feeling, obstacle) vào Chơi thử
- Yêu cầu: lấy phần gameplay Parking Loop đã commit (`923942cc..d1adb3de`) vào chơi thử. Phiên trước (tài khoản khác) làm
  crossway trong repo Unity; phần đó đã commit ở `d1adb3de`, repo Unity không còn thay đổi chưa commit.
- Luật: `format.mjs` (`laneRowOf`, `laneOrder` theo hàng, làn sâu 3, `crossRow/crossCol`); `model.mjs` (hình học làn,
  vòng giữa, đường nhánh `feeder`, `advanceLoop` nhường xe ra làn, `dockWait`, `mergeExits`). Checker bộ chính 1–336 khớp
  Unity: 329 Solvable, 209 Unknown, 215 / 274 / 288 / 311 / 317 Unsolvable.
- Hình: `layout.mjs` viết lại theo ParkingLayout mới; `carview.mjs` (chạy vòng liên tục, rời vòng vào làn, nhường);
  `playview.mjs` (sync mới, đường nhánh, chờ cột bãi, giữ làn, bàn crossway, vật cản mới, bỏ rung camera khi xoá làn,
  dây nối hai màu, mảnh băng, cột sáng thang máy); `rules.mjs` ảnh SVG biết crossway; `ui.mjs` `editHit` theo vị trí làn.
- Art mới (`unity_art.mjs`): platform_under, barrier_plate / block, cone, question, ice_piece_1..5.
- Test: 35 xanh (thêm crossway ở model.test, layout crossway ở view.test, raw 200).
- Đã kiểm trên trình duyệt: level 200 tự bấm tới thắng (không lỗi), ảnh 50 (rào đóng), 250, 15, 10; Editor + Chơi thử
  thật level 200. Chưa so cạnh game thật; chưa thử sửa level crossway trong Editor.

### 24/11/2026 (khuya) — Bàn chơi lệch trái; hướng dẫn xếp level mới
- Yêu cầu: màn hình game lệch trái; người dùng không biết cách xếp một level mới.
- Lệch trái: `PlayView.fit` (và khung ảnh Editor / ảnh nhỏ trong ui.mjs) chừa thêm bên phải tới `W + 1.4` cho bảng đếm
  vòng nên tâm khung lệch khỏi tâm bàn. Bỏ phần chừa: khung căn theo `boardBounds` (đối xứng quanh tâm vòng), bảng tự trượt
  vào trong khung như `ParkingLoopSign.KeepOnScreen`.
- Editor: khung "Cách xếp một level" (`helpPanel` trong ui.mjs): luật một câu, 6 bước (＋ Mới → Sửa → kích thước → đặt xe →
  kéo xếp → vật cản → Giải / Chơi thử / Lưu) và danh sách kiểm tra theo level (có xe, mỗi màu chia hết Cao làn, không làn
  quá Cao làn, đã Giải). Mặc định đóng (người dùng không muốn tự mở), bấm nút "❔ Hướng dẫn" cạnh 🧠 Giải mới hiện, ✕ để
  đóng; không nhớ trạng thái mở.
- Đã kiểm trên trình duyệt: level 8 ở Bàn chơi và Chơi thử nằm giữa; khung hướng dẫn hiện / ẩn. Chưa thử tạo level mới thật
  (không muốn thêm level rác vào bộ develop).

### 24/11/2026 (tối) — Gameplay Unity mới nhất (bảng đếm vòng 3D); Editor xếp level bằng kéo-thả
- Yêu cầu: cập nhật tool theo gameplay mới của Parking Loop; tool xếp và chỉnh sửa được level.
- Unity `221fe53d..923942cc`: chỉ đổi View (`ParkingLoopSign.cs` mới, `ParkingHud` dùng bảng thay LoopBadge, canvas
  1440x3120). Core (luật) và Level_*.json không đổi.
- Bảng đếm vòng: `unity_mesh.mjs` thêm `exportSignMesh` → `art/sign_mesh.json`; `carmesh.mjs` thêm `loadMesh` /
  `drawMesh` (mesh phụ); `playview.mjs` vẽ bảng trong lượt WebGL, chữ 2D theo mặt nghiêng của bảng (`drawSign`),
  `flashSign(color)` thay cho gán `signFlash` trực tiếp. Booster +1 vòng: toast "+1 loop slot", camera kick, bảng xanh.
- Editor: `game/web/edit.mjs` mới (chuyển các hàm sửa raw ra khỏi ui.mjs, thêm `relayout`, `moveCar`, `shuffleColors`,
  `colorCounts`); kéo-thả trên canvas (`editHit`, `editPointers`, `PlayView.drawDrag` vẽ ô nguồn / đích và xe "ma");
  thanh Cao làn / Vòng / Trộn màu; chữ gợi ý của Giải chuyển vào tooltip nút.
- Test: `game/tests/edit.test.mjs` (5 test), tổng 29 test xanh.
- Đã kiểm trên trình duyệt: bảng 3D ở Editor và Chơi thử (lắc + hạt khi +1 vòng), kéo đổi chỗ, cao làn +, trộn màu, rồi
  hoàn tác level 7 về r1 và nhả khoá.

### 24/11/2026 (chiều) — Hình, chuyển động, VFX như game; ảnh Editor / Thư viện; tài liệu bàn giao
- Yêu cầu: hình preview chuẩn và đẹp như game; anim, VFX, feeling của chơi thử chuẩn như game; viết docs để phiên khác làm tiếp.
- Viết lại renderer theo code View của Unity (`221fe53d`):
  - `layout.mjs` port `ParkingLayout`.
  - `carview.mjs` port `CarView`: lò xo pitch / roll / squash, leg cua bezier có phanh, merge, bám tim đường vòng, drift
    14° / 24°, vệt bánh, khói xả, deny / hop / park / swing.
  - `carmesh.mjs`: xe 3D thật từ `Car.prefab`, vẽ bằng WebGL, Gamma space.
  - `playview.mjs`: bàn Road_Vertical, SyncViews, transit theo thời gian, ClearRoutine (đợi đỗ → sáng → nổ từ trên xuống
    mỗi 0.075 s), FX_* theo ParkingGeneratedFx, camera trauma / kick, popup GREAT / AWESOME / AMAZING, đếm ngược 3-2-1 khi
    thua, Level Clear + WELL DONE sau 1.2 s.
- Editor: lưới ô màu → canvas vẽ như game, bấm trên hình để sửa (`paintEdit` / `editClick` trong ui.mjs).
- Thư viện: `thumbnail` SVG mới theo bố cục game; trên trình duyệt thay bằng ảnh render như màn chơi (`globalThis.parkingThumb`).
- `unity_art.mjs` thêm `unity_mesh.mjs` (xuất `car_mesh.json`), Road_Vertical, circle / glow, sfx_honk; bỏ sticker xe và
  art không còn dùng (art còn ~1.4 MB).
- Lỗi đã gặp và sửa trong phiên:
  - Màu tối: dùng linear trong khi project Unity để Gamma.
  - Xe tối: lật pháp tuyến theo `gl_FrontFacing`.
  - Xe làn cuối không nổ: job con bị mất khi gán lại mảng job.
- Test: thêm `game/tests/view.test.mjs` (layout, CarAnim); 24 test xanh.
- Đã kiểm trên trình duyệt (bước thời gian cố định vì khung trình duyệt bị ẩn):
  - Level 70 chạy hết lời giải tới WELL DONE.
  - Level 19 thua → đếm ngược → hồi sinh; búa, xáo và hoàn tác khi có xe đang chạy.
  - Ảnh vật cản ở level 7, 15, 30, 50, 100, 151, 250, 300.
  - Tô một xe trên ảnh Editor rồi hoàn tác về r1.

### 24/11/2026 (sáng) — Repo riêng, gameplay mới, art của game, chơi thử giữa màn hình
- Tool là repo riêng (fork level-tool-core, commit `d56b584 ParkingLevel: game`), push lên `khoadv-15112001/parking-loop-level-tool`.
- Port luật Unity `2eb94342`: vòng ngược chiều kim đồng hồ, cổng ở trạm dưới W/2, xe vào / ra vòng cần trạm trống trước và sau.
  Level 132, 224 thành giải được; 215, 274, 288, 311, 317 vẫn không giải được (cả luật cũ).
- Chơi thử dùng art, âm thanh, font của game; mặc định phủ cả cửa sổ, bàn chơi ở giữa; Esc / "✕ Thu nhỏ" để về.

### 23/11/2026 — Bản đầu của tool
- Dựng tool từ level-tool-core: format.mjs / model.mjs / solver.mjs port từ Unity, editor bàn chơi, chơi thử, giải,
  nhập / xuất zip raw Unity (`unity_levels.mjs`).
