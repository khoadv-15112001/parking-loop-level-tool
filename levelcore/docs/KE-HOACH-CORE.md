# Kế hoạch Level Tool Core cho Claude

**Mục tiêu:** team game chọn Python/FastAPI hoặc Node, đưa một level thật vào tool, rồi GD có thể tìm, sửa, kiểm, xuất lên BI và chơi thử. Team game chỉ viết phần hiểu dữ liệu và cách chơi của game. Bản đầu phát triển từ `level-tool-core/main`, dùng một game mẫu cho cả hai server. Sand Jam và Antopia là nguồn tham khảo; vòng này chỉ sửa repo core, không sửa code CI/CD.

## Ai làm gì

| Bên | Việc |
|---|---|
| Claude | Toàn bộ code, test, tài liệu, starter và skill trong repo core. Tự dựng game mẫu, BI giả và player giả; chạy test và báo kết quả thật. |
| Dev Game | Đưa raw mẫu và luật của game; làm phần Unity (bridge, exporter khi cần, dòng `levelToolUrl` trong Jenkinsfile); nhập biến và bật tool trên BI; chạy smoke theo kịch bản và duyệt cuối mỗi đợt. |
| BI | Tạo tool trên BI và thêm Dev Game vào; cấp quyền app và Level Hub trên app thử; gửi thông tin cấu hình theo tài liệu (Firebase web config, BI API URL). Jenkins admin tạo secret CI theo *CI CD Document*. |

## 1. Những việc team game được dùng ngay

| Việc của GD | Core giao sẵn | Team game cung cấp |
|---|---|---|
| Đưa bộ level đầu tiên vào tool | Nhập JSON/ZIP, xem trước rồi mới ghi: liệt kê level tạo mới, cập nhật, giữ nguyên, xung đột hoặc lỗi; tải bộ về ZIP. Không ghi đè level GD đã sửa (luật ở mục 3). Dùng lại import/export của main. Kiểm cả bộ bằng cùng validator với editor, bấm lỗi để mở đúng level. | Raw JSON mẫu, validator; adapter đọc file chỉ khi game dùng quy ước tên hoặc cấu trúc ZIP riêng. |
| Tìm và sửa một level | Một danh sách dùng lại khi chọn level để sửa hoặc chơi. Tìm theo số, dải `10–20`, danh sách `2,5,9` và chữ tiếng Việt không dấu. Có tạo mới, nhân bản từ level đang mở, sửa JSON, lưu, cảnh báo bản chưa lưu. | Hàm tạo level và luật kiểm. Nếu muốn, khai báo nhãn, chuỗi tìm kiếm hoặc ảnh cho mỗi dòng. |
| Có editor dễ dùng trước khi viết editor bản đồ | **Form thuộc tính đơn giản.** Game khai báo field, nhãn, kiểu số/chữ/bật tắt/danh sách chọn. Core dựng input, giữ kiểu dữ liệu, trạng thái chỉ đọc và gọi cùng đường lưu/kiểm định. Ví dụ GD chỉnh thời gian chơi bằng ô số, dù dev game chưa viết editor hình học. | Vài dòng mô tả field, ví dụ `{path:["settings","time"], label:"Thời gian (giây)", type:"number"}`. Game có map editor riêng vẫn dùng chung danh sách, form và nút lưu. |
| Hai người sửa cùng level | Dùng lại khóa, kiểm revision, lịch sử và khôi phục của main. Khi xung đột, giữ bản đang sửa, cho so với head, rồi chọn **Giữ bản server (rN)**, **Giữ bản của tôi (ghi đè rN)** hoặc lưu thành bản sao. Ghi đè vẫn an toàn vì lịch sử chỉ thêm, không xóa. Hiển thị JSON hoặc diff của game nếu có. | Có thể bổ sung cách diễn giải thay đổi hoặc hình so sánh. |
| Xuất và đẩy BI | Chọn bộ/dải → kiểm lỗi → tải ZIP hoặc đẩy Hub → xem trạng thái. Tạo ZIP và upload dùng cùng danh sách revision đã chọn. | App ID, acronym từng nền tảng; điền metadata riêng khi game có, chẳng hạn mã obstacle. |
| Chơi thử | Nhận player ZIP từ Jenkins, phục vụ WebGL đúng header, mở player cạnh editor. Hai hành động rõ ràng: **chơi bản nháp** để thử nhanh và **chơi revision đã chọn** để tái hiện lỗi. | Build Unity và bridge biết nạp raw, xác nhận đã nhận đúng level. Import level từ Jenkins chỉ bật khi game có exporter. |

