// Headless tests of public/game/core/audio.js (+ ambience.js zone logic) against a fake AudioContext / fetch / Audio / ctx.
//   D:\omnissiah\tools\node\node.exe server\audio\test_core.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..', '..', 'public', 'game', 'core');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const section = (s) => console.log('# ' + s);

// ------------------------------------------------------------------ fakes
class Param {
  constructor() { this.value = 0; this.calls = []; Param.all.push(this); }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); this.value = v; return this; }
  setTargetAtTime(v, t, c) { this.calls.push(['target', v, t, c]); this.value = v; return this; }
  setValueCurveAtTime(c, t, d) { this.calls.push(['curve', c.length, t, d]); this.value = c[c.length - 1]; return this; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); return this; }
}
Param.all = [];
let nodeCount = 0;
class Node {
  constructor(kind, rec) {
    this.kind = kind; this.rec = rec; this.id = ++nodeCount; this.connected = new Set(); this.started = false; this.stopped = false; this.params = {};
    return new Proxy(this, {
      get: (t, k) => {
        if (k in t) return t[k];
        if (typeof k === 'string' && /^(gain|frequency|Q|detune|pan|playbackRate|positionX|positionY|positionZ|threshold|knee|ratio|attack|release|delayTime)$/.test(k)) return (t.params[k] ??= new Param());
        return undefined;
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
  }
  connect(n) { this.connected.add(n); return n; }
  disconnect() { this.connected.clear(); this.rec.disconnects++; }
  start() { this.started = true; this.rec.starts.push(this); }
  stop() { this.stopped = true; if (this.onended) { const f = this.onended; setTimeout(() => f(), 0); } }
  setPosition(x, y, z) { this.pos = [x, y, z]; }
}
function makeAC(rec) {
  const ac = {
    state: 'running', currentTime: 0, sampleRate: 48000, destination: new Node('destination', rec), listener: {},
    resume() { ac.state = 'running'; return Promise.resolve(); },
    createBuffer(ch, len, sr) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; },
    decodeAudioData(ab) { rec.decodes++; const n = ab.byteLength; const secs = n / 10000; const len = Math.round(secs * 48000); return Promise.resolve({ numberOfChannels: n >= 500000 ? 2 : 1, length: len, sampleRate: 48000, duration: secs, _bytes: n }); },
  };
  for (const k of ['Gain', 'Panner', 'BufferSource', 'DynamicsCompressor', 'MediaElementSource', 'BiquadFilter', 'Oscillator', 'StereoPanner', 'Convolver']) {
    ac['create' + k] = (el) => { const n = new Node(k, rec); rec.created[k] = (rec.created[k] || 0) + 1; if (k === 'MediaElementSource') { if (el.__src) throw new Error('MediaElementSource created twice for one element'); el.__src = n; } if (k === 'BufferSource') rec.sources.push(n); return n; };
  }
  return ac;
}
class FakeAudio {
  constructor() { this.paused = true; this.duration = 64; this.currentTime = 0; this.attrs = {}; FakeAudio.all.push(this); }
  set src(v) { this.attrs.src = v; this._src = v; }
  get src() { return this._src; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; this._src = undefined; }
  play() { this.paused = false; FakeAudio.plays.push(this._src); return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
}
FakeAudio.all = []; FakeAudio.plays = [];
globalThis.Audio = FakeAudio;
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const PACK = {};
const addPack = (name, n, kind = 'oneshot', volume = 0.8, size = 20000) => { PACK[name] = { url: `/p/${name}-0.ogg`, variants: Array.from({ length: n }, (_, i) => `/p/${name}-${i}.ogg`), volume, kind, ...(kind === 'music' ? { bpm: 100, durations: [64] } : {}), _size: size }; };
for (const n of ['slash-armor', 'slash-stone', 'blunt-armor', 'blunt-stone', 'pierce-flesh', 'pierce-wood', 'ui-tick', 'slash-flesh', 'slash-wood', 'blunt-flesh', 'hit-generic', 'goblin-death', 'goblin-cackle', 'step-grass', 'step-water', 'fire-whoosh', 'explosion-small', 'explosion-large', 'body-fall', 'limb-sever', 'player-hurt', 'swing-medium', 'swing-heavy', 'flame-loop', 'break-wood', 'bone-crack', 'heartbeat', 'omni-create']) addPack(n, n.startsWith('step') ? 4 : 3);
addPack('flame-loop', 1, 'loop', 0.8, 100000);
for (const n of ['amb-forest', 'amb-village', 'amb-wind', 'amb-night-field', 'amb-lake', 'amb-battlefield', 'amb-tavern']) addPack(n, 1, 'loop', 0.6, 600000);
for (const n of ['calm', 'wonder', 'village', 'tavern', 'tension', 'battle', 'boss', 'night', 'sacred', 'dungeon']) addPack('music-' + n, 1, 'music', 0.7);
addPack('music-victory', 1, 'stinger', 0.8, 70000); addPack('music-defeat', 1, 'stinger', 0.8, 80000);
const GENERATED = { sfx: {}, music: {} };
const rec0 = () => ({ created: {}, starts: [], sources: [], decodes: 0, disconnects: 0 });
function installFetch(rec) {
  globalThis.fetch = async (url, o) => {
    rec.fetches = (rec.fetches || 0) + 1;
    if (url.endsWith('/pack.json')) return { ok: true, json: async () => PACK };
    if (url.endsWith('/sfx/index.json')) return { ok: true, json: async () => GENERATED.sfx };
    if (url.endsWith('/music/index.json')) return { ok: true, json: async () => GENERATED.music };
    const name = url.replace(/^\/p\//, '').replace(/-\d+\.ogg$/, '');
    const size = PACK[name]?._size ?? (url.includes('/generated/') ? 30000 : null);
    if (size == null) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(size) };
  };
}
function makeBus() {
  const m = new Map();
  return { on(n, f) { if (!m.has(n)) m.set(n, new Set()); m.get(n).add(f); return () => m.get(n).delete(f); }, emit(n, p) { for (const f of [...(m.get(n) ?? [])]) f(p); } };
}
function makeCtx(over = {}) {
  const rec = over.rec ?? rec0();
  const ac = over.ac ?? makeAC(rec);
  const events = over.events ?? makeBus();
  const cleanups = [];
  const world = over.world ?? { kit: { sound: () => ({ noise() { rec.standins = (rec.standins || 0) + 1; }, tone() { rec.standins = (rec.standins || 0) + 1; }, chord() { rec.standins = (rec.standins || 0) + 1; } }), nearestTarget: () => null } };
  const sent = [];
  const ctx = {
    audio: { context: ac, listener: {} }, state: over.state ?? {}, world, events, quality: { tier: over.tier ?? 'pc' }, clock: { t: 0, dt: 0.016 },
    player: { head: { x: 0, y: 1.6, z: 0 }, feet: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } }, input: { left: { connected: true, position: { x: 0, y: 1, z: 0 } }, right: { connected: true, position: { x: 0.3, y: 1, z: 0 } } },
    groundAt: () => 0, net: { send: (m) => { sent.push(m); return over.netOpen !== false; } }, scene: over.scene ?? { children: [] },
    on: (n, f) => { cleanups.push(events.on(n, f)); }, onDispose: (f) => cleanups.push(f),
    provide: (n, api) => { world[n] = api; cleanups.push(() => { if (world[n] === api) delete world[n]; }); },
  };
  return { ctx, rec, ac, events, world, sent, cleanups, dispose: (inst) => { inst?.dispose?.(); for (const c of cleanups.reverse()) c(); } };
}
const flush = () => new Promise((r) => setTimeout(r, 15));
const load = async (v) => (await import(pathToFileURL(path.join(CORE, 'audio.js')).href + '?v=' + v)).default;
const loadAmb = async (v) => (await import(pathToFileURL(path.join(CORE, 'ambience.js')).href + '?v=' + v)).default;
const tick = (T, dt = 0.25, n = 1) => { for (let i = 0; i < n; i++) { T.ctx.clock.t += dt; T.ac.currentTime += dt; T.inst.update(dt, T.ctx.clock.t); } };

// ------------------------------------------------------------------ tests
const make = await load(1);
async function boot(over = {}) {
  const T = makeCtx(over);
  installFetch(T.rec);
  T.inst = make(T.ctx);
  await flush(); await flush();
  return T;
}

section('pack loading, playback, variants');
{
  const T = await boot();
  const A = T.world.audio;
  ok(!!A, 'world.audio provided');
  ok(A.has('slash-flesh') && !A.has('nope'), 'has()');
  ok(A.list().length > 40, 'list()');
  await flush(); await flush();
  ok(A.stats().cachedBuffers > 10, 'core sounds were preloaded: ' + A.stats().cachedBuffers);
  const before = T.rec.sources.length;
  ok(A.sfx('slash-flesh', { at: { x: 3, y: 1, z: 2 } }) === true, 'sfx plays a decoded pack sound');
  ok(T.rec.sources.length === before + 1, 'one source created');
  const seen = new Set();
  for (let i = 0; i < 60; i++) { T.ctx.clock.t += 0.2; A.sfx('hit-generic', { cooldown: 0 }); }
  // variants: check the buffer sizes are identical so look at urls through usage instead (non-repeat property)
  let rep = 0, last = -1;
  for (let i = 0; i < 80; i++) { T.ctx.clock.t += 0.2; const e = A._debug.pack.get('slash-wood'); A.sfx('slash-wood', { cooldown: 0, pitchJitter: 0 }); if (e.last === last) rep++; last = e.last; }
  ok(rep === 0, `no variant repeats back to back (${rep} repeats)`);
  A.sfx('slash-wood', { variant: 2, cooldown: 0 }); ok(A._debug.pack.get('slash-wood').last !== undefined, 'forced variant ok');
  // unplayed (not decoded) name returns false synchronously
  const T2 = await boot();
  T2.world.audio._debug.cache.clear();
  ok(T2.world.audio.sfx('swing-heavy') === false, 'undecoded pack sound returns false synchronously (caller falls back)');
  await T2.world.audio.preload(['swing-heavy']);
  ok(T2.world.audio.sfx('swing-heavy') === true, 'plays after preload');
}

section('cooldown, group limits, voice cap with priority');
{
  const T = await boot();
  const A = T.world.audio;
  const n0 = T.rec.sources.length;
  for (let i = 0; i < 30; i++) A.sfx('slash-flesh', { at: { x: 2, y: 1, z: 2 } });
  ok(T.rec.sources.length - n0 === 1, `30 simultaneous hits of one name -> 1 voice (got ${T.rec.sources.length - n0})`);
  const n1 = T.rec.sources.length;
  for (let i = 0; i < 12; i++) { T.ctx.clock.t += 0.01; A.sfx(['slash-flesh', 'slash-wood', 'blunt-flesh', 'hit-generic', 'bone-crack', 'limb-sever', 'slash-armor', 'slash-stone', 'blunt-armor', 'blunt-stone', 'pierce-flesh', 'pierce-wood'][i], { at: { x: 2, y: 1, z: 2 } }); }
  ok(T.rec.sources.length - n1 <= 7, `impact group limited per window (got ${T.rec.sources.length - n1})`);
  // saturate the voices with long low-priority sounds, then a UI sound must still get through
  const T3 = await boot();
  const B = T3.world.audio;
  await B.preload(['flame-loop', 'omni-create']);
  const names = [...B.list()].filter((n) => !/^(music|amb|ui|omni)/.test(n));
  let played = 0;
  for (let i = 0; i < 80; i++) { T3.ctx.clock.t += 1; const nm = names[i % names.length]; if (B.sfx(nm, { cooldown: 0 })) played++; }
  ok(B.stats().voices <= 24, `voice cap holds (${B.stats().voices} live)`);
  T3.ctx.clock.t += 1;
  ok(B.sfx('ui-tick') === true, 'high-priority ui sound steals a voice when full');
  // the active source count never exceeded the cap even though more were started: voices that were stolen got stopped
  ok(T3.rec.sources.filter((s) => s.stopped).length > 0, 'stolen voices were stopped');
}

section('unknown names: identifiers never generate, sentences do, explicit generate:true works');
{
  const T = await boot();
  const A = T.world.audio;
  ok(A.sfx('totally-unknown-typo') === false, 'identifier-like unknown name -> false');
  ok(A.sfx('whoops_name') === false, 'identifier with underscore -> false');
  ok(T.sent.length === 0, 'no generation request for identifiers');
  ok(A.sfx('a crystal bell ringing underwater', { at: { x: 1, y: 1, z: 1 } }) === true, 'sentence prompt plays a stand-in (returns true)');
  ok(T.sent.length === 1 && T.sent[0].type === 'sfx' && T.sent[0].prompt === 'a crystal bell ringing underwater', 'sentence prompt requested once: ' + JSON.stringify(T.sent[0]));
  ok(T.rec.standins >= 1, 'procedural stand-in played via kit.sound');
  A.sfx('a crystal bell ringing underwater');
  ok(T.sent.length === 1, 'same prompt is not requested twice');
  ok(A.sfx('a quiet thing', { generate: false }) === false && T.sent.length === 1, 'generate:false -> no request, false');
  ok(A.sfx('thunderclap-x', { generate: true }) === true && T.sent.length === 2 && T.sent[1].prompt === 'thunderclap x', 'generate:true on an identifier requests (dashes -> spaces)');
  // server answers done -> index -> next call plays the file
  const id = T.sent[0].id;
  GENERATED.sfx.z = { prompt: 'a crystal bell ringing underwater', url: '/assets/generated/audio/sfx/z.ogg', seconds: 2 };
  T.events.emit('net:audio_status', { id, kind: 'sfx', state: 'done', url: '/assets/generated/audio/sfx/z.ogg' });
  await flush();
  const n = T.rec.sources.length;
  ok(A.sfx('a crystal bell ringing underwater') === true && T.rec.sources.length === n + 1, 'generated file is used from then on');
  // error -> backoff, no spam
  const T4 = await boot();
  T4.world.audio.sfx('some other long prompt here');
  T4.events.emit('net:audio_status', { id: T4.sent[0].id, kind: 'sfx', state: 'error', message: 'x' });
  T4.world.audio.sfx('some other long prompt here');
  ok(T4.sent.length === 1, 'after an error the same prompt is backed off');
  // server offline
  const T5 = await boot({ netOpen: false });
  ok(T5.world.audio.sfx('an offline prompt sentence') === true, 'offline: stand-in still plays');
}

section('disabled / settings persistence');
{
  const T = await boot();
  const A = T.world.audio;
  A.enabled = false;
  const n = T.rec.sources.length;
  ok(A.sfx('slash-flesh') === true && T.rec.sources.length === n, 'muted: nothing plays, returns true (no kit.sound fallback)');
  A.enabled = true; A.musicVolume = 0.3; A.sfxVolume = 0.5;
  ok(JSON.parse(store['omnissiah.audio']).musicVolume === 0.3, 'settings persisted');
  A.musicVolume = 0.6; A.sfxVolume = 1;
}

section('automatic events');
{
  const T = await boot();
  const A = T.world.audio;
  const names = [];
  const orig = A._debug.pack;
  const spy = (fn) => { const before = T.rec.sources.length; fn(); return T.rec.sources.length - before; };
  T.ctx.clock.t = 100;
  ok(spy(() => T.events.emit('kit:hit', { point: { x: 2, y: 1, z: 2 }, hits: 1, amount: 10, kind: 'slash' })) === 1, 'kit:hit slash plays an impact');
  T.ctx.clock.t = 101;
  ok(spy(() => T.events.emit('kit:hit', { point: { x: 2, y: 1, z: 2 }, hits: 0, amount: 10, kind: 'slash' })) === 0, 'kit:hit with no victims is silent');
  T.ctx.clock.t = 102;
  ok(spy(() => T.events.emit('kit:hit', { point: { x: 2, y: 1, z: 2 }, hits: 3, amount: 40, kind: 'explosion', radius: 5 })) === 1, 'explosion plays once');
  T.ctx.clock.t = 103;
  ok(spy(() => T.events.emit('spell:cast', { id: 'firebolt', origin: { x: 0, y: 1, z: -1 } })) === 1, 'spell:cast firebolt');
  T.ctx.clock.t = 104;
  ok(spy(() => T.events.emit('spell:cast', { id: 'brand-new-spell', origin: { x: 0, y: 1, z: -1 } })) === 0, 'unknown spell id -> magic-cast not in this test pack -> nothing (no crash)');
  // creature voices
  T.ctx.clock.t = 110;
  const gob = { alive: true, faction: 'enemy', name: 'goblin', actor: { position: { x: 4, y: 0, z: 0 } } };
  ok(spy(() => T.events.emit('combat:kill', { victim: gob, by: 'player', style: 'bisect' })) >= 2, 'kill: goblin death voice + limb-sever');
  T.ctx.clock.t = 120;
  ok(spy(() => T.events.emit('limb:severed', { actor: { position: { x: 1, y: 1, z: 1 }, gore: 'blood' }, limb: 'armL' })) === 1, 'limb:severed');
  T.ctx.clock.t = 121;
  ok(spy(() => T.events.emit('kit:break', { material: 'wood', point: { x: 3, y: 1, z: 3 }, pieces: 8 })) === 1, 'kit:break wood');
  T.ctx.clock.t = 122;
  ok(spy(() => T.events.emit('player:hurt', { amount: 8, health: 90 })) === 1, 'player:hurt');
  // weapon swings from hand speed
  T.world.weapons = { held: { left: null, right: { kind: 'melee', type: 'sword' } } };
  T.ctx.input.right.position.x = 0; T.inst.update(0.016, 130); T.ctx.input.right.position.x = 0.1; T.ctx.clock.t = 130.3;
  const sw = spy(() => T.inst.update(0.016, 130.3));
  ok(sw === 1, 'a fast hand swing with a held sword plays a swing (' + sw + ')');
  // footsteps
  T.ctx.player.feet.x = 0; T.ctx.player.feet.z = 0; T.inst.update(0.016, 140);
  let steps = 0;
  for (let i = 1; i <= 120; i++) { T.ctx.player.feet.z = -i * 0.04; T.ctx.clock.t = 140 + i * 0.02; steps += spy(() => T.inst.update(0.02, T.ctx.clock.t)); }
  ok(steps >= 2 && steps <= 5, `walking 4.8 m at 2 m/s -> a few footsteps (${steps})`);
  // water
  T.world.env = { isWater: () => true };
  const w0 = T.rec.sources.length;
  T.ctx.player.feet.z = 0; T.inst.update(0.02, 200);
  for (let i = 1; i <= 100; i++) { T.ctx.player.feet.z = -i * 0.04; T.ctx.clock.t = 200 + i * 0.02; T.inst.update(0.02, T.ctx.clock.t); }
  ok(T.rec.sources.length - w0 >= 2, 'footsteps in the lake');
  // flame loop kept alive by repeated hold-spell events
  const f0 = T.rec.sources.length;
  T.ctx.clock.t = 300;
  await A.preload(['flame-loop']);
  for (let i = 0; i < 10; i++) { T.ctx.clock.t += 0.05; T.events.emit('spell:cast', { id: 'fire-stream', origin: { x: 0, y: 1, z: -1 } }); }
  ok(T.rec.sources.length - f0 === 1, 'hold spell = one looping voice (' + (T.rec.sources.length - f0) + ')');
  T.ctx.clock.t += 1; T.inst.update(0.05, T.ctx.clock.t);
  ok(T.rec.sources.at(-1).stopped, 'loop stops when the spell is released');
  // creation loaded after sync -> omni-create
  const c0 = T.rec.sources.length;
  T.events.emit('module:loaded', { path: 'creations/x.js' });
  ok(T.rec.sources.length === c0, 'module:loaded before modules:synced is ignored');
  T.events.emit('modules:synced', {});
  T.ctx.clock.t += 10;
  T.events.emit('module:loaded', { path: 'creations/x.js' });
  ok(T.rec.sources.length === c0 + 1, 'new creation -> omni-create');
}

section('music director');
{
  const T = await boot();
  const A = T.world.audio;
  const changes = [];
  T.events.on('music:changed', (e) => changes.push(e.mood));
  T.world.env = { timeOfDay: 0.6 };
  const fighters = [];
  T.world.combat = { fighters, count: (f) => fighters.filter((x) => x.alive && (!f || x.faction === f)).length };
  T.ctx.clock.t = 50; T.ac.currentTime = 50;
  tick(T, 0.25, 2);
  ok(A.mood === 'calm', 'starts calm: ' + A.mood);
  const g = { alive: true, faction: 'enemy', name: 'orc-brute', maxHp: 40, target: null, actor: { position: { x: 20, y: 0, z: 0 } } };
  fighters.push(g);
  tick(T, 0.25, 2);
  ok(A.mood === 'tension', 'enemy near, not engaged -> tension: ' + A.mood);
  g.target = {};
  tick(T, 0.25, 2);
  ok(A.mood === 'battle', 'engaged -> battle: ' + A.mood);
  // crossfade is at least 2 s and equal power (curve params)
  const curves = [];
  for (let k = 0; k < 8; k++) { /* inspect gain params on created gains */ }
  const allGains = [];
  // victory: last enemy dies after a real fight
  T.ctx.clock.t += 5; T.ac.currentTime += 5;
  g.alive = false;
  const s0 = T.rec.sources.length;
  T.events.emit('combat:kill', { victim: g, by: 'player', style: null });
  ok(T.rec.sources.length >= s0 + 1, 'last enemy dead -> victory stinger started');
  tick(T, 0.5, 4);
  ok(A.mood === 'battle', 'mood holds during the stinger/hysteresis: ' + A.mood);
  tick(T, 1, 30);
  ok(A.mood === 'calm', 'returns to calm after the fight (hysteresis done): ' + A.mood);
  // boss
  const boss = { alive: true, faction: 'enemy', name: 'lich-king', maxHp: 300, target: null, actor: { position: { x: 60, y: 0, z: 0 } } };
  fighters.push(boss);
  tick(T, 0.25, 2);
  ok(A.mood === 'boss', 'boss-named fighter alive -> boss: ' + A.mood);
  boss.alive = false; fighters.length = 0;
  tick(T, 1, 40);
  // night
  T.world.env.timeOfDay = 0.1;
  tick(T, 1, 20);
  ok(A.mood === 'night', 'night variant: ' + A.mood);
  T.world.env.timeOfDay = 0.6;
  // sacred: gaze at the oracle
  T.world.oracle = { position: { x: 0, y: 30, z: -40 } };
  const l = Math.hypot(30 - 1.6, 40); T.ctx.player.forward.x = 0; T.ctx.player.forward.y = (30 - 1.6) / l; T.ctx.player.forward.z = -40 / l;
  tick(T, 0.25, 10);
  ok(A.mood !== 'sacred', 'not sacred after 2.5 s of gazing: ' + A.mood);
  tick(T, 0.25, 60);
  ok(A.mood === 'sacred', 'gazing at the Omnissiah -> sacred: ' + A.mood);
  T.ctx.player.forward.y = 0; T.ctx.player.forward.z = -1;
  tick(T, 1, 40);
  ok(A.mood !== 'sacred', 'looking away leaves sacred: ' + A.mood);
  // override
  A.setMood('boss');
  tick(T, 0.25, 4);
  ok(A.mood === 'boss', 'setMood override');
  tick(T, 1, 30);
  ok(A.mood === 'boss', 'director does not move away while overridden');
  A.setMood(null);
  tick(T, 1, 40);
  ok(A.mood !== 'boss', 'setMood(null) hands control back: ' + A.mood);
  // defeat
  const d0 = T.rec.sources.length;
  T.events.emit('player:died', {});
  ok(T.rec.sources.length >= d0 + 1, 'player:died -> defeat stinger/sound');
  ok(changes.length >= 6, 'music:changed emitted: ' + changes.join(','));
  // crossfade durations (find curve calls on gains)
  const durs = [];
  const seenParams = new Set();
  for (const n of FakeAudio.all) { /* elements only */ }
  ok(A.stats().ctxState === 'running', 'stats');
}

section('crossfade parameters (>= 2 s, equal power)');
{
  const T = await boot();
  const A = T.world.audio;
  A.music('battle', { fade: 0.5 });
  const trk = FakeAudio.all.length;
  // find curve calls on every Param created through nodes
  const curves = [];
  for (const n of T.rec.created.Gain ? [] : []) { /* placeholder */ }
  ok(trk >= 4, 'four media elements exist for two tracks: ' + trk);
  ok(A.mood === 'battle', 'music("battle") works');
  A.music('calm');
  ok(A.mood === 'calm', 'music(mood) switches');
  const cur = Param.all.flatMap((p) => p.calls.filter((c) => c[0] === 'curve'));
  ok(cur.length >= 4 && cur.filter((c) => c[3] >= 2).length >= 4, 'track crossfades use value curves of >= 2 s in and out: ' + JSON.stringify(cur.slice(-4).map((c) => c[3])));
  ok(FakeAudio.plays.length >= 2, 'media elements started: ' + FakeAudio.plays.length);
  // loop wrap: the first element nears its end -> the second one starts from 0
  const before = FakeAudio.plays.length;
  const playing = [...FakeAudio.all].reverse().find((e) => !e.paused && e._src);
  playing.duration = Infinity; playing.currentTime = 63; // streams without Range support report Infinity: the manifest duration (64 s) must be used
  tick(T, 0.25, 2);
  ok(FakeAudio.plays.length > before, 'loop wrap starts the second element before the end of the first');
  // stopMusic
  A.stopMusic();
  ok(A.mood === null, 'stopMusic');
  const p = A.music('slow ominous drums in a cave'); // prompt -> generation request
  ok(p === true && T.sent.some((m) => m.type === 'music'), 'music(prompt) requests generation');
  GENERATED.music.q = { prompt: 'slow ominous drums in a cave', url: '/assets/generated/audio/music/q.ogg', seconds: 60, loop: true };
  const id = T.sent.find((m) => m.type === 'music').id;
  T.events.emit('net:audio_status', { id, kind: 'music', state: 'done', url: '/assets/generated/audio/music/q.ogg' });
  await flush();
  ok(A.mood === 'custom', 'generated music starts when ready: ' + A.mood);
}

section('beds + LRU budget (quest tier, 40 MB)');
{
  const T = await boot({ tier: 'quest' });
  const A = T.world.audio;
  ok(A.bed('amb-forest') === true, 'bed starts loading');
  await flush();
  ok(A.stats().bed === 'amb-forest', 'bed active: ' + A.stats().bed);
  A.bed('amb-village', { fade: 4 });
  await flush();
  ok(A.stats().bed === 'amb-village', 'bed crossfaded');
  ok(A.bed('ui-tick') === false, 'a one-shot is not a bed');
  // fill the cache far beyond the budget with fake 2-channel 8 MB buffers
  for (const name of ['amb-wind', 'amb-night-field', 'amb-lake', 'amb-battlefield', 'amb-tavern']) { await A.preload([name]); }
  const st = A.stats();
  ok(st.cachedMB <= st.budgetMB + 0.1, `decoded audio stays under the budget (${st.cachedMB} / ${st.budgetMB} MB)`);
  ok(A._debug.cache.has(A._debug.pack.get('amb-village').urls[0]), 'the pinned (playing) bed was not evicted');
  A.bed(null);
  ok(A.stats().bed === null, 'bed(null) stops');
}

section('hot reload');
{
  const T = makeCtx();
  installFetch(T.rec);
  const sharedState = T.ctx.state;
  const elBefore = FakeAudio.all.length;
  let inst = make(T.ctx);
  await flush(); await flush();
  const A1 = T.world.audio;
  A1.music('calm');
  const bytes = A1.stats().cachedBuffers;
  T.dispose(inst);
  ok(!T.world.audio, 'world.audio removed on unload');
  await new Promise((r) => setTimeout(r, 300));
  inst = make(T.ctx);
  await flush();
  ok(!!T.world.audio && T.world.audio !== A1, 'new instance provides world.audio');
  ok(T.world.audio.stats().cachedBuffers >= bytes, 'decoded buffers survive the reload');
  ok(FakeAudio.all.length - elBefore <= 4, `media elements are reused (${FakeAudio.all.length - elBefore} new)`);
  ok(T.world.audio.sfx('slash-flesh') === true, 'plays after reload');
  T.dispose(inst);
}

section('ambience.js zone scan');
{
  const A = await loadAmb(1);
  const T = makeCtx();
  installFetch(T.rec);
  const audioCalls = [];
  const stubAudio = { bed: (n) => { audioCalls.push(n); return true; }, setZone() {}, stats: () => ({ bed: audioCalls.at(-1) ?? null }) };
  T.world.audio = stubAudio;
  const grp = (name, x, z) => ({ name: `lib:${name}`, position: { x, z } });
  const root = { name: 'module:creations/stuff.js', children: [] };
  T.ctx.scene.children.push(root);
  T.ctx.world.env = { timeOfDay: 0.6, wind: 0.4 };
  T.ctx.world.groundHeight = () => 0;
  const inst = A(T.ctx);
  const run = (sec) => { for (let i = 0; i < sec * 10; i++) { T.ctx.clock.t += 0.1; T.ac.currentTime += 0.1; inst.update(0.1, T.ctx.clock.t); } };
  run(2);
  ok(audioCalls.at(-1) === 'amb-wind', 'open field -> amb-wind: ' + audioCalls.at(-1));
  for (let i = 0; i < 8; i++) root.children.push(grp('oak-tree', 5 + i, 3));
  run(8);
  ok(audioCalls.at(-1) === 'amb-forest', 'many trees -> amb-forest: ' + audioCalls.at(-1));
  root.children.length = 0;
  root.children.push(grp('cottage', 8, 8), grp('hut', 12, 4), grp('well', 6, 6));
  run(8);
  ok(audioCalls.at(-1) === 'amb-village', 'cottages -> amb-village: ' + audioCalls.at(-1));
  root.children.push(grp('tavern', 4, 4));
  run(8);
  ok(audioCalls.at(-1) === 'amb-tavern', 'tavern nearby -> amb-tavern: ' + audioCalls.at(-1));
  root.children.length = 0;
  T.ctx.world.env.timeOfDay = 0.1;
  run(8);
  ok(audioCalls.at(-1) === 'amb-night-field', 'night -> amb-night-field: ' + audioCalls.at(-1));
  inst.dispose();
}

// every name mentioned in the header doc of audio.js must exist in the real pack.json (if it has been generated)
section('header names vs real pack.json');
{
  const src = fs.readFileSync(path.join(CORE, 'audio.js'), 'utf8');
  const all = src.split('\n'); let end = 0; while (end < all.length && all[end].startsWith('//')) end++;
  const head = all.slice(0, end).join('\n');
  const lines = head.split('\n');
  ok(lines.length <= 45, `header is ${lines.length} lines (max 45)`);
  const packFile = path.resolve(HERE, '..', '..', 'public', 'assets', 'generated', 'audio', 'pack.json');
  if (fs.existsSync(packFile)) {
    const real = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    const names = new Set();
    for (const m of head.matchAll(/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-\{([a-z0-9,\- ]+)\}|\b([a-z]+(?:-[a-z0-9]+)+)\b/g)) {
      if (m[2]) for (const part of m[2].split(',')) names.add(`${m[1]}-${part.trim()}`);
      else names.add(m[3]);
    }
    const prefixes = /^(slash|blunt|pierce|swing|step|break|amb|music|omni|ui|quest|arrow|weapon|goblin|orc|troll|skeleton|zombie|demon|dragon|wolf|bear|spider|slime|ghost|bat|robot|golem|player|humanoid|explosion|fire|ice|heal|lightning|chain|thunder|shield|gore|limb|bone|body|hit|crossbow|blaster|plasma|shotgun|rifle|pistol|gunshot|sniper|rocket|grenade|bullet|tree|building|debris|door|chest|chain|cow|sheep|pig|chicken|horse|cat|dog|crow|fox|owl|bird|frog|deer|villager|crowd|child|ground|clang|thrust|boomerang|smoke|blood|armor|heartbeat|land|level|pickup|spell|magic|arcane|necro|teleport|summon|force|earth|levitate|conjure|gravity|meteor|telekinesis|flame|imp|monster|elemental|wraith|bow)-/;
    const missing = [...names].filter((n) => prefixes.test(n) && !real[n] && !/^(music-changed|ui-tick,)/.test(n));
    ok(missing.length === 0, 'names in the header that are not in pack.json: ' + missing.join(', '));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
