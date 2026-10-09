// library/allies.js - friendly fighters (faction 'friendly'): they trail the player, defend them and attack enemies.
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, ease, shade, fightOpts, biped, beast, part, puffAt, worldAdd, mdl } = H;
  const PI = Math.PI, FLIP = [PI, 0, 0];
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'allies', description, options, aliases, build, ...extra });
  const _pt = new THREE.Vector3(), _v = new THREE.Vector3();
  const FR = { faction: 'friendly' };
  const B = H.behaviors;
  // armA: encounter kit for allies (library/behaviors.js) + fighter.order(kind, target) + handle.order. See docs/ENCOUNTERS.md
  const armA = (i, r, list, o) => {
    const f = r.f || r.fighter, a = r.a || r.actor; if (!B || !f || !a) return null;
    const c = B.attach(i, a, f, [...(list || []), B.orders()], { talk: true, ...(o || {}) });
    if (c) i.handle.order = (kind, target) => B.order(i.handle, kind, target);
    return c;
  };
  const intro = (a, lines) => { if (a) a.say(pick(lines), 3.2); };
  // model casting (see H.cast / H.modelList in gear.js): KayKit heroes for the fighters (default hero equipment where it fits), Kenney minis for the militia and cube animals
  const NOEQ = { right: null, left: null };
  const MALE = ['villager-male-a', 'villager-male-b', 'villager-male-c', 'villager-male-d', 'villager-male-e', 'villager-male-f'];
  const CAST = {
    knight: [{ model: 'knight', height: 1.85, weaponType: 'sword' }],
    archer: [{ model: 'rogue', tint: 0xffe6c4, height: 1.72, equip: { right: '1H_Crossbow', left: null } }],
    mage: [{ model: 'mage', height: 1.78, caster: true, weaponType: 'magic-staff' }],
    healer: [{ model: 'mage', tint: 0xfff2e6, height: 1.7, equip: { right: '1H_Wand', left: 'Spellbook' }, caster: true, weaponType: 'wand' }],
    paladin: [{ model: 'knight', tint: 0xffd36a, height: 1.95, bulk: 1.06, equip: { right: '1H_Sword', left: 'Badge_Shield' }, weaponType: 'sword' }],
    ranger: [{ model: 'rogue-hooded', height: 1.8, equip: { right: '2H_Crossbow', left: null } }],
    militia: () => [{ model: pick(MALE), height: 1.7 + rand(-0.08, 0.08), hold: { right: 'shovel' }, wscale: 0.9 }],
    guardDog: [{ model: 'dog', tint: 0xb8905c, size: 0.7 }],
    wolf: [{ model: 'dog', tint: 0xdae4ff, size: 0.95 }],
  };
  H.CAST = Object.assign(H.CAST || {}, { allies: CAST });
  // allies speak up when something hostile shows up near the player
  function warnOnEnemies(inst, a, lines, gap = 14) {
    let next = rand(2, 8);
    inst.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      if (t < next) return;
      const C = H.combat();
      if (C && C.nearest(H.head, { hostileTo: 'friendly', maxDist: 18 })) { next = t + gap + rand(0, 8); if (a.ctrl) a.ctrl.say('warn', pick(lines)); else a.say(pick(lines), 2.6); }
    }, { every: 0.8 });
  }

  def('knight', 'loyal armoured knight with sword, shield and a blue cape; sturdy frontline ally', 'hp, damage, name', ['ally knight', 'friendly knight', 'bodyguard', 'guard', 'paladin knight', 'knights', 'soldier'], (i, o) => {
    const rk = biped(i, o, { ...FR, model: CAST.knight, h: 1.85, bulk: 1.05, skin: 0xe0b890, shirt: 0x9aa4b0, pants: 0x4a5058, hp: 90, dmg: 9, cd: 1.6, windup: 0.5, speed: 3.0, aggro: 18,
      gear: [['head', 'greatHelm', 0xb8c2cc, 0x203040], ['pivot', 'cape', 0x2a4a8a], ['pivot', 'pauldrons', 0xb8c2cc], ['pivot', 'tabard', 0xe8e4d0]], weapon: 'sword', puff: 0xb8c2cc, puffKind: 'spark' });
    const a = rk.a; if (!a) return;
    a.whenPrimitive((pa) => H.gear(pa, 'armL', H.weaponMesh('shield'), 0.1, -0.3, 0.1, 0.8, [0, PI, 0])); // the model knight carries its own shield
    armA(i, rk, [B.shield({ arc: 1.9, hp: 40 }), B.bodyguard(), B.tank({ min: 2, radius: 10 }), B.formation({ row: 'front' })], { lines: { taunt: ['Face me!', 'Over here!'], shield: ['My shield!'] } });
    intro(a, ['At your service!', 'Lead on, friend.', 'My blade is yours.']);
    warnOnEnemies(i, a, ['Enemies!', 'Stand behind me!', 'To arms!', 'I see them!']);
  });
  def('archer', 'friendly bowman in green; shoots arrows from behind you', 'hp, damage', ['bowman', 'ally archer', 'friendly archer', 'archers'], (i, o) => {
    const ra = biped(i, o, { ...FR, model: CAST.archer, h: 1.7, skin: 0xe6c09a, shirt: 0x3a6a3a, pants: 0x5a4a30, hat: 0x2a5a2a, hp: 40, dmg: 5, attack: 'ranged', range: 17, cd: 1.7, windup: 0.5, speed: 3.1, aggro: 21,
      proj: { color: 0xffe8a0, speed: 15, radius: 0.1, splash: 0.2 }, gear: [['pivot', 'quiver'], ['pivot', 'scarf', 0xc8c8a0]], weapon: 'bow', puff: 0x3a6a3a });
    const a = ra.a;
    armA(i, ra, [B.sniper({ laser: false, ideal: 0.75 }), B.spotter(), B.formation({ row: 'back' })], { lines: { call: ['Target there!'] } });
    intro(a, ['Eyes sharp!', 'Got your back.', 'Say the word.']);
    if (a) warnOnEnemies(i, a, ['There! Enemy!', 'Contact!', 'Nock and loose!']);
  });
  def('mage', 'friendly wizard in blue robes; casts arcane bolts with a glowing staff', 'hp, damage', ['wizard ally', 'ally mage', 'sorcerer', 'spellcaster', 'friendly wizard', 'mages'], (i, o) => {
    const rm = biped(i, o, { ...FR, model: CAST.mage, h: 1.75, skin: 0xf0d0b0, shirt: 0x3a2a8a, pants: 0x2a2060, hat: 0x3a2a8a, hair: 0xdddddd, hp: 35, dmg: 8, attack: 'ranged', range: 16, cd: 2.0, windup: 0.6, speed: 2.9, aggro: 20,
      proj: { color: 0x9a7bff, speed: 11, radius: 0.2, splash: 0.8 }, gear: [['pivot', 'robe', 0x3a2a8a], ['head', 'beard', 0xe8e8e8]], weapon: 'magic-staff', puff: 0x9a7bff, puffKind: 'glow' });
    const a = rm.a;
    armA(i, rm, [B.sniper({ laser: false, ideal: 0.72 }), B.spotter(), B.formation({ row: 'back' })]);
    intro(a, ['Magic is on our side.', 'Let us light them up!', 'Stay close, I have spells.']);
    if (a) warnOnEnemies(i, a, ['Hostiles approach!', 'Allow me.', 'Stand back, I\'ll handle it.']);
  });
  def('healer', 'white-robed cleric that follows you and heals you (and wounded allies) every few seconds', 'hp, amount, interval', ['cleric', 'priest', 'medic', 'nurse', 'white mage', 'healers', 'support'], (i, o) => {
    const rh = biped(i, o, { ...FR, model: CAST.healer, mgear: [['head', 'halo', 0xfff0b0]], h: 1.7, skin: 0xf0d0b0, shirt: 0xf1ece0, pants: 0xe0d8c8, hair: 0x8a5a2a, hp: 40, dmg: 0, attack: 'none', speed: 3.0, aggro: 0,
      gear: [['pivot', 'robe', 0xf1ece0], ['pivot', 'belt', 0xd9a93c], ['head', 'halo', 0xfff0b0]], weapon: 'wand', puff: 0xfff0b0, puffKind: 'glow' });
    const a = rh.a; if (!a) return;
    armA(i, rh, [B.medic({ range: 16, channel: 2.4 }), B.formation({ row: 'back' })], { lines: { revive: ['Rise, friend!', 'Not yet, stand up!'] } });
    intro(a, ['I will keep you well.', 'Light be with you.', 'Fear not, I am here.']);
    const amount = o.amount ?? 8, every = o.interval ?? 4;
    let cd = 2;
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      cd -= dt; if (cd > 0) return;
      const P = H.playerApi(); let healed = false;
      const dx = H.head.x - a.position.x, dz = H.head.z - a.position.z;
      if (P && P.alive !== false && P.health < P.maxHealth - 1 && dx * dx + dz * dz < 100) {
        P.heal(amount); healed = true;
        _pt.set(H.head.x, H.head.y - 0.3, H.head.z); i.burst('glow', 0x9affb0, _pt, 12, 0.8, _v.set(0, 1.2, 0));
      }
      const C = H.combat();
      if (C) for (const f of C.fighters) {
        if (f.faction !== 'friendly' || f.hp >= f.maxHp * 0.8 || f.actor === a) continue;
        const p = f.actor.position, ddx = p.x - a.position.x, ddz = p.z - a.position.z;
        if (ddx * ddx + ddz * ddz < 64) { f.heal(amount * 1.5); healed = true; _pt.set(p.x, p.y + 1, p.z); i.burst('glow', 0x9affb0, _pt, 8, 0.6, _v.set(0, 1, 0)); }
      }
      if (healed) {
        cd = every; a.wave(1.2); if (a.ctrl) a.ctrl.say('heal', pick(['Be well!', 'Heal!', 'Stay strong!'])); else a.say(pick(['Be well!', 'Heal!', 'Stay strong!']), 2);
        i.snd().chord([784, 988, 1175], { dur: 0.7, type: 'sine', vol: 0.18, at: a.position, stagger: 0.08 });
      } else cd = 1.2;
    }, { every: 0.1 });
  });
  def('paladin', 'golden-armoured holy warrior with a halo and a warhammer; releases a smiting nova when enemies crowd you', 'hp, damage', ['holy knight', 'crusader', 'templar', 'paladins'], (i, o) => {
    const { a, f } = biped(i, o, { ...FR, model: CAST.paladin, mgear: [['head', 'halo', 0xfff0b0]], h: 1.95, bulk: 1.1, skin: 0xe6c09a, shirt: 0xd9b25a, pants: 0x9a7a3a, hp: 120, dmg: 12, range: 1.9, cd: 1.9, windup: 0.6, speed: 3.0, aggro: 18,
      gear: [['head', 'greatHelm', 0xd9b25a, 0xfff0b0], ['head', 'halo', 0xfff0b0], ['pivot', 'cape', 0xf4f0e4], ['pivot', 'pauldrons', 0xd9b25a], ['pivot', 'tabard', 0xf4f0e4]], weapon: 'warhammer', puff: 0xfff0b0, puffKind: 'glow' });
    if (!a) return;
    armA(i, { a, f }, [B.bodyguard({ gap: 1.7 }), B.tank({ min: 2, radius: 9, line: 'Face the light!' }), B.formation({ row: 'front' })]);
    intro(a, ['For the light!', 'No evil shall pass.', 'I stand with you.']);
    let cd = 6;
    i.tick((dt) => {
      if (a.removed || a.dead) return true;
      cd -= dt; if (cd > 0) return;
      const C = H.combat(); if (!C) return;
      let n = 0;
      for (const e of C.fighters) { if (e.faction !== 'enemy' || !e.alive) continue; const dx = e.actor.position.x - a.position.x, dz = e.actor.position.z - a.position.z; if (dx * dx + dz * dz < 16) n++; }
      if (n < 2) { cd = 1; return; }
      cd = 12; if (a.ctrl) a.ctrl.say('smite', 'Smite!'); else a.say('SMITE!', 1.5); a.attackAnim(0.3, 'melee');
      _pt.set(a.position.x, a.position.y + 0.8, a.position.z);
      H.kit()?.hit(_pt, 4.5, 14, { from: 'friendly', by: f });
      i.burst('glow', 0xfff0b0, _pt, 30, 2.2, _v.set(0, 1.5, 0)); i.burst('spark', 0xffe08a, _pt, 24, 1.5);
      i.snd().chord([523, 659, 784, 1047], { dur: 0.9, type: 'triangle', vol: 0.25, at: a.position, stagger: 0.05 });
      i.snd().noise({ dur: 0.35, filter: { type: 'lowpass', freq: 1500, freqEnd: 200 }, vol: 0.3, at: a.position });
    }, { every: 0.2 });
    warnOnEnemies(i, a, ['Evil approaches!', 'Behind me!']);
  });
  def('ranger', 'hooded forest ranger with a longbow; long range, quick shots', 'hp, damage', ['scout', 'hunter', 'forest ranger', 'rangers', 'sniper'], (i, o) => {
    const rr = biped(i, o, { ...FR, model: CAST.ranger, h: 1.8, skin: 0xd8b088, shirt: 0x3a5a3a, pants: 0x4a3a28, hp: 45, dmg: 6, attack: 'ranged', range: 21, cd: 1.4, windup: 0.5, speed: 3.4, aggro: 25,
      proj: { color: 0xd8ffb0, speed: 19, radius: 0.09, splash: 0.15 }, gear: [['head', 'hood', 0x2f4a2f], ['pivot', 'quiver', 0x4a3a28], ['pivot', 'cape', 0x3a5a3a]], weapon: 'bow', puff: 0x3a5a3a });
    const a = rr.a;
    armA(i, rr, [B.sniper({ laser: false, ideal: 0.8 }), B.spotter(), B.formation({ row: 'back' })]);
    intro(a, ['The woods are quiet... for now.', 'I have your flank.']);
    if (a) warnOnEnemies(i, a, ['Movement, north!', 'Eyes up!', 'I have a shot.']);
  });
  def('villager-militia', 'farmer with a pitchfork and a bucket helmet; weak alone, brave in numbers (use count)', 'hp, damage, count', ['militia', 'peasant fighter', 'peasant', 'villager fighter', 'townsfolk soldier', 'militiaman'], (i, o) => {
    const rl = biped(i, o, { ...FR, model: CAST.militia(), h: 1.7 + rand(-0.08, 0.08), skin: pick([0xf0c8a0, 0xe0ac86, 0xc68642]), shirt: pick([0x8a7a5a, 0x7a6a8a, 0x6a8a7a]), pants: 0x4a4030, hair: pick([0x2a1a10, 0x8a6a30, 0x6a6a6a]), hp: 28, dmg: 5, cd: 1.7, windup: 0.5, speed: 2.9, aggro: 16,
      gear: [['head', 'ironHelm', 0x8a8a8a]], weapon: 'spear', puff: 0x8a7a5a });
    const a = rl.a;
    armA(i, rl, [B.morale({ hp: 0.3, alone: true, away: [3, 6] }), B.formation({ row: 'mid' })], { lines: { flee: ['Run for it!', 'I want my mother!'], return: ['Right, again!'] } });
    intro(a, ['For the village!', 'I left the stove on!', 'Never fought before...', 'Show \'em, lads!']);
    if (a) warnOnEnemies(i, a, ['Oh no, oh no!', 'They\'re coming!', 'Hold the line!']);
  });

  // ---- animals
  def('guard-dog', 'brave dog that trails you, barks at danger and bites enemies', 'hp, damage', ['war dog', 'battle dog', 'hound', 'attack dog', 'ally dog', 'dogs guard'], (i, o) => {
    const { a, f } = beast(i, o, { ...FR, model: CAST.guardDog, size: 0.85, color: 0x8a6a40, accent: 0xe8d8b8, eye: 0x1a1008, speed: 6, hp: 40, dmg: 5, cd: 1.1, windup: 0.5, range: 1.3, aggro: 19, puff: 0x8a6a40,
      dress: (a) => H.dressCreature(a, [['head', mdl('dog:collar', (b) => { b.tor(0, -0.05, -0.04, 0.12, 0.018, 0xc83a3a, [PI / 2, 0, 0], 8); b.mode('glow'); b.sph(0, -0.17, 0.0, 0.02, 0.02, 0.02, 0xffd24a); }), 0, 0, 0]]) });
    if (!a) return;
    armA(i, { a, f }, [B.skirmisher({ dist: 3, min: 0.6, max: 1.0 }), B.formation({ row: 'mid' })], { talk: false });
    a.say('Woof!', 2);
    let had = false, wait = 0;
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      const tg = f.target;
      if (tg && !had && t > wait) { wait = t + 6; for (let k = 0; k < 2; k++) { i.snd().tone({ freq: 480, freqEnd: 250, dur: 0.12, type: 'sawtooth', vol: 0.2, at: a.position, delay: k * 0.2 }); } a.say('Woof woof!', 1.5); }
      had = !!tg;
    }, { every: 0.3 });
  });
  def('wolf-companion', 'tamed silver wolf with blue eyes; fast, hits hard, follows you everywhere', 'hp, damage', ['tame wolf', 'pet wolf', 'wolf ally', 'friendly wolf', 'wolf pet'], (i, o) => {
    const { a, f } = beast(i, o, { ...FR, model: CAST.wolf, size: 1.15, color: 0xaab4c0, accent: 0xf2f6fa, eye: 0x58c8ff, speed: 6.4, hp: 60, dmg: 7, cd: 1.1, windup: 0.5, range: 1.5, aggro: 21, puff: 0xaab4c0,
      dress: (a) => H.dressCreature(a, [['head', mdl('wolfc:ruff', (b) => { b.sph(0, -0.03, -0.1, 0.2, 0.17, 0.15, 0xdfe6ee); }), 0, 0, 0], ['tail', mdl('wolfc:tail', (b) => { b.sph(0, 0, -0.2, 0.08, 0.08, 0.22, 0xdfe6ee); }), 0, 0, 0]]) });
    if (!a) return;
    armA(i, { a, f }, [B.skirmisher({ dist: 3.5, min: 0.6, max: 1.0 }), B.circler({ radius: 3.6, pack: true })], { talk: false });
    let next = rand(6, 14);
    i.tick((dt, t) => { if (a.removed || a.dead) return true; if (t > next) { next = t + rand(25, 40); i.snd().tone({ freq: 380, freqEnd: 600, dur: 0.8, vol: 0.12, at: a.position }); i.snd().tone({ freq: 600, freqEnd: 340, dur: 1.0, vol: 0.12, at: a.position, delay: 0.8 }); } }, { every: 0.5 });
  });

  // ---- golem guardian
  def('golem-guardian', 'friendly stone-and-gold golem with a rune shield; slow bodyguard with enormous hp', 'hp, damage, scale', ['guardian golem', 'ally golem', 'friendly golem', 'stone guardian', 'bodyguard golem', 'protector'], (i, o) => {
    const k = o.scale ?? 1;
    const rig = H.golemRig({ h: 2.9 * k, c1: 0x9a9488, c2: 0x7a746a, glow: 0x58c8ff, eye: 0x7affff, trim: 0xd9a93c, shield: true, moss: 0x4a7a3a });
    const gm = H.monster(i, {
      rig, faction: 'friendly', height: 2.9 * k, radius: 0.85 * k, centerY: 1.4 * k, speed: 2.2, stride: 2.8, hp: 260, death: 'none', lifeAfter: 0.05, knock: 0.1, eyeH: 2.6,
      fight: fightOpts(o, { faction: 'friendly', damage: 12, range: 2.5, cooldown: 2.4, windup: 0.9, aggroRange: 17, speed: 2.2 }),
      onDie: (a) => { a.group.visible = false; H.debris(i, a, 0x9a9488, 0xd9a93c, 9, 'puff'); },
    });
    const a = gm.actor;
    armA(i, gm, [B.shield({ arc: 2.4, hp: 120, down: 5 }), B.bodyguard({ gap: 2.2 }), B.tank({ min: 2, radius: 10, line: 'Stone stands!' }), B.formation({ row: 'front' })], { talk: false });
    if (a) a.say('I guard.', 2.5);
  }, { size: 1.2 });

  // ---- fairy: orbits the player, heals a little
  def('fairy', 'tiny glowing fairy (random colour) that orbits you, leaves a sparkle trail and heals 3 hp every ~5 s', 'color, follow', ['sprite', 'pixie', 'fae', 'faerie', 'fairies', 'navi'], (i, o) => {
    const col = o.color ?? pick([0xff9ad8, 0x9ad8ff, 0xfff09a, 0xb8ff9a]);
    const g = new THREE.Group(); worldAdd(i, g);
    const b = H.mk();
    b.mode('glow'); b.sph(0, 0, 0, 0.035, 0.05, 0.035, 0xfff6e0); b.sph(0, 0.075, 0, 0.032, 0.032, 0.032, 0xffe8d0);
    b.sph(0, 0.095, -0.012, 0.036, 0.022, 0.036, shade(col, 0.9)); b.cone(0, -0.03, 0, 0.045, 0.07, col, FLIP, 6);
    b.mode('beam'); b.sph(0, 0.02, 0, 0.1, 0.1, 0.1, col);
    g.add(b.build({ own: true }));
    const wings = [-1, 1].map((s) => { const w = new THREE.Group(); w.position.set(0.02 * s, 0.03, -0.01); const wb = H.mk(); wb.mode('beam'); wb.sph(0.05 * s, 0.015, 0, 0.055, 0.04, 0.008, 0xffffff, [0, 0, -0.5 * s]); wb.sph(0.04 * s, -0.025, 0, 0.04, 0.03, 0.008, col, [0, 0, 0.5 * s]); w.add(wb.build({ own: true })); g.add(w); return w; });
    const follow = o.follow !== false, home = { x: i.x, z: i.z };
    let ang = rand(0, TAU), acc = 0, heal = 3, spoke = rand(4, 10);
    g.position.set(i.x, H.ground(i.x, i.z) + 1.4, i.z);
    const P = () => H.playerApi();
    i.tick((dt, t) => {
      ang += dt * 1.5;
      const cx = follow ? H.head.x : home.x, cz = follow ? H.head.z : home.z, cy = follow ? H.head.y + 0.1 : H.ground(home.x, home.z) + 1.6;
      const tx = cx + Math.cos(ang) * 0.85, tz = cz + Math.sin(ang) * 0.85, ty = cy + Math.sin(t * 1.9 + ang) * 0.22;
      const k = 1 - Math.exp(-dt * 5);
      g.position.x += (tx - g.position.x) * k; g.position.y += (ty - g.position.y) * k; g.position.z += (tz - g.position.z) * k;
      g.rotation.y = -ang + PI;
      const fl = Math.sin(t * 38) * 0.9; wings[0].rotation.z = fl; wings[1].rotation.z = -fl;
      acc += dt * 16; const n = acc | 0; acc -= n;
      if (n) i.burst('glow', col, g.position, n, 0.22);
      heal -= dt;
      if (heal <= 0) {
        const p = P();
        if (p && p.alive !== false && p.health < p.maxHealth - 1) {
          heal = 5; p.heal(3);
          _pt.set(H.head.x, H.head.y - 0.2, H.head.z); i.burst('glow', col, _pt, 10, 0.6, _v.set(0, 0.8, 0));
          i.snd().chord([1319, 1760, 2093], { dur: 0.5, type: 'sine', vol: 0.1, at: g.position, stagger: 0.06 });
        } else heal = 1;
      }
      spoke -= dt;
    });
  }, { noPush: true, size: 0.3, distance: 2, pop: null }); // a glowing sprite, not a fighter

  // ---- robot buddy
  def('robot-buddy', 'little hovering helper bot with a screen face; follows you, zaps enemies, beeps', 'color, hp', ['robot', 'robot friend', 'bot', 'companion bot', 'droid', 'helper bot', 'ally robot', 'buddy'], (i, o) => {
    const accent = o.color ?? 0x3aa0ff;
    const rb = H.monster(i, {
      faction: 'friendly', height: 1.0, radius: 0.35, centerY: 0.55, hover: 0.5, bob: 0.07, bobF: 2.6, speed: 3.4, stride: 3, hp: o.hp ?? 40, death: 'crash', lifeAfter: 1.4, eyeH: 0.8, flying: true,
      rig: (a, pivot) => {
        const vis = new THREE.Group(); vis.scale.setScalar(o.scale ?? 1); pivot.add(vis);
        part(vis, (b) => {
          b.sph(0, 0.42, 0, 0.27, 0.24, 0.27, 0xe8eef4, 0, 9); b.cyl(0, 0.2, 0, 0.14, 0.19, 0.1, 0x6a7886, 0, 9); b.tor(0, 0.43, 0, 0.275, 0.025, accent, [PI / 2, 0, 0], 12);
          b.mode('glow'); b.cone(0, 0.18, 0, 0.1, 0.16, 0x7ad0ff, FLIP, 7); b.mode('solid');
        });
        const headG = part(vis, (b) => {
          b.sph(0, 0, 0, 0.21, 0.17, 0.2, 0xf4f8fc, 0, 9); b.box(0, 0, 0.14, 0.27, 0.14, 0.05, 0x101820); b.cyl(0.1, 0.14, 0, 0.012, 0.012, 0.18, 0x6a7886);
          b.mode('glow'); b.sph(0.1, 0.33, 0, 0.03, 0.03, 0.03, accent); b.box(0.065, 0.015, 0.168, 0.06, 0.05, 0.012, 0x7affff); b.box(-0.065, 0.015, 0.168, 0.06, 0.05, 0.012, 0x7affff);
        }, 0, 0.78, 0);
        const arms = [-1, 1].map((s) => part(vis, (b) => { b.sph(0, 0, 0, 0.065, 0.065, 0.065, 0xf4f8fc); b.cyl(0, -0.02, 0, 0.02, 0.02, 0.1, 0x6a7886, [0, 0, 1.2 * s]); }, 0.36 * s, 0.4, 0.04));
        return { anim(a, dt, t, m) { headG.rotation.y = a.lookYaw; headG.rotation.x = -a.lookPitch * 0.6 + Math.sin(t * 1.3 + a.seed) * 0.03; for (let k = 0; k < 2; k++) { arms[k].position.z = 0.04 + 0.3 * (a.atkRaise + a.atkSwing); arms[k].position.y = 0.4 + 0.12 * Math.sin(t * 2 + k * 2); } vis.rotation.x = 0.18 * Math.min(1, m); vis.rotation.z = Math.sin(t * 1.5 + a.seed) * 0.04; } };
      },
      fight: fightOpts(o, { faction: 'friendly', attack: 'ranged', damage: 3, range: 12, cooldown: 1.4, windup: 0.4, aggroRange: 16, speed: 3.4, projectile: { color: 0x58e6ff, speed: 16, radius: 0.1, splash: 0.2 } }),
      onDie: (a) => { H.kit()?.explosion(i.ctx, _pt.set(a.position.x, a.position.y + 0.5, a.position.z), { size: 0.7, color: 0x58e6ff }); },
    });
    const a = rb.actor;
    armA(i, rb, [B.sniper({ laser: false, ideal: 0.7 }), B.spotter(), B.formation({ row: 'mid' })], { talk: false });
    if (a) {
      const s = i.snd(); s.tone({ freq: 880, dur: 0.1, type: 'square', vol: 0.1, at: a.position }); s.tone({ freq: 1320, dur: 0.14, type: 'square', vol: 0.1, at: a.position, delay: 0.11 });
      a.say('Beep boop!', 2.5);
      let next = rand(10, 20);
      i.tick((dt, t) => { if (a.removed || a.dead) return true; if (t > next) { next = t + rand(14, 30); a.say(pick(['Beep!', 'All systems nominal.', 'Scanning...', 'Boop?']), 2.2); i.snd().tone({ freq: 700 + rand(0, 500), freqEnd: 900, dur: 0.12, type: 'square', vol: 0.07, at: a.position }); } }, { every: 0.5 });
    }
  });
}

