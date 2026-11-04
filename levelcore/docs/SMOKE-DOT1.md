# Smoke đợt 1 — chạy tay khi duyệt

Chạy game mẫu (`levelcore/contracts/sample`) trên từng server, làm hết danh sách bên dưới trên mỗi server.

```powershell
# Python (cần .venv như README)
$env:LEVELCORE_GAME_MANIFEST = "levelcore/contracts/sample/manifest.json"; $env:SAMPLELEVEL_DEV = "1"
$env:SAMPLELEVEL_DB = "data/sample-py.db"; $env:PYTHONPATH = "levelcore/server"
.venv/Scripts/python -m uvicorn --factory levelcore.main:get_app --port 8880 --workers 1

# Node (Node >= 22.13)
$env:LEVELCORE_GAME_MANIFEST = "levelcore/contracts/sample/manifest.json"; $env:SAMPLELEVEL_DEV = "1"
$env:SAMPLELEVEL_DB = "data/sample-node.db"; $env:SAMPLELEVEL_PORT = "8881"
node levelcore/node/server.mjs
```

Mở `http://localhost:<cổng>/app/`, vào bằng email DEV.

1. Nhập một zip có 3 level đúng, 1 file JSON hỏng và 1 level lỗi kiểm định: hộp xem trước liệt kê đúng từng level,
   bấm Nhập thì level lỗi kiểm định vẫn vào, file hỏng thì không.
2. Sửa một level vừa nhập rồi nhập lại file cũ có level đó đã đổi: level báo "Xung đột", không bị ghi đè; tick "Ghi đè"
   thì mới ghi.
3. Ô tìm: `2-5`, `2,5,9`, chữ không dấu đều lọc đúng.
4. Mở level, ✎ Sửa, đổi "Thời gian" ở form: tab JSON vẫn còn đủ field khác (`items`, `hint`…).
5. Hai tab cùng email cùng mở một level và cùng bấm ✎ Sửa (người khác email thì bị khoá chặn). Tab 1 sửa và lưu, tab 2
   sửa rồi lưu sau: hộp xung đột có Giữ bản server, Lưu thành bản sao, Giữ bản của tôi; bản đang sửa của tab 2 không mất.
6. Kiểm định bộ: bấm số level trong bảng lỗi thì mở đúng level đó.
7. Lịch sử: khôi phục một bản cũ, xoá level rồi khôi phục ở bộ lọc "Đã xoá".

Server Node chưa có Level Hub và chơi thử WebGL: nút tương ứng phải ẩn, khung game hiện dòng báo chưa có.
