// Dev helper: boot our server + headless Edge, load the game, run a JS file (async function body) in the page, print its result.
//   node tests/dev/probe.mjs <pc|quest> <script.js> [--shot name]
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ROOT } from '../lib/server.mjs';
import { Session, T } from '../lib/harness.mjs';
import { installQaModule, removeQaModule } from '../lib/qamod.mjs';
import { createSandbox, destroySandbox, SANDBOX } from '../lib/sandbox.mjs';

const tier = process.argv[2] ?? 'pc';
const script = fs.readFileSync(process.argv[3], 'utf8');
const shotIdx = process.argv.indexOf('--shot');
createSandbox(); installQaModule();
const dir = path.join(ROOT, '.cache', 'qa', 'probe');
const server = await startServer({ logFile: path.join(dir, 'server.log'), root: SANDBOX });
const s = new Session({ outDir: dir, tier, edgePort: 9800 + Math.floor(Math.random() * 100) });
await s.start();
let code = 0;
try {
  const t = new T({ session: s, scenario: { id: 0, name: 'probe' }, dir, tier });
  await t.load();
  await t.waitFor('!!window.__qaCtx', { timeout: 30000 });
  const mark = t.mark();
  const out = await t.run(script, { timeout: 600000 });
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
  if (shotIdx > 0) console.log('shot', await t.shot(process.argv[shotIdx + 1]));
  const errs = t.errorsSince(mark);
  if (errs.length) console.log('CONSOLE ERRORS:\n' + errs.slice(0, 12).map((e) => `  [${e.kind}] ${e.text.slice(0, 300)}`).join('\n'));
} catch (e) { console.log('PROBE FAILED', e.stack ?? e); code = 1; }
finally { await s.stop(); await server.stop(); destroySandbox(); }
process.exit(code);


