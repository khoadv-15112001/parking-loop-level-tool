import test from 'node:test';
import assert from 'node:assert/strict';
import { entryMatches, packEntry, packLink, parseHubName, remoteEntry } from '../../web/js/packsearch.mjs';

test('Level Hub name splits into OS, level range, region, purpose, designer and version', () => {
  assert.deepEqual(parseHubName('FrenzyHole_Android_6_10_Global_test3leveldau_longndt_1510_v17'), {
    game: 'FrenzyHole', os: 'Android', from: 6, to: 10, geo: 'Global', why: 'test3leveldau', designer: 'longndt', date: '1510', version: 'v17',
  });
  assert.equal(parseHubName('Sample_I_1_250_Tier1-Global_update_tester_0511_v01').os, 'iOS');
  assert.equal(parseHubName('game_android_600'), null);
});

test('local packs with the same level count still read differently', () => {
  const android = packEntry({ name: 'game_android_600', platform: 'android', level_count: 600, group: 'Test', description: 'Bộ thử tháng 11' });
  const ios = packEntry({ name: 'game_ios_600', platform: 'ios', level_count: 600, production: true });
  assert.deepEqual(android.facts, ['Nháp', 'Android', '600 level', 'Local', 'Nhóm Test']);
  assert.deepEqual(ios.facts, ['Production', 'iOS', '600 level', 'Local']);
  assert.ok(entryMatches(android, 'android nhap'));
  assert.ok(entryMatches(android, 'thang 11'));
  assert.ok(!entryMatches(ios, 'android'));
});

test('Level Hub packs show region and level range, unopened ones say so', () => {
  const opened = packEntry({ name: 'FrenzyHole_Android_11_20_Global_fixD12RR_longndt_2010_v11', platform: 'android', level_count: 10, description: 'levelhub:abc Nhập từ BI' }, { hub: true });
  assert.deepEqual(opened.facts, ['Nháp', 'Android', '10 level', 'Global', 'Level 11–20', 'fixD12RR', 'longndt', 'v11', 'Level Hub']);
  assert.equal(opened.note, 'Nhập từ BI');
  assert.ok(entryMatches(opened, 'level 11 global longndt'));
  const remote = remoteEntry({ id: 'g7', name: 'FrenzyHole_Android_551_600_Global_androidbadpractice_longndt_0111_v1', os: 'Android', status: 'active' });
  assert.equal(remote.value, 'hub:g7');
  assert.deepEqual(remote.facts.slice(0, 3), ['Chưa mở', 'Android', 'active']);
  assert.ok(entryMatches(remote, '551'));
});

test('pack link keeps other parameters and replaces the hash', () => {
  assert.equal(packLink('https://x.tools.sonatgame.com/app/?dev=1#lv', 'game ios_600'), 'https://x.tools.sonatgame.com/app/?dev=1&pack=game+ios_600');
});
