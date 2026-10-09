// core/player.js — locomotion, jump, snap turn, pointer ray + aim reticle, gloved hands (controllers / desktop), collision with the physics world.
// Publishes world.player: TWEAKABLE NUMBERS to grant wishes (set from a creation, restore in dispose; do not rewrite this file for faster/fly/jump higher):
//   speed (m/s, 4)  sprintMultiplier (1.7)  jumpSpeed (m/s, 4.8)  gravity (m/s², 12)  flying (false)  flySpeed (6)  noclip (false: with
//   flying, walk through walls)  snapAngle (deg, 30)  snapEnabled (true)  enabled (true: false freezes all locomotion)  showRay  showReticle
//   velocity (Vector3: external velocity; .y is vertical speed)   grounded / sprinting / physical (read-only; physical = collides via Rapier)
//   aim { point: Vector3, valid: bool }  where the right hand points on the ground (updated every frame)
// Methods: teleport(x, z)   jump()   launch(vx, vy, vz) (adds velocity, e.g. a bounce pad or knock-back)
// SCALE (giant / tiny player):  scale (read; 1)   setScale(s, seconds = 0) -> clamps to 0.2..8 and scales the WHOLE rig (eyes, hands, reach and held weapon grips follow because they hang off it)
//   about your feet, keeping your head where it is; the collision capsule, step height, walk/fly speed (x s), gravity and jump (x s: same feel at any size), the aim reticle and
//   your hit target follow. seconds > 0 eases there. eyeHeight (read, m). Event 'player:scale' { scale, seconds }. Writing rig.scale directly is adopted (clamped) but call setScale.
//   Restore setScale(1) in dispose (or setScale(1, 0.5)). Do not scale the camera or per-hand anchors yourself.
// COLLISION  with world.physics the rig moves through a Rapier capsule (r 0.3) at the HEAD's floor position: walls and block:true scenery stop the stick,
//   steps <= 0.35 m are climbed, props are walked through, loose bodies shoved. Your real head motion is never fought (no rubber-banding): a head that
//   leaned into a wall only blocks stick movement that way (view fades dark while the head itself is inside solid geometry; inside a collider the stick
//   frees you). Without physics the classic ground-glued move runs and kit.obstacle circles push the rig. Modules that move the rig by hand are adopted.
// HEALTH:  health (100)  maxHealth (100)  alive  invulnerable (seconds left; set Infinity for god mode, 0 to end it)
//   regen (hp/s, 2)  regenDelay (s without damage before regen starts, 6)
//   damage(amount, { from, point }) -> hp lost (0 if invulnerable/dead)   heal(n)   respawn() (origin, full health, 3 s invulnerable)
//   Hurt = red vignette + controller buzz + knock-back away from `point`; a health arc shows on the left wrist when hurt.
//   Death: screen fades to black, respawn at the origin after 3 s. Events: 'player:hurt' { amount, health, from, point },
//   'player:died' { by }, 'player:respawn'. world.player.damageable is the target enemies hit (faction 'friendly').
//   Enemies hurt you only via kit.hit(..., { from:'enemy' }) / world.combat; unattributed kit.hit never hurts the player.
//   To hurt the player from a creation: world.player.damage(8, { from: 'enemy', point }).
// Flying: left stick moves along where you look; right stick up/down (or right b) ascends/descends.
// Desktop extras: Shift = sprint, Space = jump (plus the boot.js emulation: WASD, arrows, Q = jump).
export const meta = { name: 'Player', description: 'Smooth locomotion, snap turn, jump, pointer ray, reticle and hands.' };

