// core/voices.js — world.voices: NPCs SPEAK, and the player can TALK TO them. Nothing to call for the common case.
//
// AUTOMATIC   every actor.say(text) (event 'actor:say') is spoken aloud at the actor with a Kokoro voice cast from its role, so
//   kit.humanoid(...).say("Halt!") already talks. Voices are deterministic per actor, positional, follow the actor, duck under the
//   Omnissiah, are capped at 4 at once (nearest win) and dropped when the server is busy. Creatures never talk (humanoids only).
// SPEAK       world.voices.speak(actorOrPosition, text, { voice, emotion, speed, rate, fx }) -> true if requested
//               voice: Kokoro id ('am_adam','af_nova','bm_lewis','am_puck','am_onyx','bm_george','af_sky'...); rate: browser pitch/tempo
//               factor (1.3 = goblin-high, 0.7 = troll-low); fx: { helmet, drive 0..1, hollow, reverb 0..1, gain }.
//               emotion: 'angry'|'scared'|'sad'|'excited'|'calm'. actor.say() is shown as the bubble; speak() on its own is audio only.
// CASTING     world.voices.cast(actor) -> { id, name, role, voice, speed, rate, fx }   world.voices.setVoice(actor, { ...override })
//               role words matched (knight mage archer rogue villager merchant king child goblin orc troll skeleton demon zombie ...)
//               from actor.role / fighter name / actor.name / the model name. Set actor.role = 'merchant' (and actor.npcName,
//               actor.persona) on things you create to steer the voice and what the NPC says about itself.
// TALKING     The player holds the talk trigger while pointing the RIGHT hand (or looking) at a living humanoid within 8 m: the
//   speech goes to that NPC instead of the Omnissiah. A ring + name tag shows who is listening. The NPC answers in character
//   (server/plugins/voice.js, 1-2 sentences), faces the player and may act: follow, stay, attack, flee, give, wave, dance
//   (ignored for enemies, who taunt and keep fighting). world.voices.target() = the NPC being aimed at now, or null.
// SETTINGS    voices.enabled (bool), voices.volume 0..1 (persisted), voices.setSpace('field'|'dungeon'|'cave'|'hall') = reverb amount,
//   voices.setOmnissiahStyle('godlike'|'clean'|'subtle') (the Omnissiah's own voice effects, persisted by sys/voice.js).
// EVENTS      'voices:speak' { actor, text }  'voices:reply' { actor, text, intent }  'voices:target' { actor|null }
// actor.speaking = 0..1 loudness while it talks (head bone is pulsed a little on model bodies).

export const meta = { name: 'Voices', description: 'NPC speech (Kokoro), positional voices, talking to NPCs.' };

// ================================================================ pure helpers (exported so they can be tested headlessly)
export function hash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pickFrom = (arr, h) => arr[h % arr.length];

const FEMALE = ['af_bella', 'af_nicole', 'af_sarah', 'af_jessica', 'af_heart', 'af_aoede', 'af_kore', 'af_alloy', 'af_river', 'bf_emma', 'bf_alice', 'bf_lily', 'bf_isabella'];
const MALE = ['am_michael', 'am_eric', 'am_liam', 'am_echo', 'am_adam', 'bm_daniel', 'bm_george'];

