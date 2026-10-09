// library/scenarios.js - composed scenes; each returns ONE handle and remove() clears everything. Built with inst.sub(name, { lx, lz }).
// Crowd sizes scale with H.density (counts are trimmed by perf.allow in core/library.js); fences / walls / stones are solid, gaps keep a path out.
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, shade, mix, biped, part, worldAdd } = H;
  const PI = Math.PI;
  const mx = H.mx; // model glue (library/modelkit.js, installed by structures.js)
  const blk = H.blk ?? { box() {}, cyl() {}, piece() {}, part() {}, item() {} }; // H.blk (structures.js): solid colliders that appear only once the player is clear of them (never dropped onto the player)
  const anyBroken = (i) => () => (i.broken | 0) > 0;
  const dn = (n) => (n <= 0 ? 0 : Math.max(1, Math.round(n * (H.density ? H.density() : 1)))); // crowd size scaled by ctx.quality.density at spawn time (never more than asked)
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'scenarios', description, options, aliases, build: mx ? mx.wrap(name, build) : build, noPush: false, ...extra });
  const faceCenter = (lx, lz) => Math.atan2(-lx, -lz);
  const _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 0.8, 0);
  const near = (p, r) => { const dx = H.head.x - p.x, dz = H.head.z - p.z; return dx * dx + dz * dz < r * r; };

  // two extra enemy types the scenarios need
  lib.add({ name: 'pirate', category: 'enemies', description: 'cutlass-swinging pirate with a tricorn hat and eye patch', options: 'faction, hp, damage', aliases: ['pirates', 'buccaneer', 'sea dog', 'corsair', 'swashbuckler'],
    build(i, o) {
      biped(i, o, { h: 1.78, skin: 0xd2a07a, shirt: 0xb83a3a, pants: 0x2a2a3a, hair: 0x1a1a1a, hp: 32, dmg: 7, cd: 1.5, windup: 0.5, speed: 3.0, aggro: 16, gear: [['head', 'tricorn'], ['pivot', 'belt', 0x2a1a10], ['pivot', 'scarf', 0xe8e4d8]], weapon: 'sword',
        puff: 0xb09070, drops: [{ type: 'sword', chance: 0.3 }, { type: 'dagger', chance: 0.3 }], lines: ['Arrr, fresh meat!', 'Walk the plank!', 'Shiver me timbers!', 'Yo ho ho!'] });
    } });
  lib.add({ name: 'bandit-archer', category: 'enemies', description: 'hooded bandit sniper with a hunting bow; shoots from cover', options: 'faction, hp, damage', aliases: ['bandit bowman', 'outlaw archer', 'robber archer'],
    build(i, o) {
      biped(i, o, { h: 1.72, skin: 0xd6a17a, shirt: 0x4a3b3b, pants: 0x332e26, hp: 22, dmg: 5, attack: 'ranged', range: 17, cd: 2.2, windup: 0.7, speed: 2.7, aggro: 21, proj: { color: 0xe0d8b0, speed: 14, radius: 0.1, splash: 0.2 },
        gear: [['head', 'hood', 0x4a3b3b], ['pivot', 'quiver']], weapon: 'bow', puff: 0xb09070, drops: [{ type: 'bow', chance: 0.3 }], lines: ['Stay in the light...', 'One arrow, one fool.'] });
    } });

  // ================================================================ village
  def('village', 'lively village: 2 cottages, a hut, a well, a merchant\'s stall, 2 villagers, a child, a dog, chickens, fences, a signpost and trees', 'none', ['town', 'hamlet', 'settlement', 'villages', 'small town', 'peaceful village', 'medieval village'], (i, o) => {
    i.sub('well', { lx: 0, lz: 0 });
    i.sub('cottage', { lx: -10, lz: -3, yaw: faceCenter(-10, -3) }); i.sub('cottage', { lx: 10, lz: -5, yaw: faceCenter(10, -5) }); i.sub('hut', { lx: -7, lz: 8, yaw: faceCenter(-7, 8) });
    i.sub('merchant', { lx: 7, lz: 8, yaw: faceCenter(7, 8) });
    i.sub('signpost', { lx: 2.5, lz: 12, yaw: 0.3, text: 'Village' });
    for (let k = 0; k < 2; k++) i.sub('villager', { lx: rand(-4, 4), lz: rand(-4, 4) });
    i.sub('child', { lx: -2, lz: 3 }); i.sub('dog', { lx: 3, lz: 2 }); i.sub('chicken', { lx: -8, lz: 3 });
    i.sub('fence', { lx: -9, lz: 10, yaw: 0.2, length: 5 }); i.sub('fence', { lx: 13, lz: 2, yaw: PI / 2, length: 6 });
    i.sub('oak-tree', { lx: -14, lz: 4 }); i.sub('oak-tree', { lx: 14, lz: 9 }); i.sub('flower-patch', { lx: 4, lz: -2 });
  }, { size: 14, distance: 18, face: 'player' });

  // ================================================================ goblin-camp
  def('goblin-camp', 'goblin war camp: bonfire, two ragged tents, a skull totem, a spiked stake wall, a loot chest, 4 goblins and an archer', 'goblins (count)', ['goblin camp', 'goblin village', 'goblin hideout', 'goblin den', 'orc camp', 'enemy camp', 'monster camp', 'goblin base'], (i, o) => {
    const b = H.mk();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU + 0.1; if (Math.abs(a - PI * 0.5) < 0.35) continue; const r = 9, x = Math.cos(a) * r, z = Math.sin(a) * r, g = i.gy(x, z) - i.y; b.cyl(x, g - 0.2, z, 0.05, 0.09, 2.0, 0x4a3320, [rand(-0.1, 0.1), 0, rand(-0.1, 0.1)], 5); b.cone(x, g + 1.8, z, 0.1, 0.4, 0x6a665e, 0, 4); if (k % 4 === 0) { b.sph(x, g + 2.05, z, 0.14, 0.14, 0.14, 0xe6dfc8, 0, 6); } blk.cyl(i, x, z, 0.13, 2.0); }
    b.cyl(-6.5, -0.2, -6, 0.15, 0.2, 4.2, 0x3e2a18, 0, 6); for (let k = 0; k < 4; k++) b.sph(-6.5, 1.0 + k * 0.8, -6, 0.2, 0.2, 0.2, 0xe6dfc8, 0, 6); b.box(-6.5, 4.2, -6, 1.2, 0.1, 0.1, 0x3e2a18); b.mode('glow'); for (let k = 0; k < 4; k++) { b.box(-6.42, 1.0 + k * 0.8 + 0.04, -5.82, 0.05, 0.05, 0.02, 0x9aff6a); b.box(-6.58, 1.0 + k * 0.8 + 0.04, -5.82, 0.05, 0.05, 0.02, 0x9aff6a); }
    i.add(b.build());
    blk.cyl(i, -6.5, -6, 0.3, 4.2);
    i.sub('bonfire', { lx: 0, lz: 0, scale: 0.8 });
    i.sub('tent', { lx: -5, lz: 2.5, yaw: faceCenter(-5, 2.5), color: 0x6a5a3a }); i.sub('tent', { lx: 4.5, lz: -3, yaw: faceCenter(4.5, -3), color: 0x5a4a30 });
    i.sub('chest', { lx: -3, lz: -5, loot: true, yaw: 0.5 }); i.sub('torch-stand', { lx: 3, lz: 6 }); i.sub('torch-stand', { lx: -3, lz: 6 });
    const n = dn(clamp(Math.floor(o.goblins ?? 4), 1, 12));
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU + rand(-0.3, 0.3); i.sub('goblin', { lx: Math.cos(a) * 3.5, lz: Math.sin(a) * 3.5 }); }
    i.sub('goblin-archer', { lx: 0, lz: -7 });
  }, { size: 10, distance: 16, face: 'player' });

  // ================================================================ graveyard
  def('graveyard', 'fenced graveyard of headstones, mausoleum and mist; skeletons claw out of their graves as you approach (skeletons: 4)', 'skeletons', ['cemetery', 'tombs', 'crypt', 'graves', 'haunted graveyard', 'boneyard', 'burial ground', 'tombstones', 'gravestones'], (i, o) => {
    const b = H.mk(), W = 13, D = 11, graves = [];
    for (const s of [-1, 1]) {
      for (let x = -W / 2; x <= W / 2; x += 0.9) { if (s > 0 && Math.abs(x) < 1.4) continue; b.cyl(x, i.gy(x, s * D / 2) - i.y, s * D / 2, 0.025, 0.025, 1.2, 0x2a2e36, 0, 4); b.cone(x, i.gy(x, s * D / 2) - i.y + 1.2, s * D / 2, 0.05, 0.12, 0x2a2e36, 0, 4); }
      if (s < 0) b.box(0, 0.9, s * D / 2, W, 0.04, 0.04, 0x2a2e36); else for (const q of [-1, 1]) b.box(q * (W / 2 + 1.5) / 2, 0.9, s * D / 2, W / 2 - 1.5, 0.04, 0.04, 0x2a2e36); // the front fence has a 3 m gate gap
    }
    blk.box(i, 0, -D / 2, W, 0.25, 1.3, { gone: anyBroken(i) }); blk.box(i, -W / 2, 0, 0.25, D, 1.3, { gone: anyBroken(i) }); blk.box(i, W / 2, 0, 0.25, D, 1.3, { gone: anyBroken(i) });
    for (const q of [-1, 1]) blk.box(i, q * (W / 2 + 1.5) / 2, D / 2, W / 2 - 1.5, 0.25, 1.3, { gone: anyBroken(i) });
    for (const s of [-1, 1]) { for (let z = -D / 2; z <= D / 2; z += 0.9) { if (s < 0 && Math.abs(z - D / 2 + 0.0) > 100) continue; b.cyl(s * W / 2, i.gy(s * W / 2, z) - i.y, z, 0.025, 0.025, 1.2, 0x2a2e36, 0, 4); b.cone(s * W / 2, i.gy(s * W / 2, z) - i.y + 1.2, z, 0.05, 0.12, 0x2a2e36, 0, 4); } b.box(s * W / 2, 0.9, 0, 0.04, 0.04, D, 0x2a2e36); }
    const N = 14;
    for (let k = 0; k < N; k++) {
      const gx = -W / 2 + 1.5 + (k % 5) * 2.4 + rand(-0.3, 0.3), gz = -D / 2 + 2 + ((k / 5) | 0) * 2.8 + rand(-0.3, 0.3), g = i.gy(gx, gz) - i.y, ry = rand(-0.2, 0.2), c = pick([0x8a8a90, 0x7a7a82, 0x9a9aa0]);
      b.sph(gx, g + 0.05, gz - 0.9, 0.5, 0.15, 0.9, 0x4a3a2a, 0, 6);
      if (k % 4 === 0) { b.box(gx, g + 0.55, gz, 0.14, 1.1, 0.14, c, [0, ry, rand(-0.1, 0.1)]); b.box(gx, g + 0.8, gz, 0.6, 0.14, 0.14, c, [0, ry, 0]); }
      else if (k % 4 === 1) { b.box(gx, g + 0.45, gz, 0.7, 0.9, 0.14, c, [rand(-0.1, 0.1), ry, rand(-0.15, 0.15)]); b.cylc(gx, g + 0.9, gz, 0.35, 0.35, 0.14, c, [PI / 2, 0, 0], 8); }
      else if (k % 4 === 2) { b.box(gx, g + 0.3, gz, 0.6, 0.6, 0.12, c, [0, ry, rand(-0.2, 0.2)]); b.box(gx, g + 0.65, gz, 0.66, 0.1, 0.16, shade(c, 0.9)); }
      else { b.cyl(gx, g, gz, 0.18, 0.24, 1.0, c, 0, 4); b.cone(gx, g + 1.0, gz, 0.2, 0.3, shade(c, 0.9), 0, 4); }
      graves.push([gx, gz - 0.9]);
      blk.box(i, gx, gz, 0.75, 0.35, 1.0, { yaw: ry, gone: anyBroken(i) });
    }
    const mx = 0, mz = -D / 2 - 3.2;
    b.box(mx, 1.6, mz, 4.6, 3.2, 3.4, 0x7a7a82); b.prism(mx, 3.2, mz, 5.2, 1.4, 3.8, 0x5a5a62); b.box(mx, 1.1, mz + 1.72, 1.2, 2.2, 0.12, 0x14120f); for (const s of [-1, 1]) b.cyl(mx + s * 1.0, 0, mz + 1.9, 0.14, 0.16, 3.0, 0x9a9aa0, 0, 7); b.box(mx, 3.1, mz + 1.9, 2.6, 0.2, 0.3, 0x8a8a92);
    b.mode('glow'); b.sph(mx, 3.1, mz + 1.84, 0.1, 0.1, 0.1, 0x7affc8);
    i.add(b.build());
    blk.box(i, mx, mz, 4.7, 3.5, 4.2, { gone: anyBroken(i), steer: true });
    i.sub('dead-tree', { lx: -6, lz: 4 }); i.sub('dead-tree', { lx: 6.8, lz: -4 });
    const mist = H.mk(); mist.mode('ghost'); for (let k = 0; k < 4; k++) mist.sph(rand(-4, 4), 0.4, rand(-3, 3), rand(3, 5), 0.3, rand(2.5, 4), 0xaac0c8, 0, 8);
    const mm = mist.build({ own: true }); mm.material.opacity = 0.2; i.add(mm); i.tick((dt, t) => { mm.position.x = Math.sin(t * 0.2) * 0.6; mm.position.z = Math.cos(t * 0.17) * 0.5; });
    const K = dn(clamp(Math.floor(o.skeletons ?? 4), 0, 12));
    let armed = true, acc = 0;
    i.tick((dt, t) => {
      const d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      acc += dt * 1.5; const n = acc | 0; acc -= n; if (n && d < 50) { _w.set(i.x + rand(-4, 4), i.y + 0.2, i.z + rand(-3, 3)); i.burst('glow', 0x7affc8, _w, 1, 0.4, _up); }
      if (armed && d < W * 0.55 + 2 && K > 0) {
        armed = false;
        const s = i.snd(); s.tone({ freq: 55, freqEnd: 38, dur: 3, type: 'sine', vol: 0.35 }); s.noise({ dur: 2.2, filter: { type: 'lowpass', freq: 300, freqEnd: 80 }, vol: 0.4 }); H.ctx.hud?.show('The dead stir...', 2.5);
        for (let k = 0; k < K; k++) {
          const [gx, gz] = graves[(Math.random() * graves.length) | 0], p = i.at(gx, gz);
          _w.set(p.x, H.ground(p.x, p.z) + 0.1, p.z); i.burst('puff', 0x5a4a38, _w, 12, 1.2); i.burst('bits', 0x5a4a38, _w, 10, 0.8, _up);
          i.sub(k % 3 === 2 ? 'skeleton-archer' : 'skeleton', { x: p.x, z: p.z, rise: true, yaw: Math.atan2(H.head.x - p.x, H.head.z - p.z), worldYaw: true });
        }
      }
    }, { every: 0.2 });
  }, { size: 11, distance: 16, face: 'player' });

  // ================================================================ bandit-ambush
  def('bandit-ambush', 'forest road blocked by a fallen log, a tipped wagon and crates; 3 bandits wait behind it with 2 hidden archers and a loot chest', 'none', ['ambush', 'highway robbery', 'road ambush', 'bandits', 'robbers', 'roadblock', 'bandit trap', 'bandit camp'], (i, o) => {
    const b = H.mk();
    b.box(0, 0.02, 0, 4.2, 0.05, 30, 0x8a6a4a); for (let k = 0; k < 10; k++) b.box(rand(-1.8, 1.8), 0.05, rand(-14, 14), rand(0.2, 0.5), 0.04, rand(0.3, 0.8), 0x7a5a3a);
    b.cylc(0, 0.4, 0, 0.42, 0.45, 5.0, 0x6a4a2a, [0, 0, PI / 2], 9); b.cylc(2.52, 0.4, 0, 0.35, 0.35, 0.02, 0xc9a070, [0, 0, PI / 2], 9); b.cone(1.0, 0.7, 0.3, 0.05, 0.6, 0x5a3e24, [1.2, 0, 0.3], 4);
    b.push(4.2, 0, -3, 0.6, 0, 0, 1);
    b.box(0, 0.7, 0, 2.2, 0.16, 3.6, WOOD(), [0, 0, 0.35]); for (const s of [-1, 1]) b.box(s * 1.1, 1.0, 0, 0.1, 0.5, 3.6, 0x4d3322, [0, 0, 0.35]);
    b.cylc(-1.3, 0.55, 1.3, 0.6, 0.6, 0.1, 0x4d3322, [0, 0, PI / 2], 10); b.cylc(1.2, 0.2, -1.3, 0.6, 0.6, 0.1, 0x4d3322, [0.4, 0, PI / 2], 10);
    b.mode('cloth'); for (let k = 0; k < 4; k++) b.box(-0.2, 1.5, -1.2 + k * 0.9, 2.0, 0.04, 0.85, k % 2 ? 0xd8c8a0 : 0xc8b890, [0, 0, 0.35 + (k - 1.5) * 0.05]); b.mode('solid');
    b.box(0.2, 0.3, 2.0, 0.8, 0.6, 0.8, 0x8a6a3a); b.box(1.2, 0.2, 2.6, 0.6, 0.5, 0.6, 0x7a5a38); b.sph(-0.5, 0.25, 2.3, 0.25, 0.22, 0.25, 0xa89a70);
    b.pop();
    i.add(b.build());
    blk.box(i, 0, 0, 5.0, 0.95, 0.95); blk.box(i, 4.2, -3, 2.3, 3.7, 1.4, { yaw: 0.6 }); // the fallen log across the road and the tipped wagon
    i.sub('rock-cluster', { lx: -5, lz: -4 }); i.sub('rock-cluster', { lx: 5, lz: -6 }); i.sub('boulder', { lx: -4, lz: -9 });
    i.sub('pine-tree', { lx: -7, lz: 2 }); i.sub('pine-tree', { lx: 7, lz: 4 }); i.sub('oak-tree', { lx: -8, lz: -6 });
    i.sub('chest', { lx: -3, lz: -8, loot: true });
    for (const [x, z] of [[-2.2, -3.3], [0.2, -4.6], [2.4, -3.2]]) i.sub('bandit', { lx: x, lz: z });
    i.sub('bandit-archer', { lx: -5.2, lz: -5 }); i.sub('bandit-archer', { lx: 5.4, lz: -7 });
  }, { size: 12, distance: 18, face: 'player' });
  const WOOD = () => 0x7a5230;

  // ================================================================ arena-battle
  def('arena-battle', 'arena with 3 escalating waves (goblins; orc + skeletons; troll + wolves + dark knight); walk in to start (radius, waves)', 'radius, waves (1-3)', ['arena fight', 'gladiator', 'battle royale', 'survival waves', 'wave survival', 'colosseum battle', 'arena waves', 'gauntlet'], (i, o) => {
    const R = o.radius ?? 11;
    i.sub('arena', { lx: 0, lz: 0, radius: R, yaw: 0 });
    const plan = [[{ name: 'goblin', count: 4 }, { name: 'goblin-archer', count: 1 }], [{ name: 'orc-brute', count: 1 }, { name: 'skeleton', count: 3 }, { name: 'skeleton-archer', count: 1 }], [{ name: 'troll', count: 1 }, { name: 'wolf', count: 3 }, { name: 'dark-knight', count: 1 }]].slice(0, clamp(Math.floor(o.waves ?? 3), 1, 3));
    let state = 'wait', k = 0, cd = 0, cur = null;
    i.tick((dt, t) => {
      const d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      if (state === 'wait') { if (d < R - 1.5) { state = 'count'; cd = 3; H.ctx.hud?.show(`ARENA - Wave 1 of ${plan.length}`, 3); i.snd().chord([196, 294, 392], { dur: 1.5, type: 'sawtooth', vol: 0.18, stagger: 0.15 }); } }
      else if (state === 'count') { cd -= dt; if (cd <= 0) { cur = H.wave(i.ctx, plan[k], { around: { x: i.x, z: i.z }, radius: R - 2.2, parent: i, announce: true, delay: 0.5 }); state = 'fight'; } }
      else if (state === 'fight' && cur && cur.cleared) {
        k++;
        if (k >= plan.length) { state = 'done'; H.ctx.hud?.show('VICTORY!', 4); const K = H.kit(); i.snd().chord([523, 659, 784, 1047], { dur: 2, type: 'triangle', vol: 0.25, stagger: 0.1 }); i.sub('confetti-burst', { lx: 0, lz: 0 }); i.sub('chest', { lx: 0, lz: 2, loot: true }); }
        else { state = 'count'; cd = 5; H.ctx.hud?.show(`Wave ${k + 1} of ${plan.length} in 5...`, 3); }
      }
      if (state === 'fight' && d > R + 22) { /* player fled: pause */ }
    }, { every: 0.2 });
  }, { size: 13, distance: 16, face: 'none', noPush: true });

  // ================================================================ enchanted-grove
  def('enchanted-grove', 'fairy-tale grove: cherry blossoms and willows, glowing mushrooms, a crystal cluster, a koi pond, three fairies, fireflies, flowers and butterflies', 'none', ['magic forest', 'fairy forest', 'fairy grove', 'magical grove', 'fairytale forest', 'enchanted forest', 'fairy garden', 'magical garden', 'fae glade'], (i, o) => {
    i.sub('fish-pond', { lx: 0, lz: 0, radius: 2.2 });
    i.sub('cherry-blossom', { lx: -6, lz: -3 }); i.sub('cherry-blossom', { lx: 6.5, lz: -2 }); i.sub('willow', { lx: -3, lz: -8 }); i.sub('willow', { lx: 4.5, lz: -8.5 });
    i.sub('giant-mushroom', { lx: -6.5, lz: 4, color: 0x3ad8c0 }); i.sub('giant-mushroom', { lx: 7, lz: 3.5, color: 0xd83a8a, scale: 0.8 }); i.sub('giant-mushroom', { lx: 1.5, lz: -5.5, color: 0x9a5cff, scale: 0.6 });
    i.sub('crystal-cluster', { lx: 4, lz: 6.5, color: 0xb06aff }); i.sub('flower-patch', { lx: -3.5, lz: 3 }); i.sub('flower-patch', { lx: 3.8, lz: -0.5, radius: 1.2 }); i.sub('flower-patch', { lx: 0, lz: 6, radius: 1.4 });
    for (let k = 0; k < 3; k++) i.sub('fairy', { x: i.x + rand(-2, 2), z: i.z + rand(-2, 2), follow: false });
    i.sub('fireflies', { follow: false, x: i.x, z: i.z, count: 90 }); i.sub('butterflies', { x: i.x, z: i.z, count: 10 });
  }, { size: 10, distance: 14, face: 'player' });

  // ================================================================ wizard-tower
  def('wizard-tower', 'tall purple wizard tower with orbiting rune rings and a floating orb, plus a wizard NPC, cauldron, mushrooms and garden', 'none', ['wizard\'s tower', 'mage tower', 'wizard home', 'magic tower', 'sorcerer tower', 'tower of magic', 'arcane tower', 'witch hut', 'wizard house'], (i, o) => {
    const b = H.mk(), Hh = 12;
    b.cyl(0, -1.2, 0, 2.4, 2.6, 1.4, 0x6e6a64, 0, 12); b.cyl(0, 0, 0, 2.15, 2.3, 0.6, 0x7a766e, 0, 12);
    for (let k = 0; k < 10; k++) b.cyl(0, 0.6 + k * 1.0, 0, 2.05 - k * 0.1 - 0.1, 2.05 - k * 0.1, 1.02, k % 2 ? 0x8a867c : 0x7e7a70, 0, 12);
    b.cyl(0, Hh - 1.6, 0, 3.0, 2.3, 0.35, 0x6a5a8a, 0, 12);
    b.cyl(0, Hh - 1.2, 0, 1.2, 1.2, 1.6, 0x8a867c, 0, 12);
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; b.box(Math.cos(a) * 3.0, Hh - 1.0, Math.sin(a) * 3.0, 0.1, 0.8, 0.1, 0x4a3a6a); } b.tor(0, Hh - 0.6, 0, 3.0, 0.05, 0x4a3a6a, [PI / 2, 0, 0], 16);
    b.cone(0, Hh + 0.4, 0, 1.9, 4.6, 0x4a2a8a, 0, 12); b.cone(0, Hh + 0.4, 0, 2.2, 0.4, 0x3a1a6a, 0, 12); b.sph(0, Hh + 5.2, 0, 0.14, 0.14, 0.14, 0xd9a93c);
    b.mode('glow'); for (let k = 0; k < 14; k++) { const a = rand(0, TAU), y = rand(0.8, 4.0), r = 1.88 * (1 - y / 5.2) + 0.03; b.oct(Math.cos(a) * r, Hh + 0.4 + y, Math.sin(a) * r, 0.07, 0.07, 0.01, 0xffe27a, [0, -a + PI / 2, 0]); }
    for (let k = 0; k < 7; k++) { const y = 2 + k * 1.3, a = k * 0.9 + 0.3, r = 2.04 - (y / 11) * 0.8 + 0.02; b.box(Math.sin(a) * r, y, Math.cos(a) * r, 0.42, 0.62, 0.06, 0xffd890, [0, a, 0]); }
    b.mode('solid'); b.box(0, 1.1, 2.1, 1.2, 2.2, 0.3, 0x3a2616); b.box(0, 1.1, 2.18, 0.9, 1.9, 0.12, 0x5a3a20); b.box(0, 2.35, 2.12, 1.6, 0.3, 0.3, 0x6e6a64);
    for (let k = 0; k < 6; k++) { const a = rand(-0.6, 0.6); b.sph(Math.sin(a) * 2.0, rand(1, 8), Math.cos(a) * 2.0, 0.3, 0.2, 0.15, pick([0x4a7a3a, 0x5a8a40]), 0, 4); }
    i.add(b.build());
    blk.cyl(i, 0, 0, 2.2, Hh + 1, { steer: true });
    const rings = [];
    for (let q = 0; q < 2; q++) { const rb = H.mk(); rb.mode('glow'); rb.tor(0, 0, 0, 3.4 + q * 0.7, 0.04, q ? 0x58e6ff : 0xb06aff, [PI / 2, 0, 0], 28); for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, r = 3.4 + q * 0.7; rb.oct(Math.cos(a) * r, 0, Math.sin(a) * r, 0.12, 0.2, 0.12, q ? 0x58e6ff : 0xb06aff, [0, a, 0]); } const m = rb.build({ own: true }); m.position.y = 8 + q * 1.2; m.rotation.x = 0.3 * (q ? -1 : 1); i.add(m); rings.push(m); }
    const ob = H.mk(); ob.mode('glow'); ob.sph(0, 0, 0, 0.4, 0.4, 0.4, 0xd8c8ff, 0, 8); ob.mode('beam'); ob.sph(0, 0, 0, 0.8, 0.8, 0.8, 0xa56bff, 0, 8); const orb = ob.build({ own: true }); i.add(orb);
    const L = i.light({ color: 0xa56bff, intensity: 24, distance: 20, position: { x: i.x, y: i.y + Hh + 8, z: i.z } });
    i.tick((dt, t) => { rings[0].rotation.y += dt * 0.5; rings[1].rotation.y -= dt * 0.7; orb.position.y = Hh + 6.2 + Math.sin(t * 1.2) * 0.3; orb.rotation.y += dt; if (L) { L.position.y = i.y + orb.position.y; L.intensity = 22 + Math.sin(t * 2) * 4; } });
    i.sub('wizard-npc', { lx: 2.5, lz: 4.5 }); i.sub('cauldron', { lx: -3.5, lz: 4, color: 0xb06aff }); i.sub('giant-mushroom', { lx: -6, lz: 1, scale: 0.6, color: 0x9a5cff }); i.sub('flower-patch', { lx: 4.5, lz: 1.5 }); i.sub('crystal-cluster', { lx: 5.5, lz: 6, scale: 0.6 });
  }, { size: 4, distance: 14, face: 'player' });

  // ================================================================ farm
  def('farm', 'working farm: red barn with hay loft, crop rows, hay bales, a fenced pasture with sheep, a cow, chickens and a pig, a farmer and a scarecrow', 'none', ['farmstead', 'ranch', 'homestead', 'barnyard', 'farmland', 'farms', 'farm yard', 'countryside'], (i, o) => {
    const b = H.mk(); const W = 8, D = 10;
    b.box(0, 2.3, -10, W, 4.6, D, 0xa83a2e); b.box(0, 0.2, -10, W + 0.4, 0.4, D + 0.4, 0x6e6a64);
    b.prism(0, 4.6, -10, W + 1.2, 2.6, D + 1.2, 0x5a4a44); b.prism(0, 4.5, -10, W + 0.8, 2.4, D + 1.4, 0x6a5a54);
    b.box(0, 2.0, -5.03, 3.4, 3.6, 0.15, 0xf4efe0); b.box(0, 2.0, -5.02, 3.0, 3.3, 0.12, 0x8a2a20); for (const s of [-1, 1]) b.box(0, 2.0, -4.98, 0.18, 3.5, 0.08, 0xf4efe0, [0, 0, s * 0.55]);
    b.box(0, 5.3, -5.03, 1.2, 1.2, 0.15, 0xf4efe0); b.mode('glow'); b.box(0, 5.3, -5.0, 0.9, 0.9, 0.1, 0xffd890); b.mode('solid');
    for (let k = 0; k < 6; k++) b.box(-W / 2 + 0.6, 1 + k * 0.7, -5.03, 0.14, 0.14, 0.1, 0xf4efe0);
    for (let r = 0; r < 6; r++) { const z = -3 + r * 1.1; b.box(-14, 0.12, z, 8, 0.24, 0.5, 0x5a3e24); for (let c = 0; c < 14; c++) b.cone(-14 - 3.6 + c * 0.55, 0.2, z, 0.12, 0.45, r % 2 ? 0x6aa044 : 0xc8b040, 0, 4); }
    for (let k = 0; k < 5; k++) { const x = 6 + (k % 3) * 1.2, z = -5 + ((k / 3) | 0) * 1.1; b.cylc(x, 0.4 + ((k / 3) | 0) * 0.0, z, 0.45, 0.45, 0.8, 0xd8b860, [0, 0, PI / 2], 9); b.cylc(x, 0.4, z, 0.46, 0.46, 0.1, 0x6a4a2a, [0, 0, PI / 2], 9); }
    i.add(b.build());
    blk.box(i, 0, -10, W + 0.4, D + 0.4, 5.2, { steer: true });
    i.sub('fence', { lx: 8, lz: 2, yaw: 0, length: 12 }); i.sub('fence', { lx: 14, lz: 7, yaw: PI / 2, length: 10 }); i.sub('fence', { lx: 8, lz: 12, yaw: 0, length: 12 });
    i.sub('sheep', { lx: 10, lz: 6, count: 2, spread: 1.8 }); i.sub('cow', { lx: 12, lz: 8 }); i.sub('chicken', { lx: 4, lz: 5 }); i.sub('pig', { lx: 6, lz: 9 });
    i.sub('farmer', { lx: -6, lz: 3 }); i.sub('scarecrow', { lx: -14, lz: 0.5 }); i.sub('oak-tree', { lx: 15, lz: -6 }); i.sub('well', { lx: 3, lz: 1 });
  }, { size: 16, distance: 20, face: 'player' });

  // ================================================================ castle-siege
  def('castle-siege', 'castle wall, gate and towers: knights and archers defend (your side) while goblins, an orc and skeletons storm it (attackers, defenders)', 'attackers, defenders', ['siege', 'castle attack', 'castle battle', 'castle defense', 'siege battle', 'castle assault', 'fortress siege', 'storm the castle'], (i, o) => {
    i.sub('gate', { lx: 0, lz: 0, yaw: 0 }); i.sub('wall-segment', { lx: -8.2, lz: 0, length: 7 }); i.sub('wall-segment', { lx: 8.2, lz: 0, length: 7 });
    i.sub('castle-tower', { lx: -13, lz: 0, roof: false }); i.sub('castle-tower', { lx: 13, lz: 0, roof: false });
    const def_ = clamp(Math.floor(o.defenders ?? 3), 0, 10), atk = dn(clamp(Math.floor(o.attackers ?? 4), 1, 14));
    for (let k = 0; k < def_; k++) i.sub(k % 2 ? 'archer' : 'knight', { lx: -6 + k * (12 / Math.max(1, def_ - 1)), lz: -3.5, follow: null, wander: 0, yaw: PI, aggroRange: 24 });
    const kinds = ['goblin', 'goblin', 'orc-brute', 'skeleton-archer', 'goblin', 'skeleton', 'skeleton-archer', 'goblin'];
    for (let k = 0; k < atk; k++) i.sub(kinds[k % kinds.length], { lx: -9 + (k * 18) / Math.max(1, atk - 1), lz: 20 + rand(0, 6), yaw: PI, rise: true });
    i.sub('torch-stand', { lx: -3, lz: -4 }); i.sub('torch-stand', { lx: 3, lz: -4 });
  }, { size: 16, distance: 24, face: 'player' });

  // ================================================================ pirate-cove
  def('pirate-cove', 'sandy cove with a beached pirate ship, a dock and rowboat, palm trees, barrels, a cannon, a treasure pile and a chest guarded by 3 pirates', 'none', ['pirate ship', 'pirate bay', 'pirate island', 'pirate beach', 'pirates cove', 'shipwreck', 'treasure island', 'pirate camp', 'pirate lair'], (i, o) => {
    const b = H.mk();
    b.cyl(0, -0.4, 0, 12, 12.4, 0.45, 0xe0cc94, 0, 24); b.cyl(0, 0.0, 0, 11.6, 12, 0.08, 0xeedca4, 0, 24);
    const ship = H.mk(); const L = 12;
    for (let k = 0; k < 10; k++) { const z = -L / 2 + k * (L / 10) + 0.6, w = 1.9 * Math.sin(Math.min(1, (k + 1.3) / 5) * PI / 2) + 0.6 - (k > 7 ? (k - 7) * 0.5 : 0); ship.box(0, 1.1, z, Math.max(0.5, w * 2), 1.6, L / 10 + 0.05, k % 2 ? 0x6a4a2a : 0x5e3e22); ship.box(0, 0.35, z, Math.max(0.4, w * 1.4), 0.5, L / 10 + 0.05, 0x3e2a18); for (const s of [-1, 1]) ship.box(s * Math.max(0.3, w), 2.1, z, 0.1, 0.5, L / 10 + 0.04, 0x4d3322); }
    ship.cone(0, 1.0, L / 2 + 0.2, 0.9, 1.6, 0x5e3e22, [PI / 2, 0, 0], 5); ship.box(0, 1.9, -L / 2 - 0.1, 3.2, 1.4, 0.6, 0x4d3322); ship.box(0, 2.9, -L / 2 + 0.6, 2.8, 0.2, 1.8, 0x5e3e22);
    ship.cyl(0, 1.6, 0.8, 0.14, 0.16, 8.5, 0x4d3322, 0, 7); ship.cyl(0, 6.2, 0.8, 0.1, 0.12, 3.0, 0x4d3322, 0, 6); ship.box(0, 8.4, 0.8, 0.5, 0.1, 0.5, 0x4d3322); ship.cylc(0, 7.0, 0.8, 0.07, 0.07, 3.8, 0x4d3322, [0, 0, PI / 2], 6); ship.cylc(0, 4.4, 0.8, 0.08, 0.08, 4.6, 0x4d3322, [0, 0, PI / 2], 6);
    ship.mode('cloth'); ship.box(0, 5.6, 0.95, 3.4, 2.8, 0.05, 0xe8dcc0, [0.0, 0, 0.0]); ship.box(0, 3.1, 1.0, 4.0, 1.9, 0.05, 0xd8ccb0); for (let k = 0; k < 4; k++) ship.box(-1.5 + k, 2.0, 1.05, 0.2, 0.5, 0.04, 0xe8dcc0); ship.box(0.5, 8.6, 0.8, 1.0, 0.6, 0.03, 0x1a1a1a); ship.mode('glow'); ship.sph(0.4, 8.62, 0.84, 0.1, 0.1, 0.1, 0xf0f0e0); ship.mode('solid');
    ship.box(0, 2.0, 3.2, 0.5, 0.15, 0.8, 0x2a2e36); for (const s of [-1, 1]) ship.cylc(s * 1.0, 2.1, 2.0, 0.17, 0.17, 0.6, 0x25282e, [0, 0, PI / 2], 8);
    const sm = ship.build(); sm.position.set(-7, 0, -7); sm.rotation.set(0.0, 0.5, 0.18); sm.scale.setScalar(0.9);
    i.add(b.build()); i.add(sm);
    blk.box(i, -7, -7, 4.8, 11.2, 2.6, { yaw: 0.5, steer: true }); // the beached hull
    const wb = H.mk(); wb.mode('ghost'); wb.cylc(0, 0, 0, 1, 1, 0.04, 0x3a9ac0, 0, 28); const w = wb.build({ own: true }); w.scale.set(24, 1, 24); w.position.set(0, -0.05, -22); i.add(w);
    i.tick((dt, t) => { w.position.y = -0.05 + Math.sin(t * 0.8) * 0.03; sm.position.y = Math.sin(t * 0.5) * 0.02; });
    i.sub('dock', { lx: 8, lz: -4, yaw: -PI / 2 + 0.1, length: 7 });
    i.sub('palm-tree', { lx: 7, lz: 6 }); i.sub('palm-tree', { lx: 10, lz: 2.5, scale: 1.2 }); i.sub('palm-tree', { lx: -9, lz: 5 });
    i.sub('treasure-pile', { lx: -1, lz: 4 }); i.sub('chest', { lx: 2, lz: 5, loot: true, yaw: 0.4 }); i.sub('barrel', { lx: 4, lz: 2, count: 2, spread: 1 }); i.sub('powder-keg', { lx: 5.2, lz: 4 }); i.sub('cannon', { lx: -4, lz: 3, yaw: PI * 0.75 });
    i.sub('pirate', { lx: 0, lz: 2 }); i.sub('pirate', { lx: -3, lz: 7 }); i.sub('pirate', { lx: 4, lz: 8 });
  }, { size: 14, distance: 18, face: 'player' });

  // ================================================================ robot-invasion
  def('robot-invasion', 'flying saucer beams down aliens while battle robots march in and drones swarm (robots, drones, aliens)', 'robots, drones, aliens', ['alien invasion', 'ufo', 'ufo invasion', 'alien attack', 'robot attack', 'sci-fi invasion', 'flying saucer', 'robot uprising', 'machine invasion', 'invasion'], (i, o) => {
    const b = H.mk();
    b.sph(0, 0, 0, 4.0, 0.8, 4.0, 0x8a96a4, 0, 12); b.sph(0, 0.55, 0, 1.6, 1.0, 1.6, 0x9aa6b4, 0, 10); b.tor(0, -0.05, 0, 3.6, 0.2, 0x5a6672, [PI / 2, 0, 0], 20);
    b.mode('glow'); for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; b.sph(Math.cos(a) * 3.8, -0.1, Math.sin(a) * 3.8, 0.17, 0.17, 0.17, k % 2 ? 0x9aff6a : 0xff5a8a); } b.sph(0, -0.8, 0, 0.9, 0.2, 0.9, 0x9aff6a);
    b.mode('ghost'); b.sph(0, 1.0, 0, 1.2, 0.9, 1.2, 0xbfeaff, 0, 10);
    const ufo = new THREE.Group(); ufo.add(b.build({ own: true }));
    const bm = H.mk(); bm.mode('beam'); bm.cone(0, -9, 0, 3.0, 8.2, 0x9aff6a, 0, 16); const beam = bm.build({ own: true }); ufo.add(beam);
    ufo.position.set(i.x, i.y + 9, i.z); i.ctx.root.add(ufo); i.cleanup(() => { ufo.removeFromParent(); H.disposeOwn(ufo); }); i.track(ufo);
    const L = i.light({ color: 0x9aff6a, intensity: 30, distance: 22, position: { x: i.x, y: i.y + 8, z: i.z } });
    let acc = 0, hum = 0;
    i.tick((dt, t) => {
      ufo.position.y = i.y + 9 + Math.sin(t * 0.7) * 0.4; ufo.position.x = i.x + Math.sin(t * 0.25) * 2; ufo.position.z = i.z + Math.cos(t * 0.21) * 2; ufo.rotation.y += dt * 0.6; beam.material.opacity = 0.28 + Math.sin(t * 4) * 0.06;
      if (L) L.position.set(ufo.position.x, ufo.position.y - 1, ufo.position.z);
      acc += dt * 12; const n = acc | 0; acc -= n; if (n && near(i, 70)) { _w.set(ufo.position.x + rand(-1.5, 1.5), i.y + rand(0.5, 8), ufo.position.z + rand(-1.5, 1.5)); i.burst('glow', 0x9aff6a, _w, n, 0.35, _up); }
      hum -= dt; if (hum <= 0 && near(i, 60)) { hum = 2.2; i.snd().tone({ freq: 90, freqEnd: 100, dur: 2.4, type: 'sine', vol: 0.12, at: ufo.position }); i.snd().tone({ freq: 360, freqEnd: 330, dur: 2.4, type: 'sawtooth', vol: 0.025, at: ufo.position }); }
    });
    const nr = dn(clamp(Math.floor(o.robots ?? 2), 0, 6)), nd = dn(clamp(Math.floor(o.drones ?? 3), 0, 10)), na = dn(clamp(Math.floor(o.aliens ?? 2), 0, 8));
    for (let k = 0; k < na; k++) { const a = (k / na) * TAU; i.sub('alien-grunt', { lx: Math.cos(a) * 2.2, lz: Math.sin(a) * 2.2, rise: true }); }
    for (let k = 0; k < nr; k++) i.sub('battle-robot', { lx: -5 + k * 10, lz: 9 + rand(0, 3), yaw: PI, rise: true });
    for (let k = 0; k < nd; k++) { const a = (k / nd) * TAU + 0.4; i.sub('drone', { lx: Math.cos(a) * 7, lz: Math.sin(a) * 7 }); }
  }, { size: 10, distance: 22, face: 'none' });

  // ================================================================ boss-fight
  def('boss-fight', 'a torch-lit arena with a boss in the middle (option boss: lich-king | ancient-dragon, default lich-king) and two reward chests at the rim', 'boss, radius', ['boss battle', 'boss', 'final boss', 'big fight', 'boss arena', 'epic battle', 'boss encounter', 'dragon fight'], (i, o) => {
    const R = o.radius ?? 14, boss = String(o.boss ?? 'lich-king').toLowerCase().includes('drag') ? 'ancient-dragon' : 'lich-king';
    i.sub('arena', { lx: 0, lz: 0, radius: R, yaw: 0 });
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; i.sub('torch-stand', { lx: Math.cos(a) * (R - 3), lz: Math.sin(a) * (R - 3), scale: 1.2 }); }
    i.sub('chest', { lx: -R + 4, lz: 0, loot: true, yaw: PI / 2 }); i.sub('chest', { lx: R - 4, lz: 0, loot: true, yaw: -PI / 2 });
    i.sub(boss, { lx: 0, lz: -2, yaw: 0, rise: true, name: o.name });
  }, { size: 16, distance: 20, face: 'none' });

  // ================================================================================================================
  // MODEL-BUILT SCENARIOS (world.models). The primitive builders above stay as the fallback (mx.wrap); everything below composes the upgraded
  // entries (cottage, tavern, gate, ship ...) with instanced model clutter (mx.scatter: 1-3 draw calls for fences, stones, crates, trees).
  // ================================================================================================================
  const tang = (a) => Math.atan2(-Math.cos(a), -Math.sin(a)); // yaw laying a model's local X along the circle tangent at angle a
  const along = (x0, z0, x1, z1) => Math.atan2(-(z1 - z0), x1 - x0); // yaw laying local X along a segment
  function lineItems(name, x0, z0, x1, z1, step, f = {}) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / step)), out = [];
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
      if (f.skip && f.skip(x, z, k)) continue;
      out.push({ name: typeof name === 'function' ? name(k) : name, x, z, yaw: along(x0, z0, x1, z1) + (f.yaw ?? 0), sx: f.sx ?? (L / n) / step, sy: f.sy ?? 1, sz: f.sz ?? 1, y: f.y });
    }
    return out;
  }
  // mx.scatter + solid blockers: o.solid(item) -> true | { inset, shape, h, fx } makes that item solid (a wall, a gravestone, a stake); broken items / a failed model load drop theirs again
  const scat = (i, items, o) => {
    const sc = mx && items.length ? mx.scatter(i, items, o) : null;
    if (sc && o && o.solid) for (const s of items) { const so = o.solid(s); if (so) for (const q of [].concat(so)) blk.item(i, s, { sc, ...(q === true ? {} : q) }); }
    return sc;
  };
  const STONE_B = [{ hex: 0x8a93a3, w: 0.6 }, { hex: 0x6c7482, w: 0.4 }];
  const WOOD_B = [{ hex: 0x8a5a32, w: 0.7 }, { hex: 0x6b4426, w: 0.3 }];
  const sub = (i, name, lx, lz, extra) => i.sub(name, { lx, lz, yaw: faceCenter(lx, lz), ...extra });
  // skeletons claw out of the graves when the player comes close (shared by graveyard and haunted-graveyard)
  function graveRise(i, K, reach, graves, kinds = ['skeleton', 'skeleton', 'skeleton-archer']) {
    let armed = true, acc = 0;
    i.tick((dt) => {
      const d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      acc += dt * 1.5; const n = acc | 0; acc -= n; if (n && d < 50) { _w.set(i.x + rand(-4, 4), i.y + 0.2, i.z + rand(-3, 3)); i.burst('glow', 0x7affc8, _w, 1, 0.4, _up); }
      if (armed && d < reach && K > 0 && graves.length) {
        armed = false;
        const s = i.snd(); s.tone({ freq: 55, freqEnd: 38, dur: 3, type: 'sine', vol: 0.35 }); s.noise({ dur: 2.2, filter: { type: 'lowpass', freq: 300, freqEnd: 80 }, vol: 0.4 }); H.ctx.hud?.show('The dead stir...', 2.5);
        for (let k = 0; k < K; k++) {
          const [gx, gz] = graves[(Math.random() * graves.length) | 0], p = i.at(gx, gz);
          _w.set(p.x, H.ground(p.x, p.z) + 0.1, p.z); i.burst('puff', 0x5a4a38, _w, 12, 1.2); i.burst('bits', 0x5a4a38, _w, 10, 0.8, _up);
          i.sub(kinds[k % kinds.length], { x: p.x, z: p.z, rise: true, yaw: Math.atan2(H.head.x - p.x, H.head.z - p.z), worldYaw: true });
        }
      }
    }, { every: 0.2 });
  }
  // trodden-earth paths: short ground-following slabs merged into one mesh. pts = [[x, z], ...] polyline in local space
  function pathMesh(i, lines, w = 2.2, col = 0x9a7b55) {
    const b = H.mk();
    for (const pts of lines) for (let s = 0; s < pts.length - 1; s++) {
      const [x0, z0] = pts[s], [x1, z1] = pts[s + 1], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 1.4)), ry = Math.atan2(x1 - x0, z1 - z0);
      for (let k = 0; k < n; k++) { const u = (k + 0.5) / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u; b.box(x, i.gy(x, z) - i.y + 0.04, z, w, 0.09, L / n + 0.2, shade(col, 0.94 + Math.random() * 0.12), ry); }
    }
    const m = b.build(); m.userData.noShadow = true; i.add(m); return m;
  }  const GRAVESTONES = ['gravestone-cross', 'gravestone-round', 'gravestone-roof', 'gravestone-wide', 'gravestone-broken', 'gravestone-cross-large', 'cross', 'cross-wood', 'gravestone-round'];
  // rectangular iron fence with an opening in the middle of the +Z side
  function fenceItems(W, D, gap = 3) {
    const f = [];
    f.push(...lineItems('fence', -W / 2, -D / 2, W / 2, -D / 2, 3.2), ...lineItems('fence', -W / 2, -D / 2, -W / 2, D / 2, 3.2), ...lineItems('fence', W / 2, -D / 2, W / 2, D / 2, 3.2));
    let nf = Math.round(W / 3.2); if (nf % 2 === 0) nf++; // odd number of sections: the middle one is left out = a gate gap
    f.push(...lineItems('fence', -W / 2, D / 2, W / 2, D / 2, W / nf, { skip: (x) => Math.abs(x) < W / nf / 2 + 0.01 }));
    return f;
  }
  const IRON_B = { material: 'metal', hp: 60, colors: [{ hex: 0x2a2e36, w: 0.7 }, { hex: 0x707680, w: 0.3 }] };
  const stoneB = (hp = 70) => ({ material: 'stone', hp, colors: [{ hex: 0x8a93a3, w: 0.6 }, { hex: 0x6c7482, w: 0.4 }] });

  // ---- village: a proper street layout around the well
  mx.model('village', { build(i, o, fb) {
    pathMesh(i, [[[0, 0], [10, 1.5]], [[0, 0], [0, -12]], [[0, 0], [-11, 2.5]], [[-5, -2], [-8.5, -8]], [[6, -2], [9, -9.5]], [[0, 0], [12.5, 11]], [[-4, 4], [-8, 10]], [[0, 2], [2.5, 15]], [[-3, 6], [4, 8]]], 2.4);
    i.sub('well', { lx: 0, lz: 0 });
    sub(i, 'tavern', 12, 2); sub(i, 'church', 0, -15); sub(i, 'blacksmith-shop', -13, 3); sub(i, 'cottage', -10, -9); sub(i, 'cottage', 10, -11); sub(i, 'cottage', 14, 12); sub(i, 'hut', -9, 11);
    sub(i, 'merchant', 5, 8); i.sub('market-stall', { lx: -5, lz: 6, yaw: faceCenter(-5, 6) });
    i.sub('signpost', { lx: 2.5, lz: 16, yaw: 0.3, text: 'Village|Tavern >' });
    for (let k = 0; k < 3; k++) i.sub('villager', { lx: rand(-5, 5), lz: rand(-4, 4) });
    i.sub('child', { lx: -2, lz: 3 }); i.sub('dog', { lx: 3, lz: 2 }); i.sub('chicken', { lx: -8, lz: 5, count: 3, spread: 1.6 });
    i.sub('fence', { lx: -12, lz: 13, yaw: 0.2, length: 6 }); i.sub('fence', { lx: 17, lz: 5, yaw: PI / 2, length: 7 });
    i.sub('oak-tree', { lx: -16, lz: -2 }); i.sub('oak-tree', { lx: 17, lz: 16 }); i.sub('oak-tree', { lx: 6, lz: -17 }); i.sub('flower-patch', { lx: 4, lz: -2 }); i.sub('flower-patch', { lx: -6, lz: -4, radius: 1.2 });
    scat(i, [
      { name: 'hay-bale', x: -7, z: 14, yaw: 0.3 }, { name: 'hay-bale', x: -8.4, z: 14.6, yaw: 0.9 }, { name: 'crates-stacked', x: 8.5, z: 7, yaw: 0.5 }, { name: 'barrel-large', x: 9.8, z: 8, yaw: 0 }, { name: 'barrel-large', x: 15, z: 5, yaw: 1 },
      { name: 'cart', x: 3, z: -6, yaw: 1.2 }, { name: 'graveyard-bench', x: -3, z: 2, yaw: 0.2 }, { name: 'lantern', x: 2, z: 6 }, { name: 'lantern', x: -2, z: -5 },
    ], { breakable: (s) => ({ material: 'wood', hp: s.name === 'cart' ? 60 : 20, colors: WOOD_B }) });
  } });

  // ---- goblin-camp: a real palisade of spiked stakes, bone decorations and a skull totem
  mx.model('goblin-camp', { build(i, o, fb) {
    const stakes = [];
    for (let k = 0; k < 34; k++) { const a = (k / 34) * TAU + 0.1; if (Math.abs(a - PI * 0.5) < 0.38) continue; stakes.push({ name: 'fence-fortified', x: Math.cos(a) * 9, z: Math.sin(a) * 9, yaw: tang(a), sx: 1.3, sy: 1.15, sz: 1.2 }); }
    scat(i, stakes, { breakable: { material: 'wood', hp: 30, colors: WOOD_B }, solid: () => ({ inset: 0.9 }) });
    const b = H.mk();
    blk.cyl(i, -6.5, -6, 0.3, 4.2);
    b.cyl(-6.5, -0.2, -6, 0.15, 0.2, 4.2, 0x3e2a18, 0, 6); for (let k = 0; k < 4; k++) b.sph(-6.5, 1.0 + k * 0.8, -6, 0.2, 0.2, 0.2, 0xe6dfc8, 0, 6); b.box(-6.5, 4.2, -6, 1.2, 0.1, 0.1, 0x3e2a18); b.mode('glow'); for (let k = 0; k < 4; k++) { b.box(-6.42, 1.0 + k * 0.8 + 0.04, -5.82, 0.05, 0.05, 0.02, 0x9aff6a); b.box(-6.58, 1.0 + k * 0.8 + 0.04, -5.82, 0.05, 0.05, 0.02, 0x9aff6a); }
    i.add(b.build());
    const junk = [];
    for (let k = 0; k < 14; k++) { const a = rand(0, TAU), r = rand(2, 8); junk.push({ name: pick(['bone-a', 'bone-b', 'bone-c', 'skull', 'ribcage']), x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: rand(0, TAU), scale: rand(0.7, 1.1) }); }
    for (const [x, z] of [[-4, -2.5], [5, 1.5], [-2.5, 5.5]]) junk.push({ name: 'bedroll', x, z, yaw: rand(0, TAU) });
    for (const [x, z] of [[3.5, -6], [4.8, -5.3], [-7, 1.5]]) junk.push({ name: pick(['survival-barrel', 'survival-box-large', 'crate-a-big']), x, z, yaw: rand(0, TAU) });
    scat(i, junk, {});
    i.sub('bonfire', { lx: 0, lz: 0, scale: 0.8 });
    i.sub('tent', { lx: -5, lz: 2.5, yaw: faceCenter(-5, 2.5), color: 0x6a5a3a }); i.sub('tent', { lx: 4.5, lz: -3, yaw: faceCenter(4.5, -3), color: 0x5a4a30 });
    i.sub('chest', { lx: -3, lz: -5, loot: true, yaw: 0.5 }); i.sub('torch-stand', { lx: 3, lz: 6 }); i.sub('torch-stand', { lx: -3, lz: 6 });
    const n = dn(clamp(Math.floor(o.goblins ?? 4), 1, 12));
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU + rand(-0.3, 0.3); i.sub('goblin', { lx: Math.cos(a) * 3.5, lz: Math.sin(a) * 3.5 }); }
    i.sub('goblin-archer', { lx: 0, lz: -7 });
  } });

  // ---- graveyard: wrought-iron fence, real headstones, a crypt, candles and pumpkins; skeletons still claw out of the graves
  mx.model('graveyard', { build(i, o, fb) {
    const W = 13, D = 11, items = [], graves = [], stones = [];
    items.push(...fenceItems(W, D, 3));
    for (let k = 0; k < 14; k++) {
      const gx = -W / 2 + 1.5 + (k % 5) * 2.4 + rand(-0.3, 0.3), gz = -D / 2 + 2 + ((k / 5) | 0) * 2.8 + rand(-0.3, 0.3), ry = rand(-0.2, 0.2);
      stones.push({ name: pick(GRAVESTONES), x: gx, z: gz, yaw: ry + (Math.random() < 0.2 ? 0.3 : 0), scale: rand(0.85, 1.1) }); stones.push({ name: 'grave', x: gx, z: gz - 1.0, yaw: 0, scale: 0.55 });
      graves.push([gx, gz - 1.0]);
    }
    for (const [x, z] of [[-4.5, 4.5], [4.8, 4.2], [0.5, -4.6]]) stones.push({ name: pick(['graveyard-candle', 'lantern-candle', 'pumpkin-carved', 'urn-round']), x, z, yaw: rand(0, TAU) });
    stones.push({ name: 'graveyard-bench', x: -5.2, z: 1, yaw: PI / 2 });
    scat(i, items, { breakable: IRON_B, solid: () => ({ inset: 0.98 }) }); scat(i, stones, { breakable: (s) => (s.name === 'grave' ? null : stoneB(55)), solid: (s) => (/gravestone|^cross/.test(s.name) ? { inset: 0.9 } : null) });
    i.sub('crypt', { lx: 0, lz: -D / 2 - 4.2, yaw: 0 });
    i.sub('dead-tree', { lx: -6, lz: 4 }); i.sub('dead-tree', { lx: 6.8, lz: -4 });
    const mist = H.mk(); mist.mode('ghost'); for (let k = 0; k < 4; k++) mist.sph(rand(-4, 4), 0.4, rand(-3, 3), rand(3, 5), 0.3, rand(2.5, 4), 0xaac0c8, 0, 8);
    const mm = mist.build({ own: true }); mm.material.opacity = 0.2; i.add(mm); i.tick((dt, t) => { mm.position.x = Math.sin(t * 0.2) * 0.6; mm.position.z = Math.cos(t * 0.17) * 0.5; });
    graveRise(i, dn(clamp(Math.floor(o.skeletons ?? 4), 0, 12)), W * 0.55 + 2, graves);
  } });

  // ---- bandit-ambush: fallen log, tipped cart, crates and barrels on a forest road
  mx.model('bandit-ambush', { build(i, o, fb) {
    const b = H.mk();
    b.box(0, 0.02, 0, 4.2, 0.05, 30, 0x8a6a4a); for (let k = 0; k < 10; k++) b.box(rand(-1.8, 1.8), 0.05, rand(-14, 14), rand(0.2, 0.5), 0.04, rand(0.3, 0.8), 0x7a5a3a);
    i.add(b.build());
    scat(i, [
      { name: 'log-large', x: 0, z: 0, yaw: PI / 2, scale: 1.7 }, { name: 'crates-stacked', x: 3.2, z: -4, yaw: 0.5 }, { name: 'barrel-large', x: 4.6, z: -2.4, yaw: 0 }, { name: 'barrel-large', x: 5.4, z: -3.6, yaw: 1 }, { name: 'box-large', x: 2.1, z: -5.5, yaw: 0.3, scale: 0.8 },
      { name: 'stone-large-a', x: -5, z: -4, yaw: 1 }, { name: 'stone-large-a', x: 5.5, z: -7, yaw: 2, scale: 0.8 }, { name: 'sack', x: 1, z: -4.4 },
    ], { breakable: (s) => (/stone/.test(s.name) ? null : { material: 'wood', hp: 24, colors: WOOD_B }), solid: (s) => (s.name === 'log-large' ? { inset: 0.85 } : null) });
    const cart = mx.deco(i, 'cart', { x: 4.2, z: -3, yaw: 0.6, anchor: 'center' });
    if (cart) cart.ready.then(() => { if (cart.ok) { cart.obj.rotation.z = 0.32; cart.obj.position.y += 0.25; const ch = mx.breakable(i, [cart], { material: 'wood', hp: 70, colors: WOOD_B }); blk.piece(i, cart, { inset: 0.8, h: 1.4, gone: () => !ch || ch.broken }); } });
    i.sub('rock-cluster', { lx: -6, lz: -7 }); i.sub('boulder', { lx: -4, lz: -10 });
    i.sub('pine-tree', { lx: -7, lz: 2 }); i.sub('pine-tree', { lx: 7, lz: 4 }); i.sub('oak-tree', { lx: -8, lz: -6 });
    i.sub('chest', { lx: -3, lz: -8, loot: true });
    for (const [x, z] of [[-2.2, -3.3], [0.2, -4.6], [2.4, -3.2]]) i.sub('bandit', { lx: x, lz: z });
    i.sub('bandit-archer', { lx: -5.2, lz: -5 }); i.sub('bandit-archer', { lx: 5.4, lz: -7 });
  } });

  // ---- farm: crop beds, hay bales, windmill and a fenced pasture; the red barn stays procedural (no barn in the catalogue)
  mx.model('farm', { build(i, o, fb) {
    const W = 8, D = 10, b = H.mk();
    b.box(0, 2.3, -10, W, 4.6, D, 0xa83a2e); b.box(0, 0.2, -10, W + 0.4, 0.4, D + 0.4, 0x6e6a64);
    b.prism(0, 4.6, -10, W + 1.2, 2.6, D + 1.2, 0x5a4a44); b.prism(0, 4.5, -10, W + 0.8, 2.4, D + 1.4, 0x6a5a54);
    b.box(0, 2.0, -5.03, 3.4, 3.6, 0.15, 0xf4efe0); b.box(0, 2.0, -5.02, 3.0, 3.3, 0.12, 0x8a2a20); for (const s of [-1, 1]) b.box(0, 2.0, -4.98, 0.18, 3.5, 0.08, 0xf4efe0, [0, 0, s * 0.55]);
    b.box(0, 5.3, -5.03, 1.2, 1.2, 0.15, 0xf4efe0); b.mode('glow'); b.box(0, 5.3, -5.0, 0.9, 0.9, 0.1, 0xffd890); b.mode('solid');
    for (let k = 0; k < 6; k++) b.box(-W / 2 + 0.6, 1 + k * 0.7, -5.03, 0.14, 0.14, 0.1, 0xf4efe0);
    const barn = b.build(); i.add(barn);
    let barnH = null;
    mx.later(i, () => { if (mx.breakable) barnH = mx.breakable(i, [barn], { material: 'wood', hp: 300, stages: 'auto' }); });
    blk.box(i, 0, -10, W + 0.4, D + 0.4, 5.2, { steer: true, gone: () => !!barnH && barnH.broken });
    const items = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const x = -19 + c * 3.1, z = -3 + r * 3.0; items.push({ name: 'crops-dirt-double-row', x, z, yaw: PI / 2 }); }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) items.push({ name: r === 1 ? 'crops-corn-stage-d' : 'crops-wheat-stage-b', x: -19.6 + c * 1.6 + (r === 1 ? 0.3 : 0), z: -3 + r * 3.0 + rand(-0.4, 0.4), scale: rand(0.85, 1.15) });
    for (let k = 0; k < 7; k++) items.push({ name: 'hay-bale', x: 4 + (k % 4) * 1.5, z: -3.5 + ((k / 4) | 0) * 1.1, yaw: rand(0, 3) });
    scat(i, items, { breakable: (s) => (/crops/.test(s.name) ? { material: 'earth', hp: 8 } : { material: 'wood', hp: 18, colors: [{ hex: 0xd8b860, w: 1 }] }) });
    i.sub('fence', { lx: 8, lz: 2, yaw: 0, length: 12 }); i.sub('fence', { lx: 14, lz: 7, yaw: PI / 2, length: 10 }); i.sub('fence', { lx: 8, lz: 12, yaw: 0, length: 12 });
    i.sub('windmill', { lx: -22, lz: -14, yaw: faceCenter(-22, -14) });
    i.sub('sheep', { lx: 10, lz: 6, count: 2, spread: 1.8 }); i.sub('cow', { lx: 12, lz: 8 }); i.sub('chicken', { lx: 4, lz: 5 }); i.sub('pig', { lx: 6, lz: 9 });
    i.sub('farmer', { lx: -6, lz: 3 }); i.sub('scarecrow', { lx: -14, lz: 0.5 }); i.sub('oak-tree', { lx: 15, lz: -6 }); i.sub('well', { lx: 3, lz: 1 });
  } });

  // ---- castle-siege: the new gatehouse (towers + arch + swinging doors), wall runs, siege engines, banners
  mx.model('castle-siege', { build(i, o, fb) {
    i.sub('gate', { lx: 0, lz: 0, yaw: 0 }); i.sub('wall-segment', { lx: -12, lz: 0, length: 9 }); i.sub('wall-segment', { lx: 12, lz: 0, length: 9 });
    i.sub('castle-tower', { lx: -18.5, lz: 0, roof: false }); i.sub('castle-tower', { lx: 18.5, lz: 0, roof: false });
    const def_ = clamp(Math.floor(o.defenders ?? 3), 0, 10), atk = dn(clamp(Math.floor(o.attackers ?? 4), 1, 14));
    for (let k = 0; k < def_; k++) i.sub(k % 2 ? 'archer' : 'knight', { lx: -6 + k * (12 / Math.max(1, def_ - 1)), lz: -4.5, follow: null, wander: 0, yaw: PI, aggroRange: 24 });
    const kinds = ['goblin', 'goblin', 'orc-brute', 'skeleton-archer', 'goblin', 'skeleton', 'skeleton-archer', 'goblin'];
    for (let k = 0; k < atk; k++) i.sub(kinds[k % kinds.length], { lx: -9 + (k * 18) / Math.max(1, atk - 1), lz: 22 + rand(0, 6), yaw: PI, rise: true });
    i.sub('siege-tower', { lx: -11, lz: 16, yaw: PI }); i.sub('battering-ram', { lx: 3.5, lz: 13, yaw: PI });
    scat(i, [{ name: 'rocks-small', x: 8, z: 11, yaw: 1 }, { name: 'debris', x: -4, z: 9 }, { name: 'debris', x: 6, z: 7 }, { name: 'barrel-large', x: -4.5, z: -3, yaw: 0 }, { name: 'crates-stacked', x: 5, z: -3.5, yaw: 0.3 }], { breakable: (s) => (/rocks|debris/.test(s.name) ? null : { material: 'wood', hp: 22, colors: WOOD_B }) });
    i.sub('torch-stand', { lx: -3, lz: -5 }); i.sub('torch-stand', { lx: 3, lz: -5 });
  } });

  // ---- pirate-cove: a beached pirate galleon model, dock, rowboat, palms, barrels and a cannon
  mx.model('pirate-cove', { build(i, o, fb) {
    const b = H.mk();
    b.cyl(0, -0.4, 0, 12, 12.4, 0.45, 0xe0cc94, 0, 24); b.cyl(0, 0.0, 0, 11.6, 12, 0.08, 0xeedca4, 0, 24);
    i.add(b.build());
    const wb = H.mk(); wb.mode('ghost'); wb.cylc(0, 0, 0, 1, 1, 0.04, 0x3a9ac0, 0, 28); const w = wb.build({ own: true }); w.scale.set(24, 1, 24); w.position.set(0, -0.05, -22); i.add(w);
    i.tick((dt, t) => { w.position.y = -0.05 + Math.sin(t * 0.5) * 0.03; });
    i.sub('ship', { lx: -7, lz: -7, yaw: 0.5, style: 'pirate', size: 'large', noPush: true }); i.sub('dock', { lx: 8, lz: -4, yaw: -PI / 2 + 0.1, length: 7 }); i.sub('rowboat', { lx: 4, lz: -9, yaw: 0.8, size: 'small' });
    i.sub('palm-tree', { lx: 7, lz: 6 }); i.sub('palm-tree', { lx: 10, lz: 2.5, scale: 1.2 }); i.sub('palm-tree', { lx: -9, lz: 5 });
    i.sub('treasure-pile', { lx: -1, lz: 4 }); i.sub('chest', { lx: 2, lz: 5, loot: true, yaw: 0.4 }); i.sub('barrel', { lx: 4, lz: 2, count: 2, spread: 1 }); i.sub('powder-keg', { lx: 5.2, lz: 4 }); i.sub('cannon', { lx: -4, lz: 3, yaw: PI * 0.75 });
    scat(i, [{ name: 'cannon-ball', x: -3.2, z: 4.4 }, { name: 'cannon-ball', x: -2.8, z: 4.8 }, { name: 'crate', x: 8.5, z: 3, yaw: 0.2 }, { name: 'flag-pirate', x: -9.5, z: -1 }], {});
    i.sub('pirate', { lx: 0, lz: 2 }); i.sub('pirate', { lx: -3, lz: 7 }); i.sub('pirate', { lx: 4, lz: 8 });
  } });

  // ================================================================ NEW SCENARIOS
  def('haunted-graveyard', 'night-black cemetery: crooked dead trees, a crypt, rows of leaning headstones and crosses behind an iron fence, glowing jack-o-lanterns, candles, creeping fog; skeletons, a zombie and a wraith rise as you approach (skeletons: 5)', 'skeletons', ['haunted cemetery', 'spooky graveyard', 'halloween graveyard', 'cursed graveyard', 'undead cemetery', 'graveyard at night', 'zombie graveyard'], (i, o) => {
    const W = 16, D = 14, items = [], stones = [], graves = [], lamps = [];
    items.push(...fenceItems(W, D, 3.4));
    for (let k = 0; k < 20; k++) {
      const gx = -W / 2 + 1.6 + (k % 5) * 3.2 + rand(-0.4, 0.4), gz = -D / 2 + 2 + ((k / 5) | 0) * 3 + rand(-0.4, 0.4);
      stones.push({ name: pick(GRAVESTONES), x: gx, z: gz, yaw: rand(-0.35, 0.35), scale: rand(0.8, 1.2) }); stones.push({ name: Math.random() < 0.5 ? 'grave' : 'coffin-old', x: gx, z: gz - 1.1, yaw: Math.random() < 0.5 ? 0 : PI / 2, scale: 0.5 });
      graves.push([gx, gz - 1.1]);
    }
    for (let k = 0; k < 9; k++) { const x = rand(-W / 2 + 1, W / 2 - 1), z = rand(-D / 2 + 1, D / 2 - 1); lamps.push({ name: pick(['pumpkin-orange-jackolantern', 'pumpkin-yellow-jackolantern', 'pumpkin-carved', 'pumpkin-tall-carved', 'graveyard-candle', 'skull-candle']), x, z, yaw: rand(0, TAU), scale: 1 }); }
    for (let k = 0; k < 8; k++) lamps.push({ name: pick(['bone-a', 'bone-b', 'skull', 'ribcage']), x: rand(-W / 2, W / 2), z: rand(-D / 2, D / 2), yaw: rand(0, TAU) });
    scat(i, items, { breakable: IRON_B, solid: () => ({ inset: 0.98 }) }); scat(i, stones, { breakable: (s) => (/grave$|coffin/.test(s.name) ? null : stoneB(55)), solid: (s) => (/gravestone|^cross/.test(s.name) ? { inset: 0.9 } : null) }); scat(i, lamps, {});
    i.sub('crypt', { lx: 0, lz: -D / 2 - 4.5, yaw: 0 }); i.sub('crypt', { lx: -11, lz: -D / 2 - 1, yaw: 0.4, style: 'small' }); i.sub('crypt', { lx: 11, lz: -D / 2 - 1, yaw: -0.4, style: 'small' });
    for (const [x, z] of [[-8, 5], [8.5, -3], [-7, -8], [10, 7]]) i.sub('dead-tree', { lx: x, lz: z, scale: rand(1.1, 1.5) });
    i.sub('fog-bank', { x: i.x, z: i.z, density: 0.014, radius: 14 }); i.sub('torch-stand', { lx: -2.4, lz: D / 2 + 1 }); i.sub('torch-stand', { lx: 2.4, lz: D / 2 + 1 });
    i.sub('zombie', { lx: -4, lz: 2 }); i.sub('wraith', { lx: 3, lz: -6 });
    graveRise(i, dn(clamp(Math.floor(o.skeletons ?? 5), 0, 12)), W * 0.55 + 3, graves);
  }, { size: 14, distance: 20, face: 'player' });

  def('harbour', 'little harbour: a stone quay and wooden pier on a patch of calm water with a moored galleon and rowboats, a lighthouse, warehouses, crates, barrels and cannonballs on the quay, fishermen and a tavern', 'none', ['harbor', 'port', 'seaport', 'fishing harbour', 'docks and ships', 'marina', 'quayside', 'wharf town', 'fishing village'], (i, o) => {
    const b = H.mk();
    b.box(0, -0.3, 6, 34, 0.7, 12, 0x8a8680); b.box(0, 0.08, 6, 34.4, 0.12, 12.4, 0x9a968e);
    i.add(b.build());
    const wb = H.mk(); wb.mode('ghost'); wb.box(0, 0, 0, 1, 0.04, 1, 0x3a9ac0); const w = wb.build({ own: true }); w.scale.set(36, 1, 26); w.position.set(0, -0.12, -14); i.add(w);
    i.tick((dt, t) => { w.position.y = -0.12 + Math.sin(t * 0.7) * 0.03; });
    i.sub('ship', { lx: -8, lz: -10, yaw: PI / 2 + 0.1, style: 'merchant', size: 'large', noPush: true }); i.sub('ship', { lx: 10, lz: -13, yaw: PI / 2 - 0.15, style: 'pirate', size: 'small', noPush: true });
    i.sub('dock', { lx: 2, lz: 0, yaw: PI, length: 9 }); i.sub('rowboat', { lx: 5.5, lz: -4, yaw: 1.4, size: 'large' }); i.sub('rowboat', { lx: -3.5, lz: -3, yaw: 0.5, size: 'small' });
    i.sub('lighthouse', { lx: 17, lz: -2, yaw: 0 }); i.sub('tavern', { lx: -11, lz: 10, yaw: 0.2 }); i.sub('lumber-mill', { lx: 6, lz: 14, yaw: 0 }); i.sub('bazaar', { lx: -2, lz: 16, yaw: 0.1 });
    scat(i, [
      { name: 'crates-stacked', x: -4, z: 4, yaw: 0.4 }, { name: 'crates-stacked', x: -2.6, z: 5.2, yaw: 1.1 }, { name: 'barrel-large', x: 0.5, z: 5, yaw: 0 }, { name: 'barrel-large', x: 1.8, z: 4.6, yaw: 1 }, { name: 'box-large', x: 8, z: 4, yaw: 0.3 }, { name: 'sack', x: 9, z: 5 },
      { name: 'cannon-ball', x: 10.4, z: 6 }, { name: 'cannon-ball', x: 10.7, z: 6.5 }, { name: 'cannon-ball', x: 10.0, z: 6.6 }, { name: 'wheelbarrow', x: 4, z: 8, yaw: 2 }, { name: 'stairs-stone', x: 14, z: 0.5 },
    ], { breakable: (s) => ({ material: 'wood', hp: 20, colors: WOOD_B }) });
    i.sub('villager', { lx: 3, lz: 6 }); i.sub('villager', { lx: -6, lz: 7 }); i.sub('cat', { lx: 0, lz: 7 }); i.sub('crow-flock', { x: i.x + 6, z: i.z + 9, kind: 'gull', count: 5 });
  }, { size: 22, distance: 32, face: 'player' });

  def('castle-courtyard', 'walled castle courtyard: a gatehouse with doors, wall runs and four corner towers around a cobbled yard with a well, a statue, training dummies, archery targets, a weapon rack, banners and torches, knights on guard, and the great keep behind', 'none', ['courtyard', 'castle yard', 'fort', 'castle grounds', 'keep and walls', 'fortress yard', 'castle interior', 'bailey'], (i, o) => {
    const S = 13; // half-size of the yard
    pathMesh(i, [[[0, S - 1], [0, -S + 1]], [[-S + 1, 0], [S - 1, 0]], [[-6, 6], [6, 6]], [[-6, -6], [6, -6]], [[-6, -6], [-6, 6]], [[6, -6], [6, 6]]], 3, 0x9a968e);
    i.sub('gate', { lx: 0, lz: S, yaw: 0 });
    i.sub('wall-segment', { lx: -S / 2 - 3, lz: S, length: 8.5, yaw: 0 }); i.sub('wall-segment', { lx: S / 2 + 3, lz: S, length: 8.5, yaw: 0 });
    i.sub('wall-segment', { lx: 0, lz: -S, length: 2 * S - 6, yaw: 0 });
    i.sub('wall-segment', { lx: -S, lz: 0, length: 2 * S - 6, yaw: PI / 2 }); i.sub('wall-segment', { lx: S, lz: 0, length: 2 * S - 6, yaw: PI / 2 });
    for (const [x, z] of [[-S, S], [S, S], [-S, -S], [S, -S]]) i.sub('castle-tower', { lx: x, lz: z, roof: false });
    i.sub('castle-keep', { lx: 0, lz: -S - 9, yaw: 0, noPush: true });
    i.sub('well', { lx: 0, lz: 2 }); i.sub('statue', { lx: -6, lz: 3, style: 'knight' }); i.sub('training-dummy', { lx: 6, lz: 4 }); i.sub('training-dummy', { lx: 8.5, lz: 6 }); i.sub('archery-target', { lx: 8, lz: -5, yaw: PI }); i.sub('weapon-rack', { lx: 5, lz: -8 });
    for (const [x, z] of [[-4, 9], [4, 9], [-8, -2], [8, -2]]) i.sub('torch-stand', { lx: x, lz: z });
    i.sub('knight', { lx: -3, lz: 6, follow: null, wander: 2 }); i.sub('knight', { lx: 3, lz: 6, follow: null, wander: 2 }); i.sub('archer', { lx: -9, lz: 0, follow: null, wander: 0 });
    scat(i, [
      { name: 'banner-red', x: -S + 1.4, z: -6, yaw: PI / 2, y: 1.5, scale: 1.3 }, { name: 'banner-red', x: -S + 1.4, z: 2, yaw: PI / 2, y: 1.5, scale: 1.3 }, { name: 'banner-blue', x: S - 1.4, z: -6, yaw: -PI / 2, y: 1.5, scale: 1.3 }, { name: 'banner-blue', x: S - 1.4, z: 2, yaw: -PI / 2, y: 1.5, scale: 1.3 },
      { name: 'barrel-large', x: -8.5, z: 8, yaw: 0 }, { name: 'barrel-large', x: -7.2, z: 8.4, yaw: 1 }, { name: 'crates-stacked', x: 8.5, z: 8.5, yaw: 0.5 }, { name: 'hay-bale', x: 10, z: -8, yaw: 0.2 }, { name: 'hay-bale', x: 11.2, z: -8.4, yaw: 0.9 }, { name: 'cart', x: -9, z: -7, yaw: 0.4 },
    ], { breakable: (s) => (/banner/.test(s.name) ? { material: 'cloth', hp: 14 } : { material: 'wood', hp: 24, colors: WOOD_B }) });
  }, { size: 20, distance: 30, face: 'player', noPush: true });

  def('dungeon-room', 'torch-lit stone dungeon chamber (10 m): flagstone floor, brick walls with a doorway, pillars, wall torches, a stair, barrels, crates, a long table, bones and a treasure chest guarded by skeletons, a zombie and a mimic', 'skeletons', ['dungeon', 'dungeon chamber', 'crypt room', 'stone room', 'dungeon cell', 'catacomb room', 'dungeon hall', 'underground room'], (i, o) => {
    const N = 3, T = 3.2, H2 = N * T / 2, items = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) items.push({ name: 'floor-tile-large', x: (c - 1) * T, z: (r - 1) * T, y: 0.02, yaw: PI / 2 * ((Math.random() * 4) | 0), noBreak: true });
    const walls = [];
    for (let k = 0; k < N; k++) {
      const x = (k - 1) * T;
      walls.push({ name: k === 1 ? 'wall-window-open' : 'wall', x, z: -H2, yaw: 0 }, { name: 'wall', x, z: -H2, yaw: 0, skip: true });
      walls.push({ name: k === 1 ? 'wall-doorway' : 'wall-arched', x, z: H2, yaw: PI }, { name: k === 1 ? 'wall-window-closed' : 'wall', x: -H2, z: x, yaw: PI / 2 }, { name: k === 1 ? 'wall-cracked' : 'wall', x: H2, z: x, yaw: -PI / 2 });
    }
    const wl = walls.filter((w) => !w.skip);
    for (const [x, z] of [[-H2, -H2], [H2, -H2], [-H2, H2], [H2, H2], [-H2, 0], [H2, 0]]) wl.push({ name: 'pillar', x, z, yaw: 0, scale: 1.0 });
    const clutter = [
      { name: 'barrel-large', x: -3.6, z: -3.4, yaw: 0 }, { name: 'barrel-small', x: -2.6, z: -3.9, yaw: 0.5 }, { name: 'crates-stacked', x: 3.6, z: -3.4, yaw: 0.2, scale: 0.8 }, { name: 'box-large', x: 2.4, z: -4, yaw: 0.6, scale: 0.7 },
      { name: 'table-long', x: 3.2, z: 0.8, yaw: PI / 2 }, { name: 'stool', x: 4.2, z: 0, yaw: 0 }, { name: 'stool', x: 4.2, z: 1.8, yaw: 1 }, { name: 'candle-lit', x: 3.2, z: 0.2, y: 1.0 }, { name: 'bed-floor', x: -3.6, z: 2.6, yaw: PI / 2 },
      { name: 'skull', x: -1.4, z: -0.6, yaw: 1 }, { name: 'bone-a', x: -0.6, z: 1.2, yaw: 2 }, { name: 'bone-b', x: 0.8, z: -1.6, yaw: 0.4 }, { name: 'ribcage', x: -2.2, z: 0.6, yaw: 0.8 }, { name: 'rubble-large', x: -4.0, z: -0.8, yaw: 0.3, scale: 0.35 },
      { name: 'torch-mounted', x: -H2 + 0.45, z: -1.6, yaw: PI / 2, y: 1.7 }, { name: 'torch-mounted', x: H2 - 0.45, z: -1.6, yaw: -PI / 2, y: 1.7 }, { name: 'torch-mounted', x: 1.6, z: -H2 + 0.45, yaw: 0, y: 1.7 }, { name: 'torch-mounted', x: -1.6, z: H2 - 0.45, yaw: PI, y: 1.7 },
    ];
    const bset = (s) => (/floor|candle|bone|skull|ribcage|rubble|torch/.test(s.name) ? null : /wall|pillar/.test(s.name) ? stoneB(170) : { material: 'wood', hp: 30, colors: WOOD_B });
    scat(i, items, {});
    // the room is closed except the doorway in its +Z wall (two jambs, a 1.4 m opening); pillars are round
    scat(i, wl, { breakable: bset, solid: (s) => (/wall-doorway/.test(s.name) ? [{ fx: [0, 0.28], inset: 0.95 }, { fx: [0.72, 1], inset: 0.95 }] : /pillar/.test(s.name) ? { shape: 'cyl', inset: 0.9 } : /wall/.test(s.name) ? { inset: 0.95 } : null) }); scat(i, clutter, { breakable: bset });
    i.sub('chest', { lx: -3.6, lz: -1.2, loot: true, yaw: PI / 2 }); i.sub('mimic', { lx: 0.6, lz: 3.8, yaw: PI });
    i.sub('torch-stand', { lx: -3.8, lz: 3.8 }); i.sub('torch-stand', { lx: 3.8, lz: 3.8 });
    const K = dn(clamp(Math.floor(o.skeletons ?? 3), 0, 8));
    for (let k = 0; k < K; k++) i.sub(k === 2 ? 'skeleton-archer' : 'skeleton', { lx: -1.5 + k * 1.5, lz: -1 + (k % 2) * 1.6, rise: true });
    i.sub('zombie', { lx: 2.5, lz: -2 });
  }, { size: 8, distance: 14, face: 'player', noPush: true });

  def('medieval-market', 'bustling medieval market square: ten stalls in two rows, a fountain, carts, hay and barrels, hanging banners, merchants, a bard, villagers and a dog, with a grand market hall at the back', 'none', ['market square', 'town market', 'market place', 'medieval market', 'bazaar square', 'town square', 'fair', 'marketplace square'], (i, o) => {
    i.sub('fountain', { lx: 0, lz: 0, scale: 0.9 });
    for (let k = 0; k < 5; k++) { const x = -12 + k * 6; i.sub('market-stall', { lx: x, lz: 8, yaw: 0.1 * (k - 2) }); i.sub('market-stall', { lx: x, lz: -9, yaw: PI + 0.1 * (k - 2) }); }
    i.sub('bazaar', { lx: 0, lz: -19, yaw: 0, noPush: true }); i.sub('tavern', { lx: -19, lz: -2, yaw: PI / 2 + 0.2 }); i.sub('church', { lx: 19, lz: -2, yaw: -PI / 2 - 0.1 });
    const items = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; items.push({ name: k % 2 ? 'town-banner-red' : 'town-banner-green', x: Math.cos(a) * 6.5, z: Math.sin(a) * 6.5, yaw: a + PI / 2, scale: 1 }); }
    items.push({ name: 'cart', x: -6, z: 3, yaw: 0.6 }, { name: 'cart-high', x: 7, z: -4, yaw: 2.4 }, { name: 'hay-bale', x: -7.5, z: 4.4, yaw: 0.5 }, { name: 'hay-bale', x: 8.5, z: -5.6, yaw: 1.2 }, { name: 'barrel-large', x: 4.6, z: 3.2, yaw: 0 }, { name: 'barrel-large', x: -3.4, z: -3.6, yaw: 1 }, { name: 'crates-stacked', x: 10, z: 4, yaw: 0.8 }, { name: 'wheelbarrow', x: -10, z: -3.4, yaw: 0.4 });
    scat(i, items, { breakable: (s) => (/banner/.test(s.name) ? { material: 'cloth', hp: 12 } : { material: 'wood', hp: 22, colors: WOOD_B }) });
    for (let k = 0; k < 5; k++) i.sub('villager', { lx: rand(-10, 10), lz: rand(-5, 5) });
    i.sub('merchant', { lx: -4, lz: 6 }); i.sub('merchant', { lx: 5, lz: -7 }); i.sub('bard', { lx: 3, lz: 1.5 }); i.sub('dog', { lx: -2, lz: 4 }); i.sub('child', { lx: 2, lz: -3 }); i.sub('crow-flock', { x: i.x - 8, z: i.z - 4, kind: 'dove', count: 6 });
  }, { size: 22, distance: 26, face: 'player' });

  def('spooky-forest', 'dense haunted forest of twisted dead trees and orange pines in drifting fog, jack-o-lanterns, bones and mushrooms, a witch\'s hut with a bubbling cauldron, crows overhead, and wolves and zombies lurking; the nearest trees can be chopped down (count: trees, default 110)', 'count (trees), radius', ['haunted forest', 'dark forest', 'creepy forest', 'halloween forest', 'witch forest', 'dead forest', 'cursed woods', 'scary forest', 'spooky woods'], (i, o) => {
    const N = Math.max(10, Math.round(clamp(Math.floor(o.count ?? 110), 10, 300) * (0.5 + 0.5 * (H.density ? H.density() : 1)))), R = clamp(o.radius ?? 24, 12, 50), trees = [], clutter = [];
    const kinds = ['tree-dead-large', 'tree-dead-large-decorated', 'tree-dead-medium', 'tree-dead-small', 'tree-pine-orange-medium', 'tree-pine-orange-small', 'tree-dead-medium'];
    const lake = H.ctx.world.env;
    for (let k = 0; k < N; k++) {
      const a = rand(0, TAU), r = 6 + Math.sqrt(Math.random()) * (R - 6), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (lake && lake.isWater && lake.isWater(i.wx(x, z), i.wz(x, z))) continue;
      trees.push({ name: pick(kinds), x, z, yaw: rand(0, TAU), scale: rand(0.85, 1.35) });
    }
    for (let k = 0; k < 22; k++) { const a = rand(0, TAU), r = rand(3, R); clutter.push({ name: pick(['pumpkin-orange-jackolantern', 'pumpkin-yellow-jackolantern', 'pumpkin-orange-small', 'skull', 'bone-a', 'bone-c', 'ribcage', 'candle-melted', 'skull-candle', 'grave-a']), x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: rand(0, TAU) }); }
    scat(i, trees, { fell: { hp: 45 }, near: 12, range: 28 }); scat(i, clutter, {});
    i.sub('hut', { lx: -5, lz: -6, yaw: faceCenter(-5, -6) }); i.sub('cauldron', { lx: -2.6, lz: -3.2, color: 0x7affc8 }); i.sub('giant-mushroom', { lx: 4, lz: -5, color: 0x9a5cff, scale: 0.7 }); i.sub('giant-mushroom', { lx: -8, lz: 2, color: 0xd83a8a, scale: 0.5 });
    i.sub('fog-bank', { x: i.x, z: i.z, density: 0.016, radius: R }); i.sub('crow-flock', { x: i.x + 3, z: i.z + 2, count: 7 }); i.sub('fireflies', { follow: false, x: i.x, z: i.z, count: 60 });
    i.sub('lantern', { lx: 2, lz: 3 }); i.sub('torch-stand', { lx: -3, lz: -1 });
    i.sub('wolf', { lx: 9, lz: -3 }); i.sub('wolf', { lx: -10, lz: -4 }); i.sub('zombie', { lx: 6, lz: 8 }); i.sub('zombie', { lx: -7, lz: 9 });
  }, { size: 22, distance: 24, face: 'player' });
}
