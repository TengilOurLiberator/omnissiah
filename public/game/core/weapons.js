// core/weapons.js — world.weapons: holdable weapons (melee, ranged, shields, tools) built on kit.body. READ THIS to make or edit weapons.
//
// USE      const W = ctx.world.weapons; if (!W) return {};                  // always guard (it may be reloading)
//   const sword = W.create(ctx, 'sword', { position: ctx.player.head });    // ctx owns it (removed with your module)
//   W.create(ctx, type, { position = near the right hand, hand: 'left'|'right' (start in that hand), scale = 1, ...any spec field })
//        -> { type, kind, body, mesh, held ('left'|'right'|null), ammo, remove(), fire(power = 1) }   null for an unknown type
//   Types (49), W.types() -> every name, custom ones included. Types marked * show a real glTF model (world.models) once it has loaded
//     (the procedural mesh is the placeholder AND the fallback), the rest are procedural:
//     melee    sword* greatsword* dagger* axe* great-axe* warhammer* mace club spear katana scythe pickaxe* war-pick* shovel* hoe* boomerang
//              bone-blade* bone-axe*   tools: torch* grenade* smoke-bomb* (fuse, then a smoke cloud, no damage)
//     ranged   bow crossbow* heavy-crossbow* blaster* revolver* smg* rifle* sniper* shotgun* rocket-launcher* (explosive) plasma-rifle*
//              magic-staff* wand* bone-staff* spellbook* (slow arcane bolts)          shields: shield* spiked-shield* tower-shield*
//     hero     omni-blade sun-spear void-scythe storm-hammer ember-staff aegis-shield star-bow rune-dagger arc-blaster prism-rifle:
//              +25% damage and a coloured effect; they use the world.models model of the same name when it exists AT CREATE TIME
//              (Blender hero pack: grip at the origin, blade along -Z, material 'Emissive' pulses) else a recoloured built-in mesh.
//   GEAR MAP (optional, written by the modelling agents): public/assets/hero/gear-map.json = { "weapons": { "<weapon type>": { "model": "<world.models id>", "len": 1.1 | "fit": "span", "span": 1.2 | "fit": "width", "width": 0.7,
//     "axis": "-z", "up": "+y" (model axis pointing along the blade / barrel; defaults), "grip": [x,y,z] (model-space point that sits in the hand), "behind": m, "shape": "blade"|"head",
//     "gripOffset": { "position": [x,y,z], "rotation": [rx,ry,rz] } (extra offset in the hand), "force": true (replace a model the type already has) } } }. Missing / still loading /
//     failed model = the procedural mesh stays. W.reloadGearMap() re-reads it; W.gearMap() = the mapped type names.
//   W.held.left / W.held.right = the weapon in that hand or null      W.list() = every live weapon (do not mutate)
//   W.blocks(point, towardAttacker, feedback = true) -> bool          (shields, see below)
//   const undo = W.define('name', spec)                               add/replace a type; undo() removes it again
//   Events: 'weapon:grab' { type, hand }  'weapon:fire' { type, hand }  'weapon:hit' { type, amount, point, hand }
//
// PLAYING: squeeze near a weapon (or point at it within 5 m and squeeze) to hold it; release to throw; a held weapon takes that hand's trigger. Melee damage scales with swing speed (2 -> 5.5 m/s = 30% -> 100%);
//   bows draw while the trigger is held; shields block from the front. Two-handed guns aim along the line between both hands.
// CUSTOM   W.define('frost-axe', { kind: 'melee', damage: 22, reach: 0.9, material: 'steel', trailColor: 0x88ccff,
//            build(THREE) { const g = new THREE.Group(); /* grip at the origin, blade along -Z */ return g; } })
//   Then W.create(ctx, 'frost-axe', { position }). spec fields (all optional except build):
//   kind 'melee'|'ranged'|'shield'|'tool'  damage  reach (m, blade tip along -Z; default hit points = mid + tip)  points [[x,y,z]..]
//   hitRadius 0.14  vMin 2  vFull 5.5 (swing speed range, m/s)  hitCooldown 0.4  material 'steel'|'blunt'|'wood'|'fire'  trailColor
//   slam { radius, damage } (ground-impact shockwave)  throw 'spin'|'align'|'none'|'boomerang'  throwDamage  rest 'flat'|'up'|'none'
//   grip { position: [x,y,z], rotation: [rx,ry,rz] } (model offset in the hand)  radius 0.13 (grab sphere)  mass  twoHanded
//   ranged: muzzle [x,y,z]  rate 0.3 (s between shots)  auto  ammo (default Infinity)  draw (s to full draw: bow style)
//     projectile { speed, gravity, color, damage, radius, size, len, life, explosive (blast radius m), pellets, spread (rad),
//                  kind 'bolt'|'arrow' }   recoil { z, rx }  haptic [strength, ms]  flash { size, color }
//     sound 'laser'|'rifle'|'shotgun'|'bow'|'crossbow'|'magic'|'zap'|'pistol'|'rocket'|'plasma'   projectile.trail: true = glowing particle trail
//     or fire({ origin, direction, weapon, ctx, power }) with fresh Vector3s for anything else (hitscan, beams, spells ...)
//   tick(weapon, dt, t) per-frame hook. weapon.hand, weapon.mesh, weapon.model (animate children of model), weapon.toWorld(local, out),
//   weapon.fit (the measured model fit, null while procedural), weapon.mdl (its world.models handle), weapon.flame (flame / spark point).
//   All damage goes through kit.hit(..., { from: 'player' }) so it never hurts you or allies.
//
// DAMAGE KINDS  every hit tells kit.hit what it was, so kit can dismember / pick a death style / break scenery accordingly:
//   swords, greatsword, katana, axes, scythe, bone-blade = 'slash'   dagger, spear, pickaxes, hoe, arrows, bullets = 'pierce'   warhammer, mace, shovel,
//   club, boomerang, shields, ground slams, thrown clubs/hammers = 'blunt'   grenade, rocket, staff bolts = 'explosion'   torch = 'fire'   blaster, plasma = 'shock'
//   wand = 'magic'.  Custom specs: damageKind: 'slash'|'pierce'|'blunt'|'explosion'|'fire'|'frost'|'shock'|'magic' (default: from
//   `material` for melee — steel slash, blunt/wood blunt, fire fire — and from projectile/sound for guns). The swing / shot direction
//   and the hand that dealt the blow are passed too, so a severing blow buzzes that controller.
//

export const meta = { name: 'Weapons', description: '49 holdable weapons (swords, axes, bows, guns, launchers, spellbooks, shields, torches, grenades, hero weapons) with real models, plus a spec to define more.' };

