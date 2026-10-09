// Render harness for the blast client (dev tool, not part of the game): a tiny static server on a random high localhost port that serves the REAL game files
// (public/, /vendor/three, /vendor/rapier) plus a test page that boots the real boot.js with a reduced module list (world, style, physics, kit, models, audio,
// travel, blast) and a fake net that replays recorded blast statuses. headless Microsoft Edge renders it; the page posts canvas frames back to /save.
//   node server/blast/harness/run.mjs <slug> <scenario> [outDir]       scenarios: vision | arrive | mr
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.css': 'text/css', '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };
const MODULES = ['core/world.js', 'core/style.js', 'core/physics.js', 'core/kit.js', 'core/models.js', 'core/audio.js', 'core/travel.js', 'core/blast.js'];

function safe(base, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  const full = path.resolve(base, ...p.split('/').filter((s) => s && s !== '.'));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

export function startHarness({ outDir, port = 0, modules = MODULES } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const saved = [];
  let doneResolve;
  const done = new Promise((r) => { doneResolve = r; });
  const logs = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (req.method === 'POST' && p === '/save') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const name = (url.searchParams.get('name') || 'frame').replace(/[^a-z0-9._-]/gi, '_');
        const body = Buffer.concat(chunks).toString();
        const b64 = body.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(b64, 'base64'));
        saved.push(name);
        send(200, 'ok');
      });
      return;
    }
    if (req.method === 'POST' && p === '/log') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { const t = Buffer.concat(chunks).toString(); logs.push(t); fs.appendFileSync(path.join(outDir, 'page.log'), t + '\n'); send(200, 'ok'); });
      return;
    }
    if (p === '/done') { doneResolve(url.searchParams.get('why') || 'done'); return send(200, 'ok'); }
    if (p === '/api/modules') {
      const list = modules.map((m) => ({ path: m, version: Math.floor(fs.statSync(path.join(ROOT, 'public', 'game', m)).mtimeMs) }));
      return send(200, JSON.stringify({ modules: list }), 'application/json');
    }
    let file = null;
    if (p === '/' || p === '/index.html') file = path.join(ROOT, 'server', 'blast', 'harness', 'index.html');
    else if (p.startsWith('/harness/')) file = safe(path.join(ROOT, 'server', 'blast', 'harness'), p.slice(9));
    else if (p.startsWith('/vendor/three/')) file = safe(path.join(ROOT, 'node_modules', 'three'), p.slice(14));
    else if (p.startsWith('/vendor/rapier/')) file = safe(path.join(ROOT, 'node_modules', '@dimforge', 'rapier3d-compat'), p.slice(15));
    else file = safe(path.join(ROOT, 'public'), p);
    if (!file) return send(400, 'bad path');
    try {
      let st = fs.statSync(file);
      if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch { send(404, 'not found'); }
  });
  server.on('upgrade', (_req, socket) => socket.destroy());   // no WebSocket: the net is faked in the page
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, server, done, saved, logs, close: () => server.close() })));
}