// ordered: the first matching archetype wins. speed = Kokoro tempo range, rate = browser playbackRate range (pitch AND tempo).
export const ARCHETYPES = [
  { key: 'dark-knight', re: /dark.?knight|black.?knight|death.?knight/, voices: ['am_onyx'], speed: [0.88, 0.94], rate: [0.9, 0.94], fx: { helmet: 1, drive: 0.12, reverb: 0.12 }, kind: 'person', persona: 'a cold, menacing knight sworn to a dark lord; speaks slowly and with contempt' },
  { key: 'goblin-shaman', re: /goblin.?(shaman|mage|witch)|hobgoblin.?shaman/, voices: ['bm_fable', 'am_puck'], speed: [0.9, 0.96], rate: [1.25, 1.35], fx: { drive: 0.35, reverb: 0.15 }, kind: 'monster', persona: 'a cackling goblin shaman who mutters curses and half-prophecies' },
  { key: 'goblin', re: /\bgoblin|\bimps?\b|gremlin|kobold|hobgoblin|\bgnome/, voices: ['am_puck', 'am_echo', 'am_liam'], speed: [0.9, 1.0], rate: [1.28, 1.42], fx: { drive: 0.3 }, kind: 'monster', persona: 'a sly, crude, greedy goblin who sneers and cackles' },
  { key: 'troll', re: /\btroll|\bogre|\bgiant|\bgolem|cyclops/, voices: ['am_onyx', 'am_fenrir'], speed: [0.9, 0.97], rate: [0.62, 0.72], fx: { drive: 0.25, reverb: 0.1 }, kind: 'monster', persona: 'a huge, slow, dim troll who speaks in short blunt grunts' },
  { key: 'orc', re: /\b(orcs?|uruk|beastman)\b/, voices: ['am_onyx', 'am_fenrir', 'am_adam'], speed: [0.9, 0.98], rate: [0.74, 0.84], fx: { drive: 0.25 }, kind: 'monster', persona: 'a brutal, proud orc who respects strength and mocks weakness' },
  { key: 'skeleton', re: /skeleton|\bbones?\b|undead|\blich\b|revenant/, voices: ['bm_daniel', 'bm_fable'], speed: [0.9, 0.96], rate: [0.94, 1.0], fx: { hollow: 1, reverb: 0.2 }, kind: 'monster', persona: 'a hollow, rattling skeleton with a gallows sense of humour' },
  { key: 'demon', re: /demon|devil|fiend|daemon|hellhound|succubus|archfiend/, voices: ['am_fenrir', 'am_onyx'], speed: [0.84, 0.9], rate: [0.66, 0.74], fx: { drive: 0.55, reverb: 0.35 }, kind: 'monster', persona: 'a smouldering demon that speaks of bargains, ash and old debts' },
  { key: 'zombie', re: /zombie|ghoul|corpse|mummy|wight/, voices: ['am_eric', 'bm_daniel'], speed: [0.66, 0.74], rate: [0.8, 0.88], fx: { drive: 0.2, reverb: 0.1 }, kind: 'monster', persona: 'a shambling undead that groans single words and hungry half-thoughts' },
  { key: 'vampire', re: /vampire|nosferatu/, voices: ['bm_george', 'bm_lewis'], speed: [0.88, 0.94], rate: [0.94, 0.98], fx: { reverb: 0.3 }, kind: 'monster', persona: 'an aristocratic, patient vampire who is polite in a way that feels dangerous' },
  { key: 'ghost', re: /ghost|spirit|wraith|phantom|spectre/, voices: ['af_kore', 'af_aoede'], speed: [0.84, 0.9], rate: [0.9, 0.96], fx: { reverb: 0.55, hollow: 0.5 }, kind: 'monster', persona: 'a faint, wistful ghost who half remembers who it was' },
  { key: 'knight', re: /knight|paladin|guard|soldier|captain|warrior|sentinel/, voices: ['am_adam', 'am_michael', 'bm_lewis'], speed: [0.92, 1.0], rate: [0.96, 1.0], fx: { helmet: 1, reverb: 0.1 }, kind: 'person', persona: 'a steadfast, honour-bound knight; short, formal sentences, proud and protective' },
  { key: 'barbarian', re: /barbarian|viking|berserk|gladiator|brute/, voices: ['am_fenrir', 'am_onyx'], speed: [0.9, 0.98], rate: [0.92, 0.98], fx: { drive: 0.1 }, kind: 'person', persona: 'a loud, boastful barbarian who loves a fight and a feast' },
  { key: 'mage', re: /mage|wizard|sorcer|witch|warlock|conjur|druid|shaman(?!.*goblin)/, voices: ['bm_george', 'bm_fable', 'af_aoede'], speed: [0.92, 1.0], rate: [1, 1.02], fx: { reverb: 0.2 }, kind: 'person', persona: 'a dry, curious mage who speaks in riddles and muses about the arcane' },
  { key: 'archer', re: /archer|ranger|hunter|scout|bowman/, voices: ['am_liam', 'am_echo', 'af_river'], speed: [1.0, 1.08], rate: [1.0, 1.04], fx: { reverb: 0.05 }, kind: 'person', persona: 'a quiet, watchful ranger; speaks little, notices everything' },
  { key: 'rogue', re: /rogue|thief|assassin|bandit|outlaw|pirate/, voices: ['am_echo', 'am_puck', 'af_nova'], speed: [1.02, 1.1], rate: [1.0, 1.05], fx: { reverb: 0.05 }, kind: 'person', persona: 'a sly, wry rogue with a quick tongue and no fixed loyalties' },
  { key: 'king', re: /\bking|\bqueen|\blord\b|\bduke\b|emperor|\bprince|\bnoble|majesty|regent/, voices: ['bm_lewis', 'bm_george'], speed: [0.84, 0.9], rate: [0.94, 0.97], fx: { reverb: 0.3 }, kind: 'person', persona: 'a regal ruler, used to being obeyed; grand, slow and a little vain' },
  { key: 'merchant', re: /merchant|trader|shop|vendor|peddler|innkeeper|tavern|baker|smith/, voices: ['am_santa', 'am_eric', 'af_nicole'], speed: [1.0, 1.08], rate: [1.0, 1.03], fx: {}, kind: 'person', persona: 'an eager, talkative merchant always hinting at a bargain' },
  { key: 'child', re: /\bchild|\bkid\b|\bboy\b|\bgirl\b|youngster|urchin/, voices: ['af_nova', 'af_sky', 'af_bella'], speed: [1.04, 1.12], rate: [1.2, 1.28], fx: {}, kind: 'person', persona: 'a bright, blunt child who asks questions and says what everyone is thinking' },
  { key: 'elder', re: /\belder|\bold\b|\bsage\b|hermit|priest|\bmonk\b|grave.?keeper|\bkeeper/, voices: ['bm_fable', 'bm_daniel'], speed: [0.84, 0.92], rate: [0.94, 0.98], fx: { reverb: 0.1 }, kind: 'person', persona: 'a slow, wise elder who has seen a great deal and answers with gentle proverbs' },
  { key: 'villager-f', re: /\bfemale|\bwoman|\blady\b|\bgirl\b|\bmaid|\bwife\b|\bmother\b/, voices: FEMALE, speed: [0.96, 1.04], rate: [1.0, 1.04], fx: {}, kind: 'person', persona: 'a plain-spoken villager, a little nervous about the monsters but kind' },
  { key: 'villager', re: /villager|peasant|farmer|citizen|commoner|townsfolk|man\b|male/, voices: MALE, speed: [0.95, 1.05], rate: [0.98, 1.03], fx: {}, kind: 'person', persona: 'a plain-spoken villager, a little nervous about the monsters but kind' },
];
const DEFAULT_ARCH = { key: 'person', voices: [...MALE, ...FEMALE], speed: [0.95, 1.05], rate: [0.98, 1.03], fx: {}, kind: 'person', persona: 'an ordinary person of this world, plain-spoken and curious' };

