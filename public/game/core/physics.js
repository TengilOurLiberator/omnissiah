// core/physics.js — world.physics: ONE Rapier world (WASM) for rigid bodies, ragdolls, vehicles, characters, raycasts.
// If it failed to load, world.physics is ABSENT: always guard (const P = ctx.world.physics; if (!P) ...). kit.body / kit.humanoid already use it.
//   Fixed 60 Hz step (<= 2 per frame), gravity -9.8, render transforms interpolated. Terrain = a heightfield patch rebuilt around the
//   player (flat plane in mixed reality). Everything made through YOUR ctx is removed with your creation. Prefer kit.body for props;
//   use this directly for crates, ragdoll-ish contraptions, cars, ropes, doors, wrecking balls.
// BODIES  const h = P.body(ctx, object3D, { shape, size, mass, friction, restitution, type, ccd, sensor, linearDamping, angularDamping,
//                                             gravityScale, rotate, group, position, sleepy, recycle })      -> handle | null (over budget!)
//   shape 'auto' (default: box of the object's bounds; Sphere/Cylinder/CapsuleGeometry pick their own) | 'box' size [w,h,d] full extents
//   | 'sphere' size r | 'capsule' size [r, totalHeight] | 'cylinder' size [r, height] | 'hull' (convex hull of the geometry)
//   | 'mesh' (triangle mesh; FIXED bodies only, <= 4000 tris). Omit size to fit the object's bounds. type 'dynamic' (default; the object
//   follows physics) | 'fixed' (scenery) | 'kinematic' (the physics follows the OBJECT: move it yourself, it shoves dynamic bodies).
//   mass kg (1), friction 0.6, restitution 0.15. group: 'default' | 'debris' | 'ragdoll' | 'world' (fixed default) | 'prop' (scenery that characters walk through). ccd:true only for fast small things.
//   rotate:false locks rotation (the object's orientation stays yours). The object is put under ctx.root if it is not already there.
//   h = { object, body (Rapier RigidBody), collider, position, quaternion, velocity (latest sim state, Vector3/Quaternion), mass, type,
//     applyImpulse(x,y,z | v3), applyImpulseAt(imp, point), applyTorque(x,y,z), setVelocity(x,y,z | v3), setAngularVelocity(x,y,z),
//     setTransform(pos, quat?) (teleport), setType('dynamic'|'fixed'|'kinematic'), follow(pos, quat?) (kinematic target you steer),
//     onContact(fn) -> fn({ other (handle|null), kind: 'ground'|'static'|'body', speed, point, normal }) (impacts > 0.8 m/s),
//     sleep(), wake(), remove(), removed, asleep, grounded }
//   Bodies far from the player (outside the terrain patch) freeze and wake when it comes back. Dynamic bodies are capped by tier
//   (P.caps.dynamic: 150 quest / 600 pc): P.body returns null beyond that — fall back to something cheap. Debris-group bodies are recycled.
// JOINTS  P.joint(a, b, { type: 'fixed'|'spherical'|'revolute'|'prismatic'|'rope'|'spring', anchors: [localA, localB] | anchor: worldPoint,
//           axis: [x,y,z] (revolute/prismatic, local), limits: [min, max], motor: { target, velocity, stiffness, damping },
//           length (rope, spring rest), stiffness, damping, contacts: false (bodies of the joint do not collide) }) -> { joint, remove() }
//   a or b may be null = pinned to the world. Joints vanish with their bodies.
// QUERIES P.raycast(origin, dir, maxDist = 100, { exclude: handle, groups: 'world'|'all' }) -> { point, normal, distance, handle, kind }|null
//           (the result object is REUSED by the next call: copy what you keep)   P.overlapSphere(point, r) -> handles (reused array)
//           P.explode(point, radius, strength = 20): radial impulse on every body/ragdoll part in range (falloff; wakes them) -> count
//           P.groundAt(x, z) is world.groundHeight; P.inside(x, z) true if the heightfield patch covers (x, z)
// CHARACTER  const ch = P.character(ctx, { radius = 0.3, height = 1.7, stepHeight = 0.35, maxSlope = 55 })  kinematic capsule for walkers:
//           ch.move(dx, dy, dz) -> slides/auto-steps through buildings and props (no gravity: you add dy), then ch.position (feet,
//           Vector3), ch.grounded, ch.teleport(x,y,z), ch.remove(). Offer to player.js: move the rig by what ch.move allows.
// VEHICLE   const car = P.vehicle(ctx, chassisObject, { size:[w,h,d], mass = 900, forward: '-z'|'+z', wheels: [{ position:[x,y,z] (chassis
//           local, where the suspension is hung), radius, steer:true, drive:true, brake:true, object: Group (gets position+steer yaw),
//           spin: Object3D (gets the roll) }], engineForce = mass*4 (total N, split over the driven wheels), maxSteer = 0.5, brakeForce = 60 })  car.setInput({ throttle -1..1,
//           steer -1..1, brake 0..1 })   car.speed  car.body  car.handle  car.remove()    (Rapier raycast-vehicle controller)
// RAGDOLL   P.ragdoll(ctx, { parts: [{ name, parent, pos, quat, shape, size, center, mass, joint: { anchor, type, axis, limits, cone },
//           apply(handle) }], velocity }) — used by kit for dead actors; returns { parts, freeze(), remove(), settled }.
// MISC      P.stats() { bodies, awake, dynamic, fixed, ragdolls, joints, stepMs, ... }   P.debug(true|false) draws colliders (lines)
//           P.caps (mutable limits)  P.pressure (0..1: how close the step time is to its budget: spawn fewer things when high)
//           P.step(dt) is what update() calls (for tests)   P.rapier (the module)   P.world (the Rapier World)

export const meta = { name: 'Physics', description: 'Rapier rigid-body world: bodies, joints, ragdolls, vehicles, characters, raycasts.' };

const FIXED = 1 / 60;
const GRAV = 9.8;
const ig = (m, f) => (((m & 0xffff) << 16) | (f & 0xffff)) >>> 0;
const G_WORLD = 1, G_DYN = 2, G_DEBRIS = 4, G_RAG = 8, G_CHAR = 16, G_PROP = 64; // G_PROP: scenery that walkers (characters) walk through but things still hit

