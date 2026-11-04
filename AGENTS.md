# level-tool-core (repo core)

Đây là repo core, chưa phải tool của game nào. Quy tắc chung cho mọi tool: `levelcore/AGENTS.md`. Fork cho game mới thì
`levelcore/tools/new_game.mjs` thay file này bằng AGENTS.md của game.

Khi sửa core:

- Sửa hợp đồng (route, hook, manifest) thì sửa cả hai server và chạy `node levelcore/contracts/run.mjs` (Python và Node).
- Test riêng: `cd levelcore/server && ../../.venv/Scripts/python -m pytest`, `node --test levelcore/node/tests/*.test.mjs`.
- Thay đổi Dev Game cần biết ghi vào `levelcore/CHANGELOG.md` theo khung changelog (kiểm bằng test).
- Thêm điểm mở rộng có mặc định, không rẽ nhánh theo tên game. Game cũ (plugin Python) phải chạy tiếp không sửa gì.
