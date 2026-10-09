// Voices plugin: the Omnissiah's real voice (Chatterbox in a WSL worker), NPC voices (Kokoro, in Node) and talking to NPCs.
// See server/voice/README.md and docs/CONTRACT.md ("v4 additions").
//
//  * replaces api.services.tts with { synthesize(text, { voice }) } -> '/tts/om_<id>.wav' | null (null = server falls back to SAPI)
//  * client 'npc_say' {id, rid, text, voice, speed, emotion}  -> broadcast 'npc_voice' {id, rid, audio, seconds}
//  * utterance with context.npc  -> consumed here: oracle.quick() writes the reply, Kokoro speaks it, broadcast 'npc_reply'
//  * client 'voice_get' / 'voice_set' {voice} / 'voice_preview' {voice} / 'voice_warm'  -> 'voice_info' (Omnissiah voice selection)
//
// The WSL worker (server/voice/worker.py, 127.0.0.1:18770) starts lazily, keeps Chatterbox on the GPU while in use,
// unloads after 15 idle minutes and is stopped after 30. Processes we did not start are never killed.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseWav, encodeWav } from '../voice/wavutil.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = path.join(HERE, '..', 'voice');
const PREFERRED_PORT = 18770;
const WORKER_IDLE_STOP_MS = 30 * 60 * 1000;
const MODEL_HOT_MS = 14 * 60 * 1000;      // the worker unloads after 15 idle minutes
const NPC_CACHE_MAX = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The three Omnissiah voices the player can switch between (ids are keys of server/voice/voices.json).
export const OMNISSIAH_VOICES = [
  { id: 'omnissiah', label: 'The Omnissiah', desc: 'Deep, resonant machine-god. The default.' },
  { id: 'oracle', label: 'The Oracle', desc: 'Higher, calmer and doubled, like a small choir speaking as one.' },
  { id: 'titan', label: 'The Titan', desc: 'Slow, heavy and very low. Every word lands.' },
];

const KOKORO_VOICES = new Set([
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis', 'bf_alice', 'bf_lily', 'bm_daniel', 'bm_fable',
]);
const EMOTION_SPEED = { excited: 1.08, angry: 1.05, scared: 1.12, afraid: 1.12, sad: 0.9, calm: 1, happy: 1.04, tired: 0.9, hostile: 1.03 };
const INTENTS = ['follow', 'stay', 'attack', 'flee', 'give', 'wave', 'dance'];

