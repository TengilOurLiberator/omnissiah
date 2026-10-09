// core/meadow.js - world.meadow: dresses the world BEYOND the spawn area (~38 m out to ~280 m, and on and on as you walk) with the generated model set
// (public/assets/generated/startzone/): forest groves and clumps, bushes and ferns, boulder fields and rock outcrops, standing-stone circles on the high
// ground, a few ruins and landmarks, reeds and willows at the lake. Load AFTER core/world.js (and before things that want it; order is otherwise free).
// It replaces world.js's primitive far standing stones (env.setStones(false) while the meadow is showing; restored on hide/dispose).
//
// API  world.meadow = {
//   setDensity(0..1)      thin the trees / bushes / rocks (landmarks and ruins stay). Default 1. Takes effect within a frame.
//   density               current value (read-only)
//   hide() / show()       user switch (also hidden automatically while travelling, after blast:arrive, and in mixed reality); visible -> bool
//   clearArea(x, z, r)    keep a circle free of meadow objects (other modules use it to open space) -> handle { remove() }; effective at once
//   reseat()              re-read terrain heights (done automatically on 'world:terrain-changed' and when mixed reality ends)
//   debug                 test hooks only: setBudget(n) setFullMul(m) find(speciesKey) heightError() atlasPNG()
//   stats()               { phase ('load'|'bake'|'ready'|'inert'), items, full, billboards, hidden, species, missing, cells, atlas, visible, density, ms, timing }
//                         (for tests / the perf board; `ms` is an average over the last ~10 frames and includes the one-off atlas bake while phase = 'bake')
// }
// HOW IT STAYS CHEAP: everything is a deterministic function of WORLD position (hashed 64 m cells that stream in and out around the player, so the
// world looks dressed wherever you walk; terrain heights come from ctx.groundAt). Every object is either (a) one camera-facing billboard in ONE
// instanced draw (a textured quad per tree/rock/ruin, rendered once from the model into a small atlas at load; cylindrical, lit by the scene's lights
// and fogged like everything else; ruins have 4 baked views), or (b) a real model through lib/gen.js's InstancedMesh (Quest tier: the 2.3k-triangle
// twins) for the nearest few objects in front of you (budget: Quest 5 / PC 18 full models, hero landmarks first), re-chosen 5x per second.
// Quest tier from the spawn view: 1 billboard draw + <= 5 model draws, +5..15k triangles measured. Steady state allocates nothing per frame.
// Quest tier swaps four models whose 2.3k-triangle twins are destroyed (colossus head, giant hand, dolmen, boulder-b) for alternates; PC uses the originals.
// Inert-safe: missing model files are skipped (one console warning); with too few models the module does nothing and leaves world.js alone.
// Events listened: travel:start|arrive, blast:arrive (hide), travel:home, blast:home (show), xr:start|xr:end, world:terrain-changed, quality:changed.
import { gen } from '/game/lib/gen.js';

export const meta = { name: 'Meadow', description: 'Forests, rock outcrops, standing stones and ruins on the horizon, streamed around the player.' };

// ----------------------------------------------------------------------------------------------------------------------------- species
// key, model id, class, nominal size (m, longest side), baked views (4 for things that read differently from the side), buried fraction,
// optional Quest-tier substitute id ('' = not used on Quest): the Quest twins of a few models are destroyed by the optimiser (see index.json tier:'pc')
const SPEC = [
  ['oak', 'sz-tree-oak', 'tree', 12.5, 1, 0.02], ['oakBig', 'x-tree-oak-big', 'tree', 14.5, 1, 0.02], ['pine', 'sz-tree-pine', 'tree', 14.5, 1, 0.01],
  ['pineTall', 'x-tree-pine-tall', 'tree', 17, 1, 0.01], ['birch', 'sz-tree-birch', 'tree', 11.5, 1, 0.02], ['twisted', 'x-tree-twisted', 'tree', 9, 1, 0.03],
  ['autumn', 'x-tree-autumn', 'tree', 10.5, 1, 0.02], ['dead', 'sz-tree-dead', 'tree', 9.5, 1, 0.02], ['willow', 'lg-willow-tree', 'tree', 14, 1, 0.02],
  ['bush', 'sz-bush', 'bush', 2.4, 1, 0.1], ['berry', 'sz-berry-bush', 'bush', 2.2, 1, 0.1], ['thorn', 'x-plant-thornbush', 'bush', 2.4, 1, 0.05],
  ['fern', 'x-plant-fern-big', 'bush', 2.2, 1, 0.1], ['reeds', 'x-plant-tall-reeds', 'reed', 3.2, 1, 0.1],
  ['boulderA', 'sz-boulder-a', 'rock', 7, 1, 0.18], ['boulderB', 'sz-boulder-b', 'rock', 6.5, 1, 0.18, ''], ['cluster', 'sz-boulder-c', 'rock', 6.5, 1, 0.1],
  ['mossy', 'x-rock-mossy-cluster', 'rock', 7.5, 1, 0.1], ['slab', 'x-rock-slab', 'rock', 8, 1, 0.2], ['spire', 'x-rock-spire', 'rock', 12, 1, 0.06],
  ['cliff', 'lg-rock-formation-big', 'rock', 17, 1, 0.06], ['log', 'x-tree-fallen-hollow', 'rock', 7.5, 1, 0.08], ['wall', 'sz-drystone-wall', 'rock', 5.5, 1, 0.12],
  ['runeA', 'sz-runestone-tall', 'stone', 6.5, 1, 0.04], ['runeB', 'sz-runestone-leaning', 'stone', 5.5, 1, 0.05], ['circleStone', 'lg-standing-circle-stone', 'stone', 6.5, 1, 0.04],
  ['pillar', 'sz-pillar-broken-a', 'stone', 5.5, 1, 0.03], ['cairn', 'sz-cairn', 'stone', 3.5, 1, 0.04], ['dolmen', 'lg-dolmen', 'stone', 7, 4, 0.05, ''],
  ['tower', 'lg-ruined-tower', 'ruin', 22, 4, 0.03], ['hall', 'lg-ruined-hall-wall', 'ruin', 13, 4, 0.04],
  ['arch', 'lg-ancient-ruin-arch', 'ruin', 15, 4, 0.03], ['colossus', 'lg-fallen-colossus-head', 'ruin', 14, 4, 0.28, ''], ['giant', 'sz-pilgrim-statue', 'ruin', 17, 4, 0.04], ['hand', 'lg-giant-hand-statue', 'ruin', 13, 4, 0.04, 'lg-broken-sun-statue'],
  ['gear', 'lg-giant-gear-ruin', 'ruin', 22, 4, 0.1], ['gate', 'lg-ancient-gate', 'ruin', 17, 4, 0.03], ['beacon', 'lg-signal-beacon', 'ruin', 15, 1, 0.03],
  ['temple', 'lg-ruined-temple-front', 'ruin', 18, 4, 0.03], ['gearBuried', 'sz-gear-buried', 'ruin', 9, 4, 0.15],
];
// per class: bias (lower = earns a real model sooner), maxD (hidden beyond), full model distance = (base + size * per) * tier multiplier
const CLS = {
  tree: { bias: 1.0, maxD: 285, base: 40, per: 6, tc: [1, 1, 1] }, bush: { bias: 1.7, maxD: 125, base: 25, per: 5, tc: [1, 1, 1] }, reed: { bias: 2.2, maxD: 130, base: 20, per: 4, tc: [0.9, 1, 0.9] },
  rock: { bias: 1.15, maxD: 260, base: 40, per: 9, tc: [0.9, 0.95, 1.02] }, stone: { bias: 0.75, maxD: 285, base: 50, per: 12, tc: [0.86, 0.92, 1.04] }, ruin: { bias: 0.5, maxD: 300, base: 60, per: 8, tc: [0.82, 0.9, 1.06] },
  // tc: colour multiplier (cools the red sandstone of the ruins so they stay readable against the sunset glow); applied to billboards and models alike
};
const CS = 64, GEN_R = 300, KEEP_R = 380, TAU = Math.PI * 2, GAIN = 1.0;

