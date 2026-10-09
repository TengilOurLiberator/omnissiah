// library/props.js - furniture, containers, interactive toys, firing machines and decorations.
// Props are real rigid bodies fitted to their meshes (crates stack, barrels roll, chairs tip, blasts throw them); big fixed scenery blocks; cannon / catapult shoot real balls; piles obey perf.allow. Interactive ones react to your hands: press trigger/squeeze near them.
//
// MODELS: every entry keeps its primitive build as the FALLBACK; `mx.model(name, {...})` registrations at the bottom of the file give
// it a catalogue-model build (see library/modelkit.js). Conventions used here:
//   * physics props (barrel, crate, lantern ...) create their body in `after` (physModel: collider fitted to the loaded model), the piece rides in the body
//     mesh with an invisible breakable PROXY (collide:false); furniture with `phys` becomes one loose body (mx.dynamic).
//   * `i.beh` holds an entry's behaviour handles; the function-form `destruct(i, pieces, plan, o)` of a spec reads it (plan === null = primitive path).
//   * tickers of things that can break stop on `i.broken`.
//   * the five regalia (omni-altar ... omni-gate) use the model of the same name when world.models has it (checked at every spawn).
import installModelKit from './modelkit.js';
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, shade, mix, model, part, puffAt, worldAdd } = H;
  const PI = Math.PI;
  const mx = H.mx ?? installModelKit(H);
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'props', description, options, aliases, build: mx.wrap(name, build), ...extra });
  const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 0.7, 0), _sp = new THREE.Vector3(), _sb = new THREE.Box3();
  const near = (p, r) => { const dx = H.head.x - p.x, dz = H.head.z - p.z; return dx * dx + dz * dz < r * r; };
  const WOOD = 0x7a5230, WOODD = 0x4d3322, IRON = 0x2a2e36;
  const LOOT = ['sword', 'axe', 'bow', 'dagger', 'magic-staff', 'shield', 'crossbow', 'wand', 'warhammer', 'spear'];
  const world = (i, lx, ly, lz, out) => out.set(i.wx(lx, lz), i.y + ly, i.wz(lx, lz));
  function dropLoot(i, loot, at) {
    if (!loot) return;
    const type = loot === true ? pick(LOOT) : String(loot);
    const r = H.makeWeapon ? H.makeWeapon(i, type, { x: at.x, y: at.y + 0.5, z: at.z }, {}) : null;
    if (r && r.body && r.body.velocity) r.body.velocity.set(rand(-1.2, 1.2), 4, rand(-1.2, 1.2));
  }
  const dn = H.dens; // particle counts follow ctx.quality.density (read at emit time)
  // An explosion that really throws things: kit.explosion draws it, ONE kit.hit does the work with an explicit force (crates fly, a force >= 6 throws actors back,
  // chain reactions through other kegs). o: { size, color, damage, radius, force, from }
  function blast(i, pos, o = {}) {
    const K = H.kit(); if (!K) return;
    const dmg = o.damage ?? 30, size = o.size ?? 2;
    K.explosion(i.ctx, pos, { size, color: o.color ?? 0xff8a2a });
    K.hit(pos, o.radius ?? size * 2, dmg, { from: o.from, kind: 'explosion', force: o.force ?? dmg * 1.8 });
  }
  const BALL_MESH = (key, r, color) => H.model(key, (b) => { b.sph(0, 0, 0, r, r, r, color, 0, 8); }, { own: true });
  // A real cannonball / boulder: a raw physics body (kit.body would bounce off every crate's damageable sphere) that plows through props, hurts what it crosses
  // and explodes on its first hard landing or after v.life seconds. v: { pos, dir, speed, r, mass, gravity, damage, splash, force, boom: {size,color}, color, life }
  // -> { alive } | null (no physics / over budget: the caller falls back to combat.fire).
  function ballShot(i, v) {
    const P = H.ctx.world.physics;
    if (!P || !P.ready) return null;
    const m = BALL_MESH('ball:' + v.r + ':' + v.color, v.r, v.color), pos = _sp.copy(v.pos);
    _sb.setFromObject(i.group); // start outside the machine's own collider (a catapult arm tip is inside its box)
    for (let n = 0; n < 40 && _sb.distanceToPoint(pos) < v.r + 0.2; n++) pos.addScaledVector(v.dir, 0.15);
    m.position.copy(pos); i.ctx.root.add(m);
    const h = P.body(i.ctx, m, { shape: 'sphere', size: v.r, mass: v.mass, friction: 0.5, restitution: 0.12, ccd: true, linearDamping: 0.02, angularDamping: 0.4, gravityScale: (v.gravity ?? 9.8) / 9.8, position: pos });
    if (!h) { m.removeFromParent(); H.disposeOwn(m); return null; }
    const s = { h, m, alive: true, t: 0, sweep: 0 };
    h.setVelocity(v.dir.x * v.speed, v.dir.y * v.speed, v.dir.z * v.speed);
    const end = () => {
      if (!s.alive) return;
      s.alive = false;
      _w.set(h.position.x, h.position.y, h.position.z);
      h.remove(); m.removeFromParent(); H.disposeOwn(m);
      blast(i, _w, { size: v.boom.size, color: v.boom.color, damage: v.damage, radius: v.splash, force: v.force, from: 'player' });
      i.burst('bits', 0x8a8680, _w, dn(10), 1.2);
    };
    s.end = end;
    h.onContact((e) => { if (s.alive && (e.kind === 'ground' || e.kind === 'static') && e.speed > 4 && s.t > 0.05) end(); });
    s.update = (dt) => { // runs from the owner's ticker
      if (!s.alive) return;
      s.t += dt; s.sweep -= dt;
      if (h.removed) { s.alive = false; m.removeFromParent(); H.disposeOwn(m); return; }
      const sp = h.velocity.length();
      if (sp > 7 && s.sweep <= 0) { s.sweep = 0.05; H.kit()?.hit(h.position, v.r * 2.4, v.damage * 0.5, { from: 'player', kind: 'blunt', force: 0 }); } // plowing through: hurts crates, actors, anything in the way
      if (s.t > (v.life ?? 6)) end();
    };
    return s;
  }
  const stepBalls = (balls, dt) => { for (let q = balls.length - 1; q >= 0; q--) { balls[q].update(dt); if (!balls[q].alive) balls.splice(q, 1); } };

  // ================================================================ model helpers
  // function-form `destruct` for mx.model specs: cfg is a breakable() option object or (i, o, plan) -> that object; applies to model AND primitive path
  const brk = (cfg, onlyModel) => (i, pieces, plan, o) => {
    if (onlyModel && !plan) return;
    const c = typeof cfg === 'function' ? cfg(i, o, plan) : cfg;
    if (c) mx.breakable(i, pieces, c);
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // A merged static model is ONE mesh per material. splitParts() cuts it into animatable parts along its connected islands of triangles
  // (positions welded), cached per geometry: assign({ min, max, n }) -> index into `pivots` (pivots[0] = null = the part that stays put).
  // Returns Groups (children of the model root, native units) positioned at their pivot; the original meshes are hidden for this piece.
  const SPLITS = new WeakMap();
  function islandsOf(geo) {
    const pos = geo.attributes.position, idx = geo.index, nt = idx ? idx.count / 3 : pos.count / 3;
    const par = new Map();
    const find = (a) => { let r = a; while (par.get(r) !== r) r = par.get(r); while (par.get(a) !== r) { const n = par.get(a); par.set(a, r); a = n; } return r; };
    const key = (v) => Math.round(pos.getX(v) * 400) + ',' + Math.round(pos.getY(v) * 400) + ',' + Math.round(pos.getZ(v) * 400);
    const vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k), tk = new Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = key(vi(t, 0)), b = key(vi(t, 1)), c = key(vi(t, 2));
      tk[t] = a;
      for (const q of [a, b, c]) if (!par.has(q)) par.set(q, q);
      par.set(find(b), find(a)); par.set(find(c), find(a));
    }
    const isl = new Map();
    for (let t = 0; t < nt; t++) {
      const r = find(tk[t]);
      let e = isl.get(r);
      if (!e) isl.set(r, (e = { tris: [], min: V3(1e9, 1e9, 1e9), max: V3(-1e9, -1e9, -1e9) }));
      e.tris.push(t);
      for (let k = 0; k < 3; k++) { const v = vi(t, k); _v.set(pos.getX(v), pos.getY(v), pos.getZ(v)); e.min.min(_v); e.max.max(_v); }
    }
    return [...isl.values()];
  }
  function splitParts(p, id, assign, pivots) {
    const root = p.h.root, meshes = [];
    root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const groups = pivots.map((pv) => { const g = new THREE.Group(); g.name = 'part'; if (pv) g.position.set(pv[0], pv[1], pv[2]); root.add(g); return g; });
    for (const m of meshes) {
      const geo = m.geometry;
      let cache = SPLITS.get(geo);
      if (!cache) SPLITS.set(geo, (cache = new Map()));
      let gs = cache.get(id);
      if (!gs) {
        const pos = geo.attributes.position, idx = geo.index, names = ['position', 'normal', 'uv', 'color'].filter((a) => geo.attributes[a]);
        const buckets = pivots.map(() => []);
        for (const e of islandsOf(geo)) { const k = assign(e); if (k >= 0 && k < pivots.length) for (const t of e.tris) buckets[k].push(t); }
        gs = buckets.map((tris, k) => {
          if (!tris.length) return null;
          const g = new THREE.BufferGeometry();
          for (const a of names) {
            const src = geo.attributes[a], sz = src.itemSize, arr = new Float32Array(tris.length * 3 * sz);
            let w = 0;
            for (const t of tris) for (let c = 0; c < 3; c++) { const v = idx ? idx.getX(t * 3 + c) : t * 3 + c; for (let s = 0; s < sz; s++) arr[w++] = src.getComponent(v, s); }
            g.setAttribute(a, new THREE.BufferAttribute(arr, sz));
          }
          const pv = pivots[k]; if (pv) g.translate(-pv[0], -pv[1], -pv[2]);
          g.computeBoundingSphere(); g.userData.shared = true; g.dispose = () => {};
          return g;
        });
        cache.set(id, gs);
      }
      gs.forEach((g, k) => {
        if (!g) return;
        const mm = new THREE.Mesh(g, m.material); mm.matrixAutoUpdate = false; mm.castShadow = m.castShadow; mm.receiveShadow = m.receiveShadow; mm.userData.noShadow = m.userData.noShadow;
        groups[k].add(mm);
      });
      m.visible = false;
    }
    return groups;
  }
  // a physics prop built around a loaded model piece (placed UNSCALED with y = -s.r and anchor 'center'): the piece rides in the body mesh, a
  // breakable proxy rides with it, and the collider is fitted to the piece (mx.solid). s: { r, shape 'box'|'cylinder', mass, bounce, friction, grab, range,
  // material, hp, onBreak(pos, e, body) }; at: { dx, dz, up, yaw } = where it starts (stacks and piles)
  function physModel(i, o, p, s, at = {}) {
    const K = H.kit(); if (!K) return null;
    const k = o.scale ?? 1, mesh = new THREE.Group();
    mesh.name = 'phys:' + i.name; mesh.rotation.y = at.yaw ?? rand(0, TAU); mesh.scale.setScalar(k);
    mesh.add(p.obj);
    const w = p.size.x, d = p.size.z, hh = p.size.y;
    const proxy = mx.makeProxy(i, [new THREE.Box3(V3(-w / 2, -s.r, -d / 2), V3(w / 2, hh - s.r, d / 2))], s.colors ?? p.palette(), s.material ?? 'wood');
    mesh.add(proxy);
    const body = mx.solid(i, mesh, { shape: s.shape ?? 'box', mass: s.mass, bounce: s.bounce ?? 0.05, friction: s.friction ?? 0.7, drag: s.drag, grab: s.grab, range: s.range, dx: at.dx, dz: at.dz, up: at.up, own: true });
    i.track(mesh);
    i.cleanup(() => p.obj.removeFromParent()); // runs before the body's cleanup: the shared model is never disposed with the mesh
    const h = mx.breakable(i, [proxy], {
      material: s.material ?? 'wood', hp: s.hp, mass: s.dmass, collide: false, // the proxy rides in the moving body: no fixed collider
      onBreak(e) {
        const at = body ? body.position : mesh.position, pos = _w.clone().set(at.x, at.y, at.z);
        p.h.remove(); if (body) body.remove();
        if (s.onBreak) s.onBreak(pos, e, body);
      },
    });
    if (s.shape === 'cylinder') rollBrake(i, body);
    return { mesh, body, proxy, h, k };
  }

  // ================================================================ containers
  // chest behaviour shared by the primitive and the model build: v = { setOpen(0..1), top (m above the ground where the gold shows), hw, hd (half extents) }
  function chestBehave(i, o, v) {
    let open = 0, want = 0, looted = !o.loot, gl = 0;
    i.beh = {
      open: () => open,
      spill() { // broken open: loot + a gold puff
        world(i, 0, v.top, 0, _w); i.burst('glow', 0xffd870, _w, dn(18), 1.0, _up); i.burst('spark', 0xfff0a0, _w, dn(10), 0.8);
        if (!looted) { looted = true; dropLoot(i, o.loot, _w); }
      },
    };
    i.tick((dt, t) => {
      if (i.broken) return true;
      const p = i, d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      if (d < 3) want = 1; else if (d > 9 && o.autoClose !== false) want = 0;
      const prev = open;
      open += (want - open) * Math.min(1, dt * 4); v.setOpen(open);
      if (prev < 0.5 && open >= 0.5) {
        const s = i.snd(); s.tone({ freq: 140, freqEnd: 90, dur: 0.5, type: 'sawtooth', vol: 0.15, at: p }); s.chord([784, 988, 1175, 1568], { dur: 1.2, type: 'sine', vol: 0.16, at: p, stagger: 0.07, delay: 0.1 });
        world(i, 0, v.top, 0, _w); i.burst('glow', 0xffd870, _w, dn(24), 1.0, _up); i.burst('spark', 0xfff0a0, _w, dn(14), 0.8);
        if (!looted) { looted = true; dropLoot(i, o.loot, _w); }
      }
      if (open > 0.6) { gl -= dt; if (gl < 0) { gl = rand(0.15, 0.5); world(i, rand(-v.hw, v.hw), v.top, rand(-v.hd, v.hd), _w); i.burst('glow', 0xfff0a0, _w, dn(1), 0.18, _up); } }
    }, { every: 0.05 });
  }
  // coins + gems that show once a (model) chest is open: sits on top of the body, unit = metres
  function goldHeap(hw, hd, y) {
    const cb = H.mk();
    for (let q = 0; q < 30; q++) cb.box(rand(-hw, hw), y + rand(0, 0.05), rand(-hd, hd), rand(0.07, 0.11), 0.035, rand(0.07, 0.11), pick([0xe8b83a, 0xd9a93c, 0xf4d070, 0xc0c8d0]), [0, rand(0, 3), rand(-0.3, 0.3)]);
    cb.mode('glow'); for (let q = 0; q < 5; q++) cb.oct(rand(-hw, hw) * 0.9, y + 0.07, rand(-hd, hd) * 0.9, 0.05, 0.06, 0.05, pick([0xff4a6a, 0x4ac8ff, 0x6aff8a, 0xc87aff]));
    const m = cb.build({ own: true }); m.visible = false; return m;
  }
  const CHEST_DESTRUCT = brk((i) => ({ material: 'wood', hp: 28, stages: 'auto', onBreak() { if (i.beh && i.beh.spill) i.beh.spill(); } }));
  def('chest', 'iron-banded chest; lid opens with a gold sparkle when you step within 3 m (loot: a weapon name or true pops one out); breakable (spills its loot); option style gold', 'loot, color, scale, style (gold)', ['treasure chest', 'loot chest', 'treasure', 'chests', 'strongbox', 'coffer', 'trunk'], (i, o) => {
    const c = H.makeChest({ wood: o.color }), k = o.scale ?? 1;
    c.group.scale.setScalar(k);
    const cb = H.mk();
    for (let q = 0; q < 26; q++) cb.box(rand(-0.34, 0.34), 0.42 + rand(0, 0.04), rand(-0.18, 0.18), rand(0.06, 0.1), 0.03, rand(0.06, 0.1), pick([0xe8b83a, 0xd9a93c, 0xf4d070, 0xc0c8d0]), [0, rand(0, 3), rand(-0.3, 0.3)]);
    cb.mode('glow'); for (let q = 0; q < 4; q++) cb.oct(rand(-0.3, 0.3), 0.47, rand(-0.15, 0.15), 0.05, 0.06, 0.05, pick([0xff4a6a, 0x4ac8ff, 0x6aff8a, 0xc87aff]));
    c.group.add(cb.build());
    i.add(c.group);
    chestBehave(i, o, { setOpen: c.setOpen, top: 0.55 * k, hw: 0.3 * k, hd: 0.2 * k });
  }, { size: 0.7 });

  // breakable physics container: barrel, keg, crate. A real rigid body with a box / cylinder collider fitted to its mesh (stacks, topples, a barrel rolls on its side);
  // s: { mesh(), shape, mass, hp, color, grab, friction, bounce, explode, dmg }; at: { dx, dz, up, yaw } = where it starts (stacks and piles)
  function container(i, o, s, at = {}) {
    const K = H.kit(); if (!K) return null;
    const mesh = s.mesh();
    mesh.scale.setScalar(o.scale ?? 1);
    mesh.rotation.y = at.yaw ?? rand(0, TAU);
    const body = mx.solid(i, mesh, { shape: s.shape, mass: s.mass, bounce: s.bounce ?? 0.05, friction: s.friction ?? 0.7, grab: s.grab, range: 4, dx: at.dx, dz: at.dz, up: at.up, own: true });
    if (!body) return null;
    i.track(mesh);
    const f = body.fit;
    let dead = false;
    const d = i.dmg(mesh, { hp: s.hp, radius: Math.max(f.x, f.y, f.z) * 0.55, offsetY: f.cy, faction: 'neutral', onHit: (e) => { if (!dead && e.point) i.burst('bits', s.color, e.point, dn(3), 0.4); },
      onDeath: () => {
        dead = true;
        const p = body.position;
        _w.set(p.x, p.y, p.z);
        if (s.explode) { blast(i, _w, { size: s.explode, damage: s.dmg, radius: s.explode * 2.0, force: 110 }); i.burst('puff', 0x2a2a2a, _w, dn(12), 1.4, _up); }
        else { i.burst('bits', s.color, _w, dn(18), 1); i.burst('puff', 0xc8b898, _w, dn(5), 0.5); const sn = i.snd(); sn.noise({ dur: 0.25, filter: { type: 'bandpass', freq: 600, q: 0.8 }, vol: 0.3, at: _w }); sn.tone({ freq: 140, freqEnd: 70, dur: 0.15, type: 'square', vol: 0.12, at: _w }); }
        dropLoot(i, o.loot, _w);
        mesh.visible = false;
        body.remove();
        if (d) d.remove();
      } });
    if (s.shape === 'cylinder') rollBrake(i, body);
    return { body, mesh, d, h: f.y };
  }
  // A cylinder has no rolling resistance in the engine: a barrel on its side keeps creeping down every slope. As it slows it gets more damping, so it rolls out and rests.
  function rollBrake(i, body) {
    const ph = body && body.ph; if (!ph) return;
    let lvl = 0;
    i.tick(() => {
      if (body.removed || !body.ph || i.broken) return true;
      const s2 = ph.velocity.lengthSq(), w = s2 < 1 ? 2 : s2 < 9 ? 1 : 0;
      if (w !== lvl) { lvl = w; ph.setDamping(w === 2 ? 1.2 : w === 1 ? 0.12 : 0.05, w === 2 ? 6 : w === 1 ? 0.9 : 0.6); }
    }, { every: 0.1 });
  }
  const CRATE = { mesh: () => model('crate', (b) => { b.box(0, 0, 0, 0.8, 0.8, 0.8, 0x96734a); for (const s of [-1, 1]) { b.box(s * 0.36, 0, 0, 0.08, 0.82, 0.82, 0x6a4a2a); b.box(0, s * 0.36, 0, 0.82, 0.08, 0.82, 0x6a4a2a); b.box(0, 0, s * 0.36, 0.82, 0.82, 0.08, 0x6a4a2a, 0); } b.box(0, 0, 0.405, 0.1, 0.84, 0.02, 0x7a5a38, [0, 0, 0.78]); b.box(0, 0, 0.405, 0.1, 0.84, 0.02, 0x7a5a38, [0, 0, -0.78]); }, { own: true }),
    shape: 'box', mass: 8, hp: 40, color: 0x96734a, grab: true, friction: 0.7, bounce: 0.05 };
  // where the crates of a stack / pile start: [{ dx, dz, up, yaw }] (inst frame, up = bottom of the crate above the ground), trimmed to what the body budget allows
  const CW = 0.8;
  function crateLayout(i, o, pile) {
    const k = o.scale ?? 1, w = CW * k + 0.006, out = [];
    if (pile) { // a pyramid wall: rows of L, L-1 ... 1 crates
      let L = clamp(Math.floor(o.height ?? 3), 2, 5);
      const got = mx.room(i, (L * (L + 1)) / 2, 'crates');
      while (L > 1 && (L * (L + 1)) / 2 > got) L--;
      if (L < 2) return null;
      for (let r = 0; r < L; r++) for (let c = 0; c < L - r; c++) out.push({ dx: (c - (L - r - 1) / 2) * (w + 0.03), dz: rand(-0.02, 0.02), up: r * w, yaw: rand(-0.04, 0.04) });
      return out;
    }
    const n0 = clamp(Math.floor(o.stack ?? 1), 1, 8), n = n0 > 1 ? Math.max(1, mx.room(i, n0, 'crates')) : 1;
    for (let q = 0; q < n; q++) out.push(n === 1 ? { up: 0 } : { dx: rand(-0.03, 0.03), dz: rand(-0.03, 0.03), up: q * w, yaw: rand(-0.12, 0.12) });
    return out;
  }
  // the crate build behind both 'crate' (a column: option stack) and 'crate-stack' (a pyramid): o.layout lists the crates, a model each when box-small loads
  const crateEntry = mx.wrap('crate:std', (i, o) => { for (const at of o.layout ?? [{}]) container(i, o, CRATE, at); });
  mx.model('crate:std', {
    model(P, o, i) { const lay = o.layout ?? [{}]; return { i, lay, ps: lay.map(() => P('box-small', { height: 0.8, y: -0.5, anchor: 'center' })) }; },
    after(pieces, plan, o) { plan.ps.forEach((p, q) => physModel(plan.i, o, p, { r: 0.5, shape: 'box', mass: 8, hp: 40, material: 'wood', grab: true, range: 4, onBreak(pos) { dropLoot(plan.i, o.loot, pos); } }, plan.lay[q])); },
  });
  const barrelMesh = (keg) => model(keg ? 'keg' : 'barrel', (b) => {
    const wood = keg ? 0x3e2e22 : 0x7a5230, band = keg ? 0xb02a2a : 0x2a2e36;
    b.cyl(0, -0.55, 0, 0.5, 0.41, 0.55, wood, 0, 10); b.cyl(0, 0, 0, 0.41, 0.5, 0.55, shade(wood, 1.05), 0, 10);
    for (const y of [-0.42, 0.0, 0.42]) b.cylc(0, y, 0, y === 0 ? 0.515 : 0.46, y === 0 ? 0.515 : 0.46, 0.06, band, 0, 10);
    b.cylc(0, 0.55, 0, 0.42, 0.42, 0.03, shade(wood, 1.2), 0, 10);
    if (keg) { b.sph(0, 0.1, 0.51, 0.13, 0.15, 0.03, 0xe6dfc8); b.mode('glow'); b.cyl(0.05, 0.56, 0.0, 0.015, 0.015, 0.3, 0x8a7a5a, [0, 0, -0.3], 4); b.sph(0.13, 0.88, 0, 0.04, 0.04, 0.04, 0xffa030); }
  }, { own: true });
  const BARREL = (keg) => ({ mesh: () => barrelMesh(keg), shape: 'cylinder', mass: 15, hp: keg ? 4 : 40, color: keg ? 0x3e2e22 : 0x7a5230, grab: false, friction: 0.7, bounce: 0.1, explode: keg ? 2.2 : 0, dmg: 35 });
  def('barrel', 'wooden iron-hooped barrel: a heavy physics prop you can push, topple and roll or smash (40 hp, so a blast or a hammer blow throws it before it breaks); option loot', 'loot, scale', ['barrels', 'cask', 'wooden barrel', 'keg barrel'], (i, o) => container(i, o, BARREL(false)), { size: 0.6, face: 'random', spacing: 1.3 });
  def('powder-keg', 'black-powder keg with a fuse and a skull mark: explodes (35 damage, 4.5 m, throws crates and fighters, chain-reacts with other kegs) when hit hard', 'scale', ['explosive barrel', 'tnt barrel', 'bomb barrel', 'gunpowder', 'powder barrel', 'exploding barrel', 'kegs', 'red barrel'], (i, o) => container(i, o, BARREL(true)), { size: 0.6, face: 'random', spacing: 1.3 });
  def('crate', 'wooden crate (40 hp, 8 kg): shove it, grab and throw it, stack it (option stack = how many high), or smash it; option loot', 'loot, scale, stack', ['box', 'wooden crate', 'crates', 'wooden box', 'supply crate', 'package', 'cargo'], (i, o) => crateEntry(i, { ...o, layout: crateLayout(i, o, false) }), { size: 0.6, face: 'random', spacing: 1.2 });

  // ================================================================ furniture (static, 1 draw call each)
  const furn = (name, desc, aliases, fn, extra) => def(name, desc, 'scale', aliases, (i, o) => { const b = H.mk(); fn(b, o); const m = b.build(); m.scale.setScalar(o.scale ?? 1); i.add(m); }, { face: 'player', ...extra });
  furn('table', 'sturdy wooden table set with a plate, mug, bread and a candle', ['dining table', 'wooden table', 'tables', 'desk', 'counter'], (b) => {
    b.box(0, 0.78, 0, 1.7, 0.1, 0.95, 0x8a6a3e); b.box(0, 0.72, 0, 1.5, 0.06, 0.8, 0x6a4a2a);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.75, 0.37, sz * 0.38, 0.12, 0.74, 0.12, 0x6a4a2a);
    b.cylc(-0.4, 0.85, 0.1, 0.17, 0.17, 0.02, 0xe8e4d8, 0, 10); b.cylc(0.4, 0.88, -0.1, 0.06, 0.05, 0.1, 0xb4783a, 0, 8); b.sph(-0.4, 0.9, 0.1, 0.1, 0.05, 0.08, 0xd8a050);
    b.cyl(0.1, 0.83, 0.25, 0.03, 0.03, 0.14, 0xeee6d0, 0, 6); b.mode('glow'); b.cone(0.1, 0.97, 0.25, 0.015, 0.05, 0xffc060, 0, 4);
  }, { size: 1.2 });
  furn('chair', 'simple wooden chair with a slatted back', ['wooden chair', 'seat', 'chairs', 'stool', 'dining chair'], (b) => {
    b.box(0, 0.45, 0, 0.5, 0.06, 0.5, 0x8a6a3e); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.2, 0.22, sz * 0.2, 0.06, 0.44, 0.06, 0x6a4a2a);
    for (const sx of [-1, 1]) b.box(sx * 0.2, 0.9, -0.22, 0.06, 0.9, 0.06, 0x6a4a2a); for (let k = 0; k < 3; k++) b.box(0, 0.7 + k * 0.17, -0.22, 0.4, 0.07, 0.04, 0x8a6a3e);
  }, { size: 0.5, spacing: 1.2 });
  furn('bench', 'long wooden bench seating three', ['park bench', 'wooden bench', 'benches', 'pew', 'seat bench'], (b) => {
    b.box(0, 0.47, 0, 1.9, 0.07, 0.45, 0x8a6a3e); b.box(0, 0.88, -0.2, 1.9, 0.4, 0.05, 0x8a6a3e);
    for (const sx of [-1, 1]) { b.box(sx * 0.8, 0.23, 0, 0.1, 0.46, 0.4, 0x4d3322); b.box(sx * 0.85, 0.62, -0.2, 0.08, 0.9, 0.08, 0x4d3322); b.box(sx * 0.8, 0.55, 0.0, 0.08, 0.05, 0.4, 0x4d3322); }
  }, { size: 1.2 });
  furn('bed', 'wooden bed with a red wool blanket and white pillow', ['beds', 'cot', 'sleeping bed', 'hay bed'], (b, o) => {
    const c = pick([0xa83a3a, 0x3a5aa8, 0x3a8a5a, 0x8a5aa8]);
    b.box(0, 0.3, 0, 1.2, 0.2, 2.2, 0x6a4a2a); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.56, 0.1, sz * 1.05, 0.1, 0.2, 0.1, 0x4d3322);
    b.box(0, 0.8, -1.08, 1.25, 0.9, 0.08, 0x6a4a2a); b.box(0, 0.5, 1.08, 1.25, 0.4, 0.08, 0x6a4a2a);
    b.box(0, 0.5, 0, 1.1, 0.2, 2.0, 0xeee6d0); b.mode('cloth'); b.box(0, 0.62, 0.35, 1.14, 0.1, 1.4, c); b.box(0, 0.66, 0.35, 1.14, 0.03, 0.2, shade(c, 1.3)); b.mode('solid');
    b.sph(0, 0.66, -0.75, 0.42, 0.1, 0.22, 0xf4f0e8);
  }, { size: 1.5 });

  // ---- light sources
  def('lantern', 'warm glowing lantern you can grab and carry; it lights up the ground around it (use count for several)', 'scale', ['lamp', 'lanterns', 'oil lamp', 'light', 'glowing lantern', 'candle lantern'], (i, o) => {
    const K = H.kit(); if (!K) return;
    const b = H.mk(); b.cyl(0, -0.12, 0, 0.09, 0.1, 0.03, IRON, 0, 6); b.cyl(0, 0.17, 0, 0.1, 0.07, 0.04, IRON, 0, 6); b.cone(0, 0.2, 0, 0.12, 0.08, IRON, 0, 6);
    for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; b.box(Math.cos(a) * 0.075, 0.02, Math.sin(a) * 0.075, 0.015, 0.3, 0.015, IRON); }
    b.tor(0, 0.3, 0, 0.05, 0.008, IRON, 0, 8); b.mode('glow'); b.sph(0, 0.0, 0, 0.065, 0.08, 0.065, 0xffd070); b.mode('ghost'); b.cyl(0, -0.1, 0, 0.085, 0.085, 0.26, 0xffe8a0, 0, 6);
    const m = b.build({ own: true }); m.scale.setScalar(o.scale ?? 1);
    const body = mx.solid(i, m, { shape: 'cylinder', mass: 0.8, bounce: 0.2, friction: 0.7, grab: true, range: 5, up: 0.3, own: true });
    const L = i.light({ color: 0xffc070, intensity: 11, distance: 10, flicker: 0.25 }); if (L) L.target = m;
    i.track(m);
    mx.breakable(i, [m], { material: 'glass', hp: 5, collide: false, onBreak() { i.broken = (i.broken | 0); if (L) L.remove(); if (body) body.remove(); } }); // moves with the body: no fixed collider
  }, { size: 0.3, spacing: 1.3, face: 'random' });
  function flameAt(i, getPos, o = {}) {
    let acc = 0; const sc = o.scale ?? 1;
    i.tick((dt, t) => { if (i.broken) return true; if (!near(i, 60)) return; acc += dt * (o.rate ?? 22) * H.densK(); const n = acc | 0; acc -= n; if (n) { getPos(_w); i.burst('fire', o.color ?? 0xff6a1a, _w, n, 0.55 * sc, _up); if (Math.random() < dt * 4) i.burst('spark', 0xffb040, _w, dn(1), 0.6); } }, { every: 0.08 });
  }
  def('torch-stand', 'tall iron-and-wood standing torch with a living flame and flickering light; use count for a row', 'scale, color', ['standing torch', 'torch holder', 'wall torch', 'torch stand', 'torches', 'fire pole', 'tiki torch'], (i, o) => {
    const b = H.mk(), k = o.scale ?? 1;
    b.cyl(0, 0, 0, 0.05, 0.07, 1.9, WOODD, 0, 6); b.cyl(0, 1.9, 0, 0.17, 0.09, 0.2, IRON, 0, 7); for (let q = 0; q < 6; q++) { const a = q * 1.05; b.box(Math.cos(a) * 0.15, 2.0, Math.sin(a) * 0.15, 0.02, 0.2, 0.02, IRON, [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2]); }
    b.cyl(0, 0, 0, 0.18, 0.2, 0.08, 0x6e6a64, 0, 7);
    b.mode('glow'); b.cone(0, 2.05, 0, 0.1, 0.32, o.color ?? 0xffa030, 0, 6);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    torchFire(i, o, k, 2.3, 2.15);
  }, { size: 0.3, spacing: 3 });
  // flame + flicker light on top of a stand (light y / flame y in metres above the ground, unscaled); both go out when the prop breaks
  function torchFire(i, o, k, ly, fy) {
    const L = i.light({ color: o.color ?? 0xff9040, intensity: 16, distance: 13, flicker: 0.45, position: { x: i.x, y: i.y + ly * k, z: i.z } });
    flameAt(i, (w) => w.set(i.x, i.y + fy * k, i.z), { scale: k, color: o.color });
    if (L) i.tick(() => { if (i.broken) { L.enabled = false; return true; } }, { every: 0.2 });
  }
  def('bonfire', 'big roaring bonfire: stacked logs, tall flames, sparks, smoke, strong flicker light and crackles', 'scale', ['fire', 'campfire', 'big fire', 'fireplace', 'bonfires', 'flames', 'campfire pit', 'blaze', 'log fire'], (i, o) => {
    const b = H.mk(), k = o.scale ?? 1;
    for (let q = 0; q < 12; q++) { const a = (q / 12) * TAU; b.dod(Math.cos(a) * 1.35, 0.1, Math.sin(a) * 1.35, 0.26, 0.17, 0.26, pick([0x6e6a64, 0x7a766e, 0x5e5a54]), [rand(0, 3), rand(0, 3), 0]); }
    for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU + 0.2; b.cyl(Math.cos(a) * 0.55, 0.04, Math.sin(a) * 0.55, 0.09, 0.11, 1.7, q % 2 ? 0x4a2e1a : 0x5a3a22, [-Math.sin(a) * 0.75, 0, Math.cos(a) * 0.75], 6); }
    b.mode('glow'); b.cone(0, 0.2, 0, 0.55, 0.5, 0xff4a0a, 0, 7);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    bonfireFire(i, o, k);
  }, { size: 1.8 });
  function bonfireFire(i, o, k) {
    const dk = Math.min(1.6, Math.max(0.4, H.densK())), flame = i.fx({ count: Math.round(150 * dk), color: [0xffd070, 0xff3a00], size: [0.8 * k, 0.1], life: [0.6, 1.1], speed: 0.3, gravity: -2.6, drag: 0.6, spread: 0.3 * k });
    const sparks = i.fx({ count: Math.round(70 * dk), color: [0xffcc55, 0xff2200], size: [0.07, 0.02], life: [1.5, 3.2], speed: 0.8, gravity: -1.1, drag: 0.2, spread: 0.3 });
    const smoke = i.fx({ count: Math.round(70 * dk), additive: false, color: [0x4a4a4a, 0x151515], alpha: 0.5, size: [0.5, 1.8], life: [2.8, 4.2], speed: 0.3, gravity: -0.6, drag: 0.5, spread: 0.2 });
    const L = i.light({ color: 0xff8a3a, intensity: 42, distance: 24, flicker: 0.45, position: { x: i.x, y: i.y + 1.2 * k, z: i.z } });
    const push = new THREE.Vector3(0, 0.5, 0), at = { x: i.x, y: i.y + 0.5, z: i.z };
    let aF = 0, aS = 0, aM = 0, nc = 0.4;
    i.tick((dt, t) => {
      if (!near(i, 90)) return;
      const dk = H.densK(); aF += dt * 60 * dk; aS += dt * 8 * dk; aM += dt * 9 * dk; let n = aF | 0; aF -= n; if (n && flame) { _w.set(i.x, i.y + 0.4 * k, i.z); flame.emit(_w, n); }
      n = aS | 0; aS -= n; if (n && sparks) { _w.set(i.x, i.y + 0.9 * k, i.z); sparks.emit(_w, n, push); }
      n = aM | 0; aM -= n; if (n && smoke) { _w.set(i.x, i.y + 2.2 * k, i.z); smoke.emit(_w, n); }
      if (t > nc && near(i, 28)) { nc = t + 0.08 + Math.random() * 0.4; i.snd().noise({ dur: 0.03 + Math.random() * 0.06, filter: { type: 'bandpass', freq: 1500 + Math.random() * 3500, q: 3 }, vol: 0.12 + Math.random() * 0.2, at }); if (Math.random() < 0.2) i.snd().tone({ freq: 80 + Math.random() * 60, freqEnd: 40, dur: 0.1, vol: 0.2, at }); }
    });
  }

  def('anvil', 'blacksmith\'s anvil on a stump; every hit from a weapon or spell rings a clang and throws sparks', 'scale', ['smithy anvil', 'anvils', 'blacksmith anvil', 'metalwork'], (i, o) => {
    const b = H.mk(), k = o.scale ?? 1;
    b.cyl(0, -0.1, 0, 0.42, 0.5, 0.65, 0x6a4a2a, 0, 9); b.cylc(0, 0.56, 0, 0.44, 0.42, 0.04, 0x4a3320, 0, 9);
    b.box(0, 0.74, 0, 0.5, 0.18, 0.28, 0x3a3e48); b.box(0, 0.86, 0, 0.36, 0.14, 0.2, 0x3a3e48); b.box(0, 1.0, 0, 0.7, 0.16, 0.34, 0x4a4e58); b.box(0, 1.1, 0, 0.7, 0.02, 0.34, 0x6a707c);
    b.cone(0.5, 1.0, 0, 0.14, 0.38, 0x4a4e58, [0, 0, -PI / 2], 5); b.box(-0.4, 1.0, 0, 0.18, 0.12, 0.2, 0x4a4e58);
    const m = b.build({ own: true }); m.scale.setScalar(k); i.add(m); // damage side (clang, 160 hp metal, blocking): mx.model('anvil') below, for both builds
  }, { size: 0.8 });
  function anvilClang(i, e) {
    const p = e.point ?? { x: i.x, y: i.y + 1.2, z: i.z }, s = i.snd(), v = clamp(e.amount / 12, 0.25, 1);
    s.tone({ freq: 1500 + rand(0, 400), freqEnd: 1400, dur: 0.5, type: 'triangle', vol: 0.18 * v, at: p }); s.tone({ freq: 3100, dur: 0.25, type: 'sine', vol: 0.07 * v, at: p }); s.noise({ dur: 0.05, filter: { type: 'highpass', freq: 3000 }, vol: 0.2 * v, at: p });
    i.burst('spark', 0xffb040, p, dn(10), 0.9, _up);
  }
  def('cauldron', 'iron cauldron over a small fire, full of glowing bubbling brew with rising bubbles, steam and plops; option color', 'color', ['witch cauldron', 'pot', 'brew', 'potion pot', 'cooking pot', 'cauldrons', 'witches brew', 'stew'], (i, o) => {
    const c = o.color ?? pick([0x6aff6a, 0xb06aff, 0x58e6ff, 0xffb040]), b = H.mk();
    b.sph(0, 0.75, 0, 0.7, 0.55, 0.7, IRON, 0, 10); b.tor(0, 1.05, 0, 0.62, 0.07, 0x3a3e48, [PI / 2, 0, 0], 12);
    for (let k = 0; k < 3; k++) { const a = k * 2.09 + 0.5; b.cyl(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, 0.07, 0.05, 0.35, IRON, 0, 5); }
    for (let k = 0; k < 6; k++) { const a = k * 1.05; b.cyl(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3, 0.05, 0.06, 0.5, 0x4a2e1a, [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 5); }
    b.mode('glow'); b.cylc(0, 1.02, 0, 0.58, 0.58, 0.03, c, 0, 12); b.cone(0, 0.2, 0, 0.35, 0.3, 0xff7a1a, 0, 6);
    i.add(b.build());
    const CL = i.light({ color: c, intensity: 10, distance: 8, flicker: 0.3, position: { x: i.x, y: i.y + 1.3, z: i.z } });
    let nb = 0, nplop = rand(0.3, 1);
    i.tick((dt, t) => {
      if (i.broken) { if (CL) CL.enabled = false; return true; }
      if (!near(i, 50)) return;
      nb += dt * 6 * H.densK(); const n = nb | 0; nb -= n; if (n) { _w.set(i.x + rand(-0.4, 0.4), i.y + 1.05, i.z + rand(-0.4, 0.4)); i.burst('glow', c, _w, n, 0.3, _up); }
      if (Math.random() < dt * 3) { _w.set(i.x + rand(-0.3, 0.3), i.y + 1.1, i.z + rand(-0.3, 0.3)); i.burst('puff', mix(c, 0xffffff, 0.7), _w, 1, 0.3, _up); }
      if (Math.random() < dt * 5) { _w.set(i.x, i.y + 0.4, i.z); i.burst('fire', 0xff7a1a, _w, dn(1), 0.4, _up); }
      nplop -= dt; if (nplop < 0 && near(i, 16)) { nplop = rand(0.5, 1.6); i.snd().tone({ freq: 200 + rand(0, 200), freqEnd: 90, dur: 0.12, type: 'sine', vol: 0.1, at: { x: i.x, y: i.y + 1, z: i.z } }); }
    }, { every: 0.1 });
  }, { size: 1 });

  // ================================================================ training
  def('training-dummy', 'straw training dummy that never dies: floating damage numbers at every hit and a running DPS readout; wobbles when struck', 'scale', ['dummy', 'practice dummy', 'target dummy', 'punching bag', 'dummies', 'training post', 'straw dummy'], (i, o) => {
    const K = H.kit(); if (!K) return;
    const k = o.scale ?? 1, b = H.mk();
    b.cyl(0, 0, 0, 0.07, 0.09, 1.7, WOODD, 0, 6); b.cyl(0, 0, 0, 0.4, 0.45, 0.12, 0x5a564f, 0, 8);
    b.box(0, 1.35, 0, 1.3, 0.1, 0.1, WOODD);
    b.mode('cloth'); b.cyl(0, 0.75, 0, 0.3, 0.34, 0.75, 0xc8a860, 0, 9); b.cyl(0, 0.85, 0, 0.32, 0.3, 0.08, 0x8a6a3a, 0, 9); b.cyl(0, 1.2, 0, 0.3, 0.26, 0.1, 0x8a6a3a, 0, 9);
    for (const s of [-1, 1]) b.cyl(s * 0.5, 1.15, 0, 0.08, 0.07, 0.4, 0xc8a860, 0, 6);
    b.mode('solid'); b.sph(0, 1.62, 0, 0.2, 0.22, 0.2, 0xd8c8a0, 0, 8); b.cylc(0, 1.65, 0.19, 0.12, 0.12, 0.02, 0xb02a2a, [PI / 2, 0, 0], 10); b.cylc(0, 1.65, 0.2, 0.06, 0.06, 0.02, 0xf4f0e8, [PI / 2, 0, 0], 10);
    b.cylc(0, 1.0, 0.31, 0.16, 0.16, 0.02, 0xb02a2a, [PI / 2, 0, 0], 10); b.cylc(0, 1.0, 0.32, 0.08, 0.08, 0.02, 0xf4f0e8, [PI / 2, 0, 0], 10);
    const sway = new THREE.Group(); sway.position.y = 0; const m = b.build({ own: true }); sway.add(m); sway.scale.setScalar(k); i.add(sway);
    mx.collider(i, box3(-0.65 * k, 0, -0.3 * k, 0.65 * k, 1.9 * k, 0.3 * k)); // crates and balls bounce off it (it still never dies)
    const nums = [];
    for (let q = 0; q < 6; q++) { const l = i.label('0', { size: 0.13, color: 0xffd24a }); l.show(false); nums.push({ l, t: -1, x: 0, y: 0, z: 0 }); }
    const dps = i.label('DPS 0', { size: 0.1, color: 0x9aff9a }); dps.position.set(i.x, i.y + 2.4 * k, i.z);
    let wob = 0, qi = 0, win = [], lastShown = '';
    const d = i.dmg(sway, { hp: 1e9, radius: 0.6 * k, offsetY: 1.0 * k, faction: 'neutral', onHit: (e) => {
      d.hp = d.maxHp; wob = Math.min(1, wob + 0.4 + e.amount / 40);
      const nn = nums[qi++ % nums.length], p = e.point ?? { x: i.x, y: i.y + 1.6, z: i.z };
      nn.t = 0; nn.x = p.x + rand(-0.15, 0.15); nn.y = p.y + 0.2; nn.z = p.z + rand(-0.15, 0.15); nn.l.set('-' + Math.round(e.amount)); nn.l.show(true); nn.l.sprite.material.opacity = 1;
      win.push([ctxT(), e.amount]);
      const s = i.snd(); s.noise({ dur: 0.1, filter: { type: 'lowpass', freq: 700 }, vol: 0.2, at: p }); s.tone({ freq: 150, freqEnd: 90, dur: 0.12, type: 'square', vol: 0.08, at: p });
      i.burst('bits', 0xc8a860, p, dn(4), 0.4);
    } });
    const ctxT = () => H.ctx.clock.t;
    i.tick((dt, t) => {
      wob = Math.max(0, wob - dt * 1.4); sway.rotation.z = Math.sin(t * 17) * wob * 0.14; sway.rotation.x = Math.cos(t * 13) * wob * 0.08;
      for (const n of nums) { if (n.t < 0) continue; n.t += dt; if (n.t > 1.3) { n.t = -1; n.l.show(false); continue; } n.l.position.set(n.x, n.y + n.t * 0.9, n.z); n.l.sprite.material.opacity = 1 - n.t / 1.3; }
      while (win.length && t - win[0][0] > 3) win.shift();
      let sum = 0; for (const w of win) sum += w[1];
      const txt = win.length ? `DPS ${(sum / 3).toFixed(1)}` : 'DPS 0'; if (txt !== lastShown) { lastShown = txt; dps.set(txt); }
    }, { every: 0.03 });
  }, { size: 0.8 });
  def('archery-target', 'round straw archery target on a tripod: ten scoring rings, a floating running score and "+N" per hit (resets after 10 shots)', 'scale', ['target', 'bullseye', 'shooting target', 'targets', 'practice target', 'dartboard'], (i, o) => {
    const K = H.kit(); if (!K) return;
    const k = o.scale ?? 1, b = H.mk();
    for (const [sx, sz, rz] of [[-0.55, -0.1, 0.35], [0.55, -0.1, -0.35], [0, -0.7, 0]]) b.cyl(sx, 0, sz, 0.04, 0.05, 1.7, WOODD, [rz * 0.0 + (sz < -0.5 ? 0.35 : 0), 0, rz], 5);
    i.add(b.build());
    const tb = H.mk(), ring = [0xf4f0e0, 0x2a2a2a, 0x3a7acf, 0xd83a3a, 0xf0c83a];
    const R = 0.7;
    for (let q = 0; q < 5; q++) { const r = R * (1 - q * 0.2); tb.cylc(0, 0, 0.04 + q * 0.012, r, r, 0.03, ring[q], [PI / 2, 0, 0], 20); }
    tb.cylc(0, 0, 0, R + 0.06, R + 0.06, 0.08, 0x8a6a3a, [PI / 2, 0, 0], 20);
    const tg = new THREE.Group(); tg.position.set(0, 1.45 * k, 0.15); tg.scale.setScalar(k); const tm = tb.build({ own: true }); tg.add(tm); i.add(tg);
    archeryBehave(i, tg, k, R);
  }, { size: 1, distance: 9 });
  // scoring + wobble around a face anchor `tg` (its world position is the bullseye); the damage side is a destructible made by ARCHERY_DESTRUCT
  function archeryBehave(i, tg, k, R) {
    const lab = i.label('Score 0', { size: 0.13, color: 0xffe9a0 }); lab.position.set(i.x, i.y + 2.5 * k, i.z);
    let total = 0, shots = 0, wob = 0, flash = 0;
    i.beh = {
      h: null,
      hit(e) {
        wob = 1;
        const c = tg.getWorldPosition(_v), p = e.point ?? c, dist = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) / k;
        const sc = clamp(10 - Math.floor(dist / (R / 10)), 1, 10);
        total += sc; shots++;
        lab.set(shots >= 10 ? `FINAL ${total} / 100` : `Score ${total}   (+${sc}${sc === 10 ? ' BULLSEYE!' : ''})`);
        i.burst('spark', sc >= 9 ? 0xffe27a : 0xffffff, p, dn(8), 0.6);
        i.snd().tone({ freq: 160 + sc * 30, freqEnd: 90, dur: 0.15, type: 'square', vol: 0.12, at: p }); if (sc === 10) i.snd().chord([880, 1319], { dur: 0.5, type: 'sine', vol: 0.15, at: p, stagger: 0.07 });
        if (shots >= 10) flash = 4;
      },
      broke() { lab.set('Target destroyed'); flash = 3; },
      score: () => ({ total, shots }),
    };
    i.tick((dt, t) => {
      wob = Math.max(0, wob - dt * 1.6); tg.rotation.x = Math.sin(t * 22) * wob * 0.05;
      if (flash > 0) { flash -= dt; if (flash <= 0) { total = 0; shots = 0; lab.set(i.broken ? '' : 'Score 0'); if (i.beh.h && !i.broken) i.beh.h.hp = i.beh.h.maxHp; } }
    }, { every: 0.03 });
  }
  // damage side of the archery target: wood, scores every hit, heals when the round resets; heavy abuse still breaks it
  const ARCHERY_DESTRUCT = (i, pieces) => { const h = mx.breakable(i, pieces, { material: 'wood', hp: 260, stages: 'auto', onDamage: (e) => { if (i.beh) i.beh.hit(e); }, onBreak: () => { if (i.beh) i.beh.broke(); } }); if (i.beh) i.beh.h = h; };

  // ================================================================ toys (physics)
  // s: { mesh(q), shape ('sphere' default | 'box'), mass, bounce, friction, drag, n, range, hit(inst, body, e) }. A ball rolls and rests (physics.js has rolling damping for spheres),
  // a die is a real cube that tumbles and settles on a face. More than 3 pieces are trimmed to the body budget.
  function toy(i, o, s) {
    const K = H.kit(); if (!K) return [];
    const out = [];
    const n0 = s.n ?? 1, n = n0 > 3 ? mx.room(i, n0, s.what ?? 'toys') : n0;
    for (let q = 0; q < n; q++) {
      const m = s.mesh(q); m.scale.setScalar(o.scale ?? 1);
      const body = mx.solid(i, m, { shape: s.shape ?? 'sphere', mass: s.mass, bounce: s.bounce, friction: s.friction ?? 0.6, drag: s.drag, grab: true, range: s.range ?? 6, up: 0.5 + q * 0.3, dx: q ? rand(-0.5, 0.5) : 0, dz: q ? rand(-0.5, 0.5) : 0 });
      if (body && s.hit) body.onHit((e) => s.hit(i, body, e));
      i.track(m); out.push(body);
    }
    return out;
  }
  const BALLS = { // option style: ball radius (m), mass (kg), bounce, surface
    soccer: { r: 0.22, mass: 0.43, bounce: 0.62, c: 0xf4f4f0, c2: 0x1a1a1e }, basketball: { r: 0.24, mass: 0.62, bounce: 0.8, c: 0xe0742a, c2: 0x1a1a1e }, rubber: { r: 0.25, mass: 0.5, bounce: 0.72 },
  };
  def('ball', 'bouncy rubber ball (option style: rubber (default, red-and-white) | soccer | basketball): grab, throw, kick; it rolls and comes to rest', 'color, scale, style', ['football', 'soccer ball', 'bouncy ball', 'balls', 'rubber ball', 'toy ball', 'basketball', 'sphere'], (i, o) => {
    const bs = BALLS[String(o.style)] ?? BALLS.rubber, c = o.color ?? bs.c ?? pick([0xe02a2a, 0x2a7ae0, 0xe0b82a, 0x2ab04a]), r = bs.r;
    toy(i, o, { shape: 'sphere', mass: bs.mass, bounce: bs.bounce, mesh: () => { const b = H.mk(); b.sph(0, 0, 0, r, r, r, c, 0, 10); const l = bs.c2 ?? 0xffffff, w = bs.c2 ? 0.012 : 0.025; b.tor(0, 0, 0, r * 1.008, w, l, [PI / 2, 0, 0], 12); b.tor(0, 0, 0, r * 1.008, w, l, [0, 0, 0], 12); if (bs.c2) b.tor(0, 0, 0, r * 1.008, w, l, [0, PI / 2, 0], 12); return b.build({ own: true }); },
      hit: (ii, b, e) => { if (e.speed > 1.5) ii.snd().tone({ freq: 160, freqEnd: 100, dur: 0.1, type: 'sine', vol: clamp(e.speed * 0.04, 0.05, 0.25), at: b.position }); } });
  }, { size: 0.4, face: 'random', spacing: 1.2 });
  def('beach-ball', 'big light striped beach ball that floats on every breeze; very bouncy', 'scale', ['beachball', 'inflatable ball', 'balloon ball', 'big ball', 'giant ball', 'inflatable'], (i, o) => {
    toy(i, o, { shape: 'sphere', mass: 0.12, bounce: 0.85, drag: 0.35, friction: 0.4, mesh: () => { const b = H.mk(); b.sph(0, 0, 0, 0.42, 0.42, 0.42, 0xffffff, 0, 10); const cs = [0xe02a2a, 0xffd23a, 0x2a8ae0, 0x2ab04a]; for (let k = 0; k < 6; k++) { const a = (k / 6) * PI; b.tor(0, 0, 0, 0.425, 0.05, cs[k % 4], [0, a, 0], 12); } b.cylc(0, 0.42, 0, 0.05, 0.05, 0.02, 0xffffff, 0, 6); return b.build({ own: true }); },
      hit: (ii, b, e) => { if (e.speed > 1) ii.snd().tone({ freq: 220, freqEnd: 150, dur: 0.12, type: 'sine', vol: 0.08, at: b.position }); } });
  }, { size: 0.6, face: 'random', spacing: 1.2 });
  def('dice', 'a pair of big white dice (option count = how many) that tumble when you throw them and settle on a face', 'count', ['die', 'd6', 'rolling dice', 'dices', 'gambling dice'], (i, o) => {
    const mk = () => { const b = H.mk(), P = (x, y, z) => b.sph(x, y, z, 0.022, 0.022, 0.022, 0x1a1a1a, 0, 4); b.box(0, 0, 0, 0.26, 0.26, 0.26, 0xf4f0e8);
      P(0, 0.131, 0); P(0.131, 0, 0); P(0.131 - 0.0, 0.07, 0.07); P(0.131, -0.07, -0.07); P(0, 0, 0.131); P(0.07, 0.07, 0.131); P(-0.07, -0.07, 0.131); P(-0.07, 0.07, -0.131); P(0.07, -0.07, -0.131); P(0.07, 0.07, -0.131); P(-0.07, -0.07, -0.131); P(0.07, 0.131, 0.07); P(-0.07, 0.131, -0.07); return b.build({ own: true }); };
    toy(i, o, { n: clamp(Math.floor(o.count ?? 2), 1, 12), what: 'dice', shape: 'box', mass: 0.2, bounce: 0.3, friction: 0.7, mesh: mk, hit: (ii, b, e) => { if (e.speed > 1) ii.snd().noise({ dur: 0.04, filter: { type: 'bandpass', freq: 1800, q: 2 }, vol: 0.15, at: b.position }); } });
  }, { ownCount: true, size: 0.4, face: 'random' });
  def('bowling-set', 'ten pins in a triangle plus a heavy ball: throw the ball and the pins really tip over and knock each other down (10 real bodies: trimmed to the body budget)', 'scale', ['bowling', 'bowling pins', 'skittles', 'ninepins', 'bowling alley', 'pins'], (i, o) => {
    const K = H.kit(); if (!K) return;
    const pinM = () => model('pin', (b) => { b.cyl(0, 0, 0, 0.07, 0.11, 0.14, 0xf4f0e8, 0, 8); b.cyl(0, 0.14, 0, 0.055, 0.07, 0.12, 0xf4f0e8, 0, 8); b.cyl(0, 0.26, 0, 0.04, 0.055, 0.1, 0xf4f0e8, 0, 8); b.sph(0, 0.4, 0, 0.055, 0.06, 0.055, 0xf4f0e8, 0, 8); b.cylc(0, 0.33, 0, 0.044, 0.044, 0.025, 0xd83a3a, 0, 8); b.cyl(0, 0.0, 0, 0.1, 0.11, 0.015, 0xd0ccc0, 0, 8); }, { own: true });
    const left = mx.room(i, 11, 'bowling pieces'), nPins = Math.max(0, Math.min(10, left - 1)), pins = []; let made = 0;
    for (let row = 0; row < 4; row++) for (let c = 0; c <= row; c++) {
      if (made++ >= nPins) break;
      const lx = (c - row / 2) * 0.32, lz = -row * 0.3, p = i.at(lx, lz), m = pinM(); m.scale.setScalar(1.3);
      const body = mx.solid(i, m, { shape: 'cylinder', mass: 1.5, bounce: 0.3, friction: 0.6, drag: 0.1, at: p });
      if (!body) continue;
      const pin = { m, body, fall: -1, ax: 0, az: 0 }; pins.push(pin);
      body.onHit((e) => { // a clatter (and, without physics, the old scripted tip-over)
        if (e.speed > 0.9 || e.kind === 'body') {
          if (!body.ph && pin.fall < 0) { pin.fall = 0; const v = body.velocity; const l = Math.hypot(v.x, v.z) || 1; pin.ax = v.z / l; pin.az = -v.x / l; if (e.other) { const dx = body.position.x - e.other.position.x, dz = body.position.z - e.other.position.z, ll = Math.hypot(dx, dz) || 1; pin.ax = dz / ll; pin.az = -dx / ll; } }
          if (e.speed > 0.9 && (pin.snd ?? 0) < H.ctx.clock.t) { pin.snd = H.ctx.clock.t + 0.15; i.snd().noise({ dur: 0.08, filter: { type: 'bandpass', freq: 1400, q: 2 }, vol: clamp(e.speed * 0.08, 0.06, 0.22), at: body.position }); }
        }
      });
    }
    if (left >= 1) {
      const bp = i.at(0, 5.5);
      const bm = (() => { const b = H.mk(); b.sph(0, 0, 0, 0.19, 0.19, 0.19, 0x1c2a52, 0, 10); b.sph(0.05, 0.12, 0.13, 0.025, 0.025, 0.025, 0x08080c, 0, 4); b.sph(-0.04, 0.14, 0.12, 0.025, 0.025, 0.025, 0x08080c, 0, 4); b.sph(0.0, 0.17, 0.08, 0.025, 0.025, 0.025, 0x08080c, 0, 4); return b.build({ own: true }); })();
      mx.solid(i, bm, { shape: 'sphere', mass: 5, bounce: 0.2, friction: 0.35, drag: 0.02, grab: true, range: 8, at: bp, up: 0.05 });
      i.track(bm);
    }
    i.tick((dt) => { for (const p of pins) { if (p.fall < 0 || p.body.ph) continue; p.fall = Math.min(1, p.fall + dt * 3.5); const k = 1 - (1 - p.fall) ** 2; p.m.rotation.set(p.ax * 1.5 * k, p.m.rotation.y, p.az * 1.5 * k); p.m.rotation.order = 'YXZ'; } });
  }, { size: 3, distance: 8 });
  def('balloon-bunch', 'seven helium balloons tethered to a little weight; shoot or hit them to pop (confetti puff + bang)', 'scale', ['balloons', 'balloon', 'party balloons', 'helium balloons', 'bunch of balloons'], (i, o) => {
    const K = H.kit(); if (!K) return;
    const k = o.scale ?? 1, cols = [0xe02a2a, 0xffd23a, 0x2a8ae0, 0x2ab04a, 0xe02ab0, 0xff8a2a, 0x9a4ae0];
    const wb = H.mk(); wb.cyl(0, 0, 0, 0.12, 0.14, 0.14, 0x6a5a48, 0, 8); const wm = wb.build({ own: true }); wm.scale.setScalar(k);
    mx.solid(i, wm, { shape: 'cylinder', mass: 1.2, bounce: 0.1, friction: 0.8, grab: true, range: 5, up: 0.15 }); i.track(wm);
    const bs = [], line = new THREE.BufferGeometry(); const lp = new Float32Array(7 * 2 * 3); line.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const lmat = new THREE.LineBasicMaterial({ color: 0xe8e4d8, transparent: true, opacity: 0.7 }); lmat.userData.own = true;
    const lines = new THREE.LineSegments(line, lmat); lines.frustumCulled = false; worldAdd(i, lines); i.cleanup(() => { line.dispose(); });
    for (let q = 0; q < 7; q++) {
      const b = H.mk(); b.sph(0, 0, 0, 0.26, 0.31, 0.26, cols[q], 0, 9); b.cone(0, -0.3, 0, 0.04, 0.07, shade(cols[q], 0.8), PI, 5); b.mode('glow'); b.sph(-0.08, 0.1, 0.16, 0.05, 0.08, 0.03, 0xffffff);
      const m = b.build({ own: true }); m.scale.setScalar(k); i.ctx.root.add(m); i.cleanup(() => { m.removeFromParent(); H.disposeOwn(m); });
      const bl = { m, h: 1.6 + rand(0, 1.0), ox: rand(-0.4, 0.4), oz: rand(-0.4, 0.4), ph: rand(0, 6), dead: false, c: cols[q] };
      bl.d = K.damageable(i.ctx, m, { hp: 1, radius: 0.34 * k, faction: 'neutral', onDeath: () => { bl.dead = true; m.visible = false; const p = m.position; i.burst('puff', bl.c, p, dn(6), 0.6); i.burst('bits', bl.c, p, dn(10), 0.5); i.snd().noise({ dur: 0.12, filter: { type: 'highpass', freq: 800 }, vol: 0.45, at: p }); i.snd().tone({ freq: 300, freqEnd: 80, dur: 0.1, type: 'square', vol: 0.15, at: p }); bl.d.remove(); } });
      i.cleanup(() => bl.d && bl.d.remove());
      bs.push(bl);
    }
    i.tick((dt, t) => {
      const wp = wm.position; if (wp.x === 0 && wp.y === 0 && wp.z === 0) wp.set(i.x, i.y + 0.3, i.z);
      for (let q = 0; q < 7; q++) {
        const b = bs[q], w = 0.4 + (H.ctx.world.env?.wind ?? 0.5);
        b.m.position.set(wp.x + b.ox * (0.5 + 0.2 * k) + Math.sin(t * 0.9 + b.ph) * 0.18 * w, wp.y + (b.h + Math.sin(t * 1.3 + b.ph) * 0.1) * k, wp.z + b.oz * (0.5 + 0.2 * k) + Math.cos(t * 0.8 + b.ph) * 0.18 * w);
        b.m.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.12;
        const s = q * 6; lp[s] = wp.x; lp[s + 1] = wp.y + 0.1; lp[s + 2] = wp.z; lp[s + 3] = b.m.position.x; lp[s + 4] = b.m.position.y - 0.32 * k; lp[s + 5] = b.m.position.z;
        if (b.dead) { lp[s + 3] = lp[s]; lp[s + 4] = lp[s + 1]; lp[s + 5] = lp[s + 2]; }
      }
      line.attributes.position.needsUpdate = true;
    });
  }, { size: 1, face: 'random', spacing: 3 });
  def('trampoline', 'in-ground bouncy trampoline pad: step on it and it launches you ~3.5 m into the air, again and again; loose crates, barrels and balls bounce on it too', 'scale, power', ['bouncy pad', 'bounce pad', 'jump pad', 'springboard', 'bouncy castle', 'trampolines', 'launch pad'], (i, o) => {
    const k = o.scale ?? 1, R = 1.6 * k, b = H.mk();
    b.tor(0, 0.16, 0, R, 0.1, 0xd8503a, [PI / 2, 0, 0], 20); for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU; b.cyl(Math.cos(a) * (R + 0.05), 0, Math.sin(a) * (R + 0.05), 0.045, 0.045, 0.2, 0x3a3e48, 0, 5); }
    for (let q = 0; q < 24; q++) { const a = (q / 24) * TAU; b.box(Math.cos(a) * (R - 0.08), 0.12, Math.sin(a) * (R - 0.08), 0.03, 0.03, 0.22, 0x8a8e98, [0, -a, 0]); }
    i.add(b.build());
    const mb = H.mk(); mb.mode('cloth'); mb.cylc(0, 0, 0, R - 0.1, R - 0.1, 0.04, 0x2a4a8a, 0, 22); mb.tor(0, 0.025, 0, R * 0.55, 0.02, 0xf4f0e0, [PI / 2, 0, 0], 20); mb.cylc(0, 0.03, 0, R * 0.2, R * 0.2, 0.02, 0xf4f0e0, 0, 12);
    const mat = mb.build({ own: true }); mat.position.y = 0.14; i.add(mat);
    let cd = 0, dip = 0, bt = 0;
    const PX = mx.physics(), pad = { x: i.x, y: i.y + 0.5, z: i.z };
    i.tick((dt, t) => {
      cd -= dt; dip = Math.max(0, dip - dt * 3); bt -= dt;
      if (PX && bt <= 0) { // loose bodies (crates, balls, barrels...) that land on the pad bounce too: up at 6.5 m/s or 85% of their fall speed
        bt = 0.06;
        for (const h of PX.overlapSphere(pad, R + 0.3)) {
          if (h.removed || h.type !== 'dynamic' || h.group === 'ragdoll') continue;
          const dx = h.position.x - i.x, dz = h.position.z - i.z, vy = h.velocity.y;
          if (dx * dx + dz * dz > (R - 0.1) * (R - 0.1) || h.position.y - i.y > 0.9 || vy > 1.5) continue;
          h.setVelocity(h.velocity.x, Math.max(6.5 * (o.power ?? 9) / 9, -vy * 0.85), h.velocity.z); h.wake(); dip = Math.max(dip, 0.7);
          _w.set(h.position.x, i.y + 0.2, h.position.z); i.snd().tone({ freq: 200, freqEnd: 480, dur: 0.2, type: 'sine', vol: 0.12, at: _w });
        }
      }
      mat.position.y = 0.14 - dip * 0.12 + Math.sin(t * 20) * 0.02 * dip;
      const dx = H.head.x - i.x, dz = H.head.z - i.z, P = H.playerApi();
      if (cd <= 0 && P && dx * dx + dz * dz < (R - 0.15) * (R - 0.15) && (P.grounded !== false) && H.head.y - H.ground(H.head.x, H.head.z) < 2.2) {
        cd = 0.4; dip = 1; P.velocity.y = 0; P.launch(0, o.power ?? 9, 0);
        _w.set(H.head.x, i.y + 0.2, H.head.z); i.snd().tone({ freq: 180, freqEnd: 520, dur: 0.35, type: 'sine', vol: 0.25, at: _w }); i.snd().tone({ freq: 90, freqEnd: 60, dur: 0.2, type: 'sine', vol: 0.3, at: _w }); i.burst('puff', 0xc8b898, _w, dn(4), 0.4);
      }
    }, { every: 0.04 });
  }, { size: 2 });

  // ================================================================ machines you fire with your hands
  def('cannon', 'iron field cannon (points away from you); trigger/squeeze with a hand at its rear fuse fires an exploding ball', 'scale', ['cannons', 'artillery', 'field cannon', 'ship cannon', 'big gun', 'cannonball', 'howitzer', 'gun emplacement'], (i, o) => {
    const k = o.scale ?? 1, PITCH = 0.2;
    const b = H.mk(); b.box(0, 0.5, 0, 0.85, 0.12, 1.7, WOOD); for (const s of [-1, 1]) { b.box(s * 0.4, 0.55, 0, 0.1, 0.4, 1.5, WOODD); b.cylc(s * 0.62, 0.45, 0.1, 0.45, 0.45, 0.12, WOOD, [0, 0, PI / 2], 12); b.cylc(s * 0.62, 0.45, 0.1, 0.1, 0.1, 0.16, IRON, [0, 0, PI / 2], 8); for (let q = 0; q < 6; q++) b.box(s * 0.62, 0.45, 0.1, 0.1, 0.9, 0.08, IRON, [q * 0.52, 0, 0]); } b.box(0, 0.35, -0.85, 0.5, 0.1, 0.7, WOODD, [0.35, 0, 0]);
    const base = b.build(); base.scale.setScalar(k); i.add(base);
    const brl = H.mk(); brl.cylc(0, 0, 0.1, 0.27, 0.22, 2.1, 0x25282e, [PI / 2, 0, 0], 12); for (const z of [-0.55, 0.15, 0.85]) brl.cylc(0, 0, z, 0.3, 0.3, 0.08, 0x3a3e48, [PI / 2, 0, 0], 12); brl.cylc(0, 0, 1.17, 0.27, 0.27, 0.12, 0x3a3e48, [PI / 2, 0, 0], 12); brl.sph(0, 0, -0.95, 0.15, 0.15, 0.15, 0x25282e); brl.cyl(0, 0.2, -0.75, 0.025, 0.025, 0.18, 0x8a7a5a, 0, 5);
    brl.mode('glow'); brl.sph(0, 0.4, -0.75, 0.035, 0.035, 0.035, 0xffa030);
    const barrel = new THREE.Group(); barrel.position.set(0, 0.95 * k, 0); barrel.rotation.x = -PITCH; barrel.scale.setScalar(k); const bm = brl.build({ own: true }); barrel.add(bm); i.add(barrel);
    cannonBehave(i, { pitch: PITCH, setRecoil: (r) => barrel.position.set(0, 0.95 * k, -r * 0.45 * k), fuseY: 1.2 * k, fuseZ: -1.05 * k, muzzleY: 0.95 * k + 1.9 * k * Math.sin(PITCH), muzzleZ: 1.9 * k * Math.cos(PITCH) });
  }, { size: 1.4, face: 'away' });
  // firing behaviour shared by both builds: v = { pitch, setRecoil(0..1), fuseY/fuseZ (local), muzzleY/muzzleZ (local), ball (optional override of the shot) }
  function cannonBehave(i, v) {
    const PITCH = v.pitch;
    let cool = 0, recoil = 0; const shots = [], balls = [];
    const fuse = _w.clone(), dir = new THREE.Vector3(), mz = new THREE.Vector3();
    const C = () => H.combat();
    i.tick((dt, t) => {
      if (i.broken && !shots.length && !balls.length) return true;
      stepBalls(balls, dt);
      cool -= dt; recoil = Math.max(0, recoil - dt * 2.2);
      if (!i.broken) v.setRecoil(recoil);
      world(i, 0, v.fuseY, v.fuseZ, fuse);
      if (!i.broken && cool <= 0 && H.handPressedNear(fuse.x, fuse.y, fuse.z, 0.55)) {
        cool = 1.7; recoil = 1;
        const sy = Math.sin(i.yaw), cy = Math.cos(i.yaw), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
        dir.set(sy * cp, sp, cy * cp);
        world(i, 0, v.muzzleY, v.muzzleZ, mz);
        const c = C();
        let shot = null;
        // a real iron ball (9 kg, 26 m/s, ccd) that plows through crates and explodes on its first hard landing; combat.fire only without physics
        const real = ballShot(i, { pos: mz, dir, speed: 26, r: 0.17, mass: 9, gravity: 5.5, damage: 28, splash: 3.2, force: 70, boom: { size: 1.8, color: 0xff7a1a }, color: 0x2a2c32, life: 6 });
        if (real) balls.push(real);
        else if (c) shot = c.fire({ origin: mz, direction: dir, speed: 26, damage: 28, from: 'player', radius: 0.32, splash: 3.2, gravity: 5.5, color: 0xffa040, life: 6 });
        if (shot) shots.push({ p: shot, x: mz.x, y: mz.y, z: mz.z });
        i.burst('fire', 0xff8a2a, mz, dn(12), 1.4, dir); i.burst('puff', 0xc8c8c8, mz, dn(14), 1.8, dir); i.burst('spark', 0xffcc66, mz, dn(14), 1.4);
        const K = H.kit(); K?.flash(i.ctx, mz, { color: 0xffa040, intensity: 60, distance: 14, duration: 0.25 });
        const s = i.snd(); s.noise({ dur: 0.7, filter: { type: 'lowpass', freq: 1800, freqEnd: 80, q: 0.8 }, vol: 0.9, at: mz }); s.tone({ freq: 90, freqEnd: 28, dur: 0.6, vol: 0.7, at: mz });
        for (const h of H.hands()) h.pulse?.(0.7, 120);
      }
      for (let q = shots.length - 1; q >= 0; q--) {
        const s = shots[q];
        if (s.p.on) { s.x = s.p.x; s.y = s.p.y; s.z = s.p.z; continue; }
        _w.set(s.x, s.y, s.z); H.kit()?.explosion(i.ctx, _w, { size: 1.8, color: 0xff7a1a }); shots.splice(q, 1);
      }
    }); // every frame: a trigger press is a one-frame edge
  }
  def('catapult', 'wooden catapult (faces away); trigger/squeeze at its release lever hurls a boulder in a big arc (35 dmg, 3.5 m blast)', 'scale', ['siege engine', 'mangonel', 'catapults', 'siege weapon', 'rock thrower', 'stone thrower'], (i, o) => {
    const k = o.scale ?? 1, b = H.mk();
    b.box(0, 0.25, 0, 1.6, 0.25, 2.8, WOODD); for (const s of [-1, 1]) { b.box(s * 0.6, 1.0, -0.2, 0.18, 1.7, 0.2, WOOD, [0, 0, s * 0.1]); b.box(s * 0.7, 0.2, 0.4, 0.2, 0.2, 2.6, WOODD); b.cylc(s * 0.85, 0.3, 1.0, 0.3, 0.3, 0.12, WOOD, [0, 0, PI / 2], 10); b.cylc(s * 0.85, 0.3, -1.0, 0.3, 0.3, 0.12, WOOD, [0, 0, PI / 2], 10); }
    b.cylc(0, 1.8, -0.2, 0.07, 0.07, 1.4, IRON, [0, 0, PI / 2], 6); b.cylc(0.8, 0.6, -1.0, 0.07, 0.07, 0.5, IRON, [0, 0, PI / 2], 6);
    b.box(0.95, 0.9, -0.95, 0.1, 0.1, 0.8, 0x6a4a2a, [0, 0, 0.0]); b.mode('glow'); b.sph(0.95, 0.9, -1.35, 0.07, 0.07, 0.07, 0xffa030);
    const base = b.build(); base.scale.setScalar(k); i.add(base);
    const ab = H.mk(); ab.box(0, 0, 1.2, 0.14, 0.12, 3.4, WOOD); ab.box(0, 0, -0.55, 0.3, 0.3, 0.5, IRON); ab.box(0, 0.2, 2.9, 0.7, 0.1, 0.7, WOODD); ab.box(0.3, 0.3, 2.9, 0.06, 0.3, 0.7, WOODD); ab.box(-0.3, 0.3, 2.9, 0.06, 0.3, 0.7, WOODD); ab.box(0, 0.3, 3.25, 0.7, 0.3, 0.06, WOODD);
    ab.sph(0, 0.4, 2.9, 0.22, 0.22, 0.22, 0x8a8680);
    const arm = new THREE.Group(); arm.position.set(0, 1.8 * k, -0.2 * k); arm.scale.setScalar(k); const am = ab.build({ own: true }); arm.add(am); i.add(arm);
    siegeBehave(i, { lever: [0.95 * k, 0.95 * k, -1.35 * k], launch: [3.2 * k, 2.7 * k], setPose: (a) => { arm.rotation.x = 0.55 - a * 1.6; } });
  }, { size: 2, face: 'away' });
  // lever-fired siege machine shared by both builds. v = { lever: [x, y, z] local, launch: [y, z] local, elev (rad), shot: {combat.fire overrides}, boom: {explosion overrides},
  //   setPose(a: 0 cocked .. 1 released), reload (s), rate }
  function siegeBehave(i, v) {
    let state = 'ready', a = 0, cool = 0, ft = 0;
    const lever = new THREE.Vector3(), mz = new THREE.Vector3(), dir = new THREE.Vector3(), shots = [], balls = [];
    const shot = { speed: 17, damage: 35, radius: 0.45, splash: 3.5, gravity: 9.8, color: 0xb8a890, life: 7, ...v.shot }, boom = { size: 2.0, color: 0xc8a070, ...v.boom };
    const el = v.elev ?? 0.85, sy = Math.sin(i.yaw), cy = Math.cos(i.yaw);
    dir.set(sy * Math.cos(el), Math.sin(el), cy * Math.cos(el));
    i.tick((dt, t) => {
      if (i.broken && !shots.length && !balls.length) return true;
      stepBalls(balls, dt);
      world(i, v.lever[0], v.lever[1], v.lever[2], lever);
      if (!i.broken && state === 'ready' && H.handPressedNear(lever.x, lever.y, lever.z, v.leverR ?? 0.5)) { state = 'fire'; ft = 0; i.snd().noise({ dur: 0.3, filter: { type: 'lowpass', freq: 500 }, vol: 0.3, at: lever }); }
      if (i.broken) { state = 'ready'; }
      else if (state === 'fire') {
        ft += dt; a += (1 - a) * Math.min(1, dt * 9);
        if (ft > 0.18 && !shots.length && !balls.length) {
          world(i, 0, v.launch[0], v.launch[1], mz);
          const c = H.combat();
          // a real boulder (a rigid body that crashes through crates) unless the machine fires bolts (v.real === false) or there is no physics
          const real = v.real === false ? null : ballShot(i, { pos: mz, dir, speed: shot.speed, r: shot.radius * 0.7, mass: 90 * shot.radius, gravity: shot.gravity, damage: shot.damage, splash: shot.splash, force: shot.damage * 2, boom, color: 0x8a8680, life: shot.life });
          if (real) balls.push(real);
          else if (c) { const p = c.fire({ origin: mz, direction: dir, from: 'player', ...shot }); if (p) shots.push({ p, x: mz.x, y: mz.y, z: mz.z }); }
          i.burst('puff', 0xc8b898, mz, dn(6), 0.8); i.snd().noise({ dur: 0.4, filter: { type: 'lowpass', freq: 900, freqEnd: 100 }, vol: 0.6, at: mz }); i.snd().tone({ freq: 110, freqEnd: 50, dur: 0.4, vol: 0.4, at: mz });
        }
        if (ft > 0.9) { state = 'reload'; cool = v.reload ?? 3.5; }
      } else if (state === 'reload') {
        cool -= dt; a += (0 - a) * Math.min(1, dt * 0.8);
        if (cool <= 0) { state = 'ready'; }
      }
      if (!i.broken) v.setPose(a, state);
      for (let q = shots.length - 1; q >= 0; q--) { const s = shots[q]; if (s.p.on) { s.x = s.p.x; s.y = s.p.y; s.z = s.p.z; continue; } _w.set(s.x, s.y, s.z); H.kit()?.explosion(i.ctx, _w, boom); i.burst('bits', 0x8a8680, _w, dn(12), 1.4); shots.splice(q, 1); }
    }); // every frame: a trigger press is a one-frame edge
  }
  def('fireworks-launcher', 'firework tubes launching coloured rockets (auto every 3-6 s, or reach in and press trigger) with trails, flash and crackle', 'auto (default true), scale', ['fireworks', 'firework', 'rockets', 'firecrackers', 'pyrotechnics', 'fireworks show', 'sparklers'], (i, o) => {
    const k = o.scale ?? 1, b = H.mk();
    b.box(0, 0.08, 0, 1.2, 0.16, 1.0, WOODD); for (let q = 0; q < 5; q++) { const x = (q - 2) * 0.22, h = 0.55 + (q % 3) * 0.12; b.cyl(x, 0.14, (q % 2) * 0.12 - 0.06, 0.07, 0.07, h, [0xd83a3a, 0x2a6ac8, 0xe0b82a, 0x2ab04a, 0xb02ab0][q], [0, 0, (q - 2) * 0.05], 8); b.cyl(x, 0.14 + h - 0.02, (q % 2) * 0.12 - 0.06, 0.075, 0.075, 0.04, IRON, [0, 0, (q - 2) * 0.05], 8); }
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const auto = o.auto !== false, rockets = [], palette = [0xff4a5a, 0xffd24a, 0x4aff8a, 0x4ab0ff, 0xb07aff, 0xff8ac8, 0xffffff, 0xff8a2a];
    let next = rand(0.8, 2), cd = 0;
    const tp = new THREE.Vector3();
    const launch = () => {
      const q = (Math.random() * 5) | 0; world(i, (q - 2) * 0.22 * k, 0.9 * k, 0, tp);
      rockets.push({ x: tp.x, y: tp.y, z: tp.z, vx: rand(-1.2, 1.2), vy: rand(19, 25), vz: rand(-1.2, 1.2), t: 0, life: rand(1.15, 1.6), c: pick(palette), c2: pick(palette), kind: (Math.random() * 3) | 0 });
      const s = i.snd(); s.noise({ dur: 0.9, filter: { type: 'highpass', freq: 600, freqEnd: 2500 }, vol: 0.25, at: tp }); s.tone({ freq: 300, freqEnd: 900, dur: 0.6, type: 'sawtooth', vol: 0.08, at: tp });
      i.burst('spark', 0xffcc66, tp, dn(10), 0.8, _up); i.burst('puff', 0xdddddd, tp, dn(4), 0.6, _up);
    };
    i.tick((dt, t) => {
      if (i.broken && !rockets.length) return true;
      cd -= dt;
      if (!i.broken && cd <= 0 && H.handPressedNear(i.x, i.y + 0.5 * k, i.z, 0.7)) { cd = 0.5; launch(); }
      if (!i.broken && auto && near(i, 120)) { next -= dt; if (next <= 0) { next = rand(3, 6); launch(); } }
      for (let q = rockets.length - 1; q >= 0; q--) {
        const r = rockets[q]; r.t += dt; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt; r.vy -= 4 * dt;
        _w.set(r.x, r.y, r.z); i.burst('spark', 0xffb040, _w, dn(2), 0.35); i.burst('puff', 0xcccccc, _w, dn(1), 0.25);
        if (r.t >= r.life) {
          rockets.splice(q, 1);
          const s = i.snd(), pw = _w;
          i.burst('spark', r.c, pw, dn(r.kind === 1 ? 50 : 80), 2.6); i.burst('glow', r.c, pw, dn(24), 2.6);
          if (r.kind === 2) { i.burst('spark', r.c2, pw, dn(50), 1.5); i.burst('glow', r.c2, pw, dn(18), 1.5); }
          H.kit()?.flash(i.ctx, pw, { color: r.c, intensity: 70, distance: 70, duration: 0.5 });
          s.noise({ dur: 0.5, filter: { type: 'lowpass', freq: 1200, freqEnd: 120 }, vol: 0.6, at: pw }); s.tone({ freq: 80, freqEnd: 40, dur: 0.5, vol: 0.4, at: pw });
          for (let c = 0; c < 4; c++) s.noise({ dur: 0.04, filter: { type: 'highpass', freq: 3500 }, vol: 0.2, at: pw, delay: 0.25 + c * 0.11 + Math.random() * 0.05 });
        }
      }
    });
  }, { size: 1, distance: 6 });
  def('music-box', 'small wooden music box with a spinning dancer: grab it or reach in and press trigger and it plays a tinkling lullaby for ~20 s', 'scale', ['musicbox', 'music player', 'jewelry box', 'wind-up toy', 'carillon', 'lullaby box', 'music boxes'], (i, o) => {
    const K = H.kit(); if (!K) return;
    const k = o.scale ?? 1, b = H.mk();
    b.box(0, 0, 0, 0.3, 0.14, 0.2, 0x7a3a2a); b.box(0, 0.08, 0, 0.31, 0.02, 0.21, 0xd9a93c); b.box(-0.01, 0.09, -0.11, 0.3, 0.12, 0.02, 0x7a3a2a, [0.9, 0, 0]);
    b.cylc(0.19, 0.01, 0, 0.015, 0.015, 0.06, 0xd9a93c, [0, 0, PI / 2], 6); b.cylc(0.23, 0.01, 0, 0.03, 0.03, 0.01, 0xd9a93c, [0, 0, PI / 2], 6); b.cyl(0, 0.075, 0, 0.005, 0.005, 0.02, 0xd9a93c, 0, 4);
    const m = b.build({ own: true });
    const dancer = new THREE.Group(); dancer.position.set(0, 0.1, 0.0); const db = H.mk(); db.cone(0, 0, 0, 0.04, 0.05, 0xff8ac8, 0, 7); db.sph(0, 0.07, 0, 0.018, 0.018, 0.018, 0xf4d0b0, 0, 5); db.cyl(0, 0.045, 0, 0.012, 0.012, 0.03, 0xf4d0b0, 0, 4); db.box(0.028, 0.065, 0, 0.04, 0.008, 0.008, 0xf4d0b0, [0, 0, 0.4]);
    dancer.add(db.build({ own: true })); m.add(dancer);
    m.scale.setScalar(k);
    const body = mx.solid(i, m, { shape: 'box', mass: 0.4, bounce: 0.15, friction: 0.7, grab: true, range: 5, up: 0.4 });
    i.track(m);
    const tune = [392, 392, 587, 587, 659, 659, 587, 523, 523, 494, 494, 440, 440, 392], pos = new THREE.Vector3();
    let play = 0, step = 0, nt = 0, cd = 0;
    if (body) { body.onGrab(() => { play = 20; }); }
    i.tick((dt, t) => {
      cd -= dt;
      if (cd <= 0 && body && !body.held && H.handPressedNear(body.position.x, body.position.y, body.position.z, 0.4, ['trigger'])) { play = 20; cd = 1; }
      if (play > 0) {
        play -= dt; dancer.rotation.y += dt * 2.5; nt -= dt;
        if (nt <= 0) {
          nt = step % 7 === 6 ? 0.8 : 0.42; const f = tune[step++ % tune.length]; m.getWorldPosition(pos);
          const s = i.snd(); s.tone({ freq: f, dur: 1.0, type: 'sine', vol: 0.16, at: pos }); s.tone({ freq: f * 2, dur: 0.5, type: 'sine', vol: 0.06, at: pos }); s.tone({ freq: f * 3.01, dur: 0.25, type: 'sine', vol: 0.025, at: pos });
          if (Math.random() < 0.5) i.burst('glow', 0xffe27a, pos, dn(1), 0.2, _up);
        }
      }
    });
  }, { size: 0.4, distance: 3, face: 'random' });
  def('bell', 'bronze bell hanging from a wooden frame: hit it with a weapon, spell or swipe your hand through it and it rings with a long, shimmering tone', 'scale', ['church bell', 'alarm bell', 'hanging bell', 'bells', 'gong', 'ship bell', 'dinner bell'], (i, o) => {
    const k = o.scale ?? 1, b = H.mk();
    for (const s of [-1, 1]) b.box(s * 0.85, 1.35, 0, 0.14, 2.7, 0.14, WOOD, [0, 0, -s * 0.07]); b.box(0, 2.65, 0, 2.0, 0.16, 0.18, WOODD); b.prism(0, 2.7, 0, 2.5, 0.5, 0.5, 0x7a3a2a);
    for (const s of [-1, 1]) b.box(s * 0.8, 0.55, 0, 0.1, 1.2, 0.1, WOODD, [0, 0, s * 0.45 * 0 + 0]);
    i.add(b.build());
    const pv = new THREE.Group(); pv.position.set(0, 2.6 * k, 0); pv.scale.setScalar(k);
    const bb = H.mk(); bb.cyl(0, -0.72, 0, 0.42, 0.18, 0.72, 0xd9a93c, 0, 12); bb.cyl(0, -0.78, 0, 0.5, 0.42, 0.1, 0xe8bb4c, 0, 12); bb.sph(0, -0.03, 0, 0.17, 0.12, 0.17, 0xd9a93c); bb.box(0, -0.08, 0, 0.04, 0.2, 0.04, IRON); bb.sph(0, -0.62, 0, 0.07, 0.07, 0.07, IRON);
    const bm = bb.build({ own: true }); pv.add(bm); i.add(pv);
    const bpos = new THREE.Vector3(); let swing = 0, ph = 0, prevH = [null, null], ringCd = 0;
    const ring = (v = 1) => {
      if (ringCd > 0) return; ringCd = 0.25; swing = Math.min(1, swing + 0.6 * v); world(i, 0, 1.9 * k, 0, bpos);
      const s = i.snd(), f = 392;
      [[1, 0.28], [2.01, 0.12], [2.76, 0.09], [4.07, 0.06], [5.4, 0.04]].forEach(([r, vol], q) => s.tone({ freq: f * r, dur: 3.2 / (1 + q * 0.5), type: 'sine', vol: vol * (0.6 + 0.4 * v), at: bpos, attack: 0.002 }));
      s.noise({ dur: 0.08, filter: { type: 'bandpass', freq: 2500, q: 2 }, vol: 0.2, at: bpos }); i.burst('glow', 0xffe27a, bpos, dn(4), 0.3, _up);
      for (const h of H.hands()) h.pulse?.(0.4, 60);
    };
    i.beh = { onDamage: (e) => ring(clamp(e.amount / 10, 0.4, 1)) }; // the damage side is BELL_DESTRUCT (bronze: tough, rings on every hit)
    const hv = [new THREE.Vector3(), new THREE.Vector3()];
    i.tick((dt, t) => {
      if (i.broken) return true;
      ringCd -= dt; swing = Math.max(0, swing - dt * 0.35); ph += dt * 5.5;
      pv.rotation.z = Math.sin(ph) * swing * 0.35; pv.rotation.x = Math.sin(ph * 0.83) * swing * 0.2;
      world(i, 0, 1.9 * k, 0, bpos);
      const HS = H.hands();
      for (let q = 0; q < 2; q++) { const h = HS[q]; if (!h.connected) continue; const dx = h.position.x - bpos.x, dy = h.position.y - bpos.y, dz = h.position.z - bpos.z; if (dx * dx + dy * dy + dz * dz < 0.25 && prevH[q]) { const sp = hv[q].copy(h.position).sub(prevH[q]).length() / Math.max(dt, 0.001); if (sp > 1.4) ring(clamp(sp / 5, 0.4, 1)); } prevH[q] = prevH[q] || new THREE.Vector3(); prevH[q].copy(h.position); }
    }); // every frame: a trigger press is a one-frame edge
  }, { size: 1.5 });

  def('treasure-pile', 'heap of ~80 gold coins with gems, a goblet, a jeweled crown and a sack, plus coin stacks and a gold chest; glints and sparkles; breakable', 'scale', ['gold', 'hoard', 'loot pile', 'coins', 'riches', 'dragon hoard', 'money', 'gold pile', 'treasure hoard', 'gems'], (i, o) => treasureHeap(i, o), { size: 1.6 });
  function treasureHeap(i, o) {
    const k = o.scale ?? 1, b = H.mk();
    for (let q = 0; q < 80; q++) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 1.2, h = Math.max(0, 0.8 - r * 0.65); b.cylc(Math.cos(a) * r, h * 0.8 + rand(0, 0.05), Math.sin(a) * r, 0.1, 0.1, 0.025, pick([0xe8b83a, 0xd9a93c, 0xf4d070, 0xc89a2c]), [rand(-1, 1), rand(0, 3), rand(-1, 1)], 7); }
    b.sph(0, 0.1, 0, 0.9, 0.3, 0.9, 0xd9a93c, 0, 8);
    b.cyl(0.5, 0.35, 0.3, 0.07, 0.04, 0.16, 0xe8b83a, 0, 8); b.cyl(0.5, 0.33, 0.3, 0.1, 0.07, 0.04, 0xe8b83a, 0, 8); b.sph(0.5, 0.34, 0.3, 0.06, 0.06, 0.06, 0xd9a93c, 0, 6);
    b.cyl(-0.3, 0.52, 0.1, 0.17, 0.17, 0.08, 0xd9a93c, 0, 9); for (let q = 0; q < 5; q++) { const a = q * 1.257; b.cone(-0.3 + Math.cos(a) * 0.15, 0.6, 0.1 + Math.sin(a) * 0.15, 0.04, 0.12, 0xd9a93c, 0, 4); }
    b.sph(-1.1, 0.35, -0.4, 0.4, 0.38, 0.38, 0x8a6a3a, 0, 7); b.cone(-1.1, 0.6, -0.4, 0.14, 0.2, 0x8a6a3a, 0, 5); b.cylc(-1.1, 0.62, -0.4, 0.14, 0.14, 0.04, 0x6a4a2a, 0, 6);
    b.mode('glow'); for (let q = 0; q < 9; q++) { const a = rand(0, TAU), r = rand(0.1, 0.9); b.oct(Math.cos(a) * r, 0.5 - r * 0.3, Math.sin(a) * r, 0.07, 0.1, 0.07, pick([0xff4a6a, 0x4ac8ff, 0x6aff8a, 0xc87aff, 0xfff070]), [rand(0, 1), rand(0, 3), 0]); }
    b.sph(-0.3, 0.7, 0.1, 0.035, 0.035, 0.035, 0xff3a5a);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    let n = 0;
    i.tick((dt) => { if (i.broken) return true; if (!near(i, 40)) return; n -= dt; if (n < 0) { n = rand(0.12, 0.5); _w.set(i.x + rand(-1, 1) * k, i.y + rand(0.2, 0.9) * k, i.z + rand(-1, 1) * k); i.burst('glow', 0xfff0a0, _w, dn(1), 0.22, _up); } }, { every: 0.06 });
  }

  def('scarecrow', 'ragged straw scarecrow on a pole with a patched hat and a crow perched on its shoulder (the crow flaps off when you get close)', 'scale', ['scarecrows', 'straw man', 'field guardian', 'farm scarecrow'], (i, o) => {
    const k = o.scale ?? 1, b = H.mk();
    b.cyl(0, 0, 0, 0.05, 0.06, 2.3, WOODD, 0, 6); b.box(0, 1.65, 0, 1.6, 0.09, 0.09, WOODD);
    b.mode('cloth'); b.cyl(0, 0.9, 0, 0.27, 0.32, 0.8, 0x6a5a8a, 0, 8); b.box(0.75, 1.5, 0, 0.5, 0.3, 0.05, 0x6a5a8a, [0, 0, -0.35]); b.box(-0.75, 1.5, 0, 0.5, 0.3, 0.05, 0x6a5a8a, [0, 0, 0.35]);
    for (let q = 0; q < 7; q++) b.cone(-0.7 + q * 0.23, 1.52, 0, 0.03, 0.2, 0xd8b860, PI, 4); for (let q = 0; q < 5; q++) b.cone(-0.2 + q * 0.1, 0.9, 0.2, 0.03, 0.22, 0xd8b860, [PI, 0, 0.2], 4);
    b.mode('solid'); b.sph(0, 1.95, 0, 0.23, 0.24, 0.22, 0xd8c498, 0, 8); b.box(0.09, 1.99, 0.2, 0.06, 0.04, 0.02, 0x1a1a1a); b.box(-0.09, 1.99, 0.2, 0.06, 0.04, 0.02, 0x1a1a1a); for (let q = -2; q <= 2; q++) b.box(q * 0.04, 1.87, 0.21, 0.015, 0.05, 0.01, 0x1a1a1a);
    b.cyl(0, 2.1, 0, 0.36, 0.34, 0.03, 0x5a3a28, 0, 10); b.cyl(0, 2.1, 0, 0.2, 0.17, 0.3, 0x5a3a28, 0, 10); b.box(0.1, 2.25, 0.18, 0.12, 0.12, 0.02, 0x8a6a3a);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const cb = H.mk(); cb.mode('cloth'); cb.sph(0, 0, 0, 0.07, 0.065, 0.12, 0x17171d); cb.sph(0, 0.04, 0.12, 0.045, 0.045, 0.05, 0x17171d); cb.cone(0, 0.04, 0.16, 0.015, 0.06, 0xd88a30, [PI / 2, 0, 0], 4); cb.cone(0, 0, -0.12, 0.05, 0.14, 0x17171d, [-PI / 2 - 0.1, 0, 0], 4);
    const crow = new THREE.Group(); const cm = cb.build({ own: true }); crow.add(cm);
    const wb = H.mk(); wb.mode('cloth'); wb.sph(0.17, 0, 0, 0.17, 0.012, 0.08, 0x24242c); const wmR = wb.build({ own: true }); const wmL = wmR.clone(); wmL.scale.x = -1; crow.add(wmR, wmL);
    crow.position.set(0.55 * k, 1.78 * k, 0); crow.rotation.y = -0.6; crow.scale.setScalar(k); i.add(crow);
    wmR.rotation.z = wmL.rotation.z = 1.25; wmR.rotation.z = -1.25;
    let st = 'perched', ft = 0, away = 0; const home = crow.position.clone(), dir = new THREE.Vector3();
    i.tick((dt, t) => {
      if (i.broken) return true;
      const d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      if (st === 'perched') {
        crow.rotation.y = -0.6 + Math.sin(t * 0.7) * 0.5; crow.position.y = home.y + Math.abs(Math.sin(t * 2.2)) * 0.01;
        if (d < 4.5) { st = 'fly'; ft = 0; away = Math.atan2(i.x - H.head.x, i.z - H.head.z); i.snd().tone({ freq: 520, freqEnd: 400, dur: 0.25, type: 'sawtooth', vol: 0.1, at: { x: i.x, y: i.y + 2, z: i.z } }); i.snd().tone({ freq: 500, freqEnd: 400, dur: 0.25, type: 'sawtooth', vol: 0.1, at: { x: i.x, y: i.y + 2, z: i.z }, delay: 0.3 }); }
      } else if (st === 'fly') {
        ft += dt; const fl = Math.sin(t * 22) * 0.9; wmR.rotation.z = -fl; wmL.rotation.z = fl;
        const ca = Math.cos(i.yaw), sa = Math.sin(i.yaw); // move in world space expressed in the instance frame
        dir.set(Math.sin(away) * 5.5, 3.5, Math.cos(away) * 5.5);
        crow.position.x += (dir.x * ca - dir.z * sa) * dt; crow.position.z += (dir.x * sa + dir.z * ca) * dt; crow.position.y += dir.y * dt; crow.rotation.y = away - i.yaw;
        if (ft > 4.5) { st = 'gone'; crow.visible = false; ft = 0; }
      } else if (st === 'gone') { ft += dt; if (ft > 22 && d > 12) { st = 'perched'; crow.visible = true; crow.position.copy(home); wmR.rotation.z = -1.25; wmL.rotation.z = 1.25; } }
    }, { every: 0.03 });
  }, { size: 1 });
  def('snowman', 'jolly snowman with a top hat, carrot nose, coal eyes, scarf and stick arms; says "Ouch!" when hit', 'scale', ['snow man', 'frosty', 'snowmen', 'snow person', 'olaf', 'snow sculpture'], (i, o) => {
    const k = o.scale ?? 1, b = H.mk();
    b.sph(0, 0.55, 0, 0.62, 0.55, 0.62, 0xf6fbff, 0, 10); b.sph(0, 1.38, 0, 0.45, 0.42, 0.45, 0xf6fbff, 0, 10); b.sph(0, 1.95, 0, 0.32, 0.31, 0.32, 0xf6fbff, 0, 10);
    for (const x of [-0.11, 0.11]) b.sph(x, 2.02, 0.28, 0.035, 0.035, 0.035, 0x15151a, 0, 5);
    for (let q = 0; q < 5; q++) { const a = (q - 2) * 0.22; b.sph(Math.sin(a) * 0.3, 1.88 - Math.abs(a) * 0.12, Math.cos(a) * 0.3 * 0.9, 0.022, 0.022, 0.022, 0x15151a, 0, 4); }
    b.cone(0, 1.95, 0.3, 0.05, 0.3, 0xff7a1a, [PI / 2, 0, 0], 5);
    for (let q = 0; q < 3; q++) b.sph(0, 1.45 - q * 0.22, 0.43 - q * 0.02, 0.04, 0.04, 0.03, 0x15151a, 0, 4);
    b.cyl(0, 2.2, 0, 0.3, 0.3, 0.04, 0x1a1a20, 0, 10); b.cyl(0, 2.22, 0, 0.19, 0.19, 0.3, 0x1a1a20, 0, 10); b.cyl(0, 2.24, 0, 0.195, 0.195, 0.06, 0xb02a2a, 0, 10);
    b.mode('cloth'); b.tor(0, 1.66, 0, 0.3, 0.06, 0xd83a3a, [PI / 2, 0, 0], 10); b.box(0.2, 1.4, 0.26, 0.12, 0.45, 0.04, 0xd83a3a, [0, 0, -0.1]); b.mode('solid');
    for (const s of [-1, 1]) { b.cyl(s * 0.4, 1.5, 0, 0.02, 0.03, 0.8, WOODD, [0, 0, -s * 1.1], 4); b.cyl(s * 0.9, 1.9, 0, 0.012, 0.018, 0.2, WOODD, [0, 0, s * 0.5], 3); }
    const g = new THREE.Group(); const m = b.build({ own: true }); g.add(m); g.scale.setScalar(k); i.add(g);
    const tk = H.talker(i, g, 2.7 * k); let wob = 0;
    i.beh = { onDamage: (e) => { wob = 1; tk.say(pick(['Ouch!', 'My carrot!', 'Hey, I\'m melting here!', 'Brrr... stop!']), 2); if (e.point) i.burst('puff', 0xffffff, e.point, dn(5), 0.4); } }; // damage side: SNOWMAN_DESTRUCT (ice, 16 hp)
    i.tick((dt, t) => { if (i.broken) return true; wob = Math.max(0, wob - dt * 1.5); g.rotation.z = Math.sin(t * 16) * wob * 0.12; });
  }, { size: 0.8 });

  def('statue', 'stone statue on a plinth; option style: knight (default) | angel | wizard | dragon; option text engraves the plinth', 'style, text', ['monument statue', 'sculpture', 'stone knight', 'angel statue', 'dragon statue', 'wizard statue', 'effigy', 'statues'], (i, o) => {
    const style = String(o.style ?? pick(['knight', 'angel', 'wizard', 'dragon'])), k = o.scale ?? 1, st = pick([0xa8a49a, 0x9a9a9e, 0xc4c0b4]), b = H.mk();
    b.box(0, 0.25, 0, 1.5, 0.5, 1.5, 0x7a766e); b.box(0, 0.7, 0, 1.2, 0.4, 1.2, 0x8a867c); b.box(0, 1.0, 0, 1.3, 0.12, 1.3, 0x9a968c);
    if (style === 'dragon') {
      b.sph(0, 1.55, 0, 0.55, 0.38, 0.8, st, 0, 8); b.sph(0, 2.15, 0.62, 0.22, 0.4, 0.2, st, [0.5, 0, 0], 7); b.sph(0, 2.55, 0.78, 0.2, 0.17, 0.3, st, 0, 7); for (let q = 0; q < 4; q++) b.sph(0, 1.4 - q * 0.08, -0.75 - q * 0.38, 0.2 - q * 0.04, 0.17 - q * 0.03, 0.3, st, 0, 6);
      for (const s of [-1, 1]) { b.cone(0.7 * s, 1.75, -0.1, 0.1, 1.5, st, [0.4, 0, -1.0 * s], 4); b.cone(0.12 * s, 2.75, 0.7, 0.04, 0.3, st, [-0.8, 0, -0.3 * s], 4); b.cyl(0.35 * s, 1.0, 0.4, 0.12, 0.1, 0.45, st, 0, 6); }
    } else {
      b.cyl(-0.18, 1.0, 0, 0.14, 0.12, 0.9, st, 0, 7); b.cyl(0.18, 1.0, 0, 0.14, 0.12, 0.9, st, 0, 7);
      b.sph(0, 2.2, 0, 0.36, 0.5, 0.25, st, 0, 8); b.sph(0, 2.9, 0, 0.2, 0.22, 0.2, st, 0, 8);
      if (style === 'knight' || (style !== 'angel' && style !== 'wizard')) { b.box(0, 3.15, 0, 0.18, 0.1, 0.22, shade(st, 0.9)); b.cyl(0.45, 1.9, 0.1, 0.07, 0.06, 1.1, st, [0, 0, -0.1], 6); b.box(0.5, 3.4, 0.1, 0.05, 1.4, 0.02, shade(st, 1.1)); b.box(0.5, 2.78, 0.1, 0.3, 0.05, 0.05, st); b.cylc(-0.45, 2.1, 0.15, 0.3, 0.3, 0.06, shade(st, 0.9), [PI / 2, 0, 0], 8); b.cyl(-0.4, 1.7, 0, 0.08, 0.07, 0.7, st, [0, 0, 0.2], 6); }
      else if (style === 'angel') { b.cone(0, 1.4, 0, 0.5, 1.2, st, 0, 8); b.sph(0, 2.9, 0, 0.2, 0.22, 0.2, st, 0, 8); for (const s of [-1, 1]) { b.cone(0.28 * s, 2.0, -0.2, 0.18, 1.7, st, [0.2, 0, -0.6 * s], 4); b.cone(0.5 * s, 2.0, -0.2, 0.14, 1.4, st, [0.2, 0, -1.0 * s], 4); b.cyl(0.4 * s, 2.4, 0.1, 0.06, 0.05, 0.6, st, [-0.8, 0, -0.7 * s], 5); } b.mode('glow'); b.tor(0, 3.3, 0, 0.18, 0.015, 0xfff0b0, [PI / 2, 0, 0], 12); }
      else { b.cone(0, 1.2, 0, 0.55, 1.5, st, 0, 8); b.cone(0, 3.0, 0, 0.3, 0.8, shade(st, 0.9), 0.1, 7); b.cyl(0, 3.0, 0, 0.42, 0.42, 0.04, shade(st, 0.9), 0, 8); b.cyl(0.5, 1.5, 0.2, 0.04, 0.05, 1.9, shade(st, 0.8), 0, 5); b.sph(0.5, 3.45, 0.2, 0.12, 0.12, 0.12, shade(st, 1.2), 0, 6); b.box(0, 2.7, 0.2, 0.26, 0.4, 0.04, shade(st, 0.8)); b.sph(0, 2.78, 0.25, 0.06, 0.2, 0.04, shade(st, 1.1)); b.mode('glow'); b.sph(0.5, 3.45, 0.2, 0.06, 0.06, 0.06, 0x7a9aff); }
    }
    b.mode('solid'); for (let q = 0; q < 7; q++) b.sph(rand(-0.6, 0.6), rand(0.3, 2.5), rand(-0.5, 0.5), rand(0.06, 0.15), 0.03, rand(0.06, 0.12), pick([0x4a7a3a, 0x5a8a40]), 0, 4);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    if (o.text) i.label(String(o.text), { size: 0.09, color: 0xe8e0c8, background: false, position: { x: i.wx(0, 0.62 * k), y: i.y + 0.7 * k, z: i.wz(0, 0.62 * k) }, maxWidth: 420 });
  }, { size: 1.2 });

  // ================================================================================================================
  // MODEL BUILDS (world.models). The primitive builders above stay as the fallback; the contract is in modelkit.js.
  // ================================================================================================================
  const kk = (o) => o.scale ?? 1;
  const NOMODEL = '__primitive__'; // P(NOMODEL) throws -> the entry's primitive build runs (an option picked a style that only exists as primitives)
  const ctrOf = (p) => ({ x: p.min.x + p.size.x / 2, z: p.min.z + p.size.z / 2 }); // footprint centre in the piece's own frame
  const box3 = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(V3(x0, y0, z0), V3(x1, y1, z1));
  // breakable around an explicit box (instance frame); `items` (pieces, Object3Ds, scatter items) are hidden when it breaks
  function breakBox(i, box, items, cfg) {
    items = items.filter(Boolean);
    const pal = items.find((x) => x.palette);
    const proxy = mx.makeProxy(i, [box], cfg.colors ?? (pal ? pal.palette() : null), cfg.material ?? 'wood');
    return mx.breakable(i, [proxy], {
      ...cfg, colors: undefined, stages: undefined,
      onBreak(e) {
        for (const it of items) { if (it.h) it.obj.visible = false; else if (it.isObject3D) it.visible = false; else if (it.set) it.set.setMatrixAt(it.k, mx.ZERO); }
        if (cfg.onBreak) cfg.onBreak(e);
      },
    });
  }
  const WOODW = (hp, extra) => brk({ material: 'wood', hp, stages: 'auto', ...extra });

  // ---- containers
  function chestModel(gold) {
    return {
      model(P, o, i) { const k = kk(o); return { i, k, p: P(gold || o.style === 'gold' ? 'chest-gold' : 'chest', { height: 0.85 * k, anchor: 'center' }) }; },
      after(pieces, plan, o) {
        const { i, p } = plan, fit = p.h.fit;
        if (o.color !== undefined) p.tint(o.color);
        const parts = splitParts(p, 'chest-lid', (e) => (e.max.y > 0.65 ? 1 : 0), [null, [0, 0.58, -0.62]]); // lid islands pivot on the back top edge
        const c = ctrOf(p), hw = p.size.x * 0.33, hd = p.size.z * 0.3, yTop = 0.6 * fit;
        const heap = goldHeap(hw, hd, 0); heap.position.set(c.x, yTop, c.z); p.obj.add(heap);
        chestBehave(i, o, { setOpen(a) { parts[1].rotation.x = -a * 1.9; heap.visible = a > 0.12; }, top: yTop + 0.1, hw, hd });
      },
      destruct: CHEST_DESTRUCT,
    };
  }
  mx.model('chest', chestModel(false));
  mx.model('barrel', {
    model(P, o, i) { return { i, p: P('barrel', { height: 1.1, y: -0.5, anchor: 'center' }) }; },
    after(pieces, plan, o) { const { i, p } = plan; physModel(i, o, p, { r: 0.5, shape: 'cylinder', mass: 15, hp: 40, bounce: 0.1, material: 'wood', onBreak(pos) { dropLoot(i, o.loot, pos); } }); },
  });
  mx.model('powder-keg', {
    model(P, o, i) { return { i, p: P('barrel', { height: 1.0, y: -0.5, anchor: 'center' }) }; },
    after(pieces, plan, o) {
      const { i, p } = plan, c = ctrOf(p), top = p.size.y, b = H.mk();
      p.tint(0x6e5e58);
      b.cyl(c.x + 0.06, top - 0.02, c.z, 0.02, 0.02, 0.3, 0x8a7a5a, [0, 0, -0.3], 4);
      b.cylc(c.x, top * 0.5, c.z + p.size.z / 2 + 0.005, 0.17, 0.17, 0.02, 0xe6dfc8, [PI / 2, 0, 0], 10);
      b.cylc(c.x - 0.06, top * 0.5 + 0.03, c.z + p.size.z / 2 + 0.02, 0.035, 0.035, 0.01, 0x15151a, [PI / 2, 0, 0], 6); b.cylc(c.x + 0.06, top * 0.5 + 0.03, c.z + p.size.z / 2 + 0.02, 0.035, 0.035, 0.01, 0x15151a, [PI / 2, 0, 0], 6);
      b.mode('glow'); b.sph(c.x + 0.14, top + 0.28, c.z, 0.045, 0.045, 0.045, 0xffa030);
      p.obj.add(b.build({ own: true }));
      physModel(i, o, p, { r: 0.5, shape: 'cylinder', mass: 15, hp: 4, bounce: 0.1, material: 'wood', colors: [{ hex: 0x4e3a2e, w: 0.6 }, { hex: 0x8a2a2a, w: 0.4 }], onBreak(pos) {
        blast(i, pos, { size: 2.2, damage: 35, radius: 4.4, force: 110 }); i.burst('puff', 0x2a2a2a, pos, dn(12), 1.4, _up);
      } });
    },
  });

  // ---- furniture
  mx.model('table', {
    model(P, o, i) {
      const k = kk(o), t = P('table-medium', { height: 0.8 * k, anchor: 'center' });
      return { i, t, items: [P('plate-food-a', { x: -0.3 * k, z: 0.12 * k, y: 0.8 * k, height: 0.16 * k, anchor: 'center' }), P('mug-full', { x: 0.45 * k, z: -0.2 * k, y: 0.8 * k, height: 0.14 * k, anchor: 'center' }), P('candle-lit', { x: 0.1 * k, z: 0.35 * k, y: 0.8 * k, height: 0.28 * k, anchor: 'center' })] };
    },
    destruct: WOODW(24), phys: { shape: 'box', mass: 14, friction: 0.7 }, // loose furniture: shoved, tipped and thrown by blasts (mx.dynamic)
  });
  mx.model('chair', { model(P, o) { P('chair', { height: 1.0 * kk(o), anchor: 'center' }); }, destruct: WOODW(14), phys: { shape: 'box', mass: 5, friction: 0.7 } });
  mx.model('bench', { model(P, o) { P('bench', { scale: 1.15 * kk(o), anchor: 'center' }); }, destruct: WOODW(20), phys: { shape: 'box', mass: 12, friction: 0.7 } });
  mx.model('bed', { model(P, o) { P(o.style === 'double' ? pick(['bed-double-a', 'bed-double-b']) : pick(['bed-single-a', 'bed-single-b']), { scale: kk(o), anchor: 'center' }); }, destruct: WOODW(30, { block: true }) }); // heavy: fixed and blocking

  // ---- light sources
  mx.model('lantern', {
    model(P, o, i) { return { i, p: P('lantern-standing', { height: 0.5, y: -0.15, anchor: 'center' }) }; },
    after(pieces, plan, o) {
      const { i, p } = plan;
      let L = null;
      const ph = physModel(i, o, p, { r: 0.15, shape: 'cylinder', mass: 0.8, bounce: 0.2, friction: 0.7, grab: true, range: 5, material: 'glass', hp: 5, onBreak(pos) {
        if (L) L.remove();
        H.kit()?.flash(i.ctx, pos, { color: 0xffc070, intensity: 20, distance: 6, duration: 0.2 }); i.burst('glow', 0xffc070, pos, dn(8), 0.6, _up);
      } });
      if (!ph) return;
      L = i.light({ color: 0xffc070, intensity: 11, distance: 10, flicker: 0.25 }); if (L) L.target = ph.mesh;
    },
  });
  mx.model('torch-stand', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('torch', { height: 0.62 * k, y: 1.72 * k, anchor: 'center' }) }; },
    after(pieces, plan, o) {
      const { i, k } = plan, b = H.mk();
      b.cyl(0, 0, 0, 0.05, 0.07, 1.8, WOODD, 0, 6); b.cyl(0, 0, 0, 0.18, 0.2, 0.08, 0x6e6a64, 0, 7);
      plan.pole = b.build(); plan.pole.scale.setScalar(k); i.add(plan.pole);
      torchFire(i, o, k, 2.4, 2.3);
    },
    destruct(i, pieces, plan, o) {
      const k = kk(o);
      if (!plan) mx.breakable(i, pieces, { material: 'wood', hp: 16 });
      else breakBox(i, box3(-0.3 * k, 0, -0.3 * k, 0.3 * k, 2.4 * k, 0.3 * k), [pieces[0], plan.pole], { material: 'wood', hp: 16 });
    },
  });
  mx.model('bonfire', {
    model(P, o, i) { const k = kk(o); return { i, k, st: P('campfire-stones', { scale: 1.25 * k, anchor: 'center' }), lg: P('campfire-logs', { scale: 1.9 * k, anchor: 'center', y: 0.04 * k }) }; },
    after(pieces, plan, o) { bonfireFire(plan.i, o, plan.k); },
  });
  mx.model('anvil', {
    model(P, o) { P('workbench-anvil', { height: 1.0 * kk(o), anchor: 'center' }); },
    destruct: brk((i) => ({ material: 'metal', hp: 160, block: true, onDamage: (e) => anvilClang(i, e) })),
  });
  mx.model('cauldron', { destruct: brk({ material: 'metal', hp: 130, block: true }) });

  // ---- training / toys
  mx.model('archery-target', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('target', { height: 1.6 * k, anchor: 'center' }) }; },
    after(pieces, plan) {
      const { i, k, p } = plan, tg = new THREE.Group(), c = ctrOf(p);
      tg.position.set(c.x, p.size.y * 0.66, c.z + p.size.z * 0.2); i.add(tg);
      archeryBehave(i, tg, k, (p.size.x * 0.42) / k);
      i.tick(() => { p.obj.rotation.x = tg.rotation.x; }, { every: 0.03 }); // the model wobbles with its anchor
    },
    destruct: ARCHERY_DESTRUCT,
  });
  mx.model('fireworks-launcher', { destruct: brk({ material: 'wood', hp: 24 }) });
  mx.model('bell', { destruct: brk((i) => ({ material: 'metal', hp: 260, onDamage: (e) => { if (i.beh) i.beh.onDamage(e); } })) });
  mx.model('treasure-pile', {
    model(P, o, i) {
      const k = kk(o);
      return { i, k, a: P('chest-gold', { x: -0.9 * k, z: -0.7 * k, yaw: 0.5, height: 0.7 * k, anchor: 'center' }), b: P('coin-stack-large', { x: 1.15 * k, z: 0.45 * k, height: 0.9 * k, anchor: 'center' }) };
    },
    after(pieces, plan, o) { const { i } = plan, before = new Set(i.group.children); treasureHeap(i, o); plan.extra = i.group.children.filter((c) => !before.has(c)); },
    destruct(i, pieces, plan) { mx.breakable(i, plan ? pieces.concat(plan.extra) : pieces, { material: 'metal', hp: 60 }); },
  });

  // ---- machines
  mx.model('cannon', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('cannon-mobile', { height: 1.3 * k, anchor: 'center' }) }; },
    after(pieces, plan) {
      const { i, p } = plan, bb = p.aabb();
      const parts = splitParts(p, 'cannon-barrel', (e) => (e.max.z - e.min.z > 1.5 ? 1 : 0), [null, [0, 0, 0]]); // the long island is the barrel: it recoils
      cannonBehave(i, { pitch: 0.12, setRecoil: (r) => { parts[1].position.z = -r * 0.3; }, fuseY: bb.max.y * 0.95, fuseZ: bb.min.z + 0.1, muzzleY: bb.max.y * 0.7, muzzleZ: bb.max.z });
    },
    destruct: brk({ material: 'metal', hp: 170, stages: 'auto', block: true }),
  });
  mx.model('catapult', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('siege-catapult', { height: 3.0 * k, yaw: -PI / 2, anchor: 'center' }) }; },
    after(pieces, plan) {
      const { i, k, p } = plan, bb = p.aabb();
      const parts = splitParts(p, 'catapult-arm', (e) => (e.min.x < -0.9 ? 1 : 0), [null, [0.45, 0.17, 0]]); // the long arm island swings about the axle
      siegeBehave(i, { lever: [0, bb.max.y * 0.25, bb.min.z + 0.2 * k], leverR: 1.1, launch: [bb.max.y * 0.85, bb.max.z * 0.5], setPose: (a) => { parts[1].rotation.z = -a * 1.45; } });
    },
    destruct: WOODW(90, { rubble: ['resource-planks'], block: true }),
  });

  // ---- decorations
  mx.model('scarecrow', { destruct: WOODW(22) });
  mx.model('snowman', { destruct: brk((i) => ({ material: 'ice', hp: 16, onDamage: (e) => { if (i.beh) i.beh.onDamage(e); } })) });
  mx.model('statue', {
    model(P, o, i) {
      const st = String(o.style ?? ''), H0 = { head: 2.6, ring: 2.4, obelisk: 3.4, column: 3.0, block: 1.4 };
      if (!H0[st]) P(NOMODEL); // knight | angel | wizard | dragon only exist as primitives
      return { i, p: P('statue-' + st, { height: H0[st] * kk(o), anchor: 'center' }) };
    },
    after(pieces, plan, o) { if (o.text) plan.i.label(String(o.text), { size: 0.09, color: 0xe8e0c8, background: false, position: { x: plan.i.wx(0, 0.5), y: plan.i.y + 0.5, z: plan.i.wz(0, 0.5) }, maxWidth: 420 }); },
    destruct: brk({ material: 'stone', hp: 150, stages: 'auto', block: true, rubble: ['rock-small-a', 'rock-small-b'] }), // a statue stops walkers
  });

  // ================================================================================================================
  // NEW ENTRIES
  // ================================================================================================================
  // one-call declaration of a static model prop: primitive fallback (H.mk) + model build + destruction.
  //   cfg: { size, face, spacing, extra, prim(b, o, k, i), primAfter(i, o, k), models(P, o, k, i) -> pieces object, after(pieces, plan, o, i), destruct, phys (a loose body: mx.dynamic) }
  //   noDef: true = no catalogue entry, only the model spec under that name; returns the wrapped build for another entry to call
  function simple(name, desc, opts, aliases, cfg) {
    const prim = (i, o) => {
      const b = H.mk(), k = kk(o);
      cfg.prim(b, o, k, i);
      const m = b.build(); m.scale.setScalar(k); i.add(m);
      if (cfg.primAfter) cfg.primAfter(i, o, k);
    };
    if (!cfg.noDef) def(name, desc, opts, aliases, prim, { size: cfg.size ?? 1, face: cfg.face ?? 'player', spacing: cfg.spacing, ...cfg.extra });
    mx.model(name, {
      model(P, o, i) { return { i, ...cfg.models(P, o, kk(o), i) }; },
      after: cfg.after ? (pieces, plan, o) => cfg.after(pieces, plan, o, plan.i) : undefined,
      destruct: cfg.destruct,
      phys: cfg.phys,
    });
    return mx.wrap(name, prim);
  }
  const FLAME = [0xffd070, 0xffa030, 0xff7a1a];
  // flickering emissive flame cones (one small glow mesh, scaled in a ticker); pts = [[x, y, z], ...] in the instance frame, unscaled by k
  function flames(i, pts, k, r = 0.045, h = 0.13) {
    const b = H.mk(); b.mode('glow'); // ONE glow mesh for every flame: the flicker is a colour pulse + a small x/z wobble of the whole mesh
    for (const [x, y, z] of pts) { b.cone(x, y, z, r, h, pick(FLAME), 0, 5); b.sph(x, y + h * 0.35, z, r * 0.7, r * 0.9, r * 0.7, 0xfff0b0, 0, 5); }
    const g = b.build({ own: true }); g.scale.setScalar(k); i.add(g);
    const ph = rand(0, 6);
    i.tick((dt, t) => { if (i.broken) { g.visible = false; return true; } const s = 0.85 + Math.sin(t * 11 + ph) * 0.1 + Math.sin(t * 23 + ph * 2) * 0.07; g.material.color.setScalar(s); g.scale.set(k * (1.02 - (s - 0.85) * 0.2), k * (0.97 + (s - 0.85) * 0.5), k * (1.02 - (s - 0.85) * 0.2)); }, { every: 0.05 });
    return g;
  }

  simple('cart', 'wooden farm cart / wagon on big wheels with a spare wheel leaning beside it (option style high = high-sided wagon); breakable', 'style (high), scale', ['wagon', 'hand cart', 'handcart', 'farm cart', 'wooden cart', 'carts', 'wheel cart'], {
    size: 2.8, face: 'random',
    prim(b) {
      b.box(0, 0.75, 0, 1.5, 0.12, 2.4, WOOD); for (const s of [-1, 1]) { b.box(s * 0.72, 1.0, 0, 0.06, 0.45, 2.4, WOODD); b.cylc(s * 0.85, 0.5, 0.2, 0.5, 0.5, 0.1, WOODD, [0, 0, PI / 2], 12); b.cylc(s * 0.85, 0.5, 0.2, 0.1, 0.1, 0.14, IRON, [0, 0, PI / 2], 6); b.cyl(s * 0.45, 0.62, 1.1, 0.04, 0.04, 1.5, WOODD, [PI / 2.2, 0, 0], 5); }
      b.box(0, 1.0, -1.17, 1.5, 0.45, 0.06, WOODD); b.box(0, 1.0, 1.17, 1.5, 0.45, 0.06, WOODD);
    },
    models(P, o, k) { const hi = o.style === 'high'; return { p: P(hi ? 'cart-high' : 'cart', { height: (hi ? 1.9 : 1.4) * k, anchor: 'center' }), w: P('wheel', { x: 1.6 * k, z: -0.2 * k, height: 0.9 * k, anchor: 'center' }) }; },
    destruct: WOODW(45, { rubble: ['resource-planks'], block: true }),
  });
  simple('coffin', 'dark wooden coffin with a fixed lid (option style: closed (default) | open = skeleton inside | old | plain)', 'style, scale', ['coffins', 'casket', 'burial coffin', 'wooden coffin', 'sarcophagus'], {
    size: 1.4, face: 'random',
    prim(b) { b.box(0, 0.28, 0, 0.72, 0.5, 1.9, 0x3a2a22); b.box(0, 0.58, 0, 0.8, 0.1, 2.0, 0x4a3a30); b.box(0, 0.65, 0.3, 0.1, 0.02, 0.5, 0x6a5a48); b.box(0, 0.65, 0.4, 0.4, 0.02, 0.1, 0x6a5a48); },
    models(P, o, k) { const st = String(o.style ?? ''), m = { open: ['coffin-decorated', 0.7], old: ['coffin-old', 0.45], plain: ['graveyard-coffin', 0.6] }[st] ?? ['coffin', 0.85]; return { p: P(m[0], { height: m[1] * k, anchor: 'center' }) }; },
    destruct: WOODW(45),
  });
  simple('wheelbarrow', 'wooden wheelbarrow with a single iron-rimmed wheel; breakable', 'scale', ['wheel barrow', 'barrow', 'garden cart', 'wheelbarrows'], {
    size: 1.4, face: 'random',
    prim(b) { b.box(0, 0.5, -0.1, 0.7, 0.3, 0.9, WOOD); b.cylc(0, 0.28, 0.6, 0.28, 0.28, 0.08, IRON, [0, 0, PI / 2], 10); for (const s of [-1, 1]) { b.cyl(s * 0.3, 0.55, -0.3, 0.03, 0.03, 0.9, WOODD, [-PI / 2.6, 0, 0], 5); b.box(s * 0.3, 0.2, -0.45, 0.05, 0.4, 0.05, WOODD); } },
    models(P, o, k) { return { p: P('wheelbarrow', { height: 0.65 * k, anchor: 'center' }) }; },
    destruct: WOODW(16), phys: { shape: 'box', mass: 9, friction: 0.7 },
  });
  simple('ladder', 'tall wooden ladder leaning back against an imaginary wall (breakable); option scale', 'scale', ['wooden ladder', 'ladders', 'step ladder', 'climbing ladder'], {
    size: 1.2, face: 'player',
    prim(b) { b.push(0, 0, 0, 0, -0.22, 0); for (const s of [-1, 1]) b.box(s * 0.45, 1.6, 0, 0.08, 3.2, 0.08, WOODD); for (let q = 0; q < 8; q++) b.box(0, 0.3 + q * 0.4, 0, 0.9, 0.06, 0.06, WOOD); b.pop(); },
    models(P, o, k) { return { p: P('ladder', { height: 3.2 * k, anchor: 'center' }) }; },
    after(pieces, plan) { plan.p.obj.rotation.x = -0.22; },
    destruct(i, pieces, plan, o) { const k = kk(o); if (!plan) mx.breakable(i, pieces, { material: 'wood', hp: 14 }); else breakBox(i, box3(-0.65 * k, 0, -0.75 * k, 0.65 * k, 3.1 * k, 0.2 * k), pieces, { material: 'wood', hp: 14 }); },
  });
  simple('workbench', 'sturdy workshop bench with tools (option style: bench (default) | grind = grindstone bench | anvil = bench with a small anvil); breakable', 'style, scale', ['work bench', 'carpenter bench', 'crafting bench', 'grindstone', 'smith bench', 'workbenches', 'tool bench'], {
    size: 1.3, face: 'player',
    prim(b) { b.box(0, 0.8, 0, 1.0, 0.1, 0.8, 0x8a6a3e); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.42, 0.38, sz * 0.32, 0.1, 0.76, 0.1, 0x6a4a2a); b.box(0.3, 0.9, 0.1, 0.3, 0.1, 0.12, 0x6a707c); b.box(-0.25, 0.88, -0.1, 0.4, 0.06, 0.2, 0xb08a58); },
    models(P, o, k) { const nm = { grind: 'workbench-grind', anvil: 'workbench-anvil' }[String(o.style ?? '')] ?? 'workbench'; return { p: P(nm, { height: 1.0 * k, anchor: 'center' }) }; },
    destruct: WOODW(40, { block: true }),
  });
  simple('bedroll', 'rolled-out sleeping bedroll on the ground (option color tints the blanket); breakable cloth', 'color, scale', ['sleeping bag', 'camp bed', 'bedrolls', 'sleeping roll'], {
    size: 1.2, face: 'random',
    prim(b, o) { b.mode('cloth'); b.box(0, 0.07, 0, 0.8, 0.12, 1.8, o.color ?? 0xb04a3a); b.cylc(0, 0.12, -0.7, 0.14, 0.14, 0.7, 0xe8dcc0, [0, 0, PI / 2], 8); },
    models(P, o, k) { return { p: P('bedroll', { scale: k, anchor: 'center' }) }; },
    after(pieces, plan, o) { if (o.color !== undefined) plan.p.tint(o.color); },
    destruct: brk({ material: 'cloth', hp: 6 }),
  });
  simple('urn', 'ceramic urn / clay pot (option style: round | square | pot | jar; random by default): shatters into clay shards', 'style, scale', ['vase', 'urns', 'clay pot', 'jar', 'amphora', 'ceramic', 'vases', 'flower pot', 'clay jar'], {
    size: 0.6, face: 'random', spacing: 1.1,
    prim(b) { const c = pick([0xb4683a, 0x9a8a78, 0x7a8aa0]); b.cyl(0, 0, 0, 0.16, 0.2, 0.1, c, 0, 10); b.sph(0, 0.35, 0, 0.27, 0.3, 0.27, c, 0, 10); b.cyl(0, 0.6, 0, 0.14, 0.12, 0.14, c, 0, 10); b.tor(0, 0.74, 0, 0.14, 0.03, shade(c, 0.9), [PI / 2, 0, 0], 10); },
    models(P, o, k) { const st = String(o.style ?? pick(['round', 'square', 'pot', 'jar'])), m = { round: ['urn-round', 0.8], square: ['urn-square', 0.8], pot: ['pot-large', 0.5], jar: ['pot-small', 0.7] }[st] ?? ['urn-round', 0.8]; return { p: P(m[0], { height: m[1] * k, anchor: 'center' }) }; },
    destruct: brk({ material: 'earth', hp: 4 }), phys: { shape: 'cylinder', mass: 3, friction: 0.7, bounce: 0.1 },
  });
  simple('rowboat', 'small wooden rowboat (option style: row (default) | large | canoe) lying on the bank; breakable', 'style, scale', ['boat', 'row boat', 'dinghy', 'canoe', 'skiff', 'rowboats', 'small boat'], {
    size: 3, face: 'random',
    prim(b) { b.box(0, 0.2, 0, 1.1, 0.12, 2.6, 0x7a5230); for (const s of [-1, 1]) b.box(s * 0.55, 0.42, 0, 0.1, 0.38, 2.6, 0x8a6a3e, [0, 0, s * 0.18]); b.prism(0, 0.1, 1.6, 1.1, 0.5, 0.7, 0x8a6a3e, [0, PI, 0]); b.box(0, 0.38, 0.1, 1.0, 0.06, 0.18, 0x6a4a2a); b.cyl(0.9, 0.2, 0.3, 0.025, 0.025, 1.6, WOODD, [PI / 2, 0, 0.1], 5); },
    models(P, o, k) { const st = String(o.style ?? ''), nm = st === 'canoe' ? 'canoe' : st === 'large' ? 'boat-row-large' : 'boat-row-small'; return { p: P(nm, { scale: k, anchor: 'center' }) }; },
    destruct: WOODW(50, { rubble: ['resource-planks'], block: true }),
  });
  // signboard: a post with a board; option text is written on it
  function signText(i, o, k) {
    const l = i.label(String(o.text ?? 'Welcome'), { size: 0.075, color: 0x2a1a0a, background: false, position: { x: i.wx(0, 0.14 * k), y: i.y + 0.86 * k, z: i.wz(0, 0.14 * k) }, maxWidth: 360 });
    i.beh = { label: l };
  }
  simple('signboard', 'wooden signpost with a board; option text is written on it (default "Welcome"); breakable', 'text, scale', ['notice board', 'wooden sign', 'road sign', 'text sign', 'signboards'], {
    size: 0.9, face: 'player',
    prim(b) { b.box(0, 0.6, 0, 0.1, 1.2, 0.1, WOODD); b.box(0, 0.85, 0.07, 0.9, 0.5, 0.06, 0x8a6a3e); b.box(0, 0.85, 0.1, 0.84, 0.44, 0.02, 0xc8a870); },
    primAfter(i, o, k) { signText(i, o, k); },
    models(P, o, k) { return { p: P('sign', { height: 1.25 * k, anchor: 'center' }) }; },
    after(pieces, plan, o, i) { signText(i, o, kk(o)); },
    destruct: brk((i) => ({ material: 'wood', hp: 12, onBreak() { if (i.beh && i.beh.label) i.beh.label.show(false); } })),
  });
  simple('fire-basket', 'iron fire basket on three legs with a living flame, sparks and flicker light; breakable', 'color, scale', ['brazier', 'fire bowl', 'fire pit stand', 'iron brazier', 'braziers', 'fire baskets', 'flame bowl'], {
    size: 1.0, face: 'random', spacing: 3,
    prim(b) { for (let q = 0; q < 3; q++) { const a = q * 2.09; b.cyl(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25, 0.03, 0.025, 0.65, IRON, [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25], 5); } b.cyl(0, 0.62, 0, 0.42, 0.25, 0.3, 0x3a3e48, 0, 9); b.tor(0, 0.92, 0, 0.42, 0.04, IRON, [PI / 2, 0, 0], 12); b.mode('glow'); b.cylc(0, 0.9, 0, 0.35, 0.35, 0.04, 0x62ff9a, 0, 9); },
    primAfter(i, o, k) { torchFire(i, { ...o, color: o.color ?? 0x62ff9a }, k, 1.15, 1.0); },
    models(P, o, k) { return { p: P('fire-basket', { height: 0.5 * k, y: 0.6 * k, anchor: 'center' }) }; },
    after(pieces, plan, o, i) {
      const k = kk(o), b = H.mk();
      for (let q = 0; q < 3; q++) { const a = q * 2.09 + 0.5; b.cyl(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0.035, 0.03, 0.66, IRON, [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25], 5); }
      plan.legs = b.build(); plan.legs.scale.setScalar(k); i.add(plan.legs);
      torchFire(i, { ...o, color: o.color ?? 0x62ff9a }, k, 1.15, 1.0); // the graveyard basket burns green
    },
    destruct(i, pieces, plan, o) { const k = kk(o); if (!plan) mx.breakable(i, pieces, { material: 'metal', hp: 40 }); else breakBox(i, box3(-0.55 * k, 0, -0.55 * k, 0.55 * k, 1.1 * k, 0.55 * k), [pieces[0], plan.legs], { material: 'metal', hp: 40 }); },
  });
  // crate-stack: a pyramid of REAL crates (option height = rows, 2-5, default 3; trimmed to the body budget: perf.allow). Without physics, without room for at least a
  // 2-row pyramid, or with style boxes it is the old single breakable model pile (stackStatic).
  const stackStatic = simple('crate-stack:static', '', '', [], {
    noDef: true,
    prim(b) { b.box(0, 0.4, 0, 0.8, 0.8, 0.8, 0x96734a); b.box(0.85, 0.4, 0.1, 0.8, 0.8, 0.8, 0x8a6a42, [0, 0.2, 0]); b.box(0.3, 1.2, 0.05, 0.8, 0.8, 0.8, 0x96734a, [0, -0.25, 0]); b.cylc(-0.8, 0.45, 0.3, 0.38, 0.38, 0.9, 0x7a5230, 0, 9); },
    models(P, o, k) { const bx = o.style === 'boxes'; return { p: P(bx ? 'box-stacked' : 'crates-stacked', { height: (bx ? 2.6 : 1.7) * k, anchor: 'center' }) }; },
    destruct: WOODW(38, { rubble: ['resource-planks'], block: true }),
  });
  def('crate-stack', 'pile of wooden crates (option height = rows of the pyramid, default 3; style boxes = a static pile of boxes with barrels and bottles); every crate is a real body that topples when hit', 'height, style, scale', ['crate pile', 'stacked crates', 'box stack', 'cargo stack', 'boxes', 'supplies', 'pile of crates'], (i, o) => {
    const lay = o.style !== 'boxes' && mx.physics() ? crateLayout(i, o, true) : null;
    if (lay) crateEntry(i, { ...o, layout: lay }); else stackStatic(i, o);
  }, { size: 1.8, face: 'random' });
  simple('weapon-stand', 'wooden weapon rack holding a sword, an axe and a greatsword; breakable', 'scale', ['weapons rack', 'weapon stands', 'arms rack', 'sword stand'], {
    size: 1.4, face: 'player',
    prim(b) { for (const s of [-1, 1]) b.box(s * 0.55, 0.65, 0, 0.1, 1.3, 0.12, WOODD); b.box(0, 0.95, 0, 1.2, 0.1, 0.12, WOOD); b.box(0, 0.45, 0, 1.2, 0.08, 0.12, WOOD); b.box(0, 0.05, 0, 1.3, 0.1, 0.5, WOODD); for (const [x, c] of [[-0.3, 0xa8b0bc], [0, 0xc8ccd4], [0.3, 0x8a8e98]]) { b.box(x, 0.9, 0.0, 0.07, 1.1, 0.03, c, [0, 0, x * 0.2]); b.box(x, 0.38, 0.0, 0.18, 0.04, 0.05, 0x6a4a2a, [0, 0, x * 0.2]); } },
    models(P, o, k) {
      return { p: P('weaponrack', { height: 1.35 * k, anchor: 'center' }), w: [P('sword', { x: -0.28 * k, z: 0.02 * k, y: 0.08 * k, height: 1.1 * k, anchor: 'center' }), P('great-axe', { x: 0.02 * k, z: 0.0, y: 0.08 * k, height: 1.1 * k, anchor: 'center' }), P('greatsword', { x: 0.3 * k, z: 0.02 * k, y: 0.08 * k, height: 1.3 * k, anchor: 'center' })] };
    },
    after(pieces, plan) { plan.w[0].obj.rotation.z = -0.16; plan.w[1].obj.rotation.z = 0.02; plan.w[2].obj.rotation.z = 0.16; },
    destruct: WOODW(26),
  });

  // ---- banners, flags, candles
  const BANNER_NAMES = ['red', 'blue', 'green', 'white', 'yellow'], BANNER_HEX = { red: 0xb02a2a, blue: 0x2a5ac0, green: 0x2a8a4a, white: 0xe8e4d8, yellow: 0xe0b82a };
  const bannerCol = (o) => (BANNER_NAMES.includes(String(o.color)) ? String(o.color) : o.color !== undefined && Number.isFinite(+o.color) && +o.color < 5 ? BANNER_NAMES[+o.color | 0] : pick(BANNER_NAMES));
  const swayTick = (i, pv, amp = 0.05) => { const ph = rand(0, 6); i.tick((dt, t) => { if (i.broken) return true; const w = 0.4 + (H.ctx.world.env?.wind ?? 0.5); pv.rotation.x = Math.sin(t * 1.1 + ph) * amp * w; pv.rotation.z = Math.sin(t * 0.8 + ph * 2) * amp * 0.6 * w; }, { every: 0.04 }); };
  def('banner', 'tall cloth banner hanging from a wooden crossbar and pole, swaying in the wind; option color: red | blue | green | white | yellow, style: plain | shield | thin | triple; breakable', 'color, style, scale', ['hanging banner', 'war banner', 'cloth banner', 'heraldic banner', 'banners', 'tapestry banner', 'standard banner'], (i, o) => {
    const k = kk(o), col = bannerCol(o), b = H.mk();
    bannerPole(b);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const cb = H.mk(); cb.mode('cloth'); cb.box(0, -1.1, 0, 1.15, 2.2, 0.04, BANNER_HEX[col]); cb.box(0, -0.18, 0.03, 1.15, 0.3, 0.03, shade(BANNER_HEX[col], 0.7)); cb.cone(0, -2.2, 0, 0.58, 0.45, BANNER_HEX[col], [PI, 0, 0], 4); cb.box(0, -1.2, 0.03, 0.4, 0.5, 0.02, 0xe8c860);
    const pv = new THREE.Group(); pv.position.set(0, 2.95 * k, 0.1 * k); pv.scale.setScalar(k); pv.add(cb.build({ own: true })); i.add(pv);
    swayTick(i, pv);
  }, { size: 1.6, face: 'player' });
  function bannerPole(b) { for (const s of [-1, 1]) b.box(s * 0.7, 1.5, 0, 0.1, 3.0, 0.1, WOODD); b.box(0, 2.98, 0, 1.6, 0.1, 0.1, WOOD); for (const s of [-1, 1]) b.sph(s * 0.8, 3.02, 0, 0.07, 0.07, 0.07, 0xd9a93c, 0, 5); }
  mx.model('banner', {
    model(P, o, i) {
      const k = kk(o), col = bannerCol(o), st = String(o.style ?? ''), two = col === 'blue' ? 'blue' : 'red';
      const nm = st === 'shield' ? 'banner-shield-' + two : st === 'thin' ? 'banner-thin-' + two : st === 'triple' ? 'banner-triple-' + two : 'banner-' + col;
      return { i, k, p: P(nm, { height: 2.4 * k, anchor: 'center' }) };
    },
    after(pieces, plan) {
      const { i, k, p } = plan, b = H.mk(), W = Math.max(1.5, p.size.x / k + 0.4);
      for (const s of [-1, 1]) b.box(s * W / 2, 1.5, 0, 0.1, 3.0, 0.1, WOODD); b.box(0, 2.98, 0, W + 0.1, 0.1, 0.1, WOOD); for (const s of [-1, 1]) b.sph(s * W / 2, 3.02, 0, 0.07, 0.07, 0.07, 0xd9a93c, 0, 5);
      plan.pole = b.build(); plan.pole.scale.setScalar(k); i.add(plan.pole);
      const pv = new THREE.Group(); pv.position.set(0, 2.95 * k, 0.1 * k); i.add(pv); pv.add(p.obj); p.obj.position.y = -p.size.y; // hang from the crossbar: sway about the top edge
      plan.pv = pv; swayTick(i, pv);
    },
    destruct(i, pieces, plan, o) { const k = kk(o); if (!plan) mx.breakable(i, pieces, { material: 'wood', hp: 14, collide: false }); else breakBox(i, box3(-0.95 * k, 0, -0.25 * k, 0.95 * k, 3.1 * k, 0.3 * k), [pieces[0], plan.pole], { material: 'wood', hp: 14, collide: false, colors: pieces[0].palette() }); },
  });
  const FLAGS = { red: ['flag-red', 1.8], blue: ['flag-blue', 1.8], green: ['flag-green', 1.8], yellow: ['flag-yellow', 1.8], pirate: ['flag-pirate', 2.6], pennant: ['flag-pennant', 3.4] }; // model, height (m)
  def('flag', 'tall flagpole with a team flag fluttering at the top (option color: red | blue | green | yellow | pirate | pennant); breakable', 'color, scale', ['banner-pole', 'flagpole', 'flag pole', 'standard', 'pennant', 'flags', 'banner pole'], (i, o) => {
    const k = kk(o), c = { red: 0xc83a3a, blue: 0x3a5ac8, green: 0x3a9a50, yellow: 0xe0b82a, pirate: 0x1a1a22, pennant: 0x3a5ac8 }[String(o.color)] ?? pick([0xc83a3a, 0x3a5ac8, 0x3a9a50, 0xe0b82a]), b = H.mk();
    b.cyl(0, 0, 0, 0.04, 0.06, 3.4, WOODD, 0, 6); b.sph(0, 3.45, 0, 0.07, 0.07, 0.07, 0xd9a93c, 0, 5);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const cb = H.mk(); cb.mode('cloth'); cb.box(0.5, -0.3, 0, 1.0, 0.6, 0.03, c); cb.cone(1.05, -0.3, 0, 0.3, 0.2, c, [0, 0, -PI / 2], 3);
    const pv = new THREE.Group(); pv.position.set(0, 3.35 * k, 0); pv.scale.setScalar(k); pv.add(cb.build({ own: true })); i.add(pv);
    const ph = rand(0, 6); i.tick((dt, t) => { if (i.broken) return true; pv.rotation.y = Math.sin(t * 2.2 + ph) * 0.2; pv.rotation.z = Math.sin(t * 3.1 + ph) * 0.05; }, { every: 0.04 });
  }, { size: 0.8, face: 'random', spacing: 3 });
  mx.model('flag', {
    model(P, o, i) { const f = FLAGS[String(o.color)] ?? FLAGS[pick(['red', 'blue', 'green', 'yellow'])]; return { i, k: kk(o), h: f[1], p: P(f[0], { height: f[1] * kk(o) }) }; },
    after(pieces, plan) { const { i, p } = plan, ph = rand(0, 6); i.tick((dt, t) => { if (i.broken) return true; p.obj.rotation.y = Math.sin(t * 1.7 + ph) * 0.14; p.obj.rotation.z = Math.sin(t * 1.1 + ph) * 0.015; }, { every: 0.04 }); },
    destruct(i, pieces, plan, o) { const k = kk(o); if (!plan) mx.breakable(i, pieces, { material: 'wood', hp: 14, collide: false }); else breakBox(i, box3(-0.5 * k, 0, -0.9 * k, 0.5 * k, plan.h * k, 0.5 * k), pieces, { material: 'wood', hp: 14, collide: false }); },
  });
  // candles: warm emissive flames that flicker (no extra light source)
  def('candelabra', 'tall iron candelabra with five lit candles: soft emissive flames that flicker (no light source, wax and iron); breakable', 'scale', ['candle stand', 'candelabrum', 'candle holder', 'candlestick', 'candelabras', 'standing candles'], (i, o) => {
    const k = kk(o), b = H.mk();
    b.cyl(0, 0, 0, 0.3, 0.34, 0.08, IRON, 0, 8); b.cyl(0, 0.05, 0, 0.05, 0.08, 1.15, 0x3a3e48, 0, 7); b.sph(0, 0.55, 0, 0.09, 0.07, 0.09, 0x4a4e58, 0, 6); b.sph(0, 1.0, 0, 0.1, 0.07, 0.1, 0x4a4e58, 0, 6);
    const tips = [[0, 1.5, 0]];
    b.cyl(0, 1.15, 0, 0.04, 0.05, 0.25, 0x3a3e48, 0, 6); b.cyl(0, 1.38, 0, 0.065, 0.05, 0.05, 0x4a4e58, 0, 6); b.cyl(0, 1.43, 0, 0.045, 0.045, 0.2, 0xeee6d0, 0, 7);
    for (let q = 0; q < 4; q++) {
      const a = q * PI / 2 + 0.4, x = Math.cos(a) * 0.36, z = Math.sin(a) * 0.36;
      b.tor(Math.cos(a) * 0.18, 1.12, Math.sin(a) * 0.18, 0.18, 0.025, 0x3a3e48, [PI / 2 + Math.sin(a) * 0.0, 0, 0], 8);
      b.cyl(x, 1.1, z, 0.03, 0.035, 0.16, 0x3a3e48, 0, 5); b.cyl(x, 1.25, z, 0.055, 0.04, 0.04, 0x4a4e58, 0, 6); b.cyl(x, 1.29, z, 0.04, 0.04, 0.2 + (q % 2) * 0.05, 0xeee6d0, 0, 7);
      tips.push([x, 1.49 + (q % 2) * 0.05, z]);
    }
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    flames(i, tips, k);
  }, { size: 0.7, spacing: 2, face: 'random' });
  mx.model('candelabra', { destruct: brk({ material: 'metal', hp: 22 }) });
  def('candle-cluster', 'a little cluster of melted candles, a skull-candle and a triple candle with soft flickering emissive flames (no light source); breakable', 'scale', ['candles', 'candle group', 'burning candles', 'ritual candles', 'candle pile', 'votive candles'], (i, o) => {
    const k = kk(o), b = H.mk(), tips = [];
    for (let q = 0; q < 6; q++) { const a = rand(0, TAU), r = rand(0.05, 0.3), h = rand(0.12, 0.3), x = Math.cos(a) * r, z = Math.sin(a) * r; b.cyl(x, 0, z, 0.035, 0.04, h, 0xeee6d0, 0, 7); tips.push([x, h + 0.01, z]); }
    b.cyl(0, 0, 0, 0.32, 0.34, 0.02, 0xd8cdb0, 0, 9);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    flames(i, tips, k, 0.025, 0.07);
  }, { size: 0.5, spacing: 1.2, face: 'random' });
  mx.model('candle-cluster', {
    model(P, o, i) {
      const k = kk(o);
      return { i, k, ps: [P('skull-candle', { x: -0.05 * k, z: 0.0, height: 0.4 * k, anchor: 'center' }), P('candle-melted', { x: 0.3 * k, z: 0.12 * k, height: 0.3 * k, anchor: 'center' }), P('halloween-candle-triple', { x: -0.3 * k, z: 0.2 * k, height: 0.34 * k, anchor: 'center' }), P('candle', { x: 0.12 * k, z: -0.28 * k, height: 0.26 * k, anchor: 'center' })] };
    },
    after(pieces, plan) { const { i, k, ps } = plan; flames(i, ps.map((p) => [p.x / k, p.size.y / k + 0.01, p.z / k]), k, 0.03, 0.08); },
    destruct: brk({ material: 'stone', hp: 8, colors: [{ hex: 0xe8dcc0, w: 0.7 }, { hex: 0xc8b898, w: 0.3 }] }),
  });

  // ---- composed entries
  def('tavern-table-set', 'a tavern table with plate, mug and candle, surrounded by chairs (option seats 2-6, default 4); every piece breaks on its own', 'seats, scale', ['tavern table', 'table and chairs', 'dining set', 'table set', 'tavern set', 'inn table', 'table with chairs'], (i, o) => {
    const k = kk(o), n = clamp(Math.floor(o.seats ?? 4), 2, 6);
    i.sub('table', { lx: 0, lz: 0, yaw: 0, scale: k });
    for (let q = 0; q < n; q++) { const a = (q / n) * TAU + 0.5, x = Math.sin(a) * 1.15 * k, z = Math.cos(a) * 1.15 * k; i.sub('chair', { lx: x, lz: z, yaw: Math.atan2(-x, -z) + rand(-0.15, 0.15), scale: k }); }
  }, { size: 3, face: 'player', spacing: 4.5 });
  def('bookshelf', 'tall wooden bookshelf with four shelves of colourful books (the books are one instanced draw); breakable', 'scale', ['book shelf', 'bookcase', 'library shelf', 'shelves', 'book case', 'bookshelves', 'library'], (i, o) => {
    const k = kk(o), W = 1.7, Hh = 2.0, D = 0.4, b = H.mk();
    for (const s of [-1, 1]) b.box(s * (W / 2 - 0.04), Hh / 2, 0, 0.08, Hh, D, WOODD);
    b.box(0, Hh / 2, -D / 2 + 0.02, W, Hh, 0.04, 0x5a3a22); b.box(0, Hh - 0.02, 0, W, 0.06, D + 0.04, WOOD);
    for (let r = 0; r < 4; r++) b.box(0, 0.03 + r * 0.5, 0, W, 0.05, D, WOOD);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const specs = [], prim = [];
    for (let r = 0; r < 4; r++) for (const x of [-0.55 + rand(-0.05, 0.05), 0.05 + rand(-0.05, 0.05), 0.6 + rand(-0.04, 0.04)]) if (Math.random() < 0.85) { specs.push({ name: Math.random() < 0.7 ? 'book-set' : 'book-single', x: x * k, z: 0.0, y: (0.055 + r * 0.5) * k, yaw: 0, scale: k * rand(0.85, 1.05) }); prim.push([x, 0.055 + r * 0.5]); }
    const bm = H.mk(); // primitive books (used when the book models are missing)
    const primBooks = () => { for (const [x, y] of prim) for (let q = 0; q < 5; q++) bm.box(x - 0.2 + q * 0.09, y + 0.17, 0, 0.07, 0.3 + rand(0, 0.08), 0.22, pick([0xa83a3a, 0x3a5aa8, 0x3a8a5a, 0xc8a03a, 0x8a5aa8])); const m2 = bm.build(); m2.scale.setScalar(k); i.add(m2); return m2; };
    const sc = mx.scatter(i, specs, {});
    const items = [m];
    if (sc) { items.push(...sc.items); Promise.all(sc.sets.map((s) => s.ready)).then(() => { if (sc.failed && !i.removed) { sc.remove(); items.push(primBooks()); } }); } else items.push(primBooks());
    breakBox(i, box3(-W / 2 * k, 0, -D / 2 * k, W / 2 * k, Hh * k, D / 2 * k), items, { material: 'wood', hp: 32, block: true, colors: [{ hex: 0x7a5230, w: 0.5 }, { hex: 0x5a3a22, w: 0.3 }, { hex: 0xa83a3a, w: 0.1 }, { hex: 0x3a5aa8, w: 0.1 }], onBreak() { if (sc) sc.remove(); } });
  }, { size: 1.8, face: 'player', spacing: 2.2 });
  // the gold chest: same behaviour as the chest (opens within 3 m, optional loot); gold bands, gold trim
  def('treasure-chest-gold', 'ornate gold-trimmed treasure chest; lid swings open with a gold sparkle when you step within 3 m (loot: a weapon name or true); breakable', 'loot, scale', ['gold chest', 'golden chest', 'royal chest', 'ornate chest', 'treasure chest gold', 'gold treasure chest', 'chest of gold'], (i, o) => {
    const c = H.makeChest({ wood: 0x6a3a1e, band: 0xd9a93c, lock: 0xf4d070 }), k = kk(o);
    c.group.scale.setScalar(k);
    const cb = H.mk();
    for (let q = 0; q < 40; q++) cb.box(rand(-0.34, 0.34), 0.42 + rand(0, 0.07), rand(-0.18, 0.18), rand(0.06, 0.1), 0.03, rand(0.06, 0.1), pick([0xe8b83a, 0xd9a93c, 0xf4d070, 0xffe27a]), [0, rand(0, 3), rand(-0.3, 0.3)]);
    cb.mode('glow'); for (let q = 0; q < 6; q++) cb.oct(rand(-0.3, 0.3), 0.49, rand(-0.15, 0.15), 0.05, 0.06, 0.05, pick([0xff4a6a, 0x4ac8ff, 0x6aff8a, 0xc87aff]));
    c.group.add(cb.build());
    i.add(c.group);
    chestBehave(i, o, { setOpen: c.setOpen, top: 0.55 * k, hw: 0.3 * k, hd: 0.2 * k });
  }, { size: 0.8 });
  mx.model('treasure-chest-gold', chestModel(true));

  // ---- instanced runs (mx.scatter: 1-3 draw calls however many items); item positions are instance-local metres
  // per-item breakables when `bo` is given (gravestones, pumpkins, sacks ...); prim() builds the primitive stand-in when models are missing / fail
  function scatterProp(i, o, specs, bo, prim) {
    const fall = () => { const m = prim(); if (m && bo) mx.breakable(i, [m], { material: bo.material, hp: bo.hp }); };
    const sc = mx.scatter(i, specs, bo ? { breakable: bo } : {});
    if (!sc) { fall(); return null; }
    Promise.all(sc.sets.map((s) => s.ready)).then(() => { if (sc.failed && !i.removed) { sc.remove(); fall(); } });
    return sc;
  }
  const HAY = [{ hex: 0xd8b45a, w: 0.6 }, { hex: 0xb8923e, w: 0.4 }];
  const pyramid = (n, dx, dy) => { const out = []; let lvl = 0, left = n; const base = Math.max(1, Math.ceil(Math.sqrt(n))); while (left > 0) { const cnt = Math.max(1, Math.min(left, base - lvl)); for (let c = 0; c < cnt; c++) out.push([(c - (cnt - 1) / 2) * dx, lvl * dy]); left -= cnt; lvl++; } return out; };
  def('haystack', 'golden hay bale (option count stacks several into a pyramid); breakable: bursts into straw', 'count, scale', ['hay bale', 'hay-bale', 'hay', 'straw bale', 'hay stack', 'haybale', 'straw'], (i, o) => {
    const k = kk(o), n = clamp(Math.floor(o.count ?? 1), 1, 15), specs = [];
    pyramid(n, 1.45, 0.75).forEach(([x, y]) => specs.push({ name: 'hay-bale', x: x * k, z: rand(-0.08, 0.08) * k, y: y * k, yaw: rand(-0.12, 0.12) + (Math.random() < 0.2 ? PI : 0), scale: k }));
    scatterProp(i, o, specs, { material: 'cloth', hp: 8, colors: HAY }, () => { const b = H.mk(); for (const s of specs) b.cylc(s.x, s.y + 0.4 * k, s.z, 0.4 * k, 0.4 * k, 1.3 * k, 0xd8b45a, [0, 0, PI / 2], 9); return i.add(b.build()); });
  }, { ownCount: true, size: 1.6, face: 'random' });
  const STONES = { round: 'gravestone-round', cross: 'gravestone-cross', wide: 'gravestone-wide', skull: 'gravestone', roof: 'gravestone-roof', broken: 'gravestone-broken', 'cross-large': 'gravestone-cross-large', marker: 'gravemarker-a', plain: 'gravemarker-b' };
  const stoneName = (o) => STONES[String(o.style)] ?? STONES[pick(['round', 'cross', 'wide', 'skull', 'roof', 'marker', 'round', 'cross'])];
  const primStones = (i, specs, k) => () => { const b = H.mk(); for (const s of specs) { b.box(s.x, 0.45 * k, s.z, 0.7 * k, 0.9 * k, 0.18 * k, 0x8a8a90, s.yaw); b.sph(s.x, 0.9 * k, s.z, 0.35 * k, 0.2 * k, 0.09 * k, 0x8a8a90, s.yaw, 6); b.box(s.x, 0.04 * k, s.z + 0.05 * k, 0.9 * k, 0.08 * k, 0.5 * k, 0x6e6e74, s.yaw); } return i.add(b.build()); };
  def('gravestone', 'weathered stone grave marker (option style: round | cross | wide | skull | roof | broken | cross-large | marker, random by default; count makes a loose graveyard patch, one instanced draw); tough stone, breakable', 'style, count, spread, scale', ['tombstone', 'headstone', 'grave marker', 'gravestones', 'grave', 'grave stone', 'grave patch'], (i, o) => {
    const k = kk(o), n = clamp(Math.floor(o.count ?? 1), 1, 40), cols = Math.max(1, Math.ceil(Math.sqrt(n))), sp = (o.spread ?? 0) ? o.spread / Math.max(1, cols - 1) : 2.2 * k, specs = [];
    for (let q = 0; q < n; q++) { const c = q % cols, r = (q / cols) | 0; specs.push({ name: n > 1 || !o.style ? stoneName(o) : stoneName(o), x: (n === 1 ? 0 : (c - (cols - 1) / 2) * sp + rand(-0.3, 0.3)), z: (n === 1 ? 0 : (r - (Math.ceil(n / cols) - 1) / 2) * sp * 1.1 + rand(-0.3, 0.3)), yaw: rand(-0.12, 0.12), scale: k }); }
    scatterProp(i, o, specs, { material: 'stone', hp: 40, colors: [{ hex: 0x8a8a92, w: 0.6 }, { hex: 0x6e6e78, w: 0.4 }] }, primStones(i, specs, k));
  }, { ownCount: true, size: 1.2, face: 'player', spacing: 2.5 });
  def('tombstone-row', 'a straight row of weathered gravestones of mixed styles (option length in metres, default 10); each stone breaks on its own', 'length, style, scale', ['grave row', 'row of graves', 'graveyard row', 'gravestone row', 'headstone row', 'tombstones row'], (i, o) => {
    const k = kk(o), L = clamp(o.length ?? 10, 2, 40), n = Math.max(2, Math.round(L / (1.9 * k)) + 1), specs = [];
    for (let q = 0; q < n; q++) specs.push({ name: stoneName(o), x: (q - (n - 1) / 2) * (L / (n - 1)), z: rand(-0.12, 0.12), yaw: rand(-0.07, 0.07), scale: k });
    scatterProp(i, o, specs, { material: 'stone', hp: 40, colors: [{ hex: 0x8a8a92, w: 0.6 }, { hex: 0x6e6e78, w: 0.4 }] }, primStones(i, specs, k));
  }, { ownCount: true, size: 2, face: 'player', spacing: 3 });
  const BONE = [{ hex: 0xe8e0cc, w: 0.7 }, { hex: 0xc8bfa8, w: 0.3 }];
  // whole-pile scatter: one breakable over the pile; prim() = primitive pile
  function pileProp(i, o, specs, box, cfg, prim) {
    const sc = mx.scatter(i, specs, {});
    if (!sc) { const m = prim(); mx.breakable(i, [m], cfg); return; }
    breakBox(i, box, sc.items, cfg);
    Promise.all(sc.sets.map((s) => s.ready)).then(() => { if (sc.failed && !i.removed) { sc.remove(); const m = prim(); mx.breakable(i, [m], cfg); } });
  }
  def('skull-pile', 'a heap of grinning skulls, bones and a ribcage (breakable bone pile: skulls and bones are instanced)', 'scale', ['skulls', 'skull heap', 'pile of skulls', 'bone heap', 'ossuary', 'skull mound', 'bones and skulls'], (i, o) => {
    const k = kk(o), specs = [], add = (name, x, z, y, yaw, s) => specs.push({ name, x: x * k, z: z * k, y: y * k, yaw, scale: s * k });
    for (let q = 0; q < 5; q++) { const a = q * 1.256 + rand(-0.2, 0.2); add('skull', Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0, a + 1.57 + rand(-0.4, 0.4), 0.55); }
    for (let q = 0; q < 2; q++) { const a = q * 3.1 + 0.7; add('skull', Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.3, a + 1.57, 0.55); }
    add('ribcage', -0.75, 0.25, 0, 0.6, 0.8); for (let q = 0; q < 6; q++) { const a = rand(0, TAU), r = rand(0.65, 0.95); add(pick(['bone-a', 'bone-b', 'bone-c']), Math.cos(a) * r, Math.sin(a) * r, 0, rand(0, TAU), 0.9); }
    pileProp(i, o, specs, box3(-1.0 * k, 0, -1.0 * k, 1.0 * k, 0.7 * k, 1.0 * k), { material: 'stone', hp: 12, colors: BONE }, () => {
      const b = H.mk(); for (const s of specs.slice(0, 7)) b.sph(s.x, s.y + 0.15 * k, s.z, 0.17 * k, 0.15 * k, 0.17 * k, 0xe8e0cc, 0, 7);
      for (const s of specs.slice(8)) b.cyl(s.x, 0.05 * k, s.z, 0.03 * k, 0.03 * k, 0.5 * k, 0xe0d8c0, [PI / 2, s.yaw, 0], 5); return i.add(b.build());
    });
  }, { size: 1.4, face: 'random', spacing: 2 });
  def('bone-pile', 'scattered bones and a ribcage lying on the ground, flat and wide (breakable)', 'scale', ['scattered bones', 'bone scatter', 'skeleton remains', 'ribcage', 'bone heap flat'], (i, o) => {
    const k = kk(o), specs = [], add = (name, x, z, yaw, s) => specs.push({ name, x: x * k, z: z * k, yaw, scale: s * k });
    add('ribcage', 0.0, 0.0, rand(0, TAU), 0.9); for (let q = 0; q < 9; q++) { const a = rand(0, TAU), r = rand(0.35, 1.1); add(pick(['bone-a', 'bone-b', 'bone-c']), Math.cos(a) * r, Math.sin(a) * r, rand(0, TAU), rand(0.8, 1.1)); }
    pileProp(i, o, specs, box3(-1.2 * k, 0, -1.2 * k, 1.2 * k, 0.5 * k, 1.2 * k), { material: 'stone', hp: 8, colors: BONE }, () => {
      const b = H.mk(); for (const s of specs.slice(1)) b.cyl(s.x, 0.04 * k, s.z, 0.03 * k, 0.03 * k, 0.5 * k, 0xe0d8c0, [PI / 2, s.yaw, 0], 5); b.sph(0, 0.2 * k, 0, 0.3 * k, 0.2 * k, 0.25 * k, 0xe8e0cc, 0, 7); return i.add(b.build());
    });
  }, { size: 1.4, face: 'random', spacing: 2 });
  const PUMP = { orange: ['pumpkin-orange', 'pumpkin-orange-small', 'pumpkin', 'pumpkin-tall'], yellow: ['pumpkin-yellow', 'pumpkin-yellow-small'], carved: ['pumpkin-carved', 'pumpkin-tall-carved'] };
  const ORANGE = [{ hex: 0xe0701c, w: 0.6 }, { hex: 0xb85412, w: 0.3 }, { hex: 0x4a7a2a, w: 0.1 }];
  def('pumpkin', 'a pumpkin patch (option count, default 5; style: orange (default) | yellow | carved = glowing carved faces): fat squashes that burst into orange chunks when hit', 'count, style, scale', ['gourd', 'squash', 'halloween pumpkin', 'pumpkin group'], (i, o) => {
    const k = kk(o), n = clamp(Math.floor(o.count ?? 5), 1, 40), names = PUMP[String(o.style)] ?? PUMP.orange, specs = [], spread = o.spread ?? Math.sqrt(n) * 1.1 * k;
    for (let q = 0; q < n; q++) { const a = q * 2.4, r = n === 1 ? 0 : Math.sqrt((q + 0.5) / n) * spread; specs.push({ name: pick(names), x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: rand(0, TAU), scale: k * rand(0.55, 0.85) }); }
    scatterProp(i, o, specs, { material: 'earth', hp: 5, colors: ORANGE }, () => { const b = H.mk(); for (const s of specs) { b.sph(s.x, 0.25 * k, s.z, 0.32 * k, 0.24 * k, 0.32 * k, 0xe0701c, 0, 8); b.cyl(s.x, 0.46 * k, s.z, 0.03, 0.04, 0.08, 0x4a7a2a, 0, 5); } return i.add(b.build()); });
  }, { ownCount: true, size: 1.4, face: 'random', spacing: 2 });
  def('pumpkin-row', 'a straight row of carved glowing pumpkins along a path (option length in metres, default 8)', 'length, scale', ['pumpkin lantern row', 'jack-o-lantern row', 'halloween path', 'pumpkin path', 'row of pumpkins', 'pumpkin line'], (i, o) => {
    const k = kk(o), L = clamp(o.length ?? 8, 2, 40), n = Math.max(2, Math.round(L / (1.2 * k)) + 1), specs = [];
    for (let q = 0; q < n; q++) specs.push({ name: q % 3 === 1 ? 'pumpkin-tall-carved' : 'pumpkin-carved', x: (q - (n - 1) / 2) * (L / (n - 1)), z: rand(-0.06, 0.06), yaw: rand(-0.2, 0.2), scale: k * rand(0.6, 0.75) });
    scatterProp(i, o, specs, { material: 'earth', hp: 5, colors: ORANGE }, () => { const b = H.mk(); for (const s of specs) { b.sph(s.x, 0.25 * k, s.z, 0.3 * k, 0.24 * k, 0.3 * k, 0xe0701c, 0, 8); b.mode('glow'); b.box(s.x, 0.3 * k, s.z + 0.28 * k, 0.2 * k, 0.1 * k, 0.03, 0xffd070); b.mode('solid'); } return i.add(b.build()); });
  }, { ownCount: true, size: 2, face: 'player', spacing: 3 });
  def('jack-o-lantern', 'a big carved jack-o-lantern with a glowing grin and a flickering candle glow (option style orange = the dark-carved orange one; count 1-3 get a light each); breakable', 'style, scale', ['jack o lantern', 'carved pumpkin', 'jackolantern', 'halloween lantern', 'lit pumpkin', 'jack-o-lanterns'], (i, o) => {
    const k = kk(o), b = H.mk();
    b.sph(0, 0.45 * k, 0, 0.55 * k, 0.42 * k, 0.55 * k, 0xe0701c, 0, 9); b.cyl(0, 0.84 * k, 0, 0.05 * k, 0.07 * k, 0.16 * k, 0x4a7a2a, 0, 5);
    b.mode('glow'); for (const s of [-1, 1]) b.cone(s * 0.2 * k, 0.5 * k, 0.5 * k, 0.07 * k, 0.12 * k, 0xffd070, [PI / 2, 0, 0], 3); b.box(0, 0.28 * k, 0.5 * k, 0.4 * k, 0.07 * k, 0.04, 0xffd070);
    const m = b.build(); i.add(m);
    jackGlow(i, o, k);
  }, { size: 0.9, face: 'player', spacing: 2 });
  function jackGlow(i, o, k) {
    if ((o.count ?? 1) > 3) return;
    const L = i.light({ color: 0xffa030, intensity: 5, distance: 6, flicker: 0.45, position: { x: i.x, y: i.y + 0.45 * k, z: i.z } });
    if (L) i.tick(() => { if (i.broken) { L.enabled = false; return true; } }, { every: 0.2 });
  }
  mx.model('jack-o-lantern', {
    model(P, o, i) { const k = kk(o), orange = o.style === 'orange'; return { i, k, p: P(orange ? 'pumpkin-orange-jackolantern' : 'pumpkin-carved', { height: (orange ? 0.9 : 0.9) * k, anchor: 'center' }) }; },
    after(pieces, plan, o) { jackGlow(plan.i, o, plan.k); },
    destruct: brk({ material: 'earth', hp: 6, colors: ORANGE }),
  });
  def('sack-pile', 'a heap of burlap grain sacks stacked in a little pyramid; breakable cloth', 'scale', ['sacks', 'grain sacks', 'sack stack', 'flour sacks', 'pile of sacks', 'burlap sacks', 'sack heap'], (i, o) => {
    const k = kk(o), specs = [];
    pyramid(7, 0.62, 0.32).forEach(([x, y]) => specs.push({ name: 'sack', x: x * k, z: rand(-0.1, 0.1) * k, y: y * k, yaw: rand(-0.35, 0.35) + (Math.random() < 0.3 ? PI : 0), scale: k * rand(0.9, 1.05) }));
    scatterProp(i, o, specs, { material: 'cloth', hp: 6, colors: [{ hex: 0xc8b078, w: 0.7 }, { hex: 0x9a8458, w: 0.3 }] }, () => { const b = H.mk(); b.mode('cloth'); for (const s of specs) { b.sph(s.x, s.y + 0.15 * k, s.z, 0.28 * k, 0.17 * k, 0.4 * k, 0xc8b078, s.yaw, 7); } return i.add(b.build()); });
  }, { size: 1.5, face: 'random', spacing: 2 });

  // ---- more machines and workshops
  def('siege-ballista', 'wooden siege ballista (faces away); trigger/squeeze at its rear crank looses a heavy bolt in a fast flat arc (30 dmg, small blast)', 'scale', ['ballista', 'bolt thrower', 'giant crossbow', 'ballistae'], (i, o) => {
    const k = kk(o), b = H.mk();
    b.box(0, 0.55, 0, 0.25, 0.18, 2.4, WOOD); b.box(0, 0.3, -0.7, 0.9, 0.12, 0.5, WOODD); b.box(0, 0.3, 0.5, 0.9, 0.12, 0.5, WOODD);
    for (const s of [-1, 1]) { b.cylc(s * 0.55, 0.32, 0.1, 0.32, 0.32, 0.1, WOODD, [0, 0, PI / 2], 10); b.box(s * 0.7, 0.7, 0.9, 1.2, 0.1, 0.12, WOOD, [0, s * -0.35, 0]); }
    b.box(0, 0.5, -1.0, 0.4, 0.12, 0.3, IRON); b.cylc(0, 0.62, -1.15, 0.12, 0.12, 0.35, IRON, [0, 0, PI / 2], 8);
    const base = b.build(); base.scale.setScalar(k); i.add(base);
    const bolt = H.mk(); bolt.cyl(0, 0, -0.9, 0.035, 0.035, 2.0, 0x6a4a2a, [PI / 2, 0, 0], 5); bolt.cone(0, 0, 1.15, 0.07, 0.25, 0xc0c8d0, [PI / 2, 0, 0], 5);
    const bm = bolt.build({ own: true }); bm.position.set(0, 0.7 * k, 0); bm.scale.setScalar(k); i.add(bm);
    siegeBehave(i, { lever: [0, 0.65 * k, -1.3 * k], leverR: 0.6, launch: [0.75 * k, 1.9 * k], elev: 0.08, real: false, reload: 1.8, shot: { speed: 42, damage: 30, radius: 0.14, splash: 0.9, gravity: 3, color: 0xe0d0b0, life: 4 }, boom: { size: 0.8, color: 0xc8a070 }, setPose: (a) => { bm.visible = a < 0.15; base.position.z = -a * 0.1 * k; } });
  }, { size: 2.4, face: 'away' });
  mx.model('siege-ballista', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('siege-ballista', { height: 1.6 * k, yaw: -PI / 2, anchor: 'center' }) }; },
    after(pieces, plan) {
      const { i, p } = plan, bb = p.aabb(), z0 = p.obj.position.z;
      siegeBehave(i, { lever: [0, bb.max.y * 0.45, bb.min.z + 0.15], leverR: 0.8, launch: [bb.max.y * 0.62, bb.max.z * 0.95], elev: 0.08, real: false, reload: 1.8, shot: { speed: 42, damage: 30, radius: 0.14, splash: 0.9, gravity: 3, color: 0xe0d0b0, life: 4 }, boom: { size: 0.8, color: 0xc8a070 }, setPose: (a) => { p.obj.position.z = z0 - a * 0.12; } });
    },
    destruct: WOODW(70, { rubble: ['resource-planks'], block: true }),
  });
  def('trebuchet', 'huge wooden trebuchet (faces away); trigger/squeeze at its release lever hurls a boulder in a very long arc (45 dmg, 4.5 m blast)', 'scale', ['siege trebuchet', 'trebuchets', 'counterweight trebuchet', 'giant catapult', 'siege engine large'], (i, o) => {
    const k = kk(o), b = H.mk();
    b.box(0, 0.25, 0, 2.0, 0.3, 3.4, WOODD); for (const s of [-1, 1]) { b.box(s * 0.8, 2.0, -0.2, 0.25, 4.0, 0.25, WOOD, [0, 0, s * 0.18]); b.cylc(s * 1.1, 0.4, 1.2, 0.4, 0.4, 0.15, WOODD, [0, 0, PI / 2], 10); b.cylc(s * 1.1, 0.4, -1.2, 0.4, 0.4, 0.15, WOODD, [0, 0, PI / 2], 10); }
    b.cylc(0, 3.9, -0.2, 0.1, 0.1, 1.8, IRON, [0, 0, PI / 2], 6); b.box(0, 0.5, -1.6, 0.3, 0.3, 0.3, 0x6a4a2a);
    const base = b.build(); base.scale.setScalar(k); i.add(base);
    const ab = H.mk(); ab.box(0, 0, 2.4, 0.2, 0.2, 5.6, WOOD); ab.box(0, 0, -0.6, 0.3, 0.3, 1.4, WOOD); ab.box(0, -1.0, -1.2, 1.0, 1.4, 1.0, 0x6a6a72); ab.sph(0, 0.2, 5.1, 0.3, 0.3, 0.3, 0x8a8680);
    const arm = new THREE.Group(); arm.position.set(0, 3.9 * k, -0.2 * k); arm.scale.setScalar(k); arm.add(ab.build({ own: true })); i.add(arm);
    siegeBehave(i, { lever: [0, 0.7 * k, -1.7 * k], leverR: 1.0, launch: [7.0 * k, 4.8 * k], elev: 0.9, reload: 5, shot: { speed: 24, damage: 45, radius: 0.55, splash: 4.5, gravity: 9.8, color: 0xb8a890, life: 9 }, boom: { size: 2.6, color: 0xc8a070 }, setPose: (a) => { arm.rotation.x = 0.7 - a * 2.0; } });
  }, { size: 5, face: 'away' });
  mx.model('trebuchet', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('siege-trebuchet', { height: 4.8 * k, yaw: -PI / 2, anchor: 'center' }) }; },
    after(pieces, plan) {
      const { i, p } = plan, bb = p.aabb(), sz = p.size.y, z0 = p.obj.position.z;
      siegeBehave(i, { lever: [0, bb.max.y * 0.12, bb.min.z + 0.3], leverR: 1.2, launch: [bb.max.y * 0.95, bb.max.z * 0.8], elev: 0.9, reload: 5, shot: { speed: 24, damage: 45, radius: 0.55, splash: 4.5, gravity: 9.8, color: 0xb8a890, life: 9 }, boom: { size: 2.6, color: 0xc8a070 },
        setPose: (a) => { p.obj.rotation.x = a * 0.035; p.obj.position.z = z0 - a * 0.06 * sz; } }); // static model: it lurches back as the arm lets go
    },
    destruct: WOODW(130, { rubble: ['resource-planks'], block: true }),
  });
  def('forge-workbench', 'a smith\'s corner: workbench with an anvil, a grindstone bench and a glowing coal pit with embers, sparks and a warm light; breakable', 'scale', ['blacksmith corner', 'smithing station', 'forge workbench', 'smith forge', 'coal forge'], (i, o) => {
    const k = kk(o), b = H.mk();
    b.box(-0.6, 0.8, 0, 1.0, 0.1, 0.8, 0x4a4e58); for (const s of [-1, 1]) b.box(-0.6 + s * 0.42, 0.38, 0.3, 0.1, 0.76, 0.1, 0x3a3e48); b.box(-0.6, 1.0, 0, 0.5, 0.2, 0.28, 0x3a3e48); b.box(0.7, 0.8, 0, 1.0, 0.1, 0.8, 0x6a4a2a); for (const s of [-1, 1]) b.box(0.7 + s * 0.42, 0.38, 0.3, 0.1, 0.76, 0.1, 0x4d3322); b.cylc(0.7, 1.0, 0, 0.3, 0.3, 0.1, 0x8a8e98, [0, 0, PI / 2], 10);
    b.cyl(0, 0, 1.2, 0.5, 0.6, 0.3, 0x6e6a64, 0, 8); b.mode('glow'); b.cylc(0, 0.3, 1.2, 0.4, 0.4, 0.04, 0xff5a1a, 0, 8);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    forgeFire(i, k);
  }, { size: 2.6, face: 'player' });
  function forgeFire(i, k) {
    const L = i.light({ color: 0xff7a2a, intensity: 9, distance: 8, flicker: 0.5, position: { x: i.wx(0, 1.2 * k), y: i.y + 0.8 * k, z: i.wz(0, 1.2 * k) } });
    let acc = 0; const at = { x: i.wx(0, 1.2 * k), y: i.y + 0.4 * k, z: i.wz(0, 1.2 * k) };
    i.tick((dt) => { if (i.broken) { if (L) L.enabled = false; return true; } if (!near(i, 40)) return; acc += dt * 10 * H.densK(); const n = acc | 0; acc -= n; if (n) { _w.set(at.x + rand(-0.25, 0.25) * k, at.y, at.z + rand(-0.25, 0.25) * k); i.burst('fire', 0xff6a1a, _w, n, 0.35, _up); if (Math.random() < dt * 5) i.burst('spark', 0xffb040, _w, dn(2), 0.6); } }, { every: 0.08 });
  }
  mx.model('forge-workbench', {
    model(P, o, i) { const k = kk(o); return { i, k, a: P('workbench-anvil', { x: -0.6 * k, z: 0, height: 1.0 * k, anchor: 'center' }), g: P('workbench-grind', { x: 0.7 * k, z: 0, height: 1.0 * k, anchor: 'center' }), c: P('campfire-pit', { x: 0, z: 1.2 * k, height: 0.35 * k, anchor: 'center' }) }; },
    after(pieces, plan) { forgeFire(plan.i, plan.k); },
    destruct: WOODW(60, { block: true }),
  });

  // ================================================================================================================
  // REGALIA OF THE OMNISSIAH: omni-altar, omni-obelisk, omni-throne, omni-relic, omni-gate.
  // Each uses the catalogue model of the same name when world.models has it (checked at every spawn, so the files are picked up the moment they
  // exist: static GLBs, origin at the base centre, +Y up, front +Z, glowing parts in a material named "Emissive"); otherwise the primitive stand-in.
  // ================================================================================================================
  const CYAN = 0x4af0ff, GOLD = 0xe0b84a, DARK = 0x16181e, DARK2 = 0x22252c;
  // pulse the model's "Emissive" materials (shared by all instances: the value is restored from userData, never accumulated)
  function emissiveFx(i, p) {
    const mats = [];
    p.h.root.traverse((m) => { if (!m.isMesh) return; for (const mt of [].concat(m.material)) if (mt && /emissive/i.test(mt.name || '') && 'emissiveIntensity' in mt && !mats.includes(mt)) { mt.userData.emi0 ??= mt.emissiveIntensity; mats.push(mt); } });
    if (!mats.length) return;
    const ph = rand(0, 6);
    i.tick((dt, t) => { const s = i.broken ? 0.3 : 0.8 + Math.sin(t * 2.1 + ph) * 0.25; for (const m of mats) m.emissiveIntensity = m.userData.emi0 * s; if (i.broken) return true; }, { every: 0.05 });
  }
  // a few cyan motes drifting up from a point (instance frame, metres)
  function motes(i, lx, ly, lz, rate = 3, color = CYAN) {
    let acc = 0;
    i.tick((dt) => { if (i.broken) return true; if (!near(i, 45)) return; acc += dt * rate * H.densK(); const n = acc | 0; acc -= n; if (n) { _w.set(i.wx(lx + rand(-0.4, 0.4), lz + rand(-0.4, 0.4)), i.y + ly, i.wz(lx + rand(-0.4, 0.4), lz + rand(-0.4, 0.4))); i.burst('glow', color, _w, n, 0.25, _up); } }, { every: 0.1 });
  }
  // the floating relic: a gold cogwheel with a cyan core, spinning and bobbing (returns the Group)
  function relicGroup(k) {
    const b = H.mk(), n = 12;
    b.tor(0, 0, 0, 0.42, 0.07, GOLD, 0, 14); for (let q = 0; q < n; q++) { const a = (q / n) * TAU; b.box(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0, 0.1, 0.12, 0.1, GOLD, [0, 0, a]); }
    for (let q = 0; q < 4; q++) { const a = q * PI / 2 + PI / 4; b.box(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0, 0.3, 0.05, 0.05, 0xb88a2c, [0, 0, a]); }
    b.mode('glow'); b.oct(0, 0, 0, 0.14, 0.14, 0.14, CYAN); b.tor(0, 0, 0, 0.3, 0.012, CYAN, 0, 14);
    const g = new THREE.Group(), m = b.build({ own: true }); g.add(m); g.scale.setScalar(k); return g;
  }
  function relicTick(i, g, y0, spin = 0.9) { const ph = rand(0, 6); i.tick((dt, t) => { if (i.broken) { g.visible = false; return true; } g.rotation.y = t * spin + ph; g.rotation.x = Math.sin(t * 0.7 + ph) * 0.35; g.position.y = y0 + Math.sin(t * 1.4 + ph) * 0.08; }, { every: 0.03 }); }
  const REGALIA_TOUGH = (mat, hp, extra) => brk({ material: mat, hp, stages: 'auto', ...extra });

  def('omni-altar', 'the Omnissiah\'s ritual altar: a black stone block with cyan machine-glyph trim, a glowing disc and a hovering gold cog-relic that spins and bobs; motes drift off it; tough stone', 'scale', ['omnissiah altar', 'machine altar', 'cog altar', 'altar of the omnissiah', 'ritual altar', 'machine god altar'], (i, o) => {
    const k = kk(o), b = H.mk();
    b.box(0, 0.15, 0, 2.4, 0.3, 1.6, DARK2); b.box(0, 0.6, 0, 1.9, 0.6, 1.2, DARK); b.box(0, 1.0, 0, 2.2, 0.16, 1.4, DARK2); for (const s of [-1, 1]) b.box(s * 1.05, 1.15, 0, 0.12, 0.18, 1.3, 0x3a3e48);
    b.mode('glow'); b.box(0, 0.32, 0.81, 2.0, 0.04, 0.02, CYAN); for (const s of [-1, 1]) for (let q = 0; q < 3; q++) b.box(s * (0.4 + q * 0.28), 0.62, 0.61, 0.12, 0.04, 0.02, CYAN); b.cylc(0, 1.09, 0, 0.5, 0.5, 0.03, CYAN, 0, 18); b.tor(0, 1.1, 0, 0.62, 0.02, GOLD, [PI / 2, 0, 0], 18);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const rg = relicGroup(0.8 * k); rg.position.set(0, 1.9 * k, 0); i.add(rg); relicTick(i, rg, 1.9 * k);
    motes(i, 0, 1.2 * k, 0);
  }, { size: 2.4, face: 'player' });
  mx.model('omni-altar', {
    model(P, o, i) { const k = kk(o); return { i, k, p: P('omni-altar', { anchor: 'center', scale: k }), r: P('omni-relic', { anchor: 'center', scale: 0.7 * k, y: 1.8 * k }) }; }, // the relic hovers in the altar's socket
    after(pieces, plan) {
      const { i, p, r } = plan, y0 = r.obj.position.y, ph = rand(0, 6);
      emissiveFx(i, p); emissiveFx(i, r); motes(i, 0, p.size.y + 0.2, 0);
      i.tick((dt, t) => { if (i.broken) return true; r.obj.rotation.y = t * 0.8 + ph; r.obj.position.y = y0 + Math.sin(t * 1.4 + ph) * 0.07; }, { every: 0.03 });
    },
    destruct: REGALIA_TOUGH('stone', 260, { block: true }),
  });
  def('omni-obelisk', 'the Omnissiah\'s obelisk: a tall black shaft covered in glowing cyan machine glyphs that pulse, with a gold-and-cyan tip and drifting motes; tough stone', 'scale', ['omnissiah obelisk', 'machine obelisk', 'black obelisk glyphs', 'glyph pillar', 'machine monolith', 'data spire'], (i, o) => {
    const k = kk(o), b = H.mk(), gb = H.mk();
    b.box(0, 0.15, 0, 1.7, 0.3, 1.7, DARK2); b.box(0, 0.4, 0, 1.4, 0.2, 1.4, 0x2a2e36); b.cyl(0, 0.5, 0, 0.55, 0.38, 5.0, DARK, [0, PI / 4, 0], 4); b.cone(0, 5.5, 0, 0.4, 0.9, DARK2, [0, PI / 4, 0], 4);
    b.mode('glow'); b.cone(0, 6.4, 0, 0.1, 0.35, GOLD, 0, 4);
    gb.mode('glow');
    for (let r = 0; r < 9; r++) { const y = 1.0 + r * 0.5, w = 0.5 - r * 0.02; for (let f = 0; f < 4; f++) { const a = f * PI / 2, nx = Math.sin(a), nz = Math.cos(a), off = w * 0.78 + 0.02; const len = 0.12 + ((r * 7 + f * 3) % 4) * 0.07; gb.box(nx * off + nz * (((r + f) % 3) - 1) * 0.1, y, nz * off - nx * (((r + f) % 3) - 1) * 0.1, f % 2 ? 0.03 : len, 0.05, f % 2 ? len : 0.03, CYAN); } }
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    const gm = gb.build({ own: true }); gm.scale.setScalar(k); i.add(gm);
    const ph = rand(0, 6); i.tick((dt, t) => { if (i.broken) { gm.visible = false; return true; } gm.material.color.setScalar(0.7 + Math.sin(t * 1.8 + ph) * 0.3); }, { every: 0.05 });
    motes(i, 0, 6.2 * k, 0, 2);
  }, { size: 1.8, face: 'random', spacing: 4 });
  mx.model('omni-obelisk', {
    model(P, o, i) { return { i, p: P('omni-obelisk', { anchor: 'center', scale: kk(o) }) }; },
    after(pieces, plan) { emissiveFx(plan.i, plan.p); motes(plan.i, 0, plan.p.size.y, 0, 2); },
    destruct: REGALIA_TOUGH('stone', 320, { block: true }),
  });
  def('omni-throne', 'the Omnissiah\'s throne: a tall dark-metal seat on a stepped dais with a golden cog halo that turns slowly behind the headrest and cyan trim; tough metal', 'scale', ['omnissiah throne', 'machine throne', 'golden throne', 'cog throne', 'throne of the omnissiah', 'iron throne dark'], (i, o) => {
    const k = kk(o), b = H.mk(), hb = H.mk();
    b.box(0, 0.1, 0, 2.6, 0.2, 2.2, DARK2); b.box(0, 0.3, 0, 2.0, 0.2, 1.8, DARK); b.box(0, 0.75, 0.1, 1.1, 0.5, 1.0, 0x2a2e36);
    b.box(0, 1.9, -0.4, 1.2, 2.5, 0.25, DARK); b.box(0, 3.3, -0.4, 0.8, 0.4, 0.25, 0x2a2e36); for (const s of [-1, 1]) { b.box(s * 0.65, 1.15, 0.1, 0.2, 0.2, 0.9, 0x3a3e48); b.box(s * 0.65, 0.85, 0.35, 0.18, 0.55, 0.18, 0x2a2e36); b.box(s * 0.7, 2.2, -0.4, 0.14, 2.0, 0.3, 0x2a2e36); }
    b.mode('glow'); b.box(0, 1.4, -0.26, 0.9, 0.04, 0.02, CYAN); b.box(0, 2.4, -0.26, 0.9, 0.04, 0.02, CYAN); b.box(0, 0.5, 0.92, 1.8, 0.03, 0.02, CYAN);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    hb.tor(0, 0, 0, 0.8, 0.09, GOLD, 0, 18); for (let q = 0; q < 14; q++) { const a = (q / 14) * TAU; hb.box(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0, 0.14, 0.16, 0.1, GOLD, [0, 0, a]); } hb.mode('glow'); hb.tor(0, 0, 0, 0.55, 0.015, CYAN, 0, 18);
    const halo = new THREE.Group(); halo.position.set(0, 3.3 * k, -0.62 * k); halo.scale.setScalar(k); halo.add(hb.build({ own: true })); i.add(halo);
    i.tick((dt, t) => { if (i.broken) { halo.visible = false; return true; } halo.rotation.z = t * 0.25; }, { every: 0.04 });
    motes(i, 0, 3.0 * k, -0.5 * k, 1.2);
  }, { size: 2.8, face: 'player', spacing: 4 });
  mx.model('omni-throne', {
    model(P, o, i) { return { i, p: P('omni-throne', { anchor: 'center', scale: kk(o) }) }; },
    after(pieces, plan) { emissiveFx(plan.i, plan.p); motes(plan.i, 0, plan.p.size.y * 0.8, -0.3, 1.2); },
    destruct: REGALIA_TOUGH('metal', 240, { block: true }),
  });
  def('omni-relic', 'a floating Omnissiah relic: a gold cogwheel with a glowing cyan core that spins, bobs and sheds sparkling motes; breakable', 'scale', ['omnissiah relic', 'floating cog', 'machine relic', 'cog artifact', 'relic', 'gold cog', 'artifact', 'omnissiah cog'], (i, o) => {
    const k = kk(o);
    const g = relicGroup(1.2 * k); g.position.set(0, 1.3 * k, 0); i.add(g); relicTick(i, g, 1.3 * k);
    const pb = H.mk(); pb.cyl(0, 0, 0, 0.3, 0.38, 0.12, DARK2, 0, 10); pb.mode('glow'); pb.cylc(0, 0.13, 0, 0.22, 0.22, 0.02, CYAN, 0, 12);
    const pm = pb.build(); pm.scale.setScalar(k); i.add(pm);
    motes(i, 0, 1.3 * k, 0, 4, GOLD);
  }, { size: 1.2, face: 'random', spacing: 2.5 });
  mx.model('omni-relic', {
    model(P, o, i) { return { i, p: P('omni-relic', { anchor: 'center', scale: kk(o), y: 1.0 * kk(o) }) }; }, // the model rests on its lowest point: lift it so it floats
    after(pieces, plan) {
      const { i, p } = plan, y0 = p.obj.position.y, ph = rand(0, 6);
      emissiveFx(i, p); motes(i, 0, p.size.y * 0.7, 0, 4, GOLD);
      i.tick((dt, t) => { if (i.broken) return true; p.obj.rotation.y = t * 0.8 + ph; p.obj.position.y = y0 + Math.sin(t * 1.4 + ph) * 0.07; }, { every: 0.03 });
    },
    destruct: REGALIA_TOUGH('metal', 90, { collide: false }), // floats: nothing to hit
  });
  def('omni-gate', 'the Omnissiah\'s gateway: two black machine pillars with cyan glyph lights carrying a glowing cyan arch crowned with a gold cog; walk through it; tough stone', 'scale', ['omnissiah gate', 'machine gate', 'arch gate', 'glyph gate', 'cog gate'], (i, o) => {
    const k = kk(o), b = H.mk();
    for (const s of [-1, 1]) { b.box(s * 2.3, 0.2, 0, 1.3, 0.4, 1.3, DARK2); b.box(s * 2.3, 2.6, 0, 0.9, 4.4, 0.9, DARK); b.box(s * 2.3, 4.95, 0, 1.1, 0.3, 1.1, DARK2); }
    b.mode('glow'); for (const s of [-1, 1]) for (let q = 0; q < 5; q++) b.box(s * 2.3, 0.9 + q * 0.75, 0.46, 0.5 - (q % 2) * 0.2, 0.05, 0.02, CYAN);
    const n = 15; for (let q = 0; q < n; q++) { const a = PI - (q / (n - 1)) * PI, R = 2.3; b.box(Math.cos(a) * R, 5.1 + Math.sin(a) * R * 0.85, 0, 0.5, 0.2, 0.24, CYAN, [0, 0, a + PI / 2]); }
    b.mode('solid'); for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU; b.box(Math.cos(a) * 0.5, 7.9 + Math.sin(a) * 0.5, 0, 0.14, 0.2, 0.14, GOLD, [0, 0, a]); } b.tor(0, 7.9, 0, 0.42, 0.07, GOLD, 0, 12); b.mode('glow'); b.oct(0, 7.9, 0, 0.14, 0.14, 0.14, CYAN);
    const m = b.build(); m.scale.setScalar(k); i.add(m);
    motes(i, 0, 5.5 * k, 0, 3);
    gatePillars(i, k);
  }, { size: 5.5, face: 'player', keepOut: 6 });
  // the gate is walk-through: only its two pillars are solid (stop the player and fighters, things fly into them)
  function gatePillars(i, k) { for (const s of [-1, 1]) mx.collider(i, box3((s * 2.3 - 0.5) * k, 0, -0.5 * k, (s * 2.3 + 0.5) * k, 5.1 * k, 0.5 * k), { block: true }); }
  mx.model('omni-gate', {
    model(P, o, i) { return { i, p: P('omni-gate', { anchor: 'center', scale: kk(o) }) }; },
    after(pieces, plan, o) { emissiveFx(plan.i, plan.p); motes(plan.i, 0, plan.p.size.y * 0.7, 0, 3); gatePillars(plan.i, kk(o)); },
    destruct: REGALIA_TOUGH('stone', 320, { collide: false }), // the arch is open: only the two pillars are solid (gatePillars)
  });
}
