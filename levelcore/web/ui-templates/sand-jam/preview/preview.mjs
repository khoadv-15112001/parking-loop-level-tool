import { createSandJamLayout } from '../layouts.mjs';
import { sandJamIcon, sandJamObstacleIcon } from '../icons.mjs';
import { openSandJamPopup } from '../popups.mjs';
import { popupExamples } from '../popup-examples.mjs';
import { lineChart } from '/core/js/overview.mjs';
import { openPalette } from '/core/js/palette.mjs';
import { toast } from '/core/js/ui.mjs';

const scenes = {
  library: 'Kho level', collections: 'Danh sách bộ', sequence: 'Bộ xếp level', editor: 'Sửa level',
  overview: 'Tổng quan bộ', activity: 'Hoạt động', playtest: 'Chơi thử', admin: 'Quản trị',
  trash: 'Thùng rác', phone: 'Chơi trên điện thoại', login: 'Đăng nhập', components: 'Thành phần và popup',
};
const difficulty = ['Normal', 'Hard', 'VeryHard'];
const difficultyTypes = ['normal', 'hard', 'very-hard'];
const colors = ['#4c9f66', '#d7862a', '#cf5653', '#6a85c7', '#c77a9d', '#ac9344'];
const weights = [13, 18, 21, 16, 37, 28, 34, 25, 53, 39, 46, 60, 42, 54, 45, 69, 60, 76];
const levels = weights.map((weight, i) => ({ n: i + 1, weight, type: i % 9 === 8 ? 2 : i % 4 === 0 && i ? 1 : 0 }));
let selected = levels[4];

function node(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value != null) el.setAttribute(name, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null) el.append(child);
  }
  return el;
}

