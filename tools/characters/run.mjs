// Unattended batch: rigged, animated CHARACTERS through the real gen3d WSL worker (Z-Image-Turbo -> TRELLIS.2 -> UniRig -> baked clips). No AI/Claude calls, no game server.
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\tools\characters\run.mjs [--list list.json] [--limit N] [--only id,id] [--quality standard] [--seed-bump N] [--force] [--port 9561]
// Modelled on tools/startzone-batch/run.mjs (same safety guards): GPU gate (wait while >= 84 C or > 24000 MiB, give up after 30 min), 10 s pause between items,
// stop after 3 consecutive failures, the WSL worker is shut down at the end (this script starts its own worker on --port, default 9561, never 18765).
// One GPU job at a time. Resumable (results.json + files in public/assets/generated/characters/); --force redoes the chosen items.
//
// Why it talks to the worker directly instead of through server/gen3d.js: on a busy host (100 % CPU from other agents' headless Chrome) gen3d.js's
// 2.5 s health probes / 10-minute whole-job cap kill and restart the worker in the middle of a job. Here the worker gets --job-timeout 2400, polls are
// patient (60 s), and a worker is only restarted when its port is really dead for minutes.
// TWO STAGES (the worker unloads TRELLIS before UniRig and reloads it for the next item, so batching saves ~90 s per item):
//   stage A  every item -> static model   (POST /generate, animate false)
//   stage B  every item -> rig that mesh  (POST /rig {glb_path})  -> rigged GLB + rig meta (bodyPlan, clips, height, bones ...)
// Output per item (public/assets/generated/characters/): <id>.static.glb  <id>.rigged.glb  <id>.png (source image)  <id>.meta.json  (+ record in results.json).
// This does NOT write public/assets/generated/index.json (shared with other agents); the game registers the characters from meta.json (see docs/review/characters.md).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, 'public', 'assets', 'generated', 'characters');
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const listName = argv('--list', 'list.json');
const stem = listName.replace(/\.json$/, '');
const resultsFile = path.join(here, stem === 'list' ? 'results.json' : `results-${stem}.json`);
const logFile = path.join(here, stem === 'list' ? 'run.log' : `run-${stem}.log`);
const PORT = Number(argv('--port', 9561));
if (PORT < 9560 || PORT > 9569) { console.error('port must be 9560-9569'); process.exit(3); }

const MAX_TEMP = 84, MAX_MEM = 24000, WAIT_MS = 60_000, MAX_WAIT_MS = 30 * 60_000, PAUSE_MS = 10_000, MAX_FAILS = 3, JOB_MAX_MS = 45 * 60_000;
const limit = Number(argv('--limit', 1e9));
const only = argv('--only', '') ? argv('--only').split(',') : null;
const quality = argv('--quality', 'standard');
const seedBump = Number(argv('--seed-bump', 0));
const force = args.includes('--force');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  const line = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}  ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const saveResults = (r) => { const t = `${resultsFile}.tmp`; fs.writeFileSync(t, JSON.stringify(r, null, 2)); fs.renameSync(t, resultsFile); };
const toWsl = (p) => { const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p)); return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p; };
const fromWsl = (p) => { const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p); return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p; };
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
const copyAtomic = (src, dst) => { fs.copyFileSync(src, dst + '.tmp'); fs.renameSync(dst + '.tmp', dst); };

