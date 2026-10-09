// library/nature.js - trees, plants, rocks, crystals, water and forests. Each entry has a vertex-coloured PRIMITIVE build (fallback) and a MODEL build
// (mx.model() at the bottom, see modelkit.js). Trees are kit.fellable (they block; primitive trunks use H.blk); forests instance every tree and promote
// the ~12 nearest to real fellable models. Rocks, logs, stumps, cacti, cliffs and mountains are solid via H.blk (never created on top of the player).
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, shade, mix, model, rng } = H;
  const PI = Math.PI;
  const mx = H.mx; // installed by structures.js (loaded earlier); null-safe so the primitive library still works without it
  const blk = H.blk ?? { box() {}, cyl() {}, piece() {}, part() {}, item() {} }; // H.blk (structures.js): solid colliders that appear only once the player is clear of them
  const anyBroken = (i) => () => (i.broken | 0) > 0;
  const treeTrunk = (i, p, hh) => { // primitive tree (one merged mesh): a trunk-sized blocker instead of kit's canopy-wide cylinder
    if (!p || !p.isObject3D) return;
    const bb = new THREE.Box3().setFromObject(p), H0 = Math.max(1, bb.max.y - bb.min.y);
    blk.cyl(i, 0, 0, clamp(0.05 * H0, 0.18, 0.45), Math.min(H0, 6), { gone: () => !hh || hh.falling || hh.fallen || hh.removed });
  };
  const wrap = (name, b) => (mx ? mx.wrap(name, b) : b);
  const reg = (name, spec) => { if (mx) mx.model(name, spec); };
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'nature', description, options, aliases, build: wrap(name, build), ...extra });
  const _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 0.6, 0);
  const near = (p, r) => { const dx = H.head.x - p.x, dz = H.head.z - p.z; return dx * dx + dz * dz < r * r; };
  const GREENS = [0x4f8f3a, 0x5aa044, 0x3f7a30, 0x6aae4c, 0x468a38], PINES = [0x2f6a3f, 0x275a35, 0x367648, 0x3b7a4a];
  const AUTUMNS = [0xd8742a, 0xe8a030, 0xb8402a, 0xc8902a, 0xd8602a];
  const BARK = [0x6a4a2a, 0x5a3e24, 0x74522f];
  const M = () => H.ctx.world.models ?? null;
  const waterAt = (x, z) => !!H.ctx.world.env?.isWater?.(x, z);

  // ---------------------------------------------------------------- tree models (cached; v = variant)
  const treeModel = {
    oak(v) {
      return model('oak' + v, (b) => {
        const r = rng(11 + v * 7), h = 2.3 + r() * 0.8;
        b.cyl(0, -0.2, 0, 0.2, 0.4, h + 0.2, pick(BARK), 0, 7);
        for (let k = 0; k < 4; k++) { const a = r() * TAU; b.cone(Math.cos(a) * 0.3, 0.0, Math.sin(a) * 0.3, 0.14, 0.7, 0x5a3e24, [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 4); }
        for (let k = 0; k < 3; k++) { const a = r() * TAU; b.cyl(0, h - 0.5, 0, 0.07, 0.12, 1.2, 0x5a3e24, [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 5); }
        const n = 6 + ((r() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + r(), rad = k === 0 ? 0 : 0.8 + r() * 0.7, s = 1.0 + r() * 0.6;
          b.sph(Math.cos(a) * rad, h + 0.9 + r() * 1.5 + (k === 0 ? 0.8 : 0), Math.sin(a) * rad, s, s * 0.85, s, GREENS[(r() * GREENS.length) | 0], [r(), r(), 0], 7);
        }
      });
    },
    autumn(v) {
      return model('autumn' + v, (b) => {
        const r = rng(91 + v * 7), h = 2.3 + r() * 0.8;
        b.cyl(0, -0.2, 0, 0.2, 0.4, h + 0.2, 0xe8e4d8, 0, 7);
        for (let k = 0; k < 3; k++) { const a = r() * TAU; b.cyl(0, h - 0.5, 0, 0.07, 0.12, 1.2, 0xd8d0c0, [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 5); }
        const n = 6 + ((r() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + r(), rad = k === 0 ? 0 : 0.8 + r() * 0.7, s = 1.0 + r() * 0.6;
          b.sph(Math.cos(a) * rad, h + 0.9 + r() * 1.5 + (k === 0 ? 0.8 : 0), Math.sin(a) * rad, s, s * 0.85, s, AUTUMNS[(r() * AUTUMNS.length) | 0], [r(), r(), 0], 7);
        }
      });
    },
    pine(v) {
      return model('pine' + v, (b) => {
        const r = rng(31 + v * 5), tiers = 4 + (v % 2);
        b.cyl(0, -0.2, 0, 0.14, 0.26, 2.0, 0x5a3e24, 0, 6);
        for (let k = 0; k < tiers; k++) { const t = k / tiers; b.cone(0, 1.0 + k * 1.05, 0, 1.7 - t * 1.05, 1.9 - t * 0.5, PINES[(r() * PINES.length) | 0], r(), 7); }
        b.cone(0, 1.0 + tiers * 1.05 - 0.2, 0, 0.35, 0.9, 0x3b7a4a, 0, 6);
      });
    },
    birch(v) {
      return model('birch' + v, (b) => {
        const r = rng(51 + v * 3), h = 4 + r() * 1.2;
        b.cyl(0, -0.2, 0, 0.1, 0.16, h, 0xe8e4d8, 0, 6);
        for (let k = 0; k < 7; k++) b.box(0, 0.4 + k * 0.6, 0, 0.215 - k * 0.012, 0.07, 0.215 - k * 0.012, 0x2a2a2a, [0, r() * 3, 0]);
        for (let k = 0; k < 6; k++) { const a = r() * TAU, rad = 0.4 + r() * 0.6; b.sph(Math.cos(a) * rad, h - 0.3 + r() * 1.3, Math.sin(a) * rad, 0.75 + r() * 0.4, 0.65, 0.75 + r() * 0.4, pick([0x9ac84a, 0xb4d85a, 0x8ab83c, 0xc8e070]), [r(), r(), 0], 6); }
      });
    },
    palm(v) {
      return model('palm' + v, (b) => {
        const r = rng(71 + v * 5), lean = (r() - 0.5) * 1.2, dir = r() * TAU;
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 9; k++) { const t = k / 9, a = 0.06 + t * 0.14; const nx = x + Math.cos(dir) * Math.sin(a) * 0.55 * lean * 2, nz = z + Math.sin(dir) * Math.sin(a) * 0.55 * lean * 2; b.cyl(x, y, z, 0.2 - t * 0.09, 0.22 - t * 0.09, 0.62, k % 2 ? 0x8a6a40 : 0x7a5a38, [Math.sin(dir) * a * lean * 2, 0, -Math.cos(dir) * a * lean * 2], 6); x = nx; z = nz; y += 0.58; }
        for (let f = 0; f < 9; f++) {
          const a = (f / 9) * TAU + (r() - 0.5) * 0.3, len = 6;
          for (let j = 0; j < len; j++) { const u = j * 0.42, vv = u * 0.55 - u * u * 0.16; b.mode('cloth'); b.box(x + Math.cos(a) * (u + 0.25), y + 0.15 + vv, z + Math.sin(a) * (u + 0.25), 0.5, 0.025, 0.3 - j * 0.035, f % 2 ? 0x4aa044 : 0x3a8a38, [0, -a, -(0.55 - j * 0.18) * 0.7 + 0.0]); }
          b.mode('solid');
        }
        for (let k = 0; k < 3; k++) b.sph(x + (r() - 0.5) * 0.4, y - 0.15, z + (r() - 0.5) * 0.4, 0.16, 0.16, 0.16, 0x5a3a1c);
      });
    },
    dead(v) {
      return model('dead' + v, (b) => {
        const r = rng(111 + v * 9);
        b.cyl(0, -0.2, 0, 0.12, 0.38, 3.8, 0x6a6460, [r() * 0.1 - 0.05, 0, r() * 0.1 - 0.05], 6);
        for (let k = 0; k < 5; k++) { const a = r() * TAU, y = 1.4 + r() * 2.2, ln = 1.0 + r() * 1.3; b.cyl(0, y, 0, 0.03, 0.09, ln, 0x5a5450, [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0], 4); const ex = Math.sin(a) * ln * 0.8, ez = Math.cos(a) * ln * 0.8; b.cyl(ex, y + ln * 0.55, ez, 0.015, 0.04, 0.7, 0x5a5450, [Math.sin(a + 0.8) * 0.9, 0, -Math.cos(a + 0.8) * 0.9], 4); }
        b.cone(0, 3.5, 0, 0.1, 0.9, 0x5a5450, [0.2, 0, 0.1], 4);
        b.cone(0, -0.2, 0, 0.45, 0.4, 0x5a4a38, 0, 6);
      });
    },
  };
  const pickTree = (kind) => treeModel[kind]((Math.random() * 3) | 0);
  // gentle sway for a lone tree (cheap: only while near)
  function sway(i, m, amp = 0.012) {
    const ph = rand(0, 6);
    i.tick((dt, t) => { if (Math.abs(H.head.x - i.x) + Math.abs(H.head.z - i.z) > 70) return; const w = 0.4 + (H.ctx.world.env?.wind ?? 0.5); m.rotation.z = Math.sin(t * 0.9 * w + ph) * amp * w; m.rotation.x = Math.sin(t * 0.7 * w + ph * 1.7) * amp * 0.7 * w; }, { every: 0.05 });
  }
  const placeTree = (i, o, kind, amp = 0.012, jit = [0.9, 1.15]) => { const m = pickTree(kind); m.scale.setScalar((o.scale ?? 1) * rand(jit[0], jit[1])); m.rotation.y = rand(0, TAU); m.position.y = -0.1; i.add(m); if (amp) sway(i, m, amp); return m; };

  // ---------------------------------------------------------------- shared helpers for the model builds
  const info = (name) => M()?.info?.(name) ?? null;
  // uniform scale (relative to the recommended one) that makes `name` h metres tall
  const hScale = (name, h) => { const n = info(name); return n ? h / Math.max(0.01, n.size[1] * (n.scale ?? 1)) : 1; };
  const gyl = (i, x, z) => i.gy(x, z) - i.y; // ground height at a local point, relative to the instance origin
  // uniform random points in a local disc, skipping the lake (and points closer than minD to an earlier one)
  function discPts(i, n, R, o = {}) {
    const pts = [], md2 = (o.minD ?? 0) ** 2;
    for (let t = 0; pts.length < n && t < n * 30 + 20; t++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (o.water !== true && waterAt(i.wx(x, z), i.wz(x, z))) continue;
      if (md2) { let ok = true; for (const p of pts) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < md2) { ok = false; break; } } if (!ok) continue; }
      pts.push({ x, z });
    }
    return pts;
  }
  // recolour a model's shared materials by name (a model is used by exactly one entry style: birch, cherry, willow). Idempotent.
  function recolor(obj, rx, hex) {
    obj.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) if (m && rx.test(m.name) && m.userData.natHex !== hex) { m.color.setHex(hex); m.userData.natHex = hex; } });
  }
  const LEAF = /leaf/i, WOOD = /wood|bark/i;
  const TWEAK = {
    'tree-thin': [[WOOD, 0xe8e4d6], [LEAF, 0x8cc44c]], 'tree-simple': [[WOOD, 0xe8e4d6], [LEAF, 0x8cc44c]], // birch: white trunk, light leaves
    'tree-detailed': [[LEAF, 0xf4a8c0]], 'tree-plateau': [[LEAF, 0xf8b8cc]], // cherry blossom
    'tree-oak-dark': [[LEAF, 0xa4c864]], // willow
  };
  const tweak = (name, obj) => { const t = TWEAK[name]; if (t) for (const [rx, hex] of t) recolor(obj, rx, hex); };
  // sway a model tree about its base; stops for good once kit.fellable starts toppling it
  function swayPiece(p, amp = 0.012) {
    const i = p.inst, o = p.obj, ph = rand(0, 6);
    i.tick((dt, t) => {
      const f = o.userData.fellH; if (f && (f.falling || f.fallen)) return true;
      if (Math.abs(H.head.x - i.x) + Math.abs(H.head.z - i.z) > 70) return undefined;
      const w = 0.4 + (H.ctx.world.env?.wind ?? 0.5);
      o.rotation.z = Math.sin(t * 0.9 * w + ph) * amp * w; o.rotation.x = Math.sin(t * 0.7 * w + ph * 1.7) * amp * 0.7 * w;
      return undefined;
    }, { every: 0.05 });
  }
  // sway the items of an instanced run (grass, reeds): rewrites each instance matrix ~10x/s while the player is near (no allocation)
  const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _se = new THREE.Euler(), _sp = new THREE.Vector3(), _ss = new THREE.Vector3();
  function swayItems(i, sc, amp = 0.07) {
    const L = sc.items.filter((s) => s.set && !s.still);
    i.tick((dt, t) => {
      if (sc.removed) return true;
      if (Math.abs(H.head.x - i.x) + Math.abs(H.head.z - i.z) > 40) return undefined;
      const w = 0.3 + (H.ctx.world.env?.wind ?? 0.5);
      for (const s of L) {
        if (s.state === 2) continue;
        _se.set(Math.cos(t * 1.1 * w + s.k) * amp * 0.7 * w, s.yaw ?? 0, Math.sin(t * 1.3 * w + s.k * 2) * amp * w, 'YXZ');
        s.set.setMatrixAt(s.k, _sm.compose(_sp.set(s.x, s.y, s.z), _sq.setFromEuler(_se), _ss.setScalar(s.scale ?? 1)));
      }
      return undefined;
    }, { every: 0.1 });
  }
  // ONE destructible for a whole run of instanced items (a flower patch, a field cell): hit it and every listed instance bursts
  function patchBreak(i, list, o = {}) {
    const K = H.kit(), m = M();
    list = list.filter((s) => s.set && !s.keep);
    if (!K || !K.destructible || !m || !list.length || i.removed || !mx) return null;
    const b = new THREE.Box3();
    for (const s of list) {
      const inf = m.info(s.name); if (!inf) continue;
      const f = (inf.scale ?? 1) * (s.scale ?? 1), r = Math.max(inf.size[0], inf.size[2]) * f * 0.5, hh = inf.size[1] * f;
      b.expandByPoint(_sp.set(s.x - r, s.y, s.z - r)); b.expandByPoint(_sp.set(s.x + r, s.y + hh, s.z + r));
    }
    if (b.isEmpty()) return null;
    const mat = o.material ?? 'earth', proxy = mx.makeProxy(i, [b], o.colors, mat);
    const h = K.destructible(i.ctx, proxy, {
      hp: o.hp ?? 10, material: mat, pieces: o.pieces,
      onBreak(e) { for (const s of list) { s.state = 2; s.set.setMatrixAt(s.k, mx.ZERO); } i.broken = (i.broken | 0) + 1; if (o.onBreak) o.onBreak(e); },
    });
    i.cleanup(() => h.remove());
    return h;
  }
  const afterSets = (i, sc, fn) => Promise.all(sc.sets.map((s) => s.ready)).then(() => { if (!i.removed && !sc.removed && !sc.failed) { try { fn(); } catch (err) { console.error('[library] nature after-load failed', err); } } });
  const cells = (items, size) => { const g = new Map(); for (const s of items) { if (s.keep) continue; const k = Math.floor(s.x / size) + ',' + Math.floor(s.z / size); if (!g.has(k)) g.set(k, []); g.get(k).push(s); } return [...g.values()]; };

  // ================================================================================================================
  // PRIMITIVE BUILDS (fallback)
  // ================================================================================================================
  def('oak-tree', 'broad green oak with a thick trunk and a lumpy canopy (models: Kenney oak / dark oak / tall tree; swaying; cut or blast it and it topples, leaving a stump)', 'scale, count', ['oak', 'tree', 'trees', 'big tree', 'deciduous tree', 'green tree', 'broadleaf'], (i, o) => { placeTree(i, o, 'oak'); }, { size: 1.2, face: 'random' });
  def('pine-tree', 'tall dark-green conifer with stacked boughs (6 model variants; swaying; fellable)', 'scale, count', ['pine', 'fir', 'spruce', 'conifer', 'evergreen', 'christmas tree', 'pines', 'fir tree'], (i, o) => { placeTree(i, o, 'pine'); }, { size: 1.2, face: 'random' });
  def('birch-tree', 'slender white birch with a pale trunk and light-green leaves (swaying; fellable)', 'scale, count', ['birch', 'white tree', 'aspen', 'silver birch'], (i, o) => { placeTree(i, o, 'birch'); }, { size: 1, face: 'random' });
  def('palm-tree', 'curved palm trunk with a crown of long fronds (4 model variants; swaying; fellable)', 'scale, count', ['palm', 'coconut tree', 'tropical tree', 'palms', 'beach tree'], (i, o) => { placeTree(i, o, 'palm', 0.02); }, { size: 1.2, face: 'random' });
  def('willow', 'drooping weeping willow with a curtain of pale hanging fronds (model crown + hanging fronds; swaying; fellable)', 'scale', ['weeping willow', 'willow tree', 'drooping tree', 'willows'], (i, o) => {
    const m = model('willow' + ((Math.random() * 2) | 0), (b) => {
      const r = rng((Math.random() * 1e6) | 0);
      b.cyl(0, -0.2, 0, 0.3, 0.55, 3.3, 0x5a4a38, [0.05, 0, 0.08], 8); for (let k = 0; k < 5; k++) { const a = r() * TAU; b.cone(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 0.2, 0.9, 0x4a3a28, [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 4); }
      b.sph(0, 4.2, 0, 2.0, 1.1, 2.0, 0x9ac060, 0, 8);
      b.mode('cloth');
      for (let k = 0; k < 44; k++) { const a = (k / 44) * TAU + r() * 0.3, rad = 1.1 + r() * 1.3, len = 2.2 + r() * 1.6; b.cone(Math.cos(a) * rad, 4.0 - len, Math.sin(a) * rad, 0.07, len, [0x8ab050, 0xa8c868, 0x7aa848][(r() * 3) | 0], [PI, 0, 0], 4); }
    });
    m.scale.setScalar((o.scale ?? 1) * rand(0.9, 1.1)); i.add(m); sway(i, m, 0.02);
  }, { size: 2.5, face: 'random' });
  def('cherry-blossom', 'pink cherry tree in full bloom with petals constantly drifting down (stop when the tree is felled)', 'scale', ['sakura', 'cherry tree', 'blossom tree', 'blossoms', 'pink tree', 'flowering tree'], (i, o) => {
    const k = o.scale ?? 1;
    const m = model('cherry' + ((Math.random() * 2) | 0), (b) => {
      const r = rng((Math.random() * 1e6) | 0);
      b.cyl(0, -0.2, 0, 0.18, 0.34, 2.3, 0x4a3030, [0.1, 0, -0.1], 7);
      for (let q = 0; q < 4; q++) { const a = r() * TAU; b.cyl(0, 1.6, 0, 0.07, 0.12, 1.5, 0x4a3030, [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8], 5); }
      for (let q = 0; q < 9; q++) { const a = (q / 9) * TAU + r(), rad = q ? 0.8 + r() * 1.0 : 0, s = 0.8 + r() * 0.6; b.sph(Math.cos(a) * rad, 3.0 + r() * 1.3, Math.sin(a) * rad, s, s * 0.8, s, [0xf4a8c0, 0xffc4d4, 0xe890b0, 0xffd8e4][(r() * 4) | 0], [r(), r(), 0], 6); }
    });
    m.scale.setScalar(k); m.rotation.y = rand(0, TAU); i.add(m); sway(i, m);
    i.petals = H.field(i, { count: 70, area: [7 * k, 5 * k, 7 * k], center: { x: i.x, z: i.z }, baseY: i.y - 0.1, fall: 0.5, sway: 0.7, drift: [0.15, 0.1], color: [0xffc4d4, 0xf4a8c0, 0xffffff], size: 0.07, shape: 'ellipse', spin: 3, alpha: 0.95 });
  }, { size: 2.2, face: 'random' });
  def('dead-tree', 'gnarled grey dead tree with bare twisting branches (models: KayKit Halloween dead trees; fellable)', 'scale', ['bare tree', 'dead wood', 'withered tree', 'spooky tree', 'haunted tree', 'dead trees', 'leafless tree'], (i, o) => { placeTree(i, o, 'dead', 0, [0.9, 1.2]); }, { size: 1.2, face: 'random' });
  def('autumn-tree', 'tree in full autumn colours: an orange canopy on a pale trunk with leaves drifting down (3 model variants; fellable)', 'scale', ['autumn tree', 'fall tree', 'orange tree', 'fall foliage tree', 'red tree', 'maple', 'autumn oak', 'autumn trees'], (i, o) => {
    const k = o.scale ?? 1;
    placeTree(i, o, 'autumn');
    i.petals = H.field(i, { count: 40, area: [6 * k, 5 * k, 6 * k], center: { x: i.x, z: i.z }, baseY: i.y - 0.1, fall: 0.8, sway: 0.9, drift: [0.25, 0.1], color: [0xd8742a, 0xe8a030, 0xb8402a], size: 0.1, shape: 'ellipse', spin: 3, alpha: 0.95 });
  }, { size: 1.4, face: 'random' });

  def('giant-mushroom', 'huge glowing mushroom (cluster of three) with spotted cap, luminous spots and drifting spores; option color; bursts into spores and clods when destroyed', 'color, scale', ['mushroom', 'toadstool', 'glowing mushroom', 'fungus', 'mushrooms', 'shroom', 'magic mushroom'], (i, o) => {
    const c = o.color ?? pick([0xd83a8a, 0x3ad8c0, 0xe8742a, 0x9a5cff]), glow = mix(c, 0xffffff, 0.5), k = o.scale ?? 1;
    const b = H.mk();
    const shroom = (x, z, s) => {
      b.cyl(x, -0.1, z, 0.28 * s, 0.38 * s, 2.5 * s, 0xf0e8d4, 0, 8);
      b.sph(x, 2.5 * s, z, 1.7 * s, 0.85 * s, 1.7 * s, c, 0, 9);
      b.mode('glow'); b.cylc(x, 2.38 * s, z, 1.3 * s, 0.95 * s, 0.1 * s, glow, 0, 9);
      for (let q = 0; q < 8; q++) { const a = q * 0.785 + x, rr = (0.5 + (q % 3) * 0.3) * s, hh = Math.sqrt(Math.max(0.1, 1 - (rr / (1.7 * s)) ** 2)) * 0.85 * s; b.sph(x + Math.cos(a) * rr, 2.5 * s + hh * 0.95, z + Math.sin(a) * rr, 0.17 * s, 0.08 * s, 0.17 * s, glow); }
      b.mode('solid');
    };
    shroom(0, 0, 1); shroom(2.1, 0.9, 0.55); shroom(-1.6, 1.6, 0.4);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    blk.cyl(i, 0, 0, 0.4 * k, 2.6 * k, { gone: anyBroken(i) }); blk.cyl(i, 2.1 * k, 0.9 * k, 0.24 * k, 1.5 * k, { gone: anyBroken(i) }); blk.cyl(i, -1.6 * k, 1.6 * k, 0.18 * k, 1.1 * k, { gone: anyBroken(i) }); // the three stems
    const L = i.light({ color: c, intensity: 9, distance: 8, position: { x: i.x, y: i.y + 2.6 * k, z: i.z } });
    let acc = 0;
    i.tick((dt, t) => {
      if (i.broken) { if (L) L.enabled = false; return; }
      if (!near(i, 45)) return; acc += dt * 3; const n = acc | 0; acc -= n; if (n) { _w.set(i.x + rand(-1.4, 1.4) * k, i.y + 2.8 * k, i.z + rand(-1.4, 1.4) * k); i.burst('glow', glow, _w, n, 0.35, _up); } if (L) L.intensity = 8 + Math.sin(t * 1.4) * 2.5;
    }, { every: 0.1 });
  }, { size: 2.4, face: 'random' });

  def('bush', 'round leafy plant clump (Kenney bush models, 1-2 of them); bursts into leaves and clods when hit', 'scale, count', ['shrub', 'hedge', 'bushes', 'shrubbery', 'thicket'], (i, o) => {
    const m = model('bush' + ((Math.random() * 3) | 0), (b) => { const g = pick([GREENS, [0x3f7a30, 0x4a8a3a, 0x356a2a]]); for (let k = 0; k < 5; k++) { const a = k * 1.26, rr = k ? 0.4 : 0; b.sph(Math.cos(a) * rr, 0.45 + (k % 2) * 0.1, Math.sin(a) * rr, 0.55 + Math.random() * 0.15, 0.45, 0.55, pick(g), [Math.random(), Math.random(), 0], 6); } for (let k = 0; k < 6; k++) { const a = Math.random() * TAU; b.sph(Math.cos(a) * 0.65, 0.5 + Math.random() * 0.3, Math.sin(a) * 0.65, 0.05, 0.05, 0.05, 0xd83a3a, 0, 4); } });
    m.scale.setScalar((o.scale ?? 1) * rand(0.85, 1.3)); m.rotation.y = rand(0, TAU); i.add(m);
  }, { size: 0.9, face: 'random', spacing: 2 });

  def('flower-patch', 'patch of ~25 wildflowers in mixed colours (red, yellow, purple Kenney flowers and grass tufts; option color picks one colour family; radius); the whole patch bursts into petals when hit', 'color, radius', ['flowers', 'flower', 'garden', 'wildflowers', 'flower bed', 'tulips', 'roses', 'daisies', 'meadow', 'flowerbed'], (i, o) => {
    const R = (o.radius ?? 1.6) * (o.scale ?? 1), b = H.mk(), y0 = i.y;
    const cols = o.color !== undefined ? [o.color] : [0xff6a8a, 0xffd24a, 0xffffff, 0xb080ff, 0xff9a4a, 0x6ab0ff];
    for (let k = 0; k < 28; k++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, x = Math.cos(a) * r, z = Math.sin(a) * r, h = rand(0.3, 0.6), g = i.gy(x, z) - y0, c = pick(cols);
      b.cyl(x, g, z, 0.012, 0.016, h, 0x3a7a3a, [rand(-0.15, 0.15), 0, rand(-0.15, 0.15)], 3);
      b.cone(x + 0.04, g + 0.1, z, 0.04, 0.12, 0x3a8a3a, [0, 0, -0.9], 3);
      for (let q = 0; q < 5; q++) { const pa = q * 1.257; b.oct(x + Math.cos(pa) * 0.04, g + h + 0.01, z + Math.sin(pa) * 0.04, 0.032, 0.012, 0.032, c, [0, pa, 0.2]); }
      b.sph(x, g + h + 0.015, z, 0.022, 0.018, 0.022, 0xffd24a, 0, 4);
    }
    for (let k = 0; k < 10; k++) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R * 1.1, x = Math.cos(a) * r, z = Math.sin(a) * r; b.cone(x, i.gy(x, z) - y0, z, 0.1, 0.22, 0x4a8a3a, 0, 3); }
    i.add(b.build());
  }, { size: 1.2, face: 'random', spacing: 3 });

  const rockMat = [0x8a8680, 0x7a766e, 0x9a968e, 0x6e6a64, 0x86807a];
  def('boulder', 'big boulder of grey stone (Kenney stone / KayKit / survival rocks, 5 variants); tough: a slash barely scratches it, a blast cracks it and shatters it into rubble', 'scale', ['rock', 'stone', 'big rock', 'boulders', 'rocks'], (i, o) => {
    const m = model('boulder' + ((Math.random() * 3) | 0), (b) => {
      const c = pick(rockMat); b.dod(0, 0.7, 0, 1.4, 1.0, 1.2, c, [Math.random() * 3, Math.random() * 3, 0]); b.dod(0.5, 0.3, 0.6, 0.7, 0.5, 0.6, shade(c, 0.9), [Math.random() * 3, 1, 0]);
      for (let k = 0; k < 4; k++) { const a = Math.random() * TAU; b.sph(Math.cos(a) * 0.8, 1.15 + Math.random() * 0.2, Math.sin(a) * 0.7, 0.4, 0.12, 0.4, pick([0x4a7a3a, 0x5a8a40]), 0, 5); }
    });
    const bs = (o.scale ?? 1) * rand(0.7, 1.3);
    m.scale.setScalar(bs); m.rotation.y = rand(0, TAU); m.position.y = -0.25; i.add(m);
    blk.cyl(i, 0, 0, 0.85 * bs, 1.2 * bs, { gone: anyBroken(i) });
  }, { size: 1.8, face: 'random', spacing: 3.5 });
  def('rock-cluster', 'cluster of rocks of mixed sizes (a big grey rock group plus a few loose stones); tough stone: needs blasts or heavy blows to break', 'scale', ['rocks', 'stones', 'rubble pile', 'rock pile', 'pebbles', 'rock formation', 'scree'], (i, o) => {
    const m = model('rockc' + ((Math.random() * 3) | 0), (b) => { for (let k = 0; k < 7; k++) { const a = Math.random() * TAU, r = k ? 0.4 + Math.random() * 1.3 : 0, s = k ? 0.25 + Math.random() * 0.5 : 0.8; b.dod(Math.cos(a) * r, s * 0.55, Math.sin(a) * r, s, s * 0.7, s * 0.9, pick(rockMat), [Math.random() * 3, Math.random() * 3, 0]); } });
    const rs = (o.scale ?? 1) * rand(0.8, 1.2);
    m.scale.setScalar(rs); m.rotation.y = rand(0, TAU); m.position.y = -0.08; i.add(m);
    blk.cyl(i, 0, 0, 0.8 * rs, 1.0 * rs, { gone: anyBroken(i) }); // the big central rock; the loose stones round it are walk-over
  }, { size: 1.8, face: 'random', spacing: 3.5 });

  def('crystal-cluster', 'glowing crystal spires that light their surroundings, sparkle and chime now and then; option color; shatters into shards when destroyed (light and chimes stop)', 'color, scale', ['crystals', 'crystal', 'gems', 'gemstones', 'amethyst', 'crystal formation', 'geode', 'glowing crystals'], (i, o) => {
    const c = o.color ?? pick([0xb06aff, 0x58e6ff, 0xff6aa8, 0x58ff9a, 0xffb040]), k = o.scale ?? 1, b = H.mk();
    b.dod(0, 0.15, 0, 1.0, 0.35, 0.9, 0x4a4650);
    for (let q = 0; q < 8; q++) { const a = q * 0.8 + rand(0, 0.3), rr = q ? rand(0.3, 0.9) : 0, h = q ? rand(0.8, 1.7) : 2.3, w = q ? rand(0.14, 0.24) : 0.3, tx = Math.sin(a) * 0.3, tz = -Math.cos(a) * 0.3;
      b.oct(Math.cos(a) * rr, 0.2 + h * 0.7, Math.sin(a) * rr, w, h * 0.75, w, shade(c, 0.9 + Math.random() * 0.25), [tx * 0.5, rand(0, 3), tz * 0.5], 6);
      b.mode('glow'); b.oct(Math.cos(a) * rr, 0.2 + h * 1.15, Math.sin(a) * rr, w * 0.35, h * 0.25, w * 0.35, mix(c, 0xffffff, 0.6), [tx * 0.5, 0, tz * 0.5]); b.mode('solid'); }
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    blk.cyl(i, 0, 0, 0.85 * k, 2.2 * k, { gone: anyBroken(i) });
    const L = i.light({ color: c, intensity: 12, distance: 9, position: { x: i.x, y: i.y + 1.2 * k, z: i.z } });
    let acc = 0, ch = rand(2, 6);
    i.tick((dt, t) => {
      if (i.broken) { if (L) L.enabled = false; return; }
      if (L) L.intensity = 11 + Math.sin(t * 1.7 + c) * 3;
      if (!near(i, 40)) return;
      acc += dt * 2.2; const n = acc | 0; acc -= n; if (n) { _w.set(i.x + rand(-0.8, 0.8) * k, i.y + rand(0.6, 2.2) * k, i.z + rand(-0.8, 0.8) * k); i.burst('glow', mix(c, 0xffffff, 0.5), _w, 1, 0.2, _up); }
      ch -= dt; if (ch < 0 && near(i, 18)) { ch = rand(6, 12); const f = [880, 1047, 1319, 1568, 1760][(Math.random() * 5) | 0]; i.snd().tone({ freq: f, dur: 1.6, type: 'sine', vol: 0.1, at: { x: i.x, y: i.y + 1.2, z: i.z } }); i.snd().tone({ freq: f * 1.5, dur: 1.2, type: 'sine', vol: 0.04, at: { x: i.x, y: i.y + 1.2, z: i.z }, delay: 0.05 }); }
    }, { every: 0.1 });
  }, { size: 1.4, face: 'random' });

  // the pond: muddy rim, reeds and lily pads. With models the rim stones, reeds and lilies are Kenney instances (o.noRim keeps the old primitives out)
  def('pond', 'natural pond with a muddy rim, reeds (cattails), lily pads and slow ripples (see fish-pond for fish)', 'radius', ['small lake', 'lake', 'water', 'puddle', 'pool', 'ponds', 'water hole', 'swamp', 'marsh'], (i, o) => {
    const R = (o.radius ?? 3.2) * (o.scale ?? 1), b = H.mk(), models = !!(mx && mx.has('lily-large') && mx.has('waterplant-b'));
    let top = -1e9; for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; top = Math.max(top, H.ground(i.x + Math.cos(a) * R, i.z + Math.sin(a) * R)); }
    const wy = Math.max(top, H.ground(i.x, i.z)) - i.y + 0.08;
    b.cyl(0, -1.2, 0, R + 0.3, R + 0.3, wy + 1.2, 0x2f5a68, 0, 20);
    for (let k = 0; k < 26; k++) { const a = (k / 26) * TAU + rand(-0.06, 0.06), rr = R + 0.15 + rand(0, 0.3), s = rand(0.18, 0.4); b.dod(Math.cos(a) * rr, wy, Math.sin(a) * rr, s, rand(0.12, 0.25), s, k % 3 ? pick([0x6a5a48, 0x5a4a38]) : pick(rockMat), [rand(0, 3), rand(0, 3), 0]); }
    if (!models) {
      for (let k = 0; k < 16; k++) { const a = rand(0, TAU), rr = R + rand(-0.1, 0.5); b.cyl(Math.cos(a) * rr, wy, Math.sin(a) * rr, 0.012, 0.02, rand(0.8, 1.5), 0x5a8a3a, [rand(-0.2, 0.2), 0, rand(-0.2, 0.2)], 3); if (k % 3 === 0) b.cyl(Math.cos(a) * rr, wy + 1.0, Math.sin(a) * rr, 0.04, 0.04, 0.25, 0x6a4a2a, 0, 5); }
      b.mode('cloth'); for (let k = 0; k < 7; k++) { const a = rand(0, TAU), rr = rand(0.3, R - 0.5); b.cylc(Math.cos(a) * rr, wy + 0.04, Math.sin(a) * rr, 0.26, 0.26, 0.012, 0x3f8f3f, 0, 8); }
    }
    i.add(b.build());
    const wb = H.mk(); wb.mode('ghost'); wb.cylc(0, wy, 0, R, R, 0.02, 0x3a8aa0, 0, 22);
    i.add(wb.build({ own: true }));
    if (models) { // reeds around the rim, lily pads on the water
      const items = [];
      for (let k = 0; k < Math.round(R * 4); k++) { const a = rand(0, TAU), rr = R + rand(-0.15, 0.6), x = Math.cos(a) * rr, z = Math.sin(a) * rr; items.push({ name: pick(['waterplant-b', 'waterplant-b', 'waterplant-a', 'waterplant-c']), x, z, y: wy - 0.12, yaw: rand(0, TAU), scale: rand(0.9, 1.6) }); }
      for (let k = 0; k < Math.round(R * 2.2); k++) { const a = rand(0, TAU), rr = rand(0.2, R - 0.55), x = Math.cos(a) * rr, z = Math.sin(a) * rr; items.push({ name: pick(['lily-large', 'lily-small', 'waterlily-a', 'waterlily-b']), x, z, y: wy + 0.02, yaw: rand(0, TAU), scale: rand(0.7, 1.2), still: true }); }
      mx.scatter(i, items, {});
    }
    const rp = []; for (let k = 0; k < 2; k++) { const rb = H.mk(); rb.mode('beam'); rb.tor(0, wy + 0.01, 0, 1, 0.03, 0xcfeeff, [PI / 2, 0, 0], 20); const m = rb.build({ own: true }); m.visible = false; i.add(m); rp.push({ m, t: -1 }); }
    let nx = rand(1, 3);
    i.tick((dt, t) => {
      nx -= dt; if (nx < 0) { nx = rand(2, 4); const r = rp.find((q) => q.t < 0); if (r) { r.t = 0; const a = rand(0, TAU), d = rand(0, R * 0.6); r.m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); } }
      for (const r of rp) { if (r.t < 0) continue; r.t += dt; const u = r.t / 2.2; if (u >= 1) { r.t = -1; r.m.visible = false; continue; } r.m.visible = true; const s = 0.1 + u * 1.2; r.m.scale.set(s, 1, s); r.m.material.opacity = 0.5 * (1 - u); }
    });
  }, { size: 3.5, face: 'random' });

  // waterfall effects (spray particles, mist, plunge pool, roar) shared by the primitive and the model build; `Hh` = fall height
  function waterfallFx(i, Hh, z0 = -0.5) {
    const sb = H.mk(); sb.mode('beam'); sb.box(0, Hh / 2 - 0.1, z0 - 0.02, 1.5, Hh - 0.3, 0.06, 0xbfe6ff);
    for (let k = -2; k <= 2; k++) sb.box(k * 0.3, Hh / 2 - 0.1, z0 + 0.02, 0.05, Hh - 0.4, 0.03, 0xffffff);
    const sheet = sb.build({ own: true }); i.add(sheet);
    const pb = H.mk(); pb.mode('ghost'); pb.cylc(0, 0.06, z0 + 1.5, 1.9, 1.9, 0.02, 0x4a9ab0, 0, 18); i.add(pb.build({ own: true }));
    const sp = i.fx({ count: 160, color: [0xeaf8ff, 0x8ac8e8], size: [0.12, 0.05], life: [0.7, 1.0], speed: [0, 0.2], gravity: 9, drag: 0.02, alpha: 0.7, additive: false });
    let acc = 0, ns = 0;
    i.tick((dt, t) => {
      sheet.material.opacity = 0.4 + Math.sin(t * 9) * 0.08; sheet.position.y = Math.sin(t * 7) * 0.02;
      if (!near(i, 60)) return;
      acc += dt * 50; const n = acc | 0; acc -= n;
      for (let k = 0; k < n; k++) { const p = i.at(rand(-0.7, 0.7), z0 + 0.05); _w.set(p.x, i.y + Hh - 0.4, p.z); if (sp) sp.emit(_w, 1, _up.set(0, -0.2, 0)); }
      _up.set(0, 0.6, 0);
      if (Math.random() < dt * 10) { const p = i.at(rand(-0.8, 0.8), z0 + 1.0); _w.set(p.x, i.y + 0.3, p.z); i.burst('puff', 0xe8f4ff, _w, 1, 0.5, _up); }
      ns -= dt; if (ns < 0 && near(i, 28)) { ns = 1.0; i.snd().noise({ dur: 1.3, filter: { type: 'bandpass', freq: 1200, q: 0.5 }, vol: 0.14, attack: 0.3, at: { x: i.x, y: i.y + 1.5, z: i.z } }); }
    });
  }
  function waterfallCliff(i, Hh, loose) {
    const b = H.mk();
    for (let k = 0; k < 9; k++) { const a = rand(-1.1, 1.1) + PI / 2, r = rand(0, 2.2), y = rand(0.4, Hh - 0.6); b.dod(Math.cos(a) * r - 0.0, y * 0.55, -Math.abs(Math.sin(a)) * 0.6 - 0.6, rand(1.1, 1.8), y * 0.5 + 0.8, rand(1.0, 1.5), pick(rockMat), [rand(0, 1), rand(0, 3), 0]); }
    b.dod(0, Hh - 0.5, -0.9, 2.4, 0.9, 1.4, 0x86807a); b.box(0, Hh / 2 - 0.3, -1.3, 4.6, Hh + 0.2, 1.4, 0x6e6a64);
    if (loose) for (let k = 0; k < 6; k++) b.dod(rand(-2.2, 2.2), 0.3, rand(0.7, 1.9), rand(0.3, 0.6), 0.25, rand(0.3, 0.5), pick(rockMat), [rand(0, 3), rand(0, 3), 0]);
    i.add(b.build());
    blk.box(i, 0, -1.2, 4.6, 1.9, Hh + 0.2); // the cliff itself (the plunge pool in front of it stays open)
  }
  def('waterfall-rock', 'rocky cliff 4.5 m tall with a waterfall: falling spray particles, misty base, plunge pool and a roaring sound (cliff body is modelled, loose boulders at the foot are Kenney stones)', 'scale', ['waterfall', 'cascade', 'cliff', 'falls', 'water fall', 'rock waterfall', 'waterfalls'], (i, o) => {
    waterfallCliff(i, 4.6, true);
    waterfallFx(i, 4.6);
  }, { size: 3.5 });

  def('log', 'fallen log (Kenney log or hollow log) with toadstools; kids and adventurers sit on it; splinters when chopped or blasted', 'scale', ['fallen log', 'tree trunk', 'timber', 'logs', 'wood log'], (i, o) => {
    const m = model('log' + ((Math.random() * 2) | 0), (b) => {
      b.cylc(0, 0.36, 0, 0.36, 0.4, 3.0, 0x6a4a2a, [0, 0, PI / 2], 9); b.cylc(1.51, 0.36, 0, 0.3, 0.3, 0.02, 0xc9a070, [0, 0, PI / 2], 9); b.cylc(1.52, 0.36, 0, 0.18, 0.18, 0.02, 0xa88050, [0, 0, PI / 2], 9); b.cylc(1.53, 0.36, 0, 0.07, 0.07, 0.02, 0x8a6a40, [0, 0, PI / 2], 7);
      for (let k = 0; k < 5; k++) b.sph(rand(-1.3, 1.2), 0.7, rand(-0.15, 0.15), rand(0.18, 0.4), 0.07, 0.2, pick([0x4a7a3a, 0x5a8a40]), 0, 5);
      for (let k = 0; k < 3; k++) { const x = rand(-1.2, 1.0); b.cyl(x, 0.68, 0.25, 0.02, 0.03, 0.12, 0xe8e0d0, 0, 4); b.sph(x, 0.8, 0.25, 0.08, 0.04, 0.08, 0xd8503a, 0, 5); }
      b.cone(-0.9, 0.5, 0.35, 0.06, 0.4, 0x5a3e24, [1.3, 0, 0], 4);
    });
    const ly = rand(0, TAU), lk = o.scale ?? 1;
    m.scale.setScalar(lk); m.rotation.y = ly; i.add(m);
    blk.box(i, 0, 0, 3.0 * lk, 0.85 * lk, 0.85 * lk, { yaw: ly, gone: anyBroken(i) });
  }, { size: 1.8, face: 'random', spacing: 3 });

  def('tall-grass-patch', 'a thick swaying clump of tall grass blades (~2 m across; Kenney grass tufts when models are available); a blow flattens the whole clump', 'radius, scale', ['grass', 'tall grass', 'reeds', 'long grass', 'tuft', 'grass patch', 'wheat', 'weeds'], (i, o) => {
    const R = (o.radius ?? 1.6) * (o.scale ?? 1), y0 = i.y, clumps = [];
    for (let c = 0; c < 3; c++) {
      const b = H.mk(), cx = Math.cos(c * 2.1 + 0.4) * R * 0.5, cz = Math.sin(c * 2.1 + 0.4) * R * 0.5;
      for (let k = 0; k < 55; k++) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R * 0.65, x = Math.cos(a) * r, z = Math.sin(a) * r, h = rand(0.5, 1.2), g = i.gy(cx + x, cz + z) - y0; b.cone(x, g, z, 0.035, h, pick([0x6a9a3a, 0x7aaa44, 0x5a8a34, 0x8aba50, 0xa8b858]), [rand(-0.25, 0.25), 0, rand(-0.25, 0.25)], 3); }
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.add(b.build()); i.add(g); clumps.push(g);
    }
    i.tick((dt, t) => { if (Math.abs(H.head.x - i.x) + Math.abs(H.head.z - i.z) > 50) return; const w = 0.3 + (H.ctx.world.env?.wind ?? 0.5); for (let k = 0; k < 3; k++) { clumps[k].rotation.z = Math.sin(t * 1.3 * w + k * 2) * 0.07 * w; clumps[k].rotation.x = Math.cos(t * 1.1 * w + k) * 0.05 * w; } }, { every: 0.05 });
  }, { size: 1.5, face: 'random', spacing: 3.5 });

  // ---------------------------------------------------------------- forests (InstancedMesh)
  function forest(i, o, dflt) {
    const N = clamp(Math.floor(o.count ?? dflt.count), 1, 400), R = o.radius ?? dflt.radius, style = o.style ?? dflt.style;
    const kinds = { pine: ['pine'], oak: ['oak'], birch: ['birch'], autumn: ['autumn'], dead: ['dead'], palm: ['palm'] }[style] ?? ['oak', 'pine'];
    const metas = [];
    for (const kd of kinds) for (let v = 0; v < 2; v++) { const m = treeModel[kd](v); metas.push({ parts: (m.isGroup ? m.children : [m]).map((c) => ({ geo: c.geometry, mat: c.material })), list: [] }); }
    const pts = [], minD = 2.4 * (o.scale ?? 1), clear = o.clearing ?? dflt.clearing ?? 0;
    for (let tries = 0; pts.length < N && tries < N * 40; tries++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, x = i.x + Math.cos(a) * r, z = i.z + Math.sin(a) * r;
      if (Math.hypot(x - H.head.x, z - H.head.z) < 4) continue;
      if (clear && r < clear) continue;
      if (waterAt(x, z)) continue;
      let ok = true; for (const p of pts) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < minD * minD) { ok = false; break; } }
      if (ok) pts.push({ x, z });
    }
    const Mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p3 = new THREE.Vector3(), col = new THREE.Color();
    pts.forEach((p) => metas[(Math.random() * metas.length) | 0].list.push(p));
    // no models: the instanced primitive trees get trunk blockers for the 40 trees nearest the player (not fellable, but solid)
    for (const p of pts.slice().sort((a, b) => Math.hypot(a.x - H.head.x, a.z - H.head.z) - Math.hypot(b.x - H.head.x, b.z - H.head.z)).slice(0, 40)) blk.cyl(i, p.x - i.x, p.z - i.z, 0.3 * (o.scale ?? 1), 4);
    for (const mt of metas) {
      if (!mt.list.length) continue;
      const ims = mt.parts.map((pt) => new THREE.InstancedMesh(pt.geo, pt.mat, mt.list.length));
      mt.list.forEach((p, k) => {
        const sc = (o.scale ?? 1) * rand(0.8, 1.45), shadeK = rand(0.82, 1.15);
        q.setFromEuler(e.set(rand(-0.04, 0.04), rand(0, TAU), rand(-0.04, 0.04))); p3.set(p.x - i.x, H.ground(p.x, p.z) - i.y - 0.15, p.z - i.z); s.set(sc, sc * rand(0.9, 1.15), sc);
        Mx.compose(p3, q, s); col.setScalar(shadeK);
        for (const im of ims) { im.setMatrixAt(k, Mx); im.setColorAt(k, col); }
      });
      for (const im of ims) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; i.add(im); }
    }
    i.group.rotation.y = 0; // positions were computed in world space relative to the instance origin
    return pts.length;
  }
  const FOREST_DEFAULT = { count: 40, radius: 22, style: 'mixed' };
  def('forest', 'dense forest of Kenney trees plus bushes and stones in ~12 draw calls (count default 40, max 400; radius 22; style mixed|oak|pine|birch|autumn|dead|palm; clearing = bare centre radius; undergrowth:false for trees only). Every tree is instanced; the ~12 nearest the player are real fellable trees (cut or blast them and they topple); trees avoid the lake and a 4 m zone around you', 'count, radius, style, clearing, undergrowth, scale', ['woods', 'woodland', 'jungle', 'trees forest', 'wood', 'pine forest', 'big forest', 'many trees', 'forests'], (i, o) => {
    i.group.rotation.y = 0; forest(i, o, FOREST_DEFAULT);
  }, { ownCount: true, noPush: true, size: 6, face: 'none', distance: 14 });
  const groveExtras = (i) => {
    const quest = H.ctx.quality?.tier === 'quest';
    for (let k = 0; k < (quest ? 3 : 4); k++) { const a = rand(0, TAU), r = rand(2.5, 6); i.sub('bush', { x: i.x + Math.cos(a) * r, z: i.z + Math.sin(a) * r }); }
    for (let k = 0; k < (quest ? 1 : 2); k++) { const a = rand(0, TAU), r = rand(2, 5); i.sub('flower-patch', { x: i.x + Math.cos(a) * r, z: i.z + Math.sin(a) * r }); }
  };
  const GROVE_DEFAULT = { count: 14, radius: 8, style: 'oak', clearing: 2.5, undergrowth: false };
  def('grove', 'small cosy grove: 14 fellable trees plus breakable bushes and a few flower patches (options count, radius, style)', 'count, radius, style', ['copse', 'orchard', 'small forest', 'tree grove', 'glade', 'clearing', 'thicket of trees', 'groves'], (i, o) => {
    forest(i, o, GROVE_DEFAULT); groveExtras(i);
  }, { ownCount: true, noPush: true, size: 4, face: 'none', distance: 10 });
  // variations of the forest
  def('autumn-forest', 'forest in autumn colours: orange and golden trees on pale trunks (same options as forest; count default 30, radius 18; fellable near you)', 'count, radius, clearing', ['fall forest', 'autumn woods', 'orange forest', 'autumn trees forest'], (i, o) => {
    i.group.rotation.y = 0; forest(i, { ...o, style: 'autumn' }, { count: 30, radius: 18, style: 'autumn' });
  }, { ownCount: true, noPush: true, size: 6, face: 'none', distance: 14 });
  def('dead-forest', 'bare, haunted forest of dead grey trees (KayKit Halloween dead trees; count default 25, radius 18; fellable near you)', 'count, radius, clearing', ['haunted forest', 'dead woods', 'spooky forest', 'dead trees forest', 'wasteland trees'], (i, o) => {
    i.group.rotation.y = 0; forest(i, { ...o, style: 'dead' }, { count: 25, radius: 18, style: 'dead' });
  }, { ownCount: true, noPush: true, size: 6, face: 'none', distance: 14 });
  def('palm-grove', 'tropical palm grove: curved palms in a loose ring (count default 12, radius 9; fellable near you)', 'count, radius, clearing', ['palms grove', 'oasis', 'tropical trees', 'palm trees', 'beach palms', 'palm forest'], (i, o) => {
    i.group.rotation.y = 0; forest(i, { ...o, style: 'palm' }, { count: 12, radius: 9, style: 'palm', clearing: 1.5 });
  }, { ownCount: true, noPush: true, size: 5, face: 'none', distance: 10 });

  // ---------------------------------------------------------------- new entries (primitive builds)
  def('stump', 'old tree stump with a flat cut top (4 Kenney stump variants); splinters when chopped or blasted', 'scale, count', ['tree stump', 'stumps', 'cut tree', 'chopping block', 'chopped tree'], (i, o) => {
    const k = (o.scale ?? 1) * rand(0.9, 1.2), b = H.mk();
    b.cyl(0, -0.1, 0, 0.42, 0.5, 0.7, 0x6a4a2a, 0, 9); b.cylc(0, 0.6, 0, 0.4, 0.4, 0.04, 0xc9a070, 0, 9);
    for (let q = 0; q < 4; q++) { const a = (q / 4) * TAU + rand(-0.4, 0.4); b.cone(Math.cos(a) * 0.4, -0.05, Math.sin(a) * 0.4, 0.13, 0.4, 0x5a3e24, [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 4); }
    const m = b.build(); m.scale.setScalar(k); m.rotation.y = rand(0, TAU); i.add(m);
    blk.cyl(i, 0, 0, 0.45 * k, 0.65 * k, { gone: anyBroken(i) });
  }, { size: 0.9, face: 'random', spacing: 2.5 });
  def('log-pile', 'neat stack of firewood logs (Kenney log stacks); splinters and rolls apart when chopped or blasted', 'scale, count', ['firewood', 'firewood pile', 'log stack', 'logs pile', 'woodpile', 'wood pile', 'stacked logs', 'wood stack'], (i, o) => {
    const k = o.scale ?? 1, b = H.mk(), rows = [3, 2, 1];
    rows.forEach((n, r) => { for (let q = 0; q < n; q++) { const x = (q - (n - 1) / 2) * 0.62; b.cylc(x, 0.3 + r * 0.54, 0, 0.29, 0.29, 1.8, pick([0x6a4a2a, 0x7a5a38, 0x5a3e24]), [PI / 2, 0, 0], 8); b.cylc(x, 0.3 + r * 0.54, 0.91, 0.24, 0.24, 0.02, 0xc9a070, [PI / 2, 0, 0], 8); } });
    const lp = rand(0, TAU), m = b.build(); m.scale.setScalar(k); m.rotation.y = lp; i.add(m);
    blk.box(i, 0, 0, 1.9 * k, 1.9 * k, 1.5 * k, { yaw: lp, gone: anyBroken(i) });
  }, { size: 1.6, face: 'random', spacing: 3 });
  def('cactus', 'saguaro-style desert cactus (tall or short Kenney cactus, scale option); bursts into green clods when hit', 'scale, count', ['cacti', 'desert plant', 'saguaro', 'prickly plant', 'desert cactus', 'cactuses'], (i, o) => {
    const k = (o.scale ?? 1) * rand(0.85, 1.25), b = H.mk(), g = 0x4a9a3a;
    b.cyl(0, -0.05, 0, 0.22, 0.26, 1.9, g, 0, 7);
    b.cyl(0.2, 0.9, 0, 0.11, 0.12, 0.5, g, [0, 0, -1.55], 6); b.cyl(0.62, 0.88, 0, 0.1, 0.11, 0.65, g, 0, 6);
    b.cyl(-0.2, 0.6, 0, 0.1, 0.11, 0.45, g, [0, 0, 1.55], 6); b.cyl(-0.58, 0.58, 0, 0.09, 0.1, 0.5, g, 0, 6);
    const m = b.build(); m.scale.setScalar(k); m.rotation.y = rand(0, TAU); i.add(m);
    blk.cyl(i, 0, 0, 0.3 * k, 1.9 * k, { gone: anyBroken(i) });
  }, { size: 1, face: 'random', spacing: 3 });

  const patchPrim = (cols, R, n, hh, kind, own = false) => (i, o) => {
    const b = H.mk(), r0 = (o.radius ?? R) * (o.scale ?? 1), E = H.ctx.world.env;
    const nn = own && o.count !== undefined ? clamp(Math.floor(o.count), 1, 60) : n;
    for (let q = 0; q < nn; q++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * r0, x = Math.cos(a) * r, z = Math.sin(a) * r, h = rand(hh[0], hh[1]), c = pick(cols);
      const g = kind === 'lily' && E?.isWater?.(i.wx(x, z), i.wz(x, z)) ? (E.waterLevel ?? 0) - i.y : gyl(i, x, z);
      if (kind === 'mushroom') { b.cyl(x, g, z, 0.03, 0.05, h, 0xf0e8d4, 0, 6); b.sph(x, g + h, z, h * 0.6, h * 0.35, h * 0.6, c, 0, 7); }
      else if (kind === 'pumpkin') { b.sph(x, g + h * 0.5, z, h * 0.6, h * 0.5, h * 0.6, c, [0, rand(0, 3), 0], 8); b.cyl(x, g + h * 0.95, z, 0.03, 0.04, 0.1, 0x4a6a2a, 0, 5); }
      else if (kind === 'reed') { b.cyl(x, g, z, 0.01, 0.02, h, c, [rand(-0.15, 0.15), 0, rand(-0.15, 0.15)], 3); if (q % 3 === 0) b.cyl(x, g + h * 0.7, z, 0.035, 0.035, 0.22, 0x6a4a2a, 0, 5); }
      else if (kind === 'lily') { b.mode('cloth'); b.cylc(x, g + 0.03, z, 0.3, 0.3, 0.012, c, 0, 8); if (q % 3 === 0) b.sph(x, g + 0.08, z, 0.07, 0.05, 0.07, 0xff9ac0, 0, 5); }
    }
    i.add(b.build());
  };
  def('mushroom-patch', 'patch of ~12 forest mushrooms (red and tan Kenney mushroom groups); the whole patch bursts into spores and clods when hit (option radius)', 'radius, scale', ['mushrooms patch', 'toadstools', 'fungi', 'forest mushrooms', 'mushroom circle', 'fairy ring', 'toadstool patch'], patchPrim([0xd8403a, 0xd8a066, 0xe8e0d0], 1.5, 12, [0.2, 0.4], 'mushroom'), { size: 1.2, face: 'random', spacing: 3 });
  def('pumpkin-patch', 'patch of orange and yellow pumpkins on the ground (Kenney / Halloween pumpkins, option count default 9, radius 2.5); each pumpkin bursts into orange chunks when hit', 'count (pumpkins, max 24), radius', ['pumpkins', 'pumpkin field', 'halloween pumpkins', 'pumpkin farm', 'gourds', 'pumpkin'], patchPrim([0xe8742a, 0xf0a030, 0xd8602a], 2.5, 9, [0.3, 0.55], 'pumpkin', true), { size: 2.5, face: 'random', ownCount: true, spacing: 3 });
  def('rock-spires', 'cluster of tall grey stone spires with loose boulders at their feet (Kenney stone-tall / stone-large); tough: needs blasts', 'scale', ['stone spires', 'rock pillars', 'rock formation tall', 'standing rocks', 'stalagmites', 'tall rocks', 'rock needles'], (i, o) => {
    const b = H.mk(), k = o.scale ?? 1, ry = rand(0, TAU), cy = Math.cos(ry), sy = Math.sin(ry); // the whole group is turned by ry, so the blockers are placed with the same turn
    for (let q = 0; q < 4; q++) { const a = q * 1.6 + rand(0, 0.5), r = q ? rand(0.7, 1.5) : 0, h = q ? rand(1.8, 3.2) : 4, w = h * 0.2; b.cone(Math.cos(a) * r, 0, Math.sin(a) * r, w, h, pick(rockMat), [rand(-0.08, 0.08), rand(0, 3), rand(-0.08, 0.08)], 5); const sx = Math.cos(a) * r * k, sz = Math.sin(a) * r * k; blk.cyl(i, sx * cy + sz * sy, -sx * sy + sz * cy, w * 0.55 * k, h * 0.8 * k, { gone: anyBroken(i) }); }
    for (let q = 0; q < 4; q++) { const a = rand(0, TAU), r = rand(1.2, 2.2), s = rand(0.3, 0.6); b.dod(Math.cos(a) * r, s * 0.5, Math.sin(a) * r, s, s * 0.7, s, pick(rockMat), [rand(0, 3), rand(0, 3), 0]); }
    const m = b.build(); m.scale.setScalar(k); m.rotation.y = ry; i.add(m);
  }, { size: 3, face: 'random', spacing: 5 });
  def('mountain', 'a big distant mountain landmark (KayKit hex mountains: bare rock, grassy or tree-covered; option size = width in metres, default 36; style rock|grass|trees); scenery only, cannot be destroyed or climbed', 'size, style', ['mountains', 'peak', 'big mountain', 'mountain peak', 'crag', 'hill mountain', 'distant mountain'], (i, o) => {
    const S = (o.size ?? 36) / 36, b = H.mk();
    b.cone(0, -1, 0, 16 * S, 30 * S, 0x76747a, 0, 7); b.cone(-9 * S, -1, 5 * S, 9 * S, 17 * S, 0x84828a, 0, 6); b.cone(8 * S, -1, -4 * S, 8 * S, 15 * S, 0x6e6c72, 0, 6);
    b.cone(0, 22 * S, 0, 5.2 * S, 8 * S, 0xf0f4f8, 0, 7);
    i.add(b.build());
    blk.cyl(i, 0, 0, 12 * S, 26 * S);
    blk.cyl(i, -9 * S, 5 * S, 7 * S, 14 * S); blk.cyl(i, 8 * S, -4 * S, 6.5 * S, 12 * S); // too steep to walk up: a solid massif
  }, { size: 18, face: 'random', distance: 60, keepOut: 25 });
  def('lily-pads', 'floating lily pads and pink lotus flowers (Kenney lilies; on the lake they sit on the water surface; options count default 14, radius 2.5)', 'count, radius', ['water lilies', 'lilies', 'lilypads', 'lotus', 'lily pad', 'waterlilies', 'lotus flowers'], patchPrim([0x3f8f3f, 0x4a9a44], 2.5, 14, [0.1, 0.1], 'lily', true), { size: 2.5, face: 'random', ownCount: true, spacing: 3 });
  def('reed-patch', 'a clump of reeds and cattails (Kenney water plants) that sway in the wind; best at a shore or around a pond', 'radius, scale', ['reeds', 'cattails', 'bulrushes', 'rushes', 'water plants', 'swamp reeds', 'cat tails'], patchPrim([0x5a8a3a, 0x6a9a44, 0x4a7a34], 1.4, 22, [0.9, 1.6], 'reed'), { size: 1.4, face: 'random', spacing: 3 });
  const fieldPrim = (kind) => (i, o) => {
    const W = o.width ?? 6, D = o.depth ?? 6, b = H.mk(), rows = Math.max(1, Math.round(D / (kind === 'corn' ? 1.3 : 0.9)));
    for (let r = 0; r < rows; r++) {
      const z = -D / 2 + (r + 0.5) * (D / rows); b.box(0, 0.04, z, W, 0.08, 0.5, 0x6a4a2a);
      const n = Math.max(2, Math.round(W / (kind === 'corn' ? 0.8 : 0.5)));
      for (let q = 0; q < n; q++) {
        const x = -W / 2 + (q + 0.5) * (W / n) + rand(-0.1, 0.1), g = gyl(i, x, z);
        if (kind === 'corn') { b.cyl(x, g, z, 0.03, 0.05, rand(1.6, 2.2), 0x5aa03c, [rand(-0.06, 0.06), 0, rand(-0.06, 0.06)], 4); b.cone(x + 0.1, g + 1.2, z, 0.07, 0.35, 0xe6b84a, [0, 0, 0.3], 5); b.cone(x, g + 0.2, z + 0.1, 0.12, 0.8, 0x4a9a34, [0.9, 0, 0], 3); }
        else if (kind === 'wheat') { for (let s = 0; s < 4; s++) b.cone(x + rand(-0.15, 0.15), g, z + rand(-0.12, 0.12), 0.025, rand(0.7, 1.0), pick([0xe6c85a, 0xd8b848, 0xeed070]), [rand(-0.1, 0.1), 0, rand(-0.1, 0.1)], 3); }
        else { b.sph(x, g + 0.18, z, 0.2, 0.17, 0.2, pick([0xe8742a, 0xd84a3a, 0x58a040, 0xc89a50]), [0, rand(0, 3), 0], 6); }
      }
    }
    i.add(b.build());
  };
  def('corn-field', 'a field of tall corn in rows over tilled earth (Kenney corn + dirt rows; options width, depth in metres, default 6 x 6); a blow flattens the ~2 m block of corn around it', 'width, depth', ['corn', 'cornfield', 'maize', 'maize field', 'corn rows', 'farm field corn'], fieldPrim('corn'), { size: 6, face: 'random', ownCount: true, noPush: true, distance: 8 });
  def('wheat-field', 'a golden wheat field in tilled rows (Kenney wheat clumps + dirt rows; options width, depth in metres, default 6 x 6); a blow flattens the block of wheat around it', 'width, depth', ['wheat', 'wheatfield', 'grain field', 'crop field', 'farm field', 'barley'], fieldPrim('wheat'), { size: 6, face: 'random', ownCount: true, noPush: true, distance: 8 });
  def('vegetable-patch', 'a kitchen-garden bed with rows of carrots, turnips, melons and pumpkins in tilled soil (options width, depth, default 4 x 3 m); each block bursts when hit', 'width, depth', ['veg patch', 'vegetable garden', 'carrots', 'crops', 'allotment', 'kitchen garden', 'turnips', 'melons'], fieldPrim('veg'), { size: 4, face: 'random', ownCount: true, noPush: true, distance: 7 });

  // ================================================================================================================
  // MODEL BUILDS (world.models). The primitive builders above are the fallback; see modelkit.js for the contract.
  // ================================================================================================================
  if (mx) {
    const OAK = [['tree-oak', 5.4, 7.2], ['tree-fat', 5, 6.5], ['tree-default', 6.5, 8.5]];
    const PINE = [['tree-pine-default-a', 6, 8.5], ['tree-pine-default-b', 6, 8.5], ['tree-pine-round-a', 5.5, 7.5], ['tree-pine-tall-a', 7, 9.5], ['tree-pine-tall-c', 7, 9.5], ['tree-pine-small-a', 4, 5.5]];
    const BIRCH = [['tree-thin', 5, 6.5], ['tree-simple', 5, 6.5]];
    const PALM = [['tree-palm', 5, 6.5], ['tree-palm-tall', 5, 6.5], ['tree-palm-bend', 5, 6.5], ['tree-palm-detailed-tall', 5, 6.5]];
    const CHERRY = [['tree-detailed', 4.5, 5.5], ['tree-plateau', 4.5, 5.5]];
    const DEAD = [['tree-dead-large', 3.6, 4.6], ['tree-dead-medium', 3, 4], ['tree-dead-small', 2.2, 3.2]];
    const AUTUMN = [['tree-oak-fall', 5.4, 7.2], ['tree-fat-fall', 5, 6.5], ['tree-default-fall', 6.5, 8.5]];

    // a felled tree stops its petals and gives its obstacle circle back (kit keeps at most 96 alive)
    const freeFelled = (i, hh) => { if (i.petals) i.petals.object.visible = false; if (hh && hh.obstacles) for (const ob of hh.obstacles) ob.remove(); };
    // one tree model piece: swaying, kit.fellable (trunk + crown meshes split by mx.treeParts), primitive fallback = whole tree topples
    function treeSpec(list, o2 = {}) {
      return {
        model(P, o) { const [name, lo, hi] = pick(list); return { p: P(name, { height: rand(lo, hi) * (o.scale ?? 1), yaw: rand(0, TAU) }) }; },
        after(pieces, plan, o) {
          const p = plan.p, i = p.inst;
          tweak(p.name, p.h.root);
          if (o2.sway !== 0) swayPiece(p, o2.sway ?? 0.012);
          if (o2.extra) o2.extra(i, p, o);
          mx.fellable(i, p, { hp: 45, block: o2.block, onFell: (hh) => freeFelled(i, hh) });
        },
        destruct: { kind: 'none', primitive: (i, pieces) => { const hh = mx.fellable(i, pieces[0], { hp: 45, block: false, onFell: (h2) => freeFelled(i, h2) }); treeTrunk(i, pieces[0], hh); } },
      };
    }
    reg('oak-tree', treeSpec(OAK));
    reg('pine-tree', treeSpec(PINE));
    reg('birch-tree', treeSpec(BIRCH));
    reg('palm-tree', treeSpec(PALM, { sway: 0.02 }));
    reg('dead-tree', treeSpec(DEAD, { sway: 0 }));
    reg('cherry-blossom', treeSpec(CHERRY, {
      extra(i, p, o) { const k = (o.scale ?? 1); i.petals = H.field(i, { count: 70, area: [7 * k, 5 * k, 7 * k], center: { x: i.x, z: i.z }, baseY: i.y - 0.1, fall: 0.5, sway: 0.7, drift: [0.15, 0.1], color: [0xffc4d4, 0xf4a8c0, 0xffffff], size: 0.07, shape: 'ellipse', spin: 3, alpha: 0.95 }); },
    }));
    reg('autumn-tree', treeSpec(AUTUMN, {
      extra(i, p, o) { const k = (o.scale ?? 1); i.petals = H.field(i, { count: 40, area: [6 * k, 5 * k, 6 * k], center: { x: i.x, z: i.z }, baseY: i.y - 0.1, fall: 0.8, sway: 0.9, drift: [0.25, 0.1], color: [0xd8742a, 0xe8a030, 0xb8402a], size: 0.1, shape: 'ellipse', spin: 3, alpha: 0.95 }); },
    }));
    // willow: a pale-green round crown with a curtain of hanging fronds attached to the tree object (so they fall with it)
    reg('willow', {
      model(P, o) { return { p: P('tree-oak-dark', { height: rand(5, 6) * (o.scale ?? 1), yaw: rand(0, TAU) }) }; },
      after(pieces, plan, o) {
        const p = plan.p, i = p.inst, h = p.size.y, rr = Math.max(p.size.x, p.size.z) * 0.5, b = H.mk(), r = rng((Math.random() * 1e6) | 0);
        tweak(p.name, p.h.root);
        b.mode('cloth');
        for (let k = 0; k < 56; k++) { const a = (k / 56) * TAU + r() * 0.3, hy = h * (0.5 + r() * 0.12), d = rr * (0.72 + r() * 0.25), len = h * (0.25 + r() * 0.17); b.cone(Math.cos(a) * d, hy, Math.sin(a) * d, 0.08, len,[0x8ab050, 0xa8c868, 0x7aa848][(r() * 3) | 0], [PI, 0, 0], 4); }
        p.obj.add(b.build());
        swayPiece(p, 0.02);
        mx.fellable(i, p, { hp: 50, onFell: (hh) => freeFelled(i, hh) });
      },
      destruct: { kind: 'none', primitive: (i, pieces) => { const hh = mx.fellable(i, pieces[0], { hp: 50, block: false, onFell: (h2) => freeFelled(i, h2) }); treeTrunk(i, pieces[0], hh); } },
    });

    // --- bush: 1-2 Kenney plants, burst into leaves and clods
    const BUSH = [['plant-bush-detailed', 1.1, 1.5], ['plant-bush-large', 0.9, 1.3], ['plant-bush', 0.9, 1.3], ['plant-bush-triangle', 1.0, 1.4]];
    reg('bush', {
      model(P, o) {
        const k = (o.scale ?? 1), a = pick(BUSH);
        const out = [P(a[0], { height: rand(a[1], a[2]) * k, yaw: rand(0, TAU), anchor: 'center' })];
        if (Math.random() < 0.6) { const b2 = pick(BUSH), an = rand(0, TAU); out.push(P(b2[0], { x: Math.cos(an) * 0.55 * k, z: Math.sin(an) * 0.55 * k, height: rand(b2[1], b2[2]) * 0.9 * k, yaw: rand(0, TAU), anchor: 'center' })); }
        return { out };
      },
      destruct: { kind: 'break', material: 'earth', hp: 14, chunks: 14 },
    });
    // --- giant mushroom: stays a primitive glow build (luminous caps), but is destructible
    reg('giant-mushroom', { destruct: { kind: 'break', material: 'earth', hp: 30 } });
    reg('crystal-cluster', { destruct: { kind: 'break', material: 'crystal', hp: 30 } });

    // --- boulders / rocks (grey Kenney stone, KayKit hex rocks, survival rocks)
    const BOULDER = [['stone-large-a', 1.0, 1.5], ['rock-a', 1.3, 1.9], ['rock-b', 1.2, 1.8], ['rock-single-e', 1.0, 1.4], ['stone-tall-a', 1.8, 2.6]];
    reg('boulder', {
      model(P, o) { const [n, lo, hi] = pick(BOULDER), k = o.scale ?? 1; return { p: P(n, { height: rand(lo, hi) * k, yaw: rand(0, TAU), anchor: 'center', sink: 0.08 }) }; },
      destruct: (i, pieces) => { mx.breakable(i, pieces, { material: 'stone', hp: 120, stages: 'auto', rubble: ['stone-large-a', 'rock-single-a'] }); if (pieces[0] && pieces[0].ok) blk.piece(i, pieces[0], { shape: 'cyl', inset: 0.85, h: Math.min(pieces[0].size.y, 3) }); },
    });
    const ROCKS = ['rocks-large', 'rocks', 'rocks-tall', 'rock-single-e'], PEBBLES = ['stone-large-a', 'rock-single-a', 'rock-single-c', 'rock-single-d'];
    reg('rock-cluster', {
      model(P, o) {
        const k = o.scale ?? 1, main = pick(ROCKS), out = [P(main, { height: (main === 'rock-single-e' ? 1.0 : rand(1.1, 1.6)) * k, yaw: rand(0, TAU), anchor: 'center' })];
        for (let q = 0; q < 3; q++) { const a = rand(0, TAU), d = rand(1.4, 2.4) * k; out.push(P(pick(PEBBLES), { x: Math.cos(a) * d, z: Math.sin(a) * d, height: rand(0.3, 0.7) * k, yaw: rand(0, TAU), anchor: 'center', sink: 0.05 })); }
        return { out };
      },
      after(pieces, plan) { blk.piece(plan.out[0].inst, plan.out[0], { shape: 'cyl', inset: 0.85, h: Math.min(plan.out[0].size.y, 2.5) }); }, // the big central rock; the pebbles round it are walk-over
      destruct: { kind: 'break', material: 'stone', hp: 110, stages: 'auto', rubble: ['rock-single-a', 'stone-large-a'] },
    });
    // --- waterfall: Kenney stone cliff + the same spray / mist / roar
    reg('waterfall-rock', {
      model(P, o) {
        const k = o.scale ?? 1;
        const base = P('stone-large-a', { x: -1.9, z: 0.5, height: 0.9, yaw: 0.5, anchor: 'center', sink: 0.05 });
        P('stone-large-a', { x: 2.1, z: 0.3, height: 1.1, yaw: 2.2, anchor: 'center', sink: 0.05 });
        P('stone-large-a', { x: 0.2, z: 2.4, height: 0.6, yaw: 4.0, anchor: 'center', sink: 0.05 });
        P('rock-single-c', { x: 1.4, z: 1.9, height: 0.4, yaw: 1, anchor: 'center' });
        P('rock-single-d', { x: -1.2, z: 1.7, height: 0.45, yaw: 2, anchor: 'center' });
        return { base };
      },
      after(pieces, plan, o) { waterfallCliff(plan.base.inst, 4.6, false); waterfallFx(plan.base.inst, 4.6, -0.5); },
      destruct: { kind: 'none' },
    });
    // --- log: Kenney log / hollow log with a couple of toadstools on top
    reg('log', {
      model(P, o) {
        const k = o.scale ?? 1, hollow = Math.random() < 0.4, yaw = rand(0, TAU);
        const lg = P(hollow ? 'log-large' : 'log', { scale: (hollow ? 0.9 : 1.4) * k, yaw, anchor: 'center' });
        const out = [lg], top = (hollow ? 1.1 : 0.7) * k;
        for (let q = 0; q < 2; q++) { const t = rand(-0.7, 0.7) * k, x = Math.sin(yaw) * t, z = Math.cos(yaw) * t; out.push(P(pick(['mushroom-red-tall', 'mushroom-red', 'mushroom-tan']), { x, z, y: gyl(lg.inst, x, z) + top * 0.8, height: rand(0.2, 0.3) * k, yaw: rand(0, TAU), anchor: 'center' })); }
        return { lg, out };
      },
      after(pieces, plan) { blk.piece(plan.lg.inst, plan.lg, { inset: 0.9, h: Math.min(plan.lg.size.y, 1.1) }); },
      destruct: { kind: 'break', material: 'wood', hp: 60, stages: 'auto', rubble: ['log'] },
    });
    reg('stump', {
      model(P, o) { return { p: P(pick(['stump-round', 'stump-round-detailed', 'stump-old', 'stump-square-detailed']), { scale: (o.scale ?? 1) * rand(0.8, 1.2), yaw: rand(0, TAU), anchor: 'center' }) }; },
      after(pieces, plan) { blk.piece(plan.p.inst, plan.p, { shape: 'cyl', inset: 0.85, h: Math.min(plan.p.size.y, 1.2) }); },
      destruct: { kind: 'break', material: 'wood', hp: 40, stages: 'auto' },
    });
    reg('log-pile', {
      model(P, o) { return { p: P(pick(['log-stack', 'log-stack-large']), { scale: (o.scale ?? 1) * 0.8, yaw: rand(0, TAU), anchor: 'center' }) }; },
      after(pieces, plan) { blk.piece(plan.p.inst, plan.p, { inset: 0.9 }); },
      destruct: { kind: 'break', material: 'wood', hp: 60, stages: 'auto', rubble: ['log'] },
    });
    reg('cactus', {
      model(P, o) {
        const k = o.scale ?? 1, out = [P(pick(['cactus-tall', 'cactus-short']), { height: rand(1.4, 2.2) * k, yaw: rand(0, TAU) })];
        if (Math.random() < 0.4) { const a = rand(0, TAU); out.push(P('cactus-short', { x: Math.cos(a) * 0.8 * k, z: Math.sin(a) * 0.8 * k, height: rand(0.6, 1.0) * k, yaw: rand(0, TAU) })); }
        return { out };
      },
      after(pieces, plan) { for (const p of plan.out) blk.piece(p.inst, p, { shape: 'cyl', inset: 0.6 }); },
      destruct: { kind: 'break', material: 'earth', hp: 20, chunks: 12 },
    });
    reg('rock-spires', {
      model(P, o) {
        const k = o.scale ?? 1, out = [P('stone-tall-a', { height: 4.2 * k, yaw: rand(0, TAU), anchor: 'center' })];
        for (let q = 0; q < 3; q++) { const a = q * 2.1 + rand(0, 0.8), d = rand(1.3, 2.0) * k; out.push(P('stone-tall-a', { x: Math.cos(a) * d, z: Math.sin(a) * d, height: rand(2.0, 3.4) * k, yaw: rand(0, TAU), anchor: 'center', sink: 0.05 })); }
        for (let q = 0; q < 3; q++) { const a = rand(0, TAU), d = rand(1.8, 2.8) * k; out.push(P('stone-large-a', { x: Math.cos(a) * d, z: Math.sin(a) * d, height: rand(0.5, 0.9) * k, yaw: rand(0, TAU), anchor: 'center', sink: 0.05 })); }
        return { out };
      },
      destruct: (i, pieces) => { mx.breakable(i, pieces, { material: 'stone', hp: 170, stages: 'auto', rubble: ['stone-large-a'] }); for (const p of pieces) if (p.ok) blk.piece(i, p, { shape: 'cyl', inset: 0.8, h: Math.min(p.size.y, 5) }); },
    });
    const MOUNT = { rock: ['mountain-a', 'mountain-b', 'mountain-c'], grass: ['mountain-a-grass', 'mountain-b-grass', 'mountain-c-grass'], trees: ['mountain-a-grass-trees', 'mountain-b-grass-trees', 'mountain-c-grass-trees'] };
    reg('mountain', {
      model(P, o) {
        const list = MOUNT[o.style] ?? MOUNT[pick(['rock', 'grass', 'trees'])], W = o.size ?? 36, n = pick(list);
        return { p: P(n, { height: W * 0.85, yaw: rand(0, TAU), anchor: 'center', sink: W * 0.03 }) };
      },
      after(pieces, plan) { blk.piece(plan.p.inst, plan.p, { shape: 'cyl', inset: 0.7, h: plan.p.size.y * 0.85, gone: () => false }); },
      destruct: { kind: 'none' },
    });

    // --- patches: instanced Kenney plants, one destructible per patch (or per cell of a field)
    const FL = { red: ['flower-red-a', 'flower-red-b'], yellow: ['flower-yellow-a', 'flower-yellow-b'], purple: ['flower-purple-a', 'flower-purple-b'] };
    const flowerFamily = (c) => { const hsl = {}; new THREE.Color(c).getHSL(hsl); const h = hsl.h; if (h < 0.1 || h > 0.92) return 'red'; if (h < 0.2) return 'yellow'; if (h > 0.5) return 'purple'; return 'yellow'; };
    reg('flower-patch', {
      model() { return {}; },
      build(i, o, fb) {
        const R = (o.radius ?? 1.6) * (o.scale ?? 1), fam = o.color !== undefined ? flowerFamily(o.color) : null;
        const names = fam ? FL[fam] : ['flower-red-a', 'flower-yellow-a', 'flower-purple-a'];
        const N = clamp(Math.round(26 * (R / 1.6) ** 2), 8, 70), items = [];
        for (const p of discPts(i, N, R)) { const n = pick(names); items.push({ name: n, x: p.x, z: p.z, y: gyl(i, p.x, p.z), yaw: rand(0, TAU), scale: hScale(n, rand(0.3, 0.55)) }); }
        for (const p of discPts(i, Math.round(N * 0.4), R * 1.1)) items.push({ name: 'grass-large', x: p.x, z: p.z, y: gyl(i, p.x, p.z), yaw: rand(0, TAU), scale: hScale('grass-large', rand(0.25, 0.4)) });
        const sc = mx.scatterOr(i, items, {}, fb);
        if (sc) { swayItems(i, sc, 0.05); afterSets(i, sc, () => patchBreak(i, sc.items, { material: 'earth', hp: 8, colors: [{ hex: fam === 'yellow' ? 0xffd24a : fam === 'purple' ? 0xb080ff : 0xff6a8a, w: 0.5 }, { hex: 0x4a8a3a, w: 0.5 }] })); }
      },
      destruct: { kind: 'break', material: 'earth', hp: 8 },
    });
    reg('tall-grass-patch', {
      model() { return {}; },
      build(i, o, fb) {
        const R = (o.radius ?? 1.6) * (o.scale ?? 1), N = clamp(Math.round(30 * (R / 1.6) ** 2), 10, 90), names = ['grass-large', 'grass-large', 'plant-flat-tall', 'grass'], items = [];
        for (const p of discPts(i, N, R)) { const n = pick(names); items.push({ name: n, x: p.x, z: p.z, y: gyl(i, p.x, p.z), yaw: rand(0, TAU), scale: hScale(n, rand(0.7, 1.3)) }); }
        const sc = mx.scatterOr(i, items, {}, fb);
        if (sc) { swayItems(i, sc, 0.09); afterSets(i, sc, () => patchBreak(i, sc.items, { material: 'earth', hp: 6, colors: [{ hex: 0x6aaa3a, w: 0.6 }, { hex: 0x8aba50, w: 0.4 }] })); }
      },
      destruct: { kind: 'break', material: 'earth', hp: 6 },
    });
    reg('mushroom-patch', {
      model() { return {}; },
      build(i, o, fb) {
        const R = (o.radius ?? 1.5) * (o.scale ?? 1), N = clamp(Math.round(12 * (R / 1.5) ** 2), 4, 40), names = ['mushroom-red-group', 'mushroom-tan-group', 'mushroom-red-tall', 'mushroom-tan-tall'], items = [];
        for (const p of discPts(i, N, R, { minD: 0.3 })) { const n = pick(names); items.push({ name: n, x: p.x, z: p.z, y: gyl(i, p.x, p.z), yaw: rand(0, TAU), scale: hScale(n, n.includes('group') ? rand(0.3, 0.5) : rand(0.35, 0.6)) }); }
        const sc = mx.scatterOr(i, items, {}, fb);
        if (sc) afterSets(i, sc, () => patchBreak(i, sc.items, { material: 'earth', hp: 8, colors: [{ hex: 0xd8403a, w: 0.4 }, { hex: 0xf0e8d4, w: 0.3 }, { hex: 0xd8a066, w: 0.3 }] }));
      },
      destruct: { kind: 'break', material: 'earth', hp: 8 },
    });
    reg('pumpkin-patch', {
      model() { return {}; },
      build(i, o, fb) {
        const R = o.radius ?? 2.5, N = clamp(Math.floor(o.count ?? 9), 1, 24), names = ['crop-pumpkin', 'pumpkin-orange', 'pumpkin-yellow', 'pumpkin-orange-small'], items = [];
        for (const p of discPts(i, N, R, { minD: 0.8 })) { const n = pick(names); items.push({ name: n, x: p.x, z: p.z, y: gyl(i, p.x, p.z), yaw: rand(0, TAU), scale: hScale(n, rand(0.3, 0.55)) * (o.scale ?? 1) }); }
        mx.scatterOr(i, items, { breakable: { material: 'earth', hp: 6, colors: [{ hex: 0xe8742a, w: 0.7 }, { hex: 0x58a040, w: 0.3 }] } }, fb);
      },
      destruct: { kind: 'break', material: 'earth', hp: 14 },
    });
    // rows of crops over dirt strips; a patch destructible per 2 m cell (the dirt strips stay)
    const fieldSpec = (kind) => ({
      model() { return {}; },
      build(i, o, fb) {
        const W = o.width ?? (kind === 'veg' ? 4 : 6), D = o.depth ?? (kind === 'veg' ? 3 : 6), rowStep = kind === 'corn' ? 1.3 : kind === 'wheat' ? 0.95 : 1.0, rows = Math.max(1, Math.round(D / rowStep)), step = kind === 'corn' ? 0.8 : kind === 'wheat' ? 0.6 : 0.55;
        const VEG = ['crop-carrot', 'crop-turnip', 'crop-melon', 'crop-pumpkin'], vh = { 'crop-carrot': 0.35, 'crop-turnip': 0.3, 'crop-melon': 0.3, 'crop-pumpkin': 0.4 }, items = [];
        for (let r = 0; r < rows; r++) {
          const z = -D / 2 + (r + 0.5) * (D / rows);
          const di = info('crops-dirt-row'), dsx = W / 3, dsz = 0.35, dk = di ? (di.scale ?? 1) : 1;
          items.push({ name: 'crops-dirt-row', x: di ? -(di.min[0] + di.size[0] / 2) * dk * dsx : 0, z: z - (di ? (di.min[2] + di.size[2] / 2) * dk * dsz : 0), y: gyl(i, 0, z) - 0.03, yaw: 0, sx: dsx, sy: 1, sz: dsz, keep: true, still: true });
          const n = Math.max(2, Math.round(W / step));
          for (let q = 0; q < n; q++) {
            const x = -W / 2 + (q + 0.5) * (W / n) + rand(-0.08, 0.08), zz = z + rand(-0.06, 0.06);
            if (waterAt(i.wx(x, zz), i.wz(x, zz))) continue;
            const name = kind === 'corn' ? 'crops-corn-stage-d' : kind === 'wheat' ? 'crops-wheat-stage-b' : VEG[(r + (q >> 2)) % 4];
            const h = kind === 'corn' ? rand(1.7, 2.3) : kind === 'wheat' ? rand(0.8, 1.05) : vh[name] * rand(0.9, 1.2);
            items.push({ name, x, z: zz, y: gyl(i, x, zz), yaw: rand(0, TAU), scale: hScale(name, h) });
          }
        }
        const sc = mx.scatterOr(i, items, {}, fb);
        if (sc) {
          swayItems(i, { items: sc.items.filter((s) => !s.keep && kind !== 'veg'), get removed() { return sc.removed; } }, 0.04);
          afterSets(i, sc, () => { for (const cell of cells(sc.items, 2)) patchBreak(i, cell, { material: 'earth', hp: 14, colors: kind === 'corn' ? [{ hex: 0x5aa03c, w: 0.6 }, { hex: 0xe6b84a, w: 0.4 }] : kind === 'wheat' ? [{ hex: 0xe6c85a, w: 0.7 }, { hex: 0x7a5a3a, w: 0.3 }] : [{ hex: 0x58a040, w: 0.5 }, { hex: 0xe8742a, w: 0.5 }] }); });
        }
      },
      destruct: { kind: 'break', material: 'earth', hp: 40 },
    });
    reg('corn-field', fieldSpec('corn'));
    reg('wheat-field', fieldSpec('wheat'));
    reg('vegetable-patch', fieldSpec('veg'));
    reg('lily-pads', {
      model() { return {}; },
      build(i, o, fb) {
        const R = o.radius ?? 2.5, N = clamp(Math.floor(o.count ?? 14), 2, 60), E = H.ctx.world.env, items = [];
        for (const p of discPts(i, N, R, { minD: 0.7, water: true })) {
          const wx = i.wx(p.x, p.z), wz = i.wz(p.x, p.z), onWater = !!E?.isWater?.(wx, wz), y = onWater ? (E.waterLevel ?? 0) - i.y + 0.02 : gyl(i, p.x, p.z);
          items.push({ name: pick(['lily-large', 'lily-large', 'lily-small', 'waterlily-a', 'waterlily-b']), x: p.x, z: p.z, y, yaw: rand(0, TAU), scale: rand(0.8, 1.3), still: true });
        }
        const sc = mx.scatterOr(i, items, {}, fb);
        if (sc) afterSets(i, sc, () => patchBreak(i, sc.items, { material: 'earth', hp: 6, colors: [{ hex: 0x3f8f3f, w: 0.7 }, { hex: 0xff9ac0, w: 0.3 }] }));
      },
      destruct: { kind: 'break', material: 'earth', hp: 6 },
    });
    reg('reed-patch', {
      model() { return {}; },
      build(i, o, fb) {
        const R = (o.radius ?? 1.4) * (o.scale ?? 1), N = clamp(Math.round(22 * (R / 1.4) ** 2), 6, 80), items = [];
        for (const p of discPts(i, N, R, { water: true })) { const n = pick(['waterplant-b', 'waterplant-b', 'waterplant-a', 'waterplant-c']); items.push({ name: n, x: p.x, z: p.z, y: gyl(i, p.x, p.z) - 0.05, yaw: rand(0, TAU), scale: rand(0.9, 1.6) }); }
        const sc = mx.scatterOr(i, items, {}, fb);
        if (sc) { swayItems(i, sc, 0.08); afterSets(i, sc, () => patchBreak(i, sc.items, { material: 'earth', hp: 6, colors: [{ hex: 0x5a8a3a, w: 0.6 }, { hex: 0x6a4a2a, w: 0.4 }] })); }
      },
      destruct: { kind: 'break', material: 'earth', hp: 6 },
    });

    // --- forests: every tree an instance; the nearest ~12 are promoted to real kit.fellable model objects (mx.scatter fell)
    const UNDER = [['plant-bush-detailed', 0.9, 1.5], ['stone-large-a', 0.5, 0.9]];
    const FOREST = {
      oak: { trees: [OAK[0], OAK[2]], under: UNDER },
      pine: { trees: [PINE[0], PINE[3]], under: UNDER },
      birch: { trees: BIRCH, under: UNDER },
      mixed: { trees: [OAK[0], OAK[2], PINE[0], PINE[3]], under: UNDER },
      autumn: { trees: AUTUMN, under: [['plant-bush-detailed', 0.9, 1.5]] },
      dead: { trees: DEAD, under: [['stone-large-a', 0.5, 0.9]] },
      palm: { trees: [PALM[0], PALM[1]], under: [] },
    };
    const forestSpec = (dflt) => ({
      model() { return {}; },
      build(i, o, fb) {
        if (!M()) { fb(); return; }
        const N = clamp(Math.floor(o.count ?? dflt.count), 1, 400), R = o.radius ?? dflt.radius, st = FOREST[o.style ?? dflt.style] ? (o.style ?? dflt.style) : dflt.style, F = FOREST[st];
        const k = o.scale ?? 1, minD = 2.4 * k, clear = o.clearing ?? dflt.clearing ?? 0, cs = Math.cos(i.yaw), sn = Math.sin(i.yaw);
        const loc = (wx, wz) => { const dx = wx - i.x, dz = wz - i.z; return [dx * cs - dz * sn, dx * sn + dz * cs]; }; // world -> instance-local
        const pts = [];
        for (let tries = 0; pts.length < N && tries < N * 40; tries++) {
          const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, x = i.x + Math.cos(a) * r, z = i.z + Math.sin(a) * r;
          if (Math.hypot(x - H.head.x, z - H.head.z) < 4) continue;
          if (clear && r < clear) continue;
          if (waterAt(x, z)) continue;
          let ok = true; for (const p of pts) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < minD * minD) { ok = false; break; } }
          if (ok) pts.push({ x, z });
        }
        const items = pts.map((p) => {
          const [name, lo, hi] = pick(F.trees), [lx, lz] = loc(p.x, p.z);
          return { name, x: lx, z: lz, y: H.ground(p.x, p.z) - i.y - 0.08, yaw: rand(0, TAU), scale: hScale(name, rand(lo, hi) * rand(0.9, 1.25)) * k };
        });
        const sc = mx.scatterOr(i, items, { fell: { hp: 45, onFell: (s) => { if (s.fh && s.fh.obstacles) for (const ob of s.fh.obstacles) ob.remove(); } }, near: H.ctx.quality?.tier === 'quest' ? 8 : 12, range: 28 }, fb);
        if (!sc) return;
        i.forest = sc;
        afterSets(i, sc, () => { for (const set of sc.sets) for (const mesh of set.meshes) tweak(mesh.name, mesh); });
        // undergrowth: bushes and stones, instanced and not breakable
        const NU = o.undergrowth === false ? 0 : (o.undergrowth === undefined && dflt.undergrowth === false) ? 0 : clamp(Math.round(N * 0.6), 0, 80);
        if (NU && F.under.length) {
          const under = [];
          for (let tries = 0, got = 0; got < NU && tries < NU * 10; tries++) {
            const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, x = i.x + Math.cos(a) * r, z = i.z + Math.sin(a) * r;
            if (Math.hypot(x - H.head.x, z - H.head.z) < 3.5 || (clear && r < clear) || waterAt(x, z)) continue;
            const [name, lo, hi] = pick(F.under), [lx, lz] = loc(x, z);
            under.push({ name, x: lx, z: lz, y: H.ground(x, z) - i.y - 0.04, yaw: rand(0, TAU), scale: hScale(name, rand(lo, hi)) * k }); got++;
          }
          mx.scatter(i, under, {});
        }
        if (dflt.extras) afterSets(i, sc, () => dflt.extras(i));
      },
      destruct: { kind: 'none' },
    });
    reg('forest', forestSpec(FOREST_DEFAULT));
    reg('grove', forestSpec({ ...GROVE_DEFAULT, extras: groveExtras }));
    reg('autumn-forest', forestSpec({ count: 30, radius: 18, style: 'autumn' }));
    reg('dead-forest', forestSpec({ count: 25, radius: 18, style: 'dead' }));
    reg('palm-grove', forestSpec({ count: 12, radius: 9, style: 'palm', clearing: 1.5 }));
  }
}
