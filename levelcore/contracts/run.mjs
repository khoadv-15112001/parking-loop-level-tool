// Chạy bộ test hợp đồng v1 với từng server:  node levelcore/contracts/run.mjs [python|node|all]
// Mỗi runtime: dựng server với game mẫu (contracts/sample/manifest.json) trên DB tạm, BI giả (fake_bi.mjs) và token CI,
// đợi /healthz, chạy node --test contracts/v1/*.test.mjs với BASE_URL trỏ vào server đó, rồi tắt server.
// Python lấy từ $PYTHON hoặc .venv.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeBi } from './fake_bi.mjs';

const CI_TOKEN = 'ci-token-for-contract-tests';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.dirname(HERE);
const REPO = path.dirname(CORE);
const SAMPLE = path.join(HERE, 'sample', 'manifest.json');
const TESTS = fs.readdirSync(path.join(HERE, 'v1')).filter(f => f.endsWith('.test.mjs')).map(f => path.join(HERE, 'v1', f));

function python() {
  if (process.env.PYTHON) return process.env.PYTHON;
  for (const p of [path.join(REPO, '.venv', 'Scripts', 'python.exe'), path.join(REPO, '.venv', 'bin', 'python')]) {
    if (fs.existsSync(p)) return p;
  }
  return 'python';
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitHealthy(base, child, log) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`server thoát sớm (mã ${child.exitCode}):\n${log.join('')}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch { /* chưa mở cổng */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`server không trả /healthz sau 30 giây:\n${log.join('')}`);
}

function startServer(runtime, port, dir, bi) {
  const env = {
    ...process.env, LEVELCORE_GAME_MANIFEST: SAMPLE, SAMPLELEVEL_DEV: '1', SAMPLELEVEL_DB: path.join(dir, 'contract.db'),
    SAMPLELEVEL_ADMINS: 'a@sonat.vn', SAMPLELEVEL_PORT: String(port), SAMPLELEVEL_PUBLIC_BASE: `http://127.0.0.1:${port}`,
    SAMPLELEVEL_GAME_DIR: path.join(dir, 'game'), SAMPLELEVEL_CI_TOKEN: CI_TOKEN, SAMPLELEVEL_CI_BRANCH: 'main',
    SAMPLELEVEL_BI_API_URL: bi, SAMPLELEVEL_BI_APP_ID: 'com.sample.game', SAMPLELEVEL_BI_FIREBASE_API_KEY: 'fake-key',
    SAMPLELEVEL_BI_FIREBASE_AUTH_DOMAIN: 'fake.firebaseapp.com', SAMPLELEVEL_BI_FIREBASE_PROJECT_ID: 'fake',
    SAMPLELEVEL_BI_FIREBASE_APP_ID: '1:1:web:1', LEVELCORE_FIREBASE_LOOKUP_URL: `${bi}/lookup`,
  };
  if (runtime === 'python') {
    return spawn(python(), ['-m', 'uvicorn', '--factory', 'levelcore.main:get_app', '--host', '127.0.0.1', '--port', String(port), '--workers', '1'],
      { cwd: path.join(CORE, 'server'), env: { ...env, PYTHONPATH: path.join(CORE, 'server') } });
  }
  return spawn(process.execPath, [path.join(CORE, 'node', 'server.mjs')], { env });
}

async function run(runtime) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `levelcore-contract-${runtime}-`));
  const bi = await startFakeBi();
  const child = startServer(runtime, port, dir, bi.url);
  const log = [];
  child.stdout.on('data', d => log.push(String(d)));
  child.stderr.on('data', d => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitHealthy(base, child, log);
    console.log(`\n== ${runtime}: ${base}`);
    const code = await new Promise(resolve => {
      const t = spawn(process.execPath, ['--test', '--test-reporter=spec', ...TESTS], {
        stdio: 'inherit', env: { ...process.env, BASE_URL: base, FAKE_BI_URL: bi.url, CI_TOKEN },
      });
      t.on('exit', resolve);
    });
    return code;
  } finally {
    const exited = new Promise(r => (child.exitCode !== null ? r() : child.on('exit', r)));
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
    await exited;
    bi.server.closeAllConnections();
    bi.server.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      console.warn(`không xoá được thư mục tạm ${dir}: ${e.message}`);
    }
  }
}

const arg = process.argv[2] || 'all';
const runtimes = arg === 'all' ? ['python', 'node'] : [arg];
let failed = [];
for (const rt of runtimes) {
  if (!['python', 'node'].includes(rt)) throw new Error(`runtime không hợp lệ: ${rt} (python | node | all)`);
  if (await run(rt) !== 0) failed.push(rt);
}
if (failed.length) {
  console.error(`\nHợp đồng v1 lỗi ở: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\nHợp đồng v1 xanh: ${runtimes.join(', ')}`);
