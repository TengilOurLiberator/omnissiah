// core/startzone.js - world.startzone: the starting area, built ONLY from the generated sz-* models (lib/gen.js). Load AFTER core/library.js, BEFORE core/intro.js.
//
// PLACE (spawn (0,0) facing -Z; the campfire creation at (0,-6) is left alone: 2.4 m clear; the sphere hangs ahead/up; the lake is ~55 m north-west)
//   shrine behind the spawn (altar, pilgrim statue, offering pedestal, braziers)    camp round the fire (tent, bedroll, benches, pot, crates, barrels, woodpile, cart, lantern posts)
//   practice yard left of path A: weapon rack with real grabbable world.weapons, 2 straw dummies + an archery target (kit.damageable: burst, respawn), spell lectern (walk up = starter spell)
//   notice board with the controls for the CURRENT input mode (text plane on the board)    path A (worn dirt ribbon) to jetty + boat + fishing rack + reeds, path B to a rune stone ring on a low
//   mound with a gate arch and a brass wreck ("something fell here"); landmarks (well, bridge, walls, gates, stairs, banner, totem); trees/rocks/bushes/flowers. No enemies, nothing in the lake but jetty + boat.
// DATA: LAYOUT below = one table of {id, x, z, yaw, size, group, ...}; yaw = radians | [x,z] (+Z faces that point) | {x:[x,z]} | 'spawn' | 'fire' | {span|gate|lamp|bell|stairs: ...}.
//
// API  world.startzone = {
//   anchors: { shrine, rack, lectern, dummies, waystone, lakeside, campfire }   live Vector3 STAND points on the ground    focus: same keys, live Vector3 to LOOK at ('waystone' = the controls board)
//   dummyList: [{ position, alive, hits }]   rack: [{ type, weapon }]   mode: 'desktop' | 'controllers' | 'hands'   active (false while travelling / in mixed reality)
//   controlsText(mode?) -> string (the board text)    nearest(point) -> anchor name | null (within 3 m)    stats() -> counters for tests
// }
// Events: 'startzone:enter' { name } (once per visit at shrine|rack|lectern|dummies|waystone|lakeside)  'startzone:dummy-hit' { index, hits }  'startzone:dummy-down' { index }  'startzone:weapon' { type }
// Listens: travel:start/arrive + blast:arrive (hide, colliders and damageables removed), travel:home + blast:home (show), xr:start/end + input.passthrough (hidden in mixed reality). Static Rapier colliders only for things you bump into (jetty deck and bridge are walkable).
// NOTE world.env.addGrassHole({x,z,w,d,yaw}) -> { remove() } is used when it exists to clear grass under paths, spawn clearing and mound (the world has no such call yet: paths then lie in the grass).
// Budget (measured from the spawn view, Quest tier, this module alone): forward +32k triangles / +27 draws, left +30k / +25, back +24k / +16, right +19k / +17. Every non-hero prop is a placement with a look chosen by distance from the head (4 Hz):
//   near = real model (Quest twin / PC original), then PC: the twin merged into one mesh per 36-degree sector (one 2048 px atlas), Quest: a billboard baked once at load (ONE instanced draw); nothing beyond ~46 m (core/meadow.js takes over).
//   Heroes (rack, board, lectern, dummies) are always real models. Models whose Quest twin is destroyed (flower patch, mushroom ring) exist on PC only. api.stats() / api.rows are test hooks; api.forceMode(m) previews a board.
import { gen } from '/game/lib/gen.js';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

export const meta = { name: 'Start Zone', description: 'Shrine, camp, practice yard, controls board, paths, jetty, rune stone ring and nature around the spawn, from the generated sz-* models.' };

