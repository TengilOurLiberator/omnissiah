// 10. The first ten minutes of a new player (desktop emulation). It starts with the AWAKENING (core/intro.js, which replaces the welcome card
//     and holds the quests) played through by a bot that follows the story engine's published wait metadata, then: look, walk, turn, jump, menu panels, summon and hold a
//     weapon, swing at a dummy, cast three spells, fight (2 goblins + knight ally) to a kill, take damage, die, respawn, first quest,
//     save + reload, travel to a cached place and home, typed utterance (client side only: the wire message is dropped by the harness).
import { readSave, savesDir } from '../lib/sandbox.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PANELS = ['summon', 'spells', 'quests', 'chat', 'world', 'settings', 'help'];

export default {
  id: 10, name: 'newplayer', tiers: ['pc', 'quest'], timeout: 1500000,
  async run(t) {
    const mark0 = t.mark();
    await t.load({ intro: 'new' });   // a brand-new player: the awakening (core/intro.js) starts by itself
    await t.run('window.__qh.faceForward();');

    // ------------------------------------------------------------------ 0. the awakening, played through
    // Design under test: the intro replaces the welcome card; quests are held while it plays (it switches auto-start off); the Omnissiah is hidden
    // in the dark for the first seconds; commentary is muted; when it ends everything is put back and the first labour starts.
    const started = await t.run('return await window.__qh.waitIntroStart(40);');
    t.check('the awakening starts by itself for a new player', started === true, `running ${started}`, 'P1');
    const during = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa; const r = {};
      const a0 = w.quests.active(); r.activeAtStart = a0 ? a0.id : null;   // (the fast clock is long past 25 s when the intro starts: see the note below)
      const oracle = g.scene.getObjectByName('module:core/oracle.js');
      r.oracleFound = !!oracle; r.hiddenInDarkness = oracle ? (window.__qh.introHid === true || window.__qa.introWatch.hidden === true) : null;   // seen hidden by the per-frame watcher in inject.js (the fast clock outruns any CDP round trip)
      r.commentaryBefore = w.commentary ? w.commentary.enabled : null;
      await qa.wait(10);
      r.visibleAfterIgnite = oracle ? oracle.visible === true : null;
      r.panel = w.menu.panel; r.menuOpen = w.menu.isOpen;
      const a = w.quests.active(); r.activeQuest = a ? a.id : null;
      r.commentaryDuring = w.commentary ? w.commentary.enabled : null;
      r.running = w.intro.running; r.done = w.intro.done;
      return r;`);
    t.data.introDuring = during;
    t.check('while the awakening plays: the welcome card stays shut (the intro replaces it)', during.panel !== 'welcome' && !during.menuOpen, JSON.stringify(during), 'P1');
    t.check('while the awakening plays: no NEW quest is started (auto-start is held by the intro)', during.activeQuest === during.activeAtStart, JSON.stringify(during), 'P1');
    if (during.activeAtStart) t.note('RACE (quests.js autoStart vs intro.js): the first quest "' + during.activeAtStart + '" was already active when the awakening began, because quests auto-start at clock 25 s and the intro only switches auto-start off once it runs (3 s after the modules sync). On a slow load (> ~22 s from page start to sync) a real player gets the quest banner before/during the awakening.');
    if (during.oracleFound) t.check('the Omnissiah is hidden in the dark at the start and appears at the ignition', during.hiddenInDarkness === true && during.visibleAfterIgnite === true, JSON.stringify(during), 'P2');
    if (during.commentaryBefore !== null) t.check('commentary is muted while the awakening plays', during.commentaryDuring === false, JSON.stringify(during), 'P2');
    await t.shot('intro-running');
    const through = await t.run('return await window.__qh.playIntro({ maxGame: 1200, stuckAfter: 30 });', { timeout: 900000 });
    t.data.introThrough = through;
    t.note(`awakening played through in ${through.gameSeconds} game s, ${through.steps.length} waits: ${through.steps.map((s) => s.kind + ':' + String(s.label).slice(0, 28)).join(' | ')}`);
    t.check('the awakening plays through to its end with a bot following the published wait metadata', !through.stillRunning && through.done, JSON.stringify({ gameSeconds: through.gameSeconds, stillRunning: through.stillRunning, done: through.done }), 'P1');
    t.check('every step of the awakening completed on its own real action/event (none had to be force-skipped)', through.forced.length === 0, 'forced: ' + through.forced.join(' | '), 'P2');
    t.check('the awakening walked its steps (look, talk, gift, dummy, wheel, cast, menu, goblins)', through.steps.length >= 8, `${through.steps.length} steps`, 'P2');
    const introEnd = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa; const r = {};
      await qa.wait(3);
      const oracle = g.scene.getObjectByName('module:core/oracle.js');
      r.oracleVisible = oracle ? oracle.visible === true : null;
      r.flag = w.quests.stat('campaign.intro'); r.ls = (() => { try { return localStorage.getItem('omnissiah.intro.v1'); } catch { return 'n/a'; } })();
      r.done = w.intro.done; r.running = w.intro.running;
      r.panel = w.menu.panel; r.menuOpen = w.menu.isOpen;
      r.commentaryAfter = w.commentary ? w.commentary.enabled : null;
      // the first labour must start by itself now (auto-start was held during the intro)
      let active = null;
      for (let i = 0; i < 160 && !active; i++) { const a = w.quests.active(); active = a ? a.id : null; if (!active) await qa.wait(0.5); }
      r.firstQuest = active;
      r.panelAfterWait = w.menu.panel;
      return r;`, { timeout: 300000 });
    t.data.introEndData = introEnd;
    t.check('after the awakening: the Omnissiah is visible again and the intro is marked seen (stat + localStorage)', introEnd.oracleVisible !== false && introEnd.flag === 1 && introEnd.ls === '1' && introEnd.done === true && introEnd.running === false, JSON.stringify(introEnd), 'P1');
    // (the baseline cannot be read: the intro mutes commentary before the harness can look; a new profile has it on)
    t.check('after the awakening: commentary is back on (it was muted during it)', during.commentaryBefore === null || introEnd.commentaryAfter === true, JSON.stringify({ during: during.commentaryDuring, after: introEnd.commentaryAfter }), 'P2');
    t.check('after the awakening: the welcome card never opens (the intro replaced it)', introEnd.panel !== 'welcome' && introEnd.panelAfterWait !== 'welcome', JSON.stringify(introEnd), 'P1');
    t.check('after the awakening: the first quest "The Voice Above" starts by itself', introEnd.firstQuest === 'awaken', JSON.stringify(introEnd), 'P1');
    await t.shot('intro-finished');
    // leave a clean field for the rest of the scenario: the gift sword stays by design, nothing else may
    await t.run(`const w = window.game.world; w.weapons.list().slice().forEach((x) => { try { x.remove(); } catch {} }); w.menu.close(); w.player.invulnerable = 0; w.player.heal(1000); window.__qh.faceForward(); await window.__qa.wait(1);`);

    // ------------------------------------------------------------------ A. look around, walk, turn, jump
    const look = await t.run(`
      const g = window.game, qa = window.__qa, qh = window.__qh; const r = {};
      qa.lock(true);
      const y0 = g.camera.rotation.y, x0 = g.camera.rotation.x;
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 200, movementY: -100, bubbles: true }));
      await qa.waitFrames(2);
      r.yawChanged = g.camera.rotation.y !== y0; r.pitchChanged = g.camera.rotation.x !== x0;
      qh.faceForward();
      // walk forward with W
      const p0 = g.rig.position.clone();
      qh.key('keydown', 'KeyW'); await qa.wait(2.0); qh.key('keyup', 'KeyW'); await qa.waitFrames(3);
      r.walked = Math.hypot(g.rig.position.x - p0.x, g.rig.position.z - p0.z);
      r.dir = [g.rig.position.x - p0.x, g.rig.position.z - p0.z];
      r.feetY = g.rig.position.y; r.groundY = g.world.groundHeight(g.rig.position.x, g.rig.position.z); r.physical = g.world.player.physical;
      // strafe + backwards
      qh.key('keydown', 'KeyS'); await qa.wait(2.0); qh.key('keyup', 'KeyS'); await qa.waitFrames(3);
      r.backAt = [g.rig.position.x, g.rig.position.z];
      // turn with the arrow key (snap turn)
      const yaw0 = g.rig.rotation.y;
      qh.key('keydown', 'ArrowRight'); await qa.wait(0.3); qh.key('keyup', 'ArrowRight'); await qa.wait(0.3);
      r.turned = g.rig.rotation.y - yaw0;
      g.rig.rotation.y = yaw0;
      // jump (real-time frames: the fast virtual clock makes the character controller skip the jump arc)
      qa.setMode('real');
      let maxY = g.rig.position.y; const base = g.rig.position.y;
      qh.key('keydown', 'Space'); await qa.waitFrames(2); qh.key('keyup', 'Space');
      for (let i = 0; i < 40; i++) { await qa.waitFrames(1); maxY = Math.max(maxY, g.rig.position.y); }
      await qa.wait(1.2);
      qa.setMode('fast');
      r.jumpHeight = maxY - base; r.landed = Math.abs(g.rig.position.y - base) < 0.15; r.grounded = g.world.player.grounded;
      qh.faceForward();
      return r;`);
    t.data.look = look;
    t.check('mouse look rotates the camera', look.yawChanged && look.pitchChanged, JSON.stringify(look), 'P1');
    t.check('W walks the player forward (>2 m in 2 game-seconds)', look.walked > 2, `walked ${look.walked?.toFixed?.(2)} m, dir ${look.dir}`, 'P1');
    t.check('player stays on the terrain while walking', Math.abs(look.feetY - look.groundY) < 0.4, `feetY ${look.feetY} vs ground ${look.groundY}`, 'P1');
    t.check('arrow key snap-turns the player', Math.abs(look.turned) > 0.3, `turned ${look.turned}`, 'P1');
    t.check('jump leaves the ground and lands', look.jumpHeight > 0.3 && look.landed, `jumpHeight ${look.jumpHeight}, landed ${look.landed}`, 'P1');
    await t.run(`const g = window.game; g.rig.position.set(0, g.world.groundHeight(0,0), 0); g.rig.rotation.set(0,0,0); window.__qh.faceForward(); await window.__qa.wait(0.5);`);

    // ------------------------------------------------------------------ B. welcome card + menu
    // By design the awakening replaces the welcome card: it must not have opened on its own (checked again after minutes of play).
    // The card is still reachable (Help panel: "Show the welcome card" = menu.open('welcome')): open it that way and use its buttons.
    const wel = await t.run(`
      const w = window.game.world, qa = window.__qa; const r = {};
      r.autoOpened = w.menu.panel === 'welcome';
      w.menu.open('welcome'); await qa.wait(0.8);
      r.welcome = w.menu.panel; r.open = w.menu.isOpen;
      return r;`);
    t.check('the welcome card did not open by itself after the awakening', wel.autoOpened === false, JSON.stringify(wel), 'P1');
    t.check('the welcome card can still be opened on request', wel.welcome === 'welcome' && wel.open, JSON.stringify(wel), 'P2');
    await t.shot('welcome-card');
    // click "Got it" with a real mouse click
    const gotIt = await t.run(`
      const T = window.game.world.menu._t, qh = window.__qh;
      const wd = T.win.widgets.find((x) => x.type === 'button' && /got it/i.test(x.label || ''));
      if (!wd) return { found: false, widgets: T.win.widgets.map((x) => x.type + ':' + x.label).slice(0, 12) };
      const res = await qh.realClick(T.win, wd);
      await window.__qa.wait(0.5);
      return { found: true, res, panelAfter: window.game.world.menu.panel, open: window.game.world.menu.isOpen };`);
    t.data.gotIt = gotIt;
    t.check('welcome card has a "Got it" button and a real click closes it', gotIt.found && !gotIt.open, JSON.stringify(gotIt).slice(0, 400), 'P1');
    await t.run(`window.game.world.menu.close(); await window.__qa.wait(0.3);`);

    // M opens the wrist launcher; click an orb for real
    await t.run(`window.__qh.key('keydown', 'KeyM'); window.__qh.key('keyup', 'KeyM'); await window.__qa.wait(0.6);`);
    const launcher = await t.run(`
      const w = window.game.world, T = w.menu._t, qh = window.__qh;
      const r = { launcherOpen: w.menu.launcherOpen, orbs: T.launcher.orbs.map((o) => o.id) };
      return r;`);
    t.data.launcher = launcher;
    t.check('M opens the launcher with an orb per panel', launcher.launcherOpen && launcher.orbs.length >= 7, JSON.stringify(launcher), 'P1');
    await t.shot('launcher');
    const orbClick = await t.run(`
      const w = window.game.world, T = w.menu._t, qh = window.__qh;
      const orb = T.launcher.orbs.find((o) => o.id === 'summon');
      const res = await qh.realClick(T.launcher, orb);
      await window.__qa.wait(0.5);
      return { res, panel: w.menu.panel, open: w.menu.isOpen };`);
    t.check('real click on a launcher orb opens that panel', orbClick.open && orbClick.panel === 'summon', JSON.stringify(orbClick), 'P1');

    // every panel: open via the tab rail with a real click, screenshot, check it built
    for (const id of PANELS) {
      const mk = t.mark();
      const r = await t.run(`
        const w = window.game.world, T = w.menu._t, qh = window.__qh, id = ${JSON.stringify(id)};
        const tab = T.win.chrome.find((c) => c.key === 'tab:' + id);
        let how = 'tab';
        if (!tab) { w.menu.open(id); how = 'open()'; } else { const res = await qh.realClick(T.win, tab); if (!res.ok) { w.menu.open(id); how = 'open() (real click failed: ' + res.why + ')'; } }
        await window.__qa.wait(0.8);
        const widgets = T.win.widgets.map((x) => ({ type: x.type, label: x.label })).slice(0, 80);
        return { panel: w.menu.panel, how, nWidgets: widgets.length, failedText: widgets.some((x) => /failed to build/i.test(x.label || '')), pageH: T.win.pageHeight };`);
      t.data['panel_' + id] = r;
      t.check(`panel "${id}" opens and has content`, r.panel === id && r.nWidgets > 0 && !r.failedText, JSON.stringify(r), 'P1');
      const errs = t.errorsSince(mk);
      if (errs.length) t.check(`panel "${id}" raises no console errors`, false, errs.map((e) => e.text.slice(0, 200)).join('\n'), 'P1');
      await t.shot('panel-' + id);
    }

    // controls in the panels: settings (gore, commentary, style preset, time of day), world, quests, spells
    const ctl = await t.run(`
      const w = window.game.world, T = w.menu._t, qa = window.__qa, r = {};
      const click = async (pred, label) => { const wd = T.win.widgets.find(pred); if (!wd) { r[label] = 'not found'; return false; } await window.__qh.realClick(T.win, wd); await qa.wait(0.4); return true; };
      w.menu.open('settings'); await qa.wait(0.6);
      r.settingsWidgets = T.win.widgets.filter((x) => x.label).map((x) => x.type + ':' + x.label).slice(0, 40);
      r.settingKeys = Object.keys(T.SETTINGS || {});
      return r;`);
    t.data.settings = ctl;
    const ctl2 = await t.run(`
      const w = window.game.world, T = w.menu._t, qa = window.__qa, r = {};
      // gore: through the same setting the toggle writes
      const kit = w.kit; const g0 = kit.gore && kit.gore.level;
      r.goreBefore = g0;
      const goreChoice = T.win.widgets.find((x) => /gore/i.test(x.label || '') || /gore/i.test(x.key || ''));
      r.goreWidget = goreChoice ? goreChoice.key : null;
      return r;`);
    t.data.settings2 = ctl2;
    // generic: set via menu's own settings API, then verify the effect on the real services
    const eff = await t.run(`
      const w = window.game.world, T = w.menu._t, qa = window.__qa, r = {};
      const names = Object.keys(T.SETTINGS || {});
      r.names = names;
      const tryset = async (name, val, probe) => { try { T.setSetting(name, val); await qa.wait(0.4); return probe(); } catch (e) { return 'ERR ' + e.message; } };
      if (names.includes('gore')) { r.gore = await tryset('gore', 'mild', () => w.kit.gore.level); await tryset('gore', 'full', () => 0); }
      if (names.includes('commentary')) r.commentary = await tryset('commentary', false, () => 'set');
      if (names.includes('tod') || names.includes('timeOfDay')) r.tod = 'present';
      return r;`);
    t.data.settingEffects = eff;
    if (eff.names?.includes('gore')) t.check('settings: gore "mild" reaches world.kit.gore.level', eff.gore === 'mild', JSON.stringify(eff), 'P1');
    // World panel: time of day slider (real click at the dark end), style preset, weather
    const world = await t.run(`
      const w = window.game.world, T = w.menu._t, qa = window.__qa, r = {};
      w.menu.open('world'); await qa.wait(0.7);
      const todBefore = w.env.timeOfDay; r.todBefore = todBefore;
      const slider = T.win.widgets.find((x) => x.type === 'slider');
      if (slider) { r.sliderClick = (await window.__qh.realClick(T.win, slider, 0.04)).ok; await qa.wait(3); }
      r.todAfter = w.env.timeOfDay;
      const noir = T.win.widgets.find((x) => x.key === 'chip|noir|1');
      if (noir) { r.noir = (await window.__qh.realClick(T.win, noir)).ok; await qa.wait(1.5); }
      r.style = w.style && w.style.preset ? w.style.preset : (w.style && w.style.get ? w.style.get() : null);
      const rain = T.win.widgets.find((x) => x.key === 'chip|rain|1');
      if (rain) { r.rain = (await window.__qh.realClick(T.win, rain)).ok; await qa.wait(2); }
      return r;`);
    t.data.worldPanel = world;
    t.check('World panel: dragging the time-of-day slider to its dark end changes world.env.timeOfDay', world.sliderClick && world.todAfter !== world.todBefore, JSON.stringify(world), 'P1');
    t.check('World panel: style preset and weather chips are clickable', world.noir && world.rain, JSON.stringify(world), 'P2');    await t.shot('world-night-noir-rain');
    await t.run(`const w = window.game.world; try { w.env.setTimeOfDay(0.78); } catch (e) {} try { const T = w.menu._t; const rain = T.win.widgets.find((x) => x.key === 'chip|rain|1'); if (rain) T.win.click(rain); const st = T.win.widgets.find((x) => x.key === 'chip|storybook|1'); if (st) T.win.click(st); } catch (e) {}  w.menu.close(); await window.__qa.wait(0.5);`);

    // ------------------------------------------------------------------ C. weapons: summon from the panel, create by API, grab, swing at a dummy
    const sw = await t.run(`
      const w = window.game.world, T = w.menu._t, qa = window.__qa, qh = window.__qh, r = {};
      w.menu.open('summon'); await qa.wait(0.5);
      const find = (pred) => T.win.widgets.find(pred);
      await qh.realClick(T.win, find((x) => x.key === 'chip|weapons|1')); await qa.wait(0.3);
      const tile = find((x) => x.type === 'tile' && x.key === 'tile|sword|1');
      if (!tile) return { err: 'no sword tile' };
      await qh.realClick(T.win, tile); await qa.wait(0.4);
      const btn = find((x) => x.type === 'button' && /summon here/i.test(x.label || ''));
      if (!btn) return { err: 'no Summon here button', widgets: T.win.widgets.map((x) => x.label).filter(Boolean) };
      const n0 = w.weapons.list().length;
      await qh.realClick(T.win, btn); await qa.wait(1.2);
      r.weaponsBefore = n0; r.weaponsAfter = w.weapons.list().length; r.summoned = w.menu.summoned();
      w.menu.close(); await qa.wait(0.3);
      return r;`);
    t.data.summonSword = sw;
    t.check('Summon panel: "Summon here" creates a sword', !sw.err && sw.weaponsAfter > sw.weaponsBefore, JSON.stringify(sw), 'P1');
    await t.shot('summoned-sword');

    // create via API in front of the right hand and grab with G... (desktop: right mouse = squeeze of the right hand)
    const grab = await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh, r = {};
      qh.faceForward();
      const hp = g.input.right.position;
      const sword = w.weapons.create(ctx, 'sword', { position: { x: hp.x, y: hp.y, z: hp.z } });
      r.created = !!sword; if (!sword) return r;
      qa.lock(true); r.attempts = 0;
      for (let a = 0; a < 3 && !(w.weapons.held.right); a++) {
        r.attempts++;
        if (a > 0) { qh.mouseUp(2); await qa.wait(0.3); const p = g.input.right.position; try { sword.body.position.set(p.x, p.y, p.z); sword.body.velocity.set(0, 0, 0); } catch {} await qa.waitFrames(2); }
        qh.mouseDown(2); await qa.wait(0.6);
      }
      r.heldAfterGrab = w.weapons.held.right ? w.weapons.held.right.type : null;
      window.__qaSword = sword;
      return r;`);
    t.data.grab = grab;
    t.check('weapons.create returns a weapon', grab.created, JSON.stringify(grab), 'P1');
    t.check('right mouse button grabs a weapon placed at the right hand', grab.heldAfterGrab === 'sword', JSON.stringify(grab), 'P1');
    await t.shot('holding-sword');

    // dummy + swing
    const swing = await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh, r = {};
      const names = w.library.list().map((e) => e.name);
      r.hasDummy = names.includes('training-dummy');
      const h = w.library.spawn(ctx, 'training-dummy', { position: { x: 0, z: -2.2 } });
      r.spawned = !!h; window.__qaDummy = h;
      await qa.wait(1.0);
      r.dummyAt = h && h.objects && h.objects[0] ? h.objects[0].position.toArray().map((n) => +n.toFixed(2)) : null;
      r.heldBeforeSwing = w.weapons.held.right ? w.weapons.held.right.type : null;
      w.player.teleport(0, r.dummyAt ? r.dummyAt[2] + 1.15 : -0.85); await qa.wait(0.6);
      // damageable closest to the dummy position
      const dm = w.kit.nearestTarget ? w.kit.nearestTarget({ x: 0, y: 1, z: -2 }, 3, { faction: 'neutral' }) : null;
      r.dummyHp0 = dm ? dm.hp : null; r.dummyFound = !!dm;
      // swing: yaw sweep with mouse movement while holding the weapon (hand rides with the camera): 8 quick flicks
      let hits = 0; const off = g.events.on('weapon:hit', () => hits++);
      qa.setMode('real'); // swing speed is measured in real frames
      const wp = w.weapons.held.right; r.rows = [];
      const c = dm && dm.center ? dm.center(new g.THREE.Vector3()) : null;
      for (let i = 0; i < 8; i++) {
        qh.aimAt(-0.9, 1.0, window.game.player.head.z - 1.15); await qa.waitFrames(1);
        for (let k = 0; k < 24; k++) { window.dispatchEvent(new MouseEvent('mousemove', { movementX: 40, movementY: 0, bubbles: true })); await qa.waitFrames(1);
          if (i === 0 && wp && wp.cur) { const tip = wp.cur[wp.cur.length - 1]; r.rows.push([k, +(wp.sp || 0).toFixed(1), tip.toArray().map((n) => +n.toFixed(2)).join(','), c ? +tip.distanceTo(c).toFixed(2) : null, (() => { const f = w.kit.nearestTarget(tip, 0.19); return f ? (f.faction + ':' + (f.alive === false ? 'dead' : 'live')) : 'none'; })(), wp.spec && wp.spec.vMin].join('|')); } }
        await qa.waitFrames(2);
      }
      r.weaponHits = hits; r.dummyHp1 = dm ? dm.hp : null;
      qa.setMode('fast'); qh.mouseUp(2); await qa.wait(0.4);
      qh.faceForward(); w.player.teleport(0, 0); await qa.wait(0.5);
      return r;`);
    t.data.swing = swing;
    t.check('library spawns a training dummy', swing.spawned, JSON.stringify(swing), 'P1');
    if (swing.dummyFound) t.check('swinging the held sword at the dummy hurts it', swing.dummyHp1 < swing.dummyHp0 || swing.weaponHits > 0, `hits ${swing.weaponHits}, hp ${swing.dummyHp0} -> ${swing.dummyHp1}`, 'P1');
    else t.note('training dummy damageable not located via kit.nearestTarget; weapon hits counted: ' + swing.weaponHits);
    await t.run(`try { window.__qaDummy.remove(); } catch {} try { window.__qaSword.remove(); } catch {} window.game.world.weapons.list().slice().forEach((x) => { try { x.remove(); } catch {} }); window.game.world.menu.clearSummoned?.(); await window.__qa.wait(0.5);`);

    // ------------------------------------------------------------------ D. three spells
    const spells = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, r = { casts: {} };
      const list = w.spells.list().map((s) => s.id);
      r.all = list.length;
      const casts = []; const off = g.events.on('spell:cast', (e) => casts.push(e.id));
      const pick = ['firebolt', 'force-push', 'frost-lance', 'heal', 'fire-stream'].filter((id) => list.includes(id)).slice(0, 4);
      qh.aimAt(0, 1.0, -9); qa.lock(true);
      for (const id of pick) {
        const sel = w.spells.select(id); await qa.wait(0.2);
        const c0 = casts.length;
        const hold = w.spells.list().find((s) => s.id === id).hold;
        await qh.hold(0, hold ? 1.0 : 0.25);
        await qa.wait(0.8);
        r.casts[id] = { selected: sel, current: w.spells.current() && w.spells.current().id, cast: casts.length - c0 };
      }
      off && off();
      // spell wheel: hold E (right A) 0.4 s then release
      qh.key('keydown', 'KeyE'); await qa.wait(0.5); r.wheelOpen = !!(g.scene.getObjectByName && (g.scene.getObjectByName('spell-wheel') || g.scene.getObjectByName('wheel')));
      qh.key('keyup', 'KeyE'); await qa.wait(0.4);
      r.favourites = w.spells.favourites ? w.spells.favourites() : null;
      return r;`);
    t.data.spells = spells;
    for (const [id, c] of Object.entries(spells.casts)) t.check(`spell ${id}: selectable and casts on mouse click`, c.selected && c.current === id && c.cast >= 1, JSON.stringify(c), 'P1');
    await t.shot('spell-cast');
    // menu capture blocks casting
    const cap = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh;
      let casts = 0; const off = g.events.on('spell:cast', () => casts++);
      w.spells.select('firebolt');
      w.menu.open('summon'); await qa.wait(0.5);
      // aim the mouse at the panel centre and click: the click must go to the menu, not cast
      const T = w.menu._t; const wd = T.win.widgets.find((x) => x.type === 'chip');
      qa.lock(false); const p = qh.widgetScreen(T.win, wd); qh.mouseMove(p.x, p.y); await qa.waitFrames(5);
      const capturing = w.menu.capturing;
      qh.mouseDown(0); await qa.waitFrames(5); qh.mouseUp(0); await qa.waitFrames(5);
      w.menu.close(); await qa.wait(0.3); off();
      return { capturing, casts };`);
    t.data.capture = cap;
    t.check('menu capturing blocks spell casting while the pointer is on a panel', cap.capturing && cap.casts === 0, JSON.stringify(cap), 'P1');

    // ------------------------------------------------------------------ E. fight: 2 goblins + knight
    const fight = await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh, r = {};
      w.player.invulnerable = 0;
      await qa.wait(10); // let projectiles/debris from the spells above expire before taking the baseline
      const kills = []; const off1 = g.events.on('combat:kill', (e) => kills.push({ victim: e.victim && e.victim.name, by: typeof e.by === 'string' ? e.by : (e.by && e.by.name), style: e.style }));
      let ragdolls = 0, severs = 0; const off2 = g.events.on('actor:ragdoll', () => ragdolls++); const off3 = g.events.on('limb:severed', () => severs++);
      const base = qh.snap();
      const gob = w.library.spawn(ctx, 'goblin', { count: 2, position: { x: 0, z: -9 }, spread: 3 });
      const knight = w.library.spawn(ctx, 'knight', { position: { x: -2, z: -4 } });
      r.spawned = { goblins: !!gob, knight: !!knight, fighters: gob ? gob.fighters.length : 0 };
      await qa.wait(1.0);
      r.combatAfterSpawn = w.combat.stats();
      w.spells.select('firebolt');
      qa.lock(true);
      // kill the goblins by casting at them (re-aim each shot); fall back to nothing: we want the real path
      let shots = 0;
      for (let step = 0; step < 90 && gob.fighters.some((f) => f.alive); step++) {
        const f = gob.fighters.find((x) => x.alive); if (!f) break;
        const p = f.actor.group.position; qh.aimAt(p.x, p.y + 1.0, p.z);
        await qh.hold(0, 0.15); shots++;
        await qa.wait(0.45);
      }
      r.shots = shots; r.goblinsAlive = gob.fighters.filter((f) => f.alive).length;
      await qa.wait(1.5);
      r.kills = kills; r.ragdolls = ragdolls; r.severs = severs; r.kitAfterKill = { ragdolls: w.kit.stats().ragdolls, parts: w.kit.stats().parts, actors: w.kit.stats().actors };
      r.playerHp = w.player.health; r.knightAlive = knight.fighters ? knight.fighters.some((f) => f.alive) : null;
      window.__qaFight = { gob, knight, base };
      off1(); off2(); off3();
      return r;`);
    t.data.fight = fight;
    t.check('library spawns 2 goblins and a knight', fight.spawned.goblins && fight.spawned.knight && fight.spawned.fighters === 2, JSON.stringify(fight.spawned), 'P1');
    t.check('goblins can be killed with a spell (kill event emitted)', fight.goblinsAlive === 0 && fight.kills.length >= 2, `alive ${fight.goblinsAlive}, kills ${JSON.stringify(fight.kills)}, shots ${fight.shots}`, 'P1');
    t.check('a death style appears (ragdoll / gore parts)', fight.ragdolls > 0 || fight.severs > 0 || (fight.kills.some((k) => k.style)), JSON.stringify({ ragdolls: fight.ragdolls, severs: fight.severs, kit: fight.kitAfterKill, styles: fight.kills.map((k) => k.style) }), 'P1');
    await t.shot('fight-aftermath');

    // corpses clean up: wait ~16 game seconds, then registries must drop
    const clean = await t.run(`
      const w = window.game.world, qa = window.__qa, qh = window.__qh, { gob, knight, base } = window.__qaFight;
      await qa.wait(18);
      const snap = qh.snap();
      const out = { diff: qh.diff(base, snap), kit: w.kit.stats() };
      try { gob.remove(); } catch {}
      await qa.wait(2);
      out.afterRemoveGoblins = qh.diff(base, qh.snap());
      try { knight.remove(); } catch {}
      await qa.wait(2);
      out.afterAll = qh.diff(base, qh.snap());
      // goblins drop loose weapons (pickups owned by this ctx): pick them up = remove, then compare again
      const drops = w.weapons.list().map((x) => x.type);
      out.looseWeapons = drops;
      w.weapons.list().slice().forEach((x) => { try { x.remove(); } catch {} });
      await qa.wait(1.5);
      out.afterDrops = qh.diff(base, qh.snap());
      out.rootChildren = window.__qaCtx.root.children.map((c) => (c.name || c.type) + (c.isPoints ? '(points)' : c.isMesh ? '(mesh)' : ''));
      return out;`);
    t.data.cleanup = clean;
    const leftover = Object.entries(clean.afterDrops).filter(([k, v]) => !/scene_|kit_lights|kit_particleSystems/.test(k) && v > 0);
    t.check('after the fight, removal and dropped loot the registries return to baseline', leftover.length === 0, JSON.stringify(clean.afterDrops), 'P1');
    t.check('particle systems/objects made for the fight do not accumulate under the creation root', (clean.afterDrops.kit_particleSystems ?? 0) <= 2, `kit_particleSystems +${clean.afterDrops.kit_particleSystems}, scene_objects +${clean.afterDrops.scene_objects}; root children left: ${clean.rootChildren.join(', ')}`, 'P2');

    // damage, death, respawn: real enemies hurt the player, then lethal damage
    const dmg = await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh, r = {};
      w.player.invulnerable = 0; w.player.heal(1000);
      const events = []; const offs = ['player:hurt', 'player:died', 'player:respawn'].map((n) => g.events.on(n, () => events.push(n)));
      qh.faceForward();
      const gob = w.library.spawn(ctx, 'goblin', { position: { x: 0, z: -2.5 }, hp: 200 });
      const hp0 = w.player.health;
      for (let i = 0; i < 60 && w.player.health >= hp0; i++) await qa.wait(0.5);
      r.hurtByGoblin = hp0 - w.player.health; r.hpAfterHit = w.player.health;
      try { gob.remove(); } catch {}
      // lethal
      w.player.invulnerable = 0;
      w.player.damage(500, { from: 'enemy', point: { x: 0, y: 1, z: -3 } });
      await qa.wait(0.5); r.alive0 = w.player.alive; r.hpDead = w.player.health;
      await qa.wait(4.5);
      r.respawned = w.player.alive; r.hpRespawn = w.player.health; r.posAfter = [g.rig.position.x, g.rig.position.z];
      r.events = events; offs.forEach((o) => o());
      return r;`);
    t.data.damage = dmg;
    t.check('enemy goblin damages the player (player:hurt)', dmg.hurtByGoblin > 0 && dmg.events.includes('player:hurt'), JSON.stringify(dmg), 'P1');
    t.check('lethal damage kills the player (player:died)', dmg.alive0 === false && dmg.events.includes('player:died'), JSON.stringify(dmg), 'P1');
    t.check('player respawns with full health near the origin', dmg.respawned === true && dmg.hpRespawn >= 99 && Math.hypot(...dmg.posAfter) < 3 && dmg.events.includes('player:respawn'), JSON.stringify(dmg), 'P1');
    await t.shot('after-respawn');

    // ------------------------------------------------------------------ F. quests: tracker, first quest advances from a typed wish (client side), save + reload
    const q0 = await t.run(`
      const w = window.game.world;
      return { active: JSON.parse(JSON.stringify(w.quests.active())), profile: { level: w.quests.profile().level, xp: w.quests.profile().xp }, mode: w.quests.mode, ready: w.quests.ready };`);
    t.data.quest0 = q0;
    t.check('quests are ready and the first quest "The Voice Above" is active', q0.ready && q0.active && q0.active.id === 'awaken', JSON.stringify(q0).slice(0, 300), 'P1');
    await t.run(`window.game.world.menu.open('quests'); await window.__qa.wait(0.8);`);
    await t.shot('quests-panel');
    await t.run(`window.game.world.menu.close(); await window.__qa.wait(0.3);`);
    // typed wish: Enter in the #chat box. The utterance goes through voice.js, which builds the request context (quests counts a wish there).
    const typed = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa;
      const chat = document.getElementById('chat'); const r = { hasChat: !!chat };
      const b0 = qa.blocked.length;
      chat.focus(); chat.value = 'hello Omnissiah, QA test'; chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      await qa.wait(1.5);
      r.blocked = qa.blocked.slice(b0).map((b) => ({ type: b.type, preview: b.preview.slice(0, 400) }));
      const q = w.quests.get('awaken');
      r.state = q && q.state; r.progress = q && q.progress;
      chat.blur();
      return r;`);
    t.data.typed = typed;
    const utt = typed.blocked.find((b) => b.type === 'utterance_text');
    t.check('typing in the chat box produces an utterance_text message (dropped by harness, not sent)', !!utt, JSON.stringify(typed).slice(0, 500), 'P1');
    if (utt) {
      const ctxHas = ['player', 'aimPoint', 'modules'].filter((k) => utt.preview.includes(`"${k}"`));
      t.check('utterance context carries player/aimPoint/modules', ctxHas.length === 3, utt.preview, 'P2');
    }
    t.check('the first quest advances/completes after the first wish', typed.state === 'completed' || (typed.progress ?? 0) >= 1, JSON.stringify(typed), 'P1');
    await t.run('await window.__qa.wait(1.5)');
    await t.shot('quest-banner');
    // more real progress: a summon via library and a cast, for the stats that get saved
    await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa;
      const h = w.library.spawn(ctx, 'dog', { position: { x: 3, z: -6 } }); await qa.wait(1); try { h.remove(); } catch {}
      window.__qh.aimAt(0, 1, -9); await window.__qh.hold(0, 0.2); await qa.wait(1);`);
    const before = await t.run(`const p = window.game.world.quests.profile(); window.game.world.quests.saveNow && window.game.world.quests.saveNow(); await window.__qa.wait(1.5); return { level: p.level, xp: p.xp, summoned: p.stats.summoned, spellCasts: p.stats.spellCasts, wishes: p.stats.wishes, active: (window.game.world.quests.list({ state: 'completed' }) || []).map((q) => q.id) };`);
    await t.wait(1800); // server debounce is 400 ms
    const file = readSave('profile');
    t.data.saveFile = file ? { level: file.level, xp: file.xp, keys: Object.keys(file).slice(0, 14) } : null;
    t.check('a save file is written under saves/profile.json', !!file, `no file in ${savesDir()}: ${fs.existsSync(savesDir()) ? fs.readdirSync(savesDir()).join(',') : 'dir missing'}`, 'P1');
    t.check('the save contains the progress made (xp, stats)', !!file && file.xp === before.xp && (file.stats?.summoned ?? 0) >= 1, JSON.stringify({ file: file && { xp: file.xp, summoned: file.stats?.summoned }, before }), 'P1');
    // reload the page: progress restored
    const m2 = t.mark();
    await t.load({ intro: 'keep' });
    await t.run('await window.__qa.wait(8)');   // long enough for the awakening to start if it were going to (3 s)
    const returning = await t.run(`const w = window.game.world, o = window.game.scene.getObjectByName('module:core/oracle.js'); return { running: w.intro.running, done: w.intro.done, oracleVisible: o ? o.visible : null, panel: w.menu.panel };`);
    t.check('a returning player (reload) does not get the awakening again and no welcome card', !returning.running && returning.done && returning.oracleVisible !== false && returning.panel !== 'welcome', JSON.stringify(returning), 'P1');
    const after = await t.run(`const w = window.game.world, p = w.quests.profile(); return { level: p.level, xp: p.xp, summoned: p.stats.summoned, wishes: p.stats.wishes, completed: (w.quests.list({ state: 'completed' }) || []).map((q) => q.id), active: JSON.parse(JSON.stringify(w.quests.active())) && w.quests.active().id, mode: w.quests.mode };`);
    t.data.afterReload = { before, after };
    t.check('reload restores level / xp / stats from the save', after.xp === before.xp && after.level === before.level && after.summoned >= before.summoned, JSON.stringify({ before, after }), 'P1');
    t.check('reload restores completed quests (no duplicate first quest)', after.completed.includes('awaken') === before.active.includes('awaken'), JSON.stringify({ before: before.active, after: after.completed }), 'P1');
    const e2 = t.errorsSince(m2);
    if (e2.length) t.check('no console errors during reload', false, e2.map((e) => e.text.slice(0, 200)).join('\n'), 'P1');
    await t.shot('after-reload');

    // ------------------------------------------------------------------ G. travel: cached place and home
    const trav = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, r = {};
      qh.faceForward(); w.player.invulnerable = Infinity;
      r.list = w.travel.list().map((p) => p.slug);
      const snap0 = qh.envJson();
      const events = []; const offs = ['travel:start', 'travel:arrive', 'travel:home'].map((n) => g.events.on(n, () => events.push(n)));
      const h = w.travel.go('volcanic island');
      r.handle = !!h; r.state0 = h && h.state;
      for (let i = 0; i < 160 && !(h && (h.state === 'arrived' || h.state === 'failed')); i++) { await qa.wait(0.5); await new Promise((r) => setTimeout(r, 30)); }
      r.state = h && h.state; r.current = w.travel.current && w.travel.current.name;
      await qa.wait(1.5);
      r.gh = w.groundHeight(0, 0);
      // a body dropped on the new ground rests on it
      const ctx = window.__qaCtx, THREE = g.THREE;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0xff8800 })); mesh.position.set(2, w.groundHeight(2, -2) + 6, -2);
      const body = w.kit.body(ctx, mesh, { shape: 'box', size: [0.4, 0.4, 0.4], mass: 1 });
      await qa.wait(4);
      r.bodyY = body ? body.position.y : null; r.groundUnderBody = w.groundHeight(2, -2);
      window.__qaTravelBody = body; window.__qaTravel = { snap0 };
      r.events = events; offs.forEach((o) => o());
      return r;`, { timeout: 300000 });
    t.data.travel = trav;
    t.check('travel.go(cached place) starts and arrives', trav.handle && trav.state === 'arrived', JSON.stringify(trav), 'P1');
    t.check('a dropped body rests on the travelled ground (physics terrain rebuilt)', trav.bodyY != null && Math.abs(trav.bodyY - (trav.groundUnderBody + 0.2)) < 0.6, `bodyY ${trav.bodyY} ground ${trav.groundUnderBody}`, 'P1');
    await t.wait(3000); await t.run('await window.__qa.wait(1)'); // let the panorama texture decode (real time)
    await t.shot('place-volcanic-island');
    const home = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh, r = {};
      try { window.__qaTravelBody && window.__qaTravelBody.remove(); } catch {}
      const events = []; const offs = ['travel:home'].map((n) => g.events.on(n, () => events.push(n)));
      const hh = w.travel.home();
      for (let i = 0; i < 120 && !(hh.state === 'arrived' || hh.state === 'failed'); i++) { await qa.wait(0.5); await new Promise((r) => setTimeout(r, 30)); }
      r.homeState = hh.state;
      for (let i = 0; i < 60 && w.env.terrainBusy; i++) { await qa.wait(0.3); await new Promise((r) => setTimeout(r, 30)); }
      await qa.wait(2);
      r.away = w.travel.away; r.current = w.travel.current;
      r.envDiff = qh.envDiff(window.__qaTravel.snap0, qh.envJson());
      const ctx = window.__qaCtx, THREE = g.THREE;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0x00aaff })); mesh.position.set(1, w.groundHeight(1, -2) + 5, -2);
      const body = w.kit.body(ctx, mesh, { shape: 'box', size: [0.4, 0.4, 0.4], mass: 1 });
      await qa.wait(4);
      r.bodyY = body ? body.position.y : null; r.ground = w.groundHeight(1, -2);
      try { body.remove(); } catch {}
      r.events = events; offs.forEach((o) => o());
      return r;`, { timeout: 300000 });
    t.data.home = home;
    t.check('travel.home() returns to the field (not away, no current place)', !home.away && !home.current, JSON.stringify(home), 'P1');
    t.check('world.env is restored after returning home', home.envDiff.length === 0, 'env keys differing: ' + home.envDiff.join(','), 'P2');
    t.check('a body dropped after returning home rests on the field', home.bodyY != null && Math.abs(home.bodyY - (home.ground + 0.2)) < 0.6, `bodyY ${home.bodyY} ground ${home.ground}`, 'P1');
    await t.shot('home-again');

    // ------------------------------------------------------------------ G2. level-5 perk "sturdier allies" (quests.boostAllies) with a live ally
    const perk = await t.run(`
      const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, r = {};
      const logs = []; const origErr = console.error; console.error = (...a) => { logs.push(a.map(String).join(' ').slice(0, 200)); origErr.apply(console, a); };
      w.quests.grantXp(3000, 'qa'); await qa.wait(1);
      r.level = w.quests.profile().level; r.allyHpMul = w.quests.profile().perks.allyHpMul;
      const h = w.library.spawn(ctx, 'knight', { position: { x: -2, z: -5 } });
      await qa.wait(6);
      const rec = g.modules.get('core/quests.js');
      r.questsUpdateAlive = !!(rec && rec.instance && rec.instance.update);
      r.hp = h && h.fighters && h.fighters[0] ? [h.fighters[0].hp, h.fighters[0].maxHp] : null;
      try { h && h.remove(); } catch {}
      console.error = origErr; r.logs = logs;
      return r;`);
    t.data.perk = perk;
    t.check('level-5 "sturdier allies" perk works with a live ally (quests.js boostAllies must not throw / disable quests update)', perk.level >= 5 && perk.questsUpdateAlive, JSON.stringify(perk), 'P1');

    // ------------------------------------------------------------------ H. wrap-up
    const errs = t.errorsSince(mark0).filter((e) => !/Microphone|favicon/.test(e.text));
    const dis = errs.filter((e) => /\[module .*\] (update|load):/.test(e.text));
    t.check('no module was unloaded or had update() disabled during the session', dis.length === 0, dis.map((e) => e.text.slice(0, 220)).join('\n'), 'P0');
    const bad = await t.compileAndCheck();
    t.check('no broken shader programs after the session', bad.length === 0, JSON.stringify(bad).slice(0, 600), 'P0');
    t.data.finalPerf = await t.perfStats();
  },
};










