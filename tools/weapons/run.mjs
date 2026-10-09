// Weapon models through the unattended gen3d pipeline (Z-Image-Turbo -> TRELLIS.2), same worker protocol as tools/characters/run.mjs. No AI/Claude calls, no game server.
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\tools\weapons\run.mjs [--only id,id] [--seed 5000] [--force] [--port 9561] [--own-port 9603]
// Output: public/assets/generated/weapons/<id>.glb (+ <id>.png source picture), tools/weapons/results.json. Resumable (ok + file present = skipped).
// It does NOT write public/assets/generated/index.json (shared). WORKER: the WSL machine has 20 GB RAM and one worker (t2i + TRELLIS) already needs most of it,
// so a worker that is healthy on --port (the characters batch keeps one on 9561) is SHARED (jobs are FIFO there) and never shut down by us; only if none answers
// do we start our own (tools/characters/worker_patient.py, long start-up timeouts, on --own-port) and shut down THAT one at the end.
// GPU etiquette (brief): before EVERY job `nvidia-smi` temperature + memory; wait while >= 84 C or > 20000 MiB. One job at a time.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, 'public', 'assets', 'generated', 'weapons');
const resultsFile = path.join(here, 'results.json');
const logFile = path.join(here, 'run.log');
const MAX_TEMP = 84, MAX_MEM = 20000, WAIT_MS = 60_000, MAX_WAIT_MS = 60 * 60_000, PAUSE_MS = 5_000, MAX_FAILS = 3, JOB_MAX_MS = 60 * 60_000;
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = argv('--only', '') ? argv('--only').split(',') : null;
const seed0 = Number(argv('--seed', 5000));
const force = args.includes('--force');
const quality = argv('--quality', 'standard');
const SHARED_PORT = Number(argv('--port', 9561)), OWN_PORT = Number(argv('--own-port', 9603));
let PORT = SHARED_PORT, child = null, ownWorker = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  const line = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}  ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } };
const saveResults = (r) => { const t = `${resultsFile}.tmp`; fs.writeFileSync(t, JSON.stringify(r, null, 2)); fs.renameSync(t, resultsFile); };
const toWsl = (p) => { const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p)); return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/'); };
const fromWsl = (p) => { const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p); return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p; };

const list = readJson(path.join(here, 'list.json'), null);
if (!list?.items?.length) { log('FATAL: list.json missing or empty'); process.exit(1); }
const all = list.items.map((it, i) => ({ ...it, full: `${it.prompt}, ${list.style}`, seed: seed0 + i }));
for (const it of all) if (it.full.length > 200) { log(`FATAL: prompt for ${it.id} is ${it.full.length} chars (gen3d cap is 200)`); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

function httpJson(method, urlPath, body, timeoutMs = 60_000, port = PORT) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const healthy = async (port, ms = 20_000) => { try { return (await httpJson('GET', '/health', undefined, ms, port)).body?.ok === true; } catch { return false; } };
async function ensureWorker() {
  if (await healthy(SHARED_PORT, 8000)) { if (PORT !== SHARED_PORT) log(`shared worker on ${SHARED_PORT} is up: using it`); PORT = SHARED_PORT; return; }
  if (await healthy(OWN_PORT, 8000)) { PORT = OWN_PORT; return; }
  log(`no worker answers: starting our own on 127.0.0.1:${OWN_PORT}`);
  fs.mkdirSync(path.join(root, '.cache', 'gen3d'), { recursive: true });
  const sh = `exec "$HOME/gen3d/env/bin/python" -u ${toWsl(path.join(root, 'tools', 'characters', 'worker_patient.py'))} --root ${toWsl(root)} --port ${OWN_PORT} --host 127.0.0.1 --job-timeout 2400 --idle 1800 >> ${toWsl(root)}/.cache/gen3d/worker.stdout.log 2>&1`;
  child = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', sh], { windowsHide: true, stdio: 'ignore' });
  child.on('exit', () => { child = null; });
  ownWorker = true; PORT = OWN_PORT;
  for (let i = 0; i < 720; i++) { await sleep(2500); if (await healthy(OWN_PORT, 8000)) return; if (!child) break; }
  throw new Error('the WSL worker did not start');
}
function gpu() {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-d', 'Ubuntu', '--', 'nvidia-smi', '--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 240_000 }, (err, out) => {
      const m = !err && /(\d+)\s*,\s*(\d+)/.exec(String(out));
      resolve(m ? { temp: +m[1], mem: +m[2] } : null);
    });
  });
}
let exiting = false;
async function finish(code, why) {
  if (exiting) return; exiting = true;
  log(`exit: ${why}`);
  if (ownWorker) { try { await httpJson('POST', '/shutdown', {}, 8000, OWN_PORT); log('own worker shutdown requested'); } catch { /* not running */ } await sleep(2000); try { if (child) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* gone */ } }
  else log('shared worker left running (not started by this script)');
  process.exit(code);
}
process.on('SIGINT', () => finish(130, 'SIGINT'));
process.on('SIGTERM', () => finish(143, 'SIGTERM'));
process.on('uncaughtException', (e) => finish(1, `uncaught ${e?.stack ?? e}`));

