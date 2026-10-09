// core/models.js — world.models: real glTF models (CC0 packs in /assets) and AI-generated ones. READ THIS FIRST.
//
// USE      const M = ctx.world.models; if (!M) return {};            // always guard (it may be reloading)
//   const h = M.spawn(ctx, 'knight', { position: p, height: 1.8, yaw: 0 });   // YOUR ctx first; cleaned up with your creation
//   h.object (THREE.Group, placed NOW; a tiny placeholder shows until loaded)   h.ready (Promise -> h, never rejects; check h.error)
//   h.loaded  h.name  h.entry (catalogue info)  h.height (metres)  h.position (= h.object.position, move it freely)
//   h.play('walk' | 'Walking_A', { loop = true, fade = 0.2, speed = 1, once, then: 'idle' }) -> clip name or null
//        canonical aliases: idle walk run attack attack-2h shoot cast hit die jump wave cheer sit block (+ taunt dodge spawn pickup
//        throw interact crouch fall dance eat strafe-left strafe-right walk-back idle-combat). h.clipFor(alias) h.has(clip) h.clips h.stop()
//        Rigged characters start in 'idle'. Skeletons/heroes (KayKit rig) share ~95 clips: any clip name works on any of them.
//   h.equip({ right: '2H_Sword', left: 'Round_Shield' }) | h.equip('1H_Axe') | h.equip({right:null})  h.equipment -> [{name, side, visible}]
//        (KayKit heroes carry hidden weapons/shields as part of the model; defaults are visible)
//   h.hold(item, 'right'|'left')   put a weapon in a hand (default: the item's natural hand): item = model name | handle | Object3D
//   h.attach(object3D | handle, 'handslot.r' | 'head' | 'right-hand'…, { position, rotation, scale })   h.bones (name -> Bone)
//   h.setTint(0xff4040 | null)   h.remove()   h.mixer   Everything is released with your creation; never dispose models yourself.
//   Options: position (Vector3|{x,y,z}|[x,y,z]; y omitted = on the ground), yaw, scale (multiplies the recommended scale), height (metres, wins),
//            parent, castShadow, play (clip/alias or false), unlit (keep unlit materials)
//   Recommended scales are built in, so spawn('barrel') or spawn('windmill') come out at human scale; pass height for exact size.
//
// SCATTER    const f = M.instances(ctx, 'tree-oak', transforms | count, { height })   static models only; ≤ a few draws for thousands
//   transforms: array of Matrix4 | { position, yaw, scale } | Vector3 | [x,y,z]      f.setMatrixAt(i, matrix4)  f.setTransform(i, {position,yaw,scale})  f.count  f.remove()
// GENERATE   const g = M.generate(ctx, 'a crooked wizard tower', { position, size = 1, name, yaw, animate = false, alive = false })   -> { object, ready, state, message, remove() }
//   woven by the server (cached forever once made); shows a swirling wireframe while it works, then swaps in the model (largest side = size).
//   animate: true | false (default false = plain static model; EXPERIMENTAL opt-in: true rigs creatures/characters, and on a cached static prompt rigs the
//     existing mesh). Rigging adds ~1-3 min the first time ('Finding its bones' / 'Teaching it to walk' in g.message while g.state is 'sculpting').
//   RIGGED results (g.rigged, g.modelName = catalogue name = cache slug, g.info = M.info()) behave exactly like KayKit characters: g.clips g.play(alias) g.clipFor g.bones g.mixer g.attach,
//     and M.spawn(ctx, g.modelName, { height }) / kit.actor(ctx, { model: g.modelName }) / M.find('wolf') work too (every rigged cached model is registered at load).
//   alive: true -> once ready it is a kit actor that wanders (kit.actor); with faction | fighter: { hp, damage, attack, ... } it also gets world.combat.fighter. g.actor / g.fighter hold them,
//     g.remove() removes everything. Things that cannot be rigged just stay static (g.alive === false).
//   Baked clips: idle walk run attack attack-2 hit die; winged also fly hover; walk/run = slither (serpent), hop (blob), glide (floating); plants only idle/wind/hit/die; legged ones add jump taunt; people (biped with arms) add wave cheer dance bow.
//   M.info(name): bodyPlan humanoid speeds{walk,run,fly} (model units/s) headBone mouthBone (bone 'Mouth': attach breath / bites there) mouth counts limbs events{attack:{hit}} bones.
//   BODY PLANS: biped quadruped multileg (6, 8 legs) winged serpent floating blob vehicle plant. Rig well: ONE creature, clearly standing, limbs apart from the body ("a wolf standing",
//     "a knight in a T-pose", "a six-legged beetle", "a snake in an S"). Poorly: limbs fused to the torso, sitting / curled / flying poses, groups, held weapons (skinned to the nearest limb).
// QUERY      M.list({ category, tag, rigged, pack, search }) -> names   M.has(n)  M.info(n)  M.find('wizard') -> best name | null   M.find(q,{all:true})
//   M.preload(['knight','sword']) -> Promise   M.clipFor(name, alias)   M.categories()   M.tags()   M.stats()
//   categories: character enemy animal weapon prop furniture building structure nature vehicle. Names are kebab-case (barrel, oak… use M.find).
//   Team colours: buildings come in -red -blue -green -yellow. Weapons' origin is the grip, pointing +Y (use h.hold).
//
// CATALOGUE (most used; M.find('wizard tower') -> the best catalogue name or null at run time, M.list({ category, search }) -> names; names are kebab-case)
// CATALOG-BEGIN
//   heroes (KayKit rig, ~95 clips, hidden weapons: h.equip): barbarian knight mage rogue rogue-hooded.   villagers (tiny, 1 draw): villager-{male,female}-{a..f} gravekeeper mini-adventurer
//   enemies: bone-walker ghost orc skeleton-mage skeleton-minion skeleton-rogue skeleton-warrior vampire zombie (+ goblin troll demon dark-knight goblin-shaman orc-warrior via the KayKit rig)
//   animals (cute cubes: idle/walk/run/eat/dance): beaver bee bunny cat caterpillar chick cow crab deer dog elephant fox giraffe hog koala lion monkey panda parrot penguin pets-fish pig polar tiger
//   weapons (origin = grip; use h.hold): sword greatsword dagger axe great-axe staff wand crossbow spellbook shield-{round,square,spikes,badge} blaster-{a..r} grenade-{a,b} tool-{axe,hammer,hoe,pickaxe,shovel}
//   buildings, each in -red -blue -green -yellow: archeryrange barracks blacksmith castle church home-a home-b lumbermill market mine tavern tower-a tower-b tower-catapult watermill well windmill
//   structures: castle-* (wall-*, tower-*, gate, bridge-*), dungeon wall-*/floor-*/pillar/stairs, village/graveyard fence-*, crypt-*, hedge-*, road*, bridge-{wood,stone,straight}, arch, fountain-*, pillar-*, tower-complete-*
//   vehicles & siege: boat-row-{large,small} ship-{small,medium,large,ghost,wreck,pirate-*} cannon cannon-mobile siege-{ballista,catapult,ram,tower,trebuchet} (+ -demolished)
//   props: barrel box crate chest chest-gold coin key lantern torch campfire-{pit,stand,logs,stones} candle-* cart wheelbarrow workbench-* anvil bucket altar-stone banner-* flag-* grave* gravestone-* skull ribcage
//     pumpkin-* hay-bale sack shelves signpost stall-* tent-* tool-paddle weaponrack urn-* target
//   furniture: armchair bed-* bench bookcases/shelf-* cabinet-* chair-* couch lamp-* rug-* stool table-*    trees: tree tree-{oak,pine-*,palm-*,dead-*,autumn,fat,tall,thin,detailed,...} trees-{a,b}-*
//   nature: bush/plant-bush-*, flower-{red,yellow,purple}-*, grass, mushroom-*, rock-* rocks-* stone-*, stump-*, log*, hill-*, hills-*, mountain-*, cactus-*, cloud-*, crop-*, waterlily-*, waterplant-*, lily-*
//   campsite: bed campfire-{bricks,logs,planks,stones} canoe pot-{large,small} sign statue-{block,column,head,obelisk,ring} tent-{detailed-*,small-*}
// CATALOG-END
// CATALOG-END

import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from '/vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from '/vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

export const meta = { name: 'Models', description: 'glTF model library: spawn animated characters, props and buildings; scatter instances; generate new models.' };

