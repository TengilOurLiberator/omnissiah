// Headless boot of the real game core (no browser, no GL): builds a ctx the way public/boot.js does, loads the manifest's core
// modules from <gameDir>, loads creations on request, steps simulated time, records what services were used.
// Run with:  node --import ./server/eval/register.mjs <script that imports this>
// Tooling only. Never touches the real server or the real public/game (everything is read from the given dirs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

// ------------------------------------------------------------------ null objects (audio nodes, canvas contexts, renderer bits)
export function nullObj(over = {}) {
  const cache = new Map();
  const target = function () {};
  const store = { ...over };
  return new Proxy(target, {
    get(_t, k) {
      if (k in store) return store[k];
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return undefined;
      if (k === 'toJSON') return () => null;
      if (typeof k === 'symbol') return undefined;
      if (!cache.has(k)) cache.set(k, nullObj());
      return cache.get(k);
    },
    set(_t, k, v) { store[k] = v; return true; },
    has(_t, k) { return k in store; },
    apply() { return nullObj(); },
    construct() { return nullObj(); },
  });
}

function fakeCanvas(w = 256, h = 256) {
  const ctx2d = nullObj({
    measureText: (s) => ({ width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, ww, hh) => ({ width: ww, height: hh, data: new Uint8ClampedArray(Math.max(1, ww * hh * 4)) }),
    createImageData: (ww, hh) => ({ width: ww, height: hh, data: new Uint8ClampedArray(Math.max(1, ww * hh * 4)) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  });
  const el = { width: w, height: h, style: {}, nodeName: 'CANVAS', addEventListener() {}, removeEventListener() {}, getContext: () => ctx2d,
    toDataURL: () => 'data:image/png;base64,', toBlob: (cb) => cb?.(null), getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    setAttribute() {}, appendChild() {}, remove() {}, transferControlToOffscreen() { return el; } };
  return el;
}

export function installBrowserStubs(opts = {}) {
  const g = globalThis;
  g.self ??= g;
  const store = new Map();
  g.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const bodyEl = { appendChild() {}, prepend() {}, removeChild() {}, style: {}, addEventListener() {}, classList: { add() {}, remove() {} } };
  const mkEl = (name) => {
    if (String(name).toLowerCase() === 'canvas') return fakeCanvas();
    const el = new EventTarget();
    el.nodeName = String(name).toUpperCase(); el.style = {}; el.children = []; el.classList = { add() {}, remove() {}, toggle() {} };
    el.appendChild = (c) => c; el.append = () => {}; el.remove = () => {}; el.setAttribute = () => {}; el.getAttribute = () => null;
    el.width = 4; el.height = 4; el.naturalWidth = 4; el.naturalHeight = 4;
    let src = '';
    Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = v; setTimeout(() => el.dispatchEvent(new Event('load')), 0); } });
    return el;
  };
  g.document = {
    createElement: mkEl, createElementNS: (ns, n) => mkEl(n), body: bodyEl, head: bodyEl, documentElement: bodyEl,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
    hidden: false, visibilityState: 'visible', activeElement: null, pointerLockElement: null, fullscreenElement: null,
  };
  g.window = g;
  g.addEventListener ??= () => {}; g.removeEventListener ??= () => {}; g.dispatchEvent ??= () => true;
  g.innerWidth = 1280; g.innerHeight = 720; g.devicePixelRatio = 1;
  g.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 16);
  g.cancelAnimationFrame = (id) => clearTimeout(id);
  Object.defineProperty(g, 'navigator', { configurable: true, value: { userAgent: 'node-headless', xr: undefined, getGamepads: () => [], mediaDevices: undefined, clipboard: undefined, language: 'en', hardwareConcurrency: 8, maxTouchPoints: 0 } });
  Object.defineProperty(g, 'location', { configurable: true, value: { search: opts.search ?? '', href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', hash: '', pathname: '/' } });
  g.Image = class { constructor() { return mkEl('img'); } };
  g.OffscreenCanvas = class { constructor(w, h) { return fakeCanvas(w, h); } };
  g.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
  g.Audio = class { constructor() { this.paused = true; this.duration = 3; this.currentTime = 0; this.volume = 1; this.loop = false; } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } load() {} addEventListener() {} removeEventListener() {} };
  g.speechSynthesis = undefined;
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.getComputedStyle = () => ({});
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.XRRigidTransform ??= class {};
  g.Worker ??= class { postMessage() {} terminate() {} addEventListener() {} };
  g.WebSocket = class { constructor() { setTimeout(() => this.onerror?.(new Error('no network in eval')), 0); } send() {} close() {} addEventListener() {} };
}

// ------------------------------------------------------------------ fake audio context
export function makeAudioContext() {
  const ac = {
    state: 'running', currentTime: 0, sampleRate: 48000, baseLatency: 0, destination: nullObj(), listener: nullObj(),
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(), close: () => Promise.resolve(),
    createBuffer(ch, len, sr) { const d = Array.from({ length: ch }, () => new Float32Array(Math.min(len, 2e6))); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] ?? d[0], copyToChannel() {} }; },
    decodeAudioData(ab) { const secs = Math.max(0.2, (ab.byteLength || 10000) / 10000); return Promise.resolve({ numberOfChannels: 1, length: Math.round(secs * 48000), sampleRate: 48000, duration: secs, getChannelData: () => new Float32Array(16) }); },
    addEventListener() {}, removeEventListener() {},
  };
  return new Proxy(ac, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && k.startsWith('create')) return () => nullObj({ connect: (n) => n ?? nullObj(), disconnect() {}, start() {}, stop() {}, setPosition() {} });
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// ------------------------------------------------------------------ recorder proxies around services
// Records calls (svc.fn) and property writes (svc.path = v) on a service object, without changing behaviour.
function summarize(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'function') return 'fn';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  if (typeof v !== 'object') return v;
  if (v.isObject3D) return `<${v.type}>`;
  if (v.isVector3) return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  if (v.isColor) return '#' + v.getHexString();
  if (Array.isArray(v)) return depth > 1 ? `[${v.length}]` : v.slice(0, 6).map((x) => summarize(x, depth + 1));
  if (depth > 1) return '{…}';
  const o = {};
  let n = 0;
  for (const k of Object.keys(v)) { if (n++ > 10) break; o[k] = summarize(v[k], depth + 1); }
  return o;
}