function button(label, onClick, className = '', attrs = {}) {
  const el = node('button', { type: 'button', class: `sj-button ${className}`, ...attrs }, label);
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

const row = (...children) => node('div', { class: 'sj-preview-row' }, children);
const flow = (...children) => node('div', { class: 'sj-preview-flow' }, children);
const label = text => node('span', { class: 'muted small' }, text);
const title = text => node('h2', { class: 'sj-preview-title' }, text);
const badge = (text, tone = null) => node('span', { class: 'sj-badge', 'data-tone': tone }, text);
const difficultyBadge = lv => node('span', { class: 'sj-difficulty', 'data-difficulty': difficultyTypes[lv.type] }, difficulty[lv.type]);
const panel = (name, ...children) => node('section', { class: 'sj-panel' },
  node('header', { class: 'sj-panel-head' }, title(name)), node('div', { class: 'sj-panel-body sj-preview-flow' }, children));
const note = (text, variant = '') => node('div', { class: `notice ${variant}` }, text);

function select(choices, onChange, active = choices[0]) {
  const el = node('select', { class: 'sj-input' }, choices.map(value => node('option', { value }, value)));
  el.value = active;
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}

function field(name, control) {
  control.classList.add('sj-input');
  return node('label', { class: 'sj-field' }, name, control);
}

function search(name, onInput) {
  const el = node('input', { type: 'search', placeholder: name, 'aria-label': name, class: 'sj-input' });
  if (onInput) el.addEventListener('input', () => onInput(el.value.trim().toLowerCase()));
  return el;
}

function choiceGroup(labels, onChange, selectedIndex = 0, className = 'sj-segmented') {
  const group = node('div', { class: className, role: 'group' });
  labels.forEach((name, i) => group.append(button(name, e => {
    for (const item of group.children) item.setAttribute('aria-pressed', String(item === e.currentTarget));
    onChange(i);
  }, '', { 'aria-pressed': String(i === selectedIndex) })));
  return group;
}

function checkbox(text, onChange, value = false) {
  const input = node('input', { type: 'checkbox' });
  input.checked = value;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return node('label', { class: 'sj-check' }, input, text);
}

function showPopup(id, anchor) {
  const example = popupExamples.find(item => item.id === id);
  if (!example) return;
  openSandJamPopup(example.kind, { ...example.options, anchor }).then(value => {
    if (value != null) toast('Đã chọn thao tác mẫu', 'ok');
  }).catch(error => toast(error.message, 'err'));
}

const popup = (id, text, className = '') => button(text, e => showPopup(id, e.currentTarget), className);
const go = (text, kind) => node('a', { href: `#${kind}`, class: 'sj-button' }, text);
const simulated = text => () => toast(`${text} · Dữ liệu minh hoạ`, 'ok');

function table(columns, rows) {
  return node('div', { class: 'sj-table-wrap' }, node('table', { class: 'sj-table' },
    node('thead', null, node('tr', null, columns.map(value => node('th', { scope: 'col' }, value)))),
    node('tbody', null, rows.map(values => node('tr', null, values.map(value => node('td', null, value)))))));
}

function board(lv, className = '') {
  const grid = node('span', { class: `sj-preview-board ${className}`, 'aria-hidden': 'true' });
  for (let i = 0; i < 49; i++) {
    const x = i % 7;
    const y = Math.floor(i / 7);
    const tile = node('span');
    if ((x * y + lv.n + y) % 5 > 1 && x > 0 && x < 6) {
      tile.dataset.tile = '';
      tile.style.setProperty('--sample-tile', colors[(Math.floor(x / 2) + Math.floor(y / 2) + lv.n) % colors.length]);
    }
    grid.append(tile);
  }
  return grid;
}

function strip() {
  const wrap = node('div', { class: 'sj-chart sj-preview-strip', 'data-size': 'strip', role: 'img', 'aria-label': 'Dải độ nặng theo thứ tự level' });
  const data = levels;
  for (const lv of data) {
    const bar = node('span', { title: `#${lv.n} · ${lv.weight}` });
    bar.style.setProperty('--sample-height', `${lv.weight}%`);
    bar.style.setProperty('--sample-color', colors[lv.type]);
    if (lv === selected) bar.dataset.focus = '';
    wrap.append(bar);
  }
  return wrap;
}

function curve(data = levels) {
  const wrap = node('div', { class: 'sj-chart sj-preview-curve', role: 'img', 'aria-label': 'Đường độ nặng theo thứ tự level' });
  wrap.innerHTML = lineChart([{ label: 'Độ nặng', points: data.map(lv => [lv.n, lv.weight]), groups: data.map(lv => difficulty[lv.type]) }], {
    height: 150, width: 580, groupColor: group => colors[difficulty.indexOf(group)],
  });
  return wrap;
}

function stats(values) {
  return node('dl', { class: 'sj-metrics' }, Object.entries(values).map(([key, value]) =>
    node('div', { class: 'sj-metric' }, node('dt', null, key), node('dd', null, String(value)))));
}

function detail(lv) {
  return flow(row(title(`Level ${lv.n}`), difficultyBadge(lv)),
    board(lv), row(go('Sửa', 'editor'), go('▶ Chơi', 'playtest'), popup('share', 'Link điện thoại'), popup('compare', 'So sánh')),
    stats({ Giây: 90, 'Độ nặng': lv.weight, 'Màu': 5 }),
    row(node('span', { class: 'sj-badge' }, sandJamObstacleIcon('Ice'), 'Ice'),
      node('span', { class: 'sj-badge' }, sandJamObstacleIcon('Generator'), 'Generator')),
    panel('Kiểm tra', badge('Hợp lệ', 'ok'), label('r3 · Nguyễn An · 09:40')),
    panel('Lượt chơi thử', row(badge('Thắng', 'ok'), label('01:16'), popup('play-history', 'Xem tất cả'))),
    panel('Lịch sử', row(label('r3 · Điều chỉnh thời gian'), popup('compare', 'So với r2'))));
}

function library(slots) {
  const result = node('div', { class: 'sj-card-grid', 'data-size': 'm' });
  const count = node('span', { class: 'muted sj-preview-count', 'aria-live': 'polite' });
  const types = new Set();
  const picked = new Set();
  let query = '';
  let sortBy = 'Theo thứ tự';
  const filters = difficulty.map((name, i) => {
    const input = node('input', { type: 'checkbox' });
    input.addEventListener('change', () => {
      if (input.checked) types.add(i);
      else types.delete(i);
      render();
    });
    return node('label', { class: 'sj-filter-option' }, input, name,
      node('span', { class: 'sj-filter-count' }, String(levels.filter(lv => lv.type === i).length)));
  });
  const render = () => {
    const shown = levels.filter(lv => (!types.size || types.has(lv.type)) && (!query || String(lv.n).includes(query)));
    if (sortBy === 'Độ nặng') shown.sort((a, b) => b.weight - a.weight);
    count.textContent = `${shown.length} / ${levels.length} level`;
    const tiles = shown.map(lv => button([board(lv), node('span', { class: 'sj-card-title' }, `#${lv.n}`, difficultyBadge(lv)),
      node('span', { class: 'sj-card-meta' }, `${lv.weight} độ nặng · 90 giây`)], e => {
      selected = lv;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (picked.has(lv)) picked.delete(lv);
        else picked.add(lv);
      }
      render();
      result.querySelector(`[data-level="${lv.n}"]`)?.focus();
    }, '', { class: 'sj-card', 'aria-pressed': String(lv === selected || picked.has(lv)), 'data-level': lv.n }));
    result.replaceChildren(...(tiles.length ? tiles : [node('div', { class: 'sj-empty' }, 'Không có level nào khớp bộ lọc.')]));
    slots.detail.replaceChildren(detail(selected));
    slots.selection.replaceChildren(...(picked.size ? [row(badge(`Đã chọn ${picked.size}`), popup('compare', 'So sánh'),
      popup('hub', 'Thêm vào bộ'), button('Bỏ chọn', () => { picked.clear(); render(); }))] : []));
  };
  const checks = node('fieldset', { class: 'sj-filter-group' }, node('legend', null, 'Độ khó'), filters);
  slots.filters.append(panel('Bộ lọc', checks, button('Đặt lại', () => {
    types.clear();
    for (const input of checks.querySelectorAll('input')) input.checked = false;
    render();
  })));
  slots.toolbar.append(row(title('Kho level'), search('Tìm theo số level', value => { query = value; render(); }), count,
    field('Sắp xếp', select(['Theo thứ tự', 'Độ nặng'], value => { sortBy = value; render(); })),
    choiceGroup(['S', 'M', 'L'], i => { result.dataset.size = ['s', 'm', 'l'][i]; }, 1), popup('import', '⇅ File'), popup('new-level', '＋ Level mới', 'primary')));
  slots.results.append(result);
  render();
}