const list = readJson(path.join(here, listName), null);
if (!list?.items?.length) { log(`FATAL: ${listName} missing or empty`); process.exit(1); }
// A character-specific text-to-image wrapper (the default one asks for a "3/4 view product shot", which gives diagonal poses that rig badly).
// The worker inherits the variable through WSLENV; t2i_runner.py reads GEN3D_T2I_TEMPLATE once when it starts.
if (list.template) {
  process.env.GEN3D_T2I_TEMPLATE = list.template;
  process.env.WSLENV = ['GEN3D_T2I_TEMPLATE', process.env.WSLENV].filter(Boolean).join(':');
}
const items = list.items.map((it, i) => ({ ...it, full: `${it.prompt}, ${list.style}`, seed: (it.seed ?? 2000 + i) + seedBump }));
for (const it of items) if (it.full.length > 200) { log(`FATAL: prompt for ${it.id} is ${it.full.length} chars (keep within gen3d's 200)`); process.exit(1); }
log(`start: ${items.length} items from ${listName}, quality=${quality}, worker port ${PORT}, pid=${process.pid}${only ? ', only=' + only : ''}${limit < 1e9 ? ', limit=' + limit : ''}${seedBump ? ', seedBump=' + seedBump : ''}`);
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- tiny HTTP client + worker lifecycle
function httpJson(method, urlPath, body, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, timeout: timeoutMs, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
let child = null;
const healthy = async (ms = 20_000) => { try { return (await httpJson('GET', '/health', undefined, ms)).body?.ok === true; } catch { return false; } };
async function ensureWorker() {
  if (await healthy(5000)) return;
  log(`starting WSL worker on 127.0.0.1:${PORT}`);
  fs.mkdirSync(path.join(root, '.cache', 'gen3d'), { recursive: true });
  // worker_patient.py = worker.py with model start-up timeouts of 30 min instead of 7 (see its header)
  const sh = `exec "$HOME/gen3d/env/bin/python" -u ${toWsl(path.join(here, 'worker_patient.py'))} --root ${toWsl(root)} --port ${PORT} --host 127.0.0.1 --job-timeout 2400 --idle 1800 >> ${toWsl(root)}/.cache/gen3d/worker.stdout.log 2>&1`;
  child = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', sh], { windowsHide: true, stdio: 'ignore' });
  child.on('exit', () => { child = null; });
  for (let i = 0; i < 600; i++) { await sleep(2500); if (await healthy(8000)) return; if (!child) break; }
  throw new Error('the WSL worker did not start');
}
function killWorkerProcs() { try { if (child) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* gone */ } child = null; }
function gpu() {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-d', 'Ubuntu', '--', 'nvidia-smi', '--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 240_000 }, (err, out) => {
      const m = !err && /(\d+)\s*,\s*(\d+)/.exec(String(out));
      resolve(m ? { temp: +m[1], mem: +m[2] } : null);
    });
  });
}
const t0 = Date.now();
let exiting = false;
async function finish(code, why) {
  if (exiting) return; exiting = true;
  log(`exit: ${why} (${Math.round((Date.now() - t0) / 1000)} s wall)`);
  try { await httpJson('POST', '/shutdown', {}, 8000); log('worker shutdown requested'); } catch { /* not running */ }
  await sleep(2000); killWorkerProcs();
  process.exit(code);
}
process.on('SIGINT', () => finish(130, 'SIGINT'));
process.on('SIGTERM', () => finish(143, 'SIGTERM'));
process.on('uncaughtException', (e) => finish(1, `uncaught ${e?.stack ?? e}`));

async function gpuGate() {
  const w0 = Date.now(); let first = true;
  for (;;) {
    const s = await gpu();
    if (s && s.temp < MAX_TEMP && s.mem <= MAX_MEM) return true;
    if (Date.now() - w0 > MAX_WAIT_MS) { log(`GPU gate: waited 30 min (${s ? `temp ${s.temp}C, ${s.mem} MiB` : 'nvidia-smi failed'}), giving up`); return false; }
    if (first) log(`GPU gate: ${s ? `temp ${s.temp}C, ${s.mem} MiB` : 'nvidia-smi failed'} -> waiting`);
    first = false;
    await sleep(WAIT_MS);
  }
}

// submit a job and wait for it; returns the final job view. Restarts the worker only if it stays unreachable for ~4 minutes.
async function runJob(endpoint, body, label) {
  const start = Date.now();
  await ensureWorker();
  const sub = await httpJson('POST', endpoint, body);
  if (sub.status !== 200 || !sub.body?.job) throw new Error(sub.body?.error || `worker refused the job (${sub.status})`);
  const id = sub.body.job; let lastMsg = '', misses = 0;
  for (;;) {
    if (Date.now() - start > JOB_MAX_MS) throw new Error(`${label}: took longer than 45 minutes`);
    let v;
    try { v = (await httpJson('GET', `/jobs/${id}`, undefined, 60_000)).body; misses = 0; }
    catch { if (++misses > 48) throw new Error(`${label}: lost contact with the worker`); await sleep(5000); continue; }
    const msg = `${v.state}: ${v.message}`;
    if (msg !== lastMsg) { lastMsg = msg; log(`   [${label}] ${msg}`); }
    if (v.state === 'error') throw new Error(v.error || v.message || 'job failed');
    if (v.state === 'done') return v;
    await sleep(3000);
  }
}

const results = readJson(resultsFile, {});
let todo = items.filter((it) => !only || only.includes(it.id));
if (!force) todo = todo.filter((it) => !(results[it.id]?.ok && fs.existsSync(path.join(outDir, `${it.id}.rigged.glb`))));
if (limit < todo.length) todo = todo.slice(0, limit);
log(`${todo.length} to do: ${todo.map((t) => t.id).join(', ')}`);

