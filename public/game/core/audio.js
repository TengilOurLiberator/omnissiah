// core/audio.js — world.audio: the game's sound. ~190 generated pack sounds (MOSS-SoundEffect + ACE-Step, 1-4 variants each) play AUTOMATICALLY for weapons, kit.hit
//   damage, deaths + creature voices, gore, destruction, spells, footsteps, quests, new creations, plus an adaptive music score + ambience beds. Add only what is special.
// USE  const A = ctx.world.audio;   // may be missing/reloading: guard it.   Positions are world coordinates (Vector3 or {x,y,z}).
//   A.sfx(nameOrPrompt, { at, volume = 1, pitch = 1, variant, generate, seconds = 2, cooldown }) -> boolean, SYNCHRONOUS: true = played (or deliberately muted/inaudible),
//        false = nothing could be played (unknown name, still decoding, no audio context) -> then fall back:  A?.sfx('goblin-grunt', { at }) || snd.noise({ ... , at })
//        at = positional (3D panner, distance fall-off), omit = flat. Random variant (never the same twice) + pitch jitter, per-name cooldown + group limits (30 hits in one
//        frame do not pile up), global voice cap with priority (ui/omni > player > booms > impacts > ambient). Never throws.
//   BESPOKE SOUND  A.sfx('a crystal bell ringing underwater', { at })  — a SENTENCE (contains a space) that is not a pack name is generated once by the local model (3-10 s,
//        then cached on disk for good): a soft kit.sound stand-in plays now, the real file from the next call on. An identifier-like unknown name (no space, e.g. a typo) NEVER
//        triggers generation unless you pass { generate: true } (dashes become spaces); { generate: false } never generates. seconds 0.5-30. Every creation can voice itself.
//   A.has(name)  A.list()  A.preload([names]) -> Promise   A.generate(prompt, { kind: 'sfx'|'music', seconds, loop }) -> Promise<url | null>   A.stats()
//   MUSIC  A.music('battle' | 'slow ominous cave theme') mood name, or a prompt (generated + cached, then crossfaded in)   A.setMood(name | null) pins a mood (null = director back on)
//        A.stopMusic()  A.mood  A.moods  A.stinger('music-victory')  event 'music:changed' { mood, previous, name, url, source }  moods: calm wonder village tavern tension battle boss
//        night sacred dungeon. With nobody asking, a director picks the mood from game state (enemies near -> tension, fighting -> battle, boss-named fighter -> boss, last enemy
//        dead -> victory sting, player:died -> defeat sting, night, gazing at the Omnissiah -> sacred, village/tavern/dungeon zone, new creation -> wonder), hysteresis, >= 2 s fades.
//   A.bed('amb-forest' | null, { fade }) loops an ambience bed (core/ambience.js picks one from what is around the player)   A.enabled  A.musicVolume .6  A.sfxVolume 1  A.ambienceVolume .8
//   DOUBLING  kit.sound / combat.js still synthesise some of these moments; A.replaces is a Set of those procedural kinds ('slash','blunt','burst','break:wood','combat:hit', ...).
// PACK NAMES  (name = one-shot unless noted)
//   swing-{light,medium,heavy} thrust boomerang-whirl weapon-{throw,grab,drop} ground-slam clang shield-{block,bash} hit-generic  slash-{flesh,armor,wood,stone}
//   blunt-{flesh,armor,wood,stone} pierce-{flesh,armor,wood,stone} bow-draw arrow-{loose,hit-flesh,hit-ground} crossbow-{shot,reload} blaster-{shot,heavy} plasma-shot shotgun-blast
//   rifle-crack pistol-shot gunshot-small sniper-shot rocket-launch bullet-impact grenade-{pin,beep} smoke-pop  limb-sever gore-squelch bone-crack body-fall armor-fall blood-splat
//   player-{hurt,death} heartbeat humanoid-{grunt,hurt,death} goblin-{cackle,grunt,death} orc-{roar,grunt,death} troll-{bellow,grunt} skeleton-{rattle,collapse} zombie-{groan,death}
//   demon-{growl,death} dragon-{roar,wings,fire-breath} wolf-{growl,howl,yelp} bear-roar spider-skitter slime-{squish,splat} ghost-wail wraith-whisper imp-cackle bat-screech
//   robot-{beep,death} golem-rumble elemental-roar monster-bite villager-murmur crowd-cheer child-giggle cow-moo sheep-baa pig-oink chicken-cluck horse-whinny cat-meow dog-bark
//   crow-caw fox-yip owl-hoot bird-chirp frog-croak deer-snort  fire-{whoosh,cast,burst} ice-{cast,crack} lightning-zap chain-lightning thunder-crack heal-chime teleport shield-hum
//   meteor-fall gravity-rumble summon force-push earth-wall levitate conjure-orb magic-{cast,impact} arcane-bolt necro-bolt  break-{wood,stone,glass,metal,crystal,ice,earth,cloth}
//   building-collapse tree-{creak,fall} debris-thud door-creak chest-open chain-rattle explosion-{small,large,distant}  ui-{open,close,tick,select,error} quest-{start,complete}
//   level-up pickup pickup-coin spell-select  step-{grass,stone,wood,water,dirt} land-thud  omni-{awaken,create,approve,displeased,listen}   (UI names are flat, very short, quiet)
//   loops (bed or hold): flame-loop heal-loop telekinesis-hum omni-think amb-{night-field,forest,village,tavern,dungeon,graveyard,battlefield,storm,campfire,lake,wind,rain}
//   music: music-{calm,wonder,village,tavern,tension,battle,boss,night,sacred,dungeon} loops, music-{victory,defeat} stingers.

export const meta = { name: 'Audio', description: 'Sound pack, positional sfx, adaptive music director, generated sounds (MOSS-SoundEffect + ACE-Step).' };

