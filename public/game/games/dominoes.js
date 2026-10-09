// games/dominoes.js - CHAIN REACTION: three pre-built domino puzzles with a missing piece (or two), dispensers for dominoes / balls / ramps, snap-to-slot placing,
// a starter ball on a ramp and a goal bell. Score = fallen dominoes x10 + bell 100 + chain-complete 50 + extra upright pieces x5.
// Tuning: DW/DH/DT piece size (m), SP spacing (0.56 of the height: reliable chain), SNAP snap radius (m), puzzle = (level-1) % 3, level >= 4 removes one more piece.
export const meta = {
  name: 'dominoes', title: 'Dominoes', aliases: ['domino', 'dominos', 'chain reaction', 'domino run', 'rube goldberg'], icon: '🁣',
  description: 'fill the gap in the domino run and set off the chain', hint: 'Fill the gap, then poke the green plunger', distance: 2.2, size: 6, par: 300, physics: true,
};
const DW = 0.13, DH = 0.26, DT = 0.05, SP = 0.145, SNAP = 0.28;
// each puzzle: start (x, z), heading (rad; 0 = +x, PI/2 = +z), ops 'L' straight (m) / 'A' arc (degrees, radius m: gentle, <= 10 degrees per domino), gaps = fractions of the run
const PUZZLES = [
  { start: [-1.5, -2.2], h: 0, ops: [['L', 2.7]], gaps: [0.45] },
  { start: [-1.7, -2.0], h: 0, ops: [['L', 1.2], ['A', -100, 0.8], ['L', 0.4], ['A', 100, 0.8], ['L', 1.0]], gaps: [0.42] },
  { start: [-1.7, -1.9], h: 0, ops: [['L', 1.0], ['A', -90, 0.9], ['L', 0.3], ['A', -90, 0.9], ['L', 1.0], ['A', 90, 0.9], ['L', 0.5]], gaps: [0.22, 0.62] },
];
function trace(ops, x, z, h, k) {
  const out = [[x, z]];
  for (const [kind, a, r0] of ops) {
    if (kind === 'L') { const len = a * k, n = Math.max(1, Math.round(len / 0.1)); for (let i = 0; i < n; i++) { x += Math.cos(h) * len / n; z += Math.sin(h) * len / n; out.push([x, z]); } }
    else { const ang = a * Math.PI / 180, r = r0 * k, n = Math.max(2, Math.round(Math.abs(ang) * r / 0.1)), da = ang / n, ds = r * Math.abs(da); for (let i = 0; i < n; i++) { h += da / 2; x += Math.cos(h) * ds; z += Math.sin(h) * ds; h += da / 2; out.push([x, z]); } }
  }
  return out;
}const COLS = [0xd83a3a, 0xf2ecd8, 0x3a7acf, 0xf2ecd8, 0xe0b82a, 0xf2ecd8, 0x2ab04a, 0xf2ecd8];

