// Giao diện riêng của Parking Loop trong vỏ của core (hook ui.mjs, levelcore/README.md mục "Giao diện của game"):
// renderEditor = editor bàn chơi (làn, bãi, vật cản) + Chơi thử chạy luật port từ bản Unity (model.mjs) + Giải (solver).
// Editor sửa thẳng raw Level_NNNN.json, giữ kiểu file gọn (chỉ ghi trường cần).
import {
  CODES, COLOR_HEX, COLOR_VN, DEFAULT_LOOP, OBSTACLE, colorOf, lotOrder, normalize, tryConvert,
} from './format.mjs';
import { ParkingModel } from './model.mjs';
import { PlayView, artUrl, loadArt, sound } from './playview.mjs';
import { COS, SIN } from './carmesh.mjs';
import { levelSummary, mechanicsOf } from './rules.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hexOf = ch => COLOR_HEX[CODES.indexOf(String(ch).toUpperCase()) + 1] || COLOR_HEX[0];
const DARK_TEXT = new Set(['Y', 'W', 'C', 'L', 'T']);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ───────────────────────────── sửa raw (giữ kiểu file gọn) ─────────────────────────────

const flag = (o, k, v) => { if (v) o[k] = true; else if (k in o) o[k] = false; };
const num = (o, k, v) => { if (v) o[k] = v; else delete o[k]; };

function ensure(raw) {
  if (!isObj(raw.pf)) raw.pf = {};
  if (!Array.isArray(raw.pf.sd)) raw.pf.sd = [];
  if (!isObj(raw.ui)) raw.ui = {};
  if (!Array.isArray(raw.ui.u)) raw.ui.u = [];
  for (const s of raw.pf.sd) { if (!Array.isArray(s.se)) s.se = []; }
  return raw;
}
const pOf = o => ({ x: o?.p?.x | 0, y: o?.p?.y | 0 });
const cnOf = u => (isObj(u.cn) ? { x: u.cn.x | 0, y: u.cn.y | 0 } : null);
const setP = (o, p) => { if (p.x || p.y || o.p) o.p = { x: p.x, y: p.y }; if (!p.x && !p.y && o.p && !('x' in o.p && 'y' in o.p)) o.p = { x: 0, y: 0 }; };

/** Làn theo thứ tự game (p.y, p.x) → object sd trong raw. */
function lanesOf(raw) {
  return raw.pf.sd.map((s, i) => [s, i]).sort((a, b) => pOf(a[0]).y - pOf(b[0]).y || pOf(a[0]).x - pOf(b[0]).x || a[1] - b[1]).map(([s]) => s);
}

/** Cột bãi theo thứ tự game → [{x, units: [object ui.u, trước (sát đường) → sau]}]. */
function lotOf(raw) {
  const n = normalize(raw);
  return lotOrder(n).map(g => ({ x: g.x, units: g.units.map(i => raw.ui.u[i]) }));
}

/** Đặt lại y trong một cột bãi theo thứ tự mới (trước → sau) và sửa mọi cn trỏ vào các ô đã dời. */
function renumberColumn(raw, x, units) {
  const moved = new Map();
  units.forEach((u, i) => {
    const old = pOf(u), y = units.length - 1 - i;
    moved.set(`${old.x},${old.y}`, { x, y });
    setP(u, { x, y });
  });
  for (const u of raw.ui.u) {
    const cn = cnOf(u);
    if (cn && moved.has(`${cn.x},${cn.y}`) && !units.includes(u)) u.cn = { ...moved.get(`${cn.x},${cn.y}`) };
  }
  for (const u of units) {
    const cn = cnOf(u);
    if (cn && moved.has(`${cn.x},${cn.y}`)) u.cn = { ...moved.get(`${cn.x},${cn.y}`) };
  }
}

function syncColumns(raw) {
  const n = lotOf(raw).length, old = Array.isArray(raw.ui.c) ? raw.ui.c : [];
  raw.ui.c = Array.from({ length: n }, (_, i) => old[i] ?? (i ? { o: i } : {}));
}

function dropLinksTo(raw, p) {
  for (const u of raw.ui.u) { const cn = cnOf(u); if (cn && cn.x === p.x && cn.y === p.y) delete u.cn; }
}

// ───────────────────────────── editor ─────────────────────────────

const TOOLS = [
  ['paint', '🖌', 'Tô màu (click xe / ô trống)'],
  ['erase', '⌫', 'Xoá xe'],
  ['hidden', '?', 'Bật / tắt xe ẩn'],
  ['key', '🔑', 'Xe làn mang chìa khoá'],
  ['box', '🔒', 'Hộp khoá trong bãi (mở bằng chìa)'],
  ['gen', '⚙', 'Máy phát trong bãi (giữ các xe phía sau)'],
  ['link', '⛓', 'Nối xe bãi: click xe A rồi xe B (click lại A để bỏ nối)'],
];

