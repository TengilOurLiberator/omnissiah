// games/football.js - penalty shoot-out: five penalties against a goblin keeper. Kick (foot proxy at the player's feet / a fast hand swung through the ball),
// force-push it, or grab and throw it. Exports makeKicker (shared with footballmatch.js).
export const meta = {
  name: 'football', title: 'Penalty Shoot-out', aliases: ['penalty', 'penalties', 'soccer', 'shootout', 'shoot-out', 'penalty kick', 'goalkeeper', 'kick the ball'], icon: '⚽',
  description: 'five penalties against a goblin goalkeeper: kick, push or throw the ball past him; corners score extra', hint: 'Kick or throw the ball past the goblin', distance: 0, size: 11, par: 560, physics: true,
};
export const BALL_R = 0.11;

// ---- shared: the player's strikers. foot = head xz projected to the floor (+25 cm ahead); a hand (no weapon, not grabbing) swung through the ball also kicks it.
export function makeKicker(g) {
  const { THREE } = g, V3 = THREE.Vector3, hs = g.hands;
  const mk = (kind, r, base, gain, minClose, hand) => ({ kind, r, base, gain, minClose, hand, p: new V3(), q: new V3(), v: new V3(), ok: false, has: false, last: -9 });
  const S = [mk('foot', 0.17, 2.4, 1.7, 0.5, null), mk('hand', 0.1, 2.0, 1.45, 1.6, 'left'), mk('hand', 0.1, 2.0, 1.45, 1.6, 'right')];
  const _d = new V3(), _c = new V3(), _n = new V3(), out = { kind: '', speed: 0, hand: null };
  const K = {
    S, assist: 0.8,
    // goal: { x, z } in venue-local coords the kick is gently bent toward (or null). Returns out {kind, speed, hand} when it kicked the ball, else null.
    update(dt, ball, goal, now) {
      const hd = g.head, f = g.gctx.player.forward; let fl = Math.hypot(f.x, f.z) || 1;
      const ft = S[0]; ft.q.copy(ft.p); ft.p.set(hd.x + f.x / fl * 0.25, g.groundAt(hd.x, hd.z) + 0.1, hd.z + f.z / fl * 0.25);
      ft.v.subVectors(ft.p, ft.q).multiplyScalar(1 / Math.max(dt, 1e-3)); ft.v.y = 0; if (ft.v.length() > 6) ft.v.setLength(6);
      if (!ft.has) { ft.v.set(0, 0, 0); ft.has = true; } ft.ok = true;
      for (let i = 1; i < 3; i++) {
        const s = S[i], h = hs[i - 1]; s.q.copy(s.p);
        s.ok = !!(h && h.ok) && !g.world.weapons?.held?.[s.hand] && !h.inp.down?.squeeze && ball.held !== s.hand;
        if (!s.ok) { s.has = false; continue; }
        s.p.copy(h.pos); s.v.copy(h.vel); if (!s.has) { s.q.copy(s.p); s.has = true; s.v.set(0, 0, 0); }
      }
      if (ball.held || ball.removed) return null;
      for (const s of S) {
        if (!s.ok || now - s.last < 0.22) continue;
        _d.subVectors(s.p, s.q); const l2 = _d.lengthSq(), tt = l2 > 1e-8 ? Math.max(0, Math.min(1, _c.subVectors(ball.position, s.q).dot(_d) / l2)) : 1;
        _c.copy(s.q).addScaledVector(_d, tt); _n.subVectors(ball.position, _c); const d = _n.length();
        if (d > s.r + BALL_R + 0.06 || d < 1e-5) continue;
        _n.multiplyScalar(1 / d);
        const sp = s.v.length(), closing = s.v.dot(_n) - ball.velocity.dot(_n);
        if (closing < s.minClose || sp < s.minClose) continue;
        const spd = Math.min(24, s.base + s.gain * Math.max(closing, sp * 0.8));
        let hx = s.v.x / sp * 0.65 + _n.x * 0.35, hz = s.v.z / sp * 0.65 + _n.z * 0.35; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
        if (goal) { // aim assist: pull the horizontal angle toward the goal (venue-local), 20 %
          const L = g.toLocal(ball.position.x, ball.position.z), a = Math.atan2(goal.x - L.x, -(goal.z - L.z)), cs = Math.cos(g.yaw), sn = Math.sin(g.yaw);
          const lx = hx * cs - hz * sn, lz = hx * sn + hz * cs; let da = Math.atan2(lx, -lz) - a; da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) < 1.0) { const na = a + da * K.assist; const nx = Math.sin(na), nz = -Math.cos(na); hx = nx * cs + nz * sn; hz = -nx * sn + nz * cs; }
        }
        const vy = spd * Math.max(0.06, Math.min(0.42, 0.1 + (s.v.y / sp) * 0.5 + _n.y * 0.25)), hsp = Math.sqrt(Math.max(0, spd * spd - vy * vy));
        ball.velocity.set(hx * hsp, vy, hz * hsp); ball.ph?.wake?.();
        s.last = now; out.kind = s.kind; out.speed = spd; out.hand = s.hand;
        if (s.hand) g.pulse(s.hand, 0.8, 70);
        return out;
      }
      return null;
    },
    // a force-push style spell: ball inside the cone gets pushed (unless the spell already shoved it: prevV is the velocity before the cast)
    spell(e, ball, prevV, now) {
      if (!e || !/push|force/.test(String(e.id)) || ball.removed || ball.held) return false;
      _n.subVectors(ball.position, e.origin); const d = _n.length(); if (d > 11 || d < 0.05 || _n.dot(e.direction) / d < 0.8) return false;
      if (ball.velocity.distanceTo(prevV) < 1.5) { ball.velocity.addScaledVector(e.direction, 14); ball.velocity.y += 1.2; }
      return true;
    },
  };
  return K;
}

