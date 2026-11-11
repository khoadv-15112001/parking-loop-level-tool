// Test riêng của server Node (node --test levelcore/node/tests): phần hợp đồng cần chỉnh đồng hồ và giao diện riêng của
// game (manifest "app"). Luồng đầy đủ nằm ở levelcore/contracts/v1, chạy với cả hai server.
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
import { createZip } from '../zip.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'sample');
const TOKEN = { Authorization: 'Bearer ci-test-token' };

async function start(t, manifestExtra = {}, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelcore-node-'));
  fs.cpSync(path.join(SAMPLE, 'web'), path.join(dir, 'web'), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  const manifest = { ...JSON.parse(fs.readFileSync(path.join(SAMPLE, 'manifest.json'), 'utf8')), ...manifestExtra };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const game = await loadGame(path.join(dir, 'manifest.json'), dir);
  const s = settingsFromEnv(manifest, {
    SAMPLELEVEL_DEV: '1', SAMPLELEVEL_DB: path.join(dir, 't.db'), SAMPLELEVEL_GAME_DIR: path.join(dir, 'game'),
    SAMPLELEVEL_ADMINS: 'a@sonat.vn', SAMPLELEVEL_CI_TOKEN: 'ci-test-token', SAMPLELEVEL_CI_BRANCH: 'main',
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
  return (p, init = {}) => fetch(base + p, { ...init, headers: { 'X-Dev-User': 'a@sonat.vn', ...(init.headers || {}) } });
}

test('CI: level chờ quá 2 giờ không có player thì bị bỏ, player tới sau không nhập', async t => {
  const get = await start(t);
  const levels = createZip([{ name: '1.json', data: JSON.stringify({ level: 1, time: 5, items: ['gem'] }) }]);
  const r = await get('/api/ci/levels?by=jenkins-7', { method: 'POST', body: levels, headers: TOKEN });
  assert.equal((await r.json()).status, 'waiting');
  advanceClock(2 * 3600 + 1);
  t.after(() => advanceClock(-(2 * 3600 + 1)));
  const rec = (await (await get('/api/game/builds')).json()).levels[0];
  assert.equal(rec.status, 'dropped');
  assert.match(rec.detail.reason, /2 giờ/);
  const player = createZip([{ name: 'index.html', data: 'x' }, { name: 'Build/p.loader.js', data: 'l' }]);
  const p = await (await get('/api/ci/webgl?by=jenkins-7&branch=main&buildNumber=7', { method: 'POST', body: player, headers: TOKEN })).json();
  assert.equal(p.status, 'current');
  assert.equal(p.levels, null);
  assert.equal((await get('/api/packs/develop/levels/1')).status, 404);
});

test('Giao diện riêng của game (manifest "app") thay vỏ của core; module core vẫn import được ở /core/', async t => {
  const get = await start(t, { app: 'ui', uiTemplate: 'sand-jam' }, { 'ui/index.html': '<html>game ui</html>' });
  assert.equal(await (await get('/app/')).text(), '<html>game ui</html>');
  const core = await get('/core/js/api.mjs');
  assert.equal(core.status, 200);
  assert.match(await core.text(), /setStoragePrefix/);
  assert.ok(core.headers.get('content-security-policy'));
});

test('Mẫu Sand Jam được phục vụ cho game khác, CSS riêng của game vẫn dùng được', async t => {
  const own = ':root { --lc-accent: rebeccapurple; }';
  const get = await start(t, { uiTemplate: 'sand-jam' }, { 'web/game.css': own });
  const [selected, direct, game] = await Promise.all([
    get('/core/ui-template.css'), get('/core/ui-templates/sand-jam/template.css'), get('/app/game/game.css'),
  ]);
  for (const r of [selected, direct, game]) {
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/css\b/);
  }
  const css = await selected.text();
  assert.match(css, /--lc-accent\s*:/);
  assert.equal(css, await direct.text());
  assert.equal(await game.text(), own);
});

test('Tên mẫu sai hoặc mẫu không có được báo trước khi mở DB', async () => {
  const game = await loadGame(path.join(SAMPLE, 'manifest.json'), SAMPLE);
  const s = settingsFromEnv(game.manifest, {});
  for (const id of [null, {}, '', '../sand-jam', 'Sand-Jam']) {
    game.manifest.uiTemplate = id;
    assert.throws(() => createApp(game, s), /uiTemplate phải là tên mẫu/);
  }
  game.manifest.uiTemplate = 'missing-template';
  assert.throws(() => createApp(game, s), /uiTemplate "missing-template" không có/);
});
