// campaign/act1.js - ACT I, "The Visitor": the Omnissiah is lonely and delighted; four labours that teach the systems.
// Each chapter: { id, n, act, title, blurb, site, steps[{ text, count?, where? }], rewards, extras, run: function* (c) }. `c` is the engine context (see engine.js).
// Every c.next() / c.tick() advances the chapter's quest by one; the script must advance it exactly steps.length times (counted steps count each tick).
export default function build(K) {
  const { L, N, PERSONA, SITES: S, pick } = K;
  const at = (s) => [s.x, s.z, s.r ?? 10];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  return [
    // ------------------------------------------------------------------------------------------------ 1
    // CHAPTER 1 plays entirely in the starting meadow: the campfire at (0,-6), a wanderer, the lake to the north, a ring of standing stones, the Omnissiah overhead.
    {
      id: 'ch1', n: 1, act: 1, title: "The Wanderer's Fire", site: S.fire,
      blurb: 'A traveller keeps the meadow fire and says something crawls out of the lake at night. Feed the fire, hold it against the dark, and wake the old stones that have begun to hum.',
      steps: [{ text: 'Walk to the campfire', where: at(S.fire) }, { text: 'Speak with Pell, the wanderer' }, { text: 'Bring three bundles of kindling to the fire (0/3)', count: 3, where: at(S.fire) },
        { text: 'Hold the fire against the dark (0/2)', count: 2 }, { text: 'Go to the standing stones', where: at(S.ring) }, { text: 'Wake the stones: strike the glowing altar' }, { text: 'Return to Pell at the fire', where: at(S.fire) }],
      rewards: { xp: 220, favour: 6, title: 'Fire-Keeper' }, extras: { weapon: 'ember-staff', waypoint: 'fire' },
      run: function* (c) {
        const P = c.P();
        const L1 = L.ch1;
        yield c.say(L1.open);
        yield c.near(S.fire.x, S.fire.z, S.fire.r); c.next();
        c.base = S.fire;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.stage.music('calm');
        // the meadow already has its fire (creations/campfire.js); if not, he lights one
        const hasFire = !!c.ctx.scene.getObjectByName('module:creations/campfire.js')?.children.length;
        if (!hasFire) c.spawn('bonfire', { x: S.fire.x, z: S.fire.z, noPush: true });
        const pell = c.person('villager', { x: S.fire.x + 2.6, z: S.fire.z - 1.2, npcName: 'Pell', persona: PERSONA.pell, role: 'sage', hold: true });
        yield c.say(L1.arrive);
        yield* c.talkTo(pell, [N.pell.meet, N.pell.lake]); c.next();
        // 2. kindling: three glowing bundles lie scattered about the meadow; carry each to the fire (squeeze / fist / G to grab)
        yield c.say(L1.kindling);
        const bundles = S.kindling.map((k) => ({ r: c.relic({ x: k.x, z: k.z, id: 'kindling', color: 0xffc060, halo: 0xff6a1a }), m: c.mark(k.x, k.z, { r: 1.6, color: 0xffa040 }), done: false }));
        let got = 0;
        while (got < 3) {
          yield c.until(() => bundles.some((b) => !b.done && (!b.r || dist(b.r.pos, S.fire) < 2.4)), { label: 'carry kindling to the fire', bot: { type: 'carry-any', bundles, to: S.fire } });
          for (const b of bundles) if (!b.done && (!b.r || dist(b.r.pos, S.fire) < 2.4)) {
            b.done = true; got++; b.m.remove(); b.r?.remove(); c.tick();
            c.stage.flare(0xffb060, 0.6 + 0.2 * got); c.stage.sfx('fire-whoosh', { x: S.fire.x, y: 1, z: S.fire.z });
            if (got === 2) pell.a?.say?.(N.pell.warm, 4);
          }
        }
        // 3. the dark comes early; things crawl out of the lake
        c.stage.time(0.07, 7); c.stage.music('tension'); c.stage.mood('ominous');
        yield c.say(L1.dusk);
        yield c.npcSay(pell, N.pell.dark);
        const w1 = c.foes([{ name: 'wraith', count: 2 }, { name: 'goblin', count: 3 }], { around: S.fire, radius: 15 });
        yield c.say(L1.fight1);
        yield c.cleared(w1); c.tick();
        yield c.say(L1.fight2);
        const w2 = c.foes([{ name: 'wraith', count: 3 }, { name: 'goblin', count: 2 }, { name: 'goblin-archer', count: 2 }], { around: S.fire, radius: 15 });
        yield c.cleared(w2); c.tick();
        c.stage.music('calm'); c.stage.mood('serene'); c.stage.stinger(); c.stage.flare(0xffd877, 1);
        yield* c.talkTo(pell, [N.pell.stones]);
        // 4. the stones rise and hum; strike the altar at their heart
        yield c.say(L1.stones);
        c.stage.beam(S.ring.x, S.ring.z, { color: 0x9be8ff, duration: 3 }); c.stage.sfx('omni-create', { x: S.ring.x, y: 0, z: S.ring.z });
        c.spawn('stone-circle', { x: S.ring.x, z: S.ring.z, noPush: true, rise: true });
        const ringMark = c.mark(S.ring.x, S.ring.z, { r: 2.2, color: 0x9be8ff });
        yield c.near(S.ring.x, S.ring.z, S.ring.r); c.next();
        yield c.say(L1.altar);
        yield c.event('kit:hit', (e) => e && e.from === 'player' && e.point && dist(e.point, S.ring) < 3.6, { label: 'strike the glowing altar', bot: { type: 'event', name: 'kit:hit', payload: { from: 'player', hits: 1, radius: 1, amount: 20, point: { x: S.ring.x, y: 0.5, z: S.ring.z } } } });
        ringMark.lit = true; c.next();
        c.stage.flare(0x9be8ff, 2); c.stage.pulse(1);
        yield c.stage.glitch(1.1);
        yield c.say(L1.crack);
        // 5. back to the fire
        yield c.near(S.fire.x, S.fire.z, 4);
        yield* c.talkTo(pell, [N.pell.done]); c.next();
        yield c.say(pick(L1.done, c.P()));
        void P;
      },
    },    // ------------------------------------------------------------------------------------------------ 2
    {
      id: 'ch2', n: 2, act: 1, title: 'The Candle in the Cairn', site: S.cairn,
      blurb: 'By night, in a haunted graveyard, a candle older than the graves must be carried out through the waking dead to the Omnissiah\'s obelisk.',
      steps: [{ text: 'Walk to the Cairn', where: at(S.cairn) }, { text: 'Speak with Old Marrow, the grave-keeper' }, { text: 'Take the Candle from the crypt' }, { text: 'Survive the waking dead (0/2)', count: 2 }, { text: 'Carry the Candle to the obelisk', where: at(S.obelisk) }],
      rewards: { xp: 200, favour: 5 }, extras: { weapon: 'rune-dagger', waypoint: 'cairn' },
      run: function* (c) {
        const P = c.P();
        yield c.say(L.ch2.open);
        yield c.near(S.cairn.x, S.cairn.z, S.cairn.r); c.next();
        c.base = S.cairn;
        c.stage.time(0.05, 3); c.stage.music('night'); c.stage.mood('ominous');
        c.spawn('haunted-graveyard', { x: S.cairn.x, z: S.cairn.z, noPush: true, skeletons: 0 });
        const marrow = c.person('villager', { x: S.cairn.x + 5, z: S.cairn.z + 7, npcName: 'Old Marrow', persona: PERSONA.marrow, role: 'sage', hold: true });
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        yield c.say(L.ch2.night);
        yield c.say(L.ch2.arrive);
        yield* c.talkTo(marrow, [N.marrow.meet]); c.next();
        yield c.say(L.ch2.candle);
        const candle = c.relic({ x: S.cairn.x - 4, z: S.cairn.z - 6, id: 'candle' });
        const mark = c.mark(S.cairn.x - 4, S.cairn.z - 6, { r: 1.6 });
        yield c.until(() => !candle || candle.grabbed, { label: 'take the candle', bot: { type: 'relic', relic: candle } }); c.next();
        mark.remove();
        // the candle must not be lost: if it ends up far from the player, it comes back to their hand
        c.scope.tick(() => { if (candle && candle.grabbed && !candle.delivered && dist(candle.pos, c.here) > 45) { candle.pos.set(c.here.x, c.ground(c.here.x, c.here.z) + 1.2, c.here.z); } });
        c.stage.sfx('ghost-wail'); c.stage.pulse(0.8);
        yield c.say(L.ch2.rise);
        const w1 = c.foes([{ name: 'skeleton', count: 4 }, { name: 'skeleton-archer', count: 1 }], { around: S.cairn, radius: 13 });
        yield c.cleared(w1); c.tick();
        yield c.say(L.ch2.rise2);
        const w2 = c.foes([{ name: 'skeleton', count: 3 }, { name: 'wraith', count: 2 }], { around: S.cairn, radius: 13 });
        yield c.cleared(w2); c.tick();
        c.stage.music('sacred');
        const ob = c.spawn('omni-obelisk', { x: S.obelisk.x, z: S.obelisk.z, noPush: true });
        c.stage.beam(S.obelisk.x, S.obelisk.z, { color: 0x7fe3ff });
        yield c.say(L.ch2.carry);
        yield c.until(() => !candle || dist(candle.pos, S.obelisk) <= 5, { label: 'carry the candle to the obelisk', bot: { type: 'carry', relic: candle, to: S.obelisk } });
        if (candle) { candle.delivered = true; candle.remove(); }
        c.stage.flare(0xffd877, 1.4); c.stage.stinger(); c.stage.time(0.5, 4);
        c.next();
        void ob;
        yield c.say(pick(L.ch2.done, c.P()));
      },
    },
    // ------------------------------------------------------------------------------------------------ 3
    {
      id: 'ch3', n: 3, act: 1, title: "The Merchant's Road", site: S.road,
      blurb: 'Tolliver Pence will not walk the road alone. Bandits wait at the crossroads. Escort him to Harrow Cross; he repays you with a dog.',
      steps: [{ text: 'Find Tolliver Pence on the road', where: at(S.road) }, { text: 'Walk with Tolliver to the crossroads', where: at(S.crossroads) }, { text: 'Break the ambush' }, { text: 'Escort Tolliver to Harrow Cross', where: at(S.harrow) }, { text: 'Speak with Tolliver' }],
      rewards: { xp: 200, favour: 5, title: 'Road-Warden' }, extras: { weapon: 'star-bow', pet: true, waypoint: 'harrow' },
      run: function* (c) {
        yield c.say(L.ch3.open);
        yield c.near(S.road.x, S.road.z, S.road.r); c.next();
        c.base = S.road;
        const t = c.person('villager-militia', { x: S.road.x + 3, z: S.road.z + 2, npcName: 'Tolliver Pence', persona: PERSONA.tolliver, role: 'merchant', hp: 70 });
        c.guard(() => t.dead, 'Tolliver fell on the road.');
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        yield c.npcSay(t, N.tolliver.meet);
        // he follows the player; if the player strides off he calls out
        let worryAt = 0;
        c.scope.tick((dt, clock) => { const p = t.pos; if (p && !t.dead && dist(p, c.here) > 22 && clock > worryAt) { worryAt = clock + 12; t.a?.say?.(N.tolliver.worry, 3); } });
        yield c.until(() => dist(c.here, S.crossroads) <= S.crossroads.r + 8 && (!t.pos || dist(t.pos, S.crossroads) <= S.crossroads.r + 8), { label: 'reach the crossroads', bot: { type: 'near', x: S.crossroads.x, z: S.crossroads.z, r: S.crossroads.r } });
        c.next();
        c.base = S.crossroads;
        c.stage.music('tension');
        yield c.say(L.ch3.amb);
        const w = c.foes([{ name: 'bandit', count: 3 }, { name: 'bandit-archer', count: 2 }], { around: S.crossroads, radius: 12 });
        yield c.cleared(w); c.next();
        c.stage.music('calm'); c.stage.stinger();
        yield c.until(() => dist(c.here, S.harrow) <= S.harrow.r && t.pos && dist(t.pos, S.harrow) <= S.harrow.r + 6, { label: 'escort Tolliver to Harrow Cross', bot: { type: 'near', x: S.harrow.x, z: S.harrow.z, r: S.harrow.r } });
        c.next();
        c.base = S.harrow;
        yield c.npcSay(t, N.tolliver.arrive);
        c.next();
        yield c.say(L.ch3.done);
      },
    },
    // ------------------------------------------------------------------------------------------------ 4
    {
      id: 'ch4', n: 4, act: 1, title: 'The Feast at Brindle Green', site: S.brindle,
      blurb: 'The village thanks you with a feast: fell trees, drive off the wolves that smell dinner, light the fire. Somewhere in the toasts the sky blinks.',
      steps: [{ text: 'Fell two trees for the fire (0/2)', count: 2, where: [S.grove.x, S.grove.z, 22] }, { text: 'Drive off the wolves (0/3)', count: 3 }, { text: 'Light the feast fire at Brindle Green', where: at(S.brindle) }, { text: 'Share the feast' }],
      rewards: { xp: 220, favour: 6, title: 'Guest of Brindle Green' }, extras: { weapon: 'aegis-shield', slots: 1, waypoint: 'brindle' },
      run: function* (c) {
        const P = c.P();
        yield c.say(L.ch4.open);
        c.base = S.brindle;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        yield c.say(L.ch4.fell);
        c.spawn('grove', { x: S.grove.x, z: S.grove.z, noPush: true });
        yield c.event('kit:fell', null, { bot: { type: 'event', name: 'kit:fell', payload: {} } }); c.tick();
        yield c.event('kit:fell', null, { bot: { type: 'event', name: 'kit:fell', payload: {} } }); c.tick();
        yield c.say(L.ch4.wolves);
        c.stage.music('tension');
        const w = c.foes([{ name: 'wolf', count: 3, fixed: true }], { around: S.brindle, radius: 16 });
        yield c.count(w, 3, { onEach: () => c.tick(), filter: (f) => f.name === 'wolf' });
        yield c.cleared(w);
        c.stage.music('village'); c.stage.stinger();
        c.spawn('village', { x: S.brindle.x, z: S.brindle.z, noPush: true });
        const hob = c.person('villager', { x: S.brindle.x + 4, z: S.brindle.z + 3, npcName: 'Hob Brindle', persona: PERSONA.hob, role: 'elder', hold: true });
        const wren = c.person('villager', { x: S.brindle.x - 4, z: S.brindle.z + 3, npcName: 'Wren', persona: PERSONA.wren, role: 'child', scale: 0.62, hold: true });
        yield c.say(L.ch4.light);
        const ring = c.mark(S.brindle.x, S.brindle.z, { r: 3 });
        yield c.near(S.brindle.x, S.brindle.z, 3, { hold: 2, label: 'stand by the feast fire' });
        c.spawn('bonfire', { x: S.brindle.x, z: S.brindle.z, noPush: true });
        for (const [dx, dz] of [[-4, -3], [4, -3]]) c.spawn('table', { x: S.brindle.x + dx, z: S.brindle.z + dz, noPush: true });
        ring.lit = true;
        c.next();
        c.stage.flare(0xffb060, 0.8);
        if (pick({ default: false, cruel: true }, P) === true) {
          yield c.npcSay(hob, N.hob.cruelMeet);
        } else {
          yield c.npcSay(hob, N.hob.feast);
          yield c.npcSay(wren, N.wren.feast);
        }
        yield c.stage.glitch(1.2);
        yield c.say(L.ch4.glitch);
        c.next();
        yield c.say(pick(L.ch4.done, c.P()));
      },
    },
  ];
}