function collections(slots) {
  slots.toolbar.append(row(title('Bộ xếp level'), popup('unity-import', 'Nhập từ Unity'), popup('hub-import', 'Nhập từ Level Hub'),
    button('＋ Bộ mới', event => openSandJamPopup('form', { title: 'Tạo bộ xếp level', anchor: event.currentTarget,
      content: flow(field('Tên bộ', node('input', { type: 'text' })), field('Nền tảng', select(['Cả hai', 'Android', 'iOS']))),
      actions: [{ label: 'Huỷ' }, { label: 'Tạo bộ', primary: true, value: true }],
    }).then(value => { if (value) toast('Đã chọn tạo bộ mẫu', 'ok'); }).catch(error => toast(error.message, 'err')), 'primary')));
  for (const [name, items] of Object.entries({ 'Trong game': ['Android · Production', 'iOS · Production'], 'Bộ nháp': ['Đường cong chính', 'Thử độ khó', 'Onboarding'] })) {
    slots.groups.append(panel(name, node('div', { class: 'sj-preview-groups' }, items.map(item => panel(item,
      row(badge(name === 'Trong game' ? 'Chỉ đọc' : 'Nháp'), label('18 level · r5')), strip(), row(go('Mở bộ', 'sequence'), popup('menu', '⋯')))))));
  }
}

