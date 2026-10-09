// Omnissiah server: HTTPS + static files + WebSocket + wiring of files/stt/tts/oracle.
// See docs/CONTRACT.md.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import selfsigned from 'selfsigned';
import { createFiles } from './files.js';
import { createStt } from './stt.js';
import { createTts } from './tts.js';
import { createOracle } from './oracle.js';
import { createGen3d } from './gen3d.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const GAME_DIR = path.join(PUBLIC_DIR, 'game');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const CACHE_DIR = path.join(ROOT, '.cache');
const TTS_DIR = path.join(CACHE_DIR, 'tts');
const CERT_DIR = path.join(CACHE_DIR, 'certs');
const PORT = Number(process.env.PORT) || 8443;
const LOCAL_PORT = Number(process.env.LOCAL_PORT) || 8080;
const MAX_TEXT = 2000;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

const log = (...a) => console.log(...a);

process.on('uncaughtException', (err) => console.error('[server] uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection:', err));

// ---------------------------------------------------------------- network + certificate
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if ((ni.family === 'IPv4' || ni.family === 4) && !ni.internal) out.push(ni.address);
    }
  }
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

function loadOrCreateCert(addresses) {
  const keyFile = path.join(CERT_DIR, 'key.pem');
  const certFile = path.join(CERT_DIR, 'cert.pem');
  const metaFile = path.join(CERT_DIR, 'meta.json');
  const wanted = ['localhost', '127.0.0.1', ...addresses];
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (wanted.every((a) => meta.names?.includes(a)) && Date.now() < meta.expires) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    }
  } catch { /* generate */ }
  log('Generating a self-signed certificate...');
  const days = 825;
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...addresses.map((ip) => ({ type: 7, ip }))];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'omnissiah.local' }], {
    keySize: 2048,
    days,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify({ names: wanted, expires: Date.now() + (days - 5) * 86400000 }));
  return { key: pems.private, cert: pems.cert };
}

// ---------------------------------------------------------------- static serving
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};

function resolveSafe(base, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..' || p.startsWith('.') || p.includes(':'))) return null;
  const full = path.resolve(base, ...parts);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function serveFile(req, res, base, urlPath, cache) {
  let file = resolveSafe(base, urlPath);
  if (!file) return send(res, 400, 'Bad request');
  let st;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); }
  } catch { return send(res, 404, 'Not found'); }
  if (!st.isFile()) return send(res, 404, 'Not found');

  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': cache,
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
  };
  if (cache !== 'no-store' && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
    return res.end();
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ---------------------------------------------------------------- services
fs.mkdirSync(TTS_DIR, { recursive: true });
let oracle = null; // assigned below; files.onChange may fire after

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss?.clients ?? []) {
    if (ws.readyState === 1) { try { ws.send(data); } catch (err) { console.error('[ws] send failed:', err.message); } }
  }
}
const notice = (level, text) => broadcast({ type: 'notice', level, text });

const files = createFiles({
  gameDir: GAME_DIR,
  onChange({ modules, syntaxErrors }) {
    log(`[files] change: ${modules.length} modules${syntaxErrors.length ? `, ${syntaxErrors.length} syntax error(s)` : ''}`);
    broadcast({ type: 'reload', modules });
    if (syntaxErrors.length) {
      for (const e of syntaxErrors) console.error(`[files] syntax error in ${e.path}:\n${e.message}`);
      Promise.resolve(oracle?.handleSyntaxErrors(syntaxErrors)).catch((err) => console.error('[oracle] handleSyntaxErrors failed:', err));
    }
  },
});
const stt = createStt();
const tts = createTts({ outDir: TTS_DIR });

// Replaceable services. A plugin may swap services.tts for a better voice; SAPI stays the fallback.
const sapiTts = tts;
const services = { tts: sapiTts, stt };

async function speak(text) {
  let audio = null;
  try { audio = await services.tts.synthesize(text, { voice: 'omnissiah' }); } catch (err) { console.error('[tts] provider failed:', err?.message ?? err); }
  if (!audio && services.tts !== sapiTts) audio = await sapiTts.synthesize(text);
  broadcast({ type: 'speak', text, audio });
}

oracle = createOracle({ gameDir: GAME_DIR, files, send: broadcast, speak });
const gen3d = createGen3d({ root: ROOT, send: broadcast }); // local text-to-3D (WSL worker starts on first request)