export function recordService(name, svc, log, depth = 0, prefix = name) {
  if (!svc || (typeof svc !== 'object' && typeof svc !== 'function')) return svc;
  const wrapped = new Map();
  return new Proxy(svc, {
    get(t, k, r) {
      const v = Reflect.get(t, k, t);
      if (typeof k === 'symbol') return v;
      if (typeof v === 'function') {
        if (!wrapped.has(k) || wrapped.get(k).orig !== v) {
          const fn = function (...args) {
            let entry = null;
            if (log.current && !log.depth) { entry = { t: log.now?.() ?? 0, mod: log.current, call: `${prefix}.${k}`, args: args.filter((a) => !(a && typeof a === 'object' && a.THREE && a.root)).slice(0, 4).map((a) => summarize(a)) }; log.push(entry); }
            log.depth = (log.depth || 0) + 1;
            try { const ret = v.apply(this === r ? t : this, args); if (entry) entry.ret = ret === null ? 'null' : ret === undefined ? 'undef' : ret === false ? 'false' : ret === true ? 'true' : 'ok'; return ret; }
            catch (err) { if (entry) entry.threw = String(err?.message ?? err).slice(0, 200); throw err; }
            finally { log.depth--; }
          };
          wrapped.set(k, { orig: v, fn });
        }
        return wrapped.get(k).fn;
      }
      if (v && typeof v === 'object' && depth < 1 && !v.isObject3D && !v.isVector3 && !v.isColor && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) {
        return recordService(name, v, log, depth + 1, `${prefix}.${k}`);
      }
      return v;
    },
    set(t, k, v) {
      if (typeof k !== 'symbol' && log.current && !log.depth) log.push({ t: log.now?.() ?? 0, mod: log.current, set: `${prefix}.${k}`, value: summarize(v) });
      return Reflect.set(t, k, v, t);
    },
  });
}

