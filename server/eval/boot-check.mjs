// Smoke test of the headless boot: node --import ./server/eval/register.mjs server/eval/boot-check.mjs [creation.js ...]
import path from 'node:path';
import { bootGame, ROOT } from './headless.mjs';

const gameDir = path.join(ROOT, 'public', 'game');
const t0 = performance.now();
const G = await bootGame({ gameDir, onLog: (s) => console.log(s) });
console.log(`booted in ${((performance.now() - t0) / 1000).toFixed(1)}s; core loaded ${G.loadedCore.length}; failures ${G.loadFailures.length}`);
for (const f of G.loadFailures) console.log('LOAD FAIL', f.path, f.message, '\n', f.stack);
const t1 = performance.now();
G.step(3);
console.log(`stepped 3 s in ${((performance.now() - t1) / 1000).toFixed(1)}s; core errors:`, G.coreErrors.slice(0, 10));
console.log('services:', Object.keys(G.world).join(' '));
for (const rel of process.argv.slice(2)) {
  const rec = await G.loadCreation(rel);
  console.log(rel, rec.failed ? 'LOAD FAIL ' + rec.loadError.message : 'ok');
}
process.exit(0);
