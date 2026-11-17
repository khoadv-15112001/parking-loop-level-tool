// Màn Thứ tự của bộ (như Bộ xếp level của Sand Jam): bảng level theo số, cột là tóm tắt level, đường chỉ số trước / sau.
// Các số level (slot) giữ nguyên, level đổi chỗ cho nhau: kéo thả, chọn nhiều (Ctrl / Shift + bấm), Alt+↑↓ dời, "Dời tới
// số…", 📌 ghim slot (level ghim đứng yên khi các level khác dời), hoàn tác / làm lại. Áp = một lần gọi server (mỗi level
// đổi số nhận một revision); áp xong vẫn hoàn tác được. Không có quyền / server chưa hỗ trợ thì chỉ xem.
import { api } from './api.mjs';
import { fillThumbs } from './gallery.mjs';
import { detailHtml, summaryPairs, wireDetail } from './library.mjs';
import { defaultGroup, groupColors, lineChart, numericKeys } from './overview.mjs';
import { liveBrief } from './packs.mjs';
import { $, esc, toast } from './ui.mjs';

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

const MAX_COLUMNS = 6;

/**
 * shell: {state, game, features(), can(action), packInfo(), openLevel, playLevel, shareLevel, levelHub(), afterReorder()}.
 * root: thân màn, tools: thanh công cụ ở hàng ngữ cảnh. Trả {render}.
 */
