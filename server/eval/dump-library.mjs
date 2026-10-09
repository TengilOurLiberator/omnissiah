// Dumps world.library.list() (headless boot) to JSON: used to generate a compact catalogue for the library header.
import fs from 'node:fs';
import path from 'node:path';
import { bootGame, ROOT } from './headless.mjs';
const G = await bootGame({ gameDir: path.join(ROOT, 'public', 'game') });
const list = G.world.library?.list?.() ?? [];
fs.writeFileSync(path.join(ROOT, '.cache', 'eval', 'library-list.json'), JSON.stringify(list, null, 1));
console.log('entries', list.length, 'categories', JSON.stringify(G.world.library?.categories?.()));
process.exit(0);