function sequence(slots) {
  const tabs = ['Đường cong', 'Live', 'Cơ chế', 'Kiểm tra', 'Giải', 'Đoạn', '＋ Level', 'Lịch sử'];
  const bodies = [() => flow(curve(), label('Độ nặng theo slot · Chọn một dòng để xem chi tiết.')),
    () => stats({ 'Thắng lần đầu': '74%', 'Rơi rụng': '8%', 'Đủ mẫu': '16/18' }),
    () => table(['Cơ chế', 'Slot đầu', 'Lịch'], [['Ice', '5', '4'], ['Gate', '12', '10']]),
    () => flow(note('Xem lại bước tăng độ nặng tại slot 9.', 'warn'), badge('0 lỗi chặn', 'ok')),
    () => flow(stats({ 'Đã giải': 15, 'Cần giải': 3 }), popup('progress', 'Giải cả bộ')),
    () => table(['Đoạn', 'Từ', 'Đến'], [['FTUE', '1', '5'], ['Early', '6', '18']]),
    () => row(popup('new-level', 'Tạo level'), popup('import', 'Nhập file')),
    () => table(['Lúc', 'Người', 'Thao tác'], [['09:40', 'Nguyễn An', 'Dời slot 5'], ['08:51', 'Linh Trần', 'Ghim revision']])];
  const update = () => {
    slots.navigator.replaceChildren(strip());
    slots.selected.replaceChildren(node('div', { class: 'sj-preview-slot' }, board(selected), flow(
      row(title(`Slot ${selected.n}`), difficultyBadge(selected)), stats({ Giây: 90, 'Độ nặng': selected.weight }),
      row(go('Sửa', 'editor'), go('▶ Chơi', 'playtest'), popup('detail', 'Chi tiết')))));
    slots.selection.replaceChildren(row(badge(`Slot ${selected.n}`, 'ok'), go('Sửa', 'editor'), go('▶ Chơi', 'playtest'), popup('renumber', 'Dời tới…'), popup('menu', '⋯')));
  };
  slots.toolbar.append(row(title('Bộ xếp level'), field('Bộ đang mở', select(['Đường cong chính', 'Thử độ khó'])), badge('Android'), badge('r5'),
    popup('compare', 'So sánh'), popup('hub', '⇧ Level Hub', 'primary'), popup('menu', '⋯')));
  slots.table.append(table(['Slot', 'Ảnh', 'Tên', 'Độ khó', 'Độ nặng', 'Giây'], levels.map(lv => [button(`#${lv.n}`, () => { selected = lv; update(); }),
    board(lv, 'is-small'), `Level ${lv.n}`, difficultyBadge(lv), String(lv.weight), '90'])));
  slots.tabs.append(choiceGroup(tabs, i => slots.analysis.replaceChildren(bodies[i]()), 0, 'sj-segmented sj-preview-tabs'));
  slots.analysis.append(bodies[0]());
  update();
}

function playStage(lv) {
  return node('div', { class: 'sj-preview-stage' }, node('div', { class: 'sj-preview-portrait' },
    row(node('b', null, `Level ${lv.n}`), label('01:30')), board(lv), row(badge('Bản chơi minh hoạ'))));
}

