// core/library.js - world.library: ready-made things the oracle can summon in ONE call (about 2 s instead of 30 s of coding).
//
// USE     const lib = ctx.world.library; if (!lib) return {};            // always guard (it may be reloading)
//   const h = lib.spawn(ctx, 'goblin', { count: 5, spread: 6 });          // YOUR ctx first. Returns ONE handle (even for count > 1) or null
//   lib.spawn(ctx, 'cottage', { position: ctx.aimPoint(), yaw: 0.5, scale: 1.2 });
//   lib.wave(ctx, [{ name: 'goblin', count: 4 }, { name: 'orc-brute', count: 1 }], { around, radius: 13, delay: 0.35 });   // ring of enemies rising from the ground
//   Names are fuzzy (case, plural, dashes, aliases: 'Goblins', 'oak tree', 'make it rain', 'a dragon'); nothing close -> null. lib.has(name), lib.match(name).
//   Compose: 'goblin attack' = lib.wave; 'make a village' = lib.spawn(ctx, 'village'); a boss = 'boss-fight'; then `return {}`.
// OPTIONS (all entries)  x, z | position {x,z} (default: 5-9 m in front of the player, never closer than 2 m to them), count (default 1), spread (m scatter radius
//   for count > 1), yaw (default: faces the player), scale. Per entry (see table): faction ('enemy'|'friendly'|'neutral'; any fighter can be flipped), hp, damage,
//   name (a NICKNAME: name tag + fighter.label, never fighter.name), color, text, loot ('sword' | true), rise: true (grow out of the ground), length, radius, style ...
// HANDLE  { name, objects[], actors[], fighters[] (live combat fighters), items[] (one per instance when count > 1), position, alive, removed, trimmed (cut by the budget), remove() }
//   remove() despawns everything; it also happens automatically when your creation unloads. A wave handle adds pending / total / cleared.
// MORE    lib.list() -> [{ name, category, description, aliases, options }]   lib.categories()   lib.byCategory(cat)   lib.count()
//   lib.define(name, { category, description, aliases, build(ctx, opts, lib) -> Object3D | [Object3D] | { object, update(dt, t), dispose() } }) -> undo()
//   lib.speedMul(actor, key, factor) -> actor   slow / haste / root any kit or library actor: named factors MULTIPLY (kit's actor.legMul = base x all factors), actor.speed stays the base so combat.js, perf and your own
//   effects never overwrite each other. factor 1 or undefined removes the key; 0 roots. Use it instead of actor.setSpeed()/actor.speed = for temporary effects (restore = speedMul(actor, key, 1)).
//   Enemies are combat fighters (they hunt you and friendlies), allies trail and defend you, neutrals greet you and run if hurt; weather entries drive world.env and restore it. All parented to YOUR ctx.root. People, monsters, animals: glTF bodies (world.models) when one fits, else primitives (lib.define: kit.humanoid(ctx, { model: [...] })).
// IDENTITY  quests, voices, audio match names: fighter.name === actor.role === the ENTRY name ('goblin', 'skeleton-archer', 'lich-king'), also summons, slime splits, wave / scenario members,
//   mimics, custom mobs, lib.define entries: so combat:kill victim.name is that name. `name` is a nickname (f.label, actor.nick + npcName). inst.person / creature / fight, H.monster do it (userData.libName).
// BUDGET  spawn / wave / sub ask world.perf.allow('fighters'|'actors'|'bodies', n) (else canSpawn; physics.canSpawn for bodies), spawn what fits and tell the HUD; entry.pop null = free. Bursts, flocks, fx
//   scale with ctx.quality.density (H.allow, H.density). Custom mobs (H.monster) walk via a Rapier character controller (flyers hover above scenery) and take kit.hit force (staggerT; spec.armor = never).
//
// CATALOGUE  300 entries: name (key options). Every entry takes x, z / position, yaw, scale, count, spread; fighters also faction, hp, damage; weapons also hand. Names are fuzzy.
// ENEMIES (faction enemy; they hunt you and your allies)
//   goblin - cowardly green pack skirmisher with a rusty dagger: circles you
//   goblin-bomber - goblin with a sack of lit bombs: lobs them in high arcs (the
//   goblin-archer - small goblin sniper with a shortbow
//   goblin-shaman - goblin witch-doctor with a glowing wand: heals wounded goblins
//   demon - horned red fiend wreathed in a ring of flame (stay out of
//   orc-brute - hulking tusked orc: lowers its head and CHARGES in a straight
//   skeleton - clattering undead swordsman with glowing eye sockets
//   skeleton-archer - skeleton with a warped bow: a pale aim line marks the shot
//   zombie - slow, relentless corpse: groans toward you, grabs (arms out
//   bandit - masked highwayman with a sword
//   dark-knight - black-plate duelist with sword and spiked shield: frontal blows
//   cultist - hooded fanatic: throws fire pots that burst in a glowing circle
//   necromancer - robed death-mage that raises the corpses lying around (or (summonMax)
//   troll - giant grey-green brute that regenerates (fire, or constant
//   ogre - enormous tan ogre with a belly and a big club
//   battle-robot - armoured combat robot: a red laser line locks on for a second
//   alien-grunt - big-headed grey-green alien trooper with a plasma pistol
//   wolf - fast grey wolf that hunts in packs: they spread out and circle
//   dire-bear - huge brown bear with a shoulder hump
//   giant-spider - black spider the size of a dog: lies buried until you come near
//   scorpion - sand-coloured scorpion that waits buried (dust and a ground
//   slime - bouncy translucent blob (random colour): lunges in a squashing (size, color)
//   wraith - tattered floating phantom with cyan eyes: blinks to a new spot
//   imp - tiny red flying devil with bat wings
//   bat-swarm - a cloud of 14 bats that swirls and nibbles
//   fire-elemental - living pillar of flame: scorches everything within its ring
//   stone-golem - slow, towering rock golem with moss and glowing runes
//   ice-golem - frost-blue crystal golem: a freezing field around it slows
//   mimic - looks exactly like a treasure chest (loot)
//   drone - hovering robot with four rotors and a red laser eye: a thin red
//   kamikaze-drone - small rotor drone that rushes you, beeps faster and faster
//   dragon-whelp - young green dragon that flies in strafing runs: a glowing lane
//   lich-king - BOSS: crowned skeletal sorcerer (level)
//   ancient-dragon - BOSS: colossal red dragon (level)
//   troll-king - BOSS: crowned troll chieftain in a ring of stalagmites (level)
//   dark-champion - BOSS: the dark knight made flesh - a towering duelist (level)
//   demon-lord - BOSS: towering horned demon wreathed in a ring of fire (burns (level)
//   pirate - cutlass-swinging pirate with a tricorn hat and eye patch
//   bandit-archer - hooded bandit sniper with a hunting bow
// ALLIES (faction friendly; follow and defend the player)
//   knight - loyal armoured knight with sword, shield and a blue cape
//   archer - friendly bowman in green
//   mage - friendly wizard in blue robes
//   healer - white-robed cleric that follows you and heals you (and wounded (amount, interval)
//   paladin - golden-armoured holy warrior with a halo and a warhammer
//   ranger - hooded forest ranger with a longbow
//   villager-militia - farmer with a pitchfork and a bucket helmet
//   guard-dog - brave dog that trails you, barks at danger and bites enemies
//   wolf-companion - tamed silver wolf with blue eyes
//   golem-guardian - friendly stone-and-gold golem with a rune shield
//   fairy - tiny glowing fairy (random colour) that orbits you, leaves (color, follow)
//   robot-buddy - little hovering helper bot with a screen face (color)
// LIFE
//   villager - ordinary villager (random clothes, hair, sometimes a hat) who
//   farmer - straw-hatted farmer in blue overalls hoeing the ground with
//   merchant - travelling merchant behind his own market stall with a fat
//   blacksmith - burly smith with an apron hammering an anvil: sparks
//   bard - wandering minstrel with a lute who plays procedural folk tunes
//   child - small excitable child (about 1 m) who runs around giggling
//   wizard-npc - wise old wizard with a long beard, big hat and a staff
//   king - portly king in an ermine mantle, gold crown and scepter
//   cat - house cat in a random coat colour (color)
//   dog - friendly stray dog with floppy ears that trots over to you (color)
//   chicken - small chicken with a red comb that wanders in jerks and clucks
//   sheep - fluffy white sheep with a dark face that grazes in slow circles
//   cow - big black-and-white cow with horns and a pink nose that chews
//   horse - tall brown horse with a flowing mane that trots about (color)
//   pig - round pink pig with a snout and a curly tail
//   deer - graceful stag with branching antlers and a white tail
//   rabbit - small grey-brown rabbit with long ears and a fluffy white tail
//   fox - sly orange fox with a white-tipped bushy tail
//   crow-flock - crows peck the ground, then scatter into the sky circling (kind, radius)
//   butterflies - a cloud of coloured butterflies fluttering around a patch (radius)
//   fish-pond - round stone-rimmed pond with lily pads, lotus flowers (radius, fish)
// WEAPONS (holdable; the player grabs with squeeze)
//   sword greatsword dagger axe warhammer spear club katana scythe bow crossbow blaster shotgun rifle magic-staff wand shield torch pickaxe boomerang grenade great-axe mace
//   war-pick shovel hoe bone-blade bone-axe heavy-crossbow revolver smg sniper rocket-launcher plasma-rifle bone-staff spellbook smoke-bomb spiked-shield tower-shield
//   omni-blade sun-spear void-scythe storm-hammer ember-staff aegis-shield star-bow rune-dagger arc-blaster prism-rifle weapon-rack(types (array of weapon names))
//   armory(none)
// STRUCTURES
//   hut cottage watchtower castle-tower(roof (false for open top)) wall-segment(length) gate bridge(length) well market-stall tent(color) campsite(color) windmill lighthouse
//   ruins(radius) stone-circle(radius) shrine(color (orb)) obelisk(color) portal-arch(color) fountain dock(length) fence(length) signpost(text) throne(color) arena(radius)
//   dungeon-entrance tavern(color (team 0-3)) church(color (team 0-3)) blacksmith-shop(color (team 0-3)) barracks(color (team 0-3)) lumber-mill(color (team 0-3))
//   archery-range(color (team 0-3)) castle-keep(color (team 0-3)) watermill(color (team 0-3)) ruined-house construction-site bazaar(color (team 0-3))
//   ship(style, size (small|medium|large)) crypt(style (large|small)) siege-tower battering-ram drawbridge iron-fence(length) garden-wall(length)
// NATURE
//   oak-tree pine-tree birch-tree palm-tree willow cherry-blossom dead-tree autumn-tree giant-mushroom(color) bush flower-patch(color, radius) boulder rock-cluster
//   crystal-cluster(color) pond(radius) waterfall-rock log tall-grass-patch(radius) forest(radius, style, clearing, undergrowth) grove(radius, style)
//   autumn-forest(radius, clearing) dead-forest(radius, clearing) palm-grove(radius, clearing) stump log-pile cactus mushroom-patch(radius)
//   pumpkin-patch(count (pumpkins, max 24), radius) rock-spires mountain(size, style) lily-pads(radius) reed-patch(radius) corn-field(width, depth) wheat-field(width, depth)
//   vegetable-patch(width, depth)
// EFFECTS (weather and sky; restored on removal)
//   rain - steady rainfall around you (2200 GPU rain streaks), overcast (intensity)
//   snow - gentle snowfall with a pale overcast sky and a white snowy (intensity, ground)
//   fog-bank - thick low fog: denser pale fog everywhere plus drifting cloud (density, color, radius)
//   fireflies - a swarm of 140 blinking yellow-green fireflies drifting around (follow)
//   aurora - night-sky aurora borealis with full stars (keepTime)
//   night - switch the world to deep night: stars and aurora (restored (time (0..0.3))
//   dusk - switch to the default violet-orange twilight (restored when (time)
//   day - switch to a bright blue daytime sky with pale fog (restored (none)
//   storm - thunderstorm: dark sky, hard rain, strong wind, jagged (intensity)
//   meteor-shower - night-sky meteors streaking over you with glowing trails (rate (per second))
//   falling-leaves - autumn leaves in orange, gold and red spiralling down around you
//   embers - glowing orange embers and sparks drifting upward around you (follow)
//   bubbles - a stream of shimmering soap bubbles rising from a spot (options (radius)
//   confetti-burst - a pop and a burst of ~400 multicoloured confetti that flutters (x, z (burst point), height)
//   rainbow - a huge seven-colour rainbow arching across the sky ~130 m away (distance)
// PROPS
//   chest(loot, color, style (gold)) barrel(loot) powder-keg crate(loot, stack) table chair bench bed lantern torch-stand(color) bonfire anvil cauldron(color) training-dummy
//   archery-target ball(color, style) beach-ball dice bowling-set balloon-bunch trampoline(power) cannon catapult fireworks-launcher(auto (default true)) music-box bell
//   treasure-pile scarecrow snowman statue(style, text) cart(style (high)) coffin(style) wheelbarrow ladder workbench(style) bedroll(color) urn(style) rowboat(style)
//   signboard(text) fire-basket(color) crate-stack(height, style) weapon-stand banner(color, style) flag(color) candelabra candle-cluster tavern-table-set(seats) bookshelf
//   treasure-chest-gold(loot) haystack gravestone(style, spread) tombstone-row(length, style) skull-pile bone-pile pumpkin(style) pumpkin-row(length) jack-o-lantern(style)
//   sack-pile siege-ballista trebuchet forge-workbench omni-altar omni-obelisk omni-throne omni-relic omni-gate
// SCENARIOS (whole places in one call)
//   village - lively village: 2 cottages, a hut, a well, a merchant's stall (none)
//   goblin-camp - goblin war camp: bonfire, two ragged tents, a skull totem, (goblins (count))
//   graveyard - fenced graveyard of headstones, mausoleum and mist (skeletons)
//   bandit-ambush - forest road blocked by a fallen log, a tipped wagon and crates (none)
//   arena-battle - arena with 3 escalating waves (goblins (radius, waves (1-3))
//   enchanted-grove - fairy-tale grove: cherry blossoms and willows, glowing (none)
//   wizard-tower - tall purple wizard tower with orbiting rune rings and (none)
//   farm - working farm: red barn with hay loft, crop rows, hay bales, (none)
//   castle-siege - castle wall, gate and towers: knights and archers defend (your (attackers, defenders)
//   pirate-cove - sandy cove with a beached pirate ship, a dock and rowboat, palm (none)
//   robot-invasion - flying saucer beams down aliens while battle robots march (robots, drones, aliens)
//   boss-fight - a torch-lit arena with a boss in the middle (option boss: (boss, radius)
//   haunted-graveyard - night-black cemetery: crooked dead trees, a crypt, rows (skeletons)
//   harbour - little harbour: a stone quay and wooden pier on a patch of calm (none)
//   castle-courtyard - walled castle courtyard: a gatehouse with doors, wall runs (none)
//   dungeon-room - torch-lit stone dungeon chamber (10 m): flagstone floor, brick (skeletons)
//   medieval-market - bustling medieval market square: ten stalls in two rows, (none)
//   spooky-forest - dense haunted forest of twisted dead trees and orange pines (count (trees), radius)

