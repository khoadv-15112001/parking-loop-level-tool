import { qrImage } from '../../js/share.mjs';
import { sandJamIcon, sandJamObstacleIcon } from './icons.mjs';

function node(tag, attrs = {}, ...children) {
  const el = Object.assign(document.createElement(tag), attrs);
  el.append(...children);
  return el;
}

const button = (label, onClick) => node('button', { type: 'button', onclick: onClick }, label);
const paragraph = (text, className = '') => node('p', { className }, text);
const badge = (text, kind = '') => node('span', { className: `badge ${kind}` }, text);
const input = (attrs = {}) => node('input', attrs);
const label = (name, field) => node('label', {}, name, field);
const select = (...labels) => node('select', {}, ...labels.map(name => node('option', {}, name)));
const check = (name, checked = true) => node('label', { className: 'check' }, input({ type: 'checkbox', checked }), name);
const form = (...fields) => node('div', { className: 'sj-popup-form' }, ...fields);
const close = { label: 'Đóng' };
const cancel = { label: 'Huỷ' };
const primary = (label, value = label) => ({ label, primary: true, value });

function example(id, label, kind, content, actions, size) {
  return { id, label, kind, options: { title: label, content, actions, size } };
}

function table(headers, rows, changed = []) {
  return node('div', { className: 'sj-popup-table' }, node('table', {},
    node('thead', {}, node('tr', {}, ...headers.map(text => node('th', { scope: 'col' }, text)))),
    node('tbody', {}, ...rows.map((row, index) => {
      const tr = node('tr', {}, ...row.map(cell => node('td', {}, cell)));
      if (changed.includes(index)) tr.dataset.change = 'true';
      return tr;
    })),
  ));
}

function card(title, ...content) {
  return node('section', { className: 'card' }, node('h4', {}, title), ...content);
}

function pair(...children) {
  return node('div', { className: 'sj-popup-pair' }, ...children);
}

function columns(...children) {
  return node('div', { className: 'sj-popup-stack' }, ...children);
}

function board(colors) {
  const preview = node('div', { className: 'sj-popup-preview' });
  preview.setAttribute('role', 'img');
  preview.setAttribute('aria-label', 'Lưới level minh họa');
  const palette = ['#d97f47', '#ebbe68', '#a8b76f', '#5d9baf'];
  for (const color of colors) {
    const cell = node('span');
    if (color !== '0') cell.style.setProperty('--sj-cell', palette[Number(color) - 1]);
    preview.append(cell);
  }
  return preview;
}

function tabbed(tabs) {
  const nav = node('nav', { className: 'sj-popup-tabs' });
  nav.setAttribute('aria-label', 'Nội dung popup');
  const panel = node('div');
  const show = index => {
    [...nav.children].forEach((button, i) => {
      button.classList.toggle('active', i === index);
      button.setAttribute('aria-pressed', String(i === index));
    });
    panel.replaceChildren(tabs[index][1]());
  };
  nav.append(...tabs.map(([name], index) => button(name, () => show(index))));
  show(0);
  return columns(nav, panel);
}

function playHistory() {
  return tabbed([
    ['Lượt chơi', () => table(['Người chơi', 'Kết quả', 'Thời gian', 'Bản'], [
      ['An', badge('Thắng', 'ok'), '48 giây', 'r8'],
      ['Minh', badge('Hết giờ', 'warn'), '75 giây', 'r7'],
    ])],
    ['Phân tích', () => pair(card('2 lượt', paragraph('1 lượt hoàn thành')), card('48 giây', paragraph('Thời gian hoàn thành ngắn nhất')))],
    ['Phát lại', () => card('Lượt chơi của An', paragraph('r8 · Thắng · 48 giây'), board('0121012340234301232010101'))],
  ]);
}

function comparison(before, after) {
  return columns(
    pair(card(before, board('0121012340234301232010101')), card(after, board('0131012340233401232010101'))),
    table(['Thông số', before, after], [['Thời gian', '75 giây', '65 giây'], ['Số khối', '23', '25'], ['Số màu', '4', '4']], [0, 1]),
  );
}

