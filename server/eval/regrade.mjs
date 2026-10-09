// Re-runs the headless grader on a finished wish (no model calls): node server/eval/regrade.mjs <run> <wishId> [...]
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, runGrade } from './lib.mjs';

const [run, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const dir = path.join(CACHE, run, id);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const files = [...(rec.grade.added || []), ...(rec.grade.changed || [])].filter((f) => f.startsWith('creations/') && f.endsWith('.js'));
  const res = await runGrade({ gameDir: path.join(dir, 'root', 'public', 'game'), files, seconds: 5, out: path.join(dir, 'regrade.result.json') });
  console.log(`== ${id} boot ${JSON.stringify(res.boot)} fatal=${res.fatal ?? ''}`);
  for (const f of res.files) console.log(`  ${f.path} loaded=${f.loaded} err=${f.loadError ?? ''} upd=${f.updateError ?? ''} ex=${JSON.stringify(f.exerciseErrors ?? [])} scene=${JSON.stringify(f.scene)} ms/frame=${f.updateMs}`);
  console.log('  exercise', JSON.stringify(res.exercise));
  console.log('  mech', res.mechanisms, 'effect', res.effectKinds && JSON.stringify(res.effectKinds), 'leaks', JSON.stringify(res.cleanup?.leaks), 'coreErr', JSON.stringify(res.coreErrors), 'unhandled', JSON.stringify(res.unhandled));
}
process.exit(0);
