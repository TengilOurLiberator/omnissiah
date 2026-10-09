// Regenerates the id catalogue inside the header of public/game/core/genset.js (the header is what the Omnissiah reads) from index.json.
//   D:\omnissiah\tools\node\node.exe tools\startzone-batch\gen-header.mjs          rewrites genset.js between CATALOG-BEGIN / CATALOG-END (atomic) + the model count in line 1
//   ... gen-header.mjs --print                                                      only prints the catalogue and the header size
// Run build-index.mjs first when review.json changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = path.join(ROOT, 'public', 'assets', 'generated', 'startzone', 'index.json');
const TARGET = path.join(ROOT, 'public', 'game', 'core', 'genset.js');
const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const PREFIX = ['sz', 'lg', 'x'];

function comp(names) { // names: stripped ids ('^' marks kept). a-b, a-c -> a-{b,c}; nested: enemy-tent-large, enemy-tent-small -> enemy-tent-{large,small}. Returns an array of items.
  const buckets = new Map();
  for (const n of names) { const k = n.split('-')[0].replace(/\^$/, ''); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(n); }
  const out = [];
  for (const [k, arr] of buckets) {
    const alone = arr.filter((n) => n.replace(/\^$/, '') === k || !n.includes('-'));
    const rest = arr.filter((n) => !alone.includes(n)).map((n) => n.slice(n.indexOf('-') + 1));
    for (const a of alone) out.push(a);
    if (rest.length === 1) out.push(k + '-' + rest[0]);
    else if (rest.length > 1) { const inner = comp(rest); out.push(inner.length === 1 ? k + '-' + inner[0] : k + '-{' + inner.join(',') + '}'); }
  }
  return out;
}
const compress = (names) => comp(names).join(',');
const byGroup = new Map();
for (const e of idx.items) { if (!byGroup.has(e.group)) byGroup.set(e.group, []); byGroup.get(e.group).push(e); }
const lines = [];
for (const [g, items] of byGroup) {
  const parts = [];
  for (const p of PREFIX) {
    const names = items.filter((e) => e.id.startsWith(p + '-')).map((e) => e.id.slice(p.length + 1) + (e.tier === 'pc' ? '^' : '')).sort();
    if (!names.length) continue;
    const c = compress(names);
    parts.push(p + '-' + (names.length > 1 && c.includes(',') ? '{' + c + '}' : c));
  }
  lines.push('// ' + g + ': ' + parts.join(' '));
}
const head = '// ids are PREFIX-name: sz- lg- x- ; a-{b,c} means a-b and a-c ; ^ = PC tier only (Quest: alt or skipped). Groups:';
const block = [head, ...lines];
const text = block.join('\n');
const src = fs.readFileSync(TARGET, 'utf8');
const a = src.indexOf('// CATALOG-BEGIN'), b = src.indexOf('// CATALOG-END');
if (a < 0 || b < 0) throw new Error('markers missing in genset.js');
const next = src.slice(0, a) + '// CATALOG-BEGIN\n' + text + '\n' + src.slice(b);
const nextN = next.replace(/\(\d+ reviewed models/, '(' + idx.items.length + ' reviewed models');
// header = leading comment block
const hdr = nextN.split('\n'); let end = 0; while (end < hdr.length && /^\s*(\/\/|$)/.test(hdr[end])) end++;
const header = hdr.slice(0, end).join('\n');
console.log('catalogue lines', lines.length, 'bytes', Buffer.byteLength(text), '| whole header bytes', Buffer.byteLength(header), 'lines', end);
if (process.argv.includes('--print')) { console.log(text); process.exit(0); }
const tmp = TARGET + '.tmp.js';
fs.writeFileSync(tmp, nextN);
const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
if (chk.status !== 0) { fs.unlinkSync(tmp); console.error('syntax check failed', chk.stderr); process.exit(1); }
fs.renameSync(tmp, TARGET);
console.log('genset.js header updated');

