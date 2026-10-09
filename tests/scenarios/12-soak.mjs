// 12. Soak: 3 minutes (game time) of mixed play in a loop: walk, turn, fight waves with spells, summon/remove props and weapons,
//     open/close menu panels, a trip to a cached place and home. Samples JS heap, registries, perf and console every 10 game-seconds.
export default {
  id: 12, name: 'soak', tiers: ['pc', 'quest'], timeout: 2400000,
  async run(t) {
    const mark0 = t.mark();
    await t.load();
    const SECONDS = Number(process.env.QA_SOAK_SECONDS || 180);
    await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, ctx = window.__qaCtx;
      qh.faceForward(); qa.lock(true);
      const S = window.__soak = { live: [], samples: [], cycle: 0, kills: 0, casts: 0, errors: 0, deaths: 0, respawns: 0, travelDone: false, notes: [] };
      g.events.on('combat:kill', () => S.kills++); g.events.on('spell:cast', () => S.casts++);
      g.events.on('player:died', () => S.deaths++); g.events.on('player:respawn', () => S.respawns++);
      S.base = qh.snap(); S.baseHeap = (window.gc && window.gc(), qh.heap());
      const sample = (label) => {
        if (window.gc) window.gc();
        const m = [...g.modules].map(([p, r]) => [p, r.ms || 0]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, ms]) => p.replace('core/', '') + ':' + ms.toFixed(2));
        const ps = w.perf && w.perf.stats ? w.perf.stats() : {};
        S.samples.push({ gameT: Math.round(qa.gameTime), heap: qh.heap(), snap: qh.snap(), perf: { level: ps.level, calls: ps.calls, tris: ps.tris, fighters: w.combat.stats().fighters }, top: m, kills: S.kills, listeners: Object.values(qa.listeners).reduce((a, b) => a + b, 0), physics: w.physics ? w.physics.stats().bodies : -1 });
      };
      S.sample = sample; sample('start');
      const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
      S.rnd = rnd;
      S.cullLive = () => { S.live = S.live.filter((h) => { if (h.removed || h.alive === false && h.fighters && h.fighters.every((f) => !f.alive)) { try { h.remove(); } catch {} return false; } return true; }); };
      S.actions = {
        async walk() { qh.key('keydown', 'KeyW'); await qa.wait(1.5 + rnd() * 1.5); qh.key('keyup', 'KeyW'); qh.key('keydown', 'ArrowRight'); await qa.wait(0.2); qh.key('keyup', 'ArrowRight'); },
        async jump() { qh.key('keydown', 'Space'); await qa.waitFrames(2); qh.key('keyup', 'Space'); await qa.wait(1.2); },
        async fight() {
          const n = 2 + Math.floor(rnd() * 3);
          const h = w.library.wave ? w.library.wave(ctx, [{ name: rnd() < 0.5 ? 'goblin' : 'skeleton', count: n }], { radius: 11 }) : w.library.spawn(ctx, 'goblin', { count: n, spread: 4 });
          if (h) S.live.push(h);
          const k = w.library.spawn(ctx, 'knight', { position: { x: -2, z: -4 } }); if (k) S.live.push(k);
          const sp = ['firebolt', 'frost-lance', 'chain-lightning', 'force-push'][Math.floor(rnd() * 4)]; w.spells.select(sp);
          for (let i = 0; i < 14; i++) {
            const e = w.combat.nearest(g.player.head, { hostileTo: 'friendly', maxDist: 40 }) || w.combat.nearest(g.player.head, { faction: 'enemy', maxDist: 40 });
            if (!e) { await qa.wait(0.6); continue; }
            const p = e.actor.group.position; qh.aimAt(p.x, p.y + 1, p.z); await qh.hold(0, 0.2); await qa.wait(0.5);
          }
          qh.faceForward(); w.player.heal(1000);
        },
        async props() { for (const n of ['crate-stack', 'barrel', 'haystack']) { const h = w.library.spawn(ctx, n, { position: { x: (rnd() - 0.5) * 8, z: -6 - rnd() * 4 } }); if (h) S.live.push(h); } await qa.wait(2.5); qh.aimAt(0, 0.6, -7); w.spells.select('force-push'); await qh.hold(0, 0.2); await qa.wait(1.5); },
        async weapon() {
          const hp = g.input.right.position; const wp = w.weapons.create(ctx, ['sword', 'axe', 'dagger', 'spear'][Math.floor(rnd() * 4)], { position: { x: hp.x, y: hp.y, z: hp.z } });
          if (wp) { qh.mouseDown(2); await qa.wait(0.5); for (let i = 0; i < 4; i++) { window.dispatchEvent(new MouseEvent('mousemove', { movementX: 120, movementY: 0, bubbles: true })); await qa.waitFrames(1); } qh.mouseUp(2); await qa.wait(1.2); S.live.push(wp); }
        },
        async menu() { for (const id of ['summon', 'spells', 'quests', 'world', 'settings']) { w.menu.open(id); await qa.wait(0.5); } w.menu.close(); await qa.wait(0.3); },
        async nature() { const nat = w.library.list().filter((e) => e.category === 'nature').map((e) => e.name); const h = w.library.spawn(ctx, nat[Math.floor(rnd() * nat.length)], { position: { x: (rnd() - 0.5) * 12, z: -9 } }); if (h) S.live.push(h); await qa.wait(2); },
      };
      S.order = ['fight', 'walk', 'props', 'weapon', 'jump', 'menu', 'nature', 'fight', 'walk', 'weapon'];
    `);
    const t0 = Date.now();
    let lastSample = 0, i = 0;
    while (true) {
      const st = await t.run(`
        const S = window.__soak, qa = window.__qa, g = window.game, w = g.world;
        const act = S.order[S.cycle++ % S.order.length];
        try { await S.actions[act](); } catch (e) { S.errors++; S.notes.push(act + ': ' + (e && e.stack || e).toString().slice(0, 300)); }
        // keep the live list from growing without bound: remove handles older than 6 entries
        while (S.live.length > 6) { const h = S.live.shift(); try { h.remove(); } catch {} }
        w.player.heal(1000);
        if (qa.gameTime - (S.lastSampleT || 0) >= 10) { S.lastSampleT = qa.gameTime; S.sample(act); }
        return { act, gameT: qa.gameTime, errors: S.errors };`, { timeout: 180000 });
      i++;
      if (st.gameT >= SECONDS) break;
      if (st.gameT - lastSample >= 30) { lastSample = st.gameT; t.log(`soak ${Math.round(st.gameT)}s game time, ${Math.round((Date.now() - t0) / 1000)}s real`); }
      if (!t.data.travelDone && st.gameT > SECONDS * 0.5) {
        t.data.travelDone = true;
        const tr = await t.run(`
          const w = window.game.world, qa = window.__qa;
          const h = w.travel.go('tropical beach'); for (let k = 0; k < 160 && !(h.state === 'arrived' || h.state === 'failed'); k++) { await qa.wait(0.5); await new Promise((r) => setTimeout(r, 30)); }
          const s1 = h.state; await qa.wait(4);
          const hh = w.travel.home(); for (let k = 0; k < 160 && !(hh.state === 'arrived' || hh.state === 'failed'); k++) { await qa.wait(0.5); await new Promise((r) => setTimeout(r, 30)); }
          await qa.wait(3); return { go: s1, home: hh.state };`, { timeout: 300000 });
        t.data.soakTravel = tr;
        t.check('soak: round trip to a cached place works mid-session', tr.go === 'arrived' && tr.home === 'arrived', JSON.stringify(tr), 'P1');
      }
      if (i === 8) await t.shot('soak-midgame');
    }
    // wind down: remove everything, let corpses fade, final sample
    await t.run(`
      const S = window.__soak, w = window.game.world, qa = window.__qa;
      for (const h of S.live.splice(0)) { try { h.remove(); } catch {} }
      w.combat.clear(); w.weapons.list().slice().forEach((x) => { try { x.remove(); } catch {} });
      w.menu.clearSummoned && w.menu.clearSummoned();
      await qa.wait(20); S.sample('end');`);
    await t.shot('soak-end');
    const data = await t.run(`const S = window.__soak; return { samples: S.samples, kills: S.kills, casts: S.casts, errors: S.errors, notes: S.notes, deaths: S.deaths, respawns: S.respawns, base: S.base, baseHeap: S.baseHeap, cycles: S.cycle };`);
    t.data.soak = data;
    const first = data.samples[1] ?? data.samples[0], last = data.samples[data.samples.length - 1];
    t.note(`soak: ${data.cycles} actions, ${data.kills} kills, ${data.casts} casts, ${data.deaths} deaths/${data.respawns} respawns; heap ${data.baseHeap} -> ${last.heap} MB; physics bodies ${first.physics} -> ${last.physics}`);
    t.check('soak: no page-side action threw', data.errors === 0, data.notes.join('\n'), 'P1');
    t.check('soak: fights produced kills and spells were cast', data.kills > 0 && data.casts > 0, `kills ${data.kills}, casts ${data.casts}`, 'P1');
    // heap trend: end (after cleanup + gc) must not exceed the early sample by more than 40 MB / 60 %
    const growth = last.heap - first.heap;
    t.check('soak: JS heap after cleanup is not growing (<= +40 MB over the 3 minutes)', growth <= 40, `heap ${first.heap} -> ${last.heap} MB (+${growth.toFixed(1)}); series ${data.samples.map((s) => s.heap).join(',')}`, 'P1');
    const leakKeys = ['kit_actors', 'kit_damageables', 'kit_bodies', 'kit_destructibles', 'kit_obstacles', 'combat_fighters', 'combat_reserves', 'phys_bodies', 'phys_colliders', 'phys_joints', 'phys_ragdolls', 'phys_characters', 'models_instancesLive', 'weapons'];
    const drift = {};
    for (const k of leakKeys) { const d = last.snap[k] - data.base[k]; if (d > 0) drift[k] = d; else if (d < 0) t.note('registry ' + k + ' ended ' + d + ' below baseline (ambient actors/props destroyed by the fights?)'); }
    t.check('soak: registries are back at baseline after cleanup', Object.keys(drift).length === 0, JSON.stringify(drift), 'P1');
    const objGrowth = last.snap.scene_objects - data.base.scene_objects;
    t.check('soak: scene object count after cleanup within +40 of the start', objGrowth <= 40, `scene_objects ${data.base.scene_objects} -> ${last.snap.scene_objects}; particle systems ${data.base.kit_particleSystems} -> ${last.snap.kit_particleSystems}; lights ${data.base.scene_lights}->${last.snap.scene_lights}`, 'P2');
    t.check('soak: event listener count stable', Math.abs(last.listeners - first.listeners) <= 2, `listeners ${first.listeners} -> ${last.listeners}`, 'P1');
    const errs = t.errorsSince(mark0).filter((e) => !/Microphone|favicon|index\.json/.test(e.text));
    t.check('soak: zero console errors over the session', errs.length === 0, errs.slice(0, 8).map((e) => e.text.slice(0, 220)).join('\n'), 'P1');
    const dis = errs.filter((e) => /\[module .*\] (update|load):/.test(e.text));
    t.check('soak: no module disabled', dis.length === 0, dis.map((e) => e.text.slice(0, 220)).join('\n'), 'P0');
    const bad = await t.compileAndCheck();
    t.check('soak: no broken shader programs', bad.length === 0, JSON.stringify(bad).slice(0, 500), 'P0');
    t.data.finalPerf = await t.perfStats();
  },
};


