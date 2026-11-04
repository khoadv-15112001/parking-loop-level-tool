// Thùng rác và quản trị của server Node, phần cần chỉnh đồng hồ: quá trashDays thì xoá hẳn (có bản chép ra purged/),
// lượt chơi vẫn giữ nội dung level; danh sách admin trong app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';
import { settingsFromEnv } from '../config.mjs';
import { loadGame } from '../game.mjs';
import { advanceClock } from '../store.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'sample', 'manifest.json');

async function start(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelcore-trash-'));
  const game = await loadGame(SAMPLE, dir);
  const s = settingsFromEnv(game.manifest, {
    SAMPLELEVEL_DEV: '1', SAMPLELEVEL_DB: path.join(dir, 't.db'), SAMPLELEVEL_GAME_DIR: path.join(dir, 'game'), ...env,
  });
  const { server } = createApp(game, s);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => {
    server.closeAllConnections();
    server.close(() => {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      r();
    });
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => async (method, p, json, headers = {}) => {
    const res = await fetch(base + p, {
      method, headers: { 'X-Dev-User': user, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { dir, as };
}

test('Quá số ngày giữ: level đã xoá và bộ lưu trữ bị xoá hẳn, có bản chép ra purged/, lượt chơi vẫn còn nội dung', async t => {
  const { dir, as } = await start(t);
  const A = as('a@sonat.vn');
  const body = { level: 7, time: 7, items: ['gem'] };
  await A('POST', '/api/packs', { name: 'old' });
  await A('POST', '/api/packs/old/levels/1', { level: 1, time: 5, items: ['gem'] });
  await A('POST', '/api/packs/develop/levels/7', body);
  await A('POST', '/api/plays', { uid: 'play-trash-0001', pack: 'develop', level: '7', source: 'draft', level_data: body });
  assert.equal((await A('DELETE', '/api/packs/develop/levels/7', null, { 'If-Match': '"r1"' })).status, 200);
  await A('PATCH', '/api/packs/old', { archived: true, archive_reason: 'bộ cũ' });
  assert.deepEqual((await A('POST', '/api/admin/housekeeping')).data.levels, 0);

  advanceClock(31 * 86400);
  t.after(() => advanceClock(-31 * 86400));
  const out = (await A('POST', '/api/admin/housekeeping')).data;
  assert.equal(out.levels, 1);
  assert.equal(out.packs, 1);
  assert.equal((await A('GET', '/api/packs/old/levels')).status, 404);
  assert.equal((await A('GET', '/api/packs/develop/levels?include_deleted=true')).data.length, 0);
  const day = fs.readdirSync(path.join(dir, 'purged'))[0];
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'purged', day, 'develop', '7.json'), 'utf8')), body);
  assert.ok(fs.statSync(path.join(dir, 'purged', day, 'old.zip')).size > 0);
  const play = (await A('GET', '/api/plays?pack=develop&level=7')).data[0];
  assert.deepEqual((await A('GET', `/api/plays/${play.id}`)).data.level_data, body);
});

test('Admin thêm trong app có quyền ngay, email sai bị chặn; server không DEV thì phải đăng nhập', async t => {
  const { as } = await start(t, { SAMPLELEVEL_DEV: '0', SAMPLELEVEL_ADMINS: 'a@sonat.vn', SAMPLELEVEL_SESSION_SECRET: 'x' });
  const dev = await start(t);
  const A = dev.as('a@sonat.vn'), B = dev.as('b@sonat.vn');
  const s = (await A('GET', '/api/admin/settings')).data;
  const saved = await A('PUT', '/api/admin/settings', { version: s.version, admins: ['b@sonat.vn', 'a@sonat.vn'] });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await B('GET', '/api/me')).data.admin, true);
  assert.equal((await B('PUT', '/api/admin/settings', { version: saved.data.version, admins: ['bad email'] })).status, 400);
  assert.equal((await as('a@sonat.vn')('GET', '/api/me')).status, 401);
});
