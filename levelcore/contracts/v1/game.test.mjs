// Hợp đồng: bản game WebGL (file Brotli thật, nhiều bản build) và nhận player + level từ CI (hợp đồng CI v1).
// Các test trong file chạy lần lượt và dùng chung bản game của server; file khác không đụng bản game.
import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { A, B, call, ifMatch, level, zipOf } from './client.mjs';

const CI = { Authorization: `Bearer ${process.env.CI_TOKEN}` };
const WASM = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31) % 251));

const player = tag => zipOf({
  'WebGL/index.html': `<html>${tag}</html>`, 'WebGL/Build/p.loader.js': `loader ${tag}`,
  'WebGL/Build/p.wasm.br': zlib.brotliCompressSync(WASM), 'WebGL/Build/p.data.gz': zlib.gzipSync(Buffer.from(`data ${tag}`)),
});
const levelsZip = levels => zipOf(Object.fromEntries(Object.entries(levels).map(([n, body]) => [`Levels/${n}.json`, body])));
const zipHeaders = { 'Content-Type': 'application/zip' };
const ciLevels = (by, body) => call(null, 'POST', `/api/ci/levels?by=${by}`, { body, headers: { ...CI, ...zipHeaders } });
function ciPlayer(by, branch, buildNumber, body) {
  const q = new URLSearchParams({ by, version: `1.0.${buildNumber}`, commit: 'abc123', branch, buildNumber: String(buildNumber), buildUrl: `https://ci.example/job/${encodeURIComponent(branch)}/${buildNumber}/` });
  return call(null, 'POST', `/api/ci/webgl?${q}`, { body, headers: { ...CI, ...zipHeaders } });
}
const page = async () => (await A.get('/game/index.html')).bytes.toString('utf8');
const builds = async () => (await A.get('/api/game/builds')).data;
const levelOf = async n => (await A.get(`/api/packs/develop/levels/${n}`)).data;

test('Bản game: file Brotli thật trả Content-Encoding br và MIME wasm, có ETag; chỉ admin tải lên', async () => {
  assert.equal((await B.post('/api/game/upload', { body: player('one'), headers: zipHeaders })).status, 403);
  const up = await A.post('/api/game/upload?name=one.zip', { body: player('one'), headers: zipHeaders });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.available, true);
  assert.equal(up.data.uploaded_by, 'a@sonat.vn');
  assert.equal(await page(), '<html>one</html>');
  const wasm = await A.get('/game/Build/p.wasm.br');
  assert.equal(wasm.headers.get('content-encoding'), 'br');
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.deepEqual(wasm.bytes, WASM);
  const data = await A.get('/game/Build/p.data.gz');
  assert.equal(data.headers.get('content-encoding'), 'gzip');
  assert.equal(data.bytes.toString('utf8'), 'data one');
  const again = await A.get('/game/index.html', { headers: { 'If-None-Match': wasm.headers.get('etag') } });
  assert.equal(again.status, 200);
  const etag = (await A.get('/game/index.html')).headers.get('etag');
  assert.equal((await A.get('/game/index.html', { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await A.get('/game/levelcore_game.json')).status, 404);
});

test('Bản game: zip lỗi bị từ chối và giữ nguyên bản đang dùng', async () => {
  for (const body of [Buffer.from('not a zip'), zipOf({ 'index.html': 'x' }), zipOf({ 'Build/a.loader.js': 'l' })]) {
    assert.equal((await A.post('/api/game/upload', { body, headers: zipHeaders })).status, 400);
  }
  assert.equal(await page(), '<html>one</html>');
});

test('CI: chỉ nhận token CI; token CI không gọi được API người dùng', async () => {
  assert.equal((await call(null, 'GET', '/api/ci/status')).status, 401);
  assert.equal((await call(null, 'GET', '/api/ci/status', { headers: { Authorization: 'Bearer sai' } })).status, 401);
  assert.equal((await call('a@sonat.vn', 'GET', '/api/ci/status')).status, 401);
  const ok = await call(null, 'GET', '/api/ci/status', { headers: CI });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.branch, 'main');
  assert.equal(ok.data.pack, 'develop');
  assert.equal((await call(null, 'GET', '/api/me', { headers: CI })).status, 401);
  assert.equal((await call(null, 'GET', '/api/packs', { headers: CI })).status, 401);
});

