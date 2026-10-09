// games/bowling.js - ten real pins on a tilted-to-terrain lane, ten frames, strikes, spares, bumpers on level 1, a ball return.
export const meta = {
  name: 'bowling', title: 'Bowling', aliases: ['bowl', 'ten pin', 'bowling alley', 'lets bowl', 'skittles', 'ninepins'], icon: '🎳',
  description: 'ten real pins, ten frames, strikes and spares', hint: 'Grab the ball and roll it at the pins', distance: 2.5, size: 9, par: 170, physics: true,
};

const PIN_H = 0.42, PIN_R = 0.075, BALL_R = 0.135;
// standard scoring over a flat list of rolls (counts the bonuses that are already known)
export function scoreRolls(rolls) {
  let total = 0, i = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    const a = rolls[i], b = rolls[i + 1], c = rolls[i + 2];
    if (f < 9) {
      if (a === 10) { total += 10 + (b ?? 0) + (c ?? 0); i += 1; } else if (b !== undefined && a + b === 10) { total += 10 + (c ?? 0); i += 2; } else { total += a + (b ?? 0); i += 2; }
    } else { total += a + (b ?? 0) + (c ?? 0); i += 3; }
  }
  return total;
}

export default function (g) {
  const { THREE } = g, kit = g.world.kit, K = g.k;
  const L = 11 * K, W = 1.05; // lane length to the head pin, lane width
  const deck = g.deck(W + 0.7, L + 3, { x: 0, z: -(L + 3) / 2 - 0.4, color: 0x8a6a42, parts: [{ x: 0, w: W, dy: 0, color: 0xcaa064 }, { x: -(W / 2 + 0.17), w: 0.34, dy: -0.07, color: 0x2a2a30 }, { x: W / 2 + 0.17, w: 0.34, dy: -0.07, color: 0x2a2a30 }] });
  const planeY = (z) => deck.y(0, z);
  // ---- scenery: back wall and side curtain, foul-line stripe, bumpers, ball rack
  const wallZ = -(L + 2.6);
  const wall =g.add(g.box(W + 0.7, 0.9, 0.1, 0x3a2a24, 0, 0, 0)); wall.position.copy(g.at(0, planeY(wallZ) - g.y + 0.45, wallZ)); wall.rotation.y = g.yaw;
  g.body(wall, { type: 'fixed', shape: 'box', size: [W + 0.7, 0.9, 0.1], group: 'prop', restitution: 0.1 });
  const stripe = g.add(g.box(W, 0.012, 0.06, 0xd83a3a, 0, 0, 0)); stripe.position.copy(g.at(0, planeY(-0.5) - g.y + 0.012, -0.5)); stripe.rotation.y = g.yaw;
  const bump = [-1, 1].map((s) => {
    const m = g.add(g.box(0.06, 0.12, L + 1.5, 0xd8503a, 0, 0, 0)); m.rotation.order = 'YXZ'; m.rotation.y = g.yaw; m.rotation.x = -Math.atan(deck.slope);
    const h = g.body(m, { type: 'fixed', shape: 'box', size: [0.06, 0.12, L + 1.5], group: 'prop', friction: 0.2 });
    return { m, h, x: s * (W / 2 - 0.0) };
  });
  const placeBump = (up) => { for (const b of bump) { const p = g.at(b.x, (up ? planeY(-(L + 1.5) / 2 - 0.4) - g.y + 0.06 : -2), -(L + 1.5) / 2 - 0.4); b.m.position.copy(p); b.h?.setTransform(p, b.m.quaternion); b.m.visible = up; } };
  // pins
  const mk = g.builder();
  mk.cyl(0.065, 0.075, 0.1, 0xf4f0e8, 0, -0.16, 0, 10); mk.cyl(0.075, 0.05, 0.16, 0xf4f0e8, 0, -0.03, 0, 10); mk.cyl(0.05, 0.036, 0.1, 0xf4f0e8, 0, 0.1, 0, 10); mk.sph(0.05, 0xf4f0e8, 0, 0.19, 0, 1.1, 8); mk.cyl(0.052, 0.05, 0.022, 0xd83a3a, 0, 0.12, 0, 10);
  const pinProto = mk.mesh();
  const spots = []; for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) spots.push([(c - r / 2) * 0.25, -(L + r * 0.22)]);
  const pins = spots.map(([lx, lz], i) => {
    const m = i === 0 ? pinProto : new THREE.Mesh(pinProto.geometry, pinProto.material); if (i) m.userData.ownGeo = false;
    m.position.copy(g.at(lx, planeY(lz) - g.y + PIN_H / 2 + 0.01, lz)); g.add(m, g.root);
    const h = g.body(m, { shape: 'cylinder', size: [PIN_R, PIN_H], mass: 1.1, friction: 0.4, restitution: 0.4, linearDamping: 0.05, angularDamping: 0.3 });
    return { m, h, lx, lz, out: false, down: false };
  });
  const _q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw), _p = new THREE.Vector3(), _hid = new THREE.Vector3();
  function rackPin(p) {
    p.out = false; p.down = false; p.m.visible = true; if (!p.h) return;
    p.h.setType('dynamic'); _p.copy(g.at(p.lx, planeY(p.lz) - g.y + PIN_H / 2 + 0.01, p.lz)); p.h.setTransform(_p, _q); p.h.setVelocity(0, 0, 0); p.h.setAngularVelocity(0, 0, 0); p.h.wake();
  }
  function sweepPin(p) { p.out = true; p.m.visible = false; if (p.h) { p.h.setType('fixed'); p.h.setTransform(_hid.set(g.x, g.y - 30, g.z)); } }
  const standing = () => pins.filter((p) => !p.out && !p.down);
  function judge() { // which pins lie down right now
    for (const p of pins) {
      if (p.out || p.down) continue; const pos = p.h ? p.h.position : p.m.position, q = p.h ? p.h.quaternion : p.m.quaternion;
      const up = 1 - 2 * (q.x * q.x + q.z * q.z), lz = g.toLocal(pos.x, pos.z).z;
      if (up < 0.8 || pos.y < planeY(lz) - 0.1) p.down = true;
    }
  }
  const pinsMoving = () => pins.some((p) => !p.out && p.h && (p.h.velocity.lengthSq() > 0.04 || p.h.angularVelocity.lengthSq() > 0.25));
  // ---- ball + ball return rack at waist height on the left
  const rackLx = -1.0, rackLz = -0.95, rackTop = 0.78;
  const rb = g.builder(); rb.cyl(0.14, 0.2, rackTop, 0x4a4e5a, 0, rackTop / 2, 0, 12); rb.cyl(0.22, 0.22, 0.04, 0x8a8e9a, 0, rackTop, 0, 14);
  const rack = g.add(rb.mesh()); rack.position.copy(g.at(rackLx, 0, rackLz)); rack.position.y = g.groundAt(rack.position.x, rack.position.z);
  g.body(rack, { type: 'fixed', shape: 'cylinder', group: 'prop', friction: 0.6 });
  const rackPos = new THREE.Vector3(rack.position.x, rack.position.y + rackTop + BALL_R + 0.05, rack.position.z);
  for (const [dx, dz] of [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]]) { // pocket walls so the ball sits on the rack
    const sx = dx ? 0.03 : 0.33, sz = dz ? 0.03 : 0.33, w = g.add(g.box(sx, 0.08, sz, 0x8a8e9a)); w.position.set(rackPos.x + dx, rack.position.y + rackTop + 0.04, rackPos.z + dz);
    g.body(w, { type: 'fixed', shape: 'box', size: [sx, 0.08, sz], group: 'prop' });
  }
  const bm = g.builder(); bm.sph(BALL_R, 0x1c2a6a, 0, 0, 0, 1, 14); bm.sph(0.022, 0x08080c, 0.05, 0.1, 0.07, 1, 5); bm.sph(0.022, 0x08080c, -0.03, 0.11, 0.07, 1, 5); bm.sph(0.022, 0x08080c, 0.01, 0.07, 0.11, 1, 5);
  const ballMesh = bm.mesh(); ballMesh.position.copy(rackPos);
  const ball = kit ? kit.body(g.ctx, ballMesh, { radius: BALL_R, mass: 7, bounce: 0.15, friction: 0.3, drag: 0.02, grabbable: true, grabRange: 6, ccd: true, angularDamping: 0.05 }) : null;
  if (ball) g.track(ball);
  const returnBall = () => { if (!ball || ball.removed || ball.held) return; ball.position.copy(rackPos); ball.velocity.set(0, 0, 0); ball.ph?.setAngularVelocity(0, 0, 0); g.sfx('bell', rackPos, 0.5); };

  // ---- the game
  let rolls = [], frame = 0, ballNo = 0, phase = 'ready', tThrow = 0, idleStill = 0, lvl = 1;
  const note = (txt, col) => { g.status(txt); const c = g.at(0, 1.2, -L); g.float(c, txt, col ?? 0xffe27a); };
  const frameText = () => `Frame ${Math.min(10, frame + 1)}/10  ball ${ballNo + 1}`;
  const rackAll = () => { pins.forEach(rackPin); };
  function evaluate() {
    judge();
    const nowDown = pins.filter((p) => p.down && !p.out); const n = nowDown.length;
    const wasStanding = 10 - pins.filter((p) => p.out).length; // pins in play before this ball
    rolls.push(n); const total = scoreRolls(rolls); g.setScore(total);
    const center = g.at(0, 0.9, -L - 0.3);
    const strike = n === wasStanding && wasStanding === 10, spare = n === wasStanding && wasStanding < 10 && (frame < 9 ? ballNo === 1 : true);
    if (n > 0) g.pop(center, 10 + n * 2, 'puff');
    if (strike) { g.float(center, 'STRIKE!', 0xffe27a); g.pop(center, 60, 'confetti'); g.sfx('big'); g.sfx('cheer'); g.note('Bowled a strike.', false); }
    else if (spare) { g.float(center, 'SPARE!', 0x7fe3a0); g.pop(center, 30, 'spark'); g.sfx('win'); }
    else if (n === 0) { g.float(center, 'Miss', 0xff7a6b); g.sfx('miss'); }
    else { g.float(center, `${n} down`, 0xeceeff); g.sfx('coin', center); }
    // decide what comes next
    let done = false, rack = false;
    if (frame < 9) { if (ballNo === 0 && n === 10) { frame++; ballNo = 0; rack = true; } else if (ballNo === 1) { frame++; ballNo = 0; rack = true; } else { ballNo = 1; } }
    else {
      let k = 0, i = 0; for (let f = 0; f < 9; f++) i += rolls[i] === 10 ? 1 : 2; k = rolls.length - i; // rolls thrown in frame 10
      const a = rolls[i], b = rolls[i + 1];
      if (k === 1) { ballNo = 1; if (a === 10) rack = true; }
      else if (k === 2) { if (a === 10 || a + b === 10) { ballNo = 2; if (a === 10 && b === 10 || a + b === 10) rack = true; } else done = true; }
      else done = true;
    }
    if (done) { g.end({ score: total, rating: total / meta.par, detail: `${rolls.length} balls` }); return; }
    // sweep the fallen, rack a fresh set when the frame is over, bring the ball home
    for (const p of pins) if (p.down) sweepPin(p);
    if (rack) { rackAll(); }
    g.later(1.0, () => { returnBall(); phase = 'ready'; g.status(frameText()); });
    phase = 'return'; g.status(strike ? 'Strike!' : spare ? 'Spare!' : `${n} pins`);
  }
  return {
    reset(level) {
      lvl = level; rolls = []; frame = 0; ballNo = 0; phase = 'ready'; tThrow = 0; idleStill = 0;
      placeBump(level <= 1); rackAll(); returnBall(); g.status('');
      for (const p of pins) p.h?.setDamping?.(0.05, 0.3);
    },
    play() { g.status(frameText()); },
    update(dt) {
      if (!ball || ball.removed) { g.end({ score: scoreRolls(rolls), rating: 0 }); return; }
      const lp = g.toLocal(ball.position.x, ball.position.z), sp = ball.velocity.length();
      if (phase === 'ready') {
        if (!ball.held && lp.z < -0.4 && ball.velocity.dot(_p.set(-Math.sin(g.yaw), 0, -Math.cos(g.yaw))) > 1.2) { phase = 'rolling'; tThrow = 0; g.sfx('whoosh', ball.position); }
        // a dropped ball that went nowhere comes back by itself (never a soft lock)
        if (!ball.held && sp < 0.2 && (lp.z > -0.4 || lp.z < -L - 3)) { idleStill += dt; if (idleStill > 6) { idleStill = 0; returnBall(); } } else idleStill = 0;
        if (ball.position.y < g.y - 3) returnBall();
      } else if (phase === 'rolling') {
        tThrow += dt;
        const gone = lp.z < -L - 0.9 || sp < 0.3 || Math.abs(lp.x) > 2.5 || ball.position.y < g.y - 2;
        if ((tThrow > 1.4 && gone && !pinsMoving()) || tThrow > 9) { phase = 'eval'; evaluate(); }
      }
    },
    stop() { for (const p of pins) rackPin(p); },
    info: { planeY, get rolls() { return rolls; }, get pins() { return pins; }, get ball() { return ball; }, get phase() { return phase; }, rackPos },
  };
}
