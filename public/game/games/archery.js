// games/archery.js - Archery Range: moving boards, popping gongs and balloons at 8 / 14 / 22 m (x g.k), a wind that really pushes the arrows, a x1..x5 hit combo, 60 s.
// HONEST NOTE ON THE WIND: the stock bow's arrows live inside weapons.js and cannot be nudged, so this game defines its own 'range-bow' (a copy of the stock bow's model, string
// animation and draw, with a custom fire()). Its arrows are simulated HERE (gravity + sideways wind acceleration, swept hit test against the target planes) and hit through
// kit.damageable (d.hit), so rings are scored from the real impact point. Blaster bolts / spells / thrown things also score on the same damageables (no wind on those).
export const meta = {
  name: 'archery', title: 'Archery Range', aliases: ['archery range', 'bow range', 'shooting range', 'target practice', 'bow and arrow', 'archer', 'bows', 'range'], icon: '🏹',
  description: 'moving boards, popping gongs and balloons, wind, combo multiplier, 60 s', hint: 'Hold trigger to draw, release to loose. Watch the wind flag', distance: 3, size: 24, par: 2400, physics: false,
};

const GRAV = 7.5, SPEED = 56, N_ARROWS = 14, ROUND = 60;
// kind, z (m, x g.k), x centre, amp (boards slide +-amp), speed, R face radius (m), rank (distance score factor)
const LAYOUT = [
  ['board', -8, 0, 2.4, 0.55, 0.42, 1], ['gong', -8, -3.4, 0, 0, 0.32, 1], ['gong', -8, 3.4, 0, 0, 0.32, 1],
  ['board', -14, 0, 3.2, 0.5, 0.55, 1.5], ['balloon', -14, -5.2, 0, 0, 0.4, 1.5, 0xe84a4a], ['balloon', -14, 5.2, 0, 0, 0.4, 1.5, 0xf2c230],
  ['board', -22, 0, 4.0, 0.45, 0.8, 2.5], ['gong', -22, -7, 0, 0, 0.5, 2.5], ['gong', -22, 7, 0, 0, 0.5, 2.5],
];

