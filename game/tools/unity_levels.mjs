// Chuyển level giữa thư mục Unity (Assets/_Game/Levels/Level_NNNN[_v].json) và zip <số>.json của tool. Giữ nguyên byte.
//
//   node game/tools/unity_levels.mjs zip   <thư mục Levels của Unity> [thư mục ra = data/unity]
//       → <ra>/a.zip (Level_NNNN.json, biến thể a), <ra>/x.zip (Level_NNNN_x.json)… mỗi zip nhập vào một bộ của tool.
//   node game/tools/unity_levels.mjs unzip <zip xuất từ tool> <thư mục Levels của Unity> [--variant x] [--dry]
//       → ghi <số>.json thành Level_NNNN.json (biến thể a) hoặc Level_NNNN_x.json. --dry chỉ in ra.
import fs from 'node:fs';
import path from 'node:path';
import { createZip, readZip } from '../../levelcore/node/zip.mjs';

const NAME = /^Level_(\d+)(?:_([a-z]))?\.json$/;
const [cmd, a, b, ...rest] = process.argv.slice(2);
const flag = (name, def = null) => { const i = rest.indexOf(name); return i < 0 ? def : rest[i + 1] ?? true; };

if (cmd === 'zip' && a) {
  const out = b || 'data/unity';
  const groups = new Map();
  for (const f of fs.readdirSync(a)) {
    const m = NAME.exec(f);
    if (!m) continue;
    const v = m[2] || 'a';
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push({ name: `${parseInt(m[1], 10)}.json`, data: fs.readFileSync(path.join(a, f)) });
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [v, files] of [...groups].sort()) {
    files.sort((x, y) => parseInt(x.name, 10) - parseInt(y.name, 10));
    fs.writeFileSync(path.join(out, `${v}.zip`), createZip(files));
    console.log(`${v}: ${files.length} level → ${path.join(out, `${v}.zip`)}`);
  }
} else if (cmd === 'unzip' && a && b) {
  const variant = flag('--variant', 'a'), dry = rest.includes('--dry');
  let n = 0;
  for (const f of readZip(fs.readFileSync(a))) {
    const m = /(?:^|\/)(\d+)\.json$/.exec(f.name);
    if (!m) continue;
    const name = `Level_${String(parseInt(m[1], 10)).padStart(4, '0')}${variant === 'a' ? '' : `_${variant}`}.json`;
    if (!dry) fs.writeFileSync(path.join(b, name), f.data);
    console.log(`${dry ? '(thử) ' : ''}${f.name} → ${name}`);
    n++;
  }
  console.log(`${n} level${dry ? ' (chưa ghi)' : ''}. Mở Unity để nó tạo .meta cho file mới.`);
} else {
  console.error('Cách dùng:\n  node game/tools/unity_levels.mjs zip <Assets/_Game/Levels> [data/unity]\n  node game/tools/unity_levels.mjs unzip <export.zip> <Assets/_Game/Levels> [--variant x] [--dry]');
  process.exit(2);
}
