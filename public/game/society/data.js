// society/data.js - static tables for core/society.js: identities, roles, schedules, structure kinds, prices, bands.
// Edit freely (society.js re-imports this file when it hot-reloads). Nothing here touches the scene.

export const NAMES_M = ['Garrick', 'Aldous', 'Bram', 'Cedric', 'Dunstan', 'Edric', 'Fenwick', 'Gideon', 'Hob', 'Ivor', 'Jory', 'Kellan', 'Leof', 'Mortimer', 'Nolan', 'Osric', 'Perrin', 'Quentin', 'Rolf', 'Silas', 'Tobin', 'Ulric', 'Vance', 'Wat', 'Yorick', 'Alaric', 'Barnaby', 'Corwin', 'Desmond', 'Emmet', 'Faolan', 'Godric', 'Harlan', 'Isembard', 'Jasper', 'Kit', 'Lowell', 'Merrick', 'Neville', 'Orrin'];
export const NAMES_F = ['Maren', 'Alys', 'Brenna', 'Cora', 'Dilys', 'Elspeth', 'Fenna', 'Greta', 'Hester', 'Isolde', 'Jenna', 'Kestrel', 'Lenna', 'Mabel', 'Nessa', 'Odette', 'Petra', 'Rhosyn', 'Sunniva', 'Tilda', 'Una', 'Vesna', 'Wilhelmina', 'Ysolde', 'Ada', 'Bryony', 'Clemence', 'Dagny', 'Edda', 'Fiora', 'Gwen', 'Hild', 'Ingrid', 'Joan', 'Kerra', 'Lotte', 'Mirren', 'Nell', 'Orla', 'Pippa'];
export const SETTLE_NAMES = ['Oakhaven', 'Brindle Cross', 'Thistledown', 'Eastmere', 'Cobble End', 'Hollin', "Wren's Rest", 'Ashby Green', 'Dunmere', 'Fallow Ford', 'Marrowgate', 'Larkspur', 'Stonebridge', 'Quill Hollow', 'Rookwood', 'Saltmarsh'];
export const TRAITS = ['nosy', 'cheerful', 'grumpy', 'brave', 'cautious', 'curious', 'greedy', 'kind', 'proud', 'shy', 'superstitious', 'boastful', 'dry-witted', 'devout', 'lazy', 'plain-spoken', 'sentimental', 'suspicious'];
export const RELATIONS = ['sister', 'brother', 'cousin', 'old friend', 'rival', 'neighbour', 'drinking partner', 'former sweetheart', 'godparent', 'apprentice'];

// role -> display text, default heights etc.
export const ROLE_INFO = {
  villager: { text: 'villager', kind: 'person' },
  farmer: { text: 'farmer', kind: 'person' },
  merchant: { text: 'merchant', kind: 'person' },
  blacksmith: { text: 'blacksmith', kind: 'person' },
  bard: { text: 'bard', kind: 'person' },
  child: { text: 'child', kind: 'person' },
  king: { text: 'king', kind: 'person' },
  wizard: { text: 'old wizard', kind: 'person' },
  guard: { text: 'guard', kind: 'person' },
  ally: { text: 'companion', kind: 'ally' },
  livestock: { text: 'animal', kind: 'animal' },
  pet: { text: 'pet', kind: 'animal' },
  wild: { text: 'wild animal', kind: 'animal' },
};
export const LIVESTOCK = /^(sheep|cow|pig|chicken|horse|goat|cattle|chick)/;
export const PETS = /^(dog|cat|puppy|kitten)/;
export const WILD = /^(deer|rabbit|fox|bunny|hare)/;

