// core/quests.js - world.quests: the mortal's PROGRESSION and your LABOURS. XP, levels, titles and your FAVOUR, saved between sessions.
// You can hand the player a quest in any wish ("give me a quest", "I'm bored", "test me") with ONE call; write it as a tiny creation:
//
//   // creations/quest-hollow-hill.js      (offer() is saved and idempotent per id, so the file may stay or be emptied afterwards)
//   export default function (ctx) {
//     ctx.world.quests?.offer({ id: 'hollow-hill', title: 'The Hollow Hill', description: 'Something stirs beneath the old stones.',
//       steps: [{ text: 'Walk to the standing stones', type: 'reach', where: 'stones' },
//               { text: 'Slay four skeletons', type: 'kill', target: 'skeleton', count: 4, spawn: { name: 'graveyard', at: 'ahead', dist: 14 } }],
//       rewards: { xp: 250, favour: 4, title: 'Hill-Walker' } });
//     return {};
//   }
//   offer() returns the id (or null) and pins it: it appears on their tracker with a beacon on the way. Say ONE grand line about it.
//
// SPEC  { id?, title, giver? ('Omnissiah'), description, steps: [1-6 x STEP], rewards?: { xp (<= 600), favour (<= 10), title: 'Name', unlock: 'flag', spawn: 'library-entry' } }
// STEP  { text (<= 70 chars, what they read), type, target?, count? (1), where?, weapon?, noHurt?, when?, distinct?, spawn? }
//   type  kill      target: enemy name ('goblin' also matches goblin-archer) | 'any' | 'boss' | 'undead' | 'beast' ; weapon: 'sword' | 'melee' | 'ranged' | 'spell' | spell id ;
//                   noHurt: true = any hit on the player resets the count (a flawless streak)
//         survive-wave   spawn: { wave: [{ name: 'goblin', count: 5 }], radius?: 13 }  done when the whole wave is dead
//         summon    target: library entry ('knight') | category ('ally','enemy','weapon','structure','nature','prop','effect','scenario') | 'any' | 'new' (never seen before); distinct: true | 'category'
//         break     target: material ('wood','stone','glass'..) | 'any' ; weapon: 'hammer' ; where: place   fell  count trees      cast  target: spell id | 'any' ; distinct: true = different spells
//         use-weapon  target: weapon type | 'melee' | 'ranged' | 'any' ; mode: 'grab' (default) | 'hit' | 'fire' ; distinct     collect  target: weapon type, or omit + spawn = a glowing relic to pick up
//         deliver   carry the relic to `where`      reach  go to `where`      explore  count = metres travelled      ride | fly | mixed-reality  count = seconds
//         talk      target: npc name | 'any'      ask  count = wishes made      conjure  a generated model finishes      stat  target: 'level' | 'favour' | 'stats.kills' ; count: threshold
//         custom    only YOU finish it: quests.advance(id)  (when something in a creation of yours happens)
//   where  'lake' | 'stones' (far standing circle) | 'origin' | 'oracle' | [x, z] | [x, z, radius] | { x, z, radius } | 'spawn' (the step's own spawn spot)
//   when   'night' | 'day' | 'mr' (only counts at night / by day / in mixed reality)
//   spawn  { name: 'goblin', count: 3, spread: 4, opts: { hp: 40 }, at: 'ahead' | 'around' | 'lake' | 'stones' | [x, z], dist: 8, delay: 4 } or an array of them: the quest conjures its own quarry
//          from the library (names must exist; a hostile spawn is announced and delayed). Spawned things vanish if this module is reloaded.
//
// API  world.quests.offer(spec) -> id|null   advance(id, n = 1)   complete(id)   start(id)   pin(id)   abandon(id)   list({ state?, kind? })   get(id)   active()   bounties()
//   profile() -> { level, xp, xpNext, favour, regard, title, titles, stats, perks, discoveries }   grantXp(n, why)   addFavour(n, why)   stat('kills')   setTitle(id)   on(evt, fn) -> off
//   Events on ctx.events: quest:started quest:progress quest:completed player:levelup player:title. Their standing is in every request you receive as "Standing: ...".
//
// MANNER  You are a god handing a mortal a labour. Terse and grand, never mechanical ("labour" and "quest" are fine, "XP" is not): "Seek the stones by night, and bring me what they hide."
//   Address them by their title when your favour is high; tease them when it is low. Scale rewards to effort: errand 50-100 xp, labour 150-300, legend 400-600 (titles: rarely).
//   Do not offer a second quest while one is active unless they ask. A quest whose goal needs your art (a spell, a creature) should say so in its text: "Ask me for wings, then fly".
import { UI } from '/sys/hud.js';   // shared palette + glass painter (stable core: the same module instance boot.js loaded)

export const meta = { name: 'Quests', description: 'Persistent quests, XP, levels, titles and the Omnissiah\'s favour; saved between sessions.' };

