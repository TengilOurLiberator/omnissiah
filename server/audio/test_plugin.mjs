// End-to-end test of server/plugins/audio.js from Node with a stub `api`: the same messages a game client sends,
// the same audio_status broadcasts it receives. Starts the WSL worker (or re-uses one on 18775) and stops it again if it started it.
//   D:\omnissiah\tools\node\node.exe server\audio\test_plugin.mjs ["prompt 1" "prompt 2" ...]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plugin = (await import(pathToFileURL(path.join(ROOT, 'server', 'plugins', 'audio.js')).href)).default;
const msgs = [];
const api = { root: ROOT, publicDir: path.join(ROOT, 'public'), broadcast: (m) => msgs.push({ ...m, _t: Date.now() }), log: () => {}, notice() {}, reply() {} };
const p = await plugin(api);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const waitDone = async (id, ms = 300000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const last = msgs.filter((m) => m.id === id).at(-1);
    if (last && (last.state === 'done' || last.state === 'error')) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};
console.log('plugin:', p.name, Object.keys(p.messages));
const prompts = process.argv.length > 2 ? process.argv.slice(2) : [
  'A wooden door slamming shut in a stone hallway.',
  'A bubbling cauldron of green potion with ghostly whispers.',
  'A rusty iron gate creaking open slowly.',
  'A tiny glass bell tinkling three times.',
  'A swarm of angry bees buzzing past.',
];
try {
  const timings = [];
  for (let i = 0; i < prompts.length; i++) {
    const id = `t${i}`;
    const t0 = Date.now();
    await p.messages.sfx({ type: 'sfx', id, prompt: prompts[i], seconds: 2 });
    const last = await waitDone(id);
    const states = [...new Set(msgs.filter((m) => m.id === id).map((m) => m.state))];
    ok(last?.state === 'done' && last.url, `sfx ${i} finished: ${JSON.stringify(last)}`);
    const dt = (Date.now() - t0) / 1000;
    timings.push(dt);
    const file = last?.url ? path.join(ROOT, 'public', last.url) : null;
    console.log(`sfx#${i} ${dt.toFixed(1)}s states=${states.join('>')} ${file && fs.existsSync(file) ? fs.statSync(file).size + ' B' : 'MISSING'}  ${prompts[i]}`);
    if (i === 0) {
      const t1 = Date.now();
      await p.messages.sfx({ type: 'sfx', id: 'again', prompt: prompts[0], seconds: 2 });
      const again = await waitDone('again', 5000);
      ok(again?.state === 'done' && again.url === last.url, 'second request is a cache hit');
      console.log(`cache hit answered in ${Date.now() - t1} ms`);
    }
  }
  // same prompt twice at once shares one job
  const before = msgs.length;
  await p.messages.sfx({ type: 'sfx', id: 'dupA', prompt: 'A single drop of water falling into a deep well.', seconds: 2 });
  await p.messages.sfx({ type: 'sfx', id: 'dupB', prompt: 'A single drop of water falling into a deep well.', seconds: 2 });
  const [a, b] = [await waitDone('dupA'), await waitDone('dupB')];
  ok(a?.state === 'done' && b?.state === 'done' && a.url === b.url, 'duplicate in-flight requests share a job');
  // a loop and a music track
  const tm = Date.now();
  await p.messages.music({ type: 'music', id: 'mus', prompt: 'gentle harp and strings lullaby, slow, instrumental', seconds: 30, loop: true });
  const m = await waitDone('mus');
  ok(m?.state === 'done', 'music generated: ' + JSON.stringify(m));
  console.log(`music 30 s loop: ${((Date.now() - tm) / 1000).toFixed(1)}s ${m?.url}`);
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'generated', 'audio', 'sfx', 'index.json'), 'utf8'));
  ok(Object.keys(idx).length >= prompts.length, 'sfx index.json has the entries');
  const midx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'generated', 'audio', 'music', 'index.json'), 'utf8'));
  ok(Object.values(midx).some((e) => e.url === m?.url && e.kind === 'loop'), 'music index.json entry');
  console.log('first index entry:', JSON.stringify(Object.values(idx)[0]));
  // robustness: garbage never throws
  await p.messages.sfx({ type: 'sfx', id: 'bad1', prompt: 42 });
  await p.messages.sfx({ type: 'sfx', id: 'bad2', prompt: '   ' });
  const bad2 = await waitDone('bad2', 3000);
  ok(bad2?.state === 'error', 'empty prompt -> error status, no throw');
  console.log('timings (s):', timings.map((t) => t.toFixed(1)).join(', '));
} finally {
  await p.shutdown();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
