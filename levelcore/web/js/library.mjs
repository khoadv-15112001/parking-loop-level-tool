// Màn Thư viện: lưới ảnh level của bộ đang mở (như Kho level của Sand Jam, Gallery của AntLevel). Tìm theo số / dải / chữ,
// lọc theo nhóm của tóm tắt level (vd độ khó) và trạng thái kiểm định, sắp xếp, cỡ ảnh S / M / L. Bấm một thẻ để xem
// nhanh ở cột phải; Ctrl / Shift + bấm để chọn nhiều rồi làm cùng lúc; bấm đúp để mở ở màn Level.
import { captureMissing, captureOne, fillThumbs, hasImage } from './gallery.mjs';
import { defaultGroup, groupColors, numericKeys } from './overview.mjs';
import { parseLevelQuery, queryMatches } from './query.mjs';
import { $, esc, fmtTime, shortUser, toast } from './ui.mjs';

/** Cặp khoá / giá trị hiện được của tóm tắt level (bỏ giá trị rỗng và object). */
export const summaryPairs = summary => Object.entries(summary || {}).filter(([, v]) => v != null && v !== '' && typeof v !== 'object');

/** Trạng thái kiểm định đã biết của level: 'err' | 'warn' | 'ok' | '' (chưa kiểm định bộ). */
export function checkState(state, name) {
  if (state.checked?.pack !== state.pack) return '';
  return state.invalid.has(name) ? 'err' : state.warned.has(name) ? 'warn' : 'ok';
}

const CHECK_LABEL = { err: 'Có lỗi', warn: 'Có cảnh báo', ok: 'Hợp lệ' };

/** Cột chi tiết của một level (Thư viện, Thứ tự): ảnh lớn, số liệu, người sửa, thao tác. */
export function detailHtml(shell, lv) {
  const s = shell.state, st = checkState(s, lv.name);
  const msgs = [...(s.invalid.get(lv.name) || []).map(m => `<div class="err">${esc(m)}</div>`),
    ...(s.warned.get(lv.name) || []).map(m => `<div class="warn">${esc(m)}</div>`)].join('');
  const f = shell.features();
  return `<div class="thumb big" data-sha="${esc(lv.sha)}"><span class="ph">${esc(lv.name)}</span></div>
    <div class="d-head"><h3>Level ${esc(lv.name)}</h3>${st ? `<span class="chip ${st}">${esc(CHECK_LABEL[st])}</span>` : ''}
      ${lv.lock ? `<span class="badge warn" title="Đang sửa">🔒 ${esc(shortUser(lv.lock.holder))}</span>` : ''}</div>
    <div class="stats">${summaryPairs(lv.summary).slice(0, 9).map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${shell.game.levelDetail ? `<div class="d-game">${shell.game.levelDetail(lv.summary || {}, lv) || ''}</div>` : ''}
    <p class="small muted">r${esc(lv.head_rev)} · ${esc(shortUser(lv.author))} · ${esc(fmtTime(lv.updated_at))}</p>
    <div class="d-actions"><button class="primary" data-act="open" title="Mở ở màn Level để xem, sửa (bấm đúp thẻ cũng mở)">Mở level</button>
      ${f.webgame ? '<button data-act="play" title="Chơi level này bằng game thật">▶ Chơi thử</button>' : ''}
      ${f.share && f.webgame ? '<button data-act="share" class="icon" title="Link chơi trên điện thoại">📱</button>' : ''}
      ${f.thumbs && f.webgame ? '<button data-act="capture" title="Dựng level trong game rồi chụp lại ảnh">📷 Chụp lại</button>' : ''}</div>
    ${msgs ? `<div class="validation">${msgs}</div>` : ''}`;
}

