// Hợp đồng v1 — đăng nhập, bộ, level, revision, khoá, kiểm định, promote, đổi số, audit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { A, ADMIN, B, call, create, ifMatch, level, newPack } from './client.mjs';

test('đăng nhập DEV, /api/me và bộ mặc định', async () => {
  assert.equal((await call(null, 'GET', '/api/me')).status, 401);
  assert.equal((await call('x@gmail.com', 'GET', '/api/me')).status, 403);
  const me = (await A.get('/api/me')).data;
  assert.equal(me.email, ADMIN);
  assert.equal(me.admin, true);
  assert.equal((await B.get('/api/me')).data.admin, false);
  assert.equal(me.format_version, 1);
  assert.ok(['python', 'node'].includes(me.runtime));
  assert.equal(typeof me.features.levelhub, 'boolean');
  const packs = Object.fromEntries((await A.get('/api/packs')).data.map(p => [p.name, p]));
  assert.ok(packs.develop && packs.product?.production);
  assert.equal((await call(null, 'GET', '/healthz')).data.ok, true);
});

test('bộ: tạo, trùng tên, đổi tên, cờ production chỉ admin', async () => {
  const pack = await newPack('pk');
  assert.equal((await A.post('/api/packs', { json: { name: pack } })).status, 409);
  assert.equal((await A.post('/api/packs', { json: { name: 'bad name' } })).status, 400);
  assert.equal((await B.patch(`/api/packs/${pack}`, { json: { production: true } })).status, 403);
  const r = await A.patch(`/api/packs/${pack}`, { json: { group: '  Tuần   45 ', description: 'thử' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.changed, ['group', 'description']);
  assert.equal(r.data.group, 'Tuần 45');
  const to = `${pack}-x`;
  assert.deepEqual((await A.post(`/api/packs/${pack}/rename`, { json: { to } })).data, { from: pack, to, author: ADMIN });
  assert.equal((await A.get(`/api/packs/${pack}/levels`)).status, 404);
  assert.equal((await A.get(`/api/packs/${to}/levels`)).status, 200);
});

test('level: ETag, If-Match, hook summary / changes, xung đột hai tab', async () => {
  const pack = await newPack('lv');
  const r1 = await create(pack, 1);
  assert.equal(r1.headers.get('etag'), '"r1"');
  assert.equal((await A.post(`/api/packs/${pack}/levels/1`, { json: level(1) })).status, 409);
  assert.equal((await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 90) })).status, 428);
  const r2 = await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 90), headers: ifMatch(1) });
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.data.changes, ['time: 60 → 90']);
  assert.deepEqual(r2.data.summary, { time: 90, items: 2 });
  const list = (await A.get(`/api/packs/${pack}/levels`)).data;
  assert.deepEqual(list[0].summary, { time: 90, items: 2 });
  assert.equal(list[0].head_rev, 2);

  const stale = await B.put(`/api/packs/${pack}/levels/1`, { json: level(1, 5), headers: ifMatch(1) });
  assert.equal(stale.status, 412);
  assert.equal(stale.data.head_rev, 2);
  assert.equal(stale.data.author, ADMIN);
  assert.deepEqual(stale.data.body, level(1, 90));

  const same = await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 90), headers: ifMatch(2) });
  assert.equal(same.data.unchanged, true);
  assert.equal(same.data.rev, 2);

  const got = await A.get(`/api/packs/${pack}/levels/1`);
  assert.equal(got.headers.get('etag'), '"r2"');
  assert.equal(got.data.format, 1);
  assert.equal(got.data.level_no, 1);
  assert.deepEqual(got.data.level, level(1, 90));
  assert.equal((await A.post(`/api/packs/${pack}/levels/abc`, { json: level(1) })).status, 400);
  assert.equal((await A.post(`/api/packs/${pack}/levels/2`, { body: '[1]', headers: { 'Content-Type': 'application/json' } })).status, 400);
});

test('lịch sử: revisions, diff, revert, xoá rồi khôi phục', async () => {
  const pack = await newPack('hist');
  await create(pack, 3, level(3, 10));
  await A.put(`/api/packs/${pack}/levels/3`, { json: level(3, 20), headers: ifMatch(1) });
  const revs = (await A.get(`/api/packs/${pack}/levels/3/revisions`)).data;
  assert.deepEqual(revs.map(r => [r.rev, r.kind]), [[2, 'update'], [1, 'create']]);
  assert.deepEqual(revs[0].changes, ['time: 10 → 20']);
  assert.equal(revs[1].changes, null);
  const diff = (await A.get(`/api/packs/${pack}/levels/3/revisions/2/diff`)).data;
  assert.deepEqual(diff.prev.level, level(3, 10));
  assert.deepEqual(diff.level, level(3, 20));
  assert.equal((await A.get(`/api/packs/${pack}/levels/3/revisions/9`)).status, 404);
  const back = await A.post(`/api/packs/${pack}/levels/3/revert`, { json: { rev: 1 }, headers: ifMatch(2) });
  assert.equal(back.status, 200);
  assert.equal(back.data.rev, 3);
  assert.equal(back.data.reverted_to, 1);
  assert.deepEqual((await A.get(`/api/packs/${pack}/levels/3`)).data.level, level(3, 10));
  assert.equal((await A.del(`/api/packs/${pack}/levels/3`)).status, 428);
  assert.equal((await A.del(`/api/packs/${pack}/levels/3`, { headers: ifMatch(3) })).status, 200);
  assert.equal((await A.get(`/api/packs/${pack}/levels/3`)).status, 404);
  const all = (await A.get(`/api/packs/${pack}/levels?include_deleted=true`)).data;
  assert.equal(all[0].deleted, true);
  const restored = await A.post(`/api/packs/${pack}/levels/3/revert`, { json: { rev: 3 }, headers: ifMatch(4) });
  assert.equal(restored.data.rev, 5);
  assert.equal((await A.get(`/api/packs/${pack}/levels/3`)).status, 200);
});

