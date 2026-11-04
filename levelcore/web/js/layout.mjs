// Bố cục GD tự chỉnh, lưu trên trình duyệt của từng người: độ rộng cột (kéo mép cột, bấm đúp mép để về mặc định), ẩn /
// hiện danh sách level, cột thông số (trái / phải / ẩn), cột thông tin của game, khung game (khi game có editor riêng: tab
// Chơi thử hoặc cột bên phải), dòng gợi ý phím. Game đặt mặc định bằng `layout` trong ui.mjs hoặc manifest.
import { $$, openDialog } from './ui.mjs';

const CORE_DEFAULTS = {
  list: true, form: 'left', info: true, game: 'tab', hints: true,
  listW: 270, formW: 320, infoW: 260, gameW: 420, detailW: 320,
};
const LIMITS = { listW: [180, 560], formW: [220, 640], infoW: [180, 520], gameW: [260, 900], detailW: [240, 640] };
const VARS = { listW: '--lc-list-w', formW: '--lc-form-w', infoW: '--lc-info-w', gameW: '--lc-game-w', detailW: '--lc-detail-w' };

let key = 'leveltool.layout';
let defaults = { ...CORE_DEFAULTS };
let prefs = { ...defaults };
const listeners = [];

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function save() {
  const own = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => v !== defaults[k]));
  try {
    if (Object.keys(own).length) localStorage.setItem(key, JSON.stringify(own));
    else localStorage.removeItem(key);
  } catch { /* trình duyệt chặn lưu trữ: bố cục chỉ giữ tới khi tải lại trang */ }
}

/** Gọi một lần lúc khởi động. gameDefaults: `layout` của game (ui.mjs / manifest). */
export function configureLayout({ storagePrefix, gameDefaults = {} } = {}) {
  if (storagePrefix) key = `${storagePrefix}.layout`;
  defaults = { ...CORE_DEFAULTS, ...gameDefaults };
  prefs = { ...defaults, ...load() };
  apply();
}

export const layout = () => prefs;
export const onLayout = fn => listeners.push(fn);

export function setLayout(patch, { persist = true } = {}) {
  for (const [k, v] of Object.entries(patch)) prefs[k] = LIMITS[k] ? clamp(k, v) : v;
  if (persist) save();
  apply();
}

export function resetLayout() {
  prefs = { ...defaults };
  save();
  apply();
}

const clamp = (k, v) => Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Number(v) || defaults[k])));

function apply() {
  const root = document.documentElement.style;
  for (const [k, name] of Object.entries(VARS)) root.setProperty(name, `${prefs[k]}px`);
  document.body?.classList.toggle('no-list', !prefs.list);
  document.body?.classList.toggle('no-hints', !prefs.hints);
  for (const fn of listeners) fn(prefs);
}

/**
 * Kéo mép cột để đổi độ rộng: `.grip[data-pref]` trong root. data-edge="left" (cột nằm bên phải phần chính, kéo sang trái
 * là rộng ra) hoặc "right". Bấm đúp mép: về độ rộng mặc định.
 */
export function wireGrips(root = document) {
  for (const el of $$('.grip[data-pref]', root)) {
    if (el.dataset.wired) continue;
    el.dataset.wired = '1';
    el.title = 'Kéo để đổi độ rộng, bấm đúp để về mặc định';
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pref = el.dataset.pref, dir = el.dataset.edge === 'left' ? -1 : 1, x0 = e.clientX, w0 = prefs[pref];
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      const move = ev => setLayout({ [pref]: w0 + dir * (ev.clientX - x0) }, { persist: false });
      const up = () => {
        el.removeEventListener('pointermove', move);
        document.body.classList.remove('resizing');
        save();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
      el.addEventListener('pointercancel', up, { once: true });
    });
    el.addEventListener('dblclick', () => setLayout({ [el.dataset.pref]: defaults[el.dataset.pref] }));
  }
}

const radio = (name, value, options) => options.map(([v, label]) =>
  `<label class="check"><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}> ${label}</label>`).join('');
const check = (name, on, label) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;

/** Hộp Bố cục: đổi là thấy ngay. hasEditor: game có editor riêng (mới có lựa chọn chỗ đặt khung game). */
export function openLayout({ hasEditor = false } = {}) {
  const p = prefs;
  return openDialog({
    title: 'Bố cục màn Level',
    html: `<p class="muted small">Chỉ đổi trên trình duyệt này của bạn. Độ rộng cột: kéo mép cột, bấm đúp mép để về mặc định.</p>
      <div class="layout-form">
        <fieldset><legend>Danh sách level</legend>${check('list', p.list, 'Hiện (tắt = chế độ tập trung, phím \\)')}</fieldset>
        <fieldset><legend>Cột thông số và kiểm định</legend>${radio('form', p.form, [['left', 'Bên trái'], ['right', 'Bên phải'], ['hide', 'Ẩn']])}</fieldset>
        ${hasEditor ? `<fieldset><legend>Khung game</legend>${radio('game', p.game, [['tab', 'Tab Chơi thử riêng (editor rộng nhất)'], ['right', 'Cột bên phải, cạnh editor']])}</fieldset>` : ''}
        <fieldset><legend>Khác</legend>${check('info', p.info, 'Cột thông tin của game (khi game có)')}${check('hints', p.hints, 'Dòng gợi ý phím ở đáy')}</fieldset>
      </div>`,
    actions: [{
      label: 'Đặt lại bố cục', onClick: dlg => {
        resetLayout();
        for (const el of $$('input', dlg)) el.checked = el.type === 'checkbox' ? !!prefs[el.name] : prefs[el.name] === el.value;
        return false;
      },
    }, { label: 'Xong', primary: true, value: true }],
    onOpen: dlg => dlg.addEventListener('change', e => {
      const t = e.target;
      setLayout({ [t.name]: t.type === 'checkbox' ? t.checked : t.value });
    }),
  });
}