function renderEditor(ctx) {
  const st = {
    level: ctx.level, editable: ctx.editable, mode: 'edit', tool: 'paint', color: 'R', lane: -1, linkFrom: null,
    play: null, solve: null, worker: null,
  };
  const root = document.createElement('div');
  root.className = 'pl-root';
  ctx.el.replaceChildren(root);

  const changed = () => { ctx.changed(); st.solve = null; draw(); };

  // ---------- thao tác ----------
  function laneClick(li, slot) {
    if (!st.editable) return;
    const raw = ensure(st.level), lane = lanesOf(raw)[li];
    if (!lane) return;
    const se = lane.se, cp = Math.max(1, raw.pf.cp | 0), e = se[slot];
    switch (st.tool) {
      case 'paint':
        if (e) e.c = CODES.indexOf(st.color) + 1;
        else if (se.length < cp) se.push({ c: CODES.indexOf(st.color) + 1 });
        else return ctx.toast?.('Làn đã đầy (tăng chiều cao làn cp)');
        break;
      case 'erase': if (!e) return; se.splice(slot, 1); break;
      case 'hidden': if (!e) return; flag(e, 'h', !e.h); break;
      case 'key': if (!e) return; flag(e, 'k', !e.k); break;
      default: return ctx.toast?.('Công cụ này dùng cho xe trong bãi');
    }
    changed();
  }

  function lotClick(ci, ui) {
    if (!st.editable) return;
    const raw = ensure(st.level), cols = lotOf(raw), col = cols[ci];
    if (!col) return;
    const u = col.units[ui];
    switch (st.tool) {
      case 'paint':
        if (u) { u.co = CODES.indexOf(st.color) + 1; break; }
        col.units.push({ co: CODES.indexOf(st.color) + 1, p: { x: col.x, y: 0 } });
        raw.ui.u.push(col.units.at(-1));
        renumberColumn(raw, col.x, col.units);
        break;
      case 'erase': {
        if (!u) return;
        dropLinksTo(raw, pOf(u));
        raw.ui.u.splice(raw.ui.u.indexOf(u), 1);
        col.units.splice(ui, 1);
        renumberColumn(raw, col.x, col.units);
        syncColumns(raw);
        break;
      }
      case 'hidden': if (!u) return; flag(u, 'h', !u.h); break;
      case 'box': if (!u) return; flag(u, 'l', !u.l); if (u.l) num(u, 'sg', 0); break;
      case 'gen': if (!u) return; num(u, 'sg', u.sg > 0 ? 0 : 1); if (u.sg) flag(u, 'l', false); break;
      case 'link': {
        if (!u) return;
        const p = pOf(u);
        if (!st.linkFrom) {
          if (cnOf(u) && (u.cn.x >= 0)) { delete u.cn; break; }
          st.linkFrom = p; draw(); return;
        }
        const a = st.linkFrom;
        st.linkFrom = null;
        if (a.x === p.x && a.y === p.y) { draw(); return; }
        const from = raw.ui.u.find(o => pOf(o).x === a.x && pOf(o).y === a.y);
        if (from) from.cn = { x: p.x, y: p.y };
        break;
      }
      default: return ctx.toast?.('Công cụ này dùng cho xe trong làn');
    }
    changed();
  }

  function addLane() {
    const raw = ensure(st.level), row = raw.pf.sd.filter(s => pOf(s).y === 0);
    const x = row.length ? Math.max(...row.map(s => pOf(s).x)) + 1 : 0;
    raw.pf.sd.push(x ? { p: { x, y: 0 }, se: [] } : { se: [] });
    st.lane = lanesOf(raw).length - 1;
    changed();
  }

  function laneOp(op) {
    const raw = ensure(st.level), lanes = lanesOf(raw), lane = lanes[st.lane];
    if (!lane) return;
    if (op === 'del') {
      raw.pf.sd.splice(raw.pf.sd.indexOf(lane), 1);
      const row = lanesOf(raw).filter(s => pOf(s).y === pOf(lane).y);
      row.forEach((s, i) => setP(s, { x: i, y: pOf(lane).y }));
      st.lane = -1;
    } else {
      const other = lanes[st.lane + (op === 'left' ? -1 : 1)];
      if (!other) return;
      const a = pOf(lane), b = pOf(other);
      setP(lane, b); setP(other, a);
      st.lane += op === 'left' ? -1 : 1;
    }
    changed();
  }

  function laneProp(key, value) {
    const raw = ensure(st.level), lane = lanesOf(raw)[st.lane];
    if (!lane) return;
    const sot = new Set(Array.isArray(lane.sot) ? lane.sot : []);
    const setSot = (o, on) => { if (on) sot.add(o); else sot.delete(o); };
    if (key === 'lock') { num(lane, 'lc', value); num(lane, 't', value ? 1 : 0); }
    if (key === 'barrier') setSot(OBSTACLE.Barrier, value);
    if (key === 'colored') setSot(OBSTACLE.ColoredLane, value);
    if (key === 'ice') { setSot(OBSTACLE.IcedLane, value > 0); num(lane, 'ic', value); }
    if (key === 'curC' || key === 'curN') {
      const cd = isObj(lane.cd) ? lane.cd : {};
      if (key === 'curC') num(cd, 'coc', value); else num(cd, 'v', value);
      if (cd.coc || cd.v) lane.cd = cd; else delete lane.cd;
      setSot(OBSTACLE.Curtain, !!(cd.coc && cd.v));
    }
    if (sot.size) lane.sot = [...sot].sort((a, b) => a - b); else if ('sot' in lane) lane.sot = [];
    changed();
  }

  function addColumn() {
    const raw = ensure(st.level), cols = lotOf(raw);
    const x = cols.length ? Math.max(...cols.map(c => c.x)) + 1 : 0;
    raw.ui.u.push({ co: CODES.indexOf(st.color) + 1, p: { x, y: 0 } });
    syncColumns(raw);
    changed();
  }

  // ---------- vẽ editor ----------
  function drawEdit() {
    const raw = st.level;
    if (!isObj(raw) || !isObj(raw.pf) || !Array.isArray(raw.pf.sd)) return '<p class="muted">Raw không có pf.sd — sửa ở tab JSON.</p>';
    ensure(raw);
    const n = normalize(raw), cp = Math.max(1, n.pf.cp), lanes = lanesOf(raw), cols = lotOf(raw);
    const conv = tryConvert(raw).level;
    const ed = st.editable;
    let h = '';
    if (ed) {
      h += '<div class="pl-tools">';
      h += TOOLS.map(([id, icon, tip]) => `<button class="pl-tool${st.tool === id ? ' on' : ''}" data-tool="${id}" title="${esc(tip)}">${icon}</button>`).join('');
      h += '<span class="pl-sep"></span>';
      h += [...CODES].map((ch, i) => `<button class="pl-swatch${st.color === ch ? ' on' : ''}" data-color="${ch}" title="${i + 1} ${esc(COLOR_VN[i + 1])}" style="--c:${COLOR_HEX[i + 1]}"><span>${i + 1}</span></button>`).join('');
      h += '</div>';
    }
    if (conv) {
      // Ảnh bàn chơi vẽ như game (playview.mjs); bấm ô làn / xe bãi để sửa, bấm đầu làn (sát đường trên) để chọn làn.
      h += `<div class="pl-preview"><canvas class="pl-edit-canvas"></canvas>
        ${ed ? '<div class="pl-preview-btns"><button data-act="addlane" title="Thêm làn">＋ Làn</button><button data-act="addcol" title="Thêm cột bãi">＋ Cột bãi</button></div>' : ''}
        <div class="pl-loopinfo">Vòng: <b>${conv.loop}</b> chỗ${n.pf.tl ? '' : ' (mặc định)'}${ed ? ' · chuột phải = bật / tắt xe ẩn · bấm đầu làn để sửa vật cản' : ''}</div></div>`;
      h += lanePanel(lanes);
      h += statsPanel(raw, conv);
      return h;
    }
    // làn: ô trên = xe vào sau cùng (đỉnh làn, sát vòng trên); dưới = se[0] (ra trước)
    h += `<div class="pl-board"><div class="pl-ring"><div class="pl-lanes" style="--w:${lanes.length}">`;
    lanes.forEach((lane, li) => {
      const s = normalize({ pf: { sd: [lane], cp }, ui: {} }).pf.sd[0];
      const sel = st.lane === li ? ' sel' : '';
      const tags = [];
      if (s.t === 1 || s.lc) tags.push(`<i class="pl-tag lock" style="--c:${COLOR_HEX[s.lc] || '#999'}" title="Khoá: mở khi xoá làn màu ${esc(COLOR_VN[s.lc] || '?')}">🔒</i>`);
      if (s.sot.includes(OBSTACLE.Barrier)) tags.push('<i class="pl-tag" title="Rào: đóng sau lần xoá đầu">🚧</i>');
      if (s.sot.includes(OBSTACLE.ColoredLane)) tags.push(`<i class="pl-tag" title="Làn màu: chỉ nhận màu xe trên cùng">🎨</i>`);
      if (s.ic > 0) tags.push(`<i class="pl-tag" title="Băng: tan sau ${s.ic} lần xoá làn khác">❄${s.ic}</i>`);
      if (s.cd.v > 0) tags.push(`<i class="pl-tag" style="--c:${COLOR_HEX[s.cd.coc]}" title="Rèm: cần ${s.cd.v} vật màu ${esc(COLOR_VN[s.cd.coc] || '?')}">▤${s.cd.v}</i>`);
      if (s.elv.length) tags.push(`<i class="pl-tag" title="Thang máy nhóm ${s.elid}: ${s.elv.length} tầng chờ (sửa ở JSON)">⇧${s.elv.length}</i>`);
      h += `<div class="pl-lane${sel}" data-lane="${li}"><div class="pl-lane-head" data-lanehead="${li}" title="Chọn làn ${li + 1}">${li + 1}${tags.join('')}</div>`;
      for (let slot = cp - 1; slot >= 0; slot--) {
        const e = s.se[slot];
        h += cell(e, `data-lane="${li}" data-slot="${slot}"`);
      }
      if (s.se.length > cp) h += `<div class="pl-over" title="Xe vượt cp bị game bỏ">+${s.se.length - cp}</div>`;
      h += '</div>';
    });
    if (ed) h += '<button class="pl-add" data-act="addlane" title="Thêm làn">＋</button>';
    h += '</div></div>';
    h += `<div class="pl-loopinfo">Vòng: <b>${conv ? conv.loop : n.pf.tl || DEFAULT_LOOP}</b> chỗ${n.pf.tl ? '' : ' (mặc định)'} · ↓ cửa vào vòng ↓</div>`;
    // bãi: cột, hàng trên = sát đường (ra trước)
    h += `<div class="pl-lot">`;
    const posKey = u => `${pOf(u).x},${pOf(u).y}`;
    cols.forEach((col, ci) => {
      h += `<div class="pl-col"><div class="pl-col-head">${ci + 1}</div>`;
      col.units.forEach((u, ui) => {
        const cn = cnOf(u), from = st.linkFrom && st.linkFrom.x === pOf(u).x && st.linkFrom.y === pOf(u).y;
        const extra = [];
        if (u.l) extra.push('box');
        if (u.sg > 0) extra.push('gen');
        if (cn && cn.x >= 0 && cn.y >= 0) extra.push('linked');
        if (from) extra.push('linkfrom');
        h += unit(u, `data-col="${ci}" data-unit="${ui}" title="(${esc(posKey(u))})${cn && cn.x >= 0 ? ` nối → (${cn.x},${cn.y})` : ''}"`, extra);
      });
      if (ed) h += `<button class="pl-cell pl-addunit" data-col="${ci}" data-unit="${col.units.length}" title="Thêm xe cuối cột">＋</button>`;
      h += '</div>';
    });
    if (ed) h += '<button class="pl-add" data-act="addcol" title="Thêm cột bãi">＋</button>';
    h += '</div></div>';
    h += lanePanel(lanes);
    h += statsPanel(raw, conv);
    return h;
  }

  function cell(e, attrs) {
    if (!e || !e.c) return `<button class="pl-cell empty" ${attrs}></button>`;
    const ch = colorOf(e.c);
    return `<button class="pl-cell${e.h ? ' hid' : ''}${DARK_TEXT.has(ch) ? ' dark' : ''}" ${attrs} style="--c:${hexOf(ch)}">${e.h ? '?' : ''}${e.k ? '🔑' : ''}${e.coc ? `<i class="pl-obj" style="--c:${COLOR_HEX[e.coc]}"></i>` : ''}</button>`;
  }

  function unit(u, attrs, extra) {
    const ch = colorOf(u.co) || 'R';
    const cls = ['pl-cell', 'unit', ...extra];
    if (u.h && !u.l) cls.push('hid');
    if (DARK_TEXT.has(ch)) cls.push('dark');
    const label = u.l ? '🔒' : u.sg > 0 ? '⚙' : u.h ? '?' : '';
    return `<button class="${cls.join(' ')}" ${attrs} style="--c:${u.l ? '#c8a050' : u.sg > 0 ? '#2d3046' : hexOf(ch)}">${label}${u.coc ? `<i class="pl-obj" style="--c:${COLOR_HEX[u.coc]}"></i>` : ''}</button>`;
  }

  function lanePanel(lanes) {
    const lane = lanes[st.lane];
    if (!lane) return st.editable ? '<div class="pl-panel muted small">Bấm số trên đầu làn để sửa vật cản của làn.</div>' : '';
    const s = normalize({ pf: { sd: [lane] }, ui: {} }).pf.sd[0], dis = st.editable ? '' : ' disabled';
    const colorSel = (name, v) => `<select data-prop="${name}"${dis}><option value="0">—</option>${[...CODES].map((ch, i) => `<option value="${i + 1}"${v === i + 1 ? ' selected' : ''}>${i + 1} ${esc(COLOR_VN[i + 1])}</option>`).join('')}</select>`;
    return `<div class="pl-panel"><b>Làn ${st.lane + 1}</b> <span class="muted small">p=(${s.p.x},${s.p.y})</span>
      <label>Khoá màu ${colorSel('lock', s.lc)}</label>
      <label><input type="checkbox" data-prop="barrier"${s.sot.includes(OBSTACLE.Barrier) ? ' checked' : ''}${dis}> Rào</label>
      <label><input type="checkbox" data-prop="colored"${s.sot.includes(OBSTACLE.ColoredLane) ? ' checked' : ''}${dis}> Làn màu</label>
      <label>Băng <input type="number" min="0" max="99" value="${s.ic}" data-prop="ice"${dis}></label>
      <label>Rèm ${colorSel('curC', s.cd.coc)} × <input type="number" min="0" max="99" value="${s.cd.v}" data-prop="curN"${dis}></label>
      ${st.editable ? '<span class="pl-btns"><button data-act="left" title="Dời trái">◀</button><button data-act="right" title="Dời phải">▶</button><button data-act="dellane" class="danger" title="Xoá làn">Xoá làn</button></span>' : ''}</div>`;
  }

  function statsPanel(raw, conv) {
    const sm = levelSummary(raw);
    const count = new Map();
    if (conv) {
      const notCars = new Set(conv.lotUnits.filter(u => u.box || u.gen).map(u => `${u.col},${u.i}`));
      for (const row of conv.grid) for (const ch of row) if (ch !== '.') count.set(ch.toUpperCase(), (count.get(ch.toUpperCase()) || 0) + 1);
      conv.lot.forEach((col, x) => [...col].forEach((ch, i) => { if (!notCars.has(`${x},${i}`)) count.set(ch.toUpperCase(), (count.get(ch.toUpperCase()) || 0) + 1); }));
      for (const e of conv.elevators) for (const s of e.levels) for (const ch of s) count.set(ch.toUpperCase(), (count.get(ch.toUpperCase()) || 0) + 1);
    }
    const H = conv ? conv.grid.length : 1;
    const chips = [...count].sort((a, b) => CODES.indexOf(a[0]) - CODES.indexOf(b[0]))
      .map(([ch, k]) => `<span class="pl-count${k % H ? ' bad' : ''}" title="${k % H ? `không chia hết cho ${H}` : ''}"><i style="--c:${hexOf(ch)}"></i>${k}</span>`).join('');
    return `<div class="pl-stats">${chips}<span class="muted small">${sm.cars} xe · ${sm.colors} màu · ${esc(mechanicsOf(raw).join(', ') || 'không vật cản')}</span></div>`;
  }

  // ───────────────────────────── chơi thử ─────────────────────────────

  const TICK_MS = 128;   // config.tick 0.16 s / timeScale 1.25 của bản Unity

  function startPlay() {
    const { level: lv, error } = tryConvert(st.level);
    if (!lv) { ctx.toast?.(`Không chơi được: ${error}`); st.mode = 'edit'; return draw(); }
    stopPlay();
    const m = new ParkingModel(lv);
    const view = new PlayView();
    view.level = Number(ctx.name) || 0;
    view.reset(m);
    st.play = {
      lv, m, history: [], speed: st.play?.speed || 1, paused: false, armed: null, res: null,
      t0: performance.now(), last: performance.now(), acc: 0, taps: 0, boosters: 0, log: [], auto: null, raf: 0, rec: null,
      view, showLog: st.play?.showLog ?? false,
    };
    root.classList.toggle('pl-focus', focusPref());
    loadArt().then(() => { if (st.play?.view === view) { view.board = null; paint(); } });
    sound.preload();
    snapshot();
    record('start');
    draw();
    loop();
  }

  function stopPlay() {
    if (st.play) {
      cancelAnimationFrame(st.play.raf);
      if (st.play.rec && st.play.m?.state === 'play') st.play.rec.end({ result: 'quit', summary: playSummary() });
    }
  }

  function playSummary() {
    const p = st.play;
    return { taps: p.taps, boosters: p.boosters, ticks: p.m.ticks, carsLeft: p.m.carsLeft(), cap: p.m.cap };
  }

  async function record(what, e) {
    const p = st.play;
    if (!p) return;
    try {
      if (what === 'start') {
        const [{ PlayRecorder }, { authHeaders }] = await Promise.all([import('/app/js/playrecorder.mjs'), import('/app/js/api.mjs')]);
        if (st.play !== p) return;
        p.rec = new PlayRecorder('/api', authHeaders);
        p.rec.start({ pack: ctx.pack, level: String(ctx.name ?? ''), source: 'draft', level_data: structuredClone(st.level), build: 'web-sim' });
      } else if (what === 'event') p.rec?.event(e);
      else if (what === 'cheat') p.rec?.markCheat();
      else if (what === 'end') p.rec?.end({ result: e, summary: playSummary() });
    } catch { /* ghi lượt chơi lỗi (server Python, mất mạng): vẫn chơi bình thường */ }
  }

  function snapshot() { const p = st.play; p.history.push({ m: p.m.clone(), transits: p.view.transitState() }); if (p.history.length > 200) p.history.shift(); }

  function step() { st.play.m.tick(); drain(); }

  function drain() {
    const p = st.play, m = p.m;
    if (!m.events.length) return;
    const say = {
      clear: e => `Xoá làn ${e.col + 1} (${e.c})`, unlock: e => `Mở khoá làn ${e.col + 1}`, thaw: e => (e.left ? '' : `Băng làn ${e.col + 1} tan`),
      barrier: e => `Rào đóng làn ${e.col + 1}`, key: () => 'Nhả chìa khoá', unbox: () => 'Mở hộp khoá', curtain: e => (e.left ? '' : `Rèm làn ${e.col + 1} mở`),
      rise: e => `Thang máy làn ${e.col + 1} lên`, emit: () => 'Máy phát nhả xe', won: () => 'THẮNG', lost: () => 'THUA', objLost: () => 'Vật rèm bị mất',
    };
    const events = m.events;
    m.events = [];
    p.view.onEvents(events, m);
    for (const e of events) {
      const text = say[e.t]?.(e);
      if (text) p.log.unshift(`${m.ticks}: ${text}`);
      if (['clear', 'unlock', 'barrier', 'key', 'unbox', 'rise', 'won', 'lost'].includes(e.t)) record('event', { type: e.t, col: e.col, c: e.c, tick: m.ticks });
      if (e.t === 'won' || e.t === 'lost') record('end', e.t === 'won' ? 'win' : 'lose');
    }
    p.log.length = Math.min(p.log.length, 40);
  }

  function tapUnit(id) {
    const p = st.play, m = p.m;
    if (m.state !== 'play') return;
    if (p.armed === 'hand') {
      snapshot();
      const r = m.pushOut(id);
      p.view.tapped(m, id, r);
      if (r.r !== 'released') { p.history.pop(); return flash(r.r, { ...r, bus: id }); }
      p.armed = null; p.boosters++; record('cheat');
      return sendCars(r);
    }
    const before = m.clone(), transits = p.view.transitState();
    const r = m.tap(id);
    p.view.tapped(m, id, r);
    if (r.r !== 'released') return flash(r.r, { ...r, bus: id });
    p.history.push({ m: before, transits });
    p.taps++;
    record('event', { type: 'tap', col: before.buses[id].x, c: before.buses[id].c, tick: m.ticks });
    sendCars(r);
  }

  function sendCars(r) {
    const p = st.play, m = p.m;
    p.view.startTransit(m, r.bus, r.car);
    (r.extraBus || []).forEach((b, k) => p.view.startTransit(m, b, r.extra[k]));
    drain();
    hud();
  }

  function flash(r, res) {
    const p = st.play;
    const msg = { blocked: 'Xe phía trước chặn', noroom: 'Vòng hết chỗ', locked: 'Không bấm được (hộp khoá / máy phát / đang chờ)', linked: 'Nhóm nối chưa ra được', frozen: 'Đang đóng băng', empty: 'Làn trống', clearing: 'Làn đang xoá' }[r] || r;
    p.log.unshift(`${p.m.ticks}: ✗ ${msg}`);
    p.res = res || null;
    if (!res) { sound.play('bump'); p.view.showToast(msg, 1.5); }
    hud();
  }

  function booster(kind) {
    const p = st.play, m = p.m;
    if (kind === 'undo') {
      const h = p.history.pop();
      if (h) { p.m = h.m.clone(); p.acc = 0; p.view.reset(p.m, h.transits, false); record('cheat'); }
      return hud();
    }
    if (kind === 'loop') {
      if (m.state === 'lost') { if (!m.canReviveHelp(1)) return flash('Hồi sinh không cứu được'); m.revive(1); }
      else { m.addLoop(1); p.view.showPopup('+1 Loop', '#8cd9ff', 0.9); p.view.signFlash = 0.6; p.view.signColor = 'blue'; }
      p.boosters++; record('cheat'); drain(); return hud();
    }
    if (kind === 'shuffle') { snapshot(); const n = m.shuffleLot(); if (!n) { p.history.pop(); return flash('Không có gì để xáo'); } p.boosters++; record('cheat'); drain(); return hud(); }
    p.armed = p.armed === kind ? null : kind;
    hud();
  }

  function loop() {
    const p = st.play;
    if (!p || st.mode !== 'play') return;
    const now = performance.now();
    const dt = p.paused ? 0 : Math.min(0.05, (now - p.last) / 1000) * p.speed;
    p.last = now;
    const m = p.m, tickMs = TICK_MS / (p.view.endgame ? 1.4 : 1);
    // Như game: băng chuyền dừng khi booster đang chờ chọn mục tiêu.
    if (dt > 0 && m.state === 'play' && !p.armed) {
      p.acc += dt * 1000;
      let n = 0;
      while (p.acc >= tickMs && n++ < 20) { p.acc -= tickMs; step(); if (p.m.state !== 'play') break; }
    }
    const arrived = p.view.update(dt, p.m, Math.min(1, p.acc / tickMs), dt > 0);
    for (const car of arrived) { p.m.deliver(car); drain(); }
    autoTap();
    paint();
    if ((p.hudAt || 0) + 200 < now) hud();
    p.raf = requestAnimationFrame(loop);
  }

  /** Xem lời giải: bấm xe kế tiếp khi vòng đã đứng yên (như solver). */
  function autoTap() {
    const p = st.play;
    if (!p.auto || p.m.state !== 'play' || p.view.transits.length || !p.m.isSettled()) return;
    const id = p.auto.shift();
    if (id === undefined) { p.auto = null; return; }
    tapUnit(id);
  }

  // ---------- màn chơi: thanh điều khiển, HUD, canvas giữa màn hình, booster ----------
  function playHtml() {
    const p = st.play;
    const b = (id, label, tip, on = false) => `<button data-play="${id}" title="${esc(tip)}"${on ? ' class="on"' : ''}>${label}</button>`;
    const boost = (id, icon, label, tip) => `<button class="pl-boost${p.armed === id ? ' on' : ''}" data-play="${id}" title="${esc(tip)}">
        <img src="${artUrl('btn_blue.png')}" alt="" class="pl-boost-bg"><img src="${artUrl(icon)}" alt="" class="pl-boost-icon"><span>${label}</span></button>`;
    return `<div class="pl-stage">
        <div class="pl-playbar">
          ${b('restart', '↺ Chơi lại', 'Chơi lại từ đầu')}${b('pause', p.paused ? '▶' : '❚❚', 'Dừng / chạy')}${b('step', '⏭', 'Một tick')}
          ${b('speed', `${p.speed}×`, 'Tốc độ')}${b('undo', '↶ Hoàn tác', 'Về trước lần bấm cuối (tính là cheat)')}
          <span class="pl-sep"></span>
          ${b('sound', sound.on ? '🔊' : '🔈', 'Bật / tắt âm thanh')}${b('log', '☰ Diễn biến', 'Hiện / ẩn diễn biến ván chơi', p.showLog)}
          ${b('focus', root.classList.contains('pl-focus') ? '✕ Thu nhỏ' : '⛶ Toàn màn hình', 'Chơi thử toàn màn hình (Esc để thoát)')}
        </div>
        <div class="pl-hud"></div>
        <div class="pl-canvas-wrap"><canvas class="pl-canvas"></canvas><ol class="pl-log"${p.showLog ? '' : ' hidden'}></ol></div>
        <div class="pl-boosters">
          ${boost('loop', 'boost_loop.png', '+1 chỗ', 'Booster: thêm 1 chỗ trên vòng / hồi sinh')}
          ${boost('shuffle', 'boost_shuffle.png', 'Xáo', 'Booster: xáo xe 6 hàng đầu bãi')}
          ${boost('hand', 'boost_hand.png', 'Tay', 'Booster: bấm bất kỳ xe nào trong bãi')}
          ${boost('hammer', 'boost_hammer.png', 'Búa', 'Booster: đẩy xe đáy của một làn ra')}
        </div>
      </div>`;
  }

  function hud() {
    const p = st.play, el = root.querySelector('.pl-hud');
    if (!p || !el) return;
    p.hudAt = performance.now();
    const m = p.m, lt = normalize(st.level).lt;
    const secs = m.ticks * TICK_MS / 1000;
    const html = `<span class="pl-hud-lv">Level ${esc(ctx.name ?? '')}</span>
      <span class="pl-hud-item" title="Xe còn lại">🚗 ${m.carsLeft()}</span>
      <span class="pl-hud-item" title="Số lần bấm${p.boosters ? ' · booster' : ''}">👆 ${p.taps}${p.boosters ? ` · ⚡${p.boosters}` : ''}</span>
      <span class="pl-hud-item${lt && secs > lt ? ' over' : ''}" title="Thời gian${lt ? ` / giới hạn ${lt} s` : ''}">⏱ ${secs.toFixed(1)}${lt ? `/${lt}` : ''} s</span>
      ${p.armed ? `<span class="pl-armed">${p.armed === 'hand' ? '✋ Bấm một xe trong bãi' : '🔨 Bấm một làn'}</span>` : ''}${p.auto && m.state === 'play' ? '<span class="pl-armed">▶ Đang chạy lời giải</span>' : ''}`;
    if (el.innerHTML !== html) el.innerHTML = html;
    root.querySelectorAll('.pl-boost').forEach(bt => bt.classList.toggle('on', bt.dataset.play === p.armed));
    const log = root.querySelector('.pl-log');
    if (log && p.showLog) { const lh = p.log.slice(0, 30).map(t => `<li>${esc(t)}</li>`).join(''); if (log.innerHTML !== lh) log.innerHTML = lh; }
  }

  function paint() {
    const p = st.play;
    if (!p || st.mode !== 'play') return;
    const cv = root.querySelector('.pl-canvas'), wrap = root.querySelector('.pl-canvas-wrap');
    if (!cv || !wrap) return;
    const m = p.m, view = p.view, dpr = window.devicePixelRatio || 1;
    const g = view.fit(m, Math.max(240, wrap.clientWidth - 8), Math.max(300, wrap.clientHeight - 8));
    if (cv.width !== Math.round(g.W * dpr) || cv.height !== Math.round(g.H * dpr)) {
      cv.width = Math.round(g.W * dpr); cv.height = Math.round(g.H * dpr);
      cv.style.width = `${g.W}px`; cv.style.height = `${g.H}px`;
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const secs = m.ticks * TICK_MS / 1000;
    const summary = m.state === 'won' ? `${p.taps} lần bấm · ${secs.toFixed(1)} s${p.boosters ? ` · ${p.boosters} booster` : ''}`
      : m.state === 'lost' ? (m.canReviveHelp(1) ? 'Bấm “+1 chỗ” để hồi sinh' : 'Hồi sinh không cứu được') : '';
    cv._hit = view.paint(c, m, { dpr, hint: p.auto?.length ? p.auto[0] : null, summary });
  }

  function canvasClick(ev) {
    const cv = ev.currentTarget, hit = cv._hit, p = st.play;
    if (!hit || !p) return;
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    sound.ctx();
    if (p.armed === 'hammer') {
      const lane = hit.lanes.findIndex(([[tx, ty], [, by]]) => Math.abs(x - tx) < hit.s / 2 && y > ty && y < by);
      if (lane < 0) return;
      snapshot();
      const res = p.m.hammerLane(lane);
      if (res.r !== 'released') { p.history.pop(); return flash(res.r); }
      p.armed = null; p.boosters++; record('cheat'); drain(); return hud();
    }
    let best = null, bd = Infinity;
    for (const u of hit.ids) {
      const dx = (x - u[1]) / hit.rx, dy = (y - u[2]) / hit.ry, d = dx * dx + dy * dy;
      if (d < 1 && d < bd) { bd = d; best = u; }
    }
    if (best) { p.auto = null; sound.play('tap', 0.4); tapUnit(best[0]); }
  }

  // ---------- ảnh bàn chơi của Editor: vẽ như game, bấm để sửa ----------
  function paintEdit() {
    const cv = root.querySelector('.pl-edit-canvas');
    if (!cv || st.mode !== 'edit') return;
    const conv = tryConvert(st.level).level;
    if (!conv) return;
    const m = new ParkingModel(conv);
    const view = st.editView ??= new PlayView();
    view.reset(m, [], false);
    const dpr = window.devicePixelRatio || 1, rows = m.jh + 0.4;
    const b = view.L.boardBounds(rows), bw = Math.max(b.x1, m.W + 1.4) - b.x0 + 0.6, bh = ((b.z1 - b.z0) * SIN + 0.3 * COS) / 0.92;
    const maxH = Math.max(380, window.innerHeight - cv.getBoundingClientRect().top - 110);
    const W = Math.floor(Math.min(560, Math.max(240, cv.parentElement.clientWidth - 4), maxH * bw / bh));
    const H = Math.ceil(W / bw * bh);
    const g = view.fit(m, W, H, { rows, wide: true, topPad: 0.04, botPad: 0.04 });
    if (cv.width !== Math.round(g.W * dpr) || cv.height !== Math.round(g.H * dpr)) {
      cv.width = Math.round(g.W * dpr); cv.height = Math.round(g.H * dpr);
      cv.style.width = `${g.W}px`; cv.style.height = `${g.H}px`;
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.paint(c, m, { dpr, edit: { lane: st.lane, linkFrom: st.linkFrom, slots: st.editable } });
    cv._edit = { view, m };
  }

  function editClick(ev, right = false) {
    const cv = ev.currentTarget, e = cv._edit;
    if (!e) return;
    const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const { view, m } = e, v = view.v, L = view.L;
    const wx = (sx - v.ox) / v.s, wz = (v.oy - sy) / (v.s * SIN) - 0.3 * COS / SIN;   // mặt trên xe (cao ~0.3)
    const run = fn => { if (!right) return fn(); const tool = st.tool; st.tool = 'hidden'; try { fn(); } finally { st.tool = tool; } return undefined; };
    const ci = Math.floor((wx - L.jamLeftX) / L.jc), row = Math.floor((L.jamTopZ - wz) / L.jc);
    if (ci >= 0 && ci < m.jw && row >= 0 && wz < L.lotTopZ) return run(() => lotClick(ci, row));
    const x = Math.round(wx);
    if (x < 0 || x >= m.W || Math.abs(wx - x) > 0.5) return undefined;
    if (wz > m.H - 0.5 && wz < m.H + 0.7) { if (!right) { st.lane = st.lane === x ? -1 : x; draw(); } return undefined; }
    const slot = Math.round(wz - (m.H - m.hs[x]));
    if (slot >= 0 && slot < m.hs[x]) return run(() => laneClick(x, slot));
    return undefined;
  }

  // Chơi thử mặc định phủ cả cửa sổ, bàn chơi ở giữa màn hình; ✕ Thu nhỏ về lại tab Editor (nhớ theo trình duyệt).
  const focusPref = () => { try { return localStorage.getItem('parkinglevel.focus') !== '0'; } catch { return true; } };
  function setFocus(on) {
    try { localStorage.setItem('parkinglevel.focus', on ? '1' : '0'); } catch { /* không lưu được */ }
    root.classList.toggle('pl-focus', on);
    if (st.mode === 'play') draw();
  }

  // ───────────────────────────── giải ─────────────────────────────

  function solve() {
    st.worker?.terminate();
    st.solve = { running: true, states: 0 };
    let w;
    try { w = new Worker(new URL('./solver_worker.mjs', import.meta.url), { type: 'module' }); } catch (e) { st.solve = { report: { verdict: 'Invalid', detail: e.message } }; return draw(); }
    st.worker = w;
    w.onmessage = e => {
      if (e.data.progress) { st.solve.states = e.data.progress; const el = root.querySelector('.pl-solve'); if (el) el.innerHTML = solveHtml(); return; }
      st.solve = { report: e.data.done };
      w.terminate(); st.worker = null;
      draw();
    };
    w.onerror = e => { st.solve = { report: { verdict: 'Invalid', detail: e.message || 'worker lỗi' } }; draw(); };
    w.postMessage({ raw: structuredClone(st.level), maxStates: 300000 });
    draw();
  }

  function solveHtml() {
    const s = st.solve;
    if (!s) return '<span class="muted small">Giải: thử mọi thứ tự bấm (bấm rồi chờ vòng đứng yên), như Check Solvable của Unity.</span>';
    if (s.running) return `<span>⏳ Đang giải… ${s.states.toLocaleString()} trạng thái</span> <button data-act="solvestop">Dừng</button>`;
    const r = s.report, cls = { Solvable: 'ok', Unknown: 'warn' }[r.verdict] || 'err';
    const vn = { Solvable: 'Giải được', Impossible: 'Không thể (đếm màu)', Unsolvable: 'Không giải được', Unknown: 'Chưa rõ', Invalid: 'Lỗi level' }[r.verdict];
    return `<span class="chip ${cls}">${vn}</span> ${r.verdict === 'Solvable' ? `${r.taps.length} lần bấm <span class="muted small">(${r.states} trạng thái)</span> <button data-act="watch">▶ Xem lời giải</button><div class="pl-taps small" title="cột:màu theo thứ tự bấm">${esc(r.tapOrder)}</div>` : `<span class="small">${esc(r.detail || '')}</span>`}`;
  }

  // ───────────────────────────── khung chung ─────────────────────────────

  function draw() {
    const tabs = `<div class="pl-modes">
      <button data-mode="edit" class="${st.mode === 'edit' ? 'on' : ''}">✎ Bàn chơi</button>
      <button data-mode="play" class="${st.mode === 'play' ? 'on' : ''}" title="Chơi thử ngay trong tool bằng luật của game (phím R)">▶ Chơi thử</button>
      <span class="pl-solve">${solveHtml()}</span>${st.solve?.running ? '' : '<button data-act="solve" title="Tìm thứ tự bấm thắng được (phím K)">🧠 Giải</button>'}</div>`;
    root.classList.toggle('pl-play-mode', st.mode === 'play');
    root.innerHTML = tabs + (st.mode === 'play' && st.play ? playHtml() : `<div class="pl-edit">${drawEdit()}</div>`);
    if (st.mode === 'play') {
      const cv = root.querySelector('.pl-canvas');
      cv?.addEventListener('click', canvasClick);
      paint();
      hud();
    } else {
      root.classList.remove('pl-focus');
      const ecv = root.querySelector('.pl-edit-canvas');
      if (ecv) {
        ecv.addEventListener('click', ev => editClick(ev));
        ecv.addEventListener('contextmenu', ev => { ev.preventDefault(); if (st.editable) editClick(ev, true); });
        paintEdit();
        loadArt().then(() => { if (st.editView) st.editView.board = null; paintEdit(); });
      }
    }
  }

  root.addEventListener('click', ev => {
    const t = ev.target.closest('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.mode) {
      if (d.mode === st.mode) return;
      st.mode = d.mode;
      if (st.mode === 'play') startPlay(); else { stopPlay(); st.play = null; draw(); }
      return;
    }
    if (d.tool) { st.tool = d.tool; st.linkFrom = null; return draw(); }
    if (d.color) { st.color = d.color; if (!['paint'].includes(st.tool)) st.tool = 'paint'; return draw(); }
    if (d.lanehead !== undefined) { st.lane = st.lane === +d.lanehead ? -1 : +d.lanehead; return draw(); }
    if (d.slot !== undefined) return laneClick(+d.lane, +d.slot);
    if (d.unit !== undefined) return lotClick(+d.col, +d.unit);
    if (d.play) {
      const p = st.play;
      if (d.play === 'restart') { stopPlay(); st.play = { speed: p.speed, showLog: p.showLog }; return startPlay(); }
      if (d.play === 'sound') { sound.on = !sound.on; if (sound.on) { sound.preload(); sound.play('click'); } return draw(); }
      if (d.play === 'log') { p.showLog = !p.showLog; return draw(); }
      if (d.play === 'focus') return setFocus(!root.classList.contains('pl-focus'));
      if (d.play === 'pause') { p.paused = !p.paused; return draw(); }
      if (d.play === 'step') { p.paused = true; step(); return draw(); }
      if (d.play === 'speed') { p.speed = { 1: 2, 2: 4, 4: 0.5, 0.5: 1 }[p.speed] || 1; return draw(); }
      if (['loop', 'shuffle', 'hand', 'hammer'].includes(d.play)) sound.play('click', 0.4);
      booster(d.play);
      return d.play === 'undo' ? draw() : undefined;
    }
    if (d.act === 'addlane') return addLane();
    if (d.act === 'addcol') return addColumn();
    if (['left', 'right', 'dellane'].includes(d.act)) return laneOp(d.act === 'dellane' ? 'del' : d.act);
    if (d.act === 'solve') return solve();
    if (d.act === 'solvestop') { st.worker?.terminate(); st.worker = null; st.solve = null; return draw(); }
    if (d.act === 'watch') {
      const taps = st.solve?.report?.taps;
      st.mode = 'play'; stopPlay(); st.play = null; startPlay();
      if (st.play && taps) st.play.auto = taps.slice();
      return draw();
    }
  });

  root.addEventListener('change', ev => {
    const t = ev.target, prop = t.dataset?.prop;
    if (!prop || !st.editable) return;
    const v = t.type === 'checkbox' ? t.checked : Math.max(0, parseInt(t.value, 10) || 0);
    laneProp(prop, v);
  });

  root.addEventListener('contextmenu', ev => {   // chuột phải = bật / tắt ẩn
    const t = ev.target.closest('button.pl-cell');
    if (!t || !st.editable || st.mode !== 'edit') return;
    ev.preventDefault();
    const tool = st.tool;
    st.tool = 'hidden';
    if (t.dataset.slot !== undefined) laneClick(+t.dataset.lane, +t.dataset.slot); else if (t.dataset.unit !== undefined) lotClick(+t.dataset.col, +t.dataset.unit);
    st.tool = tool;
    draw();
  });

  const ro = new ResizeObserver(() => { if (st.mode === 'play') paint(); else paintEdit(); });
  ro.observe(ctx.el);
  const onKey = ev => { if (ev.key === 'Escape' && root.classList.contains('pl-focus')) { ev.stopPropagation(); setFocus(false); } };
  document.addEventListener('keydown', onKey, true);
  current = {
    toggleMode: () => root.querySelector(`[data-mode="${st.mode === 'play' ? 'edit' : 'play'}"]`)?.click(),
    solve: () => { if (!st.solve?.running) solve(); },
    shiftColor: d => { if (st.editable && st.mode === 'edit') { st.color = CODES[(CODES.indexOf(st.color) + d + CODES.length) % CODES.length]; st.tool = 'paint'; draw(); } },
    tool: id => { if (st.mode === 'edit' && st.editable) { st.tool = id; st.linkFrom = null; draw(); } },
  };
  draw();

  return {
    update(level, { editable }) {
      st.level = level; st.editable = editable;
      if (st.mode === 'play') return;   // đang chơi: giữ ván, bấm Chơi lại để nạp bản nháp mới
      st.solve = st.solve?.running ? st.solve : null;
      draw();
    },
    destroy() { ro.disconnect(); document.removeEventListener('keydown', onKey, true); stopPlay(); st.worker?.terminate(); current = null; },
  };
}

let current = null;

// ───────────────────────────── ảnh nhỏ (Thư viện, Thứ tự) ─────────────────────────────
// rules.thumbnail trả SVG ngay; trên trình duyệt hook này đánh dấu SVG rồi vẽ lần lượt ảnh như màn Chơi thử (playview.mjs)
// lúc rảnh và thay vào chỗ SVG. Ảnh nhớ theo nội dung level trong phiên.
const thumbs = new Map(), thumbQueue = new Map();
let thumbView = null, thumbBusy = false;
const thumbKey = level => { const s = JSON.stringify(level); let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return `t${(h >>> 0).toString(36)}${s.length}`; };
const thumbImg = ({ url, w, h }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><image href="${url}" width="${w}" height="${h}"/></svg>`;

function thumbWork() {
  if (thumbBusy || !thumbQueue.size) return;
  thumbBusy = true;
  loadArt().then(() => {
    const next = () => {
      const [key, level] = thumbQueue.entries().next().value || [];
      if (!key) { thumbBusy = false; return; }
      thumbQueue.delete(key);
      try {
        const els = document.querySelectorAll(`[data-plthumb="${key}"]`);
        if (els.length) {
          const conv = tryConvert(level).level, m = new ParkingModel(conv);
          thumbView ??= new PlayView();
          thumbView.reset(m, [], false);
          const rows = Math.min(m.jh, 4) + 0.3, b = thumbView.L.boardBounds(rows), bw = Math.max(b.x1, m.W + 1.4) - b.x0 + 0.6;
          const W = 220, H = Math.ceil(W / bw * ((b.z1 - b.z0) * SIN + 0.3 * COS) / 0.94);
          const cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
          thumbView.fit(m, W, H, { rows, wide: true, topPad: 0.03, botPad: 0.03 });
          const c = cv.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0);
          thumbView.paint(c, m, { dpr: 2 });
          const url = cv.toDataURL('image/webp', 0.85);
          const t = { url, w: W, h: H };
          thumbs.set(key, t);
          for (const el of document.querySelectorAll(`[data-plthumb="${key}"]`)) el.outerHTML = thumbImg(t);
        }
      } catch { /* level lỗi: giữ SVG */ }
      setTimeout(next, 0);
    };
    next();
  });
}

if (typeof window !== 'undefined') {
  globalThis.parkingThumb = (level, svg) => {
    const key = thumbKey(level);
    if (thumbs.has(key)) return thumbImg(thumbs.get(key));
    thumbQueue.set(key, level);
    setTimeout(thumbWork, 50);
    return svg.replace('<svg ', `<svg data-plthumb="${key}" `);
  };
}

export default {
  renderEditor,
  layout: { game: 'tab', form: 'right' },
  listItem(sm) {
    if (!sm || sm.lanes === undefined) return { tags: '', sub: '' };
    const diff = sm.diff && sm.diff !== 'Normal' ? `<span class="chip warn">${esc(sm.diff)}</span>` : '';
    const v = sm.variant && sm.variant !== 'a' ? `<span class="chip">${esc(sm.variant)}</span>` : '';
    return { tags: diff + v, sub: `${sm.lanes}×${sm.cp} · vòng ${sm.loop} · ${sm.cars} xe${sm.mech ? ` · ${esc(sm.mech)}` : ''}` };
  },
  levelDetail(sm) {
    if (!sm || sm.lanes === undefined) return '';
    return `<div class="small">${sm.lanes} làn × ${sm.cp} · vòng ${sm.loop} · bãi ${sm.cols} cột · ${sm.cars} xe, ${sm.colors} màu${sm.mech ? `<br>${esc(sm.mech)}` : ''}</div>`;
  },
  shortcuts: [
    { id: 'pl.play', scope: 'level', label: 'Bàn chơi ⇄ Chơi thử (trong editor)', keys: ['r'] },
    { id: 'pl.solve', scope: 'level', label: 'Giải level', keys: ['k'] },
    { id: 'pl.paint', scope: 'level', label: 'Công cụ tô màu', keys: ['b'] },
    { id: 'pl.erase', scope: 'level', label: 'Công cụ xoá xe', keys: ['x'] },
    { id: 'pl.hidden', scope: 'level', label: 'Công cụ xe ẩn', keys: ['h'] },
    { id: 'pl.prevColor', scope: 'level', label: 'Màu trước', keys: ['['] },
    { id: 'pl.nextColor', scope: 'level', label: 'Màu sau', keys: [']'] },
  ],
  onShortcut(id) {
    if (!current) return;
    if (id === 'pl.play') return current.toggleMode();
    if (id === 'pl.solve') return current.solve();
    if (id === 'pl.prevColor' || id === 'pl.nextColor') return current.shiftColor(id === 'pl.nextColor' ? 1 : -1);
    current.tool(id.slice(3));
  },
};
