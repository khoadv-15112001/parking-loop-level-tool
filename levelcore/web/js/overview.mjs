// Tổng quan bộ (chạy hết trên trình duyệt, dùng được với cả hai server): số level theo nhóm (vd độ khó), đường chỉ số theo
// số level, so sánh tối đa 3 bộ, cảnh báo nhảy vọt / chuỗi dài cùng nhóm (bấm để mở level), số liệu chơi thử nếu server có.
// Chỉ số và nhóm lấy từ tóm tắt level (`levelSummary` của game); manifest `overview: {group, metric}` chọn mặc định.
import { api, downloadBlob } from './api.mjs';
import { $, esc, openDialog } from './ui.mjs';

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

export async function openOverview({ pack, packs, config = {}, features = {}, onOpenLevel }) {
  const cache = new Map();
  const levelsOf = async p => {
    if (!cache.has(p)) cache.set(p, (await api.levels(p)).filter(l => !l.deleted));
    return cache.get(p);
  };
  const base = await levelsOf(pack);
  const keys = numericKeys(base), groups = groupKeys(base);
  let metric = keys.includes(config.metric) ? config.metric : keys[0] ?? null;
  // Nhóm mặc định: manifest overview.group, rồi khoá có tên kiểu độ khó / chế độ, rồi khoá chữ; không đoán bằng khoá số.
  const textual = k => base.some(l => typeof l.summary?.[k] === 'string' || typeof l.summary?.[k] === 'boolean');
  let group = groups.includes(config.group) ? config.group
    : groups.find(k => k !== metric && /diff|khó|tier|hard|mode|type|loại/i.test(k)) ?? groups.find(k => k !== metric && textual(k)) ?? null;
  let compare = [];
  let stats = null;
  if (features.plays) stats = await api.playStats(pack).catch(() => null);
  const groupColor = v => GROUP_COLORS[[...new Set(base.map(l => String(l.summary?.[group])))].sort().indexOf(String(v)) % GROUP_COLORS.length];

  const render = async dlg => {
    const sets = [[pack, base], ...await Promise.all(compare.map(async p => [p, await levelsOf(p)]))];
    const counts = new Map();
    for (const l of base) counts.set(String(l.summary?.[group] ?? '—'), (counts.get(String(l.summary?.[group] ?? '—')) || 0) + 1);
    const played = stats ? Object.values(stats) : [];
    const plays = played.reduce((n, s) => n + s.plays, 0), wins = played.reduce((n, s) => n + s.wins, 0);
    $('#ov-stats', dlg).innerHTML = `<b>${esc(base.length)}</b> level${group ? ` · ${[...counts].sort().map(([k, n]) => `<span class="badge" style="border-color:${groupColor(k)}">${esc(group)} ${esc(k)}: ${n}</span>`).join(' ')}` : ''}`
      + (stats ? ` · chơi thử: ${plays} lượt ở ${played.length} level, thắng ${plays ? Math.round((wins / plays) * 100) : 0}%` : '');
    $('#ov-chart', dlg).innerHTML = metric ? lineChart(sets.map(([p, ls]) => ({
      label: p, points: ls.map(l => [Number(l.name), Number(l.summary?.[metric])]), groups: group ? ls.map(l => l.summary?.[group]) : null,
    })), { groupColor: compare.length ? null : groupColor }) : '<p class="muted small">Tóm tắt level của game chưa có chỉ số dạng số (levelSummary).</p>';
    const warn = metric ? warnings(base, metric, group) : [];
    $('#ov-warn', dlg).innerHTML = warn.length
      ? `<ul class="small">${warn.slice(0, 60).map(w => `<li><button data-open="${w.level}">Level ${w.level}</button> ${esc(w.text)}</li>`).join('')}</ul>`
      : '<p class="muted small">Không có cảnh báo.</p>';
  };

  const others = packs.filter(p => p.name !== pack && !p.archived).map(p => p.name);
  const pick = await openDialog({
    title: `Tổng quan bộ ${pack}`, wide: true,
    html: `<div class="ro-tools"><label>Chỉ số<select id="ov-metric">${keys.map(k => `<option ${k === metric ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      <label>Nhóm<select id="ov-group"><option value="">—</option>${groups.map(k => `<option ${k === group ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      ${[1, 2].map(i => `<label>So với bộ<select class="ov-compare"><option value="">—</option>${others.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>`).join('')}</div>
      <p id="ov-stats" class="small"></p><div id="ov-chart"></div><h4>Cảnh báo</h4><div id="ov-warn"></div>`,
    actions: [
      { label: 'Tải SVG', onClick: dlg => { downloadBlob(new Blob([$('#ov-chart svg', dlg)?.outerHTML || ''], { type: 'image/svg+xml' }), `${pack}-${metric}.svg`); return false; } },
      ...(features.plays ? [{ label: 'Tải dữ liệu lượt chơi', onClick: async () => { const { downloadPlays } = await import('./playsview.mjs'); await downloadPlays(pack); return false; } }] : []),
      { label: 'Đóng', value: null },
    ],
    onOpen: (dlg, close) => {
      render(dlg);
      $('#ov-metric', dlg).addEventListener('change', e => { metric = e.target.value; render(dlg); });
      $('#ov-group', dlg).addEventListener('change', e => { group = e.target.value || null; render(dlg); });
      for (const sel of dlg.querySelectorAll('.ov-compare')) {
        sel.addEventListener('change', () => {
          compare = [...new Set([...dlg.querySelectorAll('.ov-compare')].map(x => x.value).filter(Boolean))];
          render(dlg);
        });
      }
      dlg.addEventListener('click', e => {
        const n = e.target.closest('[data-open], circle[data-level]');
        if (n) close({ open: n.dataset.open || n.dataset.level });
      });
    },
  });
  if (pick?.open) onOpenLevel?.(String(pick.open));
}
