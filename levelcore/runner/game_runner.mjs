// node game_runner.mjs <module luật của game>
// Tiến trình thường trú cho server Python (levelcore/server/levelcore/jsgame.py): mỗi dòng stdin là một lô
// {id, hook, items: [[args…], …]}; mỗi dòng stdout trả {id, missing: true} khi module không export hook đó, hoặc
// {id, results: [{value} | {error}]} cùng thứ tự với items. Một lỗi trong hook chỉ hỏng phần tử đó, runner chạy tiếp.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) { process.stderr.write('thiếu đường dẫn module luật của game'); process.exit(2); }
const rules = await import(pathToFileURL(process.argv[2]).href);

const write = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    write({ id: null, fatal: `dòng lệnh hỏng: ${e.message}` });
    continue;
  }
  const fn = rules[req.hook];
  if (typeof fn !== 'function') {
    write({ id: req.id, missing: true });
    continue;
  }
  const results = [];
  for (const args of req.items || []) {
    try {
      const value = await fn(...args);
      results.push({ value: value === undefined ? null : value });
    } catch (e) {
      results.push({ error: String(e?.message || e) });
    }
  }
  write({ id: req.id, results });
}
