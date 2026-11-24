// Test của Parking Loop: node --test game/tests/*.test.mjs
// Đặt vài level raw thật vào game/tests/raw/<số>.json: test kiểm luật nhận chúng và báo khi raw đổi qua JSON.parse/stringify
// (vd 1.0 thành 1, key số bị xếp lại, số nguyên lớn hơn 2^53) — tool lưu level đã qua JSON.parse.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { blankLevel, validateLevel } from '../web/rules.mjs';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'raw');
const raws = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter(f => /^\d+\.json$/.test(f)) : [];
const minify = text => text.replace(/("(?:\\.|[^"\\])*")|\s+/g, (m, str) => str || '');

test('level do blankLevel tạo hợp lệ', () => {
  const v = validateLevel(blankLevel(1), { levelNo: 1 });
  assert.equal(v.isValid, true, v.errors.join('; '));
});

test('raw thật của game hợp lệ', { skip: raws.length ? false : 'chưa có raw trong game/tests/raw' }, () => {
  for (const f of raws) {
    const v = validateLevel(JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')), { levelNo: Number.parseInt(f, 10) });
    assert.equal(v.isValid, true, `${f}: ${v.errors.join('; ')}`);
  }
});

test('raw giữ nguyên khi qua JSON', { skip: raws.length ? false : 'chưa có raw trong game/tests/raw' }, t => {
  for (const f of raws) {
    const text = fs.readFileSync(path.join(RAW, f), 'utf8').replace(/^\uFEFF/, '');
    if (JSON.stringify(JSON.parse(text)) !== minify(text)) t.diagnostic(`${f} đổi khi qua JSON.parse/stringify — báo core nếu game cần giữ đúng định dạng`);
  }
});
