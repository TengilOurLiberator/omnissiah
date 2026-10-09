// Omnissiah gen3d: text -> game-ready GLB through the local WSL worker (Z-Image-Turbo + TRELLIS.2).
// See server/gen3d/README.md and docs/CONTRACT.md ("v3 additions").
//
//   const g = createGen3d({ root, send });          // send(msg) broadcasts a server->client message (one instance per root: a second call returns it)
//   g.request({ id, prompt, options })              // never throws; resolves with the final status
//   g.generateModel({ prompt, image, options })     // for server plugins; also exported: import { generateModel } from './gen3d.js'
//                                                   //   -> Promise<{ url, slug, meta } | null>, never throws, same queue / cache / worker as browser requests
//   g.status()   g.shutdown()
//
// IMAGE INPUT  options.image = absolute path (under the game root) of a PNG / JPG / WEBP showing ONE object on a plain background: the text-to-image
//   stage is skipped, the picture goes straight to TRELLIS (it removes the background). Cache key = sha1(image bytes) + quality + seed; the prompt is
//   optional (just a label).
//
// Client -> server  { type:'gen3d', id, prompt, options:{ quality:'low'|'standard'|'high', seed?, animate?: true } }   (OPT-IN, experimental)
//   animate: the finished mesh is also rigged (UniRig) and given baked clips (idle walk run attack hit die ..., see server/gen3d/README.md);
//   Only an explicit animate:true does this; the default (and 'auto') is the plain static model. If rigging fails or is not possible the static model is\n//   delivered with a message ('Done (static: ...)').
//   animate:true on an already cached static prompt rigs the existing mesh without regenerating it.
// Server -> client  { type:'gen3d_status', id, state:'queued'|'imagining'|'sculpting'|'done'|'error',
//                     message, url, progress?, rigged?, bodyPlan?, clips? }   (rigging is reported as state 'sculpting': 'Finding its bones', 'Teaching it to walk')
// Node built-ins only. The prompt only ever travels as JSON over HTTP to 127.0.0.1, never through a shell.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

const QUALITIES = ['low', 'standard', 'high'];
const MAX_PROMPT = 200;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const WORKER_IDLE_STOP_MS = 30 * 60 * 1000; // stop the (tiny) worker process after 30 idle minutes
const PREFERRED_PORT = 18765;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- does a wish describe something that should move? (animate: 'auto')
const ALIVE = new Set(('person man woman boy girl child kid knight warrior soldier guard guardsman wizard mage sorcerer witch goblin hobgoblin orc troll ogre giant zombie skeleton ghost vampire demon devil angel elf dwarf gnome '
  + 'halfling robot android golem cyborg monster beast creature alien animal dog puppy wolf cat kitten lion tiger leopard panther bear horse pony stallion deer stag elk moose cow bull ox pig boar sheep goat rabbit bunny hare fox '
  + 'mouse rat bat bird eagle hawk falcon owl crow raven parrot penguin chicken rooster duck goose swan snake serpent cobra python viper lizard gecko dragon wyvern drake turtle tortoise frog toad fish shark whale dolphin crab lobster '
  + 'spider scorpion ant bee wasp beetle insect bug butterfly moth dragonfly worm centipede caterpillar slug snail slime blob jellyfish octopus squid kraken unicorn griffin gryphon phoenix centaur mermaid minotaur hydra sphinx yeti '
  + 'bigfoot dinosaur trex raptor mammoth elephant giraffe monkey ape gorilla chimp panda koala kangaroo hedgehog squirrel otter beaver imp gargoyle wraith specter spectre phantom mummy pirate ninja samurai viking king queen '
  + 'princess prince farmer villager peasant merchant hero heroine paladin archer ranger rogue thief assassin bandit barbarian gladiator cultist priest monk nun mech eyeball beholder wisp spirit fairy pixie sprite ent treant '
  + 'elemental hound wolfhound pegasus chimera manticore basilisk cockatrice banshee lich reaper cat-like drone crow mantis cricket firefly').split(' '));