**Chỗ đáng đầu tư mới** là form thuộc tính, tìm theo dải số và nối các thao tác đang rời nhau: từ lỗi kiểm định mở đúng level, từ xung đột giữ được bản sửa, từ lịch sử chơi đúng revision. Main đã có danh sách, tạo/nhân bản, import, validate cả bộ, lịch sử, SSE và khung WebGL. Claude cần chạy từng luồng trước khi sửa và chỉ bổ sung bước thiếu. Dùng lại drawer/dialog/màn đang có.

## 2. Game mới cần viết bao nhiêu

- **Khởi đầu:** một manifest cho tên tool, phiên bản format và đường dẫn plugin; một ES module thuần có `blankLevel(n, template?)` và `validateLevel(level, {levelNo, formatVersion}) → {isValid, errors, warnings}`. Starter mở được editor JSON ngay. Danh sách field để bật form là tùy chọn. Field chưa khai báo vẫn còn nguyên trong raw khi sửa field khác. Chưa dựng schema engine, widget registry hay trình sửa mảng/object đồ họa.
- **Thêm khi cần:** `levelSummary(level)`, `levelChanges(prev,next)`, `setLevelNumber(level,n) → level`, `serializeLevel(level,ctx) → string`, `describeHub(level,n)` và `hubLayout(level)`. Mặc định dùng JSON UTF-8, số level theo pack và metadata Hub tối thiểu. Game cần ghi số vào bên trong raw thì khai hook đổi số, dùng cùng hook khi nhân bản và xuất. Editor và bridge có DOM nằm riêng khỏi module thuần.
- **Hai server, một bộ luật game:** Node import ES module trực tiếp. Python gọi runner Node theo **lô** cho một lần kiểm hoặc xuất bộ; không mở tiến trình cho từng level. Plugin Python cũ vẫn chạy nguyên bằng GamePlugin và các callable hiện tại. Với game mới dùng JS toàn bộ; chỉ bổ sung cơ chế chuyển từng hook giữa hai ngôn ngữ khi có game thực sự cần migration.
- **Giữ bản cũ đọc được:** mỗi revision mới lưu raw, digest và formatVersion (formatVersion để trong cột `revisions.meta` sẵn có). Revision legacy chưa rõ format được đánh dấu khi đọc. Lịch sử luôn cho xem/tải raw gốc. Nếu player không đọc được format cũ, hiển thị lý do. Chỉ thêm `upgradeLevel` khi có cặp format thật cần chuyển. Khi đó chơi bản đã chuyển phải ghi rõ nguồn rN; không sửa raw gốc.
- **Sửa không làm đổi phần không sửa:** form và editor JSON đi qua `JSON.parse`/`stringify`, nên key dạng số bị xếp lại, `1.0` thành `1` và số nguyên lớn hơn 2^53 mất chính xác. Test đọc–ghi với raw thật của Sand Jam và Antopia. Chỉ tạo revision khi nội dung sau khi parse thật sự đổi. Game cần giữ định dạng riêng thì khai `serializeLevel`.

