// Tiny static server for browser-side tests of the voice code (NOT the game server): node devserver.mjs [port=18771]
// Serves /public as /, /.cache as /cache/, server/voice/harness as /harness/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const port = Number(process.argv[2]) || 18771;
const MAP = [['/cache/', path.join(ROOT, '.cache')], ['/harness/', path.join(HERE, 'harness')], ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')], ['/', path.join(ROOT, 'public')]];
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wav': 'audio/wav', '.css': 'text/css' };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'POST' && u.startsWith('/save/')) { // harness results -> .cache/voice/samples/<path>
    const base = path.join(ROOT, '.cache', 'voice', 'samples');
    const f = path.resolve(base, u.slice('/save/'.length));
    if (!f.startsWith(base + path.sep)) { res.writeHead(400); return res.end(); }
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.concat(chunks)); res.writeHead(200); res.end('ok'); });
    return;
  }
  for (const [prefix, dir] of MAP) {
    if (!u.startsWith(prefix)) continue;
    const f = path.resolve(dir, u.slice(prefix.length));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return fs.createReadStream(f).pipe(res);
  }
  res.writeHead(404); res.end('not found');
}).listen(port, '127.0.0.1', () => console.log('devserver on http://127.0.0.1:' + port));
