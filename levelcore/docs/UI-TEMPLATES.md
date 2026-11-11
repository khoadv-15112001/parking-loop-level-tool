# Kho mẫu giao diện

Mẫu giao diện gồm CSS cho vỏ web dùng chung và các phần có thể lắp ghép vào màn riêng của game. Vỏ core vẫn cung cấp
các màn Level, Thư viện, Thứ tự, Tổng quan bộ, Hoạt động cùng các luồng lưu, nhập level và chơi thử.

| Mã mẫu | Giao diện | Xem mẫu | Mã nguồn |
| --- | --- | --- | --- |
| `sand-jam` | Bố cục màn, popup và thành phần UI theo Sand Jam. Hỗ trợ sáng, tối và theo hệ thống. | [Ảnh demo và chi tiết](UI-TEMPLATE-SAND-JAM.md) | [CSS và module](../web/ui-templates/sand-jam/) |

Có thể bổ sung mẫu từ giao diện Antopia và các tool khác theo quy trình bên dưới.

## Chọn mẫu cho một tool

- **Tool mới** có thể chọn mẫu khi tạo repo game.

  ```sh
  node levelcore/tools/new_game.mjs --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort --ui-template sand-jam
  ```

- **Tool dùng Level Tool Core** cập nhật core, thêm `"uiTemplate": "sand-jam"` vào `game/manifest.json`, khởi động lại
  server rồi mở `/app/`. Xoá trường `uiTemplate` để quay về giao diện mặc định. Mã sai hoặc mẫu chưa có sẽ báo lỗi khi
  tạo tool hoặc khởi động server.

Tên game và nội dung level lấy từ manifest và module luật của game. Core nạp `css/app.css`, mẫu đã chọn, rồi
`game/game.css`. Để đổi màu, đặt biến `--lc-*` trong `game/web/game.css`. Dùng `:root` cho màu sáng,
`:root[data-theme="dark"]` cho tối và `:root:not([data-theme="light"])` trong `@media (prefers-color-scheme: dark)`
cho chế độ theo hệ thống.