Một repo game có thể lấy riêng hàm tìm kiếm, form hoặc bộ đóng ZIP mà không cần chạy toàn bộ shell. Trong repo core, đặt entry point cạnh feature có caller, ví dụ làm form chỉ cần `fields, level, readOnly, onChange`; làm ZIP chỉ cần snapshot, hàm đọc raw và metadata. Test được bằng dữ liệu trong bộ nhớ. Đợt đầu dùng module trong repo có version, chưa phải duy trì thêm gói npm/PyPI hay hệ thống plugin động.

## 3. Hai tích hợp nên viết chắc một lần

**BI Hub.** Tool xác thực Firebase phía server, dùng ID token mới của chính user để gọi Hub. Chốt snapshot gồm pack, số xuất, level, revision và digest trước preflight. Kiểm tên chín phần bằng parse-name; tạo ZIP tối đa 200 MiB với `LevelMetadata.json` và raw thật trong `Raw/`; gửi multipart và lưu groupId. Xử lý riêng 401/403/409/413. Nếu mất phản hồi sau POST, tìm group cùng tên và appId do chính user tạo sau lúc bấm (`createdBy`, `createdAt`): có thì theo dõi tiếp, không có thì cho đẩy lại. Hiện thời điểm cuối đã kiểm. Khi user mở lại thì lấy token mới để cập nhật PROCESSING. Không lưu refresh token và không cần service account analytics cho tính năng này.

**CI và WebGL.** Nhận contract v1 hiện có: GET `/api/ci/status`, POST `/api/ci/webgl`, POST `/api/ci/levels` khi bật importer. Contract này đủ cho mốc đầu, không sửa code CI/CD. CI token chỉ dùng cho các route CI. Levels khử trùng theo digest ZIP trong phạm vi tool, `by=jenkins-57` là thông tin audit. Player nhận diện theo buildUrl, tiếp theo branch + buildNumber, thiếu thì theo digest. Hai request cùng artifact, kể cả đồng thời, chỉ cài/nhập một lần. Stream file tạm, giới hạn dung lượng cả khi giải nén, kiểm đường dẫn, index.html và Build/ trước khi cài. File .br trả Content-Encoding br; .wasm.br có MIME application/wasm. Bridge kiểm origin, cửa sổ và phản hồi của lần nạp hiện tại.

- **Bản hiện hành.** Biến `<PREFIX>_CI_BRANCH` chọn nhánh theo dõi. Để trống thì mọi build tự thành bản hiện hành sau khi kiểm xong, như Sand Jam hiện nay. Có giá trị thì chỉ build của nhánh đó tự lên; build nhánh khác vào danh sách chờ để admin chọn. Gửi lại build đã có không đổi gì. Giữ ít nhất bản rollback, dọn bản không dùng theo quota.
- **Level đi theo player của cùng lần chạy.** Jenkins luôn gửi level trước player, với cùng `by`. Level nhận về nằm chờ; khi player cùng `by` tới thì theo player: player tự lên thì nhập level ngay, player phải chờ thì nhập level khi admin chọn build đó. Player bị từ chối hoặc quá 2 giờ chưa tới thì bỏ level chờ và ghi lý do.
- **Nhập không ghi đè bản GD đã sửa.** Mỗi level giữ digest của lần nhập trước. Dữ liệu mới khác, trong khi head trong tool cũng đã đổi kể từ lần đó, thì báo xung đột và không ghi. Tool đi trước còn game chưa cập nhật thì báo "chờ game". Level đang khóa báo riêng; level không có trong file nhập được giữ. Luật này dùng chung cho nhập tay và nhập từ CI, tham khảo `importExport` của Sand Jam.

**Triển khai BI.** Một starter theo runtime: Docker chạy USER 10001, /healthz, /data, database SQLite khai trong bi.yaml, timeouts long và secret qua env (thêm `<PREFIX>_CI_TOKEN`, `<PREFIX>_CI_BRANCH`). Tool BI mới yêu cầu `<PREFIX>_ADMINS` có giá trị; vl_sso cũ chỉ là tùy chọn legacy Python. SQLite lưu raw, revision, audit, biên nhận CI và groupId. Player và level CI đang chờ là file nạp lại được. Hiện kết quả nhận build/đẩy Hub và lỗi gần nhất trong màn sẵn có; lọc credential khỏi log. Dùng checklist và hành vi tối thiểu này thay cho dự án quản trị, backup hay quan sát vận hành riêng.

