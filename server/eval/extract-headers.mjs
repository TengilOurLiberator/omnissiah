// Dumps the leading comment block (= the API doc the Omnissiah receives) of every core module, numbered, to .cache/eval/headers-orig/.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const game = path.join(ROOT, 'public', 'game');
const out = path.join(ROOT, '.cache', 'eval', 'headers-orig');
fs.mkdirSync(out, { recursive: true });
export function headerLines(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let end = 0;
  while (end < lines.length && /^\s*(\/\/|$)/.test(lines[end])) end++;
  return lines.slice(0, end);
}
if (process.argv[1] && process.argv[1].endsWith('extract-headers.mjs')) {
  for (const f of fs.readdirSync(path.join(game, 'core'))) {
    if (!f.endsWith('.js')) continue;
    const h = headerLines(path.join(game, 'core', f));
    fs.writeFileSync(path.join(out, f.replace('.js', '.txt')), h.map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n'));
    fs.writeFileSync(path.join(out, f.replace('.js', '.raw.txt')), h.join('\n'));
    console.log(f.padEnd(16), h.join('\n').length);
  }
}
