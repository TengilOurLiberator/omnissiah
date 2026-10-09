// games/whack.js - Whack-a-Goblin: seven barrels in an arc around you, goblins pop out of them. Hit them with ANYTHING: the wooden mallet you are handed, a sword, a spell, a thrown thing
// (all go through kit.damageable) or a bare fast fist. Golden goblin = 50, villager = -30 (do not hit), fast successive hits build a combo up to x4. 45 s.
export const meta = {
  name: 'whack', title: 'Whack-a-Goblin', aliases: ['whack a goblin', 'whack-a-mole', 'whack a mole', 'whackamole', 'mole', 'goblin whack', 'smash the goblins', 'hammer game', 'bonk'], icon: '🔨',
  description: 'goblins pop out of barrels: whack them with a mallet, a sword, a spell or your fist; golden ones are worth more, spare the villager', hint: 'Whack the goblins! Spare the villager. Gold = 50', distance: 0, size: 5, par: 520, physics: false,
};

const ROUND = 45, N = 7, TOP = 0.82, RISE = 0.18, SINK = 0.2;
const hammerSpec = (THREE) => ({
  kind: 'melee', damage: 22, reach: 0.62, material: 'wood', trailColor: 0xe0b070, hitRadius: 0.2, vMin: 1.2, vFull: 3.6, hitCooldown: 0.18, mass: 1.4, throw: 'spin', throwDamage: 12, rest: 'flat',
  points: [[0, 0, -0.38], [0, 0, -0.52], [0.1, 0, -0.52], [-0.1, 0, -0.52]], trail: [[0, 0, -0.3], [0, 0, -0.55]], grip: { position: [0, 0, 0.05] },
  build() {
    const g = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x8a5a30 }), dark = new THREE.MeshLambertMaterial({ color: 0x5a3a1e }), iron = new THREE.MeshLambertMaterial({ color: 0x70747c });
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.56, 8), wood); h.rotation.x = Math.PI / 2; h.position.z = -0.27; g.add(h);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.26, 12), dark); head.rotation.z = Math.PI / 2; head.position.z = -0.54; g.add(head);
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 12), iron); b.rotation.z = Math.PI / 2; b.position.set(s * 0.1, 0, -0.54); g.add(b); }
    return g;
  },
});

