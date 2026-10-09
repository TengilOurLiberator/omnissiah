// 13. The awakening's other paths: skipping half-way (cleanup, flag, quests resume), a player coming back from another browser (localStorage empty,
//     the saved profile says "seen"), replaying it from the menu API and ending it by saying "skip".
import { readSave } from '../lib/sandbox.mjs';

export default {
  id: 13, name: 'intro', tiers: ['pc', 'quest'], timeout: 900000,
  async run(t) {
    const mark0 = t.mark();
    // ---- A. new player, skip when the training dummy is standing (gift, altar, dummy all exist)
    await t.load({ intro: 'new' });
    await t.run('window.__qh.faceForward();');
    const started = await t.run('return await window.__qh.waitIntroStart(40);');
    t.check('new player: the awakening starts by itself', started === true, String(started), 'P1');
    const base = await t.run('return window.__qh.snap();');
    const part = await t.run(`return await window.__qh.playIntro({ maxGame: 400, stopAt: 'strike the dummy' });`, { timeout: 600000 });
    t.data.part = part;
    t.check('the bot reaches the dummy step (look, talk, gift taken)', !!part.stoppedAt, JSON.stringify(part).slice(0, 500), 'P1');
    const mid = await t.run(`
      const w = window.game.world, qh = window.__qh;
      const snap = qh.snap();
      return { snap, weapons: w.weapons.list().length, intro: { running: w.intro.running, done: w.intro.done } };`);
    t.check('mid-way the intro has put things in the field (dummy / altar / gift)', mid.snap.kit_actors + mid.snap.kit_damageables + mid.weapons > base.kit_actors + base.kit_damageables, JSON.stringify({ base, mid }).slice(0, 600), 'P2');
    await t.shot('intro-at-dummy');
    const sk = await t.run('return await window.__qh.skipIntro();');
    t.data.skip = sk;
    t.check('world.intro.skip() ends the awakening at once', sk.wasRunning && sk.skipReturned === true && !sk.running && sk.done, JSON.stringify(sk), 'P1');
    const post = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa, qh = window.__qh; const r = {};
      await qa.wait(6);
      const o = g.scene.getObjectByName('module:core/oracle.js');
      r.oracleVisible = o ? o.visible : null;
      r.flag = w.quests.stat('campaign.intro'); r.ls = localStorage.getItem('omnissiah.intro.v1');
      r.panel = w.menu.panel;
      r.diff = qh.diff(base0, qh.snap());
      let active = null;
      for (let i = 0; i < 160 && !active; i++) { await qa.wait(0.5); const a = w.quests.active(); active = a ? a.id : null; }
      r.firstQuest = active;
      return r;`.replace('base0', JSON.stringify(base)), { timeout: 300000 });
    t.data.post = post;
    t.check('after a skip: seen flag is 2 (stat and localStorage), the Omnissiah is visible, no welcome card', post.flag === 2 && post.ls === '2' && post.oracleVisible !== false && post.panel !== 'welcome', JSON.stringify(post), 'P1');
    const leaks = Object.entries(post.diff).filter(([k, v]) => /^(kit_actors|kit_damageables|kit_destructibles|combat_fighters|combat_reserves)$/.test(k) && v > 0);
    t.check('after a skip: the intro\'s dummy, ally and foes are gone (actors / damageables / fighters back to the start)', leaks.length === 0, JSON.stringify(post.diff), 'P1');
    t.check('after a skip: the first quest starts by itself', post.firstQuest === 'awaken', JSON.stringify(post), 'P1');
    await t.run(`const w = window.game.world; w.weapons.list().slice().forEach((x) => { try { x.remove(); } catch {} }); w.quests.saveNow && w.quests.saveNow(); await window.__qa.wait(1.5);`);
    await t.wait(1800);
    const file = readSave('profile');
    t.check('the skip was saved in the profile (stats.campaign.intro = 2)', !!file && JSON.stringify(file).includes('"intro":2'), file ? 'profile saved but no "intro":2 in it: ' + JSON.stringify(file.stats ?? file).slice(0, 300) : 'no profile.json written', 'P1');

    // ---- B. the same player from another browser: localStorage empty, the server-side profile says seen
    await t.load({ intro: 'new' });
    const other = await t.run(`
      const g = window.game, w = g.world; await window.__qa.wait(10);
      const o = g.scene.getObjectByName('module:core/oracle.js');
      return { running: w.intro.running, done: w.intro.done, oracleVisible: o ? o.visible : null, flag: w.quests.stat('campaign.intro'), ls: localStorage.getItem('omnissiah.intro.v1'), panel: w.menu.panel };`);
    t.data.otherBrowser = other;
    t.check('profile from another browser (empty localStorage): no awakening, the saved profile is the truth', !other.running && other.done && other.flag === 2 && other.oracleVisible !== false, JSON.stringify(other), 'P1');

    // ---- C. replay from the API, end it by saying "skip"
    const rp = await t.run(`
      const g = window.game, w = g.world, qa = window.__qa; const r = {};
      r.play = w.intro.play({ replay: true });
      await qa.wait(6);
      r.runningBefore = w.intro.running;
      g.events.emit('net:transcript', { text: 'please skip the intro' });
      await qa.wait(1);
      r.runningAfter = w.intro.running;
      const o = g.scene.getObjectByName('module:core/oracle.js');
      r.oracleVisible = o ? o.visible : null;
      r.second = w.intro.play({ replay: true }); w.intro.skip(); await qa.wait(1);
      return r;`);
    t.data.replay = rp;
    t.check('intro.play({ replay }) starts it again for a player who has seen it, and saying "skip" ends it', rp.play === true && rp.runningBefore === true && rp.runningAfter === false && rp.oracleVisible !== false, JSON.stringify(rp), 'P1');

    const errs = t.errorsSince(mark0).filter((e) => !/Microphone|favicon/.test(e.text));
    t.check('no console errors during the intro paths', errs.length === 0, errs.slice(0, 6).map((e) => e.text.slice(0, 220)).join('\n'), 'P1');
    const bad = await t.compileAndCheck();
    t.check('no broken shader programs after the intro paths', bad.length === 0, JSON.stringify(bad).slice(0, 500), 'P0');
  },
};
