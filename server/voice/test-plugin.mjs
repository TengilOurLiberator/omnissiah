// End-to-end test of server/plugins/voice.js from Node with a stub `api`.
//   node test-plugin.mjs [--real N]    --real N: also make N real oracle.quick() calls (spends Claude usage!)
// Starts/stops the WSL worker itself (only a worker this script started is stopped).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseWav } from './wavutil.mjs';

process.env.VOICE_PREWARM = '0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const real = process.argv.includes('--real') ? Number(process.argv[process.argv.indexOf('--real') + 1] || 1) : 0;
const out = [];
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

const sent = [];
const sapi = { synthesize: async () => '/tts/sapi-stub.wav' };
const api = {
  root: ROOT, publicDir: path.join(ROOT, 'public'), cacheDir: path.join(ROOT, '.cache'),
  broadcast: (m) => sent.push(m), reply: (ws, m) => ws?.push?.(m), notice: () => {}, log: (...a) => console.log('   ', ...a),
  files: {}, services: { tts: sapi, stt: {} }, sapiTts: sapi,
  oracle: { busy: false, quick: async () => '' },
};

// replicate server/index.js speak(): provider, then SAPI fallback
async function speak(text) {
  let audio = null;
  try { audio = await api.services.tts.synthesize(text, { voice: 'omnissiah' }); } catch { /* fall back */ }
  if (!audio && api.services.tts !== sapi) audio = await sapi.synthesize(text);
  return audio;
}

const mod = await import(pathToFileURL(path.join(ROOT, 'server', 'plugins', 'voice.js')).href);
const plugin = await mod.default(api);
check('plugin loaded and replaced services.tts', api.services.tts !== sapi && plugin.name === 'voice');
const I = plugin._internals;

// ---------------------------------------------------------------- pure helpers
check('chunkText splits sentences', mod.chunkText('One two three four five six seven eight nine ten eleven. Twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty. Short.').length >= 2);
check('chunkText caps long runs', mod.chunkText('word '.repeat(120)).every((c) => c.length <= 230));
check('speakable numbers', mod.speakable('Seven goblins, 12 m north, 3 wolves') === 'Seven goblins, twelve metres north, three wolves');
const pr = mod.parseNpcReply('"Aye, I will come with you." [follow]');
check('parseNpcReply intent', pr.intent === 'follow' && pr.text === 'Aye, I will come with you.', JSON.stringify(pr));
check('parseNpcReply drops unknown tags', mod.parseNpcReply('Hello there. [explode]').intent === null && mod.parseNpcReply('Hello there. [explode]').text === 'Hello there.');

// ---------------------------------------------------------------- cold start: worker not running -> SAPI for the first line, never blocks
let t = Date.now();
const coldAudio = await speak('Awake. I hear you, small one.');
const coldMs = Date.now() - t;
check('cold worker: line falls back to SAPI within the budget', coldAudio === '/tts/sapi-stub.wav' && coldMs < 9000, `${coldMs} ms, got ${coldAudio}`);

// ---------------------------------------------------------------- warm
t = Date.now();
const hot = await I.warm();
console.log(`    worker warm: ${hot} after ${((Date.now() - t) / 1000).toFixed(1)} s more`);
check('worker becomes warm', hot === true);
const lines = JSON.parse(fs.readFileSync(path.join(HERE, 'lines.json'), 'utf8'));
for (const idx of [0, 4, 7, 10]) {
  t = Date.now();
  const a = await speak(lines[idx]);
  const ms = Date.now() - t;
  let secs = 0;
  if (a && a.startsWith('/tts/om_')) secs = parseWav(fs.readFileSync(path.join(ROOT, '.cache', a))).seconds;
  check(`warm line #${idx + 1} (${lines[idx].split(' ').length} words) synthesised`, !!a && a.startsWith('/tts/om_'), `${ms} ms for ${secs.toFixed(1)} s of audio -> ${a}`);
}
// voice switch
await plugin.messages.voice_set({ voice: 'oracle', preview: false }, []);
const logged = [];
const origLog = api.log; api.log = (...a) => { logged.push(a.join(' ')); origLog(...a); };
const ora = await speak('The oracle speaks softly.');
check('alternate voice is used for the normal speak() path', !!ora && ora.startsWith('/tts/om_') && logged.some((l) => /oracle:/.test(l)), ora);
sent.length = 0;
await plugin.messages.voice_preview({ voice: 'titan' });
check('voice_preview broadcasts a speak message in that voice', sent.some((m) => m.type === 'speak' && /Titan/.test(m.text) && /om_/.test(m.audio ?? '')) && logged.some((l) => /titan:/.test(l)), JSON.stringify(sent.at(-1)));
await plugin.messages.voice_set({ voice: 'omnissiah', preview: false }, []);
const cached = await speak(lines[4]);
check('repeated line is served from the recent cache', !!cached);

// ---------------------------------------------------------------- NPC voices
for (const [voice, text] of [['am_adam', 'Halt! Who goes there?'], ['af_nova', 'Mother says I am not allowed near the old well.'], ['bm_lewis', 'Rise, my loyal subjects.']]) {
  t = Date.now();
  const r = await I.npcSynthesize({ text, voice, speed: 1 });
  check(`kokoro ${voice}`, !!r && fs.existsSync(path.join(ROOT, '.cache', 'voice', 'npc', path.basename(r.url))), `${Date.now() - t} ms, ${r?.seconds?.toFixed(1)} s audio`);
}
t = Date.now();
const again = await I.npcSynthesize({ text: 'Halt! Who goes there?', voice: 'am_adam', speed: 1 });
check('kokoro cache hit is instant', !!again?.cached && Date.now() - t < 100, `${Date.now() - t} ms`);
// queue cap: 6 simultaneous distinct requests, at most 3 are accepted
const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => I.npcSynthesize({ text: `Burst number ${i} of the queue test ${Date.now()}.`, voice: 'am_michael', speed: 1 })));
check('npc queue cap drops the overflow', burst.filter(Boolean).length === 3, `${burst.filter(Boolean).length} of 6 accepted`);