## 4. Làm theo bốn đợt

| Đợt | Giao việc | Duyệt khi |
|---|---|---|
| 0 · Khóa đầu vào | Claude chạy baseline ở main, ghi tập route mốc đầu, chép plan này vào nhánh mới. Dev Game nhờ BI tạo tool trên tools-dev, thêm Dev vào, cấp quyền app/Level Hub cho app thử và gửi thông tin cấu hình; nhờ Jenkins admin tạo secret CI. Dev Game hỏi BI hai câu: core đứng ở đâu so với `SonatBI/level-tool-template`, và backup SQLite khi đang chạy WAL lấy thế nào. Dev Game chốt project Unity/build dùng cho smoke thật. | Biết phần nào dùng ngay, phần nào cần viết. Ghi trạng thái từng đầu vào bên ngoài; mock chạy được trong lúc chờ. |
| 1 · Một game từ dữ liệu đến editor | Claude giữ đường legacy Python và port đúng route cho luồng đầu sang Node. Dùng cùng shell, game JS và test HTTP. Giao import, danh sách, form, kiểm cả bộ, sửa và lịch sử. | Trên cả hai runtime: GD nhập bộ có file lỗi và có level đã sửa trong tool, thấy đúng lỗi và xung đột; tìm bằng dải số; nhân bản level; sửa một field mà không mất field khác. Hai tab lưu cùng revision chỉ một lần thành công; tab còn lại giữ được bản sửa và chọn được giữ bản nào. Dev Game duyệt lát cắt này trước khi port tiếp. |
| 2 · Từ editor đến BI và WebGL | Claude dùng lại client/installer hiện có, thêm snapshot, nhận CI và chọn revision; dựng BI giả và trang HTML giả bridge có file Brotli thật. | Hai server xuất cùng raw/metadata. Đổi head sau preflight không đổi gói. Hai nhánh cùng số build hoạt động; build nhánh không theo dõi không đổi bản hiện hành và level đi kèm chưa được nhập. ZIP lỗi giữ player cũ. Chơi được nháp chưa lưu và r1 khi head đã là r2; player xác nhận nội dung phân biệt được. Hub báo đúng 401/403/409/413. Route CI chỉ nhận CI token, CI token không gọi được API người dùng. User có quyền tool nhưng thiếu quyền BI thấy đúng lỗi 403 của BI. |
| 3 · Chứng minh team sau tiết kiệm việc | Claude giao generator chọn runtime viết bằng Node (`tools/new_game.py` giữ lệnh cũ và gọi sang với runtime Python), README có mục nâng core, AGENTS.md có quy tắc changelog ở mục 6, skill new-tool ngắn theo layout main. Dùng bốn skill BI chính thức bi-new, bi-onboard, bi-yaml, bi-release cho phần triển khai. Dev Game chạy container, restore DB + nạp lại player, smoke bi-dev/Unity khi có quyền. | Một phiên Claude mới, chỉ có README và skill, thêm **game mẫu thứ hai có schema khác** bằng `game/` và cấu hình triển khai, với raw và luật do Dev Game đưa; không sửa core. Nâng game thứ hai từ commit core cũ lên commit mới chỉ bằng merge, không đụng `game/`. Ghi số file game tự viết, thời gian từ checkout tới lần sửa/chơi đầu và phần phải chép tay; mỗi đoạn chép tay là ứng viên cải tiến. Tách kết quả mock và kết quả thật. |

Phần tốn công nhất là tập route Node và việc chứng minh hai backend cho cùng hành vi. Chốt lịch sau đợt 0 bằng số route thực sự thiếu. Dev Game duyệt cuối mỗi đợt. Nếu chưa có project Unity hoặc quyền bi-dev, ghi đúng bài smoke còn chờ.

