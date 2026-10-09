// mr/room.js — room awareness, only with what the session actually granted (env.features, from session.enabledFeatures):
//   plane-detection : the table sits on the best real horizontal surface at 0.5-1.1 m (pickSurface), real planes become depth-only occluders
//                     (virtual things hide behind real furniture), vertical planes become wall colliders (thrown things bounce off real walls)
//   mesh-detection  : the scanned room mesh becomes a depth-only occluder
// Without those features this part does nothing and raises no errors (floor y = 0 is always known from local-floor).
export default function (env) {
  const { THREE, ctx, roomGroup, S, world } = env;
  const { Matrix4, Vector3, Mesh } = THREE;
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
  const planes = new Map();               // key -> { mesh, horizontal, y, cx, cz, area, radius, seen }
  const meshes = new Map();
  const walls = [];                       // { col, key }
  let pollT = 0, age = 0, wallSig = '';
  const _m = new Matrix4(), _v = new Vector3(), _q = new THREE.Quaternion(), _s = new Vector3();

  function poseMatrix(frame, space, ref, out) {
    const pose = frame.getPose(space, ref);
    if (!pose) return null;
    out.fromArray(pose.transform.matrix);
    if (ctx.rig) { ctx.rig.updateWorldMatrix(true, false); out.premultiply(ctx.rig.matrixWorld); }
    return out;
  }
  function polyStats(poly) { // polygon in plane-local (x, z); returns area, centroid, inscribed radius estimate
    let a = 0, cx = 0, cz = 0;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], f = p.x * q.z - q.x * p.z;
      a += f; cx += (p.x + q.x) * f; cz += (p.z + q.z) * f;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-6) return { area: 0, cx: 0, cz: 0, r: 0 };
    cx /= 6 * a; cz /= 6 * a;
    let r = 1e9;
    for (let i = 0; i < n; i++) { // distance from centroid to each edge
      const p = poly[i], q = poly[(i + 1) % n], ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((cx - p.x) * ex + (cz - p.z) * ez) / l2));
      r = Math.min(r, Math.hypot(cx - (p.x + ex * t), cz - (p.z + ez * t)));
    }
    return { area: Math.abs(a), cx, cz, r };
  }
  // add or update a plane: matrix = plane-local -> world (y is the normal), poly = [{x, z}] in plane-local space
  function setPlane(key, matrix, poly, horizontal, stamp) {
    let rec = planes.get(key);
    const st = polyStats(poly);
    if (!rec) {
      rec = { mesh: null, stamp: -1 };
      planes.set(key, rec);
    }
    if (rec.stamp !== stamp || !rec.mesh) {
      if (rec.mesh) { roomGroup.remove(rec.mesh); rec.mesh.geometry.dispose(); }
      const pos = [];
      for (let i = 1; i < poly.length - 1; i++) pos.push(poly[0].x, 0, poly[0].z, poly[i].x, 0, poly[i].z, poly[i + 1].x, 0, poly[i + 1].z);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      rec.mesh = new Mesh(g, occMat); rec.mesh.renderOrder = -50; rec.mesh.matrixAutoUpdate = false; rec.mesh.frustumCulled = false;
      rec.mesh.userData.noShadow = rec.mesh.userData.noOutline = true;
      roomGroup.add(rec.mesh);
      rec.stamp = stamp;
    }
    rec.mesh.matrix.copy(matrix); rec.mesh.matrixWorldNeedsUpdate = true;
    _v.set(st.cx, 0, st.cz).applyMatrix4(matrix);
    rec.horizontal = horizontal; rec.y = _v.y; rec.cx = _v.x; rec.cz = _v.z; rec.area = st.area; rec.radius = st.r; rec.seen = age;
    return rec;
  }
  function setMesh(key, matrix, vertices, indices, stamp) {
    let rec = meshes.get(key);
    if (!rec) { rec = { mesh: null, stamp: -1 }; meshes.set(key, rec); }
    if (rec.stamp !== stamp || !rec.mesh) {
      if (rec.mesh) { roomGroup.remove(rec.mesh); rec.mesh.geometry.dispose(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
      if (indices) g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      rec.mesh = new Mesh(g, occMat); rec.mesh.renderOrder = -50; rec.mesh.matrixAutoUpdate = false; rec.mesh.frustumCulled = false;
      roomGroup.add(rec.mesh); rec.stamp = stamp;
    }
    rec.mesh.matrix.copy(matrix); rec.mesh.matrixWorldNeedsUpdate = true; rec.seen = age;
  }
  function drop(map, k) { const r = map.get(k); if (r && r.mesh) { roomGroup.remove(r.mesh); r.mesh.geometry.dispose(); } map.delete(k); }

  function poll() {
    const xr = ctx.renderer && ctx.renderer.xr;
    const frame = xr && xr.getFrame ? xr.getFrame() : null, ref = xr && xr.getReferenceSpace ? xr.getReferenceSpace() : null;
    if (!frame || !ref) return;
    const f = env.features;
    if (f.planes && frame.detectedPlanes) {
      for (const pl of frame.detectedPlanes) {
        if (!poseMatrix(frame, pl.planeSpace, ref, _m)) continue;
        const poly = Array.from(pl.polygon, (p) => ({ x: p.x, z: p.z }));
        if (poly.length >= 3) setPlane(pl, _m, poly, pl.orientation === 'horizontal', pl.lastChangedTime);
      }
      for (const k of [...planes.keys()]) if (planes.get(k).seen !== age && typeof k === 'object') drop(planes, k);
    }
    if (f.meshes && frame.detectedMeshes) {
      let tris = 0;
      for (const m of frame.detectedMeshes) {
        if (tris > 60000 || !poseMatrix(frame, m.meshSpace, ref, _m)) continue;
        tris += m.indices ? m.indices.length / 3 : 0;
        setMesh(m, _m, m.vertices, m.indices, m.lastChangedTime);
      }
      for (const k of [...meshes.keys()]) if (meshes.get(k).seen !== age && typeof k === 'object') drop(meshes, k);
    }
  }

  // Walls: vertical planes -> fixed colliders in GAME space so bodies and thrown things bounce off real walls (needs physics + planes).
  function syncWalls() {
    const P = world.physics;
    if (!P || !P.world || !P.rapier) return;
    const vert = [];
    for (const [k, r] of planes) if (!r.horizontal && r.area > 0.6 && r.mesh) vert.push([k, r]);
    vert.sort((a, b) => b[1].area - a[1].area);
    const use = vert.slice(0, 6);
    const sig = use.map(([k, r]) => `${r.stamp}:${r.cx.toFixed(2)},${r.cz.toFixed(2)}`).join('|') + `|${env.T.x.toFixed(2)},${env.T.z.toFixed(2)},${env.T.s.toFixed(3)},${env.T.yaw.toFixed(2)}`;
    if (sig === wallSig) return;
    wallSig = sig;
    clearWalls();
    const R = P.rapier;
    for (const [, r] of use) {
      r.mesh.matrix.decompose(_v, _q, _s);
      // plane normal = local +y rotated into the room; the collider is a slab 0.4 game-m thick, 60 x 30 game-m
      const nrm = new Vector3(0, 1, 0).applyQuaternion(_q);
      const cRoom = new Vector3(r.cx, r.y, r.cz), cGame = env.toGame(cRoom, new Vector3());
      const nGame = env.dirToGame(nrm, new Vector3()).normalize();
      const qq = new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), nGame);
      try {
        const d = R.ColliderDesc.cuboid(80, 0.4, 80).setTranslation(cGame.x - nGame.x * 0.4, cGame.y - nGame.y * 0.4, cGame.z - nGame.z * 0.4)
          .setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }).setFriction(0.5).setRestitution(0.5).setCollisionGroups(0x1ffff);
        walls.push(P.world.createCollider(d));
      } catch (e) { /* ignore */ }
    }
  }
  function clearWalls() {
    const P = world.physics;
    for (const c of walls) { try { P && P.world && P.world.removeCollider(c, false); } catch (e) { /* gone */ } }
    walls.length = 0;
  }

  const api = {
    planes, meshes, walls,
    // feed planes without an XR frame (tests, the desktop simulation). p = { id, center:{x,y,z}, w, d, orientation, yaw?, normal? }
    ingest(list) {
      age++;
      for (const p of list) {
        const m = new Matrix4();
        if (p.orientation === 'vertical') {
          const q = new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(p.normal?.x ?? 0, p.normal?.y ?? 0, p.normal?.z ?? 1).normalize());
          m.compose(new Vector3(p.center.x, p.center.y, p.center.z), q, new Vector3(1, 1, 1));
        } else m.compose(new Vector3(p.center.x, p.center.y, p.center.z), new THREE.Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.yaw ?? 0), new Vector3(1, 1, 1));
        const hw = p.w / 2, hd = p.d / 2;
        setPlane(p.id ?? p, m, [{ x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd }], p.orientation !== 'vertical', (p.rev ?? 0));
      }
      for (const k of [...planes.keys()]) if (planes.get(k).seen !== age) drop(planes, k);
    },
    // the best table-height horizontal surface near the player, or null
    pickSurface(head, dir) {
      let best = null, bs = 0;
      for (const [, r] of planes) {
        if (!r.horizontal || r.y < 0.5 || r.y > 1.1 || r.area < 0.25 || r.radius < 0.22) continue;
        const d = Math.hypot(r.cx - head.x, r.cz - head.z);
        if (d > 3 || d < 0.45) continue;
        const ahead = (r.cx - head.x) * dir.x + (r.cz - head.z) * dir.z;
        const score = r.area * (ahead > 0 ? 1.4 : 0.6) / (0.6 + d);
        if (score > bs) { bs = score; best = r; }
      }
      return best ? { x: best.cx, y: best.y, z: best.cz, radius: Math.min(0.75, best.radius), area: best.area } : null;
    },
    get occluders() { return planes.size + meshes.size; },
    enter() { age = 0; pollT = 0; },
    exit() {
      for (const k of [...planes.keys()]) drop(planes, k);
      for (const k of [...meshes.keys()]) drop(meshes, k);
      clearWalls(); wallSig = '';
    },
    update(dt) {
      const f = env.features;
      if (!env.active) return;
      if (f.planes || f.meshes) {
        pollT -= dt;
        if (pollT <= 0) { pollT = 0.5; age++; try { poll(); } catch (err) { console.error('[mr] room poll failed', err); } }
      }
      if (planes.size) {
        // a surface found after the first placement: move the table onto it (unless the player already moved it)
        if (S.placed && !S.onSurface && !S.userMoved && !env.inside && !S.step && ctx.clock.t - (S.placedAt ?? 0) < 12) {
          const s = api.pickSurface(ctx.player.head, { x: ctx.player.forward.x, z: ctx.player.forward.z });
          if (s && world.mr) world.mr.place({ center: { x: s.x, y: s.y, z: s.z }, size: s.radius, surface: true });
        }
        if (f.planes || S.simPlanes) syncWalls();
      }
    },
    dispose() { api.exit(); occMat.dispose(); },
  };
  return api;
}