async function gpuGate() {
  const w0 = Date.now(); let first = true;
  for (;;) {
    const s = await gpu();
    if (s && s.temp < MAX_TEMP && s.mem <= MAX_MEM) { log(`GPU ok: ${s.temp} C, ${s.mem} MiB`); return true; }
    if (Date.now() - w0 > MAX_WAIT_MS) { log(`GPU gate: waited 60 min (${s ? `temp ${s.temp}C, ${s.mem} MiB` : 'nvidia-smi failed'}), giving up`); return false; }
    if (first) log(`GPU gate: ${s ? `temp ${s.temp}C, ${s.mem} MiB` : 'nvidia-smi failed'} -> waiting`);
    first = false;
    await sleep(WAIT_MS);
  }
}
async function runJob(body, label) {
  const start = Date.now();
  await ensureWorker();
  const sub = await httpJson('POST', '/generate', body);
  if (sub.status !== 200 || !sub.body?.job) throw new Error(sub.body?.error || `worker refused the job (${sub.status})`);
  const id = sub.body.job; let lastMsg = '', misses = 0;
  for (;;) {
    if (Date.now() - start > JOB_MAX_MS) throw new Error(`${label}: took longer than 60 minutes`);
    let v;
    try { v = (await httpJson('GET', `/jobs/${id}`, undefined, 60_000)).body; misses = 0; }
    catch { if (++misses > 60) throw new Error(`${label}: lost contact with the worker`); await sleep(5000); continue; }
    const msg = `${v.state}: ${v.message}`;
    if (msg !== lastMsg) { lastMsg = msg; log(`   [${label}] ${msg}`); }
    if (v.state === 'error') throw new Error(v.error || v.message || 'job failed');
    if (v.state === 'done') return v;
    await sleep(3000);
  }
}

const results = readJson(resultsFile, {});
let todo = all.filter((it) => !only || only.includes(it.id));
if (!force) todo = todo.filter((it) => !(results[it.id]?.ok && fs.existsSync(path.join(outDir, `${it.id}.glb`))));
log(`start pid=${process.pid}: ${todo.length} to do (${todo.map((t) => t.id).join(',')}) quality=${quality}`);
let fails = 0, first = true;
for (const it of todo) {
  if (!first) await sleep(PAUSE_MS);
  first = false;
  if (!(await gpuGate())) await finish(0, 'GPU gate gave up');
  log(`>> ${it.id} (${it.type}) "${it.full}" seed ${it.seed}`);
  const start = Date.now();
  const rec = { id: it.id, type: it.type, len_m: it.len_m, prompt: it.full, quality, seed: it.seed, ok: false, glb: null, image: null, seconds: null, triangles: null, error: null, finished: null };
  try {
    const v = await runJob({ prompt: it.full, quality, seed: it.seed, animate: false }, it.id);
    rec.seconds = Math.round((Date.now() - start) / 100) / 10;
    const dst = path.join(outDir, `${it.id}.glb`);
    fs.copyFileSync(fromWsl(v.glb_path), dst + '.tmp'); fs.renameSync(dst + '.tmp', dst);
    rec.glb = path.relative(root, dst).replace(/\\/g, '/');
    if (v.image_path) { const idst = path.join(outDir, `${it.id}.png`); fs.copyFileSync(fromWsl(v.image_path), idst); rec.image = path.relative(root, idst).replace(/\\/g, '/'); }
    rec.triangles = v.stats?.triangles ?? null; rec.bytes = v.stats?.bytes ?? null;
    rec.ok = true; fails = 0;
  } catch (e) { rec.error = e?.message ?? String(e); rec.seconds = Math.round((Date.now() - start) / 100) / 10; fails++; }
  rec.finished = new Date().toISOString();
  results[it.id] = rec; saveResults(results);
  log(`<< ${it.id} ${rec.ok ? `OK ${rec.seconds}s ${rec.triangles ?? '?'} tris` : `FAILED after ${rec.seconds}s: ${rec.error}`}`);
  if (fails >= MAX_FAILS) await finish(2, `${MAX_FAILS} consecutive failures`);
}
const okN = Object.values(results).filter((r) => r.ok).length;
await finish(0, `finished: ${okN}/${all.length} ok in results.json`);
