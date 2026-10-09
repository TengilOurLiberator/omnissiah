// 14. Surfaces added in wave 3, each checked without a headset or any generation:
//     - core/blast.js is inert at load (no 'blast' message, no run, no scene objects) and blast.list() returns the cached scenes
//     - the spell wheel categories (world.spells.list() entries carry `category`)
//     - the big ENTER VR element exists only when navigator.xr.isSessionSupported('immersive-vr') resolves true (navigator.xr is mocked)
//     - window.game.voice exposes setOpenMic (hands-free "Omnissiah, ..." switch)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/server.mjs';

const CATS = ['offence', 'control', 'movement', 'defence', 'summon', 'utility'];

export default {
  id: 14, name: 'wave3', tiers: ['pc', 'quest'], timeout: 600000,
  async run(t) {
    const mark0 = t.mark();
    // ------------------------------------------------------------------ blast
    await t.load();
    await t.run('await window.__qa.wait(5);');
    const inert = await t.run(`
      const g = window.game, w = g.world; const r = {};
      r.hasBlast = !!w.blast; r.current = w.blast ? w.blast.current : 'n/a'; r.active = w.blast ? w.blast.active : 'n/a';
      r.blockedTypes = window.__qa.blocked.map((b) => b.type); r.sentTypes = window.__qa.sent.map((b) => b.type);
      const root = g.scene.getObjectByName('module:core/blast.js');     // the module's own (empty) root group
      r.rootChildren = root ? root.children.map((o) => o.name || o.type) : [];
      r.stray = [...g.scene.children].filter((o) => /blast/i.test(o.name || '') && o !== root).map((o) => o.name);
      r.rootFound = !!root;
      r.state = w.blast ? Object.keys(w.blast).sort() : [];
      return r;`);
    t.data.blastInert = inert;
    t.check('blast service is provided', inert.hasBlast, JSON.stringify(inert), 'P1');
    t.check('blast is inert at load: no run, nothing sent to the blast pipeline', inert.current === null && inert.active === null && ![...inert.blockedTypes, ...inert.sentTypes].some((x) => /^blast(_get|$)/.test(x)), JSON.stringify(inert), 'P1');
    t.check('blast is inert at load: its scene root is empty (no vision, props or sounds)', inert.rootChildren.length === 0 && inert.stray.length === 0, JSON.stringify(inert), 'P2');
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/generated/blasts/index.json'), 'utf8'));
    const slugs = Object.keys(idx).sort();
    const listed = await t.run(`
      const w = window.game.world; const r = {};
      const first = w.blast.list();
      r.firstIsArray = Array.isArray(first); r.firstLen = first.length;
      const fresh = await w.blast.list();       // awaitable: reads the cache fresh
      r.fresh = fresh.map((b) => ({ slug: b.slug, name: b.name, thumb: b.thumb, objects: b.objects }));
      r.afterLen = w.blast.list().length;
      return r;`);
    t.data.blastList = { slugs, listed };
    t.check('await blast.list() returns exactly the cached scenes of assets/generated/blasts/index.json', JSON.stringify(listed.fresh.map((b) => b.slug).sort()) === JSON.stringify(slugs) && slugs.length > 0, `index: ${slugs.join(',')} | listed: ${listed.fresh.map((b) => b.slug).join(',')}`, 'P1');
    t.check('the synchronous blast.list() is filled once the cache has been read', listed.afterLen === slugs.length, JSON.stringify({ firstLen: listed.firstLen, afterLen: listed.afterLen, expected: slugs.length }), 'P2');
    if (listed.firstLen !== slugs.length) t.note(`blast.list() called right after load returns ${listed.firstLen} entries synchronously (the cache is read in the background); await it for the full list`);
    t.check('the cached scenes carry names', listed.fresh.every((b) => b.name), JSON.stringify(listed.fresh), 'P3');

    // ------------------------------------------------------------------ spell wheel categories
    const sp = await t.run(`
      const w = window.game.world; const list = w.spells.list();
      const cats = {}; for (const s of list) cats[s.category] = (cats[s.category] || 0) + 1;
      return { n: list.length, cats, missing: list.filter((s) => !s.category).map((s) => s.id), unknown: list.filter((s) => s.category && !${JSON.stringify(CATS)}.includes(s.category)).map((s) => s.id + ':' + s.category) };`);
    t.data.spellCats = sp;
    t.check('every spell in world.spells.list() has a category', sp.n > 0 && sp.missing.length === 0, JSON.stringify(sp), 'P1');
    t.check('all categories are wheel groups (offence/control/movement/defence/summon/utility)', sp.unknown.length === 0, JSON.stringify(sp.unknown), 'P1');
    t.check('there are 40 starter spells spread over the groups', sp.n >= 40 && Object.keys(sp.cats).length >= 5, JSON.stringify(sp), 'P2');

    // ------------------------------------------------------------------ voice
    const vc = await t.run(`
      const v = window.game.voice; const r = { exists: !!v };
      if (!v) return r;
      r.hasSetOpenMic = typeof v.setOpenMic === 'function'; r.hasGetter = 'openMic' in v; r.before = v.openMic;
      r.off = v.setOpenMic(false); r.afterOff = v.openMic; r.lsOff = localStorage.getItem('omnissiah.openmic');
      r.on = v.setOpenMic(true); r.afterOn = v.openMic; r.lsOn = localStorage.getItem('omnissiah.openmic');
      r.styles = v.styles;
      return r;`);
    t.data.voice = vc;
    t.check('window.game.voice exposes setOpenMic (and it switches and persists)', vc.exists && vc.hasSetOpenMic && vc.off === false && vc.afterOff === false && vc.lsOff === '0' && vc.on === true && vc.afterOn === true && vc.lsOn === '1', JSON.stringify(vc), 'P1');

    // ------------------------------------------------------------------ ENTER VR (navigator.xr mocked before the page scripts run)
    const bigEnter = `(() => { const d = [...document.querySelectorAll('body > div')].find((e) => /^ENTER VR/.test(e.textContent) && getComputedStyle(e).position === 'fixed'); return d ? { text: d.textContent, top: d.getBoundingClientRect().top, visible: getComputedStyle(d).display !== 'none' } : null; })()`;
    const xr = {};
    for (const mode of ['yes', 'no', 'none']) {
      await t.loadLite({ query: mode === 'none' ? '' : `qaxr=${mode}` });
      xr[mode] = await t.page.eval(`(() => ({ big: ${bigEnter}, xrObject: !!navigator.xr, small: !!document.getElementById('VRButton'), smallText: (document.getElementById('VRButton') || {}).textContent || null }))()`);
    }
    t.data.xr = xr;
    t.check('immersive-vr supported (mock): the big ENTER VR element exists, visible, at the top', !!xr.yes.big && xr.yes.big.visible && /press V/.test(xr.yes.big.text), JSON.stringify(xr.yes), 'P1');
    t.check('immersive-vr NOT supported (mock): there is no big ENTER VR element', xr.no.big === null, JSON.stringify(xr.no), 'P1');
    t.check('no WebXR at all (plain headless): there is no big ENTER VR element', xr.none.big === null, JSON.stringify(xr.none), 'P2');
    // pressing V (and clicking it) asks for an immersive-vr session; when the PC never gets an answer the page says why after ~5 s
    await t.loadLite({ query: 'qaxr=pending' });
    const press = await t.page.eval(`(async () => {
      const r = {};
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true }));
      await new Promise((res) => setTimeout(res, 400));
      r.callsAfterV = window.__qa.xr.calls.slice();
      r.statusEarly = (document.getElementById('xr-status') || {}).textContent || null;
      await new Promise((res) => setTimeout(res, 5600));
      r.status = (document.getElementById('xr-status') || {}).textContent || null;
      const d = [...document.querySelectorAll('body > div')].find((e) => /^ENTER VR/.test(e.textContent));
      d && d.click(); await new Promise((res) => setTimeout(res, 300));
      r.callsAfterClick = window.__qa.xr.calls.length;
      return r;
    })()`, { timeout: 60000 });
    t.data.xrPress = press;
    t.check('pressing V requests an immersive-vr session', press.callsAfterV.includes('immersive-vr'), JSON.stringify(press), 'P1');
    t.check('the page says "The PC cannot see the headset ... Meta Link" when the session never answers', /cannot see the headset/.test(press.status || '') && /Meta Link/.test(press.status || ''), JSON.stringify(press), 'P1');
    // rejected request: the reason is shown
    await t.loadLite({ query: 'qaxr=yes' });
    const rej = await t.page.eval(`(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })); await new Promise((res) => setTimeout(res, 600)); return { status: (document.getElementById('xr-status') || {}).textContent || null, calls: window.__qa.xr.calls.slice() }; })()`);
    t.data.xrReject = rej;
    t.check('a rejected session request is explained on the page', /Could not enter immersive-vr/.test(rej.status || ''), JSON.stringify(rej), 'P2');

    const errs = t.errorsSince(mark0).filter((e) => !/Microphone|favicon|qa mock|NotSupportedError|session request already pending/.test(e.text));
    t.check('no console errors in the wave-3 surface checks (mock rejections excluded)', errs.length === 0, errs.slice(0, 6).map((e) => e.text.slice(0, 220)).join('\n'), 'P1');
  },
};
