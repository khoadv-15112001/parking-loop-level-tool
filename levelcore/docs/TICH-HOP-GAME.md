# Làm Level Tool cho một game bằng level-tool-core

| Mục | |
| --- | --- |
| Áp dụng cho | `level-tool-core` main từ `cb3777e` (core 0.2.0), `sonat-game-cicd` ≥ 2.7.3 |
| Người đọc | AI agent (Claude Code) làm thay Dev Game là chính; Dev Game đọc để duyệt và tự làm được |
| Người viết · cập nhật | Duy TD · 05/11/2026 |
| Trạng thái | Draft |

**Tóm tắt.** Mỗi game có một tool level riêng chạy trên BI tại `https://<slug>.tools.sonatgame.com`. Tool là một repo
fork của `level-tool-core`. Core lo phần chung: server, lưu level có lịch sử, khoá sửa, giao diện cho GD, chơi thử bằng
bản WebGL, nhận build từ Jenkins, đẩy BI Level Hub. Phần của game chỉ gồm `game/manifest.json`, luật level
`game/web/rules.mjs`, test với raw thật, và (khi cần) hook giao diện `game/web/ui.mjs`. Ngoài repo tool còn ba việc: bản
WebGL của game nói chuyện được với tool (bridge), một dòng `levelToolUrl` trong Jenkinsfile, đăng ký tool trên BI.

---

## 0. Quy tắc cho AI agent (đọc trước khi làm)

1. **Làm theo thứ tự mục 5.** Mỗi bước có **Xong khi**: chưa đạt thì chưa sang bước sau.
2. **Nguồn sự thật là code và tài liệu trong repo** (đường dẫn ở từng mục). Tài liệu này lệch với code thì theo code và
   báo người dùng chỗ lệch.
3. **Không sửa `levelcore/`, `ChayDev.bat`, `.gitignore`, `.dockerignore`, `.claude/skills/`** trong repo của game. Core
   thiếu gì thì ghi lại, đề xuất sửa ở repo `level-tool-core` (mục 7).
4. **Không đoán luật level.** Luật viết từ raw thật của game (`game/tests/raw/`) và luật Dev Game đưa. Không có raw thì
   dừng và hỏi.
5. **Không chép** luật, field, giao diện từ `levelcore/contracts/sample/` hay từ tool của game khác. Sample chỉ là dữ liệu
   test của core.
6. **Không commit secret** (`.env`, token CI, key service account). Giá trị biến đặt trên BI (tab Variables).
7. **Không push, tag, mở PR, đăng ký tool trên BI, tạo Jenkins secret** khi chưa hỏi người dùng.
8. **Không bật `<PREFIX>_DEV=1` trên BI** (cho phép đăng nhập bằng header, chỉ dùng ở máy).
9. Hỏi người dùng **một lần, đủ các ý** ở bước 1; phần chưa có thì ghi "chưa có" và làm tiếp phần không phụ thuộc.
10. Trước khi báo xong: test xanh (mục 9), ghi vào `AGENTS.md` gốc repo những gì riêng của game (nguồn raw, định dạng,
    bridge), báo người dùng file đã viết, chỗ phải đoán, điều core còn thiếu.

---

## 1. Tài liệu liên quan

| Tài liệu | Dùng khi | Link |
| --- | --- | --- |
| **CI CD Document** — Tích hợp CI/CD build WebGL vào Web Level Tool | Jenkins build bản WebGL và level, gửi lên tool (bước 8, 9) | https://docs.google.com/document/d/1ZHzrxuoJEZt_24DaBCXWKpq6dCWjG6LwrTPlxKQglmA/edit?tab=t.0 |
| **Level Tools trên BI** — Yêu cầu đóng gói Tools & Hướng dẫn sử dụng (User Manual, pic quyendv@sonat.vn) | Đăng ký tool, biến môi trường, deploy, quyền, bi.yaml (bước 10) | https://claude.ai/artifact/PAj2HtXfitG6dhPqx9eB3U?sk=DNUWPGYjEku6MrCOG9Sotw |
| Bộ skill BI + khung repo mẫu (zip, chọn file mới nhất) | Không vào được repo `SonatBI/level-tool-template` | https://drive.google.com/drive/folders/1sBhpWhocUdKZjy3Y9BY7dbkwQ-Y-bNTS |
| **Platform Document** — Yêu cầu tích hợp Firebase, Level Tool Hub trên BI (pic thachpn@sonat.vn) | Đăng nhập Firebase của BI, API Level Hub, quy tắc tên bộ, cấu trúc ZIP, quyền (bước 10, 11) | https://docs.google.com/document/d/1vbMtc6x_h6lQzY94ZcDNebqyNnoUsRXBBP9XnroyAZU/edit?tab=t.hqvenk66gmgr#heading=h.sjuo1tn4i91z |
| **Realtime Events** — kiểm tracking event của game có lên BI, dữ liệu đúng chưa; API key của từng game | Tuỳ chọn, khi game có order: bản chơi thử (WebGL) bắn tracking event (bước 8d) | https://docs.google.com/document/d/1XJeKNiVLVS_eKnDO9ixIMuc8Jth8AOtZ/edit |
| BI Firebase Config | Giá trị Firebase Web App của BI (đăng nhập Google) | https://docs.google.com/document/d/1ngg9OMD4ktjisz170rMuErFBHCDBsLtUvaJPiI3k4rk/edit |
| Agent skill Level Hub (`level_hub_skill.zip`) | Agent cần đọc thêm về API Level Hub | https://drive.google.com/file/d/176B1-pERZ5ufOC9l32rqDiQSvkh0vtoC/view |
| Giao diện Level Hub (người kiểm tay, agent không mở) | Xem bộ đã đẩy lên BI | dev https://bi-dev.sonatgame.com/level-hub/ · prod https://bi.sonatgame.com/level-hub/ |
| README `sonat-game-cicd`, mục Level Tool | Hợp đồng CI v1, game cần gì để build WebGL | https://github.com/SonatGameShared/sonat-game-cicd#level-tool--the-webgl-player-for-the-level-web-tool |
| Release `sonat-game-cicd` 2.7.0 / 2.7.1 / 2.7.3 | Thay đổi build WebGL (WebAssembly 2023, LiveOps) | https://github.com/SonatGameShared/sonat-game-cicd/releases |
| Repo core | Code, hợp đồng, template | https://github.com/SonatGameProduct/level-tool-core |
| Tool đang chạy để tham khảo cách làm | Sand Jam (Node, tự làm giao diện), Antopia | https://github.com/SonatGameProduct/sand-jam-level-tool · https://github.com/SonatGameProduct/antopia-level-tool |
| Tính năng từng màn của Sand Jam, ảnh đánh số | Chọn tính năng cho tool mới, biết phần nào core đã có | [SANDJAM-TINH-NANG.md](SANDJAM-TINH-NANG.md) |

