// node validate_runner.mjs <module validator của game>
// stdin: JSON [{level, levelNo, formatVersion?}] -> stdout: JSON [{isValid, errors, warnings}] — server gọi để dùng đúng
// luật của app (GamePlugin.validator_module, vd game/web/schema.mjs). Một process cho cả lô.
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) { process.stderr.write('thiếu đường dẫn module validator'); process.exit(2); }
const { validateLevel } = await import(pathToFileURL(process.argv[2]).href);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const items = JSON.parse(input || '[]');
  const out = items.map(it => {
    try {
      return validateLevel(it.level, { levelNo: it.levelNo, formatVersion: it.formatVersion ?? null });
    } catch (e) {
      return { isValid: false, errors: [`validator lỗi: ${e.message}`], warnings: [] };
    }
  });
  process.stdout.write(JSON.stringify(out));
});
