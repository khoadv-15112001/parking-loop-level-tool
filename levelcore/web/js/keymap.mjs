// Phím tắt của vỏ app (lấy từ Sand Jam app/js/keymap.mjs): mỗi lệnh đổi được phím, lưu trên trình duyệt; nút chuột bên
// hông (Mouse4 / Mouse5) gán được như phím. Giao diện riêng của game import module này và thêm lệnh bằng addActions.
import { $, esc, openDialog } from './ui.mjs';

export const SCOPES = [['global', 'Chung'], ['level', 'Level đang mở']];
const ACTIONS = [
  { id: 'global.search', scope: 'global', label: 'Tìm level', keys: ['/'] },
  { id: 'global.newLevel', scope: 'global', label: 'Level mới', keys: ['n'] },
  { id: 'global.overview', scope: 'global', label: 'Tổng quan bộ', keys: ['o'] },
  { id: 'global.reorder', scope: 'global', label: 'Xếp thứ tự bộ', keys: ['shift+r'] },
  { id: 'global.theme', scope: 'global', label: 'Đổi giao diện sáng / tối', keys: ['t'] },
  { id: 'global.focus', scope: 'global', label: 'Chế độ tập trung (ẩn danh sách level)', keys: ['\\'] },
  { id: 'global.shortcuts', scope: 'global', label: 'Bảng phím tắt', keys: ['?'] },
  { id: 'level.save', scope: 'level', label: 'Lưu', keys: ['ctrl+s'] },
  { id: 'level.edit', scope: 'level', label: 'Sửa / Xong', keys: ['e'] },
  { id: 'level.play', scope: 'level', label: 'Chơi thử', keys: ['p'] },
  { id: 'level.share', scope: 'level', label: 'Link chơi trên điện thoại', keys: ['shift+p'] },
  { id: 'level.prev', scope: 'level', label: 'Level trước', keys: ['alt+arrowleft', 'pageup'] },
  { id: 'level.next', scope: 'level', label: 'Level sau', keys: ['alt+arrowright', 'pagedown'] },
  { id: 'level.tabOverview', scope: 'level', label: 'Tab Tổng quan', keys: ['1'] },
  { id: 'level.tabJson', scope: 'level', label: 'Tab JSON', keys: ['2'] },
  { id: 'level.tabHistory', scope: 'level', label: 'Tab Lịch sử', keys: ['3'] },
];
const MODIFIERS = new Set(['control', 'shift', 'alt', 'meta']);
const SIDE_BUTTONS = { 3: 'Mouse4', 4: 'Mouse5' };
const LABELS = {
  ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: 'Enter',
  delete: 'Del', backspace: '⌫', escape: 'Esc', space: 'Space', pageup: 'PgUp', pagedown: 'PgDn', tab: 'Tab', mouse4: 'Mouse4', mouse5: 'Mouse5',
};

let storageKey = 'leveltool.keymap';
let overrides = {};

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function save() {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(storageKey, JSON.stringify(overrides));
    else localStorage.removeItem(storageKey);
  } catch { /* trình duyệt chặn lưu trữ: phím đổi chỉ giữ tới khi tải lại trang */ }
}

/** Gọi một lần lúc khởi động: khoá lưu theo tool; scopes / actions: lệnh thêm của game. */
export function configureKeymap({ storagePrefix, scopes = [], actions = [] } = {}) {
  if (storagePrefix) storageKey = `${storagePrefix}.keymap`;
  for (const s of scopes) if (!SCOPES.some(([id]) => id === s[0])) SCOPES.push(s);
  addActions(actions);
  overrides = load();
}

export function addActions(list) {
  for (const a of list) if (!ACTIONS.some(x => x.id === a.id)) ACTIONS.push({ ...a, keys: [...(a.keys || [])] });
}

