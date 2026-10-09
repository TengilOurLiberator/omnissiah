// games/balloons.js - Balloon Pop: you are handed a blaster, coloured balloons rise from launch pads in batches. Pop = 10. Three of the SAME colour in a row = +50 streak bonus.
// Golden balloon = 60. Black bomb balloon = -40 (and resets the streak): leave it alone. 40 s. Balloons are ONE instanced mesh (+ one for the strings), every balloon is a kit.damageable,
// so blaster bolts, arrows, spells, thrown things and swung weapons all pop them.
export const meta = {
  name: 'balloons', title: 'Balloon Pop', aliases: ['balloon pop', 'balloon popping', 'pop the balloons', 'popping balloons', 'balloon shooter', 'blaster range', 'balloon blaster', 'pop balloons'], icon: '🎈',
  description: 'shoot rising balloons with a blaster: 3 of one colour in a row is a bonus, gold is worth 60, black bombs cost 40', hint: 'Pop balloons! 3 same colour = bonus. Not the black ones', distance: 2, size: 12, par: 600, physics: false,
};

const ROUND = 40, NB = 18, COLORS = [0xe83a3a, 0x3a7ae8, 0x3ac85a, 0xf2d230, 0xb04ae0], NAMES = ['red', 'blue', 'green', 'yellow', 'purple'];
const GOLD = 0xfff08a, BOMB = 0x18181c;

