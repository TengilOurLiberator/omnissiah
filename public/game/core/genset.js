// core/genset.js — world.gen: the HAND-PAINTED MODEL SET (365 reviewed models, ids sz-* lg-* x-*). Inert until used (nothing is fetched at load).
// RULE  props, scenery, buildings, plants, rocks, ruins, furniture, loot, statues -> use world.gen FIRST (hand-painted, looks best). Fall back to world.models only for ANIMATED
//   characters/creatures and things not in this set; world.models.generate only for brand-new objects. Never build a prop from boxes when an id fits.
// FIND  await world.gen.ready() once before find/list/info/groups (spawn and scatter work at once).   find('mossy boulder') -> best id | null;  find(q, { all: true }) -> ranked ids;
//   list({ group, tag, search, hero, tier }) -> ids;  groups() -> [{ group, count }];  info(id) -> { id, name, group, tags, size_m, box:{x,y,z}, ground, tier:'all'|'pc', solid, alt?, note? }
// SPAWN const h = world.gen.spawn(ctx, id | 'a mossy boulder', { x, z, yaw, size, height, y, solid, parent })   // YOUR ctx first. A query picks the best match; no match -> h.error
//   Natural size is built in (info.size_m = longest side in metres: trees 4-8, cottage ~5, barrel ~1): omit size, or pass size (longest side) or height (metres tall). position: Vector3 | [x,y,z] also works.
//   It sits on the ground (ground:false items - boats, jetty, bridge, reeds - float at the lake level over water; pass y to override). yaw 0 = the front faces +Z (the spawn point if placed at -z).
//   solid (default info.solid, but only without parent): the player collides with a static box (trees: trunk only; arches, gates, stairs, bridges, plants and handheld items are walk-through).
//   h = { id, info, object (Group, placed NOW, the mesh appears when loaded), ready (Promise, never rejects: check h.error), loaded, size, skipped, substituted, remove() }
//   ^ ids below are PC tier only: on Quest spawn swaps in info.alt (h.substituted = wanted id) or skips (h.skipped = 'pc-only').
// SCATTER f = world.gen.scatter(ctx, id, [{ x, z, yaw, size }, ...]) -> instanced, ONE draw per material: use it for any repeat (> 3 of an id). Quest: <= ~14 unique ids in view, <= 30k tris of props.
//   They are already lit softly and warmly: never tint, outline or toon-shade them. Static (no animation). Moving h.object later does not move its collider.
// CATALOG-BEGIN
// ids are PREFIX-name: sz- lg- x- ; a-{b,c} means a-b and a-c ; ^ = PC tier only (Quest: alt or skipped). Groups:
// stones: sz-{pillar-broken-{a,b},ruined-archway,runestone-{leaning,tall}} lg-{circle-altar,dolmen^,standing-circle-stone}
// camp: sz-{barrel,bedroll,campfire-logbench,cooking-pot,crate-stack,lantern-post,supply-cart,tent,woodpile} lg-{bone-fence,campfire-ring,enemy-tent-{large^,small},gallows,goblin-{hut,totem^},imp-shrine,torture-rack,war-drum,weapon-pile,wooden-cage}
// nature: sz-{berry-bush,boulder-{a,b^,c},bush,fallen-log,flower-patch^,grass-tuft,mushroom-ring^,stump,tree-{birch,dead,oak,pine}} lg-{apple-tree,crystal-cave-mouth,giant-mushroom^,rock-formation-big,sunflower-patch,waterfall-rock,willow-tree} x-{plant-{fern-big,giant-flower^,lavender,tall-reeds,thornbush,vine-arch},rock-{crystal-vein,mossy-cluster,pile,slab,spire},tree-{autumn,birch-cluster,cherry-blossom,fallen-hollow,glowing,oak-{big,young},palm-pair,pine-tall,twisted}}
// shrine: sz-{offering-pedestal,pilgrim-statue,shrine-altar}
// lake: sz-{fishing-rack,jetty,reed-clump,rowing-boat}
// guide: sz-{notice-board,signpost,waystone}
// training: sz-{archery-target,armour-stand,potion-table,spell-lectern,straw-dummy,weapon-rack}
// clockwork: sz-{astrolabe,automaton-broken,bell-frame,brass-obelisk,gear-buried,orrery,pipe-wreck} lg-{brass-lamp-post,clockwork-{altar,cathedral-arch^,chandelier,door,guard,pew,pillar,stairs},gear-{bridge,stack,tower},giant-clock-face,machine-heart^,pendulum,pipe-organ,steam-{boiler,pipe-elbow},tesla-coil}
// landmark: sz-{banner-pole,brazier,bridge,cairn,chime-totem,drystone-wall,gate-posts,stairs,stone-well} lg-{crossroads-shrine,lake-obelisk,road-milestone,signal-beacon,toll-{booth,bridge},wooden-bridge-long}
// crypt: lg-{bone-pile,crypt-door,dead-tree-gnarled,gravestone-{a,b},graveyard-{cairn,gate^},iron-fence,mausoleum,sarcophagus,wraith-gravestone}
// village: lg-{bakery-oven,chicken-coop,dog-house,farm-{barn,plough},feast-table,garden-bed,hay-bale^,haystack,market-stall-{cloth,meat,pots},merchant-wagon,mill-sacks,pet-bed,pumpkin-patch,scarecrow,stable^,village-{cottage-{a,b},fountain,gate,inn,longhouse,well},watermill,windmill,wooden-fence}
// loot: lg-{banquet-roast,blacksmith-hammer,crystal-orb,dog-bowl-bone,dungeon-chest,ember-{bundle,staff},first-candle,gem-cluster,giant-cake,gold-pile^,golden-{goblet,key},loot-sack,magic-shield,pell-lamp,potion-blue^,regent-crown,relic-casket,scroll-stack,silver-sword-display,spellbook,treasure-chest-{gold,ornate},troll-club,war-{helmet,horn}}
// lair: lg-{ogre-chair,troll-{cave-mouth,pot}}
// boss: lg-{bone-arch,draft-sun-altar,ending-altar-pair,ghost-lantern,hollow-banner,knight-{statue-empty,throne},moon-{altar,crater-rock,ruin-column},necromancer-{altar^,circle,tower},phylactery,quiet-sun-altar,regent-throne,throne-dais}
// ruin: lg-{ancient-{gate,ruin-arch},broken-sun-statue,crystal-spire,fallen-colossus-head^,floating-island-rock^,giant-{gear-ruin,hand-statue^},ruined-{amphitheatre,bridge,fountain,hall-wall,temple-front,tower}}
// fortress: lg-{ballista,cannon,cannonballs,castle-{corner-tower,wall},catapult,drawbridge,keep,portcullis,siege-tower,spike-barricade,watchtower-wood,wooden-palisade}
// dungeon: lg-{alchemy-table,bookshelf,chains-wall,coffin,dungeon-{cell,door,spikes,stairs^,table},skull-pile^,stone-pillar-hall,torch-wall,trapdoor}
// swamp: lg-{giant-lilypad,mire-boat,swamp-{boardwalk,cauldron,dead-stump,gate,hut,lantern,mushroom,reeds,rock,skull-stake,tree}}
// ritual: lg-{brazier-stand,eclipse-monolith,three-braziers}
// forge: lg-{bellows,crane,forge-{anvil,furnace},gear-press,grindstone,mine-entrance^,ore-cart,quench-barrel^,sawmill,tool-rack,workshop-bench}
// harbour: lg-{anchor,fish-crate,fishing-boat^,harbour-{crane,dock,tavern-sign,warehouse},lighthouse,mooring-post,net-pile^,sailing-ship,sea-cave-rock,ship-wreck^,small-sailboat}
// desert: lg-{ancient-sphinx,cactus-{barrel,tall},dead-desert-tree,desert-{boulder,mesa,obelisk,pillar,rock-arch^,skull,tent},oasis-palm,sand-dune-rock}
// snow: lg-{frost-obelisk,frozen-waterfall,ice-{crystal-cluster,pillar,throne},snow-{boulder,cabin,dead-tree,drift,pine,sled},snowman}
// volcanic: lg-{ash-tree^,demon-statue,ember-plant,fire-brazier-big^,lava-{bridge,crystal,pool-rim},obsidian-spire,volcanic-rock,volcano-cone}
// arena: lg-{boss-arena-{bleachers,brazier,floor,gate,pillar,rubble,rune-stone,spikes}}
// mount: lg-{airship,chariot,handcart,hot-air-balloon,mech-walker,rowboat-small,saddle-{horse-statue,stand},stagecoach^}
// statue: x-{statue-{dragon-head^,giant-spider^,goblin,owl,skeleton-knight,stag,troll^,wolf},trophy-{boar-head,dragon-skull}}
// modular: x-{floor-{stone-tile,wood-planks},wall-{ruined-brick,stone-{corner,straight},wood-plank}}
// CATALOG-END