// ---------------------------------------------------------------------------------------------------------------
// RESOURCE OWNERSHIP (why shared geometry survives other creations unloading)
//   boot.js unloads a creation with disposeTree(root): geometry.dispose(), material.dispose(), texture.dispose() on EVERYTHING under
//   that root. Our parsed originals live only in the cache (never under any module root), and every geometry / material / texture the
//   cache hands out is marked shared: its own `dispose` is replaced by a no-op, so a disposeTree that reaches it by way of some
//   instance's mesh does nothing. We free GPU memory ourselves: entries are reference counted by live instances, and an entry that has
//   had no instances for IDLE_FREE seconds has its GPU buffers released (freeGpu); three simply re-uploads on the next render.
//   Per-instance objects (skeletons, tinted materials, InstancedMesh matrices, placeholder effects) are disposed in remove().
// ---------------------------------------------------------------------------------------------------------------

const IDLE_FREE = 45;          // seconds without instances before an entry's GPU memory is released
const NOOP = function () {};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const kebab = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// canonical animation aliases -> candidate clip names (first one the model has wins)
const ALIASES = {
  idle: ['Idle', 'Idle_B', 'Unarmed_Idle', 'idle', 'static'],
  walk: ['Walking_A', 'Walking_B', 'Walking_C', 'walk', 'Walking_D_Skeletons'],
  run: ['Running_A', 'Running_B', 'Running_C', 'run', 'sprint'],
  attack: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab', 'Unarmed_Melee_Attack_Punch_A', 'attack-melee-right', 'attack', 'bite'],
  'attack-2h': ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Chop', '2H_Melee_Attack_Stab', '2H_Melee_Attack_Spin', '@attack'],
  shoot: ['1H_Ranged_Shoot', '2H_Ranged_Shoot', '1H_Ranged_Shooting', 'holding-right-shoot', 'holding-both-shoot', 'Throw'],
  cast: ['Spellcast_Shoot', 'Spellcast_Raise', 'Spellcasting', 'Spellcast_Long', 'Spellcast_Summon', 'interact-right', 'emote-yes'],
  hit: ['Hit_A', 'Hit_B', 'Block_Hit', 'gesture-negative', 'fall'],
  die: ['Death_A', 'Death_B', 'Death_C_Skeletons', 'die'],
  jump: ['Jump_Full_Short', 'Jump_Start', 'Jump_Idle', 'jump'],
  wave: ['Interact', 'Cheer', 'Use_Item', 'gesture-positive', 'emote-yes', 'interact-right', 'dance'],
  cheer: ['Cheer', 'Taunt', 'emote-yes', 'dance', 'gesture-positive', 'jump'],
  sit: ['Sit_Chair_Idle', 'Sit_Floor_Idle', 'Sit_Chair_Pose', 'sit'],
  block: ['Blocking', 'Block', 'Block_Attack', 'crouch'],
  taunt: ['Taunt', 'Taunt_Longer', 'Cheer', 'emote-no'],
  dodge: ['Dodge_Backward', 'Dodge_Left', 'Dodge_Right', 'Dodge_Forward'],
  spawn: ['Spawn_Ground', 'Spawn_Air', 'Skeletons_Awaken_Standing', 'pick-up'],
  pickup: ['PickUp', 'pick-up'],
  throw: ['Throw', 'holding-right-shoot'],
  interact: ['Interact', 'interact-right', 'Use_Item'],
  crouch: ['crouch', 'Sit_Floor_Pose'],
  fall: ['fall', 'Jump_Idle'],
  dance: ['dance', 'Cheer', 'emote-yes'],
  eat: ['eat', 'PickUp'],
  'idle-combat': ['Idle_Combat', '2H_Melee_Idle', 'Idle'],
  'idle-2h': ['2H_Melee_Idle', 'Idle'],
  'strafe-left': ['Running_Strafe_Left'], 'strafe-right': ['Running_Strafe_Right'], 'walk-back': ['Walking_Backwards'],
};
const SYNONYMS = {
  rabbit: 'bunny', hare: 'bunny', kitten: 'cat', puppy: 'dog', wolf: 'dog', cattle: 'cow', bull: 'cow', hen: 'chick', chicken: 'chick', bird: 'parrot', elk: 'deer', bear: 'panda', ape: 'monkey', archer: 'rogue', ranger: 'rogue-hooded', priest: 'mage', necromancer: 'skeleton-mage', lich: 'skeleton-mage', bonfire: 'campfire-logs', lamp: 'lantern', coffin: 'coffin',
  goblin: 'orc', wizard: 'mage', sorcerer: 'mage', warrior: 'knight', soldier: 'knight', paladin: 'knight', thief: 'rogue', assassin: 'rogue-hooded',
  viking: 'barbarian', peasant: 'villager-male-a', villager: 'villager-male-a', farmer: 'villager-male-b', woman: 'villager-female-a', man: 'villager-male-a',
  skeleton: 'skeleton-warrior', undead: 'skeleton-minion', house: 'home-a-red', cottage: 'home-b-blue', home: 'home-a-blue', hut: 'home-b-green', castle: 'castle-blue',
  tower: 'tower-a-blue', oak: 'tree-oak', pine: 'tree-pine-tall-a', fir: 'tree-pine-tall-b', tree: 'tree-oak', bush: 'plant-bush', rock: 'rock-large-a', boulder: 'rock-large-b',
  bow: 'crossbow', gun: 'blaster-a', pistol: 'blaster-a', rifle: 'blaster-h', blaster: 'blaster-a', sword: 'sword', axe: 'axe', hammer: 'great-axe', mace: 'axe',
  fire: 'campfire-logs', campfire: 'campfire-logs', fireplace: 'campfire-logs', boat: 'boat-row-large', ship: 'ship-pirate-large', pig: 'pig', horse: 'deer',
  ghost: 'ghost', vampire: 'vampire', zombie: 'zombie', grave: 'grave', tomb: 'crypt', gravestone: 'gravestone', pumpkin: 'pumpkin-orange', chair: 'chair', table: 'table-medium',
};
// where a held item sits in the KayKit rig's hand slots (taken from the authored character files)
const HAND = {
  right: { bone: 'handslot.r', position: [0, 0.033, 0], quaternion: [0, -1, 0, 0] },
  left: { bone: 'handslot.l', position: [0, 0.017, 0], quaternion: [0, 0, 0, 1] },
};
const TOKEN_ALIAS = { house: 'home', cottage: 'home', hut: 'home', inn: 'tavern', pub: 'tavern', mill: 'windmill', big: 'large', huge: 'large', tiny: 'small', wooden: 'wood', skeletons: 'skeleton', trees: 'tree', rocks: 'rock', swords: 'sword', crates: 'crate', barrels: 'barrel', torches: 'torch' };
const BONE_ALIASES = { 'right-hand': ['handslot.r', 'arm-right'], 'left-hand': ['handslot.l', 'arm-left'], hand: ['handslot.r', 'arm-right'], head: ['head'], back: ['chest', 'torso'], chest: ['chest', 'torso'], torso: ['chest', 'torso'], hips: ['hips', 'torso', 'root'], 'right-arm': ['upperarm.r', 'arm-right'], 'left-arm': ['upperarm.l', 'arm-left'], 'right-foot': ['foot.r', 'leg-right'], 'left-foot': ['foot.l', 'leg-left'], root: ['root'] };