// ------------------------------------------------------------------ text helpers
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  if (n < 10000) return numberWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberWords(n % 1000) : '');
  return String(n);
}
export function speakable(text) {
  return String(text ?? '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(\d+)\s*m\b/g, (_, n) => `${n} metres`)
    .replace(/\b\d{1,5}\b/g, (m) => numberWords(Number(m)))
    .replace(/&/g, ' and ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').trim();
}
// Sentence-sized chunks (Chatterbox drifts on long inputs): 40..220 characters where possible.
export function chunkText(text, max = 220, min = 40) {
  const sentences = String(text).match(/[^.!?…]+[.!?…]*["')\]]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [String(text)];
  const out = [];
  const pushLong = (s) => {
    while (s.length > max) {
      let cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max), s.lastIndexOf(': ', max));
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut < 20) cut = max;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  };
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > max) { pushLong(cur); cur = s; }
    else cur = cur ? cur + ' ' + s : s;
    if (cur.length >= min && /[.!?…]["')\]]*$/.test(cur) && cur.length > 0 && sentences.length > 1) { pushLong(cur); cur = ''; }
  }
  if (cur) { if (out.length && cur.length < min && (out[out.length - 1] + ' ' + cur).length <= max) out[out.length - 1] += ' ' + cur; else pushLong(cur); }
  return out.filter((c) => /[\p{L}\p{N}]/u.test(c));
}
export function parseNpcReply(raw) {
  let t = String(raw ?? '');
  let intent = null;
  for (const m of t.matchAll(/\[\s*([a-z]+)\s*\]/gi)) { const k = m[1].toLowerCase(); if (!intent && INTENTS.includes(k)) intent = k; }
  t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\*[^*]*\*/g, ' ').replace(/^["'“”\s>-]+|["'“”\s]+$/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(you|npc|[A-Z][a-z]+)\s*:\s*/, '');
  if (t.length > 240) t = t.slice(0, 240).replace(/\s+\S*$/, '') + '.';
  return { text: capWords(t, NPC_MAX_WORDS), intent };
}

// NPC replies are spoken aloud and the model's latency grows with length: ask for about 20 words (prompt + input line) and enforce it here.
// Whole sentences are kept while they fit in the limit; otherwise the line is cut at the word limit and closed with a full stop.
export const NPC_MAX_WORDS = 24;
export function capWords(t, max = NPC_MAX_WORDS) {
  const words = String(t ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  const sentences = String(t).trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  let out = '';
  for (const s of sentences) { const next = (out + ' ' + s).trim(); if (next.split(/\s+/).length > max) break; out = next; }
  if (out) return out;
  return words.slice(0, max).join(' ').replace(/[,;:\s-]+$/, '') + '.';
}

const short = (v, n) => String(v ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export default async function voicePlugin(api) {
  const { root, cacheDir, broadcast } = api;
  const log = (...a) => (api.log ?? console.log)('[voice]', ...a);
  const env = process.env;
  const distro = env.VOICE_DISTRO || 'Ubuntu';
  const ttsDir = path.join(cacheDir, 'tts');
  const voiceCache = path.join(cacheDir, 'voice');
  const npcDir = path.join(voiceCache, 'npc');
  const settingsFile = path.join(voiceCache, 'settings.json');
  fs.mkdirSync(ttsDir, { recursive: true });
  fs.mkdirSync(npcDir, { recursive: true });

  // ------------------------------------------------------------------ settings
  let settings = { voice: 'omnissiah' };
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch { /* first run */ }
  if (!OMNISSIAH_VOICES.some((v) => v.id === settings.voice)) settings.voice = 'omnissiah';
  const saveSettings = () => { try { fs.writeFileSync(settingsFile, JSON.stringify(settings)); } catch { /* ignore */ } };

  // ------------------------------------------------------------------ worker lifecycle (same pattern as server/gen3d.js)
  const W = { state: 'stopped', port: null, child: null, startedByUs: false, startPromise: null, lastError: null, lastUse: 0, lastOk: 0, warming: null, shuttingDown: false };
  let idleTimer = null;
  const toWsl = (p) => {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p));
    return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
  };

  function httpRaw(method, port, urlPath, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({
        host: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
  const httpJson = async (method, port, p, body, timeoutMs = 8000) => {
    const r = await httpRaw(method, port, p, body, timeoutMs);
    let j = {}; try { j = JSON.parse(r.body.toString() || '{}'); } catch { /* not JSON */ }
    return { status: r.status, body: j };
  };
  const freePort = (preferred) => new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => (p === 0 ? resolve(PREFERRED_PORT + 1) : tryPort(0)));
      s.listen(p, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); });
    };
    tryPort(preferred);
  });
  async function probe(port, tries, delayMs, gone = () => false) {
    for (let i = 0; i < tries; i++) {
      if (W.shuttingDown) return false;
      try { const r = await httpJson('GET', port, '/health', undefined, 2500); if (r.status === 200 && r.body?.ok) return true; } catch { /* not up yet */ }
      if (gone()) return false;
      await sleep(delayMs);
    }
    return false;
  }
  function killChild() {
    const c = W.child; W.child = null;
    if (!c) return;
    try { if (c.exitCode === null) execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* ignore */ }
  }
  function startWorkerOnce() {
    return new Promise(async (resolve, reject) => {
      try {
        if (await probe(PREFERRED_PORT, 1, 0)) { W.port = PREFERRED_PORT; W.startedByUs = false; W.state = 'ready'; return resolve(); }
        const port = await freePort(PREFERRED_PORT);
        const script = toWsl(path.join(VOICE_DIR, 'start_worker.sh'));
        log(`starting WSL worker (${distro}) on 127.0.0.1:${port}`);
        fs.mkdirSync(voiceCache, { recursive: true });
        let spawnError = null, gone = false;
        const child = spawn('wsl.exe', ['-d', distro, '--', 'bash', script, '--port', String(port), '--host', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
        child.on('error', (err) => { spawnError = err; });
        child.on('exit', (code) => {
          gone = true;
          if (W.child === child) { W.child = null; if (!W.shuttingDown && W.state !== 'stopped') { W.state = 'stopped'; W.lastError = `worker exited (${code})`; log(W.lastError); } }
        });
        W.child = child; W.port = port; W.startedByUs = true;
        const ok = await probe(port, 60, 700, () => gone);
        if (ok) { W.state = 'ready'; W.lastError = null; return resolve(); }
        const why = spawnError ? (spawnError.code === 'ENOENT' ? 'WSL (wsl.exe) is not installed' : spawnError.message) : 'the voice worker did not start (is the Ubuntu distro installed? run server/voice/setup_env.sh)';
        killChild();
        reject(new Error(why));
      } catch (err) { reject(err); }
    });
  }
  function ensureWorker() {
    if (W.state === 'ready' && (W.child?.exitCode === null || !W.startedByUs)) return Promise.resolve();
    if (W.startPromise) return W.startPromise;
    W.state = 'starting';
    W.startPromise = startWorkerOnce().catch((err) => { W.state = 'error'; W.lastError = err.message; throw err; }).finally(() => { W.startPromise = null; });
    return W.startPromise;
  }
  async function stopWorker() {
    const port = W.port;
    if (W.startedByUs && port) { try { await httpJson('POST', port, '/shutdown', {}, 3000); } catch { /* already gone */ } }
    for (let i = 0; i < 10 && port && W.startedByUs; i++) {
      try { await httpJson('GET', port, '/health', undefined, 500); await sleep(300); } catch { break; }
    }
    killChild();
    W.state = 'stopped'; W.warming = null; W.lastOk = 0;
  }
  function touch() {
    W.lastUse = Date.now();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (W.state === 'ready' && W.startedByUs) { log('idle: stopping the voice worker'); stopWorker().catch(() => {}); } }, WORKER_IDLE_STOP_MS);
    idleTimer.unref?.();
  }
  // Starts the worker if needed and loads the model. Resolves true when the next line will be fast.
  function warm() {
    if (W.shuttingDown) return Promise.resolve(false);
    if (Date.now() - W.lastOk < MODEL_HOT_MS && W.state === 'ready') return Promise.resolve(true);
    if (W.warming) return W.warming;
    touch();
    W.warming = (async () => {
      try {
        await ensureWorker();
        const r = await httpJson('POST', W.port, '/warm', {}, 180000);
        if (r.status === 200) { W.lastOk = Date.now(); log(`worker warm (${r.body.ms} ms)`); return true; }
        throw new Error(r.body?.error || `warm failed (${r.status})`);
      } catch (err) { W.lastError = err.message; log('warm failed:', err.message); return false; }
      finally { W.warming = null; }
    })();
    return W.warming;
  }

  // ------------------------------------------------------------------ the Omnissiah's voice
  const recent = new Map(); // key -> { url, at }
  const stats = { lines: 0, fallbacks: 0, lastMs: 0 };
  const sinceId = () => crypto.randomBytes(6).toString('hex');

  async function workerSpeak(text, voice, expiresAt, seed) {
    const r = await httpRaw('POST', W.port, '/speak', { text, voice, expires_ms: expiresAt, seed }, Math.max(1000, expiresAt - Date.now() + 1500));
    if (r.status !== 200) {
      let msg = ''; try { msg = JSON.parse(r.body.toString()).error; } catch { /* ignore */ }
      throw new Error(`worker ${r.status}: ${msg}`);
    }
    return r.body;
  }

  async function synthesizeOmnissiah(text, opts = {}) {
    const t0 = Date.now();
    const clean = speakable(text);
    if (!clean) return null;
    // server/index.js always asks for 'omnissiah' = "his current voice"; only an explicit force (previews) overrides the selection
    const voice = opts.force && OMNISSIAH_VOICES.some((v) => v.id === opts.voice) ? opts.voice : settings.voice;
    const key = voice + '|' + clean;
    const hit = recent.get(key);
    if (hit && Date.now() - hit.at < 8 * 60 * 1000 && fs.existsSync(path.join(ttsDir, path.basename(hit.url)))) return hit.url;

    const chunks = chunkText(clean);
    if (!chunks.length) return null;
    const words = clean.split(/\s+/).length;
    const budget = clamp(4500 + 650 * (words / 2.7), 6000, 16000);
    const deadline = t0 + budget;
    try {
      const wasWarming = !!W.warming;
      const hotNow = W.state === 'ready' && Date.now() - W.lastOk < MODEL_HOT_MS;
      const pending = warm();
      if (!hotNow && !wasWarming) { // cold: loading takes 15-40 s, far beyond any budget. Start it for the next line, use SAPI now.
        stats.fallbacks++; log('voice worker is cold: SAPI for this line while it starts');
        return null;
      }
      const hot = hotNow || await Promise.race([pending, sleep(budget).then(() => false)]);
      if (!hot) { stats.fallbacks++; log(`worker not ready within ${(budget / 1000).toFixed(1)} s: SAPI for this line`); return null; }
      touch();
      const parts = [];
      for (const c of chunks) {
        if (Date.now() > deadline) throw new Error('deadline');
        parts.push(parseWav(await workerSpeak(c, voice, deadline)));
      }
      const rate = parts[0].rate, gap = new Float32Array(Math.round(rate * 0.1));
      const total = parts.reduce((n, p) => n + p.samples.length, 0) + gap.length * (parts.length - 1);
      const all = new Float32Array(total);
      let o = 0;
      parts.forEach((p, i) => { all.set(p.samples, o); o += p.samples.length; if (i < parts.length - 1) o += gap.length; });
      const name = `om_${sinceId()}.wav`;
      fs.writeFileSync(path.join(ttsDir, name), encodeWav(all, rate));
      W.lastOk = Date.now();
      stats.lines++; stats.lastMs = Date.now() - t0;
      log(`${voice}: ${chunks.length} chunk(s), ${(total / rate).toFixed(1)} s of audio in ${stats.lastMs} ms`);
      const url = `/tts/${name}`;
      recent.set(key, { url, at: Date.now() });
      if (recent.size > 40) recent.delete(recent.keys().next().value);
      return url;
    } catch (err) {
      stats.fallbacks++;
      log(`falling back to SAPI: ${err.message}`);
      if (/ECONNREFUSED|ECONNRESET|socket hang up|worker exited/.test(err.message) && W.state === 'ready') { W.state = 'stopped'; killChild(); W.lastOk = 0; }
      return null;
    }
  }

  const ttsService = {
    synthesize: (text, opts = {}) => synthesizeOmnissiah(text, opts),
    kind: 'chatterbox',
  };
  const previousTts = api.services.tts;
  api.services.tts = ttsService;

  // ------------------------------------------------------------------ NPC voices (Kokoro, CPU ONNX in this process)
  let kokoro = null, kokoroLoading = null;
  async function getKokoro() {
    if (kokoro) return kokoro;
    kokoroLoading ??= (async () => {
      const { env: tenv } = await import('@huggingface/transformers');
      tenv.cacheDir = path.join(root, '.cache', 'models');
      const { KokoroTTS } = await import('kokoro-js');
      const dtype = env.KOKORO_DTYPE || 'q8';
      const t = Date.now();
      kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' });
      log(`kokoro (${dtype}) ready in ${((Date.now() - t) / 1000).toFixed(1)} s`);
      return kokoro;
    })().catch((err) => { kokoroLoading = null; throw err; });
    return kokoroLoading;
  }
  let npcChain = Promise.resolve();
  let npcPending = 0;
  function pruneNpcCache() {
    try {
      const names = fs.readdirSync(npcDir).filter((n) => n.endsWith('.wav'));
      if (names.length <= NPC_CACHE_MAX) return;
      const withTime = names.map((n) => { try { return [n, fs.statSync(path.join(npcDir, n)).mtimeMs]; } catch { return [n, 0]; } }).sort((a, b) => a[1] - b[1]);
      for (const [n] of withTime.slice(0, names.length - NPC_CACHE_MAX + 25)) { try { fs.unlinkSync(path.join(npcDir, n)); } catch { /* gone */ } }
    } catch { /* ignore */ }
  }
  // -> { url, seconds, cached } | null (dropped / failed). Cached on disk by text + voice + speed.
  function npcSynthesize({ text, voice, speed, emotion }) {
    const clean = speakable(text).slice(0, 260);
    if (!/[\p{L}\p{N}]/u.test(clean)) return Promise.resolve(null);
    const v = KOKORO_VOICES.has(voice) ? voice : 'am_adam';
    const sp = clamp(Number(speed) || 1, 0.6, 1.4) * (EMOTION_SPEED[String(emotion ?? '').toLowerCase()] ?? 1);
    const spd = Math.round(clamp(sp, 0.6, 1.5) * 100) / 100;
    const hash = crypto.createHash('sha1').update(`${v}|${spd}|${clean}`).digest('hex').slice(0, 16);
    const file = path.join(npcDir, `npc-${hash}.wav`);
    const url = `/npcvoice/npc-${hash}.wav`;
    try {
      if (fs.existsSync(file)) {
        const now = new Date(); fs.utimesSync(file, now, now);
        return Promise.resolve({ url, seconds: Math.max(0, (fs.statSync(file).size - 44) / 48000), cached: true });
      }
    } catch { /* regenerate */ }
    if (npcPending >= 3) return Promise.resolve(null); // too many queued: drop (the speech bubble still shows)
    npcPending++;
    const job = npcChain.then(async () => {
      const tts = await getKokoro();
      const a = await tts.generate(clean, { voice: v, speed: spd });
      const buf = encodeWav(a.audio, a.sampling_rate);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file);
      pruneNpcCache();
      return { url, seconds: a.audio.length / a.sampling_rate, cached: false };
    }).catch((err) => { log('kokoro failed:', err?.message ?? err); return null; }).finally(() => { npcPending--; });
    npcChain = job.then(() => {}, () => {});
    return job;
  }

  const lastSay = new Map(); // npc id -> ms (per-NPC rate limit)
  async function onNpcSay(msg) {
    const id = short(msg.id, 80);
    if (!id || typeof msg.text !== 'string') return;
    const now = Date.now();
    if (now - (lastSay.get(id) ?? 0) < 700) return broadcast({ type: 'npc_voice', id, rid: msg.rid ?? null, audio: null, dropped: 'rate' });
    lastSay.set(id, now);
    if (lastSay.size > 300) lastSay.delete(lastSay.keys().next().value);
    const r = await npcSynthesize({ text: msg.text, voice: msg.voice, speed: msg.speed, emotion: msg.emotion });
    broadcast({ type: 'npc_voice', id, rid: msg.rid ?? null, audio: r?.url ?? null, seconds: r?.seconds ?? 0, ...(r ? {} : { dropped: 'busy' }) });
  }

  // ------------------------------------------------------------------ talking to NPCs
  const memory = new Map(); // npc id -> { turns:[{p,n}], at }
  const busyNpc = new Set();
  const PROMPT_FILE = path.join(VOICE_DIR, 'npc-prompt.md');
  function remember(id, player, npcLine) {
    let m = memory.get(id);
    if (!m) { m = { turns: [], at: 0 }; memory.set(id, m); }
    m.turns.push({ p: player, n: npcLine });
    if (m.turns.length > 6) m.turns.shift();
    m.at = Date.now();
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of memory) if (v.at < cutoff) memory.delete(k);
    while (memory.size > 60) memory.delete(memory.keys().next().value);
  }
  const FALLBACK_LINES = {
    enemy: ['Hah! Talk all you like, fool.', 'Words will not save you.', 'You dare speak to me?'],
    friendly: ['Hm? Say that once more, friend.', 'Forgive me, I was not listening.', 'Aye? What is it?'],
    neutral: ['I did not quite catch that.', 'Hm. Speak up, traveller.', 'Eh? What did you say?'],
  };
  function describeNpc(n, text) {
    const lines = [];
    lines.push(`You are ${n.name || 'a nameless one'}, a ${n.role || 'person'}${n.persona ? `: ${n.persona}` : ''}.`);
    lines.push(`Faction: ${n.faction || 'neutral'}. Mood: ${n.mood || 'calm'}.${Number.isFinite(n.health) ? ` Health: ${Math.round(n.health * (n.health <= 1 ? 100 : 1))}%.` : ''}${n.holding ? ` You are holding: ${n.holding}.` : ''}`);
    if (Array.isArray(n.nearby) && n.nearby.length) lines.push('Around you: ' + n.nearby.slice(0, 6).map((s) => short(s, 100)).join('; ') + '.');
    const mem = memory.get(n.id);
    if (mem?.turns.length) {
      lines.push('', 'Earlier, you and the player said:');
      for (const t of mem.turns) lines.push(`Player: ${t.p}`, `You: ${t.n}`);
    }
    lines.push('', `The player now says: ${text}`, '', 'Answer in at most 20 words.');
    return lines.join('\n');
  }
  const NPC_REPLY_TIMEOUT_MS = Number(env.NPC_REPLY_TIMEOUT_MS) || 9000;
  function askNpc(input) {
    const O = api.oracle;
    let p;
    if (typeof O.ask === 'function') p = O.ask(input, { promptFile: PROMPT_FILE, effort: 'low', timeoutMs: NPC_REPLY_TIMEOUT_MS });   // killed by oracle.js at the deadline
    else p = O.quick(input, PROMPT_FILE);
    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(''), NPC_REPLY_TIMEOUT_MS + 1500); });
    return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
  }
  async function npcConversation(text, rawNpc) {
    const n = {
      id: short(rawNpc.id, 80), name: short(rawNpc.name, 40), role: short(rawNpc.role, 40), persona: short(rawNpc.persona, 240),
      faction: ['enemy', 'friendly', 'neutral'].includes(rawNpc.faction) ? rawNpc.faction : 'neutral', mood: short(rawNpc.mood, 30),
      health: Number(rawNpc.health), holding: short(rawNpc.holding, 40), nearby: Array.isArray(rawNpc.nearby) ? rawNpc.nearby.map((s) => short(s, 100)) : [],
      voice: rawNpc.voice, speed: rawNpc.speed,
    };
    if (!n.id || busyNpc.has(n.id)) return;
    busyNpc.add(n.id);
    try {
      broadcast({ type: 'npc_thinking', id: n.id });
      const t0 = Date.now();
      let reply = '';
      // low effort, a hard deadline (a slow model must not leave the NPC mute) and nothing here is awaited by the Omnissiah's own turn queue
      try { reply = await askNpc(describeNpc(n, text)); } catch (err) { log('npc reply failed:', err?.message ?? err); }
      let { text: line, intent } = parseNpcReply(reply);
      if (!line) {
        const pool = FALLBACK_LINES[n.faction];
        line = pool[Math.floor(Math.random() * pool.length)];
        intent = null;
      }
      log(`${n.name || n.id} (${n.role}) -> "${line}"${intent ? ` [${intent}]` : ''} (${Date.now() - t0} ms for the text)`);
      remember(n.id, text, line);
      const r = await npcSynthesize({ text: line, voice: n.voice, speed: n.speed, emotion: n.mood });
      broadcast({ type: 'npc_reply', id: n.id, name: n.name, text: line, audio: r?.url ?? null, seconds: r?.seconds ?? 0, intent, faction: n.faction });
    } finally { busyNpc.delete(n.id); }
  }

  // ------------------------------------------------------------------ messages
  const info = () => ({ type: 'voice_info', current: settings.voice, voices: OMNISSIAH_VOICES, worker: W.state, hot: Date.now() - W.lastOk < MODEL_HOT_MS });
  const messages = {
    npc_say: async (msg) => { await onNpcSay(msg); },
    voice_get: async (_msg, ws) => { api.reply(ws, info()); },
    voice_set: async (msg, ws) => {
      if (!OMNISSIAH_VOICES.some((v) => v.id === msg.voice)) return api.reply(ws, { type: 'notice', level: 'error', text: 'Unknown voice.' });
      settings.voice = msg.voice; saveSettings();
      broadcast(info());
      if (msg.preview !== false) await messages.voice_preview({ voice: msg.voice });
    },
    voice_preview: async (msg) => {
      const voice = OMNISSIAH_VOICES.some((v) => v.id === msg.voice) ? msg.voice : settings.voice;
      const text = { omnissiah: 'I am the Omnissiah. Speak, and the world will answer.', oracle: 'I am the Oracle. Listen, and the field will whisper back.', titan: 'I am the Titan. Speak slowly. I am listening.' }[voice];
      const audio = await synthesizeOmnissiah(text, { voice, force: true });
      broadcast({ type: 'speak', text, audio });
    },
    voice_warm: async () => { warm().catch(() => {}); },
  };

  if (env.VOICE_PREWARM !== '0') setTimeout(() => { warm().catch(() => {}); }, 2500).unref?.();

  return {
    name: 'voice',
    messages,
    routes: [{ prefix: '/npcvoice/', dir: npcDir, cache: 'public, max-age=3600' }],
    async utterance(text, context) {
      const npc = context?.npc;
      if (!npc || typeof npc !== 'object' || !npc.id) { warm().catch(() => {}); return false; } // he is about to answer: get the voice ready
      // fire and forget: the turn must not hold up the Omnissiah's queue
      npcConversation(String(text).slice(0, 400), npc).catch((err) => log('npc conversation failed:', err?.message ?? err));
      return true;
    },
    status: () => ({ worker: W.state, port: W.port, lastError: W.lastError, voice: settings.voice, ...stats, npcQueued: npcPending }),
    // test hooks
    _internals: { synthesizeOmnissiah, npcSynthesize, npcConversation, warm, ensureWorker, stopWorker, W, memory },
    async shutdown() {
      W.shuttingDown = true;
      clearTimeout(idleTimer);
      if (api.services.tts === ttsService) api.services.tts = previousTts;
      try { await stopWorker(); } catch { /* ignore */ }
    },
  };
}
