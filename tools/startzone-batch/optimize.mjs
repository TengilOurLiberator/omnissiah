// Watcher: every 2 min, for each public/assets/generated/startzone/<id>.glb without a twin in q/, run headless Blender
// (optimize_blender.py: weld + collapse-decimate to <= 2500 tris, textures <= 512 px JPEG, same 1-unit size / base at y=0)
// and write q/<id>.glb + append a record to optimized.json. CPU only, one Blender at a time, BelowNormal priority. Exits at 08:15.
//   node optimize.mjs            (add --once to do a single pass)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dir = path.join(root, 'public', 'assets', 'generated', 'startzone');
const qdir = path.join(dir, 'q');
const outJson = path.join(here, 'optimized.json');
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const py = path.join(here, 'optimize_blender.py');
const once = process.argv.includes('--once');
const END = (() => { const d = new Date(); d.setHours(8, 15, 0, 0); return d.getTime(); })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`${new Date().toLocaleString('sv')}  ${m}`);
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ }
fs.mkdirSync(qdir, { recursive: true });

const read = () => { try { return JSON.parse(fs.readFileSync(outJson, 'utf8').replace(/^\uFEFF/, '')); } catch { return []; } };
const save = (a) => { fs.writeFileSync(outJson + '.tmp', JSON.stringify(a, null, 1)); fs.renameSync(outJson + '.tmp', outJson); };

function blender(src, dst, maxTris) {
  return new Promise((resolve) => {
    const c = spawn(BLENDER, ['--background', '--factory-startup', '--python', py, '--', src, dst, String(maxTris), '512'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(c.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ }
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', () => {});
    const t = setTimeout(() => c.kill(), 180_000);
    c.on('exit', () => { clearTimeout(t); const m = /^OPT (\{.*\})/m.exec(out); resolve(m ? JSON.parse(m[1]) : null); });
    c.on('error', () => { clearTimeout(t); resolve(null); });
  });
}
const drift = (a, b) => Math.max(...[0, 1, 2].map((i) => Math.abs((a[i + 3] - a[i]) - (b[i + 3] - b[i]))));
const failed = new Map();

async function pass() {
  const recs = read(); const done = new Set(recs.map((r) => r.id)); let n = 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort((a, b) => (b.startsWith('sz-') - a.startsWith('sz-')) || a.localeCompare(b));
  for (const f of files) {
    if (Date.now() > END) return n;
    const id = f.replace(/\.glb$/, ''); const src = path.join(dir, f); const dst = path.join(qdir, f);
    if (done.has(id) && fs.existsSync(dst)) continue;
    if ((failed.get(id) ?? 0) >= 2) continue;
    if (Date.now() - fs.statSync(src).mtimeMs < 20_000) continue;   // still being written
    const tmp = path.join(qdir, `${id}.tmp.glb`);
    let r = await blender(src, tmp, 2500), budget = 2500;
    // thin-shell models (sails, fences) stall or get shredded at 2500: fall back to a gentler 5000 and flag it
    if (r && (r.tris_after > 2500 || drift(r.bbox_before, r.bbox_after) > 0.03)) {
      const r2 = await blender(src, tmp, 5000);
      if (r2) { r = r2; budget = 5000; }
    }
    if (!r || !fs.existsSync(tmp)) { failed.set(id, (failed.get(id) ?? 0) + 1); log(`FAIL ${id}`); continue; }
    fs.renameSync(tmp, dst);
    const rec = { id, tris_before: r.tris_before, tris_after: r.tris_after, bytes_before: fs.statSync(src).size, bytes_after: fs.statSync(dst).size,
      bbox: r.bbox_after, bbox_before: r.bbox_before, ...(budget > 2500 || r.tris_after > 2500 ? { warn: `thin/complex model: budget ${budget}, ${r.tris_after} tris, check the look` } : {}) };
    const cur = read().filter((x) => x.id !== id); cur.push(rec); save(cur);
    log(`OK ${id} ${r.tris_before} -> ${r.tris_after} tris, ${rec.bytes_before} -> ${rec.bytes_after} bytes${rec.warn ? '  [WARN ' + budget + ']' : ''}`);
    n++;
  }
  return n;
}

log(`optimizer start pid ${process.pid}, until ${new Date(END).toLocaleTimeString('sv')}`);
for (;;) {
  const n = await pass(); log(`pass done: ${n} new`);
  if (once || Date.now() > END) break;
  await sleep(120_000);
}
log('optimizer exit');
