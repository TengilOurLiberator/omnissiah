// catalog_gear.mjs -- add the gear models to public/assets/catalog.json: ONE atomic minimal edit.
//   node catalog_gear.mjs name1 name2 ...      (only these ids; each needs public/assets/hero/<id>.glb)
// Re-reads the catalogue immediately before writing, only adds/replaces its own `pack: hero` entries (never another pack's), keeps pack counts
// current, validates the result with JSON.parse, writes a temp file next to it and renames.
import fs from 'fs';
import { load, stats } from './verify.mjs';

const ROOT = 'D:/omnissiah/public/assets', CAT = ROOT + '/catalog.json';
const ORIG = 'original, made for this game';
const r3 = (x) => +x.toFixed(3);
const W = (hand, tags, extra = {}) => ({ category: 'weapon', tags: ['gear', ...tags], attach: { hand, z: 0 }, forward: '-z', up: '+y', holdRotateX: 90, hand: true, ...extra });
const P = (tags, extra = {}) => ({ category: 'prop', tags: ['gear', ...tags], ...extra });
const META = {
  'pilgrim-sword':       W('right', ['melee', 'sword', 'starter', 'pilgrim', 'cog']),
  'pilgrim-bow':         W('left', ['ranged', 'bow', 'starter', 'pilgrim']),
  'pilgrim-shield':      W('left', ['shield', 'round', 'starter', 'pilgrim', 'cog']),
  'novice-staff':        W('right', ['staff', 'magic', 'starter', 'fractal', 'orb', 'glow']),
  'reliquary-lantern':   W('left', ['lantern', 'light', 'relic', 'starter', 'glow'], { holdRotateX: 0, origin: 'top of the bail; hangs along -Y' }),
  'health-vial':         P(['pickup', 'potion', 'vial', 'health', 'red', 'glow'], { origin: 'bbox centre' }),
  'mana-vial':           P(['pickup', 'potion', 'vial', 'mana', 'blue', 'glow'], { origin: 'bbox centre' }),
  'cog-crown':           P(['wearable', 'crown', 'relic', 'reward', 'cog', 'gold', 'glow'], { origin: 'centre of the head ring, +Y up, front -Z' }),
  'cog-greatsword':      W('right', ['melee', 'sword', 'greatsword', 'cog', 'glow']),
  'lightning-spear':     W('right', ['melee', 'spear', 'lightning', 'glow']),
  'censer-flail':        W('right', ['melee', 'flail', 'mace', 'censer', 'fire', 'glow']),
  'rune-hammer':         W('right', ['melee', 'hammer', 'rune', 'stone', 'glow']),
  'clockwork-crossbow':  W('right', ['ranged', 'crossbow', 'clockwork', 'cog', 'glow']),
  'plasma-blunderbuss':  W('right', ['ranged', 'blunderbuss', 'plasma', 'sci-fi', 'brass', 'glow']),
  'fractal-staff':       W('right', ['staff', 'magic', 'fractal', 'orb', 'glow']),
  'twin-sickles':        W('right', ['melee', 'sickle', 'twin', 'cog', 'glow']),
  'eye-tower-shield':    W('left', ['shield', 'tower', 'eye', 'omnissiah', 'cog', 'glow']),
  'grapple-gauntlet':    W('right', ['tool', 'gauntlet', 'grapple', 'hook', 'brass', 'glow']),
  'spell-tome':          W('left', ['spellbook', 'tome', 'magic', 'book', 'glow'], { holdRotateX: 0, origin: 'centre of the spine; cover faces -Z' }),
  'brass-key':           P(['pickup', 'key', 'brass', 'cog', 'glow'], { origin: 'bbox centre' }),
  'treasure-idol':       P(['pickup', 'idol', 'treasure', 'gold', 'omnissiah', 'glow'], { origin: 'bbox centre' }),
  'pilgrim-hood':        P(['wearable', 'hood', 'pilgrim', 'cloth'], { origin: 'head centre, +Y up, front -Z', doubleSided: true }),
  'gear-halo':           P(['wearable', 'halo', 'cog', 'gold', 'glow'], { origin: 'ring centre (float ~0.28 m above the head), +Y up' }),
  'hover-sled':          { category: 'vehicle', tags: ['gear', 'vehicle', 'hover', 'sled', 'sci-fi', 'brass', 'glow'], vehicle: true },
  'brass-strider':       { category: 'vehicle', tags: ['gear', 'vehicle', 'walker', 'mount', 'strider', 'brass', 'steam'], vehicle: true },
  'biplane':             { category: 'vehicle', tags: ['gear', 'vehicle', 'plane', 'biplane', 'aircraft', 'flying'], vehicle: true },
};

const ids = process.argv.slice(2);
const entries = {};
for (const id of ids) {
  const m = META[id]; if (!m) throw new Error('no META for ' + id);
  const f = `${ROOT}/hero/${id}.glb`;
  const st = stats(await load(f), f);
  const { hand, vehicle, ...meta } = m;
  const clips = st.clips.map((c) => c.split(':')[0]);
  const e = {
    url: `/assets/hero/${id}.glb`, pack: 'hero', category: meta.category, tris: st.tris, size: st.size, min: st.min, rigged: false, clips, tags: meta.tags,
    license: ORIG, height: r3(st.size[1]), scale: 1, draws: st.materials.length, materials: st.materials.length, atlas: 'hero-palette', emissive: 'Emissive',
  };
  if (meta.attach) Object.assign(e, { attach: meta.attach, length: r3(Math.max(...st.size)), forward: meta.forward, up: meta.up, holdRotateX: meta.holdRotateX });
  if (meta.origin) e.origin = meta.origin;
  if (meta.doubleSided) e.doubleSided = true;
  if (clips.length) { e.animated = 'nodes'; e.ownClips = clips.length; e.durations = Object.fromEntries(st.clips.map((c) => { const [n, d] = c.split(':'); return [n, parseFloat(d)]; })); }
  if (vehicle) { e.forward = '-z'; e.up = '+y'; e.origin = 'ground centre'; }
  entries[id] = e;
}

// ---- the atomic edit: re-read right now, merge, validate, rename
const text = fs.readFileSync(CAT, 'utf8');
const cat = JSON.parse(text);
let n = 0;
for (const [k, v] of Object.entries(entries)) {
  if (cat.models[k] && cat.models[k].pack !== 'hero') { console.log('SKIP (name taken by another pack):', k); continue; }
  cat.models[k] = v; n++;
}
let bytes = 0; for (const f of fs.readdirSync(ROOT + '/hero')) bytes += fs.statSync(ROOT + '/hero/' + f).size;
if (cat.packs.hero) { cat.packs.hero.models = Object.values(cat.models).filter((m) => m.pack === 'hero').length; cat.packs.hero.bytes = bytes; }
const out = JSON.stringify(cat, null, 2);
JSON.parse(out);
const tmp = CAT + '.tmp-gear';
fs.writeFileSync(tmp, out);
JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.renameSync(tmp, CAT);
console.log('catalog updated:', n, 'entries ->', Object.keys(entries).join(', '), '| hero models:', cat.packs.hero && cat.packs.hero.models);