export default function (g) {
  const { THREE } = g, kit = g.world.kit, Wp = g.world.weapons, K = g.k;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _col = new THREE.Color();
  const gyAt = (lx, lz) => g.ground(lx, lz) - g.y;
  g.pedestalAt(-1.2, 0.1); g.boardAt(-1.9, 1.75, -2.6);

  // ---- launch pads (where the balloons come from)
  const pads = [];
  const pb = g.builder();
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
    const lx = (c - 2) * 1.5 * K + (r ? 0.7 * K : 0), lz = -(5 + r * 3.2) * K, gy = g.ground(lx, lz);
    const w = g.at(lx, 0, lz); pads.push({ lx, lz, busy: 0 });
    pb.cyl(0.4, 0.45, 0.14, 0x3c3f4a, w.x - g.x, gy - g.y + 0.07, w.z - g.z, 12); pb.cyl(0.28, 0.28, 0.02, 0xf0b840, w.x - g.x, gy - g.y + 0.15, w.z - g.z, 12);
  }
  const padMesh = pb.mesh(); padMesh.position.set(g.x, g.y, g.z); g.add(padMesh); padMesh.userData.noShadow = true;

  // ---- instanced balloons and strings
  const bGeo = new THREE.SphereGeometry(1, 12, 9), bMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a2a2a }), sGeo = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true), sMat = new THREE.MeshBasicMaterial({ color: 0xe6e6e6 });
  const body = new THREE.InstancedMesh(bGeo, bMat, NB), strs = new THREE.InstancedMesh(sGeo, sMat, NB);
  for (const m of [body, strs]) { m.frustumCulled = false; m.userData.noShadow = true; g.add(m); }
  for (let i = 0; i < NB; i++) body.setColorAt(i, _col.set(0xffffff));
  g.track({ dispose() { bGeo.dispose(); bMat.dispose(); sGeo.dispose(); sMat.dispose(); body.dispose(); strs.dispose(); } });
  const balloons = [];
  for (let i = 0; i < NB; i++) {
    const o = new THREE.Object3D(); g.add(o);
    const b = { i, o, on: false, state: 'off', type: 'color', ci: 0, lx: 0, lz: 0, y: 0, sp: 1, ph: 0, R: 0.3, t: 0, d: null, flash: 0 };
    if (kit) { b.d = kit.damageable(g.ctx, o, { hp: 1e9, radius: 0.36, offsetY: 0, faction: 'neutral', flash: false, onHit: (e) => popped(b, e) }); if (b.d) { b.d.alive = false; g.track(b.d); } }
    balloons.push(b);
  }

  // ---- blaster
  let blaster = null, lost = 0;
  function giveBlaster() {
    if (!Wp || (blaster && !blaster.body.removed)) return;
    blaster = g.give('blaster'); lost = 0; if (!blaster) g.status('Free a hand: the blaster is waiting');
  }

  // ---- state
  let lvl = 1, chain = 0, lastCi = -1, nextBatch = 0, pops = 0, bombs = 0, golds = 0, streaks = 0, escaped = 0, playing = false, flashT = 0;
  const events = []; // raw log for tests: { t:'pop'|'gold'|'bomb', ci }
  function spawnOne(type, ci) {
    const b = balloons.find((q) => !q.on), pad = pads.filter((p) => p.busy <= 0)[(Math.random() * pads.filter((p) => p.busy <= 0).length) | 0];
    if (!b || !pad) return false;
    pad.busy = 0.9; Object.assign(b, { on: true, state: 'rise', type, ci, lx: pad.lx + (Math.random() - 0.5) * 0.3, lz: pad.lz, y: gyAt(pad.lx, pad.lz) + 0.1, sp: (0.9 + 0.22 * lvl) * (0.8 + Math.random() * 0.5), ph: Math.random() * 6.28, R: type === 'bomb' ? 0.26 : 0.3, t: 0 });
    b.d && (b.d.alive = true);
    body.setColorAt(b.i, _col.set(type === 'gold' ? GOLD : type === 'bomb' ? BOMB : COLORS[ci])); body.instanceColor.needsUpdate = true;
    return true;
  }
  function batch() {
    const n = clamp(2 + lvl + ((Math.random() * 2) | 0), 3, 7), dom = (Math.random() * 5) | 0;
    for (let k = 0; k < n; k++) {
      const r = Math.random(), type = r < 0.07 ? 'gold' : r < 0.07 + 0.06 + 0.025 * lvl ? 'bomb' : 'color';
      spawnOne(type, Math.random() < 0.55 ? dom : (Math.random() * 5) | 0);
    }
  }
  function popped(b, e) {
    if (!b.on || b.state !== 'rise' || !playing || g.state !== 'play') return;
    b.state = 'pop'; b.t = 0; b.d.alive = false;
    const hand = b.d.lastHit?.hand; b.o.getWorldPosition(_a); const at = _a.clone();
    if (b.type === 'bomb') {
      bombs++; chain = 0; lastCi = -1; events.push({ t: 'bomb', ci: b.ci }); const pen = Math.min(40, Math.max(0, g.score));
      g.addScore(-pen, at, 'BOMB -40', 0xff5a3a); g.pop(at, 30, 'puff'); g.sfx('boom', at, 0.7); g.pulse(hand ?? 'both', 1, 150); g.status('Boom! Leave the black ones');
    } else if (b.type === 'gold') {
      golds++; events.push({ t: 'gold', ci: -1 }); g.addScore(60, at, 'GOLD +60', 0xffd23a); g.pop(at, 40, 'confetti'); g.pop(at, 20, 'spark'); g.sfx('big', at, 0.8); g.pulse(hand ?? 'both', 0.8, 80);
    } else {
      pops++; events.push({ t: 'pop', ci: b.ci });
      chain = b.ci === lastCi ? chain + 1 : 1; lastCi = b.ci;
      g.addScore(10, at, '+10'); g.pop(at, 14, 'confetti'); g.pulse(hand ?? 'both', 0.4, 40); g.sfx('pop', at, 0.9);
      if (chain >= 3) { streaks++; chain = 0; lastCi = -1; g.addScore(50, at.clone().setY(at.y + 0.4), 'STREAK +50', COLORS[b.ci]); g.sfx('win', at, 0.6); g.status(`${NAMES[b.ci]} streak!`); }
      else g.status(chain > 1 ? `${NAMES[b.ci]} x${chain} - one more` : '');
    }
  }
  function writeAll(dt, t) {
    for (const b of balloons) {
      if (!b.on) { _m.makeScale(0, 0, 0); body.setMatrixAt(b.i, _m); strs.setMatrixAt(b.i, _m); continue; }
      let sc = 1;
      if (b.state === 'rise') {
        b.y += b.sp * dt; b.t += dt;
        if (b.y > gyAt(b.lx, b.lz) + 7.5) { b.on = false; b.d && (b.d.alive = false); if (playing) escaped++; continue; }
        // pop-in: starts small near the pad, full size by 1 m
        sc = clamp((b.y - gyAt(b.lx, b.lz)) / 1.0, 0.25, 1);
      } else { b.t += dt; sc = 1 + b.t * 6; if (b.t > 0.12) { b.on = false; continue; } }
      const sx = b.lx + 0.25 * Math.sin(t * 1.3 + b.ph) * (b.y > 1 ? 1 : 0), cy = b.y + b.R * 1.4;
      g.at(sx, cy, b.lz, _a); b.o.position.copy(_a);
      _q.identity(); _m.compose(_a, _q, _s.set(b.R * sc, b.R * 1.18 * sc, b.R * sc)); body.setMatrixAt(b.i, _m);
      if (b.state === 'rise') { g.at(sx, cy - b.R * 1.4 - 0.45 * sc, b.lz, _a); _m.compose(_a, _q, _s.set(0.008, 0.9 * sc, 0.008)); strs.setMatrixAt(b.i, _m); }
      else { _m.makeScale(0, 0, 0); strs.setMatrixAt(b.i, _m); }
    }
    body.instanceMatrix.needsUpdate = true; strs.instanceMatrix.needsUpdate = true;
  }
  function flashBombs(dt) { // black bombs blink red so they read at a glance
    flashT += dt; const on = Math.floor(flashT * 4) % 2 === 0; let ch = false;
    for (const b of balloons) if (b.on && b.type === 'bomb' && b.state === 'rise' && b.flash !== (on ? 1 : 0)) { b.flash = on ? 1 : 0; body.setColorAt(b.i, _col.set(on ? BOMB : 0x8a1414)); ch = true; }
    if (ch) body.instanceColor.needsUpdate = true;
  }

  return {
    reset(level) {
      lvl = level; chain = 0; lastCi = -1; pops = bombs = golds = streaks = escaped = 0; playing = false; blaster = null; lost = 0; events.length = 0; nextBatch = 0.3;
      for (const b of balloons) { b.on = false; b.state = 'off'; if (b.d) b.d.alive = false; }
      for (const p of pads) p.busy = 0;
      writeAll(0, 0); g.status('');
    },
    play(level) {
      lvl = level; playing = true; g.setTime(ROUND); nextBatch = 0.4; giveBlaster();
      g.every(1, () => { if (!blaster || blaster.body.removed) giveBlaster(); });
    },
    update(dt, t) {
      for (const p of pads) p.busy -= dt;
      nextBatch -= dt;
      if (nextBatch <= 0) { nextBatch = Math.max(0.9, 2.4 - 0.28 * lvl) * (0.8 + Math.random() * 0.4); batch(); }
      writeAll(dt, t); flashBombs(dt);
      if (blaster && !blaster.body.removed) { if (!blaster.held) { lost += dt; if (lost > 6) { lost = 0; blaster.body.position.copy(g.at(0.3, 1.1, -0.4, _a)); blaster.body.velocity.set(0, 0, 0); g.sfx('bell', _a, 0.5); } } else lost = 0; }
      if (g.timeLeft <= 0) { playing = false; g.end({ score: g.score, detail: `${pops} pops, ${streaks} streaks, ${golds} gold, ${bombs} bombs` }); }
    },
    idle(dt, t) { if (balloons.some((b) => b.on)) writeAll(dt, t); },
    stop() { playing = false; blaster = null; },
    dispose() { /* everything is tracked */ },
    info: { balloons, events, pads, spawnOne, batch, popped, get pops() { return pops; }, get bombs() { return bombs; }, get golds() { return golds; }, get streaks() { return streaks; }, get escaped() { return escaped; }, get chain() { return chain; }, get blaster() { return blaster; }, COLORS },
  };
}
