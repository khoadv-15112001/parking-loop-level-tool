// Generator game mới (levelcore/tools/new_game.mjs): repo sinh ra chạy được ngay với server Node — test của game xanh,
// giao diện mặc định dựng từ manifest, không có file giao diện nào trong game/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';
import { settingsFromEnv } from '../config.mjs';
import { loadGame } from '../game.mjs';
import { scaffold } from '../../tools/new_game.mjs';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Repo tạm có levelcore/ trỏ (junction) vào core thật; dọn sau cùng, khi server của test đã tắt.
const repos = [];
test.after(() => {
  for (const repo of repos) {
    fs.unlinkSync(path.join(repo, 'levelcore'));
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
  }
});

function newRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'levelcore-newgame-'));
  fs.symlinkSync(CORE, path.join(repo, 'levelcore'), 'junction');
  repos.push(repo);
  return repo;
}

test('generator: chỉ sinh dữ liệu và luật, thay README / AGENTS của core, giữ file game đã có', async t => {
  const repo = newRepo();
  fs.writeFileSync(path.join(repo, 'README.md'), '# level-tool-core\n\nREADME của core\n');
  fs.writeFileSync(path.join(repo, 'bi.yaml'), 'slug: da-co\n');
  const { written, kept } = scaffold(repo, { tool: 'FishLevel', game: 'Fish Sort', prefix: 'FISHLEVEL', slug: 'fishsort', runtime: 'node', storage: 'fl' });
  assert.deepEqual(kept, ['bi.yaml']);
  assert.ok(written.includes('README.md') && written.includes('game/web/rules.mjs'));
  assert.ok(!written.some(f => /\.(css|html)$|game\.mjs$/.test(f)), `có file giao diện: ${written}`);
  const all = written.map(f => fs.readFileSync(path.join(repo, f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /__(TOOL|GAME|PREFIX|SLUG|STORAGE|RUNTIME|DOCKERFILE|DBFILE|PORT)__/);
  assert.match(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), /^# FishLevel/);
  assert.match(fs.readFileSync(path.join(repo, 'game', 'game.env'), 'utf8'), /RUNTIME=node/);
  assert.throws(() => scaffold(repo, { tool: 'X', game: 'X', prefix: 'X', slug: 'x' }), /đã có/);

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const own = spawnSync(process.execPath, ['--test', ...['rules', 'releases'].map(n => path.join(repo, 'game', 'tests', `${n}.test.mjs`))], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(own.status, 0, own.stdout + own.stderr);
});

test('generator: --raw chép tối đa 8 raw rải đều, giữ nguyên byte; --port vào game.env', () => {
  const repo = newRepo();
  const src = path.join(repo, 'raw-src');
  fs.mkdirSync(src);
  for (let n = 1; n <= 20; n++) fs.writeFileSync(path.join(src, `${n}.json`), `{\r\n  "n": ${n}.0\r\n}`);
  fs.writeFileSync(path.join(src, 'notes.txt'), 'x');
  const { written } = scaffold(repo, { tool: 'AntDemo', game: 'Antopia', prefix: 'ANTDEMO', slug: 'antdemo', port: '8893', raw: src });
  const raws = written.filter(f => f.startsWith('game/tests/raw/') && f.endsWith('.json'));
  assert.deepEqual(raws.map(f => Number.parseInt(path.basename(f), 10)), [1, 4, 6, 9, 12, 15, 17, 20]);
  assert.equal(fs.readFileSync(path.join(repo, raws[0]), 'utf8'), '{\r\n  "n": 1.0\r\n}');
  assert.match(fs.readFileSync(path.join(repo, 'game', 'game.env'), 'utf8'), /PORT=8893/);
  assert.ok(fs.existsSync(path.join(repo, '.gitattributes')));
});

test('generator: game sinh ra chạy trên server Node với giao diện mặc định của core', async t => {
  const repo = newRepo();
  scaffold(repo, { tool: 'FishLevel', game: 'Fish Sort', prefix: 'FISHLEVEL', slug: 'fishsort', runtime: 'node', storage: 'fl' });
  const game = await loadGame(path.join(repo, 'game', 'manifest.json'), repo);
  const s = settingsFromEnv(game.manifest, { FISHLEVEL_DEV: '1', FISHLEVEL_DB: path.join(repo, 'data', 't.db'), FISHLEVEL_GAME_DIR: path.join(repo, 'data', 'game') });
  const { server } = createApp(game, s);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = p => fetch(base + p, { headers: { 'X-Dev-User': 'a@sonat.vn' } });

  const gameMjs = await get('/app/game/game.mjs');
  assert.equal(gameMjs.status, 200);
  assert.match(await gameMjs.text(), /import \* as rules from '\.\/rules\.mjs'/);
  assert.equal((await (await get('/app/game/manifest.json')).json()).tool, 'FishLevel');
  assert.equal((await get('/app/game/rules.mjs')).status, 200);
  assert.equal(await (await get('/app/game/game.css')).text(), '');
  assert.equal((await (await get('/app/game/releases.json')).json())[0].version, '0.1.0');
  const created = await fetch(`${base}/api/packs/develop/levels/1`, { method: 'POST', headers: { 'X-Dev-User': 'a@sonat.vn', 'Content-Type': 'application/json' }, body: '{"grid":[[1,0],[0,1]]}' });
  assert.equal(created.status, 201);
});