const NAMES_PERSON = ['Aldric', 'Bronwen', 'Cedric', 'Dara', 'Edmund', 'Freya', 'Gareth', 'Hilda', 'Ivo', 'Jorun', 'Kael', 'Lyra', 'Marek', 'Nessa', 'Orrin', 'Petra', 'Quill', 'Rowan', 'Sigrid', 'Tobin', 'Una', 'Varek', 'Wren', 'Yara'];
const NAMES_MONSTER = ['Grukk', 'Snag', 'Mogrul', 'Zeb', 'Krath', 'Nibble', 'Brakka', 'Ghul', 'Skrit', 'Dorn', 'Vex', 'Urzog', 'Rattle', 'Hagroth', 'Pox', 'Morrg'];

// role words come from many places; join them so one regex pass finds the archetype
export function archetypeFor(text) {
  const t = String(text || '').toLowerCase();
  for (const a of ARCHETYPES) if (a.re.test(t)) return a;
  return DEFAULT_ARCH;
}
export function castVoice({ id, roleText, faction } = {}) {
  const h = hash(id ?? roleText ?? 'npc');
  const a = archetypeFor(roleText);
  const t1 = ((h >>> 8) & 255) / 255, t2 = ((h >>> 16) & 255) / 255;
  const names = a.kind === 'monster' ? NAMES_MONSTER : NAMES_PERSON;
  return {
    archetype: a.key, kind: a.kind, persona: a.persona,
    voice: pickFrom(a.voices, h), speed: +lerp(a.speed[0], a.speed[1], t1).toFixed(3), rate: +lerp(a.rate[0], a.rate[1], t2).toFixed(3),
    fx: { ...a.fx }, name: pickFrom(names, h >>> 4), faction,
  };
}

// Distance from `c` to the ray (o, d unit), and the ray parameter. Pure: plain {x,y,z}.
export function rayTest(o, d, c) {
  const vx = c.x - o.x, vy = c.y - o.y, vz = c.z - o.z;
  const t = vx * d.x + vy * d.y + vz * d.z;
  const px = vx - d.x * t, py = vy - d.y * t, pz = vz - d.z * t;
  return { t, perp: Math.hypot(px, py, pz) };
}
// Which candidate does the player address? cands: [{ key, center:{x,y,z}, height }]. The right-hand ray wins over gaze.
// Returns the winning candidate key or null. max = reach in metres.
export function chooseTarget({ hand, gaze, cands, max = 8 }) {
  let best = null, bestScore = Infinity;
  const eval1 = (ray, bias, narrow) => {
    if (!ray) return;
    for (const c of cands) {
      const { t, perp } = rayTest(ray.origin, ray.dir, c.center);
      if (t < 0.25 || t > max + 0.5) continue;
      const tol = (Math.max(0.5, (c.height || 1.7) * 0.3) + 0.05 * t) * narrow;
      if (perp > tol) continue;
      const score = bias + perp / tol + t * 0.01;
      if (score < bestScore) { bestScore = score; best = c.key; }
    }
  };
  eval1(hand, 0, 1);
  eval1(gaze, 2, 0.6);
  return best;
}

