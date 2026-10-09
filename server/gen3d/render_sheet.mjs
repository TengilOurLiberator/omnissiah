// Contact sheets of rigged GLBs rendered with three.js in headless Microsoft Edge (verification tool; not used by the game).
//   node render_sheet.mjs <out.png> <model.glb> [--clips walk,idle] [--frames 8] [--size 256] [--mode mesh|bones|both]
//                         [--az 40] [--el 14] [--move 0.25] [--dist 1] [--cols N]
// Serves three (node_modules), public/ and this folder from a tiny static server on a random high port, never 8080/8443.
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
const frames = +(opt.frames || 8), size = +(opt.size || 256);
const clips = opt.clips ? opt.clips.split(',') : null;
const edge = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };

function safe(base, rel) { const p = path.resolve(base, '.' + path.sep + rel); return p.startsWith(base) ? p : null; }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let file = null;
  if (u.pathname.startsWith('/vendor/three/')) file = safe(path.join(root, 'node_modules', 'three'), u.pathname.slice(14));
  else if (u.pathname.startsWith('/viewer/')) file = safe(here + path.sep + 'viewer', u.pathname.slice(8));
  else if (u.pathname.startsWith('/assets/')) file = safe(path.join(root, 'public', 'assets'), u.pathname.slice(8));
  else if (u.pathname === '/model.glb') file = glb;
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let port = server.address().port;
if (port === 8080 || port === 8443) { console.error('unlucky port'); process.exit(3); }

const q = new URLSearchParams({ glb: '/model.glb', frames: String(frames), size: String(size), mode: opt.mode || 'mesh', az: opt.az ?? '40', el: opt.el ?? '14', move: opt.move ?? '0', dist: opt.dist ?? '1' });
if (clips) q.set('clips', clips.join(','));
if (opt.cols) q.set('cols', opt.cols);
// the sheet size must be known to size the window: ask for it from the clip count (read from the file when no list given)
let nclips = clips ? clips.length : null;
if (nclips === null) {
  const b = fs.readFileSync(glb); const jl = b.readUInt32LE(12); const js = JSON.parse(b.slice(20, 20 + jl).toString());
  nclips = (js.animations || []).length || 1;
}
const cols = +(opt.cols || frames);
const W = cols * size, H = Math.ceil(nclips * frames / cols) * size;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sheet-'));
fs.mkdirSync(path.dirname(out), { recursive: true });
const args = ['--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1',
  '--virtual-time-budget=60000', '--run-all-compositor-stages-before-draw', `--screenshot=${out}`, `http://127.0.0.1:${port}/viewer/sheet.html?${q}`];
const child = spawn(edge, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let err = '';
child.stderr.on('data', (d) => { err += d; });
const killer = setTimeout(() => { child.kill(); }, 180000);
const code = await new Promise((r) => child.on('exit', r));
clearTimeout(killer);
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
const ok = fs.existsSync(out);
console.log(ok ? `saved ${out} (${W}x${H})` : `FAILED (edge exit ${code})\n${err.slice(-600)}`);
process.exit(ok ? 0 : 1);
