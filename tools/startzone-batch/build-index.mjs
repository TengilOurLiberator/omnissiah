// Builds public/assets/generated/startzone/index.json from the batch lists, optimized.json and review.json (human verdicts).
//   D:\omnissiah\tools\node\node.exe tools\startzone-batch\build-index.mjs        -> writes index.json atomically, prints a summary
// Then regenerate the Omnissiah header:  node tools\startzone-batch\gen-header.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const B = path.join(ROOT, 'tools', 'startzone-batch');
const SZ = path.join(ROOT, 'public', 'assets', 'generated', 'startzone');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const lists = ['list.json', 'list2.json', 'list3.json'].flatMap((f) => readJson(path.join(B, f)).items);
const opt = Object.fromEntries(readJson(path.join(B, 'optimized.json')).map((x) => [x.id, x]));
const rev = readJson(path.join(B, 'review.json'));
const R = (k) => rev[k] || {};

const r2 = (v) => Math.round(v * 100) / 100;
const STOP = new Set('a an the of on in with and or its it to from for at by into onto very small large big tall short old half two three four five six one wooden stone brass iron made around over under between each some few that this are is has have hanging standing showing carved glowing mossy'.split(' '));
const SYN = {
  tree: ['forest', 'plant', 'wood'], pine: ['conifer', 'evergreen', 'fir'], oak: ['hardwood'], bush: ['shrub', 'hedge', 'plant'], flower: ['flowers', 'plant', 'blossom'],
  rock: ['stone', 'boulder'], boulder: ['rock', 'stone'], stone: ['rock'], house: ['home', 'building'], cottage: ['house', 'home', 'building'], hut: ['shack', 'building'],
  tower: ['building', 'turret'], castle: ['fortress', 'fort'], wall: ['barrier'], fence: ['barrier', 'railing'], gate: ['entrance', 'door'], door: ['entrance'], arch: ['archway', 'entrance'],
  archway: ['arch'], bridge: ['crossing'], boat: ['ship', 'vessel'], ship: ['boat', 'vessel'], chest: ['box', 'treasure'], table: ['furniture'], chair: ['furniture', 'seat'],
  throne: ['chair', 'seat', 'furniture'], bench: ['seat'], bed: ['sleep'], lamp: ['light', 'lantern'], lantern: ['light', 'lamp'], torch: ['light', 'fire', 'flame'], brazier: ['fire', 'flame', 'light'],
  campfire: ['fire', 'flame'], altar: ['shrine', 'sacred'], shrine: ['altar', 'sacred'], statue: ['sculpture', 'monument'], obelisk: ['monument', 'pillar'], pillar: ['column'], column: ['pillar'],
  ruin: ['ruined', 'broken', 'ancient'], ruined: ['ruin', 'broken'], broken: ['ruined'], crystal: ['gem', 'magic'], gem: ['crystal', 'jewel'], skull: ['bone', 'bones', 'death'], bone: ['bones', 'skeleton'],
  grave: ['graveyard', 'tomb'], gravestone: ['grave', 'tombstone', 'graveyard'], coffin: ['grave', 'tomb'], cart: ['wagon'], wagon: ['cart'], market: ['shop', 'stall'], stall: ['market', 'shop'],
  barrel: ['cask', 'keg'], crate: ['box'], sack: ['bag'], potion: ['bottle', 'magic'], book: ['tome'], clock: ['time'], gear: ['cog', 'cogwheel'], cog: ['gear'], pipe: ['steam', 'tube'],
  anvil: ['smith', 'forge'], forge: ['smith'], furnace: ['forge', 'smith'], cannon: ['weapon', 'siege'], catapult: ['siege', 'weapon'], ballista: ['siege', 'weapon'], sword: ['weapon'],
  shield: ['weapon', 'defence'], helmet: ['armor', 'armour'], armour: ['armor'], cactus: ['desert', 'plant'], palm: ['tree', 'desert', 'tropical'], snow: ['winter', 'ice', 'cold'], ice: ['frozen', 'winter', 'cold'],
  lava: ['volcano', 'fire', 'molten'], volcanic: ['volcano', 'lava'], swamp: ['bog', 'marsh'], reeds: ['reed', 'cattail', 'plant'], mushroom: ['fungus', 'toadstool'], well: ['water'],
  fountain: ['water'], windmill: ['mill', 'farm'], barn: ['farm', 'building'], farm: ['field'], tent: ['camp', 'shelter'], camp: ['tent'], wolf: ['dog', 'animal'], deer: ['animal'], stag: ['deer', 'animal'],
  owl: ['bird', 'animal'], spider: ['bug', 'monster'], goblin: ['monster', 'enemy'], troll: ['monster', 'enemy'], skeleton: ['undead', 'enemy'], demon: ['monster', 'enemy'], dragon: ['monster', 'creature'],
  crown: ['royal', 'king'], key: ['golden'], candle: ['light', 'flame'], cake: ['food'], roast: ['food', 'meat'], pumpkin: ['food', 'halloween'], sunflower: ['flower', 'plant'], lavender: ['flower', 'plant', 'herb'],
};
const WORD_GROUP = { stones: ['stone', 'ancient'], camp: ['camp', 'props'], nature: ['nature', 'outdoor'], shrine: ['shrine', 'sacred'], lake: ['water', 'lake'], guide: ['signs'], training: ['training', 'props'], clockwork: ['clockwork', 'steampunk', 'brass'], landmark: ['landmark', 'scenery'], crypt: ['crypt', 'graveyard', 'spooky'], village: ['village', 'town'], loot: ['loot', 'treasure', 'item'], lair: ['lair', 'enemy'], boss: ['boss', 'arena'], ruin: ['ruin', 'ancient'], fortress: ['castle', 'fortress', 'military'], dungeon: ['dungeon', 'dark'], swamp: ['swamp', 'marsh'], ritual: ['ritual', 'magic'], forge: ['forge', 'smith'], harbour: ['harbour', 'sea', 'port'], desert: ['desert', 'sand'], snow: ['snow', 'winter'], volcanic: ['volcano', 'lava'], arena: ['arena', 'boss'], mount: ['mount', 'vehicle'], statue: ['statue', 'monument'], modular: ['modular', 'building'], furniture: ['furniture'], siege: ['siege', 'weapon'], magic: ['magic'], food: ['food'], boats: ['boat', 'vessel'], carts: ['cart', 'vehicle'], grave: ['grave', 'graveyard'], mech: ['mechanism', 'machine'] };

