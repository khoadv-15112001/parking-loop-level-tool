// Form thuộc tính dựng từ `game.fields` ([{path, label, type, options?, min?, max?, step?, hint?}]): number · text ·
// bool · select. Chỉ ghi đúng đường dẫn của field vừa sửa, mọi field khác của level giữ nguyên. Ô số để trống = bỏ khoá đó.
import { esc } from './ui.mjs';

export function getPath(obj, path) {
  return path.reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj);
}

export function setPath(obj, path, value) {
  let o = obj;
  for (const k of path.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof k === 'number' ? [] : {};
    o = o[k];
  }
  const last = path.at(-1);
  if (value === undefined) delete o[last];
  else o[last] = value;
}

const optionList = f => (f.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) }));

function input(f, value, id, readOnly) {
  const dis = readOnly ? ' disabled' : '';
  if (f.type === 'bool') return `<input id="${id}" type="checkbox"${value === true ? ' checked' : ''}${dis}>`;
  if (f.type === 'select') {
    const opts = optionList(f);
    const known = opts.some(o => o.value === value);
    return `<select id="${id}"${dis}>${known || value == null ? '' : `<option value="">${esc(value)} (ngoài danh sách)</option>`}`
      + `${value == null ? '<option value="" selected>—</option>' : ''}`
      + opts.map((o, i) => `<option value="${i}" ${o.value === value ? 'selected' : ''}>${esc(o.label ?? o.value)}</option>`).join('')
      + '</select>';
  }
  const num = f.type === 'number';
  const attrs = num ? ['min', 'max', 'step'].filter(k => f[k] != null).map(k => ` ${k}="${esc(f[k])}"`).join('') : '';
  return `<input id="${id}" type="${num ? 'number' : 'text'}" value="${esc(value ?? '')}"${attrs}${dis}>`;
}

/** Vẽ form vào root. onChange() được gọi sau khi level đã sửa tại chỗ. */
export function renderFields(root, fields, level, { readOnly = false, onChange = () => {} } = {}) {
  root.innerHTML = `<section class="card"><h3>Thông số</h3><div class="form-grid">${fields.map((f, i) => {
    const id = `lc-field-${i}`;
    const hint = f.hint ? ` title="${esc(f.hint)}"` : '';
    return f.type === 'bool'
      ? `<label class="check"${hint}>${input(f, getPath(level, f.path), id, readOnly)} ${esc(f.label)}</label>`
      : `<label${hint}>${esc(f.label)}${input(f, getPath(level, f.path), id, readOnly)}</label>`;
  }).join('')}</div></section>`;
  fields.forEach((f, i) => {
    const el = root.querySelector(`#lc-field-${i}`);
    el.addEventListener('change', () => {
      let v;
      if (f.type === 'bool') v = el.checked;
      else if (f.type === 'select') v = el.value === '' ? getPath(level, f.path) : optionList(f)[Number(el.value)].value;
      else if (f.type === 'number') v = el.value === '' ? undefined : Number(el.value);
      else v = el.value;
      if (f.type === 'number' && v !== undefined && !Number.isFinite(v)) return;
      setPath(level, f.path, v);
      onChange(f, v);
    });
  });
}

/** Các đường dẫn khác nhau giữa hai level (tối đa `limit`), vd ["time", "items[2]"]. */
export function diffPaths(a, b, limit = 30) {
  const out = [];
  const walk = (x, y, p) => {
    if (out.length >= limit) return;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    const bothObj = x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y);
    if (!bothObj) {
      out.push(p || '(cả level)');
      return;
    }
    const keys = Array.isArray(x) ? [...Array(Math.max(x.length, y.length)).keys()] : [...new Set([...Object.keys(x), ...Object.keys(y)])];
    for (const k of keys) walk(x[k], y[k], Array.isArray(x) ? `${p}[${k}]` : p ? `${p}.${k}` : k);
  };
  walk(a, b, '');
  return out;
}
