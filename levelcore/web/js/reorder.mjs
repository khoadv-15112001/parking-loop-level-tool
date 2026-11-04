// Hộp "Xếp thứ tự" của bộ: các số level (slot) giữ nguyên, level đổi chỗ cho nhau. Kéo thả, chọn nhiều (Ctrl / Shift +
// bấm), Alt+↑↓ dời, "Dời tới số…", 📌 ghim slot (level ghim đứng yên khi các level khác dời), hoàn tác / làm lại, xem
// trước đường chỉ số trước / sau. Áp = một lần gọi server (mỗi level đổi số nhận một revision); áp xong vẫn hoàn tác được.
import { api } from './api.mjs';
import { $, esc, openDialog, toast } from './ui.mjs';
import { lineChart, numericKeys } from './overview.mjs';

/** Chuyển thứ tự đã áp thành thứ tự đưa các level về chỗ cũ (dùng cho Hoàn tác lần xếp). */
export function undoOrder(before, order) {
  const nowName = new Map(order.map((orig, i) => [orig, before[i]]));
  return before.map(n => nowName.get(n));
}

/** Dời các vị trí `picked` (đã sắp) tới trước vị trí `to` của mảng, bỏ qua vị trí ghim. Trả mảng mới. */
export function moveItems(order, picked, to, pinned = new Set()) {
  const free = order.map((n, i) => [n, i]).filter(([n]) => !pinned.has(n));
  const moving = free.filter(([n]) => picked.has(n)).map(([n]) => n);
  const rest = free.filter(([n]) => !picked.has(n)).map(([n]) => n);
  const anchor = order.slice(to).find(n => !pinned.has(n) && !picked.has(n));
  const at = anchor == null ? rest.length : rest.indexOf(anchor);
  rest.splice(at, 0, ...moving);
  const out = [...order];
  let k = 0;
  for (let i = 0; i < out.length; i++) if (!pinned.has(order[i])) out[i] = rest[k++];
  return out;
}

