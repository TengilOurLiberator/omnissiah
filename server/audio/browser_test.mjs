// Real-Chromium check (headless Microsoft Edge): every pack file decodes with decodeAudioData, durations match the manifest,
// media-element streaming works, and the real core/audio.js runs on a real AudioContext.
//   D:\omnissiah\tools\node\node.exe server\audio\browser_test.mjs        (serves public/ on a random localhost port, never 8080/8443)
// Edge is started headless with --autoplay-policy=no-user-gesture-required and driven over the DevTools protocol (a plain --dump-dom
// returns before the asynchronous decodes finish, even with --virtual-time-budget).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', '..', 'public');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ogg': 'audio/ogg', '.mjs': 'text/javascript' };
const port = 41000 + Math.floor(Math.random() * 10000);
const dbgPort = 51000 + Math.floor(Math.random() * 10000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serve = (root, rel, res) => {
  const file = path.resolve(root, '.' + path.posix.normalize('/' + decodeURIComponent(rel)));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
};
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/__t/')) return serve(HERE, p.slice(5), res);
  serve(PUBLIC, p, res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
console.log('static server on 127.0.0.1:' + port);
const url = `http://127.0.0.1:${port}/__t/browser_test.html`;
const userDir = path.join(process.env.TEMP ?? '.', 'omni-audio-edge-' + port);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${userDir}`, `--remote-debugging-port=${dbgPort}`,
  '--autoplay-policy=no-user-gesture-required', '--remote-allow-origins=*', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let result = null;
try {
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); } catch { await sleep(500); } }
  if (!targets) throw new Error('Edge did not start');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await call('Page.enable');
  await call('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    await sleep(1500);
    const r = await call('Runtime.evaluate', { expression: "document.getElementById('out') ? document.getElementById('out').textContent : ''", returnByValue: true });
    const v = r.result?.result?.value;
    if (v && v.startsWith('{') && v.includes('"done":true')) { result = JSON.parse(v); break; }
  }
  ws.close();
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  execFile('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { windowsHide: true }, () => {});
  server.close();
}
if (!result) { console.log('no result from the browser'); process.exit(2); }
const list = result.decode.list ?? [];
delete result.decode.list;
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(HERE, 'browser_decode_report.json'), JSON.stringify({ ...result.decode, list }, null, 1));
const bad = result.decode.fail.length + result.decode.durationMismatch.length + result.errors.length;
console.log(bad === 0 ? 'BROWSER TEST OK' : 'BROWSER TEST HAS PROBLEMS: ' + bad);
