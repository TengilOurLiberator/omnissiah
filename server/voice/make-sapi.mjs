import { createTts } from '../tts.js';
import fs from 'node:fs';
const t = createTts({ outDir: 'D:/omnissiah/.cache/voice/harness/tmp' });
const u = await t.synthesize('Before your kind learned to name the stars, I was already counting them, and not one has ever been missing.');
fs.copyFileSync('D:/omnissiah/.cache/voice/harness/tmp' + u.replace('/tts',''), 'D:/omnissiah/.cache/voice/harness/sapi.wav');
console.log('ok', u);
process.exit(0);