export const meta = { name: 'Library', description: 'Ready-made weapons, enemies, allies, creatures, structures, nature, props, effects and scenarios.' };

// ============================================================================================================
// ENGINE. The catalogue lives in ../library/*.js (each exports default function install(lib, H)); this file is
// the toolkit they share: a vertex-colour mesh Builder (one draw call per model), shared geometry/materials,
// instances with per-thing cleanup, a custom-actor ("mob") adapter that is compatible with combat.fighter,
// placement, fuzzy name matching, waves and the public API.
// ============================================================================================================

export default async function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Color, Matrix4, Matrix3, Quaternion, Euler, MathUtils } = THREE;
  const S = ctx.state; // survives hot reloads of this file
  S.tickers ??= []; S.insts ??= new Set(); S.custom ??= new Map(); S.perCtx ??= new WeakMap(); S.portals ??= [];

  // ------------------------------------------------------------------ utilities
  const TAU = Math.PI * 2;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = MathUtils.clamp, lerp = MathUtils.lerp;
  const noop = () => {};
  const wrapAng = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const smooth = (t) => t * t * (3 - 2 * t);
  const ease = { out: (t) => 1 - (1 - t) * (1 - t), inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) };
  function rng(seed) { // mulberry32
    let s = (seed >>> 0) || 1;
    return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const _tc = new Color();
  const shade = (hex, f) => _tc.set(hex).multiplyScalar(f).getHex();
  const mix = (a, b, t) => { _tc.set(a); const c2 = new Color(b); return _tc.lerp(c2, t).getHex(); };
  const kit = () => ctx.world.kit, combat = () => ctx.world.combat, weapons = () => ctx.world.weapons, playerApi = () => ctx.world.player;
  const ground = (x, z) => ctx.groundAt(x, z);
  const head = ctx.player.head;

  // ------------------------------------------------------------------ materials + primitive cache + Builder
  const MATS = {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
    cloth: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    ghost: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  };
  for (const m of Object.values(MATS)) m.userData.shared = true;
  const ownMat = (kind) => { const m = MATS[kind].clone(); m.userData = { own: true }; return m; };

  const PRIMS = new Map();
  function prim(key, make) {
    let p = PRIMS.get(key);
    if (!p) {
      let g = make();
      if (g.index) g = g.toNonIndexed();
      g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.computeVertexNormals();
      p = { pos: g.attributes.position.array, nor: g.attributes.normal.array };
      g.dispose(); PRIMS.set(key, p);
    }
    return p;
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const PRISM = () => prim('prism', () => {
    const g = new THREE.BufferGeometry();
    const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0, 1, -0.5], d = [-0.5, 0, 0.5], e = [0.5, 0, 0.5], f = [0, 1, 0.5];
    const tris = [a, c, b, d, e, f, a, d, f, a, f, c, b, c, f, b, f, e, a, b, e, a, e, d];
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    return g;
  });

  const _m = new Matrix4(), _l = new Matrix4(), _n3 = new Matrix3(), _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _e = new Euler(), _v = new Vector3();
  // Builder: accumulate coloured primitives, then build() -> ONE mesh per material kind (solid, glow, cloth, ghost, beam).
  // Conventions: box / sph / tor / dod / oct / cylc are CENTRED; cyl / cone / prism are BASE-centred (y = bottom).
  // rot = number (about Y) | [rx, ry, rz].  b.mode('glow') switches the material kind for following parts.
  class Builder {
    constructor() { this.sets = {}; this.cur = 'solid'; this.stack = [new Matrix4()]; this.jit = 0.06; }
    mode(m) { this.cur = m; return this; }
    push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
      const top = this.stack[this.stack.length - 1];
      const m = new Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(s, s, s));
      this.stack.push(new Matrix4().multiplyMatrices(top, m));
      return this;
    }
    pop() { if (this.stack.length > 1) this.stack.pop(); return this; }
    part(g, color, x, y, z, sx, sy, sz, rot) {
      let rx = 0, ry = 0, rz = 0;
      if (typeof rot === 'number') ry = rot; else if (rot) { rx = rot[0] || 0; ry = rot[1] || 0; rz = rot[2] || 0; }
      _l.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
      _m.multiplyMatrices(this.stack[this.stack.length - 1], _l);
      _n3.getNormalMatrix(_m);
      const set = (this.sets[this.cur] ??= { pos: [], nor: [], col: [] });
      _tc.set(color === undefined ? 0xffffff : color);
      const j = 1 + (Math.random() * 2 - 1) * this.jit, cr = _tc.r * j, cg = _tc.g * j, cb = _tc.b * j;
      const P = g.pos, N = g.nor;
      for (let i = 0; i < P.length; i += 3) {
        _v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(_m); set.pos.push(_v.x, _v.y, _v.z);
        _v.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_n3).normalize(); set.nor.push(_v.x, _v.y, _v.z);
        set.col.push(cr, cg, cb);
      }
      return this;
    }
    box(x, y, z, w, h, d, c, rot) { return this.part(prim('box', () => new THREE.BoxGeometry(1, 1, 1)), c, x, y, z, w, h, d, rot); }
    sph(x, y, z, rx, ry, rz, c, rot, seg = 7) {
      const hs = Math.max(4, seg - 2);
      return this.part(prim(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, hs)), c, x, y, z, rx, ry ?? rx, rz ?? rx, rot);
    }
    cyl(x, y, z, rt, rb, h, c, rot, seg = 7) {
      return this.part(prim(`cyl${r3(rt)}_${r3(rb)}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg, 1).translate(0, 0.5, 0)), c, x, y, z, 1, h, 1, rot);
    }
    cylc(x, y, z, rt, rb, h, c, rot, seg = 7) {
      return this.part(prim(`cylc${r3(rt)}_${r3(rb)}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg, 1)), c, x, y, z, 1, h, 1, rot);
    }
    cone(x, y, z, r, h, c, rot, seg = 7) { return this.part(prim(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg).translate(0, 0.5, 0)), c, x, y, z, r, h, r, rot); }
    prism(x, y, z, w, h, len, c, rot) { return this.part(PRISM(), c, x, y, z, w, h, len, rot); }
    tor(x, y, z, R, r, c, rot, seg = 10) { return this.part(prim(`tor${r3(r / R)}_${seg}`, () => new THREE.TorusGeometry(1, r / R, 5, seg)), c, x, y, z, R, R, R, rot); }
    dod(x, y, z, rx, ry, rz, c, rot) { return this.part(prim('dod', () => new THREE.DodecahedronGeometry(1, 0)), c, x, y, z, rx, ry ?? rx, rz ?? rx, rot); }
    oct(x, y, z, rx, ry, rz, c, rot) { return this.part(prim('oct', () => new THREE.OctahedronGeometry(1, 0)), c, x, y, z, rx, ry ?? rx, rz ?? rx, rot); }
    geos() {
      const out = {};
      for (const k in this.sets) {
        const s = this.sets[k];
        if (!s.pos.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(s.nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
        g.computeBoundingSphere();
        out[k] = g;
      }
      return out;
    }
    build(o = {}) { return assemble(this.geos(), o); }
  }
  const mk = () => new Builder();
  function assemble(geos, o = {}) {
    const meshes = [];
    for (const k in geos) {
      const g = geos[k];
      if (o.shared) g.userData.shared = true;
      const m = new THREE.Mesh(g, o.own ? ownMat(k) : MATS[k]);
      m.userData.kind = k;
      meshes.push(m);
    }
    if (meshes.length === 1) return meshes[0];
    const grp = new THREE.Group();
    for (const m of meshes) grp.add(m);
    return grp;
  }
  // cached model: geometry built once per key, every call makes fresh meshes sharing it
  const MODELS = new Map();
  function model(key, fn, o = {}) {
    let geos = MODELS.get(key);
    if (!geos) { const b = mk(); fn(b); geos = b.geos(); for (const k in geos) geos[k].userData.shared = true; MODELS.set(key, geos); }
    return assemble(geos, { own: o.own, shared: true });
  }
  function disposeOwn(root) {
    root.traverse((o) => {
      if (o.isSprite) return;
      if (o.isInstancedMesh) o.dispose?.();
      const g = o.geometry;
      if (g && !g.userData.shared) g.dispose();
      if (o.material) for (const m of [].concat(o.material)) {
        if (m.userData && m.userData.own) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
      }
    });
  }
  function countDraws(root) {
    let n = 0;
    root.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.visible !== false && !(o.isInstancedMesh && o.count === 0)) n++; });
    return n;
  }

  // ------------------------------------------------------------------ per-caller shared sound + particles
  const pc = (c) => { let r = S.perCtx.get(c); if (!r) { r = { snd: null, kit: null }; S.perCtx.set(c, r); } return r; };
  const NOSND = { tone: noop, noise: noop, chord: noop };
  function sfx(c) {
    const K = kit(), p = pc(c);
    if (!K) return NOSND;
    if (!p.snd || p.kit !== K) {
      const raw = K.sound(c, { volume: 1 });
      // ambient/effect sounds yield when kit's 24-voice pool is nearly full, so combat and spell sounds always get through
      const ok = () => K.stats().voices < 19;
      p.snd = { tone(o) { if (ok()) raw.tone(o); }, noise(o) { if (ok()) raw.noise(o); }, chord(f, o) { if (ok()) raw.chord(f, o); } };
      p.kit = K;
    }
    return p.snd;
  }
  const FXP = {
    puff: (h) => ({ count: 70, additive: false, color: [h, shade(h, 0.45)], alpha: 0.6, size: [0.45, 1.3], life: [0.7, 1.3], speed: [0.6, 1.9], gravity: -0.3, drag: 1.3 }),
    spark: (h) => ({ count: 90, color: [mix(h, 0xffffff, 0.6), h], size: [0.12, 0.03], life: [0.4, 0.9], speed: [2, 6], gravity: 8, drag: 0.5 }),
    glow: (h) => ({ count: 80, color: [mix(h, 0xffffff, 0.4), h], size: [0.4, 0.05], life: [0.6, 1.1], speed: [0.3, 1.2], gravity: -0.6, drag: 0.8 }),
    bits: (h) => ({ count: 60, additive: false, color: [h, shade(h, 0.6)], size: [0.14, 0.06], life: [0.8, 1.6], speed: [1.5, 4.5], gravity: 9, drag: 0.3 }),
    fire: (h) => ({ count: 100, color: [0xffe08a, h], size: [0.7, 0.1], life: [0.3, 0.7], speed: [0.6, 2.2], gravity: -2, drag: 1.2 }),
  };
  // BURST EMITTERS are ONE small shared pool owned by library.js itself (not by whichever creation asked): at most POOL_MAX emitters, each flagged
  // shared (kit.stats().particles does not count it). The colour is quantised to 4 bits per channel so similar tints share an emitter; an idle emitter
  // of the same kind is recoloured instead of making a new one; idle ones are disposed after POOL_IDLE seconds. Nothing lingers in a creation's root.
  const POOL_MAX = 10, POOL_IDLE = 12;
  const BP = (S.burstPool ??= { list: [], kit: null });  // survives library hot reloads; emitters made by an older library are disposed by its own ctx
  const qhex = (h) => { const x = _tc.set(h).getHex(); return ((((x >> 20) & 15) * 17) << 16) | ((((x >> 12) & 15) * 17) << 8) | (((x >> 4) & 15) * 17); };
  function emitter(kind, hex) {
    const K = kit(); if (!K || !FXP[kind]) return null;
    if (BP.kit !== K) { for (const r of BP.list) { try { r.e.dispose(); } catch (err) { /* gone */ } } BP.list.length = 0; BP.kit = K; }
    const L = BP.list;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].e.disposed) L.splice(i, 1);
    const key = kind + ':' + (hex = qhex(hex));
    let r = null;
    for (const x of L) if (x.key === key) { r = x; break; }
    if (!r) {
      for (const x of L) if (x.kind === kind && x.e.live <= 0) { r = x; break; }   // idle emitter of this kind: recolour it (c0 / c1 are read every step)
      if (r) { const spec = FXP[kind](hex), cs = [].concat(spec.color); r.e.c0.set(cs[0]); r.e.c1.set(cs[1] ?? cs[0]); r.key = key; }
    }
    if (!r) {
      if (L.length >= POOL_MAX) {                                                    // full: share the least recently used emitter of this kind (colour may be off), else drop the oldest idle one
        let best = null;
        for (const x of L) if (x.kind === kind && (!best || x.used < best.used)) best = x;
        if (best) { best.used = ctx.clock.t; return best.e; }
        for (const x of L) if (x.e.live <= 0 && (!best || x.used < best.used)) best = x;
        if (!best) return null;
        best.e.dispose(); L.splice(L.indexOf(best), 1);
      }
      const e = K.particles(ctx, FXP[kind](hex)); e.shared = true;
      r = { kind, key, e, used: 0, idle: 0 }; L.push(r);
    }
    r.used = ctx.clock.t; r.idle = 0;
    return r.e;
  }
  function reapEmitters(dt) {
    const L = BP.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const r = L[i];
      if (r.e.disposed) { L.splice(i, 1); continue; }
      if (r.e.live > 0) { r.idle = 0; continue; }
      if ((r.idle += dt) > POOL_IDLE) { r.e.dispose(); L.splice(i, 1); }
    }
  }
  // burst(c, 'puff'|'spark'|'glow'|'bits'|'fire', colour, point, n, scale, velocity)   (c is accepted for compatibility; the emitter is shared)
  function burst(c, kind, hex, at, n = 10, scale = 1, vel) { const e = emitter(kind, hex); if (e) e.emit(at, n > 0 ? Math.max(1, Math.round(n * dens())) : 0, vel, scale); return e; }

  // ------------------------------------------------------------------ matching
  const entries = new Map(); // name -> entry
  let index = null;
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const singulars = (k) => {
    const v = [k];
    if (k.endsWith('ies')) v.push(k.slice(0, -3) + 'y');
    if (k.endsWith('ves')) v.push(k.slice(0, -3) + 'f', k.slice(0, -3) + 'fe');
    if (k.endsWith('es')) v.push(k.slice(0, -2));
    if (k.endsWith('s')) v.push(k.slice(0, -1));
    if (k.endsWith('men')) v.push(k.slice(0, -3) + 'man');
    return v;
  };
  function buildIndex() {
    index = new Map();
    for (const e of entries.values()) {
      for (const k of [e.name, ...(e.aliases || [])]) { const n = norm(k); if (n && !index.has(n)) index.set(n, e); }
    }
    for (const e of entries.values()) { const n = norm(e.name); index.set(n, e); } // canonical names always win
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  const FILLER = new Set(['a', 'an', 'the', 'some', 'my', 'me', 'please', 'of', 'and', 'with', 'little', 'big', 'giant', 'small', 'tiny', 'huge', 'cool', 'new']);
  function find(name) {
    if (!index) buildIndex();
    const raw = String(name ?? '');
    const n = norm(raw);
    if (!n) return null;
    for (const v of singulars(n)) { const e = index.get(v); if (e) return { entry: e, score: 1 }; }
    const toks = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const core = toks.filter((t) => !FILLER.has(t));
    const cn = core.join('');
    if (cn && cn !== n) for (const v of singulars(cn)) { const e = index.get(v); if (e) return { entry: e, score: 0.95 }; }
    let best = null, bs = 0;
    const consider = (e, s) => { if (s > bs) { bs = s; best = e; } };
    for (const [key, e] of index) {
      let s = 0;
      for (const v of singulars(cn || n)) {
        if (key === v) s = Math.max(s, 1);
        else if (v.length >= 4 && key.includes(v)) s = Math.max(s, 0.55 + 0.4 * (v.length / key.length));
        else if (key.length >= 4 && v.includes(key)) s = Math.max(s, 0.5 + 0.4 * (key.length / v.length));
        else {
          const d = lev(v, key), L = Math.max(v.length, key.length);
          if (L >= 4 && v[0] === key[0] && d <= Math.max(1, Math.floor(L * 0.2))) s = Math.max(s, 0.7 - d / (L * 1.6));
        }
      }
      if (s > 0) consider(e, s - (key === norm(e.name) ? 0 : 0.01));
    }
    // word overlap against canonical names and aliases
    for (const e of entries.values()) {
      const words = new Set();
      for (const k of [e.name, ...(e.aliases || [])]) for (const w of String(k).toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2) words.add(w);
      let hit = 0;
      for (const t of core) for (const w of words) if (t === w || singulars(t).includes(w) || (t.length > 4 && t[0] === w[0] && lev(t, w) <= 1)) { hit++; break; }
      if (hit) consider(e, 0.4 + 0.3 * (hit / Math.max(1, core.length)));
    }
    return best && bs >= 0.4 ? { entry: best, score: bs } : null;
  }

  // ------------------------------------------------------------------ tickers
  function addTicker(inst, fn, o) {
    const tk = { fn, inst, dead: false, every: o && o.every ? o.every : 0, acc: 0 };
    S.tickers.push(tk);
    return tk;
  }
  function stepTickers(dt, t) {
    const T = S.tickers;
    for (let i = T.length - 1; i >= 0; i--) {
      const tk = T[i];
      if (tk.dead) { T[i] = T[T.length - 1]; T.pop(); continue; }
      try {
        if (tk.every > 0) { tk.acc += dt; if (tk.acc < tk.every) continue; const d = tk.acc; tk.acc = 0; if (tk.fn(d, t) === true) tk.dead = true; }
        else if (tk.fn(dt, t) === true) tk.dead = true;
      } catch (err) { console.error(`[library] ${tk.inst ? tk.inst.name : '?'} update failed; disabled`, err); tk.dead = true; }
    }
  }

  // ------------------------------------------------------------------ gear/attachment helpers for kit actors
  function partsOf(a) {
    if (a.parts) return a.parts;
    const ch = a.pivot.children, P = { pivot: a.pivot, group: a.group };
    if (a.kind === 'humanoid' && ch.length >= 6 && ch[5].isGroup) Object.assign(P, { legL: ch[0], legR: ch[1], armL: ch[2], armR: ch[3], torso: ch[4], head: ch[5] });
    else if (a.kind === 'creature' && ch.length >= 4 && ch[2].isGroup && ch[3].isGroup) Object.assign(P, { body: ch[0], head: ch[2], tail: ch[3] });
    a.parts = P;
    return P;
  }
  // put an object on a body part; (x,y,z) in units of the reference body (1.7 m person / 0.8 m creature), scaled to this actor
  function gear(a, slot, obj, x = 0, y = 0, z = 0, s = 1, rot) {
    if (a.mdl && !a.mdl.fell) { if (a.gear) a.gear(slot, obj, x, y, z, s, rot); return obj; } // model body: head / pivot gear rides on the head bone / body, other slots are not available
    const P = partsOf(a), par = P[slot] || P.pivot, k = (a.k0 ?? 1) * s;
    obj.position.set(x * (a.k0 ?? 1), y * (a.k0 ?? 1), z * (a.k0 ?? 1));
    obj.scale.multiplyScalar(k);
    if (rot) { if (typeof rot === 'number') obj.rotation.y = rot; else obj.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0); }
    par.add(obj);
    return obj;
  }

  // ------------------------------------------------------------------ draw-call diet for kit actors
  // kit.humanoid / kit.creature build ~15 meshes per actor. Their parts that never move relative to each other (limb + hand/shoe, head + eyes + hair + hat,
  // creature body + belly) are baked into ONE vertex-coloured mesh each, which cuts an actor to ~6-7 draw calls. The hit-flash is re-pointed at the new material.
  const SRC = new Map();
  function srcOf(geo) {
    let s = SRC.get(geo.uuid);
    if (!s) { const g = geo.index ? geo.toNonIndexed() : geo; s = { pos: g.attributes.position.array, nor: g.attributes.normal.array }; if (g !== geo) g.dispose(); SRC.set(geo.uuid, s); }
    return s;
  }
  // Only meshes that are always visible and are not a stump are merged: a stump (hidden until a limb comes off) must stay its own object, and
  // merging happens strictly WITHIN one limb group (slim() walks pivot + each limb group separately), so a severable limb stays a separate object.
  function mergeMeshes(parent, mat, skip) {
    const list = parent.children.filter((c) => c.isMesh && c.material && c.material.color && c.visible !== false && !(skip && skip.has(c)));
    if (list.length < 2) return null;
    const pos = [], nor = [], col = [];
    for (const m of list) {
      m.updateMatrix(); _m.copy(m.matrix); _n3.getNormalMatrix(_m);
      const s = srcOf(m.geometry), c = m.material.color;
      for (let i = 0; i < s.pos.length; i += 3) {
        _v.set(s.pos[i], s.pos[i + 1], s.pos[i + 2]).applyMatrix4(_m); pos.push(_v.x, _v.y, _v.z);
        _v.set(s.nor[i], s.nor[i + 1], s.nor[i + 2]).applyMatrix3(_n3).normalize(); nor.push(_v.x, _v.y, _v.z);
        col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    for (const m of list) parent.remove(m);
    parent.add(new THREE.Mesh(g, mat));
    return g;
  }
  function slim(a) {
    if (a.mdl && !a.mdl.fell) return a; // model-backed actors are already 1-3 draw calls; nothing to merge
    partsOf(a); // remember the part layout before touching it
    const mat = ownMat('solid'), geos = [];
    const skip = new Set();
    if (a.T) { for (const k of a.T.names) { const L = a.T.limbs[k]; if (L && L.stump) skip.add(L.stump); } if (a.T.waist) skip.add(a.T.waist); }
    const groups = [a.pivot, ...a.pivot.children.filter((c) => c.isGroup)];
    for (const g of groups) { const r = mergeMeshes(g, mat, skip); if (r) geos.push(r); }
    if (a.damage && a.damage.mats) a.damage.mats = [{ m: mat, e: mat.emissive.clone() }];
    a.libGeos = geos; a.libMat = mat;
    return a;
  }
  // ------------------------------------------------------------------ identity + population budget (world.perf)
  // IDENTITY: every actor / fighter of an entry carries the ENTRY name (quests match combat:kill victim.name, voices read actor.role); the `name` option is a nickname.
  function identify(inst, a, nick) {
    const n = inst.entry.name;
    a.role = n;
    if (!a.name || a.name === 'villager' || a.name === 'creature' || (a.mdl && a.name === a.mdl.name)) a.name = n; // keep a name somebody else chose
    if (nick === undefined) nick = inst.o && inst.o.name;
    if (typeof nick === 'string' && nick && nick !== n) { a.nick = nick; if (!a.npcName) a.npcName = nick; }
    if (a.group && a.group.userData) a.group.userData.libName = n;
    return a;
  }
  const dens = () => clamp(ctx.quality?.density ?? 1, 0.25, 1); // crowd / particle scale: only ever fewer than asked, read at spawn/emit time
  // allowN(kind, n) -> how many of n units of 'fighters' | 'actors' | 'bodies' may spawn now: perf.allow, else perf.canSpawn (yes/no, so search the largest n that fits),
  // else (bodies only) physics.canSpawn. Without any of them: n.
  function allowN(kind, n) {
    n = Math.max(0, n | 0);
    if (n === 0) return 0;
    const W = ctx.world, P = W.perf;
    try {
      if (P && typeof P.allow === 'function') { const k = P.allow(kind, n); return k >= 0 ? Math.min(n, k | 0) : n; }
      if (P && typeof P.canSpawn === 'function') { for (let m = n; m > 0; m--) if (P.canSpawn(kind, m)) return m; return 0; }
      if (kind === 'bodies' && W.physics && typeof W.physics.canSpawn === 'function') return W.physics.canSpawn() ? n : 0;
    } catch (err) { /* a service is mid-reload: do not block spawning */ }
    return n;
  }
  const plural = (w, n) => { w = String(w).replace(/-/g, ' '); return n === 1 ? w : /(s|x|ch|sh)$/.test(w) ? w + 'es' : /fe?$/.test(w) ? w.replace(/fe?$/, 'ves') : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'; };
  function tell(text) { // one HUD line per distinct message every 2 s (a scenario may trim dozens of members)
    const t = ctx.clock ? ctx.clock.t : 0;
    if (!ctx.hud || !ctx.hud.show || (S.tellText === text && t - (S.tellT ?? -9) < 2)) return;
    S.tellText = text; S.tellT = t; ctx.hud.show(text, 3.5);
  }
  const POP = { enemies: 'fighters', allies: 'fighters', life: 'actors', props: 'bodies' }; // what an entry of a category puts on the budget (entry.pop overrides; null = nothing)
  const popOf = (e) => (e.pop !== undefined ? e.pop : POP[e.category] || null);

  // ------------------------------------------------------------------ instances
  let seq = 0;
  function makeInst(entry, c, o, parent) {
    const inst = {
      id: ++seq, name: entry.name, entry, ctx: c, o, parent, removed: false,
      x: o.x ?? 0, z: o.z ?? 0, y: o.y ?? 0, yaw: o.yaw ?? 0, scale: o.scale ?? 1, rng: rng((Math.random() * 1e9) | 0),
      group: new THREE.Group(), _actors: [], _fighters: [], _children: [], _cleanups: [], _tk: [], _bodies: [], _objs: [],
    };
    inst.group.name = `lib:${entry.name}`;
    inst.group.position.set(inst.x, inst.y, inst.z);
    inst.group.rotation.y = inst.yaw;
    (c.root ?? ctx.root).add(inst.group);
    S.insts.add(inst);
    const cos = Math.cos(inst.yaw), sin = Math.sin(inst.yaw);
    // local (lx, lz) -> world x/z  (local +Z is the instance's front)
    inst.wx = (lx, lz) => inst.x + lx * cos + lz * sin;
    inst.wz = (lx, lz) => inst.z - lx * sin + lz * cos;
    inst.at = (lx, lz) => ({ x: inst.x + lx * cos + lz * sin, z: inst.z - lx * sin + lz * cos });
    inst.gy = (lx, lz) => ground(inst.wx(lx, lz), inst.wz(lx, lz));
    inst.add = (obj) => { inst.group.add(obj); return obj; };
    inst.track = (obj) => { inst._objs.push(obj); return obj; }; // an object that lives elsewhere in the scene but belongs to this instance
    inst.cleanup = (fn) => { inst._cleanups.push(fn); return fn; };
    inst.tick = (fn, o2) => { const tk = addTicker(inst, fn, o2); inst._tk.push(tk); return tk; };
    inst.snd = () => sfx(c);
    inst.expire = (sec) => { let left = sec; inst.tick((dt) => { left -= dt; if (left <= 0) { inst.remove(); return true; } }); };
    inst.burst = (kind, hex, at, n, scale, vel) => burst(c, kind, hex, at, n, scale, vel);
    // kit wrappers that remember what to undo on explicit remove() (kit itself cleans up with the caller)
    inst.fx = (po) => { const K = kit(); if (!K) return null; if (po && po.count > 8) { const d = dens(); if (d < 1) po = { ...po, count: Math.max(8, Math.round(po.count * d)) }; } const e = K.particles(c, po); inst._cleanups.push(() => e.dispose()); return e; };
    inst.light = (lo) => { const K = kit(); if (!K) return null; const l = K.light(c, lo); inst._cleanups.push(() => l.remove()); return l; };
    inst.label = (text, lo) => { const K = kit(); if (!K) return null; const l = K.label(c, text, lo); inst._cleanups.push(() => l.remove()); return l; };
    inst.body = (mesh, bo) => { const K = kit(); if (!K) return null; const b = K.body(c, mesh, bo); inst._bodies.push(b); inst._cleanups.push(() => b.remove()); return b; };
    inst.dmg = (obj, dop) => { const K = kit(); if (!K) return null; const d = K.damageable(c, obj, dop); inst._cleanups.push(() => d.remove()); return d; };
    inst.person = (po = {}) => {
      const K = kit(); if (!K) return null;
      const h = po.height ?? 1.7;
      const a = K.humanoid(c, {
        height: h, skin: po.skin, shirt: po.shirt, pants: po.pants, hair: po.hair, hat: po.hat, speed: po.speed, hp: po.hp,
        x: po.x ?? inst.x, z: po.z ?? inst.z, yaw: po.yaw ?? inst.yaw, faction: po.faction, damageable: po.damageable, onHit: po.onHit, onDeath: po.onDeath,
        model: po.model, bulk: po.bulk, tall: po.tall, gore: po.gore, wscale: po.wscale,
      });
      a.h0 = h; a.k0 = h / 1.7;
      identify(inst, a);
      // primitive bodies get the draw-call diet and the bulk scale; model bodies do both themselves (and do it for the primitive fallback through whenPrimitive)
      a.whenPrimitive((pa) => { if (po.merge !== false) slim(pa); if (po.bulk) pa.pivot.scale.set(po.bulk, po.tall ?? 1, po.bulk); });
      inst._actors.push(a);
      return a;
    };
    inst.creature = (po = {}) => {
      const K = kit(); if (!K) return null;
      const L = po.size ?? 0.8;
      const a = K.creature(c, {
        legs: po.legs, size: L, bodyColor: po.color ?? po.bodyColor, accent: po.accent, eyeColor: po.eyeColor, speed: po.speed, hp: po.hp,
        x: po.x ?? inst.x, z: po.z ?? inst.z, yaw: po.yaw ?? inst.yaw, faction: po.faction, damageable: po.damageable, onHit: po.onHit, onDeath: po.onDeath,
        model: po.model, bulk: po.bulk, tall: po.tall, gore: po.gore,
      });
      a.h0 = L; a.k0 = L / 0.8;
      identify(inst, a);
      a.whenPrimitive((pa) => { if (po.merge !== false) slim(pa); if (po.bulk) pa.pivot.scale.set(po.bulk, po.tall ?? 1, po.bulk); });
      inst._actors.push(a);
      return a;
    };
    inst.fight = (a, fo) => {
      const C = combat();
      if (!C || !a) return null;
      fo = fo || {};
      const nick = fo.name ?? (inst.o && inst.o.name);
      const f = C.fighter(c, a, { ...fo, name: entry.name }); // quests match fighter.name: always the ENTRY name; the nickname goes to f.label / a.nick
      if (f) {
        f.libName = entry.name;
        if (typeof nick === 'string' && nick && nick !== entry.name) f.label = nick;
        identify(inst, a, nick);
        inst._fighters.push(f);
      }
      return f;
    };
    // spawn another library entry as part of this one. opts.lx / lz are LOCAL offsets (rotated by this instance's yaw).
    inst.sub = (name, so = {}) => {
      const m = find(name); if (!m) return null;
      const o2 = { ...so, noPush: true };
      if (so.lx !== undefined || so.lz !== undefined) { const w = inst.at(so.lx ?? 0, so.lz ?? 0); o2.x = w.x; o2.z = w.z; }
      else { o2.x = so.x ?? inst.x; o2.z = so.z ?? inst.z; }
      if (so.yaw !== undefined) o2.yaw = so.yaw + (so.worldYaw ? 0 : inst.yaw);
      delete o2.lx; delete o2.lz;
      const h = spawnEntry(c, m.entry, o2, inst);
      return h;
    };
    inst.remove = () => {
      if (inst.removed) return;
      inst.removed = true;
      for (const ch of inst._children.slice()) ch.remove();
      for (const f of inst._fighters) { try { f.remove(); } catch (err) { /* gone */ } }
      for (const a of inst._actors) { try { a.remove(); } catch (err) { /* gone */ } if (a.libGeos) { for (const g of a.libGeos) g.dispose(); a.libGeos = null; } }
      for (let i = inst._cleanups.length - 1; i >= 0; i--) { try { inst._cleanups[i](); } catch (err) { console.error('[library] cleanup failed', err); } }
      for (const tk of inst._tk) tk.dead = true;
      inst.group.removeFromParent(); disposeOwn(inst.group);
      S.insts.delete(inst);
      if (inst.parent) { const i = inst.parent._children.indexOf(inst); if (i >= 0) inst.parent._children.splice(i, 1); }
    };
    // public handle
    const handle = {
      name: entry.name, inst,
      get objects() { const r = [inst.group, ...inst._objs]; for (const a of inst._actors) r.push(a.group); for (const ch of inst._children) r.push(...ch.handle.objects); return r; },
      get actors() { const r = inst._actors.slice(); for (const ch of inst._children) r.push(...ch.handle.actors); return r; },
      get fighters() { const r = inst._fighters.slice(); for (const ch of inst._children) r.push(...ch.handle.fighters); return r; },
      get items() { return inst._children.map((ch) => ch.handle); },
      get position() { return inst.group.position; },
      get removed() { return inst.removed; },
      get alive() { let n = 0; for (const f of handle.fighters) if (f.alive) n++; return n; },
      remove: () => inst.remove(),
    };
    inst.handle = handle;
    if (parent) parent._children.push(inst);
    return inst;
  }

  // ------------------------------------------------------------------ placement
  const _f = { x: 0, z: -1 };
  function forwardFlat() {
    const f = ctx.player.forward; let x = f.x, z = f.z; const l = Math.hypot(x, z);
    if (l < 0.25) { const r = ctx.rig.rotation.y; x = -Math.sin(r); z = -Math.cos(r); } else { x /= l; z /= l; }
    _f.x = x; _f.z = z; return _f;
  }
  function xz(p) { if (!p) return null; if (Array.isArray(p)) return { x: p[0], z: p[2] ?? p[1] }; return { x: p.x, z: p.z }; }
  function resolveCenter(entry, o) {
    const p = xz(o.position);
    if (p) return p;
    if (o.x !== undefined || o.z !== undefined) return { x: o.x ?? head.x, z: o.z ?? head.z - 5 };
    const f = forwardFlat(), d = o.distance ?? entry.distance ?? (entry.size ? Math.max(5, entry.size + 4) : 5);
    return { x: head.x + f.x * d, z: head.z + f.z * d };
  }
  function pushOut(x, z, min) {
    const dx = x - head.x, dz = z - head.z, d = Math.hypot(dx, dz);
    if (d >= min) return [x, z];
    if (d < 0.05) { const f = forwardFlat(); return [head.x + f.x * min, head.z + f.z * min]; }
    return [head.x + (dx / d) * min, head.z + (dz / d) * min];
  }

  // ------------------------------------------------------------------ spawn
  function toOpts(o) { return o && typeof o === 'object' ? o : {}; }
  function spawnEntry(c, entry, opts, parent, requested) {
    const o0 = toOpts(opts);
    const want = entry.ownCount ? 1 : Math.max(1, Math.min(Math.floor(o0.count) || 1, entry.maxCount ?? 80));
    let n = want;
    const pop = popOf(entry); // population budget (world.perf): fighters and actors always, loose bodies only for crowds of them
    if (pop && !entry.ownCount && (pop !== 'bodies' || want > 1)) {
      n = allowN(pop, want);
      if (n < want) tell(n > 0 ? `Spawned ${n} of ${want} ${plural(entry.name, want)} to keep the frame rate` : `Too much on screen: no ${plural(entry.name, 2)} spawned, to keep the frame rate`);
      if (n < 1) return null;
    }
    const center = (o0.noPush && o0.x !== undefined) ? { x: o0.x, z: o0.z } : resolveCenter(entry, o0);
    const keep = o0.noPush ? 0 : (o0.keepOut ?? entry.keepOut ?? (entry.noPush ? 0 : Math.max(2, (entry.size ?? 0.6) + 1.2)));
    const spread = o0.spread ?? entry.spread ?? Math.max(2, Math.sqrt(n) * (entry.spacing ?? 1.6));
    const place = (i) => {
      let x = center.x, z = center.z;
      if (n > 1) {
        const r = spread * Math.sqrt((i + 0.5) / n), a = i * 2.39996 + (o0.seed ?? 0) + rand(-0.25, 0.25);
        x += Math.cos(a) * r; z += Math.sin(a) * r;
      }
      if (keep > 0) [x, z] = pushOut(x, z, keep);
      return [x, z];
    };
    const mkOne = (i, reg) => {
      const [x, z] = place(i);
      let yaw = o0.yaw;
      if (yaw === undefined) {
        const face = entry.face ?? 'player';
        yaw = face === 'player' ? Math.atan2(head.x - x, head.z - z) + (n > 1 ? rand(-0.4, 0.4) : 0) : face === 'away' ? Math.atan2(x - head.x, z - head.z) : face === 'random' ? rand(0, TAU) : 0;
      }
      const big = (entry.size ?? 0) > 2.2;
      let y = ground(x, z);
      if (big) { const r = entry.size * 0.6; y = Math.min(y, ground(x + r, z), ground(x - r, z), ground(x, z + r), ground(x, z - r)); }
      const o = { ...o0, x, z, y, yaw, scale: o0.scale ?? 1, index: i, count: entry.ownCount ? o0.count : n };
      delete o.position;
      const inst = makeInst(entry, c, o, null);
      const mark = entry.custom ? new Set(combat()?.fighters ?? []) : null;
      try { entry.build(inst, o, i); }
      catch (err) { console.error(`[library] building "${entry.name}" failed`, err); inst.remove(); return null; }
      if (mark) { // lib.define entries that call combat.fighter themselves still get the entry name and own the fighter
        for (const f of combat()?.fighters ?? []) {
          if (mark.has(f) || f.libName) continue;
          const nick = f.name; f.name = f.libName = entry.name; if (nick && nick !== entry.name) f.label = nick;
          if (f.actor) identify(inst, f.actor, nick);
          inst._fighters.push(f);
        }
      }
      if (reg) c.onDispose(() => inst.remove());
      if (entry.groupScale && o.scale && o.scale !== 1) inst.group.scale.setScalar(o.scale);
      if (o0.rise) enterAnim(inst);
      return inst;
    };
    let top;
    if (n === 1) {
      top = mkOne(0, !parent);
      if (!top) return null;
      if (parent) { parent._children.push(top); top.parent = parent; }
    } else {
      const um = makeInst({ name: entry.name, category: entry.category }, c, { x: center.x, z: center.z, y: ground(center.x, center.z) }, parent);
      um.group.name = `lib:${entry.name}*${n}`;
      for (let i = 0; i < n; i++) { const ch = mkOne(i, false); if (ch) { ch.parent = um; um._children.push(ch); } }
      if (!parent) c.onDispose(() => um.remove());
      top = um;
    }
    const h = top.handle;
    h.count = n;
    if (n < want) h.trimmed = want - n;
    if (requested && norm(requested) !== norm(entry.name)) h.requested = requested;
    return h;
  }
  function spawn(c, name, opts) {
    if (!c || !c.onDispose) throw new Error('library.spawn(ctx, name, opts): pass your creation\'s ctx first');
    const m = find(name);
    if (!m) return null;
    return spawnEntry(c, m.entry, opts, null, name);
  }

  // entrance: grow out of the ground with dust, used by waves and rise:true
  function enterAnim(inst) {
    const list = [];
    for (const a of inst._actors) list.push(a);
    for (const a of list) {
      const g = a.group; let t = 0; const dur = 0.85;
      g.scale.y = 0.02;
      burst(inst.ctx, 'puff', 0x6b5a44, _p.set(a.position.x, a.position.y + 0.2, a.position.z), 7, 0.7);
      inst.tick((dt) => {
        if (a.removed || a.dead) { g.scale.y = 1; return true; }
        t += dt;
        const k = Math.min(1, t / dur);
        g.scale.y = Math.max(0.02, ease.out(k));
        if (k >= 1) { g.scale.y = 1; return true; }
      });
    }
    for (const f of inst._fighters) f.atkCd = Math.max(f.atkCd, 1.1);
  }

  // ------------------------------------------------------------------ custom actor ("mob") compatible with combat.fighter
  const DEATH = {
    fall: (a, k) => { a.pivot.rotation.z = a.side * 1.5 * ease.out(k); a.pivot.position.y = -a.height * 0.05 * k; },
    sink: (a, k) => { a.pivot.position.y = -a.height * 1.05 * ease.inOut(k); },
    melt: (a, k) => { const s = ease.out(k); a.pivot.scale.set(1 + 0.6 * s, 1 - 0.92 * s, 1 + 0.6 * s); },
    collapse: (a, k) => { const s = ease.out(k); a.pivot.scale.y = 1 - 0.75 * s; a.pivot.rotation.z = a.side * 0.2 * s; a.pivot.position.y = -a.height * 0.1 * s; },
    fade: (a, k) => {
      if (!a._fm) { a._fm = []; a.pivot.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m.userData.own) { m.transparent = true; if (m.userData.o0 === undefined) m.userData.o0 = m.opacity; a._fm.push(m); } }); }
      for (const m of a._fm) m.opacity = m.userData.o0 * (1 - k);
    },
    crash: (a, k, dt) => { a.vy -= 14 * dt; a.pivot.rotation.z += dt * 4 * a.side; a.pivot.rotation.x += dt * 1.5; },
    none: () => {},
  };
  function createMob(inst, s) {
    const c = inst.ctx, K = kit();
    const group = new THREE.Group(), pivot = new THREE.Group();
    group.add(pivot);
    const a = {
      kind: 'custom', group, pivot, position: group.position, speed: s.speed ?? 2, legMul: 1, stride: s.stride ?? 4, anim: noop,
      eyeH: s.eyeH ?? (s.height ?? 1.5) * 0.8, yaw: s.yaw ?? inst.yaw, speedNow: 0, phase: 0, seed: rand(0, 20), placed: false,
      hasGoal: false, gx: 0, gz: 0, followTarget: null, followDist: 2, lookTarget: null, lookYaw: 0, lookPitch: 0,
      wanderOn: false, wr: 5, wcx: 0, wcz: 0, wtimer: 0, arriveFn: null, waveT: 0, sayT: 0, label: null, kx: 0, kz: 0,
      dead: false, deadT: 0, removed: false, damage: null, height: s.height ?? 1.5, held: null,
      atkT: -1, atkW: 0.4, atkKind: 'melee', atkRaise: 0, atkSwing: 0, faceT: 0, faceX: 0, faceZ: 0, _faction: s.faction,
      hover: s.hover ?? 0, bob: s.bob ?? 0, bobF: s.bobF ?? 2, knock: s.knock ?? 1, lifeAfter: s.lifeAfter ?? 2.5,
      deathStyle: s.death ?? 'fall', vy: 0, side: Math.random() < 0.5 ? -1 : 1, fadeMats: [], k0: s.k0 ?? 1, h0: s.height ?? 1.5, ctx: c, inst, spec: s, flying: !!s.flying,
      noFace: !!s.noFace, staggerT: 0, stg: false, ch: null, chRetry: 0, obsR: s.radius ?? 0.4, armor: !!s.armor, roofY: -1e9, roofT: 0, role: '', name: null,
    };
    identify(inst, a);
    Object.defineProperty(a, 'faction', { get: () => (a.damage ? a.damage.faction : a._faction), set: (v) => { a._faction = v; if (a.damage) a.damage.faction = v; }, enumerable: true, configurable: true });
    Object.defineProperty(a, 'moving', { get: () => a.speedNow > 0.15, configurable: true });
    Object.defineProperty(a, 'attacking', { get: () => a.atkT >= 0, configurable: true });
    Object.defineProperty(a, 'strikeT', { get: () => (a.atkT >= a.atkW ? Math.min(1, (a.atkT - a.atkW) / 0.16) : 0), configurable: true });
    a.equip = (o) => { const p = a.held; a.held = o || null; return p; };
    a.faceTo = (v, sec = 0.35) => { if (v) { a.faceX = v.x; a.faceZ = v.z; a.faceT = sec; } return a; };
    a.attackAnim = (w = 0.4, kind) => { if (a.dead) return 0; a.atkW = Math.max(0.05, w); a.atkT = 0; a.atkKind = kind ?? 'melee'; return a.atkW + 0.5; };
    a.walkTo = (x, z) => { if (x && typeof x === 'object') { z = x.z; x = x.x; } a.gx = x; a.gz = z; a.hasGoal = true; a.followTarget = null; return a; };
    a.stop = () => { a.hasGoal = false; a.followTarget = null; return a; };
    a.follow = (t, d = 2) => { a.followTarget = t || null; a.followDist = d; if (t) a.hasGoal = false; return a; };
    a.lookAt = (v) => { a.lookTarget = v || null; return a; };
    a.wave = (sec = 2) => { a.waveT = sec; return a; };
    a.setSpeed = (v) => { a.speed = v; return a; };
    a.onArrive = (fn) => { a.arriveFn = fn; return a; };
    a.wander = (r = 5, ctr) => { a.wanderOn = r > 0; a.wr = r; a.wcx = ctr ? ctr.x : group.position.x; a.wcz = ctr ? ctr.z : group.position.z; a.wtimer = rand(0.5, 2); return a; };
    a.say = (text, sec = 4) => {
      if (a.dead || !K) return a;
      if (!a.label) { a.label = K.label(c, text, { size: s.labelSize ?? 0.1, parent: group }); a.label.position.set(0, a.height + 0.25, 0); } else a.label.set(text);
      a.label.show(true); a.sayT = sec;
      return a;
    };
    a.update = noop;
    a.remove = () => {
      if (a.removed) return;
      a.removed = true;
      if (a.ch) { a.ch.remove(); a.ch = null; }
      a.label?.remove(); a.damage?.remove();
      if (a.rig && a.rig.dispose) { try { a.rig.dispose(); } catch (err) { /* gone */ } }
      group.removeFromParent(); disposeOwn(group);
    };
    a.setupDamage = (oo = {}) => {
      if (a.damage) return a.damage;
      a.damage = K.damageable(c, group, {
        hp: oo.hp ?? s.hp ?? 20, radius: s.radius ?? 0.5, offsetY: s.centerY ?? a.height * 0.5, faction: oo.faction ?? a._faction,
        onHit(e) {
          if (e.point && !a.dead && a.knock > 0) {
            const dx = group.position.x - e.point.x, dz = group.position.z - e.point.z, n = Math.sqrt(dx * dx + dz * dz) || 1, k = Math.min(e.amount * 0.25, 4) * a.knock;
            a.kx += (dx / n) * k; a.kz += (dz / n) * k;
          }
          if (a.rig && a.rig.hit && !a.dead) a.rig.hit(a);
          if (s.onHit) s.onHit(a, e);
          if (oo.onHit) oo.onHit(e);
        },
        onDeath() {
          a.dead = true; a.deadT = 0; a.hasGoal = false; a.followTarget = null; a.wanderOn = false; a.atkT = -1; a.staggerT = 0;
          if (a.ch) { a.ch.remove(); a.ch = null; }
          a.label?.show(false);
          if (a.rig && a.rig.die) a.rig.die(a);
          if (s.onDie) { try { s.onDie(a); } catch (err) { console.error('[library] onDie failed', err); } }
          if (oo.onDeath) oo.onDeath(a);
        },
      });
      a.damage.actor = a; // kit.hit(force >= 6) throws and stuns "d.actor" (a.kx / kz / staggerT), exactly like a kit actor
      return a.damage;
    };
    (inst.group.parent ?? c.root ?? ctx.root).add(group);
    group.position.set(s.x ?? inst.x, 0, s.z ?? inst.z);
    group.rotation.y = a.yaw;
    // the rig builds meshes into the pivot and returns { anim(a, dt, t, m) }
    const R = s.rig(a, pivot, inst) || {};
    a.rig = R; // a model rig (H.modelRig) also gets hit / die / dispose calls
    if (R.anim) a.anim = R.anim;
    if (s.damageable !== false) a.setupDamage(s);
    inst._actors.push(a);
    inst.tick((dt, t) => { if (a.removed) return true; stepMob(a, dt, t); });
    return a;
  }
  // Walkers (not flyers / hoverers) within 40 m of the player move through a Rapier kinematic character controller like kit actors: blocking scenery stops
  // them, they step over curbs. Beyond the characters cap (10 quest / 28 pc) or far away they keep the plain steering. spec.walls === false opts out.
  function mobWalk(a, p) {
    const Py = ctx.world.physics;
    if (!Py || !Py.character || a.spec.walls === false) return;
    const dx0 = p.x - head.x, dz0 = p.z - head.z;
    if (dx0 * dx0 + dz0 * dz0 > 1600) { if (a.ch) { a.ch.remove(); a.ch = null; } return; }
    let ch = a.ch;
    if (ch && ch.removed) a.ch = ch = null;
    if (!ch) {
      if (a.chRetry > ctx.clock.t) return;
      ch = a.ch = Py.character({}, { radius: clamp((a.obsR ?? 0.4) * 0.6, 0.2, 0.6), height: clamp(a.height * 0.9, 0.7, 2.2) });
      if (!ch) { a.chRetry = ctx.clock.t + 1.5; return; }
      ch.teleport(p.x, ground(p.x, p.z) + 0.02, p.z);
      return;
    }
    const mx = p.x - ch.position.x, mz = p.z - ch.position.z, gy = ground(p.x, p.z);
    if (mx * mx + mz * mz > 9) { ch.teleport(p.x, gy + 0.02, p.z); return; }
    ch.move(mx, clamp(gy - ch.position.y, -0.6, 0.6), mz);
    p.x = ch.position.x; p.z = ch.position.z;
  }
  // Flyers do not walk: they just stay above whatever solid scenery is under them (one ray down every ~0.3 s)
  const _dn = { x: 0, y: -1, z: 0 }, _ro = { x: 0, y: 0, z: 0 };
  function clearScenery(a, p, t) {
    const Py = ctx.world.physics;
    if (!Py || !Py.raycast) { a.roofY = -1e9; return; }
    if (t < a.roofT) return;
    a.roofT = t + 0.3 + (a.seed % 1) * 0.1;
    const gy = ground(p.x, p.z);
    _ro.x = p.x; _ro.y = gy + 40; _ro.z = p.z;
    const h = Py.raycast(_ro, _dn, 60, { groups: 'world' });
    a.roofY = h && h.kind !== 'ground' && h.point.y > gy + 0.6 ? h.point.y : -1e9;
  }
  function stepMob(a, dt, t) {
    const g = a.group, p = g.position;
    const gy = ground(p.x, p.z);
    if (!a.placed) { p.y = gy + a.hover; a.placed = true; }
    if (a.dead) {
      a.deadT += dt;
      const k = Math.min(1, a.deadT / Math.min(1.2, a.lifeAfter));
      const fn = DEATH[a.deathStyle] || DEATH.fall;
      fn(a, k, dt);
      if (a.deathStyle === 'crash') { p.y = Math.max(gy, p.y + a.vy * dt); if (p.y <= gy) a.pivot.position.y = 0; }
      else p.y += (gy - p.y) * Math.min(1, dt * 8);
      if (a.deadT > a.lifeAfter) { const sc = 1 - (a.deadT - a.lifeAfter) / 0.7; if (sc <= 0) { a.remove(); return; } g.scale.setScalar(sc); }
      return;
    }
    if (a.kx !== 0 || a.kz !== 0) {
      p.x += a.kx * dt; p.z += a.kz * dt;
      const k = Math.exp(-7 * dt); a.kx *= k; a.kz *= k;
      if (Math.abs(a.kx) + Math.abs(a.kz) < 0.02) a.kx = a.kz = 0;
    }
    let want = 0, tx = 0, tz = 0, face = false;
    const ft = a.followTarget;
    if (ft) {
      const dx = ft.x - p.x, dz = ft.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > a.followDist) { want = d > a.followDist + 4 ? a.speed * 1.8 : a.speed; if (d < a.followDist + 0.8) want *= 0.6; tx = ft.x; tz = ft.z; face = true; }
    } else if (a.hasGoal) {
      const dx = a.gx - p.x, dz = a.gz - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.12) { a.hasGoal = false; if (a.arriveFn) { try { a.arriveFn(a); } catch (err) { console.error(err); } } }
      else { want = a.speed * Math.min(1, 0.35 + d); tx = a.gx; tz = a.gz; face = true; }
    } else if (a.wanderOn && !a.lookTarget) {
      a.wtimer -= dt;
      if (a.wtimer <= 0) { const ang = Math.random() * TAU, r = Math.sqrt(Math.random()) * a.wr; a.walkTo(a.wcx + Math.cos(ang) * r, a.wcz + Math.sin(ang) * r); a.wtimer = rand(3, 8); }
    }
    want *= a.legMul;   // composed speed multiplier (see speedMul): slow / haste / flee / rage, all multiply into this one number; a.speed stays the base
    if (a.staggerT > 0) { // thrown back by a heavy blow (kit.hit force >= 6 -> kit knockActor): stunned like a kit actor, combat.js waits too
      if (a.armor) a.staggerT = 0;
      else {
        if (!a.stg) { a.stg = true; const kf = Math.min(1, 0.35 + a.knock); a.kx *= kf; a.kz *= kf; } // heavies are shoved less
        a.staggerT -= dt; want = 0; a.atkT = -1; a.atkRaise = a.atkSwing = 0;
      }
    } else a.stg = false;
    a.speedNow += (want - a.speedNow) * Math.min(1, dt * 6);
    let yawT = a.yaw, turn = false, diff = 0, rate = 5;
    if (a.faceT > 0) { a.faceT -= dt; const fx = a.faceX - p.x, fz = a.faceZ - p.z; if (fx * fx + fz * fz > 0.0004) { yawT = Math.atan2(fx, fz); turn = true; rate = 9; } }
    else if (face) { yawT = Math.atan2(tx - p.x, tz - p.z); turn = true; }
    else if (a.lookTarget) { const lx = a.lookTarget.x - p.x, lz = a.lookTarget.z - p.z; if (lx * lx + lz * lz > 0.04) { yawT = Math.atan2(lx, lz); turn = true; } }
    if (a.atkT >= 0) {
      a.atkT += dt;
      const W = a.atkW, u = a.atkT;
      if (u < W) { const r = u / W; a.atkRaise = r * r * (3 - 2 * r); a.atkSwing = 0; }
      else if (u < W + 0.16) { const s2 = (u - W) / 0.16; a.atkRaise = 1 - s2; a.atkSwing = s2; }
      else if (u < W + 0.5) { a.atkRaise = 0; a.atkSwing = 1 - ease.inOut((u - W - 0.16) / 0.34); }
      else { a.atkT = -1; a.atkRaise = a.atkSwing = 0; }
    }
    if (turn) {
      diff = wrapAng(yawT - a.yaw);
      const mx = rate * dt;
      a.yaw += diff < -mx ? -mx : diff > mx ? mx : diff;
      g.rotation.y = a.yaw;
      diff = wrapAng(yawT - a.yaw);
    }
    if (a.speedNow > 0.01) {
      const f = a.speedNow * Math.max(0, 1 - Math.abs(diff) / 1.1);
      p.x += Math.sin(a.yaw) * f * dt; p.z += Math.cos(a.yaw) * f * dt;
    }
    const culled = g.userData.perfCulled === true || g.visible === false;   // hidden by core/perf.js (distance culler): no physics character, no animation
    if (a.flying || a.hover > 0.6) { if (!culled) clearScenery(a, p, t); } else if (!culled) mobWalk(a, p); else if (a.ch) { a.ch.remove(); a.ch = null; }
    const ty = Math.max(ground(p.x, p.z), a.roofY ?? -1e9) + a.hover + (a.bob ? Math.sin(t * a.bobF + a.seed) * a.bob : 0);
    p.y += (ty - p.y) * Math.min(1, dt * (a.hover > 0 ? 5 : 14));
    a.phase += a.speedNow * dt * a.stride;
    if (a.waveT > 0) a.waveT -= dt;
    if (a.sayT > 0) { a.sayT -= dt; if (a.sayT <= 0 && a.label) a.label.show(false); }
    // perf (same rule as kit actors): a culled mob keeps moving and thinking but animates every 12th frame; seen ones animate every frame up close,
    // every animStride-th frame beyond 12 m, every 2nd beyond 80 m and every 3rd beyond 160 m (quality.animStride is raised by core/perf.js)
    let stride = 1;
    if (culled) stride = 12;
    else { const hx = p.x - head.x, hz = p.z - head.z, d2 = hx * hx + hz * hz, as = ctx.quality && ctx.quality.animStride > 1 ? ctx.quality.animStride : 1; stride = d2 > 25600 ? Math.max(as, 3) : d2 > 6400 ? Math.max(as, 2) : d2 > 144 ? as : 1; }
    let an = a.animN === undefined ? (a.seed | 0) % Math.ceil(stride) : a.animN;
    a.animAcc = (a.animAcc || 0) + dt;
    if (++an >= stride) {
      an = 0;
      const dtA = a.animAcc; a.animAcc = 0;
      let ly = 0, lp = 0;
      const lt = a.lookTarget;
      if (lt) {
        const dx = lt.x - p.x, dz = lt.z - p.z, hd = Math.sqrt(dx * dx + dz * dz);
        if (hd < 14) { ly = clamp(wrapAng(Math.atan2(dx, dz) - a.yaw), -1.1, 1.1); lp = clamp(Math.atan2(lt.y - (p.y + a.eyeH), Math.max(hd, 0.3)), -0.5, 0.5); }
      }
      const lk = Math.min(1, dtA * 8);
      a.lookYaw += (ly - a.lookYaw) * lk; a.lookPitch += (lp - a.lookPitch) * lk;
      a.anim(a, dtA, t, Math.min(1.5, a.speedNow / (a.speed || 1)));
    }
    a.animN = an;
  }
  // monster(inst, spec) -> { actor, fighter }. spec: rig(a, pivot, inst), height, radius, hp, speed, hover, bob, faction, fight: combat opts, ...
  // H.modelRig(candidates, primitiveRig) -> a rig function for monster(): a world.models body when a candidate resolves (also when it fails to load later),
  // else the primitive rig. The returned rig gets hit / die / mouth() (see kit.modelBody).
  function modelRig(spec, primitiveRig) {
    return (a, pivot, inst) => {
      const K = kit();
      const fb = () => { const r = primitiveRig ? primitiveRig(a, pivot, inst) || {} : {}; a.rig = r; if (r.anim) a.anim = r.anim; };
      const R = K && K.modelBody ? K.modelBody(inst.ctx, a, pivot, spec, fb) : (fb(), null);
      return R || a.rig || {};
    };
  }
  function monster(inst, s) {
    const a = createMob(inst, s);
    const f = s.fight === null ? null : inst.fight(a, { faction: s.faction ?? 'enemy', hp: s.hp, ...(s.fight || {}), name: s.name });
    return { actor: a, fighter: f };
  }

  // ------------------------------------------------------------------ shared behaviours
  const FIGHT_KEYS = ['faction', 'hp', 'damage', 'attack', 'range', 'cooldown', 'windup', 'aggroRange', 'speed', 'leash', 'follow', 'wander', 'drops', 'projectile', 'onDeath', 'name'];
  // merge per-entry defaults with the caller's overrides (faction, hp, damage, ...)
  function fightOpts(o, d) {
    const r = { ...d };
    for (const k of FIGHT_KEYS) if (o[k] !== undefined) r[k] = o[k];
    return r;
  }
  function greeter(inst, a, lines, go = {}) {
    const R2 = (go.radius ?? 3.5) ** 2, out = (go.leave ?? 6.5) ** 2;
    let on = false, cd = rand(0, 3), li = (Math.random() * lines.length) | 0;
    inst.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      const dx = head.x - a.position.x, dz = head.z - a.position.z, d2 = dx * dx + dz * dz;
      if (!on && d2 < R2 && t > cd) {
        on = true; a.lookAt(head); a.stop();
        if (go.wave !== false) a.wave?.(2);
        a.say(lines[li++ % lines.length], 4.5);
        if (go.onGreet) go.onGreet(a);
      } else if (on && d2 > out) { on = false; a.lookAt(null); cd = t + (go.cooldown ?? 10); }
    }, { every: 0.15 });
  }
  // on being hurt: shout, then run away from the attacker for a few seconds
  // speedMul(actor, key, factor): the ONLY way library code changes how fast an actor moves. a.speed stays the base number (combat.js / kit setSpeed own it);
  // every effect (flee, haste, slow, rage, a spell's freeze) is a NAMED factor and they multiply: the actor's kit.js `legMul` (kit multiplies it into the walk
  // speed, and rewrites it itself when legs are lost) becomes base legMul x all named factors. factor 1 / undefined removes the key. 0 = rooted.
  // Works on kit humanoids / creatures and on library mobs; returns the actor. Reading actor.legMul gives the combined number.
  function speedMul(a, key, f) {
    if (!a || a.removed) return a;
    let T = a._sm;
    if (!T) {
      if (f === undefined || f === null || f === 1) return a;
      T = a._sm = { m: new Map(), base: a.legMul === undefined ? 1 : a.legMul, prod: 1 };
      Object.defineProperty(a, 'legMul', { configurable: true, enumerable: true, get: () => T.base * T.prod, set: (v) => { T.base = v; } });
    }
    if (f === undefined || f === null || f === 1) T.m.delete(key); else T.m.set(key, f > 0 ? f : 0);
    let pr = 1; for (const v of T.m.values()) pr *= v;
    T.prod = pr;
    return a;
  }
  function panic(inst, a, lines = ['Ow!', 'Help!', 'Stop that!', 'Eek!'], secs = 5) {
    let until = 0;
    inst.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      if (until && t > until) { until = 0; speedMul(a, 'panic', 1); a.stop(); }
    }, { every: 0.25 });
    return (e) => {
      if (a.dead) return;
      a.say(pick(lines), 2.5);
      const p = e && e.point;
      if (p) {
        const dx = a.position.x - p.x, dz = a.position.z - p.z, d = Math.hypot(dx, dz) || 1;
        speedMul(a, 'panic', 2.4); a.lookAt(null); a.walkTo(a.position.x + (dx / d) * 14, a.position.z + (dz / d) * 14);
        until = ctx.clock.t + secs;
      }
    };
  }
  // a small speech bubble for non-actors
  function talker(inst, obj, y = 2) {
    const K = kit(); let l = null, t0 = 0;
    inst.tick((dt, t) => { if (l && t0 > 0 && t > t0) { l.show(false); t0 = 0; } }, { every: 0.3 });
    return { say(text, secs = 3.5) { if (!K) return; if (!l) { l = inst.label(text, { size: 0.1, parent: obj }); l.position.set(0, y, 0); } else l.set(text); l.show(true); t0 = ctx.clock.t + secs; } };
  }
  // hand (or player) proximity helpers
  const hands = () => [ctx.input.left, ctx.input.right];
  function nearHand(x, y, z, r) {
    for (const h of hands()) { if (!h.connected) continue; const dx = h.position.x - x, dy = h.position.y - y, dz = h.position.z - z; if (dx * dx + dy * dy + dz * dz < r * r) return h; }
    return null;
  }
  function handPressedNear(x, y, z, r, names = ['trigger', 'squeeze']) {
    for (const h of hands()) {
      if (!h.connected) continue;
      const dx = h.position.x - x, dy = h.position.y - y, dz = h.position.z - z;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      for (const n of names) if (h.pressed(n)) return h;
    }
    return null;
  }

  // ------------------------------------------------------------------ registry + public API
  function normEntry(e) {
    if (!e || !e.name || typeof e.build !== 'function') throw new Error('library.define(name, { category, description, aliases, build(ctx, opts, lib) })');
    return { category: 'custom', description: '', aliases: [], options: '', ...e, name: String(e.name) };
  }
  function addEntry(e) { const n = normEntry(e); entries.set(n.name, n); index = null; return n; }

  let api = null;
  const lib = {
    version: 1,
    spawn,
    list: () => [...entries.values()].map((e) => ({ name: e.name, category: e.category, description: e.description, aliases: e.aliases.slice(), options: e.options })),
    has: (name) => !!find(name),
    match: (name) => { const m = find(name); return m ? { name: m.entry.name, score: m.score } : null; },
    categories: () => [...new Set([...entries.values()].map((e) => e.category))],
    byCategory: (cat) => [...entries.values()].filter((e) => e.category === cat).map((e) => e.name),
    count: () => entries.size,
    // define(name, { category, description, aliases, build(ctx, opts, lib) })  -> undo()
    // build gets the CALLER's ctx and opts { x, z, y (ground), yaw, scale, index, count, inst ... }. It may return an Object3D (added
    // under ctx.root), an array of them, or { object?, update(dt, t)?, dispose()? }.
    define(name, spec) {
      const key = String(name);
      const e = addEntry({
        ...spec, name: key, category: spec.category ?? 'custom', custom: true,
        build(inst, o) {
          const r = spec.build(inst.ctx, { ...o, inst, group: inst.group }, api ?? lib);
          adoptResult(inst, r);
        },
      });
      S.custom.set(key, { spec: { ...spec, name: key } });
      return () => { if (entries.get(key) === e) { entries.delete(key); index = null; S.custom.delete(key); } };
    },
    add: addEntry,
  };
  function adoptResult(inst, r) {
    if (!r) return;
    for (const item of Array.isArray(r) ? r : [r]) {
      if (!item) continue;
      if (item.isObject3D) { if (!item.parent) inst.group.add(item); }
      else {
        if (item.object && item.object.isObject3D && !item.object.parent) inst.group.add(item.object);
        if (typeof item.update === 'function') inst.tick((dt, t) => item.update(dt, t));
        if (typeof item.dispose === 'function') inst.cleanup(() => item.dispose());
      }
    }
  }

  // ------------------------------------------------------------------ waves
  // wave(ctx, [{ name, count }], { around, radius = 13, delay = 0.35, announce = true, onCleared })
  function wave(c, spec, wo = {}) {
    let list = [];
    if (Array.isArray(spec)) list = spec.map((s) => (typeof s === 'string' ? { name: s, count: 1 } : s));
    else if (typeof spec === 'string') list = [{ name: spec, count: 1 }];
    else if (spec && typeof spec === 'object') list = Object.entries(spec).map(([name, count]) => ({ name, count }));
    const queue = [];
    for (const s of list) {
      const m = find(s.name);
      if (!m) continue;
      for (let i = 0; i < Math.max(1, Math.min(40, Math.floor(s.count ?? 1))); i++) queue.push({ entry: m.entry, opts: s.opts });
    }
    for (let i = queue.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [queue[i], queue[j]] = [queue[j], queue[i]]; }
    // population budget: keep only as many fighters as world.perf allows (the shuffle makes the cut fair across the kinds)
    const asked = queue.length;
    let nf = 0; for (const q of queue) if (popOf(q.entry) === 'fighters') nf++;
    const okF = allowN('fighters', nf);
    if (okF < nf) { let drop = nf - okF; for (let i = queue.length - 1; i >= 0 && drop > 0; i--) if (popOf(queue[i].entry) === 'fighters') { queue.splice(i, 1); drop--; } }
    const trimmedBy = asked - queue.length;
    const ent = { name: 'wave', category: 'scenarios' };
    const around = xz(wo.around) ?? { x: head.x, z: head.z };
    const inst = makeInst(ent, c, { x: around.x, z: around.z, y: ground(around.x, around.z) }, wo.parent ?? null);
    if (!wo.parent) c.onDispose(() => inst.remove());
    const radius = Math.max(6, wo.radius ?? 13), delay = wo.delay ?? 0.35, base = Math.random() * TAU;
    let qi = 0, el = 0, cleared = false;
    const total = queue.length;
    queue.forEach((q, i) => { q.at = i * delay + 0.4; q.a = base + (i / Math.max(1, total)) * TAU + rand(-0.25, 0.25); q.r = radius * rand(0.9, 1.12); });
    if (wo.announce !== false && total) {
      const sn = sfx(c);
      for (let i = 0; i < 3; i++) sn.tone({ freq: 98 * (i ? 1.5 : 1), freqEnd: 90 * (i ? 1.5 : 1), dur: 1.4, type: 'sawtooth', vol: 0.16, delay: i * 0.05 });
      sn.noise({ dur: 1.2, filter: { type: 'lowpass', freq: 300, freqEnd: 90 }, vol: 0.4 });
      if (ctx.hud) { const names = {}; for (const q of queue) names[q.entry.name] = (names[q.entry.name] || 0) + 1; ctx.hud.show('Enemies approach: ' + Object.entries(names).map(([k, v]) => `${v} ${k}`).join(', ') + (trimmedBy ? ` (${total} of ${asked}, to keep the frame rate)` : ''), 3.5); }
    } else if (trimmedBy) tell(`Wave trimmed to ${total} of ${asked} to keep the frame rate`);
    inst.tick((dt) => {
      el += dt;
      while (qi < queue.length && queue[qi].at <= el) {
        const q = queue[qi++];
        const x = around.x + Math.cos(q.a) * q.r, z = around.z + Math.sin(q.a) * q.r;
        spawnEntry(c, q.entry, { ...(q.opts || {}), x, z, noPush: true, rise: true, yaw: Math.atan2(around.x - x, around.z - z) }, inst);
      }
      if (qi >= queue.length && !cleared) {
        let alive = 0; for (const f of inst.handle.fighters) if (f.alive) alive++;
        if (alive === 0) { cleared = true; if (wo.onCleared) { try { wo.onCleared(inst.handle); } catch (err) { console.error(err); } } }
      }
    });
    const h = inst.handle;
    Object.defineProperty(h, 'pending', { get: () => queue.length - qi });
    Object.defineProperty(h, 'cleared', { get: () => cleared });
    h.total = total;
    if (trimmedBy) h.trimmed = trimmedBy;
    return h;
  }

  // ------------------------------------------------------------------ helper bundle for the catalogue modules
  const H = {
    allow: allowN, density: dens, identify, tell,
    // particle factor: ctx.quality.density as is (PC 2.5, Quest 1, lower under load; read at emit time); H.dens(n) = n x factor, whole (fraction rolled). Crowds use H.density() (<= 1).
    densK() { const d = ctx.quality && ctx.quality.density; return d > 0 ? d : 1; },
    dens(n) { const x = n * H.densK(), f = Math.floor(x); return f + (Math.random() < x - f ? 1 : 0); },
    THREE, ctx, S, TAU, rand, pick, clamp, lerp, noop, wrapAng, smooth, ease, rng, shade, mix, kit, combat, weapons, playerApi, ground, head,
    mk, MATS, ownMat, model, assemble, disposeOwn, countDraws, burst, sfx, find, norm, lev,
    speedMul, partsOf, gear, fightOpts, greeter, panic, talker, monster, modelRig, createMob, nearHand, handPressedNear, hands, wave, enterAnim, forwardFlat, DEATH,
    addTicker, xz, makeInst, spawnEntry,
    ring(n, R, fn, a0 = 0) { for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; fn(i, Math.cos(a) * R, Math.sin(a) * R, a); } },
    scatter(n, R, fn, r = Math.random) { for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R; fn(i, Math.cos(a) * d, Math.sin(a) * d); } },
    defaultAurora: (tod) => (tod < 0.5 ? 0.95 + (0.6 - 0.95) * tod * 2 : 0.6 + (0.15 - 0.6) * (tod - 0.5) * 2),
  };

  // ------------------------------------------------------------------ catalogue
  const q = (() => { try { return new URL(import.meta.url).search; } catch (err) { return ''; } })();
  for (const f of ['gear', 'enemies', 'allies', 'life', 'weapons', 'structures', 'nature', 'effects', 'props', 'scenarios']) {
    try {
      const m = await import(`../library/${f}.js${q}`);
      m.default(lib, H);
    } catch (err) { console.error(`[library] catalogue module "${f}" failed to load`, err); }
  }
  for (const { spec } of S.custom.values()) { try { lib.define(spec.name, spec); } catch (err) { console.error(err); } }
  api = { ...lib, wave, countDraws, speedMul, stats: () => ({ entries: entries.size, instances: S.insts.size, tickers: S.tickers.length }) };
  ctx.provide('library', api);

  return {
    update(dt, t) { stepTickers(Math.min(dt, 0.05), t); if (BP.list.length) reapEmitters(dt); },
    dispose() { /* live instances stay in ctx.state and keep being stepped by the next version */ },
  };
}
