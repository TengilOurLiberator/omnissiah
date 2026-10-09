// library/modelkit.js - H.mx: the glue between library entries and world.models / kit destruction. Imported by structures.js, which
// installs it on the shared helper bundle H (H.mx) before nature / props / scenarios load.
// WHY: every entry used to be a vertex-coloured primitive build. Entries now keep that build as the FALLBACK and get an optional MODEL
// build registered next to it:
//     def('well', desc, opts, aliases, primitiveBuild, extra)         // the old builder, untouched
//     mx.model('well', {                                              // new: used when world.models exists and every model loads
//       model(P, o) { const w = P('well-red', { height: 2.2 }); return { w }; },   // P(name, opts) -> piece; throws (-> fallback) if the catalogue lacks it
//       after(pieces, plan, o) { ... },                              // runs once ALL models have loaded (pieces[i].ok, .obj, .size, .aabb())
//       destruct: { kind: 'break' | 'structure' | 'fell' | 'none', material: 'stone', hp: 80, stages: 'auto', block: false, collide, rubble: 'rock-large-a' },
//       phys: { shape: 'box', mass: 12, friction, bounce },          // optional: the finished prop becomes ONE loose rigid body (mx.dynamic)
//     });
//   and def() wraps the build with mx.wrap(name, primitiveBuild). The library handle is returned immediately; models arrive asynchronously
//   (a wireframe placeholder shows meanwhile). If world.models is missing, the catalogue lacks a name, or any model fails to load, the pieces
//   are removed and the primitive build runs instead (it is then wrapped in a destructible too, so both paths break).
//
// piece = mx.place(inst, name, { x, z, y, yaw, scale, height, anchor: 'origin' | 'center', follow, sink })   (inst-LOCAL x/z; y defaults to terrain)
//   piece.obj (Group; animate/hide it), piece.h (models handle), piece.ready (Promise), piece.ok (loaded, no error), piece.size (metres, after
//   load), piece.aabb() -> { min, max } Box3 in the instance group's local space, piece.tint(hex|null), piece.hide(), piece.palette() -> colours.
//
// DESTRUCTION on model objects: kit.destructible profiles an object's Box3 and colours when wrapped, and a glTF atlas model is white / may not have
// arrived yet. So breakable()/structure() wrap an invisible PROXY (one invisible box volume + invisible probe meshes with colours sampled from the
// atlas): debris gets the right size and colour; on break the proxy's onBreak hides the real model pieces (or zeroes an instance).
//   mx.breakable(inst, items, { material, hp, pieces, mass, block, collide, stages, rubble, onBreak, onDamage, colors })   items = pieces and/or Object3Ds
//        kit adds a FIXED collider ('prop' group: things hit it, walkers pass); block: true also stops player + NPCs (its steering circles wait until the
//        player has stepped out of the footprint); collide:false for anything that moves (phys / mx.dynamic / mx.solid bodies)
//   mx.structure(inst, [{ items, material, hp, supports: [partIndex], block, collide }], { onCollapse })   mx.fellable(inst, piece | Object3D, { hp, block, onFell })
//   mx.scatter(inst, [{ name, x, z, y?, yaw?, scale? }], { fell: { hp } | breakable: { material, hp } | none, near: 12, range: 28 })
//        instanced run (forest, fence, graveyard...) = 1-3 draw calls; breakable: one proxy per item; fell: the nearest `near` trees become real kit.fellable models.
//   mx.block(inst, lx, lz, r) kit.obstacle (never within r + 1 m of the player)   mx.later(inst, fn) run on the first tick (groupScale and transforms final)
// PHYSICS: mx.solid(inst, mesh, { shape, mass, friction, bounce, grab, up, at, own }) = kit.body with a collider fitted to the mesh bounds, resting on the ground;
//   mx.dynamic(inst, { shape, mass }) = everything the entry built becomes ONE loose body; mx.collider(inst, localBox3, { block }) = fixed collider (blocking ones
//   wait until the player is out); mx.room(inst, n, 'crates') = how many of n bodies fit (perf.allow / canSpawn, tells the player); mx.fit(obj), mx.physics().
export default function installModelKit(H) {
  if (H.mx) return H.mx;
  const THREE = H.THREE;
  const { Vector3, Box3, Matrix4, Color, Mesh, Group } = THREE;
  const MB = new Map(); // entry name -> model spec
  const M = () => H.ctx.world.models ?? null;
  const K = () => H.ctx.world.kit ?? null;
  const MISSING = { missing: true };
  const ZERO = new Matrix4().makeScale(0, 0, 0);
  const _c = new Color();

  // ------------------------------------------------------------------ colour repair for the Kenney Nature Kit
  // The shipped nature-kit GLBs carry flat material colours that came out of the asset build hue-shifted (leaves teal, bark salmon, stone cyan).
  // Until the GLBs are rebuilt, repair the shared materials once: only a material whose colour is exactly the known-wrong value is touched.
  const NATURE_FIX = {
    grass: ['2cd8b8', 0x68a845], leafsGreen: ['29c9ab', 0x5aa03c], leafsDark: ['2ba6aa', 0x3e7a45], leafsFall: ['ff9241', 0xe0802c], woodBark: ['e28357', 0x7e5535],
    woodBarkDark: ['cc765e', 0x5e4029], wood: ['ff8e62', 0xa57a4a], woodDark: ['c46d4b', 0x6b4a2c], woodInner: ['f5d7bb', 0xd7b98a], woodBirch: ['fff2de', 0xece6d8],
    dirt: ['e28357', 0x7a5a3a], dirtDark: ['b56845', 0x5a4028], stone: ['b8e2e8', 0x9a9a98], stoneDark: ['9ab5ba', 0x75757a], corn: ['f5bc64', 0xe6b84a],
    colorPurple: ['9f89ff', 0x8a6ad8], colorRed: ['e04a50', 0xd84a4a], colorRedDark: ['c1363b', 0xa83030], colorTan: ['ffae6f', 0xd9a066], colorYellow: ['feb147', 0xf2c542],
  };
  const fixed = new WeakSet();
  function repairColours(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m || fixed.has(m)) continue;
        fixed.add(m);
        const f = NATURE_FIX[m.name];
        if (f && !m.map && m.color.getHexString() === f[0]) m.color.setHex(f[1]);
      }
    });
  }

  // ------------------------------------------------------------------ pieces
  function place(i, name, o = {}) {
    const m = M();
    if (!m || typeof m.has !== 'function' || !m.has(name)) return null;
    const lx = o.x ?? 0, lz = o.z ?? 0, yaw = o.yaw ?? 0;
    const ly = (o.y ?? (o.follow === false ? 0 : i.gy(lx, lz) - i.y)) - (o.sink ?? 0);
    const h = m.spawn(i.ctx, name, { parent: i.group, position: [lx, ly, lz], yaw, scale: o.scale, height: o.height, castShadow: o.castShadow });
    const p = {
      name, h, obj: h.object, inst: i, x: lx, y: ly, z: lz, yaw, k: o.scale ?? 1, ok: false, failed: false, size: new Vector3(), min: new Vector3(), anchor: o.anchor ?? 'origin', _pal: null,
      aabb() { return aabbOf(p); },
      tint(hex) { if (h.loaded) h.setTint(hex); },
      hide() { p.obj.visible = false; },
      palette() { return (p._pal ??= paletteOf(p)); },
    };
    p.ready = h.ready.then(() => {
      if (h.removed) return p;
      if (h.error || !h.loaded) { p.failed = true; return p; }
      p.ok = true;
      repairColours(h.root);
      const e = h.entry, f = h.fit || 1;
      // entry.size / min are the model's native bounds; h.fit scales them to metres (the wrapper lifts the bottom to y = 0)
      p.size.set(e.size[0] * f, e.size[1] * f, e.size[2] * f).multiplyScalar(p.k);
      p.min.set(e.min[0] * f, 0, e.min[2] * f).multiplyScalar(p.k);
      if (p.anchor === 'center') { // put the model's footprint centre on (x, z)
        const cx = p.min.x + p.size.x / 2, cz = p.min.z + p.size.z / 2, c = Math.cos(yaw), s = Math.sin(yaw);
        p.obj.position.x = lx - (cx * c + cz * s); p.obj.position.z = lz - (-cx * s + cz * c);
        p.x = p.obj.position.x; p.z = p.obj.position.z;
      }
      return p;
    });
    i.cleanup(() => h.remove());
    return p;
  }
  // axis-aligned bounds of a loaded piece in the instance group's local space
  function aabbOf(p) {
    const b = new Box3(), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (const x of [p.min.x, p.min.x + p.size.x]) for (const z of [p.min.z, p.min.z + p.size.z]) {
      b.expandByPoint(_v.set(p.obj.position.x + x * c + z * s, p.obj.position.y, p.obj.position.z - x * s + z * c));
      b.expandByPoint(_v.set(p.obj.position.x + x * c + z * s, p.obj.position.y + p.size.y, p.obj.position.z - x * s + z * c));
    }
    return b;
  }
  const _v = new Vector3();

  // ------------------------------------------------------------------ colours sampled from a model's atlas (for debris)
  const texPix = new WeakMap();
  function pixels(tex) {
    if (texPix.has(tex)) return texPix.get(tex);
    let r = null;
    try {
      const img = tex.image;
      if (img && typeof document !== 'undefined') {
        const cv = document.createElement('canvas'); cv.width = cv.height = 64;
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, 64, 64);
        r = cx.getImageData(0, 0, 64, 64).data;
      }
    } catch (err) { r = null; }
    texPix.set(tex, r);
    return r;
  }
  function paletteOf(p, n = 3) {
    const buckets = new Map();
    try {
      p.h.root.traverse((o) => {
        if (!o.isMesh) return;
        const mat = [].concat(o.material)[0], g = o.geometry, uv = g.attributes.uv, pos = g.attributes.position;
        const px = mat.map ? pixels(mat.map) : null, step = Math.max(1, (pos.count / 120) | 0);
        for (let v = 0; v < pos.count; v += step) {
          let r, gg, b;
          if (px && uv) {
            const x = Math.min(63, Math.max(0, (uv.getX(v) * 64) | 0)), y = Math.min(63, Math.max(0, ((mat.map.flipY ? 1 - uv.getY(v) : uv.getY(v)) * 64) | 0)), k = (y * 64 + x) * 4;
            r = px[k]; gg = px[k + 1]; b = px[k + 2];
          } else { const hx = mat.color.getHex(); r = hx >> 16 & 255; gg = hx >> 8 & 255; b = hx & 255; }
          const key = (r >> 4) << 8 | (gg >> 4) << 4 | (b >> 4);
          const e = buckets.get(key);
          if (e) { e.n++; e.r += r; e.g += gg; e.b += b; } else buckets.set(key, { n: 1, r, g: gg, b });
        }
      });
    } catch (err) { /* palette stays empty */ }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, n);
    const total = top.reduce((s, e) => s + e.n, 0) || 1;
    return top.map((e) => ({ hex: ((e.r / e.n) | 0) << 16 | ((e.g / e.n) | 0) << 8 | ((e.b / e.n) | 0), w: e.n / total }));
  }

  // ------------------------------------------------------------------ proxy: an invisible stand-in with the right volume and colours
  const UNIT = new THREE.BoxGeometry(1, 1, 1); UNIT.userData.shared = true;
  const probeMats = new Map();
  const probeMat = (hex) => { let m = probeMats.get(hex); if (!m) { m = new THREE.MeshBasicMaterial({ visible: false }); m.color.setHex(hex); probeMats.set(hex, m); } return m; };
  const DEFAULT_COLORS = {
    wood: [{ hex: 0x8a5a32, w: 0.6 }, { hex: 0x5e3c20, w: 0.4 }], stone: [{ hex: 0x8a8680, w: 0.6 }, { hex: 0x6e6a64, w: 0.4 }], glass: [{ hex: 0xbfe6f0, w: 1 }],
    metal: [{ hex: 0x8d96a0, w: 0.6 }, { hex: 0x4a4e58, w: 0.4 }], crystal: [{ hex: 0x9a7bff, w: 1 }], ice: [{ hex: 0xcdeeff, w: 1 }], earth: [{ hex: 0x6b5238, w: 0.5 }, { hex: 0x4f8f3a, w: 0.5 }],
    cloth: [{ hex: 0xb04a3a, w: 0.6 }, { hex: 0xe8dcc0, w: 0.4 }],
  };
  function makeProxy(i, boxes, colors, material) {
    const bb = new Box3();
    for (const b of boxes) bb.union(b);
    const g = new Group(); g.name = 'break-proxy'; g.userData.noShadow = true; g.userData.noOutline = true;
    const sz = bb.getSize(new Vector3()), ctr = bb.getCenter(new Vector3());
    const vol = new Mesh(UNIT, probeMat(0x888888)); vol.visible = false; vol.position.copy(ctr); vol.scale.set(Math.max(0.05, sz.x), Math.max(0.05, sz.y), Math.max(0.05, sz.z));
    vol.userData.noShadow = true; g.add(vol);
    const cols = colors && colors.length ? colors : DEFAULT_COLORS[material] ?? DEFAULT_COLORS.wood;
    const sc = Math.min(sz.x, sz.y, sz.z) * 0.2 + 0.02;
    for (const c of cols) {
      _c.setRGB((c.hex >> 16 & 255) / 255, (c.hex >> 8 & 255) / 255, (c.hex & 255) / 255, THREE.SRGBColorSpace);
      const pr = new Mesh(UNIT, probeMat(_c.getHex())); // getHex() is sRGB; Color.set(hex) in probeMat converts back to the same working colour
      pr.position.copy(ctr); pr.scale.setScalar(Math.max(0.02, Math.sqrt(c.w) * sc)); pr.userData.noShadow = true; g.add(pr);
    }
    i.group.add(g);
    g.updateWorldMatrix(true, true);
    return g;
  }

  // ------------------------------------------------------------------ stages (visual wear on model pieces)
  const AUTO = [{ at: 0.66, drop: 2, tint: 0.12 }, { at: 0.33, drop: 4, tint: 0.28, lean: 0.025 }];
  function modelStages(pieces, stages) {
    if (stages === 'auto' || stages === true) stages = AUTO;
    if (!Array.isArray(stages)) return undefined;
    return stages.map((s) => ({
      at: s.at, drop: s.drop,
      onStage(h, st) {
        if (s.tint) for (const p of pieces) { _c.setScalar(1 - Math.min(0.9, s.tint)); p.h.setTint(_c.clone()); }
        if (s.lean) for (const p of pieces) { p.obj.rotation.z += s.lean; p.obj.rotation.x += s.lean * 0.5; }
        if (s.hide) for (const p of pieces) if (s.hide.includes(p.name)) p.obj.visible = false;
        if (s.onStage) s.onStage(h, st);
      },
    }));
  }

  // ------------------------------------------------------------------ breakable / structure / fellable
  function localBoxOf(i, obj) {
    obj.updateWorldMatrix(true, true);
    const w = new Box3().setFromObject(obj), b = new Box3();
    for (const x of [w.min.x, w.max.x]) for (const y of [w.min.y, w.max.y]) for (const z of [w.min.z, w.max.z]) b.expandByPoint(i.group.worldToLocal(_v.set(x, y, z)));
    return b;
  }
  const itemsBox = (items) => items.filter((x) => x.h).map((p) => p.aabb());
  function hideItems(items) { for (const it of items) { if (it.h) it.obj.visible = false; else if (it.isObject3D) it.visible = false; else if (it.set) it.set.setMatrixAt(it.k, ZERO); } }
  function rubbleAt(i, spec, boxes) {
    if (!spec || !M()) return;
    const b = new Box3(); for (const x of boxes) b.union(x);
    const c = b.getCenter(new Vector3()), s = b.getSize(new Vector3());
    const list = [].concat(spec), r = list[(Math.random() * list.length) | 0];
    const name = typeof r === 'string' ? r : r.name;
    // a string = a generic heap sized from the broken volume; an object { name, scale | height, sink } places that model as the aftermath (e.g. a ruined house)
    const po = typeof r === 'string' ? { height: Math.max(0.35, Math.min(1.1, Math.max(s.x, s.z) * 0.18)) } : { scale: r.scale, height: r.height, sink: r.sink };
    const p = place(i, name, { x: c.x, z: c.z, yaw: typeof r === 'object' && r.yaw !== undefined ? r.yaw : Math.random() * 6.28, anchor: 'center', ...po });
    if (p) p.ready.then(() => { if (!p.ok) p.h.remove(); });
  }
  function breakable(i, items, o = {}) {
    const k = K();
    if (!k || !k.destructible || i.removed) return null;
    items = [].concat(items).filter(Boolean);
    const pieces = items.filter((x) => x.h);
    const material = o.material ?? 'wood';
    let target, proxy = false, boxes = [];
    if (!pieces.length && items.length === 1 && items[0].isObject3D) { target = items[0]; boxes = [localBoxOf(i, target)]; } // primitive build: kit reads its own vertex colours
    else {
      boxes = itemsBox(items);
      if (!boxes.length) return null;
      const colors = o.colors ?? (pieces[0] && o.palette !== false ? pieces[0].palette() : null);
      target = makeProxy(i, boxes, colors, material);
      proxy = true;
    }
    const stages = proxy ? modelStages(pieces, o.stages) : o.stages;
    const bb = new Box3(); for (const b of boxes) bb.union(b);
    const late = !!o.block && !clearOf(i, bb); // the player stands in the footprint: the steering circles come later (the collider is 'prop' meanwhile)
    const h = k.destructible(i.ctx, target, {
      hp: o.hp, material, pieces: o.pieces, radius: o.radius, mass: o.mass, block: late ? false : o.block, collide: o.collide ?? (i._loose ? false : undefined), faction: o.faction, stages, onDamage: o.onDamage,
      onBreak(e) {
        if (proxy) hideItems(items);
        i.broken = (i.broken | 0) + 1;
        if (o.rubble) rubbleAt(i, o.rubble, boxes);
        if (o.onBreak) { try { o.onBreak(e); } catch (err) { console.error('[mx] onBreak', err); } }
      },
    });
    i.cleanup(() => h.remove());
    h.proxy = proxy ? target : null;
    if (late) i.tick(() => { if (h.removed || h.broken || i.removed) return true; if (clearOf(i, bb)) { circles(i, bb, h.obstacles); return true; } }, { every: 0.4 });
    return h;
  }
  // parts: [{ items, material, hp, supports:[indices], block, colors, stages, rubble }]
  function structure(i, parts, o = {}) {
    const k = K();
    if (!k || !k.structure || i.removed) return null;
    const defs = [];
    for (const p of parts) {
      const items = [].concat(p.items).filter(Boolean), pieces = items.filter((x) => x.h);
      const material = p.material ?? 'wood';
      let target, proxy = false, boxes = [];
      if (!pieces.length && items.length === 1 && items[0].isObject3D) { target = items[0]; boxes = [localBoxOf(i, target)]; }
      else {
        boxes = itemsBox(items);
        if (!boxes.length) continue;
        if (p.frac) boxes = boxes.map((b) => { const y0 = b.min.y, h = b.max.y - b.min.y, c = b.clone(); c.min.y = y0 + h * p.frac[0]; c.max.y = y0 + h * p.frac[1]; return c; }); // only that slice of the model is hittable
        target = makeProxy(i, boxes, p.colors ?? (pieces[0] ? pieces[0].palette() : null), material); proxy = true;
      }
      defs.push({
        object3D: target, hp: p.hp, material, pieces: p.pieces, block: p.block, collide: p.collide, mass: p.mass, supports: p.supports, stages: proxy ? modelStages(pieces, p.stages) : p.stages,
        onBreak() { if (proxy) hideItems(items); i.broken = (i.broken | 0) + 1; if (p.rubble) rubbleAt(i, p.rubble, boxes); if (p.onBreak) p.onBreak(); },
      });
    }
    if (!defs.length) return null;
    const s = k.structure(i.ctx, defs, { onCollapse: o.onCollapse });
    i.cleanup(() => s.remove());
    return s;
  }
  // the trunk / crown meshes of a loaded tree model (for kit.fellable: the crown shatters into leaves, the trunk into wood)
  function treeParts(p) {
    const meshes = [];
    p.h.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    if (meshes.length < 2) return {};
    let crown = null, best = -1;
    for (const m of meshes) { m.geometry.computeBoundingBox(); const s = m.geometry.boundingBox.getSize(_v); const v = s.x * s.y * s.z; if (v > best) { best = v; crown = m; } }
    const trunk = meshes.find((m) => m !== crown);
    return { trunk, crown };
  }
  function fellable(i, target, o = {}) {
    const k = K();
    if (!k || !k.fellable || i.removed) return null;
    const isPiece = !!target.h, obj = isPiece ? target.obj : target;
    const tp = isPiece ? treeParts(target) : {};
    const h = k.fellable(i.ctx, obj, { trunk: tp.trunk, crown: tp.crown, hp: o.hp, block: o.block, onFell(hh) { if (o.onFell) o.onFell(hh); } });
    i.cleanup(() => h.remove());
    obj.userData.fellH = h;
    return h;
  }

  // ------------------------------------------------------------------ scatter (instanced runs with per-item destruction)
  // item = { name, x, z, y?, yaw?, pitch? (about local X), roll? (about local Z: slope of a fence running along X), scale? } in the instance's local space
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), AX_Y = new Vector3(0, 1, 0), AX_X = new Vector3(1, 0, 0), AX_Z = new Vector3(0, 0, 1);
  function tfOf(s) {
    _qa.setFromAxisAngle(AX_Y, s.yaw ?? 0);
    if (s.pitch) _qa.multiply(_qb.setFromAxisAngle(AX_X, s.pitch));
    if (s.roll) _qa.multiply(_qb.setFromAxisAngle(AX_Z, s.roll));
    return { position: [s.x, s.y, s.z], quaternion: _qa.clone(), scale: s.sx !== undefined ? { x: s.sx, y: s.sy ?? s.sx, z: s.sz ?? s.sx } : s.scale ?? 1 };
  }
  function scatter(i, specs, o = {}) {
    const m = M();
    if (!m || !specs.length) return null;
    const names = new Map();
    specs.forEach((s, idx) => { s.idx = idx; if (m.has(s.name)) { if (!names.has(s.name)) names.set(s.name, []); names.get(s.name).push(s); } });
    if (!names.size) return null;
    const out = { items: specs, sets: [], real: 0, felled: 0, removed: false, remove() { if (out.removed) return; out.removed = true; for (const s of out.sets) s.remove(); } };
    for (const [name, list] of names) {
      for (const s of list) { s.y = s.y ?? (i.gy(s.x, s.z) - i.y); s.state = 0; s.wx = i.wx(s.x, s.z); s.wz = i.wz(s.x, s.z); }
      const set = m.instances(i.ctx, name, list.map(tfOf), { parent: i.group, castShadow: o.castShadow });
      out.sets.push(set);
      list.forEach((s, k) => { s.set = set; s.k = k; });
      set.ready.then(() => { if (set.error) out.failed = true; else for (const mm of set.meshes) repairColours(mm); });
    }
    i.cleanup(() => out.remove());
    const restore = (s) => s.set.setTransform(s.k, tfOf(s));
    if (o.breakable) {
      // one proxy per item once its model has loaded (only the entry's own spec decides material / hp)
      Promise.all(out.sets.map((s) => s.ready)).then(() => {
        if (i.removed || out.removed) return;
        for (const s of specs) {
          if (!s.set || s.set.error) continue;
          const info = m.info(s.name); if (!info) continue;
          const fit = (info.scale ?? 1) * (s.scale ?? 1), c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
          const box = new Box3();
          for (const x of [info.min[0] * fit, (info.min[0] + info.size[0]) * fit]) for (const z of [info.min[2] * fit, (info.min[2] + info.size[2]) * fit]) {
            box.expandByPoint(_v.set(s.x + x * c + z * sn, s.y, s.z - x * sn + z * c));
            box.expandByPoint(_v.set(s.x + x * c + z * sn, s.y + info.size[1] * fit, s.z - x * sn + z * c));
          }
          const bo = typeof o.breakable === 'function' ? o.breakable(s) : o.breakable;
          if (!bo) continue;
          const h = breakableBox(i, box, s, bo);
          if (h) s.h = h;
        }
      });
    }
    if (o.fell) {
      const K_ = o.near ?? 12, range = o.range ?? 30, fo = typeof o.fell === 'object' ? o.fell : {};
      const live = [];
      const promote = (s) => {
        s.state = 1;
        const p = place(i, s.name, { x: s.x, z: s.z, y: s.y, yaw: s.yaw ?? 0, scale: s.scale, castShadow: o.castShadow });
        if (!p) { s.state = 0; return; }
        s.p = p; live.push(s);
        p.ready.then(() => {
          if (s.state !== 1 || i.removed) { p.h.remove(); return; }
          if (!p.ok) { s.state = 0; return; }
          s.set.setMatrixAt(s.k, ZERO);
          s.fh = fellable(i, p, { hp: fo.hp, block: fo.block, onFell() {
            s.state = 2; out.felled++; out.real--;
            const k = live.indexOf(s); if (k >= 0) live.splice(k, 1);
            if (s.p) { s.p.h.remove(); s.p = null; } // the lying tree is hidden by kit; free the model (the stump stays)
            if (fo.onFell) fo.onFell(s);
          } });
          out.real++;
        });
      };
      const demote = (s) => {
        if (s.fh) { s.fh.remove(); s.fh = null; out.real--; }
        if (s.p) { s.p.h.remove(); s.p = null; }
        restore(s); s.state = 0;
        const k = live.indexOf(s); if (k >= 0) live.splice(k, 1);
      };
      const order = [];
      i.tick(() => {
        if (out.removed) return true;
        order.length = 0;
        for (const s of specs) {
          if (!s.set || s.state === 2) continue;
          const dx = s.wx - H.head.x, dz = s.wz - H.head.z, d = dx * dx + dz * dz;
          if (d < range * range) order.push({ s, d });
        }
        order.sort((a, b) => a.d - b.d);
        const want = new Set();
        for (let q = 0; q < Math.min(K_, order.length); q++) want.add(order[q].s);
        for (const s of live.slice()) if (!want.has(s) && !(s.fh && s.fh.hp < s.fh.damage.maxHp)) demote(s);
        for (const s of want) if (s.state === 0) promote(s);
      }, { every: 0.5 });
    }
    return out;
  }
  // a proxy destructible from an explicit local box (scatter items)
  function breakableBox(i, box, s, bo) {
    const k = K();
    if (!k || !k.destructible) return null;
    const info = M()?.info?.(s.name);
    const target = makeProxy(i, [box], bo.colors ?? null, bo.material ?? 'wood');
    const h = k.destructible(i.ctx, target, {
      hp: bo.hp, material: bo.material ?? 'wood', pieces: bo.pieces, mass: bo.mass, block: bo.block, collide: bo.collide, onBreak(e) { s.state = 2; s.set.setMatrixAt(s.k, ZERO); i.broken = (i.broken | 0) + 1; if (bo.onBreak) bo.onBreak(e, s); },
    });
    i.cleanup(() => h.remove());
    return h;
  }

  // scatter(); if no model is available (or it fails to load) remove it and run the primitive fallback instead
  function scatterOr(i, specs, o, fb) {
    const sc = scatter(i, specs, o);
    if (!sc) { fb(); return null; }
    Promise.all(sc.sets.map((s) => s.ready)).then(() => { if (i.removed || sc.removed) return; if (sc.failed) { sc.remove(); fb(); } });
    return sc;
  }

  // ------------------------------------------------------------------ spinPart: carve a rotating part (windmill sails, mill wheel) out of a fused static model
  // test(cx, cy, cz) is evaluated on each triangle centroid in the model's NATIVE coordinates (see the geometry bounds in the catalogue: entry.size/min before the
  // recommended scale); matching triangles move to a pivot Group at `pivot` (native coords) that you rotate: handle.pivot.rotation.z += dt. The shared cached
  // geometry is never touched (the piece gets its own two geometries, disposed with the instance).
  function spinPart(i, piece, test, pivot) {
    const meshes = [];
    piece.h.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const grp = new Group(); grp.name = 'spin'; grp.position.set(pivot[0], pivot[1], pivot[2]);
    let moved = 0;
    for (const mesh of meshes) {
      const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, idx = g.index;
      const nT = idx ? idx.count / 3 : pos.count / 3;
      const A = { p: [], n: [], u: [] }, B = { p: [], n: [], u: [] };
      for (let t = 0; t < nT; t++) {
        const v = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
        const cx = (pos.getX(v[0]) + pos.getX(v[1]) + pos.getX(v[2])) / 3, cy = (pos.getY(v[0]) + pos.getY(v[1]) + pos.getY(v[2])) / 3, cz = (pos.getZ(v[0]) + pos.getZ(v[1]) + pos.getZ(v[2])) / 3;
        const T_ = test(cx, cy, cz) ? B : A;
        const ox = T_ === B ? pivot[0] : 0, oy = T_ === B ? pivot[1] : 0, oz = T_ === B ? pivot[2] : 0;
        for (const k of v) {
          T_.p.push(pos.getX(k) - ox, pos.getY(k) - oy, pos.getZ(k) - oz);
          if (nor) T_.n.push(nor.getX(k), nor.getY(k), nor.getZ(k));
          if (uv) T_.u.push(uv.getX(k), uv.getY(k));
        }
        if (T_ === B) moved++;
      }
      if (!B.p.length) continue;
      const mk = (S) => { const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(S.p, 3)); if (S.n.length) ng.setAttribute('normal', new THREE.Float32BufferAttribute(S.n, 3)); if (S.u.length) ng.setAttribute('uv', new THREE.Float32BufferAttribute(S.u, 2)); ng.computeBoundingSphere(); ng.computeBoundingBox(); return ng; };
      const gA = mk(A), gB = mk(B);
      mesh.geometry = gA;
      const sm = new Mesh(gB, mesh.material); sm.name = 'spin-mesh'; grp.add(sm);
      i.cleanup(() => { gA.dispose(); gB.dispose(); });
    }
    if (moved) piece.h.root.add(grp);
    return { pivot: grp, moved };
  }

  // run n (typically the primitive builder with noStatic or a few i.add calls) and gather everything it added to the instance group into ONE body Group
  function captureBody(i, fn) {
    const before = new Set(i.group.children);
    fn();
    const added = i.group.children.filter((c) => !before.has(c));
    const body = new Group(); body.name = 'body';
    for (const c of added) body.add(c);
    i.group.add(body);
    return body;
  }

  // a decoration: a single model that is simply removed again if it fails to load (scenarios; returns null when world.models or the name is missing)
  function deco(i, name, o = {}) {
    const p = place(i, name, o);
    if (p) p.ready.then(() => { if (!p.ok) p.h.remove(); });
    return p;
  }

  // ------------------------------------------------------------------ misc
  function block(i, lx, lz, r) {
    const k = K();
    if (!k || !k.obstacle) return null;
    const w = i.at(lx, lz);
    if (Math.hypot(w.x - H.head.x, w.z - H.head.z) < r + 1.0) return null; // never trap the player
    const ob = k.obstacle(i.ctx, { position: { x: w.x, y: 0, z: w.z }, radius: r });
    i.cleanup(() => ob.remove());
    return ob;
  }
  function later(i, fn) {
    let done = false;
    i.tick(() => { if (done) return true; done = true; if (!i.removed) { try { fn(); } catch (err) { console.error('[mx] later', err); } } return true; });
  }

  // ------------------------------------------------------------------ physics: loose bodies, fixed colliders, budget
  const PHYS = () => { const p = H.ctx.world.physics; return p && p.ready ? p : null; };
  // true when the player's head is NOT inside the (instance-local) box's footprint: blocking things never close around the player
  const _cw = new Vector3();
  function clearOf(i, box, margin = 0.7) {
    i.group.updateWorldMatrix(true, false);
    const s = i.group.scale.x || 1;
    _cw.set((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2).applyMatrix4(i.group.matrixWorld);
    const r = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 * s + margin;
    return Math.hypot(H.head.x - _cw.x, H.head.z - _cw.z) > r;
  }
  // kit.obstacle circles along the long axis of a local box (what kit.destructible does for block: true), pushed into `out`
  function circles(i, box, out) {
    const k = K(); if (!k || !k.obstacle) return;
    const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, s = i.group.scale.x || 1;
    const long = Math.max(sx, sz), short = Math.max(0.3 / s, Math.min(sx, sz)), n = Math.max(1, Math.min(8, Math.ceil(long / (short * 0.9))));
    for (let q = 0; q < n; q++) {
      const t = n === 1 ? 0 : (q / (n - 1) - 0.5) * (long - short);
      _cw.set(cx + (sx >= sz ? t : 0), 0, cz + (sx >= sz ? 0 : t)).applyMatrix4(i.group.matrixWorld);
      const ob = k.obstacle(i.ctx, { position: { x: _cw.x, y: 0, z: _cw.z }, radius: short * 0.5 * s });
      i.cleanup(() => ob.remove()); if (out) out.push(ob);
    }
  }
  // extents of obj in its own frame (rotation ignored, scale applied) + the offset of its centre from its origin: { x, y, z, cx, cy, cz }
  const _fq = new THREE.Quaternion(), _fo = new Vector3();
  function fit(obj) {
    _fq.copy(obj.quaternion); obj.quaternion.identity(); obj.updateMatrixWorld(true);
    const b = new Box3().setFromObject(obj), c = b.getCenter(new Vector3()), sz = b.getSize(new Vector3());
    obj.getWorldPosition(_fo);
    obj.quaternion.copy(_fq); obj.updateMatrixWorld(true);
    return { x: sz.x, y: sz.y, z: sz.z, cx: c.x - _fo.x, cy: c.y - _fo.y, cz: c.z - _fo.z };
  }
  // A real rigid body for a prop whose mesh (origin anywhere) is not yet in the scene: the collider is fitted to the mesh bounds, the body is dropped so its
  // bottom rests on the ground at s.at (default the instance) + s.up. s: { shape 'box'|'cylinder'|'sphere'|'capsule', mass, friction, bounce, drag, grab, range,
  // ccd, roll, own, size (override), up, at: {x, z} } -> kit body (may have no .ph: over budget / no physics = the old sphere sim) | null. body.fit = extents.
  function solid(i, mesh, s = {}) {
    const f = fit(mesh), shape = s.shape ?? 'box', at = s.at ?? i, gy = H.ground(at.x, at.z);
    const size = s.size ?? (shape === 'sphere' ? Math.max(f.x, f.y, f.z) / 2 : shape === 'box' ? [f.x, f.y, f.z] : [Math.min(f.x, f.z) / 2, f.y]);
    const b = i.body(mesh, {
      radius: s.radius ?? Math.max(0.1, Math.max(f.x, f.y, f.z) / 2), mass: s.mass ?? 5, bounce: s.bounce ?? 0.1, friction: s.friction ?? 0.7, drag: s.drag, shape, size, rotate: s.rotate,
      roll: s.roll ?? (shape === 'sphere'), ccd: s.ccd, group: s.group, angularDamping: s.angular, grabbable: !!s.grab, grabRange: s.grab ? (s.range ?? 4) : 0,
      position: { x: at.x + (s.dx ?? 0), y: gy + f.y / 2 - f.cy + (s.lift ?? 0.03) + (s.up ?? 0), z: at.z + (s.dz ?? 0) },
    });
    if (b) { b.fit = f; if (s.own) b.cool = Infinity; } // s.own: the prop carries its own damageable: kit's per-body damage sweep would bounce it off itself above 3 m/s
    return b;
  }
  // Turn everything an entry built (instance group children: models, primitives, break proxies) into ONE dynamic rigid body fitted to its bounds, e.g. a chair
  // or table that tips over and can be pushed. s: { shape, mass, friction, bounce }. null (and nothing changes) without physics or body budget.
  function dynamic(i, s = {}) {
    const P = PHYS();
    if (!P || i.removed || i.dynGroup || (P.canSpawn && !P.canSpawn('body'))) return null;
    const kids = i.group.children.slice();
    if (!kids.length) return null;
    const g = new Group(); g.name = 'dyn:' + i.name;
    g.position.copy(i.group.position); g.quaternion.copy(i.group.quaternion); g.scale.copy(i.group.scale); g.position.y += s.lift ?? 0.03;
    for (const c of kids) g.add(c);
    (i.ctx.root ?? H.ctx.root).add(g);
    const h = P.body(i.ctx, g, { shape: s.shape ?? 'box', mass: s.mass ?? 5, friction: s.friction ?? 0.7, restitution: s.bounce ?? 0.08, linearDamping: s.drag, angularDamping: s.angular });
    const home = () => { for (const c of g.children.slice()) i.group.add(c); g.removeFromParent(); };
    if (!h) { home(); return null; }
    i.dynGroup = g; i.dynBody = h; i.track(g);
    i.cleanup(() => { h.remove(); home(); });
    i.tick(() => { if (i.broken) { h.remove(); return true; } }, { every: 0.1 });
    return h;
  }
  // Fixed collider (no rendering) from a local box: o.block = walkers are stopped too ('world' group), else only things that fly into it ('prop').
  // Created on the first tick so the final scale / yaw apply, and a blocking one waits until the player has stepped out of its footprint.
  function collider(i, box, o = {}) {
    const make = () => {
      const P = PHYS(); if (!P || i.removed) return;
      i.group.updateWorldMatrix(true, false);
      const ctr = box.getCenter(new Vector3()).applyMatrix4(i.group.matrixWorld), q = new THREE.Quaternion(), sc = new Vector3(), p0 = new Vector3();
      i.group.matrixWorld.decompose(p0, q, sc);
      const sz = box.getSize(new Vector3()).multiply(sc);
      const h = P.body(i.ctx, null, { type: 'fixed', shape: o.shape ?? 'box', size: o.shape === 'cylinder' ? [Math.min(sz.x, sz.z) / 2, sz.y] : [sz.x, sz.y, sz.z], position: ctr, quaternion: q, friction: o.friction ?? 0.7, restitution: o.bounce ?? 0.1, group: o.block ? 'world' : 'prop' });
      if (h) i.cleanup(() => h.remove());
    };
    let done = false;
    i.tick(() => { if (done) return true; if (o.block && !clearOf(i, box)) return; done = true; if (!i.removed) { try { make(); } catch (err) { console.error('[mx] collider', err); } } return true; }, { every: 0.3 });
  }
  // How many of n bodies may be spawned right now (perf.allow -> perf.canSpawn -> physics.canSpawn); tells the player when trimmed.
  function room(i, n, what = 'pieces') {
    const k = H.allow('bodies', n); // perf.allow -> perf.canSpawn -> physics.canSpawn (core/library.js)
    if (k < n) H.tell(`Only room for ${k} of ${n} ${what} right now.`);
    return k;
  }

  // ------------------------------------------------------------------ registry + wrap
  function runModel(i, o, spec, fallback, idx) {
    if (spec.build) return spec.build(i, o, () => runFallback(i, o, spec, fallback, idx), fallback); // full control (scatter based entries): spec.build(i, o, fallbackFn, primitiveBuilder)
    const pieces = [];
    let plan = null;
    const P = (name, po) => { const p = place(i, name, po); if (!p) throw MISSING; pieces.push(p); return p; };
    const fail = () => { for (const p of pieces) p.h.remove(); pieces.length = 0; };
    try { plan = spec.model(P, o, i) ?? {}; }
    catch (err) { fail(); if (err !== MISSING) console.error(`[library] model build of "${i.name}" failed; using primitives`, err); return runFallback(i, o, spec, fallback, idx); }
    if (!pieces.length) return runFallback(i, o, spec, fallback, idx);
    Promise.all(pieces.map((p) => p.ready)).then(() => {
      if (i.removed) return;
      if (pieces.some((p) => !p.ok)) { fail(); runFallback(i, o, spec, fallback, idx); return; }
      try {
        // after(pieces, plan, o, fallback): `fallback(i, { ...o, noStatic: true })` re-runs the primitive builder's behaviour parts (fire, light, spin, particles)
        // when that builder honours o.noStatic (it then skips its static body meshes)
        if (spec.after) spec.after(pieces, plan, o, fallback);
        else if (plan.after) plan.after(pieces, plan, o, fallback);
        const loose = !!spec.phys && !!PHYS();
        if (loose) i._loose = true; // the fixed collider kit would add to the break proxy must not stay behind when the prop moves
        applyDestruct(i, o, spec.destruct, pieces, plan);
        if (loose && !dynamic(i, physOf(spec, i, o))) i._loose = false;
      } catch (err) { console.error(`[library] "${i.name}" after-load failed`, err); }
    });
    return undefined;
  }
  const physOf = (spec, i, o) => (typeof spec.phys === 'function' ? spec.phys(i, o) : spec.phys);
  function runFallback(i, o, spec, fallback, idx) {
    const before = new Set(i.group.children);
    const r = fallback(i, o, idx);
    const added = i.group.children.filter((c) => !before.has(c));
    const wantDestruct = spec && spec.destruct && (spec.destruct.kind !== 'none' || spec.destruct.primitive);
    if (spec && (wantDestruct || spec.phys) && added.length) {
      const body = new Group(); body.name = 'body';
      for (const c of added) body.add(c);
      i.group.add(body);
      i.bodyGroup = body; // (inst.body is the kit.body wrapper: never overwrite it)
      later(i, () => {
        const loose = !!spec.phys && !!PHYS();
        if (loose) i._loose = true;
        if (wantDestruct) applyDestruct(i, o, spec.destruct, [body], null, true);
        if (loose && !dynamic(i, physOf(spec, i, o))) i._loose = false;
      });
    }
    return r;
  }
  function applyDestruct(i, o, d, pieces, plan, primitive) {
    if (d && primitive && d.primitive) d = d.primitive; // destruct: { kind: 'none', primitive: {...} } = the model build wires its own destruction, the primitive build uses this
    if (!d || d.kind === 'none' || i.removed) return;
    if (typeof d === 'function') { d(i, pieces, plan, o); return; }
    const kind = d.kind ?? 'break';
    const common = { material: d.material, hp: d.hp, stages: d.stages, block: d.block, collide: d.collide, rubble: d.rubble, mass: d.mass, pieces: d.chunks, colors: d.colors, onBreak: d.onBreak };
    if (kind === 'break') breakable(i, pieces, common);
    else if (kind === 'fell') { if (pieces[0]) fellable(i, pieces[0], { hp: d.hp, block: d.block, onFell: d.onBreak }); }
    else if (kind === 'structure') {
      const parts = typeof d.parts === 'function' ? d.parts(pieces, primitive) : primitive ? [{ items: pieces, material: d.material, hp: d.hp, stages: d.stages, block: d.block }] : null;
      if (parts) structure(i, parts, { onCollapse: d.onCollapse });
      else breakable(i, pieces, common);
    }
  }
  const mx = {
    place, deco, repair: repairColours, spinPart, scatterOr, captureBody, makeProxy, breakable, structure, fellable, scatter, block, later, paletteOf, treeParts, ZERO, AUTO,
    fit, solid, dynamic, collider, room, clearOf, circles, physics: PHYS,
    has: (name) => !!(M() && M().has(name)),
    models: M,
    model(name, spec) { MB.set(name, spec); },
    // wrap a primitive builder: the registered model spec (if any) runs first, the primitive build is the fallback
    wrap(name, primitive) {
      return (i, o, idx) => {
        const spec = MB.get(name);
        if (!spec || !(spec.model || spec.build) || !M()) return runFallback(i, o, spec ?? null, primitive, idx);
        return runModel(i, o, spec, primitive, idx);
      };
    },
    specs: MB,
  };
  H.mx = mx;
  return mx;
}

