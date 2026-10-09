// Prompt lab: node lab.mjs <items.json> [candidates=3]   items = [{id, prompt, seconds, loop?, single?, kind?:'music', bpm?}]
// Prints CLAP similarity / rank per prompt so wording can be compared without listening. Files go to .cache/audio/lab/<id>.ogg.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudio } from './service.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cand = Number(process.argv[3]) || 3;
const svc = createAudio({ root: ROOT, log: () => {} });
try {
  for (const it of items) {
    const t = Date.now();
    try {
      const st = await svc.generateFile({ kind: it.kind ?? 'sfx', prompt: it.prompt, seconds: it.seconds ?? 2, loop: !!it.loop, single: !!it.single, bpm: it.bpm, seed: it.seed ?? 5, candidates: cand, score: true },
        path.join(ROOT, '.cache', 'audio', 'lab', `${it.id}.ogg`));
      console.log(`${it.id.padEnd(22)} sim ${st.clap?.sim} rank ${st.clap?.rank}/${st.clap?.of} dur ${st.duration} cen ${st.final?.centroid_hz} takes ${st.takes} ${st.warnings?.length ? 'WARN ' + st.warnings.join('; ') : ''} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    } catch (e) { console.log(it.id, 'FAILED', e.message); }
  }
} finally { await svc.shutdown(); }
