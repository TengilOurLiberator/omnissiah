// Benchmarks kokoro-js in Node (CPU ONNX): node kokoro-bench.mjs [dtype]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { env } = await import('@huggingface/transformers');
env.cacheDir = path.join(ROOT, '.cache', 'models');
const { KokoroTTS } = await import('kokoro-js');
const dtype = process.argv[2] || 'q8';
let t = performance.now();
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' });
console.log(`load ${dtype}: ${((performance.now() - t) / 1000).toFixed(1)}s`);
console.log('voices:', Object.keys(tts.voices).join(' '));
const lines = ['Halt! Who goes there?', 'The road north is dangerous, traveller, but I will walk with you as far as the old bridge.', 'Aye.'];
for (const [i, l] of lines.entries()) {
  for (let k = 0; k < 2; k++) {
    t = performance.now();
    const a = await tts.generate(l, { voice: 'am_michael', speed: 1 });
    const dt = (performance.now() - t) / 1000;
    const dur = a.audio.length / a.sampling_rate;
    console.log(`line${i} run${k}: ${dt.toFixed(2)}s for ${dur.toFixed(2)}s audio (rtf ${(dt / dur).toFixed(2)})`);
  }
}
