// library/life.js - neutral life: villagers and townsfolk, farm and wild animals, birds, butterflies, a fish pond.
// Neutral things fight nobody; hit them and they yell and run. People greet you when you come near.
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, ease, shade, part, worldAdd, mdl } = H;
  const PI = Math.PI, FLIP = [PI, 0, 0];
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'life', description, options, aliases, build, ...extra });
  const _pt = new THREE.Vector3(), _v = new THREE.Vector3();
  const SKIN = [0xf0c8a0, 0xe0ac86, 0xc68642, 0x8d5524, 0xffdbb0], HAIR = [0x2a1a10, 0x5a3a1a, 0xc9a050, 0x1a1a1a, 0x8a8a8a, 0xa0522d, 0xd8c07a];
  const SHIRT = [0x3d6fb0, 0x8a3a3a, 0x4a8a4a, 0xb0903a, 0x7a4a8a, 0x3a8a8a, 0xa05a30, 0xd0c8b0];
  const PANTS = [0x3b3a45, 0x4a4030, 0x2f3a4a, 0x5a4a3a, 0x3a4a30];

  // ---------------------------------------------------------------- people
  // model casting (H.cast / H.modelList in gear.js): Kenney mini villagers for the townsfolk (one rig, 3-7 bones, 1 draw call: crowds are cheap), KayKit mage for the wizard,
  // cube animals for the animals. A `model` that does not resolve (or fails to load) falls back to the primitive person / creature built from the other options.
  const VIL_M = ['villager-male-a', 'villager-male-b', 'villager-male-c', 'villager-male-d', 'villager-male-e', 'villager-male-f'];
  const VIL_F = ['villager-female-a', 'villager-female-b', 'villager-female-c', 'villager-female-d', 'villager-female-e', 'villager-female-f'];
  const CAST = {
    villager: () => [{ model: pick(Math.random() < 0.5 ? VIL_M : VIL_F) }],
    farmer: [{ model: 'villager-male-b', hold: { right: 'tool-hoe' }, wscale: 1.0 }],
    merchant: [{ model: 'villager-male-e', bulk: 1.08 }],
    blacksmith: [{ model: 'villager-male-c', bulk: 1.15, hold: { right: 'tool-hammer' }, wscale: 1.0 }],
    bard: [{ model: 'villager-female-d' }],
    child: () => [{ model: pick(['villager-male-f', 'villager-female-f', 'villager-female-b']), height: 1.05 }],
    wizard: [{ model: 'mage', tint: 0xd0d0e0, height: 1.8, caster: true }],
    king: [{ model: 'villager-male-a', bulk: 1.18, hold: { right: 'wand' }, wscale: 1.4 }],
  };
  H.CAST = Object.assign(H.CAST || {}, { life: CAST });
  function civilian(inst, o, s) {
    let hit = null;
    const a = inst.person({
      height: (s.h ?? 1.7) * (o.scale ?? 1), skin: o.skin ?? s.skin ?? pick(SKIN), shirt: o.shirt ?? s.shirt ?? pick(SHIRT), pants: s.pants ?? pick(PANTS), hair: s.hair === null ? undefined : (s.hair ?? pick(HAIR)),
      hat: s.hat, bulk: s.bulk, x: s.x, z: s.z, speed: s.speed ?? 1.25, faction: 'neutral', hp: o.hp ?? s.hp ?? 20, onHit: (e) => { if (hit) hit(e); }, model: H.modelList(s.model, o),
    });
    if (!a) return {};
    a.whenPrimitive((pa) => { // primitive bodies only: the primitive gear and weapon (model bodies have their own clothes; mgear is extra gear for them)
      if (s.gear) H.dress(pa, s.gear);
      if (s.weapon) pa.equip(H.weaponMesh(s.weapon, { scale: s.wscale }));
    });
    if (s.mgear) a.whenModel((ma) => H.dress(ma, s.mgear));
    const wd = o.wander !== undefined ? o.wander : s.wander; // (wander: 0 in the spawn options keeps a person standing still)
    if (wd !== 0) a.wander(wd ?? 5, { x: inst.x, z: inst.z });
    hit = s.stand ? () => {} : H.panic(inst, a);
    if (s.lines) H.greeter(inst, a, s.lines, { radius: s.greetR ?? 3.5, wave: s.wave });
    return { a };
  }
  def('villager', 'ordinary villager (random clothes, hair, sometimes a hat) who wanders and chats when you come close', 'name, scale', ['villagers', 'townsperson', 'townsfolk', 'npc', 'person', 'human', 'citizen', 'man', 'woman', 'peasant', 'commoner'], (i, o) => {
    const { a } = civilian(i, o, { model: CAST.villager(), hat: Math.random() < 0.4 ? pick([0x8a6a3a, 0x3a5a8a, 0x7a3a3a]) : undefined, h: 1.6 + rand(0, 0.2),
      lines: ['Good day to you!', 'Fine weather, isn\'t it?', 'Have you seen the great eye in the sky?', 'Mind the wolves after dark.', 'Lovely evening for a stroll.', 'I heard something rumbling in the hills...'] });
    if (a && o.name) i.label(o.name, { size: 0.08, parent: a.group, position: { x: 0, y: a.height + 0.3, z: 0 } });
  });
  def('farmer', 'straw-hatted farmer in blue overalls hoeing the ground with a pitchfork', 'name', ['farm hand', 'farmhand', 'peasant farmer', 'farmers', 'gardener'], (i, o) => {
    const { a } = civilian(i, o, { model: CAST.farmer, mgear: [['head', 'strawHat']], h: 1.75, shirt: 0xc86a4a, pants: 0x3a5a8a, hair: 0x8a6a30, wander: 2, speed: 1.0, weapon: 'spear', wscale: 0.8,
      gear: [['head', 'strawHat']], lines: ['Crops are coming in nicely.', 'Mind the rows!', 'Rain would be welcome.', 'Hard work, but honest.'] });
    if (!a) return;
    let cd = rand(1, 3), strike = -1;
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      if (strike >= 0) { strike -= dt; if (strike <= 0) { strike = -1; _pt.set(a.position.x + Math.sin(a.yaw) * 0.9, a.position.y + 0.1, a.position.z + Math.cos(a.yaw) * 0.9); i.burst('puff', 0x7a5a3a, _pt, 5, 0.4); i.snd().noise({ dur: 0.1, filter: { type: 'lowpass', freq: 500 }, vol: 0.12, at: a.position }); } return; }
      cd -= dt;
      if (cd <= 0 && !a.moving && !a.lookTarget && !a.attacking) { cd = rand(3, 5); a.attackAnim(0.55, 'melee'); strike = 0.72; }
    }, { every: 0.1 });
  });
  def('merchant', 'travelling merchant behind his own market stall with a fat backpack; greets and hawks wares', 'name', ['shopkeeper', 'trader', 'vendor', 'shop', 'seller', 'salesman', 'merchants', 'peddler'], (i, o) => {
    const w = i.at(0, -0.15);
    i.sub('market-stall', { lx: 0, lz: 1.3, yaw: 0 });
    const r = civilian(i, o, { model: CAST.merchant, mgear: [['pivot', 'backpack', 0x6a4a2a]], x: w.x, z: w.z, h: 1.7, bulk: 1.1, shirt: 0x6a2a4a, pants: 0x3a2a30, hair: 0x2a1a10, hat: 0x6a2a4a, wander: 0, stand: true, gear: [['pivot', 'backpack', 0x6a4a2a], ['pivot', 'apron', 0xd8c8a0]], greetR: 7 });
    const a = r.a; if (!a) return;
    const lines = ['Fine wares! Finest in the land!', 'Potions, swords, trinkets!', 'Everything must go!', 'For you, a special price.', 'Care to browse, traveller?'];
    let next = rand(2, 6);
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      const d = Math.hypot(H.head.x - a.position.x, H.head.z - a.position.z);
      a.lookAt(d < 14 ? H.head : null);
      if (t > next && d < 12) { next = t + rand(8, 14); a.say(pick(lines), 3.5); if (d < 7) a.wave(1.5); }
    }, { every: 0.25 });
  }, { size: 1.8, distance: 6 });
  def('blacksmith', 'burly smith with an apron hammering an anvil: sparks and ringing clangs', 'name', ['smith', 'forge master', 'metalworker', 'armorer', 'blacksmiths'], (i, o) => {
    const w = i.at(0, -0.25), anv = i.at(0, 0.7);
    i.sub('anvil', { lx: 0, lz: 0.7, yaw: 0 });
    const r = civilian(i, o, { model: CAST.blacksmith, x: w.x, z: w.z, h: 1.8, bulk: 1.2, skin: 0xd09a74, shirt: 0x5a4a40, pants: 0x2a2a30, hair: 0x2a1a10, wander: 0, stand: true, weapon: 'warhammer', wscale: 0.55,
      gear: [['pivot', 'apron', 0x2a2420], ['head', 'beard', 0x3a2a20], ['head', 'goggles']], greetR: 3 });
    const a = r.a; if (!a) return;
    const lines = ['Hot work, this!', 'A good blade takes patience.', 'Mind the sparks!', 'Need something forged?'];
    let cd = 1, strike = -1, nl = rand(6, 12);
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      a.faceTo({ x: anv.x, z: anv.z }, 0.3);
      if (strike >= 0) {
        strike -= dt;
        if (strike <= 0) {
          strike = -1; _pt.set(anv.x, H.ground(anv.x, anv.z) + 0.95, anv.z); i.burst('spark', 0xffb040, _pt, 16, 1.0, _v.set(0, 2, 0));
          const s = i.snd(); s.tone({ freq: 1500 + rand(0, 400), freqEnd: 1400, dur: 0.35, type: 'triangle', vol: 0.2, at: _pt }); s.tone({ freq: 3100, dur: 0.2, type: 'sine', vol: 0.08, at: _pt }); s.noise({ dur: 0.06, filter: { type: 'highpass', freq: 3000 }, vol: 0.2, at: _pt });
        }
        return;
      }
      cd -= dt;
      if (cd <= 0 && !a.attacking) { cd = rand(1.4, 2.0); a.attackAnim(0.42, 'melee'); strike = 0.58; }
      nl -= dt; if (nl <= 0 && Math.hypot(H.head.x - a.position.x, H.head.z - a.position.z) < 9) { nl = rand(12, 20); a.say(pick(lines), 3); }
    }, { every: 0.05 });
  }, { size: 1.5, distance: 6 });
  def('bard', 'wandering minstrel with a lute who plays procedural folk tunes as you listen', 'name', ['musician', 'minstrel', 'troubadour', 'lute player', 'singer', 'bards', 'musicians'], (i, o) => {
    const lute = H.mk(); lute.sph(0, 0, 0.0, 0.1, 0.06, 0.14, 0xb4783a); lute.box(0, 0, -0.32, 0.035, 0.03, 0.4, 0x4a2e1a); lute.box(0, 0.0, -0.55, 0.06, 0.04, 0.08, 0x4a2e1a); lute.mode('glow'); lute.sph(0, 0.062, 0.0, 0.04, 0.01, 0.04, 0x1a0e08);
    const { a } = civilian(i, o, { model: CAST.bard, h: 1.72, shirt: 0xa83a5a, pants: 0x2a3a5a, hair: 0x6a3a1a, hat: 0x2a6a4a, wander: 1.5, speed: 0.9, gear: [['pivot', 'cape', 0x2a6a4a], ['pivot', 'scarf', 0xe8c84a]] });
    if (!a) return;
    a.equip(lute.build());
    const SCALE = [0, 2, 4, 7, 9, 12, 14], base = 261.63 * (Math.random() < 0.5 ? 1 : 0.8909); // major pentatonic
    const midi = (n) => base * Math.pow(2, n / 12);
    const pat = [0, 2, 4, 2, 5, 4, 2, 0, 4, 5, 6, 5, 4, 2, 0, -1];
    let step = 0, nt = 0, say = rand(4, 8);
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      const d = Math.hypot(H.head.x - a.position.x, H.head.z - a.position.z);
      if (d > 30) return;
      nt -= dt;
      if (nt <= 0) {
        nt = Math.random() < 0.15 ? 0.9 : 0.3; // some held notes
        const n = SCALE[((pat[step++ % pat.length] % 7) + 7) % 7] + (Math.random() < 0.1 ? 12 : 0), f = midi(n);
        const s = i.snd(); s.tone({ freq: f, dur: 0.9, type: 'triangle', vol: 0.16, at: a.position }); s.tone({ freq: f * 2, dur: 0.4, type: 'sine', vol: 0.05, at: a.position });
        if (step % 4 === 0) s.tone({ freq: midi(SCALE[0] - 12), dur: 1.2, type: 'sine', vol: 0.1, at: a.position });
        _pt.set(a.position.x, a.position.y + 1.8, a.position.z); if (Math.random() < 0.5) i.burst('glow', 0xffe27a, _pt, 1, 0.25, _v.set(rand(-0.3, 0.3), 0.8, rand(-0.3, 0.3)));
      }
      say -= dt; if (say <= 0 && d < 12) { say = rand(10, 18); a.say(pick(['~ la la la ~', '~ a tale of two knights... ~', '~ fa la lee ~', 'Care for a song?']), 3); }
    });
  });
  def('child', 'small excitable child (about 1 m) who runs around giggling and waves at you', 'name', ['kid', 'children', 'boy', 'girl', 'toddler', 'youngster'], (i, o) => {
    civilian(i, o, { model: CAST.child(), h: 1.05, speed: 2.4, wander: 7, hair: pick(HAIR), shirt: pick([0xe05a6a, 0x5ab0e0, 0xe0c040, 0x70c070]), lines: ['Hi hi hi!', 'Tag! You\'re it!', 'Wanna play?', 'Look, a big eye in the sky!', 'Tee hee!'], wave: true });
  });
  def('wizard-npc', 'wise old wizard with a long beard, big hat and a staff; conjures sparkles and murmurs riddles', 'name', ['old wizard', 'merlin', 'gandalf', 'sage', 'mystic', 'wise man', 'warlock npc', 'wizards'], (i, o) => {
    const { a } = civilian(i, o, { model: CAST.wizard, h: 1.8, skin: 0xe8c8a8, shirt: 0x5a5a8a, pants: 0x3a3a5a, hair: 0xe8e8e8, wander: 3, speed: 0.9, weapon: 'magic-staff', wscale: 0.9,
      gear: [['pivot', 'robe', 0x4a4a7a], ['head', 'bigHat', 0x4a4a7a], ['head', 'beard', 0xeeeeee]], hat: undefined, greetR: 4.5,
      lines: ['Ah, a visitor to the field.', 'The sky watches, and the sky answers.', 'Magic is only the art of asking properly.', 'Beware the stars tonight.', 'I knew your grandfather. Or was it a toad?'] });
    if (!a) return;
    let nextS = rand(1, 3);
    i.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      nextS -= dt;
      if (nextS < 0) { nextS = rand(1.5, 3.5); const x = a.position.x + Math.sin(a.yaw) * 0.5, z = a.position.z + Math.cos(a.yaw) * 0.5; _pt.set(x, a.position.y + 2.1, z); i.burst('glow', pick([0x9a7bff, 0x58e6ff, 0xffe27a]), _pt, 4, 0.5, _v.set(rand(-0.4, 0.4), 0.9, rand(-0.4, 0.4))); }
    }, { every: 0.1 });
  });
  def('king', 'portly king in an ermine mantle, gold crown and scepter; very full of himself', 'name', ['monarch', 'ruler', 'lord', 'emperor', 'majesty', 'kings', 'queen'], (i, o) => {
    civilian(i, o, { model: CAST.king, mgear: [['head', 'crown', 0xe0b83a], ['pivot', 'cape', 0xa01a2a]], h: 1.85, bulk: 1.2, skin: 0xf0c8a0, shirt: 0xa01a2a, pants: 0x4a1020, hair: 0x6a4a1a, wander: 1.5, speed: 0.9, weapon: 'wand', wscale: 1.7,
      gear: [['head', 'crown', 0xe0b83a], ['pivot', 'cape', 0xa01a2a], ['pivot', 'mantle', 0xf4f0e4], ['pivot', 'belt', 0xe0b83a], ['head', 'beard', 0x6a4a1a]], greetR: 5,
      lines: ['Bow before your king!', 'Do you know who I am?', 'My kingdom is vast. Mostly field.', 'Bring me a snack!', 'Hmm. You may approach.'] });
  }, { size: 0.8 });

  // ---------------------------------------------------------------- animals
  const VOICE = {
    meow: (s, p) => { s.tone({ freq: 600, freqEnd: 900, dur: 0.25, type: 'sine', vol: 0.08, at: p }); s.tone({ freq: 900, freqEnd: 520, dur: 0.35, type: 'sine', vol: 0.08, at: p, delay: 0.25 }); },
    bark: (s, p) => { for (let k = 0; k < 2; k++) { s.tone({ freq: 470, freqEnd: 250, dur: 0.12, type: 'sawtooth', vol: 0.14, at: p, delay: k * 0.2 }); s.noise({ dur: 0.08, filter: { type: 'bandpass', freq: 900, q: 1.5 }, vol: 0.1, at: p, delay: k * 0.2 }); } },
    cluck: (s, p) => { for (let k = 0; k < 3; k++) s.tone({ freq: 650 - k * 70, freqEnd: 480, dur: 0.07, type: 'triangle', vol: 0.09, at: p, delay: k * 0.09 }); },
    baa: (s, p) => { s.tone({ freq: 330, freqEnd: 250, dur: 0.8, type: 'sawtooth', vol: 0.06, at: p }); s.tone({ freq: 335, freqEnd: 255, dur: 0.8, type: 'square', vol: 0.025, at: p }); },
    moo: (s, p) => { s.tone({ freq: 140, freqEnd: 96, dur: 1.3, type: 'sawtooth', vol: 0.1, at: p }); s.tone({ freq: 280, freqEnd: 190, dur: 1.3, type: 'sine', vol: 0.05, at: p }); },
    neigh: (s, p) => { s.tone({ freq: 500, freqEnd: 950, dur: 0.22, type: 'sawtooth', vol: 0.07, at: p }); s.tone({ freq: 950, freqEnd: 330, dur: 0.7, type: 'sawtooth', vol: 0.07, at: p, delay: 0.22 }); },
    oink: (s, p) => { for (let k = 0; k < 2; k++) s.tone({ freq: 230, freqEnd: 130, dur: 0.14, type: 'square', vol: 0.06, at: p, delay: k * 0.2 }); },
    yip: (s, p) => { for (let k = 0; k < 2; k++) s.tone({ freq: 900, freqEnd: 1300, dur: 0.1, type: 'triangle', vol: 0.07, at: p, delay: k * 0.15 }); },
    squeak: (s, p) => { s.tone({ freq: 2200, freqEnd: 1800, dur: 0.06, type: 'sine', vol: 0.04, at: p }); },
  };
  // critter(inst, o, spec): neutral creature that wanders, makes noise near the player, optionally flees (shy) or approaches (friendly)
  function critter(inst, o, s) {
    let hit = null;
    const coat = o.color ?? (s.colors ? pick(s.colors) : s.color);
    // model bodies take the coat colour as a tint when the entry says so (s.tintCoat), e.g. a black or white cat
    const ml = H.modelList(typeof s.model === 'function' ? s.model(coat) : s.model, o);
    const a = inst.creature({ size: s.size * (o.scale ?? 1), legs: s.legs, color: coat, accent: s.accent, eyeColor: s.eye, speed: s.speed ?? 1.4, faction: 'neutral', hp: o.hp ?? s.hp ?? 14, bulk: s.bulk, tall: s.tall, onHit: (e) => { if (hit) hit(e); }, model: ml });
    if (!a) return {};
    if (s.dress) a.whenPrimitive((pa) => s.dress(pa));
    a.wander(s.wander ?? 6, { x: inst.x, z: inst.z });
    const base = s.speed ?? 1.4;
    let fleeing = false, next = rand(2, 9), run = 0;
    const panicFn = H.panic(inst, a, s.cries ?? ['!'], 4);
    hit = (e) => { if (s.voice) VOICE[s.voice](inst.snd(), a.position); panicFn(e); };
    inst.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      const dx = H.head.x - a.position.x, dz = H.head.z - a.position.z, d = Math.hypot(dx, dz);
      if (s.shy) {
        const nd = d || 1;
        if (!fleeing) { if (d < s.shy) { fleeing = true; run = 2.5; H.speedMul(a, 'flee', s.run ? s.run / base : 3); a.lookAt(null); a.walkTo(a.position.x - (dx / nd) * 14, a.position.z - (dz / nd) * 14); } }
        else {
          run -= 0.2;
          if (!a.hasGoal && d < s.shy * 1.4) a.walkTo(a.position.x - (dx / nd) * 10, a.position.z - (dz / nd) * 10);
          if (run <= 0 && d > s.shy * 1.7) { fleeing = false; H.speedMul(a, 'flee', 1); a.wander(s.wander ?? 6, { x: a.position.x, z: a.position.z }); }
        }
      } else if (s.friendly) {
        if (d < 9 && d > 2.2 && !a.followTarget) { a.follow(H.head, 1.6); H.speedMul(a, 'friend', 2.2); }
        else if (a.followTarget && (d > 16)) { a.follow(null); H.speedMul(a, 'friend', 1); a.wander(s.wander ?? 6, { x: a.position.x, z: a.position.z }); }
      }
      if (s.voice && t > next && d < 18) { next = t + rand(8, 20); VOICE[s.voice](inst.snd(), a.position); }
    }, { every: 0.2 });
    return { a };
  }
  const dr = (a, list) => H.dressCreature(a, list);
  def('cat', 'house cat in a random coat colour; wanders, purrs up to you and meows', 'color', ['kitten', 'kitty', 'cats', 'tabby', 'feline'], (i, o) => {
    critter(i, o, { model: (coat) => [{ model: 'cat', tint: coat, size: 0.42 }], size: 0.5, colors: [0xe0903a, 0x7a7a82, 0x1c1c22, 0xeeeeea, 0xb08a5a], accent: 0xf4ece0, eye: 0x58d058, speed: 1.2, wander: 5, voice: 'meow', friendly: true, cries: ['Hiss!', 'Mrow!'],
      dress: (a) => dr(a, [['tail', mdl('cat:tail', (b) => { b.cyl(0, 0, -0.05, 0.03, 0.025, 0.22, 0x888888, [-1.0, 0, 0]); }), 0, 0, 0]]) });
  });
  def('dog', 'friendly stray dog with floppy ears that trots over to you, barks hello and follows when you are close', 'color', ['puppy', 'doggo', 'pup', 'dogs', 'pooch', 'canine'], (i, o) => {
    critter(i, o, { model: (coat) => [{ model: 'dog', tint: coat, size: 0.62 }], size: 0.8, colors: [0xb5793c, 0x8a6a40, 0x222222, 0xd8c8a0, 0x7a5a3a], accent: 0xf3e3c4, eye: 0x1a1208, speed: 2.2, wander: 6, voice: 'bark', friendly: true, cries: ['Yelp!'],
      dress: (a) => dr(a, [['head', mdl('dog:ears', (b) => { for (const s of [-1, 1]) b.box(0.11 * s, 0.0, -0.03, 0.04, 0.16, 0.09, 0x5a3a20, [0, 0, 0.25 * s]); }), 0, 0, 0]]) });
  });
  def('chicken', 'small chicken with a red comb that wanders in jerks and clucks (use count for a flock)', 'count', ['chickens', 'hen', 'rooster', 'chook', 'fowl', 'chick'], (i, o) => {
    critter(i, o, { model: [{ model: 'chick', size: 0.32 }], size: 0.38, legs: 2, color: 0xf4f1e8, accent: 0xe8a030, eye: 0x101010, speed: 1.0, wander: 4, voice: 'cluck', shy: 2.2, run: 3.2, cries: ['Bawk!'], hp: 6,
      dress: (a) => dr(a, [['head', mdl('chicken:head', (b) => { b.sph(0, 0.13, 0, 0.03, 0.06, 0.025, 0xd83a2a); b.sph(0, -0.06, 0.15, 0.025, 0.04, 0.02, 0xd83a2a); b.cone(0, -0.01, 0.2, 0.025, 0.07, 0xe8a030, [PI / 2, 0, 0], 4); }), 0, 0, 0],
        ['pivot', mdl('chicken:body', (b) => { b.cone(0, 0.45, -0.38, 0.08, 0.26, 0xe8e0d0, [-0.5, 0, 0], 5); b.cone(0, 0.45, -0.38, 0.06, 0.22, 0xd8d0c0, [-0.2, 0.2, 0], 5); for (const s of [-1, 1]) b.sph(0.17 * s, 0.38, -0.02, 0.05, 0.13, 0.22, 0xe8e0d0, [0, 0, 0.1 * s]); }), 0, 0, 0]]) });
  });
  def('sheep', 'fluffy white sheep with a dark face that grazes in slow circles and baas', 'count', ['sheeps', 'lamb', 'ram', 'flock of sheep', 'ewe'], (i, o) => {
    critter(i, o, { size: 0.95, color: 0xf0eee6, accent: 0x3a3a3e, eye: 0x101010, speed: 0.8, wander: 5, voice: 'baa', shy: 2.5, run: 2.6, cries: ['Baaa!'], hp: 18,
      dress: (a) => dr(a, [['pivot', mdl('sheep:wool', (b) => { for (const [x, y, z, r] of [[0, 0.64, 0, 0.25], [0.17, 0.5, 0.18, 0.24], [-0.17, 0.5, 0.18, 0.24], [0.17, 0.5, -0.2, 0.25], [-0.17, 0.5, -0.2, 0.25], [0, 0.55, 0.32, 0.22], [0, 0.55, -0.36, 0.23], [0, 0.42, 0, 0.26]]) b.sph(x, y, z, r, r * 0.95, r * 1.05, 0xf4f2ea, 0, 6); }), 0, 0, 0],
        ['head', mdl('sheep:face', (b) => { b.sph(0, -0.01, 0.07, 0.15, 0.14, 0.17, 0x3a3a3e); for (const s of [-1, 1]) b.sph(0.15 * s, 0.03, -0.03, 0.08, 0.035, 0.04, 0x3a3a3e, [0, 0, 0.3 * s]); b.sph(0, 0.13, -0.01, 0.1, 0.07, 0.1, 0xf4f2ea); }), 0, 0, 0]]) });
  });
  def('cow', 'big black-and-white cow with horns and a pink nose that chews and moos', 'count', ['cows', 'cattle', 'bull', 'calf', 'ox'], (i, o) => {
    critter(i, o, { model: [{ model: 'cow', size: 1.3 }], size: 1.55, color: 0xf2f0ea, accent: 0xe8a0a8, eye: 0x101010, speed: 0.7, wander: 5, voice: 'moo', hp: 40, cries: ['MOO!'],
      dress: (a) => dr(a, [['pivot', mdl('cow:patches', (b) => { for (const [x, y, z, w, h] of [[0.2, 0.55, 0.1, 0.02, 0.22], [-0.2, 0.62, -0.15, 0.02, 0.25], [0.0, 0.7, 0.2, 0.25, 0.02], [0.0, 0.7, -0.25, 0.2, 0.02]]) b.box(x, y, z, w, h, 0.28, 0x1a1a1e, 0, 0); b.sph(0, 0.28, -0.1, 0.07, 0.06, 0.1, 0xe8a0a8); }), 0, 0, 0],
        ['head', mdl('cow:head', (b) => { for (const s of [-1, 1]) { b.cone(0.1 * s, 0.1, -0.02, 0.03, 0.12, 0xf0e8d0, [0, 0, -0.9 * s], 5); b.sph(0.15 * s, 0.05, -0.03, 0.07, 0.03, 0.04, 0x1a1a1e, [0, 0, 0.2 * s]); } b.sph(0, -0.05, 0.19, 0.1, 0.075, 0.1, 0xe8a0a8); b.sph(0.0, 0.1, 0.05, 0.12, 0.07, 0.1, 0x1a1a1e); }), 0, 0, 0]]) });
  });
  def('horse', 'tall brown horse with a flowing mane that trots about and whinnies', 'color', ['horses', 'pony', 'stallion', 'mare', 'steed', 'stead'], (i, o) => {
    critter(i, o, { size: 1.65, tall: 1.2, colors: [0x8a5a30, 0x4a2e1a, 0xd8d0c0, 0xaa7a40], accent: 0x3a2a1a, eye: 0x080808, speed: 1.6, wander: 7, voice: 'neigh', hp: 45, cries: ['Neigh!'],
      dress: (a) => dr(a, [['pivot', mdl('horse:neck', (b) => { b.sph(0, 0.66, 0.36, 0.1, 0.22, 0.13, 0x8a5a30, [-0.55, 0, 0]); b.sph(0, 0.78, 0.44, 0.09, 0.16, 0.11, 0x8a5a30, [-0.55, 0, 0]); b.box(0, 0.84, 0.28, 0.04, 0.3, 0.06, 0x241810, [-0.5, 0, 0]); }), 0, 0, 0],
        ['head', mdl('horse:snout', (b) => { b.box(0, -0.03, 0.2, 0.09, 0.09, 0.2, 0x7a4a28); b.box(0, 0.12, -0.08, 0.04, 0.1, 0.08, 0x241810); }), 0, 0, 0],
        ['tail', mdl('horse:tail', (b) => { b.cyl(0, 0, -0.04, 0.045, 0.02, 0.4, 0x241810, [-2.9, 0, 0]); }), 0, 0, 0]]) });
  });
  def('pig', 'round pink pig with a snout and a curly tail; snuffles and oinks', 'count', ['pigs', 'hog', 'piglet', 'boar'], (i, o) => {
    critter(i, o, { model: [{ model: 'pig', size: 0.7 }], size: 0.85, color: 0xf0a0a8, accent: 0xd88090, eye: 0x101010, speed: 1.0, wander: 4, voice: 'oink', hp: 20, cries: ['OINK!'], bulk: 1.15,
      dress: (a) => dr(a, [['head', mdl('pig:snout', (b) => { b.cylc(0, -0.04, 0.2, 0.065, 0.065, 0.06, 0xd88090, [PI / 2, 0, 0], 8); b.box(0.02, -0.04, 0.231, 0.016, 0.02, 0.01, 0x502028); b.box(-0.02, -0.04, 0.231, 0.016, 0.02, 0.01, 0x502028); }), 0, 0, 0],
        ['tail', mdl('pig:tail', (b) => { b.tor(0, 0.0, -0.08, 0.05, 0.012, 0xd88090, [0, PI / 2, 0], 8); }), 0, 0, 0]]) });
  });
  def('deer', 'graceful stag with branching antlers and a white tail; bolts when you get within 7 m', 'count', ['stag', 'buck', 'doe', 'deers', 'elk', 'reindeer'], (i, o) => {
    critter(i, o, { model: [{ model: 'deer', tall: 1, size: 1.1 }], size: 1.4, tall: 1.15, color: 0xb98a55, accent: 0xf0e0c8, eye: 0x101010, speed: 1.2, wander: 8, shy: 7, run: 5.6, hp: 25,
      dress: (a) => dr(a, [['head', mdl('deer:antlers', (b) => { for (const s of [-1, 1]) { b.cone(0.06 * s, 0.1, -0.04, 0.016, 0.36, 0x6a4a2a, [0.1, 0, -0.35 * s], 4); b.cone(0.12 * s, 0.26, -0.08, 0.012, 0.18, 0x6a4a2a, [0.5, 0, -0.9 * s], 4); b.cone(0.14 * s, 0.3, -0.04, 0.012, 0.16, 0x6a4a2a, [-0.4, 0, -0.5 * s], 4); } }), 0, 0, 0],
        ['tail', mdl('deer:tail', (b) => { b.sph(0, 0.03, -0.05, 0.06, 0.08, 0.05, 0xf8f0e4); }), 0, 0, 0]]) });
  });
  def('rabbit', 'small grey-brown rabbit with long ears and a fluffy white tail; hops away when you approach', 'count', ['bunny', 'rabbits', 'hare', 'bunnies', 'cottontail'], (i, o) => {
    critter(i, o, { model: [{ model: 'bunny', size: 0.3 }], size: 0.36, color: 0xb0a090, accent: 0xf0e8dc, eye: 0x101010, speed: 0.9, wander: 4, shy: 4.5, run: 4.8, voice: 'squeak', hp: 5,
      dress: (a) => dr(a, [['head', mdl('rabbit:ears', (b) => { for (const s of [-1, 1]) { b.cone(0.05 * s, 0.1, -0.04, 0.035, 0.3, 0xb0a090, [-0.2, 0, -0.2 * s], 5); b.cone(0.05 * s, 0.12, -0.03, 0.018, 0.22, 0xe8b8b8, [-0.2, 0, -0.2 * s], 5); } }), 0, 0, 0],
        ['tail', mdl('rabbit:tail', (b) => { b.sph(0, 0.0, -0.06, 0.07, 0.07, 0.07, 0xfaf6f0); }), 0, 0, 0]]) });
  });
  def('fox', 'sly orange fox with a white-tipped bushy tail; wary, keeps its distance and yips', 'count', ['foxes', 'red fox', 'vixen', 'kitsune'], (i, o) => {
    critter(i, o, { model: [{ model: 'fox', size: 0.6 }], size: 0.72, color: 0xd86a2a, accent: 0xf6efe6, eye: 0xffd34a, speed: 1.6, wander: 7, shy: 6, run: 5.4, voice: 'yip', hp: 12,
      dress: (a) => dr(a, [['tail', mdl('fox:tail', (b) => { b.sph(0, 0, -0.28, 0.1, 0.1, 0.3, 0xd86a2a); b.sph(0, 0, -0.55, 0.08, 0.08, 0.1, 0xfaf4ec); }), 0, 0, 0],
        ['head', mdl('fox:face', (b) => { for (const s of [-1, 1]) b.cone(0.09 * s, 0.1, -0.02, 0.05, 0.14, 0x2a1a14, [0, 0, -0.2 * s], 4); b.sph(0, -0.06, 0.12, 0.06, 0.05, 0.1, 0xf6efe6); }), 0, 0, 0]]) });
  });

  // ---------------------------------------------------------------- instanced fliers
  const U = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(), q4: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), x1: new THREE.Vector3(1, 0, 0), ax: new THREE.Vector3(0, 0, 1), ay: new THREE.Vector3(0, 1, 0), c: new THREE.Color() };
  function birdGeos(body, wing, beak) {
    const b = H.mk(); b.mode('cloth');
    b.sph(0, 0, 0, 0.07, 0.065, 0.16, body); b.sph(0, 0.04, 0.17, 0.05, 0.05, 0.055, body); b.cone(0, 0.04, 0.2, 0.018, 0.07, beak, [PI / 2, 0, 0], 4); b.cone(0, 0.0, -0.17, 0.05, 0.16, body, [-PI / 2 - 0.1, 0, 0], 4);
    const wing_ = (s) => { const w = H.mk(); w.mode('cloth'); w.sph(0.2 * s, 0, 0, 0.2, 0.012, 0.09, wing); return w.geos().cloth; };
    return { body: b.geos().cloth, wingR: wing_(1), wingL: wing_(-1) };
  }
  def('crow-flock', 'crows peck the ground, then scatter into the sky circling and cawing when you come near (kind: crow|dove|gull; count)', 'count, kind, radius', ['crows', 'crow', 'birds', 'bird', 'flock of birds', 'ravens', 'raven', 'doves', 'dove', 'pigeons', 'seagulls', 'gulls', 'flock'], (i, o) => {
    const N = Math.max(1, Math.round(clamp(Math.floor(o.count ?? 7), 1, 40) * H.density())), R = o.radius ?? 3.2; // smaller flocks under load
    const kind = o.kind ?? 'crow', pal = kind === 'dove' ? [0xf4f4f0, 0xe0e0dc, 0xe8a0a0] : kind === 'gull' ? [0xf2f2ee, 0x8a949c, 0xf0b030] : [0x17171d, 0x24242c, 0xd88a30];
    const G = birdGeos(...pal);
    const mat = () => H.ownMat('cloth');
    const bodyIM = new THREE.InstancedMesh(G.body, mat(), N), wR = new THREE.InstancedMesh(G.wingR, mat(), N), wL = new THREE.InstancedMesh(G.wingL, mat(), N);
    for (const im of [bodyIM, wR, wL]) { im.frustumCulled = false; worldAdd(i, im); }
    const birds = [];
    for (let k = 0; k < N; k++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, px = i.x + Math.cos(a) * r, pz = i.z + Math.sin(a) * r;
      birds.push({ px, pz, py: H.ground(px, pz) + 0.08, yaw: rand(0, TAU), th: rand(0, TAU), w: rand(0.5, 0.9) * (Math.random() < 0.5 ? 1 : -1), rr: rand(7, 14), hh: rand(7, 13), m: 0, hop: rand(0, 5), x: px, y: 0, z: pz, peck: rand(0, 6) });
    }
    let state = 'perched', flyFor = 0;
    const cx = i.x, cz = i.z;
    const upd = (dt, t) => {
      const d = Math.hypot(H.head.x - cx, H.head.z - cz);
      if (state === 'perched' && d < R + 2.5) { state = 'flying'; flyFor = rand(14, 24); const s = i.snd(); for (let k = 0; k < 4; k++) s.tone({ freq: 500 + rand(0, 150), freqEnd: 420, dur: 0.22, type: 'sawtooth', vol: 0.07, at: { x: cx, y: 3, z: cz }, delay: k * 0.18 + rand(0, 0.1) }); s.noise({ dur: 0.5, filter: { type: 'bandpass', freq: 2500, q: 1 }, vol: 0.12, at: { x: cx, y: 1, z: cz } }); }
      else if (state === 'flying') { flyFor -= dt; if (flyFor < 0 && d > R + 12) state = 'perched'; if (Math.random() < dt * 0.15) i.snd().tone({ freq: 480 + rand(0, 100), freqEnd: 400, dur: 0.25, type: 'sawtooth', vol: 0.06, at: { x: cx + Math.cos(t) * 8, y: 10, z: cz + Math.sin(t) * 8 } }); }
      for (let k = 0; k < N; k++) {
        const b = birds[k];
        b.m = clamp(b.m + (state === 'flying' ? 0.55 : -0.4) * dt, 0, 1);
        b.th += b.w * dt;
        const e = ease.out(b.m);
        const fx = cx + Math.cos(b.th) * b.rr, fz = cz + Math.sin(b.th) * b.rr, fy = H.ground(fx, fz) + b.hh;
        const nx = b.px + (fx - b.px) * e, nz = b.pz + (fz - b.pz) * e, ny = b.py + (fy - b.py) * e + Math.sin(b.m * PI) * 2.5;
        const vx = nx - b.x, vz = nz - b.z;
        b.x = nx; b.y = ny; b.z = nz;
        if (b.m > 0.02 && vx * vx + vz * vz > 1e-6) b.yaw = Math.atan2(vx, vz);
        else if (b.m <= 0.02) { b.hop -= dt; if (b.hop < 0) { b.hop = rand(1, 5); b.yaw += rand(-1.2, 1.2); } }
        const flying = b.m > 0.05;
        const peck = flying ? 0 : Math.max(0, Math.sin(t * 3 + b.peck * 5)) * 0.5 * (Math.sin(t * 0.7 + b.peck) > 0.3 ? 1 : 0);
        U.p.set(b.x, b.y + 0.09, b.z);
        const tilt = flying ? -0.1 - Math.min(0.3, Math.max(0, (fy - b.y) * 0.02)) : peck;
        U.q.setFromAxisAngle(U.ay, b.yaw); U.q3.setFromAxisAngle(U.x1, tilt); U.q4.copy(U.q).multiply(U.q3);
        bodyIM.setMatrixAt(k, U.m.compose(U.p, U.q4, U.s));
        const fl = flying ? Math.sin(t * 13 + k * 1.7) * 0.9 : -1.25; // folded when perched
        U.q3.setFromAxisAngle(U.ax, -fl); U.q2.copy(U.q4).multiply(U.q3); wR.setMatrixAt(k, U.m.compose(U.p, U.q2, U.s));
        U.q3.setFromAxisAngle(U.ax, fl); U.q2.copy(U.q4).multiply(U.q3); wL.setMatrixAt(k, U.m.compose(U.p, U.q2, U.s));
      }
      bodyIM.instanceMatrix.needsUpdate = wR.instanceMatrix.needsUpdate = wL.instanceMatrix.needsUpdate = true;
    };
    upd(0, 0);
    i.tick(upd);
  }, { ownCount: true, noPush: true, size: 2, face: 'none', pop: null });

  def('butterflies', 'a cloud of coloured butterflies fluttering around a patch of air at head height (count = number)', 'count, radius', ['butterfly', 'butterflys', 'moths', 'moth', 'insects'], (i, o) => {
    const N = Math.max(1, Math.round(clamp(Math.floor(o.count ?? 12), 1, 50) * H.density())), R = o.radius ?? 4;
    const wing = (s) => { const w = H.mk(); w.mode('cloth'); w.sph(0.05 * s, 0, 0.02, 0.06, 0.004, 0.05, 0xffffff, [0, 0.4 * s, 0]); w.sph(0.045 * s, 0, -0.04, 0.045, 0.004, 0.04, 0xeeeeee, [0, -0.4 * s, 0]); return w.geos().cloth; };
    const bd = H.mk(); bd.mode('cloth'); bd.box(0, 0, 0, 0.012, 0.012, 0.07, 0x222222);
    const bodyIM = new THREE.InstancedMesh(bd.geos().cloth, H.ownMat('cloth'), N), wR = new THREE.InstancedMesh(wing(1), H.ownMat('cloth'), N), wL = new THREE.InstancedMesh(wing(-1), H.ownMat('cloth'), N);
    const pal = [0xffa030, 0xff6aa8, 0x58b8ff, 0xffe040, 0xb080ff, 0xffffff, 0x70e070];
    const bf = [];
    for (let k = 0; k < N; k++) {
      const c = pick(pal); U.c.set(c); wR.setColorAt(k, U.c); wL.setColorAt(k, U.c);
      bf.push({ x: i.x + rand(-R, R), y: rand(0.6, 1.8), z: i.z + rand(-R, R), tx: 0, ty: 1, tz: 0, t: 0, yaw: rand(0, TAU), ph: rand(0, TAU), sp: rand(0.8, 1.6) });
    }
    for (const im of [bodyIM, wR, wL]) { im.frustumCulled = false; worldAdd(i, im); }
    wR.instanceColor.needsUpdate = wL.instanceColor.needsUpdate = true;
    i.tick((dt, t) => {
      for (let k = 0; k < N; k++) {
        const b = bf[k];
        b.t -= dt;
        if (b.t <= 0) { b.t = rand(1.5, 4); b.tx = i.x + rand(-R, R); b.tz = i.z + rand(-R, R); b.ty = rand(0.5, 2.2); }
        const dx = b.tx - b.x, dz = b.tz - b.z, dy = b.ty - b.y, d = Math.hypot(dx, dz) + 0.001;
        const sp = b.sp * (0.6 + 0.4 * Math.sin(t * 2 + b.ph));
        b.x += (dx / d) * sp * dt * 0.8 + Math.sin(t * 3 + b.ph) * 0.4 * dt; b.z += (dz / d) * sp * dt * 0.8 + Math.cos(t * 2.6 + b.ph) * 0.4 * dt; b.y += dy * dt * 0.8 + Math.sin(t * 5 + b.ph) * 0.25 * dt;
        const gy = H.ground(b.x, b.z) + 0.3; if (b.y < gy) b.y = gy;
        b.yaw += (Math.atan2(dx, dz) - b.yaw) * Math.min(1, dt * 2);
        U.q.setFromAxisAngle(U.ay, b.yaw); U.p.set(b.x, b.y, b.z);
        bodyIM.setMatrixAt(k, U.m.compose(U.p, U.q, U.s));
        const fl = 0.15 + Math.abs(Math.sin(t * 14 + b.ph)) * 1.0;
        U.q3.setFromAxisAngle(U.ax, fl); U.q2.copy(U.q).multiply(U.q3); wR.setMatrixAt(k, U.m.compose(U.p, U.q2, U.s));
        U.q3.setFromAxisAngle(U.ax, -fl); U.q2.copy(U.q).multiply(U.q3); wL.setMatrixAt(k, U.m.compose(U.p, U.q2, U.s));
      }
      bodyIM.instanceMatrix.needsUpdate = wR.instanceMatrix.needsUpdate = wL.instanceMatrix.needsUpdate = true;
    });
  }, { ownCount: true, noPush: true, size: 2, face: 'none', pop: null });

  // ---------------------------------------------------------------- fish pond
  def('fish-pond', 'round stone-rimmed pond with lily pads, lotus flowers and darting orange/white koi that sometimes jump (option fish = number of koi)', 'radius, fish', ['pond with fish', 'koi pond', 'fish', 'koi', 'goldfish', 'water garden', 'fishpond', 'lake'], (i, o) => {
    const R = (o.radius ?? 2.4) * (o.scale ?? 1), N = clamp(Math.floor(o.fish ?? 6), 1, 20);
    let top = -1e9;
    for (let k = 0; k < 9; k++) { const a = (k / 8) * TAU, g = H.ground(i.x + Math.cos(a) * R, i.z + Math.sin(a) * R); top = Math.max(top, g); }
    top = Math.max(top, H.ground(i.x, i.z));
    const waterY = top - i.y + 0.18; // relative to the instance (ground at centre)
    const b = H.mk();
    b.cyl(0, -1.0, 0, R + 0.2, R + 0.25, waterY + 1.0, 0x3a6a78, 0, 18);                 // basin (its top is the dark bottom seen through the water)
    const rr = (R + 0.28);
    for (let k = 0; k < 22; k++) { const a = (k / 22) * TAU + rand(-0.05, 0.05), s = rand(0.2, 0.34); b.dod(Math.cos(a) * rr, waterY + 0.04, Math.sin(a) * rr, s, rand(0.16, 0.26), s, pick([0x8a8680, 0x76726c, 0x9a968e]), [rand(0, 3), rand(0, 3), 0]); }
    for (let k = 0; k < 6; k++) { const a = rand(0, TAU), r = rand(0.2, R - 0.45), x = Math.cos(a) * r, z = Math.sin(a) * r; b.mode('cloth'); b.cylc(x, waterY + 0.03, z, 0.28, 0.28, 0.012, 0x3f8f3f, 0, 8); if (k % 3 === 0) { b.mode('solid'); for (let q = 0; q < 6; q++) b.cone(x + Math.cos(q * 1.05) * 0.04, waterY + 0.03, z + Math.sin(q * 1.05) * 0.04, 0.04, 0.12, pick([0xff9ac8, 0xffd0e0]), [Math.sin(q * 1.05) * 0.8, 0, -Math.cos(q * 1.05) * 0.8], 4); } }
    i.add(b.build());
    const wb = H.mk(); wb.mode('ghost'); wb.cylc(0, waterY, 0, R, R, 0.02, 0x4a9ab0, 0, 20);
    i.add(wb.build({ own: true }));
    const fg = H.mk(); fg.mode('cloth'); fg.sph(0, 0, 0, 0.05, 0.045, 0.14, 0xffffff); fg.cone(0, 0, -0.12, 0.04, 0.14, 0xffffff, [-PI / 2, 0, 0], 4); fg.box(0, 0.05, 0.0, 0.01, 0.04, 0.1, 0xffffff);
    const fish = new THREE.InstancedMesh(fg.geos().cloth, H.ownMat('cloth'), N);
    const fpal = [0xff7a2a, 0xf4f0e8, 0xffb040, 0xe04a2a, 0xffffff];
    const fs = [];
    for (let k = 0; k < N; k++) { U.c.set(pick(fpal)); fish.setColorAt(k, U.c); fs.push({ a: rand(0, TAU), r: rand(0.35, R - 0.4), w: rand(0.3, 0.8) * (Math.random() < 0.5 ? 1 : -1), j: rand(3, 12), jt: -1, d: rand(0.06, 0.16), ph: rand(0, TAU) }); }
    fish.frustumCulled = false; fish.instanceColor.needsUpdate = true; i.add(fish);
    const ox = i.x, oz = i.z, oy = i.y;
    i.tick((dt, t) => {
      for (let k = 0; k < N; k++) {
        const f = fs[k];
        f.a += f.w * dt; f.r += Math.sin(t * 0.5 + f.ph) * 0.2 * dt; f.r = clamp(f.r, 0.3, R - 0.45);
        let y = waterY - f.d, pitch = 0;
        f.j -= dt;
        if (f.j <= 0 && f.jt < 0) { f.jt = 0; f.j = rand(5, 14); }
        if (f.jt >= 0) { f.jt += dt * 1.6; const u = f.jt; if (u >= 1) { f.jt = -1; _pt.set(ox + Math.cos(f.a) * f.r, oy + waterY, oz + Math.sin(f.a) * f.r); i.burst('glow', 0xbfe8ff, _pt, 8, 0.4, _v.set(0, 1, 0)); i.snd().noise({ dur: 0.18, filter: { type: 'bandpass', freq: 1800, q: 1 }, vol: 0.1, at: _pt }); } else { y = waterY - f.d + Math.sin(u * PI) * 0.5; pitch = Math.cos(u * PI) * -0.9; } }
        U.q.setFromAxisAngle(U.ay, -f.a + (f.w < 0 ? PI : 0) + Math.sin(t * 8 + f.ph) * 0.15);
        U.q2.setFromAxisAngle(U.x1, pitch); U.q.multiply(U.q2);
        U.p.set(Math.cos(f.a) * f.r, y, Math.sin(f.a) * f.r);
        fish.setMatrixAt(k, U.m.compose(U.p, U.q, U.s));
      }
      fish.instanceMatrix.needsUpdate = true;
    });
  }, { size: 3, face: 'random', pop: null });
}

