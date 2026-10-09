// Verifies code examples: every ```js block in the given markdown file(s) that starts with "// creations/<name>.js" is written into a temp
// copy of the game and loaded headlessly for 5 simulated seconds. Usage: node server/eval/check-examples.mjs [file.md ...]
// (default: server/omnissiah-prompt.md)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CACHE, copyGame, runGrade, nodeCheck } from './lib.mjs';

const mds = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(ROOT, 'server', 'omnissiah-prompt.md')];
const dest = path.join(CACHE, 'examples', 'game');
copyGame(dest);
const files = [];
for (const md of mds) {
  const text = fs.readFileSync(md, 'utf8');
  for (const m of text.matchAll(/```js\n([\s\S]*?)```/g)) {
    const code = m[1];
    const first = code.split('\n')[0].trim();
    const mm = first.match(/^\/\/\s*(creations\/[\w.-]+\.js)/);
    if (!mm) continue;
    const rel = mm[1];
    fs.writeFileSync(path.join(dest, rel), code);
    files.push(rel);
  }
}
console.log('examples found:', files.length);
let bad = 0;
for (const rel of files) {
  const syn = nodeCheck(path.join(dest, rel));
  if (syn) { bad++; console.log('SYNTAX', rel, syn); }
}
const res = await runGrade({ gameDir: dest, files, seconds: 5, out: path.join(CACHE, 'examples', 'examples.result.json') });
console.log('boot', JSON.stringify(res.boot), 'fatal', res.fatal ?? '');
for (const f of res.files) {
  const flag = !f.loaded || f.loadError || f.updateError ? 'FAIL' : 'ok  ';
  if (flag === 'FAIL') bad++;
  console.log(flag, f.path, f.loadError ?? '', f.updateError ?? '', 'scene', JSON.stringify(f.scene), 'uses', (f.uses || []).join(','));
  for (const c of (f.calls || []).slice(0, 12)) console.log('      ', c);
  if (f.disposeError) console.log('      dispose error', f.disposeError);
}
console.log('sent:', JSON.stringify(res.sent), 'stubs:', JSON.stringify(res.stubCalls));
console.log('leaks:', JSON.stringify(res.cleanup?.leaks));
console.log('core errors:', JSON.stringify(res.coreErrors), 'unhandled:', JSON.stringify(res.unhandled ?? []));
process.exit(bad ? 1 : 0);
