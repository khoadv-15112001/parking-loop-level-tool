// Player WebGL giả để kiểm tay khung game khi chưa có bản Unity: zip có index.html nói đúng giao thức postMessage của
// levelcore/web/js/webgame.mjs và Build/ thật (loader.js, .wasm.br nén Brotli) để server phục vụ như bản Unity.
//   node levelcore/contracts/fake_player.mjs <zip ra> [id] [tag]     (mặc định id, tag của game mẫu: sample-game SAMPLE)
// Trang hiện level vừa nhận và nguồn (bản đang mở / rN), báo lại level_start … src=<nguồn> để app kiểm đúng bản.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createZip } from '../node/zip.mjs';

const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Player giả</title>
<style>body{font:13px/1.4 system-ui,sans-serif;margin:0;padding:10px;background:#101418;color:#dfe6ee}pre{white-space:pre-wrap;background:#1b2128;padding:8px;border-radius:6px;max-height:70vh;overflow:auto}b{color:#7fd1ff}</style>
</head><body><p>Player giả · <b id="what">chờ level…</b></p><pre id="level"></pre><script src="player.js"></script></body></html>`;

const script = (id, tag) => `(() => {
  const ID = ${JSON.stringify(id)}, TAG = ${JSON.stringify(tag)};
  const parent = new URLSearchParams(location.search).get('parent') || location.origin;
  let pack = '', levels = {}, source = 'draft';
  const post = msg => window.parent.postMessage({ source: ID, ...msg }, parent);
  const line = text => post({ type: 'line', line: '[' + TAG + '] ' + text });
  const show = (n, mode) => {
    const data = levels[n];
    document.getElementById('what').textContent = (mode === 'play' ? 'chơi' : 'xem') + ' level ' + n + ' · ' + source;
    document.getElementById('level').textContent = data ? JSON.stringify(data, null, 2) : '(không có level ' + n + ')';
    if (!data) return line('load_error ' + n + ' không có level này');
    if (mode === 'play') line('level_start ' + n + ' src=' + source);
    else line('preview_ready ' + n + ' props=' + Object.keys(data).length);
  };
  addEventListener('message', e => {
    if (e.origin !== parent || !e.data || e.data.target !== ID) return;
    const { method, arg } = e.data;
    if (method === 'LoadPack') { const p = JSON.parse(arg); pack = p.pack; levels = p.levels; source = p.source || 'draft'; post({ type: 'packLoaded' }); }
    else if (method === 'UpdateLevel') { const p = JSON.parse(arg); levels[p.level] = p.data; source = p.source || 'draft'; post({ type: 'packLoaded' }); }
    else if (method === 'PreviewLevel') show(Number(arg), 'preview');
    else if (method === 'LoadLevel') show(Number(arg), 'play');
    else if (method === 'Cheat') line('level_end ' + document.getElementById('what').textContent.split(' ')[2] + ' ' + (arg === 'win' ? 'win' : 'lose') + ' time=1 cheat=1');
  });
  post({ type: 'ready' });
})();`;

export function fakePlayerZip(id = 'sample-game', tag = 'SAMPLE') {
  const wasm = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31) % 251));
  return createZip([
    { name: 'index.html', data: PAGE },
    { name: 'player.js', data: script(id, tag) },
    { name: 'Build/fake.loader.js', data: '// loader giả' },
    { name: 'Build/fake.wasm.br', data: zlib.brotliCompressSync(wasm) },
  ]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [out, id, tag] = process.argv.slice(2);
  if (!out) {
    console.error('Cách dùng: node levelcore/contracts/fake_player.mjs <zip ra> [id] [tag]');
    process.exit(1);
  }
  fs.writeFileSync(out, fakePlayerZip(id, tag));
  console.log(`Đã ghi ${out}`);
}
