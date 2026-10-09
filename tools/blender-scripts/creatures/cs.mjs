// contactsheet.mjs Ã¢â‚¬â€ render colour contact sheets of the shipped models in REAL WebGL, the way the game renders them, and compare them
// with the original pack files. Offline tool (Node + headless Microsoft Edge); not used by the game. See docs/ASSETS.md "Verifying colours".
//
//   node public/assets/_build/contactsheet.mjs --pack kenney-castle,kenney-nature [--cols orig,raw,quest,pc] [--out DIR]
//        [--names a,b,c] [--limit N] [--start N] [--cell 128] [--tag before] [--edge PATH] [--maxdist N] [--list]
//
//   columns   orig   the ORIGINAL download (from .cache/assets-src, path recorded in selection.json) through plain three GLTFLoader
//             raw    the shipped GLB through plain three GLTFLoader (separates "file is wrong" from "models.js is wrong")
//             quest  the shipped GLB through the game's own public/game/core/models.js, ctx.quality.tier = 'quest' (Lambert materials)
//             pc     same, tier 'pc' (standard materials)
//   Lighting is neutral white (ambient 0.75*PI + one directional 0.25*PI), no tone mapping: a lit face shows the material's albedo.
//   Output   DIR/<tag>-<pack>-NN.png contact sheets (models in groups, one cell per column) + DIR/<tag>-<pack>-NN.json (mean colour,
//            distinct-colour count and coverage of every cell) + DIR/<tag>-summary.json. Default DIR = .cache/sheets.
//            Per-model "dist" = RGB distance (0..255) between the first column and each other column; a flat/wrong colour usually
//            shows as a large dist or as ncol == 1-3 in a cell that should show several colours.
//   Server   a throw-away static server on a random high localhost port (never 8080/8443): / -> public/, /vendor/three -> node_modules/three,
//            /src -> .cache/assets-src. It and the Edge child process are stopped when the run ends.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const SRC_DIR = path.join(ROOT, '.cache', 'assets-src');

const args = (() => {
  const a = { cols: 'orig,quest,pc', out: path.join(ROOT, '.cache', 'sheets'), cell: 128, tag: 'sheet', edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', width: 1600, height: 1000 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2);
    if (k === 'list') a.list = true;
    else a[k] = v[++i];
  }
  a.cell = +a.cell; a.width = +a.width; a.height = +a.height;
  return a;
})();

const catalog = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'assets', 'catalog.json'), 'utf8'));
const selection = JSON.parse(fs.readFileSync(path.join(HERE, 'selection.json'), 'utf8')).models;
const cols = args.cols.split(',');
const packs = (args.pack || '').split(',').filter(Boolean);
if (!packs.length && !args.names) { console.error('usage: node contactsheet.mjs --pack <pack[,pack]> | --names a,b  [--cols orig,raw,quest,pc] [--out DIR] [--tag name] [--limit N] [--start N]'); process.exit(1); }

let names = args.names ? args.names.split(',') : Object.keys(catalog.models).filter((n) => packs.includes(catalog.models[n].pack));
names = names.filter((n) => catalog.models[n]);
if (args.start) names = names.slice(+args.start);
if (args.limit) names = names.slice(0, +args.limit);
if (args.list) { console.log(names.join('\n')); process.exit(0); }

// layout: G groups per row, R rows; each group = one model x cols.length cells
const labelH = 11;
const C = cols.length;
const G = Math.max(1, Math.floor(args.width / (C * args.cell)));
const R = Math.max(1, Math.floor(args.height / (args.cell + labelH)));
const PER = G * R;
const sheets = [];
const stem = (packs.length === 1 ? packs[0] : packs.length ? 'multi' : 'names'); // output file name part
for (let i = 0; i < names.length; i += PER) {
  const items = names.slice(i, i + PER).map((n) => ({ name: n, url: catalog.models[n].url, pack: catalog.models[n].pack, source: selection[n]?.source ?? null }));
  sheets.push({ id: sheets.length, items });
}
fs.mkdirSync(args.out, { recursive: true });