export default async function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Quaternion, Matrix4, Box3 } = THREE;
  const S = ctx.state;
  const quest = () => !!ctx.quality && ctx.quality.tier === 'quest';

  // ------------------------------------------------------------------ load Rapier once (the module is cached; init must run once)
  let R;
  try {
    const g = (globalThis.__omniRapier ??= {});
    g.mod ??= await import('/vendor/rapier/dist/rapier.mjs');
    R = g.mod;
    g.init ??= R.init();
    try { await g.init; } catch (err) { g.init = null; throw err; }
  } catch (err) {
    console.warn('[physics] Rapier unavailable; kit keeps its built-in simulation:', err && err.message ? err.message : err);
    return {};
  }

  // ------------------------------------------------------------------ persistent state (survives hot reload)
  let W = S.world;
  if (!W) {
    W = S.world = new R.World({ x: 0, y: -GRAV, z: 0 });
    W.timestep = FIXED;
    W.numSolverIterations = 4;
    S.queue = new R.EventQueue(true);
  }
  S.list ??= []; S.awake ??= []; S.byBody ??= new Map(); S.byCol ??= new Map(); S.rags ??= []; S.chars ??= []; S.vehs ??= []; S.joints ??= [];
  S.acc ??= 0; S.stepId ??= 0; S.seq ??= 0; S.simTime ??= 0;
  S.terr ??= { col: null, cx: 0, cz: 0, half: 0, flat: false, rebuilds: 0, buf: null, sample: 0, ms: 0, active: false };
  S.stat ??= { stepMs: 0, maxStepMs: 0, steps: 0, ema: 0, frames: 0, events: 0 };
  S.counts ??= { dynamic: 0, fixed: 0, kinematic: 0, debris: 0 };
  S.counts.debris ??= 0;
  S.proto ??= {};
  S.caps ??= {};
  S.pressure ??= 0;
  const T = S.terr, ST = S.stat, CNT = S.counts;
  const caps = Object.assign(S.caps, quest()
    ? { dynamic: 150, awake: 100, debris: 36, parts: 10, ragdolls: 6, characters: 10, stepMs: 2.0 }
    : { dynamic: 600, awake: 400, debris: 160, parts: 36, ragdolls: 20, characters: 28, stepMs: 4.0 });
  ctx.on('quality:changed', () => {
    Object.assign(caps, quest()
      ? { dynamic: 150, awake: 100, debris: 36, parts: 10, ragdolls: 6, characters: 10, stepMs: 2.0 }
      : { dynamic: 600, awake: 400, debris: 160, parts: 36, ragdolls: 20, characters: 28, stepMs: 4.0 });
  });

  // ------------------------------------------------------------------ scratch (no per-frame allocation in steady state)
  const rv = { x: 0, y: 0, z: 0 }, rv2 = { x: 0, y: 0, z: 0 }, rw = { x: 0, y: 0, z: 0 }, rq = { x: 0, y: 0, z: 0, w: 1 };
  const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _m = new Matrix4(), _m2 = new Matrix4(), _b = new Box3(), _b2 = new Box3();
  const _v1 = new Vector3(), _v2 = new Vector3(), _q1 = new Quaternion(), _q2 = new Quaternion();
  const rayR = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const RES = { point: new Vector3(), normal: new Vector3(), distance: 0, handle: null, kind: 'static', object: null };
  const OVL = [];
  const dropFrom = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); } };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const GR = {
    world: ig(G_WORLD, 0xffff),
    prop: ig(G_PROP, 0xffff & ~G_CHAR),
    default: ig(G_DYN, G_WORLD | G_PROP | G_DYN | G_DEBRIS | G_RAG | G_CHAR),
    debris: ig(G_DEBRIS, G_WORLD | G_PROP | G_DYN | G_RAG | G_CHAR | (quest() ? 0 : G_DEBRIS)),
    ragdoll: ig(G_RAG, G_WORLD | G_PROP | G_DYN | G_CHAR),
    char: ig(G_CHAR, G_WORLD | G_DYN | G_RAG),
  };
  const QMASK = { world: G_WORLD | G_PROP, all: G_WORLD | G_PROP | G_DYN | G_RAG | G_CHAR, default: G_WORLD | G_PROP | G_DYN | G_RAG | G_CHAR, dynamic: G_DYN | G_RAG };

  // ------------------------------------------------------------------ terrain: heightfield patch around the player / flat plane in MR
  const groundAt = (x, z) => ctx.groundAt(x, z);
  const passthrough = () => !!(ctx.input && ctx.input.passthrough);
  function killTerrain() {
    if (T.col) { try { S.byCol.delete(T.col.handle); W.removeCollider(T.col, false); } catch (err) { /* gone */ } T.col = null; }
  }
  function buildTerrain(cx, cz, flat) {
    const t0 = nowMs();
    const old = T.col;
    let desc;
    if (flat) {
      desc = R.ColliderDesc.cuboid(400, 1, 400).setTranslation(cx, -1, cz);
      T.half = 400;
    } else {
      const cell = 1.0, cells = quest() ? 80 : 128, n = cells + 1, size = cells * cell;
      if (!T.buf || T.buf.length !== n * n) T.buf = new Float32Array(n * n);
      const h = T.buf, x0 = cx - size / 2, z0 = cz - size / 2;
      for (let ix = 0; ix < n; ix++) {
        const x = x0 + ix * cell;
        for (let iz = 0; iz < n; iz++) h[ix * n + iz] = groundAt(x, z0 + iz * cell);
      }
      desc = R.ColliderDesc.heightfield(cells, cells, h, { x: size, y: 1, z: size }).setTranslation(cx, 0, cz);
      T.half = size / 2;
    }
    desc.setFriction(0.9).setRestitution(0.0).setCollisionGroups(GR.world);
    const col = W.createCollider(desc);
    T.col = col; T.cx = cx; T.cz = cz; T.flat = flat; T.rebuilds++; T.sample = groundAt(cx + 3.3, cz - 2.1);
    S.byCol.set(col.handle, TERRAIN);
    if (old) { try { S.byCol.delete(old.handle); W.removeCollider(old, false); } catch (err) { /* gone */ } }
    T.ms = nowMs() - t0; T.active = true;
    for (const h of S.list) if (h.frozen && h.type === 'dynamic') maybeThaw(h);
  }
  const TERRAIN = { terrain: true, id: -1, type: 'fixed' };
  function maintainTerrain() {
    const rig = ctx.rig ? ctx.rig.position : null;
    const px = rig ? rig.x : 0, pz = rig ? rig.z : 0;
    const pt = passthrough();
    if (!T.col) { buildTerrain(Math.round(px / 8) * 8, Math.round(pz / 8) * 8, pt); return; }
    if (pt !== T.flat) { buildTerrain(Math.round(px / 8) * 8, Math.round(pz / 8) * 8, pt); return; }
    if (pt) return;
    const lim = quest() ? 14 : 28;
    if (Math.abs(px - T.cx) > lim || Math.abs(pz - T.cz) > lim) { buildTerrain(Math.round(px / 8) * 8, Math.round(pz / 8) * 8, false); return; }
    // Travel reshapes the terrain (world.js emits world:terrain-changed, possibly every frame of a cross-fade):
    // rebuild at most a few times a second while it changes, and once more when it settles.
    if (S.terrainDirty && (S.stat.frames & 15) === 0) { S.terrainDirty = false; buildTerrain(T.cx, T.cz, false); return; }
    if (((S.stat.frames + 7) & 127) === 0 && Math.abs(groundAt(T.cx + 3.3, T.cz - 2.1) - T.sample) > 0.03) buildTerrain(T.cx, T.cz, false); // terrain changed under us
  }
  const inPatch = (x, z, m = 2) => T.flat || (Math.abs(x - T.cx) < T.half - m && Math.abs(z - T.cz) < T.half - m);

  // ------------------------------------------------------------------ handles
  const P = S.proto;
  function reg(h) {
    h._li = S.list.length; S.list.push(h);
    S.byBody.set(h.body.handle, h);
    S.byCol.set(h.collider.handle, h);
    CNT[h.type]++;
    if (h.group === 'debris') CNT.debris++;
  }
  function unreg(h) {
    const i = h._li, last = S.list[S.list.length - 1];
    S.list[i] = last; last._li = i; S.list.pop();
    S.byBody.delete(h.body.handle); S.byCol.delete(h.collider.handle);
    CNT[h.type]--;
    if (h.group === 'debris') CNT.debris--;
    if (h.awake) { dropFrom(S.awake, h); h.awake = false; }
  }
  function localBounds(obj, out) {
    out.makeEmpty();
    obj.updateWorldMatrix(true, true);
    _m2.copy(obj.matrixWorld).invert();
    obj.traverse((m) => {
      if (!m.isMesh || !m.geometry || m.visible === false) return;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox || g.boundingBox.isEmpty()) return;
      _b2.copy(g.boundingBox).applyMatrix4(_m.multiplyMatrices(_m2, m.matrixWorld));
      out.union(_b2);
    });
    return out;
  }
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const arr3 = (s, d) => (typeof s === 'number' ? [s, s, s] : Array.isArray(s) ? [num(s[0], d[0]), num(s[1], num(s[0], d[1])), num(s[2], num(s[0], d[2]))] : s && typeof s === 'object' && 'x' in s ? [s.x, s.y, s.z] : d);
  // collect convex-hull / trimesh points of an object in its own local frame, scaled
  function gatherPoints(obj, scl, maxPts, wantIndex) {
    obj.updateWorldMatrix(true, true);
    _m2.copy(obj.matrixWorld).invert();
    const pts = [], idx = [];
    obj.traverse((m) => {
      if (!m.isMesh || !m.geometry || m.visible === false || m.isInstancedMesh) return;
      const pa = m.geometry.attributes.position; if (!pa) return;
      _m.multiplyMatrices(_m2, m.matrixWorld);
      const base = pts.length / 3, step = wantIndex ? 1 : Math.max(1, Math.floor(pa.count / maxPts));
      for (let i = 0; i < pa.count; i += step) {
        _v1.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(_m);
        pts.push(_v1.x * scl.x, _v1.y * scl.y, _v1.z * scl.z);
      }
      if (wantIndex) {
        const ix = m.geometry.index;
        if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i)); else for (let i = 0; i < pa.count; i++) idx.push(base + i);
      }
    });
    return { pts, idx };
  }
  const SHAPES = ['auto', 'box', 'sphere', 'capsule', 'cylinder', 'hull', 'mesh'];
  function colliderDesc(obj, o, type, scl, info) {
    let shape = SHAPES.includes(o.shape) ? o.shape : 'auto';
    const bb = obj ? localBounds(obj, _b) : _b.makeEmpty();
    const empty = bb.isEmpty();
    const sz = empty ? [0.4, 0.4, 0.4] : [(bb.max.x - bb.min.x) * scl.x, (bb.max.y - bb.min.y) * scl.y, (bb.max.z - bb.min.z) * scl.z];
    const ctr = empty ? [0, 0, 0] : [(bb.max.x + bb.min.x) * 0.5 * scl.x, (bb.max.y + bb.min.y) * 0.5 * scl.y, (bb.max.z + bb.min.z) * 0.5 * scl.z];
    if (shape === 'auto') {
      shape = 'box';
      const gt = obj && obj.geometry && obj.geometry.type;
      if (gt === 'SphereGeometry' || gt === 'IcosahedronGeometry' || gt === 'OctahedronGeometry') shape = 'sphere';
      else if (gt === 'CylinderGeometry') shape = 'cylinder';
      else if (gt === 'CapsuleGeometry') shape = 'capsule';
    }
    if (shape === 'mesh' && type !== 'fixed') shape = 'hull';
    let desc = null, off = o.center ? arr3(o.center, [0, 0, 0]) : ctr;
    const hasSize = o.size !== undefined && o.size !== null;
    switch (shape) {
      case 'sphere': {
        const r = Math.max(0.02, hasSize ? num(Array.isArray(o.size) ? o.size[0] : o.size, 0.2) : num(o.radius, Math.max(sz[0], sz[1], sz[2]) * 0.5));
        desc = R.ColliderDesc.ball(r); info.r = r; break;
      }
      case 'capsule': {
        const a = hasSize ? (Array.isArray(o.size) ? o.size : [o.size.radius ?? 0.2, o.size.height ?? 1]) : [Math.min(sz[0], sz[2]) * 0.5, sz[1]];
        const r = Math.max(0.02, a[0]), hh = Math.max(0, a[1] * 0.5 - r);
        desc = R.ColliderDesc.capsule(hh, r); info.r = r; info.hh = hh; break;
      }
      case 'cylinder': {
        const a = hasSize ? (Array.isArray(o.size) ? o.size : [o.size.radius ?? 0.2, o.size.height ?? 1]) : [Math.min(sz[0], sz[2]) * 0.5, sz[1]];
        desc = R.ColliderDesc.cylinder(Math.max(0.02, a[1] * 0.5), Math.max(0.02, a[0])); info.r = a[0]; info.hh = a[1] * 0.5; break;
      }
      case 'hull': case 'mesh': {
        if (obj) {
          if (shape === 'mesh') {
            const g = gatherPoints(obj, scl, 0, true);
            if (g.idx.length >= 3 && g.idx.length <= 12000) desc = R.ColliderDesc.trimesh(new Float32Array(g.pts), new Uint32Array(g.idx));
          } else {
            const g = gatherPoints(obj, scl, 64, false);
            if (g.pts.length >= 12) desc = R.ColliderDesc.convexHull(new Float32Array(g.pts));
          }
          if (desc) { off = [0, 0, 0]; info.hull = true; }
        }
        if (!desc) shape = 'box';
        if (desc) break;
      } // falls through to box when no hull could be built
      // eslint-disable-next-line no-fallthrough
      default: {
        const s = hasSize ? arr3(o.size, [0.4, 0.4, 0.4]) : sz;
        info.hx = Math.max(0.01, s[0] * 0.5); info.hy = Math.max(0.01, s[1] * 0.5); info.hz = Math.max(0.01, s[2] * 0.5);
        desc = R.ColliderDesc.cuboid(info.hx, info.hy, info.hz);
      }
    }
    info.shape = shape;
    if (off && (off[0] || off[1] || off[2])) desc.setTranslation(off[0], off[1], off[2]);
    return desc;
  }

  const CHUNK_LIFE = 14;
  function evictOne() { // free a dynamic slot: the oldest recyclable (debris) body
    let best = null;
    for (let i = 0; i < S.list.length; i++) {
      const h = S.list[i];
      if (h.recycle && h.type === 'dynamic' && !h.noEvict && (!best || h.born < best.born)) best = h;
    }
    if (!best) return false;
    best.remove();
    return true;
  }

  function body(c, object, o = {}) {
    if (!W) return null;
    const type = o.type === 'fixed' || o.type === 'kinematic' ? o.type : 'dynamic';
    const recycle = o.recycle ?? (o.group === 'debris');
    if (type === 'dynamic' && CNT.dynamic >= caps.dynamic && !evictOne()) return null;
    if (type === 'fixed' && CNT.fixed >= 2500) return null;
    const scl = _s;
    let pos, quat;
    if (object) {
      if (!object.parent && (c.root || ctx.root)) (c.root ?? ctx.root).add(object);
      if (type === 'dynamic' && object.parent && object.parent !== (c.root ?? ctx.root) && object.parent !== ctx.scene) (c.root ?? ctx.root).attach(object);
      object.updateWorldMatrix(true, false);
      object.matrixWorld.decompose(_p, _q, scl);
      pos = o.position ? _p.set(o.position.x, o.position.y, o.position.z) : _p;
      quat = _q;
    } else {
      pos = _p.set(o.position ? o.position.x : 0, o.position ? o.position.y : 0, o.position ? o.position.z : 0);
      quat = o.quaternion ? _q.set(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w) : _q.set(0, 0, 0, 1); scl.set(1, 1, 1);
    }
    const bd = type === 'fixed' ? R.RigidBodyDesc.fixed() : type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic();
    bd.setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    if (type === 'dynamic') {
      bd.setLinearDamping(num(o.linearDamping, 0.05)).setAngularDamping(num(o.angularDamping, o.shape === 'sphere' ? 3 : 0.6));
      if (o.gravityScale !== undefined) bd.setGravityScale(o.gravityScale);
      if (o.ccd) bd.setCcdEnabled(true);
      else if (o.softCcd) bd.setSoftCcdPrediction(o.softCcd);
      if (o.rotate === false) bd.lockRotations();
      if (o.canSleep === false) bd.setCanSleep(false);
    }
    const info = {};
    const cd = colliderDesc(object, o, type, scl, info);
    const mass = type === 'dynamic' ? Math.max(0.01, num(o.mass, 1)) : 1;
    if (type === 'dynamic') { cd.setMass(mass); if (o.angularDamping === undefined && info.shape === 'sphere') bd.setAngularDamping(0.8); }
    cd.setFriction(num(o.friction, 0.6)).setRestitution(num(o.restitution, 0.15));
    if (o.sensor) cd.setSensor(true);
    const gname = o.group && GR[o.group] ? o.group : type === 'fixed' ? 'world' : 'default';
    cd.setCollisionGroups(GR[gname]);
    const rb = W.createRigidBody(bd);
    const col = W.createCollider(cd, rb);
    const h = Object.create(P);
    h.id = ++S.seq; h.object = object; h.body = rb; h.collider = col; h.type = type; h.mass = mass; h.ctx = c; h.info = info; h.group = gname;
    h.parent0 = object ? object.parent : null;
    h.removed = false; h.awake = false; h.frozen = false; h.recycle = recycle; h.born = S.simTime; h.noEvict = false; h.sleepy = o.sleepy !== false && o.canSleep !== false;
    h.rotate = o.rotate !== false; h.sync = o.sync !== false; h.drive = type === 'dynamic' && !!object && h.sync; h.fromObject = type === 'kinematic' && !!object && o.follow !== true;
    h.position = new Vector3(pos.x, pos.y, pos.z); h.quaternion = new Quaternion(quat.x, quat.y, quat.z, quat.w);
    h.velocity = new Vector3(); h.angularVelocity = new Vector3();
    h.rp = new Vector3(pos.x, pos.y, pos.z); h.rq = new Quaternion(quat.x, quat.y, quat.z, quat.w);
    h.p0 = new Vector3(pos.x, pos.y, pos.z); h.q0 = new Quaternion(quat.x, quat.y, quat.z, quat.w); // previous step (interpolation)
    h.pv = new Vector3(); // velocity before the last step (impact speed)
    h.tp = new Vector3(); h.tq = new Quaternion(); h.hasT = false;
    h.restT = 0; h.contacts = 0; h.fns = null; h.user = null; h.onPose = null; h.rag = null; h.grounded = false; h.stamp = 0; h.onKilled = null;
    h.t0 = 0; h.slow = false; h.angDamp = num(o.angularDamping, info.shape === 'sphere' ? 0.8 : 0.6); h.linDamp = num(o.linearDamping, 0.05); h.rollDamp = type === 'dynamic' && info.shape === 'sphere' && o.rollDamping !== false;
    reg(h);
    if (type === 'dynamic') { h.awake = true; S.awake.push(h); }
    if (c && c.onDispose) c.onDispose(() => h.remove());
    return h;
  }

  Object.defineProperty(P, 'asleep', { get() { return !this.removed && this.body.isSleeping(); }, configurable: true, enumerable: false });
  Object.assign(P, {
    applyImpulse(x, y, z) {
      if (x && typeof x === 'object') { z = x.z; y = x.y; x = x.x; }
      if (this.removed || this.type !== 'dynamic') return this;
      rv.x = x; rv.y = y; rv.z = z; this.body.applyImpulse(rv, true); return this;
    },
    applyImpulseAt(imp, point) {
      if (this.removed || this.type !== 'dynamic') return this;
      rv.x = imp.x; rv.y = imp.y; rv.z = imp.z; rv2.x = point.x; rv2.y = point.y; rv2.z = point.z;
      this.body.applyImpulseAtPoint(rv, rv2, true); return this;
    },
    applyTorque(x, y, z) {
      if (x && typeof x === 'object') { z = x.z; y = x.y; x = x.x; }
      if (this.removed || this.type !== 'dynamic') return this;
      rv.x = x; rv.y = y; rv.z = z; this.body.applyTorqueImpulse(rv, true); return this;
    },
    setVelocity(x, y, z) {
      if (x && typeof x === 'object') { z = x.z; y = x.y; x = x.x; }
      if (this.removed || this.type !== 'dynamic') return this;
      rv.x = x; rv.y = y; rv.z = z; this.body.setLinvel(rv, true);
      this.velocity.set(x, y, z); this.pv.set(x, y, z);
      return this;
    },
    setAngularVelocity(x, y, z) {
      if (x && typeof x === 'object') { z = x.z; y = x.y; x = x.x; }
      if (this.removed || this.type !== 'dynamic') return this;
      rv.x = x; rv.y = y; rv.z = z; this.body.setAngvel(rv, true); this.angularVelocity.set(x, y, z);
      return this;
    },
    setTransform(pos, quat) { // teleport (no interpolation)
      if (this.removed) return this;
      rv.x = pos.x; rv.y = pos.y; rv.z = pos.z; this.body.setTranslation(rv, true);
      this.position.set(pos.x, pos.y, pos.z); this.p0.copy(this.position); this.rp.copy(this.position);
      if (quat) { rq.x = quat.x; rq.y = quat.y; rq.z = quat.z; rq.w = quat.w; this.body.setRotation(rq, true); this.quaternion.copy(quat); this.q0.copy(quat); this.rq.copy(quat); }
      if (this.type === 'kinematic') { this.tp.copy(this.position); this.hasT = false; }
      if (this.object && this.drive) { this.object.position.copy(this.rp); if (this.rotate) this.object.quaternion.copy(this.rq); }
      S.needProp = true;
      return this;
    },
    follow(pos, quat) { // kinematic target: the body is moved to it on the next step (and shoves things on the way)
      if (this.removed) return this;
      this.tp.set(pos.x, pos.y, pos.z);
      if (quat) this.tq.set(quat.x, quat.y, quat.z, quat.w); else this.tq.copy(this.quaternion);
      if (!this.hasT) { this.setTransform(this.tp, this.tq); }
      this.hasT = true;
      return this;
    },
    setType(type) {
      if (this.removed || this.type === type || !(type === 'dynamic' || type === 'kinematic' || type === 'fixed')) return this;
      CNT[this.type]--; CNT[type]++;
      const was = this.type; this.type = type;
      this.body.setBodyType(type === 'dynamic' ? R.RigidBodyType.Dynamic : type === 'fixed' ? R.RigidBodyType.Fixed : R.RigidBodyType.KinematicPositionBased, true);
      this.hasT = false;
      if (type === 'dynamic') {
        this.drive = !!this.object && this.sync !== false; this.fromObject = false;
        if (!this.awake) { this.awake = true; S.awake.push(this); }
        this.p0.copy(this.position); this.q0.copy(this.quaternion);
      } else { this.drive = false; if (this.awake) { dropFrom(S.awake, this); this.awake = false; } }
      if (type === 'kinematic' && was === 'dynamic') this.velocity.set(0, 0, 0);
      return this;
    },
    setGravityScale(s) { if (!this.removed) this.body.setGravityScale(s, true); return this; },
    setDamping(lin, ang) { if (this.removed) return this; if (lin !== undefined) this.body.setLinearDamping(lin); if (ang !== undefined) this.body.setAngularDamping(ang); return this; },
    setFriction(f) { if (!this.removed) this.collider.setFriction(f); return this; },
    setRestitution(r) { if (!this.removed) this.collider.setRestitution(r); return this; },
    onContact(fn) {
      if (this.removed || typeof fn !== 'function') return this;
      (this.fns ??= []).push(fn);
      this.collider.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      return this;
    },
    sleep() { // settle it: stop it dead and let the engine put it to sleep (forcing sleep on a live island misbehaves)
      if (this.removed || this.type !== 'dynamic') return this;
      rv.x = rv.y = rv.z = 0; this.body.setLinvel(rv, false); this.body.setAngvel(rv, false); this.body.setLinearDamping(4); this.body.setAngularDamping(8); this.slow = true; return this;
    },
    wake() { if (!this.removed) { this.body.wakeUp(); this.restT = 0; if (this.frozen) maybeThaw(this); } return this; },
    remove() { removeHandle(this); },
  });
  function removeHandle(h) {
    if (h.removed) return;
    h.removed = true;
    if (h.veh) { const v = h.veh; h.veh = null; v.remove(); } // a vehicle's chassis: the controller goes first (it would update a freed body on the next step)
    if (h.rag) { dropFrom(h.rag.list, h); }
    unreg(h);
    try { if (W.getRigidBody(h.body.handle)) W.removeRigidBody(h.body); } catch (err) { /* gone */ }
    h.fns = null; h.onPose = null; h.user = null;
  }
  function maybeThaw(h) {
    if (h.removed || !h.frozen) return;
    if (!inPatch(h.position.x, h.position.z, 4)) return;
    h.frozen = false; h.body.setEnabled(true); h.body.wakeUp();
  }

  // ------------------------------------------------------------------ joints
  function joint(a, b, o = {}) {
    if (!W) return null;
    const ba = a ? a.body : (S.anchorBody ??= W.createRigidBody(R.RigidBodyDesc.fixed())), bb = b ? b.body : (S.anchorBody ??= W.createRigidBody(R.RigidBodyDesc.fixed()));
    const toLocal = (h, w, out) => { // world point -> body-local
      if (!h) return out.set(w.x, w.y, w.z);
      const t = h.body.translation(rv2), r = h.body.rotation(rq);
      _q1.set(r.x, r.y, r.z, r.w).invert();
      return out.set(w.x - t.x, w.y - t.y, w.z - t.z).applyQuaternion(_q1);
    };
    let pa, pb;
    if (o.anchors) { pa = arr3(o.anchors[0], [0, 0, 0]); pb = arr3(o.anchors[1], [0, 0, 0]); }
    else if (o.anchor) { const la = toLocal(a, o.anchor, new Vector3()), lb = toLocal(b, o.anchor, new Vector3()); pa = [la.x, la.y, la.z]; pb = [lb.x, lb.y, lb.z]; }
    else { pa = [0, 0, 0]; pb = [0, 0, 0]; }
    const A = { x: pa[0], y: pa[1], z: pa[2] }, B = { x: pb[0], y: pb[1], z: pb[2] };
    const ax = arr3(o.axis, [1, 0, 0]), AX = { x: ax[0], y: ax[1], z: ax[2] };
    let jd;
    switch (o.type) {
      case 'fixed': jd = R.JointData.fixed(A, { x: 0, y: 0, z: 0, w: 1 }, B, { x: 0, y: 0, z: 0, w: 1 }); break;
      case 'revolute': jd = R.JointData.revolute(A, B, AX); break;
      case 'prismatic': jd = R.JointData.prismatic(A, B, AX); break;
      case 'rope': jd = R.JointData.rope(num(o.length, 1), A, B); break;
      case 'spring': jd = R.JointData.spring(num(o.length, 1), num(o.stiffness, 50), num(o.damping, 2), A, B); break;
      default: jd = R.JointData.spherical(A, B);
    }
    const j = W.createImpulseJoint(jd, ba, bb, true);
    if (o.limits && (o.type === 'revolute' || o.type === 'prismatic')) j.setLimits(o.limits[0], o.limits[1]);
    if (o.motor && (o.type === 'revolute' || o.type === 'prismatic')) {
      const m = o.motor;
      j.configureMotor(num(m.target, 0), num(m.velocity, 0), num(m.stiffness, 0), num(m.damping, 0));
      if (m.maxForce) j.setMotorMaxForce(m.maxForce);
    }
    if (o.contacts === false) j.setContactsEnabled(false);
    const rec = { joint: j, a, b, removed: false, remove() { if (rec.removed) return; rec.removed = true; dropFrom(S.joints, rec); try { if (j.isValid()) W.removeImpulseJoint(j, true); } catch (err) { /* gone with its body */ } } };
    S.joints.push(rec);
    if (o.ctx && o.ctx.onDispose) o.ctx.onDispose(rec.remove);
    return rec;
  }

  // ------------------------------------------------------------------ queries
  function raycast(origin, dir, maxDist = 100, o = {}) {
    if (!W) return null;
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    if (dl < 1e-9) return null;
    const ro = rayR.origin, rd = rayR.dir;
    ro.x = origin.x; ro.y = origin.y; ro.z = origin.z; rd.x = dir.x / dl; rd.y = dir.y / dl; rd.z = dir.z / dl;
    const mask = typeof o.groups === 'number' ? o.groups : QMASK[o.groups] ?? QMASK.default;
    const hit = W.castRayAndGetNormal(rayR, maxDist, true, undefined, ig(0xffff, mask), undefined, o.exclude && o.exclude.body ? o.exclude.body : undefined, o.predicate);
    if (!hit) return null;
    const t = hit.timeOfImpact, h = S.byCol.get(hit.collider.handle) ?? null;
    RES.distance = t;
    RES.point.set(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t);
    RES.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    RES.handle = h && !h.terrain ? h : null;
    RES.kind = !h || h.terrain ? 'ground' : h.type === 'fixed' ? 'static' : 'body';
    RES.object = RES.handle ? RES.handle.object : null;
    return RES;
  }
  function overlapSphere(point, r) {
    OVL.length = 0;
    if (!W) return OVL;
    const ball = new R.Ball(r);
    rv.x = point.x; rv.y = point.y; rv.z = point.z;
    W.intersectionsWithShape(rv, { x: 0, y: 0, z: 0, w: 1 }, ball, (col) => { const h = S.byCol.get(col.handle); if (h && !h.terrain) OVL.push(h); return true; });
    return OVL;
  }
  // radial impulse. strength = impulse (N*s) at the centre; dv = strength / mass, falling off linearly to the edge.
  function explode(point, radius, strength = 20, o) {
    let n = 0;
    const up = (o && o.lift) ?? 0.35;
    for (let i = 0; i < S.list.length; i++) {
      const h = S.list[i];
      if (h.type !== 'dynamic' || h.frozen) continue;
      const t = h.position;
      let dx = t.x - point.x, dy = t.y - point.y, dz = t.z - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), reach = radius + (h.info.r || h.info.hx || 0.2);
      if (d > reach) continue;
      const k = (strength * (1 - 0.8 * d / reach)) / Math.max(0.3, h.mass), dd = d || 1;
      let ix = dx / dd, iy = dy / dd + up, iz = dz / dd;
      const il = Math.hypot(ix, iy, iz) || 1;
      const imp = Math.min(k, 40) * h.mass / il;
      rv.x = ix * imp; rv.y = iy * imp; rv.z = iz * imp;
      h.body.applyImpulse(rv, true);
      if (h.rag) { rv.x = (Math.random() - 0.5) * imp * 0.2; rv.y = (Math.random() - 0.5) * imp * 0.2; rv.z = (Math.random() - 0.5) * imp * 0.2; h.body.applyTorqueImpulse(rv, true); }
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ the step
  const evq = []; // collision events collected during a drain, dispatched afterwards
  const EV = { self: null, other: null, kind: 'ground', speed: 0, point: new Vector3(), normal: new Vector3(), started: true };
  let pairFns = null;
  const onEv = (c1, c2, started) => {
    const a = S.byCol.get(c1), b = S.byCol.get(c2);
    if (a && !a.terrain) a.contacts = Math.max(0, a.contacts + (started ? 1 : -1));
    if (b && !b.terrain) b.contacts = Math.max(0, b.contacts + (started ? 1 : -1));
    if (started) evq.push(c1, c2);
  };
  function drainEvents() { S.queue.drainCollisionEvents(onEv); }
  function dispatchEvents() {
    for (let i = 0; i < evq.length; i += 2) {
      const a = S.byCol.get(evq[i]), b = S.byCol.get(evq[i + 1]);
      if (!a || !b || a.removed || b.removed) continue;
      const va = a.terrain ? null : a.pv, vb = b.terrain ? null : b.pv;
      const dvx = (va ? va.x : 0) - (vb ? vb.x : 0), dvy = (va ? va.y : 0) - (vb ? vb.y : 0), dvz = (va ? va.z : 0) - (vb ? vb.z : 0);
      const speed = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
      if (speed < 0.8) continue;
      ST.events++;
      for (let side = 0; side < 2; side++) {
        const me = side ? b : a, other = side ? a : b;
        if (me.terrain || !me.fns) continue;
        EV.other = other.terrain ? null : other;
        EV.kind = other.terrain ? 'ground' : other.type === 'fixed' ? 'static' : 'body';
        EV.speed = speed; EV.self = me;
        const t = me.position;
        EV.point.set(t.x, t.y, t.z); EV.normal.set(0, 1, 0);
        const ot = other.terrain ? null : other.position;
        if (ot) { EV.normal.set(t.x - ot.x, t.y - ot.y, t.z - ot.z).normalize(); EV.point.lerp(ot, 0.5); }
        const fs = me.fns;
        for (let k = 0; k < fs.length; k++) { try { fs[k](EV); } catch (err) { console.error('[physics] contact handler failed', err); } }
      }
    }
    evq.length = 0;
  }

    function cbActive(rb) {
    const h = S.byBody.get(rb.handle);
    if (!h || h.type !== 'dynamic' || h.removed) return;
    h.stamp = S.stepId;
    if (!h.awake) { h.awake = true; S.awake.push(h); h.restT = 0; }
    h.p0.copy(h.position); h.q0.copy(h.quaternion); h.pv.copy(h.velocity);
    const t = rb.translation(rv), r = rb.rotation(rq), v = rb.linvel(rv2);
    h.position.set(t.x, t.y, t.z); h.quaternion.set(r.x, r.y, r.z, r.w); h.velocity.set(v.x, v.y, v.z);
    const w = rb.angvel(rw);
    h.angularVelocity.set(w.x, w.y, w.z);
    if (!T.flat || t.y < -0.4) { // the terrain is one-sided: pull back anything that tunnelled through it
      const gy = groundAt(t.x, t.z);
      if (t.y < gy - 0.3 && inPatch(t.x, t.z, 1)) {
        rv.x = t.x; rv.y = gy + 0.35; rv.z = t.z; rb.setTranslation(rv, true);
        if (v.y < 0) { rv2.x = v.x; rv2.y = 0; rv2.z = v.z; rb.setLinvel(rv2, true); v.y = 0; }
        h.position.y = rv.y;
      }
    }
    const sp2 = v.x * v.x + v.y * v.y + v.z * v.z;
    if (h.rollDamp) { // slow balls stop rolling on gentle slopes instead of creeping downhill forever
      if (!h.slow && sp2 < 0.8) { h.slow = true; rb.setAngularDamping(4); rb.setLinearDamping(0.8); }
      else if (h.slow && sp2 < 0.6) { // stiction: a slow ball on a gentle slope stops (rolling resistance Rapier lacks)
        const x = t.x, z = t.z, gy = groundAt(x, z);
        if (t.y - gy < (h.info.r || 0.2) + 0.12) {
          const gx = (groundAt(x + 0.3, z) - groundAt(x - 0.3, z)) / 0.6, gz = (groundAt(x, z + 0.3) - groundAt(x, z - 0.3)) / 0.6;
          if (gx * gx + gz * gz < 0.02) { rv.x = rv.y = rv.z = 0; rb.setLinvel(rv, false); rb.setAngvel(rv, false); }
        }
      }
      else if (h.slow && sp2 > 2.6) { h.slow = false; rb.setAngularDamping(h.angDamp); rb.setLinearDamping(h.linDamp); }
    }
  }
  function stepOnce() {
    S.stepId++;
    // kinematic bodies: physics follows the object / the target the owner set
    for (let i = 0; i < S.list.length; i++) {
      const h = S.list[i];
      if (h.type !== 'kinematic' || h.frozen) continue;
      if (h.fromObject && h.object) {
        h.object.updateWorldMatrix(true, false);
        h.object.matrixWorld.decompose(_p, _q, _s);
        rv.x = _p.x; rv.y = _p.y; rv.z = _p.z; h.body.setNextKinematicTranslation(rv);
        rq.x = _q.x; rq.y = _q.y; rq.z = _q.z; rq.w = _q.w; h.body.setNextKinematicRotation(rq);
        h.position.copy(_p); h.quaternion.copy(_q);
      } else if (h.hasT) {
        rv.x = h.tp.x; rv.y = h.tp.y; rv.z = h.tp.z; h.body.setNextKinematicTranslation(rv);
        rq.x = h.tq.x; rq.y = h.tq.y; rq.z = h.tq.z; rq.w = h.tq.w; h.body.setNextKinematicRotation(rq);
        h.position.copy(h.tp); h.quaternion.copy(h.tq);
      }
    }
    if (S.needProp) { W.propagateModifiedBodyPositionsToColliders(); S.needProp = false; }
    for (let i = S.vehs.length - 1; i >= 0; i--) { // a vehicle whose chassis is gone (removed behind its back) must never reach the freed controller
      const v = S.vehs[i];
      if (!vehAlive(v)) v.remove(); else v.pre(FIXED);
    }
    for (let i = 0; i < S.rags.length; i++) ragLimits(S.rags[i]);
    const t0 = nowMs();
    W.step(S.queue);
    const dt = nowMs() - t0;
    ST.stepMs = dt; ST.ema += (dt - ST.ema) * 0.1; if (dt > ST.maxStepMs) ST.maxStepMs = dt; ST.steps++;
    S.simTime += FIXED;
    W.forEachActiveRigidBody(cbActive);
    // bodies that fell asleep this step: snap their render pose to the final pose
    const A = S.awake;
    for (let i = A.length - 1; i >= 0; i--) {
      const h = A[i];
      if (h.stamp !== S.stepId) {
        h.awake = false; A[i] = A[A.length - 1]; A.pop();
        h.p0.copy(h.position); h.q0.copy(h.quaternion); h.velocity.set(0, 0, 0); h.pv.set(0, 0, 0);
        h.settled = true; renderOne(h, 1); // final pose
      } else h.settled = false;
    }
    drainEvents();
    dispatchEvents();
    for (let i = 0; i < S.vehs.length; i++) { const v = S.vehs[i]; if (vehAlive(v)) v.post(); }
  }
  const vehAlive = (v) => !v.removed && !v.handle.removed && !!W.getRigidBody(v.handle.body.handle);

  function renderOne(h, a) {
    const rp = h.rp, rqq = h.rq;
    const p0 = h.p0, p1 = h.position;
    rp.set(p0.x + (p1.x - p0.x) * a, p0.y + (p1.y - p0.y) * a, p0.z + (p1.z - p0.z) * a);
    const q0 = h.q0, q1 = h.quaternion;
    const dot = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w, sg = dot < 0 ? -1 : 1;
    let x = q0.x + (sg * q1.x - q0.x) * a, y = q0.y + (sg * q1.y - q0.y) * a, z = q0.z + (sg * q1.z - q0.z) * a, w = q0.w + (sg * q1.w - q0.w) * a;
    const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
    rqq.set(x / l, y / l, z / l, w / l);
    if (h.drive) {
      const ob = h.object;
      if (ob.parent === h.parent0) { // (an object someone re-parented, e.g. into a hand, is theirs now)
        ob.position.copy(rp);
        if (h.rotate) ob.quaternion.copy(rqq);
      }
    }
    if (h.onPose) h.onPose(h);
    if (h.rag) h.rag.dirty = true;
  }
  function renderAll(alpha) {
    const A = S.awake;
    for (let i = 0; i < A.length; i++) renderOne(A[i], alpha);
    for (let i = 0; i < S.rags.length; i++) { const r = S.rags[i]; if (r.dirty) { r.dirty = false; if (r.finalize) r.finalize(r); } }
  }

  // ------------------------------------------------------------------ housekeeping (killing, freezing, budgets) — a few times a second
  const KILL_Y = -45;
  function housekeeping(dt) {
    S.hkT = (S.hkT ?? 0) - dt;
    if (S.hkT > 0) return;
    S.hkT = 0.4;
    for (let i = S.list.length - 1; i >= 0; i--) {
      const h = S.list[i];
      if (h.type !== 'dynamic') continue;
      const p = h.position;
      if (p.y < KILL_Y || !isFinite(p.x + p.y + p.z)) { const fn = h.onKilled; if (fn) { try { fn(h); } catch (err) { /* ignore */ } } h.remove(); continue; }
      if (h.rag) continue;
      if (!h.frozen) {
        if (!T.flat && !inPatch(p.x, p.z, 1)) { h.frozen = true; h.body.setEnabled(false); if (h.awake) { dropFrom(S.awake, h); h.awake = false; } }
      } else maybeThaw(h);
    }
    for (let i = 0; i < S.rags.length; i++) ragFreezeCheck(S.rags[i]);
    // registries must not outlive their Rapier objects (a body removed behind our back, a joint that died with its body, a ragdoll whose parts are all gone)
    for (let i = S.chars.length - 1; i >= 0; i--) { const ch = S.chars[i]; if (ch.removed || !W.getRigidBody(ch.body.handle)) ch.remove(); }
    for (let i = S.joints.length - 1; i >= 0; i--) { const jr = S.joints[i]; let ok = false; try { ok = !jr.removed && jr.joint.isValid(); } catch (err) { /* freed */ } if (!ok) jr.remove(); }
    for (let i = S.rags.length - 1; i >= 0; i--) { const rd = S.rags[i]; if (rd.removed || !rd.list.length) { ragRemove(rd); dropFrom(S.rags, rd); } }
    // budget pressure: step time vs its budget, and awake count
    const aw = S.awake.length, load = Math.max(ST.ema / caps.stepMs, aw / caps.awake);
    S.pressure = Math.max(0, Math.min(1, load));
    const target = S.pressure > 0.9 ? 2 : 4;
    if (W.numSolverIterations !== target && (target === 2 || S.pressure < 0.55)) W.numSolverIterations = target;
    if (aw > caps.awake) { // too many awake: put the farthest debris to sleep
      const head = ctx.player ? ctx.player.head : null;
      let worst = null, wd = -1;
      for (let i = 0; i < S.awake.length; i++) {
        const h = S.awake[i];
        if (h.rag || h.noEvict) continue;
        const d = head ? (h.position.x - head.x) ** 2 + (h.position.z - head.z) ** 2 : 0;
        if (d > wd) { wd = d; worst = h; }
      }
      if (worst) worst.sleep();
    }
  }

  // ------------------------------------------------------------------ ragdolls
  // part: { name, parent, pos (world origin of the part frame), quat (world body-frame rotation), shape 'capsule'|'box'|'sphere',
  //   size ([r, totalHeight] | [w,h,d] | r), center ([x,y,z] collider offset in the body frame), cquat ([x,y,z,w] collider rotation in the body frame),
  //   mass, joint: { anchor (world), type 'spherical'|'revolute', axis (body-local), limits [min,max] (revolute), cone (rad, software limit for spherical) },
  //   apply(handle) called every rendered frame while the part moves }
  function ragdoll(c, spec) {
    if (!W || !spec || !spec.parts || !spec.parts.length) return null;
    if (CNT.dynamic + spec.parts.length > caps.dynamic + 40) return null;
    while (S.rags.length >= caps.ragdolls) { const old = S.rags.find((r) => !r.frozen); if (!old) break; old.freeze(); dropFrom(S.rags, old); }
    const rd = { parts: {}, list: [], joints: [], limits: [], age: 0, settled: false, frozen: false, removed: false, ctx: c, onSettle: spec.onSettle || null, maxAge: spec.maxAge ?? 9, id: ++S.seq };
    const q = new Quaternion();
    for (const ps of spec.parts) {
      const o = { shape: ps.shape || 'capsule', size: ps.size, center: ps.center, mass: ps.mass ?? 3, friction: ps.friction ?? 0.8, restitution: 0.05, group: 'ragdoll',
        linearDamping: spec.linearDamping ?? 0.5, angularDamping: spec.angularDamping ?? 1.2, position: ps.pos, sleepy: true, ccd: ps.ccd };
      const h = bodyRaw(c, ps, o);
      if (!h) { rd.remove(); return null; }
      h.rag = rd; h.noEvict = true; h.onPose = ps.apply || null; h.partName = ps.name; h.recycle = false;
      if (spec.contact) h.onContact(spec.contact);
      rd.parts[ps.name] = h; rd.list.push(h);
    }
    for (const ps of spec.parts) {
      if (!ps.parent || !ps.joint) continue;
      const hp = rd.parts[ps.parent], hc = rd.parts[ps.name], J = ps.joint;
      if (!hp || !hc) continue;
      const local = (h, w) => { _q1.copy(h.quaternion).invert(); return _v1.set(w.x - h.position.x, w.y - h.position.y, w.z - h.position.z).applyQuaternion(_q1); };
      const la = local(hp, J.anchor), A = { x: la.x, y: la.y, z: la.z }, lb = local(hc, J.anchor), B = { x: lb.x, y: lb.y, z: lb.z };
      let jd;
      if (J.type === 'revolute') { const a = J.axis || [1, 0, 0]; jd = R.JointData.revolute(A, B, { x: a[0], y: a[1], z: a[2] }); }
      else jd = R.JointData.spherical(A, B);
      const jt = W.createImpulseJoint(jd, hp.body, hc.body, true);
      if (J.type === 'revolute' && J.limits) jt.setLimits(J.limits[0], J.limits[1]);
      jt.setContactsEnabled(false);
      rd.joints.push(jt);
      if (J.type !== 'revolute' && J.cone) rd.limits.push({ a: hp, b: hc, cone: J.cone, k: J.stiff ?? 0.5 });
    }
    // initial motion
    const v = spec.velocity, w = spec.spin;
    for (const h of rd.list) {
      if (v) h.setVelocity(v.x, v.y, v.z);
      if (w) h.setAngularVelocity(w.x, w.y, w.z);
    }
    if (spec.impulse) for (const k of Object.keys(spec.impulse)) { const h = rd.parts[k], im = spec.impulse[k]; if (h) h.applyImpulse(im.x, im.y, im.z); }
    rd.freeze = () => ragFreeze(rd);
    rd.remove = () => ragRemove(rd);
    rd.wake = () => { for (const h of rd.list) h.body.wakeUp(); rd.settled = false; };
    S.rags.push(rd);
    if (c && c.onDispose) c.onDispose(() => ragRemove(rd));
    return rd;
  }
  // a body made from a plain spec instead of an Object3D
  function bodyRaw(c, ps, o) {
    const rq0 = ps.quat || _q.set(0, 0, 0, 1);
    const holder = { type: 'raw' };
    const type = 'dynamic';
    if (CNT.dynamic >= caps.dynamic + 40) return null;
    const info = {};
    const bd = R.RigidBodyDesc.dynamic().setTranslation(ps.pos.x, ps.pos.y, ps.pos.z).setRotation({ x: rq0.x, y: rq0.y, z: rq0.z, w: rq0.w })
      .setLinearDamping(o.linearDamping).setAngularDamping(o.angularDamping);
    if (o.ccd) bd.setCcdEnabled(true);
    let cd;
    const sz = ps.size;
    if (o.shape === 'box') { const s = arr3(sz, [0.2, 0.2, 0.2]); info.hx = s[0] / 2; info.hy = s[1] / 2; info.hz = s[2] / 2; cd = R.ColliderDesc.cuboid(info.hx, info.hy, info.hz); }
    else if (o.shape === 'sphere') { const r = Array.isArray(sz) ? sz[0] : sz; info.r = r; cd = R.ColliderDesc.ball(r); }
    else { const r = sz[0], hh = Math.max(0, sz[1] * 0.5 - r); info.r = r; info.hh = hh; cd = R.ColliderDesc.capsule(hh, r); }
    if (ps.center) cd.setTranslation(ps.center[0], ps.center[1], ps.center[2]);
    if (ps.cquat) cd.setRotation({ x: ps.cquat[0], y: ps.cquat[1], z: ps.cquat[2], w: ps.cquat[3] });
    cd.setMass(Math.max(0.05, o.mass)).setFriction(o.friction).setRestitution(o.restitution).setCollisionGroups(GR.ragdoll);
    const rb = W.createRigidBody(bd), col = W.createCollider(cd, rb);
    const h = Object.create(P);
    h.id = ++S.seq; h.object = null; h.body = rb; h.collider = col; h.type = 'dynamic'; h.mass = o.mass; h.ctx = c; h.info = info; h.group = 'ragdoll';
    h.removed = false; h.awake = true; h.frozen = false; h.recycle = false; h.born = S.simTime; h.noEvict = true; h.sleepy = true; h.rotate = true; h.drive = false; h.fromObject = false;
    h.position = new Vector3(ps.pos.x, ps.pos.y, ps.pos.z); h.quaternion = new Quaternion(rq0.x, rq0.y, rq0.z, rq0.w);
    h.velocity = new Vector3(); h.angularVelocity = new Vector3(); h.rp = h.position.clone(); h.rq = h.quaternion.clone();
    h.p0 = h.position.clone(); h.q0 = h.quaternion.clone(); h.pv = new Vector3(); h.tp = new Vector3(); h.tq = new Quaternion(); h.hasT = false;
    h.restT = 0; h.contacts = 0; h.fns = null; h.user = null; h.onPose = null; h.rag = null; h.grounded = false; h.stamp = S.stepId; h.onKilled = null; h.t0 = 0;
    reg(h); S.awake.push(h);
    void holder;
    return h;
  }
  const _ra = new Vector3(), _rq = new Quaternion(), _rq2 = new Quaternion(), _rn = new Vector3();
  function ragLimits(rd) {
    if (rd.frozen || rd.settled) return;
    for (let i = 0; i < rd.limits.length; i++) {
      const L = rd.limits[i];
      if (L.a.removed || L.b.removed) continue;
      // relative rotation child-in-parent
      _rq.copy(L.a.quaternion).invert().multiply(L.b.quaternion);
      if (_rq.w < 0) { _rq.x = -_rq.x; _rq.y = -_rq.y; _rq.z = -_rq.z; _rq.w = -_rq.w; }
      const sinHalf = Math.sqrt(_rq.x * _rq.x + _rq.y * _rq.y + _rq.z * _rq.z);
      const ang = 2 * Math.atan2(sinHalf, _rq.w);
      if (ang <= L.cone || sinHalf < 1e-5) continue;
      const ex = ang - L.cone;
      _rn.set(_rq.x, _rq.y, _rq.z).multiplyScalar(1 / sinHalf).applyQuaternion(L.a.quaternion); // world axis, positive = child rotated beyond the cone
      const inertia = 0.5 * (L.b.mass * 0.03 + L.a.mass * 0.03);
      // angular velocity of the child relative to the parent about the axis, damp it and push back
      const wb = L.b.angularVelocity, wa = L.a.angularVelocity;
      const rel = (wb.x - wa.x) * _rn.x + (wb.y - wa.y) * _rn.y + (wb.z - wa.z) * _rn.z;
      const push = Math.min(ex * 18 * L.k, 10) + (rel > 0 ? rel * 0.5 : 0);
      const mag = push * inertia;
      rv.x = -_rn.x * mag; rv.y = -_rn.y * mag; rv.z = -_rn.z * mag; L.b.body.applyTorqueImpulse(rv, true);
      rv.x = _rn.x * mag * 0.6; rv.y = _rn.y * mag * 0.6; rv.z = _rn.z * mag * 0.6; L.a.body.applyTorqueImpulse(rv, true);
    }
  }
  function ragFreezeCheck(rd) {
    if (rd.frozen || rd.removed) return;
    rd.age += 0.4;
    let still = true;
    for (let i = 0; i < rd.list.length; i++) if (!rd.list[i].body.isSleeping()) { still = false; break; }
    const root = rd.list[0];
    if (root && !T.flat && !inPatch(root.position.x, root.position.z, 2)) { ragFreeze(rd); return; }
    if (!rd.settled && (still || rd.age > rd.maxAge)) {
      rd.settled = true;
      if (rd.onSettle) { try { rd.onSettle(rd); } catch (err) { console.error('[physics] ragdoll onSettle failed', err); } }
    }
    if (rd.settled && rd.age > rd.maxAge) ragFreeze(rd);
  }
  // keep the last pose, free the bodies and joints (a frozen ragdoll costs nothing)
  function ragFreeze(rd) {
    if (rd.frozen || rd.removed) return;
    for (const h of rd.list) { if (h.removed) continue; h.p0.copy(h.position); h.q0.copy(h.quaternion); renderOne(h, 1); }
    rd.frozen = true;
    if (rd.finalize) { try { rd.finalize(rd); } catch (err) { console.error('[physics] ragdoll finalize failed', err); } }
    destroyRagBodies(rd);
    dropFrom(S.rags, rd);
  }
  function destroyRagBodies(rd) {
    for (const h of rd.list.slice()) { h.onPose = null; removeHandle(h); }
    for (const j of rd.joints) { try { if (j.isValid()) W.removeImpulseJoint(j, false); } catch (err) { /* gone */ } }
    rd.joints.length = 0; rd.list.length = 0; rd.limits.length = 0;
  }
  function ragRemove(rd) {
    if (rd.removed) return;
    rd.removed = true; rd.frozen = true;
    destroyRagBodies(rd);
    dropFrom(S.rags, rd);
  }

  // ------------------------------------------------------------------ character controller
  function character(c, o = {}) {
    if (!W || S.chars.length >= caps.characters) return null;
    const radius = num(o.radius, 0.3), height = Math.max(radius * 2 + 0.05, num(o.height, 1.7));
    const rb = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
    const col = W.createCollider(R.ColliderDesc.capsule((height - 2 * radius) / 2, radius).setTranslation(0, height / 2, 0).setCollisionGroups(GR.char).setFriction(0), rb);
    const ctl = W.createCharacterController(num(o.offset, 0.02));
    ctl.setUp({ x: 0, y: 1, z: 0 });
    ctl.setSlideEnabled(true);
    ctl.enableAutostep(num(o.stepHeight, 0.35), 0.12, false);
    ctl.setMaxSlopeClimbAngle((num(o.maxSlope, 55) * Math.PI) / 180);
    ctl.setMinSlopeSlideAngle((num(o.slideSlope, 62) * Math.PI) / 180);
    ctl.enableSnapToGround(num(o.snap, 0.2));
    ctl.setApplyImpulsesToDynamicBodies(o.push !== false);
    ctl.setCharacterMass(num(o.mass, 70));
    const ch = { position: new Vector3(), grounded: false, body: rb, collider: col, removed: false, radius, height, hit: false };
    const mv = { x: 0, y: 0, z: 0 }, out = { x: 0, y: 0, z: 0 };
    ch.teleport = (x, y, z) => { ch.position.set(x, y, z); if (ch.removed) return ch; rv.x = x; rv.y = y; rv.z = z; rb.setTranslation(rv, false); S.needProp = true; return ch; };
    ch.move = (dx, dy, dz) => {
      if (ch.removed) return ch.position;
      if (!W.getRigidBody(rb.handle)) { ch.remove(); return ch.position; } // the body was removed behind our back: the controller would trap on it
      if (S.needProp) { W.propagateModifiedBodyPositionsToColliders(); S.needProp = false; }
      mv.x = dx; mv.y = dy; mv.z = dz;
      ctl.computeColliderMovement(col, mv, undefined, GR.char);
      const m = ctl.computedMovement(out);
      ch.hit = Math.abs(m.x - dx) + Math.abs(m.z - dz) > 1e-3;
      ch.position.x += m.x; ch.position.y += m.y; ch.position.z += m.z;
      ch.grounded = ctl.computedGrounded();
      rv.x = ch.position.x; rv.y = ch.position.y; rv.z = ch.position.z; rb.setTranslation(rv, false); S.needProp = true;
      return ch.position;
    };
    ch.remove = () => {
      if (ch.removed) return; ch.removed = true; dropFrom(S.chars, ch);
      try { W.removeCharacterController(ctl); } catch (err) { /* gone */ }
      try { if (W.getRigidBody(rb.handle)) W.removeRigidBody(rb); } catch (err) { /* gone */ }
    };
    S.chars.push(ch);
    if (c && c.onDispose) c.onDispose(ch.remove);
    return ch;
  }

  // ------------------------------------------------------------------ raycast vehicle
  function vehicle(c, chassis, o = {}) {
    if (!W) return null;
    const mass = num(o.mass, 900);
    const h = body(c, chassis, { shape: 'box', size: o.size, mass, friction: 0.4, restitution: 0.05, linearDamping: 0.02, angularDamping: 0.6, center: o.center, sleepy: false, canSleep: false });
    if (!h) return null;
    h.noEvict = true;
    const ctl = W.createVehicleController(h.body);
    ctl.indexUpAxis = 1;
    ctl.setIndexForwardAxis = 2;
    const sgn = o.forward === '+z' ? 1 : -1;
    const wheels = (o.wheels || []).map((w) => {
      const p = arr3(w.position, [0, 0, 0]), rest = num(w.rest, 0.3), r = num(w.radius, 0.35);
      ctl.addWheel({ x: p[0], y: p[1], z: p[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, r);
      return { w, p, rest, r, steer: !!w.steer, drive: w.drive !== false, brake: w.brake !== false, object: w.object || null, spin: w.spin || null };
    });
    wheels.forEach((w, i) => {
      ctl.setWheelSuspensionStiffness(i, num(o.stiffness, 28)); ctl.setWheelSuspensionCompression(i, num(o.compression, 3.2)); ctl.setWheelSuspensionRelaxation(i, num(o.relaxation, 3.6));
      ctl.setWheelMaxSuspensionTravel(i, num(o.travel, 0.35)); ctl.setWheelMaxSuspensionForce(i, num(o.maxSuspensionForce, 120000));
      ctl.setWheelFrictionSlip(i, num(o.grip, 2.2)); ctl.setWheelSideFrictionStiffness(i, num(o.sideGrip, 1.0));
    });
    const nDrive = Math.max(1, wheels.filter((w) => w.drive).length), inp = { throttle: 0, steer: 0, brake: 0 }, engine = num(o.engineForce, mass * 4) / nDrive, maxSteer = num(o.maxSteer, 0.5), brakeF = num(o.brakeForce, mass * 0.06);
    const car = {
      handle: h, body: h.body, controller: ctl, speed: 0, wheels, removed: false, onGround: false,
      setInput(i) { if (i.throttle !== undefined) inp.throttle = Math.max(-1, Math.min(1, i.throttle)); if (i.steer !== undefined) inp.steer = Math.max(-1, Math.min(1, i.steer)); if (i.brake !== undefined) inp.brake = Math.max(0, Math.min(1, i.brake)); },
      pre(dt) {
        const st = inp.steer * maxSteer;
        for (let i = 0; i < wheels.length; i++) {
          const w = wheels[i];
          ctl.setWheelEngineForce(i, w.drive ? inp.throttle * engine * sgn : 0);
          ctl.setWheelSteering(i, w.steer ? -st : 0);
          ctl.setWheelBrake(i, w.brake ? inp.brake * brakeF : 0);
        }
        if (inp.throttle !== 0 || inp.brake > 0) h.body.wakeUp();
        ctl.updateVehicle(dt, undefined, ig(0xffff, G_WORLD | G_DYN));
      },
      post() {
        car.speed = ctl.currentVehicleSpeed() * sgn;
        let g = false;
        for (let i = 0; i < wheels.length; i++) { if (ctl.wheelIsInContact(i)) g = true; }
        car.onGround = g;
      },
      syncWheels() {
        for (let i = 0; i < wheels.length; i++) {
          const w = wheels[i];
          if (w.object) {
            const sl = ctl.wheelSuspensionLength(i) ?? w.rest;
            w.object.position.set(w.p[0], w.p[1] - sl, w.p[2]);
            // Rapier's steering angle is a right-handed rotation about the chassis' up axis, the same sense as three's rotation.y (+ = a left turn),
            // whichever way the car is declared to face: pre() feeds it -st, so the wheel object shows exactly the angle the controller steers by.
            w.object.rotation.y = (w.steer ? (ctl.wheelSteering(i) ?? 0) : 0);
          }
          // wheelRotation is signed by the real travel direction (it falls when the car drives toward -z, grows toward +z), which is exactly what the tyre
          // needs (rotation.x grows when it rolls toward +z): no extra sgn, for either convention
          if (w.spin) w.spin.rotation.x = (ctl.wheelRotation(i) ?? 0);
        }
      },
      remove() {
        if (car.removed) return; car.removed = true; dropFrom(S.vehs, car); // (idempotent: the chassis handle, the caller's ctx and the step guard may all get here)
        if (h.veh === car) h.veh = null;
        try { W.removeVehicleController(ctl); } catch (err) { /* gone */ }
        h.remove();
      },
    };
    h.veh = car; // removing the chassis handle (kill plane, clear(), the owner) removes the vehicle with it
    const prevPose = h.onPose;
    h.onPose = (hh) => { if (prevPose) prevPose(hh); if (!car.removed) car.syncWheels(); };
    S.vehs.push(car);
    if (c && c.onDispose) c.onDispose(car.remove);
    return car;
  }

  // ------------------------------------------------------------------ debug draw: collider wireframes (own lines, so they match the interpolated visuals)
  let dbg = null, dbgBuf = null, dbgCol = null;
  const SEG = 14;
  function debugUpdate() {
    if (!S.debug) { if (dbg) dbg.visible = false; return; }
    if (!dbg) {
      dbg = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false, fog: false }));
      dbg.frustumCulled = false; dbg.renderOrder = 999; dbg.userData.noShadow = true;
      ctx.root.add(dbg);
    }
    dbg.visible = true;
    if (S.debug === 'rapier') { // Rapier's own renderer (includes joints and the terrain patch)
      const buf = W.debugRender();
      const v = buf.vertices, cl = buf.colors, n = v.length / 3;
      if (!dbgBuf || dbgBuf.length < v.length) { dbgBuf = new Float32Array(v.length * 2); dbgCol = new Float32Array(v.length * 2); }
      dbgBuf.set(v); for (let i = 0; i < n; i++) { dbgCol[i * 3] = cl[i * 4]; dbgCol[i * 3 + 1] = cl[i * 4 + 1]; dbgCol[i * 3 + 2] = cl[i * 4 + 2]; }
      setLines(n);
      return;
    }
    let n = 0;
    const need = (S.list.length + 8) * 160 * 3;
    if (!dbgBuf || dbgBuf.length < need) { dbgBuf = new Float32Array(need * 1.5); dbgCol = new Float32Array(need * 1.5); }
    const seg = (ax, ay, az, bx, by, bz, r, g, b) => {
      if ((n + 2) * 3 > dbgBuf.length) return;
      let o = n * 3; dbgBuf[o] = ax; dbgBuf[o + 1] = ay; dbgBuf[o + 2] = az; dbgCol[o] = r; dbgCol[o + 1] = g; dbgCol[o + 2] = b;
      o += 3; dbgBuf[o] = bx; dbgBuf[o + 1] = by; dbgBuf[o + 2] = bz; dbgCol[o] = r; dbgCol[o + 1] = g; dbgCol[o + 2] = b;
      n += 2;
    };
    const P0 = new Vector3(), P1 = new Vector3(), qb = new Quaternion(), qc = new Quaternion();
    for (let i = 0; i < S.list.length; i++) {
      const h = S.list[i];
      if (h.frozen) continue;
      const I = h.info;
      const col = h.rag ? [0.2, 1, 0.3] : h.type === 'fixed' ? [1, 0.85, 0.2] : h.type === 'kinematic' ? [1, 0.5, 0.1] : h.body.isSleeping() ? [0.3, 0.8, 1] : [1, 0.25, 0.85];
      const co = h.collider.translationWrtParent(rv), cr = h.collider.rotationWrtParent(rq);
      const ox = co.x, oy = co.y, oz = co.z; qc.set(cr.x, cr.y, cr.z, cr.w);
      if (h.type === 'fixed') { h.body.translation(rv2); P1.set(rv2.x, rv2.y, rv2.z); const q0 = h.body.rotation(rq); qb.set(q0.x, q0.y, q0.z, q0.w); }
      else { P1.copy(h.rp); qb.copy(h.rq); }
      qb.multiply(qc);
      // shape-local -> world: rotate by body*collider rotation, offset by body + body-rotated collider offset
      const off = _v2.set(ox, oy, oz).applyQuaternion(h.type === 'fixed' ? qbody(h) : h.rq);
      const W3 = (x, y, z, out) => out.set(x, y, z).applyQuaternion(qb).add(off).add(P1);
      const A = new Vector3(), B2 = new Vector3();
      const line = (x0, y0, z0, x1, y1, z1) => { W3(x0, y0, z0, A); W3(x1, y1, z1, B2); seg(A.x, A.y, A.z, B2.x, B2.y, B2.z, col[0], col[1], col[2]); };
      const ring = (cy, r, axis) => {
        for (let k = 0; k < SEG; k++) {
          const a0 = (k / SEG) * 6.2832, a1 = ((k + 1) / SEG) * 6.2832, c0 = Math.cos(a0) * r, s0 = Math.sin(a0) * r, c1 = Math.cos(a1) * r, s1 = Math.sin(a1) * r;
          if (axis === 0) line(c0, cy, s0, c1, cy, s1); else if (axis === 1) line(cy, c0, s0, cy, c1, s1); else line(c0, s0, cy, c1, s1, cy);
        }
      };
      if (I.hx !== undefined) {
        const x = I.hx, y = I.hy, z = I.hz;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) { line(-x, sy * y, sx * z, x, sy * y, sx * z); line(sx * x, -y, sy * z, sx * x, y, sy * z); line(sx * x, sy * y, -z, sx * x, sy * y, z); }
      } else if (I.shape === 'sphere' || (I.r !== undefined && I.hh === undefined)) { ring(0, I.r, 0); ring(0, I.r, 1); ring(0, I.r, 2); }
      else if (I.hh !== undefined) {
        const r = I.r, hh = I.hh;
        ring(hh, r, 0); ring(-hh, r, 0);
        line(r, -hh, 0, r, hh, 0); line(-r, -hh, 0, -r, hh, 0); line(0, -hh, r, 0, hh, r); line(0, -hh, -r, 0, hh, -r);
        if (I.shape === 'capsule') for (let k = 0; k < 7; k++) {
          const a0 = (k / 7) * 3.1416, a1 = ((k + 1) / 7) * 3.1416;
          for (const sg of [1, -1]) { line(Math.cos(a0) * r, sg * (hh + Math.sin(a0) * r), 0, Math.cos(a1) * r, sg * (hh + Math.sin(a1) * r), 0); line(0, sg * (hh + Math.sin(a0) * r), Math.cos(a0) * r, 0, sg * (hh + Math.sin(a1) * r), Math.cos(a1) * r); }
        }
      } else { line(-0.1, 0, 0, 0.1, 0, 0); line(0, -0.1, 0, 0, 0.1, 0); line(0, 0, -0.1, 0, 0, 0.1); }
    }
    setLines(n);
  }
  function qbody(h) { h.body.rotation(rq); return _q2.set(rq.x, rq.y, rq.z, rq.w); }
  function setLines(n) {
    const g = dbg.geometry;
    let pa = g.getAttribute('position'), ca = g.getAttribute('color');
    if (!pa || pa.array.length < n * 3 || pa.array.length > n * 3 * 8) {
      pa = new THREE.BufferAttribute(new Float32Array(Math.max(n * 3 * 1.5, 3000)), 3).setUsage(THREE.DynamicDrawUsage);
      ca = new THREE.BufferAttribute(new Float32Array(Math.max(n * 3 * 1.5, 3000)), 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pa); g.setAttribute('color', ca);
    }
    pa.array.set(dbgBuf.subarray(0, n * 3)); ca.array.set(dbgCol.subarray(0, n * 3));
    pa.needsUpdate = ca.needsUpdate = true;
    g.setDrawRange(0, n);
  }
  // ------------------------------------------------------------------ public API
  function advance(dt) {
    dt = Math.min(dt, 0.1);
    maintainTerrain();
    S.acc = Math.min(S.acc + dt, 0.1);
    let steps = 0;
    while (S.acc >= FIXED && steps < 2) { stepOnce(); S.acc -= FIXED; steps++; }
    if (S.acc >= FIXED) S.acc = 0; // never spiral: drop the backlog
    renderAll(S.acc / FIXED);
    housekeeping(dt);
    ST.frames++;
  }
  const api = {
    ready: true, rapier: R, world: W, caps, R,
    get pressure() { return S.pressure; },
    body, joint, raycast, overlapSphere, explode, character, vehicle, ragdoll,
    groundAt, inside: (x, z) => inPatch(x, z, 1),
    groups: GR,
    step: advance,
    rebuildTerrain() { buildTerrain(T.cx, T.cz, T.flat); },
    canSpawn(kind) { // cheap pre-check for callers that have a fallback (kit debris, gore parts)
      if (CNT.dynamic >= caps.dynamic - 8) return false;
      if (S.pressure > 0.85) return false;
      if (kind === 'debris') return CNT.debris < caps.debris;
      return true;
    },
    count(kind) { if (kind === 'debris') return CNT.debris; let n = 0; for (let i = 0; i < S.list.length; i++) if (S.list[i].group === kind && S.list[i].type === 'dynamic') n++; return n; },
    debug(on) { S.debug = on; if (on) debugUpdate(); else if (dbg) dbg.visible = false; return !!on; },
    stats() {
      let sleeping = 0;
      for (let i = 0; i < S.list.length; i++) if (S.list[i].type === 'dynamic' && !S.list[i].awake) sleeping++;
      return {
        bodies: S.list.length, dynamic: CNT.dynamic, fixed: CNT.fixed, kinematic: CNT.kinematic, awake: S.awake.length, sleeping, ragdolls: S.rags.length,
        joints: S.joints.length + S.rags.reduce((n, r) => n + r.joints.length, 0), characters: S.chars.length, vehicles: S.vehs.length,
        stepMs: +ST.stepMs.toFixed(3), avgStepMs: +ST.ema.toFixed(3), maxStepMs: +ST.maxStepMs.toFixed(3), steps: ST.steps, events: ST.events, pressure: +S.pressure.toFixed(2),
        colliders: W.colliders.len ? W.colliders.len() : -1, rbodies: W.bodies.len ? W.bodies.len() : -1, impulseJoints: W.impulseJoints.len ? W.impulseJoints.len() : -1,
        terrain: { cx: T.cx, cz: T.cz, half: T.half, flat: T.flat, rebuilds: T.rebuilds, buildMs: +T.ms.toFixed(2) },
      };
    },
    resetStats() { ST.maxStepMs = 0; ST.events = 0; },
    // test/maintenance: remove everything dynamic and every ragdoll (terrain stays)
    clear() { for (const r of S.rags.slice()) ragRemove(r); for (const h of S.list.slice()) if (!h.removed) removeHandle(h); },
  };
  T.col = T.col && S.byCol.get(T.col.handle) ? T.col : T.col; // keep the existing patch across a reload
  if (T.col) S.byCol.set(T.col.handle, TERRAIN);
  maintainTerrain();
  ctx.provide('physics', api);
  ctx.on('xr:start', () => { S.hkT = 0; });
  ctx.on('world:terrain-changed', () => { S.terrainDirty = true; });
  ctx.onDispose(() => { if (dbg) { dbg.geometry.dispose(); dbg.material.dispose(); dbg = null; } });

  return {
    update(dt) {
      advance(dt);
      if ((S.dbgT = (S.dbgT ?? 0) - dt) <= 0) { S.dbgT = 0.08; debugUpdate(); }
    },
    dispose() { /* the world and every handle live in ctx.state and are adopted by the next version */ },
  };
}