Các yêu cầu của BI (đóng gói tool, Firebase, Level Hub) đã có sẵn thành skill cho Claude Code: `bi-onboard`, `bi-new`,
`bi-yaml`, `bi-release` (repo `SonatBI/level-tool-template` hoặc zip ở thư mục Drive trên).

Liên hệ:

| Việc | Ai |
| --- | --- |
| Share quyền Level Tools, share app, quyền Level Hub | duongnt@sonat.vn hoặc quyendv@sonat.vn |
| Tài liệu đóng gói tool, đăng ký tool trên BI | quyendv@sonat.vn |
| Tích hợp Firebase của BI | thachpn@sonat.vn |
| API key Realtime Events (chỉ khi game có order) | duongnt@sonat.vn |
| Lỗi khi build / deploy trên BI | quyendv@sonat.vn hoặc thachpn@sonat.vn |

Owner của tool tự cập nhật và đưa tool lên BI theo các tài liệu trên.

Trong repo core (đọc theo thứ tự khi cần chi tiết):

| File | Nội dung |
| --- | --- |
| `levelcore/AGENTS.md` | quy tắc chung cho người và agent: chỗ được sửa, chạy, test, giao diện, changelog |
| `levelcore/README.md` | core có gì, biến môi trường, hook giao diện, nâng core |
| `levelcore/contracts/README.md` | hợp đồng của hai server: route, manifest, module luật, bridge, CI v1, lỗi, gọi API bằng tay |
| `levelcore/FORK.md` | tạo repo tool, lấy bản mới của core, đóng góp về core |
| `levelcore/CHANGELOG.md` | thay đổi của core; mục **Cần chú ý** là bước bắt buộc khi nâng core |
| `.claude/skills/levelcore-new-game/SKILL.md` | skill của Claude Code cho đúng việc trong tài liệu này |
| `levelcore/docs/DOT3-KET-QUA.md` | kết quả thử đưa game thứ hai (Antopia) vào core, nâng core bằng merge |

---

## 2. Kiến trúc

```
Repo tool của game  (fork của level-tool-core, remote "core" trỏ về core)
├── levelcore/          CORE: server Node + Python, giao diện web, Docker, tools, template — game không sửa
├── game/               GAME: manifest.json, web/rules.mjs, web/ui.mjs (tuỳ chọn), web/game.css (tuỳ chọn),
│                             web/releases.json, tests/ (+ tests/raw/), game.env, .env.example
├── bi.yaml             GAME: deploy lên BI
├── README.md, AGENTS.md, CLAUDE.md      GAME
└── ChayDev.bat, .gitignore, .dockerignore, .claude/skills/      CORE
```

Luồng dữ liệu:

```
Jenkins (sonat-game-cicd, ô BUILD_WEBGL) ──POST /api/ci/levels, /api/ci/webgl (Bearer token)──▶ Tool trên BI
GD / Creative ──trình duyệt, đăng nhập Google của BI──▶ Tool: tạo / sửa / chơi thử / xếp level
Tool ──khung <iframe> /game/index.html, postMessage──▶ bản WebGL của game (bridge)
Tool ──ID token của người đang dùng──▶ BI Level Hub (xuất / đẩy bộ level)
GitHub (push tag <slug>-vX.Y.Z) ──webhook──▶ BI build Docker, deploy tool
```

Khái niệm:

| Từ | Nghĩa |
| --- | --- |
| Bộ (pack) | một tập level, vd `develop`, `product`. Bộ production chỉ nhận level qua promote; bộ lưu trữ chỉ đọc |
| Level | một file JSON raw của game, tên là số (`12`). Mỗi lần lưu thành một revision, lịch sử không xoá |
| Khoá | GD bấm Sửa thì giữ khoá level; lưu bằng `If-Match: "r<rev>"`; người khác lưu trước thì 412 kèm bản mới |
| Slot | số level trong bộ; Xếp thứ tự giữ slot, đổi level nằm ở slot |
| `formatVersion` | phiên bản định dạng level của game (manifest); game đổi định dạng thì tăng |
| Runtime | ưu tiên Node (`levelcore/node`) cho tool mới; Python (FastAPI) cho tool cũ hoặc có phụ thuộc Python cần thiết |

