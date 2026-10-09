// Omnissiah audio service: text -> sound effect / ambience / music through the local WSL worker
// (MOSS-SoundEffect v2.0 + ACE-Step 1.5). See server/audio/README.md and docs/CONTRACT.md ("v4 additions").
// Used by server/plugins/audio.js (game protocol) and by server/audio/make_pack.mjs (starter pack).
//
//   const a = createAudio({ root, send });        // send(msg) broadcasts a server->client message
//   a.request({ kind:'sfx'|'music', id, prompt, seconds, loop, seed })   never throws; resolves with the final status
//   a.generateFile({ kind, prompt, seconds, loop, seed, single, expect, bpm }, destFile)   -> stats (used by the pack builder)
//   a.status()   a.shutdown()
//
// Client -> server  { type:'sfx'|'music', id, prompt, seconds?, loop?, seed? }
// Server -> client  { type:'audio_status', id, kind, state:'queued'|'generating'|'done'|'error', url, message, progress? }
// Cache: public/assets/generated/audio/{sfx,music}/<slug>.ogg + index.json per kind
//        ({ slug: { prompt, url, seconds, kind, loop, created, bytes } }).
// Node built-ins only. Prompts only ever travel as JSON over HTTP to 127.0.0.1, never through a shell.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_PROMPT = 300;
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
const WORKER_IDLE_STOP_MS = 20 * 60 * 1000; // stop the (tiny) worker process after 20 idle minutes (it unloads the models after 5)
const PREFERRED_PORT = 18775;
const MAX_PENDING = 48; // distinct generations waiting at once; more are refused so a runaway creation cannot flood the GPU
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createAudio({ root, send = () => {}, log = (...a) => console.log('[audio]', ...a), env = process.env } = {}) {
  root = path.resolve(root ?? '.');
  const audioDir = path.join(root, 'public', 'assets', 'generated', 'audio');
  const logDir = path.join(root, '.cache', 'audio');
  const distro = env.AUDIO_DISTRO || 'Ubuntu';
  const emit = (msg) => { try { send(msg); } catch (err) { log('send failed:', err?.message ?? err); } };

  const state = {
    worker: 'stopped', // stopped | starting | ready | error
    port: null, child: null, startedByUs: false, startPromise: null, lastError: null, lastActivity: Date.now(), shuttingDown: false,
  };
  const inflight = new Map(); // `${kind}:${slug}` -> { clients:Set<id>, promise, last }
  const indexChains = { sfx: Promise.resolve(), music: Promise.resolve() };
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
  const cleanPrompt = (raw) =>
    String(raw ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT).trim();
  const normPrompt = (p) => p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // identical to the key the client computes in core/audio.js (same words, same hash input): slug = words + 6 hex of sha1
  const slugFor = (kind, prompt, seconds, loop) => {
    const norm = normPrompt(prompt);
    const words = norm.normalize('NFKD').replace(/[^a-z0-9 ]+/g, '').trim().split(' ').filter(Boolean).join('-').slice(0, 32).replace(/-+$/, '');
    const hash = crypto.createHash('sha1').update(`${kind}|${norm}|${seconds}|${loop ? 'loop' : ''}`).digest('hex').slice(0, 6);
    return `${words || kind}-${hash}`;
  };
  const clampSeconds = (kind, s, loop) => {
    let v = Number(s);
    if (!Number.isFinite(v) || v <= 0) v = kind === 'music' ? 60 : loop ? 20 : 2;
    if (kind === 'music') return Math.round(Math.min(240, Math.max(4, v)));
    v = Math.min(30, Math.max(0.4, v));
    if (loop) v = Math.max(6, v);
    return Math.round(v * 10) / 10;
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
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); }
          catch (err) { reject(err); }
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

  // ------------------------------------------------------------ cache index (one per kind)
  const kindDir = (kind) => path.join(audioDir, kind);
  const indexFile = (kind) => path.join(kindDir(kind), 'index.json');
  function readIndex(kind) {
    let text;
    try { text = fs.readFileSync(indexFile(kind), 'utf8'); } catch { return {}; }
    try {
      const j = JSON.parse(text.replace(/^ï»¿/, ''));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch {
      try { fs.copyFileSync(indexFile(kind), `${indexFile(kind)}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return {};
    }
  }
  function updateIndex(kind, slug, entry) {
    indexChains[kind] = indexChains[kind].then(() => {
      fs.mkdirSync(kindDir(kind), { recursive: true });
      const idx = readIndex(kind);
      idx[slug] = entry;
      const tmp = `${indexFile(kind)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
      fs.renameSync(tmp, indexFile(kind));
    }).catch((err) => log('index update failed:', err?.message ?? err));
    return indexChains[kind];
  }
  function cached(kind, slug) {
    const e = readIndex(kind)[slug];
    if (e && fs.existsSync(path.join(kindDir(kind), `${slug}.ogg`))) return e;
    return null;
  }

  // ------------------------------------------------------------ worker lifecycle
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
        const script = toWsl(path.join(root, 'server', 'audio', 'start_worker.sh'));
        log(`starting WSL worker (${distro}) on 127.0.0.1:${port}`);
        fs.mkdirSync(logDir, { recursive: true });
        let spawnError = null;
        let gone = false;
        const child = spawn('wsl.exe', ['-d', distro, '--', 'bash', script, '--port', String(port), '--host', '127.0.0.1'], {
          windowsHide: true, stdio: 'ignore',
        });
        child.on('error', (err) => { spawnError = err; });
        child.on('exit', (code) => {
          gone = true;
          if (state.child === child) {
            state.child = null;
            if (!state.shuttingDown && state.worker !== 'stopped') { state.worker = 'stopped'; state.lastError = `worker exited (${code})`; log(state.lastError); }
          }
        });
        state.child = child; state.port = port; state.startedByUs = true;
        const ok = await probe(port, 60, 700, () => gone);
        if (ok) { state.worker = 'ready'; state.lastError = null; return resolve(); }
        const why = spawnError
          ? (spawnError.code === 'ENOENT' ? 'WSL (wsl.exe) is not installed' : spawnError.message)
          : 'the WSL audio worker did not start (is the Ubuntu distro installed and ~/audio set up?)';
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
    state.startPromise = startWorkerOnce().catch((err) => {
      state.worker = 'error'; state.lastError = err.message; throw err;
    }).finally(() => { state.startPromise = null; });
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
    for (let i = 0; i < 10 && port && state.startedByUs; i++) {
      try { await httpJson('GET', port, '/health', undefined, 500); await sleep(300); } catch { break; }
    }
    killChild();
    state.worker = 'stopped';
  }

  function touch() {
    state.lastActivity = Date.now();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (inflight.size === 0 && state.worker === 'ready' && state.startedByUs) { log('idle: stopping the worker'); stopWorker().catch(() => {}); }
    }, WORKER_IDLE_STOP_MS);
    idleTimer.unref?.();
  }

  // ------------------------------------------------------------ one generation on the worker
  // spec: { kind, prompt, seconds, loop, seed, single, expect, bpm, bitrate }; onStatus({state,message,progress}); returns { file, stats }
  async function runOnWorker(spec, onStatus = () => {}) {
    let attempt = 0;
    let lastErr = '';
    while (attempt < 2) {
      attempt++;
      try {
        onStatus({ state: 'queued', message: attempt > 1 ? 'Restarting the sound studio' : 'Waking the sound studio' });
        await ensureWorker();
        const body = spec.kind === 'music'
          ? { prompt: spec.prompt, seconds: spec.seconds, seed: spec.seed, loop: !!spec.loop, bpm: spec.bpm, bitrate: spec.bitrate, candidates: spec.candidates, score: !!spec.score }
          : { prompt: spec.prompt, seconds: spec.seconds, seed: spec.seed, loop: !!spec.loop, single: !!spec.single, expect: spec.expect, bitrate: spec.bitrate, candidates: spec.candidates, score: !!spec.score };
        const sub = await httpJson('POST', state.port, spec.kind === 'music' ? '/music' : '/sfx', body);
        if (sub.status !== 200 || !sub.body?.job) throw new Error(sub.body?.error || `worker refused the job (${sub.status})`);
        const jobId = sub.body.job;
        const deadline = Date.now() + JOB_TIMEOUT_MS + 30000;
        let lastKey = '';
        let misses = 0;
        for (;;) {
          if (state.shuttingDown) throw Object.assign(new Error('The server is shutting down.'), { final: true });
          if (Date.now() > deadline) throw new Error('generation took longer than 8 minutes');
          let v;
          try { v = (await httpJson('GET', state.port, `/jobs/${jobId}`)).body; misses = 0; }
          catch (err) { if (++misses >= 5) throw new Error(`lost contact with the worker (${err.message})`); await sleep(1000); continue; }
          const wire = v.state === 'processing' ? 'generating' : v.state;
          const key = `${wire}|${v.message}|${Math.round((v.progress ?? 0) * 10)}|${v.queue_position ?? ''}`;
          if (key !== lastKey && v.state !== 'done' && v.state !== 'error') {
            lastKey = key;
            onStatus({ state: wire, message: v.message, progress: v.progress, ...(v.queue_position ? { queue_position: v.queue_position } : {}) });
          }
          if (v.state === 'error') throw Object.assign(new Error(v.error || 'generation failed'), { final: true });
          if (v.state === 'done') return { file: fromWsl(v.file_path), stats: v.stats ?? {} };
          await sleep(v.state === 'queued' ? 700 : 500);
        }
      } catch (err) {
        lastErr = err?.message ?? String(err);
        log(`attempt ${attempt} failed: ${lastErr}`);
        if (err?.final || state.shuttingDown) break;
        if (attempt < 2) { state.worker = 'stopped'; try { await stopWorker(); } catch { /* ignore */ } }
      }
    }
    state.lastError = lastErr;
    throw new Error(/WSL|wsl/.test(lastErr) ? `Local sound generation is unavailable: ${lastErr}` : lastErr);
  }

  // The pack builder: generate into an arbitrary destination (atomic copy), no cache index involved.
  async function generateFile(spec, destFile, onStatus) {
    touch();
    const { file, stats } = await runOnWorker(spec, onStatus);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    const tmp = `${destFile}.${process.pid}.tmp`;
    fs.copyFileSync(file, tmp);
    fs.renameSync(tmp, destFile);
    touch();
    return stats;
  }

  // ------------------------------------------------------------ cached request (game protocol)
  async function runRequest(entry, kind, prompt, seconds, loop, seed, slug) {
    const post = (patch) => {
      entry.last = { ...patch };
      for (const id of entry.clients) emit({ type: 'audio_status', id, kind, url: null, ...entry.last });
    };
    try {
      const { file, stats } = await runOnWorker({ kind, prompt, seconds, loop, seed }, post);
      fs.mkdirSync(kindDir(kind), { recursive: true });
      const dest = path.join(kindDir(kind), `${slug}.ogg`);
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.copyFileSync(file, tmp);
      fs.renameSync(tmp, dest);
      const url = `/assets/generated/audio/${kind}/${slug}.ogg`;
      await updateIndex(kind, slug, {
        prompt, url, seconds, kind: loop ? 'loop' : (kind === 'music' ? 'music' : 'oneshot'), loop: !!loop,
        created: new Date().toISOString(), bytes: stats.bytes, duration: stats.duration, warnings: stats.warnings?.length ? stats.warnings : undefined,
      });
      log(`done ${slug}: ${stats.duration}s, ${stats.bytes} bytes, ${stats.total_seconds}s`);
      entry.last = { state: 'done', message: 'Done', url, progress: 1 };
    } catch (err) {
      state.lastError = err?.message ?? String(err);
      entry.last = { state: 'error', message: `Sound generation failed: ${state.lastError}`, url: null };
    }
    for (const id of entry.clients) emit({ type: 'audio_status', id, kind, url: null, ...entry.last });
    return entry.last;
  }

  function request({ kind, id, prompt, seconds, loop, seed } = {}) {
    id = id ?? crypto.randomUUID();
    try {
      kind = kind === 'music' ? 'music' : 'sfx';
      const clean = cleanPrompt(prompt);
      if (!clean) { const m = { type: 'audio_status', id, kind, state: 'error', message: 'Empty prompt', url: null }; emit(m); return Promise.resolve(m); }
      loop = kind === 'music' ? loop !== false && loop !== 0 : !!loop; // music defaults to a loop, sound effects to a one-shot
      const secs = clampSeconds(kind, seconds, loop);
      const slug = slugFor(kind, clean, secs, loop);
      const hit = cached(kind, slug);
      if (hit) {
        const m = { type: 'audio_status', id, kind, state: 'done', message: 'Already known to the Omnissiah', url: hit.url };
        emit(m);
        return Promise.resolve(m);
      }
      const key = `${kind}:${slug}`;
      let entry = inflight.get(key);
      if (entry) {
        entry.clients.add(id);
        emit({ type: 'audio_status', id, kind, url: null, ...entry.last });
        return entry.promise.then(() => entry.last);
      }
      if (inflight.size >= MAX_PENDING) {
        const m = { type: 'audio_status', id, kind, state: 'error', message: 'The sound studio is busy; try again in a minute.', url: null };
        emit(m);
        return Promise.resolve(m);
      }
      entry = { clients: new Set([id]), last: { state: 'queued', message: 'Queued' } };
      inflight.set(key, entry);
      emit({ type: 'audio_status', id, kind, url: null, ...entry.last });
      touch();
      const sd = seed !== undefined && Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) & 0x7fffffff : undefined;
      entry.promise = runRequest(entry, kind, clean, secs, loop, sd, slug)
        .catch((err) => { log('unexpected:', err); entry.last = { state: 'error', message: `Sound generation failed: ${err?.message ?? err}` }; for (const c of entry.clients) emit({ type: 'audio_status', id: c, kind, url: null, ...entry.last }); return entry.last; })
        .finally(() => { inflight.delete(key); touch(); });
      return entry.promise;
    } catch (err) {
      log('request failed:', err);
      const m = { type: 'audio_status', id, kind, state: 'error', message: `Sound generation failed: ${err?.message ?? err}`, url: null };
      emit(m);
      return Promise.resolve(m);
    }
  }

  const status = () => ({
    worker: state.worker, port: state.port, active: inflight.size, lastError: state.lastError, distro,
    cached: { sfx: Object.keys(readIndex('sfx')).length, music: Object.keys(readIndex('music')).length },
  });

  async function shutdown() {
    state.shuttingDown = true;
    clearTimeout(idleTimer);
    try { await stopWorker(); } catch { /* ignore */ }
  }

  return { request, generateFile, status, shutdown, slugFor, audioDir };
}