// ----------------------------------------------------------------------------------------------------------------------------- hashing / noise (pure)
function h2(i, j, s) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(xi, zi, s), b = h2(xi + 1, zi, s), c = h2(xi, zi + 1, s), d = h2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z, s) => 0.62 * vnoise(x, z, s) + 0.28 * vnoise(x * 2.1 + 7.3, z * 2.1 + 3.1, s + 1) + 0.10 * vnoise(x * 4.3 + 1.7, z * 4.3 + 9.4, s + 2);
const sstep = (a, b, x) => { const t = x < a ? 0 : x > b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);
// racetrack (creations/racetrack.js) control polygon: kept clear in case the player has made it
const RACE = [[12, -45], [32, -44], [50, -30], [52, -5], [36, 10], [40, 32], [22, 50], [-5, 46], [-22, 34], [-46, 36], [-56, 14], [-44, -8], [-52, -30], [-34, -46], [-12, -46]];
function distRace(x, z) {
  let best = 1e9;
  for (let i = 0; i < RACE.length; i++) {
    const a = RACE[i], b = RACE[(i + 1) % RACE.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) best = d;
  }
  return best;
}

// ----------------------------------------------------------------------------------------------------------------------------- the module
export default function (ctx) {
  const THREE = ctx.THREE, root = ctx.root, world = ctx.world;
  const pc = !!(ctx.quality && ctx.quality.pc);
  let disposed = false;
  ctx.onDispose(() => { disposed = true; });
  const T = pc
    ? { spacing: 6.4, cap: 4800, budget: 18, cell: 128, aw: 2048, ah: 1024, fullMul: 1.0, copse: 1.4, slots: 28 }
    : { spacing: 9.2, cap: 2800, budget: 5, cell: 96, aw: 1024, ah: 1024, fullMul: 0.6, copse: 1.0, slots: 12 };
  const G = (x, z) => { let y = 0; try { y = ctx.groundAt(x, z); } catch { /* world reloading */ } return Number.isFinite(y) ? y : 0; };
  const lake = (world && world.env && world.env.lake) || { x: -30, z: -78, radius: 38 };
  const isWater = (x, z) => { try { return !!(world.env && world.env.isWater && world.env.isWater(x, z)); } catch { return false; } };

  const SP = SPEC.map(([key, id, cls, size, views, sink, alt], i) => ({ i, key, id: pc || alt === undefined ? id : alt, skip: !pc && alt === '', cls, size, views, sink, ok: false, side: 1, col: 0, row: 0, h: null, full: null, parts: null, cnt: 0 }));
  const IX = {}; for (const s of SP) IX[s.key] = s.i;

  // ------------------------------------------------------------------------------------------------------------------------- placement rules
  const clears = []; // { x, z, r }
  const excl = [];   // authored set pieces keep trees and rocks off their ground: { x, z, r }
  const cones = [];  // and their sightlines from the spawn point stay open for anything tall: { az, half, d }
  function blocked(x, z, cls, size, extra) {
    const r = Math.hypot(x, z);
    if (r < 38) return true;
    if (cls !== 'reed') {
      if (Math.hypot(x - lake.x, z - lake.z) < lake.radius + 4.5 || isWater(x, z)) return true;
    }
    if (size > 6 && z < -30 && Math.abs(x) < 15) return true; // the sightline up to the Omnissiah's sphere stays open
    if (distRace(x, z) < 13) return true;
    if (!extra) {
      for (const e of excl) if ((x - e.x) * (x - e.x) + (z - e.z) * (z - e.z) < e.r * e.r) return true;
      if (size > 5) { const az = Math.atan2(x, -z); for (const c of cones) { let d = az - c.az; d -= TAU * Math.round(d / TAU); if (Math.abs(d) < c.half && r < c.d) return true; } }
    }
    return false;
  }
  function seat(x, z, size, cls) {
    let y = G(x, z);
    if (cls === 'ruin' || cls === 'stone' || size > 8) {
      const r = size * 0.28;
      y = Math.min(y, G(x + r, z), G(x - r, z), G(x, z + r), G(x, z - r));
    }
    return y;
  }
  function mk(key, x, z, size, rng, o) {
    o = o || {};
    const s = SP[IX[key]];
    const it = { sp: s.i, x, z, size, yaw: o.yaw !== undefined ? o.yaw : rng() * TAU, flip: rng() < 0.5 ? 1 : 0, tint: 0.9 + rng() * 0.17, rank: rng(), sinkAmt: size * s.sink, pcOnly: !!o.pcOnly, hero: s.cls === 'ruin' || s.cls === 'stone' };
    it.y = seat(x, z, size, s.cls) - it.sinkAmt;
    return it;
  }
  const reseatItem = (it) => { const s = SP[it.sp]; it.y = seat(it.x, it.z, it.size, s.cls) - it.sinkAmt; };

  function openMask(x, z, r) { // keep the view toward the Omnissiah (and, less, behind you) airy: forest returns only far out
    const az = Math.atan2(x, -z), b = Math.abs(az) - Math.PI, open = Math.min(1, Math.exp(-az * az / 0.5) + 0.6 * Math.exp(-b * b / 0.35));
    return 1 - 0.85 * open * (1 - sstep(130, 215, r));
  }
  const forestAt = (x, z, h) => sstep(0.455, 0.54, fbm(x / 150, z / 150, 11) + 0.10 * Math.max(-1, Math.min(1, h / 12))) * (1 - 0.7 * sstep(0.6, 0.7, vnoise(x / 30, z / 30, 5)));
  function pickTree(rng, zone) {
    const r = rng();
    if (zone < 0.4) return r < 0.55 ? 'pine' : r < 0.9 ? 'pineTall' : r < 0.96 ? 'birch' : 'dead';
    if (zone > 0.6) return r < 0.42 ? 'oak' : r < 0.72 ? 'oakBig' : r < 0.84 ? 'birch' : r < 0.92 ? 'twisted' : r < 0.97 ? 'autumn' : 'dead';
    return r < 0.24 ? 'oak' : r < 0.34 ? 'oakBig' : r < 0.55 ? 'pine' : r < 0.67 ? 'pineTall' : r < 0.8 ? 'birch' : r < 0.88 ? 'twisted' : r < 0.94 ? 'autumn' : 'dead';
  }
  const BUSHES = ['bush', 'berry', 'thorn', 'fern', 'bush', 'fern'];
  const BOULDERS = ['boulderA', 'boulderB', 'cluster', 'mossy', 'slab', 'boulderA'];
  const sz = (key, rng, lo, hi) => SP[IX[key]].size * (lo + (hi - lo) * rng());
  const treeSize = (key, rng, F) => sz(key, rng, 0.68, 1.4) * (0.92 + 0.2 * F);

  // ------------------------------------------------------------------------------------------------------------------------- authored set pieces
  const yawTo = (x, z) => Math.atan2(-x, -z); // local +Z points at the spawn point
  function snapHigh(x, z, R) { // the highest ground within R metres (a ridge crest for the stones and ruins)
    if (!R) return { x, z };
    let best = { x, z }, hy = G(x, z) - 0.001 * 0;
    for (let dz = -R; dz <= R; dz += 6) for (let dx = -R; dx <= R; dx += 6) {
      if (dx * dx + dz * dz > R * R) continue;
      const y = G(x + dx, z + dz) - 0.004 * Math.hypot(dx, dz);
      if (y > hy) { hy = y; best = { x: x + dx, z: z + dz }; }
    }
    return best;
  }
  // each set: centre, snap radius, exclusion radius, builder(c, add, rng); add(key, dx, dz, size, yawOff, opts) places relative to the set facing the spawn point
  const ring = (add, keys, n, R, sizeLo, sizeHi, rng, face) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + (rng() - 0.5) * 0.25, r = R * (0.92 + rng() * 0.16);
      add(keys[Math.floor(rng() * keys.length) % keys.length], Math.sin(a) * r, Math.cos(a) * r, sizeLo + rng() * (sizeHi - sizeLo), face ? a + Math.PI : rng() * TAU, { abs: true });
    }
  };
  const boulderRing = (add, rng, n, rLo, rHi, sLo, sHi) => {
    for (let k = 0; k < n; k++) { const a = rng() * TAU, r = rLo + rng() * (rHi - rLo); add(BOULDERS[Math.floor(rng() * 6)], Math.sin(a) * r, Math.cos(a) * r, sLo + rng() * (sHi - sLo), rng() * TAU); }
  };
  const SETS = [
    { name: 'towerHill', x: -225, z: -45, snap: 35, r: 36, f(add, rng) {
      add('tower', 0, 0, 24, 0.2); add('hall', -17, 9, 14, 0.7); add('hall', 17, 13, 12, -0.6); add('arch', 3, 27, 15, 0);
      boulderRing(add, rng, 9, 12, 30, 5, 9);
      for (let k = 0; k < 6; k++) { const a = rng() * TAU, r = 20 + rng() * 14; add(rng() < 0.7 ? 'pine' : 'pineTall', Math.sin(a) * r, -Math.abs(Math.cos(a)) * r - 6, 9 + rng() * 5, 0); }
    } },
    { name: 'colossus', x: 36, z: -84, snap: 0, r: 24, f(add, rng) {
      add('giant', 0, 0, 17, 0); add('colossus', -21, 9, 13, 0.4); add('hand', 24, -9, 13, 0.9);
      add('slab', -14, 8, 6, 0.3); add('mossy', 12, 15, 6, 1); add('boulderA', -20, -6, 6.5, 2);
      for (let k = 0; k < 7; k++) { const a = rng() * TAU, r = 7 + rng() * 14; add('fern', Math.sin(a) * r, Math.cos(a) * r, 2.6 + rng(), rng() * TAU); }
      add('oakBig', -26, -14, 12, 0); add('oak', 36, 10, 10, 1);
    } },
    { name: 'gearRidge', x: 205, z: 10, snap: 30, r: 34, f(add, rng) {
      add('gear', 0, 0, 26, 0); add('gearBuried', -19, 14, 10, 1.1);
      boulderRing(add, rng, 7, 12, 26, 5, 8);
      add('pineTall', 22, -14, 13, 0); add('pine', -22, -12, 11, 0); add('pine', 14, -22, 10, 0);
    } },
    { name: 'circleNW', x: -185, z: -142, snap: 40, r: 22, f(add, rng) {
      ring(add, ['runeA', 'circleStone', 'runeB', 'circleStone', 'runeA'], 7, 12, 5.5, 8, rng, true); add('dolmen', 0, 0, 7.5, 0.4);
      boulderRing(add, rng, 4, 16, 22, 3, 5);
    } },
    { name: 'circleSE', x: 95, z: 118, snap: 40, r: 22, f(add, rng) {
      ring(add, ['circleStone', 'runeB', 'runeA', 'circleStone'], 6, 11, 5.5, 7.5, rng, true); add('cairn', 0, 0, 4, 0);
      boulderRing(add, rng, 4, 15, 21, 3, 5);
    } },
    { name: 'circleNE', x: 227, z: -226, snap: 40, r: 24, f(add, rng) {
      ring(add, ['runeA', 'circleStone', 'runeB', 'runeA', 'circleStone'], 8, 13, 6, 9, rng, true); add('dolmen', 0, 0, 10, 0); add('cairn', 5, 4, 4, 0);
      boulderRing(add, rng, 5, 17, 24, 3, 6);
    } },
    { name: 'temple', x: -100, z: 150, snap: 40, r: 30, f(add, rng) {
      add('temple', 0, 0, 20, 0); add('hall', -19, 6, 12, 0.5); add('arch', 18, 10, 13, -0.4); add('pillar', 8, 22, 6, 0);
      boulderRing(add, rng, 6, 14, 28, 4, 8);
      for (let k = 0; k < 5; k++) { const a = rng() * TAU, r = 20 + rng() * 12; add('pine', Math.sin(a) * r, -Math.abs(Math.cos(a)) * r - 8, 9 + rng() * 5, 0); }
    } },
    { name: 'gate', x: -40, z: -232, snap: 20, r: 24, f(add, rng) {
      add('gate', 0, 0, 18, 0); add('pillar', 12, 7, 6, 0.3); boulderRing(add, rng, 6, 10, 20, 4, 8); add('pineTall', -16, -8, 13, 0); add('oak', 18, -10, 10, 0);
    } },
    { name: 'archLake', x: -58, z: -124, snap: 0, r: 24, f(add, rng) {
      add('arch', 0, 0, 15, 0); add('pillar', 12, 5, 6, 0.4); add('pillar', -11, 7, 5, 1); add('hall', -22, -6, 11, 0.8);
      boulderRing(add, rng, 5, 8, 18, 4, 8); add('willow', 16, 10, 15, 0);
    } },
    { name: 'beacon', x: 150, z: -150, snap: 25, r: 20, f(add, rng) {
      add('beacon', 0, 0, 17, 0); add('cairn', 8, 8, 4, 0); boulderRing(add, rng, 6, 7, 16, 4, 7); add('pine', -12, -8, 11, 0);
    } },
  ];
  const extra = new Map(); // cellKey -> authored items (set pieces and the lake shore), built once
  function pushExtra(it) { const k = cellKey(Math.floor(it.x / CS), Math.floor(it.z / CS)); let a = extra.get(k); if (!a) extra.set(k, a = []); a.push(it); }
  function buildAuthored() {
    extra.clear(); excl.length = 0; cones.length = 0;
    for (const S of SETS) {
      const c = snapHigh(S.x, S.z, S.snap), rng = mulberry(h2(Math.round(S.x), Math.round(S.z), 7) * 4294967296 >>> 0);
      const yaw = yawTo(c.x, c.z), cy = Math.cos(yaw), sy = Math.sin(yaw);
      if (S.r) excl.push({ x: c.x, z: c.z, r: S.r });
      const dist = Math.hypot(c.x, c.z);
      if (S.r && dist > 90) cones.push({ az: Math.atan2(c.x, -c.z), half: Math.atan2(S.r * 0.75, dist) + 0.035, d: dist - S.r * 0.4 });
      const add = (key, dx, dz, size, yo, opt) => {
        if (!IX.hasOwnProperty(key)) return;
        let x, z, yw;
        if (opt && opt.abs) { x = c.x + dx; z = c.z + dz; yw = yo; } else { x = c.x + dx * cy + dz * sy; z = c.z - dx * sy + dz * cy; yw = yaw + yo; }
        if (blocked(x, z, SP[IX[key]].cls, 0, true)) return;
        pushExtra(mk(key, x, z, size, rng, { yaw: yw }));
      };
      S.f(add, rng);
    }
    // lake shore: reed clumps, the odd willow, boulders (the lake is the player's to enjoy: nothing stands IN it)
    const rng = mulberry(0x1a4e);
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * TAU, nz = vnoise(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 5, 71);
      if (nz < 0.58) continue;
      const rr = lake.radius + 0.5 + rng() * 2.6, cx = lake.x + Math.cos(a) * rr, cz = lake.z + Math.sin(a) * rr;
      if (Math.hypot(cx, cz) < 38) continue;
      const n = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) { const x = cx + (rng() - 0.5) * 5, z = cz + (rng() - 0.5) * 3.5; if (!blocked(x, z, 'reed', 0, true)) pushExtra(mk('reeds', x, z, sz('reeds', rng, 0.6, 1.0), rng)); }
      if (nz > 0.7 && rng() < 0.5) { const x = lake.x + Math.cos(a) * (lake.radius + 4 + rng() * 3), z = lake.z + Math.sin(a) * (lake.radius + 4 + rng() * 3); if (!blocked(x, z, 'tree', 11, true)) pushExtra(mk(rng() < 0.5 ? 'willow' : 'oak', x, z, sz('willow', rng, 0.8, 1.2), rng)); }
      else if (nz > 0.58 && rng() < 0.3) { const x = cx + (rng() - 0.5) * 6, z = cz + (rng() - 0.5) * 6; if (!blocked(x, z, 'rock', 4, true)) pushExtra(mk(BOULDERS[Math.floor(rng() * 6)], x, z, 3.5 + rng() * 2.5, rng)); }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------- one 64 m cell
  const cells = new Map(); // key -> { ci, cj, items }
  function genCell(ci, cj) {
    const out = [], rng = mulberry((h2(ci, cj, 91) * 4294967296) >>> 0), x0 = ci * CS, z0 = cj * CS;
    const n = Math.ceil(CS / T.spacing), sp = CS / n;
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
      const x = x0 + (gx + 0.5 + (rng() - 0.5) * 0.9) * sp, z = z0 + (gz + 0.5 + (rng() - 0.5) * 0.9) * sp;
      const r = Math.hypot(x, z), q1 = rng(), q2 = rng(), q3 = rng(), q4 = rng();
      if (r < 38) continue;
      const h = G(x, z), F = forestAt(x, z, h) * sstep(62, 112, r) * openMask(x, z, r), zone = vnoise(x / 52, z / 52, 31);
      if (q1 < F * 0.93) {
        const key = pickTree(() => q2, zone), size = treeSize(key, () => q3, F);
        if (!blocked(x, z, 'tree', size)) {
          out.push(mk(key, x, z, size, rng));
          if (rng() < 0.4) { const a = rng() * TAU, d = size * 0.26 + 1.2, bk = BUSHES[Math.floor(rng() * 6)]; out.push(mk(bk, x + Math.sin(a) * d, z + Math.cos(a) * d, sz(bk, rng, 0.7, 1.2), rng, { pcOnly: rng() < 0.5 })); }
        }
      } else if (F > 0.04 && F < 0.8 && q2 < 0.2 * (1 - Math.abs(F - 0.35) * 1.3)) {
        const key = BUSHES[Math.floor(q3 * 6)], size = sz(key, rng, 0.8, 1.3);
        if (!blocked(x, z, 'bush', size)) out.push(mk(key, x, z, size, rng));
      } else if (F > 0.7 && q2 < 0.22) {
        const key = BUSHES[Math.floor(q3 * 6)], size = sz(key, rng, 0.8, 1.3);
        if (!blocked(x, z, 'bush', size)) out.push(mk(key, x, z, size, rng, { pcOnly: q4 < 0.5 }));
      }
    }
    // copses: dense clumps of 4-9 trees with their bushes, standing in the open (the clearings between them are the point)
    for (let k = 0, nc = (rng() < 0.8 ? 1 : 0) + (rng() < 0.4 ? 1 : 0); k < nc; k++) {
      const cx = x0 + rng() * CS, cz = z0 + rng() * CS, r = Math.hypot(cx, cz), dom = ['oak', 'pine', 'birch', 'oakBig', 'pineTall'][Math.floor(rng() * 5)];
      const R = 5 + rng() * 5, cnt = Math.round((4 + rng() * 5) * T.copse), F0 = forestAt(cx, cz, G(cx, cz));
      if (r < 44 || F0 > 0.5) continue;
      const placed = [];
      for (let t = 0; t < cnt * 3 && placed.length < cnt; t++) {
        const a = rng() * TAU, d = R * Math.sqrt(rng()), x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
        if (placed.some((p) => (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z) < 14)) continue;
        const key = rng() < 0.72 ? dom : pickTree(rng, 0.5), size = sz(key, rng, 0.75, 1.25) * (1.12 - 0.3 * d / R);
        if (blocked(x, z, 'tree', size)) continue;
        placed.push([x, z]); out.push(mk(key, x, z, size, rng));
      }
      for (let t = 0, nb = 2 + Math.floor(rng() * 4); t < nb; t++) {
        const a = rng() * TAU, d = R * (0.8 + rng() * 0.6), x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d, key = BUSHES[Math.floor(rng() * 6)];
        if (!blocked(x, z, 'bush', 2)) out.push(mk(key, x, z, sz(key, rng, 0.8, 1.3), rng));
      }
      if (rng() < 0.35) { const a = rng() * TAU, x = cx + Math.sin(a) * R * 0.5, z = cz + Math.cos(a) * R * 0.5; if (!blocked(x, z, 'rock', 4)) out.push(mk('log', x, z, sz('log', rng, 0.7, 1.1), rng)); }
    }
    // a few lone specimens in the first stretch of meadow (a tree, a boulder pair): midground between you and the tree line
    if (rng() < 0.4) {
      const cx = x0 + rng() * CS, cz = z0 + rng() * CS, r = Math.hypot(cx, cz), q = rng(), key = pickTree(rng, rng());
      if (r > 40 && r < 95 && forestAt(cx, cz, 0) < 0.3) {
        if (q < 0.6) { const size = sz(key, rng, 0.6, 1.1); if (!blocked(cx, cz, 'tree', size)) out.push(mk(key, cx, cz, size, rng)); }
        else for (let t = 0; t < 2; t++) { const k2 = BOULDERS[Math.floor(rng() * 6)], x = cx + (rng() - 0.5) * 8, z = cz + (rng() - 0.5) * 8; if (!blocked(x, z, 'rock', 6)) out.push(mk(k2, x, z, sz(k2, rng, 0.5, 1.0), rng)); }
      }
    }
    // rock outcrops and boulder fields
    if (rng() < 0.5) {
      const cx = x0 + rng() * CS, cz = z0 + rng() * CS, r = Math.hypot(cx, cz), hi = G(cx, cz);
      if (r > 50 && !blocked(cx, cz, 'rock', 8)) {
        const cliff = rng() < 0.35 + 0.02 * Math.max(0, hi);
        if (cliff) {
          out.push(mk('cliff', cx, cz, sz('cliff', rng, 0.7, 1.15), rng));
          if (rng() < 0.4) out.push(mk('spire', cx + 9, cz + 4, sz('spire', rng, 0.7, 1.1), rng));
        }
        const nb = cliff ? 3 + Math.floor(rng() * 4) : 5 + Math.floor(rng() * 7), R = cliff ? 10 : 12 + rng() * 8;
        for (let t = 0; t < nb; t++) {
          const a = rng() * TAU, d = (cliff ? 6 : 0) + R * Math.sqrt(rng()), x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d, key = BOULDERS[Math.floor(rng() * 6)];
          if (!blocked(x, z, 'rock', 4)) out.push(mk(key, x, z, sz(key, rng, 0.55, 1.35) * (1.1 - 0.4 * d / (R + 6)), rng));
        }
        for (let t = 0, nf = 2 + Math.floor(rng() * 4); t < nf; t++) {
          const a = rng() * TAU, d = 4 + R * rng(), x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
          if (!blocked(x, z, 'bush', 2)) out.push(mk(rng() < 0.6 ? 'fern' : 'thorn', x, z, 2.4 + rng(), rng));
        }
      }
    }
    // lone monuments and far ruins beyond the authored ones
    const rr = rng(), mx = x0 + rng() * CS, mz = z0 + rng() * CS, mr = Math.hypot(mx, mz);
    if (mr > 140 && rr < 0.04 && !blocked(mx, mz, 'stone', 6)) {
      const key = ['runeA', 'runeB', 'cairn', 'pillar', 'circleStone'][Math.floor(rng() * 5)];
      out.push(mk(key, mx, mz, sz(key, rng, 0.85, 1.2), rng));
    } else if (mr > 170 && rr > 0.97 && !blocked(mx, mz, 'ruin', 14)) {
      const key = ['tower', 'hall', 'arch', 'temple', 'colossus', 'gate', 'beacon'][Math.floor(rng() * 7)];
      out.push(mk(key, mx, mz, sz(key, rng, 0.85, 1.2), rng));
      for (let t = 0; t < 4; t++) { const a = rng() * TAU, d = 8 + rng() * 14, x = mx + Math.sin(a) * d, z = mz + Math.cos(a) * d, k2 = BOULDERS[Math.floor(rng() * 6)]; if (!blocked(x, z, 'rock', 4)) out.push(mk(k2, x, z, 4 + rng() * 4, rng)); }
    }
    const ex = extra.get(cellKey(ci, cj));
    if (ex) for (const it of ex) out.push(it);
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------------------- state: compiled arrays
  const CAP = T.cap;
  let N = 0;
  const IT = new Array(CAP);
  const X = new Float32Array(CAP), Z = new Float32Array(CAP), SZ = new Float32Array(CAP), MAXD = new Float32Array(CAP), FULLD = new Float32Array(CAP), BIAS = new Float32Array(CAP);
  const SPI = new Uint8Array(CAP), STAT = new Uint8Array(CAP), NEWS = new Uint8Array(CAP);
  const candIdx = new Int32Array(CAP), candKey = new Float32Array(CAP);
  const MAXSEL = 80, selIdx = new Int32Array(MAXSEL + 1), selKey = new Float32Array(MAXSEL + 1);
  let budgetNow = T.budget, fullMulNow = T.fullMul;
  let density = 1, visibleWanted = true, away = false, phase = 'load', bakeDone = false, dirty = true, atlasInfo = '', missing = [];
  const tm = { init: 0, lod: 0, lodMax: 0, compile: 0, compileMax: 0, stream: 0, streamMax: 0, bake: 0 };
  let needStream = true, ms = 0, anchorCi = 1e9, anchorCj = 1e9, tLod = 1, tStream = 0, tStone = 0, terrainDirtyAt = -1, clock = 0, lodCount = { full: 0, bill: 0, hidden: 0 };
  const stoneHidden = { v: false };

  // billboards (one instanced draw)
  let bill = null, billMat = null, billGeo = null, aCell = null, aInfo = null, atlasTex = null;
  const _M = new THREE.Matrix4(), _P = new THREE.Vector3(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(), _E = new THREE.Euler(), _C = new THREE.Color();
  const fullRoot = new THREE.Group(); fullRoot.name = 'meadow-full'; fullRoot.userData.noShadow = true; fullRoot.userData.noBlob = true; fullRoot.userData.noOutline = true; root.add(fullRoot);

  function createBillboards() {
    billGeo = new THREE.PlaneGeometry(1, 1); billGeo.translate(0, 0.5, 0);
    aCell = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4); aInfo = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4); aInfo.setUsage(THREE.DynamicDrawUsage);
    billGeo.setAttribute('aCell', aCell); billGeo.setAttribute('aInfo', aInfo);
    billMat = new THREE.MeshStandardMaterial({ alphaTest: 0.45, fog: true, roughness: 0.85, metalness: 0 }); // same light model as the generated models: the atlas holds albedo only
    billMat.onBeforeCompile = (sh) => {
      sh.uniforms.uGain = { value: GAIN };
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute vec4 aCell;\nattribute vec4 aInfo;\nvoid main() {\n  vec3 bbAnchor = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;\n' +
          '  float bbSide = length(instanceMatrix[0].xyz) * (aInfo.w > 0.5 ? 0.0 : 1.0);\n  vec2 bbH = (cameraPosition - bbAnchor).xz; float bbL = max(length(bbH), 0.001); vec2 bbF = bbH / bbL;\n' +
          '  vec3 bbRight = vec3(bbF.y, 0.0, -bbF.x);\n  float bbIdx = mod(floor((aInfo.x - atan(bbF.x, bbF.y)) / 6.2831853 * aInfo.y + 0.5), aInfo.y);\n' +
          '  vec2 bbUv = uv; if (aInfo.z > 0.5) bbUv.x = 1.0 - bbUv.x; bbUv = bbUv * 0.94 + 0.03;\n')
        .replace('#include <uv_vertex>', '#ifdef USE_MAP\n vMapUv = vec2(aCell.x + (bbIdx + bbUv.x) * aCell.z, aCell.y + bbUv.y * aCell.w);\n#endif')
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize((viewMatrix * vec4(normalize(vec3(bbF.x * 0.55, 0.8, bbF.y * 0.55)), 0.0)).xyz);')
        .replace('#include <project_vertex>', 'vec3 bbPos = bbAnchor + bbRight * (position.x * bbSide) + vec3(0.0, 1.0, 0.0) * (position.y * bbSide);\n vec4 mvPosition = viewMatrix * vec4(bbPos, 1.0);\n gl_Position = projectionMatrix * mvPosition;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uGain;\nvoid main() {').replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= uGain;');
      billMat.userData.shader = sh;
    };
    billMat.customProgramCacheKey = () => 'meadow-bill';
    bill = new THREE.InstancedMesh(billGeo, billMat, CAP);
    bill.name = 'meadow-billboards'; bill.count = 0; bill.frustumCulled = false; bill.castShadow = false; bill.receiveShadow = false;
    bill.userData.noShadow = true; bill.userData.noOutline = true; bill.visible = false;
    bill.setColorAt(0, _C.set(0xffffff));
    root.add(bill);
  }

  // ------------------------------------------------------------------------------------------------------------------------- compile: cells -> typed arrays
  const qualityDensity = () => { const d = ctx.quality && ctx.quality.density; return typeof d === 'number' && d > 0 && d < 1 ? Math.max(0.5, d) : 1; }; // core/perf.js lowers quality.density under load
  const keepSet = []; // cells sorted by distance, reused
  function compile() {
    const hx = ctx.player.head.x, hz = ctx.player.head.z;
    keepSet.length = 0;
    for (const c of cells.values()) { const d = Math.hypot((c.ci + 0.5) * CS - hx, (c.cj + 0.5) * CS - hz); keepSet.push([d, c]); }
    keepSet.sort((a, b) => a[0] - b[0]);
    let n = 0;
    outer: for (const [, c] of keepSet) {
      for (const it of c.items) {
        const s = SP[it.sp];
        if (!s.ok) continue;
        if (!it.hero && it.rank > density * qualityDensity()) continue;
        if (it.pcOnly && !pc) continue;
        let cut = false;
        for (let k = 0; k < clears.length; k++) { const q = clears[k]; if ((it.x - q.x) * (it.x - q.x) + (it.z - q.z) * (it.z - q.z) < q.r * q.r) { cut = true; break; } }
        if (cut) continue;
        if (n >= CAP) break outer;
        const cl = CLS[s.cls];
        IT[n] = it; X[n] = it.x; Z[n] = it.z; SZ[n] = it.size; SPI[n] = it.sp; MAXD[n] = cl.maxD; BIAS[n] = cl.bias;
        FULLD[n] = s.full ? (cl.base + it.size * cl.per) * fullMulNow : 0;
        n++;
      }
    }
    N = n; STAT.fill(255, 0, CAP); dirty = false;
    fillBillboards();
    tLod = 1;
  }
  function fillBillboards() {
    if (!bill) return;
    bill.count = N;
    const ci = aCell.array, ii = aInfo.array;
    for (let i = 0; i < N; i++) {
      const it = IT[i], s = SP[it.sp], side = s.side * it.size;
      _P.set(it.x, it.y, it.z); _S.set(side, side, side);
      _M.compose(_P, _Q.identity(), _S); bill.setMatrixAt(i, _M);
      const t = it.tint, v = 0.96 + (it.flip - 0.5) * 0.02;
      const tc = CLS[s.cls].tc;
      bill.setColorAt(i, _C.setRGB(t * tc[0], t * v * tc[1], t * (0.94 + 0.08 * it.rank) * tc[2]));
      const o = i * 4; ci[o] = s.col * T.cell / T.aw; ci[o + 1] = s.row * T.cell / T.ah; ci[o + 2] = T.cell / T.aw; ci[o + 3] = T.cell / T.ah;
      ii[o] = it.yaw; ii[o + 1] = s.views; ii[o + 2] = s.views === 1 ? it.flip : 0; ii[o + 3] = 0;
    }
    bill.instanceMatrix.needsUpdate = true; if (bill.instanceColor) bill.instanceColor.needsUpdate = true; aCell.needsUpdate = true; aInfo.needsUpdate = true;
    bill.visible = bakeDone && N > 0;
  }

  // ------------------------------------------------------------------------------------------------------------------------- level of detail (5 Hz): billboard / real model / hidden
  const _tmpC = new THREE.Color();
  function lod() {
    const head = ctx.player.head, fw = ctx.player.forward;
    const hx = head.x, hz = head.z;
    let fx = fw ? fw.x : 0, fz = fw ? fw.z : -1; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    let nc = 0;
    for (let i = 0; i < N; i++) {
      const dx = X[i] - hx, dz = Z[i] - hz, d = Math.sqrt(dx * dx + dz * dz);
      let st = 1;
      if (d > MAXD[i]) st = 0;
      else if (d < FULLD[i] && SP[SPI[i]].full && ((dx * fx + dz * fz) > -0.35 * d || d < 22)) {
        let key = d / (1 + SZ[i] * 0.35) * BIAS[i];
        if (STAT[i] === 2) key *= 0.82;
        candIdx[nc] = i; candKey[nc] = key; nc++;
      }
      NEWS[i] = st;
    }
    // pick the B most deserving candidates (small sorted insertion)
    let ns = 0; const B = Math.min(budgetNow, MAXSEL);
    for (let c = 0; c < nc; c++) {
      const key = candKey[c];
      if (ns === B && key >= selKey[ns - 1]) continue;
      let p = ns < B ? ns : B - 1;
      while (p > 0 && selKey[p - 1] > key) { selKey[p] = selKey[p - 1]; selIdx[p] = selIdx[p - 1]; p--; }
      selKey[p] = key; selIdx[p] = candIdx[c]; if (ns < B) ns++;
    }
    for (const s of SP) s.cnt = 0;
    for (let j = 0; j < ns; j++) {
      const i = selIdx[j], s = SP[SPI[i]];
      if (!s.full || s.cnt >= T.slots) continue;
      NEWS[i] = 2;
      const it = IT[i];
      _P.set(it.x, it.y, it.z); _Q.setFromEuler(_E.set(0, it.yaw, 0)); _S.setScalar(it.size);
      _M.compose(_P, _Q, _S);
      const tc = CLS[s.cls].tc;
      _tmpC.setRGB(it.tint * tc[0], it.tint * 0.98 * tc[1], it.tint * (0.94 + 0.08 * it.rank) * tc[2]);
      for (let k = 0; k < s.parts.length; k++) {
        const im = s.parts[k].im;
        im.setMatrixAt(s.cnt, _tmpM.multiplyMatrices(_M, s.parts[k].base));
        im.setColorAt(s.cnt, _tmpC);
      }
      s.cnt++;
    }
    let nf = 0, nb = 0, nh = 0, changed = false;
    for (let i = 0; i < N; i++) {
      const st = NEWS[i];
      if (st !== STAT[i]) { aInfo.array[i * 4 + 3] = st === 1 ? 0 : 1; STAT[i] = st; changed = true; }
      if (st === 2) nf++; else if (st === 1) nb++; else nh++;
    }
    if (changed && aInfo) aInfo.needsUpdate = true;
    for (const s of SP) {
      if (!s.parts) continue;
      for (const p of s.parts) {
        const im = p.im; im.count = s.cnt; im.visible = s.cnt > 0;
        if (s.cnt > 0) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
      }
    }
    lodCount.full = nf; lodCount.bill = nb; lodCount.hidden = nh;
  }
  const _tmpM = new THREE.Matrix4();

  // ------------------------------------------------------------------------------------------------------------------------- streaming of cells around the player
  function stream(maxNew) { // returns how many cells it made (the caller keeps calling while it is > 0)
    const hx = ctx.player.head.x, hz = ctx.player.head.z, pci = Math.floor(hx / CS), pcj = Math.floor(hz / CS), R = Math.ceil(KEEP_R / CS) + 1;
    let made = 0, removed = false, added = false;
    // nearest first
    const want = [];
    for (let j = pcj - R; j <= pcj + R; j++) for (let i = pci - R; i <= pci + R; i++) {
      const d = Math.hypot((i + 0.5) * CS - hx, (j + 0.5) * CS - hz);
      if (d < GEN_R && !cells.has(cellKey(i, j))) want.push([d, i, j]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of want) { if (made >= maxNew) break; cells.set(cellKey(i, j), { ci: i, cj: j, items: genCell(i, j) }); made++; added = true; }
    for (const [k, c] of cells) if (Math.hypot((c.ci + 0.5) * CS - hx, (c.cj + 0.5) * CS - hz) > KEEP_R) { cells.delete(k); removed = true; }
    if (added || removed) dirty = true;
    anchorCi = pci; anchorCj = pcj;
    return made;
  }
  function reseatAll() { for (const c of cells.values()) for (const it of c.items) reseatItem(it); dirty = true; }

  // ------------------------------------------------------------------------------------------------------------------------- full-model meshes (lib/gen.js InstancedMesh, driven by lod())
  function createFulls() {
    const ps = [];
    for (const s of SP) {
      if (!s.ok) continue;
      const list = []; for (let k = 0; k < T.slots; k++) list.push({ x: 0, y: 0, z: 0, size: 1, sink: 0 });
      const f = gen.scatter(ctx, s.id, list, { parent: fullRoot, castShadow: false });
      ps.push(f.ready.then(() => {
        if (f.error || disposed) { s.full = null; return; }
        const parts = [];
        for (const im of f.object.children) {
          const base = new THREE.Matrix4(); im.getMatrixAt(0, base);
          im.count = 0; im.visible = false; im.frustumCulled = true; im.castShadow = false; im.receiveShadow = false;
          im.userData.noShadow = true; im.userData.noOutline = true;
          im.setColorAt(0, _C.set(0xffffff));
          parts.push({ im, base });
        }
        if (parts.length) { s.parts = parts; s.full = f; }
      }));
    }
    return Promise.all(ps);
  }

  // ------------------------------------------------------------------------------------------------------------------------- impostor atlas: bake every species once
  const bake = { queue: [], i: 0, rt: null, scene: null, cam: null, tmp: null, atlas: null, groups: [] };
  function allocateAtlas() {
    const cols = Math.floor(T.aw / T.cell), rows = Math.floor(T.ah / T.cell);
    const order = SP.filter((s) => s.ok).sort((a, b) => b.views - a.views);
    let col = 0, row = 0;
    for (const s of order) {
      if (col + s.views > cols) { col = 0; row++; }
      if (row >= rows) { s.ok = false; continue; }
      s.col = col; s.row = row; col += s.views;
      for (let v = 0; v < s.views; v++) bake.queue.push([s.i, v]);
    }
    atlasInfo = `${T.aw}x${T.ah} cell ${T.cell}, ${bake.queue.length} cells`;
  }
  async function setupBake() {
    const hs = [];
    bake.scene = new THREE.Scene();
    for (const s of SP) {
      if (!s.ok) continue;
      const h = gen.spawn(ctx, s.id, { x: 0, z: 0, y: 0, sink: 0, size: 1, parent: bake.scene, castShadow: false });
      h.object.visible = false; s.h = h; hs.push(h.ready);
    }
    await Promise.all(hs);
    // albedo bake: no scene lights and no style patches; a little form shading is painted in, the scene's own lights do the rest at run time
    const bm = new Map();
    const bakeMat = (m) => {
      let b = bm.get(m);
      if (!b) {
        b = new THREE.ShaderMaterial({ uniforms: { map: { value: m.map || null }, col: { value: m.color ? m.color.clone() : new THREE.Color(1, 1, 1) } },
          vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform sampler2D map; uniform vec3 col; varying vec2 vUv; varying vec3 vN; void main(){ vec3 n = normalize(vN); float nl = max(dot(n, normalize(vec3(-0.45, 0.8, 0.9))), 0.0); float shade = 0.62 + 0.42 * nl + 0.16 * (n.y * 0.5 + 0.5); vec3 c = texture2D(map, vUv).rgb * col; gl_FragColor = vec4(c * shade, 1.0); }' });
        bm.set(m, b);
      }
      return b;
    };
    bake.mats = bm;
    for (const s of SP) if (s.h) s.h.object.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material)) o.material = bakeMat(o.material); });
    bake.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50); bake.cam.position.set(0, 0, 20);
    bake.rt = new THREE.WebGLRenderTarget(T.cell, T.cell, { samples: 4, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
    bake.tmp = new Uint8Array(T.cell * T.cell * 4);
    bake.atlas = new Uint8Array(T.aw * T.ah * 4);
    // clear colour of the atlas: a dark leaf-brown at alpha 0, so mip filtering never bleeds white into the silhouettes
    for (let i = 0; i < bake.atlas.length; i += 4) { bake.atlas[i] = 40; bake.atlas[i + 1] = 48; bake.atlas[i + 2] = 30; bake.atlas[i + 3] = 0; }
  }
  const _box = new THREE.Box3();
  function measure(s) {
    const g = s.h.object; let hw = 0, top = 0;
    g.visible = true;
    for (let v = 0; v < s.views; v++) {
      g.rotation.y = (v / s.views) * TAU; g.updateMatrixWorld(true); _box.setFromObject(g, true);
      hw = Math.max(hw, Math.abs(_box.min.x), Math.abs(_box.max.x)); top = Math.max(top, _box.max.y);
    }
    g.visible = false;
    s.side = Math.max(hw * 2, top) * 1.05;
    if (!(s.side > 0.05)) s.side = 1;
  }
  function bakeStep(count, budgetMs) { // renders up to `count` atlas cells, but stops after ~budgetMs (always at least one)
    const R = ctx.renderer, t0 = performance.now();
    const prevRT = R.getRenderTarget(), prevXR = R.xr.enabled, prevA = R.getClearAlpha(), prevAuto = R.autoClear; R.getClearColor(_tmpC);
    const prevCol = _tmpC.clone();
    R.xr.enabled = false; R.autoClear = false;
    try {
      while (count-- > 0 && bake.i < bake.queue.length) {
        const [si, v] = bake.queue[bake.i], s = SP[si];
        if (v === 0 && !s.measured) { measure(s); s.measured = true; }
        const g = s.h.object; g.visible = true; g.rotation.y = (v / s.views) * TAU; g.updateMatrixWorld(true);
        const cam = bake.cam; cam.left = -s.side / 2; cam.right = s.side / 2; cam.bottom = 0; cam.top = s.side; cam.updateProjectionMatrix();
        R.setRenderTarget(bake.rt); R.setClearColor(0x28301e, 0); R.clear(true, true, false);
        R.render(bake.scene, cam);
        R.readRenderTargetPixels(bake.rt, 0, 0, T.cell, T.cell, bake.tmp);
        g.visible = false;
        const ox = (s.col + v) * T.cell, oy = s.row * T.cell;
        for (let y = 0; y < T.cell; y++) bake.atlas.set(bake.tmp.subarray(y * T.cell * 4, (y + 1) * T.cell * 4), ((oy + y) * T.aw + ox) * 4);
        bake.i++;
        if (performance.now() - t0 > budgetMs) break;
      }
    } finally {
      R.setRenderTarget(prevRT); R.xr.enabled = prevXR; R.setClearColor(prevCol, prevA); R.autoClear = prevAuto;
    }
    if (bake.i >= bake.queue.length) finishBake();
  }
  function atlasSig() { return T.aw + 'x' + T.ah + '/' + T.cell + '/' + SP.filter((s) => s.ok).map((s) => s.id + ':' + s.views + ':' + s.col + ',' + s.row).join('|'); }
  function makeAtlas(data) {
    atlasTex = new THREE.DataTexture(data, T.aw, T.ah, THREE.RGBAFormat, THREE.UnsignedByteType);
    atlasTex.generateMipmaps = true; atlasTex.minFilter = THREE.LinearMipmapLinearFilter; atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping; atlasTex.anisotropy = 2; atlasTex.needsUpdate = true;
    billMat.map = atlasTex; billMat.needsUpdate = true;
    bakeDone = true; phase = 'ready'; dirty = true;
  }
  function finishBake() {
    const data = bake.atlas;
    makeAtlas(data);
    if (ctx.state) ctx.state.meadowAtlas = { sig: atlasSig(), data, sides: SP.map((s) => s.side) }; // a hot reload of this file reuses the baked atlas instead of baking again
    try { bake.rt.dispose(); } catch { /* ignore */ }
    if (bake.mats) for (const b of bake.mats.values()) { try { b.dispose(); } catch { /* ignore */ } }
    for (const s of SP) if (s.h) { s.h.remove(); s.h = null; }
    bake.scene = null; bake.atlas = null; bake.tmp = null; bake.rt = null; bake.mats = null;
  }

  ctx.onDispose(() => { // a reload in the middle of the bake must not leak the render target or the temporary materials
    try { if (bake.rt) bake.rt.dispose(); } catch { /* ignore */ }
    if (bake.mats) for (const b of bake.mats.values()) { try { b.dispose(); } catch { /* ignore */ } }
    try { if (atlasTex) atlasTex.dispose(); } catch { /* ignore */ }
  });

  // ------------------------------------------------------------------------------------------------------------------------- visibility, stones, events
  const input = ctx.input;
  let lastQD = 1;
  function wantShown() { return visibleWanted && !away && !(input && input.passthrough) && phase !== 'inert'; }
  function applyVisible() {
    const v = wantShown();
    root.visible = v;
    const env = world && world.env;
    if (env && env.setStones && phase !== 'inert' && phase !== 'load') {
      if (v && !stoneHidden.v) { env.setStones(false); stoneHidden.v = true; }
      else if (!v && stoneHidden.v && !away) { env.setStones(true); stoneHidden.v = false; }
      else if (!v && away) stoneHidden.v = false; // travel owns the stones in other places; it re-asserts them when we come home
    }
    if (v) { reseatAll(); }
  }
  for (const n of ['travel:start', 'travel:arrive', 'blast:arrive']) ctx.on(n, () => { away = true; applyVisible(); });
  for (const n of ['travel:home', 'blast:home']) ctx.on(n, () => { away = false; stoneHidden.v = false; applyVisible(); });
  ctx.on('xr:start', applyVisible); ctx.on('xr:end', applyVisible);
  ctx.on('world:terrain-changed', () => { terrainDirtyAt = clock; });
  ctx.onDispose(() => { const env = world && world.env; if (stoneHidden.v && env && env.setStones) { try { env.setStones(true); } catch { /* ignore */ } } });

  // ------------------------------------------------------------------------------------------------------------------------- init
  createBillboards();
  buildAuthored();
  (async () => {
    try {
      await gen.preload(ctx, SP.filter((s) => !s.skip).map((s) => s.id));
      if (disposed) return;
      for (const s of SP) s.ok = !s.skip && !!gen.box(s.id);
      missing = SP.filter((s) => !s.ok && !s.skip).map((s) => s.id);
      if (missing.length) console.warn('[meadow] missing models, skipped:', missing.join(' '));
      if (SP.filter((s) => s.ok).length < 6) { phase = 'inert'; console.warn('[meadow] too few models; module is inert'); applyVisible(); return; }
      await createFulls();
      if (disposed) return;
      allocateAtlas();
      const cached = ctx.state && ctx.state.meadowAtlas;
      if (cached && cached.sig === atlasSig() && cached.data && cached.data.length === T.aw * T.ah * 4) {
        for (const s of SP) if (s.ok) s.side = cached.sides[s.i] || 1;
        makeAtlas(cached.data); // phase = 'ready'
      } else {
        await setupBake();
        if (disposed) return;
        phase = 'bake';
      }
      { const i0 = performance.now(); stream(12); compile(); tm.init = performance.now() - i0; }
      applyVisible();
    } catch (e) { phase = 'inert'; console.warn('[meadow] init failed, module is inert:', e && e.message ? e.message : e); applyVisible(); }
  })();

  // ------------------------------------------------------------------------------------------------------------------------- API
  const api = {
    setDensity(d) { density = Math.max(0, Math.min(1, +d)); if (!Number.isFinite(density)) density = 1; dirty = true; return api; },
    get density() { return density; },
    hide() { visibleWanted = false; applyVisible(); return api; },
    show() { visibleWanted = true; applyVisible(); return api; },
    get visible() { return root.visible; },
    clearArea(x, z, r) { const c = { x: +x, z: +z, r: Math.max(0, +r) }; clears.push(c); dirty = true; return { remove() { const i = clears.indexOf(c); if (i >= 0) { clears.splice(i, 1); dirty = true; } } }; },
    reseat() { reseatAll(); return api; },
    debug: { // test hooks: setBudget(n) real models at once (0 = all billboards), setFullMul(m) scales the model distances, atlasPNG() -> data URL of the baked atlas
      heightError() { let max = 0, bad = 0; for (let i = 0; i < N; i++) { const it = IT[i], e = Math.abs(it.y - (seat(it.x, it.z, it.size, SP[it.sp].cls) - it.sinkAmt)); if (e > max) max = e; if (e > 0.05) bad++; } return { max: +max.toFixed(3), bad, of: N }; },
      find(key) { const out = []; for (let i = 0; i < N; i++) if (SP[SPI[i]].key === key) out.push({ x: +X[i].toFixed(1), z: +Z[i].toFixed(1), y: +IT[i].y.toFixed(1), size: +SZ[i].toFixed(1), st: STAT[i] }); return out; },
      setBudget(n) { budgetNow = Math.max(0, Math.min(MAXSEL, n | 0)); dirty = true; return api; }, setFullMul(m) { fullMulNow = +m; dirty = true; return api; },
      atlasPNG() { if (!atlasTex) return null; const cv = document.createElement('canvas'); cv.width = T.aw; cv.height = T.ah; const g = cv.getContext('2d'), id = g.createImageData(T.aw, T.ah), src = atlasTex.image.data; for (let y = 0; y < T.ah; y++) id.data.set(src.subarray((T.ah - 1 - y) * T.aw * 4, (T.ah - y) * T.aw * 4), y * T.aw * 4); g.putImageData(id, 0, 0); return cv.toDataURL('image/png'); },
    },
    stats() { return { phase, items: N, full: lodCount.full, billboards: lodCount.bill, hidden: lodCount.hidden, species: SP.filter((s) => s.ok).length, missing: missing.slice(), cells: cells.size, atlas: atlasInfo, visible: root.visible, density, ms: +ms.toFixed(3), timing: Object.fromEntries(Object.entries(tm).map(([k, v]) => [k, +v.toFixed(2)])) }; },
  };
  ctx.provide('meadow', api);

  // ------------------------------------------------------------------------------------------------------------------------- per frame
  return {
    update(dt) {
      if (disposed || phase === 'load' || phase === 'inert') return;
      const t0 = performance.now();
      clock += dt;
      if (phase === 'bake' && bake.scene) { const b0 = performance.now(); bakeStep(12, 5); tm.bake = Math.max(tm.bake, performance.now() - b0); }
      if (!root.visible) { ms = performance.now() - t0; return; }
      const head = ctx.player.head;
      if (needStream || Math.floor(head.x / CS) !== anchorCi || Math.floor(head.z / CS) !== anchorCj) { const s0 = performance.now(); needStream = stream(3) > 0; const d = performance.now() - s0; tm.stream = d; if (d > tm.streamMax) tm.streamMax = d; }
      if (terrainDirtyAt >= 0 && clock - terrainDirtyAt > 0.4) { terrainDirtyAt = -1; reseatAll(); }
      if (dirty) { const c0 = performance.now(); compile(); const d = performance.now() - c0; tm.compile = d; if (d > tm.compileMax) tm.compileMax = d; }
      tLod -= dt;
      if (tLod <= 0) { tLod = 0.2; const l0 = performance.now(); lod(); const d = performance.now() - l0; tm.lod = d; if (d > tm.lodMax) tm.lodMax = d; }
      { const qd = qualityDensity(); if (qd !== lastQD) { lastQD = qd; dirty = true; } }
      tStone -= dt;
      if (tStone <= 0) { tStone = 2; if (stoneHidden.v && world.env && world.env.setStones) world.env.setStones(false); }
      ms = ms * 0.9 + (performance.now() - t0) * 0.1;
    },
    dispose() { disposed = true; },
  };
}