test('CI: build nhánh theo dõi lên ngay kèm level; nhánh khác cùng số build nằm chờ, level chưa nhập; admin chọn thì nhập', async () => {
  const main = await ciLevels('jenkins-57', levelsZip({ 1: level(1, 40), 2: level(2, 41) }));
  assert.equal(main.status, 200, JSON.stringify(main.data));
  assert.equal(main.data.status, 'waiting');
  const pm = await ciPlayer('jenkins-57', 'main', 57, player('main-57'));
  assert.equal(pm.status, 200, JSON.stringify(pm.data));
  assert.equal(pm.data.status, 'current');
  assert.equal(pm.data.levels.status, 'imported');
  assert.equal(pm.data.levels.detail.created, 2);
  assert.equal(await page(), '<html>main-57</html>');
  assert.equal((await levelOf(1)).level.time, 40);
  assert.equal((await levelOf(1)).author, 'ci:jenkins-57');

  const feat = await ciLevels('jenkins-57', levelsZip({ 1: level(1, 70), 2: level(2, 41) }));
  assert.equal(feat.data.status, 'waiting');
  const pf = await ciPlayer('jenkins-57', 'feature/x', 57, player('feature-57'));
  assert.equal(pf.data.status, 'waiting');
  assert.equal(pf.data.levels.status, 'waiting');
  assert.equal(pf.data.levels.build, pf.data.build.id);
  assert.notEqual(pf.data.build.id, pm.data.build.id);
  assert.equal(await page(), '<html>main-57</html>');
  assert.equal((await levelOf(1)).level.time, 40);

  const again = await ciPlayer('jenkins-57', 'main', 57, player('main-57'));
  assert.equal(again.data.status, 'unchanged');
  const list = await builds();
  assert.deepEqual(list.builds.filter(b => b.current).map(b => b.id), [pm.data.build.id]);
  assert.equal(list.builds.find(b => b.id === pf.data.build.id).status, 'waiting');

  assert.equal((await B.post(`/api/game/builds/${pf.data.build.id}/activate`)).status, 403);
  const act = await A.post(`/api/game/builds/${pf.data.build.id}/activate`);
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal(act.data.build.id, pf.data.build.id);
  assert.deepEqual(act.data.levels.map(x => x.status), ['imported']);
  assert.equal(await page(), '<html>feature-57</html>');
  assert.equal((await levelOf(1)).level.time, 70);

  const back = await A.post(`/api/game/builds/${pm.data.build.id}/activate`);
  assert.equal(back.status, 200);
  assert.equal(await page(), '<html>main-57</html>');
});

test('CI: hai request cùng artifact gửi đồng thời chỉ cài một lần', async () => {
  const body = player('main-58');
  const [x, y] = await Promise.all([ciPlayer('jenkins-58', 'main', 58, body), ciPlayer('jenkins-58', 'main', 58, body)]);
  assert.deepEqual([x.data.status, y.data.status].sort(), ['current', 'unchanged']);
  assert.equal(x.data.build.id, y.data.build.id);
  assert.equal(await page(), '<html>main-58</html>');
});

test('CI: level giống lần nhập trước thì bỏ qua; level GD đã sửa không bị CI ghi đè', async () => {
  const dup = await ciLevels('jenkins-59', levelsZip({ 1: level(1, 40), 2: level(2, 41) }));
  assert.equal(dup.data.status, 'duplicate');

  const head = await levelOf(2);
  const edited = await A.put('/api/packs/develop/levels/2', { json: level(2, 5), headers: ifMatch(head.rev) });
  assert.equal(edited.status, 200);
  await ciLevels('jenkins-60', levelsZip({ 1: level(1, 70), 2: level(2, 42), 3: level(3, 43) }));
  const p = await ciPlayer('jenkins-60', 'main', 60, player('main-60'));
  assert.equal(p.data.levels.status, 'imported');
  assert.equal(p.data.levels.detail.conflict, 1);
  assert.equal(p.data.levels.detail.created, 1);
  assert.equal((await levelOf(2)).level.time, 5);
  assert.equal((await levelOf(3)).level.time, 43);
});

test('CI: player lỗi bỏ level chờ cùng lần chạy và giữ bản đang dùng', async () => {
  const lv = await ciLevels('jenkins-61', levelsZip({ 9: level(9, 9) }));
  assert.equal(lv.data.status, 'waiting');
  const bad = await ciPlayer('jenkins-61', 'main', 61, zipOf({ 'index.html': 'no loader' }));
  assert.equal(bad.status, 400);
  const r = (await builds()).levels.find(x => x.digest === lv.data.levels.digest);
  assert.equal(r.status, 'dropped');
  assert.match(r.detail.reason, /player lỗi/);
  assert.equal(await page(), '<html>main-60</html>');
  assert.equal((await A.get('/api/packs/develop/levels/9')).status, 404);
  assert.equal((await ciLevels('jenkins-61', Buffer.from('{}'))).status, 400);
});
