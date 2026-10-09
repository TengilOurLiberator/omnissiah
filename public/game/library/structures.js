// library/structures.js - buildings and landmarks, 1-3 merged draw calls each. Local +Z is the front (door side); they default to facing the player.
// Solid parts use H.blk blockers (fixed 'world' colliders, created only once the player is clear of them; gateways / doors stay open).
import installModelKit from './modelkit.js';

export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, ease, shade, mix } = H;
  const PI = Math.PI;
  const mx = lib.mx = installModelKit(H); // H.mx: model-backed building + destruction helpers shared by structures / nature / props / scenarios (see modelkit.js)
  const NOSCALE = new Set(['wall-segment', 'fence', 'iron-fence', 'garden-wall', 'arena', 'stone-circle', 'bridge', 'dock', 'signpost', 'portal-arch', 'gate']); // these take length/radius instead
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'structures', description, options, aliases, build: mx.wrap(name, build), groupScale: !NOSCALE.has(name), ...extra });
  const _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 0.8, 0);
  const STONE = [0x8a8680, 0x7a766e, 0x9a968e, 0x6e6a64];
  const stone = () => pick(STONE);
  const WOOD = 0x7a5230, WOODD = 0x4d3322, THATCH = 0xc9a85a;
  const ROOFS = [0xa8452f, 0x4a5a78, 0x5a7a4a, 0x7a5a3a, 0x8a3a3a];
  const near = (p, r) => { const dx = H.head.x - p.x, dz = H.head.z - p.z; return dx * dx + dz * dz < r * r; };

  // chimney smoke from a local point
  function smoke(i, lx, ly, lz, rate = 2.4) {
    let acc = 0;
    i.tick((dt) => {
      if (Math.abs(H.head.x - i.x) + Math.abs(H.head.z - i.z) > 70) return;
      acc += dt * rate; const n = acc | 0; acc -= n;
      if (n) { const p = i.at(lx, lz); _w.set(p.x, i.y + ly, p.z); i.burst('puff', 0x9a9a9a, _w, n, 0.32, _up); }
    }, { every: 0.2 });
  }
  // ---- H.blk: solid scenery colliders shared by structures / nature / scenarios (kit's own colliders never stop the player unless block:true, and a
  // block:true part created on top of the player traps them). A blocker is a FIXED 'world' box / cylinder in instance-local coordinates that is
  // only CREATED once the player's head is > 0.8 m outside its footprint (the visual is there at once), and removed when its `gone()` says so
  // (the destructible it stands for broke, the instance went away). Without world.physics it falls back to kit.obstacle circles (classic path).
  //   blk.box(i, lx, lz, w, d, h, { yaw, y, gone, steer })   blk.cyl(i, lx, lz, r, h, { y, gone, steer })   (y = bottom, default ground)
  //   blk.piece(i, piece, { shape: 'box'|'cyl', inset: 0.9, h, gone })   a loaded mx.place model's footprint (oriented by its yaw)
  //   blk.item(i, spec, { inset, h, gone })   a mx.scatter item (gone defaults to "broken"; also gone once the scatter fell back to primitives)
  const PAD = 0.8, _bv = new THREE.Vector3(), _bq = new THREE.Quaternion(), AXY = new THREE.Vector3(0, 1, 0);
  const phys = () => H.ctx.world.physics ?? null;
  const ks = (i) => (i.entry && i.entry.groupScale ? i.scale || 1 : 1); // entries with groupScale are scaled AFTER their build runs
  function blkFree(s) {
    if (s.ph) { try { s.ph.remove(); } catch (err) { /* gone */ } s.ph = null; }
    if (s.obs) { for (const ob of s.obs) { try { ob.remove(); } catch (err) { /* gone */ } } s.obs = null; }
    s.dead = true;
  }
  function blkMake(i, s) {
    const P = phys(), K = H.kit(), g = i.group;
    g.updateWorldMatrix(true, false);
    const k = g.scale.x || 1, yaw = g.rotation.y + s.yaw;
    _bv.set(s.lx, s.ly + s.h / 2, s.lz); g.localToWorld(_bv);
    const cx = _bv.x, cy = _bv.y, cz = _bv.z, hh = s.h * k;
    const hx = s.cyl ? s.r * k : s.w * k / 2, hz = s.cyl ? s.r * k : s.d * k / 2;
    // the player's head must be clear of the footprint (+ margin) and not far below / above it
    const dx = H.head.x - cx, dz = H.head.z - cz;
    let inside;
    if (s.cyl) inside = Math.hypot(dx, dz) < hx + PAD;
    else { const c = Math.cos(yaw), sn = Math.sin(yaw), lx = dx * c - dz * sn, lz = dx * sn + dz * c; inside = Math.abs(lx) < hx + PAD && Math.abs(lz) < hz + PAD; }
    if (inside && H.head.y > cy - hh / 2 - 0.3 && H.ctx.player.feet.y < cy + hh / 2) return false;
    if (P && !s.noBody) {
      _bq.setFromAxisAngle(AXY, yaw);
      s.ph = P.body(i.ctx, null, { type: 'fixed', shape: s.cyl ? 'cylinder' : 'box', size: s.cyl ? [hx, hh] : [hx * 2, hh, hz * 2], position: { x: cx, y: cy, z: cz }, quaternion: { x: _bq.x, y: _bq.y, z: _bq.z, w: _bq.w }, group: 'world', friction: 0.7, restitution: 0.1 });
    }
    if (K && K.obstacle && (!P || s.steer)) { // classic path: circles push the rig; actors steer around houses / towers
      s.obs = [];
      if (s.cyl) s.obs.push(K.obstacle(i.ctx, { position: { x: cx, y: 0, z: cz }, radius: hx }));
      else {
        const long = Math.max(hx, hz) * 2, short = Math.max(P ? 0.3 : 0.9, Math.min(hx, hz) * 2), n = Math.max(1, Math.min(P ? 6 : 12, Math.ceil(long / (short * 0.9)))), alongX = hx >= hz, c = Math.cos(yaw), sn = Math.sin(yaw);
        for (let q = 0; q < n; q++) {
          const t = n === 1 ? 0 : (q / (n - 1) - 0.5) * (long - short), ox = alongX ? t : 0, oz = alongX ? 0 : t;
          s.obs.push(K.obstacle(i.ctx, { position: { x: cx + ox * c + oz * sn, y: 0, z: cz - ox * sn + oz * c }, radius: short * 0.5 }));
        }
      }
    }
    s.made = true;
    return true;
  }
  function blkStep(i, m) {
    for (let q = m.list.length - 1; q >= 0; q--) {
      const s = m.list[q];
      if (s.dead) { m.list.splice(q, 1); continue; }
      if (s.gone && s.gone()) { blkFree(s); m.list.splice(q, 1); continue; }
      if (!s.made) { try { blkMake(i, s); } catch (err) { console.error('[library] blocker failed', err); s.dead = true; } }
    }
  }
  function blkAdd(i, s) {
    if (i.removed) return null;
    if (!i._blk) {
      i._blk = { list: [] };
      i.tick(() => blkStep(i, i._blk), { every: 0.2 });
      i.cleanup(() => { for (const b of i._blk.list) blkFree(b); i._blk.list.length = 0; });
    }
    s.made = false; s.ph = null; s.obs = null; s.dead = false;
    i._blk.list.push(s);
    return s;
  }
  const gyLocal = (i, lx, lz) => { const k = ks(i); return (i.gy(lx * k, lz * k) - i.y) / k; };
  const blk = H.blk = {
    PAD,
    box(i, lx, lz, w, d, h, o = {}) {
      const y = o.y ?? gyLocal(i, lx, lz) - 0.3;
      return blkAdd(i, { lx, lz, ly: y, w, d, h: h + (o.y === undefined ? 0.3 : 0), yaw: o.yaw ?? 0, cyl: false, gone: o.gone, steer: o.steer });
    },
    cyl(i, lx, lz, r, h, o = {}) {
      const y = o.y ?? gyLocal(i, lx, lz) - 0.3;
      return blkAdd(i, { lx, lz, ly: y, r, h: h + (o.y === undefined ? 0.3 : 0), yaw: 0, cyl: true, gone: o.gone, steer: o.steer });
    },
    // a sub-rectangle of a loaded piece's footprint (fractions 0..1 along the piece's own x / z): gate piers, arch pillars ...
    part(i, p, fx, fz, o = {}) {
      if (!p || !p.ok || i.removed) return null;
      const inset = o.inset ?? 1, c = Math.cos(p.yaw), sn = Math.sin(p.yaw), w = (fx[1] - fx[0]) * p.size.x, d = (fz[1] - fz[0]) * p.size.z;
      const cx = p.min.x + (fx[0] + fx[1]) / 2 * p.size.x, cz = p.min.z + (fz[0] + fz[1]) / 2 * p.size.z;
      const lx = p.obj.position.x + cx * c + cz * sn, lz = p.obj.position.z - cx * sn + cz * c, y = p.obj.position.y - 0.25, h = (o.h ?? p.size.y) + 0.25, gone = o.gone ?? (() => (i.broken | 0) > 0);
      if (o.shape === 'cyl') return blkAdd(i, { lx, lz, ly: y, r: Math.min(w, d) / 2 * inset, h, yaw: 0, cyl: true, gone, steer: o.steer });
      return blkAdd(i, { lx, lz, ly: y, w: w * inset, d: d * inset, h, yaw: p.yaw, cyl: false, gone, steer: o.steer });
    },
    piece(i, p, o = {}) { return blk.part(i, p, [0, 1], [0, 1], { ...o, inset: o.inset ?? 0.9 }); },
    item(i, s, o = {}) {
      const inf = H.ctx.world.models?.info?.(s.name);
      if (!inf || i.removed) return null;
      const k = inf.scale ?? 1, sx = s.sx ?? s.scale ?? 1, sy = s.sy ?? sx, sz = s.sz ?? sx, inset = o.inset ?? 1, yaw = s.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw), fx = o.fx ?? [0, 1];
      const wAll = inf.size[0] * k * sx, hh = inf.size[1] * k * sy, d = inf.size[2] * k * sz, w = wAll * (fx[1] - fx[0]), cx = inf.min[0] * k * sx + wAll * (fx[0] + fx[1]) / 2, cz = inf.min[2] * k * sz + d / 2; // fx = [from, to] fractions of the model's width (doorways)
      const lx = s.x + cx * c + cz * sn, lz = s.z - cx * sn + cz * c, y = (s.y ?? gyLocal(i, s.x, s.z)) - 0.25, sc = o.sc;
      const gone = o.gone ?? (() => s.state === 2 || (sc && sc.removed));
      if (o.shape === 'cyl') return blkAdd(i, { lx, lz, ly: y, r: Math.min(w, d) / 2 * inset, h: (o.h ?? hh) + 0.25, yaw: 0, cyl: true, gone, steer: o.steer });
      return blkAdd(i, { lx, lz, ly: y, w: w * inset, d: d * inset, h: (o.h ?? hh) + 0.25, yaw, cyl: false, gone, steer: o.steer });
    },
  };
  blk.free = blkFree;
  // swinging door leaves: solid only while shut. specs = [[lx, lz, width, thickness]]; returns fn(closed) to call every tick
  function doorLeaves(i, specs, h) {
    let cur = null;
    return (closed) => {
      if (closed && !cur) cur = specs.map(([lx, lz, w, t]) => blk.box(i, lx, lz, w, t, h));
      else if (!closed && cur) { for (const s of cur) if (s) blkFree(s); cur = null; }
    };
  }
  // a straight run along local X (fences, walls): ONE box spanning the ground under it
  function runBlock(i, L, h, t, o = {}) {
    let lo = 1e9, hi = -1e9;
    const n = Math.max(2, Math.ceil(L / 2));
    for (let k = 0; k <= n; k++) { const g = gyLocal(i, -L / 2 + (k / n) * L, 0); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    return blk.box(i, 0, 0, L, t, h + (hi - lo) + 0.3, { y: lo - 0.3, ...o });
  }
  const anyBroken = (i) => () => (i.broken | 0) > 0;
  const foundation = (b, w, d, depth = 1.0, c = 0x6e6a64) => b.box(0, 0.1 - depth / 2, 0, w, depth + 0.2, d, c);
  // flag/banner animated by wind
  function flag(i, parent, x, y, z, w, h, color, extra = 0xffffff) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const b = H.mk(); b.mode('cloth'); b.box(w / 2, -h / 2, 0, w, h, 0.02, color); b.box(w / 2, -h * 0.9, 0, w * 0.5, h * 0.2, 0.021, extra);
    g.add(b.build({ own: true })); parent.add(g);
    const ph = rand(0, 6);
    i.tick((dt, t) => { const wd = 0.4 + (H.ctx.world.env?.wind ?? 0.5); g.rotation.y = Math.sin(t * 2.4 * wd + ph) * 0.35; g.rotation.z = Math.sin(t * 3.1 * wd + ph) * 0.06; }, { every: 0.05 });
    return g;
  }
  // glowing window panel (emissive instead of a light)
  function win(b, x, y, z, w, h, rotY, color = 0xffd890) {
    b.push(x, y, z, rotY);
    b.box(0, 0, 0, w + 0.14, h + 0.14, 0.08, WOODD); b.mode('glow'); b.box(0, 0, 0.03, w, h, 0.04, color); b.mode('solid');
    b.box(0, 0, 0.06, 0.04, h, 0.03, WOODD); b.box(0, 0, 0.06, w, 0.04, 0.03, WOODD);
    b.pop();
  }

  // ================================================================ houses
  def('hut', 'round mud-and-thatch hut with a conical roof, low door and glowing windows', 'scale, yaw', ['round hut', 'straw hut', 'tribal hut', 'house small', 'shack', 'huts', 'hovel'], (i, o) => {
    const b = H.mk(), roof = o.roof ?? pick([THATCH, 0xb89a4a, 0xa8864a]);
    b.cyl(0, -0.6, 0, 1.62, 1.7, 0.9, 0x7a766e, 0, 11);
    b.cyl(0, 0.2, 0, 1.45, 1.6, 1.7, pick([0xb08a5a, 0xa87c4c, 0xbd9462]), 0, 11);
    for (let k = 0; k < 11; k++) { const a = (k / 11) * TAU; b.dod(Math.cos(a) * 1.68, 0.12, Math.sin(a) * 1.68, 0.2, 0.14, 0.2, stone(), [rand(0, 3), rand(0, 3), 0]); }
    b.cone(0, 1.75, 0, 2.2, 1.9, roof, 0, 11); b.cone(0, 1.95, 0, 2.1, 1.7, shade(roof, 0.92), 0.3, 11); b.cone(0, 3.4, 0, 0.12, 0.7, WOODD, 0, 5); b.sph(0, 4.1, 0, 0.1, 0.1, 0.1, 0xd9a93c);
    b.box(0, 0.75, 1.52, 0.8, 1.35, 0.14, WOODD); b.box(0, 0.75, 1.575, 0.62, 1.2, 0.05, 0x5a3a20); b.sph(0.22, 0.75, 1.62, 0.04, 0.04, 0.04, 0xd9a93c);
    for (const a of [-0.9, 0.9]) win(b, Math.sin(a) * 1.56, 1.1, Math.cos(a) * 1.56, 0.34, 0.34, a);
    b.box(-1.2, 0.35, 1.45, 0.5, 0.5, 0.4, WOODD); // woodpile
    i.add(b.build());
    blk.cyl(i, 0, 0, 1.55, 3.0, { gone: anyBroken(i), steer: true });
    smoke(i, 0, 3.4, 0, 1.8);
  }, { size: 2.3 });

  def('cottage', 'timber-and-stone cottage: red/blue/green gabled roof, chimney with smoke, flower boxes, glowing windows, door under the gable', 'scale, yaw', ['house', 'home', 'cabin', 'cottages', 'building', 'farmhouse', 'villa', 'lodge', 'houses'], (i, o) => {
    const b = H.mk(), roof = o.roof ?? pick(ROOFS), X = 4.6, Z = 5.6;
    foundation(b, X + 0.3, Z + 0.3, 1.2);
    b.box(0, 0.7, 0, X, 1.2, Z, stone());
    b.box(0, 1.85, 0, X - 0.08, 1.2, Z - 0.08, pick([0xe8dcc0, 0xdccaa0, 0xd8d0b8]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (X / 2 - 0.02), 1.6, sz * (Z / 2 - 0.02), 0.22, 2.6, 0.22, WOODD);
    for (const sz of [-1, 1]) { b.box(0, 2.4, sz * (Z / 2 - 0.02), X, 0.16, 0.2, WOODD); b.box(0, 1.28, sz * (Z / 2 - 0.02), X, 0.14, 0.2, WOODD); b.box(0, 1.85, sz * (Z / 2 - 0.02), 0.14, 1.2, 0.2, WOODD); }
    for (const sx of [-1, 1]) { b.box(sx * (X / 2 - 0.02), 2.4, 0, 0.2, 0.16, Z, WOODD); b.box(sx * (X / 2 - 0.02), 1.28, 0, 0.2, 0.14, Z, WOODD); }
    b.prism(0, 2.4, 0, X + 1.0, 1.8, Z + 0.8, roof);
    b.prism(0, 2.4, 0, X + 0.5, 1.55, Z + 0.9, shade(roof, 0.8));
    b.box(0, 4.2, 0, 0.14, 0.14, Z + 0.9, WOODD);
    b.box(1.5, 3.3, -1.3, 0.8, 2.6, 0.8, 0x7a766e); b.box(1.5, 4.6, -1.3, 1.0, 0.18, 1.0, 0x6a665e);
    b.box(0, 0.95, Z / 2 + 0.01, 1.0, 1.9, 0.14, WOODD); b.box(0, 0.95, Z / 2 + 0.07, 0.8, 1.7, 0.05, 0x5a3a20); b.sph(0.28, 0.95, Z / 2 + 0.12, 0.045, 0.045, 0.045, 0xd9a93c);
    b.box(0, 0.12, Z / 2 + 0.45, 1.6, 0.24, 0.7, 0x8a8680);
    for (const sx of [-1, 1]) win(b, sx * 1.55, 1.5, Z / 2 + 0.02, 0.6, 0.7, 0);
    for (const sx of [-1, 1]) win(b, sx * (X / 2 + 0.02), 1.5, -0.8, 0.6, 0.7, sx * PI / 2);
    win(b, 0, 3.0, Z / 2 + 0.2, 0.5, 0.5, 0);
    for (const sx of [-1, 1]) { b.box(sx * 1.55, 1.05, Z / 2 + 0.2, 0.9, 0.14, 0.24, WOODD); for (let k = 0; k < 4; k++) b.sph(sx * 1.55 + (k - 1.5) * 0.2, 1.2, Z / 2 + 0.2, 0.07, 0.07, 0.07, pick([0xff6a8a, 0xffd24a, 0xffffff, 0xff9a4a])); }
    b.mode('glow'); b.sph(0.8, 1.9, Z / 2 + 0.2, 0.07, 0.07, 0.07, 0xffc060);
    i.add(b.build());
    blk.box(i, 0, 0, X - 0.1, Z - 0.1, 3.9, { gone: anyBroken(i), steer: true });
    smoke(i, 1.5, 4.8, -1.3);
  }, { size: 3.8 });

  def('watchtower', 'tall wooden lookout tower with a ladder, railed platform, pyramid roof and a flapping pennant', 'scale', ['lookout', 'watch tower', 'guard tower', 'observation tower', 'wooden tower', 'tower'], (i, o) => {
    const b = H.mk(), H1 = 7;
    foundation(b, 3.6, 3.6, 1.2, 0x6e6a64);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.cyl(sx * 1.45, 0, sz * 1.45, 0.17, 0.2, H1 + 0.2, WOOD, [0, 0, 0], 6); }
    for (const lv of [1.8, 3.8, 5.8]) { for (const s of [-1, 1]) { b.box(0, lv, s * 1.4, 2.9, 0.12, 0.12, WOODD); b.box(s * 1.4, lv, 0, 0.12, 0.12, 2.9, WOODD); } }
    for (const s of [-1, 1]) { b.box(0, 3.0, s * 1.42, 0.1, 4.5, 0.08, WOODD, [0, 0, 0.6]); b.box(0, 3.0, s * 1.42, 0.1, 4.5, 0.08, WOODD, [0, 0, -0.6]); }
    b.box(0, H1 + 0.05, 0, 3.8, 0.2, 3.8, WOOD);
    for (const s of [-1, 1]) { b.box(0, H1 + 0.65, s * 1.8, 3.8, 0.1, 0.1, WOODD); b.box(0, H1 + 1.1, s * 1.8, 3.8, 0.1, 0.1, WOODD); b.box(s * 1.8, H1 + 0.65, 0, 0.1, 0.1, 3.8, WOODD); b.box(s * 1.8, H1 + 1.1, 0, 0.1, 0.1, 3.8, WOODD); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.8, H1 + 1.35, sz * 1.8, 0.16, 2.6, 0.16, WOODD);
    b.cone(0, H1 + 2.6, 0, 3.0, 1.6, pick(ROOFS), PI / 4, 4); b.cone(0, H1 + 2.7, 0, 2.8, 1.5, 0x5a3a28, PI / 4, 4);
    for (let k = 0; k < 9; k++) b.box(0, 0.4 + k * 0.78, 1.52, 0.55, 0.07, 0.07, WOODD);
    for (const s of [-1, 1]) b.box(s * 0.27, H1 / 2 + 0.15, 1.5, 0.07, H1 + 0.1, 0.07, WOODD);
    b.box(0, H1 + 0.45, 0, 1.0, 0.9, 1.0, 0x7a5a38); // lookout crate
    i.add(b.build());
    const pole = H.mk(); pole.cyl(0, H1 + 3.6, 0, 0.04, 0.05, 1.6, WOODD); i.add(pole.build());
    flag(i, i.group, 0, H1 + 5.0, 0, 1.0, 0.55, 0xb83a3a);
    blk.box(i, 0, 0, 3.4, 3.4, H1 + 1.5, { gone: anyBroken(i), steer: true });
  }, { size: 3 });

  def('castle-tower', 'round stone keep with crenellations, arrow slits, an arched door, glowing windows and a conical roof with a banner', 'roof (false for open top), scale', ['castle', 'tower keep', 'keep', 'fortress tower', 'round tower', 'turret', 'fort', 'stone tower'], (i, o) => {
    const b = H.mk(), Hh = 9, R = 2.0, seg = 14;
    b.cyl(0, -1.2, 0, R + 0.5, R + 0.7, 1.4, 0x6e6a64, 0, seg);
    b.cyl(0, 0, 0, R + 0.25, R + 0.4, 0.8, 0x7a766e, 0, seg);
    b.cyl(0, 0.8, 0, R, R + 0.2, Hh - 0.8, 0x8a8680, 0, seg);
    for (let k = 1; k < 5; k++) b.cyl(0, k * 1.8, 0, R + 0.02, R + 0.02, 0.14, 0x76726c, 0, seg);
    b.cyl(0, Hh, 0, R + 0.45, R, 0.6, 0x7a766e, 0, seg);
    const open = o.roof === false;
    if (open) for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; b.box(Math.cos(a) * (R + 0.35), Hh + 0.9, Math.sin(a) * (R + 0.35), 0.5, 0.8, 0.5, 0x8a8680, [0, -a, 0]); }
    else { b.cyl(0, Hh + 0.55, 0, R + 0.2, R + 0.2, 0.5, 0x8a8680, 0, seg); b.cone(0, Hh + 1.0, 0, R + 0.75, 3.4, pick([0x3a5a98, 0x8a3a3a, 0x3a7a5a]), 0, seg); b.sph(0, Hh + 4.5, 0, 0.14, 0.14, 0.14, 0xd9a93c); }
    for (let k = 0; k < 5; k++) { const a = Math.PI * 0.2 + (k - 2) * 1.0; b.box(Math.sin(a) * (R + 0.0), 3 + (k % 3) * 1.8, Math.cos(a) * R, 0.16, 0.8, 0.14, 0x14120f, [0, a, 0]); }
    for (const a of [1.6, -1.6, 3.1]) win(b, Math.sin(a) * (R + 0.01), 6.3, Math.cos(a) * (R + 0.01), 0.4, 0.55, a);
    b.box(0, 1.2, R + 0.05, 1.4, 2.4, 0.3, 0x4a463f); b.box(0, 1.1, R + 0.12, 1.0, 2.0, 0.2, 0x3a2616); b.cyl(0, 2.1, R + 0.12, 0.5, 0.5, 0.2, 0x3a2616, [PI / 2, 0, 0], 8);
    b.mode('glow'); b.box(0.65, 1.7, R + 0.28, 0.1, 0.1, 0.1, 0xffc060); b.box(-0.65, 1.7, R + 0.28, 0.1, 0.1, 0.1, 0xffc060);
    i.add(b.build());
    blk.cyl(i, 0, 0, R + 0.15, Hh + 1, { gone: anyBroken(i), steer: true });
    flag(i, i.group, R * 0.75, Hh + (open ? 2.4 : 5.4), 0, 1.5, 0.9, pick([0xb83a3a, 0x3a5ab8, 0xd9a93c]));
    const pole = H.mk(); pole.cyl(R * 0.75, Hh + (open ? 0.6 : 4.6), 0, 0.04, 0.05, 2.0, WOODD); i.add(pole.build());
  }, { size: 3.2 });

  def('wall-segment', 'stone castle wall with a crenellated walkway; option length (default 8 m); put several end to end', 'length, scale', ['wall', 'castle wall', 'stone wall', 'rampart', 'battlement', 'walls', 'fortification'], (i, o) => {
    const L = clamp(o.length ?? 8, 2, 40), b = H.mk(), n = Math.max(1, Math.round(L / 2));
    const y0 = i.y;
    for (let k = 0; k < n; k++) {
      const x = -L / 2 + (k + 0.5) * (L / n), g = i.gy(x, 0) - y0;
      b.box(x, g - 0.5 + 1.5, 0, L / n + 0.02, 3.6, 1.1, stone());
      b.box(x, g + 3.4, 0, L / n + 0.02, 0.3, 1.4, 0x7a766e);
      b.box(x, g + 3.7, -0.5, L / n, 0.6, 0.35, 0x8a8680);
      for (let m = 0; m < 2; m++) b.box(x - L / n / 4 + m * (L / n / 2), g + 4.2, 0.55, L / n / 4, 0.7, 0.35, 0x8a8680);
      b.box(x, g + 1.8, 0.56, L / n - 0.3, 0.1, 0.05, 0x6a665e); b.box(x, g + 0.9, 0.56, L / n - 0.3, 0.1, 0.05, 0x6a665e);
    }
    for (let k = 0; k <= n; k++) { const x = -L / 2 + k * (L / n); b.box(x, i.gy(x, 0) - y0 + 2.0, 0.65, 0.5, 4.4, 0.4, 0x7a766e); }
    b.box(0, 1.1, -0.0, L, 0.1, 0.1, 0x14120f);
    i.add(b.build());
    blk.box(i, 0, 0.1, L, 1.5, 4.8, { gone: anyBroken(i) });
  }, { size: 3, face: 'player', spread: 8, spacing: 8 });

  def('gate', 'castle gatehouse: two stone towers, arch and big wooden doors that swing open as you walk up and close behind you', 'scale', ['gatehouse', 'castle gate', 'city gate', 'portcullis', 'entrance gate', 'big gate', 'gates', 'archway gate'], (i, o) => {
    const b = H.mk();
    for (const s of [-1, 1]) {
      b.box(s * 3.4, 3.2, 0, 2.6, 6.4, 2.8, stone()); b.box(s * 3.4, 6.55, 0, 3.0, 0.3, 3.2, 0x7a766e);
      for (let k = 0; k < 3; k++) b.box(s * 3.4 + (k - 1) * 1.1, 7.0, 0, 0.7, 0.8, 3.2, 0x8a8680);
      b.box(s * 3.4, 4.2, 1.42, 0.16, 0.8, 0.12, 0x14120f); win(b, s * 3.4, 5.3, 1.42, 0.4, 0.5, 0);
      b.box(s * 3.4, -0.4, 0, 3.0, 1.0, 3.2, 0x6e6a64);
    }
    b.box(0, 5.95, 0, 4.2, 1.0, 2.6, stone()); b.box(0, 6.55, 0, 4.4, 0.3, 3.0, 0x7a766e);
    for (let k = -4; k <= 4; k++) b.box(k * 0.34, 4.35, 0.0, 0.05, 1.5, 0.05, 0x2a2e36);
    b.box(0, 4.0, 0.0, 3.4, 0.05, 0.05, 0x2a2e36); b.box(0, 4.6, 0.0, 3.0, 0.05, 0.05, 0x2a2e36);
    for (let k = 0; k < 4; k++) b.box(-1.65 + k * 1.1, 7.0, 0, 0.8, 0.8, 3.0, 0x8a8680);
    for (let k = 0; k <= 10; k++) { const a = (k / 10) * PI; b.box(Math.cos(a) * 1.9, 3.6 + Math.sin(a) * 1.5, 1.3, 0.55, 0.6, 0.55, 0x9a968e, [0, 0, a]); b.box(Math.cos(a) * 1.9, 3.6 + Math.sin(a) * 1.5, -1.3, 0.55, 0.6, 0.55, 0x9a968e, [0, 0, a]); }
    b.box(0, 5.2, 1.5, 0.9, 0.5, 0.3, 0xd9a93c);
    b.box(0, -0.5, 0, 3.6, 0.3, 2.8, 0x5a564f);
    i.add(b.build());
    const doors = [-1, 1].map((s) => {
      const g = new THREE.Group(); g.position.set(s * 1.85, 0, 0.5);
      const d = H.mk(); d.box(-s * 0.9, 1.7, 0, 1.8, 3.4, 0.2, 0x5a3a20);
      for (let k = 0; k < 6; k++) d.box(-s * (0.15 + k * 0.3), 1.7, 0.11, 0.05, 3.4, 0.03, 0x3a2616);
      for (const y of [0.7, 1.7, 2.7]) d.box(-s * 0.9, y, 0.12, 1.7, 0.12, 0.04, 0x2a2e36);
      d.box(-s * 0.2, 1.5, 0.15, 0.1, 0.4, 0.06, 0xd9a93c);
      g.add(d.build()); i.add(g); return g;
    });
    // the two towers always block; the closed door leaves block only while the gate is (nearly) shut: an open gateway is a real 4 m opening
    for (const s of [-1, 1]) blk.box(i, s * 3.4, 0, 2.7, 3.0, 7, { gone: anyBroken(i), steer: true });
    const leaves = doorLeaves(i, [[-0.95, 0.5, 1.8, 0.3], [0.95, 0.5, 1.8, 0.3]], 3.4);
    let open = 0, was = false;
    i.tick((dt) => {
      const p = i, dx = H.head.x - i.x, dz = H.head.z - i.z, d = Math.hypot(dx, dz);
      const want = d < 5.5 ? 1 : 0;
      if (want !== (was ? 1 : 0)) { was = !!want; i.snd().noise({ dur: 0.9, filter: { type: 'bandpass', freq: 220, freqEnd: 160, q: 4 }, vol: 0.2, at: { x: p.x, y: 1.5, z: p.z } }); i.snd().tone({ freq: 90, freqEnd: 60, dur: 0.9, type: 'sawtooth', vol: 0.1, at: { x: p.x, y: 1.5, z: p.z } }); }
      open += (want - open) * Math.min(1, dt * 1.6);
      doors[0].rotation.y = open * 1.7; doors[1].rotation.y = -open * 1.7;
      leaves(open < 0.2 && !i.broken);
    });
  }, { size: 5.5, keepOut: 6 });

  def('bridge', 'arched wooden footbridge with railings over a small stream (8 m long)', 'length, scale', ['wooden bridge', 'footbridge', 'stone bridge', 'creek bridge', 'bridges', 'plank bridge'], (i, o) => {
    const L = clamp(o.length ?? 8, 4, 20), W = 2.4, b = H.mk(), n = 14, y0 = i.y + 0.03;
    const arc = (u) => Math.sin(u * PI) * 0.9;
    for (let k = 0; k < n; k++) {
      const u0 = k / n, u1 = (k + 1) / n, x0 = (u0 - 0.5) * L, x1 = (u1 - 0.5) * L, cx = (x0 + x1) / 2, cy = (arc(u0) + arc(u1)) / 2 + 0.45, a = Math.atan2(arc(u1) - arc(u0), x1 - x0);
      b.box(cx, cy, 0, (x1 - x0) * 1.04, 0.14, W, pick([0x8a6a40, 0x7a5a38, 0x96734a]), [0, 0, a]);
    }
    for (const sz of [-1, 1]) {
      b.box(0, 0.24, sz * (W / 2 - 0.1), L - 0.4, 0.16, 0.2, WOODD);
      for (let k = 0; k <= 6; k++) { const u = k / 6, x = (u - 0.5) * (L - 0.6); b.box(x, arc(u * 0.92 + 0.04) + 0.45 + 0.5, sz * (W / 2 - 0.05), 0.14, 1.0, 0.14, WOODD); }
      for (let k = 0; k < 6; k++) { const u0 = k / 6, u1 = (k + 1) / 6, x0 = (u0 - 0.5) * (L - 0.6), x1 = (u1 - 0.5) * (L - 0.6), a = Math.atan2(arc(u1 * 0.92 + 0.04) - arc(u0 * 0.92 + 0.04), x1 - x0); b.box((x0 + x1) / 2, (arc(u0 * 0.92 + 0.04) + arc(u1 * 0.92 + 0.04)) / 2 + 1.35, sz * (W / 2 - 0.05), (x1 - x0), 0.1, 0.1, WOOD, [0, 0, a]); }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * (L / 2 - 0.4), -1.0, sz * (W / 2 - 0.2), 0.14, 0.16, 1.5, WOODD, 0, 6);
    for (const sx of [-1, 1]) { b.box(sx * (L / 2 + 0.3), -0.2, 0, 1.4, 0.6, W + 0.6, 0x6e6a64); }
    i.add(b.build());
    for (const sz of [-1, 1]) blk.box(i, 0, sz * (W / 2 - 0.05), L - 0.5, 0.2, 2.1, { gone: anyBroken(i) }); // the railings: walk onto the deck from the ends, not through the sides
    // stream underneath (runs across the bridge; a thin water film just above the grass with muddy banks)
    const SW = L - 1.8, wb = H.mk(); wb.mode('ghost'); wb.box(0, 0.07, 0, SW, 0.03, 16, 0x4a9ab0);
    const w = wb.build({ own: true }); i.add(w);
    const bank = H.mk(); for (const s of [-1, 1]) { bank.box(s * (SW / 2 + 0.25), 0.04, 0, 0.7, 0.1, 16, 0x5a4a38); } bank.box(0, 0.03, 0, SW, 0.05, 16, 0x2a4a58);
    i.add(bank.build());
    i.tick((dt, t) => { w.position.x = Math.sin(t * 0.7) * 0.04; });
  }, { size: 5 });

  def('well', 'stone well with a little shingled roof, winch, rope and bucket; plinks when you are near', 'scale', ['wishing well', 'water well', 'wells'], (i, o) => {
    const b = H.mk();
    b.cyl(0, -0.6, 0, 0.95, 1.05, 1.5, stone(), 0, 12); b.cyl(0, 0.6, 0, 0.95, 0.95, 0.4, 0x8a8680, 0, 12);
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; b.box(Math.cos(a) * 0.95, 0.95, Math.sin(a) * 0.95, 0.4, 0.2, 0.26, stone(), [0, -a + PI / 2, 0]); }
    b.mode('ghost'); b.cylc(0, 0.62, 0, 0.7, 0.7, 0.02, 0x3a8aa8, 0, 12); b.mode('solid');
    for (const s of [-1, 1]) b.box(s * 0.95, 1.6, 0, 0.12, 2.0, 0.12, WOODD);
    b.box(0, 1.05, 0, 2.0, 0.1, 0.12, WOODD);
    b.cyl(0, 1.72, 0, 0.1, 0.1, 1.4, WOOD, [0, 0, PI / 2], 6);
    b.prism(0, 2.5, 0, 2.5, 0.9, 1.8, pick(ROOFS)); b.box(0, 3.4, 0, 0.12, 0.08, 1.8, WOODD);
    b.cyl(0.3, 1.0, 0, 0.012, 0.012, 0.75, 0x6a5a40, 0, 4); b.cyl(0.3, 0.55, 0, 0.12, 0.1, 0.18, 0x6a4a2a, 0, 8);
    i.add(b.build());
    blk.cyl(i, 0, 0, 1.0, 2.2, { gone: anyBroken(i), steer: true });
    let nx = rand(3, 8);
    i.tick((dt, t) => { if (!near(i, 14)) return; nx -= dt; if (nx < 0) { nx = rand(8, 16); i.snd().tone({ freq: 1400 + rand(0, 400), freqEnd: 900, dur: 0.18, type: 'sine', vol: 0.1, at: { x: i.x, y: i.y + 0.3, z: i.z } }); } }, { every: 0.5 });
  }, { size: 1.6 });

  def('market-stall', 'wooden market stall with a striped awning, crates of fruit and bread, potions and hanging lanterns', 'scale', ['stall', 'market stand', 'shop stall', 'vendor stall', 'booth', 'market', 'stalls', 'fruit stand'], (i, o) => {
    const b = H.mk(), c1 = pick([0xc83a3a, 0x3a6ac8, 0x3ac86a, 0xc8a03a]);
    b.box(0, 0.5, 0, 2.6, 0.95, 0.95, 0x7a5230); b.box(0, 1.0, 0, 2.8, 0.1, 1.1, 0x96734a);
    for (const sx of [-1, 1]) { b.box(sx * 1.3, 1.25, -0.5, 0.12, 2.5, 0.12, WOODD); b.box(sx * 1.3, 0.9, 0.55, 0.12, 1.8, 0.12, WOODD); }
    b.mode('cloth');
    for (let k = 0; k < 8; k++) b.box(-1.4 + (k + 0.5) * 0.35, 2.35 - 0.0, 0.0, 0.35, 0.05, 1.5 + 0.0, k % 2 ? 0xf4f0e4 : c1, [0.28, 0, 0]);
    for (let k = 0; k < 8; k++) b.box(-1.4 + (k + 0.5) * 0.35, 1.9, 0.78, 0.35, 0.2, 0.03, k % 2 ? 0xf4f0e4 : c1);
    b.mode('solid');
    b.box(0, 1.2, -0.5, 2.5, 0.8, 0.06, 0x56391f);
    for (let k = 0; k < 5; k++) b.sph(-0.9 + k * 0.17, 1.17, 0.1, 0.075, 0.075, 0.075, pick([0xd83a2a, 0xe8a030, 0x7ac040]));
    b.box(-0.7, 1.14, -0.25, 0.5, 0.12, 0.3, 0x8a6a3a); for (let k = 0; k < 4; k++) b.sph(-0.8 + k * 0.1, 1.24, -0.25, 0.07, 0.05, 0.1, 0xd8a050);
    for (let k = 0; k < 3; k++) { b.cyl(0.35 + k * 0.22, 1.05, 0.0, 0.05, 0.07, 0.2, 0xeeeeee, 0, 6); b.mode('glow'); b.sph(0.35 + k * 0.22, 1.28, 0.0, 0.06, 0.06, 0.06, [0xff5a8a, 0x5ac8ff, 0x9aff6a][k]); b.mode('solid'); }
    b.box(1.0, 0.25, 0.75, 0.5, 0.5, 0.5, 0x8a6a3a); b.box(-1.0, 0.25, 0.75, 0.5, 0.5, 0.5, 0x8a6a3a); for (let k = 0; k < 4; k++) b.sph(-1.1 + (k % 2) * 0.18, 0.56, 0.7 + (k >> 1) * 0.15, 0.08, 0.08, 0.08, 0xd83a2a);
    b.mode('glow'); for (const sx of [-1, 1]) { b.cyl(sx * 1.0, 1.95, 0.6, 0.015, 0.015, 0.2, 0xaaaaaa); b.sph(sx * 1.0, 1.85, 0.6, 0.08, 0.1, 0.08, 0xffc060); }
    i.add(b.build());
    if (!o.noStatic) blk.box(i, 0, 0.05, 2.8, 1.3, 2.4, { gone: anyBroken(i), steer: true });
  }, { size: 2.0 });

  // tent geometry shared by tent + campsite
  function tentParts(b, x, z, yaw, color, flap = true) {
    b.push(x, 0, z, yaw);
    b.mode('cloth'); b.prism(0, 0, 0, 3.2, 2.1, 3.4, color); b.prism(0, 0, 0, 3.26, 2.15, 1.0, shade(color, 0.85));
    if (flap) { b.prism(0, 0, 1.69, 1.4, 1.5, 0.05, 0x1a1410); b.box(-0.62, 0.7, 1.74, 0.7, 1.5, 0.04, shade(color, 0.9), [0, 0.3, 0.45]); b.box(0.62, 0.7, 1.74, 0.7, 1.5, 0.04, shade(color, 0.9), [0, -0.3, -0.45]); }
    b.mode('solid');
    b.cyl(0, 0, 1.75, 0.04, 0.04, 2.2, WOODD, 0, 5); b.cyl(0, 0, -1.75, 0.04, 0.04, 2.2, WOODD, 0, 5); b.box(0, 2.18, 0, 0.05, 0.05, 3.7, WOODD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.cone(sx * 2.3, 0, sz * 2.0, 0.05, 0.22, WOODD, 0, 4); b.box(sx * 1.95, 0.55, sz * 1.9, 0.02, 1.3, 0.02, 0x8a7a5a, [sz * 0.1, 0, sx * 0.45]); }
    b.box(-0.45, 0.1, 1.2, 0.5, 0.2, 1.5, 0x8a3a3a); b.sph(-0.45, 0.2, 1.95, 0.22, 0.12, 0.2, 0x8a3a3a);
    b.pop();
  }
  def('tent', 'canvas A-frame tent with open flap, ropes, pegs and a bedroll inside; option color', 'color, scale', ['camping tent', 'canvas tent', 'pavilion', 'tents', 'bell tent'], (i, o) => {
    const b = H.mk(); tentParts(b, 0, 0, 0, o.color ?? pick([0xe8dcc0, 0x7a9a5a, 0xc8503a, 0x5a7ab0, 0xd0b060]));
    i.add(b.build());
  }, { size: 2.4 });

  def('campsite', 'camp: tent, crackling campfire with light and sparks, three log seats, a cooking pot on a tripod and supplies', 'color', ['camp', 'camping', 'bivouac', 'campground', 'camp fire site', 'camp site', 'outpost'], (i, o) => {
    const b = H.mk();
    tentParts(b, -2.4, -1.2, 0.5, o.color ?? pick([0xe8dcc0, 0x7a9a5a, 0xc8503a]));
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; b.dod(Math.cos(a) * 0.85 + 1.4, 0.07, Math.sin(a) * 0.85 + 0.9, 0.17, 0.11, 0.17, stone(), [rand(0, 3), rand(0, 3), 0]); }
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + 0.3; b.cylc(Math.cos(a) * 0.3 + 1.4, 0.25, Math.sin(a) * 0.3 + 0.9, 0.07, 0.07, 1.0, 0x4a2e1a, [-Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7], 6); }
    for (let k = 0; k < 3; k++) { const a = 0.9 + k * 2.1; b.cylc(Math.cos(a) * 2.2 + 1.4, 0.22, Math.sin(a) * 2.2 + 0.9, 0.2, 0.2, 1.3, 0x7a5230, [0, -a + PI / 2, PI / 2], 8); }
    for (const a of [0, 2.1, 4.2]) b.cyl(Math.cos(a) * 0.9 + 1.4, 0, Math.sin(a) * 0.9 + 0.9, 0.025, 0.025, 1.7, WOODD, [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45], 4);
    b.cyl(1.4, 0.55, 0.9, 0.22, 0.28, 0.3, 0x2a2e36, 0, 9); b.sph(1.4, 0.9, 0.9, 0.2, 0.1, 0.2, 0x4a2a18);
    b.box(0.2, 0.25, 3.0, 0.7, 0.5, 0.5, 0x8a6a3a); b.sph(-0.4, 0.28, 3.0, 0.3, 0.28, 0.3, 0xa89a70); b.cyl(-1.5, 0, 2.4, 0.18, 0.2, 0.55, 0x6a4a2a, 0, 8);
    if (!o.noStatic) i.add(b.build());
    const fp = i.at(1.4, 0.9), fy = i.y + 0.2;
    const flame = i.fx({ count: 90, color: [0xffd070, 0xff3a00], size: [0.45, 0.06], life: [0.5, 0.9], speed: 0.25, gravity: -2.2, drag: 0.6, spread: 0.13 });
    const sparks = i.fx({ count: 40, color: [0xffcc55, 0xff2200], size: [0.05, 0.015], life: [1.2, 2.6], speed: 0.6, gravity: -0.9, drag: 0.2, spread: 0.15 });
    const L = i.light({ color: 0xff8a3a, intensity: 26, distance: 16, flicker: 0.4, position: { x: fp.x, y: fy + 0.9, z: fp.z } });
    const hot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4a0a, transparent: true, opacity: 0.8 })); hot.material.userData.own = true; hot.position.set(1.4, 0.06, 0.9); i.add(hot);
    const at = { x: fp.x, y: fy + 0.3, z: fp.z }, push = new THREE.Vector3(0, 0.4, 0);
    let aF = 0, aS = 0, nc = 0.5;
    i.tick((dt, t) => {
      if (Math.abs(H.head.x - fp.x) + Math.abs(H.head.z - fp.z) > 80) return;
      aF += dt * 40; aS += dt * 5; let n = aF | 0; aF -= n; if (n && flame) { _w.set(fp.x, fy + 0.3, fp.z); flame.emit(_w, n); }
      n = aS | 0; aS -= n; if (n && sparks) { _w.set(fp.x, fy + 0.6, fp.z); sparks.emit(_w, n, push); }
      hot.material.opacity = 0.7 + Math.sin(t * 7) * 0.12;
      if (t > nc && near(i, 25)) { nc = t + 0.1 + Math.random() * 0.5; i.snd().noise({ dur: 0.03 + Math.random() * 0.05, filter: { type: 'bandpass', freq: 1500 + Math.random() * 3500, q: 3 }, vol: 0.1 + Math.random() * 0.15, at }); }
    });
  }, { size: 4.5, keepOut: 5 });

  def('windmill', 'tapered white windmill with a dark cap, door, windows and four big cloth sails that turn with the wind', 'scale', ['mill', 'wind mill', 'windmills', 'grain mill', 'dutch windmill'], (i, o) => {
    const b = H.mk(), Hh = 7.5;
    foundation(b, 4.6, 4.6, 1.2, 0x6e6a64);
    b.cyl(0, 0, 0, 1.55, 2.2, Hh, pick([0xe8dcc0, 0xd8d0b8, 0xe2d4b0]), 0, 12);
    b.cyl(0, Hh, 0, 1.8, 1.5, 0.35, 0x5a3a28, 0, 12); b.cone(0, Hh + 0.3, 0, 1.75, 1.8, 0x5a3a28, 0, 12); b.sph(0, Hh + 2.2, 0, 0.12, 0.12, 0.12, 0xd9a93c);
    b.box(0, 0.95, 2.05, 0.95, 1.9, 0.2, 0x4a2e1a); b.box(0, 0.95, 2.14, 0.75, 1.7, 0.06, 0x6a4a2a);
    const rw = (y) => 2.2 - 0.0867 * y + 0.02;
    win(b, 0, 3.9, rw(3.9), 0.45, 0.6, 0); win(b, Math.sin(0.9) * rw(3.3), 3.3, Math.cos(0.9) * rw(3.3), 0.4, 0.5, 0.9); win(b, -Math.sin(0.9) * rw(3.3), 3.3, Math.cos(0.9) * rw(3.3), 0.4, 0.5, -0.9); win(b, 0, 6.0, rw(6.0), 0.4, 0.5, 0);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; b.box(Math.cos(a) * 2.05, 0.1, Math.sin(a) * 2.05, 0.4, 0.3, 0.4, stone()); }
    b.cylc(0, Hh + 0.5, 1.6, 0.18, 0.18, 0.6, 0x3a2a1a, [PI / 2, 0, 0], 8);
    i.add(b.build());
    blk.cyl(i, 0, 0, 1.9, Hh + 1, { gone: anyBroken(i), steer: true });
    const hub = new THREE.Group(); hub.position.set(0, Hh + 0.5, 1.95); i.add(hub);
    const sb = H.mk();
    for (let k = 0; k < 4; k++) {
      sb.push(0, 0, 0, 0, 0, k * PI / 2);
      sb.box(0, 3.1, 0, 0.16, 6.0, 0.14, 0x4a2e1a);
      for (let r = 0; r < 7; r++) sb.box(0.45, 0.8 + r * 0.78, 0, 0.9, 0.06, 0.1, 0x6a4a2a);
      sb.mode('cloth'); sb.box(0.5, 4.0, 0.02, 0.85, 3.8, 0.03, 0xf0e8d0); sb.mode('solid');
      sb.pop();
    }
    sb.sph(0, 0, 0.03, 0.3, 0.3, 0.3, 0x3a2a1a);
    hub.add(sb.build({ own: true }));
    let spin = rand(0, 6);
    i.tick((dt) => { const wind = H.ctx.world.env?.wind ?? 0.5; spin += dt * (0.25 + wind * 1.1); hub.rotation.z = spin; });
  }, { size: 3.5 });

  def('lighthouse', 'red-and-white striped lighthouse with a gallery and a lantern room whose light beam sweeps around', 'scale', ['light house', 'beacon', 'lighthouses', 'beacon tower', 'sea tower'], (i, o) => {
    const b = H.mk(), Hh = 12;
    for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; b.dod(Math.cos(a) * 2.3, 0.1, Math.sin(a) * 2.3, 0.9, 0.7, 0.9, stone(), [rand(0, 3), rand(0, 3), 0]); }
    b.cyl(0, -1, 0, 2.2, 2.2, 1.6, 0x6e6a64, 0, 14);
    const bands = 6, bh = (Hh - 2) / bands;
    for (let k = 0; k < bands; k++) { const r0 = 1.75 - (k / bands) * 0.55, r1 = 1.75 - ((k + 1) / bands) * 0.55; b.cyl(0, 0.6 + k * bh, 0, r1, r0, bh, k % 2 ? 0xf2efe6 : 0xc83a3a, 0, 14); }
    b.cyl(0, Hh - 1.4, 0, 1.55, 1.2, 0.2, 0x2a2e36, 0, 14);
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; b.box(Math.cos(a) * 1.5, Hh - 0.7, Math.sin(a) * 1.5, 0.06, 0.8, 0.06, 0x2a2e36); }
    b.tor(0, Hh - 0.3, 0, 1.5, 0.04, 0x2a2e36, [PI / 2, 0, 0], 14);
    b.cyl(0, Hh - 1.2, 0, 0.9, 0.9, 1.9, 0x2a2e36, 0, 10);
    b.mode('ghost'); b.cyl(0, Hh - 1.05, 0, 0.82, 0.82, 1.6, 0xbfeaff, 0, 10); b.mode('solid');
    b.cone(0, Hh + 0.55, 0, 1.15, 1.1, 0xc83a3a, 0, 10); b.sph(0, Hh + 1.75, 0, 0.1, 0.1, 0.1, 0xd9a93c);
    b.box(0, 0.9, 1.75, 0.9, 1.7, 0.3, 0x3a2616); win(b, 0, 5.0, 1.55, 0.3, 0.5, 0); win(b, 1.4, 8.0, 0.9, 0.3, 0.5, 1.0);
    b.mode('glow'); b.sph(0, Hh - 0.4, 0, 0.32, 0.32, 0.32, 0xfff2b0);
    if (!o.noStatic) { i.add(b.build()); blk.cyl(i, 0, 0, 1.8, Hh + 1, { gone: anyBroken(i), steer: true }); }
    const bm = H.mk(); bm.mode('beam');
    for (const s of [-1, 1]) bm.cone(0, 0, s * 22, 1.6, 22, 0xfff0a0, [s > 0 ? -PI / 2 : PI / 2, 0, 0], 10);
    const beam = bm.build({ own: true }); beam.position.set(0, Hh - 0.4, 0); i.add(beam);
    const L = i.light({ color: 0xffe9a0, intensity: 28, distance: 22, position: { x: i.x, y: i.y + Hh - 0.4, z: i.z } });
    i.tick((dt) => { beam.rotation.y += dt * 0.9; });
  }, { size: 3.2 });

  def('ruins', 'crumbling ancient ruins: broken columns, a fallen arch, wall stubs, rubble and moss', 'scale, radius', ['ruin', 'ancient ruins', 'broken temple', 'old temple', 'temple ruins', 'crumbled walls', 'remains', 'rubble'], (i, o) => {
    const b = H.mk(), R = 6;
    b.box(0, -0.35, 0, 9, 0.7, 8, 0x76726c);
    for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU + 0.3, r = rand(3, 4.2), h = rand(1.2, 5), x = Math.cos(a) * r, z = Math.sin(a) * r; b.cyl(x, 0.2, z, 0.5, 0.58, h, pick([0xa8a498, 0x9a968c]), 0, 9); b.box(x, 0.4, z, 1.3, 0.4, 1.3, 0x8a867c); blk.cyl(i, x, z, 0.6, h + 0.2, { gone: anyBroken(i) }); if (h > 4) { b.box(x, 0.2 + h + 0.15, z, 1.2, 0.3, 1.2, 0x8a867c, [0, 0.4, 0.1]); } else { b.cyl(x, 0.2 + h, z, 0.45, 0.5, 0.15, 0x8a867c, [rand(-0.3, 0.3), 0, rand(-0.3, 0.3)], 7); } }
    for (let k = 0; k < 3; k++) { const a = rand(0, TAU), r = rand(2, 4.5); b.cylc(Math.cos(a) * r, 0.5, Math.sin(a) * r, 0.5, 0.5, 1.2, 0x9a968c, [0, rand(0, 3), PI / 2 + rand(-0.2, 0.2)], 9); }
    b.box(-4.2, 1.2, -1, 0.7, 2.4, 3.4, 0x8a867c); b.box(-4.2, 2.7, -2.1, 0.7, 1.2, 1.2, 0x8a867c, [0, 0, 0.1]);
    b.box(4.4, 0.9, 1.5, 0.7, 1.8, 2.4, 0x8a867c); b.box(4.4, 2.1, 0.9, 0.7, 0.8, 0.9, 0x7a766e);
    for (let k = 0; k < 10; k++) { const a = rand(0, TAU), r = rand(0.5, 5.3); b.box(Math.cos(a) * r, 0.18, Math.sin(a) * r, rand(0.3, 0.8), rand(0.2, 0.5), rand(0.3, 0.8), stone(), [rand(0, 1), rand(0, 3), rand(0, 1)]); }
    for (let k = 0; k < 12; k++) { const a = rand(0, TAU), r = rand(1, 5); b.sph(Math.cos(a) * r, 0.05, Math.sin(a) * r, rand(0.2, 0.45), 0.1, rand(0.2, 0.45), pick([0x4a7a3a, 0x5a8a40, 0x3a6a30])); }
    i.add(b.build());
    blk.box(i, -4.2, -1, 0.8, 3.4, 2.4, { gone: anyBroken(i) }); blk.box(i, 4.4, 1.5, 0.8, 2.4, 1.8, { gone: anyBroken(i) }); // the two wall stubs
  }, { size: 5, face: 'random' });

  def('stone-circle', 'ring of 10 standing stones with lintels and a glowing rune altar in the middle; hums when you step inside', 'radius, scale', ['standing stones', 'stonehenge', 'henge', 'monoliths', 'ancient circle', 'druid circle', 'megaliths', 'circle'], (i, o) => {
    const R = (o.radius ?? 5) * (o.scale ?? 1), b = H.mk(), n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU, x = Math.cos(a) * R, z = Math.sin(a) * R, h = rand(2.6, 3.4), gy = i.gy(x, z) - i.y;
      b.box(x, gy + h / 2 - 0.4, z, 0.9, h, 0.6, pick([0x7a7a82, 0x6a6a72, 0x8a8a92]), [rand(-0.05, 0.05), -a + PI / 2, rand(-0.06, 0.06)]);
      b.box(x, gy - 0.5, z, 1.2, 0.5, 0.9, 0x5a5a62, [0, -a + PI / 2, 0]);
      if (!o.noStatic) blk.box(i, x, z, 0.95, 0.7, h, { yaw: -a + PI / 2, gone: anyBroken(i) });
    }
    for (const k of [0, 3, 6]) { const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, am = (a0 + a1) / 2, x = Math.cos(am) * R * Math.cos(PI / n), z = Math.sin(am) * R * Math.cos(PI / n); b.box(x, i.gy(x, z) - i.y + 3.1, z, R * 0.66, 0.6, 0.7, 0x74747c, [0, -am + PI / 2, 0]); }
    b.cyl(0, -0.4, 0, 1.4, 1.5, 0.7, 0x6a6a72, 0, 9); b.box(0, 0.5, 0, 1.6, 0.25, 1.0, 0x7a7a82, 0.5);
    if (!o.noStatic) i.add(b.build());
    const rb = H.mk(); rb.mode('beam'); rb.tor(0, 0.64, 0, 0.55, 0.03, 0x7affc8, [PI / 2, 0, 0], 16); rb.tor(0, 0.64, 0, 0.3, 0.025, 0x58c8ff, [PI / 2, 0, 0], 12);
    const runes = rb.build({ own: true }); i.add(runes);
    let acc = 0, ph = 0, hum = 0;
    i.tick((dt, t) => {
      runes.rotation.y += dt * 0.5; runes.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
      const d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      if (d > 60) return;
      acc += dt * 2; const n = acc | 0; acc -= n;
      if (n) { _w.set(i.x + rand(-0.4, 0.4), i.y + 0.8, i.z + rand(-0.4, 0.4)); i.burst('glow', 0x7affc8, _w, n, 0.5, _up); }
      hum -= dt; if (d < R && hum <= 0) { hum = 7; i.snd().chord([110, 165, 220], { dur: 6, type: 'sine', vol: 0.12, at: { x: i.x, y: i.y + 1, z: i.z }, stagger: 0.4 }); }
    }, { every: 0.1 });
  }, { size: 6.5, face: 'random', keepOut: 7 });

  def('shrine', 'small roofed stone shrine with candles, drifting incense smoke and a floating glowing orb; chimes when you step up to it', 'color (orb)', ['altar', 'temple', 'chapel', 'sanctuary', 'small temple', 'shrines', 'gazebo', 'pagoda'], (i, o) => {
    const orb = o.color ?? pick([0x7affc8, 0x9a7bff, 0xffd870, 0x7ac8ff]), b = H.mk();
    b.cyl(0, -0.3, 0, 2.1, 2.3, 0.7, 0x76726c, 0, 8); b.cyl(0, 0.4, 0, 1.8, 1.9, 0.25, 0x8a867c, 0, 8); b.cyl(0, 0.65, 0, 1.55, 1.7, 0.2, 0x9a968c, 0, 8);
    for (let k = 0; k < 4; k++) { const a = PI / 4 + (k / 4) * TAU, x = Math.cos(a) * 1.35, z = Math.sin(a) * 1.35; b.cyl(x, 0.85, z, 0.18, 0.2, 2.6, 0xa8a498, 0, 8); b.box(x, 3.5, z, 0.5, 0.2, 0.5, 0x8a867c); b.box(x, 0.9, z, 0.5, 0.2, 0.5, 0x8a867c); }
    b.cone(0, 3.55, 0, 2.5, 1.5, 0x8a3a3a, PI / 4, 4); b.cone(0, 3.5, 0, 2.7, 0.6, 0x5a2a2a, PI / 4, 4); b.sph(0, 5.1, 0, 0.12, 0.12, 0.12, 0xd9a93c);
    b.cyl(0, 0.85, 0, 0.35, 0.45, 1.0, 0x8a867c, 0, 8); b.cyl(0, 1.85, 0, 0.5, 0.35, 0.12, 0x8a867c, 0, 8);
    for (const [x, z] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]]) { b.cyl(x, 0.85, z, 0.06, 0.06, 0.28, 0xeee6d0, 0, 6); b.mode('glow'); b.cone(x, 1.13, z, 0.03, 0.09, 0xffc060, 0, 5); b.mode('solid'); }
    b.box(0, 0.88, 1.55, 1.4, 0.04, 0.3, 0x56391f);
    if (!o.noStatic) {
      i.add(b.build());
      for (let k = 0; k < 4; k++) { const a = PI / 4 + (k / 4) * TAU; blk.cyl(i, Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.28, 3.6, { gone: anyBroken(i) }); } // four pillars; walk in between them to the altar
      blk.cyl(i, 0, 0, 0.5, 1.9, { gone: anyBroken(i) });
    }
    const ob = H.mk(); ob.mode('glow'); ob.sph(0, 0, 0, 0.18, 0.18, 0.18, orb, 0, 8); ob.mode('beam'); ob.sph(0, 0, 0, 0.32, 0.32, 0.32, orb, 0, 8);
    const orbM = ob.build({ own: true }); orbM.position.set(0, 2.4, 0); i.add(orbM);
    const L = i.light({ color: orb, intensity: 12, distance: 9, position: { x: i.x, y: i.y + 2.4, z: i.z } });
    let acc = 0, was = false;
    i.tick((dt, t) => {
      orbM.position.y = 2.4 + Math.sin(t * 1.3) * 0.12; orbM.rotation.y += dt; if (L) L.position.y = i.y + orbM.position.y;
      if (!near(i, 50)) return;
      acc += dt * 3; const n = acc | 0; acc -= n; if (n) { _w.set(i.x + 0.8, i.y + 1.3, i.z + 0.8); i.burst('puff', 0xdddddd, _w, n, 0.22, _up); }
      const d = Math.hypot(H.head.x - i.x, H.head.z - i.z);
      if (d < 2.4 && !was) { was = true; i.snd().chord([523, 784, 1047, 1319], { dur: 1.8, type: 'sine', vol: 0.16, at: { x: i.x, y: i.y + 2, z: i.z }, stagger: 0.12 }); } else if (d > 5) was = false;
    }, { every: 0.1 });
  }, { size: 2.6 });

  def('obelisk', 'tall black obelisk with a golden tip, glowing runes that pulse, and three motes orbiting it; low hum', 'color, scale', ['monolith', 'pillar', 'spire', 'black obelisk', 'rune stone', 'runestone', 'monument', 'totem', 'obelisks'], (i, o) => {
    const c = o.color ?? pick([0x7a5cff, 0x58e6ff, 0xff6a4a, 0x7affc8]), b = H.mk();
    b.cyl(0, -0.4, 0, 1.6, 1.7, 0.7, 0x2a2a32, PI / 4, 4); b.cyl(0, 0.2, 0, 1.2, 1.3, 0.35, 0x34343c, PI / 4, 4); b.cyl(0, 0.5, 0, 0.9, 1.0, 0.3, 0x3a3a44, PI / 4, 4);
    b.cyl(0, 0.75, 0, 0.18, 0.62, 6.0, 0x1a1a22, PI / 4, 4); b.mode('glow'); b.cone(0, 6.75, 0, 0.18, 0.55, 0xd9a93c, PI / 4, 4);
    b.mode('solid');
    if (!o.noStatic) { i.add(b.build()); blk.cyl(i, 0, 0, 1.2, 7, { gone: anyBroken(i), steer: true }); }
    const rb = H.mk(); rb.mode('beam');
    for (let k = 0; k < 6; k++) { const y = 1.3 + k * 0.85, w = 0.62 - (k * 0.85) / 6 * 0.44 + 0.015; for (const [rx, rz, ry] of [[0, 1, 0], [0, -1, PI], [1, 0, PI / 2], [-1, 0, -PI / 2]]) { rb.box(rx * w * 0.71, y, rz * w * 0.71, 0.22, 0.04, 0.02, c, [0, ry, 0]); rb.box(rx * w * 0.71, y + 0.17, rz * w * 0.71, 0.04, 0.3, 0.02, c, [0, ry, 0]); rb.box(rx * w * 0.71 + (rx ? 0 : 0.1), y + 0.1, rz * w * 0.71 + (rx ? 0.1 : 0), 0.1, 0.04, 0.02, c, [0, ry, 0]); } }
    const runes = rb.build({ own: true }); i.add(runes);
    const mb = H.mk(); mb.mode('glow'); mb.sph(0, 0, 0, 0.09, 0.09, 0.09, c);
    const motes = []; for (let k = 0; k < 3; k++) { const m = mb.build({ own: true }); i.add(m); motes.push(m); }
    let hum = rand(0, 4);
    i.tick((dt, t) => {
      const mat = runes.material; if (mat) mat.opacity = 0.35 + 0.25 * Math.sin(t * 1.6);
      for (let k = 0; k < 3; k++) { const a = t * (0.8 + k * 0.15) + k * 2.09; motes[k].position.set(Math.cos(a) * 1.3, 2.0 + k * 1.6 + Math.sin(t * 1.7 + k) * 0.4, Math.sin(a) * 1.3); }
      hum -= dt; if (hum <= 0 && near(i, 22)) { hum = 9; i.snd().tone({ freq: 82, dur: 4.5, type: 'sine', vol: 0.12, at: { x: i.x, y: i.y + 3, z: i.z } }); i.snd().tone({ freq: 123, dur: 4.5, type: 'sine', vol: 0.06, at: { x: i.x, y: i.y + 3, z: i.z } }); }
    }, { every: 0.04 });
  }, { size: 1.8 });

  // ---- portal-arch (pairs teleport the player)
  def('portal-arch', 'stone arch with a swirling portal; walk through to teleport to the next portal (spawn count: 2 for a pair)', 'color, scale', ['portal', 'gateway', 'teleporter', 'warp gate', 'stargate', 'magic portal', 'portals', 'teleport'], (i, o) => {
    const c = o.color ?? pick([0x9a5cff, 0x40e0ff, 0xff8a30, 0x40ffa0]), c2 = mix(c, 0xffffff, 0.5), b = H.mk();
    for (const s of [-1, 1]) { b.box(s * 1.75, 2.0, 0, 0.7, 4.0, 0.8, stone()); b.box(s * 1.75, 0.15, 0, 1.0, 0.3, 1.1, 0x6a665e); b.mode('glow'); for (let k = 0; k < 4; k++) b.box(s * 1.75, 0.8 + k * 0.9, 0.41, 0.2, 0.08, 0.02, c); b.mode('solid'); }
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * PI; b.box(Math.cos(a) * 1.75, 3.9 + Math.sin(a) * 1.15, 0, 0.7, 0.7, 0.8, stone(), [0, 0, a]); }
    b.box(0, 5.2, 0, 0.8, 0.6, 0.9, 0x9a968e); b.mode('glow'); b.sph(0, 5.25, 0.46, 0.12, 0.12, 0.12, c);
    if (!o.noStatic) { i.add(b.build()); for (const s of [-1, 1]) blk.box(i, s * 1.75, 0, 1.0, 1.1, 4.2, { gone: anyBroken(i) }); } // two pillars; the 2.8 m opening between them is the portal
    const sw = new THREE.Group(); sw.position.set(0, 2.55, 0); i.add(sw);
    const rings = [];
    const SB = H.mk(); SB.mode('beam');
    for (let k = 0; k < 5; k++) { const r = 1.6 - k * 0.28, g = new THREE.Group(); const rb = H.mk(); rb.mode('beam'); rb.tor(0, 0, 0, r, 0.07, k % 2 ? c2 : c, 0, 20); for (let q = 0; q < 3; q++) { const a = q * 2.09 + k; rb.box(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0, r * 0.9, 0.05, 0.02, c, [0, 0, a]); } g.add(rb.build({ own: true })); sw.add(g); rings.push(g); }
    SB.cylc(0, 0, 0, 1.6, 1.6, 0.01, mix(c, 0x000000, 0.4), [PI / 2, 0, 0], 24);
    const disc = SB.build({ own: true }); sw.add(disc);
    const L = i.light({ color: c, intensity: 16, distance: 11, position: { x: i.x, y: i.y + 2.5, z: i.z } });
    const rec = { inst: i, cd: 0 };
    H.S.portals.push(rec);
    i.cleanup(() => { const k = H.S.portals.indexOf(rec); if (k >= 0) H.S.portals.splice(k, 1); });
    const cosY = Math.cos(i.yaw), sinY = Math.sin(i.yaw);
    let acc = 0, whoosh = 0;
    i.tick((dt, t) => {
      for (let k = 0; k < rings.length; k++) rings[k].rotation.z += dt * (k % 2 ? 1 : -1) * (0.7 + k * 0.35);
      rec.cd -= dt;
      if (near(i, 45)) { acc += dt * 8; const n = acc | 0; acc -= n; if (n) { const a = rand(0, TAU); _w.set(i.wx(Math.cos(a) * 1.6, 0.1), i.y + 2.55 + Math.sin(a) * 1.6, i.wz(Math.cos(a) * 1.6, 0.1)); i.burst('glow', c, _w, n, 0.3); } }
      const dx = H.head.x - i.x, dz = H.head.z - i.z, lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY, hy = H.head.y - i.y;
      if (rec.cd <= 0 && Math.abs(lx) < 1.5 && Math.abs(lz) < 0.5 && hy > 0.3 && hy < 4.3) {
        const list = H.S.portals; const idx = list.indexOf(rec); let dest = null;
        for (let k = 1; k < list.length; k++) { const q = list[(idx + k) % list.length]; if (q && !q.inst.removed) { dest = q; break; } }
        if (dest) {
          const di = dest.inst, front = di.at(0, 2.2), P = H.playerApi();
          rec.cd = dest.cd = 3;
          if (P) P.teleport(front.x, front.z);
          i.snd().tone({ freq: 200, freqEnd: 900, dur: 0.6, type: 'sine', vol: 0.3 }); i.snd().noise({ dur: 0.6, filter: { type: 'bandpass', freq: 500, freqEnd: 3000, q: 1 }, vol: 0.3 });
          _w.set(front.x, di.y + 1.6, front.z); di.burst('glow', c, _w, 30, 1.6); di.burst('spark', c2, _w, 20, 1.2);
        } else if (whoosh <= 0) { whoosh = 6; i.snd().tone({ freq: 300, freqEnd: 180, dur: 0.5, type: 'sine', vol: 0.12, at: { x: i.x, y: i.y + 2, z: i.z } }); H.ctx.hud?.show('The portal shimmers... it needs a partner portal.', 2.5); }
      }
      whoosh -= dt;
    });
  }, { size: 2.5 });

  def('fountain', 'three-tier stone fountain with real water spray arcing into the basin, a gentle splashing sound and a shimmering pool', 'scale', ['water fountain', 'plaza fountain', 'fountains', 'water feature', 'spring', 'water spout'], (i, o) => {
    const b = H.mk();
    b.cyl(0, -0.8, 0, 2.3, 2.45, 1.7, 0x9a968c, 0, 16); b.cyl(0, 0.85, 0, 2.5, 2.4, 0.18, 0xaaa69c, 0, 16);
    b.cyl(0, 0.0, 0, 0.5, 0.65, 1.2, 0x8a867c, 0, 10); b.cyl(0, 1.2, 0, 1.2, 0.45, 0.35, 0xaaa69c, 0, 14); b.cyl(0, 1.5, 0, 1.25, 1.25, 0.1, 0xb4b0a4, 0, 14);
    b.cyl(0, 1.5, 0, 0.22, 0.3, 1.1, 0x8a867c, 0, 10); b.cyl(0, 2.55, 0, 0.7, 0.3, 0.25, 0xaaa69c, 0, 12); b.cyl(0, 2.8, 0, 0.12, 0.12, 0.5, 0x8a867c, 0, 8); b.sph(0, 3.4, 0, 0.14, 0.14, 0.14, 0xd9a93c);
    b.mode('ghost'); b.cylc(0, 0.84, 0, 2.2, 2.2, 0.03, 0x5ab0d8, 0, 20); b.cylc(0, 1.52, 0, 1.1, 1.1, 0.03, 0x5ab0d8, 0, 14); b.mode('solid');
    if (!o.noStatic) { i.add(b.build()); blk.cyl(i, 0, 0, 2.4, 3.4, { gone: anyBroken(i), steer: true }); }
    const sp = i.fx({ count: 300, color: [0xdff4ff, 0x6ab8e8], size: [0.1, 0.05], life: [1.5, 2.2], speed: [0, 0.35], gravity: 9.5, drag: 0.05, alpha: 0.8, additive: false });
    const mist = i.fx({ count: 50, color: [0xffffff, 0xcfeeff], size: [0.15, 0.5], life: [0.5, 1.0], speed: [0.2, 0.6], gravity: -0.2, drag: 1, alpha: 0.35, additive: false });
    const top = new THREE.Vector3(), v = new THREE.Vector3(), TY = o.topY ?? 3.5, SK = o.sprayK ?? 1;
    let acc = 0, ns = 0;
    i.tick((dt, t) => {
      if (!near(i, 55)) return;
      acc += dt * 60; const n = acc | 0; acc -= n;
      if (sp && n) for (let k = 0; k < n; k++) {
        const a = rand(0, TAU);
        if (k % 3) { v.set(Math.cos(a) * rand(0.4, 1.4) * SK, rand(5.8, 7.4) * SK, Math.sin(a) * rand(0.4, 1.4) * SK); top.set(i.x, i.y + TY, i.z); }
        else { v.set(Math.cos(a) * rand(1.2, 2.0) * SK, rand(3.2, 4.4) * SK, Math.sin(a) * rand(1.2, 2.0) * SK); top.set(i.x, i.y + TY * 0.47, i.z); }
        sp.emit(top, 1, v);
      }
      if (mist && Math.random() < dt * 8) { _w.set(i.x + rand(-1.2, 1.2), i.y + 0.95, i.z + rand(-1.2, 1.2)); mist.emit(_w, 1, _up); }
      ns -= dt; if (ns < 0 && near(i, 22)) { ns = 0.9; i.snd().noise({ dur: 1.1, filter: { type: 'bandpass', freq: 1800, q: 0.7 }, vol: 0.06, attack: 0.25, at: { x: i.x, y: i.y + 1, z: i.z } }); }
    });
  }, { size: 2.8 });

  def('dock', 'wooden pier reaching out over a small lake, with posts, ropes, barrels and a moored rowboat', 'length, scale', ['pier', 'jetty', 'wharf', 'boat dock', 'harbour', 'harbor', 'docks', 'landing'], (i, o) => {
    const L = clamp(o.length ?? 8, 4, 16), b = H.mk(), wy = 0.05;
    for (let k = 0; k < L * 2; k++) b.box((k % 3 - 1) * 0.02, 0.3, k * 0.5 + 0.25, 1.9, 0.1, 0.46, pick([0x8a6a40, 0x7a5a38, 0x96734a, 0x6a4a2a]));
    for (const sx of [-1, 1]) for (let k = 0; k <= L / 2; k++) { b.cyl(sx * 0.98, -1.4, k * 2, 0.11, 0.12, 2.1, WOODD, 0, 6); if (k < L / 2) b.box(sx * 0.98, 0.2, k * 2 + 1, 0.12, 0.14, 2.0, WOODD); }
    b.box(0, 0.1, 0.5, 2.3, 0.18, 0.4, 0x6e6a64);
    for (const [x, z] of [[-0.8, L - 0.3], [0.8, L - 0.3]]) { b.cyl(x, 0.3, z, 0.09, 0.1, 0.4, 0x3a2a1a, 0, 6); b.sph(x, 0.72, z, 0.1, 0.07, 0.1, 0x3a2a1a); }
    b.cyl(-0.65, 0.35, L * 0.4, 0.28, 0.3, 0.7, 0x6a4a2a, 0, 9); b.cyl(-0.4, 0.35, L * 0.4 + 0.6, 0.26, 0.28, 0.65, 0x7a5a32, 0, 9); b.box(0.55, 0.65, L * 0.55, 0.6, 0.6, 0.6, 0x8a6a3a); b.box(0.55, 1.15, L * 0.55, 0.45, 0.4, 0.45, 0x7a5a32);
    b.box(0, 0.75, 0.7, 0.04, 0.9, 0.04, WOODD);
    i.add(b.build());
    const wb = H.mk(); wb.mode('ghost'); wb.cylc(0, 0, 0, 1, 1, 0.03, 0x4a9ab0, 0, 22);
    const w = wb.build({ own: true }); w.scale.set(L * 0.65, 1, L * 0.65); w.position.set(0, wy, L * 0.6); i.add(w);
    if (o.noBoat) return;
    const bt = H.mk(); bt.box(0, 0.0, 0, 1.2, 0.35, 2.8, 0x7a5230); bt.box(0, 0.25, -1.3, 1.0, 0.2, 0.2, 0x6a4a2a); bt.box(0, 0.05, 0, 1.0, 0.1, 2.4, 0x96734a); bt.box(0.3, 0.25, 0.3, 0.05, 0.08, 1.4, 0x4a2e1a); bt.box(-0.3, 0.25, 0.3, 0.05, 0.08, 1.4, 0x4a2e1a);
    const boat = bt.build(); boat.position.set(1.8, wy + 0.1, L * 0.5); boat.rotation.y = 0.1; i.add(boat);
    i.tick((dt, t) => { boat.position.y = wy + 0.1 + Math.sin(t * 1.2) * 0.04; boat.rotation.z = Math.sin(t * 0.9) * 0.03; boat.rotation.x = Math.sin(t * 1.1) * 0.02; });
  }, { size: 5, keepOut: 6 });

  def('fence', 'wooden fence line with pointed posts and two rails that follows the ground; option length (default 8 m)', 'length', ['wooden fence', 'picket fence', 'paddock', 'fences', 'railing', 'palisade', 'stockade'], (i, o) => {
    const L = clamp(o.length ?? 8, 1.5, 60), n = Math.max(1, Math.round(L / 1.5)), b = H.mk(), y0 = i.y;
    let px = -L / 2, py = i.gy(-L / 2, 0) - y0;
    for (let k = 0; k <= n; k++) {
      const x = -L / 2 + (k / n) * L, g = i.gy(x, 0) - y0;
      b.box(x, g + 0.55, 0, 0.14, 1.2, 0.14, pick([0x7a5230, 0x6a4a2a, 0x8a6238])); b.cone(x, g + 1.15, 0, 0.09, 0.14, 0x7a5230, 0, 4);
      if (k > 0) { const dx = x - px, dy = g - py, len = Math.hypot(dx, dy), a = Math.atan2(dy, dx); for (const hh of [0.4, 0.85]) b.box((x + px) / 2, (g + py) / 2 + hh, 0.0, len, 0.1, 0.07, 0x8a6a40, [0, 0, a]); }
      px = x; py = g;
    }
    i.add(b.build());
    runBlock(i, L, 1.25, 0.2, { gone: anyBroken(i) });
  }, { size: 3, spacing: 4, face: 'random' });

  def('signpost', 'wooden signpost with arrow boards; give text (use | for several boards, e.g. "Village|Danger!")', 'text', ['sign', 'sign post', 'road sign', 'direction sign', 'billboard', 'notice', 'signs', 'arrow sign', 'waypoint'], (i, o) => {
    const texts = String(o.text ?? 'This way').split('|').slice(0, 4), b = H.mk();
    b.cyl(0, 0, 0, 0.09, 0.12, 2.6, WOODD, 0, 6); b.sph(0, 2.65, 0, 0.11, 0.11, 0.11, WOODD);
    const n = texts.length;
    texts.forEach((t, k) => {
      const y = 2.1 - k * 0.5, ry = (k % 2 ? 0.25 : -0.2) + k * 0.1 + (n > 1 ? (k - (n - 1) / 2) * 0.45 : 0), w = clamp(0.5 + t.length * 0.075, 0.9, 2.4);
      b.push(0, y, 0, ry); b.box(w / 2 + 0.05, 0, 0.1, w, 0.36, 0.06, pick([0x96734a, 0x8a6a40])); b.prism(w + 0.05, 0.0, 0.1, 0.36, 0.2, 0.06, 0x96734a, [0, 0, -PI / 2]); b.pop();
    });
    i.add(b.build());
    texts.forEach((t, k) => {
      const y = 2.1 - k * 0.5, ry = (k % 2 ? 0.25 : -0.2) + k * 0.1 + (n > 1 ? (k - (n - 1) / 2) * 0.45 : 0), w = clamp(0.5 + t.length * 0.075, 0.9, 2.4);
      const p = i.at(Math.cos(ry) * (w / 2 + 0.05), -Math.sin(ry) * (w / 2 + 0.05) + 0.16);
      (i.labels ??= []).push(i.label(t.trim(), { size: 0.12, color: 0x2a1a0a, background: false, position: { x: p.x, y: i.y + y - 0.12, z: p.z }, maxWidth: 480 }));
    });
  }, { size: 0.8 });

  def('throne', 'ornate golden throne on a three-step dais with red cushions, gem inlays and two banners', 'color', ['king throne', 'royal throne', 'chair of kings', 'seat of power', 'thrones'], (i, o) => {
    const gold = o.color ?? 0xd9a93c, b = H.mk();
    b.cyl(0, -0.4, 0, 2.6, 2.7, 0.8, 0x7a766e, 0, 10); b.cyl(0, 0.35, 0, 2.2, 2.4, 0.35, 0x8a867c, 0, 10); b.cyl(0, 0.7, 0, 1.7, 1.9, 0.35, 0x9a968c, 0, 10);
    b.box(0, 1.2, 0, 1.0, 0.1, 0.9, 0xa01a2a, 0); b.box(0, 0.95, 0, 1.2, 0.4, 1.0, gold);
    b.box(0, 2.4, -0.45, 1.3, 2.7, 0.2, gold); b.box(0, 2.35, -0.33, 1.05, 2.4, 0.08, 0xa01a2a); b.prism(0, 3.7, -0.45, 1.3, 0.8, 0.2, gold);
    b.mode('glow'); b.sph(0, 4.15, -0.4, 0.1, 0.1, 0.1, 0xff3a5a); b.sph(-0.45, 3.2, -0.33, 0.06, 0.06, 0.06, 0x58e6ff); b.sph(0.45, 3.2, -0.33, 0.06, 0.06, 0.06, 0x58e6ff); b.mode('solid');
    for (const s of [-1, 1]) { b.box(s * 0.65, 1.55, 0, 0.18, 0.5, 0.9, gold); b.sph(s * 0.65, 1.85, 0.35, 0.14, 0.14, 0.14, gold); b.box(s * 0.65, 1.15, 0.0, 0.18, 0.4, 0.9, gold); }
    for (let k = 0; k < 5; k++) b.sph((k - 2) * 0.22, 1.28, 0.47, 0.06, 0.06, 0.06, gold);
    for (const s of [-1, 1]) { b.cyl(s * 2.8, 0, -0.6, 0.07, 0.09, 4.2, 0x3e2a18, 0, 6); b.sph(s * 2.8, 4.25, -0.6, 0.1, 0.1, 0.1, gold); }
    i.add(b.build());
    for (const s of [-1, 1]) { const g = new THREE.Group(); g.position.set(s * 2.8 - 0.5 * 0, 4.0, -0.6); i.add(g); const fb = H.mk(); fb.mode('cloth'); fb.box(0, -0.9, 0, 0.85, 1.8, 0.03, 0xa01a2a); fb.box(0, -0.55, 0.02, 0.4, 0.4, 0.03, gold); fb.cone(0, -2.1, 0, 0.42, 0.2, 0xa01a2a, PI, 4); g.add(fb.build({ own: true })); g.position.x = s * 2.8; g.userData.ph = s; i.tick((dt, t) => { g.rotation.x = Math.sin(t * 1.4 + g.userData.ph) * 0.05; }, { every: 0.05 }); }
  }, { size: 3, keepOut: 3.5 });

  def('arena', 'circular fighting arena: sandy floor, stone ring wall with two gates, stepped seats and eight flaming torches; great place for a wave', 'radius', ['colosseum', 'coliseum', 'fighting pit', 'gladiator arena', 'ring', 'battle arena', 'arenas', 'pit', 'stadium'], (i, o) => {
    const R = clamp(o.radius ?? 11, 6, 24), b = H.mk(), seg = 28, fy = 0.45;
    b.cyl(0, -1.2, 0, R + 0.2, R + 0.3, 1.2 + fy, 0xb89a68, 0, 28);
    b.cyl(0, fy - 0.02, 0, R - 0.6, R - 0.6, 0.04, 0xcdb27c, 0, 28);
    b.tor(0, fy + 0.0, 0, R * 0.45, 0.05, 0x8a6a40, [PI / 2, 0, 0], 28);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU, am = a + TAU / seg / 2, gate = Math.abs(wrapPi(am)) < 0.17 || Math.abs(wrapPi(am - PI)) < 0.17;
      if (gate) continue;
      const x = Math.cos(am) * R, z = Math.sin(am) * R, w = TAU * R / seg + 0.1;
      b.box(x, 1.0, z, w, 2.4, 1.0, stone(), [0, -am + PI / 2, 0]);
      b.box(Math.cos(am) * (R + 0.9), 0.7, Math.sin(am) * (R + 0.9), w, 1.6, 0.9, 0x76726c, [0, -am + PI / 2, 0]);
      b.box(Math.cos(am) * (R + 1.7), 0.4, Math.sin(am) * (R + 1.7), w, 1.0, 0.9, 0x6e6a64, [0, -am + PI / 2, 0]);
      if (k % 2 === 0) b.box(x, 2.45, z, w * 0.55, 0.5, 1.1, 0x8a8680, [0, -am + PI / 2, 0]);
    }
    for (const g of [0, PI]) for (const s of [-1, 1]) { const x = Math.cos(g) * R + Math.cos(g + PI / 2) * s * 1.7, z = Math.sin(g) * R + Math.sin(g + PI / 2) * s * 1.7; b.box(x, 1.8, z, 1.1, 3.6, 1.3, 0x8a8680, [0, -g + PI / 2, 0]); }
    for (const g of [0, PI]) { const x = Math.cos(g) * R, z = Math.sin(g) * R; b.box(x, 3.7, z, 4.6, 0.6, 1.3, 0x7a766e, [0, -g + PI / 2, 0]); }
    if (!o.noStatic) { // ring wall + seating as 26 oriented boxes (the two gates stay open: 2.3 m between the gate pillars)
      for (let k = 0; k < seg; k++) {
        const am = (k / seg) * TAU + TAU / seg / 2;
        if (Math.abs(wrapPi(am)) < 0.17 || Math.abs(wrapPi(am - PI)) < 0.17) continue;
        blk.box(i, Math.cos(am) * (R + 0.85), Math.sin(am) * (R + 0.85), TAU * R / seg + 0.1, 2.8, 2.5, { yaw: -am + PI / 2, gone: anyBroken(i) });
      }
      for (const g of [0, PI]) for (const s of [-1, 1]) blk.box(i, Math.cos(g) * R + Math.cos(g + PI / 2) * s * 1.7, Math.sin(g) * R + Math.sin(g + PI / 2) * s * 1.7, 1.1, 1.3, 3.7, { yaw: -g + PI / 2, gone: anyBroken(i) });
    }
    const torches = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + PI / 8, x = Math.cos(a) * (R - 0.9), z = Math.sin(a) * (R - 0.9); b.cyl(x, 0, z, 0.06, 0.08, 2.1, 0x3e2a18, 0, 6); b.cyl(x, 2.1, z, 0.2, 0.1, 0.16, 0x2a2e36, 0, 7); torches.push([x, z]); }
    b.mode('glow'); for (const [x, z] of torches) b.cone(x, 2.26, z, 0.1, 0.3, 0xffa030, 0, 5);
    b.mode('cloth'); for (const g of [PI / 2, -PI / 2]) { const x = Math.cos(g) * (R - 0.4), z = Math.sin(g) * (R - 0.4); b.box(x, 3.2, z, 1.0, 2.2, 0.04, 0xa01a2a, [0, -g, 0]); }
    if (!o.noStatic) i.add(b.build());
    const L1 = i.light({ color: 0xff9040, intensity: 22, distance: R * 1.6, flicker: 0.4, position: { x: i.x + R * 0.4, y: i.y + 2.2, z: i.z } }), L2 = i.light({ color: 0xff9040, intensity: 22, distance: R * 1.6, flicker: 0.4, position: { x: i.x - R * 0.4, y: i.y + 2.2, z: i.z } });
    const wt = torches.map(([x, z]) => ({ x: i.x + x * Math.cos(i.yaw) + z * Math.sin(i.yaw), z: i.z - x * Math.sin(i.yaw) + z * Math.cos(i.yaw) }));
    let acc = 0;
    i.tick((dt) => { if (!near(i, R + 40)) return; acc += dt * 12; const n = acc | 0; acc -= n; for (let k = 0; k < n; k++) { const t = wt[(Math.random() * wt.length) | 0]; _w.set(t.x, i.y + 2.4, t.z); i.burst('fire', 0xff7a1a, _w, 1, 0.5); } });
  }, { size: 12.5, keepOut: 3, distance: 14, face: 'none' });
  const wrapPi = (a) => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };

  def('dungeon-entrance', 'rocky mound with a skull-crowned stone arch, a black doorway and steps up to it; green wisps drift out and a low rumble rolls from within', 'scale', ['dungeon', 'cave entrance', 'cave', 'crypt entrance', 'catacombs', 'mine entrance', 'underworld door', 'stairs down', 'lair'], (i, o) => {
    const b = H.mk();
    for (let k = 0; k < 14; k++) { const a = rand(-PI * 0.95, PI * 0.95) + PI / 2, r = rand(3, 5), h = rand(1.2, 3.2); b.dod(Math.cos(a) * r, h * 0.35 - 0.5, -Math.sin(a) * r * 0.9 - 1.0, rand(1.1, 2.0), h * 0.5, rand(1.1, 2.0), pick([0x6e6a64, 0x5e5a54, 0x7a766e, 0x4a463f]), [rand(0, 3), rand(0, 3), 0]); }
    b.box(0, 1.4, -1.8, 7.0, 3.6, 2.4, 0x5e5a54);
    for (const s of [-1, 1]) { b.box(s * 1.5, 1.6, 0, 0.9, 3.2, 1.2, 0x7a766e); b.box(s * 1.5, 0.2, 0, 1.2, 0.4, 1.5, 0x6a665e); }
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * PI; b.box(Math.cos(a) * 1.5, 3.2 + Math.sin(a) * 0.9, 0, 0.9, 0.7, 1.2, 0x7a766e, [0, 0, a]); }
    b.box(0, 4.35, 0.1, 0.9, 0.6, 1.3, 0x8a867c);
    b.sph(0, 4.9, 0.1, 0.32, 0.3, 0.28, 0xe6dfc8); b.box(0, 4.64, 0.3, 0.2, 0.12, 0.12, 0xe6dfc8); b.mode('glow'); b.box(0.12, 4.95, 0.34, 0.1, 0.1, 0.04, 0xff3a2a); b.box(-0.12, 4.95, 0.34, 0.1, 0.1, 0.04, 0xff3a2a); b.mode('solid');
    b.box(0, 1.5, -0.5, 2.1, 3.0, 0.4, 0x050505);
    b.box(0, 0.25, 0.0, 3.6, 0.5, 2.0, 0x5a564f);
    for (let k = 0; k < 3; k++) b.box(0, ((k + 1) * 0.16) / 2, 2.15 - k * 0.45, 2.8 - k * 0.2, (k + 1) * 0.16, 0.5, shade(0x6a665e, 1 - k * 0.1));
    for (const s of [-1, 1]) { b.cyl(s * 2.3, 0, 1.2, 0.06, 0.08, 1.6, 0x3e2a18, 0, 6); b.mode('glow'); b.cone(s * 2.3, 1.62, 1.2, 0.12, 0.35, 0x7affc8, 0, 5); b.mode('solid'); }
    for (const s of [-1, 1]) { b.sph(s * 2.6, 0.2, 1.8, 0.2, 0.18, 0.2, 0xe6dfc8); b.sph(s * 2.3, 0.15, 2.2, 0.18, 0.16, 0.18, 0xe0d8c0); }
    if (!o.noStatic) {
      i.add(b.build());
      blk.box(i, 0, -2.2, 8.4, 3.2, 3.6, { gone: anyBroken(i), steer: true }); // the rocky mound; the doorway itself (between the two pillars) stays open
      for (const s of [-1, 1]) blk.box(i, s * 1.5, 0, 0.95, 1.2, 4.6, { gone: anyBroken(i) });
    }
    const L = i.light({ color: 0x7affc8, intensity: 14, distance: 10, flicker: 0.5, position: { x: i.x, y: i.y + 1.8, z: i.z } });
    let acc = 0, rum = rand(2, 6);
    i.tick((dt, t) => {
      if (!near(i, 50)) return;
      acc += dt * 4; const n = acc | 0; acc -= n; if (n) { const p = i.at(rand(-0.8, 0.8), 0.2); _w.set(p.x, i.y + 0.4, p.z); i.burst('glow', 0x7affc8, _w, n, 0.5, _up); }
      rum -= dt; if (rum < 0 && near(i, 20)) { rum = rand(9, 16); i.snd().tone({ freq: 55, freqEnd: 40, dur: 2.5, type: 'sine', vol: 0.25, at: { x: i.x, y: i.y + 0.5, z: i.z } }); i.snd().noise({ dur: 2.2, filter: { type: 'lowpass', freq: 200, freqEnd: 90 }, vol: 0.2, at: { x: i.x, y: i.y + 0.5, z: i.z } }); }
    }, { every: 0.1 });
  }, { size: 5, keepOut: 5 });

  // ================================================================================================================
  // MODEL BUILDS (world.models). The primitive builders above remain the fallback; see modelkit.js for the contract.
  // ================================================================================================================
  const TEAM = ['red', 'blue', 'green', 'yellow'];
  const team = (o) => (o && o.color !== undefined ? TEAM[Math.abs(Number(o.color) | 0) % 4] : pick(TEAM));

  const HOUSE_RUBBLE = [{ name: 'destroyed', scale: 0.55 }, 'debris'];
  // a tall tower that can lose its top: `full` is the whole tower, `stump` a shorter model of the same family that is revealed when the top is blown off.
  // Two kit.structure parts: base (supports nothing) and top (supports: base) - hit the base and the whole tower comes down, hit the top and only it goes.
  function towerParts(i, full, stump, o = {}) {
    stump.obj.visible = false;
    let lowerGone = false;
    const mat = o.material ?? 'stone';
    const S = mx.structure(i, [
      { items: [stump], frac: [0, 0.8], material: mat, hp: o.hpBase ?? 240, rubble: o.rubble ?? 'rock-large-a', onBreak() { lowerGone = true; } },
      { items: [full], frac: [0.5, 1], material: mat, hp: o.hpTop ?? 120, supports: [0], rubble: o.rubble ?? 'rock-large-a', onBreak() { if (!lowerGone) stump.obj.visible = true; if (o.onTop) o.onTop(); } },
    ]);
    blk.piece(i, full, { shape: o.shape ?? 'box', inset: o.inset ?? 0.9, h: Math.min(full.size.y, 12), steer: true, gone: () => lowerGone }); // the base stands until it falls; the stump keeps blocking after the top is shot off
    return S;
  }
  // a simple chimney-smoke wisp at a point local to a model piece (x,z in instance space)
  const chimney = (i, p, fx, fy, fz) => smoke(i, p.x + fx, p.size.y * fy, p.z + fz, 2.0);

  mx.model('well', {
    model(P, o) { P(`well-${team(o)}`, { anchor: 'center', scale: 0.8 }); },
    after(pieces) { blk.piece(pieces[0].inst, pieces[0], { shape: 'cyl', inset: 0.9, steer: true }); },
    destruct: { kind: 'break', material: 'stone', hp: 70, stages: 'auto', rubble: ['rock-small-a', 'rock-small-b'] },
  });
  mx.model('hut', {
    model(P, o) { P(`home-a-${team(o)}`, { anchor: 'center', scale: 0.72 }); },
    after(pieces) { blk.piece(pieces[0].inst, pieces[0], { inset: 0.88, steer: true }); },
    destruct: { kind: 'break', material: 'wood', hp: 90, stages: 'auto', rubble: [{ name: 'destroyed', scale: 0.4 }, 'debris'] },
  });
  mx.model('cottage', {
    model(P, o) { const kind = o.style ?? pick(['home-a', 'home-b']); return { p: P(`${kind}-${team(o)}`, { anchor: 'center' }) }; },
    after(pieces, plan) { const p = plan.p; chimney(p.inst, p, -0.18 * p.size.x, 0.97, 0.1 * p.size.z); blk.piece(p.inst, p, { inset: 0.88, steer: true }); },
    destruct: { kind: 'break', material: 'wood', hp: 140, stages: 'auto', rubble: HOUSE_RUBBLE },
  });
  mx.model('watchtower', {
    model(P, o) { const t = team(o); return { full: P(`tower-b-${t}`, { anchor: 'center', scale: 0.85 }), stump: P(`tower-base-${t}`, { anchor: 'center', scale: 0.85 }) }; },
    after(pieces, plan, o) { towerParts(plan.full.inst, plan.full, plan.stump, { material: 'stone', hpBase: 260, hpTop: 120 }); },
    destruct: { kind: 'none', primitive: { kind: 'break', material: 'wood', hp: 220, stages: 'auto' } },
  });
  mx.model('castle-tower', {
    model(P, o) {
      if (o.roof === false) return { solo: P('tower-complete-small', { anchor: 'center' }) };
      return { full: P('tower-complete-large', { anchor: 'center' }), stump: P('tower-complete-small', { anchor: 'center', scale: 1.08 }) };
    },
    after(pieces, plan) {
      if (plan.solo) { mx.breakable(plan.solo.inst, [plan.solo], { material: 'stone', hp: 320, stages: 'auto', rubble: 'rock-large-a' }); blk.piece(plan.solo.inst, plan.solo, { shape: 'cyl', inset: 0.92, steer: true }); }
      else towerParts(plan.full.inst, plan.full, plan.stump, { material: 'stone', hpBase: 320, hpTop: 150, shape: 'cyl', inset: 0.92 });
    },
    destruct: { kind: 'none', primitive: { kind: 'break', material: 'stone', hp: 360, stages: 'auto' } },
  });
  mx.model('wall-segment', {
    build(i, o, fb) {
      const L = clamp(o.length ?? 8, 2, 40), n = Math.max(1, Math.round(L / 6)), seg = L / n, sx = seg / 10, sy = clamp(sx, 0.55, 0.75);
      const items = [];
      for (let k = 0; k < n; k++) { const x = -L / 2 + (k + 0.5) * seg; items.push({ name: 'wall-straight', x, z: 0, sx, sy, sz: sy * 0.9, yaw: 0, y: i.gy(x, 0) - i.y - 0.15 }); }
      const sc = mx.scatterOr(i, items, { breakable: () => ({ material: 'stone', hp: 170, colors: [{ hex: 0x8a93a3, w: 0.6 }, { hex: 0x6c7482, w: 0.4 }] }) }, fb);
      if (sc) for (const s of items) blk.item(i, s, { sc, inset: 0.96 }); // one solid wall box per section (the colliders are ours: kit's block:true would drop onto the player)
    },
    destruct: { kind: 'break', material: 'stone', hp: 200, stages: 'auto' }, // primitive wall: one destructible
  });
  mx.model('market-stall', {
    model(P, o) {
      const s = P(pick(['stall-red', 'stall-green']), { anchor: 'center', scale: 0.62 });
      P('box-small', { x: -1.3, z: 0.4, yaw: 0.4, scale: 0.7 }); P('barrel-small', { x: 1.5, z: 0.5, yaw: 1, scale: 0.8 }); P('crate-b-small', { x: 1.2, z: -0.6, yaw: 0.2, scale: 1 }); P('sack', { x: -1.5, z: -0.5, yaw: 0.8 });
      return { s };
    },
    after(pieces, plan) { blk.piece(plan.s.inst, plan.s, { inset: 0.92, h: Math.min(plan.s.size.y, 2.4), steer: true }); },
    destruct: { kind: 'break', material: 'wood', hp: 70, stages: 'auto', rubble: [{ name: 'debris', scale: 0.8 }] },
  });
  mx.model('tent', {
    model(P, o) { const p = P(pick(['tent-detailed-open', 'tent-detailed-closed']), { anchor: 'center', scale: 1.1 }); return { p, color: o.color }; },
    after(pieces, plan) { if (plan.color !== undefined) plan.p.tint(plan.color); },
    destruct: { kind: 'break', material: 'cloth', hp: 28, stages: [{ at: 0.5, drop: 2 }] },
  });
  mx.model('campsite', {
    model(P, o, i) {
      const tent = P('tent-detailed-open', { x: -2.4, z: -1.2, yaw: 0.5, anchor: 'center', scale: 1.15 });
      P('campfire-stones', { x: 1.4, z: 0.9, scale: 0.7, anchor: 'center' }); P('campfire-logs', { x: 1.4, z: 0.9, scale: 1.1, anchor: 'center' });
      const seats = [0.9, 3.0, 5.1].map((a, k) => P(k % 2 ? 'stump-round' : 'stump-square', { x: 1.4 + Math.cos(a) * 2.3, z: 0.9 + Math.sin(a) * 2.3, yaw: -a, scale: 0.8, anchor: 'center' }));
      P('bedroll', { x: -0.4, z: 2.6, yaw: 0.4, anchor: 'center' }); const crate = P('survival-box-large', { x: 0.9, z: 3.2, yaw: 0.3, anchor: 'center' }); const barrel = P('survival-barrel', { x: -1.6, z: 3.0, anchor: 'center' }); P('pot-small', { x: 3.3, z: 0.1, anchor: 'center' });
      return { tent, seats, crate, barrel, i };
    },
    after(pieces, plan, o, fb) {
      fb(plan.i, { ...o, noStatic: true }, 0); // crackling fire, light, sparks, hot embers (the primitive builder's behaviour parts)
      mx.breakable(plan.i, [plan.tent], { material: 'cloth', hp: 30 });
      for (const s of plan.seats) mx.breakable(plan.i, [s], { material: 'wood', hp: 30 });
      mx.breakable(plan.i, [plan.crate], { material: 'wood', hp: 14 }); mx.breakable(plan.i, [plan.barrel], { material: 'wood', hp: 18 });
    },
    destruct: { kind: 'none', primitive: { kind: 'break', material: 'cloth', hp: 60 } },
  });
  mx.model('windmill', {
    model(P, o, i) { return { p: P(`windmill-${team(o)}`, { anchor: 'center' }), i }; },
    after(pieces, plan) {
      const i = plan.i, sp = mx.spinPart(i, plan.p, (x, y, z) => z > 0.30 && y > 0.45, [0, 0.957, 0.37]); // the fused sails become their own rotating mesh
      blk.piece(i, plan.p, { shape: 'cyl', inset: 0.6, h: Math.min(plan.p.size.y, 9), steer: true }); // the tower body only (the footprint includes the sails' plane)
      let spin = rand(0, 6);
      if (sp.moved) i.tick((dt) => { if (i.broken) return true; spin += dt * (0.25 + (H.ctx.world.env?.wind ?? 0.5) * 1.1); sp.pivot.rotation.z = spin; });
    },
    destruct: { kind: 'break', material: 'wood', hp: 180, stages: 'auto', rubble: [{ name: 'destroyed', scale: 0.6 }] },
  });
  mx.model('lighthouse', {
    model(P, o, i) { return { p: P(`tower-base-${team(o)}`, { anchor: 'center', scale: 1.25 }), i }; },
    after(pieces, plan) {
      const i = plan.i, p = plan.p, Y = p.obj.position.y + p.size.y, cx = p.x, cz = p.z;
      blk.piece(i, p, { shape: 'cyl', inset: 0.9, h: p.size.y + 3, steer: true });
      const b = H.mk();
      b.cyl(cx, Y - 0.1, cz, 1.9, 1.7, 0.35, 0x2a2e36, 0, 14); b.tor(cx, Y + 0.3, cz, 1.75, 0.05, 0x2a2e36, [PI / 2, 0, 0], 14);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; b.box(cx + Math.cos(a) * 1.7, Y + 0.45, cz + Math.sin(a) * 1.7, 0.06, 0.8, 0.06, 0x2a2e36); }
      b.cyl(cx, Y + 0.2, cz, 0.95, 0.95, 1.7, 0x2a2e36, 0, 10); b.mode('ghost'); b.cyl(cx, Y + 0.3, cz, 0.85, 0.85, 1.45, 0xbfeaff, 0, 10); b.mode('solid');
      b.cone(cx, Y + 1.85, cz, 1.2, 1.1, 0xc83a3a, 0, 10); b.sph(cx, Y + 3.0, cz, 0.1, 0.1, 0.1, 0xd9a93c); b.mode('glow'); b.sph(cx, Y + 1.0, cz, 0.32, 0.32, 0.32, 0xfff2b0);
      const top = b.build(); i.add(top); plan.lantern = top;
      const bm = H.mk(); bm.mode('beam');
      for (const s of [-1, 1]) bm.cone(0, 0, s * 22, 1.6, 22, 0xfff0a0, [s > 0 ? -PI / 2 : PI / 2, 0, 0], 10);
      const beam = bm.build({ own: true }); beam.position.set(cx, Y + 1.0, cz); i.add(beam);
      const w = i.at(cx, cz); i.light({ color: 0xffe9a0, intensity: 28, distance: 22, position: { x: w.x, y: i.y + Y + 1.0, z: w.z } });
      i.tick((dt) => { beam.rotation.y += dt * 0.9; beam.visible = !i.broken; });
    },
    destruct: { kind: 'break', material: 'stone', hp: 300, stages: 'auto', rubble: [{ name: 'rubble-large', scale: 0.7 }] },
  });
  mx.model('ruins', {
    build(i, o, fb) {
      const items = [], g = (x, z) => i.gy(x, z) - i.y;
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) items.push({ name: 'floor-tile-large', x, z, y: g(x, z) - 0.05, yaw: PI / 2 * ((Math.random() * 4) | 0) });
      items.push({ name: 'wall-broken', x: 0, z: -3.6, yaw: 0 }, { name: 'wall-cracked', x: -3.7, z: -0.6, yaw: PI / 2 }, { name: 'wall-half', x: 3.7, z: 0.8, yaw: -PI / 2 }, { name: 'wall-endcap', x: 2.2, z: 3.6, yaw: PI });
      items.push({ name: 'column', x: -3.2, z: 3.2, scale: 1.1 }, { name: 'column', x: 3.3, z: -3.3, scale: 1.3 }, { name: 'pillar', x: -3.0, z: -3.3, yaw: 0.4, scale: 0.9 }, { name: 'column', x: 0.4, z: 3.9, scale: 0.8 });
      items.push({ name: 'rubble-large', x: -1.5, z: 1.0, yaw: 2, scale: 0.55 }, { name: 'rubble-large', x: 1.8, z: -0.4, yaw: 0.6, scale: 0.4 });
      for (const it of items) if (it.y === undefined) it.y = g(it.x, it.z);
      const sc = mx.scatterOr(i, items, { breakable: (s) => (/floor|rubble/.test(s.name) ? null : { material: 'stone', hp: 150, colors: [{ hex: 0x8a8f9a, w: 0.6 }, { hex: 0x666b76, w: 0.4 }] }) }, fb);
      if (sc) for (const s of items) if (/wall|column|pillar/.test(s.name)) blk.item(i, s, { sc, shape: /wall/.test(s.name) ? 'box' : 'cyl', inset: 0.9 }); // standing walls and columns stop you; floor tiles and rubble do not
    },
    destruct: { kind: 'break', material: 'stone', hp: 200 },
  });
  mx.model('stone-circle', {
    model(P, o, i) {
      const R = (o.radius ?? 5) * (o.scale ?? 1), stones = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; stones.push(P('stone-tall-a', { x: Math.cos(a) * R, z: Math.sin(a) * R, yaw: -a + PI / 2 + rand(-0.2, 0.2), scale: rand(0.42, 0.55), anchor: 'center' })); }
      P('altar-stone', { anchor: 'center', yaw: 0.5, scale: 0.9 });
      return { stones, i };
    },
    after(pieces, plan, o, fb) {
      fb(plan.i, { ...o, noStatic: true }, 0); // rune rings, motes and the hum
      for (const s of plan.stones) { const hh = mx.breakable(plan.i, [s], { material: 'stone', hp: 220, stages: 'auto' }); blk.piece(plan.i, s, { shape: 'cyl', inset: 0.7, gone: () => !hh || hh.broken }); }
    },
    destruct: { kind: 'none', primitive: { kind: 'break', material: 'stone', hp: 260 } },
  });
  mx.model('shrine', {
    model(P, o, i) { return { p: P('shrine-candles', { anchor: 'center', scale: 1.5 }), i }; },
    after(pieces, plan, o, fb) { fb(plan.i, { ...o, noStatic: true }, 0); blk.piece(plan.i, plan.p, { inset: 0.95, steer: true }); }, // floating orb, light, incense smoke, chime
    destruct: { kind: 'break', material: 'stone', hp: 140, stages: 'auto', rubble: [{ name: 'stone-large-a', scale: 0.35 }] },
  });
  mx.model('obelisk', {
    model(P, o, i) { return { p: P('pillar-obelisk', { anchor: 'center', scale: 2.6 }), c: o.color ?? pick([0x7a5cff, 0x58e6ff, 0xff6a4a, 0x7affc8]), i }; },
    after(pieces, plan) {
      const i = plan.i, p = plan.p, c = plan.c, Y = p.size.y;
      blk.piece(i, p, { shape: 'cyl', inset: 0.85, steer: true });
      const cap = H.mk(); cap.mode('glow'); cap.cone(p.x, Y - 0.1, p.z, 0.2, 0.6, c, PI / 4, 4); cap.sph(p.x, Y + 0.7, p.z, 0.12, 0.12, 0.12, c); const capM = cap.build(); i.add(capM);
      const mb = H.mk(); mb.mode('glow'); mb.sph(0, 0, 0, 0.09, 0.09, 0.09, c);
      const motes = []; for (let k = 0; k < 3; k++) { const m = mb.build({ own: true }); i.add(m); motes.push(m); }
      let hum = rand(0, 4);
      i.tick((dt, t) => {
        capM.visible = !i.broken;
        for (let k = 0; k < 3; k++) { const a = t * (0.8 + k * 0.15) + k * 2.09; motes[k].visible = !i.broken; motes[k].position.set(p.x + Math.cos(a) * 1.4, 1.5 + k * 1.5 + Math.sin(t * 1.7 + k) * 0.4, p.z + Math.sin(a) * 1.4); }
        hum -= dt; if (hum <= 0 && near(i, 22) && !i.broken) { hum = 9; i.snd().tone({ freq: 82, dur: 4.5, type: 'sine', vol: 0.12, at: { x: i.x, y: i.y + 3, z: i.z } }); }
      }, { every: 0.04 });
    },
    destruct: { kind: 'break', material: 'stone', hp: 260, stages: 'auto', rubble: [{ name: 'stone-large-a', scale: 0.5 }] },
  });
  mx.model('portal-arch', {
    model(P, o, i) { return { p: P('arch', { anchor: 'center', scale: 1.32 }), i }; },
    after(pieces, plan, o, fb) { fb(plan.i, { ...o, noStatic: true }, 0); blk.part(plan.i, plan.p, [0, 0.19], [0, 1], {}); blk.part(plan.i, plan.p, [0.81, 1], [0, 1], {}); }, // swirl, light, teleport logic; two pillars, the opening between them is the portal
    destruct: { kind: 'break', material: 'stone', hp: 300, stages: 'auto', rubble: [{ name: 'stone-large-a', scale: 0.5 }] },
  });
  mx.model('fountain', {
    model(P, o, i) { return { p: P('fountain-round-detail', { anchor: 'center', scale: 0.55 }), i }; },
    after(pieces, plan, o, fb) { fb(plan.i, { ...o, noStatic: true, topY: plan.p.size.y + 0.3, sprayK: 0.5 }, 0); blk.piece(plan.i, plan.p, { shape: 'cyl', inset: 0.97, steer: true }); },
    destruct: { kind: 'break', material: 'stone', hp: 220, stages: 'auto', rubble: [{ name: 'stone-large-a', scale: 0.5 }] },
  });
  mx.model('dock', {
    model(P, o, i) { return { boat: P('boat-row-large', { x: 1.9, z: clamp(o.length ?? 8, 4, 16) * 0.5, yaw: 0.1, y: 0.1, scale: 1 }), i }; },
    after(pieces, plan, o, fb) {
      const body = mx.captureBody(plan.i, () => fb(plan.i, { ...o, noBoat: true }, 0)); // the primitive pier (planks, posts, ropes, barrels) without its own little boat
      const b = plan.boat; plan.i.tick((dt, t) => { b.obj.position.y = b.y + Math.sin(t * 1.2) * 0.04; b.obj.rotation.z = Math.sin(t * 0.9) * 0.03; });
      mx.breakable(plan.i, [body], { material: 'wood', hp: 160, stages: 'auto' }); mx.breakable(plan.i, [b], { material: 'wood', hp: 50 });
    },
    destruct: { kind: 'none', primitive: { kind: 'break', material: 'wood', hp: 160, stages: 'auto' } },
  });
  mx.model('fence', {
    build(i, o, fb) {
      const L = clamp(o.length ?? 8, 1.5, 60), n = Math.max(1, Math.round(L / 3)), seg = L / n, items = [];
      for (let k = 0; k < n; k++) {
        const x0 = -L / 2 + k * seg, x1 = x0 + seg, g0 = i.gy(x0, 0) - i.y, g1 = i.gy(x1, 0) - i.y;
        items.push({ name: 'fence-planks', x: (x0 + x1) / 2, z: 0, y: (g0 + g1) / 2, roll: Math.atan2(g1 - g0, seg), sx: seg / 3, sy: 1.1, sz: 1.1 });
      }
      const sc = mx.scatterOr(i, items, { breakable: { material: 'wood', hp: 14, colors: [{ hex: 0x8a5a32, w: 0.7 }, { hex: 0x6b4426, w: 0.3 }] } }, fb);
      if (sc) for (const s of items) blk.item(i, s, { sc, inset: 0.98 });
    },
    destruct: { kind: 'break', material: 'wood', hp: 40 },
  });
  mx.model('arena', {
    build(i, o, fb, prim) {
      const R = clamp(o.radius ?? 11, 6, 24), items = [], seg = 4.6, n = Math.round(TAU * R / seg), aw = TAU / n;
      for (let k = 0; k < n; k++) {
        const a = k * aw + aw / 2, gate = Math.abs(wrapPi(a)) < 0.2 || Math.abs(wrapPi(a - PI)) < 0.2;
        if (gate) continue;
        const x = Math.cos(a) * R, z = Math.sin(a) * R;
        items.push({ name: 'wall-straight', x, z, y: i.gy(x, z) - i.y - 0.2, yaw: -a + PI / 2, sx: (TAU * R / n + 0.2) / 10, sy: 0.5, sz: 0.34 });
      }
      for (const g of [0, PI]) for (const s of [-1, 1]) { const x = Math.cos(g) * R + Math.cos(g + PI / 2) * s * 2.4, z = Math.sin(g) * R + Math.sin(g + PI / 2) * s * 2.4; items.push({ name: 'tower-complete-small', x, z, y: i.gy(x, z) - i.y - 0.3, scale: 0.7 }); }
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + PI / 8, x = Math.cos(a) * (R - 1.1), z = Math.sin(a) * (R - 1.1); items.push({ name: 'fire-basket', x, z, y: i.gy(x, z) - i.y, scale: 0.9 }); }
      const sc = mx.scatterOr(i, items, { breakable: (s) => (s.name === 'fire-basket' ? { material: 'metal', hp: 30 } : { material: 'stone', hp: 180, colors: [{ hex: 0x8a93a3, w: 0.6 }, { hex: 0x6c7482, w: 0.4 }] }) }, fb);
      if (!sc) return;
      for (const s of items) if (s.name === 'wall-straight') blk.item(i, s, { sc, inset: 0.96 }); else if (s.name === 'tower-complete-small') blk.item(i, s, { sc, shape: 'cyl', inset: 0.92, steer: true }); // the ring wall + gate towers; the two gates stay open
      const b = H.mk(); b.cyl(0, -1.2, 0, R + 0.2, R + 0.3, 1.65, 0xb89a68, 0, 28); b.cyl(0, 0.43, 0, R - 0.6, R - 0.6, 0.04, 0xcdb27c, 0, 28); b.tor(0, 0.45, 0, R * 0.45, 0.05, 0x8a6a40, [PI / 2, 0, 0], 28);
      i.add(b.build());
      prim(i, { ...o, noStatic: true }, 0);
    },
    destruct: { kind: 'break', material: 'stone', hp: 400 },
  });
  // ================================================================================================================
  // NEW ENTRIES (catalogue-backed, each with a small primitive fallback)
  // ================================================================================================================
  const defN = (name, description, options, aliases, fallback, spec, extra) => { def(name, description, options, aliases, fallback, extra); mx.model(name, spec); };
  // primitive stand-in: a box house / hall with a gabled roof, door and glowing windows
  function fbHall(w, d, h, wall, roof, o2 = {}) {
    return (i, o = {}) => {
      const b = H.mk(); foundation(b, w + 0.3, d + 0.3, 0.8);
      b.box(0, h / 2, 0, w, h, d, wall); b.prism(0, h, 0, w + 0.9, o2.roofH ?? h * 0.55, d + 0.8, roof);
      b.box(0, 0.95, d / 2 + 0.02, 1.0, 1.9, 0.14, WOODD);
      for (const sx of [-1, 1]) win(b, sx * w * 0.3, h * 0.6, d / 2 + 0.02, 0.5, 0.6, 0);
      if (o2.tower) { b.cyl(w * 0.3, 0, -d * 0.2, 1.1, 1.2, h + 2.5, wall, 0, 10); b.cone(w * 0.3, h + 2.5, -d * 0.2, 1.5, 2, roof, 0, 10); }
      i.add(b.build());
      if (!o.noStatic) {
        blk.box(i, 0, 0, w + 0.1, d + 0.1, h + 1.5, { gone: anyBroken(i), steer: true });
        if (o2.tower) blk.cyl(i, w * 0.3, -d * 0.2, 1.25, h + 2.5, { gone: anyBroken(i), steer: true });
      }
    };
  }
  const fbHall2 = (w, d, h, wall, roof, o2) => { const f = fbHall(w, d, h, wall, roof, o2); return (i, o) => f(i, o); };
  function fbShipPrim(len) {
    return (i, o = {}) => {
      const b = H.mk();
      b.box(0, 0.9, 0, 3.4, 1.6, len, 0x6a4a2a); b.box(0, 1.8, 0, 3.0, 0.3, len - 0.8, 0x8a6a40); b.cone(0, 0.6, -len / 2 - 0.9, 1.6, 2.4, 0x6a4a2a, [PI / 2, 0, 0], 6); b.box(0, 2.0, len / 2 - 0.4, 3.0, 1.4, 2.0, 0x5a3a20);
      b.cyl(0, 1.8, 0.4, 0.14, 0.18, 8.5, WOODD, 0, 6); b.mode('cloth'); b.box(0, 6.2, 0.5, 3.0, 3.6, 0.06, 0xf0e8d0); b.mode('solid');
      i.add(b.build());
      if (!o.noStatic) blk.box(i, 0, 0, 3.5, len + 0.4, 3.0, { gone: anyBroken(i), steer: true });
    };
  }
  const fbBoatPrim = (i) => { const b = H.mk(); b.box(0, 0.25, 0, 1.2, 0.5, 2.8, 0x7a5230); b.box(0, 0.4, -1.3, 1.0, 0.2, 0.2, 0x6a4a2a); b.box(0, 0.1, 0, 1.0, 0.1, 2.4, 0x96734a); i.add(b.build()); };
  const fbWallRunPrim = (h, th, col, key, solid = true) => (i, o) => {
    const L = clamp(o.length ?? 8, 1.5, 60), n = Math.max(1, Math.round(L / 2)), b = H.mk();
    for (let k = 0; k < n; k++) { const x = -L / 2 + (k + 0.5) * (L / n), g = i.gy(x, 0) - i.y; b.box(x, g + h / 2, 0, L / n + 0.02, h, th, k % 2 ? shade(col, 0.92) : col); }
    i.add(b.build());
    if (solid && !o.noStatic) runBlock(i, L, h, Math.max(0.25, th), { gone: anyBroken(i) });
  };
  const fbSiegePrim = (w, d, h, solid = true) => (i, o = {}) => { const b = H.mk(); b.box(0, h / 2 + 0.5, 0, w, h, d, 0x7a5230); b.box(0, h + 0.7, 0, w + 0.3, 0.3, d + 0.3, 0x5a3a20); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * w * 0.5, 0.5, sz * d * 0.4, 0.5, 0.5, 0.3, 0x3a2a1a, [0, 0, PI / 2], 8); i.add(b.build()); if (solid && !o.noStatic) blk.box(i, 0, 0, w + 0.4, d + 0.2, h + 1.0, { gone: anyBroken(i), steer: true }); };
  const bld = (base, d, after, scale = 1) => ({
    model(P, o, i) { return { p: P(`${base}-${team(o)}`, { anchor: 'center', scale }), i }; },
    after(pieces, plan, o, fb) { blk.piece(plan.i, plan.p, { inset: 0.88, steer: true }); if (after) after(pieces, plan, o, fb); },
    destruct: { kind: 'break', material: 'wood', stages: 'auto', rubble: HOUSE_RUBBLE, ...d },
  });

  defN('tavern', 'cosy timber tavern with a giant barrel for a sign, a terrace with benches and steps up to the door', 'color (team 0-3), scale, yaw', ['inn', 'pub', 'bar', 'alehouse', 'taverns'], fbHall2(5.4, 6, 4, 0xe8dcc0, 0x8a3a3a),
    bld('tavern', { hp: 220 }), { size: 4.5, keepOut: 5 });
  defN('church', 'small stone-and-timber church with a steeple, a cross on top and a tall front door; bells chime when you walk up', 'color (team 0-3), scale, yaw', ['chapel building', 'cathedral', 'parish church', 'churches', 'minster'], fbHall2(4.6, 6.4, 4.6, 0xd8d0b8, 0x8a3a3a, { tower: true }),
    bld('church', { hp: 280, material: 'stone', rubble: [{ name: 'rubble-large', scale: 0.7 }, 'debris'] }, (pieces, plan) => {
      const i = plan.i; let was = false;
      i.tick(() => { const d = Math.hypot(H.head.x - i.x, H.head.z - i.z); if (d < 7 && !was && !i.broken) { was = true; i.snd().chord([392, 523, 659], { dur: 2.4, type: 'sine', vol: 0.12, at: { x: i.x, y: i.y + 6, z: i.z }, stagger: 0.18 }); } else if (d > 14) was = false; }, { every: 0.2 });
    }), { size: 4.5, keepOut: 5 });
  defN('blacksmith-shop', 'blacksmith\'s forge: a workshop with a big stone furnace chimney, anvil and tools; the forge breathes smoke and glowing embers and clangs when you are near', 'color (team 0-3), scale, yaw', ['smithy', 'forge', 'blacksmith building', 'blacksmiths shop', 'foundry'], fbHall2(5.6, 5, 3.2, 0xb0aaa0, 0x5a4a40),
    bld('blacksmith', { hp: 240, material: 'stone' }, (pieces, plan) => {
      const i = plan.i, p = plan.p; smoke(i, p.x + 0.17 * p.size.x, p.size.y * 0.97, p.z - 0.12 * p.size.z, 3.0);
      let t0 = rand(1, 4);
      i.tick((dt) => { t0 -= dt; if (t0 < 0 && near(i, 22) && !i.broken) { t0 = rand(2.5, 6); const q = i.at(p.x - 0.2 * p.size.x, p.z + 0.2 * p.size.z); i.snd().tone({ freq: 880, freqEnd: 700, dur: 0.5, type: 'triangle', vol: 0.1, at: { x: q.x, y: i.y + 1, z: q.z } }); _w.set(q.x, i.y + 1, q.z); i.burst('spark', 0xffb040, _w, 5, 0.6); } }, { every: 0.2 });
    }), { size: 4.5, keepOut: 5 });
  defN('barracks', 'stone barracks with turreted corners, red banners and a heavy wooden door; a soldier\'s home', 'color (team 0-3), scale, yaw', ['garrison', 'fort house', 'military building', 'guard house', 'guardhouse'], fbHall2(6.4, 6.2, 5, 0x8a8680, 0x8a3a3a, { tower: true }),
    bld('barracks', { hp: 340, material: 'stone', rubble: [{ name: 'rubble-large', scale: 0.8 }] }), { size: 5, keepOut: 6 });
  defN('lumber-mill', 'water-powered lumber mill with a sawing shed, log piles and a crane arm', 'color (team 0-3), scale, yaw', ['lumbermill', 'sawmill', 'saw mill', 'timber mill', 'logging camp'], fbHall2(6, 5, 4, 0xa07850, 0x8a3a3a),
    bld('lumbermill', { hp: 220 }), { size: 5, keepOut: 6 });
  defN('archery-range', 'archery range: a tower with a target on the wall, a practice shed, arrows and straw targets', 'color (team 0-3), scale, yaw', ['shooting range', 'range', 'archers tower', 'training yard', 'archery yard'], fbHall2(6, 5.4, 4.4, 0xb0aaa0, 0x8a3a3a, { tower: true }),
    bld('archeryrange', { hp: 200 }), { size: 5.5, keepOut: 6 });
  defN('castle-keep', 'grand castle keep: a stone fortress with towers, banners, a great door and conical roofs; hit it hard to bring it down', 'color (team 0-3), scale, yaw', ['castle', 'fortress', 'stronghold', 'citadel', 'palace', 'big castle', 'keep building'], fbHall2(8, 8, 8, 0x8a8680, 0x3a5a98, { tower: true, roofH: 3 }),
    bld('castle', { hp: 900, material: 'stone', rubble: [{ name: 'rubble-large', scale: 1.1 }, { name: 'destroyed', scale: 0.7 }] }), { size: 8, keepOut: 9 });
  defN('watermill', 'timber watermill with a big wheel that turns slowly, a stone base and a steep red roof', 'color (team 0-3), scale, yaw', ['water mill', 'mill wheel', 'river mill', 'grist mill'], fbHall2(5, 5, 4, 0xe8dcc0, 0x8a3a3a),
    {
      model(P, o, i) { return { p: P(`watermill-${team(o)}`, { anchor: 'center' }), i }; },
      after(pieces, plan) {
        const i = plan.i, sp = mx.spinPart(i, plan.p, (x) => x < -0.34, [-0.41, 0.368, 0.31]); // the wheel is fused into the model: carve it out
        blk.piece(i, plan.p, { inset: 0.85, steer: true });
        if (sp.moved) { let a = 0; i.tick((dt) => { if (i.broken) return true; a += dt * 0.6; sp.pivot.rotation.x = a; }); }
      },
      destruct: { kind: 'break', material: 'wood', hp: 220, stages: 'auto', rubble: HOUSE_RUBBLE },
    }, { size: 4.5, keepOut: 5 });
  defN('ruined-house', 'burnt-out ruin of a timber house with a toppled beam frame, charred stones and a thin curl of smoke', 'scale, yaw', ['destroyed house', 'burnt house', 'wrecked building', 'ruined building', 'collapsed house', 'bombed house'], fbHall2(4.4, 4, 2, 0x5a5650, 0x3a3430),
    {
      model(P, o, i) { return { p: P('destroyed', { anchor: 'center', scale: 0.8 }), i }; },
      after(pieces, plan) { const i = plan.i, p = plan.p; smoke(i, p.x + 0.1, p.size.y * 0.8, p.z, 0.9); blk.piece(i, p, { inset: 0.8, h: Math.min(p.size.y, 2.5) }); },
      destruct: { kind: 'break', material: 'stone', hp: 120, stages: [{ at: 0.5, drop: 3 }], rubble: ['debris'] },
    }, { size: 4, keepOut: 4 });
  defN('construction-site', 'half-built wooden scaffolding with ladders, planks and a supply shed; a building site', 'scale, yaw', ['scaffolding', 'scaffold', 'building site', 'work site', 'construction'], fbSiegePrim(6, 6, 4, false),
    { model(P, o, i) { return { p: P('scaffolding', { anchor: 'center', scale: 0.85 }), i }; }, destruct: { kind: 'break', material: 'wood', hp: 150, stages: 'auto', rubble: ['debris'] } }, { size: 5, keepOut: 5 });
  defN('bazaar', 'covered market hall with a red-and-white striped awning, stalls of fruit and vegetables and wooden crates all around', 'color (team 0-3), scale, yaw', ['market hall', 'marketplace', 'market building', 'trading post', 'shops'], fbHall2(7, 5, 3, 0xe8dcc0, 0x8a3a3a),
    bld('market', { hp: 160, rubble: ['debris'] }), { size: 6, keepOut: 6 });

  // ---- ships and boats
  defN('ship', 'big wooden sailing ship with masts, sails, a crow\'s nest and a cannon deck, beached on the grass; option style pirate (default) | merchant | ghost | wreck, size small | medium | large', 'style, size (small|medium|large), scale, yaw', ['pirate ship', 'sailing ship', 'galleon', 'boat ship', 'ghost ship', 'shipwreck', 'warship', 'big ship', 'vessel', 'ships'], fbShipPrim(9),
    {
      model(P, o, i) {
        const sz = ['small', 'medium', 'large'].includes(o.size) ? o.size : 'medium', st = String(o.style ?? 'pirate');
        const name = st === 'ghost' ? 'ship-ghost' : st === 'wreck' ? 'ship-wreck' : st === 'merchant' ? `ship-${sz}` : `ship-pirate-${sz}`;
        return { p: P(name, { anchor: 'center', sink: 0.3 }), i };
      },
      after(pieces, plan) { blk.piece(plan.i, plan.p, { inset: 0.8, h: Math.min(plan.p.size.y, 4), steer: true }); },
      destruct: { kind: 'break', material: 'wood', hp: 520, stages: 'auto', rubble: [{ name: 'debris', scale: 1.4 }, { name: 'rocks', scale: 0.1 }] },
    }, { size: 6.5, keepOut: 7, face: 'random' });
  // ---- graveyard / military
  defN('crypt', 'stone crypt / mausoleum with a gabled roof and an iron-barred door; option style large (default) | small', 'style (large|small), scale, yaw', ['mausoleum', 'tomb', 'burial vault', 'catacomb house', 'sepulchre', 'crypts', 'vault'], fbHall2(4.2, 5, 3.2, 0x8a8f9a, 0x4a4e58),
    {
      model(P, o, i) { return { p: P(o.style === 'small' ? pick(['crypt-small', 'graveyard-crypt']) : 'crypt', { anchor: 'center', scale: o.style === 'small' ? 1 : 1 }), i }; },
      after(pieces, plan) { blk.piece(plan.i, plan.p, { inset: 0.9, steer: true }); },
      destruct: { kind: 'break', material: 'stone', hp: 340, stages: 'auto', rubble: [{ name: 'rubble-large', scale: 0.6 }] },
    }, { size: 4, keepOut: 5 });
  defN('siege-tower', 'tall wooden siege tower on wheels with a drawbridge ramp and a blue roof; push it to the wall', 'scale, yaw', ['siege engine', 'assault tower', 'belfry', 'siege towers'], fbSiegePrim(3.2, 4, 9),
    { model(P, o, i) { return { p: P('siege-tower', { anchor: 'center', scale: 0.9 }), i }; }, after(pieces, plan) { blk.piece(plan.i, plan.p, { inset: 0.85, steer: true }); }, destruct: { kind: 'break', material: 'wood', hp: 280, stages: 'auto', rubble: ['debris'] } }, { size: 4.5, keepOut: 5 });
  defN('battering-ram', 'wheeled battering ram under a blue-tiled roof with an iron-shod head', 'scale, yaw', ['ram', 'siege ram', 'ram cart', 'rams'], fbSiegePrim(2.6, 6, 2.4),
    { model(P, o, i) { return { p: P('siege-ram', { anchor: 'center', scale: 0.9 }), i }; }, after(pieces, plan) { blk.piece(plan.i, plan.p, { inset: 0.85, steer: true }); }, destruct: { kind: 'break', material: 'wood', hp: 200, stages: 'auto', rubble: ['debris'] } }, { size: 4, keepOut: 4 });
  defN('drawbridge', 'wooden drawbridge on a hinge: it stands raised and lowers with a rumble and chain rattle when you come within 9 m, and swings up again when you leave', 'scale, yaw', ['draw bridge', 'castle bridge', 'moat bridge', 'lift bridge', 'drawbridges'], fbWallRunPrim(0.3, 3, 0x7a5230, 0, false),
    {
      model(P, o, i) { return { p: P('bridge-draw', { anchor: 'origin', yaw: PI / 2, scale: 1.2 }), i }; },
      after(pieces, plan) {
        const i = plan.i, p = plan.p, pivot = new THREE.Group(); // the model's origin is the hinge: put it in a pivot and swing the pivot
        pivot.position.set(0, p.obj.position.y, 0); i.group.add(pivot); pivot.add(p.obj); p.obj.position.set(0, 0, 0);
        let open = 0, was = false; p.obj.rotation.y = PI / 2;
        i.tick((dt) => {
          if (i.broken) return;
          const want = Math.hypot(H.head.x - i.x, H.head.z - i.z) < 9 ? 1 : 0;
          if (want !== (was ? 1 : 0)) { was = !!want; i.snd().noise({ dur: 1.4, filter: { type: 'bandpass', freq: 260, freqEnd: 180, q: 4 }, vol: 0.2, at: { x: i.x, y: i.y + 1, z: i.z } }); i.snd().tone({ freq: 70, freqEnd: 50, dur: 1.2, type: 'sawtooth', vol: 0.08, at: { x: i.x, y: i.y + 1, z: i.z } }); }
          open += (want - open) * Math.min(1, dt * 1.2);
          pivot.rotation.x = -(1 - open) * 1.2; // raised (about 70 degrees) when nobody is near
        });
      },
      destruct: { kind: 'break', material: 'wood', hp: 160, stages: 'auto', rubble: ['debris'] },
    }, { size: 4, keepOut: 3 });
  // runs along local X, follow the ground: iron-fence and garden-wall
  const runSpec = (name, seg, scaleOf, bo, hp) => ({
    build(i, o, fb) {
      const L = clamp(o.length ?? 8, 1.5, 60), n = Math.max(1, Math.round(L / seg)), s = L / n, items = [];
      for (let k = 0; k < n; k++) {
        const x0 = -L / 2 + k * s, x1 = x0 + s, g0 = i.gy(x0, 0) - i.y, g1 = i.gy(x1, 0) - i.y;
        items.push({ name, x: (x0 + x1) / 2, z: 0, y: (g0 + g1) / 2, roll: Math.atan2(g1 - g0, s), sx: scaleOf * s / seg, sy: scaleOf, sz: scaleOf });
      }
      const sc = mx.scatterOr(i, items, { breakable: bo }, fb);
      if (sc) for (const s of items) blk.item(i, s, { sc, inset: 0.98 });
    },
    destruct: { kind: 'break', material: bo.material, hp },
  });
  defN('iron-fence', 'black wrought-iron fence with spiked bars on stone posts; option length (default 8 m); follows the ground', 'length', ['wrought iron fence', 'graveyard fence', 'metal fence', 'cemetery fence', 'iron railing', 'spiked fence', 'iron fences'], fbWallRunPrim(1.7, 0.1, 0x2a2e36),
    runSpec('fence', 3.2, 1.0, { material: 'metal', hp: 60, colors: [{ hex: 0x2a2e36, w: 0.7 }, { hex: 0x707680, w: 0.3 }] }, 80), { size: 3, spacing: 4, face: 'random' });
  defN('garden-wall', 'low rounded stone wall for gardens and yards; option length (default 8 m); follows the ground', 'length', ['low wall', 'stone fence', 'dry stone wall', 'field wall', 'yard wall', 'garden walls'], fbWallRunPrim(1.1, 0.5, 0x8a8680),
    runSpec('stone-wall', 2.2, 1.0, { material: 'stone', hp: 100, colors: [{ hex: 0x8a93a3, w: 0.6 }, { hex: 0x6c7482, w: 0.4 }] }, 120), { size: 3, spacing: 4, face: 'random' });

  mx.model('gate', {
    model(P, o, i) {
      return { arch: P('castle-gate', { anchor: 'center', scale: 1.8 }), l: P('tower-complete-small', { x: -5.5, anchor: 'center', scale: 1.2 }), r: P('tower-complete-small', { x: 5.5, anchor: 'center', scale: 1.2 }), i };
    },
    after(pieces, plan) {
      const i = plan.i, doors = [-1, 1].map((s) => {
        const g = new THREE.Group(); g.position.set(s * 1.62, 0, 0.2);
        const d = H.mk(); d.box(-s * 0.8, 1.9, 0, 1.64, 3.8, 0.22, 0x5a3a20);
        for (let k = 0; k < 5; k++) d.box(-s * (0.15 + k * 0.32), 1.9, 0.12, 0.05, 3.8, 0.03, 0x3a2616);
        for (const y of [0.8, 1.9, 3.0]) d.box(-s * 0.8, y, 0.13, 1.56, 0.12, 0.04, 0x2a2e36);
        d.box(-s * 0.2, 1.6, 0.16, 0.1, 0.4, 0.06, 0xd9a93c);
        g.add(d.build()); i.add(g); return g;
      });
      let open = 0, was = false;
      i.tick((dt) => {
        const dist = Math.hypot(H.head.x - i.x, H.head.z - i.z), want = dist < 6.5 && !i.broken ? 1 : 0;
        if (want !== (was ? 1 : 0)) { was = !!want; i.snd().noise({ dur: 0.9, filter: { type: 'bandpass', freq: 220, freqEnd: 160, q: 4 }, vol: 0.2, at: { x: i.x, y: i.y + 1.5, z: i.z } }); i.snd().tone({ freq: 90, freqEnd: 60, dur: 0.9, type: 'sawtooth', vol: 0.1, at: { x: i.x, y: i.y + 1.5, z: i.z } }); }
        open += (want - open) * Math.min(1, dt * 1.6);
        doors[0].rotation.y = open * 1.7; doors[1].rotation.y = -open * 1.7;
        if (i.broken && doors[0].visible && plan.arch.obj.visible === false) { doors[0].visible = doors[1].visible = false; }
      });
      const S = mx.structure(i, [
        { items: [plan.l], frac: [0, 1], material: 'stone', hp: 260, rubble: [{ name: 'rubble-large', scale: 0.6 }] },
        { items: [plan.r], frac: [0, 1], material: 'stone', hp: 260, rubble: [{ name: 'rubble-large', scale: 0.6 }] },
        { items: [plan.arch], material: 'stone', hp: 300, supports: [0, 1], rubble: [{ name: 'rubble-large', scale: 0.9 }] },
      ]);
      // solid: the two towers and the two gate piers either side of a 2.9 m gateway; the closed door leaves block only while the gate is shut
      const dead = (k) => () => !S || S.parts[k].broken;
      blk.piece(i, plan.l, { shape: 'cyl', inset: 0.92, steer: true, gone: dead(0) }); blk.piece(i, plan.r, { shape: 'cyl', inset: 0.92, steer: true, gone: dead(1) });
      blk.part(i, plan.arch, [0, 0.295], [0.05, 0.95], { steer: true, gone: dead(2) }); blk.part(i, plan.arch, [0.705, 1], [0.05, 0.95], { steer: true, gone: dead(2) });
      const leaves = doorLeaves(i, [[-0.81, 0.2, 1.64, 0.3], [0.81, 0.2, 1.64, 0.3]], 3.8);
      i.tick(() => { leaves(open < 0.2 && !i.broken); });
    },
    destruct: { kind: 'none', primitive: { kind: 'break', material: 'stone', hp: 400, stages: 'auto' } },
  });
  mx.model('bridge', { destruct: { kind: 'break', material: 'wood', hp: 220, stages: 'auto' } });
  mx.model('signpost', { destruct: (i, pieces) => mx.breakable(i, pieces, { material: 'wood', hp: 40, stages: [{ at: 0.5, drop: 2 }], onBreak() { for (const l of i.labels || []) l.show(false); } }) });
  mx.model('throne', { destruct: { kind: 'break', material: 'metal', hp: 180, stages: 'auto' } });
  mx.model('dungeon-entrance', {
    model(P, o, i) { return { p: P(`mine-${team(o)}`, { anchor: 'center', scale: 0.85 }), i }; },
    after(pieces, plan) {
      const i = plan.i, p = plan.p, mz = p.z + p.size.z * 0.42;
      blk.piece(i, p, { inset: 0.85, steer: true });
      const w = i.at(p.x, mz); i.light({ color: 0x7affc8, intensity: 14, distance: 10, flicker: 0.5, position: { x: w.x, y: i.y + 1.8, z: w.z } });
      let acc = 0, rum = rand(2, 6);
      i.tick((dt) => {
        if (!near(i, 50) || i.broken) return;
        acc += dt * 4; const n = acc | 0; acc -= n; if (n) { const q = i.at(p.x + rand(-0.8, 0.8), mz); _w.set(q.x, i.y + 0.8, q.z); i.burst('glow', 0x7affc8, _w, n, 0.5, _up); }
        rum -= dt; if (rum < 0 && near(i, 20)) { rum = rand(9, 16); i.snd().tone({ freq: 55, freqEnd: 40, dur: 2.5, type: 'sine', vol: 0.25, at: { x: i.x, y: i.y + 0.5, z: i.z } }); }
      }, { every: 0.1 });
    },
    destruct: { kind: 'break', material: 'stone', hp: 450, stages: 'auto', rubble: [{ name: 'rubble-large', scale: 0.8 }] },
  });
}
