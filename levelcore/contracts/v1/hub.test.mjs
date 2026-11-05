// Hợp đồng: xuất Level Hub theo snapshot, đẩy lên BI (BI giả ở FAKE_BI_URL), đăng nhập Google của BI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { biToken } from '../fake_bi.mjs';
import { A, BASE, call, create, ifMatch, level, newPack, readZip } from './client.mjs';

const FAKE_BI = process.env.FAKE_BI_URL;
const FIELD_ORDER = ['game', 'os', 'team', 'designer', 'version', 'level', 'mechanics', 'difficulty', 'layout', 'uniqueColor',
  'totalBlock', 'obstacleInfos', 'time', 'date', 'geo', 'why', 'fromLv', 'toLv'];
const range = (from, to, extra = {}) => ({ from_lv: from, to_lv: to, os: 'Android', geo: ['Global'], designer: 'a@sonat.vn', ...extra });
const files = bytes => Object.fromEntries(readZip(bytes).map(e => [e.name, e.data.toString('utf8')]));
const upload = (pack, body, mode) => A.post(`/api/packs/${pack}/levelhub/upload`, { json: body, headers: { 'X-BI-Token': biToken(mode) } });

async function packOf3() {
  const pack = await newPack('hub');
  for (const n of [1, 2, 3]) await create(pack, n, level(n, 60 + n, n === 2 ? ['rock', 'gem', 'rock'] : ['gem']));
  return pack;
}

test('Level Hub: gói đúng raw và metadata; xuất theo snapshot không đổi khi head đổi sau Kiểm tra', async () => {
  const pack = await packOf3();
  const pre = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: range(1, 3) });
  assert.equal(pre.status, 200);
  assert.deepEqual(pre.data.snapshot.map(x => [x.level, x.rev]), [[1, 1], [2, 1], [3, 1]]);
  assert.equal(pre.data.rows[1].obstacleInfos, 'RK2');

  const r2 = await A.put(`/api/packs/${pack}/levels/2`, { json: level(2, 99, ['gem']), headers: ifMatch(1) });
  assert.equal(r2.status, 200);

  const snap = await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 3, { snapshot: pre.data.snapshot }) });
  assert.equal(snap.status, 200);
  assert.match(snap.headers.get('content-disposition'), /Sample_Android_1_3_Global__a_\d{4}_v1\.zip/);
  const z = files(snap.bytes);
  assert.equal(z['Raw/2.json'], JSON.stringify(level(2, 62, ['rock', 'gem', 'rock']), null, 2));
  const meta = JSON.parse(z['LevelMetadata.json']);
  assert.deepEqual(Object.keys(meta.Levels[0]), FIELD_ORDER);
  assert.deepEqual(meta.Levels.map(r => [r.level, r.time, r.obstacleInfos, r.os, r.game]), [[1, 61, 'N0', 'A', 'Sample'], [2, 62, 'RK2', 'A', 'Sample'], [3, 63, 'N0', 'A', 'Sample']]);

  const head = await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 3) });
  assert.equal(files(head.bytes)['Raw/2.json'], JSON.stringify(level(2, 99, ['gem']), null, 2));

  const bad = pre.data.snapshot.map(x => (x.level === 3 ? { ...x, sha: '0'.repeat(64) } : x));
  assert.equal((await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 3, { snapshot: bad }) })).status, 409);
  assert.equal((await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 2, { snapshot: pre.data.snapshot }) })).status, 400);
});

test('Level Hub: level lỗi kiểm định chặn xuất (422 kèm báo cáo), thiếu level cần xác nhận', async () => {
  const pack = await packOf3();
  await create(pack, 5, { level: 5, time: 0, items: [] });
  const r = await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 5) });
  assert.equal(r.status, 422);
  assert.deepEqual(r.data.report.errors.map(e => e.level), [5]);
  const missing = await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 4) });
  assert.equal(missing.status, 422);
  assert.equal(missing.data.report.missingTotal, 1);
  assert.equal((await A.post(`/api/packs/${pack}/levelhub/export`, { json: range(1, 4, { allow_missing: true }) })).status, 200);
});

