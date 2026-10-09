// Omnissiah travel service: text -> panorama + derived world state through the local WSL worker (Z-Image-Turbo).
// See server/travel/README.md and docs/CONTRACT.md ("v4 additions"). Used by server/plugins/travel.js and tools in this folder.
//
//   const t = createTravel({ root, send });         // send(msg) broadcasts a server->client message
//   t.request({ id, prompt, options })              // never throws; resolves with the final status
//   t.status()   t.shutdown()   t.list()   t.slugFor(prompt, seed)
//
// Client -> server  { type:'place', id, prompt, options:{ seed?, hi?:'fast'|'refine', slug?, name?, spec? } }
// Server -> client  { type:'place_status', id, state:'queued'|'dreaming'|'done'|'error', message, url, preview, hi, meta, progress? }
//   url = 2048x1024 JPEG (Quest), hi = 4096x2048 WebP (PC), preview = 64x32 blurred WebP, meta = derived world state (+ spec).
// Cache: public/assets/generated/places/<slug>/{pano_2048.jpg,pano_4096.webp,tiny.webp,meta.json,views.png} + places/index.json
//        ({ slug: { name, prompt, created, seed, url, hi, preview, meta, spec, seconds } }), written atomically.
// Node built-ins only. Prompts only ever travel as JSON over HTTP to 127.0.0.1, never through a shell.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_PROMPT = 300;
const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const WORKER_IDLE_STOP_MS = 30 * 60 * 1000;
const MAX_PENDING = 16;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTravel({ root, send = () => {}, log = (...a) => console.log('[travel]', ...a), env = process.env } = {}) {
  root = path.resolve(root ?? '.');
  const placesDir = path.join(root, 'public', 'assets', 'generated', 'places');
  const indexFile = path.join(placesDir, 'index.json');
  const logDir = path.join(root, '.cache', 'travel');
  const distro = env.TRAVEL_DISTRO || 'Ubuntu';
  const PREFERRED_PORT = Number(env.TRAVEL_PORT) || 18780; // the contract's port; TRAVEL_PORT is for tests
  const emit = (msg) => { try { send(msg); } catch (err) { log('send failed:', err?.message ?? err); } };

  const state = { worker: 'stopped', port: null, child: null, startedByUs: false, startPromise: null, lastError: null, shuttingDown: false };
  const inflight = new Map(); // slug -> { clients:Set<id>, promise, last }
  let indexChain = Promise.resolve();
  let idleTimer = null;

  // ------------------------------------------------------------ helpers
  const toWsl = (p) => {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p));
    return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
  };
  const fromWsl = (p) => {
    const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
    return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p;
  };
  const cleanPrompt = (raw) => String(raw ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT).trim();
  const cleanSlug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const slugFor = (prompt, seed) => {
    const norm = prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const words = norm.normalize('NFKD').replace(/[^a-z0-9 ]+/g, '').trim().split(' ').filter(Boolean).join('-').slice(0, 32).replace(/-+$/, '');
    const hash = crypto.createHash('sha1').update(`${norm}|${seed ?? ''}`).digest('hex').slice(0, 6);
    return `${words || 'place'}-${hash}`;
  };

  function httpJson(method, port, urlPath, body, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({
        host: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); } catch (err) { reject(err); }
        });
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
      s.once('error', () => (p === 0 ? resolve(PREFERRED_PORT + 1) : tryPort(0)));
      s.listen(p, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); });
    };
    tryPort(preferred);
  });

  // ------------------------------------------------------------ cache index
  function readIndex() {
    let text;
    try { text = fs.readFileSync(indexFile, 'utf8'); } catch { return {}; }
    try {
      const j = JSON.parse(text.replace(/^﻿/, ''));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch {
      try { fs.copyFileSync(indexFile, `${indexFile}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return {};
    }
  }
  function updateIndex(slug, entry) {
    indexChain = indexChain.then(() => {
      fs.mkdirSync(placesDir, { recursive: true });
      const idx = readIndex();
      idx[slug] = entry;
      const tmp = `${indexFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
      fs.renameSync(tmp, indexFile);
    }).catch((err) => log('index update failed:', err?.message ?? err));
    return indexChain;
  }
  function cached(slug) {
    const e = readIndex()[slug];
    if (e && fs.existsSync(path.join(placesDir, slug, 'pano_2048.jpg'))) return e;
    return null;
  }
  const publicEntry = (e) => ({ url: e.url, hi: e.hi, preview: e.preview, meta: { ...(e.meta ?? {}), spec: e.spec ?? null, name: e.name } });

  // ------------------------------------------------------------ worker lifecycle (same pattern as gen3d)
  async function probe(port, tries, delayMs, gone = () => false) {
    for (let i = 0; i < tries; i++) {
      if (state.shuttingDown) return false;
      try {
        const r = await httpJson('GET', port, '/health', undefined, 2500);
        if (r.status === 200 && r.body?.ok) return true;
      } catch { /* not up yet */ }
      if (gone()) return false;
      await sleep(delayMs);
    }
    return false;
  }
  function startWorkerOnce() {
    return new Promise(async (resolve, reject) => {
      try {
        if (await probe(PREFERRED_PORT, 1, 0)) { state.port = PREFERRED_PORT; state.startedByUs = false; state.worker = 'ready'; return resolve(); }
        const port = await freePort(PREFERRED_PORT);
        const script = toWsl(path.join(root, 'server', 'travel', 'start_worker.sh'));
        log(`starting WSL worker (${distro}) on 127.0.0.1:${port}`);
        fs.mkdirSync(logDir, { recursive: true });
        let spawnError = null;
        let gone = false;
        const child = spawn('wsl.exe', ['-d', distro, '--', 'bash', script, '--port', String(port), '--host', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
        child.on('error', (err) => { spawnError = err; });
        child.on('exit', (code) => {
          gone = true;
          if (state.child === child) {
            state.child = null;
            if (!state.shuttingDown && state.worker !== 'stopped') { state.worker = 'stopped'; state.lastError = `worker exited (${code})`; log(state.lastError); }
          }
        });
        state.child = child; state.port = port; state.startedByUs = true;
        const ok = await probe(port, 90, 700, () => gone);
        if (ok) { state.worker = 'ready'; state.lastError = null; return resolve(); }
        const why = spawnError
          ? (spawnError.code === 'ENOENT' ? 'WSL (wsl.exe) is not installed' : spawnError.message)
          : 'the WSL worker did not start (is the Ubuntu distro installed and ~/travel/venv set up?)';
        killChild();
        reject(new Error(why));
      } catch (err) { reject(err); }
    });
  }
  function ensureWorker() {
    if (state.worker === 'ready' && state.child?.exitCode === null) return Promise.resolve();
    if (state.worker === 'ready' && !state.startedByUs) return Promise.resolve();
    if (state.startPromise) return state.startPromise;
    state.worker = 'starting';
    state.startPromise = startWorkerOnce().catch((err) => { state.worker = 'error'; state.lastError = err.message; throw err; }).finally(() => { state.startPromise = null; });
    return state.startPromise;
  }
  function killChild() {
    const c = state.child;
    state.child = null;
    if (!c) return;
    try { if (c.exitCode === null) execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* ignore */ }
  }
  async function stopWorker() {
    const port = state.port;
    if (state.startedByUs && port) { try { await httpJson('POST', port, '/shutdown', {}, 3000); } catch { /* already gone */ } }
    for (let i = 0; i < 10 && port; i++) {
      try { await httpJson('GET', port, '/health', undefined, 500); await sleep(300); } catch { break; }
    }
    killChild();
    state.worker = 'stopped';
  }
  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (inflight.size === 0 && state.worker === 'ready' && state.startedByUs) { log('idle: stopping the worker'); stopWorker().catch(() => {}); }
    }, WORKER_IDLE_STOP_MS);
    idleTimer.unref?.();
  }

  // ------------------------------------------------------------ one place
  async function runJob(entry, prompt, o, slug) {
    const post = (patch) => { entry.last = { ...patch }; for (const id of entry.clients) emit({ type: 'place_status', id, url: null, ...entry.last }); };
    const fail = (message) => { post({ state: 'error', message }); return entry.last; };
    let attempt = 0;
    let lastErr = '';
    while (attempt < 2) {
      attempt++;
      try {
        post({ state: 'queued', message: attempt > 1 ? 'Restarting the dreamer' : 'Waking the dreamer' });
        await ensureWorker();
        const sub = await httpJson('POST', state.port, '/place', { prompt: o.subject ?? prompt, slug, seed: o.seed, hi: o.hi, image: o.imageWsl, fov: o.fov, horizon_y: o.horizonY });
        if (sub.status !== 200 || !sub.body?.job) throw new Error(sub.body?.error || `worker refused the job (${sub.status})`);
        const jobId = sub.body.job;
        const deadline = Date.now() + JOB_TIMEOUT_MS + 30000;
        let lastKey = '';
        let misses = 0;
        for (;;) {
          if (state.shuttingDown) return fail('The server is shutting down.');
          if (Date.now() > deadline) throw new Error('the place took longer than 20 minutes');
          let v;
          try { v = (await httpJson('GET', state.port, `/jobs/${jobId}`)).body; misses = 0; } catch (err) { if (++misses >= 5) throw new Error(`lost contact with the worker (${err.message})`); await sleep(1000); continue; }
          if (v.error && v.state !== 'error') throw new Error(v.error);
          const key = `${v.state}|${v.message}|${Math.round((v.progress ?? 0) * 10)}|${v.queue_position ?? ''}`;
          if (key !== lastKey && v.state !== 'done' && v.state !== 'error') {
            lastKey = key;
            post({ state: v.state === 'analyzing' ? 'dreaming' : v.state === 'refining' ? 'dreaming' : v.state, message: v.message, progress: v.progress });
          }
          if (v.state === 'error') { lastErr = v.error || 'generation failed'; throw Object.assign(new Error(lastErr), { final: true }); }
          if (v.state === 'done') {
            const dest = path.join(placesDir, slug);
            const tmp = `${dest}.${process.pid}.tmp`;
            fs.rmSync(tmp, { recursive: true, force: true });
            fs.mkdirSync(tmp, { recursive: true });
            const outDir = fromWsl(v.out_dir);
            for (const f of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, f), path.join(tmp, f));
            fs.rmSync(dest, { recursive: true, force: true });
            fs.renameSync(tmp, dest);
            const base = `/assets/generated/places/${slug}`;
            const e = {
              name: o.name ?? prompt.slice(0, 40), prompt, created: new Date().toISOString(), seed: o.seed,
              url: `${base}/pano_2048.jpg`, hi: `${base}/pano_4096.webp`, preview: `${base}/tiny.webp`,
              meta: v.meta, spec: o.spec ?? null, seconds: v.stats?.total_seconds, model: 'Z-Image-Turbo', hiMode: o.hi,
            };
            await updateIndex(slug, e);
            log(`done ${slug}: ${v.stats?.total_seconds}s, seam ratio ${v.meta?.seam?.after?.ratio}`);
            entry.last = { state: 'done', message: 'Done', progress: 1, slug, ...publicEntry(e) };
            for (const id of entry.clients) emit({ type: 'place_status', id, ...entry.last });
            return entry.last;
          }
          await sleep(1000);
        }
      } catch (err) {
        lastErr = err?.message ?? String(err);
        log(`attempt ${attempt} failed: ${lastErr}`);
        if (err?.final || state.shuttingDown) break;
        if (attempt < 2) { state.worker = 'stopped'; try { await stopWorker(); } catch { /* ignore */ } }
      }
    }
    state.lastError = lastErr;
    return fail(/WSL|wsl/.test(lastErr) ? `Travel generation is unavailable: ${lastErr}` : `The place would not form: ${lastErr}`);
  }

  // ------------------------------------------------------------ public API
  function request({ id, prompt, options } = {}) {
    try {
      id = id ?? crypto.randomUUID();
      const clean = cleanPrompt(prompt);
      if (!clean) { const m = { type: 'place_status', id, state: 'error', message: 'Empty prompt', url: null }; emit(m); return Promise.resolve(m); }
      const opts = options && typeof options === 'object' ? options : {};
      const seed = Number.isFinite(Number(opts.seed)) && opts.seed !== null && opts.seed !== '' ? Math.trunc(Number(opts.seed)) & 0x7fffffff : Math.floor(Math.random() * 0x7fffffff);
      // options.image: a PNG / JPG / WebP under the game folder, used as the starting point (the view in front of the player)
      let imageWsl, imageKey = '';
      if (opts.image !== undefined && opts.image !== null && opts.image !== '') {
        try {
          const abs = path.resolve(String(opts.image));
          const rel = path.relative(root, abs);
          if (rel.startsWith('..') || path.isAbsolute(rel) || !/\.(png|jpe?g|webp)$/i.test(abs) || !fs.statSync(abs).isFile()) throw new Error('not an image under the game folder');
          const st = fs.statSync(abs);
          imageWsl = toWsl(abs); imageKey = `|img:${rel}:${st.size}:${Math.round(st.mtimeMs)}`;
        } catch (err) { const m = { type: 'place_status', id, state: 'error', message: `Cannot use that picture: ${err.message}`, url: null }; emit(m); return Promise.resolve(m); }
      }
      const slug = cleanSlug(opts.slug) || slugFor(clean, `${opts.seed ?? ''}${imageKey}`);
      const o = {
        imageWsl, fov: Number.isFinite(Number(opts.fov)) ? Number(opts.fov) : undefined, horizonY: Number.isFinite(Number(opts.horizonY)) ? Math.min(0.9, Math.max(0.1, Number(opts.horizonY))) : undefined,
        seed, slug,
        hi: opts.hi === 'refine' ? 'refine' : 'fast',
        name: typeof opts.name === 'string' ? opts.name.slice(0, 60) : undefined,
        spec: opts.spec && typeof opts.spec === 'object' ? opts.spec : null,
        subject: typeof opts.subject === 'string' ? cleanPrompt(opts.subject) : undefined,
      };
      const hit = cached(slug);
      if (hit && !opts.force) {
        const m = { type: 'place_status', id, state: 'done', message: 'Already known to the Omnissiah', slug, ...publicEntry(hit) };
        emit(m);
        return Promise.resolve(m);
      }
      let entry = inflight.get(slug);
      if (entry) {
        entry.clients.add(id);
        emit({ type: 'place_status', id, url: null, ...entry.last });
        return entry.promise.then(() => entry.last);
      }
      if (inflight.size >= MAX_PENDING) { const m = { type: 'place_status', id, state: 'error', message: 'Too many places are being dreamed at once', url: null }; emit(m); return Promise.resolve(m); }
      entry = { clients: new Set([id]), last: { state: 'queued', message: 'Queued' } };
      inflight.set(slug, entry);
      emit({ type: 'place_status', id, url: null, ...entry.last });
      touch();
      entry.promise = runJob(entry, clean, o, slug)
        .catch((err) => { log('unexpected:', err); entry.last = { state: 'error', message: `The place would not form: ${err?.message ?? err}` }; for (const c of entry.clients) emit({ type: 'place_status', id: c, url: null, ...entry.last }); return entry.last; })
        .finally(() => { inflight.delete(slug); touch(); });
      return entry.promise;
    } catch (err) {
      log('request failed:', err);
      const m = { type: 'place_status', id, state: 'error', message: `The place would not form: ${err?.message ?? err}`, url: null };
      emit(m);
      return Promise.resolve(m);
    }
  }

  const list = () => Object.entries(readIndex()).map(([slug, e]) => ({ slug, name: e.name, prompt: e.prompt }));
  const status = () => ({ worker: state.worker, port: state.port, active: inflight.size, lastError: state.lastError, distro, cached: Object.keys(readIndex()).length });
  async function shutdown() {
    state.shuttingDown = true;
    clearTimeout(idleTimer);
    try { await stopWorker(); } catch { /* ignore */ }
  }
  return { request, status, shutdown, list, slugFor: (p, s) => slugFor(cleanPrompt(p), s), readIndex };
}