function editor(slots, root) {
  const stage = node('div', { class: 'sj-stage sj-preview-editor-stage' });
  const levelsBox = node('div', { class: 'sj-list' });
  const tabs = ['Thuộc tính', 'Level', 'Kiểm tra', 'Lịch sử'];
  const tools = { select: 'Chọn', block: 'Block', recolor: 'Tô màu', effect: 'Effect', gate: 'Gate', inner: 'Sàn', border: 'Tường',
    empty: 'Trống', obstacle: 'Đá', ext: 'Extend', generator: 'Generator', interact: 'Vật thể', erase: 'Xoá', lift: 'Lift' };
  const state = label('Chọn');
  const rail = node('div', { class: 'sj-tool-rail', role: 'group', 'aria-label': 'Công cụ sửa level' });
  let tab = 0;
  const sections = [() => panel('Block đang chọn', swatches(), row(popup('shape', 'Chọn hình'), popup('effect', 'Effect…'),
    button('Xoay', simulated('Xoay block')), button('Xoá', simulated('Xoá block'), 'danger'))),
    () => panel('Thông số level', field('Thời gian', node('input', { type: 'number', value: '90', min: 1 })), field('Độ khó', select(difficulty, null, difficulty[selected.type])),
      field('Kích thước', select(['7 × 7', '8 × 8', '9 × 9'])), popup('menu', 'Tuỳ chọn layer')),
    () => panel('Kiểm tra', row(badge('Hợp lệ', 'ok'), badge('1 cảnh báo', 'warn')), label('Màu cam còn 2 ô chưa ghép.'), popup('progress', 'Giải lại')),
    () => panel('Lịch sử', row(badge('r3'), label('Điều chỉnh thời gian')), row(badge('r2'), label('Thêm cổng')), popup('revision-compare', 'So sánh revision'))];
  const update = () => {
    const map = board(selected, 'is-large');
    stage.replaceChildren(map);
    slots.metrics.replaceChildren(stats({ 'Độ nặng': selected.weight, Giây: 90, Ô: 32, Màu: 5 }));
    slots.inspector.replaceChildren(sections[tab]());
    slots.playtest.replaceChildren(playStage(selected));
    for (const item of levelsBox.children) item.setAttribute('aria-pressed', String(item.dataset.level === String(selected.n)));
  };
  slots.toolbar.append(row(title('Sửa level'), badge('Bộ Đường cong chính'), button('↶', simulated('Hoàn tác'), '', { 'aria-label': 'Hoàn tác' }),
    button('↷', simulated('Làm lại'), '', { 'aria-label': 'Làm lại' }), go('▶ Chơi bản nháp', 'playtest'), popup('conflict', 'Lưu', 'primary'),
    field('Thanh công cụ', select(['Bên trái', 'Bên dưới'], value => {
      const position = value === 'Bên dưới' ? 'bottom' : 'left';
      root.dataset.tools = position;
      rail.dataset.position = position;
    })), field('Cột thông số', select(['Bên phải', 'Bên trái'], value => { root.dataset.inspector = value === 'Bên trái' ? 'left' : 'right'; })),
    checkbox('Tập trung', value => { root.toggleAttribute('data-focus', value); })));
  levelsBox.append(...levels.map(lv => button(`#${lv.n} · ${difficulty[lv.type]}`, () => { selected = lv; update(); }, '', { class: 'sj-item', 'data-level': lv.n })));
  slots.levels.append(flow(row(title('Danh sách level'), popup('new-level', '＋ Mới')), levelsBox));
  const radial = popup('radial', 'Menu tròn');
  radial.dataset.shortcut = 'q';
  const shape = popup('shape', 'Hình');
  shape.dataset.shortcut = 'w';
  slots.stageToolbar.append(row(badge('Cân màu'), badge('Cam 12/12', 'ok'), badge('Xanh 8/10', 'warn'), state,
    popup('brush', 'Bút'), radial, shape, popup('menu', 'Menu chuột phải'), popup('slot-picker', 'Tới slot')));
  stage.addEventListener('contextmenu', event => { event.preventDefault(); showPopup('menu', stage); });
  for (const [name, text] of Object.entries(tools)) {
    rail.append(button([sandJamIcon(name), node('small', null, text)], e => {
      for (const item of rail.children) item.setAttribute('aria-pressed', String(item === e.currentTarget));
      state.textContent = text;
    }, '', { class: 'sj-tool', title: text, 'aria-label': text, 'aria-pressed': String(name === 'select') }));
  }
  slots.tools.append(rail);
  slots.stage.append(stage);
  slots.inspectorTabs.append(choiceGroup(tabs, i => { tab = i; update(); }));
  slots.shortcuts.append(row(node('kbd', null, 'Q'), label('Menu tròn'), node('kbd', null, 'W'), label('Chọn hình'), popup('shortcuts', 'Phím tắt')));
  update();
}

