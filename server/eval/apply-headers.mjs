// Applies the recommended headers (server/eval/headers/<module>.header.txt) to public/game/core/<module>.js: replaces ONLY the leading `//` comment
// block, atomically (temp file + syntax check + rename). Code is never touched.
//   node server/eval/apply-headers.mjs --dry            show size changes
//   node server/eval/apply-headers.mjs [module ...]     apply to the given modules (default: the authorised list below)
// Regenerate first:  node server/eval/build-headers.mjs  &&  node --import ./server/eval/register.mjs server/eval/gen-library-header.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, NODE } from './lib.mjs';

const AUTHORISED = ['kit', 'models', 'world', 'oracle', 'style', 'library', 'combat', 'physics', 'weapons', 'spells', 'travel', 'perf', 'commentary', 'ambience'];
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const names = args.filter((a) => !a.startsWith('--'));
const todo = names.length ? names : AUTHORISED;
const core = path.join(ROOT, 'public', 'game', 'core');
const dir = path.join(ROOT, 'server', 'eval', 'headers');
for (const name of todo) {
  const hf = path.join(dir, name + '.header.txt');
  const target = path.join(core, name + '.js');
  if (!fs.existsSync(hf) || !fs.existsSync(target)) { console.log(name.padEnd(12), 'skipped (no header file or module)'); continue; }
  const src = fs.readFileSync(target, 'utf8');
  const lines = src.split('\n');
  let end = 0;
  while (end < lines.length && /^\s*(\/\/|$)/.test(lines[end])) end++;
  const oldHeader = lines.slice(0, end).join('\n');
  const header = fs.readFileSync(hf, 'utf8').trimEnd();
  if (!header.split('\n').every((l) => /^\s*\/\//.test(l))) { console.log(name.padEnd(12), 'REFUSED: header file has non-comment lines'); continue; }
  const next = header + '\n\n' + lines.slice(end).join('\n').replace(/^\n+/, '');
  console.log(name.padEnd(12), `header ${oldHeader.length} -> ${header.length} chars`);
  if (dry) continue;
  const tmp = target + '.hdr.tmp.js';
  fs.writeFileSync(tmp, next);
  const chk = spawnSync(NODE, ['--check', tmp], { encoding: 'utf8' });
  if (chk.status !== 0) { fs.rmSync(tmp, { force: true }); console.log(name.padEnd(12), 'REFUSED: syntax check failed', chk.stderr.split('\n')[0]); continue; }
  // re-read right before the swap: if someone edited the code meanwhile, redo from the fresh copy
  const again = fs.readFileSync(target, 'utf8');
  if (again !== src) { fs.rmSync(tmp, { force: true }); console.log(name.padEnd(12), 'SKIPPED: module changed while preparing, run again'); continue; }
  fs.renameSync(tmp, target);
}
