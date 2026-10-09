// Regression alarm helper.   D:\omnissiah\tools\node\node.exe D:\omnissiah\tests\dev\syntax.mjs [--since "<ISO time>"]
// 1. `node --check` on every .js under public/game, public/sys, public/boot.js, server (skips node_modules, .archive, __pycache__).
// 2. prints the newest mtime of the tree (public/game + public/sys + public/boot.js), so a runner can tell whether anything changed since the last run,
//    and the files changed since --since (default: nothing listed).
// Exit code 1 when a file has a syntax error. Writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, NODE } from '../lib/server.mjs';

const args = process.argv.slice(2);
const sinceArg = args.indexOf('--since') >= 0 ? Date.parse(args[args.indexOf('--since') + 1]) : null;
const SKIP = /(^|[\\/])(node_modules|\.archive|__pycache__|\.git)([\\/]|$)/;
const walk = (dir, out = []) => {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const roots = [path.join(ROOT, 'public', 'game'), path.join(ROOT, 'public', 'sys'), path.join(ROOT, 'server')];
const files = roots.flatMap((r) => walk(r)).concat([path.join(ROOT, 'public', 'boot.js')]);
const js = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
const bad = [];
for (const f of js) {
  const r = spawnSync(NODE, ['--check', f], { encoding: 'utf8' });   // Node 24 detects ES-module syntax in .js files by itself
  if (r.status !== 0) bad.push({ file: path.relative(ROOT, f), error: (r.stderr || '').split(/\r?\n/).slice(0, 6).join(' | ').slice(0, 400) });
}
const tree = files.filter((f) => !/[\\/]assets[\\/]/.test(f) && /public[\\/](game|sys)[\\/]|boot\.js$/.test(f));
let newest = 0, newestFile = '';
const changed = [];
for (const f of tree) {
  let m = 0; try { m = fs.statSync(f).mtimeMs; } catch { continue; }
  if (m > newest) { newest = m; newestFile = f; }
  if (sinceArg && m > sinceArg) changed.push(`${new Date(m).toISOString()} ${path.relative(ROOT, f)}`);
}
console.log(JSON.stringify({ checked: js.length, syntaxErrors: bad, newestMtime: new Date(newest).toISOString(), newestFile: path.relative(ROOT, newestFile), changedSince: changed.slice(0, 80) }, null, 1));
process.exit(bad.length ? 1 : 0);