let fails = 0, first = true;
const gate = async () => { if (!first) await sleep(PAUSE_MS); first = false; if (!(await gpuGate())) await finish(0, 'GPU gate gave up'); };
const failed = async (what) => { if (++fails >= MAX_FAILS) await finish(2, `${MAX_FAILS} consecutive failures (${what})`); };

// ---- stage A: static models
for (const it of todo) {
  const prev = force ? {} : (results[it.id] ?? {});
  const rec = results[it.id] = { ...prev, id: it.id, group: it.group, kind: it.kind, prompt: it.full, quality, seed: it.seed, ok: false, rigged: false, error: null };
  if (!force && prev.static && prev.seedDone === it.seed && fs.existsSync(path.join(root, prev.static))) { log(`A ${it.id}: static already made`); continue; }
  await gate();
  log(`>> A ${it.id} (${it.group}, seed ${it.seed}) "${it.full}"`);
  const start = Date.now();
  try {
    const v = await runJob('/generate', { prompt: it.full, quality, seed: it.seed, animate: false }, `A ${it.id}`);
    rec.genSeconds = Math.round((Date.now() - start) / 100) / 10;
    const src = fromWsl(v.glb_path);
    const d = path.join(outDir, `${it.id}.static.glb`); copyAtomic(src, d); rec.static = rel(d); rec.seedDone = it.seed;
    if (v.image_path) { const di = path.join(outDir, `${it.id}.png`); fs.copyFileSync(fromWsl(v.image_path), di); rec.image = rel(di); }
    rec.triangles = v.stats?.triangles ?? null; rec.staticBytes = v.stats?.bytes ?? null; rec.stats = { sculpt: v.stats?.sculpt_seconds, bake: v.stats?.bake_seconds, imagine: v.stats?.imagine_seconds };
    fails = 0;
    log(`<< A ${it.id} static ok ${rec.genSeconds}s ${rec.triangles} tris`);
  } catch (e) { rec.error = e?.message ?? String(e); log(`<< A ${it.id} FAILED: ${rec.error}`); await failed(it.id); }
  saveResults(results);
}

// ---- stage B: rig the static meshes
fails = 0;
for (const it of todo) {
  const rec = results[it.id];
  if (!rec?.static || !fs.existsSync(path.join(root, rec.static))) continue;
  await gate();
  log(`>> B ${it.id} rig`);
  const start = Date.now();
  try {
    const v = await runJob('/rig', { glb_path: toWsl(path.join(root, rec.static)), prompt: it.full, force: true }, `B ${it.id}`);
    rec.rigSeconds = Math.round((Date.now() - start) / 100) / 10;
    const rig = v.rig ?? v.stats?.rig ?? {};
    if (rig.rigged && rig.meta && v.glb_path && fs.existsSync(fromWsl(v.glb_path)) && /rigged/.test(v.glb_path)) {
      const d = path.join(outDir, `${it.id}.rigged.glb`); copyAtomic(fromWsl(v.glb_path), d);
      rec.glb = rel(d); rec.rigged = true; rec.ok = true; rec.error = null;
      rec.meta = rig.meta; rec.rigStats = { seconds: rig.seconds, method: rig.stats?.method };
      fs.writeFileSync(path.join(outDir, `${it.id}.meta.json`), JSON.stringify({ id: it.id, prompt: it.full, seed: it.seed, triangles: rec.triangles, ...rig.meta }, null, 2));
      fails = 0;
      log(`<< B ${it.id} RIGGED ${rec.rigSeconds}s, ${rig.meta.bodyPlan}${rig.meta.humanoid ? ' (humanoid)' : ''}, ${rig.meta.bones} bones, clips ${(rig.meta.clips ?? []).join('/')}`);
    } else { rec.error = `not rigged: ${rig.reason ?? v.message ?? '?'}`; fails = 0; log(`<< B ${it.id} NOT RIGGED after ${rec.rigSeconds}s: ${rec.error}`); }
  } catch (e) { rec.error = e?.message ?? String(e); log(`<< B ${it.id} FAILED: ${rec.error}`); await failed(it.id); }
  rec.finished = new Date().toISOString();
  saveResults(results);
}
const okN = Object.values(results).filter((r) => r.ok).length;
await finish(0, `finished: ${okN}/${items.length} rigged ok in ${path.basename(resultsFile)}`);