## 5. Claude tự kiểm và báo cáo

- Mỗi lần bàn giao ghi lệnh đã chạy, ref, kết quả thật và phần chưa chạy được kèm lý do.
- Test HTTP chung viết bằng `node:test` + `fetch`, nhận `BASE_URL`, chạy với cả hai server. Suite riêng giữ pytest cho Python và `node --test` cho Node.
- Smoke trình duyệt là kịch bản viết sẵn trong repo; Dev Game chạy tay khi duyệt. Chưa dựng CI riêng ở vòng này.
- Code mới mở được DB do main @647dc34 tạo: bảng mới dùng `CREATE TABLE IF NOT EXISTS`, formatVersion nằm trong `revisions.meta`. Có test chạy trên một DB mẫu tạo bằng main.
- Không sửa Sand Jam, Antopia hay code CI/CD để test qua.

## 6. Quy tắc changelog

Viết cho người đọc, không phải nhật ký commit. Dùng cho `CHANGELOG.md` của core (người đọc là Dev Game) và bảng **Có gì mới** của mỗi tool (người đọc là GD). Starter có sẵn bảng này, dữ liệu entry và một test kiểm khung; AGENTS.md của starter chép quy tắc này.

**Khung một entry.** Dòng đầu `version · dd/MM/yyyy · tiêu đề`, tiêu đề tối đa 60 ký tự, nói chủ đề chính. Sau đó là các phần theo đúng thứ tự dưới đây; phần trống thì bỏ.

| Phần | Ghi gì |
|---|---|
| Cần chú ý | Việc phải làm sau khi lên bản (tải lại trang, chạy lại BUILD_WEBGL, thêm biến) và thay đổi dễ gây nhầm (số liệu đổi cách tính, dữ liệu tự chuyển). Ở core: bước nâng cấp bắt buộc. |
| Mới | Việc trước đây chưa làm được. |
| Thay đổi | Việc cũ nay làm khác. |
| Sửa lỗi | Lỗi đã gặp nay không còn. |
| Cho Dev | Chỉ có ở tool: route, biến, migration, hook. Không hiện trong app, chỉ vào message của tag. |

**Mỗi dòng:**

- Một thay đổi, một câu, tối đa 120 ký tự; không giải thích cách làm.
- Mở đầu bằng chỗ thấy được, đúng nhãn trong app: `Chơi thử:`, `Editor ▸ Kiểm tra:`.
- Ghi điều người dùng thấy. Các phần cho GD không có tên file, hàm, route hay thuật toán.
- Sửa lỗi viết theo hiện tượng: "Chơi thử không còn báo thua khi cửa sổ mất focus."
- Mỗi phần tối đa 5 dòng; nhiều hơn thì gộp theo tính năng. Lỗi sinh ra và đã sửa trong cùng phiên bản thì không ghi.

**Quy trình.** Commit có thay đổi người dùng thấy thì thêm hoặc sửa dòng trong entry của phiên bản kế tiếp. Trước khi tag, đọc lại cả entry, gộp dòng cùng tính năng và chỉ giữ trạng thái cuối. Message của tag là chính entry đó. Test kiểm khung chặn entry sai thứ tự phần, dòng quá 120 ký tự, phần quá 5 dòng hoặc thiếu tiêu đề.

**Ví dụ.** Sand Jam 1.0.4 hiện có 9 dòng dài trong một danh sách; viết gọn lại theo khung:

```
1.0.4 · 03/11/2026 · Chơi thử và phân tích
Cần chú ý
- Slot đang dùng chung một level được tự tách thành bản riêng khi tool khởi động.
Mới
- Chơi thử (cửa sổ riêng): nút Chơi lại, Thắng, Thua, Cheat và x2 lời giải ngay dưới game.
- Phân tích: lịch sử chơi thử tay, gồm bản nháp và bản cũ, tự cập nhật.
Thay đổi
- Chơi thử: kết quả gần đây chỉ tính lượt chơi tay, ẩn lượt dùng cheat hoặc tự phát lời giải.
- Ước lượng thời gian lời giải tính thêm quãng kéo, đổi hướng và số lần dời block.
Sửa lỗi
- Chơi thử không còn báo thua khi cửa sổ mất focus.
- Editor: nút Slot không còn lệch khi tên level dài.
```

