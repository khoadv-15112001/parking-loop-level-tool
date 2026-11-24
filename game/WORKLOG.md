# WORKLOG — ParkingLevel (tool level Parking Loop)

Nhật ký để phiên Claude mới biết tool đang ở đâu. Đọc cùng `AGENTS.md` (kiến thức ổn định) và `levelcore/AGENTS.md`
(quy tắc chung). Mỗi task xong: thêm mục lên **đầu** phần "Nhật ký" và cập nhật "Trạng thái hiện tại".

## Trạng thái hiện tại

- Nhánh `main`, push lên `origin` = `khoadv-15112001/parking-loop-level-tool`. Repo trong `SonatGameProduct` chờ techlead tạo.
- Unity đã port tới `221fe53d` (24/11/2026) cả Core (luật) lẫn View (hình, chuyển động, VFX).
- Changelog `game/web/releases.json`: bản 0.1.0 chưa tag (date trống).
- **Chờ người dùng so với game thật** (chưa ai xem cạnh nhau trên máy):
  - Cảm giác chơi: tốc độ xe ra cổng, cua nhập vòng, trượt đuôi, nổ khi xoá làn, rung / zoom camera, popup combo.
  - Xe trong làn khoá nhô cao hơn thùng khoá (xe cao 0.66, thùng 0.49, đúng số đo trong code Unity), cần xem game có vậy không.
  - Độ sáng xe (xe đen hơi xám, xe ẩn gần trắng): đã khớp ảnh chụp game ở mức ≈1.7 lần màu gốc, chưa so nhiều màu.
  - Thùng hộp khoá, gara máy phát, rào, thang máy là bản vẽ gần đúng (khối hộp / sprite), không phải mesh 3D của game.
- Chưa làm: âm nhạc nền; haptic (web không có); chụp ảnh level vào server ("Chụp ảnh" của core cần bridge WebGL của game).

## Nhật ký

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
