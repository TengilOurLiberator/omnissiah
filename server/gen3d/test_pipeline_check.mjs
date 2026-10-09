// Real-job check of the whole text -> 3D path and the image-input mode / plugin API (needs the WSL worker + GPU; takes minutes):
//   node test_pipeline_check.mjs "a small wooden stool" <image1.png> <image2.png>
// 1. a text job through createGen3d.request (static path, nothing animate-related)   2. two picture jobs through generateModel (plugin API)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGen3d, generateModel } from '../gen3d.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [prompt, ...images] = process.argv.slice(2);
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s`;
const browser = [];
const g = createGen3d({ root, send: (m) => { browser.push(m); console.log(lap(), 'browser sees', JSON.stringify(m).slice(0, 150)); } });
let bad = 0;
const t = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

console.log(`\n=== text job: ${prompt}`);
const a0 = Date.now();
const r = await g.request({ id: 'text1', prompt, options: { quality: 'low' } });
t(r.state === 'done' && fs.existsSync(path.join(root, 'public', r.url)), `text job -> ${r.state} ${r.url} in ${((Date.now() - a0) / 1000).toFixed(0)}s`);
const idx = () => JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'generated', 'index.json'), 'utf8'));
const slug = r.url?.replace(/^.*\//, '').replace(/\.glb$/, '');
t(idx()[slug] && !idx()[slug].rigged, 'index entry exists and is static (no rig stage ran)');

for (const [i, img] of images.entries()) {
  console.log(`\n=== image job ${i + 1}: ${img}`);
  const before = browser.length;
  const b0 = Date.now();
  const seen = [];
  const m = await generateModel({ prompt: `test object ${i + 1}`, image: path.resolve(img), options: { quality: 'low', onStatus: (s) => { seen.push(s.state); console.log(lap(), 'plugin sees', s.state, s.message ?? ''); } } });
  t(m && m.url && m.slug && m.meta?.from_image === true && fs.existsSync(path.join(root, 'public', m.url)), `generateModel -> ${JSON.stringify(m && { url: m.url, slug: m.slug, tris: m.meta?.triangles })} in ${((Date.now() - b0) / 1000).toFixed(0)}s`);
  t(!seen.includes('imagining'), `no text-to-image stage (states: ${[...new Set(seen)].join(',')})`);
  t(browser.length === before, 'browsers saw nothing of the plugin request');
  const again = await generateModel({ prompt: `test object ${i + 1}`, image: path.resolve(img), options: { quality: 'low' } });
  t(again && again.slug === m?.slug, 'same picture + quality again -> same slug (cache hit)');
}
await g.shutdown();
console.log(`\n${bad ? bad + ' FAILURE(S)' : 'all checks passed'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(bad ? 1 : 0);
