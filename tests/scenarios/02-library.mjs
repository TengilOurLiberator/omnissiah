// 2. Library sweep: spawn EVERY world.library.list() entry one at a time through a creation-like ctx (window.__qaCtx from
//    creations/zz-qa-hook.js), step, assert no exceptions + something visible, remove, assert registries return to baseline.
//    Per-entry draw calls are recorded. Entries of category 'scenarios' are included (they are library entries too).
export default {
  id: 2, name: 'library', tiers: ['pc', 'quest'], timeout: 3000000,
  async run(t) {
    await t.load();
    const names = await t.run(`const l = window.game.world.library.list(); return l.map(e => ({ name: e.name, category: e.category }));`);
    t.note(`${names.length} library entries`);
    await t.run(`__qh.freezePlayer(true); __qh.faceForward(); window.game.world.kit.gore?.clear?.();`);
    // let the world settle, then take the global baseline
    await t.step(1.5);
    const base = await t.run(`return { snap: __qh.snap(), env: __qh.envJson(), heap: __qh.heap(), calls: __qa.measure() };`);
    const rows = [];
    const t0 = Date.now();
    let idx = 0;
    for (const e of names) {
      idx++;
      const mark = t.mark();
      const bigStep = e.category === 'scenarios' || e.category === 'structures' ? 3.5 : 2.2;
      let row;
      try {
        row = await t.run(`
          const name = ${JSON.stringify(e.name)}, w = window.game.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh;
          const out = { name, category: ${JSON.stringify(e.category)} };
          if (!ctx) return { name, error: 'no __qaCtx (hook module not loaded)' };
          const before = qh.snap(), envBefore = qh.envJson(), baseM = qa.measure(), blk0 = qa.blocked.length, sent0 = qa.sent.length;
          let h = null;
          try { h = w.library.spawn(ctx, name); } catch (err) { out.threw = String(err && err.stack || err).slice(0, 500); }
          out.handle = !!h;
          await qa.wait(${bigStep});
          const mid = qh.snap();
          const m = qa.measure();
          out.calls = m.calls - baseM.calls; out.tris = m.triangles - baseM.triangles;
          out.rootChildren = ctx.root.children.length; out.visible = qh.visibleMeshes(ctx.root);
          out.added = qh.diff(before, mid);
          out.broken = qh.broken();
          out.fighters = h && h.fighters ? h.fighters.length : 0;
          out.trimmed = !!(h && h.trimmed);
          try { if (h && h.remove) h.remove(); } catch (err) { out.removeThrew = String(err && err.stack || err).slice(0, 400); }
          await qa.wait(1.6);
          const after = qh.snap();
          out.leak = qh.diff(before, after);
          out.envChanged = qh.envDiff(envBefore, qh.envJson());
          out.rootAfter = ctx.root.children.length;
          out.blocked = qa.blocked.slice(blk0).map(b => b.type);
          out.sent = qa.sent.slice(sent0).map(b => b.type).filter(x => x !== 'module_error' && x !== 'save_set');
          out.heap = qh.heap();
          return out;
        `, { timeout: 120000 });
      } catch (err) {
        row = { name: e.name, category: e.category, error: String(err.message).slice(0, 300) };
        // the page may be wedged: try to recover by reloading
        if (/timeout|closed/i.test(err.message)) {
          t.note(`entry ${e.name}: page unresponsive (${err.message.slice(0, 100)}); reloading`);
          try { await t.load(); await t.run(`__qh.freezePlayer(true); __qh.faceForward();`); } catch (e2) { t.note('reload failed: ' + e2.message); break; }
        }
      }
      row.consoleErrors = t.errorsSince(mark).map((x) => x.text.slice(0, 240));
      rows.push(row);
      if (idx % 25 === 0) t.log(`${idx}/${names.length} entries, ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    t.data.rows = rows;
    t.data.baseline = base;

    // ---- assertions
    const threw = rows.filter((r) => r.threw || r.removeThrew || r.error);
    t.check('every library entry spawns and removes without throwing', threw.length === 0, threw.slice(0, 12).map((r) => `${r.name}: ${r.threw || r.removeThrew || r.error}`).join('\n'), 'P1');
    const nullHandle = rows.filter((r) => !r.handle && !r.threw && !r.error);
    t.check('every entry returns a handle', nullHandle.length === 0, nullHandle.map((r) => r.name).join(', '), 'P1');
    const withErrors = rows.filter((r) => r.consoleErrors.length);
    t.check('no console errors during any entry', withErrors.length === 0, withErrors.slice(0, 12).map((r) => `${r.name}: ${r.consoleErrors[0]}`).join('\n'), 'P1');
    const invisible = rows.filter((r) => r.handle && !r.error && r.visible === 0 && Object.keys(r.added ?? {}).length === 0);
    t.check('every entry adds something visible or a registry change', invisible.length === 0, 'nothing added: ' + invisible.map((r) => r.name).join(', '), 'P2');
    const broken = rows.filter((r) => r.broken?.length);
    t.check('no broken shader programs from any entry', broken.length === 0, broken.slice(0, 8).map((r) => `${r.name}: ${r.broken.join(',')}`).join('\n'), 'P0');
    const leaky = rows.filter((r) => {
      const keys = Object.keys(r.leak ?? {}).filter((k) => !/^scene_(objects|meshes)$/.test(k) && !/kit_particleSystems|kit_lights|scene_lights/.test(k));
      return keys.length > 0;
    });
    t.check('registries return to baseline after remove()', leaky.length === 0, leaky.slice(0, 20).map((r) => `${r.name}: ${JSON.stringify(r.leak)}`).join('\n'), 'P1');
    const sceneLeak = rows.filter((r) => (r.leak?.scene_objects ?? 0) > 3 || (r.rootAfter ?? 0) > 0);
    t.check('scene graph returns to baseline after remove()', sceneLeak.length === 0, sceneLeak.slice(0, 20).map((r) => `${r.name}: scene_objects ${r.leak?.scene_objects}, root children left ${r.rootAfter}`).join('\n'), 'P1');
    const envLeak = rows.filter((r) => r.envChanged?.length);
    t.check('world.env restored after remove()', envLeak.length === 0, envLeak.slice(0, 20).map((r) => `${r.name}: ${r.envChanged.join(',')}`).join('\n'), 'P2');
    const gen = rows.filter((r) => (r.blocked ?? []).some((b) => /^(gen3d|sfx|music|place|blast)$/.test(b)));
    t.check('no entry requests generation (gen3d/sfx/music/place/blast)', gen.length === 0, gen.map((r) => `${r.name}: ${r.blocked.join(',')}`).join('\n'), 'P1');
    const cap = t.tier === 'quest' ? 150 : 1500;
    const heavy = rows.filter((r) => r.calls > (t.tier === 'quest' ? 60 : 200)).sort((a, b) => b.calls - a.calls);
    t.check(`no single entry costs more than ${t.tier === 'quest' ? 60 : 200} draw calls`, heavy.length === 0, heavy.slice(0, 15).map((r) => `${r.name}: ${r.calls} calls / ${r.tris} tris`).join('\n'), 'P2');
    const heavyT = rows.filter((r) => r.tris > (t.tier === 'quest' ? 120000 : 800000)).sort((a, b) => b.tris - a.tris);
    t.check(`no single entry exceeds ${t.tier === 'quest' ? '120k' : '800k'} triangles`, heavyT.length === 0, heavyT.slice(0, 15).map((r) => `${r.name}: ${r.tris} tris`).join('\n'), 'P2');
    t.data.topCalls = [...rows].sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0)).slice(0, 15).map((r) => `${r.name} ${r.calls}c/${r.tris}t`);
    t.note('top draw-call entries: ' + t.data.topCalls.join('; '));
    const endHeap = await t.run('return window.__qh.heap();');
    t.note(`JS heap ${base.heap} -> ${endHeap} MB over the sweep`);
    const final = await t.run(`return { snap: window.__qh.snap(), env: window.__qh.envJson() };`);
    t.data.finalDiff = await t.run(`return window.__qh.diff(${JSON.stringify(base.snap)}, window.__qh.snap());`);
    t.note('registry drift over whole sweep: ' + JSON.stringify(t.data.finalDiff));
    await t.run(`window.__qh.freezePlayer(false)`);

    // ---- line-ups for the eyes
    const lineups = {
      weapons: ['sword', 'greatsword', 'katana', 'bow', 'blaster', 'rocket-launcher', 'shield', 'omni-blade', 'ember-staff', 'star-bow'],
      enemies: ['goblin', 'orc-brute', 'skeleton', 'troll', 'demon', 'wraith', 'fire-elemental', 'stone-golem', 'giant-spider'],
      allies_life: ['knight', 'archer', 'mage', 'healer', 'villager', 'merchant', 'cat', 'dog', 'cow'],
      props: names.filter((n) => n.category === 'props').slice(0, 12).map((n) => n.name),
      nature: names.filter((n) => n.category === 'nature').slice(0, 10).map((n) => n.name),
      effects: names.filter((n) => n.category === 'effects').slice(0, 8).map((n) => n.name),
    };
    for (const [label, list] of Object.entries(lineups)) {
      const present = new Set(names.map((n) => n.name));
      const use = list.filter((n) => present.has(n));
      await t.run(`
        const w = window.game.world, ctx = window.__qaCtx, list = ${JSON.stringify(use)};
        window.__qaLineup = [];
        list.forEach((n, i) => { const x = (i - (list.length - 1) / 2) * 2.1; try { const h = w.library.spawn(ctx, n, { position: { x, z: -9 }, faction: 'neutral', hand: undefined }); if (h) window.__qaLineup.push(h); } catch (e) { console.error('lineup', n, e); } });
        window.__qh.faceForward();
        await window.__qa.wait(2.5);
      `);
      await t.shot('lineup-' + label);
      await t.run(`for (const h of window.__qaLineup || []) { try { h.remove(); } catch {} } window.__qaLineup = []; await window.__qa.wait(1);`);
    }
  },
};