// =====================================================================================================================
// Module-scope constants and pure helpers (no ctx needed)
// =====================================================================================================================
const SCHEMA = 1;
const SAVE_KEY = 'profile';
const LS_KEY = 'omnissiah.profile.v1';
const LV_A = 140, LV_P = 1.65, LV_MAX = 60;       // cumulative XP to reach level L = 140 * (L-1)^1.65  (level 5 = 1379 XP)
const xpForLevel = (L) => (L <= 1 ? 0 : Math.round(LV_A * Math.pow(L - 1, LV_P)));
function levelForXp(xp) {
  xp = Math.max(0, xp);
  let L = Math.min(LV_MAX, Math.floor(1 + Math.pow(xp / LV_A, 1 / LV_P)));
  while (L < LV_MAX && xp >= xpForLevel(L + 1)) L++;
  while (L > 1 && xp < xpForLevel(L)) L--;
  return L;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sing = (w) => w.replace(/ves$/, 'f').replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/([^s])s$/, '$1');
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
const plural = (w) => (/s$/.test(w) ? w : /(wolf)$/.test(w) ? w.replace(/f$/, 'ves') : /[^aeiou]y$/.test(w) ? w.replace(/y$/, 'ies') : /(ch|sh|x)$/.test(w) ? w + 'es' : w + 's');
function mulberry(seed) {
  let s = seed >>> 0 || 1;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const dayKey = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

const STEP_TYPES = ['kill', 'survive-wave', 'summon', 'break', 'fell', 'cast', 'use-weapon', 'reach', 'talk', 'collect', 'deliver', 'ask', 'conjure', 'ride', 'fly', 'explore', 'stat', 'mixed-reality', 'custom'];
const COUNT_MAX = { explore: 20000, ride: 600, fly: 600, 'mixed-reality': 900, stat: 1e7, kill: 200, break: 300, fell: 200, summon: 100, cast: 300, 'use-weapon': 200, ask: 100, 'survive-wave': 10, custom: 100 };
const SAFE_OPT = ['faction', 'hp', 'damage', 'scale', 'color', 'text', 'name', 'style', 'radius', 'length', 'rise', 'boss', 'skeletons', 'goblins', 'roof', 'size', 'loot', 'yaw', 'seats', 'types', 'attackers', 'defenders', 'robots', 'drones', 'aliens', 'waves', 'fish', 'intensity'];
const BOSS_RE = /boss|dragon|king|queen|lord|giant|titan|lich|demon|warlord|overlord|colossus/i;
// First labours (the start zone, core/startzone.js): where things stand when that module is not live, who the traveller at the fire is, and what counts as "the sky changed".
const SZ_FALLBACK = { campfire: [0, -6], shrine: [10, -11], lectern: [-3.6, -3], rack: [-8, -4], waystone: [6.4, -2.6], dummies: [-12, -9] };
const PERSONAS = { pell: 'Pell, a patched-cloak wanderer who has walked this field since before the sky was lit. Dry, kind, short sentences. Calls the Omnissiah the lamp. Knows more than he says and never lies. At the meadow fire he warms his hands.' };
const PELL_GREETING = 'Sit. The fire is low, but it listens. The lamp woke you, then. It does that.';
const SKY_RE = /^(night|day|dusk|dawn|rain|snow|storm|aurora|fog|meteor|eclipse|sunset|sunrise|twilight|blizzard|thunder)/;
const GROUPS = {
  undead: /skeleton|zombie|wraith|necromancer|lich|ghost|bone|vampire|ghoul|mummy/,
  beast: /wolf|bear|spider|scorpion|bat|boar|rat|snake|slime|whelp|dog|fox|panther/,
  goblinoid: /goblin|orc|ogre|troll/,
  humanoid: /bandit|cultist|pirate|knight|demon|goblin|orc/,
  construct: /golem|robot|drone|elemental|mimic/,
};
const CAT = {
  ally: 'allies', allies: 'allies', friend: 'allies', companion: 'allies', enemy: 'enemies', enemies: 'enemies', monster: 'enemies', foe: 'enemies',
  weapon: 'weapons', weapons: 'weapons', structure: 'structures', structures: 'structures', building: 'structures', nature: 'nature', tree: 'nature',
  plant: 'nature', prop: 'props', props: 'props', effect: 'effects', effects: 'effects', weather: 'effects', scenario: 'scenarios', scenarios: 'scenarios',
  place: 'scenarios', life: 'life', creature: 'life', animal: 'life', person: 'life', villager: 'life',
};
const MELEE_W = new Set('sword greatsword dagger axe great-axe warhammer mace club spear katana scythe pickaxe war-pick shovel hoe boomerang bone-blade bone-axe omni-blade sun-spear void-scythe storm-hammer rune-dagger'.split(' '));
const RANGED_W = new Set('bow crossbow heavy-crossbow blaster revolver smg rifle sniper shotgun rocket-launcher plasma-rifle magic-staff wand bone-staff spellbook ember-staff star-bow arc-blaster prism-rifle'.split(' '));
const SHIELD_W = new Set('shield spiked-shield tower-shield aegis-shield'.split(' '));
const MAGIC_W = new Set('magic-staff wand bone-staff spellbook ember-staff'.split(' '));
const STONES = [[93.2, 117.5, 13], [-185.9, -143.8, 17], [226.8, -225.8, 12]]; // the far standing circles of core/world.js (x, z, radius)
const BOSS_ENTRIES = new Set(['lich-king', 'ancient-dragon']);
const FALLBACK_LIB = {
  enemies: ['goblin', 'goblin-archer', 'goblin-shaman', 'orc-brute', 'skeleton', 'skeleton-archer', 'zombie', 'bandit', 'dark-knight', 'cultist', 'troll', 'wolf', 'giant-spider', 'slime', 'wraith', 'imp', 'stone-golem', 'drone', 'lich-king', 'ancient-dragon'],
  allies: ['knight', 'archer', 'mage', 'healer', 'paladin', 'ranger', 'guard-dog', 'wolf-companion', 'fairy', 'robot-buddy'],
  life: ['villager', 'farmer', 'merchant', 'bard', 'cat', 'dog', 'horse', 'deer', 'fox'],
  weapons: ['sword', 'greatsword', 'dagger', 'axe', 'warhammer', 'spear', 'katana', 'scythe', 'bow', 'crossbow', 'blaster', 'shotgun', 'magic-staff', 'wand', 'shield', 'torch', 'pickaxe'],
  structures: ['hut', 'cottage', 'watchtower', 'castle-tower', 'well', 'windmill', 'lighthouse', 'ruins', 'stone-circle', 'shrine', 'obelisk', 'fountain', 'tavern', 'ship'],
  nature: ['oak-tree', 'pine-tree', 'birch-tree', 'cherry-blossom', 'giant-mushroom', 'crystal-cluster', 'boulder', 'grove', 'pond'],
  props: ['chest', 'barrel', 'crate', 'crate-stack', 'powder-keg', 'lantern', 'bonfire', 'anvil', 'training-dummy', 'statue', 'balloon-bunch', 'trampoline'],
  effects: ['rain', 'snow', 'fireflies', 'aurora', 'night', 'storm', 'meteor-shower', 'confetti-burst'],
  scenarios: ['village', 'goblin-camp', 'graveyard', 'bandit-ambush', 'arena-battle', 'castle-siege', 'boss-fight', 'robot-invasion'],
};

// ---------------------------------------------------------------------------------------------------- titles
const kills = (p, re) => { let n = 0; const m = p.stats.killsBy; for (const k in m) if (re.test(k)) n += m[k]; return n; };
const TITLES = [
  { id: 'wanderer', name: 'Wanderer', rank: 1, test: () => true },
  { id: 'initiate', name: 'Initiate', rank: 10, test: (p) => p.level >= 5 },
  { id: 'adept', name: 'Adept', rank: 20, test: (p) => p.level >= 10 },
  { id: 'champion', name: 'Champion', rank: 40, test: (p) => p.level >= 20 },
  { id: 'exalted', name: 'Exalted', rank: 70, test: (p) => p.level >= 35 },
  { id: 'goblin-bane', name: 'Goblin-Bane', rank: 15, test: (p) => kills(p, /goblin/) >= 50 },
  { id: 'bone-breaker', name: 'Bone-Breaker', rank: 15, test: (p) => kills(p, /skeleton/) >= 40 },
  { id: 'troll-slayer', name: 'Troll-Slayer', rank: 22, test: (p) => kills(p, /troll|ogre/) >= 10 },
  { id: 'lichbane', name: 'Lichbane', rank: 35, test: (p) => (p.stats.bossNames['lich-king'] | 0) >= 1 },
  { id: 'dragon-slayer', name: 'Dragon-Slayer', rank: 45, test: (p) => (p.stats.bossNames['ancient-dragon'] | 0) + (p.stats.bossNames.dragon | 0) >= 1 },
  { id: 'wall-breaker', name: 'Wall-Breaker', rank: 14, test: (p) => p.stats.broken >= 100 },
  { id: 'woodcutter', name: 'Woodcutter', rank: 12, test: (p) => p.stats.felled >= 40 },
  { id: 'spellweaver', name: 'Spellweaver', rank: 18, test: (p) => Object.keys(p.stats.spells).length >= 10 },
  { id: 'armsmaster', name: 'Armsmaster', rank: 18, test: (p) => Object.keys(p.stats.weapons).length >= 20 },
  { id: 'wayfarer', name: 'Wayfarer', rank: 12, test: (p) => p.stats.walked >= 15000 },
  { id: 'skybound', name: 'Skybound', rank: 14, test: (p) => p.stats.flown >= 4000 },
  { id: 'maker', name: 'Maker', rank: 14, test: (p) => p.stats.summoned >= 100 },
  { id: 'world-shaper', name: 'World-Shaper', rank: 25, test: (p) => p.stats.wishes >= 40 },
  { id: 'conjuror', name: 'Conjuror', rank: 25, test: (p) => p.stats.models >= 5 },
  { id: 'untouchable', name: 'the Untouchable', rank: 22, test: (p) => p.stats.flawless >= 10 },
  { id: 'persistent', name: 'the Persistent', rank: 8, test: (p) => p.stats.deaths >= 10 },
  { id: 'labourer', name: 'Labourer', rank: 16, test: (p) => p.stats.quests >= 20 },
  { id: 'bounty-hunter', name: 'Bounty-Hunter', rank: 16, test: (p) => p.stats.bountiesDone >= 10 },
  { id: 'beloved', name: 'Beloved of the Machine', rank: 60, test: (p) => p.favour >= 90 },
];

// ---------------------------------------------------------------------------------------------------- perks
function perksFor(level, favour) {
  const L = Math.max(0, level - 1);
  return {
    maxHealth: Math.min(80, L * 2),                                   // + max hp
    regen: Math.round((Math.min(1.5, L * 0.05) + (favour >= 30 ? 0.25 : 0)) * 100) / 100, // + hp/s
    speed: Math.round(Math.min(0.7, L * 0.03) * 100) / 100,          // + m/s walking speed
    favouriteSlots: level >= 16 ? 3 : level >= 8 ? 2 : 1,             // spell-wheel favourites
    allyHpMul: level >= 20 ? 1.5 : level >= 12 ? 1.3 : level >= 5 ? 1.15 : 1, // stronger familiars / allies
    respawnGrace: favour >= 50 ? 2 : 0,                               // extra invulnerable seconds after respawning
    killHeal: favour >= 75 ? 2 : 0,                                   // hp restored per kill
  };
}
const regardOf = (f) => (f < 15 ? 'wary' : f < 35 ? 'curious' : f < 60 ? 'fond' : f < 85 ? 'favoured' : 'beloved');

// ---------------------------------------------------------------------------------------------------- the starter arc (state lives in the profile; definitions live here)
const st = (type, text, o = {}) => ({ type, text, ...o });
const HOSTILE_WAVE = (list, o = {}) => ({ wave: list, at: 'around', radius: 13, delay: 6, ...o });
const STARTERS = [
  // ---- the first labours, in the start zone (they need core/startzone.js; without it the older arc below begins at 'awaken'). Each is under a minute and pays off in the new art.
  { id: 'sz-pell', title: 'A Traveller at the Fire', needs: ['startzone'], description: 'A wanderer keeps the fire. He has been here longer than the grass. Go and sit with him.',
    steps: [st('talk', 'Walk up to Pell, at the campfire', { target: 'Pell', near: 3.6, spawn: { name: 'villager', at: 'sz-campfire', off: [-2.2, -1.0], delay: 0.5, persona: 'pell', opts: { name: 'Pell' } } })], rewards: { xp: 40, favour: 2 } },
  { id: 'sz-brazier', title: 'Stoke the Shrine', after: ['sz-pell'], needs: ['startzone'], description: 'Two braziers watch the shrine behind you. Their fire is low. Feed each one a spell, and it will remember you.',
    steps: [st('custom', 'Stoke both braziers by the shrine: cast a spell at each', { site: 'brazier', count: 2 })], rewards: { xp: 50, favour: 2 } },
  { id: 'sz-water', title: 'Down to the Water', after: ['sz-brazier'], needs: ['startzone'], description: 'A worn path runs from the fire to the lake. Walk it to the jetty.',
    steps: [st('reach', 'Walk the worn path to the jetty', { where: 'sz-lakeside' })], rewards: { xp: 50, favour: 2 } },
  { id: 'sz-dummies', title: 'Straw Soldiers', after: ['sz-water'], needs: ['startzone'], description: 'Three straw soldiers stand in the practice yard. They have never won a fight. Keep it that way.',
    steps: [st('custom', 'Strike each of the three straw dummies', { site: 'dummies', count: 3 })], rewards: { xp: 60, favour: 2 } },
  { id: 'awaken', title: 'The Voice Above', description: 'I am listening, mortal. Ask me for something. Anything at all. Say my name, or type it below.',
    steps: [st('ask', 'Make a wish: say "Omnissiah, ..." and ask for anything')], rewards: { xp: 60, favour: 4 } },
  { id: 'sz-sky', title: 'The Sky Is Yours', after: ['awaken'], description: 'The sky is only a habit. Ask me to change it: night, rain, anything.',
    steps: [st('custom', 'Ask me to change the sky: night, rain, anything', { site: 'sky' })], rewards: { xp: 60, favour: 3 } },
  { id: 'first-friend', title: 'A Friend in the Field', after: ['awaken'], description: 'No one should walk my field alone. Ask for a companion.',
    steps: [st('summon', 'Ask me for an ally to stand beside you', { target: 'ally' })], rewards: { xp: 80, favour: 3 } },
  { id: 'take-arms', title: 'Take Up Arms', after: ['awaken'], description: 'The field bites. Ask for a weapon, then grip it.',
    steps: [st('summon', 'Ask me for a weapon', { target: 'weapon' }), st('use-weapon', 'Grip it with a squeeze', { target: 'any', mode: 'grab' })], rewards: { xp: 90, favour: 3 } },
  { id: 'first-blood', title: 'First Blood', after: ['take-arms'], description: 'A goblin skulks nearby. Show it what the blade is for.',
    steps: [st('kill', 'Kill the goblin', { target: 'goblin', count: 1, spawn: { name: 'goblin', count: 1, at: 'ahead', dist: 9, delay: 3, opts: { rise: true } } })], rewards: { xp: 100, favour: 4 } },
  { id: 'shatter', title: 'Shatter', after: ['take-arms'], description: 'All things break. Teach them how.',
    steps: [st('break', 'Smash three crates', { target: 'any', count: 3, spawn: { name: 'crate', count: 3, spread: 2.5, at: 'ahead', dist: 5, delay: 1 } })], rewards: { xp: 90, favour: 2 } },
  { id: 'three-arts', title: 'The Three Arts', after: ['take-arms'], description: 'A weapon is one voice. Spells are many. Learn three.',
    steps: [st('cast', 'Cast three different spells (right A cycles)', { target: 'any', count: 3, distinct: true })], rewards: { xp: 110, favour: 3 } },
  { id: 'many-blades', title: 'A Blade for Every Hand', after: ['take-arms'], description: 'Weigh different weapons, mortal. A master knows many.',
    steps: [st('use-weapon', 'Grip three different weapons', { target: 'any', count: 3, mode: 'grab', distinct: true })], rewards: { xp: 120, favour: 3 } },
  { id: 'timber', title: 'Timber!', after: ['shatter'], description: 'A grove stands where you look. Fell one of its trees.',
    steps: [st('fell', 'Fell a tree', { count: 1, spawn: { name: 'grove', at: 'ahead', dist: 14, delay: 1 } })], rewards: { xp: 90, favour: 2 } },
  { id: 'long-walk', title: 'The Long Walk', after: ['awaken'], description: 'My field is wide. Cross some of it.',
    steps: [st('explore', 'Travel three hundred metres', { count: 300 })], rewards: { xp: 80, favour: 2 } },
  { id: 'still-water', title: 'The Still Water', after: ['long-walk'], description: 'Far to the north-west lies a lake. Go and look at it.',
    steps: [st('reach', 'Reach the lake', { where: 'lake' })], rewards: { xp: 100, favour: 3 } },
  { id: 'moonlit-shore', title: 'Moonlight on the Lake', after: ['still-water'], description: 'The water is different by night. Ask me for darkness, then go.',
    steps: [st('reach', 'Stand by the lake at night (ask me for night)', { where: 'lake', when: 'night' })], rewards: { xp: 160, favour: 5 } },
  { id: 'goblin-raid', title: 'The Goblin Raid', after: ['first-blood'], description: 'They come in numbers now. Stand your ground.',
    steps: [st('survive-wave', 'Survive the goblin raid', { spawn: HOSTILE_WAVE([{ name: 'goblin', count: 5 }, { name: 'goblin-archer', count: 2 }]) })], rewards: { xp: 220, favour: 6 } },
  { id: 'bones-in-mist', title: 'Bones in the Mist', after: ['goblin-raid'], minLevel: 2, description: 'The dead are restless in the graveyard. Quiet them.',
    steps: [st('kill', 'Clear the graveyard of skeletons', { target: 'skeleton', count: 6, spawn: { name: 'graveyard', at: 'ahead', dist: 24, delay: 6, opts: { skeletons: 8 } } })], rewards: { xp: 260, favour: 6 } },
  { id: 'tower-falls', title: 'The Tower Falls', after: ['shatter'], description: 'Take up a hammer. Bring down a tower.',
    steps: [st('collect', 'Pick up the warhammer', { target: 'warhammer', spawn: { name: 'warhammer', at: 'ahead', dist: 3, delay: 0.5 } }),
      st('break', 'Break the tower with the hammer', { target: 'any', count: 3, weapon: 'hammer', where: 'spawn', spawn: { name: 'castle-tower', at: 'ahead', dist: 16, delay: 1, opts: { roof: false } } })],
    rewards: { xp: 200, favour: 5 } },
  { id: 'untouched', title: 'Untouched', after: ['goblin-raid'], minLevel: 3, description: 'Skill is not taking blows. It is refusing them.',
    steps: [st('kill', 'Kill five enemies without taking a hit', { target: 'any', count: 5, noHurt: true, spawn: HOSTILE_WAVE([{ name: 'goblin', count: 5 }], { delay: 7 }) })], rewards: { xp: 240, favour: 6 } },
  { id: 'steel-and-sorcery', title: 'Steel and Sorcery', after: ['three-arts', 'goblin-raid'], description: 'Both arts, mortal. Prove you have both.',
    steps: [st('kill', 'Kill three enemies with spells', { target: 'any', count: 3, weapon: 'spell', spawn: HOSTILE_WAVE([{ name: 'goblin', count: 3 }], { delay: 6 }) }),
      st('kill', 'Kill three enemies with melee weapons', { target: 'any', count: 3, weapon: 'melee', spawn: HOSTILE_WAVE([{ name: 'goblin', count: 3 }], { delay: 6 }) })],
    rewards: { xp: 260, favour: 6 } },
  { id: 'bring-light', title: 'Bring the Light', after: ['still-water'], description: 'A spark of me waits near you. Carry it to the lake shore.',
    steps: [st('collect', 'Take up the glowing relic', { spawn: { at: 'ahead', dist: 5, delay: 0.5 } }), st('deliver', 'Carry the relic to the lake', { where: 'lake' })], rewards: { xp: 180, favour: 5 } },
  { id: 'parley', title: 'Parley', after: ['first-friend'], needs: ['voices'], description: 'Not every mortal is a monster. Speak with one.',
    steps: [st('talk', 'Walk up to the villager and speak to them', { target: 'any', spawn: { name: 'villager', at: 'ahead', dist: 6, delay: 0.5 } })], rewards: { xp: 120, favour: 4 } },
  { id: 'makers-hand', title: 'The Maker\'s Hand', after: ['first-friend'], description: 'You have seen me create. Now ask for variety.',
    steps: [st('summon', 'Summon things from four different realms', { target: 'any', count: 4, distinct: 'category' })], rewards: { xp: 170, favour: 5 } },
  { id: 'above-clouds', title: 'Above the Clouds', after: ['awaken'], minLevel: 2, description: 'The ground is a habit. Ask me for wings.',
    steps: [st('fly', 'Ask me for flight, then stay aloft for twenty seconds', { count: 20 })], rewards: { xp: 120, favour: 4 } },
  { id: 'need-speed', title: 'Need for Speed', after: ['awaken'], minLevel: 3, manual: true, description: 'Legs are slow. Ask me for a machine.',
    steps: [st('ride', 'Ask me for a vehicle and ride it for ten seconds', { count: 10 })], rewards: { xp: 140, favour: 4 } },
  { id: 'walls-world', title: 'Walls of the World', after: ['awaken'], manual: true, description: 'Enter mixed reality, and I will walk in your own room.',
    steps: [st('mixed-reality', 'Enter mixed reality (the button below the view) for fifteen seconds', { count: 15 }), st('summon', 'Ask me to make something in your room', { target: 'any', when: 'mr' })],
    rewards: { xp: 200, favour: 6 } },
  { id: 'something-new', title: 'Something Never Seen', after: ['awaken'], minLevel: 3, manual: true, needs: ['models'], description: 'Describe a thing that has never existed. I will dream it into shape.',
    steps: [st('conjure', 'Ask me to conjure a brand-new model', { count: 1 })], rewards: { xp: 300, favour: 8 } },
  { id: 'lich-king', title: 'Slay the Lich King', after: ['bones-in-mist'], minLevel: 4, manual: true, description: 'A crowned bone-sorcerer waits in a torch-lit pit. End him.',
    steps: [st('kill', 'Slay the Lich King', { target: 'lich-king', count: 1, spawn: { name: 'boss-fight', at: 'ahead', dist: 26, delay: 8, opts: { boss: 'lich-king' } } })], rewards: { xp: 450, favour: 10 } },
  { id: 'siege-day', title: 'The Siege', after: ['untouched'], minLevel: 6, manual: true, description: 'A castle stands. Its attackers do not. Break them.',
    steps: [st('kill', 'Defeat twelve of the besiegers', { target: 'any', count: 12, spawn: { name: 'castle-siege', at: 'ahead', dist: 30, delay: 8 } })], rewards: { xp: 380, favour: 8 } },
  { id: 'dragonfall', title: 'Dragonfall', after: ['lich-king'], minLevel: 8, manual: true, description: 'The oldest of my creations wakes. Bring it down, if you can.',
    steps: [st('kill', 'Slay the ancient dragon', { target: 'ancient-dragon', count: 1, spawn: { name: 'boss-fight', at: 'ahead', dist: 30, delay: 8, opts: { boss: 'ancient-dragon' } } })], rewards: { xp: 600, favour: 10, title: 'Dragon-Slayer' } },
  { id: 'rising', title: 'Rising Star', after: ['take-arms'], passive: true, description: 'Reach level five.',
    steps: [st('stat', 'Reach level five', { target: 'level', count: 5 })], rewards: { xp: 150, favour: 3 } },
  { id: 'hundred-fallen', title: 'A Hundred Fallen', after: ['first-blood'], passive: true, description: 'Let the field remember a hundred of your kills.',
    steps: [st('stat', 'Slay a hundred enemies', { target: 'stats.kills', count: 100 })], rewards: { xp: 300, favour: 5 } },
  { id: 'beloved-of-machine', title: 'Beloved of the Machine', after: ['rising'], minLevel: 5, passive: true, description: 'Earn my deep regard through boldness, variety and creation.',
    steps: [st('stat', 'Earn the Omnissiah\'s favour (75)', { target: 'favour', count: 75 })], rewards: { xp: 350, favour: 0, title: 'Beloved of the Machine' } },
].map((q, i) => ({ kind: 'story', giver: 'Omnissiah', arc: i + 1, ...q, steps: q.steps.map(cleanStep) }));

// ---------------------------------------------------------------------------------------------------- spec validation (quests written by you, bounties, starters)
function cleanWhere(w) {
  if (typeof w === 'string') { const s = norm(w).slice(0, 24); return s || undefined; }
  if (Array.isArray(w) && w.length >= 2 && isFinite(w[0]) && isFinite(w[1])) return [+w[0], +w[1], ...(isFinite(w[2]) ? [clamp(+w[2], 1, 200)] : [])];
  if (isObj(w) && isFinite(w.x) && isFinite(w.z)) return { x: +w.x, z: +w.z, radius: isFinite(w.radius) ? clamp(+w.radius, 1, 200) : undefined };
  return undefined;
}
function cleanSpawn1(sp) {
  if (!isObj(sp)) return null;
  const out = {};
  if (Array.isArray(sp.wave)) {
    out.wave = []; let total = 0;
    for (const w of sp.wave.slice(0, 6)) {
      const name = typeof w === 'string' ? w : w?.name;
      if (typeof name !== 'string') continue;
      const count = clamp(Math.floor(num(w?.count, 1)), 1, 30);
      if (total + count > 40) break;
      total += count; out.wave.push({ name: name.slice(0, 40), count });
    }
    if (!out.wave.length) return null;
  } else if (typeof sp.name === 'string' && sp.name) out.name = sp.name.slice(0, 40);
  else if (sp.at === undefined) return null;
  if (sp.count !== undefined) out.count = clamp(Math.floor(num(sp.count, 1)), 1, 40);
  if (sp.spread !== undefined) out.spread = clamp(num(sp.spread, 3), 0, 30);
  if (sp.radius !== undefined) out.radius = clamp(num(sp.radius, 13), 6, 40);
  if (sp.dist !== undefined) out.dist = clamp(num(sp.dist, 8), 2, 80);
  if (sp.delay !== undefined) out.delay = clamp(num(sp.delay, 0), 0, 60);
  if (typeof sp.persona === 'string') out.persona = norm(sp.persona).slice(0, 20);
  if (typeof sp.at === 'string') out.at = norm(sp.at).slice(0, 20);
  else if (Array.isArray(sp.at) && isFinite(sp.at[0]) && isFinite(sp.at[1])) out.at = [+sp.at[0], +sp.at[1]];
  if (Array.isArray(sp.off) && isFinite(sp.off[0]) && isFinite(sp.off[1])) out.off = [clamp(+sp.off[0], -80, 80), clamp(+sp.off[1], -80, 80)];
  if (isObj(sp.opts)) {
    out.opts = {};
    for (const k of SAFE_OPT) {
      const v = sp.opts[k];
      if (typeof v === 'number' && isFinite(v)) out.opts[k] = k === 'hp' || k === 'damage' ? clamp(v, 1, 3000) : v;
      else if (typeof v === 'string' || typeof v === 'boolean') out.opts[k] = typeof v === 'string' ? v.slice(0, 60) : v;
    }
  }
  return out;
}
function cleanSpawn(sp) {
  if (Array.isArray(sp)) { const a = sp.slice(0, 4).map(cleanSpawn1).filter(Boolean); return a.length ? a : undefined; }
  return cleanSpawn1(sp) ?? undefined;
}
function defaultText(s) {
  const t = s.target && s.target !== 'any' ? String(s.target).replace(/-/g, ' ') : '';
  const n = s.count > 1 ? `${s.count} ` : '';
  switch (s.type) {
    case 'kill': return `Slay ${n}${t || 'enemies'}`;
    case 'survive-wave': return 'Survive the onslaught';
    case 'summon': return `Summon ${n}${t ? (s.count > 1 ? plural(t) : t) : 'something'}`;
    case 'break': return s.count > 1 ? `Break ${s.count} things` : `Break something${t ? ' of ' + t : ''}`;
    case 'fell': return `Fell ${s.count > 1 ? s.count + ' trees' : 'a tree'}`;
    case 'cast': return `Cast ${s.distinct ? n + 'different spells' : n + (t || 'spells')}`;
    case 'use-weapon': return `Use ${s.distinct ? n + 'different weapons' : t || 'a weapon'}`;
    case 'reach': return `Reach the ${t || 'place'}`;
    case 'explore': return `Travel ${s.count} metres`;
    case 'ride': return `Ride for ${s.count} seconds`;
    case 'fly': return `Fly for ${s.count} seconds`;
    case 'talk': return `Speak with ${t || 'someone'}`;
    case 'collect': return `Collect ${t || 'the relic'}`;
    case 'deliver': return 'Carry the relic to its place';
    case 'ask': return 'Make a wish';
    case 'conjure': return 'Conjure a new model';
    case 'mixed-reality': return 'Stand in mixed reality';
    default: return 'Complete the task';
  }
}
function cleanStep(s) {
  if (!isObj(s)) return null;
  const type = norm(s.type);
  if (!STEP_TYPES.includes(type)) return null;
  const o = { type };
  o.count = clamp(Math.floor(num(s.count, 1)), 1, COUNT_MAX[type] ?? 100);
  if (type === 'stat') o.count = Math.max(1, Math.floor(num(s.count, 1)));
  if (s.target !== undefined && s.target !== null) {
    if (Array.isArray(s.target)) o.target = s.target.slice(0, 8).map((x) => String(x).slice(0, 60));
    else o.target = typeof s.target === 'string' ? s.target.slice(0, 60) : String(s.target).slice(0, 60);
  }
  const where = cleanWhere(s.where); if (where !== undefined) o.where = where;
  if (typeof s.weapon === 'string') o.weapon = s.weapon.slice(0, 40);
  if (typeof s.kind === 'string') o.kind = s.kind.slice(0, 20);
  if (s.noHurt) o.noHurt = true;
  if (s.when === 'night' || s.when === 'day' || s.when === 'mr') o.when = s.when;
  if (s.distinct) o.distinct = s.distinct === 'category' ? 'category' : true;
  if (type === 'use-weapon') o.mode = s.mode === 'hit' || s.mode === 'fire' ? s.mode : 'grab';
  if (s.radius !== undefined) o.radius = clamp(num(s.radius, 8), 2, 200);
  if (type === 'custom' && typeof s.site === 'string') o.site = norm(s.site).slice(0, 16);      // a start-zone site the module watches itself: brazier | dummies | sky
  if (type === 'talk' && s.near !== undefined) o.near = clamp(num(s.near, 3.5), 1.5, 12);       // walking up to the person counts as speaking with them
  const sp = cleanSpawn(s.spawn); if (sp) o.spawn = sp;
  o.text = (typeof s.text === 'string' && s.text.trim() ? s.text.trim() : defaultText(o)).slice(0, 90);
  return o;
}
function cleanSpec(spec, kind, xpCap) {
  if (!isObj(spec) || !Array.isArray(spec.steps)) return null;
  const steps = spec.steps.slice(0, 6).map(cleanStep).filter(Boolean);
  if (!steps.length) return null;
  const title = (typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : 'A Labour').slice(0, 60);
  const r = isObj(spec.rewards) ? spec.rewards : {};
  const rewards = { xp: clamp(Math.round(num(r.xp, 100)), 0, xpCap), favour: clamp(num(r.favour, 2), -5, 10) };
  if (typeof r.title === 'string' && r.title.trim()) rewards.title = r.title.trim().slice(0, 24);
  if (typeof r.unlock === 'string' && r.unlock.trim()) rewards.unlock = norm(r.unlock).slice(0, 30);
  if (typeof r.spawn === 'string' && r.spawn.trim()) rewards.spawn = r.spawn.trim().slice(0, 40);
  const def = {
    id: '', kind, giver: (typeof spec.giver === 'string' && spec.giver.trim() ? spec.giver.trim() : 'Omnissiah').slice(0, 30),
    title, description: (typeof spec.description === 'string' ? spec.description.trim() : '').slice(0, 220), steps, rewards,
  };
  if (spec.expires !== undefined && isFinite(spec.expires)) def.expires = +spec.expires;
  return def;
}

// ---------------------------------------------------------------------------------------------------- profile shape, migration
function freshProfile() {
  const t = Date.now();
  return {
    v: SCHEMA, id: Math.random().toString(36).slice(2, 10), created: t, updated: 0, lastSeen: t,
    xp: 0, level: 1, favour: 20,
    stats: {
      kills: 0, killsBy: {}, killsWith: {}, bosses: 0, bossNames: {}, deaths: 0, friendlyKills: 0,
      summoned: 0, summonedBy: {}, summonedCat: {}, broken: 0, brokenBy: {}, felled: 0,
      walked: 0, flown: 0, driven: 0, spellCasts: 0, spells: {}, weapons: {}, weaponHits: 0,
      wishes: 0, models: 0, creations: 0, talks: 0, playSec: 0, sessions: 0, quests: 0, bountiesDone: 0, flawless: 0, streak: 0,
    },
    disc: { e: {}, w: {}, s: {} },
    titles: ['wanderer'], ctitles: {}, title: null,
    q: {}, offered: {}, gen: {}, pinned: null, bountyDay: '', bountyCount: 0, unlocks: {},
    settings: { auto: true, tracker: true }, log: [],
  };
}
function deepFill(def, src) {
  if (Array.isArray(def)) return Array.isArray(src) ? src : def.slice();
  if (isObj(def)) {
    const out = isObj(src) ? { ...src } : {};
    for (const k of Object.keys(def)) out[k] = k in out ? deepFill(def[k], out[k]) : (isObj(def[k]) ? deepFill(def[k], undefined) : Array.isArray(def[k]) ? def[k].slice() : def[k]);
    return out;
  }
  return typeof def === typeof src && (typeof def !== 'number' || isFinite(src)) ? src : def;
}
// raw (unknown JSON) -> a valid current-schema profile, or null when it is not a profile at all. Unknown fields are kept.
function migrate(raw) {
  if (!isObj(raw)) return null;
  let p = { ...raw };
  const v = isFinite(p.v) ? p.v : 0;
  if (v < 1) {
    // pre-release layout: flat counters at the top level and quests as { id: 'done' | 'active' }
    const s = isObj(p.stats) ? { ...p.stats } : {};
    for (const k of ['kills', 'deaths', 'broken', 'felled', 'wishes', 'summoned']) if (typeof p[k] === 'number' && s[k] === undefined) { s[k] = p[k]; delete p[k]; }
    p.stats = s;
    if (isObj(p.quests) && !isObj(p.q)) {
      p.q = {};
      for (const [id, val] of Object.entries(p.quests)) p.q[id] = typeof val === 'string' ? { s: val === 'done' ? 'done' : 'active', i: 0, p: [], a: null } : val;
      delete p.quests;
    }
  }
  p = deepFill(freshProfile(), p);
  p.v = Math.max(SCHEMA, v);
  p.xp = Math.max(0, Math.floor(p.xp)); p.level = levelForXp(p.xp);
  p.favour = clamp(p.favour, 0, 100);
  if (!Array.isArray(p.titles) || !p.titles.includes('wanderer')) p.titles = ['wanderer', ...(Array.isArray(p.titles) ? p.titles : [])];
  if (!Array.isArray(p.log)) p.log = [];
  return p;
}

// =====================================================================================================================
// The module
// =====================================================================================================================
export default function (ctx) {
  const THREE = ctx.THREE;
  const S = ctx.state;                         // survives hot reloads: the profile, runtime flags, applied perks
  const world = ctx.world;
  const events = ctx.events;
  const DOM = typeof document !== 'undefined' && !!document.createElement;
  const wall = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000);
  const T = () => (ctx.clock ? ctx.clock.t : 0);
  const warn = (...a) => { try { console.warn('[quests]', ...a); } catch (e) { /* no console */ } };

  S.rt = {};                                    // per-quest runtime (spawn handles, relic): bound to the previous ctx, so rebuilt after a reload
  S.fv ??= {};                                  // favour diminishing-returns bookkeeping
  S.applied ??= { P: null, speed: 0, regen: 0, maxHealth: 0 };
  S.mode ??= 'pending';                         // pending | server | local
  S.pendingOps ??= [];
  const ps = S.pd ??= { dirty: false, lastChange: 0, dirtySince: 0, lastSave: 0, loadReq: 0, deadline: 0, synced: false };
  const L = (S.listeners ??= {});               // quests.on(evt, fn) subscribers
  let defs = new Map();
  let activeIds = [];
  let trackerOn = true;
  const prof = () => S.profile;

  // ------------------------------------------------------------------ events out
  const GLOBAL = { started: 'quest:started', progress: 'quest:progress', completed: 'quest:completed', levelup: 'player:levelup', title: 'player:title', abandoned: 'quest:abandoned', favour: 'quest:favour' };
  function fire(evt, payload) {
    try { events.emit(GLOBAL[evt] ?? evt, payload); } catch (e) { warn('emit failed', e); }
    const ls = L[evt];
    if (ls) for (const fn of ls.slice()) { try { fn(payload); } catch (e) { warn('listener failed', e); } }
  }

  // ------------------------------------------------------------------ log / recent / commentary
  function logNote(text) {
    const p = prof(); if (!p) return;
    p.log.push({ t: Date.now(), x: String(text).slice(0, 80) });
    if (p.log.length > 12) p.log.splice(0, p.log.length - 12);
  }
  function note(line, dramatic) { try { world.commentary?.note?.(line, { dramatic: !!dramatic }); } catch (e) { /* commentary reloading */ } }
  const toast = (text, sec = 3) => { try { ctx.hud?.show?.(text, sec); } catch (e) { /* hud missing */ } };

  // ------------------------------------------------------------------ persistence
  function markDirty(urgent) {
    const w = wall();
    if (!ps.dirty) ps.dirtySince = w;
    ps.dirty = true; ps.lastChange = w;
    if (urgent) ps.lastChange = w - 100;          // the debounce window is already over: save on the next update
  }
  function saveNow() {
    const p = prof(); if (!p) return false;
    p.updated = Date.now(); p.lastSeen = p.updated;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ }
    let sent = false;
    try { sent = !!(ctx.net && ctx.net.send({ type: 'save_set', key: SAVE_KEY, data: p })); } catch (e) { sent = false; }
    if (sent) { ps.dirty = false; ps.lastSave = wall(); }
    return sent;
  }
  function requestLoad() {
    let ok = false;
    try { ok = !!(ctx.net && ctx.net.send({ type: 'save_get', key: SAVE_KEY })); } catch (e) { ok = false; }
    if (ok) ps.loadReq = wall();
    return ok;
  }
  function readLocal() {
    try { const t = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null; return t ? migrate(JSON.parse(t)) : null; } catch (e) { return null; }
  }
  // Server (or fallback) data arrives. Chooses the freshest of what we hold and what the server holds.
  function adopt(data, source) {
    const incoming = migrate(data);
    const cur = S.profile;
    if (!S.loaded) {
      let p = incoming;
      const local = readLocal();
      if (local && (!p || num(local.updated) > num(p.updated))) p = local;       // server had nothing (or an older copy): the browser mirror wins
      S.profile = p ?? freshProfile();
      S.loaded = true;
      S.mode = source;
      const away = (Date.now() - num(S.profile.lastSeen, Date.now())) / 86400000;  // days away: favour fades a little
      if (away > 0.25 && S.profile.favour > 10) S.profile.favour = Math.max(10, S.profile.favour - Math.min(8, away * 1.5));
      S.profile.stats.sessions++;
      postLoad(true);
      if (!incoming || source === 'local' || (local && local === S.profile)) markDirty(true); // make sure the server gets it
    } else if (incoming && cur) {
      // a late reply after a fallback: a memory-only session adopts the server copy; otherwise the newer one wins
      if (S.mode === 'memory' || (num(incoming.updated) > num(cur.updated) + 1000 && !ps.dirty)) { S.profile = incoming; S.mode = source; postLoad(false); }
      else markDirty(true);                                                     // we are newer: push ours
    } else if (!incoming) markDirty(true);
    if (source === 'server') { S.mode = 'server'; ps.synced = true; }
    if (ps.dirty) ps.lastChange = wall() - 100;                                // push the first save promptly
  }

  // ------------------------------------------------------------------ definitions
  function rebuildDefs() {
    const p = prof();
    defs = new Map();
    for (const d of STARTERS) defs.set(d.id, d);
    if (p) {
      for (const [id, d] of Object.entries(p.offered)) if (isObj(d) && Array.isArray(d.steps)) defs.set(id, { ...d, id, kind: 'omnissiah' });
      for (const [id, d] of Object.entries(p.gen)) if (isObj(d) && Array.isArray(d.steps)) defs.set(id, { ...d, id, kind: 'bounty' });
    }
  }
  function refreshActive() {
    const p = prof();
    activeIds = [];
    if (!p) return;
    for (const id of Object.keys(p.q)) if (p.q[id].s === 'active' && defs.has(id)) activeIds.push(id);
    trackerDirty = true;
  }
  const questOf = (id) => prof()?.q[id];
  function isAvailable(def) {
    const p = prof(); const Q = p.q[def.id];
    if (Q && (Q.s === 'active' || Q.s === 'done')) return false;
    if (def.minLevel && p.level < def.minLevel) return false;
    for (const a of def.after || []) if (p.q[a]?.s !== 'done') return false;
    for (const n of def.needs || []) if (!world[n]) return false;
    if (def.expires && Date.now() > def.expires) return false;
    return true;
  }

  // ------------------------------------------------------------------ catalogue (live library when present)
  let catCache = null, catCount = -1;
  function catalogue() {
    const lib = world.library;
    let n = -1;
    try { n = lib?.count?.() ?? -1; } catch (e) { n = -1; }
    if (catCache && n === catCount) return catCache;
    const byCat = {}, catOf = new Map();
    let list = null;
    try { list = lib?.list?.(); } catch (e) { list = null; }
    if (Array.isArray(list) && list.length) {
      for (const e of list) { (byCat[e.category] ??= []).push(e.name); catOf.set(e.name, e.category); }
    } else {
      for (const [c, names] of Object.entries(FALLBACK_LIB)) { byCat[c] = names.slice(); for (const nm of names) catOf.set(nm, c); }
    }
    catCache = { byCat, catOf }; catCount = n;
    return catCache;
  }
  const catOfName = (name) => catalogue().catOf.get(name) ?? catalogue().catOf.get(norm(name)) ?? '';

  // ------------------------------------------------------------------ places
  const _pl = { x: 0, z: 0, r: 8, ok: false };
  function placeOf(where, Q, step) {
    _pl.ok = false;
    if (where === undefined || where === null) return _pl;
    const px = ctx.player.feet.x, pz = ctx.player.feet.z;
    if (typeof where === 'string') {
      if (where === 'lake') {
        const lk = world.env?.lake ?? { x: -30, z: -78, radius: 38 };
        _pl.x = lk.x; _pl.z = lk.z; _pl.r = Math.min(num(lk.radius, 38) * 0.75, 26); _pl.ok = true;
      } else if (where === 'stones') {
        let best = 1e18;
        for (const c of STONES) { const d = (c[0] - px) ** 2 + (c[1] - pz) ** 2; if (d < best) { best = d; _pl.x = c[0]; _pl.z = c[1]; _pl.r = c[2]; } }
        _pl.ok = true;
      } else if (where === 'origin') { _pl.x = 0; _pl.z = 0; _pl.r = 7; _pl.ok = true; }
      else if (where === 'oracle') {
        const o = world.oracle?.position;
        if (o) { _pl.x = o.x; _pl.z = o.z; _pl.r = 14; _pl.ok = true; }
      } else if (where === 'spawn') {
        if (Q?.a) { _pl.x = Q.a[0]; _pl.z = Q.a[1]; _pl.r = num(step?.radius, 14); _pl.ok = true; }
      } else if (where.startsWith('sz-')) {                          // a station of the start zone: sz-campfire, sz-shrine, sz-lakeside (the jetty) ...
        const pt = szPoint(where.slice(3));
        if (pt) { _pl.x = pt.x; _pl.z = pt.z; _pl.r = where === 'sz-lakeside' ? 6 : 5; _pl.ok = true; }
      }
    } else if (Array.isArray(where)) { _pl.x = where[0]; _pl.z = where[1]; _pl.r = num(where[2], 8); _pl.ok = true; }
    else if (isObj(where)) { _pl.x = where.x; _pl.z = where.z; _pl.r = num(where.radius, 8); _pl.ok = true; }
    if (_pl.ok && step && typeof step.radius === 'number') _pl.r = step.radius;
    return _pl;
  }
  // the spot a step's beacon / area filter refers to
  function stepPlace(def, Q, step) {
    if (step.where !== undefined) return placeOf(step.where, Q, step);
    if (step.type === 'custom' && step.site) {
      const pt = sitePoint(step.site, def.id);
      if (pt) { _pl.x = pt.x; _pl.z = pt.z; _pl.r = 4; _pl.ok = true; return _pl; }
      _pl.ok = false; return _pl;
    }
    if (step.spawn && Q?.a) return placeOf('spawn', Q, step);
    _pl.ok = false;
    return _pl;
  }

  // ------------------------------------------------------------------ XP / levels / favour
  function grantXp(n, why, quiet) {
    const p = prof(); if (!p) return 0;
    n = Math.round(num(n)); if (!n) return 0;
    const before = p.level;
    p.xp = Math.max(0, p.xp + n);
    const after = levelForXp(p.xp);
    p.level = after;
    if (after > before) {
      for (let lv = before + 1; lv <= after; lv++) onLevelUp(lv, lv - 1);
      markDirty(true);
    } else markDirty();
    trackerDirty = true;
    return n;
  }
  function onLevelUp(level, prev) {
    const a = perksFor(prev, prof().favour), b = perksFor(level, prof().favour);
    applyPerks();
    try { world.player?.heal?.(9999); } catch (e) { /* no player */ }
    logNote(`reached level ${level}`);
    const parts = [];
    if (b.maxHealth > a.maxHealth) parts.push(`+${b.maxHealth - a.maxHealth} health`);
    if (b.regen > a.regen + 0.001) parts.push('quicker healing');
    if (b.speed > a.speed + 0.001) parts.push('swifter stride');
    if (b.favouriteSlots > a.favouriteSlots) parts.push(`spell favourite #${b.favouriteSlots}`);
    if (b.allyHpMul > a.allyHpMul) parts.push('sturdier allies');
    pushBanner({ kind: 'level', head: 'LEVEL UP', title: `Level ${level}`, sub: parts.join('   ') || title() || '', level });
    fire('levelup', { level, previous: prev });
    note(`The player reached level ${level}${title() ? ` and is known as ${title()}` : ''}.`, true);
    celebrate(true);
    checkTitles(false);
  }
  function gainFavour(key, amount) {                // amount with diminishing returns for repeating the same thing
    const k = (S.fv[key] ??= { n: 0, t: T() });
    const t = T();
    k.n = Math.max(0, k.n - (t - k.t) / 90); k.t = t;
    const eff = amount / (1 + k.n * 0.6);
    k.n += 1;
    addFavour(eff, key, true);
  }
  function addFavour(n, why, quiet) {
    const p = prof(); if (!p) return 0;
    n = num(n); if (!n) return 0;
    const before = p.favour, bandBefore = regardOf(before);
    p.favour = clamp(p.favour + n, 0, 100);
    if (p.favour === before) return 0;
    markDirty(); trackerDirty = true;
    const bandAfter = regardOf(p.favour);
    if (bandAfter !== bandBefore) {
      applyPerks();
      logNote(`the Omnissiah's regard became ${bandAfter}`);
      note(`The Omnissiah's favour toward the player ${p.favour > before ? 'rose' : 'fell'} to ${bandAfter} (${Math.round(p.favour)} of 100).`, false);
      fire('favour', { favour: p.favour, regard: bandAfter });
    }
    return p.favour - before;
  }
  const title = () => {
    const p = prof(); if (!p) return '';
    if (p.title) { const d = titleDef(p.title); if (d && p.titles.includes(p.title)) return d.name; }
    let best = null;
    for (const id of p.titles) { const d = titleDef(id); if (d && (!best || d.rank > best.rank)) best = d; }
    return best ? best.name : '';
  };
  function titleDef(id) {
    const t = TITLES.find((x) => x.id === id);
    if (t) return t;
    const c = prof()?.ctitles[id];
    return c ? { id, name: c.name, rank: c.rank ?? 30 } : null;
  }
  function checkTitles(quiet) {
    const p = prof(); if (!p) return;
    for (const t of TITLES) {
      if (p.titles.includes(t.id)) continue;
      let ok = false;
      try { ok = t.test(p); } catch (e) { ok = false; }
      if (ok) awardTitle(t.id, t.name, quiet);
    }
  }
  function awardTitle(id, name, quiet) {
    const p = prof();
    if (p.titles.includes(id)) return false;
    p.titles.push(id);
    markDirty(true);
    if (!quiet) {
      logNote(`earned the title ${name}`);
      pushBanner({ kind: 'title', head: 'TITLE EARNED', title: name, sub: 'The Omnissiah will remember it' });
      fire('title', { id, title: name });
      note(`The player earned the title "${name}".`, true);
      celebrate(false);
    }
    return true;
  }

  // ------------------------------------------------------------------ perks (applied through the existing world.player API; re-applied after reloads)
  let perkNow = perksFor(1, 20);
  function applyPerks() {
    const p = prof(); if (!p) return perkNow;
    perkNow = perksFor(p.level, p.favour);
    const P = world.player;
    if (!P) return perkNow;
    const A = S.applied;
    if (A.P !== P) {
      A.speed = 0; A.regen = 0;                    // a new player.js instance starts from its defaults (max health lives in its ctx.state and survives)
      if (!A.P) A.maxHealth = 0;                   // first application on this page
      A.P = P;
    }
    if (typeof P.speed === 'number') { const d = perkNow.speed - A.speed; if (d) { P.speed += d; A.speed = perkNow.speed; } }
    if (typeof P.regen === 'number') { const d = perkNow.regen - A.regen; if (d) { P.regen += d; A.regen = perkNow.regen; } }
    if (typeof P.maxHealth === 'number') {
      const d = perkNow.maxHealth - A.maxHealth;
      if (d) { P.maxHealth += d; if (d > 0 && P.alive !== false) P.health = Math.min(P.maxHealth, (P.health ?? 0) + d); A.maxHealth = perkNow.maxHealth; }
    }
    try { world.spells?.setFavouriteSlots?.(perkNow.favouriteSlots); } catch (e) { /* not supported */ }
    return perkNow;
  }
  let allyScanT = 0;
  function boostAllies() {
    const C = world.combat, mul = perkNow.allyHpMul;
    if (!C || !C.fighters || mul <= 1) return;
    const fs = C.fighters;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!f || f.faction !== 'friendly' || f._qb) continue;
      f._qb = true;
      // A fighter's hp/maxHp are read-only views of its damageable (f.damage): scale that instead.
      try {
        const d = f.damage;
        if (d && typeof d.maxHp === 'number' && typeof d.hp === 'number') { d.maxHp *= mul; d.hp *= mul; }
      } catch (e) { /* a perk must never break quest tracking */ }
    }
  }

  // ------------------------------------------------------------------ feedback: sound, oracle, banners
  let snd = null;
  const sound = () => { try { return (snd ??= world.kit?.sound?.(ctx, { volume: 0.9 }) ?? null); } catch (e) { return null; } };
  function celebrate(big) {
    try { world.oracle?.flare?.(big ? 0xffd877 : 0xffc24a, big ? 1.4 : 0.9); } catch (e) { /* oracle reloading */ }
    try { const f = ctx.player.feet; world.oracle?.beamTo?.([f.x, f.y, f.z], { color: 0xffd877, duration: big ? 2.4 : 1.6 }); } catch (e) { /* ignore */ }
    let played = false;
    if (!big) { try { if (typeof world.audio?.sfx === 'function') { world.audio.sfx('quest-complete'); played = true; } } catch (e) { played = false; } }
    if (!played) {
      const s = sound();
      if (s) {
        try { s.chord(big ? [392, 523, 659, 784, 1046] : [523, 659, 784, 1046], { dur: big ? 1.4 : 1.1, type: 'triangle', vol: 0.22, stagger: 0.09 }); } catch (e) { /* kit reloading */ }
      }
    }
  }
  function tick(freq = 880) { const s = sound(); if (s) { try { s.tone({ freq, freqEnd: freq * 1.5, dur: 0.14, type: 'triangle', vol: 0.12 }); } catch (e) { /* ignore */ } } }

  // =====================================================================================================================
  // Visuals: tracker (head-locked, lower left), banner (head-locked, upper centre), beacon + distance label (world)
  // =====================================================================================================================
  const FONT = UI.font;
  const GOLD = UI.color.gold, GOLD2 = UI.color.goldEdge, INK = UI.color.text, MUTE = UI.color.dim;
  let trackerDirty = true;
  const own = [];                                   // things to dispose by hand (camera children live outside root)
  const track = (o) => { own.push(o); return o; };
  function makeCanvasMesh(w, h, planeW, order) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const tex = track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(planeW, planeW * h / w)), mat);
    mesh.renderOrder = order; mesh.frustumCulled = false; mesh.visible = false;
    mesh.userData.noShadow = true; mesh.userData.noOutline = true;
    return { cv, g, tex, mat, mesh };
  }
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function diamond(g, cx, cy, s, fill) { g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.closePath(); g.fillStyle = fill; g.fill(); }
  function star(g, cx, cy, R, fill) {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? R * 0.38 : R; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = fill; g.fill();
  }
  function arrow(g, cx, cy, s, ang, fill) {                    // ang: 0 = up, clockwise
    g.save(); g.translate(cx, cy); g.rotate(ang);
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.72, s * 0.7); g.lineTo(0, s * 0.3); g.lineTo(-s * 0.72, s * 0.7); g.closePath();
    g.fillStyle = fill; g.fill(); g.restore();
  }
  const glass = UI.glass;
  function wrapText(g, text, maxW, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean), out = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (line && g.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    if (out.length > maxLines) {
      out.length = maxLines;
      let last = out[maxLines - 1];
      while (last.length > 1 && g.measureText(last + '...').width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last + '...';
    }
    return out;
  }
  function fit(g, text, maxW) {
    let t = String(text);
    if (g.measureText(t).width <= maxW) return t;
    while (t.length > 1 && g.measureText(t + '...').width > maxW) t = t.slice(0, -1);
    return t + '...';
  }
  function spaced(g, text, x, y, sp, align) {                  // letter-spaced text without relying on ctx.letterSpacing
    let w = 0; const ws = [];
    for (const ch of text) { const cw = g.measureText(ch).width; ws.push(cw); w += cw + sp; }
    w -= sp;
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const old = g.textAlign; g.textAlign = 'left';
    let i = 0;
    for (const ch of text) { g.fillText(ch, cx, y); cx += ws[i++] + sp; }
    g.textAlign = old;
  }

  // ---- tracker -------------------------------------------------------------------------------------------------
  let trk = null, bnr = null, beacon = null, beaconMat = null, label = null, trkFollow = null, bnrFollow = null;
  const TW = 640, TH = 300;
  const tv = { title: '', kind: 'story', step: 0, steps: 1, text: '', prog: 0, count: 1, dist: -1, arrow: 0, level: 1, xpFrac: 0, favour: 20, fadeMul: 1, key: '' };
  let trkFade = 0;
  function setupVisuals() {
    if (!DOM || trk) return;
    try {
      // Both ride on hud.follow: a headset sees them trail the head softly (a glance does not drag them along), a flat screen locks them to the
      // view. The tracker sits low and to the left (peripheral, never in the middle of the view); the banner appears above the horizon.
      trk = makeCanvasMesh(TW, TH, 0.46, 9000);
      trk.mesh.name = 'quest-tracker';
      bnr = makeCanvasMesh(1024, 300, 0.96, 9100);
      bnr.mesh.name = 'quest-banner';
      const F = ctx.hud?.follow;
      if (F) {
        trkFollow = F(trk.mesh, { yaw: 0.52, pitch: -0.05, distance: 1.15 });
        bnrFollow = F(bnr.mesh, { yaw: 0, pitch: 0.24, distance: 1.3, stiffness: 10 });
      } else { // an older hud: head-locked as before
        trk.mesh.position.set(-0.45, -0.31, -1.15); trk.mesh.rotation.set(0, 0.16, 0); ctx.camera.add(trk.mesh);
        bnr.mesh.position.set(0, 0.3, -1.3); ctx.camera.add(bnr.mesh);
      }
      // beacon: soft gold column + a ground ring, vertex-alpha, one draw call
      beaconMat = track(new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      }));
      beacon = new THREE.Mesh(track(makeBeaconGeo()), beaconMat);
      beacon.name = 'quest-beacon'; beacon.frustumCulled = false; beacon.visible = false; beacon.renderOrder = 30;
      beacon.userData.noShadow = true; beacon.userData.noOutline = true;
      ctx.root.add(beacon);
      label = makeCanvasMesh(256, 96, 2.4, 31);
      label.mesh.name = 'quest-distance';
      label.mesh.material.depthTest = true;
      ctx.root.add(label.mesh);
    } catch (e) { warn('visuals unavailable', e); trk = null; }
    ctx.onDispose(disposeVisuals);
  }
  function makeBeaconGeo() {
    const SEG = 14, H = 70, levels = [[0, 0.5], [H * 0.15, 0.3], [H * 0.5, 0.1], [H, 0]];
    const pos = [], col = [], idx = [];
    for (const [y, a] of levels) for (let s = 0; s < SEG; s++) { const an = (s / SEG) * Math.PI * 2; pos.push(Math.cos(an), y, Math.sin(an)); col.push(1, 0.62, 0.18, a); }
    for (let l = 0; l < levels.length - 1; l++) for (let s = 0; s < SEG; s++) {
      const a = l * SEG + s, b = l * SEG + ((s + 1) % SEG), c = (l + 1) * SEG + s, d = (l + 1) * SEG + ((s + 1) % SEG);
      idx.push(a, c, b, b, c, d);
    }
    const base = pos.length / 3, RS = 28;
    for (const [r, a] of [[1.5, 0], [1.9, 0.9], [2.4, 0.9], [3.4, 0]]) for (let s = 0; s < RS; s++) { const an = (s / RS) * Math.PI * 2; pos.push(Math.cos(an) * r, 0.06, Math.sin(an) * r); col.push(1, 0.62, 0.18, a); }
    for (let l = 0; l < 3; l++) for (let s = 0; s < RS; s++) {
      const a = base + l * RS + s, b = base + l * RS + ((s + 1) % RS), c = base + (l + 1) * RS + s, d = base + (l + 1) * RS + ((s + 1) % RS);
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    return g;
  }
  function disposeVisuals() {
    try { ctx.hud?.present?.cancelOwner(ctx.path); } catch (e) { /* hud gone */ }
    trkFollow?.stop(); bnrFollow?.stop();
    for (const m of [trk?.mesh, bnr?.mesh]) m?.removeFromParent();
    beacon?.removeFromParent(); label?.mesh.removeFromParent();
    for (const o of own) { try { o.dispose?.(); } catch (e) { /* ignore */ } }
    own.length = 0; trk = bnr = beacon = label = trkFollow = bnrFollow = null;
  }

  // Step texts are written for the headset ("Hold the left trigger..."); on a flat screen show the keys and the mouse instead.
  const DESK_WORDS = [[/hold the left trigger/gi, 'Hold T'], [/\bleft trigger\b/gi, 'T'], [/\bright trigger\b/gi, 'left mouse'], [/\bright A\b/g, 'E'], [/with a squeeze/gi, 'with G or right mouse']];
  function devText(text) {
    if (ctx.input?.presenting || !text) return text;
    let s = String(text);
    for (const [re, to] of DESK_WORDS) s = s.replace(re, to);
    return s;
  }
  const ARROWS = 16;
  function drawTracker() {
    const g = trk.g, v = tv;
    g.clearRect(0, 0, TW, TH);
    glass(g, TW, TH, 30);
    g.textBaseline = 'alphabetic';
    // header row
    diamond(g, 40, 47, 8, v.kind === 'bounty' ? '#7fe3ff' : GOLD);
    g.font = `700 27px ${FONT}`; g.fillStyle = v.kind === 'bounty' ? '#7fe3ff' : GOLD;
    spaced(g, v.kind === 'bounty' ? 'BOUNTY' : 'LABOUR', 58, 56, 4, 'left');
    if (v.steps > 1) { g.font = `600 27px ${FONT}`; g.fillStyle = MUTE; g.textAlign = 'left'; g.fillText(`${v.step + 1}/${v.steps}`, 222, 57); }
    g.font = `700 28px ${FONT}`; g.fillStyle = INK; g.textAlign = 'right';
    const lvTxt = `Lv ${v.level}`, lvW = g.measureText(lvTxt).width;
    g.fillText(lvTxt, TW - 34, 56);
    const fvTxt = String(Math.round(v.favour));
    g.font = `600 26px ${FONT}`; g.fillStyle = MUTE;
    const fvRight = TW - 34 - lvW - 26, fvW = g.measureText(fvTxt).width;
    g.fillText(fvTxt, fvRight, 56);
    star(g, fvRight - fvW - 16, 47, 10, GOLD);
    // title
    g.textAlign = 'left';
    g.font = `700 39px ${FONT}`; g.fillStyle = GOLD;
    g.shadowColor = 'rgba(255,170,40,0.45)'; g.shadowBlur = 8;
    g.fillText(fit(g, v.title, TW - 70), 34, 106);
    g.shadowBlur = 0;
    // step text, up to two lines
    g.font = `500 31px ${FONT}`; g.fillStyle = INK;
    const lines = wrapText(g, v.text, TW - 70, 2);
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 34, 152 + i * 38);
    // progress row
    const y = 232;
    let x0 = 34;
    if (v.dist >= 0) {
      g.fillStyle = 'rgba(255,216,119,0.14)'; rr(g, x0, y - 24, 164, 36, 18); g.fill();
      arrow(g, x0 + 22, y - 6, 12, (v.arrow / ARROWS) * Math.PI * 2, GOLD);
      g.font = `700 25px ${FONT}`; g.fillStyle = GOLD; g.textAlign = 'left';
      g.fillText(v.dist >= 1000 ? `${(v.dist / 1000).toFixed(1)} km` : `${v.dist} m`, x0 + 44, y + 2);
      x0 += 180;
    }
    if (v.count > 1) {
      const right = TW - 34, tw = 120;
      g.font = `700 27px ${FONT}`; g.fillStyle = INK; g.textAlign = 'right';
      const label2 = v.count >= 1000 ? `${v.prog}/${v.count}` : `${v.prog} / ${v.count}`;
      g.fillText(label2, right, y + 2);
      const bx = x0, bw = right - tw - bx + 10;
      if (bw > 40) {
        rr(g, bx, y - 18, bw, 20, 10); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
        const f = clamp(v.prog / v.count, 0, 1);
        if (f > 0) {
          const fg = g.createLinearGradient(bx, 0, bx + bw, 0); fg.addColorStop(0, GOLD2); fg.addColorStop(1, '#ffe9a8');
          rr(g, bx, y - 18, Math.max(20, bw * f), 20, 10); g.fillStyle = fg; g.fill();
        }
      }
    }
    // xp strip
    rr(g, 34, TH - 34, TW - 68, 7, 3.5); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill();
    if (v.xpFrac > 0) { rr(g, 34, TH - 34, Math.max(7, (TW - 68) * v.xpFrac), 7, 3.5); g.fillStyle = '#9d8cff'; g.fill(); }
    g.textAlign = 'left';
    trk.tex.needsUpdate = true;
  }

  // the pinned quest's current step -> tracker values; returns false when there is nothing to show
  const _view = { def: null, Q: null, step: null };
  function pinnedView() {
    const p = prof(); if (!p) return false;
    let id = p.pinned;
    if (!id || !defs.has(id) || p.q[id]?.s !== 'active') {
      id = activeIds.find((x) => !defs.get(x)?.passive) ?? null;
      p.pinned = id;
    }
    if (!id) return false;
    _view.def = defs.get(id); _view.Q = p.q[id]; _view.step = _view.def.steps[_view.Q.i] ?? null;
    return !!_view.step;
  }
  const _tmpV = new THREE.Vector3(), _tq = new THREE.Quaternion();
  let distBucket = -1, arrowBucket = -1;
  function updateTrackerValues() {
    const p = prof();
    if (!pinnedView()) { tv.key = ''; return false; }
    const { def, Q, step } = _view;
    tv.title = def.title; tv.kind = def.kind === 'bounty' ? 'bounty' : 'story'; tv.step = Q.i; tv.steps = def.steps.length;
    tv.text = devText(step.text); tv.count = step.count; tv.prog = Math.min(step.count, Q.p[Q.i] | 0);
    tv.level = p.level; tv.favour = p.favour;
    const lo = xpForLevel(p.level), hi = xpForLevel(p.level + 1);
    tv.xpFrac = p.level >= LV_MAX ? 1 : clamp((p.xp - lo) / Math.max(1, hi - lo), 0, 1);
    tv.dist = -1;
    const target = beaconTarget();
    if (target) {
      const f = ctx.player.feet;
      const d = Math.hypot(target.x - f.x, target.z - f.z);
      tv.dist = d < 1000 ? Math.round(d / (d > 60 ? 5 : 1)) * (d > 60 ? 5 : 1) : Math.round(d / 100) * 100;
      const h = ctx.player.forward;
      let ang = Math.atan2(target.x - f.x, -(target.z - f.z)) - Math.atan2(h.x, -h.z);
      ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      tv.arrow = Math.round((ang / (Math.PI * 2)) * ARROWS) % ARROWS;
    }
    const key = `${def.id}|${Q.i}|${tv.prog}|${tv.dist}|${tv.arrow}|${p.level}|${Math.round(tv.xpFrac * 60)}|${Math.round(p.favour)}|${ctx.input?.presenting ? 1 : 0}`;
    if (key !== tv.key) { tv.key = key; return true; }
    return false;
  }

  // ---- beacon target ---------------------------------------------------------------------------------------------
  const _bt = { x: 0, z: 0, r: 0, on: false };
  function beaconTarget() {
    if (!pinnedView()) return null;
    const { def, Q, step } = _view;
    const rt = S.rt[def.id];
    if (step.type === 'collect' && !step.target && rt?.relic?.body) {
      const b = rt.relic.body.position; _bt.x = b.x; _bt.z = b.z; _bt.r = 2; return _bt;
    }
    if (step.type === 'deliver' && rt?.relic?.body && !rt.grabbed) {
      const b = rt.relic.body.position; _bt.x = b.x; _bt.z = b.z; _bt.r = 2; return _bt;
    }
    const pl = stepPlace(def, Q, step);                     // an explicit place, or the spot the step's quarry was spawned at
    if (pl.ok) { _bt.x = pl.x; _bt.z = pl.z; _bt.r = pl.r; return _bt; }
    return null;
  }
  let beaconPulse = 0, labelMeters = -2;
  function updateBeacon(dt) {
    if (!beacon) return;
    const tgt = trackerOn && prof()?.settings.tracker !== false && !world.env?.passthrough ? beaconTarget() : null;
    if (!tgt) { beacon.visible = false; label.mesh.visible = false; return; }
    const f = ctx.player.feet;
    const d = Math.hypot(tgt.x - f.x, tgt.z - f.z);
    const arrived = d < tgt.r;
    beaconPulse += dt;
    const gy = ctx.groundAt(tgt.x, tgt.z);
    const w = clamp(d * 0.008, 0.4, 2.2);
    beacon.position.set(tgt.x, gy - 0.1, tgt.z);
    beacon.scale.set(w, 1, w);
    beaconMat.opacity = (arrived ? 0.25 : 0.62 + 0.18 * Math.sin(beaconPulse * 2.2)) * (d < 6 ? d / 6 : 1);
    beacon.visible = true;
    // distance label, billboarded and scaled to stay readable
    if (d > 10 && !arrived) {
      const s = clamp(d * 0.028, 0.9, 10);
      label.mesh.visible = true;
      label.mesh.scale.setScalar(s * 1.8);
      label.mesh.position.set(tgt.x, gy + 3 + s * 1.1, tgt.z);
      ctx.camera.getWorldQuaternion(_tq);
      label.mesh.quaternion.copy(_tq);
      const m = d < 100 ? Math.round(d / 2) * 2 : Math.round(d / 10) * 10;
      if (m !== labelMeters) {
        labelMeters = m;
        const g = label.g;
        g.clearRect(0, 0, 256, 96);
        rr(g, 6, 14, 244, 68, 34); g.fillStyle = 'rgba(16,12,52,0.78)'; g.fill();
        rr(g, 6, 14, 244, 68, 34); g.lineWidth = 3; g.strokeStyle = GOLD; g.stroke();
        g.font = `700 40px ${FONT}`; g.fillStyle = GOLD; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`, 128, 50);
        label.tex.needsUpdate = true;
      }
    } else label.mesh.visible = false;
  }

  // ---- banner ----------------------------------------------------------------------------------------------------
  // Banners are overlays: they ask hud.present for their turn, so one never lands on the welcome card, on an open menu panel or on another
  // banner. A quest start that waited ~90 s is stale and is dropped; a completion or level-up waits as long as it takes.
  const banners = [];                                // only used when the hud has no presentation manager
  let bcur = null, blast = 0, bseq = 0;
  function pushBanner(b) {
    if (!bnr) return;
    const P = ctx.hud?.present;
    if (!P) { banners.push(b); if (banners.length > 6) banners.splice(0, banners.length - 6); return; }
    b.dur = b.kind === 'start' ? 3.8 : 4.6;
    P.request({
      id: `banner:${b.kind}:${b.title}:${++bseq}`, kind: 'banner', owner: ctx.path, maxWait: b.kind === 'start' ? 90 : 600,
      start: (h) => { bcur = b; bcur.t = 0; bcur.h = h; blast = -1; },
      end: () => { if (bcur === b) { bcur = null; if (bnr) bnr.mesh.visible = false; } },
    });
  }
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  function drawBanner(b, k) {
    const g = bnr.g, W = 1024, H = 300;
    g.clearRect(0, 0, W, H);
    glass(g, W, H, 44);
    g.textBaseline = 'alphabetic';
    const level = b.kind === 'level';
    if (level) {                                                    // radiant badge
      const cx = 150, cy = 150, a0 = k * 0.5;
      g.save(); g.translate(cx, cy);
      for (let i = 0; i < 16; i++) {
        g.rotate(Math.PI / 8); g.fillStyle = i % 2 ? 'rgba(255,216,119,0.30)' : 'rgba(255,216,119,0.14)';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, -(96 + 20 * Math.sin(a0 * 6 + i))); g.lineTo(9, -(96 + 20 * Math.sin(a0 * 6 + i))); g.closePath(); g.fill();
      }
      g.restore();
      g.beginPath(); g.arc(cx, cy, 70, 0, Math.PI * 2);
      const bg = g.createRadialGradient(cx, cy - 20, 10, cx, cy, 72); bg.addColorStop(0, '#6a58d8'); bg.addColorStop(1, '#1c1654');
      g.fillStyle = bg; g.fill(); g.lineWidth = 5; g.strokeStyle = GOLD; g.stroke();
      g.font = `800 78px ${FONT}`; g.fillStyle = '#fff3c4'; g.textAlign = 'center'; g.shadowColor = 'rgba(255,190,60,0.8)'; g.shadowBlur = 14;
      g.fillText(String(b.level), cx, cy + 27); g.shadowBlur = 0;
    }
    const tx = level ? 600 : 512, al = 'center';
    g.fillStyle = GOLD; g.font = `700 30px ${FONT}`;
    let hw = -9; for (const ch of b.head) hw += g.measureText(ch).width + 9;
    diamond(g, tx - hw / 2 - 26, 66, 8, GOLD); diamond(g, tx + hw / 2 + 26, 66, 8, GOLD);
    spaced(g, b.head, tx, 76, 9, al);
    g.font = `800 ${b.title.length > 24 ? 54 : 66}px ${FONT}`; g.fillStyle = '#fff3cf'; g.textAlign = 'center';
    g.shadowColor = 'rgba(255,170,40,0.85)'; g.shadowBlur = 18;
    g.fillText(fit(g, b.title, level ? 700 : 880), tx, 160); g.shadowBlur = 0;
    // reward line
    g.font = `600 36px ${FONT}`; g.textAlign = 'center';
    if (b.kind === 'quest') {
      const parts = [];
      if (b.xp) { const shown = Math.round(b.xp * easeOut(clamp(k * 3 - 0.3, 0, 1))); if (shown >= 1) parts.push({ t: `+${shown} XP`, c: GOLD }); }   // never "+0 XP"
      if (b.favour) parts.push({ t: `${b.favour > 0 ? '+' : ''}${Math.round(b.favour * 10) / 10}`, c: '#d6c9ff', star: true });
      if (b.extra) parts.push({ t: b.extra, c: INK });
      let total = 0; const ws = [];
      for (const pt of parts) { const w2 = g.measureText(pt.t).width + (pt.star ? 40 : 0); ws.push(w2); total += w2; }
      total += (parts.length - 1) * 44;
      let x = tx - total / 2; g.textAlign = 'left';
      parts.forEach((pt, i) => {
        if (pt.star) { star(g, x + 14, 226, 14, GOLD); x += 40; }
        g.fillStyle = pt.c; g.fillText(pt.t, x, 238); x += g.measureText(pt.t).width + 44;
        void i;
      });
      if (b.xp) {                                                 // the rising "+XP" float
        const rise = easeOut(clamp(k * 2.2, 0, 1));
        g.globalAlpha = clamp(1 - k * 2.2, 0, 1) * 0.9; g.font = `800 40px ${FONT}`; g.fillStyle = '#ffeaa0'; g.textAlign = 'center';
        g.fillText(`+${b.xp}`, 860, 236 - rise * 70); g.globalAlpha = 1;
      }
    } else {
      g.fillStyle = INK; g.fillText(fit(g, devText(b.sub || ''), level ? 700 : 880), tx, 238);
    }
    g.textAlign = 'left';
    bnr.tex.needsUpdate = true;
  }
  function updateBanner(dt) {
    if (!bnr) return;
    if (!bcur) {
      if (!banners.length) { bnr.mesh.visible = false; return; }
      bcur = banners.shift(); bcur.t = 0; bcur.dur = bcur.kind === 'start' ? 3.8 : 4.6; blast = -1;
    }
    bcur.t += dt;
    const k = bcur.t / bcur.dur;
    if (k >= 1) { const h = bcur.h; bcur = null; bnr.mesh.visible = false; h?.end(); return; }
    const inT = Math.min(1, bcur.t / 0.45), outT = clamp((bcur.dur - bcur.t) / 0.6, 0, 1);
    const a = Math.min(easeOut(inT), outT);
    bnr.mat.opacity = a;
    bnrFollow?.set({ pitch: 0.24 - (1 - easeOut(inT)) * 0.06 });
    bnr.mesh.scale.setScalar(0.94 + 0.06 * easeOut(inT));
    bnr.mesh.visible = true;
    if (bcur.t - blast > 0.033) { blast = bcur.t; drawBanner(bcur, k); }
  }

  // =====================================================================================================================
  // Quests: spawn, steps, progress, completion
  // =====================================================================================================================
  function rtOf(id) { return (S.rt[id] ??= { spawned: false, spawnAt: 0, relic: null, grabbed: false, waveIdx: -1, handles: [], stepI: -1 }); }
  const forward = { x: 0, z: -1 };
  function flatForward() {
    const f = ctx.player.forward; let x = f.x, z = f.z; const l = Math.hypot(x, z);
    if (l < 0.25) { const r = ctx.rig?.rotation?.y ?? 0; x = -Math.sin(r); z = -Math.cos(r); } else { x /= l; z /= l; }
    forward.x = x; forward.z = z; return forward;
  }
  function resolveAt(sp, Q) {
    const f = ctx.player.feet;
    const at = sp.at ?? 'ahead';
    if (Array.isArray(at)) return [at[0], at[1]];
    if (at === 'anchor' && Q?.a) return [Q.a[0] + (sp.off?.[0] ?? 0), Q.a[1] + (sp.off?.[1] ?? 0)];
    if (typeof at === 'string' && at.startsWith('sz-')) { const pt = szPoint(at.slice(3)); if (pt) return [pt.x + (sp.off?.[0] ?? 0), pt.z + (sp.off?.[1] ?? 0)]; }
    if (at === 'lake' || at === 'stones' || at === 'origin') { const pl = placeOf(at, Q, null); if (pl.ok) return [pl.x + (sp.off?.[0] ?? 0), pl.z + (sp.off?.[1] ?? 0)]; }
    if (at === 'around' || at === 'player') return [f.x + (sp.off?.[0] ?? 0), f.z + (sp.off?.[1] ?? 0)];
    const d = sp.dist ?? 8, fw = flatForward();
    return [f.x + fw.x * d + (sp.off?.[0] ?? 0), f.z + fw.z * d + (sp.off?.[1] ?? 0)];
  }
  const hostileSpawn = (sp) => !!sp.wave || catOfName(sp.name ?? '') === 'enemies';

  function enterStep(id) {
    const p = prof(), def = defs.get(id), Q = p.q[id];
    if (!def || !Q) return;
    const step = def.steps[Q.i];
    const rt = rtOf(id);
    const keep = !!(step && step.type === 'deliver' && rt.relic);               // collect -> deliver carries the same relic
    if (rt.relic && !keep) { try { rt.relic.remove(); } catch (e) { /* gone */ } rt.relic = null; }
    rt.spawned = keep; rt.grabbed = keep; rt.stepI = Q.i; rt.handles = []; rt.spawnAt = 0;
    if (!step) return;
    const list = step.spawn ? (Array.isArray(step.spawn) ? step.spawn : [step.spawn]) : null;
    if (list) {
      if (!Q.a || Q.ai !== Q.i) { Q.a = resolveAt(list[0], Q); Q.ai = Q.i; }   // the spot is chosen once per step and saved
      const delay = list[0].delay ?? (list.some(hostileSpawn) ? 5 : 0.5);
      rt.spawnAt = wall() + delay;
      if (list.some(hostileSpawn) && delay >= 2) toast(`${def.title}: steel yourself`, Math.min(4, delay));
    } else if (!keep && (step.type === 'deliver' || (step.type === 'collect' && !step.target))) rt.spawnAt = wall() + 0.2;   // a relic without an explicit spawn spec
    trackerDirty = true;
  }
  function remainingFor(step, Q, sp) {
    if (step.type === 'kill' && sp.count) return Math.max(1, sp.count - (Q.p[Q.i] | 0));
    return sp.count;
  }
  function runSpawn(id) {
    const p = prof(), def = defs.get(id), Q = p.q[id], rt = rtOf(id);
    const step = def.steps[Q.i];
    const lib = world.library;
    const needsRelic = step.type === 'deliver' || (step.type === 'collect' && !step.target);
    if (needsRelic) {
      if (!rt.relic) { rt.relic = makeRelic(id, Q, step); }
      rt.spawned = !!rt.relic;
      if (!step.spawn) return;
    }
    if (!step.spawn) { rt.spawned = true; return; }
    if (!lib) return;                                // retry next poll
    const list = Array.isArray(step.spawn) ? step.spawn : [step.spawn];
    const idx = Q.i;
    ownSpawnUntil = T() + 25;                                      // do not mistake our own quarry for something the player summoned
    for (const sp of list) {
      try {
        if (needsRelic && !sp.name && !sp.wave) continue;
        const A = list[0] === sp ? (Q.a ?? resolveAt(sp, Q)) : resolveAt({ ...sp, at: sp.at ?? 'anchor' }, Q);
        if (sp.wave) {
          const h = lib.wave(ctx, sp.wave, { around: { x: A[0], z: A[1] }, radius: sp.radius ?? 13, onCleared: () => onWaveCleared(id, idx) });
          if (h) rt.handles.push(h);
        } else if (sp.name) {
          const opts = { ...(sp.opts || {}), x: A[0], z: A[1] };
          const c = remainingFor(step, Q, sp); if (c) opts.count = c;
          if (sp.spread !== undefined) opts.spread = sp.spread;
          const h = lib.spawn(ctx, sp.name, opts);
          if (h) { rt.handles.push(h); if (sp.persona) dressPerson(h, sp.persona, opts.name); }
          else warn(`spawn "${sp.name}" is not in the library (quest ${id})`);
        }
      } catch (e) { warn('spawn failed for', id, e); }
    }
    rt.spawned = true;
  }
  function makeRelic(id, Q, step) {
    const k = world.kit;
    if (!k || typeof k.body !== 'function') return null;
    const sp = Array.isArray(step.spawn) ? step.spawn[0] : step.spawn;
    const A = Q.a ?? resolveAt(sp ?? { at: 'ahead', dist: 5 }, Q);
    if (!Q.a) { Q.a = A; Q.ai = Q.i; }
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb830, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    g.add(core, halo); g.userData.noShadow = true; g.userData.noOutline = true; core.userData.noShadow = halo.userData.noShadow = true;
    const pos = new THREE.Vector3(A[0], ctx.groundAt(A[0], A[1]) + 0.7, A[1]);
    let body = null;
    try { body = k.body(ctx, g, { radius: 0.2, mass: 0.4, bounce: 0.35, friction: 0.7, grabbable: true, grabRange: 6, position: pos }); } catch (e) { warn('relic body failed', e); return null; }
    if (!body) return null;
    const relic = { body, mesh: g, remove() { try { body.remove?.(); } catch (e) { /* ignore */ } g.removeFromParent(); } };
    body.onGrab?.(() => { relic.grabbedOnce = true; onRelicGrabbed(id); });
    return relic;
  }
  function onRelicGrabbed(id) {
    const rt = rtOf(id); rt.grabbed = true; trackerDirty = true;
    const p = prof(), Q = p?.q[id]; if (!Q || Q.s !== 'active') return;
    const step = defs.get(id)?.steps[Q.i];
    if (step?.type === 'collect' && !step.target) advance(id, 1);
    feedPassive();
  }
  function onWaveCleared(id, idx) {
    const p = prof(), Q = p?.q[id]; if (!Q || Q.s !== 'active' || Q.i !== idx) return;
    const step = defs.get(id)?.steps[idx];
    if (step?.type === 'survive-wave') advance(id, 1);
    gainFavour('wave', 2);
    grantXp(12, 'wave');
  }
  function feedPassive() { /* hook for future per-event passive logic */ }

  // ---- first labours at the start zone: points, quest-owned props (the new art, lib/gen.js), the traveller at the fire ----------------------------
  const fxs = [];                                              // per-frame effects of this module instance (they hang under ctx.root and vanish with a reload)
  let genP = null;
  const getGen = () => (world.gen ? Promise.resolve(world.gen) : (genP ??= import('/game/lib/gen.js').then((m) => m.gen ?? null, () => null)));
  function szPoint(name) {
    const a = world.startzone?.anchors?.[name];
    if (a && isFinite(a.x) && isFinite(a.z)) return { x: a.x, z: a.z };
    if (name === 'lakeside') { const lk = world.env?.lake ?? { x: -30, z: -78, radius: 38 }, l = Math.hypot(lk.x, lk.z) || 1, r = num(lk.radius, 38) + 2; return { x: lk.x - (lk.x / l) * r, z: lk.z - (lk.z / l) * r }; }
    const f = SZ_FALLBACK[name]; return f ? { x: f[0], z: f[1] } : null;
  }
  function dressPerson(h, key, name) {
    const a = h?.actors?.[0]; if (!a) return;
    try { if (name) a.npcName = name; a.persona = PERSONAS[key] ?? a.persona; a.role = 'sage'; a.wander?.(0); } catch (e) { /* actor reloading */ }
  }
  // the braziers: the start zone's own two sz-brazier models (found in the scene by name); if there are none (an older start zone) two of our own stand beside the shrine
  function findBraziers(rt) {
    if (rt.prop) return rt.prop;
    const list = [], v = new THREE.Vector3();
    try { ctx.scene.traverse((o) => { if (o.name === 'gen:sz-brazier' && list.length < 6) { o.getWorldPosition(v); if (!list.some((b) => Math.hypot(b.x - v.x, b.z - v.z) < 0.6)) list.push({ x: v.x, z: v.z, y: ctx.groundAt(v.x, v.z), lit: false, near: 0 }); } }); } catch (e) { /* scene reloading */ }
    if (list.length >= 2) return (rt.prop = { list, own: false });
    rt.waitB = (rt.waitB || 0) + 1;
    if (rt.waitB < 12) return null;                            // models appear a moment after the zone loads: ask again for ~6 s before building our own
    const s = szPoint('shrine'); if (!s) { rt.propFail = true; return null; }
    const l = Math.hypot(s.x, s.z) || 1, px = -s.z / l, pz = s.x / l;
    const own = [];
    for (const k of [-1, 1]) {
      const x = s.x + px * 3.9 * k, z = s.z + pz * 3.9 * k, b = { x, z, y: ctx.groundAt(x, z), lit: false, near: 0 };
      getGen().then((g) => { if (g?.spawn && !b.dead) b.handle = g.spawn(ctx, 'sz-brazier', { x, z, size: 1.4, yaw: Math.atan2(-x, -z) }); }, () => {});
      own.push(b);
    }
    return (rt.prop = { list: own, own: true });
  }
  let flameTex = null;
  function makeFlameTex() {                                    // a soft teardrop of alpha (white): tinted per layer, drawn additively
    try {
      const w = 64, h = 128, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g2 = cv.getContext('2d'), img = g2.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = 1 - y / (h - 1), dx = Math.abs(x / (w - 1) * 2 - 1), hw = 0.9 * Math.pow(Math.max(0, 1 - t), 0.75) * Math.min(1, t / 0.18 + 0.15);
        const a = hw > 0 ? Math.pow(Math.max(0, 1 - dx / hw), 1.4) * (1 - 0.35 * t) : 0, i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
      g2.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
    } catch (e) { return null; }
  }
  function lightBrazier(b) {                                   // a taller, brighter soft flame than the model's own: it stays
    b.lit = true;
    flameTex ??= makeFlameTex();
    const grp = new THREE.Group(); grp.position.set(b.x, b.y + 1.05, b.z); grp.userData.noShadow = grp.userData.noOutline = true;
    const layer = (col, w, h, op) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, map: flameTex, transparent: true, opacity: op, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.userData.noShadow = m.userData.noOutline = true; m.frustumCulled = false; m.renderOrder = 6; return m; };
    const outer = layer(0xff6a10, 1.0, 1.7, 0.85), inner = layer(0xffd060, 0.6, 1.1, 0.95);
    outer.position.y = 0.8; inner.position.y = 0.5;
    grp.add(outer, inner); ctx.root.add(grp);
    let ph = Math.random() * 6, k = 0;
    fxs.push((dt) => {
      ph += dt * 9; k = Math.min(1, k + dt * 1.5);
      const f = (0.3 + 0.7 * k) * (1 + 0.12 * Math.sin(ph) + 0.07 * Math.sin(ph * 2.7)), hd = ctx.player.head;
      grp.rotation.y = Math.atan2(hd.x - b.x, hd.z - b.z);
      outer.scale.set(1 + 0.08 * Math.sin(ph * 1.3), f, 1); inner.scale.set(1 + 0.06 * Math.sin(ph * 1.9), f * 1.08, 1);
    });
    tick(520);
  }  function sitePoint(site, id) {
    if (site === 'brazier') { const pr = S.rt[id]?.prop; const b = pr && (pr.list.find((q) => !q.lit) ?? null); return b ? { x: b.x, z: b.z } : null; }
    if (site === 'dummies') return szPoint('dummies');
    return null;
  }
  const siteQuests = (site) => {                               // [id...] of active quests whose CURRENT step watches this site
    const p = prof(), out = [];
    if (p) for (const id of activeIds) { const step = defs.get(id)?.steps[p.q[id]?.i]; if (step && step.type === 'custom' && step.site === site) out.push(id); }
    return out;
  };
  function siteTick(id, Q, step, rt, dt) {
    if (step.site === 'brazier') {
      const pr = findBraziers(rt); if (!pr) return;
      const f = ctx.player.feet;
      for (const b of pr.list) {                               // standing close to one, holding your hands to it, also stokes it
        if (b.lit) continue;
        if (Math.hypot(f.x - b.x, f.z - b.z) < 1.9) b.near += dt; else b.near = 0;
        if (b.near >= 2) { lightBrazier(b); toast('You hold your hands to it, and it flares.', 3); advance(id, 1); }
      }    } else if (step.site === 'sky') {
      const e = world.env; if (!e) return;
      const z = e.palette?.zenith, sig = [typeof e.timeOfDay === 'number' ? e.timeOfDay : 0, z && isFinite(z.r) ? z.r + z.g + z.b : 0];
      if (!rt.sky) { rt.sky = sig; return; }
      if (Math.abs(sig[0] - rt.sky[0]) >= 0.1 || Math.abs(sig[1] - rt.sky[1]) >= 0.3) advance(id, 1);
    }
  }
  function nearTalk(id, step, rt, dt) {                        // walking up to the person and standing there is speaking with them (the voice answer also counts, via net:npc_reply)
    const a = rt.handles?.[0]?.actors?.[0], pos = a?.group?.position; if (!pos) return;
    const f = ctx.player.feet;
    if (Math.hypot(f.x - pos.x, f.z - pos.z) <= step.near) rt.nearT = (rt.nearT || 0) + dt; else rt.nearT = 0;
    if (rt.nearT >= 1.2 && !rt.greeted) { rt.greeted = true; try { a.say?.(PELL_GREETING, 7); } catch (e) { /* actor gone */ } advance(id, 1); }
  }
  function siteCast(e) {                                       // a spell aimed at a brazier stokes it
    const o = e?.origin, d = e?.direction; if (!o || !d) return;
    for (const id of siteQuests('brazier')) {
      const pr = S.rt[id]?.prop; if (!pr) continue;
      for (const b of pr.list) {
        if (b.lit) continue;
        const vx = b.x - o.x, vy = b.y + 1.0 - o.y, vz = b.z - o.z, dist = Math.hypot(vx, vy, vz);
        if (dist > 45 || dist < 0.2) continue;
        const dl = Math.hypot(d.x, d.y, d.z) || 1, cos = (vx * d.x + vy * d.y + vz * d.z) / (dist * dl);
        if (cos > 0 && dist * Math.sqrt(Math.max(0, 1 - cos * cos)) < 1.7) { lightBrazier(b); toast('The brazier flares.', 3); advance(id, 1); }
      }
    }
  }  function siteDummy(e) {                                      // each of the three straw dummies once (startzone:dummy-hit { index })
    const p = prof(); if (!p) return;
    for (const id of siteQuests('dummies')) {
      const Q = p.q[id]; Q.seen = Q.seen || [];
      const key = num(e?.index, 0);
      if (!Q.seen.includes(key)) { Q.seen.push(key); advance(id, 1); }
    }
  }
  const feedSite = (site) => { for (const id of siteQuests(site)) advance(id, 1); };

  // ---- progress --------------------------------------------------------------------------------------------------
  function startQuest(id, opts = {}) {
    const p = prof(); if (!p) return false;
    const def = defs.get(id); if (!def) return false;
    const old = p.q[id];
    if (old && old.s === 'active') return false;
    if (old && old.s === 'done') return false;
    if (!opts.force && !isAvailable(def)) return false;
    p.q[id] = { s: 'active', i: 0, p: [0], a: null, t0: Date.now() };
    refreshActive();
    const cur = p.pinned && p.q[p.pinned]?.s === 'active' ? defs.get(p.pinned) : null;
    if (!def.passive && (!cur || opts.pin || cur.passive)) p.pinned = id;
    enterStep(id);
    markDirty(true);
    if (!def.passive && !opts.quiet) {
      pushBanner({ kind: 'start', head: def.kind === 'bounty' ? 'NEW BOUNTY' : 'NEW LABOUR', title: def.title, sub: def.steps[0].text });
      tick(660);
    }
    fire('started', { id, title: def.title, kind: def.kind });
    return true;
  }
  function advance(id, n = 1) {
    const p = prof(); if (!p) return false;
    const def = defs.get(id), Q = p.q[id];
    if (!def || !Q || Q.s !== 'active') return false;
    const step = def.steps[Q.i];
    n = num(n, 1); if (!n) return false;
    const before = Q.p[Q.i] | 0;
    const v = clamp(before + n, 0, step.count);
    if (v === before) return false;
    Q.p[Q.i] = v;
    trackerDirty = true; markDirty();
    fire('progress', { id, title: def.title, step: Q.i, stepCount: def.steps.length, text: step.text, progress: v, count: step.count });
    if (v >= step.count) finishStep(id);
    else if (p.pinned === id) tick(740 + 40 * Math.min(8, v));
    return true;
  }
  function finishStep(id) {
    const p = prof(), def = defs.get(id), Q = p.q[id];
    Q.i++; Q.p[Q.i] = 0; Q.seen = []; Q.x = 0;
    if (Q.i >= def.steps.length) { Q.i = def.steps.length - 1; completeQuest(id); return; }
    markDirty(true);
    const nxt = def.steps[Q.i];
    if (p.pinned === id) { toast(devText(nxt.text), 3.2); tick(990); }
    enterStep(id);
  }
  function completeQuest(id, force) {
    const p = prof(), def = defs.get(id); if (!p || !def) return false;
    let Q = p.q[id];
    if (!Q) { if (!force) return false; Q = p.q[id] = { s: 'active', i: 0, p: [] }; }
    if (Q.s === 'done') return false;
    Q.s = 'done'; Q.t1 = Date.now(); Q.i = def.steps.length - 1; Q.p[Q.i] = def.steps[Q.i].count;
    const rw = def.rewards || {};
    const rt = S.rt[id];
    if (rt) { if (rt.relic) rt.relic.remove(); delete S.rt[id]; }       // the quarry is left standing; it vanishes when this module reloads
    p.stats.quests++;
    if (def.kind === 'bounty') p.stats.bountiesDone++;
    const extra = [];
    if (rw.title) {
      const tid = 'c-' + norm(rw.title);
      const known = TITLES.find((t) => t.name === rw.title);
      if (!known) p.ctitles[tid] = { name: rw.title, rank: 30 };
      awardTitle(known ? known.id : tid, rw.title, true);
      extra.push(`Title: ${rw.title}`);
      fire('title', { id: known ? known.id : tid, title: rw.title });
    }
    if (rw.unlock) { p.unlocks[rw.unlock] = Date.now(); extra.push(`Unlocked: ${titleCase(rw.unlock)}`); }
    refreshActive();
    if (p.pinned === id) p.pinned = null;
    pinnedView();
    const favour = num(rw.favour);
    pushBanner({ kind: 'quest', head: def.kind === 'bounty' ? 'BOUNTY COMPLETE' : 'QUEST COMPLETE', title: def.title, xp: Math.round(num(rw.xp)), favour, extra: extra.join('   ') });
    if (favour) addFavour(favour, 'quest', true);
    if (rw.xp) grantXp(rw.xp, 'quest');
    logNote(`completed "${def.title}"`);
    celebrate(false);
    if (rw.spawn) {
      try { const f = ctx.player.feet, fw = flatForward(); world.library?.spawn?.(ctx, rw.spawn, { x: f.x + fw.x * 2.5, z: f.z + fw.z * 2.5 }); } catch (e) { warn('reward spawn failed', e); }
    }
    fire('completed', { id, title: def.title, kind: def.kind, rewards: { xp: num(rw.xp), favour, title: rw.title, unlock: rw.unlock } });
    note(`The player completed the ${def.kind === 'bounty' ? 'bounty' : 'quest'} "${def.title}"${rw.title ? ` and earned the title ${rw.title}` : ''}.`, def.kind !== 'bounty' && num(rw.xp) >= 250);
    S.lastCompleteT = T();
    checkTitles(false);
    markDirty(true);
    if (def.kind === 'bounty') S.bountyAt = T() + 40;
    refreshPassive();
    return true;
  }
  function abandonQuest(id) {
    const p = prof(), Q = p?.q[id]; if (!Q || Q.s !== 'active') return false;
    const rt = S.rt[id]; if (rt?.relic) rt.relic.remove();
    delete S.rt[id];
    p.q[id] = { s: 'abandoned', i: 0, p: [0], a: null };          // remembered, so a file that re-offers it does not restart it
    if (p.pinned === id) p.pinned = null;
    refreshActive(); markDirty(true);
    fire('abandoned', { id });
    return true;
  }
  // ---- feeding events into active quests --------------------------------------------------------------------------
  function condOk(step) {
    if (!step.when) return true;
    if (step.when === 'mr') return !!ctx.input?.passthrough;
    const tod = world.env?.timeOfDay;
    if (typeof tod !== 'number') return step.when === 'day';
    return step.when === 'night' ? tod < 0.28 : tod > 0.6;
  }
  function nameMatch(target, name) {
    if (target === undefined || target === null) return true;
    if (Array.isArray(target)) return target.some((t) => nameMatch(t, name));
    const t = norm(target);
    if (!t || t === 'any') return true;
    const n = norm(name);
    if (!n) return false;
    if (GROUPS[t]) return GROUPS[t].test(n);
    const s = sing(t);
    return n === t || n.includes(t) || n === s || n.includes(s) || (t.length > 5 && t.startsWith(n) && n.length > 4);
  }
  function weaponKindOf(type) {
    const t = norm(type);
    if (MELEE_W.has(t)) return 'melee';
    if (RANGED_W.has(t)) return 'ranged';
    if (SHIELD_W.has(t)) return 'shield';
    if (t === 'torch' || t === 'grenade' || t === 'smoke-bomb') return 'tool';
    try { const l = world.weapons?.list?.(); if (l) for (const w of l) if (w.type === type && w.kind) return w.kind; } catch (e) { /* ignore */ }
    return 'melee';
  }
  function weaponOk(filter, att) {
    if (filter === undefined || filter === null) return true;
    const f = norm(filter);
    if (!f || f === 'any') return true;
    if (!att) return false;
    if (f === 'spell') return att.kind === 'spell';
    if (f === 'magic') return att.kind === 'spell' || MAGIC_W.has(norm(att.type));
    if (att.kind === 'spell') return norm(att.type).includes(f);
    return f === att.kind || norm(att.type).includes(f) || (f === 'hammer' && /hammer|mace/.test(norm(att.type)));
  }
  const lastAtt = { kind: '', type: '', t: -99, wSeq: 0, spellT: -99, spellId: '', sSeq: 0, seq: 0 };
  const _att = { kind: '', type: '' };
  function attribution() {                                   // what dealt the blow: whichever of weapon / spell happened most recently
    const now = T();
    const w = now - lastAtt.t < 0.9, s = now - lastAtt.spellT < 1.6;
    if (w && (!s || lastAtt.wSeq > lastAtt.sSeq)) { _att.kind = lastAtt.kind; _att.type = lastAtt.type; return _att; }
    if (s) { _att.kind = 'spell'; _att.type = lastAtt.spellId; return _att; }
    return null;
  }
  const inArea = (def, Q, step, x, z) => {
    if (step.where === undefined) return true;
    const pl = placeOf(step.where, Q, step);
    return !pl.ok || Math.hypot(x - pl.x, z - pl.z) <= pl.r;
  };
  // d: event data. Returns nothing; advances any active quest whose current step matches.
  function feed(type, d) {
    const p = prof(); if (!p || !S.loaded) return;
    for (let k = 0; k < activeIds.length; k++) {
      const id = activeIds[k];
      const def = defs.get(id), Q = p.q[id];
      if (!def || !Q || Q.s !== 'active') continue;
      const step = def.steps[Q.i];
      if (!step || step.type !== type) continue;
      if (!condOk(step)) continue;
      let amount = 0;
      switch (type) {
        case 'kill':
          if (!(step.target === 'boss' ? d.boss : nameMatch(step.target, d.name))) break;
          if (!weaponOk(step.weapon, d.att)) break;
          amount = 1; break;
        case 'summon': {
          const t = norm(step.target);
          let ok = !t || t === 'any' || (t === 'new' && d.first) || (CAT[t] && CAT[t] === d.cat) || (!CAT[t] && t !== 'new' && nameMatch(step.target, d.name));
          if (ok && step.distinct) {
            const key = step.distinct === 'category' ? d.cat : d.name;
            Q.seen = Q.seen || [];
            if (Q.seen.includes(key)) ok = false; else { Q.seen.push(key); amount = 1; }
            break;
          }
          if (ok) amount = Math.max(1, d.count | 0);
          break;
        }
        case 'break':
          if (step.target && !nameMatch(step.target, d.material || '') && norm(step.target) !== 'any') break;
          if (!weaponOk(step.weapon, d.att)) break;
          if (step.kind && norm(step.kind) !== norm(d.kind)) break;
          if (step.where !== undefined && d.point && !inArea(def, Q, step, d.point.x, d.point.z)) break;
          amount = 1; break;
        case 'fell':
          if (step.where !== undefined && d.point && !inArea(def, Q, step, d.point.x, d.point.z)) break;
          amount = 1; break;
        case 'cast': {
          if (step.target && norm(step.target) !== 'any' && !norm(d.id).includes(norm(step.target))) break;
          if (step.distinct) { Q.seen = Q.seen || []; if (Q.seen.includes(d.id)) break; Q.seen.push(d.id); }
          amount = 1; break;
        }
        case 'use-weapon': {
          if (d.mode !== step.mode) break;
          const t = norm(step.target);
          const ok = !t || t === 'any' || t === weaponKindOf(d.type) || norm(d.type).includes(t) || (t === 'magic' && MAGIC_W.has(norm(d.type)));
          if (!ok) break;
          if (step.distinct) { Q.seen = Q.seen || []; if (Q.seen.includes(d.type)) break; Q.seen.push(d.type); }
          amount = 1; break;
        }
        case 'collect':
          if (step.target && nameMatch(step.target, d.type)) amount = 1;
          break;
        case 'talk':
          if (nameMatch(step.target, d.name || d.id || '')) amount = 1;
          break;
        case 'ask': case 'conjure': amount = 1; break;
        case 'survive-wave': if (!step.spawn) amount = 1; break;      // a quest's own wave reports through its onCleared callback
        default: break;
      }
      if (amount) {
        if (step.type === 'summon' || step.type === 'kill' || step.type === 'break') amount = Math.min(amount, step.count - (Q.p[Q.i] | 0));
        advance(id, amount);
      }
    }
  }
  // time / distance / state accumulators (polled at 2 Hz): ride, fly, explore, mixed-reality
  function feedTime(type, amount) {
    const p = prof(); if (!p) return;
    for (let k = 0; k < activeIds.length; k++) {
      const id = activeIds[k], def = defs.get(id), Q = p.q[id];
      const step = def?.steps[Q?.i];
      if (!step || step.type !== type || !condOk(step)) continue;
      Q.x = (Q.x || 0) + amount;                                     // fractional carry
      const whole = Math.floor(Q.x);
      if (whole >= 1) { Q.x -= whole; advance(id, whole); }
    }
  }
  function resetNoHurt() {
    const p = prof(); if (!p) return;
    for (let k = 0; k < activeIds.length; k++) {
      const id = activeIds[k], def = defs.get(id), Q = p.q[id];
      const step = def?.steps[Q?.i];
      if (step && step.noHurt && (Q.p[Q.i] | 0) > 0) {
        Q.p[Q.i] = 0; trackerDirty = true; markDirty();
        if (p.pinned === id) toast('You were struck: the streak is broken', 2.5);
        fire('progress', { id, title: def.title, step: Q.i, stepCount: def.steps.length, text: step.text, progress: 0, count: step.count });
      }
    }
  }

  // ---- stat helpers ----------------------------------------------------------------------------------------------
  function bump(map, key, n = 1) {
    key = String(key).slice(0, 40);
    if (!(key in map) && Object.keys(map).length >= 400) return;
    map[key] = (map[key] | 0) + n;
  }
  function statGet(path) {
    const p = prof(); if (!p) return 0;
    if (typeof path !== 'string') return 0;
    const parts = path.split('.');
    let cur = parts[0] === 'stats' ? p : (parts[0] in p ? p : p.stats);
    for (const k of parts) { if (cur == null || typeof cur !== 'object') return 0; cur = cur[k]; }
    if (typeof cur === 'number') return cur;
    if (isObj(cur)) { let s = 0; for (const v of Object.values(cur)) if (typeof v === 'number') s += v; return s; }
    if (Array.isArray(cur)) return cur.length;
    return 0;
  }
  function statAdd(path, delta) {
    const p = prof(); if (!p || !isFinite(delta)) return 0;
    const parts = String(path).split('.');
    if (parts[0] === 'stats') parts.shift();
    if (parts.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return 0;
    let cur = p.stats;
    for (let i = 0; i < parts.length - 1; i++) { cur = cur[parts[i]] = isObj(cur[parts[i]]) ? cur[parts[i]] : {}; }
    const k = parts[parts.length - 1];
    cur[k] = num(cur[k]) + delta;
    markDirty();
    return cur[k];
  }

  // =====================================================================================================================
  // Game event handlers
  // =====================================================================================================================
  const ready = () => !!S.loaded && !!S.profile;
  let lastActive = T();
  const act = () => { lastActive = T(); };
  const killRecent = new Float64Array(12); let killRecentN = 0;
  let noHurtKills = 0, lastCastId = '', lastCastT = -9, lastToastT = -9, toastQueue = 0;
  const on = (name, fn) => ctx.on(name, (e) => { if (ready()) { try { fn(e || {}); } catch (err) { warn(`handler for ${name} failed`, err); } } });

  function discover(kind, key, xp, label) {
    const p = prof(), m = p.disc[kind];
    if (!key || key in m) return false;
    m[key] = Date.now();
    grantXp(xp, 'discovery');
    gainFavour('discover', 0.8);
    markDirty();
    const t = T();
    if (t - lastToastT > 2.2 && !bcur && !world.intro?.active) { lastToastT = t; toast(`Discovered: ${label}`, 2.2); }   // (silent during the awakening: it is a lesson, not a catalogue)
    return true;
  }
  on('combat:kill', (e) => {
    const v = e.victim || {};
    const p = prof();
    act();
    if (v.faction === 'friendly') { if (e.by === 'player') { p.stats.friendlyKills++; addFavour(-3, 'friendly fire', true); markDirty(); } return; }
    if (e.by !== 'player') return;
    if (v.faction === 'neutral') { addFavour(-1.2, 'cruelty', true); return; }
    const name = norm(v.name) || 'enemy';
    const boss = num(v.maxHp) >= 150 || BOSS_RE.test(name) || BOSS_ENTRIES.has(name);
    const att = attribution();
    p.stats.kills++; killsInFight++; bump(p.stats.killsBy, name);
    bump(p.stats.killsWith, att ? (att.kind === 'spell' ? 'spell:' + att.type : att.type) : 'other');
    if (boss) { p.stats.bosses++; bump(p.stats.bossNames, name); }
    // flawless streak and short-window kill streak
    noHurtKills++; if (noHurtKills > p.stats.flawless) p.stats.flawless = noHurtKills;
    const t = T(); killRecent[killRecentN++ % 12] = t;
    let n = 0; for (let i = 0; i < 12; i++) if (killRecent[i] > 0 && t - killRecent[i] <= 10) n++;
    if (n > p.stats.streak) p.stats.streak = n;
    // xp: diminishing for farming the same thing, large for bosses
    const k = (S.fv['xp:' + name] ??= { n: 0, t });
    k.n = Math.max(0, k.n - (t - k.t) / 90); k.t = t;
    const base = boss ? 120 + Math.min(200, num(v.maxHp) / 4) : 5 + Math.min(20, num(v.maxHp, 40) / 8);
    const xp = Math.max(1, Math.round(base * Math.max(0.35, 1 / (1 + k.n * 0.1))));
    k.n += 1;
    grantXp(xp, 'kill');
    gainFavour('kill:' + name, boss ? 4 : 0.3);
    if (perkNow.killHeal) { try { world.player?.heal?.(perkNow.killHeal); } catch (err) { /* ignore */ } }
    if (boss) { logNote(`slew ${name}`); note(`The player slew the boss ${name.replace(/-/g, ' ')}.`, true); }
    feed('kill', { name, boss, att });
    checkTitles(false);
    markDirty();
  });
  on('player:hurt', () => { act(); lastHurtWall = wall(); noHurtKills = 0; resetNoHurt(); });
  on('player:died', () => {
    const p = prof(); act();
    p.stats.deaths++; noHurtKills = 0; resetNoHurt(); addFavour(-0.3, 'death', true); markDirty(true);
  });
  on('player:respawn', () => {
    act();
    const P = world.player;
    if (perkNow.respawnGrace && P && P.invulnerable !== true) P.invulnerable = num(P.invulnerable) + perkNow.respawnGrace;
  });
  on('spell:cast', (e) => {
    act();
    const id = typeof e.id === 'string' ? e.id : '';
    if (!id) return;
    const t = T();
    lastAtt.spellT = t; lastAtt.spellId = id; lastAtt.sSeq = ++lastAtt.seq;
    if (id === lastCastId && t - lastCastT < 0.3) { lastCastT = t; return; }     // a held spell fires every frame: count one burst once
    lastCastId = id; lastCastT = t;
    const p = prof();
    p.stats.spellCasts++; bump(p.stats.spells, id);
    discover('s', id, 15, spellName(id));
    gainFavour('cast:' + id, 0.15);
    feed('cast', { id });
  });
  on('spell:cast', (e) => siteCast(e));
  on('startzone:dummy-hit', (e) => siteDummy(e));
  function spellName(id) { try { for (const s of world.spells?.list?.() ?? []) if (s.id === id) return s.name || id; } catch (e) { /* ignore */ } return id.replace(/[-_]+/g, ' '); }
  on('weapon:grab', (e) => {
    act();
    const type = typeof e.type === 'string' ? e.type : '';
    if (!type) return;
    const p = prof();
    bump(p.stats.weapons, type);
    discover('w', type, 12, type.replace(/-/g, ' '));
    feed('use-weapon', { mode: 'grab', type });
    feed('collect', { type });
  });
  on('weapon:hit', (e) => {
    const type = typeof e.type === 'string' ? e.type : '';
    if (!type) return;
    act();
    lastAtt.t = T(); lastAtt.type = type; lastAtt.kind = weaponKindOf(type); lastAtt.wSeq = ++lastAtt.seq;
    prof().stats.weaponHits++;
    feed('use-weapon', { mode: 'hit', type });
  });
  on('weapon:fire', (e) => {
    const type = typeof e.type === 'string' ? e.type : '';
    if (!type) return;
    act();
    lastAtt.t = T(); lastAtt.type = type; lastAtt.kind = weaponKindOf(type); lastAtt.wSeq = ++lastAtt.seq;
    feed('use-weapon', { mode: 'fire', type });
  });
  on('kit:break', (e) => {
    const p = prof(); act();
    const material = typeof e.material === 'string' ? e.material : '';
    p.stats.broken++; bump(p.stats.brokenBy, material || 'thing');
    if (p.stats.broken % 5 === 0) grantXp(3, 'break');
    feed('break', { material, kind: e.kind, point: e.point, att: attribution() });
    gainFavour('break', 0.05);
    markDirty();
  });
  on('kit:fell', (e) => {
    const p = prof(); act();
    p.stats.felled++;
    grantXp(4, 'fell');
    let pt = null; try { const o = e.object; if (o && o.position) pt = o.position; } catch (err) { pt = null; }
    feed('fell', { point: pt });
    markDirty();
  });
  on('net:npc_reply', (e) => {
    const p = prof(); act();
    p.stats.talks++;
    gainFavour('talk', 0.5);
    grantXp(4, 'talk');
    feed('talk', { id: e.id, name: e.name ?? e.npc?.name });
  });
  on('net:gen3d_status', (e) => {
    if (e.state !== 'done') return;
    const p = prof(); act();
    p.stats.models++;
    grantXp(p.stats.models <= 10 ? 40 : 15, 'conjure');
    gainFavour('conjure', 3);
    logNote('conjured a new model');
    feed('conjure', {});
    markDirty();
  });
  on('module:loaded', (e) => {
    const path = typeof e.path === 'string' ? e.path : '';
    if (path === 'core/library.js') hookLibrary();
    else if (path === 'core/player.js') applyPerks();
    else if (path === 'core/kit.js') snd = null;
    else if (path.startsWith('creations/') && S.settled) {
      prof().stats.creations++;
      gainFavour('creation', 0.6);
      markDirty();
    }
  });
  ctx.on('modules:synced', () => { S.settled = true; });

  // ---- wishes: the context provider runs once per player utterance
  let lastWishT = -9;
  function noteWish() {
    const p = prof(); if (!p || !S.loaded) return;
    const t = T();
    if (t - lastWishT < 4) return;
    lastWishT = t; act();
    p.stats.wishes++;
    grantXp(2, 'wish');
    gainFavour('wish', 0.7);
    feed('ask', {});
    checkTitles(false);
    markDirty();
  }

  // ---- library hook: summons are visible only through world.library.spawn / wave, so wrap them once (the wrapper calls the current hook)
  function hookLibrary() {
    const lib = world.library;
    if (!lib || typeof lib.spawn !== 'function') return;
    lib.__qHook = onSummon;
    if (!lib.spawn.__q) {
      const orig = lib.spawn;
      const w = function (c, name, opts) {
        const h = orig.apply(this, arguments);
        try { if (lib.__qHook) lib.__qHook(c, name, opts, h, false); } catch (e) { /* never break spawning */ }
        return h;
      };
      w.__q = true; lib.spawn = w;
    }
    if (typeof lib.wave === 'function' && !lib.wave.__q) {
      const orig = lib.wave;
      const w = function (c, spec, wo) {
        const h = orig.apply(this, arguments);
        try { if (lib.__qHook) lib.__qHook(c, spec, wo, h, true); } catch (e) { /* ignore */ }
        return h;
      };
      w.__q = true; lib.wave = w;
    }
  }
  let lastLibT = -99, ownSpawnUntil = 0;
  function onSummon(c, name, opts, handle, isWave) {
    if (!ready() || c === ctx || !handle) return;           // our own quest spawns are not "summoned by the player"
    const p = prof();
    lastLibT = T(); act();
    if (isWave) {
      const list = Array.isArray(name) ? name : typeof name === 'string' ? [{ name, count: 1 }] : isObj(name) ? Object.entries(name).map(([n, k]) => ({ name: n, count: k })) : [];
      for (const s of list) recordSummon(typeof s === 'string' ? s : s.name, num(s.count, 1));
    } else recordSummon(handle.name ?? name, num(handle.count, num(opts?.count, 1)));
    markDirty();
  }
  function recordSummon(name, count, catOverride) {
    const p = prof();
    const nm = String(name ?? '').slice(0, 40);
    if (!nm) return;
    const cat = catOverride || catOfName(nm) || 'props';
    p.stats.summoned += count;
    bump(p.stats.summonedBy, nm, count); bump(p.stats.summonedCat, cat, count);
    const first = !(nm in p.disc.e);
    if (first && !catOverride) discover('e', nm, 8, nm.replace(/-/g, ' '));
    gainFavour('summon:' + cat, 0.4);
    feed('summon', { name: nm, cat, first: first && !catOverride, count: Math.max(1, count | 0) });
    if (/^effect/.test(cat) && SKY_RE.test(nm)) feedSite('sky');                       // "change the sky" by summoning a weather / time-of-day entry
    checkTitles(false);
  }
  // custom code that spawns fighters without the library: notice friendlies / enemies appearing (not while a library call or our own spawns are settling)
  let prevFr = 0, prevEn = 0, killsInFight = 0;
  function pollFighters() {
    const C = world.combat; if (!C || typeof C.count !== 'function') return;
    let fr = 0, en = 0;
    try { fr = C.count('friendly') | 0; en = C.count('enemy') | 0; } catch (e) { return; }
    const t = T();
    if (t - lastLibT > 15 && t > ownSpawnUntil) {
      if (fr > prevFr) recordSummon('ally', fr - prevFr, 'allies');
      if (en > prevEn) recordSummon('enemy', en - prevEn, 'enemies');
    }
    if (prevEn > 0 && en === 0 && killsInFight > 0) { killsInFight = 0; feed('survive-wave', {}); }
    prevFr = fr; prevEn = en;
  }

  // =====================================================================================================================
  // Offers, bounties, post-load
  // =====================================================================================================================
  function offer(spec) {
    const d = cleanSpec(spec, 'omnissiah', 600);
    if (!d) { warn('offer(): the spec has no valid steps', spec); return null; }
    let id = 'o-' + (norm(isObj(spec) ? (spec.id ?? d.title) : d.title) || 'labour').slice(0, 34);
    if (!ready()) { S.pendingOps.push(() => offer(spec)); return id; }
    const p = prof();
    if (p.offered[id] || defs.has(id)) {                      // idempotent: the same creation file reloading must not reset anything
      if (!p.q[id]) startQuest(id, { force: true, pin: true });
      return id;
    }
    d.id = id;
    p.offered[id] = d;
    const keys = Object.keys(p.offered);
    if (keys.length > 40) for (const k of keys.slice(0, keys.length - 40)) if (p.q[k]?.s !== 'active') delete p.offered[k];
    rebuildDefs();
    startQuest(id, { force: true, pin: true });
    logNote(`was given the labour "${d.title}"`);
    return id;
  }
  const BOUNTY_W = { kill: 14, summon: 20, break: 8, fell: 12, cast: 6, 'use-weapon': 10, explore: 0.25, reach: 60, conjure: 150, ask: 15, 'survive-wave': 70, collect: 20 };
  function bountyXp(steps) {
    const p = prof(); let xp = 0;
    for (const s of steps) xp += (BOUNTY_W[s.type] ?? 20) * s.count * (s.noHurt ? 1.6 : 1);
    return Math.max(40, Math.round((xp * (1 + (p.level - 1) * 0.03)) / 5) * 5);
  }
  function genBounty(rng, kind, k) {
    const p = prof(), cat = catalogue().byCat, L = p.level;
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const scale = (lo, hi) => Math.max(lo, Math.round((lo + rng() * (hi - lo)) * (1 + L * 0.04)));
    const enemies = (cat.enemies || []).filter((n) => !BOSS_ENTRIES.has(n) && !/mimic|bat-swarm/.test(n));
    const seenWeapons = p.disc.w;
    let steps, title, desc;
    switch (kind) {
      case 'hunt': {
        const e = pick(enemies.length ? enemies : ['goblin']), n = Math.min(14, scale(4, 8));
        steps = [{ type: 'kill', target: e, count: n, text: `Slay ${n} ${plural(e.replace(/-/g, ' '))}`, spawn: { wave: [{ name: e, count: n }], at: 'around', radius: 14, delay: 6 } }];
        title = `Hunt: ${titleCase(plural(e))}`; desc = `${titleCase(plural(e))} have been seen near here. Thin them out.`; break;
      }
      case 'flawless': {
        const e = pick(enemies.filter((n) => !/dragon|golem|troll|ogre/.test(n)).length ? enemies.filter((n) => !/dragon|golem|troll|ogre/.test(n)) : ['goblin']);
        const n = clamp(3 + Math.floor(L / 6), 3, 6);
        steps = [{ type: 'kill', target: e, count: n, noHurt: true, text: `Slay ${n} ${plural(e.replace(/-/g, ' '))} without a scratch`, spawn: { wave: [{ name: e, count: n }], at: 'around', radius: 14, delay: 7 } }];
        title = `Unscathed: ${titleCase(plural(e))}`; desc = 'Anyone can win by bleeding. Win clean.'; break;
      }
      case 'survive': {
        const a = pick(enemies.length ? enemies : ['goblin']), b = pick(enemies.length ? enemies : ['goblin']);
        const n1 = Math.min(10, scale(3, 6)), n2 = Math.min(6, scale(1, 3));
        steps = [{ type: 'survive-wave', text: 'Survive the onslaught', spawn: { wave: a === b ? [{ name: a, count: n1 + n2 }] : [{ name: a, count: n1 }, { name: b, count: n2 }], at: 'around', radius: 14, delay: 7 } }];
        title = 'The Onslaught'; desc = 'They are coming from all sides. Be the last standing.'; break;
      }
      case 'spellwork': {
        const spells = (() => { try { return world.spells?.list?.() ?? []; } catch (e) { return []; } })();
        const s = spells.length ? pick(spells) : null, n = scale(6, 12);
        steps = [s ? { type: 'cast', target: s.id, count: n, text: `Cast ${s.name} ${n} times` } : { type: 'cast', target: 'any', count: n, text: `Cast ${n} spells` }];
        title = s ? `Rite of ${s.name}` : 'Rite of Spells'; desc = 'Practice makes a mage. Cast until the air hums.'; break;
      }
      case 'weapon': {
        const ws = (cat.weapons || []).filter((n) => !/rack|armory/.test(n));
        const fresh = ws.filter((n) => !(n in seenWeapons));
        const w = pick(fresh.length ? fresh : ws.length ? ws : ['sword']), n = scale(6, 10);
        steps = [{ type: 'use-weapon', target: w, mode: 'hit', count: n, text: `Land ${n} blows with the ${w.replace(/-/g, ' ')}`, spawn: [{ name: w, at: 'ahead', dist: 3.5, delay: 0.5 }, { name: 'training-dummy', at: 'ahead', dist: 7, delay: 0.5 }] }];
        title = `Trial of the ${titleCase(w)}`; desc = 'A weapon is only understood when it is swung. Strike the dummy.'; break;
      }
      case 'demolition': {
        const n = Math.min(12, scale(5, 9));
        steps = [{ type: 'break', target: 'any', count: n, text: `Smash ${n} things`, spawn: { name: pick(['crate-stack', 'barrel', 'crate']), count: pick([6, 8]), spread: 4, at: 'ahead', dist: 7, delay: 1 } }];
        title = 'Demolition'; desc = 'Everything that stands may fall. Help it along.'; break;
      }
      case 'lumber': {
        const n = Math.min(8, scale(3, 6));
        steps = [{ type: 'fell', count: n, text: `Fell ${n} trees`, spawn: { name: 'grove', at: 'ahead', dist: 14, delay: 1 } }];
        title = 'Timber Tithe'; desc = 'The grove has grown too thick. Thin it.'; break;
      }
      case 'discovery': {
        steps = [{ type: 'summon', target: 'new', count: 3, text: 'Ask for three things you have never seen' }];
        title = 'Seek the Unknown'; desc = 'You have not seen the half of what I can make. Ask for three new marvels.'; break;
      }
      case 'creator': {
        const c = pick(['structures', 'nature', 'props', 'allies', 'weapons'].filter((x) => (cat[x] || []).length));
        const label = { structures: 'structures', nature: 'wonders of nature', props: 'curios', allies: 'allies', weapons: 'weapons' }[c];
        steps = [{ type: 'summon', target: c, count: 3, distinct: true, text: `Summon three different ${label}` }];
        title = `Maker of ${cap1(label)}`; desc = 'Creation is a habit. Ask for three different things of one kind.'; break;
      }
      default: { // pilgrimage
        if (rng() < 0.5) { steps = [{ type: 'reach', where: 'stones', text: 'Walk to the far standing stones' }]; title = 'Pilgrimage'; desc = 'Beyond the fields stand the old stones. Go and touch them.'; }
        else { const n = Math.round(scale(400, 800) / 50) * 50; steps = [{ type: 'explore', count: n, text: `Travel ${n} metres`, }]; title = 'Wayfarer\'s Road'; desc = 'The field is wide. Walk, run or fly across it.'; }
      }
    }
    const spec = cleanSpec({ title, description: desc, steps, rewards: { xp: 0, favour: kind === 'discovery' || kind === 'creator' ? 4 : 3 } }, 'bounty', 800);
    if (!spec) return null;
    spec.rewards.xp = bountyXp(spec.steps);
    spec.id = `b${dayKey()}-${k}`;
    spec.giver = 'The Omnissiah';
    spec.expires = new Date(new Date().setHours(24, 0, 0, 0)).getTime() + 3 * 3600 * 1000;   // fresh until 03:00 the next morning
    return spec;
  }
  function ensureBounties(extra) {
    const p = prof(); if (!p) return;
    const day = dayKey();
    if (p.bountyDay !== day) {
      // drop yesterday's untouched bounties; finished ones stay as history for a day
      for (const id of Object.keys(p.gen)) {
        const Q = p.q[id];
        if (!Q || (Q.s !== 'active' && Date.now() - num(Q.t1, 0) > 36 * 3600 * 1000)) { delete p.gen[id]; if (Q && Q.s !== 'active') delete p.q[id]; }
      }
      p.bountyDay = day; p.bountyCount = 0;
      const rng = mulberry(hashStr(day + p.id));
      const plan = [rng() < 0.5 ? 'hunt' : rng() < 0.5 ? 'flawless' : 'survive', ['spellwork', 'weapon', 'demolition', 'lumber', 'discovery'][Math.floor(rng() * 5)], ['creator', 'discovery', 'pilgrimage', 'pilgrimage'][Math.floor(rng() * 4)]];
      for (const kind of plan) {
        const spec = genBounty(rng, kind, p.bountyCount++);
        if (spec) p.gen[spec.id] = spec;
      }
      rebuildDefs(); markDirty();
    } else if (extra && p.bountyCount < 7) {
      const rng = mulberry(hashStr(day + p.id + p.bountyCount));
      const kind = ['hunt', 'spellwork', 'weapon', 'demolition', 'flawless', 'creator', 'lumber', 'survive'][Math.floor(rng() * 8)];
      const spec = genBounty(rng, kind, p.bountyCount++);
      if (spec) { p.gen[spec.id] = spec; rebuildDefs(); markDirty(); }
    }
  }
  function refreshPassive() {
    const p = prof(); if (!p) return;
    for (const d of defs.values()) if (d.passive && !p.q[d.id] && isAvailable(d)) startQuest(d.id, { quiet: true });
  }
  // The first labour does not announce itself over the welcome card: it waits until the card has been dismissed (and a breath after), or until
  // the card has been up for 20 s. (Its banner is also queued behind the card by hud.present, and the tracker hides while a panel is open.)
  function introHold(t) {
    const P = ctx.hud?.present; if (!P) return false;
    if (P.busy('card')) { S.cardBusySince ??= t; return t - S.cardBusySince < 20; }
    if (S.cardBusySince != null) { S.cardEndT ??= t; return t - S.cardEndT < 5; }
    return false;
  }
  function autoStart() {
    const p = prof(); if (!p || !p.settings.auto) return;
    if (activeIds.some((id) => !defs.get(id)?.passive)) return;
    { const I = world.intro; if (I && !ctx.input?.passthrough && (I.running || !I.done)) return; }   // never over the awakening (it hands the first labour over itself)
    const t = T();
    if (t < 25 || t - (S.lastCompleteT ?? -99) < 8 || introHold(t)) return;
    for (const d of STARTERS) {
      if (d.manual || d.passive || !isAvailable(d)) continue;
      startQuest(d.id, {}); return;
    }
  }
  // after the profile is in memory (first load, reconcile, or hot reload)
  function postLoad(first) {
    rebuildDefs();
    checkTitles(true);
    ensureBounties(false);
    refreshActive();
    const p = prof();
    for (const id of activeIds) { if (p.q[id].p.length === 0) p.q[id].p = [0]; enterStep(id); }
    refreshPassive();
    applyPerks();
    const ops = S.pendingOps.splice(0);
    for (const op of ops) { try { op(); } catch (e) { warn('queued op failed', e); } }
    hookLibrary();
    trackerOn = p.settings.tracker !== false;
    trackerDirty = true;
    if (first && p.stats.sessions > 1) {
      const reg = regardOf(p.favour);
      note(`The player has returned: level ${p.level}${title() ? ', ' + title() : ''}; your favour toward them is ${reg}.`, false);
    }
  }

  // =====================================================================================================================
  // Polling (2 Hz): travel, places, states, spawns, decay, auto-start
  // =====================================================================================================================
  let px = 0, pz = 0, havePrev = false, lastHurtWall = -99, pollN = 0, rideAcc = 0;
  function poll(dt) {
    const p = prof(); if (!p) return;
    pollN++;
    const f = ctx.player.feet, head = ctx.player.head;
    const P = world.player;
    // ---- travel
    if (!havePrev) { px = head.x; pz = head.z; havePrev = true; }
    else {
      const dx = head.x - px, dz = head.z - pz, dist = Math.sqrt(dx * dx + dz * dz);
      px = head.x; pz = head.z;
      if (dist < 25 && dist > 0.01) {
        const speed = dist / dt;
        if (speed > 0.3) act();
        if (P && P.flying) { p.stats.flown += dist; }
        else if (speed > 9.5) { p.stats.driven += dist; rideAcc += dt; feedTime('ride', dt); }
        else p.stats.walked += dist;
        if (!(P && P.flying) && speed <= 9.5) rideAcc = 0;
        feedTime('explore', dist);
        if (dist > 5) markDirty();
      }
    }
    if (P && P.flying) feedTime('fly', dt);
    if (ctx.input?.passthrough) feedTime('mixed-reality', dt);
    // ---- places and steps that watch the world
    for (let k = 0; k < activeIds.length; k++) {
      const id = activeIds[k], def = defs.get(id), Q = p.q[id];
      const step = def?.steps[Q?.i];
      if (!step) continue;
      const rt = rtOf(id);
      if (rt.stepI !== Q.i) enterStep(id);
      if (!rt.spawned && wall() >= rt.spawnAt && (step.spawn || step.type === 'deliver' || (step.type === 'collect' && !step.target)) && P?.alive !== false) runSpawn(id);
      if (step.type === 'reach' && condOk(step)) {
        const pl = placeOf(step.where, Q, step);
        if (pl.ok && Math.hypot(f.x - pl.x, f.z - pl.z) <= pl.r) advance(id, 1);
      } else if (step.type === 'deliver') {
        const rel = rt.relic;
        if (rel) {
          if (!rel.mesh.parent) { rel.remove(); rt.relic = null; rt.spawned = false; rt.spawnAt = wall() + 1; }
          else {
            const b = rel.body.position;
            if (Math.hypot(b.x - f.x, b.z - f.z) > 500) { rel.remove(); rt.relic = null; rt.spawned = false; rt.spawnAt = wall(); }
            const pl = placeOf(step.where, Q, step);
            if (pl.ok && Math.hypot(b.x - pl.x, b.z - pl.z) <= pl.r && condOk(step)) advance(id, 1);
          }
        }
      } else if (step.type === 'collect' && !step.target && rt.relic && !rt.relic.mesh.parent) { rt.relic.remove(); rt.relic = null; rt.spawned = false; rt.spawnAt = wall() + 1; }
      else if (step.type === 'talk' && step.near) nearTalk(id, step, rt, dt);
      else if (step.type === 'custom' && step.site) siteTick(id, Q, step, rt, dt);
    }
    if (pollN % 2 === 0) poll1Hz(dt * 2);
    // ---- beacon / tracker content
    if (trk && updateTrackerValues()) trackerDirty = true;
    // ---- auto-start and bounty refills
    if (pollN % 4 === 0) {
      autoStart();
      if (S.bountyAt && T() > S.bountyAt) { S.bountyAt = 0; ensureBounties(true); }
    }
  }
  function poll1Hz(dt) {
    const p = prof();
    // stat steps
    for (let k = 0; k < activeIds.length; k++) {
      const id = activeIds[k], def = defs.get(id), Q = p.q[id];
      const step = def?.steps[Q?.i];
      if (!step || step.type !== 'stat') continue;
      const v = Math.floor(statGet(step.target));
      const cur = Q.p[Q.i] | 0;
      if (v > cur) advance(id, Math.min(v, step.count) - cur);
    }
    checkTitles(false);
    pollFighters();
    // idleness slowly cools the Omnissiah's regard; play keeps it warm
    const idle = T() - lastActive;
    if (idle > 90) addFavour(-0.4 / 60 * dt, 'idle', true);
    else addFavour(-0.04 / 60 * dt, 'time', true);
    if (p.favour < 5) p.favour = 5;
    // perks follow level and favour thresholds, and are re-applied when player.js is reloaded (cheap: a few comparisons)
    applyPerks();
    allyScanT += dt; if (allyScanT >= 2) { allyScanT = 0; boostAllies(); }
    // ensure the pinned quest is sane
    refreshPassive();
  }

  // =====================================================================================================================
  // Public API
  // =====================================================================================================================
  function viewOf(def) {
    const p = prof(); const Q = p.q[def.id];
    const state = Q?.s === 'active' ? 'active' : Q?.s === 'done' ? 'done' : isAvailable(def) ? 'available' : 'locked';
    const cur = Q && Q.s === 'active' ? Q.i : state === 'done' ? def.steps.length : 0;
    const steps = def.steps.map((s, i) => {
      const done = state === 'done' || (Q && Q.s === 'active' && i < Q.i);
      return { text: s.text, type: s.type, count: s.count, progress: done ? s.count : (Q && Q.s === 'active' && i === Q.i ? Math.min(s.count, Q.p[i] | 0) : 0), done: !!done };
    });
    const c = state === 'active' ? steps[Q.i] : null;
    let place = null;
    if (state === 'active') { const pl = stepPlace(def, Q, def.steps[Q.i]); if (pl.ok) place = { x: pl.x, z: pl.z, radius: pl.r }; }
    let frac = 0;
    if (state === 'done') frac = 1;
    else if (state === 'active') { frac = (Q.i + (c ? c.progress / Math.max(1, c.count) : 0)) / def.steps.length; }
    return {
      id: def.id, title: def.title, giver: def.giver, description: def.description, kind: def.kind, state, pinned: p.pinned === def.id && state === 'active',
      step: state === 'active' ? Q.i : state === 'done' ? def.steps.length - 1 : 0, stepCount: def.steps.length, steps,
      current: c ? { text: c.text, progress: c.progress, count: c.count, where: place } : null,
      rewards: { xp: num(def.rewards?.xp), favour: num(def.rewards?.favour), title: def.rewards?.title, unlock: def.rewards?.unlock, spawn: def.rewards?.spawn },
      progress: Math.round(frac * 1000) / 1000, minLevel: def.minLevel || 0, completedAt: Q?.t1 || null,
    };
  }
  const api = {
    get ready() { return ready(); },
    get mode() { return S.mode; },
    list(filter) {
      const p = prof(); if (!p) return [];
      const out = [];
      for (const def of defs.values()) {
        if (def.kind === 'bounty' && !p.gen[def.id]) continue;
        const v = viewOf(def);
        if (filter?.state && v.state !== filter.state) continue;
        if (filter?.kind && v.kind !== filter.kind) continue;
        if (!filter?.all && !filter?.state && v.state === 'locked') continue;
        out.push(v);
      }
      const order = { active: 0, available: 1, locked: 2, done: 3 };
      out.sort((a, b) => order[a.state] - order[b.state] || (a.state === 'done' ? num(b.completedAt) - num(a.completedAt) : 0));
      return out;
    },
    get(id) { const d = defs.get(id); return d && prof() ? viewOf(d) : null; },
    active() { const p = prof(); if (!p || !pinnedView()) return null; return viewOf(_view.def); },
    bounties() { return api.list({ kind: 'bounty' }); },
    start(id, opts) { return ready() ? startQuest(String(id), opts && typeof opts === 'object' ? { quiet: !!opts.quiet } : {}) : false; },
    pin(id) { const p = prof(); if (!p || p.q[id]?.s !== 'active') return false; p.pinned = id; trackerDirty = true; markDirty(); return true; },
    abandon(id) { return abandonQuest(String(id)); },
    advance(id, n = 1) { return ready() ? advance(String(id), n) : false; },
    complete(id) { return ready() ? completeQuest(String(id), true) : false; },
    offer,
    phrase: (text) => devText(text),                 // a step text worded for the controls the player holds (menu.js uses it)
    profile() {
      const p = prof(); if (!p) return null;
      const lo = xpForLevel(p.level), hi = xpForLevel(p.level + 1);
      return {
        level: p.level, xp: p.xp, xpInLevel: p.xp - lo, xpNext: p.level >= LV_MAX ? 0 : hi - lo, favour: Math.round(p.favour * 10) / 10, regard: regardOf(p.favour),
        title: title(), titles: p.titles.map((id) => titleDef(id)).filter(Boolean).map((t) => ({ id: t.id, name: t.name })),
        stats: JSON.parse(JSON.stringify(p.stats)), perks: { ...perkNow },
        discoveries: { entries: Object.keys(p.disc.e).length, weapons: Object.keys(p.disc.w).length, spells: Object.keys(p.disc.s).length },
        unlocks: Object.keys(p.unlocks),
      };
    },
    grantXp(n, why) { return ready() ? grantXp(n, why) : 0; },
    addFavour(n, why) { return ready() ? addFavour(n, why) : 0; },
    stat(path, delta) { if (!ready()) return 0; return delta === undefined ? statGet(path) : statAdd(path, delta); },
    setTitle(id) { const p = prof(); if (!p) return false; if (id === null) { p.title = null; markDirty(); return true; } if (!p.titles.includes(id)) return false; p.title = id; markDirty(); return true; },
    unlocked(flag) { return !!prof()?.unlocks[norm(flag)]; },
    perks() { return { ...perkNow }; },
    setAuto(b) { const p = prof(); if (p) { p.settings.auto = !!b; markDirty(); } },
    trackerVisible(b) { if (b === undefined) return trackerOn; trackerOn = !!b; const p = prof(); if (p) { p.settings.tracker = !!b; markDirty(); } trackerDirty = true; return trackerOn; },
    newBounty() { ensureBounties(true); return api.bounties(); },
    on(evt, fn) { (L[evt] ??= []).push(fn); return () => { const a = L[evt]; const i = a ? a.indexOf(fn) : -1; if (i >= 0) a.splice(i, 1); }; },
    saveNow() { markDirty(true); return saveNow(); },
    reset(confirm) {
      if (confirm !== true) return false;
      for (const id of Object.keys(S.rt)) { try { S.rt[id].relic?.remove(); } catch (e) { /* ignore */ } }
      S.rt = {};
      S.profile = freshProfile(); S.profile.stats.sessions = 1;
      postLoad(false); markDirty(true); return true;
    },
    xpForLevel, levelForXp,
  };
  ctx.provide('quests', api);

  // ---- what the Omnissiah sees in every request (and the signal that a wish was just made)
  function standingLine() {
    const p = prof();
    const t = title();
    let s = `Level ${p.level}${t ? ` "${t}"` : ''}; your favour toward them is ${Math.round(p.favour)}/100 (${regardOf(p.favour)}).`;
    const a = pinnedView() ? _view : null;
    if (a) {
      const st2 = a.step;
      s += ` Labour in hand: "${a.def.title}", step ${a.Q.i + 1} of ${a.def.steps.length} (${st2.text}${st2.count > 1 ? `, ${Math.min(st2.count, a.Q.p[a.Q.i] | 0)}/${st2.count}` : ''}).`;
    } else s += ' No labour in hand.';
    const now = Date.now(), rec = [];
    for (let i = p.log.length - 1; i >= 0 && rec.length < 3; i--) { const e = p.log[i]; const m = Math.round((now - e.t) / 60000); if (m <= 45) rec.push(`${e.x} (${m < 1 ? 'just now' : m + ' min ago'})`); }
    if (rec.length) s += ` Recent: ${rec.join('; ')}.`;
    return s.slice(0, 480);
  }
  const provider = () => {
    if (!ready()) return null;
    noteWish();
    const p = prof();
    const a = pinnedView() ? _view : null;
    return {
      level: p.level, title: title(), favour: Math.round(p.favour), regard: regardOf(p.favour),
      activeQuest: a ? { title: a.def.title, step: `${a.Q.i + 1}/${a.def.steps.length} ${a.step.text}` } : null,
      recent: p.log.slice(-3).map((e) => e.x),
      line: standingLine(),
    };
  };
  if (world.contextProviders) world.contextProviders.progress = provider;
  ctx.onDispose(() => { if (world.contextProviders?.progress === provider) delete world.contextProviders.progress; });

  // ---- lifecycle: net, visibility
  ctx.on('net:save_data', (m) => { if (m && m.key === SAVE_KEY) adopt(m.data, 'server'); });
  ctx.on('net:save_ack', (m) => { if (m && m.key === SAVE_KEY && m.ok === false) warn('the server refused the save:', m.error); });
  ctx.on('net:open', () => {
    if (!ps.synced) requestLoad();
    else if (ps.dirty) saveNow();
  });
  const onHide = () => { if (S.loaded) saveNow(); };            // headset taken off, tab closed, page left: flush at once
  const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
  if (typeof document !== 'undefined' && document.addEventListener) { document.addEventListener('visibilitychange', onVis); ctx.onDispose(() => document.removeEventListener('visibilitychange', onVis)); }
  if (typeof window !== 'undefined' && window.addEventListener) { window.addEventListener('pagehide', onHide); ctx.onDispose(() => window.removeEventListener('pagehide', onHide)); }
  ctx.onDispose(() => {
    if (S.loaded && ps.dirty) saveNow();
    const lib = world.library; if (lib && lib.__qHook === onSummon) lib.__qHook = null;
    for (const id of Object.keys(S.rt)) { try { S.rt[id].relic?.remove(); } catch (e) { /* ignore */ } }
  });

  setupVisuals();
  if (S.loaded && S.profile) {
    S.profile = migrate(S.profile) ?? S.profile;                    // hot reload: adopt any schema change in this version
    postLoad(false);
  } else {
    ps.deadline = wall() + 3;
    if (ctx.net?.connected) requestLoad();
  }

  // ---- per frame
  let acc = 0, lastTrkDraw = 0;
  return {
    update(dt) {
      dt = Math.min(dt, 0.1);
      const w = wall();
      if (!S.loaded) {
        if (ps.deadline && w > ps.deadline && !S.loaded) {          // no reply within 3 s: run from the browser mirror (or in memory) and keep asking
          ps.deadline = 0;
          const local = readLocal();
          adopt(local, local ? 'local' : 'memory');
          if (!local) S.mode = 'memory';
        }
        return;
      }
      const p = S.profile;
      p.stats.playSec += dt;
      if (fxs.length) for (const fx of fxs) { try { fx(dt); } catch (e) { /* effect gone */ } }
      acc += dt;
      if (acc >= 0.5) { const step = acc; acc = 0; poll(step); }
      // visuals
      if (trk) {
        const hasQuest = tv.key !== '' && pinnedView();
        const combat = (w - lastHurtWall < 5) || prevEn >= 5;
        const alive = world.player?.alive !== false;
        // never in the way of a menu panel (it would sit behind or over it) or of the welcome card
        const clear = !(world.menu?.isOpen) && !(ctx.hud?.present?.busy('card'));
        const target = hasQuest && trackerOn && alive && clear && p.settings.tracker !== false ? (combat ? 0.25 : 1) : 0;
        trkFade += (target - trkFade) * Math.min(1, dt * (target > trkFade ? 4 : 9));
        if (trkFade < 0.01) { trk.mesh.visible = false; }
        else {
          if (trackerDirty && w - lastTrkDraw > 0.2) { drawTracker(); trackerDirty = false; lastTrkDraw = w; }
          trk.mat.opacity = trkFade; trk.mesh.visible = true;
        }
        updateBeacon(dt);
        updateBanner(dt);
      }
      // persistence
      if (ps.dirty && w - ps.lastSave > 1.5 && (w - ps.lastChange >= 4 || w - ps.dirtySince >= 30)) {
        if (!saveNow()) { ps.lastSave = w - 1; }                    // not connected: try again shortly (net:open also retries)
      }
    },
    dispose() { /* camera children and listeners are removed through onDispose; the profile stays in ctx.state */ },
  };
}