// ---------------------------------------------------------------- plugins
// Every server/plugins/*.js default-exports  async (api) => ({ name, messages, utterance, routes, shutdown }):
//   messages:  { '<ws message type>': async (msg, ws) => void }      handles client messages of that type
//   utterance: async (text, context) => boolean                      return true to consume a player utterance
//   routes:    [{ prefix: '/x/', dir: '<absolute dir>', cache }]     extra static folders
//   shutdown:  async () => void
// api: { root, publicDir, cacheDir, broadcast, reply(ws, msg), notice, log, files, oracle, services, sapiTts }
const plugins = [];
const pluginMessages = new Map();
const pluginRoutes = [];
const reply = (ws, msg) => { try { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); } catch { /* closing */ } };
async function loadPlugins() {
  const dir = path.join(ROOT, 'server', 'plugins');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch { return; }
  for (const f of names) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      const p = await mod.default({
        root: ROOT, publicDir: PUBLIC_DIR, cacheDir: CACHE_DIR, broadcast, reply, notice, log, files, oracle, services, sapiTts,
      });
      if (!p) continue;
      plugins.push(p);
      for (const [type, fn] of Object.entries(p.messages ?? {})) pluginMessages.set(type, fn);
      for (const r of p.routes ?? []) if (r?.prefix && r?.dir) pluginRoutes.push(r);
      log(`[plugin] ${p.name ?? f} loaded`);
    } catch (err) {
      console.error(`[plugin] ${f} failed to load:`, err);
    }
  }
}

// ---------------------------------------------------------------- HTTP
const VENDOR = [
  ['/vendor/rapier/', path.join(ROOT, 'node_modules', '@dimforge', 'rapier3d-compat')],
];
const addresses = lanAddresses();
const handleHttp = (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    const url = new URL(req.url, 'https://localhost');
    const p = url.pathname;
    if (p === '/api/modules') {
      return send(res, 200, JSON.stringify({ modules: files.listModules() }), {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      });
    }
    if (p.startsWith('/vendor/three/')) return serveFile(req, res, THREE_DIR, p.slice('/vendor/three/'.length), 'public, max-age=3600');
    if (p.startsWith('/tts/')) return serveFile(req, res, TTS_DIR, p.slice('/tts/'.length), 'no-store');
    for (const [prefix, dir] of VENDOR) if (p.startsWith(prefix)) return serveFile(req, res, dir, p.slice(prefix.length), 'public, max-age=3600');
    for (const r of pluginRoutes) if (p.startsWith(r.prefix)) return serveFile(req, res, r.dir, p.slice(r.prefix.length), r.cache ?? 'no-cache');
    const noStore = p === '/game' || p.startsWith('/game/');
    // Model files never change in place; the catalogues and freshly generated models must stay fresh.
    const staticAsset = p.startsWith('/assets/') && !p.startsWith('/assets/generated/') && !p.endsWith('.json');
    return serveFile(req, res, PUBLIC_DIR, p, noStore ? 'no-store' : staticAsset ? 'public, max-age=86400' : 'no-cache');
  } catch (err) {
    console.error('[http] handler error:', err);
    if (!res.headersSent) send(res, 500, 'Server error'); else res.destroy();
  }
};
const server = https.createServer(loadOrCreateCert(addresses), handleHttp);
// Plain HTTP on localhost only, for testing on this PC (browsers treat http://localhost as secure).
const localServer = http.createServer(handleHttp);
server.on('clientError', (_err, socket) => { try { socket.destroy(); } catch { /* ignore */ } });

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
for (const srv of [server, localServer]) {
  srv.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
let greeted = false;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const cleanContext = (c) => (isObj(c) ? c : {});

async function runUtterance(text, context) {
  text = String(text ?? '').trim().slice(0, MAX_TEXT);
  if (!text) return broadcast({ type: 'status', state: 'idle' });
  log(`[player] ${text}`);
  for (const p of plugins) {
    if (!p.utterance) continue;
    try { if (await p.utterance(text, context)) return broadcast({ type: 'status', state: 'idle' }); } catch (err) { console.error(`[plugin] ${p.name} utterance failed:`, err); }
  }
  try { files.snapshot(`before ${text}`); } catch (err) { console.error('[files] snapshot failed:', err); }
  try { await oracle.handleUtterance(text, context); } catch (err) {
    console.error('[oracle] handleUtterance failed:', err);
    notice('error', 'The Omnissiah stumbled: ' + (err?.message ?? err));
    broadcast({ type: 'status', state: 'idle' });
  }
}

async function runAudio(a) {
  broadcast({ type: 'status', state: 'transcribing' });
  let text = '';
  try {
    const bytes = a.bytes & ~1;
    const buf = Buffer.concat(a.chunks, a.bytes);
    const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytes));
    text = await stt.transcribe(pcm, a.sampleRate);
  } catch (err) {
    console.error('[stt] transcription failed:', err?.message ?? err);
    notice('error', err?.message ?? 'Speech recognition failed.');
    return broadcast({ type: 'status', state: 'idle' });
  }
  text = String(text ?? '').trim();
  const heard = stt.last ?? {};
  log(`[stt] ${(heard.seconds ?? 0).toFixed(1)}s of audio, peak ${(heard.peak ?? 0).toFixed(3)} -> ${text ? JSON.stringify(text) : (heard.silent ? '(silence)' : '(no words)')}`);
  // Hands-free capture (voice activation): only words addressed to him count, and silence is not worth a notice.
  if (a.open && !/omn|oracle|machine god/i.test(text)) return broadcast({ type: 'status', state: 'idle' });
  if (!text) {
    notice('info', heard.silent ? 'I heard only silence. Hold the left trigger while you speak.' : 'I could not make out any words. Try again.');
    return broadcast({ type: 'status', state: 'idle' });
  }
  broadcast({ type: 'transcript', text });
  await runUtterance(text, a.context);
}

