// Mirrors oracle.js buildPromptFile() (not exported) and reports what the Omnissiah's system prompt costs.
// Usage: node server/eval/audit-prompt.mjs [--write out.md] [--manual path]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GAME_DIR = path.join(ROOT, 'public', 'game');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const MANUAL = opt('--manual') || path.join(ROOT, 'server', 'omnissiah-prompt.md');

export const EXAMPLES = ['creations/campfire.js', 'creations/spell-firebolt.js', 'creations/wanderer.js'];

export function assemble(manualPath = MANUAL, gameDir = GAME_DIR) {
  const sections = [];
  let text = fs.readFileSync(manualPath, 'utf8');
  sections.push({ name: 'manual', chars: text.length });
  const read = (rel) => { try { return fs.readFileSync(path.join(gameDir, rel), 'utf8'); } catch { return ''; } };
  const headerOf = (rel) => {
    const lines = read(rel).split('\n');
    let end = 0;
    while (end < lines.length && /^\s*(\/\/|$)/.test(lines[end])) end++;
    return lines.slice(0, end).join('\n').trim();
  };
  const head = '\n\n## Reference (current as of this turn; you do not need to Read these files again)\n';
  text += head;
  let core = [];
  try { core = JSON.parse(read('manifest.json')).core ?? []; } catch { /* none */ }
  for (const rel of core) {
    if (rel === 'core/roadster.js') continue;
    const header = headerOf(rel);
    if (header) {
      const block = '\n### Header of ' + rel + '\n\n```js\n' + header + '\n```\n';
      text += block;
      sections.push({ name: 'header ' + rel, chars: block.length });
    }
  }
  for (const rel of EXAMPLES) {
    const src = read(rel);
    if (src.trim() && src.length < 12000) {
      const block = '\n### Example: ' + rel + '\n\n```js\n' + src.trim() + '\n```\n';
      text += block;
      sections.push({ name: 'example ' + rel, chars: block.length });
    }
  }
  return { text, sections };
}

// Rough token estimate: English prose ~4.0 chars/token, code/JS comments ~3.2.
export const estTokens = (chars, code = false) => Math.round(chars / (code ? 3.2 : 4.0));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, sections } = assemble(MANUAL, opt('--game') ? path.resolve(opt('--game')) : GAME_DIR);
  console.log('manual:', MANUAL);
  console.log('name'.padEnd(36), 'chars'.padStart(8), 'tokens~'.padStart(8));
  let tot = 0, totTok = 0;
  for (const s of sections) {
    const tk = estTokens(s.chars, s.name !== 'manual');
    tot += s.chars; totTok += tk;
    console.log(s.name.padEnd(36), String(s.chars).padStart(8), String(tk).padStart(8));
  }
  console.log('TOTAL'.padEnd(36), String(tot).padStart(8), String(totTok).padStart(8), ' (assembled length', text.length + ')');
  const out = opt('--write');
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text); console.log('wrote', out); }
}