export default function (g) {
  const { THREE } = g, kit = g.world.kit, K = g.k, W = g.world;
  const D = 8.5 * K, HW = 2.4 * K, H = 2.2 * K, SPOT = -0.85, KZ = -D + 0.55 * K, KH = Math.max(1.0, 1.75 * K);
  const GOAL = 100, CORNER = 40, TOP = 60, STREAK = 25, N = 5;
  const dh = D + 3.5, deck = g.deck(11 * Math.max(K, 0.8), dh, { x: 0, z: 1.2 - dh / 2, color: 0x4b8c3c, thick: 0.3 });
  const Yl = (lz) => deck.y(0, lz) - g.y;
  const Pw = (lx, h, lz, out) => g.at(lx, Yl(lz) + h, lz, out);
  const _L2 = { x: 0, z: 0 }, _L = { x: 0, z: 0 };
  const hOf = (p) => p.y - deck.y(0, g.toLocal(p.x, p.z, _L2).z); // height above the pitch
  const WHITE = 0xf2f2ee;
  // ---- pitch lines, penalty spot, goal frame (fixed bodies), net back stop
  const lines = g.builder(); const lz0 = -D, bx = 4 * K + 1.2;
  lines.box(2 * bx, 0.012, 0.09, WHITE, 0, 0.006, -D); lines.box(0.09, 0.012, 5.4, WHITE, -bx, 0.006, -D + 2.7 - 0.05); lines.box(0.09, 0.012, 5.4, WHITE, bx, 0.006, -D + 2.7 - 0.05);
  lines.box(2 * bx, 0.012, 0.09, WHITE, 0, 0.006, -D + 5.4); lines.cyl(0.1, 0.1, 0.012, WHITE, 0, 0.006, SPOT, 12); lines.box(0.09, 0.012, 1.4, WHITE, -HW - 0.7, 0.006, -D + 0.7); lines.box(0.09, 0.012, 1.4, WHITE, HW + 0.7, 0.006, -D + 0.7);
  const lm = g.add(lines.mesh()); lm.position.copy(Pw(0, 0.03, 0)); lm.position.y = deck.y(0, 0) + 0.005; lm.rotation.order = 'YXZ'; lm.rotation.y = g.yaw; lm.rotation.x = -deck.pitch; lm.userData.noShadow = true;
  const gm = (w, h, d, col, lx, hh, lz, solid) => { const m = g.add(g.box(w, h, d, col)); m.position.copy(Pw(lx, hh, lz)); m.rotation.y = g.yaw; if (solid) g.body(m, { type: 'fixed', shape: 'box', size: [w, h, d], group: 'prop', restitution: 0.5, friction: 0.3 }); return m; };
  const post = [gm(0.12, H + 0.06, 0.12, WHITE, -HW - 0.06, H / 2 + 0.03, -D, true), gm(0.12, H + 0.06, 0.12, WHITE, HW + 0.06, H / 2 + 0.03, -D, true), gm(2 * HW + 0.24, 0.12, 0.12, WHITE, 0, H + 0.06, -D, true)];
  const NZ = 1.3 * K, nb = g.builder(), NC = 0xdcdcdc;
  for (let x = -HW; x <= HW + 0.01; x += 0.3) nb.box(0.015, H, 0.015, NC, x, H / 2, 0); for (let h = 0.3; h < H + 0.01; h += 0.3) nb.box(2 * HW, 0.015, 0.015, NC, 0, h, 0);
  const netBack = g.add(nb.mesh()); netBack.position.copy(Pw(0, 0, -D - NZ)); netBack.rotation.y = g.yaw; netBack.userData.noShadow = true;
  const sb = g.builder();
  for (const s of [-1, 1]) { for (let z = 0; z <= NZ + 0.01; z += 0.325) sb.box(0.015, H, 0.015, NC, s * HW, H / 2, -z); for (let h = 0.3; h < H + 0.01; h += 0.3) sb.box(0.015, 0.015, NZ, NC, s * HW, h, -NZ / 2); }
  for (let x = -HW; x <= HW + 0.01; x += 0.6) sb.box(0.015, 0.015, NZ, NC, x, H, -NZ / 2);
  const netSide = g.add(sb.mesh()); netSide.position.copy(Pw(0, 0, -D)); netSide.rotation.y = g.yaw; netSide.userData.noShadow = true;
  const hid = (w, h, d, lx, hh, lz) => { const m = g.box(w, h, d, 0x000000); m.visible = false; m.position.copy(Pw(lx, hh, lz)); m.rotation.y = g.yaw; g.add(m); g.body(m, { type: 'fixed', shape: 'box', size: [w, h, d], group: 'prop', restitution: 0.03, friction: 0.9 }); };
  hid(2 * HW + 0.3, H, 0.1, 0, H / 2, -D - NZ); hid(0.1, H, NZ, -HW - 0.02, H / 2, -D - NZ / 2); hid(0.1, H, NZ, HW + 0.02, H / 2, -D - NZ / 2);
  const zones = [[-1, 1], [1, 1], [-1, 0], [1, 0]].map(([sx, up]) => { const m = g.add(g.cyl(0.32 * K, 0.32 * K, 0.01, up ? 0xffc83a : 0x5ad0ff, 0, 0, 0, { seg: 16, basic: true, opacity: 0.55 })); m.rotation.x = Math.PI / 2; m.rotation.y = g.yaw; m.position.copy(Pw(sx * (HW - 0.42 * K), up ? H - 0.42 * K : 0.42 * K, -D + 0.02)); m.userData.noShadow = true; return m; });
  // ---- the ball (own geometry), the keeper
  const bm = g.builder(); bm.sph(BALL_R, 0xf6f6f2, 0, 0, 0, 1, 12);
  for (const [a, b, c] of [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]]) bm.sph(0.042, 0x15151a, a * BALL_R * 0.54, b * BALL_R * 0.54, c * BALL_R * 0.54, 1, 5);
  const ballMesh = bm.mesh(), spotW = Pw(0, BALL_R + 0.012, SPOT); ballMesh.position.copy(spotW);
  const ball = kit ? kit.body(g.ctx, ballMesh, { radius: BALL_R, mass: 0.43, bounce: 0.62, friction: 0.5, drag: 0.12, grabbable: true, grabRange: 6, ccd: true, angularDamping: 0.5 }) : null;
  if (ball) g.track(ball);
  const keeper = kit ? kit.humanoid(g.ctx, { model: ['goblin'], height: KH, skin: 0x6fa04a, shirt: 0xf2d03b, pants: 0x2a2a38, hair: null, damageable: false, speed: 0 }) : null;
  if (keeper) { g.track(keeper); keeper.walls = false; }
  const kicker = makeKicker(g), goalPt = { x: 0, z: -D };
  // ---- state
  const now = () => g.gctx.clock.t, _kp = new THREE.Vector3(), prevV = new THREE.Vector3(), _w = new THREE.Vector3(), fwdW = g.at(0, 0, -1).sub(g.at(0, 0, 0));
  const LV = { delay: [0.42, 0.34, 0.27, 0.2, 0.14], right: [0.3, 0.4, 0.5, 0.6, 0.7], dive: [0.45, 0.4, 0.36, 0.32, 0.28], reach: [0.95, 1.0, 1.05, 1.1, 1.18] };
  let lvl = 1, phase = 'ready', att = 0, goals = 0, streak = 0, total = 0, lastTouch = -9, flightT = 0, retT = 0, readyT = 0, resolved = '', pLz = 0, pLx = 0, pH = 0, netT = 1, idleT = 0, postT = 0, playing = false;
  const kp = { state: 'idle', t: 0, delay: 0, sx: 0, tx: 0, ty: 0.9, side: 0, high: false, x: 0, saved: false, u: 0 };
  const results = [];
  const say = (txt) => g.status(txt);
  const returnBall = (force) => {
    if (!ball || ball.removed || (ball.held && !force)) return false;
    ball.position.copy(spotW); ball.velocity.set(0, 0, 0); ball.ph?.setAngularVelocity?.(0, 0, 0); ball.ph?.wake?.(); return true;
  };
  if (ball) {
    ball.onRelease(() => { lastTouch = now(); });
    ball.onHit((e) => { // post / bar feedback by position
      if (!e.static || e.speed < 3 || now() - postT < 0.4) return; const L = g.toLocal(e.point.x, e.point.z), h = hOf(e.point);
      if (Math.abs(L.z + D) < 0.35 && (Math.abs(Math.abs(L.x) - HW) < 0.25 || Math.abs(h - H) < 0.25)) { postT = now(); g.sfx('clang', e.point); g.float(e.point, 'POST!', 0xffffff); g.pulse('both', 0.5, 60); if (playing) resolved = resolved || 'post'; }
    });
  }
  const off = g.ctx.events?.on?.('spell:cast', (e) => { if (ball && !ball.removed && kicker.spell(e, ball, prevV, now())) lastTouch = now(); });
  function keeperReact() { // called when a shot starts: predict, maybe guess wrong
    const L = g.toLocal(ball.position.x, ball.position.z), cs = Math.cos(g.yaw), sn = Math.sin(g.yaw), v = ball.velocity;
    const lvx = v.x * cs - v.z * sn, lvz = v.x * sn + v.z * cs, h0 = hOf(ball.position);
    kp.state = 'idle'; if (lvz > -0.6) return;
    const t = (-D - L.z) / lvz, xp = L.x + lvx * t, hp = Math.max(0.1, h0 + v.y * t - 4.9 * t * t);
    kp.sx = kp.x; kp.delay = LV.delay[lvl - 1] * (0.8 + Math.random() * 0.4);
    if (Math.random() < LV.right[lvl - 1]) { kp.tx = Math.max(-HW * 0.85, Math.min(HW * 0.85, xp * 0.92)); kp.high = hp > 0.62 * H; }
    else { kp.tx = (Math.random() < 0.5 ? -1 : 1) * HW * (0.15 + Math.random() * 0.55); kp.high = Math.random() < 0.3; }
    kp.ty = kp.high ? KH * 0.9 : KH * 0.42; kp.side = kp.tx > kp.sx ? 1 : -1; if (Math.abs(kp.tx - kp.sx) < 0.35 * K) kp.side = 0;
    kp.state = 'react'; kp.t = 0; kp.u = 0; kp.saved = false;
  }
  function keeperStep(dt, t) {
    if (!keeper || keeper.removed) return;
    if (kp.state === 'react') { kp.t += dt; if (kp.t >= kp.delay) { kp.state = 'dive'; kp.t = 0; } }
    else if (kp.state === 'dive') { kp.t += dt; const dd = LV.dive[lvl - 1]; kp.u = Math.min(1, kp.t / dd); const e = 1 - (1 - kp.u) * (1 - kp.u); kp.x = kp.sx + (kp.tx - kp.sx) * e; }
    else if (kp.state === 'idle' || kp.state === 'reset') { // sway on the line; after a dive walk back to the middle
      const want = kp.state === 'reset' ? 0 : Math.sin(t * 1.6) * 0.3 * K; kp.x += (want - kp.x) * Math.min(1, dt * (kp.state === 'reset' ? 3 : 2)); kp.u = Math.max(0, kp.u - dt * 2.5);
      if (kp.state === 'reset' && Math.abs(kp.x) < 0.08 && kp.u <= 0) kp.state = 'idle';
    }
    const u = kp.u; g.at(kp.x, 0, KZ, _kp); keeper.group.position.x = _kp.x; keeper.group.position.z = _kp.z;
    keeper.faceTo(g.at(kp.x, 0, KZ + 6, _w), 0.2); if (!keeper.lookTarget && ball) keeper.lookAt(ball.position);
    // the dive (applied on top of the actor's own animation): lean toward the side, lift off the ground; he faces the player so venue +x is his pivot -x
    const piv = keeper.pivot, lean = kp.side * u * (kp.high ? 1.15 : 1.4);
    piv.rotation.z = lean; piv.position.y = (kp.high ? 0.55 : 0.3) * KH * Math.sin(u * Math.PI * 0.5) * (kp.side ? 1 : 0.5) + (kp.side ? 0 : 0.2 * KH * u);
    piv.position.x = -kp.side * 0.28 * KH * u;
  }
  function blocks(lx, h) { // keeper reach ellipse at the moment the ball crosses his plane
    const u = kp.state === 'dive' ? kp.u : kp.state === 'react' ? 0 : kp.u, rx = ((0.5 + (LV.reach[lvl - 1] - 0.5) * u) * 0.85) * Math.max(K, 0.75) * (kp.side || u > 0.3 ? 1 : 0.9), ry = (0.95 - 0.38 * u) * Math.max(K, 0.75);
    const cy = 0.95 * K + ((kp.high ? 1.55 * K : 0.62 * K) - 0.95 * K) * u;
    return ((lx - kp.x) / rx) ** 2 + ((h - cy) / ry) ** 2 < 1;
  }
  function resolve(kind, lx, h) {
    if (phase !== 'flight') return; phase = 'return'; retT = kind === 'goal' ? 2.2 : 1.8; results.push(kind);
    const at = Pw(lx, Math.max(0.6, h), -D + 0.3, _w).clone();
    if (kind === 'goal') {
      streak++; goals++; netT = 0; kp.state = 'idle';
      const top = h > H - 0.7 * K && Math.abs(lx) > HW - 0.8 * K, low = h < 0.7 * K && Math.abs(lx) > HW - 0.8 * K;
      const bonus = top ? TOP : low ? CORNER : 0, sb2 = streak > 1 ? STREAK * (streak - 1) : 0, pts = GOAL + bonus + sb2;
      g.addScore(pts, at, top ? `TOP CORNER +${pts}` : low ? `CORNER +${pts}` : `GOAL +${pts}`); g.sfx('big'); g.sfx('cheer'); g.pop(at, 50, 'confetti'); g.pulse('both', 0.6, 120);
      total += pts; say(`GOAL!  ${goals}/${att + 1}${streak > 1 ? `  streak x${streak}` : ''}`);
      if (keeper && !keeper.removed) keeper.say('Gah!', 1.3);
    } else if (kind === 'saved') { streak = 0; g.float(at, 'SAVED!', 0xff7a6b); g.sfx('thud', at); g.sfx('miss'); say('Saved by the goblin'); if (keeper && !keeper.removed) { keeper.attackAnim(0.05, 'melee'); keeper.say('Ha!', 1.3); } }
    else { streak = 0; const txt = kind === 'post' ? 'OFF THE POST' : kind === 'over' ? 'OVER!' : kind === 'wide' ? 'WIDE!' : 'MISS'; g.float(at, txt, 0xff9a6b); g.sfx('miss'); say(txt); }
  }
  function nextAttempt() {
    att++; if (att >= N) { const sc = total; g.end({ score: sc, rating: sc / meta.par, text: `${goals}/${N} goals`, detail: `${goals}/${N} goals` }); return; }
    phase = 'ready'; readyT = 0; resolved = ''; kp.state = 'reset'; returnBall(true); say(`Penalty ${att + 1}/${N}  goals ${goals}`);
  }
  function common(dt, t) {
    if (!ball || ball.removed) return null;
    const hit = kicker.update(dt, ball, goalPt, now()); if (hit) { lastTouch = now(); g.sfx('thud', ball.position, 0.7); }
    prevV.copy(ball.velocity); return hit;
  }
  function flightStep(dt) {
    flightT += dt; const p = ball.position, L = g.toLocal(p.x, p.z, _L), h = hOf(p);
    if (!resolved || resolved === 'post') {
      if (pLz > -D && L.z <= -D) {
        const u = (pLz + D) / (pLz - L.z || 1), cx = pLx + (L.x - pLx) * u, ch = pH + (h - pH) * u;
        if (Math.abs(cx) < HW - 0.04 && ch < H - 0.04) resolve('goal', cx, ch); else resolve(ch >= H - 0.04 ? 'over' : 'wide', cx, ch);
      }
    }
    if (phase === 'flight' && pLz > KZ && L.z <= KZ && !kp.saved) { const u = (pLz - KZ) / (pLz - L.z || 1), cx = pLx + (L.x - pLx) * u, ch = pH + (h - pH) * u; if (Math.abs(cx) < HW + 0.5 && blocks(cx, ch)) { kp.saved = true; const v = ball.velocity, cs = Math.cos(g.yaw), sn = Math.sin(g.yaw); const lvx = v.x * cs - v.z * sn, lvz = v.x * sn + v.z * cs; const nx = (lvx * 0.25 + (cx - kp.x) * 3.5), nz = -lvz * 0.35 + 2; v.set(nx * cs + nz * sn, Math.abs(v.y) * 0.3 + 2.8, -nx * sn + nz * cs); resolve('saved', cx, ch); } }
    pLz = L.z; pLx = L.x; pH = h;
    if (phase === 'flight' && (flightT > 8 || (flightT > 1.2 && ball.velocity.lengthSq() < 0.1) || p.y < g.y - 3 || Math.abs(L.x) > 14 || L.z > 6 || (!ball.held && L.z < -D - 4))) resolve(resolved === 'post' ? 'post' : 'miss', L.x, h);
  }
  return {
    reset(level) {
      lvl = level; phase = 'ready'; att = 0; goals = 0; streak = 0; total = 0; resolved = ''; results.length = 0; kp.state = 'idle'; kp.x = 0; kp.u = 0; kp.side = 0; playing = false; netT = 1; idleT = 0;
      returnBall(true); g.status(''); if (keeper) keeper.group.rotation.y = Math.PI * 0 + g.yaw + Math.PI;
    },
    play(level) { lvl = level; playing = true; phase = 'ready'; readyT = 0; say(`Penalty 1/${N}  kick it past him`); },
    update(dt, t) {
      if (!ball || ball.removed) { g.end({ score: total, rating: 0 }); return; }
      common(dt, t); keeperStep(dt, t); stepNet(dt);
      if (phase === 'ready') {
        readyT += dt; const sp = ball.velocity.length(), L = g.toLocal(ball.position.x, ball.position.z, _L);
        if (!ball.held && ((now() - lastTouch < 1.2 && sp > 2.8) || Math.hypot(L.x, L.z - SPOT) > 2.5)) { phase = 'flight'; flightT = 0; resolved = ''; pLz = L.z; pLx = L.x; pH = hOf(ball.position); keeperReact(); g.sfx('whoosh', ball.position); }
        else if (!ball.held && readyT > 25) { readyT = 0; returnBall(); g.float(Pw(0, 1.4, SPOT - 0.5), 'Kick it!', 0xffe27a); }
      } else if (phase === 'flight') flightStep(dt);
      else if (phase === 'return') { retT -= dt; if (retT <= 0) nextAttempt(); }
    },
    idle(dt, t) { // practice: kick the ball about, it comes home by itself
      common(dt, t); keeperStep(dt, t); stepNet(dt);
      if (!ball || ball.removed) return;
      const L = g.toLocal(ball.position.x, ball.position.z, _L); idleT = ball.velocity.lengthSq() < 0.04 && Math.hypot(L.x, L.z - SPOT) > 0.6 ? idleT + dt : 0;
      if (!ball.held && (idleT > 5 || ball.position.y < g.y - 3 || Math.abs(L.x) > 25 || L.z < -D - 12)) { idleT = 0; returnBall(); }
    },
    stop() { playing = false; phase = 'ready'; returnBall(true); kp.state = 'idle'; },
    dispose() { try { off?.(); } catch (err) { /* gone */ } },
    info: { get ball() { return ball; }, get keeper() { return keeper; }, kp, get phase() { return phase; }, results, D, HW, H, SPOT, spotW, Pw, hOf, get att() { return att; }, get goals() { return goals; }, get total() { return total; }, kicker, set lastTouch(v) { lastTouch = v; } },
  };
  function stepNet(dt) { if (netT < 1) { netT = Math.min(1, netT + dt * 1.6); netBack.position.copy(Pw(0, 0, -D - NZ)).addScaledVector(fwdW, Math.sin(netT * Math.PI) * 0.35 * (1 - netT)); } }
}