// ================================================================ the module
export default function (ctx) {
  const THREE = ctx.THREE;
  const S = ctx.state;
  S.ids ??= new WeakMap();
  S.seq ??= 0;
  S.byId ??= new Map();       // npc id -> actor (weak enough: pruned when removed)
  S.overrides ??= new WeakMap();
  S.settings ??= (() => {
    let v = {};
    try { v = JSON.parse(localStorage.getItem('omnissiah.voices') || '{}'); } catch { /* storage unavailable */ }
    return { enabled: v.enabled !== false, volume: typeof v.volume === 'number' ? clamp(v.volume, 0, 1) : 0.9 };
  })();
  const saveSettings = () => { try { localStorage.setItem('omnissiah.voices', JSON.stringify(S.settings)); } catch { /* ignore */ } };

  const world = ctx.world, input = ctx.input, events = ctx.events;
  const ac = ctx.audio?.context;
  const out = ctx.audio?.listener?.getInput?.() ?? ac?.destination;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const head = () => ctx.player.head;

  // ------------------------------------------------------------ actors and identity
  function allActors() {
    const set = new Set();
    const add = (a) => { if (a && a.group && !a.removed) set.add(a); };
    const K = world.kit;
    try {
      const ka = typeof K?.actors === 'function' ? K.actors() : K?.actors;
      if (ka && typeof ka[Symbol.iterator] === 'function') for (const a of ka) add(a);
    } catch { /* kit without a registry */ }
    for (const f of world.combat?.fighters ?? []) add(f.actor);
    for (const a of S.seen ?? []) add(a);
    // scene scan for anything that exposes its actor on userData (cheap, once a second)
    return set;
  }
  S.seen ??= new Set();
  const isHumanoid = (a) => a && (a.kind === 'humanoid' || a.mdl?.kind === 'humanoid') && a.kind !== 'creature';
  const alive = (a) => a && !a.dead && !a.removed && a.group && a.group.parent !== null;
  function idOf(a) {
    let id = S.ids.get(a);
    if (!id) { id = a.voiceId || `npc${++S.seq}`; S.ids.set(a, id); }
    S.byId.set(id, a);
    return id;
  }
  const fighterOf = (a) => a.damage?.fighter ?? (world.combat?.fighters ?? []).find((f) => f.actor === a) ?? null;
  function roleText(a) {
    const f = fighterOf(a);
    const parts = [a.role, a.npcRole, a.userData?.role, a.group?.userData?.role, f?.name, a.name, a.group?.userData?.libName, a.mdl?.name, a.mdl?.cand?.name, a.group?.name];
    return parts.filter((p) => typeof p === 'string' && p).join(' ').toLowerCase();
  }
  function roleLabel(a, arch) {
    const f = fighterOf(a);
    const p = [a.role, a.npcRole, f?.name, a.name, a.mdl?.name].find((x) => typeof x === 'string' && x && !/^model|^lib:/.test(x));
    return String(p ?? arch.archetype).replace(/[-_]+/g, ' ').replace(/\b[a-z]$/i, '').trim().slice(0, 40) || arch.archetype;
  }
  function cast(a) {
    if (!a) return null;
    const id = idOf(a);
    const f = fighterOf(a);
    const faction = a.faction ?? f?.faction ?? 'neutral';
    const rt = roleText(a);
    const c = castVoice({ id, roleText: rt, faction });
    const ov = S.overrides.get(a);
    const fx = { ...c.fx, ...(ov?.fx ?? {}) };
    return {
      id, name: a.npcName ?? ov?.name ?? c.name, role: roleLabel(a, c), archetype: c.archetype, persona: a.persona ?? c.persona, faction,
      voice: ov?.voice ?? c.voice, speed: ov?.speed ?? c.speed, rate: ov?.rate ?? c.rate, fx,
    };
  }
  const headPos = (a, o = V()) => {
    const b = a.mdl?.h?.bones?.head ?? a.mdl?.h?.bones?.Head;
    if (b && a.mdl.ready && b.getWorldPosition) { try { return b.getWorldPosition(o); } catch { /* fall through */ } }
    const p = a.group.position;
    return o.set(p.x, p.y + (a.eyeH ?? (a.height ?? 1.7) * 0.93), p.z);
  };
  const centerPos = (a, o = V()) => { const p = a.group.position; return o.set(p.x, p.y + (a.height ?? 1.7) * 0.55, p.z); };
  const distToPlayer = (a) => Math.hypot(a.group.position.x - head().x, a.group.position.y - head().y, a.group.position.z - head().z);

  // ------------------------------------------------------------ audio graph
  let master = null, duck = null, reverbBus = null, reverbSend = null, impulse = null;
  const SPACES = { field: 0.0, hall: 0.35, dungeon: 0.5, cave: 0.75 };
  S.space ??= 'field';
  function ensureAudio() {
    if (master || !ac || !out) return !!master;
    master = ac.createGain(); master.gain.value = S.settings.volume;
    duck = ac.createGain(); duck.gain.value = 1;
    const limiter = ac.createDynamicsCompressor(); // safety: heavy fx / many voices must never clip the output
    limiter.threshold.value = -8; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.12;
    duck.connect(limiter); limiter.connect(master); master.connect(out);
    reverbSend = ac.createGain(); reverbSend.gain.value = 1;
    const conv = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 1.4), buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.28)) * (i < 200 ? i / 200 : 1);
    }
    conv.buffer = buf;
    reverbBus = ac.createGain(); reverbBus.gain.value = 0.35;
    reverbSend.connect(conv); conv.connect(reverbBus); reverbBus.connect(duck);
    impulse = conv;
    return true;
  }
  const decoded = new Map(); // url -> Promise<AudioBuffer|null>
  function loadBuffer(url) {
    if (decoded.has(url)) return decoded.get(url);
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => ac.decodeAudioData(ab)).catch((err) => { console.warn('[voices] could not load', url, err); return null; });
    decoded.set(url, p);
    if (decoded.size > 30) decoded.delete(decoded.keys().next().value);
    return p;
  }
  function shapeCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * (1 + k * 6)) / Math.tanh(1 + k * 6); }
    return c;
  }
  function biq(type, f, q, g) { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; if (g != null) n.gain.value = g; return n; }
  // returns { input, output, send, nodes }: the archetype colouring between the source and the panner
  function buildFx(fx) {
    const nodes = [];
    const input = ac.createGain();
    let tail = input;
    const chain = (n) => { tail.connect(n); tail = n; nodes.push(n); return n; };
    if (fx.helmet) { chain(biq('highpass', 280, 0.7)); chain(biq('lowpass', 3300, 0.9)); chain(biq('peaking', 900, 1.2, 5 * fx.helmet)); }
    if (fx.drive > 0) {
      const w = ac.createWaveShaper(); w.curve = shapeCurve(fx.drive); w.oversample = '2x'; chain(w); chain(biq('lowpass', 5200, 0.7));
      const comp = ac.createGain(); comp.gain.value = 1 / (1 + fx.drive * 1.6); chain(comp); // distortion adds level: take it back
    }
    if (fx.hollow) { // comb + band-pass: a voice that lives inside a skull
      const sum = ac.createGain(), d = ac.createDelay(0.05), fb = ac.createGain(), bp = biq('bandpass', 1100, 0.6);
      d.delayTime.value = 0.0065; fb.gain.value = 0.5 * fx.hollow;
      tail.connect(bp); bp.connect(sum); tail.connect(d); d.connect(fb); fb.connect(d); d.connect(sum);
      tail = sum; nodes.push(sum, d, fb, bp);
    }
    const out2 = ac.createGain(); out2.gain.value = fx.gain ?? 1;
    tail.connect(out2); nodes.push(out2);
    return { input, output: out2, nodes };
  }

  // ------------------------------------------------------------ playing voices
  const playing = []; // { actor, src, panner, gain, analyser, pos(Vector3), priority, endsAt, fx nodes, level }
  const MAX_VOICES = 4;
  S.supp ??= new Map(); // text -> until ms (reply texts already spoken: ignore their actor:say echo)
  const _hp = V(), _lp = V();

  function stopRec(r, fadeMs = 80) {
    if (r.stopped) return;
    r.stopped = true;
    try {
      const t = ac.currentTime;
      r.gain.gain.cancelScheduledValues(t); r.gain.gain.setTargetAtTime(0, t, fadeMs / 3000);
      r.src.stop(t + fadeMs / 1000 + 0.05);
    } catch { /* already stopped */ }
  }
  function cleanupRec(r) {
    const i = playing.indexOf(r); if (i >= 0) playing.splice(i, 1);
    r.stopped = true;
    try { r.src.disconnect(); r.panner.disconnect(); r.gain.disconnect(); r.analyser.disconnect(); r.fxn.input.disconnect(); r.fxn.output.disconnect(); for (const n of r.fxn.nodes) n.disconnect(); r.sendG?.disconnect(); } catch { /* ignore */ }
    if (r.actor) { r.actor.speaking = 0; restoreHead(r); }
  }
  function restoreHead(r) { if (r.bone && r.boneScale) { r.bone.scale.copy(r.boneScale); r.bone = null; } }

  // Kokoro voices differ a lot in loudness (an elder is 10 dB quieter than a troll): level every clip to about -17 dBFS RMS
  const levels = new WeakMap();
  function levelOf(buf) {
    let k = levels.get(buf);
    if (k === undefined) {
      k = 1;
      try {
        const d = buf.getChannelData?.(0);
        if (d && d.length) { let s = 0; const step = Math.max(1, Math.floor(d.length / 20000)); let n = 0; for (let i = 0; i < d.length; i += step) { s += d[i] * d[i]; n++; } const rms = Math.sqrt(s / n); if (rms > 1e-4) k = clamp(0.14 / rms, 0.6, 4); }
      } catch { /* keep 1 */ }
      levels.set(buf, k);
    }
    return k;
  }
  function playBuffer(buf, o) {
    if (!ensureAudio() || !buf) return null;
    if (ac.state === 'suspended') { try { ac.resume(); } catch { /* needs a gesture */ } }
    const pos = o.actor ? headPos(o.actor, V()) : V().copy(o.position ?? head());
    const dist = Math.hypot(pos.x - head().x, pos.y - head().y, pos.z - head().z);
    // global cap, nearest first (replies to the player always play)
    let active = 0;
    for (const r of playing) if (!r.stopped) active++;
    if (active >= MAX_VOICES) {
      let far = null;
      for (const r of playing) { if (r.stopped) continue; if (!far || (r.priority - far.priority) < 0 || (r.priority === far.priority && r.dist > far.dist)) far = r; }
      if (far && (o.priority > far.priority || (o.priority === far.priority && dist < far.dist - 0.5))) stopRec(far, 60);
      else return null;
    }
    const src = ac.createBufferSource(); src.buffer = buf; src.playbackRate.value = o.rate ?? 1;
    const fxn = buildFx(o.fx ?? {});
    const gain = ac.createGain(); gain.gain.value = 0;
    const panner = ac.createPanner();
    panner.panningModel = playing.length < 3 ? 'HRTF' : 'equalpower'; panner.distanceModel = 'inverse';
    panner.refDistance = 2.2; panner.rolloffFactor = 1.5; panner.maxDistance = 100;
    const analyser = ac.createAnalyser(); analyser.fftSize = 256;
    src.connect(fxn.input); fxn.output.connect(gain); gain.connect(panner); panner.connect(duck);
    fxn.output.connect(analyser);
    let sendG = null;
    const rv = clamp((o.fx?.reverb ?? 0) + SPACES[S.space] , 0, 1);
    if (rv > 0.01) { sendG = ac.createGain(); sendG.gain.value = rv * 0.6; gain.connect(sendG); sendG.connect(reverbSend); }
    const setPos = (p) => { if (panner.positionX) { panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z; } else panner.setPosition(p.x, p.y, p.z); };
    setPos(pos);
    const vol = (o.volume ?? 1) * (o.priority > 0 ? 1.15 : 1) * (o.fx?.loud ?? 1) * levelOf(buf);
    const t = ac.currentTime;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(vol, t + 0.03);
    const rec = { actor: o.actor ?? null, src, panner, gain, analyser, fxn, sendG, pos, priority: o.priority ?? 0, dist, vol, setPos, stopped: false, level: 0, t0: now(), data: new Float32Array(analyser.fftSize), bone: null, boneScale: null };
    src.onended = () => cleanupRec(rec);
    src.start(t + 0.01);
    playing.push(rec);
    if (o.actor) {
      o.actor.speaking = 0;
      const b = o.actor.mdl?.h?.bones?.head ?? o.actor.mdl?.h?.bones?.Head;
      if (b && b.scale) { rec.bone = b; rec.boneScale = b.scale.clone(); }
    }
    return rec;
  }

  // ------------------------------------------------------------ requesting speech from the server
  S.pending ??= new Map();  // rid -> { actor, text, t, opts }
  S.rid ??= 0;
  const lastSpoke = new WeakMap();
  const recentStarts = [];
  const MAX_PENDING = 3;
  const isCreature = (a) => a.kind === 'creature';
  function request(actor, text, o = {}) {
    if (!S.settings.enabled || !ctx.net || !ctx.net.connected) return false;
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!/[A-Za-zÀ-ɏ]{2}/.test(clean)) return false;
    const t = now();
    const c = actor ? cast(actor) : null;
    const dist = actor ? distToPlayer(actor) : (o.position ? head().distanceTo(o.position) : 0);
    if (dist > (o.maxDist ?? 24)) return false;
    if (actor) {
      if (actor.dead || actor.removed) return false;
      if (isCreature(actor) && !o.force) return false;
      if (t - (lastSpoke.get(actor) ?? -1e9) < 1200) return false;
    }
    while (recentStarts.length && t - recentStarts[0] > 1500) recentStarts.shift();
    if (recentStarts.length >= 3 && !o.priority) return false;
    if (S.pending.size >= MAX_PENDING && !o.priority) return false;
    if (actor) lastSpoke.set(actor, t);
    recentStarts.push(t);
    const rid = `${ctx.path ?? 'voices'}:${++S.rid}`;
    const spec = {
      voice: o.voice ?? c?.voice ?? 'am_adam', speed: o.speed ?? c?.speed ?? 1, rate: o.rate ?? c?.rate ?? 1, fx: { ...(c?.fx ?? {}), ...(o.fx ?? {}) },
    };
    S.pending.set(rid, { actor, position: o.position ? V().copy(o.position) : null, text: clean, t, spec, emotion: o.emotion, priority: o.priority ?? 0, reply: !!o.reply });
    ctx.net.send({ type: 'npc_say', id: actor ? idOf(actor) : 'pos', rid, text: clean, voice: spec.voice, speed: spec.speed, emotion: o.emotion ?? emotionOf(actor) });
    events.emit('voices:speak', { actor, text: clean });
    return true;
  }
  function emotionOf(a) {
    if (!a) return undefined;
    const f = fighterOf(a);
    if (f?.fleeing) return 'scared';
    if (f?.tgt || f?.state) return a.faction === 'enemy' || f?.faction === 'enemy' ? 'angry' : undefined;
    return undefined;
  }

  async function onVoice(msg) {
    const p = S.pending.get(msg.rid);
    if (!p) return;
    S.pending.delete(msg.rid);
    if (!msg.audio) return;
    const age = (now() - p.t) / 1000;
    if (age > 9 && !p.reply) return; // too late to be useful
    const buf = await loadBuffer(msg.audio);
    if (!buf || !S.settings.enabled) return;
    const a = p.actor;
    if (a && (a.dead || a.removed)) return;
    if (a && distToPlayer(a) > 30) return;
    playBuffer(buf, { actor: a, position: p.position, rate: p.spec.rate, fx: p.spec.fx, priority: p.priority, volume: p.reply ? 1.1 : 1 });
  }

  // ------------------------------------------------------------ NPC lines: actor:say -> speech
  ctx.on('actor:say', (e) => {
    const a = e && e.actor;
    if (!a || typeof e.text !== 'string') return;
    S.seen.add(a); // remember it for targeting even when it is not a fighter
    if (S.seen.size > 400) for (const x of S.seen) { if (x.removed) S.seen.delete(x); }
    const until = S.supp.get(e.text);
    if (until && until > now()) return;
    request(a, e.text, {});
  });
  ctx.on('net:npc_voice', onVoice);

  // ------------------------------------------------------------ addressing an NPC
  let lock = null;           // { actor|null, id } for the current hold of the talk trigger
  let hover = null;
  const talkHeld = () => !!(input.left?.down?.trigger);
  function candidates() {
    const out2 = [], hp = head();
    for (const a of allActors()) {
      if (!isHumanoid(a) || !alive(a) || a.hidden || a.noTalk) continue;
      const c = centerPos(a);
      if (Math.hypot(c.x - hp.x, c.z - hp.z) > 8.5) continue;
      out2.push({ key: a, center: { x: c.x, y: c.y, z: c.z }, height: a.height ?? 1.7 });
    }
    return out2;
  }
  function pick() {
    const cands = candidates();
    if (!cands.length) return null;
    const rh = input.right;
    const hand = rh && rh.direction && rh.position && rh.connected !== false ? { origin: rh.position, dir: rh.direction } : null;
    const gaze = { origin: head(), dir: ctx.player.forward };
    return chooseTarget({ hand, gaze, cands, max: 8 });
  }
  function npcInfo(a) {
    const c = cast(a), f = fighterOf(a);
    const hp = f ? f.hp / (f.maxHp || 1) : (a.damage ? a.damage.hp / (a.cfg?.hp || a.damage.maxHp || 20) : 1);
    let mood = 'calm';
    if (f?.fleeing) mood = 'afraid'; else if (c.faction === 'enemy') mood = 'hostile'; else if (hp < 0.4) mood = 'hurt'; else if (f?.tgt) mood = 'tense';
    const held = a.heldType ?? a.held?.userData?.weaponType ?? null;
    const nearby = [];
    const pd = distToPlayer(a);
    nearby.push(`the player stands ${pd.toFixed(0)} m away${world.weapons?.held?.right ? ' holding a ' + world.weapons.held.right.type : ''}`);
    if (world.combat?.fighters) {
      const counts = new Map();
      const p = a.group.position;
      for (const g of world.combat.fighters) {
        if (g.actor === a || !g.alive) continue;
        const d = Math.hypot(g.actor.group.position.x - p.x, g.actor.group.position.z - p.z);
        if (d > 16) continue;
        const k = `${(g.faction === c.faction ? 'friendly ' : g.faction === 'neutral' ? '' : 'hostile ')}${roleLabel(g.actor, castVoice({ id: 'x', roleText: roleText(g.actor) }))}`;
        const e = counts.get(k) ?? { n: 0, d: 99 }; e.n++; e.d = Math.min(e.d, d); counts.set(k, e);
      }
      for (const [k, e] of [...counts].sort((x, y) => x[1].d - y[1].d).slice(0, 4)) nearby.push(`${e.n} ${k}${e.n > 1 ? 's' : ''} about ${e.d.toFixed(0)} m away`);
    }
    return { id: c.id, name: c.name, role: c.role, persona: c.persona, faction: c.faction, mood, health: +clamp(hp, 0, 1).toFixed(2), holding: held, nearby, voice: c.voice, speed: c.speed };
  }
  // The utterance context provider: only while the talk trigger is held. The target is decided at the first call of a hold.
  if (world.contextProviders) {
    world.contextProviders.npc = () => {
      if (!talkHeld()) return null;
      if (!lock) { const a = pick(); lock = { actor: a, id: a ? idOf(a) : null }; setTarget(a); }
      if (!lock.actor || !alive(lock.actor)) return null;
      return npcInfo(lock.actor);
    };
    ctx.onDispose(() => { delete world.contextProviders.npc; });
  }
  let curTarget = null;
  function setTarget(a) { if (a !== curTarget) { curTarget = a; events.emit('voices:target', { actor: a }); } }

  // ------------------------------------------------------------ replies and intents
  const timers = (S.timers ??= []); // { at, fn }
  const later = (ms, fn) => timers.push({ at: now() + ms, fn });
  function facePlayer(a, secs = 4) { try { a.faceTo?.(head(), secs); a.lookAt?.(head()); later(secs * 1000, () => { if (a.lookTarget === head()) a.lookAt?.(null); }); } catch { /* ignore */ } }
  function applyIntent(a, intent) {
    const f = fighterOf(a), K = world.kit;
    const faction = a.faction ?? f?.faction ?? 'neutral';
    if (faction === 'enemy' || !intent) return false; // enemies taunt and keep fighting
    switch (intent) {
      case 'follow':
        if (f) { f.follow = 'player'; f.followDist ??= 2.6; f.returning = false; } else a.follow?.(ctx.player.feet, 2.4);
        a.wander?.(0);
        return true;
      case 'stay':
        if (f) { f.follow = null; f.homeX = a.group.position.x; f.homeZ = a.group.position.z; }
        a.follow?.(null); a.stop?.(); a.wander?.(0);
        return true;
      case 'attack': {
        const C = world.combat;
        if (!f || !C) return false;
        const foe = C.nearest(a.group.position, { hostileTo: f.faction, maxDist: 30 });
        if (!foe) return false;
        f.setTarget(foe);
        return true;
      }
      case 'flee': {
        if (f) { f.fleeing = true; f.tgt = null; later(9000, () => { if (f && !f.removed) f.fleeing = false; }); return true; }
        const p = a.group.position, h = head(), dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
        a.follow?.(null); a.walkTo?.(p.x + (dx / d) * 14, p.z + (dz / d) * 14);
        return true;
      }
      case 'give': {
        const type = a.heldType;
        const W = world.weapons;
        if (!type || !W?.create) return false;
        const p = a.group.position, h = head(), dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz) || 1;
        try { W.create(ctx, type, { position: V(p.x + (dx / d) * 0.9, p.y + 1.1, p.z + (dz / d) * 0.9) }); a.equip?.(null); a.wave?.(1.2); return true; } catch { return false; }
      }
      case 'wave': a.wave?.(3); return true;
      case 'dance': { // spin on the spot with waving for a few seconds
        let n = 0;
        const step = () => { if (a.removed || a.dead || n++ > 12) return; const ang = n * 1.3; a.faceTo?.({ x: a.group.position.x + Math.sin(ang), z: a.group.position.z + Math.cos(ang) }, 0.4); if (n % 4 === 1) a.wave?.(1.5); later(380, step); };
        a.follow?.(null); a.stop?.(); a.wander?.(0); step();
        return true;
      }
      default: return false;
    }
  }
  ctx.on('net:npc_thinking', (m) => {
    const a = S.byId.get(m.id);
    if (!a || a.removed || a.dead) return;
    facePlayer(a, 6);
    a.say?.('...', 7);
  });
  ctx.on('net:npc_reply', async (m) => {
    const a = S.byId.get(m.id);
    if (!a || a.removed || a.dead) return;
    const text = String(m.text ?? '').slice(0, 240);
    S.supp.set(text, now() + 2000);
    facePlayer(a, 5);
    a.say?.(text, Math.max(3.5, (m.seconds || 2) + 1.5));
    events.emit('voices:reply', { actor: a, text, intent: m.intent ?? null });
    if (m.audio && S.settings.enabled) {
      const buf = await loadBuffer(m.audio);
      if (buf && !a.removed && !a.dead) {
        const c = cast(a);
        playBuffer(buf, { actor: a, rate: c.rate, fx: c.fx, priority: 2, volume: 1.15 });
      }
    }
    if (m.intent) { const ok = applyIntent(a, m.intent); if (ok) ctx.hud?.show?.(`${cast(a).name}: ${m.intent}`, 1.6); }
  });

  // ------------------------------------------------------------ highlight ring + name tag
  let ring = null, tag = null, tagText = '';
  function ensureRing() {
    if (ring) return;
    const geo = new THREE.RingGeometry(0.55, 0.66, 40); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.0, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    ring = new THREE.Mesh(geo, mat); ring.renderOrder = 999; ring.visible = false; ring.userData.noShadow = true; ring.frustumCulled = false;
    ctx.root.add(ring);
  }
  function showTag(text, color) {
    if (!world.kit?.label) return;
    if (!tag) { try { tag = world.kit.label(ctx, text, { color, size: 0.09 }); tagText = text; } catch { tag = null; } }
    else if (tagText !== text) { tag.set(text); tagText = text; }
  }
  function updateRing(dt) {
    ensureRing();
    const held = talkHeld();
    let a = null, strong = false;
    if (held) {
      if (!lock) { const p = pick(); lock = { actor: p, id: p ? idOf(p) : null }; }
      a = lock.actor && alive(lock.actor) ? lock.actor : null; strong = true;
    }
    else { // faint hover cue while pointing at someone (not while the trigger is up and the target is far)
      if (!S._hoverT || now() - S._hoverT > 120) { S._hoverT = now(); hover = pick(); }
      a = hover; if (a && !alive(a)) a = null;
    }
    if (!held && lock) { lock = null; }
    if (!held) setTarget(null);
    if (a && alive(a)) {
      const p = a.group.position;
      ring.visible = true; ring.position.set(p.x, p.y + 0.05, p.z);
      const s = (a.height ?? 1.7) * 0.5 + 0.35 + Math.sin(now() / 160) * (strong ? 0.04 : 0.0);
      ring.scale.setScalar(s);
      ring.material.opacity += ((strong ? 0.9 : 0.35) - ring.material.opacity) * Math.min(1, dt * 12);
      if (strong) {
        const c = cast(a);
        showTag(`${c.name} (${c.role})`, c.faction === 'enemy' ? '#ff9070' : '#ffe28a');
        if (tag) { tag.position.set(p.x, p.y + (a.height ?? 1.7) + 0.55, p.z); tag.show?.(true); }
      }
      else tag?.show?.(false);
      if (strong) setTarget(a);
    } else {
      ring.material.opacity *= Math.max(0, 1 - dt * 10);
      if (ring.material.opacity < 0.02) ring.visible = false;
      tag?.show?.(false);
    }
  }

  // ------------------------------------------------------------ per-frame
  let duckLevel = 1, oracleSpeaking = false;
  ctx.on('oracle:state', (s) => { oracleSpeaking = s === 'speaking'; });
  ctx.on('oracle:level', (l) => { if (l > 0.03) oracleSpeaking = true; });
  const _a = V();
  function update(dt) {
    // timers
    if (timers.length) { const t = now(); for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= t) { const x = timers.splice(i, 1)[0]; try { x.fn(); } catch (err) { console.warn('[voices] timer failed', err); } } }
    try { updateRing(dt); } catch (err) { console.warn('[voices] ring failed', err); }
    // stale requests
    if (S.pending.size) { const t = now(); for (const [k, p] of S.pending) if (t - p.t > 12000) S.pending.delete(k); }
    if (!ac || !master) return;
    // ducking under the Omnissiah
    const want = oracleSpeaking ? 0.3 : 1;
    if (want !== duckLevel) { duckLevel = want; duck.gain.setTargetAtTime(want, ac.currentTime, 0.12); }
    oracleSpeaking = false; // re-armed each frame by oracle:level while he talks
    master.gain.value = S.settings.volume;
    reverbBus.gain.value = 0.25 + SPACES[S.space] * 0.5;
    for (let i = playing.length - 1; i >= 0; i--) {
      const r = playing[i];
      if (r.stopped) continue;
      if (r.actor) {
        if (r.actor.removed || r.actor.dead) { stopRec(r, 120); continue; }
        headPos(r.actor, _a); r.setPos(_a); r.pos.copy(_a);
      }
      const d = Math.hypot(r.pos.x - head().x, r.pos.y - head().y, r.pos.z - head().z); r.dist = d;
      // fade out between 18 and 30 m so far voices vanish instead of lingering (inverse model alone never reaches zero)
      const fade = d < 18 ? 1 : clamp(1 - (d - 18) / 12, 0, 1);
      r.gain.gain.setTargetAtTime(r.vol * fade, ac.currentTime, 0.08);
      // loudness (lip flap)
      r.analyser.getFloatTimeDomainData(r.data);
      let s = 0; for (let k = 0; k < r.data.length; k++) s += r.data[k] * r.data[k];
      const lvl = clamp(Math.sqrt(s / r.data.length) * 7, 0, 1);
      r.level += (lvl - r.level) * Math.min(1, dt * 25);
      if (r.actor) {
        r.actor.speaking = r.level;
        if (r.bone && r.boneScale) { r.bone.scale.set(r.boneScale.x * (1 - 0.03 * r.level), r.boneScale.y * (1 + 0.1 * r.level), r.boneScale.z * (1 - 0.03 * r.level)); }
      }
    }
  }

  // ------------------------------------------------------------ public API
  const api = {
    get enabled() { return S.settings.enabled; },
    set enabled(v) { S.settings.enabled = !!v; if (!v) for (const r of playing.slice()) stopRec(r, 60); saveSettings(); },
    get volume() { return S.settings.volume; },
    set volume(v) { S.settings.volume = clamp(Number(v) || 0, 0, 1); saveSettings(); },
    speak(actorOrPosition, text, o = {}) {
      const isActor = actorOrPosition && actorOrPosition.group;
      if (isActor) { S.seen.add(actorOrPosition); return request(actorOrPosition, text, o); }
      return request(null, text, { ...o, position: actorOrPosition ? V().copy(actorOrPosition) : head() });
    },
    cast, setVoice(actor, o) { S.overrides.set(actor, { ...(S.overrides.get(actor) ?? {}), ...o }); return cast(actor); },
    target: () => (talkHeld() ? lock?.actor ?? null : pick()),
    info: (a) => npcInfo(a),
    stop() { for (const r of playing.slice()) stopRec(r, 60); },
    get playing() { return playing.length; },
    get pending() { return S.pending.size; },
    setSpace(name) { if (name in SPACES) S.space = name; return S.space; },
    get space() { return S.space; },
    setOmnissiahStyle(name) { events.emit('voice:set-style', name); },
    archetypes: ARCHETYPES.map((a) => a.key),
    // exposed for tests
    _t: { applyIntent, playBuffer, request, onVoice, pick, candidates },
  };
  ctx.provide('voices', api);
  ctx.onDispose(() => {
    for (const r of playing.slice()) { try { r.src.stop(); } catch { /* ignore */ } cleanupRec(r); }
    try { master?.disconnect(); duck?.disconnect(); reverbBus?.disconnect(); } catch { /* ignore */ }
    tag?.remove?.(); ring?.geometry.dispose();
  });
  return { update };
}
