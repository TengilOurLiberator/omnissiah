// Node side of the blast worker (WSL, 127.0.0.1:18785): lazy start, reuse of a hand-started worker, restart once, idle stop, never kills what it did not start.
// Same pattern as server/gen3d.js. API: generate({ prompt, width, height, seed, out }) -> { ok, out, stats } ; edit(items) -> { ok, items, stats } ; unload() ; shutdown().
// Paths passed in are Windows paths; they are translated for WSL.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const PREFERRED_PORT = 18785;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const toWsl = (p) => { const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p)); return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : String(p).replace(/\\/g, '/'); };
export const fromWsl = (p) => { const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p); return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p; };

export function httpJson(method, port, urlPath, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    // agent:false = a fresh connection per call: a reused keep-alive socket through WSL's localhost relay sometimes comes back as ECONNRESET
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs, agent: false, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length, Connection: 'close' } : { Connection: 'close' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); } catch (err) { reject(err); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const freePort = (preferred) => new Promise((resolve) => {
  const tryPort = (p) => {
    const s = net.createServer();
    s.once('error', () => (p === 0 ? resolve(preferred + 1) : tryPort(0)));
    s.listen(p, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); });
  };
  tryPort(preferred);
});

export function createWorkerClient({ root, log = () => {}, env = process.env, idleStopMs = 15 * 60 * 1000 } = {}) {
  const distro = env.BLAST_DISTRO || 'Ubuntu';
  const state = { worker: 'stopped', port: null, child: null, startedByUs: false, startPromise: null, lastError: null, shuttingDown: false };
  let idleTimer = null;
  let busy = 0;

  async function probe(port, tries, delayMs, gone = () => false) {
    for (let i = 0; i < tries; i++) {
      if (state.shuttingDown) return false;
      try { const r = await httpJson('GET', port, '/health', undefined, 2500); if (r.status === 200 && r.body?.ok) return true; } catch { /* not up yet */ }
      if (gone()) return false;
      await sleep(delayMs);
    }
    return false;
  }
  function startOnce() {
    return new Promise(async (resolve, reject) => {
      try {
        if (await probe(PREFERRED_PORT, 1, 0)) { state.port = PREFERRED_PORT; state.startedByUs = false; state.worker = 'ready'; return resolve(); }
        const port = await freePort(PREFERRED_PORT);
        const script = toWsl(path.join(root, 'server', 'blast', 'start_worker.sh'));
        log(`starting WSL worker (${distro}) on 127.0.0.1:${port}`);
        fs.mkdirSync(path.join(root, '.cache', 'blast'), { recursive: true });
        let spawnError = null, gone = false;
        const child = spawn('wsl.exe', ['-d', distro, '--', 'bash', script, '--port', String(port), '--host', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
        child.on('error', (err) => { spawnError = err; });
        child.on('exit', (code) => {
          gone = true;
          if (state.child === child) { state.child = null; if (!state.shuttingDown && state.worker !== 'stopped') { state.worker = 'stopped'; state.lastError = `worker exited (${code})`; log(state.lastError); } }
        });
        state.child = child; state.port = port; state.startedByUs = true;
        if (await probe(port, 90, 700, () => gone)) { state.worker = 'ready'; state.lastError = null; return resolve(); }
        const why = spawnError ? (spawnError.code === 'ENOENT' ? 'WSL (wsl.exe) is not installed' : spawnError.message) : 'the blast worker did not start (is ~/blast installed? see server/blast/README.md)';
        killChild();
        reject(new Error(why));
      } catch (err) { reject(err); }
    });
  }
  function ensure() {
    if (state.worker === 'ready' && state.child?.exitCode === null) return Promise.resolve();
    if (state.worker === 'ready' && !state.startedByUs) return Promise.resolve();
    if (state.startPromise) return state.startPromise;
    state.worker = 'starting';
    state.startPromise = startOnce().catch((err) => { state.worker = 'error'; state.lastError = err.message; throw err; }).finally(() => { state.startPromise = null; });
    return state.startPromise;
  }
  function killChild() {
    const c = state.child;
    state.child = null;
    if (!c) return;
    try { if (c.exitCode === null) execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* ignore */ }
  }
  async function stop() {
    const port = state.port;
    if (state.startedByUs && port) { try { await httpJson('POST', port, '/shutdown', {}, 3000); } catch { /* gone */ } }
    for (let i = 0; i < 10 && port; i++) { try { await httpJson('GET', port, '/health', undefined, 500); await sleep(300); } catch { break; } }
    killChild();
    state.worker = 'stopped';
  }
  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!busy && state.worker === 'ready' && state.startedByUs) { log('idle: stopping the blast worker'); stop().catch(() => {}); } }, idleStopMs);
    idleTimer.unref?.();
  }

  // submit a job and wait for it. onItem(item) is called for every edit item as it appears. One restart on a lost worker.
  async function run(kind, body, { timeoutMs = 10 * 60 * 1000, onItem, onProgress } = {}) {
    busy++;
    try {
      let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await ensure();
          const sub = await httpJson('POST', state.port, kind === 'generate' ? '/generate' : '/edit', body, 15000);
          if (sub.status !== 200 || !sub.body?.job) throw Object.assign(new Error(sub.body?.error || `worker refused the job (${sub.status})`), { final: true });
          const jobId = sub.body.job;
          const deadline = Date.now() + timeoutMs;
          const seen = new Set();
          let misses = 0;
          for (;;) {
            if (state.shuttingDown) throw Object.assign(new Error('the server is shutting down'), { final: true });
            if (Date.now() > deadline) throw new Error('the image worker took too long');
            let v;
            try { v = (await httpJson('GET', state.port, `/jobs/${jobId}`)).body; misses = 0; } catch (err) { if (++misses >= 5) throw new Error(`lost contact with the worker (${err.message})`); await sleep(1000); continue; }
            for (const it of v.items ?? []) if (!seen.has(it.id)) { seen.add(it.id); try { onItem?.(it); } catch { /* callback failed */ } }
            try { onProgress?.(v); } catch { /* ignore */ }
            if (v.state === 'error') throw Object.assign(new Error(v.error || 'the image worker failed'), { final: true });
            if (v.state === 'done') return { ok: true, out: v.out ? fromWsl(v.out) : null, items: (v.items ?? []).map((it) => ({ ...it, out: it.out ? fromWsl(it.out) : null })), stats: v.stats ?? {} };
            await sleep(700);
          }
        } catch (err) {
          lastErr = err?.message ?? String(err);
          log(`worker attempt ${attempt + 1} failed: ${lastErr}`);
          if (err?.final || state.shuttingDown) break;
          if (attempt === 0) { state.worker = 'stopped'; try { await stop(); } catch { /* ignore */ } }
        }
      }
      state.lastError = lastErr;
      return { ok: false, error: lastErr, items: [] };
    } finally { busy--; touch(); }
  }

  return {
    state,
    generate: ({ prompt, width = 1344, height = 768, seed, out, steps }, opts) => run('generate', { prompt, width, height, seed, steps, out: toWsl(out) }, opts),
    edit: (items, opts) => run('edit', { items: items.map((it) => ({ ...it, images: it.images.map(toWsl), out: toWsl(it.out) })) }, opts),
    async unload() { try { if (state.worker === 'ready') await httpJson('POST', state.port, '/unload', {}, 8000); } catch { /* ignore */ } },
    async health() { try { return (await httpJson('GET', state.port ?? PREFERRED_PORT, '/health', undefined, 2500)).body; } catch { return null; } },
    async shutdown() { state.shuttingDown = true; clearTimeout(idleTimer); try { await stop(); } catch { /* ignore */ } },
  };
}