async function handleMessage(ws, state, msg) {
  switch (msg.type) {
    case 'hello':
      log(`[ws] hello from ${msg.client ?? 'unknown'}`);
      if (!greeted) {
        greeted = true;
        // A brand-new player (no saved profile yet) is greeted by the in-game intro instead.
        if (fs.existsSync(path.join(ROOT, 'saves', 'profile.json'))) await oracle.greet();
      }
      break;
    case 'utterance_text':
      if (typeof msg.text !== 'string') return;
      await runUtterance(msg.text, cleanContext(msg.context));
      break;
    case 'utterance_audio_start': {
      const rate = Number(msg.sampleRate);
      state.audio = { sampleRate: rate > 1000 && rate < 400000 ? rate : 48000, context: cleanContext(msg.context), chunks: [], bytes: 0, open: msg.open === true };
      break;
    }
    case 'utterance_audio_end': {
      const a = state.audio;
      state.audio = null;
      if (!a || a.bytes < 2) return broadcast({ type: 'status', state: 'idle' });
      await runAudio({ ...a, context: a.context });
      break;
    }
    case 'client_log':
      log(`[client] ${String(msg.text ?? '').slice(0, 300)}`);
      break;
    case 'activity':
      if (Array.isArray(msg.lines)) oracle.handleActivity?.(msg.lines.filter((l) => typeof l === 'string'))?.catch?.(() => {});
      break;
    case 'module_error':
      if (typeof msg.path !== 'string') return;
      await oracle.handleModuleError({
        path: msg.path.slice(0, 300),
        message: String(msg.message ?? '').slice(0, 2000),
        stack: String(msg.stack ?? '').slice(0, 4000),
      });
      break;
    case 'gen3d':
      if (typeof msg.prompt !== 'string') return;
      gen3d.request({ id: msg.id, prompt: msg.prompt, options: isObj(msg.options) ? msg.options : {} });
      break;
    case 'command':
      if (msg.name === 'undo') {
        const label = await files.undo();
        if (label == null) return notice('info', 'Nothing to undo.');
        broadcast({ type: 'reload', modules: files.listModules() });
        notice('info', `Undone: ${label}`);
      } else if (msg.name === 'reset') {
        await oracle.reset();
        notice('info', 'The Omnissiah forgets this conversation.');
      }
      break;
    default: {
      const fn = pluginMessages.get(msg.type);
      if (fn) await fn(msg, ws);
      break;
    }
  }
}

wss.on('connection', (ws, req) => {
  const state = { audio: null, alive: true };
  log(`[ws] client connected (${req.socket.remoteAddress})`);
  ws.on('pong', () => { state.alive = true; });
  ws.on('error', (err) => console.error('[ws] socket error:', err.message));
  ws.on('close', () => log('[ws] client disconnected'));
  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        const a = state.audio;
        if (!a) return;
        const chunk = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (a.bytes + chunk.length > MAX_AUDIO_BYTES) return; // too long: drop the rest
        a.chunks.push(chunk);
        a.bytes += chunk.length;
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return console.error('[ws] ignoring non-JSON text frame'); }
      if (!isObj(msg) || typeof msg.type !== 'string') return;
      handleMessage(ws, state, msg).catch((err) => {
        console.error(`[ws] handler for "${msg.type}" failed:`, err);
      });
    } catch (err) {
      console.error('[ws] bad message:', err);
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const st = ws;
    if (st.isDead) { ws.terminate(); continue; }
    st.isDead = true;
    ws.once('pong', () => { st.isDead = false; });
    try { ws.ping(); } catch { /* closing */ }
  }
}, 30000);
heartbeat.unref();

// ---------------------------------------------------------------- startup
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other server or set PORT.`);
  else console.error('Server error:', err);
  process.exit(1);
});

await loadPlugins();
const initial = await files.checkAll();
for (const e of initial) console.error(`[files] syntax error at startup in ${e.path}:\n${e.message}`);

localServer.on('error', (err) => console.error('[http] local test port unavailable:', err.message));
localServer.listen(LOCAL_PORT, '127.0.0.1', () => log('Desktop test URL on this PC: http://localhost:' + LOCAL_PORT));
server.listen(PORT, '0.0.0.0', () => {
  log('\nOmnissiah is awake. Open one of these in the Quest browser (or any browser on the LAN):');
  for (const ip of addresses) log(`  https://${ip}:${PORT}`);
  log(`  https://localhost:${PORT}   (this PC)`);
  log('The headset browser will show a certificate warning once: click Advanced, then proceed.');
  log('If the headset cannot connect, allow Node.js through Windows Firewall on private networks.\n');
  stt.ready.then((ok) => { if (!ok) log('[stt] speech input unavailable; typed text still works.'); });
});

function shutdown() {
  log('\nShutting down...');
  files.close();
  gen3d.shutdown().catch(() => {});
  for (const p of plugins) { try { Promise.resolve(p.shutdown?.()).catch(() => {}); } catch { /* ignore */ } }
  for (const ws of wss.clients) { try { ws.terminate(); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
