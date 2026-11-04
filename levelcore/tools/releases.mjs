// Changelog theo khung của core (levelcore/AGENTS.md, mục Changelog):
//   node levelcore/tools/releases.mjs check [file]           kiểm khung (mặc định game/web/releases.json)
//   node levelcore/tools/releases.mjs tag <version> [file]   in message của tag = chính entry đó
// File .md (levelcore/CHANGELOG.md) đọc theo tiêu đề `## <version> · <ngày> · <tiêu đề>` và `### <phần>`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleases, parseMarkdown, tagMessage } from '../web/js/releases.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readReleases(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return file.endsWith('.md') ? parseMarkdown(text) : JSON.parse(text);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const version = cmd === 'tag' ? rest.shift() : null;
  const file = path.resolve(rest[0] || path.join(REPO, 'game', 'web', 'releases.json'));
  const entries = readReleases(file);
  const problems = checkReleases(entries, { audience: file.endsWith('.md') ? 'dev' : 'gd' });
  if (cmd === 'check') {
    for (const p of problems) console.error(`✖ ${p}`);
    console.log(problems.length ? `${problems.length} lỗi khung trong ${file}` : `Khung đúng: ${file}`);
    process.exit(problems.length ? 1 : 0);
  }
  if (cmd === 'tag' && version) {
    const entry = entries.find(e => e.version === version);
    if (!entry) throw new Error(`Không có entry ${version} trong ${file}`);
    if (problems.length) throw new Error(`Sửa khung trước khi tag:\n${problems.join('\n')}`);
    console.log(tagMessage(entry));
    return;
  }
  console.error('Cách dùng: node levelcore/tools/releases.mjs check [file] | tag <version> [file]');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
