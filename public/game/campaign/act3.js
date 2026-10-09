// campaign/act3.js - ACT III, "The Other Sun": the First Draft (a discarded earlier version of the Omnissiah) returns. A confession, a muster of the allies the player
// made (or spared), a multi-phase finale on a travelled place, and a last choice with two endings. Everything is staged with existing systems: world.env, the
// oracle's mood, the style saturation, one black disc in front of his body (engine stage.eclipse) and the First Draft's hollow voice (voices.speak).
export default function build(K) {
  const { L, N, PERSONA, SITES: S, pick } = K;
  const at = (s) => [s.x, s.z, s.r ?? 10];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  return [
    // ------------------------------------------------------------------------------------------------ 9
    {
      id: 'ch9', n: 9, act: 3, title: 'The Dimming', site: S.obelisk,
      blurb: 'The eclipse deepens. At the obelisk the Omnissiah confesses what the First Draft was. Light three braziers and hold them against the unfinished.',
      steps: [{ text: 'Stand before the obelisk', where: at(S.obelisk) }, { text: 'Light the three braziers (0/3)', count: 3, where: [S.braziers[0].x, S.braziers[0].z, 60] }, { text: 'Hold the light until the shadows break' }],
      rewards: { xp: 380, favour: 7 }, extras: { weapon: 'prism-rifle', waypoint: 'obelisk' },
      run: function* (c) {
        yield c.say(L.ch9.open);
        yield c.near(S.obelisk.x, S.obelisk.z, S.obelisk.r); c.next();
        c.base = S.obelisk;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.spawn('omni-obelisk', { x: S.obelisk.x, z: S.obelisk.z - 4, noPush: true });
        c.spawn('omni-altar', { x: S.obelisk.x + 6, z: S.obelisk.z, noPush: true });
        c.stage.music('sacred'); c.stage.mood('ominous'); c.stage.eclipse(0.7, 5);
        for (const k of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) { c.stage.pulse(0.6); yield c.say(L.ch9[k]); }
        yield c.say(L.ch9.braziers);
        c.stage.music('tension');
        const marks = S.braziers.map((b) => c.mark(b.x, b.z, { r: 2.6 }));
        let lit = 0;
        const hold = (i) => c.near(S.braziers[i].x, S.braziers[i].z, 2.6, { hold: 2, label: `light brazier ${i + 1}` });
        for (let i = 0; i < 3; i++) {
          yield hold(i);
          c.spawn('bonfire', { x: S.braziers[i].x, z: S.braziers[i].z, noPush: true, scale: 0.6 });
          marks[i].lit = true; lit++;
          c.tick();
          c.stage.flare(0xffb060, 0.9);
          c.stage.eclipse([0.55, 0.4, 0.25][i], 3);
          yield c.say([L.ch9.one, L.ch9.two, L.ch9.three][i]);
          if (i === 0) c.foes([{ name: 'wraith', count: 3 }, { name: 'imp', count: 3 }], { around: S.braziers[0], radius: 12 });
          if (i === 1) c.foes([{ name: 'wraith', count: 3 }, { name: 'skeleton', count: 3 }], { around: S.braziers[1], radius: 12 });
        }
        void lit;
        const hw = c.foes([{ name: 'wraith', count: 4 }, { name: 'imp', count: 4 }, { name: 'skeleton', count: 3 }], { around: { x: 0, z: 0 }, radius: 16 });
        yield c.cleared(hw);
        c.next();
        c.stage.stinger(); c.stage.eclipse(0.2, 4);
        yield c.say(L.ch9.done);
      },
    },
    // ------------------------------------------------------------------------------------------------ 10
    {
      id: 'ch10', n: 10, act: 3, title: 'The Muster', site: S.muster,
      blurb: 'Gather the allies the story gave you (Vesper, Gorm, Cassian, a dog) at the courtyard; if you made none, the Omnissiah lends his own. Hold the courtyard.',
      steps: [{ text: 'Go to the courtyard', where: at(S.muster) }, { text: 'Rally your allies: speak to one' }, { text: 'Hold the courtyard (0/2)', count: 2 }],
      rewards: { xp: 400, favour: 7, title: 'Marshal of the Muster' }, extras: { waypoint: 'muster' },
      run: function* (c) {
        yield c.say(L.ch10.open);
        yield c.near(S.muster.x, S.muster.z, S.muster.r); c.next();
        c.base = S.muster;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.stage.music('village'); c.stage.eclipse(0.35, 3);
        c.spawn('castle-courtyard', { x: S.muster.x, z: S.muster.z - 6, noPush: true });
        const allies = [];
        const add = (entry, o) => { const p = c.person(entry, { faction: 'friendly', ...o }); if (p.a) allies.push(p); return p; };
        const gx = S.muster.x, gz = S.muster.z + 6;
        if (c.flag('ally_quill')) add('mage', { x: gx - 3, z: gz, npcName: 'Vesper Quill', persona: PERSONA.quill, role: 'necromancer' });
        if (c.flag('ally_gorm')) add('troll', { x: gx + 3, z: gz, npcName: 'Gorm', persona: PERSONA.gorm, role: 'troll', scale: 1.1 });
        if (c.flag('ally_cassian')) add('dark-knight', { x: gx, z: gz + 3, npcName: 'Sir Cassian Vael', persona: PERSONA.cassian, role: 'knight' });
        if (c.flag('pet')) add('guard-dog', { x: gx - 1, z: gz - 2, npcName: 'Biscuit' });
        if (allies.length < 2) {
          yield c.say(L.ch10.lend);
          add('golem-guardian', { x: gx + 4, z: gz + 1 });
          add('knight', { x: gx - 4, z: gz + 1, npcName: 'Lent Knight' });
          if (allies.length < 3) add('archer', { x: gx, z: gz - 3 });
        }
        c.stage.flare(0xffd877, 1);
        const lines = { 'Vesper Quill': N.allies.quill, Gorm: N.allies.gorm, 'Sir Cassian Vael': N.allies.cassian, Biscuit: N.allies.pet };
        for (const p of allies) if (lines[p.name]) { p.a.say(lines[p.name], 5); }
        yield c.say(L.ch10.speech);
        // rally: speak to any ally (voices:reply) or simply stand among them
        const mid = { get x() { return gx; }, get z() { return gz; } };
        const talked = c.event('voices:reply', (e) => allies.some((p) => p.a === e.actor), { bot: { type: 'event', name: 'voices:reply', payload: { get actor() { return allies[0]?.a; } } } });
        yield c.any([talked, c.near(mid.x, mid.z, 3.5, { hold: 5, label: 'stand among your allies' })]);
        c.next();
        c.stage.music('tension');
        yield c.say(L.ch10.hold);
        const w1 = c.foes([{ name: 'wraith', count: 5 }, { name: 'skeleton', count: 4 }], { around: S.muster, radius: 14 });
        yield c.cleared(w1); c.tick();
        const w2 = c.foes([{ name: 'wraith', count: 4 }, { name: 'imp', count: 4 }, { name: 'zombie', count: 3 }], { around: S.muster, radius: 14 });
        yield c.cleared(w2); c.tick();
        c.stage.stinger();
        yield c.say(pick(L.ch10.done, c.P()));
      },
    },
    // ------------------------------------------------------------------------------------------------ 11
    {
      id: 'ch11', n: 11, act: 3, title: 'The Black Noon', site: { x: 0, z: 0, r: 0, name: 'the Moon' },
      blurb: 'On the Moon, where the First Draft is nearest: break the Unfinished, the Regent, and the heart of the eclipse, with every ally who followed.',
      steps: [{ text: 'Be carried to the dark place' }, { text: 'Break the Unfinished (0/2)', count: 2 }, { text: 'Defeat the Regent' }, { text: 'Break the heart of the eclipse' }, { text: 'Return home' }],
      rewards: { xp: 600, favour: 10, title: 'Eclipse-Walker' }, extras: { weapon: 'omni-blade', waypoint: 'moon' },
      run: function* (c) {
        yield c.say(L.ch11.open);
        yield c.travel('The Moon'); c.next();
        const here = c.here; c.base = here;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.stage.music('boss'); c.stage.eclipse(0.9, 3);
        yield c.say(L.ch11.arrive);
        // the allies who follow (same rules as the muster)
        const mk = (entry, o) => c.person(entry, { faction: 'friendly', x: here.x + o.dx, z: here.z + o.dz, ...o });
        if (c.flag('ally_quill')) mk('mage', { dx: -3, dz: 3, npcName: 'Vesper Quill', persona: PERSONA.quill, role: 'necromancer' });
        if (c.flag('ally_gorm')) mk('troll', { dx: 4, dz: 3, npcName: 'Gorm', persona: PERSONA.gorm, role: 'troll', scale: 1.1 });
        if (c.flag('ally_cassian')) mk('dark-knight', { dx: 0, dz: 5, npcName: 'Sir Cassian Vael', persona: PERSONA.cassian, role: 'knight' });
        if (!(c.flag('ally_quill') || c.flag('ally_gorm') || c.flag('ally_cassian'))) { mk('golem-guardian', { dx: 4, dz: 4 }); mk('knight', { dx: -4, dz: 3 }); }
        if (c.flag('pet')) mk('guard-dog', { dx: -1, dz: 2, npcName: 'Biscuit' });
        // phase 1
        yield c.say(L.ch11.p1);
        const w1 = c.foes([{ name: 'wraith', count: 5 }, { name: 'skeleton', count: 4 }, { name: 'imp', count: 4 }], { around: here, radius: 15 });
        yield c.cleared(w1); c.tick();
        yield c.voiceOf(N.draft.arrive);
        const w1b = c.foes([{ name: 'zombie', count: 4 }, { name: 'skeleton-archer', count: 3 }, { name: 'wraith', count: 3 }], { around: here, radius: 15 });
        yield c.cleared(w1b); c.tick();
        // phase 2: the Regent
        c.stage.stinger(); c.stage.eclipse(1, 3);
        yield c.say(L.ch11.p2);
        const reg = c.foes([{ name: 'lich-king', count: 1, fixed: true }], { around: { x: here.x, z: here.z - 8 }, radius: 7, announce: true });
        yield c.cleared(reg);
        c.next();
        // the twist: the pilgrim is the First Draft's one wish
        yield c.voiceOf(N.draft.twist1);
        yield c.voiceOf(N.draft.twist2);
        yield c.say(L.ch11.twist);
        // phase 3: the heart. A dark crystal hangs in the sky; spells and blades break it. Every third of its life the light returns a little and the dark sends more.
        yield c.say(L.ch11.p3);
        const core = makeCore(c, here);
        let stage3 = 0;
        const adds = [];
        c.scope.tick(() => {
          const f = core.hp / core.maxHp;
          if (stage3 === 0 && f <= 0.66) { stage3 = 1; adds.push(c.foes([{ name: 'wraith', count: 4 }, { name: 'imp', count: 3 }], { around: here, radius: 14, announce: false })); c.stage.eclipse(0.7, 2); c.sayNow(L.ch11.lighter); }
          if (stage3 === 1 && f <= 0.33) { stage3 = 2; adds.push(c.foes([{ name: 'skeleton', count: 4 }, { name: 'wraith', count: 4 }], { around: here, radius: 14, announce: false })); c.stage.eclipse(0.4, 2); c.sayNow(L.ch11.lighter); }
        });
        yield c.until(() => core.dead, { label: 'break the heart of the eclipse', bot: { type: 'core', core } });
        c.next();
        c.stage.flare(0xffffff, 1.6); c.stage.eclipse(0.1, 2);
        yield c.voiceOf(N.draft.heart);
        yield c.voiceOf(N.draft.alone);
        yield c.say(L.ch11.end);
        yield c.home(); c.next();
      },
    },
    // ------------------------------------------------------------------------------------------------ 12
    {
      id: 'ch12', n: 12, act: 3, title: 'The Last Wish', site: S.altars,
      blurb: 'Back on the field the First Draft hangs low and small. Two altars: offer him a wish, or strike. Two endings; the first needs a kind enough hand.',
      steps: [{ text: 'Walk to the altars', where: at(S.altars) }, { text: 'Choose: offer him a wish, or strike' }, { text: 'Witness the end' }],
      rewards: { xp: 500, favour: 8 }, extras: { waypoint: 'altars', ending: true },
      run: function* (c) {
        const P = c.P();
        yield c.say(L.ch12.open);
        yield c.near(S.altars.x, S.altars.z, S.altars.r); c.next();
        c.base = S.altars;
        yield c.say(L.ch12.why);
        c.stage.music('sacred'); c.stage.eclipse(0.55, 4);
        const offerM = c.mark(S.altars.offer.x, S.altars.offer.z, { r: 3, color: 0x9be8ff });
        const strikeM = c.mark(S.altars.strike.x, S.altars.strike.z, { r: 3, color: 0xff7a5a });
        c.spawn('omni-altar', { x: S.altars.offer.x, z: S.altars.offer.z - 3, noPush: true });
        c.spawn('omni-altar', { x: S.altars.strike.x, z: S.altars.strike.z - 3, noPush: true });
        yield c.voiceOf(N.draft.ask);
        yield c.say(L.ch12.altarsHint);
        let pick1 = yield c.choice([{ id: 'offer', x: S.altars.offer.x, z: S.altars.offer.z, r: 3 }, { id: 'strike', x: S.altars.strike.x, z: S.altars.strike.z, r: 3 }], { hold: 1.6 });
        offerM.remove(); strikeM.remove();
        let refused = false;
        if (pick1 === 'offer' && (P.cruel | 0) >= 5) { refused = true; yield c.voiceOf(N.draft.refuse); yield c.say(L.ch12.refuse); pick1 = 'strike'; }
        c.next();
        let ending;
        if (pick1 === 'offer') {
          ending = 1;
          c.stage.eclipse(0.3, 3);
          yield c.say(L.ch12.wish);
          yield c.event('net:transcript', null, { timeout: 30, bot: { type: 'event', name: 'net:transcript', payload: { text: 'make him warm' } } });
          yield c.voiceOf(N.draft.wishA);
          yield c.say(L.ch12.granted);
          c.stage.flare(0xffd877, 1.6); c.stage.eclipse(0, 5); c.stage.time(0.3, 5); c.stage.sky({ aurora: 1, stars: 1 }, 5);
          c.spawn('fireflies', {}); c.spawn('rainbow', {});
          c.stage.mood('joyful'); c.stage.stinger();
          c.next();
          yield c.say(L.ch12.endA);
        } else {
          ending = 2;
          c.stage.eclipse(0.9, 2);
          yield c.voiceOf(N.draft.fade);
          const core = makeCore(c, { x: S.altars.x, z: S.altars.z - 10 }, { hp: 140, y: 7 });
          yield c.until(() => core.dead, { label: 'strike the Draft', bot: { type: 'core', core } });
          c.stage.flare(0xffffff, 2); c.stage.eclipse(0, 6); c.stage.time(0.12, 6); c.stage.sky({ stars: 1, aurora: 1 }, 6);
          c.spawn('meteor-shower', { rate: 2 });
          c.stage.mood('serene'); c.stage.stinger();
          c.next();
          yield c.say(L.ch12.endB);
        }
        c.flag('ending', ending);
        c.flag('endingRefused', refused ? 1 : 0);
        c.ending = ending;
        yield c.delay(4);
        yield c.say(L.ch12.last);
      },
    },
  ];

  // the heart of the eclipse / the Draft's last form: a floating dark crystal with a damageable body. Returns { hp, maxHp, dead, object }.
  function makeCore(c, base, o = {}) {
    const ctx = c.ctx, THREE = ctx.THREE;
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), new THREE.MeshBasicMaterial({ color: 0x1a0030 }));
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshBasicMaterial({ color: 0xa040ff, transparent: true, opacity: 0.35, depthWrite: false, wireframe: true, fog: false }));
    g.add(core, glow);
    for (const m of [g, core, glow]) m.userData.noShadow = m.userData.noOutline = true;
    const y = (o.y ?? 5) + ctx.groundAt(base.x, base.z - 14);
    g.position.set(base.x, y, base.z - 14);
    c.scope.add(g);
    const maxHp = Math.round((o.hp ?? 260) * (1 + 0.4 * (c.ng || 0)));
    const st = { hp: maxHp, maxHp, dead: false, object: g, damageable: null };
    try {
      st.damageable = ctx.world.kit?.damageable?.(ctx, g, {
        hp: maxHp, radius: 2.2, offsetY: 0, faction: 'enemy',
        onHit: (e) => { st.hp = Math.max(0, e.hp ?? st.hp - (e.amount ?? 0)); glow.material.opacity = 0.9; },
        onDeath: () => { st.hp = 0; st.dead = true; },
      });
    } catch (e) { /* kit reloading */ }
    if (!st.damageable) st.manual = true;                                // no kit: the debug API can still break it
    c.scope.undo(() => { try { st.damageable?.remove?.(); } catch { /* gone */ } });
    c.scope.tick((dt, t) => {
      g.position.y = y + Math.sin(t * 0.9) * 0.5; g.rotation.y += dt * 0.6; g.rotation.x += dt * 0.3;
      glow.material.opacity += (0.35 - glow.material.opacity) * Math.min(1, dt * 3);
      if (st.damageable) { const d = st.damageable; if (typeof d.hp === 'number') st.hp = d.hp; if (d.alive === false) st.dead = true; }
    });
    st.break = () => { st.hp = 0; st.dead = true; };
    return st;
  }
}


