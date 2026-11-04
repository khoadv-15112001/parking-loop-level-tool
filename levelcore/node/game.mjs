// Game của server Node: game/manifest.json (hoặc LEVELCORE_GAME_MANIFEST) + module luật JS. Cùng hợp đồng với
// GamePlugin.from_manifest của server Python; hook game không export thì dùng mặc định của core.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultChanges = (prev, cur) => (isObject(prev) && isObject(cur) ? [] : null);

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export async function loadGame(manifestPath, repo) {
  const file = path.resolve(manifestPath);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['tool', 'game', 'prefix', 'rules']) {
    if (!m[k]) throw new Error(`${file}: thiếu trường '${k}'`);
  }
  const base = path.dirname(file);
  const rulesPath = path.resolve(base, m.rules);
  const rules = await import(pathToFileURL(rulesPath).href);
  if (typeof rules.validateLevel !== 'function') throw new Error(`${rulesPath}: thiếu validateLevel`);
  const hook = name => (typeof rules[name] === 'function' ? rules[name] : null);
  return {
    manifest: m,
    rulesPath,
    webDir: m.web ? path.resolve(base, m.web) : path.join(repo, 'game', 'web'),
    hasLevelhub: !!m.levelhub,
    validate(level, levelNo, formatVersion) {
      try {
        return rules.validateLevel(level, { levelNo, formatVersion });
      } catch (e) {
        return { isValid: false, errors: [`validator lỗi: ${e.message}`], warnings: [] };
      }
    },
    summary(level) {
      const v = hook('levelSummary')?.(level);
      return isObject(v) ? v : {};
    },
    changes(prev, cur) {
      const fn = hook('levelChanges');
      return fn ? (fn(prev, cur) ?? null) : defaultChanges(prev, cur);
    },
    setNumber(level, n) {
      const v = hook('setLevelNumber')?.(level, n);
      return isObject(v) ? v : level;
    },
  };
}
