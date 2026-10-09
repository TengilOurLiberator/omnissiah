// Blast from PowerShell (the game server does not need to run):
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\server\blast\cli.mjs "a wizard's cluttered tower study at night"
//   D:\omnissiah\tools\node\node.exe D:\omnissiah\server\blast\cli.mjs --image castle.png --max 6 --budget 15
//   options: --prompt "<words>"  --image <file in input\ or path inside the game folder>  --max <objects, 1-14>  --seed <n>  --budget <minutes>  --force  --fantasy
// Prints every blast_status line; the project lands in public\assets\generated\blasts\<slug>\ (and is in the game's cache at once).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const free = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['force', 'fantasy'].includes(args[i - 1].slice(2))));
const prompt = flag('prompt') ?? free.join(' ');
const image = flag('image');
if (!prompt && !image) { console.log('usage: cli.mjs "<scene words>" | --image <file in input\\>   [--max N] [--seed N] [--budget minutes] [--force] [--fantasy]'); process.exit(1); }

const { createBlast } = await import(pathToFileURL(path.join(root, 'server', 'blast', 'service.js')).href);
const { neighbours } = await import(pathToFileURL(path.join(root, 'server', 'plugins', 'blast.js')).href);
const { createOracle } = await import(pathToFileURL(path.join(root, 'server', 'oracle.js')).href);
const oracle = createOracle({ gameDir: path.join(root, 'public', 'game'), files: null, send: () => {}, speak: async () => {} });
const t0 = Date.now();
const svc = createBlast({
  root, oracle, services: neighbours(), log: (...a) => console.log('  [log]', ...a),
  send: (m) => { if (m.type === 'blast_status' && !m.replay) console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${m.stage.padEnd(7)} ${m.state.padEnd(8)} ${m.progress?.total ? `${m.progress.done}/${m.progress.total} ` : ''}${m.message}`); },
});
const options = { maxObjects: flag('max') ? Number(flag('max')) : undefined, seed: flag('seed'), budgetMs: flag('budget') ? Number(flag('budget')) * 60000 : undefined, force: has('force'), fantasy: has('fantasy') };
const manifest = await svc.request({ prompt, image, options });
console.log(manifest ? `\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${manifest.slug}  (${manifest.objects.length} objects, place ${manifest.place?.slug ?? 'none'}, ambient ${manifest.ambient ? 'yes' : 'no'})\n${path.join(root, 'public', 'assets', 'generated', 'blasts', manifest.slug)}` : '\nNo result.');
await svc.shutdown();
setTimeout(() => process.exit(0), 500);