const NOT_ALIVE = new Set('statue figurine sculpture carving carved toy painting portrait picture bust model trophy totem tombstone gravestone armor armour helmet shield sword axe hammer bow staff wand dagger spear lantern chest barrel crate table chair house hut castle tower bridge wall fence tree bush plant flower cactus mushroom rock boulder crystal mountain car truck cart wagon ship boat sailboat bed lamp candle sign door gate fountain well cannon'.split(' '));
const SPLIT = /\b(?:with|holding|wielding|carrying|wearing|in|on|made of|from|that|which|riding|beside|next to|near|and its|and his|and her|at|under)\b|[,.;:]/;
export function looksAlive(prompt) {
  const p = String(prompt ?? '').toLowerCase().replace(/[^a-z0-9\-' ,.;:]/g, ' ');
  if (/\b(statue|figurine|sculpture|carving|toy|painting|portrait|bust|trophy|tombstone|mount(?:ed)? head|made of stone and still)\b/.test(p)) return false;
  const head = p.split(SPLIT)[0].trim().split(/\s+/).map((w) => w.replace(/'s$/, '').replace(/s$/, (m, i, s) => (ALIVE.has(s.slice(0, -1)) ? '' : m)));
  const tail = head.slice(-3);
  // the head noun decides: "a crystal beast" -> beast (alive) beats "crystal" (not alive); "a sword" -> static
  for (let i = tail.length - 1; i >= 0; i--) {
    const w = tail[i];
    if (ALIVE.has(w)) return true;
    if (NOT_ALIVE.has(w)) return false;
  }
  return p.split(/\s+/).some((w) => ALIVE.has(w.replace(/s$/, '')) && !NOT_ALIVE.has(w));
}

const instances = new Map(); // root -> instance (so a plugin and the WebSocket handler share one queue, one cache, one worker)
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function createGen3d(args = {}) {
  const root = path.resolve(args.root ?? '.');
  let inst = instances.get(root);
  if (inst) { if (typeof args.send === 'function') inst.sends.add(args.send); return inst; }
  const sends = new Set(typeof args.send === 'function' ? [args.send] : []);
  inst = buildGen3d({ ...args, root, sends });
  inst.sends = sends;
  instances.set(root, inst);
  return inst;
}

// For server plugins that have no handle on the instance: uses the one index.js created, or makes one (default root = this repo).
export function generateModel(args = {}) {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const g = instances.get(path.resolve(args.root ?? path.join(here, '..'))) ?? createGen3d({ root: args.root ?? path.join(here, '..') });
    return g.generateModel(args);
  } catch { return Promise.resolve(null); }
}

function buildGen3d({ root, sends, log = (...a) => console.log('[gen3d]', ...a), env = process.env } = {}) {
  const genDir = path.join(root, 'public', 'assets', 'generated');
  const indexFile = path.join(genDir, 'index.json');
  const logDir = path.join(root, '.cache', 'gen3d');
  const distro = env.GEN3D_DISTRO || 'Ubuntu';
  const quiet = new Set();          // ids of plugin requests: not broadcast to browsers
  const watchers = new Map();       // id -> status callback (plugin progress)
  const emit = (msg) => {
    const w = msg && watchers.get(msg.id);
    if (w) { try { w(msg); } catch { /* plugin callback failed */ } }
    if (msg && quiet.has(msg.id)) return;
    for (const send of sends) { try { send(msg); } catch (err) { log('send failed:', err?.message ?? err); } }
  };

  const state = {
    worker: 'stopped', // stopped | starting | ready | error
    port: null,
    child: null,
    startedByUs: false,
    startPromise: null,
    lastError: null,
    lastActivity: Date.now(),
    shuttingDown: false,
  };
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
  const cleanPrompt = (raw) =>
    String(raw ?? '')
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PROMPT)
      .trim();
  const slugForImage = (prompt, imgHash, quality, seed) => {
    const words = (prompt || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).join('-').slice(0, 24).replace(/-+$/, '');
    return `${words || 'image'}-${crypto.createHash('sha1').update(`${imgHash}|${quality}|${seed ?? ''}`).digest('hex').slice(0, 8)}`;
  };
  // an image the caller names must be a real picture file under the game root (never an arbitrary path)
  function checkImage(p) {
    const abs = path.resolve(String(p));
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('image must be inside the game folder');
    if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) throw new Error('image must be .png, .jpg or .webp');
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size < 100 || st.size > MAX_IMAGE_BYTES) throw new Error('image file is missing, empty or too large');
    return { abs, hash: crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex') };
  }
  const slugFor = (prompt, quality, seed) => {
    const norm = prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const words = norm.normalize('NFKD').replace(/[^a-z0-9 ]+/g, '').trim().split(' ').filter(Boolean).join('-').slice(0, 32).replace(/-+$/, '');
    const hash = crypto.createHash('sha1').update(`${norm}|${quality}|${seed ?? ''}`).digest('hex').slice(0, 6);
    return `${words || 'model'}-${hash}`;
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

  // ------------------------------------------------------------ cache index
  function readIndex() {
    let text;
    try { text = fs.readFileSync(indexFile, 'utf8'); } catch { return {}; } // no index yet
    try {
      const j = JSON.parse(text.replace(/^﻿/, ''));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch {
      // never silently throw away a hand-edited / damaged index: keep a copy, start a fresh one
      try { fs.copyFileSync(indexFile, `${indexFile}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return {};
    }
  }
  function updateIndex(slug, entry) {
    indexChain = indexChain.then(() => {
      fs.mkdirSync(genDir, { recursive: true });
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
    if (e && fs.existsSync(path.join(genDir, `${slug}.glb`))) return e;
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
      if (gone()) return false; // wsl.exe already exited: no point waiting
      await sleep(delayMs);
    }
    return false;
  }

  function startWorkerOnce() {
    return new Promise(async (resolve, reject) => {
      try {
        // reuse a worker someone started by hand (see README) on the preferred port
        if (await probe(PREFERRED_PORT, 1, 0)) { state.port = PREFERRED_PORT; state.startedByUs = false; state.worker = 'ready'; return resolve(); }
        const port = await freePort(PREFERRED_PORT);
        const script = toWsl(path.join(root, 'server', 'gen3d', 'start_worker.sh'));
        log(`starting WSL worker (${distro}) on 127.0.0.1:${port}`);
        fs.mkdirSync(logDir, { recursive: true });
        let spawnError = null;
        let gone = false; // wsl.exe has exited
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
        const ok = await probe(port, 90, 700, () => gone);
        if (ok) { state.worker = 'ready'; state.lastError = null; return resolve(); }
        const why = spawnError
          ? (spawnError.code === 'ENOENT' ? 'WSL (wsl.exe) is not installed' : spawnError.message)
          : 'the WSL worker did not start (is the Ubuntu distro installed and healthy?)';
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
    for (let i = 0; i < 10 && port; i++) { // wait until the port is really closed (avoids re-adopting a dying worker)
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

  // ------------------------------------------------------------ one generation
  // Index fields a rigged model carries (see server/gen3d/README.md "Rigged models")
  const RIG_FIELDS = ['bodyPlan', 'humanoid', 'clips', 'height', 'size', 'speeds', 'headBone', 'mouthBone', 'mouth', 'bones', 'limbs', 'counts', 'facing', 'events', 'upright', 'bodyPlanReason'];
  function rigEntry(rig) {
    if (!rig) return {};
    if (rig.rigged && rig.meta) {
      const e = { rigged: true, rigTried: true, rigSeconds: rig.seconds, rigMethod: rig.stats?.method };
      for (const k of RIG_FIELDS) if (rig.meta[k] !== undefined) e[k] = rig.meta[k];
      return e;
    }
    return rig.requested ? { rigged: false, ...(rig.transient ? {} : { rigTried: true }), rigReason: rig.reason ?? 'not rigged' } : {};   // timeouts / crashes are not final: animate:true may try again
  }

  async function runJob(entry, prompt, quality, seed, slug, animate = false, upgrade = null, image = null) {
    const post = (patch) => {
      entry.last = { ...patch };
      for (const id of entry.clients) emit({ type: 'gen3d_status', id, url: null, ...entry.last });
    };
    const fail = (message) => { post({ state: 'error', message }); return entry.last; };

    let attempt = 0;
    let lastErr = '';
    while (attempt < 2) {
      attempt++;
      try {
        post({ state: 'queued', message: attempt > 1 ? 'Restarting the generator' : 'Waking the generator' });
        await ensureWorker();
        const sub = upgrade
          ? await httpJson('POST', state.port, '/rig', { glb_path: toWsl(upgrade.staticPath), prompt, force: true })
          : await httpJson('POST', state.port, '/generate', { prompt, quality, seed, animate, ...(image ? { image: toWsl(image.abs) } : {}) });
        if (sub.status !== 200 || !sub.body?.job) throw new Error(sub.body?.error || `worker refused the job (${sub.status})`);
        const jobId = sub.body.job;
        const deadline = Date.now() + JOB_TIMEOUT_MS + 30000;
        let lastKey = '';
        let misses = 0;
        for (;;) {
          if (state.shuttingDown) return fail('The server is shutting down.');
          if (Date.now() > deadline) throw new Error('generation took longer than 10 minutes');
          let v;
          try { v = (await httpJson('GET', state.port, `/jobs/${jobId}`)).body; misses = 0; }
          catch (err) { if (++misses >= 5) throw new Error(`lost contact with the worker (${err.message})`); await sleep(1000); continue; }
          if (v.error && v.state !== 'error') throw new Error(v.error);
          const wire = v.state === 'exporting' || v.state === 'rigging' ? 'sculpting' : v.state; // contract has no 'exporting' / 'rigging'
          const key = `${wire}|${v.message}|${Math.round((v.progress ?? 0) * 10)}|${v.queue_position ?? ''}`;
          if (key !== lastKey && v.state !== 'done' && v.state !== 'error') {
            lastKey = key;
            post({ state: wire, message: v.message, progress: v.progress, ...(v.queue_position ? { queue_position: v.queue_position } : {}) });
          }
          if (v.state === 'error') { lastErr = v.error || 'generation failed'; throw Object.assign(new Error(lastErr), { final: true }); }
          if (v.state === 'done') {
            fs.mkdirSync(genDir, { recursive: true });
            const st = v.stats ?? {};
            const rig = v.rig ?? st.rig ?? null;
            const rigged = !!(rig && rig.rigged);
            // File layout: <slug>.glb is ALWAYS the plain static model (index.json "url"); a rigged result lives next to it as <slug>.rigged.glb ("rigged_url").
            const writeAtomic = (src, destPath) => { const tmp = `${destPath}.${process.pid}.tmp`; fs.copyFileSync(src, tmp); fs.renameSync(tmp, destPath); };
            fs.mkdirSync(genDir, { recursive: true });
            const dest = path.join(genDir, `${slug}.glb`);
            const rigDest = path.join(genDir, `${slug}.rigged.glb`);
            if (rigged) writeAtomic(fromWsl(v.glb_path), rigDest);
            if (!upgrade) writeAtomic(rigged ? path.join(path.dirname(fromWsl(v.glb_path)), 'model.glb') : fromWsl(v.glb_path), dest);
            const url = `/assets/generated/${slug}.glb`;
            const riggedUrl = `/assets/generated/${slug}.rigged.glb`;
            const old = upgrade ? (readIndex()[slug] ?? {}) : {};
            const rigInfo = rigEntry(rig);
            await updateIndex(slug, {
              ...old,
              prompt, url, created: old.created ?? new Date().toISOString(), quality, seed, ...(image ? { from_image: true, image_hash: image.hash } : {}),
              triangles: st.triangles ?? old.triangles, bytes: st.bytes ?? old.bytes, texture: st.texture ?? old.texture,
              seconds: st.total_seconds ?? old.seconds,
              ...(rigged ? { rigged_url: riggedUrl, rigged_bytes: rig.meta?.bytes ?? fs.statSync(rigDest).size } : {}),
              ...rigInfo,
            });
            log(`done ${slug}: ${st.triangles ?? old?.triangles} tris, ${st.total_seconds}s${rigged ? `, rigged as ${rigInfo.bodyPlan} (${rigInfo.bones} bones, ${rig.seconds}s)` : (rig ? `, not rigged (${rigInfo.rigReason})` : '')}`);
            entry.last = { state: 'done', message: rigged ? 'Alive' : (rig ? `Done (static: ${rigInfo.rigReason})` : 'Done'), url: rigged ? riggedUrl : url, progress: 1, ...(rigged ? { rigged: true, bodyPlan: rigInfo.bodyPlan, clips: rigInfo.clips } : {}) };
            for (const id of entry.clients) emit({ type: 'gen3d_status', id, ...entry.last });
            return entry.last;
          }
          await sleep(1000);
        }
      } catch (err) {
        lastErr = err?.message ?? String(err);
        log(`attempt ${attempt} failed: ${lastErr}`);
        if (err?.final || state.shuttingDown) break;
        if (attempt < 2) { // worker probably crashed or hung: restart it once
          state.worker = 'stopped';
          try { await stopWorker(); } catch { /* ignore */ }
        }
      }
    }
    state.lastError = lastErr;
    return fail(/WSL|wsl/.test(lastErr) ? `Local 3D generation is unavailable: ${lastErr}` : `Generation failed: ${lastErr}`);
  }

  // ------------------------------------------------------------ public API
  function request({ id, prompt, options } = {}) {
    try {
      id = id ?? crypto.randomUUID();
      const clean = cleanPrompt(prompt);
      const opts = options && typeof options === 'object' ? options : {};
      let image = null;
      if (opts.image) {
        try { image = checkImage(opts.image); }
        catch (err) { const m = { type: 'gen3d_status', id, state: 'error', message: `Bad image: ${err.message}`, url: null }; emit(m); return Promise.resolve(m); }
      }
      if (!clean && !image) { const m = { type: 'gen3d_status', id, state: 'error', message: 'Empty prompt', url: null }; emit(m); return Promise.resolve(m); }
      const quality = QUALITIES.includes(opts.quality) ? opts.quality : 'standard';
      const seed = Number.isFinite(Number(opts.seed)) && opts.seed !== null && opts.seed !== '' ? Math.trunc(Number(opts.seed)) & 0x7fffffff : undefined;
      const slug = image ? slugForImage(clean, image.hash, quality, seed) : slugFor(clean, quality, seed);

      const a = opts.animate;
      const redo = a === 'redo';   // maintenance: rig a cached model again (from its .static.glb) with the current code
      // Rigging is OPT-IN for now: only an explicit animate:true ('redo' = maintenance) touches the rig stage; anything else (incl. the old 'auto') is the plain text/image -> static path.
      // (looksAlive() is kept for the day 'auto' is switched on again.)
      const animate = a === true || a === 'true' || redo;
      const hit = cached(slug);
      let upgrade = null;
      if (hit && a !== true && !redo) {   // known: static models stay static unless animate:true is asked for explicitly (a rigged entry serves its static twin)
        const m = { type: 'gen3d_status', id, state: 'done', message: 'Already known to the Omnissiah', url: hit.url };   // always the static model; the rigged twin is hit.rigged_url
        emit(m);
        return Promise.resolve(m);
      }
      if (hit) {
        if ((hit.rigged || hit.rigTried) && !redo) { // already rigged (or rigging was tried and found nothing to move)
          const m = { type: 'gen3d_status', id, state: 'done', message: hit.rigged ? 'Already alive' : `Already known (static: ${hit.rigReason ?? 'not rigged'})`, url: hit.rigged ? (hit.rigged_url ?? hit.url) : hit.url, ...(hit.rigged ? { rigged: true, bodyPlan: hit.bodyPlan, clips: hit.clips } : {}) };
          emit(m);
          return Promise.resolve(m);
        }
        upgrade = { staticPath: path.join(genDir, `${slug}.glb`) };   // rig the existing static mesh, no regeneration
      }
      let entry = inflight.get(slug);
      if (entry) { // same wish already being made: share the job
        entry.clients.add(id);
        emit({ type: 'gen3d_status', id, url: null, ...entry.last });
        return entry.promise.then(() => entry.last);
      }
      entry = { clients: new Set([id]), last: { state: 'queued', message: 'Queued' } };
      inflight.set(slug, entry);
      emit({ type: 'gen3d_status', id, url: null, ...entry.last });
      touch();
      entry.promise = runJob(entry, clean, quality, seed, slug, animate, upgrade, image)
        .catch((err) => { log('unexpected:', err); entry.last = { state: 'error', message: `Generation failed: ${err?.message ?? err}` }; for (const c of entry.clients) emit({ type: 'gen3d_status', id: c, url: null, ...entry.last }); return entry.last; })
        .finally(() => { inflight.delete(slug); touch(); });
      return entry.promise;
    } catch (err) {
      log('request failed:', err);
      const m = { type: 'gen3d_status', id, state: 'error', message: `Generation failed: ${err?.message ?? err}`, url: null };
      emit(m);
      return Promise.resolve(m);
    }
  }

  const status = () => ({
    worker: state.worker, port: state.port, active: inflight.size, lastError: state.lastError,
    distro, cached: Object.keys(readIndex()).length,
  });

  async function shutdown() {
    state.shuttingDown = true;
    clearTimeout(idleTimer);
    try { await stopWorker(); } catch { /* ignore */ }
  }

  // For server plugins: Promise<{ url, slug, meta } | null>. options.onStatus(msg) gets progress; browsers do not see these requests.
  async function generateModel({ prompt = '', image, options = {} } = {}) {
    const id = `plugin-${crypto.randomUUID()}`;
    try {
      quiet.add(id);
      if (typeof options.onStatus === 'function') watchers.set(id, options.onStatus);
      const { onStatus, ...rest } = options;
      const r = await request({ id, prompt, options: { ...rest, ...(image ? { image } : {}) } });
      if (!r || r.state !== 'done' || !r.url) return null;
      const slug = String(r.url).replace(/^.*\//, '').replace(/\.glb$/, '');
      return { url: r.url, slug, meta: readIndex()[slug] ?? null };
    } catch (err) {
      log('generateModel failed:', err?.message ?? err);
      return null;
    } finally { quiet.delete(id); watchers.delete(id); }
  }

  return { request, generateModel, status, shutdown };
}

