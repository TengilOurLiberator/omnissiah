// Benchmarks the voice worker end to end and checks intelligibility with the server's Whisper.
//   node bench.mjs <voice> [<voice>...] [--port 18770] [--no-wer] [--lines N] [--out dir]
// Needs the worker running (wsl bash server/voice/start_worker.sh) - see README.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseWav } from './wavutil.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const port = Number(opt('--port', 18770));
const nLines = Number(opt('--lines', 99));
const outRoot = opt('--out', path.join(ROOT, '.cache', 'voice', 'bench'));
const noWer = flag('--no-wer');
const voices = args.length ? args : ['omnissiah'];
const lines = JSON.parse(fs.readFileSync(path.join(HERE, 'lines.json'), 'utf8')).slice(0, nLines);

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) }));
    });
    req.on('error', reject); req.end(data);
  });
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
function wer(ref, hyp) {
  const a = norm(ref), b = norm(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return { errors: d[a.length][b.length], words: a.length };
}

let stt = null;
if (!noWer) { const { createStt } = await import('../stt.js'); stt = createStt(); await stt.ready; }

const summary = {};
for (const voice of voices) {
  const dir = path.join(outRoot, voice); fs.mkdirSync(dir, { recursive: true });
  let errors = 0, words = 0, genMs = 0, audioS = 0;
  const rows = [];
  for (const [i, text] of lines.entries()) {
    const t = performance.now();
    const r = await post('/speak', { voice, text, seed: 100 + i });
    const wall = performance.now() - t;
    if (r.status !== 200) { console.log(`${voice} #${i} FAILED ${r.status} ${r.body.toString().slice(0, 200)}`); continue; }
    const file = path.join(dir, String(i + 1).padStart(2, '0') + '.wav');
    fs.writeFileSync(file, r.body);
    const w = parseWav(r.body);
    let pk = 0, clip = 0;
    for (const s of w.samples) { const v = Math.abs(s); if (v > pk) pk = v; if (v >= 0.999) clip++; }
    let heard = '', e = { errors: 0, words: norm(text).length };
    if (stt) {
      const i16 = new Int16Array(w.samples.length); for (let k = 0; k < i16.length; k++) i16[k] = Math.round(Math.max(-1, Math.min(1, w.samples[k])) * 32767);
      heard = await stt.transcribe(i16, w.rate); e = wer(text, heard); errors += e.errors; words += e.words;
    }
    genMs += wall; audioS += w.seconds;
    rows.push({ i: i + 1, words: e.words, audio_s: +w.seconds.toFixed(2), wall_s: +(wall / 1000).toFixed(2), peak: +pk.toFixed(3), clipped: clip, wps: +(norm(text).length / w.seconds).toFixed(2), err: e.errors, heard });
    console.log(`${voice} #${String(i + 1).padStart(2)} wall ${(wall / 1000).toFixed(2)}s audio ${w.seconds.toFixed(2)}s peak ${pk.toFixed(2)} clip ${clip} wps ${(norm(text).length / w.seconds).toFixed(2)}${stt ? ` err ${e.errors}/${e.words}` : ''}${e.errors ? `  heard: ${heard}` : ''}`);
  }
  summary[voice] = { wordAccuracy: words ? +(100 * (1 - errors / words)).toFixed(1) : null, totalWords: words, wall_s: +(genMs / 1000).toFixed(1), audio_s: +audioS.toFixed(1), rtf: +(genMs / 1000 / audioS).toFixed(2), rows };
  console.log(`== ${voice}: word accuracy ${summary[voice].wordAccuracy}% (${errors} errors / ${words} words), rtf ${summary[voice].rtf}`);
}
fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 1));
process.exit(0);