function overview(slots) {
  const render = (from = 'Cả bộ') => slots.chart.replaceChildren(panel('Độ nặng theo slot', curve(from === '1–9' ? levels.slice(0, 9) : levels)));
  slots.toolbar.append(row(title('Tổng quan bộ'), field('Bộ đang mở', select(['Đường cong chính', 'Thử độ khó'])),
    field('Khoảng slot', select(['Cả bộ', '1–9'], render)), popup('compare', '＋ So sánh'), popup('help', 'Cách tính')));
  slots.metrics.append(stats({ 'Tổng level': 18, Normal: 13, Hard: 3, VeryHard: 2, 'Độ nặng TB': 42, 'Nhảy vọt': 2 }));
  slots.reports.append(panel('Cần xem lại', table(['Slot', 'Vấn đề'], [['#9', 'Độ nặng tăng 28 điểm'], ['#17–18', 'Hai level khó liên tiếp']])));
  render();
}

function activity(slots) {
  const events = [['09:40', 'Nguyễn An', 'Lưu Level 5 · r3'], ['09:12', 'Linh Trần', 'Tải bản game 1.1.0'], ['08:51', 'Nguyễn An', 'Ghim slot 5']];
  let active = 0;
  let query = '';
  let author = 'Tất cả';
  let action = 'Tất cả';
  const show = () => slots.log.replaceChildren(active === 0 ? table(['Thời gian', 'Người', 'Hoạt động'], events.filter(values =>
    values.join(' ').toLowerCase().includes(query) && (author === 'Tất cả' || values[1] === author) && (action === 'Tất cả' || values[2].startsWith(action)))) :
    table(['Level', 'Kết quả', 'Thời lượng'], [['#5', badge('Thắng', 'ok'), '01:16'], ['#9', badge('Thua', 'warn'), '01:30']]));
  slots.toolbar.append(row(title('Hoạt động'), choiceGroup(['Nhật ký', 'Lượt chơi thử'], i => { active = i; slots.filters.hidden = i === 1; show(); }),
    popup('play-history', 'Xem lượt chơi')));
  slots.services.append(node('div', { class: 'sj-preview-groups' }, panel('Đang online', row(node('span', { class: 'sj-preview-avatar' }, 'NA'), 'Nguyễn An · Sửa level')),
    panel('Bản web', badge('1.1.0', 'ok'), popup('builds', 'Quản lý bản game')), panel('Ảnh game', label('15 / 18 level có ảnh'), popup('progress', 'Chụp ảnh còn thiếu'))));
  slots.filters.append(row(search('Tìm trong nhật ký', value => { query = value; show(); }),
    field('Người', select(['Tất cả', 'Nguyễn An', 'Linh Trần'], value => { author = value; show(); })),
    field('Thao tác', select(['Tất cả', 'Lưu', 'Ghim', 'Tải'], value => { action = value; show(); }))));
  show();
}