const REORDER = ['tree', 'statue', 'trophy', 'plant', 'floor', 'wall', 'rock'];
function autoName(id) {
  let t = id.replace(/^(sz|lg|x)-/, '').split('-');
  if (REORDER.includes(t[0]) && t.length > 1) t = [...t.slice(1), t[0]];
  if (t.length > 1 && ['big', 'large', 'small', 'tall', 'long', 'gold', 'ornate', 'blue', 'red', 'wood', 'young'].includes(t[t.length - 1])) t = [t[t.length - 1], ...t.slice(0, -1)];
  if (t.length > 1 && /^[a-d]$/.test(t[t.length - 1])) t[t.length - 1] = t[t.length - 1].toUpperCase();
  return t.map((w) => w.length === 1 ? w : w[0].toUpperCase() + w.slice(1)).join(' ');
}
function tagsFor(it, extra) {
  const set = new Set();
  const add = (w) => { w = w.toLowerCase(); if (w.length > 2 && !STOP.has(w)) set.add(w); };
  it.id.replace(/^(sz|lg|x)-/, '').split('-').forEach(add);
  (WORD_GROUP[it.group] || [it.group]).forEach(add);
  for (const w of Array.from(set)) (SYN[w] || []).forEach(add);
  (extra || []).forEach(add);
  return Array.from(set).slice(0, 12);
}