/** Gắn thao tác của cột chi tiết; current() → level đang xem, after() chạy sau khi chụp lại ảnh. */
export function wireDetail(shell, el, current, after = () => {}) {
  el.addEventListener('click', async e => {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    const lv = current();
    if (!act || !lv) return;
    try {
      if (act === 'open') await shell.openLevel(lv.name);
      if (act === 'play') await shell.playLevel(lv.name);
      if (act === 'share') await shell.shareLevel(lv.name);
      if (act === 'capture') {
        toast(`Đang chụp level ${lv.name}…`);
        await captureOne(shell.state.pack, lv);
        after();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

const SORTS = [['num', 'Số level ↑'], ['num-desc', 'Số level ↓'], ['recent', 'Mới sửa trước']];
const SIZES = [['s', 'S'], ['m', 'M'], ['l', 'L']];

/**
 * shell: {state, game, features(), stored(key), store(key, v), openLevel(name), playLevel(name), shareLevel(name),
 * promote(names), deleteLevels(names)}. root: thân màn; tools: thanh công cụ ở hàng ngữ cảnh. Trả {render}.
 */
export function mountLibrary(shell, root, tools) {
  const sizeKey = `${shell.game.storagePrefix}.libSize`;
  let size = shell.stored(sizeKey) || 'm', sort = 'num', groupVal = null, focus = null, lastClick = null, pack = null;
  const picked = new Set();

  tools.innerHTML = `<input id="lib-search" type="search" placeholder="Tìm: 12, 10-20, chữ…" title="Số level, dải số, danh sách số hoặc chữ (không cần dấu)">
    <select id="lib-check" title="Lọc theo kiểm định"><option value="">Mọi trạng thái</option><option value="err">Có lỗi</option>
      <option value="warn">Có cảnh báo</option><option value="ok">Hợp lệ</option><option value="noimg">Chưa có ảnh</option></select>
    <span id="lib-groups" class="facets"></span>
    <span class="grow"></span>
    <span id="lib-count" class="muted small"></span>
    <select id="lib-sort" title="Sắp xếp">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span class="seg" title="Cỡ ảnh">${SIZES.map(([v, l]) => `<button data-size="${v}">${l}</button>`).join('')}</span>
    <button id="lib-capture" title="Dựng từng level chưa có ảnh trong game rồi chụp" hidden>📷 Chụp ảnh còn thiếu</button>`;
  root.innerHTML = `<div class="lib">
    <div class="lib-main"><ul id="lib-grid" class="cards"></ul>
      <div id="lib-selbar" class="selbar" hidden></div></div>
    <aside id="lib-detail" class="detail" hidden></aside><div class="grip detail-grip" data-pref="detailW" data-edge="left"></div></div>`;
  const grid = $('#lib-grid', root), detail = $('#lib-detail', root), selbar = $('#lib-selbar', root);

  const group = () => defaultGroup(shell.state.levels, shell.game.overview || {}, numericKeys(shell.state.levels)[0]);

  function items() {
    const s = shell.state, q = parseLevelQuery($('#lib-search', tools).value), check = $('#lib-check', tools).value, g = group();
    const out = s.levels.filter(lv => {
      if (g && groupVal != null && String(lv.summary?.[g]) !== groupVal) return false;
      if (check === 'noimg' ? hasImage(lv.sha) : check && checkState(s, lv.name) !== check) return false;
      return q.empty || queryMatches(q, lv.level, `${shell.game.searchText?.(lv.summary || {}) || ''} ${lv.author || ''}`);
    });
    if (sort === 'num-desc') out.reverse();
    if (sort === 'recent') out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return out;
  }

  const tags = lv => shell.game.listItem?.(lv.summary || {})?.tags || '';   // chip của game (HTML game đã esc), như ở danh sách

  function card(lv, color, g) {
    const st = checkState(shell.state, lv.name);
    const sum = summaryPairs(lv.summary).filter(([k]) => k !== g).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(' · ');
    return `<li data-name="${esc(lv.name)}" class="${picked.has(lv.name) ? 'picked' : ''} ${lv.name === focus ? 'focus' : ''}">
      <div class="thumb" data-sha="${esc(lv.sha)}"><span class="ph">${esc(lv.name)}</span></div>
      <div class="c-head">${st ? `<span class="dot ${st}" title="${esc(CHECK_LABEL[st])}"></span>` : ''}<b>#${esc(lv.name)}</b>
        ${g && lv.summary?.[g] != null ? `<span class="gchip" style="--c:${color(lv.summary[g])}">${esc(lv.summary[g])}</span>` : ''}
        ${lv.lock ? `<span title="${esc(shortUser(lv.lock.holder))} đang sửa">🔒</span>` : ''}</div>
      <div class="c-sum small muted" title="${esc(sum)}">${esc(sum)}</div>
      ${tags(lv) ? `<div class="c-tags">${tags(lv)}</div>` : ''}
      <div class="c-by small muted">r${esc(lv.head_rev)} · ${esc(shortUser(lv.author))} · ${esc(fmtTime(lv.updated_at))}</div></li>`;
  }

  function renderDetail() {
    const lv = shell.state.levels.find(l => l.name === focus);
    detail.hidden = !lv;
    if (!lv) return;
    detail.innerHTML = detailHtml(shell, lv);
    fillThumbs(detail, shell.state.pack, [lv], thumbOpts()).catch(() => {});
  }

  function renderSelbar() {
    selbar.hidden = picked.size < 2;
    if (selbar.hidden) return;
    const ro = shell.packReadOnly();
    selbar.innerHTML = `<b>Đã chọn ${picked.size}</b>
      <button data-bulk="promote" title="Chép các level đã chọn sang bộ khác (vd production)">Promote…</button>
      ${shell.features().thumbs && shell.features().webgame ? '<button data-bulk="capture">📷 Chụp lại ảnh</button>' : ''}
      <button data-bulk="delete" class="danger" ${ro ? 'disabled' : ''}>🗑 Xoá</button>
      <span class="grow"></span><button data-bulk="clear">Bỏ chọn</button>`;
  }

  const thumbOpts = () => ({ thumbs: shell.features().thumbs === true, thumbnail: shell.game.thumbnail || null });

  function render() {
    const s = shell.state;
    if (pack !== s.pack) {
      pack = s.pack;
      picked.clear();
      focus = null;
      groupVal = null;
    }
    const g = group(), color = g ? groupColors(s.levels, g) : () => '';
    const counts = new Map();
    if (g) for (const l of s.levels) counts.set(String(l.summary?.[g]), (counts.get(String(l.summary?.[g])) || 0) + 1);
    $('#lib-groups', tools).innerHTML = g ? `<button data-group="" class="${groupVal == null ? 'active' : ''}">Tất cả</button>${[...counts].sort().map(([v, n]) =>
      `<button data-group="${esc(v)}" class="${groupVal === v ? 'active' : ''}" title="${esc(g)} = ${esc(v)}"><span class="dot" style="background:${color(v)}"></span>${esc(v)} <span class="muted">${n}</span></button>`).join('')}` : '';
    for (const b of tools.querySelectorAll('[data-size]')) b.classList.toggle('active', b.dataset.size === size);
    $('#lib-capture', tools).hidden = !(shell.features().thumbs && shell.features().webgame);
    $('#lib-check option[value="noimg"]', tools).hidden = !shell.features().thumbs;
    grid.dataset.size = size;
    const list = items();
    const bad = s.checked?.pack === s.pack ? s.invalid.size : null;
    $('#lib-count', tools).textContent = `${list.length} / ${s.levels.length} level${bad ? ` · ${bad} lỗi` : ''}`;
    grid.innerHTML = list.map(lv => card(lv, color, g)).join('')
      || `<li class="empty muted">${s.levels.length ? 'Không có level nào khớp bộ lọc.' : 'Bộ chưa có level — vào màn Level để tạo hoặc nhập.'}</li>`;
    fillThumbs(grid, s.pack, list, thumbOpts()).catch(() => {});
    if (focus && !s.levels.some(l => l.name === focus)) focus = null;
    for (const n of [...picked]) if (!s.levels.some(l => l.name === n)) picked.delete(n);
    renderDetail();
    renderSelbar();
  }

  const paint = () => {   // đổi chọn: chỉ đổi class của thẻ, không vẽ lại cả lưới
    for (const li of grid.querySelectorAll('li[data-name]')) {
      li.classList.toggle('picked', picked.has(li.dataset.name));
      li.classList.toggle('focus', li.dataset.name === focus);
    }
    renderDetail();
    renderSelbar();
  };

  grid.addEventListener('click', e => {
    const li = e.target.closest('li[data-name]');
    if (!li) return;
    const n = li.dataset.name;
    const names = [...grid.querySelectorAll('li[data-name]')].map(x => x.dataset.name);
    if (e.shiftKey && lastClick) {
      const [a, b] = [names.indexOf(lastClick), names.indexOf(n)].sort((x, y) => x - y);
      for (const x of names.slice(a, b + 1)) picked.add(x);
    } else if (e.ctrlKey || e.metaKey) {
      picked.has(n) ? picked.delete(n) : picked.add(n);
      lastClick = n;
    } else {
      picked.clear();
      picked.add(n);
      lastClick = n;
    }
    focus = n;
    paint();
  });
  grid.addEventListener('dblclick', e => {
    const li = e.target.closest('li[data-name]');
    if (li) shell.openLevel(li.dataset.name);
  });
  wireDetail(shell, detail, () => shell.state.levels.find(l => l.name === focus), () => render());
  selbar.addEventListener('click', async e => {
    const act = e.target.closest('button[data-bulk]')?.dataset.bulk;
    if (!act) return;
    const names = [...picked].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    try {
      if (act === 'clear') picked.clear();
      if (act === 'promote') await shell.promote(names);
      if (act === 'delete' && await shell.deleteLevels(names)) picked.clear();
      if (act === 'capture') {
        const list = shell.state.levels.filter(l => picked.has(l.name));
        for (const [i, lv] of list.entries()) {
          selbar.querySelector('[data-bulk="capture"]').textContent = `📷 ${i + 1}/${list.length}`;
          await captureOne(shell.state.pack, lv);
        }
        toast(`Đã chụp ${list.length} ảnh`, 'ok');
      }
    } catch (err) {
      toast(err.message, 'err');
    }
    render();
  });
  tools.addEventListener('input', e => { if (e.target.id === 'lib-search') render(); });
  tools.addEventListener('change', e => {
    if (e.target.id === 'lib-sort') sort = e.target.value;
    if (e.target.id === 'lib-sort' || e.target.id === 'lib-check') render();
  });
  tools.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.size) {
      size = b.dataset.size;
      shell.store(sizeKey, size);
      render();
    } else if (b.dataset.group != null) {
      groupVal = b.dataset.group === '' ? null : b.dataset.group;
      render();
    } else if (b.id === 'lib-capture') {
      b.disabled = true;
      try {
        await captureMissing(shell.state.pack, shell.state.levels, (i, n) => { b.textContent = `📷 ${i}/${n}`; });
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        b.disabled = false;
        b.textContent = '📷 Chụp ảnh còn thiếu';
      }
      render();
    }
  });
  return { render, focusSearch: () => $('#lib-search', tools).focus() };
}
