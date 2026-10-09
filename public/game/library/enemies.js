// library/enemies.js - hostile things (faction 'enemy'). Humanoid/creature enemies use kit actors; the rest are custom mobs
// (library engine adapter) driven by the same combat.fighter brain. Every entry also gets an ENCOUNTER kit from library/behaviors.js
// (H.behaviors, see docs/ENCOUNTERS.md): telegraphed charges, leaps, shields, packs, healers, summoners ... The bosses live in library/bosses.js.
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, ease, shade, mix, fightOpts, DEATH } = H;
  const PI = Math.PI, FLIP = [PI, 0, 0];
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'enemies', description, options, aliases, build, ...extra });
  const _pt = new THREE.Vector3();
  const B = H.behaviors;
  // arm(i, { a, f }, [behaviours], ctrlOptions) for biped / beast results;  armM(i, { actor, fighter }, ...) for H.monster results
  const arm = (i, r, list, o) => (B && r && r.a && r.f ? B.attach(i, r.a, r.f, list, o) : null);
  const armM = (i, r, list, o) => (B && r && r.actor && r.fighter ? B.attach(i, r.actor, r.fighter, list, o) : null);

  const { part, puffAt, shout, biped, beast, mdl, worldAdd } = H;

  // ================================================================== CASTING (see H.cast in gear.js)
  // Art style plan: KayKit chunky heroes / skeletons for fighters and humanoid monsters, Kenney minis for the undead of the graveyard kit (zombie,
  // ghost) and cube animals for beasts. Each list is ordered: the preferred (possibly not yet shipped) hero model first, then a stand-in made from a
  // KayKit hero by tint + height + gear, and when nothing resolves the entry's own primitive build is used.
  const NOEQ = { right: null, left: null };
  const CAST = {
    goblin: [{ model: 'goblin', rig: 'kaykit-medium', height: 1.15, hold: { right: 'dagger' }, weaponType: 'dagger' },
      { model: 'rogue-hooded', tint: 0x9be86a, height: 1.2, hold: { right: 'dagger' }, equip: NOEQ, weaponType: 'dagger' }],
    goblinBomber: [{ model: 'goblin', rig: 'kaykit-medium', height: 1.12, tint: 0xe0b8a0, hold: { right: 'grenade-a' } },
      { model: 'rogue-hooded', tint: 0xc8e08a, height: 1.2, equip: NOEQ }],
    goblinArcher: [{ model: 'goblin', rig: 'kaykit-medium', height: 1.1, hold: { right: 'crossbow' } },
      { model: 'rogue', tint: 0xa9e07a, height: 1.2, equip: { right: '1H_Crossbow', left: null } }],
    goblinShaman: [{ model: 'goblin-shaman', rig: 'kaykit-medium', height: 1.25, hold: { right: 'wand' }, caster: true, weaponType: 'wand' },
      { model: 'rogue-hooded', tint: 0xb89cf0, height: 1.25, hold: { right: 'wand' }, equip: NOEQ, caster: true, weaponType: 'wand' }],
    // 'orc' is the Kenney mini orc; the KayKit-rig hero is called orc-warrior
    orc: [{ model: 'orc-warrior', rig: 'kaykit-medium', height: 2.2, hold: { right: 'great-axe' }, weaponType: 'axe' },
      { model: 'orc', rig: 'kenney-mini', height: 2.3, bulk: 1.1, hold: { right: 'great-axe' }, weaponType: 'axe' }],
    demon: [{ model: 'demon', rig: 'kaykit-medium', height: 2.3, hold: { right: 'skeleton-axe' }, weaponType: 'axe' },
      { model: 'skeleton-minion', tint: 0xe05040, height: 2.2, gore: 'blood', hold: { right: 'skeleton-axe' }, weaponType: 'axe' }],
    skeleton: [{ model: 'skeleton-warrior', height: 1.78, gore: 'bones', hold: { right: 'skeleton-blade' }, weaponType: 'sword' }],
    skeletonMinion: [{ model: 'skeleton-minion', height: 1.7, gore: 'bones', hold: { right: 'skeleton-blade' }, weaponType: 'sword' }],
    skeletonArcher: [{ model: 'skeleton-rogue', height: 1.75, gore: 'bones', hold: { right: 'skeleton-crossbow' } }],
    zombie: [{ model: 'zombie', height: 1.75 }],
    bandit: [{ model: 'rogue', tint: 0x7a6660, height: 1.78, hold: { right: 'sword' }, equip: NOEQ, weaponType: 'sword' }],
    darkKnight: [{ model: 'dark-knight', rig: 'kaykit-medium', height: 2.1, hold: { right: 'sword', left: 'shield-spikes' }, equip: NOEQ, weaponType: 'sword' },
      { model: 'knight', tint: 0x3c3c48, height: 2.05, bulk: 1.1, hold: { right: 'sword', left: 'shield-spikes' }, equip: NOEQ, weaponType: 'sword' }],
    cultist: [{ model: 'mage', tint: 0xc04a86, height: 1.8, equip: { right: '1H_Wand', left: null }, weaponType: 'wand', caster: true }],
    necromancer: [{ model: 'mage', tint: 0x5a4878, height: 1.95, hold: { right: 'skeleton-staff' }, equip: NOEQ, caster: true, weaponType: 'magic-staff' }],
    troll: [{ model: 'troll', rig: 'kaykit-medium', height: 3.0, hold: { right: 'great-axe' }, weaponType: 'axe' },
      { model: 'orc', rig: 'kenney-mini', tint: 0xb4c2a6, height: 3.0, bulk: 1.2, hold: { right: 'great-axe' }, weaponType: 'axe' }],
    ogre: [{ model: 'troll', rig: 'kaykit-medium', tint: 0xf0c890, height: 2.7, bulk: 1.2, hold: { right: 'axe' }, weaponType: 'axe' },
      { model: 'orc', rig: 'kenney-mini', tint: 0xf4c890, height: 2.7, bulk: 1.45, hold: { right: 'axe' }, weaponType: 'axe' }],
    wolf: [{ model: 'dog', tint: 0x92bcf8, size: 0.9 }],
    bear: [{ model: 'polar', tint: 0x8a6444, size: 1.8 }],
    wraith: [{ model: 'ghost', tint: 0x9fc8ff, height: 2.0, hover: 0.4, bob: 0.1, bobF: 1.6, gore: 'none', death: 'fade', limbs: false }],
    // dragons (own armature: idle walk fly attack breathe hit die roar): mobs, see H.modelRig; the primitive dragonRig below is the fallback
    dragonWhelp: [{ model: 'dragon-whelp', rig: 'dragon', height: 1.8, flies: true }],
    dragon: [{ model: 'dragon', rig: 'dragon', height: 5.2 }],
    imp: [{ model: 'demon', rig: 'kaykit-medium', height: 1.15, hover: 0.8, bob: 0.15, bobF: 4, hold: { right: 'dagger' }, weaponType: 'dagger' }],
    lich: [{ model: 'skeleton-minion', tint: 0xc4b4ec, gearHead: 1.9, height: 2.65, gore: 'bones', hold: { right: 'skeleton-staff' }, caster: true, weaponType: 'magic-staff' }],
  };
  H.CAST = Object.assign(H.CAST || {}, { enemies: CAST });
  const head = () => H.head;

  // ================================================================== HUMANOID ENEMIES
  // ---- goblins: a cowardly pack. They circle, one or two dart in and stab, then scatter; they break and run when hurt, alone, or leaderless.
  def('goblin', 'cowardly green pack skirmisher with a rusty dagger: circles you with its friends, darts in and out, bolts when hurt or left alone', 'faction, hp, damage', ['gobbo', 'goblin warrior', 'goblins'], (i, o) => {
    const r = biped(i, o, { model: CAST.goblin, h: 1.15, skin: 0x5f9b3d, shirt: 0x6b4a2b, pants: 0x3e3626, hp: 14, dmg: 4, cd: 1.5, windup: 0.5, speed: 3.1, aggro: 15, gear: [['head', 'ears', 0x5f9b3d]], weapon: 'dagger',
      puff: 0x5f9b3d, drops: [{ type: 'dagger', chance: 0.3 }], lines: ['Mine! Mine!', 'Stab stab!', 'Shinies!', 'Hehehe!'] });
    arm(i, r, [B.morale({ hp: 0.35, alone: true, away: [4, 7], leaderLine: 'Boss is dead! Run!' }), B.skirmisher({ dist: 4.5, min: 0.9, max: 1.6 }), B.circler({ radius: 3.4, pack: true })],
      { lines: { flee: ['Eep! Run!', 'Too scary!', 'Nope nope nope!'], return: ['Back again!', 'Hehehe, found you!'] } });
  });
  def('goblin-bomber', 'goblin with a sack of lit bombs: lobs them in high arcs (the landing spot glows red for over a second), keeps its distance and flees when cornered', 'faction, hp, damage', ['bomb goblin', 'goblin sapper', 'goblin grenadier', 'goblin bombardier'], (i, o) => {
    const r = biped(i, o, { model: CAST.goblinBomber, h: 1.12, skin: 0x7aa84a, shirt: 0x8a3a2a, pants: 0x3a3020, hat: 0x3a3a3a, hp: 12, dmg: 4, cd: 1.7, windup: 0.5, speed: 3.0, aggro: 18, gear: [['head', 'ears', 0x7aa84a], ['pivot', 'backpack', 0x4a3320], ['head', 'goggles']], weapon: 'grenade',
      puff: 0xff8a20, puffKind: 'fire', drops: [{ type: 'grenade', chance: 0.5 }], lines: ['Boom boom time!', 'Catch!', 'Big bang!', 'Heehee, hot!'] });
    arm(i, r, [B.morale({ hp: 0.4, alone: false, away: [3, 5] }), B.bomber({ min: 5, max: 16, windup: 0.85, flight: 1.3, radius: 2.2, dmg: 2.0, cd: [4.5, 7], color: 0x2a2a2a, trail: 0xff9a30 }), B.skirmisher({ dist: 6, min: 1.2, max: 2 }), B.circler({ radius: 6.5, pack: true })],
      { lines: { throw: ['Boom!', 'Heads up!', 'Fire in the hole!'], flee: ['Out of bombs!', 'Aaah!'] }, priority: 1 });
  });
  def('goblin-archer', 'small goblin sniper with a shortbow; a faint green aim line shows where the arrow will go, then it scurries to a new spot', 'faction, hp, damage', ['goblin bowman', 'goblin shooter'], (i, o) => {
    const r = biped(i, o, { model: CAST.goblinArcher, h: 1.1, skin: 0x6aa646, shirt: 0x4a5a2a, pants: 0x3a3020, hat: 0x4a5a2a, hp: 10, dmg: 4, attack: 'ranged', range: 15, cd: 2.4, windup: 0.85, speed: 2.8, aggro: 19,
      proj: { color: 0xc8e04a, speed: 12, radius: 0.1, splash: 0.2 }, gear: [['head', 'ears', 0x6aa646], ['pivot', 'quiver']], weapon: 'bow', puff: 0x6aa646,
      drops: [{ type: 'bow', chance: 0.25 }], lines: ['Pew pew!', 'Hehe, missed!', 'Run, tall one!'] });
    arm(i, r, [B.morale({ hp: 0.4, alone: true }), B.sniper({ color: 0x9ae04a, width: 0.025, ideal: 0.7 })], { lines: { flee: ['Eep!', 'Too close!'] } });
  });
  def('goblin-shaman', 'goblin witch-doctor with a glowing wand: heals wounded goblins and whips fighting ones into a frenzy from behind its pack; kill it first', 'faction, hp, damage', ['goblin mage', 'goblin witch', 'goblin caster', 'witch doctor', 'goblin sorcerer'], (i, o) => {
    const r = biped(i, o, { model: CAST.goblinShaman, h: 1.2, skin: 0x6aa646, shirt: 0x5a2a6a, pants: 0x3a2a40, hat: 0x5a2a6a, hp: 16, dmg: 4, attack: 'ranged', range: 15, cd: 2.6, windup: 0.8, speed: 2.6, aggro: 19,
      proj: { color: 0x8aff4a, speed: 11, radius: 0.14, splash: 0.5 }, gear: [['head', 'ears', 0x6aa646]], weapon: 'wand', puff: 0x8aff4a, puffKind: 'glow',
      drops: [{ type: 'wand', chance: 0.3 }], lines: ['Curses upon you!', 'Boom-boom magic!', 'Shinies for the shaman!'] });
    arm(i, r, [B.morale({ hp: 0.35, alone: true }), B.healer({ heal: 10, enrage: true, enrageFor: 8, cd: [4.5, 6.5], range: 13 }), B.hider({ min: 8 })],
      { priority: 3, lines: { heal: ['Heal, heal!', 'Get up, get up!'], enrage: ['Kill, kill, KILL!', 'Rrrage!'], flee: ['Mercy!'] } });
  });
  def('demon', 'horned red fiend wreathed in a ring of flame (stay out of the ring or strike from range); leaps at you with a glowing landing circle and a flaming shockwave', 'faction, hp, damage', ['fiend', 'horned demon', 'daemon', 'hell spawn', 'demons'], (i, o) => {
    const r = biped(i, o, { model: CAST.demon, h: 2.3, skin: 0xc03a2a, shirt: 0x4a1a1a, pants: 0x3a1010, hp: 70, dmg: 10, range: 1.9, cd: 2.0, windup: 0.65, speed: 3.0, aggro: 18,
      gear: [['head', 'hornHelm', 0xc03a2a]], weapon: 'axe', puff: 0xff5a20, puffKind: 'fire', drops: [{ type: 'axe', chance: 0.4 }], lines: ['Your soul is mine!', 'BURN!', 'Hell hungers.'] });
    arm(i, r, [B.aura({ kind: 'fire', r: 2.3, dps: 2, color: 0xff5a1a }), B.leaper({ min: 5, max: 13, tele: 0.8, radius: 3.0, dmg: 1.2, fire: true, zone: 3, color: 0xff5a20, cd: [7, 11] })],
      { lines: { leap: ['Down you go!', 'Come here!'] } });
  });
  def('orc-brute', 'hulking tusked orc: lowers its head and CHARGES in a straight line after a red lane appears (side-step it; it smashes scenery and is dazed if it hits a wall); enrages when hurt', 'faction, hp, damage', ['orc', 'orc warrior', 'orc brute'], (i, o) => {
    const r = biped(i, o, { model: CAST.orc, h: 2.15, bulk: 1.25, skin: 0x4e7a3a, shirt: 0x5a3a2a, pants: 0x40362e, hair: 0x14100e, hp: 75, dmg: 11, range: 2.1, cd: 2.4, windup: 0.8, speed: 2.2, aggro: 15,
      gear: [['head', 'tusks'], ['pivot', 'spikes', 0x6a5a4a], ['pivot', 'belt']], weapon: 'big-axe', puff: 0x4e7a3a, drops: [{ type: 'axe', chance: 0.5 }], lines: ['WAAAGH!', 'Crush!', 'Blood and bones!'] });
    arm(i, r, [B.berserk({ hp: 0.4, roar: 1.0 }), B.charger({ tele: 1.0, len: 12, speed: 9.5, min: 5, max: 14, dmg: 1.3, cd: [6, 9], stun: 1.4 })],
      { lines: { charge: ['CHAAARGE!', 'Out of my way!'], berserk: ['RAAAAGH!'] } });
  });
  def('skeleton', 'clattering undead swordsman with glowing eye sockets; killed by blade or arrow it rebuilds ONCE after a few seconds (smash the bones with a hammer or a blast to stop it)', 'faction, hp, damage', ['skeleton warrior', 'skeletons', 'bones'], (i, o) => {
    const r = biped(i, o, { model: o.variant === 'minion' ? CAST.skeletonMinion : CAST.skeleton, gore: 'bones', h: 1.78, skin: 0xe6dfc8, shirt: 0xd8d0b8, pants: 0xe6dfc8, hp: 20, dmg: 5, cd: 1.8, windup: 0.55, speed: 2.5, aggro: 16,
      gear: [['head', 'skull'], ['head', 'eyes', 0x7affc8], ['pivot', 'ribs']], weapon: 'rusty-sword', puff: 0xe6dfc8, puffKind: 'bits', drops: [{ type: 'sword', chance: 0.2 }],
      die: (a) => { const s = i.snd(); for (let k = 0; k < 4; k++) s.noise({ dur: 0.05, filter: { type: 'bandpass', freq: 2200 + k * 400, q: 4 }, vol: 0.25, at: a.position, delay: k * 0.05 }); },
      lines: ['*clatter*', 'Rattle rattle...', 'Join us!', 'Bones!'] });
    const bs = []; if (!o.reassembled && o.reassemble !== false) bs.push(B.reassemble({ hp: 0.55, variant: o.variant, delay: 3.4 }));
    const ctl = arm(i, r, bs, { lines: { reborn: ['Not... yet...', 'Again!'] } });
    if (ctl && o.reassembled) ctl.flags.reborn = true;
  });
  def('skeleton-archer', 'skeleton with a warped bow: a pale aim line marks the shot (about a second), then it shuffles to a new firing spot', 'faction, hp, damage', ['skeleton bowman', 'skeleton shooter'], (i, o) => {
    const r = biped(i, o, { model: CAST.skeletonArcher, gore: 'bones', h: 1.75, skin: 0xd8d0b8, shirt: 0xc8c0a8, pants: 0xd8d0b8, hp: 16, dmg: 5, attack: 'ranged', range: 17, cd: 2.5, windup: 0.9, speed: 2.4, aggro: 21,
      proj: { color: 0xf0ecd8, speed: 13, radius: 0.1, splash: 0.2 }, gear: [['head', 'skull'], ['head', 'eyes', 0x7affc8], ['pivot', 'ribs'], ['pivot', 'quiver', 0x4a3a2a]], weapon: 'bow',
      puff: 0xe6dfc8, puffKind: 'bits', drops: [{ type: 'bow', chance: 0.3 }], lines: ['*twang*', 'Rattle...'] });
    arm(i, r, [B.sniper({ color: 0xdfe8d0, width: 0.03, ideal: 0.75 })], { priority: 2 });
  });
  def('zombie', 'slow, relentless corpse: groans toward you, grabs (arms out, then you are slowed until you strike it twice) and keeps crawling even with no legs', 'faction, hp, damage', ['zombies', 'undead', 'walker'], (i, o) => {
    const r = biped(i, o, { model: CAST.zombie, h: 1.7, skin: 0x7f9a6a, shirt: 0x4a4a3a, pants: 0x2f3a2a, hair: 0x2a2a1a, hp: 32, dmg: 6, cd: 1.9, windup: 0.75, speed: 1.4, aggro: 24, gear: [['head', 'eyes', 0xffe05a]],
      puff: 0x6a8a50, lines: ['Brraaains...', 'Hnnnngh...', 'Uuhhhh...'] });
    arm(i, r, [B.crawler(), B.grabber({ tele: 0.9, reach: 2.0, hold: 3.6, slow: 0.35, cd: [6, 9] })], { sayGap: 14, lines: { grab: ['Hnnngh...'] } });
    if (r.f) r.f.leash = 90;
    if (r.a) { let n = rand(2, 7); i.tick((dt, t) => { if (r.a.removed || r.a.dead) return true; n -= dt; if (n < 0) { n = rand(5, 12); i.snd().tone({ freq: 110, freqEnd: 70, dur: 0.9, type: 'sawtooth', vol: 0.08, at: r.a.position }); } }, { every: 0.5 }); }
  });
  def('bandit', 'masked highwayman with a sword; circles for an opening, lunges, and runs if it is left alone or badly hurt', 'faction, hp, damage', ['highwayman', 'thief', 'robber', 'bandits'], (i, o) => {
    const r = biped(i, o, { model: CAST.bandit, h: 1.75, skin: 0xd6a17a, shirt: 0x6a3b3b, pants: 0x3b3226, hair: 0x2a1a10, hp: 26, dmg: 6, cd: 1.7, windup: 0.55, speed: 2.9, aggro: 16,
      gear: [['head', 'mask', 0x7a2020], ['pivot', 'belt']], weapon: 'sword', puff: 0xb09070, drops: [{ type: 'dagger', chance: 0.35 }, { type: 'crossbow', chance: 0.15 }],
      lines: ['Your coin or your life!', 'Hand it over!', 'Nice gear. Mine now.', 'Get him, lads!'] });
    arm(i, r, [B.morale({ hp: 0.3, alone: true, away: [4, 7] }), B.circler({ radius: 3.0 })], { lines: { flee: ['Not worth it!', 'I yield!'], return: ['One more try!'] } });
  });
  def('dark-knight', 'black-plate duelist with sword and spiked shield: frontal blows are blocked (strike from the side, or break the shield with heavy hits), and a gold ring on the ground means a parry stance - hit it then and it ripostes', 'faction, hp, damage', ['black knight', 'evil knight', 'knight of darkness'], (i, o) => {
    const r = biped(i, o, { model: CAST.darkKnight, h: 2.05, bulk: 1.1, skin: 0x2a2a30, shirt: 0x23232b, pants: 0x1c1c22, hp: 85, dmg: 10, range: 1.9, cd: 2.1, windup: 0.8, speed: 2.2, aggro: 17,
      gear: [['head', 'greatHelm', 0x2a2a32, 0xff3a2a], ['pivot', 'cape', 0x3a0f16], ['pivot', 'pauldrons', 0x2a2a34], ['pivot', 'armor', 0x23232b]], weapon: 'sword', puff: 0x40404a,
      drops: [{ type: 'greatsword', chance: 0.6 }], lines: ['Kneel.', 'Your end is written.', 'Darkness takes you.'] });
    if (r.a) r.a.whenPrimitive((pa) => H.gear(pa, 'armL', H.weaponMesh('shield'), 0.1, -0.3, 0.1, 0.8, [0, PI, 0]));
    arm(i, r, [B.shield({ arc: 2.0, hp: 55, down: 4.5 }), B.parry({ window: 1.5, reach: 5, cd: [6, 9] }), B.circler({ radius: 2.8 })],
      { lines: { guard: ['Try me.'], riposte: ['Predictable.'], shield: ['My guard...'] } });
  });
  def('cultist', 'hooded fanatic: throws fire pots that burst in a glowing circle and leave burning ground, and hurls fireballs from a burning brand', 'faction, hp, damage', ['cult member', 'fire cultist', 'fanatic', 'acolyte'], (i, o) => {
    const r = biped(i, o, { model: CAST.cultist, h: 1.75, skin: 0xcaa890, shirt: 0x5a1a5a, pants: 0x4a1850, hp: 18, dmg: 5, attack: 'ranged', range: 14, cd: 2.5, windup: 0.85, speed: 2.4, aggro: 18,
      proj: { color: 0xff7a20, speed: 9, radius: 0.18, splash: 0.8 }, gear: [['head', 'hood', 0x3a1040], ['pivot', 'robe', 0x4a1850], ['head', 'eyes', 0xffb060]], weapon: 'torch',
      puff: 0x6a2a6a, drops: [{ type: 'wand', chance: 0.3 }], lines: ['Embrace the flame!', 'Burn for the Ember King!', 'Join us!'] });
    arm(i, r, [B.morale({ hp: 0.3, alone: true }), B.bomber({ min: 6, max: 15, windup: 0.9, flight: 1.4, radius: 2.0, dmg: 1.3, cd: [6.5, 9], color: 0xff7a20, trail: 0xffa040, zone: 3.5, boom: 1.0, kind: 'fire' }), B.sniper({ laser: false, ideal: 0.7 })], { lines: { throw: ['Burn!', 'Feel the flame!'] } });
  });
  def('necromancer', 'robed death-mage that raises the corpses lying around (or skeletons from the ground, in glowing circles) and fires soul bolts from behind them; priority target', 'faction, hp, summonMax', ['lich acolyte', 'death mage', 'warlock', 'dark mage'], (i, o) => {
    const r = biped(i, o, { model: CAST.necromancer, h: 1.9, skin: 0xc9d6c0, shirt: 0x1a1424, pants: 0x120e1a, hp: 45, dmg: 6, attack: 'ranged', range: 16, cd: 2.7, windup: 0.9, speed: 2.0, aggro: 22,
      proj: { color: 0xa56bff, speed: 8, radius: 0.2, splash: 0.6 }, gear: [['head', 'hood', 0x1a1424], ['pivot', 'robe', 0x1a1424], ['head', 'eyes', 0x7affc8], ['pivot', 'mantle', 0x2a1f3a]],
      weapon: 'skull-staff', puff: 0x7affc8, puffKind: 'glow', drops: [{ type: 'magic-staff', chance: 0.7 }], lines: ['Rise, my servants!', 'Death is only the beginning.', 'Bones, to me!'] });
    arm(i, r, [B.morale({ hp: 0.25, alone: true }), B.summoner({ max: o.summonMax ?? 4, n: 2, every: [8, 11], cd: [8, 11], kinds: ['skeleton'], opts: { variant: 'minion', reassembled: 1 }, corpses: true, tele: 1.2 }), B.hider({ min: 8 })],
      { priority: 3, lines: { summon: ['Rise!', 'Arise, bones!', 'Serve me again!'], flee: ['Impossible!'] } });
  });
  def('troll', 'giant grey-green brute that regenerates (fire, or constant hitting, stops it), hurls boulders with a glowing landing circle and a huge grab-and-toss up close (step out of the yellow circle)', 'faction, hp, damage', ['cave troll', 'trolls'], (i, o) => {
    const r = biped(i, o, { model: CAST.troll, h: 2.5, bulk: 1.3, skin: 0x7d8a6a, shirt: 0x6a5a40, pants: 0x4a4030, hair: 0x2a3020, hp: 110, dmg: 11, range: 2.1, cd: 2.4, windup: 0.85, speed: 2.1, aggro: 16,
      gear: [['head', 'tusks', 0xd8d0b0], ['pivot', 'loincloth', 0x6a4a2a]], weapon: 'spiked-club', puff: 0x7d8a6a, drops: [{ type: 'club', chance: 0.6 }], lines: ['Grrrah!', 'Crunch bones!', 'Troll hungry!'] });
    arm(i, r, [B.regenerator({ rate: 0.025, delay: 3.5, burnFor: 8 }), B.toss({ tele: 1.05, reach: 3.0, cd: [9, 13] }), B.thrower({ min: 7, max: 17, windup: 1.0, flight: 1.5, radius: 2.4, dmg: 1.0, cd: [8, 12], size: 0.45, color: 0x7a6a58, trail: 0x8a7a68, boom: 0, boomColor: 0x8a7a68, kind: 'blunt', force: 7 })],
      { lines: { toss: ['Troll squish!', 'Come here, snack!'], tossed: ['Hahaha!'], throw: ['Rock!', 'Catch!'] } });
  });
  def('ogre', 'enormous tan ogre with a belly and a big club; slow and loud: every few seconds it stamps (a big ground circle shows the blast)', 'faction, hp, damage', ['ogres', 'big ogre'], (i, o) => {
    const r = biped(i, o, { model: CAST.ogre, h: 2.7, bulk: 1.55, skin: 0xc9a06a, shirt: 0x8a4a2a, pants: 0x5a4030, hair: 0x3a2a1a, hp: 130, dmg: 12, range: 2.2, cd: 2.6, windup: 0.95, speed: 1.9, aggro: 15,
      gear: [['pivot', 'belt', 0x3a2a1a]], weapon: 'club', wscale: 1.2, puff: 0xc9a06a, drops: [{ type: 'warhammer', chance: 0.5 }], lines: ['Me hungry!', 'Fee fi... meat!', 'Tiny thing!', 'Smash!'] });
    arm(i, r, [B.stomper({ radius: 4.2, tele: 1.1, dmg: 1.2, reach: 3.6, cd: [7, 10] })], { lines: { stomp: ['STOMP!', 'Smash!'] } });
    if (r.a) {
      let n = rand(1, 3); // heavy footfalls
      i.tick((dt) => { if (r.a.removed || r.a.dead) return true; n -= r.a.speedNow > 0.8 ? dt : 0; if (n < 0) { n = 0.55; i.snd().tone({ freq: 70, freqEnd: 40, dur: 0.18, vol: 0.3, at: r.a.position }); } }, { every: 0.1 });
    }
  });
  def('battle-robot', 'armoured combat robot: a red laser line locks on for a second before each pulse-rifle shot, then it relocates', 'faction, hp, damage', ['robot', 'war robot', 'mech', 'combat robot', 'killbot'], (i, o) => {
    const r = biped(i, o, { h: 2.1, bulk: 1.1, skin: 0x7a8794, shirt: 0x5a6672, pants: 0x3a4450, hp: 95, dmg: 6, attack: 'ranged', range: 17, cd: 1.9, windup: 0.9, speed: 1.9, aggro: 21,
      proj: { color: 0xff4a3a, speed: 18, radius: 0.12, splash: 0.2 }, gear: [['head', 'visor', 0xff3a3a], ['pivot', 'chestGlow', 0xff3a3a], ['pivot', 'pauldrons', 0x6a7682]], weapon: 'rifle',
      puff: 0x6a7682, puffKind: 'spark', drops: [{ type: 'blaster', chance: 0.4 }],
      die: (a) => { H.kit()?.explosion(i.ctx, _pt.set(a.position.x, a.position.y + 1, a.position.z), { size: 1.0, color: 0xff8a30 }); },
      lines: ['TARGET ACQUIRED', 'HOSTILE DETECTED', 'EXTERMINATE', 'BZZT'] });
    arm(i, r, [B.sniper({ color: 0xff2a2a, width: 0.04, ideal: 0.7 })], { priority: 2 });
  });
  def('alien-grunt', 'big-headed grey-green alien trooper with a plasma pistol; hit-and-run, strafing around you', 'faction, hp, damage', ['alien', 'grey', 'alien trooper', 'martian'], (i, o) => {
    const r = biped(i, o, { h: 1.5, skin: 0x8fb0a0, shirt: 0x2a3a4a, pants: 0x1c2a36, hp: 26, dmg: 4, attack: 'ranged', range: 14, cd: 2.0, windup: 0.6, speed: 2.9, aggro: 18,
      proj: { color: 0x9aff6a, speed: 12, radius: 0.13, splash: 0.4 }, gear: [['head', 'bigHead', 0x8fb0a0]], weapon: 'alien-blaster', puff: 0x9aff6a, puffKind: 'glow',
      drops: [{ type: 'blaster', chance: 0.5 }], lines: ['Zzzrk!', 'Kree!', 'Take-you-specimen!'] });
    arm(i, r, [B.sniper({ laser: false, ideal: 0.6, minFrac: 0.35 }), B.circler({ radius: 7, pack: true })]);
  });

  // ================================================================== CREATURE ENEMIES
  def('wolf', 'fast grey wolf that hunts in packs: they spread out and circle you, and attack in turns (one or two at a time); howls when it notices you', 'faction, hp, damage, count', ['wolves', 'dire wolf', 'warg'], (i, o) => {
    const r = beast(i, o, {
      model: CAST.wolf, size: 1.1, color: 0x7d7f85, accent: 0xd9dce0, eye: 0xffd34a, speed: 5.2, hp: 22, dmg: 5, cd: 1.5, windup: 0.5, range: 1.4, aggro: 21, puff: 0x7d7f85,
      dress: (a) => {
        H.dressCreature(a, [['head', mdl('wolf:ruff', (b) => { b.sph(0, -0.03, -0.1, 0.2, 0.17, 0.15, 0x9a9ca2); }), 0, 0, 0], ['tail', mdl('wolf:tail', (b) => { b.sph(0, 0, -0.2, 0.075, 0.075, 0.2, 0x6a6c72); }), 0, 0, 0],
          ['head', mdl('wolf:fangs', (b) => { for (const s of [-1, 1]) b.cone(0.035 * s, -0.06, 0.24, 0.012, 0.05, 0xffffff, FLIP, 4); }), 0, 0, 0]]);
      },
    });
    arm(i, r, [B.morale({ hp: 0.25, away: [3, 5], chance: 0.6 }), B.skirmisher({ dist: 3.5, min: 0.6, max: 1.0 }), B.circler({ radius: 4.2, pack: true })], { talk: false });
    const { a, f } = r;
    if (a) {
      let next = 0;
      i.tick((dt, t) => {
        if (a.removed || a.dead) return true;
        if (f.target && t > next) { next = t + rand(18, 28); const s = i.snd(); s.tone({ freq: 420, freqEnd: 640, dur: 0.7, type: 'sine', vol: 0.14, at: a.position }); s.tone({ freq: 640, freqEnd: 360, dur: 0.9, type: 'sine', vol: 0.14, at: a.position, delay: 0.7 }); }
      }, { every: 0.4 });
    }
  });
  def('dire-bear', 'huge brown bear with a shoulder hump; slow heavy swipes and a telegraphed lumbering charge, furious when badly hurt', 'faction, hp, damage', ['bear', 'grizzly', 'cave bear'], (i, o) => {
    const r = beast(i, o, {
      model: CAST.bear, size: 2.2, color: 0x5a3a24, accent: 0x8a6a4a, eye: 0x1a1008, speed: 3.5, hp: 95, dmg: 11, cd: 2.4, windup: 0.75, range: 2.1, aggro: 16, puff: 0x5a3a24,
      dress: (a) => H.dressCreature(a, [['pivot', mdl('bear:hump', (b) => { b.sph(0, 0.63, 0.16, 0.24, 0.2, 0.3, 0x4a2e1c); b.sph(0, 0.5, -0.3, 0.22, 0.2, 0.22, 0x4a2e1c); }), 0, 0, 0],
        ['head', mdl('bear:muzzle', (b) => { b.sph(0, -0.04, 0.2, 0.09, 0.07, 0.1, 0xb89a74); b.box(0, 0.0, 0.29, 0.04, 0.03, 0.02, 0x15100c); }), 0, 0, 0]]),
    });
    arm(i, r, [B.berserk({ hp: 0.35, roar: 1.0, speed: 1.35 }), B.charger({ tele: 0.95, len: 9, speed: 8.5, width: 1.3, min: 4, max: 11, dmg: 1.25, cd: [7, 10], stun: 1.2 })], { talk: false });
  });
  def('giant-spider', 'black spider the size of a dog: lies buried until you come near (the ground rumbles first), lobs webs that slow you (fire burns them away) and pounces', 'faction, hp, damage', ['spider', 'spiders', 'tarantula', 'arachnid'], (i, o) => {
    const r = beast(i, o, {
      size: 1.7, legs: 6, color: 0x1b1620, accent: 0x4a1a52, eye: 0xff3030, speed: 4.6, hp: 30, dmg: 5, cd: 1.5, windup: 0.5, range: 1.9, aggro: 18, puff: 0x4a1a52,
      dress: (a) => H.dressCreature(a, [['pivot', mdl('spider:abd', (b) => { b.sph(0, 0.52, -0.62, 0.27, 0.25, 0.36, 0x1b1620); b.mode('glow'); b.box(0, 0.775, -0.62, 0.07, 0.01, 0.14, 0xff2a2a); b.mode('solid'); }), 0, 0, 0],
        ['head', mdl('spider:face', (b) => { for (const s of [-1, 1]) { b.cone(0.045 * s, -0.08, 0.2, 0.014, 0.1, 0xd8d0b8, FLIP, 4); b.mode('glow'); b.sph(0.03 * s, 0.07, 0.15, 0.02, 0.02, 0.02, 0xff3030); b.sph(0.075 * s, 0.09, 0.11, 0.025, 0.025, 0.025, 0xff3030); b.mode('solid'); } }), 0, 0, 0]]),
      lines: ['*hiss*', 'Skree!'],
    });
    const bs = [B.leaper({ min: 3.5, max: 8, tele: 0.65, radius: 1.8, height: 1.1, dmg: 0.9, clip: false, cd: [6, 9], land: 0.8 }), B.webber({ max: 13, cd: [8, 11] })];
    if (!o.rise && o.ambush !== false) bs.unshift(B.ambusher({ wake: 4.6 }));
    arm(i, r, bs, { talk: false });
  });
  def('scorpion', 'sand-coloured scorpion that waits buried (dust and a ground disc warn you), stings and scuttles back, and spits venom that leaves a poison puddle', 'faction, hp, damage', ['scorpions', 'giant scorpion'], (i, o) => {
    const r = beast(i, o, {
      size: 1.25, legs: 6, color: 0xb88a3a, accent: 0x5a3a1a, eye: 0x080808, speed: 4.2, hp: 26, dmg: 6, cd: 1.5, windup: 0.5, range: 1.7, aggro: 17, puff: 0xb88a3a,
      dress: (a) => H.dressCreature(a, [['pivot', mdl('scorp:tail', (b) => {
        const c = 0xa27a30, seg = [[0, 0.56, -0.38, 0.1], [0, 0.72, -0.52, 0.09], [0, 0.9, -0.55, 0.085], [0, 1.03, -0.42, 0.08], [0, 1.06, -0.24, 0.075]];
        for (const s of seg) b.sph(s[0], s[1], s[2], s[3], s[3], s[3], c);
        b.mode('glow'); b.cone(0, 1.0, -0.12, 0.04, 0.14, 0x9aff6a, [-2.4, 0, 0], 5); b.mode('solid');
        for (const s of [-1, 1]) { b.box(0.12 * s, 0.42, 0.52, 0.04, 0.04, 0.3, 0x8a5a1a, [0, 0.3 * s, 0]); b.sph(0.17 * s, 0.42, 0.7, 0.09, 0.05, 0.1, 0xc89a40); }
      }), 0, 0, 0]]),
    });
    const bs = [B.skirmisher({ dist: 3.5, min: 0.8, max: 1.4 }), B.bomber({ min: 5, max: 12, windup: 0.8, flight: 1.1, radius: 1.8, dmg: 0.7, cd: [8, 11], color: 0x9aff3a, trail: 0x9aff3a, boom: 0, boomColor: 0x7aff3a, kind: 'magic', zone: 4, zoneKind: 'poison', arc: 2.0, markColor: 0x7aff3a })];
    if (!o.rise && o.ambush !== false) bs.unshift(B.ambusher({ wake: 4.2 }));
    arm(i, r, bs, { talk: false });
  });

  // ================================================================== CUSTOM MOBS
  // ---- slime: translucent blob that hops at you and splits in two when killed
  const SLIME_COLORS = [0x58d65a, 0x4aa8ff, 0xff6a5a, 0xb06aff, 0xe8d84a];
  function slimeRig(color, size) {
    return (a, pivot) => {
      const vis = new THREE.Group(); vis.scale.setScalar(size); pivot.add(vis);
      part(vis, (b) => {
        b.mode('ghost'); b.sph(0, 0.4, 0, 0.55, 0.42, 0.55, color, 0, 9);
        b.mode('solid'); b.sph(0, 0.26, -0.05, 0.19, 0.16, 0.19, shade(color, 0.45));
        b.sph(0.17, 0.52, 0.4, 0.09, 0.11, 0.05, 0xffffff); b.sph(-0.17, 0.52, 0.4, 0.09, 0.11, 0.05, 0xffffff);
        b.sph(0.17, 0.51, 0.44, 0.045, 0.06, 0.03, 0x101010); b.sph(-0.17, 0.51, 0.44, 0.045, 0.06, 0.03, 0x101010);
        b.box(0, 0.34, 0.5, 0.16, 0.03, 0.03, shade(color, 0.4));
      });
      return {
        anim(a, dt, t, m) {
          const hop = Math.abs(Math.sin(a.phase * 0.9)), idle = Math.sin(t * 3 + a.seed) * 0.04;
          let sy = 1 + idle, sxz = 1 - idle * 0.5;
          if (m > 0.1) { sy = 0.85 + hop * 0.35; sxz = 1.1 - hop * 0.18; pivot.position.y = hop * 0.28 * size; } else pivot.position.y = 0;
          if (a.atkT >= 0) { sy = 1 - 0.3 * a.atkRaise + 0.2 * a.atkSwing; sxz = 1 + 0.2 * a.atkRaise; pivot.position.z = (-0.2 * a.atkRaise + 0.6 * a.atkSwing) * size; } else pivot.position.z = 0;
          pivot.scale.set(sxz, sy, sxz);
        },
      };
    };
  }
  def('slime', 'bouncy translucent blob (random colour): lunges in a squashing leap, splits into two smaller slimes when it dies and leaves a sticky puddle', 'faction, hp, size, color', ['slimes', 'blob', 'jelly', 'ooze', 'gel'], (i, o) => {
    const size = clamp(o.size ?? o.scale ?? 1, 0.3, 3), color = o.color ?? pick(SLIME_COLORS), gen = o.generation ?? 0;
    const od = o.onDeath;
    const r = H.monster(i, {
      rig: slimeRig(color, size), height: 0.85 * size, radius: 0.5 * size, centerY: 0.4 * size, hp: o.hp ?? Math.round(22 * size), speed: 1.7, stride: 5, death: 'melt', lifeAfter: 1.1, knock: 1.4,
      fight: fightOpts(o, { damage: Math.max(2, Math.round(4 * size)), range: 1.3 * size, cooldown: 1.7, windup: 0.55, aggroRange: 14, speed: 1.8, wander: 3, onDeath: (fi) => { if (od) od(fi); } }),
      onDie: (a) => {
        puffAt(i, a, color, 8, 'glow');
        const s = i.snd(); s.tone({ freq: 300, freqEnd: 90, dur: 0.3, type: 'sine', vol: 0.25, at: a.position }); s.noise({ dur: 0.2, filter: { type: 'lowpass', freq: 700 }, vol: 0.2, at: a.position });
        if (B && size > 0.7) B.zones.add(null, { x: a.position.x, z: a.position.z, r: 1.2 * size, ttl: 4, kind: 'acid', dps: 1.5, slow: 0.7, color });
        if (size > 0.5 && gen < 2) {
          const px = a.position.x, pz = a.position.z; let done = false;
          i.tick(() => { // next frame: spawning inside the damage loop would feed the new slimes into it
            if (done) return true; done = true;
            for (let k = 0; k < 2; k++) i.sub('slime', { x: px + (k ? 0.5 : -0.5) * size, z: pz + rand(-0.3, 0.3), size: size * 0.58, color, generation: gen + 1, hp: Math.max(6, Math.round(22 * size * 0.4)), yaw: rand(0, TAU), worldYaw: true });
            return true;
          });
        }
      },
    });
    if (size >= 0.7) armM(i, r, [B.leaper({ min: 2.8, max: 7, tele: 0.65, radius: 1.5 * size, height: 1.3, dmg: 1.0, clip: false, cd: [5, 8], land: 0.5, color })], { talk: false });
  });

  // ---- wraith: floating hooded phantom. Blinks beside you after a glowing ring warns where; arrows and thrusts pass through it; its chill slows you
  def('wraith', 'tattered floating phantom with cyan eyes: blinks to a new spot beside you (a ring shows where first), cannot be pierced by arrows or spears, and its cold slows you', 'faction, hp, damage', ['ghost', 'phantom', 'spectre', 'specter', 'banshee', 'wraiths'], (i, o) => {
    const wraithKit = [B.phase({ immune: ['pierce'], min: 5, max: 13, tele: 0.8, cd: [6, 9] }), B.aura({ kind: 'frost', r: 2.2, dps: 1, slow: 0.7, color: 0x9fe8ff, burst: 'glow', ring: false, rate: 5 })];
    if (H.cast(CAST.wraith)) { // the Kenney ghost model (floats, fades away when killed) instead of the custom mob
      const r = biped(i, o, { model: CAST.wraith, h: 2.0, hp: 34, dmg: 6, range: 1.9, cd: 2.0, windup: 0.6, speed: 2.8, aggro: 18, wander: 4, puff: 0x7affff, puffKind: 'glow',
        die: (a) => { i.snd().tone({ freq: 380, freqEnd: 90, dur: 1.1, type: 'triangle', vol: 0.14, at: a.position }); } });
      arm(i, r, wraithKit, { lines: { blink: ['...behind you...'] } });
      const a = r.a; if (a) { let n = rand(3, 6); i.tick((dt) => { if (a.removed || a.dead) return true; n -= dt; if (n < 0) { n = rand(7, 12); if (a.damage.fighter && a.damage.fighter.target) i.snd().tone({ freq: 190, freqEnd: 130, dur: 1.4, type: 'triangle', vol: 0.1, at: a.position }); } }, { every: 0.5 }); }
      return;
    }
    let mats = [];
    const m = H.monster(i, {
      height: 2.0, radius: 0.5, centerY: 1.1, hover: 0.45, bob: 0.14, bobF: 1.6, speed: 2.8, stride: 2, hp: 34, death: 'fade', lifeAfter: 1.2, eyeH: 1.7,
      rig: (a, pivot) => {
        const body = part(pivot, (b) => {
          b.mode('ghost'); b.cone(0, 0.0, 0, 0.5, 1.9, 0x3a4a6a, 0, 9); b.cone(0, 0.3, 0, 0.36, 1.6, 0x4a5a80, 0, 9);
          b.mode('solid'); b.sph(0, 1.62, 0.04, 0.2, 0.24, 0.2, 0x07080e); b.cone(0, 1.62, -0.05, 0.28, 0.55, 0x1a2236, [-0.25, 0, 0], 8);
          b.mode('glow'); b.box(0.07, 1.64, 0.2, 0.06, 0.04, 0.02, 0x7affff); b.box(-0.07, 1.64, 0.2, 0.06, 0.04, 0.02, 0x7affff);
        });
        const tat = [];
        for (let k = 0; k < 6; k++) { const ang = (k / 6) * TAU; tat.push(part(pivot, (b) => { b.mode('ghost'); b.cone(0, 0, 0, 0.07, 0.6, 0x3a4a6a, FLIP, 5); }, Math.cos(ang) * 0.34, 0.15, Math.sin(ang) * 0.34)); }
        const arms = [-1, 1].map((s) => part(pivot, (b) => { b.mode('ghost'); b.cone(0, 0, 0, 0.08, 0.8, 0x4a5a80, FLIP, 5); b.mode('solid'); for (let c = -1; c <= 1; c++) b.cone(c * 0.04, -0.8, 0.02, 0.012, 0.14, 0xd8e8ff, FLIP, 4); }, 0.3 * s, 1.35, 0.1));
        pivot.traverse((mm) => { if (mm.material && mm.material.userData.own && mm.material.transparent) { mm.material.userData.o0 = mm.material.opacity; mats.push(mm.material); } });
        return {
          anim(a, dt, t, mt) {
            for (let k = 0; k < tat.length; k++) { tat[k].rotation.z = Math.sin(t * 3 + k * 1.3) * 0.28; tat[k].rotation.x = Math.sin(t * 2.4 + k) * 0.2; }
            const cyc = Math.sin(t * 0.7 + a.seed), vis = cyc > 0.8 ? 0.25 : 1; // briefly almost invisible
            a.vis = (a.vis ?? 1) + (vis - (a.vis ?? 1)) * Math.min(1, dt * 3);
            for (const mt2 of mats) mt2.opacity = mt2.userData.o0 * a.vis;
            const raise = a.atkT >= 0 ? a.atkRaise : 0, sw = a.atkSwing;
            for (let k = 0; k < 2; k++) { arms[k].rotation.x = -0.4 - 1.5 * raise + 1.2 * sw + Math.sin(t * 2 + k) * 0.08; arms[k].rotation.z = (k ? -1 : 1) * (0.25 + 0.2 * raise); }
            body.rotation.z = Math.sin(t * 1.3 + a.seed) * 0.04; pivot.rotation.x = 0.1 * mt + 0.2 * sw;
          },
        };
      },
      fight: fightOpts(o, { damage: 6, range: 1.9, cooldown: 2.0, windup: 0.6, aggroRange: 18, speed: 2.8, wander: 4 }),
      onDie: (a) => { puffAt(i, a, 0x7affff, 10, 'glow'); i.snd().tone({ freq: 380, freqEnd: 90, dur: 1.1, type: 'triangle', vol: 0.14, at: a.position }); },
    });
    armM(i, m, wraithKit, { lines: { blink: ['...behind you...'] } });
    const a = m.actor, f = m.fighter;
    let n = rand(3, 6);
    i.tick((dt) => { if (a.removed || a.dead) return true; n -= dt; if (n < 0) { n = rand(7, 12); if (f && f.target) i.snd().tone({ freq: 190, freqEnd: 130, dur: 1.4, type: 'triangle', vol: 0.1, at: a.position }); } }, { every: 0.5 });
  });

  // ---- imp: tiny fast flyer; nips and flits away
  def('imp', 'tiny red flying devil with bat wings; fast and nippy: darts in, bites, flutters out of reach and comes back from another side', 'faction, hp, damage, count', ['imps', 'devil', 'little demon', 'gremlin', 'minor demon', 'minor demons'], (i, o) => {
    const impKit = [B.skirmisher({ dist: 5, min: 0.8, max: 1.4, speed: 1.5 }), B.circler({ radius: 4.2, pack: true })];
    if (H.cast(CAST.imp)) { // a hero-rig demon model, when one is installed, hovering low; otherwise the flying primitive imp below
      const r = biped(i, o, { model: CAST.imp, h: 1.15, hp: 9, dmg: 4, cd: 1.3, windup: 0.5, speed: 4.4, aggro: 18, wander: 5, puff: 0xd23a2a });
      arm(i, r, impKit, { talk: false });
      return;
    }
    const m = H.monster(i, {
      height: 0.95, radius: 0.35, centerY: 0.55, hover: 1.5, bob: 0.2, bobF: 4, speed: 4.6, stride: 6, hp: 9, death: 'crash', lifeAfter: 1.4, eyeH: 0.85, flying: true,
      rig: (a, pivot) => {
        const vis = new THREE.Group(); vis.scale.setScalar(o.scale ?? 1); pivot.add(vis);
        part(vis, (b) => {
          b.sph(0, 0.45, 0, 0.17, 0.22, 0.15, 0xd23a2a); b.sph(0, 0.85, 0.04, 0.15, 0.14, 0.14, 0xd23a2a);
          b.cone(0.1, 0.95, 0.0, 0.035, 0.18, 0x3a1010, [0, 0, -0.4], 5); b.cone(-0.1, 0.95, 0.0, 0.035, 0.18, 0x3a1010, [0, 0, 0.4], 5);
          b.cone(0, 0.8, 0.16, 0.03, 0.06, 0x8a1a10, [PI / 2, 0, 0], 4);
          b.mode('glow'); b.box(0.06, 0.88, 0.17, 0.05, 0.035, 0.012, 0xffe040); b.box(-0.06, 0.88, 0.17, 0.05, 0.035, 0.012, 0xffe040);
          b.mode('solid'); b.cyl(0, 0.3, -0.14, 0.025, 0.04, 0.45, 0xb82a1a, [-1.9, 0, 0]); b.cone(0, 0.2, -0.55, 0.07, 0.12, 0x3a1010, [-2.0, 0, 0], 4);
          b.box(0.1, 0.25, 0.05, 0.05, 0.3, 0.05, 0xb82a1a); b.box(-0.1, 0.25, 0.05, 0.05, 0.3, 0.05, 0xb82a1a);
        });
        const wings = [-1, 1].map((s) => part(vis, (b) => { b.mode('cloth'); b.box(0.25 * s, 0, 0, 0.5, 0.025, 0.025, 0x3a1010); b.sph(0.28 * s, -0.02, -0.05, 0.28, 0.01, 0.18, 0x8a1a30); }, 0.1 * s, 0.62, -0.08));
        return { anim(a, dt, t, mm) { const fl = Math.sin(t * 24 + a.seed) * 0.7; wings[0].rotation.z = -fl; wings[1].rotation.z = fl; vis.rotation.x = 0.25 * Math.min(1, mm) + (a.atkRaise ? -0.4 * a.atkRaise : 0) + 0.5 * a.atkSwing; } };
      },
      fight: fightOpts(o, { damage: 3, range: 1.4, cooldown: 1.3, windup: 0.5, aggroRange: 16, speed: 4.8, wander: 5 }),
      onDie: (a) => { puffAt(i, a, 0xff5a2a, 8, 'fire'); i.snd().tone({ freq: 900, freqEnd: 200, dur: 0.3, type: 'square', vol: 0.12, at: a.position }); },
    });
    armM(i, m, impKit, { talk: false });
  });

  // ---- bat swarm: swoops through you in telegraphed passes
  def('bat-swarm', 'a cloud of 14 bats that swirls and nibbles; every few seconds the cloud swoops through you in a straight pass (a thin red lane shows the path)', 'faction, hp, damage, count', ['bats', 'bat', 'swarm of bats'], (i, o) => {
    const N = Math.max(4, Math.round(14 * H.density())); // fewer bats under load (ctx.quality.density)
    let bodyIM, wingR, wingL;
    const Bd = H.mk(); Bd.mode('cloth'); Bd.sph(0, 0, 0, 0.06, 0.05, 0.1, 0x241a2a); Bd.sph(0, 0.01, 0.1, 0.045, 0.04, 0.04, 0x241a2a); Bd.cone(0.03, 0.04, 0.1, 0.015, 0.05, 0x241a2a); Bd.cone(-0.03, 0.04, 0.1, 0.015, 0.05, 0x241a2a);
    const WG = (s) => { const b = H.mk(); b.mode('cloth'); b.sph(0.17 * s, 0, 0, 0.17, 0.012, 0.075, 0x3a2a44); b.box(0.15 * s, 0.012, 0.02, 0.3, 0.012, 0.012, 0x241a2a); return b.geos().cloth; };
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _az = new THREE.Vector3(0, 0, 1), _ay = new THREE.Vector3(0, 1, 0);
    const bats = Array.from({ length: N }, () => ({ ph: rand(0, TAU), sp: rand(1.6, 3.4), r: rand(0.5, 1.4), h: rand(-0.4, 0.5), fl: rand(16, 26), y: 0, vy: 0, on: true }));
    const m = H.monster(i, {
      height: 1.6, radius: 0.9, centerY: 1.5, hover: 1.3, bob: 0.2, bobF: 2, speed: 4.4, stride: 4, hp: 20, death: 'none', lifeAfter: 1.6, eyeH: 1.4, flying: true, knock: 0.5,
      rig: (a, pivot) => {
        bodyIM = new THREE.InstancedMesh(Bd.geos().cloth, H.ownMat('cloth'), N); wingR = new THREE.InstancedMesh(WG(1), H.ownMat('cloth'), N); wingL = new THREE.InstancedMesh(WG(-1), H.ownMat('cloth'), N);
        for (const im of [bodyIM, wingR, wingL]) { im.frustumCulled = false; im.geometry.userData.shared = false; pivot.add(im); }
        const upd = (t, dt, dead) => {
          for (let k = 0; k < N; k++) {
            const b = bats[k], ang = b.ph + t * b.sp * (k % 2 ? 1 : -1);
            let x = Math.cos(ang) * b.r, z = Math.sin(ang) * b.r, y = 1.3 + b.h + Math.sin(t * 2 + b.ph) * 0.15;
            if (dead) { b.vy -= 12 * dt; b.y += b.vy * dt; y = Math.max(-1.2, 1.3 + b.h + b.y); }
            const yaw = -ang + (k % 2 ? 0 : PI) + PI / 2 * (k % 2 ? -1 : 1);
            _q.setFromAxisAngle(_ay, yaw);
            _p.set(x, y, z);
            _s.set(1, 1, 1);
            bodyIM.setMatrixAt(k, _m.compose(_p, _q, _s));
            const fl = dead ? 0.2 : Math.sin(t * b.fl + b.ph) * 0.8;
            wingR.setMatrixAt(k, _m.compose(_p, _q2.setFromAxisAngle(_az, -fl).premultiply(_q), _s));
            wingL.setMatrixAt(k, _m.compose(_p, _q2.setFromAxisAngle(_az, fl).premultiply(_q), _s));
          }
          bodyIM.instanceMatrix.needsUpdate = wingR.instanceMatrix.needsUpdate = wingL.instanceMatrix.needsUpdate = true;
        };
        a.updSwarm = upd;
        return { anim(a, dt, t) { upd(t, dt, false); } };
      },
      fight: fightOpts(o, { damage: 2, range: 1.5, cooldown: 1.1, windup: 0.5, aggroRange: 18, speed: 4.6, wander: 6 }),
      onDie: (a) => { puffAt(i, a, 0x3a2a44, 8); a.fallT = 0; i.snd().noise({ dur: 0.5, filter: { type: 'bandpass', freq: 3500, q: 2 }, vol: 0.2, at: a.position }); },
    });
    armM(i, m, [B.charger({ tele: 0.85, len: 10, speed: 8, width: 1.5, min: 4, max: 13, dmg: 1.4, cd: [5, 8], selfStun: false, breaks: false, force: 3 })], { talk: false });
    const a = m.actor;
    let n = rand(1, 4);
    i.tick((dt, t) => {
      if (a.removed) return true;
      if (a.dead) { a.fallT += dt; a.updSwarm(t, dt, true); if (a.fallT > 1.5) { bodyIM.visible = wingR.visible = wingL.visible = false; } return; }
      n -= dt; if (n < 0) { n = rand(2, 5); i.snd().noise({ dur: 0.18, filter: { type: 'bandpass', freq: 4200, q: 3 }, vol: 0.12, at: a.position }); i.snd().tone({ freq: 5200, freqEnd: 4000, dur: 0.1, vol: 0.05, at: a.position }); }
    });
  });

  // ---- fire elemental
  def('fire-elemental', 'living pillar of flame: scorches everything within its ring, leaves burning ground where it walks, lights up the night and throws fireballs', 'faction, hp, damage', ['elemental', 'flame spirit', 'fire spirit', 'fire golem', 'flame elemental'], (i, o) => {
    let L = null, acc = 0;
    const flames = [];
    const m = H.monster(i, {
      height: 2.0, radius: 0.6, centerY: 1.0, hover: 0.25, bob: 0.1, bobF: 3, speed: 2.2, stride: 3, hp: 42, death: 'sink', lifeAfter: 0.8, eyeH: 1.6,
      rig: (a, pivot) => {
        const mk = (r, h, c, y, ph) => { const g = part(pivot, (b) => { b.mode('glow'); b.cone(0, 0, 0, r, h, c, 0, 7); for (let k = 0; k < 4; k++) { const ang = k * 1.57; b.cone(Math.cos(ang) * r * 0.55, h * 0.1, Math.sin(ang) * r * 0.55, r * 0.5, h * 0.7, shade(c, 1.05), [Math.sin(ang) * 0.3, 0, -Math.cos(ang) * 0.3], 5); } }, 0, y, 0); g.userData.ph = ph; flames.push(g); return g; };
        mk(0.55, 1.5, 0xe63a10, 0, 0); mk(0.38, 1.7, 0xff7a1a, 0.1, 1.7); mk(0.2, 1.9, 0xffd24a, 0.2, 3.1);
        part(pivot, (b) => { b.mode('glow'); b.sph(0, 1.45, 0.05, 0.22, 0.22, 0.2, 0xffe27a); b.mode('solid'); b.box(0.09, 1.5, 0.22, 0.06, 0.07, 0.02, 0x150500); b.box(-0.09, 1.5, 0.22, 0.06, 0.07, 0.02, 0x150500); b.box(0, 1.36, 0.23, 0.14, 0.03, 0.02, 0x150500); });
        const arms = [-1, 1].map((s) => part(pivot, (b) => { b.mode('glow'); b.cone(0, 0, 0, 0.12, 0.6, 0xff7a1a, FLIP, 5); b.sph(0, -0.62, 0, 0.14, 0.14, 0.14, 0xffd24a); }, 0.5 * s, 1.1, 0.05));
        return { anim(a, dt, t, mm) { for (const g of flames) { const s = 1 + Math.sin(t * 9 + g.userData.ph) * 0.08; g.scale.set(s, 1 + Math.sin(t * 7 + g.userData.ph) * 0.1, s); g.rotation.y += dt * 0.8; } const r = a.atkRaise, sw = a.atkSwing; for (let k = 0; k < 2; k++) arms[k].rotation.x = -0.3 - 1.8 * r + 1.4 * sw; } };
      },
      fight: fightOpts(o, { attack: 'ranged', damage: 6, range: 13, cooldown: 2.4, windup: 0.75, aggroRange: 17, speed: 2.2, wander: 3, projectile: { color: 0xff6a1a, speed: 9, radius: 0.22, splash: 1.2 } }),
      onDie: (a) => { H.kit()?.explosion(i.ctx, _pt.set(a.position.x, a.position.y + 1, a.position.z), { size: 1.3, color: 0xff6a1a }); },
    });
    const a = m.actor;
    armM(i, m, [B.aura({ kind: 'fire', r: 2.2, dps: 2, color: 0xff6a1a }), B.trail({ every: 0.8, ttl: 2.4, r: 1.0 }), B.sniper({ laser: false, ideal: 0.65, minFrac: 0.3 })], { talk: false });
    if (o.light !== false) L = i.light({ color: 0xff7a2a, intensity: 14, distance: 9, flicker: 0.5 });
    i.tick((dt) => {
      if (a.removed) { return true; }
      if (L) { L.position.set(a.position.x, a.position.y + 1.0, a.position.z); if (a.dead) L.enabled = false; }
      if (a.dead) return;
      acc += dt * 22; const n = acc | 0; acc -= n;
      if (n) { _pt.set(a.position.x + rand(-0.3, 0.3), a.position.y + rand(0.2, 1.6), a.position.z + rand(-0.3, 0.3)); i.burst('fire', 0xff5a1a, _pt, n, 0.6); }
    });
  });

  // ---- golems (stone / ice / guardian share one rig)
  function golemRig(P) {
    return (a, pivot) => {
      const k = P.h / 3.3, vis = new THREE.Group(); vis.scale.setScalar(k); pivot.add(vis);
      const legs = [-1, 1].map((s) => part(vis, (b) => { b.box(0, -0.7, 0, 0.62, 1.4, 0.62, P.c1); b.box(0, -1.45, 0.12, 0.76, 0.22, 0.92, P.c2); }, 0.5 * s, 1.5, 0));
      const torso = part(vis, (b) => {
        b.box(0, 2.1, 0, 1.55, 1.3, 0.95, P.c1); b.box(0, 1.55, 0, 1.15, 0.42, 0.75, P.c2); b.box(0, 2.82, -0.05, 1.9, 0.38, 1.0, P.c2);
        b.dod(0.92, 2.78, 0, 0.45, 0.36, 0.5, P.c1); b.dod(-0.92, 2.78, 0, 0.45, 0.36, 0.5, P.c1);
        if (P.moss) for (let q = 0; q < 6; q++) b.box(rand(-0.7, 0.7), rand(1.6, 2.7), 0.49, rand(0.15, 0.4), rand(0.1, 0.25), 0.04, P.moss);
        if (P.crystals) for (let q = 0; q < 7; q++) b.oct(rand(-0.9, 0.9), rand(2.0, 3.1), rand(-0.5, 0.2), 0.14, rand(0.4, 0.8), 0.14, P.crystals, [rand(-0.5, 0.5), 0, rand(-0.5, 0.5)]);
        b.mode('glow'); b.box(0, 2.15, 0.485, 0.5, 0.12, 0.02, P.glow); b.box(0, 2.15, 0.485, 0.12, 0.55, 0.02, P.glow);
      });
      const head = part(vis, (b) => {
        b.box(0, 0, 0.05, 0.75, 0.62, 0.7, P.c1); b.box(0, 0.2, 0, 0.8, 0.12, 0.74, P.c2); b.box(0, -0.12, 0.42, 0.5, 0.16, 0.1, P.c2);
        b.mode('glow'); b.box(0.2, 0.06, 0.41, 0.17, 0.08, 0.02, P.eye); b.box(-0.2, 0.06, 0.41, 0.17, 0.08, 0.02, P.eye);
      }, 0, 3.05, 0.05);
      const arms = [-1, 1].map((s) => part(vis, (b) => { b.box(0, -0.8, 0, 0.55, 1.7, 0.55, P.c1); b.box(0, -1.85, 0.05, 0.85, 0.8, 0.8, P.c2); if (P.crystals) b.oct(0.35 * s, -1.5, 0.3, 0.12, 0.35, 0.12, P.crystals); }, 1.15 * s, 2.7, 0));
      if (P.shield) part(vis, (b) => { b.cylc(0, 0, 0, 0.9, 0.9, 0.12, P.trim, [PI / 2, 0, 0], 9); b.sph(0, 0, 0.1, 0.25, 0.25, 0.12, P.c2); b.mode('glow'); b.tor(0, 0, 0.07, 0.62, 0.035, P.glow, 0, 10); }, -1.35, 1.6, 0.55).rotation.y = 0.3;
      return {
        anim(a, dt, t, m) {
          const s = Math.sin(a.phase) * 0.55 * Math.min(m, 1.2), r = a.atkRaise, sw = a.atkSwing;
          legs[0].rotation.x = s; legs[1].rotation.x = -s;
          arms[0].rotation.x = -s * 0.5 - 2.5 * r + 1.4 * sw; arms[1].rotation.x = s * 0.5 - 2.5 * r + 1.4 * sw;
          arms[0].rotation.z = 0.08 + 0.15 * r; arms[1].rotation.z = -0.08 - 0.15 * r;
          torso.rotation.y = Math.sin(a.phase) * 0.08 * m; torso.rotation.x = 0.06 * m - 0.12 * r + 0.25 * sw;
          head.rotation.y = a.lookYaw; head.rotation.x = -a.lookPitch * 0.6;
          vis.position.y = Math.abs(Math.cos(a.phase)) * 0.06 * m;
        },
      };
    };
  }
  const debris = (i, a, c1, c2, n = 8, kind = 'puff') => {
    const K = H.kit(); if (!K) return;
    const nb = H.allow('bodies', n); // rubble is cosmetic: only as many loose bodies as the budget allows
    for (let k = 0; k < nb; k++) {
      const b = H.mk(); const sz = rand(0.15, 0.35); b.dod(0, 0, 0, sz, sz * 0.8, sz, k % 2 ? c1 : c2);
      const mesh = b.build({ own: true });
      const body = i.body(mesh, { radius: sz * 0.8, shape: 'hull', mass: 1, bounce: 0.35, position: { x: a.position.x + rand(-0.6, 0.6), y: a.position.y + rand(0.5, a.height * 0.8), z: a.position.z + rand(-0.6, 0.6) } });
      if (body) { body.velocity.set(rand(-3, 3), rand(2, 6), rand(-3, 3)); let life = rand(2.4, 3.4); i.tick((dt) => { life -= dt; if (life < 0.5) mesh.scale.setScalar(Math.max(0.01, life * 2)); if (life <= 0) { body.remove(); return true; } }); }
    }
    puffAt(i, a, c2, 10, kind);
    i.snd().noise({ dur: 0.7, filter: { type: 'lowpass', freq: 900, freqEnd: 120 }, vol: 0.5, at: a.position }); i.snd().tone({ freq: 90, freqEnd: 35, dur: 0.6, vol: 0.5, at: a.position });
  };
  def('stone-golem', 'slow, towering rock golem with moss and glowing runes; huge hp, crushing fists, and a great ground stomp (a wide orange circle shows the blast); bursts into rubble', 'faction, hp, damage, scale', ['golem', 'rock golem', 'earth golem', 'stone giant', 'golems'], (i, o) => {
    const rig = golemRig({ h: 3.3 * (o.scale ?? 1), c1: 0x8a8378, c2: 0x6a645a, glow: 0xff8a2a, eye: 0xffb040, moss: 0x5a8a3a });
    const m = H.monster(i, {
      rig, height: 3.3 * (o.scale ?? 1), radius: 0.9 * (o.scale ?? 1), centerY: 1.6 * (o.scale ?? 1), speed: 1.3, stride: 2.8, hp: 220, death: 'none', lifeAfter: 0.05, knock: 0.15, eyeH: 2.9,
      fight: fightOpts(o, { damage: 14, range: 2.6, cooldown: 3.0, windup: 1.0, aggroRange: 14, speed: 1.3, wander: 2, drops: [{ type: 'warhammer', chance: 0.4 }] }),
      onDie: (a) => { a.group.visible = false; debris(i, a, 0x8a8378, 0x6a645a, 9, 'puff'); },
    });
    armM(i, m, [B.stomper({ radius: 4.4 * (o.scale ?? 1), tele: 1.2, dmg: 1.1, reach: 4.2, cd: [8, 12] })], { talk: false });
  });
  def('ice-golem', 'frost-blue crystal golem: a freezing field around it slows and chills you, its frost slam leaves an icy patch, and it shatters into glittering shards', 'faction, hp, damage, scale', ['frost golem', 'snow golem', 'ice giant', 'ice elemental'], (i, o) => {
    const rig = golemRig({ h: 2.7 * (o.scale ?? 1), c1: 0xb8e0f2, c2: 0x8ec4e0, glow: 0x7affff, eye: 0xffffff, crystals: 0xe8faff });
    let acc = 0;
    const m = H.monster(i, {
      rig, height: 2.7 * (o.scale ?? 1), radius: 0.8 * (o.scale ?? 1), centerY: 1.35 * (o.scale ?? 1), speed: 1.8, stride: 3.2, hp: 120, death: 'none', lifeAfter: 0.05, knock: 0.25, eyeH: 2.4,
      fight: fightOpts(o, { damage: 9, range: 2.3, cooldown: 2.5, windup: 0.9, aggroRange: 15, speed: 1.8, wander: 2 }),
      onDie: (a) => { a.group.visible = false; debris(i, a, 0xb8e0f2, 0xe8faff, 9, 'glow'); },
    });
    const a = m.actor;
    armM(i, m, [B.aura({ kind: 'frost', r: 2.7, dps: 1, slow: 0.65, color: 0x7ad8ff, burst: 'glow', rate: 6 }), B.stomper({ radius: 3.6, tele: 1.1, dmg: 1.1, reach: 3.4, color: 0x7ad8ff, cd: [8, 12] })], { talk: false });
    i.tick((dt) => { if (a.removed || a.dead) return true; acc += dt * 6; const n = acc | 0; acc -= n; if (n) { _pt.set(a.position.x + rand(-0.6, 0.6), a.position.y + rand(0.2, 2.4), a.position.z + rand(-0.6, 0.6)); i.burst('glow', 0xbfefff, _pt, n, 0.35); } });
  });

  // ---- mimic: a treasure chest until you come close
  def('mimic', 'looks exactly like a treasure chest; when you come within 3 m or hurt it, it bites with teeth and a tongue and then leaps at you with a glowing landing circle', 'hp, damage, loot', ['chest monster', 'fake chest', 'trap chest', 'mimics'], (i, o) => {
    let ch = null, open = 0, revealed = false, tongue = null, ctl = null;
    const m = H.monster(i, {
      height: 0.8, radius: 0.55, centerY: 0.4, speed: 3.2, stride: 7, hp: o.hp ?? 50, death: 'collapse', lifeAfter: 2, eyeH: 0.5,
      rig: (a, pivot) => {
        ch = H.makeChest({ own: true });
        pivot.add(ch.group);
        part(ch.group, (b) => { for (let x = -0.36; x <= 0.37; x += 0.09) b.cone(x, 0.4, 0.25, 0.035, 0.14, 0xf4f0e0, 0, 4); b.box(0, 0.402, 0, 0.8, 0.012, 0.46, 0x5a0a0a); b.mode('glow'); b.sph(0.18, 0.46, -0.1, 0.05, 0.05, 0.05, 0xffe040); b.sph(-0.18, 0.46, -0.1, 0.05, 0.05, 0.05, 0xffe040); });
        part(ch.lid, (b) => { for (let x = -0.36; x <= 0.37; x += 0.09) b.cone(x, -0.02, 0.5, 0.035, 0.14, 0xf4f0e0, FLIP, 4); });
        tongue = part(ch.group, (b) => { b.box(0, 0, 0.2, 0.14, 0.03, 0.5, 0xc23a4a); b.box(0, 0.002, 0.5, 0.16, 0.034, 0.1, 0xe05a6a); }, 0, 0.42, 0.1);
        tongue.visible = false;
        return {
          anim(a, dt, t, mm) {
            let want = revealed ? 0.55 + 0.35 * Math.sin(t * 7) * (mm > 0.1 ? 1 : 0.3) : 0;
            if (revealed && a.atkT >= 0) want = a.atkT < a.atkW ? 0.5 + 0.5 * a.atkRaise : 1 - a.atkSwing;
            open += (want - open) * Math.min(1, dt * 14); ch.setOpen(open);
            tongue.visible = revealed && open > 0.2; tongue.rotation.x = Math.sin(t * 9) * 0.15 + 0.1; tongue.scale.z = 1 + 0.3 * Math.sin(t * 6);
            if (!(ctl && ctl.move)) pivot.position.y = revealed ? Math.abs(Math.sin(a.phase)) * 0.22 * Math.min(mm, 1) : 0;
            pivot.rotation.z = revealed ? Math.sin(a.phase) * 0.06 * mm : 0;
          },
        };
      },
      fight: fightOpts(o, { damage: 9, range: 1.7, cooldown: 1.8, windup: 0.55, aggroRange: 0, attack: 'none', speed: 3.2, wander: 0, leash: 30,
        drops: [{ type: o.loot ?? pick(['sword', 'axe', 'bow', 'magic-staff', 'shield']), chance: 1 }] }),
      onHit: () => reveal(),
      onDie: (a) => { puffAt(i, a, 0x7a4a26, 8, 'bits'); i.snd().tone({ freq: 200, freqEnd: 60, dur: 0.5, type: 'sawtooth', vol: 0.2, at: a.position }); },
    });
    const a = m.actor, f = m.fighter;
    ctl = armM(i, m, [], { talk: false });
    function reveal() {
      if (revealed || !a || a.dead) return;
      revealed = true; f.attack = 'melee'; f.aggro = 18; f.range = 1.7;
      if (ctl && B) ctl.add(B.leaper({ min: 3, max: 8, tele: 0.7, radius: 1.7, height: 1.2, dmg: 1.0, clip: false, cd: [5, 8], land: 0.8 }));
      a.say('*GROWL*', 1.5);
      const s = i.snd(); s.tone({ freq: 140, freqEnd: 70, dur: 0.6, type: 'sawtooth', vol: 0.25, at: a.position }); s.noise({ dur: 0.4, filter: { type: 'bandpass', freq: 800, q: 2 }, vol: 0.2, at: a.position });
    }
    i.tick((dt) => {
      if (a.removed || a.dead) return true;
      if (!revealed && Math.hypot(H.head.x - a.position.x, H.head.z - a.position.z) < 3) reveal();
    }, { every: 0.12 });
  }, { size: 0.6 });

  // ---- drone: hovering laser robot
  const droneRig = (o) => (a, pivot) => {
    const vis = new THREE.Group(); vis.scale.setScalar(o.scale ?? 1); pivot.add(vis);
    part(vis, (b) => {
      b.sph(0, 0.5, 0, 0.28, 0.22, 0.28, 0x7a8794, 0, 9); b.box(0, 0.5, 0, 0.62, 0.05, 0.62, 0x4a5662);
      b.cyl(0, 0.62, 0, 0.012, 0.012, 0.3, 0x3a4450); b.sph(0, 0.35, -0.05, 0.12, 0.08, 0.12, 0x3a4450);
      for (const s of [-1, 1]) for (const z of [-1, 1]) { b.cyl(0.36 * s, 0.5, 0.36 * z, 0.02, 0.02, 0.18, 0x3a4450); b.box(0.2 * s, 0.5, 0.2 * z, 0.3, 0.03, 0.03, 0x4a5662, [0, -0.78 * s * z, 0]); }
      for (const s of [-1, 1]) b.cyl(0.14 * s, 0.2, 0.06, 0.015, 0.015, 0.2, 0x3a4450, [0.4, 0, 0.2 * s]);
    });
    const lens = part(vis, (b) => { b.mode('glow'); b.sph(0, 0, 0, 0.1, 0.1, 0.1, 0xff3030); }, 0, 0.5, 0.26);
    const rotors = [];
    for (const s of [-1, 1]) for (const z of [-1, 1]) rotors.push(part(vis, (b) => { b.mode('ghost'); b.cylc(0, 0, 0, 0.19, 0.19, 0.012, 0xdde6ee, 0, 12); b.mode('solid'); b.box(0, 0.01, 0, 0.36, 0.008, 0.03, 0x20262c); }, 0.36 * s, 0.62, 0.36 * z));
    return { anim(a, dt, t, m) { for (let k = 0; k < 4; k++) rotors[k].rotation.y += dt * 40 * (k % 2 ? 1 : -1); const g = 1 + 0.7 * a.atkRaise + 0.3 * a.atkSwing; lens.scale.setScalar(g); vis.rotation.x = 0.2 * Math.min(1, m) - 0.1 * a.atkRaise; vis.rotation.z = Math.sin(t * 1.7 + a.seed) * 0.05; } };
  };
  def('drone', 'hovering robot with four rotors and a red laser eye: a thin red laser line locks on for a second before each shot, then it strafes to another spot', 'faction, hp, damage, count', ['drones', 'flying robot', 'security drone', 'hover drone'], (i, o) => {
    const m = H.monster(i, {
      height: 0.9, radius: 0.4, centerY: 0.5, hover: 2.0, bob: 0.15, bobF: 2.5, speed: 3.2, stride: 4, hp: 14, death: 'crash', lifeAfter: 1.3, eyeH: 0.6, flying: true,
      rig: droneRig(o),
      fight: fightOpts(o, { attack: 'ranged', damage: 3, range: 16, cooldown: 1.9, windup: 0.8, aggroRange: 20, speed: 3.2, wander: 5, drops: [{ type: 'grenade', chance: 0.3 }], projectile: { color: 0xff2a2a, speed: 22, radius: 0.1, splash: 0.2 } }),
      onDie: (a) => { H.kit()?.explosion(i.ctx, _pt.set(a.position.x, a.position.y + 0.5, a.position.z), { size: 0.8, color: 0xff8a30 }); puffAt(i, a, 0x8a9aa8, 6, 'spark'); },
    });
    armM(i, m, [B.sniper({ color: 0xff2a2a, width: 0.03, ideal: 0.65, minFrac: 0.35 })], { talk: false, priority: 1 });
  });
  def('kamikaze-drone', 'small rotor drone that rushes you, beeps faster and faster inside a red blast circle, and blows itself up (shoot it down before it arrives)', 'faction, hp, damage, count', ['bomb drone', 'suicide drone', 'explosive drone', 'drone bomber'], (i, o) => {
    const m = H.monster(i, {
      height: 0.8, radius: 0.35, centerY: 0.45, hover: 1.3, bob: 0.12, bobF: 3, speed: 4.6, stride: 4, hp: 10, death: 'crash', lifeAfter: 1.0, eyeH: 0.5, flying: true,
      rig: droneRig({ scale: 0.85 }),
      fight: fightOpts(o, { attack: 'melee', damage: 5, range: 1.2, cooldown: 3.0, windup: 0.6, aggroRange: 22, speed: 4.6, wander: 4 }),
      onDie: (a) => { H.kit()?.explosion(i.ctx, _pt.set(a.position.x, a.position.y + 0.5, a.position.z), { size: 0.7, color: 0xff8a30 }); },
    });
    armM(i, m, [B.kamikaze({ fuse: 0.95, radius: 3.0, dmg: 2.2, trigger: 2.6 })], { talk: false });
  });

  // ---- dragons (whelp + boss share a rig)
  function dragonRig(P) {
    return (a, pivot) => {
      const vis = new THREE.Group(); vis.scale.setScalar(P.k); pivot.add(vis);
      const body = part(vis, (b) => {
        b.sph(0, 0.65, 0, 0.42, 0.38, 0.72, P.c1, 0, 8); b.sph(0, 0.55, 0.05, 0.36, 0.22, 0.6, P.belly, 0, 8);
        for (const [x, y, z, r] of [[0, 0.92, 0.55, 0.2], [0, 1.15, 0.78, 0.17], [0, 1.35, 0.95, 0.15]]) b.sph(x, y, z, r, r, r * 1.1, P.c1);
        for (let k = 0; k < 7; k++) b.cone(0, 0.98 - k * 0.0, 0.7 - k * 0.22, 0.06, 0.2 - k * 0.012, P.spike, [-0.15, 0, 0], 4);
        for (const sx of [-1, 1]) for (const z of [0.4, -0.35]) { b.cyl(0.3 * sx, 0.28, z, 0.09, 0.07, 0.3, P.c2); b.box(0.3 * sx, 0.02, z + 0.07, 0.15, 0.05, 0.22, P.c2); }
      });
      const headG = part(vis, (b) => {
        b.sph(0, 0, 0.12, 0.2, 0.17, 0.26, P.c1); b.box(0, -0.03, 0.4, 0.17, 0.1, 0.22, P.c1); b.box(0, -0.12, 0.3, 0.15, 0.04, 0.26, P.belly);
        for (const s of [-1, 1]) { b.cone(0.1 * s, 0.14, -0.05, 0.045, 0.34, P.horn, [-0.9, 0, -0.25 * s], 5); b.cone(0.05 * s, -0.01, 0.5, 0.012, 0.06, 0xffffff, FLIP, 4); }
        b.mode('glow'); b.sph(0.11, 0.07, 0.24, 0.035, 0.035, 0.035, P.eye); b.sph(-0.11, 0.07, 0.24, 0.035, 0.035, 0.035, P.eye);
      }, 0, 1.37, 1.0);
      const tail = part(vis, (b) => { for (let k = 0; k < 5; k++) { const r = 0.26 - k * 0.04; b.sph(0, 0.0, -0.28 * k - 0.1, r, r * 0.9, r * 1.3, P.c1); if (k < 4) b.cone(0, r * 0.8, -0.28 * k - 0.1, 0.05, 0.16, P.spike, [-0.1, 0, 0], 4); } b.cone(0, 0, -1.5, 0.08, 0.3, P.spike, [-PI / 2, 0, 0], 4); }, 0, 0.55, -0.6);
      const wings = [-1, 1].map((s) => part(vis, (b) => {
        b.mode('solid'); b.box(0.55 * s, 0, 0, 1.1, 0.07, 0.07, P.c2); b.box(0.9 * s, 0.1, 0, 0.5, 0.05, 0.05, P.c2, [0, 0, 0.5 * s]);
        for (let k = 0; k < 3; k++) b.box(0.8 * s, 0, -0.25 - k * 0.2, 0.05, 0.04, 0.55 + k * 0.1, P.c2, [0, 0.25 * s * (k - 1), 0]);
        b.mode('cloth'); b.sph(0.6 * s, -0.04, -0.45, 0.62, 0.012, 0.5, P.wing);
      }, 0.24 * s, 1.0, 0));
      return {
        anim(a, dt, t, m) {
          const flying = a.hover > 0.5, fr = flying ? 11 : 1.6, amp = flying ? 0.85 : 0.25;
          const fl = Math.sin(t * fr + a.seed) * amp;
          wings[0].rotation.z = fl + (flying ? 0 : 0.5); wings[1].rotation.z = -fl - (flying ? 0 : 0.5);
          tail.rotation.y = Math.sin(t * 1.8 + a.seed) * 0.35 + a.lookYaw * -0.2;
          const r = a.atkRaise, sw = a.atkSwing;
          headG.rotation.x = -a.lookPitch * 0.5 - 0.5 * r + 0.55 * sw; headG.rotation.y = a.lookYaw;
          body.rotation.x = flying ? -0.12 : 0; vis.position.y = flying ? 0 : Math.abs(Math.sin(a.phase)) * 0.04 * Math.min(m, 1);
          vis.rotation.z = Math.sin(a.phase) * 0.03 * m;
        },
      };
    };
  }
  def('dragon-whelp', 'young green dragon that flies in strafing runs: a glowing lane on the ground shows its path, it breathes fire along it (and from the Mouth bone in a cone up close), then wheels round for another pass', 'faction, hp, damage, scale', ['dragon', 'baby dragon', 'young dragon', 'drake', 'wyvern', 'dragons'], (i, o) => {
    const k = 0.7 * (o.scale ?? 1);
    const prim = dragonRig({ k, c1: 0x3f8f4a, c2: 0x2a6a38, belly: 0xd8c27a, spike: 0xe8d890, horn: 0xd8d0b8, eye: 0xffd24a, wing: 0x8a2a3a });
    const isModel = !!H.cast(CAST.dragonWhelp);
    const wh = H.monster(i, {
      rig: isModel ? H.modelRig(H.modelList(CAST.dragonWhelp, o), prim) : prim,
      height: 1.9 * k * 1.4, radius: 0.9 * k * 1.4, centerY: 0.7 * k * 1.4, hover: 1.6, bob: 0.25, bobF: 2.2, speed: 3.4, stride: 3, hp: 60, death: isModel ? 'none' : 'crash', lifeAfter: isModel ? 2.6 : 1.8, eyeH: 1.6, flying: true,
      fight: fightOpts(o, { attack: 'ranged', damage: 5, range: 15, cooldown: 2.6, windup: 0.85, aggroRange: 20, speed: 3.4, wander: 5, drops: [{ type: 'magic-staff', chance: 0.2 }], projectile: { color: 0xff7a20, speed: 10, radius: 0.24, splash: 1.3, gravity: 1.5 } }),
      onDie: (a) => { puffAt(i, a, 0xff7a20, 10, 'fire'); i.snd().tone({ freq: 400, freqEnd: 90, dur: 0.8, type: 'sawtooth', vol: 0.2, at: a.position }); },
    });
    const wa = wh && wh.actor;
    if (wa && isModel) wa.muzzleAt = (out) => { if (!wa.mdl || !wa.mdl.ready || !wa.rig.mouth) return false; wa.rig.mouth(out); return true; }; // fireballs leave the Mouth bone
    armM(i, wh, [B.strafer({ tele: 1.2, speed: 8.5, entry: 14, offset: 3.2, cd: [8, 12] }), B.breath({ tele: 1.2, dur: 1.2, len: 8 * (k / 0.7), half: 2.2, dmg: 0.45, min: 3, max: 12, cd: [9, 13], color: 0xff7a20 })], { talk: false });
  });

  // ================================================================== BOSSES (library/bosses.js)
  Object.assign(H, { golemRig, dragonRig, debris, slimeRig, droneRig });
  if (H.installBosses) { try { H.installBosses(lib); } catch (err) { console.error('[library] bosses failed to install', err); } }
}