// Decide a society role for an actor. Returns { role, kind } or null (do not adopt).
// f = the actor's combat fighter (or null); the order of tests is the order of confidence.
export function classify(a, f) {
  const faction = a.faction ?? f?.faction ?? 'neutral';
  const txt = [a.society?.forceRole, a.role, a.npcRole, f?.name, a.group?.userData?.libName, a.name, a.mdl?.name].filter((s) => typeof s === 'string' && s).join(' ').toLowerCase();
  if (faction === 'enemy') return null;
  const creature = a.kind === 'creature';
  const ally = !!f && faction === 'friendly';
  if (creature) {
    if (ally) return { role: 'ally', kind: 'ally' };
    if (PETS.test(a.role || a.name || '') || /\b(dog|cat)\b/.test(txt)) return { role: 'pet', kind: 'animal' };
    if (LIVESTOCK.test(a.role || a.name || '') || /\b(sheep|cow|pig|chicken|horse|goat|cattle|chick)\b/.test(txt)) return { role: 'livestock', kind: 'animal' };
    if (WILD.test(a.role || a.name || '') || /\b(deer|rabbit|bunny|hare|fox)\b/.test(txt)) return { role: 'wild', kind: 'animal' };
    return null; // unknown creature (a dragon, a bat swarm): leave it alone
  }
  if (/\b(farmer|farm ?hand|gardener)\b/.test(txt)) return { role: 'farmer', kind: 'person' };
  if (/\b(blacksmith|smith|armorer|forge)\b/.test(txt)) return { role: 'blacksmith', kind: 'person' };
  if (/\b(merchant|shopkeeper|trader|vendor|peddler|innkeeper|baker)\b/.test(txt)) return { role: 'merchant', kind: 'person' };
  if (/\b(bard|minstrel|musician|troubadour)\b/.test(txt)) return { role: 'bard', kind: 'person' };
  if (/\b(child|kid|boy|girl|youngster)\b/.test(txt) && !/\bgirl-?friend/.test(txt)) return { role: 'child', kind: 'person' };
  if (/\b(king|queen|monarch)\b/.test(txt)) return { role: 'king', kind: 'person' };
  if (/\b(wizard|sage|mystic)\b/.test(txt)) return { role: 'wizard', kind: 'person' };
  if (ally && f.follow !== null && f.follow !== undefined) return { role: 'ally', kind: 'ally' };
  if (/\b(guard|knight|militia|soldier|sentinel|paladin|watchman)\b/.test(txt)) return { role: 'guard', kind: ally ? 'ally' : 'person' };
  if (ally) return { role: 'ally', kind: 'ally' };
  if (f) return null; // some other fighter (a custom neutral mob): keep its brain
  return { role: 'villager', kind: 'person' }; // plain neutral humanoid
}

// ---- time of day -------------------------------------------------------------------------------------------------
export const phaseOf = (h) => (h < 5 || h >= 22 ? 'night' : h < 6.5 ? 'dawn' : h < 12 ? 'morning' : h < 13.5 ? 'noon' : h < 18 ? 'afternoon' : 'evening');
// day fraction 0..1 (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset) <-> world.env.timeOfDay (0 night, 0.5 twilight, 1 golden hour)
export const todFromTime = (t) => 0.5 - 0.5 * Math.cos(t * 6.283185307);
export const timeFromTod = (tod, rising = true) => {
  const s = Math.max(-1, Math.min(1, 1 - 2 * tod)); // cos(2 pi t)
  const t = Math.acos(s) / 6.283185307;               // 0..0.5 (the rising half)
  return rising ? t : 1 - t;
};
// the task a role is on at hour h: 'sleep' | 'wake' | 'work' | 'meal' | 'gather'
export function taskAt(role, h) {
  if (role === 'child') return h < 6.5 || h >= 20.5 ? 'sleep' : h < 7 ? 'wake' : h >= 12 && h < 13 ? 'meal' : h >= 18 ? 'gather' : 'work';
  if (role === 'guard') return h >= 12 && h < 12.75 ? 'meal' : 'work'; // guards patrol day and night (shift change at dusk)
  if (role === 'bard') return h < 8.5 || h >= 23.5 ? 'sleep' : h < 9.5 ? 'wake' : h >= 12 && h < 13 ? 'meal' : h >= 18 ? 'work' : 'work';
  if (role === 'king') return h < 7 || h >= 23 ? 'sleep' : h < 8 ? 'wake' : h >= 12 && h < 14 ? 'meal' : h >= 19 ? 'gather' : 'work';
  if (role === 'wizard') return h < 8 || h >= 23.5 ? 'sleep' : h < 9 ? 'wake' : h >= 13 && h < 14 ? 'meal' : h >= 19 ? 'gather' : 'work';
  const p = phaseOf(h);
  return p === 'night' ? 'sleep' : p === 'dawn' ? 'wake' : p === 'noon' ? 'meal' : p === 'evening' ? 'gather' : 'work';
}

