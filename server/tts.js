// Text-to-speech via Windows SAPI (System.Speech) driven through powershell.exe.
// The text goes through a temp file and the script through stdin, never on a command line.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_AGE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 45000;
const MAX_CHARS = 2500;

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice($env:OM_VOICE) } catch { [Console]::Error.WriteLine('voice not found: ' + $env:OM_VOICE) }
$s.Rate = [int]$env:OM_RATE
$s.Volume = 100
$text = [System.IO.File]::ReadAllText($env:OM_TXT, [System.Text.Encoding]::UTF8)
$s.SetOutputToWaveFile($env:OM_WAV)
$s.Speak($text)
$s.Dispose()
`;

function clean(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

export function createTts({ outDir, voice = process.env.TTS_VOICE || 'Microsoft David Desktop', rate = Number(process.env.TTS_RATE ?? -2) } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  let chain = Promise.resolve();

  function sweep() {
    const cutoff = Date.now() - MAX_AGE_MS;
    let names = [];
    try { names = fs.readdirSync(outDir); } catch { return; }
    for (const n of names) {
      if (!/\.(wav|txt)$/.test(n)) continue;
      const p = path.join(outDir, n);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { /* in use or gone */ }
    }
  }
  sweep();

  function run(text) {
    return new Promise((resolve) => {
      const id = crypto.randomBytes(8).toString('hex');
      const wav = path.join(outDir, `${id}.wav`);
      const txt = path.join(outDir, `${id}.txt`);
      try { fs.writeFileSync(txt, text, 'utf8'); } catch (err) {
        console.error('[tts] cannot write temp file:', err.message);
        return resolve(null);
      }
      let done = false;
      let stderr = '';
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(killer);
        try { fs.unlinkSync(txt); } catch { /* ignore */ }
        let good = false;
        try { good = ok && fs.statSync(wav).size > 44; } catch { /* no output */ }
        if (!good) {
          try { fs.unlinkSync(wav); } catch { /* ignore */ }
          console.error(`[tts] synthesis failed${stderr ? ': ' + stderr.trim().slice(0, 400) : ''}`);
          return resolve(null);
        }
        resolve(`/tts/${id}.wav`);
      };
      let child;
      try {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
          windowsHide: true,
          stdio: ['pipe', 'ignore', 'pipe'],
          env: { ...process.env, OM_VOICE: voice, OM_RATE: String(rate), OM_TXT: txt, OM_WAV: wav },
        });
      } catch (err) {
        stderr = err.message;
        return finish(false);
      }
      const killer = setTimeout(() => { stderr = 'timed out'; try { child.kill(); } catch { /* ignore */ } finish(false); }, TIMEOUT_MS);
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (err) => { stderr = err.message; finish(false); });
      child.on('close', (code) => finish(code === 0));
      child.stdin.on('error', () => { /* process died early; close handler reports */ });
      child.stdin.end(SCRIPT);
    });
  }

  // Resolves to '/tts/<id>.wav', or null on any failure. Jobs run one at a time.
  function synthesize(text) {
    const t = clean(text);
    if (!t) return Promise.resolve(null);
    const job = chain.then(() => { sweep(); return run(t); }).catch((err) => { console.error('[tts]', err); return null; });
    chain = job;
    return job;
  }

  return { synthesize };
}
