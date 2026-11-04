# Smoke đợt 2 — BI, Level Hub, bản game, CI

Phần chạy tự động (mock) đã có trong `node levelcore/contracts/run.mjs`: BI và Firebase giả, player có file Brotli thật,
CI hai nhánh cùng số build, gửi đồng thời, player lỗi, mất phản hồi khi đẩy BI. Kịch bản dưới đây là phần Dev Game kiểm
tay, tách **A. mock trên máy** (chạy được ngay) và **B. thật** (cần tool trên bi-dev, project Unity, Jenkins).

## A. Mock trên máy

Chạy game mẫu như `SMOKE-DOT1.md` (Python hoặc Node), thêm token CI và nhánh theo dõi:

```powershell
$env:SAMPLELEVEL_CI_TOKEN = "smoke-ci"; $env:SAMPLELEVEL_CI_BRANCH = "main"; $env:SAMPLELEVEL_GAME_DIR = "data/sample-game"
node levelcore/contracts/fake_player.mjs data/fake-player.zip
```

`fake_player.mjs` ghi zip một player giả nói đúng giao thức khung game; trang của nó in level vừa nhận và nguồn
(`draft` hoặc `rN`).

1. ⬆ trong khung game → tải `data/fake-player.zip` lên (admin). Mở một level: khung game in đúng JSON của level.
2. Gửi bản nhánh khác bằng CI, kiểm bản đang dùng không đổi:
   ```powershell
   curl.exe -X POST -H "Authorization: Bearer smoke-ci" --data-binary "@data/fake-player.zip" "http://localhost:8881/api/ci/webgl?by=jenkins-1&branch=feature/x&buildNumber=1&version=1.0.1-x"
   ```
   ⬆ Bản game: bản `1.0.1-x` ở trạng thái "Chờ chọn". Bấm Dùng bản này: tab khác đang mở tool cũng thấy thông báo bản mới.
3. Sửa một level, không lưu, bấm ▶ Chơi thử: player in bản đang sửa, trạng thái "Đang chơi level N · bản đang mở ✓".
4. Lưu hai lần để có r1, r2. Lịch sử → ▶ Chơi r1: player in nội dung r1, trạng thái "· r1 ✓"; bản đang mở giữ nguyên.
5. Xuất Level Hub → Kiểm tra (hiện "Đã chốt … level lúc …") → sửa và lưu một level trong dải → Xuất zip: `Raw/<n>.json` là
   bản lúc Kiểm tra. Đổi một tham số (vd Version) thì phải Kiểm tra lại mới chốt.

## B. Thật (ghi rõ phần nào chưa chạy được và vì sao)

Cần: tool trên bi-dev có Dev Game, quyền app + Level Hub trên app thử, biến `<PREFIX>_BI_*` và `<PREFIX>_CI_TOKEN`; Jenkins
có secret text `<slug>-level-tool-token` cùng giá trị; project Unity có bridge và dòng `levelToolUrl` trong Jenkinsfile.

1. Đăng nhập bằng Google trên bi-dev. Tài khoản có quyền tool nhưng chưa có quyền Level Hub: Đẩy lên BI báo lỗi 403 của BI
   (kèm gợi ý xin quyền), không bị đăng xuất khỏi tool.
2. Đẩy một dải level lên BI: tên bộ dạng `Game_A_1_20_Global_…`; BI chuyển PROCESSING rồi READY. Đẩy lại cùng tên: báo 409
   và gợi ý đổi Version.
3. Chạy Jenkins nhánh theo dõi: level CI (nếu game có exporter) và player lên trong một lần, bản game đổi cho mọi người.
4. Chạy Jenkins nhánh khác: bản game không đổi; admin chọn bản đó thì level của lần chạy đó mới vào bộ CI.
5. Sửa một level trong tool rồi chạy lại Jenkins có level đó đổi: level báo xung đột trong ⬆ Bản game → Level từ CI, bản
   của GD còn nguyên.
6. Player Unity thật: Lịch sử → ▶ Chơi r1 khi head đã là r2, game mở đúng r1 (bridge ghi `src=r1` thì có dấu ✓).
