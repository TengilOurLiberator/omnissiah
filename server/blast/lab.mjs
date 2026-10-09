// Prompt lab for the blast worker (dev tool): node lab.mjs scenes | edit <json>
//   scenes               generate the six evaluation scenes into .cache/blast/lab/scene-*.png
//   edit <items.json>    run a batch of edits: [{ id, images:[winpath..], prompt, out(winpath), seed, width, height }]
// Talks to a running worker on 127.0.0.1:18785 (start: wsl.exe -d Ubuntu -- bash /mnt/d/omnissiah/server/blast/start_worker.sh).
import fs from 'node:fs';
import path from 'node:path';
import { sceneWrapper } from './prompts.js';

const PORT = Number(process.env.BLAST_PORT) || 18785;
const toWsl = (p) => { const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p)); return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p; };
const call = async (method, url, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
async function wait(job) {
  for (;;) {
    const v = await call('GET', `/jobs/${job}`);
    if (v.state === 'done' || v.state === 'error') return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const LAB = path.resolve('D:/omnissiah/.cache/blast/lab');
fs.mkdirSync(LAB, { recursive: true });

const SCENES = [
  ['study', "a wizard's cluttered tower study at night, a big oak desk with books, a candle, a skull and a globe, an armchair, a potion cabinet, stacked crates and a barrel"],
  ['tavern', 'a cosy medieval tavern interior, wooden tables with mugs and stools, a barrel, a lantern hanging, a stone fireplace, a bar counter with bottles'],
  ['camp', 'a forest campsite at dusk, a campfire with a cooking pot, a canvas tent, logs to sit on, a backpack, a lantern, a wooden crate, tall pines'],
  ['lab', 'a sci-fi laboratory with glowing consoles, a robot arm, a holographic table, canisters and crates, a chair, metal floor'],
  ['market', 'a medieval market street, fruit stalls with crates and baskets, barrels, a cart, a well, hanging banners, cobblestones'],
  ['cave', 'a cave with a treasure hoard, a chest full of gold, a pile of coins, a sword stuck in a rock, a skull, torches, crystals'],
];

const cmd = process.argv[2];
if (cmd === 'scenes') {
  const only = process.argv[3];
  for (const [name, subject] of SCENES) {
    if (only && only !== name) continue;
    const out = path.join(LAB, `scene-${name}.png`);
    const t0 = Date.now();
    const { job, error } = await call('POST', '/generate', { prompt: sceneWrapper(subject), width: 1344, height: 768, seed: 11, out: toWsl(out) });
    if (error) { console.log(name, 'ERROR', error); continue; }
    const v = await wait(job);
    console.log(name, v.state, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(v.stats), v.error ?? '');
  }
} else if (cmd === 'edit') {
  const items = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).map((it) => ({ ...it, images: it.images.map(toWsl), out: toWsl(it.out) }));
  const t0 = Date.now();
  const { job, error } = await call('POST', '/edit', { items });
  if (error) { console.log('ERROR', error); process.exit(1); }
  const v = await wait(job);
  console.log(v.state, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(v.stats), v.error ?? '');
  for (const it of v.items) console.log(' ', it.id, it.ok, it.seconds, it.error ?? '');
}