function playtest(slots, phone = false) {
  const state = badge('Sẵn sàng', 'ok');
  const controls = row(button('↻ Chơi lại', () => { state.textContent = 'Đang chơi'; }),
    button('✓ Thắng', () => { state.textContent = 'Thắng'; }), button('✗ Thua', () => { state.textContent = 'Thua'; }), state);
  if (!phone) {
    slots.toolbar.append(row(title('Chơi thử'), badge(`Level ${selected.n}`), go('Mở bản điện thoại', 'phone'), popup('share', 'Link điện thoại')));
    slots.build.append(row(badge('1.1.0'), label('Bản WebGL minh hoạ · 09:12')));
    controls.append(popup('menu', 'Cheat'));
  } else slots.status.append(row(title('Chơi trên điện thoại'), badge(`Level ${selected.n}`), go('Về khung chơi thử', 'playtest')));
  slots.stage.append(playStage(selected));
  slots.controls.append(controls);
}

function admin(slots) {
  slots.toolbar.append(row(title('Quản trị'), button('Lưu', simulated('Đã lưu thiết lập'), 'primary')));
  slots.notice.append(note('Quyền áp dụng cho bộ hiện tại.'));
  slots.sections.append(panel('Admin và phân quyền', table(['Thao tác', 'Quyền'], [['Promote', select(['Chỉ admin', 'Mọi người'])], ['Xoá level', select(['Chỉ admin', 'Mọi người'])]])),
    panel('Thông báo chung', field('Nội dung', node('textarea', { rows: 2 }, 'Kiểm tra bộ trước khi đẩy lên Level Hub.'))),
    panel('Ngưỡng kiểm tra', field('Khoảng cách giữa 2 VeryHard', node('input', { type: 'number', value: 8, min: 1 }))),
    panel('BI Level Hub', field('Nhóm mặc định', node('input', { value: 'GD' })), popup('hub', 'Xem mẫu xuất')),
    panel('Hệ thống và dung lượng', stats({ 'Đang dùng': '420 MB', 'Bản sao': 3 }), popup('progress', 'Tạo bản sao')));
}

function trash(slots) {
  slots.toolbar.append(row(title('Thùng rác'), label('Khôi phục trước ngày xoá hẳn')));
  slots.levels.append(panel('Level đã xoá', table(['Level', 'Bộ', 'Thao tác'], [['#22', 'Đường cong chính', button('Khôi phục', simulated('Đã khôi phục level'))]])));
  slots.collections.append(panel('Bộ đã lưu trữ', table(['Bộ', 'Lý do', 'Thao tác'], [['Thử tháng trước', 'Đã chuyển sang bộ mới', popup('delete', 'Hẹn xoá hẳn', 'danger')]])));
}

function login(slots) {
  slots.brand.append(title('Sand Jam Level Tool'));
  slots.credentials.append(flow(button('Đăng nhập bằng Google', simulated('Đã chọn đăng nhập'), 'primary'),
    field('Tên dùng thử trên máy', node('input', { type: 'text', autocomplete: 'off', placeholder: 'Nguyễn An' })),
    button('Vào bản xem mẫu', () => { location.hash = 'library'; })));
  slots.help.append(label('Dùng dữ liệu minh hoạ trong bản xem mẫu.'));
}

function swatches() {
  const group = node('div', { class: 'sj-swatches', role: 'group', 'aria-label': 'Màu block' });
  const names = ['Xanh lá', 'Cam', 'Đỏ', 'Xanh lam', 'Hồng', 'Vàng'];
  colors.forEach((color, i) => {
    const swatch = button(node('span', null, String(i + 2)), e => {
      for (const item of group.children) item.setAttribute('aria-pressed', String(item === e.currentTarget));
    }, '', { class: 'sj-swatch', 'aria-label': names[i], title: names[i], 'aria-pressed': String(i === 0) });
    swatch.style.setProperty('--sj-swatch-color', color);
    group.append(swatch);
  });
  return group;
}