// Shift đã nằm trong ký tự in được ("?" là Shift+/ trên đa số bàn phím) nên chỉ giữ Shift cho chữ, số và phím có tên.
export function comboFromEvent(e) {
  const key = e.key === ' ' ? 'space' : String(e.key).toLowerCase();
  if (MODIFIERS.has(key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (e.shiftKey && !symbol) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

export const keysOf = id => overrides[id] ?? ACTIONS.find(a => a.id === id)?.keys ?? [];

/** Lệnh ứng với phím vừa bấm (bỏ qua khi đang gõ chữ, trừ tổ hợp có Ctrl). */
export function actionFor(e) {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const typing = e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  if (typing && !combo.startsWith('ctrl+')) return null;
  return ACTIONS.find(a => keysOf(a.id).includes(combo))?.id ?? null;
}

export function conflictsWith(id, combo) {
  return ACTIONS.filter(a => a.id !== id && keysOf(a.id).includes(combo));
}

export function setKeys(id, keys) {
  const defaults = ACTIONS.find(a => a.id === id)?.keys ?? [];
  if (keys.length === defaults.length && keys.every((k, i) => k === defaults[i])) delete overrides[id];
  else overrides[id] = keys;
  save();
}

export function resetKeys(id = null) {
  if (id) delete overrides[id];
  else overrides = {};
  save();
}

export const comboLabel = combo => combo.split('+').map(p => LABELS[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+');
export const shortLabel = id => (keysOf(id)[0] ? comboLabel(keysOf(id)[0]) : '');

/** Nút chuột bên hông (Back / Forward) thành phím Mouse4 / Mouse5; nút đã gán không còn lùi / tiến trang. */
export function bridgeMouseButtons() {
  const pressed = new Map();
  const send = (type, e) => {
    const ev = new KeyboardEvent(type, { key: SIDE_BUTTONS[e.button], ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
    (e.target instanceof Element ? e.target : document.body).dispatchEvent(ev);
    return ev;
  };
  const swallow = e => {
    if (!pressed.get(e.button)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  addEventListener('pointerdown', e => {
    if (!SIDE_BUTTONS[e.button]) return;
    const ev = send('keydown', e);
    pressed.set(e.button, ev.defaultPrevented || ACTIONS.some(a => keysOf(a.id).includes(comboFromEvent(ev))));
    swallow(e);
  }, true);
  addEventListener('pointerup', e => {
    if (!SIDE_BUTTONS[e.button] || !pressed.has(e.button)) return;
    send('keyup', e);
    swallow(e);
  }, true);
  for (const type of ['mousedown', 'mouseup', 'auxclick']) addEventListener(type, swallow, true);
}

/** Bảng phím tắt: xem, đổi (bấm Đổi rồi bấm phím mới, Esc huỷ, ⌫ bỏ phím), đặt lại. */
export function openShortcuts() {
  const render = dlg => {
    $('.km', dlg).innerHTML = SCOPES.map(([scope, title]) => {
      const rows = ACTIONS.filter(a => a.scope === scope);
      if (!rows.length) return '';
      return `<tr><th colspan="3">${esc(title)}</th></tr>${rows.map(a => `<tr data-id="${esc(a.id)}"><td>${esc(a.label)}</td>
        <td>${keysOf(a.id).map(k => `<kbd>${esc(comboLabel(k))}</kbd>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td><button data-act="set">Đổi</button>${a.id in overrides ? ' <button data-act="reset" title="Về phím mặc định">↺</button>' : ''}</td></tr>`).join('')}`;
    }).join('');
  };
  return openDialog({
    title: 'Phím tắt',
    html: '<p class="muted small">Bấm Đổi rồi bấm phím mới (cả nút chuột bên hông). Esc huỷ, ⌫ bỏ phím. Lưu trên trình duyệt này.</p><table class="km"></table><p id="km-msg" class="small"></p>',
    actions: [{ label: 'Đặt lại hết', onClick: dlg => { resetKeys(); render(dlg); return false; } }, { label: 'Đóng', value: null }],
    onOpen: dlg => {
      render(dlg);
      dlg.addEventListener('click', e => {
        const b = e.target.closest('button[data-act]');
        const id = b?.closest('tr')?.dataset.id;
        if (!id) return;
        if (b.dataset.act === 'reset') {
          resetKeys(id);
          return render(dlg);
        }
        b.textContent = 'Bấm phím…';
        const onKey = ev => {
          if (MODIFIERS.has(String(ev.key).toLowerCase())) return;
          ev.preventDefault();
          ev.stopPropagation();
          removeEventListener('keydown', onKey, true);
          if (ev.key === 'Escape') return render(dlg);
          const combo = ev.key === 'Backspace' ? null : comboFromEvent(ev);
          setKeys(id, combo ? [combo] : []);
          const clash = combo ? conflictsWith(id, combo) : [];
          $('#km-msg', dlg).textContent = clash.length ? `${comboLabel(combo)} cũng đang dùng cho: ${clash.map(a => a.label).join(', ')}` : '';
          $('#km-msg', dlg).className = `small ${clash.length ? 'warn' : ''}`;
          render(dlg);
        };
        addEventListener('keydown', onKey, true);
      });
    },
  });
}
