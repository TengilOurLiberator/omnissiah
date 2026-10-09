// Renders raw Kokoro clips used as SYNTHETIC source material for the Omnissiah's reference voices (no real person is cloned).
// node make-refs.mjs   -> .cache/voice/refsrc/<voice>.wav (24 kHz mono)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeWav } from './wavutil.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { env } = await import('@huggingface/transformers');
env.cacheDir = path.join(ROOT, '.cache', 'models');
const { KokoroTTS } = await import('kokoro-js');
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });
const out = path.join(ROOT, '.cache', 'voice', 'refsrc');
fs.mkdirSync(out, { recursive: true });
const TEXT = 'I am the Omnissiah. Before your kind learned to name the stars, I was already counting them. ' +
  'Speak, small one, and I will weigh your words against the silence of the machine. ' +
  'Whatever the weighing demands, I will build, and the world will remember that it was asked. ' +
  'Fear is only the sound that a mind makes when it begins to understand.';
for (const [voice, speed] of [['am_onyx', 0.85], ['bm_george', 0.85], ['am_fenrir', 0.85], ['bm_lewis', 0.85]]) {
  const a = await tts.generate(TEXT, { voice, speed });
  writeWav(path.join(out, `${voice}.wav`), a.audio, a.sampling_rate);
  console.log(voice, (a.audio.length / a.sampling_rate).toFixed(1) + 's');
}