// ------------------------------------------------------------------------------------------------ page
function pageHtml(sheet) {
  const cfg = { items: sheet.items, cols, G, R, labelH, id: sheet.id };
  return `<!doctype html><meta charset="utf-8"><title>sheet</title>
<style>html,body{margin:0;background:#2b2e33;overflow:hidden}canvas{display:block}.l{position:absolute;font:9px/${labelH}px monospace;color:#cfd3d8;white-space:nowrap;overflow:hidden;height:${labelH}px}.l.e{color:#ff6b6b}</style>
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>
<body><img src="/__hold.png?id=${cfg.id}" width="1" height="1" style="position:absolute;left:-9px">
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import modelsModule from '/game/core/models.js';
const CFG = ${JSON.stringify(cfg)};
const logs = [];
for (const k of ['error', 'warn']) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(k + ': ' + a.map(String).join(' ').slice(0, 300)); o(...a); }; }
addEventListener('error', (e) => logs.push('uncaught: ' + e.message));
addEventListener('unhandledrejection', (e) => logs.push('unhandled: ' + e.reason));
const W = innerWidth, H = innerHeight, C = CFG.cols.length;
const cw = Math.floor(Math.min(W / (CFG.G * C), (H - 0) / CFG.R - CFG.labelH)), ch = cw + CFG.labelH;
const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
renderer.setScissorTest(true);
const BG = [0x3a, 0x3d, 0x42];
renderer.setClearColor(new THREE.Color().setRGB(BG[0] / 255, BG[1] / 255, BG[2] / 255, THREE.SRGBColorSpace), 1);

// the game's own models.js, one instance per quality tier (each has its own state, like two games would)
const tiers = {};
async function tier(t) {
  if (tiers[t]) return tiers[t];
  const root = new THREE.Group();
  const ctx = { THREE, state: {}, world: {}, quality: { tier: t }, root, groundAt: () => 0, hud: { show() {} }, net: { send() {} }, on() {}, player: null, provide(n, o) { ctx.world[n] = o; }, onDispose() {} };
  await modelsModule(ctx);
  return (tiers[t] = ctx);
}
const gltfLoader = new GLTFLoader();
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);

const cells = [];
const jobs = [];
CFG.items.forEach((it, k) => {
  CFG.cols.forEach((col, c) => {
    const cell = { name: it.name, col, k, c, scene: new THREE.Scene(), err: null };
    cell.scene.add(new THREE.AmbientLight(0xffffff, 0.75 * Math.PI));
    const d = new THREE.DirectionalLight(0xffffff, 0.25 * Math.PI); d.position.set(0.5, 1, 0.7); cell.scene.add(d);
    cells.push(cell);
    jobs.push(async () => {
      try {
        if (col === 'orig') {
          if (!it.source) throw new Error('no source');
          const url = '/src/' + it.source.split('/').map(encodeURIComponent).join('/');
          const g = await withTimeout(gltfLoader.loadAsync(url), 120000, url);
          cell.scene.add(g.scene); cell.obj = g.scene;
        } else if (col === 'raw') {
          const g = await withTimeout(gltfLoader.loadAsync(it.url), 120000, it.url);
          cell.scene.add(g.scene); cell.obj = g.scene;
        } else {
          const ctx = await tier(col);
          const h = ctx.world.models.spawn(ctx, it.name, { parent: cell.scene, position: [0, 0, 0], play: false });
          await withTimeout(h.ready, 120000, it.name);
          if (h.error) throw new Error(h.error);
          cell.obj = h.object;
        }
      } catch (e) { cell.err = String(e.message || e); }
    });
  });
});
// a small worker pool keeps the number of simultaneous loads/decodes modest
await Promise.all(Array.from({ length: 6 }, async () => { for (let job; (job = jobs.shift());) await job(); }));

const dir = new THREE.Vector3(0.8, 0.65, 1).normalize();
const buf = new Uint8Array(cw * cw * 4);
const gl = renderer.getContext();
const stats = [];
cells.forEach((cell) => {
  const x = (cell.k % CFG.G * C + cell.c) * cw, y = Math.floor(cell.k / CFG.G) * ch;
  const gy = H - y - cw;
  renderer.setViewport(x, gy, cw, cw); renderer.setScissor(x, gy, cw, cw); renderer.clear();
  const div = document.createElement('div'); div.className = 'l' + (cell.err ? ' e' : '');
  div.style.cssText = 'left:' + x + 'px;top:' + (y + cw) + 'px;width:' + cw + 'px';
  div.textContent = (cell.col === 'orig' ? 'O ' : cell.col === 'raw' ? 'R ' : cell.col === 'quest' ? 'Q ' : 'P ') + (cell.err ? 'ERR ' + cell.err : cell.name);
  document.body.appendChild(div);
  const st = { name: cell.name, col: cell.col };
  if (cell.err || !cell.obj) { st.err = cell.err || 'no object'; stats.push(st); return; }
  cell.scene.updateMatrixWorld(true); // (SkinnedMesh.updateMatrixWorld refreshes bindMatrixInverse; Object3D.updateWorldMatrix does not)
  cell.obj.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
  const box = new THREE.Box3().setFromObject(cell.obj, true); // precise: skinned meshes report a deliberately generous culling box otherwise
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const fov = 28, cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 1e4);
  const dist = Math.max(sph.radius, 1e-3) / Math.sin(THREE.MathUtils.degToRad(fov / 2)) * 1.02;
  cam.position.copy(sph.center).addScaledVector(dir, dist); cam.near = dist * 0.05; cam.far = dist * 4; cam.updateProjectionMatrix(); cam.lookAt(sph.center);
  renderer.render(cell.scene, cam);
  gl.readPixels(x, gy, cw, cw, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let n = 0, r = 0, g = 0, b = 0; const set = new Set();
  for (let i = 0; i < buf.length; i += 4) {
    if (Math.abs(buf[i] - BG[0]) < 4 && Math.abs(buf[i + 1] - BG[1]) < 4 && Math.abs(buf[i + 2] - BG[2]) < 4) continue;
    n++; r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; set.add(((buf[i] >> 4) << 8) | ((buf[i + 1] >> 4) << 4) | (buf[i + 2] >> 4));
  }
  st.size = box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3));
  st.cover = +(n / (cw * cw)).toFixed(3); st.mean = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null; st.ncol = set.size;
  stats.push(st);
});
await fetch('/__report?id=' + CFG.id, { method: 'POST', body: JSON.stringify({ stats, logs, cw }) });
document.title = 'SHEET_DONE';
</script>`;
}

