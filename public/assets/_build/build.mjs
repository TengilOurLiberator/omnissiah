// build.mjs — curates the downloaded CC0 packs (D:\omnissiah\.cache\assets-src) into public/assets/<pack>/*.glb
// and writes public/assets/_build/selection.json (consumed by catalog.mjs).   Offline tool, not part of the game.
//   node public/assets/_build/build.mjs
// See docs/ASSETS.md for sources/URLs and how to add more.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readGltf, rebuild, writeGlb } from './gltfpack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const SRC = path.resolve(HERE, '../../../.cache/assets-src');

// ------------------------------------------------------------------------------------------------ packs
export const PACKS = {
  'kaykit-adventurers': { title: 'KayKit Adventurers Character Pack 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0', license: 'CC0-1.0', licenseFile: 'adv/addons/kaykit_character_pack_adventures/LICENSE.txt' },
  'kaykit-skeletons': { title: 'KayKit Skeletons Character Pack 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0', license: 'CC0-1.0', licenseFile: 'skel/addons/kaykit_character_pack_skeletons/LICENSE.txt' },
  'kaykit-dungeon': { title: 'KayKit Dungeon Remastered 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0', license: 'CC0-1.0', licenseFile: 'dun/addons/kaykit_dungeon_remastered/Assets/LICENSE.txt' },
  'kaykit-medieval': { title: 'KayKit Medieval Hexagon Pack 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0', license: 'CC0-1.0', licenseFile: 'hex/addons/kaykit_medieval_hexagon_pack/LICENSE.txt' },
  'kaykit-halloween': { title: 'KayKit Halloween Bits 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0', license: 'CC0-1.0', licenseFile: 'hal/addons/kaykit_halloween_bits/Assets/LICENSE.txt' },
  'kaykit-furniture': { title: 'KayKit Furniture Bits 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0', license: 'CC0-1.0', licenseFile: 'furn/addons/kaykit_furniture_bits/Assets/LICENSE.txt' },
  'kenney-castle': { title: 'Kenney Castle Kit', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/castle-kit', license: 'CC0-1.0', licenseFile: 'k_castle/License.txt' },
  'kenney-town': { title: 'Kenney Fantasy Town Kit 2.0', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/fantasy-town-kit', license: 'CC0-1.0', licenseFile: 'k_town/License.txt' },
  'kenney-survival': { title: 'Kenney Survival Kit', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/survival-kit', license: 'CC0-1.0', licenseFile: 'k_survival/License.txt' },
  'kenney-pirate': { title: 'Kenney Pirate Kit', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/pirate-kit', license: 'CC0-1.0', licenseFile: 'k_pirate/License.txt' },
  'kenney-nature': { title: 'Kenney Nature Kit 2.1', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/nature-kit', license: 'CC0-1.0', licenseFile: 'k_nature/License.txt' },
  'kenney-graveyard': { title: 'Kenney Graveyard Kit 5.0', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/graveyard-kit', license: 'CC0-1.0', licenseFile: 'k_grave/License.txt' },
  'kenney-pets': { title: 'Kenney Cube Pets 1.0', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/cube-pets', license: 'CC0-1.0', licenseFile: 'k_pets/License.txt' },
  'kenney-characters': { title: 'Kenney Mini Characters 1.0 + Mini Dungeon', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/mini-characters', license: 'CC0-1.0', licenseFile: 'k_minichar/License.txt' },
  'kenney-blasters': { title: 'Kenney Blaster Kit 2.1', author: 'Kenney (kenney.nl)', url: 'https://kenney.nl/assets/blaster-kit', license: 'CC0-1.0', licenseFile: 'k_blaster/License.txt' },
};

const kebab = (s) => s.replace(/\.gltf$/i, '').replace(/[_\s]+/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase().replace(/-+/g, '-');
const ls = (dir, ext) => fs.readdirSync(path.join(SRC, dir)).filter((f) => ext.test(f)).sort();
const baseOf = (f) => f.replace(/\.gltf\.glb$/i, '').replace(/\.(glb|gltf)$/i, '');

const selection = {};   // name -> record
const animSets = {};    // set -> record
const claimed = new Set();
const stats = { files: 0, bytes: 0 };
const imageHashes = {}; // pack -> Map(hash -> filename)

function claim(name, packId) {
  let n = name;
  if (claimed.has(n)) n = `${packId.replace(/^kaykit-|^kenney-/, '')}-${name}`;
  if (claimed.has(n)) throw new Error('duplicate name ' + n);
  claimed.add(n);
  return n;
}

function imageUriFor(packId) {
  const map = (imageHashes[packId] ??= new Map());
  return (i, def, bytes) => {
    if (!bytes) throw new Error('image without data');
    const hash = crypto.createHash('md5').update(bytes).digest('hex');
    if (map.has(hash)) return map.get(hash);
    let base = path.basename(def.uri ?? `${def.name || 'atlas'}.png`).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
    if (!/\.(png|jpg|jpeg|webp)$/.test(base)) base += '.png';
    if ([...map.values()].includes(base)) base = base.replace(/\.(\w+)$/, `-${hash.slice(0, 4)}.$1`);
    fs.mkdirSync(path.join(OUT, packId), { recursive: true });
    fs.writeFileSync(path.join(OUT, packId, base), bytes);
    map.set(hash, base);
    return base;
  };
}

const isIK = (n) => /IK|^control-/.test(n || '');

function emit(packId, srcFile, rawName, extra = {}, rebuildOpts = {}) {
  const name = claim(extra.name ?? kebab(rawName), packId);
  const g = readGltf(srcFile);
  const report = {};
  const { json, bin } = rebuild(g, { imageUri: imageUriFor(packId), animations: true, report, ...rebuildOpts });
  const buf = writeGlb(json, bin);
  fs.mkdirSync(path.join(OUT, packId), { recursive: true });
  fs.writeFileSync(path.join(OUT, packId, name + '.glb'), buf);
  stats.files++; stats.bytes += buf.length;
  const { name: _n, ...rest } = extra;
  selection[name] = { url: `/assets/${packId}/${name}.glb`, pack: packId, source: path.relative(SRC, srcFile).replace(/\\/g, '/'), ...rest, build: report };
  return name;
}

// ------------------------------------------------------------------------------------------------ KayKit characters (shared rig)
const RIG_ADV = 'kaykit-rig-adventurers', RIG_SKEL = 'kaykit-rig-skeletons';
const charOpts = (def) => ({
  mergeSkinned: true,
  animations: false,
  dropNode: (n) => isIK(n),
  bakeRigid: (name, idx, jointName) => !/^handslot/.test(jointName), // hats, helmets and capes become part of the body mesh; hand items stay separate nodes
  keepJoint: (n) => /^handslot/.test(n),
  mergedName: def.mergedName,
  nodeExtras: (name) => (def.equip?.[name] ? { equip: def.equip[name].side, hand: def.equip[name].side, default: !!def.equip[name].default } : undefined),
});
const EQUIP_SIDE = (right, left, defaults) => {
  const o = {};
  for (const n of right) o[n] = { side: 'right', default: defaults.includes(n) };
  for (const n of left) o[n] = { side: 'left', default: defaults.includes(n) };
  return o;
};

// Standing height of the bare body (top of the head mesh, hats/helmets excluded) in model units.
function headTop(file) {
  const g = readGltf(file);
  let top = 0;
  g.json.nodes.forEach((n) => {
    if (n.mesh === undefined || !/_(Head|Head_Hooded|Skull)$/.test(n.name || '')) return;
    for (const p of g.json.meshes[n.mesh].primitives) top = Math.max(top, g.json.accessors[p.attributes.POSITION].max[1]);
  });
  return +top.toFixed(3);
}

// which hand slot a KayKit item belongs in, and its z offset there (taken from the equipment nodes of the authored hero files)
const handHint = (b) => (/shield|spellbook|offhand/i.test(b) ? { hand: 'left', z: /shield/i.test(b) ? 0.156 : 0 } : { hand: 'right', z: 0 });

function heroes() {
  const dir = 'adv/addons/kaykit_character_pack_adventures';
  const H = [
    ['Knight', { tags: ['hero', 'knight', 'warrior', 'human', 'armor', 'sword', 'shield'], equip: EQUIP_SIDE(['1H_Sword', '2H_Sword'], ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield'], ['1H_Sword', 'Rectangle_Shield']) }],
    ['Barbarian', { tags: ['hero', 'barbarian', 'warrior', 'human', 'axe', 'viking'], equip: EQUIP_SIDE(['1H_Axe', '2H_Axe', 'Mug'], ['1H_Axe_Offhand', 'Barbarian_Round_Shield'], ['2H_Axe']) }],
    ['Mage', { tags: ['hero', 'mage', 'wizard', 'caster', 'human', 'magic'], equip: EQUIP_SIDE(['1H_Wand', '2H_Staff'], ['Spellbook', 'Spellbook_open'], ['2H_Staff']) }],
    ['Rogue', { tags: ['hero', 'rogue', 'thief', 'archer', 'human', 'stealth'], equip: EQUIP_SIDE(['1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'], ['Knife_Offhand'], ['Knife', 'Knife_Offhand']) }],
    ['Rogue_Hooded', { tags: ['hero', 'rogue', 'thief', 'hood', 'human', 'stealth'], equip: EQUIP_SIDE(['1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'], ['Knife_Offhand'], ['Knife', 'Knife_Offhand']) }],
  ];
  for (const [file, def] of H) {
    emit('kaykit-adventurers', path.join(SRC, dir, 'Characters/gltf', file + '.glb'), file,
      { category: 'character', stand: headTop(path.join(SRC, dir, 'Characters/gltf', file + '.glb')), tags: def.tags, rig: 'kaykit-medium', animSets: [RIG_ADV, RIG_SKEL], equipment: Object.fromEntries(Object.entries(def.equip).map(([k, v]) => [k, { side: v.side, default: v.default }])) },
      charOpts({ ...def, mergedName: file }));
  }
  // weapons / items
  const W = {
    arrow: ['weapon', ['ammo', 'arrow']], arrow_bundle: ['weapon', ['ammo', 'arrow']], axe_1handed: ['weapon', ['melee', 'axe'], 'axe'], axe_2handed: ['weapon', ['melee', 'axe', 'two-handed'], 'great-axe'],
    crossbow_1handed: ['weapon', ['ranged', 'crossbow'], 'crossbow'], crossbow_2handed: ['weapon', ['ranged', 'crossbow', 'two-handed'], 'heavy-crossbow'], dagger: ['weapon', ['melee', 'dagger', 'knife']],
    mug_empty: ['prop', ['tavern', 'mug']], mug_full: ['prop', ['tavern', 'mug', 'beer']], quiver: ['weapon', ['ammo', 'quiver']],
    shield_badge: ['weapon', ['shield']], shield_badge_color: ['weapon', ['shield']], shield_round: ['weapon', ['shield']], shield_round_barbarian: ['weapon', ['shield']], shield_round_color: ['weapon', ['shield']],
    shield_spikes: ['weapon', ['shield', 'spikes']], shield_spikes_color: ['weapon', ['shield', 'spikes']], shield_square: ['weapon', ['shield']], shield_square_color: ['weapon', ['shield']],
    smokebomb: ['weapon', ['thrown', 'bomb']], spellbook_closed: ['weapon', ['magic', 'book'], 'spellbook'], spellbook_open: ['weapon', ['magic', 'book']], staff: ['weapon', ['magic', 'staff', 'two-handed']],
    sword_1handed: ['weapon', ['melee', 'sword'], 'sword'], sword_2handed: ['weapon', ['melee', 'sword', 'two-handed'], 'greatsword'], sword_2handed_color: ['weapon', ['melee', 'sword', 'two-handed'], 'greatsword-gold'], wand: ['weapon', ['magic', 'wand']],
  };
  for (const f of ls(dir + '/Assets/gltf', /\.gltf$/)) {
    const b = baseOf(f); const d = W[b]; if (!d) { console.warn('adv asset unmapped', b); continue; }
    emit('kaykit-adventurers', path.join(SRC, dir, 'Assets/gltf', f), b, { name: d[2], category: d[0], tags: d[1], attach: handHint(b) });
  }
  // shared animation set from the Knight (identical data in Barbarian and Mage)
  buildAnimSet(RIG_ADV, 'kaykit-adventurers', path.join(SRC, dir, 'Characters/gltf/Knight.glb'), 'KayKit Adventurers animation set (Rig_Medium): general human clips');
}

function skeletons() {
  const dir = 'skel/addons/kaykit_character_pack_skeletons';
  const S = {
    Skeleton_Warrior: ['skeleton', 'warrior', 'melee'], Skeleton_Mage: ['skeleton', 'mage', 'caster', 'magic'], Skeleton_Rogue: ['skeleton', 'rogue', 'archer'], Skeleton_Minion: ['skeleton', 'minion', 'grunt'],
  };
  for (const [file, tags] of Object.entries(S)) {
    emit('kaykit-skeletons', path.join(SRC, dir, 'Characters/gltf', file + '.glb'), file,
      { category: 'enemy', stand: headTop(path.join(SRC, dir, 'Characters/gltf', file + '.glb')), tags: [...tags, 'undead', 'monster', 'enemy'], rig: 'kaykit-medium', animSets: [RIG_SKEL, RIG_ADV] },
      charOpts({ mergedName: file }));
  }
  const T = (n) => (/Arrow/.test(n) ? ['ammo', 'arrow'] : /Shield/.test(n) ? ['shield'] : /Crossbow/.test(n) ? ['ranged', 'crossbow'] : /Quiver/.test(n) ? ['ammo', 'quiver'] : /Staff/.test(n) ? ['magic', 'staff'] : /Axe/.test(n) ? ['melee', 'axe'] : ['melee', 'sword', 'blade']);
  for (const f of ls(dir + '/Assets/gltf', /\.gltf$/)) {
    const b = baseOf(f);
    emit('kaykit-skeletons', path.join(SRC, dir, 'Assets/gltf', f), b, { category: 'weapon', tags: [...T(b), 'skeleton', 'undead'], attach: handHint(b) });
  }
  buildAnimSet(RIG_SKEL, 'kaykit-skeletons', path.join(SRC, dir, 'Characters/gltf/Skeleton_Warrior.glb'), 'KayKit Skeletons animation set (Rig_Medium): includes spawn/awaken/taunt/death-C clips');
}

function buildAnimSet(setId, packId, srcFile, title) {
  const g = readGltf(srcFile);
  const { json, bin } = rebuild(g, {
    imageUri: () => '', noMeshes: true, animations: true, dropNode: (n) => isIK(n),
    trackFilter: ({ path: p, values, comp, rest }) => {
      if (p === 'rotation') return true;
      const ref = rest ?? (p === 'scale' ? [1, 1, 1] : [0, 0, 0]);
      for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - ref[i % comp]) > 2e-3) return true;
      return false; // constant and equal to the rest pose: redundant
    },
  });
  const file = path.join(OUT, 'anim', `${setId}.glb`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = writeGlb(json, bin);
  fs.writeFileSync(file, buf);
  stats.files++; stats.bytes += buf.length;
  animSets[setId] = { url: `/assets/anim/${setId}.glb`, pack: packId, rig: 'kaykit-medium', title };
}

// ------------------------------------------------------------------------------------------------ generic static packs
function bulk(packId, dir, filter, describe, extraOpts = {}) {
  for (const f of ls(dir, /\.(glb|gltf)$/)) {
    const b = baseOf(f);
    if (!filter(b)) continue;
    const d = describe(b);
    if (!d) continue;
    emit(packId, path.join(SRC, dir, f), b, d, extraOpts);
  }
}
const has = (re) => (s) => re.test(s);
const inList = (arr) => { const s = new Set(arr); return (b) => s.has(b); };

function dungeon() {
  const keepWall = new Set(['wall', 'wall_arched', 'wall_archedwindow_open', 'wall_broken', 'wall_corner', 'wall_cracked', 'wall_doorway', 'wall_endcap', 'wall_gated', 'wall_half', 'wall_pillar', 'wall_Tsplit', 'wall_window_open', 'wall_window_closed', 'wall_crossing', 'wall_corner_gated', 'wall_shelves']);
  const keepFloor = new Set(['floor_tile_large', 'floor_tile_small', 'floor_tile_small_decorated', 'floor_dirt_large', 'floor_wood_large', 'floor_wood_small', 'floor_tile_big_spikes', 'floor_tile_grate', 'floor_tile_big_grate']);
  const keepTable = new Set(['table_long', 'table_long_tablecloth', 'table_long_broken', 'table_medium', 'table_medium_tablecloth', 'table_small']);
  const filter = (b) => {
    if (/^banner_pattern/.test(b)) return false;
    if (/^banner_(thin|triple|shield)_/.test(b)) return /_(red|blue)$/.test(b);
    if (/^banner_/.test(b)) return /_(red|blue|green|yellow|white)$/.test(b);
    if (/^trunk_/.test(b)) return /_A$/.test(b);
    if (/^floor_/.test(b)) return keepFloor.has(b);
    if (/^wall_/.test(b)) return keepWall.has(b);
    if (/^table_/.test(b)) return keepTable.has(b);
    if (/^bottle_/.test(b)) return ['bottle_A_brown', 'bottle_A_green', 'bottle_B_brown', 'bottle_C_green'].includes(b);
    if (/^(candle|plate|stairs|shelf)/.test(b)) return !/(thin$|melted|stairs_wall|stairs_walled|stairs_wood_decorated|shelf_small_candles|plate_small|stairs_narrow)/.test(b);
    if (/^barrier/.test(b)) return /^barrier(_column|_half)?$/.test(b);
    if (/^(box_small_decorated|barrel_small_stack|coin_stack_(small|medium)|rubble_half|keyring_hanging|sword_shield_broken)$/.test(b)) return false;
    return true;
  };
  bulk('kaykit-dungeon', 'dun/addons/kaykit_dungeon_remastered/Assets/gltf', filter, (b) => {
    let category = 'prop', tags = ['dungeon'];
    if (/^banner/.test(b)) tags = ['dungeon', 'banner', 'flag', 'decoration'];
    else if (/^(wall|floor|stairs|column|pillar|barrier)/.test(b)) { category = 'structure'; tags = ['dungeon', b.split('_')[0]]; }
    else if (/^(chair|stool|table|bed|shelf)/.test(b)) { category = 'furniture'; tags = ['dungeon', b.split('_')[0]]; }
    else if (/^(barrel|keg|box|crates|trunk)/.test(b)) tags = ['dungeon', 'container', b.split('_')[0]];
    else if (/^chest/.test(b)) tags = ['dungeon', 'container', 'chest', 'treasure'];
    else if (/^(coin|key)/.test(b)) tags = ['dungeon', 'treasure', b.split('_')[0]];
    else if (/^(torch)/.test(b)) tags = ['dungeon', 'torch', 'light', 'fire'];
    else if (/^candle/.test(b)) tags = ['dungeon', 'candle', 'light'];
    else if (/^(bottle|plate)/.test(b)) tags = ['dungeon', 'tavern', b.split('_')[0]];
    else if (/^sword_shield/.test(b)) { category = 'weapon'; tags = ['dungeon', 'sword', 'shield', 'wall-mount']; }
    return { category, tags };
  });
}

function medieval() {
  const base = 'hex/addons/kaykit_medieval_hexagon_pack/Assets/gltf/';
  for (const col of ['red', 'blue', 'green', 'yellow']) {
    bulk('kaykit-medieval', base + 'buildings/' + col, () => true, (b) => ({ name: kebab(b.replace(/^building_/, '')), category: 'building', tags: ['building', 'medieval', col, ...b.replace(/^building_/, '').replace(new RegExp('_' + col + '$'), '').split('_').map((s) => s.toLowerCase()).filter((s) => !/^[ab]$/.test(s))] }));
  }
  bulk('kaykit-medieval', base + 'buildings/neutral', () => true, (b) => {
    const nm = kebab(b.replace(/^building_/, ''));
    const isStruct = /^(wall|fence|bridge)/.test(nm) || /^(wall|fence)/.test(b);
    return { name: nm, category: /catapult/.test(b) ? 'vehicle' : isStruct ? 'structure' : 'building', tags: ['medieval', ...nm.split('-')] };
  });
  bulk('kaykit-medieval', base + 'decoration/props', () => true, (b) => ({ category: /^(flag)/.test(b) ? 'prop' : 'prop', tags: ['medieval', ...b.split('_').filter((s) => s.length > 1)] }));
  const nat = (b) => /^(tree|trees|rock|hills|hill|mountain|cloud|waterlily|waterplant)/.test(b);
  bulk('kaykit-medieval', base + 'decoration/nature', nat, (b) => ({ category: 'nature', tags: ['hex-tile', /^tree/.test(b) ? 'tree' : /^rock/.test(b) ? 'rock' : /^(hill|mountain)/.test(b) ? 'terrain' : /^cloud/.test(b) ? 'sky' : 'water-plant', ...b.split('_').filter((s) => s.length > 1)] }));
}

function halloween() {
  bulk('kaykit-halloween', 'hal/addons/kaykit_halloween_bits/Assets/gltf', (b) => !/^(path|floor)_/.test(b), (b) => {
    let category = 'prop', tags = ['halloween', 'graveyard', ...b.split('_').filter((s) => s.length > 1)];
    if (/^tree/.test(b)) category = 'nature';
    else if (/^(arch|crypt|fence|pillar|post)/.test(b)) category = 'structure';
    else if (/^bench/.test(b)) category = 'furniture';
    return { category, tags };
  });
}

function furniture() {
  bulk('kaykit-furniture', 'furn/addons/kaykit_furniture_bits/Assets/gltf', (b) => !/^pictureframe_(large_B|medium|small_B|small_C|standing_B)$/.test(b) && !/^rug_rectangle_stripes/.test(b), (b) => ({ category: 'furniture', tags: ['furniture', 'interior', ...b.split('_').filter((s) => s.length > 1 && !/^[a-c]$/i.test(s))] }));
}

function castle() {
  bulk('kenney-castle', 'k_castle/Models/GLB format', () => true, (b) => {
    let category = 'structure';
    if (/^siege/.test(b)) category = 'vehicle';
    else if (/^flag/.test(b)) category = 'prop';
    else if (/^(tree|rocks)/.test(b)) category = 'nature';
    return { category, tags: ['castle', 'medieval', ...b.split('-')] };
  });
}

function town() {
  const keep = inList(['banner-green', 'banner-red', 'cart', 'cart-high', 'fence', 'fence-broken', 'fence-curved', 'fence-gate', 'fountain-round', 'fountain-round-detail', 'fountain-square', 'fountain-square-detail', 'hedge', 'hedge-curved', 'hedge-gate', 'hedge-large', 'lantern', 'rock-large', 'rock-small', 'rock-wide', 'stall', 'stall-bench', 'stall-green', 'stall-red', 'stall-stool', 'tree', 'tree-crooked', 'tree-high', 'tree-high-crooked', 'tree-high-round', 'watermill', 'watermill-wide', 'windmill', 'wheel', 'pillar-stone', 'pillar-wood', 'wall', 'wall-wood', 'wall-door', 'wall-wood-door', 'roof-gable', 'roof-high-gable', 'wall-window-shutters', 'wall-wood-window-shutters', 'road', 'road-bend', 'stairs-stone', 'stairs-wood']);
  bulk('kenney-town', 'k_town/Models/GLB format', keep, (b) => {
    let category = 'structure';
    if (/^(tree|rock)/.test(b)) category = 'nature';
    else if (/^(cart|stall|lantern|banner|wheel)/.test(b)) category = 'prop';
    else if (/^(windmill|watermill)/.test(b)) category = 'building';
    return { category, tags: ['village', 'town', 'fantasy', ...b.split('-')] };
  });
}

function survival() {
  const keep = (b) => !/^(floor|metal|patch|grass|structure|signpost-single)/.test(b);
  bulk('kenney-survival', 'k_survival/Models/GLB format', keep, (b) => {
    let category = 'prop';
    if (/^tool/.test(b)) category = 'weapon';
    if (/^(tree|rock)/.test(b)) category = 'nature';
    if (/^fence/.test(b)) category = 'structure';
    return { category, tags: ['survival', 'camp', ...b.split('-')] };
  });
}

function pirate() {
  const keep = (b) => /^(ship|boat|cannon|mast|palm|rocks|tower-complete|tower-watch|barrel|chest|crate|bottle|flag-pirate|tool|castle-wall|castle-gate)/.test(b) && !/(pennant)$/.test(b);
  bulk('kenney-pirate', 'k_pirate/Models/GLB format', keep, (b) => {
    let category = 'prop';
    if (/^(ship|boat|cannon)/.test(b) && !/ball/.test(b)) category = 'vehicle';
    if (/^(palm|rocks)/.test(b)) category = 'nature';
    if (/^(tower|castle)/.test(b)) category = 'structure';
    return { category, tags: ['pirate', 'sea', ...b.split('-')] };
  });
}

function nature() {
  const trees = inList(['tree_oak', 'tree_oak_dark', 'tree_oak_fall', 'tree_default', 'tree_default_fall', 'tree_fat', 'tree_fat_fall', 'tree_simple', 'tree_tall', 'tree_thin', 'tree_small', 'tree_detailed', 'tree_plateau', 'tree_cone', 'tree_cone_dark', 'tree_blocks', 'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineTallA', 'tree_pineTallB', 'tree_pineTallC', 'tree_pineTallD', 'tree_pineTallA_detailed', 'tree_pineRoundA', 'tree_pineRoundB', 'tree_pineRoundC', 'tree_pineSmallA', 'tree_pineSmallB', 'tree_palm', 'tree_palmTall', 'tree_palmDetailedTall', 'tree_palmBend']);
  const keep = (b) => {
    if (/^tree_/.test(b)) return trees(b);
    if (/^(rock_(large[A-F]|small[A-C]|tall[A-C]|smallFlatA)|stone_(largeA|tallA))$/.test(b)) return true;
    return /^(plant_|flower_|mushroom_|log|stump_|campfire_|tent_|cactus|crop_|fence_(simple|planks|gate|corner)$|fence_planksDouble|fence_simpleHigh|fence_simpleLow|bridge_(wood|stone)$|bridge_woodRound$|sign|statue_|pot_|grass$|grass_large|lily|canoe|bed$|hanging_moss|crops_(wheatStageB|cornStageD|dirtRow|dirtDoubleRow|bambooStageB))/.test(b);
  };
  bulk('kenney-nature', 'k_nature/Models/GLTF format', keep, (b) => {
    let category = 'nature';
    const tags = ['nature', ...(b.startsWith('tree_') ? ['tree'] : []), ...kebab(b).split('-')];
    if (/^(campfire|tent|sign|bed|canoe|pot|statue)/.test(b)) category = 'prop';
    if (/^(fence|bridge)/.test(b)) category = 'structure';
    if (/^(plant|flower|mushroom|cactus|crop)/.test(b)) tags.push('plant');
    return { category, tags };
  }, { srgbFactors: true });
}

function graveyard() {
  const dir = 'k_grave/Models/GLB format';
  const chars = { 'character-zombie': ['zombie', ['zombie', 'undead', 'monster']], 'character-vampire': ['vampire', ['vampire', 'undead', 'monster']], 'character-ghost': ['ghost', ['ghost', 'undead', 'spirit', 'monster']], 'character-skeleton': ['bone-walker', ['skeleton', 'undead', 'monster']], 'character-keeper': ['gravekeeper', ['keeper', 'npc', 'human', 'gravedigger']] };
  for (const [file, [name, tags]] of Object.entries(chars)) {
    emit('kenney-graveyard', path.join(SRC, dir, file + '.glb'), file, { name, category: name === 'gravekeeper' ? 'character' : 'enemy', tags: [...tags, 'kenney-mini'], rig: 'kenney-mini' }, { rigidToSkin: true });
  }
  const keep = (b) => !/^character/.test(b) && !/^(brick-wall|iron-fence-(bar|border-column|border-curve|curve|damaged)|stone-wall-(column|curve|damaged)|border-pillar|grave-border|crypt-large-roof|crypt-small-roof|pine-(crooked|fall-crooked)|trunk-long|debris-wood|pillar-(square|small)|fence-damaged|bench-damaged|gravestone-(bevel|debris|decorative)|lightpost-(all|double)|hay-bale-bundled|detail-(plate|chalice)|candle-multiple|lantern-glass)/.test(b);
  bulk('kenney-graveyard', dir, keep, (b) => {
    let category = 'prop';
    if (/^(crypt|fence|iron|stone-wall|column|pillar|road)/.test(b)) category = 'structure';
    if (/^(pine|trunk|rocks)/.test(b)) category = 'nature';
    if (/^shovel/.test(b)) category = 'weapon';
    return { category, tags: ['graveyard', 'spooky', ...b.split('-')] };
  });
}

function pets() {
  bulk('kenney-pets', 'k_pets/Models/GLB format', () => true, (b) => ({ name: b.replace(/^animal-/, ''), category: 'animal', tags: ['animal', 'pet', 'cute', b.replace(/^animal-/, ''), 'kenney-pets'], rig: 'kenney-animal' }), { rigidToSkin: true });
}

const MINI_SKIN = { mergeSkinned: true, bakeRigid: () => false, keepJoint: () => true }; // Kenney mini characters are already skinned (7 bones): just merge their parts into one mesh
function minis() {
  bulk('kenney-characters', 'k_minichar/Models/GLB format', has(/^character-/), (b) => {
    const m = /^character-(male|female)-(\w)$/.exec(b);
    return { name: `villager-${m[1]}-${m[2]}`, category: 'character', tags: ['villager', 'npc', 'human', m[1], 'kenney-mini'], rig: 'kenney-mini' };
  }, MINI_SKIN);
  bulk('kenney-characters', 'k_minidun/Models/GLB format', has(/^character-/), (b) => {
    const orc = /orc/.test(b);
    return { name: orc ? 'orc' : 'mini-adventurer', category: orc ? 'enemy' : 'character', tags: orc ? ['orc', 'monster', 'goblinoid', 'enemy', 'kenney-mini'] : ['human', 'adventurer', 'npc', 'kenney-mini'], rig: 'kenney-mini' };
  }, MINI_SKIN);
}

function blasters() {
  const keep = (b) => /^(blaster-[a-r]|grenade-[ab]|scope-|silencer-|clip-|target-(small|large)$)/.test(b);
  bulk('kenney-blasters', 'k_blaster/Models/GLB format', keep, (b) => ({ category: 'weapon', tags: ['sci-fi', 'ranged', /^blaster/.test(b) ? 'gun' : /^grenade/.test(b) ? 'thrown' : 'attachment', ...b.split('-')] }));
}

// ------------------------------------------------------------------------------------------------ run
fs.mkdirSync(OUT, { recursive: true });
heroes(); skeletons(); dungeon(); medieval(); halloween(); furniture(); castle(); town(); survival(); pirate(); nature(); graveyard(); pets(); minis(); blasters();

// licences: copy each pack's licence file next to its models
const packsOut = {};
for (const [id, p] of Object.entries(PACKS)) {
  const dir = path.join(OUT, id);
  if (!fs.existsSync(dir)) continue;
  const txt = fs.readFileSync(path.join(SRC, p.licenseFile), 'utf8');
  fs.writeFileSync(path.join(dir, 'LICENSE.txt'), txt);
  packsOut[id] = { title: p.title, author: p.author, source: p.url, license: p.license, licenseFile: `/assets/${id}/LICENSE.txt` };
}
fs.writeFileSync(path.join(HERE, 'selection.json'), JSON.stringify({ models: selection, animations: animSets, packs: packsOut }, null, 1));
console.log(`wrote ${stats.files} glb, ${(stats.bytes / 1048576).toFixed(1)} MB, ${Object.keys(selection).length} models`);


