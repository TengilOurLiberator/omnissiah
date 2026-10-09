// core/spells.js — world.spells: the spell registry, casting and the spell wheel.
//   world.spells.register({ id, name, color, cast(args), icon?, description?, category?, rate?, hold?, onRelease? }) -> unregister()
//     id string (re-registering an id replaces it: hot-swap). name/color/icon (emoji or 1-2 letters)/description (one short sentence) show on the wheel.
//     category: 'offence'|'control'|'movement'|'defence'|'summon'|'utility' = its group on the wheel (omitted: a built-in table by id for the 40 starter spells, else 'utility').
//     A spell registered after startup becomes the SELECTED one automatically (and is announced): no need to call select().
//     cast({ origin, direction, hand, ctx }): FRESH Vector3s (hand tip + pointing ray); hand = input.right. A spell uses its own creation's ctx. Runs in try/catch.
//     rate (seconds): holding the trigger auto-repeats the cast every `rate` s.
//     hold: true -> continuous spell: cast() is called EVERY FRAME while the trigger is held with { origin, direction, hand, ctx, dt, first, hold: true } (REUSED vectors: copy, never keep);
//       onRelease({ hand, ctx }) once when released / switched away. Keep per-frame work allocation-free.
//   world.spells.list() -> [{ id, name, color, icon, description, category, hold, rate }]   current()   select(id) -> bool (use it to switch to an EXISTING spell)
//   world.spells.bodies() -> live kit bodies, for pull/push/grab spells
// CONTROLS (tell the player): right trigger casts; right A tap = next spell in the CURRENT CATEGORY; hold A = the spell wheel: an inner ring of 6 categories + ★ favourites + ⟲ last 6 cast,
//   point at one and its spells fan out as an arc, slide along the arc, release to choose (release on a wedge = your last spell there); hold the trigger on a spell ~0.6 s to star it (double-tap A
//   jumps between favourites); flick the right stick left/right while holding A = next category; a weapon in the right hand takes the trigger instead.
// Emits 'spell:cast' { id, origin, direction } and 'spell:select' { id }. 40 starter spells already exist as creations/spell-*.js (the loaded-module list names them; Grep 'export const meta' creations/spell-*.js for descriptions): check before writing a new one.

export const meta = { name: 'Spells', description: 'Spell registry, casting, hold-spells and the spell wheel.' };

// Wheel groups: built-in id -> category (the order here is the order along the arc); every other id is 'utility' unless it declares one.
const CAT_IDS = {
  offence: 'firebolt fire-stream frost-lance chain-lightning storm-cloud meteor sun-beam life-drain venom-flask blade-whirl rune-trap fissure',
  control: 'force-push gravity-well time-bubble mind-charm polymorph petrify vine-snare tornado anti-gravity shrink-ray',
  movement: 'blink levitate grapple ice-path sky-disc rewind',
  defence: 'arcane-shield earth-wall wall-of-force mirror-images heal',
  summon: 'conjure-orb summon-familiar arcane-turret spirit-wolves',
  utility: 'light-orb bloom-brush telekinesis',
};
const CATS = Object.keys(CAT_IDS);
const CAT_OF = {}, ORD = {};
for (const c of CATS) CAT_IDS[c].split(' ').forEach((id, i) => { CAT_OF[id] = c; ORD[id] = i; });
const CAT_ALIAS = { defense: 'defence', summoning: 'summon', attack: 'offence', movement: 'movement', move: 'movement', util: 'utility' };
const CAT_UI = { // wheel wedge k = 1 + index in CATS; wedge 0 = favourites, wedge 7 = recent
  offence: { name: 'Offence', color: 0xff5d4a, icon: '⚔️' }, control: { name: 'Control', color: 0xb57bff, icon: '🌀' },
  movement: { name: 'Movement', color: 0x38d9e8, icon: '💨' }, defence: { name: 'Defence', color: 0x4f8dff, icon: '🛡️' },
  summon: { name: 'Summon', color: 0x4fdc8a, icon: '🐺' }, utility: { name: 'Utility', color: 0xff7ac8, icon: '✨' },
};
const FAV_UI = { name: 'Favourites', color: 0xffc23d }, REC_UI = { name: 'Recent', color: 0xb9c4ff };
const MOJIBAKE = /[\u00c2\u00c3\u00e2\u00f0][\u0080-\u00bf\u0152-\u0178\u02c6\u02dc\u2013-\u203a\u20ac]/;
const SHORT = { 'anti-gravity': 'Anti-Grav', 'arcane-shield': 'Shield', 'arcane-turret': 'Turret', 'chain-lightning': 'Chain Bolt', 'gravity-well': 'Grav. Well', heal: 'Healing',
  'mirror-images': 'Mirrors', 'spirit-wolves': 'Wolves', 'summon-familiar': 'Familiar', 'wall-of-force': 'Force Wall', grapple: 'Grapple' };
const shortName = (e) => {
  if (SHORT[e.id]) return SHORT[e.id];
  const n = String(e.name);
  if (n.length <= 11) return n;
  const w = n.split(' ')[0];
  return w.length >= 3 && w.length <= 11 ? w : n.slice(0, 10) + '…';
};

