// Màn Tổng quan bộ (chạy hết trên trình duyệt, dùng được với cả hai server): số level theo nhóm (vd độ khó), đường chỉ số
// theo số level, so sánh tối đa 3 bộ, cảnh báo nhảy vọt / chuỗi dài cùng nhóm, kiểm định cả bộ (bấm để mở level), số
// liệu chơi thử nếu server có. Chỉ số và nhóm lấy từ tóm tắt level (`levelSummary` của game); manifest
// `overview: {group, metric}` chọn mặc định. Các hàm thuần (numericKeys, groupKeys, lineChart, warnings) dùng lại được.
import { api, downloadBlob } from './api.mjs';
import { $, $$, esc, fmtTime } from './ui.mjs';

const COLORS = ['var(--lc-accent)', 'var(--lc-warn)', 'var(--lc-ok)'];
const GROUP_COLORS = ['#4b90ff', '#1f9d55', '#c27a00', '#d33b3b', '#8e5cd9', '#0f9fb5', '#7a8599', '#c2187a'];
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Khoá tóm tắt có giá trị số ở ít nhất một nửa số level. */
export function numericKeys(levels) {
  const count = new Map();
  for (const l of levels) for (const [k, v] of Object.entries(l.summary || {})) if (typeof v === 'number' && Number.isFinite(v)) count.set(k, (count.get(k) || 0) + 1);
  return [...count].filter(([, n]) => n >= levels.length / 2).map(([k]) => k);
}

/** Khoá tóm tắt có ít giá trị khác nhau (2–8): dùng để chia nhóm. */
export function groupKeys(levels) {
  const vals = new Map();
  for (const l of levels) for (const [k, v] of Object.entries(l.summary || {})) {
    if (v == null || typeof v === 'object') continue;
    if (!vals.has(k)) vals.set(k, new Set());
    vals.get(k).add(String(v));
  }
  return [...vals].filter(([, s]) => s.size >= 2 && s.size <= 8).map(([k]) => k);
}

/** Nhóm mặc định: manifest overview.group, rồi khoá có tên kiểu độ khó / chế độ, rồi khoá chữ; không đoán bằng khoá số. */
export function defaultGroup(levels, config = {}, metric = null) {
  const groups = groupKeys(levels);
  const textual = k => levels.some(l => typeof l.summary?.[k] === 'string' || typeof l.summary?.[k] === 'boolean');
  return groups.includes(config.group) ? config.group
    : groups.find(k => k !== metric && /diff|khó|tier|hard|mode|type|loại/i.test(k)) ?? groups.find(k => k !== metric && textual(k)) ?? null;
}

/** Màu cố định cho từng giá trị của nhóm (theo thứ tự chữ). */
export function groupColors(levels, group) {
  const vals = [...new Set(levels.map(l => String(l.summary?.[group])))].sort();
  return v => GROUP_COLORS[Math.max(0, vals.indexOf(String(v))) % GROUP_COLORS.length];
}