test('khoá: người khác không sửa được, phá khoá chỉ admin', async () => {
  const pack = await newPack('lock');
  await create(pack, 1);
  const lk = await A.post(`/api/locks/packs/${pack}/levels/1`);
  assert.equal(lk.status, 200);
  assert.equal(lk.data.holder, ADMIN);
  const blocked = await B.put(`/api/packs/${pack}/levels/1`, { json: level(1, 5), headers: ifMatch(1) });
  assert.equal(blocked.status, 423);
  assert.equal(blocked.data.holder, ADMIN);
  assert.equal((await B.put(`/api/locks/packs/${pack}/levels/1`)).status, 409);
  assert.equal((await B.del(`/api/locks/packs/${pack}/levels/1`)).status, 423);
  assert.equal((await B.del(`/api/locks/packs/${pack}/levels/1?force=1`)).status, 403);
  assert.equal((await A.put(`/api/locks/packs/${pack}/levels/1`)).status, 200);
  const listed = (await B.get(`/api/packs/${pack}/levels`)).data[0];
  assert.equal(listed.lock.holder, ADMIN);
  await B.post(`/api/locks/packs/${pack}/levels/2`).then(r => assert.equal(r.status, 200));
  const forced = await A.del(`/api/locks/packs/${pack}/levels/2?force=1`);
  assert.equal(forced.data.forced, true);
  const released = await A.del(`/api/locks/packs/${pack}/levels/1`);
  assert.deepEqual([released.data.released, released.data.forced], [true, false]);
});

test('kiểm định cả bộ, promote qua validator, bộ production chỉ đọc', async () => {
  const pack = await newPack('val');
  await create(pack, 1);
  await create(pack, 2, level(2, 0, []));
  const res = Object.fromEntries((await A.get(`/api/packs/${pack}/validate`)).data.map(x => [x.name, x]));
  assert.equal(res['1'].isValid, true);
  assert.deepEqual(res['2'].errors, ['time phải > 0', 'items trống']);
  const bad = await A.post('/api/promote', { json: { from: pack, to: 'product', items: [{ name: '2' }] } });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.validation[0].level, '2');
  const n = String(100 + Math.floor(Math.random() * 1e6));
  const ok = await A.post('/api/promote', { json: { from: pack, to: 'product', items: [{ name: '1', to: n }] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.items[0].to, n);
  assert.equal((await A.get(`/api/packs/product/levels/${n}`)).data.level.level, Number(n));
  assert.equal((await A.put(`/api/packs/product/levels/${n}`, { json: level(Number(n), 5), headers: ifMatch(1) })).status, 403);
  const again = await A.post('/api/promote', { json: { from: pack, to: 'product', items: [{ name: '1', to: n }] } });
  assert.equal(again.data.items[0].unchanged, true);
});

test('đổi số: shift dồn level, setLevelNumber của game, dry_run', async () => {
  const pack = await newPack('rl');
  for (const n of [1, 2, 3]) await create(pack, n, level(n, 10 * n));
  const plan = await A.post(`/api/packs/${pack}/levels/1/relevel`, { json: { to: '3', mode: 'shift', dry_run: true } });
  assert.deepEqual(plan.data.moves.map(m => [m.from, m.to]), [['1', '3'], ['2', '1'], ['3', '2']]);
  assert.equal(plan.data.dry_run, true);
  const r = await A.post(`/api/packs/${pack}/levels/1/relevel`, { json: { to: '3', mode: 'shift' }, headers: ifMatch(1) });
  assert.equal(r.status, 200);
  assert.deepEqual((await A.get(`/api/packs/${pack}/levels/3`)).data.level, level(3, 10));
  assert.deepEqual((await A.get(`/api/packs/${pack}/levels/1`)).data.level, level(1, 20));
  const swap = await A.post(`/api/packs/${pack}/levels/1/relevel`, { json: { to: '2', mode: 'swap' }, headers: ifMatch(1) });
  assert.equal(swap.status, 412);
});

test('audit ghi các thao tác theo bộ', async () => {
  const pack = await newPack('aud');
  await create(pack, 1);
  const items = (await A.get(`/api/audit?pack=${pack}`)).data;
  assert.deepEqual(items.map(a => a.action).sort(), ['level.create', 'pack.create']);
  assert.equal(items.find(a => a.action === 'level.create').rev, 1);
});

test('bundle có body của head mọi level', async () => {
  const pack = await newPack('bd');
  await create(pack, 2, level(2, 30));
  const b = (await A.get(`/api/packs/${pack}/bundle`)).data;
  assert.deepEqual(b.levels.map(l => [l.name, l.rev, l.level.time]), [['2', 1, 30]]);
});