export default function (ctx) {
  const THREE = ctx.THREE, { input, events } = ctx;
  const S = (ctx.state.spells ??= { map: new Map(), currentId: null, ready: false, last: -10 });
  S.bodies ??= []; S.lastBy ??= {}; S.catLast ??= {};
  if (S.map.size) S.quietUntil = performance.now() + 3000; // this file was hot-reloaded with spells live: their re-registrations in the next 3 s are not 'new spells'
  const R = input.right;
  const { Vector3, Color } = THREE;
  const _v = new Vector3(), _d = new Vector3();
  const hex = (c) => new Color(c ?? 0xffffff);
  const buzz = (s, ms) => { const k = ctx.world.kit; if (k && k.haptic) k.haptic('right', s, ms); else if (R.pulse) R.pulse(s, ms); };
  const capturing = () => !!(ctx.world.menu && ctx.world.menu.capturing); // a hand ray is over the wrist menu: never cast through it

  // ---- categories
  const resolveCat = (c, id) => {
    if (typeof c === 'string') { c = c.toLowerCase(); c = CAT_ALIAS[c] ?? c; if (CAT_IDS[c]) return c; }
    return CAT_OF[id] ?? 'utility';
  };
  const catOf = (e) => e.category || (e.category = resolveCat(null, e.id)); // (entries kept in ctx.state by an older spells.js have none)
  function catIds(cat) { // ids of a category in arc order (built-ins by the table above, then in registration order)
    const out = [];
    for (const e of S.map.values()) if (catOf(e) === cat) out.push(e.id);
    return out.sort((a, b) => (ORD[a] ?? 99) - (ORD[b] ?? 99));
  }

  // ---- favourites (persisted: ctx.state survives hot reloads, localStorage survives sessions)
  const FAV_KEY = 'omnissiah.spells.favourites', REC_KEY = 'omnissiah.spells.recent';
  if (!S.fav) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(FAV_KEY) || 'null'); } catch (err) { /* no storage */ }
    S.fav = { slots: Math.max(1, Math.min(3, (saved && saved.slots) | 0 || 1)), ids: [null, null, null], next: 0 };
    if (saved && Array.isArray(saved.ids)) for (let i = 0; i < 3; i++) S.fav.ids[i] = typeof saved.ids[i] === 'string' ? saved.ids[i] : null;
  }
  if (!S.recent) {
    S.recent = [];
    try { const r = JSON.parse(localStorage.getItem(REC_KEY) || '[]'); if (Array.isArray(r)) for (const id of r) if (typeof id === 'string' && S.recent.length < 6) S.recent.push(id); } catch (err) { /* no storage */ }
  }
  const FAV = S.fav;
  const saveFav = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify({ slots: FAV.slots, ids: FAV.ids })); } catch (err) { /* private window */ } };
  const favOf = (i) => (i < FAV.slots && FAV.ids[i] && S.map.has(FAV.ids[i]) ? FAV.ids[i] : null);
  const isFav = (id) => { for (let i = 0; i < FAV.slots; i++) if (FAV.ids[i] === id) return true; return false; };
  function setFavourite(id, slot) {
    if (id !== null && !S.map.has(id)) return false;
    for (let i = 0; i < 3; i++) if (FAV.ids[i] === id && id !== null) FAV.ids[i] = null;
    if (id === null) { if (typeof slot === 'number') FAV.ids[slot] = null; saveFav(); return true; }
    if (typeof slot !== 'number') {
      slot = -1;
      for (let i = 0; i < FAV.slots; i++) if (!favOf(i)) { slot = i; break; }
      if (slot < 0) slot = FAV.next++ % FAV.slots; // all full: replace in rotation
    }
    if (slot < 0 || slot >= FAV.slots) return false;
    FAV.ids[slot] = id; saveFav();
    return true;
  }
  function toggleFavourite(id) {
    for (let i = 0; i < FAV.slots; i++) if (FAV.ids[i] === id) { FAV.ids[i] = null; saveFav(); return false; }
    return setFavourite(id);
  }
  function setFavouriteSlots(n) {
    n = Math.max(1, Math.min(3, Math.round(Number(n)) || 1));
    if (n === FAV.slots) return n;
    FAV.slots = n; saveFav();
    if (typeof layoutHook === 'function') layoutHook();
    return n;
  }
  let layoutHook = null;
  function touchRecent(id) { // the last 6 spells cast, newest first
    const r = S.recent;
    if (r[0] === id) return;
    const i = r.indexOf(id);
    if (i >= 0) r.splice(i, 1);
    r.unshift(id); if (r.length > 6) r.length = 6;
    try { localStorage.setItem(REC_KEY, JSON.stringify(r)); } catch (err) { /* private window */ }
  }

  // ---- track kit bodies (kit has no public list): wrap kit.body so every body made afterwards is remembered
  function trackKit() {
    const kit = ctx.world.kit;
    if (!kit || typeof kit.body !== 'function' || kit.body.__tracked || kit.bodies) return;
    const orig = kit.body;
    const wrapped = function (c, mesh, o) { const b = orig.call(this, c, mesh, o); S.bodies.push(b); return b; };
    wrapped.__tracked = true;
    kit.body = wrapped;
  }
  function bodies() {
    const kit = ctx.world.kit;
    if (kit && typeof kit.bodies === 'function') return kit.bodies();
    const B = S.bodies;
    for (let i = B.length - 1; i >= 0; i--) if (B[i].removed) { B[i] = B[B.length - 1]; B.pop(); }
    return B;
  }
  trackKit();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/kit.js') trackKit(); });

  // ---- orb at the right hand showing the current spell's colour
  // (visual) a soft spark in the spell's colour: two additive sprites with a painted radial falloff, hidden while no spell is selected
  const sparkCv = document.createElement('canvas'); sparkCv.width = sparkCv.height = 64;
  { const g2 = sparkCv.getContext('2d'), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.16, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64); }
  const sparkT = new THREE.CanvasTexture(sparkCv);
  const coreM = new THREE.SpriteMaterial({ map: sparkT, color: 0x888888, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const haloM = new THREE.SpriteMaterial({ map: sparkT, color: 0x888888, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const orb = new THREE.Group();
  const core = new THREE.Sprite(coreM), halo = new THREE.Sprite(haloM);
  core.scale.setScalar(0.034); halo.scale.setScalar(0.1);
  core.renderOrder = 900; halo.renderOrder = 901; // drawn after a late-rendered sky (perf governor 'skyLate') and the transparent scenery; never hidden by the hand model
  orb.add(core, halo);
  orb.position.set(0, 0.07, 0.05);
  R.anchor.add(orb);
  ctx.onDispose(() => { orb.removeFromParent(); sparkT.dispose(); coreM.dispose(); haloM.dispose(); });

  function refreshOrb() {
    const e = current();
    const c = e ? hex(e.color) : hex(0x777777);
    coreM.color.copy(c).lerp(WHITE, 0.45); haloM.color.copy(c);
    orb.visible = !!e;
  }
  const WHITE = new THREE.Color(1, 1, 1);

  // ---- registry
  function current() {
    return S.map.get(S.currentId) ?? S.map.values().next().value ?? null;
  }
  function select(id, toast = false) {
    if (!S.map.has(id)) return false;
    const e = S.map.get(id);
    S.currentId = id; S.catLast[catOf(e)] = id;
    refreshOrb();
    if (toast) ctx.hud?.show(typeof toast === 'string' ? toast : e.name, 1.6);
    events.emit('spell:select', { id });
    return true;
  }
  function register(spell) {
    if (!spell || typeof spell.id !== 'string' || typeof spell.cast !== 'function') {
      console.error('[spells] register needs { id: string, cast: function }', spell);
      return () => {};
    }
    const isNew = !S.map.has(spell.id), quiet = performance.now() < (S.quietUntil ?? 0);
    const entry = {
      id: spell.id, name: spell.name ?? spell.id, color: spell.color ?? 0xffffff, cast: spell.cast, rate: spell.rate ?? 0,
      icon: spell.icon ?? null, description: spell.description ?? '', hold: !!spell.hold, onRelease: typeof spell.onRelease === 'function' ? spell.onRelease : null,
      category: resolveCat(spell.category, spell.id),
    };
    S.map.set(spell.id, entry);
    if (quiet && isNew && S.heldId === spell.id) { S.heldId = null; select(spell.id, false); } // it was the selected one: keep it selected
    else if (!S.map.has(S.currentId)) S.currentId = spell.id;
    else if (isNew && !quiet && S.ready) { select(spell.id, false); ctx.hud?.show(`New spell: ${entry.name}`, 2.5); }
    refreshOrb();
    return () => {
      if (S.map.get(entry.id) !== entry) return; // replaced by a newer registration
      S.map.delete(entry.id);
      if (S.currentId === entry.id) { S.heldId = entry.id; S.currentId = S.map.keys().next().value ?? null; }
      refreshOrb();
    };
  }
  ctx.provide('spells', {
    register,
    list: () => Array.from(S.map.values(), (e) => ({ id: e.id, name: e.name, color: e.color, icon: e.icon, description: e.description, category: catOf(e), hold: e.hold, rate: e.rate })),
    current,
    select: (id) => select(id, false),
    bodies,
    setFavouriteSlots, setFavourite, toggleFavourite,
    favourites: () => { const a = []; for (let i = 0; i < FAV.slots; i++) a.push(favOf(i)); return a; },
    favouriteSlots: () => FAV.slots,
    recent: () => S.recent.filter((id) => S.map.has(id)),
    stickBusy: () => aHeld, // true while right A is held: the right stick is the wheel's (a smooth-turn implementation should skip turning then)
  });
  ctx.on('modules:synced', () => { S.ready = true; });
  refreshOrb();

  // ======================================================================================================================== the spell wheel
  // Geometry (metres in wheel space, drawn at the hand facing the head): hub disc r 0.115 | inner ring of 8 wedges r 0.125-0.215 | the open
  // wedge's spells on an arc at r 0.295. Two draw calls: `face` (one atlas canvas: glass, ring, 12 arc cells, highlight sprites; moving parts are
  // vertex edits, the canvas is redrawn only when the ring / arc content changes) and `hub` (its own canvas, redrawn when the hover changes).
  // Text sizes: arc names 30 px, ring labels 26 px, hub description 25 px at 2304 px/m (see PPM) = 1.24 deg for the smallest text at 0.5 m.
  const TAU = Math.PI * 2, PI8 = Math.PI / 8;
  const HUBR = 0.115, RI0 = 0.125, RI1 = 0.215, RA = 0.295, STEP = 0.32, CAP = 12, PPM = 2304, SPAN = 256 / PPM;
  const AW = 2048, AH = 1024, HW = 640, HH = 576;
  const TR = 0.10, TA = 0.30;                       // hand travel (m) / aim change that equal a pointer deflection of 1
  const HUB_N = 0.26, OUT_ENTER = 0.78, OUT_EXIT = 0.58, DWELL = 0.15;
  const MORE = '\u0000more', DIM = 0.7;
  const SPR_W = 0.17, SPR_H = 0.113, RC = (RI0 + RI1) / 2;
  const Q_BACK = 0, Q_RING = 1, Q_OPEN = 2, Q_HOVER = 3, Q_CELL = 4, Q_GLOW = 16, Q_HOT = 17, NQ = 18;
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
  const font = (px, w = 600) => `${w} ${px}px ${FONT}`;
  const css = (c, a = 1, k = 1) => `rgba(${Math.min(255, ((c >> 16) & 255) * k) | 0},${Math.min(255, ((c >> 8) & 255) * k) | 0},${Math.min(255, (c & 255) * k) | 0},${a})`;
  const cssHex = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  const hasDoc = typeof document !== 'undefined' && document.createElement;
  const wedgeUI = (i) => (i === 0 ? FAV_UI : i === 7 ? REC_UI : CAT_UI[CATS[i - 1]]);
  const wedgeCount = (i) => (i === 0 || i === 7 ? 1 : catIds(CATS[i - 1]).length);

  const wheel = new THREE.Group();
  wheel.visible = false;
  ctx.root.add(wheel);

  // a batch of textured quads in ONE geometry (one draw call); every edit is a vertex write, nothing is allocated
  const CX4 = [-1, 1, -1, 1], CY4 = [1, 1, -1, -1];
  function mkBatch(nq, tw, th, tex, order) {
    const pos = new Float32Array(nq * 12), uv = new Float32Array(nq * 8), col = new Float32Array(nq * 12).fill(1), idx = new Uint16Array(nq * 6);
    for (let q = 0; q < nq; q++) { const v = q * 4, o = q * 6; idx[o] = v; idx[o + 1] = v + 2; idx[o + 2] = v + 1; idx[o + 3] = v + 2; idx[o + 4] = v + 3; idx[o + 5] = v + 1; }
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3), ua = new THREE.BufferAttribute(uv, 2), ca = new THREE.BufferAttribute(col, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage); ua.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa); geo.setAttribute('uv', ua); geo.setAttribute('color', ca); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order; mesh.frustumCulled = false; mesh.userData.noShadow = mesh.userData.noOutline = mesh.userData.noCull = true;
    return {
      geo, mat, mesh,
      quad(q, cx, cy, w, h, rot = 0) { // centre, size, rotation clockwise from up (radians)
        const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hh = h / 2, o = q * 12;
        for (let i = 0; i < 4; i++) { const x = CX4[i] * hw, y = CY4[i] * hh; pos[o + i * 3] = cx + x * c + y * s; pos[o + i * 3 + 1] = cy - x * s + y * c; pos[o + i * 3 + 2] = 0; }
        pa.needsUpdate = true;
      },
      hide(q) { const o = q * 12; for (let i = 0; i < 12; i++) pos[o + i] = 0; pa.needsUpdate = true; },
      rect(q, x, y, w, h) { // texture region in canvas pixels
        const u0 = x / tw, u1 = (x + w) / tw, v1 = 1 - y / th, v0 = 1 - (y + h) / th, o = q * 8;
        uv[o] = u0; uv[o + 1] = v1; uv[o + 2] = u1; uv[o + 3] = v1; uv[o + 4] = u0; uv[o + 5] = v0; uv[o + 6] = u1; uv[o + 7] = v0;
        ua.needsUpdate = true;
      },
      tint(q, r, g, b) { const o = q * 12; for (let i = 0; i < 4; i++) { col[o + i * 3] = r; col[o + i * 3 + 1] = g; col[o + i * 3 + 2] = b; } ca.needsUpdate = true; },
      dispose() { geo.dispose(); mat.dispose(); },
    };
  }
  const mkCanvas = (w, h) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    return { cv, g: cv.getContext('2d'), tex };
  };

  let gfx = null; // built on first open: nothing exists (or costs anything) until the wheel is used
  function ensureGfx() {
    if (gfx || !hasDoc) return gfx;
    const atlas = mkCanvas(AW, AH), hubC = mkCanvas(HW, HH);
    const face = mkBatch(NQ, AW, AH, atlas.tex, 880), hub = mkBatch(2, HW, HH, hubC.tex, 881);
    gfx = { atlas, hubC, face, hub, ringKey: '', cellKey: '', hubKey: '' };
    wheel.add(face.mesh, hub.mesh);
    drawSprites(atlas.g, hubC.g);
    face.quad(Q_BACK, 0, 0, 0.84, 0.84); face.rect(Q_BACK, 1792, 768, 256, 256);
    face.quad(Q_RING, 0, 0, 1024 / PPM, 1024 / PPM); face.rect(Q_RING, 0, 0, 1024, 1024);
    for (const q of [Q_OPEN, Q_HOVER]) { face.rect(q, 1024, 768, 256, 170); face.hide(q); }
    for (let j = 0; j < CAP; j++) { face.rect(Q_CELL + j, 1024 + (j & 3) * 256, (j >> 2) * 256, 256, 256); face.hide(Q_CELL + j); }
    face.rect(Q_GLOW, 1280, 768, 256, 256); face.hide(Q_GLOW); face.hide(Q_HOT); face.rect(Q_HOT, 1024, 0, 256, 256);
    hub.quad(0, 0, 0, 0.25, 0.25); hub.rect(0, 64, 0, 576, 576);
    hub.quad(1, 0, 0, 0.03, 0.03); hub.rect(1, 0, 0, 64, 64);
    return gfx;
  }
  function star(g, cx, cy, ro, ri) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i & 1 ? ri : ro; if (i) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath();
  }
  function drawSprites(g, gh) { // the static sprites: glass disc, wedge glow, cell glow ring (atlas) and the pointer dot (hub canvas)
    g.clearRect(1024, 768, 1024, 256);
    let gr = g.createRadialGradient(1920, 896, 0, 1920, 896, 128);
    gr.addColorStop(0, 'rgba(34,28,84,0.92)'); gr.addColorStop(0.55, 'rgba(20,16,56,0.88)'); gr.addColorStop(0.84, 'rgba(12,9,36,0.62)'); gr.addColorStop(1, 'rgba(12,9,36,0)');
    g.fillStyle = gr; g.fillRect(1792, 768, 256, 256);
    // wedge glow: one wedge pointing up, in a 256 x 170 px sprite (SPR_W x SPR_H m) that is later rotated onto the wedge
    const k = 256 / SPR_W, cx = 1024 + 128, cy = 768 + 85 + RC * k;
    g.save(); g.beginPath(); g.rect(1024, 768, 256, 170); g.clip(); g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8;
    g.beginPath(); g.arc(cx, cy, RI1 * k, -Math.PI / 2 - PI8 + 0.03, -Math.PI / 2 + PI8 - 0.03); g.arc(cx, cy, RI0 * k, -Math.PI / 2 + PI8 - 0.03, -Math.PI / 2 - PI8 + 0.03, true); g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke(); g.restore();
    g.save(); g.shadowColor = 'rgba(255,215,90,1)'; g.shadowBlur = 16; g.lineWidth = 8; g.strokeStyle = 'rgba(255,225,120,0.95)';
    g.beginPath(); g.arc(1408, 896, 60, 0, TAU); g.stroke(); g.restore();
    gh.clearRect(0, 0, 64, 64);
    gh.beginPath(); gh.arc(32, 32, 21, 0, TAU); gh.lineWidth = 11; gh.strokeStyle = 'rgba(8,6,24,0.85)'; gh.stroke();
    gh.beginPath(); gh.arc(32, 32, 21, 0, TAU); gh.lineWidth = 6; gh.strokeStyle = '#ffd75a'; gh.stroke();
    gh.beginPath(); gh.arc(32, 32, 4.5, 0, TAU); gh.fillStyle = '#ffffff'; gh.fill();
    gfx.atlas.tex.needsUpdate = true; gfx.hubC.tex.needsUpdate = true;
  }

  // ---- ring (8 wedges) and arc cells, drawn into the atlas
  function drawRing() {
    const g = gfx.atlas.g, C = 512, ro = RI1 * PPM, ri = RI0 * PPM, half = PI8 - 0.03;
    g.clearRect(0, 0, 1024, 1024);
    for (let i = 0; i < 8; i++) {
      const u = wedgeUI(i), n = W.cnt[i], on = n > 0, phi = i * Math.PI / 4, a0 = phi - half - Math.PI / 2, a1 = phi + half - Math.PI / 2;
      g.beginPath(); g.arc(C, C, ro, a0, a1); g.arc(C, C, ri, a1, a0, true); g.closePath();
      let gr = g.createRadialGradient(C, C, ri, C, C, ro);
      gr.addColorStop(0, 'rgba(36,30,84,0.96)'); gr.addColorStop(1, 'rgba(20,16,54,0.96)');
      g.fillStyle = gr; g.fill();
      gr = g.createRadialGradient(C, C, ri, C, C, ro);
      gr.addColorStop(0, css(u.color, on ? 0.16 : 0.04)); gr.addColorStop(1, css(u.color, on ? 0.44 : 0.07));
      g.fillStyle = gr; g.fill();
      g.lineWidth = 3; g.strokeStyle = css(u.color, on ? 0.9 : 0.28); g.stroke();
      const mr = (ro + ri) / 2 + 4, mx = C + Math.sin(phi) * mr, my = C - Math.cos(phi) * mr, iy = my - 17, ly = my + 33;
      g.globalAlpha = on ? 1 : 0.4;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (i === 0) { star(g, mx, iy, 28, 12); g.fillStyle = '#ffd75a'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(8,6,24,0.8)'; g.stroke(); }
      else if (i === 7) { // recent: a circular arrow
        g.beginPath(); g.arc(mx, iy, 20, -Math.PI * 0.2, Math.PI * 1.3, false); g.lineWidth = 7; g.lineCap = 'round'; g.strokeStyle = '#cfd6ff'; g.stroke();
        g.beginPath(); g.moveTo(mx + 6, iy - 30); g.lineTo(mx + 26, iy - 18); g.lineTo(mx + 4, iy - 8); g.closePath(); g.fillStyle = '#cfd6ff'; g.fill();
      } else { g.font = font(54, 400); g.fillStyle = '#ffffff'; g.fillText(u.icon, mx, iy + 2); }
      g.font = font(26, 700); g.fillStyle = '#f2f0ff'; g.fillText(u.name, mx, ly);
      g.globalAlpha = 1;
    }
    g.beginPath(); g.arc(C, C, ro + 6, 0, TAU); g.lineWidth = 2; g.strokeStyle = 'rgba(255,215,120,0.32)'; g.stroke();
    g.beginPath(); g.arc(C, C, ri - 6, 0, TAU); g.lineWidth = 2; g.strokeStyle = 'rgba(255,215,120,0.32)'; g.stroke();
  }
  function drawCell(j, it) { // it: spell id | null (empty favourite slot) | MORE
    const g = gfx.atlas.g, ox = 1024 + (j & 3) * 256, oy = (j >> 2) * 256, cx = 128, cy = 82, r = 58;
    g.save(); g.translate(ox, oy); g.clearRect(0, 0, 256, 256);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (it === MORE) {
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = 'rgba(74,85,110,0.95)'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
      g.beginPath(); g.moveTo(cx - 14, cy - 26); g.lineTo(cx + 22, cy); g.lineTo(cx - 14, cy + 26); g.closePath(); g.fillStyle = '#ffffff'; g.fill();
      g.font = font(30, 700); g.fillStyle = '#ffffff'; g.lineWidth = 7; g.lineJoin = 'round'; g.strokeStyle = 'rgba(8,6,24,0.95)';
      const t = `More ${W.page + 1}/${W.pages}`; g.strokeText(t, 128, 200); g.fillText(t, 128, 200);
    } else if (!it) {
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = 'rgba(255,215,90,0.10)'; g.fill();
      g.setLineDash([12, 9]); g.lineWidth = 4; g.strokeStyle = 'rgba(255,215,90,0.85)'; g.stroke(); g.setLineDash([]);
      star(g, cx, cy + 2, 30, 13); g.lineWidth = 5; g.strokeStyle = 'rgba(255,215,90,0.9)'; g.stroke();
      g.font = font(30, 700); g.fillStyle = 'rgba(255,225,140,0.95)'; g.lineWidth = 7; g.lineJoin = 'round'; g.strokeStyle = 'rgba(8,6,24,0.95)'; g.strokeText('Empty', 128, 200); g.fillText('Empty', 128, 200);
    } else {
      const e = S.map.get(it);
      if (!e) { g.restore(); return; }
      if (it === S.currentId) { g.beginPath(); g.arc(cx, cy, r + 9, 0, TAU); g.lineWidth = 6; g.strokeStyle = '#ffd75a'; g.stroke(); }
      const gr = g.createRadialGradient(cx - 14, cy - 22, 6, cx, cy, r);
      gr.addColorStop(0, css(e.color, 1, 1.2)); gr.addColorStop(0.6, css(e.color, 1, 0.8)); gr.addColorStop(1, css(e.color, 1, 0.42));
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = gr; g.fill(); g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,0.88)'; g.stroke();
      const icon = e.icon && !MOJIBAKE.test(e.icon) ? e.icon : String(e.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'; // (an icon string that was double-encoded somewhere shows initials instead of garbage)
      const letters = /^[A-Za-z0-9]+$/.test(icon);
      g.font = font(letters ? (icon.length > 1 ? 54 : 62) : 64, letters ? 700 : 400); g.fillStyle = '#ffffff'; g.fillText(icon, cx, cy + 3);
      if (isFav(it)) { star(g, cx + 46, cy - 46, 21, 9); g.fillStyle = '#ffd75a'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(8,6,24,0.9)'; g.stroke(); }
      const name = shortName(e);
      let px = name.length > 9 ? 27 : 30; g.font = font(px, 700);
      while (px > 24 && g.measureText(name).width > 224) { px -= 2; g.font = font(px, 700); }
      g.fillStyle = '#ffffff'; g.lineWidth = 7; g.lineJoin = 'round'; g.strokeStyle = 'rgba(8,6,24,0.95)'; g.strokeText(name, 128, 200); g.fillText(name, 128, 200);
    }
    g.restore();
  }

  // ---- wheel state. W is also exposed as ctx.state.spells.wheel (read-only, for tests / diagnostics)
  const W = S.wheel = {
    open: false, wedge: 1, page: 0, pages: 1, n: 0, ids: [], cellA: new Float32Array(CAP), cellX: new Float32Array(CAP), cellY: new Float32Array(CAP),
    cnt: new Int8Array(8), hc: -1, hw: -1, key: -2, lock: 0, outer: false, dwellW: -1, dwell: 0, k: 1, rho: 0, ang: 0, px: 0, py: 0,
  };
  let wheelOpen = false, aHeld = false, stickArmed = true, flicked = false, hotJ = 0, hotOn = false, hid = -1;
  const FV = new Float64Array(4); // per-frame timers in a typed array (a closure variable holding a double allocates on every write): [0] star-hold, [1] hover grow, [2] star glow, [3] A held
  let favDone = false, tapAt = -9; // trigger-hold time on the hovered entry (marks a favourite), pending A tap for the double-tap
  const right = new Vector3(), up = new Vector3(), pos0 = new Vector3(), dir0 = new Vector3();
  let d0r = 0, d0u = 0;

  function arcList(w) { // everything the arc of wedge w can show: spell ids (null = empty favourite slot)
    if (w === 0) { const a = []; for (let i = 0; i < FAV.slots; i++) a.push(favOf(i)); return a; }
    if (w === 7) return S.recent.filter((id) => S.map.has(id));
    return catIds(CATS[w - 1]);
  }
  function buildArc() { // fill W.ids / cell positions for wedge W.wedge, page W.page; redraw the arc cells
    const all = arcList(W.wedge), over = all.length > CAP, per = over ? CAP - 1 : CAP;
    W.pages = over ? Math.ceil(all.length / per) : 1;
    W.page = ((W.page % W.pages) + W.pages) % W.pages;
    let n = 0;
    for (let i = W.page * per, e = Math.min(all.length, i + per); i < e; i++) W.ids[n++] = all[i];
    if (over) W.ids[n++] = MORE;
    W.n = n; W.ids.length = n;
    const phi = W.wedge * Math.PI / 4;
    for (let j = 0; j < n; j++) {
      const a = phi + (j - (n - 1) / 2) * STEP;
      W.cellA[j] = ((a % TAU) + TAU) % TAU; W.cellX[j] = Math.sin(a) * RA; W.cellY[j] = Math.cos(a) * RA;
    }
    W.key = -2; FV[1] = 0;
    const G = gfx;
    if (!G) return;
    const key = W.wedge + ':' + W.page + ':' + W.ids.join(',') + ':' + S.currentId + ':' + FAV.ids.join(',') + ':' + FAV.slots;
    if (key !== G.cellKey) {
      G.cellKey = key;
      G.atlas.g.clearRect(1024, 0, 1024, 768);
      for (let j = 0; j < n; j++) drawCell(j, W.ids[j]);
      G.atlas.tex.needsUpdate = true;
    }
    for (let j = 0; j < CAP; j++) {
      if (j < n) { G.face.quad(Q_CELL + j, W.cellX[j], W.cellY[j], SPAN, SPAN); G.face.tint(Q_CELL + j, DIM, DIM, DIM); } else G.face.hide(Q_CELL + j);
    }
    G.face.hide(Q_GLOW); G.face.hide(Q_HOT); hotOn = false; hid = -1;
    const oc = hex(wedgeUI(W.wedge).color);
    G.face.quad(Q_OPEN, Math.sin(phi) * RC, Math.cos(phi) * RC, SPR_W, SPR_H, phi);
    G.face.tint(Q_OPEN, oc.r, oc.g, oc.b);
  }
  function relayout() { // content changed under an open wheel (favourite slots / stars): redraw ring + arc
    if (!wheelOpen) return;
    const G = gfx;
    if (G) G.ringKey = '';
    ringIfNeeded();
    buildArc(); setHover(W.hc, W.hw, true);
  }
  layoutHook = relayout;
  function countWedges() { for (let i = 0; i < 8; i++) W.cnt[i] = Math.min(100, wedgeCount(i)); } // (per open, never per frame)
  function ringIfNeeded() {
    const G = gfx;
    countWedges();
    if (!G) return;
    let key = '';
    for (let i = 0; i < 8; i++) key += W.cnt[i] + ',';
    if (key === G.ringKey) return;
    G.ringKey = key; drawRing(); G.atlas.tex.needsUpdate = true;
  }

  // ---- hub text
  function wrap(g, text, x, y, maxW, lh, maxLines) {
    const words = String(text).split(' ');
    let line = '', n = 0;
    for (let i = 0; i < words.length; i++) {
      const t = line ? line + ' ' + words[i] : words[i];
      if (line && g.measureText(t).width > maxW) {
        n++;
        if (n >= maxLines) { let s = line + '…'; while (s.length > 3 && g.measureText(s).width > maxW) s = s.slice(0, -2) + '…'; g.fillText(s, x, y); return n; }
        g.fillText(line, x, y); y += lh; line = words[i];
      } else line = t;
    }
    if (line) { g.fillText(line, x, y); n++; }
    return n;
  }
  function quickPick(w) { // release on a wedge: the spell it stands for
    if (w === 0) { for (let i = 0; i < FAV.slots; i++) { const id = favOf(i); if (id && id !== S.currentId) return id; } return favOf(0); }
    if (w === 7) { for (const id of S.recent) if (id !== S.currentId && S.map.has(id)) return id; return null; }
    const cat = CATS[w - 1], l = S.catLast[cat];
    if (l && S.map.has(l) && catOf(S.map.get(l)) === cat) return l;
    return catIds(cat)[0] ?? null;
  }
  function drawHub() {
    const G = gfx;
    if (!G) return;
    let tag, name, desc = '', hint = '', nameCol = '#ffffff', tagCol = '#ffd75a', hintCol = '#ffd75a';
    const hc = W.hc, hw = W.hw, cur = current(), it = hc >= 0 ? W.ids[hc] : undefined;
    if (hc >= 0 && it === MORE) { tag = wedgeUI(W.wedge).name.toUpperCase(); name = 'More spells'; desc = `Release to show page ${((W.page + 1) % W.pages) + 1} of ${W.pages}`; }
    else if (hc >= 0 && (!it || !S.map.has(it))) { tag = 'FAVOURITE SLOT'; name = 'Empty'; desc = 'Hover any spell and hold the trigger to star it here.'; }
    else if (hc >= 0) {
      const e = S.map.get(it);
      tag = (CAT_UI[catOf(e)].name + (e.hold ? ' · hold' : '')).toUpperCase(); tagCol = cssHex(CAT_UI[catOf(e)].color);
      name = e.name; nameCol = cssHex(e.color); desc = e.description || (e.hold ? 'Hold the trigger to keep casting.' : 'Pull the trigger to cast.');
      hint = isFav(it) ? '★ hold trigger to unstar' : '☆ hold trigger to star';
    } else if (hw >= 0) {
      const u = wedgeUI(hw), n = hw === 0 ? FAV.slots : arcList(hw).length, q = quickPick(hw);
      tag = 'CATEGORY'; tagCol = cssHex(u.color); name = u.name; nameCol = cssHex(u.color);
      desc = hw === 0 ? `${[...Array(FAV.slots).keys()].filter((i) => favOf(i)).length} of ${FAV.slots} slots used` : hw === 7 ? (n ? `The last ${n} spells you cast` : 'Spells you cast show up here.') : `${n} spell${n === 1 ? '' : 's'}`;
      hint = q ? 'release: ' + S.map.get(q).name : 'slide out along the arc';
    } else if (cur) {
      tag = ('NOW · ' + CAT_UI[catOf(cur)].name).toUpperCase(); tagCol = cssHex(CAT_UI[catOf(cur)].color);
      name = cur.name; nameCol = cssHex(cur.color); desc = cur.description || '';
      hint = 'point at a category, then a spell';
    } else { tag = 'NO SPELLS'; name = 'Nothing yet'; desc = 'Ask the Omnissiah for a spell.'; }
    const key = tag + '|' + name + '|' + desc + '|' + hint;
    if (key === G.hubKey) return;
    G.hubKey = key;
    const g = G.hubC.g, cx = 352, cy = 288;
    g.clearRect(64, 0, 576, 576);
    const gr = g.createRadialGradient(cx, cy - 30, 10, cx, cy, 268);
    gr.addColorStop(0, 'rgba(38,31,88,0.97)'); gr.addColorStop(1, 'rgba(16,12,44,0.97)');
    g.beginPath(); g.arc(cx, cy, 266, 0, TAU); g.fillStyle = gr; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,215,120,0.9)'; g.stroke();
    g.beginPath(); g.arc(cx, cy, 252, 0, TAU); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,215,120,0.28)'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = font(24, 700); g.fillStyle = tagCol; g.fillText(tag, cx, cy - 122);
    let px = 46; g.font = font(px, 700);
    while (px > 28 && g.measureText(name).width > 420) { px -= 3; g.font = font(px, 700); }
    g.fillStyle = nameCol; g.fillText(name, cx, cy - 78);
    g.font = font(26, 500); g.fillStyle = '#e8eaf6';
    wrap(g, desc, cx, cy - 28, 410, 31, 3);
    if (hint) { g.font = font(24, 600); g.fillStyle = hintCol; g.fillText(hint, cx, cy + 112); }
    G.hubC.tex.needsUpdate = true;
  }
  function updateHL() { // wedge highlight sprites
    const G = gfx;
    if (!G) return;
    if (W.hw >= 0) { const p = W.hw * Math.PI / 4; G.face.quad(Q_HOVER, Math.sin(p) * RC, Math.cos(p) * RC, SPR_W, SPR_H, p); } else G.face.hide(Q_HOVER);
  }
  let tickAt = 0, snd = null;
  const TICK_O = { volume: 0.4 };
  function tickFx() { // haptic + a soft click, throttled
    buzz(0.2, 16);
    const now = performance.now();
    if (now - tickAt < 55) return;
    tickAt = now;
    let done = false;
    try { const au = ctx.world.audio; if (au && au.sfx) done = au.sfx('ui-tick', TICK_O) !== false; } catch (err) { done = false; }
    if (!done) { try { snd ??= ctx.world.kit?.sound?.(ctx, { volume: 0.7 }); if (snd) snd.tone({ freq: 2300, dur: 0.022, vol: 0.05, type: 'sine' }); } catch (err) { /* audio not ready */ } }
  }
  function setHover(hc, hw, force) {
    const key = hc >= 0 ? hc : hw >= 0 ? 100 + hw : -1;
    if (key === W.key && !force) return;
    const changed = key !== W.key;
    W.key = key; W.hc = hc; W.hw = hw; FV[0] = 0; FV[2] = 0;
    if (changed && key >= 0 && !force) tickFx();
    const G = gfx;
    if (G) {
      if (hc >= 0) { if (hc !== hotJ) FV[1] = Math.min(FV[1], 0.4); hotJ = hc; G.face.rect(Q_HOT, 1024 + (hc & 3) * 256, (hc >> 2) * 256, 256, 256); }
      drawHub(); updateHL();
    }
  }

  // ---- open / close
  function openWheel() {
    if (!S.map.size) return;
    releaseHold();
    const G = ensureGfx();
    FV[0] = 0; favDone = R.down.trigger;
    wheel.position.copy(R.position);
    wheel.lookAt(ctx.player.head);
    W.k = Math.max(0.8, Math.min(1.5, ctx.player.head.distanceTo(R.position) / 0.5)); // keeps the wheel's angular size roughly constant (0.4-0.75 m)
    wheel.scale.setScalar(W.k);
    wheel.updateMatrixWorld(true);
    right.setFromMatrixColumn(wheel.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(wheel.matrixWorld, 1).normalize();
    pos0.copy(R.position); dir0.copy(R.direction);
    d0r = dir0.dot(right); d0u = dir0.dot(up);
    const cur = current(), w = cur ? 1 + CATS.indexOf(catOf(cur)) : 1;
    W.wedge = w; W.page = 0;
    if (cur) { const l = arcList(w), i = l.indexOf(cur.id); if (i >= 0 && l.length > CAP) W.page = Math.floor(i / (CAP - 1)); }
    W.outer = false; W.dwellW = -1; W.dwell = 0; W.hc = -1; W.hw = -1; W.rho = 0;
    wheelOpen = true; W.open = true; wheel.visible = true;
    if (G) G.hubKey = '';
    ringIfNeeded();
    buildArc(); setHover(-1, -1, true);
    updateWheel(0);
    buzz(0.3, 30);
  }
  function closeWheel(choose) {
    if (!wheelOpen) return;
    if (choose) {
      const hc = W.hc, hw = W.hw;
      if (hc >= 0) {
        const it = W.ids[hc];
        if (it === MORE) { W.page++; W.lock = 0.6; buildArc(); setHover(-1, -1, true); buzz(0.25, 25); return; } // "More": flip the page, stay open
        if (it) select(it, true);
      } else if (hw >= 0) { const id = quickPick(hw); if (id) select(id, true); }
    }
    wheel.visible = false; wheelOpen = false; W.open = false; W.key = -2;
  }
  function openArc(w) {
    if (w === W.wedge) return;
    W.wedge = w; W.page = 0; buildArc(); updateHL(); setHover(-1, -1, true);
  }
  function nextWedge(dir) { // step the open arc to the next wedge that has something in it
    for (let k = 1; k <= 8; k++) { const w = (W.wedge + dir * k + 16) % 8; if (W.cnt[w] > 0) { openArc(w); buzz(0.2, 20); return; } }
  }

  const dotR = (rho) => (rho < HUB_N ? (rho / HUB_N) * (HUBR - 0.02) : rho < OUT_EXIT ? RI0 + ((rho - HUB_N) / (OUT_EXIT - HUB_N)) * (RI1 - RI0) : rho < OUT_ENTER ? RI1 + ((rho - OUT_EXIT) / (OUT_ENTER - OUT_EXIT)) * (RA - RI1) : RA + Math.min(0.012, (rho - OUT_ENTER) * 0.1));
  function updateWheel(dt) {
    _d.subVectors(R.position, pos0);
    const sx = _d.dot(right) / TR + (R.direction.dot(right) - d0r) / TA, sy = _d.dot(up) / TR + (R.direction.dot(up) - d0u) / TA;
    const rho = Math.hypot(sx, sy), ang = rho > 1e-6 ? (Math.atan2(sx, sy) + TAU) % TAU : 0;
    W.rho = rho; W.ang = ang; W.px = sx; W.py = sy; W.lock -= dt; // (lock: just after a page flip the pointer may sit past the shorter arc: do not hop to another category)
    if (W.outer) { if (rho < OUT_EXIT) W.outer = false; } else if (rho >= OUT_ENTER) W.outer = true;
    let hc = -1, hw = -1;
    if (rho >= HUB_N) {
      const w = Math.round(ang / (TAU / 8)) % 8;
      if (W.outer) {
        let best = -1, bd = STEP * 0.62;
        for (let j = 0; j < W.n; j++) { let d = (ang - W.cellA[j]) % TAU; if (d < 0) d += TAU; if (d > Math.PI) d = TAU - d; if (d < bd) { bd = d; best = j; } }
        if (best < 0 && W.lock <= 0 && w !== W.wedge && W.cnt[w] > 0) { openArc(w); bd = STEP * 0.62; for (let j = 0; j < W.n; j++) { let d = (ang - W.cellA[j]) % TAU; if (d < 0) d += TAU; if (d > Math.PI) d = TAU - d; if (d < bd) { bd = d; best = j; } } }
        hc = best;
      } else {
        hw = w;
        if (w !== W.wedge && W.cnt[w] > 0) { if (W.dwellW !== w) { W.dwellW = w; W.dwell = 0; } else { W.dwell += dt; if (W.dwell >= DWELL) { openArc(w); W.dwellW = -1; } } } else { W.dwellW = -1; W.dwell = 0; }
      }
    } else { W.dwellW = -1; W.dwell = 0; }
    setHover(hc, hw, false);

    // hold the trigger on a spell for ~0.6 s: star / unstar it (a firm haptic tick)
    const it = W.hc >= 0 ? W.ids[W.hc] : null;
    if (it && it !== MORE && R.down.trigger) {
      FV[0] += dt; FV[2] = Math.min(1, FV[0] / 0.6);
      if (FV[0] >= 0.6 && !favDone) { // (favDone stays set until the trigger is released: one toggle per press)
        favDone = true;
        const on = toggleFavourite(it);
        buzz(0.7, 45);
        ctx.hud?.show(`${S.map.get(it).name} ${on ? 'starred' : 'unstarred'}`, 1.4);
        const G = gfx; if (G) G.cellKey = '';
        buildArc(); setHover(W.hc, W.hw, true); return; // the arc redraws (a star badge appears / disappears; the ★ arc loses or gains a cell)
      }
    } else { FV[0] = 0; FV[2] = 0; }
    if (!R.down.trigger) favDone = false;

    // moving parts: the hovered cell grows (a copy drawn on top), its gold ring swells while the star hold fills, the pointer dot
    const G = gfx;
    if (G) {
      const kk = dt > 0 ? 1 - Math.exp(-16 * dt) : 1;
      FV[1] += ((W.hc >= 0 ? 1 : 0) - FV[1]) * kk;
      if (FV[1] > 0.01 && hotJ < W.n) {
        if (hid !== hotJ) { if (hid >= 0) G.face.quad(Q_CELL + hid, W.cellX[hid], W.cellY[hid], SPAN, SPAN); G.face.hide(Q_CELL + hotJ); hid = hotJ; } // (the grown copy replaces the cell)
        const s = 1 + 0.22 * FV[1], gs = (0.1078 * s + 0.0256) * (1 + 0.3 * FV[2]);
        G.face.quad(Q_HOT, W.cellX[hotJ], W.cellY[hotJ], SPAN * s, SPAN * s);
        G.face.quad(Q_GLOW, W.cellX[hotJ], W.cellY[hotJ] + 0.02 * s, gs, gs);
        hotOn = true;
      } else if (hotOn) { G.face.hide(Q_HOT); G.face.hide(Q_GLOW); hotOn = false; if (hid >= 0 && hid < W.n) G.face.quad(Q_CELL + hid, W.cellX[hid], W.cellY[hid], SPAN, SPAN); hid = -1; }
      const r = dotR(rho);
      G.hub.quad(1, rho > 1e-6 ? (sx / rho) * r : 0, rho > 1e-6 ? (sy / rho) * r : 0, 0.03, 0.03);
    }
    // the right stick (A is held): left/right = next / previous wedge, up/down = flip the page of a long category
    const x = R.stick.x, y = R.stick.y;
    if (stickArmed) {
      if (Math.abs(x) > 0.7) { nextWedge(x > 0 ? 1 : -1); stickArmed = false; }
      else if (Math.abs(y) > 0.7 && W.pages > 1) { W.page += y > 0 ? -1 : 1; W.lock = 0.6; buildArc(); setHover(-1, -1, true); stickArmed = false; buzz(0.2, 20); }
    } else if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) stickArmed = true;
  }
  function snapHold(on) { // the right stick snap-turns: keep that quiet while A is held (the stick belongs to the wheel then)
    const P = ctx.world.player;
    if (!P) return;
    if (on) { if (S.snapSaved === undefined) { S.snapSaved = P.snapEnabled; P.snapEnabled = false; } }
    else if (S.snapSaved !== undefined) { P.snapEnabled = S.snapSaved; S.snapSaved = undefined; }
  }
  if (S.snapSaved !== undefined) snapHold(false); // (a hot reload while A was held)

  // ---- casting
  let sparkle = null, holding = null;
  const holdArgs = { origin: new Vector3(), direction: new Vector3(), hand: R, ctx, dt: 0, first: false, hold: true };
  function failed(e, err) {
    console.error(`[spells] "${e.id}" failed`, err);
    ctx.hud?.show(`Spell "${e.name}" failed: ${err?.message ?? err}`, 3);
  }
  function originFor(out) {
    if (R.tracked && R.fingers) return out.copy(R.fingers.index).addScaledVector(R.direction, 0.03);
    return out.copy(R.position).addScaledVector(R.direction, 0.12);
  }
  function castNow(t) {
    const origin = originFor(new Vector3()), direction = R.direction.clone();
    const e = current();
    if (e) { S.lastBy[e.id] = t; touchRecent(e.id); }
    if (!e) {
      const kit = ctx.world.kit;
      if (!kit) return;
      sparkle ??= kit.particles(ctx, { count: 60, color: [0xffffff, 0x66ccff], size: [0.06, 0.01], life: [0.4, 0.9], speed: [0.4, 1.2], gravity: 1, drag: 1 });
      sparkle.emit(origin, 10, _v.copy(direction).multiplyScalar(1.5));
      return;
    }
    try {
      const r = e.cast({ origin, direction, hand: R, ctx });
      if (r && typeof r.catch === 'function') r.catch((err) => failed(e, err));
    } catch (err) { failed(e, err); }
    events.emit('spell:cast', { id: e.id, origin, direction });
  }
  function releaseHold() {
    const e = holding;
    if (!e) return;
    holding = null;
    if (e.onRelease) { try { e.onRelease({ hand: R, ctx }); } catch (err) { failed(e, err); } }
  }
  // A tap / a stick flick: step within the current category (dir 1/-1), or to the next category that has spells (stepCat)
  function cycle(dir = 1) {
    const e = current();
    if (!e) { ctx.hud?.show('No spells yet — ask the Omnissiah for one', 2.5); return; }
    const cat = catOf(e), ids = catIds(cat), i = Math.max(0, ids.indexOf(e.id)), j = (i + dir + ids.length) % ids.length;
    select(ids[j], `${S.map.get(ids[j]).name}  ·  ${CAT_UI[cat].name} ${j + 1}/${ids.length}`);
  }
  function stepCat(dir) {
    const e = current();
    if (!e) return;
    const c0 = CATS.indexOf(catOf(e));
    for (let k = 1; k <= CATS.length; k++) {
      const cat = CATS[(c0 + dir * k + CATS.length * 2) % CATS.length], ids = catIds(cat);
      if (!ids.length) continue;
      const l = S.catLast[cat], id = l && ids.includes(l) ? l : ids[0];
      select(id, `${CAT_UI[cat].name}: ${S.map.get(id).name}`); buzz(0.3, 30);
      return;
    }
  }
  // A tap: next spell in the category. With a favourite set the tap waits 0.35 s for a second one; a double-tap jumps between the favourites instead.
  function tapA(t) {
    let n = 0;
    for (let i = 0; i < FAV.slots; i++) if (favOf(i)) n++;
    if (!n) { cycle(); return; }
    if (tapAt > -1 && t - tapAt < 0.35) {
      tapAt = -9;
      let cur = -1;
      for (let i = 0; i < FAV.slots; i++) if (favOf(i) === S.currentId) cur = i;
      for (let k = 1; k <= FAV.slots; k++) { const id = favOf((cur + k + FAV.slots) % FAV.slots); if (id && id !== S.currentId) { select(id, true); buzz(0.3, 30); return; } }
      buzz(0.15, 20); // only the current one is a favourite
      return;
    }
    tapAt = t;
  }
  ctx.onDispose(() => {
    releaseHold(); snapHold(false); wheel.removeFromParent();
    if (gfx) { gfx.face.dispose(); gfx.hub.dispose(); gfx.atlas.tex.dispose(); gfx.hubC.tex.dispose(); gfx = null; }
  });

  return {
    update(dt, t) {
      if (t - (S.pruneT ?? 0) > 5) { S.pruneT = t; bodies(); } // forget removed bodies even if nobody asks for the list
      const on = R.connected;
      if (on) {
        if (R.pressed('a')) { aHeld = true; FV[3] = 0; flicked = false; stickArmed = Math.abs(R.stick.x) < 0.3; snapHold(true); }
        if (aHeld) {
          FV[3] += dt;
          if (!wheelOpen && FV[3] >= 0.25) openWheel();
          else if (!wheelOpen) { // a flick of the (otherwise snap-turning) right stick while A is held: next / previous category
            const x = R.stick.x;
            if (stickArmed && Math.abs(x) > 0.7) { stepCat(x > 0 ? 1 : -1); stickArmed = false; flicked = true; } else if (Math.abs(x) < 0.3) stickArmed = true;
          }
        }
        if (aHeld && !R.down.a) { aHeld = false; snapHold(false); if (wheelOpen) closeWheel(true); else if (FV[3] < 0.25 && !flicked) tapA(t); }
        if (tapAt > -1 && t - tapAt >= 0.35) { tapAt = -9; cycle(); } // a lone tap (favourites make us wait for a possible second one)
      } else { if (aHeld) snapHold(false); aHeld = false; tapAt = -9; if (wheelOpen) closeWheel(false); }
      if (wheelOpen) updateWheel(dt);

      const e = current(), weapon = ctx.world.weapons?.held?.right;
      const canCast = on && !wheelOpen && !weapon && !capturing();
      if (e && e.hold) {
        if (holding === e) {
          if (canCast && R.down.trigger) {
            holdArgs.first = false; holdArgs.dt = dt;
            originFor(holdArgs.origin); holdArgs.direction.copy(R.direction);
            try { const r = e.cast(holdArgs); if (r && typeof r.catch === 'function') r.catch((err) => failed(e, err)); } catch (err) { failed(e, err); releaseHold(); }
          } else releaseHold();
        } else {
          releaseHold();
          if (canCast && R.pressed('trigger')) {
            holding = e; S.lastBy[e.id] = t; touchRecent(e.id);
            holdArgs.first = true; holdArgs.dt = dt;
            originFor(holdArgs.origin); holdArgs.direction.copy(R.direction);
            events.emit('spell:cast', { id: e.id, origin: holdArgs.origin.clone(), direction: holdArgs.direction.clone() });
            try { const r = e.cast(holdArgs); if (r && typeof r.catch === 'function') r.catch((err) => failed(e, err)); } catch (err) { failed(e, err); releaseHold(); }
          }
        }
      } else {
        releaseHold();
        if (canCast) {
          const rate = e ? e.rate : 0, since = t - (e ? S.lastBy[e.id] ?? -10 : S.last); // cooldown is per spell
          if ((R.pressed('trigger') && since >= rate) || (rate > 0 && R.down.trigger && since >= rate)) castNow(t);
        }
      }
      orb.visible = on && !wheelOpen;
      const s = 1 + Math.sin(t * 5) * 0.12 + R.trigger * 0.4 + (holding ? 0.6 : 0);
      core.scale.setScalar(0.014 * s); halo.scale.setScalar(0.028 * s);
    },
    dispose() { releaseHold(); },
  };
}