// ---- structures --------------------------------------------------------------------------------------------------
// name pattern -> { kind, door: metres in front of the footprint edge, cap: residents it can house }
// Library groups are named 'lib:<entry>'; their local +Z is the front (yaw). A group may also carry userData.society = { kind, door:[lx,lz]|{x,z}, cap, role } (see docs/SOCIETY.md).
export const STRUCT = [
  [/^(cottage|house|farmhouse|ruined-house)$/, { kind: 'house', door: 1.0, cap: 3, depth: 3.2 }],
  [/^(hut)$/, { kind: 'house', door: 1.0, cap: 2, depth: 2.6 }],
  [/^(tent)$/, { kind: 'house', door: 0.9, cap: 2, depth: 2.4 }],
  [/^(barracks|castle-keep|castle-tower)$/, { kind: 'house', door: 1.2, cap: 4, depth: 4, guards: true }],
  [/^(tavern)$/, { kind: 'tavern', door: 1.2, depth: 4.5 }],
  [/^(church)$/, { kind: 'church', door: 1.2, depth: 5 }],
  [/^(blacksmith-shop|forge-workbench)$/, { kind: 'smithy', door: 1.2, depth: 3.5 }],
  [/^(market-stall|bazaar)$/, { kind: 'stall', door: 0.8, depth: 1.6 }],
  [/^(well|fountain)$/, { kind: 'well', door: 1.4, depth: 1.2 }],
  [/^(bonfire|campsite|fire-basket|cauldron)$/, { kind: 'fire', door: 1.2, depth: 0.8 }],
  [/^(corn-field|wheat-field|vegetable-patch|pumpkin-patch)$/, { kind: 'crops', door: 0, depth: 4 }],
  [/^(scarecrow)$/, { kind: 'crops', door: 0, depth: 1 }],
  [/^(windmill|watermill|lumber-mill)$/, { kind: 'mill', door: 1.0, depth: 3 }],
  [/^(watchtower|gate|archery-range)$/, { kind: 'tower', door: 1.4, depth: 2.5 }],
  [/^(signpost|signboard)$/, { kind: 'sign', door: 0.8, depth: 0.5 }],
  [/^(anvil)$/, { kind: 'anvil', door: 1.0, depth: 0.8 }],
  [/^(throne|omni-throne)$/, { kind: 'throne', door: 1.2, depth: 1.5 }],
  [/^(lantern|torch-stand|bench|table|bed|barrel|crate)$/, { kind: 'prop', door: 0.6, depth: 0.5 }],
];
// scenarios that bring their own layout (local metres, x right / z front) the library does not expose as separate groups
export const SCENARIO = {
  farm: { kind: 'farm', barn: [0, -4.4], crops: [[-17, 0], 7], pen: [11, 7, 5] },
  village: { kind: 'village' },
  'medieval-market': { kind: 'market' },
  harbour: { kind: 'harbour' },
  'castle-courtyard': { kind: 'castle' },
};
// weather / time-of-day controlling effects: while one of these lives, the clock only OBSERVES the sky
export const SKY_OWNERS = new Set(['rain', 'storm', 'snow', 'fog-bank', 'night', 'dusk', 'day', 'aurora', 'meteor-shower', 'rainbow', 'falling-leaves', 'embers']);
export const RAIN_LIKE = new Set(['rain', 'storm', 'snow']);

// ---- reputation --------------------------------------------------------------------------------------------------
export function band(r) { return r >= 60 ? 'adored' : r >= 25 ? 'liked' : r >= 6 ? 'friendly' : r > -8 ? 'neutral' : r > -30 ? 'disliked' : r > -60 ? 'hated' : 'outlaw'; }
export const greetBand = (r) => (r >= 60 ? 'adored' : r >= 15 ? 'liked' : r > -8 ? 'neutral' : r > -30 ? 'wary' : 'hostile');
export const priceMult = (r) => (r >= 60 ? 0.8 : r >= 25 ? 0.9 : r >= 6 ? 0.95 : r > -8 ? 1 : r > -30 ? 1.2 : 1.4);
export const BOUNTY_HOSTILE = 30;   // guards attack on sight from this bounty
export const BOUNTY_REFUSE = 30;    // merchants refuse to trade from this bounty
export const BOUNTY_DECAY_PER_HOUR = 8; // in-game hours (a 20 min day = 50 s per hour)
export const TIER_AT = [8, 24, 52];  // growth points needed for tier 1, 2, 3

