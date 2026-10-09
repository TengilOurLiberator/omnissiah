// core/travel.js — world.travel: the Omnissiah carries the player to whole PLACES (a generated 360 sky + the matching terrain, light, water, dressing, mood).
//
// For "take me to ...", "go to ...", "show me ...": call  ctx.world.travel.go('a volcanic island')  and `return {}`. Do NOT rebuild the sky or terrain by hand.
//   const h = ctx.world.travel.go('a volcanic island');       // prompt (fuzzy-matched to the atlas, else dreamed up by the local model: placeholder at once, sharpens in ~1 min)
//   ctx.world.travel.go({ prompt: 'a candy kingdom', terrain: 'rolling', grass: 1, water: { mode: 'lake' }, dressing: [{ lib: 'flower-patch', count: 8 }], ambience: 'luminous' });
//   ctx.world.travel.home();                                   // back to the twilight field, exactly as it was
//   h.state 'resolving'|'closing'|'switching'|'opening'|'arrived'|'failed'  h.ready = h.promise (resolves when the player has arrived; also h.then)  {instant:true} skips the iris.   Mixed reality: refused (the room is the place).
//   travel.current -> { name, prompt, meta } | null    travel.list() -> [{ name, slug, prompt }]    travel.preload(nameOrPrompt)    travel.busy
//   events: travel:start / travel:arrive / travel:home { name }.   world.contextProviders.place tells you where the player is.
// STARTER ATLAS (instant, cached): Volcanic Island, Snowy Pine Valley, Desert Dunes at Dusk, Misty Swamp, Alpine Meadow, Alien Crystal World,
//   Autumn Forest Clearing, Tropical Beach, Canyon Floor, Floating Sky Islands, Haunted Moor at Night, The Moon. Anything else is generated.
// SPEC (all optional; an atlas place brings its own): {
//   prompt, name, place: '<slug of a cached place>',            what to show; no place and a prompt -> dreamed up (image: '<path>' = from a picture)
//   terrain: 'field'|'plain'|'rolling'|'hills'|'dunes'|'craggy'|'island'|'snowfield'|'canyon' | { baseAmp, hillAmp, dune, crag, islandR, canyon, lift, lakeScale }
//   grass: 0..1, motes: 0..1, stones: bool,                      ground cover (sand, snow, rock and lava places have none)
//   water: { mode: 'none'|'lake'|'ocean', level: -0.9, color },  ocean = water to the horizon (use with terrain 'island')
//   ground: { a, b, far, rock, sand }, sky: { stars, aurora, haze, exposure, yaw },   overrides of what is read from the picture
//   dressing: [{ lib: 'rock-spires', count: 3, near: 28, far: 90, scale: 1.6 }],  library entries spawned around you (gone when you leave)
//   weather: [{ lib: 'embers', count: 140 }], ambience: 'ominous', music: 'tension', oracle: 'ominous' }

export const meta = { name: 'Travel', description: 'Generated places: a 360 sky, terrain, light and mood in one call' };

const INDEX_URL = '/assets/generated/places/index.json';

// terrain presets = world.env.setTerrain parameters (see core/world.js, TP)
const TERRAINS = {
  field: null,
  plain: { baseAmp: -0.85, hillAmp: -0.95 },
  rolling: { baseAmp: 5, hillAmp: 0.4 },
  hills: { baseAmp: 2, hillAmp: 1.3 },
  dunes: { baseAmp: -0.6, hillAmp: -0.7, dune: 4.5 },
  craggy: { baseAmp: 1, hillAmp: 0.8, crag: 9 },
  island: { baseAmp: 0.5, hillAmp: -0.7, islandR: 95, islandW: 70, seaDepth: 6, lift: 1.9, lakeScale: -1, crag: 3 },
  snowfield: { baseAmp: -0.3, hillAmp: 0.3, dune: 1.4 },
  canyon: { baseAmp: 0.5, hillAmp: -0.5, canyon: 55, crag: 2 },
};

// quick palette guesses (used until the real picture has been read): [zenith, mid, horizon, fogDensity, stars, sun elevation deg, sun colour, light]
const GUESS = {
  dusk: ['#1a1550', '#6a3b78', '#e88a64', 0.0046, 0.5, 12, '#ffb07a', 1],
  day: ['#3f78c8', '#86b4e6', '#d6e6f4', 0.0042, 0, 48, '#fff2d8', 1.15],
  night: ['#04061a', '#10173c', '#2c3a68', 0.0050, 1, 28, '#9fb4ff', 0.55],
  fire: ['#2a0c14', '#5c1c24', '#c4482c', 0.0070, 0.1, 14, '#ff8a4a', 0.8],
  snow: ['#8aa0c0', '#b8c6da', '#dde5ee', 0.0070, 0, 24, '#f4f4ff', 1.0],
  desert: ['#5c4a8c', '#c2755e', '#f2b374', 0.0050, 0.1, 10, '#ffc080', 1.1],
  swamp: ['#24302c', '#46564a', '#7f8c78', 0.0110, 0.1, 18, '#cbd6a8', 0.75],
  alien: ['#18104a', '#2e7a8c', '#b86ad0', 0.0050, 0.6, 20, '#a8f0ff', 0.9],
};
const GUESS_KEYS = [
  [/volcan|lava|fire|magma|hell|inferno|ember/, 'fire'], [/snow|ice|frozen|arctic|winter|tundra|glacier/, 'snow'],
  [/desert|dune|sahara|canyon|mesa|sand/, 'desert'], [/swamp|bog|marsh|fog|mist|murky/, 'swamp'],
  [/alien|crystal|planet|space|neon|cyber|magic/, 'alien'], [/night|moon|haunt|dark|graveyard|ghost|midnight|star/, 'night'],
  [/day|sun|meadow|beach|tropic|bright|alpine|summer|morning|noon/, 'day'],
];

