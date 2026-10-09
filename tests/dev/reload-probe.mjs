// Dev helper: spawn a small scene, rewrite one core module, show what changed. node tests/dev/reload-probe.mjs <pc|quest> <core/x.js> [entry,entry...]
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ROOT } from '../lib/server.mjs';
import { Session, T } from '../lib/harness.mjs';
import { installQaModule } from '../lib/qamod.mjs';
import { createSandbox, destroySandbox, SANDBOX } from '../lib/sandbox.mjs';

const tier = process.argv[2], rel = process.argv[3], entries = (process.argv[4] ?? 'crate-stack,barrel').split(',');
createSandbox(); installQaModule();
const dir = path.join(ROOT, '.cache', 'qa', 'probe');
const server = await startServer({ logFile: path.join(dir, 'server.log'), root: SANDBOX });
const s = new Session({ outDir: dir, tier, edgePort: 9800 + Math.floor(Math.random() * 100) });
await s.start();
try {
  const t = new T({ session: s, scenario: { id: 0, name: 'reload-probe' }, dir, tier });
  await t.load();
  const spawn = await t.run(`
    const g = window.game, w = g.world, ctx = window.__qaCtx, qa = window.__qa, qh = window.__qh;
    qh.freezePlayer(true); window.__h = [];
    for (const n of ${JSON.stringify(entries)}) { const h = w.library.spawn(ctx, n, { position: { x: 3, z: -6 } }); window.__h.push(h); }
    await qa.wait(6);
    return { snap: qh.snap(), root: ctx.root.children.length, phys: w.physics.stats() };`);
  console.log('before', JSON.stringify(spawn));
  const snapNow = () => t.run(`return { snap: window.__qh.snap(), root: window.__qaCtx.root.children.length, phys: window.game.world.physics.stats(), removed: window.__h.map((h) => h && h.removed), alive: window.__h.map((h) => h && h.alive) };`);
  for (let i = 0; i < 3; i++) { await t.wait(500); console.log('idle', i, JSON.stringify((await snapNow()).snap)); await t.step(3); }
  const file = path.join(SANDBOX, 'public/game', rel);
  const n0 = await t.eval('__qa.loaded.length');
  fs.writeFileSync(file, fs.readFileSync(file));
  await t.waitFor(`__qa.loaded.slice(${n0}).some((e) => e.path === ${JSON.stringify(rel)})`, { timeout: 40000 });
  for (let i = 0; i < 4; i++) { await t.step(1.5); console.log('after', i, JSON.stringify(await snapNow())); }
  const errs = t.errorsSince({ c: 0, n: 0 }).filter((e) => !/favicon|index\.json/.test(e.text));
  if (errs.length) console.log('ERRORS', errs.map((e) => e.text.slice(0, 200)));
} catch (e) { console.log('FAILED', e.stack ?? e); }
finally { await s.stop(); await server.stop(); destroySandbox(); }
process.exit(0);