export function mountOrder(shell, root, tools) {
  let pack = null, baseKey = '', names = [], order = [], byName = new Map(), metric = null, focus = null, lastClick = null;
  let applied = null, stale = false;
  const history = [], future = [], picked = new Set(), pinned = new Set();

  tools.innerHTML = `<label class="inline">Chỉ số <select id="ro-metric"></select></label>
    <span id="ro-edit" class="tools-group">
      <button id="ro-undo" class="icon" title="Hoàn tác (Ctrl+Z)">↶</button><button id="ro-redo" class="icon" title="Làm lại (Ctrl+Y)">↷</button>
      <label class="inline">Dời đã chọn tới số <input id="ro-to" type="number" min="1"></label><button id="ro-go">Dời</button></span>
    <span id="ro-state" class="small"></span>
    <span class="grow"></span>
    <button id="ro-reset" hidden>Bỏ thay đổi</button>
    <button id="ro-apply" class="primary" hidden>Áp thứ tự mới</button>
    <button id="ro-levelhub" title="Xuất gói Level Hub hoặc đẩy dải level lên BI" hidden>⬆ Xuất Level Hub</button>`;
  root.innerHTML = `<div class="ord">
    <div class="ord-main"><div id="ro-chart" class="ord-chart"></div>
      <div class="ord-wrap"><table class="ord-table"><thead></thead><tbody></tbody></table></div>
      <div id="ro-selbar" class="selbar" hidden></div></div>
    <aside id="ro-detail" class="detail" hidden></aside><div class="grip detail-grip" data-pref="detailW" data-edge="left"></div></div>`;
  const tbody = $('tbody', root), detail = $('#ro-detail', root), selbar = $('#ro-selbar', root);

  const readOnly = () => (!shell.features().reorder ? 'Chỉ xem: server này chưa hỗ trợ xếp lại thứ tự'
    : !shell.can('reorder') ? 'Chỉ xem: bạn chưa có quyền xếp thứ tự' : shell.packInfo()?.archived ? 'Chỉ xem: bộ đang lưu trữ' : '');
  const changed = () => order.some((n, i) => n !== names[i]);
  const value = n => Number(byName.get(n)?.summary?.[metric]);

  function reset() {
    const s = shell.state;
    pack = s.pack;
    names = s.levels.map(l => l.name);
    order = [...names];
    byName = new Map(s.levels.map(l => [l.name, l]));
    baseKey = s.levels.map(l => `${l.name}:${l.head_rev}`).join();
    history.length = future.length = 0;
    picked.clear();
    pinned.clear();
    stale = false;
  }

  const commit = next => {
    if (next.join() === order.join()) return;
    history.push(order);
    future.length = 0;
    order = next;
    applied = null;
  };
  const move = to => {
    if (!picked.size) return toast('Chọn level cần dời trước');
    commit(moveItems(order, picked, to, pinned));
    render();
  };
  const step = d => {
    const idx = order.map((n, i) => (picked.has(n) ? i : -1)).filter(i => i >= 0);
    if (idx.length) move(d === 'top' ? 0 : d === 'bottom' ? order.length : d < 0 ? Math.max(0, idx[0] - 1) : Math.min(order.length, idx.at(-1) + 2));
  };
  const undo = () => { if (history.length) { future.push(order); order = history.pop(); render(); } };
  const redo = () => { if (future.length) { history.push(order); order = future.pop(); render(); } };

  function columns() {
    const keys = [];
    for (const l of shell.state.levels) for (const [k] of summaryPairs(l.summary)) if (!keys.includes(k)) keys.push(k);
    return [...(metric && keys.includes(metric) ? [metric] : []), ...keys.filter(k => k !== metric)].slice(0, MAX_COLUMNS);
  }

  function render() {
    const s = shell.state;
    const key = s.levels.map(l => `${l.name}:${l.head_rev}`).join();
    if (pack !== s.pack || (!changed() && key !== baseKey)) reset();
    else if (key !== baseKey) {
      byName = new Map(s.levels.map(l => [l.name, l]));
      stale = s.levels.map(l => l.name).join() !== names.join();
      baseKey = key;
    }
    const keys = numericKeys(s.levels), cfg = shell.game.overview || {};
    if (!keys.includes(metric)) metric = keys.includes(cfg.metric) ? cfg.metric : keys[0] ?? null;
    const ro = readOnly(), edits = changed();
    $('#ro-metric', tools).innerHTML = keys.map(k => `<option ${k === metric ? 'selected' : ''}>${esc(k)}</option>`).join('') || '<option value="">—</option>';
    $('#ro-edit', tools).hidden = !!ro;
    $('#ro-undo', tools).disabled = !history.length;
    $('#ro-redo', tools).disabled = !future.length;
    $('#ro-reset', tools).hidden = !edits;
    $('#ro-apply', tools).hidden = !!ro || !edits;
    $('#ro-levelhub', tools).hidden = !shell.features().levelhub;
    const moved = order.filter((n, i) => n !== names[i]).length;
    $('#ro-state', tools).innerHTML = ro ? `<span class="muted">${esc(ro)}</span>`
      : stale ? '<span class="warn">Bộ vừa thay đổi trong lúc xếp — bấm Bỏ thay đổi để xếp trên bản mới</span>'
      : moved ? `<b>${moved} level đổi số</b> <span class="muted">(chưa áp)</span>`
      : applied ? `<span class="ok">Đã áp: ${applied.moves} level đổi số</span> <button id="ro-undo-apply">Hoàn tác lần xếp này</button>`
      : '<span class="muted">Kéo thả để đổi chỗ; Ctrl / Shift + bấm chọn nhiều; 📌 giữ level đứng yên</span>';

    const g = defaultGroup(s.levels, cfg, metric), color = g ? groupColors(s.levels, g) : null;
    $('#ro-chart', root).innerHTML = !metric ? '' : edits ? lineChart([
      { label: 'Trước', points: names.map((n, i) => [Number(names[i]), value(n)]), dashed: true },
      { label: 'Sau', points: order.map((n, i) => [Number(names[i]), value(n)]) },
    ], { width: 1200, height: 150 }) : lineChart([{ label: metric, points: order.map((n, i) => [Number(names[i]), value(n)]),
      groups: g ? order.map(n => byName.get(n)?.summary?.[g]) : null }], { width: 1200, height: 150, groupColor: color });

    const cols = columns(), thumbs = shell.features().thumbs || !!shell.game.thumbnail;
    const maxV = Math.max(1, ...s.levels.map(l => Number(l.summary?.[metric])).filter(Number.isFinite));
    $('thead', root).innerHTML = `<tr><th></th><th>Số</th>${thumbs ? '<th>Ảnh</th>' : ''}<th>Level</th>${cols.map(k => `<th>${esc(k)}</th>`).join('')}<th class="pin" title="Ghim slot">📌</th></tr>`;
    tbody.innerHTML = order.map((n, i) => {
      const lv = byName.get(n) || { name: n, summary: {} };
      const mv = n !== names[i];
      const cells = cols.map(k => {
        const v = lv.summary?.[k];
        if (k === metric && Number.isFinite(Number(v))) return `<td class="num"><span class="bar" style="--w:${Math.round(Math.max(2, Math.min(100, (Number(v) / maxV) * 100)))}"></span>${esc(v)}</td>`;
        if (g && k === g && v != null) return `<td><span class="gchip" style="--c:${color(v)}">${esc(v)}</span></td>`;
        return `<td>${v == null || typeof v === 'object' ? '' : esc(v)}</td>`;
      }).join('');
      const live = liveBrief(shell.live?.(n));
      return `<tr data-name="${esc(n)}" draggable="${!ro && !pinned.has(n)}" class="${picked.has(n) ? 'sel' : ''} ${mv ? 'moved' : ''} ${n === focus ? 'focus' : ''} ${live?.flag ? `live-${live.flag}` : ''}">
        <td class="grip">${ro || pinned.has(n) ? '' : '⋮⋮'}</td><td class="slot">${esc(names[i])}</td>
        ${thumbs ? `<td><div class="thumb sm" data-sha="${esc(lv.sha || '')}"></div></td>` : ''}
        <td class="lv" ${mv ? `title="Level ${esc(n)} sẽ thành số ${esc(names[i])}"` : ''}>Level ${esc(n)}${mv ? ` <span class="from">→ ${esc(names[i])}</span>` : ''}${lv.lock ? ' 🔒' : ''}
          ${live ? `<span class="lv-live ${live.flag}" title="Người chơi thật (BI): ${esc(live.text)}">${esc(live.text)}</span>` : ''}</td>${cells}
        <td class="pin">${ro ? (pinned.has(n) ? '📌' : '') : `<button data-pin class="icon" title="Ghim slot: level này đứng yên khi các level khác dời">${pinned.has(n) ? '📌' : '·'}</button>`}</td></tr>`;
    }).join('') || `<tr><td colspan="9" class="muted">Bộ chưa có level.</td></tr>`;
    if (thumbs) fillThumbs(tbody, s.pack, s.levels, { thumbs: shell.features().thumbs === true, thumbnail: shell.game.thumbnail || null }).catch(() => {});
    renderSide();
  }

  function renderSide() {
    const lv = byName.get(focus);
    detail.hidden = !lv;
    if (lv) {
      detail.innerHTML = detailHtml(shell, lv);
      fillThumbs(detail, shell.state.pack, [lv], { thumbs: shell.features().thumbs === true, thumbnail: shell.game.thumbnail || null }).catch(() => {});
      const info = $('[data-level-info]', detail);
      if (info) shell.fillLevelInfo?.(info, lv.name);
    }
    selbar.hidden = !picked.size || !!readOnly();
    if (!selbar.hidden) {
      selbar.innerHTML = `<b>Đã chọn ${picked.size}</b>
        <button data-mv="top" title="Lên đầu bộ">⤒</button><button data-mv="-1" title="Lên một số (Alt+↑)">↑ Lên</button>
        <button data-mv="1" title="Xuống một số (Alt+↓)">↓ Xuống</button><button data-mv="bottom" title="Xuống cuối bộ">⤓</button>
        <button data-pinsel title="Ghim / bỏ ghim các level đã chọn">📌 Ghim</button><span class="grow"></span><button data-clear>Bỏ chọn</button>`;
    }
  }

  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-name]');
    if (!tr) return;
    const n = tr.dataset.name;
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
    focus = n;
    render();
  });
  tbody.addEventListener('dblclick', e => {
    const tr = e.target.closest('tr[data-name]');
    if (tr && !changed()) shell.openLevel(tr.dataset.name);
  });
  let dragFrom = null;
  tbody.addEventListener('dragstart', e => {
    dragFrom = e.target.closest('tr')?.dataset.name;
    if (dragFrom && !picked.has(dragFrom)) {
      picked.clear();
      picked.add(dragFrom);
    }
  });
  tbody.addEventListener('dragover', e => e.preventDefault());
  tbody.addEventListener('drop', e => {
    e.preventDefault();
    const tr = e.target.closest('tr[data-name]');
    if (!dragFrom || !tr) return;
    const rect = tr.getBoundingClientRect();
    dragFrom = null;
    move(order.indexOf(tr.dataset.name) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0));
  });
  selbar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mv) step(b.dataset.mv === 'top' || b.dataset.mv === 'bottom' ? b.dataset.mv : Number(b.dataset.mv));
    if (b.hasAttribute('data-pinsel')) {
      for (const n of picked) pinned.has(n) ? pinned.delete(n) : pinned.add(n);
      picked.clear();
      render();
    }
    if (b.hasAttribute('data-clear')) {
      picked.clear();
      render();
    }
  });
  wireDetail(shell, detail, () => byName.get(focus), () => render());

  const apply = async () => {
    if (shell.state.dirty) return toast('Lưu hoặc bỏ thay đổi của level đang mở trước khi áp thứ tự mới', 'err');
    const b = $('#ro-apply', tools);
    b.disabled = true;
    try {
      const res = await api.reorder(pack, order, names);
      applied = { before: res.before, order: [...order], moves: res.moves.length };
      toast(`Đã xếp lại: ${res.moves.length} level đổi số`, 'ok');
      order = [...names];
      await shell.afterReorder();
    } catch (e) {
      toast(e.status === 409 ? 'Bộ đã đổi trong lúc bạn xếp — bấm Bỏ thay đổi rồi xếp lại trên bản mới' : e.message, 'err');
    } finally {
      b.disabled = false;
    }
    render();
  };
  const undoApply = async () => {
    const a = applied;
    applied = null;
    try {
      const back = await api.reorder(pack, undoOrder(a.before, a.order), a.before);
      toast(`Đã hoàn tác: ${back.moves.length} level về số cũ`, 'ok');
      await shell.afterReorder();
    } catch (e) {
      toast(e.message, 'err');
    }
    render();
  };

  tools.addEventListener('change', e => { if (e.target.id === 'ro-metric') { metric = e.target.value; render(); } });
  tools.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
    if (id === 'ro-undo') undo();
    if (id === 'ro-redo') redo();
    if (id === 'ro-go') {
      const slot = names.indexOf(String($('#ro-to', tools).value));
      if (slot < 0) return toast('Không có số level này trong bộ', 'err');
      move(slot);
    }
    if (id === 'ro-reset') { reset(); render(); }
    if (id === 'ro-apply') apply();
    if (id === 'ro-undo-apply') undoApply();
    if (id === 'ro-levelhub') shell.levelHub().catch(err => toast(err.message, 'err'));
  });
  document.addEventListener('keydown', e => {
    if (root.closest('.view')?.hidden || readOnly() || $('.dialog-backdrop, .palette-backdrop')) return;
    if (e.target.closest?.('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); step(e.key === 'ArrowUp' ? -1 : 1); }
  });
  return { render, pending: changed };
}
