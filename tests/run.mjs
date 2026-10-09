// Omnissiah full-game QA harness.   Run:   D:\omnissiah\tools\node\node.exe D:\omnissiah\tests\run.mjs [--tier pc|quest|both] [--only 1,2,7] [--label name]
// Starts its own server on 9080/9443, drives headless Edge over CDP, writes tests/results/<timestamp>/.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { startServer, ROOT } from './lib/server.mjs';
import { Session, T } from './lib/harness.mjs';
import { sleep } from './lib/cdp.mjs';
import { installQaModule, removeQaModule } from './lib/qamod.mjs';
import { createSandbox, destroySandbox, wipeSavesHard, restoreManifest, healModules, SANDBOX } from './lib/sandbox.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] ?? true) : d; };
const tiers = opt('tier', 'both') === 'both' ? ['pc', 'quest'] : [opt('tier')];
const only = opt('only', null) ? String(opt('only')).split(',').map((s) => s.trim()) : null;
const label = opt('label', '');
const DEFAULT = ['1', '10', '11', '12', '13', '14', '15']; // boot, new player (through the awakening), hot reload, soak, awakening paths, wave-3 surfaces, start area (2 = library sweep via --only)
const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const outRoot = path.join(ROOT, 'tests', 'results', ts + (label ? '-' + label : ''));
fs.mkdirSync(outRoot, { recursive: true });

const dir = path.join(ROOT, 'tests', 'scenarios');
const scenarios = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  const sc = mod.default;
  if (!sc) continue;
  if (only ? !only.includes(String(sc.id)) : !DEFAULT.includes(String(sc.id))) continue;
  scenarios.push(sc);
}
console.log(`QA run ${ts}: ${scenarios.length} scenario(s), tiers ${tiers.join('+')}  -> ${outRoot}`);

createSandbox(); installQaModule();
const server = await startServer({ logFile: path.join(outRoot, 'server.log'), root: SANDBOX });
console.log(`server up (pid ${server.pid}) with ${server.modules.length} modules`);
const results = { started: new Date().toISOString(), tiers, node: process.version, serverModules: server.modules.map((m) => m.path), scenarios: [] };
const killAll = async () => { try { await server.stop(); } catch { /* ignore */ } removeQaModule(); };
const finish = () => { try { restoreManifest(); destroySandbox(); } catch (e) { console.error('sandbox cleanup failed', e); } };
process.on('SIGINT', async () => { await killAll(); finish(); process.exit(1); });

try {
  // headless Edge's DevTools port: 9300-9449 only (other agents use 9500-9579; a clash with one of them crashed a run), and only a port nothing answers on
  const portBusy = (port) => new Promise((resolve) => { const s = net.connect({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
  const freePort = async () => { for (let i = 0; i < 40; i++) { const p = 9300 + Math.floor(Math.random() * 150); if (!(await portBusy(p))) return p; } throw new Error('no free DevTools port in 9300-9449'); };
  for (const tier of tiers) {
    const session = new Session({ outDir: outRoot, tier, edgePort: await freePort() });
    await session.start();
    for (const sc of scenarios) {
      if (sc.tiers && !sc.tiers.includes(tier)) continue;
      const sdir = path.join(outRoot, tier, `${String(sc.id).padStart(2, '0')}-${sc.name}`);
      const t = new T({ session, scenario: sc, dir: sdir, tier });
      console.log(`\n== scenario ${sc.id} ${sc.name} [${tier}]`);
      try { await session.page.send('Page.navigate', { url: 'about:blank' }); } catch { /* ignore */ }
      restoreManifest(); // a scenario may have written its own sandbox manifest (startarea): every scenario starts from the live one
      { const h = await healModules(); if (h.dropped.length) { const msg = `server dropped ${h.dropped.join(', ')} from /api/modules (a "node --check" in server/files.js timed out or failed): ${h.healed ? 'healed by a rewrite' : 'STILL MISSING ' + h.still.join(', ')}`; console.log('   [qa] ' + msg); (results.serverDrops ??= []).push({ before: `${sc.id} ${sc.name} [${tier}]`, msg }); } }
      await sleep(2000); if (!(await wipeSavesHard())) console.log('   [qa] WARNING: saves/ could not be emptied; the next scenario may see an old profile'); // the previous page may still have been flushing a save
      const mark = t.mark();
      const limit = sc.timeout ?? 900000;
      try {
        await Promise.race([
          sc.run(t),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`scenario timeout after ${limit / 1000}s`)), limit)),
        ]);
      } catch (err) {
        t.check('scenario completed without crashing', false, String(err?.stack ?? err).slice(0, 1200), 'P0');
        try { await t.shot('crash'); } catch { /* ignore */ }
      }
      const sum = t.summary();
      const errs = t.errorsSince(mark);
      const dedup = new Map();
      for (const e of errs) { const k = e.text.slice(0, 160); const o = dedup.get(k) ?? { kind: e.kind, text: e.text, count: 0, url: e.url }; o.count++; dedup.set(k, o); }
      sum.consoleErrors = [...dedup.values()];
      sum.network = t.netSince(mark);
      sum.blocked = await session.page.eval('(window.__qa && window.__qa.blocked) || []').catch(() => []);
      sum.sent = await session.page.eval('((window.__qa && window.__qa.sent) || []).map(s => s.type)').catch(() => []);
      sum.reloadsDuringRun = await session.page.eval('(window.__qa && window.__qa.reloads) || 0').catch(() => 0);
      results.scenarios.push(sum);
      fs.writeFileSync(path.join(outRoot, 'results.json'), JSON.stringify(results, null, 1));
      const failed = sum.checks.filter((c) => !c.ok).length;
      console.log(`== ${sc.name} [${tier}] ${failed ? 'FAIL' : 'PASS'}: ${sum.checks.length - failed}/${sum.checks.length} checks, ${sum.consoleErrors.length} distinct console errors, ${Math.round(sum.ms / 1000)}s`);
    }
    fs.writeFileSync(path.join(outRoot, `console-${tier}.json`), JSON.stringify(session.console, null, 1));
    fs.writeFileSync(path.join(outRoot, `network-${tier}.json`), JSON.stringify(session.network, null, 1));
    await session.stop();
  }
} finally {
  results.finished = new Date().toISOString();
  results.serverLines = server.lines.slice(-400);
  fs.writeFileSync(path.join(outRoot, 'results.json'), JSON.stringify(results, null, 1));
  await killAll();
  finish();
}

// brief matrix
console.log('\n==== SUMMARY ====');
for (const s of results.scenarios) {
  const f = s.checks.filter((c) => !c.ok);
  console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${String(s.id).padStart(2)} ${s.name.padEnd(18)} ${s.tier.padEnd(5)} ${s.checks.length - f.length}/${s.checks.length}`);
  for (const c of f) console.log(`        - [${c.sev}] ${c.name}: ${c.detail.slice(0, 200)}`);
}
for (const s of results.scenarios) {
  if (s.data && s.data.budgetLines) { console.log(`\n---- ${s.name} [${s.tier}] ----`); for (const l of s.data.budgetLines) console.log('  ' + l); }
}
console.log('results:', outRoot);
process.exit(0);






