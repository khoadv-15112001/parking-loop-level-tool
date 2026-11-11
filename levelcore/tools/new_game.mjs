// Tạo phần riêng của game cho repo tool vừa fork từ level-tool-core: chép levelcore/template/ ra gốc repo rồi thay tên.
//
//   node levelcore/tools/new_game.mjs --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort [--runtime node|python]
//                                     [--port 8880] [--raw <thư mục raw của game>] [--storage fl] [--repo <gốc repo>]
// --raw chép tối đa 8 file <số>.json (rải đều theo số) vào game/tests/raw/, giữ nguyên byte.
//
// Chỉ sinh dữ liệu và luật (game/manifest.json, game/web/rules.mjs, test, Có gì mới) cùng bi.yaml, README, AGENTS.md:
// giao diện là vỏ của core cho tới khi game tự làm (manifest "app"). Không ghi đè file đã có, in ra để tự so.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveUiTemplate } from '../node/ui-template.mjs';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(CORE, 'template');
// README.md / AGENTS.md ở gốc repo core là của core: sau khi fork, bản của game thay chúng.
const CORE_ROOT_FILE = /^# level-tool-core\b/;
export const DOCKERFILES = { node: 'levelcore/deploy/Dockerfile.node', python: 'levelcore/deploy/Dockerfile' };
const RAW_SAMPLES = 8;

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : [full];
  });
}

/** Trả {written, kept}: đường dẫn (từ gốc repo) đã tạo và đã có sẵn nên giữ nguyên. */
export function scaffold(repo, { tool, game, prefix, slug, runtime = 'node', storage = prefix.toLowerCase(), port = '8880', raw = null, uiTemplate }) {
  if (fs.existsSync(path.join(repo, 'game'))) throw new Error(`${path.join(repo, 'game')} đã có — không ghi đè`);
  resolveUiTemplate(path.join(CORE, 'web'), uiTemplate);
  const subs = {
    __TOOL__: tool, __GAME__: game, __PREFIX__: prefix, __SLUG__: slug, __STORAGE__: storage, __RUNTIME__: runtime,
    __DBFILE__: `${tool.toLowerCase()}.db`, __DOCKERFILE__: DOCKERFILES[runtime], __PORT__: String(port),
  };
  const written = [], kept = [];
  for (const src of listFiles(TEMPLATE).sort()) {
    const rel = path.relative(TEMPLATE, src).split(path.sep).join('/');
    const dst = path.join(repo, rel);
    if (fs.existsSync(dst) && !CORE_ROOT_FILE.test(fs.readFileSync(dst, 'utf8'))) {
      kept.push(rel);
      continue;
    }
    let text = fs.readFileSync(src, 'utf8');
    for (const [k, v] of Object.entries(subs)) text = text.replaceAll(k, v);
    if (rel === 'game/manifest.json' && uiTemplate !== undefined) {
      const manifest = JSON.parse(text);
      manifest.uiTemplate = uiTemplate;
      text = `${JSON.stringify(manifest, null, 2)}\n`;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, text);
    written.push(rel);
  }
  if (raw) written.push(...copyRaw(raw, path.join(repo, 'game', 'tests', 'raw')));
  return { written, kept };
}

/** Chép tối đa RAW_SAMPLES file <số>.json, rải đều theo số level, giữ nguyên byte. */
function copyRaw(src, dst) {
  const files = fs.readdirSync(src).filter(f => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (!files.length) throw new Error(`${src} không có file <số>.json`);
  const k = Math.min(RAW_SAMPLES, files.length);
  const picked = [...new Set(Array.from({ length: k }, (_, i) => files[Math.round(i * (files.length - 1) / Math.max(1, k - 1))]))];
  for (const f of picked) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  return picked.map(f => `game/tests/raw/${f}`);
}

function main() {
  const { values: a } = parseArgs({
    options: {
      tool: { type: 'string' }, game: { type: 'string' }, prefix: { type: 'string' }, slug: { type: 'string' },
      runtime: { type: 'string', default: 'node' }, storage: { type: 'string' }, repo: { type: 'string', default: path.dirname(CORE) },
      port: { type: 'string', default: '8880' }, raw: { type: 'string' }, 'ui-template': { type: 'string' },
    },
  });
  const fail = msg => {
    console.error(`${msg}\nCách dùng: node levelcore/tools/new_game.mjs --tool FishLevel --game "Fish Sort" --prefix FISHLEVEL --slug fishsort [--runtime node|python] [--ui-template <mã-mẫu>]`);
    process.exit(2);
  };
  for (const k of ['tool', 'game', 'prefix', 'slug']) if (!a[k]) fail(`Thiếu --${k}`);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(a.tool)) fail('--tool chỉ gồm chữ / số, vd FishLevel');
  if (!/^[A-Z][A-Z0-9]*$/.test(a.prefix)) fail('--prefix chỉ gồm chữ HOA / số, vd FISHLEVEL');
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(a.slug)) fail('--slug chỉ gồm chữ thường / số / gạch nối');
  if (!DOCKERFILES[a.runtime]) fail('--runtime là node hoặc python');
  if (!/^\d{2,5}$/.test(a.port)) fail('--port là số cổng, vd 8893');
  let result;
  try {
    result = scaffold(path.resolve(a.repo), { ...a, storage: a.storage || a.prefix.toLowerCase(), uiTemplate: a['ui-template'] });
  } catch (error) {
    fail(error.message);
  }
  const { written, kept } = result;
  console.log(`Đã tạo phần riêng của ${a.tool} (server ${a.runtime}): ${written.join(', ')}`);
  for (const k of kept) console.log(`  giữ nguyên ${k} (đã có) — so với levelcore/template/${k} rồi tự sửa`);
  console.log(`Tiếp: ${a.raw ? '' : 'đặt raw thật vào game/tests/raw/, '}viết game/web/rules.mjs, chạy node --test game/tests/*.test.mjs, `
    + 'rồi bấm đúp ChayDev.bat. Hướng dẫn: levelcore/AGENTS.md.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
