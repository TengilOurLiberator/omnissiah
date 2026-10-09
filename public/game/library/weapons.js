// library/weapons.js - one entry per built-in weapon type (created through world.weapons.create, grabbable with squeeze),
// plus weapon-rack and armory (shelf / table colliders; piles trimmed to the body budget). Without world.weapons an entry is a plain box-body prop.
// Weapons use real glTF models (world.models) when they exist, with the procedural mesh as placeholder/fallback: that lives in core/weapons.js.
export default function install(lib, H) {
  const { THREE, rand, pick, TAU } = H;
  const PI = Math.PI;
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'weapons', description, options, aliases, build, ...extra });
  const TYPES = [
    ['sword', 'steel longsword; solid all-rounder, damage scales with swing speed', ['longsword', 'broadsword', 'blade', 'sabre', 'saber', 'swords']],
    ['greatsword', 'huge two-handed blade, slow and devastating', ['great sword', 'claymore', 'zweihander', 'big sword', 'buster sword']],
    ['dagger', 'short fast blade that can also be thrown', ['knife', 'dirk', 'shiv', 'daggers', 'kunai']],
    ['axe', 'woodsman\'s axe: heavy chops, throwable', ['battle axe', 'battleaxe', 'hatchet', 'axes', 'tomahawk']],
    ['warhammer', 'heavy hammer with a ground-slam shockwave', ['hammer', 'maul', 'war hammer', 'mjolnir', 'sledgehammer', 'mallet']],
    ['spear', 'long reach spear, throwable javelin', ['javelin', 'lance', 'pike', 'trident', 'halberd', 'spears']],
    ['club', 'crude wooden club', ['cudgel', 'bat', 'baton', 'clubs', 'truncheon']],
    ['katana', 'light curved blade for fast cuts', ['samurai sword', 'ninja sword', 'katanas', 'japanese sword']],
    ['scythe', 'reaper\'s scythe with wide sweeping arcs', ['reaper', 'sickle', 'grim reaper scythe']],
    ['bow', 'hold trigger to draw, release to loose an arrow; arrows arc and stick in the ground', ['longbow', 'shortbow', 'archery bow', 'bows', 'arrow']],
    ['crossbow', 'powerful bolt thrower with a reload delay', ['crossbows', 'arbalest']],
    ['blaster', 'sci-fi energy blaster firing rapid bolts', ['laser gun', 'ray gun', 'pistol', 'gun', 'laser', 'raygun', 'phaser', 'lightsaber gun']],
    ['shotgun', 'close-range pellet spread', ['scattergun', 'boomstick', 'shotguns']],
    ['rifle', 'long-range accurate rifle', ['assault rifle', 'musket', 'rifles', 'battle rifle']],
    ['magic-staff', 'wizard\'s staff with a glowing crystal; fires arcane bolts', ['staff', 'wizard staff', 'magic staff', 'mage staff', 'staves', 'quarterstaff']],
    ['wand', 'small wand for quick magic zaps', ['magic wand', 'wands', 'stick of magic']],
    ['shield', 'hold toward attackers to block projectiles and blows', ['buckler', 'shields', 'round shield', 'defense', 'captain america']],
    ['torch', 'burning torch: light, and a little fire damage', ['flame', 'lantern torch', 'torches', 'fire stick', 'light source']],
    ['pickaxe', 'mining pick, hits hard', ['pick', 'mining pick', 'pickaxes', 'mattock']],
    ['boomerang', 'throw it and it curves back; catch it with squeeze', ['boomerangs', 'returning blade']],
    ['grenade', 'grabbing pulls the pin: 3.5 s fuse then it explodes', ['bomb', 'explosive', 'grenades', 'frag', 'dynamite', 'tnt']],
    // ---- more melee
    ['great-axe', 'two-handed double-bit great axe: slow, devastating, ground slam; throwable', ['greataxe', 'great axe', 'double axe', 'double-bladed axe', 'executioner axe', 'two handed axe', 'big axe']],
    ['mace', 'flanged iron mace: bludgeoning blows and a small ground slam', ['maces', 'flail', 'morning star', 'morningstar', 'spiked mace']],
    ['war-pick', 'reinforced miner\'s war pick: pierces armour, smashes the ground', ['war pick', 'upgraded pickaxe', 'pickaxe upgraded', 'dwarven pick', 'war pickaxe']],
    ['shovel', 'digging shovel: blunt, throwable, bangs on the ground', ['spade', 'shovels', 'digging tool', 'grave shovel', 'gravedigger shovel']],
    ['hoe', 'farmer\'s hoe: hooking pierce blows, throwable', ['garden hoe', 'farm hoe', 'hoes', 'rake']],
    ['bone-blade', 'skeleton\'s bone-wrapped curved blade: light and quick', ['skeleton blade', 'scimitar', 'skeleton sword', 'bone sword', 'bone scimitar', 'cutlass']],
    ['bone-axe', 'skeleton warrior\'s double-bit axe: heavy and fast to swing', ['skeleton axe', 'bone axe', 'undead axe']],
    // ---- more ranged
    ['heavy-crossbow', 'big siege crossbow: slow to reload, brutal bolt', ['heavy crossbow', 'siege crossbow', 'ballista crossbow', 'repeater']],
    ['revolver', 'hand cannon: one hard hit per trigger pull', ['handgun', 'six shooter', 'six-shooter', 'colt', 'magnum', 'hand cannon', 'revolvers']],
    ['smg', 'rapid-fire automatic submachine gun, low damage per bullet', ['machine gun', 'submachine gun', 'sub machine gun', 'tommy gun', 'uzi', 'automatic']],
    ['sniper', 'two-handed long gun: very high damage, very fast bullet, slow rate', ['sniper rifle', 'marksman rifle', 'anti-material rifle', 'scope rifle', 'sharpshooter']],
    ['rocket-launcher', 'two-handed launcher: slow explosive rocket with a big blast radius', ['rpg', 'bazooka', 'rocket', 'missile launcher', 'rocket launcher', 'launcher']],
    ['plasma-rifle', 'automatic green plasma rifle: steady stream of energy balls', ['plasma gun', 'plasma rifle', 'energy rifle', 'laser rifle', 'pulse rifle']],
    ['bone-staff', 'skull-topped staff: green necrotic bolts that burst on impact', ['skeleton staff', 'skull staff', 'necromancer staff', 'bone staff', 'necro staff']],
    ['spellbook', 'tome held in a hand: fires slow purple arcane bolts', ['spell book', 'grimoire', 'tome', 'book', 'magic book', 'spellbooks']],
    // ---- more tools / shields
    ['smoke-bomb', 'grabbing pulls the pin: after 2.2 s it pops into a big grey smoke cloud (no damage)', ['smoke', 'smoke grenade', 'smokebomb', 'smoke pot', 'fog bomb']],
    ['spiked-shield', 'spiked round shield: blocks like a shield and bashes much harder', ['spike shield', 'spikes shield', 'barbed shield', 'spiked buckler']],
    ['tower-shield', 'huge square shield for full cover; heavy', ['big shield', 'large shield', 'heater shield', 'square shield', 'wall shield']],
    // ---- hero weapons: matching built-in mechanics +25% damage and an effect colour; use the Blender hero model when the catalogue has it
    ['omni-blade', 'hero greatsword (+25% damage, teal glowing trail): the Omnissiah blade', ['omni blade', 'omniblade', 'hero greatsword', 'omnissiah sword']],
    ['sun-spear', 'hero spear (+25% damage, golden trail), throwable javelin', ['sun spear', 'sunspear', 'hero spear', 'golden spear']],
    ['void-scythe', 'hero scythe (+25% damage, violet trail) with huge sweeping arcs', ['void scythe', 'voidscythe', 'hero scythe', 'violet scythe']],
    ['storm-hammer', 'hero warhammer (+25% damage, electric-blue trail) with a bigger ground-slam shockwave', ['storm hammer', 'stormhammer', 'hero hammer', 'thunder hammer']],
    ['ember-staff', 'hero staff (+25% damage): fires orange fire-bolts that explode', ['ember staff', 'emberstaff', 'fire staff', 'hero staff']],
    ['aegis-shield', 'hero shield (+25% bash damage, cyan glow): hold toward attackers to block', ['aegis shield', 'aegis', 'hero shield', 'glowing shield']],
    ['star-bow', 'hero bow (+25% damage): hold trigger to draw, glowing arrows leave a golden trail', ['star bow', 'starbow', 'hero bow', 'golden bow']],
    ['rune-dagger', 'hero dagger (+25% damage, magenta trail), throwable', ['rune dagger', 'runedagger', 'hero dagger', 'magic dagger']],
    ['arc-blaster', 'hero blaster (+25% damage): rapid violet energy bolts', ['arc blaster', 'arcblaster', 'hero blaster', 'violet blaster']],
    ['prism-rifle', 'hero rifle (+25% damage): accurate magenta prism rounds', ['prism rifle', 'prismrifle', 'hero rifle', 'magenta rifle']],
  ];
  // the plain-prop fallback (no world.weapons) reuses the nearest mesh of gear.js
  const FALLBACK_MESH = {
    'great-axe': 'big-axe', mace: 'spiked-club', 'war-pick': 'pickaxe', shovel: 'club', hoe: 'club', 'bone-blade': 'katana', 'bone-axe': 'axe', 'heavy-crossbow': 'crossbow', revolver: 'blaster', smg: 'blaster',
    sniper: 'rifle', 'rocket-launcher': 'shotgun', 'plasma-rifle': 'rifle', 'bone-staff': 'skull-staff', spellbook: 'wand', 'smoke-bomb': 'grenade', 'spiked-shield': 'shield', 'tower-shield': 'shield',
    'omni-blade': 'greatsword', 'sun-spear': 'spear', 'void-scythe': 'scythe', 'storm-hammer': 'warhammer', 'ember-staff': 'magic-staff', 'aegis-shield': 'shield', 'star-bow': 'bow', 'rune-dagger': 'dagger',
    'arc-blaster': 'blaster', 'prism-rifle': 'rifle',
  };

  // create one weapon (world.weapons when available, plain grabbable prop otherwise) -> { mesh, body, w }
  function makeWeapon(inst, type, pos, o = {}) {
    const W = H.weapons(), K = H.kit();
    let w = null;
    if (W && W.create && (!W.types || W.types().includes(type))) {
      try { w = W.create(inst.ctx, type, { position: pos, scale: o.scale, hand: o.hand }); } catch (err) { console.error('[library] weapons.create failed', err); }
    }
    if (w) { inst.cleanup(() => { try { w.remove(); } catch (err) { /* gone */ } }); const m = w.body?.mesh ?? w.mesh; inst.track(m); return { w, mesh: m, body: w.body }; }
    if (!K) return null;
    const mesh = H.weaponMesh(FALLBACK_MESH[type] ?? type, { own: true });
    // a real box body fitted to the mesh (lies flat, tumbles when thrown); the old sphere only when mx is missing
    const mx = H.mx, body = mx ? mx.solid(inst, mesh, { shape: 'box', mass: 1, bounce: 0.25, friction: 0.7, grab: true, range: 5, at: pos, up: Math.max(0, pos.y - H.ground(pos.x, pos.z)) })
      : inst.body(mesh, { radius: 0.17, mass: 1, bounce: 0.3, friction: 0.7, grabbable: true, grabRange: 5, position: pos });
    inst.track(mesh);
    return { mesh, body };
  }
  // keep a weapon where it is (on a rack) until somebody grabs it
  function pin(r, yaw) {
    const b = r.body; if (!b) return;
    const m = b.mass;
    b.invMass = 0; b.velocity.set(0, 0, 0);
    if (yaw !== undefined) r.mesh.rotation.y = yaw;
    if (b.onGrab) b.onGrab(() => { b.invMass = m > 0 && isFinite(m) ? 1 / m : 1; });
  }
  H.makeWeapon = makeWeapon;

  for (const [type, desc, aliases] of TYPES) {
    def(type, desc, 'scale, hand (start in left/right hand)', aliases, (i, o) => {
      makeWeapon(i, type, { x: i.x, y: i.y + 1.1, z: i.z }, o);
    }, { size: 0.3, distance: 2.2, face: 'random', spacing: 0.8 });
  }

  // ---------------------------------------------------------------- weapon-rack
  def('weapon-rack', 'wooden rack with 8 weapons on its shelves (sword, axe, spear, bow, shield, hammer, crossbow, dagger); all grabbable', 'types (array of weapon names)', ['rack', 'weapon stand', 'weapons', 'weapon stand', 'weapon shelf', 'gun rack', 'sword rack'], (i, o) => {
    const b = H.mk(), W = 3.4, wood = 0x6a4a2a, dark = 0x3e2a18;
    for (const x of [-W / 2, W / 2]) { b.box(x, 1.15, 0, 0.14, 2.3, 0.2, dark); b.box(x, 2.32, 0, 0.2, 0.08, 0.26, wood); }
    b.box(0, 2.25, 0, W + 0.2, 0.12, 0.2, wood);
    b.box(0, 1.2, -0.08, W, 2.0, 0.05, 0x56391f);
    for (const y of [0.55, 1.15, 1.75]) { b.box(0, y, 0.18, W, 0.07, 0.4, wood); b.box(0, y + 0.07, 0.36, W, 0.1, 0.04, dark); }
    b.mode('glow'); for (const x of [-W / 2, W / 2]) b.sph(x, 2.42, 0, 0.05, 0.05, 0.05, 0xffd890);
    i.add(b.build());
    const mx = H.mx, V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (mx) { for (const y of [0.55, 1.15, 1.75]) mx.collider(i, new THREE.Box3(V(-W / 2, y - 0.03, 0.0), V(W / 2, y + 0.04, 0.4))); mx.collider(i, new THREE.Box3(V(-W / 2, 0, -0.12), V(W / 2, 2.3, -0.04))); } // shelves: things you drop land on them
    const want = o.types ?? ['sword', 'axe', 'spear', 'bow', 'shield', 'warhammer', 'crossbow', 'dagger'];
    const types = mx ? want.slice(0, mx.room(i, want.length, 'weapons')) : want;
    types.forEach((t, k) => {
      const row = k % 3, col = (k / 3) | 0, lx = -1.2 + col * 1.2 + (row === 1 ? 0.3 : 0), y = 0.55 + row * 0.6;
      const p = i.at(lx, 0.2);
      const r = makeWeapon(i, t, { x: p.x, y: i.y + y + 0.2, z: p.z }, {});
      if (r) pin(r, i.yaw + PI / 2);
    });
  }, { size: 2, distance: 4 });

  // ---------------------------------------------------------------- armory
  def('armory', `a display table with every weapon type (${TYPES.length}: melee, guns, magic, shields, tools and the ten hero weapons) laid out in rows; grab any of them`, 'none', ['weapon display', 'all weapons', 'every weapon', 'weapon shop', 'weapons table', 'arsenal'], (i, o) => {
    const names = (H.weapons()?.types?.() ?? TYPES.map((t) => t[0])).slice(0, 80);
    const base = TYPES.map((t) => t[0]);
    const all = [...base, ...names.filter((n) => !base.includes(n))], mx = H.mx;
    const list = mx ? all.slice(0, mx.room(i, all.length, 'weapons')) : all; // every weapon is a body until it is pinned: trimmed to the body budget
    const cols = 10, rows = Math.ceil(list.length / cols), TW = cols * 0.62 + 0.3, TD = rows * 2.0 + 0.4;
    const b = H.mk();
    b.box(0, 0.62, 0, TW, 0.1, TD, 0x5a3a20); b.box(0, 0.68, 0, TW - 0.2, 0.03, TD - 0.2, 0x7a1f2a);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box((TW / 2 - 0.1) * sx, 0.3, (TD / 2 - 0.1) * sz, 0.14, 0.6, 0.14, 0x3e2a18);
    b.box(0, 0.12, 0, TW - 0.3, 0.06, TD - 0.3, 0x3e2a18);
    i.add(b.build());
    if (mx) mx.collider(i, new THREE.Box3(new THREE.Vector3(-TW / 2, 0.57, -TD / 2), new THREE.Vector3(TW / 2, 0.67, TD / 2)));
    list.forEach((t, k) => {
      const row = (k / cols) | 0, col = k % cols;
      const p = i.at(-TW / 2 + 0.4 + col * 0.62, -TD / 2 + 1.1 + row * 2.0);
      const r = makeWeapon(i, t, { x: p.x, y: i.y + 0.95, z: p.z }, {});
      if (r) pin(r, i.yaw);
    });
    const l = i.label('ARMORY', { size: 0.2, color: 0xffd890, position: { x: i.x, y: i.y + 2.2, z: i.z } });
  }, { size: 4, distance: 8, keepOut: 5 });
}
