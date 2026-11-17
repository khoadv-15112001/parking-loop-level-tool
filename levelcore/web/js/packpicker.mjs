// Ô chọn bộ tìm được: nút hiện bộ đang mở, bấm ra danh sách có ô tìm, mỗi bộ hai dòng (tên, tóm tắt).
// <select> gốc vẫn giữ giá trị và sự kiện change, nên code đang đọc / gán select.value không phải sửa.
import { entryMatches } from './packsearch.mjs';
import { esc } from './ui.mjs';

/**
 * select: <select> gốc (bị ẩn). sections(): [{ title, entries: [packEntry | remoteEntry], action?: { value, label } }].
 * Trả { refresh() } để vẽ lại nút khi danh sách bộ đổi.
 */
export function mountPackPicker(select, sections) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pack-picker';
  button.setAttribute('aria-haspopup', 'listbox');
  select.hidden = true;
  select.after(button);

  const entryOf = value => sections().flatMap(s => s.entries).find(e => e.value === value);
  const refresh = () => {
    const entry = entryOf(select.value);
    button.innerHTML = `<span class="pack-picker-name">${entry?.icon ? `${esc(entry.icon)} ` : ''}${esc(entry?.title ?? 'Chọn bộ…')}</span><span class="muted">▾</span>`;
    button.title = entry ? [entry.title, entry.facts.join(' · '), entry.note].filter(Boolean).join('\n') : select.title;
  };
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return proto.get.call(this); },
    set(v) { proto.set.call(this, v); refresh(); },
  });

  let panel = null;
  const close = () => {
    panel?.remove();
    panel = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = e => { if (panel && !panel.contains(e.target) && !button.contains(e.target)) close(); };
  const pick = value => {
    close();
    if (value === select.value && !value.startsWith('hub:')) return;
    const option = [...select.options].find(o => o.value === value);
    if (!option) select.add(new Option(value, value));
    proto.set.call(select, value);
    select.dispatchEvent(new Event('change'));
    refresh();
  };

  let rows = [];
  let active = 0;
  const highlight = () => rows.forEach((row, i) => row.el.classList.toggle('active', i === active));
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); button.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      highlight();
      rows[active].el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault();
      pick(rows[active].value);
    }
  }

  const open = () => {
    if (panel) return close();
    panel = document.createElement('div');
    panel.className = 'pack-pick';
    panel.innerHTML = '<input type="search" placeholder="Tìm theo tên, nền tảng, dải level, nhóm, mô tả…" aria-label="Tìm bộ"><div class="pack-pick-list" role="listbox"></div>';
    const input = panel.querySelector('input');
    const list = panel.querySelector('.pack-pick-list');
    const render = () => {
      const q = input.value.trim();
      rows = [];
      let html = '';
      for (const section of sections()) {
        const found = section.entries.filter(e => entryMatches(e, q));
        const action = !q && section.action ? section.action : null;
        if (!found.length && !action) continue;
        html += `<div class="pack-pick-head">${esc(section.title)}</div>`;
        for (const e of found) {
          const i = rows.push({ value: e.value }) - 1;
          html += `<div class="pack-row${e.value === select.value ? ' on' : ''}" role="option" data-i="${i}" title="${esc([e.title, e.note].filter(Boolean).join('\n'))}">`
            + `<div class="pack-row-name">${e.icon ? `<span>${esc(e.icon)}</span>` : ''}<b>${esc(e.title)}</b></div>`
            + `<div class="pack-row-facts muted">${esc(e.facts.join(' · '))}</div></div>`;
        }
        if (action) {
          const i = rows.push({ value: action.value }) - 1;
          html += `<div class="pack-row pack-row-action" role="option" data-i="${i}">${esc(action.label)}</div>`;
        }
      }
      list.innerHTML = html || `<div class="muted pack-pick-empty">${q ? 'Không có bộ nào khớp.' : 'Chưa có bộ nào.'}</div>`;
      rows.forEach((row, i) => { row.el = list.querySelector(`[data-i="${i}"]`); });
      active = q ? 0 : Math.max(0, rows.findIndex(row => row.value === select.value));
      highlight();
    };
    input.addEventListener('input', render);
    list.addEventListener('click', e => {
      const row = e.target.closest('[data-i]');
      if (row) pick(rows[Number(row.dataset.i)].value);
    });
    list.addEventListener('mousemove', e => {
      const row = e.target.closest('[data-i]');
      if (row && Number(row.dataset.i) !== active) { active = Number(row.dataset.i); highlight(); }
    });
    document.body.append(panel);
    render();
    const r = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${r.bottom + 4}px`;
    rows[active]?.el.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    input.focus();
  };
  button.addEventListener('click', open);
  refresh();
  return { refresh };
}