export default function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Quaternion, Matrix4, Euler, Color, MathUtils } = THREE;
  const input = ctx.input, events = ctx.events;
  const S = (ctx.state.w ??= {});
  S.list ??= []; S.custom ??= new Map(); S.held ??= { left: null, right: null }; S.hand ??= {}; S.fns ??= {}; S.fits ??= new Map();
  for (const n of ['left', 'right']) S.hand[n] ??= { vel: new Vector3(), prev: new Vector3(), has: false };

  const FROM = { from: 'player' };
  // damage opts handed to kit.hit (read synchronously, so one mutable object is fine): kind + the way the blow travelled + which hand
  const HIT = { from: 'player', kind: 'blunt', direction: undefined, hand: undefined, force: undefined };
  const hitOpts = (kind, dir, hand, force) => { HIT.kind = kind || 'blunt'; HIT.direction = dir || undefined; HIT.hand = hand || undefined; HIT.force = force; return HIT; };
  // particle counts follow ctx.quality.density (read at emit time: the perf governor lowers it under load, PC runs 2.5); fractions are rolled
  const dens = (n) => { const x = n * (ctx.quality && ctx.quality.density > 0 ? ctx.quality.density : 1), f = Math.floor(x); return f + (Math.random() < x - f ? 1 : 0); };
  const SWING = new Vector3(), _dirP = new Vector3();
  const KIND_BY_MATERIAL = { steel: 'slash', blunt: 'blunt', wood: 'blunt', fire: 'fire' };
  // what a spec's melee hits count as: spec.damageKind, else by material (steel slashes, blunt/wood bludgeons, fire burns)
  const meleeKind = (spec) => spec.damageKind || KIND_BY_MATERIAL[spec.material] || 'slash';
  // what a spec's thrown body / projectiles count as
  function shotKind(spec, P) {
    if (spec.damageKind) return spec.damageKind;
    if (P && P.explosive) return 'explosion';
    if (P && P.kind === 'arrow') return 'pierce';
    return spec.sound === 'laser' || spec.sound === 'zap' || spec.sound === 'plasma' ? 'shock' : spec.sound === 'magic' ? 'magic' : 'pierce';
  }
  const FWD = new Vector3(0, 0, -1), UP = new Vector3(0, 1, 0), AXX = new Vector3(1, 0, 0);
  const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3(), _v5 = new Vector3();
  const _q1 = new Quaternion(), _q2 = new Quaternion(), _m1 = new Matrix4(), _e1 = new Euler();
  const ZERO = new Matrix4().makeScale(0, 0, 0);
  const clamp = MathUtils.clamp, rand = (a, b) => a + Math.random() * (b - a);
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const K = () => ctx.world.kit;
  const nowT = () => ctx.clock.t;
  const buzz = (hand, s, ms) => {
    const k = K();
    if (k && typeof k.haptic === 'function') k.haptic(hand, s, ms);
    else { const h = input[hand]; if (h && h.pulse) h.pulse(s, ms); }
  };
  const holdSignal = (h) => (h.tracked ? h.fingers.gesture !== 'open' : !!h.down.squeeze); // is this hand "closed around" something?
  const arr3 = (a, d) => (Array.isArray(a) ? a : a && typeof a.x === 'number' ? [a.x, a.y, a.z] : d);

  // ------------------------------------------------------------------ model building: parts merged into 1 lit + 1 glow mesh
  const litMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  litMat.userData.keep = true; // shared: kit's disposeObject must not dispose it every time one weapon goes away
  const tintMats = new Map(); // recoloured variants of litMat (hero fallbacks, bone weapons), shared per colour
  function tintLit(hex, k = 0.7) {
    const key = hex + ':' + k;
    let m = tintMats.get(key);
    if (!m) {
      m = litMat.clone(); m.color.set(0xffffff).lerp(new Color(hex), k); m.emissive.set(hex).multiplyScalar(0.06); m.userData.keep = true;
      tintMats.set(key, m);
    }
    return m;
  }
  const glowMatBase = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const U = { box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(1, 10, 8), oct: new THREE.OctahedronGeometry(1, 0) };
  const cylZ = (rf, rb, len, seg) => new THREE.CylinderGeometry(rf, rb, len, seg, 1).rotateX(-Math.PI / 2); // front (radius rf) toward -Z
  const coneZ = (r, len, seg) => new THREE.ConeGeometry(r, len, seg).rotateX(-Math.PI / 2);                  // apex toward -Z
  const diamond = cylZ(0.5, 0.5, 1, 4), diamondTip = coneZ(0.5, 1, 4);                                        // blade cross-sections
  const C = { steel: 0xc9d3dc, steelD: 0x8794a3, dark: 0x2a2e36, gold: 0xd9a93c, wood: 0x80552f, woodD: 0x4d3322, leather: 0x3a2a22, red: 0xb03030, cyan: 0x58e6ff };

  function merge(list) {
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3);
    let o = 0;
    for (const g of list) {
      P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Cc.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    return out;
  }
  function builder() {
    const lit = [], glow = [];
    const Mx = new Matrix4(), Q = new Quaternion(), E = new Euler(), P = new Vector3(), Sc = new Vector3(), Col = new Color();
    function put(geo, color, pos, rot, scl, isGlow) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      E.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      Mx.compose(P.set(pos[0], pos[1], pos[2]), Q.setFromEuler(E), Sc.set(scl[0], scl[1], scl[2]));
      g.applyMatrix4(Mx);
      Col.set(color);
      const n = g.attributes.position.count, c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = Col.r; c[i * 3 + 1] = Col.g; c[i * 3 + 2] = Col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      if (g.attributes.uv) g.deleteAttribute('uv');
      (isGlow ? glow : lit).push(g);
    }
    const b = {
      box: (c, s, p, r, g) => put(U.box, c, p, r, s, g),
      sph: (c, r, p, g, sc) => put(U.sph, c, p, null, sc ? [r * sc[0], r * sc[1], r * sc[2]] : [r, r, r], g),
      oct: (c, s, p, r, g) => put(U.oct, c, p, r, s, g),
      cyl: (c, d, p, r, g, seg = 8) => put(cylZ(d[0], d[1], d[2], seg), c, p, r, [1, 1, 1], g),
      cone: (c, d, p, r, g, seg = 8) => put(coneZ(d[0], d[1], seg), c, p, r, [1, 1, 1], g),
      cut: (c, w, t, len, p, r, g) => put(diamond, c, p, r, [w, t, len], g),          // faceted blade segment, along Z
      tip: (c, w, t, len, p, r, g) => put(diamondTip, c, p, r, [w, t, len], g),       // blade point, apex toward -Z
      blade(c, w, t, z0, z1, tip, g) {                                                 // straight blade from z0 to the point at z1
        const len = (z0 - z1) - tip;
        b.cut(c, w, t, len, [0, 0, z0 - len / 2], null, g);
        b.tip(c, w, t, tip, [0, 0, z0 - len - tip / 2], null, g);
      },
      geometry: () => merge(lit),
      finish() {
        const g = new THREE.Group();
        if (lit.length) g.add(new THREE.Mesh(merge(lit), litMat));
        if (glow.length) {
          const gm = glowMatBase.clone();
          g.add(new THREE.Mesh(merge(glow), gm));
          g.userData.glowMat = gm;
        }
        return g;
      },
    };
    return b;
  }

  // ------------------------------------------------------------------ shared effects (lazy: kit may load after / reload under us)
  let fxo = null;
  function fx() {
    if (fxo) return fxo;
    const kit = K();
    if (!kit) return null;
    fxo = {
      snd: kit.sound(ctx), trails: new Map(),
      spark: kit.particles(ctx, { count: 260, color: [0xfff4c0, 0xff9030], size: [0.07, 0.015], life: [0.2, 0.55], speed: [2, 6.5], gravity: 8, drag: 0.5 }),
      dust: kit.particles(ctx, { count: 120, additive: false, color: [0x8d7c5c, 0x5a4a3a], alpha: 0.55, size: [0.18, 0.6], life: [0.5, 1.1], speed: [0.6, 2.2], gravity: -0.3, drag: 1.4 }),
      flash: kit.particles(ctx, { count: 40, color: [0xffffff, 0xffa040], size: [0.55, 0.1], life: [0.05, 0.11], speed: 0.2 }),
      smoke: kit.particles(ctx, { count: 90, additive: false, color: [0x777777, 0x2a2a2a], alpha: 0.4, size: [0.1, 0.5], life: [0.5, 1.1], speed: [0.2, 0.8], gravity: -0.5, drag: 1.2 }),
      flame: kit.particles(ctx, { count: 220, color: [0xffe9a0, 0xff3d08], size: [0.14, 0.015], life: [0.25, 0.55], speed: [0.05, 0.3], gravity: -2.5, drag: 1, spread: 0.012 }),
      cloud: kit.particles(ctx, { count: 120, additive: false, color: [0xd8dde0, 0x8c9296], alpha: 0.5, size: [0.9, 2.2], life: [2.5, 4.5], speed: [0.4, 1.6], gravity: -0.12, drag: 1.4 }),
    };
    for (const k of ['spark', 'dust', 'flash', 'smoke', 'flame', 'cloud']) {
      const em = fxo[k], e0 = em.emit;
      em.emit = (p, n = 1, v, s) => { const m = dens(n); if (m > 0) e0.call(em, p, m, v, s); };
    }
    return fxo;
  }
  function trailFor(hex) {
    const f = fx();
    if (!f) return null;
    let t = f.trails.get(hex);
    if (!t) { t = K().particles(ctx, { count: 200, color: [0xffffff, hex], size: [0.1, 0.01], life: [0.15, 0.35], speed: 0.1, drag: 1 }); f.trails.set(hex, t); }
    return t;
  }
  const tone = (o) => { const f = fx(); if (f) f.snd.tone(o); };
  const noise = (o) => { const f = fx(); if (f) f.snd.noise(o); };

  const SHOT = {
    laser: (p) => { tone({ freq: 1600, freqEnd: 240, dur: 0.17, type: 'sawtooth', vol: 0.11, at: p }); tone({ freq: 760, freqEnd: 110, dur: 0.12, type: 'square', vol: 0.05, at: p }); },
    rifle: (p) => { noise({ dur: 0.3, filter: { type: 'lowpass', freq: 3600, freqEnd: 260, q: 0.7 }, vol: 0.75, at: p, attack: 0.001 }); tone({ freq: 170, freqEnd: 42, dur: 0.22, vol: 0.5, at: p }); },
    shotgun: (p) => { noise({ dur: 0.5, filter: { type: 'lowpass', freq: 2600, freqEnd: 130, q: 0.6 }, vol: 1, at: p, attack: 0.001 }); tone({ freq: 110, freqEnd: 28, dur: 0.4, vol: 0.8, at: p }); },
    bow: (p) => { tone({ freq: 240, freqEnd: 80, dur: 0.14, type: 'triangle', vol: 0.3, at: p }); noise({ dur: 0.2, filter: { type: 'bandpass', freq: 1900, freqEnd: 500, q: 1.1 }, vol: 0.25, at: p }); },
    crossbow: (p) => { tone({ freq: 320, freqEnd: 70, dur: 0.16, type: 'sawtooth', vol: 0.14, at: p }); noise({ dur: 0.18, filter: { type: 'bandpass', freq: 1500, freqEnd: 400, q: 1 }, vol: 0.3, at: p }); },
    pistol: (p) => { noise({ dur: 0.18, filter: { type: 'lowpass', freq: 3200, freqEnd: 400, q: 0.7 }, vol: 0.55, at: p, attack: 0.001 }); tone({ freq: 240, freqEnd: 70, dur: 0.12, vol: 0.4, at: p }); },
    rocket: (p) => { noise({ dur: 0.7, filter: { type: 'lowpass', freq: 1800, freqEnd: 120, q: 0.6 }, vol: 0.9, at: p, attack: 0.01 }); tone({ freq: 120, freqEnd: 30, dur: 0.5, vol: 0.7, at: p }); tone({ freq: 500, freqEnd: 160, dur: 0.35, type: 'sawtooth', vol: 0.12, at: p }); },
    plasma: (p) => { tone({ freq: 900, freqEnd: 300, dur: 0.2, type: 'sawtooth', vol: 0.12, at: p }); tone({ freq: 1800, freqEnd: 700, dur: 0.12, type: 'sine', vol: 0.1, at: p }); },
    magic: (p) => { tone({ freq: 420, freqEnd: 1100, dur: 0.32, type: 'sine', vol: 0.2, at: p }); tone({ freq: 640, freqEnd: 320, dur: 0.4, type: 'triangle', vol: 0.1, at: p }); },
    zap: (p) => { tone({ freq: 2200, freqEnd: 900, dur: 0.12, type: 'triangle', vol: 0.15, at: p }); tone({ freq: 3300, freqEnd: 1500, dur: 0.1, vol: 0.06, at: p }); },
  };
  function hitSound(material, p, f) {
    if (material === 'blunt') { tone({ freq: 150, freqEnd: 48, dur: 0.28, vol: 0.35 + f * 0.35, at: p }); noise({ dur: 0.16, filter: { type: 'lowpass', freq: 700, q: 0.8 }, vol: 0.4, at: p }); }
    else if (material === 'wood') { tone({ freq: 320, freqEnd: 110, dur: 0.18, type: 'triangle', vol: 0.3, at: p }); noise({ dur: 0.1, filter: { type: 'bandpass', freq: 900, q: 1 }, vol: 0.25, at: p }); }
    else if (material === 'fire') { noise({ dur: 0.2, filter: { type: 'bandpass', freq: 1800, q: 0.8 }, vol: 0.25, at: p }); }
    else { tone({ freq: 2300, freqEnd: 1450, dur: 0.3, type: 'triangle', vol: 0.1 + f * 0.1, at: p }); noise({ dur: 0.07, filter: { type: 'highpass', freq: 3000, q: 0.8 }, vol: 0.3, at: p }); tone({ freq: 190, freqEnd: 70, dur: 0.14, vol: 0.2 + f * 0.2, at: p }); }
  }
  const swingSound = (p, s) => noise({ dur: 0.28, filter: { type: 'bandpass', freq: 500 + s * 120, freqEnd: 1700 + s * 200, q: 1.1 }, vol: 0.06 + Math.min(0.14, s * 0.02), at: p, attack: 0.05 });

  // ------------------------------------------------------------------ pooled projectiles (one shared pool for every weapon)
  const NB = 64, NA = 24;
  const boltGeo = new THREE.OctahedronGeometry(0.5, 0);
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const boltMesh = new THREE.InstancedMesh(boltGeo, boltMat, NB), haloMesh = new THREE.InstancedMesh(boltGeo, haloMat, NB);
  const arrowB = builder();
  arrowB.cyl(0x9a7040, [0.008, 0.008, 0.7], [0, 0, 0.27], null, false, 5);
  arrowB.cone(0xc8d0d8, [0.022, 0.1], [0, 0, -0.12], null, false, 5);
  arrowB.box(0xe8e8e0, [0.002, 0.045, 0.14], [0, 0, 0.55]); arrowB.box(0xe8e8e0, [0.045, 0.002, 0.14], [0, 0, 0.55]);
  const arrowGeo = arrowB.geometry();
  const arrowMesh = new THREE.InstancedMesh(arrowGeo, litMat, NA);
  const white = new Color(1, 1, 1);
  for (let i = 0; i < NB; i++) { boltMesh.setMatrixAt(i, ZERO); haloMesh.setMatrixAt(i, ZERO); boltMesh.setColorAt(i, white); haloMesh.setColorAt(i, white); }
  for (let i = 0; i < NA; i++) arrowMesh.setMatrixAt(i, ZERO);
  for (const m of [boltMesh, haloMesh, arrowMesh]) { m.frustumCulled = false; ctx.root.add(m); }
  haloMesh.renderOrder = 7;
  const projs = [];
  for (let i = 0; i < NB + NA; i++) {
    projs.push({
      alive: false, arrow: i >= NB, slot: i >= NB ? i - NB : i, pos: new Vector3(), prev: new Vector3(), vel: new Vector3(), q: new Quaternion(),
      g: 0, dmg: 0, r: 0.08, boom: 0, life: 1, age: 0, size: 0.04, len: 0.5, stuck: 0, color: new Color(), hex: 0xffffff, hand: null, type: '', kind: 'pierce', glow: false,
    });
  }
  let projDirty = 0;
  const _sc = new Vector3();
  function spawnProj(arrow, origin, dir, speed, P, dmg, spec, hand) {
    const lo = arrow ? NB : 0, hi = arrow ? NB + NA : NB;
    let p = null, oldest = projs[lo];
    for (let i = lo; i < hi; i++) { if (!projs[i].alive) { p = projs[i]; break; } if (projs[i].age > oldest.age) oldest = projs[i]; }
    if (!p) { p = oldest; killProj(p, false); }
    p.alive = true; p.age = 0; p.stuck = 0;
    if (arrow) arrowMesh.visible = true; else boltMesh.visible = haloMesh.visible = true;
    p.pos.copy(origin); p.prev.copy(origin); p.vel.copy(dir).multiplyScalar(speed);
    p.g = P.gravity ?? (arrow ? 9.8 : 0); p.dmg = dmg; p.r = P.radius ?? 0.08; p.boom = P.explosive ?? 0; p.life = P.life ?? (arrow ? 6 : 2.5);
    p.size = P.size ?? 0.04; p.len = P.len ?? 0.5; p.hand = hand; p.type = spec.type ?? ''; p.kind = shotKind(spec, P);
    p.color.set(P.color ?? 0xffffff); p.hex = p.color.getHex(); p.glow = !!P.trail;
    if (!arrow) { boltMesh.setColorAt(p.slot, p.color); haloMesh.setColorAt(p.slot, p.color); boltMesh.instanceColor.needsUpdate = haloMesh.instanceColor.needsUpdate = true; }
    writeProj(p);
    return p;
  }
  function writeProj(p) {
    const sp = p.vel.length();
    if (sp > 0.01) { _v5.copy(p.vel).multiplyScalar(1 / sp); p.q.setFromUnitVectors(FWD, _v5); }
    if (p.arrow) { _m1.compose(p.pos, p.q, _sc.set(1, 1, 1)); arrowMesh.setMatrixAt(p.slot, _m1); arrowMesh.instanceMatrix.needsUpdate = true; return; }
    _m1.compose(p.pos, p.q, _sc.set(p.size, p.size, p.len)); boltMesh.setMatrixAt(p.slot, _m1);
    _m1.compose(p.pos, p.q, _sc.set(p.size * 3.4, p.size * 3.4, p.len * 1.5)); haloMesh.setMatrixAt(p.slot, _m1);
    boltMesh.instanceMatrix.needsUpdate = haloMesh.instanceMatrix.needsUpdate = true;
  }
  function killProj(p) {
    p.alive = false;
    if (p.arrow) { arrowMesh.setMatrixAt(p.slot, ZERO); arrowMesh.instanceMatrix.needsUpdate = true; }
    else { boltMesh.setMatrixAt(p.slot, ZERO); haloMesh.setMatrixAt(p.slot, ZERO); boltMesh.instanceMatrix.needsUpdate = haloMesh.instanceMatrix.needsUpdate = true; }
  }
  const OPT_ENEMY = { hostileTo: 'friendly' }, OPT_NEUTRAL = { faction: 'neutral' }, SIDES = ['left', 'right'];
  const isFriendly = (t) => { const k = K(); return k && k.factionOf ? k.factionOf(t.faction) === 'friendly' : t.faction === 'friendly'; };
  // nearest thing a player weapon may hurt (never allies; if an ally is nearest, look for an enemy / neutral instead)
  function foe(point, r) {
    const kit = K();
    const t = kit.nearestTarget(point, r);
    if (!t || !isFriendly(t)) return t;
    const e = kit.nearestTarget(point, r, OPT_ENEMY);
    return e || kit.nearestTarget(point, r, OPT_NEUTRAL);
  }
  const _sv = new Vector3();
  // full damage on the target we detected (kit.hit has a distance falloff: cancel it, the contact test was already done)
  function strikeAt(point, t, hitR, amount, kind, dir, hand, force) {
    const kit = K();
    const gap = Math.max(0, distTo(t, point));
    const r =Math.max(hitR, gap + 0.05), f = 1 - 0.5 * clamp(gap / r, 0, 1);
    kit.hit(point, r, amount / f, hitOpts(kind, dir, hand, force === undefined ? undefined : force / f));
  }
  // metres from a point to a damageable's surface (box for walls and buildings, sphere otherwise)
  function distTo(t, point) {
    if (t.box && t.object) {
      const m = t.object.matrixWorld.elements, b = t.box;
      const dx = Math.max(m[12] + b.min.x - point.x, 0, point.x - (m[12] + b.max.x)), dy = Math.max(m[13] + b.min.y - point.y, 0, point.y - (m[13] + b.max.y)), dz = Math.max(m[14] + b.min.z - point.z, 0, point.z - (m[14] + b.max.z));
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    t.center(_sv);
    return Math.sqrt((_sv.x - point.x) ** 2 + (_sv.y - point.y) ** 2 + (_sv.z - point.z) ** 2) - t.radius;
  }
  function impact(p, at, hitSomething, tgt) {
    const kit = K(), f = fx();
    if (p.boom > 0) {
      kit.explosion(ctx, at, { color: p.hex, size: Math.max(0.8, p.boom * 0.9) });
      kit.hit(at, p.boom, p.dmg, hitOpts('explosion', null, p.hand));
      if (p.hand) buzz(p.hand, 0.5, 60);
    } else {
      if (hitSomething) {
        const dir = p.vel.lengthSq() > 1e-6 ? _dirP.copy(p.vel).normalize() : null;
        if (tgt) strikeAt(at, tgt, p.r + 0.12, p.dmg, p.kind, dir, p.hand); else kit.hit(at, p.r + 0.12, p.dmg, hitOpts(p.kind, dir, p.hand));
      }
      if (f) { f.spark.emit(at, hitSomething ? 10 : 6); if (!hitSomething) f.dust.emit(at, 3); }
      noise({ dur: 0.07, filter: { type: 'highpass', freq: 2200, q: 0.7 }, vol: 0.18, at });
      if (hitSomething) events.emit('weapon:hit', { type: p.type, amount: p.dmg, point: at, hand: p.hand });
    }
  }
  function stepProjectiles(dt) {
    const kit = K();
    if (!kit) return;
    let anyBolt = false, anyArrow = false;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      if (!p.alive) continue;
      if (p.arrow) anyArrow = true; else anyBolt = true;
      if (p.stuck > 0) { p.stuck -= dt; if (p.stuck <= 0) killProj(p); continue; }
      p.age += dt;
      if (p.age > p.life) { if (p.boom > 0) impact(p, p.pos, false); killProj(p); continue; }
      p.prev.copy(p.pos);
      p.vel.y -= p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      // sweep the segment for targets
      _v1.subVectors(p.pos, p.prev);
      const len = _v1.length(), n = Math.max(1, Math.min(10, Math.ceil(len / Math.max(0.5, p.r * 2)))), reach = (len / n) * 0.5 + p.r + 0.05;
      let hit = false;
      for (let k = 0; k < n && !hit; k++) {
        _v2.lerpVectors(p.prev, p.pos, (k + 0.5) / n);
        const tg = foe(_v2, reach);
        if (tg) { impact(p, _v2, true, tg); killProj(p); hit = true; }
      }
      if (hit) continue;
      const PX = ctx.world.physics; // scenery, walls, props: the Rapier world stops (and sticks) shots along the whole segment
      if (PX && PX.ready && len > 1e-4) {
        _v1.multiplyScalar(1 / len);
        const rc = PX.raycast(p.prev, _v1, len + p.r, { groups: 'world' });
        if (rc && rc.kind === 'static') {
          _v2.copy(rc.point);
          impact(p, _v2, false);
          if (p.arrow && p.boom <= 0) { p.pos.copy(_v2).addScaledVector(_v1, 0.12); p.vel.multiplyScalar(0.0001); p.stuck = 7; writeProj(p); }
          else killProj(p);
          continue;
        }
      }
      const gy = ctx.groundAt(p.pos.x, p.pos.z);
      if (p.pos.y <= gy) {
        _v2.copy(p.pos); _v2.y = gy;
        impact(p, _v2, false);
        if (p.arrow && p.boom <= 0) { // arrows stay stuck for a while
          p.pos.copy(_v2).addScaledVector(p.vel, 0.15 / Math.max(1, p.vel.length())).y += 0.02;
          p.vel.multiplyScalar(0.0001); p.stuck = 7; writeProj(p);
        } else killProj(p);
        continue;
      }
      writeProj(p);
      if ((!p.arrow && p.len < 0.4) || p.glow) { const tr = trailFor(p.hex); if (tr) tr.emit(p.pos, 1); }
    }
    boltMesh.visible = haloMesh.visible = anyBolt; arrowMesh.visible = anyArrow; // no draw calls while nothing is in flight
  }

  // ------------------------------------------------------------------ swing trails (ribbons, one per hand)
  const NS = 14;
  function makeRibbon() {
    const pos = new Float32Array(NS * 6), col = new Float32Array(NS * 6), idx = [];
    for (let i = 0; i < NS - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), colA = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posA); geo.setAttribute('color', colA); geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 8;
    ctx.root.add(mesh);
    return { pos, col, inten: new Float32Array(NS), posA, colA, mesh, a: new Vector3(), b: new Vector3(), i: 0, fresh: false, color: new Color(0xbfd8ff) };
  }
  const ribbons = { left: makeRibbon(), right: makeRibbon() };
  function stepRibbon(R) {
    R.pos.copyWithin(6, 0, (NS - 1) * 6); R.inten.copyWithin(1, 0, NS - 1);
    if (R.fresh) { R.pos[0] = R.a.x; R.pos[1] = R.a.y; R.pos[2] = R.a.z; R.pos[3] = R.b.x; R.pos[4] = R.b.y; R.pos[5] = R.b.z; R.inten[0] = R.i; }
    else { for (let k = 0; k < 6; k++) R.pos[k] = R.pos[6 + k]; R.inten[0] = 0; }
    R.fresh = false;
    let any = false;
    for (let i = 0; i < NS; i++) {
      const k = R.inten[i] * Math.pow(1 - i / (NS - 1), 1.3);
      if (k > 0.01) any = true;
      const c = i * 6;
      R.col[c] = R.col[c + 3] = R.color.r * k; R.col[c + 1] = R.col[c + 4] = R.color.g * k; R.col[c + 2] = R.col[c + 5] = R.color.b * k;
    }
    R.mesh.visible = any;
    if (any) { R.posA.needsUpdate = true; R.colA.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ weapon type definitions
  const BUILTIN = new Map();
  const def = (name, spec) => BUILTIN.set(name, spec);
  const tau = Math.PI * 2;

  def('sword', {
    kind: 'melee', damage: 18, reach: 0.95, hitRadius: 0.15, model: { name: 'sword' },
    build() {
      const b = builder();
      b.cyl(C.leather, [0.017, 0.017, 0.15], [0, 0, 0.01]); b.sph(C.gold, 0.03, [0, 0, 0.1]); b.box(C.gold, [0.22, 0.03, 0.04], [0, 0, -0.085]);
      b.blade(0xd7dee6, 0.056, 0.013, -0.1, -0.95, 0.13); b.box(C.steelD, [0.014, 0.0136, 0.5], [0, 0, -0.46]);
      return b.finish();
    },
  });
  def('greatsword', {
    kind: 'melee', damage: 32, reach: 1.45, hitRadius: 0.19, vMin: 1.9, vFull: 4.6, twoHanded: true, trailColor: 0x9fd4ff, slam: { radius: 1.3, damage: 8 },
    grip: { position: [0, 0, 0.04] }, model: { name: 'greatsword', len: 1.5 },
    build() {
      const b = builder();
      b.cyl(C.leather, [0.02, 0.02, 0.26], [0, 0, 0.05]); b.sph(C.gold, 0.036, [0, 0, 0.2]); b.box(C.gold, [0.36, 0.04, 0.05], [0, 0, -0.1]);
      b.cone(C.gold, [0.025, 0.09], [0.19, 0, -0.1], [0, -Math.PI / 2, 0], false, 5); b.cone(C.gold, [0.025, 0.09], [-0.19, 0, -0.1], [0, Math.PI / 2, 0], false, 5);
      b.blade(0xcfd8e2, 0.11, 0.024, -0.12, -1.45, 0.2); b.box(C.steelD, [0.03, 0.025, 0.85], [0, 0, -0.62]);
      for (const z of [-0.45, -0.7, -0.95]) b.box(C.cyan, [0.018, 0.027, 0.06], [0, 0, z], null, true);
      return b.finish();
    },
  });
  def('dagger', {
    kind: 'melee', damageKind: 'pierce', damage: 9, reach: 0.42, hitRadius: 0.12, vMin: 1.5, vFull: 4, throw: 'align', throwDamage: 14, mass: 0.4, radius: 0.1,
    points: [[0, 0, -0.25], [0, 0, -0.42]], trail: [[0, 0, -0.2], [0, 0, -0.42]], model: { name: 'dagger', len: 0.45 },
    build() {
      const b = builder();
      b.cyl(C.leather, [0.015, 0.015, 0.1], [0, 0, 0.0]); b.sph(0xff4040, 0.017, [0, 0, 0.065], true); b.box(C.gold, [0.09, 0.02, 0.025], [0, 0, -0.055]);
      b.blade(0xdde4ea, 0.036, 0.01, -0.06, -0.42, 0.09);
      return b.finish();
    },
  });
  def('axe', {
    kind: 'melee', damage: 24, reach: 0.85, hitRadius: 0.17, vMin: 2, vFull: 5, throw: 'spin', throwDamage: 20, slam: { radius: 0.7, damage: 0 },
    points: [[0.1, 0, -0.72], [0.05, 0, -0.78]], trail: [[0.17, 0, -0.6], [0.17, 0, -0.84]], model: { name: 'axe', len: 0.72, shape: 'head', up: '-z' },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.02, 0.02, 0.9], [0, 0, -0.33]); b.sph(C.steelD, 0.026, [0, 0, 0.13]);
      b.box(C.steelD, [0.055, 0.055, 0.07], [0, 0, -0.72]); b.box(C.steel, [0.055, 0.022, 0.2], [0.05, 0, -0.72]);
      b.box(0xe4eaf0, [0.1, 0.012, 0.25], [0.115, 0, -0.72], [0, 0.1, 0]); b.cone(C.steelD, [0.022, 0.09], [-0.065, 0, -0.72], [0, Math.PI / 2, 0], false, 5);
      return b.finish();
    },
  });
  def('warhammer', {
    kind: 'melee', damage: 38, reach: 1.0, hitRadius: 0.2, vMin: 1.8, vFull: 4.2, material: 'blunt', throw: 'spin', throwDamage: 26, mass: 3, trailColor: 0xffb070,
    slam: { radius: 2.2, damage: 14 }, points: [[0.17, 0, -0.93], [0, 0, -0.93]], trail: [[0.17, 0.1, -0.93], [0.17, -0.1, -0.93]],
    model: { name: 'tool-hammer-upgraded', len: 0.58, behind: 0.17, shape: 'head' },
    build() {
      const b = builder();
      b.cyl(C.woodD, [0.023, 0.023, 1.0], [0, 0, -0.38]); b.sph(C.steelD, 0.03, [0, 0, 0.13]);
      b.box(C.steel, [0.3, 0.11, 0.11], [0, 0, -0.93]); b.box(C.steelD, [0.06, 0.16, 0.16], [0.17, 0, -0.93]);
      b.box(0xff8a30, [0.004, 0.085, 0.085], [0.2, 0, -0.93], null, true); b.cone(C.steelD, [0.04, 0.15], [-0.22, 0, -0.93], [0, Math.PI / 2, 0], false, 6);
      return b.finish();
    },
  });
  def('spear', {
    kind: 'melee', damageKind: 'pierce', damage: 20, reach: 1.95, hitRadius: 0.14, vMin: 1.8, vFull: 4.5, throw: 'align', throwDamage: 28, mass: 1.5, twoHanded: true,
    points: [[0, 0, -1.6], [0, 0, -1.95]], trail: [[0, 0, -1.5], [0, 0, -1.95]], grip: { position: [0, 0, 0.3] },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.016, 0.016, 1.85], [0, 0, -0.68]); b.cyl(C.gold, [0.024, 0.024, 0.05], [0, 0, -1.58]);
      b.blade(0xdfe6ec, 0.07, 0.016, -1.6, -1.95, 0.13); b.cone(C.red, [0.035, 0.14], [0, 0, -1.5], [0, Math.PI, 0], false, 6);
      b.cone(C.steelD, [0.016, 0.06], [0, 0, 0.27], [0, Math.PI, 0]);
      return b.finish();
    },
  });
  def('club', {
    kind: 'melee', damage: 16, reach: 0.75, hitRadius: 0.17, vMin: 1.9, vFull: 4.6, material: 'wood', throw: 'spin', throwDamage: 12, mass: 1.5,
    slam: { radius: 1.0, damage: 4 }, points: [[0, 0, -0.5], [0, 0, -0.72]], trail: [[0, 0.06, -0.62], [0, -0.06, -0.62]],
    build() {
      const b = builder();
      b.cyl(C.wood, [0.066, 0.022, 0.64], [0, 0, -0.34], null, false, 7); b.sph(C.wood, 0.066, [0, 0, -0.66], false, [1, 1, 0.5]);
      for (const z of [-0.5, -0.62]) {
        b.cone(C.steelD, [0.013, 0.045], [0.06, 0, z], [0, -Math.PI / 2, 0], false, 5); b.cone(C.steelD, [0.013, 0.045], [-0.06, 0, z], [0, Math.PI / 2, 0], false, 5);
        b.cone(C.steelD, [0.013, 0.045], [0, 0.06, z], [Math.PI / 2, 0, 0], false, 5); b.cone(C.steelD, [0.013, 0.045], [0, -0.06, z], [-Math.PI / 2, 0, 0], false, 5);
      }
      return b.finish();
    },
  });
  def('katana', {
    kind: 'melee', damage: 20, reach: 1.08, hitRadius: 0.13, vMin: 1.7, vFull: 4.4, trailColor: 0xe6f2ff, points: [[0, 0.012, -0.6], [0, 0.05, -1.08]],
    build() {
      const b = builder();
      b.cyl(0x1b2038, [0.016, 0.016, 0.24], [0, 0, 0.04]); b.sph(C.steelD, 0.02, [0, 0, 0.165]);
      for (let i = 0; i < 5; i++) b.cyl(0x7b8aa8, [0.0175, 0.0175, 0.012], [0, 0, 0.12 - i * 0.045]);
      b.cyl(C.gold, [0.05, 0.05, 0.01], [0, 0, -0.085]); b.box(C.gold, [0.026, 0.022, 0.03], [0, 0, -0.105]);
      for (const s of [0.17, 0.5, 0.83]) { // gently curved blade: three segments
        b.cut(0xe9f0f6, 0.034, 0.009, 0.34, [0, 0.05 * s * s, -(0.12 + 0.96 * s)], [Math.atan(0.104 * s), 0, 0]);
      }
      b.tip(0xf4f8fb, 0.034, 0.009, 0.1, [0, 0.05, -1.13], [0.1, 0, 0]);
      return b.finish();
    },
  });
  def('scythe', {
    kind: 'melee', damage: 26, reach: 1.7, hitRadius: 0.17, vMin: 1.9, vFull: 4.8, twoHanded: true, trailColor: 0x9dffb0, grip: { position: [0, 0, 0.3] },
    points: [[-0.12, 0, -1.52], [-0.4, 0, -1.7], [-0.67, 0, -1.98]], trail: [[0, 0, -1.5], [-0.67, 0, -1.98]],
    build() {
      const b = builder();
      b.cyl(C.wood, [0.02, 0.02, 1.8], [0, 0, -0.6]); b.cyl(C.leather, [0.012, 0.012, 0.14], [-0.07, 0, -0.35], [0, Math.PI / 2, 0]);
      b.box(C.dark, [0.07, 0.05, 0.08], [-0.02, 0, -1.5]); b.sph(0x66ff99, 0.016, [0, 0.03, -1.5], true);
      const R = 0.7, phis = [8, 26, 44, 60, 72]; // a broad hooked blade: arc of radius R, tapering toward the point
      for (let i = 0; i < phis.length; i++) {
        const ph = phis[i] * Math.PI / 180, w = 0.13 - i * 0.022;
        b.cut(0xd5dde6, w, 0.012, R * 0.38, [-R * Math.sin(ph), 0, -1.5 - R + R * Math.cos(ph)], [0, Math.PI / 2 - ph, 0]);
      }
      return b.finish();
    },
  });

  // --- bow: curved limbs + animated string and nocked arrow
  const segTo = (mesh, A, B) => {
    _v4.subVectors(B, A); const l = _v4.length();
    mesh.position.addVectors(A, B).multiplyScalar(0.5); mesh.scale.z = l;
    mesh.quaternion.setFromUnitVectors(FWD, _v4.multiplyScalar(1 / (l || 1)));
  };
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xece4cc, fog: false });
  function bowTick(w, dt) {
    const target = w.drawing ? easeOut(w.charge) : 0;
    w.pull += (target - w.pull) * Math.min(1, dt * (target > w.pull ? 16 : 45));
    const u = w.parts;
    if (!u || !u.str1) return;
    _v1.set(0, 0, (w.nock ?? 0.0855) + w.pull * 0.42);
    segTo(u.str1, u.top, _v1); segTo(u.str2, u.bot, _v1);
    u.arrow.visible = w.pull > 0.03 || w.drawing;
    u.arrow.position.set(0, 0, _v1.z - 0.05);
  }
  def('bow', {
    kind: 'ranged', damage: 26, draw: 0.7, rate: 0.25, grip: { position: [0, 0, 0.02] }, muzzle: [0, 0, 0.0], twoHanded: false, rest: 'flat',
    projectile: { kind: 'arrow', speed: 56, gravity: 9.8, radius: 0.08, life: 6 }, recoil: { z: 0.03, rx: 0.05 }, haptic: [0.5, 50], sound: 'bow',
    tick: bowTick,
    build() {
      const b = builder();
      for (const sg of [1, -1]) { // two limbs curving back toward the archer
        for (let i = 0; i < 3; i++) {
          const u0 = i / 3, u1 = (i + 1) / 3;
          const y0 = sg * 0.55 * u0, z0 = 0.085 * u0 * u0, y1 = sg * 0.55 * u1, z1 = 0.085 * u1 * u1;
          const dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dy, dz);
          b.cut(C.wood, 0.03, 0.021, len + 0.012, [0, (y0 + y1) / 2, (z0 + z1) / 2], [Math.atan2(dy / len, -dz / len), 0, 0]);
        }
        b.sph(C.gold, 0.014, [0, sg * 0.555, 0.0855]);
      }
      b.cyl(C.leather, [0.02, 0.02, 0.13], [0, 0, 0], [Math.PI / 2, 0, 0]); b.box(C.dark, [0.012, 0.02, 0.04], [-0.022, 0.02, -0.01]);
      const g = b.finish();
      const mk = () => { const m = new THREE.Mesh(U.box, stringMat); m.scale.set(0.004, 0.004, 1); g.add(m); return m; };
      g.userData.str1 = mk(); g.userData.str2 = mk(); g.userData.top = new Vector3(0, 0.555, 0.0855); g.userData.bot = new Vector3(0, -0.555, 0.0855);
      const arrow = new THREE.Mesh(arrowGeo.clone(), litMat); arrow.visible = false; g.add(arrow); g.userData.arrow = arrow;
      for (const m of [g.userData.str1, g.userData.str2, arrow]) m.userData.keep = true; // stay visible on a model-backed bow
      segTo(g.userData.str1, g.userData.top, _v1.set(0, 0, 0.0855)); segTo(g.userData.str2, g.userData.bot, _v1);
      return g;
    },
  });
  def('crossbow', {
    kind: 'ranged', damage: 32, rate: 1.0, twoHanded: true, muzzle: [0, 0.045, -0.45], grip: { position: [0, 0, 0.03] }, model: { name: 'crossbow', axis: '+z', len: 0.5, bolt: true },
    projectile: { kind: 'arrow', speed: 72, gravity: 5, radius: 0.08, life: 5 }, recoil: { z: 0.06, rx: 0.1 }, haptic: [0.75, 70], sound: 'crossbow', flash: null,
    tick(w) { if (w.parts && w.parts.bolt) w.parts.bolt.visible = w.cool <= 0; }, // the bolt reappears once reloaded
    build() {
      const b = builder();
      b.box(C.wood, [0.05, 0.06, 0.66], [0, 0, 0.0]); b.box(C.woodD, [0.04, 0.1, 0.05], [0, -0.07, 0.07], [-0.2, 0, 0]); b.box(C.woodD, [0.052, 0.08, 0.1], [0, -0.01, 0.33]);
      b.box(C.dark, [0.2, 0.035, 0.045], [0, 0, -0.34]); b.box(C.steelD, [0.22, 0.028, 0.04], [0.2, 0, -0.31], [0, 0.32, 0]); b.box(C.steelD, [0.22, 0.028, 0.04], [-0.2, 0, -0.31], [0, -0.32, 0]);
      b.box(C.steel, [0.02, 0.03, 0.2], [0, 0.04, -0.2]); b.box(C.gold, [0.03, 0.03, 0.03], [0, 0, -0.38]); b.sph(C.steelD, 0.02, [0, 0.055, -0.01]);
      const g = b.finish();
      const str = new THREE.Mesh(U.box, stringMat); str.scale.set(0.5, 0.004, 0.004); str.position.set(0, 0.0, -0.2 + 0.02); g.add(str);
      const bolt = new THREE.Mesh(arrowGeo.clone(), litMat); bolt.scale.setScalar(0.65); bolt.position.set(0, 0.052, -0.24); g.add(bolt); g.userData.bolt = bolt; bolt.userData.keep = true;
      return g;
    },
  });
  def('blaster', {
    kind: 'ranged', damage: 8, rate: 0.13, auto: true, muzzle: [0, 0, -0.3], grip: { position: [0, -0.01, 0.03] }, model: { name: 'blaster-b', axis: '-z', len: 0.3, grip: [0, -0.11, 0.07] },
    projectile: { speed: 78, gravity: 0, color: 0x58f0ff, radius: 0.1, size: 0.05, len: 0.7, life: 2 }, recoil: { z: 0.03, rx: 0.07 }, haptic: [0.4, 35],
    sound: 'laser', flash: { size: 0.6, color: 0x58f0ff },
    tick(w, dt) { if (w.glowMat) w.glowMat.color.setScalar(1 + w.rec * 1.2); },
    build() {
      const b = builder();
      b.box(0xdde4ea, [0.045, 0.07, 0.22], [0, 0, -0.07]); b.box(0x3d4652, [0.04, 0.11, 0.05], [0, -0.075, 0.03], [-0.2, 0, 0]); b.box(C.steelD, [0.012, 0.022, 0.1], [0, 0.045, -0.08]);
      b.cyl(C.steelD, [0.014, 0.016, 0.16], [0, 0, -0.2]); b.cyl(C.cyan, [0.022, 0.022, 0.04], [0, 0, -0.125], null, true); b.cyl(C.cyan, [0.018, 0.018, 0.02], [0, 0, -0.17], null, true);
      b.sph(C.cyan, 0.016, [0, 0, -0.285], true); b.box(0x20e0a0, [0.006, 0.01, 0.06], [0.0235, 0.0, -0.06], null, true);
      return b.finish();
    },
  });
  def('shotgun', {
    kind: 'ranged', damage: 7, rate: 0.85, twoHanded: true, muzzle: [0, 0, -0.84], grip: { position: [0, -0.02, 0.05] }, model: { name: 'blaster-q', axis: '-z', len: 0.7, grip: [0, -0.09, 0.24] },
    projectile: { speed: 85, gravity: 3, color: 0xffd070, radius: 0.09, size: 0.03, len: 0.5, life: 0.7, pellets: 8, spread: 0.075 },
    recoil: { z: 0.14, rx: 0.36 }, haptic: [1, 90], sound: 'shotgun', flash: { size: 1.2, color: 0xffb050 }, smoke: true,
    build() {
      const b = builder();
      b.cyl(C.steelD, [0.02, 0.02, 0.76], [0, 0, -0.46]); b.cyl(C.steel, [0.016, 0.016, 0.6], [0, -0.042, -0.4]); b.box(C.wood, [0.052, 0.05, 0.22], [0, -0.04, -0.46]);
      b.box(C.dark, [0.052, 0.075, 0.24], [0, -0.005, -0.02]); b.box(C.wood, [0.046, 0.085, 0.34], [0, -0.03, 0.3], [0.1, 0, 0]); b.box(C.woodD, [0.04, 0.09, 0.05], [0, -0.075, 0.07], [-0.25, 0, 0]);
      b.sph(C.gold, 0.008, [0, 0.026, -0.82]); b.box(C.dark, [0.056, 0.09, 0.02], [0, -0.03, 0.47]);
      return b.finish();
    },
  });
  def('rifle', {
    kind: 'ranged', damage: 34, rate: 0.35, twoHanded: true, muzzle: [0, 0, -0.92], grip: { position: [0, -0.02, 0.05] }, model: { name: 'blaster-d', axis: '-z', len: 0.85, grip: [0, -0.1, 0.13] },
    projectile: { speed: 160, gravity: 0.5, color: 0xfff0b0, radius: 0.07, size: 0.025, len: 1.4, life: 1.5 },
    recoil: { z: 0.1, rx: 0.24 }, haptic: [0.9, 70], sound: 'rifle', flash: { size: 1.0, color: 0xffd080 }, smoke: true,
    build() {
      const b = builder();
      b.cyl(C.steelD, [0.014, 0.014, 0.62], [0, 0, -0.58]); b.cyl(C.dark, [0.022, 0.022, 0.05], [0, 0, -0.9]); b.box(0x3a424c, [0.048, 0.085, 0.46], [0, 0, -0.1]);
      b.box(0x4b5560, [0.05, 0.05, 0.3], [0, -0.005, -0.5]); b.box(0x3a424c, [0.042, 0.09, 0.3], [0, -0.02, 0.3]); b.box(C.dark, [0.046, 0.1, 0.03], [0, -0.025, 0.46]);
      b.box(C.dark, [0.032, 0.13, 0.065], [0, -0.1, -0.12], [0.18, 0, 0]); b.box(C.dark, [0.04, 0.1, 0.05], [0, -0.075, 0.06], [-0.25, 0, 0]);
      b.cyl(C.dark, [0.024, 0.024, 0.24], [0, 0.078, -0.14]); b.sph(0x33ddff, 0.017, [0, 0.078, -0.27], true, [1, 1, 0.3]); b.box(C.dark, [0.012, 0.02, 0.1], [0, 0.058, -0.1]);
      return b.finish();
    },
  });
  def('magic-staff', {
    kind: 'ranged', damageKind: 'explosion', damage: 16, rate: 0.5, muzzle: [0, 0, -1.62], grip: { position: [0, 0, 0.2] }, material: 'wood', radius: 0.14, throw: 'none',
    model: { name: 'staff', len: 1.62, behind: 0.3 },
    projectile: { speed: 26, gravity: 0, color: 0xb36bff, radius: 0.2, size: 0.22, len: 0.3, explosive: 1.7, life: 3 },
    recoil: { z: 0.05, rx: 0.12 }, haptic: [0.6, 60], sound: 'magic', flash: { size: 0.9, color: 0xb36bff },
    tick(w, dt, t) { if (w.glowMat) w.glowMat.color.setScalar(0.9 + 0.25 * Math.sin(t * 3) + w.rec * 1.5); },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.022, 0.022, 1.6], [0, 0, -0.6]); b.cyl(C.gold, [0.027, 0.027, 0.04], [0, 0, -0.18]); b.cyl(C.gold, [0.027, 0.027, 0.04], [0, 0, -1.37]);
      for (const [x, y] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) b.cone(C.steelD, [0.018, 0.24], [x, y, -1.5], [y * 1.6, x * -1.6, 0], false, 5);
      b.oct(0xb36bff, [0.055, 0.085, 0.055], [0, 0, -1.5], [Math.PI / 2, 0, 0], true); b.sph(0xe6ccff, 0.022, [0, 0, -1.5], true);
      return b.finish();
    },
  });
  def('wand', {
    kind: 'ranged', damageKind: 'magic', damage: 6, rate: 0.2, auto: true, muzzle: [0, 0, -0.3], grip: { position: [0, 0, 0.1] }, radius: 0.1, mass: 0.3, throw: 'none',
    model: { name: 'wand', len: 0.3 },
    projectile: { speed: 44, gravity: 0, color: 0xffd35a, radius: 0.1, size: 0.07, len: 0.12, life: 2 }, recoil: { z: 0.015, rx: 0.05 }, haptic: [0.25, 25], sound: 'zap',
    flash: { size: 0.4, color: 0xffd35a },
    tick(w, dt, t) { if (w.glowMat) w.glowMat.color.setScalar(0.9 + 0.3 * Math.sin(t * 6) + w.rec); },
    build() {
      const b = builder();
      b.cyl(C.woodD, [0.01, 0.016, 0.32], [0, 0, -0.1]); b.cyl(C.gold, [0.019, 0.019, 0.02], [0, 0, 0.02]); b.cyl(C.gold, [0.014, 0.014, 0.02], [0, 0, -0.24]);
      b.oct(0xffd35a, [0.022, 0.022, 0.03], [0, 0, -0.28], null, true);
      return b.finish();
    },
  });
  def('shield', {
    kind: 'shield', damage: 6, reach: 0.4, hitRadius: 0.17, vMin: 2.6, vFull: 5, material: 'blunt', rest: 'up', radius: 0.2, mass: 2, throw: 'none', twoHanded: false,
    shieldRadius: 0.33, shieldCenter: [0, 0, -0.14], points: [[0, 0, -0.18], [0.2, 0, -0.16], [-0.2, 0, -0.16]], trail: [[0.25, 0, -0.17], [-0.25, 0, -0.17]],
    model: { name: 'shield-round', axis: '+z', fit: 'width', width: 0.68 },
    tick(w, dt) { if (w.flash > 0) w.flash = Math.max(0, w.flash - dt * 3); if (w.glowMat) w.glowMat.color.setScalar(1 + w.flash * 3); },
    build() {
      const b = builder();
      b.cyl(0x2f5ea8, [0.31, 0.31, 0.035], [0, 0, -0.14], null, false, 14); b.cyl(C.gold, [0.335, 0.335, 0.022], [0, 0, -0.13], null, false, 14);
      b.sph(C.steel, 0.07, [0, 0, -0.175], false, [1, 1, 0.55]); b.box(C.cyan, [0.045, 0.27, 0.006], [0, 0, -0.161], null, true); b.box(C.cyan, [0.27, 0.045, 0.006], [0, 0, -0.161], null, true);
      b.box(C.dark, [0.03, 0.14, 0.03], [0, 0, -0.07]); b.box(C.leather, [0.1, 0.03, 0.02], [0, 0, -0.04]);
      return b.finish();
    },
  });
  def('torch', {
    kind: 'tool', damage: 4, reach: 0.5, hitRadius: 0.13, vMin: 1.8, vFull: 4, material: 'fire', rest: 'flat', trailColor: 0xffa040, radius: 0.1, mass: 0.5, throw: 'spin', throwDamage: 4,
    points: [[0, 0, -0.38]], trail: [[0, 0, -0.3], [0, 0, -0.5]], light: { color: 0xff8a30, intensity: 9, distance: 9, flicker: 0.6 }, lightAt: [0, 0, -0.45],
    flame: [0, 0, -0.42], model: { name: 'torch', len: 0.4, behind: 0.17, flame: 0.12 },
    tick(w, dt, t) {
      const f = fx();
      if (!f) return;
      w.acc = (w.acc || 0) + dt * 40; const n = w.acc | 0; w.acc -= n;
      if (n) { w.toWorld(w.flame ?? _v3.set(0, 0, -0.42), _v4); f.flame.emit(_v4, n, UP); if (Math.random() < dt * 8) f.spark.emit(_v4, 1, UP); }
    },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.023, 0.016, 0.46], [0, 0, -0.05]); b.cyl(C.dark, [0.042, 0.026, 0.11], [0, 0, -0.33]); b.sph(0xff7a1a, 0.03, [0, 0, -0.39], true);
      b.cyl(C.steelD, [0.03, 0.03, 0.012], [0, 0, -0.27]);
      return b.finish();
    },
  });
  def('pickaxe', {
    kind: 'melee', damageKind: 'pierce', damage: 14, reach: 0.95, hitRadius: 0.15, vMin: 2.0, vFull: 5, material: 'steel', throw: 'spin', throwDamage: 14, mass: 2,
    slam: { radius: 0.6, damage: 0 }, points: [[0.4, 0, -0.93], [-0.4, 0, -0.93]], trail: [[0.4, 0, -0.93], [-0.4, 0, -0.93]],
    model: { name: 'tool-pickaxe', len: 0.88, behind: 0.15, shape: 'head' },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.021, 0.021, 0.95], [0, 0, -0.32]); b.sph(C.steelD, 0.027, [0, 0, 0.16]);
      b.box(C.dark, [0.06, 0.06, 0.07], [0, 0, -0.82]);
      b.cone(0xcdd5dd, [0.042, 0.4], [0.22, 0, -0.84], [0, -Math.PI / 2 + 0.28, 0], false, 5); b.cone(0xcdd5dd, [0.042, 0.4], [-0.22, 0, -0.84], [0, Math.PI / 2 - 0.28, 0], false, 5);
      return b.finish();
    },
  });
  def('boomerang', {
    kind: 'melee', damage: 14, reach: 0.4, hitRadius: 0.2, vMin: 2.2, vFull: 5, material: 'wood', throw: 'boomerang', throwDamage: 14, mass: 0.4, radius: 0.12, rest: 'flat',
    points: [[0.17, 0, -0.28], [-0.17, 0, -0.28]], trail: [[0.17, 0, -0.28], [-0.17, 0, -0.28]],
    build() {
      const b = builder();
      b.box(C.wood, [0.075, 0.018, 0.34], [0.09, 0, -0.14], [0, -0.55, 0]); b.box(C.wood, [0.075, 0.018, 0.34], [-0.09, 0, -0.14], [0, 0.55, 0]);
      b.box(C.red, [0.078, 0.02, 0.04], [0.16, 0, -0.27], [0, -0.55, 0]); b.box(C.red, [0.078, 0.02, 0.04], [-0.16, 0, -0.27], [0, 0.55, 0]); b.sph(C.wood, 0.04, [0, 0, 0], false, [1, 0.5, 1]);
      return b.finish();
    },
  });
  def('grenade', {
    kind: 'tool', damage: 0, reach: 0.1, radius: 0.08, mass: 0.6, rest: 'none', throw: 'none', bounce: 0.45, grenade: { fuse: 3.5, radius: 4.4, damage: 55 }, grip: { position: [0, 0, -0.02] },
    model: { name: 'grenade-b', fit: 'scale', scale: 0.55, grip: [0, 0.1, 0], glow: [[0, 0, -0.075], [0, 0.07, -0.0]] },
    tick(w, dt, t) {
      if (w.fuse < 0) return;
      const g = specOf(w).grenade;
      w.fuse -= dt;
      const rate = 6 + 22 * (1 - w.fuse / g.fuse), on = Math.sin(t * rate) > 0;
      if (w.glowMat) w.glowMat.color.setScalar(on ? 2.2 : 0.25);
      if (on !== w.led) { w.led = on; if (on) { tone({ freq: 1800 + 700 * (1 - w.fuse / g.fuse), dur: 0.05, type: 'square', vol: 0.06, at: w.body.position }); if (w.hand) buzz(w.hand, 0.25, 25); } }
      if (w.fuse <= 0) explodeGrenade(w, g);
    },
    build() {
      const b = builder();
      b.sph(0x4f6130, 0.055, [0, 0, -0.02], false, [1, 1.15, 1]); b.cyl(C.dark, [0.057, 0.057, 0.012], [0, 0, -0.02]); b.cyl(C.dark, [0.045, 0.045, 0.012], [0, 0, 0.025]);
      b.cyl(C.gold, [0.018, 0.018, 0.035], [0, 0.065, -0.02], [Math.PI / 2, 0, 0]); b.box(C.steelD, [0.012, 0.075, 0.014], [0.035, 0.03, -0.02], [0, 0, -0.15]);
      b.sph(0xff3020, 0.011, [0, 0, -0.075], true);
      return b.finish();
    },
  });

  // ------------------------------------------------------------------ more types: derived from the kinds above (scaled / recoloured) or new meshes
  const SCALED_KEYS = ['reach', 'points', 'trail', 'muzzle', 'lightAt', 'shieldCenter', 'flame'];
  const scaleVal = (v, k) => (Array.isArray(v) ? v.map((x) => scaleVal(x, k)) : typeof v === 'number' ? v * k : v);
  // derive('axe', { scale: 1.4, tint: 0xe8e0c8, damage: 30, model: {...} }) -> a new spec: base fields, geometry numbers x scale, build() scaled + recoloured
  function derive(base, over = {}) {
    const b = BUILTIN.get(base), k = over.scale ?? 1, tint = over.tint ?? null, tk = over.tintK ?? 0.7;
    const o = Object.assign({}, b, over);
    delete o.scale; delete o.tint; delete o.tintK;
    if (!over.model) delete o.model;
    if (k !== 1) {
      for (const key of SCALED_KEYS) if (b[key] !== undefined && over[key] === undefined) o[key] = scaleVal(b[key], k);
      if (b.grip && b.grip.position && !over.grip) o.grip = Object.assign({}, b.grip, { position: scaleVal(b.grip.position, k) });
      if (b.shieldRadius !== undefined && over.shieldRadius === undefined) o.shieldRadius = b.shieldRadius * k;
    }
    o.build = (TH, spec) => {
      const inner = b.build(TH, spec);
      if (tint !== null) inner.traverse((m) => { if (m.isMesh && m.material === litMat) m.material = tintLit(tint, tk); });
      if (k === 1) return inner;
      const g = new TH.Group(); g.add(inner); inner.scale.setScalar(k); g.userData = inner.userData; return g;
    };
    return o;
  }
  const dmg = (base, mul) => Math.round(BUILTIN.get(base).damage * mul * 10) / 10;

  def('mace', {
    kind: 'melee', damage: 24, reach: 0.75, hitRadius: 0.17, vMin: 1.9, vFull: 4.6, material: 'blunt', throw: 'spin', throwDamage: 18, mass: 2, slam: { radius: 1.0, damage: 6 }, trailColor: 0xd9d2c4,
    points: [[0, 0, -0.55], [0, 0, -0.7]], trail: [[0, 0.07, -0.68], [0, -0.07, -0.68]],
    build() {
      const b = builder();
      b.cyl(C.woodD, [0.02, 0.02, 0.72], [0, 0, -0.26]); b.cyl(C.leather, [0.026, 0.026, 0.16], [0, 0, 0.02]); b.sph(C.steelD, 0.03, [0, 0, 0.12]);
      b.sph(C.steel, 0.075, [0, 0, -0.68]);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * tau; b.box(C.steelD, [0.02, 0.06, 0.1], [Math.cos(a) * 0.075, Math.sin(a) * 0.075, -0.68], [0, 0, a]); }
      return b.finish();
    },
  });
  def('shovel', {
    kind: 'melee', damage: 17, reach: 0.95, hitRadius: 0.16, vMin: 2.0, vFull: 5, material: 'blunt', throw: 'spin', throwDamage: 14, mass: 1.6, slam: { radius: 0.8, damage: 3 }, trailColor: 0xd7d0c0,
    points: [[0, 0, -0.78], [0, 0, -0.95]], trail: [[0.08, 0, -0.9], [-0.08, 0, -0.9]], model: { name: 'shovel', axis: '-y', len: 0.7, behind: 0.25, shape: 'head' },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.02, 0.02, 0.95], [0, 0, -0.35]); b.box(C.wood, [0.16, 0.025, 0.025], [0, 0, 0.12]);
      b.box(C.steel, [0.17, 0.012, 0.26], [0, 0, -0.84]); b.cone(C.steel, [0.085, 0.1], [0, 0, -1.01], [0, Math.PI / 4, 0], false, 4); b.box(C.steelD, [0.05, 0.04, 0.05], [0, 0, -0.7]);
      return b.finish();
    },
  });
  def('hoe', {
    kind: 'melee', damageKind: 'pierce', damage: 15, reach: 0.95, hitRadius: 0.15, vMin: 2.0, vFull: 5, material: 'steel', throw: 'spin', throwDamage: 12, mass: 1.4, slam: { radius: 0.6, damage: 0 }, trailColor: 0xc9d3dc,
    points: [[0.12, 0, -0.93], [0.2, 0, -0.97]], trail: [[0.22, 0.05, -0.95], [0.22, -0.05, -0.95]], model: { name: 'tool-hoe-upgraded', len: 0.8, behind: 0.2, shape: 'head', up: '-z' },
    build() {
      const b = builder();
      b.cyl(C.wood, [0.02, 0.02, 0.95], [0, 0, -0.35]); b.box(C.dark, [0.05, 0.05, 0.07], [0, 0, -0.84]);
      b.box(C.steel, [0.2, 0.012, 0.07], [0.12, 0, -0.9], [0, 0.25, 0]); b.box(C.steelD, [0.05, 0.02, 0.1], [0.04, 0, -0.86]);
      return b.finish();
    },
  });
  def('war-pick', derive('pickaxe', { damage: 20, vMin: 1.9, trailColor: 0xffc890, mass: 2.2, tint: 0xffc890, tintK: 0.35, throwDamage: 18, slam: { radius: 0.9, damage: 3 }, model: { name: 'tool-pickaxe-upgraded', len: 0.9, behind: 0.15, shape: 'head' } }));
  def('great-axe', derive('axe', {
    scale: 1.45, damage: 36, vMin: 2.1, vFull: 4.4, mass: 4, twoHanded: true, hitRadius: 0.24, throwDamage: 30, slam: { radius: 1.7, damage: 10 }, trailColor: 0xdbe8ff,
    model: { name: 'great-axe', len: 1.1, behind: 0.35, shape: 'head' },
  }));
  def('bone-axe', derive('axe', { scale: 1.15, damage: 27, tint: 0xece3c4, trailColor: 0xcfffd0, mass: 1.8, model: { name: 'skeleton-axe', len: 0.85, shape: 'head' } }));
  def('bone-blade', derive('katana', { damage: 17, vMin: 1.6, tint: 0xe9e1c2, trailColor: 0xb8ffc8, scale: 0.8, model: { name: 'skeleton-blade', len: 0.9 } }));
  def('heavy-crossbow', derive('crossbow', {
    scale: 1.2, damage: 52, rate: 1.7, mass: 3, tint: 0xc9b89a, tintK: 0.3, model: { name: 'heavy-crossbow', axis: '+z', len: 0.62, bolt: true },
    projectile: { kind: 'arrow', speed: 98, gravity: 3.5, radius: 0.1, life: 5 }, recoil: { z: 0.1, rx: 0.16 }, haptic: [0.9, 90],
  }));

  def('revolver', derive('blaster', {
    damage: 24, rate: 0.42, auto: false, muzzle: [0, 0.02, -0.25], tint: 0xffd9a0, tintK: 0.35, sound: 'pistol', flash: { size: 0.9, color: 0xffd080 }, smoke: true,
    projectile: { speed: 150, gravity: 0.6, color: 0xfff0b0, radius: 0.08, size: 0.022, len: 0.8, life: 1.4 }, recoil: { z: 0.07, rx: 0.2 }, haptic: [0.75, 60],
    tick: undefined, model: { name: 'blaster-k', axis: '-z', len: 0.27, grip: [0, -0.1, 0.15] },
  }));
  def('smg', derive('blaster', {
    damage: 5, rate: 0.075, auto: true, scale: 1.1, tint: 0xb9c4d4, tintK: 0.35, sound: 'pistol', flash: { size: 0.5, color: 0xffd080 },
    projectile: { speed: 95, gravity: 0.8, color: 0xffe9a0, radius: 0.07, size: 0.02, len: 0.6, life: 1.2, spread: 0.03 }, recoil: { z: 0.03, rx: 0.06 }, haptic: [0.35, 25],
    tick: undefined, model: { name: 'blaster-j', axis: '-z', len: 0.4, grip: [0, -0.1, 0.22] },
  }));
  def('sniper', derive('rifle', {
    scale: 1.2, damage: 90, rate: 1.1, projectile: { speed: 320, gravity: 0.15, color: 0xfff0b0, radius: 0.07, size: 0.022, len: 2.6, life: 1.4 },
    recoil: { z: 0.16, rx: 0.3 }, haptic: [1, 120], flash: { size: 1.3, color: 0xffd080 }, tint: 0xa8b8a0, tintK: 0.3, model: { name: 'blaster-e', axis: '-z', len: 1.15, grip: [0, -0.1, 0.88] },
  }));
  def('rocket-launcher', {
    kind: 'ranged', damageKind: 'explosion', damage: 70, rate: 1.9, twoHanded: true, mass: 4, muzzle: [0, 0.02, -0.82], grip: { position: [0, -0.02, 0.1] },
    projectile: { speed: 36, gravity: 0.7, color: 0xff9a3a, radius: 0.2, size: 0.13, len: 0.55, explosive: 3.4, life: 4, trail: true },
    recoil: { z: 0.2, rx: 0.4 }, haptic: [1, 140], sound: 'rocket', flash: { size: 1.8, color: 0xffa040 }, smoke: true,
    model: { name: 'blaster-h', axis: '-z', len: 0.78, grip: [0, -0.07, 0.22] },
    build() {
      const b = builder();
      b.cyl(0x4d5a3c, [0.07, 0.07, 0.95], [0, 0.0, -0.33], null, false, 10); b.cyl(0x2d3624, [0.095, 0.075, 0.14], [0, 0, -0.84], null, false, 10); b.cyl(0x2d3624, [0.075, 0.1, 0.12], [0, 0, 0.18], null, false, 10);
      b.cyl(C.dark, [0.085, 0.085, 0.03], [0, 0, -0.35], null, false, 10); b.box(0x3a424c, [0.045, 0.1, 0.07], [0, -0.1, -0.15], [0.15, 0, 0]); b.box(0x3a424c, [0.04, 0.09, 0.05], [0, -0.1, 0.0], [-0.2, 0, 0]);
      b.box(C.dark, [0.03, 0.05, 0.06], [0, 0.09, -0.5]); b.box(C.dark, [0.012, 0.04, 0.012], [0, 0.12, -0.2]); b.cyl(0xff7a1a, [0.088, 0.088, 0.02], [0, 0, -0.68], null, true, 10);
      return b.finish();
    },
  });
  def('plasma-rifle', derive('rifle', {
    damage: 15, rate: 0.14, auto: true, scale: 0.9, tint: 0x9fffc8, tintK: 0.4, sound: 'plasma', flash: { size: 0.9, color: 0x58ff9a }, smoke: false,
    projectile: { speed: 72, gravity: 0, color: 0x58ff9a, radius: 0.12, size: 0.1, len: 0.22, life: 2 }, recoil: { z: 0.04, rx: 0.08 }, haptic: [0.45, 35],
    tick(w) { if (w.glowMat) w.glowMat.color.setScalar(1 + w.rec * 1.4); }, model: { name: 'blaster-r', axis: '-z', len: 0.6, grip: [0, -0.1, 0.23] },
  }));
  def('smoke-bomb', derive('grenade', {
    scale: 1.15, tint: 0x9aa4ac, tintK: 0.5, grenade: { fuse: 2.2, radius: 5, damage: 0, smoke: true },
    model: { name: 'smokebomb', fit: 'scale', scale: 0.3, grip: [0, 0, 0], glow: [[0, 0, -0.075], [0, 0.07, 0.0]] },
  }));
  def('bone-staff', derive('magic-staff', {
    tint: 0xe6e0c4, tintK: 0.55, damage: 14, rate: 0.4, projectile: { speed: 30, gravity: 0, color: 0x7dff6a, radius: 0.2, size: 0.2, len: 0.3, explosive: 1.3, life: 3 },
    flash: { size: 0.9, color: 0x7dff6a }, model: { name: 'skeleton-staff', len: 1.58, behind: 0.3 },
  }));
  def('spellbook', {
    kind: 'ranged', damageKind: 'magic', damage: 11, rate: 0.42, muzzle: [0, 0.06, -0.06], grip: { position: [0, 0, 0.02] }, radius: 0.12, mass: 0.5, throw: 'none',
    projectile: { speed: 15, gravity: 0, color: 0xd36bff, radius: 0.17, size: 0.15, len: 0.2, life: 3.5 }, recoil: { z: 0.02, rx: 0.08 }, haptic: [0.4, 40], sound: 'magic',
    flash: { size: 0.6, color: 0xd36bff }, model: { name: 'spellbook', axis: '+x', up: '+y', fit: 'width', width: 0.3 },
    tick(w, dt, t) { if (w.glowMat) w.glowMat.color.setScalar(0.85 + 0.25 * Math.sin(t * 2.5) + w.rec * 1.4); },
    build() {
      const b = builder();
      b.box(0x6a2a8c, [0.2, 0.28, 0.05], [0, 0.04, 0]); b.box(0xe8dfc0, [0.186, 0.262, 0.03], [0.004, 0.04, 0.012]); b.box(C.gold, [0.025, 0.28, 0.056], [-0.1, 0.04, 0]);
      b.box(C.gold, [0.14, 0.03, 0.056], [0.0, 0.1, 0]); b.box(C.gold, [0.14, 0.03, 0.056], [0.0, -0.02, 0]);
      b.sph(0xd36bff, 0.028, [0, 0.04, -0.03], true, [1, 1, 0.5]);
      return b.finish();
    },
  });
  def('spiked-shield', derive('shield', {
    damage: 15, scale: 1.08, mass: 3, tint: 0xc9c2b4, tintK: 0.4, shieldRadius: 0.37, model: { name: 'shield-spikes', axis: '+z', fit: 'width', width: 0.78 },
  }));
  def('tower-shield', derive('shield', {
    damage: 8, scale: 1.3, mass: 5, tint: 0x9db4d8, tintK: 0.35, shieldRadius: 0.43, model: { name: 'shield-square', axis: '+z', fit: 'width', width: 0.95 },
  }));

  // ---- hero weapons: +25% damage, own effect colour. Visual = world.models '<name>' when it exists at create time (grip at the origin,
  // blade/barrel along -Z, +Y up, material 'Emissive' glows), else the recoloured built-in mesh. Mechanics are the matching built-in's.
  const HERO_MODEL = { axis: '-z', up: '+y', hero: true };
  function hero(name, base, color, over) {
    const b = BUILTIN.get(base), o = Object.assign({ tint: color, tintK: 0.55, damage: dmg(base, 1.25), hero: true }, over);
    if (b.throwDamage !== undefined && o.throwDamage === undefined) o.throwDamage = Math.round(b.throwDamage * 1.25);
    if (o.model) o.model = Object.assign({}, HERO_MODEL, { name }, o.model);
    else o.model = Object.assign({}, HERO_MODEL, { name, len: Math.abs(b.reach ?? 1) });
    if (b.projectile && !o.projectile) o.projectile = Object.assign({}, b.projectile, { color });
    if (b.projectile && o.projectile && o.projectile.color === undefined) o.projectile = Object.assign({}, o.projectile, { color });
    if (b.flash && o.flash === undefined) o.flash = Object.assign({}, b.flash, { color });
    if (b.damage !== undefined && o.projectile && o.projectile.damage !== undefined) o.projectile = Object.assign({}, o.projectile, { damage: Math.round(o.projectile.damage * 1.25) });
    if (!o.trailColor) o.trailColor = color;
    def(name, derive(base, o));
  }
  hero('omni-blade', 'greatsword', 0x66ffd8, { model: { len: 1.5 }, slam: { radius: 1.6, damage: 10 } });
  hero('sun-spear', 'spear', 0xffd34a, { model: { len: 1.95, shape: 'blade' }, throwDamage: 36 });
  hero('void-scythe', 'scythe', 0xb04dff, { model: { len: 1.9, shape: 'head' } });
  hero('storm-hammer', 'warhammer', 0x6ab8ff, { model: { len: 1.0, shape: 'head' }, slam: { radius: 2.8, damage: 18 } });
  hero('ember-staff', 'magic-staff', 0xff6a1a, { model: { len: 1.62 }, projectile: { speed: 28, gravity: 0, color: 0xff6a1a, radius: 0.22, size: 0.24, len: 0.3, explosive: 2.0, life: 3, trail: true } });
  hero('aegis-shield', 'shield', 0x58d8ff, { tintK: 0.3, model: { fit: 'width', width: 0.72 }, scale: 1.1, shieldRadius: 0.4 });
  hero('star-bow', 'bow', 0xfff08a, { model: { fit: 'span', span: 1.15 }, projectile: { kind: 'arrow', speed: 62, gravity: 8, radius: 0.08, life: 6, trail: true } });
  hero('rune-dagger', 'dagger', 0xff5acc, { model: { len: 0.45 } });
  hero('arc-blaster', 'blaster', 0xb86cff, { model: { len: 0.3 }, sound: 'zap' });
  hero('prism-rifle', 'rifle', 0xff80f0, { model: { len: 0.95 }, flash: { size: 1.1, color: 0xff80f0 } });

  function explodeGrenade(w, g) {
    const kit = K();
    w.fuse = -1;
    if (g.smoke) { // smoke bomb: a pop and a big grey cloud, no damage
      const f = fx();
      _v1.copy(w.body.position); _v1.y = Math.max(_v1.y, ctx.groundAt(_v1.x, _v1.z) + 0.25);
      if (f) { f.cloud.emit(_v1, 60, UP, 1.5); f.cloud.emit(_v1, 40, UP, 2.2); f.dust.emit(_v1, 10, UP, 1.2); }
      noise({ dur: 0.35, filter: { type: 'lowpass', freq: 1400, freqEnd: 200, q: 0.6 }, vol: 0.45, at: _v1, attack: 0.002 }); tone({ freq: 200, freqEnd: 60, dur: 0.2, vol: 0.3, at: _v1 });
      events.emit('weapon:smoke', { point: _v1.clone(), radius: g.radius });
      removeWeapon(w);
      return;
    }
    if (kit) {
      _v1.copy(w.body.position);
      kit.explosion(ctx, _v1, { color: 0xffa040, size: g.radius * 0.7 });
      kit.hit(_v1, g.radius, g.damage, hitOpts('explosion'));
      const P = ctx.world.player;
      if (P && P.damage && ctx.player.head.distanceTo(_v1) < g.radius * 0.5) P.damage(20, { point: _v1 });
    }
    buzz('left', 0.9, 120); buzz('right', 0.9, 120);
    removeWeapon(w);
  }

  // ------------------------------------------------------------------ real models (world.models) swapped in for the procedural mesh
  // The procedural mesh stays as placeholder + fallback. When the glTF has loaded it is measured ONCE per (type, model) (cached in S.fits),
  // rotated / scaled so grip = weapon origin and the far end (tip / muzzle) lies on -Z at `len`, and the weapon's measured points follow.
  const AXV = (s) => { const v = new Vector3(); v.setComponent(s[1] === 'x' ? 0 : s[1] === 'y' ? 1 : 2, s[0] === '-' ? -1 : 1); return v; };
  function fitModel(spec, m, V) { // V: Float32Array xyz of every vertex in model space -> plain-data fit (metres at weapon scale 1)
    const f = AXV(m.axis ?? '+y'), u = AXV(m.up ?? (Math.abs(f.y) > 0.5 ? '+z' : '+y')), s = new Vector3().crossVectors(f, u), n = V.length / 3;
    let dLo = Infinity, dHi = -Infinity, uLo = Infinity, uHi = -Infinity, sLo = Infinity, sHi = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2], d = f.x * x + f.y * y + f.z * z, e = u.x * x + u.y * y + u.z * z, q = s.x * x + s.y * y + s.z * z;
      if (d < dLo) dLo = d; if (d > dHi) dHi = d; if (e < uLo) uLo = e; if (e > uHi) uHi = e; if (q < sLo) sLo = q; if (q > sHi) sHi = q;
    }
    const len = m.len ?? spec.reach ?? 0.8, g = new Vector3(), mode = m.fit ?? 'length';
    let k = 1;
    if (m.grip) g.set(m.grip[0], m.grip[1], m.grip[2]);
    if (mode === 'length') {
      if (m.behind != null && !m.grip) { k = (len + m.behind) / Math.max(1e-4, dHi - dLo); g.copy(f).multiplyScalar(dLo + m.behind / k); } // origin = butt: the hand sits `behind` m from the rear end
      else k = len / Math.max(1e-4, dHi - f.dot(g));
    } else if (mode === 'span') k = m.span / Math.max(1e-4, uHi - uLo);
    else if (mode === 'width') k = m.width / Math.max(1e-4, Math.max(sHi - sLo, uHi - uLo));
    else k = m.scale ?? 1;
    const R = new Matrix4().set(s.x, s.y, s.z, 0, u.x, u.y, u.z, 0, -f.x, -f.y, -f.z, 0, 0, 0, 0, 1), q = new Quaternion().setFromRotationMatrix(R);
    const t = g.clone().applyMatrix4(R).multiplyScalar(-k);
    const W = new Float32Array(V.length), p = new Vector3();
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity, zLo = Infinity, zHi = -Infinity;
    for (let i = 0; i < n; i++) { // weapon-space vertices: k * R * (p - g)
      p.set(V[i * 3] - g.x, V[i * 3 + 1] - g.y, V[i * 3 + 2] - g.z).applyMatrix4(R).multiplyScalar(k);
      W[i * 3] = p.x; W[i * 3 + 1] = p.y; W[i * 3 + 2] = p.z;
      if (p.x < xLo) xLo = p.x; if (p.x > xHi) xHi = p.x; if (p.y < yLo) yLo = p.y; if (p.y > yHi) yHi = p.y; if (p.z < zLo) zLo = p.z; if (p.z > zHi) zHi = p.z;
    }
    const Lm = Math.max(0.02, -zLo);
    const slab = (z0, z1) => { let sx = 0, sy = 0, sz = 0, c = 0; for (let i = 0; i < n; i++) { const z = W[i * 3 + 2]; if (z >= z0 && z <= z1) { sx += W[i * 3]; sy += W[i * 3 + 1]; sz += z; c++; } } return c ? [sx / c, sy / c, sz / c] : [0, 0, (z0 + z1) / 2]; };
    const tipC = slab(zLo, zLo + 0.1 * Lm), midC = slab(-0.62 * Lm, -0.48 * Lm), muz = slab(zLo, zLo + 0.04 * Lm);
    const r3 = (a) => a.map((v) => Math.round(v * 1e4) / 1e4);
    const fit = { k, q: [q.x, q.y, q.z, q.w], t: r3(t.toArray()), zLo, zHi, ext: [xLo, xHi, yLo, yHi, zLo, zHi].map((v) => Math.round(v * 1e4) / 1e4),
      muzzle: r3([muz[0], muz[1], zLo]), flame: r3([tipC[0], tipC[1], zLo + (m.flame ?? 0) * Lm]) };
    if (m.shape === 'head') { // axe / hammer / pickaxe / scythe head: points sit on the head, the trail sweeps across its cutting edge
      const hs = slab(zLo, zLo + 0.36 * Lm), pts = [hs];
      let ex1 = null, ex2 = null;
      for (let i = 0; i < n; i++) { const z = W[i * 3 + 2]; if (z > zLo + 0.36 * Lm) continue; const x = W[i * 3]; if (!ex1 || x > ex1[0]) ex1 = [x, W[i * 3 + 1], z]; if (!ex2 || x < ex2[0]) ex2 = [x, W[i * 3 + 1], z]; }
      const big = Math.abs(ex1[0]) >= Math.abs(ex2[0]) ? ex1 : ex2, small = big === ex1 ? ex2 : ex1;
      if (Math.abs(big[0]) > 0.04) pts.push(big);
      const both = Math.abs(small[0]) >= 0.45 * Math.abs(big[0]) && Math.abs(small[0]) > 0.04;
      if (both) pts.push(small);
      if (Math.min(...pts.map((q) => q[2])) - zLo > 0.1 * Lm) pts.push([tipC[0], tipC[1], zLo + 0.04 * Lm]); // a spike beyond the head (scythe): it hits too
      fit.pts = pts.map(r3);
      if (both) fit.trail = [r3([ex1[0], hs[1], hs[2]]), r3([ex2[0], hs[1], hs[2]])];
      else { let zA = Infinity, zB = -Infinity; for (let i = 0; i < n; i++) { const z = W[i * 3 + 2]; if (z <= zLo + 0.4 * Lm && Math.abs(W[i * 3] - big[0]) < 0.2 * Math.abs(big[0])) { if (z < zA) zA = z; if (z > zB) zB = z; } } if (!(zA < zB)) { zA = hs[2] - 0.1 * Lm; zB = hs[2] + 0.1 * Lm; } fit.trail = [r3([big[0], hs[1], zA]), r3([big[0], hs[1], zB])]; }
    } else { fit.pts = [r3([midC[0], midC[1], -0.55 * Lm]), r3([tipC[0], tipC[1], zLo])]; fit.trail = [r3([0, 0, -0.35 * Lm]), r3([tipC[0], tipC[1], zLo])]; }
    if (spec.kind === 'shield') { // blocking disc: centred on the model's bounding box, radius from its larger face dimension
      const R0 = 0.5 * Math.min(xHi - xLo, yHi - yLo) * 0.95;
      fit.shield = { r: Math.round(R0 * 1e3) / 1e3, c: r3([(xLo + xHi) / 2, (yLo + yHi) / 2, zLo + 0.35 * (zHi - zLo)]) };
      fit.pts = [r3([0, 0, zLo]), r3([0.6 * R0, 0, zLo]), r3([-0.6 * R0, 0, zLo])]; fit.trail = [r3([0.78 * R0, 0, zLo]), r3([-0.78 * R0, 0, zLo])];
    }
    if (m.fit === 'span') { // bow: string anchors on the limb tips
      const top = slab2(W, n, 0.9 * yHi, Infinity), bot = slab2(W, n, -Infinity, 0.9 * yLo);
      fit.top = r3([0, yHi * 0.985, top]); fit.bot = r3([0, yLo * 0.985, bot]); fit.nock = Math.round(((top + bot) / 2) * 1e4) / 1e4;
    }
    if (m.bolt) fit.bolt = r3([muz[0], muz[1] + 0.02, zLo]);
    return fit;
  }
  function slab2(W, n, y0, y1) { let sz = 0, c = 0; for (let i = 0; i < n; i++) { const y = W[i * 3 + 1]; if (y >= y0 && y <= y1) { sz += W[i * 3 + 2]; c++; } } return c ? sz / c : 0; }

  const _rm = new Matrix4(), _mm = new Matrix4();
  function vertsOf(h) { // every vertex of a loaded static handle in the model's own space (root space)
    h.root.updateMatrixWorld(true);
    _rm.copy(h.root.matrixWorld).invert();
    const meshes = []; let total = 0;
    h.root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { meshes.push(o); total += o.geometry.attributes.position.count; } });
    const V = new Float32Array(total * 3), p = new Vector3();
    let j = 0;
    for (const o of meshes) {
      _mm.multiplyMatrices(_rm, o.matrixWorld);
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) { p.fromBufferAttribute(a, i).applyMatrix4(_mm); V[j++] = p.x; V[j++] = p.y; V[j++] = p.z; }
    }
    return V;
  }

  function useModel(w, obj) {
    const M = ctx.world.models, m = w.spec.model;
    if (!M || !m || typeof M.spawn !== 'function' || typeof M.has !== 'function' || !M.has(m.name)) return; // no models service / no such model: the procedural mesh stays
    const holder = new THREE.Group();
    holder.name = 'model-holder';
    w.model.add(holder);
    let h = null;
    try { h = M.spawn(w.ctx, m.name, { parent: holder, position: [0, 0, 0], castShadow: false }); } catch (err) { console.warn('[weapons] model spawn failed for', w.type, err); holder.removeFromParent(); return; }
    h.object.visible = false; // spawn() shows a wireframe placeholder until the glTF is in
    w.mdl = h;
    h.ready.then(() => {
      try { finishModel(w, obj, h, holder); } catch (err) { console.warn(`[weapons] model for ${w.type} failed`, err); }
    });
  }
  function finishModel(w, obj, h, holder) {
    if (w.body.removed || h.removed) { try { h.remove(); } catch (err) { /* gone */ } if (w.mdl === h) w.mdl = null; return; }
    if (!h.loaded || !h.root || h.error) { holder.removeFromParent(); try { h.remove(); } catch (err) { /* gone */ } w.mdl = null; return; } // keep the procedural mesh
    const m = w.spec.model, key = JSON.stringify(m) + '|' + (w.spec.reach ?? '') + '|' + w.kind;
    let fit = S.fits.get(key);
    if (!fit) { fit = fitModel(w.spec, m, vertsOf(h)); S.fits.set(key, fit); }
    const wrap = h.model; // 'fit' group of the handle: root + the recommended-scale wrapper we now override
    wrap.matrixAutoUpdate = true;
    wrap.position.fromArray(fit.t); wrap.quaternion.fromArray(fit.q); wrap.scale.setScalar(fit.k); wrap.updateMatrix();
    h.object.visible = true;
    obj.traverse((o) => { if (o.isMesh && !o.userData.keep) o.visible = false; }); // procedural parts off (the string / nocked arrow of a bow stay)
    if (m.glow && obj.userData.glowMat) { // keep a little LED (grenade) and move it onto the model
      obj.traverse((o) => { if (o.isMesh && o.material === obj.userData.glowMat) { o.visible = true; o.position.set(m.glow[1][0] - m.glow[0][0], m.glow[1][1] - m.glow[0][1], m.glow[1][2] - m.glow[0][2]); } });
    }
    if (m.hero) { // clone the 'Emissive' material per weapon so it can pulse without touching other instances
      const list = [];
      h.root.traverse((o) => {
        if (o.isMesh && o.material && !Array.isArray(o.material) && /emissive/i.test(o.material.name || '') && 'emissiveIntensity' in o.material) {
          o.material = o.material.clone(); o.material.userData.ei = o.material.emissiveIntensity || 1; list.push(o.material);
        }
      });
      if (list.length) w.emis = list;
    }
    w.fit = fit;
    fitSpec(w);
    applyFit(w, fit, wrap);
    S.models = (S.models | 0) + 1;
  }
  // the parts of a fit that live in the per-weapon spec copy (survive a hot reload through the adoption loop)
  function fitSpec(w) {
    const fit = w.fit, sp = w.spec;
    if (fit.shield) { sp.shieldRadius = fit.shield.r; sp.shieldCenter = fit.shield.c; }
    if (sp.model && sp.model.hold) sp.grip = Object.assign({}, sp.grip, { position: sp.model.hold });
  }
  function applyFit(w, fit, wrap) {
    const sc = w.model.scale.x, sp = w.spec, m = sp.model;
    if (m.points !== 'spec' && fit.pts) {
      const n = fit.pts.length;
      while (w.pts.length < n) { w.pts.push(new Vector3()); w.cur.push(new Vector3()); w.prv.push(new Vector3()); }
      w.pts.length = w.cur.length = w.prv.length = n;
      for (let i = 0; i < n; i++) w.pts[i].set(fit.pts[i][0] * sc, fit.pts[i][1] * sc, fit.pts[i][2] * sc);
      w.trailA.set(fit.trail[0][0] * sc, fit.trail[0][1] * sc, fit.trail[0][2] * sc); w.trailB.set(fit.trail[1][0] * sc, fit.trail[1][1] * sc, fit.trail[1][2] * sc);
      w.prevOk = false;
    }
    if (sp.kind === 'ranged' && m.fit !== 'span') w.muzzle.set(fit.muzzle[0] * sc, fit.muzzle[1] * sc, fit.muzzle[2] * sc);
    w.flame.set(fit.flame[0] * sc, fit.flame[1] * sc, fit.flame[2] * sc);
    if (w.node) w.node.position.set(fit.flame[0], fit.flame[1], fit.flame[2] + 0.04);
    if (m.hold) { w.gripPos.set(m.hold[0], m.hold[1], m.hold[2]); if (w.body.held) w.body.hold.copy(w.gripPos); }
    if (fit.top && w.parts && w.parts.top) { w.parts.top.fromArray(fit.top); w.parts.bot.fromArray(fit.bot); w.nock = fit.nock; }
    if (fit.bolt && w.parts && w.parts.bolt) { // nocked bolt: its tip (0.17 * 0.65 in front of its origin) sits on the muzzle, whatever scale the procedural group has
      const b = w.parts.bolt, S = b.parent ? b.parent.scale.x : 1;
      b.position.set(fit.bolt[0] / S, fit.bolt[1] / S, fit.bolt[2] / S + 0.1105);
    }
  }

  // ------------------------------------------------------------------ types, creation, holding
  const ALIAS = { staff: 'magic-staff', 'magic staff': 'magic-staff', hammer: 'warhammer', 'war-hammer': 'warhammer', 'great-sword': 'greatsword', pick: 'pickaxe', bomb: 'grenade', pistol: 'blaster', gun: 'blaster', 'laser-gun': 'blaster', 'cross-bow': 'crossbow', buckler: 'shield', knife: 'dagger',
    greataxe: 'great-axe', 'two-handed-axe': 'great-axe', scimitar: 'bone-blade', 'skeleton-blade': 'bone-blade', 'skeleton-axe': 'bone-axe', 'skeleton-staff': 'bone-staff', 'skull-staff': 'bone-staff',
    'spell-book': 'spellbook', grimoire: 'spellbook', book: 'spellbook', spade: 'shovel', 'garden-hoe': 'hoe', 'pickaxe-upgraded': 'war-pick', 'heavy-xbow': 'heavy-crossbow', 'sniper-rifle': 'sniper',
    'machine-gun': 'smg', 'submachine-gun': 'smg', rocket: 'rocket-launcher', rpg: 'rocket-launcher', bazooka: 'rocket-launcher', 'plasma-gun': 'plasma-rifle', smoke: 'smoke-bomb', smokebomb: 'smoke-bomb',
    'smoke-grenade': 'smoke-bomb', 'spike-shield': 'spiked-shield', 'big-shield': 'tower-shield', omniblade: 'omni-blade', sunspear: 'sun-spear', voidscythe: 'void-scythe', stormhammer: 'storm-hammer',
    emberstaff: 'ember-staff', aegis: 'aegis-shield', starbow: 'star-bow', runedagger: 'rune-dagger', arcblaster: 'arc-blaster', prismrifle: 'prism-rifle' };
  const norm = (t) => { const s = String(t).toLowerCase().trim().replace(/[\s_]+/g, '-'); return S.custom.has(s) || BUILTIN.has(s) ? s : ALIAS[s] ?? s; };
  const lookup = (t) => { const n = norm(t); return S.custom.get(n) ?? BUILTIN.get(n) ?? null; };
  const specOf = (w) => w.spec;
  const KIND_DEFAULTS = {
    melee: { vMin: 2, vFull: 5.5, hitRadius: 0.14, hitCooldown: 0.4, material: 'steel', trailColor: 0xbfd8ff, throw: 'spin', rest: 'flat' },
    tool: { vMin: 2, vFull: 5.5, hitRadius: 0.14, hitCooldown: 0.4, material: 'steel', trailColor: 0xbfd8ff, throw: 'spin', rest: 'flat' },
    shield: { vMin: 2.6, vFull: 5, hitRadius: 0.17, hitCooldown: 0.5, material: 'blunt', throw: 'none', rest: 'up', shieldRadius: 0.33, shieldCenter: [0, 0, -0.14] },
    ranged: { rate: 0.3, ammo: Infinity, muzzle: [0, 0, -0.5], throw: 'none', rest: 'flat', recoil: { z: 0.05, rx: 0.1 }, haptic: [0.5, 50] },
  };

  // ---- catalogue model hook: public/assets/hero/gear-map.json (optional; see the header). A type with an entry gets spec.model = the entry (same options
  // as the hero models: name, len | fit span/width, axis, up, grip, behind, hold, shape ...). useModel() shows it only if world.models has() it
  // and it finished loading; until then, and forever when it is missing or fails, the procedural mesh is what you see. Re-read with W.reloadGearMap().
  const GEAR_SKIP = new Set(['model', 'id', 'force', 'grip_hand', 'note', 'comment']);
  function parseGearMap(j) {
    const out = new Map(), src = j && typeof j === 'object' ? (j.weapons && typeof j.weapons === 'object' ? j.weapons : j) : {};
    for (const k of Object.keys(src)) {
      const e = src[k];
      if (k[0] === '_' || !e || typeof e !== 'object') continue;
      const name = e.model ?? e.id ?? e.name;
      if (typeof name !== 'string' || !name) continue;
      const m = { axis: '-z', up: '+y' };
      for (const q of Object.keys(e)) if (!GEAR_SKIP.has(q) && q !== 'name' && q !== 'gripOffset') m[q] = e[q];
      m.name = name;
      const norm0 = String(k).toLowerCase().trim().replace(/[\s_]+/g, '-');
      out.set(norm0, { model: m, force: !!e.force, gripOffset: e.gripOffset ?? null });
    }
    return out;
  }
  function loadGearMap() {
    if (typeof fetch !== 'function') return Promise.resolve(0);
    return fetch('/assets/hero/gear-map.json', { cache: 'no-store' })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => { S.gear = parseGearMap(j); S.fits.clear(); return S.gear.size; })
      .catch(() => { S.gear ??= new Map(); return 0; });
  }
  const mergeSpec = (s0, over, kind, type) => {
    const spec = Object.assign({}, KIND_DEFAULTS[kind] ?? KIND_DEFAULTS.melee, s0, over, { kind, type });
    const g = S.gear && S.gear.get(type);
    if (g && !over.model && (!s0.model || g.force)) { spec.model = g.model; if (g.gripOffset && !over.grip) spec.grip = Object.assign({}, spec.grip, g.gripOffset); }
    return spec;
  };
  function weaponIn(c, type, o) {
    const spec0 = lookup(type);
    if (!spec0) { console.error(`[weapons] unknown weapon type "${type}". Known: ${types().join(', ')}`); return null; }
    const kit = K();
    if (!kit) return null;
    const { position, hand, scale, ...over } = o;
    const kind = over.kind ?? spec0.kind ?? 'melee';
    const spec = mergeSpec(spec0, over, kind, norm(type));
    const sc = scale ?? 1;
    let obj = null;
    try { obj = spec.build ? spec.build(THREE, spec) : null; } catch (err) { console.error(`[weapons] build failed for "${type}"`, err); }
    if (!obj) { const b = builder(); b.box(C.steel, [0.05, 0.05, 0.6], [0, 0, -0.3]); obj = b.finish(); }
    const model = new THREE.Group(), mesh = new THREE.Group();
    model.scale.setScalar(sc); model.add(obj); mesh.add(model);
    let p = position;
    if (!p) {
      const R = input.right;
      p = R && R.connected ? _v1.copy(R.position).addScaledVector(R.direction, 0.4) : _v1.copy(ctx.player.head).addScaledVector(ctx.player.forward, 0.8).add(_v2.set(0, -0.5, 0));
    }
    const radius = (spec.radius ?? 0.13) * Math.max(1, sc);
    // With Rapier a free weapon is a real rotating box fitted to its mesh (grenades stay balls): it lies flat, tumbles, rests against walls.
    // Without it kit's sphere body runs and freeStep fakes the orientation.
    const ball = spec.rest === 'none' && !!spec.grenade;
    let bodyShape = 'sphere', bodySize;
    if (!ball) {
      const bb = new THREE.Box3().setFromObject(mesh), sz = bb.getSize(new Vector3());
      bodyShape = 'box'; bodySize = [Math.max(0.05, sz.x), Math.max(0.05, sz.y), Math.max(0.12, sz.z)];
    }
    const body = kit.body(c, mesh, { position: { x: p.x, y: p.y, z: p.z }, radius, mass: spec.mass ?? 1, bounce: spec.bounce ?? 0.25, friction: 1.2, grabbable: true, grabRange: 5, roll: ball, damage: spec.throwDamage ?? 0, from: 'player', damageKind: kind === 'ranged' ? 'blunt' : meleeKind(spec),
      shape: bodyShape, size: bodySize, rotate: true });
    const gp = arr3(spec.grip && spec.grip.position, [0, 0, 0.02]), gr = arr3(spec.grip && spec.grip.rotation, [0, 0, 0]);
    const pts = (spec.points ?? [[0, 0, -0.55 * (spec.reach ?? 0.8)], [0, 0, -(spec.reach ?? 0.8)]]).map((a) => new Vector3(a[0] * sc, a[1] * sc, a[2] * sc));
    const tr = (spec.trail ?? [[0, 0, -0.35 * (spec.reach ?? 0.8)], [0, 0, -(spec.reach ?? 0.8)]]).map((a) => new Vector3(a[0] * sc, a[1] * sc, a[2] * sc));
    const mz = arr3(spec.muzzle, [0, 0, -0.5]);
    const w = {
      type: spec.type, kind, spec, over, body, mesh, model, ctx: c, parts: obj.userData, glowMat: obj.userData.glowMat ?? null,
      hand: null, manual: false, armed: false, openT: 0, ammo: spec.ammo ?? Infinity, cool: 0, buf: 0, charge: 0, drawing: false, pull: 0, rec: 0, steady: false, buzzT: 0,
      gripQ: new Quaternion().setFromEuler(new Euler(gr[0], gr[1], gr[2])), targetQ: new Quaternion(), restQ: new Quaternion(), restOk: false, yaw: 0, spin: 0,
      pts, cur: pts.map(() => new Vector3()), prv: pts.map(() => new Vector3()), trailA: tr[0], trailB: tr[1], prevOk: false, sp: 0, swooshT: -9, slamT: -9,
      hitT: [null, null, null, null, null, null], hitU: [0, 0, 0, 0, 0, 0], muzzle: new Vector3(mz[0] * sc, mz[1] * sc, mz[2] * sc),
      fly: false, flyT: 0, flyHand: null, side: 1, fuse: -1, led: false, flash: 0, acc: 0, light: null, node: null,
      launch: 0, stuck: false, stuckChk: 0, lastV: new Vector3(), lastSp: 0, tipPrev: new Vector3(), tipOk: false, worldT: -9, deflect: 0, invMass0: body.invMass,
      get held() { return this.body.held === 'left' || this.body.held === 'right' ? this.body.held : null; },
    };
    w.gripPos = new Vector3(gp[0], gp[1], gp[2]);
    const fl = arr3(spec.flame, [0, 0, -0.42]);
    w.flame = new Vector3(fl[0] * sc, fl[1] * sc, fl[2] * sc); // where a flame / sparks come out (torch)
    w.nock = null; w.fit = null; w.mdl = null; w.emis = null; w.pulse = Math.random() * 6.28;
    w.melee = (kind === 'melee' || kind === 'tool' || kind === 'shield') && (spec.damage ?? 0) > 0;
    w.toWorld = (l, out) => { mesh.updateWorldMatrix(true, false); return out.copy(l).applyMatrix4(mesh.matrixWorld); };
    w.remove = () => S.fns.remove(w);
    w.fire = (power = 1) => S.fns.fire(w, power);
    if (spec.light) {
      const la = arr3(spec.lightAt, [0, 0, -0.4]);
      w.node = new THREE.Object3D(); w.node.position.set(la[0] * sc, la[1] * sc, la[2] * sc); model.add(w.node);
      w.light = kit.light(c, Object.assign({}, spec.light)); w.light.target = w.node;
    }
    S.list.push(w);
    if (spec.model) useModel(w, obj);
    if (hand && (hand === 'left' || hand === 'right')) equip(w, hand);
    return w;
  }
  function types() { return Array.from(new Set([...BUILTIN.keys(), ...S.custom.keys()])); }
  function removeWeapon(w) {
    if (w.hand && S.held[w.hand] === w) S.held[w.hand] = null;
    w.hand = null;
    if (w.light) w.light.remove();
    if (w.mdl) { try { w.mdl.remove(); } catch (err) { /* gone */ } w.mdl = null; }
    w.body.remove();
    const i = S.list.indexOf(w);
    if (i >= 0) { S.list[i] = S.list[S.list.length - 1]; S.list.pop(); }
  }

  // manual (sticky) hold: used for tracked hands, spawn-in-hand and boomerang catches. kit only does the first grab.
  function equip(w, name) {
    const h = input[name], b = w.body;
    if (!h || !h.connected || b.held || b.removed) return false;
    if (S.held[name] && S.held[name] !== w) return false;
    h.anchor.updateWorldMatrix(true, false);
    h.anchor.attach(b.mesh);
    b.held = name; b.velocity.set(0, 0, 0);
    w.manual = true; w.armed = false; w.openT = 0;
    return true;
  }
  function detach(w, throwIt) {
    const b = w.body, name = b.held;
    b.mesh.updateWorldMatrix(true, false);
    b.root.attach(b.mesh);
    b.position.copy(b.mesh.position);
    b.held = null; w.manual = false;
    if (throwIt && name) {
      b.velocity.copy(S.hand[name].vel).multiplyScalar(1.1);
      const s = b.velocity.length();
      if (s > 18) b.velocity.multiplyScalar(18 / s);
    } else b.velocity.set(0, 0, 0);
  }
  function changeHeld(w, hand, forced) {
    const old = w.hand, spec = w.spec;
    if (old && !hand) {
      const h = input[old];
      // bare hand relaxed its fingers: keep the weapon (only an open hand lets go)
      if (!forced && h && h.connected && h.tracked && h.fingers.gesture !== 'open' && equip(w, old)) { w.armed = true; return; }
      if (S.held[old] === w) S.held[old] = null;
      w.hand = null; w.prevOk = false; w.drawing = false; w.charge = 0; w.restOk = false; w.steady = false;
      w.launch = 6; w.tipOk = false; w.lastSp = 0; // (frames in which the physics body may still be switching back to dynamic: freeStep gives it its throw spin)
      const sp = w.body.velocity.length();
      if (spec.throw === 'boomerang' && sp > 4.5) startFlight(w, old, sp);
      return;
    }
    if (old && old !== hand && S.held[old] === w) S.held[old] = null;
    if (w.stuck) unstick(w); // pulled out of the wall / ground
    w.hand = hand; S.held[hand] = w;
    w.body.hold.copy(w.gripPos); w.prevOk = false; w.restOk = false; w.armed = !w.manual; w.fly = false;
    endFlightPhysics(w);
    if (spec.grenade && w.fuse < 0) { w.fuse = spec.grenade.fuse; tone({ freq: 900, freqEnd: 400, dur: 0.08, type: 'square', vol: 0.12, at: w.body.position }); }
    if (spec.kind !== 'ranged') tone({ freq: 2600, freqEnd: 3400, dur: 0.12, type: 'triangle', vol: 0.05, at: w.body.position });
    events.emit('weapon:grab', { type: w.type, hand });
  }

  // ------------------------------------------------------------------ per-frame weapon logic
  // How hard a blow shoves: weight x swing speed (kit.hit force >= 6 throws a standing actor back and stuns it). A warhammer (3 kg) at
  // 6 m/s = 16; a dagger (0.4 kg) = 2: it never throws anybody. spec.knock overrides the weight.
  const swingForce = (w, spec, sp) => (spec.knock ?? spec.mass ?? 1) * sp * (spec.kind === 'shield' ? 1.2 : 0.8) * (w.dmgMul ?? 1);
  function foeHit(w, spec, p, t, amount, f, name, hitR, sp) {
    const kit = K(), fo = fx();
    const force = sp > 0 ? swingForce(w, spec, sp) : undefined;
    strikeAt(p, t, hitR, amount, meleeKind(spec), SWING.lengthSq() > 1e-6 ? SWING : null, name, force);
    const PX = ctx.world.physics;
    if (PX && PX.ready && spec.kind === 'shield' && force > 2) PX.explode(p, 1.3, force * 0.6, { lift: 0.25 }); // shield bash: a short shove through loose bodies too
    if (fo) { fo.spark.emit(p, 5 + (f * 9) | 0, undefined, 0.8 + f * 0.6); }
    hitSound(spec.material, p, f);
    if (name) buzz(name, 0.3 + 0.7 * f, 30 + 55 * f);
    if (f > 0.85 && (spec.damage ?? 0) >= 24) kit.flash(ctx, p, { color: 0xffd9a0, intensity: 14, distance: 5, duration: 0.1 });
    events.emit('weapon:hit', { type: w.type, amount, point: p, hand: name });
  }
  function coolOk(w, t, now, cd) {
    for (let i = 0; i < 6; i++) if (w.hitT[i] === t) { if (now < w.hitU[i]) return false; w.hitU[i] = now + cd; return true; }
    let k = 0;
    for (let i = 1; i < 6; i++) if (w.hitU[i] < w.hitU[k]) k = i;
    w.hitT[k] = t; w.hitU[k] = now + cd;
    return true;
  }
  function meleeStep(w, spec, dt, now, name) {
    const M = w.mesh.matrixWorld, n = w.pts.length, kit = K();
    for (let i = 0; i < n; i++) w.cur[i].copy(w.pts[i]).applyMatrix4(M);
    if (!w.prevOk) { for (let i = 0; i < n; i++) w.prv[i].copy(w.cur[i]); w.prevOk = true; w.sp = 0; return; }
    let maxSp = 0, down = 0;
    for (let i = 0; i < n; i++) {
      const s = w.cur[i].distanceTo(w.prv[i]) / dt;
      if (s > maxSp) maxSp = s;
      down = Math.max(down, (w.prv[i].y - w.cur[i].y) / dt);
    }
    if (maxSp > 45) { for (let i = 0; i < n; i++) w.prv[i].copy(w.cur[i]); return; } // snap turn / teleport spike
    w.sp += (maxSp - w.sp) * (1 - Math.exp(-25 * dt));
    const R = ribbons[name];
    R.a.copy(w.trailA).applyMatrix4(M); R.b.copy(w.trailB).applyMatrix4(M);
    R.i = clamp((w.sp - 1.6) / 5, 0, 1) * 0.6; R.fresh = true; R.color.setHex(spec.trailColor ?? 0xbfd8ff);
    if (maxSp > 3.3 && now - w.swooshT > 0.3) { w.swooshT = now; swingSound(w.cur[n - 1], maxSp); }
    if (!kit) { for (let i = 0; i < n; i++) w.prv[i].copy(w.cur[i]); return; }
    const vMin = spec.vMin ?? 2, vFull = spec.vFull ?? 5.5, hitR = spec.hitRadius ?? 0.14, cd = spec.hitCooldown ?? 0.4;
    for (let i = 0; i < n; i++) {
      const A = w.prv[i], B = w.cur[i], len = A.distanceTo(B), sp = len / dt;
      if (sp < vMin) continue;
      const f = clamp((sp - vMin) / Math.max(0.1, vFull - vMin), 0, 1), samples = Math.max(1, Math.min(6, Math.ceil(len / 0.2)));
      for (let k = 1; k <= samples; k++) {
        _v1.lerpVectors(A, B, k / samples);
        SWING.subVectors(B, A).normalize(); // the way the blade is travelling (the blow's direction)
        const t = foe(_v1, hitR);
        if (t && coolOk(w, t, now, cd)) foeHit(w, spec, _v1, t, (spec.damage ?? 0) * (0.3 + 0.7 * f) * (w.dmgMul ?? 1), f, name, hitR, sp);
      }
    }
    // blades against the world (Rapier raycast along the swept tip segment, only on fast swings): sparks, a clang, the blade kicks back a little
    const PX = ctx.world.physics;
    if (PX && PX.ready && w.sp > 3.2 && now - w.worldT > 0.14) {
      for (let i = n - 1; i >= Math.max(0, n - 2); i--) {
        const A = w.prv[i], B = w.cur[i], len = A.distanceTo(B);
        if (len < 0.02) continue;
        _v2.subVectors(B, A).multiplyScalar(1 / len);
        const rc = PX.raycast(A, _v2, len + 0.03, { groups: 'world' });
        if (rc && rc.kind === 'static') {
          const f = clamp((w.sp - 3) / 4, 0.2, 1), fo = fx();
          w.worldT = now; w.deflect = Math.max(w.deflect, 0.4 + 0.6 * f);
          if (fo) fo.spark.emit(rc.point, 4 + (f * 8) | 0, undefined, 0.7 + f * 0.5);
          hitSound(spec.material === 'fire' ? 'steel' : spec.material, rc.point, f * 0.7); buzz(name, 0.3 + 0.5 * f, 30);
          break;
        }
      }
    }
    // ground slam / mining: a point driving into the terrain
    if (spec.slam && down > 3.2 && now - w.slamT > 0.4) {
      for (let i = 0; i < n; i++) {
        const p = w.cur[i];
        if (p.y <= ctx.groundAt(p.x, p.z) + 0.1) {
          const fo = fx(), S2 = spec.slam, f = clamp(down / 7, 0.3, 1);
          w.slamT = now; _v1.set(p.x, ctx.groundAt(p.x, p.z) + 0.05, p.z);
          if (fo) { fo.dust.emit(_v1, 8 + (S2.radius * 6) | 0, undefined, 0.8 + S2.radius * 0.3); fo.spark.emit(_v1, 8); }
          const sf = (spec.mass ?? 1) * (2 + S2.radius * 2) * f; // slam shove: heavy hammers throw people, light picks just thump
          if (S2.damage > 0) kit.hit(_v1, S2.radius, S2.damage * f, hitOpts('blunt', null, name, sf)); else kit.hit(_v1, 0.5, 2, hitOpts('blunt', null, name, Math.min(sf, 3)));
          if (PX && PX.ready && S2.radius >= 1.0) PX.explode(_v1, S2.radius * 2, 2.5 * (spec.mass ?? 1) * f, { lift: 0.5 }); // the shockwave reaches crates and debris beyond the blow
          hitSound('blunt', _v1, f); buzz(name, 0.5 + 0.5 * f, 70);
          if (S2.radius >= 1.2) kit.flash(ctx, _v1, { color: 0xffd9a0, intensity: 10, distance: 5, duration: 0.12 });
          break;
        }
      }
    }
    for (let i = 0; i < n; i++) w.prv[i].copy(w.cur[i]);
  }

  function spreadDir(out, dir, ang) {
    if (ang <= 0) return out.copy(dir);
    const a = Math.abs(dir.y) > 0.95 ? AXX : UP;
    _v3.crossVectors(dir, a).normalize(); _v4.crossVectors(dir, _v3);
    const th = ang * Math.sqrt(Math.random()), ph = Math.random() * tau;
    return out.copy(dir).addScaledVector(_v3, Math.cos(ph) * th).addScaledVector(_v4, Math.sin(ph) * th).normalize();
  }
  function fireWeapon(w, power = 1) {
    const spec = w.spec, name = w.hand, kit = K();
    if (!kit || w.body.removed) return false;
    if (w.ammo <= 0) { tone({ freq: 700, freqEnd: 500, dur: 0.04, type: 'square', vol: 0.08, at: w.body.position }); if (w.ammo === 0) { w.ammo = -1; if (ctx.hud) ctx.hud.show('out of ammo', 1.4); } return false; }
    w.mesh.updateWorldMatrix(true, false);
    const origin = _v1.copy(w.muzzle).applyMatrix4(w.mesh.matrixWorld), dir = _v2.set(0, 0, -1).transformDirection(w.mesh.matrixWorld);
    if (spec.fire) {
      try { spec.fire({ origin: origin.clone(), direction: dir.clone(), weapon: w, ctx: w.ctx, power }); } catch (err) { console.error(`[weapons] ${w.type}.fire failed`, err); }
    } else if (spec.projectile) {
      const P = spec.projectile, arrow = P.kind === 'arrow', draw = spec.draw ? 0.33 + 0.67 * power : 1, dmgK = spec.draw ? 0.4 + 0.6 * power : 1;
      const n = P.pellets ?? 1, spread = (P.spread ?? 0) * (w.steady ? 0.55 : 1), D = _v5;
      for (let i = 0; i < n; i++) { spreadDir(D, dir, spread); spawnProj(arrow, origin, D, (P.speed ?? 60) * draw, P, (P.damage ?? spec.damage ?? 5) * dmgK, spec, name); }
    }
    const f = fx();
    if (spec.flash && f) {
      f.flash.emit(origin, 3, undefined, spec.flash.size ?? 1);
      kit.flash(ctx, origin, { color: spec.flash.color ?? 0xffd080, intensity: 10 * (spec.flash.size ?? 1), distance: 6, duration: 0.07 });
      if (spec.smoke) f.smoke.emit(origin, 3, dir);
    }
    const snd = typeof spec.sound === 'function' ? spec.sound : SHOT[spec.sound];
    if (snd) snd(origin);
    w.rec = 1; w.cool = spec.rate ?? 0.3; w.ammo = w.ammo === Infinity ? Infinity : w.ammo - 1;
    if (name) { const hp = spec.haptic ?? [0.5, 50]; buzz(name, hp[0], hp[1]); }
    events.emit('weapon:fire', { type: w.type, hand: name });
    return true;
  }
  function rangedStep(w, spec, dt, h, name) {
    w.cool -= dt;
    if (ctx.world.menu && ctx.world.menu.capturing) { w.drawing = false; w.charge = 0; w.buf = 0; return; } // the hand ray is on the wrist menu: no shots through it
    if (spec.draw) {
      if (h.down.trigger && w.cool <= 0) {
        if (!w.drawing) { w.drawing = true; w.charge = 0; w.buzzT = 0; tone({ freq: 90, freqEnd: 140, dur: spec.draw, type: 'triangle', vol: 0.08, at: w.body.position }); }
        w.charge = Math.min(1, w.charge + dt / spec.draw);
        w.buzzT -= dt;
        if (w.buzzT <= 0) { w.buzzT = 0.05; buzz(name, 0.05 + 0.5 * w.charge * w.charge, 35); }
      } else if (w.drawing) {
        w.drawing = false;
        if (w.charge > 0.12) fireWeapon(w, w.charge); else tone({ freq: 400, freqEnd: 200, dur: 0.06, type: 'triangle', vol: 0.08, at: w.body.position });
        w.charge = 0;
      }
      return;
    }
    if (h.pressed('trigger')) w.buf = 0.18;
    w.buf -= dt;
    if (w.cool <= 0 && (spec.auto ? h.down.trigger : w.buf > 0)) { w.buf = 0; fireWeapon(w, 1); }
  }

  function aimPose(w, spec, h, name) {
    w.steady = false;
    w.targetQ.copy(w.gripQ);
    if (!(spec.twoHanded && spec.kind === 'ranged')) return;
    const o = input[name === 'left' ? 'right' : 'left'];
    if (!o || !o.connected || !holdSignal(o)) return;
    const d = o.position.distanceTo(h.position);
    if (d < 0.12 || d > 0.7) return;
    _v3.subVectors(o.position, h.position).multiplyScalar(1 / d);
    if (_v3.dot(h.direction) < 0.82) return; // support hand is not out along the barrel
    _q1.copy(h.quaternion).invert();
    _v3.applyQuaternion(_q1);
    w.targetQ.setFromUnitVectors(FWD, _v3).multiply(w.gripQ);
    w.steady = true;
  }
  function heldStep(w, spec, dt, t, name) {
    const h = input[name], b = w.body, now = ctx.clock.t;
    if (w.manual) {
      if (holdSignal(h)) { w.armed = true; w.openT = 0; }
      else if (w.armed) {
        w.openT += dt;
        if (!h.connected || w.openT > (h.tracked ? 0.18 : 0)) { const c = h.connected; detach(w, c); changeHeld(w, null, true); return; }
      }
    }
    const k = 1 - Math.exp(-20 * dt), mesh = b.mesh;
    if (w.manual) {
      mesh.position.lerp(b.hold, k);
      b.position.copy(h.position).addScaledVector(h.direction, -b.hold.z);
      b.velocity.copy(S.hand[name].vel);
    }
    aimPose(w, spec, h, name);
    mesh.quaternion.slerp(w.targetQ, k);
    w.model.position.y -= w.model.position.y * k;
    if (w.melee) { // the blade kicks back a little when it clangs against the world (see meleeStep)
      if (w.deflect > 0.002) { w.deflect *= Math.exp(-14 * dt); w.model.position.z = w.deflect * 0.05; w.model.rotation.x = -w.deflect * 0.12; }
      else if (w.deflect !== 0) { w.deflect = 0; w.model.position.z = 0; w.model.rotation.x = 0; }
    }
    mesh.updateWorldMatrix(true, false);
    if (spec.kind === 'ranged') rangedStep(w, spec, dt, h, name);
    else if (w.melee) meleeStep(w, spec, dt, now, name);
  }

  function computeRest(w, spec) {
    _v1.set(0, 0, -1).applyQuaternion(w.body.mesh.quaternion);
    if (_v1.x * _v1.x + _v1.z * _v1.z > 0.01) w.yaw = Math.atan2(-_v1.x, -_v1.z);
    w.restQ.setFromAxisAngle(UP, w.yaw);
    if (spec.rest === 'up') w.restQ.multiply(_q2.setFromAxisAngle(AXX, Math.PI / 2));
    w.restOk = true;
  }
  function startFlight(w, hand, sp) {
    const b = w.body;
    w.fly = true; w.flyT = 0; w.flyHand = hand; w.spin = 0; w.side = hand === 'left' ? -1 : 1; w.prevOk = false;
    b.gravity = 0; b.drag = 0; b.damage = 0;
    b.velocity.multiplyScalar(clamp(sp, 12, 21) / sp);
    b.velocity.y *= 0.3;
  }
  function endFlightPhysics(w) { if (w.body.gravity === 0) { w.body.gravity = 9.8; w.body.drag = 0.05; w.body.damage = w.spec.throwDamage ?? 0; } }
  function flightStep(w, spec, dt) {
    const b = w.body, kit = K(), v = b.velocity, now = ctx.clock.t;
    w.flyT += dt; w.spin += 24 * dt;
    const head = ctx.player.head;
    _v2.set(head.x, head.y - 0.45, head.z);
    const sp = Math.max(0.01, v.length());
    if (w.flyT < 0.65) { _v3.set(v.z, 0, -v.x).multiplyScalar((w.side * 15) / sp); v.addScaledVector(_v3, dt); v.multiplyScalar(Math.exp(-0.7 * dt)); }
    else { _v3.subVectors(_v2, b.position).normalize().multiplyScalar(clamp(sp, 11, 19)); v.lerp(_v3, 1 - Math.exp(-3.4 * dt)); }
    const gy = ctx.groundAt(b.position.x, b.position.z);
    if (b.position.y < gy + 0.4) v.y += 12 * dt;
    if (usePhys(w)) b.ph.setAngularVelocity(0, 24, 0); else b.mesh.rotation.set(0.1 * w.side, w.spin, 0); // (physics owns the mesh orientation)
    if (kit) {
      const t = foe(b.position, 0.5);
      if (t) SWING.copy(v).normalize();
      if (t && coolOk(w, t, now, 0.5)) foeHit(w, spec, b.position, t, (spec.damage ?? 10) * (w.dmgMul ?? 1), 0.8, w.flyHand, 0.5, v.length());
    }
    const dist = b.position.distanceTo(_v2);
    if (w.flyT > 0.6 && dist < 0.8) {
      endFlightPhysics(w); w.fly = false; v.set(0, 0, 0); w.restOk = false;
      if (w.flyHand && equip(w, w.flyHand)) { w.armed = false; buzz(w.flyHand, 0.7, 60); tone({ freq: 500, freqEnd: 900, dur: 0.12, type: 'triangle', vol: 0.15, at: b.position }); }
    } else if (w.flyT > 4.5 || (b.grounded && w.flyT > 0.3)) { endFlightPhysics(w); w.fly = false; w.restOk = false; }
  }
  // ---- physical free weapons (Rapier): the body tumbles, lies flat and rests on its own; we only add the throw spin, point-first
  // alignment for spears and daggers, and sticking (a tip that reaches a wall, a prop or the ground at speed stays there until grabbed).
  const usePhys = (w) => { const p = w.body.ph; return !!(p && !p.removed && ctx.world.physics && ctx.world.physics.ready); };
  const _fw = new Vector3(), _tp = new Vector3(), _sq = new Quaternion(), _sa = new Vector3();
  function unstick(w) {
    const b = w.body;
    w.stuck = false; b.invMass = w.invMass0; w.launch = 0; w.tipOk = false;
    if (b.ph && !b.ph.removed) {
      if (w.stuckG != null && b.ph.collider) { try { b.ph.collider.setCollisionGroups(w.stuckG); } catch (err) { /* collider gone */ } } // back to the collision group it had before it stuck
      b.ph.wake();
    }
    w.stuckG = null;
  }
  function stickAt(w, spec, point, dir, normal) {
    const b = w.body, fo = fx();
    _sq.setFromUnitVectors(FWD, dir);                        // blade along the way it was flying
    const tip = w.pts[w.pts.length - 1];
    _tp.copy(tip).applyQuaternion(_sq);                       // tip offset from the grip in world axes
    b.position.copy(point).addScaledVector(dir, 0.11).sub(_tp); // sunk ~11 cm into the surface
    b.velocity.set(0, 0, 0);
    b.ph.setVelocity(0, 0, 0); b.ph.setAngularVelocity(0, 0, 0); b.ph.setTransform(b.position, _sq); // (also writes the mesh)
    b.invMass = 0;                                            // kit pins it (a fixed body) until somebody grabs it
    const PX = ctx.world.physics, col = b.ph.collider;
    if (col && PX && PX.groups && PX.groups.prop != null) { // a stuck weapon is scenery: in the 'prop' group the player's / NPCs' character controllers walk through it (it is still hit by rays and bodies, and grabbed by distance as before)
      if (w.stuckG == null) w.stuckG = col.collisionGroups();
      col.setCollisionGroups(PX.groups.prop);
    }
    w.stuck = true; w.stuckChk = 0.6; w.fly = false; w.launch = 0;
    if (fo) { fo.spark.emit(point, 6, undefined, 0.8); fo.dust.emit(point, 3); }
    hitSound(spec.material === 'wood' ? 'wood' : 'steel', point, 0.5);
    events.emit('weapon:stick', { type: w.type, point });
  }
  function physFree(w, spec, dt) {
    const b = w.body, ph = b.ph, v = ph.velocity, sp = v.length(), PX = ctx.world.physics;
    w.model.position.z -= w.model.position.z * (1 - Math.exp(-12 * dt)); w.model.position.y -= w.model.position.y * (1 - Math.exp(-12 * dt));
    if (w.stuck) { // is the thing it is stuck in still there? (a wall can break, a spawned prop can be removed)
      w.stuckChk -= dt;
      if (w.stuckChk <= 0) {
        w.stuckChk = 0.6;
        _fw.set(0, 0, -1).applyQuaternion(b.mesh.quaternion);
        _tp.copy(w.pts[w.pts.length - 1]).applyQuaternion(b.mesh.quaternion).add(b.position).addScaledVector(_fw, -0.3); // from behind the surface it is stuck in, along the blade
        if (!PX.raycast(_tp, _fw, 0.6, { groups: 'world', exclude: b.ph })) unstick(w); // (not counting its own collider, which sits in the 'world' ray mask while stuck)
      }
      return;
    }
    if (ph.type !== 'dynamic') return;
    if (w.launch > 0) { // the throw: give it the rotation its type wants (once the body is dynamic again)
      w.launch = 0;
      if (sp > 2.5 && spec.throw === 'spin') { _sa.set(v.z, 0, -v.x).normalize(); ph.setAngularVelocity(_sa.x * Math.min(18, sp * 1.5), 0, _sa.z * Math.min(18, sp * 1.5)); } // end over end across the flight path
      else if (sp > 2.5 && spec.throw === 'align') ph.setAngularVelocity(0, 0, 0);
    }
    if (spec.throw === 'align') {
      b.mesh.updateWorldMatrix(true, false);
      _fw.set(0, 0, -1).applyQuaternion(ph.quaternion);
      const tipNow = _tp.copy(w.pts[w.pts.length - 1]).applyMatrix4(b.mesh.matrixWorld);
      // stick: sweep the tip's path of this frame, along the velocity it had BEFORE the physics step (which may already have stopped it)
      if (w.tipOk && w.lastSp > 5 && PX.raycast) {
        _sa.copy(w.lastV).multiplyScalar(1 / w.lastSp);
        if (_sa.dot(_fw) > 0.55) {
          const rc = PX.raycast(w.tipPrev, _sa, w.lastSp * dt * 1.7 + 0.12, { groups: 'world' });
          if (rc && (rc.kind === 'static' || (rc.kind === 'ground' && _sa.y < -0.3))) { stickAt(w, spec, rc.point, _sa, rc.normal); return; }
        }
      }
      w.tipPrev.copy(tipNow); w.tipOk = true;
      if (sp > 5 && !b.grounded) { // keep it flying point-first (a spear does not tumble): spin toward the velocity, no roll
        _sa.crossVectors(_fw, _tp.copy(v).multiplyScalar(1 / sp)); // f x t
        ph.setAngularVelocity(_sa.x * 14, _sa.y * 14, _sa.z * 14);
      }
    }
    w.lastV.copy(v); w.lastSp = sp;
  }
  function freeStep(w, spec, dt) {
    const b = w.body, mesh = b.mesh;
    if (w.fly) { flightStep(w, spec, dt); return; }
    if (spec.rest !== 'none' && usePhys(w)) { physFree(w, spec, dt); return; }
    w.model.position.z -= w.model.position.z * (1 - Math.exp(-12 * dt));
    if (spec.rest === 'none') return;
    const v = b.velocity, sp = v.length();
    if (!b.grounded && sp > 3 && spec.throw !== 'none') {
      w.restOk = false;
      _v1.copy(v).multiplyScalar(1 / sp);
      _q1.setFromUnitVectors(FWD, _v1);
      if (spec.throw === 'spin') { w.spin += 16 * dt; _q1.multiply(_q2.setFromAxisAngle(AXX, w.spin)); }
      mesh.quaternion.slerp(_q1, 1 - Math.exp(-14 * dt));
    } else if (b.grounded || sp < 3) {
      if (!w.restOk) computeRest(w, spec);
      mesh.quaternion.slerp(w.restQ, 1 - Math.exp(-9 * dt));
    }
    const wantY = b.grounded ? -b.radius * 0.55 : 0;
    w.model.position.y += (wantY - w.model.position.y) * (1 - Math.exp(-10 * dt));
  }
  function stepWeapon(w, dt, t) {
    const b = w.body;
    if (w.lastV === undefined) { w.launch = 0; w.stuck = false; w.stuckChk = 0; w.lastV = new Vector3(); w.lastSp = 0; w.tipPrev = new Vector3(); w.tipOk = false; w.worldT = -9; w.deflect = 0; w.invMass0 = b.invMass || 1; } // made by an older version of this file
    if (b.removed) { if (w.hand && S.held[w.hand] === w) S.held[w.hand] = null; return false; }
    const spec = w.spec;
    const hand = b.held === 'left' || b.held === 'right' ? b.held : null;
    if (hand !== w.hand) changeHeld(w, hand, false);
    if (w.rec > 0.001) w.rec += (0 - w.rec) * (1 - Math.exp(-14 * dt)); else w.rec = 0;
    if (w.hand) heldStep(w, spec, dt, t, w.hand); else freeStep(w, spec, dt);
    if (spec.kind === 'ranged') { // recoil kick on the model, independent of the grip
      const r = spec.recoil || KIND_DEFAULTS.ranged.recoil;
      w.model.position.z = w.rec * r.z; w.model.rotation.x = w.rec * r.rx;
    }
    if (w.emis) { // hero model: the 'Emissive' material pulses (own cloned materials, so other weapons are untouched)
      const k = 0.9 + 0.22 * Math.sin(t * 3 + w.pulse) + w.rec * 1.4 + w.flash * 1.5;
      for (let i = 0; i < w.emis.length; i++) w.emis[i].emissiveIntensity = w.emis[i].userData.ei * k;
    }
    if (spec.tick) { try { spec.tick(w, dt, t); } catch (err) { console.error(`[weapons] ${w.type}.tick failed; disabled`, err); spec.tick = null; } }
    return !b.removed;
  }

  // ------------------------------------------------------------------ shields
  const _sc1 = new Vector3(), _sn = new Vector3(), _sd = new Vector3();
  function blocks(point, dir, feedback = true) {
    const now = nowT();
    for (let hi = 0; hi < 2; hi++) {
      const w = S.held[SIDES[hi]];
      if (!w || w.kind !== 'shield' || w.body.removed) continue;
      const m = w.body.mesh;
      m.updateWorldMatrix(true, false);
      const sc = arr3(w.spec.shieldCenter, [0, 0, -0.14]);
      _sc1.set(sc[0], sc[1], sc[2]).applyMatrix4(m.matrixWorld);
      _sn.set(0, 0, -1).transformDirection(m.matrixWorld);
      if (_sn.dot(dir) < 0.25) continue;                           // attacker is not in front of the shield
      _sd.subVectors(_sc1, point);
      const s = _sd.dot(dir);
      if (Math.abs(s) > 3) continue;                                // shield nowhere near this attack
      _sd.addScaledVector(dir, -s);
      const R = (w.spec.shieldRadius ?? 0.33) + 0.12;
      if (_sd.lengthSq() > R * R) continue;                         // line passes beside the shield
      if (feedback && now - (w.blockT ?? -9) > 0.1) {
        w.blockT = now; w.flash = 1;
        const f = fx();
        _v5.copy(_sc1).addScaledVector(_sn, 0.05);
        if (f) f.spark.emit(_v5, 10, undefined, 0.9);
        tone({ freq: 1500, freqEnd: 700, dur: 0.3, type: 'triangle', vol: 0.18, at: _v5 }); tone({ freq: 160, freqEnd: 60, dur: 0.15, vol: 0.3, at: _v5 });
        buzz(w.hand, 0.85, 70);
      }
      return true;
    }
    return false;
  }
  // combat.js lets a handler veto an attack that is aimed at the player
  ctx.on('combat:attack', (e) => {
    if (e.blocked || !e.target || !e.target.isPlayer) return;
    const P = ctx.player;
    if (e.kind === 'projectile' && e.projectile) {
      const p = e.projectile;
      _v3.set(p.vx ?? 0, p.vy ?? 0, p.vz ?? 0);
      if (_v3.lengthSq() < 1e-6) return;
      _v3.normalize().negate();
      _v4.set(p.x ?? e.point.x, p.y ?? e.point.y, p.z ?? e.point.z);
    } else {
      const a = e.attacker && e.attacker.actor ? e.attacker.actor.position : null;
      if (!a) return;
      _v3.set(a.x - P.head.x, 0, a.z - P.head.z);
      if (_v3.lengthSq() < 1e-6) return;
      _v3.normalize();
      _v4.set(P.head.x, P.head.y - 0.3, P.head.z);
    }
    if (blocks(_v4, _v3, true)) e.blocked = true;
  });

  // ------------------------------------------------------------------ module surface
  S.fns.remove = removeWeapon; S.fns.fire = fireWeapon;
  for (const w of S.list) { const s0 = lookup(w.type); if (s0) { w.spec = mergeSpec(s0, w.over ?? {}, w.kind, w.type); if (w.fit) fitSpec(w); } } // adopt this version's type definitions
  const api = {
    create(c, type, opts) { try { return weaponIn(c ?? ctx, type, opts ?? {}); } catch (err) { console.error('[weapons] create failed', err); return null; } },
    define(type, spec) {
      if (!type || !spec) return () => {};
      const n = String(type).toLowerCase().trim().replace(/[\s_]+/g, '-');
      const s = Object.assign({}, spec);
      S.custom.set(n, s);
      return () => { if (S.custom.get(n) === s) S.custom.delete(n); };
    },
    types, held: S.held, blocks, list: () => S.list,
    reloadGearMap: loadGearMap, gearMap: () => (S.gear ? [...S.gear.keys()] : []),
  };
  ctx.provide('weapons', api);
  loadGearMap();

  return {
    update(dt, t) {
      dt = Math.min(dt, 0.05);
      if (dt <= 0) return;
      for (let hi = 0; hi < 2; hi++) { const name = SIDES[hi]; // smoothed hand velocity (for throws and tracked-hand release)
        const h = input[name], H = S.hand[name];
        if (h.connected && H.has) {
          const ix = (h.position.x - H.prev.x) / dt, iy = (h.position.y - H.prev.y) / dt, iz = (h.position.z - H.prev.z) / dt;
          if (ix * ix + iy * iy + iz * iz < 1600) { const k = 1 - Math.exp(-20 * dt); H.vel.x += (ix - H.vel.x) * k; H.vel.y += (iy - H.vel.y) * k; H.vel.z += (iz - H.vel.z) * k; }
        } else H.vel.set(0, 0, 0);
        H.prev.copy(h.position); H.has = h.connected;
      }
      stepProjectiles(dt);
      for (let i = S.list.length - 1; i >= 0; i--) {
        const w = S.list[i];
        let keep = true;
        try { keep = stepWeapon(w, dt, t); } catch (err) { console.error(`[weapons] ${w.type} step failed; removing`, err); try { removeWeapon(w); } catch (e2) { /* ignore */ } keep = true; continue; }
        if (!keep) { const j = S.list.indexOf(w); if (j >= 0) { S.list[j] = S.list[S.list.length - 1]; S.list.pop(); } }
      }
      stepRibbon(ribbons.left); stepRibbon(ribbons.right);
    },
    dispose() { /* weapons persist in ctx.state; effects live under our root and are removed with it */ },
  };
}
