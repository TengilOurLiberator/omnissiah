// 11. Hot reload: rewrite each core module file with identical content (sandbox copy) while a scene is live; the server watcher
//     broadcasts a reload and the client reloads that module. Assert: it reloads, no errors, services come back, registries and
//     event-listener counts are stable (no duplicates), and the game still works afterwards (spawn/remove, spell, weapon, physics).
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX, healModules } from '../lib/sandbox.mjs';

export default {
  id: 11, name: 'hotreload', tiers: ['pc', 'quest'], timeout: 1800000,
  async run(t) {
    // A new player, so the awakening starts; it is skipped the supported way and given time to settle BEFORE anything is measured
    // (while it plays it adds/removes listeners, spawns things and holds the quests, which would drift every count).
    await t.load({ intro: 'new' });
    const started = await t.run('return await window.__qh.waitIntroStart(40);');
    const sk = await t.run('return await window.__qh.skipIntro();');
    t.data.introSkip = { started, ...sk, ...(await t.run(`const w = window.game.world; let ls = null; try { ls = localStorage.getItem('omnissiah.intro.v1'); } catch {} return { flag: w.quests.stat('campaign.intro'), ls, gameTime: Math.round(window.__qa.gameTime), saveData: window.__qa.saveData, introWatch: window.__qa.introWatch };`)) };
    t.check('hot reload prelude: the awakening starts and world.intro.skip() ends it at once', started === true && sk.wasRunning && sk.skipReturned === true && !sk.running && sk.done, JSON.stringify(t.data.introSkip), 'P1');
    await t.run('await window.__qa.wait(40);');   // the first labour starts (>= 25 s) and its banner/tracker settle
    const manifest = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'public/game/manifest.json'), 'utf8')).core;
    const core = manifest.filter((p) => fs.existsSync(path.join(SANDBOX, 'public/game', p)));
    // live scene
    await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh;
      qh.freezePlayer(true); qh.faceForward();
      window.__qaScene = [];
      const add = (n, o) => { try { const h = w.library.spawn(ctx, n, o); if (h) window.__qaScene.push(h); } catch (e) { console.error('scene spawn', n, e); } };
      add('goblin', { position: { x: 4, z: -8 }, faction: 'neutral' }); add('knight', { position: { x: -3, z: -6 } }); add('cottage', { position: { x: 0, z: -22 } });
      add('crate-stack', { position: { x: 3, z: -5 } }); add('sword', { position: { x: -1, z: -3 } }); add('barrel', { position: { x: 0, z: -7 } });
      await qa.wait(3);`);
    await t.shot('scene-before');
    const baseline = await t.run(`
      const qa = window.__qa, qh = window.__qh;
      return { snap: qh.snap(), services: Object.keys(window.game.world).sort(), listeners: { ...qa.listeners }, modules: [...window.game.modules.keys()].sort(), ms: Object.fromEntries([...window.game.modules].map(([p, r]) => [p, r.ms])) };`);
    t.data.baseline = baseline;
    const results = [];
    for (const rel of core) {
      const file = path.join(SANDBOX, 'public/game', rel);
      const mk = t.mark();
      const t0 = Date.now();
      const before = await t.run(`const qa = window.__qa; return { loadedN: qa.loaded.length, listeners: { ...qa.listeners }, version: window.game.modules.get(${JSON.stringify(rel)}) && window.game.modules.get(${JSON.stringify(rel)}).version, snap: window.__qh.snap() };`);
      const stat0 = fs.statSync(file);
      fs.writeFileSync(file, fs.readFileSync(file)); // identical content, new mtime
      let reloaded = false, why = '';
      try {
        await t.waitFor(`window.__qa.loaded.slice(${before.loadedN}).some((e) => e.path === ${JSON.stringify(rel)})`, { timeout: 40000, interval: 250, label: 'reload of ' + rel });
        reloaded = true;
      } catch (e) { why = e.message; }
      // Under heavy CPU load the server's "node --check" (15 s timeout, server/files.js) can time out, and the server then drops the module from the list instead of reloading it.
      // Heal it (rewrite again) once and wait again; the retry is reported as its own P2 check, not as a hot-reload failure.
      let retried = false;
      if (!reloaded) {
        retried = true; const h = await healModules();
        try { await t.waitFor(`window.__qa.loaded.slice(${before.loadedN}).some((e) => e.path === ${JSON.stringify(rel)})`, { timeout: 60000, interval: 250, label: 'reload of ' + rel + ' after healing' }); reloaded = true; why = ''; } catch (e) { why = e.message + ' | dropped by the server: ' + JSON.stringify(h); }
      }
      // let async init finish (e.g. physics/WASM, models) then step the game
      await t.waitFor(`(() => { const r = window.game.modules.get(${JSON.stringify(rel)}); return !!(r && (r.instance || r.failed)); })()`, { timeout: 30000 }).catch(() => {});
      await t.run('await window.__qa.wait(2.5);');
      const after = await t.run(`
        const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh, rel = ${JSON.stringify(rel)};
        const rec = g.modules.get(rel);
        const r = { failed: !!(rec && rec.failed), hasInstance: !!(rec && rec.instance), newVersion: rec && rec.version, services: Object.keys(w).sort(), listeners: { ...qa.listeners }, snap: qh.snap(), broken: qh.broken() };
        // functional probes
        const probe = {};
        try { const h = w.library.spawn(ctx, 'chicken', { position: { x: 2, z: -4 } }); probe.spawn = !!h; await qa.wait(0.8); h && h.remove(); } catch (e) { probe.spawn = 'ERR ' + e.message; }
        try { probe.spells = w.spells.list().length; probe.cast = (() => { let n = 0; const off = g.events.on('spell:cast', () => n++); w.spells.select('firebolt'); qh.aimAt(0, 40, -6); return () => { off(); return n; }; })(); } catch (e) { probe.spells = 'ERR ' + e.message; }
        try { qa.lock(true); qh.mouseDown(0); await qa.waitFrames(3); qh.mouseUp(0); await qa.waitFrames(2); probe.cast = typeof probe.cast === 'function' ? probe.cast() : probe.cast; } catch (e) { probe.cast = 'ERR ' + e.message; }
        try { const wp = w.weapons.create(ctx, 'dagger', { position: { x: 1, y: 1, z: -3 } }); probe.weapon = !!wp; wp && wp.remove(); } catch (e) { probe.weapon = 'ERR ' + e.message; }
        try { probe.phys = w.physics ? w.physics.stats().bodies : 'absent'; } catch (e) { probe.phys = 'ERR ' + e.message; }
        r.probe = probe;
        return r;`);
      const errs = t.errorsSince(mk).filter((e) => !/favicon|index\.json/.test(e.text));
      const lDiff = {};
      for (const k of new Set([...Object.keys(before.listeners), ...Object.keys(after.listeners)])) { const d = (after.listeners[k] || 0) - (before.listeners[k] || 0); if (d) lDiff[k] = d; }
      const sDiff = {};
      for (const k of Object.keys(baseline.snap)) { const d = (after.snap[k] || 0) - before.snap[k]; if (d) sDiff[k] = d; }
      const missingSvc = baseline.services.filter((s) => !after.services.includes(s));
      const row = { module: rel, reloaded, retried, why, ms: Date.now() - t0, failed: after.failed, hasInstance: after.hasInstance, missingSvc, listenerDrift: lDiff, registryDrift: sDiff, probe: after.probe, errors: errs.map((e) => e.text.slice(0, 260)), mtimeChanged: fs.statSync(file).mtimeMs !== stat0.mtimeMs };
      results.push(row);
      t.log(`${rel}: reloaded=${reloaded} errors=${errs.length} svcMissing=${missingSvc.join(',') || '-'} listenerDrift=${JSON.stringify(lDiff)} regDrift=${JSON.stringify(sDiff)}`);
    }
    t.data.reloads = results;
    for (const r of results) {
      const name = r.module;
      t.check(`${name}: reloads after a file rewrite`, r.reloaded && !r.failed && r.hasInstance, JSON.stringify({ reloaded: r.reloaded, why: r.why, failed: r.failed, hasInstance: r.hasInstance, errors: r.errors }).slice(0, 700), 'P1');
      t.check(`${name}: reload needed no second rewrite (the server's node --check did not time out)`, !r.retried, 'server/files.js dropped the module after a timed-out syntax check (15 s) and only a second rewrite brought it back', 'P2');
      t.check(`${name}: no console errors during reload`, r.errors.length === 0, r.errors.join('\n'), 'P1');
      t.check(`${name}: all services present again`, r.missingSvc.length === 0, 'missing: ' + r.missingSvc.join(','), 'P1');
      const dup = Object.entries(r.listenerDrift).filter(([, v]) => v !== 0);
      t.check(`${name}: event listener counts unchanged (no duplicated/leaked listeners)`, dup.length === 0, JSON.stringify(r.listenerDrift), 'P1');
      const reg = Object.entries(r.registryDrift).filter(([k, v]) => !/scene_(objects|meshes|lights)|kit_lights|kit_particleSystems/.test(k) && v !== 0);
      t.check(`${name}: registries stable (actors, fighters, bodies, colliders)`, reg.length === 0, JSON.stringify(r.registryDrift), 'P1');
      const sc = Math.abs(r.registryDrift.scene_objects ?? 0);
      t.check(`${name}: scene object count stable (within 5)`, sc <= 5, `scene_objects drift ${r.registryDrift.scene_objects}, meshes ${r.registryDrift.scene_meshes}`, 'P2');
      const pr = r.probe || {};
      t.check(`${name}: game still works (spawn/remove, spell cast, weapon, physics)`, pr.spawn === true && pr.weapon === true && Number.isFinite(pr.phys) && pr.cast >= 1, JSON.stringify(pr), 'P1');
    }
    await t.shot('scene-after-all-reloads');
    const bad = await t.compileAndCheck();
    t.check('no broken shader programs after all reloads', bad.length === 0, JSON.stringify(bad).slice(0, 500), 'P0');
    const mods = await t.moduleReport();
    t.check('no failed modules at the end', mods.filter((m) => m.failed).length === 0, mods.filter((m) => m.failed).map((m) => m.path).join(','), 'P0');
    const final = await t.run(`return { snap: window.__qh.snap(), listeners: { ...window.__qa.listeners } };`);
    const totalL = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    t.note(`listeners ${totalL(baseline.listeners)} -> ${totalL(final.listeners)} after reloading ${core.length} modules once each`);
    t.data.finalDrift = { snap: Object.fromEntries(Object.keys(baseline.snap).map((k) => [k, (final.snap[k] || 0) - baseline.snap[k]]).filter(([, v]) => v)), listeners: totalL(final.listeners) - totalL(baseline.listeners) };
  },
};