export default async function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Matrix4, Quaternion, Group, Mesh, Box3, Sphere, Color, MathUtils } = THREE;
  const S = ctx.state;
  S.cache ??= new Map();     // url -> entry (parsed glTF + shared GPU resources)
  S.sets ??= new Map();      // animation set id -> Promise<{ clips: Map }>
  S.textures ??= new Map();  // atlas key -> Promise<Texture>
  S.live ??= new Set();      // live handles (stepped by whichever version of this module is current)
  S.jobs ??= new Map();      // gen3d id -> job
  S.convByTier ??= {};       // tier -> Map(source material -> converted shared material)
  S.nextId ??= 1;
  S.frame ??= 0;
  const quality = () => ctx.quality ?? { tier: 'pc' };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  // ------------------------------------------------------------------ catalogue
  let catalog = S.catalog ?? null;
  async function loadCatalog() {
    try {
      const res = await fetch('/assets/catalog.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`catalog.json: HTTP ${res.status}`);
      catalog = await res.json();
      S.catalog = catalog;
    } catch (err) {
      console.error('[models] catalogue unavailable', err);
      catalog ??= { models: {}, animations: {}, packs: {}, error: String(err?.message ?? err) };
    }
    index = buildIndex();
  }
  let index = null;
  function buildIndex() {
    const names = Object.keys(catalog.models);
    const tokens = new Map();
    for (const n of names) {
      const m = catalog.models[n];
      tokens.set(n, new Set([...n.split('-'), ...(m.tags || []), m.category, m.pack.replace(/^(kaykit|kenney)-/, '')]));
    }
    return { names, tokens };
  }
  if (catalog) index = buildIndex(); else await loadCatalog();
  S.generated ??= null;

  const models = () => catalog.models;
  const has = (name) => !!models()[name];
  function info(name) {
    const m = models()[name];
    return m ? { name, ...m, clips: clipNamesOf(name) } : null;
  }
  function clipNamesOf(name) {
    const m = models()[name];
    return m ? [...(m.clips || [])] : [];
  }
  function list(q = {}) {
    let out = index.names;
    if (q.category) out = out.filter((n) => models()[n].category === q.category);
    if (q.pack) out = out.filter((n) => models()[n].pack === q.pack || models()[n].pack.endsWith(q.pack));
    if (q.tag) { const want = [].concat(q.tag).map((t) => String(t).toLowerCase()); out = out.filter((n) => want.every((t) => models()[n].tags.includes(t) || n.split('-').includes(t))); }
    if (q.rigged !== undefined) out = out.filter((n) => !!(models()[n].rigged || models()[n].animated) === !!q.rigged);
    if (q.search) { const s = kebab(q.search); out = out.filter((n) => n.includes(s) || models()[n].tags.some((t) => t.includes(s))); }
    return out.slice().sort();
  }
  function levenshtein(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 9;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  function find(query, opts = {}) {
    const q = kebab(query);
    if (!q) return opts.all ? [] : null;
    if (has(q) && !opts.all) return q;
    let qt = q.split('-').filter(Boolean);
    while (qt.length > 1 && /^(a|an|the|some|my|your|of)$/.test(qt[0])) qt = qt.slice(1); // leading articles
    const wsum = qt.reduce((s, _, i) => s + (i === qt.length - 1 ? 1.6 : 1), 0); // the head noun (last word) counts most
    const scored = [];
    for (const n of index.names) {
      let s = 0;
      if (n === q) s = 100;
      else if (SYNONYMS[q] === n) s = 95;
      else {
        if (n.startsWith(q)) s = 80;
        else if (n.includes(q)) s = 60;
        const toks = index.tokens.get(n);
        let hit = 0;
        qt.forEach((t0, qi) => {
          const w = qi === qt.length - 1 ? 1.6 : 1;
          const t = toks.has(t0) ? t0 : (TOKEN_ALIAS[t0] ?? t0);
          if (SYNONYMS[t0] === n) hit += 0.8 * w;
          if (toks.has(t)) hit += w; else if (SYNONYMS[t0] === n) hit += 0.4 * w; else for (const x of toks) if (x.length > 3 && (x.startsWith(t) || t.startsWith(x)) && Math.abs(x.length - t.length) < 3) { hit += 0.6 * w; break; }
        });
        s = Math.max(s, (hit / wsum) * 55);
        if (qt.length === 1 && s < 40) { const d = levenshtein(qt[0], n.split('-')[0]); if (d <= 2 && qt[0].length > 3) s = Math.max(s, 45 - d * 5); }
        if (s > 0) s -= Math.min(10, n.length * 0.15); // prefer shorter, plainer names
      }
      if (s >= 20) scored.push([s, n]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length);
    if (opts.all) return scored.slice(0, opts.limit ?? 8).map((x) => x[1]);
    if (!scored.length && SYNONYMS[q] && has(SYNONYMS[q])) return SYNONYMS[q];
    return scored.length ? scored[0][1] : null;
  }
  const resolveName = (name) => (has(name) ? name : find(name));

  // ------------------------------------------------------------------ sharing helpers
  function share(o) {
    if (!o.userData) o.userData = {};
    if (!o.userData._omnShared) { o.userData._omnShared = true; o.dispose = NOOP; }
    return o;
  }
  function freeGpu(o) { const p = Object.getPrototypeOf(o); if (p?.dispose) p.dispose.call(o); }

  function convertMaterial(src) {
    const tier = quality().tier;
    const conv = (S.convByTier[tier] ??= new Map());
    let m = conv.get(src);
    if (m) return m;
    const lambert = () => new THREE.MeshLambertMaterial({
      name: src.name, color: src.color.clone(), map: src.map ?? null, emissive: src.emissive ? src.emissive.clone() : new Color(0), emissiveMap: src.emissiveMap ?? null,
      emissiveIntensity: src.emissiveIntensity ?? 1, side: src.side, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest,
      alphaMap: src.alphaMap ?? null, vertexColors: src.vertexColors, flatShading: !!src.flatShading, depthWrite: src.depthWrite,
    });
    if (src.isMeshStandardMaterial) m = tier === 'quest' ? lambert() : src;
    else if (src.isMeshBasicMaterial) m = lambert();   // glTF "unlit" kits look flat; make them respond to the sun
    else m = src;
    share(m);
    conv.set(src, m);
    return m;
  }

  // GLTFLoader plugin: one Texture per atlas file for the whole game, however many GLBs reference it.
  function makeLoader() {
    const loader = new GLTFLoader();
    loader.register((parser) => ({
      name: 'OMN_shared_textures',
      loadTexture(idx) {
        const def = parser.json.textures?.[idx];
        const img = def && parser.json.images?.[def.source];
        if (!img || typeof img.uri !== 'string' || img.uri.startsWith('data:')) return null; // embedded images: default path
        const key = THREE.LoaderUtils.resolveURL(img.uri, parser.options.path) + '|' + JSON.stringify(parser.json.samplers?.[def.sampler] ?? null);
        let p = S.textures.get(key);
        if (!p) {
          p = parser.loadTextureImage(idx, def.source, parser.textureLoader).then((tex) => { if (tex) { share(tex); tex.userData.atlasKey = key; } return tex; });
          S.textures.set(key, p);
        }
        return p;
      },
    }));
    return loader;
  }
  const loader = makeLoader();

  // ------------------------------------------------------------------ cache entries
  function loadEntry(url, hint) {
    let e = S.cache.get(url);
    if (e) return e.promise;
    e = { url, refs: 0, idleSince: now(), status: 'loading', geoms: new Set(), mats: new Set(), texs: new Set(), hint };
    e.promise = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const gltf = await loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
      prepare(e, gltf);
      e.status = 'ready';
      return e;
    })().catch((err) => { e.status = 'error'; e.error = err; if (S.cache.get(url) === e) S.cache.delete(url); throw err; });
    S.cache.set(url, e);
    return e.promise;
  }

  function prepare(e, gltf) {
    const scene = gltf.scene;
    e.scene = scene;
    e.clips = gltf.animations || [];
    e.ownClips = new Map(e.clips.map((c) => [norm(c.name), c]));
    let skinned = false, equip = false, meshes = 0;
    scene.traverse((o) => {
      if (o.userData?.equip) { equip = true; o.visible = !!o.userData.default; }
      if (!o.isMesh) return;
      meshes++;
      if (o.isSkinnedMesh) skinned = true;
      share(o.geometry); e.geoms.add(o.geometry);
      const conv = [].concat(o.material).map((m) => convertMaterial(m));
      o.material = Array.isArray(o.material) ? conv : conv[0];
      for (const m of conv) {
        e.mats.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) { share(v); e.texs.add(v); }
      }
    });
    scene.updateMatrixWorld(true);
    scene.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
    const box = visibleBox(scene);
    e.box = box;
    e.size = box.getSize(new Vector3());
    e.skinned = skinned;
    e.kind = skinned ? 'skinned' : e.clips.length ? 'nodes' : 'static';
    e.hasEquip = equip;
    if (e.kind === 'static') buildParts(e);
    // frustum culling for skinned meshes: the bind-pose sphere is wrong once animated, use a generous fixed one
    const c = box.getCenter(new Vector3());
    e.cullSphere = new Sphere(c, Math.max(e.size.x, e.size.y, e.size.z) * 0.75 + 0.2);
  }

  // Box3.setFromObject ignores `visible`, so hidden equipment (spare weapons/shields) would inflate the bounds.
  function visibleBox(root) {
    const box = new Box3(), tmp = new Box3();
    (function walk(o) {
      if (o.visible === false) return;
      if (o.isMesh) { tmp.makeEmpty().expandByObject(o, true); box.union(tmp); }
      for (const c of o.children) walk(c);
    })(root);
    return box;
  }

  // Static models: merge every mesh into one geometry per material (1 draw call for most), transforms baked in.
  function buildParts(e) {
    const groups = new Map();
    e.scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.visible === false) return;
      let g = groups.get(o.material);
      if (!g) groups.set(o.material, (g = []));
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
      geo.clearGroups();
      g.push(geo);
    });
    e.parts = [];
    for (const [material, geos] of groups) {
      let geometry = null;
      try {
        geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      } catch { geometry = null; }
      if (geometry) { geometry.computeBoundingSphere(); geometry.computeBoundingBox(); share(geometry); e.geoms.add(geometry); e.parts.push({ geometry, material }); }
      else for (const geo of geos) { geo.computeBoundingSphere(); share(geo); e.geoms.add(geo); e.parts.push({ geometry: geo, material }); }
    }
  }

  // ------------------------------------------------------------------ shared animation sets
  function loadSet(id) {
    let p = S.sets.get(id);
    if (p) return p;
    const def = catalog.animations[id];
    if (!def) return Promise.resolve(null);
    p = (async () => {
      const res = await fetch(def.url);
      if (!res.ok) throw new Error(`${def.url}: HTTP ${res.status}`);
      const gltf = await loader.parseAsync(await res.arrayBuffer(), def.url.slice(0, def.url.lastIndexOf('/') + 1));
      return { id, clips: new Map(gltf.animations.map((c) => [norm(c.name), c])), names: gltf.animations.map((c) => c.name) };
    })().catch((err) => { S.sets.delete(id); console.error('[models] animation set failed', id, err); return null; });
    S.sets.set(id, p);
    return p;
  }
  function setProviding(entryInfo, clipName) {
    const n = norm(clipName);
    for (const id of entryInfo.animSets || []) if (catalog.animations[id]?.clips.some((c) => norm(c) === n)) return id;
    return null;
  }
  // best available clip NAME for a canonical alias (or a literal clip name) on a catalogue model
  function clipFor(name, alias) {
    const m = models()[name];
    if (!m) return null;
    return pickClip(m.clips || [], alias);
  }
  function pickClip(clipNames, alias) {
    const byNorm = new Map(clipNames.map((c) => [norm(c), c]));
    const direct = byNorm.get(norm(alias));
    if (direct) return direct;
    let cands = ALIASES[String(alias).toLowerCase()] ?? ALIASES[kebab(alias)];
    if (!cands) { // loose literal match: "walking a" -> Walking_A
      const q = norm(alias);
      for (const [k, v] of byNorm) if (k.includes(q) && q.length > 3) return v;
      return null;
    }
    for (const c of cands) {
      if (c[0] === '@') { const r = pickClip(clipNames, c.slice(1)); if (r) return r; continue; }
      const hit = byNorm.get(norm(c));
      if (hit) return hit;
    }
    return null;
  }

  // ------------------------------------------------------------------ small utilities
  function toVec(p, out = new Vector3()) {
    if (!p) return out.set(0, NaN, 0);
    if (Array.isArray(p)) return out.set(p[0] ?? 0, p[1] ?? NaN, p[2] ?? 0);
    return out.set(p.x ?? 0, p.y ?? NaN, p.z ?? 0);
  }
  function groundAtFor(callerCtx) { return callerCtx?.groundAt ?? ctx.groundAt ?? (() => 0); }
  function release(callerCtx, fn) { if (callerCtx?.onDispose) callerCtx.onDispose(fn); }
  function entryRef(e) { e.refs++; }
  function entryUnref(e) { if (--e.refs <= 0) { e.refs = 0; e.idleSince = now(); } }
  const sharedPlaceholder = (() => {
    S.ph ??= null;
    if (!S.ph) {
      const geometry = share(new THREE.OctahedronGeometry(0.5, 0));
      const material = share(new THREE.MeshBasicMaterial({ color: 0x9fb4ff, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false }));
      const broken = share(new THREE.MeshBasicMaterial({ color: 0xff3355, wireframe: true, transparent: true, opacity: 0.8 }));
      S.ph = { geometry, material, broken };
    }
    return S.ph;
  })();
  const newPlaceholder = (size, broken) => {
    const m = new Mesh(sharedPlaceholder.geometry, broken ? sharedPlaceholder.broken : sharedPlaceholder.material);
    m.scale.setScalar(size); m.position.y = size * 0.5; m.userData.noShadow = true; m.name = broken ? 'model-missing' : 'model-loading';
    return m;
  };

  // ================================================================== spawn
  let handleSerial = 0;
  function spawn(callerCtx, rawName, opts = {}) {
    const name = resolveName(rawName);
    const id = ++handleSerial;
    const object = new Group();
    object.name = `model:${name ?? rawName}`;
    const parent = opts.parent ?? callerCtx?.root ?? ctx.root;
    const pos = toVec(opts.position);
    if (Number.isNaN(pos.y)) pos.y = groundAtFor(callerCtx)(pos.x, pos.z) ?? 0;
    object.position.copy(pos);
    object.rotation.y = opts.yaw ?? 0;
    if (opts.scale !== undefined) object.scale.setScalar(opts.scale);
    parent.add(object);
    const entryInfo = name ? models()[name] : null;
    const placeholderSize = opts.height ?? (entryInfo ? Math.max(0.2, Math.min(3, (entryInfo.height ?? 1) * (entryInfo.scale ?? 1))) : 0.4);
    const placeholder = newPlaceholder(placeholderSize, !entryInfo);
    object.add(placeholder);

    const h = Object.create(HandleProto);
    Object.assign(h, {
      id, name, object, entry: entryInfo ? { name, ...entryInfo } : null, loaded: false, removed: false, error: null,
      position: object.position, root: null, model: null, mixer: null, height: 0, bones: {}, equipment: [],
      _entry: null, _actions: new Map(), _current: null, _acc: 0, _attached: [], _owned: [], _pending: [], _tintOf: null, _speed: 1, _ctx: callerCtx, fit: 1,
    });
    h.ready = (async () => {
      if (!entryInfo) {
        h.error = `unknown model "${rawName}"` + (rawName && index ? ` — try models.find("${rawName}") or models.list({search})` : '');
        console.warn('[models] ' + h.error);
        return h;
      }
      try {
        const e = await loadEntry(entryInfo.url, entryInfo);
        if (h.removed) return h;
        entryRef(e); h._entry = e;
        build(h, e, entryInfo, opts, callerCtx);
        if (entryInfo.animSets?.length) { const primary = await loadSet(entryInfo.animSets[0]); if (primary) h._sets = [primary]; }
        if (h.removed) return h;
        object.remove(placeholder);
        h.loaded = true;
        if (e.kind !== 'static') {
          S.live.add(h);
          const autoplay = opts.play === undefined ? 'idle' : opts.play;
          if (autoplay) h.play(autoplay, { fade: 0, sync: opts.sync });
          for (const p of h._pending.splice(0)) p();
        } else for (const p of h._pending.splice(0)) p();
      } catch (err) {
        h.error = String(err?.message ?? err);
        console.error('[models] spawn failed', name, err);
        placeholder.material = sharedPlaceholder.broken;
      }
      return h;
    })();
    release(callerCtx, () => h.remove());
    return h;
  }

  function build(h, e, info, opts, callerCtx) {
    let root;
    if (e.kind === 'static') {
      root = new Group();
      for (const p of e.parts) { const m = new Mesh(p.geometry, p.material); m.matrixAutoUpdate = false; root.add(m); }
    } else if (e.kind === 'skinned') {
      root = SkeletonUtils.clone(e.scene);
      root.traverse((o) => { if (o.isSkinnedMesh) { o.boundingSphere = e.cullSphere; o.frustumCulled = true; } });
    } else root = e.scene.clone(true);
    root.name = h.name;
    const wrap = new Group();
    wrap.name = 'fit';
    const natural = info.height || e.size.y || 1;
    let fit = info.scale ?? 1;
    if (opts.height) fit = opts.height / natural;
    wrap.scale.setScalar(fit);
    wrap.position.y = Math.max(0, -e.box.min.y) * fit;
    wrap.add(root);
    if (e.kind === 'static') { wrap.updateMatrix(); wrap.matrixAutoUpdate = false; }
    h.object.add(wrap);
    h.model = wrap; h.root = root; h.height = opts.height ?? e.size.y * fit; h.fit = fit;
    if (opts.castShadow !== undefined) root.traverse((o) => { if (o.isMesh) { if (opts.castShadow) { o.castShadow = true; o.receiveShadow = true; } else { o.userData.noShadow = true; o.castShadow = false; } } });
    // bones / named nodes
    const bones = {};
    root.traverse((o) => {
      if (o.isBone) { bones[o.name] = o; if (o.userData?.name) bones[o.userData.name] = o; }
    });
    h.bones = bones;
    // equipment
    const eq = [];
    root.traverse((o) => { if (o.userData?.equip) eq.push({ name: o.name, side: o.userData.equip, node: o }); });
    h._equipNodes = eq;
    h.equipment = eq.map((x) => ({ name: x.name, side: x.side, get visible() { return x.node.visible; } }));
    if (e.kind !== 'static' && (e.clips.length || e.kind === 'skinned')) { h.mixer = new THREE.AnimationMixer(root); h.mixer.addEventListener('finished', (ev) => h._onFinished(ev)); }
    h.own = e.ownClips;
    h.getClipNames = () => {
      const names = new Set(e.clips.map((c) => c.name));
      for (const s of h._sets || []) for (const n of s.names) names.add(n);
      for (const n of info.clips || []) names.add(n);
      return [...names];
    };
  }

  // generated creatures: the walk / run actions rescale whoever writes their time scale later (kit matches playback to ground speed); play() itself writes the raw value
  function rawTimeScale(action, v) { (action._rawTS ? action._rawTS : action.setEffectiveTimeScale.bind(action))(v); }
  function compensateGait(h, action, clip) {
    const e = h.entry;
    if (!e || !e.generated || !e.speeds) return;
    const alias = clip.name === 'walk' ? 'walk' : clip.name === 'run' ? 'run' : null;
    if (!alias || !e.speeds[alias]) return;
    const raw = action.setEffectiveTimeScale.bind(action), comp = gaitComp(e, alias);
    action._rawTS = raw;
    action.setEffectiveTimeScale = (v) => raw(v * (S.gaitCompensation === false ? 1 : comp));
  }

  // ---------------------------------------------------------------- handle methods (shared by all spawned models)
  const HandleProto = {
    get clips() { return this.getClipNames ? this.getClipNames() : []; },
    has(clip) { return !!this.clipFor(clip); },
    clipFor(alias) { return this.getClipNames ? pickClip(this.getClipNames(), alias) : null; },
    _findClip(clipName) {
      const n = norm(clipName);
      if (this.own?.has(n)) return this.own.get(n);
      for (const s of this._sets || []) if (s.clips.has(n)) return s.clips.get(n);
      return null;
    },
    play(clipOrAlias, o = {}) {
      if (this.removed) return null;
      if (!this.loaded) { this._pending.push(() => this.play(clipOrAlias, o)); return this.clipFor(clipOrAlias) ?? null; }
      if (!this.mixer) return null;
      const name = this.clipFor(clipOrAlias);
      if (!name) return null;
      let clip = this._findClip(name);
      if (!clip) { // lives in a shared set that has not been fetched yet
        const setId = setProviding(this.entry, name);
        if (!setId) return null;
        loadSet(setId).then((s) => { if (!s || this.removed) return; (this._sets ??= []).push(s); this.play(name, o); });
        return name;
      }
      const loop = o.loop ?? true, fade = o.fade ?? 0.2, speed = o.speed ?? 1;
      let action = this._actions.get(clip.name);
      if (!action) { action = this.mixer.clipAction(clip, this.root); this._actions.set(clip.name, action); compensateGait(this, action, clip); }
      const prev = this._current;
      if (prev === action && action.isRunning() && !o.once) { rawTimeScale(action, speed); return clip.name; }
      action.enabled = true;
      action.reset();
      rawTimeScale(action, speed);
      action.setEffectiveWeight(1);
      if (o.once || !loop) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; } else action.setLoop(THREE.LoopRepeat, Infinity);
      this._onceThen = o.once || !loop ? { then: o.then, onDone: o.onDone, action } : null;
      if (prev && prev !== action && fade > 0) { action.fadeIn(fade); prev.fadeOut(fade); } else if (prev && prev !== action) prev.stop();
      if (o.sync !== true && !o.once && clip.duration > 0 && !prev) action.time = Math.random() * clip.duration; // desync crowds
      action.play();
      this._current = action;
      this.currentClip = clip.name;
      this._speed = speed;
      return clip.name;
    },
    _onFinished(ev) {
      const t = this._onceThen;
      if (!t || ev.action !== t.action) return;
      this._onceThen = null;
      try { t.onDone?.(this); } catch (err) { console.error(err); }
      if (t.then && this._current === t.action) this.play(t.then, { fade: 0.15 });
    },
    stop(fade = 0.2) {
      if (this._current) { if (fade > 0) this._current.fadeOut(fade); else this._current.stop(); this._current = null; this.currentClip = null; }
    },
    setTint(color) {
      if (!this.loaded) { this._pending.push(() => this.setTint(color)); return; }
      const meshes = [];
      this.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
      if (color === null || color === undefined || color === false) {
        if (!this._tintOf) return;
        for (const o of meshes) { const orig = this._tintOf.get(o); if (orig) { const tm = o.material; o.material = orig; [].concat(tm).forEach((m) => m.dispose()); } }
        this._tintOf = null;
        return;
      }
      const c = new Color(color);
      this._tintOf ??= new Map();
      for (const o of meshes) {
        let orig = this._tintOf.get(o);
        if (!orig) { orig = o.material; this._tintOf.set(o, orig); o.material = Array.isArray(orig) ? orig.map((m) => { const k = m.clone(); k.userData._omnShared = false; k.userData.tint = true; return k; }) : (() => { const k = orig.clone(); k.userData._omnShared = false; return k; })(); }
        const base = Array.isArray(orig) ? orig : [orig];
        [].concat(o.material).forEach((m, i) => { m.color.copy(base[i].color).multiply(c); });
      }
    },
    equip(spec) {
      if (!this.loaded) { this._pending.push(() => this.equip(spec)); return; }
      if (typeof spec === 'string') spec = { [(this._equipNodes.find((x) => x.name === spec)?.side) ?? 'right']: spec };
      for (const side of ['right', 'left']) {
        if (!(side in spec)) continue;
        const want = spec[side];
        for (const x of this._equipNodes) if (x.side === side) x.node.visible = want !== null && norm(x.name) === norm(want);
      }
      return this.equipment;
    },
    // Parent an object (or another models handle) to a bone/node. Handles keep their recommended world size and sit with their
    // origin on the bone (weapons: origin = grip). Plain Object3Ds inherit this character's fit scale — size them accordingly.
    attach(item, boneName = 'right-hand', xf = {}) {
      const obj = item?.object ?? item;
      if (!obj) return null;
      if (!this.loaded) { this._pending.push(() => this.attach(item, boneName, xf)); return obj; }
      const bone = this._findBone(boneName);
      if (!bone) { console.warn('[models] no bone/node', boneName, 'on', this.name); return null; }
      bone.add(obj);
      if (item?.object && item.model !== undefined) {
        const fixup = () => { if (item.model) { item.model.position.set(0, 0, 0); item.model.scale.setScalar((item.fit || 1) / (this.fit || 1)); item.model.updateMatrix(); } };
        if (item.loaded) fixup(); else item.ready.then(fixup);
      }
      const p = xf.position; if (p) obj.position.set(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z);
      const r = xf.quaternion; if (r) obj.quaternion.set(r[0], r[1], r[2], r[3]); else if (xf.rotation) obj.rotation.set(xf.rotation[0] ?? xf.rotation.x, xf.rotation[1] ?? xf.rotation.y, xf.rotation[2] ?? xf.rotation.z);
      if (xf.scale !== undefined) obj.scale.setScalar(xf.scale);
      this._attached.push(obj);
      return obj;
    },
    hold(item, hand) {
      const nm = typeof item === 'string' ? resolveName(item) : item?.name;
      const hint = (nm && models()[nm]?.attach) || {};
      const spec = HAND[(hand ?? hint.hand) === 'left' ? 'left' : 'right'];
      let obj = item;
      if (typeof item === 'string') { obj = spawn(this._ctx ?? ctx, item, { parent: this.object }); this._owned.push(obj); }
      this.attach(obj, spec.bone, { position: [spec.position[0], spec.position[1], spec.position[2] + (hint.z ?? 0)], quaternion: spec.quaternion });
      return obj;
    },    _findBone(name) {
      const tries = BONE_ALIASES[name] ?? [name];
      for (const alias of [].concat(tries, name)) {
        const n = norm(alias);
        if (this.bones[alias]) return this.bones[alias];
        for (const k in this.bones) if (norm(k) === n) return this.bones[k];
        let found = null;
        this.root.traverse((o) => { if (!found && norm(o.name) === n) found = o; });
        if (found) return found;
      }
      return null;
    },    remove() {
      if (this.removed) return;
      this.removed = true;
      S.live.delete(this);
      try { this.mixer?.stopAllAction(); if (this.root) this.mixer?.uncacheRoot(this.root); } catch { /* already gone */ }
      this._actions.clear();
      if (this._tintOf) { for (const [o, orig] of this._tintOf) { const tm = o.material; o.material = orig; [].concat(tm).forEach((m) => m.dispose()); } this._tintOf = null; }
      if (this.root) this.root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
      for (const a of this._attached) a.removeFromParent();
      this._attached.length = 0;
      for (const o of this._owned.splice(0)) o.remove();
      this.object.removeFromParent();
      if (this._entry) { entryUnref(this._entry); this._entry = null; }
    },
    // ---- per-frame (called from the module update)
    tick(dt, head, fwd, frame) {
      const m = this.mixer;
      if (!m || !this._current) return;
      this._acc += dt;
      // H5 (docs/PERFORMANCE.md): no mixer for culled / hidden things (ancestors checked twice a second) or for a finished death
      if (frame >= (this._hideCheck ?? 0)) { this._hideCheck = frame + 30 + (this.id % 15); let hid = false; for (let p = this.object; p; p = p.parent) if (p.visible === false || p.userData?.perfCulled) { hid = true; break; } this._hidden = hid; }
      if (this._hidden) { if (this._acc > 0.5) this._acc = 0.5; return; }
      if ((this.dead || this.object.userData?.dead) && this._current.paused) { this._acc = 0; return; }
      const o = this.object.matrixWorld.elements;
      const dx = o[12] - head.x, dy = o[13] - head.y, dz = o[14] - head.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let stride = 1;
      if (d2 > 4) { // within 2 m: always full rate
        const d = Math.sqrt(d2);
        const inCone = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > 0.3;
        if (d > 100) stride = 12; else if (d > 40) stride = inCone ? 3 : 6; else if (!inCone) stride = 3;
        if (quality().tier === 'quest' && stride === 1 && d > 25) stride = 2;
      }
      const q = quality();
      if (q.animStride > 1) stride = Math.max(1, Math.round(stride * q.animStride));
      const cap = q.animCap ?? (q.tier === 'quest' ? 8 : 16);   // only the nearest `cap` characters animate at full rate; the rest at 1/3 and 1/6
      if (this._rank >= cap) stride = Math.max(stride, this._rank >= 2 * cap ? 6 : 3);
      if (stride === 1 || (frame + this.id) % stride === 0) { m.update(this._acc); this._acc = 0; }
    },
  };
  // ================================================================== instances
  function instances(callerCtx, rawName, spec = 0, opts = {}) {
    const name = resolveName(rawName);
    const info = name ? models()[name] : null;
    const object = new Group();
    object.name = `instances:${name ?? rawName}`;
    (opts.parent ?? callerCtx?.root ?? ctx.root).add(object);
    const list = typeof spec === 'number' ? null : [...spec];
    const count = list ? list.length : Math.max(0, spec | 0);
    const user = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) new Matrix4().toArray(user, i * 16);
    const h = { object, name, count, loaded: false, removed: false, error: null, dirty: true, meshes: [], _entry: null, _base: new Matrix4(), user, _tmp: new Matrix4(), _ctx: callerCtx };
    const groundAt = groundAtFor(callerCtx);
    const _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _e = new THREE.Euler();
    const compose = (t, out) => {
      if (t?.isMatrix4) return out.copy(t);
      if (Array.isArray(t) || t?.isVector3 || (t && 'x' in t && !('position' in t))) { toVec(t, _p); if (Number.isNaN(_p.y)) _p.y = groundAt(_p.x, _p.z); return out.compose(_p, _q.identity(), _s.set(1, 1, 1)); }
      toVec(t?.position, _p); if (Number.isNaN(_p.y)) _p.y = groundAt(_p.x, _p.z);
      if (t?.quaternion) _q.copy(t.quaternion); else if (t?.rotation) _q.setFromEuler(t.rotation.isEuler ? t.rotation : _e.set(t.rotation.x ?? 0, t.rotation.y ?? 0, t.rotation.z ?? 0)); else _q.setFromAxisAngle(new Vector3(0, 1, 0), t?.yaw ?? 0);
      const s = t?.scale; if (s && typeof s === 'object') _s.set(s.x ?? 1, s.y ?? 1, s.z ?? 1); else _s.setScalar(s ?? 1);
      return out.compose(_p, _q, _s);
    };
    h.setMatrixAt = (i, m) => { if (i < 0 || i >= count) return; m.toArray(user, i * 16); h.dirty = true; };
    h.setTransform = (i, t) => { h.setMatrixAt(i, compose(t, h._tmp)); };
    h.getMatrixAt = (i, out = new Matrix4()) => out.fromArray(user, i * 16);
    if (list) list.forEach((t, i) => compose(t, h._tmp).toArray(user, i * 16));
    h.ready = (async () => {
      if (!info) { h.error = `unknown model "${rawName}"`; console.warn('[models] ' + h.error); return h; }
      try {
        const e = await loadEntry(info.url, info);
        if (h.removed) return h;
        if (e.kind !== 'static') throw new Error(`${name} is animated/rigged; instances() is for static models (use spawn)`);
        entryRef(e); h._entry = e;
        let fit = info.scale ?? 1;
        if (opts.height) fit = opts.height / (info.height || e.size.y || 1);
        const lift = Math.max(0, -e.box.min.y) * fit;
        h._base.makeScale(fit, fit, fit); h._base.setPosition(0, lift, 0);
        for (const p of e.parts) {
          const mesh = new THREE.InstancedMesh(p.geometry, p.material, count);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.matrixAutoUpdate = false;
          if (opts.castShadow === false) mesh.userData.noShadow = true; else if (opts.castShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
          mesh.name = `${name}`;
          object.add(mesh); h.meshes.push(mesh);
        }
        h.loaded = true; h.dirty = true;
        S.instSets ??= new Set(); S.instSets.add(h);
        flush(h);
      } catch (err) { h.error = String(err?.message ?? err); console.error('[models] instances failed', name, err); }
      return h;
    })();
    h.remove = () => {
      if (h.removed) return;
      h.removed = true; S.instSets?.delete(h);
      for (const m of h.meshes) m.dispose();
      object.removeFromParent();
      if (h._entry) { entryUnref(h._entry); h._entry = null; }
    };
    release(callerCtx, () => h.remove());
    return h;
  }
  function flush(h) {
    if (!h.dirty || !h.loaded) return;
    h.dirty = false;
    const tmp = h._tmp;
    for (const mesh of h.meshes) {
      for (let i = 0; i < h.count; i++) { tmp.fromArray(h.user, i * 16).multiply(h._base); mesh.setMatrixAt(i, tmp); }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null; mesh.boundingBox = null; // re-derived lazily by the frustum test
    }
  }

  // ================================================================== preload
  async function preload(names) {
    const out = [];
    await Promise.all([].concat(names).map(async (n) => {
      const name = resolveName(n);
      if (!name) return;
      const info = models()[name];
      try {
        await loadEntry(info.url, info);
        if (info.animSets?.[0]) await loadSet(info.animSets[0]);
        out.push(name);
      } catch (err) { console.error('[models] preload failed', name, err); }
    }));
    return out;
  }

  // ================================================================== generate (server-woven models)
  async function generatedIndex(force, register = false) {
    if (S.generated && !force && now() - S.generated.at < 5) return S.generated.data;
    try {
      const res = await fetch('/assets/generated/index.json', { cache: 'no-store' });
      const data = res.ok ? await res.json() : {};
      S.generated = { at: now(), data };
      if (register) registerAllGenerated(data);   // rigged cache entries join the catalogue only when asked for (animate: true / refreshGenerated), never silently
      return data;
    } catch { S.generated = { at: now(), data: {} }; return {}; }
  }
  const STATE_COLOR = { queued: 0x7aa7ff, imagining: 0xb07cff, sculpting: 0xffc060, done: 0xffffff, error: 0xff3355 };
  const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

  // Rigged generated models (index.json entries with rigged: true) become ordinary catalogue entries: spawn(ctx, name), find(), list({ rigged: true }),
  // info(name) and kit.actor(ctx, { model: name }) work on them like on the KayKit characters. Name = the cache slug.
  const REC_LONGEST = { quadruped: 1.6, multileg: 1.3, winged: 1.6, serpent: 2.2, floating: 0.9, blob: 0.9, vehicle: 2.2, plant: 1.5 };
  function registerGenerated(slug, e) {
    if (!e || !e.rigged || !(e.rigged_url || e.url) || !catalog) return null;
    const name = kebab(slug);
    const size = Array.isArray(e.size) && e.size.length === 3 ? e.size : [1, e.height ?? 1, 1];
    const longest = Math.max(size[0], size[1], size[2]) || 1;
    const humanoid = !!e.humanoid;
    const words = String(e.prompt ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    catalog.models[name] = {
      url: e.rigged_url ?? e.url, category: humanoid ? 'character' : 'animal', pack: 'generated', tags: ['generated', 'rigged', e.bodyPlan, ...words],
      height: size[1], size, min: [-size[0] / 2, 0, -size[2] / 2], max: [size[0] / 2, size[1], size[2] / 2],
      scale: humanoid ? 1.8 / size[1] : (REC_LONGEST[e.bodyPlan] ?? 1.2) / longest,
      rigged: true, bones: e.bones, clips: e.clips ?? [], rig: null, generated: true, prompt: e.prompt, bodyPlan: e.bodyPlan, humanoid,
      speeds: e.speeds ?? {}, headBone: e.headBone, mouthBone: e.mouthBone, mouth: e.mouth, counts: e.counts, limbs: e.limbs, events: e.events, facing: e.facing ?? '+z',
    };
    index = buildIndex();
    return name;
  }
  function registerAllGenerated(data) { for (const [slug, e] of Object.entries(data ?? {})) if (e?.rigged && !models()[kebab(slug)]) registerGenerated(slug, e); }
  // (no load-time registration: call M.refreshGenerated() to make cached rigged creatures spawnable by name)

  // kit's walk/run playback matches clip speed to ground speed with its own constants (creature rig: 0.9 / 2.1 body lengths per second, generic humanoid: 0.6 / 1.5
  // body heights). The baked clips know their real ground speed (info.speeds), so kit's timeScale writes are rescaled to make feet stick (see compensateGait).
  // Turn off with models.gaitCompensation = false (e.g. once kit reads info.speeds itself).
  function gaitComp(info, alias) {
    const sp = info.speeds?.[alias];
    if (!sp) return 1;
    const horiz = Math.max(info.size[0], info.size[2]) || 1;
    return info.category === 'animal' ? ((alias === 'run' ? 2.1 : 0.9) * horiz) / sp : ((alias === 'run' ? 1.5 : 0.6) * info.height) / sp;
  }
  S.gaitCompensation ??= true;

  function generate(callerCtx, prompt, opts = {}) {
    const size = opts.size ?? 1;
    const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const object = new Group();
    object.name = `generated:${opts.name ?? prompt}`;
    const parent = opts.parent ?? callerCtx?.root ?? ctx.root;
    const pos = toVec(opts.position);
    if (Number.isNaN(pos.y)) pos.y = groundAtFor(callerCtx)(pos.x, pos.z) ?? 0;
    object.position.copy(pos);
    object.rotation.y = opts.yaw ?? 0;
    parent.add(object);

    // "being woven" effect: rotating wireframe polyhedron + rising motes
    const fx = new Group(); fx.name = 'weaving'; object.add(fx);
    const wireMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR.queued, wireframe: true, transparent: true, opacity: 0.8, depthWrite: false });
    const poly = new Mesh(S.polyGeo ??= share(new THREE.IcosahedronGeometry(0.5, 1)), wireMat);
    poly.scale.setScalar(size); poly.position.y = size * 0.6; poly.userData.noShadow = true; fx.add(poly);
    const N = 36;
    const mp = new Float32Array(N * 3), seeds = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { seeds[i * 3] = Math.random() * 6.283; seeds[i * 3 + 1] = Math.random(); seeds[i * 3 + 2] = 0.4 + Math.random() * 0.6; }
    const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const moteMat = new THREE.PointsMaterial({ color: STATE_COLOR.queued, size: Math.max(0.02, size * 0.035), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const motes = new THREE.Points(moteGeo, moteMat); motes.frustumCulled = false; motes.userData.noShadow = true; fx.add(motes);

    // animated models: the handle forwards to a regular spawn() handle (g.h) once the rigged model is in
    const fwd = (k) => function (...a) { return g.h ? g.h[k](...a) : (k === 'play' ? null : undefined); };
    const g = {
      id, object, state: 'queued', prompt, name: opts.name ?? null, modelName: null, error: null, model: null, h: null, removed: false, loaded: false, rigged: false, alive: false, size,
      actor: null, fighter: null, info: null,
      position: object.position, _t: 0, _pop: -1, _fx: { fx, poly, motes, moteGeo, moteMat, wireMat, mp, seeds, N }, _ctx: callerCtx, _entry: null, _timeout: null, _done: null,
      ready: null,
      get clips() { return g.h ? g.h.clips : (g._clipNames ?? []); },
      get bones() { return g.h ? g.h.bones : {}; },
      get mixer() { return g.h ? g.h.mixer : g._mixer ?? null; },
      set mixer(m) { g._mixer = m; },
      play: fwd('play'), stop: fwd('stop'), clipFor: fwd('clipFor'), has: fwd('has'), attach: fwd('attach'), hold: fwd('hold'), setTint: fwd('setTint'),
      remove() {
        if (g.removed) return;
        g.removed = true; S.jobs.delete(id); S.gens?.delete(g); clearTimeout(g._timeout);
        wireMat.dispose(); moteMat.dispose(); moteGeo.dispose();
        try { g.fighter?.remove?.(); } catch { /* gone */ }
        try { g.actor?.remove?.(); } catch { /* gone */ }
        try { g.h?.remove(); } catch { /* gone */ }
        object.removeFromParent();
        if (g._entry) { entryUnref(g._entry); g._entry = null; }
      },
    };
    S.gens ??= new Set(); S.gens.add(g);
    const setState = (st, message) => {
      g.state = st; g.message = message ?? null;
      const col = STATE_COLOR[st] ?? STATE_COLOR.queued;
      wireMat.color.setHex(col); moteMat.color.setHex(col);
      callerCtx?.events?.emit?.('models:gen3d', { id, state: st, prompt, message: g.message });
    };
    g.ready = new Promise((resolve) => { g._done = resolve; });
    const fail = (message) => {
      if (g.removed || g.state === 'error') return;
      g.error = message; setState('error', message);
      clearTimeout(g._timeout); S.jobs.delete(id);
      // broken crystal marker
      fx.removeFromParent();
      const mk = new Group(); mk.name = 'broken-crystal';
      const shardMat = share(S.shardMat ??= new THREE.MeshLambertMaterial({ color: 0x5b1a2c, emissive: 0x330814, flatShading: true }));
      const a = new Mesh(S.shardGeo ??= share(new THREE.ConeGeometry(0.5, 1.4, 5)), shardMat); a.scale.setScalar(size * 0.12); a.position.y = size * 0.08; a.rotation.z = 0.5; a.userData.noShadow = true;
      const b = new Mesh(S.shardGeo, shardMat); b.scale.set(size * 0.08, size * 0.06, size * 0.08); b.position.set(size * 0.14, size * 0.04, 0); b.rotation.z = -1.3; b.userData.noShadow = true;
      mk.add(a, b); object.add(mk);
      try { (callerCtx?.hud ?? ctx.hud)?.show(`Could not weave "${prompt}"${message ? ': ' + message : ''}`, 6); } catch { /* hud missing */ }
      g._done(g);
    };
    // rigged model: spawn it like a catalogue character (clips, mixer, bones, aliases), optionally as a wandering kit actor
    const finishRigged = async (idxEntry, slug) => {
      const name = registerGenerated(slug, idxEntry);
      if (!name) throw new Error('rigged model could not be registered');
      const info0 = models()[name];
      const longest = Math.max(...info0.size) || 1;
      g.modelName = name; g.rigged = true; g.info = info(name);
      const kit = callerCtx?.world?.kit ?? ctx.world?.kit;
      if (opts.alive && kit?.actor) {
        // size = largest side in metres; creatures are sized by body length, people by height
        const horiz = Math.max(info0.size[0], info0.size[2]) || 1;
        const actor = kit.actor(callerCtx, defined({
          model: name, ...(info0.category === 'animal' ? { size: size * horiz / longest } : { height: size * info0.size[1] / longest }),
          x: object.position.x, z: object.position.z, yaw: object.rotation.y, name: opts.name, hp: opts.hp, speed: opts.speed, faction: opts.faction, ...(opts.actorOptions ?? {}),
        }));
        g.actor = actor;
        const combat = callerCtx?.world?.combat ?? ctx.world?.combat;
        if (combat?.fighter && (opts.faction || opts.fighter || opts.behaviour || opts.behavior)) {
          try { g.fighter = combat.fighter(callerCtx, actor, defined({ faction: opts.faction, ...(opts.fighter ?? {}), ...(opts.behaviour ?? opts.behavior ?? {}) })); } catch (err) { console.warn('[models] combat.fighter failed', err); }
        }
        try { actor.wander?.(opts.wander ?? 5, object.position); } catch { /* no wander */ }
        fx.removeFromParent(); g.model = actor.group; g.loaded = true; g.alive = true;
        setState('done'); g._done(g);
        return;
      }
      const h = spawn(callerCtx, name, { parent: object, position: [0, 0, 0], height: size * info0.size[1] / longest, play: opts.play, castShadow: opts.castShadow });
      g.h = h;
      await h.ready;
      if (g.removed) return;
      if (h.error) throw new Error(h.error);
      h.object.position.set(0, 0, 0);
      g.model = h.object; g.loaded = true;
      fx.removeFromParent();
      h.object.scale.setScalar(0.001); g._pop = 0; g._popTarget = 1;
      setState('done'); g._done(g);
    };
    const finish = async (url, idxEntry, slug) => {
      try {
        if (idxEntry?.rigged && slug) return await finishRigged(idxEntry, slug);
        const e = await loadEntry(url, { url, pack: 'generated' });
        if (g.removed) return;
        entryRef(e); g._entry = e;
        const root = e.kind === 'skinned' ? SkeletonUtils.clone(e.scene) : e.kind === 'static' && e.parts?.length ? (() => { const r = new Group(); for (const p of e.parts) { const m = new Mesh(p.geometry, p.material); r.add(m); } return r; })() : e.scene.clone(true);
        const wrap = new Group(); wrap.name = 'fit';
        const longest = Math.max(e.size.x, e.size.y, e.size.z) || 1;
        const s = size / longest;
        wrap.scale.setScalar(s);
        const c = e.box.getCenter(new Vector3());
        root.position.set(-c.x, -e.box.min.y, -c.z); // centred on x/z, standing on the ground
        wrap.add(root);
        if (opts.castShadow !== undefined) wrap.traverse((o) => { if (o.isMesh) { o.castShadow = !!opts.castShadow; o.receiveShadow = !!opts.castShadow; if (!opts.castShadow) o.userData.noShadow = true; } });
        g.model = wrap; g.loaded = true;
        object.add(wrap); fx.removeFromParent();
        wrap.scale.setScalar(0.001); g._pop = 0; g._popTarget = s;
        setState('done');
        if (e.clips?.length) { g._clipNames = e.clips.map((c) => c.name); g.mixer = new THREE.AnimationMixer(root); const act = g.mixer.clipAction(e.clips[0]); act.play(); S.liveGens ??= new Set(); S.liveGens.add(g); }
        g._done(g);
      } catch (err) { fail(String(err?.message ?? err)); }
    };
    const slugOf = (url) => String(url ?? '').replace(/^.*\//, '').replace(/\.rigged\.glb$/, '').replace(/\.glb$/, '');
    const job = {
      onStatus(msg) {
        if (g.removed) return;
        if (msg.state === 'done') {
          if (!msg.url) return fail('server finished without a model');
          const slug = slugOf(msg.url);
          if (msg.rigged) generatedIndex(true, true).then((idx) => finish(msg.url, idx[slug], slug)); else finish(msg.url);
        } else if (msg.state === 'error') fail(msg.message || 'generation failed');
        else if (msg.state) setState(msg.state, msg.message);
      },
    };
    S.jobs.set(id, job);
    g._timeout = setTimeout(() => fail('timed out'), (opts.timeout ?? (opts.animate === false ? 360 : 480)) * 1000);
    release(callerCtx, () => g.remove());

    (async () => {
      const slug = kebab(opts.name ?? prompt);
      const wantAnimate = opts.animate === true;   // rigging is opt-in (server side too): only an explicit animate: true asks for it
      const idx = await generatedIndex(true, wantAnimate);
      const want = String(prompt).trim().toLowerCase();
      const hitKey = idx[slug] ? slug : Object.keys(idx).find((k) => String(idx[k].prompt ?? '').trim().toLowerCase() === want);
      const hit = hitKey ? idx[hitKey] : null;
      // a cached static model is used as is unless animation was asked for explicitly (then the server rigs the existing mesh)
      if (hit?.url && !(wantAnimate && !hit.rigged && !hit.rigTried)) {
        setState('sculpting');
        const useRig = wantAnimate && hit.rigged;   // a rigged cache entry also keeps its static twin: that one is served unless animation was asked for
        return finish(useRig ? (hit.rigged_url ?? hit.url) : hit.url, useRig ? hit : null, hitKey);
      }
      const net = callerCtx?.net ?? ctx.net;
      if (!net?.send) return fail('no connection to the server');
      net.send({ type: 'gen3d', id, prompt, options: { size, name: opts.name, ...(opts.options ?? {}), animate: wantAnimate } });
    })().catch((err) => fail(String(err?.message ?? err)));
    return g;
  }
  ctx.on('net:gen3d_status', (msg) => { const j = S.jobs.get(msg?.id); if (j) j.onStatus(msg); });

  // ================================================================== frame update
  let lastTrim = 0;
  const _fwd = new Vector3(0, 0, -1), _head = new Vector3();
  function update(dt, t) {
    const frame = ++S.frame;
    const head = ctx.player?.head ?? _head, fwd = ctx.player?.forward ?? _fwd;
    if (frame % 8 === 0 && S.live.size) { // distance rank of the live characters (H5 animation cap)
      const arr = [];
      for (const h of S.live) { const e = h.object.matrixWorld.elements; arr.push([(e[12] - head.x) ** 2 + (e[13] - head.y) ** 2 + (e[14] - head.z) ** 2, h]); }
      arr.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < arr.length; i++) arr[i][1]._rank = i;
    }
    for (const h of S.live) { try { h.tick(dt, head, fwd, frame); } catch (err) { S.live.delete(h); console.error('[models] animation failed for', h.name, err); } }
    if (S.instSets) for (const h of S.instSets) flush(h);
    if (S.liveGens) for (const g of S.liveGens) { if (g.removed) S.liveGens.delete(g); else g.mixer?.update(dt); }
    if (S.gens) for (const g of S.gens) {
      g._t += dt;
      const f = g._fx;
      if (g._pop >= 0) {
        g._pop += dt / 0.45;
        const p = Math.min(1, g._pop), k = 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2); // back-out ease
        g.model.scale.setScalar(Math.max(0.001, g._popTarget * k));
        if (p >= 1) g._pop = -1;
      }
      if (g.state === 'done' || g.state === 'error' || !f.fx.parent) continue;
      const spin = g.state === 'sculpting' ? 2.2 : g.state === 'imagining' ? 1.2 : 0.6;
      f.poly.rotation.y += dt * spin; f.poly.rotation.x += dt * spin * 0.37;
      f.poly.scale.setScalar(g.size * (1 + Math.sin(g._t * 3) * 0.04));
      for (let i = 0; i < f.N; i++) {
        const ph = (f.seeds[i * 3 + 1] + g._t * 0.25 * f.seeds[i * 3 + 2]) % 1;
        const a = f.seeds[i * 3] + g._t * 0.8;
        const r = g.size * 0.55 * (1 - ph * 0.5);
        f.mp[i * 3] = Math.cos(a) * r; f.mp[i * 3 + 1] = ph * g.size * 1.3; f.mp[i * 3 + 2] = Math.sin(a) * r;
      }
      f.moteGeo.attributes.position.needsUpdate = true;
    }
    if (t - lastTrim > 5) { lastTrim = t; trim(); }
  }

  // release GPU memory of idle cache entries (three re-uploads on demand)
  function trim() {
    const tnow = now();
    const keepTex = new Set();
    for (const e of S.cache.values()) if (e.refs > 0 || e.status === 'loading') for (const tx of e.texs ?? []) keepTex.add(tx);
    for (const e of S.cache.values()) {
      if (e.status !== 'ready' || e.refs > 0 || e.gpuFree || tnow - e.idleSince < IDLE_FREE) continue;
      e.gpuFree = true;
      for (const g of e.geoms) freeGpu(g);
      for (const m of e.mats) freeGpu(m);
      for (const tx of e.texs) if (!keepTex.has(tx)) freeGpu(tx);
    }
    for (const e of S.cache.values()) if (e.refs > 0 && e.gpuFree) e.gpuFree = false;
  }

  function stats() {
    let entries = 0, refs = 0, gpuFree = 0;
    for (const e of S.cache.values()) { entries++; refs += e.refs; if (e.gpuFree) gpuFree++; }
    let mixers = 0; for (const h of S.live) if (h.mixer) mixers++;
    return { models: Object.keys(models()).length, cached: entries, instancesLive: refs, animated: S.live.size, mixers, gpuReleased: gpuFree, textures: S.textures.size, animSets: S.sets.size, generating: S.jobs.size };
  }
  const categories = () => { const o = {}; for (const n of index.names) o[models()[n].category] = (o[models()[n].category] || 0) + 1; return o; };
  const tags = () => { const o = {}; for (const n of index.names) for (const t of models()[n].tags) o[t] = (o[t] || 0) + 1; return o; };

  // the instance-method table is applied in spawn() through this wrapper so getters (like `clips`) stay live
  ctx.provide('models', {
    catalog, list, has, info, find, preload, spawn, instances, generate, clipFor, categories, tags, stats, registerGenerated, refreshGenerated: () => generatedIndex(true, true),
    get gaitCompensation() { return S.gaitCompensation !== false; }, set gaitCompensation(v) { S.gaitCompensation = !!v; },
    aliases: Object.keys(ALIASES), loaded: true,
    get quality() { return quality().tier; },
  });
  return { update, dispose() { /* handles, cache and jobs live in ctx.state and survive reloads */ } };
}

