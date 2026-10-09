// games/hideseek.js - one round, two phases. SEEK: 4-5 children hid BEHIND scattered cover (chosen with occlusion raycasts from your head); get within 2.5 m with the child in
// your view cone to find it ('warm/cold' hint on the board). HIDE: roles swap; a seeker with a vision cone (80 deg, 12 m, line of sight by physics raycast) walks from cover to cover:
// stay behind cover and CROUCH (head under 1.1 m above the ground) and keep still: the 'spotted' meter fills while he sees you standing, or moving; full = caught. Survive 30 s.
// Score = 60..180 per child found (faster = more) + 10 per second survived. Cover = primitive meshes with fixed Rapier colliders (group 'world'), rebuilt every reset from a seeded RNG.
export const meta = {
  name: 'hideseek', title: 'Hide and Seek', aliases: ['hide and seek', 'seek', 'hide', 'hide-and-seek', 'hide & seek'], icon: '🙈',
  description: 'find the children hiding behind cover, then hide from the seeker (crouch behind cover)', hint: 'Find the kids, then hide from the seeker',
  distance: 0, size: 20, par: 650, physics: true,
};
const SHIRTS = [0xff4a4a, 0x4ac8ff, 0xffd23a, 0x6aff6a, 0xff7af0], SEEK_BASE = 60, HIDE_T = 30, FIND_R = 2.5, FIND_CONE = Math.cos(55 * Math.PI / 180);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mulberry = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export default function (g) {
  const { THREE } = g, kit = g.world.kit, K = g.k, head = g.head, { Vector3 } = THREE;
  const _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _f = new Vector3();
  const coneMat = g.track(new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const cone = g.add(new THREE.Mesh(new THREE.CircleGeometry(1, 2), coneMat), g.root); cone.visible = false; cone.userData.noShadow = cone.userData.noOutline = cone.userData.noCull = true; cone.userData.ownGeo = true;
  const barMat = g.track(new THREE.MeshBasicMaterial({ color: 0xff4a3a, fog: false, depthTest: false })), barBack = g.track(new THREE.MeshBasicMaterial({ color: 0x101018, fog: false, depthTest: false }));
  const bar = g.add(new THREE.Mesh(g.geoBox(1, 1, 1), barMat), g.root), barBg = g.add(new THREE.Mesh(g.geoBox(1, 1, 1), barBack), g.root);
  for (const m of [bar, barBg]) { m.visible = false; m.renderOrder = 30; m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; }
  let covers = [], kids = [], seeker = null, level = 1, phase = 'idle', rng = mulberry(1), seekT = SEEK_BASE, found = 0, tick = 0, lastSt = '', giggleT = 0, spotted = 0, survived = 0, seeT = 0, wpT = 0, wait = 0, startDelay = 0, caught = false;
  let range = 12, half = 40 * Math.PI / 180, lastHx = 0, lastHz = 0, speed = 0, buzz = 0, seenNow = false, ends = false, hideBest = 0;
  const say = (s) => { if (s !== lastSt) { lastSt = s; g.status(s); } };
  const P = () => g.world.physics;
  const groundY = (x, z) => g.groundAt(x, z);

  // ---- cover
  function buildCover() {
    const n = 9, pts = [];
    for (let tries = 0; pts.length < n && tries < 200; tries++) {
      const a = rng() * Math.PI * 2, r = (4.5 + rng() * 8) * K, lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      if (Math.hypot(lx + 1.4, lz - 0.2) < 2.5 || pts.some((p) => Math.hypot(p.lx - lx, p.lz - lz) < 3 * K)) continue;
      pts.push({ lx, lz });
    }
    pts.forEach((p, i) => {
      const w = g.at(p.lx, 0, p.lz), y = groundY(w.x, w.z), kind = ['boulder', 'bush', 'crate', 'haystack'][i % 4], b = g.builder();
      let shape, size, h, rad;
      if (kind === 'boulder') { b.sph(0.85, 0x8a8a92, 0, 0.7, 0, 0.85, 8).sph(0.5, 0x7a7a82, 0.5, 0.4, 0.2, 0.8, 7); shape = 'sphere'; size = 0.85; h = 1.5; rad = 0.9; }
      else if (kind === 'bush') { b.sph(0.7, 0x2f8a3a, 0, 0.65, 0, 1, 8).sph(0.5, 0x3aa048, 0.4, 0.5, 0.2, 1, 7).sph(0.45, 0x2a7a34, -0.35, 0.5, -0.2, 1, 7); shape = 'sphere'; size = 0.7; h = 1.3; rad = 0.8; }
      else if (kind === 'crate') { b.box(1.2, 0.8, 1.2, 0xa07a46, 0, 0.4, 0).box(0.9, 0.7, 0.9, 0xb08a52, 0.1, 1.15, 0.05); shape = 'box'; size = [1.2, 1.5, 1.2]; h = 1.5; rad = 0.9; }
      else { b.cyl(0.9, 0.95, 1.3, 0xd6b24a, 0, 0.65, 0, 10).cone(1.0, 0.8, 0xc8a03a, 0, 1.7, 0, 10); shape = 'cylinder'; size = [0.92, 1.8]; h = 2.0; rad = 1.0; }
      const m = b.mesh(); m.position.set(w.x, y, w.z); m.rotation.y = rng() * 6;
      const cy = shape === 'sphere' ? 0.7 : shape === 'box' ? 0.75 : 0.9; // collider centre height
      const hd = P() ? g.body(m, { type: 'fixed', shape, size, group: 'world', friction: 0.6, round: true, position: { x: w.x, y: y + cy, z: w.z } }) : null;
      if (!hd) g.round(m);
      covers.push({ x: w.x, z: w.z, y, h, rad, m, hd, kind });
    });
  }
  const clearCover = () => { covers = []; };
  // is the segment (from -> to) blocked by the world (cover / terrain)?
  function blocked(fx, fy, fz, tx, ty, tz) {
    const Ph = P(); if (!Ph || !Ph.raycast) return false;
    _d.set(tx - fx, ty - fy, tz - fz); const L = _d.length(); if (L < 0.05) return false; _d.multiplyScalar(1 / L);
    const hit = Ph.raycast(_a.set(fx, fy, fz), _d, L, { groups: 'world' });
    return !!hit && hit.distance < L - 0.15;
  }

  // ---- children
  function hideKids() {
    const count = level >= 3 ? 5 : 4, order = covers.map((c, i) => i).sort((a, b) => Math.hypot(covers[b].x - head.x, covers[b].z - head.z) - Math.hypot(covers[a].x - head.x, covers[a].z - head.z) + (rng() - 0.5) * 8);
    const used = new Set();
    for (const i of order) {
      if (kids.length >= count) break; const c = covers[i]; if (used.has(i)) continue;
      const dx = c.x - head.x, dz = c.z - head.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      let spot = null;
      for (const side of [0, 0.5, -0.5]) { // straight behind, then a little to either side
        const ca = Math.cos(side), sa = Math.sin(side), vx = ux * ca - uz * sa, vz = ux * sa + uz * ca, x = c.x + vx * (c.rad + 0.45), z = c.z + vz * (c.rad + 0.45);
        if (blocked(head.x, head.y, head.z, x, groundY(x, z) + 0.85, z)) { spot = { x, z }; break; }
      }
      if (!spot || !kit || !kit.humanoid) continue;
      used.add(i);
      const a = kit.humanoid(g.ctx, { height: 1.1, shirt: SHIRTS[kids.length % 5], pants: 0x3a3a5a, x: spot.x, z: spot.z, yaw: Math.atan2(head.x - spot.x, head.z - spot.z), speed: 2.2, damageable: false, faction: 'neutral' });
      if (!a) continue; g.round(a); kids.push({ a, c, found: false, x: spot.x, z: spot.z });
    }
  }
  function nearestUnfound() { let b = 1e9; for (const k of kids) if (!k.found) b = Math.min(b, Math.hypot(k.a.position.x - head.x, k.a.position.z - head.z)); return b; }
  function findKid(k) {
    k.found = true; found++; const pts = 60 + Math.round(clamp(g.timeLeft, 0, SEEK_BASE) * 2);
    _a.set(k.a.position.x, k.a.position.y + 1.4, k.a.position.z); g.addScore(pts, _a, 'Found!'); g.sfx('cheer', _a, 0.5); g.pulse('both', 0.6, 80);
    k.a.say('You found me!', 2); k.a.wave(2); g.at(-2.2 + found * 0.65, 0, -1.2, _b); k.a.walkTo(_b.x, _b.z);
    if (found === kids.length) { g.note(`The player found all ${found} hiding children.`, true); startHide(); }
  }
  function updateSeek(dt) {
    _f.set(g.ctx.player.forward.x, 0, g.ctx.player.forward.z); const fl = _f.length() || 1; _f.multiplyScalar(1 / fl);
    for (const k of kids) {
      if (k.found) continue; const dx = k.a.position.x - head.x, dz = k.a.position.z - head.z, d = Math.hypot(dx, dz);
      if (d < FIND_R && (dx * _f.x + dz * _f.z) / (d || 1) > FIND_CONE) { findKid(k); if (phase !== 'seek') return; }
    }
    if ((giggleT -= dt) <= 0) { giggleT = 7; const un = kids.filter((k) => !k.found); if (un.length) un[Math.floor(rng() * un.length)].a.say('Hee hee', 1.6); }
    if ((tick -= dt) <= 0) { tick = 0.4; const d = nearestUnfound(); say(`${kids.length - found} left: ${d < 3.5 ? 'HOT!' : d < 6 ? 'Warm' : d < 10 ? 'Cool' : 'Cold'}`); g.headline(`${found}/${kids.length}`); }
    if (g.timeLeft <= 0) startHide();
  }

  // ---- phase 2: the seeker
  function startHide() {
    if (phase === 'hide') return; phase = 'hide';
    for (const k of kids) if (!k.found) { k.a.say('Over here!', 2); k.a.walkTo(k.x + 1.5, k.z + 1.5); }
    g.setTime(HIDE_T); spotted = 0; survived = 0; seenNow = false; startDelay = 4; wait = 0; caught = false; lastHx = head.x; lastHz = head.z; tick = 0;
    range = 12 * Math.min(1, 0.6 + K * 0.4); half = (35 + 3 * level) * Math.PI / 180;
    cone.geometry.dispose(); cone.geometry = new THREE.CircleGeometry(range, 18, -Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2); // sector facing local +Z
    // the seeker starts at the cover farthest from the player
    let far = covers[0]; for (const c of covers) if (!far || Math.hypot(c.x - head.x, c.z - head.z) > Math.hypot(far.x - head.x, far.z - head.z)) far = c;
    if (kit && kit.humanoid && far) {
      seeker = kit.humanoid(g.ctx, { height: 1.75, shirt: 0x3a3a48, pants: 0x202030, hat: 0x8a1a1a, x: far.x + 1.5, z: far.z + 1.5, yaw: Math.atan2(far.x - head.x, far.z - head.z), speed: 1.7 + 0.2 * level, damageable: false, faction: 'neutral' });
      if (seeker) { g.round(seeker); seeker.say('Ready or not, here I come!', 3); }
    }
    cone.visible = !!seeker; bar.visible = barBg.visible = !!seeker; g.headline('HIDE'); say('HIDE! Crouch behind cover'); g.sfx('bell'); g.note('The seeker is coming: the player now has to hide for thirty seconds.', false);
  }
  function nextWaypoint() { // half the time search the cover closest to the player, else any
    let c = covers[Math.floor(rng() * covers.length)];
    if (rng() < 0.55) for (const o of covers) if (Math.hypot(o.x - head.x, o.z - head.z) < Math.hypot(c.x - head.x, c.z - head.z) && Math.hypot(o.x - seeker.position.x, o.z - seeker.position.z) > 2) c = o;
    const a = rng() * 6.28; seeker.walkTo(c.x + Math.cos(a) * (c.rad + 1.1), c.z + Math.sin(a) * (c.rad + 1.1));
  }
  function updateHide(dt) {
    speed = Math.hypot(head.x - lastHx, head.z - lastHz) / Math.max(dt, 1e-3); lastHx = head.x; lastHz = head.z;
    if (seeker && !seeker.removed && covers.length) {
      const sp = seeker.position;
      if (startDelay > 0) startDelay -= dt;
      else if (wait > 0) { wait -= dt; if (wait <= 0) nextWaypoint(); else seeker.faceTo(_a.set(sp.x + Math.sin(seeker.yaw + 1.3 * Math.sin(g.time * 1.5)), 0, sp.z + Math.cos(seeker.yaw + 1.3 * Math.sin(g.time * 1.5))), 0.3); }
      else if (!seeker.hasGoal) { wait = 1.5 + rng() * 1.5; }
      // vision: cone + range + line of sight (+ crouched and still = invisible)
      const dx = head.x - sp.x, dz = head.z - sp.z, d = Math.hypot(dx, dz), fx = Math.sin(seeker.yaw), fz = Math.cos(seeker.yaw);
      const crouched = head.y - groundY(head.x, head.z) < 1.1, hidden = crouched && speed < 0.45;
      const inCone = d < range && d > 0.01 && (dx * fx + dz * fz) / d > Math.cos(half);
      seenNow = startDelay <= 0 && inCone && !hidden && !blocked(sp.x, sp.y + 1.55, sp.z, head.x, head.y, head.z);
      if (seenNow) { spotted += dt * (0.45 + 0.9 * (1 - d / range)); if ((buzz -= dt) <= 0) { buzz = 0.25; g.pulse('both', 0.3 + spotted * 0.5, 60); } }
      else spotted = Math.max(0, spotted - dt * 0.3);
      cone.position.set(sp.x, sp.y + 0.12, sp.z); cone.rotation.y = seeker.yaw; coneMat.color.setRGB(1, 0.89 - spotted * 0.6, 0.48 - spotted * 0.4); coneMat.opacity = seenNow ? 0.35 : 0.2;
      _b.set(sp.x, sp.y + 2.1, sp.z); bar.position.copy(_b); barBg.position.copy(_b); bar.rotation.y = barBg.rotation.y = Math.atan2(head.x - sp.x, head.z - sp.z);
      barBg.scale.set(0.9, 0.1, 0.02); bar.scale.set(Math.max(0.001, 0.86 * clamp(spotted, 0, 1)), 0.07, 0.03);
    }
    survived = HIDE_T - g.timeLeft;
    if ((tick -= dt) <= 0) { tick = 0.25; say(`${Math.ceil(g.timeLeft)}s  ${seenNow ? 'SEEN! ' : ''}spotted ${Math.round(clamp(spotted, 0, 1) * 100)}%`); }
    if (spotted >= 1) { caught = true; endRound(); } else if (g.timeLeft <= 0) endRound();
  }
  function endRound() {
    if (ends) return; ends = true; const t = clamp(survived, 0, HIDE_T);
    if (caught && seeker) seeker.say('Got you!', 2);
    const surv = Math.round(t * 10); g.addScore(surv, null); const sc = g.score;
    g.end({ score: sc, rating: clamp(sc / meta.par, 0, 1), text: caught ? 'Caught!' : 'Safe!', detail: `${found} found, hid ${t.toFixed(0)}s` });
  }
  return {
    reset(lv) {
      level = lv; rng = mulberry(900 + lv * 31); phase = 'idle'; kids = []; seeker = null; found = 0; spotted = 0; ends = false; lastSt = ''; clearCover(); buildCover();
      cone.visible = bar.visible = barBg.visible = false; g.status(meta.hint);
    },
    play(lv) {
      level = lv; phase = 'seek'; ends = false; found = 0; lastSt = ''; tick = 0; giggleT = 4;
      seekT = SEEK_BASE - 4 * lv; hideKids(); g.setTime(seekT);
      if (kids.length < 3) { g.status('Not enough cover here'); g.abort('no cover'); return; }
      g.headline(`0/${kids.length}`); say(`Find ${kids.length} children!`); g.note(`Hide and seek: ${kids.length} children are hiding within ${Math.round(14 * K)} metres.`, false);
    },
    update(dt) { if (phase === 'seek') updateSeek(dt); else if (phase === 'hide') updateHide(dt); },
    stop() { phase = 'idle'; cone.visible = bar.visible = barBg.visible = false; },
    info: { get kids() { return kids; }, get covers() { return covers; }, get phase() { return phase; }, get found() { return found; }, get spotted() { return spotted; }, get seeker() { return seeker; }, get seenNow() { return seenNow; }, get survived() { return survived; }, get caught() { return caught; }, blocked, get range() { return range; } },
  };
}


