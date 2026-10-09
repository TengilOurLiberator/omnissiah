// Generates the recommended compact header for core/library.js from the LIVE entries (headless boot): USE section kept, catalogue regenerated.
// The catalogue in the real header is hand-maintained and goes stale (it said 295 entries and no 'games' category while 296 existed): the library owner should
// regenerate it with this script after adding entries.   node --import ./server/eval/register.mjs server/eval/gen-library-header.mjs
import fs from 'node:fs';
import path from 'node:path';
import { bootGame, ROOT } from './headless.mjs';
import { headerLines } from './extract-headers.mjs';

const gameDir = path.join(ROOT, 'public', 'game');
const G = await bootGame({ gameDir });
const list = G.world.library?.list?.() ?? [];
const hdr = headerLines(path.join(gameDir, 'core', 'library.js'));
const cut = hdr.findIndex((l) => /^\/\/ CATALOGUE/.test(l));
const head = hdr.slice(0, cut >= 0 ? cut : hdr.length).join('\n').replace(/\n+$/, '');

const clip = (s, n) => { s = String(s).replace(/\s+/g, ' '); const first = s.split(/;|\. /)[0]; return first.length > n ? first.slice(0, n).replace(/[ ,]+\S*$/, '').replace(/ (a|an|the|and|with|of|to|in|that|its|his|her)$/i, '') : first; };
const skipOpts = new Set(['faction', 'hp', 'damage', 'scale', 'yaw', 'count', 'hand (start in left/right hand)', 'hand', 'name']);
const optNote = (o) => String(o || '').split(',').map((x) => x.trim()).filter((x) => x && !skipOpts.has(x) && !/^hand \(/.test(x)).join(', ');
const WITH_DESC = new Set(['enemies', 'allies', 'life', 'scenarios', 'effects', 'games']);
const lines = [`// CATALOGUE  ${list.length} entries: name (key options). Every entry takes x, z / position, yaw, scale, count, spread; fighters also faction, hp, damage; weapons also hand. Names are fuzzy.`];
const cats = [...new Set(list.map((e) => e.category))];
for (const cat of cats) {
  const es = list.filter((e) => e.category === cat);
  lines.push(`// ${cat.toUpperCase()}${cat === 'enemies' ? ' (faction enemy; they hunt you and your allies)' : cat === 'allies' ? ' (faction friendly; follow and defend the player)' : cat === 'weapons' ? ' (holdable; the player grabs with squeeze)' : cat === 'effects' ? ' (weather and sky; restored on removal)' : cat === 'scenarios' ? ' (whole places in one call)' : ''}`);
  if (WITH_DESC.has(cat)) {
    for (const e of es) { const o = optNote(e.options); lines.push(`//   ${e.name} - ${clip(e.description, 64)}${o ? ` (${o})` : ''}`); }
  } else {
    // names, with option notes for the few that have them
    let line = '//  ';
    for (const e of es) {
      const o = optNote(e.options);
      const item = ` ${e.name}${o ? `(${o})` : ''}`;
      if ((line + item).length > 175) { lines.push(line); line = '//  '; }
      line += item;
    }
    lines.push(line);
  }
}
const out = head + '\n' + lines.join('\n') + '\n';
fs.mkdirSync(path.join(ROOT, 'server', 'eval', 'headers'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'server', 'eval', 'headers', 'library.header.txt'), out);
console.log('library header', out.length, 'chars,', list.length, 'entries; original', hdr.join('\n').length);
process.exit(0);