export default function (ctx) {
  const THREE = ctx.THREE;
  const { Color, Vector3 } = THREE;
  const world = ctx.world;
  const S = ctx.state;
  const T = (S.t = S.t || { away: false, place: null, home: null, prevMoods: null, journey: 0 }); // survives hot reloads
  const PC = !!(ctx.quality && ctx.quality.pc);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const emit = (n, p) => ctx.events.emit(n, p);

  let disposed = false, quiet = false;
  const hudShow = (t, s) => { if (quiet) return; try { ctx.hud.show(t, s); } catch { /* ignore */ } };
  let index = null, indexPromise = null;       // places/index.json
  let handle = null;                            // the journey in progress
  let chain = Promise.resolve();
  let lastEnv = world.env || null;
  const dressing = [];                          // library handles spawned for the current place
  const texCache = new Map();                   // url -> Promise<Texture> (only the textures of the current place stay alive)
  let tex = { tiny: null, full: null, use: null };
  const pendingGen = new Map();                 // request id -> place being dreamed

  // ------------------------------------------------------------------ index / matching
  function loadIndex(force) {
    if (index && !force) return Promise.resolve(index);
    if (indexPromise && !force) return indexPromise;
    indexPromise = fetch(INDEX_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((j) => { index = j && typeof j === 'object' ? j : {}; indexPromise = null; return index; });
    return indexPromise;
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const stripLead = (s) => norm(s).replace(/^(please )?(take me|bring me|send me|carry me|teleport me|travel|go|show me|let s go|let us go|i want to go|i want to be)( to| into| in)?( the| a| an)? ?/, '').trim();
  function scoreEntry(text, slug, e) {
    const q = norm(text), name = norm(e.name || slug);
    if (!q) return 0;
    if (q === name || q === slug.replace(/-/g, ' ')) return 100;
    if (q.includes(name)) return 50;
    let s = 0;
    for (const kw of (e.spec && e.spec.keywords) || []) { const k = norm(kw); if (k && new RegExp(`(^| )${k}`).test(q)) s += 1; }
    for (const tok of name.split(' ')) if (tok.length > 2 && !/^(the|at|of|and|for)$/.test(tok) && new RegExp(`(^| )${tok}`).test(q)) s += 2;
    return s;
  }
  function matchAtlas(text) {
    if (!index) return { best: null, hits: 0 };
    const scored = Object.entries(index).map(([slug, e]) => ({ slug, e, s: scoreEntry(text, slug, e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (!scored.length) return { best: null, hits: 0 };
    const top = scored[0];
    const rivals = scored.filter((x) => x.s >= Math.max(1, top.s)).length; // several places equally strong -> a mix: make a new one
    return { best: top, hits: scored.length, rivals };
  }

  // ------------------------------------------------------------------ places
  const tidy = (o) => JSON.parse(JSON.stringify(o ?? null));
  // a cached place. Places made by other pipelines (a blast, a picture) come without a spec: guess terrain / water / cover from the words (strongest
  // atlas match) and from what the picture shows, so they still get a sensible ground. extraSpec (dressing, ...) always wins.
  function placeFromEntry(slug, e, extraSpec) {
    let base = tidy(e.spec);
    if (!base || !base.terrain) {
      const m = matchAtlas(`${e.prompt || ''} ${e.name || ''}`);
      const g = m.best && m.best.slug !== slug ? tidy(m.best.e.spec) || {} : {};
      delete g.keywords; delete g.dressing; delete g.weather;
      base = Object.assign({ terrain: 'rolling', grass: 0.7, motes: 0.3, stones: false, water: { mode: 'lake', level: -1.4 } }, g, base || {});
    }
    return { name: e.name || slug, prompt: e.prompt || e.name || slug, slug, meta: e.meta || null, urls: { tiny: e.preview, lo: e.url, hi: e.hi }, spec: Object.assign({}, base, extraSpec || {}), pending: false };
  }
  function guessKey(text) { const q = norm(text); for (const [re, k] of GUESS_KEYS) if (re.test(q)) return k; return 'dusk'; }
  function guessMeta(text) {
    const g = GUESS[guessKey(text)];
    const el = g[5] * Math.PI / 180;
    return {
      guess: true, horizon_deg: 0,
      sky: { zenith: g[0], mid: g[1], horizon: g[2] }, fog: { color: g[2], density: g[3] },
      sun: { dir: [-0.5 * Math.cos(el), Math.sin(el), -0.8 * Math.cos(el)], elevation: g[5], azimuth: -32, color: g[6], strength: 0.5, visible: false },
      ground: null, sea: null, stars: g[4], mean_luma: 0.1 * g[7], light: g[7],
    };
  }
  // text or spec object -> place (never throws)
  async function resolve(input) {
    await loadIndex();
    let spec = {}, text = '';
    if (input && typeof input === 'object') {
      spec = tidy(input) || {};
      if (spec.place && !spec.pano) spec.pano = String(spec.place); // { place: '<slug>' }: a place that already exists in the cache
      delete spec.place;
      text = spec.prompt || spec.name || spec.pano || '';
    } else text = String(input || '');
    const q = stripLead(text) || norm(text);
    if (spec.pano && !index[spec.pano]) await loadIndex(true); // made by another plugin a moment ago: the list is stale
    if (spec.pano && index[spec.pano]) return placeFromEntry(spec.pano, index[spec.pano], withoutKeys(spec, ['pano']));
    const m = spec.image ? { best: null } : matchAtlas(q); // (a picture always makes its own place)
    if (m.best && (m.rivals <= 1 || m.best.s >= 50)) {
      const { slug, e } = m.best;
      return placeFromEntry(slug, e, withoutKeys(spec, ['pano', 'prompt', 'name']));
    }
    // not in the atlas (or a mix of several): a new place. The spec comes from the strongest atlas match when there is one.
    const base = m.best ? tidy(m.best.e.spec) || {} : {};
    const merged = Object.assign({ terrain: 'rolling', grass: 0.8, motes: 0.5, stones: false, water: { mode: 'lake', level: -1.4 } }, base, withoutKeys(spec, ['pano', 'prompt', 'name']));
    const imagePath = typeof spec.image === 'string' ? spec.image : null;
    delete merged.image;
    delete merged.keywords;
    const prompt = (spec.prompt && String(spec.prompt)) || text || 'a strange new land';
    return { name: spec.name || prompt.replace(/^[a-z]/, (c) => c.toUpperCase()).slice(0, 40), prompt, slug: null, meta: guessMeta(`${q} ${merged.terrain || ''}`), urls: null, spec: merged, pending: true, image: imagePath };
  }
  function withoutKeys(o, keys) { const r = Object.assign({}, o); for (const k of keys) delete r[k]; return r; }

  // ------------------------------------------------------------------ textures
  function loadTexture(url, kind) {
    if (texCache.has(url)) return texCache.get(url);
    const p = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
        if (kind === 'tiny') { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
        else { t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = PC ? 4 : 1; }
        try { ctx.renderer.initTexture(t); } catch { /* uploaded on first use */ }
        resolve(t);
      }, undefined, () => reject(new Error(`could not load ${url}`)));
    });
    texCache.set(url, p);
    p.catch(() => texCache.delete(url));
    return p;
  }
  function freeTextures() {
    for (const t of [tex.tiny, tex.full]) { try { t && t.dispose(); } catch { /* ignore */ } }
    tex = { tiny: null, full: null, use: null };
    texCache.clear();
  }

  // ------------------------------------------------------------------ iris (a veil of light on a sphere around the head; the camera is never touched)
  const iris = (() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uClose: { value: 0 }, uAxis: { value: new Vector3(0, 0, -1) }, uCol: { value: new Color(0.96, 0.93, 1.0) }, uCol2: { value: new Color(1.0, 0.85, 0.55) }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uClose; uniform vec3 uAxis; uniform vec3 uCol; uniform vec3 uCol2; uniform float uTime; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float a = acos(clamp(dot(d, uAxis), -1.0, 1.0));
          float R = (1.0 - uClose) * 4.4;
          float veil = smoothstep(R - 0.6, R, a);
          float rim = smoothstep(R - 0.62, R - 0.3, a) * (1.0 - smoothstep(R - 0.25, R + 0.02, a));
          float ripple = 0.5 + 0.5 * sin(a * 26.0 - uTime * 5.0 + atan(d.x, d.z) * 3.0);
          float alpha = clamp(veil + rim * 0.5, 0.0, 1.0);
          if (alpha < 0.003) discard;
          vec3 col = mix(uCol2, uCol, smoothstep(0.0, 1.0, veil)) * (1.0 + rim * (0.6 + 0.6 * ripple));
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 12), mat);
    mesh.renderOrder = 1e7; mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'travel-iris';
    mesh.userData = { noShadow: true, noOutline: true, noCull: true, _shadowed: true, noBlob: true };
    ctx.root.add(mesh);
    const st = { v: T.irisClosed ? 1 : 0, to: T.irisClosed ? 1 : 0, dur: 1, from: 0, t: 1 };
    const ease = (x) => x * x * (3 - 2 * x);
    return {
      get value() { return st.v; },
      to(target, seconds) { st.from = st.v; st.to = target; st.dur = Math.max(0.0001, seconds); st.t = 0; if (seconds <= 0) { st.v = target; st.t = 1; } },
      done() { return st.t >= 1; },
      axis(v) { mat.uniforms.uAxis.value.copy(v); },
      tint(hex) { mat.uniforms.uCol.value.set(0.96, 0.93, 1.0).lerp(new Color(hex), 0.28); },
      update(dt, time) {
        if (st.t < 1) { st.t = Math.min(1, st.t + dt / st.dur); st.v = st.from + (st.to - st.from) * ease(st.t); }
        mat.uniforms.uClose.value = st.v; mat.uniforms.uTime.value = time;
        mesh.visible = st.v > 0.002;
        if (mesh.visible) ctx.camera.getWorldPosition(mesh.position);
      },
    };
  })();
  const tickUntil = async (fn, ms) => { const t0 = performance.now(); while (!disposed && !fn() && performance.now() - t0 < ms) await sleep(30); };
  const irisTo = async (v, s) => { iris.to(v, s); T.irisClosed = v >= 1; await tickUntil(() => iris.done(), s * 1000 + 1500); };

  // ------------------------------------------------------------------ applying a place to the world
  const hexLum = (c) => { const k = new Color(c); return k.r * 0.2126 + k.g * 0.7152 + k.b * 0.0722; };
  function sunWorldDir(meta, spec) {
    // picture azimuth -> world azimuth is  az - yaw ; the picture's own horizon is moved onto the true one (elevation - horizon_deg)
    const s = meta.sun || { azimuth: -30, elevation: 15 };
    let yaw = spec.sky && spec.sky.yaw != null ? +spec.sky.yaw : 0;
    const el = clamp((s.elevation || 15) - (meta.horizon_deg || 0), 6, 80);
    if (!(spec.sky && spec.sky.yaw != null) && meta.sun && !meta.guess && !meta.fromImage) { // (a place made from the player's picture keeps it in front)
      // keep the Omnissiah's sector (azimuth 0, high) free of the sun: swing the picture round if it is in the way
      const az0 = s.azimuth || 0;
      if (Math.abs(az0) < 55 && el > 6) yaw = az0 - (az0 >= 0 ? 78 : -78);
    }
    const az = ((s.azimuth || 0) - yaw) * Math.PI / 180, e = el * Math.PI / 180;
    return { dir: [Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)], yaw };
  }
  // set the sky, light, fog, ground and water from the derived state (meta) and the spec's overrides. env: world.env
  function applyMeta(env, place, opts) {
    const meta = place.meta || guessMeta(place.prompt), spec = place.spec || {};
    const sky = meta.sky;
    env.setSkyColors({ zenith: sky.zenith, mid: sky.mid, horizon: sky.horizon });
    const fogMul = spec.sky && spec.sky.fogMul != null ? +spec.sky.fogMul : 1;
    env.setFog(null, (meta.fog ? meta.fog.density : 0.0046) * fogMul);
    const { dir, yaw } = sunWorldDir(meta, spec);
    const ml = clamp(meta.mean_luma != null ? meta.mean_luma : 0.1, 0.01, 0.6);
    const strength = meta.sun ? clamp(meta.sun.strength, 0.15, 1) : 0.5;
    const L = meta.light != null ? meta.light : 1;
    const hemiI = clamp((0.5 + 1.2 * Math.sqrt(ml / 0.3)) * L, 0.45, 1.7);
    const dirI = clamp((0.35 + 1.5 * strength) * L * (0.6 + 0.8 * Math.sqrt(ml / 0.3)), 0.4, 2.1);
    const sunCol = new Color(meta.sun ? meta.sun.color : '#ffffff').lerp(new Color(sky.horizon), 0.35);
    env.setLight({ dir, color: sunCol, intensity: dirI * (spec.sky && spec.sky.sunMul != null ? +spec.sky.sunMul : 1), hemiIntensity: hemiI });
    env.setStars(spec.sky && spec.sky.stars != null ? +spec.sky.stars : (meta.stars || 0));
    env.setAurora(spec.sky && spec.sky.aurora != null ? +spec.sky.aurora : 0);
    place._yaw = yaw;

    // ground: the picture's lower hemisphere, divided by the irradiance it was lit with so that  albedo x our light = what the picture shows
    const g = meta.ground, go = spec.ground || {};
    const E = Math.max(0.12, hemiI * hexLum(new Color(sky.mid).lerp(new Color(1, 1, 1), 0.25)) + dirI * dir[1] * hexLum(sunCol));
    const toAlbedo = (hex, lift = 1, minLum = 0.03) => {
      const c = new Color(hex), k = clamp(lift / Math.max(E, 0.05), 0.6, 9);
      c.r = Math.min(0.7, c.r * k); c.g = Math.min(0.7, c.g * k); c.b = Math.min(0.7, c.b * k);
      { const g0 = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; c.r += (g0 - c.r) * 0.2; c.g += (g0 - c.g) * 0.2; c.b += (g0 - c.b) * 0.2; } // lit ground looks louder than the painted one
      const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; // never a black hole: dark places still show their ground
      if (l < minLum) { const m = Math.min(8, minLum / Math.max(l, 1e-4)); c.r = Math.min(0.85, c.r * m); c.g = Math.min(0.85, c.g * m); c.b = Math.min(0.85, c.b * m); }
      return c;
    };
    const lumG = g && g.lum != null ? g.lum : 0.1, tap = 1 - clamp((lumG - 0.1) / 0.25, 0, 1); // dark painted grounds read darker in linear light than they look; bright ones (snow, sand) need no lift
    const groundLift = (go.lift != null ? +go.lift : 1) * (1 + 0.7 * tap) * (1 - 0.35 * clamp((lumG - 0.3) / 0.3, 0, 1)); // (and snow / white sand must not clip)
    const gp = {};
    if (g) {
      gp.a = go.a ? toAlbedo(go.a, 1, 0) : toAlbedo(g.a, groundLift * 0.85, 0.028); gp.b = go.b ? toAlbedo(go.b, 1, 0) : toAlbedo(g.b, groundLift * 1.25, 0.06); // (spec overrides say how the ground should LOOK lit)
      gp.far = go.far ? toAlbedo(go.far, 1, 0) : new Color(sky.horizon).lerp(toAlbedo(g.mean, groundLift), 0.25);
      gp.sand = go.sand ? toAlbedo(go.sand, 1, 0) : toAlbedo(g.b, groundLift * 1.2).lerp(new Color(0.75, 0.68, 0.5), 0.35);
    } else { // placeholder: a dim version of the horizon colour until the picture has been read
      const h = new Color(sky.horizon);
      gp.a = go.a || h.clone().multiplyScalar(0.18); gp.b = go.b || h.clone().multiplyScalar(0.32); gp.far = go.far || h.clone().multiplyScalar(0.6);
    }
    if (go.rock != null) { gp.rock = toAlbedo(go.rock, 1, 0); gp.rockAmount = go.rockAmount != null ? go.rockAmount : 0.85; }
    else if (g) { gp.rock = toAlbedo(g.mid, groundLift); gp.rockAmount = go.rockAmount != null ? +go.rockAmount : (placeTerrainWantsRock(spec) ? 0.8 : 0); }
    gp.rockFrom = go.rockFrom != null ? go.rockFrom : 2.5; gp.rockTo = go.rockTo != null ? go.rockTo : 10;
    gp.farMix = 0.55;
    env.setGround(gp);

    // grass, motes, stones
    env.setGrass(spec.grass != null ? spec.grass : 1);
    env.setMotes(spec.motes != null ? spec.motes : 1);
    env.setStones(!!spec.stones);

    // water
    const w = spec.water || { mode: 'lake', level: -1.4 };
    const mode = w.mode || 'lake';
    const seaHex = g && meta.sea ? meta.sea : null;
    const lakeCol = w.color || new Color(sky.zenith).lerp(new Color(sky.horizon), 0.45).multiplyScalar(1.1);
    if (mode === 'ocean') {
      const oc = w.color || (seaHex ? new Color(seaHex).lerp(new Color(sky.mid), 0.35).multiplyScalar(1.4) : lakeCol);
      env.setOcean({ enabled: true, level: w.level != null ? w.level : -0.9, color: oc });
    } else {
      env.setOcean({ enabled: false });
      if (mode === 'none') env.setWater({ enabled: false });
      else env.setWater({ enabled: true, color: lakeCol, level: (w.level != null && Math.abs(env.waterLevel - w.level) > 1e-3) ? w.level : undefined });
    }
  }
  const placeTerrainWantsRock = (spec) => ['craggy', 'canyon', 'island', 'hills'].includes(spec.terrain) || (spec.terrain && typeof spec.terrain === 'object' && (spec.terrain.crag > 3 || spec.terrain.canyon));

  function applyPano(env, place, texture, instant) {
    const meta = place.meta || {}, spec = place.spec || {};
    if (!texture) { env.setSkyPano(null, { instant }); return; }
    const sk = spec.sky || {};
    env.setSkyPano(texture, { yaw: sk.yaw != null ? +sk.yaw : (place._yaw || 0), horizon: meta.horizon_deg || 0, haze: sk.haze != null ? +sk.haze : 0.65, exposure: sk.exposure != null ? +sk.exposure : 1, instant });
  }

  function clearDressing() {
    while (dressing.length) { const h = dressing.pop(); try { h && h.remove && h.remove(); } catch { /* ignore */ } }
  }
  const rand = (() => { let a = 0x9e3779b9; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const MULTI = /^(forest|grove|autumn-forest|dead-forest|palm-grove|spooky-forest|enchanted-grove)$/;
  function spawnDressing(place) {
    const lib = world.library, spec = place.spec || {}, env = world.env;
    if (!lib || !lib.spawn) return;
    const perf = world.perf;
    const scale = PC ? 1 : 0.6; // the headset's draw-call budget
    const spawnOne = (name, o) => { try { const h = lib.spawn(ctx, name, o); if (h) dressing.push(h); return h; } catch (err) { console.warn('[travel] dressing', name, err && err.message); return null; } };
    let budget = PC ? 90 : 36;
    for (const d of spec.dressing || []) {
      if (!d || !d.lib || (lib.has && !lib.has(d.lib))) continue;
      const near = d.near != null ? d.near : 10, far = d.far != null ? d.far : 60;
      if (MULTI.test(d.lib)) { // one handle for the whole grove (placed by the library)
        spawnOne(d.lib, Object.assign({ x: 0, z: 0 }, withoutKeys(d, ['lib', 'near', 'far']), { count: Math.max(1, Math.round((d.count || 20) * scale)), radius: d.radius || far }));
        continue;
      }
      const n = Math.min(Math.max(1, Math.round((d.count || 1) * scale)), budget);
      for (let i = 0; i < n && budget > 0; i++) {
        let x = 0, z = 0, ok = false;
        for (let k = 0; k < 14 && !ok; k++) {
          const r = Math.sqrt(near * near + rand() * (far * far - near * near)), a = rand() * Math.PI * 2;
          x = Math.cos(a) * r; z = Math.sin(a) * r;
          ok = !(env && env.isWater && env.isWater(x, z));
        }
        if (!ok) continue;
        budget--;
        spawnOne(d.lib, Object.assign({ x, z, position: { x, z } }, withoutKeys(d, ['lib', 'count', 'near', 'far'])));
      }
    }
    for (const w of spec.weather || []) { if (w && w.lib && (!lib.has || lib.has(w.lib))) spawnOne(w.lib, withoutKeys(w, ['lib'])); }
    void perf;
  }
  function applyMoods(place, entering) {
    const spec = place.spec || {};
    try {
      if (entering) {
        if (!T.prevMoods) T.prevMoods = { ambience: world.ambience && world.ambience.getMood ? world.ambience.getMood() : null, oracle: world.oracle && world.oracle.getMood ? world.oracle.getMood() : null };
        if (spec.ambience && world.ambience && world.ambience.setMood) world.ambience.setMood(spec.ambience);
        if (spec.music && world.audio && world.audio.setMood) world.audio.setMood(spec.music);
        if (spec.oracle && world.oracle && world.oracle.setMood) world.oracle.setMood(spec.oracle);
      } else {
        const p = T.prevMoods;
        if (world.ambience && world.ambience.setMood) world.ambience.setMood((p && p.ambience) || 'serene');
        if (world.audio && world.audio.setMood) world.audio.setMood(null);
        if (world.oracle && world.oracle.setMood) world.oracle.setMood(p ? p.oracle : null);
        T.prevMoods = null;
      }
    } catch (err) { console.warn('[travel] mood', err && err.message); }
  }

  // the whole world switch (called while the iris is closed, or instantly)
  function enter(place, o) {
    const env = world.env;
    if (!env) throw new Error('world.env is not available');
    if (!T.away) { T.home = env.snapshot(); T.homePos = [ctx.rig.position.x, ctx.rig.position.y, ctx.rig.position.z]; }
    T.away = true; T.place = tidy(place);
    clearDressing();
    const ease = o.easeSeconds != null ? o.easeSeconds : 0;
    env.setTransition(ease);
    env.batch(() => {
      const terrain = place.spec && place.spec.terrain != null ? place.spec.terrain : 'rolling';
      const tp = Object.assign({}, typeof terrain === 'string' ? TERRAINS[terrain] : terrain);
      const wm = place.spec && place.spec.water && place.spec.water.mode;
      if ((wm === 'none' || wm === 'ocean') && tp.lakeScale == null) tp.lakeScale = -1; // no dry lake bowl (it would show as dark mud) where there is no lake
      env.setTerrain(tp);
      applyMeta(env, place, o);
    }, { sync: !!o.syncTerrain });
    T.place = tidy(place); // (again: applyMeta has now decided the picture's yaw)
    applyPano(env, place, tex.use, true);
    ctx.rig.position.set(0, ctx.groundAt(0, 0), 0);
    spawnDressing(place);
    applyMoods(place, true);
  }
  function leave(o) {
    const env = world.env;
    clearDressing();
    if (env && T.home) { env.setSkyPano(null, { instant: true }); env.setTransition(0); env.restore(T.home, { instant: true, sync: !!o.syncTerrain }); env.setTransition(T.home.easeSeconds != null ? T.home.easeSeconds : 1.5); }
    freeTextures();
    applyMoods(T.place || {}, false);
    if (T.homePos) ctx.rig.position.set(T.homePos[0], ctx.groundAt(T.homePos[0], T.homePos[2]), T.homePos[2]);
    T.away = false; T.place = null; T.home = null; T.homePos = null;
  }

  // textures for a place: tiny first (fast), then the full picture. Returns { tinyP, fullP }.
  function startLoading(place) {
    const u = place.urls;
    if (!u) return { tinyP: Promise.resolve(null), fullP: Promise.resolve(null) };
    const tinyP = u.tiny ? loadTexture(u.tiny, 'tiny').catch(() => null) : Promise.resolve(null);
    const fullUrl = PC && u.hi ? u.hi : u.lo;
    const fullP = fullUrl ? loadTexture(fullUrl, 'full').catch(() => (u.lo && fullUrl !== u.lo ? loadTexture(u.lo, 'full').catch(() => null) : null)) : Promise.resolve(null);
    return { tinyP, fullP };
  }
  function adoptFull(place, t) {
    if (!t || !T.away || !world.env || disposed) return;
    const old = tex.use;
    tex.full = t; tex.use = t;
    applyPano(world.env, place, t, true);
    if (tex.tiny && tex.tiny !== t) { try { tex.tiny.dispose(); } catch { /* ignore */ } tex.tiny = null; }
    void old;
  }

  // ------------------------------------------------------------------ the journey
  const flareColor = (place) => { try { return new Color(place.meta && place.meta.sun ? place.meta.sun.color : '#ffd9a0'); } catch { return new Color(0xffd9a0); } };
  async function journey(h, place, opts) {
    const instant = !!opts.instant;
    const id = ++T.journey;
    quiet = !!opts.quiet;
    h.state = 'closing';
    emit('travel:start', { name: place.name, prompt: place.prompt });
    hudShow(`The Omnissiah carries you to ${place.name}`, 4);
    const fwd = new Vector3(); ctx.camera.getWorldDirection(fwd); iris.axis(fwd);
    iris.tint(place.meta && place.meta.sky ? place.meta.sky.horizon : '#ffffff');
    const O = world.oracle;
    try { if (O) { O.flare && O.flare(flareColor(place), 1.2); O.beamTo && O.beamTo(new Vector3(0, ctx.groundAt(0, 0), 0).add(new Vector3(fwd.x, 0, fwd.z).multiplyScalar(6)), { color: flareColor(place), duration: 2.2 }); } } catch { /* optional */ }
    const loading = startLoading(place);
    if (!instant) await irisTo(1, 1.3);
    if (disposed || id !== T.journey) return;
    h.state = 'switching';
    // textures: the small one must be here before the iris opens; the full one gets a short grace period
    const tinyTex = await Promise.race([loading.tinyP, sleep(2500).then(() => null)]);
    if (tinyTex) { tex.tiny = tinyTex; tex.use = tinyTex; }
    enter(place, { easeSeconds: 0, syncTerrain: instant });
    await tickUntil(() => !(world.env && world.env.terrainBusy), 4000);
    const fullTex = await Promise.race([loading.fullP, sleep(instant ? 0 : 1800).then(() => undefined)]);
    if (fullTex) adoptFull(place, fullTex);
    else loading.fullP.then((t) => adoptFull(place, t));
    if (world.env) world.env.setTransition(1.5);
    await sleep(instant ? 0 : 350);
    h.state = 'opening';
    iris.tint(place.meta && place.meta.sky ? place.meta.sky.horizon : '#ffffff');
    if (!instant) await irisTo(0, 1.6);
    else iris.to(0, 0);
    T.irisClosed = false;
    try { if (O && O.flare) O.flare(flareColor(place), 0.9); } catch { /* optional */ }
    h.state = 'arrived';
    api.current = { name: place.name, prompt: place.prompt, meta: place.meta, slug: place.slug };
    emit('travel:arrive', { name: place.name, prompt: place.prompt });
    if (place.pending) requestGeneration(place);
    return api.current;
  }

  // server generation of a place that is not in the atlas
  function requestGeneration(place) {
    const id = `place-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    pendingGen.set(id, place);
    const compact = withoutKeys(place.spec || {}, ['keywords']);
    try { ctx.net.send({ type: 'place', id, prompt: place.prompt, options: { name: place.name, spec: compact, image: place.image || undefined } }); } catch { /* offline: the guessed sky stays */ }
    hudShow('The Omnissiah is dreaming the horizon of this place...', 4);
  }
  ctx.on('net:place_status', async (m) => {
    const place = m && pendingGen.get(m.id);
    if (!place) return;
    if (m.state === 'error') { pendingGen.delete(m.id); hudShow(m.message || 'The place would not take shape; the guessed sky stays.', 5); return; }
    if (m.state !== 'done') return;
    pendingGen.delete(m.id);
    if (!T.away || !T.place || T.place.name !== place.name || disposed) return; // the player has moved on
    try {
      await loadIndex(true);
      place.meta = m.meta || place.meta; place.urls = { tiny: m.preview, lo: m.url, hi: m.hi }; place.pending = false;
      if (m.meta && m.meta.spec) place.spec = Object.assign({}, m.meta.spec, place.spec);
      const env = world.env;
      if (!env) return;
      const keepEase = 2.2;
      env.setTransition(keepEase);
      env.batch(() => applyMeta(env, place, {}));
      const t = await loadTexture(PC && m.hi ? m.hi : m.url, 'full').catch(() => null);
      if (t) { adoptFull(place, t); env.setSkyPano(t, { yaw: place._yaw || 0, horizon: (place.meta || {}).horizon_deg || 0, haze: 0.65 }); }
      T.place = tidy(place);
      api.current = { name: place.name, prompt: place.prompt, meta: place.meta, slug: place.slug };
      env.setTransition(1.5);
      hudShow('The horizon sharpens.', 3);
    } catch (err) { console.warn('[travel] sharpen failed', err); }
  });

  function failed(h, why) { h.state = 'failed'; h.error = why; hudShow(why, 5); return Promise.resolve(null); }
  const api = {
    current: null,
    get busy() { return !!(handle && handle.state !== 'arrived' && handle.state !== 'failed'); },
    get away() { return !!T.away; },
    get currentYaw() { return T.place && T.place._yaw ? T.place._yaw : 0; }, // degrees the picture is turned (the seam is at azimuth 180 - yaw)
    go(input, opts = {}) {
      const h = { state: 'resolving', name: null, error: null, promise: null, ready: null, then(a, b) { return h.promise.then(a, b); }, catch(b) { return h.promise.catch(b); } };
      handle = h;
      h.promise = (chain = chain.then(async () => {
        if (ctx.input.passthrough) return failed(h, 'Travel is disabled in mixed reality: the real room is the place.');
        if (!world.env || !world.env.setSkyPano) return failed(h, 'The world cannot travel right now.');
        let place;
        try { place = await resolve(input); } catch (err) { return failed(h, `Could not understand that destination: ${err && err.message}`); }
        h.name = place.name;
        try { return await journey(h, place, opts); } catch (err) { console.error('[travel] journey failed', err); try { iris.to(0, 0.6); T.irisClosed = false; } catch { /* ignore */ } return failed(h, 'The journey faltered.'); }
      }).catch(() => null));
      h.ready = h.promise; // resolves with current once the player has arrived (null if the journey failed)
      return h;
    },
    home(opts = {}) {
      const h = { state: 'closing', name: 'home', error: null, promise: null, ready: null, then(a, b) { return h.promise.then(a, b); }, catch(b) { return h.promise.catch(b); } };
      handle = h;
      h.promise = (chain = chain.then(async () => {
        if (!T.away) { h.state = 'arrived'; return null; }
        const name = T.place && T.place.name;
        const instant = !!opts.instant;
        try {
          pendingGen.clear();
          T.journey++;
          emit('travel:start', { name: 'home', prompt: 'home' });
          const fwd = new Vector3(); ctx.camera.getWorldDirection(fwd); iris.axis(fwd);
          iris.tint('#ffcf9a');
          if (!instant) await irisTo(1, 1.1);
          h.state = 'switching';
          leave({ syncTerrain: instant });
          await tickUntil(() => !(world.env && world.env.terrainBusy), 4000);
          await sleep(instant ? 0 : 300);
          h.state = 'opening';
          if (!instant) await irisTo(0, 1.4); else iris.to(0, 0);
          T.irisClosed = false;
          h.state = 'arrived';
          api.current = null;
          emit('travel:home', { name });
        } catch (err) { console.error('[travel] home failed', err); try { iris.to(0, 0.5); T.irisClosed = false; } catch { /* ignore */ } h.state = 'failed'; }
        return null;
      }).catch(() => null));
      h.ready = h.promise;
      return h;
    },
    list() { const out = []; if (index) for (const [slug, e] of Object.entries(index)) out.push({ name: e.name || slug, slug, prompt: e.prompt }); return out; },
    preload(nameOrPrompt) {
      return loadIndex().then(() => {
        const m = matchAtlas(stripLead(nameOrPrompt) || nameOrPrompt);
        if (!m.best) return false;
        const e = m.best.e;
        for (const u of [e.preview, PC ? e.hi : e.url]) if (u) fetch(u).then((r) => r.blob()).catch(() => {});
        return true;
      });
    },
    reload() { return loadIndex(true).then(() => api.list()); },
  };
  ctx.provide('travel', api);
  if (world.contextProviders) {
    const prov = () => (T.away && T.place ? T.place.name : null);
    world.contextProviders.place = prov;
    ctx.onDispose(() => { if (world.contextProviders && world.contextProviders.place === prov) delete world.contextProviders.place; });
  }
  loadIndex();

  // passthrough: the real room is the place
  ctx.on('xr:start', (e) => { if (e && e.passthrough && T.away) api.home({ instant: true }); });

  // hot reload (of this file or of world.js) while away: land in a consistent place
  async function resume() {
    if (!T.away || !T.place || !world.env || !world.env.snapshot) return;
    const place = T.place;
    lastEnv = world.env;
    // a reloaded world has forgotten the "before" state: the saved snapshot is plain data and still valid
    const loading = startLoading(place);
    const tinyTex = await Promise.race([loading.tinyP, sleep(1500).then(() => null)]);
    if (disposed) return;
    if (tinyTex) { tex.tiny = tinyTex; tex.use = tinyTex; }
    const keepHome = T.home;
    enter(place, { easeSeconds: 0, syncTerrain: true });
    T.home = keepHome || T.home;
    api.current = { name: place.name, prompt: place.prompt, meta: place.meta, slug: place.slug };
    loading.fullP.then((t) => adoptFull(place, t));
    if (world.env) world.env.setTransition(1.5);
    iris.to(0, 0); T.irisClosed = false;
  }
  if (T.away) { if (T.irisClosed) iris.to(1, 0); resume(); }

  return {
    update(dt, t) {
      iris.update(dt, t);
      if (world.env !== lastEnv) { // world.js was reloaded: it starts as the plain field
        lastEnv = world.env;
        if (T.away && world.env && !api.busy) resume();
      }
    },
    dispose() {
      disposed = true;
      clearDressing();
      pendingGen.clear();
      // leave the world's state as it is (T in ctx.state lets the next load of this file resume the place); free the textures we own
      try { if (world.env && world.env.skyPano && (world.env.skyPano === tex.tiny || world.env.skyPano === tex.full)) world.env.setSkyPano(null, { instant: true }); } catch { /* ignore */ }
      for (const t of [tex.tiny, tex.full]) { try { t && t.dispose(); } catch { /* ignore */ } }
    },
  };
}



