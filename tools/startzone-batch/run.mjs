// Unattended overnight batch: starting-zone assets through the real gen3d pipeline (Z-Image-Turbo -> TRELLIS.2). No AI/Claude calls, no game server.
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\tools\startzone-batch\run.mjs [--limit N] [--only id,id] [--quality standard]
// Resumable: items whose id is ok in results.json AND whose GLB exists in public/assets/generated/startzone/ are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGen3d } from '../../server/gen3d.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, 'public', 'assets', 'generated', 'startzone');
const jobsDir = path.join(root, '.cache', 'gen3d', 'jobs');
const indexFile = path.join(root, 'public', 'assets', 'generated', 'index.json');
const resultsFile = path.join(here, 'results.json');
const logFile = path.join(here, 'run.log');

const MAX_TEMP = 84, MAX_MEM = 26000, WAIT_MS = 60_000, MAX_WAIT_MS = 30 * 60_000, PAUSE_MS = 10_000, MAX_FAILS = 3;
// hard stop at 08:00 LOCAL (the next 08:00 after start = 2026-10-09 08:00 for tonight's run); no item is started after 07:50
const DEADLINE = (() => { const d = new Date(); d.setHours(8, 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); })();
const LAST_START = DEADLINE - 10 * 60_000;
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const limit = Number(argv('--limit', 1e9));
const only = argv('--only', '') ? argv('--only').split(',') : null;
const quality = argv('--quality', 'standard');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  const line = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}  ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const saveResults = (r) => { const t = `${resultsFile}.tmp`; fs.writeFileSync(t, JSON.stringify(r, null, 2)); fs.renameSync(t, resultsFile); };

const list = readJson(path.join(here, 'list.json'), null);
if (!list?.items?.length) { log('FATAL: list.json missing or empty'); process.exit(1); }
const list2 = readJson(path.join(here, 'list2.json'), { items: [] });
list.items.forEach((it) => { it.phase = 1; });
list2.items.forEach((it) => { it.phase = 2; });
const all = [...list.items, ...list2.items];   // phase 1 (starting zone) first, then phase 2 (shared style from list.json)
for (const it of all) {
  it.full = `${it.prompt}, ${list.style}`;
  if (it.full.length > 200) { log(`FATAL: prompt for ${it.id} is ${it.full.length} chars (gen3d cap is 200)`); process.exit(1); }
}
log(`start: ${all.length} items (${list.items.length}+${list2.items.length}), deadline ${new Date(DEADLINE).toString().slice(0, 24)}, quality=${quality}, pid=${process.pid}${only ? ', only=' + only : ''}${limit < 1e9 ? ', limit=' + limit : ''}`);
fs.mkdirSync(outDir, { recursive: true });

function gpu() {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-d', 'Ubuntu', '--', 'nvidia-smi', '--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 60_000 }, (err, out) => {
      const m = !err && /(\d+)\s*,\s*(\d+)/.exec(String(out));
      resolve(m ? { temp: +m[1], mem: +m[2] } : null);
    });
  });
}

const t0 = Date.now();
const g = createGen3d({ root, send: (m) => { if (m?.type === 'gen3d_status' && m.state !== 'done') log(`   [${m.id}] ${m.state}: ${m.message ?? ''}`); } });
let exiting = false;
async function finish(code, why) {
  if (exiting) return; exiting = true;
  log(`exit: ${why}`);
  try { await g.shutdown(); log('worker shutdown requested (only stops a worker this script started)'); } catch (e) { log('shutdown error', e?.message ?? e); }
  process.exit(code);
}
process.on('SIGINT', () => finish(130, 'SIGINT'));
process.on('SIGTERM', () => finish(143, 'SIGTERM'));
process.on('uncaughtException', (e) => finish(1, `uncaught ${e?.stack ?? e}`));

