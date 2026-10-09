// 15. THE START AREA (sprint 2): a sandbox manifest that enables whichever of core/startzone.js (after core/library.js), core/meadow.js
//     (after core/world.js) and core/genset.js (after core/models.js) exist on disk, then a simulated desktop player: boot on both tiers, skip
//     the intro, walk forward 8 m, walk up to the lectern (it must select the starter spell), cast it at a straw dummy
//     ('startzone:dummy-hit'), grab a weapon from the rack, open/close the menu with M, type a wish (the client must send utterance_text; the
//     harness drops it, the AI is never called), 60 s soak with stable registries, and the Quest-tier budget numbers from the spawn view
//     (printed in the run summary against docs/SPRINT2.md: <= 120k triangles, <= 80 draw calls, textures of the set <= ~40 MB).
//     Env: QA_STARTAREA_INTRO=play plays the awakening through instead of skipping it.
import { enableModules, healModules } from '../lib/sandbox.mjs';

const ENABLE = [['core/library.js', 'core/startzone.js'], ['core/world.js', 'core/meadow.js'], ['core/models.js', 'core/genset.js']];
const BUDGET = { triangles: 120000, calls: 80, textureMB: 40 };
const ANCHORS = ['shrine', 'rack', 'lectern', 'dummies', 'waystone', 'lakeside', 'campfire'];

