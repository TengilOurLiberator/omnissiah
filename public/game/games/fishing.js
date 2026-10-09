// games/fishing.js - lake fishing with a rod, a verlet line and a floating Rapier bobber. meta.site = 'lake': the framework snaps the venue to the shore, facing the water.
// CAST: swing the rod hand forward fast (> 3 m/s) -> the bobber is released along the swing (range clamped). It splashes down, floats (spring buoyancy at env.waterLevel) and after a random
// wait it DIPS with a haptic buzz: pull the hand back / lift it fast, or squeeze / trigger, within the window (1.0 s at level 1 -> 0.6 s at level 5) to hook the fish; then HOLD trigger or
// squeeze to reel it in (it thrashes; let go for 3 s and it escapes). Hold squeeze with an empty line to wind the bobber back in. Honest note on the line: it is NOT a Rapier joint chain: the
// line is a small verlet rope (9 nodes, drawn as one Line) pinned to the rod tip and the bobber; the bobber is a real dynamic Rapier body with my buoyancy forces and a reel/tether pull.
export const meta = {
  name: 'fishing', title: 'Fishing', aliases: ['fish', 'lake fishing', 'go fishing', 'angling'], icon: '🎣',
  description: 'cast a rod at the lake, strike at the dip, reel in minnows, carp, pike, golden carp, old boots and treasure', hint: 'Swing to cast, pull back at the dip',
  distance: 3, size: 14, par: 260, physics: true, site: 'lake',
};
// name, weight, kg range, points, colour, kind
export const FISH = [
  { n: 'minnow', w: 30, kg: [0.02, 0.06], pts: 8, col: 0xbfd6e8, kind: 'fish' }, { n: 'perch', w: 26, kg: [0.2, 0.9], pts: 20, col: 0x7fae52, kind: 'fish' },
  { n: 'carp', w: 16, kg: [1.5, 6.5], pts: 45, col: 0xc9a25a, kind: 'fish' }, { n: 'pike', w: 8, kg: [3, 10], pts: 80, col: 0x5f8f55, kind: 'fish' },
  { n: 'golden carp', w: 3, kg: [2, 5], pts: 180, col: 0xffd23a, kind: 'fish' }, { n: 'old boot', w: 8, kg: [0.3, 0.7], pts: 2, col: 0x5a3a22, kind: 'boot' },
  { n: 'treasure chest', w: 2, kg: [4, 9], pts: 250, col: 0x8a5a2a, kind: 'chest' },
];
export const catchPoints = (f, kg) => f.pts + Math.round(kg * 8);
const ROUND = 75, NODES = 9, ROD = 1.25, MAXLINE = 24, G = 9.8;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export default function (g) {
  const { THREE } = g, kit = g.world.kit, { Vector3, Quaternion } = THREE, HS = g.hands;
  const _tip = new Vector3(), _a = new Vector3(), _fw = new Vector3(), _qT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.45), _land = new Vector3();
  // ---- rod, line, bobber, fish, ripples
  const rb = g.builder(); rb.cyl(0.014, 0.006, ROD, 0x6a4a2a, 0, 0, -ROD / 2, 6, Math.PI / 2); rb.cyl(0.03, 0.03, 0.2, 0x2a2a30, 0, 0, 0.08, 8, Math.PI / 2); rb.sph(0.035, 0xc0c4d0, 0.03, -0.04, 0.0, 1, 6);
  const rod = g.add(rb.mesh(), g.root); rod.visible = false; rod.frustumCulled = false;
  const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NODES * 3), 3));
  const lineMat = g.track(new THREE.LineBasicMaterial({ color: 0xf2f2e8 })); g.track({ dispose() { lineGeo.dispose(); } });
  const line = g.add(new THREE.Line(lineGeo, lineMat), g.root); line.frustumCulled = false; line.visible = false; line.userData.noShadow = true;
  const bm = g.builder(); bm.sph(0.05, 0xf4f0e8, 0, 0, 0, 1, 10); bm.sph(0.052, 0xe03a2a, 0, 0.03, 0, 0.7, 10); bm.cyl(0.006, 0.006, 0.08, 0xffd23a, 0, 0.1, 0, 5);
  const bobMesh = bm.mesh(); bobMesh.userData.noShadow = true;
  const bob = g.body(bobMesh, { shape: 'sphere', size: 0.05, mass: 0.04, friction: 0.5, restitution: 0.2, linearDamping: 0.15, angularDamping: 2 });
  const fm = { fish: g.builder(), boot: g.builder(), chest: g.builder() };
  fm.fish.sph(0.18, 0xffffff, 0, 0, 0, 0.45, 8).cone(0.12, 0.22, 0xffffff, 0, 0, 0.26, 6, Math.PI / 2).sph(0.03, 0x101010, 0.07, 0.04, -0.12, 1, 4).sph(0.03, 0x101010, -0.07, 0.04, -0.12, 1, 4);
  fm.boot.box(0.14, 0.34, 0.14, 0xffffff, 0, 0.02, 0).box(0.14, 0.1, 0.3, 0xffffff, 0, -0.15, -0.1); fm.chest.box(0.5, 0.26, 0.32, 0xffffff, 0, 0, 0).box(0.52, 0.06, 0.34, 0xffd23a, 0, 0.1, 0);
  const fishM = {}; for (const k of Object.keys(fm)) { fishM[k] = g.add(fm[k].mesh(), g.root); fishM[k].visible = false; fishM[k].material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); g.track(fishM[k].material); }
  const ringGeo = new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2), ringMat = [0, 1].map(() => g.track(new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0, depthWrite: false, fog: false })));
  g.track({ dispose() { ringGeo.dispose(); } });
  const rings = ringMat.map((m) => { const r = g.add(new THREE.Mesh(ringGeo, m), g.root); r.visible = false; r.userData.noShadow = r.userData.noOutline = true; return { m: r, t: 9, mat: m }; });
  const splash = kit && kit.particles ? g.track(kit.particles(g.ctx, { count: 60, color: [0xe8f6ff, 0x7fb0e0], size: [0.07, 0.02], life: [0.4, 0.9], speed: [1, 2.6], gravity: 6, additive: false, alpha: 0.85 })) : null;
  const nx = new Float32Array(NODES), ny = new Float32Array(NODES), nz = new Float32Array(NODES), ox = new Float32Array(NODES), oy = new Float32Array(NODES), oz = new Float32Array(NODES);

  // ---- state
  let phase = 'ready', level = 1, rng = null, waitT = 0, biteT = 0, flyT = 0, holdT = 0, slackT = 0, buzzT = 0, ripN = 0, rope = 0.5, lastSt = '', fishT = 9, retT = 0, fish = null, fkg = 0;
  let catches = [], biggest = null, pendingEnd = false, fishFrom = new Vector3(), fishKind = 'fish';
  const rand = (a, b) => a + (b - a) * rng();
  const mulberry = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const env = () => g.world.env;
  const lakeOk = () => { const E = env(); if (!E || !E.lake || typeof E.isWater !== 'function' || E.waterEnabled === false || g.compact || (g.gctx.input && g.gctx.input.passthrough) || !bob) return false; for (const d of [5, 9, 14]) { g.at(0, 0, -d, _a); if (E.isWater(_a.x, _a.z)) return true; } return false; };
  const hand = () => (HS[1].ok ? HS[1] : HS[0].ok ? HS[0] : null);
  const say = (s) => { if (s !== lastSt) { lastSt = s; g.status(s); } };
  function ripple(x, z) { const r = rings[ripN++ % 2]; r.t = 0; r.m.position.set(x, env().waterLevel + 0.03, z); r.m.visible = true; }
  function hang() { if (!bob) return; bob.setTransform(_a.copy(_tip).setY(_tip.y - 0.5)); bob.setVelocity(0, 0, 0); bob.setAngularVelocity(0, 0, 0); rope = 0.5; }
  function pick() { let tot = 0; const k = 1 + 0.2 * (level - 1); for (let i = 0; i < FISH.length; i++) tot += FISH[i].w * (FISH[i].pts >= 80 ? k : 1); let r = rng() * tot; for (const f of FISH) { r -= f.w * (f.pts >= 80 ? k : 1); if (r <= 0) return f; } return FISH[0]; }
  function poseRod(h) {
    rod.visible = true; rod.position.copy(h.pos); rod.quaternion.copy(h.inp.quaternion).multiply(_qT); rod.updateMatrixWorld(true);
    _tip.set(0, 0, -ROD).applyQuaternion(rod.quaternion).add(h.pos);
  }
  function stepLine(dt) { // verlet rope pinned between the rod tip and the bobber
    const bp = bob.position, n = NODES - 1, seg = rope / n, d2 = dt * dt;
    nx[0] = _tip.x; ny[0] = _tip.y; nz[0] = _tip.z; nx[n] = bp.x; ny[n] = bp.y + 0.05; nz[n] = bp.z;
    for (let i = 1; i < n; i++) { const vx = (nx[i] - ox[i]) * 0.97, vy = (ny[i] - oy[i]) * 0.97, vz = (nz[i] - oz[i]) * 0.97; ox[i] = nx[i]; oy[i] = ny[i]; oz[i] = nz[i]; nx[i] += vx; ny[i] += vy - G * d2; nz[i] += vz; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < n; i++) {
      const dx = nx[i + 1] - nx[i], dy = ny[i + 1] - ny[i], dz = nz[i + 1] - nz[i], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4, k = (d - seg) / d * 0.5;
      if (k <= 0 && d < seg) continue; // a rope can go slack, it cannot stretch
      const a = i === 0 ? 0 : 1, b = i + 1 === n ? 0 : 1, s = a + b || 1;
      nx[i] += dx * k * 2 * a / s; ny[i] += dy * k * 2 * a / s; nz[i] += dz * k * 2 * a / s; nx[i + 1] -= dx * k * 2 * b / s; ny[i + 1] -= dy * k * 2 * b / s; nz[i + 1] -= dz * k * 2 * b / s;
    }
    const arr = lineGeo.attributes.position.array; for (let i = 0; i < NODES; i++) { arr[i * 3] = nx[i]; arr[i * 3 + 1] = ny[i]; arr[i * 3 + 2] = nz[i]; }
    lineGeo.attributes.position.needsUpdate = true;
  }
  function resetLine() { for (let i = 0; i < NODES; i++) { nx[i] = ox[i] = _tip.x; ny[i] = oy[i] = _tip.y - i * 0.05; nz[i] = oz[i] = _tip.z; } }
  function pull(tx, tz, sp) { // bobber toward (tx, tz) at sp m/s on the surface
    const p = bob.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1; bob.setVelocity(dx / d * sp, bob.velocity.y, dz / d * sp); return d;
  }
  function land(x, z) { phase = 'floating'; waitT = rand(2.5, 6.5); rope = Math.hypot(x - _tip.x, z - _tip.z) * 1.06 + 0.5; ripple(x, z); splash?.emit(_land.set(x, env().waterLevel + 0.05, z), 30); g.sfx('splash', _land); say('Wait for the dip...'); }
  function hooked() { phase = 'reel'; slackT = 0; buzzT = 0; g.pulse('both', 0.8, 80); g.sfx('bell', bob.position, 0.5); say('Hooked! Hold trigger to reel'); }
  function caught() {
    const kg = fkg, f = fish, pts = catchPoints(f, kg);
    catches.push({ n: f.n, kg, pts }); if (!biggest || kg > biggest.kg) biggest = { n: f.n, kg };
    fishFrom.copy(bob.position); fishKind = f.kind; fishT = 0; const m = fishM[f.kind]; m.visible = true;
    for (const k of Object.keys(fishM)) if (k !== f.kind) fishM[k].visible = false;
    fishM[f.kind].material.color.setHex(f.col); fishM[f.kind].userData.kg = kg; m.scale.setScalar(clamp(0.5 + kg * 0.12, 0.6, 1.8));
    g.addScore(pts, _a.copy(_tip).setY(_tip.y + 0.4), `${f.n} ${kg.toFixed(2)}kg`);
    g.sfx(f.pts >= 80 ? 'big' : 'pop', _tip); g.pulse('both', 0.6, 100); splash?.emit(bob.position, 20);
    if (f.pts >= 80) g.note(`The player caught a ${f.n} of ${kg.toFixed(1)} kilograms.`, f.pts >= 180);
    phase = 'ready'; hang(); resetLine(); fish = null; say(`${f.n} ${kg.toFixed(2)}kg! Swing to cast`);
  }
  function endRound() { const sc = g.score; g.end({ score: sc, rating: clamp(sc / meta.par, 0, 1), text: `${catches.length} catches`, detail: biggest ? `${biggest.n} ${biggest.kg.toFixed(1)}kg` : 'nothing' }); }
  function flightOrBob(dt, h) {
    const E = env(), wl = E.waterLevel, p = bob.position, inW = p.y < wl + 0.04 && E.isWater(p.x, p.z);
    if (inW) { // damped spring about the surface (a dip pulls the target down), gravity cancelled at the target
      const target = wl - (phase === 'bite' ? 0.14 + 0.04 * Math.sin(g.time * 40) : 0);
      bob.applyImpulse(0, 0.04 * (G + 64 * (target - p.y) - 9 * bob.velocity.y) * dt, 0); bob.setDamping(5, 4); if (bob.velocity.y < -2.5) bob.setVelocity(bob.velocity.x, -2.5, bob.velocity.z);
    } else bob.setDamping(0.15, 2);
    return inW;
  }
  return {
    reset(lv) {
      level = lv; phase = 'ready'; catches = []; biggest = null; fish = null; fishT = 9; pendingEnd = false; lastSt = ''; holdT = 0;
      rod.visible = line.visible = false; for (const k of Object.keys(fishM)) fishM[k].visible = false; for (const r of rings) r.m.visible = false;
      _tip.copy(g.at(0.3, 1.2, -0.6)); hang(); resetLine(); bobMesh.visible = false;
      g.status(lakeOk() ? meta.hint : 'No lake here: fishing needs the open lake (not mixed reality)');
    },
    play(lv) {
      level = lv; rng = mulberry(4242 + lv * 77); if (!lakeOk()) { g.status('No lake here'); g.abort('no lake'); return; }
      g.setTime(ROUND); phase = 'ready'; bobMesh.visible = true; line.visible = true; lastSt = ''; say('Swing the rod forward to cast'); holdT = 0;
    },
    update(dt) {
      const h = hand(); if (!h || !bob || bob.removed) { say('Hold a controller or hand up to fish'); return; }
      poseRod(h); const holdOn = !!(h.inp.down && (h.inp.down.trigger || h.inp.down.squeeze)), fwdLen = Math.hypot(g.ctx.player.forward.x, g.ctx.player.forward.z) || 1;
      _fw.set(g.ctx.player.forward.x / fwdLen, 0, g.ctx.player.forward.z / fwdLen);
      const along = h.vel.x * _fw.x + h.vel.z * _fw.z;
      if (phase === 'ready') {
        hang(); if (h.speed > 3 && along > 2.4 && g.time > 0.4) { // CAST
          const vh = clamp(Math.hypot(h.vel.x, h.vel.z) * 1.15, 4.5, 13), hl = Math.hypot(h.vel.x, h.vel.z) || 1;
          bob.setTransform(_tip); bob.setVelocity(h.vel.x / hl * vh, Math.max(h.vel.y * 1.1, vh * 0.55), h.vel.z / hl * vh); phase = 'flying'; flyT = 0; g.sfx('whoosh', _tip); g.pulse(h.name, 0.4, 50); say('Cast!');
        }
      } else if (phase === 'flying') {
        flyT += dt; const inW = flightOrBob(dt, h), p = bob.position;
        if (inW && flyT > 0.15) land(p.x, p.z);
        else if (flyT > 0.5 && (bob.grounded || p.y < g.groundAt(p.x, p.z) + 0.08) && !env().isWater(p.x, p.z)) { g.float(p, 'On land!', 0xff7a6b); g.sfx('miss', p, 0.5); phase = 'retrieve'; retT = 0; }
        else if (flyT > 6) { phase = 'retrieve'; retT = 0; }
        rope = Math.max(rope, Math.hypot(p.x - _tip.x, p.z - _tip.z) * 1.05 + 0.3);
        if (Math.hypot(p.x - _tip.x, p.z - _tip.z) > MAXLINE) pull(_tip.x, _tip.z, 6);
      } else if (phase === 'retrieve') {
        flightOrBob(dt, h); retT += dt; const d = pull(_tip.x, _tip.z, 6); rope = d * 1.02 + 0.4;
        if (d < 0.9 || retT > 5) { phase = 'ready'; hang(); say('Swing the rod forward to cast'); }
      } else if (phase === 'floating' || phase === 'bite') {
        flightOrBob(dt, h);
        if (phase === 'floating') {
          waitT -= dt; holdT = holdOn ? holdT + dt : 0;
          if (holdT > 0.5) { phase = 'retrieve'; retT = 0; say('Winding in...'); }
          else if (waitT <= 0) { phase = 'bite'; biteT = 1.1 - 0.1 * level; buzzT = 0; fish = pick(); fkg = fish.kg[0] + (fish.kg[1] - fish.kg[0]) * Math.pow(rng(), 1.6); ripple(bob.position.x, bob.position.z); splash?.emit(bob.position, 12); g.sfx('splash', bob.position, 0.8); say('NOW! Pull back!'); }
        } else {
          biteT -= dt; buzzT -= dt; if (buzzT <= 0) { buzzT = 0.12; g.pulse(h.name, 0.55, 45); }
          const hook = (h.inp.pressed && (h.inp.pressed('squeeze') || h.inp.pressed('trigger'))) || (h.speed > 2.5 && (along < -1.8 || h.vel.y > 2.2));
          if (hook) hooked(); else if (biteT <= 0) { phase = 'floating'; waitT = rand(2, 5); fish = null; g.float(bob.position, 'Got away!', 0xff7a6b); g.sfx('miss', bob.position, 0.5); say('Too slow. Wait for the next dip'); }
        }
        const dd = Math.hypot(bob.position.x - _tip.x, bob.position.z - _tip.z); if (dd > MAXLINE) pull(_tip.x, _tip.z, 3);
      } else if (phase === 'reel') {
        flightOrBob(dt, h); const p = bob.position; buzzT -= dt; if (buzzT <= 0) { buzzT = 0.15; g.pulse(h.name, 0.35, 40); }
        let d;
        if (holdOn) { slackT = Math.max(0, slackT - dt * 0.5); d = pull(_tip.x + Math.sin(g.time * 7) * 0.6, _tip.z + Math.cos(g.time * 6) * 0.6, 2.4 / (1 + fkg * 0.08)); if (Math.random() < 0.02) splash?.emit(p, 4); }
        else { slackT += dt; d = pull(_tip.x, _tip.z, -0.8); say('Hold trigger to reel!'); }
        rope = d * 1.02 + 0.3;
        if (slackT > 3) { phase = 'floating'; waitT = rand(2, 4); fish = null; g.float(p, 'It escaped!', 0xff7a6b); g.sfx('miss', p, 0.5); say('It escaped. Wait for the next dip'); }
        else if (d < 1.3) caught();
      }
      stepLine(dt);
      // fish jumping to the rod, ripples
      if (fishT < 1.1) {
        fishT += dt; const u = Math.min(1, fishT / 1.0), m = fishM[fishKind];
        m.position.set(fishFrom.x + (_tip.x - fishFrom.x) * u, fishFrom.y + (_tip.y + 0.3 - fishFrom.y) * u + Math.sin(u * Math.PI) * 1.2, fishFrom.z + (_tip.z - fishFrom.z) * u); m.rotation.set(0, fishT * 6, Math.sin(fishT * 20) * 0.5);
        if (fishT >= 1.1) m.visible = false;
      }
      for (const r of rings) if (r.t < 1.2) { r.t += dt; const s = 0.1 + r.t * 1.0; r.m.scale.set(s, 1, s); r.mat.opacity = 0.7 * Math.max(0, 1 - r.t / 1.2); if (r.t >= 1.2) r.m.visible = false; }
      if (g.timeLeft <= 0) endRound();
    },
    idle(dt) { for (const r of rings) if (r.t < 1.2) { r.t += dt; if (r.t >= 1.2) r.m.visible = false; } },
    stop() { rod.visible = line.visible = false; phase = 'ready'; },
    info: { get phase() { return phase; }, get catches() { return catches; }, get biggest() { return biggest; }, get bob() { return bob; }, get fish() { return fish; }, get rope() { return rope; }, lakeOk, get tip() { return _tip; } },
  };
}