const PACK_URL = '/assets/generated/audio/pack.json';
const GEN_DIR = '/assets/generated/audio/';
const STORE_KEY = 'omnissiah.audio';
const MOODS = {
  calm: 'music-calm', wonder: 'music-wonder', village: 'music-village', tavern: 'music-tavern', tension: 'music-tension',
  battle: 'music-battle', boss: 'music-boss', night: 'music-night', sacred: 'music-sacred', dungeon: 'music-dungeon',
};
const MOOD_ALIASES = {
  exploration: 'calm', peaceful: 'calm', idle: 'calm', ambient: 'calm', serene: 'calm', bright: 'wonder', luminous: 'wonder', magic: 'wonder',
  town: 'village', folk: 'village', danger: 'tension', suspense: 'tension', fight: 'battle', combat: 'battle', war: 'battle', bossfight: 'boss',
  dark: 'dungeon', cave: 'dungeon', moon: 'night', temple: 'sacred', holy: 'sacred', omnissiah: 'sacred', divine: 'sacred',
};
// weapon type -> sound classes
const W_SLASH = new Set(['sword', 'greatsword', 'katana', 'axe', 'great-axe', 'scythe', 'bone-blade', 'bone-axe', 'omni-blade', 'void-scythe', 'omni-shard']);
const W_PIERCE = new Set(['dagger', 'spear', 'pickaxe', 'war-pick', 'hoe', 'sun-spear', 'rune-dagger']);
const W_HEAVY = new Set(['greatsword', 'great-axe', 'warhammer', 'storm-hammer', 'mace', 'void-scythe', 'omni-blade', 'scythe', 'shovel', 'tower-shield']);
const W_LIGHT = new Set(['dagger', 'rune-dagger', 'katana', 'bone-blade', 'hoe', 'torch']);
const W_FIRE = {
  bow: 'arrow-loose', 'star-bow': 'arrow-loose', crossbow: 'crossbow-shot', 'heavy-crossbow': 'crossbow-shot', blaster: 'blaster-shot',
  'arc-blaster': 'blaster-heavy', 'plasma-rifle': 'plasma-shot', shotgun: 'shotgun-blast', rifle: 'rifle-crack', 'prism-rifle': 'rifle-crack',
  revolver: 'pistol-shot', smg: 'gunshot-small', sniper: 'sniper-shot', 'rocket-launcher': 'rocket-launch', 'magic-staff': 'arcane-bolt',
  wand: 'arcane-bolt', spellbook: 'arcane-bolt', 'ember-staff': 'fire-cast', 'bone-staff': 'necro-bolt',
};
const SPELL_SND = {
  firebolt: 'fire-whoosh', 'frost-lance': 'ice-cast', 'chain-lightning': 'chain-lightning', 'force-push': 'force-push', blink: 'teleport',
  heal: 'heal-chime', 'arcane-shield': 'shield-hum', 'earth-wall': 'earth-wall', 'fire-stream': 'fire-cast', 'conjure-orb': 'conjure-orb',
  levitate: 'levitate', 'gravity-well': 'gravity-rumble', meteor: 'meteor-fall', 'summon-familiar': 'summon', telekinesis: 'conjure-orb',
};
const SPELL_LOOP = { 'fire-stream': 'flame-loop', heal: 'heal-loop', telekinesis: 'telekinesis-hum' }; // hold spells: cast() fires every frame
const KIND_SND = { frost: 'ice-crack', shock: 'lightning-zap', magic: 'magic-impact', fire: 'fire-burst' };
const BREAK_SND = { wood: 'break-wood', stone: 'break-stone', glass: 'break-glass', metal: 'break-metal', crystal: 'break-crystal', ice: 'break-ice', earth: 'break-earth', cloth: 'break-cloth' };
// creature classes from a name: [regex, class]
const CREATURES = [
  [/lich|necromancer|skeleton|bone-walker|bone|skull/, 'skeleton'], [/goblin|gremlin/, 'goblin'], [/imp\b|imp-/, 'imp'], [/demon|devil|fiend/, 'demon'],
  [/orc/, 'orc'], [/troll|ogre|giant/, 'troll'], [/zombie|ghoul|mummy|undead/, 'zombie'], [/dragon|wyvern|drake/, 'dragon'], [/wolf/, 'wolf'],
  [/bear/, 'bear'], [/spider|scorpion/, 'spider'], [/slime|blob/, 'slime'], [/ghost|wraith|spirit|phantom|banshee/, 'ghost'], [/bat/, 'bat'],
  [/robot|drone|android|mech/, 'robot'], [/golem/, 'golem'], [/elemental/, 'elemental'], [/mimic/, 'mimic'], [/alien/, 'robot'],
  [/cow/, 'cow'], [/sheep/, 'sheep'], [/pig/, 'pig'], [/chicken|chick/, 'chicken'], [/horse/, 'horse'], [/cat\b|kitten/, 'cat'], [/dog|hound/, 'dog'],
  [/crow|raven/, 'crow'], [/fox/, 'fox'], [/deer|stag/, 'deer'], [/child|kid/, 'child'],
  [/knight|bandit|pirate|cultist|villager|farmer|merchant|blacksmith|bard|wizard|king|archer|mage|healer|paladin|ranger|guard|militia|man\b|human/, 'humanoid'],
];
const VOICES = {
  goblin: { death: 'goblin-death', attack: 'goblin-grunt', idle: 'goblin-cackle' }, imp: { death: 'imp-cackle', attack: 'imp-cackle', idle: 'imp-cackle' },
  orc: { death: 'orc-death', attack: 'orc-roar', idle: 'orc-grunt' }, troll: { death: 'troll-grunt', attack: 'troll-grunt', idle: 'troll-bellow' },
  skeleton: { death: 'skeleton-collapse', attack: 'skeleton-rattle', idle: 'skeleton-rattle' }, zombie: { death: 'zombie-death', attack: 'zombie-groan', idle: 'zombie-groan' },
  demon: { death: 'demon-death', attack: 'demon-growl', idle: 'demon-growl' }, dragon: { death: 'dragon-roar', attack: 'dragon-roar', idle: 'dragon-wings' },
  wolf: { death: 'wolf-yelp', attack: 'wolf-growl', idle: 'wolf-howl' }, bear: { death: 'bear-roar', attack: 'bear-roar', idle: 'bear-roar' },
  spider: { death: 'slime-splat', attack: 'spider-skitter', idle: 'spider-skitter' }, slime: { death: 'slime-splat', attack: 'slime-squish', idle: 'slime-squish' },
  ghost: { death: 'ghost-wail', attack: 'wraith-whisper', idle: 'ghost-wail' }, bat: { death: 'bat-screech', attack: 'bat-screech', idle: 'bat-screech' },
  robot: { death: 'robot-death', attack: 'robot-beep', idle: 'robot-beep' }, golem: { death: 'break-stone', attack: 'golem-rumble', idle: 'golem-rumble' },
  elemental: { death: 'fire-burst', attack: 'elemental-roar', idle: 'elemental-roar' }, mimic: { death: 'break-wood', attack: 'monster-bite', idle: null },
  humanoid: { death: 'humanoid-death', attack: 'humanoid-grunt', idle: null, hurt: 'humanoid-hurt' }, child: { death: 'child-giggle', attack: 'child-giggle', idle: 'child-giggle' },
  cow: { death: 'cow-moo', attack: 'cow-moo', idle: 'cow-moo' }, sheep: { death: 'sheep-baa', attack: 'sheep-baa', idle: 'sheep-baa' }, pig: { death: 'pig-oink', attack: 'pig-oink', idle: 'pig-oink' },
  chicken: { death: 'chicken-cluck', attack: 'chicken-cluck', idle: 'chicken-cluck' }, horse: { death: 'horse-whinny', attack: 'horse-whinny', idle: 'horse-whinny' },
  cat: { death: 'cat-meow', attack: 'cat-meow', idle: 'cat-meow' }, dog: { death: 'wolf-yelp', attack: 'dog-bark', idle: 'dog-bark' }, crow: { death: 'crow-caw', attack: 'crow-caw', idle: 'crow-caw' },
  fox: { death: 'fox-yip', attack: 'fox-yip', idle: 'fox-yip' }, deer: { death: 'deer-snort', attack: 'deer-snort', idle: 'deer-snort' },
};
const BEDS_BY_ZONE = { field: 'amb-wind', night: 'amb-night-field', forest: 'amb-forest', village: 'amb-village', tavern: 'amb-tavern', dungeon: 'amb-dungeon', graveyard: 'amb-graveyard', battlefield: 'amb-battlefield', storm: 'amb-storm', rain: 'amb-rain', campfire: 'amb-campfire', lake: 'amb-lake' };
// the first sounds to decode: UI + the commonest combat sounds + steps (the rest streams in by need, or in the background on the 'pc' tier)
const CORE = ['ui-tick', 'ui-open', 'ui-close', 'ui-select', 'ui-error', 'pickup', 'quest-start', 'quest-complete', 'level-up', 'swing-light', 'swing-medium', 'swing-heavy',
  'slash-flesh', 'slash-armor', 'slash-wood', 'slash-stone', 'blunt-flesh', 'blunt-armor', 'blunt-wood', 'blunt-stone', 'pierce-flesh', 'pierce-wood', 'hit-generic', 'shield-block', 'clang',
  'limb-sever', 'gore-squelch', 'bone-crack', 'body-fall', 'player-hurt', 'step-grass', 'step-water', 'weapon-grab', 'arrow-loose', 'blaster-shot', 'explosion-small', 'explosion-large',
  'break-wood', 'break-stone', 'fire-whoosh', 'magic-cast', 'magic-impact', 'goblin-death', 'humanoid-death', 'skeleton-collapse', 'music-victory', 'music-defeat'];
const GROUP_RULES = [
  [/^(ui-|quest-|level-up|pickup|spell-select)/, 'ui', 5, 0.1], [/^omni-/, 'omni', 5, 0.8], [/^(player-|heartbeat)/, 'player', 4, 0.25],
  [/^(explosion|building-collapse|tree-fall|meteor|thunder|dragon-roar|troll-bellow|ground-slam)/, 'boom', 3, 0.15],
  [/^(slash-|blunt-|pierce-|hit-|bone-crack|gore-|limb-|body-fall|armor-fall|blood-|arrow-hit|bullet-|shield-|clang)/, 'impact', 2, 0.04],
  [/^(break-|debris|tree-creak)/, 'break', 2, 0.05], [/^(swing-|thrust|weapon-)/, 'swing', 2, 0.12],
  [/^(step-|land-)/, 'step', 1, 0.15],
];
const GROUP_LIMIT = { impact: [6, 0.2], break: [5, 0.25], swing: [4, 0.2], step: [3, 0.3], boom: [3, 0.3] }; // [max per window, window seconds]

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const norm = (p) => String(p).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const rnd = (a, b) => a + Math.random() * (b - a);