Dùng `game/web/ui.mjs` cho canvas, bảng công cụ và chi tiết level riêng. Bố cục mặc định đặt qua `layout` trong
manifest hoặc hook, còn GD có thể chỉnh trên trình duyệt. Chi tiết ở [hướng dẫn giao diện](../README.md#giao-diện-của-game-theme-hook-bố-cục).

Tool khai `app` trong manifest tự quản lý cấu trúc HTML. Nếu dùng cùng cấu trúc với vỏ core, app riêng có thể liên kết
trực tiếp `/core/ui-templates/sand-jam/template.css` sau CSS nền của core.

## Dùng các phần của mẫu Sand Jam

Mở `/core/ui-templates/sand-jam/preview/index.html` trên server dev để thử từng bố cục và popup với dữ liệu minh hoạ.
Mở được bản xem mẫu cả khi manifest đang dùng giao diện mặc định. Ảnh màn hình và luồng gốc nằm trong
[tài liệu Sand Jam](SANDJAM-TINH-NANG.md).

Nếu đang ở repo core và chưa có thư mục `game/`, chạy bằng manifest mẫu từ PowerShell.

```powershell
$env:LEVELCORE_GAME_MANIFEST = Join-Path $PWD 'levelcore/contracts/sample/manifest.json'
$env:SAMPLELEVEL_DEV = '1'
$env:SAMPLELEVEL_PORT = '8880'
$env:SAMPLELEVEL_DB = Join-Path $env:TEMP 'levelcore-template-preview.db'
$env:SAMPLELEVEL_GAME_DIR = Join-Path $env:TEMP 'levelcore-template-preview-game'
node levelcore/node/server.mjs
```

Sau đó mở [trang xem mẫu tại cổng 8880](http://127.0.0.1:8880/core/ui-templates/sand-jam/preview/index.html).

`uiTemplate` tự áp dụng CSS cho vỏ chung. Khi viết editor qua hook `renderEditor` hoặc làm một màn riêng, có thể lắp
các bố cục sau bằng `createSandJamLayout()` từ `/core/ui-templates/sand-jam/layouts.mjs`.

| Bố cục | Các vùng để lắp nội dung |
| --- | --- |
| `login` | Nhận diện tool, form đăng nhập, hướng dẫn hoặc lỗi |
| `workspace` | Tên tool, điều hướng, công cụ, thông báo, màn làm việc, dock chơi thử, thanh trạng thái |
| `library` | Thanh công cụ, bộ lọc trái, thao tác chọn nhiều, lưới hoặc bảng level, ngăn chi tiết phải |
| `collections` | Thanh công cụ và thẻ bộ theo nhóm |
| `sequence` | Thanh công cụ, dải điều hướng, thao tác trên slot, bảng thứ tự, thẻ slot, tab và vùng phân tích |
| `editor` | Thanh công cụ, danh sách level, thanh trên lưới, công cụ vẽ, lưới, số liệu, tab thông tin, dock chơi thử, gợi ý phím |
| `overview` | Bộ chọn, thẻ số liệu, biểu đồ, các nhóm cảnh báo |
| `activity` | Công cụ, thẻ dịch vụ, bộ lọc, nhật ký |
| `playtest`, `phone` | Khung game, nút điều khiển, bản build hoặc trạng thái |
| `admin`, `trash` | Thanh công cụ, thông báo, nhóm cài đặt hoặc danh sách khôi phục |

```js
import { createSandJamLayout } from '/core/ui-templates/sand-jam/layouts.mjs';

const { root, slots } = createSandJamLayout('editor');
slots.toolbar.append(toolbar);
slots.stage.append(canvas);
slots.inspector.append(properties);
root.dataset.tools = 'bottom';
host.replaceChildren(root);
```

Vùng trống tự ẩn. Với `editor`, dùng `data-tools="bottom"` cho dock dưới lưới, `data-inspector="left"` cho cột thông
tin bên trái, hoặc `data-focus` để ẩn hai cột bên. Có thể đổi các độ rộng `--sj-list-width`, `--sj-inspector-width`,
`--sj-detail-width` và `--sj-playtest-width` trên phần tử bố cục.

Các lớp `sj-*` trong `components.css` định kiểu cho nút, ô nhập, lọc, tab, bảng, thẻ, nhãn trạng thái, chỉ số, cảnh báo,
thanh công cụ, dải biểu đồ, bảng màu và gợi ý phím. Dùng HTML tương ứng trong bản xem mẫu để lấy cấu trúc và trạng thái.
`icons.mjs` cung cấp `sandJamIcon()` cho biểu tượng công cụ và `sandJamObstacleIcon()` cho bộ hình cơ chế gốc Sand Jam.
Nguồn biểu tượng là `app/js/icons.mjs`, `app/js/fxatlas.mjs` và `app/assets/fx-icons.webp` của Sand Jam tại `658fe0a`.

`openSandJamPopup(kind, options)` dùng chung cho form (`form`), xác nhận (`confirm`), xung đột (`conflict`), bảng và xem
trước khi nhập (`table`), so sánh (`compare`), tiến độ (`progress`), nội dung có tab (`tabs`), chia sẻ (`share`), ngăn chi
tiết (`drawer`), menu (`menu`), bảng nổi (`popover`) và menu tròn (`radial`). `content` nhận văn bản hoặc phần tử DOM.
`anchor` xác định nút hay vùng neo cho menu, bảng nổi và menu tròn. Hàm trả về giá trị của nút được chọn hoặc `null` khi
đóng. `popup-examples.mjs` có 36 ví dụ, gồm nhập Unity / Level Hub, Promote, so sánh level / bộ / revision, WebGL,
phân tích lượt chơi, QR, phím tắt và các bảng công cụ trong editor.

```js
import { openSandJamPopup } from '/core/ui-templates/sand-jam/popups.mjs';

const confirmed = await openSandJamPopup('confirm', {
  title: 'Xoá level',
  content: 'Chuyển level đang chọn vào Thùng rác?',
  actions: [{ label: 'Huỷ' }, { label: 'Xoá level', danger: true, value: true }],
});
```

Dữ liệu level, nội dung lưới, WebGL, công thức chỉ số và hành động trong các popup do Core hoặc hook của game cung cấp.
Các luồng có sẵn như lưu level, nhập / xuất, Level Hub và chơi thử tiếp tục dùng API và module chức năng của Core.

## Thêm mẫu vào core

1. Đặt `template.css` và tài nguyên dùng chung vào `levelcore/web/ui-templates/<id>/`. Dùng mã dạng `sand-jam`, viết
   thường và phân tách bằng gạch ngang. Server nhận diện mẫu theo đường dẫn này.
2. Định kiểu trên HTML có sẵn của core, ưu tiên các biến `--lc-*`. Nếu bổ sung bố cục, popup hay thành phần riêng, dùng
   tên lớp theo mã mẫu và thêm bản xem mẫu có thể mở trực tiếp. Đặt font và ảnh có quyền phân phối trong thư mục mẫu,
   kèm giấy phép tương ứng. Dùng URL `/core/ui-templates/<id>/...` cho tài nguyên để CSS hoạt động ở cả đường dẫn trực
   tiếp và `/core/ui-template.css`.
3. Thêm mục giới thiệu vào README gốc và bảng trên. Liên kết đến một trang chi tiết trong `levelcore/docs/`, kèm ảnh
   chụp từ bản xem mẫu để người đọc xem được ngay trên GitHub. Thử với một game có manifest trên cả Node và Python.
   Kiểm tra sáng, tối, bàn phím, cửa sổ hẹp và việc ghi đè màu bằng `game/web/game.css`. Chạy
   `node levelcore/contracts/run.mjs` trước khi tích hợp.