## 7. Phần mở rộng nào đáng lấy tiếp

| Khi gặp nhu cầu thật | Module nên lấy | Phần game giữ |
|---|---|---|
| GD thường test cùng một bản trên điện thoại/nhờ QA tái hiện | **Link chơi thử theo revision** có hạn và thu hồi được, QR chỉ là cách mở link. Sand Jam và Ant đều có luồng này. Đây là ứng viên đầu tiên sau mốc 1. | Bridge, build tương thích và chính sách cho phép chia sẻ. |
| GD xếp thứ tự hoặc giữ vị trí cố định cho production | Lấy các phép `applyOp`, `inverseOp`, `diffSequences` từ Sand Jam. Dùng với slot có khóa ổn định để kéo, ghim, undo và so hai bộ. | Quan hệ slot–level và policy promote/proof của game. Game chỉ quản lý pack đánh số có thể dùng relevel của main. |
| Game đã có solver C# chạy ngoài Unity | **Helper chạy worker .NET**, dùng subprocess stdin/stdout như Sand Jam. Host nhận command/argv tin cậy, khởi động, đợi ready, ghép request ID, timeout, dừng khi rảnh và báo lỗi khi crash. Giao kèm adapter thật + test worker giả khi có game dùng. | Binary, catalog, input/output, luật giải và budget. Không bắt starter cài .NET, chưa làm scheduler/cache đa ngôn ngữ. |

**Bỏ khỏi backlog core hiện tại:** dashboard Live BI, mô hình độ khó, replay/telemetry, Asset Test, API agent, schema DB chung giữa Python và Node, registry plugin và bộ widget đồ họa tổng quát. Các feature đang chạy ở repo game vẫn là nguồn tham khảo. Chỉ mở lại khi có workflow cụ thể của team kế tiếp và chỉ ra được code tích hợp nào team đó sẽ không phải viết.

### Nguồn để Claude bắt đầu đúng chỗ

- **Core main @ 647dc34** — `levelcore/server/levelcore/{plugin,store,bihub,webgame}.py`, `levelcore/web/js/{main,sync,webgame}.mjs`, `levelcore/template/game/web/game.mjs`, `levelcore/tools/new_game.py`. Đọc theo ref vì checkout local có thể ở nhánh khác.
- **Sand Jam @ 96f0cff** — `core/query.mjs`, `app/js/fields.mjs` (lấy input cơ bản), `app/js/levelcompare.mjs`, `server/{routes-ci,webgl,bi,levelhub,solver}.mjs`, `core/seqops.mjs`, `server/store.mjs` (`importExport`: luật xung đột khi nhập), `app/js/whatsnew.mjs` (bảng Có gì mới, đổi dữ liệu sang khung mục 6).
- **Antopia @ 9eff49d** — `app/js/ui/{conflict,diff,playlinks}.mjs`, `server/app/{playlinks,bihub,playtest}.py`. Phần CI ở working tree `feat/level-tool-ci-contract` chỉ dùng đối chiếu, chưa thuộc main.
- **Core feature/basecore @ dd2b539** — đọc `docs/BAN-GIAO.md` và `tests/fakegame/` để thấy cách kiểm thiếu hook. **sonat-game-cicd @ b2211c6** — `resources/python/level_tool_upload.py` là request thực tế của Jenkins.
- **BI Backend** — *CI CD Document* mục 4–5, *Platform_Document (Internal)* mục 1–6 và *Level Tools trên BI — Hướng dẫn cho Tool Dev* B1–B5.