export default function (ctx) {
  const ac = ctx.audio && ctx.audio.context;
  if (!ac) return {};
  const S = ctx.state;
  const W = ctx.world;
  const events = ctx.events;
  const tier = ctx.quality && ctx.quality.tier === 'quest' ? 'quest' : 'pc';
  const BUDGET = (tier === 'quest' ? 40 : 160) * 1024 * 1024;
  const MAX_VOICES = tier === 'quest' ? 14 : 24;
  let disposed = false;

  // ------------------------------------------------------------------ settings (persisted)
  const cfg = (S.cfg ??= (() => {
    let j = {};
    try { j = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { /* no storage */ }
    return { enabled: j.enabled !== false, musicVolume: num(j.musicVolume, 0.6), sfxVolume: num(j.sfxVolume, 1), ambienceVolume: num(j.ambienceVolume, 0.8) };
  })());
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  // ------------------------------------------------------------------ graph: sources -> buses -> compressor -> destination
  const mk = (v = 1) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const out = ac.createDynamicsCompressor();
  out.threshold.value = -9; out.knee.value = 12; out.ratio.value = 5; out.attack.value = 0.004; out.release.value = 0.2;
  const master = mk(cfg.enabled ? 1 : 0);
  master.connect(out); out.connect(ac.destination);
  const sfxBus = mk(cfg.sfxVolume); sfxBus.connect(master);
  const musicBus = mk(0); musicBus.connect(master);       // musicVolume x duck
  const musicDuck = mk(1); musicDuck.connect(musicBus);   // stingers pull the loop down
  const bedBus = mk(0); bedBus.connect(master);           // ambience beds
  const nodes = [out, master, sfxBus, musicBus, musicDuck, bedBus];
  let duck = 1; // 0.5 while the Omnissiah speaks / listens

  // ------------------------------------------------------------------ decoded buffer cache (LRU by bytes)
  const cache = (S.buffers ??= new Map()); // url -> { buf, bytes }   (insertion order = recency)
  const pinned = new Set();
  const loading = new Map();
  const failed = new Map(); // url -> retry-after (game seconds)
  const bytesOf = (b) => b.length * b.numberOfChannels * 4;
  let cacheBytes = 0;
  for (const e of cache.values()) cacheBytes += e.bytes;
  function evict() {
    while (cacheBytes > BUDGET) {
      let hit = false;
      for (const [u, e] of cache) {
        if (pinned.has(u)) continue;
        cache.delete(u); cacheBytes -= e.bytes; hit = true; break;
      }
      if (!hit) break;
    }
  }
  function cacheGet(url) {
    const e = cache.get(url);
    if (!e) return null;
    cache.delete(url); cache.set(url, e); // touch
    return e.buf;
  }
  function load(url) {
    const have = cacheGet(url);
    if (have) return Promise.resolve(have);
    const retry = failed.get(url);
    if (retry && now() < retry) return Promise.resolve(null);
    let p = loading.get(url);
    if (p) return p;
    p = fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => ac.decodeAudioData(ab))
      .then((buf) => { if (disposed) return buf; const bytes = bytesOf(buf); cache.set(url, { buf, bytes }); cacheBytes += bytes; evict(); return buf; })
      .catch((err) => { failed.set(url, now() + 30); console.warn('[audio] could not load', url, err && err.message); return null; })
      .finally(() => loading.delete(url));
    loading.set(url, p);
    return p;
  }
  function now() { return ctx.clock ? ctx.clock.t : 0; }

  // ------------------------------------------------------------------ pack manifest + generated index
  const pack = new Map(); // name -> { urls[], vol, kind, bpm, last }
  let packReady = false;
  const gen = { sfx: new Map(), music: new Map() }; // normPrompt|seconds|loop -> url
  const genKey = (prompt, seconds, loop) => `${norm(prompt)}|${seconds}|${loop ? 'loop' : ''}`;
  async function loadManifests() {
    try {
      const r = await fetch(PACK_URL, { cache: 'no-cache' });
      if (r.ok) {
        const j = await r.json();
        for (const [name, e] of Object.entries(j)) {
          const urls = Array.isArray(e.variants) && e.variants.length ? e.variants : e.url ? [e.url] : [];
          if (urls.length) pack.set(name, { urls, vol: num(e.volume, 0.7), kind: e.kind || 'oneshot', bpm: e.bpm, durations: e.durations, last: -1 });
        }
      }
    } catch (err) { console.warn('[audio] no sound pack manifest', err && err.message); }
    packReady = true;
    if (!disposed) { events.emit('audio:ready', { names: pack.size }); preloadCore(); }
  }
  // The index of what the audio server generated earlier (prompt -> file) is only needed when something is asked for by PROMPT rather than by
  // a pack name, so it is fetched the first time that happens, not on every load. A missing index (nothing generated yet) is simply empty.
  const genIdx = { sfx: null, music: null };         // null = not asked, a Promise while loading, true once read
  function loadGenIndex(kind) {
    if (genIdx[kind]) return genIdx[kind] === true ? Promise.resolve() : genIdx[kind];
    return (genIdx[kind] = fetch(`${GEN_DIR}${kind}/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) for (const e of Object.values(j)) if (e && e.prompt && e.url) gen[kind].set(genKey(e.prompt, e.seconds, e.loop), e.url); })
      .catch(() => { /* nothing generated yet */ })
      .then(() => { genIdx[kind] = true; }));
  }
  let preloadQueue = [];
  let preloading = 0;
  function pump() {
    while (preloading < 3 && preloadQueue.length && !disposed) {
      const url = preloadQueue.shift();
      if (cache.has(url)) continue;
      preloading++;
      load(url).finally(() => { preloading--; pump(); });
    }
  }
  function preload(names) {
    const urls = [];
    for (const n of [].concat(names || [])) { const e = pack.get(n); if (e) for (const u of e.urls) urls.push(u); }
    return Promise.all(urls.map((u) => load(u))).then(() => true);
  }
  function preloadCore() {
    for (const n of CORE) { const e = pack.get(n); if (e) preloadQueue.push(...e.urls); }
    if (tier === 'pc') for (const [n, e] of pack) if (e.kind === 'oneshot' && !CORE.includes(n)) preloadQueue.push(...e.urls);
    pump();
  }

  // ------------------------------------------------------------------ voices: pooled gain / panner nodes, global cap with priority
  const voices = [];
  const gains = [];
  const panners = [];
  const head = ctx.player.head;
  function makePanner() {
    const p = ac.createPanner();
    p.panningModel = tier === 'pc' ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.2; p.maxDistance = 200;
    return p;
  }
  function placePanner(p, at) {
    if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; } else p.setPosition(at.x, at.y, at.z);
  }
  function stopVoice(v, fade = 0.03) {
    if (v.dead) return;
    try {
      if (fade > 0) { v.gain.gain.cancelScheduledValues(ac.currentTime); v.gain.gain.setTargetAtTime(0, ac.currentTime, fade / 3); v.src.stop(ac.currentTime + fade + 0.02); } else v.src.stop();
    } catch (e) { /* already stopped */ }
  }
  function release(v) {
    if (v.dead) return;
    v.dead = true;
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    try { v.src.disconnect(); v.gain.disconnect(); v.panner && v.panner.disconnect(); } catch (e) { /* ignore */ }
    if (gains.length < 24) gains.push(v.gain);
    if (v.panner && panners.length < 24) panners.push(v.panner);
    if (v.onend) { try { v.onend(); } catch (e) { /* ignore */ } }
  }
  function playBuffer(buf, o) {
    if (ac.state !== 'running') { if (ac.state === 'suspended') ac.resume().catch(() => {}); return null; }
    if (voices.length >= MAX_VOICES) { // steal the quietest-priority / oldest voice, but never from a more important sound
      let victim = null;
      for (const v of voices) if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
      if (!victim || victim.prio > o.prio || (victim.prio === o.prio && ac.currentTime - victim.t0 < 0.12)) return null;
      stopVoice(victim, 0.02); release(victim);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate || 1;
    if (o.loop) src.loop = true;
    const g = gains.pop() || ac.createGain();
    g.gain.cancelScheduledValues(0);
    g.gain.value = o.vol;
    let p = null;
    src.connect(g);
    if (o.at) { p = panners.pop() || makePanner(); placePanner(p, o.at); g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
    const v = { src, gain: g, panner: p, prio: o.prio || 1, t0: ac.currentTime, name: o.name, dead: false, onend: o.onend };
    src.onended = () => release(v);
    voices.push(v);
    src.start();
    return v;
  }

  // ------------------------------------------------------------------ sfx()
  const lastPlay = new Map(); // name -> game time
  const groupWin = {};
  const info = new Map();
  function groupOf(name) {
    let i = info.get(name);
    if (!i) {
      i = { group: 'other', prio: 1, cd: 0.06 };
      for (const [re, g, p, cd] of GROUP_RULES) if (re.test(name)) { i = { group: g, prio: p, cd }; break; }
      info.set(name, i);
    }
    return i;
  }
  function pickVariant(e, o) { // random, never the same twice in a row, and only among variants that are already decoded
    const n = e.urls.length;
    if (typeof o.variant === 'number') return ((o.variant % n) + n) % n;
    let cnt = 0;
    for (let k = 0; k < n; k++) if (cache.has(e.urls[k])) cnt++;
    if (cnt === 0) return 0;
    let r = (Math.random() * cnt) | 0;
    for (let pass = 0; pass < 2; pass++) {
      let seen = 0;
      for (let k = 0; k < n; k++) {
        if (!cache.has(e.urls[k])) continue;
        if (seen++ === r) { if (k === e.last && cnt > 1) { r = (r + 1) % cnt; break; } e.last = k; return k; }
      }
    }
    return e.last >= 0 ? e.last : 0;
  }
  function distTo(at) { const dx = at.x - head.x, dy = at.y - head.y, dz = at.z - head.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  function playPack(name, e, o) {
    const gi = groupOf(name);
    const t = now();
    const cd = o.cooldown !== undefined ? o.cooldown : gi.cd;
    if (t - (lastPlay.get(name) ?? -1e9) < cd) return true; // swallowed on purpose (not a failure: do not fall back)
    const lim = GROUP_LIMIT[gi.group];
    if (lim) {
      const w = groupWin[gi.group] || (groupWin[gi.group] = { t0: -1e9, n: 0 });
      if (t - w.t0 > lim[1]) { w.t0 = t; w.n = 0; }
      if (++w.n > lim[0]) return true;
    }
    const vol = (o.volume ?? 1) * e.vol;
    if (o.at) { const d = distTo(o.at); if (d > 55 + 90 * Math.min(1, vol)) return true; } // inaudible
    const i = pickVariant(e, o);
    const url = e.urls[i];
    const buf = cacheGet(url);
    if (!buf) { for (let k = 0; k < e.urls.length; k++) load(e.urls[k]); return false; } // not decoded yet: caller may fall back to kit.sound; the next call will have it
    const jitter = o.pitchJitter ?? (gi.group === 'ui' || gi.group === 'omni' ? 0 : 0.06);
    const rate = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const v = playBuffer(buf, { at: o.at, vol, rate, prio: o.priority ?? gi.prio, name });
    if (!v) return false;
    lastPlay.set(name, t);
    return true;
  }
  let stand = null;
  function standIn(prompt, o) {
    const K = W.kit;
    if (!K || !K.sound) return;
    try {
      stand ??= K.sound(ctx, { volume: 0.5 });
      const at = o.at, vol = o.volume ?? 1, p = norm(prompt);
      if (/explo|boom|crash|thunder|rumbl|collaps|roar/.test(p)) stand.noise({ dur: 0.5, filter: { type: 'lowpass', freq: 600, freqEnd: 120 }, vol: 0.3 * vol, at });
      else if (/chime|bell|magic|crystal|sparkl|shimmer|harp|glow/.test(p)) stand.chord([880, 1320], { dur: 0.6, type: 'sine', vol: 0.14 * vol, stagger: 0.05, at });
      else stand.noise({ dur: 0.22, filter: { type: 'bandpass', freq: 1400, freqEnd: 500, q: 0.9 }, vol: 0.14 * vol, at });
    } catch (e) { /* stand-ins are best effort */ }
  }
  const pendingGen = new Map(); // id -> { kind, key, prompt, music }
  const genBackoff = new Map(); // key -> game time before which we do not ask again
  const genAsked = new Set();
  let genSeq = 0;
  function requestGen(kind, prompt, seconds, loop) {
    const key = `${kind}|${genKey(prompt, seconds, loop)}`;
    if (genAsked.has(key)) return false;
    if ((genBackoff.get(key) ?? 0) > now()) return false;
    if (pendingGen.size >= 6) return false;
    const id = `a${++genSeq}-${(Date.now() % 1e6) | 0}`;
    if (!ctx.net || !ctx.net.send({ type: kind, id, prompt, seconds, loop: !!loop })) { genBackoff.set(key, now() + 20); return false; }
    genAsked.add(key);
    pendingGen.set(id, { kind, key, prompt, seconds, loop: !!loop });
    return true;
  }
  ctx.on('net:audio_status', (m) => {
    const p = pendingGen.get(m.id);
    if (!p) return;
    if (m.state === 'done' && m.url) {
      pendingGen.delete(m.id);
      gen[p.kind].set(genKey(p.prompt, p.seconds, p.loop), m.url);
      load(m.url);
      if (p.music && music.pending === m.id) {
        music.pending = null;
        // the real loop length is in the server's index (bar-aligned, a little shorter than asked): the wrap needs it because streamed Ogg often reports Infinity
        const slug = m.url.replace(/^.*\//, '').replace(/\.ogg$/, '');
        fetch(GEN_DIR + 'music/index.json', { cache: 'no-cache' }).then((r) => r.json()).then((j) => (j && j[slug] && j[slug].duration) || p.seconds, () => p.seconds).then((d) => { if (!disposed) playCustom(m.url, p.prompt, d); });
      }
      events.emit('audio:generated', { kind: p.kind, prompt: p.prompt, url: m.url });
    } else if (m.state === 'error') {
      pendingGen.delete(m.id); genAsked.delete(p.key);
      genBackoff.set(p.key, now() + 60);
      if (p.music && music.pending === m.id) music.pending = null;
    }
  });

  function sfx(nameOrPrompt, o = {}) {
    if (disposed || nameOrPrompt === undefined || nameOrPrompt === null || nameOrPrompt === '') return false;
    if (!cfg.enabled) return true; // muted on purpose: callers must not fall back to kit.sound either
    const key = String(nameOrPrompt).trim();
    const e = pack.get(key);
    if (e) return playPack(key, e, o);
    // not a pack name: a prompt. Short identifier-like names (no space) never generate unless asked explicitly.
    const sentence = /\s/.test(key);
    const secs = Math.round(Math.min(30, Math.max(0.5, num(o.seconds, 2))) * 10) / 10;
    const prompt = sentence ? key : key.replace(/[-_]+/g, ' ');
    if (genIdx.sfx !== true && (o.generate === true || (o.generate !== false && sentence))) { // first prompt-based request: read what was generated before
      loadGenIndex('sfx').then(() => { if (!disposed) sfx(nameOrPrompt, o); });
      return true;
    }
    const url = gen.sfx.get(genKey(prompt, secs, false));
    if (url) {
      const buf = cacheGet(url);
      if (!buf) { load(url); return false; }
      if (o.at && distTo(o.at) > 110) return true;
      const v = playBuffer(buf, { at: o.at, vol: (o.volume ?? 1) * 0.8, rate: (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * 0.04), prio: o.priority ?? 2, name: key });
      return !!v;
    }
    const want = o.generate === true || (o.generate !== false && sentence);
    if (!want) return false;
    requestGen('sfx', prompt, secs, false);
    standIn(prompt, o);
    return true;
  }

  // ------------------------------------------------------------------ looping voices (flame stream, hum): kept alive by repeated triggers
  const loops = new Map(); // name -> { voice, until }
  function holdLoop(name, at, volume = 1) {
    const e = pack.get(name);
    if (!e || !cfg.enabled) return false;
    const t = now();
    const L = loops.get(name);
    if (L && !L.voice.dead) { L.until = t + 0.25; if (at && L.voice.panner) placePanner(L.voice.panner, at); return true; }
    const buf = cacheGet(e.urls[0]);
    if (!buf) { load(e.urls[0]); return false; }
    const v = playBuffer(buf, { at, vol: 0.0001, rate: 1, prio: 2, loop: true, name });
    if (!v) return false;
    v.gain.gain.setTargetAtTime(e.vol * volume, ac.currentTime, 0.08);
    loops.set(name, { voice: v, until: t + 0.25 });
    return true;
  }
  function updateLoops(t) {
    for (const [name, L] of loops) {
      if (L.voice.dead) { loops.delete(name); continue; }
      if (t > L.until) { stopVoice(L.voice, 0.3); loops.delete(name); }
    }
  }

  // ------------------------------------------------------------------ ambience beds (decoded loops, crossfaded)
  let bedCur = null;
  let wantBed = null;
  let zone = S.zone || 'field';
  function bedVol(name) { const e = pack.get(name); return e ? e.vol : 0.6; }
  function startBed(name, buf, fade) {
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(g); g.connect(bedBus);
    const url = pack.get(name).urls[0];
    pinned.add(url);
    const b = { name, src, gain: g, url, vol: bedVol(name) };
    g.gain.setTargetAtTime(b.vol * (wantBed ? wantBed.volume : 1), t, Math.max(0.2, fade) / 3);
    src.start(0, Math.random() * buf.duration);
    const old = bedCur;
    bedCur = b;
    if (old) retireBed(old, fade);
    evict();
  }
  function retireBed(b, fade) {
    const t = ac.currentTime;
    b.src.onended = () => { try { b.src.disconnect(); b.gain.disconnect(); } catch (e) { /* ignore */ } if (!(bedCur && bedCur.url === b.url)) pinned.delete(b.url); evict(); };
    try { b.gain.gain.cancelScheduledValues(t); b.gain.gain.setTargetAtTime(0, t, Math.max(0.2, fade) / 3); b.src.stop(t + fade + 0.5); } catch (e) { /* stopped */ }
  }  function bed(name, o = {}) {
    if (disposed) return false;
    const fade = o.fade ?? 4;
    if (!name) { wantBed = null; if (bedCur) { retireBed(bedCur, fade); bedCur = null; } return true; }
    const e = pack.get(name);
    if (!e || e.kind !== 'loop') return false;
    wantBed = { name, fade, volume: o.volume ?? 1 };
    if (bedCur && bedCur.name === name) { bedCur.gain.gain.setTargetAtTime(bedCur.vol * wantBed.volume, ac.currentTime, 0.3); return true; }
    const url = e.urls[0];
    pinned.add(url); // before the decode finishes, or the LRU could evict the bed it was just asked to load
    const buf = cacheGet(url);
    if (buf) startBed(name, buf, fade);
    else load(url).then((b) => {
      if (b && !disposed && wantBed && wantBed.name === name && !(bedCur && bedCur.name === name)) startBed(name, b, wantBed.fade);
      else if (!(bedCur && bedCur.url === url)) pinned.delete(url);
    });
    return true;
  }

  // ------------------------------------------------------------------ music: streamed through media elements, equal-power crossfades
  const XF_LOOP = 1.5;
  const CURVE_N = 48;
  const fadeIn = new Float32Array(CURVE_N), fadeOut = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) { const x = (i / (CURVE_N - 1)) * Math.PI / 2; fadeIn[i] = Math.sin(x); fadeOut[i] = Math.cos(x); }
  const mediaOk = typeof Audio !== 'undefined';
  const slotsStore = (S.slots ??= []); // media elements + their source nodes survive hot reloads (a node can be created only once per element)
  function slot(i) {
    let s = slotsStore[i];
    if (!s) {
      const el = new Audio();
      el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.loop = false;
      s = slotsStore[i] = { el, src: ac.createMediaElementSource(el) };
    }
    try { s.src.disconnect(); } catch (e) { /* not connected */ }
    return s;
  }
  const tracks = [];
  if (mediaOk) {
    for (let k = 0; k < 2; k++) {
      const trk = mk(0); trk.connect(musicDuck); nodes.push(trk);
      const sl = [slot(k * 2), slot(k * 2 + 1)].map((s) => { const g = mk(0); s.src.connect(g); g.connect(trk); nodes.push(g); return { el: s.el, g }; });
      tracks.push({ trk, sl, active: 0, wrapUntil: 0, url: null, name: null, vol: 1, state: 'idle', mood: null });
    }
  }
  const music = { cur: null, mood: S.mood || null, source: 'director', override: S.override || null, pending: null, blocked: false, stingerUntil: 0 };
  function curve(param, curveArr, t, dur, scale) {
    try {
      if (scale === 1) param.setValueCurveAtTime(curveArr, t, dur);
      else { const c = new Float32Array(curveArr.length); for (let i = 0; i < c.length; i++) c[i] = curveArr[i] * scale; param.setValueCurveAtTime(c, t, dur); }
    } catch (e) { param.value = curveArr[curveArr.length - 1] * scale; }
  }
  function playEl(tr, which) {
    const s = tr.sl[which];
    const p = s.el.play();
    if (p && p.catch) p.catch(() => { music.blocked = true; });
  }
  function startTrack(url, vol, name, fade, mood, dur) {
    if (!mediaOk) return false;
    const t = ac.currentTime;
    fade = Math.max(2, fade);
    const old = music.cur;
    const tr = tracks[0] === old ? tracks[1] : tracks[0];
    tr.active = 0; tr.wrapUntil = 0; tr.dur = dur || 0; tr.url = url; tr.name = name; tr.vol = vol; tr.state = 'playing'; tr.mood = mood;
    const a = tr.sl[0], b = tr.sl[1];
    for (const s of [a, b]) { s.g.gain.cancelScheduledValues(0); s.el.pause(); }
    a.el.src = url; a.el.currentTime = 0;
    b.g.gain.value = 0;
    a.g.gain.value = 1;
    tr.trk.gain.cancelScheduledValues(0);
    tr.trk.gain.value = 0;
    curve(tr.trk.gain, fadeIn, t, fade, vol);
    playEl(tr, 0);
    music.cur = tr;
    if (old) {
      old.state = 'fading';
      old.trk.gain.cancelScheduledValues(t);
      old.trk.gain.setValueAtTime(old.trk.gain.value, t);
      curve(old.trk.gain, fadeOut, t, fade, Math.max(old.trk.gain.value, 0.0001));
      old.killAt = t + fade + 0.2;
    }
    return true;
  }
  function stopTrack(tr) {
    tr.state = 'idle'; tr.name = null; tr.mood = null;
    for (const s of tr.sl) { try { s.el.pause(); s.el.removeAttribute('src'); s.el.load && s.el.load(); } catch (e) { /* ignore */ } }
  }
  function updateMusic() {
    const t = ac.currentTime;
    for (const tr of tracks) {
      if (tr.state === 'fading' && t > tr.killAt) stopTrack(tr);
      if (tr.state !== 'playing') continue;
      const cur = tr.sl[tr.active], el = cur.el;
      if (tr.wrapUntil) { // second element took over: retire the first
        if (t >= tr.wrapUntil) { const o = tr.sl[1 - tr.active]; o.el.pause(); tr.wrapUntil = 0; }
        continue;
      }
      // Ogg streams without Range support often report duration = Infinity: trust the length the manifest / generator told us
      const d = el.duration > 4 && isFinite(el.duration) ? el.duration : tr.dur;
      if (!el.paused && ((d > 4 && d - el.currentTime < XF_LOOP + 0.1) || el.ended)) { // wrap the loop: the other element starts from 0 while this one fades out
        const nxt = tr.sl[1 - tr.active];
        if (nxt.el.getAttribute && nxt.el.getAttribute('src') !== tr.url) nxt.el.src = tr.url;
        nxt.el.currentTime = 0;
        nxt.g.gain.cancelScheduledValues(0);
        nxt.g.gain.value = 0;
        const dur = Math.max(0.3, Math.min(XF_LOOP, d > 0 ? d - el.currentTime : 0.3));
        curve(nxt.g.gain, fadeIn, t, dur, 1);
        curve(cur.g.gain, fadeOut, t, dur, 1);
        playEl(tr, 1 - tr.active);
        tr.active = 1 - tr.active;
        tr.wrapUntil = t + dur + 0.05;
      } else if (el.paused && cfg.enabled && music.blocked && ac.state === 'running') {
        music.blocked = false; playEl(tr, tr.active);
      }
    }
  }
  function applyMusicBus() {
    const t = ac.currentTime;
    musicBus.gain.setTargetAtTime(cfg.enabled ? cfg.musicVolume * duck : 0, t, 0.4);
    bedBus.gain.setTargetAtTime(cfg.enabled ? cfg.ambienceVolume * (duck < 1 ? 0.7 : 1) : 0, t, 0.5);
  }
  function moodOf(x) {
    const s = String(x || '').trim().toLowerCase().replace(/^music-/, '');
    if (MOODS[s]) return s;
    return MOOD_ALIASES[s] || null;
  }
  function setTrack(mood, source, fade) {
    const name = MOODS[mood];
    const e = pack.get(name);
    if (!e) return false;
    if (music.mood === mood && music.cur && music.cur.state === 'playing') return true;
    const prev = music.mood;
    if (!startTrack(e.urls[0], e.vol, name, fade ?? 3, mood, e.durations && e.durations[0])) return false;
    music.mood = mood; S.mood = mood; music.source = source; music.since = now();
    events.emit('music:changed', { mood, previous: prev, name, url: e.urls[0], source });
    return true;
  }
  function playCustom(url, prompt, secs) {
    const prev = music.mood;
    if (!startTrack(url, 0.7, prompt, 3, 'custom', secs)) return false;
    music.mood = 'custom'; music.source = 'manual'; music.since = now();
    events.emit('music:changed', { mood: 'custom', previous: prev, name: prompt, url, source: 'manual' });
    return true;
  }
  function stinger(name, o = {}) {
    const e = pack.get(name);
    if (!e || !cfg.enabled) return false;
    const buf = cacheGet(e.urls[0]);
    if (!buf) { load(e.urls[0]); return false; }
    if (ac.state !== 'running') return false;
    const t = ac.currentTime;
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf; g.gain.value = e.vol; src.connect(g); g.connect(musicBus);
    musicDuck.gain.cancelScheduledValues(t);
    musicDuck.gain.setTargetAtTime(o.duck ?? 0.15, t, 0.15);
    src.start();
    music.stingerUntil = now() + buf.duration;
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e2) { /* ignore */ } musicDuck.gain.setTargetAtTime(1, ac.currentTime + 0.3, 0.8); };
    events.emit('music:sting', { name });
    return true;
  }
  const api = {
    sfx, preload, load,
    has: (n) => pack.has(n) || gen.sfx.has(genKey(String(n).replace(/[-_]+/g, ' '), 2, false)),
    list: () => [...pack.keys()],
    bed, stinger,
    music(moodOrPrompt, o = {}) {
      if (!moodOrPrompt) { return api.stopMusic(); }
      const m = moodOf(moodOrPrompt);
      music.override = S.override = m ? { mood: m } : { prompt: String(moodOrPrompt) };
      if (m) return setTrack(m, 'manual', o.fade ?? 3) || true;
      const prompt = String(moodOrPrompt).trim();
      const secs = o.seconds ?? 60;
      if (genIdx.music !== true) { loadGenIndex('music').then(() => { if (!disposed && music.override?.prompt === String(moodOrPrompt)) api.music(moodOrPrompt, o); }); return true; }
      const url = gen.music.get(genKey(prompt, secs, true));
      if (url) return playCustom(url, prompt, secs);
      const id = `m${++genSeq}-${(Date.now() % 1e6) | 0}`;
      if (!ctx.net || !ctx.net.send({ type: 'music', id, prompt, seconds: secs, loop: true })) return false;
      pendingGen.set(id, { kind: 'music', key: `music|${genKey(prompt, secs, true)}`, prompt, seconds: secs, loop: true, music: true });
      music.pending = id;
      return true;
    },
    stopMusic(o = {}) {
      music.override = S.override = { silent: true };
      const t = ac.currentTime;
      if (music.cur) { const tr = music.cur; tr.state = 'fading'; tr.killAt = t + (o.fade ?? 2) + 0.2; tr.trk.gain.cancelScheduledValues(t); tr.trk.gain.setValueAtTime(tr.trk.gain.value, t); curve(tr.trk.gain, fadeOut, t, Math.max(0.5, o.fade ?? 2), Math.max(tr.trk.gain.value, 0.0001)); music.cur = null; }
      const prev = music.mood; music.mood = null; S.mood = null;
      if (prev) events.emit('music:changed', { mood: null, previous: prev, name: null, url: null, source: 'manual' });
      return true;
    },
    setMood(m) {
      if (m === null || m === undefined) { music.override = S.override = null; return true; }
      const mood = moodOf(m);
      if (!mood) return false;
      music.override = S.override = { mood };
      return setTrack(mood, 'manual', 3) || true;
    },
    get mood() { return music.mood; },
    get moods() { return Object.keys(MOODS); },
    get zone() { return zone; },
    setZone(z) { zone = z || 'field'; S.zone = zone; },
    generate(prompt, o = {}) { // -> Promise<url | null>
      const kind = o.kind === 'music' ? 'music' : 'sfx';
      const secs = o.seconds ?? (kind === 'music' ? 60 : 2);
      return loadGenIndex(kind).then(() => {
        const have = gen[kind].get(genKey(prompt, secs, o.loop ?? kind === 'music'));
        if (have) return have;
        return new Promise((res) => {
          const id = `g${++genSeq}-${(Date.now() % 1e6) | 0}`;
          if (!ctx.net || !ctx.net.send({ type: kind, id, prompt, seconds: secs, loop: !!(o.loop ?? kind === 'music') })) return res(null);
          const off = events.on('net:audio_status', (m) => { if (m.id !== id) return; if (m.state === 'done') { off(); gen[kind].set(genKey(prompt, secs, o.loop ?? kind === 'music'), m.url); res(m.url); } else if (m.state === 'error') { off(); res(null); } });
        });
      });
    },
    get enabled() { return cfg.enabled; },
    set enabled(v) { cfg.enabled = !!v; master.gain.setTargetAtTime(cfg.enabled ? 1 : 0, ac.currentTime, 0.05); applyMusicBus(); save(); events.emit('audio:settings', { ...cfg }); },
    get musicVolume() { return cfg.musicVolume; },
    set musicVolume(v) { cfg.musicVolume = Math.min(1.5, Math.max(0, num(+v, 0.6))); applyMusicBus(); save(); events.emit('audio:settings', { ...cfg }); },
    get sfxVolume() { return cfg.sfxVolume; },
    set sfxVolume(v) { cfg.sfxVolume = Math.min(1.5, Math.max(0, num(+v, 1))); sfxBus.gain.setTargetAtTime(cfg.sfxVolume, ac.currentTime, 0.05); save(); events.emit('audio:settings', { ...cfg }); },
    get ambienceVolume() { return cfg.ambienceVolume; },
    set ambienceVolume(v) { cfg.ambienceVolume = Math.min(1.5, Math.max(0, num(+v, 0.8))); applyMusicBus(); save(); events.emit('audio:settings', { ...cfg }); },
    // kit.sound / combat.js synthesise the same moments (see header): modules that own such a procedural sound may skip it when the name is here
    replaces: new Set(['slash', 'pierce', 'blunt', 'burst', 'fire', 'frost', 'shock', 'magic', 'thud', 'break:wood', 'break:stone', 'break:glass', 'break:metal', 'break:crystal', 'break:ice', 'break:earth', 'break:cloth', 'combat:swing', 'combat:hit', 'combat:impact', 'combat:death', 'combat:shot']),
    stats: () => ({ voices: voices.length, cachedBuffers: cache.size, cachedMB: +(cacheBytes / 1048576).toFixed(1), budgetMB: +(BUDGET / 1048576).toFixed(0), loading: loading.size, packNames: pack.size, ctxState: ac.state, mood: music.mood, bed: bedCur ? bedCur.name : null, zone }),
    _debug: { pack, cache, gen },
  };
  ctx.provide('audio', api);

  // ------------------------------------------------------------------ automatic sound: game events
  const P = (p) => (p && typeof p.x === 'number' ? p : null);
  const here = (p) => P(p) || head;
  function materialAt(point) {
    const K = W.kit;
    let d = null;
    try { d = K && K.nearestTarget ? K.nearestTarget(point, 1.8) : null; } catch (e) { d = null; }
    if (d) {
      const m = d.material || (d.handle && d.handle.material);
      if (m) return m === 'stone' || m === 'metal' || m === 'crystal' || m === 'ice' ? (m === 'metal' ? 'armor' : 'stone') : m === 'wood' ? 'wood' : 'wood';
      const gore = typeof d.gore === 'string' ? d.gore : d.gore && d.gore.gore;
      if (gore === 'sparks') return 'armor';
      if (gore === 'slime') return 'slime';
      if (gore === 'bones') return 'bones';
      return 'flesh';
    }
    const C = W.combat;
    if (C && C.nearest && C.nearest(point, { maxDist: 6 })) return 'flesh';
    return 'wood';
  }
  let lastBig = 0;
  ctx.on('kit:hit', (e) => {
    if (!e || !e.hits || !e.point) return;
    const p = e.point, kind = e.kind || 'blunt', vol = Math.min(1.2, 0.5 + (e.amount || 5) / 30);
    if (kind === 'explosion') {
      const t = now();
      if (t - lastBig < 0.1) return;
      lastBig = t;
      sfx((e.radius || 3) >= 4 ? 'explosion-large' : 'explosion-small', { at: p, volume: 1 });
      return;
    }
    if (KIND_SND[kind]) { sfx(KIND_SND[kind], { at: p, volume: vol }); return; }
    const mat = materialAt(p);
    if (mat === 'slime') { sfx('slime-squish', { at: p, volume: vol }); return; }
    if (mat === 'bones') { sfx('bone-crack', { at: p, volume: vol }); if (kind === 'blunt') sfx('blunt-flesh', { at: p, volume: vol * 0.7 }); return; }
    const k = kind === 'slash' || kind === 'pierce' || kind === 'blunt' ? kind : 'blunt';
    let name = `${k}-${mat}`;
    if (!pack.has(name)) name = pack.has(`${k}-flesh`) ? `${k}-flesh` : 'hit-generic';
    sfx(name, { at: p, volume: vol });
    if (mat === 'flesh' && e.amount > 14 && Math.random() < 0.5) sfx('gore-squelch', { at: p, volume: 0.6 });
  });
  const handPos = (h) => (ctx.input && ctx.input[h] ? ctx.input[h].position : head);
  ctx.on('weapon:fire', (e) => {
    if (!e) return;
    const n = W_FIRE[e.type];
    if (n) sfx(n, { at: handPos(e.hand), volume: 1 });
  });
  ctx.on('weapon:grab', (e) => {
    if (!e) return;
    sfx(e.type === 'grenade' || e.type === 'smoke-bomb' ? 'grenade-pin' : 'weapon-grab', { at: handPos(e.hand) });
  });
  ctx.on('combat:attack', (e) => {
    if (!e) return;
    const p = P(e.point) || head;
    if (e.blocked) { sfx('shield-block', { at: p }); return; }
    if (e.kind === 'melee' && e.attacker) {
      const f = e.attacker, ap = f.actor && f.actor.position ? f.actor.position : p;
      sfx('swing-medium', { at: ap, volume: 0.6 });
      voice(f, 'attack', 0.55, 1.4);
    }
  });
  ctx.on('combat:kill', (e) => {
    if (!e || !e.victim) return;
    const f = e.victim, ap = f.actor && f.actor.position ? f.actor.position : head;
    fightT = now();
    voice(f, 'death', 1, 0);
    const st = e.style;
    if (st === 'bisect' || st === 'decapitate') sfx('limb-sever', { at: ap, volume: 0.9 });
    else if (st === 'burst') { sfx('gore-squelch', { at: ap }); sfx('explosion-small', { at: ap, volume: 0.6 }); }
    else if (st === 'launch') setTimeout(() => sfx('body-fall', { at: ap }), 450);
    else if (st === 'shatter') sfx('break-ice', { at: ap });
    else if (st === 'char') sfx('fire-burst', { at: ap, volume: 0.5 });
    else if (st === 'disintegrate') sfx('magic-impact', { at: ap, volume: 0.7 });
    else setTimeout(() => sfx('body-fall', { at: ap, volume: 0.7 }), 300);
    const C = W.combat;
    if (C && C.count && C.count('enemy') === 0 && now() - fightStart > 4 && now() - lastVictory > 25 && (music.mood === 'battle' || music.mood === 'boss' || now() - fightT < 12)) {
      lastVictory = now();
      music.afterSting = now() + 6;
      stinger('music-victory');
      fightT = -1e9;
    }
  });
  ctx.on('limb:severed', (e) => {
    if (!e || !e.actor) return;
    const ap = e.actor.position || head;
    sfx('limb-sever', { at: ap, volume: 1 });
    if (e.actor.gore === 'bones') sfx('bone-crack', { at: ap });
  });
  ctx.on('kit:break', (e) => {
    if (!e) return;
    const p = P(e.point) || head;
    if ((e.pieces || 0) >= 40) { sfx('building-collapse', { at: p }); return; }
    sfx(BREAK_SND[e.material] || 'break-wood', { at: p, volume: Math.min(1.2, 0.6 + (e.pieces || 4) / 30) });
  });
  ctx.on('kit:fell', (e) => {
    const p = e && e.object && e.object.position ? e.object.position : head;
    sfx('tree-creak', { at: p });
    setTimeout(() => sfx('tree-fall', { at: p }), 900);
  });
  ctx.on('spell:cast', (e) => {
    if (!e) return;
    const loopName = SPELL_LOOP[e.id];
    if (loopName) {
      holdLoop(loopName, e.origin, 0.9);
      if (e.id === 'fire-stream' || e.id === 'heal') return;
    }
    sfx(SPELL_SND[e.id] || 'magic-cast', { at: P(e.origin) || head });
  });
  ctx.on('player:hurt', (e) => { fightT = now(); sfx('player-hurt', { volume: Math.min(1, 0.5 + ((e && e.amount) || 5) / 30) }); });
  ctx.on('player:died', () => {
    sfx('player-death');
    fightT = -1e9;
    if (now() - lastDefeat > 8) { lastDefeat = now(); stinger('music-defeat', { duck: 0.1 }); }
  });
  const questName = { 'quest:started': 'quest-start', 'quest:completed': 'quest-complete', 'player:levelup': 'level-up', 'quest:levelup': 'level-up', 'level:up': 'level-up' };
  for (const [ev, snd] of Object.entries(questName)) ctx.on(ev, () => sfx(snd));
  ctx.on('quest:progress', () => sfx('ui-select', { volume: 0.7 }));
  // the Omnissiah
  let greeted = !!S.greeted, synced = false, wonderUntil = 0, thinkOn = false;
  ctx.on('modules:synced', () => { synced = true; });
  ctx.on('module:loaded', (e) => {
    if (!synced || !e || !/^creations\//.test(e.path || '')) return;
    sfx('omni-create', { cooldown: 3 });
    wonderUntil = now() + 28;
  });
  ctx.on('net:speak', () => { if (!greeted) { greeted = S.greeted = true; sfx('omni-awaken'); } });
  ctx.on('oracle:state', (s) => {
    const loud = s === 'speaking' || s === 'listening';
    duck = loud ? 0.55 : 1;
    applyMusicBus();
    if (s === 'listening') sfx('omni-listen');
    const think = s === 'thinking' || s === 'coding';
    if (think && !thinkOn) { thinkOn = true; }
    else if (!think && thinkOn) { thinkOn = false; if (s === 'speaking' || s === 'idle') sfx('omni-approve', { volume: 0.6, cooldown: 4 }); }
  });
  ctx.on('net:notice', (m) => { if (m && m.level === 'error') sfx('omni-displeased', { volume: 0.5, cooldown: 10 }); });

  // creature voices
  const classOf = new WeakMap();
  function classFor(f) {
    let c = classOf.get(f);
    if (c !== undefined) return c;
    const a = f.actor;
    const bits = [f.name, a && a.mdl && a.mdl.name, a && a.group && a.group.parent && a.group.parent.name, a && a.group && a.group.name, a && a.name].filter((x) => typeof x === 'string').join(' ').toLowerCase();
    c = null;
    for (const [re, cls] of CREATURES) if (re.test(bits)) { c = cls; break; }
    classOf.set(f, c);
    return c;
  }
  const nextVoice = new WeakMap();
  function voice(f, what, chance, perFighterCooldown) {
    const cls = classFor(f);
    const set = cls && VOICES[cls];
    const name = set && set[what];
    if (!name || Math.random() > chance) return;
    const t = now();
    if (perFighterCooldown && t < (nextVoice.get(f) || 0)) return;
    if (perFighterCooldown) nextVoice.set(f, t + perFighterCooldown);
    const ap = f.actor && f.actor.position ? f.actor.position : head;
    sfx(name, { at: ap, cooldown: what === 'death' ? 0.1 : 0.35, volume: cls === 'dragon' || cls === 'troll' || cls === 'bear' ? 1 : 0.9 });
  }
  function idleVoices(t) {
    const C = W.combat;
    if (!C || !C.fighters) return;
    const list = C.fighters;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!f.alive || !f.actor || !f.actor.position) continue;
      const nv = nextVoice.get(f);
      if (nv === undefined) { nextVoice.set(f, t + rnd(1, 8)); continue; }
      if (t < nv) continue;
      const p = f.actor.position;
      const dx = p.x - head.x, dz = p.z - head.z;
      if (dx * dx + dz * dz > 28 * 28) { nextVoice.set(f, t + 2); continue; }
      nextVoice.set(f, t + (f.faction === 'enemy' ? rnd(5, 11) : rnd(9, 20)));
      voice(f, 'idle', 1, 0);
    }
  }

  // ------------------------------------------------------------------ per frame: footsteps, swings, heartbeat, director
  let px = 0, pz = 0, havePos = false, stepAcc = 0, stepLeft = false;
  let hx = [0, 0], hy = [0, 0], hz = [0, 0], haveHand = [false, false], swingT = [0, 0];
  let fightT = -1e9, fightStart = -1e9, lastVictory = -1e9, lastDefeat = -1e9, hbT = 0;
  let sense = 0, hold = { mood: null, since: 0 }, gazeT = 0, sacred = false, candidate = null, candSince = 0;
  const bossRe = /boss|lich|ancient|titan|overlord|warlord|archdemon|demon-lord/;
  const bossOf = new WeakMap();
  function isBoss(f) {
    let b = bossOf.get(f);
    if (b === undefined) {
      const a = f.actor, nm = `${f.name || ''} ${a && a.group && a.group.parent ? a.group.parent.name : ''}`.toLowerCase();
      b = bossRe.test(nm) || (f.maxHp || 0) >= 400;
      bossOf.set(f, b);
    }
    return b;
  }
  function footsteps(dt) {
    const f = ctx.player.feet;
    if (!havePos) { px = f.x; pz = f.z; havePos = true; return; }
    const dx = f.x - px, dz = f.z - pz;
    px = f.x; pz = f.z;
    const moved = Math.sqrt(dx * dx + dz * dz);
    if (moved > 2.5 || dt <= 0) { stepAcc = 0; return; } // teleport / blink
    const speed = moved / dt;
    const env = W.env;
    const gy = ctx.groundAt ? ctx.groundAt(f.x, f.z) : 0;
    if (speed < 0.35 || f.y - gy > 0.6) { stepAcc = Math.min(stepAcc, 0.4); return; }
    stepAcc += moved;
    const stride = Math.min(1.25, 0.7 + speed * 0.12);
    if (stepAcc < stride) return;
    stepAcc -= stride;
    stepLeft = !stepLeft;
    let name = 'step-grass';
    if (env && env.isWater && env.isWater(f.x, f.z)) name = 'step-water';
    else if (f.y - gy > 0.2) name = 'step-wood';
    else if (zone === 'dungeon' || zone === 'tavern') name = zone === 'tavern' ? 'step-wood' : 'step-stone';
    else if (zone === 'village' && Math.random() < 0.5) name = 'step-dirt';
    sfx(name, { volume: Math.min(1, 0.45 + speed * 0.16), pitch: stepLeft ? 0.97 : 1.03 });
  }
  function swings(dt, t) {
    const Wp = W.weapons;
    if (!Wp || !Wp.held || dt <= 0) return;
    for (let i = 0; i < 2; i++) {
      const hand = i ? 'right' : 'left', w = Wp.held[hand], h = ctx.input && ctx.input[hand];
      if (!w || !h || !h.connected) { haveHand[i] = false; continue; }
      const p = h.position;
      if (haveHand[i]) {
        const dx = p.x - hx[i], dy = p.y - hy[i], dz = p.z - hz[i];
        const v = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
        if (w.kind === 'melee' && v > 3.4 && t - swingT[i] > 0.32) {
          swingT[i] = t;
          const ty = w.type;
          sfx(W_HEAVY.has(ty) ? 'swing-heavy' : W_LIGHT.has(ty) ? 'swing-light' : ty === 'spear' || ty === 'sun-spear' ? 'thrust' : 'swing-medium', { at: p, volume: Math.min(1.1, 0.45 + v / 12) });
        }
      }
      hx[i] = p.x; hy[i] = p.y; hz[i] = p.z; haveHand[i] = true;
    }
  }
  function baseMood(t) {
    if (sacred) return 'sacred';
    if (t < wonderUntil) return 'wonder';
    if (zone === 'tavern') return 'tavern';
    if (zone === 'dungeon' || zone === 'graveyard') return 'dungeon';
    if (zone === 'village') return 'village';
    const env = W.env;
    if (env && typeof env.timeOfDay === 'number' && env.timeOfDay < 0.28) return 'night';
    return 'calm';
  }
  function director(t, dt) {
    const C = W.combat;
    let nearD = 1e9, nNear = 0, engaged = false, boss = false;
    if (C && C.fighters) {
      const list = C.fighters;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (!f.alive || f.faction !== 'enemy' || !f.actor || !f.actor.position) continue;
        const p = f.actor.position, dx = p.x - head.x, dz = p.z - head.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearD) nearD = d;
        if (d < 45) nNear++;
        if (f.target && d < 35) engaged = true;
        if (d < 120 && isBoss(f)) boss = true;
      }
    }
    if (engaged) { if (t - fightT > 12) fightStart = t; fightT = t; }
    // gazing at the Omnissiah
    const O = W.oracle;
    if (O && O.position) {
      const dx = O.position.x - head.x, dy = O.position.y - head.y, dz = O.position.z - head.z;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, fw = ctx.player.forward;
      const c = (dx * fw.x + dy * fw.y + dz * fw.z) / l;
      if (c > 0.985) gazeT = Math.min(8, gazeT + dt); else if (c < 0.9) gazeT = Math.max(0, gazeT - dt * 2);
      if (!sacred && gazeT > 3.5) sacred = true;
      else if (sacred && gazeT < 0.5) sacred = false;
    }
    let want;
    if (boss) want = 'boss';
    else if (t - fightT < 7) want = 'battle';
    else if (nNear > 0 && nearD < 45) want = 'tension';
    else want = baseMood(t);
    if (nNear === 0 && !boss && t - fightT >= 7 && (music.mood === 'tension')) want = baseMood(t);
    if (music.override) return;
    if (t < music.stingerUntil || t < (music.afterSting || 0)) return; // let the stinger breathe
    if (!pack.size) return;
    const cur = music.mood;
    if (cur === want) { candidate = null; return; }
    const escalate = want === 'boss' || want === 'battle' || (want === 'tension' && cur !== 'battle' && cur !== 'boss');
    const dwell = t - (music.since || 0);
    if (!cur) { setTrack(want, 'director', 3); return; }
    if (escalate) { setTrack(want, 'director', want === 'battle' || want === 'boss' ? 2 : 3.5); return; }
    // leaving battle / tension / any mood: the candidate must stay stable (hysteresis) and the current mood must have played a while
    if (candidate !== want) { candidate = want; candSince = t; return; }
    const stable = t - candSince, minStable = cur === 'battle' || cur === 'boss' ? 5 : 3;
    if (stable >= minStable && dwell >= 10) { candidate = null; setTrack(want, 'director', 4); }
  }
  let acc = 0, accSlow = 0, resumeT = 0;
  const unlock = () => { if (ac.state === 'suspended') ac.resume().catch(() => {}); music.blocked = true; };
  const gestures = ['pointerdown', 'keydown', 'touchstart'];
  if (typeof window !== 'undefined') for (const g of gestures) window.addEventListener(g, unlock, { passive: true });
  ctx.on('xr:start', unlock);
  ctx.onDispose(() => { if (typeof window !== 'undefined') for (const g of gestures) window.removeEventListener(g, unlock); });
  applyMusicBus();
  if (S.override) music.override = S.override;
  loadManifests();

  return {
    update(dt, t) {
      if (disposed) return;
      footsteps(dt);
      swings(dt, t);
      updateLoops(t);
      acc += dt; accSlow += dt;
      if (acc >= 0.2) {
        acc = 0;
        updateMusic();
        if (!music.override && ac.state === 'running') { director(t, 0.2); }
        else if (music.override && music.override.mood && !music.cur && ac.state === 'running') setTrack(music.override.mood, 'manual', 3);
      }
      if (accSlow >= 0.5) {
        accSlow = 0;
        idleVoices(t);
        const pl = W.player;
        if (pl && pl.alive !== false && pl.maxHealth > 0 && pl.health / pl.maxHealth < 0.3 && t - hbT > 1.15) { hbT = t; sfx('heartbeat', { volume: 0.8, cooldown: 1 }); }
        if (ac.state === 'suspended' && t - resumeT > 1) { resumeT = t; ac.resume().catch(() => {}); }
      }
    },
    dispose() {
      disposed = true;
      const t = ac.currentTime;
      for (const v of voices.slice()) { stopVoice(v, 0.05); }
      if (bedCur) { retireBed(bedCur, 0.2); bedCur = null; }
      for (const tr of tracks) { try { tr.trk.gain.cancelScheduledValues(t); tr.trk.gain.setTargetAtTime(0, t, 0.05); } catch (e) { /* ignore */ } }
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0, t, 0.04);
      setTimeout(() => {
        for (const tr of tracks) for (const s of tr.sl) { try { s.el.pause(); } catch (e) { /* ignore */ } }
        for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
        for (const g of gains) { try { g.disconnect(); } catch (e) { /* ignore */ } }
      }, 250);
    },
  };
}
