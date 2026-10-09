// Test generation from the command line (no game server needed):
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\server\gen3d\test.mjs "a purple dragon" [low|standard|high] [more prompts...] [--animate true|false|auto] [--image D:\omnissiah\x.png]
// Each prompt goes through createGen3d exactly like a game client's { type:'gen3d' } message would. With --image the picture replaces the text-to-image stage
// (the prompt is then just a label); a plugin would call generateModel({ prompt, image, options }) the same way.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGen3d } from '../gen3d.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
let quality = 'standard', animate, image;
const prompts = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--animate') { const v = args[++i]; animate = v === 'true' ? true : v === 'false' ? false : 'auto'; }
  else if (a === '--image') image = args[++i];
  else if (['low', 'standard', 'high'].includes(a)) quality = a;
  else prompts.push(a);
}
if (!prompts.length && !image) { console.log('usage: node test.mjs "a wooden treasure chest" [low|standard|high] [--animate true|false|auto] [--image file.png]'); process.exit(1); }
if (image && !prompts.length) prompts.push('');

const t0 = Date.now();
const g = createGen3d({ root, send: (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`, JSON.stringify(m)) });
const results = await Promise.all(prompts.map((p, i) => g.request({ id: `t${i}`, prompt: p, options: { quality, ...(animate !== undefined ? { animate } : {}), ...(image ? { image } : {}) } })));
console.log(results.map((r) => `${r.state}: ${r.url ?? r.message}`).join('\n'));
await g.shutdown();
process.exit(results.every((r) => r.state === 'done') ? 0 : 2);