Tool mới chọn `--runtime node`, giữ luật level bằng JS thuần để dùng chung với trình duyệt. Solver và tác vụ nặng
tách worker hoặc tiến trình khi cần, có giới hạn hàng đợi và số job chạy đồng thời. Tool Python đang hoạt động tiếp
tục được sửa lỗi và giữ tương thích; chuyển runtime cần kiểm thử dữ liệu và hook của game. Xem lý do chọn và quy tắc
quản lý tài nguyên tại [Chọn runtime cho tool](../README.md#chọn-runtime-cho-tool).

---

## 3. Ai làm gì

| Người | Việc | Bao giờ |
| --- | --- | --- |
| Dev Game / AI agent | repo tool (mục 5, bước 2–7, 10–12) | một lần cho mỗi game, rồi khi nâng core |
| Dev Game (Unity) | bản WebGL build được, bridge, (tuỳ) `LevelToolCI.ExportLevels()` (bước 8) | một lần cho mỗi game |
| Dev Game | dòng `levelToolUrl` trong Jenkinsfile (bước 9) | một lần |
| Jenkins admin / DevOps | Jenkins secret text `<slug>-level-tool-token` | một lần cho mỗi tool |
| BI Admin / Tool Admin | quyền Level Tools, share app, quyền Level Hub, service account nếu cần | một lần |
| Owner của tool trên BI | nhập biến, bật tool, duyệt deployment | khi deploy |
| GD / QA | chạy job Jenkins với BUILD_WEBGL khi cần bản game mới trên tool | khi cần |

---

## 4. Ba mức giao diện (chọn trước khi làm)

| Mức | Khi nào | Game viết |
| --- | --- | --- |
| 1. Vỏ của core | GD sửa thông số level và xem bằng game thật | không viết giao diện; `fields`, `levelSummary`, `thumbnail` trong `rules.mjs` |
| 2. Vỏ của core + hook | game cần editor riêng (canvas, lưới, bảng công cụ), chip riêng ở danh sách | `game/web/ui.mjs` chỉ chứa hook game thêm; màu ở `game/web/game.css` |
| 3. Giao diện riêng hoàn toàn | cách làm việc của GD khác hẳn (hiếm) | thư mục `game/app/` + `"app": "app"` trong manifest; dùng module ở `/core/js/` |

Mặc định chọn mức 1, thêm mức 2 khi GD cần. Mức 2 giữ được mọi màn của core (Level, Thư viện, Thứ tự, Tổng quan bộ,
Hoạt động), tìm nhanh Ctrl+K, bố cục GD tự chỉnh. Mức 3 mất các màn đó, phải tự làm lại và tự giữ các luồng an toàn (khoá,
`If-Match`, xử lý 412 / 423, xem trước khi nhập).

---

## 5. Các bước

### Bước 1. Gom thông tin (hỏi người dùng một lần)

| Thông tin | Ví dụ | Dùng ở |
| --- | --- | --- |
| Tên tool (chữ / số, viết hoa đầu) | `FishLevel` | manifest `tool`, tên DB |
| Tên game | `Fish Sort` | manifest `game` |
| Tiền tố biến (CHỮ HOA / số) | `FISHLEVEL` | mọi biến `<PREFIX>_*` |
| Slug BI (chữ thường / số / gạch nối) | `fishsort` | `https://fishsort.tools.sonatgame.com`, tag `fishsort-vX.Y.Z`, Jenkins secret |
| Runtime | `node` (mặc định) | `game/game.env`, Dockerfile trong `bi.yaml` |
| Raw level thật: lấy ở đâu, vài file mẫu đủ loại cơ chế, luật hợp lệ | thư mục level trong repo game | bước 4 |
| Repo game Unity, nhánh build | `develop` | bước 8, 9 |
| Bridge của bản WebGL: `id`, `tag` (nếu game đã có) | `fishsort-game`, `FISHLEVEL` | manifest `webgame` |
| App trên BI (Android, iOS) | `com.sonat.fishsort` | `<PREFIX>_BI_APP_ID[_IOS]`, manifest `biAppId` |
| Level Hub: acronym, mã vật cản | `FS`, `[["Rock","RK"]]` | manifest `levelhub` |
| Email admin của tool | `a@sonat.vn,b@sonat.vn` | `<PREFIX>_ADMINS` |
| Tool có nhận level từ build không | có / không (vd Antopia không) | bước 8 |

**Xong khi:** có tên, tiền tố, slug, runtime và ít nhất vài raw level thật. Phần còn thiếu ghi "chưa có".

### Bước 2. Tạo repo tool

```sh
git clone git@github.com:SonatGameProduct/level-tool-core.git <game>-level-tool
cd <game>-level-tool
git remote rename origin core
git remote add origin git@github.com:SonatGameProduct/<game>-level-tool.git   # repo trống tạo trước trên GitHub
```

Repo game đã có lịch sử riêng (game cũ chuyển sang core): `levelcore/FORK.md`, mục "Repo game có trước core".

Cần: Node ≥ 22.13 (`node -v`); server Python thì thêm Python 3.10+.

**Xong khi:** `git remote -v` có `core` và `origin`; có `levelcore/`, chưa có `game/`.

### Bước 3. Sinh phần của game

```sh
node levelcore/tools/new_game.mjs --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort \
  --runtime node --port 8893 --raw <thư mục raw của game>
```

| Tham số | |
| --- | --- |
| `--tool`, `--game`, `--prefix`, `--slug` | bắt buộc, theo bước 1 |
| `--runtime node \| python` | mặc định `node` |
| `--port` | cổng khi chạy ở máy, mặc định 8880 |
| `--raw <thư mục>` | chép tối đa 8 file `<số>.json` (rải đều theo số) vào `game/tests/raw/`, giữ nguyên byte |
| `--storage` | tiền tố localStorage, mặc định theo slug |

Lệnh sinh: `game/manifest.json`, `game/web/rules.mjs` (khung), `game/web/releases.json`, `game/tests/`, `game/game.env`,
`game/.env.example`, `bi.yaml`, `README.md`, `AGENTS.md`, `CLAUDE.md`. Không sinh code giao diện. Không ghi đè file đã có.

**Xong khi:** `node --test game/tests/*.test.mjs` chạy được (test luật có thể còn đỏ tới khi viết xong bước 4).

### Bước 4. Viết luật level — `game/web/rules.mjs`

File này chạy ở cả server lẫn trình duyệt: JS thuần, không DOM, không `node:*`; được import file khác trong `game/web/`.
Dùng lại validator sẵn có của repo game thì chép các module cần vào `game/web/` và ghi commit nguồn trong `AGENTS.md` gốc.

| Export | Chữ ký → kết quả | Bắt buộc | Core dùng ở |
| --- | --- | --- | --- |
| `validateLevel` | `(level, {levelNo, formatVersion}) → {isValid, errors: string[], warnings: string[]}` | có | kiểm định, promote, xuất Level Hub, nhập |
| `blankLevel` | `(n, template) → level`; `template` là level đang mở khi Nhân bản, `null` khi Mới | có | Mới / Nhân bản / lưu thành bản sao |
| `levelSummary` | `(level) → {khoá: số hoặc chuỗi}` phẳng, vài giá trị | nên có | danh sách, Thư viện, cột của Thứ tự, Tổng quan bộ, tìm |
| `levelChanges` | `(prev, cur) → string[]` (`null` = không so được) | nên có | Lịch sử, audit, thông báo khi lưu |
| `setLevelNumber` | `(level, n) → level` | khi raw chứa số level | đổi số, promote, xếp thứ tự |
| `fields` | `[{path, label, type: 'number'\|'text'\|'bool'\|'select', options?, min?, max?, step?, hint?}]` | nên có | form thông số GD hay sửa |
| `describeHub` | `(level, n) → {mechanics, difficulty, uniqueColor, totalBlock, time, obstacleCounts}` | khi đẩy Level Hub | metadata Level Hub |
| `hubLayout` | `(level) → string` | tuỳ | cột `layout` của Level Hub |
| `thumbnail` | `(level) → string SVG` (chỉ trình duyệt) | tuỳ | ảnh level khi chưa chụp từ bản game |

Hướng dẫn:

- `levelSummary`: chọn vài khoá GD nhìn để so level (độ khó, thời gian, số màu, số ô…). Khoá dạng chữ ít giá trị (2–8,
  vd độ khó) thành nhóm ở Thư viện và Tổng quan bộ; khoá số thành đường chỉ số. Chọn mặc định bằng manifest
  `overview: {group, metric}`.
- `fields`: `path` là mảng (`['goals', 0, 'count']`) hoặc chuỗi chấm (`'goals.0.count'`). Form chỉ ghi đúng field vừa sửa.
- `validateLevel`: lỗi chặn đường ra ngoài (promote sang production, Level Hub); cảnh báo không chặn. GD vẫn lưu được bản
  nháp còn lỗi.
- Viết test với raw thật ở `game/tests/rules.test.mjs`: mọi raw trong `tests/raw/` hợp lệ; vài trường hợp lỗi cố ý.

**Xong khi:** `node --test game/tests/*.test.mjs` xanh; mọi raw thật qua `validateLevel`.

### Bước 5. Điền `game/manifest.json`

```json
{
  "tool": "FishLevel", "game": "Fish Sort", "prefix": "FISHLEVEL", "slug": "fishsort", "storagePrefix": "fishsort",
  "formatVersion": 1, "rules": "web/rules.mjs", "web": "web",
  "defaultPacks": ["develop", "product"], "biAppId": "com.sonat.fishsort",
  "levelhub": { "acronym": "FS", "obstacleCodes": [["Rock", "RK"]] },
  "webgame": { "id": "fishsort-game", "tag": "FISHLEVEL" },
  "overview": { "group": "difficulty", "metric": "time" },
  "listView": "list"
}
```

| Khoá | |
| --- | --- |
| `tool`, `game`, `prefix`, `rules` | bắt buộc |
| `slug`, `storagePrefix` | phiên bản hiển thị (bỏ tiền tố tag), khoá localStorage |
| `formatVersion` | ghi vào mỗi revision; tăng khi game đổi định dạng level |
| `defaultPacks` | bộ tạo sẵn; bộ đầu tiên nhận level từ CI nếu `<PREFIX>_CI_PACK` trống |
| `biAppId`, `levelhub` | Level Hub (bước 11) |
| `webgame` | `id` và `tag` của bridge (bước 8); phải khớp với bản WebGL |
| `overview` | khoá tóm tắt mặc định để chia nhóm / vẽ đường |
| `listView` | `"grid"` = lần đầu mở tool vào Thư viện (game nhìn hình là nhận ra level) |
| `layout` | bố cục mặc định (như hook `layout` ở bước 7) |
| `app` | chỉ khi giao diện mức 3 |

**Xong khi:** server khởi động không lỗi manifest (bước 6).

### Bước 6. Chạy ở máy và thử

```sh
copy game\.env.example .env        # điền dần; trống vẫn chạy được ở máy
ChayDev.bat                        # hoặc: set FISHLEVEL_DEV=1 && node levelcore/node/server.mjs
```

Mở `http://localhost:<port>/app/`, đăng nhập bằng email DEV. Nhập raw thật:

```sh
node levelcore/tools/zip_raw.mjs game/tests/raw data/raw.zip
```

rồi ⇪ Nhập ở cuối danh sách level (xem trước rồi mới ghi). Gọi API bằng tay: `levelcore/contracts/README.md`, mục "Gọi API
bằng tay (DEV)".

Kịch bản thử (mỗi ý phải đúng):

1. Danh sách hiện đủ level, chấm kiểm định xanh / cam / đỏ đúng với luật.
2. Mở một level: form thông số đúng giá trị raw; JSON đúng raw.
3. ✎ Sửa → đổi một field → Lưu → Lịch sử có revision mới và dòng "đã sửa gì" (`levelChanges`).
4. Mở level ở tab khác bằng email khác: thấy đang bị khoá; lưu từ bản cũ thì gặp hộp xung đột.
5. Thư viện, Thứ tự, Tổng quan bộ hiện số liệu từ `levelSummary`.
6. Tải cả bộ về máy (zip): file giống raw đã nhập (trừ chỗ đã sửa).

**Xong khi:** đủ 6 ý; ghi lại ý nào chưa đúng và vì sao.

### Bước 7. Giao diện (chỉ khi cần mức 2)

`game/web/ui.mjs` chỉ export những gì game thêm; core gộp với phần dựng từ manifest. Thiếu file thì server trả object rỗng.

```js
// game/web/ui.mjs
export default {
  renderEditor(ctx) { /* vẽ editor vào ctx.el */ return { update(level, { editable }) {}, destroy() {} }; },
  levelDetail: (summary, lv) => '<p class="small">…</p>',     // HTML, tự esc
  listItem: summary => ({ tags: '<span class="badge">…</span>', sub: '…' }),
  layout: { game: 'tab', form: 'right' },
  shortcuts: [{ id: 'editor.rotate', scope: 'level', label: 'xoay', keys: ['r'] }],
  onShortcut(id, { state }) {},
};
```

| Hook | Hợp đồng |
| --- | --- |
| `renderEditor(ctx)` | editor chiếm phần chính màn Level. `ctx = {el, level, editable, pack, name, changed(), setHighlight(id), toast}`. Vẽ vào `ctx.el`; sửa `ctx.level` **tại chỗ** rồi gọi `ctx.changed()`; không sửa khi `editable` là `false`. Trả `{update(level, {editable}), destroy()}`: core gọi `update` khi bản nháp đổi từ chỗ khác (form, JSON, hoàn tác, Sửa / Xong); không có `update` thì core dựng lại editor. Core lo khoá, lưu, xung đột, lịch sử |
| `levelDetail(summary, lv)` | HTML thêm vào cột chi tiết của Thư viện / Thứ tự |
| `listItem(summary)` | `tags` (HTML) ở danh sách level và thẻ Thư viện; `sub` là dòng chữ dưới số level |
| `layout` | bố cục mặc định: `{list, form: 'left'\|'right'\|'hide', info, game: 'tab'\|'right', hints, listW, formW, infoW, gameW, detailW}` |
| `shortcuts`, `onShortcut` | phím của editor; GD đổi được ở bảng Phím tắt; hiện ở dòng gợi ý khi đang sửa |
| `renderOverview(ctx)` | (cũ, vẫn dùng được) vẽ thêm vào cột thông số `ctx.form` và cột thông tin `ctx.info`; vẽ lại mỗi lần bản nháp đổi |

Có `renderEditor` thì khung game WebGL nằm ở tab Chơi thử hoặc cột phải (GD chọn ở ▦ Bố cục; game đặt mặc định bằng
`layout.game`). Khung game bị che vẫn chạy (để xem nền, chụp ảnh).

Màu: `game/web/game.css` đổi biến `--lc-*` (`--lc-accent`, `--lc-bg`, `--lc-surface`, `--lc-border`, `--lc-text`…), cho cả
sáng (`:root`) và tối (`:root[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`). Không dựa vào tên class của
core: có thể đổi khi nâng core.

GD tự chỉnh bố cục trên máy của mình (kéo mép cột, ẩn / hiện, đổi bên các cột, chỗ đặt khung game): không cần code.

Nguyên tắc khi thiết kế (theo vỏ của core, quen tay với Sand Jam / AntLevel): việc GD làm hằng ngày (tìm, mở, sửa, chơi thử,
lưu) luôn thấy; việc ít dùng vào menu; việc của admin chỉ hiện với người có quyền (`rights` trong `/api/me`); nút chỉ hiện
khi dùng được (Lưu chỉ khi đang sửa); phần nhìn level chiếm nhiều chỗ nhất.

**Xong khi:** sửa trong editor → "Chưa lưu" → Lưu → Lịch sử có revision; Hoàn tác đưa editor về bản đã lưu; level của
người khác đang khoá thì editor chỉ xem.

### Bước 8. Bản WebGL của game (Unity)

**8a. Game build được WebGL** (CI CD Document mục 6, 7):

- Code compile cho WebGL: SDK chỉ có trên mobile phải có nhánh WebGL (asmdef bật WebGL, hoặc `#if !UNITY_WEBGL`).
- Không chờ đồng bộ (`Task.Wait()`, `.Result`, `HttpWebRequest.GetResponse()`, vòng lặp chờ luồng khác): tab treo, CPU 100%.
- `.jslib` không gọi `dynCall_*` / `Module.dynCall` trực tiếp, dùng `{{{ makeDynCall }}}` (WebAssembly 2023 từ 2.7.1).
- Không có `DEVELOPMENT_BUILD` trên bản WebGL của CI: cheat / debug cần cho tool phải dùng define khác.
- Cắt bớt nội dung ngoài gameplay (Home, LiveOps, thông báo, bảng xếp hạng) để bản WebGL nhẹ.
- Build WebGL ở máy một lần trước khi bật trên Jenkins.

**8b. Bridge: game nói chuyện với tool.** Tool mở bản game trong `<iframe src="/game/index.html?parent=<origin tool>">` cùng
origin và gửi `window.postMessage`. Phần JS của game (`.jslib` hoặc trang WebGL template) nghe `message`, chuyển vào C#
(`SendMessage`), và gửi trả lời lên `window.parent` với `targetOrigin` là `parent` trong query. `id` và `TAG` phải khớp
manifest `webgame`. Core chưa có package bridge Unity dùng chung; tham khảo bridge của Flow Out (repo game của Sand Jam)
và player giả `levelcore/contracts/fake_player.mjs` (đúng giao thức, chạy được).

Tool → game: `{target: <id>, method, arg: <chuỗi>}`

| `method` | `arg` | Game làm |
| --- | --- | --- |
| `LoadPack` | JSON `{pack, levels: {"<n>": level}, source}` | nạp bộ (chỉ gồm level cần xem), trả `packLoaded` |
| `UpdateLevel` | JSON `{pack, level: "<n>", data, source}` | thay đúng một level, trả `packLoaded` |
| `PreviewLevel` | `n` | dựng level đứng yên (thấy cả level), xong báo dòng `preview_ready` |
| `LoadLevel` | `n` | vào chơi level, báo `level_start` |
| `Highlight` | id prop (rỗng = bỏ) | làm nổi prop cùng loại, báo `highlight` |
| `SetOptions` | JSON `{speed}` | đổi tốc độ |
| `Cheat` | `win` \| `lose` \| `restart` | thắng / thua / chơi lại ngay |
| `Capture` | rỗng | chụp màn đang xem, trả `capture` |

`source`: `draft` (bản đang mở, có thể chưa lưu), `r<số>` (revision chọn ở Lịch sử), `link` (trang điện thoại).

Game → tool: `{source: <id>, type, …}`

| `type` | Trường | Khi nào |
| --- | --- | --- |
| `ready` | `caps: ['capture']` nếu chụp được | game khởi động xong |
| `packLoaded` | | sau `LoadPack` / `UpdateLevel` |
| `line` | `line: "[<TAG>] <lệnh> <đối số> k=v …"` | mọi sự kiện dạng dòng (bảng dưới) |
| `event` | `event: {...}` (≤ 4 KB, ≤ 20 000 mỗi lượt) | mỗi nước đi / sự kiện có ý nghĩa; tool lưu vào lượt chơi (dữ liệu cho solver, AI) |
| `capture` | `png: "data:image/png;base64,…"` hoặc `error` | trả lời `Capture` |

Dòng `line`:

| Dòng | Nghĩa |
| --- | --- |
| `preview_ready <n> props=<k>` | đã dựng xong level `n` để xem |
| `level_start <n> src=<source>` | bắt đầu chơi; `src` để tool kiểm đúng bản vừa gửi |
| `level_end <n> win\|lose\|quit time=<giây> [timeLeft=] [boosters=] [cause=] [cheat=1]` | hết lượt |
| `load_error <n> <lý do>` | không mở được level |
| `stuck <n> cause=<…>` | level bị kẹt |
| `highlight <id> count=<k>` | đã làm nổi |
| `cheat_error <lý do>` | cheat lỗi |

Mỗi lượt chơi (`level_start` → `level_end`) được tool lưu cùng mọi dòng và `event` (server Node).

**8c. Xuất level trong lúc build** (chỉ khi tool nhận level từ build): class `LevelToolCI` trong thư mục Editor, namespace
tuỳ ý, `public static void ExportLevels()`, đọc thư mục ra từ đối số `-levelToolOutput`, ghi **mỗi level một file
`<số>.json`** (raw y như tool lưu; thư mục con được, trùng số thì lỗi). Throw để build fail. CI tự tìm theo tên.

**8d. Tracking event của bản chơi thử (Realtime Events của BI) — tuỳ chọn.** Không phải game nào cũng cần; chỉ làm khi game
có order. Khi làm: **bản chơi thử dùng chung API key của bản Android** của game; game chưa có API key thì liên hệ
duongnt@sonat.vn. Kiểm event có lên và dữ liệu đúng chưa bằng tính năng Realtime Events (tài liệu Realtime Events ở mục 1).
Đây là tracking của game gửi lên BI, khác với dữ liệu lượt chơi tool tự lưu (bảng 8b).

**Xong khi:** tải zip bản WebGL lên tool (admin: bấm vào "Bản game" ở thanh trạng thái, hoặc ⬆ trong khung game), mở một
level thấy game dựng đúng; ▶ Chơi thử → khung game báo "Đang chơi level n · bản đang mở ✓"; sửa bản nháp thì khung game
dựng lại; (nếu có `caps`) Thư viện → 📷 Chụp ảnh còn thiếu ra ảnh đúng; (nếu làm 8d) chơi một level trên tool thì Realtime
Events thấy event của app Android với dữ liệu đúng.

### Bước 9. Jenkins gửi bản game và level lên tool

1. **Tool**: `bi.yaml` đã có `<PREFIX>_CI_TOKEN` (secret), `<PREFIX>_CI_BRANCH`, `<PREFIX>_CI_PACK` và `timeouts: long`.
   Tạo token ngẫu nhiên dài (`openssl rand -hex 32`), nhập vào tab Variables của tool trên BI.
2. **Jenkins admin**: tạo credential loại *Secret text*, ID `<slug>-level-tool-token` (vd `fishsort-level-tool-token`),
   giá trị đúng token ở trên. (CI tìm lần lượt `<slug>-level-tool-token`, `<projectName>-level-tool-token`,
   `level-tool-token`; khác thì khai `levelToolTokenCredentialId`.)
3. **Jenkinsfile** của game:

   ```groovy
   @Library('sonat-game-cicd') _
   sonatUnityBuild([
       projectName: 'Fish_Sort',
       levelToolUrl: 'https://fishsort.tools.sonatgame.com'
   ])
   ```

   Job có thêm ô **BUILD_WEBGL** (mặc định tắt). Tuỳ chọn: `levelToolExportMethod` (`Namespace.Type.Method`),
   `scheduledBuildPlatforms` thêm `'WebGL'` để có bản mỗi đêm.
4. Chạy job một lần với BUILD_WEBGL.

Tool xử lý (hợp đồng CI v1, `levelcore/contracts/README.md` mục "CI v1 và bản build"):

- `GET /api/ci/status` kiểm token trước khi build; token chỉ dùng được cho `/api/ci/*`.
- Bản build của nhánh `<PREFIX>_CI_BRANCH` (trống = mọi nhánh) thành bản đang dùng; nhánh khác nằm chờ, admin chọn ở hộp
  Bản game. Giữ 1 bản trước để quay lại. Gửi lại cùng bản thì `unchanged`.
- Level CI vào bộ `<PREFIX>_CI_PACK` (trống = bộ mặc định đầu), chờ player cùng lần chạy rồi mới nhập; level GD đã sửa
  trong tool thành `conflict`, không bị ghi đè.

**Xong khi:** job xanh; thanh trạng thái của tool hiện bản game mới (nhánh, số build); level CI (nếu có) vào đúng bộ.

### Bước 10. Deploy lên BI

Theo **Level Tools trên BI — User Manual** (A2–A5, B2–B3). Skill của Claude Code: `bi-onboard`, `bi-yaml`, `bi-release`.

1. Kiểm `bi.yaml` đã sinh: `slug`, kênh `release: {tag: '<slug>-v{semver}'}`, Dockerfile đúng runtime
   (`levelcore/deploy/Dockerfile.node` hoặc `Dockerfile`), `health: /healthz`, `database: sqlite`, `timeouts: long`. BI →
   Level Tools → **Check bi.yaml**.
2. **Đăng ký tool** (BI → Level & Experimentation → Level Tools → Register tool): chọn app Android và iOS của game, repo
   GitHub (`SonatGameProduct/<game>-level-tool`), Branch để trống; trên GitHub cấp quyền Read repo cho tài khoản ở dòng
   *Share read access with*; Verify → đợi Ready → Register. Tool mới đang tắt, người đăng ký là Owner.
3. **Trang của tool** (Level Tools → `<slug>`), các tab Overview · Releases · Variables · Members · Audit:
   - **Variables**: nhập giá trị cho mọi biến `required` (bảng dưới). Cột *Used by* là phần dùng biến (`server`); biến
     `secret` hiện `••••`, bấm 👁 để xem; *Not set* = chưa đặt, tool dùng mặc định. Save lưu cho lần deploy sau, Save &
     apply deploy ngay; nhãn *not applied* thì bấm Apply saved values.
   - **Overview → Platform**: Copy webhook URL, thêm vào GitHub repo → Settings → Webhooks. Repository / Branch có nút
     Change.
   - **Overview → Access**: bật công tắc *Enabled* ("The tool is live at its URL"). Người có quyền read trên Level Tools và
     quyền vào một app của tool mới mở được.
   - **Members**: thêm Editor (nhập biến) cho người cùng làm.
4. **Phát hành**: thêm entry vào `game/web/releases.json` (mục 6.5), `node levelcore/tools/releases.mjs tag <version>` in
   message của tag, push tag `<slug>-v<version>` (hỏi người dùng trước; skill `bi-release`). BI tự build rồi deploy sau
   khoảng 2 phút.
5. **Theo dõi ở tab Releases**:
   - Bảng *Component / Running / Newest build*: phần `server` đang chạy bản nào, bản build mới nhất là bản nào.
   - *Deployments*: State `healthy` là đang chạy; `pending` / `merged` / `syncing` đang triển khai; `pr_open` chờ Owner
     Approve (lần đầu deploy, dùng thêm secret…); `degraded` / `failed` là lỗi (User Manual A7).
   - *Recent builds*: `SUCCESS` / `FAILURE`, *Started by* `push` (tag) hoặc `manual` (nút Build). `FAILURE` thì mở số build
     để xem log Jenkins.
   - Nút **Build** build tay; **Deploy** chọn phiên bản để deploy (vd quay về bản cũ).

Biến trên BI. Tên biến là `<PREFIX>_` + tên ở bảng (vd `FISHLEVEL_BI_ENV`); BI chỉ hiện đúng các biến khai trong
`bi.yaml`, kèm mô tả, nhãn `required` / `secret`. Cách nhập: bấm ✎ ở dòng biến, dán giá trị **trần** (không nháy, không
khoảng trắng thừa, không `KEY=`), Save & apply. Giá trị thực tế lấy theo tool Sand Jam đang chạy trên BI prod
(`sandjam.tools.sonatgame.com`):

| Biến | Nhãn | Nhập gì | Giá trị thực tế (BI prod) |
| --- | --- | --- | --- |
| `SESSION_SECRET` | required, secret | chuỗi ngẫu nhiên, tạo bằng `openssl rand -hex 32`; đổi là mọi người phải đăng nhập lại | 64 ký tự hex, riêng mỗi tool |
| `ADMINS` | required | email admin, phẩy phân cách (core tự bỏ khoảng trắng, đổi chữ thường) | `a@sonat.vn,b@sonat.vn` |
| `BI_ENV` | required | `prod` hoặc `dev`, đúng môi trường BI tool đăng ký | `prod` |
| `BI_API_URL` | required | địa chỉ API của BI (không phải link giao diện) | `https://bi-apis.sonatgame.com` (dev: `https://bi-be-dev.sonatgame.com`) |
| `BI_FIREBASE_API_KEY` | required | Firebase Web App của BI, công khai | chuỗi bắt đầu `AIzaSy…`: chép từ tool khác cùng môi trường hoặc tài liệu BI Firebase Config |
| `BI_FIREBASE_AUTH_DOMAIN` | required | như trên | `sonat-bi-system.firebaseapp.com` (dev: `sonat-bi-system-dev.firebaseapp.com`) |
| `BI_FIREBASE_PROJECT_ID` | required | như trên | `sonat-bi-system` (dev: `sonat-bi-system-dev`) |
| `BI_FIREBASE_APP_ID` | required | như trên | dạng `1:<số>:web:<mã>`: chép như `API_KEY` |
| `BI_APP_ID` | required | app Android của game trên BI = package name (trống thì lấy `biAppId` trong manifest) | Sand Jam: `com.flow.out.watery.factory` |
| `BI_APP_ID_IOS` | | app iOS = `id` + App Store id; trống = chỉ Android | Sand Jam: `id6758755718` |
| `ALLOWED_DOMAIN` | | để *Not set* (mặc định `sonat.vn`) | Not set |
| `CI_TOKEN` | secret | `openssl rand -hex 32`; **cùng giá trị** Jenkins secret text `<slug>-level-tool-token`; trống = tắt nhận build | đã đặt (ẩn) |
| `CI_BRANCH` | | nhánh game mà build của nó thành bản đang dùng ngay; trống = mọi build | vd `develop` |
| `CI_PACK` | | bộ nhận level từ CI; trống = bộ mặc định đầu (`develop`) | Not set |

Quy tắc:

- `BI_ENV`, `BI_API_URL`, bốn biến Firebase và app id phải **cùng một môi trường BI**: tool ở `<slug>.tools.sonatgame.com`
  dùng giá trị prod; tool thử ở `<slug>.tools-dev.sonatgame.com` dùng giá trị dev. Lệch môi trường thì đăng nhập Google
  hoặc Level Hub lỗi.
- Firebase Web App config là công khai, nhưng không đặt service account hay key riêng tư vào các biến này.
- Biến của tool Sand Jam không có trong core: `LEVELTOOL_*` (tiền tố của Sand Jam), `BI_SERVICE_ACCOUNT_KEY`,
  `INGEST_KEYS`, `AGENT_TOKENS`, `LIVE_SYNC_HOUR`, `SOLVER_BUDGET`, `BACKUP`, `BI_APP_ID_ANDROID`. Không chép sang tool
  dựng trên core. Chỉ thêm `BI_SERVICE_ACCOUNT_KEY` khi game tự thêm job đọc số liệu BI (User Manual B5).
- Ở máy: cùng tên biến trong file `.env` gốc repo (chép từ `game/.env.example`, không commit), thường dùng giá trị BI dev.
  `ALLOWLIST` là đường dẫn tới file, mỗi dòng một email, không phải danh sách trong biến.

Yêu cầu tối thiểu của BI (core đã đáp ứng, không đổi): đăng nhập Firebase kiểm ID token ở server, `/healthz` 200, Docker
`USER 10001`, dữ liệu ở `/data`, cấu hình từ biến môi trường, `bi.yaml` không khai CPU / RAM.

**Xong khi:** mở `https://<slug>.tools.sonatgame.com/app/`, đăng nhập Google được, thấy bộ và level (nhập raw nếu bộ trống).

### Bước 11. BI Level Hub (khi game đẩy bộ level lên BI)

Theo **Platform Document**. Cần: tài khoản người dùng có quyền Level Hub (Read để xem, Create Asset Group để đẩy) trên app
của game; `biAppId` / `<PREFIX>_BI_APP_ID[_IOS]` đúng; `levelhub.acronym`, `obstacleCodes` trong manifest; `describeHub`
trong `rules.mjs`. Thử ở BI dev trước, prod sau; API URL, Firebase và appId phải cùng môi trường.

Trong tool: màn Thứ tự → ⬆ Xuất Level Hub → **Kiểm tra** (chốt snapshot từng revision) → Xuất zip hoặc Đẩy lên BI. Mở bộ
có sẵn trên BI: ô chọn bộ → mục Level Hub, hoặc ⋯ cuối danh sách → Mở bộ từ BI Level Hub.

Hộp xuất của core có dải kéo chọn, nút nhanh, thống kê độ khó, ảnh cuộn ngang, kiểm tên / gợi ý version và lịch sử đẩy.
Đổi tham số thì kiểm tra lại; gói giữ đúng revision đã kiểm. Node kèm ảnh capture PNG / JPEG / WebP theo nội dung level,
không kèm SVG / ảnh sơ đồ; Python hiện chỉ có raw / metadata. Nhãn độ khó lấy từ `levelhub.difficultyLabels` trong
manifest (tuỳ chọn), metadata từ `describeHub`; ảnh từ bridge capture của game. Ảnh và kết quả kiểm thử core với BI giả:
[SMOKE-LEVEL-HUB.md](SMOKE-LEVEL-HUB.md).

**Xong khi:** Kiểm tra không lỗi; bộ đẩy lên BI dev hiện trên giao diện Level Hub dev đúng số level, metadata đúng.

### Bước 12. Bàn giao

- `AGENTS.md` gốc repo: nguồn raw và cách lấy bản mới, định dạng level, `formatVersion`, bridge (id, tag, nằm ở đâu
  trong repo game), quyết định giao diện, điều core còn thiếu.
- `README.md` gốc repo: tool là gì, URL, ai là admin, cách chạy ở máy.
- Báo người dùng theo quy tắc 10 ở mục 0.

---

## 6. Tham chiếu

### 6.1 Lệnh

| Việc | Lệnh |
| --- | --- |
| Test của game | `node --test game/tests/*.test.mjs` |
| Chạy ở máy | `ChayDev.bat` (đọc `game/game.env`, nạp `.env`, DB `data/dev.db`) |
| Server Node tay | `<PREFIX>_DEV=1 node levelcore/node/server.mjs` |
| Zip raw để nhập | `node levelcore/tools/zip_raw.mjs game/tests/raw data/raw.zip` |
| Kiểm khung Có gì mới | `node levelcore/tools/releases.mjs check game/web/releases.json` |
| Message của tag | `node levelcore/tools/releases.mjs tag <version>` |
| Player giả để thử khung game | `node levelcore/contracts/fake_player.mjs data/fake.zip <id> <tag>` rồi tải lên ở hộp Bản game |
| Cài bản WebGL không qua HTTP | `levelcore/tools/install_game.py [zip]` |

### 6.2 Route hay dùng

`/api/me` · `/api/packs` · `/api/packs/{pack}/levels[/{n}]` (GET / POST / PUT với `If-Match: "r<rev>"` / DELETE) ·
`…/revisions` · `/revert` · `/relevel` · `/api/locks/packs/{pack}/levels/{n}` · `/api/promote` · `…/import?dry_run` ·
`…/export` · `…/validate` · `…/levelhub/preflight|export|upload` · `/api/game` · `/api/game/builds` · `/api/ci/*` ·
`/api/audit` · `/api/events` (SSE). Bảng đủ và hình dữ liệu: `levelcore/contracts/README.md`.

Lỗi luôn là JSON `{"detail": …}`: 400 · 401 · 403 · 404 · 409 · 412 (kèm `head_rev`, `author`, `body`) · 413 · 422 (kèm
`validation`) · 423 (kèm `holder`) · 428 (thiếu `If-Match`).

### 6.3 Server Node và Python

| | Node (game mới) | Python (game cũ, plugin `game/server/gameplugin`) |
| --- | --- | --- |
| Route của hợp đồng v1 | đủ | đủ |
| Link chơi trên điện thoại, lưu lượt chơi, ảnh level, xếp thứ tự, thùng rác, quản trị trong app | có | không (giao diện tự ẩn) |
| Dockerfile | `levelcore/deploy/Dockerfile.node` | `levelcore/deploy/Dockerfile` |

### 6.4 Quyền trong tool

Admin = `<PREFIX>_ADMINS` cộng danh sách thêm ở Quản trị (server Node); rỗng cả hai thì chỉ máy DEV. Việc theo quyền
(`admin` hoặc `everyone`, đổi ở Quản trị): `production`, `archive`, `breakLock`, `gameBuilds`, `levelhubUpload`,
`shareLinks`, `reorder`. Ai vào được tool: domain `<PREFIX>_ALLOWED_DOMAIN` (mặc định `sonat.vn`) hoặc `ALLOWLIST`.

### 6.5 Changelog của tool (Có gì mới)

`game/web/releases.json`, người đọc là GD; test `game/tests/releases.test.mjs` kiểm khung. Mỗi entry: `version`, `date`
(dd/MM/yyyy, đặt khi tag), `title` (≤ 60 ký tự), các phần theo thứ tự `notice` (Cần chú ý), `added` (Mới), `changed` (Thay
đổi), `fixed` (Sửa lỗi), `dev` (Cho Dev, không hiện trong app). Mỗi dòng một thay đổi, ≤ 120 ký tự, ≤ 5 dòng mỗi phần, viết
điều GD thấy, không tên file / route / biến. Chi tiết: `levelcore/AGENTS.md` mục Changelog.

---

## 7. Nâng core, đóng góp về core

Nâng core (mỗi khi core có bản mới):

```sh
git fetch core
git show core/main:levelcore/CHANGELOG.md     # đọc "Cần chú ý" của các bản mới: biến mới, đổi hợp đồng hook
git merge core/main                           # chỉ đổi levelcore/ và file của core
node --test game/tests/*.test.mjs
```

Xung đột chỉ có thể ở `README.md`, `AGENTS.md`, `CLAUDE.md` gốc repo: giữ bản của game (`git checkout --ours <file>`). Mở tool,
thử một level, commit merge, phát hành như thường.

Game cần core làm thêm: thêm **điểm mở rộng có mặc định** ở repo core (game cũ không phải đổi), không rẽ nhánh theo tên
game. Làm ở nhánh của `level-tool-core`, chạy `node levelcore/contracts/run.mjs` (hai server) và
`node --test levelcore/node/tests/*.test.mjs`, mở PR. Gấp thì commit riêng chỉ đụng `levelcore/` trong repo game rồi
cherry-pick sang core.

---

## 8. Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Server báo lỗi manifest khi khởi động | thiếu `tool` / `game` / `prefix` / `rules`, sai đường dẫn | sửa `game/manifest.json` (đường dẫn tính từ thư mục manifest) |
| Mọi level đỏ ở danh sách | `validateLevel` viết sai với raw thật | chạy test với `game/tests/raw/`, sửa luật |
| Khung game: "Chưa có bản game WebGL" | server chưa có player | admin tải zip lên, hoặc chạy job Jenkins với BUILD_WEBGL |
| Khung game đứng ở "Đang dựng level…" | bridge không trả `packLoaded` / `preview_ready`, sai `id` / `tag` | so `webgame` trong manifest với bản game; thử bằng player giả để tách lỗi tool / game |
| "Game đang chơi … không phải bản vừa gửi" | game không ghi `src=` hoặc dùng level cũ | game đọc `source` từ `LoadPack` / `UpdateLevel` và ghi vào `level_start` |
| 📷 Chụp ảnh không có | bản game không khai `caps: ['capture']` | thêm `Capture` vào bridge |
| Tab trình duyệt treo, CPU 100% | code chờ đồng bộ trong game | CI CD Document mục 6 và 9 |
| Jenkins: `No level tool token…` | chưa có Jenkins secret | tạo secret text `<slug>-level-tool-token` |
| Jenkins: `refused the CI token (HTTP 401)` | token Jenkins khác `<PREFIX>_CI_TOKEN` | đặt lại hai bên cùng giá trị, Apply trên BI |
| Upload 413 / 4xx | zip quá lớn hoặc sai nội dung | đọc lý do trong log Jenkins |
| Bản build mới nằm "Chờ chọn" | build từ nhánh khác `<PREFIX>_CI_BRANCH` | admin chọn ở hộp Bản game, hoặc đổi `CI_BRANCH` |
| Level CI thành "conflict" | GD đã sửa level đó trong tool | đúng thiết kế: GD xem rồi quyết định ở Nhập (Ghi đè) |
| Đăng nhập Google lỗi trên BI | Firebase / API URL / appId khác môi trường | ba giá trị cùng dev hoặc cùng prod |
| Đẩy Level Hub 403 | tài khoản thiếu quyền Level Hub trên app | nhờ BI Admin cấp Read / Create Asset Group |
| Verify trên BI lỗi `repo_unreadable`, `bi_yaml_invalid`, `slug_taken` | xem bảng lỗi A2 của BI User Manual | |
| Deploy bị từ chối `required variables have no value` | thiếu biến bắt buộc | nhập ở tab Variables |
| Sửa biến mà tool không nhận | giá trị còn *not applied* | Variables → Apply saved values |
| Build `FAILURE`, deployment `degraded` / `failed` không tự sửa được | | gửi quyendv@sonat.vn hoặc thachpn@sonat.vn: slug, số build hoặc số deployment, dòng lỗi BI hiện |

---

## 9. Nghiệm thu (agent tự kiểm trước khi báo xong)

- [ ] `node --test game/tests/*.test.mjs` xanh; mọi raw trong `game/tests/raw/` qua `validateLevel`.
- [ ] Không có thay đổi nào trong `levelcore/`, `ChayDev.bat`, `.claude/skills/` (`git status`, `git diff core/main -- levelcore`).
- [ ] Chạy ở máy đủ 6 ý của bước 6.
- [ ] (Mức 2) editor: sửa, lưu, hoàn tác, chỉ xem khi bị khoá (bước 7).
- [ ] (Có bản WebGL) xem và chơi thử đúng level, đúng bản (bước 8).
- [ ] `bi.yaml` qua Check bi.yaml; `.env` và secret không nằm trong git.
- [ ] `game/web/releases.json` qua kiểm khung; `AGENTS.md`, `README.md` gốc repo đã điền phần của game.
- [ ] Đã báo người dùng: file đã viết, chỗ đoán, việc còn chờ người khác (Jenkins secret, đăng ký BI, quyền Level Hub).
