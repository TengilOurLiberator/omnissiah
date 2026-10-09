// 1. Boot: every manifest module loads; no failed/disabled modules; zero console errors / broken shaders; services; idle draw cost.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/server.mjs';

export default {
  id: 1, name: 'boot', tiers: ['pc', 'quest'], timeout: 600000,
  async run(t) {
    const mark = t.mark();
    await t.load();
    await t.step(3);
    await t.run('window.__qh.faceForward()');
    await t.shot('spawn-forward');     // real rendering happens here (also compiles every visible material)
    await t.run('window.game.camera.rotation.x = 0.62; await window.__qa.waitFrames(2)');
    await t.shot('spawn-looking-up-at-omnissiah');
    await t.run('window.__qh.faceForward()');
    await t.step(1);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/game/manifest.json'), 'utf8')).core;
    const existing = manifest.filter((p) => fs.existsSync(path.join(ROOT, 'public/game', p)));
    const missing = manifest.filter((p) => !existing.includes(p));
    if (missing.length) t.note(`manifest entries without a file (skipped by the server): ${missing.join(', ')}`);
    const mods = await t.moduleReport();
    t.data.modules = mods;
    const loaded = new Set(mods.map((m) => m.path));
    t.check('every existing manifest module is loaded', existing.every((p) => loaded.has(p)), 'not loaded: ' + existing.filter((p) => !loaded.has(p)).join(', '), 'P0');
    const failed = mods.filter((m) => m.failed);
    t.check('no failed modules', failed.length === 0, 'failed: ' + failed.map((m) => m.path).join(', '), 'P0');
    t.data.noUpdate = mods.filter((m) => !m.failed && m.hasInstance && !m.hasUpdate).map((m) => m.path);
    const updErr = t.errorsSince(mark).filter((e) => /\[module .*\] update:/.test(e.text));
    t.check('no module update() was disabled by an exception', updErr.length === 0, updErr.map((e) => e.text.slice(0, 200)).join(' | '), 'P0');

    const errs = t.errorsSince(mark);
    t.check('zero console errors at idle', errs.length === 0, errs.slice(0, 6).map((e) => e.text.slice(0, 220)).join('\n'), 'P1');
    const warns = t.s.console.slice(mark.c).filter((e) => e.kind === 'warning' || e.kind === 'log-warning');
    if (warns.length) t.note(`${warns.length} console warnings, e.g. ${[...new Set(warns.map((w) => w.text.slice(0, 150)))].slice(0, 4).join(' | ')}`);
    const net = t.netSince(mark);
    t.check('no failed/404 network requests', net.length === 0, JSON.stringify(net.slice(0, 6)), 'P2');
    const fav = t.s.network.some((n) => /favicon/.test(n.url ?? ''));
    t.check('favicon is served', !fav, 'GET /favicon.ico -> 404 (public/ has no favicon; add <link rel="icon"> or a file)', 'P2');
    let bad = await t.brokenPrograms();
    bad = bad.concat(await t.compileAndCheck());
    t.check('no broken shader programs', bad.length === 0, JSON.stringify(bad).slice(0, 900), 'P0');
    const svc = await t.services();
    t.data.services = svc;
    const expectSvc = ['groundHeight', 'oracle', 'spells', 'kit', 'models', 'combat', 'weapons', 'library', 'physics', 'audio', 'voices', 'menu', 'quests', 'perf', 'style', 'player', 'env', 'travel', 'commentary'];
    const missingSvc = expectSvc.filter((s) => !svc.includes(s));
    t.check('expected services present on world', missingSvc.length === 0, 'missing: ' + missingSvc.join(', ') + ' | have: ' + svc.join(','), 'P1');
    t.note('world services: ' + svc.join(', '));
    const info = await t.rendererInfo();
    t.data.idleRender = info;
    t.note(`idle scene render: ${info.calls} draw calls, ${info.triangles} triangles, ${info.geometries} geometries, ${info.textures} textures, ${info.programs} programs`);
    t.data.perf = await t.perfStats();
    t.data.pixels = await t.pixelStats();
    t.check('frame is not black / blown out', t.data.pixels.avg > 15 && t.data.pixels.avg < 235 && t.data.pixels.dark < 90, JSON.stringify(t.data.pixels), 'P1');
    t.data.blocked = await t.eval('__qa.blocked.map(b => b.type)');
    t.data.fastFps = await t.eval(`(async () => { const f0 = __qa.frames, t0 = performance.now(); await new Promise(r => setTimeout(r, 3000)); return (__qa.frames - f0) / ((performance.now() - t0) / 1000); })()`);
    t.note(`no-render fast-mode frame rate ~ ${t.data.fastFps.toFixed(0)} fps (game logic only)`);
    const hot = [...(await t.moduleReport())].sort((a, b) => b.ms - a.ms).slice(0, 6).map((m) => `${m.path} ${m.ms}ms`);
    t.note('top module update ms (fast mode): ' + hot.join(', '));
  },
};

