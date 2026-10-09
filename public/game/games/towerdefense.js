// games/towerdefense.js - TOWER DEFENCE on a winding dirt path: enemies (library goblins / wolves / orcs / trolls, driven along the waypoints) walk to your gate.
// Grab a tower token from the table, drop it on a glowing pad (arrow / cannon / frost), same token on an own tower = upgrade. Kills pay gold, you fight too.
// Enemies are library fighters with attack 'none' (so they show health bars and emit combat:kill, brains never chase you) that this file walks along the path itself.
export const meta = {
  name: 'towerdefense', title: 'Tower Defence', aliases: ['tower defense', 'tower defence', 'td', 'defend the gate', 'defend the castle'], icon: 'ðŸ°',
  description: 'build arrow, cannon and frost towers on pads along a path and hold the gate for 8 waves; kills pay gold', hint: 'Drop tower tokens on glowing pads', distance: 0, size: 14, par: 1000, physics: true,
};

const WAYS = [[-9, -18], [-9, -11], [-2, -11], [-2, -16.5], [5, -16.5], [5, -8], [2.4, -5.4]];
const PADS = [[-5.5, -9], [-5.5, -13], [0.2, -12.6], [2.6, -14.4], [2.5, -18.7], [7.3, -12.5], [2.7, -10.3], [5.2, -5]];
const KINDS = {
  arrow: { cost: 20, range: 7, cd: 0.45, dmg: 5, color: 0x6aa84f, label: 'ARROW', fly: 0.1 },
  cannon: { cost: 45, range: 7.5, cd: 2.2, dmg: 22, color: 0xd9822b, label: 'CANNON', fly: 0.4 },
  frost: { cost: 30, range: 6, cd: 1.3, dmg: 2, color: 0x58c8ff, label: 'FROST', fly: 0.2 },
};
const BASE = { goblin: { hp: 14, speed: 2.6, gold: 4 }, wolf: { hp: 16, speed: 4.2, gold: 5 }, 'orc-brute': { hp: 70, speed: 1.9, gold: 9 }, troll: { hp: 160, speed: 1.7, gold: 14 } };
const MIX = [null, [['goblin', 6]], [['goblin', 9]], [['goblin', 6], ['wolf', 4]], [['goblin', 8], ['orc-brute', 2]], [['troll', 1], ['goblin', 6], ['wolf', 4]], [['orc-brute', 3], ['wolf', 6], ['goblin', 8]],
  [['orc-brute', 4], ['wolf', 8], ['goblin', 10]], [['troll', 2], ['orc-brute', 4], ['wolf', 8], ['goblin', 10]]];
const WAVES = 8, LIVES = 10, START_GOLD = 70;