// ------------------------------------------------------------------ the game
export async function bootGame({ gameDir, publicDir = path.join(ROOT, 'public'), tier = 'pc', onLog = () => {}, only = null, skip = [] } = {}) {
  installBrowserStubs();
  const log = [];            // service calls + property writes (recorded after core boot)
  const sent = [];           // net.send messages
  const hudLog = [];
  const coreErrors = [];     // errors thrown by core modules (not creations)
  const loadFailures = [];   // core modules that failed to load headlessly
  let clockT = 0;
  log.now = () => +clockT.toFixed(2);

  // fetch: /game/* from gameDir, everything else from publicDir
  globalThis.fetch = async (url, init) => {
    const u = String(url).split('?')[0].split('#')[0];
    if (/^https?:\/\//.test(u) && !/^https?:\/\/localhost/.test(u)) return new Response('offline', { status: 404 });
    const p = u.replace(/^https?:\/\/localhost(:\d+)?/, '');
    if (init?.method && init.method !== 'GET') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    let file = p.startsWith('/game/') ? path.join(gameDir, p.slice(6)) : path.join(publicDir, p.replace(/^\//, ''));
    if (p.startsWith('/api/')) return new Response('{}', { status: 404 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
    const buf = fs.readFileSync(file);
    const ext = path.extname(file);
    const type = ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript' : ext === '.glb' ? 'model/gltf-binary' : 'application/octet-stream';
    return new Response(buf, { status: 200, headers: { 'Content-Type': type } });
  };

  // events (as boot.js)
  const emap = new Map();
  const events = {
    on(name, fn) { if (!emap.has(name)) emap.set(name, new Set()); emap.get(name).add(fn); return () => emap.get(name)?.delete(fn); },
    off(name, fn) { emap.get(name)?.delete(fn); },
    emit(name, payload) { for (const fn of [...(emap.get(name) ?? [])]) { try { fn(payload); } catch (err) { coreErrors.push({ event: name, message: String(err?.message ?? err) }); } } },
  };

  const quality = { tier, pc: tier === 'pc', shadows: false, bloom: false, supersample: 1, shadowSweep: 0.5, animStride: 1, fighterThink: 1,
    density: tier === 'pc' ? 2.5 : 1, maxLights: tier === 'pc' ? 12 : 6, detail: tier === 'pc' ? 2 : 1 };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 4000);
  camera.rotation.order = 'YXZ';
  const rig = new THREE.Group(); rig.name = 'rig'; camera.position.set(0, 1.6, 0); rig.add(camera); scene.add(rig);
  scene.updateMatrixWorld(true);
  const renderer = nullObj({
    domElement: fakeCanvas(1280, 720),
    xr: nullObj({ isPresenting: false, enabled: true, getSession: () => null, getCamera: () => camera, setFoveation() {}, addEventListener() {}, getController: () => new THREE.Group(), getHand: () => new THREE.Group() }),
    info: { render: { calls: 40, triangles: 60000, points: 0, lines: 0, frame: 0 }, memory: { geometries: 100, textures: 20 }, programs: [], reset() {}, autoReset: true },
    shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false },
    getPixelRatio: () => 1, getSize: (v) => (v ?? new THREE.Vector2()).set(1280, 720), getDrawingBufferSize: (v) => (v ?? new THREE.Vector2()).set(1280, 720),
    getClearAlpha: () => 1, setClearAlpha() {}, render() {}, compile() {}, compileAsync: () => Promise.resolve(), initTexture() {},
    getContext: () => nullObj({ getExtension: () => null }), capabilities: { maxTextureSize: 8192, isWebGL2: true }, extensions: { has: () => false },
  });

  const mkHand = (name) => {
    const anchor = new THREE.Group(); anchor.name = 'hand-' + name; rig.add(anchor);
    const x = name === 'left' ? -0.25 : 0.25;
    const h = { name, connected: true, tracked: false, anchor, position: new THREE.Vector3(x, 1.3, -0.4), direction: new THREE.Vector3(0, 0, -1), quaternion: new THREE.Quaternion(),
      trigger: 0, squeeze: 0, stick: { x: 0, y: 0 }, down: { trigger: false, squeeze: false, a: false, b: false, stickPress: false }, _prev: {},
      pressed(b) { return !!this.down[b] && !this._prev[b]; }, released(b) { return !this.down[b] && !!this._prev[b]; }, pulse() {},
      fingers: { wrist: new THREE.Vector3(), palm: new THREE.Vector3(), thumb: new THREE.Vector3(), index: new THREE.Vector3(), middle: new THREE.Vector3(), ring: new THREE.Vector3(), pinky: new THREE.Vector3(),
        palmNormal: new THREE.Vector3(0, -1, 0), pinch: { index: 0, middle: 0, ring: 0, pinky: 0 }, curl: { index: 0, middle: 0, ring: 0, pinky: 0 }, gesture: 'none' } };
    anchor.position.copy(h.position);
    return h;
  };
  const input = { left: mkHand('left'), right: mkHand('right'), presenting: false, passthrough: false };
  const player = { head: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), feet: rig.position, rig };
  const world = { contextProviders: {} };
  const groundAt = (x, z) => (typeof world.groundHeight === 'function' ? world.groundHeight(x, z) : 0);
  const aimPoint = (max = 80) => { const v = new THREE.Vector3(0, 0, -6); v.y = groundAt(v.x, v.z); return v; };
  const clock = { t: 0, dt: 0 };
  const audio = { listener: nullObj({ context: null }), context: makeAudioContext() };
  audio.listener = nullObj({ context: audio.context });
  const net = { send: (m) => { sent.push({ t: log.now(), ...m }); return true; } };
  const hud = { show: (text, s) => { hudLog.push(String(text)); }, update() {} };

  const modules = new Map();
  const moduleState = new Map();
  function disposeTree(root) {
    root.traverse((o) => {
      o.geometry?.dispose?.();
      for (const m of [].concat(o.material ?? [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose?.(); }
    });
  }
  function unloadModule(p) {
    const m = modules.get(p);
    if (!m) return;
    modules.delete(p);
    try { m.instance?.dispose?.(); } catch (err) { m.disposeError = String(err?.message ?? err); }
    for (const fn of m.cleanups.reverse()) { try { fn(); } catch (err) { m.disposeError = String(err?.message ?? err); } }
    scene.remove(m.root);
    disposeTree(m.root);
    return m;
  }
  let versionCounter = 0;
  async function loadModule(p, { core = false } = {}) {
    unloadModule(p);
    const root = new THREE.Group(); root.name = `module:${p}`;
    const record = { path: p, instance: null, root, cleanups: [], failed: false, updateError: null, updateMs: 0, core, loadError: null };
    if (!moduleState.has(p)) moduleState.set(p, {});
    const ctx = { THREE, scene, camera, renderer, rig, root, input, player, world, events, audio, net, hud, clock, quality, path: p, state: moduleState.get(p), aimPoint, groundAt,
      on(name, fn) { record.cleanups.push(events.on(name, fn)); },
      provide(name, api) { world[name] = api; record.cleanups.push(() => { if (world[name] === api) delete world[name]; }); },
      onDispose(fn) { record.cleanups.push(fn); } };
    record.ctx = ctx;
    scene.add(root);
    modules.set(p, record);
    try {
      const file = path.join(gameDir, p);
      const mod = await import(pathToFileURL(file).href + '?v=' + (++versionCounter));
      if (typeof mod.default !== 'function') throw new Error('module has no default export function');
      record.meta = mod.meta ?? null;
      if (!core) log.current = p;
      try { record.instance = (await mod.default(ctx)) ?? {}; } finally { log.current = null; }
      events.emit('module:loaded', { path: p });
    } catch (err) {
      record.failed = true;
      record.loadError = { message: String(err?.message ?? err), stack: String(err?.stack ?? '').split('\n').slice(0, 6).join('\n') };
      const keep = { ...record };
      unloadModule(p);
      modules.set(p, { ...keep, instance: null, cleanups: [] });
      if (core) loadFailures.push({ path: p, ...record.loadError });
    }
    return record;
  }

  function step(seconds, dt = 1 / 30) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      clock.dt = dt; clock.t += dt; clockT = clock.t;
      renderer.info.render.frame++;
      for (const [p, m] of modules) {
        if (!m.instance?.update) continue;
        const t0 = performance.now();
        try { if (!m.core) log.current = p; m.instance.update(dt, clock.t); } catch (err) {
          m.instance.update = null;
          m.updateError = { message: String(err?.message ?? err), stack: String(err?.stack ?? '').split('\n').slice(0, 6).join('\n'), atT: +clock.t.toFixed(2) };
          if (m.core) coreErrors.push({ path: p, phase: 'update', message: m.updateError.message });
        }
        log.current = null;
        m.updateMs += performance.now() - t0;
      }
      scene.updateMatrixWorld(true);
    }
  }

  // ---- boot core
  const manifest = JSON.parse(fs.readFileSync(path.join(gameDir, 'manifest.json'), 'utf8'));
  const loadedCore = [];
  for (const p of manifest.core) {
    if (skip.includes(p) || (only && !only.includes(p))) continue;
    if (!fs.existsSync(path.join(gameDir, p))) continue;
    const t0 = performance.now();
    const rec = await loadModule(p, { core: true });
    onLog(`core ${p} ${rec.failed ? 'FAILED: ' + rec.loadError.message : 'ok'} ${(performance.now() - t0) | 0}ms`);
    if (!rec.failed) loadedCore.push(p);
    // let async init settle (physics wasm, fetches)
    await new Promise((r) => setTimeout(r, 5));
  }
  for (let i = 0; i < 100 && world.physics && !world.physics.world; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50));
  step(0.5);
  events.emit('modules:synced', { modules: [...modules.keys()] });

  // ---- stubs for expensive services: record the call, give back a plausible handle. Installed AFTER core boot.
  const stubs = installStubs({ world, THREE, log, sent });

  // ---- wrap services for recording
  const SERVICES = ['kit', 'library', 'models', 'combat', 'weapons', 'spells', 'physics', 'audio', 'voices', 'quests', 'menu', 'perf', 'travel', 'blast', 'style', 'env', 'ambience',
    'player', 'oracle', 'commentary', 'campaign', 'society', 'mr', 'intro', 'games'];
  for (const name of SERVICES) if (world[name] && typeof world[name] === 'object') world[name] = recordService(name, world[name], log);
  const initialLogLength = log.length;

  const baseline = snapshotState(world, scene);

  async function loadCreation(rel) { return loadModule(rel); }
  function unloadCreation(rel) { return unloadModule(rel); }

  return { THREE, world, events, scene, camera, rig, quality, clock, input, player, modules, log, sent, hudLog, coreErrors, loadFailures, loadedCore, stubs, step, loadCreation, unloadCreation, baseline, snapshotState: () => snapshotState(world, scene), initialLogLength, gameDir };
}

// ------------------------------------------------------------------ state snapshot (for the cleanup check)
export function snapshotState(world, scene) {
  const num = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o?.[k] !== 'undefined' && (typeof o[k] === 'number' || typeof o[k] === 'boolean' || typeof o[k] === 'string')).map((k) => [k, o[k]]));
  const safe = (fn, d = null) => { try { return fn(); } catch { return d; } };
  return {
    sceneChildren: scene.children.length,
    rootsChildren: scene.children.filter((c) => c.name?.startsWith('module:')).length,
    player: num(world.player, ['speed', 'sprintMultiplier', 'jumpSpeed', 'gravity', 'flying', 'flySpeed', 'noclip', 'snapAngle', 'enabled', 'health', 'maxHealth', 'invulnerable', 'regen']),
    env: { timeOfDay: safe(() => world.env?.timeOfDay) },
    style: safe(() => JSON.stringify(world.style?.get?.())),
    fighters: safe(() => world.combat?.fighters?.length, 0),
    actors: safe(() => world.kit?.actors?.length, 0),
    bodies: safe(() => world.physics?.stats?.().bodies, 0),
    joints: safe(() => world.physics?.stats?.().joints, 0),
    spells: safe(() => world.spells?.list?.().length, 0),
    weapons: safe(() => world.weapons?.list?.().length, 0),
    lights: safe(() => world.kit?.stats?.().lightsOn, 0),
    particles: safe(() => world.kit?.stats?.().particlesLive, 0),
    gore: safe(() => world.kit?.gore?.level),
    commentary: safe(() => JSON.stringify({ e: world.commentary?.enabled, f: world.commentary?.frequency })),
    voices: safe(() => JSON.stringify({ e: world.voices?.enabled, v: world.voices?.volume })),
    ambienceVol: safe(() => world.ambience?.getVolume?.()),
  };
}