export default {
  id: 15, name: 'startarea', tiers: ['pc', 'quest'], timeout: 1500000,
  async run(t) {
    const man = enableModules(ENABLE);
    t.data.manifest = { enabled: man.enabled, absentOnDisk: man.absent };
    t.note(`sandbox manifest: enabled ${man.enabled.join(', ') || '(nothing new)'}; not on disk yet: ${man.absent.join(', ') || '(none)'}`);
    // (the server's change watcher also has to have re-read the new manifest: modules it dropped earlier in the run are healed first)
    const heal = await healModules();
    if (heal.dropped.length) t.note(`before this scenario the server had dropped ${heal.dropped.join(', ')} (server/files.js 15 s "node --check" timeout under load): ${heal.healed ? 'healed by a rewrite' : 'STILL MISSING ' + heal.still}`);
    const mark = t.mark();
    await t.load({ intro: 'new' });
    const g0 = t.mark();   // everything after the first settle counts for the model requests; the load itself is covered by `mark`

    // ------------------------------------------------------------------ boot: modules, errors, generated models
    const mods = await t.moduleReport();
    t.data.modules = mods.map((m) => ({ path: m.path, failed: m.failed, ms: m.ms }));
    const listed = await t.eval(`fetch('/api/modules').then((r) => r.json()).then((j) => j.modules.map((m) => m.path))`);
    const live = new Set(mods.map((m) => m.path));
    const failed = mods.filter((m) => m.failed || !m.hasInstance);
    t.check('boot: every listed module loaded and has an instance (none disabled by the loader)', failed.length === 0 && listed.every((p) => live.has(p)), `failed/no instance: ${failed.map((m) => m.path).join(', ')} | listed but not loaded: ${listed.filter((p) => !live.has(p)).join(', ')}`, 'P0');
    for (const p of man.enabled) t.check(`boot: ${p} (enabled for this scenario) is loaded`, live.has(p) && mods.find((m) => m.path === p)?.hasInstance === true, `listed by server: ${listed.includes(p)}; loaded: ${live.has(p)}`, 'P0');
    // syntax-checked server list vs manifest: a file the server refuses (syntax error) silently drops out of /api/modules
    const dropped = man.core.filter((p) => !listed.includes(p));
    t.check('boot: the server lists every module of the sandbox manifest (none dropped for a syntax error)', dropped.length === 0, 'missing from /api/modules: ' + dropped.join(', '), 'P0');
    const loadErr = t.errorsSince(mark).filter((e) => /\[module .*\] (load|update|dispose)/.test(e.text));
    t.check('boot: no "[module ...] load/update" error (the loader never disabled a module)', loadErr.length === 0, loadErr.map((e) => e.text.slice(0, 220)).join(' | '), 'P0');
    const reported = await t.eval(`__qa.sent.filter((s) => s.type === 'module_error').map((s) => s.preview.slice(0, 200))`);
    t.check('boot: no module_error message sent to the server', reported.length === 0, reported.join(' | '), 'P1');
    const sv = await t.eval(`(() => { const s = window.game.world.startzone; if (!s) return null; const o = { keys: Object.keys(s), anchors: {}, focus: {}, active: s.active, mode: s.mode }; for (const k of ${JSON.stringify(ANCHORS)}) { const a = s.anchors && s.anchors[k], f = s.focus && s.focus[k]; o.anchors[k] = a ? [a.x, a.y, a.z].map((n) => Math.round(n * 100) / 100) : null; o.focus[k] = f ? [f.x, f.y, f.z] : null; } return o; })()`);
    t.data.startzone = sv;
    if (man.enabled.includes('core/startzone.js') || live.has('core/startzone.js')) {
      t.check('world.startzone exists', !!sv, 'world.startzone is undefined (module loaded but did not provide the service?)', 'P0');
      const missing = sv ? ANCHORS.filter((k) => !sv.anchors[k] || !sv.anchors[k].every(Number.isFinite)) : ANCHORS;
      t.check('world.startzone anchors exist and are finite (' + ANCHORS.join(', ') + ')', missing.length === 0, 'missing/invalid: ' + missing.join(', '), 'P1');
    } else t.note('core/startzone.js is not on disk: start-zone checks skipped');
    const hasGenset = live.has('core/genset.js'), hasMeadow = live.has('core/meadow.js');
    // numbers the README quotes (kept honest here): library entries, spells, weapon types, ready-made places
    t.data.counts = await t.eval(`(() => { const w = window.game.world; const n = (f) => { try { return f(); } catch { return null; } }; return { library: n(() => w.library.list().length), spells: n(() => w.spells.list().length), weaponTypes: n(() => w.weapons.types().length), places: n(() => w.travel.list().length) }; })()`);
    t.note('README numbers: ' + JSON.stringify(t.data.counts));
    t.data.has = { startzone: !!sv, genset: hasGenset, meadow: hasMeadow, gen: await t.eval('!!window.game.world.gen') };

    // ------------------------------------------------------------------ the intro: starts for a new player, then skipped (or played)
    await t.run('window.__qh.faceForward();');
    const started = await t.run('return await window.__qh.waitIntroStart(40);');
    t.check('new player: the intro starts by itself', started === true, String(started), 'P1');
    let intro;
    if (process.env.QA_STARTAREA_INTRO === 'play') {
      intro = await t.run('return await window.__qh.playIntro({ maxGame: 1200, stuckAfter: 30 });', { timeout: 900000 });
      t.check('the intro plays through with the start zone present (no step had to be forced)', !intro.stillRunning && intro.done && intro.forced.length === 0, JSON.stringify(intro).slice(0, 500), 'P1');
    } else {
      intro = await t.run('return await window.__qh.skipIntro();');
      t.check('world.intro.skip() ends the intro at once', intro.wasRunning && intro.skipReturned === true && !intro.running && intro.done, JSON.stringify(intro), 'P1');
    }
    t.data.intro = intro;
    const q1 = await t.run(`
      const w = window.game.world, qa = window.__qa; let active = null;
      for (let i = 0; i < 200 && !active; i++) { const a = w.quests.active(); active = a ? a.id : null; if (!active) await qa.wait(0.5); }
      return { active, panel: w.menu.panel, menuOpen: w.menu.isOpen };`, { timeout: 300000 });
    t.check('after the intro the first quest starts by itself (boot -> first quest)', !!q1.active, JSON.stringify(q1), 'P1');
    t.check('no welcome card / menu window opens by itself', q1.panel !== 'welcome' && !q1.menuOpen, JSON.stringify(q1), 'P2');
    t.note(`first quest after the intro: ${q1.active}`);
    await t.run('const w = window.game.world; w.menu.close(); w.player.heal(1000); window.__qh.faceForward(); await window.__qa.wait(2);');

    // ------------------------------------------------------------------ the spawn view: budget numbers (quest tier is the one that counts)
    await t.run(`const g = window.game; g.world.player.teleport(0, 0); window.__qh.faceForward(); await window.__qa.wait(3);`);
    const view = await t.run(`
      const g = window.game, w = g.world, THREE = g.THREE;
      g.renderer.info.reset();
      const m = window.__qa.measure(); const info = g.renderer.info;
      // textures referenced by visible meshes, estimated as w*h*4 bytes + mip chain
      const seen = new Set(); let bytes = 0, n = 0;
      g.scene.traverse((o) => {
        let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
        if (!vis || !(o.isMesh || o.isPoints || o.isSprite)) return;
        for (const mat of [].concat(o.material || [])) for (const v of Object.values(mat)) {
          if (v && v.isTexture && !seen.has(v.uuid)) { seen.add(v.uuid); const im = v.image; const wd = im && (im.width || im.videoWidth), ht = im && (im.height || im.videoHeight); if (wd && ht) { bytes += wd * ht * 4 * 1.33; n++; } }
        }
      });
      // who draws the triangles: visible, in-frustum meshes summed per owning module (approximation: an InstancedMesh counts all its instances)
      const fr = new THREE.Frustum(), pm = new THREE.Matrix4(); g.camera.updateMatrixWorld(); pm.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
      const perModule = {};
      g.scene.traverse((o) => {
        if (!(o.isMesh) || !o.geometry) return;
        let vis = true, owner = '(scene)'; for (let p = o; p; p = p.parent) { if (!p.visible) { vis = false; break; } if (owner === '(scene)' && /^module:/.test(p.name)) owner = p.name.slice(7); }
        if (!vis) return;
        let inView = true; try { inView = o.frustumCulled === false ? true : fr.intersectsObject(o); } catch { inView = true; }
        if (!inView) return;
        const geo = o.geometry, tris = (geo.index ? geo.index.count : (geo.attributes.position ? geo.attributes.position.count : 0)) / 3 * (o.isInstancedMesh ? o.count : 1);
        const e = (perModule[owner] ||= { triangles: 0, meshes: 0 }); e.triangles += Math.round(tris); e.meshes++;
      });
      const topModules = Object.entries(perModule).sort((a, b) => b[1].triangles - a[1].triangles).slice(0, 8).map(([k, v]) => ({ module: k, ...v }));
      return { calls: m.calls, triangles: m.triangles, topModules, points: m.points, lines: m.lines, programs: info.programs ? info.programs.length : -1, geometries: info.memory.geometries, textures: info.memory.textures, visibleTextureMB: Math.round(bytes / 1048576 * 10) / 10, visibleTextureCount: n };`);
    const modsNow = (await t.moduleReport()).filter((m) => !m.failed).sort((a, b) => b.ms - a.ms);
    t.data.spawnView = view;
    t.data.moduleMs = modsNow.map((m) => ({ path: m.path, ms: m.ms }));
    const lines = [];
    lines.push(`spawn view [${t.tier}]: ${view.triangles} triangles, ${view.calls} draw calls, ${view.programs} programs, ${view.geometries} geometries, ${view.textures} textures (visible ~${view.visibleTextureMB} MB in ${view.visibleTextureCount})`);
    lines.push(`budget (Quest 72 fps, docs/SPRINT2.md): <= ${BUDGET.triangles} triangles, <= ${BUDGET.calls} draw calls, textures <= ~${BUDGET.textureMB} MB  ->  ` + (t.tier === 'quest' ? [`triangles ${view.triangles <= BUDGET.triangles ? 'OK' : 'OVER by ' + (view.triangles - BUDGET.triangles)}`, `calls ${view.calls <= BUDGET.calls ? 'OK' : 'OVER by ' + (view.calls - BUDGET.calls)}`, `textures ${view.visibleTextureMB <= BUDGET.textureMB ? 'OK' : 'OVER'}`].join(', ') : 'PC tier: informational only'));
    lines.push('triangles by owning module (in view, approximate): ' + (view.topModules || []).map((m) => `${m.module.replace(/^(core|creations)\//, '')} ${m.triangles} (${m.meshes} meshes)`).join(', '));
    lines.push('per-module update ms (moving average, fast mode, software GL host: relative only): ' + modsNow.slice(0, 8).map((m) => `${m.path.replace(/^(core|creations)\//, '')} ${m.ms.toFixed(3)}`).join(', '));
    lines.push('enabled for this run: ' + (man.enabled.join(', ') || '(none new)') + '; not on disk: ' + (man.absent.join(', ') || '(none)'));
    t.data.budgetLines = lines;
    for (const l of lines) t.note(l);
    if (t.tier === 'quest') {
      t.check(`budget: spawn view <= ${BUDGET.triangles} triangles on the Quest tier`, view.triangles <= BUDGET.triangles, `${view.triangles} triangles`, 'P1');
      t.check(`budget: spawn view <= ${BUDGET.calls} draw calls on the Quest tier`, view.calls <= BUDGET.calls, `${view.calls} draw calls`, 'P1');
      t.check(`budget: visible textures <= ~${BUDGET.textureMB} MB on the Quest tier`, view.visibleTextureMB <= BUDGET.textureMB, `~${view.visibleTextureMB} MB`, 'P2');
    }
    const bad0 = await t.compileAndCheck();
    t.check('no broken shader programs in the spawn view', bad0.length === 0, JSON.stringify(bad0).slice(0, 600), 'P0');
    t.data.pixels = await t.pixelStats();
    t.check('spawn frame is not black / blown out', t.data.pixels.avg > 15 && t.data.pixels.avg < 235 && t.data.pixels.dark < 90, JSON.stringify(t.data.pixels), 'P1');
    await t.shot('spawn-view');

    // ------------------------------------------------------------------ walk forward 8 m
    const walk = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh; const r = {};
      w.player.teleport(0, 0); qh.faceForward(); await qa.wait(0.6);
      const p0 = g.rig.position.clone(); let d = 0, t0 = qa.gameTime;
      qh.key('keydown', 'KeyW');
      while (d < 8 && qa.gameTime - t0 < 14) { await qa.wait(0.25); d = Math.hypot(g.rig.position.x - p0.x, g.rig.position.z - p0.z); }
      qh.key('keyup', 'KeyW'); await qa.waitFrames(3);
      r.metres = d; r.seconds = qa.gameTime - t0; r.end = [g.rig.position.x, g.rig.position.y, g.rig.position.z].map((n) => +n.toFixed(2));
      r.groundY = w.groundHeight(g.rig.position.x, g.rig.position.z); r.drift = Math.abs(g.rig.position.x - p0.x);
      return r;`);
    t.data.walk = walk;
    t.check('walking forward from the spawn (W) covers 8 m within 14 s (nothing blocks the way ahead)', walk.metres >= 8, JSON.stringify(walk), 'P1');
    t.check('the player stays on the ground while walking', Math.abs(walk.end[1] - walk.groundY) < 0.5, JSON.stringify(walk), 'P1');

    // ------------------------------------------------------------------ lectern -> starter spell -> dummy
    if (sv) {
      const lect = await t.run(`
        const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, sz = w.startzone; const r = {};
        const entered = []; const off = g.events.on('startzone:enter', (e) => entered.push(e.name));
        const ids = w.spells.list().map((s) => s.id);
        r.pre = ids.includes('heal') ? 'heal' : ids[ids.length - 1]; w.spells.select(r.pre); await qa.wait(0.2);
        // the start zone fires "enter" once per VISIT and re-arms only after the player has been > 8 m away (the lectern may stand right next to the spawn point): go away first
        // (and the lectern has a 40 s cool-down after it selected the spell: at the spawn point that happened at the very start)
        const a = sz.anchors.lectern; w.player.teleport(a.x + 11, a.z + 11); qh.faceForward(); await qa.wait(42);
        w.spells.select(r.pre); await qa.wait(0.2);
        w.player.teleport(a.x, a.z); qh.faceForward(); await qa.wait(2.0);
        r.after = w.spells.current() && w.spells.current().id; r.entered = entered.slice(); off();
        const hd = g.player.head; r.headXZ = [hd.x, hd.z].map((n) => +n.toFixed(2)); r.anchor = [a.x, a.z].map((n) => +n.toFixed(2));
        r.distToLectern = +Math.hypot(hd.x - a.x, hd.z - a.z).toFixed(2); r.nearest = sz.nearest ? sz.nearest(hd) : null;
        return r;`);
      t.data.lectern = lect;
      t.check('walking up to the spell lectern selects the starter spell (and fires startzone:enter)', !!lect.after && lect.after !== lect.pre && lect.entered.includes('lectern'), JSON.stringify(lect), 'P1');

      const dum = await t.run(`
        const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, sz = w.startzone; const r = { hits: 0, casts: 0, downs: 0 };
        const spell = w.spells.current(); r.spell = spell && spell.id;
        const offs = [g.events.on('startzone:dummy-hit', () => r.hits++), g.events.on('spell:cast', () => r.casts++), g.events.on('startzone:dummy-down', () => r.downs++)];
        const a = sz.anchors.dummies; w.player.teleport(a.x, a.z); qh.faceForward(); await qa.wait(1.0);
        qa.lock(true);
        const spec = spell && w.spells.list().find((s) => s.id === spell.id); const hold = spec && spec.hold;
        r.dummies = sz.dummyList.length;
        for (let i = 0; i < 40 && r.hits < 1; i++) {
          const d = sz.dummyList.filter((x) => x.alive).sort((p, q) => p.position.distanceTo(g.player.head) - q.position.distanceTo(g.player.head))[0];
          if (!d) { await qa.wait(1); continue; }
          qh.aimAt(d.position.x, d.position.y + 1.1, d.position.z); await qa.waitFrames(1);
          await qh.hold(0, hold ? 1.0 : 0.25); await qa.wait(0.6);
        }
        r.firstHitAfterCasts = r.casts;
        // keep casting until one dummy is knocked down, then wait for it to come back
        for (let i = 0; i < 60 && r.downs < 1; i++) {
          const d = sz.dummyList.filter((x) => x.alive).sort((p, q) => p.position.distanceTo(g.player.head) - q.position.distanceTo(g.player.head))[0];
          if (!d) break;
          qh.aimAt(d.position.x, d.position.y + 1.1, d.position.z); await qa.waitFrames(1);
          await qh.hold(0, hold ? 1.0 : 0.25); await qa.wait(0.5);
        }
        r.totalCasts = r.casts;
        // the dummies come back after ~4.5 s of WALL-clock time (startzone.js), and the harness's fast virtual clock outruns the wall clock: wait in real time
        if (r.downs >= 1) { const w0 = performance.now(); while (performance.now() - w0 < 12000 && sz.dummyList.some((x) => !x.alive)) await new Promise((res) => setTimeout(res, 250)); r.allBack = sz.dummyList.every((x) => x.alive); r.backAfterMs = Math.round(performance.now() - w0); }
        offs.forEach((o) => o()); qa.lock(false);
        return r;`, { timeout: 300000 });
      t.data.dummy = dum;
      t.check('the starter spell, cast at a straw dummy, emits startzone:dummy-hit', dum.hits >= 1, JSON.stringify(dum), 'P1');
      t.check('a dummy can be knocked down (startzone:dummy-down) and comes back', dum.downs >= 1 && dum.allBack === true, JSON.stringify(dum), 'P2');
      await t.run(`const w = window.game.world, a = w.startzone.anchors.dummies; w.player.teleport(a.x, a.z); window.__qh.aimAt(a.x - 2, 1.4, a.z - 8); await window.__qa.wait(0.6);`);
      await t.shot('dummies');

      // ---------------------------------------------------------------- weapon rack: take a weapon
      const rack = await t.run(`
        const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, sz = w.startzone; const r = {};
        const taken = []; const off = g.events.on('startzone:weapon', (e) => taken.push(e.type));
        const a = sz.anchors.rack; w.player.teleport(a.x, a.z); qh.faceForward(); await qa.wait(1.0);
        r.slots = sz.rack.map((s) => s.type);
        const slot = sz.rack.find((s) => s.weapon && !s.taken) || sz.rack[0];
        if (!slot || !slot.weapon) { off(); r.err = 'rack has no weapon'; return r; }
        const wp = slot.weapon.body ? slot.weapon.body.position : (slot.weapon.object && slot.weapon.object.position) || null;
        if (!wp) { off(); r.err = 'weapon has no body position'; return r; }
        r.type = slot.type; r.dist = +Math.hypot(wp.x - g.player.head.x, wp.y - g.player.head.y, wp.z - g.player.head.z).toFixed(2);
        qa.lock(true);
        for (let k = 0; k < 4 && !w.weapons.held.right && !w.weapons.held.left; k++) {
          qh.mouseUp(2); await qa.wait(0.3); qh.aimAt(wp.x, wp.y, wp.z); await qa.waitFrames(2);
          qh.mouseDown(2); await qa.wait(0.7); r.attempts = k + 1;
        }
        const h = w.weapons.held.right || w.weapons.held.left; r.held = h ? h.type : null; r.taken = taken.slice();
        return r;`);
      t.data.rack = rack;
      t.check('the weapon rack holds weapons', !rack.err && rack.slots.length >= 2, JSON.stringify(rack), 'P1');
      t.check('right mouse grabs a weapon from the rack (held in hand + startzone:weapon)', !rack.err && !!rack.held && rack.taken.length >= 1, JSON.stringify(rack), 'P1');
      await t.shot('rack-holding');
      await t.run(`window.__qh.mouseUp(2); await window.__qa.wait(0.5); window.game.world.weapons.list().filter((x) => x.held).forEach((x) => { try { x.remove(); } catch {} });`);
    }

    // ------------------------------------------------------------------ menu with M
    const menu = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh; const r = {};
      w.player.teleport(0, 0); qh.faceForward(); await qa.wait(0.5);
      r.before = { launcher: w.menu.launcherOpen, open: w.menu.isOpen };
      qh.key('keydown', 'KeyM'); qh.key('keyup', 'KeyM'); await qa.wait(0.7); r.afterM1 = { launcher: w.menu.launcherOpen, open: w.menu.isOpen };
      qh.key('keydown', 'KeyM'); qh.key('keyup', 'KeyM'); await qa.wait(0.7); r.afterM2 = { launcher: w.menu.launcherOpen, open: w.menu.isOpen };
      w.menu.open('summon'); await qa.wait(0.7); r.panelOpen = w.menu.isOpen;
      qh.key('keydown', 'KeyM'); qh.key('keyup', 'KeyM'); await qa.wait(0.7); r.afterM3 = { launcher: w.menu.launcherOpen, open: w.menu.isOpen };
      return r;`);
    t.data.menu = menu;
    t.check('M opens the menu launcher and M closes it again', !menu.before.launcher && menu.afterM1.launcher && !menu.afterM2.launcher && !menu.afterM2.open, JSON.stringify(menu), 'P1');
    t.check('M closes an open panel window', menu.panelOpen === true && !menu.afterM3.open, JSON.stringify(menu), 'P1');

    // ------------------------------------------------------------------ typed wish: utterance_text leaves the client (the harness drops it: no AI call)
    const typed = await t.run(`
      const qa = window.__qa; const chat = document.getElementById('chat'); const r = { hasChat: !!chat };
      if (!chat) return r;
      const b0 = qa.blocked.length, s0 = qa.sent.length;
      chat.focus(); chat.value = 'hello Omnissiah, QA test of the start area'; chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      await qa.wait(1.5);
      r.blocked = qa.blocked.slice(b0).map((b) => ({ type: b.type, preview: b.preview.slice(0, 300) }));
      r.sent = qa.sent.slice(s0).map((b) => b.type);
      chat.blur();
      return r;`);
    t.data.typed = typed;
    const utt = typed.blocked && typed.blocked.find((b) => b.type === 'utterance_text');
    t.check('typing a wish in the chat box sends utterance_text (dropped by the harness: the AI is not called)', !!utt && /start area/.test(utt.preview), JSON.stringify(typed).slice(0, 500), 'P1');

    // ------------------------------------------------------------------ 60 s soak, registries stable
    await t.run(`const g = window.game, w = g.world; w.menu.close(); w.player.teleport(0, 0); window.__qh.faceForward(); window.__qh.mouseUp(2); await window.__qa.wait(30);`);   // let respawns / restocks / the intro's leftovers settle
    const base = await t.run(`return { snap: window.__qh.snap(), listeners: { ...window.__qa.listeners }, heap: window.__qh.heap() };`);
    await t.run(`await window.__qa.wait(60);`, { timeout: 600000 });
    const fin = await t.run(`return { snap: window.__qh.snap(), listeners: { ...window.__qa.listeners }, heap: window.__qh.heap(), broken: window.__qh.broken() };`);
    const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const drift = {}; for (const k of Object.keys(base.snap)) { const d = (fin.snap[k] || 0) - base.snap[k]; if (d) drift[k] = d; }
    t.data.soak = { drift, listeners: [total(base.listeners), total(fin.listeners)], heapMB: [base.heap, fin.heap] };
    const regDrift = Object.entries(drift).filter(([k, v]) => !/scene_(objects|meshes|lights)|kit_lights|kit_particleSystems/.test(k) && v !== 0);
    t.check('60 s soak: registries stable (actors, damageables, bodies, fighters, colliders)', regDrift.length === 0, JSON.stringify(drift), 'P1');
    t.check('60 s soak: scene object count stable (within 8)', Math.abs(drift.scene_objects ?? 0) <= 8, JSON.stringify(drift), 'P2');
    t.check('60 s soak: event listener count stable', total(fin.listeners) === total(base.listeners), `${total(base.listeners)} -> ${total(fin.listeners)}`, 'P1');
    t.check('60 s soak: no broken shader programs', fin.broken.length === 0, fin.broken.join(', '), 'P0');
    if (base.heap > 0) t.check('60 s soak: JS heap grew by less than 60 MB', fin.heap - base.heap < 60, `${base.heap} -> ${fin.heap} MB`, 'P2');

    // ------------------------------------------------------------------ whole-scenario verdicts
    const errs = t.errorsSince(mark).filter((e) => !/Microphone|favicon/.test(e.text));
    t.check('zero console errors during boot, the walk, the spell, the rack, the menu and the soak', errs.length === 0, errs.slice(0, 8).map((e) => e.text.slice(0, 220)).join('\n'), 'P1');
    const glbs = t.modelsSince(mark);
    const gen = glbs.filter((m) => /\/assets\/generated\//.test(m.url));
    const badGlb = glbs.filter((m) => m.status !== 200 && m.status !== 304);
    t.data.glbs = { total: glbs.length, generated: gen.length, failed: badGlb.map((m) => `${m.status} ${m.url}`) };
    t.check('every .glb requested returns 200 (failed URLs listed)', badGlb.length === 0, badGlb.map((m) => `${m.status || m.error} ${m.url}`).join('\n'), 'P1');
    t.check('the start area actually loads generated models from /assets/generated/ (SPRINT2: built only from the new set)', gen.length >= 1, `${glbs.length} .glb requests in total, none from /assets/generated/: ${glbs.slice(0, 6).map((m) => m.url).join(', ')}`, 'P1');
    const startGen = gen.filter((m) => /\/generated\/startzone\//.test(m.url));
    if (startGen.length) {
      const isTwin = (m) => /\/startzone\/q\//.test(m.url); const twins = startGen.filter(isTwin), originals = startGen.filter((m) => !isTwin(m));
      const perfEnd = await t.perfStats(); t.data.perfEnd = perfEnd && { level: perfEnd.level, quality: perfEnd.quality };
      // Quest: only the light twins. PC: the originals must be used (core/startzone.js deliberately also loads the twins on PC, for collider boxes and the mid LOD, so twins on PC are fine).
      if (t.tier === 'quest') t.check('Quest tier loads the Quest twins (startzone/q/*.glb) only', originals.length === 0, originals.slice(0, 6).map((m) => m.url).join('\n'), 'P1');
      else t.check('PC tier loads the original (high-resolution) models for the props (not only the Quest twins)', originals.length >= 3, `${originals.length} originals, ${twins.length} twins requested; governor at the end: ${JSON.stringify(t.data.perfEnd)}`, 'P1');
      t.note(`${startGen.length} startzone model requests, e.g. ${[...new Set(startGen.map((m) => m.url.split('/').pop()))].slice(0, 8).join(', ')}`);
    }
    const bad = await t.compileAndCheck();
    t.check('no broken shader programs at the end', bad.length === 0, JSON.stringify(bad).slice(0, 600), 'P0');
    void g0;
  },
};
