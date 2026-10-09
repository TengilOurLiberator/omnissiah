// Checks the plugin API (server/gen3d.js `generateModel`) without needing a GPU when the answer is cached:
//   node test_generate_model.mjs <image under the game folder> [quality]
// 1. cached picture -> { url, slug, meta } immediately  2. bad paths / empty input -> null (never throws)  3. same instance as createGen3d
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGen3d, generateModel } from '../gen3d.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const image = process.argv[2], quality = process.argv[3] || 'low';
const browserMsgs = [];
const g = createGen3d({ root, send: (m) => browserMsgs.push(m) });
let bad = 0;
const t = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };
const seen = [];
const r = await generateModel({ prompt: 'clay teapot from picture', image, options: { quality, onStatus: (m) => seen.push(m.state) } });
t(r && r.url && r.slug && r.meta?.from_image === true, `cached image -> ${JSON.stringify(r && { url: r.url, slug: r.slug, from_image: r.meta?.from_image })}`);
t(browserMsgs.length === 0, 'browsers saw nothing of the plugin request');
t(seen.includes('done'), `onStatus callback saw: ${seen.join(',')}`);
t((await generateModel({ image: path.join(root, '..', 'outside.png') })) === null, 'image outside the game folder -> null');
t((await generateModel({ image: path.join(root, 'package.json') })) === null, 'non-picture -> null');
t((await generateModel({ image: path.join(root, 'nope.png') })) === null, 'missing file -> null');
t((await generateModel({})) === null, 'empty request -> null');
t(createGen3d({ root }) === g, 'createGen3d returns the shared instance');
await g.shutdown();
process.exit(bad ? 1 : 0);