// ------------------------------------------------------------------ stubs
function installStubs({ world, THREE, log, sent }) {
  const calls = { generate: [], blast: [], travel: [] };
  const handle = (extra = {}) => {
    const object = new THREE.Group(); object.name = 'stub-handle';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x88aaff, transparent: true, opacity: 0.4 }));
    mesh.position.y = 0.5; object.add(mesh);
    const h = { object, position: object.position, state: 'sculpting', message: 'stubbed in eval', rigged: false, alive: false, actor: null, fighter: null, clips: [], bones: {}, modelName: null, error: null,
      ready: null, play: () => null, clipFor: () => null, has: () => false, stop() {}, remove() { object.removeFromParent(); }, attach() {}, setTint() {}, ...extra };
    h.ready = Promise.resolve(h);
    return h;
  };
  if (world.models) {
    const M = world.models;
    M.generate = (ctx, prompt, opts = {}) => {
      calls.generate.push({ prompt, opts: JSON.parse(JSON.stringify(opts, (k, v) => (typeof v === 'function' ? 'fn' : v?.isVector3 ? [v.x, v.y, v.z] : v))) });
      log.push({ t: log.now(), call: 'models.generate', args: [prompt, opts && typeof opts === 'object' ? Object.keys(opts).join(',') : ''] });
      const h = handle();
      const s = Number(opts.size) || 1; h.object.scale.setScalar(s);
      const pos = opts.position; if (pos) { if (Array.isArray(pos)) h.object.position.set(pos[0], pos[1] ?? 0, pos[2]); else h.object.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0); }
      ctx.root.add(h.object);
      if (opts.alive && world.kit?.actor) { try { /* real alive path needs the real model; keep stub inert */ } catch { /* ignore */ } }
      return h;
    };
  }
  const blast = world.blast;
  if (blast) {
  blast.create = (p) => { calls.blast.push(typeof p === 'string' ? { prompt: p } : { ...p }); log.push({ t: log.now(), call: 'blast.create', args: [typeof p === 'string' ? p : p?.prompt ?? p?.image ?? ''] });
    const h = { state: 'queued', stage: 'stub', message: 'stubbed in eval', progress: { done: 0, total: 1 }, props: [], remove() {}, ready: Promise.resolve(null) }; return h; };
  blast.open = (slug) => { calls.blast.push({ open: slug }); log.push({ t: log.now(), call: 'blast.open', args: [slug] }); return { state: 'arrived', remove() {}, ready: Promise.resolve(null) }; };
  blast.home ??= () => { calls.blast.push({ home: true }); };
  blast.list ??= () => [];
  blast.inputs ??= async () => [];
  world.blast = blast;
  }
  const travel = world.travel ?? {};
  const origGo = travel.go;
  travel.go = (spec) => { calls.travel.push(typeof spec === 'string' ? { prompt: spec } : JSON.parse(JSON.stringify(spec ?? {}))); log.push({ t: log.now(), call: 'travel.go', args: [typeof spec === 'string' ? spec : spec?.prompt ?? spec?.place ?? ''] });
    const h = { state: 'arrived', ready: Promise.resolve(null), promise: Promise.resolve(null), then: undefined }; return h; };
  travel.home ??= () => { calls.travel.push({ home: true }); };
  travel.list ??= () => [];
  world.travel = travel;
  // capture spell / weapon specs registered by creations so the grader can exercise their runtime-only code paths
  const captured = { spells: [], weapons: [] };
  if (world.spells?.register) { const orig = world.spells.register; world.spells.register = function (spec) { if (spec) captured.spells.push(spec); return orig.apply(this, arguments); }; }
  if (world.weapons?.define) { const orig = world.weapons.define; world.weapons.define = function (name, spec) { captured.weapons.push({ name, spec }); return orig.apply(this, arguments); }; }
  return { calls, origGo, captured };
}