import { gen as G } from '/game/lib/gen.js';

export const meta = { name: 'Generated set', description: 'The reviewed hand-painted model library: find/list/spawn/scatter props, buildings, plants, ruins (world.gen).' };

const INDEX_URL = '/assets/generated/startzone/index.json';
const STOP = new Set('a an the of on in with and or its it to from for at by into onto very some few that this are is has have some make me please put place add near next big small'.split(' '));
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

export default function (ctx) {
  const THREE = ctx.THREE;
  const S = ctx.state;
  let disposed = false;
  const warn = (...a) => { try { console.warn('[gen]', ...a); } catch { /* console missing */ } };

  // ------------------------------------------------------------------ index (lazy, cached across hot reloads in ctx.state)
  function build(j) {
    const items = Array.isArray(j) ? j : (j && j.items) || [];
    const byId = Object.create(null), groups = new Map();
    for (const e of items) {
      e._id = new Set(words(e.id.replace(/^(sz|lg|x)-/, '')));
      e._name = new Set(words(e.name));
      e._tags = new Set((e.tags || []).flatMap(words));
      e._group = new Set(words(e.group));
      e._prompt = new Set(words(e.prompt));
      byId[e.id] = e;
      groups.set(e.group, (groups.get(e.group) || 0) + 1);
    }
    return { items, byId, groups: Array.from(groups, ([group, count]) => ({ group, count })) };
  }
  function load() {
    if (S.genIdx) return Promise.resolve(S.genIdx);
    if (S.genLoading) return S.genLoading;
    if (S.genFailAt && Date.now() - S.genFailAt < 3000) return Promise.resolve(null);
    S.genLoading = fetch(INDEX_URL, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('index.json HTTP ' + r.status))))
      .then((j) => { S.genIdx = build(j); S.genLoading = null; try { ctx.events?.emit('gen:ready', { count: S.genIdx.items.length }); } catch { /* listener */ } return S.genIdx; })
      .catch((err) => { S.genLoading = null; S.genFailAt = Date.now(); warn('could not load the model index:', err && err.message ? err.message : err); return null; });
    return S.genLoading;
  }
  const idx = () => { if (!S.genIdx) load(); return S.genIdx || null; };
  const pcTier = (c) => !!((c && c.quality) ? c.quality.pc : ctx.quality && ctx.quality.pc);

  // ------------------------------------------------------------------ search
  function score(e, q, quest) {
    let s = 0, hit = 0;
    for (const w of q) {
      let ws = 0;
      if (e._id.has(w)) ws = 6; else if (e._name.has(w)) ws = 5; else if (e._tags.has(w)) ws = 3; else if (e._group.has(w)) ws = 2; else if (e._prompt.has(w)) ws = 1;
      else if (w.length > 3) { // partial (prefix/substring) matches, weaker
        for (const t of e._id) if (t.startsWith(w) || w.startsWith(t) && t.length > 3) { ws = 2.5; break; }
        if (!ws) for (const t of e._tags) if (t.startsWith(w) && t.length > 3) { ws = 1.5; break; }
      }
      if (ws) hit++;
      s += ws;
    }
    if (!hit) return 0;
    if (hit === q.length) s += 2 + q.length;           // all words matched
    s -= 0.15 * (e._id.size + e._name.size);           // prefer the more specific/shorter entry on ties
    if (e.hero) s += 0.4;
    if (quest && e.tier === 'pc') s -= 2.5;
    return s;
  }
  function rank(query, quest) {
    const I = idx(); if (!I) return [];
    const q = words(query).filter((w) => !STOP.has(w));
    if (!q.length) return [];
    const out = [];
    for (const e of I.items) { const s = score(e, q, quest); if (s > 1.5) out.push([s, e.id]); }
    out.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
    return out.map((x) => x[1]);
  }
  function find(query, opts) {
    if (typeof query !== 'string') return opts && opts.all ? [] : null;
    const I = idx(); if (!I) return opts && opts.all ? [] : null;
    const exact = I.byId[query.trim().toLowerCase()];
    const r = rank(query, !pcTier());
    if (exact && !(opts && opts.all)) return exact.id;
    if (opts && opts.all) return exact ? [exact.id, ...r.filter((i) => i !== exact.id)] : r;
    return r[0] || null;
  }
  function list(f = {}) {
    const I = idx(); if (!I) return [];
    let items = I.items;
    if (f.group) { const gs = [].concat(f.group).map((g) => String(g).toLowerCase()); items = items.filter((e) => gs.includes(e.group)); }
    if (f.tag) { const ts = words([].concat(f.tag).join(' ')); items = items.filter((e) => ts.every((t) => e._tags.has(t) || e._id.has(t) || e._name.has(t))); }
    if (f.hero) items = items.filter((e) => e.hero);
    if (f.tier) items = items.filter((e) => e.tier === f.tier);
    if (f.search) { const ranked = rank(f.search, false); const set = new Set(items.map((e) => e.id)); return ranked.filter((id) => set.has(id)); }
    return items.map((e) => e.id);
  }
  const info = (id) => { const I = idx(); return (I && typeof id === 'string' && I.byId[id]) || null; };
  const resolve = (what) => { const I = idx(); if (!I) return null; if (I.byId[what]) return what; return find(String(what)); };

  // ------------------------------------------------------------------ placement helpers
  const groundOf = (c, x, z) => { try { const f = c.groundAt || ctx.groundAt; const y = f ? f(x, z) : ctx.world?.groundHeight?.(x, z); return Number.isFinite(y) ? y : 0; } catch { return 0; } };
  function surfaceY(c, info, x, z, yaw, size) {
    const W = ctx.world;
    if (info.ground === false) {
      let wet = false; try { wet = !!(W && W.isWater && W.isWater(x, z)); } catch { /* ignore */ }
      if (wet) { const lv = W.env && Number.isFinite(W.env.waterLevel) ? W.env.waterLevel : -1.4; return lv - 0.3; }
    }
    let y = groundOf(c, x, z);
    const fx = info.box.x * size * 0.35, fz = info.box.z * size * 0.35;
    if (Math.max(fx, fz) > 1.0) { // big footprint: sit on the lowest corner so nothing floats on a slope
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      for (const [a, b] of [[fx, fz], [-fx, fz], [fx, -fz], [-fx, -fz]]) y = Math.min(y, groundOf(c, x + a * cs + b * sn, z - a * sn + b * cs));
    }
    return y;
  }
  function readPos(o) {
    let x = 0, z = 0, y;
    const p = o.position;
    if (p) {
      if (Array.isArray(p)) { x = +p[0] || 0; y = p.length > 2 ? +p[1] : undefined; z = +(p.length > 2 ? p[2] : p[1]) || 0; }
      else { x = +p.x || 0; z = +p.z || 0; y = Number.isFinite(p.y) ? p.y : undefined; }
    }
    if (Number.isFinite(o.x)) x = o.x;
    if (Number.isFinite(o.z)) z = o.z;
    if (Number.isFinite(o.y)) y = o.y;
    return { x, z, y };
  }
  function addCollider(c, parent, info, x, baseY, z, yaw, size, h) {
    const P = ctx.world && ctx.world.physics;
    if (!P || !P.body) return null;
    const bx = Math.max(0.1, info.box.x * size), by = Math.max(0.1, info.box.y * size), bz = Math.max(0.1, info.box.z * size);
    const holder = new THREE.Group(); holder.name = 'gen-collider';
    let opts;
    if (info.col === 'trunk') {
      const r = Math.min(0.6, Math.max(0.15, 0.1 * Math.max(bx, bz))), ht = Math.min(by, 3);
      holder.position.set(x, baseY + ht / 2, z); opts = { shape: 'cylinder', size: [r, ht] };
    } else { holder.position.set(x, baseY + by / 2, z); opts = { shape: 'box', size: [bx, by, bz] }; }
    holder.rotation.y = yaw;
    parent.add(holder);
    let ph = null;
    try { ph = P.body(c, holder, { type: 'fixed', group: 'world', friction: 0.7, restitution: 0.1, ...opts }); } catch (err) { warn('collider failed', info.id, err && err.message); }
    if (!ph) { holder.removeFromParent(); return null; }
    h.holder = holder;
    return ph;
  }

  // ------------------------------------------------------------------ spawn
  function spawn(c, what, o) {
    o = o || {};
    c = c || ctx;
    const parent = o.parent || c.root || ctx.root;
    const slot = new THREE.Group(); slot.name = 'genset';
    parent.add(slot);
    const h = { id: null, info: null, query: typeof what === 'string' ? what : null, object: slot, loaded: false, error: null, skipped: null, substituted: null, collider: null, size: 1, box: null, inner: null, holder: null, removed: false, ready: null,
      remove() { if (h.removed) return; h.removed = true; try { h.collider && h.collider.remove && h.collider.remove(); } catch { /* gone */ } h.holder && h.holder.removeFromParent(); h.inner && h.inner.remove && h.inner.remove(); slot.removeFromParent(); } };
    if (c.onDispose) c.onDispose(() => h.remove());
    const go = () => {
      if (h.removed) return h;
      const I = S.genIdx;
      if (!I) { h.error = new Error('world.gen: model index unavailable'); return h; }
      let id = typeof what === 'string' ? resolve(what) : null;
      if (!id) { h.error = new Error('world.gen: nothing matches "' + what + '" (try world.gen.find / list)'); warn(h.error.message, 'suggestions:', find(String(what), { all: true }).slice(0, 5).join(', ')); return h; }
      let inf = I.byId[id];
      if (inf.tier === 'pc' && !pcTier(c)) {
        const alt = inf.alt && I.byId[inf.alt];
        if (alt && alt.tier === 'all') { h.substituted = id; id = alt.id; inf = alt; } else { h.skipped = 'pc-only'; h.id = id; h.info = inf; return h; }
      }
      h.id = id; h.info = inf;
      const { x, z, y: y0 } = readPos(o);
      const yaw = Number.isFinite(o.yaw) ? o.yaw : 0;
      let size = Number.isFinite(o.size) && o.size > 0 ? o.size : (Number.isFinite(o.height) && o.height > 0 && inf.box.y > 0.05 ? o.height / inf.box.y : inf.size_m);
      size = Math.min(400, Math.max(0.02, size));
      const sink = Number.isFinite(o.sink) ? o.sink : 0.03;
      const base = (y0 !== undefined ? y0 : surfaceY(c, inf, x, z, yaw, size)) - sink;
      h.size = size;
      slot.position.set(x, base, z); slot.rotation.y = yaw; slot.scale.setScalar(size);
      slot.userData.genId = id;
      h.inner = G.spawn(c, id, { x: 0, z: 0, y: 0, sink: 0, yaw: 0, size: 1, parent: slot, castShadow: o.castShadow });
      const solid = o.solid !== undefined ? !!o.solid : (!!inf.solid && !o.parent);
      if (solid) h.collider = addCollider(c, parent, inf, x, base + sink, z, yaw, size, h);
      return h.inner.ready.then(() => { if (h.inner.error) h.error = h.inner.error; h.loaded = !!h.inner.loaded; h.box = h.inner.box || null; return h; });
    };
    const run = () => { try { return go(); } catch (err) { h.error = err; warn('spawn failed', err && err.message); return h; } };
    h.ready = (S.genIdx ? Promise.resolve(run()) : load().then(run)).catch((err) => { h.error = err; return h; });
    return h; // when the index is already loaded, id/info/size/collider are set before this returns
  }

  // ------------------------------------------------------------------ scatter
  function scatter(c, what, items, o) {
    o = o || {};
    c = c || ctx;
    const parent = o.parent || c.root || ctx.root;
    const box = new THREE.Group(); box.name = 'genset-scatter';
    parent.add(box);
    const f = { id: null, info: null, object: box, count: Array.isArray(items) ? items.length : 0, loaded: false, error: null, skipped: null, substituted: null, inner: null, holders: [], colliders: [], removed: false, ready: null,
      remove() { if (f.removed) return; f.removed = true; for (const k of f.colliders) { try { k.remove && k.remove(); } catch { /* gone */ } } for (const hd of f.holders) hd.removeFromParent(); f.inner && f.inner.remove && f.inner.remove(); box.removeFromParent(); } };
    if (c.onDispose) c.onDispose(() => f.remove());
    const go = () => {
      if (f.removed) return f;
      const I = S.genIdx;
      if (!I) { f.error = new Error('world.gen: model index unavailable'); return f; }
      let id = typeof what === 'string' ? resolve(what) : null;
      if (!id) { f.error = new Error('world.gen: nothing matches "' + what + '"'); warn(f.error.message); return f; }
      let inf = I.byId[id];
      if (inf.tier === 'pc' && !pcTier(c)) {
        const alt = inf.alt && I.byId[inf.alt];
        if (alt && alt.tier === 'all') { f.substituted = id; id = alt.id; inf = alt; } else { f.skipped = 'pc-only'; f.id = id; f.info = inf; return f; }
      }
      f.id = id; f.info = inf;
      const list2 = (items || []).filter(Boolean).map((it) => {
        const p = readPos(it), yaw = Number.isFinite(it.yaw) ? it.yaw : 0;
        const size = Math.min(400, Math.max(0.02, Number.isFinite(it.size) && it.size > 0 ? it.size : (Number.isFinite(o.size) && o.size > 0 ? o.size : inf.size_m)));
        const sink = Number.isFinite(it.sink) ? it.sink : (Number.isFinite(o.sink) ? o.sink : 0.03);
        return { x: p.x, z: p.z, y: (p.y !== undefined ? p.y : surfaceY(c, inf, p.x, p.z, yaw, size)), yaw, size, sink };
      });
      f.count = list2.length;
      f.inner = G.scatter(c, id, list2, { parent: box, castShadow: o.castShadow });
      const solid = o.solid !== undefined ? !!o.solid : (!!inf.solid && !o.parent && list2.length <= 24);
      if (solid) for (const it of list2) { const hs = { holder: null }; const k = addCollider(c, parent, inf, it.x, it.y, it.z, it.yaw, it.size, hs); if (k) { f.colliders.push(k); f.holders.push(hs.holder); } }
      return f.inner.ready.then(() => { if (f.inner.error) f.error = f.inner.error; f.loaded = !!f.inner.loaded; return f; });
    };
    const run = () => { try { return go(); } catch (err) { f.error = err; warn('scatter failed', err && err.message); return f; } };
    f.ready = (S.genIdx ? Promise.resolve(run()) : load().then(run)).catch((err) => { f.error = err; return f; });
    return f;
  }

  const api = {
    ready() { return load().then(() => api); },
    get loaded() { return !!S.genIdx; },
    find, list, info, spawn, scatter,
    groups() { const I = idx(); return I ? I.groups.map((g) => ({ ...g })) : []; },
    box(id) { const e = info(id); return e ? { ...e.box } : (G.box ? G.box(id) : null); },
    // lib/gen.js compatibility (core/intro.js and core/quests.js use world.gen with these):
    url(c, id) { return G.url(c || ctx, id); },
    preload(c, ids) { return load().then(() => G.preload(c || ctx, (ids || []).map((i) => resolve(i) || i))).catch(() => null); },
    count() { return S.genIdx ? S.genIdx.items.length : 0; },
  };
  ctx.provide('gen', api);
  return {
    dispose() { disposed = true; void disposed; },
  };
}
