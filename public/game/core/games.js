// core/games.js - world.games: MINI-GAMES with rules, scores and replay. Each is a library entry (category 'games'): "let's bowl" = lib.spawn(ctx,'bowling') or games.start('bowling').
// USE   world.games.start('bowling' | 'archery' | 'whack' | 'football' | 'basketball' | 'towerdefense' | 'arena' | 'race' | 'dominoes' | 'siege' | 'fishing' | 'hideseek' | 'golf' | 'rhythm' ...,
//         { x, z, yaw, level }) -> controller | null   builds the venue in front of the player (replacing the previous one) and runs the 3-2-1 countdown after ~1.2 s.
//       lib.spawn(ctx, 'bowling', { autostart: true }) builds the same venue in YOUR creation (it goes with it); the player hits the big green button on its pedestal to play.
//       world.games.list() -> [{ name, title, hint, aliases, best, plays, level }]   .stop() ends the round and removes the managed venue   .current -> { name, state, score, level, timeLeft } | null
//       .scores(name?) -> { best, plays, level, last, detail } (all games when no name; best also lives in quests stat 'games.<name>.best' + localStorage)   .reload() re-imports games/*.js
//       .on('start'|'play'|'score'|'end'|'abort'|'stop', fn({ name, score, rating, level, ... })) -> off    (also ctx.events 'games:<evt>')
// RULES  ONE round at a time (starting another aborts the first). Lifecycle idle -> countdown -> play -> result -> (replay | idle). Walk away for ~10 s and the round is aborted; a venue made by games.start()
//       removes itself after ~60 s far away. Everything a game makes is tracked and removed on end/abort/dispose. Rewards: XP, favour, gold; best score, level (1..5, goes up after a good result) persist.
// BUTTONS the pedestal: BIG GREEN = play / again; small RED = stop. Press: poke it with a hand (moving), point + trigger from <= 8 m (desktop / controllers), or hit it with a weapon or spell.
// WRITING A GAME  games/<file>.js: export const meta = { name, title, aliases[], description, hint (one line for the board), icon, distance (m in front of the player; 0 = centred on him), size (play radius m),
//         par (score worth rating 1), physics: true if Rapier is required }; export default function (g) { build venue with g.*; return { reset(level), play(level), update(dt, t), idle?(dt, t), stop?(why), dispose?() } }.
//   venue frame: g.x g.y g.z g.yaw (origin = where the player stands, local -Z = forward, +X = right), g.at(lx, ly, lz) -> world Vector3 (ly above g.y), g.k (0.6 in mixed reality = compact, else 1), g.ground(lx, lz).
//   g.THREE g.ctx g.world g.level g.state g.score g.time (round seconds) g.timeLeft g.opts.   Building: g.builder() (vertex-coloured merge, ONE draw call: box cyl sph cone, .mesh()), g.mesh(geo, color), g.box(..), g.cyl(..),
//   g.sph(..), g.mat(color), g.deck(w, d, { x, z, color }) (flat slab on the terrain: tilts along z, returns { y(lx, lz) }), g.add(obj) (venue), g.round(obj) (removed at round end), g.body(mesh, opts) -> Rapier handle | null
//   (tracked), g.joint(a, b, opts), g.spawn(libName, opts) (round-scoped library entry), g.give('bow') (weapon into a free hand), g.pedestalAt(lx, lz), g.boardAt(lx, ly, lz).
//   Play: g.addScore(n, at?, label?) (number floats up, sound, sparks), g.setScore(n), g.setTime(sec) (countdown clock, ends the round at 0), g.status('one line'), g.end({ score?, rating?, text?, detail? }), g.abort(),
//   g.later(sec, fn), g.every(sec, fn) (round timers), g.sfx(name, at?), g.pop(at, n?, 'spark'|'puff'|'confetti'), g.float(at, text, color), g.pulse(hand, strength, ms), g.hands -> [{ pos, vel, speed, inp }], g.note(fact, dramatic).
export const meta = { name: 'Games', description: 'Mini-game framework: lifecycle, scoreboard, pedestal button, scores, rewards, 14+ games spawnable by name.' };

const FILES = ['bowling', 'archery', 'whack', 'football', 'basketball', 'towerdefense', 'arena', 'race', 'dominoes', 'siege', 'fishing', 'hideseek', 'golf', 'rhythm', 'footballmatch', 'wrecking', 'duel', 'balloons', 'herding', 'jenga', 'obstacle'];
const LS_KEY = 'omnissiah.games.v1';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GRADES = [[0.9, 'S'], [0.75, 'A'], [0.55, 'B'], [0.35, 'C'], [0, 'D']];
const fmtT = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const css = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

