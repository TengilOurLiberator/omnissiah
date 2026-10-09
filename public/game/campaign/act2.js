// campaign/act2.js - ACT II, "The Cracks": things he made before the visitor came have gone wrong and resent him; the world glitches; villagers hint.
// Choices about mercy are recorded in the profile (campaign.mercy / campaign.ruth) and each spared creature joins the finale (flags ally_quill / ally_gorm / ally_cassian).
export default function build(K) {
  const { L, N, PERSONA, SITES: S, pick } = K;
  const at = (s) => [s.x, s.z, s.r ?? 10];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const frac = (p) => (p.f && p.f.maxHp ? p.f.hp / p.f.maxHp : 1);
  // an enemy who has been beaten to his knees: stops fighting and stands still (the caller decides his fate)
  const yieldTo = (c, p, sayLine) => {
    try { p.f?.setTarget?.(null); p.f?.setFaction?.('neutral'); if (p.f) p.f.follow = null; p.a?.stop?.(); p.a?.wander?.(0); } catch { /* ignore */ }
    if (sayLine) p.a?.say?.(sayLine, 6);
  };

  return [
    // ------------------------------------------------------------------------------------------------ 5
    {
      id: 'ch5', n: 5, act: 2, title: 'The Quiet Mire', site: { x: 0, z: 0, r: 0, name: 'the Misty Swamp' },
      blurb: 'Vesper Quill, the necromancer who was granted never to die, waits in a travelled swamp. Beat him down; then hear him out, or end him.',
      steps: [{ text: 'Be carried to the Misty Swamp' }, { text: 'Fight Vesper Quill until he yields' }, { text: 'Decide his fate: speak to him, or end him' }, { text: 'Return home' }],
      rewards: { xp: 260, favour: 5 }, extras: { weapon: 'void-scythe', waypoint: 'mire' },
      run: function* (c) {
        yield c.say(L.ch5.open);
        yield c.say(L.ch5.go);
        yield c.travel('Misty Swamp'); c.next();
        const here = c.here; c.base = here;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.stage.music('dungeon');
        const q = c.person('necromancer', { x: here.x + 2, z: here.z - 22, npcName: 'Vesper Quill', persona: PERSONA.quill, role: 'necromancer', faction: 'enemy' });
        yield c.npcSay(q, N.quill.meet);
        yield c.say(L.ch5.fight);
        yield c.until(() => q.dead || frac(q) <= 0.35, { label: 'beat Vesper down', bot: { type: 'hurt', person: q, to: 0.3 } });
        let verdict = 'kill';
        if (!q.dead) {
          yieldTo(c, q, N.quill.yield);
          // his thralls crumble with him; only those near him, never the rest of the field
          for (const f of [...(c.ctx.world.combat?.fighters ?? [])]) {
            if (f !== q.f && f.faction === 'enemy' && f.actor && q.pos && dist(f.actor.group.position, q.pos) < 45) { try { f.remove(); } catch { /* gone */ } }
          }
          c.stage.flare(0x8a5cff, 0.8); c.next();
          yield c.say(L.ch5.yield);
          verdict = yield c.mercy(q, { hold: 4 });
        } else c.next();
        if (verdict === 'spare') {
          c.bump('campaign.mercy'); c.flag('ally_quill', 1);
          yield c.npcSay(q, N.quill.spare);
          c.ctx.world.quests?.addFavour?.(3, 'mercy');
          yield c.say(L.ch5.spare);
        } else {
          c.bump('campaign.ruth');
          yield c.say(L.ch5.kill);
        }
        c.next();
        yield c.home(); c.next();
        yield c.say(pick(L.ch5.done, c.P()));
      },
    },
    // ------------------------------------------------------------------------------------------------ 6
    {
      id: 'ch6', n: 6, act: 2, title: 'The Toll Bridge', site: S.bridge,
      blurb: 'Gorm the troll holds the old bridge and has never been asked a question. Talk to him, or fight him; either way the far bank is yours.',
      steps: [{ text: 'Walk to the Toll Bridge', where: at(S.bridge) }, { text: 'Deal with Gorm: speak to him, or strike him' }, { text: 'Cross to the far bank', where: [S.bridge.x + 14, S.bridge.z, 4] }],
      rewards: { xp: 240, favour: 5 }, extras: { weapon: 'storm-hammer', waypoint: 'bridge' },
      run: function* (c) {
        yield c.say(L.ch6.open);
        yield c.near(S.bridge.x, S.bridge.z, S.bridge.r); c.next();
        c.base = S.bridge;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.stage.music('tension');
        c.spawn('bridge', { x: S.bridge.x, z: S.bridge.z, noPush: true, yaw: Math.PI / 2 });
        const g = c.person('troll', { x: S.bridge.x - 2, z: S.bridge.z, npcName: 'Gorm', persona: PERSONA.gorm, role: 'troll', faction: 'neutral', scale: 1.1 });
        try { if (g.f) { g.f.follow = null; g.a?.wander?.(0); } } catch { /* ignore */ }
        yield c.npcSay(g, N.gorm.meet);
        yield c.npcSay(g, N.gorm.hold);
        // verdict: he is struck (hp drops) -> fight; spoken to / stood beside -> friend
        const hurt = () => g.dead || (g.f && g.f.hp < g.f.maxHp - 0.5);
        const w = c.mercy(g, { hold: 4 });
        yield c.any([w, c.until(hurt, { label: 'strike Gorm', bot: { type: 'hurt', person: g, to: 0.6 } })]);
        let verdict = w.done && w.result !== 'kill' && !hurt() ? 'spare' : 'fight';
        if (verdict === 'spare') {
          c.bump('campaign.mercy'); c.flag('ally_gorm', 1);
          yield c.npcSay(g, N.gorm.talk);
          try { g.f?.setFaction?.('friendly'); } catch { /* ignore */ }
          yield c.npcSay(g, N.gorm.follow);
          yield c.say(L.ch6.spare);
        } else {
          yield c.say(L.ch6.fight);
          try { g.f?.setFaction?.('enemy'); g.f?.setTarget?.('player'); } catch { /* ignore */ }
          yield c.until(() => g.dead, { label: 'Gorm falls', bot: { type: 'kill', get fighters() { return g.f && g.f.alive ? [g.f] : []; } } });
          c.bump('campaign.ruth');
          yield c.say(L.ch6.kill);
        }
        c.next();
        yield c.near(S.bridge.x + 14, S.bridge.z, 4); c.next();
        yield c.say(pick(L.ch6.done, c.P()));
      },
    },
    // ------------------------------------------------------------------------------------------------ 7
    {
      id: 'ch7', n: 7, act: 2, title: 'The Hollow Knight', site: S.arena,
      blurb: 'Sir Cassian Vael, the first champion, waits in the old arena to be forgotten properly. Duel him; he yields before he falls, and you choose.',
      steps: [{ text: 'Walk to the old arena', where: at(S.arena) }, { text: 'Duel Sir Cassian until he yields' }, { text: 'Decide his fate: speak to him, or end him' }],
      rewards: { xp: 300, favour: 6, title: 'Cassian\'s Equal' }, extras: { weapon: 'sun-spear', waypoint: 'arena' },
      run: function* (c) {
        yield c.say(L.ch7.open);
        yield c.near(S.arena.x, S.arena.z, S.arena.r); c.next();
        c.base = S.arena;
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        c.stage.music('boss');
        c.spawn('arena', { x: S.arena.x, z: S.arena.z, noPush: true, radius: 14 });
        const k = c.person('dark-knight', { x: S.arena.x, z: S.arena.z - 7, npcName: 'Sir Cassian Vael', persona: PERSONA.cassian, role: 'knight', faction: 'enemy' });
        yield c.npcSay(k, N.cassian.meet);
        let half = false;
        c.scope.tick(() => { if (!half && frac(k) <= 0.65) { half = true; k.a?.say?.(N.cassian.half, 6); } });
        yield c.until(() => k.dead || frac(k) <= 0.3, { label: 'beat Cassian down', bot: { type: 'hurt', person: k, to: 0.25 } });
        let verdict = 'kill';
        if (!k.dead) {
          yieldTo(c, k, N.cassian.yield);
          c.stage.flare(0x9ab8ff, 0.8); c.next();
          yield c.say(L.ch7.half);
          verdict = yield c.mercy(k, { hold: 4 });
        } else c.next();
        if (verdict === 'spare') {
          c.bump('campaign.mercy'); c.flag('ally_cassian', 1);
          yield c.npcSay(k, N.cassian.spare);
          c.ctx.world.quests?.addFavour?.(3, 'mercy');
          yield c.say(L.ch7.spare);
        } else {
          c.bump('campaign.ruth');
          yield c.say(L.ch7.kill);
        }
        c.next();
        yield c.say(L.ch7.done);
      },
    },
    // ------------------------------------------------------------------------------------------------ 8
    {
      id: 'ch8', n: 8, act: 2, title: 'The Seam', site: S.seam,
      blurb: 'Three villagers hint that the Omnissiah is not what he seems; at the far standing stones the world tears at the seam, and something dark slides across his face.',
      steps: [{ text: 'Hear what three villagers noticed (0/3)', count: 3, where: [S.hints[0].x, S.hints[0].z, 40] }, { text: 'Go to the Seam, the far standing stones', where: at(S.seam) }, { text: 'Hold the Seam against the Unfinished (0/2)', count: 2 }, { text: 'Look up' }],
      rewards: { xp: 360, favour: 6, title: 'Seam-Walker' }, extras: { weapon: 'arc-blaster', slots: 1, waypoint: 'seam' },
      run: function* (c) {
        const P = c.P();
        yield c.say(L.ch8.open);
        c.guard(() => c.deaths() >= 3, 'You fell too many times.');
        const wren = c.person('villager', { x: S.hints[0].x, z: S.hints[0].z, npcName: 'Wren', persona: PERSONA.wren, role: 'child', scale: 0.62, hold: true });
        const hob = c.person('villager', { x: S.hints[1].x, z: S.hints[1].z, npcName: 'Hob Brindle', persona: PERSONA.hob, role: 'elder', hold: true });
        const marrow = c.person('villager', { x: S.hints[2].x, z: S.hints[2].z, npcName: 'Old Marrow', persona: PERSONA.marrow, role: 'sage', hold: true });
        for (const [p, line] of [[wren, N.wren.hint], [hob, N.hob.hint], [marrow, N.marrow.hint]]) {
          void pick;
          yield* c.talkTo(p, [line], { r: 4.2 }); c.tick();
        }
        yield c.say(L.ch8.after);
        yield c.say(L.ch8.seam);
        yield c.near(S.seam.x, S.seam.z, S.seam.r); c.next();
        c.base = S.seam;
        c.stage.music('tension'); c.stage.mood('ominous');
        yield c.stage.glitch(1.3);
        yield c.say(L.ch8.hold);
        const w1 = c.foes([{ name: 'wraith', count: 3 }, { name: 'imp', count: 3 }], { around: S.seam, radius: 14 });
        yield c.cleared(w1); c.tick();
        yield c.stage.glitch(1.0);
        const w2 = c.foes([{ name: 'wraith', count: 4 }, { name: 'skeleton', count: 3 }], { around: S.seam, radius: 14 });
        yield c.cleared(w2); c.tick();
        yield c.say(L.ch8.look);
        c.stage.eclipse(0.85, 5);
        yield c.until(() => true);
        yield c.look(() => c.ctx.world.oracle?.position, { hold: 2.2, deg: 35, label: 'look up at the eclipse' });
        yield c.voiceOf(N.draft.hello);
        yield c.voiceOf(N.draft.loud);
        yield c.voiceOf(N.draft.seen);
        c.next();
        c.stage.eclipse(0, 4);
        yield c.say(L.ch8.done);
        void P; void dist;
      },
    },
  ];
}