// returns true when the GPU is fine to use, false if we should give up
async function gpuGate() {
  const w0 = Date.now(); let first = true;
  for (;;) {
    const s = await gpu();
    if (s && s.temp < MAX_TEMP && s.mem <= MAX_MEM) return true;
    if (Date.now() - w0 > MAX_WAIT_MS) { log(`GPU gate: waited 30 min (${s ? `temp ${s.temp}C, ${s.mem} MiB` : 'nvidia-smi failed'}), giving up`); return false; }
    if (Date.now() > LAST_START) return false;
    if (first) log(`GPU gate: ${s ? `temp ${s.temp}C, ${s.mem} MiB` : 'nvidia-smi failed'} -> waiting`);
    first = false;
    await sleep(WAIT_MS);
  }
}

function newestImage(since) {
  let best = null;
  try {
    for (const d of fs.readdirSync(jobsDir)) {
      const f = path.join(jobsDir, d, 'image.png');
      try { const st = fs.statSync(f); if (st.mtimeMs >= since && (!best || st.mtimeMs > best.t)) best = { f, t: st.mtimeMs }; } catch { /* none */ }
    }
  } catch { /* no dir */ }
  return best?.f ?? null;
}

const results = readJson(resultsFile, {});
let todo = all.map((it, i) => ({ ...it, seed: 1000 + i })).filter((it) => !only || only.includes(it.id));
todo = todo.filter((it) => !(results[it.id]?.ok && fs.existsSync(path.join(outDir, `${it.id}.glb`))));
log(`${todo.length} to do`);
let fails = 0, done = 0, first = true;
for (const it of todo) {
  if (done >= limit) break;
  if (Date.now() > LAST_START) { await finish(0, 'hard stop: 07:50 reached, no new items after this'); }
  if (!first) await sleep(PAUSE_MS);
  first = false;
  if (!(await gpuGate())) { await finish(0, 'GPU gate / time limit'); }
  if (Date.now() > LAST_START) { await finish(0, 'hard stop: 07:50 reached, no new items after this'); }
  log(`>> ${it.id} (${it.group}) "${it.full}"`);
  const start = Date.now();
  const rec = { id: it.id, phase: it.phase, group: it.group, size_m: it.size_m, ground: it.ground, prompt: it.full, quality, seed: it.seed, ok: false, glb: null, image: null, seconds: null, triangles: null, error: null, finished: null };
  try {
    const r = await g.request({ id: `sz-${it.id}`, prompt: it.full, options: { quality, seed: it.seed, animate: false } });
    rec.seconds = Math.round((Date.now() - start) / 100) / 10;
    if (r?.state === 'done' && r.url) {
      const slug = String(r.url).replace(/^.*\//, '').replace(/\.glb$/, '');
      const src = path.join(root, 'public', 'assets', 'generated', `${slug}.glb`);
      const dst = path.join(outDir, `${it.id}.glb`);
      fs.copyFileSync(src, dst + '.tmp'); fs.renameSync(dst + '.tmp', dst);
      rec.glb = path.relative(root, dst).replace(/\\/g, '/');
      rec.slug = slug; rec.cacheUrl = r.url;
      const meta = readJson(indexFile, {})[slug];
      rec.triangles = meta?.triangles ?? null; rec.bytes = meta?.bytes ?? null;
      const img = newestImage(start - 2000);
      if (img) { const idst = path.join(outDir, `${it.id}.png`); fs.copyFileSync(img, idst); rec.image = path.relative(root, idst).replace(/\\/g, '/'); }
      rec.ok = true;
    } else rec.error = r?.message ?? 'no result';
  } catch (e) { rec.error = e?.message ?? String(e); rec.seconds = Math.round((Date.now() - start) / 100) / 10; }
  rec.finished = new Date().toISOString();
  results[it.id] = rec; saveResults(results);
  log(`<< ${it.id} ${rec.ok ? `OK ${rec.seconds}s ${rec.triangles ?? '?'} tris` : `FAILED after ${rec.seconds}s: ${rec.error}`}`);
  done++;
  if (rec.ok) fails = 0; else if (++fails >= MAX_FAILS) { await finish(2, `${MAX_FAILS} consecutive failures`); }
}
const okN = Object.values(results).filter((r) => r.ok).length;
await finish(0, `finished: ${okN}/${all.length} ok in results.json`);
