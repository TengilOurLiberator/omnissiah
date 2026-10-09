// header.mjs — regenerates the CATALOGUE section of the header comment in public/game/core/models.js from catalog.json.
//   node public/assets/_build/header.mjs        (run after catalog.mjs)
// The header is appended verbatim to the oracle's prompt, so it must stay compact: grouped names, one or two words of context.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(HERE, '../catalog.json'), 'utf8'));
const target = path.resolve(HERE, '../../game/core/models.js');
const M = catalog.models;
const all = Object.keys(M).sort();
const WIDTH = 124;

// -a/-b/... and colour suffix compaction: "name-{x,y,z}"
function compact(names) {
  const groups = new Map();
  for (const n of names) { const i = n.indexOf('-'); const stem = i > 0 ? n.slice(0, i) : n; (groups.get(stem) ?? groups.set(stem, []).get(stem)).push(n); }
  const out = [];
  for (const [stem, list] of groups) {
    if (list.length >= 3 && list.some((n) => n !== stem)) {
      const rest = list.map((n) => (n === stem ? '' : n.slice(stem.length + 1)));
      if (rest.includes('')) out.push(stem);
      const nz = rest.filter(Boolean);
      for (let i = 0; i < nz.length; i += 9) {
        const chunk = nz.slice(i, i + 9);
        out.push(chunk.length === 1 ? `${stem}-${chunk[0]}` : `${stem}-{${chunk.join(',')}}`);
      }    } else out.push(...list);
  }
  return out;
}
function wrap(label, items) {
  const lines = []; let cur = `//   ${label}: `;
  const indent = '//     ';
  for (const it of items) {
    if ((cur + it).length > WIDTH && cur.trim().length > label.length + 4) { lines.push(cur.trimEnd()); cur = indent; }
    cur += it + ' ';
  }
  lines.push(cur.trimEnd());
  return lines;
}
const by = (cat) => all.filter((n) => M[n].category === cat);
const pick = (cat, re, not) => by(cat).filter((n) => re.test(n) && !(not && not.test(n)));
const lines = [];

// characters / enemies / animals
lines.push(...wrap('heroes (KayKit rig, ~95 clips, 2 draws, hidden weapons: h.equip)', by('character').filter((n) => M[n].rig === 'kaykit-medium')));
lines.push(...wrap('villagers & npcs (tiny, 1 draw, x2.6)', compact(by('character').filter((n) => M[n].rig !== 'kaykit-medium'))));
lines.push(...wrap('enemies', by('enemy')));
lines.push(...wrap('animals (cute cubes, idle/walk/run/eat/dance)', by('animal')));
// weapons
lines.push(...wrap('weapons (origin = grip; use h.hold)', [
  ...['sword', 'greatsword', 'greatsword-gold', 'dagger', 'axe', 'great-axe', 'staff', 'wand', 'crossbow', 'heavy-crossbow', 'spellbook', 'arrow', 'quiver', 'smoke-bomb'].filter((n) => M[n]),
  ...compact(pick('weapon', /^shield-/)), ...compact(pick('weapon', /^skeleton-/, /arrow/)), 'blaster-{a..r}', 'grenade-{a,b}',
  ...compact(pick('weapon', /^tool-/)), ...pick('weapon', /^(shovel|sword-shield)/),
]));
// buildings
const colored = [...new Set(by('building').filter((n) => /-(red|blue|green|yellow)$/.test(n)).map((n) => n.replace(/-(red|blue|green|yellow)$/, '')))];
lines.push(...wrap('buildings, each in -red -blue -green -yellow', colored));
lines.push(...wrap('more buildings/landmarks', [...by('building').filter((n) => !/-(red|blue|green|yellow)$/.test(n)), ...pick('structure', /^(crypt|bridge|building|wall-straight|fence-(stone|wood))/).slice(0, 12)]));
// structures
lines.push(...wrap('dungeon (structure)', compact(pick('structure', /^(wall|floor|stairs|column|pillar|barrier)/).filter((n) => M[n].pack === 'kaykit-dungeon'))));
lines.push(...wrap('castle (structure, x4)', compact(by('structure').filter((n) => M[n].pack === 'kenney-castle' && /^(wall|tower|gate|door|bridge|stairs|metal-gate|ground)/.test(n) && !/tower-square-(mid|top|base)-/.test(n)))));
lines.push(...wrap('village/graveyard (structure)', compact(by('structure').filter((n) => ['kenney-town', 'kenney-graveyard', 'kenney-survival', 'kenney-pirate', 'kaykit-halloween'].includes(M[n].pack)))));
lines.push(...wrap('vehicles & siege', by('vehicle')));
// props & furniture
lines.push(...wrap('props', compact(by('prop').filter((n) => !/^(floor|path)/.test(n) && M[n].pack !== 'kenney-nature'))));
lines.push(...wrap('furniture', compact(by('furniture'))));
// nature
lines.push(...wrap('trees', compact(by('nature').filter((n) => M[n].tags.includes('tree') || /^tree/.test(n)))));
lines.push(...wrap('rocks/plants/other nature', compact(by('nature').filter((n) => !(M[n].tags.includes('tree') || /^tree/.test(n))))));
lines.push(...wrap('campsite props', compact(by('prop').filter((n) => M[n].pack === 'kenney-nature'))));

const body = lines.join('\n');
const src = fs.readFileSync(target, 'utf8');
const a = src.indexOf('// CATALOG-BEGIN'), b = src.indexOf('// CATALOG-END');
if (a < 0 || b < 0) throw new Error('markers missing in models.js');
const out = src.slice(0, a) + '// CATALOG-BEGIN\n' + body + '\n' + src.slice(b);
fs.writeFileSync(target, out);
const headerLines = out.slice(0, out.indexOf("import { GLTFLoader }")).split('\n').length;
console.log(`catalogue lines: ${lines.length}, header lines: ${headerLines}, chars: ${body.length}`);