// ================================================================== LAYOUT DATA (world metres; x east/right, -z ahead)
const FIRE = [0, -6];
const CROSS = [-8.6, -26.7];                               // where path A crosses the dry creek (bridge)
const C = [17.4, -27.0];                                   // centre of the rune stone ring (on a low mound)
const D2R = Math.PI / 180;
const at = (c, r, deg) => ({ x: +(c[0] + r * Math.sin(deg * D2R)).toFixed(2), z: +(c[1] - r * Math.cos(deg * D2R)).toFixed(2) }); // deg clockwise from -Z
// row: { id, x, z, yaw, size, group, col: 'box'|'cyl'|'arch'|'bridge' (static collider), k: collider scale, role (rack|board|lectern|dummy = always a real model), nr: Quest near radius, onMound, lean, trim, glow, lamp }
const LAYOUT = [
  // ---- shrine (behind and beside the spawn: you wake up between two braziers)
  { id: 'sz-shrine-altar', x: 0, z: 5.4, yaw: 'spawn', size: 2.0, group: 'shrine', col: 'box', k: 0.8 },
  { id: 'sz-pilgrim-statue', x: 0, z: 8.6, yaw: 'spawn', size: 2.2, group: 'shrine', col: 'cyl', k: 0.7 },
  { id: 'sz-offering-pedestal', x: -3.3, z: 4.4, yaw: 'spawn', size: 1.2, group: 'shrine', col: 'cyl', k: 0.8 },
  { id: 'sz-brazier', x: -3.9, z: 0.5, yaw: 0.4, size: 1.4, group: 'shrine', col: 'cyl', k: 0.7, glow: 0.62 },
  { id: 'sz-brazier', x: 3.9, z: 0.5, yaw: 2.0, size: 1.4, group: 'shrine', col: 'cyl', k: 0.7, glow: 0.62 },
  { id: 'sz-pillar-broken-b', x: -6.2, z: 6.8, yaw: 0.6, size: 1.7, group: 'shrine', col: 'cyl', k: 0.8 },
  { id: 'sz-pillar-broken-a', x: 6.4, z: 7.2, yaw: 2.3, size: 2.5, group: 'shrine', col: 'cyl', k: 0.8 },
  { id: 'sz-pillar-broken-b', x: 1.8, z: 9.8, yaw: 1.9, size: 1.5, group: 'shrine', col: 'cyl', k: 0.8 },
  { id: 'sz-banner-pole', x: -7.2, z: 1.0, yaw: 'spawn', size: 3.4, group: 'shrine' },
  { id: 'sz-chime-totem', x: 7.2, z: 1.8, yaw: 0.3, size: 2.6, group: 'shrine' },
  { id: 'sz-cairn', x: -4.8, z: 8.4, yaw: 1.0, size: 1.3, group: 'shrine' },
  // ---- camp round the fire
  { id: 'sz-campfire-logbench', x: 3.4, z: -9.6, yaw: -0.6, size: 2.2, group: 'camp' },
  { id: 'sz-campfire-logbench', x: -0.3, z: -9.9, yaw: 0.15, size: 2.2, group: 'camp' },
  { id: 'sz-tent', x: 4.8, z: -13.9, yaw: 'fire', size: 3.2, group: 'camp', col: 'box', k: 0.75, nr: 17 },
  { id: 'sz-bedroll', x: 7.6, z: -12.2, yaw: 0.5, size: 1.9, group: 'camp' },
  { id: 'sz-cooking-pot', x: 6.6, z: -9.6, yaw: 0, size: 1.4, group: 'camp', col: 'cyl', k: 0.5 },
  { id: 'sz-crate-stack', x: 9.8, z: -7.2, yaw: 0.3, size: 1.5, group: 'camp', col: 'box', k: 0.9 },
  { id: 'sz-barrel', x: 10.9, z: -8.5, yaw: 0, size: 1.0, group: 'camp', col: 'cyl', k: 0.8 },
  { id: 'sz-barrel', x: 8.8, z: -6.4, yaw: 1.0, size: 1.0, group: 'camp', col: 'cyl', k: 0.8 },
  { id: 'sz-woodpile', x: 8.4, z: -15.2, yaw: 0.2, size: 1.5, group: 'camp', col: 'box', k: 0.85 },
  { id: 'sz-supply-cart', x: 11.8, z: -13.0, yaw: 0.4, size: 2.8, group: 'camp', col: 'box', k: 0.8, nr: 15 },
  { id: 'sz-potion-table', x: 10.2, z: -10.4, yaw: 'fire', size: 1.6, group: 'camp', col: 'box', k: 0.8 },
  { id: 'sz-lantern-post', x: -4.4, z: -11.8, yaw: { lamp: [-3.2, -11.8] }, size: 2.4, group: 'camp', col: 'cyl', k: 0.4, lamp: 1 },
  { id: 'sz-lantern-post', x: 1.2, z: -11.4, yaw: { lamp: [2.9, -9.6] }, size: 2.4, group: 'camp', col: 'cyl', k: 0.4, lamp: 1 },
  // ---- practice yard (left of path A): rack, 2 straw dummies + an archery target; the lectern stands right of the fork
  { id: 'sz-weapon-rack', x: -7.0, z: -6.4, yaw: 'spawn', size: 2.0, group: 'yard', role: 'rack', col: 'box', k: 0.8 },
  { id: 'sz-straw-dummy', x: -5.5, z: -9.0, yaw: 'spawn', size: 2.3, group: 'yard', role: 'dummy', off: 1.1, rad: 0.75 },
  { id: 'sz-straw-dummy', x: -7.9, z: -11.2, yaw: 'spawn', size: 2.3, group: 'yard', role: 'dummy', off: 1.1, rad: 0.75 },
  { id: 'sz-archery-target', x: -10.6, z: -13.6, yaw: 'spawn', size: 2.4, group: 'yard', role: 'dummy', off: 1.1, rad: 0.8 },
  { id: 'sz-armour-stand', x: -10.6, z: -8.2, yaw: 'spawn', size: 1.9, group: 'yard' },
  { id: 'sz-spell-lectern', x: -3.1, z: -4.6, yaw: 'spawn', size: 1.5, group: 'yard', role: 'lectern', col: 'cyl', k: 0.6 },
  // ---- controls notice board (text plane mounted on the parchment)
  { id: 'sz-notice-board', x: 3.9, z: -4.9, yaw: 'spawn', size: 3.0, group: 'yard', role: 'board', col: 'box', k: 0.9 },
  // ---- landmarks at mid distance
  { id: 'sz-stone-well', x: -9.8, z: -23.0, yaw: 0.6, size: 1.8, group: 'land', col: 'cyl', k: 0.8 },
  { id: 'sz-signpost', x: -5.6, z: -20.4, yaw: 0.9, size: 2.2, group: 'land' },
  { id: 'sz-gate-posts', x: -4.1, z: -17.6, yaw: 0.12, size: 2.6, group: 'land' },
  { id: 'sz-drystone-wall', x: -6.7, z: -17.8, yaw: 0.2, size: 3.0, group: 'land', col: 'box', k: 0.85 },
  { id: 'sz-drystone-wall', x: -10.4, z: -16.2, yaw: -0.32, size: 2.7, group: 'land', col: 'box', k: 0.85 },
  { id: 'sz-banner-pole', x: -14.5, z: -20.0, yaw: 'spawn', size: 3.5, group: 'land' },
  { id: 'sz-chime-totem', x: -9.5, z: -30.0, yaw: 0.5, size: 2.6, group: 'land' },
  { id: 'sz-gate-posts', x: 9.0, z: -3.6, yaw: { gate: [1, -0.35] }, size: 2.6, group: 'land' },
  { id: 'sz-bridge', x: CROSS[0], z: CROSS[1], yaw: { span: [-0.47, -0.88] }, size: 5.0, group: 'land', col: 'bridge' },
  // ---- rune stone ring on a low mound (path B), gate arch to the south
  { id: 'sz-ruined-archway', ...at(C, 8.6, 180), yaw: { span: [0, -1] }, size: 4.2, group: 'ring', col: 'arch', onMound: true },
  { id: 'sz-runestone-tall', ...at(C, 4.8, 0), yaw: C, size: 3.2, group: 'ring', col: 'cyl', k: 0.6, onMound: true },
  { id: 'sz-runestone-leaning', ...at(C, 4.8, 48), yaw: { x: C }, size: 2.8, group: 'ring', col: 'cyl', k: 0.6, onMound: true, lean: 0.12 },
  { id: 'sz-pillar-broken-a', ...at(C, 4.8, 96), yaw: 2.0, size: 2.6, group: 'ring', col: 'cyl', k: 0.8, onMound: true },
  { id: 'sz-runestone-tall', ...at(C, 4.8, 142), yaw: C, size: 3.0, group: 'ring', col: 'cyl', k: 0.6, onMound: true },
  { id: 'sz-pillar-broken-b', ...at(C, 4.8, 215), yaw: 0.7, size: 1.6, group: 'ring', col: 'cyl', k: 0.8, onMound: true },
  { id: 'sz-runestone-leaning', ...at(C, 4.8, 262), yaw: { x: C }, size: 2.8, group: 'ring', col: 'cyl', k: 0.6, onMound: true, lean: -0.1 },
  { id: 'sz-runestone-tall', ...at(C, 4.8, 310), yaw: C, size: 3.4, group: 'ring', col: 'cyl', k: 0.6, onMound: true },
  { id: 'sz-brass-obelisk', x: C[0] + 0.3, z: C[1] + 0.2, yaw: 0.3, size: 3.4, group: 'ring', col: 'cyl', k: 0.7, onMound: true },
  { id: 'sz-astrolabe', ...at(C, 2.2, 125), yaw: 'spawn', size: 1.5, group: 'ring', col: 'cyl', k: 0.6, onMound: true },
  { id: 'sz-orrery', ...at(C, 2.4, 235), yaw: 0.8, size: 1.9, group: 'ring', col: 'cyl', k: 0.6, onMound: true },
  // the story: something fell here (wreck east of the ring, the automaton walked in through the gate and sat down)
  { id: 'sz-pipe-wreck', ...at(C, 10.0, 80), yaw: 0.9, size: 2.8, group: 'ring', col: 'cyl', k: 0.7 },
  { id: 'sz-gear-buried', ...at(C, 8.0, 38), yaw: 0.5, size: 3.4, group: 'ring', col: 'cyl', k: 0.5 },
  { id: 'sz-automaton-broken', ...at(C, 6.6, 188), yaw: [C[0] + 4, C[1] + 6], size: 2.0, group: 'ring', col: 'cyl', k: 0.5, onMound: true },
  { id: 'sz-bell-frame', ...at(C, 9.2, 290), yaw: { bell: C }, size: 2.8, group: 'ring', col: 'box', k: 0.6 },
  { id: 'sz-tree-dead', ...at(C, 12.5, 62), yaw: 0.4, size: 5.4, group: 'ring' },
  { id: 'sz-cairn', ...at(C, 7.5, 160), yaw: 2.1, size: 1.3, group: 'ring' },
  { id: 'sz-stairs', ...at(C, 8.2, 330), yaw: { stairs: C }, size: 2.0, group: 'ring', trim: 0.82 },
];
// path polylines (Catmull-Rom control points). A: spawn -> past the fire -> the jetty (end added from the shore). B: spawn -> past the camp -> gate arch of the ring.
const PATH_A = [[0, 1.6], [-0.3, -1.4], [-1.2, -3.9], [-2.6, -6.6], [-2.9, -10.8], [-3.8, -16.0], [-6.6, -23.0], [-10.6, -30.4], [-14.6, -37.6], [-19.0, -44.6]];
const PATH_B = [[0.4, 1.6], [2.4, -0.6], [6.4, -1.8], [11.0, -3.6], [14.6, -7.4], [16.4, -12.8], [17.0, -18.4], [17.4, -23.4]];
const PATH_W = 2.5;
const CREEK = [[8, -33], [1, -31.2], [-4.5, -28.8], [-8.6, -26.7], [-13.5, -24.6], [-20, -24], [-26, -27.5], [-30, -33]]; // dry creek bed (ground ribbon), width CREEK_W
const CREEK_W = 3.0;
// tree clumps: [cx, cz, r, {species: n}]
const CLUMPS = [      // [cx, cz, r, PC mix, Quest mix]
  [-14, -33, 6, { oak: 2, pine: 3 }, { oak: 1, pine: 2 }], [13, -35, 6, { oak: 1, pine: 3, birch: 1 }, { pine: 2, oak: 1 }], [-27, -19, 6, { pine: 3, birch: 2 }, { pine: 1, birch: 1 }], [28, -9, 6, { oak: 2, birch: 2 }, { oak: 1 }],
  [-21, 2, 7, { oak: 2, pine: 2, dead: 1 }, { oak: 1, dead: 1 }], [22, 8, 6, { pine: 3, oak: 1, birch: 1 }, { pine: 1 }], [0, 22, 9, { oak: 3, pine: 3, birch: 2 }, { oak: 1, pine: 1 }], [-9, 15, 5, { oak: 1, birch: 2 }, { birch: 1 }],
  [11, 17, 5, { pine: 2, birch: 1 }, { pine: 1 }], [19, -14, 4, { oak: 1, birch: 2 }, { oak: 1 }], [-17, -9, 4, { birch: 3, dead: 1 }, { birch: 1 }], [-7, -42, 5, { pine: 2, oak: 1 }, { pine: 1 }], [8, -44, 5, { pine: 2, birch: 1 }, { pine: 1 }],
];
const TREE = { oak: ['sz-tree-oak', 7.0], pine: ['sz-tree-pine', 8.0], birch: ['sz-tree-birch', 6.0], dead: ['sz-tree-dead', 5.0] };
// zone scatters: [id, cx, cz, r, n (PC), nQuest, [sizeLo, sizeHi]]  (positions random inside the circle, never on paths / props / the clear circles)
const ZONES = [
  ['sz-bush', -11, -10, 4, 4, 1, [1.3, 1.9]], ['sz-bush', 14, -18, 4, 3, 1, [1.3, 1.9]], ['sz-bush', -23, -10, 5, 4, 1, [1.3, 1.9]], ['sz-bush', 8, 14, 6, 4, 1, [1.3, 1.9]], ['sz-bush', -10, 10, 5, 3, 0, [1.3, 1.9]],
  ['sz-bush', 24, -24, 5, 4, 1, [1.3, 1.9]], ['sz-bush', 10, -24, 4, 3, 0, [1.3, 1.9]],
  ['sz-berry-bush', 13, -9, 3, 2, 1, [1.1, 1.4]], ['sz-berry-bush', -14, -4, 3, 2, 0, [1.1, 1.4]], ['sz-berry-bush', 3, 12, 4, 2, 1, [1.1, 1.4]],
  ['sz-boulder-a', -12, -12, 3, 2, 1, [1.6, 2.4]], ['sz-boulder-a', 23, -18, 4, 2, 1, [1.6, 2.4]], ['sz-boulder-a', 4, 15, 5, 2, 1, [1.6, 2.4]], ['sz-boulder-a', -26, -12, 5, 2, 0, [1.8, 2.6]],
  ['sz-boulder-c', 12, -19, 3, 2, 1, [0.9, 1.4]], ['sz-boulder-c', -13, -27, 4, 2, 1, [0.9, 1.4]], ['sz-boulder-c', 28, -28, 4, 2, 0, [0.9, 1.4]], ['sz-boulder-c', -6, 8, 4, 2, 0, [0.9, 1.4]],
  ['sz-stump', -6, 12, 4, 2, 1, [0.8, 1.1]], ['sz-stump', 14, -22, 4, 2, 0, [0.8, 1.1]], ['sz-stump', -11, -3, 3, 1, 0, [0.8, 1.1]],
  ['sz-fallen-log', -12.5, -2.5, 2, 1, 1, [1.6, 2.0]], ['sz-fallen-log', 24, -3, 4, 1, 0, [1.6, 2.0]], ['sz-fallen-log', -16, -24, 4, 1, 0, [1.6, 2.0]],
  ['sz-mushroom-ring', -12, 3, 2.2, 6, 0, [0.5, 0.7]], ['sz-mushroom-ring', 9, 13, 2.2, 6, 0, [0.5, 0.7]], ['sz-mushroom-ring', -3, -27, 2.2, 6, 0, [0.5, 0.7]],
  ['sz-flower-patch', 2, 8, 5, 3, 1, [1.0, 1.4]], ['sz-flower-patch', -8, -3, 3, 2, 1, [1.0, 1.4]], ['sz-flower-patch', 8, -17, 4, 2, 0, [1.0, 1.4]], ['sz-flower-patch', 14, -3, 3, 2, 1, [1.0, 1.4]],
  ['sz-flower-patch', -12, -20, 4, 3, 1, [1.0, 1.4]], ['sz-flower-patch', 22, -21, 4, 2, 0, [1.0, 1.4]],
  ['sz-grass-tuft', 6, 10, 6, 5, 1, [0.9, 1.4]], ['sz-grass-tuft', -12, -8, 6, 5, 0, [0.9, 1.4]], ['sz-grass-tuft', 20, -14, 6, 5, 0, [0.9, 1.4]],
];