export async function openReorder({ pack, levels, readOnly, metricDefault = null, onApplied }) {
  const names = levels.map(l => l.name);
  const byName = new Map(levels.map(l => [l.name, l]));
  const keys = numericKeys(levels);
  let metric = metricDefault && keys.includes(metricDefault) ? metricDefault : keys[0] ?? null;
  let order = [...names];
  const history = [], future = [];
  const picked = new Set(), pinned = new Set();
  let lastClick = null;

  const commit = next => {
    if (next.join() === order.join()) return;
    history.push(order);
    future.length = 0;
    order = next;
  };
  const value = n => Number(byName.get(n)?.summary?.[metric]);
  const maxOf = () => Math.max(1, ...levels.map(l => Number(l.summary?.[metric])).filter(Number.isFinite));

  const render = dlg => {
    const maxV = maxOf();
    $('#ro-list', dlg).innerHTML = order.map((n, i) => {
      const lv = byName.get(n);
      const moved = n !== names[i];
      const v = metric ? value(n) : NaN;
      return `<li data-name="${esc(n)}" draggable="${pinned.has(n) ? 'false' : 'true'}" class="${picked.has(n) ? 'sel' : ''} ${moved ? 'moved' : ''}">
        <span class="slot">${esc(names[i])}</span><span class="from muted small">${moved ? `← ${esc(n)}` : ''}</span>
        <span class="sum small muted">${esc(Object.entries(lv.summary || {}).filter(([, x]) => typeof x !== 'object').slice(0, 4).map(([k, x]) => `${k} ${x}`).join(' · '))}</span>
        ${Number.isFinite(v) ? `<span class="bar" style="--w:${Math.max(2, Math.min(100, (v / maxV) * 100))}%"></span>` : '<span></span>'}
        <button data-pin title="Ghim slot: level này đứng yên khi các level khác dời">${pinned.has(n) ? '📌' : '·'}</button></li>`;
    }).join('');
    const changed = order.filter((n, i) => n !== names[i]).length;
    $('#ro-state', dlg).textContent = changed ? `${changed} level đổi số` : 'Chưa đổi gì';
    $('#ro-chart', dlg).innerHTML = metric ? lineChart([
      { label: 'Trước', points: names.map((n, i) => [Number(names[i]), value(n)]), dashed: true },
      { label: 'Sau', points: order.map((n, i) => [Number(names[i]), value(n)]) },
    ], { height: 120 }) : '<p class="muted small">Game chưa có chỉ số số trong tóm tắt level để vẽ đường.</p>';
  };

  const move = (dlg, to) => {
    if (!picked.size) return toast('Chọn level cần dời trước');
    commit(moveItems(order, picked, to, pinned));
    render(dlg);
  };

  const res = await openDialog({
    title: `Xếp thứ tự bộ ${pack}`, wide: true,
    html: `<div class="ro-tools"><label>Chỉ số<select id="ro-metric">${keys.map(k => `<option ${k === metric ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      <button id="ro-undo" title="Ctrl+Z">↶</button><button id="ro-redo" title="Ctrl+Shift+Z">↷</button>
      <button id="ro-up" title="Alt+↑">↑</button><button id="ro-down" title="Alt+↓">↓</button>
      <label class="inline">Dời tới số<input id="ro-to" type="number" min="1"></label><button id="ro-go">Dời</button>
      <span id="ro-state" class="muted small"></span></div>
      <div id="ro-chart"></div>
      <p class="muted small">Kéo thả để dời; Ctrl / Shift + bấm để chọn nhiều; 📌 giữ level đứng yên. Số bên trái là slot, không đổi.</p>
      <ol id="ro-list" class="ro-list"></ol>`,
    actions: [{ label: 'Huỷ', value: null }, {
      label: 'Áp thứ tự mới', primary: true, onClick: async () => {
        if (readOnly) throw new Error('Bộ đang chỉ đọc');
        if (order.join() === names.join()) return null;
        return api.reorder(pack, order, names);
      },
    }],
    onOpen: dlg => {
      render(dlg);
      const list = $('#ro-list', dlg);
      list.addEventListener('click', e => {
        const li = e.target.closest('li[data-name]');
        if (!li) return;
        const n = li.dataset.name;
        if (e.target.closest('[data-pin]')) {
          pinned.has(n) ? pinned.delete(n) : pinned.add(n);
          picked.delete(n);
        } else if (e.shiftKey && lastClick) {
          const [a, b] = [order.indexOf(lastClick), order.indexOf(n)].sort((x, y) => x - y);
          for (const x of order.slice(a, b + 1)) if (!pinned.has(x)) picked.add(x);
        } else if (e.ctrlKey || e.metaKey) {
          picked.has(n) ? picked.delete(n) : !pinned.has(n) && picked.add(n);
          lastClick = n;
        } else {
          picked.clear();
          if (!pinned.has(n)) picked.add(n);
          lastClick = n;
        }
        render(dlg);
      });
      let dragFrom = null;
      list.addEventListener('dragstart', e => {
        dragFrom = e.target.closest('li')?.dataset.name;
        if (dragFrom && !picked.has(dragFrom)) {
          picked.clear();
          picked.add(dragFrom);
        }
      });
      list.addEventListener('dragover', e => e.preventDefault());
      list.addEventListener('drop', e => {
        e.preventDefault();
        const li = e.target.closest('li[data-name]');
        if (!dragFrom || !li) return;
        const rect = li.getBoundingClientRect();
        const i = order.indexOf(li.dataset.name) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
        dragFrom = null;
        move(dlg, i);
      });
      const step = d => {
        const idx = order.map((n, i) => (picked.has(n) ? i : -1)).filter(i => i >= 0);
        if (!idx.length) return;
        move(dlg, d < 0 ? Math.max(0, idx[0] - 1) : Math.min(order.length, idx.at(-1) + 2));
      };
      $('#ro-up', dlg).addEventListener('click', () => step(-1));
      $('#ro-down', dlg).addEventListener('click', () => step(1));
      $('#ro-go', dlg).addEventListener('click', () => {
        const slot = names.indexOf(String($('#ro-to', dlg).value));
        if (slot < 0) return toast('Không có số level này trong bộ', 'err');
        move(dlg, slot);
      });
      const undo = () => { if (history.length) { future.push(order); order = history.pop(); render(dlg); } };
      const redo = () => { if (future.length) { history.push(order); order = future.pop(); render(dlg); } };
      $('#ro-undo', dlg).addEventListener('click', undo);
      $('#ro-redo', dlg).addEventListener('click', redo);
      $('#ro-metric', dlg).addEventListener('change', e => { metric = e.target.value; render(dlg); });
      dlg.addEventListener('keydown', e => {
        if (e.target.closest('input, select')) return;
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); step(e.key === 'ArrowUp' ? -1 : 1); }
      });
    },
  });
  if (!res || !res.moves) return;
  toast(`Đã xếp lại: ${res.moves.length} level đổi số`, 'ok');
  await onApplied?.(res);
  const undoIt = await openDialog({
    title: 'Đã áp thứ tự mới', html: `<p>${esc(res.moves.length)} level đổi số, mỗi level có một revision mới (xem ở Lịch sử).</p>`,
    actions: [{ label: 'Hoàn tác lần xếp này', value: true }, { label: 'Xong', primary: true, value: null }],
  });
  if (!undoIt) return;
  const back = await api.reorder(pack, undoOrder(res.before, order), res.before);
  toast(`Đã hoàn tác: ${back.moves.length} level về số cũ`, 'ok');
  await onApplied?.(back);
}
