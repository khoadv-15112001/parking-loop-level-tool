// Bảng "Có gì mới" (game/web/releases.json) đúng khung changelog của core (levelcore/AGENTS.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { checkReleases } from '../../levelcore/web/js/releases.mjs';

test('Có gì mới đúng khung', () => {
  const entries = JSON.parse(fs.readFileSync(new URL('../web/releases.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkReleases(entries), []);
});
