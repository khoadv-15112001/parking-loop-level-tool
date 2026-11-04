// Hợp đồng các tính năng chỉ có ở server Node: lượt chơi thử, link chơi trên điện thoại, ảnh level, xếp thứ tự, thùng rác,
// quản trị. Server Python không có (features trong /api/me là false) nên các test này bỏ qua khi chạy với Python.
import assert from 'node:assert/strict';
import test from 'node:test';
import { A, B, call, create, ifMatch, level, newPack } from './client.mjs';

const me = (await A.get('/api/me')).data;
const skip = me.runtime === 'node' ? false : 'chỉ có ở server Node';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

test('/api/me báo đủ tính năng và quyền theo việc', { skip }, () => {
  for (const k of ['plays', 'share', 'thumbs', 'reorder', 'trash', 'admin']) assert.equal(me.features[k], true, k);
  assert.equal(me.rights.gameBuilds, true);
  assert.equal(typeof me.notice.text, 'string');
});

test('Lượt chơi: bắt đầu một lần theo uid, gửi sự kiện theo lô, kết thúc, xem lại đủ nội dung, xuất JSONL', { skip }, async () => {
  const pack = await newPack('plays');
  await create(pack, 1, level(1, 33));
  const uid = `u${Date.now().toString(36)}abcdef`;
  const body = { uid, pack, level: '1', rev: 1, source: 'draft', level_data: level(1, 44), build: 'b123' };
  const start = await A.post('/api/plays', { json: body });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal((await A.post('/api/plays', { json: body })).data.id, start.data.id);
  assert.equal((await A.post(`/api/plays/${uid}/events`, { json: { events: [{ t: 10, line: '[SAMPLE] level_start 1' }] } })).status, 200);
  assert.equal((await B.post(`/api/plays/${uid}/events`, { json: { events: [{ t: 1 }] } })).status, 403);
  const end = await A.post(`/api/plays/${uid}/events`, { json: { events: [{ t: 20, type: 'move' }], end: { result: 'win', duration_ms: 20, summary: { time: '1' } } } });
  assert.equal(end.data.result, 'win');
  assert.equal(end.data.events, 2);
  const list = await A.get(`/api/plays?pack=${pack}&level=1`);
  assert.deepEqual(list.data.map(p => p.uid), [uid]);
  const detail = await A.get(`/api/plays/${start.data.id}`);
  assert.deepEqual(detail.data.level_data, level(1, 44));
  assert.deepEqual(detail.data.event_list.map(e => e.t), [10, 20]);
  const jsonl = await A.get(`/api/plays/export?pack=${pack}`);
  const lines = jsonl.bytes.toString('utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].events.length, 2);
  assert.deepEqual(lines[0].level, level(1, 44));
});

test('Link chơi thử: ghim bản đã lưu hoặc bản nháp, mở không cần đăng nhập, ghi lượt chơi, thu hồi thì hết dùng', { skip }, async () => {
  const pack = await newPack('links');
  await create(pack, 3, level(3, 30));
  await A.put(`/api/packs/${pack}/levels/3`, { json: level(3, 31), headers: ifMatch(1) });
  const saved = await A.post('/api/links', { json: { pack, level: '3', rev: 1, days: 2, name: 'thử' } });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.match(saved.data.path, /^\/p\/[\w-]{16,}$/);
  const draft = await A.post('/api/links', { json: { pack, level: '3', level_data: level(3, 99) } });
  const info = await call(null, 'GET', `${saved.data.path}/info`);
  assert.equal(info.status, 200);
  assert.deepEqual(info.data.level_data, level(3, 30));
  assert.equal(info.data.webgame.id, 'sample-game');
  assert.deepEqual((await call(null, 'GET', `${draft.data.path}/info`)).data.level_data, level(3, 99));
  const page = await call(null, 'GET', saved.data.path);
  assert.equal(page.status, 200);
  assert.match(page.bytes.toString('utf8'), /phone\.mjs/);
  const uid = `l${Date.now().toString(36)}abcdef`;
  const p = await call(null, 'POST', `${saved.data.path}/plays`, { json: { uid, pack, level: '3', rev: 1, level_data: info.data.level_data, player: 'An' } });
  assert.equal(p.data.source, 'link');
  assert.equal(p.data.player, 'An');
  await call(null, 'POST', `${saved.data.path}/plays/${uid}/events`, { json: { events: [{ t: 5 }], end: { result: 'lose', duration_ms: 5 } } });
  const plays = await A.get(`/api/plays?pack=${pack}&level=3`);
  assert.equal(plays.data[0].link, saved.data.token);
  const listed = await A.get(`/api/links?pack=${pack}&level=3`);
  assert.equal(listed.data.find(l => l.token === saved.data.token).opens, 1);
  assert.equal((await B.del(`/api/links/${saved.data.token}`)).status, 403);
  assert.equal((await A.del(`/api/links/${saved.data.token}`)).data.active, false);
  assert.equal((await call(null, 'GET', `${saved.data.path}/info`)).status, 410);
  assert.equal((await call(null, 'POST', `${saved.data.path}/plays`, { json: { uid: `${uid}x`, level_data: {} } })).status, 410);
  assert.equal((await call(null, 'GET', '/p/khongcotokennaydauxyz/info')).status, 404);
});

test('Ảnh level: lưu theo sha nội dung, đọc lại kèm cache lâu, chặn sha lạ và loại file lạ', { skip }, async () => {
  const pack = await newPack('thumbs');
  const lv = (await create(pack, 1, level(1, 21))).data;
  const put = await A.put(`/api/thumbs/${lv.sha}?source=capture`, { body: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const got = await A.get(`/api/thumbs/${lv.sha}`);
  assert.deepEqual(got.bytes, PNG);
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.deepEqual((await A.get(`/api/packs/${pack}/thumbs`)).data.have, [lv.sha]);
  assert.equal((await A.put(`/api/thumbs/${'a'.repeat(64)}`, { body: PNG, headers: { 'Content-Type': 'image/png' } })).status, 404);
  assert.equal((await A.put(`/api/thumbs/${lv.sha}`, { body: Buffer.from('x'), headers: { 'Content-Type': 'text/html' } })).status, 415);
  assert.equal((await A.get('/api/thumbs/xyz')).status, 400);
});

test('Xếp thứ tự: slot giữ nguyên, level đổi số theo thứ tự mới, bộ đổi giữa chừng thì 409, hoàn tác về như cũ', { skip }, async () => {
  const pack = await newPack('reorder');
  for (const n of [1, 2, 3, 5]) await create(pack, n, level(n, n * 10));
  const before = ['1', '2', '3', '5'];
  const dry = await A.post(`/api/packs/${pack}/reorder`, { json: { order: ['3', '1', '2', '5'], base: before, dry_run: true } });
  assert.deepEqual(dry.data.moves.map(m => `${m.from}>${m.to}`), ['3>1', '1>2', '2>3']);
  assert.equal((await A.post(`/api/packs/${pack}/reorder`, { json: { order: ['3', '1', '2', '5'], base: ['1', '2', '3'] } })).status, 409);
  assert.equal((await A.post(`/api/packs/${pack}/reorder`, { json: { order: ['3', '1', '5'], base: before } })).status, 400);
  await A.post(`/api/locks/packs/${pack}/levels/2`);
  assert.equal((await B.post(`/api/packs/${pack}/reorder`, { json: { order: ['3', '1', '2', '5'], base: before } })).status, 423);
  const res = await A.post(`/api/packs/${pack}/reorder`, { json: { order: ['3', '1', '2', '5'], base: before } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const times = async () => Promise.all(before.map(async n => (await A.get(`/api/packs/${pack}/levels/${n}`)).data.level.time));
  assert.deepEqual(await times(), [30, 10, 20, 50]);
  assert.equal((await A.get(`/api/packs/${pack}/levels/1`)).data.level.level, 1);
  const undo = await A.post(`/api/packs/${pack}/reorder`, { json: { order: ['2', '3', '1', '5'], base: before } });
  assert.equal(undo.data.moves.length, 3);
  assert.deepEqual(await times(), [10, 20, 30, 50]);
});

test('Thùng rác: level đã xoá và bộ lưu trữ có lý do hiện kèm ngày bị xoá hẳn', { skip }, async () => {
  const pack = await newPack('trash');
  await create(pack, 1, level(1));
  await create(pack, 2, level(2));
  await A.del(`/api/packs/${pack}/levels/2`, { headers: ifMatch(1) });
  const t = (await A.get('/api/trash')).data;
  const gone = t.levels.find(l => l.pack === pack && l.name === '2');
  assert.ok(gone);
  assert.ok(Date.parse(gone.purge_at) - Date.parse(gone.deleted_at) >= (t.days - 1) * 86400000);
  assert.equal((await B.patch(`/api/packs/${pack}`, { json: { archived: true } })).status, 403);
  await A.patch(`/api/packs/${pack}`, { json: { archived: true, archive_reason: 'bộ thử xong' } });
  const p = (await A.get('/api/trash')).data.packs.find(x => x.name === pack);
  assert.equal(p.archive_reason, 'bộ thử xong');
  assert.ok(p.purge_at);
});

test('Quản trị: chỉ admin xem / sửa, lưu từ bản cũ thì 409, đổi quyền có hiệu lực ngay, sao lưu DB', { skip }, async () => {
  assert.equal((await B.get('/api/admin/settings')).status, 403);
  const s = (await A.get('/api/admin/settings')).data;
  assert.equal(s.permissions.shareLinks, 'everyone');
  const saved = await A.put('/api/admin/settings', { json: { version: s.version, notice: { text: 'Bảo trì 17h', level: 'warn' }, permissions: { shareLinks: 'admin' } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await A.put('/api/admin/settings', { json: { version: s.version, linkDays: 3 } })).status, 409);
  assert.equal((await B.get('/api/me')).data.notice.text, 'Bảo trì 17h');
  assert.equal((await B.get('/api/me')).data.rights.shareLinks, false);
  const pack = await newPack('perm');
  await create(pack, 1, level(1));
  assert.equal((await B.post('/api/links', { json: { pack, level: '1' } })).status, 403);
  const back = await A.put('/api/admin/settings', { json: { version: saved.data.version, notice: { text: '' }, permissions: { shareLinks: 'everyone' } } });
  assert.equal(back.status, 200);
  assert.equal((await A.put('/api/admin/settings', { json: { version: back.data.version, permissions: { nope: 'everyone' } } })).status, 400);
  const storage = (await A.get('/api/admin/storage')).data;
  assert.ok(storage.database > 0 && storage.counts.levels > 0);
  const backup = await A.post('/api/admin/backup');
  assert.equal(backup.status, 200, JSON.stringify(backup.data));
  assert.ok(backup.data.size > 0);
  assert.equal((await B.post('/api/admin/housekeeping')).status, 403);
});