export default function (g) {
  const { THREE } = g, kit = g.world.kit, Wp = g.world.weapons, K = g.k;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const _a = new THREE.Vector3(), _c = new THREE.Vector3(), HITO = { kind: 'blunt', hand: undefined };
  const R = 0.5 + 0.5 * K;
  g.pedestalAt(R + 0.9, 0.5); g.boardAt(0, 1.75, -(R + 1.5));

  // ---- goblin / golden goblin / villager: three vertex-coloured shapes, shared by the seven pooled meshes
  function person(skin, shirt, o = {}) {
    const b = g.builder();
    b.cyl(0.1, 0.125, 0.3, shirt, 0, 0.15, 0, 8); b.sph(0.16, skin, 0, 0.44, 0, 0.92, 10);
    for (const s of [-1, 1]) {
      if (o.ears) b.cone(0.05, 0.2, skin, s * 0.2, 0.48, 0, 5, 0, 0, -s * Math.PI / 2 * 1.15);
      b.sph(0.038, 0xffffff, s * 0.062, 0.47, 0.12, 1, 6); b.sph(0.02, o.angry ? 0xc01010 : 0x101010, s * 0.062, 0.47, 0.152, 1, 5);
    }
    b.cone(0.03, 0.09, o.nose ?? skin, 0, 0.42, 0.16, 5, Math.PI / 2); b.box(0.09, 0.02, 0.02, 0x501818, 0, 0.36, 0.148);
    if (o.crown) { b.cyl(0.1, 0.085, 0.07, 0xfff0a0, 0, 0.62, 0, 8); for (let i = 0; i < 5; i++) b.cone(0.022, 0.06, 0xfff0a0, Math.cos(i * 1.257) * 0.095, 0.68, Math.sin(i * 1.257) * 0.095, 4); }
    if (o.hat) { b.cyl(0.24, 0.24, 0.02, 0x6a4a2a, 0, 0.55, 0, 12); b.cyl(0.1, 0.12, 0.12, 0x6a4a2a, 0, 0.62, 0, 10); b.cyl(0.12, 0.12, 0.03, 0xc03030, 0, 0.58, 0, 10); }
    return b.mesh();
  }
  const protos = { goblin: person(0x5fae3c, 0x6a4a2a, { ears: true, angry: true, nose: 0x4a8a2a }), gold: person(0xffc820, 0xd8a010, { ears: true, crown: true, nose: 0xe0a810 }), villager: person(0xe8b890, 0x3a6ac8, { hat: true, nose: 0xd8a078 }) };
  g.track({ dispose() { for (const k of Object.keys(protos)) protos[k].geometry.dispose(); } });

  // ---- the seven barrels
  const holes = [];
  for (let i = 0; i < N; i++) {
    const th = (i - (N - 1) / 2) * (Math.PI / 6), lx = R * Math.sin(th), lz = -R * Math.cos(th), gh = g.ground(lx, lz), H = Math.max(0.3, g.y + TOP - gh);
    const b = g.builder(); b.cyl(0.25, 0.21, H + 0.3, 0x7a5230, 0, H / 2 - 0.15, 0, 12); b.cyl(0.255, 0.255, 0.04, 0x3a3a40, 0, H * 0.25, 0, 12); b.cyl(0.255, 0.255, 0.04, 0x3a3a40, 0, H * 0.75, 0, 12); b.cyl(0.18, 0.18, 0.006, 0x120d09, 0, H + 0.003, 0, 12);
    const barrel = g.add(b.mesh()); barrel.position.copy(g.at(lx, 0, lz)); barrel.position.y = gh; barrel.userData.noShadow = true;
    const m = new THREE.Mesh(protos.goblin.geometry, g.vcMat); m.visible = false; m.userData.noShadow = true; g.add(m);
    const h = { i, lx, lz, topY: g.y + TOP, m, d: null, kind: 'goblin', state: 'empty', t: 0, upT: 1, cool: 0, face: Math.atan2(-lx, -lz) + g.yaw, e: 0, sq: 0 };
    m.position.copy(g.at(lx, 0, lz)); m.rotation.y = h.face;
    if (kit) { h.d = kit.damageable(g.ctx, m, { hp: 1e9, radius: 0.24, offsetY: 0.42, faction: 'neutral', flash: false, onHit: (e) => whack(h, e) }); if (h.d) { h.d.alive = false; g.track(h.d); } }
    holes.push(h);
  }
  // ---- the mallet (a custom weapon type; the player is only handed it when he holds nothing)
  let undoDef = null, mallet = null;
  if (Wp && Wp.define) undoDef = Wp.define('whack-hammer', hammerSpec(THREE));

  // ---- state
  let lvl = 1, chain = 0, lastHit = -9, nextSpawn = 0, hits = 0, golds = 0, oops = 0, pops = 0, playing = false, idleT = 2;
  const events = []; // raw log for the tests
  const mult = () => Math.min(4, 1 + Math.floor(chain / 3));
  const upTime = (k) => Math.max(0.55, 1.65 - 0.2 * lvl) * (k === 'gold' ? 0.7 : 1);
  function spawn(h, kind, live) {
    h.kind = kind; h.state = 'rising'; h.t = 0; h.upT = upTime(kind); h.sq = 0; h.live = live; h.m.geometry = protos[kind === 'villager' ? 'villager' : kind === 'gold' ? 'gold' : 'goblin'].geometry;
    h.m.visible = true; h.m.scale.set(1, 1, 1); pops++;
    g.at(h.lx, TOP, h.lz, _a); g.pop(_a, 5, 'puff'); g.sfx(kind === 'gold' ? 'bell' : 'whoosh', _a, kind === 'gold' ? 0.5 : 0.25);
    if (kind === 'gold') g.pop(_a, 12, 'spark');
  }
  function whack(h, e) {
    if (h.state !== 'up' && h.state !== 'rising') return;
    if (!h.live || !playing || g.state !== 'play') return;
    const hand = h.d.lastHit?.hand ?? e.hand;
    h.state = 'smash'; h.t = 0; h.d.alive = false; h.m.getWorldPosition(_a); _a.y += 0.55; const at = _a;
    g.pulse(hand ?? 'both', 0.9, 80); g.sfx('thud', at, 1);
    if (h.kind === 'villager') {
      oops++; chain = 0; const pen = Math.min(30, Math.max(0, g.score)); events.push({ t: 'villager', pen: 30 });
      g.addScore(-pen, at, 'OOPS -30', 0xff7a6b); g.pop(at, 10, 'puff'); g.status('Not the villager!');
    } else {
      const now = g.time; chain = now - lastHit < 1.4 ? chain + 1 : 0; lastHit = now; const mu = mult();
      const base = h.kind === 'gold' ? 50 : 10, pts = base * mu; hits++; if (h.kind === 'gold') golds++;
      events.push({ t: h.kind, mult: mu, pts, chain }); g.addScore(pts, at, (h.kind === 'gold' ? 'GOLD +' : '+') + pts + (mu > 1 ? ' x' + mu : ''), h.kind === 'gold' ? 0xffd23a : undefined);
      if (h.kind === 'gold') { g.pop(at, 40, 'confetti'); g.sfx('big', at, 0.8); } else g.pop(at, 6, 'spark');
      if (mu > 1 && chain % 3 === 0) g.sfx('cheer', at, 0.5);
      g.status(mu > 1 ? 'Combo x' + mu : '');
    }
  }
  function animate(dt) {
    for (const h of holes) {
      if (h.state === 'empty') continue;
      h.t += dt;
      if (h.state === 'rising') { h.e = clamp(h.t / RISE, 0, 1); if (h.t >= RISE) { h.state = 'up'; h.t = 0; } if (h.live && h.e > 0.5) h.d.alive = true; }
      else if (h.state === 'up') { h.e = 1; if (h.t >= h.upT) { h.state = 'sinking'; h.t = 0; h.d.alive = false; } }
      else if (h.state === 'sinking') { h.e = 1 - clamp(h.t / SINK, 0, 1); if (h.t >= SINK) { h.state = 'empty'; h.m.visible = false; h.cool = 0.3; } }
      else if (h.state === 'smash') { const k = clamp(h.t / 0.3, 0, 1); h.sq = k < 0.4 ? k / 0.4 : 1; h.e = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6; if (h.t >= 0.3) { h.state = 'empty'; h.m.visible = false; h.cool = 0.3; h.e = 0; } }
      const e = 1 - (1 - h.e) * (1 - h.e), sy = 1 - 0.65 * h.sq, sxz = 1 + 0.4 * h.sq;
      h.m.scale.set(sxz, sy, sxz); g.at(h.lx, 0, h.lz, _a); h.m.position.set(_a.x, h.topY - 0.5 + 0.46 * e, _a.z);
      if (h.d) h.d.offsetY = 0.42 * sy;
    }
  }
  function fists() { // a bare fist: a fast hand into a goblin counts
    for (const hd of g.hands) {
      if (!hd.ok || hd.speed < 2.2 || g.heldType(hd.name)) continue;
      for (const h of holes) {
        if (h.state !== 'up' && h.state !== 'rising') continue;
        if (!h.live || h.cool > 0 || !h.d || !h.d.alive) continue;
        h.d.center(_c); if (_c.distanceToSquared(hd.pos) < 0.3 * 0.3) { HITO.hand = hd.name; h.d.hit(10, hd.pos, 'player', null, HITO); }
      }
    }
  }
  function giveMallet() {
    if (!Wp || (mallet && !mallet.body.removed)) return;
    const hl = g.heldType('left'), hr = g.heldType('right');
    if (!hl && !hr) { mallet = g.give(undoDef ? 'whack-hammer' : 'club'); if (mallet) g.status('Whack them! Spare the villager'); }
  }

  return {
    reset(level) {
      lvl = level; chain = 0; lastHit = -9; hits = golds = oops = pops = 0; playing = false; mallet = null; events.length = 0; nextSpawn = 0.5; idleT = 2;
      for (const h of holes) { h.state = 'empty'; h.m.visible = false; h.e = 0; h.sq = 0; h.cool = 0; if (h.d) h.d.alive = false; }
      g.status('');
    },
    play(level) {
      lvl = level; playing = true; g.setTime(ROUND); nextSpawn = 0.6; giveMallet();
      g.every(1, () => { if (!mallet || mallet.body.removed) giveMallet(); });
    },
    update(dt) {
      for (const h of holes) h.cool -= dt;
      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        nextSpawn = Math.max(0.35, 1.0 - 0.13 * lvl) * (0.7 + Math.random() * 0.6);
        let up = 0; for (const h of holes) if (h.state !== 'empty') up++;
        const free = holes.filter((h) => h.state === 'empty' && h.cool <= 0);
        if (free.length && up < 2 + (lvl >= 3 ? 1 : 0) + (lvl >= 5 ? 1 : 0)) {
          const r = Math.random(), kind = r < 0.08 ? 'gold' : r < 0.08 + 0.1 + 0.03 * lvl ? 'villager' : 'goblin';
          spawn(free[(Math.random() * free.length) | 0], kind, true);
        }
      }
      animate(dt); fists();
      if (g.timeLeft <= 0) { playing = false; g.end({ score: g.score, detail: `${hits} whacks, ${golds} gold, ${oops} oops` }); }
    },
    idle(dt) { // an inviting goblin peeks out now and then (harmless: cannot be hit)
      idleT -= dt; for (const h of holes) h.cool -= dt;
      if (idleT <= 0 && !holes.some((h) => h.state !== 'empty')) { idleT = 2.5 + Math.random() * 2; const h = holes[(Math.random() * N) | 0]; spawn(h, 'goblin', false); h.upT = 0.9; pops--; }
      animate(dt);
    },
    stop() { playing = false; mallet = null; },
    dispose() { try { undoDef?.(); } catch (err) { /* gone */ } },
    info: { holes, events, spawn, whack, get hits() { return hits; }, get golds() { return golds; }, get oops() { return oops; }, get pops() { return pops; }, get chain() { return chain; }, get mallet() { return mallet; }, TOP },
  };
}
