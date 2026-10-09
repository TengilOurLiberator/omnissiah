// core/mr.js — world.mr: MIXED REALITY as a diorama. In a passthrough session the game does not spill life-size across the player's
// carpet: it lives in miniature on a round "world table" (~1.5 m, 1:20 by default) in front of the player, who is the giant beside the Omnissiah.
//
// FOR THE AI (read before building anything for mixed reality)
//   * Do nothing special. Everything you create (library.spawn, kit.*, creations) appears ON THE TABLE in miniature automatically. Keep using
//     GAME UNITS (metres as if life-size): a 3 m troll stays 3 m, a village stays 20 m. The table is a flat disc of radius mr.radius (~15 m)
//     around the origin (0, 0, 0); y = 0 is the table top. Default spawns (5-9 m in front of the player) land on it. Past the edge things fall
//     to the real floor (world.groundHeight is lower there while mixed reality is on).
//   * AVOID in mixed reality: sky, fog, scene.background, terrain / ground edits (world.env.*, travel), placing things beyond ~14 m from the
//     origin, relying on ctx.player.head / input.* being "in the world": they are the player's REAL room positions (head ~ (0, 1.6, 0)), i.e. a
//     little avatar standing at the table centre. Convert real points with mr.toGame(v) (room -> game) and mr.toRoom(v) (game -> room).
//   * Never move or scale ctx.root yourself; the miniature transform is applied only when drawing, so every game coordinate, ray, collider and
//     getWorldPosition() you use stays plain game space.
// API  world.mr: active, simulated, stage (THREE.Group in game space; mr.toStage(objectOrHandle) adds things to it), scale (room metres per
//   game metre, ~0.05; settable 0.02-0.12), radius, tableHeight, mode, modes() / setMode('gods-table' | 'tower-defence' | 'arena' | 'bowling'),
//   toGame(v, out?) / toRoom(v, out?) / dirToGame(d, out?), rayToTable(origin, dir, out?) -> game point | null, place(point | plane | 'auto'),
//   reset(), stepIn(true | false) (grow the world to life-size around the player and back), features (what the session granted),
//   simulate(true | false) (desktop test: fake passthrough, backdrop, mouse = god-hand), score, contextProvider mr = { scale, mode, aim }.
// MODES  gods-table (sandbox: pick up, throw, flick, quake, shield, draw paths), tower-defence (waves walk a path to your shrine),
//   arena (drop two armies, watch, meddle), bowling (giant's bowling / marbles). Player gestures: see docs/MIXED_REALITY.md.

export const meta = { name: 'MixedReality', description: 'The world in miniature on a table in passthrough (Quest 3 mixed reality).' };

const PARTS = ['stage', 'room', 'hands', 'palette', 'modes', 'sim'];
// module roots that live in REAL room space (not the diorama): the Omnissiah apparition, the menu, the spell wheel, the sun/hemisphere lights...
const ROOM_MODULES = new Set(['core/world.js', 'core/oracle.js', 'core/player.js', 'core/menu.js', 'core/spells.js', 'core/perf.js', 'core/ambience.js',
  'core/commentary.js', 'core/intro.js']);
const S_MIN = 0.02, S_MAX = 0.12, S_DEFAULT = 0.05, RADIUS = 15, EDGE = 0.8, TABLE_Y = 0.75;