const SOLID_NO = /(^|-)(bush|grass|tuft|flower|flowers|lavender|fern|reed|reeds|lilypad|lily|rug|bedroll|floor|tile|spikes|dais|drift|bridge|jetty|boardwalk|stairs|dock|arch|archway|gate|portcullis|trapdoor|banner|sign|chime|candle|pet|bed|rubble|bundle|net|sand|cairn-?x)(-|$)/;
function solidFor(it, h) {
  if (Object.prototype.hasOwnProperty.call(R('solid'), it.id)) return R('solid')[it.id];
  if (SOLID_NO.test(it.id.replace(/^(sz|lg|x)-/, ''))) return false;
  const b = it.box, s = it.size_m;
  const hy = b.y * s, w = Math.max(b.x, b.z) * s, mn = Math.min(b.x, b.z) * s;
  if (hy < 0.75) return false;      // knee-high things and handheld items: walk through
  if (mn < 0.22) return false;      // thin poles and flat boards
  return true;
}
const colFor = (id) => (/(^|-)tree(-|$)/.test(id) && !/fallen|stump/.test(id)) ? 'trunk' : undefined;

const have = lists.filter((i) => fs.existsSync(path.join(SZ, i.id + '.glb')) && fs.existsSync(path.join(SZ, 'q', i.id + '.glb')));
const out = [];
const stat = { keep: 0, pc: 0, reject: 0 };
const rejected = [];
for (const it of have) {
  const o = opt[it.id];
  if (!o) { console.warn('no optimized.json record', it.id); continue; }
  if (R('reject')[it.id]) { stat.reject++; rejected.push({ id: it.id, reason: R('reject')[it.id] }); continue; }
  const bb = o.bbox_before || o.bbox;
  const box = { x: r2(bb[3] - bb[0]), y: r2(bb[4] - bb[1]), z: r2(bb[5] - bb[2]) };
  const size_m = R('size')[it.id] ?? it.size_m;
  const pc = !!R('pcOnly')[it.id];
  const e = { id: it.id, name: R('name')[it.id] || autoName(it.id), group: it.group, tags: tagsFor(it, R('tags')[it.id]), size_m, box, ground: it.ground !== false, tier: pc ? 'pc' : 'all', solid: false, prompt: it.prompt };
  const col = colFor(it.id); e.solid = solidFor({ ...it, box, size_m }, null);
  if (col && e.solid) e.col = col;
  if (pc) { stat.pc++; const alt = R('alt')[it.id]; if (alt) e.alt = alt; e.note = 'PC only: ' + R('pcOnly')[it.id]; }
  else stat.keep++;
  if (R('notes')[it.id]) e.note = (e.note ? e.note + '; ' : '') + R('notes')[it.id];
  if (rev.hero.includes(it.id)) e.hero = true;
  out.push(e);
}
// sanity: every alt must be a kept 'all' entry
const byId = Object.fromEntries(out.map((e) => [e.id, e]));
for (const e of out) if (e.alt && (!byId[e.alt] || byId[e.alt].tier !== 'all')) { console.error('bad alt', e.id, e.alt); process.exit(1); }
for (const id of rev.hero) if (!byId[id]) { console.error('hero not kept', id); process.exit(1); }
for (const k of ['reject', 'pcOnly']) for (const id of Object.keys(R(k))) if (!have.find((i) => i.id === id)) { console.error('unknown id in review.json', k, id); process.exit(1); }

const json = JSON.stringify({ version: 1, generated: new Date().toISOString().slice(0, 10), counts: { total: have.length, keep: stat.keep, pcOnly: stat.pc, rejected: stat.reject }, items: out }, null, 1);
JSON.parse(json);
const target = path.join(SZ, 'index.json'), tmp = target + '.tmp';
fs.writeFileSync(tmp, json); fs.renameSync(tmp, target);
fs.writeFileSync(path.join(B, 'rejected.json'), JSON.stringify(rejected, null, 1));
console.log('index.json written:', out.length, 'items', stat, 'bytes', json.length, 'solid', out.filter((e) => e.solid).length);

