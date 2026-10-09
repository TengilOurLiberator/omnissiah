// End-to-end creature test through the Node module with a stub `send` (what a browser would see), one wish at a time so the timings are clean:
//   node test_creatures.mjs report.json "a grey wolf standing on four legs" "a wooden treasure chest" ...  [--animate auto|true|false] [--quality low|standard|high]
// Records every status message with its time, the final index.json entry, and writes the report. Exit code 2 if any request ended in error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGen3d } from '../gen3d.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const out = args.shift();
let animate = 'auto', quality = 'standard';
const prompts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--animate') animate = ({ true: true, false: false, redo: 'redo' })[args[++i]] ?? 'auto';
  else if (args[i] === '--quality') quality = args[++i];
  else prompts.push(args[i]);
}
const report = [];
let cur = null;
const t0 = Date.now();
const g = createGen3d({ root, send: (m) => {
  if (!cur || m.id !== cur.id) return;
  const t = (Date.now() - cur.t0) / 1000;
  const last = cur.status[cur.status.length - 1];
  if (!last || last.state !== m.state || last.message !== m.message) { cur.status.push({ t: +t.toFixed(1), state: m.state, message: m.message }); console.log(`${t.toFixed(0).padStart(5)}s [${m.state}] ${m.message ?? ''}`); }
} });
for (const [i, p] of prompts.entries()) {
  cur = { id: `e${i}`, prompt: p, t0: Date.now(), status: [] };
  console.log(`\n=== ${p}  (animate: ${animate})`);
  const r = await g.request({ id: cur.id, prompt: p, options: { quality, animate } });
  const slug = r.url ? r.url.replace(/^.*\//, '').replace(/\.glb$/, '') : null;
  const idx = slug ? JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'generated', 'index.json'), 'utf8'))[slug] : null;
  cur.final = r; cur.slug = slug; cur.entry = idx; cur.seconds = +((Date.now() - cur.t0) / 1000).toFixed(1);
  report.push(cur);
  console.log(`--> ${r.state} in ${cur.seconds}s: ${r.message}${idx?.rigged ? `  rigged as ${idx.bodyPlan}, ${idx.bones} bones, clips ${idx.clips.join(',')}` : ''}`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
}
await g.shutdown();
console.log(`\nall done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(report.some((r) => r.final?.state !== 'done') ? 2 : 0);