function components() {
  const actions = row(button('Chính', simulated('Thao tác chính'), 'primary'), button('Thường', simulated('Thao tác thường')), button('Xoá', simulated('Đã chọn xoá'), 'danger'),
    button('Đang xử lý', null, '', { disabled: '' }), badge('Hợp lệ', 'ok'), badge('Cảnh báo', 'warn'), badge('Lỗi', 'error'),
    badge('Đang khoá', 'lock'), node('kbd', null, 'Ctrl K'), node('span', { class: 'sj-preview-avatar' }, 'NA'));
  const controls = row(field('Tìm kiếm', search('Tìm level')), field('Độ khó', select(difficulty)), checkbox('Hiện ảnh'),
    choiceGroup(['S', 'M', 'L'], () => {}, 1), field('Tiến độ', node('progress', { class: 'sj-meter', max: 100, value: 62 })));
  return node('section', { class: 'sj-preview-catalog' }, panel('Điều khiển và trạng thái', actions, controls, swatches()),
    panel('Popup', node('div', { class: 'sj-preview-popup-list' }, popupExamples.map(example => popup(example.id, example.label)))),
    panel('Thẻ và bảng', row(badge('Slot 5', 'warn'), label('Mẫu đã chọn')), stats({ 'Độ nặng': 37, Giây: 90, Màu: 5 }),
      table(['Level', 'Độ khó', 'Kiểm định'], [['#5', badge('Hard', 'warn'), badge('Hợp lệ', 'ok')]]), strip()));
}

const renderers = { library, collections, sequence, editor, overview, activity, playtest: slots => playtest(slots), admin, trash,
  phone: slots => playtest(slots, true), login };
const { root, slots } = createSandJamLayout('workspace');
const frame = document.getElementById('preview');
frame.append(root);
slots.brand.append(node('h1', { class: 'sj-preview-title' }, 'Sand Jam · Mẫu giao diện'));
const links = Object.entries(scenes).map(([id, name]) => node('a', { href: `#${id}`, class: 'sj-button', 'data-scene': id }, name));
slots.nav.append(...links);
const theme = select(['Theo máy', 'Sáng', 'Tối'], value => {
  if (value === 'Theo máy') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value === 'Sáng' ? 'light' : 'dark';
});
theme.setAttribute('aria-label', 'Giao diện sáng, tối hoặc theo hệ thống');
function find() {
  openPalette({
    levels: () => levels.map(lv => ({ name: String(lv.n), level: lv.n })),
    onLevel: name => {
      selected = levels.find(lv => lv.n === Number(name));
      if (location.hash === '#editor') renderScene();
      else location.hash = 'editor';
    },
    commands: Object.entries(scenes).map(([id, text]) => ({ label: text, group: 'Màn', run: () => { location.hash = id; } })),
  });
}
slots.headerTools.append(row(button([sandJamIcon('search'), node('kbd', null, 'Ctrl K')], find, '', { 'aria-label': 'Tìm nhanh' }), theme, popup('shortcuts', 'Phím tắt')));
slots.notice.append(label('Bản xem mẫu · Dữ liệu minh hoạ'));
slots.status.append(row(badge('● Đang kết nối', 'ok'), label('18 level · 3 bộ'), label('Bản game 1.1.0'), node('span', { class: 'sj-preview-avatar', title: 'Nguyễn An' }, 'NA')));

function renderScene() {
  const id = location.hash.slice(1);
  const current = Object.hasOwn(scenes, id) ? id : 'library';
  for (const link of links) {
    link.classList.toggle('active', link.dataset.scene === current);
    if (link.dataset.scene === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (current === 'components') {
    slots.main.replaceChildren(components());
    return;
  }
  const scene = createSandJamLayout(current);
  slots.main.replaceChildren(scene.root);
  renderers[current](scene.slots, scene.root);
}

window.addEventListener('hashchange', renderScene);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || document.querySelector('dialog[open], :popover-open, .palette-backdrop')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    find();
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, select, textarea, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (key !== 'q' && key !== 'w') return;
  const trigger = slots.main.querySelector(`[data-shortcut="${key}"]`);
  if (trigger) {
    event.preventDefault();
    trigger.click();
  }
});
renderScene();
