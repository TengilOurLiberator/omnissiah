// mr/hands.js — the GOD-HANDS: bare hands, controllers and the desktop mouse ray, all reduced to one hand model, and the verbs on the diorama.
//   grab (fist / middle pinch / grip, or an index pinch next to a creature) pick up, carry, throw  |  flick: a fast fingertip knocks things
//   pinch / grip on empty ground and pull up: quake  |  point + pinch (trigger): cast the current spell from the fingertip into the table
//   palm down, open, above the table: heal + shield aura  |  both hands gripping empty air: stretch / rotate / move the whole table
//   grip the rim: drag the table (and its height)  |  'point' with the fingertip low over the ground: draw a path allies follow
//   touch a creature with a slow fingertip: it speaks  |  hold the talk gesture (left pinch / trigger) while pointing at one: talk to it
// Positions: "room" = the real room (input.*), "game" = the miniature's own metres (env.toGame). Reaches are given in REAL metres.
export default function (env) {
  const { THREE, ctx, S, T, roomGroup, world, input } = env;
  const stageGroup = env.stage;
  // effects live in the stage PART (parts.stage); this thin facade keeps call sites short and survives that part reloading
  const fxp = () => env.parts.stage;
  const stage = {
    add: (o) => stageGroup.add(o), remove: (o) => stageGroup.remove(o),
    ripple: (...a) => { const p = fxp(); p && p.ripple(...a); }, setTrail: (a) => { const p = fxp(); p && p.setTrail(a); }, setBump: (...a) => { const p = fxp(); p && p.setBump(...a); },
    setSelect: (...a) => { const p = fxp(); p && p.setSelect(...a); }, setAura: (...a) => { const p = fxp(); p && p.setAura(...a); }, setGhost: (...a) => { const p = fxp(); p && p.setGhost(...a); },
    setHover: (...a) => { const p = fxp(); p && p.setHover(...a); }, setRimHot: (a) => { const p = fxp(); p && p.setRimHot(a); }, setTalk: (a) => { const p = fxp(); p && p.setTalk(a); },
  };
  const { Vector3, Quaternion } = THREE;
  const clamp = THREE.MathUtils.clamp;
  const Z = new Vector3(0, 0, -1);
  const gm = (m) => m / Math.max(env.sShow, 0.006);                 // real metres -> game metres
  const kit = () => world.kit;
  const P = () => env.parts;

  const mk = (name) => ({
    name, valid: false, kind: 'none', stamp: -1,
    tip: new Vector3(), prevTip: new Vector3(), dir: new Vector3(0, 0, -1), palm: new Vector3(), palmN: new Vector3(0, -1, 0), ref: new Vector3(), prevRef: new Vector3(),
    quat: new Quaternion(), tipG: new Vector3(), dirG: new Vector3(0, -0.6, -0.8), vel: new Vector3(), speed: 0,
    trig: false, trigP: false, trigR: false, grab: false, grabP: false, grabR: false, b: false, a: false, point: false, open: false, fist: false, pinch: 0,
    gripSrc: null, mode: 'idle', trigMode: 'none', carry: null, quake: null, rim: null, drawing: null, hist: false, freeGrip: false,
    _t: false, _g: false, aboveSurf: 9, onTable: null,
  });
  const H = { left: mk('left'), right: mk('right') };
  const ov = { left: null, right: null };               // scripted hands (tests, the desktop simulation)
  let clockStamp = -1;

  // ------------------------------------------------------------------ sampling
  const _p = new Vector3(), _q = new Quaternion(), _d = new Vector3();
  function ensure(h) {
    const t = ctx.clock.t;
    if (h.stamp === t && t !== 0) return h;
    h.stamp = t;
    const dt = Math.max(ctx.clock.dt || 0.016, 0.004);
    h.prevTip.copy(h.tip); h.prevRef.copy(h.ref);
    const o = ov[h.name], inp = input[h.name];
    h._t = h.trig; h._g = h.grab;
    h.point = h.open = h.fist = false; h.b = h.a = false; h.pinch = 0;
    if (o) {
      h.valid = true; h.kind = 'script';
      h.tip.set(o.tip.x, o.tip.y, o.tip.z);
      if (o.dir) h.dir.set(o.dir.x, o.dir.y, o.dir.z).normalize(); else h.dir.set(0, -0.55, -0.83).normalize();
      if (o.palm) h.palm.set(o.palm.x, o.palm.y, o.palm.z); else h.palm.copy(h.tip).addScaledVector(h.dir, -0.07);
      if (o.palmN) h.palmN.set(o.palmN.x, o.palmN.y, o.palmN.z).normalize(); else h.palmN.set(0, -1, 0);
      h.trig = !!o.trig; h.grab = !!o.grab; h.point = !!o.point; h.open = !!o.open; h.fist = !!o.fist; h.b = !!o.b; h.pinch = o.pinch ?? (h.trig ? 1 : 0);
      h.quat.setFromUnitVectors(Z, h.dir);
    } else if (inp && inp.connected) {
      h.valid = true;
      if (inp.tracked && inp.fingers) {
        const F = inp.fingers;
        h.kind = 'hand';
        h.tip.copy(F.index); h.dir.copy(inp.direction); h.palm.copy(F.palm); h.palmN.copy(F.palmNormal); h.quat.copy(inp.quaternion);
        h.pinch = F.pinch.index;
        h.trig = !!inp.down.trigger; h.grab = !!inp.down.squeeze; h.a = !!inp.down.a; h.b = !!inp.down.b;
        h.point = F.gesture === 'point'; h.open = F.gesture === 'open'; h.fist = F.gesture === 'fist';
      } else {
        h.kind = inp._gamepad ? 'controller' : 'mouse';
        h.quat.copy(inp.quaternion); h.dir.copy(inp.direction);
        if (h.kind === 'mouse') { h.palm.copy(ctx.player.head); h.tip.copy(ctx.player.head).addScaledVector(h.dir, 0.6); }
        else { h.palm.copy(inp.position); h.tip.copy(inp.position).addScaledVector(h.dir, 0.09); }
        h.palmN.set(0, 1, 0).applyQuaternion(inp.quaternion);
        h.trig = !!inp.down.trigger; h.grab = !!inp.down.squeeze; h.a = !!inp.down.a; h.b = !!inp.down.b;
        h.pinch = h.trig ? 1 : 0;
      }
    } else { h.valid = false; h.trig = h.grab = false; }
    h.trigP = h.trig && !h._t; h.trigR = !h.trig && h._t; h.grabP = h.grab && !h._g; h.grabR = !h.grab && h._g;
    if (!h.valid) return h;
    // the device's own pointing ray hits the table: pointer devices act at that spot (a hovering fingertip), hands act where the fingertip is
    if (h.kind === 'mouse' || h.kind === 'controller') {
      const hit = env.rayToTable(h.kind === 'mouse' ? ctx.player.head : h.palm, h.dir, _p, 1.0);
      if (hit && h.kind === 'mouse') { env.toRoom(hit, h.tip); h.tip.y += 0.045; }
    }
    h.ref.copy(h.gripSrc === 'trigger' || h.kind !== 'hand' || !h.fist ? h.tip : h.palm);
    if (h.mode !== 'idle' && h.gripSrc === 'squeeze' && h.kind === 'hand') h.ref.copy(h.palm);
    if (h.hist) {
      _d.copy(h.ref).sub(h.prevRef).divideScalar(dt);
      if (_d.lengthSq() < 900) h.vel.lerp(_d, Math.min(1, dt * 16));
    } else { h.vel.set(0, 0, 0); h.hist = true; }
    h.speed = h.vel.length();
    env.toGame(h.tip, h.tipG); env.dirToGame(h.dir, h.dirG);
    h.aboveSurf = (h.tip.y - T.y);
    return h;
  }

  // ------------------------------------------------------------------ pickables (actors and loose bodies, in game space)
  const REC = { kind: '', obj: null, d: 1e9, c: new Vector3(), r: 0.5, h: 1 };
  const isGrabbableActor = (a) => a && !a.dead && !a.removed && a.group && a.group.visible !== false && !a.noGrab && !(a.rag || a.ragdoll);
  function nearest(pg, reach, filter) { // nearest pickable whose SURFACE is within `reach` game-m of point pg
    REC.obj = null; REC.d = reach;
    const K = kit();
    if (K && K.actors) {
      const A = K.actors;
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        if (!isGrabbableActor(a)) continue;
        if (filter && !filter('actor', a)) continue;
        const p = a.group.position, h = a.height ?? 1.2, r = Math.max(0.3, h * 0.26);
        const cy = clamp(pg.y, p.y + 0.1, p.y + h * 0.9);
        const d = Math.hypot(pg.x - p.x, pg.y - cy, pg.z - p.z) - r;
        if (d < REC.d) { REC.d = d; REC.kind = 'actor'; REC.obj = a; REC.r = r; REC.h = h; REC.c.set(p.x, p.y + h * 0.5, p.z); }
      }
    }
    const sp = world.spells;
    if (sp && sp.bodies) {
      const B = sp.bodies();
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (!b || b.removed || b.held || !(b.invMass > 0) || b.mesh.visible === false) continue;
        if (filter && !filter('body', b)) continue;
        const d = b.position.distanceTo(pg) - b.radius;
        if (d < REC.d) { REC.d = d; REC.kind = 'body'; REC.obj = b; REC.r = b.radius; REC.h = b.radius * 2; REC.c.copy(b.position); }
      }
    }
    return REC.obj ? REC : null;
  }
  const _o = new Vector3(), _w = new Vector3();
  function nearestOnRay(og, dg, maxLen, tol, filter) { // pointer devices: the pickable closest to the ray (perpendicular), scaled by its size
    REC.obj = null; let best = 1e9;
    const consider = (kind, obj, c, r, h) => {
      _w.copy(c).sub(og);
      const along = _w.dot(dg);
      if (along < 0 || along > maxLen) return;
      const perp = Math.sqrt(Math.max(0, _w.lengthSq() - along * along)) - r;
      if (perp > tol) return;
      const score = Math.max(0, perp) + along * 0.002;
      if (score < best) { best = score; REC.kind = kind; REC.obj = obj; REC.c.copy(c); REC.r = r; REC.h = h; REC.d = perp; }
    };
    const K = kit();
    if (K && K.actors) for (let i = 0; i < K.actors.length; i++) {
      const a = K.actors[i];
      if (!isGrabbableActor(a) || (filter && !filter('actor', a))) continue;
      const p = a.group.position, h = a.height ?? 1.2;
      _o.set(p.x, p.y + h * 0.5, p.z);
      consider('actor', a, _o, Math.max(0.3, h * 0.3), h);
    }
    const sp = world.spells;
    if (sp && sp.bodies) { const B = sp.bodies(); for (let i = 0; i < B.length; i++) { const b = B[i]; if (!b || b.removed || b.held || !(b.invMass > 0) || (filter && !filter('body', b))) continue; consider('body', b, b.position, b.radius, b.radius * 2); } }
    return REC.obj ? REC : null;
  }
  const candidateFor = (h, src) => { // what would this hand pick up right now?
    if (h.kind === 'hand' || h.kind === 'script') {
      const pg = src === 'squeeze' ? env.toGame(h.palm, _w) : h.tipG;
      return nearest(pg, gm(src === 'squeeze' ? 0.11 : 0.065));
    }
    return nearestOnRay(h.kind === 'mouse' ? env.toGame(ctx.player.head, _o) : env.toGame(h.palm, _o), h.dirG, gm(2.2), Math.max(gm(0.04), 0.6));
  };

  // ------------------------------------------------------------------ haptics, sound
  function buzz(h, s = 0.3, ms = 30) { const K = kit(); try { if (K && K.haptic) K.haptic(h.name, s, ms); else input[h.name] && input[h.name].pulse && input[h.name].pulse(s, ms); } catch (e) { /* none */ } }
  function sfx(name, at, vol = 0.5) { try { world.audio && world.audio.sfx && world.audio.sfx(name, { at, volume: vol }); } catch (e) { /* none */ } }

  // ------------------------------------------------------------------ carrying
  const flying = [];
  const _g = new Vector3(), _v = new Vector3();
  function startCarry(h, rec, src) {
    const obj = rec.obj;
    const c = env.toRoom(rec.c, _g);
    const rel = new Vector3().copy(c).sub(h.ref).applyQuaternion(_q.copy(h.quat).invert());
    h.carry = { kind: rec.kind, obj, rel, h: rec.h, r: rec.r, t: 0, wasPh: false };
    h.mode = 'carry'; h.gripSrc = src;
    if (rec.kind === 'actor') {
      const fl = flying.findIndex((f) => f.a === obj); if (fl >= 0) flying.splice(fl, 1);
      if (obj.group.userData.mrHome === undefined) obj.group.userData.mrHome = true;
      try { obj.stop && obj.stop(); } catch (e) { /* ignore */ }
    } else { obj.held = h.name; obj.velocity.set(0, 0, 0); }
    buzz(h, 0.3, 30); sfx('pickup', rec.c, 0.4);
    ctx.events.emit('mr:pickup', { kind: rec.kind, obj, hand: h.name });
  }
  function carryTarget(h, out) { // game-space centre of the carried thing
    const c = h.carry;
    _v.copy(c.rel).applyQuaternion(h.quat).add(h.ref);
    return env.toGame(_v, out);
  }
  const groundAt = (x, z) => (world.mr && world.mr.groundHeight ? world.mr.groundHeight(x, z) : 0);
  function updateCarry(h, dt, t) {
    const c = h.carry, o = c.obj;
    if ((c.kind === 'actor' && (o.dead || o.removed || o.rag)) || (c.kind === 'body' && o.removed)) { h.carry = null; h.mode = 'idle'; return; }
    carryTarget(h, _g);
    c.t += dt;
    c.rel.multiplyScalar(c.t < 0.5 ? 0.97 : 0.995);          // drift into the palm a little: a held thing sits in the hand, not on the arm
    if (c.kind === 'actor') {
      const p = o.group.position;
      p.set(_g.x, _g.y - c.h * 0.5, _g.z);
      if (o.ch && o.ch.teleport) { try { o.ch.teleport(p.x, p.y, p.z); } catch (e) { /* none */ } }
      o.staggerT = Math.max(o.staggerT || 0, 0.35); o.kx = o.kz = 0; o.speedNow = 0;
      o.group.rotation.z = Math.sin(t * 9 + c.h) * 0.14;
    } else {
      o.position.copy(_g);
      if (!o.ph) o.mesh.position.copy(o.position);
      o.velocity.set(0, 0, 0);
    }
    stage.setSelect(_o.set(_g.x, 0, _g.z), Math.max(0.8, c.r * 1.3));
  }
  const vThrow = new Vector3();
  function releaseCarry(h, throwIt) {
    const c = h.carry; h.carry = null; h.mode = 'idle'; h.gripSrc = null;
    stage.setSelect(null);
    if (!c) return;
    const o = c.obj;
    vThrow.set(0, 0, 0);
    if (throwIt && h.speed > 0.25) {
      env.dirToGame(h.vel, vThrow).multiplyScalar(0.55 / Math.max(env.sShow, 0.01) * 0.9);
      const sp = vThrow.length();
      if (sp > 22) vThrow.multiplyScalar(22 / sp);
    }
    if (c.kind === 'actor') {
      o.group.rotation.z = 0;
      const p = o.group.position;
      flying.push({ a: o, v: vThrow.clone(), t: 0, hand: h.name, power: vThrow.length() });
      ctx.events.emit('mr:throw', { actor: o, speed: vThrow.length() });
      void p;
    } else {
      o.held = null; o.velocity.copy(vThrow);
      if (o.ph) { try { o.ph.wake && o.ph.wake(); } catch (e) { /* none */ } }
      ctx.events.emit('mr:throw', { body: o, speed: vThrow.length() });
    }
    buzz(h, 0.25, 25); sfx('weapon-drop', o.group ? o.group.position : o.position, 0.3);
  }
  function stepFlying(dt) {
    const K = kit();
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], a = f.a;
      if (!a || a.dead || a.removed || a.rag) { flying.splice(i, 1); continue; }
      const p = a.group.position;
      f.t += dt;
      f.v.y -= 9.8 * dt;
      p.x += f.v.x * dt; p.y += f.v.y * dt; p.z += f.v.z * dt;
      a.staggerT = Math.max(a.staggerT || 0, 0.3); a.kx = a.kz = 0;
      if (a.ch && a.ch.teleport) { try { a.ch.teleport(p.x, p.y, p.z); } catch (e) { /* none */ } }
      a.group.rotation.z = 0;
      const gy = groundAt(p.x, p.z);
      if (p.y <= gy && f.v.y < 0 || f.t > 6) {
        const speed = Math.hypot(f.v.x, f.v.y, f.v.z);
        if (p.y <= gy) {
          p.y = gy;
          const onTable = Math.hypot(p.x, p.z) <= env.radius;
          const dmg = clamp((speed - 6) * 1.3, 0, 18);
          if (dmg > 1 && a.damage && onTable && a.faction !== 'friendly') {
            try { a.damage.hit(dmg, _o.set(p.x, p.y + 0.3, p.z), 'player', null, 'blunt', _w.copy(f.v).normalize()); } catch (e) { /* ignore */ }
          }
          if (speed > 5 && onTable) { stage.ripple(p, clamp(speed * 0.18, 1.2, 4)); if (K && K.debris) { try { K.debris(_o.set(p.x, p.y, p.z), { material: 'earth', count: 4, power: 1.5 }); } catch (e) { /* ignore */ } } }
          a.kx = f.v.x * 0.25; a.kz = f.v.z * 0.25; a.staggerT = Math.max(a.staggerT || 0, 0.7);
        }
        flying.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ quake: pinch / grip the ground, pull up, let go
  function startQuake(h, src) {
    const pg = (h.kind === 'hand' || h.kind === 'script') ? h.tipG : (env.rayToTable(h.kind === 'mouse' ? ctx.player.head : h.palm, h.dir, new Vector3(), 1.0) || h.tipG);
    h.quake = { x: pg.x, z: pg.z, y0: h.ref.y, pull: 0, t: 0 };
    h.mode = 'quake'; h.gripSrc = src;
    buzz(h, 0.2, 40);
  }
  function updateQuake(h, dt) {
    const q = h.quake; q.t += dt;
    const lift = Math.max(0, h.ref.y - q.y0);
    q.pull = Math.max(q.pull * 0.995, h.kind === 'hand' || h.kind === 'script' ? lift : Math.max(lift, Math.min(0.16, q.t * 0.1)));
    stage.setBump(_o.set(q.x, 0, q.z), gm(Math.min(q.pull, 0.2)) * 0.5, 1.6 + gm(q.pull) * 0.1);
    if (((q.t * 16) | 0) % 2 === 0) buzz(h, Math.min(0.5, 0.1 + q.pull * 3), 20);
  }
  function endQuake(h, fire) {
    const q = h.quake; h.quake = null; h.mode = 'idle'; h.gripSrc = null;
    stage.setBump(null);
    if (!q || !fire || q.pull < 0.03) return;
    const k = clamp(q.pull / 0.13, 0.25, 1), radius = 2.2 + 6.5 * k, dmg = 8 + 26 * k, point = _o.set(q.x, 0.2, q.z);
    const K = kit();
    try {
      if (K && K.hit) K.hit(point, radius, dmg, { from: 'player', kind: 'blunt', force: 10 + 16 * k, hand: h.name });
      if (K && K.crater) K.crater(point, radius * 0.35);
      if (K && K.debris) K.debris(point, { material: 'earth', count: Math.round(10 + 14 * k), power: 4 + 3 * k });
      if (world.physics && world.physics.explode) world.physics.explode(point, radius, 14 + 22 * k);
    } catch (err) { console.error('[mr] quake failed', err); }
    stage.ripple(point, radius * 1.1, 0xc9a273, 1.0); stage.ripple(point, radius * 0.6, 0xffffff, 0.7);
    buzz(h, 0.9, 120); sfx('ground-slam', point, 0.8);
    ctx.events.emit('mr:quake', { x: q.x, z: q.z, radius, strength: k });
    const M = P().modes; M && M.event && M.event('quake', { k });
  }

  // ------------------------------------------------------------------ rim drag and two-hand stretch
  function nearRim(h, src) { // is the grab point on the rim ring of the table (in the plane of the top)?
    const pr = src === 'squeeze' ? h.palm : h.tip;
    env.toGame(pr, _w);
    const rr = Math.hypot(_w.x, _w.z), R = env.radius;
    return Math.abs(rr - R) < gm(0.07) && Math.abs(_w.y) < gm(0.12);
  }
  function startRim(h) {
    h.rim = { hx: h.ref.x, hy: h.ref.y, hz: h.ref.z, x: T.x, y: T.y, z: T.z };
    h.mode = 'rim'; S.userMoved = true; buzz(h, 0.3, 30);
  }
  function updateRim(h) {
    const r = h.rim, head = ctx.player.head;
    let nx = r.x + (h.ref.x - r.hx), nz = r.z + (h.ref.z - r.hz), ny = clamp(r.y + (h.ref.y - r.hy), 0.35, 1.25);
    const dx = nx - head.x, dz = nz - head.z, dd = Math.hypot(dx, dz);
    if (dd > 2.3) { nx = head.x + dx / dd * 2.3; nz = head.z + dz / dd * 2.3; }
    if (dd < 0.55) { nx = head.x + dx / (dd || 1) * 0.55; nz = head.z + dz / (dd || 1) * 0.55; }
    T.x = nx; T.z = nz; T.y = ny; S.tableH = ny; S.onSurface = false;
  }
  let stretch = null;
  function startStretch() {
    const a = H.left, b = H.right;
    _g.copy(a.ref).add(b.ref).multiplyScalar(0.5);
    stretch = { d0: Math.max(0.12, a.ref.distanceTo(b.ref)), a0: Math.atan2(b.ref.x - a.ref.x, b.ref.z - a.ref.z), mid0: _g.clone(), T0: { x: T.x, y: T.y, z: T.z, yaw: T.yaw, s: T.s } };
    a.mode = b.mode = 'stretch'; S.userMoved = true; buzz(a, 0.3, 30); buzz(b, 0.3, 30);
  }
  function updateStretch() {
    const a = H.left, b = H.right, s0 = stretch;
    const d = Math.max(0.1, a.ref.distanceTo(b.ref)), ang = Math.atan2(b.ref.x - a.ref.x, b.ref.z - a.ref.z);
    _g.copy(a.ref).add(b.ref).multiplyScalar(0.5);
    const k = clamp(s0.T0.s * (d / s0.d0), 0.025, 0.1) / s0.T0.s;
    const dyaw = ang - s0.a0;
    // similarity transform about the midpoint of the hands
    const rx = s0.T0.x - s0.mid0.x, rz = s0.T0.z - s0.mid0.z, c = Math.cos(dyaw), sn = Math.sin(dyaw);
    T.x = _g.x + (rx * c + rz * sn) * k;
    T.z = _g.z + (-rx * sn + rz * c) * k;
    T.y = clamp(s0.T0.y + (_g.y - s0.mid0.y), 0.35, 1.25) ; S.tableH = T.y;
    T.yaw = s0.T0.yaw + dyaw;
    T.s = s0.T0.s * k; S.sBase = T.s; S.onSurface = false;
    const head = ctx.player.head, dx = T.x - head.x, dz = T.z - head.z, dd = Math.hypot(dx, dz);
    if (dd > 2.4) { T.x = head.x + dx / dd * 2.4; T.z = head.z + dz / dd * 2.4; }
    if (dd < 0.5) { T.x = head.x + dx / (dd || 1) * 0.5; T.z = head.z + dz / (dd || 1) * 0.5; }
  }
  let resetHold = 0;

  // ------------------------------------------------------------------ flick, aura, draw, poke
  const FLICK_CD = new WeakMap();
  function flick(h, dt, t) {
    if (h.speed < 1.5 || h.mode !== 'idle') return;
    const rec = nearest(h.tipG, gm(0.04));
    if (!rec || rec.kind === 'body' && false) return;
    const o = rec.obj, last = FLICK_CD.get(o) ?? -9;
    if (t - last < 0.45) return;
    FLICK_CD.set(o, t);
    const K = kit(), dirG = env.dirToGame(h.vel, _w).normalize();
    const power = clamp(h.speed, 1.5, 6);
    try {
      if (rec.kind === 'actor' && K && K.hit) K.hit(_o.copy(rec.c).addScaledVector(dirG, -rec.r * 0.5), rec.r + 0.35, 3 + power * 2, { from: 'player', kind: 'blunt', direction: dirG.clone(), force: 5 + power * 4, hand: h.name });
      else if (rec.kind === 'body') { rec.obj.velocity.addScaledVector(dirG, power * 3.2); rec.obj.velocity.y += 1.5; if (rec.obj.ph && rec.obj.ph.wake) rec.obj.ph.wake(); }
      if (rec.kind === 'actor') { o.kx = (o.kx || 0) + dirG.x * power * 2.6; o.kz = (o.kz || 0) + dirG.z * power * 2.6; }
    } catch (err) { console.error('[mr] flick failed', err); }
    stage.ripple(_o.set(rec.c.x, 0, rec.c.z), 1.6, 0xffffff, 0.45);
    buzz(h, 0.5, 40); sfx('hit-generic', rec.c, 0.5);
    ctx.events.emit('mr:flick', { kind: rec.kind, obj: o, power });
    const M = P().modes; M && M.event && M.event('flick', {});
  }
  let auraOn = false;
  const auraCtr = new Vector3();
  function aura(dt) {
    let hand = null;
    for (const n of ['left', 'right']) {
      const h = H[n];
      if (!h.valid || h.mode !== 'idle') continue;
      const down = h.kind === 'hand' || h.kind === 'script' ? (h.open && h.palmN.y < -0.5) : (n === 'left' && h.a);
      if (!down) continue;
      const base = (h.kind === 'hand' || h.kind === 'script') ? h.palm : h.tip;
      const above = base.y - T.y;
      if (above < 0.03 || above > 0.55) continue;
      env.toGame(base, auraCtr);
      if (Math.hypot(auraCtr.x, auraCtr.z) > env.radius + 1) continue;
      hand = h; break;
    }
    if (!hand) { if (auraOn) { stage.setAura(null); auraOn = false; } return; }
    auraOn = true;
    const above = (hand.kind === 'hand' || hand.kind === 'script' ? hand.palm : hand.tip).y - T.y;
    const r = clamp(2.2 + gm(above) * 0.28, 2.5, 7.5);
    auraCtr.y = 0;
    stage.setAura(auraCtr, r);
    const C = world.combat;
    if (C && C.fighters) {
      for (let i = 0; i < C.fighters.length; i++) {
        const f = C.fighters[i];
        if (!f.alive || f.faction === 'enemy') continue;
        const p = f.actor.position;
        if (Math.hypot(p.x - auraCtr.x, p.z - auraCtr.z) < r) f.heal(7 * dt);
      }
      if (C.projectiles) for (let i = 0; i < C.projectiles.length; i++) {
        const p = C.projectiles[i];
        if (!p.on || p.from === 'friendly' || p.from === 'player') continue;
        if (Math.hypot(p.x - auraCtr.x, p.z - auraCtr.z) < r && p.y < r) { p.kill(); stage.ripple(_o.set(p.x, 0, p.z), 1.2, 0x7affc0, 0.4); }
      }
    }
    if (((ctx.clock.t * 10) | 0) % 5 === 0) buzz(hand, 0.08, 15);
  }
  function drawUpdate(h, dt) {
    const hand = h.kind === 'hand' || h.kind === 'script';
    const want = hand ? (h.point && h.aboveSurf < 0.075 && h.aboveSurf > -0.02 && !h.trig) : (h.b && !!env.rayToTable(h.kind === 'mouse' ? ctx.player.head : h.palm, h.dir, _o, 1.0));
    const g = hand ? h.tipG : env.rayToTable(h.kind === 'mouse' ? ctx.player.head : h.palm, h.dir, _o, 1.0);
    if (want && g && Math.hypot(g.x, g.z) <= env.radius) {
      if (!h.drawing) { h.drawing = { pts: [] }; h.mode = h.mode === 'idle' ? 'draw' : h.mode; }
      const pts = h.drawing.pts, last = pts[pts.length - 1];
      if (!last || Math.hypot(g.x - last.x, g.z - last.z) > 0.7) { if (pts.length < 150) pts.push({ x: g.x, z: g.z }); buzz(h, 0.06, 10); }
      stage.setTrail(pts);
    } else if (h.drawing) {
      const pts = h.drawing.pts; h.drawing = null; if (h.mode === 'draw') h.mode = 'idle';
      stage.setTrail(null);
      if (pts.length >= 3) commandAllies(pts);
    }
  }
  function commandAllies(pts) {
    const C = world.combat, K = kit();
    let n = 0;
    const first = pts[0];
    const list = [];
    if (C && C.fighters) for (const f of C.fighters) if (f.alive && f.faction === 'friendly' && f.actor.position && Math.hypot(f.actor.position.x - first.x, f.actor.position.z - first.z) < 7) list.push(f);
    if (K && K.actors) for (const a of K.actors) { if (a.dead || a.removed || a.faction !== 'friendly' || (a.damage && a.damage.fighter) || !a.walkTo) continue; if (Math.hypot(a.group.position.x - first.x, a.group.position.z - first.z) < 7) list.push({ plain: true, actor: a }); }
    for (const f of list.slice(0, 12)) {
      march(f, pts, n++);
    }
    ctx.events.emit('mr:path', { points: pts.length, units: n });
    stage.ripple(_o.set(pts[pts.length - 1].x, 0, pts[pts.length - 1].z), 2.2, 0xffe08a, 1.0);
    const M = P().modes; M && M.event && M.event('path', { units: n });
    if (n && world.hud) world.hud.show(`${n} follow your path`, 1.6);
  }
  const marchers = [];
  function march(f, pts, i) {
    const old = marchers.findIndex((m) => m.f === f); if (old >= 0) marchers.splice(old, 1);
    const off = (i % 3 - 1) * 0.8;
    marchers.push({ f, pts: pts.map((p) => ({ x: p.x + off * 0.6, z: p.z + off * 0.4 })), k: 0, plain: !!f.plain, t: 0 });
    if (!f.plain) { f.follow = null; f.leash = 80; f.returning = true; f.homeX = pts[0].x; f.homeZ = pts[0].z; }
  }
  function stepMarchers(dt) {
    for (let i = marchers.length - 1; i >= 0; i--) {
      const m = marchers[i], a = m.f.actor;
      if (!a || a.removed || a.dead || (!m.plain && !m.f.alive)) { marchers.splice(i, 1); continue; }
      m.t += dt;
      const p = a.position ?? a.group.position, w = m.pts[m.k];
      if (!w) { marchers.splice(i, 1); continue; }
      if (Math.hypot(p.x - w.x, p.z - w.z) < 1.4) { m.k++; if (m.k >= m.pts.length) { marchers.splice(i, 1); continue; } }
      const nw = m.pts[m.k];
      if (m.plain) { if (!a.hasGoal || m.t > 1.5) { a.walkTo(nw.x, nw.z); m.t = 0; } }
      else { m.f.homeX = nw.x; m.f.homeZ = nw.z; if (!m.f.tgt) m.f.returning = true; }
    }
  }
  const LINES = {
    default: ['Hello, giant!', 'Mind the sky, it has a face.', 'Did the ceiling just speak?', 'Be gentle with us, big one.', 'A hand! A huge hand!'],
    knight: ['At your command, towering one.', 'My sword is yours, mighty giant.'], villager: ['Oh! A visitor from above!', 'The harvest is good this year.', 'Please do not step on the fields!'],
    goblin: ['Hee hee! Big hand!', 'Do not poke the goblin!'], merchant: ['Fine wares, giant sir!'], child: ['You are SO big!', 'Can you lift me up?'],
    mage: ['The stars favour you, great one.'], archer: ['I have you in my sights... friend.'], guard: ['Halt! Oh, it is only you.'], wizard: ['A giant! I knew it.'], king: ['Bow to the giant! Or... do not.'],
  };
  const pokeCD = new WeakMap();
  function poke(h, t) {
    if (h.mode !== 'idle' || h.speed > 0.9) return;
    if (!(h.kind === 'hand' ? h.point : h.kind === 'script' ? h.point : h.b === false && h.kind === 'controller' && false)) return;
    const rec = nearest(h.tipG, gm(0.025), (k, a) => k === 'actor' && a.say && a.kind !== 'creature');
    if (!rec) return;
    const a = rec.obj;
    if (t - (pokeCD.get(a) ?? -9) < 3.5) return;
    pokeCD.set(a, t);
    const role = String(a.role || a.name || '').toLowerCase();
    const key = Object.keys(LINES).find((k) => k !== 'default' && role.includes(k));
    const set = LINES[key] ?? LINES.default;
    try { a.say(set[(Math.random() * set.length) | 0], 3.6); a.faceTo && a.faceTo({ x: ctx.player.head.x, z: ctx.player.head.z }, 1.5); a.wave && a.wave(1.2); } catch (e) { /* ignore */ }
    buzz(h, 0.35, 30);
    ctx.events.emit('mr:poke', { actor: a });
  }

  // ------------------------------------------------------------------ armed summons (the palette arms; a pinch over the table drops)
  let armed = null;
  const armHit = new Vector3();
  function armUpdate(h) {
    if (!armed) { stage.setGhost(null); return; }
    const o = h.kind === 'mouse' ? ctx.player.head : (h.kind === 'hand' || h.kind === 'script') ? h.tip : h.palm;
    const hit = env.rayToTable(o, h.dir, armHit, 1.0);
    stage.setGhost(hit, armed.color ?? 0xffffff, armed.radius ?? 1.4);
    if (hit && h.trigP) {
      const ok = armed.place(armHit.clone());
      if (ok !== false) {
        stage.ripple(armHit, 2.2, armed.color ?? 0xffffff, 0.7); buzz(h, 0.5, 40); sfx('summon', armHit, 0.5);
        if (!armed.keep) armed = null;
      }
    }
  }

  // ------------------------------------------------------------------ the verbs, per frame
  const tipDots = {};
  const dotG = new THREE.RingGeometry(0.0, 0.45, 20).rotateX(-Math.PI / 2);
  const dotM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, fog: false });
  for (const n of ['left', 'right']) { const m = new THREE.Mesh(dotG, dotM.clone()); m.userData.noShadow = m.userData.noOutline = true; m.visible = false; m.renderOrder = 6; stage.add(m); tipDots[n] = m; }
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
  const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
  rayLine.frustumCulled = false; rayLine.visible = false; rayLine.userData.noShadow = true; rayLine.renderOrder = 8; roomGroup.add(rayLine);

  function gripRise(h) { // which grip started this frame, and from what? ('squeeze' = fist / middle pinch / grip, 'trigger' = index pinch next to something)
    if (h.grabP) return 'squeeze';
    if (h.trigP && h.name === 'right' && (h.kind === 'hand' || h.kind === 'script')) {
      const pal = P().palette;
      if (pal && pal.capturing) return null;
      return 'trigger';
    }
    return null;
  }
  function stepHand(h, dt, t) {
    ensure(h);
    if (!h.valid) { if (h.mode !== 'idle') releaseAll(h); tipDots[h.name].visible = false; return; }
    const pal = P().palette, capturing = !!(pal && pal.capturing === h.name);
    // trigger classification (also asked by the spell gate before this runs, memoised on the frame stamp)
    if (h.trigP) h.trigMode = trigClassify(h);
    if (!h.trig) h.trigMode = 'none';
    const hand = h.kind === 'hand' || h.kind === 'script';

    // -- ending modes
    if (h.mode === 'carry') {
      const keep = h.gripSrc === 'trigger' ? h.trig : h.grab;
      if (!keep) releaseCarry(h, true); else updateCarry(h, dt, t);
    } else if (h.mode === 'quake') {
      const keep = h.gripSrc === 'trigger' ? h.trig : h.grab;
      if (!keep) endQuake(h, true); else updateQuake(h, dt);
    } else if (h.mode === 'rim') { if (!h.grab && !h.trig) { h.rim = null; h.mode = 'idle'; } else updateRim(h); }
    else if (h.mode === 'stretch') {
      const o = H[h.name === 'left' ? 'right' : 'left'];
      if ((!h.grab && !h.trig) || o.mode !== 'stretch') { h.mode = 'idle'; if (o.mode === 'stretch') o.mode = 'idle'; stretch = null; } else if (h.name === 'left') updateStretch();
    }
    // -- starting modes
    if (h.mode === 'idle' && !capturing && !env.inside) {
      const src = gripRise(h);
      if (src) {
        if (armed && h.name === 'right' && src === 'squeeze') { armed = null; stage.setGhost(null); } // a grab cancels a pending summon
        const rec = candidateFor(h, src);
        if (rec) startCarry(h, rec, src);
        else if (src === 'trigger') { if (h.aboveSurf < 0.05 && Math.hypot(h.tipG.x, h.tipG.z) < env.radius) startQuake(h, src); }
        else {
          const onGround = hand ? (h.aboveSurf < 0.06 && h.aboveSurf > -0.1 && Math.hypot(h.tipG.x, h.tipG.z) < env.radius) : !!env.rayToTable(h.kind === 'mouse' ? ctx.player.head : h.palm, h.dir, _o, 1.0);
          if (onGround && nearRim(h, 'squeeze') === false) startQuake(h, src);
          else if (nearRim(h, 'squeeze') || (!hand && rimRay(h))) startRim(h);
          else h.freeGrip = true;
        }
      }
    }
    if (!h.grab && !h.trig) h.freeGrip = false;
    // -- rim hint
    if (hand && h.mode === 'idle') { if (nearRim(h, 'trigger') || nearRim(h, 'squeeze')) rimHint = t; }
    // -- feedback dot under the fingertip
    const dot = tipDots[h.name];
    if (hand || h.kind === 'mouse') {
      const rr = Math.hypot(h.tipG.x, h.tipG.z);
      if (h.aboveSurf > -0.05 && h.aboveSurf < 0.35 && rr < env.radius) {
        dot.visible = true; dot.position.set(h.tipG.x, 0.12, h.tipG.z);
        const k = clamp(1 - h.aboveSurf / 0.35, 0, 1);
        dot.scale.setScalar(0.5 + 1.6 * (1 - k)); dot.material.opacity = 0.2 + 0.6 * k; dot.material.color.set(h.name === 'left' ? 0x9fd8ff : 0xffe9a0);
      } else dot.visible = false;
    } else dot.visible = false;
    if (h.name === 'right' || true) {
      if (h.mode === 'idle' && !capturing) { flick(h, dt, t); poke(h, t); }
    }
    if (!capturing && h.mode !== 'carry' && h.mode !== 'quake' && h.mode !== 'rim' && h.mode !== 'stretch' && !env.inside) drawUpdate(h, dt);
    if (h.name === 'right') { if (!capturing && !env.inside) armUpdate(h); }
    // pointer ray
    if (h.name === 'right' && (h.kind === 'controller' || h.kind === 'mouse')) {
      const hit = env.rayToTable(h.kind === 'mouse' ? _o.copy(ctx.player.head).addScaledVector(h.dir, 0) : h.palm, h.dir, _w, 1.0);
      if (hit && !env.inside && h.kind === 'controller') {
        const pos = rayGeo.attributes.position;
        env.toRoom(_w, _g);
        pos.setXYZ(0, h.palm.x, h.palm.y, h.palm.z); pos.setXYZ(1, _g.x, _g.y, _g.z); pos.needsUpdate = true; rayLine.visible = true;
      } else rayLine.visible = false;
    }
  }
  let rimHint = -9;
  function rimRay(h) {
    const hit = env.rayToTable(h.kind === 'mouse' ? ctx.player.head : h.palm, h.dir, _w, 1.2);
    return !!hit && Math.abs(Math.hypot(hit.x, hit.z) - env.radius) < 0.9;
  }
  function trigClassify(h) {
    const pal = P().palette;
    if (pal && pal.capturing) return 'palette';
    if (h.mode !== 'idle') return 'busy';
    if (env.inside) return 'cast';
    if (armed) { const o = h.kind === 'mouse' ? ctx.player.head : (h.kind === 'hand' || h.kind === 'script') ? h.tip : h.palm; if (env.rayToTable(o, h.dir, _w, 1.0)) return 'place'; }
    if (h.name === 'right' && (h.kind === 'hand' || h.kind === 'script')) {
      if (nearest(h.tipG, gm(0.065))) return 'carry';
      if (h.aboveSurf < 0.05 && h.aboveSurf > -0.1 && Math.hypot(h.tipG.x, h.tipG.z) < env.radius) return 'quake';
    }
    return 'cast';
  }
  function releaseAll(h) {
    if (h.carry) releaseCarry(h, false);
    if (h.quake) endQuake(h, false);
    h.rim = null; h.drawing = null; h.mode = 'idle'; h.gripSrc = null;
  }

  // ------------------------------------------------------------------ public surface
  const api = {
    hands: H,
    override(name, st) { ov[name] = st; if (!st) H[name].hist = false; },
    // script a hand in GAME coordinates: tipG = point, opts { dir (game), trig, grab, point, open, fist, palmN }
    scriptGame(name, tipG, opts = {}) {
      const tip = env.toRoom(tipG, new Vector3());
      const o = { tip, trig: opts.trig, grab: opts.grab, point: opts.point, open: opts.open, fist: opts.fist, b: opts.b, pinch: opts.pinch, palmN: opts.palmN };
      if (opts.dirG) o.dir = env.dirToRoom(new Vector3(opts.dirG.x, opts.dirG.y, opts.dirG.z).normalize(), new Vector3());
      if (opts.palmG) o.palm = env.toRoom(opts.palmG, new Vector3());
      ov[name] = o;
      return o;
    },
    state: (n) => H[n],
    get armed() { return armed; },
    arm(a) { armed = a || null; if (!armed) stage.setGhost(null); },
    disarm() { armed = null; stage.setGhost(null); },
    get flying() { return flying; },
    get marchers() { return marchers; },
    get stretching() { return !!stretch; },
    nearest: (pg, reach, f) => nearest(pg, reach, f),
    aimPoint() {
      const h = ensure(H.right);
      if (!h.valid) return null;
      const o = h.kind === 'mouse' ? ctx.player.head : (h.kind === 'hand' || h.kind === 'script') ? h.tip : h.palm;
      return env.rayToTable(o, h.dir, new Vector3(), 1.0);
    },
    talkTarget() {
      const h = ensure(H.right);
      const K = kit();
      if (!K || !K.actors) return null;
      const og = h.valid ? (h.kind === 'hand' || h.kind === 'script' ? h.tipG : env.toGame(h.kind === 'mouse' ? ctx.player.head : h.palm, new Vector3())) : env.toGame(ctx.player.head, new Vector3());
      const dg = h.valid ? h.dirG : env.dirToGame(ctx.player.forward, new Vector3());
      let best = null, bs = 1e9;
      for (const a of K.actors) {
        if (a.dead || a.removed || a.kind === 'creature' || a.hidden || a.noTalk || !a.group.visible) continue;
        const p = a.group.position, hh = a.height ?? 1.7;
        _w.set(p.x - og.x, p.y + hh * 0.5 - og.y, p.z - og.z);
        const along = _w.dot(dg);
        if (along < 0) continue;
        const perp = Math.sqrt(Math.max(0, _w.lengthSq() - along * along));
        const score = perp / Math.max(0.6, hh * 0.5);
        if (score < bs && perp < Math.max(1.6, hh)) { bs = score; best = a; }
      }
      return best;
    },
    // asked by core/mr.js from inside a spell's cast(): 'convert' (cast into the table) | 'suppress'
    gateCast(args) {
      const h = ensure(H.right);
      const pal = P().palette;
      if (pal && pal.capturing === 'right') return 'suppress';
      const m = h.trigP ? (h.trigMode = trigClassify(h)) : h.trigMode;
      if (m === 'carry' || m === 'quake' || m === 'place' || m === 'busy' || m === 'palette') return 'suppress';
      if (h.mode !== 'idle') return 'suppress';
      return 'convert';
    },
    enter() { for (const n of ['left', 'right']) { H[n].hist = false; H[n].mode = 'idle'; } },
    exit() {
      for (const n of ['left', 'right']) { releaseAll(H[n]); tipDots[n].visible = false; }
      stretch = null; armed = null; flying.length = 0; marchers.length = 0;
      stage.setGhost(null); stage.setAura(null); stage.setTrail(null); stage.setBump(null); stage.setSelect(null);
      rayLine.visible = false;
    },
    update(dt, t) {
      dt = Math.min(dt, 0.1);
      const L = H.left, R = H.right;
      stepHand(L, dt, t); stepHand(R, dt, t);
      // two grips in empty air: stretch the table
      if (!stretch && L.valid && R.valid && L.freeGrip && R.freeGrip && L.mode === 'idle' && R.mode === 'idle') startStretch();
      // fists knocked together: reset
      if (L.valid && R.valid && L.fist && R.fist && L.ref.distanceTo(R.ref) < 0.09) { resetHold += dt; if (resetHold > 0.7) { resetHold = 0; world.mr && world.mr.reset(); buzz(L, 0.6, 80); buzz(R, 0.6, 80); } } else resetHold = 0;
      stepFlying(dt); stepMarchers(dt);
      aura(dt);
      // hover highlight: what would be picked up next, by the right hand
      if (R.valid && R.mode === 'idle' && !env.inside) {
        const rec = candidateFor(R, 'trigger');
        if (rec) stage.setHover(_o.set(rec.c.x, 0, rec.c.z), Math.max(0.8, rec.r * 1.35)); else stage.setHover(null);
      } else if (R.mode !== 'idle' || env.inside) stage.setHover(null);
      stage.setRimHot(t - rimHint < 0.25);
      // talk ring on the person being addressed
      const talking = input.left.down.trigger && !env.inside;
      stage.setTalk(talking ? api.talkTarget() : null);
    },
    dispose() {
      api.exit();
      dotG.dispose(); for (const n in tipDots) { tipDots[n].material.dispose(); stage.remove(tipDots[n]); }
      rayGeo.dispose(); rayLine.material.dispose(); roomGroup.remove(rayLine);
    },
  };
  void clockStamp;
  return api;
}
