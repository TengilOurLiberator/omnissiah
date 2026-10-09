// games/siege.js - CATAPULT SIEGE: grab a boulder from the pile, drop it in the bucket, aim (point where the catapult should shoot), pull the lever back and the arm
// hurls the boulder along a real ballistic arc into a castle of 35 physics blocks with six goblins, two of them perched on the walls and towers. Six shots.
// Score = 5 per block shifted off its place + 100 per goblin + 150 for the banner. Lever: grip it and pull (power = how far), or point at it and HOLD the trigger (power builds up).
export const meta = {
  name: 'siege', title: 'Catapult Siege', aliases: ['catapult', 'trebuchet', 'castle siege', 'siege engine', 'knock down the castle'], icon: 'ðŸ¯',
  description: 'load a boulder into the catapult, aim and pull the lever: six shots to bring down a block castle, its goblins and its banner', hint: 'Boulder in the bucket, aim, pull the lever', distance: 0, size: 14, par: 700, physics: true,
};

const SHOTS = 6, TH = 0.78, L = 2.0, PY = 1.75, A_REST = 2.2, A_REL = 0.8, A_END = -0.7, PSTAR = 0.5, G = 9.8;
export default function (g) {
  const { THREE } = g, W = g.world, kit = W.kit, K = g.k, KS = Math.max(K, 0.8), ev = g.gctx.events, V3 = THREE.Vector3;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const gw = (lx, lz, h = 0) => { const p = g.at(lx, 0, lz); p.y = g.groundAt(p.x, p.z) + h; return p; };
  const dispose = (m) => { g.track({ dispose: () => m.geometry.dispose() }); return m; };
  const CATZ = -3.4, DIST = 22 * K, CZ0 = CATZ - DIST; // catapult z and the front face of the castle (local g coordinates)
  g.boardAt(-3.0 * KS, 1.8, -3.0 * KS); g.pedestalAt(-2.0 * KS, 0.3);
  const ax = Math.sin(g.yaw), az = Math.cos(g.yaw); // world direction of local +z (toward the player)

  // ---- the castle plinth (a flat deck: terrain is rolling) and its 35 dynamic blocks
  const deck = g.deck(9.6, 5.8, { x: 0, z: CZ0 - 1.4, flat: true, thick: 2.4, color: 0x6e6a5a, friction: 0.9 });
  const TOP = deck.y(0, CZ0), blocks = [];
  const mkBlock = (lx, ly, lz, w, h, d, color, role) => {
    const p = g.at(lx, 0, lz); p.y = TOP + ly;
    const m = g.box(w, h, d, color); m.position.copy(p); m.rotation.y = g.yaw; g.add(m, g.root);
    const hd = g.body(m, { shape: 'box', size: [w, h, d], mass: 40 * w * h * d / 0.3, friction: 0.9, restitution: 0.03, linearDamping: 0.05, angularDamping: 0.8, group: 'default' });
    const b = { m, h: hd, p0: p.clone(), q0: m.quaternion.clone(), role, down: false }; blocks.push(b); return b;
  };
  const wall = [], BW = 1.01;
  for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) wall.push(mkBlock((i - 2) * BW, 0.25 + r * 0.5, CZ0 - 0.3, 1.0, 0.5, 0.6, (i + r) % 2 ? 0x9a968c : 0x8a867c, 'wall'));
  for (const i of [0, 2, 4]) mkBlock((i - 2) * BW, 1.75, CZ0 - 0.3, 0.8, 0.5, 0.6, 0xa09c92, 'merlon');
  for (const s of [-1, 1]) for (let r = 0; r < (s < 0 ? 5 : 4); r++) mkBlock(s * 2.97, 0.25 + r * 0.5, CZ0 - 0.45, 0.9, 0.5, 0.9, 0x7f7b72, 'tower');
  const slabL = mkBlock(-2.97, 2.625, CZ0 - 0.45, 1.3, 0.25, 1.3, 0x6a655c, 'slab'), slabR = mkBlock(2.97, 2.125, CZ0 - 0.45, 1.3, 0.25, 1.3, 0x6a655c, 'slab');
  for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) mkBlock((i - 1) * BW, 0.25 + r * 0.5, CZ0 - 3.0, 1.0, 0.5, 0.6, 0x8a867c, 'back');
  // the banner: pole + cloth in one body on the top (left) tower
  const fb = g.builder(); fb.box(0.07, 1.0, 0.07, 0x5a3e24, 0, 0.5, 0); fb.box(0.5, 0.32, 0.03, 0xd8402a, 0.28, 0.82, 0);
  const flagM = g.add(fb.mesh(), g.root); const fp = g.at(-2.97, 0, CZ0 - 0.45); fp.y = TOP + 2.75; flagM.position.copy(fp); flagM.rotation.y = g.yaw;
  const flagH = g.body(flagM, { shape: 'box', size: [0.55, 1.0, 0.08], mass: 2, friction: 0.8, restitution: 0.05 });
  const flag = { m: flagM, h: flagH, p0: fp.clone().setY(fp.y + 0.5), q0: flagM.quaternion.clone(), down: false };
  const all = flagH ? blocks.concat([flag]) : blocks;
  const pose = (b) => b.h ?? { position: b.m.position, quaternion: b.m.quaternion, velocity: { lengthSq: () => 0 } };

  // ---- the catapult: base, arm (pivot at the axle), level cup, lever console, boulder pile
  const catPos = gw(0, CATZ), catG = new THREE.Group(); catG.position.copy(catPos); g.add(catG);
  { const b = g.builder(); for (const s of [-1, 1]) { b.box(0.2, 0.22, 2.8, 0x6b4a2b, s * 0.75, 0.42, 0); b.box(0.16, 1.4, 0.18, 0x7a5230, s * 0.6, 1.1, 0); for (const z of [-1.05, 1.05]) b.cyl(0.34, 0.34, 0.16, 0x3a2a1a, s * 0.92, 0.34, z, 10, 0, 0, Math.PI / 2); }
    for (const z of [-1.05, 1.05]) b.box(1.7, 0.2, 0.2, 0x5a3e24, 0, 0.42, z); b.cyl(0.07, 0.07, 1.5, 0x3a3d46, 0, PY, 0, 8, 0, 0, Math.PI / 2); catG.add(ownGeo(b.mesh())); }
  const armG = new THREE.Group(); armG.position.set(0, PY, 0); catG.add(armG);
  { const b = g.builder(); b.box(0.14, 2.6, 0.14, 0x7a5230, 0, 0.7, 0); b.box(0.5, 0.5, 0.5, 0x6a6d76, 0, -0.7, 0); armG.add(ownGeo(b.mesh())); }
  const cup = (() => { const b = g.builder(); b.box(0.5, 0.07, 0.5, 0x6b4a2b, 0, 0, 0); for (const s of [-1, 1]) { b.box(0.5, 0.2, 0.06, 0x5a3e24, 0, 0.1, s * 0.22); b.box(0.06, 0.2, 0.5, 0x5a3e24, s * 0.22, 0.1, 0); } const m = ownGeo(b.mesh()); m.position.set(0, L + 0.05, 0); armG.add(m); return m; })();
  const lvPos = gw(1.1 * KS, -1.2 * KS), lvG = new THREE.Group(); lvG.position.copy(lvPos); lvG.position.y += 0.7; g.add(lvG);
  { const b = g.builder(); b.cyl(0.13, 0.17, 0.7, 0x5a5d66, lvPos.x - g.x, 0.35 + lvPos.y - g.y, lvPos.z - g.z, 10); const cm = ownGeo(b.mesh()); cm.position.set(g.x, g.y, g.z); g.add(cm); }
  const stick = (() => { const b = g.builder(); b.box(0.06, 0.9, 0.06, 0x8a8d96, 0, 0.45, 0); b.sph(0.09, 0xd83a3a, 0, 0.95, 0, 1, 8); const m = ownGeo(b.mesh()); lvG.add(m); return m; })();
  const knob = new THREE.Object3D(); knob.position.set(0, 0.95, 0); lvG.add(knob);
  const lh0 = new V3(), _v = new V3(), _w = new V3(); lvG.rotation.x = -0.35; lvG.updateMatrixWorld(true); knob.getWorldPosition(lh0);
  const pileP = gw(-1.4 * KS, -1.7 * KS); { const b = g.builder(); b.cyl(0.55, 0.65, 0.12, 0x6a6d76, pileP.x - g.x, 0.06 + pileP.y - g.y, pileP.z - g.z, 12); for (const [dx, dz, r] of [[-0.3, 0.2, 0.22], [0.3, 0.2, 0.2], [0.05, -0.3, 0.21]]) b.sph(r, 0x7a7468, pileP.x - g.x + dx, pileP.y - g.y + 0.12 + r * 0.8, pileP.z - g.z + dz, 1, 8); const pm = ownGeo(b.mesh()); pm.position.set(g.x, g.y, g.z); g.add(pm); }
  const pileSlot = new V3(pileP.x, pileP.y + 0.12 + 0.3, pileP.z);
  const shotsLabel = kit?.label ? g.track(kit.label(g.ctx, 'SHOTS 6', { size: 0.08, position: { x: pileP.x, y: pileP.y + 1.1, z: pileP.z } })) : null;
  const dots = Array.from({ length: 16 }, () => { const d = g.add(g.sph(0.06, 0xffe27a, 0, 0, 0, { basic: true, seg: 6 })); d.visible = false; return d; });

  // ---- ballistics: velocity of a shot of power p, release point of the cup, and the speed that puts p = PSTAR onto the castle front
  const relOff = new V3(0, PY + L * Math.cos(A_REL), L * Math.sin(A_REL)); // release point in catapult-local space (+z = behind)
  const yawNow = () => g.yaw + aim;
  const releaseAt = (out, psi) => out.set(catPos.x + relOff.z * Math.sin(psi), catPos.y + relOff.y, catPos.z + relOff.z * Math.cos(psi));
  const front = g.at(0, 0, CZ0); const dh = Math.hypot(front.x - releaseAt(_v, g.yaw).x, front.z - _v.z), dy0 = _v.y - (TOP + 1.0);
  const vstar = Math.sqrt(4.9 * dh * dh / (Math.cos(TH) ** 2 * (dy0 + dh * Math.tan(TH))));
  const speedOf = (p) => (vstar / (0.78 + 0.44 * PSTAR)) * (0.78 + 0.44 * p);

  // ---- state
  let lvl = 1, aim = 0, aimT = 0, shots = SHOTS, playing = false, phase = 'idle', quiet = 0, tEnd = 0, flushT = 0, pendB = 0, lastB = new V3(), alive = 0, nGob = 0, tTaunt = 5, hintP = 0.5, hintKey = '';
  const bls = [], gobs = [], arm = { t: -1, a: A_REST, p: 0, rel: false, bl: null }, lv = { mode: 'idle', hand: 0, pull: 0, vis: 0 };
  const killsOf = { n: 0 };
  const boulderBody = () => {
    const b = g.builder(); b.sph(0.27, 0x7a7468, 0, 0, 0, 1, 12); b.sph(0.1, 0x5e5a50, 0.18, 0.12, 0.15, 1, 6); b.sph(0.08, 0x8e887a, -0.16, 0.14, -0.17, 1, 6);
    const m = b.mesh(); m.position.copy(pileSlot);
    const body = kit.body(g.ctx, m, { radius: 0.27, mass: 30, bounce: 0.2, friction: 0.7, drag: 0.02, grabbable: true, grabRange: 6, damage: 14, from: 'player', ccd: true });
    return g.round(body);
  };
  function nextBoulder() {
    if (shots <= 0 || !kit) return; const body = boulderBody(); if (!body) return;
    const bl = { b: body, phase: 'pile', t: 0, still: 0, splashT: 0 }; bls.push(bl);
    body.onHit((e) => { if (bl.phase === 'flying' && bl.splashT <= 0 && e.speed > 3) { bl.splashT = 0.3; splash(e.point, e.speed, e.other); } });
  }
  function splash(pt, speed, other) { // boulder impact: area hit (goblins, anything damageable) + dust
    kit.hit(pt, 1.7, 8 + speed * 1.2, { from: 'player', kind: 'blunt', force: Math.min(10, speed * 0.6) }); g.pop(pt, 14, 'puff'); g.sfx('boom', pt, 0.5); g.pulse('both', 0.4, 80);
  }
  const bucket = (out) => { cup.getWorldPosition(out); out.y += 0.3; return out; };
  function stepBoulders(dt) {
    for (let i = bls.length - 1; i >= 0; i--) {
      const bl = bls[i], b = bl.b; if (b.removed) { bls.splice(i, 1); continue; }
      bl.splashT -= dt;
      if (bl.phase === 'pile' || bl.phase === 'loaded') {
        if (b.held) { if (bl.phase === 'loaded') { b.invMass = 1 / b.mass; bl.phase = 'pile'; arm.bl = null; } bl.still = 0; continue; }
        if (bl.phase === 'pile') {
          bucket(_w); const dx = b.position.x - _w.x, dz = b.position.z - _w.z, dy = b.position.y - _w.y;
          if (dx * dx + dz * dz < 0.5 && dy > -0.5 && dy < 1.6 && arm.t < 0 && Math.abs(arm.a - A_REST) < 0.05 && !arm.bl) { bl.phase = 'loaded'; arm.bl = bl; b.invMass = 0; g.sfx('thud', _w, 0.6); g.float(_w, 'LOADED', 0x7fe3a0); g.pulse('both', 0.3, 50); }
          else { bl.still = b.velocity.lengthSq() < 0.05 && Math.hypot(b.position.x - pileSlot.x, b.position.z - pileSlot.z) > 0.5 ? bl.still + dt : 0; if (bl.still > 5 || b.position.y < g.y - 4) { b.position.copy(pileSlot); b.velocity.set(0, 0, 0); b.ph?.setAngularVelocity(0, 0, 0); bl.still = 0; } }
        } else { bucket(_w); b.position.copy(_w); b.mesh.position.copy(_w); b.velocity.set(0, 0, 0); }
      } else if (bl.phase === 'flying') {
        bl.t += dt; bl.still = b.velocity.lengthSq() < 0.36 ? bl.still + dt : 0;
        if (bl.still > 0.9 || bl.t > 9 || b.position.y < g.y - 4) { bl.phase = 'spent'; bl.t = 0; }
      } else { bl.t += dt; if (bl.t > 5) { b.remove(); bls.splice(i, 1); } }
    }
  }

  // ---- firing
  function fire(p) {
    const bl = arm.bl; if (!playing) return;
    if (!bl || bl.phase !== 'loaded' || arm.t >= 0 || shots <= 0) { g.float(lh0, bl ? 'Wait...' : 'Load a boulder first', 0xff7a6b); g.sfx('miss', lh0, 0.6); return; }
    arm.t = 0; arm.p = p; arm.rel = false; shots--; shotsLabel?.set(`SHOTS ${shots}`); g.sfx('whoosh', catPos, 0.7); g.pulse('both', 0.6, 120);
  }
  function stepArm(dt) {
    if (arm.t >= 0) {
      arm.t += dt; const u = Math.min(1, arm.t / 0.4); arm.a = A_REST + (A_END - A_REST) * u * u;
      if (!arm.rel && arm.a <= A_REL) {
        arm.rel = true; const bl = arm.bl, b = bl.b, psi = yawNow(), v = speedOf(arm.p), c = Math.cos(TH);
        bucket(_w); b.invMass = 1 / b.mass; b.position.copy(_w); b.velocity.set(-Math.sin(psi) * c * v, Math.sin(TH) * v, -Math.cos(psi) * c * v); bl.phase = 'flying'; bl.t = 0; bl.still = 0; arm.bl = null;
        g.sfx('big', _w, 0.5); g.pop(_w, 10, 'puff'); g.later(0.9, nextBoulder);
        if (shots === 0) tEnd = 0;
      }
      if (u >= 1) arm.t = -1;
    } else if (arm.a < A_REST) arm.a = Math.min(A_REST, arm.a + dt * 1.5);
    armG.rotation.x = arm.a; cup.rotation.x = -arm.a;
    catG.rotation.y = yawNow(); catG.updateMatrixWorld(true);
  }
  // ---- input: aim with the pointing hand, lever by grip-and-pull or point-and-hold
  function pointsAt(h, t, r) {
    const p = h.inp.position, d = h.inp.direction, dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, k = dx * d.x + dy * d.y + dz * d.z;
    if (k < 0.1 || k > 8) return false; const ex = p.x + d.x * k - t.x, ey = p.y + d.y * k - t.y, ez = p.z + d.z * k - t.z; return ex * ex + ey * ey + ez * ez < r * r;
  }
  function input(dt) {
    const HS = g.hands;
    if (lv.mode !== 'idle') {
      const h = HS[lv.hand], on = h.ok && (lv.mode === 'grip' ? h.inp.down.squeeze || h.inp.down.trigger : h.inp.down.trigger);
      if (on) lv.pull = lv.mode === 'grip' ? clamp(((h.pos.x - lh0.x) * ax + (h.pos.z - lh0.z) * az) / 0.5, 0, 1) : Math.min(1, lv.pull + dt * 0.7);
      else { const p = lv.pull; lv.mode = 'idle'; if (p > 0.15) fire(p); }
    } else {
      for (let i = 0; i < 2; i++) {
        const h = HS[i]; if (!h.ok) continue; const held = W.weapons?.held?.[h.name], dx = h.pos.x - lh0.x, dy = h.pos.y - lh0.y, dz = h.pos.z - lh0.z;
        if (dx * dx + dy * dy + dz * dz < 0.09 && (h.inp.pressed?.('squeeze') || (!held && h.inp.pressed?.('trigger')))) { lv.mode = 'grip'; lv.hand = i; lv.pull = 0; break; }
        if (!held && h.inp.pressed?.('trigger') && pointsAt(h, lh0, 0.3)) { lv.mode = 'charge'; lv.hand = i; lv.pull = 0; break; }
      }
      if (lv.mode === 'idle') for (let k = 0; k < 2; k++) { // aim: the free pointing hand (not on the trigger, not pointing at the lever)
        const h = HS[1 - k]; if (!h.ok || h.inp.down.trigger || h.inp.down.squeeze || arm.t >= 0) continue;
        const d = h.inp.direction; if (Math.hypot(d.x, d.z) < 0.7 || pointsAt(h, lh0, 0.6)) continue;
        let a = Math.atan2(-d.x, -d.z) - g.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) > 1.1) continue;
        aimT = clamp(a, -0.5, 0.5); if (Math.abs(aimT) < 0.04) aimT = 0; break;
      }
    }
    aim += (aimT - aim) * Math.min(1, dt * 5);
    lv.vis += ((lv.mode === 'idle' ? 0 : lv.pull) - lv.vis) * Math.min(1, dt * (lv.mode === 'idle' ? 6 : 20)); lvG.rotation.x = -0.35 + 0.95 * lv.vis; lvG.updateMatrixWorld(true);
  }
  function hint() { // dotted trajectory of the next shot while a boulder sits in the bucket
    const on = arm.bl && arm.t < 0 && playing, p = lv.mode === 'idle' ? 0.5 : lv.pull, key = on ? `${aim.toFixed(2)}|${p.toFixed(2)}` : '';
    if (key === hintKey) return; hintKey = key;
    if (!on) { for (const d of dots) d.visible = false; return; }
    const psi = yawNow(), v = speedOf(p), c = Math.cos(TH); releaseAt(_v, psi);
    for (let i = 0; i < dots.length; i++) { const t = 0.2 + i * 0.22, x = _v.x - Math.sin(psi) * c * v * t, z = _v.z - Math.cos(psi) * c * v * t, y = _v.y + Math.sin(TH) * v * t - 0.5 * G * t * t; dots[i].visible = y > g.groundAt(x, z); dots[i].position.set(x, y, z); }
  }

  // ---- goblins
  function perch(lx, lz, y, support) {
    const w = g.at(lx, 0, lz), gy = g.groundAt(w.x, w.z), h = g.spawn('goblin', { x: w.x, z: w.z, noPush: true, attack: 'none', wander: 0, leash: 1e5, hp: 12 + 3 * (lvl - 1), drops: [], yaw: Math.atan2(catPos.x - w.x, catPos.z - w.z) });
    const f = h?.fighters[0], a = h?.actors[0]; if (!f || !a) { h?.remove(); return; }
    const carrier = g.round(new THREE.Group()); carrier.position.y = TOP + y - gy; carrier.add(a.group);
    const r = { h, f, a, carrier, base: TOP - gy, support, dead: false, fall: false, vy: 0, cd: 0, y }; f.sgRec = r; gobs.push(r); alive++; nGob++;
  }
  function stepGobs(dt, t) {
    for (const r of gobs) {
      if (r.dead) continue;
      if (r.f.tgt) { r.f.tgt = null; r.f.forced = false; r.a.stop?.(); } // a hit makes a fighter hunt the player; these goblins hold their posts
      if (!r.fall && r.support.some((b) => moved(b, 0.35))) { r.fall = true; r.vy = 0; r.a.say?.('Aaaah!', 1.5); }
      if (r.fall) { r.vy -= G * dt; r.carrier.position.y += r.vy * dt; if (r.carrier.position.y <= r.base) { const drop = (r.carrier.position.y - r.base) + (r.y > 0 ? r.y : 0); r.carrier.position.y = r.base; r.fall = false; r.support = []; r.y = 0; r.f.damage.hit(Math.max(0, 7 * drop), r.a.position, 'player', undefined, 'blunt'); g.pop(r.a.position, 8, 'puff'); } }
      r.cd -= dt; const p = r.a.position, cy = r.carrier.position.y + p.y + 0.6;
      if (r.cd <= 0) for (const b of blocks) { const hv = b.h; if (!hv || hv.velocity.lengthSq() < 6) continue; const q = hv.position, dx = q.x - p.x, dz = q.z - p.z; if (dx * dx + dz * dz < 0.5 && Math.abs(q.y - cy) < 0.9) { r.cd = 0.3; r.f.damage.hit(Math.min(30, 3 * Math.sqrt(hv.velocity.lengthSq())), q, 'player', undefined, 'blunt', hv.velocity); break; } }
    }
    if ((tTaunt -= dt) <= 0) { tTaunt = 5 + Math.random() * 5; const r = gobs[(Math.random() * gobs.length) | 0]; if (r && !r.dead && !r.fall) { r.a.say?.(['Ha ha!', 'Missed us!', 'Is that all?', 'Hehehe!'][(Math.random() * 4) | 0], 2.5); r.a.wave?.(1.5); } }
  }
  const moved = (b, d) => { const hv = b.h; if (!hv) return false; const q = hv.position, dx = q.x - b.p0.x, dz = q.z - b.p0.z, dy = q.y - b.p0.y, qq = hv.quaternion; return dx * dx + dz * dz > d * d || dy < -0.3 || 1 - 2 * (qq.x * qq.x + qq.z * qq.z) < 0.8; };
  const offKill = ev?.on?.('combat:kill', (e) => {
    const r = e && e.victim && e.victim.sgRec; if (!playing || !r || r.dead) return;
    r.dead = true; alive--; killsOf.n++; const p = r.a.position; g.addScore(100, _w.set(p.x, r.carrier.position.y + p.y + 1, p.z), 'GOBLIN +100'); g.sfx('cheer', p, 0.5);
  });
  function status() { g.status(`Shots ${shots}/${SHOTS}   Goblins ${nGob - killsOf.n}   Blocks ${blocks.filter((b) => b.down).length}/${blocks.length}`); }

  function resetCastle() {
    for (const b of all) if (b.h) { b.h.setVelocity(0, 0, 0); b.h.setAngularVelocity(0, 0, 0); b.h.setTransform(b.p0.y !== undefined && b === flag ? _v.copy(b.p0).setY(b.p0.y - 0.5) : b.p0, b.q0); b.h.wake(); b.down = false; }
    flag.down = false;
  }
  return {
    reset(level) {
      lvl = level; shots = SHOTS; aim = aimT = 0; arm.t = -1; arm.a = A_REST; arm.bl = null; lv.mode = 'idle'; lv.pull = lv.vis = 0; phase = 'idle'; playing = false; bls.length = 0; gobs.length = 0; alive = nGob = 0; killsOf.n = 0; quiet = pendB = 0; hintKey = 'x';
      resetCastle(); armG.rotation.x = A_REST; cup.rotation.x = -A_REST; catG.rotation.y = g.yaw; lvG.rotation.x = -0.35; shotsLabel?.set(`SHOTS ${SHOTS}`); for (const d of dots) d.visible = false;
      perch(-1.01 * BW, CZ0 - 0.3, 1.5, [wall[1]]); perch(1.01 * BW, CZ0 - 0.3, 1.5, [wall[3]]); perch(2.97, CZ0 - 0.45, 2.25, [slabR]); perch(0, CZ0 - 3.0, 1.0, []); perch(-1.0, CZ0 - 1.7, 0, []); perch(1.3, CZ0 - 2.1, 0, []);
      nextBoulder(); g.status('');
    },
    play() { playing = true; phase = 'play'; g.setTime(240); g.headline(''); status(); },
    update(dt, t) {
      input(dt); stepArm(dt); hint(); stepBoulders(dt); stepGobs(dt, t);
      // score by destruction: blocks shifted off their place (batched floats), the banner
      for (const b of blocks) if (!b.down && moved(b, 0.6)) { b.down = true; pendB++; lastB.copy(b.h.position); }
      if (!flag.down && flag.h && (flag.h.position.y < flag.p0.y - 0.9 || 1 - 2 * (flag.h.quaternion.x ** 2 + flag.h.quaternion.z ** 2) < 0.5)) { flag.down = true; g.addScore(150, flag.h.position, 'BANNER DOWN +150'); g.sfx('big'); g.note('The castle banner came down.', false); }
      flushT -= dt; if (pendB > 0 && flushT <= 0) { flushT = 0.35; g.addScore(5 * pendB, lastB, `+${5 * pendB}`); pendB = 0; }
      tEnd += dt; if (tEnd > 0.5) { tEnd = 0.25; status(); }
      // the end: shots spent and everything still, or a flattened castle
      if (shots === 0 && bls.every((bl) => bl.phase === 'spent' || bl.phase === 'pile') && arm.t < 0) {
        let moving = false; for (const b of all) if (b.h && b.h.velocity.lengthSq() > 0.05) { moving = true; break; }
        quiet = moving ? 0 : quiet + dt; if (quiet > 1.5) finish();
      }
      if (alive === 0 && blocks.every((b) => b.down) && shots < SHOTS) { quiet += dt; if (quiet > 2) finish(); }
    },
    stop() { playing = false; phase = 'idle'; },
    dispose() { playing = false; try { offKill?.(); } catch (err) { /* gone */ } },
    info: { blocks, all, flag, gobs, bls, arm, lv, lh0, speedOf, releaseAt, vstar, front, TOP, get shots() { return shots; }, get aim() { return aim; }, get alive() { return alive; }, bucket, pileSlot, catPos, get playing() { return playing; }, kills: killsOf, moved },
  };
  function finish() {
    if (!playing) return; playing = false; const down = blocks.filter((b) => b.down).length, s = 5 * down + 100 * killsOf.n + (flag.down ? 150 : 0);
    g.note(`The siege ended: ${down} blocks shifted, ${killsOf.n} goblins down${flag.down ? ', banner down' : ''}.`, true);
    g.end({ score: s, rating: s / meta.par, text: killsOf.n === nGob ? 'CASTLE FALLEN' : `${s}`, detail: `${down} blocks, ${killsOf.n} goblins${flag.down ? ', banner' : ''}` });
  }
}

