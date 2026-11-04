// Zip mọi <số>.json của một thư mục (vd game/tests/raw) để nhập vào tool, không cần lệnh zip của hệ điều hành:
//   node levelcore/tools/zip_raw.mjs <thư mục> <file zip ra>
import fs from 'node:fs';
import path from 'node:path';
import { createZip } from '../node/zip.mjs';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('Cách dùng: node levelcore/tools/zip_raw.mjs <thư mục> <file zip ra>');
  process.exit(2);
}
const files = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
if (!files.length) {
  console.error(`${dir} không có file <số>.json`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, createZip(files.map(f => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }))));
console.log(`Đã zip ${files.length} level: ${out}`);
