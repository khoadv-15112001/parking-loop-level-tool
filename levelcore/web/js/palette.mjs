// Tìm nhanh (Ctrl+K, như ô "Tìm level, bộ, lệnh…" của Sand Jam): gõ số / dải / chữ để mở level của bộ đang mở, tên bộ để
// đổi bộ, hoặc tên màn / lệnh để chạy (kể cả lệnh nằm trong menu). ↑↓ chọn, Enter chạy, Esc đóng.
import { fold, parseLevelQuery, queryMatches } from './query.mjs';
import { $, esc } from './ui.mjs';

const MAX_LEVELS = 8;

/**
 * levels(): level của bộ đang mở; searchText(lv): chữ để tìm; onLevel(name); commands: [{label, words?, key?, group, hidden?(),
 * run()}]. Lệnh có `group` để chia mục (Màn, Bộ, Lệnh).
 */
export function openPalette({ levels, searchText = () => '', onLevel, commands }) {
  if ($('.palette-backdrop')) return;
  const back = document.createElement('div');
  back.className = 'palette-backdrop';
  back.innerHTML = `<div class="palette" role="dialog" aria-label="Tìm nhanh">
    <input type="search" spellcheck="false" autocomplete="off" placeholder="Số level (12, 10-20), chữ, tên bộ, hoặc việc: xếp thứ tự, nhập…">
    <ul role="listbox"></ul><p class="muted small">↑↓ chọn · Enter mở · Esc đóng</p></div>`;
  const input = $('input', back), ul = $('ul', back);
  let results = [], cur = 0;
  const close = () => back.remove();

  const compute = () => {
    const text = input.value.trim(), f = fold(text), q = parseLevelQuery(text);
    const lv = q.empty ? [] : levels().filter(l => queryMatches(q, l.level, searchText(l))).slice(0, MAX_LEVELS)
      .map(l => ({ group: 'Level', label: `Level ${l.name}`, hint: searchText(l).slice(0, 80), run: () => onLevel(l.name) }));
    const cmds = commands.filter(c => !c.hidden?.() && (!f || fold(`${c.label} ${c.words || ''}`).includes(f)));
    results = /^\s*#?\d/.test(text) ? [...lv, ...cmds] : [...cmds, ...lv];
    cur = 0;
    draw();
  };
  const draw = () => {
    let last = null;
    ul.innerHTML = results.map((r, i) => {
      const head = r.group !== last ? `<li class="pal-group">${esc(r.group)}</li>` : '';
      last = r.group;
      return `${head}<li role="option" data-i="${i}" class="${i === cur ? 'cur' : ''}"><span>${esc(r.label)}</span>
        <span class="muted small">${esc(r.hint || '')}</span>${r.key ? `<kbd>${esc(r.key)}</kbd>` : ''}</li>`;
    }).join('') || '<li class="muted">Không tìm thấy.</li>';
    ul.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  };
  const run = i => {
    const r = results[i];
    if (!r) return;
    close();
    Promise.resolve(r.run()).catch(() => {});
  };

  input.addEventListener('input', compute);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(cur);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  ul.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) run(Number(li.dataset.i));
  });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  document.body.appendChild(back);
  compute();
  input.focus();
}
