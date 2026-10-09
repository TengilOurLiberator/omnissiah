// games/basketball.js - a hoop with real rim colliders (12 beads on a ring), backboard and pole; five balls on a rack; 60 s shot clock.
export const meta = {
  name: 'basketball', title: 'Basketball', aliases: ['hoops', 'shoot hoops', 'basket', 'free throw', 'three pointer', 'streetball'], icon: '🏀',
  description: 'five balls, sixty seconds: 2 points inside the arc, 3 beyond it, 5 from far; swishes and hot streaks pay extra', hint: 'Grab a ball and throw it through the hoop', distance: 0, size: 10, par: 50, physics: true,
};
const BR = 0.12, BEADS = 12, BEAD_R = 0.032;

export default function (g) {
  const { THREE } = g, kit = g.world.kit, K = g.k, ctxC = g.ctx;
  const LV = { z0: [3.2, 3.5, 3.8, 4.1, 4.5], rimR: [0.30, 0.27, 0.25, 0.23, 0.21], mag: [1, 0.8, 0.6, 0.45, 0.3], amp: [0, 0, 0, 1.0, 1.5], spd: [0, 0, 0, 0.55, 0.85] };
  const RIMH = 3.05 * (0.55 + 0.45 * K), DECK_BACK = 4.4 * K + 1.2;
  const dd = 4.5 * K + 1.6 + DECK_BACK, deck = g.deck(10 * Math.max(K, 0.8), dd, { x: 0, z: DECK_BACK - dd / 2, color: 0xb8864a, thick: 0.3, friction: 0.8 });
  const Yl = (lz) => deck.y(0, lz) - g.y, Pw = (lx, h, lz, out) => g.at(lx, Yl(lz) + h, lz, out);
  const _L = { x: 0, z: 0 }, _L2 = { x: 0, z: 0 }, _v = new THREE.Vector3();
  let lvl = 1, z0 = 3.5 * K, rimR = 0.27, hx = 0, tRound = 0, made = 0, taken = 0, streak = 0, swing = 0, netPhase = 0, playing = false, ended = false;
  // ---- hoop parts: each has an offset from the anchor (rim centre on the floor) and optionally a body
  const parts = [];
  const mkPart = (mesh, ox, oy, oz, body) => { g.add(mesh); const p = { m: mesh, ox, oy, oz, h: null }; if (body) p.h = g.body(mesh, { type: 'fixed', ...body, group: 'prop' }); mesh.rotation.y = g.yaw; parts.push(p); return p; };
  const beads = []; for (let i = 0; i < BEADS; i++) { const a = (i / BEADS) * Math.PI * 2; beads.push(mkPart(g.sph(BEAD_R, 0xff6a1a, 0, 0, 0, { seg: 6, basic: true }), Math.cos(a), RIMH, Math.sin(a), { shape: 'sphere', size: BEAD_R, restitution: 0.55, friction: 0.3 })); beads[i].ang = a; }
  const rz = (p, v) => { p.rz = v; return p; };
  const board = rz(mkPart(g.box(1.4, 0.95, 0.06, 0xf2f2f2), 0, RIMH + 0.45, 0, { shape: 'box', size: [1.4, 0.95, 0.06], restitution: 0.6, friction: 0.3 }), 0.17);
  rz(mkPart(g.box(0.56, 0.4, 0.02, 0xe85a1a, 0, 0, 0, { basic: true }), 0, RIMH + 0.2, 0, null), 0.135); rz(mkPart(g.box(0.46, 0.3, 0.022, 0xf8f8f8, 0, 0, 0, { basic: true }), 0, RIMH + 0.2, 0, null), 0.134);
  rz(mkPart(g.box(0.14, 0.04, 0.2, 0xff6a1a), 0, RIMH - 0.02, 0, { shape: 'box', size: [0.14, 0.04, 0.2], restitution: 0.4 }), 0.1);
  const pole = rz(mkPart(g.cyl(0.07, 0.09, RIMH + 0.4, 0x4a4e5a), 0, (RIMH + 0.4) / 2, 0, { shape: 'cylinder', size: [0.08, RIMH + 0.4], friction: 0.4 }), 0.6);
  rz(mkPart(g.box(0.1, 0.1, 0.4, 0x4a4e5a), 0, RIMH + 0.55, 0, null), 0.4);
  // net: open wireframe cone that swings when a ball falls through
  const netGeo = new THREE.CylinderGeometry(1, 0.55, 1, 10, 3, true), net = new THREE.Mesh(netGeo, new THREE.MeshBasicMaterial({ color: 0xf4f4f4, wireframe: true }));
  net.userData.ownGeo = true; net.userData.noShadow = true; g.track({ remove() { net.material.dispose(); } }); g.add(net); const netG = new THREE.Group(); g.add(netG); netG.add(net); net.position.y = -0.2;
  // ---- floor markings: arcs around the rim anchor (3-point and 5-point lines) + the start spot
  // one arc mesh per level (the hoop moves with the level); arcs are always 1.6 m / 4.4 m (x k) behind the start spot
  const arcMesh = { R3: 0, R5: 0, list: [] };
  const arcAt = (b, R, col) => { for (let i = 0; i < 28; i++) { const a = Math.PI / 2 + (i / 27 - 0.5) * 2.1; b.box(0.07, 0.01, 0.34, col, Math.cos(a) * R, 0.005, Math.sin(a) * R, -a); } };
  for (let l = 0; l < 5; l++) {
    const zz = LV.z0[l] * K, b = g.builder(); arcAt(b, zz + 1.6 * K, 0xffffff); arcAt(b, zz + 4.4 * K, 0xffc83a); b.cyl(0.18, 0.18, 0.01, 0xffffff, 0, 0.005, zz, 14);
    const m = g.add(b.mesh()); m.userData.noShadow = true; m.visible = false; m.position.copy(Pw(0, 0, -zz)); m.position.y = deck.y(0, -zz) + 0.012; m.rotation.order = 'YXZ'; m.rotation.y = g.yaw; m.rotation.x = -deck.pitch; arcMesh.list.push(m);
  }
  const buildArcs = () => { arcMesh.R3 = z0 + 1.6 * K; arcMesh.R5 = z0 + 4.4 * K; arcMesh.list.forEach((m, i) => { m.visible = i === lvl - 1; }); };
  // ---- rack of five balls (two rods + end stops), on the right
  const RK = { lx: 1.35, lz: -0.5, y: 0.86 }, slots = [];
  const rod = (dz, w, h, d, lx = RK.lx) => { const m = g.add(g.box(w, h, d, 0x6a6e7a)); m.position.copy(Pw(lx, RK.y - h / 2, RK.lz + dz)); m.rotation.y = g.yaw; g.body(m, { type: 'fixed', shape: 'box', size: [w, h, d], group: 'prop', friction: 0.5 }); return m; };
  rod(-0.09, 1.35, 0.04, 0.04); rod(0.09, 1.35, 0.04, 0.04); rod(0, 0.04, 0.1, 0.3, RK.lx - 0.69); rod(0, 0.04, 0.1, 0.3, RK.lx + 0.69);
  for (const sx of [-0.55, 0.55]) rod(0, 0.07, RK.y, 0.07, RK.lx + sx);
  for (let i = 0; i < 5; i++) slots.push(Pw(RK.lx + (i - 2) * 0.255, RK.y + 0.1, RK.lz).clone());
  // ---- balls
  const balls = [];
  for (let i = 0; i < 5; i++) {
    const bm = g.builder(); bm.sph(BR, 0xe8742a, 0, 0, 0, 1, 12); bm.cyl(BR * 1.006, BR * 1.006, 0.012, 0x1a1008, 0, 0, 0, 14); bm.cyl(BR * 1.006, BR * 1.006, 0.012, 0x1a1008, 0, 0, 0, 14, Math.PI / 2, 0, 0);
    const mesh = bm.mesh(); mesh.position.copy(slots[i]);
    const b = kit ? kit.body(ctxC, mesh, { radius: BR, mass: 0.6, bounce: 0.74, friction: 0.55, drag: 0.08, grabbable: true, grabRange: 6, ccd: true, angularDamping: 0.3 }) : null;
    if (!b) continue; g.track(b);
    const B = { b, i, slot: slots[i], state: 'rack', dist: 0, touched: false, scored: false, tDead: 0, tStill: 0, px: 0, py: 0, pz: 0 }; balls.push(B);
    b.onRelease((hand, e) => { // a throw is a shot; a gentle drop just goes home after a while
      B.tDead = 0; B.tStill = 0; B.touched = false; B.scored = false;
      if (e && e.velocity && e.velocity.length() < 2.2) { B.state = 'dead'; return; }
      const hd = g.head, L = g.toLocal(hd.x, hd.z, _L2); B.dist = Math.hypot(L.x - hx, L.z + z0); B.state = 'air'; B.fresh = 0.3; taken++; g.sfx('whoosh', b.position, 0.6);
    });
  }
  const sendHome = (B) => { const b = B.b; if (b.removed || b.held) return false; b.position.copy(B.slot); b.velocity.set(0, 0, 0); b.ph?.setAngularVelocity?.(0, 0, 0); b.ph?.wake?.(); B.state = 'rack'; B.scored = false; return true; };
  function placeHoop(t) {
    const ax = hx, az = -z0;
    for (const p of parts) {
      let ox = p.ox, oz = p.oz, oy = p.oy; if (p.ang !== undefined) { ox = Math.cos(p.ang) * rimR; oz = Math.sin(p.ang) * rimR; } else if (p.rz !== undefined) oz = -(rimR + p.rz);
      Pw(ax + ox, oy, az + oz, p.m.position);
      if (p.h) { if (p.h.type === 'kinematic') p.h.follow(p.m.position, p.m.quaternion); else p.h.setTransform(p.m.position, p.m.quaternion); }
    }
    netG.position.copy(Pw(ax, RIMH, az)); netG.rotation.y = g.yaw;
  }
  const setMoving = (on) => { for (const p of parts) if (p.h) p.h.setType(on ? 'kinematic' : 'fixed'); };
  function score(B, cx, cz) {
    const top = Math.abs(cx - hx) < 0.06 && Math.abs(cz + z0) < 0.06, swish = !B.touched, base = B.dist < arcMesh.R3 ? 2 : B.dist < arcMesh.R5 ? 3 : 5;
    made++; streak++; B.scored = true; B.state = 'scored'; swing = 1; B.tDead = 0;
    const pts = base + (swish ? 1 : 0) + (streak >= 3 ? Math.min(streak - 2, 4) : 0), at = Pw(hx, RIMH + 0.5, -z0, _v).clone();
    if (playing) g.addScore(pts, at, `${swish ? 'SWISH ' : ''}+${pts}`); else g.float(at, swish ? 'Swish!' : 'In!', 0xffe27a);
    g.sfx(swish ? 'big' : 'coin', at); if (base >= 3) g.float(Pw(hx, RIMH + 0.95, -z0), base === 5 ? 'FROM DOWNTOWN!' : '3-POINTER', 0x7fe3a0);
    if (streak >= 3) { g.float(Pw(hx, RIMH + 1.3, -z0), `HOT x${streak}`, 0xff9a3a); g.sfx('cheer'); }
    g.pop(at, 20, 'spark'); g.pulse('both', 0.5, 80); g.status(`Made ${made}/${taken}   streak ${streak}`);
    if (made === 10) g.note('Ten baskets made in one round of basketball.', false);
  }
  function miss(B) { if (B.scored) return; streak = 0; _v.copy(B.b.position); _v.y += 0.4; g.float(_v, 'Miss', 0xff7a6b); g.sfx('miss', B.b.position, 0.4); g.status(`Made ${made}/${taken}   streak 0`); }
  function stepBall(B, dt) {
    const b = B.b; if (b.removed) return; const p = b.position, v = b.velocity, L = g.toLocal(p.x, p.z, _L), sp = v.length(), floorY = deck.y(0, L.z) + BR;
    if (b.held) { B.state = 'held'; B.px = L.x; B.py = p.y; B.pz = L.z; return; }
    if (B.state === 'held') { B.state = 'air'; B.dist = 0; } // released through some other path
    if (B.state === 'rack') {
      if (p.distanceToSquared(B.slot) > 0.25) { B.state = 'dead'; B.tDead = 0; B.tStill = 0; B.touched = false; } // knocked off the rack: only a thrown ball is a shot
    } else if (B.state === 'air') {
      B.fresh = (B.fresh ?? 0) - dt;
      const rimY = deck.y(0, -z0) + RIMH, dx = L.x - hx, dz = L.z + z0, dh = Math.hypot(dx, dz);
      // touching the hoop (rim bead / board) spoils a swish
      if (!B.touched && Math.abs(p.y - rimY) < 0.3 && Math.abs(dh - rimR) < BR + BEAD_R + 0.02) { // exact: any rim bead within touching distance
        for (let i = 0; i < BEADS; i++) { const m = beads[i].m.position, ex = m.x - p.x, ey = m.y - p.y, ez = m.z - p.z; if (ex * ex + ey * ey + ez * ez < (BR + BEAD_R + 0.008) ** 2) { B.touched = true; break; } }
      }
      if (!B.touched && Math.abs(dz + rimR + 0.14) < BR + 0.004 && Math.abs(dx) < 0.7 && p.y > rimY - 0.1 && p.y < rimY + 0.95) B.touched = true;
      // assist: a descending ball near the rim is drawn toward its centre
      if (v.y < 0 && p.y > rimY - 0.05 && p.y < rimY + 0.9 && dh < 0.9 && dh > 0.01) { const a = 12 * LV.mag[lvl - 1] * (1 - dh / 0.9) * dt; v.x -= dx / dh * a; v.z -= dz / dh * a; v.x *= 1 - 0.8 * dt; v.z *= 1 - 0.8 * dt; }
      if (B.py > rimY && p.y <= rimY && v.y < 0 && !B.scored) { const u = (B.py - rimY) / (B.py - p.y || 1), cx = B.px + (L.x - B.px) * u, cz = B.pz + (L.z - B.pz) * u; if (Math.hypot(cx - hx, cz + z0) < rimR) score(B, cx, cz); }
      if (B.state === 'air' && p.y <= floorY + 0.05 && B.fresh < 0) { B.state = 'dead'; B.tDead = 0; B.tStill = 0; miss(B); }
    } else { // dead / scored: home after ~3 s on the floor or when it stops
      B.tDead += dt; B.tStill = sp < 0.4 ? B.tStill + dt : 0;
      if (B.state === 'scored' && p.y <= floorY + 0.1 && B.tDead > 0.2) { B.state = 'dead'; B.tDead = 0; B.tStill = 0; }
      if ((B.state === 'dead' && (B.tDead > 3 || (B.tStill > 1.2 && B.tDead > 0.8))) || B.tDead > 8 || p.y < g.y - 3 || Math.abs(L.x) > 16 || L.z > 14 || L.z < -z0 - 12) sendHome(B);
    }
    B.px = L.x; B.py = p.y; B.pz = L.z;
  }
  function common(dt, t) {
    if (swing > 0.01) { swing *= Math.exp(-2.6 * dt); netPhase += dt * 16; netG.rotation.z = Math.sin(netPhase) * 0.18 * swing; net.scale.set(rimR * (1 - 0.1 * swing), 0.42 * (1 + 0.25 * swing), rimR * (1 - 0.1 * swing)); }
    for (const B of balls) stepBall(B, dt);
  }
  function reset(level) {
    lvl = level; z0 = LV.z0[level - 1] * K; rimR = LV.rimR[level - 1]; hx = 0; tRound = 0; made = 0; taken = 0; streak = 0; swing = 0; playing = false; ended = false;
    setMoving(false); placeHoop(0); buildArcs(); net.scale.set(rimR, 0.42, rimR); netG.rotation.z = 0;
    for (const B of balls) { B.state = 'rack'; sendHome(B); }
    g.status('');
  }
  return {
    reset,
    play(level) { playing = true; tRound = 0; g.setTime(60); setMoving(LV.amp[level - 1] > 0); g.status('Grab a ball and shoot'); },
    update(dt, t) {
      tRound += dt; const amp = LV.amp[lvl - 1] * (K < 1 ? 0.7 : 1);
      if (amp > 0) { hx = Math.sin(tRound * LV.spd[lvl - 1]) * amp; placeHoop(); }
      common(dt, t);
      if (!ended && g.timeLeft <= 0) { ended = true; g.end({ score: g.score, rating: g.score / meta.par, text: `${made}/${taken}`, detail: `${made}/${taken} shots` }); }
    },
    idle(dt, t) { common(dt, t); },
    stop() { playing = false; setMoving(false); },
    info: { balls, parts, get made() { return made; }, get taken() { return taken; }, get streak() { return streak; }, get hx() { return hx; }, get tRound() { return tRound; }, get z0() { return z0; }, get rimR() { return rimR; }, RIMH, arcMesh, slots, deck, get lvl() { return lvl; } },
  };
}








