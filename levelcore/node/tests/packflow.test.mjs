// Quản lý bộ (server Node): mã bộ cố định, trạng thái và duyệt, bàn giao, nhân bản, version, so sánh, khôi phục,
// level dùng ở bộ nào và áp bản mới, số liệu người chơi từ BI (BI giả).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';
import { settingsFromEnv } from '../config.mjs';
import { loadGame } from '../game.mjs';
import { flagOf, winMetrics } from '../livebi.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'sample');
const ADMIN = 'a@sonat.vn';
const OTHER = 'b@sonat.vn';
const lv = (n, time = 60, items = ['gem', 'rock']) => ({ level: n, time, items });
const ifMatch = rev => ({ 'If-Match': `"r${rev}"` });

function serviceKey() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  return JSON.stringify({ private_key_id: 'k1', private_key: Buffer.from(pem).toString('base64') });
}

async function start(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelcore-packs-'));
  fs.cpSync(path.join(SAMPLE, 'web'), path.join(dir, 'web'), { recursive: true });
  fs.copyFileSync(path.join(SAMPLE, 'manifest.json'), path.join(dir, 'manifest.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const game = await loadGame(path.join(dir, 'manifest.json'), dir);
  const s = settingsFromEnv(manifest, {
    SAMPLELEVEL_DEV: '1', SAMPLELEVEL_DB: path.join(dir, 't.db'), SAMPLELEVEL_GAME_DIR: path.join(dir, 'game'), SAMPLELEVEL_ADMINS: ADMIN, ...env,
  });
  const app = createApp(game, s);
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => {
    app.server.closeAllConnections();
    app.server.close(() => {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      r();
    });
  }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const as = user => async (method, p, json, headers = {}) => {
    const res = await fetch(base + p, {
      method, headers: { 'X-Dev-User': user, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
  return { A: as(ADMIN), B: as(OTHER), app };
}

const packOf = async (A, name) => (await A('GET', '/api/packs')).data.find(p => p.name === name);

async function fill(A, pack, levels) {
  for (const [n, body] of Object.entries(levels)) {
    const r = await A('POST', `/api/packs/${pack}/levels/${n}`, body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
}

async function edit(user, pack, name, body) {
  const head = await user('GET', `/api/packs/${pack}/levels/${name}`);
  return user('PUT', `/api/packs/${pack}/levels/${name}`, body, ifMatch(head.data.rev));
}

async function remove(user, pack, name) {
  const head = await user('GET', `/api/packs/${pack}/levels/${name}`);
  return user('DELETE', `/api/packs/${pack}/levels/${name}`, undefined, ifMatch(head.data.rev));
}

test('Mã bộ: tự sinh theo acronym, không đổi khi đổi tên; mục đích, ghi chú, nơi đang chạy', async t => {
  const { A } = await start(t);
  const packs = (await A('GET', '/api/packs')).data;
  assert.deepEqual(packs.map(p => [p.name, p.code, p.status]), [['develop', 'SAMPLE-S01', 'draft'], ['product', 'SAMPLE-S02', 'live']]);
  const c = await A('POST', '/api/packs', { name: 'daily-1', purpose: 'daily' });
  assert.equal(c.status, 201);
  assert.deepEqual([c.data.code, c.data.purpose, c.data.owner], ['SAMPLE-S03', 'daily', ADMIN]);
  assert.equal((await A('POST', '/api/packs', { name: 'x', purpose: 'khác' })).status, 400);
  assert.equal((await A('POST', '/api/packs/daily-1/rename', { to: 'daily-01' })).status, 200);
  assert.equal((await packOf(A, 'daily-01')).code, 'SAMPLE-S03');
  assert.equal((await A('POST', '/api/packs', { name: 'daily-2' })).data.code, 'SAMPLE-S04');
  const me = (await A('GET', '/api/me')).data;
  assert.ok(me.features.packflow);
  assert.deepEqual(me.pack_purposes.map(p => p.key), ['main', 'daily', 'ab', 'event']);
  const patched = await A('PATCH', '/api/packs/daily-01', { notes: { goal: 'win 60%', todo: '' }, deploy: { remote_config: 'level_daily', ab_group: 'B' } });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.data.notes, { goal: 'win 60%' });
  assert.deepEqual(patched.data.deploy, { remote_config: 'level_daily', ab_group: 'B' });
});

test('Trạng thái: gửi duyệt khoá bộ, chỉ người có quyền duyệt, duyệt cần qua kiểm định', async t => {
  const { A, B } = await start(t);
  await fill(A, 'develop', { 1: lv(1), 2: lv(2) });
  assert.equal((await B('POST', '/api/packs/develop/status', { to: 'review' })).status, 400);
  const sent = await B('POST', '/api/packs/develop/status', { to: 'review', note: 'chỉnh level 1-2' });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.pack.status, 'review');
  assert.deepEqual([sent.data.pack.review.by, sent.data.pack.review.note], [OTHER, 'chỉnh level 1-2']);
  assert.equal((await edit(A, 'develop', '1', lv(1, 9))).status, 403);
  assert.equal((await B('POST', '/api/packs/develop/status', { to: 'live' })).status, 403);
  const live = await A('POST', '/api/packs/develop/status', { to: 'live' });
  assert.equal(live.status, 200);
  assert.deepEqual([live.data.pack.status, live.data.pack.production, live.data.pack.approved.by, live.data.pack.review], ['live', true, ADMIN, null]);
  assert.equal((await B('POST', '/api/packs/develop/status', { to: 'draft' })).status, 403);
  assert.equal((await A('POST', '/api/packs/develop/status', { to: 'archived' })).status, 400);
  const arch = await A('POST', '/api/packs/develop/status', { to: 'archived', note: 'thay bằng bộ mới' });
  assert.deepEqual([arch.data.pack.status, arch.data.pack.archive_reason], ['archived', 'thay bằng bộ mới']);
  const back = await A('POST', '/api/packs/develop/status', { to: 'draft' });
  assert.deepEqual([back.data.pack.status, back.data.pack.production], ['draft', false]);
  await A('POST', '/api/packs', { name: 'bad' });
  await A('POST', '/api/packs/bad/levels/1', { level: 1, time: 0, items: [] });
  const blocked = await A('POST', '/api/packs/bad/status', { to: 'live' });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.data.validation[0].level, '1');
  const legacy = await A('PATCH', '/api/packs/bad', { production: true });
  assert.equal(legacy.data.status, 'live');
});

test('Nhân bản bộ Live, sửa bản nháp, duyệt thì bộ Live nhận nội dung mới thành một version, bản nháp vào lưu trữ', async t => {
  const { A, B } = await start(t);
  await A('PATCH', '/api/packs/product', { production: false });
  await fill(A, 'product', { 1: lv(1), 2: lv(2), 3: lv(3) });
  await A('PATCH', '/api/packs/product', { production: true });
  const clone = await B('POST', '/api/packs/product/clone', { name: 'product-nhap' });
  assert.equal(clone.status, 201);
  assert.deepEqual([clone.data.status, clone.data.level_count, clone.data.owner], ['draft', 3, OTHER]);
  assert.deepEqual(clone.data.base, { code: 'SAMPLE-S02', name: 'product' });
  assert.equal((await edit(B, 'product-nhap', '2', lv(2, 99))).status, 200);
  assert.equal((await remove(B, 'product-nhap', '3')).status, 200);
  await B('POST', '/api/packs/product-nhap/status', { to: 'review', note: 'tăng time level 2, bỏ level 3' });
  const ok = await A('POST', '/api/packs/product-nhap/status', { to: 'live' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.applied_to, { name: 'product', code: 'SAMPLE-S02' });
  assert.deepEqual([ok.data.version.no, ok.data.pack.status], [1, 'archived']);
  assert.match(ok.data.pack.archive_reason, /product v1/);
  assert.deepEqual((await A('GET', '/api/packs/product/levels')).data.map(l => l.name), ['1', '2']);
  assert.equal((await A('GET', '/api/packs/product/levels/2')).data.level.time, 99);
  const [v] = (await A('GET', '/api/packs/product/versions')).data;
  assert.deepEqual([v.kind, v.author, v.reviewer, v.note, v.levels], ['apply', OTHER, ADMIN, 'tăng time level 2, bỏ level 3', 2]);
});

test('Version: chốt tay, so sánh Sửa / Thay / Đổi chỗ / Thêm / Bớt, khôi phục cả bộ về một version', async t => {
  const { A, B } = await start(t);
  await fill(A, 'develop', { 1: lv(1, 10), 2: lv(2, 20), 3: lv(3, 30), 4: lv(4, 40, ['star']) });
  assert.equal((await A('POST', '/api/packs/develop/versions', {})).status, 400);
  const v1 = await A('POST', '/api/packs/develop/versions', { note: 'bản đầu' });
  assert.equal(v1.status, 201);
  assert.equal(v1.data.no, 1);
  await edit(A, 'develop', '1', lv(1, 11));
  await A('POST', '/api/packs', { name: 'other' });
  await fill(A, 'other', { 9: lv(9, 77, ['lava']) });
  await A('POST', '/api/promote', { from: 'other', to: 'develop', items: [{ name: '9', to: '2' }] });
  await A('POST', '/api/packs/develop/levels/3/relevel', { to: '5', mode: 'swap' }, ifMatch(1));
  await remove(A, 'develop', '4');
  const d = (await A('GET', '/api/diff?a=develop@1&b=develop')).data;
  assert.deepEqual(d.counts, { same: 0, edited: 1, replaced: 1, moved: 1, added: 0, removed: 2 });
  const kinds = Object.fromEntries(d.items.map(i => [i.level, i.kind]));
  assert.deepEqual(kinds, { 1: 'edited', 2: 'replaced', 3: 'removed', 4: 'removed', 5: 'moved' });
  assert.equal(d.items.find(i => i.level === 5).from, 3);
  assert.equal(d.a.label, 'SAMPLE-S01 v1');
  const side = (await A('GET', '/api/diff?a=develop&b=other')).data;
  assert.equal(side.counts.removed + side.counts.added + side.counts.moved + side.counts.replaced + side.counts.edited > 0, true);
  const restored = await B('POST', '/api/packs/develop/versions/1/restore', { note: 'quay lại bản đầu' });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual([restored.data.restored_from, restored.data.version.no], [1, 2]);
  const now = (await A('GET', '/api/diff?a=develop@1&b=develop')).data;
  assert.equal(now.items.length, 0);
  assert.equal((await A('GET', '/api/packs/develop/versions/2')).data.items.length, 4);
  assert.equal((await A('POST', '/api/packs/product/versions/1/restore', {})).status, 404);
});

test('Khôi phục bộ Live cần quyền duyệt; lần đẩy BI chỉ khôi phục trong dải đã đẩy', async t => {
  const { A, B, app } = await start(t);
  await A('PATCH', '/api/packs/product', { production: false });
  await fill(A, 'product', { 1: lv(1), 2: lv(2), 3: lv(3) });
  await A('PATCH', '/api/packs/product', { production: true, });
  const flowRecord = app.store.db.write(() => {
    const items = [{ level: 1, name: '1', rev: 1, sha: app.store.listLevels('product')[0].sha }];
    const p = app.store.pack('product');
    const id = Number(app.store.db.run(`INSERT INTO pack_versions(code,no,pack,kind,note,author,created_at,from_lv,to_lv,levels)
      VALUES(?,1,'product','push','',?,0,1,1,1)`, p.code, ADMIN).lastInsertRowid);
    for (const it of items) app.store.db.run('INSERT INTO pack_version_levels(version_id,level,name,rev,sha) VALUES(?,?,?,?,?)', id, it.level, it.name, it.rev, it.sha);
    return id;
  });
  assert.ok(flowRecord);
  await A('PATCH', '/api/packs/product', { production: false });
  await edit(A, 'product', '1', lv(1, 5));
  await edit(A, 'product', '3', lv(3, 5));
  await A('PATCH', '/api/packs/product', { production: true });
  assert.equal((await B('POST', '/api/packs/product/versions/1/restore', {})).status, 403);
  const r = await A('POST', '/api/packs/product/versions/1/restore', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.changed, 1);
  assert.equal((await A('GET', '/api/packs/product/levels/1')).data.level.time, 60);
  assert.equal((await A('GET', '/api/packs/product/levels/3')).data.level.time, 5);
});

test('Bàn giao: người phụ trách hoặc admin, có lịch sử', async t => {
  const { A, B } = await start(t);
  await B('POST', '/api/packs', { name: 'mine' });
  assert.equal((await A('POST', '/api/packs/mine/handover', { to: 'sai' })).status, 400);
  const h = await B('POST', '/api/packs/mine/handover', { to: 'c@sonat.vn', note: 'đang dở level 40-60' });
  assert.equal(h.status, 200);
  assert.equal(h.data.owner, 'c@sonat.vn');
  assert.equal((await B('POST', '/api/packs/mine/handover', { to: OTHER })).status, 403);
  assert.equal((await A('POST', '/api/packs/mine/handover', { to: OTHER })).status, 200);
  const list = (await A('GET', '/api/packs/mine/handovers')).data;
  assert.deepEqual(list.map(x => [x.from, x.to]), [['c@sonat.vn', OTHER], [OTHER, 'c@sonat.vn']]);
  assert.equal(list[1].note, 'đang dở level 40-60');
});

test('Level dùng ở bộ nào: cùng nội dung (kể cả khác số), bộ đang giữ bản cũ; áp bản mới sang bộ khác', async t => {
  const { A, B } = await start(t);
  await fill(A, 'develop', { 1: lv(1, 10) });
  await A('POST', '/api/packs', { name: 'ab-b' });
  await A('POST', '/api/packs', { name: 'event' });
  await A('POST', '/api/promote', { from: 'develop', to: 'ab-b', items: [{ name: '1', to: '7' }] });
  await A('POST', '/api/promote', { from: 'develop', to: 'event', items: [{ name: '1', to: '3' }] });
  let u = (await A('GET', '/api/packs/develop/levels/1/usage')).data;
  assert.deepEqual(u.same.map(x => [x.pack, x.name]), [['ab-b', '7'], ['event', '3']]);
  assert.deepEqual(u.older, []);
  await edit(A, 'develop', '1', lv(1, 15));
  u = (await A('GET', '/api/packs/develop/levels/1/usage')).data;
  assert.deepEqual(u.same, []);
  assert.deepEqual(u.older.map(x => [x.pack, x.name, x.code]), [['ab-b', '7', 'SAMPLE-S03'], ['event', '3', 'SAMPLE-S04']]);
  assert.equal((await B('POST', '/api/packs/develop/levels/1/apply', { targets: [{ pack: 'product', name: '1' }] })).status, 403);
  assert.equal((await A('POST', '/api/packs/develop/levels/1/apply', { targets: [{ pack: 'develop', name: '2' }] })).status, 400);
  await A('POST', '/api/packs/event/status', { to: 'review', note: 'chờ' });
  const applied = await B('POST', '/api/packs/develop/levels/1/apply', { targets: [{ pack: 'ab-b', name: '7' }, { pack: 'event', name: '3' }] });
  assert.equal(applied.status, 200);
  const res = Object.fromEntries(applied.data.results.map(r => [r.pack, r]));
  assert.equal(res['ab-b'].rev, 2);
  assert.match(res.event.error, /chờ duyệt/);
  const lvB = (await A('GET', '/api/packs/ab-b/levels/7')).data.level;
  assert.deepEqual(lvB, lv(7, 15));
  u = (await A('GET', '/api/packs/develop/levels/1/usage')).data;
  assert.deepEqual(u.same.map(x => x.pack), ['ab-b']);
});

test('Số liệu BI: đồng bộ bộ Live Main, gắn theo nội dung, level sửa sau khi đo là live cũ, cảnh báo theo ngưỡng', async t => {
  const { A, B, app } = await start(t, {
    SAMPLELEVEL_BI_API_URL: 'https://bi.example', SAMPLELEVEL_BI_SERVICE_ACCOUNT_KEY: serviceKey(), SAMPLELEVEL_BI_APP_ID: 'com.sample.game',
  });
  await A('PATCH', '/api/packs/product', { production: false, purpose: 'main' });
  await fill(A, 'product', { 1: lv(1, 61), 2: lv(2, 62), 3: lv(3, 63), 4: lv(4, 61) });
  await A('PATCH', '/api/packs/product', { production: true });
  await A('POST', '/api/promote', { from: 'product', to: 'develop', items: [{ name: '2', to: '8' }] });
  const calls = [];
  app.live.client.fetch = async url => {
    const u = new URL(url);
    calls.push(u.pathname);
    assert.equal(u.searchParams.get('appId'), 'com.sample.game');
    assert.ok(u.searchParams.get('startDate'));
    const rows = {
      '/levels/win': [
        { level: 1, user_start_count: 100, start_count: 150, win_count: 90, user_first_win: 80, user_win: 90, play_time_avg: 40 },
        { level: 2, user_start_count: 100, start_count: 400, win_count: 60, user_first_win: 20, user_win: 60, play_time_avg: 90 },
        { level: 3, user_start_count: 5, start_count: 5, win_count: 5, user_first_win: 5, user_win: 5 },
      ],
      '/levels/dropoff': [{ level: 2, user_count: 100, drop_rate: 0.2 }],
      '/levels/loss-cause': [{ level: 2, lose_cause: 'out_of_moves', lose_count: 300, user_lose: 80 }],
    }[u.pathname] || [];
    return new Response(JSON.stringify({ data: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.equal((await A('GET', '/api/me')).data.features.live, true);
  assert.equal((await B('POST', '/api/live/sync')).status, 403);
  const st = await A('POST', '/api/live/sync');
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.deepEqual(st.data.sources.Android, { name: 'product', code: 'SAMPLE-S02' });
  for (let i = 0; i < 100 && (await A('GET', '/api/live')).data.job; i++) await new Promise(r => setTimeout(r, 20));
  const status = (await A('GET', '/api/live')).data;
  assert.equal(status.runs[0].status, 'done', JSON.stringify(status.runs[0]));
  assert.deepEqual(calls.sort(), ['/levels/booster-used', '/levels/dropoff', '/levels/failure-types', '/levels/loss-cause', '/levels/win']);
  const p = (await A('GET', '/api/packs/product/live')).data;
  assert.deepEqual(Object.keys(p.levels).sort(), ['1', '2', '3', '4']);
  assert.deepEqual([p.levels['1'].Android.slot, p.levels['1'].Android.flag], [1, null]);
  assert.deepEqual([p.levels['2'].Android.slot, p.levels['2'].Android.flag], [2, 'bad']);
  assert.equal(p.levels['3'].Android.enough, false);
  assert.equal(p.levels['4'].Android.slot, 1);
  const dev = (await A('GET', '/api/packs/develop/live')).data;
  assert.equal(dev.levels['8'].Android.slot, 2);
  const detail = (await A('GET', '/api/packs/product/levels/2/live')).data;
  assert.equal(detail.stats[0].loss.out_of_moves.loseCount, 300);
  await A('PATCH', '/api/packs/product', { production: false });
  await edit(A, 'product', '2', lv(2, 120));
  const stale = (await A('GET', '/api/packs/product/live')).data;
  assert.deepEqual([stale.levels['2'].Android.stale, stale.levels['2'].Android.flag], [true, null]);
  assert.equal((await A('GET', '/api/packs/develop/live')).data.levels['8'].Android.stale, false);
});

test('Ngưỡng cảnh báo số liệu BI', () => {
  const cfg = { hardWin: 0.25, warnWin: 0.4, warnDrop: 0.08 };
  const m = (first, users = 100) => winMetrics({ user_start_count: users, start_count: users, win_count: first, user_first_win: first, user_win: first }, 20);
  assert.equal(flagOf(m(50), cfg), null);
  assert.equal(flagOf(m(30), cfg), 'warn');
  assert.equal(flagOf(m(10), cfg), 'bad');
  assert.equal(flagOf({ ...m(60), drop: { dropRate: 0.1 } }, cfg), 'warn');
  assert.equal(flagOf(m(1, 5), cfg), null);
});
