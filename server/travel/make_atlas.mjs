// Builds / refreshes the starter atlas: generates every place in atlas.json that is not cached yet (one at a time),
// then merges name / keywords / spec from atlas.json into places/index.json (so specs can be tuned without regenerating).
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\server\travel\make_atlas.mjs [--force slug,slug] [--only slug,slug] [--specs-only] [--hi refine]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTravel } from './service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const force = new Set((arg('--force') ?? '').split(',').filter(Boolean));
const only = new Set((arg('--only') ?? '').split(',').filter(Boolean));
const specsOnly = process.argv.includes('--specs-only');
const hi = arg('--hi') === 'refine' ? 'refine' : 'fast';

const atlas = JSON.parse(fs.readFileSync(path.join(here, 'atlas.json'), 'utf8')).places;
const svc = createTravel({ root, send: (m) => { if (m.type === 'place_status' && m.message) console.log(`  [${m.id}] ${m.state}: ${m.message}${m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''}`); } });

function mergeSpecs() {
  const file = path.join(root, 'public', 'assets', 'generated', 'places', 'index.json');
  const idx = svc.readIndex();
  for (const p of atlas) {
    if (!idx[p.slug]) continue;
    idx[p.slug].name = p.name; idx[p.slug].spec = p.spec; idx[p.slug].atlas = true; idx[p.slug].prompt = p.prompt;
  }
  for (const slug of Object.keys(idx)) { // meta.json on disk is the source of truth (analyze.py --redo rewrites it)
    try { idx[slug].meta = JSON.parse(fs.readFileSync(path.join(path.dirname(file), slug, 'meta.json'), 'utf8')); } catch { /* keep */ }
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, file);
}

if (!specsOnly) {
  for (const p of atlas) {
    if (only.size && !only.has(p.slug)) continue;
    const have = svc.readIndex()[p.slug];
    if (have && !force.has(p.slug)) { console.log(`cached: ${p.slug}`); continue; }
    console.log(`generating ${p.slug} ...`);
    const t0 = Date.now();
    const r = await svc.request({ id: p.slug, prompt: p.prompt, options: { slug: p.slug, seed: p.seed, name: p.name, spec: p.spec, hi, force: true } });
    console.log(`${p.slug}: ${r.state} in ${Math.round((Date.now() - t0) / 1000)}s ${r.state === 'error' ? r.message : ''}`);
  }
}
mergeSpecs();
await svc.shutdown();
console.log('atlas ready:', Object.keys(svc.readIndex()).join(', '));
process.exit(0);