// ------------------------------------------------------------------------------------------------ server
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.txt': 'text/plain' };
const reports = new Map(), holds = new Map();
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const releaseHold = (res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG1); };
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/__sheet.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(pageHtml(sheets[+u.searchParams.get('id')])); return; }
    if (u.pathname === '/__hold.png') { // keeps the page's load event (= Edge's screenshot moment) pending until the sheet is rendered and reported
      const id = +u.searchParams.get('id');
      if (reports.has(id)) releaseHold(res); else holds.set(id, res);
      return;
    }
    if (u.pathname === '/__report' && req.method === 'POST') {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const id = +u.searchParams.get('id');
        reports.set(id, JSON.parse(Buffer.concat(chunks).toString())); res.writeHead(204); res.end();
        setTimeout(() => { const h = holds.get(id); if (h) { holds.delete(id); releaseHold(h); } }, 600); // let the canvas present a frame
      });
      return;
    }
    let p = decodeURIComponent(u.pathname), base;
    if (p.startsWith('/vendor/three/')) { base = THREE_DIR; p = p.slice('/vendor/three'.length); }
    else if (p.startsWith('/src/')) { base = SRC_DIR; p = p.slice(4); }
    else base = PUBLIC;
    const file = path.normalize(path.join(base, p));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((resolve) => {
  const tryPort = () => { const p = 9200 + Math.floor(Math.random() * 10); server.once('error', tryPort); server.listen(p, '127.0.0.1', () => { server.off('error', tryPort); resolve(p); }); };
  tryPort();
});

function edgeShot(url, png, userData) {
  return new Promise((resolve) => {
    const child = spawn(args.edge, ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--user-data-dir=${userData}`, `--window-size=${args.width},${args.height}`, `--screenshot=${png}`, url], { stdio: 'ignore' });
    const kill = setTimeout(() => { try { child.kill(); } catch {} }, 240000);
    child.on('exit', () => { clearTimeout(kill); resolve(); });
  });
}

// ------------------------------------------------------------------------------------------------ run
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'omn-sheet-'));
const summary = { tag: args.tag, cols, models: {}, errors: [], logs: [] };
try {
  for (const sheet of sheets) {
    const nn = String(sheet.id + 1).padStart(2, '0');
    const png = path.join(args.out, `${args.tag}-${stem}-${nn}.png`);
    await edgeShot(`http://127.0.0.1:${port}/__sheet.html?id=${sheet.id}`, png, userData);
    const rep = reports.get(sheet.id);
    if (!rep) { console.log(`sheet ${nn}: NO REPORT (page failed)`); summary.errors.push(`sheet ${nn} no report`); continue; }
    fs.writeFileSync(path.join(args.out, `${args.tag}-${stem}-${nn}.json`), JSON.stringify(rep, null, 1));
    for (const s of rep.stats) {
      (summary.models[s.name] ??= {})[s.col] = s.err ? { err: s.err } : { mean: s.mean, ncol: s.ncol, cover: s.cover };
      if (s.err) summary.errors.push(`${s.name}/${s.col}: ${s.err}`);
    }
    rep.logs.forEach((l) => summary.logs.push(`sheet ${nn}: ${l}`));
    console.log(`sheet ${nn}/${sheets.length}: ${path.relative(ROOT, png)}  (${sheet.items.length} models)`);
  }
} finally {
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
}
// distance between the first column and every other column
const dist = (a, b) => (a?.mean && b?.mean ? Math.round(Math.hypot(a.mean[0] - b.mean[0], a.mean[1] - b.mean[1], a.mean[2] - b.mean[2])) : null);
for (const [n, m] of Object.entries(summary.models)) { m.dist = {}; for (const c of cols.slice(1)) m.dist[c] = dist(m[cols[0]], m[c]); }
fs.writeFileSync(path.join(args.out, `${args.tag}-${stem}-summary.json`), JSON.stringify(summary, null, 1));
console.log(`${Object.keys(summary.models).length} models, ${summary.errors.length} errors, ${summary.logs.length} console warnings/errors -> ${path.relative(ROOT, path.join(args.out, `${args.tag}-${stem}-summary.json`))}`);
if (summary.errors.length) console.log(summary.errors.slice(0, 20).join('\n'));
if (args.maxdist !== undefined) { // --maxdist N: exit 1 when any later column differs from the first by more than N (mean RGB distance, 0..255)
  const bad = Object.entries(summary.models).filter(([, m]) => Object.values(m.dist).some((d) => d !== null && d > +args.maxdist));
  bad.forEach(([n, m]) => console.log(`DIFF ${n}: ${JSON.stringify(m.dist)}`));
  if (bad.length || summary.errors.length) process.exitCode = 1;
}