/** SVG đường: series [{label, points: [[x, y]], dashed?, groups?: [nhóm theo điểm]}]. Điểm có data-level để bấm mở. */
export function lineChart(series, { height = 220, width = 860, groupColor = null } = {}) {
  const all = series.flatMap(s => s.points.filter(([, y]) => Number.isFinite(y)));
  if (!all.length) return '<p class="muted small">Không có số liệu để vẽ.</p>';
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(0, ...ys), Math.max(...ys)];
  const pad = 28;
  const X = x => pad + ((x - x0) / Math.max(1, x1 - x0)) * (width - pad * 2);
  const Y = y => height - pad + 6 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (height - pad * 1.5);
  const lines = series.map((s, i) => {
    const pts = s.points.filter(([, y]) => Number.isFinite(y));
    const d = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
    const dots = pts.length <= 400 ? pts.map(([x, y], k) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.6" data-level="${x}"
      fill="${groupColor && s.groups ? groupColor(s.groups[k]) : COLORS[i % 3]}"><title>${esc(s.label)} · level ${x}: ${y}${s.groups ? ` · ${esc(s.groups[k])}` : ''}</title></circle>`).join('') : '';
    return `<path d="${d}" fill="none" stroke="${COLORS[i % 3]}" stroke-width="1.5" ${s.dashed ? 'stroke-dasharray="4 3" opacity=".6"' : ''}/>${dots}`;
  }).join('');
  const axis = `<text x="${pad}" y="${height - 6}" class="ax">${x0}</text><text x="${width - pad}" y="${height - 6}" class="ax" text-anchor="end">${x1}</text>
    <text x="4" y="${Y(y1) + 4}" class="ax">${+y1.toFixed(2)}</text><text x="4" y="${Y(y0)}" class="ax">${+y0.toFixed(2)}</text>`;
  const legend = series.length > 1 ? series.map((s, i) => `<tspan fill="${COLORS[i % 3]}">■ ${esc(s.label)}</tspan>`).join('  ') : '';
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">
    <style>.ax{font:10px system-ui;fill:currentColor;opacity:.6}</style>${axis}${lines}
    ${legend ? `<text x="${width / 2}" y="12" text-anchor="middle" font-size="11">${legend}</text>` : ''}</svg>`;
}

/** Cảnh báo của một bộ: nhảy vọt so với level trước, chuỗi dài cùng nhóm cao nhất. */
export function warnings(levels, metric, group) {
  const out = [];
  const pts = levels.map(l => [Number(l.name), Number(l.summary?.[metric])]).filter(([, v]) => Number.isFinite(v));
  const diffs = pts.slice(1).map(([, v], i) => v - pts[i][1]);
  const m = median(diffs.map(Math.abs)) || 1;
  diffs.forEach((d, i) => {
    if (Math.abs(d) > 3 * m && Math.abs(d) > 0) out.push({ level: pts[i + 1][0], text: `${metric} ${d > 0 ? 'nhảy lên' : 'tụt xuống'} ${pts[i][1]} → ${pts[i + 1][1]}` });
  });
  if (group) {
    const vals = levels.map(l => l.summary?.[group]).filter(v => v != null);
    const top = [...new Set(vals.map(String))].sort((a, b) => (Number(b) - Number(a)) || b.localeCompare(a))[0];
    let run = [];
    const flush = () => {
      if (run.length >= 5) out.push({ level: Number(run[0].name), text: `${run.length} level liên tiếp ${group}=${top} (từ ${run[0].name} tới ${run.at(-1).name})` });
      run = [];
    };
    for (const l of levels) (String(l.summary?.[group]) === top ? run.push(l) : flush());
    flush();
  }
  return out.sort((a, b) => a.level - b.level);
}

const options = (list, cur, none = null) => (none != null ? `<option value="">${esc(none)}</option>` : '')
  + list.map(k => `<option ${k === cur ? 'selected' : ''}>${esc(k)}</option>`).join('');

/**
 * Màn Tổng quan bộ trong vỏ app. shell: {state, game, features(), openLevel(name), checkPack()}; root: thân màn, tools:
 * thanh công cụ ở hàng ngữ cảnh. Trả {render} — vỏ gọi khi mở màn, đổi bộ, danh sách level tải lại.
 */
export function mountOverview(shell, root, tools) {
  let pack = null, metric = null, group = null, groupTouched = false, compare = [], stats = null;
  const cache = new Map();
  const levelsOf = async p => {
    if (p === shell.state.pack) return shell.state.levels;
    if (!cache.has(p)) cache.set(p, (await api.levels(p)).filter(l => !l.deleted));
    return cache.get(p);
  };

  tools.innerHTML = `<label class="inline">Chỉ số <select id="ov-metric"></select></label>
    <label class="inline">Nhóm <select id="ov-group"></select></label>
    <label class="inline">So với <select class="ov-compare"></select></label><select class="ov-compare" title="So với bộ thứ hai"></select>
    <span class="grow"></span>
    <button id="ov-svg" title="Tải biểu đồ dạng SVG">⇩ SVG</button>
    <button id="ov-plays" title="Tải mọi lượt chơi thử của bộ (JSONL) cho phân tích, solver, AI" hidden>⇩ Dữ liệu lượt chơi</button>`;
  root.innerHTML = `<div class="page">
    <p id="ov-stats" class="ov-stats"></p>
    <section class="card"><div id="ov-chart"></div></section>
    <div class="cols2">
      <section class="card"><h3>Kiểm định cả bộ</h3>
        <div class="row"><span id="ov-check-state" class="small"></span><span class="grow"></span><button id="ov-check">Kiểm định lại</button></div>
        <div id="ov-valid"></div></section>
      <section class="card"><h3>Cảnh báo về độ khó <span class="muted small">nhảy vọt, chuỗi dài cùng nhóm</span></h3><div id="ov-warn"></div></section>
    </div></div>`;

  const draw = async () => {
    const base = shell.state.levels;
    const sets = [[pack, base], ...await Promise.all(compare.map(async p => [p, await levelsOf(p)]))];
    const color = group ? groupColors(base, group) : () => COLORS[0];
    const counts = new Map();
    for (const l of base) counts.set(String(l.summary?.[group] ?? '—'), (counts.get(String(l.summary?.[group] ?? '—')) || 0) + 1);
    const played = stats ? Object.values(stats) : [];
    const plays = played.reduce((n, s) => n + s.plays, 0), wins = played.reduce((n, s) => n + s.wins, 0);
    $('#ov-stats', root).innerHTML = `<b>${esc(base.length)}</b> level${group ? ` · ${[...counts].sort().map(([k, n]) =>
      `<span class="gchip" style="--c:${color(k)}">${esc(k)} <b>${n}</b></span>`).join(' ')}` : ''}`
      + (stats ? ` · chơi thử: ${plays} lượt ở ${played.length} level, thắng ${plays ? Math.round((wins / plays) * 100) : 0}%` : '');
    $('#ov-chart', root).innerHTML = metric ? lineChart(sets.map(([p, ls]) => ({
      label: p, points: ls.map(l => [Number(l.name), Number(l.summary?.[metric])]), groups: group ? ls.map(l => l.summary?.[group]) : null,
    })), { width: 1200, height: 260, groupColor: compare.length || !group ? null : color })
      : '<p class="muted small">Tóm tắt level của game chưa có chỉ số dạng số (levelSummary).</p>';
    const warn = metric ? warnings(base, metric, group) : [];
    $('#ov-warn', root).innerHTML = warn.length
      ? `<ul class="small links">${warn.slice(0, 80).map(w => `<li><button class="link" data-open="${w.level}">Level ${w.level}</button> ${esc(w.text)}</li>`).join('')}</ul>`
      : '<p class="muted small">Không có cảnh báo.</p>';
  };

  const drawValid = () => {
    const s = shell.state;
    const el = $('#ov-valid', root), st = $('#ov-check-state', root);
    if (s.checked?.pack !== pack) {
      st.textContent = 'Đang kiểm định…';
      el.innerHTML = '';
      return;
    }
    const bad = [...s.invalid], warned = [...s.warned].filter(([n]) => !s.invalid.has(n));
    st.innerHTML = `${bad.length ? `<span class="err">✗ ${bad.length} lỗi</span>` : '<span class="ok">✓ Không có lỗi</span>'}`
      + `${warned.length ? ` · <span class="warn">! ${warned.length} cảnh báo</span>` : ''} · ${esc(s.levels.length)} level`
      + ` <span class="muted">lúc ${esc(fmtTime(new Date(s.checked.at).toISOString()))}</span>`;
    const row = ([n, msgs], cls) => `<tr><td><button class="link" data-open="${esc(n)}">${esc(n)}</button></td><td class="${cls}">${msgs.map(esc).join('<br>')}</td></tr>`;
    el.innerHTML = bad.length || warned.length ? `<table class="tbl">${bad.map(r => row(r, 'err')).join('')}${warned.slice(0, 200).map(r => row(r, 'warn')).join('')}</table>` : '';
  };

  const runCheck = async () => {
    $('#ov-check', root).disabled = true;
    try {
      await shell.checkPack();
      drawValid();
    } catch (e) {
      $('#ov-check-state', root).innerHTML = `<span class="err">Không kiểm định được: ${esc(e.message)}</span>`;
    } finally {
      $('#ov-check', root).disabled = false;
    }
  };

  const fillTools = () => {
    const base = shell.state.levels;
    const others = shell.state.packs.filter(p => p.name !== pack && !p.archived).map(p => p.name);
    $('#ov-metric', tools).innerHTML = options(numericKeys(base), metric);
    $('#ov-group', tools).innerHTML = options(groupKeys(base), group, '—');
    $$('.ov-compare', tools).forEach((sel, i) => { sel.innerHTML = options(others, compare[i] ?? null, '—'); });
    $('#ov-plays', tools).hidden = !shell.features().plays;
  };

  tools.addEventListener('change', e => {
    if (e.target.id === 'ov-metric') metric = e.target.value;
    else if (e.target.id === 'ov-group') { group = e.target.value || null; groupTouched = true; }
    else if (e.target.classList.contains('ov-compare')) compare = [...new Set($$('.ov-compare', tools).map(x => x.value).filter(Boolean))];
    draw();
  });
  $('#ov-svg', tools).addEventListener('click', () => downloadBlob(new Blob([$('#ov-chart svg', root)?.outerHTML || ''], { type: 'image/svg+xml' }), `${pack}-${metric}.svg`));
  $('#ov-plays', tools).addEventListener('click', async () => { const { downloadPlays } = await import('./playsview.mjs'); await downloadPlays(pack); });
  $('#ov-check', root).addEventListener('click', () => runCheck().catch(() => {}));
  root.addEventListener('click', e => {
    const n = e.target.closest('[data-open], circle[data-level]');
    if (n) shell.openLevel(String(n.dataset.open || n.dataset.level));
  });

  async function render() {
    const s = shell.state;
    const base = s.levels;
    if (pack !== s.pack) {
      pack = s.pack;
      cache.clear();
      compare = [];
      groupTouched = false;
      metric = null;
      stats = shell.features().plays ? await api.playStats(pack).catch(() => null) : null;
    }
    const keys = numericKeys(base), cfg = shell.game.overview || {};
    if (!keys.includes(metric)) metric = keys.includes(cfg.metric) ? cfg.metric : keys[0] ?? null;
    if (!groupTouched || (group && !groupKeys(base).includes(group))) group = defaultGroup(base, cfg, metric);
    fillTools();
    await draw();
    if (s.checked?.pack !== pack) runCheck().catch(() => {});
    else drawValid();
  }
  return { render };
}
