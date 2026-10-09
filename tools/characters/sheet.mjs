// Contact sheet of a (rigged) GLB through three.js in headless Chrome (software GL). Static server on 127.0.0.1:9560 (test range 9560-9569), stopped on exit.
//   node sheet.mjs <out.png> <model.glb> [--anim <clip-only.glb>] [--clips idle,walk,attack] [--t 0,0.25,0.5,0.75] [--views 0,90] [--size 220] [--mode mesh|bones] [--label text] [--port 9560]
// Rows = clips, columns = sample times x views (az 0 = front (+Z), 90 = side).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const out = path.resolve(argv[0]);
const glb = path.resolve(argv[1]);
const opt = Object.fromEntries(argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const size = +(opt.size || 220);
const ts = (opt.t || '0,0.25,0.5,0.75').split(',');
const views = (opt.views || '0,90').split(',');
const clips = (opt.clips || 'idle,walk,attack').split(',');
const port = +(opt.port || 9560);
if (port < 9560 || port > 9569) { console.error('port must be 9560-9569'); process.exit(3); }
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const safe = (base, rel) => { const p = path.resolve(base, '.' + path.sep + rel); return p.startsWith(base) ? p : null; };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let file = null;
  if (u.pathname.startsWith('/vendor/three/')) file = safe(path.join(root, 'node_modules', 'three'), u.pathname.slice(14));
  else if (u.pathname.startsWith('/viewer/')) file = safe(path.join(here, 'viewer'), u.pathname.slice(8));
  else if (u.pathname.startsWith('/assets/')) file = safe(path.join(root, 'public', 'assets'), u.pathname.slice(8));
  else if (u.pathname === '/model.glb') file = glb;
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', r); });
const q = new URLSearchParams({ glb: '/model.glb', clips: clips.join(','), t: ts.join(','), views: views.join(','), size: String(size), mode: opt.mode || 'mesh', label: opt.label || '' });
if (opt.anim) q.set('anim', opt.anim);   // a URL under /assets/, e.g. /assets/anim/kaykit-rig-adventurers.glb
const W = ts.length * views.length * size, H = clips.length * size;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-sheet-'));
fs.mkdirSync(path.dirname(out), { recursive: true });
const args = ['--headless=new', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--virtual-time-budget=40000', '--run-all-compositor-stages-before-draw',
  `--screenshot=${out}`, `http://127.0.0.1:${port}/viewer/sheet.html?${q}`];
const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let err = '';
child.stderr.on('data', (d) => { err += d; });
const killer = setTimeout(() => child.kill(), 150000);
const code = await new Promise((r) => child.on('exit', r));
clearTimeout(killer);
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
const ok = fs.existsSync(out);
console.log(ok ? `saved ${out} (${W}x${H})` : `FAILED (chrome exit ${code})\n${err.slice(-600)}`);
process.exit(ok ? 0 : 1);