test('BI: đẩy gói lên Level Hub, tên bộ dùng mã OS, BI nhận đúng gói đã kiểm tra', async () => {
  const pack = await packOf3();
  const pre = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: range(1, 3, { version: 'v7' }) });
  await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 5), headers: ifMatch(1) });
  const r = await upload(pack, range(1, 3, { version: 'v7', snapshot: pre.data.snapshot }), 'okokokokok');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.name, /^Sample_A_1_3_Global__a_\d{4}_v7$/);
  assert.equal(r.data.group.status, 'PROCESSING');
  assert.deepEqual(r.data.newer, [1]);
  assert.equal(r.data.recovered, false);
  const last = await (await fetch(`${FAKE_BI}/__last`)).json();
  assert.equal(last.name, r.data.name);
  assert.equal(last.appId, 'com.sample.game');
  assert.equal(files(Buffer.from(last.zip, 'base64'))['Raw/1.json'], JSON.stringify(level(1, 61, ['gem']), null, 2));
  const g = await A.get(`/api/bi/groups/${r.data.group.id}`, { headers: { 'X-BI-Token': biToken('okokokokok') } });
  assert.equal(g.data.name, r.data.name);
});

test('BI: lỗi 401/403/409/413 của BI ra 502 kèm bi_status và gợi ý; thiếu token BI là 400', async () => {
  const pack = await packOf3();
  for (const [mode, hint] of [['c401', /đăng nhập lại/], ['c403', /chưa có quyền Level Hub/], ['c409', /cùng tên/], ['c413', /quá lớn/]]) {
    const r = await upload(pack, range(1, 3), mode);
    assert.equal(r.status, 502, mode);
    assert.equal(r.data.bi_status, Number(mode.slice(1)));
    assert.match(r.data.detail, hint);
  }
  const none = await A.post(`/api/packs/${pack}/levelhub/upload`, { json: range(1, 3) });
  assert.equal(none.status, 400);
  assert.equal((await upload(pack, range(1, 3, { geo: [] }), 'okokokokok')).status, 400);
});

test('BI: mất phản hồi sau khi tạo bộ thì tìm lại bộ vừa tạo; không thấy thì cho đẩy lại', async () => {
  const pack = await packOf3();
  const lost = await upload(pack, range(1, 3, { version: 'v31' }), 'lostlostlo');
  assert.equal(lost.status, 200, JSON.stringify(lost.data));
  assert.equal(lost.data.recovered, true);
  assert.match(lost.data.group.name, /_v31$/);
  const none = await upload(pack, range(1, 3, { version: 'v32' }), 'nonenoneno');
  assert.equal(none.status, 502);
  assert.equal(none.data.bi_status, null);
  assert.match(none.data.detail, /đẩy lại được/);
  assert.ok(none.data.checked_at);
});

test('Đăng nhập Google của BI: token Firebase hợp lệ thành phiên của tool, sai thì 401, Origin lạ thì 403', async () => {
  const status = await call(null, 'GET', '/auth/status');
  assert.equal(status.data.bi, true);
  const cfg = await A.get('/api/bi/config');
  assert.equal(cfg.data.configured, true);
  assert.equal(cfg.data.firebase.apiKey, 'fake-key');
  const page = await call(null, 'GET', '/bi/login');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const login = token => call(null, 'POST', '/auth/firebase', { json: { idToken: token }, headers: { Origin: BASE } });
  const ok = await login(biToken('okokokokok'));
  assert.equal(ok.status, 200);
  assert.equal(ok.data.email, 'a@sonat.vn');
  assert.match(ok.headers.get('set-cookie'), /vl_sso=.+HttpOnly/i);
  const me = await call(null, 'GET', '/api/me', { headers: { Authorization: `Bearer ${ok.data.token}` } });
  assert.equal(me.data.email, 'a@sonat.vn');
  assert.equal((await login(biToken('badbadbadb'))).status, 401);
  const foreign = await call(null, 'POST', '/auth/firebase', { json: { idToken: biToken('okokokokok') }, headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.equal((await call(null, 'GET', '/api/me')).status, 401);
});

test('Level Hub: ngày tuỳ chọn, báo cáo trực quan, snapshot trùng / level đã xoá bị chặn', async () => {
  const pack = await packOf3();
  const body = range(1, 3, { date: '0511', why: 'update', version: 'v01', previews: true });
  const pre = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: body });
  assert.equal(pre.status, 200, JSON.stringify(pre.data));
  assert.match(pre.data.zipName, /_0511_v01\.zip$/);
  assert.ok(pre.data.rows.every(x => x.name && x.sha && Object.hasOwn(x, 'preview')));
  assert.ok(Array.isArray(pre.data.warnings));
  const snap = pre.data.snapshot;
  for (const patch of [{ snapshot: [snap[0], snap[0]] }, { snapshot: [snap[0], { ...snap[1], level: 1 }] },
    { date: '3213' }, { date: null }, { to_lv: 20001 }, { from_lv: 1e16, to_lv: 1e16 }, { previews: 'yes' }, { previews: null }]) {
    assert.equal((await A.post(`/api/packs/${pack}/levelhub/export`, { json: { ...body, ...patch } })).status, 400);
  }
  assert.equal((await A.del(`/api/packs/${pack}/levels/2`, { headers: ifMatch(1) })).status, 200);
  assert.equal((await A.post(`/api/packs/${pack}/levelhub/export`, { json: { ...body, snapshot: snap } })).status, 409);
});