export default async function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Quaternion, Matrix4, Group } = THREE;
  const world = ctx.world, events = ctx.events, input = ctx.input;
  const S = (ctx.state.mr ??= {});
  S.T ??= { x: 0, y: TABLE_Y, z: -1.25, yaw: 0, s: S_DEFAULT };           // the table: centre on its surface (room metres), yaw, scale
  S.sBase ??= S.T.s;                                                      // preferred miniature scale (stepIn changes T.s temporarily)
  S.radius ??= RADIUS;
  S.mode ??= 'gods-table';
  S.placed ??= false;
  S.favs ??= null;
  const T = S.T;
  const clamp = THREE.MathUtils.clamp;
  const Y = new Vector3(0, 1, 0);
  const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

  // ------------------------------------------------------------------ the transform  game -> room = pos + s * Ry(yaw) * game
  const mat = new Matrix4(), inv = new Matrix4(), qY = new Quaternion(), qYi = new Quaternion(), sv = new Vector3(1, 1, 1), pv = new Vector3();
  let grow = 0;                                      // 0..1 grow-in of the stage (eased); MINI uses T.s * ease(grow)
  let sShow = 0.0001;
  function refreshT() {
    const g = grow < 1 ? grow * grow * (3 - 2 * grow) : 1;
    sShow = Math.max(1e-4, T.s * g);
    qY.setFromAxisAngle(Y, T.yaw); qYi.copy(qY).invert();
    pv.set(T.x, T.y, T.z); sv.setScalar(sShow);
    mat.compose(pv, qY, sv);
    inv.copy(mat).invert();
  }
  refreshT();
  const toRoom = (v, out = new Vector3()) => out.set(v.x, v.y, v.z).applyMatrix4(mat);
  const toGame = (v, out = new Vector3()) => out.set(v.x, v.y, v.z).applyMatrix4(inv);
  const dirToGame = (d, out = new Vector3()) => out.set(d.x, d.y, d.z).applyQuaternion(qYi);
  const dirToRoom = (d, out = new Vector3()) => out.set(d.x, d.y, d.z).applyQuaternion(qY);
  function rayToTable(origin, dir, out = new Vector3(), pad = 1.02) {
    toGame(origin, _a); dirToGame(dir, _b);
    if (_b.y > -1e-5) return null;
    const t = -_a.y / _b.y;
    if (t < 0) return null;
    out.copy(_a).addScaledVector(_b, t); out.y = 0;
    return Math.hypot(out.x, out.z) <= S.radius * pad ? out : null;
  }

  // ------------------------------------------------------------------ roots of the diorama
  const roomGroup = new Group(); roomGroup.name = 'mr-room'; roomGroup.userData.mrRoom = true; ctx.root.add(roomGroup);
  const stage = new Group(); stage.name = 'mr-stage'; ctx.root.add(stage);

  const env = {
    ctx, THREE, S, T, roomGroup, stage, world, events, input, parts: {}, features: { list: [], planes: false, meshes: false, anchors: false, hitTest: false, depth: false, hands: false },
    toGame, toRoom, dirToGame, dirToRoom, rayToTable, refreshT, clamp,
    get active() { return active; }, get simulated() { return !!S.simulated; }, get radius() { return S.radius; }, get inside() { return inside; },
    get vignette() { return vignette; }, get floorY() { return floorY; }, get sShow() { return sShow; }, get grow() { return grow; },
    mat, inv, qY, qYi,
    log: (...a) => { if (S.debug) console.log('[mr]', ...a); },
  };

  // ------------------------------------------------------------------ the render-time swap: the miniature transform is applied to renderables only
  // while drawing (scene.onBeforeRender .. onAfterRender), so ALL game logic keeps seeing identity-rooted game space: getWorldPosition, kit
  // damageable centres, Rapier, Raycaster, style.js blobs... Lights are scaled to match (intensity s^2, range s); kit's point-sprite emitters
  // get their pixel scale multiplied by s.
  const scene = ctx.scene;
  let swapped = false, swapN = 0, lightN = 0, active = false, inside = false, vignette = 0;
  const swapObj = [], swapSaved = [], lightObj = [], lightSaved = [];
  const prevBefore = scene.onBeforeRender, prevAfter = scene.onAfterRender;
  let disposed = false;
  function prep(o) {
    const u = o.userData;
    u._mr = true;
    if (o.castShadow) o.castShadow = false;            // the sun's shadow map (PC tier) is ~2 cm per texel: far too coarse for a 1.5 m table
    if (S.noOutlines !== false && o.isMesh) u.noOutline = true;
    if (o.isPoints && o.material && o.material.uniforms && o.material.uniforms.uPx) {
      const prev = o.onBeforeRender;
      o.onBeforeRender = function (...a) { prev.apply(this, a); if (swapped) this.material.uniforms.uPx.value *= sShow; };
    }
  }
  function pushRenderable(o) {
    if (!o._mrSaved) o._mrSaved = new Matrix4();
    swapObj[swapN++] = o;
    o._mrSaved.copy(o.matrixWorld);
    o.matrixWorld.premultiply(mat);
  }
  function pushLight(l) {
    const i = lightN++;
    lightObj[i] = l;
    (lightSaved[i] ??= { m: new Matrix4(), i: 0, d: 0 });
    const sv2 = lightSaved[i];
    sv2.m.copy(l.matrixWorld); sv2.i = l.intensity; sv2.d = l.distance;
    l.matrixWorld.premultiply(mat);
    l.intensity *= sShow * sShow;
    if (l.distance > 0) l.distance *= sShow;
  }
  function walk(o) {
    if (!o.visible || o.userData.mrRoom) return;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      if (!o.userData._mr) prep(o);
      pushRenderable(o);
    } else if (o.isLight) {
      if (o.isPointLight || o.isSpotLight) pushLight(o);
      return;
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) walk(ch[i]);
  }
  function restoreSwap() {
    for (let i = 0; i < swapN; i++) { const o = swapObj[i]; o.matrixWorld.copy(o._mrSaved); swapObj[i] = null; }
    swapN = 0;
    for (let i = 0; i < lightN; i++) {
      const l = lightObj[i], s = lightSaved[i];
      l.matrixWorld.copy(s.m); l.intensity = s.i; l.distance = s.d; lightObj[i] = null;
    }
    lightN = 0;
    swapped = false;
  }
  const isRoomRoot = (c) => c.name.startsWith('module:') && ROOM_MODULES.has(c.name.slice(7));
  function beforeRender(renderer, sc, camera) {
    if (swapped) restoreSwap();
    if (prevBefore && prevBefore !== beforeRender) prevBefore.call(sc, renderer, sc, camera);
    if (!active || disposed || sShow < 2e-4) return;
    const ch = scene.children;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (c === ctx.rig || c.userData.mrRoom) continue;
      if (c.name.startsWith('module:')) { if (!isRoomRoot(c)) walk(c); }
      else if (c.isLight && (c.isPointLight || c.isSpotLight)) pushLight(c);
    }
    swapped = true;
  }
  function afterRender(renderer, sc, camera) {
    if (swapped) restoreSwap();
    if (prevAfter && prevAfter !== afterRender) prevAfter.call(sc, renderer, sc, camera);
  }
  let hooked = false;
  function hook(on) {
    if (on && !hooked) { scene.onBeforeRender = beforeRender; scene.onAfterRender = afterRender; hooked = true; }
    else if (!on && hooked) {
      if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = prevBefore || (() => {});
      if (scene.onAfterRender === afterRender) scene.onAfterRender = prevAfter || (() => {});
      hooked = false;
    }
  }

  // ------------------------------------------------------------------ the ground: flat table, real floor past the edge
  let floorY = 0, realGround = null, groundFn = null, floorCol = null, physCol = null, physSaved = null, physChecked = 0, physWorld = null;
  function computeFloorY() { floorY = Math.min(0, -T.y / Math.max(T.s, S_MIN * 0.5)); }
  function installGround() {
    const cur = world.groundHeight;
    if (cur === groundFn || typeof cur !== 'function') return;
    realGround = cur;
    groundFn = function (x, z) {
      const r = Math.sqrt(x * x + z * z), R = S.radius;
      if (r <= R) return 0;
      if (r >= R + EDGE) return floorY;
      const t = (r - R) / EDGE;
      return floorY * t * t * (3 - 2 * t);
    };
    world.groundHeight = groundFn;
  }
  function removeGround() {
    if (groundFn && world.groundHeight === groundFn) { if (realGround) world.groundHeight = realGround; else delete world.groundHeight; }
    groundFn = null;
  }
  // The physics module keeps one huge flat plane as the floor in passthrough. Shrink it to the table disc and add a second plane at floor level.
  function findFlatTerrain(P) {
    let found = null;
    try {
      P.world.forEachCollider((c) => {
        if (found) return;
        let sh = null; try { sh = c.shape; } catch (e) { return; }
        if (sh && sh.halfExtents && sh.halfExtents.x > 300 && sh.halfExtents.z > 300 && sh.halfExtents.y <= 2) found = c;
      });
    } catch (e) { /* older rapier */ }
    return found;
  }
  function physicsGround(dt) {
    const P = world.physics;
    if (!P || !P.world || !P.rapier) return;
    const R = P.rapier;
    if (physWorld !== P.world) { physCol = null; floorCol = null; physSaved = null; physWorld = P.world; }
    const now = ctx.clock.t;
    try {
      if (physCol) {
        if (now - physChecked > 0.75) { physChecked = now; if (!P.world.getCollider(physCol.handle)) { physCol = null; floorCol = null; } }
      }
      if (!physCol) {
        if (now - physChecked < 0.2) return;
        physChecked = now;
        const c = findFlatTerrain(P);
        if (!c) return;
        const tr = c.translation();
        physSaved = { hx: c.shape.halfExtents.x, hy: c.shape.halfExtents.y, hz: c.shape.halfExtents.z, x: tr.x, y: tr.y, z: tr.z };
        c.setShape(new R.Cylinder(2, S.radius));
        c.setTranslation({ x: 0, y: -2, z: 0 });
        physCol = c;
        if (floorCol) { try { P.world.removeCollider(floorCol, false); } catch (e) { /* gone */ } floorCol = null; }
      }
      if (!floorCol) {
        const d = R.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, floorY - 1, 0).setFriction(0.9).setRestitution(0).setCollisionGroups(0x1ffff);
        floorCol = P.world.createCollider(d);
        floorCol._y = floorY;
      } else if (Math.abs(floorCol._y - floorY) > 0.005) {
        floorCol.setTranslation({ x: 0, y: floorY - 1, z: 0 }); floorCol._y = floorY;
      }
      const wantR = S.radius;
      if (Math.abs((physCol._r ?? wantR) - wantR) > 1e-3) { physCol.setShape(new R.Cylinder(2, wantR)); }
      physCol._r = wantR;
    } catch (err) { env.log('physics ground failed', err && err.message); }
  }
  function restorePhysics() {
    const P = world.physics;
    try {
      if (floorCol && P && P.world) P.world.removeCollider(floorCol, false);
      if (physCol && physSaved && P && P.world && P.world.getCollider(physCol.handle)) {
        physCol.setShape(new P.rapier.Cuboid(physSaved.hx, physSaved.hy, physSaved.hz));
        physCol.setTranslation({ x: physSaved.x, y: physSaved.y, z: physSaved.z });
      }
    } catch (err) { /* world gone */ }
    floorCol = null; physCol = null; physSaved = null;
  }

  // ------------------------------------------------------------------ the player as a tiny avatar
  // Enemies target world.player.damageable at the real head position, which in game space is the table centre. In the diorama the player is a god:
  // untouchable, ignored by enemy AI, not walking (the real room is the room). Stepping IN to life-size gives the player back their body.
  let saved = null;
  function applyAvatar() {
    const P = world.player;
    if (!P) return;
    if (!saved) saved = { enabled: P.enabled, inv: P.invulnerable, ray: P.showRay, ret: P.showReticle };
    P.enabled = false; P.showRay = false; P.showReticle = false;
    const d = P.damageable;
    if (inside) {
      if (P.invulnerable === true) P.invulnerable = saved.inv === true ? 0 : saved.inv;
      if (d && d.faction === 'neutral') d.faction = 'friendly';
    } else {
      P.invulnerable = true;
      if (d && d.faction !== 'neutral') d.faction = 'neutral';
    }
  }
  function restoreAvatar() {
    const P = world.player;
    if (P && saved) {
      P.enabled = saved.enabled; P.showRay = saved.ray; P.showReticle = saved.ret;
      P.invulnerable = saved.inv === true ? 0 : saved.inv;
      if (P.damageable) P.damageable.faction = 'friendly';
    }
    saved = null;
  }

  // ------------------------------------------------------------------ spells fire from the real fingertip INTO the diorama
  const wrappedSpells = new Set();
  function wrapSpells() {
    const e = world.spells && world.spells.current ? world.spells.current() : null;
    if (!e || typeof e.cast !== 'function' || e.cast.__mr) return;
    const orig = e.cast;
    const wrapped = function (args) {
      if (!active || disposed) return orig.call(this, args);
      const gate = env.parts.hands && env.parts.hands.gateCast ? env.parts.hands.gateCast(args) : 'convert';
      if (gate === 'suppress') return undefined;
      if (args && args.origin && args.direction) { toGame(args.origin, args.origin); dirToGame(args.direction, args.direction); }
      return orig.call(this, args);
    };
    wrapped.__mr = true; wrapped.__orig = orig;
    e.cast = wrapped;
    wrappedSpells.add(e);
  }
  function unwrapSpells() {
    for (const e of wrappedSpells) if (e.cast && e.cast.__mr) e.cast = e.cast.__orig;
    wrappedSpells.clear();
  }

  // ------------------------------------------------------------------ talking to a miniature NPC (voices.js decides in real space; we decide in game space)
  let npcWrapped = null;
  function wrapNpcProvider() {
    const cp = world.contextProviders;
    if (!cp || !cp.npc || cp.npc.__mr) return;
    const orig = cp.npc;
    const wrapped = function () {
      if (!active || disposed || inside) return orig();
      const h = env.parts.hands;
      if (!input.left.down.trigger) return orig();
      const a = h && h.talkTarget ? h.talkTarget() : null;
      if (!a) return null;
      const V = world.voices;
      try { return V && V.info ? V.info(a) : null; } catch (e) { return null; }
    };
    wrapped.__mr = true; wrapped.__orig = orig;
    cp.npc = wrapped; npcWrapped = wrapped;
  }
  function unwrapNpc() {
    const cp = world.contextProviders;
    if (cp && npcWrapped && cp.npc === npcWrapped) cp.npc = npcWrapped.__orig;
    npcWrapped = null;
  }
  const aimProvider = () => {
    if (!active) return null;
    const out = { miniature: true, scale: +(1 / Math.max(sShow, 1e-4)).toFixed(1), mode: S.mode, tableRadius: S.radius, note: 'the world is a diorama on a table; game units are life-size metres, y=0 is the table top' };
    const hh = env.parts.hands;
    const aim = hh && hh.aimPoint ? hh.aimPoint() : null;
    if (aim) out.aim = [+aim.x.toFixed(1), 0, +aim.z.toFixed(1)];
    return out;
  };

  // ------------------------------------------------------------------ session features
  function detectFeatures() {
    let list = [];
    try {
      const sess = ctx.renderer && ctx.renderer.xr && ctx.renderer.xr.getSession ? ctx.renderer.xr.getSession() : null;
      if (sess && sess.enabledFeatures) list = Array.from(sess.enabledFeatures);
    } catch (e) { list = []; }
    if (S.simFeatures) list = list.concat(S.simFeatures);
    const f = env.features;
    f.list = list;
    f.planes = list.includes('plane-detection'); f.meshes = list.includes('mesh-detection'); f.anchors = list.includes('anchors');
    f.hitTest = list.includes('hit-test'); f.depth = list.includes('depth-sensing'); f.hands = list.includes('hand-tracking');
    return f;
  }

  // ------------------------------------------------------------------ placement
  const DEFAULT_DIST = 1.25;
  function autoPlace() {
    const head = ctx.player.head, fwd = ctx.player.forward;
    let dx = fwd.x, dz = fwd.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.2) { dx = 0; dz = -1; } else { dx /= l; dz /= l; }
    const room = env.parts.room;
    const surf = room && room.pickSurface ? room.pickSurface(head, { x: dx, z: dz }) : null;
    if (surf) {
      T.x = surf.x; T.y = surf.y; T.z = surf.z;
      S.radius = clamp(surf.radius / Math.max(T.s, 0.01), 4, RADIUS);
      S.onSurface = true;
    } else {
      T.x = head.x + dx * DEFAULT_DIST; T.z = head.z + dz * DEFAULT_DIST; T.y = S.tableH ?? TABLE_Y;
      S.radius = RADIUS; S.onSurface = false;
    }
    T.yaw = 0; T.s = S.sBase;
    S.placed = true; S.placedAt = ctx.clock.t; S.userMoved = false;
    refreshT(); computeFloorY();
    events.emit('mr:place', { x: T.x, y: T.y, z: T.z, surface: S.onSurface });
    return snapshot();
  }
  const snapshot = () => ({ x: T.x, y: T.y, z: T.z, yaw: T.yaw, scale: T.s, radius: S.radius, surface: !!S.onSurface });
  function place(arg) {
    if (arg == null || arg === 'auto') return autoPlace();
    const p = arg.center ?? arg;
    if (typeof p.x !== 'number') return snapshot();
    T.x = p.x; T.z = p.z;
    if (typeof arg.y === 'number') T.y = arg.y; else if (typeof p.y === 'number') T.y = p.y;
    T.y = clamp(T.y, 0.3, 1.4);
    if (typeof arg.yaw === 'number') T.yaw = arg.yaw;
    const size = arg.size ?? arg.radius;
    S.radius = typeof size === 'number' ? clamp(size / Math.max(T.s, 0.01), 4, RADIUS) : RADIUS;
    S.tableH = T.y; S.placed = true; S.onSurface = !!arg.center || !!arg.surface;
    refreshT(); computeFloorY();
    events.emit('mr:place', { x: T.x, y: T.y, z: T.z, surface: S.onSurface });
    return snapshot();
  }
  function setScale(s) {
    s = clamp(+s || S_DEFAULT, S_MIN, S_MAX);
    S.sBase = s;
    if (!S.step) T.s = s;
    refreshT(); computeFloorY();
    return s;
  }
  function reset() {
    S.step = null; inside = false;
    S.sBase = S_DEFAULT; S.tableH = TABLE_Y;
    autoPlace();
    events.emit('mr:reset', {});
    return snapshot();
  }

  // ------------------------------------------------------------------ step in: the diorama grows to life-size around the player and back
  const STEP_TIME = 2.6;
  const pose = () => ({ x: T.x, y: T.y, z: T.z, yaw: T.yaw, s: T.s });
  function stepIn(on = true) {
    if (!active) return false;
    const going = S.step ? S.step.dir : 0;
    if (on) {
      if ((inside && !going) || going > 0) return false;
      if (!inside) S.stepHome = pose();
      S.step = { dir: 1, t: 0, from: pose(), to: { x: 0, y: 0, z: 0, yaw: 0, s: 1 } };
    } else {
      if ((!inside && !going) || going < 0) return false;
      const home = S.stepHome ?? { x: T.x, y: S.tableH ?? TABLE_Y, z: -DEFAULT_DIST, yaw: 0, s: S.sBase };
      S.step = { dir: -1, t: 0, from: pose(), to: { ...home, s: S.sBase } };
    }
    events.emit('mr:step', { in: !!on });
    return true;
  }
  function advanceStep(dt) {
    const st = S.step;
    if (!st) { vignette += (0 - vignette) * Math.min(1, dt * 6); return; }
    st.t += dt / STEP_TIME;
    const u = Math.min(1, st.t);
    const m = clamp((u - 0.28) / 0.44, 0, 1), e = m * m * (3 - 2 * m);
    T.x = st.from.x + (st.to.x - st.from.x) * e;
    T.y = st.from.y + (st.to.y - st.from.y) * e;
    T.z = st.from.z + (st.to.z - st.from.z) * e;
    let dy = st.to.yaw - st.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    T.yaw = st.from.yaw + dy * e;
    T.s = Math.exp(Math.log(st.from.s) + (Math.log(st.to.s) - Math.log(st.from.s)) * e);
    vignette = u < 0.28 ? (u / 0.28) * 0.92 : u < 0.72 ? 0.92 : (1 - (u - 0.72) / 0.28) * 0.92;
    inside = st.dir > 0 ? u > 0.5 : u < 0.5;
    if (u >= 1) {
      Object.assign(T, st.to);
      inside = st.dir > 0;
      if (!inside) S.stepHome = null;
      S.step = null; S.inside = inside; vignette = 0;
      events.emit('mr:stepped', { in: inside });
    }
  }

  // ------------------------------------------------------------------ lifecycle
  async function loadParts(force) {
    const bust = force ? Date.now() : (() => { try { return new URL(import.meta.url).searchParams.get('v') || '0'; } catch (e) { return '0'; } })();
    for (const name of PARTS) {
      if (env.parts[name]) { try { env.parts[name].dispose && env.parts[name].dispose(); } catch (e) { /* ignore */ } env.parts[name] = null; }
      try {
        const mod = await import(new URL(`../mr/${name}.js?v=${bust}`, import.meta.url).href);
        env.parts[name] = (await mod.default(env)) || {};
      } catch (err) {
        console.error(`[mr] part "${name}" failed to load`, err);
        env.parts[name] = null;
      }
    }
  }
  let placeIn = 0;
  function enter(simulated) {
    if (active) return;
    active = true;
    hook(true);
    detectFeatures();
    if (!simulated && S.simulated) S.simulated = false;
    grow = S.placed ? 1 : 0;
    placeIn = S.placed ? 0 : (ctx.input.presenting ? 0.45 : 0.1);
    if (!S.inside || S.placed === false) { S.step = null; inside = false; T.s = S.sBase; } else inside = true;
    vignette = 0;
    refreshT(); computeFloorY();
    installGround(); applyAvatar();
    for (const k of PARTS) { try { env.parts[k] && env.parts[k].enter && env.parts[k].enter(simulated); } catch (e) { console.error(`[mr] ${k}.enter`, e); } }
    if (S.placed) try { api.setMode(S.mode, true); } catch (e) { /* ignore */ }
    events.emit('mr:enter', { simulated: !!simulated, features: env.features.list });
  }
  function exit() {
    if (!active) return;
    for (const k of [...PARTS].reverse()) { try { env.parts[k] && env.parts[k].exit && env.parts[k].exit(); } catch (e) { console.error(`[mr] ${k}.exit`, e); } }
    active = false; inside = false; S.inside = false; S.step = null; vignette = 0;
    if (swapped) restoreSwap();
    hook(false);
    unwrapSpells(); unwrapNpc(); restoreAvatar(); removeGround(); restorePhysics();
    events.emit('mr:exit', {});
  }
  ctx.on('xr:start', (e) => { if (e && e.passthrough && !S.simulating) { S.simulated = false; S.placed = false; S.inside = false; enter(false); } });
  ctx.on('xr:end', () => { if (!S.simulated) exit(); });
  ctx.on('module:loaded', (e) => {
    if (!active || !e || typeof e.path !== 'string') return;
    // a creation just arrived: the Omnissiah points at where it landed on the table
    if (e.path.startsWith('creations/')) {
      const r = scene.getObjectByName('module:' + e.path);
      if (!r) return;
      const box = new THREE.Box3().setFromObject(r);
      if (box.isEmpty()) return;
      const c = box.getCenter(new Vector3());
      env.parts.stage && env.parts.stage.pulse && env.parts.stage.pulse(c, Math.min(6, box.getSize(new Vector3()).length() * 0.4 + 1.5));
      try { world.oracle && world.oracle.beamTo && world.oracle.beamTo(toRoom(c), { duration: 1.3 }); } catch (err) { /* optional */ }
    }
  });

  // ------------------------------------------------------------------ the service
  const api = {
    get active() { return active; },
    get simulated() { return !!S.simulated; },
    get inside() { return inside; },
    stage,
    get scale() { return T.s; },
    set scale(v) { setScale(v); },
    get radius() { return S.radius; },
    get tableHeight() { return T.y; },
    get yaw() { return T.yaw; },
    get features() { return env.features; },
    get mode() { return S.mode; },
    get score() { return env.parts.modes && env.parts.modes.score ? env.parts.modes.score() : 0; },
    get hands() { return env.parts.hands || null; },
    get sim() { return env.parts.sim || null; },
    get table() { return { x: T.x, y: T.y, z: T.z, yaw: T.yaw, scale: T.s, radius: S.radius }; },
    get matrix() { return mat; },
    toGame, toRoom, dirToGame, dirToRoom, rayToTable,
    modes() { return env.parts.modes && env.parts.modes.list ? env.parts.modes.list() : []; },
    setMode(name, quiet) {
      const m = env.parts.modes;
      if (!m || !m.set) { S.mode = name; return false; }
      const ok = m.set(name, quiet);
      if (ok) { S.mode = name; if (!quiet) events.emit('mr:mode', { mode: name }); }
      return ok;
    },
    toStage(thing) {
      const list = [];
      const add = (o) => { if (o && o.isObject3D) list.push(o); };
      if (!thing) return 0;
      if (thing.isObject3D) add(thing);
      else {
        if (Array.isArray(thing.objects)) thing.objects.forEach(add);
        add(thing.group); add(thing.object); add(thing.mesh); add(thing.root);
        if (Array.isArray(thing.actors)) thing.actors.forEach((a) => add(a && a.group));
        if (Array.isArray(thing.items)) thing.items.forEach((it) => { if (it && it.group) add(it.group); });
      }
      let n = 0;
      for (const o of list) {
        let p = o.parent, under = false;
        while (p) { if (p === stage || (p.name && p.name.startsWith('module:') && !isRoomRoot(p) && p.parent === scene)) { under = true; break; } p = p.parent; }
        if (!under) { stage.add(o); n++; }
      }
      return n;
    },
    place, reset, stepIn,
    setScaleBase: setScale,
    simulate(on = true) {
      const s = env.parts.sim;
      if (!s) { console.warn('[mr] simulation part is not loaded'); return false; }
      return s.simulate(!!on);
    },
    reload() { return loadParts(true); },
    groundHeight: (x, z) => (groundFn ? groundFn(x, z) : 0),
    get floorY() { return floorY; },
    _env: env,
  };
  ctx.provide('mr', api);
  if (world.contextProviders) { world.contextProviders.mr = aimProvider; ctx.onDispose(() => { if (world.contextProviders && world.contextProviders.mr === aimProvider) delete world.contextProviders.mr; }); }

  await loadParts(false);
  // loaded (or hot-reloaded) inside a running session
  if (input.passthrough || S.simulated) { if (S.simulated && env.parts.sim && env.parts.sim.resume) env.parts.sim.resume(); enter(!!S.simulated); }

  return {
    update(dt, t) {
      if (swapped) restoreSwap();                              // a render that threw between the hooks must not leave matrices swapped
      const want = !!input.passthrough || !!S.simulated;
      if (want !== active) { if (want) enter(!!S.simulated); else exit(); }
      if (!active) return;
      if (placeIn > 0) {
        placeIn -= dt;
        if (placeIn <= 0) { autoPlace(); grow = 0; try { api.setMode(S.mode, true); } catch (e) { /* ignore */ } }
      } else if (grow < 1 && S.placed) grow = Math.min(1, grow + dt / 0.7);
      advanceStep(dt);
      refreshT(); computeFloorY();
      installGround(); applyAvatar(); wrapSpells(); wrapNpcProvider();
      physicsGround(dt);
      for (const k of PARTS) {
        const p = env.parts[k];
        if (!p || !p.update) continue;
        try { p.update(dt, t); } catch (err) { console.error(`[mr] ${k}.update failed; disabled`, err); p.update = null; }
      }
    },
    dispose() {
      disposed = true;
      exit();
      for (const k of [...PARTS].reverse()) { try { env.parts[k] && env.parts[k].dispose && env.parts[k].dispose(); } catch (e) { /* ignore */ } }
      hook(false);
      unwrapSpells(); unwrapNpc(); removeGround(); restorePhysics();
    },
  };
}