// protocol: npc_say -> npc_voice
sent.length = 0;
await plugin.messages.npc_say({ type: 'npc_say', id: 'npc7', rid: 'r1', text: 'The road north is dangerous.', voice: 'am_eric', speed: 0.95, emotion: 'calm' });
const nv = sent.find((m) => m.type === 'npc_voice');
check('npc_say -> npc_voice broadcast', nv && nv.id === 'npc7' && nv.rid === 'r1' && /^\/npcvoice\/npc-[0-9a-f]+\.wav$/.test(nv.audio ?? ''), JSON.stringify(nv));
sent.length = 0;
await Promise.all([
  plugin.messages.npc_say({ type: 'npc_say', id: 'npc8', rid: 'r2', text: 'First thing I say.', voice: 'am_eric' }),
  plugin.messages.npc_say({ type: 'npc_say', id: 'npc8', rid: 'r3', text: 'Again so soon.', voice: 'am_eric' }),
]);
check('per-NPC rate limit', sent.some((m) => m.dropped === 'rate') && sent.some((m) => m.audio), JSON.stringify(sent.map((m) => m.dropped ?? 'ok')));

// ---------------------------------------------------------------- talking to an NPC, quick() stubbed
const npc = { id: 'k1', name: 'Aldric', role: 'knight', persona: 'a gruff veteran', faction: 'friendly', mood: 'calm', health: 1, holding: 'sword', nearby: ['3 goblins to the north (12 m)'], voice: 'am_adam', speed: 0.95 };
let seen = '';
api.oracle.quick = async (input) => { seen = input; return 'Aye, lead on, and I will keep the road clear. [follow]'; };
sent.length = 0;
const consumed = await plugin.utterance('Will you come with me?', { npc });
await new Promise((r) => setTimeout(r, 4000));
const rep = sent.find((m) => m.type === 'npc_reply');
check('utterance with context.npc is consumed', consumed === true);
check('npc_thinking then npc_reply', sent[0]?.type === 'npc_thinking' && !!rep && rep.intent === 'follow' && rep.text.startsWith('Aye') && !!rep.audio, JSON.stringify(rep));
check('prompt carries role, mood and the player words', /knight/.test(seen) && /Mood: calm/.test(seen) && /Will you come with me/.test(seen), '');
sent.length = 0;
await plugin.utterance('And what is your name?', { npc });
await new Promise((r) => setTimeout(r, 3500));
check('second turn includes memory of the first', /Earlier, you and the player said/.test(seen) && /lead on/.test(seen));
check('no npc in context -> not consumed', (await plugin.utterance('hello', { player: {} })) === false);
api.oracle.quick = async () => '';
sent.length = 0;
await plugin.utterance('Hmm?', { npc: { ...npc, id: 'e1', faction: 'enemy', role: 'goblin', name: 'Grukk' } });
await new Promise((r) => setTimeout(r, 3000));
const fb = sent.find((m) => m.type === 'npc_reply');
check('quick() failure -> canned in-character line', !!fb && fb.text.length > 3 && fb.intent === null, fb?.text);

// ---------------------------------------------------------------- real model calls
if (real > 0) {
  const { createOracle } = await import(pathToFileURL(path.join(ROOT, 'server', 'oracle.js')).href);
  const orc = createOracle({ gameDir: path.join(ROOT, 'public', 'game'), files: { snapshot() {}, listModules: () => [] }, send: () => {}, speak: async () => {} });
  api.oracle.quick = (input, file) => orc.quick(input, file);
  const tests = [
    ['Will you come with me to the old bridge?', npc],
    ['What do you think of the great light in the sky?', { ...npc, id: 'g2', name: 'Grukk', role: 'goblin', persona: 'a sly, crude goblin raider', faction: 'enemy', mood: 'hostile', voice: 'am_puck', speed: 1.1, nearby: ['the player stands 3 m away'] }],
  ].slice(0, real);
  for (const [say, n] of tests) {
    sent.length = 0;
    t = Date.now();
    await plugin.utterance(say, { npc: n });
    while (!sent.find((m) => m.type === 'npc_reply') && Date.now() - t < 40000) await new Promise((r) => setTimeout(r, 200));
    const r = sent.find((m) => m.type === 'npc_reply');
    console.log(`    REAL "${say}" -> ${JSON.stringify(r?.text)} intent=${r?.intent} audio=${r?.audio} total ${Date.now() - t} ms`);
    check(`real oracle.quick reply for ${n.name}`, !!r && r.text.length > 3 && !!r.audio);
  }
}

// ---------------------------------------------------------------- worker stopped -> fallback
await I.stopWorker();
check('worker stopped', I.W.state === 'stopped');
t = Date.now();
const down = await speak('Can you hear me now?');
check('worker stopped: SAPI fallback, no hang', down === '/tts/sapi-stub.wav' && Date.now() - t < 9000, `${Date.now() - t} ms`);
await plugin.shutdown();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
