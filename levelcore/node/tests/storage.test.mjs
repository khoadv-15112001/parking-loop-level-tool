import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { maintainBackups, compressBackup, storageUsage, requireStorage, STORAGE_LIMIT, STORAGE_RESERVE } from '../storage.mjs';
import { Builds } from '../webgame.mjs';
import { createZip } from '../zip.mjs';

const NAME = /^tool-\d{8}-\d{6}\.db(?:\.gz)?$/;

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a full tool refuses extraction and preserves the current game', async t => {
  const dir = directory(t);
  const builds = new Builds({ dbPath: path.join(dir, 'tool.db'), gameDir: path.join(dir, 'game') });
  const zip = path.join(dir, 'build.zip');
  fs.writeFileSync(zip, createZip([{ name: 'index.html', data: 'game' }, { name: 'Build/game.loader.js', data: 'loader' }]));
  await builds.installNow(zip, 'admin');
  const current = builds.info().id;
  const loose = path.join(dir, 'leftover.zip');
  fs.writeFileSync(loose, 'extra');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (...args) => {
    const stat = lstat(...args);
    if (args[0] === loose) stat.size = 1_400_000_000;
    return stat;
  });
  const second = path.join(dir, 'second.zip');
  fs.writeFileSync(second, createZip([{ name: 'index.html', data: 'next' }, { name: 'Build/game.loader.js', data: 'loader' }]));
  await assert.rejects(builds.installNow(second, 'admin'), error => error.status === 507);
  assert.equal(builds.info().id, current);
  assert.equal(fs.readFileSync(path.join(builds.dir, 'index.html'), 'utf8'), 'game');
});

test('build retention keeps the current game and latest waiting build while pruning old copies by bytes', async t => {
  const dir = directory(t);
  const builds = new Builds({ dbPath: path.join(dir, 'tool.db'), gameDir: path.join(dir, 'game') });
  const install = async (name, activate) => {
    const zip = path.join(dir, `${name}.zip`);
    fs.writeFileSync(zip, createZip([{ name: 'index.html', data: name }, { name: 'Build/game.loader.js', data: 'loader' }]));
    return (await builds.installNow(zip, 'admin', { activate })).build.id;
  };
  const old = await install('old', true);
  const current = await install('current', true);
  const firstWaiting = await install('waiting-1', false);
  const latestWaiting = await install('waiting-2', false);
  assert.equal(builds.find(firstWaiting), null);
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (...args) => {
    const stat = lstat(...args);
    if (args[0] === path.join(builds.buildsDir, old, 'index.html')) stat.size = 800_000_000;
    return stat;
  });
  assert.deepEqual(builds.prune(), [old]);
  assert.equal(builds.find(current), 'current');
  assert.equal(builds.find(latestWaiting), 'stored');
});

test('legacy backups are compressed without changing their dates and restore as valid SQLite databases', async t => {
  const dir = directory(t);
  const file = path.join(dir, 'tool-20260101-000000.db');
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE levels(name TEXT); INSERT INTO levels VALUES ('Level 1');");
  db.close();
  const raw = fs.readFileSync(file);
  const date = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(file, date, date);
  await maintainBackups(dir, NAME);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(zlib.gunzipSync(fs.readFileSync(`${file}.gz`)), raw);
  assert.equal(fs.statSync(`${file}.gz`).mtimeMs, date.getTime());
  const restored = path.join(dir, 'restored.db');
  fs.writeFileSync(restored, zlib.gunzipSync(fs.readFileSync(`${file}.gz`)));
  const check = new DatabaseSync(restored);
  assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(check.prepare('SELECT name FROM levels').get().name, 'Level 1');
  check.close();
  assert.deepEqual(await maintainBackups(dir, NAME), []);
});

test('a corrupt compressed copy never causes the original backup to be deleted', async t => {
  const dir = directory(t);
  const file = path.join(dir, 'tool-20260101-000000.db');
  fs.writeFileSync(file, 'original backup');
  fs.writeFileSync(`${file}.gz`, 'broken gzip');
  await assert.rejects(compressBackup(file));
  assert.equal(fs.readFileSync(file, 'utf8'), 'original backup');
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false);
});

test('retention uses both count and bytes, keeps the newest even over budget and leaves unrelated files alone', async t => {
  const dir = directory(t);
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(dir, `tool-2026010${i}-000000.db.gz`), Buffer.alloc(30));
  fs.writeFileSync(path.join(dir, 'manual.db'), 'keep');
  await maintainBackups(dir, NAME, 7, 100);
  assert.deepEqual(fs.readdirSync(dir).filter(name => NAME.test(name)).sort(), [7, 8, 9].map(i => `tool-2026010${i}-000000.db.gz`));
  await maintainBackups(dir, NAME, 7, 1);
  assert.deepEqual(fs.readdirSync(dir).filter(name => NAME.test(name)), ['tool-20260109-000000.db.gz']);
  assert.equal(fs.readFileSync(path.join(dir, 'manual.db'), 'utf8'), 'keep');
});

test('storage counts archives and loose files once and leaves room for temporary data', t => {
  const dir = directory(t);
  const archive = path.join(dir, 'plays-archive');
  fs.mkdirSync(archive);
  fs.writeFileSync(path.join(archive, 'old.gz'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'leftover.zip'), Buffer.alloc(200));
  assert.equal(storageUsage([dir, archive, dir]).bytes, 300);
  class LimitError extends Error { constructor(status, message) { super(message); this.status = status; } }
  requireStorage([dir], STORAGE_LIMIT - STORAGE_RESERVE - 300, LimitError);
  assert.throws(() => requireStorage([dir], STORAGE_LIMIT - STORAGE_RESERVE - 299, LimitError), error => error.status === 507);
});