function progress({ name = 'Tiến độ chụp ảnh', current = 8, total = 12, unit = 'ảnh', step = 1 } = {}) {
  const meter = node('progress', { max: total, value: current });
  meter.setAttribute('aria-label', name);
  const count = node('span', { className: 'muted' }, `${current} / ${total} ${unit}`);
  return node('div', { className: 'sj-popup-progress' }, meter, count, button('Chạy bước tiếp theo', event => {
    meter.value += step;
    count.textContent = `${meter.value} / ${meter.max} ${unit}`;
    event.currentTarget.disabled = meter.value === meter.max;
  }));
}

function share() {
  return columns(
    form(label('Bản level', select('Bản đã lưu r8', 'Bản đang mở')),
      label('Hạn (ngày)', input({ type: 'number', min: '1', max: '90', value: '14' }))),
    paragraph('Tạo link để xem mã QR và chép đường dẫn chơi trên điện thoại.', 'muted'),
    table(['Bản', 'Thời hạn', 'Lượt mở'], [['r8', '14 ngày', '3']]),
  );
}

async function shareLink(popup) {
  const content = popup.querySelector('.sj-popup-content');
  let result = content.querySelector('.sj-example-share-link');
  if (!result) {
    const url = 'https://example.test/p/level-12';
    const link = input({ type: 'text', readOnly: true, value: url });
    const qr = node('img', { className: 'qr', alt: 'Mã QR cho link minh họa', src: await qrImage(url) });
    result = node('div', { className: 'share-out sj-example-share-link' }, qr,
      columns(label('Link minh họa', link), button('Chọn link', () => { link.focus(); link.select(); })));
    content.append(result);
  }
  result.querySelector('input').focus();
  return false;
}

