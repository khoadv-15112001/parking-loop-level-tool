// Hợp đồng v1 — nhập có xem trước, không ghi đè bản đã sửa trong tool, xuất zip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { A, B, ifMatch, importZip, level, newPack, readZip } from './client.mjs';

const byName = r => Object.fromEntries(r.data.items.map(it => [it.name, it]));

test('nhập zip: xem trước không ghi, file lỗi báo riêng', async () => {
  const pack = await newPack('imp');
  const files = { 'Any/1.json': level(1), 'Any/2.json': level(2, 0, []), 'Any/3.json': '{hỏng', 'Any/readme.json': {}, 'Any/x.txt': 'x' };
  const dry = await importZip(pack, files, '?dry_run=true');
  assert.equal(dry.status, 200);
  assert.equal(dry.data.dry_run, true);
  assert.deepEqual([dry.data.created, dry.data.error], [2, 1]);
  assert.deepEqual(dry.data.skipped, ['Any/readme.json']);
  const items = byName(dry);
  assert.equal(items['2'].status, 'created');
  assert.deepEqual(items['2'].errors, ['time phải > 0', 'items trống']);
  assert.equal(items['3'].status, 'error');
  assert.equal((await A.get(`/api/packs/${pack}/levels`)).data.length, 0);

  const done = await importZip(pack, files);
  assert.equal(done.data.dry_run, false);
  assert.equal(byName(done)['1'].rev, 1);
  assert.equal((await A.get(`/api/packs/${pack}/levels`)).data.length, 2);
  const again = await importZip(pack, files);
  assert.equal(again.data.unchanged, 2);
});

test('nhập lại: cập nhật, chờ game, xung đột, đang khoá; force ghi đè xung đột', async () => {
  const pack = await newPack('sync');
  await importZip(pack, { '1.json': level(1, 10), '2.json': level(2, 20), '3.json': level(3, 30), '4.json': level(4, 40) });
  await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 11), headers: ifMatch(1) });
  await A.put(`/api/packs/${pack}/levels/2`, { json: level(2, 21), headers: ifMatch(1) });
  await B.post(`/api/locks/packs/${pack}/levels/4`);
  const files = { '1.json': level(1, 10), '2.json': level(2, 22), '3.json': level(3, 33), '4.json': level(4, 44), '5.json': level(5) };

  const dry = await importZip(pack, files, '?dry_run=1');
  const st = Object.fromEntries(dry.data.items.map(it => [it.name, it.status]));
  assert.deepEqual(st, { 1: 'waiting', 2: 'conflict', 3: 'updated', 4: 'locked', 5: 'created' });
  assert.equal(byName(dry)['2'].head_rev, 2);
  assert.equal(byName(dry)['4'].holder, 'b@sonat.vn');

  await importZip(pack, files);
  const get = async n => (await A.get(`/api/packs/${pack}/levels/${n}`)).data.level.time;
  assert.deepEqual([await get(1), await get(2), await get(3), await get(4), await get(5)], [11, 21, 33, 40, 60]);

  const forced = await importZip(pack, files, '?force=true');
  assert.deepEqual([forced.data.updated, forced.data.locked], [2, 1]);
  assert.deepEqual([await get(1), await get(2)], [10, 22]);

  await A.put(`/api/packs/${pack}/levels/3`, { json: level(3, 34), headers: ifMatch(2) });
  const next = await importZip(pack, { '3.json': level(3, 35) }, '?dry_run=1');
  assert.equal(next.data.items[0].status, 'conflict');
});

test('nhập JSON {levels} và level do tool tạo không bị ghi đè', async () => {
  const pack = await newPack('json');
  await A.post(`/api/packs/${pack}/levels/7`, { json: level(7, 70) });
  const r = await A.post(`/api/packs/${pack}/import`, { json: { levels: { 7: level(7, 71), 8: level(8), x: level(1) } } });
  assert.deepEqual(Object.fromEntries(r.data.items.map(it => [it.name, it.status])), { 7: 'conflict', 8: 'created', x: 'error' });
  assert.equal((await A.get(`/api/packs/${pack}/levels/7`)).data.level.time, 70);
});

test('xuất zip theo <bộ>/<số>.json', async () => {
  const pack = await newPack('exp');
  await importZip(pack, { '2.json': level(2, 20), '10.json': level(10) });
  const r = await A.get(`/api/packs/${pack}/export`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), new RegExp(`${pack}\\.zip`));
  const files = Object.fromEntries(readZip(r.bytes).map(f => [f.name, JSON.parse(f.data.toString('utf8'))]));
  assert.deepEqual(files, { [`${pack}/2.json`]: level(2, 20), [`${pack}/10.json`]: level(10) });
});

test('nhập vào bộ production bị chặn', async () => {
  assert.equal((await importZip('product', { '1.json': level(1) })).status, 403);
});