export default function (g) {
  const { THREE } = g, kit = g.world.kit, P = g.world.physics, kk = g.k;
  const up1 = (q) => 1 - 2 * (q.x * q.x + q.z * q.z), tilted = (q) => up1(q) < 0.55;
  const deck = g.deck(5.4 * kk, 5.6 * kk, { x: 0, z: -3.6 * kk, color: 0x6a5a48 });
  const W = (x, z, dy = 0, out) => g.at(x, deck.y(x, z) - g.y + dy, z, out);
  const Y = new THREE.Vector3(0, 1, 0), qy = (yaw) => new THREE.Quaternion().setFromAxisAngle(Y, g.yaw + yaw);
  g.pedestalAt(-2.0, 0.2); g.boardAt(0, 2.5 + 1.2 * kk, -(5.6 * kk + 0.6), 2.2 * (kk < 1 ? 0.9 : 1));
  // ---- pre-built dominoes: bodies without objects, drawn as ONE instanced mesh
  const MAXP = 64, inst = new THREE.InstancedMesh(new THREE.BoxGeometry(DW, DH, DT), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP);
  inst.count = 0; inst.frustumCulled = false; inst.userData.ownGeo = true; g.add(inst);
  for (let i = 0; i < MAXP; i++) inst.setColorAt(i, new THREE.Color(COLS[i % COLS.length]));
  const ghostMat = g.mat(0xffe27a, { basic: true, opacity: 0.4 });
  let slots = [], extras = [], layout = [], phase = 'build', runT = 0, quiet = 0, bellSwing = 0, bellDone = false, upright = [], stopper = null, ball0 = null, chain = 0, extra = 0, hk = 0, lastSfx = 0;
  const _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _hp = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // ---- goal bell
  const bb = g.builder(); bb.cyl(0.04, 0.04, 0.9, 0x6a4a2a, -0.25, 0.45, 0, 6); bb.cyl(0.04, 0.04, 0.9, 0x6a4a2a, 0.25, 0.45, 0, 6); bb.box(0.6, 0.06, 0.06, 0x6a4a2a, 0, 0.9, 0);
  const bellFrame = g.add(bb.mesh()), bellB = g.builder(); bellB.cone(0.17, 0.3, 0xe0b82a, 0, -0.15, 0, 12); bellB.sph(0.04, 0x8a6a1a, 0, -0.32, 0, 1, 6);
  const bell = bellB.mesh(); bellFrame.add(bell); bell.position.y = 0.88;
  const mkBody = (opts) => P.body(g.ctx, null, opts);
  function clearLayout() { for (const h of layout) { try { h.remove(); } catch (e) { /* gone */ } } layout = []; for (const x of extras) x.removeFromParent(); extras = []; slots = []; stopper = null; ball0 = null; }
  function build(level) {
    clearLayout(); const pz = PUZZLES[(level - 1) % 3];
    const pts = trace(pz.ops, pz.start[0] * kk, pz.start[1] * kk, pz.h, kk).map(([x, z]) => new THREE.Vector3(x, 0, z)), curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const n = Math.min(MAXP - 1, Math.max(6, Math.round(curve.getLength() / SP))), gaps = new Set(pz.gaps.map((f) => Math.max(2, Math.min(n - 3, Math.round(f * n)))));
    if (level >= 4) gaps.add(Math.max(2, Math.round(n * 0.78)));
    const sp = curve.getSpacedPoints(n); inst.count = n + 1;
    for (let i = 0; i <= n; i++) {
      const p = sp[i], t = curve.getTangent(Math.min(1, i / n)), yaw = Math.atan2(t.x, t.z), pos = W(p.x, p.z, DH / 2 + 0.005), s = { i, x: p.x, z: p.z, yaw, h: null, b: null, fallen: false, gap: gaps.has(i), pos, dirty: true };
      slots.push(s);
      if (s.gap) { const gh = new THREE.Mesh(g.geoBox(DW, DH, DT), ghostMat); gh.position.copy(pos); gh.quaternion.copy(qy(yaw)); g.root.add(gh); extras.push(gh); inst.setMatrixAt(i, zero); continue; }
      s.h = mkBody({ shape: 'box', size: [DW, DH, DT], mass: 0.25, friction: 0.55, restitution: 0.05, linearDamping: 0.08, angularDamping: 0.4, position: pos, quaternion: qy(yaw) }); if (s.h) layout.push(s.h);
    }
    // starter ramp + ball, held by a stopper until RUN
    const s0 = slots[0], back = new THREE.Vector3(-Math.sin(s0.yaw), 0, -Math.cos(s0.yaw)).applyAxisAngle(Y, g.yaw), ang = 0.3, len = 0.9, lowP = s0.pos.clone().addScaledVector(back, 0.2);
    const ramp = g.add(g.box(len, 0.04, 0.22, 0x8a6a42)), mid = lowP.clone().addScaledVector(back, (len / 2) * Math.cos(ang)); mid.y += (len / 2) * Math.sin(ang) + 0.02;
    ramp.position.copy(mid); ramp.rotation.order = 'YZX'; ramp.rotation.y = g.yaw + s0.yaw - Math.PI / 2; ramp.rotation.z = -ang; extras.push(ramp);
    const rh = g.body(ramp, { type: 'fixed', shape: 'box', size: [len, 0.04, 0.22], group: 'prop', friction: 0.4 }); if (rh) layout.push(rh);
    const ballP = lowP.clone().addScaledVector(back, len * 0.8 * Math.cos(ang)); ballP.y = mid.y + len * 0.3 * Math.sin(ang) + 0.14;
    const bm = new THREE.Mesh(g.geoSph(0.08), g.mat(0xe0742a)); bm.position.copy(ballP); g.root.add(bm); extras.push(bm);
    ball0 = { m: bm, h: mkBody({ shape: 'sphere', size: 0.08, mass: 0.5, friction: 0.3, restitution: 0.1, angularDamping: 0.05, position: ballP }) }; if (ball0.h) layout.push(ball0.h);
    const stP = ballP.clone().addScaledVector(back, -0.12); stP.y -= 0.02;
    stopper = mkBody({ type: 'fixed', shape: 'box', size: [0.22, 0.14, 0.03], position: stP, quaternion: qy(s0.yaw), group: 'prop' }); if (stopper) { layout.push(stopper); stopper.home = stP.clone(); }
    // bell beyond the last domino
    const sl = slots[n], tl = curve.getTangent(1), bp = W(sl.x + tl.x * 0.45, sl.z + tl.z * 0.45);
    bellFrame.position.copy(bp); bellFrame.rotation.y = g.yaw + sl.yaw; bell.rotation.z = 0; bellDone = false; syncInst(true);
  }
  function syncInst(force) {
    let any = force;
    for (const s of slots) { if (!s.h || (!s.h.awake && !s.dirty && !force)) continue; _m.compose(s.h.position, s.h.quaternion, _s); inst.setMatrixAt(s.i, _m); s.dirty = s.h.awake; any = true; }
    if (any) inst.instanceMatrix.needsUpdate = true;
    if (ball0?.h) { ball0.m.position.copy(ball0.h.position); ball0.m.quaternion.copy(ball0.h.quaternion); }
  }
  // ---- dispensers: three small pedestals with grabbable pieces (kit.body, snap-to-slot for dominoes)
  const KINDS = [{ kind: 'domino', lx: -0.45, cap: 10 }, { kind: 'ball', lx: 0.35, cap: 3 }, { kind: 'ramp', lx: 1.15, cap: 3 }];
  let trayTop = g.y + 0.86;
  for (const d of KINDS) { const m = g.add(g.cyl(0.24, 0.24, 0.84, 0x5a5e6a)); m.position.copy(g.at(d.lx, 0, -0.8)); m.position.y = g.groundAt(m.position.x, m.position.z) + 0.42; trayTop = m.position.y + 0.42; g.body(m, { type: 'fixed', shape: 'cylinder', group: 'prop' }); d.top = trayTop; }
  const wedge = () => {
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute([-0.15, 0, -0.12, 0.15, 0, -0.12, 0.15, 0.1, -0.12, -0.15, 0, 0.12, 0.15, 0, 0.12, 0.15, 0.1, 0.12], 3));
    gg.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 2, 5, 0, 3, 5]); const n = gg.toNonIndexed(); n.computeVertexNormals(); gg.dispose(); return n;
  };
  const items = [];
  function dispense(d) {
    if (!kit) return null; const p = g.at(d.lx, 0, -0.8); let m, o;
    if (d.kind === 'domino') { const b = g.builder(); b.box(DW, DH, DT, 0xf2ecd8, 0, 0, 0); b.box(DW * 0.92, 0.012, DT * 1.05, 0x222222, 0, 0, 0); m = b.mesh(); o = { shape: 'box', size: [DW, DH, DT], mass: 0.25, friction: 0.55, bounce: 0.05 }; m.rotation.x = Math.PI / 2; p.y = d.top + DT / 2 + 0.03; }
    else if (d.kind === 'ball') { const b = g.builder(); b.sph(0.08, 0xe0742a, 0, 0, 0, 1, 10); m = b.mesh(); o = { radius: 0.08, mass: 0.5, bounce: 0.3, friction: 0.4 }; p.y = d.top + 0.11; }
    else { m = new THREE.Mesh(wedge(), new THREE.MeshLambertMaterial({ color: 0xa0784a })); m.userData.ownGeo = true; o = { shape: 'hull', mass: 0.5, friction: 0.7, bounce: 0.05 }; p.y = d.top + 0.07; }
    m.position.copy(p); const body = kit.body(g.ctx, m, { grabbable: true, grabRange: 6, ...o });
    if (!body) { m.removeFromParent(); return null; }
    const it = { d, b: body, home: p.clone(), still: 0, slot: null }; items.push(it); g.round(body);
    if (d.kind === 'domino') body.onRelease(() => snapPiece(it));
    return it;
  }
  function snapPiece(it) {
    const b = it.b, lp = g.toLocal(b.position.x, b.position.z); let best = null, bd = SNAP * SNAP;
    for (const s of slots) { if (s.h || (s.b && s.b !== it)) continue; const dx = lp.x - s.x, dz = lp.z - s.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = s; } }
    if (!best) return; best.b = it; it.slot = best;
    b.position.copy(best.pos); b.velocity.set(0, 0, 0); b.mesh.quaternion.copy(qy(best.yaw)); b.ph?.setAngularVelocity(0, 0, 0); b.ph?.setTransform(best.pos, b.mesh.quaternion);
    g.sfx('tick', best.pos); g.pop(best.pos, 6, 'spark'); g.pulse('right', 0.4, 40);
  }
  function housekeeping() {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i], b = it.b; if (b.removed) { items.splice(i, 1); continue; }
      if (it.slot && (b.held || b.position.distanceToSquared(it.slot.pos) > 0.03)) { it.slot.b = null; it.slot = null; }
      const far = b.position.distanceToSquared(it.home) > 9 && !b.held && b.velocity.lengthSq() < 0.02 && !it.slot;
      it.still = far ? it.still + 0.5 : 0;
      if (Math.abs(g.toLocal(b.position.x, b.position.z).x) > 3.4 || b.position.y < g.y - 2 || it.still > 8) { b.remove(); items.splice(i, 1); }
    }
    for (const d of KINDS) { let n = 0, home = false; for (const it of items) if (it.d === d) { n++; if (!it.b.held && it.b.position.distanceToSquared(it.home) < 0.12) home = true; } if (!home && n < d.cap) dispense(d); }
  }
  // ---- RUN plunger on its own little pedestal
  const pm = g.builder(); pm.cyl(0.16, 0.2, 0.8, 0x5a5e6a, 0, 0.4, 0, 10); pm.cyl(0.2, 0.16, 0.04, 0x9a9eaa, 0, 0.82, 0, 10);
  const plunger = g.add(pm.mesh()); plunger.position.copy(g.at(2.0, 0, 0.9)); plunger.position.y = g.groundAt(plunger.position.x, plunger.position.z);
  const greenMat = g.mat(0x28d060, { basic: true }), darkMat = g.mat(0x1c3a28, { basic: true }), pbtn = g.add(g.cyl(0.07, 0.09, 0.07, 0x28d060)); pbtn.material = greenMat;
  pbtn.position.set(plunger.position.x, plunger.position.y + 0.88, plunger.position.z);
  const lbl = kit?.label?.(g.ctx, 'RUN', { size: 0.1, position: { x: pbtn.position.x, y: pbtn.position.y + 0.25, z: pbtn.position.z } }); if (lbl) g.track(lbl);
  const poked = () => { for (const h of g.hands) { if (!h.ok) continue; const dx = h.pos.x - pbtn.position.x, dz = h.pos.z - pbtn.position.z, dy = h.pos.y - pbtn.position.y; if (dx * dx + dz * dz < 0.02 && dy > -0.1 && dy < 0.16 && (h.speed > 0.8 || h.inp.down?.trigger)) return true; } return false; };
  function run() {
    if (phase !== 'build') return; phase = 'run'; runT = 0; quiet = 0; upright = [];
    for (const it of items) if (!it.slot && it.d.kind === 'domino' && !it.b.removed && it.b.ph && up1(it.b.ph.quaternion) > 0.9) upright.push(it);
    if (stopper) stopper.setTransform(_hp.copy(stopper.home).setY(g.y - 20)); ball0?.h?.wake(); g.sfx('whoosh', ball0?.m.position); g.status('Go go go...');
  }
  const total = () => chain * 10 + (bellDone ? 100 : 0) + extra * 5 + (slots.length && chain === slots.length ? 50 : 0);
  function tally(t) {
    let c = 0;
    for (const s of slots) { const q = s.h ? s.h.quaternion : s.b?.b.ph?.quaternion; if (!q) continue; if (!s.fallen && tilted(q)) { s.fallen = true; if (t - lastSfx > 0.05) { lastSfx = t; g.sfx('tick', s.pos, 0.5); } } if (s.fallen) c++; }
    let e = 0; for (const it of upright) if (!it.b.removed && it.b.ph && tilted(it.b.ph.quaternion)) e++;
    if (slots.length && slots[slots.length - 1].fallen && !bellDone) { bellDone = true; bellSwing = 1; g.sfx('bell', bellFrame.position); g.pop(_hp.copy(bellFrame.position).setY(bellFrame.position.y + 0.9), 40, 'confetti'); g.float(_hp.setY(_hp.y + 0.5), 'DING! +100', 0xffe27a); c = c; }
    if (c !== chain || e !== extra || bellDone) { chain = c; extra = e; g.setScore(total()); g.headline(`Chain ${chain}`); }
  }
  return {
    reset(level) { phase = 'build'; chain = 0; extra = 0; runT = 0; bellSwing = 0; items.length = 0; upright = []; if (P) build(level); g.headline(''); g.status(''); },
    play() { g.status('Fill the gap, then poke RUN'); g.setTime(150); housekeeping(); },
    idle() { if (P) syncInst(false); pbtn.material = greenMat; },
    update(dt, t) {
      hk += dt; if (hk > 0.5) { hk = 0; housekeeping(); }
      syncInst(false); pbtn.material = phase === 'build' ? greenMat : darkMat; pbtn.position.y = plunger.position.y + 0.88 - (phase === 'run' ? 0.03 : 0);
      if (bellSwing > 0) { bellSwing = Math.max(0, bellSwing - dt * 0.5); bell.rotation.z = Math.sin(t * 22) * 0.5 * bellSwing; }
      if (phase === 'build') { if (poked()) run(); return; }
      runT += dt; tally(t);
      let moving = false; for (const s of slots) if (s.h && s.h.awake && s.h.velocity.lengthSq() > 0.02) { moving = true; break; }
      quiet = moving ? 0 : quiet + dt;
      if ((quiet > 2 && runT > 3) || runT > 40) { tally(t); g.end({ score: total(), rating: (chain * 10 + (bellDone ? 100 : 0)) / (slots.length * 10 + 150), text: `${chain}/${slots.length}`, detail: `chain ${chain}/${slots.length}` }); }
    },
    stop() { phase = 'build'; },
    dispose() { clearLayout(); },
    info: { get slots() { return slots; }, get chain() { return chain; }, get phase() { return phase; }, run, get items() { return items; }, snapPiece, get bellDone() { return bellDone; }, get ball() { return ball0; }, get plungerPos() { return pbtn.position; }, deck },
  };
}
