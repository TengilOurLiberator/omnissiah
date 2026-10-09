// Renders one raw Kokoro sample per NPC archetype (the casting in public/game/core/voices.js) -> .cache/voice/samples/npc-raw/<archetype>.wav
// harness/npc.html then pushes them through the real browser-side voice code (pitch rate + fx) -> .cache/voice/samples/npc/<archetype>.wav
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeWav } from './wavutil.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ARCHETYPES, castVoice } = await import(pathToFileURL(path.join(ROOT, 'public', 'game', 'core', 'voices.js')).href);
const { env } = await import('@huggingface/transformers');
env.cacheDir = path.join(ROOT, '.cache', 'models');
const { KokoroTTS } = await import('kokoro-js');
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: process.env.KOKORO_DTYPE || 'q8', device: 'cpu' });
const LINES = {
  'dark-knight': 'You stand before a servant of the black throne. Kneel, or be broken.',
  knight: 'Halt, traveller! The road north is dangerous, but I will walk with you to the old bridge.',
  barbarian: 'Ha! Bring me ten more of them, and a barrel to drink to it!',
  mage: 'Curious. The stars above this field are arranged in a way I do not recognise.',
  archer: 'Quiet now. Three goblins by the dead tree. I have them in my sights.',
  rogue: 'Everything has a price, friend, and most things have a back door.',
  king: 'Rise, my loyal subjects. This kingdom endures because you are brave.',
  merchant: 'Fine wares, fair prices! A sword like this will save your life, and mine is cheap!',
  child: 'Mother says I must not go near the old well. But I think there is a dragon in it.',
  elder: 'Seventy winters I have watched this valley. Nothing here is ever truly new.',
  'goblin-shaman': 'Hehehe! The moon is hungry tonight, and the bones have spoken your name!',
  goblin: 'Shiny! Give it to Snag, tall one, or Snag will bite your toes!',
  troll: 'Troll hungry. You look small. Small is good.',
  orc: 'You are weak. I can smell it. Come closer and I will end it quickly.',
  skeleton: 'I have been dead a very long time, and I must say, the company is poor.',
  demon: 'Make your bargain, little flame. I have waited since the world was ash.',
  zombie: 'Hungry... so hungry... stay... stay...',
  vampire: 'Good evening. Do come in. Please, I insist, the night is so very long.',
  ghost: 'I remember a house, and a garden. Do you know where it went?',
  'villager-f': 'Oh! You startled me. There are goblins in the north field, so be careful.',
  villager: 'Morning, friend. If you are looking for the inn, it is past the mill.',
  person: 'Hello there. Lovely weather for it, and no dragons yet today.',
};
const out = path.join(ROOT, '.cache', 'voice', 'samples', 'npc-raw');
fs.mkdirSync(out, { recursive: true });
const meta = {};
for (const a of [...ARCHETYPES.map((x) => x.key), 'person']) {
  const c = castVoice({ id: 'sample-' + a, roleText: a === 'person' ? 'unknown' : a === 'villager-f' ? 'villager female' : a });
  const t = performance.now();
  const r = await tts.generate(LINES[a], { voice: c.voice, speed: c.speed });
  writeWav(path.join(out, a + '.wav'), r.audio, r.sampling_rate);
  meta[a] = { text: LINES[a], voice: c.voice, speed: c.speed, rate: c.rate, fx: c.fx, seconds: +(r.audio.length / r.sampling_rate).toFixed(2), ms: Math.round(performance.now() - t) };
  console.log(a.padEnd(14), c.voice.padEnd(10), 'speed', c.speed, 'rate', c.rate, `${meta[a].seconds}s in ${meta[a].ms}ms`);
}
fs.writeFileSync(path.join(out, '..', 'npc-meta.json'), JSON.stringify(meta, null, 1));
process.exit(0);