export default function (g) {
  const { THREE } = g, kit = g.world.kit, Wp = g.world.weapons, K = g.k;
  const cs = Math.cos(g.yaw), sn = Math.sin(g.yaw), FWD = new THREE.Vector3(0, 0, -1);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _l = { x: 0, z: 0 }, HIT = { kind: 'pierce', direction: _b, hand: undefined };
  const gyAt = (lx, lz) => g.ground(lx, lz) - g.y;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---- the shooting deck, line and wind flag
  g.pedestalAt(-1.2, 0.1); g.boardAt(-1.9, 1.75, -2.6);
  g.deck(3.4, 2.4, { x: 0, z: -0.1, color: 0x7a5c3a });
  { const m = g.add(g.box(3.2, 0.04, 0.1, 0xe8e0d0)); m.position.copy(g.at(0, 0, -0.95)); m.position.y = g.y + g.ground(0, -0.95) - g.y + 0.0; m.position.y = Math.max(m.position.y, g.at(0, 0.1, -0.95).y); m.rotation.y = g.yaw; }
  const poleB = g.builder(); poleB.cyl(0.04, 0.06, 4, 0xd8d8d8, 0, 2, 0, 8);
  const pole = g.add(poleB.mesh()); { const p = g.at(2.3 * K, 0, -5 * K); pole.position.set(p.x, g.ground(2.3 * K, -5 * K), p.z); }
  const flag = new THREE.Group(); flag.position.set(pole.position.x, pole.position.y + 3.7, pole.position.z); g.add(flag);
  { const f = g.add(g.box(1.3, 0.45, 0.02, 0xe83a3a), flag); f.position.x = 0.65; const s = g.add(g.box(0.5, 0.45, 0.025, 0xf5f5f5), flag); s.position.x = 0.35; }
  let flagW = 0;

  // ---- targets
  const targets = [];
  function makeTarget(spec, i) {
    const [kind, zz, x0, amp, sp, R, rank, color] = spec, z = zz * K, bx = x0 * K;
    const t = { kind, z, x0: bx, amp: amp * K, sp, R0: R, R, rank, color, cx: bx, by: gyAt(bx, z), cy: 0, ph: i * 1.7, state: 'down', f: kind === 'board' ? 1 : 0, timer: 1 + i * 0.35, hit: kind === 'board', d: null, grp: new THREE.Group(), face: null, hinge: null };
    const b = g.builder();
    if (kind === 'board') {
      t.cy = 1.55; b.cyl(0.04, 0.05, t.cy + 0.6, 0x6a4a2a, 0, (t.cy - 0.6) / 2, -0.1, 8);
      const fb = g.builder(); fb.cyl(R * 1.12, R * 1.12, 0.05, 0x6a4a2a, 0, 0, -0.035, 20, Math.PI / 2);
      [[1, 0xf2efe6], [0.7, 0x24262c], [0.4, 0x3a74d6], [0.15, 0xe03a32]].forEach(([fr, c], k) => fb.cyl(R * fr, R * fr, 0.04, c, 0, 0, k * 0.006, 20, Math.PI / 2));
      t.face = fb.mesh(); t.face.position.y = t.cy; t.grp.add(t.face);
    } else if (kind === 'gong') {
      b.box(R * 2.4, 0.14, 0.3, 0x5a4026, 0, 0.07, -0.1);
      const fb = g.builder(); fb.cyl(R, R, 0.05, 0x9a6a22, 0, 0, 0, 20, Math.PI / 2); fb.cyl(R * 0.82, R * 0.82, 0.05, 0xd8a83c, 0, 0, 0.012, 20, Math.PI / 2); fb.cyl(R * 0.22, R * 0.22, 0.05, 0x8a5a18, 0, 0, 0.03, 12, Math.PI / 2);
      t.face = fb.mesh(); t.face.position.y = R; t.hinge = new THREE.Group(); t.hinge.position.set(0, 0.16, 0); t.hinge.add(t.face); t.grp.add(t.hinge);
    } else {
      const fb = g.builder(); fb.sph(R, color, 0, 0, 0, 1.15, 12); fb.cone(R * 0.16, 0.1, color, 0, -R * 1.15 - 0.04, 0, 6, Math.PI); fb.cyl(0.006, 0.006, 1.6, 0xdddddd, 0, -R * 1.15 - 0.9, 0, 4);
      t.face = fb.mesh(); t.grp.add(t.face);
    }
    const base = b.pos.length ? b.mesh() : null; if (base) t.grp.add(base);
    t.grp.rotation.y = g.yaw; g.add(t.grp);
    if (kit) t.d = kit.damageable(g.ctx, t.grp, { hp: 1e9, radius: R, offsetY: 0, faction: 'neutral', flash: false, onHit: (e) => onTargetHit(t, e) });
    if (t.d) g.track(t.d);
    return t;
  }
  LAYOUT.forEach((s, i) => targets.push(makeTarget(s, i)));
  function placeTarget(t) {
    const hy = t.kind === 'board' ? t.cy : t.kind === 'balloon' ? t.cy : t.cy;
    g.at(t.cx, t.kind === 'balloon' ? t.by + t.cy : t.by, t.z, _a); t.grp.position.copy(_a);
    if (t.d) { t.d.offsetY = t.kind === 'balloon' ? 0 : t.cy; t.d.alive = t.hit; if (t.hit) t.d.hp = 1e9; }
    void hy;
  }

  // ---- arrows (pooled meshes; state in local coordinates: x right, y above g.y, z forward = negative)
  const ab = g.builder();
  ab.cyl(0.011, 0.011, 0.7, 0x9a7040, 0, 0, 0, 5, Math.PI / 2); ab.cone(0.03, 0.12, 0xc8d0d8, 0, 0, -0.4, 5, -Math.PI / 2);
  ab.box(0.003, 0.06, 0.14, 0xe84a3a, 0, 0, 0.3); ab.box(0.06, 0.003, 0.14, 0xe84a3a, 0, 0, 0.3);
  const arrowProto = ab.mesh();
  const arrows = [];
  for (let i = 0; i < N_ARROWS; i++) {
    const m = i === 0 ? arrowProto : new THREE.Mesh(arrowProto.geometry, arrowProto.material);
    m.visible = false; m.userData.noShadow = true; g.add(m);
    arrows.push({ m, on: false, stuck: false, to: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, tt: 0, ox: 0, oy: 0, dx: 0, dy: 0, dz: -1, mine: false });
  }
  let nextArrow = 0;
  function place(a) {
    if (!a.on) { a.m.visible = false; return; }
    g.at(a.x, a.y, a.z, _a); _b.set(a.dx * cs + a.dz * sn, a.dy, -a.dx * sn + a.dz * cs);
    a.m.position.copy(_a).addScaledVector(_b, -0.4); a.m.quaternion.setFromUnitVectors(FWD, _b); a.m.visible = true;
  }

  // ---- state
  let lvl = 1, streak = 0, best = 0, shots = 0, hits = 0, misses = 0, bulls = 0, wind = 0, windMax = 3, wph1 = 0, wph2 = 0, playing = false, bow = null, bowLost = 0, hudT = 0, giveT = 0;
  const events = []; // raw scoring log for the tests: { t:'hit'|'miss', kind, r, R, rank } in order
  const sizeK = () => 1 - 0.05 * (lvl - 1);

  function onTargetHit(t, e) {
    if (!playing || !t.hit || g.state !== 'play') return;
    const p = e.point, d = e.direction; if (!p) return;
    g.toLocal(p.x, p.z, _l); let hx = _l.x, hy = p.y - g.y;
    if (d) { const dlx = d.x * cs - d.z * sn, dlz = d.x * sn + d.z * cs; if (Math.abs(dlz) > 0.25) { const s = (t.z - _l.z) / dlz; hx += dlx * s; hy += d.y * s; } }
    const r = Math.hypot(hx - t.cx, hy - (t.by + t.cy));
    g.at(hx, hy, t.z, _a);
    award(t, r, _a);
    if (t.kind === 'gong') { t.state = 'falling'; t.f = Math.min(t.f, 0.99); g.sfx('clang', _a, 1); } else if (t.kind === 'balloon') { t.state = 'popped'; t.timer = 1.5 + Math.random(); t.hit = false; g.pop(_a, 30, 'confetti'); g.sfx('pop', _a, 1); }
    else g.sfx('thud', _a, 0.8);
    g.pulse(bow && bow.held ? bow.held : 'both', 0.5, 50);
    t.hit = t.kind === 'board'; if (t.kind !== 'board') t.d.alive = false;
  }
  function award(t, r, at) {
    let base;
    if (t.kind === 'board') { const q = r / t.R; base = q < 0.15 ? 50 : q < 0.4 ? 30 : q < 0.7 ? 20 : 10; if (q < 0.15) { bulls++; g.float(_b.copy(at).setY(at.y + 0.5), 'BULLSEYE', 0xff5a3a); g.sfx('big', at, 0.8); } } else base = t.kind === 'gong' ? 30 : 25;
    const mult = Math.min(5, 1 + streak); streak++; hits++; best = Math.max(best, streak);
    const pts = Math.round(base * t.rank * mult);
    events.push({ t: 'hit', kind: t.kind, r, R: t.R, rank: t.rank });
    g.addScore(pts, at, '+' + pts + (mult > 1 ? ' x' + mult : ''), mult >= 5 ? 0xff9a3a : undefined);
    if (mult === 5 && streak === 5) { g.sfx('big'); g.note('Reached the x5 combo on the archery range.', false); }
  }
  function miss(a) {
    misses++; events.push({ t: 'miss' });
    if (streak > 0) { g.float(g.at(a.x, a.y + 0.3, a.z, _a), 'combo lost', 0xff7a6b); }
    else g.float(g.at(a.x, a.y + 0.3, a.z, _a), 'miss', 0xff7a6b);
    streak = 0; g.sfx('miss', _a, 0.5);
  }

  // ---- the bow: a custom type copied from the stock bow, with our own arrows
  function launch(origin, dir, power) {
    if (g.state !== 'play') return;
    const a = arrows[nextArrow]; nextArrow = (nextArrow + 1) % N_ARROWS;
    g.toLocal(origin.x, origin.z, _l);
    const sp = SPEED * (0.33 + 0.67 * clamp(power ?? 1, 0, 1));
    a.on = true; a.stuck = false; a.to = null; a.age = 0; a.mine = true;
    a.x = _l.x; a.y = origin.y - g.y; a.z = _l.z;
    a.dx = dir.x * cs - dir.z * sn; a.dy = dir.y; a.dz = dir.x * sn + dir.z * cs;
    a.vx = a.dx * sp; a.vy = a.dy * sp; a.vz = a.dz * sp; shots++;
    place(a);
  }
  let undoDef = null;
  if (Wp && Wp.define && Wp.create) {
    try {
      const probe = Wp.create(g.ctx, 'bow', { position: g.at(0, -40, 0) });
      if (probe) {
        const spec = { ...probe.spec }; probe.remove(); delete spec.type;
        spec.fire = ({ origin, direction, power }) => launch(origin, direction, power);
        undoDef = Wp.define('range-bow', spec);
      }
    } catch (err) { console.error('[archery] range-bow setup failed', err); }
  }
  function giveBow() {
    if (!Wp || (bow && !bow.body.removed)) return;
    bow = g.give(undoDef ? 'range-bow' : 'bow'); bowLost = 0;
    if (!bow) g.status('Free a hand: the bow is waiting');
  }

  // ---- animation / round logic
  function animate(dt, t) {
    const sc = sizeK();
    for (const o of targets) {
      if (o.kind === 'board') { o.cx = o.x0 + o.amp * Math.sin(t * o.sp * (0.8 + 0.2 * lvl) + o.ph); o.R = o.R0 * sc; o.face.scale.set(sc, sc, 1); o.hit = true; }
      else {
        o.R = o.R0 * sc; if (o.kind === 'balloon') o.face.scale.setScalar(sc);
        if (playing) {
          if (o.state === 'down' || o.state === 'popped') { o.timer -= dt; if (o.timer <= 0) { o.state = 'rising'; o.f = 0; o.hit = false; } }
          else if (o.state === 'rising') { o.f += dt / 0.4; if (o.f >= 1) { o.f = 1; o.state = 'up'; o.timer = Math.max(1.4, 3.6 - 0.45 * lvl); o.hit = true; } }
          else if (o.state === 'up') { o.timer -= dt; if (o.timer <= 0) { o.state = 'falling'; } }
          else if (o.state === 'falling') { o.f -= dt / 0.4; o.hit = false; if (o.f <= 0) { o.f = 0; o.state = 'down'; o.timer = 0.6 + Math.random() * 1.6 / (1 + 0.15 * lvl); } }
        }
        const e = 1 - (1 - o.f) * (1 - o.f);
        if (o.kind === 'gong') { const a = -Math.PI / 2 * (1 - e); o.hinge.rotation.x = a; o.cy = 0.16 + o.R * Math.cos(a); o.face.scale.setScalar(sc); o.grp.visible = true; }
        else { o.cx = o.x0 + 0.12 * Math.sin(t * 1.7 + o.ph); o.cy = -1.8 + (1.8 + 1.9) * e; o.grp.visible = o.f > 0 && o.state !== 'popped'; }
      }
      placeTarget(o);
    }
    const w = windNow(t); flagW += (w - flagW) * Math.min(1, dt * 3);
    const mag = clamp(Math.abs(flagW) / windMax, 0, 1);
    flag.rotation.y = g.yaw + (flagW < 0 ? Math.PI : 0); flag.rotation.z = -(1 - mag) * 1.25 + Math.sin(t * 11) * 0.06 * (0.3 + mag);
  }
  function windNow(t) { wind = windMax * (Math.sin(t * 0.37 + wph1) * 0.6 + Math.sin(t * 0.93 + wph2) * 0.4); return playing ? wind : 0.8 * Math.sin(t * 0.4); }
  function stepArrows(dt) {
    for (const a of arrows) {
      if (!a.on) continue;
      a.age += dt;
      if (a.stuck) {
        if (a.to) { a.x = a.to.cx + a.ox; a.y = a.to.by + a.to.cy + a.oy; }
        if ((a.tt -= dt) <= 0) { a.on = false; }
        place(a); continue;
      }
      const x0 = a.x, y0 = a.y, z0 = a.z;
      a.vx += wind * dt; a.vy -= GRAV * dt; a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      const sp = Math.hypot(a.vx, a.vy, a.vz) || 1; a.dx = a.vx / sp; a.dy = a.vy / sp; a.dz = a.vz / sp;
      let best2 = null, bs = 2, hx = 0, hy = 0;
      for (const t of targets) {
        if (!t.hit || !(z0 > t.z && a.z <= t.z)) continue;
        const s = (z0 - t.z) / (z0 - a.z), px = x0 + (a.x - x0) * s, py = y0 + (a.y - y0) * s, ex = px - t.cx, ey = py - (t.by + t.cy), R = t.R + 0.12;
        if (ex * ex + ey * ey <= R * R && s < bs) { best2 = t; bs = s; hx = px; hy = py; }
      }
      if (best2) {
        a.x = hx; a.y = hy; a.z = best2.z; _b.set(a.dx * cs + a.dz * sn, a.dy, -a.dx * sn + a.dz * cs);
        g.at(hx, hy, best2.z, _a);
        const t = best2; HIT.hand = bow && bow.held ? bow.held : undefined;
        t.d.hit(26, _a, 'player', null, HIT);
        if (t.kind === 'board') { a.stuck = true; a.to = t; a.ox = hx - t.cx; a.oy = hy - (t.by + t.cy); a.z = t.z - 0.12; a.tt = 8; place(a); } else { a.on = false; place(a); }
        continue;
      }
      if (a.y < gyAt(a.x, a.z)) { a.y = gyAt(a.x, a.z) + 0.02; a.stuck = true; a.to = null; a.tt = 6; if (a.mine) { miss(a); a.mine = false; } place(a); continue; }
      if (a.z < -40 * K || Math.abs(a.x) > 60 || a.age > 6) { if (a.mine) miss(a); a.on = false; place(a); continue; }
      place(a);
    }
  }
  const arrowCount = (w) => '>'.repeat(clamp(Math.ceil((Math.abs(w) / windMax) * 3), 1, 3));
  function hud() {
    const w = Math.abs(wind) < 0.25 ? 'calm' : (wind < 0 ? '<'.repeat(arrowCount(wind).length) : arrowCount(wind)) + ' ' + Math.abs(wind).toFixed(1);
    g.status(`Wind ${w}   combo x${Math.min(5, 1 + streak)}`);
  }

  return {
    reset(level) {
      lvl = level; streak = best = shots = hits = misses = bulls = 0; playing = false; events.length = 0; bow = null; bowLost = 0; windMax = 0.8 + 1.3 * level;
      for (const a of arrows) { a.on = false; a.stuck = false; a.m.visible = false; }
      for (const o of targets) { o.state = o.kind === 'board' ? 'up' : 'down'; o.f = o.kind === 'board' ? 1 : 0; o.timer = 0.8 + Math.random() * 1.5; o.hit = o.kind === 'board'; }
      g.status('');
    },
    play(level) {
      lvl = level; playing = true; windMax = 0.8 + 1.3 * level; wph1 = Math.random() * 6.28; wph2 = Math.random() * 6.28;
      g.setTime(ROUND); giveBow(); hud();
      g.every(1, () => { if (!bow || bow.body.removed) giveBow(); });
    },
    update(dt, t) {
      animate(dt, t); stepArrows(dt);
      if (bow && !bow.body.removed) { // a dropped bow comes back to the shooting spot after a few seconds
        if (!bow.held && !bow.fly) { bowLost += dt; if (bowLost > 6) { bowLost = 0; bow.body.position.copy(g.at(0.3, 1.1, -0.4, _a)); bow.body.velocity.set(0, 0, 0); g.sfx('bell', _a, 0.5); } } else bowLost = 0;
      }
      if ((hudT -= dt) <= 0) { hudT = 0.2; hud(); }
      if (g.timeLeft <= 0) { playing = false; g.end({ score: g.score, detail: `${hits}/${shots} hit, best x${Math.min(5, 1 + best)}` }); }
    },
    idle(dt, t) { animate(dt, t); stepArrows(dt); },
    stop() { playing = false; bow = null; },
    dispose() { try { undoDef?.(); } catch (err) { /* gone */ } },
    info: { targets, arrows, events, launch, get wind() { return wind; }, get lvl() { return lvl; }, get shots() { return shots; }, get hits() { return hits; }, get misses() { return misses; }, get bulls() { return bulls; }, get streak() { return streak; }, get bow() { return bow; }, GRAV, SPEED, gyAt },
  };
}