export default function (g) {
  const { THREE } = g, W = g.world, kit = W.kit, K = g.k, ev = g.gctx.events, KS = Math.max(K, 0.8);
  const gw = (lx, lz, h = 0) => { const p = g.at(lx, 0, lz); p.y = g.groundAt(p.x, p.z) + h; return p; };
  const way = WAYS.map(([x, z]) => gw(x * K, z * K)), cum = [0];
  for (let i = 1; i < way.length; i++) cum[i] = cum[i - 1] + Math.hypot(way[i].x - way[i - 1].x, way[i].z - way[i - 1].z);
  g.boardAt(-1.3 * KS, 1.9, -3.3 * KS); g.pedestalAt(-1.8 * KS, 0.4);

  // ---- the dirt path: a vertex-coloured ribbon draped over the terrain (own geometry)
  (function ribbon() {
    const pos = [], nor = [], col = [], hw = 0.9 * Math.max(K, 0.75), C = [0x7d6340, 0xa5845a], c3 = new THREE.Color();
    const v = (x, z, c) => { pos.push(x, g.groundAt(x, z) + 0.05, z); nor.push(0, 1, 0); c3.set(C[c]); col.push(c3.r, c3.g, c3.b); };
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i], b = way[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / len, dz = (b.z - a.z) / len, px = -dz, pz = dx, n = Math.ceil(len / 0.7);
      for (let s = 0; s < n; s++) {
        const t0 = (s / n) * len - hw * 0.9 * (s === 0 ? 1 : 0), t1 = ((s + 1) / n) * len + hw * 0.9 * (s === n - 1 ? 1 : 0);
        const P = (t, o, c) => v(a.x + dx * t + px * o, a.z + dz * t + pz * o, c);
        for (const [o0, c0, o1, c1] of [[-hw, 0, 0, 1], [0, 1, hw, 0]]) { P(t0, o0, c0); P(t0, o1, c1); P(t1, o1, c1); P(t0, o0, c0); P(t1, o1, c1); P(t1, o0, c0); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, g.vcMat); m.userData.ownGeo = true; m.userData.noShadow = true; g.add(m);
  })();
  { // marker posts along both edges (the grass hides a flat ribbon at eye level)
    const b = g.builder(), hw = 0.9 * Math.max(K, 0.75) + 0.2;
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i], c = way[i + 1], len = Math.hypot(c.x - a.x, c.z - a.z), dx = (c.x - a.x) / len, dz = (c.z - a.z) / len;
      for (let s = 0.5; s < len - 0.3; s += 2.4) for (const side of [-1, 1]) {
        const x = a.x + dx * s - dz * hw * side, z = a.z + dz * s + dx * hw * side, ly = g.groundAt(x, z) - g.y;
        b.box(0.2, 0.8, 0.2, 0x8a8d96, x - g.x, ly + 0.35, z - g.z); b.box(0.26, 0.1, 0.26, 0xd9c9a0, x - g.x, ly + 0.8, z - g.z);
      }
    }
    const m = g.add(b.mesh()); m.position.set(g.x, g.y, g.z);
  }  // ---- the gate (a stone arch across the path end) with ten life gems on top
  const gate = way[way.length - 1], gdir = Math.atan2(gate.x - way[way.length - 2].x, gate.z - way[way.length - 2].z);
  { const b = g.builder(); b.box(0.5, 2.6, 0.6, 0x8a8d96, -1.15, 1.3, 0); b.box(0.5, 2.6, 0.6, 0x8a8d96, 1.15, 1.3, 0); b.box(2.8, 0.5, 0.7, 0x777a84, 0, 2.55, 0); b.box(1.8, 1.8, 0.12, 0x6a4a2a, 0, 0.95, 0.3); b.box(0.9, 0.3, 0.8, 0x5a5d66, -1.15, 2.95, 0); b.box(0.9, 0.3, 0.8, 0x5a5d66, 1.15, 2.95, 0);
    const m = g.add(b.mesh()); m.position.copy(gate); m.rotation.y = gdir; }
  const gems = [], gemOn = g.mat(0x4ae06a, { basic: true }), gemOff = g.mat(0xe0443a, { basic: true });
  for (let i = 0; i < LIVES; i++) { const m = g.add(g.box(0.14, 0.14, 0.14, 0x4ae06a, 0, 0, 0, { basic: true })); m.position.set(Math.cos(gdir) * (-1.05 + i * 0.233) + gate.x, gate.y + 2.95, -Math.sin(gdir) * (-1.05 + i * 0.233) + gate.z); gems.push(m); }
  // ---- glowing tower pads
  const padMat = new THREE.MeshBasicMaterial({ color: 0x30e0ff }), padA = new THREE.Color(0x30e0ff), padB = new THREE.Color(0xa8f4ff); g.track({ dispose: () => padMat.dispose() });
  const pads = PADS.map(([x, z]) => { const p = gw(x * K, z * K), d = g.add(g.cyl(0.6, 0.6, 0.05, 0x30e0ff, 0, 0, 0, { mat: padMat, seg: 20 })); d.position.set(p.x, p.y + 0.04, p.z); return { pos: p, disc: d, tower: null }; });
  // ---- token table: three physical tokens (grabbable from 6 m), they return to their slot when lost
  const tb = g.builder(); tb.box(1.7, 0.1, 0.62, 0x7a5a3a, 0, 0.8, 0); for (const [x, z] of [[-0.75, -0.25], [0.75, -0.25], [-0.75, 0.25], [0.75, 0.25]]) tb.box(0.1, 0.8, 0.1, 0x5a3e24, x, 0.4, z);
  const table = g.add(tb.mesh()); table.position.copy(gw(1.4 * KS, -1.3 * KS)); table.rotation.y = g.yaw; g.body(table, { type: 'fixed', shape: 'box', group: 'prop', friction: 0.6 });
  const topY = table.position.y + 0.85;
  const tokens = Object.keys(KINDS).map((kind, i) => {
    const d = KINDS[kind], home = new THREE.Vector3(), slot = g.at(1.4 * KS + (i - 1) * 0.68, 0, -1.3 * KS); home.set(slot.x, topY + 0.14, slot.z);
    const tb2 = g.builder(); tb2.sph(0.11, d.color, 0, 0, 0, 1, 10); tb2.cyl(0.115, 0.115, 0.03, 0xffffff, 0, 0, 0, 10);
    const m = tb2.mesh(); m.position.copy(home);
    const b = kit ? kit.body(g.ctx, m, { radius: 0.12, mass: 0.4, bounce: 0.15, friction: 0.6, drag: 0.1, grabbable: true, grabRange: 6, ccd: true }) : null; if (b) g.track(b);
    const label = kit?.label ? g.track(kit.label(g.ctx, `${d.label} ${d.cost}g`, { size: 0.06, position: { x: home.x, y: topY + 0.5, z: home.z } })) : null;
    return { kind, b, home, idle: 0, label, d };
  });
  const toHome = (t) => { if (!t.b || t.b.removed) return; t.b.position.copy(t.home); t.b.velocity.set(0, 0, 0); t.b.ph?.setAngularVelocity(0, 0, 0); t.idle = 0; };

  // ---- state
  let lvl = 1, lives = LIVES, gold = START_GOLD, kills = 0, cleared = 0, wave = 0, phase = 'none', prep = 0, playing = false, alive = 0, spawnT = 0, tWave = 0, fails = 0, cool = 0, lastStat = '';
  const en = [], towers = [], queue = [], _c = new THREE.Vector3(), HIT = { from: 'friendly', kind: 'blunt', force: 3 };
  const lib = () => W.library;
  const score = () => cleared * 100 + lives * 20 + kills;
  const say = (at, txt, color) => g.float(at, txt, color);
  function status(force) {
    const s = phase === 'prep' ? `Wave ${wave + 1} in ${Math.ceil(prep)}s   Gold ${gold}` : `Gold ${gold}   Lives ${lives}   Wave ${wave}/${WAVES}`;
    if (s !== lastStat || force) { lastStat = s; g.status(s); }
  }
  const sync = () => { g.setScore(score()); gems.forEach((m, i) => { m.material = i < lives ? gemOn : gemOff; }); status(true); };

  // ---- towers
  function buildTower(pad, kind) {
    const d = KINDS[kind], p = pad.pos, b = g.builder(); b.cyl(0.38, 0.46, 1.3, 0x8d8a82, 0, 0.65, 0, 10); b.cyl(0.52, 0.44, 0.14, 0x6a5a46, 0, 1.37, 0, 10);
    const base = g.round(b.mesh()); base.position.copy(p);
    const h = g.builder();
    if (kind === 'arrow') { h.box(0.5, 0.3, 0.5, 0x7a5230, 0, 0, 0); h.box(0.9, 0.06, 0.08, d.color, 0, 0.06, 0.28); h.box(0.06, 0.06, 0.8, 0x3a2a1a, 0, 0.06, 0.3); }
    else if (kind === 'cannon') { h.sph(0.32, 0x3a3d46, 0, 0, 0, 1, 10); h.cyl(0.17, 0.2, 0.85, 0x23252b, 0, 0.04, 0.4, 10, Math.PI / 2); }
    else { h.cone(0.3, 0.8, d.color, 0, 0.3, 0, 6); h.cone(0.22, 0.55, 0xc8f0ff, 0, -0.1, 0, 6, Math.PI); }
    const head = g.round(h.mesh()); head.position.set(p.x, p.y + 1.62, p.z);
    const bolt = g.round(kind === 'cannon' ? g.sph(0.13, 0x222222, 0, 0, 0, { basic: true }) : g.box(0.05, 0.05, 0.4, d.color, 0, 0, 0, { basic: true })); bolt.visible = false;
    return { kind, d, pad, x: p.x, y: p.y + 1.7, z: p.z, lvl: 1, cd: 0.5, head, bolt, bt: -1, tgt: null, from: new THREE.Vector3(), to: new THREE.Vector3(), rings: [] };
  }
  const stat = (tw, k) => (k === 'dmg' ? tw.d.dmg * 1.5 ** (tw.lvl - 1) : k === 'cd' ? tw.d.cd * 0.88 ** (tw.lvl - 1) : tw.d.range + 0.5 * (tw.lvl - 1));
  function place(tk, pad) {
    const d = tk.d, tw = pad.tower;
    if (!tw) {
      if (gold < d.cost) return deny(tk, `Need ${d.cost}g`);
      gold -= d.cost; pad.tower = buildTower(pad, tk.kind); towers.push(pad.tower); pad.disc.visible = false; say(pad.pos, `${d.label} TOWER`, d.color);
    } else if (tw.kind === tk.kind && tw.lvl < 3) {
      const up = Math.round(d.cost * 0.9 * tw.lvl); if (gold < up) return deny(tk, `Upgrade ${up}g`);
      gold -= up; tw.lvl++; const r = g.round(g.cyl(0.55, 0.55, 0.05, 0xe8c040, 0, 0, 0, { basic: true })); r.position.set(tw.x, tw.pad.pos.y + 0.3 * tw.lvl, tw.z); say(pad.pos, `LEVEL ${tw.lvl}`, 0xe8c040);
    } else return deny(tk, tw.kind === tk.kind ? 'Max level' : 'Pad taken');
    g.pop(pad.pos, 20, 'spark'); g.sfx('big', pad.pos, 0.6); g.pulse('both', 0.5, 80); toHome(tk); sync();
  }
  function deny(tk, txt) { say(tk.b.position, txt, 0xff7a6b); g.sfx('miss', tk.b.position, 0.7); toHome(tk); }
  function stepTowers(dt) {
    for (const tw of towers) {
      if (tw.bt >= 0) { // the shot in flight
        tw.bt += dt; const u = Math.min(1, tw.bt / tw.d.fly); tw.bolt.position.lerpVectors(tw.from, tw.to, u); if (tw.kind === 'cannon') tw.bolt.position.y += Math.sin(u * Math.PI) * 1.2;
        if (u >= 1) { tw.bt = -1; tw.bolt.visible = false; land(tw); }
      }
      tw.cd -= dt; if (tw.cd > 0 || tw.bt >= 0) continue;
      const rg = stat(tw, 'range'); let best = null, bp = -1;
      for (const r of en) { if (r.dead) continue; const p = r.a.position, dx = p.x - tw.x, dz = p.z - tw.z; if (dx * dx + dz * dz <= rg * rg && r.prog > bp) { bp = r.prog; best = r; } }
      if (!best) continue;
      tw.tgt = best; best.f.damage.center(tw.to); tw.head.rotation.y = Math.atan2(tw.to.x - tw.x, tw.to.z - tw.z);
      tw.from.set(tw.x, tw.y, tw.z); tw.bolt.position.copy(tw.from); tw.bolt.visible = true; tw.bolt.lookAt(tw.to); tw.bt = 0; tw.cd = stat(tw, 'cd');
      g.sfx(tw.kind === 'cannon' ? 'thud' : 'whoosh', tw.from, tw.kind === 'cannon' ? 0.5 : 0.25);
    }
  }
  function land(tw) {
    const r = tw.tgt, dmg = stat(tw, 'dmg'); if (r && !r.dead) r.f.damage.center(tw.to);
    if (tw.kind === 'arrow') { if (r && !r.dead) r.f.damage.hit(dmg, tw.to, 'friendly', undefined, 'pierce'); return; }
    HIT.kind = tw.kind === 'cannon' ? 'blunt' : 'frost'; HIT.force = tw.kind === 'cannon' ? 3 : 0;
    kit.hit(tw.to, tw.kind === 'cannon' ? 1.7 : 2.0, dmg, HIT);
    if (tw.kind === 'cannon') { g.pop(tw.to, 12, 'puff'); g.sfx('boom', tw.to, 0.4); } else { g.pop(tw.to, 14, 'spark'); for (const e of en) { const p = e.a.position, dx = p.x - tw.to.x, dz = p.z - tw.to.z; if (!e.dead && dx * dx + dz * dz < 5) e.slowT = 2.5; } }
  }

  // ---- enemies
  function spawnOne(name) {
    const L = lib(), b = BASE[name], boss = name === 'troll' && wave === 5, hp = Math.round(b.hp * (1 + 0.12 * (wave - 1)) * (1 + 0.1 * (lvl - 1)) * (boss ? 2.4 : 1));
    const h = L?.has?.(name) ? g.spawn(name, { x: way[0].x, z: way[0].z, noPush: true, attack: 'none', wander: 0, leash: 1e5, hp, speed: b.speed, drops: [], yaw: Math.atan2(way[1].x - way[0].x, way[1].z - way[0].z) }) : null;
    const f = h?.fighters[0], a = h?.actors[0]; if (!f || !a) { h?.remove(); return false; }
    const r = { h, f, a, name, wp: 1, speed: b.speed, gold: boss ? 50 : b.gold, boss, dead: false, rm: 0, slowT: 0, slowed: false, prog: 0, lastProg: 0, stuck: 0, nextT: 0 };
    f.tdRec = r; en.push(r); alive++; a.walkTo(way[1].x, way[1].z); return true;
  }
  function leak(r) {
    r.dead = true; r.rm = 0; alive--; lives = Math.max(0, lives - (r.boss ? 3 : 1)); say(gate.clone().setY(gate.y + 3.3), r.boss ? '-3' : '-1', 0xff7a6b); g.sfx('miss', gate, 0.9); g.pop(gate, 10, 'puff'); g.pulse('both', 0.6, 120); sync();
    r.h.remove();
  }
  function stepEnemies(dt) {
    for (let i = en.length - 1; i >= 0; i--) {
      const r = en[i], a = r.a;
      if (r.dead) { if ((r.rm -= dt) <= 0) { r.h.remove(); en[i] = en[en.length - 1]; en.pop(); } continue; }
      if (a.removed || r.f.removed) { r.dead = true; alive--; r.rm = 0; continue; }
      r.f.tgt = null; r.f.forced = false; // a hit sets the fighter's target to the player; this is a path walker, not a hunter
      const w = way[r.wp], dx = w.x - a.position.x, dz = w.z - a.position.z, d = Math.hypot(dx, dz);
      if (d < 0.9) { r.wp++; r.nextT = 0; if (r.wp >= way.length) { leak(r); continue; } }
      if ((r.nextT -= dt) <= 0) { r.nextT = 0.5; a.walkTo(way[r.wp].x, way[r.wp].z); }
      if (r.slowT > 0) { r.slowT -= dt; if (!r.slowed) { r.slowed = true; a.setSpeed(r.speed * 0.45); } } else if (r.slowed) { r.slowed = false; a.setSpeed(r.speed); }
      r.prog = cum[r.wp] - d;
      if (r.prog > r.lastProg + 0.05) { r.lastProg = r.prog; r.stuck = 0; } else if ((r.stuck += dt) > 6) { r.stuck = 0; r.wp++; if (r.wp >= way.length) leak(r); }
    }
  }
  const offKill = ev?.on?.('combat:kill', (e) => {
    const r = e && e.victim && e.victim.tdRec; if (!playing || !r || r.dead) return;
    r.dead = true; r.rm = 5; alive--; kills++; gold += r.gold; const p = r.a.position; say(p, `+${r.gold}g`, 0xffd23a); g.sfx('coin', p, 0.4); sync();
  });

  // ---- waves
  function startWave() {
    wave++; tWave = 0; phase = 'wave'; spawnT = 0.5; queue.length = 0;
    const m = 1 + 0.1 * (lvl - 1); for (const [n, c] of MIX[wave]) for (let i = 0; i < Math.round(c * m); i++) queue.push(n);
    for (let i = queue.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [queue[i], queue[j]] = [queue[j], queue[i]]; } // shuffle, boss last
    if (wave === 5) { queue.splice(queue.indexOf('troll'), 1); queue.push('troll'); }
    g.headline(`WAVE ${wave}`); say(g.at(0, 2.4, -2.5), wave === 5 ? 'BOSS WAVE 5' : `WAVE ${wave}`, wave === 5 ? 0xff7a6b : 0xffe27a); g.sfx(wave === 5 ? 'boom' : 'big');
    if (wave === 5) g.note('Wave 5 brings a troll chieftain with triple gate damage.', true); sync();
  }
  function finish(win) {
    const s = score(); playing = false;
    g.note(win ? `The gate held through ${WAVES} waves with ${lives} lives left.` : `The gate fell in wave ${wave}.`, true);
    g.end({ score: s, rating: s / meta.par, text: win ? 'GATE HELD' : 'GATE FELL', detail: `${cleared} waves, ${lives} lives, ${kills} kills` });
  }

  return {
    reset(level) {
      lvl = level; lives = LIVES; gold = START_GOLD; kills = cleared = wave = alive = 0; phase = 'none'; playing = false; en.length = 0; towers.length = 0; queue.length = 0; lastStat = '';
      for (const p of pads) { p.tower = null; p.disc.visible = true; } for (const t of tokens) toHome(t);
      gems.forEach((m) => { m.material = gemOn; }); g.headline('');
    },
    play() { playing = true; phase = 'prep'; prep = 15; g.give('sword'); g.headline('PREPARE'); sync(); },
    update(dt, t) {
      cool -= dt; padMat.color.copy(padA).lerp(padB, 0.5 + 0.5 * Math.sin(t * 4));
      stepEnemies(dt); stepTowers(dt);
      for (const tk of tokens) { // drop a token near a pad: place / upgrade / bounce home
        const b = tk.b; if (!b || b.removed) continue;
        if (b.held) { tk.idle = 0; continue; }
        const p = b.position;
        if (p.y < g.y - 4) { toHome(tk); continue; }
        for (const pad of pads) { const dx = p.x - pad.pos.x, dz = p.z - pad.pos.z; if (dx * dx + dz * dz < 0.49 && p.y < pad.pos.y + 1.6 && cool <= 0) { cool = 0.5; place(tk, pad); break; } }
        const dh = Math.hypot(p.x - tk.home.x, p.z - tk.home.z); tk.idle = dh > 0.35 && b.velocity.lengthSq() < 0.09 ? tk.idle + dt : 0; if (tk.idle > 4) toHome(tk);
      }
      if (phase === 'prep') { prep -= dt; status(); if (prep <= 0) startWave(); } else if (phase === 'wave') {
        tWave += dt; spawnT -= dt;
        if (queue.length && spawnT <= 0) { const n = queue[0]; if (spawnOne(n)) { queue.shift(); fails = 0; spawnT = n === 'wolf' ? 0.7 : 1.0; } else { spawnT = 0.6; if (++fails > 12) { queue.shift(); fails = 0; } } }
        if (lives <= 0) { finish(false); return; }
        if (!queue.length && alive <= 0) {
          cleared++; const bonus = 15 + 5 * wave; gold += bonus; say(g.at(0, 2.2, -2.5), `WAVE ${wave} CLEARED  +${bonus}g`, 0x7fe3a0); g.sfx('win'); sync();
          if (wave >= WAVES) { finish(true); return; }
          phase = 'prep'; prep = 10; g.headline('PREPARE');
        } else if (tWave > 150 + 10 * wave) for (const r of en) if (!r.dead) { r.wp = way.length; leak(r); } // soft-lock guard: anything still walking after 2.5 min reaches the gate
      }
    },
    idle(dt, t) { for (const tk of tokens) { const b = tk.b; if (b && !b.removed && !b.held) { const p = b.position; if (p.y < g.y - 4) toHome(tk); tk.idle = Math.hypot(p.x - tk.home.x, p.z - tk.home.z) > 0.35 && b.velocity.lengthSq() < 0.09 ? tk.idle + dt : 0; if (tk.idle > 4) toHome(tk); } } },
    stop() { playing = false; phase = 'none'; },
    dispose() { playing = false; try { offKill?.(); } catch (err) { /* gone */ } },
    info: { get lives() { return lives; }, get gold() { return gold; }, set gold(v) { gold = v; }, get kills() { return kills; }, get wave() { return wave; }, get cleared() { return cleared; }, get phase() { return phase; }, get en() { return en; }, get towers() { return towers; }, pads, tokens, way, place, get alive() { return alive; } },
  };
}