export default async function (ctx) {
  const THREE = ctx.THREE, world = ctx.world, kit = world.kit, root = ctx.root, input = ctx.input;
  let disposed = false;
  ctx.onDispose(() => { disposed = true; });
  const pc = !!(ctx.quality && ctx.quality.pc);
  const emit = (n, d) => { try { ctx.events.emit(n, d); } catch { /* ignore */ } };
  const G = (x, z) => { const y = ctx.groundAt(x, z); return Number.isFinite(y) ? y : 0; };
  const vec = (x, z, dy = 0) => new THREE.Vector3(x, G(x, z) + dy, z);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rng = (() => { let a = 0x5eed2; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);          // yaw that turns local +Z toward a point
  function resolveYaw(r) {
    const y = r.yaw;
    if (typeof y === 'number') return y;
    if (y === 'spawn') return faceTo(r.x, r.z, 0, 0);
    if (y === 'fire') return faceTo(r.x, r.z, FIRE[0], FIRE[1]);
    if (Array.isArray(y)) return faceTo(r.x, r.z, y[0], y[1]);
    if (y && y.x) return Math.atan2(-(y.x[1] - r.z), y.x[0] - r.x);                                     // local +X toward a point
    if (y && y.span) return Math.atan2(-y.span[1], y.span[0]);                                          // local X along a travel direction
    if (y && y.gate) return Math.atan2(y.gate[0], y.gate[1]);                                           // local +Z along a travel direction
    if (y && y.lamp) return Math.atan2(y.lamp[1] - r.z, -(y.lamp[0] - r.x));                            // lantern arm (local -X) toward a point
    if (y && y.bell) return faceTo(r.x, r.z, y.bell[0], y.bell[1]);
    if (y && y.stairs) return Math.atan2(r.x - y.stairs[0], r.z - y.stairs[1]);                         // stairs rise toward -Z: back to the centre
    return 0;
  }

  // ---------------------------------------------------------------- terrain facts: lake shore, mound
  const env = world.env;
  const wl = env && Number.isFinite(env.waterLevel) ? env.waterLevel : -1.4;
  const isWater = (x, z) => { try { return !!(env && env.isWater && env.isWater(x, z)); } catch { return false; } };
  const JX = -27.0;
  let shoreZ = null;
  for (let z = -40; z > -95; z -= 0.5) { if (isWater(JX, z)) { shoreZ = z; break; } }
  const hasLake = shoreZ != null;
  const MOUND = { x: C[0], z: C[1], rp: 5.9, rm: 11.0, h: 0.5, top: 0 };
  { let m = -9; for (let i = 0; i < 16; i++) m = Math.max(m, G(C[0] + Math.sin(i * 0.4) * 5.5, C[1] + Math.cos(i * 0.4) * 5.5)); MOUND.top = m + MOUND.h * 0.7; }
  const moundY = (x, z) => { const t = G(x, z), w = 1 - sstep(MOUND.rp, MOUND.rm, Math.hypot(x - MOUND.x, z - MOUND.z)); return t + (MOUND.top - t) * w; };

  // ---------------------------------------------------------------- shared state
  const disposables = [];                     // geometries / materials / textures made here
  const own = (o) => { disposables.push(o); return o; };
  const groups = {};
  const grp = (name) => groups[name] ??= (() => { const g = new THREE.Group(); g.name = 'sz-' + name; root.add(g); return g; })();
  const items = [];                           // { obj, x, z, d } distance culled
  const blockers = [{ x: 0, z: 0, r: 3.6 }, { x: FIRE[0], z: FIRE[1], r: 3.4 }];
  const glowPts = [];
  const lamps = [];
  const solidSpecs = []; const solids = []; let solidsOn = false;
  const byRole = {};

  // ---------------------------------------------------------------- static colliders
  function makeSolid(s) {
    const P = world.physics;
    if (P && P.body && P.ready !== false) {
      const o = new THREE.Object3D();
      o.position.set(s.x, s.y, s.z); o.rotation.y = s.yaw || 0;
      root.add(o);
      try {
        const h = P.body(ctx, o, s.shape === 'cyl' ? { shape: 'cylinder', size: [s.r, s.h], type: 'fixed', group: 'world' } : { shape: 'box', size: [s.w, s.h, s.d], type: 'fixed', group: 'world' });
        if (h) return { remove() { try { h.remove(); } catch { /* ignore */ } o.removeFromParent(); } };
      } catch { /* fall through */ }
      o.removeFromParent();
    }
    if (s.tree) return { remove() {} };
    if (kit && kit.obstacle) { try { const ob = kit.obstacle(ctx, { position: new THREE.Vector3(s.x, 0, s.z), radius: s.r || Math.max(s.w, s.d) * 0.5 }); return { remove() { try { ob.remove(); } catch { /* ignore */ } } }; } catch { /* ignore */ } }
    return { remove() {} };
  }
  function addSolid(s) { solidSpecs.push(s); if (solidsOn && solids.length < 140) solids.push(makeSolid(s)); }
  function setSolids(on) {
    if (on === solidsOn) return;
    solidsOn = on;
    if (on) { for (const s of solidSpecs) if (solids.length < 140) solids.push(makeSolid(s)); } else { for (const s of solids) s.remove(); solids.length = 0; }
  }
  function addCollider(r, b) {
    if (!b) return;
    const s = r.size, k = r.k ?? 0.8, y0 = r.onMound ? moundY(r.x, r.z) : G(r.x, r.z), yaw = r.yawR, sn = Math.sin(yaw), cs = Math.cos(yaw);
    if (r.col === 'arch') {                    // two pillars either side of the opening (local z = +-0.36 of the width); passage along local X
      for (const sg of [-1, 1]) { const lz = sg * b.z * s * 0.38; addSolid({ shape: 'box', x: r.x + lz * sn, z: r.z + lz * cs, y: y0 + b.y * s * 0.5, w: b.x * s * 0.8, h: b.y * s, d: b.z * s * 0.2, yaw }); }
    } else if (r.col === 'bridge') {           // stepped slabs along local X following the arch of the deck (tops from the model: 0.065 at the ends, 0.227 at the crown)
      const top = (u) => 0.227 - (0.227 - 0.065) * Math.pow(Math.abs(u) / 0.5, 1.7);
      for (let i = 0; i < 11; i++) { const u = -0.5 + (i + 0.5) / 11, lx = u * s, h = top(u) * s - 0.03; addSolid({ shape: 'box', x: r.x + lx * cs, z: r.z - lx * sn, y: y0 + h * 0.5, w: s / 11 + 0.05, h, d: b.z * s * 0.62, yaw }); }
    } else if (r.col === 'cyl') {
      const rad = Math.max(b.x, b.z) * s * 0.5 * k, h = b.y * s; addSolid({ shape: 'cyl', x: r.x, z: r.z, y: y0 + h * 0.5, r: rad, h, yaw });
    } else {
      const h = b.y * s * 0.9; addSolid({ shape: 'box', x: r.x, z: r.z, y: y0 + h * 0.5, w: b.x * s * k, h, d: b.z * s * k, yaw });
    }
  }
  // remove triangles above y (object space) from a spawned model: the stairs carry a detached slab that floats
  function trimAbove(h, yCut) {
    const v = new THREE.Vector3();
    for (const m of h.object.children) {
      if (!m.isMesh || !m.geometry.index) continue;
      const g = m.geometry, p = g.attributes.position, ix = g.index, out = [];
      for (let i = 0; i < ix.count; i += 3) {
        let cy = 0;
        for (let k = 0; k < 3; k++) cy += v.fromBufferAttribute(p, ix.getX(i + k)).applyMatrix4(m.matrix).y / 3;
        if (cy <= yCut) out.push(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
      }
      const g2 = own(new THREE.BufferGeometry());
      for (const key in g.attributes) g2.setAttribute(key, g.attributes[key]);
      g2.setIndex(new THREE.BufferAttribute(out.length && p.count < 65536 ? new Uint16Array(out) : new Uint32Array(out), 1));
      g2.computeBoundingSphere();
      m.geometry = g2;
    }
  }

  // ---------------------------------------------------------------- placements: every non-hero prop is a placement with three looks, chosen by distance from the head
  //   near  = the real model (gen.spawn: PC original, Quest twin)           mid (PC only) = the Quest twin merged into per-sector chunks sharing one atlas (1 draw per sector)
  //   far (Quest only) = a baked billboard (one instanced draw for the whole zone, albedo rendered once from the model at load); nothing beyond FAR_R (core/meadow.js dresses the world from ~38 m)
  const NEAR_R = pc ? 14 : 11, MID_R = 46, FAR_R = 48, NSEC = 10;
  const placements = [];
  const PC_ONLY = new Set(['sz-flower-patch', 'sz-mushroom-ring', 'sz-boulder-b']);   // their Quest twins are destroyed (genset): PC only, real model within 32 m, nothing beyond
  const sectorOf = (x, z) => ((Math.floor((Math.atan2(x, -z) + Math.PI + Math.PI / NSEC) / (Math.PI * 2 / NSEC)) % NSEC) + NSEC) % NSEC;
  function addPlacement(id, x, z, yaw, size, o = {}) {
    if (!pc && PC_ONLY.has(id)) return null;
    const p = { id, x, z, yaw, size, lean: o.lean || 0, row: o.row || null, y: o.y, sink: o.sink ?? 0.03, nr: (o.row && o.row.nr) || (/tree/.test(id) ? NEAR_R + 3 : NEAR_R), sector: sectorOf(x, z), cur: 9, inChunk: 0, bill: false, h: null };
    p.gy = (o.y != null ? o.y : G(x, z)) - p.sink;
    placements.push(p); return p;
  }
  const stats = { near: 0, mid: 0, far: 0, chunks: 0, atlas: false, tris: 0, billboards: 0 };
  const TRIM = {}; for (const r of LAYOUT) if (r.trim) TRIM[r.id] = r.trim;
  const twins = new Map();                    // id -> Promise<{ parts, box }>: geometry of the Quest twin (collider boxes; PC mid LOD)
  const glLoader = new GLTFLoader();
  function loadTwin(id) {
    let t = twins.get(id);
    if (t) return t;
    t = glLoader.loadAsync('/assets/generated/startzone/q/' + id + '.glb').then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts = [], v = new THREE.Vector3(), nm = new THREE.Matrix3(), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      gltf.scene.traverse((o) => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, n = pa.count;
        const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
        nm.getNormalMatrix(o.matrixWorld);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
          if (v.x < mn[0]) mn[0] = v.x; if (v.x > mx[0]) mx[0] = v.x; if (v.y < mn[1]) mn[1] = v.y; if (v.y > mx[1]) mx[1] = v.y; if (v.z < mn[2]) mn[2] = v.z; if (v.z > mx[2]) mx[2] = v.z;
          if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z; } else nrm[i * 3 + 1] = 1;
          if (ua) { uv[i * 2] = ua.getX(i); uv[i * 2 + 1] = ua.getY(i); }
        }
        let idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
        const cut = TRIM[id];
        if (cut != null) { const keep = []; for (let i = 0; i < idx.length; i += 3) { const cy = (pos[idx[i] * 3 + 1] + pos[idx[i + 1] * 3 + 1] + pos[idx[i + 2] * 3 + 1]) / 3; if (cy <= cut) keep.push(idx[i], idx[i + 1], idx[i + 2]); } idx = Uint32Array.from(keep); }
        const mat = o.material, img = mat && mat.map && mat.map.image ? mat.map.image : null;
        parts.push({ pos, nrm, uv, idx, img, color: mat && mat.color ? '#' + mat.color.getHexString() : '#888888' });
      });
      return { parts, box: { x: mx[0] - mn[0], y: mx[1] - mn[1], z: mx[2] - mn[2] } };
    });
    twins.set(id, t);
    return t;
  }
  const noOutline = (obj) => obj.traverse((o) => { o.userData.noOutline = true; });

  // ---- PC: merged mid chunks (one 2048 px atlas of 256 px slots, one mesh per sector)
  const AT = { A: 2048, S: 256, pad: 5, slots: new Map(), tex: null, mat: null, ready: false };
  const chunkMeshes = new Map(), dirty = new Set();
  async function buildAtlas(ids) {
    const all = await Promise.all(ids.map((id) => Promise.all([id, loadTwin(id).catch(() => null)])));
    if (disposed) return;
    const cv = document.createElement('canvas'); cv.width = cv.height = AT.A; const g = cv.getContext('2d'); g.fillStyle = '#7a7a6a'; g.fillRect(0, 0, AT.A, AT.A);
    const per = AT.A / AT.S; let n = 0;
    for (const [id, t] of all) {
      if (!t) continue;
      t.parts.forEach((p, pi) => {
        if (n >= per * per) return;
        const sx = n % per, sy = (n / per) | 0; n++;
        AT.slots.set(id + '#' + pi, { sx, sy });
        const x0 = sx * AT.S, y0 = sy * AT.S;
        if (p.img) { try { g.drawImage(p.img, x0, y0, AT.S, AT.S); g.drawImage(p.img, x0 + AT.pad, y0 + AT.pad, AT.S - AT.pad * 2, AT.S - AT.pad * 2); } catch { g.fillStyle = p.color; g.fillRect(x0, y0, AT.S, AT.S); } } else { g.fillStyle = p.color; g.fillRect(x0, y0, AT.S, AT.S); }
      });
    }
    const tex = own(new THREE.CanvasTexture(cv)); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    AT.tex = tex; AT.mat = own(new THREE.MeshLambertMaterial({ map: tex })); AT.ready = true; stats.atlas = true;
    for (let sec = 0; sec < NSEC; sec++) dirty.add(sec * 4 + 1);
  }
  const _M = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
  function rebuildChunk(key) {
    const sec = key >> 2, list = placements.filter((p) => p.inChunk === 1 && p.sector === sec);
    let nv = 0, ni = 0; const jobs = [];
    for (const p of list) {
      const t = twinsDone.get(p.id); if (!t) continue;
      t.parts.forEach((pt, pi) => { const sl = AT.slots.get(p.id + '#' + pi); if (!sl) return; jobs.push([p, pt, sl]); nv += pt.pos.length / 3; ni += pt.idx.length; });
    }
    let mesh = chunkMeshes.get(key);
    if (!jobs.length) { if (mesh) mesh.visible = false; return; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    const inner = (AT.S - AT.pad * 2) / AT.A, off = AT.pad / AT.A;
    for (const [p, pt, sl] of jobs) {
      _q.setFromEuler(_e.set(0, p.yaw, p.lean)); _M.compose(_p.set(p.x, p.gy, p.z), _q, _s.setScalar(p.size));
      const n = pt.pos.length / 3, u0 = sl.sx * AT.S / AT.A + off, v0 = sl.sy * AT.S / AT.A + off;
      for (let i = 0; i < n; i++) {
        _v.set(pt.pos[i * 3], pt.pos[i * 3 + 1], pt.pos[i * 3 + 2]).applyMatrix4(_M); const o3 = (vo + i) * 3; pos[o3] = _v.x; pos[o3 + 1] = _v.y; pos[o3 + 2] = _v.z;
        _v.set(pt.nrm[i * 3], pt.nrm[i * 3 + 1], pt.nrm[i * 3 + 2]).applyQuaternion(_q); nrm[o3] = _v.x; nrm[o3 + 1] = _v.y; nrm[o3 + 2] = _v.z;
        uv[(vo + i) * 2] = u0 + pt.uv[i * 2] * inner; uv[(vo + i) * 2 + 1] = v0 + pt.uv[i * 2 + 1] * inner;
      }
      for (let i = 0; i < pt.idx.length; i++) idx[io + i] = pt.idx[i] + vo;
      vo += n; io += pt.idx.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
    if (!mesh) {
      mesh = new THREE.Mesh(geo, AT.mat); mesh.name = 'sz-mid-' + sec; mesh.userData.noOutline = true;
      mesh.castShadow = !!(ctx.quality && ctx.quality.shadows); mesh.receiveShadow = true; grp('far').add(mesh); chunkMeshes.set(key, mesh);
    } else { mesh.geometry.dispose(); mesh.geometry = geo; }
    mesh.visible = true; mesh.userData.tris = ni / 3;
  }
  const twinsDone = new Map();                // id -> resolved twin (filled as they load)
  const ensureTwin = (id) => { if (!twinsDone.has(id)) loadTwin(id).then((t) => twinsDone.set(id, t)).catch(() => {}); };

  // ---- Quest: billboards baked once from the twins (albedo + a little form shading), drawn as camera-facing quads in ONE instanced draw
  const BB = { cell: 128, cols: 8, tex: null, mat: null, mesh: null, info: new Map(), ready: false, cap: 0, aCell: null };
  async function bakeBillboards(ids) {
    const R = ctx.renderer; stats.bakeStart = 1;
    if (!R || !R.setRenderTarget) return;
    const scene = new THREE.Scene(), hs = [];
    const list = ids.filter((id) => !/lantern|brazier/.test(id) || true);
    for (const id of list) { const h = gen.spawn(ctx, id, { x: 0, z: 0, y: 0, sink: 0, size: 1, parent: scene, castShadow: false }); h.object.visible = false; hs.push(h); }
    await Promise.all(hs.map((h) => h.ready));
    if (disposed) return;
    const bm = new Map(), bakeMat = (m) => {
      let b = bm.get(m);
      if (!b) {
        b = new THREE.ShaderMaterial({ uniforms: { map: { value: m.map || null }, col: { value: m.color ? m.color.clone() : new THREE.Color(1, 1, 1) } },
          vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform sampler2D map; uniform vec3 col; varying vec2 vUv; varying vec3 vN; void main(){ vec3 n = normalize(vN); float nl = max(dot(n, normalize(vec3(-0.45, 0.8, 0.9))), 0.0); float shade = 0.7 + 0.36 * nl + 0.12 * (n.y * 0.5 + 0.5); vec3 c = texture2D(map, vUv).rgb * col; gl_FragColor = vec4(c * shade, 1.0); }' });
        bm.set(m, b);
      }
      return b;
    };
    hs.forEach((h) => h.object.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material)) o.material = bakeMat(o.material); }));
    const cell = BB.cell, rows = Math.ceil(list.length / BB.cols), aw = BB.cols * cell, ah = rows * cell;
    const rt = new THREE.WebGLRenderTarget(cell, cell, { samples: 4, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
    const tmp = new Uint8Array(cell * cell * 4), atlas = new Uint8Array(aw * ah * 4);
    for (let i = 0; i < atlas.length; i += 4) { atlas[i] = 44; atlas[i + 1] = 52; atlas[i + 2] = 34; atlas[i + 3] = 0; }
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50); cam.position.set(0, 0, 20);
    const box = new THREE.Box3();
    let k = 0;
    const step = () => {
      if (disposed) { rt.dispose(); for (const b of bm.values()) b.dispose(); return; }
      const t0 = performance.now(), prevRT = R.getRenderTarget(), prevXR = R.xr.enabled, prevA = R.getClearAlpha(), prevAuto = R.autoClear, prevCol = R.getClearColor(new THREE.Color());
      R.xr.enabled = false; R.autoClear = false;
      try {
        while (k < list.length && performance.now() - t0 < 6) {
          const id = list[k], g = hs[k].object; g.visible = true; g.updateMatrixWorld(true); box.setFromObject(g, true);
          const side = Math.max(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * 2, box.max.y) * 1.06 || 1;
          cam.left = -side / 2; cam.right = side / 2; cam.bottom = 0; cam.top = side; cam.updateProjectionMatrix();
          R.setRenderTarget(rt); R.setClearColor(0x2c3422, 0); R.clear(true, true, false); R.render(scene, cam);
          R.readRenderTargetPixels(rt, 0, 0, cell, cell, tmp); g.visible = false;
          const col = k % BB.cols, row = (k / BB.cols) | 0;
          for (let y = 0; y < cell; y++) atlas.set(tmp.subarray(y * cell * 4, (y + 1) * cell * 4), ((row * cell + y) * aw + col * cell) * 4);
          BB.info.set(id, { u: col * cell / aw, v: row * cell / ah, du: cell / aw, dv: cell / ah, side });
          k++; stats.baked = k;
        }
      } finally { R.setRenderTarget(prevRT); R.xr.enabled = prevXR; R.setClearColor(prevCol, prevA); R.autoClear = prevAuto; }
      if (k < list.length) { setTimeout(step, 30); return; }
      const tex = own(new THREE.DataTexture(atlas, aw, ah, THREE.RGBAFormat, THREE.UnsignedByteType));
      tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 2; tex.flipY = false; tex.needsUpdate = true;
      rt.dispose(); for (const b of bm.values()) b.dispose(); hs.forEach((h) => h.remove());
      BB.tex = tex; BB.ready = true;
      makeBillboardMesh(tex); lodForce = true;
    };
    setTimeout(step, 50);
  }
  function makeBillboardMesh(tex) {
    const cap = placements.length + 8, geo = own(new THREE.PlaneGeometry(1, 1)); geo.translate(0, 0.5, 0);
    BB.aCell = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); BB.aCell.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aCell', BB.aCell);
    const mat = own(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, fog: true }));
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute vec4 aCell;\nvoid main() {\n  vec3 bbAnchor = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;\n  float bbSide = length(instanceMatrix[0].xyz);\n  vec2 bbH = (cameraPosition - bbAnchor).xz; float bbL = max(length(bbH), 0.001); vec2 bbF = bbH / bbL;\n  vec3 bbRight = vec3(bbF.y, 0.0, -bbF.x);\n')
        .replace('#include <uv_vertex>', '#ifdef USE_MAP\n vMapUv = aCell.xy + (uv * 0.94 + 0.03) * aCell.zw;\n#endif')
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize((viewMatrix * vec4(normalize(vec3(bbF.x * 0.55, 0.8, bbF.y * 0.55)), 0.0)).xyz);')
        .replace('#include <project_vertex>', 'vec3 bbPos = bbAnchor + bbRight * (position.x * bbSide) + vec3(0.0, 1.0, 0.0) * (position.y * bbSide);\n vec4 mvPosition = viewMatrix * vec4(bbPos, 1.0);\n gl_Position = projectionMatrix * mvPosition;');
    };
    mat.customProgramCacheKey = () => 'startzone-bill';
    BB.mat = mat;
    const m = new THREE.InstancedMesh(geo, mat, cap); m.name = 'sz-billboards'; m.count = 0; m.frustumCulled = false; m.userData.noShadow = true; m.userData.noOutline = true; m.userData.noBlob = true;
    BB.mesh = m; grp('far').add(m);
  }
  function rebuildBillboards() {
    const m = BB.mesh; if (!m || !BB.ready) return;
    let n = 0;
    for (const p of placements) {
      if (!p.bill) continue;
      const inf = BB.info.get(p.id); if (!inf) continue;
      _q.identity(); _M.compose(_p.set(p.x, p.gy + 0.02, p.z), _q, _s.setScalar(inf.side * p.size)); m.setMatrixAt(n, _M);
      BB.aCell.setXYZW(n, inf.u, inf.v, inf.du, inf.dv); n++;
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; BB.aCell.needsUpdate = true; stats.billboards = n;
  }

  // ---- distance logic (4 Hz; also when the head moved >0.4 m)
  function spawnNear(p) {
    const o = { x: p.x, z: p.z, yaw: p.yaw, size: p.size, parent: grp('near') };
    if (p.y != null) { o.y = p.y; o.sink = p.sink; }
    const h = gen.spawn(ctx, p.id, o);
    if (p.lean) h.object.rotation.z = p.lean;
    h.ready.then(() => { if (h.removed || disposed) return; noOutline(h.object); if (p.row && p.row.trim) trimAbove(h, p.row.trim); });
    return h;
  }
  let lodT = 0, lastHx = 1e9, lastHz = 1e9, lodForce = false, billDirty = false;
  const wantNear = [];
  function updateLod(force) {
    const hx = ctx.player.head.x, hz = ctx.player.head.z;
    if (!force && !lodForce && Math.hypot(hx - lastHx, hz - lastHz) < 0.4) return;
    lastHx = hx; lastHz = hz; lodForce = false;
    wantNear.length = 0;
    for (const p of placements) {
      const d = Math.hypot(hx - p.x, hz - p.z), c = p.cur;
      const w = PC_ONLY.has(p.id) ? (d < 32 + (c === 0 ? 2 : 0) ? 0 : 2) : d < p.nr + (c === 0 ? 1.5 : 0) ? 0 : (pc ? (d < MID_R + 2 ? 1 : 2) : (d < FAR_R + (c === 3 ? 3 : 0) ? 3 : 2));
      p.cur = w;
      if (w === 0) {
        if (!p.h) { p.d = d; wantNear.push(p); }
        else if (p.h.loaded) { if (p.inChunk) { dirty.add(p.sector * 4 + 1); p.inChunk = 0; } if (p.bill) { p.bill = false; billDirty = true; } }
      } else {
        if (p.h) { p.h.remove(); p.h = null; }
        if (pc) { const lv = w === 1 ? 1 : 0; if (p.inChunk !== lv) { if (p.inChunk) dirty.add(p.sector * 4 + 1); p.inChunk = lv; if (lv) { ensureTwin(p.id); dirty.add(p.sector * 4 + 1); } } }
        else { const b = w === 3; if (p.bill !== b) { p.bill = b; billDirty = true; } }
      }
    }
    if (wantNear.length) { wantNear.sort((a, b) => a.d - b.d); for (let i = 0; i < Math.min(wantNear.length, 8); i++) wantNear[i].h = spawnNear(wantNear[i]); if (wantNear.length > 8) lodForce = true; }
  }
  let statT = 0;
  function flushChunks(max) {
    if (billDirty && BB.ready) { billDirty = false; rebuildBillboards(); }
    if (pc && AT.ready) { let n = 0; for (const key of dirty) { dirty.delete(key); try { rebuildChunk(key); } catch (err) { console.warn('[startzone] chunk', err); } if (++n >= max) break; } }
    if (++statT < 15) return;
    statT = 0;
    let n0 = 0, n1 = 0, n2 = 0; for (const p of placements) { if (p.h && p.h.loaded) n0++; else if (p.inChunk === 1) n1++; else if (p.bill) n2++; } stats.near = n0; stats.mid = n1; stats.far = n2;
    let ct = 0, tr = 0; for (const m of chunkMeshes.values()) if (m.visible) { ct++; tr += m.userData.tris || 0; }
    stats.chunks = ct; stats.tris = tr;
  }

  // ---------------------------------------------------------------- spawn the table: heroes (rack, board, lectern, dummies) are always real models, everything else is a placement
  const dummyRows = [];
  for (const r of LAYOUT) {
    const yaw = resolveYaw(r); r.yawR = yaw;
    blockers.push({ x: r.x, z: r.z, r: Math.max(0.9, r.size * 0.42) });
    if (r.role === 'dummy') { dummyRows.push(r); continue; }
    if (r.role) {
      const h = gen.spawn(ctx, r.id, { x: r.x, z: r.z, yaw, size: r.size, parent: grp('yard') });
      h.ready.then(() => { if (!h.removed && !disposed) noOutline(h.object); });
      r.h = h; byRole[r.role] = r;
    } else {
      addPlacement(r.id, r.x, r.z, yaw, r.size, { row: r, y: r.onMound ? moundY(r.x, r.z) : undefined, sink: r.onMound ? 0.05 : 0.03, lean: r.lean });
    }
    if (r.col) loadTwin(r.id).then((t) => { twinsDone.set(r.id, t); if (!disposed) addCollider(r, t.box); }).catch(() => {});
    if (r.glow) glowPts.push({ x: r.x, y: G(r.x, r.z) + r.glow * r.size, z: r.z, s: 1.5, light: 0xff8a3a });
    if (r.lamp) { const c = Math.cos(yaw), s = Math.sin(yaw), lx = -0.17 * r.size; glowPts.push({ x: r.x + lx * c, y: G(r.x, r.z) + 0.7 * r.size, z: r.z - lx * s, s: 1.1, light: 0xffb060 }); }
  }

  // ---------------------------------------------------------------- textures
  const hash = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, m = (n) => ((n % per) + per) % per;
    const a = hash(xi, m(yi)), b = hash(xi + 1, m(yi)), c = hash(xi, m(yi + 1)), d = hash(xi + 1, m(yi + 1)), u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  function dirtTexture() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), img = g.createImageData(S, S), px = img.data;
    for (let y = 0; y < S; y++) {
      const v = y / S;
      const e = 0.8 + 0.12 * (vn(3.7, v * 16, 16) - 0.5) * 2 + 0.05 * (vn(9.1, v * 48, 48) - 0.5) * 2;
      for (let x = 0; x < S; x++) {
        const u = x / S, d = Math.abs(u - 0.5) * 2;
        const n = vn(u * 12 + 5, v * 12, 12) * 0.55 + vn(u * 32 + 1, v * 32, 32) * 0.3 + vn(u * 80, v * 80, 80) * 0.15;
        let r = 118 + 40 * n, gg = 98 + 34 * n, b = 68 + 24 * n;
        const rut = Math.exp(-Math.pow((u - 0.34) / 0.05, 2)) + Math.exp(-Math.pow((u - 0.66) / 0.05, 2));
        const k = 1 - 0.16 * rut; r *= k; gg *= k; b *= k;
        const gm = sstep(0.55, 0.98, d) * 0.55;                              // grass creeping in at the edges
        r += (84 - r) * gm; gg += (106 - gg) * gm; b += (56 - b) * gm;
        const sp = (hash(x * 7 + 1, y * 13 + 5) - 0.5) * 22;
        const a = 1 - sstep(e - 0.16, e + 0.02, d);
        const i = (y * S + x) * 4; px[i] = r + sp; px[i + 1] = gg + sp; px[i + 2] = b + sp; px[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 70; i++) { const x = (0.3 + rng() * 0.4) * S, y = rng() * S, rr = 1 + rng() * 2.2; g.fillStyle = rng() < 0.5 ? 'rgba(170,150,120,0.55)' : 'rgba(60,45,30,0.45)'; for (const oy of [-S, 0, S]) { g.beginPath(); g.ellipse(x, y + oy, rr * 1.3, rr, rng() * 3, 0, 6.3); g.fill(); } }
    const t = own(new THREE.CanvasTexture(cv)); t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function dotTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    const t = own(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function glowTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.25, 'rgba(255,170,80,0.55)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = own(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---------------------------------------------------------------- paths: ground-hugging dirt ribbons
  const pathLines = [];
  function ribbon(ctrl, name, mat = pathMat, width = PATH_W, record = true, lift = 0.13) {
    const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'catmullrom', 0.4);
    const n = Math.max(4, Math.ceil(curve.getLength() / 0.9)), pts = curve.getSpacedPoints(n);
    if (record) pathLines.push(pts);
    const pos = [], uv = [], col = [], idx = [], rows = [];
    let dist = 0;
    for (let i = 0; i <= n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const wob = 0.82 + 0.34 * vn(i * 0.35 + 2, 5.5, 4096), hw = width * 0.5 * wob * (1 + 0.5 * (1 - sstep(0, 4, Math.min(i * 0.9, (n - i) * 0.9))));
      const wet = isWater(p.x, p.z) ? 0 : 1;
      const alpha = wet * sstep(0, 3.5, Math.min(i * 0.9, (n - i) * 0.9) + 1.2);
      const row = [];
      for (let k = 0; k < 3; k++) {
        const s = (k - 1) * hw, x = p.x - tz * s, z = p.z + tx * s;
        pos.push(x, G(x, z) + lift * (k === 1 ? 1 : 0.45), z); uv.push(k * 0.5, dist / (width * 2.3)); col.push(1, 1, 1, alpha); row.push(pos.length / 3 - 1);
      }
      rows.push(row);
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1]; idx.push(a, c, b, b, c, d); }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.userData.noShadow = true; m.renderOrder = 1; m.receiveShadow = false; m.userData.pts = pts;
    grp('paths').add(m); return m;
  }
  const dirtTex = dirtTexture();
  const pathMat = own(new THREE.MeshLambertMaterial({ map: dirtTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const pathA = PATH_A.slice();
  if (hasLake) pathA.push([JX + 0.4, shoreZ + 4.2], [JX, shoreZ + 1.6]);
  function creekTexture() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), img = g.createImageData(S, S), px = img.data;
    for (let y = 0; y < S; y++) {
      const v = y / S, e = 0.74 + 0.14 * (vn(7.3, v * 10, 10) - 0.5) * 2 + 0.05 * (vn(2.9, v * 40, 40) - 0.5) * 2;
      for (let x = 0; x < S; x++) {
        const u = x / S, d = Math.abs(u - 0.5) * 2, n = vn(u * 10 + 2, v * 10, 10) * 0.5 + vn(u * 36, v * 36, 36) * 0.5;
        const peb = sstep(0.62, 0.7, vn(u * 22 + 9, v * 22, 22));
        let r = 70 + 34 * n + 60 * peb, gg = 62 + 30 * n + 56 * peb, b = 52 + 24 * n + 46 * peb;
        const bank = sstep(0.5, 0.95, d); r += (74 - r) * bank * 0.5; gg += (96 - gg) * bank * 0.5; b += (50 - b) * bank * 0.5;
        const a = 1 - sstep(e - 0.18, e + 0.02, d), i = (y * S + x) * 4; px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = own(new THREE.CanvasTexture(cv)); t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  const creekMat = own(new THREE.MeshLambertMaterial({ map: creekTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  ribbon(pathA, 'sz-path-a'); ribbon(PATH_B, 'sz-path-b');
  const creekPts = ribbon(CREEK, 'sz-creek', creekMat, CREEK_W, false, 0.035).userData.pts;
  const distToPaths = (x, z) => {
    let best = 99;
    for (const pts of pathLines) for (let i = 0; i < pts.length; i += 1) { const d = Math.hypot(pts[i].x - x, pts[i].z - z); if (d < best) best = d; }
    return best;
  };


  // grass-free earth under the paths, the spawn clearing and the mound (world.env.addGrassHole({x,z,w,d,yaw}) -> { remove() } when the world provides it; without it the grass simply stays)
  const holes = []; let holesOn = false;
  function setHoles(on) {
    if (on === holesOn) return;
    holesOn = on;
    if (!on) { for (const h of holes) { try { h.remove(); } catch { /* ignore */ } } holes.length = 0; return; }
    if (!env || typeof env.addGrassHole !== 'function') return;
    const add = (x, z, w, d, yaw) => { try { const h = env.addGrassHole({ x, z, w, d, yaw }); if (h) holes.push(h); } catch { /* ignore */ } };
    for (const pts of pathLines) for (let i = 0; i < pts.length - 1; i += 3) { const a = pts[i], b = pts[Math.min(i + 3, pts.length - 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; add((a.x + b.x) / 2, (a.z + b.z) / 2, PATH_W * 0.95, l + 0.5, Math.atan2(dx, dz)); }
    add(0, 0.5, 5.4, 5.4, 0); add(MOUND.x, MOUND.z, 12.5, 12.5, 0); add(0, 5.0, 7, 4, 0);
  }
  // ---------------------------------------------------------------- the low mound under the stone ring (visual + a walkable trimesh)
  const moundMesh = (() => {
    const NR = 11, NA = 44, pos = [], col = [], idx = [];
    const cG = new THREE.Color(0x607c36), cD = new THREE.Color(0x80714c), c = new THREE.Color();
    for (let i = 0; i <= NR; i++) {
      const rr = Math.pow(i / NR, 0.9) * MOUND.rm;
      for (let j = 0; j < NA; j++) {
        const a = (j / NA) * Math.PI * 2, x = MOUND.x + Math.sin(a) * rr, z = MOUND.z + Math.cos(a) * rr;
        pos.push(x, moundY(x, z) + (i === NR ? 0.02 : 0.045), z);
        const m = sstep(0.0, 1.0, vn(x * 0.7 + 3, z * 0.7, 4096)) * 0.5 + sstep(5.2, 8.8, rr) * 0.5;
        c.copy(cD).lerp(cG, Math.min(1, m)); col.push(c.r, c.g, c.b, 1 - sstep(MOUND.rm - 3.0, MOUND.rm - 0.2, rr));
      }
    }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * NA + j, b = i * NA + (j + 1) % NA, c2 = (i + 1) * NA + j, d = (i + 1) * NA + (j + 1) % NA; idx.push(a, b, c2, b, d, c2); }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const mat = own(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const m = new THREE.Mesh(g, mat); m.name = 'sz-mound'; m.userData.noShadow = true; m.renderOrder = 0; grp('ring').add(m); return m;
  })();
  let moundSolid = null;
  function setMoundSolid(on) {
    if (on && !moundSolid && world.physics && world.physics.body && moundMesh) {
      try { const h = world.physics.body(ctx, moundMesh, { shape: 'mesh', type: 'fixed', group: 'world' }); if (h) moundSolid = { remove() { try { h.remove(); } catch { /* ignore */ } } }; } catch { /* ignore */ }
    } else if (!on && moundSolid) { moundSolid.remove(); moundSolid = null; }
  }

  // ---------------------------------------------------------------- lake: jetty (walkable deck), boat, fishing rack, reeds
  let boat = null; const boatBase = { y: 0 };
  let lakeAnchor = vec(JX, -52), lakeFocus = vec(JX, -60);
  if (hasLake) {
    const lg = grp('lake'), size = 5.0, deckTop = wl + 0.38, base = deckTop - 0.35 * size, zc = shoreZ - 1.7;
    const jet = gen.spawn(ctx, 'sz-jetty', { x: JX, z: zc, yaw: 0, size, y: base, sink: 0, parent: lg });
    items.push({ obj: jet.object, x: JX, z: zc, d: pc ? 150 : 58 });
    addSolid({ shape: 'box', x: JX, z: zc, y: deckTop - 0.2, w: 0.7 * size * 0.84, h: 0.4, d: size * 0.96, yaw: 0 });
    boatBase.y = wl - 0.3;
    const bt = gen.spawn(ctx, 'sz-rowing-boat', { x: JX + 4.8, z: shoreZ - 2.6, yaw: 0.55, size: 3.2, y: boatBase.y, sink: 0, parent: lg });
    boat = bt.object; items.push({ obj: boat, x: JX + 4.8, z: shoreZ - 2.6, d: pc ? 150 : 58 });
    const fr = gen.spawn(ctx, 'sz-fishing-rack', { x: JX - 4.6, z: shoreZ + 4.4, yaw: 0.35, size: 1.8, parent: lg });
    items.push({ obj: fr.object, x: JX - 4.6, z: shoreZ + 4.4, d: pc ? 150 : 58 });
    blockers.push({ x: JX, z: shoreZ + 2, r: 4 });
    lakeAnchor = vec(JX + 0.3, shoreZ + 4.0); lakeFocus = vec(JX, shoreZ - 3.5, 0.2);
    const nR = pc ? 16 : 9;
    for (let i = 0; i < nR; i++) {
      const x = JX - 18 + (i / nR) * 34 + (rng() - 0.5) * 2.5; let zE = null;
      for (let z = -40; z > -95; z -= 0.4) { if (isWater(x, z)) { zE = z; break; } }
      if (zE == null || Math.abs(x - JX) < 4.2) continue;
      addPlacement('sz-reed-clump', x, zE + 0.5 + rng() * 0.8, rng() * 6.28, 1.6 * (0.8 + rng() * 0.4));
    }
  }

  // ---------------------------------------------------------------- nature: instanced scatters (sectors keep them frustum cullable)
  const creekDist = (x, z) => { let b = 99; for (const p of creekPts) { const d = Math.hypot(p.x - x, p.z - z); if (d < b) b = d; } return b; };
  const occupied = blockers.slice();
  const treeSolids = [];
  function ok(x, z, r, tree) {
    if (isWater(x, z) || G(x, z) < wl + 0.35) return false;
    if (Math.hypot(x - MOUND.x, z - MOUND.z) < 7.6) return false;
    if (creekDist(x, z) < CREEK_W * 0.5 + 0.5 + r * 0.5) return false;
    if (tree && Math.abs(x) < 4.6 && z < -12 && z > -70) return false;              // keep the horizon below the sphere open
    for (const b of occupied) if (Math.hypot(x - b.x, z - b.z) < b.r + r) return false;
    return distToPaths(x, z) > PATH_W * 0.5 + 0.7 + r * 0.5;
  }
  function put(id, x, z, size, r, solidR) {
    addPlacement(id, x, z, rng() * 6.283, size);
    occupied.push({ x, z, r });
    if (solidR && Math.hypot(x, z) < 42) treeSolids.push({ tree: 1, shape: 'cyl', x, z, y: G(x, z) + 1.5, r: solidR, h: 3.0, yaw: 0 });
  }
  const qk = pc ? 1 : 0.55;
  for (const [ci, [cx, cz, cr, mixPc, mixQ]] of CLUMPS.entries()) {
    const mix = pc ? mixPc : mixQ;
    for (const sp in mix) {
      const [id, base] = TREE[sp]; let n = mix[sp];
      for (let t = 0; n > 0 && t < 40; t++) {
        const a = rng() * 6.283, d = Math.sqrt(rng()) * cr, x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d, size = base * (0.8 + rng() * 0.4);
        if (!ok(x, z, size * 0.22, true)) continue;
        put(id, x, z, size, size * 0.26, Math.max(0.28, size * 0.045)); n--;
      }
    }
    for (let i = 0, nb = pc ? 3 : (ci % 2 ? 0 : 1); i < nb; i++) {                 // scrub at the fringe of the clump
      for (let t = 0; t < 12; t++) { const a = rng() * 6.283, d = cr * (0.9 + rng() * 0.5), x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d, size = 1.4 * (0.8 + rng() * 0.4); if (ok(x, z, size * 0.4, false)) { put(i % 3 === 2 ? 'sz-berry-bush' : 'sz-bush', x, z, i % 3 === 2 ? size * 0.85 : size, size * 0.4); break; } }
    }
  }
  for (const [id, cx, cz, cr, nPc, nQ, sz] of ZONES) {
    let n = pc ? nPc : nQ;
    if (id === 'sz-mushroom-ring') {                               // PC only: a fairy ring of red toadstool clusters
      if (!pc || !ok(cx, cz, 2.6, false)) continue;
      for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rng() * 0.3, x = cx + Math.sin(a) * cr, z = cz + Math.cos(a) * cr, size = sz[0] + rng() * (sz[1] - sz[0]); put(id, x, z, size, 0.3); }
      occupied.push({ x: cx, z: cz, r: cr + 0.8 }); continue;
    }
    for (let t = 0; n > 0 && t < 40; t++) {
      const a = rng() * 6.283, d = Math.sqrt(rng()) * cr, x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d, size = (sz[0] + rng() * (sz[1] - sz[0])) * (0.82 + rng() * 0.36) / 0.9 * 0.9;
      if (!ok(x, z, size * 0.4, false)) continue;
      put(id, x, z, size, size * 0.4, id === 'sz-boulder-a' ? size * 0.4 : 0); n--;
    }
  }
  // flowers + tufts along the paths
  for (const pts of pathLines) {
    for (let i = 6, c = 0; i < pts.length - 3; i += 5 + ((rng() * 4) | 0), c++) {
      const p = pts[i], q = pts[i + 1], tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1, s = (rng() < 0.5 ? -1 : 1) * (PATH_W * 0.5 + 0.9 + rng() * 1.6);
      const x = p.x - (tz / tl) * s, z = p.z + (tx / tl) * s, id = c % 3 === 2 ? 'sz-grass-tuft' : 'sz-flower-patch';
      if ((id === 'sz-grass-tuft' && !pc && c % 6 !== 2) || (!pc && c % 2 === 1)) continue;
      if (ok(x, z, 0.5, false)) put(id, x, z, id === 'sz-flower-patch' ? 1.0 + rng() * 0.4 : 1.0 + rng() * 0.4, 0.5);
    }
  }
  // reeds and rocks on the banks of the dry creek
  for (let i = 3; i < creekPts.length - 2; i += 3 + ((rng() * 2) | 0)) {
    if (!pc && (i % 2)) continue;
    const p = creekPts[i], q = creekPts[i + 1], tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1, sd = (rng() < 0.5 ? -1 : 1) * (CREEK_W * 0.5 + 0.1 + rng() * 0.7);
    const x = p.x - (tz / tl) * sd, z = p.z + (tx / tl) * sd;
    if (Math.hypot(x - CROSS[0], z - CROSS[1]) < 3.8 || distToPaths(x, z) < PATH_W * 0.5 + 0.9 || isWater(x, z)) continue;
    if (rng() < 0.7) put('sz-reed-clump', x, z, 1.3 + rng() * 0.5, 0.5); else put('sz-boulder-c', x, z, 0.9 + rng() * 0.5, 0.6);
  }
  for (const s of treeSolids) addSolid(s);
  const farIds = [...new Set(placements.map((p) => p.id))];
  if (pc) buildAtlas(farIds).catch((err) => console.warn('[startzone] atlas', err)); else bakeBillboards(farIds).catch((err) => console.warn('[startzone] billboards', err));
  updateLod(true);

  // ---------------------------------------------------------------- glow halos + lights for lanterns and braziers
  let glowPoints = null;
  {
    const gx = glowTexture();
    const arr = new Float32Array(glowPts.length * 3);
    glowPts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
    const geo = own(new THREE.BufferGeometry()); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = own(new THREE.PointsMaterial({ map: gx, size: 1.7, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xffffff }));
    glowPoints = new THREE.Points(geo, mat); glowPoints.frustumCulled = false; glowPoints.userData.noShadow = true; glowPoints.name = 'sz-glow'; grp('camp').add(glowPoints);
    if (pc && kit && kit.light) for (const p of glowPts) { try { lamps.push(kit.light(ctx, { color: p.light, intensity: p.light === 0xffb060 ? 9 : 11, distance: 9, flicker: 0.15, position: { x: p.x, y: p.y + 0.15, z: p.z } })); } catch { /* optional */ } }
  }

  // ---------------------------------------------------------------- notice board: the controls for the current input mode
  let forcedMode = null;                      // tests: api.forceMode('hands') shows that board without a headset
  const modeNow = () => forcedMode || (input && (input.left?.tracked || input.right?.tracked) ? 'hands' : (input && input.presenting ? 'controllers' : 'desktop'));
  const WISH = 'Say "Omnissiah, ..." to wish';
  const SIGN = {                              // rows: [key, action]
    desktop: [['WASD', 'walk'], ['Mouse', 'look'], ['Left click', 'cast'], ['E', 'spells'], ['G', 'grab'], ['T / N', 'talk'], ['M / V', 'menu / VR']],
    controllers: [['L stick', 'walk'], ['R stick', 'turn'], ['R trigger', 'cast'], ['A', 'spells'], ['Grip', 'grab'], ['X / L trigger', 'talk']],
    hands: [['Index pinch', 'cast'], ['Fist / middle pinch', 'grab'], ['Ring pinch', 'spells'], ['L index pinch', 'talk'], ['L ring pinch', 'walk'], ['Pinky pinch', 'turn']],
  };
  const controlsText = (mode = modeNow()) => ['HOW TO PLAY', ...(SIGN[mode] || SIGN.desktop).map((r) => r[0] + ' - ' + r[1]), WISH].join('\n');
  let curMode = modeNow();
  const signCv = document.createElement('canvas'); signCv.width = 1152; signCv.height = 952;   // 1.89 x 1.56 m: fits the opening of the board frame with a margin
  const signTex = own(new THREE.CanvasTexture(signCv)); signTex.colorSpace = THREE.SRGBColorSpace; signTex.anisotropy = 4;
  // typeset: title centred and smaller, rows "KEY - action" in two columns (key column fixed, left aligned), ONE size for all rows (measured, whole block scaled to fit), wish line set apart below a rule
  function drawSign(mode) {
    const g = signCv.getContext('2d'), W = signCv.width, H = signCv.height, rows = SIGN[mode] || SIGN.desktop, n = rows.length, FONT = '"Trebuchet MS", Verdana, sans-serif';
    g.fillStyle = '#ecdcb2'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(120,80,30,0.16)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(120,80,30,0.2)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#8a5a2a'; g.lineWidth = 6; g.strokeRect(12, 12, W - 24, H - 24);
    g.textBaseline = 'middle';
    g.font = '800 100px ' + FONT; let kw = 0; for (const r of rows) kw = Math.max(kw, g.measureText(r[0]).width);
    const wishW = g.measureText(WISH).width;
    g.font = '600 100px ' + FONT; let aw = 0; for (const r of rows) aw = Math.max(aw, g.measureText(r[1]).width);
    const GAP = 34, DASH = 40, block100 = kw + GAP + DASH + GAP + aw;            // at 100 px
    const unitsH = 1.0 + 1.2 * n + 0.4 + 1.1, availW = W - 130, availH = H - 84;
    const Fz = Math.min(96, availW / (block100 / 100), availH / unitsH), k = Fz / 100;
    const blockW = block100 * k, x0 = (W - blockW) / 2, y0 = (H - unitsH * Fz) / 2;
    g.textAlign = 'center'; g.fillStyle = '#7a1f0c'; g.font = '800 ' + (0.8 * Fz) + 'px ' + FONT; g.fillText('HOW TO PLAY', W / 2, y0 + 0.5 * Fz);
    g.textAlign = 'left';
    rows.forEach((r, i) => {
      const y = y0 + Fz + (i + 0.5) * 1.2 * Fz;
      g.font = '800 ' + Fz + 'px ' + FONT; g.fillStyle = '#3a1608'; g.fillText(r[0], x0, y);
      g.font = '700 ' + Fz + 'px ' + FONT; g.fillStyle = '#9a6a3a'; g.fillText('\u2013', x0 + (kw + GAP) * k, y);
      g.font = '600 ' + Fz + 'px ' + FONT; g.fillStyle = '#1a1008'; g.fillText(r[1], x0 + (kw + GAP + DASH + GAP) * k, y);
    });
    const yr = y0 + Fz + n * 1.2 * Fz + 0.1 * Fz;
    g.strokeStyle = '#8a5a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, yr); g.lineTo(x0 + blockW, yr); g.stroke();
    const wp = Math.min(Fz * 0.98, blockW / (wishW / 100) * 0.98);
    g.textAlign = 'center'; g.fillStyle = '#0b4a66'; g.font = '800 ' + wp + 'px ' + FONT; g.fillText(WISH, W / 2, yr + 0.62 * Fz);
    signTex.needsUpdate = true;
  }
  drawSign(curMode);
  const board = byRole.board;
  {
    const yaw = board.yawR, s = board.size, gy = G(board.x, board.z), fz = 0.107 * s + 0.015, c = Math.cos(yaw), sn = Math.sin(yaw);
    const geo = own(new THREE.PlaneGeometry(0.63 * s, 0.63 * s * (signCv.height / signCv.width)));
    const mat = own(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, fog: false }));
    const plane = new THREE.Mesh(geo, mat); plane.name = 'sz-controls-sign'; plane.userData.noShadow = plane.userData.noOutline = plane.userData.noCull = true;
    plane.position.set(board.x + fz * sn, gy + 0.58 * s, board.z + fz * c); plane.rotation.y = yaw;
    grp('yard').add(plane);
  }

  // ---------------------------------------------------------------- training dummies (real kit.damageable targets)
  const strawFx = kit && kit.particles ? kit.particles(ctx, { count: 80, color: [0xe0c070, 0xa08040], size: [0.08, 0.03], life: [0.5, 1.1], speed: [0.8, 2.2], gravity: 4, drag: 0.8, spread: 0.2, additive: false }) : null;
  const _dv = new THREE.Vector3();
  const dummies = [];
  const makeDamageable = (d) => {
    if (!kit || !kit.damageable) return;
    d.dmg = kit.damageable(ctx, d.group, {
      hp: 60, radius: d.rad, offsetY: d.off, faction: 'neutral', gore: 'none',
      onHit: () => { d.wob = 1; d.hits++; if (strawFx) strawFx.emit(_dv.set(d.group.position.x, d.group.position.y + d.off, d.group.position.z), 5); emit('startzone:dummy-hit', { index: d.index, hits: d.hits }); },
      onDeath: () => {
        d.alive = false; d.respawn = performance.now() + 4500; d.group.visible = false;                 // wall clock: respawns even when frames are slow
        if (strawFx) strawFx.emit(_dv.set(d.group.position.x, d.group.position.y + d.off * 0.9, d.group.position.z), 40);
        emit('startzone:dummy-down', { index: d.index });
      },
    });
  };
  dummyRows.forEach((r, i) => {
    const g = new THREE.Group(); g.name = 'sz-dummy-' + i; g.position.set(r.x, G(r.x, r.z), r.z); g.rotation.y = r.yawR; grp('yard').add(g);
    const h = gen.spawn(ctx, r.id, { x: 0, z: 0, y: 0, size: r.size, parent: g });
    h.ready.then(() => { if (!h.removed && !disposed) noOutline(h.object); });
    const d = { index: i, group: g, alive: true, hits: 0, wob: 0, respawn: 0, dmg: null, off: r.off, rad: r.rad, get position() { return g.position; } };
    makeDamageable(d); dummies.push(d);
  });

  // ---------------------------------------------------------------- weapon rack with real, grabbable weapons
  const W = world.weapons, slots = [], RACK_TYPES = ['sword', 'axe', 'bow'];
  const rk = byRole.rack, rkY = G(rk.x, rk.z), rkYaw = rk.yawR;
  const slotPos = (i) => { const c = Math.cos(rkYaw), s = Math.sin(rkYaw), lx = (i - 1) * 0.62, lz = 0.78; return new THREE.Vector3(rk.x + lx * c + lz * s, rkY + 1.1, rk.z - lx * s + lz * c); };
  function stock(slot) {
    if (!W) return;
    try {
      if (slot.weapon) { try { slot.weapon.remove(); } catch { /* ignore */ } slot.weapon = null; }
      const w = W.create(ctx, slot.type, { position: slot.pos.clone(), scale: 0.75, radius: 0.4 });
      if (!w || !w.body) return;
      slot.weapon = w; slot.away = 0; slot.taken = false;
      const b = w.body, inv = b.invMass || 1;
      b.position.copy(slot.pos); if (b.velocity) b.velocity.set(0, 0, 0);
      b.invMass = 0;                                              // pinned on the rack until somebody grabs it
      if (b.onGrab) b.onGrab(() => { b.invMass = inv; slot.taken = true; emit('startzone:weapon', { type: slot.type }); });
    } catch { /* weapons optional */ }
  }
  RACK_TYPES.forEach((type, i) => { const slot = { type, pos: slotPos(i), weapon: null, away: 0, taken: false }; slots.push(slot); stock(slot); });

  // ---------------------------------------------------------------- spell lectern
  const lc = byRole.lectern, lcY = G(lc.x, lc.z);
  let lecternCool = 0, lecternTry = 0;

  // ---------------------------------------------------------------- fireflies
  const FF = pc ? 90 : 36, ffPos = new Float32Array(FF * 3), ffSeed = new Float32Array(FF * 3);
  for (let i = 0; i < FF; i++) { const a = rng() * 6.283, r = 4 + rng() * 15; ffSeed[i * 3] = Math.cos(a) * r; ffSeed[i * 3 + 1] = rng() * 6.283; ffSeed[i * 3 + 2] = Math.sin(a) * r - 6; }
  const ffGeo = own(new THREE.BufferGeometry()); ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = own(new THREE.PointsMaterial({ map: dotTexture(), color: 0xe4ff9a, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, alphaTest: 0.01 }));
  const flies = new THREE.Points(ffGeo, ffMat); flies.frustumCulled = false; flies.userData.noShadow = true; flies.name = 'sz-fireflies'; root.add(flies);

  // ---------------------------------------------------------------- anchors + service
  const dcx = dummyRows.reduce((a, r) => a + r.x, 0) / (dummyRows.length || 1), dcz = dummyRows.reduce((a, r) => a + r.z, 0) / (dummyRows.length || 1);
  const stand = (x, z, d) => { const l = Math.hypot(x, z) || 1; return vec(x - (x / l) * d, z - (z / l) * d); };
  const altar = LAYOUT.find((r) => r.id === 'sz-shrine-altar');
  const anchors = {
    shrine: vec(0, 3.3), rack: stand(rk.x, rk.z, 2.4), lectern: stand(lc.x, lc.z, 1.6), dummies: stand(dcx, dcz, 4.0), waystone: stand(board.x, board.z, 3.2), lakeside: lakeAnchor, campfire: vec(0, -3.2),
  };
  const focus = {
    shrine: vec(altar.x, altar.z, 1.5), rack: vec(rk.x, rk.z, 1.3), lectern: vec(lc.x, lc.z, 1.2), dummies: vec(dcx, dcz, 1.2), waystone: vec(board.x, board.z, 1.6), lakeside: lakeFocus, campfire: vec(FIRE[0], FIRE[1], 0.8),
  };
  const state = { active: true };
  const visited = {};
  const api = {
    anchors, focus, controlsText, stats, rows: LAYOUT, forceMode(m) { forcedMode = m || null; },
    get dummyList() { return dummies; }, get rack() { return slots; }, get mode() { return curMode; }, get active() { return state.active; },
    nearest(p) { let best = null, bd = 3; for (const k in anchors) { const d = Math.hypot(p.x - anchors[k].x, p.z - anchors[k].z); if (d < bd) { bd = d; best = k; } } return best; },
  };
  ctx.provide('startzone', api);

  // ---------------------------------------------------------------- visibility: travel / blast / mixed reality
  let away = false;
  function applyVisible() {
    const v = !away && !(input && input.passthrough);
    if (v === state.active && solidsOn === v) return;
    state.active = v; root.visible = v;
    setSolids(v); setMoundSolid(v); setHoles(v);
    for (const d of dummies) {
      if (v) { if (d.alive && !d.dmg) makeDamageable(d); } else if (d.dmg) { try { d.dmg.remove(); } catch { /* ignore */ } d.dmg = null; }
    }
    for (const l of lamps) { try { l.enabled = v; } catch { /* ignore */ } }
  }
  for (const n of ['travel:start', 'travel:arrive', 'blast:arrive']) ctx.on(n, () => { away = true; applyVisible(); });
  for (const n of ['travel:home', 'blast:home']) ctx.on(n, () => { away = false; applyVisible(); });
  ctx.on('xr:start', applyVisible); ctx.on('xr:end', applyVisible);
  if (world.travel && world.travel.current) away = true;
  applyVisible();
  if (!state.active) { solidsOn = false; }

  // ---------------------------------------------------------------- per-frame
  let meadowHole = null;
  function claimMeadow() { if (meadowHole || !world.meadow || !world.meadow.clearArea) return; try { meadowHole = world.meadow.clearArea(0, -8, 37); } catch { /* optional */ } }
  claimMeadow();
  const head = ctx.player.head;
  let tSlow = 0, tCull = 0, tNext = 0;
  const ENTER = ['shrine', 'rack', 'lectern', 'waystone', 'lakeside', 'dummies'];
  return {
    update(dt, t) {
      if (disposed) return;
      applyVisible();
      if (!state.active) return;
      for (let i = 0; i < FF; i++) {
        const s = i * 3, a = t * 0.15 + ffSeed[s + 1];
        ffPos[s] = ffSeed[s] + Math.sin(a * 3.1 + i) * 0.8;
        ffPos[s + 2] = ffSeed[s + 2] + Math.cos(a * 2.3 + i * 1.7) * 0.8;
        ffPos[s + 1] = G(ffSeed[s], ffSeed[s + 2]) + 0.7 + Math.sin(a * 5 + i) * 0.5 + (i % 5) * 0.25;
      }
      ffGeo.attributes.position.needsUpdate = true;
      ffMat.opacity = 0.55 + Math.sin(t * 2.2) * 0.3;
      if (glowPoints) glowPoints.material.opacity = 0.72 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 3.1) * 0.06;
      if (boat) { boat.position.y = boatBase.y + Math.sin(t * 0.9) * 0.035; boat.rotation.z = Math.sin(t * 0.7) * 0.012; }
      for (const d of dummies) {
        if (d.wob > 0.001) { d.wob *= Math.max(0, 1 - dt * 3.5); d.group.rotation.z = Math.sin(t * 22) * 0.14 * d.wob; } else d.group.rotation.z = 0;
        if (!d.alive && performance.now() >= d.respawn) { try { if (d.dmg) d.dmg.remove(); } catch { /* ignore */ } d.dmg = null; d.alive = true; d.group.visible = true; d.hits = 0; d.wob = 0; makeDamageable(d); }
      }
      lodT -= dt; if (lodT <= 0) { lodT = 0.25; updateLod(false); }
      flushChunks(3);
      tCull -= dt;
      if (tCull <= 0) {                                              // draw distances (hero extras: lake)
        tCull = 0.4;
        const hx = head.x, hz = head.z;
        for (const it of items) { const v = Math.hypot(hx - it.x, hz - it.z) < it.d; if (it.obj.visible !== v) it.obj.visible = v; }
      }
      tSlow += dt; if (tSlow < 0.25) return; const step = tSlow; tSlow = 0;
      if (t > tNext) {
        tNext = t + 1.0; claimMeadow();
        const m = modeNow();
        if (m !== curMode) { curMode = m; drawSign(m); }
        for (const sl of slots) {                                    // keep the rack stocked: a weapon thrown away and left 25 s is replaced
          const w = sl.weapon;
          if (!w) { stock(sl); continue; }
          if (!sl.taken) continue;
          if (w.held) { sl.away = 0; continue; }
          const p = w.body && w.body.position;
          if (!p || Math.hypot(p.x - sl.pos.x, p.z - sl.pos.z) > 1.5) { sl.away += 1; if (sl.away > 25) stock(sl); } else sl.away = 0;
        }
      }
      lecternCool -= step;
      const hx = head.x, hz = head.z;
      if (Math.hypot(hx - lc.x, hz - lc.z) < 2.4 && lecternCool <= 0 && world.spells) {
        lecternCool = 40;
        try {
          const list = world.spells.list ? world.spells.list() : [];
          lecternTry = (lecternTry || 0) + 1;
          const sp = list.find((s) => s.id === 'firebolt') || (lecternTry > 4 ? list[0] : null);   // the intro names Firebolt: wait for it to register (its file loads after this module)
          if (!sp) lecternCool = 3;
          else { world.spells.select(sp.id); ctx.hud.show((sp.name || sp.id) + ' ready: ' + (curMode === 'desktop' ? 'left click casts, E opens the wheel' : curMode === 'hands' ? 'index pinch casts, ring pinch opens the wheel' : 'right trigger casts, A opens the wheel'), 6); }
        } catch { /* ignore */ }
      }
      for (const k of ENTER) {
        const a = anchors[k], d = Math.hypot(hx - a.x, hz - a.z);
        if (d < 2.4) { if (!visited[k]) { visited[k] = true; emit('startzone:enter', { name: k }); } } else if (d > 8) visited[k] = false;
      }
      if (!visited.__hum && Math.hypot(hx - altar.x, hz - altar.z) < 4.5) { visited.__hum = true; try { world.oracle && world.oracle.pulse && world.oracle.pulse(0.5); } catch { /* ignore */ } }
      else if (visited.__hum && Math.hypot(hx - altar.x, hz - altar.z) > 10) visited.__hum = false;
    },
    dispose() {
      disposed = true;
      setSolids(false); setMoundSolid(false); setHoles(false);
      try { if (meadowHole) meadowHole.remove(); } catch { /* ignore */ } meadowHole = null;
      for (const m of chunkMeshes.values()) { try { m.geometry.dispose(); } catch { /* ignore */ } }
      try { if (BB.mesh) BB.mesh.dispose(); } catch { /* ignore */ }
      for (const d of dummies) { try { if (d.dmg) d.dmg.remove(); } catch { /* ignore */ } }
      for (const sl of slots) { try { if (sl.weapon) sl.weapon.remove(); } catch { /* ignore */ } }
      for (const o of disposables) { try { o.dispose(); } catch { /* ignore */ } }
    },
  };
}