export default function (ctx) {
  const THREE = ctx.THREE, { input, rig, camera } = ctx;
  const { Vector3, Quaternion, Euler } = THREE;
  const L = input.left, R = input.right;
  const DEG = Math.PI / 180;
  const _q = new Quaternion(), _e = new Euler(), _f = new Vector3(), _hv = new Vector3(), _n = new Vector3(), _up = new Vector3(0, 1, 0);
  const mv = new Vector3(); // smoothed stick velocity (m/s)
  const clamp = THREE.MathUtils.clamp;
  const st = (ctx.state.hp ??= { health: 100, maxHealth: 100, alive: true, invulnerable: 0, deadT: 0, sinceHurt: 99 }); // survives hot reload
  let pulse = 0, fade = st.alive ? 0 : 1, arcShown = -1, arcT = 0;
  // ---- player scale. rig.scale.x is the truth (it survives a hot reload of this file); sc mirrors the value we last applied, scTarget is where an eased change is going.
  const SC_MIN = 0.2, SC_MAX = 8;
  let sc = clamp(rig.scale.x || 1, SC_MIN, SC_MAX), scTarget = sc, scRate = 0, scApplied = rig.scale.x;
  if (sc !== rig.scale.x) { rig.scale.setScalar(sc); scApplied = sc; }
  // rescale about the feet but keep the head where it is horizontally (the headset's room-scale offset is part of the rig's local space)
  function applyScale(next) {
    next = clamp(next, SC_MIN, SC_MAX);
    const old = rig.scale.x;
    if (Math.abs(next - old) > 1e-6) {
      const cp = camera.position, c = Math.cos(rig.rotation.y), s = Math.sin(rig.rotation.y);
      rig.position.x += (old - next) * (cp.x * c + cp.z * s);
      rig.position.z += (old - next) * (cp.z * c - cp.x * s);
      rig.scale.setScalar(next);
    }
    sc = scApplied = next;
  }

  const P = {
    speed: 4, sprintMultiplier: 1.7, jumpSpeed: 4.8, gravity: 12, flying: false, flySpeed: 6, noclip: false,
    snapAngle: 30, snapEnabled: true, enabled: true, showRay: true, showReticle: true,
    velocity: new Vector3(), grounded: true, sprinting: false, physical: false, aim: { point: new Vector3(), valid: false },
    regen: 2, regenDelay: 6, damageable: null, // health, maxHealth, alive, invulnerable: accessors on `st` (below) so they survive reloads
    damage(amount, o = {}) {
      if (!P.alive || !(amount > 0)) return 0;
      if (P.invulnerable === true || P.invulnerable > 0) return 0;
      P.health = Math.max(0, P.health - amount);
      st.sinceHurt = 0; arcT = 3;
      pulse = Math.max(pulse, clamp(0.4 + amount / 30, 0.4, 1));
      const s = clamp(0.4 + amount / 25, 0.4, 1);
      try { L.pulse?.(s, 120); R.pulse?.(s, 120); } catch (err) { /* no haptics */ }
      const p = o.point;
      if (p) {
        const h = ctx.player.head, dx = h.x - p.x, dz = h.z - p.z, n = Math.hypot(dx, dz) || 1, k = clamp(amount * 0.25, 0.8, 3);
        P.launch((dx / n) * k, 0, (dz / n) * k);
      }
      ctx.events.emit('player:hurt', { amount, health: P.health, from: o.from, point: p });
      if (P.health <= 0) die(o.by ?? o.from);
      return amount;
    },
    heal(n = 1) { if (P.alive && n > 0) P.health = Math.min(P.maxHealth, P.health + n); },
    respawn() {
      P.health = P.maxHealth; P.alive = true; P.invulnerable = 3; st.deadT = 0; st.sinceHurt = 99; pulse = 0;
      P.teleport(0, 0);
      ctx.events.emit('player:respawn', {});
    },
    teleport(x, z) {
      headXZ(); // (the head may have been moved by the room-scale player or by a module since boot.js sampled it)
      rig.position.x += x - hx; rig.position.z += z - hz;
      rig.position.y = ctx.groundAt(x, z);
      P.velocity.set(0, 0, 0); mv.set(0, 0, 0); airborne = false;
      resetBody();
      syncPoses();
    },
    jump() { if (!P.flying && !airborne) { P.velocity.y = P.jumpSpeed * sc; airborne = true; } },
    launch(vx, vy, vz) { P.velocity.x += vx; P.velocity.y += vy; P.velocity.z += vz; },
    setScale(s, seconds = 0) {
      s = Number(s);
      if (!(s > 0)) return sc;
      scTarget = clamp(s, SC_MIN, SC_MAX);
      if (!(seconds > 0)) { scRate = 0; applyScale(scTarget); syncPoses(); resizeBody(); } else scRate = 3 / seconds;
      ctx.events.emit('player:scale', { scale: scTarget, seconds: seconds > 0 ? seconds : 0 });
      return scTarget;
    },
  };
  Object.defineProperty(P, 'scale', { get: () => sc, set: (v) => { P.setScale(v); }, enumerable: true, configurable: true });
  Object.defineProperty(P, 'eyeHeight', { get: () => ctx.player.head.y - rig.position.y, enumerable: true, configurable: true });
  let airborne = false, armed = true, sprint = false, shift = false, space = false, spaceWas = false;
  // ---- physics body state. cy = the capsule's feet height (the truth; rig.y follows it smoothly), lastY = where WE left the rig's height (a
  // difference next frame means another module moved it: blink, car, lift, MR entry ... -> adopt it).
  let ch = null, chWorld = null, chScale = 1, chResizeT = 0, chOn = false, chRetry = 0, cy = 0, lastY = 0, hx = 0, hz = 0, haveLast = false;
  let wallFade = 0, blockedT = 0, escapeT = 0, embedSc = 1, embedShape = null, embedShapeR = null, embedHead = null;
  const EMB_GROUPS = ((16 << 16) | 1) >>> 0; // membership 'char' (16), filter 'world' (1) only: solid world/scenery colliders, not props, bodies or held weapons (see core/physics.js groups)
  const QPOS = { x: 0, y: 0, z: 0 }, QROT = { x: 0, y: 0, z: 0, w: 1 };
  const PH = () => { const p = ctx.world.physics; return p && p.ready && p.character && p.world ? p : null; };
  // the head's floor position from the rig + the headset's real (room-scale) offset: no matrices needed, always fresh
  function headXZ() {
    const c = Math.cos(rig.rotation.y), s = Math.sin(rig.rotation.y), cp = camera.position;
    const k = rig.scale.x;   // the headset offset lives in the rig's scaled local space
    hx = rig.position.x + (cp.x * c + cp.z * s) * k; hz = rig.position.z + (cp.z * c - cp.x * s) * k;
  }
  // the capsule cannot be resized: after a scale change build a new one (at most 4 times a second while a change is being eased)
  function resizeBody() {
    if (!ch || ch.removed || Math.abs(sc / chScale - 1) < 0.04 || chResizeT > ctx.clock.t) return;
    chResizeT = ctx.clock.t + 0.25;
    ch.remove(); ch = null; chRetry = 0;
  }
  function resetBody() { cy = rig.position.y; haveLast = false; blockedT = 0; escapeT = 0; if (ch && !ch.removed) { headXZ(); ch.teleport(hx, cy, hz); } }
  for (const k of ['health', 'maxHealth', 'alive', 'invulnerable']) {
    Object.defineProperty(P, k, { get: () => st[k], set: (v) => { st[k] = v; }, enumerable: true, configurable: true });
  }

  function die(by) {
    P.health = 0; P.alive = false; st.deadT = 0; pulse = 1;
    P.velocity.set(0, 0, 0); mv.set(0, 0, 0);
    ctx.events.emit('player:died', { by });
    ctx.hud?.show('You fall...', 2.5);
  }

  // ---- desktop-only keys (boot.js does not expose Shift/Space)
  const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  const onKey = (down) => (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shift = down && !typing();
    if (e.code === 'Space' && !typing()) { space = down; if (down && e.target === document.body) e.preventDefault(); }
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  ctx.onDispose(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); });

  // ---- after moving the rig, refresh the world-space poses boot.js computed earlier this frame
  function syncPoses() {
    rig.updateMatrixWorld(true);
    camera.getWorldPosition(ctx.player.head);
    camera.getWorldDirection(ctx.player.forward);
    for (const h of [L, R]) {
      if (!h.connected) continue;
      h.anchor.getWorldPosition(h.position);
      h.anchor.getWorldQuaternion(h.quaternion);
      h.direction.set(0, 0, -1).applyQuaternion(h.quaternion);
    }
  }

  function snapTurn(dt) {
    const x = R.stick.x;
    if (armed) {
      if (P.snapEnabled && Math.abs(x) > 0.7) {
        const ang = -Math.sign(x) * P.snapAngle * DEG, head = ctx.player.head;
        const c = Math.cos(ang), s = Math.sin(ang), dx = rig.position.x - head.x, dz = rig.position.z - head.z;
        rig.position.x = head.x + dx * c + dz * s;
        rig.position.z = head.z - dx * s + dz * c;
        rig.rotation.y += ang;
        armed = false;
        return true;
      }
    } else if (Math.abs(x) < 0.3) armed = true;
    return false;
  }

  function locomotion(dt) {
    let sx = L.stick.x, sy = L.stick.y, mag = Math.hypot(sx, sy);
    if (mag < 0.15) { sx = sy = mag = 0; } else { const k = Math.min(1, (mag - 0.15) / 0.85) / mag; sx *= k; sy *= k; mag = Math.min(1, (mag - 0.15) / 0.85); }
    if (L.pressed('stickPress')) sprint = true;
    if (mag === 0 && !shift) sprint = false;
    P.sprinting = (sprint || shift) && mag > 0;
    const spd = (P.flying ? P.flySpeed : P.speed) * (P.sprinting ? P.sprintMultiplier : 1) * sc;   // a giant covers ground in giant strides

    camera.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    const yaw = _e.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let tx, ty = 0, tz;
    if (P.flying) {
      camera.getWorldDirection(_f);
      tx = (-sy * _f.x + sx * rx) * spd; ty = -sy * _f.y * spd; tz = (-sy * _f.z + sx * rz) * spd;
      const vert = (R.down.b || space ? 1 : 0) - R.stick.y;
      ty += Math.max(-1, Math.min(1, vert)) * P.flySpeed * sc;
    } else {
      tx = (-sy * fx + sx * rx) * spd; tz = (-sy * fz + sx * rz) * spd;
    }
    const k = 1 - Math.exp(-14 * dt);
    mv.x += (tx - mv.x) * k; mv.y += (ty - mv.y) * k; mv.z += (tz - mv.z) * k;

    const V = P.velocity, drag = Math.exp(-(airborne ? 0.6 : 4) * dt);
    const dx = (mv.x + V.x) * dt, dz = (mv.z + V.z) * dt;
    V.x *= drag; V.z *= drag;
    if (!P.flying && (R.pressed('b') || (space && !spaceWas))) P.jump();
    const Py = PH();
    if (Py && physMove(dt, Py, dx, dz)) return;
    P.physical = false;

    // ---- classic path (no physics): ground-glued, kit.obstacle circles push the rig
    rig.position.x += dx; rig.position.z += dz;
    const gy = ctx.groundAt(rig.position.x, rig.position.z);
    if (P.flying) {
      V.y = 0; airborne = false;
      rig.position.y = Math.max(gy, rig.position.y + mv.y * dt);
    } else {
      if (!airborne && V.y > 0.1) airborne = true;
      if (airborne) {
        V.y -= P.gravity * sc * dt;
        rig.position.y += V.y * dt;
        if (rig.position.y <= gy && V.y <= 0) { rig.position.y = gy; V.y = 0; airborne = false; }
      } else {
        rig.position.y += (gy - rig.position.y) * (1 - Math.exp(-20 * dt));
        if (rig.position.y - gy > 0.35 * sc) airborne = true; // walked off a ledge
      }
    }
    P.grounded = !airborne && !P.flying;
  }

  // ---- physics path: the capsule sits where the HEAD is on the floor; ch.move says how much of the wished movement is allowed.
  // Returns false when there is no usable character (the caller then uses the classic path).
  function ensureChar(Py) {
    if (ch && (ch.removed || chWorld !== Py.world)) ch = null;
    if (ch) return ch;
    if (chRetry > ctx.clock.t) return null;
    ch = Py.character(ctx, { radius: 0.3 * sc, height: 1.7 * sc, stepHeight: 0.35 * sc });
    if (!ch) { chRetry = ctx.clock.t + 1.5; return null; }
    chWorld = Py.world; chOn = true; chScale = sc; resetBody();
    return ch;
  }
  function embedded(Py, y, yHead) { // is the body (or the head) inside fixed geometry? -> 1 body, 2 head
    const R_ = Py.rapier;
    if (!embedShape || embedShapeR !== R_ || embedSc !== sc) { embedShape = new R_.Capsule(0.38 * sc, 0.2 * sc); embedShapeR = R_; embedHead = new R_.Ball(0.1 * sc); embedSc = sc; }
    QPOS.x = hx; QPOS.y = y + 0.98 * sc; QPOS.z = hz;
    let r = Py.world.intersectionWithShape(QPOS, QROT, embedShape, R_.QueryFilterFlags.EXCLUDE_DYNAMIC, EMB_GROUPS) ? 1 : 0;
    QPOS.y = yHead;
    if (Py.world.intersectionWithShape(QPOS, QROT, embedHead, R_.QueryFilterFlags.EXCLUDE_DYNAMIC, EMB_GROUPS)) r |= 2;
    return r;
  }
  function physMove(dt, Py, dx, dz) {
    const c = ensureChar(Py);
    if (!c) return false;
    const V = P.velocity;
    headXZ();
    if (!haveLast || Math.abs(rig.position.y - lastY) > 0.002) cy = rig.position.y; // first frame, or another module changed the height
    const gyH = ctx.groundAt(hx, hz);
    const emb = P.noclip ? 0 : embedded(Py, cy, ctx.player.head.y);
    if (emb & 2) wallFade = Math.min(1, wallFade + dt * 7); else wallFade = Math.max(0, wallFade - dt * 5);
    // the capsule is wherever the head physically is (we never push it back); then ask the controller how far we may go
    c.teleport(hx, cy, hz);
    let dy = 0;
    if (P.flying) { V.y = 0; airborne = false; dy = mv.y * dt; }
    else if (!airborne && V.y > 0.1) airborne = true;
    if (!P.flying) {
      if (airborne) { V.y -= P.gravity * sc * dt; dy = V.y * dt; }
      else { // glue to the analytic ground; while standing on something (rubble, a step) only press down gently so auto-step can climb
        dy = gyH - cy;
        dy = dy > 0 ? Math.min(0.5 * sc, dy) : c.grounded ? Math.max(-0.04 * sc, dy) : Math.max(-0.5 * sc, dy);
      }
    }
    const wish2 = dx * dx + dz * dz;
    if (emb & 1 && wish2 > 1e-6) escapeT = 0.5; // the body is inside solid scenery (a house spawned on us, a wall we blinked into): walk out freely
    let ax, az, ny;
    if (P.noclip || escapeT > 0) {
      escapeT -= dt; ax = dx; az = dz; ny = cy + dy;
      if (airborne && V.y <= 0 && ny <= gyH) { ny = gyH; }
    } else {
      const sy = cy;
      c.move(dx, dy, dz);
      const p = c.position;
      ax = p.x - hx; az = p.z - hz; ny = p.y;
      // the view is never shoved: never more than asked, never against the wish (depenetration of a head that leaned into a wall)
      const al = ax * ax + az * az;
      if (wish2 < 1e-10 || ax * dx + az * dz <= 0) { ax = 0; az = 0; }
      else if (al > wish2) { const k = Math.sqrt(wish2 / al); ax *= k; az *= k; }
      if (airborne && V.y > 0 && ny - sy < dy * 0.3) V.y = 0; // bumped a ceiling
      if (airborne && V.y <= 0 && c.grounded) { V.y = 0; airborne = false; }
    }
    // never below the visual ground (the Rapier heightfield is a 1 m sampling of it)
    const gyN = ctx.groundAt(hx + ax, hz + az);
    if (ny < gyN) { ny = gyN; if (airborne && V.y <= 0) { V.y = 0; airborne = false; } }
    else if (!airborne && !P.flying && ny - gyN > 0.35 * sc && !c.grounded) { airborne = true; V.y = 0; } // walked off a ledge
    cy = ny;
    rig.position.x += ax; rig.position.z += az;
    if (airborne || P.flying || Math.abs(cy - rig.position.y) > 0.8 * sc) rig.position.y = cy;
    else rig.position.y += (cy - rig.position.y) * (1 - Math.exp(-20 * dt)); // step-ups and slopes glide instead of popping
    P.grounded = !airborne && !P.flying;
    P.physical = true;
    blockedT = wish2 > 1e-6 && ax * ax + az * az < wish2 * 0.04 ? blockedT + dt : 0;
    return true;
  }

  // ---- aim: allocation-free ground ray from the right hand
  function computeAim() {
    const a = P.aim, o = R.position, d = R.direction;
    a.valid = false;
    if (!R.connected || d.y > 0.05) return;
    let prevT = 0, prevD = o.y - ctx.groundAt(o.x, o.z);
    for (let t = 0.5; t <= 80; t += t < 20 ? 0.5 : 1.5) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, dd = y - ctx.groundAt(x, z);
      if (dd <= 0) {
        const ht = prevT + (t - prevT) * (prevD / (prevD - dd || 1));
        a.point.set(o.x + d.x * ht, 0, o.z + d.z * ht);
        a.point.y = ctx.groundAt(a.point.x, a.point.z);
        a.valid = true;
        return;
      }
      prevT = t; prevD = dd;
    }
  }

  // ---- visuals: reticle (in root) + ray and gauntlets (on hand anchors; we dispose these ourselves)
  const own = []; // things to dispose
  const track = (o) => { own.push(o); return o; };
  const reticle = new THREE.Group();
  const rmat = track(new THREE.MeshBasicMaterial({ color: 0xffc878, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  reticle.add(new THREE.Mesh(track(new THREE.RingGeometry(0.2, 0.25, 32).rotateX(-Math.PI / 2)), rmat));
  reticle.add(new THREE.Mesh(track(new THREE.CircleGeometry(0.04, 12).rotateX(-Math.PI / 2)), rmat));
  reticle.visible = false;
  ctx.root.add(reticle);

  const rayMat = track(new THREE.MeshBasicMaterial({ color: 0xffc878, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  const ray = new THREE.Mesh(track(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5)), rayMat);
  ray.frustumCulled = false; ray.visible = false;
  R.anchor.add(ray);

  // Gloved hands: tan leather glove, olive cuff, brass bands, amber gem on the left back-of-hand. Each part is ONE merged mesh whose vertex colours
  // carry the painted shading (5 draw calls a hand, ~0.8k triangles). Fingers curl with the trigger / grip; anchors and the spell orb are untouched.
  const GLOVE = { leather: 0x9d7049, knuckle: 0xb08158, cuff: 0x67703f, cuffRim: 0x4a4a2c, brass: 0xd3a54f, gem: 0xffb347 };
  function part(geo, hex, k = 1) { // bake the colour with a top-lit gradient (lighter up, darker under) into the geometry
    const c = new THREE.Color(hex), n = geo.attributes.normal, p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const l = k * (0.7 + 0.3 * (n.getY(i) * 0.5 + 0.5)); col[i * 3] = c.r * l; col[i * 3 + 1] = c.g * l; col[i * 3 + 2] = c.b * l; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  function merged(list) { // position + normal + colour + index merge (all parts are indexed primitives)
    let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      P.set(g.attributes.position.array, ov * 3); N.set(g.attributes.normal.array, ov * 3); C.set(g.attributes.color.array, ov * 3);
      for (let i = 0; i < g.index.count; i++) I[oi + i] = g.index.array[i] + ov;
      ov += g.attributes.position.count; oi += g.index.count; g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3)); m.setAttribute('color', new THREE.BufferAttribute(C, 3)); m.setIndex(new THREE.BufferAttribute(I, 1));
    return track(m);
  }
  const gloveMat = track(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x24160c }));
  const gemMat = track(new THREE.MeshBasicMaterial({ color: GLOVE.gem }));
  const gemG = track(new THREE.SphereGeometry(1, 8, 5).scale(0.0105, 0.0055, 0.0105)); // amber cabochon seated in the brass plate
  const seg = (r, len, z0, tilt = 0, x = 0) => new THREE.CapsuleGeometry(r, len, 1, 6).rotateX(-Math.PI / 2).translate(0, 0, -(len / 2 + r)).rotateX(tilt).translate(x, 0, z0); // finger bone along -z from z0, tilt<0 curls it down
  function finger(r, len, x = 0, curve = 0.12) { // two bones with a relaxed bend
    const l1 = len * 0.58, l2 = len * 0.42;
    return [part(seg(r, l1, 0, 0, x), GLOVE.leather), part(seg(r * 0.92, l2, 0, -curve).translate(x, 0, -(l1 + 2 * r) * 0.9), GLOVE.knuckle)];
  }
  function makeHand(hand, side) {
    const g = new THREE.Group(); g.name = 'glove';
    const body = merged([
      part(new THREE.SphereGeometry(1, 10, 7).scale(0.04, 0.0185, 0.05).translate(0, 0, 0.048), GLOVE.leather),                    // palm
      part(new THREE.SphereGeometry(1, 8, 6).scale(0.034, 0.011, 0.028).translate(0, 0.0105, 0.03), GLOVE.knuckle, 1.05),          // back of hand
      part(new THREE.CylinderGeometry(0.047, 0.037, 0.06, 12, 1).rotateX(Math.PI / 2).translate(0, 0, 0.11), GLOVE.cuff),         // flared cuff (wide end toward the arm)
      part(new THREE.CylinderGeometry(0.0485, 0.0485, 0.012, 12, 1).rotateX(Math.PI / 2).translate(0, 0, 0.14), GLOVE.cuffRim),
      part(new THREE.TorusGeometry(0.0385, 0.0045, 4, 12).translate(0, 0, 0.088), GLOVE.brass, 1.1),                                // brass bands
      part(new THREE.TorusGeometry(0.0485, 0.004, 4, 12).translate(0, 0, 0.146), GLOVE.brass, 1.1),
      part(new THREE.CylinderGeometry(0.0165, 0.019, 0.004, 10).translate(0, 0.0195, 0.045), GLOVE.brass, 1.1),                    // plate under the gem / orb
    ]);
    const mk = (geo) => { const m = new THREE.Mesh(geo, gloveMat); m.userData.noOutline = m.userData.noShadow = true; return m; };
    g.add(mk(body));
    const pivot = (x, y, z, parts) => { const pv = new THREE.Group(); pv.position.set(x, y, z); pv.add(mk(merged(parts))); g.add(pv); return pv; };
    const index = pivot(-side * 0.027, 0.003, 0.0, finger(0.0092, 0.075));
    const rest = pivot(0, 0.003, 0.0, [...finger(0.0092, 0.082, -side * 0.009), ...finger(0.0088, 0.074, side * 0.009), ...finger(0.0078, 0.058, side * 0.027)]);
    const thumb = pivot(-side * 0.04, -0.003, 0.034, [part(seg(0.0105, 0.026, 0), GLOVE.leather), part(seg(0.0095, 0.02, 0, -0.2).translate(0, 0, -0.04), GLOVE.knuckle)]);
    thumb.rotation.y = -side * 0.55;
    if (side < 0) { const gem = new THREE.Mesh(gemG, gemMat); gem.position.set(0, 0.0255, 0.045); gem.userData.noOutline = true; g.add(gem); g.userData.gem = gem; }
    hand.anchor.add(g);
    return { g, index, rest, thumb, ci: 0, cr: 0, side };
  }  const handsV = [makeHand(L, -1), makeHand(R, 1)];

  // ---- hurt vignette + death fade (head-locked quads, drawn over everything) and the wrist health arc
  const vcv = document.createElement('canvas'); vcv.width = vcv.height = 256;
  {
    const g = vcv.getContext('2d'), gr = g.createRadialGradient(128, 128, 40, 128, 128, 126);
    gr.addColorStop(0, 'rgba(200,0,0,0)'); gr.addColorStop(0.5, 'rgba(210,10,10,0.35)'); gr.addColorStop(1, 'rgba(150,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  const vtex = track(new THREE.CanvasTexture(vcv)); vtex.colorSpace = THREE.SRGBColorSpace;
  const vmat = track(new THREE.MeshBasicMaterial({ map: vtex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  const vig = new THREE.Mesh(track(new THREE.PlaneGeometry(1.7, 1.7)), vmat);
  vig.position.set(0, 0, -0.5); vig.renderOrder = 900; vig.frustumCulled = false; vig.visible = false;
  const fmat = track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  const fadeQ = new THREE.Mesh(track(new THREE.PlaneGeometry(3, 3)), fmat);
  fadeQ.position.set(0, 0, -0.4); fadeQ.renderOrder = 1000; fadeQ.frustumCulled = false; fadeQ.visible = false;
  camera.add(vig); camera.add(fadeQ);

  const acv = document.createElement('canvas'); acv.width = acv.height = 128;
  const ag = acv.getContext('2d');
  const atex = track(new THREE.CanvasTexture(acv)); atex.colorSpace = THREE.SRGBColorSpace;
  const arc = new THREE.Mesh(track(new THREE.PlaneGeometry(0.1, 0.1)),
    track(new THREE.MeshBasicMaterial({ map: atex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false })));
  arc.renderOrder = 60; arc.frustumCulled = false; arc.visible = false;
  ctx.root.add(arc);
  function drawArc(h) {
    const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI, f = clamp(h / P.maxHealth, 0, 1);
    ag.clearRect(0, 0, 128, 128);
    ag.lineCap = 'round'; ag.lineWidth = 14;
    ag.strokeStyle = 'rgba(255,255,255,0.22)'; ag.beginPath(); ag.arc(64, 64, 48, a0, a1); ag.stroke();
    if (f > 0) { ag.strokeStyle = `hsl(${Math.round(f * 120)},85%,55%)`; ag.beginPath(); ag.arc(64, 64, 48, a0, a0 + (a1 - a0) * f); ag.stroke(); }
    ag.fillStyle = '#ffffff'; ag.font = 'bold 34px sans-serif'; ag.textAlign = 'center'; ag.textBaseline = 'middle';
    ag.fillText(String(Math.ceil(h)), 64, 66);
    atex.needsUpdate = true;
  }
  const _bx = new Vector3(), _by = new Vector3(), _bz = new Vector3(), _bm = new THREE.Matrix4();
  function overlays(dt, t) {
    pulse = Math.max(0, pulse - dt * 1.5);
    const low = P.alive && P.health < P.maxHealth * 0.25 ? 0.22 + 0.08 * Math.sin(t * 6) : 0;
    const o = Math.min(1, Math.max(pulse, low));
    vmat.opacity = o; vig.visible = o > 0.01;
    fade = P.alive ? Math.max(0, fade - dt * 0.9) : Math.min(1, fade + dt * 1.2);
    const fo = Math.max(fade, wallFade * 0.92); // death fade, or the head is physically inside a wall: show dark instead of the inside of it
    fmat.opacity = fo; fadeQ.visible = fo > 0.005;
    arcT = Math.max(0, arcT - dt);
    const show = L.connected && P.alive && (P.health < P.maxHealth - 0.5 || arcT > 0);
    arc.visible = show;
    if (!show) { arcShown = -1; return; }
    const hv = Math.ceil(P.health);
    if (hv !== arcShown) { arcShown = hv; drawArc(P.health); }
    if (L.tracked) { // back of the left wrist, from the joint positions
      const F = L.fingers;
      _bz.copy(F.palmNormal).negate(); _by.copy(F.palm).sub(F.wrist);
      arc.position.copy(F.wrist).addScaledVector(_bz, 0.05);
    } else { // controller: on top of the forearm just behind the grip
      _bz.set(0, 1, 0).applyQuaternion(L.quaternion); _by.set(0, 0, -1).applyQuaternion(L.quaternion);
      arc.position.copy(L.position).addScaledVector(_bz, 0.055).addScaledVector(_by, -0.11);
    }
    _bx.crossVectors(_by, _bz).normalize(); _by.crossVectors(_bz, _bx);
    arc.quaternion.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
    arc.scale.setScalar(sc);
  }

  // ---- the player as a damageable (faction 'friendly'): kit.hit(..., { from:'enemy' }) lands on world.player.damage()
  const proxyObj = new THREE.Object3D();
  ctx.root.add(proxyObj);
  function ensureProxy() {
    const K = ctx.world.kit;
    if (!K || !K.damageable || (P.damageable && !P.damageable.removed)) return;
    const d = K.damageable(ctx, proxyObj, {
      hp: 1e9, radius: 0.6, faction: 'friendly', isPlayer: true,
      onHit(e) { d.hp = d.maxHp; P.damage(e.amount, { from: e.from, point: e.point, by: e.by }); },
    });
    d.alive = P.alive;
    P.damageable = d;
  }

  ctx.onDispose(() => {
    for (const hv of handsV) hv.g.removeFromParent();
    ray.removeFromParent(); vig.removeFromParent(); fadeQ.removeFromParent();
    P.damageable?.remove?.();
    for (const o of own) o.dispose();
  });

  function visuals(dt, t) {
    const hands = [L, R];
    // Flat screen: the gauntlets sit low and a little smaller so they frame the view instead of covering it, and step aside while a menu
    // panel is open (the panel fills the middle of the screen). In a headset they are the real hands.
    const flat = !input.presenting, away = flat && !!ctx.world.menu?.isOpen;
    for (let i = 0; i < 2; i++) {
      const hv = handsV[i], h = hands[i];
      hv.g.visible = h.connected && !h.tracked && !away; // boot.js draws real finger models for tracked hands
      if (flat) { hv.g.position.set(hv.side * 0.055, 0.0, 0.03); hv.g.scale.setScalar(0.65); hv.g.rotation.set(0.5, -hv.side * 0.3, -hv.side * 0.7); } // tilted so the back of the glove shows, not the cuff end-on
      else if (hv.g.scale.x !== 1) { hv.g.position.set(0, 0, 0); hv.g.scale.setScalar(1); hv.g.rotation.set(0, 0, 0); }
      const k = Math.min(1, dt * 22);
      hv.ci += (h.trigger - hv.ci) * k; hv.cr += (h.squeeze - hv.cr) * k;
      hv.index.rotation.x = -(0.32 + hv.ci * 0.95); hv.rest.rotation.x = -(0.5 + hv.cr * 1.0); hv.thumb.rotation.x = -(0.1 + hv.cr * 0.4); // relaxed at rest, closing with trigger / grip
      const gem = hv.g.userData.gem;
      if (gem) gem.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
    }
    const a = P.aim;
    reticle.visible = P.showReticle && a.valid;
    if (reticle.visible) {
      const p = a.point, e = 0.3;
      reticle.position.set(p.x, p.y + 0.04, p.z);
      _n.set(ctx.groundAt(p.x - e, p.z) - ctx.groundAt(p.x + e, p.z), 2 * e, ctx.groundAt(p.x, p.z - e) - ctx.groundAt(p.x, p.z + e)).normalize();
      reticle.quaternion.setFromUnitVectors(_up, _n);
      reticle.scale.setScalar((1 + Math.sin(t * 4) * 0.08) * Math.max(1, sc));
    }
    ray.visible = input.presenting && P.showRay && R.connected;
    if (ray.visible) {
      ray.scale.z = a.valid ? Math.min(60, R.position.distanceTo(a.point)) : 5;
      rayMat.opacity = a.valid ? 0.55 : 0.2;
    }
  }

  ctx.provide('player', P);

  return {
    update(dt, t) {
      dt = Math.min(dt, 0.1);
      if (!P.alive) { st.deadT += dt; if (st.deadT >= 3) P.respawn(); }
      else {
        st.sinceHurt += dt;
        if (!(P.health <= P.maxHealth)) P.health = P.maxHealth;
        if (P.health < P.maxHealth && st.sinceHurt > P.regenDelay) P.health = Math.min(P.maxHealth, P.health + P.regen * dt);
        if (P.invulnerable !== true && P.invulnerable > 0) P.invulnerable = Math.max(0, P.invulnerable - dt);
      }
      let moved = false;
      if (rig.scale.x !== scApplied) { // somebody wrote rig.scale directly (older spells): adopt it, clamped, keeping the head in place
        const v = clamp(rig.scale.x || 1, SC_MIN, SC_MAX), w = rig.scale.x; rig.scale.setScalar(scApplied);
        applyScale(v); scTarget = v; scRate = 0; moved = true; if (w !== v) rig.scale.setScalar(v);
      } else if (sc !== scTarget) { // eased change
        const n = scTarget + (sc - scTarget) * Math.exp(-dt * scRate);
        applyScale(Math.abs(n - scTarget) < scTarget * 0.002 ? scTarget : n); moved = true;
      }
      if (moved) resizeBody();
      if (ch && !ch.removed) { // park the capsule while something else drives the rig (the car): it must not collide with it
        const want = P.enabled && ctx.world.physics?.ready === true;
        if (want !== chOn) { chOn = want; ch.body.setEnabled(want); if (want) resetBody(); }
      }
      if (P.enabled && P.alive) {
        moved = snapTurn(dt);
        locomotion(dt);
        moved = true;
        spaceWas = space;
        lastY = rig.position.y; haveLast = true;
      } else { haveLast = false; wallFade = Math.max(0, wallFade - dt * 5); }
      if (moved) syncPoses();
      ensureProxy();
      if (P.damageable) {
        const h = ctx.player.head;
        proxyObj.position.set(h.x, h.y - 0.5 * sc, h.z);
        P.damageable.alive = P.alive;
        if (P.damageable.radius !== undefined) P.damageable.radius = 0.6 * sc;
      }
      computeAim();
      visuals(dt, t);
      overlays(dt, t);
    },
  };
}