export default async function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Matrix4, Matrix3, Quaternion, Euler, Color } = THREE;
  const S = ctx.state; // survives hot reloads of this file
  S.active ??= null; S.venues ??= new Set(); S.managed ??= null; S.records ??= null; S.listeners ??= {};
  const W = ctx.world;
  const head = ctx.player.head;
  const q = (() => { try { return new URL(import.meta.url).search; } catch (err) { return ''; } })();
  const defs = new Map(); // name -> { meta, create }
  const direct = new Set(); // venues built straight into this ctx (no library)
  let dead = false;

  // ------------------------------------------------------------------ persistence
  function loadRecords() {
    if (S.records) return S.records;
    let r = {};
    try { r = JSON.parse(globalThis.localStorage?.getItem(LS_KEY) || '{}') || {}; } catch (err) { r = {}; }
    return (S.records = r);
  }
  function saveRecords() { try { globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(S.records)); } catch (err) { /* private mode */ } }
  function record(name) { const r = loadRecords(); return (r[name] ??= { best: 0, plays: 0, level: 1, last: 0, detail: '' }); }
  function bestOf(name) { const r = record(name); const qb = W.quests?.stat ? W.quests.stat(`games.${name}.best`) : 0; return Math.max(r.best || 0, qb || 0); }
  function emit(evt, payload) {
    for (const fn of (S.listeners[evt] ?? []).slice()) { try { fn(payload); } catch (err) { console.error('[games] listener failed', err); } }
    ctx.events?.emit('games:' + evt, payload);
  }

  // ------------------------------------------------------------------ shared geometry / materials (never disposed per mesh; freed with this module)
  const GEO = new Map(), MAT = new Map();
  const baseGeo = (key, make) => {
    let g = GEO.get(key);
    if (!g) { g = make(); if (g.index) g = g.toNonIndexed(); g.computeVertexNormals(); GEO.set(key, g); }
    return g;
  };
  const geoBox = (w, h, d) => baseGeo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  const geoCyl = (rt, rb, h, seg = 12) => baseGeo(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const geoSph = (r, seg = 12) => baseGeo(`s${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)));
  const mat = (color, o = {}) => {
    const key = `${o.basic ? 'B' : 'L'}${color}|${o.opacity ?? 1}|${o.emissive ?? 0}|${o.side ?? 0}`;
    let m = MAT.get(key);
    if (!m) {
      m = o.basic ? new THREE.MeshBasicMaterial({ color, fog: o.fog ?? true }) : new THREE.MeshLambertMaterial({ color, emissive: o.emissive ?? 0 });
      if (o.opacity !== undefined && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
      if (o.side) m.side = THREE.DoubleSide;
      m.userData.shared = true; m.userData.keep = true; MAT.set(key, m);
    }
    return m;
  };
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true }); vcMat.userData.shared = true;
  const vcMatDouble = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); vcMatDouble.userData.shared = true;

  // Builder: accumulate coloured primitives, mesh() -> ONE vertex-coloured mesh (own geometry). cyl/box/sph/cone are CENTRED.
  const _m = new Matrix4(), _n = new Matrix3(), _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _e = new Euler(), _c = new Color(), _v = new Vector3();
  class Builder {
    constructor() { this.pos = []; this.nor = []; this.col = []; }
    part(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
      _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
      _n.getNormalMatrix(_m);
      const P = geo.attributes.position, N = geo.attributes.normal; _c.set(color);
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(_m); this.pos.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(N, i).applyNormalMatrix(_n).normalize(); this.nor.push(_v.x, _v.y, _v.z);
        this.col.push(_c.r, _c.g, _c.b);
      }
      return this;
    }
    box(w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) { return this.part(geoBox(1, 1, 1), color, x, y, z, w, h, d, rx, ry, rz); }
    cyl(rt, rb, h, color, x, y, z, seg = 10, rx = 0, ry = 0, rz = 0) { return this.part(geoCyl(rt, rb, h, seg), color, x, y, z, 1, 1, 1, rx, ry, rz); }
    sph(r, color, x, y, z, sy = 1, seg = 10) { return this.part(geoSph(1, seg), color, x, y, z, r, r * sy, r); }
    cone(r, h, color, x, y, z, seg = 8, rx = 0, ry = 0, rz = 0) { return this.part(geoCyl(0.0001, r, h, seg), color, x, y, z, 1, 1, 1, rx, ry, rz); }
    mesh(o = {}) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      const m = new THREE.Mesh(g, o.double ? vcMatDouble : vcMat);
      m.userData.ownGeo = true; return m;
    }
  }

  // ------------------------------------------------------------------ audio helpers (world.audio pack, kit.sound fallback)
  const TONES = { // name -> [pack name, fallback tone spec]
    tick: ['ui-tick', { freq: 660, dur: 0.07, type: 'square', vol: 0.12 }], go: ['ui-select', { freq: 990, dur: 0.35, type: 'square', vol: 0.16 }],
    hit: ['hit-generic', { freq: 180, freqEnd: 90, dur: 0.12, type: 'square', vol: 0.15 }], pop: ['pickup', { freq: 520, freqEnd: 900, dur: 0.1, type: 'sine', vol: 0.18 }],
    coin: ['pickup-coin', { freq: 880, freqEnd: 1320, dur: 0.15, type: 'triangle', vol: 0.18 }], miss: ['ui-error', { freq: 220, freqEnd: 110, dur: 0.25, type: 'sawtooth', vol: 0.12 }],
    win: ['quest-complete', { chord: [523, 659, 784, 1047], dur: 0.6, type: 'triangle', vol: 0.18 }], lose: ['music-defeat', { chord: [330, 262, 196], dur: 0.7, type: 'sawtooth', vol: 0.12 }],
    big: ['level-up', { chord: [659, 880, 1175], dur: 0.45, type: 'triangle', vol: 0.18 }], clang: ['clang', { freq: 420, freqEnd: 300, dur: 0.2, type: 'square', vol: 0.15 }],
    thud: ['debris-thud', { freq: 110, freqEnd: 60, dur: 0.15, type: 'sine', vol: 0.25 }], whoosh: ['swing-light', { freq: 300, freqEnd: 120, dur: 0.2, type: 'sine', vol: 0.1 }],
    cheer: ['crowd-cheer', { chord: [392, 494, 587], dur: 0.5, type: 'triangle', vol: 0.12 }], boom: ['explosion-small', { freq: 90, freqEnd: 30, dur: 0.5, type: 'sine', vol: 0.4 }],
    splash: ['step-water', { freq: 300, freqEnd: 80, dur: 0.2, type: 'sine', vol: 0.2 }], bell: ['bell-ring', { chord: [880, 1320], dur: 0.7, type: 'sine', vol: 0.18 }],
  };
  let kitSnd = null;
  const snd = () => (kitSnd ??= W.kit?.sound?.(ctx, { volume: 0.9 }) ?? null);
  function playSfx(name, at, volume = 1) {
    const t = TONES[name]; const pack = t ? t[0] : name;
    try { if (W.audio?.sfx && W.audio.sfx(pack, { at, volume })) return true; } catch (err) { /* fall back */ }
    const s = snd(); if (!s || !t) return false;
    const f = t[1], o = { ...f, vol: (f.vol ?? 0.2) * volume }; if (at) o.at = at;
    try { if (f.chord) s.chord(f.chord, o); else s.tone(o); } catch (err) { /* no audio context */ }
    return true;
  }

  // ------------------------------------------------------------------ hands (position, velocity, speed), computed once per frame
  const HS = [0, 1].map((i) => ({ i, name: i ? 'right' : 'left', pos: new Vector3(), vel: new Vector3(), speed: 0, last: new Vector3(), inp: null, ok: false, t: -1 }));
  function frameHands() {
    const t = ctx.clock.t; if (HS[0].t === t) return; const dt = Math.max(1e-3, Math.min(0.1, ctx.clock.dt || 0.016));
    for (const h of HS) {
      const inp = h.inp = h.i ? ctx.input.right : ctx.input.left; h.t = t;
      if (!inp || !inp.connected) { h.ok = false; continue; }
      if (h.ok) { h.vel.subVectors(inp.position, h.last).multiplyScalar(1 / dt); h.speed = h.vel.length(); } else { h.vel.set(0, 0, 0); h.speed = 0; }
      h.pos.copy(inp.position); h.last.copy(inp.position); h.ok = true;
    }
  }

  // ------------------------------------------------------------------ grass clearings: the field's grass is knee-to-waist high, so every venue clears the grass under its slab
  // (world.env.setGrassMask is ONE shared mask: skipped when another module (the racetrack) owns it, or when env.addGrassHole exists it is used instead)
  const rects = (S.clearRects ??= new Set());
  let maskTex = null, maskCv = null, raceMask = null;
  function applyClearings() {
    const E = W.env; if (!E) return;
    if (raceMask === null) { raceMask = false; try { ctx.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position?.count === 2105) raceMask = true; }); } catch (err) { /* ignore */ } }
    if (raceMask && !E.addGrassHole) return;
    if (E.addGrassHole) { for (const r of rects) { if (!r.hole) r.hole = E.addGrassHole({ x: r.x, z: r.z, w: r.w, d: r.d, yaw: r.yaw }); } return; }
    if (typeof E.setGrassMask !== 'function') return;
    if (!rects.size) { if (S.maskOwned) { E.setGrassMask(null); S.maskOwned = false; } return; }
    let sx = 0, sz = 0; for (const r of rects) { sx += r.x; sz += r.z; } const cx = sx / rects.size, cz = sz / rects.size, SIZE = 64, N = 256;
    if (!maskCv) { maskCv = document.createElement('canvas'); maskCv.width = maskCv.height = N; maskTex = new THREE.CanvasTexture(maskCv); maskTex.flipY = false; maskTex.generateMipmaps = false; maskTex.minFilter = THREE.LinearFilter; }
    const x = maskCv.getContext('2d'); if (!x) return; x.fillStyle = '#000'; x.fillRect(0, 0, N, N); x.fillStyle = '#fff'; const k = N / SIZE;
    for (const r of rects) { x.save(); x.translate((r.x - cx) * k + N / 2, (r.z - cz) * k + N / 2); x.rotate(-r.yaw); x.fillRect(-r.w * k / 2, -r.d * k / 2, r.w * k, r.d * k); x.restore(); }
    maskTex.needsUpdate = true; E.setGrassMask(maskTex, cx, cz, SIZE); S.maskOwned = true;
  }
  function clearGrass(rect) { const r = { ...rect }; rects.add(r); applyClearings(); return () => { rects.delete(r); try { r.hole?.remove?.(); } catch (err) { /* gone */ } applyClearings(); }; }
  // meta.site === 'lake': the venue snaps to the nearest shore point (dry ground just before the water, facing the lake); games.start also walks the player there
  function shoreFrom(px, pz) {
    const E = W.env, L = E && E.lake, iw = E && E.isWater;
    if (!L || typeof iw !== 'function' || ctx.input?.passthrough) return null;
    let dx = L.x - px, dz = L.z - pz; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    let s0 = 0; while (iw(px + dx * s0, pz + dz * s0) && s0 > -80) s0 -= 1; // standing in the water: back out first
    for (let s = s0; s <= d + 6; s += 0.5) {
      if (iw(px + dx * s, pz + dz * s)) { const b = Math.max(s - 2, s0); return { x: px + dx * b, z: pz + dz * b, yaw: Math.atan2(-dx, -dz) }; }
    }
    return null;
  }
  // ------------------------------------------------------------------ the venue
  function createVenue(c, def, o = {}) {
    const meta = def.meta, name = meta.name, rec = record(name);
    const root = new THREE.Group(); root.name = `game:${name}`; (c.root ?? ctx.root).add(root);
    const compact = !!ctx.input?.passthrough;
    let moved = null;
    if (meta.site === 'lake') { const s = shoreFrom(o.x ?? head.x, o.z ?? head.z); if (s) { o = { ...o, x: s.x, z: s.z, yaw: s.yaw, y: undefined }; moved = s; } }
    const yaw = o.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const X = o.x ?? head.x, Z = o.z ?? head.z, Y = o.y ?? ctx.groundAt(X, Z);
    const own = [], rnd = [], timers = [];
    const V = { name, def, root, state: 'idle', disposed: false, handle: o.inst?.handle ?? null, ctx: c, g: null };
    let game = null, level = clamp(Math.round(o.level ?? rec.level ?? 1), 1, 5), score = 0, tRound = 0, limit = 0, cd = 0, cdShown = 0, goFlash = 0, farT = 0, farGone = 0, stopCool = 0, pressCool = 0, resultAt = 0;
    let statusText = '', headline = '', grade = '', boardSig = '', ending = false, floatN = 0, lastEnd = null;
    const fx = {};
    const discard = (it) => {
      try {
        if (!it) return;
        if (it.isObject3D) { it.removeFromParent(); if (it.userData && it.userData.ownGeo && it.geometry) it.geometry.dispose(); if (it.userData && it.userData.ownTex && it.material?.map) it.material.map.dispose(); }
        else if (typeof it.remove === 'function') it.remove();
        else if (typeof it.dispose === 'function') it.dispose();
      } catch (err) { console.error('[games] cleanup failed', err); }
    };
    const clearList = (list) => { for (let i = list.length - 1; i >= 0; i--) discard(list[i]); list.length = 0; };
    const physics = () => { const P = W.physics; return P && P.body ? P : null; };

    // ---- the scope handed to the game
    const g = {
      THREE, ctx: c, gctx: ctx, world: W, name, title: meta.title ?? name, meta, opts: o, root, x: X, y: Y, z: Z, yaw, compact, k: compact ? 0.6 : 1,
      get level() { return level; }, get state() { return V.state; }, get score() { return score; }, get time() { return tRound; }, get timeLeft() { return limit > 0 ? Math.max(0, limit - tRound) : 0; },
      get physics() { return !!physics(); }, get quality() { return ctx.quality; }, head, hands: HS, vcMat, TONES,
      at(lx, ly = 0, lz = 0, out = new Vector3()) { return out.set(X + lx * cs + lz * sn, Y + ly, Z - lx * sn + lz * cs); },
      ground(lx, lz) { return ctx.groundAt(X + lx * cs + lz * sn, Z - lx * sn + lz * cs); }, groundAt: (x, z) => ctx.groundAt(x, z),
      toLocal(wx, wz, out = { x: 0, z: 0 }) { const dx = wx - X, dz = wz - Z; out.x = dx * cs - dz * sn; out.z = dx * sn + dz * cs; return out; },
      builder: () => new Builder(), mat, geoBox, geoCyl, geoSph, snd, playSfx,
      mesh(geo, color, x = 0, y = 0, z = 0, o2 = {}) { const m = new THREE.Mesh(geo, o2.mat ?? mat(color, o2)); m.position.set(x, y, z); return m; },
      box(w, h, d, color, x = 0, y = 0, z = 0, o2) { return g.mesh(geoBox(w, h, d), color, x, y, z, o2); },
      cyl(rt, rb, h, color, x = 0, y = 0, z = 0, o2) { return g.mesh(geoCyl(rt, rb, h, o2?.seg ?? 12), color, x, y, z, o2); },
      sph(r, color, x = 0, y = 0, z = 0, o2) { return g.mesh(geoSph(r, o2?.seg ?? 12), color, x, y, z, o2); },
      add(obj, parent = root) { parent.add(obj); own.push(obj); return obj; },
      round(obj, parent) { if (!obj) return obj; if (obj.isObject3D && !obj.parent) (parent ?? c.root ?? ctx.root).add(obj); rnd.push(obj); return obj; },
      track(obj) { if (obj) own.push(obj); return obj; },
      body(mesh, bo = {}) {
        const P = physics(); if (!P) return null;
        if (mesh && !mesh.parent) (c.root ?? ctx.root).add(mesh);
        const h = P.body(c, mesh, bo); if (!h) return null;
        const L = bo.round ? rnd : own; L.push(h); if (mesh) L.push(mesh); return h;
      },
      joint(a, b, jo) { const P = physics(); if (!P || !P.joint) return null; const j = P.joint(a, b, { ...jo, ctx: c }); if (j) own.push(j); return j; },
      spawn(libName, so = {}) { const L = W.library; if (!L) return null; const h = L.spawn(c, libName, so); if (h) rnd.push(h); return h; },
      give(type, hand) {
        const Wp = W.weapons; if (!Wp) return null;
        const held = Wp.held ?? {}; if (!hand) hand = !held.right ? 'right' : !held.left ? 'left' : null; if (!hand) return null;
        const p = ctx.input[hand]?.position ?? head;
        const w = Wp.create(c, type, { position: { x: p.x, y: p.y, z: p.z }, hand }); if (w) rnd.push(w); return w;
      },
      heldType(hand) { return W.weapons?.held?.[hand]?.type ?? null; },
      deck(w, d, dop = {}) { return makeDeck(w, d, dop); },
      pedestalAt(lx, lz) { pedX = lx; pedZ = lz; if (ped) placePedestal(); },
      boardAt(lx, ly, lz, scale = 1) { bdX = lx; bdY = ly; bdZ = lz; bdS = scale; if (board) placeBoard(); },
      clearGrass(lx, lz, w, d) { const p = g.at(lx, 0, lz); own.push({ remove: clearGrass({ x: p.x, z: p.z, w, d, yaw }) }); },
      later(sec, fn) { timers.push({ t: sec, fn, every: 0 }); },
      every(sec, fn) { timers.push({ t: sec, fn, every: sec }); },
      setScore(n) { score = n; boardSig = ''; },
      addScore(n, at, label, color) {
        score += n; boardSig = '';
        if (at) { g.float(at, label ?? (n > 0 ? '+' + n : String(n)), color ?? (n >= 0 ? 0xffe27a : 0xff7a6b)); g.pop(at, n > 0 ? 8 : 4, n > 0 ? 'spark' : 'puff'); }
        playSfx(n >= 0 ? 'coin' : 'miss', at, 0.8);
        emit('score', { name, score, delta: n, level });
      },
      setTime(sec) { limit = sec; tRound = 0; boardSig = ''; },
      status(text) { if (text !== statusText) { statusText = String(text ?? ''); boardSig = ''; } },
      headline(text) { headline = String(text ?? ''); boardSig = ''; },
      end(sum = {}) { finish(sum); },
      abort(why) { abort(why ?? 'aborted'); },
      sfx(n, at, vol) { return playSfx(n, at, vol); },
      pulse(hand, strength = 0.4, ms = 40) { try { if (hand === 'both' || !hand) { ctx.input.left?.pulse?.(strength, ms); ctx.input.right?.pulse?.(strength, ms); } else ctx.input[hand]?.pulse?.(strength, ms); } catch (err) { /* no haptics */ } },
      note(line, dramatic = false) { try { W.commentary?.note?.(line, { dramatic }); } catch (err) { /* optional */ } },
      pop(at, n = 10, kind = 'spark') {
        const K = W.kit; if (!K || !K.particles) return;
        let e = fx[kind];
        if (!e) {
          const spec = kind === 'puff' ? { count: 60, color: [0xcfc8b8, 0x8a8478], size: [0.2, 0.5], life: [0.4, 0.9], speed: [0.5, 1.8], gravity: -0.5, additive: false, alpha: 0.7 }
            : kind === 'confetti' ? { count: 160, color: [0xff4a6a, 0xffd23a, 0x4ac8ff], size: [0.1, 0.06], life: [1.2, 2.4], speed: [2, 6], gravity: 4, drag: 0.8, additive: false }
              : { count: 100, color: [0xffe27a, 0xff7a1a], size: [0.14, 0.02], life: [0.35, 0.9], speed: [1.5, 4.5], gravity: 6, additive: true };
          e = fx[kind] = K.particles(c, spec);
        }
        e.emit(at, Math.max(1, Math.round(n)));
      },
      float(at, text, color = 0xffe27a) { floatText(at, text, color); },
    };
    V.g = g;
    let deckPlane = null, pedX = -1.4, pedZ = 0.2, bdX = -1.4, bdY = 1.75, bdZ = -0.2, bdS = 1, ped = null, board = null;

    // ---- deck: a slab under the venue (the terrain is gently rolling): tilts along local z, level across x. dop.parts = [{ x, w, dy, color }] side by side (lane + gutters)
    function makeDeck(w, d, dop = {}) {
      const cx = dop.x ?? 0, cz = dop.z ?? -d / 2, thick = dop.thick ?? 0.3, n = 6;
      let sz = 0, sy = 0, szz = 0, szy = 0, cnt = 0, maxD = -1e9; const pts = [];
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
        const lx = cx + (i / n - 0.5) * w, lz = cz + (j / n - 0.5) * d, wy = ctx.groundAt(X + lx * cs + lz * sn, Z - lx * sn + lz * cs);
        pts.push([lz, wy]); sz += lz; sy += wy; szz += lz * lz; szy += lz * wy; cnt++;
      }
      const den = cnt * szz - sz * sz, slope = dop.flat || compact || den < 1e-6 ? 0 : (cnt * szy - sz * sy) / den, mean = (sy - slope * sz) / cnt;
      for (const [lz, wy] of pts) maxD = Math.max(maxD, wy - (mean + slope * lz));
      const top0 = mean + Math.max(0, maxD) + 0.03, pitch = Math.atan(slope); // top surface height at local z = 0
      const ay = (lx, lz) => top0 + slope * lz;
      const P = physics();
      for (const part of dop.parts ?? [{ x: 0, w, dy: 0, color: dop.color }]) {
        const m = new THREE.Mesh(geoBox(1, 1, 1), mat(part.color ?? dop.color ?? 0x7a6a52)); m.scale.set(part.w, thick, d);
        const mid = g.at(cx + part.x, 0, cz); m.position.set(mid.x, ay(cx, cz) + (part.dy ?? 0) - thick / 2, mid.z);
        m.rotation.order = 'YXZ'; m.rotation.y = yaw; m.rotation.x = -pitch; m.userData.noShadow = false;
        root.add(m); own.push(m);
        if (P) { const h = P.body(c, m, { type: 'fixed', shape: 'box', size: [part.w, thick, d], friction: dop.friction ?? 0.7, restitution: 0.05, group: 'prop' }); if (h) own.push(h); }
      }
      g.clearGrass(cx, cz, w + 0.8, d + 0.8);
      deckPlane = { y: ay, slope, pitch, top0 };
      return deckPlane;
    }
    // ---- floating numbers (pool of 6 sprites)
    const floats = [];
    function floatText(at, text, color) {
      let f = floats[floatN % 6];
      if (!f) {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
        sp.scale.set(0.9, 0.34, 1); sp.visible = false; sp.userData.noShadow = sp.userData.noOutline = sp.userData.noCull = true; sp.renderOrder = 20; root.add(sp);
        f = floats[floatN % 6] = { sp, cv, tex, t: 9, y0: 0 };
      }
      floatN++;
      const g2 = f.cv.getContext('2d'); g2.clearRect(0, 0, 256, 96); g2.font = 'bold 56px "Segoe UI", system-ui, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.lineWidth = 8; g2.strokeStyle = 'rgba(10,10,30,0.9)'; g2.strokeText(text, 128, 48); g2.fillStyle = css(color); g2.fillText(text, 128, 48);
      f.tex.needsUpdate = true; f.t = 0; f.sp.position.set(at.x, at.y + 0.2, at.z); f.y0 = f.sp.position.y; f.sp.visible = true; f.sp.material.opacity = 1;
    }
    function stepFloats(dt) { for (const f of floats) { if (!f || f.t > 1.2) continue; f.t += dt; f.sp.position.y = f.y0 + f.t * 0.9; f.sp.material.opacity = clamp(1.2 - f.t, 0, 1); if (f.t > 1.2) f.sp.visible = false; } }

    // ---- pedestal + scoreboard
    const bigBtn = new THREE.Mesh(geoCyl(0.17, 0.19, 0.08, 20), new THREE.MeshBasicMaterial({ color: 0x28d060 }));
    const stopBtn = new THREE.Mesh(geoCyl(0.07, 0.08, 0.05, 14), new THREE.MeshBasicMaterial({ color: 0xd03030 }));
    const bb = new Builder();
    bb.cyl(0.3, 0.36, 0.86, 0x6a6e7a, 0, 0.43, 0, 14); bb.cyl(0.36, 0.4, 0.06, 0x3a3d48, 0, 0.03, 0, 14); bb.cyl(0.33, 0.3, 0.06, 0x8a8e9a, 0, 0.89, 0, 14);
    ped = bb.mesh(); ped.add(bigBtn); ped.add(stopBtn); bigBtn.position.set(-0.05, 0.96, 0.03); stopBtn.position.set(0.17, 0.95, -0.12);
    for (const m of [ped, bigBtn, stopBtn]) m.userData.noShadow = true;
    root.add(ped); own.push(ped);
    const pedW = new Vector3(), bigW = new Vector3(), stopW = new Vector3();
    function placePedestal() { g.at(pedX, 0, pedZ, pedW); ped.position.set(pedW.x, ctx.groundAt(pedW.x, pedW.z), pedW.z); ped.rotation.y = yaw; ped.updateMatrixWorld(true); bigW.setFromMatrixPosition(bigBtn.matrixWorld); stopW.setFromMatrixPosition(stopBtn.matrixWorld); }
    // scoreboard: one canvas quad
    const BW = 1.5, BH = 0.75;
    const bcv = document.createElement('canvas'); bcv.width = 512; bcv.height = 256;
    const btex = new THREE.CanvasTexture(bcv); btex.colorSpace = THREE.SRGBColorSpace; btex.anisotropy = 4;
    board = new THREE.Group();
    const bface = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: btex, fog: false }));
    const bback = new THREE.Mesh(geoBox(BW + 0.1, BH + 0.1, 0.05), mat(0x14172e)); bback.position.z = -0.04;
    const bpost = new THREE.Mesh(geoCyl(0.04, 0.05, 1, 8), mat(0x4a3a2a)); bpost.scale.y = 1;
    for (const m of [bface, bback, bpost]) m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true;
    board.add(bface, bback); root.add(board, bpost); own.push(board, bpost); bface.userData.ownTex = true; bface.userData.ownGeo = true;
    const bw = new Vector3();
    function placeBoard() { g.at(bdX, 0, bdZ, bw); const gy = ctx.groundAt(bw.x, bw.z); board.scale.setScalar(bdS); board.position.set(bw.x, gy + bdY, bw.z); bpost.position.set(bw.x, gy + bdY / 2 - 0.4, bw.z); bpost.scale.set(bdS, bdY - 0.4 - 0.375 * bdS, bdS); bpost.position.y = gy + (bdY - 0.375 * bdS) / 2 - 0.2; bpost.visible = bdY > 0.8; }
    const draw = () => {
      const x = bcv.getContext('2d'); if (!x) return;
      const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#171b46'); gr.addColorStop(1, '#0b0d26');
      x.fillStyle = gr; x.fillRect(0, 0, 512, 256); x.lineWidth = 8; x.strokeStyle = '#e0a73f'; x.strokeRect(4, 4, 504, 248);
      const F = '"Segoe UI", system-ui, sans-serif'; x.textBaseline = 'alphabetic';
      x.textAlign = 'left'; x.fillStyle = '#ffd877'; x.font = `bold 34px ${F}`; x.fillText(g.title.toUpperCase(), 22, 50);
      x.textAlign = 'right'; x.fillStyle = '#a4abdc'; x.font = `bold 26px ${F}`; x.fillText(`Lv ${level}`, 490, 48);
      const st = V.state;
      let big = '', col = '#ffffff', bigPx = 96;
      if (st === 'countdown') { big = String(Math.max(1, cdShown)); col = '#ffd877'; bigPx = 110; }
      else if (st === 'play') { big = headline || String(Math.round(score)); }
      else if (st === 'result') { big = headline || String(Math.round(score)); col = '#7fe3a0'; }
      else { big = headline || 'READY'; col = '#8c9aff'; bigPx = 80; }
      if (big.length > 6) bigPx = Math.max(44, Math.floor(bigPx * 6 / big.length));
      x.textAlign = 'center'; x.fillStyle = col; x.font = `bold ${bigPx}px ${F}`; x.fillText(big, 256, 150);
      if (st === 'result' && grade) { x.textAlign = 'right'; x.fillStyle = '#ffd877'; x.font = `bold 64px ${F}`; x.fillText(grade, 490, 130); }
      if (st === 'play' && headline && score !== 0) { x.textAlign = 'center'; x.fillStyle = '#a4abdc'; x.font = `bold 28px ${F}`; x.fillText(String(Math.round(score)), 256, 188); }
      x.textAlign = 'left'; x.fillStyle = '#a4abdc'; x.font = `22px ${F}`;
      const bestTxt = bestOf(name) > 0 ? `Best ${Math.round(bestOf(name))}${rec.detail ? '  ' + rec.detail : ''}` : 'No score yet';
      x.fillText(bestTxt, 22, 244); x.textAlign = 'right';
      if (st === 'play') x.fillText(limit > 0 ? fmtT(limit - tRound) : fmtT(tRound), 490, 244);
      x.textAlign = 'center'; x.fillStyle = '#eceeff'; x.font = `bold 24px ${F}`;
      const line = st === 'idle' ? (statusText || meta.hint || 'Hit the green button') : st === 'result' ? (statusText || 'Green button to play again') : statusText;
      if (line) x.fillText(line.length > 38 ? line.slice(0, 37) + '.' : line, 256, 214);
      btex.needsUpdate = true;
    };

    // ---- state machine
    const note = (line, dramatic) => g.note(line, dramatic);
    function resetGame() { clearList(rnd); timers.length = 0; try { game.reset?.(level); } catch (err) { console.error(`[games] ${name}.reset failed`, err); } }
    function begin() {
      if (V.disposed || !game) return false;
      if (V.state === 'countdown' || V.state === 'play') return false;
      if (def.meta.physics && !physics()) { g.status('Physics is unavailable here'); return false; }
      if (S.active && S.active !== V && !S.active.disposed) S.active.abort('another game started');
      S.active = V; score = 0; tRound = 0; limit = 0; headline = ''; grade = ''; statusText = ''; ending = false;
      resetGame(); V.state = 'countdown'; cd = 3; cdShown = 3; boardSig = ''; pressCool = 0.8; stopCool = 1.2; farT = 0; playSfx('tick');
      emit('start', { name, level, venue: V });
      return true;
    }
    function go() {
      V.state = 'play'; tRound = 0; boardSig = ''; statusText = 'GO!'; goFlash = 1.2; playSfx('go'); g.pulse('both', 0.5, 80);
      try { game.play?.(level); } catch (err) { console.error(`[games] ${name}.play failed`, err); abort('error'); return; }
      emit('play', { name, level, venue: V });
    }
    function finish(sum = {}) {
      if (V.state !== 'play' && V.state !== 'countdown') return;
      if (ending) return; ending = true;
      try { game.stop?.('end'); } catch (err) { console.error(err); }
      clearList(rnd); timers.length = 0;
      if (sum.score !== undefined) score = sum.score;
      const par = sum.par ?? meta.par ?? 100;
      let rating = sum.rating ?? clamp(score / par, 0, 1);
      rating = clamp(rating, 0, 1);
      grade = (GRADES.find((r) => rating >= r[0]) ?? GRADES[GRADES.length - 1])[1];
      const r = record(name), prevBest = bestOf(name), nb = score > prevBest;
      r.plays++; r.last = Math.round(score);
      if (nb) { r.best = Math.round(score); r.detail = sum.detail ?? ''; try { W.quests?.stat?.(`games.${name}.best`, r.best - (W.quests.stat(`games.${name}.best`) || 0)); } catch (err) { /* optional */ } }
      try { W.quests?.stat?.(`games.${name}.plays`, 1); W.quests?.stat?.('games.played', 1); } catch (err) { /* optional */ }
      if (rating >= 0.7 && level < 5) r.level = level + 1; else r.level = level;
      const xp = Math.round((6 + 44 * rating) * (1 + 0.25 * (level - 1))), gold = Math.round(rating * 12 * level);
      try { W.quests?.grantXp?.(xp, 'game:' + name); if (rating >= 0.55) W.quests?.addFavour?.(0.3 * rating, 'game'); } catch (err) { /* optional */ }
      try { if (gold > 0) W.society?.earn?.(gold, 'game:' + name); } catch (err) { /* optional */ }
      saveRecords();
      V.state = 'result'; resultAt = ctx.clock.t; S.active = S.active === V ? null : S.active; boardSig = '';
      headline = sum.text ?? ''; statusText = nb && score > 0 ? 'New best!  Green button = again' : `${grade}  +${xp} xp  Green button = again`;
      playSfx(rating >= 0.35 ? 'win' : 'lose'); if (rating >= 0.55) { playSfx('cheer'); try { W.audio?.stinger?.('music-victory'); } catch (err) { /* optional */ } }
      g.pop(pedW.clone().setY(pedW.y + 1.4), 40, 'confetti'); g.pulse('both', 0.7, 150);
      note(`The player finished ${g.title}: score ${Math.round(score)}, grade ${grade}${nb ? ', a new personal best' : ''}.`, nb && rating >= 0.75);
      lastEnd = { name, score, rating, grade, level, xp, newBest: nb };
      emit('end', { ...lastEnd, venue: V });
      level = clamp(r.level, 1, 5);
    }
    function abort(why = 'aborted') {
      if (V.disposed) return;
      if (V.state === 'countdown' || V.state === 'play') {
        try { game.stop?.(why); } catch (err) { console.error(err); }
        if (S.active === V) S.active = null;
        V.state = 'idle'; headline = ''; statusText = why === 'stopped' ? 'Stopped. Green button to play' : ''; boardSig = '';
        resetGame(); emit('abort', { name, why, venue: V });
      } else if (V.state === 'result' && why === 'stopped') { V.state = 'idle'; headline = ''; statusText = ''; boardSig = ''; resetGame(); }
    }
    function press(which) {
      if (V.disposed || pressCool > 0) return;
      if (which === 'stop') { if (stopCool > 0 || V.state === 'idle') return; pressCool = 0.6; playSfx('tick'); abort('stopped'); return; }
      if (V.state === 'idle' || V.state === 'result') { pressCool = 0.8; begin(); }
    }
    V.begin = begin; V.abort = abort; V.press = press; V.bigPos = bigW; V.stopPos = stopW;
    Object.defineProperty(V, 'score', { get: () => score }); Object.defineProperty(V, 'level', { get: () => level });
    Object.defineProperty(V, 'timeLeft', { get: () => g.timeLeft });
    Object.defineProperty(V, 'lastEnd', { get: () => lastEnd });

    // ---- buttons: physical poke, point + trigger, or a weapon / spell hit (kit.damageable)
    const _ray = new Vector3();
    function pointsAt(h, tgt, r) { // controller / desktop ray passes within r of tgt, within 8 m
      _ray.subVectors(tgt, h.inp.position); const d = _ray.dot(h.inp.direction); if (d < 0.1 || d > 8) return false;
      const px = h.inp.position.x + h.inp.direction.x * d - tgt.x, py = h.inp.position.y + h.inp.direction.y * d - tgt.y, pz = h.inp.position.z + h.inp.direction.z * d - tgt.z;
      return px * px + py * py + pz * pz < r * r;
    }
    function checkButtons(dt) {
      pressCool -= dt; stopCool -= dt;
      for (const h of HS) {
        if (!h.ok) continue;
        const held = ctx.world.weapons?.held?.[h.name];
        for (let b = 0; b < 2; b++) {
          const tgt = b ? stopW : bigW, r = b ? 0.1 : 0.2;
          const dx = h.pos.x - tgt.x, dz = h.pos.z - tgt.z, dy = h.pos.y - tgt.y;
          const near = dx * dx + dz * dz < r * r && dy > -0.1 && dy < 0.16;
          const hit = (near && (h.speed > 0.9 || h.inp.down?.trigger || h.inp.down?.squeeze)) || (!held && h.inp.pressed?.('trigger') && pointsAt(h, tgt, r + 0.03));
          if (hit) { g.pulse(h.name, 0.6, 60); press(b ? 'stop' : 'go'); }
        }
      }
    }
    if (W.kit?.damageable) {
      for (let b = 0; b < 2; b++) {
        const d = W.kit.damageable(c, b ? stopBtn : bigBtn, { hp: 1e9, radius: b ? 0.12 : 0.22, faction: 'neutral', onHit: () => press(b ? 'stop' : 'go') });
        if (d) own.push(d);
      }
    }

    // ---- per-frame
    let lastDraw = -9;
    V.update = function update(dt, t) {
      if (V.disposed) return;
      dt = Math.min(dt, 0.05); frameHands();
      checkButtons(dt);
      let st = V.state;
      if (st === 'countdown') {
        cd -= dt; const n = Math.max(0, Math.ceil(cd));
        if (n !== cdShown) { cdShown = n; boardSig = ''; if (n > 0) playSfx('tick'); }
        if (cd <= 0) { go(); st = V.state; }
      } else if (st === 'play') {
        tRound += dt;
        if (goFlash > 0 && (goFlash -= dt) <= 0 && statusText === 'GO!') g.status('');
        for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { if (tm.every) tm.t += tm.every; else timers.splice(i, 1); try { tm.fn(); } catch (err) { console.error('[games] timer failed', err); } if (V.state !== 'play') break; } }
        if (V.state === 'play') { try { game.update?.(dt, t); } catch (err) { console.error(`[games] ${name}.update failed`, err); abort('error'); } }
        if (V.state === 'play' && limit > 0 && tRound >= limit) finish({});
        const dd = Math.hypot(head.x - X, head.z - Z), lim = Math.max(meta.size ?? 10, 8) + 14;
        farT = dd > lim ? farT + dt : 0; if (farT > 10 && V.state === 'play') { g.status('You walked away'); abort('walked away'); }
        st = V.state;
      } else {
        try { game.idle?.(dt, t); } catch (err) { console.error(`[games] ${name}.idle failed`, err); }
        if (st === 'result' && t - resultAt > 45) { V.state = 'idle'; headline = ''; statusText = ''; boardSig = ''; resetGame(); }
        if (o.managed && !S.active) { const dd = Math.hypot(head.x - X, head.z - Z); farGone = dd > 70 ? farGone + dt : 0; if (farGone > 60) { const h = V.handle; V.dispose(); stopManagedRef(V); try { h?.remove?.(); } catch (err) { /* gone */ } return; } }
      }
      if (o._autoAt > 0 && V.state === 'idle') { o._autoAt -= dt; if (o._autoAt <= 0) begin(); }
      stepFloats(dt);
      const act = V.state === 'idle' || V.state === 'result';
      bigBtn.material.color.setHex(act ? 0x28d060 : 0x1c3a28); bigBtn.position.y = act ? 0.96 + Math.sin(t * 3) * 0.01 : 0.93;
      stopBtn.material.color.setHex(act ? 0x4a2020 : 0xd03030);
      board.rotation.y = Math.atan2(head.x - board.position.x, head.z - board.position.z);
      const sig = `${V.state}|${Math.round(score)}|${cdShown}|${limit > 0 ? Math.ceil(limit - tRound) : Math.floor(tRound)}|${statusText}|${headline}|${level}|${Math.round(bestOf(name))}|${grade}`;
      if (sig !== boardSig && (t - lastDraw > 0.066 || V.state !== 'play')) { boardSig = sig; lastDraw = t; draw(); }
    };    V.dispose = function dispose() {
      if (V.disposed) return; V.disposed = true;
      try { if (V.state === 'countdown' || V.state === 'play') { game?.stop?.('dispose'); emit('abort', { name, why: 'dispose', venue: V }); } } catch (err) { console.error(err); }
      if (S.active === V) S.active = null;
      try { game?.dispose?.(); } catch (err) { console.error(err); }
      clearList(rnd); timers.length = 0;
      for (const k of Object.keys(fx)) { try { fx[k].dispose(); } catch (err) { /* gone */ } }
      for (const f of floats) { if (f) { f.sp.removeFromParent(); f.tex.dispose(); f.sp.material.dispose(); } }
      clearList(own);
      btex.dispose(); bface.geometry.dispose(); bface.material.dispose(); bigBtn.material.dispose(); stopBtn.material.dispose();
      root.removeFromParent(); S.venues.delete(V); direct.delete(V);
    };

    // ---- build the game, then show the idle venue
    placePedestal(); placeBoard(); g.clearGrass(-0.7, 0.4, 3.4, 2.4);
    try { game = def.create(g); } catch (err) { console.error(`[games] building "${name}" failed`, err); V.dispose(); return null; }
    if (!game) { V.dispose(); return null; }
    V.game = game; V.moved = moved; V.origin = { x: X, z: Z, yaw };
    placePedestal(); placeBoard(); resetGame(); draw();
    if (o.autostart) o._autoAt = 1.2;
    S.venues.add(V);
    return V;
  }

  // ------------------------------------------------------------------ registry
  function stopManagedRef(v) { if (S.managed && S.managed.venue === v) { S.managed = null; } }
  async function loadAll() {
    for (const f of FILES) {
      try {
        const m = await import(`../games/${f}.js${q}`);
        if (m && m.meta && typeof m.default === 'function') defs.set(m.meta.name, { meta: m.meta, create: m.default, file: f });
      } catch (err) { if (!/Failed to fetch|Cannot find module|404|not found/i.test(String(err && err.message))) console.error(`[games] ${f}.js failed to load`, err); }
    }
  }
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  function find(name) {
    const n = norm(name); if (!n) return null;
    for (const d of defs.values()) if (norm(d.meta.name) === n) return d;
    for (const d of defs.values()) if ((d.meta.aliases ?? []).some((a) => norm(a) === n) || norm(d.meta.title) === n) return d;
    for (const d of defs.values()) if (n.includes(norm(d.meta.name)) || (d.meta.aliases ?? []).some((a) => n.includes(norm(a)))) return d;
    return null;
  }
  let lastBuilt = null, undos = [];
  function registerLibrary() {
    const L = W.library; if (!L || !L.define) return;
    for (const u of undos) { try { u(); } catch (err) { /* gone */ } } undos = [];
    for (const d of defs.values()) {
      const m = d.meta;
      const clash = L.list().some((e) => e.name === m.name && e.category !== 'games'); // never replace a catalogue entry that is not a game ('arena' is a structure)
      d.libName = clash ? m.name + '-game' : m.name;
      undos.push(L.define(d.libName, {
        category: 'games', description: `${m.title ?? m.name} mini-game: ${m.description ?? m.hint ?? ''}`.trim(), aliases: [m.name, m.title, ...(m.aliases ?? [])].filter(Boolean),
        options: 'level (1-5), autostart', ownCount: true, pop: null, size: m.size ?? 2, distance: m.distance ?? 3, keepOut: m.distance === 0 ? 0 : 1.5, face: 'player',
        build(c, opts) {
          const cur = defs.get(m.name) ?? d; // a reload may have replaced the definition
          const v = createVenue(c, cur, { ...opts, x: opts.x, z: opts.z, y: opts.y, yaw: opts.yaw, level: opts.level, autostart: opts.autostart, managed: opts.managed });
          lastBuilt = v; if (!v) return null;
          return { object: v.root, update: (dt, t) => v.update(dt, t), dispose: () => v.dispose() };
        },
      }));
    }
  }
  function flatFwd() { const f = ctx.player.forward; let x = f.x, z = f.z; const l = Math.hypot(x, z); if (l < 0.25) { const r = ctx.rig.rotation.y; x = -Math.sin(r); z = -Math.cos(r); } else { x /= l; z /= l; } return [x, z]; }
  function stopManaged() { const m = S.managed; S.managed = null; if (!m) return; try { m.handle?.remove?.() ?? m.venue.dispose(); } catch (err) { console.error(err); } if (!m.venue.disposed) m.venue.dispose(); }
  function start(name, opts = {}) {
    const d = find(name); if (!d) return null;
    const m = S.managed;
    if (m && m.name === d.meta.name && !m.venue.disposed && !opts.fresh) { if (opts.level) m.venue.level = opts.level; m.venue.begin(); return m.venue; }
    stopManaged();
    const [fx2, fz2] = flatFwd(), dist = d.meta.distance ?? 3;
    const o = { x: opts.x ?? head.x + fx2 * dist, z: opts.z ?? head.z + fz2 * dist, yaw: opts.yaw ?? Math.atan2(-fx2, -fz2), level: opts.level, autostart: opts.autostart ?? true, managed: true };
    let v = null, handle = null;
    lastBuilt = null;
    if (W.library?.spawn && d.libName && W.library.has?.(d.libName)) { handle = W.library.spawn(ctx, d.libName, { ...o, noPush: true }); v = lastBuilt; }
    if (!v) { v = createVenue(ctx, d, o); if (v) direct.add(v); handle = null; }
    if (!v) return null;
    S.managed = { name: d.meta.name, venue: v, handle };
    if (v.moved && W.player?.teleport) { try { W.player.teleport(v.origin.x, v.origin.z); ctx.hud?.show?.('Walking you to the water...', 3); } catch (err) { /* optional */ } }
    return v;
  }
  function stop() {
    let any = false;
    if (S.active && !S.active.disposed) { S.active.abort('stopped'); any = true; }
    if (S.managed) { stopManaged(); any = true; }
    emit('stop', {}); return any;
  }
  const api = {
    version: 1,
    list: () => [...defs.values()].map((d) => { const r = record(d.meta.name); return { name: d.meta.name, lib: d.libName ?? d.meta.name, title: d.meta.title ?? d.meta.name, hint: d.meta.hint ?? '', aliases: d.meta.aliases ?? [], icon: d.meta.icon, best: Math.round(bestOf(d.meta.name)), plays: r.plays, level: r.level }; }),
    start, stop, has: (n) => !!find(n),
    get current() { const v = S.active && !S.active.disposed ? S.active : S.managed?.venue; return v && !v.disposed ? { name: v.name, state: v.state, score: v.score, level: v.level, timeLeft: v.timeLeft, venue: v } : null; },
    scores(name) { if (name) { const d = find(name); const n = d ? d.meta.name : name; return { ...record(n), best: bestOf(n) }; } const out = {}; for (const d of defs.values()) out[d.meta.name] = { ...record(d.meta.name), best: bestOf(d.meta.name) }; return out; },
    on(evt, fn) { (S.listeners[evt] ??= []).push(fn); return () => { const a = S.listeners[evt]; const i = a ? a.indexOf(fn) : -1; if (i >= 0) a.splice(i, 1); }; },
    venues: () => [...S.venues],
    async reload() { defs.clear(); await loadAll(); registerLibrary(); return defs.size; },
    resetScores(confirm) { if (confirm !== true) return false; S.records = {}; saveRecords(); return true; },
  };

  // ------------------------------------------------------------------ menu panel
  let unMenu = null;
  function registerMenu() {
    const M = W.menu; if (!M?.register) return; try { unMenu?.(); } catch (err) { /* gone */ }
    unMenu = M.register({
      id: 'games', title: 'Games', icon: 'star', sig: () => (S.active ? S.active.state + Math.round(S.active.score) : '-'),
      build(ui) {
        ui.heading('Mini-games'); const cur = api.current; if (cur) ui.text(`${cur.name}: ${cur.state}, score ${Math.round(cur.score)}`, { size: 13 });
        ui.grid(api.list(), { id: 'games', cols: 2, rows: 4, tile: (it) => ({ title: it.title, sub: it.best ? `Best ${it.best}  Lv ${it.level}` : it.hint.slice(0, 28), icon: it.icon ?? 'star', onClick: () => { api.start(it.name); ui.close?.(); } }) });
        if (cur) ui.button('Stop the game', () => { api.stop(); ui.refresh(); }, { kind: 'danger' });
      },
    });
  }
  ctx.on('module:loaded', (e) => { if (e && e.path === 'core/library.js') registerLibrary(); if (e && e.path === 'core/menu.js') registerMenu(); });

  await loadAll();
  registerLibrary(); registerMenu();
  ctx.provide('games', api);

  return {
    update(dt, t) { if (dead) return; for (const v of direct) v.update(dt, t); },
    dispose() {
      dead = true;
      try { unMenu?.(); } catch (err) { /* gone */ }
      if (S.managed) { const mv = S.managed.venue; S.managed = null; try { mv.dispose(); } catch (err) { console.error(err); } }
      for (const v of [...direct]) v.dispose();
      for (const u of undos) { try { u(); } catch (err) { /* gone */ } } undos = [];
      rects.clear(); try { applyClearings(); } catch (err) { /* gone */ } maskTex?.dispose();
      for (const g2 of GEO.values()) g2.dispose(); for (const m2 of MAT.values()) m2.dispose(); vcMat.dispose(); vcMatDouble.dispose();
    },
  };
}
