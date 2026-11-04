// Hợp đồng v1 — SSE: người khác lưu level thì luồng /api/events nhận event sau khi ghi.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, create, newPack, OTHER } from './client.mjs';

test('SSE nhận presence rồi level.created', async () => {
  const pack = await newPack('sse');
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/events`, { headers: { 'X-Dev-User': OTHER }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const seen = [];
  const wait = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      for (const m of buf.matchAll(/event: (\S+)\ndata: (.*)\n/g)) seen.push([m[1], JSON.parse(m[2])]);
      if (seen.some(([t, d]) => t === 'level.created' && d.pack === pack)) return;
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
    }
  })();
  await new Promise(r => setTimeout(r, 200));
  await create(pack, 4);
  await Promise.race([wait, new Promise((_, rej) => setTimeout(() => rej(new Error(`không nhận được event: ${JSON.stringify(seen)}`)), 5000))]);
  ctrl.abort();
  assert.equal(seen[0][0], 'presence');
  const ev = seen.find(([t, d]) => t === 'level.created' && d.pack === pack)[1];
  assert.deepEqual([ev.pack, ev.name, ev.rev], [pack, '4', 1]);
});