export const popupExamples = [
  example('new-pack', 'Tạo bộ xếp level', 'form', () => form(
    label('Tên bộ', input({ value: 'Bộ thử nghiệm' })),
    label('Nền tảng', select('Cả hai', 'Android', 'iOS')),
    label('Bắt đầu từ', select('Bộ trống', 'Thứ tự đang ship', 'Nhân bản bộ khác')),
    label('Ghi chú', node('textarea', { rows: 2, placeholder: 'Mục đích hoặc giả thuyết thử nghiệm' })),
  ), [cancel, primary('Tạo bộ')]),
  example('pack-settings', 'Thuộc tính và nhóm bộ', 'form', () => columns(
    form(label('Nhóm bộ', select('Đang thử nghiệm', 'Đang phát hành', 'Không nhóm')),
      label('Nền tảng', select('Cả hai', 'Android', 'iOS')),
      label('Ghi chú', node('textarea', { rows: 2, value: 'Thử thứ tự cho nhóm người chơi mới.' }))),
    table(['Đoạn', 'Từ slot', 'Đến slot'], [['FTUE', '1', '20'], ['Early', '21', '100']]),
  ), [cancel, primary('Lưu thuộc tính')]),
  example('archive-packs', 'Dọn bộ lâu không sửa', 'table', () => columns(
    form(label('Không sửa từ (ngày)', input({ type: 'number', min: '1', value: '30' })),
      label('Lý do lưu trữ', input({ placeholder: 'Ví dụ thử nghiệm đã kết thúc' }))),
    table(['Chọn', 'Bộ', 'Lần sửa cuối'], [[check('Chọn bộ A'), 'Thử thứ tự A', '45 ngày trước'],
      [check('Chọn bộ B', false), 'Thử thứ tự B', '31 ngày trước']]),
  ), [cancel, { label: 'Lưu trữ bộ đã chọn', danger: true, value: 'archive' }]),
  example('new-level', 'Level mới', 'form', () => form(
    label('Tên level', input({ name: 'name', value: 'Level 12', maxLength: 80 })),
    label('Vị trí trong bộ', input({ name: 'slot', type: 'number', min: '1', value: '12' })),
    label('Thời gian (giây)', input({ name: 'duration', type: 'number', min: '1', value: '75' })),
    label('Độ khó', select('Normal', 'Hard', 'Very Hard')),
  ), [cancel, primary('Tạo level')]),
  example('renumber', 'Đổi số level', 'form', () => form(
    label('Vị trí đích', input({ type: 'number', min: '1', value: '15' })),
    label('Cách đổi', select('Hoán đổi hai level', 'Dời và dịch các level giữa hai vị trí')),
  ), [cancel, primary('Đổi số')], 'compact'),
  example('duplicate-level', 'Nhân bản hoặc tạo Variant', 'form', () => form(
    label('Tên level mới', input({ value: 'Level 12 · Bản sao' })),
    label('Loại bản sao', select('Nhân bản độc lập', 'Variant cùng họ')),
    label('Vị trí trong bộ', input({ type: 'number', min: '1', value: '15' })),
  ), [cancel, primary('Tạo bản sao')]),
  example('add-to-pack', 'Thêm level vào bộ', 'form', () => columns(
    paragraph('Đang chọn Level 12 và Level 13.'),
    form(label('Bộ đích', select('Bộ thử nghiệm', 'Bộ nháp')), label('Vị trí', select('Cuối bộ', 'Sau slot đang chọn'))),
  ), [cancel, primary('Thêm vào bộ')]),
  example('delete', 'Xóa level', 'confirm', 'Chuyển Level 12 vào Thùng rác?', [cancel, { label: 'Xóa level', danger: true, value: true }]),
  example('conflict', 'Level đã được sửa', 'conflict', () => pair(
    card('Bản đang chỉnh', badge('Chưa lưu', 'warn'), paragraph('75 giây · 23 khối')),
    card('Bản mới nhất · r8', badge('Đã lưu', 'ok'), paragraph('65 giây · 25 khối')),
  ), [cancel, { label: 'Lưu thành bản sao', value: 'copy' }, primary('Tải bản mới', 'reload')]),
  example('import', 'Xem trước khi nhập', 'table', () => table(['Chọn', 'Tệp', 'Kết quả', 'Ghi chú'], [
    [check('Chọn Level 12'), '12.json', badge('Thêm mới', 'ok'), 'Vị trí 12'],
    [check('Chọn Level 13'), '13.json', badge('Cập nhật', 'warn'), 'Đang có r3'],
    ['—', '14.json', badge('Lỗi', 'err'), 'Thiếu thời gian'],
  ]), [cancel, primary('Nhập level đã chọn')]),
  example('unity-import', 'Nhập từ Unity', 'table', () => columns(form(
    label('Gói level Unity', input({ type: 'file', accept: '.zip' })),
    label('Cách nhập', select('Thêm cuối bộ đang mở', 'Tạo bộ mới', 'Thay cả bộ')),
  ), table(['Asset', 'Level', 'Kiểm định'], [
    ['Level_012.asset', '12', badge('Đạt', 'ok')], ['Level_013.asset', '13', badge('Cần xem lại', 'warn')],
  ])), [cancel, primary('Nhập các level đạt')]),
  example('hub-import', 'Mở bộ từ Level Hub', 'table', () => columns(
    form(label('Nhóm level', select('Bộ thử nghiệm', 'Bộ đang chạy'))),
    table(['Tệp', 'Phiên bản', 'Level'], [['Develop_12_14.zip', '1.0.2', '3'], ['Develop_15_20.zip', '1.0.1', '6']]),
  ), [cancel, primary('Mở bộ')]),
  example('hub', 'Đẩy lên Level Hub', 'table', () => columns(form(
    label('Tên bộ', input({ value: 'Bộ thử nghiệm' })), label('Từ slot', input({ type: 'number', value: '12' })),
    label('Đến slot', input({ type: 'number', value: '14' })),
  ), table(['Slot', 'Level', 'Kiểm định'], [['12', 'Level 12', badge('Đạt', 'ok')], ['13', 'Level 13', badge('Đạt', 'ok')]])),
  [cancel, { label: 'Kiểm tra', value: 'check' }, primary('Đẩy lên Level Hub')]),
  example('promote', 'Kiểm tra trước khi Promote', 'table', () => columns(
    form(label('Bộ đích', select('Production · Cả hai', 'Production · Android', 'Production · iOS'))),
    table(['Slot', 'Kiểm định', 'Thay đổi'], [['12', badge('Đạt', 'ok'), 'Cập nhật bản r8'],
      ['13', badge('Cảnh báo', 'warn'), 'Trùng cơ chế với slot 12'], ['14', badge('Lỗi', 'err'), 'Thiếu điều kiện thắng']]),
  ), [cancel, { label: 'Kiểm tra lại', value: 'check' }, { label: 'Promote', primary: true, disabled: true }]),
  example('compare', 'So sánh 2 level', 'compare', () => comparison('Level 12', 'Level 13'), [close]),
  example('compare-packs', 'So sánh hai bộ level', 'compare', () => columns(
    pair(card('Production', paragraph('100 level · r9')), card('Bộ thử nghiệm', paragraph('102 level · r14'))),
    table(['Slot', 'Production', 'Bộ thử nghiệm'], [['12', 'Level 12 · r7', 'Level 12 · r8'], ['13', 'Level 13', 'Level 13'],
      ['14', 'Level 14', 'Level 15']], [0, 2]),
  ), [close]),
  example('revision-compare', 'So sánh hai revision', 'compare', () => comparison('Bản trước · r7', 'Bản hiện tại · r8'),
    [close, primary('Khôi phục r7')]),
  example('slot-picker', 'Chọn slot trong bộ', 'table', () => columns(
    form(label('Tìm slot hoặc level', input({ type: 'search', placeholder: '12, 10–20 hoặc tên level' }))),
    table(['Slot', 'Level', 'Độ khó'], [['12', 'Level 12', badge('Normal')], ['13', 'Level 13', badge('Hard', 'warn')]]),
  ), [cancel, primary('Chọn slot 12')]),
  example('progress', 'Tiến độ chụp ảnh', 'progress', progress, [close]),
  example('builds', 'Bản game WebGL', 'table', () => table(['Phiên bản', 'Nhánh', 'Trạng thái'], [
    ['1.4.2', 'main', badge('Đang dùng', 'ok')], ['1.4.3', 'feature/demo', badge('Đang chờ', 'warn')],
    ['1.4.1', 'main', badge('Có thể quay lại')],
  ]), [close, primary('Chọn bản đang chờ')]),
  example('webgl-upload', 'Tải lên bản WebGL', 'progress', () => columns(
    form(label('Gói WebGL', input({ type: 'file', accept: '.zip' })), label('Phiên bản', input({ value: '1.4.3' }))),
    progress({ name: 'Tiến độ tải WebGL', current: 0, total: 100, unit: 'MB', step: 25 }),
  ), [close]),
  example('play-history', 'Lịch sử chơi thử', 'tabs', playHistory, [close], 'wide'),
  example('play-export', 'Xuất lượt chơi', 'form', () => form(
    label('Từ ngày', input({ type: 'date', value: '2026-11-01' })), label('Đến ngày', input({ type: 'date', value: '2026-11-11' })),
    label('Nguồn', select('Mọi nguồn', 'Web trực tiếp', 'Link / QR', 'Máy dev')),
    label('Định dạng', select('JSONL', 'CSV')), check('Kèm lượt dùng cheat', false),
  ), [cancel, primary('Xuất lượt khớp bộ lọc')]),
  example('sheet-export', 'Xuất ra Google Sheet', 'table', () => columns(
    form(label('Từ slot', input({ type: 'number', value: '12' })), label('Đến slot', input({ type: 'number', value: '13' })),
      check('Kèm hàng tiêu đề')),
    table(['Slot', 'Độ khó', 'Thời gian', 'Cơ chế'], [['12', 'Normal', '65 giây', 'Băng'], ['13', 'Hard', '75 giây', 'Xích']]),
  ), [close, { label: 'Tải CSV', value: 'csv' }, primary('Chép dữ liệu')]),
  example('play-test', 'Chơi thử level', 'drawer', () => columns(
    card('Level 12 · r8', board('0121012340234301232010101')),
    form(label('Bản chạy', select('Bản đang mở', 'Bản đã lưu r8')), check('Hiện thông tin lượt chơi')),
  ), [close, { label: 'Chơi lại', value: 'replay' }, primary('Chơi thử')]),
  example('settings', 'Cài đặt giao diện', 'form', () => form(
    label('Giao diện', select('Theo hệ thống', 'Sáng', 'Tối')),
    label('Cỡ thẻ', select('Vừa', 'Gọn', 'Lớn')), check('Hiện gợi ý phím tắt'), check('Hiện ảnh game'),
  ), [cancel, primary('Áp dụng')]),
  example('shortcuts', 'Phím tắt', 'table', () => table(['Lệnh', 'Phím', 'Gán lại'], [
    ['Tìm nhanh', node('kbd', {}, 'Ctrl K'), input({ value: 'Ctrl K', ariaLabel: 'Gán phím tìm nhanh' })],
    ['Chơi thử', node('kbd', {}, 'P'), input({ value: 'P', ariaLabel: 'Gán phím chơi thử' })],
    ['Lưu level', node('kbd', {}, 'Ctrl S'), input({ value: 'Ctrl S', ariaLabel: 'Gán phím lưu level' })],
  ]), [cancel, primary('Lưu phím tắt')]),
  example('releases', 'Có gì mới', 'tabs', () => tabbed([
    ['Mới', () => card('Mới', paragraph('Thư viện có thêm cỡ thẻ gọn.'))],
    ['Thay đổi', () => card('Thay đổi', paragraph('Ngăn chi tiết hiện ảnh xem trước ngay bên trên thông số.'))],
    ['Sửa lỗi', () => card('Sửa lỗi', paragraph('Bảng chơi thử giữ vị trí khi chuyển màn.'))],
  ]), [close]),
  example('share', 'Chơi trên điện thoại', 'share', share, [close, { label: 'Tạo link minh họa', primary: true, onClick: shareLink }]),
  example('detail', 'Chi tiết level', 'drawer', () => columns(
    board('0121012340234301232010101'), card('Level 12 · r8', badge('Đạt', 'ok'), paragraph('65 giây · 25 khối · 4 màu')),
    card('Lịch sử', paragraph('r8 · Cập nhật thời gian'), paragraph('r7 · Cập nhật bản xem trước')),
  ), [close, primary('Mở editor')]),
  example('menu', 'Menu thao tác', 'menu', null, [
    { label: 'Sửa level', value: 'edit', hint: 'E' }, { label: 'Chơi thử', value: 'play', hint: 'P' },
    { label: 'Nhân bản', value: 'duplicate' }, { label: 'Xóa level', danger: true, value: 'delete' },
  ]),
  example('brush', 'Tùy chỉnh công cụ', 'popover', () => form(
    label('Kích thước', input({ type: 'range', min: '1', max: '5', value: '2' })),
    label('Màu', input({ type: 'color', value: '#d97f47' })), check('Hiện đường viền'),
  ), [close, primary('Áp dụng')]),
  example('help', 'Cách tính độ nặng', 'popover', 'Độ nặng là một chỉ số của bộ level. Xem xu hướng theo slot trong Tổng quan bộ.', [close]),
  example('shape', 'Chọn hình khối', 'menu', null, [
    { label: 'Ô vuông', value: 'square', icon: () => sandJamIcon('inner') },
    { label: 'Thanh ngang', value: 'bar', icon: () => sandJamIcon('block') },
    { label: 'Khung rỗng', value: 'border', icon: () => sandJamIcon('border') },
  ]),
  example('effect', 'Thư viện hiệu ứng', 'menu', null, [
    { label: 'Băng', value: 'Ice', icon: () => sandJamObstacleIcon('Ice', 22) },
    { label: 'Bom', value: 'Bomb', icon: () => sandJamObstacleIcon('Bomb', 22) },
    { label: 'Xích', value: 'Chain', icon: () => sandJamObstacleIcon('Chain', 22) },
    { label: 'Van', value: 'Valve', icon: () => sandJamObstacleIcon('Valve', 22) },
  ]),
  example('radial', 'Menu vòng tròn', 'radial', null, [
    { label: 'Chọn', value: 'select', icon: () => sandJamIcon('select') }, { label: 'Vẽ', value: 'draw', icon: () => sandJamIcon('block') },
    { label: 'Tẩy', value: 'erase', icon: () => sandJamIcon('erase') }, { label: 'Màu', value: 'color', icon: () => sandJamIcon('recolor') },
    { label: 'Xoay', value: 'rotate', icon: () => sandJamIcon('rotate') },
  ]),
];