test('Level Hub: cảnh báo trùng nội dung, đang sửa và bản mới hơn không chặn xuất', async () => {
  const pack = await newPack('hubwarnings');
  const raw = level(1, 60);
  await create(pack, 1, raw);
  await create(pack, 2, raw);
  await A.post(`/api/locks/packs/${pack}/levels/1`);
  const b = range(1, 2);
  const pre = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: b });
  assert.ok(pre.data.warnings.some(x => /Giống hệt/.test(x.text)));
  assert.ok(pre.data.warnings.some(x => /chưa lưu/.test(x.text)));
  await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 77), headers: ifMatch(1) });
  const checked = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: { ...b, snapshot: pre.data.snapshot } });
  assert.ok(checked.data.warnings.some(x => /bản mới nhất/.test(x.text)));
  assert.equal((await A.post(`/api/packs/${pack}/levelhub/export`, { json: { ...b, snapshot: pre.data.snapshot } })).status, 200);
});

test('Level Hub: kiểm tên trùng gợi ý version, giữ lỗi quyền BI và ghi lịch sử theo bộ', async () => {
  const pack = await packOf3();
  const body = range(1, 3, { date: '0105', why: 'update', version: 'v41' });
  const check = mode => A.post(`/api/packs/${pack}/levelhub/check`, { json: body, headers: { 'X-BI-Token': biToken(mode) } });
  const before = await check('namesnames');
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.available, true);
  const pushed = await upload(pack, body, 'namesnames');
  assert.equal(pushed.status, 200, JSON.stringify(pushed.data));
  const after = await check('namesnames');
  assert.equal(after.data.available, false);
  assert.equal(after.data.suggestion, 'v42');
  assert.equal(after.data.name, pushed.data.name);
  const denied = await check('deniedread');
  assert.equal(denied.status, 502);
  assert.equal(denied.data.bi_status, 403);
  const audit = await A.get(`/api/audit?pack=${pack}&action=levelhub.bi_upload`);
  assert.equal(audit.data[0].detail.group, pushed.data.group.id);
});

test('Level Hub Node: chỉ kèm ảnh game đúng sha, bỏ SVG / ảnh sơ đồ và tôn trọng tuỳ chọn ảnh', async t => {
  const me = await A.get('/api/me');
  if (!me.data.features?.thumbs) return t.skip('Ảnh game chỉ có trên Node');
  const pack = await packOf3();
  const body = range(1, 3, { previews: true });
  const pre = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: body });
  const [a, b] = pre.data.snapshot;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XQAAAAASUVORK5CYII=', 'base64');
  assert.equal((await A.put(`/api/thumbs/${a.sha}?source=capture`, { body: png, headers: { 'Content-Type': 'image/png' } })).status, 200);
  await A.put(`/api/thumbs/${b.sha}?source=render`, { body: '<svg/>', headers: { 'Content-Type': 'image/svg+xml' } });
  const available = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: body });
  assert.equal(available.data.previewCount, 1);
  assert.equal(available.data.rows[0].preview, 'png');
  const exported = await A.post(`/api/packs/${pack}/levelhub/export`, { json: { ...body, snapshot: pre.data.snapshot } });
  const entries = readZip(exported.bytes);
  assert.deepEqual(entries.filter(x => x.name.startsWith('Previews/')).map(x => x.name), ['Previews/1.png']);
  assert.deepEqual(entries.find(x => x.name === 'Previews/1.png').data, png);
  const without = await A.post(`/api/packs/${pack}/levelhub/export`, { json: { ...body, previews: false } });
  assert.equal(readZip(without.bytes).filter(x => x.name.startsWith('Previews/')).length, 0);
  await A.put(`/api/packs/${pack}/levels/1`, { json: level(1, 99), headers: ifMatch(1) });
  const latest = await A.post(`/api/packs/${pack}/levelhub/preflight`, { json: body });
  assert.equal(latest.data.previewCount, 0);
  const old = await A.post(`/api/packs/${pack}/levelhub/export`, { json: { ...body, snapshot: pre.data.snapshot } });
  assert.ok(readZip(old.bytes).some(x => x.name === 'Previews/1.png'));
});