// ---- economy -----------------------------------------------------------------------------------------------------
export const WEAPON_PRICE = {
  torch: 8, hoe: 20, shovel: 20, club: 25, dagger: 35, boomerang: 45, 'smoke-bomb': 30, grenade: 60, pickaxe: 70, shield: 80, spear: 90, bow: 95, axe: 100, sword: 120, mace: 130, wand: 140, scythe: 150,
  'spiked-shield': 170, 'tower-shield': 190, crossbow: 220, warhammer: 240, 'magic-staff': 300, katana: 320, spellbook: 330, 'great-axe': 360, greatsword: 380, revolver: 400, blaster: 450, shotgun: 480, rifle: 520,
};
export const STOCK = {
  merchant: ['torch', 'club', 'dagger', 'boomerang', 'shield', 'bow', 'spear', 'axe', 'smoke-bomb', 'grenade'],
  blacksmith: ['sword', 'axe', 'mace', 'spear', 'shield', 'tower-shield', 'spiked-shield', 'warhammer', 'katana', 'greatsword', 'great-axe', 'crossbow', 'pickaxe', 'dagger'],
  wizard: ['wand', 'magic-staff', 'spellbook'],
};
export const POTIONS = [
  { id: 'heal', name: 'Healing draught', price: 30, color: 0xff5a6a, seconds: 0, desc: 'Restores 60 health at once.' },
  { id: 'speed', name: 'Swiftness draught', price: 45, color: 0x5ad8ff, seconds: 60, desc: 'Run 40% faster for a minute.' },
  { id: 'strength', name: 'Strength draught', price: 60, color: 0xffb040, seconds: 60, desc: 'Weapons hit 50% harder for a minute.' },
];
export const COMPANIONS = [
  { id: 'dog', name: 'Dog', lib: 'dog', price: 120, desc: 'A friendly dog that trots after you.' },
  { id: 'cat', name: 'Cat', lib: 'cat', price: 80, desc: 'A house cat. Judges you quietly.' },
  { id: 'guard-dog', name: 'Guard dog', lib: 'guard-dog', price: 220, desc: 'Barks at danger, bites enemies.' },
  { id: 'fairy', name: 'Fairy', lib: 'fairy', price: 180, desc: 'A glowing fairy that orbits you.' },
  { id: 'robot-buddy', name: 'Robot buddy', lib: 'robot-buddy', price: 300, desc: 'A hovering helper that zaps enemies.' },
  { id: 'wolf-companion', name: 'Tame wolf', lib: 'wolf-companion', price: 420, desc: 'A silver wolf that hits hard.' },
];
export const KITS = [
  { id: 'campfire', name: 'Campfire', lib: 'bonfire', opts: { scale: 0.6 }, price: 70, desc: 'A crackling fire to sit around.' },
  { id: 'lantern', name: 'Lantern', lib: 'lantern', price: 12, desc: 'A lantern to carry or hang.' },
  { id: 'fence', name: 'Fence (6 m)', lib: 'fence', opts: { length: 6 }, price: 30, desc: 'A length of wooden fence.' },
  { id: 'tent', name: 'Tent', lib: 'tent', price: 60, desc: 'A canvas tent.' },
  { id: 'hut', name: 'Hut', lib: 'hut', price: 140, desc: 'A round thatched hut.' },
  { id: 'cottage', name: 'Cottage', lib: 'cottage', price: 260, desc: 'A timber-and-stone cottage.' },
  { id: 'bench', name: 'Bench', lib: 'bench', price: 20, desc: 'A seat for three.' },
  { id: 'well', name: 'Well', lib: 'well', price: 80, desc: 'A stone well.' },
  { id: 'stall', name: 'Market stall', lib: 'market-stall', price: 90, desc: 'A striped market stall.' },
  { id: 'watchtower', name: 'Watchtower', lib: 'watchtower', price: 350, desc: 'A tall wooden lookout.' },
];
export const COSMETICS = [
  { id: 'fireflies', name: 'Firefly halo', lib: 'fireflies', opts: { count: 40, follow: true }, price: 90, desc: 'Fireflies that follow you.' },
  { id: 'embers', name: 'Ember cloak', lib: 'embers', opts: { count: 80, follow: true }, price: 140, desc: 'Embers drifting around you.' },
  { id: 'butterflies', name: 'Butterflies', lib: 'butterflies', price: 60, desc: 'A cloud of butterflies.' },
  { id: 'balloons', name: 'Balloons', lib: 'balloon-bunch', price: 25, desc: 'Seven helium balloons.' },
  { id: 'banner', name: 'Banner', lib: 'banner', price: 35, desc: 'A tall cloth banner.' },
  { id: 'confetti', name: 'Confetti pop', lib: 'confetti-burst', price: 15, desc: 'A burst of confetti.' },
  { id: 'rainbow', name: 'Rainbow', lib: 'rainbow', price: 200, desc: 'A rainbow across the sky.' },
];
export const SELL_FACTOR = 0.35;
// coin value of a slain enemy by name (default: from its max hp)
export const COIN_VALUE = { goblin: 3, 'goblin-archer': 4, 'goblin-shaman': 6, skeleton: 4, 'skeleton-archer': 5, zombie: 5, bandit: 8, 'bandit-archer': 8, pirate: 8, cultist: 9, necromancer: 20, orc: 8, 'orc-brute': 12, troll: 25, ogre: 25, 'dark-knight': 30, demon: 40, wolf: 2, 'giant-spider': 6, slime: 2, 'lich-king': 160, 'ancient-dragon': 300 };
export const GIFTS = { farmer: 'bread', merchant: 'heal', blacksmith: 'dagger', bard: 'flower', villager: 'bread', child: 'flower', wizard: 'speed', king: 'coins', guard: 'heal' };

// persona length budget (server clamps to 240)
export const PERSONA_MAX = 236;
