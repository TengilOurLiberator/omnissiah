// library/behaviors.js - the ENCOUNTER behaviour layer. Installed by library/gear.js as H.behaviors (= B); enemies.js / allies.js / bosses.js use it.
// Docs: docs/ENCOUNTERS.md. Everything here sits ON TOP of the public fighter / actor APIs of core/combat.js and core/kit.js (no core file is edited):
//   a Ctrl (one per fighter) runs a cheap think (6 Hz) + a per-frame tick from a library ticker; behaviours are small objects { id, think(c), tick(c, dt), hit(c, e), strike(c, e), death(c) }
//   that either leave combat alone (it chases / winds up / strikes as before) or CLAIM it for a moment: c.claim(sec) keeps combat's think from re-walking the actor and
//   c.noAttack(sec) keeps its swings off. Special attacks are MOVES ({ begin, update(c, dt) -> true when done, end }) with a ground telegraph (B.tele), run one at a time.
// B.attach(inst, actor, fighter, [behaviours], { name, lines, ... }) -> ctrl      (fighter.ctrl / actor.ctrl)
// Behaviours (factories): circler pack skirmisher charger leaper stomper shield parry sniper bomber thrower healer buffer summoner morale ambusher grabber toss crawler
//   regenerator reassemble phase aura berserk strafer kamikaze webber spotter bodyguard medic tank formation orders ... (see the bottom of this file)
// Managers (pooled, allocation-free): B.tele (ground telegraphs), B.beam (lasers / links), B.lob (arcing bombs), B.zones (fire / web / frost patches), B.slowPlayer, B.after.
export default function install(H) {
  const { THREE, ctx, rand, pick, clamp, TAU } = H;
  const { Vector3, Color, Matrix4, Quaternion } = THREE;
  const S = (H.S.enc ??= {});
  S.ctrls = []; S.packs = new Map(); S.fallen = S.fallen || [];
  const W = () => ctx.world;
  const kit = () => ctx.world.kit, combat = () => ctx.world.combat, player = () => ctx.world.player;
  const head = ctx.player.head;
  const ground = (x, z) => ctx.groundAt(x, z);
  const isWater = (x, z) => { try { return !!ctx.world.env?.isWater?.(x, z); } catch (e) { return false; } };
  const now = () => ctx.clock.t;
  const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _e = new Vector3(), _q = new Quaternion(), _m = new Matrix4(), _s = new Vector3(), _col = new Color();
  const UP = new Vector3(0, 1, 0), ZAX = new Vector3(0, 0, 1), WHITE = new Color(1, 1, 1);
  const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const dens = () => clamp(ctx.quality?.density ?? 1, 0.25, 1);
  const B = { version: 1, S };

  // ================================================================== level scaling (bosses and anything that asks)
  B.level = () => { try { const p = ctx.world.quests?.profile?.(); return clamp((p && p.level) || 1, 1, 60); } catch (e) { return 1; } };
  B.hpScale = (lvl) => 1 + clamp(((lvl ?? B.level()) - 1) * 0.045, 0, 1.2);
  B.dmgScale = (lvl) => 1 + clamp(((lvl ?? B.level()) - 1) * 0.015, 0, 0.5);

  // ================================================================== timers (B.after(sec, fn, arg)): one pool, stepped by the manager tick
  const timers = [];
  B.after = (sec, fn, arg) => { timers.push({ t: sec, fn, arg }); };

  // ================================================================== ground telegraphs: 4 instanced meshes (disc, ring, rect, wedge), 2 instances per marker (dark base + bright fill that grows with progress k)
  const TCAP = 16;
  const tele = (B.tele = {});
  const markers = [];
  {
    const rectGeo = new THREE.BufferGeometry();
    rectGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1], 3));
    rectGeo.setIndex([0, 2, 1, 0, 3, 2]);
    const wedgeGeo = new THREE.BufferGeometry();
    wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1, 0, 1, 1, 0, 1], 3));
    wedgeGeo.setIndex([0, 2, 1]);
    const geos = [new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2), new THREE.RingGeometry(0.86, 1, 44).rotateX(-Math.PI / 2), rectGeo, wedgeGeo];
    tele.meshes = geos.map((g, si) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const m = new THREE.InstancedMesh(g, mat, TCAP * 2);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, WHITE); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.visible = false; m.frustumCulled = false; m.renderOrder = 4; m.name = 'encounter-tele-' + si;
      m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true;
      ctx.root.add(m);
      return m;
    });
    tele.pool = [];
    for (let s = 0; s < 4; s++) { const arr = []; for (let i = 0; i < TCAP; i++) arr.push({ on: false, shape: s, x: 0, y: 0, z: 0, yaw: 0, sx: 1, sz: 1, k: 0, ttl: -1, color: new Color(), flash: 0, fillMax: 1, follow: null, alpha: 1 }); tele.pool.push(arr); }
  }
  function mAlloc(shape, x, z, yaw, sx, sz, hex, ttl) {
    const arr = tele.pool[shape];
    for (let i = 0; i < TCAP; i++) {
      const m = arr[i];
      if (m.on) continue;
      m.on = true; m.x = x; m.z = z; m.yaw = yaw; m.sx = sx; m.sz = sz; m.k = 0; m.ttl = ttl ?? -1; m.color.set(hex ?? 0xff4020); m.flash = 0; m.follow = null; m.alpha = 1;
      m.y = lift(m);
      return m;
    }
    return null;
  }
  function lift(m) { // flat decal, high enough above the highest ground sample under it
    let y = ground(m.x, m.z);
    if (m.shape === 2 || m.shape === 3) { const ex = m.x + Math.sin(m.yaw) * m.sz, ez = m.z + Math.cos(m.yaw) * m.sz; y = Math.max(y, ground(ex, ez), ground((m.x + ex) / 2, (m.z + ez) / 2)); }
    else if (m.sx > 2.5) y = Math.max(y, ground(m.x + m.sx * 0.7, m.z), ground(m.x - m.sx * 0.7, m.z), ground(m.x, m.z + m.sx * 0.7), ground(m.x, m.z - m.sx * 0.7));
    return y + 0.1;
  }
  tele.disc = (x, z, r, hex, ttl) => mAlloc(0, x, z, 0, r, r, hex, ttl);
  tele.ring = (x, z, r, hex, ttl) => mAlloc(1, x, z, 0, r, r, hex, ttl);
  tele.rect = (x, z, yaw, w, len, hex, ttl) => mAlloc(2, x, z, yaw, w, len, hex, ttl);
  tele.wedge = (x, z, yaw, halfW, len, hex, ttl) => mAlloc(3, x, z, yaw, halfW, len, hex, ttl);
  tele.free = (m) => { if (m) { m.on = false; m.follow = null; } return null; };
  tele.place = (m, x, z, yaw) => { if (!m) return; m.x = x; m.z = z; if (yaw !== undefined) m.yaw = yaw; m.y = lift(m); };
  tele.active = () => { let n = 0; for (const arr of tele.pool) for (const m of arr) if (m.on) n++; return n; };
  function teleUpdate(dt) {
    for (let s = 0; s < 4; s++) {
      const arr = tele.pool[s], mesh = tele.meshes[s];
      let n = 0, any = false;
      for (let i = 0; i < TCAP; i++) {
        const m = arr[i];
        if (!m.on) continue;
        if (m.ttl >= 0) { m.ttl -= dt; if (m.ttl <= 0) { m.on = false; continue; } }
        if (m.follow) { const p = m.follow.position; m.x = p.x; m.z = p.z; m.y = lift(m); }
        any = true;
        _q.setFromAxisAngle(UP, m.yaw);
        _col.copy(m.color).multiplyScalar(0.42 * m.alpha);
        mesh.setMatrixAt(n, _m.compose(_a.set(m.x, m.y, m.z), _q, _s.set(m.sx, 1, m.sz))); mesh.setColorAt(n, _col); n++;
        if (s !== 1) {
          const k = clamp(m.k, 0, 1) * m.fillMax, kk = s === 0 ? Math.sqrt(k) : k;
          if (k > 0.005) {
            _col.copy(m.color).multiplyScalar(m.alpha);
            const fl = Math.max(m.flash, m.k > 0.88 ? (m.k - 0.88) * 5 : 0); if (fl > 0) _col.lerp(WHITE, Math.min(0.75, fl));
            if (s === 0) _s.set(m.sx * kk, 1, m.sz * kk); else if (s === 2) _s.set(m.sx * 0.94, 1, m.sz * kk); else _s.set(m.sx * kk, 1, m.sz * kk);
            mesh.setMatrixAt(n, _m.compose(_a.set(m.x, m.y + 0.012, m.z), _q, _s)); mesh.setColorAt(n, _col); n++;
          }
        } else if (m.k > 0.005) { // ring: bright inner ring that tightens / pulses with k
          _col.copy(m.color).multiplyScalar(m.alpha);
          mesh.setMatrixAt(n, _m.compose(_a.set(m.x, m.y + 0.012, m.z), _q, _s.set(m.sx * 0.94, 1, m.sz * 0.94))); mesh.setColorAt(n, _col); n++;
        }
      }
      mesh.count = n; mesh.visible = any;
      if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
    }
  }

  // ================================================================== beams (lasers, links): one instanced box mesh, additive
  const BCAP = 20, beam = (B.beam = {});
  {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    const m = new THREE.InstancedMesh(g, mat, BCAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, WHITE); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.visible = false; m.frustumCulled = false; m.renderOrder = 8; m.name = 'encounter-beams';
    m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true;
    ctx.root.add(m); beam.mesh = m;
    beam.pool = []; for (let i = 0; i < BCAP; i++) beam.pool.push({ on: false, a: new Vector3(), b: new Vector3(), w: 0.05, color: new Color(), ttl: -1, pulse: 0 });
  }
  beam.alloc = (w, hex, ttl) => { for (const b of beam.pool) if (!b.on) { b.on = true; b.w = w ?? 0.05; b.color.set(hex ?? 0xff2020); b.ttl = ttl ?? -1; b.pulse = 0; return b; } return null; };
  beam.free = (b) => { if (b) b.on = false; return null; };
  beam.set = (b, ax, ay, az, bx, by, bz) => { if (b) { b.a.set(ax, ay, az); b.b.set(bx, by, bz); } };
  function beamUpdate(dt) {
    const mesh = beam.mesh; let n = 0;
    for (const b of beam.pool) {
      if (!b.on) continue;
      if (b.ttl >= 0) { b.ttl -= dt; if (b.ttl <= 0) { b.on = false; continue; } }
      _d.subVectors(b.b, b.a); const len = _d.length(); if (len < 0.02) continue;
      _d.multiplyScalar(1 / len); _q.setFromUnitVectors(ZAX, _d);
      const w = b.w * (1 + b.pulse * 0.6 * Math.sin(now() * 40));
      mesh.setMatrixAt(n, _m.compose(b.a, _q, _s.set(w, w, len))); mesh.setColorAt(n, b.color); n++;
    }
    mesh.count = n; mesh.visible = n > 0;
    if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  }

  // ================================================================== lobs: arcing thrown things (bombs, boulders, acid, meteors) with a ground marker; one instanced sphere mesh
  const LCAP = 12, lob = (B.lobs = {});
  {
    const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }), LCAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, WHITE); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.visible = false; m.frustumCulled = false; m.name = 'encounter-lobs';
    m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true;
    ctx.root.add(m); lob.mesh = m;
    lob.pool = []; for (let i = 0; i < LCAP; i++) lob.pool.push({ on: false, t: 0, T: 1, s: new Vector3(), e: new Vector3(), h: 3, size: 0.2, color: new Color(), mark: null, c: null, onLand: null, trail: 0xffaa40, spin: 0, markR: 0 });
  }
  // B.lob(c, { from: Vector3, to: {x, z, y?}, flight: seconds, arc: metres of height, size, color, trail, marker: { r, color }, onLand(c, point) })
  B.lob = (c, o) => {
    let L = null; for (const l of lob.pool) if (!l.on) { L = l; break; }
    if (!L) return null;
    L.on = true; L.t = 0; L.T = Math.max(0.2, o.flight ?? 1.1); L.s.copy(o.from); L.e.set(o.to.x, o.to.y ?? ground(o.to.x, o.to.z), o.to.z);
    L.h = o.arc ?? Math.max(1.5, Math.hypot(L.e.x - L.s.x, L.e.z - L.s.z) * 0.22); L.size = o.size ?? 0.22; L.color.set(o.color ?? 0xffa030); L.trail = o.trail ?? o.color ?? 0xffa030;
    L.c = c; L.onLand = o.onLand || null; L.mark = null;
    if (o.marker) { L.mark = tele.disc(L.e.x, L.e.z, o.marker.r, o.marker.color ?? 0xff4020); L.markR = o.marker.r; }
    return L;
  };
  function lobUpdate(dt) {
    const mesh = lob.mesh; let n = 0;
    for (const L of lob.pool) {
      if (!L.on) continue;
      L.t += dt; const u = Math.min(1, L.t / L.T);
      if (L.mark) L.mark.k = u;
      _a.lerpVectors(L.s, L.e, u); _a.y += 4 * L.h * u * (1 - u);
      if (u >= 1) {
        L.on = false; if (L.mark) tele.free(L.mark); L.mark = null;
        if (L.onLand) { try { L.onLand(L.c, L.e); } catch (err) { console.error('[encounters] lob onLand failed', err); } }
        continue;
      }
      mesh.setMatrixAt(n, _m.compose(_a, _q.identity(), _s.set(L.size, L.size, L.size))); mesh.setColorAt(n, L.color); n++;
      if (((L.t * 30) | 0) !== (((L.t - dt) * 30) | 0)) H.burst(ctx, 'glow', L.trail, _a, 1, 0.25);
    }
    mesh.count = n; mesh.visible = n > 0;
    if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  }

  // ================================================================== player helpers: slow, shield-aware AoE, hurt
  const slows = new Map(); let slowBase = null;
  B.slowPlayer = (src, factor, secs) => { slows.set(src, { f: factor, until: now() + secs }); };
  B.unslow = (src) => { slows.delete(src); };
  function slowUpdate() {
    const P = player(); if (!P) return;
    let f = 1, t = now();
    for (const [k, v] of slows) { if (v.until < t) { slows.delete(k); continue; } if (v.f < f) f = v.f; }
    if (f < 1) { if (slowBase === null) slowBase = P.speed; P.speed = slowBase * f; }
    else if (slowBase !== null) { P.speed = slowBase; slowBase = null; }
  }
  const playerUp = () => { const P = player(); return !!P && P.alive !== false; };
  B.playerUp = playerUp;
  // damage in an area through kit.hit (hits the player, allies, destructibles); a held shield facing the attacker can stop the player's part of it
  const HO = { from: 'enemy', by: undefined, kind: 'blunt', direction: undefined, force: undefined };
  B.aoe = (c, point, radius, dmg, o = {}) => {
    const K = kit(); if (!K) return 0;
    const P = player(); let guard = false, prev = 0;
    if (P && playerUp() && o.blockable !== false) {
      const dx = head.x - point.x, dz = head.z - point.z, dy = head.y - point.y;
      if (dx * dx + dz * dz < (radius + 0.5) ** 2 && dy > -2.5 && dy < 3) {
        const Wp = ctx.world.weapons;
        if (Wp && Wp.blocks) {
          _c.set(point.x - head.x, 0, point.z - head.z); if (_c.lengthSq() < 0.01) _c.set(0, 0, 1); _c.normalize();
          _d.set(head.x, head.y - 0.3, head.z);
          try { guard = !!Wp.blocks(_d, _c, true); } catch (e) { guard = false; }
        }
      }
    }
    HO.from = o.from ?? (c && c.f ? c.f.faction : 'enemy'); HO.by = c ? c.f : undefined; HO.kind = o.kind ?? 'blunt'; HO.direction = o.dir; HO.force = o.force;
    if (guard) { prev = P.invulnerable; P.invulnerable = Infinity; }
    let n = 0;
    try { n = K.hit(point, radius, dmg, HO); } finally { if (guard) P.invulnerable = prev; }
    return n;
  };
  B.hurtPlayer = (c, amount, kind) => { const P = player(); if (P && playerUp() && amount > 0) P.damage(amount, { from: 'enemy', by: c ? c.f : undefined, point: undefined }); };
  B.shove = (fromX, fromZ, speed, up) => { // brief horizontal shove of the player away from a point (kept short: VR comfort)
    const P = player(); if (!P || !playerUp()) return;
    let dx = head.x - fromX, dz = head.z - fromZ; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    P.launch?.(dx * speed, up ?? 1.5, dz * speed);
  };

  // ================================================================== zones: lingering patches (fire, web, frost, poison, shadow)
  const ZCAP = 14, zones = (B.zones = { pool: [] });
  for (let i = 0; i < ZCAP; i++) zones.pool.push({ on: false, x: 0, z: 0, r: 2, ttl: 0, kind: 'fire', dps: 3, slow: 1, color: 0xff6a20, m: null, c: null, acc: 0, fx: 0 });
  const ZKIND = { fire: { color: 0xff6a20, dmg: 'fire', burst: 'fire' }, web: { color: 0xe8f0ff, dmg: 'pierce', burst: null }, frost: { color: 0x7ad8ff, dmg: 'frost', burst: 'glow' }, poison: { color: 0x7aff3a, dmg: 'magic', burst: 'glow' }, shadow: { color: 0x9a5cff, dmg: 'magic', burst: 'glow' }, acid: { color: 0xc8ff3a, dmg: 'magic', burst: 'glow' } };
  // B.zones.add(c, { x, z, r, ttl, kind, dps, slow (player speed factor), hostileTo: 'friendly' })
  zones.add = (c, o) => {
    let Z = null; for (const z of zones.pool) if (!z.on) { Z = z; break; }
    if (!Z) { let old = zones.pool[0]; for (const z of zones.pool) if (z.ttl < old.ttl) old = z; Z = old; if (Z.m) tele.free(Z.m); }
    const K = ZKIND[o.kind] || ZKIND.fire;
    Z.on = true; Z.x = o.x; Z.z = o.z; Z.r = o.r ?? 2; Z.ttl = o.ttl ?? 4; Z.kind = o.kind || 'fire'; Z.dps = o.dps ?? 3; Z.slow = o.slow ?? 1; Z.color = o.color ?? K.color; Z.c = c; Z.acc = 0; Z.fx = 0;
    Z.m = tele.ring(Z.x, Z.z, Z.r, Z.color); if (Z.m) { Z.m.k = 0.6; Z.m.alpha = 0.8; }
    return Z;
  };
  zones.at = (x, z, kind) => { for (const Z of zones.pool) if (Z.on && (!kind || Z.kind === kind) && (Z.x - x) ** 2 + (Z.z - z) ** 2 < Z.r * Z.r) return Z; return null; };
  zones.clear = (kind) => { for (const Z of zones.pool) if (Z.on && (!kind || Z.kind === kind)) { Z.on = false; if (Z.m) tele.free(Z.m); Z.m = null; B.unslow(Z); } };
  ctx.on('kit:hit', (e) => { // fire burns webs
    if (!e || e.kind !== 'fire' && e.kind !== 'explosion') return;
    for (const Z of zones.pool) if (Z.on && Z.kind === 'web' && Math.hypot(Z.x - e.point.x, Z.z - e.point.z) < Z.r + (e.radius || 1)) { Z.ttl = Math.min(Z.ttl, 0.2); H.burst(ctx, 'fire', 0xff8a30, _a.set(Z.x, ground(Z.x, Z.z) + 0.3, Z.z), 8, 0.7); }
  });
  function zoneUpdate(dt) {
    const C = combat(), P = player();
    for (const Z of zones.pool) {
      if (!Z.on) continue;
      Z.ttl -= dt;
      if (Z.m) { Z.m.alpha = clamp(Z.ttl * 0.8, 0.15, 0.8); }
      if (Z.ttl <= 0) { Z.on = false; if (Z.m) tele.free(Z.m); Z.m = null; B.unslow(Z); continue; }
      const K = ZKIND[Z.kind] || ZKIND.fire;
      Z.fx += dt * (K.burst ? 6 : 0) * dens();
      if (Z.fx >= 1 && K.burst) { Z.fx = 0; const a = rand(0, TAU), r = Math.sqrt(Math.random()) * Z.r; _a.set(Z.x + Math.cos(a) * r, ground(Z.x, Z.z) + 0.2, Z.z + Math.sin(a) * r); H.burst(ctx, K.burst, Z.color, _a, 1, 0.5); }
      Z.acc += dt;
      if (Z.acc < 0.3) continue;
      const step = Z.acc; Z.acc = 0;
      if (P && playerUp()) {
        const dx = head.x - Z.x, dz = head.z - Z.z;
        if (dx * dx + dz * dz < Z.r * Z.r && head.y - ground(head.x, head.z) < 2.6) {
          if (Z.slow < 1) B.slowPlayer(Z, Z.slow, 0.5);
          if (Z.dps > 0) { Z.pd = (Z.pd || 0) + Z.dps * step; if (Z.pd >= 1) { const a = Math.floor(Z.pd); Z.pd -= a; P.damage(a, { from: 'enemy', by: Z.c ? Z.c.f : undefined }); } }
        }
      }
      if (C && Z.dps > 0) for (let i = 0; i < C.fighters.length; i++) {
        const f = C.fighters[i];
        if (f.faction !== 'friendly' || !f.alive) continue;
        const p = f.actor.position; if ((p.x - Z.x) ** 2 + (p.z - Z.z) ** 2 < Z.r * Z.r) f.damage.hit(Z.dps * step, p, 'enemy', Z.c ? Z.c.f : undefined, K.dmg);
      }
    }
  }

  // ================================================================== speech: rate-limited lines (actor.say -> voices speak them); custom mobs do not emit actor:say themselves
  let lastSay = -9;
  B.say = (a, text, secs = 2.6) => {
    if (!a || a.dead || a.removed) return false;
    a.say(text, secs);
    if (a.kind === 'custom') ctx.events.emit('actor:say', { actor: a, text: String(text), seconds: secs });
    return true;
  };

  // ================================================================== clip helper (model bodies): play a clip by KayKit name / alias until it ends, then idle
  B.clip = (a, name, o) => {
    const M = a && a.mdl; if (!M || !M.ready || M.fell || !M.h) return false;
    const h = M.h; if (!h.has || !h.has(name)) return false;
    h.play(name, { loop: false, fade: 0.1, then: 'idle', ...(o || {}) });
    M.state = 'idle';
    return true;
  };
  B.isModel = (a) => !!(a && a.mdl && a.mdl.ready && !a.mdl.fell);

  // ================================================================== commit tokens: how many specials may be winding up against the player at once
  let pressureT = -1, pressureN = 0;
  B.pressure = (except) => {
    const t = now(); if (t - pressureT < 0.05 && !except) return pressureN;
    let n = 0;
    for (const c of S.ctrls) { if (c !== except && c.committed && !c.dead) n++; }
    const C = combat(); if (C) for (const f of C.fighters) if (f.faction === 'enemy' && f.state === 1 && f.tgt && f.tgt.isPlayer && !(f.ctrl && f.ctrl.committed) && f !== (except && except.f)) n++;
    if (!except) { pressureT = t; pressureN = n; }
    return n;
  };
  B.maxCommit = () => (dens() >= 0.7 ? 3 : 2);

  // ================================================================== packs (wolves surround and attack in turns)
  class Pack {
    constructor(key) { this.key = key; this.m = []; this.turn = 0; this.t = 0; this.slots = 1; }
    add(c) { this.m.push(c); }
    count() { let n = 0; for (const c of this.m) if (!c.dead && c.f.alive) n++; return n; }
    rank(c) { let r = 0; for (const o of this.m) { if (o === c) return r; if (!o.dead && o.f.alive) r++; } return r; }
    isTurn(c) {
      const t = now();
      if (t > this.t) { this.t = t + rand(1.3, 2.3); this.turn++; }
      const n = this.count(); if (n <= 1) return true;
      const slots = Math.max(1, Math.round(n / 4)), r = this.rank(c);
      return ((r - this.turn) % n + n) % n < slots;
    }
  }
  B.packFor = (c, group) => {
    const key = (c.inst.parent || c.inst) + ':' + (group || c.name);
    let p = S.packs.get(key); if (!p) { p = new Pack(key); S.packs.set(key, p); }
    p.add(c); c.pack = p; return p;
  };

  // ================================================================== the controller
  class Ctrl {
    constructor(inst, a, f, o) {
      this.inst = inst; this.a = a; this.f = f; this.name = (o && o.name) || f.name || inst.name; this.bs = []; this.t = now(); this.move = null; this.thinkAcc = rand(0, 0.2);
      this.cd = Object.create(null); this.tp = new Vector3(); this.tv = new Vector3(); this.lastTp = new Vector3(); this.hasT = false; this.dist = 99; this.edge = 99; this.ux = 0; this.uz = 1; this.tr = 0.4;
      this.tIsPlayer = false; this.tf = null; this.speedMul = 1; this.base = f.speed || a.speed || 2; this.committed = false; this.armor = !!(o && o.armor); this.stunUntil = 0; this.dead = false;
      this.lines = (o && o.lines) || null; this.sayAt = -99; this.noTaunt = !!(o && o.noTaunt); this.priority = (o && o.priority) || 0; this.pack = null; this.fleeing = false; this.fleeUntil = 0;
      this.f0 = { damage: f.damageAmt, cooldown: f.cooldown, windup: f.windup, range: f.range }; this.dmgMul = 1; this.talk = !(a.kind === 'creature') || !!(o && o.talk); this.sayGap = (o && o.sayGap) || 11; this.boss = !!(o && o.boss);
      this.hitT = -9; this.flags = Object.create(null); this.spawnT = now(); this.reach = f.range; this.phase = 0; this.bar = null;
      f.ctrl = this; a.ctrl = this;
      const d = a.damage;
      if (d) { const prev = d.onHit; d.onHit = (e) => { if (prev) prev(e); this.onHit(e); }; }
      S.ctrls.push(this);
    }
    add(...list) { for (const b of list.flat()) { if (!b) continue; this.bs.push(b); b.c = this; if (b.attach) b.attach(this); if (b.pack) B.packFor(this, b.pack === true ? undefined : b.pack); } return this; }
    // ---- sensing (once per think)
    sense() {
      const f = this.f, a = this.a, p = a.position, t = f.tgt;
      if (t && t.alive && !t.removed) {
        t.center(_e);
        const dt = Math.max(0.05, now() - this.sensedT || 0.2);
        this.tv.set((_e.x - this.lastTp.x) / dt, 0, (_e.z - this.lastTp.z) / dt); if (this.tv.lengthSq() > 144) this.tv.set(0, 0, 0);
        this.lastTp.copy(_e); this.sensedT = now();
        this.tp.copy(_e); this.hasT = true; this.tIsPlayer = !!t.isPlayer; this.tf = t.fighter || null; this.tr = t.radius || 0.4;
        const dx = _e.x - p.x, dz = _e.z - p.z, d = Math.hypot(dx, dz) || 0.001;
        this.dist = d; this.edge = d - this.tr; this.ux = dx / d; this.uz = dz / d;
      } else { this.hasT = false; this.tIsPlayer = false; this.tf = null; this.dist = 99; this.edge = 99; }
    }
    ready(k) { return this.t >= (this.cd[k] ?? 0); }
    setCd(k, lo, hi) { this.cd[k] = this.t + (hi === undefined ? lo : rand(lo, hi)); }
    claim(sec) { const f = this.f; if (f.thinkT < sec) f.thinkT = sec; }                     // combat's think will not re-walk us for `sec`
    noAttack(sec) { const f = this.f; if (f.atkCd < sec) f.atkCd = sec; }                  // combat will not start a swing for `sec`
    speed(mul) { H.speedMul(this.a, 'ai', this.speedMul * (mul ?? 1)); }                    // a.speed stays the base; the AI's pace is one named multiplier (library speedMul / kit legMul)
    speedTo(v) { H.speedMul(this.a, 'ai', v / (this.a.speed || 1)); }                         // absolute m/s (a dash)
    go(x, z, mul) { if (isWater(x, z) && !this.flags.aquatic) { const dx = head.x - x, dz = head.z - z, d = Math.hypot(dx, dz) || 1; x += dx / d * 3; z += dz / d * 3; if (isWater(x, z)) return false; } this.speed(mul); this.a.walkTo(x, z); return true; }
    face(sec) { if (this.hasT) this.a.faceTo(this.tp, sec ?? 0.3); }
    fwd(out) { return out.set(Math.sin(this.a.yaw), 0, Math.cos(this.a.yaw)); }
    muzzle(out) { const a = this.a; if (a.muzzleAt && a.muzzleAt(out)) return out; const p = a.position; return out.set(p.x + Math.sin(a.yaw) * 0.5, p.y + (a.height || 1.7) * 0.62, p.z + Math.cos(a.yaw) * 0.5); }
    canCommit() { return B.pressure(this) < B.maxCommit(); }
    // moves: one exclusive special at a time
    start(mv, committed) {
      if (this.move || this.dead) return false;
      const a = this.a, f = this.f;
      if (f.state !== 0) { f.state = 0; if (a.atkT >= 0) { a.atkT = -1; a.atkRaise = a.atkSwing = 0; } }
      this.move = mv; mv.t = 0; mv.c = this; this.committed = committed !== false && this.hasT && this.tIsPlayer && !this.boss;
      this.claim(0.6); this.noAttack(0.5);
      try { if (mv.begin) mv.begin(this); } catch (err) { console.error('[encounters] move begin failed', mv.name, err); this.move = null; this.committed = false; return false; }
      return true;
    }
    endMove(interrupted) {
      const mv = this.move; if (!mv) return;
      this.move = null; this.committed = false;
      try { if (mv.end) mv.end(this, !!interrupted); } catch (err) { console.error('[encounters] move end failed', mv.name, err); }
      this.speed(1); this.claim(0.1); this.noAttack(0.35);
    }
    stun(sec) { this.stunUntil = this.t + sec; this.a.staggerT = Math.max(this.a.staggerT, sec); if (this.move) this.endMove(true); if (B.isModel(this.a)) B.clip(this.a, 'Hit_B', { then: 'idle' }); }
    say(kind, text) {
      const a = this.a; if (!this.talk || a.dead || a.removed) return false;
      const t = now(); if (t - this.sayAt < (this.boss ? 3 : this.sayGap)) return false;
      if (!this.boss && t - lastSay < 1.4) return false;
      if (!this.boss && Math.hypot(a.position.x - head.x, a.position.z - head.z) > 28) return false;
      const arr = text ? null : this.lines && this.lines[kind]; if (!text && !(arr && arr.length)) return false;
      this.sayAt = t; lastSay = t;
      return B.say(a, text || pick(arr), 2.6);
    }
    hpFrac() { return this.f.hp / this.f.maxHp; }
    // ---- hooks
    onHit(e) {
      this.hitT = now();
      for (let i = 0; i < this.bs.length; i++) { const b = this.bs[i]; if (b.hit && !b.off) { try { b.hit(this, e); } catch (err) { b.off = true; console.error('[encounters] hit hook failed', b.id, err); } } }
      if (this.move && this.move.onHit) this.move.onHit(this, e);
    }
    onStrike(e) { for (let i = 0; i < this.bs.length; i++) { const b = this.bs[i]; if (b.strike && !b.off) { try { b.strike(this, e); } catch (err) { b.off = true; console.error(err); } } } }
    tick(dt) {
      const a = this.a, f = this.f;
      if (a.removed) { this.cleanup(); return true; }
      if (a.dead || !f.alive) { if (!this.dead) { this.dead = true; if (this.move) this.endMove(true); for (const b of this.bs) if (b.death && !b.off) { try { b.death(this); } catch (err) { console.error('[encounters] death hook failed', b.id, err); } } this.cleanup(); } return true; }
      this.t += dt;
      if (this.enrageUntil && this.t > this.enrageUntil) this.unrage();
      if (this.armor && a.staggerT > 0 && this.t >= this.stunUntil) a.staggerT = 0;
      else if (a.staggerT > 0 && this.move && this.move.interruptible !== false && !this.move.noInterrupt) this.endMove(true);
      if (this.move) {
        this.claim(0.3);
        if (this.move.noAttack !== false) this.noAttack(0.3);
        let done = false;
        try { done = this.move.update(this, dt); } catch (err) { console.error('[encounters] move failed', this.move.name, err); done = true; }
        if (done) this.endMove(false);
      } else if ((this.thinkAcc -= dt) <= 0) {
        const far = (a.position.x - head.x) ** 2 + (a.position.z - head.z) ** 2 > 2025;
        this.thinkAcc = (far ? 0.6 : 0.14) + Math.random() * 0.1;
        this.sense();
        for (let i = 0; i < this.bs.length; i++) { const b = this.bs[i]; if (b.think && !b.off) { let r = false; try { r = b.think(this); } catch (err) { b.off = true; console.error('[encounters] think failed', b.id, err); } if (r || this.move) break; } }
      }
      for (let i = 0; i < this.bs.length; i++) { const b = this.bs[i]; if (b.tick && !b.off) { try { b.tick(this, dt); } catch (err) { b.off = true; console.error('[encounters] tick failed', b.id, err); } } }
      return false;
    }
    cleanup() { const i = S.ctrls.indexOf(this); if (i >= 0) { S.ctrls[i] = S.ctrls[S.ctrls.length - 1]; S.ctrls.pop(); } if (this.bar) { this.bar.remove(); this.bar = null; } for (const b of this.bs) { if (b.detach) { try { b.detach(this); } catch (err) { /* gone */ } } } }
  }
  B.Ctrl = Ctrl;
  // B.attach(inst, actor, fighter, [behaviours], { name, lines, armor, talk, boss, priority, noTaunt, sayGap })
  B.attach = (inst, a, f, list, o) => {
    if (!a || !f) return null;
    const c = new Ctrl(inst, a, f, o);
    inst.tick((dt) => c.tick(dt));
    if (list) c.add(list);
    return c;
  };
  B.of = (f) => (f && f.ctrl) || null;
  ctx.on('combat:attack', (e) => { const c = e && e.attacker && e.attacker.ctrl; if (c) c.onStrike(e); });

  // ================================================================== manager tick
  H.addTicker(null, (dt) => {
    dt = Math.min(dt, 0.06);
    teleUpdate(dt); beamUpdate(dt); lobUpdate(dt); zoneUpdate(dt); slowUpdate();
    for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); try { tm.fn(tm.arg); } catch (err) { console.error('[encounters] timer failed', err); } } }
    if (S.packs.size > 40) for (const [k, p] of S.packs) if (!p.count()) S.packs.delete(k);
  });
  // corpses of fallen friendlies (for medics)
  ctx.on('combat:kill', (e) => {
    const v = e && e.victim; if (!v || v.faction !== 'friendly' || !v.actor || !v.name) return;
    const p = v.actor.position; S.fallen.push({ name: v.name, x: p.x, z: p.z, t: now(), actor: v.actor, hp: v.maxHp });
    if (S.fallen.length > 12) S.fallen.shift();
  });

  // ================================================================== BEHAVIOURS
  // ---- helpers used by several
  const edgeTo = (c) => c.edge;
  const awayPoint = (c, dist, out) => { const p = c.a.position; return out.set(p.x - c.ux * dist, 0, p.z - c.uz * dist); };

  // ---- circler: orbits its target at radius R, and goes in when it is this fighter's turn (with a pack: wolves surround, one or two attack at a time)
  B.circler = (o = {}) => {
    const R = o.radius ?? 3.6; let side = Math.random() < 0.5 ? -1 : 1, nextIn = 0, until = 0, phase = rand(0, TAU);
    return {
      id: 'circler', pack: o.pack,
      think(c) {
        if (!c.hasT || c.fleeing) return false;
        let attacker = true;
        if (c.pack) attacker = c.pack.isTurn(c);
        else { if (c.t > until) { nextIn = c.t + rand(1.6, 3.2); until = nextIn + rand(2.0, 3.2); side = -side; } attacker = c.t > nextIn; }
        if (c.edge > (o.farR ?? 24)) return false;
        if (attacker) return false;
        const n = c.pack ? c.pack.count() : 1, rank = c.pack ? c.pack.rank(c) : 0;
        const ang = (n > 1 ? (rank / n) * TAU : phase) + c.t * 0.45 * side;
        const x = c.tp.x + Math.cos(ang) * R, z = c.tp.z + Math.sin(ang) * R;
        c.claim(0.4); c.noAttack(0.35); c.go(x, z, c.dist < R * 1.5 ? 1.1 : 1);
        return true;
      },
    };
  };
  B.pack = (o = {}) => ({ id: 'pack', pack: o.group || true });

  // ---- skirmisher: after it strikes (or fires) it backs off a few metres, then returns; keeps its distance in between
  B.skirmisher = (o = {}) => {
    let until = 0;
    return {
      id: 'skirmisher',
      strike(c) { until = c.t + rand(o.min ?? 1.0, o.max ?? 1.8); },
      think(c) {
        if (!c.hasT || c.fleeing || c.t > until) return false;
        const p = c.a.position, d = o.dist ?? 5;
        if (c.dist > d * 1.4) { until = 0; return false; }
        c.claim(0.4); c.noAttack(0.4);
        _b.set(p.x - c.ux * d + c.uz * 1.2 * (c.f.id % 2 ? 1 : -1), 0, p.z - c.uz * d - c.ux * 1.2 * (c.f.id % 2 ? 1 : -1));
        c.go(_b.x, _b.z, o.speed ?? 1.25);
        return true;
      },
    };
  };

  // ---- sniper: keeps its range, lays a laser / aim line on you while winding up, repositions after each shot
  B.sniper = (o = {}) => {
    let lb = null, until = 0, repos = 0, strafeT = 0, sgn = 1;
    return {
      id: 'sniper',
      attach(c) { sgn = c.f.id % 2 ? 1 : -1; },
      strike(c) { repos = c.t + rand(0.2, 0.5); until = c.t + rand(1.4, 2.4); sgn = Math.random() < 0.5 ? -1 : 1; },
      think(c) {
        if (!c.hasT || c.fleeing || c.f.state === 1) return false;
        const f = c.f, R = f.range, ideal = R * (o.ideal ?? 0.72);
        const p = c.a.position;
        if (c.dist < R * (o.minFrac ?? 0.42)) { // too close: back away along the line, a little sideways
          c.claim(0.4); c.go(p.x - c.ux * 5 + c.uz * 2 * sgn, p.z - c.uz * 5 - c.ux * 2 * sgn, 1.2); return true;
        }
        if (c.t < until && c.t > repos) { // after a shot: sidestep to a new firing position
          c.claim(0.4); c.noAttack(0.2);
          c.go(p.x + c.uz * 5 * sgn - c.ux * 1.5, p.z - c.ux * 5 * sgn - c.uz * 1.5, 1.15); return true;
        }
        if (c.dist > R * 0.95) { c.claim(0.4); c.go(c.tp.x - c.ux * ideal, c.tp.z - c.uz * ideal, 1); return true; }
        return false;
      },
      tick(c, dt) {
        const f = c.f, w = f.state === 1 && c.hasT;
        if (w && o.laser !== false) {
          if (!lb) lb = beam.alloc(o.width ?? 0.035, o.color ?? 0xff2a2a);
          if (lb) { c.muzzle(_a); const k = f.windT < 0.15 ? 2.2 : 1; lb.w = (o.width ?? 0.035) * k; lb.color.set(f.windT < 0.15 ? 0xffffff : (o.color ?? 0xff2a2a)); beam.set(lb, _a.x, _a.y, _a.z, f.aim.x, f.aim.y, f.aim.z); }
        } else if (lb) lb = beam.free(lb);
      },
      death(c) { lb = beam.free(lb); },
      detach(c) { lb = beam.free(lb); },
    };
  };

  // ---- charger: telegraphed line dash. The lane locks half-way through the telegraph, so a side-step beats it. Hits stagger, break scenery; a miss that ends against a wall dazes it.
  B.charger = (o = {}) => {
    const T = o.tele ?? 0.95, len = o.len ?? 13, width = o.width ?? 1.1, spd = o.speed ?? 10, col = o.color ?? 0xff4a20;
    let lane = null, lx = 0, lz = 1, sx = 0, sz = 0, locked = false, hit = false, moved = 0, lastX = 0, lastZ = 0, stall = 0, crashed = false;
    const mv = {
      name: 'charge',
      begin(c) {
        const a = c.a, p = a.position; sx = p.x; sz = p.z; locked = false; hit = false; stall = 0; crashed = false; moved = 0; lastX = p.x; lastZ = p.z;
        lx = c.ux; lz = c.uz; a.stop(); a.attackAnim(T, 'melee');
        if (B.isModel(a) && o.clip) B.clip(a, o.clip, { then: 'idle' });
        lane = tele.rect(p.x, p.z, Math.atan2(lx, lz), width * 2, len, col);
        c.say('charge');
        H.sfx(ctx).tone({ freq: 90, freqEnd: 170, dur: T, type: 'sawtooth', vol: 0.16, at: p });
      },
      update(c, dt) {
        const a = c.a, p = a.position;
        if (mv.t < T) {
          mv.t += dt;
          const k = mv.t / T;
          if (lane) lane.k = k;
          if (k < 0.55 && c.hasT) { c.sense(); lx = c.ux; lz = c.uz; a.faceTo(c.tp, 0.2); if (lane) { lane.yaw = Math.atan2(lx, lz); lane.x = p.x; lane.z = p.z; lane.y = ground(p.x, p.z) + 0.1; } }
          else { if (!locked) { locked = true; if (lane) { lane.flash = 0.8; } } a.faceTo(_a.set(p.x + lx, 0, p.z + lz), 0.2); }
          a.stop();
          if (mv.t >= T) { sx = p.x; sz = p.z; lastX = sx; lastZ = sz; c.speedTo(spd); a.walkTo(sx + lx * len, sz + lz * len); a.faceTo(_a.set(p.x + lx, 0, p.z + lz), 1.2); if (lane) lane.k = 1; }
          return false;
        }
        // dash
        mv.t += dt;
        const dx = p.x - sx, dz = p.z - sz, trav = Math.hypot(dx, dz);
        moved += Math.hypot(p.x - lastX, p.z - lastZ); lastX = p.x; lastZ = p.z;
        if (lane) { lane.k = 1; lane.alpha = 0.6; }
        if (!hit && mv.t > T + 0.12) {
          _a.set(p.x + lx * (a.obsR + 0.5), p.y + 0.9, p.z + lz * (a.obsR + 0.5));
          if (touching(c, _a, width + 0.4)) { hit = true; B.aoe(c, _a, width + 0.5, c.f.damageAmt * (o.dmg ?? 1.3), { kind: 'blunt', force: o.force ?? 9, dir: _b.set(lx, 0.1, lz) }); if (c.tIsPlayer || true) B.shove(p.x, p.z, 3.2, 1.2); H.burst(ctx, 'puff', 0xb0a090, _a, 10, 1.2); mv.hitAt = mv.t; }
          else if (o.breaks !== false) { B.aoe(c, _a, 1.2, 30, { kind: 'blunt', force: 0, from: 'enemy', blockable: false }); }
        }
        const progress = trav / len;
        if (mv.t > T + 0.45) { const expect = spd * 0.35 * (mv.t - T - 0.3); if (moved < expect * 0.3) stall += dt; else stall = 0; if (stall > 0.25 && !hit) crashed = true; }
        if (hit && mv.t - mv.hitAt > 0.18) return true;
        if (crashed || progress >= 0.97 || mv.t > T + len / spd + 1.2) return true;
        return false;
      },
      end(c, intr) {
        lane = tele.free(lane); const a = c.a; a.stop();
        if (crashed && o.selfStun !== false && !intr) { H.burst(ctx, 'puff', 0x9a8a78, _a.set(a.position.x + lx * 1.2, a.position.y + 1, a.position.z + lz * 1.2), 12, 1.2); H.sfx(ctx).noise({ dur: 0.35, filter: { type: 'lowpass', freq: 500 }, vol: 0.4, at: a.position }); c.stun(o.stun ?? 1.1); }
        c.setCd('charge', ...(o.cd ?? [6, 9]));
      },
    };
    function touching(c, pt, r) {
      const P = player();
      if (P && playerUp() && Math.hypot(head.x - pt.x, head.z - pt.z) < r + 0.3 && head.y - ground(head.x, head.z) < 2.4) return true;
      const C = combat(); if (!C) return false;
      for (let i = 0; i < C.fighters.length; i++) { const g = C.fighters[i]; if (!g.alive || g.faction === c.f.faction || g.faction === 'neutral') continue; const q = g.actor.position; if (Math.hypot(q.x - pt.x, q.z - pt.z) < r + 0.3) return true; }
      return false;
    }
    return {
      id: 'charger', mv,
      think(c) {
        if (!c.hasT || c.fleeing || !c.ready('charge') || c.dist < (o.min ?? 5) || c.dist > (o.max ?? 15) || !c.canCommit()) return false;
        if (!c.tIsPlayer && !o.anyTarget) { c.setCd('charge', 1.5); return false; }
        if (blockedLine(c)) { c.setCd('charge', 1.5); return false; }
        return c.start(mv);
      },
    };
  };
  // is there scenery between the actor and its target? (physics ray, ground level)
  function blockedLine(c) {
    const Py = ctx.world.physics; if (!Py || !Py.ready || !Py.raycast) return false;
    const p = c.a.position; _a.set(p.x, p.y + 0.9, p.z); _b.set(c.tp.x - p.x, 0, c.tp.z - p.z); const d = _b.length(); if (d < 1) return false;
    return !!Py.raycast(_a, _b, d - 0.5, { groups: 'world' });
  }
  B.blockedLine = blockedLine;

  // ---- leaper: crouch (landing disc shown), arcing jump, landing shock
  B.leaper = (o = {}) => {
    const T = o.tele ?? 0.75, col = o.color ?? 0xff5a1a, shockR = o.radius ?? 2.8;
    let mark = null, ex = 0, ez = 0, sx = 0, sz = 0, dur = 0.8, air = false, landed = false;
    const mv = {
      name: 'leap',
      begin(c) {
        const a = c.a, p = a.position; sx = p.x; sz = p.z; air = false; landed = false;
        const lead = o.lead ?? 0.45, tx = c.tp.x + c.tv.x * lead, tz = c.tp.z + c.tv.z * lead;
        let d = Math.hypot(tx - p.x, tz - p.z) || 1; const stopShort = Math.min(o.land ?? 1.2, d * 0.5); ex = tx - ((tx - p.x) / d) * stopShort; ez = tz - ((tz - p.z) / d) * stopShort;
        if (isWater(ex, ez)) { ex = p.x; ez = p.z; }
        a.stop(); a.faceTo(_a.set(ex, 0, ez), T + 0.3);
        a.attackAnim(T, a.kind === 'creature' ? 'lunge' : 'melee'); if (B.isModel(a) && o.clip !== false) B.clip(a, o.clip || 'Jump_Start', { then: 'idle' });
        mark = tele.disc(ex, ez, shockR, col); c.say('leap');
        dur = clamp(Math.hypot(ex - p.x, ez - p.z) / 10, 0.5, 0.95);
        H.sfx(ctx).tone({ freq: 120, freqEnd: 260, dur: T, type: 'sawtooth', vol: 0.14, at: p });
      },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt;
        if (mv.t < T) { if (mark) mark.k = mv.t / T * 0.6; a.pivot.position.y = -0.12 * Math.sin(Math.min(1, mv.t / T) * Math.PI); return false; }
        const u = Math.min(1, (mv.t - T) / dur);
        if (!air) { air = true; if (B.isModel(a)) B.clip(a, 'Jump_Idle', { loop: true, then: undefined }); H.sfx(ctx).noise({ dur: 0.25, filter: { type: 'bandpass', freq: 800, freqEnd: 300 }, vol: 0.25, at: p }); }
        p.x = sx + (ex - sx) * u; p.z = sz + (ez - sz) * u;
        a.pivot.position.y = 4 * (o.height ?? 2.6) * u * (1 - u); a.faceTo(_a.set(ex, 0, ez), 0.2);
        if (mark) mark.k = 0.6 + 0.4 * u;
        if (u >= 1 && !landed) {
          landed = true; a.pivot.position.y = 0; _a.set(ex, ground(ex, ez) + 0.3, ez);
          B.aoe(c, _a, shockR, c.f.damageAmt * (o.dmg ?? 1.25), { kind: 'blunt', force: o.force ?? 7 });
          H.burst(ctx, 'puff', 0xa89880, _a, 16, 1.6); if (o.fire) H.burst(ctx, 'fire', 0xff6a20, _a, 14, 1.2);
          const sh = tele.ring(ex, ez, 0.6, col, 0.45); if (sh) { sh.k = 1; sh.sx = sh.sz = shockR; }
          H.sfx(ctx).tone({ freq: 70, freqEnd: 30, dur: 0.45, vol: 0.45, at: _a }); H.sfx(ctx).noise({ dur: 0.3, filter: { type: 'lowpass', freq: 700, freqEnd: 120 }, vol: 0.35, at: _a });
          if (o.zone) zones.add(c, { x: ex, z: ez, r: shockR * 0.8, ttl: o.zone, kind: o.zoneKind || 'fire', dps: 3 });
          return true;
        }
        return false;
      },
      end(c) { mark = tele.free(mark); c.a.pivot.position.y = 0; c.setCd('leap', ...(o.cd ?? [6, 10])); },
    };
    return {
      id: 'leaper', mv,
      think(c) {
        if (!c.hasT || c.fleeing || !c.ready('leap') || c.dist < (o.min ?? 4.5) || c.dist > (o.max ?? 12) || !c.canCommit()) return false;
        if (!c.tIsPlayer && !o.anyTarget) return false;
        if (blockedLine(c)) { c.setCd('leap', 1.2); return false; }
        return c.start(mv);
      },
    };
  };

  // ---- stomper: ground slam with a telegraphed disc around itself (or ahead of it)
  B.stomper = (o = {}) => {
    const T = o.tele ?? 1.0, R = o.radius ?? 4, col = o.color ?? 0xffa030; let mark = null, hit = false;
    const mv = {
      name: 'stomp',
      begin(c) { const a = c.a, p = a.position; hit = false; a.stop(); a.attackAnim(T, 'melee'); c.face(T); mark = tele.disc(p.x, p.z, R, col); c.say('stomp'); H.sfx(ctx).tone({ freq: 60, freqEnd: 110, dur: T, type: 'sawtooth', vol: 0.18, at: p }); },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt; if (mark) { mark.k = Math.min(1, mv.t / T); mark.x = p.x; mark.z = p.z; }
        if (mv.t >= T && !hit) {
          hit = true; _a.set(p.x, p.y + 0.4, p.z); B.aoe(c, _a, R, c.f.damageAmt * (o.dmg ?? 1.3), { kind: 'blunt', force: o.force ?? 7 });
          H.burst(ctx, 'puff', 0x8a7a68, _a, 18, 2); const sh = tele.ring(p.x, p.z, R, col, 0.5); if (sh) sh.k = 1;
          H.sfx(ctx).tone({ freq: 55, freqEnd: 25, dur: 0.6, vol: 0.5, at: _a }); H.sfx(ctx).noise({ dur: 0.4, filter: { type: 'lowpass', freq: 600, freqEnd: 100 }, vol: 0.4, at: _a });
        }
        return mv.t >= T + 0.35;
      },
      end(c) { mark = tele.free(mark); c.setCd('stomp', ...(o.cd ?? [7, 11])); },
    };
    return { id: 'stomper', mv, think(c) { if (!c.hasT || c.fleeing || !c.ready('stomp') || c.edge > (o.reach ?? 3.4) || !c.tIsPlayer || !c.canCommit()) return false; return c.start(mv); } };
  };

  // ---- shield: frontal block of physical blows (slash / pierce / blunt / arrows). Stagger, a broken shield, magic or a flank get through.
  B.shield = (o = {}) => {
    const half = Math.cos((o.arc ?? 2.1) / 2); let hp = o.hp ?? 45, downUntil = 0, guard = 0, blocks = 0, spark = null;
    const st = { up: true };
    return {
      id: 'shield', st,
      attach(c) {
        const d = c.a.damage; if (!d) return; const orig = d.hit; c.shield = st;
        d.hit = function (amount, point, from, by, kind, direction) {
          let k = kind, dir = direction;
          if (kind && typeof kind === 'object') { k = kind.kind; dir = kind.direction; }
          if (!st.up || c.dead || c.a.staggerT > 0 || c.t < downUntil || (c.fleeing)) return orig.call(d, amount, point, from, by, kind, direction);
          const g = c.t < guard; // guard window (parry): wider arc, nothing gets through
          if (k === 'fire' || k === 'magic' || k === 'shock' || k === 'frost') return orig.call(d, amount, point, from, by, kind, direction);
          if (k === 'explosion' && !g) return orig.call(d, amount * 0.6, point, from, by, kind, direction);
          const ap = c.a.position, fx = Math.sin(c.a.yaw), fz = Math.cos(c.a.yaw);
          let vx = 0, vz = 0;
          if (point) { vx = point.x - ap.x; vz = point.z - ap.z; }
          if (vx * vx + vz * vz < 0.09 && dir) { vx = -dir.x; vz = -dir.z; }
          const l = Math.hypot(vx, vz);
          if (l < 0.01) return orig.call(d, amount, point, from, by, kind, direction);
          const cs = (vx * fx + vz * fz) / l;
          if (cs < (g ? half - 0.45 : half)) return orig.call(d, amount, point, from, by, kind, direction); // flanked
          // blocked
          blocks++; hp -= amount; d.flash = 0.6;
          if (point) { H.burst(ctx, 'spark', 0xffe8a0, point, 6, 0.8); H.sfx(ctx).tone({ freq: 1500, freqEnd: 650, dur: 0.22, type: 'triangle', vol: 0.18, at: point }); H.sfx(ctx).tone({ freq: 180, freqEnd: 70, dur: 0.14, vol: 0.28, at: point }); }
          if (B.isModel(c.a) && !c.move) B.clip(c.a, 'Block_Hit', { then: 'idle' });
          if (o.onBlock) o.onBlock(c, blocks, amount);
          if (hp <= 0 && !g) { hp = o.hp ?? 45; downUntil = c.t + (o.down ?? 4.5); c.stun(o.stagger ?? 1.3); H.burst(ctx, 'spark', 0xffffff, _a.set(ap.x, ap.y + 1.2, ap.z), 14, 1.4); c.say('shield'); }
          return true;
        };
      },
      guard(c, sec) { guard = c.t + sec; },
      guarding(c) { return c.t < guard; },
      blocks() { return blocks; },
      resetBlocks() { blocks = 0; },
    };
  };
  // ---- parry: periodically raises its guard (gold ring + Block pose); anything swung into it is wasted, and it ripostes
  B.parry = (o = {}) => {
    const T = o.window ?? 1.5; let mark = null, rip = 0, ripT = 0, sh = null, b0 = 0;
    const mv = {
      name: 'guard',
      begin(c) { sh = c.bs.find((b) => b.id === 'shield'); b0 = sh ? sh.blocks() : 0; rip = 0; c.a.stop(); c.face(T); if (sh) sh.guard(c, T + 0.05); B.clip(c.a, 'Blocking', { loop: true }); mark = tele.ring(c.a.position.x, c.a.position.z, 1.5, 0xffd060); if (mark) { mark.k = 1; mark.follow = c.a; } c.say('guard'); H.sfx(ctx).tone({ freq: 400, freqEnd: 800, dur: 0.3, type: 'triangle', vol: 0.14, at: c.a.position }); },
      update(c, dt) {
        const a = c.a; mv.t += dt;
        if (mv.t < T) { if (mark) mark.alpha = 0.7 + 0.3 * Math.sin(mv.t * 14); if (c.hasT) a.faceTo(c.tp, 0.2); return false; }
        if (!rip) { rip = 1; ripT = 0; if (sh && sh.blocks() > b0 && c.hasT && c.edge < 3.2) { a.attackAnim(o.ripWindup ?? 0.42, 'melee'); mark = tele.free(mark); mark = tele.wedge(a.position.x, a.position.z, a.yaw, 1.4, 3, 0xff3a2a); c.say('riposte'); B.clip(a, '1H_Melee_Attack_Slice_Diagonal', { then: 'idle', speed: 1.2 }); } else return true; }
        ripT += dt; if (mark) { mark.k = ripT / (o.ripWindup ?? 0.42); mark.yaw = a.yaw; mark.x = a.position.x; mark.z = a.position.z; }
        if (rip === 1 && ripT >= (o.ripWindup ?? 0.42)) { rip = 2; _a.set(a.position.x + Math.sin(a.yaw) * 1.6, a.position.y + 1, a.position.z + Math.cos(a.yaw) * 1.6); B.aoe(c, _a, 1.7, c.f.damageAmt * 1.4, { kind: 'slash', force: 5 }); H.burst(ctx, 'spark', 0xffffff, _a, 10, 1); }
        return ripT >= (o.ripWindup ?? 0.42) + 0.45;
      },
      end(c) { mark = tele.free(mark); if (sh) sh.guard(c, 0); c.setCd('guard', ...(o.cd ?? [5, 8])); },
    };
    return { id: 'parry', mv, think(c) { if (!c.hasT || c.fleeing || !c.ready('guard') || c.edge > (o.reach ?? 5) || c.f.state === 1) return false; if (!c.canCommit()) return false; return c.start(mv, false); } };
  };

  // ---- bomber: lobs an explosive; the landing spot is marked on the ground and fills while it flies
  B.bomber = (o = {}) => {
    const T = o.windup ?? 0.8, fl = o.flight ?? 1.25, R = o.radius ?? 2.3; let thrown = false;
    const mv = {
      name: 'throw',
      begin(c) { const a = c.a; thrown = false; a.stop(); a.attackAnim(T, 'ranged'); if (B.isModel(a)) B.clip(a, 'Throw', { then: 'idle', speed: 0.9 }); c.say('throw'); H.sfx(ctx).tone({ freq: 300, freqEnd: 500, dur: T, type: 'triangle', vol: 0.1, at: a.position }); },
      update(c, dt) {
        const a = c.a; mv.t += dt;
        if (c.hasT && mv.t < T * 0.8) { c.sense(); a.faceTo(c.tp, 0.2); }
        if (!thrown && mv.t >= T) {
          thrown = true; if (!c.hasT) return true;
          const lead = fl * 0.7, tx = c.tp.x + c.tv.x * lead, tz = c.tp.z + c.tv.z * lead;
          c.muzzle(_c); _d.copy(_c);
          B.lob(c, { from: _d, to: { x: tx, z: tz }, flight: fl, arc: o.arc ?? 3.2, size: o.size ?? 0.2, color: o.color ?? 0xff8a20, trail: o.trail ?? 0xffb040, marker: { r: R, color: o.markColor ?? 0xff3a20 },
            onLand: (cc, pt) => { const dm = cc.f.damageAmt * (o.dmg ?? 1.5); _a.set(pt.x, pt.y + 0.4, pt.z); if (o.boom === 0) { H.burst(ctx, 'puff', o.boomColor ?? 0x8a7a68, _a, 14, 1.4); H.sfx(ctx).noise({ dur: 0.3, filter: { type: 'lowpass', freq: 600, freqEnd: 120 }, vol: 0.35, at: _a }); } else H.kit()?.explosion(ctx, _a, { size: o.boom ?? 1.5, color: o.boomColor ?? 0xff8a20 }); B.aoe(cc, _a, R, dm, { kind: o.kind ?? 'explosion', force: o.force ?? 6.5 }); if (o.zone) zones.add(cc, { x: pt.x, z: pt.z, r: R * 0.9, ttl: o.zone, kind: o.zoneKind || 'fire', dps: 3 }); } });
        }
        return mv.t >= T + 0.4;
      },
      end(c) { c.setCd('throw', ...(o.cd ?? [4.5, 7])); },
    };
    return { id: 'bomber', mv, think(c) { if (!c.hasT || c.fleeing || !c.ready('throw') || c.dist < (o.min ?? 5) || c.dist > (o.max ?? 17) || !c.canCommit()) return false; if (!c.tIsPlayer && !o.anyTarget) return false; if (blockedLine(c)) { c.setCd('throw', 1); return false; } return c.start(mv); } };
  };
  B.thrower = B.bomber; // boulders, logs: the same lob with other numbers

  // ---- enrage / unrage (buffs from shamans, berserk)
  Ctrl.prototype.enrage = function (sec, mul = 1.3) {
    if (this.enrageUntil > this.t) { this.enrageUntil = Math.max(this.enrageUntil, this.t + sec); return; }
    this.enrageUntil = this.t + sec; this.enraged = mul; this.speedMul *= mul; this.f.damageAmt *= mul; this.speed(1);
  };
  Ctrl.prototype.unrage = function () { if (!this.enrageUntil) return; this.enrageUntil = 0; this.speedMul /= this.enraged; this.f.damageAmt /= this.enraged; this.speed(1); };

  // ---- healer: channels a beam to a wounded ally and heals it (and, with `enrage`, drives a fighting ally into a frenzy). Priority target for the player's allies.
  B.healer = (o = {}) => {
    const T = o.cast ?? 0.9, range = o.range ?? 13, amt = o.heal ?? 12; let tgt = null, lb = null, mode = 'heal', done = false;
    function choose(c) {
      const C = combat(); if (!C) return null; let best = null, bs = 1e9; const p = c.a.position; mode = 'heal';
      for (let i = 0; i < C.fighters.length; i++) {
        const g = C.fighters[i]; if (g === c.f || !g.alive || g.faction !== c.f.faction) continue;
        const q = g.actor.position, d = Math.hypot(q.x - p.x, q.z - p.z); if (d > range) continue;
        const fr = g.hp / g.maxHp; if (fr < 0.72) { const s = fr * 20 + d * 0.2; if (s < bs) { bs = s; best = g; } }
      }
      if (!best && o.enrage) for (let i = 0; i < C.fighters.length; i++) {
        const g = C.fighters[i]; if (g === c.f || !g.alive || g.faction !== c.f.faction || !g.target || !g.ctrl || g.ctrl.enrageUntil || g.attack !== 'melee') continue;
        const q = g.actor.position, d = Math.hypot(q.x - p.x, q.z - p.z); if (d < range && d < bs) { bs = d; best = g; mode = 'enrage'; }
      }
      return best;
    }
    const mv = {
      name: 'heal',
      begin(c) { done = false; c.a.stop(); c.a.attackAnim(T, 'ranged'); B.clip(c.a, 'Spellcast_Raise', { then: 'idle' }); lb = beam.alloc(0.06, mode === 'heal' ? 0x6aff8a : 0xff6a30); c.say(mode === 'heal' ? 'heal' : 'enrage'); H.sfx(ctx).chord([660, 880, 1100], { dur: 0.6, type: 'sine', vol: 0.1, at: c.a.position, stagger: 0.07 }); },
      update(c, dt) {
        mv.t += dt; if (!tgt || !tgt.alive) return true;
        c.muzzle(_a); const q = tgt.actor.position; if (lb) { lb.pulse = 1; beam.set(lb, _a.x, _a.y, _a.z, q.x, q.y + (tgt.actor.height || 1.4) * 0.6, q.z); }
        c.face(0.2);
        if (!done && mv.t >= T) {
          done = true; _b.set(q.x, q.y + 1, q.z);
          if (mode === 'heal') { tgt.heal(amt); H.burst(ctx, 'glow', 0x6aff8a, _b, 12, 0.9, _c.set(0, 1.2, 0)); } else if (tgt.ctrl) { tgt.ctrl.enrage(o.enrageFor ?? 8, 1.3); H.burst(ctx, 'fire', 0xff4020, _b, 14, 1, _c.set(0, 1.5, 0)); }
        }
        return mv.t >= T + 0.25;
      },
      end(c) { lb = beam.free(lb); tgt = null; c.setCd('heal', ...(o.cd ?? [4, 6])); },
    };
    return {
      id: 'healer', mv,
      think(c) { if (c.fleeing || !c.ready('heal')) return false; const g = choose(c); if (!g) { c.setCd('heal', 1); return false; } tgt = g; return c.start(mv, false); },
      detach() { lb = beam.free(lb); },
    };
  };
  // ---- hider: stays behind its own line, away from the target
  B.hider = (o = {}) => ({
    id: 'hider',
    think(c) {
      if (!c.hasT || c.fleeing || c.dist > (o.min ?? 8) || c.f.state === 1) return false;
      const C = combat(); let best = null, bd = 1e9; const p = c.a.position;
      if (C) for (let i = 0; i < C.fighters.length; i++) { const g = C.fighters[i]; if (g === c.f || !g.alive || g.faction !== c.f.faction) continue; const q = g.actor.position, d = Math.hypot(q.x - c.tp.x, q.z - c.tp.z); if (d < bd && d < c.dist - 0.5) { bd = d; best = g; } }
      c.claim(0.45);
      if (best) { const q = best.actor.position; _b.set(q.x - c.tp.x, 0, q.z - c.tp.z).normalize(); c.go(q.x + _b.x * 2.6, q.z + _b.z * 2.6, 1.1); }
      else c.go(p.x - c.ux * 5, p.z - c.uz * 5, 1.15);
      return true;
    },
  });

  // ---- summoner: telegraphed circles, then adds (capped); with `corpses` it raises the bodies that really lie around
  function corpseNear(p, range) {
    const K = kit(), list = K && K.actors; if (!list) return null; let best = null, bd = range;
    for (let i = 0; i < list.length; i++) { const a = list[i]; if (!a.dead || a.removed || a.gibbed || a.raised || a.kind !== 'humanoid' || a.deadT < 0.8 || a.deadT > 25 || (a.height || 2) > 2.8) continue; const d = Math.hypot(a.position.x - p.x, a.position.z - p.z); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  B.corpseNear = corpseNear;
  B.summoner = (o = {}) => {
    const T = o.tele ?? 1.1, max = o.max ?? 4, kinds = o.kinds ?? ['skeleton']; let kids = [], pts = [], marks = [], corpses = [], done = false;
    const living = () => { let n = 0; kids = kids.filter((h) => !h.removed && h.alive > 0); for (const h of kids) n += h.alive; return n; };
    const mv = {
      name: 'summon',
      begin(c) {
        done = false; const a = c.a, p = a.position; a.stop(); pts.length = 0; corpses.length = 0; const n = Math.min(o.n ?? 2, max - living());
        for (let k = 0; k < n; k++) {
          const cp = o.corpses !== false ? corpseNear(p, o.corpseRange ?? 16) : null;
          if (cp && !corpses.includes(cp)) { cp.raised = true; corpses.push(cp); pts.push({ x: cp.position.x, z: cp.position.z, corpse: cp }); }
          else { const ang = rand(0, TAU), r = rand(o.rmin ?? 2.2, o.rmax ?? 3.8); let x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r; if (isWater(x, z)) { x = p.x; z = p.z + 2; } pts.push({ x, z, corpse: null }); }
        }
        marks.length = 0; for (const q of pts) marks.push(tele.disc(q.x, q.z, o.markR ?? 1.0, o.color ?? 0x7affc8));
        a.attackAnim(T, 'ranged'); B.clip(a, 'Spellcast_Summon', { then: 'idle' }); c.say('summon', o.line);
        H.sfx(ctx).tone({ freq: 90, freqEnd: 220, dur: T, type: 'sawtooth', vol: 0.15, at: p }); H.sfx(ctx).noise({ dur: T * 0.8, filter: { type: 'bandpass', freq: 600, freqEnd: 200 }, vol: 0.2, at: p });
      },
      update(c, dt) {
        mv.t += dt; for (const m of marks) if (m) m.k = Math.min(1, mv.t / T);
        if (!c.hasT && mv.t < T * 0.5 && !c.dead) { /* keep going anyway */ }
        if (!done && mv.t >= T) {
          done = true;
          for (const q of pts) {
            _a.set(q.x, ground(q.x, q.z) + 0.2, q.z); H.burst(ctx, 'glow', o.color ?? 0x7affc8, _a, 14, 1.2, _b.set(0, 2, 0));
            if (q.corpse) { try { q.corpse.remove(); } catch (e) { /* gone */ } }
            const nm = kinds[(Math.random() * kinds.length) | 0];
            const h = c.inst.sub(nm, { ...(o.opts || {}), x: q.x, z: q.z, rise: true, yaw: Math.atan2(head.x - q.x, head.z - q.z), worldYaw: true });
            if (h) kids.push(h);
          }
        }
        return mv.t >= T + 0.5;
      },
      end(c) { for (const m of marks) tele.free(m); marks.length = 0; for (const cp of corpses) if (cp && !cp.removed) cp.raised = false; c.setCd('summon', ...(o.cd ?? [8, 11])); },
    };
    return { id: 'summoner', mv, living, think(c) { if (!c.hasT || c.fleeing || !c.ready('summon')) return false; if (living() >= max) { c.setCd('summon', 1.5); return false; } return c.start(mv, false); } };
  };

  // ---- morale: flees at low hp (or when its leader / pack dies) and may come back
  B.morale = (o = {}) => {
    let api = null;
    return {
      id: 'morale',
      attach(c) { api = { flee(sec, why) { if (c.dead || c.fleeing || c.boss) return; c.fleeing = true; c.f.fleeing = true; c.fleeUntil = c.t + sec; if (c.move) c.endMove(true); c.say('flee', why === 'leader' ? o.leaderLine : undefined); } }; c.morale = api; },
      hit(c) { if (!c.fleeing && c.hpFrac() < (o.hp ?? 0.3) && Math.random() < (o.chance ?? 0.8) && c.ready('morale')) { c.setCd('morale', 12); api.flee(rand(...(o.away ?? [4, 8]))); } },
      think(c) {
        if (!c.fleeing) {
          if (o.alone && c.t - c.spawnT > 4 && c.hasT && c.ready('alone')) { c.setCd('alone', 3); const C = combat(); let mates = 0; if (C) for (const g of C.fighters) if (g !== c.f && g.faction === c.f.faction && g.alive && Math.hypot(g.actor.position.x - c.a.position.x, g.actor.position.z - c.a.position.z) < 18) mates++; if (mates === 0 && Math.random() < 0.5) api.flee(rand(3, 6)); }
          return false;
        }
        if (c.t > c.fleeUntil) {
          const armless = c.a.armsTotal > 0 && (c.a.armsLeft ?? 1) <= 0;
          if (!armless && (o.returns ?? true)) { c.fleeing = false; c.f.fleeing = false; c.say('return'); c.noAttack(0.8); } else c.fleeUntil = c.t + 3;
        }
        return false;
      },
    };
  };
  // leader: when it dies its followers lose heart
  B.leader = (o = {}) => ({
    id: 'leader',
    death(c) { const p = c.a.position; for (const x of S.ctrls) if (x !== c && x.morale && !x.dead && x.f.faction === c.f.faction && Math.hypot(x.a.position.x - p.x, x.a.position.z - p.z) < (o.radius ?? 30)) x.morale.flee(rand(5, 9), 'leader'); },
  });

  // ---- ambusher: hidden underground until the player is near (dust + rumble + a ground disc), then bursts out and strikes
  B.ambusher = (o = {}) => {
    const wake = o.wake ?? 4.4, T = o.emerge ?? 0.8; let hidden = false, mark = null, y0 = 1;
    const reveal = (c) => { hidden = false; c.a.group.visible = true; c.hidden = false; };
    const mv = {
      name: 'emerge', interruptible: false,
      begin(c) { const p = c.a.position; mark = tele.disc(p.x, p.z, o.burstR ?? 1.9, 0xb08a50); H.sfx(ctx).noise({ dur: T, filter: { type: 'lowpass', freq: 300, freqEnd: 120 }, vol: 0.3, at: p }); H.burst(ctx, 'puff', 0x8a7a68, _a.set(p.x, p.y + 0.2, p.z), 6, 0.9); },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt; if (mark) mark.k = Math.min(1, mv.t / T);
        if (Math.random() < 0.3) H.burst(ctx, 'puff', 0x8a7a68, _a.set(p.x + rand(-0.8, 0.8), p.y + 0.1, p.z + rand(-0.8, 0.8)), 1, 0.5);
        if (mv.t >= T && hidden) {
          reveal(c); a.group.scale.y = 0.1; H.burst(ctx, 'puff', 0x9a8a78, _a.set(p.x, p.y + 0.3, p.z), 16, 1.4); H.sfx(ctx).noise({ dur: 0.3, filter: { type: 'lowpass', freq: 800 }, vol: 0.35, at: p });
          _a.set(p.x, p.y + 0.4, p.z); B.aoe(c, _a, o.burstR ?? 1.9, c.f.damageAmt * (o.burst ?? 1.0), { kind: 'blunt', force: 4 }); c.say('ambush');
        }
        if (!hidden) { a.group.scale.y = Math.min(1, a.group.scale.y + dt * 4); if (a.group.scale.y >= 1) return true; }
        return false;
      },
      end(c) { mark = tele.free(mark); c.a.group.scale.y = 1; c.noAttack(o.firstStrike ?? 0.7); c.claim(0.1); },
    };
    return {
      id: 'ambusher', mv, get hidden() { return hidden; },
      attach(c) { hidden = true; c.hidden = true; c.a.group.visible = false; c.f.atkCd = 99; },
      hit(c) { if (hidden && !c.move) { c.f.atkCd = 0.5; c.start(mv, false); } },
      think(c) {
        if (!hidden) return false;
        c.claim(0.5); c.f.atkCd = Math.max(c.f.atkCd, 0.6);
        if (c.move) return true;
        const p = c.a.position; if ((p.x - head.x) ** 2 + (p.z - head.z) ** 2 < wake * wake && playerUp()) { c.f.atkCd = 0.4; c.start(mv, false); }
        return true;
      },
      wake(c) { if (hidden && !c.move) c.start(mv, false); },
    };
  };

  // ---- grabber (zombie): arms out, then a latch that slows the player until two blows shake it off
  B.grabber = (o = {}) => {
    const T = o.tele ?? 0.85, reach = o.reach ?? 2.0; let mark = null, latched = 0, hits = 0, tick = 0, spoke = false;
    const release = (c, shaken) => { if (!latched) return; latched = 0; B.unslow(c); if (shaken) { c.stun(0.7); H.burst(ctx, 'puff', 0x7f9a6a, _a.set(c.a.position.x, c.a.position.y + 1.2, c.a.position.z), 8, 0.8); } };
    const mv = {
      name: 'grab',
      begin(c) { const a = c.a, p = a.position; a.stop(); a.attackAnim(T, 'melee'); mark = tele.wedge(p.x, p.z, a.yaw, 1.1, reach + 0.9, 0x9acb4a); c.say('grab'); H.sfx(ctx).tone({ freq: 90, freqEnd: 70, dur: T, type: 'sawtooth', vol: 0.12, at: p }); },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt; if (mark) { mark.k = Math.min(1, mv.t / T); mark.x = p.x; mark.z = p.z; if (mv.t < T * 0.6) { c.sense(); if (c.hasT) { a.faceTo(c.tp, 0.2); mark.yaw = a.yaw; } } }
        if (mv.t >= T && !mv.did) {
          mv.did = true; const dx = head.x - p.x, dz = head.z - p.z, d = Math.hypot(dx, dz), cs = (dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)) / (d || 1);
          if (playerUp() && d < reach + 0.9 && cs > 0.45) { latched = c.t + (o.hold ?? 3.6); hits = 0; tick = 0; ctx.hud?.show?.('It has you! Strike it free!', 2); H.sfx(ctx).noise({ dur: 0.25, filter: { type: 'bandpass', freq: 400, q: 2 }, vol: 0.3, at: p }); }
          else c.setCd('grab', 1.5);
        }
        return mv.t >= T + 0.4;
      },
      end(c) { mark = tele.free(mark); mv.did = false; c.setCd('grab', ...(o.cd ?? [6, 9])); },
    };
    return {
      id: 'grabber', mv, get latched() { return latched > 0; },
      think(c) { if (latched || !c.hasT || c.fleeing || !c.ready('grab') || !c.tIsPlayer || c.edge > reach + 0.5 || !c.canCommit()) return false; return c.start(mv); },
      tick(c, dt) {
        if (!latched) return;
        const d = Math.hypot(head.x - c.a.position.x, head.z - c.a.position.z);
        if (!playerUp() || c.t > latched || d > reach + 2.6) { release(c, false); return; }
        B.slowPlayer(c, o.slow ?? 0.35, 0.4); c.noAttack(0.4); c.a.faceTo(head, 0.3);
        tick += dt; if (tick > 0.9) { tick = 0; player().damage(o.dot ?? 2, { from: 'enemy', by: c.f }); }
      },
      hit(c, e) { if (latched && e && (e.from === 'player' || e.from === 'friendly')) { hits++; if (hits >= 2) release(c, true); } },
      death(c) { release(c, false); }, detach(c) { release(c, false); },
    };
  };
  // ---- toss (troll): a long telegraphed grab; if it connects the player is thrown a few metres
  B.toss = (o = {}) => {
    const T = o.tele ?? 1.05, reach = o.reach ?? 3.0; let mark = null, fx = 0, fz = 0;
    const mv = {
      name: 'toss',
      begin(c) { const a = c.a, p = a.position; a.stop(); a.attackAnim(T, 'melee'); fx = Math.sin(a.yaw); fz = Math.cos(a.yaw); mark = tele.disc(p.x + fx * 1.7, p.z + fz * 1.7, reach * 0.75, 0xffd040); c.say('toss'); B.clip(a, 'Taunt', { then: 'idle', speed: 1.4 }); H.sfx(ctx).tone({ freq: 70, freqEnd: 130, dur: T, type: 'sawtooth', vol: 0.2, at: p }); },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt;
        if (mv.t < T * 0.6) { c.sense(); if (c.hasT) { a.faceTo(c.tp, 0.2); fx = Math.sin(a.yaw); fz = Math.cos(a.yaw); } if (mark) tele.place(mark, p.x + fx * 1.7, p.z + fz * 1.7); }
        if (mark) mark.k = Math.min(1, mv.t / T);
        if (mv.t >= T && !mv.did) {
          mv.did = true; const cx = p.x + fx * 1.7, cz = p.z + fz * 1.7;
          if (playerUp() && Math.hypot(head.x - cx, head.z - cz) < reach * 0.75 + 0.35) {
            _a.set(cx, p.y + 1, cz); const g = B.aoe(c, _a, reach * 0.75 + 0.3, c.f.damageAmt * 1.1, { kind: 'blunt', force: 5 });
            B.shove(p.x, p.z, o.throw ?? 5.2, o.up ?? 3.8); c.say('tossed'); H.burst(ctx, 'puff', 0x9a9a80, _a, 12, 1.4);
          } else H.burst(ctx, 'puff', 0x9a9a80, _a.set(cx, p.y + 0.5, cz), 8, 1);
          H.sfx(ctx).tone({ freq: 60, freqEnd: 30, dur: 0.4, vol: 0.4, at: p });
        }
        return mv.t >= T + 0.5;
      },
      end(c) { mark = tele.free(mark); mv.did = false; c.setCd('toss', ...(o.cd ?? [9, 13])); },
    };
    return { id: 'toss', mv, think(c) { if (!c.hasT || c.fleeing || !c.ready('toss') || !c.tIsPlayer || c.edge > reach || !c.canCommit()) return false; return c.start(mv); } };
  };
  // ---- crawler: a body with no legs keeps coming (relentless)
  B.crawler = () => ({ id: 'crawler', think(c) { const a = c.a; if (a.legsTotal > 0 && a.legsLeft === 0) { if (a.legMul < 0.4) a.legMul = 0.4; c.f.leash = 90; } return false; } });

  // ---- regenerator: heals over time unless it was hit recently or is burning
  B.regenerator = (o = {}) => {
    let last = -99, burn = -99, acc = 0;
    return {
      id: 'regenerator',
      hit(c, e) { last = c.t; if (e && (e.kind === 'fire' || e.kind === 'explosion') && e.amount > 0) burn = c.t + (o.burnFor ?? 8); },
      tick(c, dt) {
        acc += dt; if (acc < 0.5) return; const d = acc; acc = 0;
        c.regen = c.t - last > (o.delay ?? 3.5) && c.t > burn && c.f.hp < c.f.maxHp;
        if (c.regen) { c.f.heal((o.rate ?? 0.025) * c.f.maxHp * d); if (Math.random() < 0.5) H.burst(ctx, 'glow', 0x6aff6a, _a.set(c.a.position.x + rand(-0.4, 0.4), c.a.position.y + rand(0.6, 1.8), c.a.position.z + rand(-0.4, 0.4)), 1, 0.4, _b.set(0, 0.8, 0)); }
        c.burning = c.t < burn;
      },
    };
  };

  // ---- reassemble: a skeleton killed by edge or arrow rises again once; blunt force, a blast or a smashed pile ends it
  const rebuilds = (S.rebuild = []);
  ctx.on('kit:hit', (e) => {
    if (!rebuilds.length || !e || (e.kind !== 'blunt' && e.kind !== 'explosion')) return;
    for (const r of rebuilds) if (!r.dead && Math.hypot(r.x - e.point.x, r.z - e.point.z) < (e.radius || 0.5) + 1.0) { r.dead = true; shatter(r.x, r.z); }
  });
  function shatter(x, z) { _a.set(x, ground(x, z) + 0.3, z); H.burst(ctx, 'bits', 0xe6dfc8, _a, 16, 1.2); H.sfx(ctx).noise({ dur: 0.2, filter: { type: 'bandpass', freq: 2200, q: 3 }, vol: 0.3, at: _a }); }
  B.reassemble = (o = {}) => ({
    id: 'reassemble',
    death(c) {
      const a = c.a, lh = a.damage && a.damage.lastHit, kind = lh ? lh.kind : 'slash', p = a.position;
      if (kind === 'blunt' || kind === 'explosion' || kind === 'fire' || a.gibbed || (o.once !== false && c.flags.reborn)) { if (kind !== 'fire') shatter(p.x, p.z); return; }
      const r = { x: p.x, z: p.z, dead: false, t: 0 }; rebuilds.push(r);
      const name = c.f.libName || c.name, inst = c.inst, y0 = c.a.yaw, T = o.delay ?? 3.4, corpse = a;
      const tickR = () => {
        if (r.dead || inst.removed) { const i = rebuilds.indexOf(r); if (i >= 0) rebuilds.splice(i, 1); return; }
        r.t += 0.45;
        if (r.t >= T) {
          const i = rebuilds.indexOf(r); if (i >= 0) rebuilds.splice(i, 1);
          _a.set(r.x, ground(r.x, r.z) + 0.3, r.z); H.burst(ctx, 'glow', 0x7affc8, _a, 16, 1.2, _b.set(0, 2, 0)); H.sfx(ctx).tone({ freq: 140, freqEnd: 300, dur: 0.6, type: 'triangle', vol: 0.2, at: _a });
          try { if (corpse && !corpse.removed) corpse.remove(); } catch (e) { /* gone */ }
          const h = inst.sub(name, { x: r.x, z: r.z, rise: true, yaw: y0, worldYaw: true, reassembled: 1, hp: Math.max(8, Math.round(c.f.maxHp * (o.hp ?? 0.55))), variant: o.variant });
          if (h && h.fighters[0] && h.fighters[0].ctrl) { h.fighters[0].ctrl.flags.reborn = true; h.fighters[0].ctrl.say('reborn', 'Not... yet...'); }
          return;
        }
        if (Math.random() < 0.7) H.burst(ctx, 'bits', 0xe6dfc8, _a.set(r.x + rand(-0.4, 0.4), ground(r.x, r.z) + 0.1, r.z + rand(-0.4, 0.4)), 2, 0.5, _b.set(0, 1.4, 0));
        if (((r.t / 0.45) | 0) % 2 === 0) H.sfx(ctx).noise({ dur: 0.05, filter: { type: 'bandpass', freq: 2400 + Math.random() * 900, q: 4 }, vol: 0.18, at: _a.set(r.x, ground(r.x, r.z) + 0.2, r.z) });
        B.after(0.45, tickR);
      };
      B.after(0.9, tickR);
    },
  });

  // ---- phase: wraith-style blink with a tell; unhittable while out; optionally immune to piercing
  B.phase = (o = {}) => {
    const T = o.tele ?? 0.8, out = 0.35; let mark = null, dx = 0, dz = 0, stage = 0, imm = null;
    const mv = {
      name: 'blink', interruptible: false,
      begin(c) {
        const a = c.a, p = a.position; stage = 0; const ang0 = Math.atan2(ctx.player.forward.x, ctx.player.forward.z) + (Math.random() < 0.5 ? -1 : 1) * (o.angle ?? 1.7), r = o.land ?? 3.4;
        dx = head.x + Math.sin(ang0) * r; dz = head.z + Math.cos(ang0) * r; if (isWater(dx, dz)) { dx = head.x - Math.sin(ang0) * r; dz = head.z - Math.cos(ang0) * r; }
        mark = tele.ring(dx, dz, 1.1, 0x9fe8ff); a.stop(); c.say('blink'); H.sfx(ctx).tone({ freq: 380, freqEnd: 120, dur: T + 0.3, type: 'triangle', vol: 0.12, at: _a.set(dx, 1.2, dz) });
      },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt;
        if (stage === 0 && mark) mark.k = Math.min(1, mv.t / T);
        if (stage === 0 && mv.t >= T) { stage = 1; c.phasing = true; H.burst(ctx, 'glow', 0x9fe8ff, _a.set(p.x, p.y + 1.2, p.z), 14, 1.2); }
        if (stage === 1) { const k = clamp((mv.t - T) / out, 0, 1); a.pivot.scale.setScalar(Math.max(0.02, 1 - k)); if (k >= 1) { stage = 2; p.x = dx; p.z = dz; if (a.ch) a.ch.teleport?.(dx, ground(dx, dz) + 0.02, dz); } }
        if (stage === 2) { const k = clamp((mv.t - T - out) / out, 0, 1); a.pivot.scale.setScalar(Math.max(0.02, k)); if (k >= 1) { c.phasing = false; H.burst(ctx, 'glow', 0x9fe8ff, _a.set(p.x, p.y + 1.2, p.z), 16, 1.4); return true; } }
        return false;
      },
      end(c) { mark = tele.free(mark); c.phasing = false; c.a.pivot.scale.setScalar(1); c.setCd('blink', ...(o.cd ?? [6, 9])); c.noAttack(0.55); },
    };
    return {
      id: 'phase', mv,
      attach(c) {
        const d = c.a.damage; if (!d) return; const orig = d.hit;
        d.hit = function (amount, point, from, by, kind, direction) {
          const k = kind && typeof kind === 'object' ? kind.kind : kind;
          if (c.phasing) return false;
          if (o.immune && o.immune.includes(k)) { if (point) { H.burst(ctx, 'glow', 0x9fe8ff, point, 4, 0.6); H.sfx(ctx).tone({ freq: 900, freqEnd: 700, dur: 0.12, type: 'sine', vol: 0.08, at: point }); } c.flags.passed = (c.flags.passed || 0) + 1; return false; }
          return orig.call(d, amount, point, from, by, kind, direction);
        };
      },
      think(c) { if (!c.hasT || c.fleeing || !c.ready('blink') || c.dist < (o.min ?? 5) || c.dist > (o.max ?? 14) || !c.tIsPlayer || !c.canCommit()) return false; return c.start(mv); },
    };
  };

  // ---- aura: burn / chill / poison field around the body (ring on the ground, damage over time, optional slow)
  B.aura = (o = {}) => {
    const R = o.r ?? 2.6; let ring = null, acc = 0, fx = 0, pd = 0;
    return {
      id: 'aura',
      attach(c) { if (o.ring !== false) { ring = tele.ring(c.a.position.x, c.a.position.z, R, o.color ?? 0xff6a20); if (ring) { ring.k = 0.5; ring.alpha = 0.55; ring.follow = c.a; } } },
      tick(c, dt) {
        if (c.auraOffUntil > c.t) return;
        const a = c.a, p = a.position;
        fx += dt * (o.rate ?? 9) * dens(); if (fx >= 1) { fx = 0; const ang = rand(0, TAU), r = Math.sqrt(Math.random()) * R; H.burst(ctx, o.burst ?? 'fire', o.color ?? 0xff6a20, _a.set(p.x + Math.cos(ang) * r, p.y + rand(0.1, 0.8), p.z + Math.sin(ang) * r), 1, 0.5); }
        acc += dt; if (acc < 0.4) return; const step = acc; acc = 0;
        if (playerUp()) { const d = Math.hypot(head.x - p.x, head.z - p.z); if (d < R && head.y - p.y < 3) { if (o.slow) B.slowPlayer(c, o.slow, 0.6); pd += (o.dps ?? 2) * step; if (pd >= 1) { const n = Math.floor(pd); pd -= n; player().damage(n, { from: 'enemy', by: c.f }); } } }
        const C = combat(); if (C && o.dps) for (let i = 0; i < C.fighters.length; i++) { const g = C.fighters[i]; if (g.faction === 'friendly' && g.alive && Math.hypot(g.actor.position.x - p.x, g.actor.position.z - p.z) < R) g.damage.hit(o.dps * step, g.actor.position, 'enemy', c.f, o.kind || 'fire'); }
      },
      death(c) { ring = tele.free(ring); B.unslow(c); }, detach(c) { ring = tele.free(ring); B.unslow(c); },
    };
  };

  // ---- berserk: below a health threshold it roars (a visible pause), then hits harder, faster and quicker
  B.berserk = (o = {}) => {
    let done = false, mark = null;
    const mv = {
      name: 'roar', noInterrupt: true, interruptible: false,
      begin(c) { const a = c.a, p = a.position; a.stop(); a.attackAnim(0.01, 'melee'); a.atkT = -1; B.clip(a, 'Taunt', { then: 'idle' }); mark = tele.ring(p.x, p.z, 0.8, 0xff2a1a); if (mark) mark.k = 1; c.say('berserk'); H.sfx(ctx).tone({ freq: 70, freqEnd: 150, dur: o.roar ?? 1.0, type: 'sawtooth', vol: 0.3, at: p }); H.sfx(ctx).noise({ dur: 0.7, filter: { type: 'bandpass', freq: 500, freqEnd: 250 }, vol: 0.3, at: p }); },
      update(c, dt) { mv.t += dt; const p = c.a.position; if (mark) { mark.x = p.x; mark.z = p.z; const k = mv.t / (o.roar ?? 1); mark.sx = mark.sz = 0.8 + k * 3.5; mark.alpha = 1 - k * 0.7; } if (mv.t > 0.2) H.burst(ctx, 'fire', 0xff2a1a, _a.set(p.x + rand(-0.5, 0.5), p.y + 1.2, p.z + rand(-0.5, 0.5)), 1, 0.6); return mv.t >= (o.roar ?? 1); },
      end(c) { mark = tele.free(mark); const f = c.f; c.speedMul *= o.speed ?? 1.3; f.damageAmt *= o.dmg ?? 1.3; f.cooldown *= o.cd ?? 0.75; f.windup = Math.max(0.5, f.windup * 0.85); c.speed(1); c.berserk = true; },
    };
    return {
      id: 'berserk', mv,
      think(c) { if (done || c.fleeing || c.hpFrac() > (o.hp ?? 0.4) || !c.hasT) return false; done = true; return c.start(mv, false); },
      tick(c, dt) { if (c.berserk && !c.dead && Math.random() < dt * 8 * dens()) H.burst(ctx, 'fire', 0xff3a1a, _a.set(c.a.position.x + rand(-0.4, 0.4), c.a.position.y + rand(0.6, 2), c.a.position.z + rand(-0.4, 0.4)), 1, 0.4, _b.set(0, 1, 0)); },
    };
  };

  // ---- breath: cone of fire. A telegraphed wedge on the ground locks half way; then a stream with damage ticks along it (optionally sweeping)
  B.breathMove = (o = {}) => {
    const T = o.tele ?? 1.3, dur = o.dur ?? 1.6, len = o.len ?? 11, half = o.half ?? 2.8, sweep = o.sweep ?? 0;
    let m = null, yaw = 0, tick = 0, fxa = 0;
    const mv = {
      name: 'breath', noInterrupt: !!o.armored,
      begin(c) { const a = c.a; a.stop(); yaw = a.yaw; m = tele.wedge(a.position.x, a.position.z, yaw, half, len, o.color ?? 0xff5a1a); tick = 0; fxa = 0; c.say('breath', o.line); B.clip(a, o.clip || 'breathe', { then: 'idle' }) || a.attackAnim(T, 'ranged'); H.sfx(ctx).tone({ freq: 70, freqEnd: 150, dur: T, type: 'sawtooth', vol: 0.3, at: a.position }); H.sfx(ctx).noise({ dur: T, filter: { type: 'lowpass', freq: 300, freqEnd: 900 }, vol: 0.3, at: a.position }); },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt;
        if (mv.t < T) { const k = mv.t / T; if (m) m.k = k; if (k < 0.6 && c.hasT) { c.sense(); yaw = Math.atan2(c.tp.x - p.x, c.tp.z - p.z); a.faceTo(c.tp, 0.2); } if (m) { m.yaw = yaw; m.x = p.x; m.z = p.z; } return false; }
        const u = (mv.t - T) / dur; if (sweep) { /* sweep ends at yaw+sweep */ }
        const yy = yaw + (u - 0.5) * sweep; a.faceTo(_a.set(p.x + Math.sin(yy), 0, p.z + Math.cos(yy)), 0.2);
        if (m) { m.k = 1; m.yaw = yy; m.x = p.x; m.z = p.z; m.alpha = 0.7; m.flash = 0.5; }
        if (c.mouth) c.mouth(_c); else c.muzzle(_c);
        _d.set(Math.sin(yy), -0.05, Math.cos(yy));
        fxa += dt * 60 * dens(); const n = fxa | 0; fxa -= n; if (n) H.burst(ctx, 'fire', o.fire ?? 0xff5a1a, _c, n, 1.4, _e.copy(_d).multiplyScalar(len * 0.9));
        tick += dt;
        if (tick > 0.2) { tick = 0; for (let q = 1; q <= 3; q++) { const f = q / 3; _a.set(p.x + _d.x * len * f, ground(p.x + _d.x * len * f, p.z + _d.z * len * f) + 0.6, p.z + _d.z * len * f); B.aoe(c, _a, half * f + 0.6, c.f.damageAmt * (o.dmg ?? 0.35), { kind: 'fire', force: 0 }); if (o.zone && Math.random() < 0.35) zones.add(c, { x: _a.x, z: _a.z, r: 1.4, ttl: o.zone, kind: 'fire', dps: 3 }); } }
        return u >= 1;
      },
      end(c) { m = tele.free(m); c.setCd('breath', ...(o.cd ?? [8, 11])); },
    };
    return mv;
  };
  B.breath = (o = {}) => { const mv = B.breathMove(o); return { id: 'breath', mv, attach(c) { if (o.mouth) c.mouth = o.mouth(c); else if (c.a.rig && c.a.rig.mouth) c.mouth = (out) => (c.a.mdl && c.a.mdl.ready ? c.a.rig.mouth(out) : c.muzzle(out)); }, think(c) { if (!c.hasT || c.fleeing || !c.ready('breath') || c.dist < (o.min ?? 4) || c.dist > (o.max ?? 16) || !c.tIsPlayer || !c.canCommit()) return false; return c.start(mv); } }; };

  // ---- strafer: a flying run. Hovers off, shows the lane on the ground, then sweeps along it breathing fire; patches of flame burn behind it.
  B.strafer = (o = {}) => {
    const T = o.tele ?? 1.1, spd = o.speed ?? 9, off = o.offset ?? 3.4; let m = null, ex = 0, ez = 0, tx = 0, tz = 0, stage = 0, fxa = 0, tick = 0, ux = 0, uz = 1, sgn = 1;
    const mv = {
      name: 'strafe', interruptible: true,
      begin(c) {
        const a = c.a, p = a.position; sgn = Math.random() < 0.5 ? -1 : 1;
        const bearing = Math.atan2(p.x - head.x, p.z - head.z) + sgn * 0.9; ex = head.x + Math.sin(bearing) * (o.entry ?? 15); ez = head.z + Math.cos(bearing) * (o.entry ?? 15);
        if (isWater(ex, ez)) { ex = head.x - (ex - head.x); ez = head.z - (ez - head.z); }
        stage = 0; c.speed(1.5); a.walkTo(ex, ez); c.say('strafe');
      },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt;
        if (stage === 0) { if (Math.hypot(p.x - ex, p.z - ez) < 1.6 || mv.t > 4.5) { stage = 1; mv.t0 = mv.t; a.stop(); ux = head.x - p.x; uz = head.z - p.z; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; const px = -uz * off * sgn, pz = ux * off * sgn; tx = head.x + ux * 12 + px * 0.2; ez = p.z; tx = p.x + ux * (l + 14); tz = p.z + uz * (l + 14); const lx = (head.x + px) - p.x, lz = (head.z + pz) - p.z, ll = Math.hypot(lx, lz) || 1; ux = lx / ll; uz = lz / ll; tx = p.x + ux * (ll + 14); tz = p.z + uz * (ll + 14); m = tele.rect(p.x, p.z, Math.atan2(ux, uz), 2.8, ll + 14, 0xff5a1a); H.sfx(ctx).tone({ freq: 300, freqEnd: 500, dur: T, type: 'sawtooth', vol: 0.12, at: p }); } return false; }
        if (stage === 1) { const k = (mv.t - mv.t0) / T; if (m) m.k = Math.min(1, k); a.faceTo(_a.set(p.x + ux, 0, p.z + uz), 0.2); if (k >= 1) { stage = 2; c.speedTo(spd); a.walkTo(tx, tz); mv.t1 = mv.t; } return false; }
        // run
        if (m) { m.k = 1; m.alpha = 0.7; }
        if (c.mouth) c.mouth(_c); else c.muzzle(_c);
        fxa += dt * 50 * dens(); const n = fxa | 0; fxa -= n; if (n) H.burst(ctx, 'fire', 0xff5a1a, _c, n, 1.1, _e.set(ux * 3, -5, uz * 3));
        tick += dt; if (tick > 0.14) { tick = 0; const gx = p.x + ux * 2.5, gz = p.z + uz * 2.5; _a.set(gx, ground(gx, gz) + 0.5, gz); B.aoe(c, _a, 2.0, c.f.damageAmt * 0.45, { kind: 'fire', force: 0 }); if (Math.random() < 0.3) zones.add(c, { x: gx, z: gz, r: 1.5, ttl: 2.5, kind: 'fire', dps: 3 }); }
        return Math.hypot(p.x - tx, p.z - tz) < 2 || mv.t - mv.t1 > 3.2;
      },
      end(c) { m = tele.free(m); c.setCd('strafe', ...(o.cd ?? [7, 10])); c.a.stop(); },
    };
    return { id: 'strafer', mv, think(c) { if (!c.hasT || c.fleeing || !c.ready('strafe') || !c.tIsPlayer || c.dist > (o.max ?? 24) || !c.canCommit()) return false; return c.start(mv); } };
  };

  // ---- kamikaze: closes in, a short fuse (ring + beeps), then goes off
  B.kamikaze = (o = {}) => {
    const T = o.fuse ?? 0.9, R = o.radius ?? 3.2; let mark = null, beeps = 0;
    const mv = {
      name: 'fuse', noInterrupt: true,
      begin(c) { const p = c.a.position; c.a.stop(); mark = tele.disc(p.x, p.z, R, 0xff3030); beeps = 0; c.say('fuse'); },
      update(c, dt) {
        const a = c.a, p = a.position; mv.t += dt; if (mark) { mark.k = mv.t / T; mark.x = p.x; mark.z = p.z; }
        const nb = Math.floor(mv.t * (6 + mv.t * 6)); if (nb > beeps) { beeps = nb; H.sfx(ctx).tone({ freq: 880 + mv.t * 700, dur: 0.06, type: 'square', vol: 0.12, at: p }); }
        if (mv.t >= T) { _a.set(p.x, p.y + 0.8, p.z); H.kit()?.explosion(ctx, _a, { size: o.boom ?? 1.8, color: 0xff7a30 }); B.aoe(c, _a, R, c.f.damageAmt * (o.dmg ?? 2.2), { kind: 'explosion', force: 7 }); mv.boom = true; return true; }
        return false;
      },
      end(c) { mark = tele.free(mark); if (mv.boom) { mv.boom = false; const d = c.a.damage; if (d && d.alive) d.hit(d.hp + 5, c.a.position, 'enemy', undefined, 'explosion'); } },
    };
    return { id: 'kamikaze', mv, think(c) { if (!c.hasT || !c.tIsPlayer || c.edge > (o.trigger ?? 2.4) || c.fleeing) return false; return c.start(mv, false); } };
  };

  // ---- webber: lobs a web; where it lands a patch slows the player (and burns away with fire)
  B.webber = (o = {}) => {
    const T = o.windup ?? 0.7, fl = o.flight ?? 0.9, R = o.radius ?? 2.4; let thrown = false;
    const mv = {
      name: 'web',
      begin(c) { thrown = false; c.a.stop(); c.a.attackAnim(T, 'ranged'); c.say('web'); },
      update(c, dt) {
        const a = c.a; mv.t += dt; if (c.hasT && mv.t < T * 0.8) { c.sense(); a.faceTo(c.tp, 0.2); }
        if (!thrown && mv.t >= T) {
          thrown = true; if (!c.hasT) return true; c.muzzle(_d);
          B.lob(c, { from: _d, to: { x: c.tp.x + c.tv.x * fl * 0.6, z: c.tp.z + c.tv.z * fl * 0.6 }, flight: fl, arc: 1.8, size: 0.2, color: 0xf0f4ff, trail: 0xf0f4ff, marker: { r: R, color: 0xdde8ff },
            onLand: (cc, pt) => { zones.add(cc, { x: pt.x, z: pt.z, r: R, ttl: o.ttl ?? 6, kind: 'web', dps: 0, slow: o.slow ?? 0.4 }); H.burst(ctx, 'puff', 0xf0f4ff, _a.set(pt.x, pt.y + 0.3, pt.z), 10, 1); } });
        }
        return mv.t >= T + 0.3;
      },
      end(c) { c.setCd('web', ...(o.cd ?? [7, 10])); },
    };
    return { id: 'webber', mv, think(c) { if (!c.hasT || c.fleeing || !c.ready('web') || !c.tIsPlayer || c.dist < 4 || c.dist > (o.max ?? 14) || !c.canCommit()) return false; return c.start(mv); } };
  };

  // ================================================================== ALLIES
  const ENEMY_NAMES = { 'goblin-shaman': 'shaman', necromancer: 'necromancer', 'skeleton-archer': 'archer', 'goblin-archer': 'archer', drone: 'drone', 'battle-robot': 'robot' };
  // spotter: ranged allies call a priority target (healers, summoners, snipers) and focus it
  B.spotter = (o = {}) => ({
    id: 'spotter',
    think(c) {
      if (!c.ready('spot')) return false; c.setCd('spot', 2.2); const C = combat(); if (!C) return false;
      const p = c.a.position, R = c.f.range + 4; let best = null, bs = 0;
      for (let i = 0; i < C.fighters.length; i++) {
        const g = C.fighters[i]; if (g.faction !== 'enemy' || !g.alive || !g.ctrl || !g.ctrl.priority) continue;
        const d = Math.hypot(g.actor.position.x - p.x, g.actor.position.z - p.z); if (d > R) continue;
        const s = g.ctrl.priority * 10 - d * 0.3; if (s > bs) { bs = s; best = g; }
      }
      if (best) {
        if (c.f.target !== best) { c.f.setTarget(best); c.say('call', 'Focus the ' + (ENEMY_NAMES[best.name] || best.name || 'enemy') + '!'); for (const x of S.ctrls) if (x !== c && !x.dead && x.f.faction === 'friendly' && x.bs.some((b) => b.id === 'spotter') && x.f.attack === 'ranged' && x.f.target !== best) x.f.setTarget(best); }
      } else if (c.f.target && c.f.tgt && c.f.tgt.fighter && c.f.tgt.fighter.ctrl && c.f.tgt.fighter.ctrl.priority && !c.f.tgt.fighter.alive) c.f.setTarget(null);
      return false;
    },
  });
  // bodyguard: steps between the player (or a ward) and the nearest threat
  B.bodyguard = (o = {}) => ({
    id: 'bodyguard',
    think(c) {
      if (!playerUp() || !c.hasT || !c.f.tgt) return false;
      if (c.edge <= c.f.range * 1.15) return false; // in reach: let combat swing
      const tx = c.tp.x, tz = c.tp.z, dx = tx - head.x, dz = tz - head.z, d = Math.hypot(dx, dz); if (d < 1.2 || d > 16) return false;
      const gap = o.gap ?? 1.9, px = head.x + dx / d * gap, pz = head.z + dz / d * gap, me = c.a.position;
      if (Math.hypot(me.x - px, me.z - pz) < 0.8) { c.claim(0.3); c.noAttack(0.2); c.a.stop(); c.a.faceTo(c.tp, 0.3); return true; }
      c.claim(0.35); c.go(px, pz, 1.25); return true;
    },
  });
  // tank: a taunt shout pulls nearby enemies onto it for a few seconds (bosses ignore it)
  B.tank = (o = {}) => {
    const R = o.radius ?? 11, secs = o.secs ?? 4;
    const mv = {
      name: 'taunt',
      begin(c) { const p = c.a.position; c.a.stop(); B.clip(c.a, 'Taunt', { then: 'idle' }); c.say('taunt', o.line ?? 'Face me!'); mv.m = tele.ring(p.x, p.z, 0.6, 0x58c8ff); H.sfx(ctx).tone({ freq: 200, freqEnd: 320, dur: 0.5, type: 'sawtooth', vol: 0.2, at: p }); },
      update(c, dt) {
        mv.t += dt; const p = c.a.position; if (mv.m) { mv.m.k = 1; mv.m.sx = mv.m.sz = 0.6 + (R - 0.6) * Math.min(1, mv.t / 0.5); mv.m.alpha = 1 - mv.t; mv.m.x = p.x; mv.m.z = p.z; }
        if (mv.t >= 0.45 && !mv.did) {
          mv.did = true; const C = combat(); let n = 0;
          if (C) for (let i = 0; i < C.fighters.length; i++) { const e = C.fighters[i]; if (e.faction !== 'enemy' || !e.alive || (e.ctrl && e.ctrl.noTaunt)) continue; const q = e.actor.position; if (Math.hypot(q.x - p.x, q.z - p.z) > R) continue; e.setTarget(c.f); n++; B.after(secs, (pair) => { if (pair.e.alive && pair.e.target === pair.t) pair.e.setTarget(null); }, { e, t: c.f }); }
          c.taunted = n;
        }
        return mv.t >= 0.8;
      },
      end(c) { if (mv.m) tele.free(mv.m); mv.m = null; mv.did = false; c.setCd('taunt', ...(o.cd ?? [8, 11])); },
    };
    return {
      id: 'tank', mv,
      think(c) { if (!c.ready('taunt') || !c.hasT) return false; const C = combat(); if (!C) return false; let n = 0; const p = c.a.position; for (const e of C.fighters) if (e.faction === 'enemy' && e.alive && Math.hypot(e.actor.position.x - p.x, e.actor.position.z - p.z) < R && e.target !== c.f) n++; if (n < (o.min ?? 2)) { c.setCd('taunt', 1.5); return false; } return c.start(mv, false); },
    };
  };
  // medic: heals the player and wounded allies, and stands fallen allies back up (a fresh body at half health on the spot)
  B.medic = (o = {}) => {
    let tgt = null, lb = null;
    const mv = {
      name: 'revive', noInterrupt: false,
      begin(c) { c.a.stop(); lb = beam.alloc(0.07, 0xffe08a); c.say('revive', 'Rise, friend!'); B.clip(c.a, 'Spellcast_Long', { then: 'idle' }); },
      update(c, dt) {
        mv.t += dt; const T = o.channel ?? 2.4; if (!tgt || mv.t > T + 0.4) return true;
        c.muzzle(_a); if (lb) { lb.pulse = 1; beam.set(lb, _a.x, _a.y, _a.z, tgt.x, ground(tgt.x, tgt.z) + 0.3 + mv.t * 0.4, tgt.z); }
        if (Math.random() < 0.4) H.burst(ctx, 'glow', 0xffe08a, _b.set(tgt.x + rand(-0.4, 0.4), ground(tgt.x, tgt.z) + 0.2, tgt.z + rand(-0.4, 0.4)), 1, 0.6, _c.set(0, 1.5, 0));
        if (mv.t >= T && !mv.did) {
          mv.did = true; const i = S.fallen.indexOf(tgt); if (i >= 0) S.fallen.splice(i, 1);
          try { if (tgt.actor && !tgt.actor.removed) tgt.actor.remove(); } catch (e) { /* gone */ }
          const h = c.inst.sub(tgt.name, { x: tgt.x, z: tgt.z, rise: true, yaw: Math.atan2(head.x - tgt.x, head.z - tgt.z), worldYaw: true, faction: 'friendly', hp: Math.max(10, Math.round(tgt.hp * 0.5)) });
          H.burst(ctx, 'glow', 0xffe08a, _b.set(tgt.x, ground(tgt.x, tgt.z) + 0.5, tgt.z), 24, 1.6, _c.set(0, 2.5, 0)); H.sfx(ctx).chord([523, 659, 784, 1047], { dur: 0.9, type: 'triangle', vol: 0.2, at: _b, stagger: 0.07 });
          c.revived = (c.revived || 0) + (h ? 1 : 0);
        }
        return false;
      },
      end(c) { lb = beam.free(lb); tgt = null; c.setCd('revive', ...(o.cd ?? [14, 18])); },
    };
    return {
      id: 'medic', mv,
      think(c) {
        if (!c.ready('revive') || c.hasT && c.edge < 6) return false;
        const p = c.a.position; let best = null, bd = o.range ?? 16;
        for (const fl of S.fallen) { if (now() - fl.t > 50) continue; const d = Math.hypot(fl.x - p.x, fl.z - p.z); if (d < bd) { bd = d; best = fl; } }
        if (!best) { c.setCd('revive', 2); return false; }
        const C = combat(); if (C) for (const e of C.fighters) if (e.faction === 'enemy' && e.alive && Math.hypot(e.actor.position.x - best.x, e.actor.position.z - best.z) < 6) { c.setCd('revive', 2); return false; }
        if (bd > 3.5) { c.claim(0.4); c.go(best.x, best.z, 1.3); return true; }
        tgt = best; return c.start(mv, false);
      },
      detach() { lb = beam.free(lb); },
    };
  };
  // formation: followers keep a station around the player instead of bunching (row: front | mid | back)
  B.formation = (o = {}) => ({
    id: 'formation',
    think(c) {
      if (c.hasT || c.f.follow !== 'player' || !playerUp() || c.holdPos || c.fleeing) return false;
      let rank = 0, n = 0, total = 0;
      for (const x of S.ctrls) { if (x.dead || x.f.faction !== c.f.faction || !x.bs.some((b) => b.id === 'formation')) continue; total++; if (x.row === c.row) { if (x === c) rank = n; n++; } }
      const row = c.row, f = ctx.player.forward, l = Math.hypot(f.x, f.z) || 1, fx = f.x / l, fz = f.z / l, rx = fz, rz = -fx;
      const oz = row === 'front' ? 2.4 : row === 'back' ? -2.4 : 0, ox = (rank - (n - 1) / 2) * 1.7 + (row === 'mid' ? (rank % 2 ? 3 : -3) * 0.4 : 0);
      const x = head.x + fx * oz + rx * ox, z = head.z + fz * oz + rz * ox, p = c.a.position;
      if (Math.hypot(p.x - x, p.z - z) < 1.2) { c.claim(0.3); c.a.stop(); c.a.lookAt(null); return true; }
      c.claim(0.35); c.go(x, z, 1.1); return true;
    },
    attach(c) { c.row = o.row ?? 'mid'; },
  });
  // orders: f.order(kind, target) - 'follow' | 'hold' | 'attack' | 'guard' | 'retreat' | 'stop'. target: a fighter, a damageable, {x, z}, 'player', 'nearest', or nothing
  B.orders = () => {
    return {
      id: 'orders',
      attach(c) {
        const f = c.f;
        f.order = (kind, target) => {
          const k = String(kind || '').toLowerCase(); const p = c.a.position;
          if (k === 'follow' || k === 'come' || k === 'regroup') { f.follow = 'player'; f.leash = 28; c.holdPos = null; c.guarding = null; c.retreatUntil = 0; if (!target) f.setTarget(null); return true; }
          if (k === 'hold' || k === 'stay' || k === 'wait' || k === 'guard-position') {
            const x = target && target.x !== undefined ? target.x : p.x, z = target && target.z !== undefined ? target.z : p.z;
            f.follow = null; f.homeX = x; f.homeZ = z; f.leash = 9; c.holdPos = { x, z }; c.guarding = null; c.a.wander?.(0); f.setTarget(null); c.a.walkTo(x, z); return true;
          }
          if (k === 'attack' || k === 'kill' || k === 'target') {
            let e = null; const C = combat();
            if (target && target.damage && target.actor) e = target;
            else if (target && typeof target.center === 'function') e = target;
            else if (C) { const at = target && target.x !== undefined ? _a.set(target.x, target.y ?? ground(target.x, target.z), target.z) : head; e = C.nearest(at, { hostileTo: 'friendly', maxDist: target && target.x !== undefined ? 10 : 30 }); }
            if (!e) return false; f.setTarget(e); c.retreatUntil = 0; return true;
          }
          if (k === 'guard' || k === 'protect' || k === 'defend') { c.guarding = target || 'player'; if (!c.holdPos) f.follow = 'player'; if (!c.bs.some((b) => b.id === 'bodyguard')) c.add(B.bodyguard()); return true; }
          if (k === 'retreat' || k === 'fall-back' || k === 'flee' || k === 'back') { f.follow = 'player'; f.setTarget(null); c.holdPos = null; c.retreatUntil = c.t + 6; c.noAttack(6); return true; }
          if (k === 'stop' || k === 'cease' || k === 'idle') { f.setTarget(null); c.noAttack(5); return true; }
          return false;
        };
      },
      think(c) {
        if (c.retreatUntil > c.t) { c.claim(0.4); c.noAttack(0.5); c.go(head.x - ctx.player.forward.x * 2, head.z - ctx.player.forward.z * 2, 1.35); return true; }
        if (c.holdPos && !c.hasT) { const p = c.a.position; if (Math.hypot(p.x - c.holdPos.x, p.z - c.holdPos.z) > 1.5) { c.claim(0.4); c.go(c.holdPos.x, c.holdPos.z, 1); return true; } c.a.lookAt(null); }
        return false;
      },
    };
  };
  // order helper for handles / lists of fighters
  B.order = (who, kind, target) => {
    let n = 0; const list = !who ? [] : Array.isArray(who) ? who : who.fighters ? who.fighters : [who];
    for (const f of list) if (f && f.order && f.alive && f.order(kind, target)) n++;
    return n;
  };

  // ---- trail: leaves lingering patches (fire) where it walks
  B.trail = (o = {}) => { let acc = 0; return { id: 'trail', tick(c, dt) { if (c.a.speedNow < 0.5) return; acc += dt; if (acc < (o.every ?? 0.9)) return; acc = 0; const p = c.a.position; zones.add(c, { x: p.x, z: p.z, r: o.r ?? 1.1, ttl: o.ttl ?? 2.2, kind: o.kind ?? 'fire', dps: o.dps ?? 3 }); } }; };

  // ---- wrapDamage(c, fn(amount, kind, point, from, by) -> new amount): scale (or veto with 0) every blow the actor takes. Several wrappers stack.
  B.wrapDamage = (c, fn) => {
    const d = c.a.damage; if (!d) return;
    const orig = d.hit;
    d.hit = function (amount, point, from, by, kind, direction) {
      const k = kind && typeof kind === 'object' ? kind.kind : kind;
      const m = fn(amount, k, point, from, by, kind && typeof kind === 'object' ? kind.direction : direction);
      if (m <= 0) return false;
      return orig.call(d, amount * m, point, from, by, kind, direction);
    };
  };
  // last words: spoken (and shown) even though the actor is already dead
  B.lastWords = (a, text, secs = 3.5) => {
    if (!a || a.removed || !text) return;
    try { if (a.label) { a.label.set(text); a.label.show(true); B.after(secs, () => { if (!a.removed && a.label) a.label.show(false); }); } else if (a.kind !== 'custom') { a.say(text, secs); return; } } catch (e) { /* label gone */ }
    ctx.events.emit('actor:say', { actor: a, text: String(text), seconds: secs });
  };
  B.flare = (hex, k = 1) => { try { ctx.world.oracle?.flare?.(hex, k); } catch (e) { /* optional */ } };
  B.mood = (m) => { try { ctx.world.audio?.setMood?.(m); } catch (e) { /* optional */ } };

  // ================================================================== the boss health bar: ONE canvas quad above the head, billboarded, redrawn only when something changes
  B.bossBar = (c, o = {}) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1875), mat); mesh.renderOrder = 40; mesh.frustumCulled = false;
    mesh.userData.noShadow = mesh.userData.noOutline = mesh.userData.noCull = true; ctx.root.add(mesh);
    const bar = { mesh, last: '', name: o.name || c.name.toUpperCase(), phase: 1, phases: o.phases || 1, status: '', y: o.y ?? 3.5 };
    bar.draw = () => {
      const f = c.f, fr = clamp(f.hp / f.maxHp, 0, 1), key = bar.name + '|' + Math.round(fr * 96) + '|' + bar.phase + '|' + bar.status + '|' + (bar.shield ?? '');
      if (key === bar.last) return; bar.last = key;
      g.clearRect(0, 0, 512, 96);
      g.fillStyle = 'rgba(8,8,14,0.78)'; g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#e8e0d0'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(bar.name, 256, 24);
      g.fillStyle = '#2a0e10'; g.fillRect(16, 46, 480, 22);
      const col = fr > 0.5 ? '#d83a2a' : fr > 0.25 ? '#e0701a' : '#f0b020'; g.fillStyle = col; g.fillRect(16, 46, 480 * fr, 22);
      if (bar.shield) { g.fillStyle = '#58e6ff'; g.fillRect(16, 46, 480 * clamp(bar.shield, 0, 1), 6); }
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.strokeRect(16, 46, 480, 22);
      for (let i = 1; i < bar.phases; i++) { const x = 16 + 480 * (1 - i / bar.phases); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x - 1, 42, 2, 30); }
      if (bar.status) { g.fillStyle = '#ffd860'; g.font = '20px sans-serif'; g.fillText(bar.status, 256, 82); }
      tex.needsUpdate = true;
    };
    bar.update = () => {
      const a = c.a, p = a.position, d = Math.hypot(p.x - head.x, p.z - head.z);
      mesh.position.set(p.x, p.y + (typeof bar.y === 'function' ? bar.y() : bar.y), p.z); mesh.quaternion.copy(ctx.camera.quaternion);
      const s = clamp(d * 0.11, 1.6, 7); mesh.scale.set(s, s, 1);
      bar.draw();
    };
    bar.remove = () => { mesh.removeFromParent(); mat.map.dispose(); mat.dispose(); mesh.geometry.dispose(); };
    bar.update();
    return bar;
  };

  // ================================================================== world.encounters: the service the voice / NPC-intent system and the Omnissiah can use
  B.api = {
    version: 1, behaviors: B,
    order: (who, kind, target) => B.order(who, kind, target),             // order(fighter | handle | [fighters], 'hold' | 'follow' | 'attack' | 'guard' | 'retreat' | 'stop', target?)
    controllerOf: (f) => B.of(f),
    controllers: () => S.ctrls,
    stats: () => ({ controllers: S.ctrls.length, telegraphs: tele.active(), zones: zones.pool.filter((z) => z.on).length, lobs: lob.pool.filter((l) => l.on).length, beams: beam.pool.filter((b) => b.on).length, packs: S.packs.size, fallen: S.fallen.length }),
    bosses: () => S.ctrls.filter((c) => c.boss && !c.dead),
  };
  try { ctx.provide('encounters', B.api); } catch (e) { /* optional */ }
  B.tele.free = tele.free;
  return B;
}
