// Lượt chơi thử của một level (tab Lịch sử): ai chơi, bản nào (nháp / rN / link điện thoại), kết quả, thời gian, số sự
// kiện; bấm một lượt để xem chuỗi sự kiện và tải về JSON. Toàn bộ dữ liệu xuất ở Tổng quan bộ / Quản trị (JSONL).
import { api, downloadBlob } from './api.mjs';
import { esc, fmtTime, openDialog, shortUser } from './ui.mjs';

const RESULT = { win: ['Thắng', 'ok'], lose: ['Thua', 'err'], quit: ['Thoát', 'muted'] };
const secs = ms => (ms == null ? '?' : `${Math.round(ms / 1000)}s`);
const who = p => (p.link ? `📱 ${esc(p.player || 'link')}` : esc(shortUser(p.user)));

export function playRow(p, revOf = null) {
  const [label, cls] = RESULT[p.result] || [p.ended_at ? '—' : 'đang chơi', 'muted'];
  const src = p.source === 'draft' ? 'nháp' : p.source === 'link' ? 'link' : p.source;
  const stale = revOf != null && p.rev != null && p.rev !== revOf ? ' <span class="badge">bản cũ</span>' : '';
  return `<li data-play="${esc(p.id)}"><b class="${cls}">${esc(label)}</b> · ${who(p)} · ${esc(src)}${stale} · ${secs(p.duration_ms)}`
    + ` · ${esc(p.events)} sự kiện${p.cheat ? ' · <span class="muted">cheat</span>' : ''} · <span class="muted">${esc(fmtTime(p.started_at))}</span></li>`;
}

/** Vẽ danh sách lượt chơi của level vào el; bấm một dòng mở chi tiết. */
export async function renderPlays(el, pack, level, headRev) {
  el.innerHTML = '<p class="muted small">Đang tải lượt chơi…</p>';
  const list = await api.plays({ pack, level, limit: 50 });
  el.innerHTML = list.length
    ? `<ul class="plays small">${list.map(p => playRow(p, headRev)).join('')}</ul>`
    : '<p class="muted small">Chưa có lượt chơi thử nào của level này.</p>';
  el.onclick = e => {
    const id = e.target.closest('[data-play]')?.dataset.play;
    if (id) openPlay(id);
  };
}

export async function openPlay(id) {
  const p = await api.play(id);
  const events = p.event_list || [];
  const rows = events.slice(0, 300).map(e => `<tr><td class="muted">${esc(secs(e.t))}</td><td><code>${esc(e.line ?? JSON.stringify(e))}</code></td></tr>`).join('');
  await openDialog({
    title: `Lượt chơi #${p.id} · level ${p.level}`, wide: true,
    html: `<p class="small">${who(p)} · ${esc(p.source)}${p.rev ? ` (r${esc(p.rev)})` : ''} · ${esc(fmtTime(p.started_at))} · kết quả ${esc(p.result || '—')}
      · ${secs(p.duration_ms)}${p.build ? ` · bản game ${esc(p.build)}` : ''}${p.client ? ` · <span class="muted">${esc(p.client)}</span>` : ''}</p>
      ${p.summary ? `<p class="small muted">${esc(Object.entries(p.summary).map(([k, v]) => `${k}=${v}`).join(' '))}</p>` : ''}
      <table class="events small">${rows || '<tr><td class="muted">Không có sự kiện.</td></tr>'}</table>
      ${events.length > 300 ? `<p class="muted small">… còn ${events.length - 300} sự kiện, tải JSON để xem đủ.</p>` : ''}`,
    actions: [{
      label: 'Tải JSON', onClick: () => {
        downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), `play-${p.id}.json`);
        return false;
      },
    }, { label: 'Đóng', value: null }],
  });
}

/** Tải mọi lượt chơi (của bộ nếu có) dạng JSONL: mỗi dòng {play, level, events} — dữ liệu cho solver / AI. */
export async function downloadPlays(pack = null) {
  const res = await api.exportPlays(pack ? { pack } : {});
  downloadBlob(await res.blob(), `plays${pack ? `-${pack}` : ''}.jsonl`);
}
