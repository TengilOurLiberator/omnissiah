// Speech-to-text. Primary: a GPU worker in WSL (faster-whisper large-v3-turbo, server/stt/worker.py, 127.0.0.1:18790),
// started/attached automatically. Fallback (any GPU failure, or STT_BACKEND=cpu): local Whisper via @huggingface/transformers.
// Env: STT_BACKEND=cpu|auto (default auto), STT_LANG=en (default; 'auto' = detect), STT_MODEL = CPU fallback model.
import { spawn, spawnSync, execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_RATE = 16000;

// mono Int16 -> Float32 at 16 kHz. Box-averages when downsampling (crude low-pass), lerps when upsampling.
export function toFloat16k(int16, sampleRate) {
  const n = int16.length;
  const scale = 1 / 32768;
  if (!sampleRate || sampleRate === TARGET_RATE) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = int16[i] * scale;
    return out;
  }
  const ratio = sampleRate / TARGET_RATE;
  const outLen = Math.max(0, Math.floor(n / ratio));
  const out = new Float32Array(outLen);
  if (ratio > 1) {
    for (let i = 0; i < outLen; i++) {
      const a = i * ratio, b = Math.min(n, (i + 1) * ratio);
      let i0 = Math.floor(a);
      let sum = 0, w = 0;
      for (; i0 < b; i0++) {
        const lo = Math.max(a, i0), hi = Math.min(b, i0 + 1);
        const wt = hi - lo;
        if (wt <= 0) continue;
        sum += int16[i0] * wt; w += wt;
      }
      out[i] = w ? (sum / w) * scale : 0;
    }
  } else {
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos), i1 = Math.min(n - 1, i0 + 1), f = pos - i0;
      out[i] = (int16[i0] * (1 - f) + int16[i1] * f) * scale;
    }
  }
  return out;
}

// ------------------------------------------------------------------ GPU worker (faster-whisper large-v3-turbo in WSL)
const GPU_PORT = 18790;
const GPU_TIMEOUT_MS = 8000;       // per-utterance budget before falling back to the CPU model
const GPU_RETRY_COOLDOWN_MS = 30000;
const toWsl = (p) => {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p));
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpRaw(method, port, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs,
      headers: body ? { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length } : { 'Content-Length': 0 },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: j });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createGpu({ enabled, lang }) {
  const distro = process.env.STT_DISTRO || process.env.VOICE_DISTRO || 'Ubuntu';
  const G = { state: enabled ? 'stopped' : 'disabled', port: GPU_PORT, child: null, startedByUs: false, startPromise: null, lastError: null, failedAt: 0 };

  const health = async (port, ms = 1500) => {
    try { const r = await httpRaw('GET', port, '/health', null, ms); return r.status === 200 ? r.body : null; } catch { return null; }
  };
  const freePort = (preferred) => new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => (p === 0 ? resolve(GPU_PORT + 1) : tryPort(0)));
      s.listen(p, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); });
    };
    tryPort(preferred);
  });

  async function startOnce() {
    const existing = await health(GPU_PORT);
    if (existing?.ok) { // attach to a worker that is already up (not ours: never shut it down)
      G.port = GPU_PORT; G.startedByUs = false;
      if (!existing.ready && !(await waitReady(GPU_PORT, 120, 500, () => false))) throw new Error('existing GPU worker never became ready');
      return;
    }
    const port = await freePort(GPU_PORT);
    const script = toWsl(path.join(ROOT, 'server', 'stt', 'start_worker.sh'));
    console.log(`[stt] starting GPU speech worker (WSL ${distro}) on 127.0.0.1:${port}...`);
    let spawnError = null, gone = false;
    const child = spawn('wsl.exe', ['-d', distro, '--', 'bash', script, '--port', String(port), '--host', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
    child.on('error', (e) => { spawnError = e; });
    child.on('exit', (code) => { gone = true; if (G.child === child) { G.child = null; if (G.state === 'ready') { G.state = 'stopped'; G.lastError = `worker exited (${code})`; console.log(`[stt] GPU worker exited (${code})`); } } });
    G.child = child; G.port = port; G.startedByUs = true;
    const ok = await waitReady(port, 180, 500, () => gone);
    if (!ok) {
      killChild();
      throw new Error(spawnError ? (spawnError.code === 'ENOENT' ? 'wsl.exe not found' : spawnError.message) : 'GPU worker did not become ready (see .cache/stt/worker.stdout.log)');
    }
  }
  async function waitReady(port, tries, delayMs, isGone) {
    for (let i = 0; i < tries; i++) {
      const h = await health(port, 2000);
      if (h?.ready) return true;
      if (h && h.error) throw new Error(`worker error: ${h.error}`);
      if (isGone()) return false;
      await sleep(delayMs);
    }
    return false;
  }
  function killChild() {
    const c = G.child; G.child = null;
    if (c && c.exitCode === null) { try { execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* ignore */ } }
  }

  // Starts or attaches in the background. Resolves true when the worker is ready. Never rejects.
  function ensure() {
    if (!enabled) return Promise.resolve(false);
    if (G.state === 'ready') return Promise.resolve(true);
    if (G.startPromise) return G.startPromise;
    if (Date.now() - G.failedAt < GPU_RETRY_COOLDOWN_MS) return Promise.resolve(false);
    G.state = 'starting';
    const t0 = Date.now();
    G.startPromise = startOnce().then(() => { G.state = 'ready'; G.lastError = null; console.log(`[stt] GPU speech worker ready (${((Date.now() - t0) / 1000).toFixed(1)} s)`); return true; })
      .catch((err) => { G.state = 'error'; G.lastError = err?.message ?? String(err); G.failedAt = Date.now(); console.error('[stt] GPU worker unavailable:', G.lastError); return false; })
      .finally(() => { G.startPromise = null; });
    return G.startPromise;
  }

  // int16: mono PCM (already gain-normalised). -> { text, ms } or throws.
  async function transcribe(int16, sampleRate) {
    const body = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
    const q = `/transcribe?rate=${encodeURIComponent(sampleRate || TARGET_RATE)}&lang=${encodeURIComponent(lang)}`;
    const r = await httpRaw('POST', G.port, q, body, GPU_TIMEOUT_MS);
    if (r.status !== 200) throw new Error(`worker ${r.status}: ${r.body?.error ?? ''}`);
    return { text: String(r.body.text ?? ''), ms: r.body.ms };
  }
  function markDead(err) { // connection-level failure: forget the worker so ensure() retries after the cooldown
    G.state = 'error'; G.lastError = err?.message ?? String(err); G.failedAt = Date.now();
    if (G.startedByUs) killChild();
    G.startedByUs = false;
  }

  async function stop() {
    if (!G.startedByUs) return;
    G.startedByUs = false;
    try { await httpRaw('POST', G.port, '/shutdown', null, 2000); } catch { /* already gone */ }
    killChild();
    G.state = 'stopped';
  }
  function stopSync() { // process 'exit': only async-free calls allowed
    if (!G.startedByUs) return;
    G.startedByUs = false;
    try { spawnSync('curl.exe', ['-s', '-m', '2', '-X', 'POST', `http://127.0.0.1:${G.port}/shutdown`], { windowsHide: true, timeout: 3000 }); } catch { /* ignore */ }
    const c = G.child;
    if (c && c.exitCode === null) { try { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }); } catch { /* ignore */ } }
  }
  return { G, ensure, transcribe, markDead, stop, stopSync };
}

export function createStt({ model = process.env.STT_MODEL || 'Xenova/whisper-small.en' } = {}) {
  let asr = null;
  let loadError = null;
  let chain = Promise.resolve();
  const gpuEnabled = (process.env.STT_BACKEND || 'auto').toLowerCase() !== 'cpu';
  const gpu = createGpu({ enabled: gpuEnabled, lang: process.env.STT_LANG || 'en' });
  if (gpuEnabled) {
    process.once('exit', () => gpu.stopSync());
    setImmediate(() => { gpu.ensure(); }); // warm the GPU worker in the background; never blocks startup
  }

  // Starts loading immediately. Never rejects: resolves true when some backend is usable, false if
  // loading failed (transcribe() then rejects with the reason).
  const cpuReady = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.join(ROOT, '.cache', 'models');
      let lastPct = -10;
      console.log(`[stt] loading ${model} (first run downloads it)...`);
      asr = await pipeline('automatic-speech-recognition', model, {
        progress_callback: (p) => {
          if (p?.status === 'progress' && /\.onnx$/.test(p.file ?? '') && typeof p.progress === 'number' && p.progress - lastPct >= 10) {
            lastPct = p.progress;
            console.log(`[stt] downloading ${p.file ?? ''} ${Math.round(p.progress)}%`);
          } else if (p?.status === 'done') lastPct = -10;
        },
      });
      console.log('[stt] speech recognition ready.');
      return true;
    } catch (err) {
      loadError = err;
      console.error('[stt] could not load speech model:', err?.message ?? err);
      return false;
    }
  })();
  // True when any backend can answer: the CPU model, or (if that failed to load) the GPU worker.
  const ready = (async () => {
    if (await cpuReady) return true;
    return gpuEnabled ? await gpu.ensure() : false;
  })();

  const cleanText = (t) => String(t ?? '').replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  const last = { seconds: 0, peak: 0, silent: false, backend: 'none', ms: 0 };
  async function run(int16, sampleRate) {
    last.seconds = 0; last.peak = 0; last.silent = true; last.backend = 'none'; last.ms = 0;
    const samples = toFloat16k(int16, sampleRate);
    if (samples.length < TARGET_RATE * 0.25) return ''; // under a quarter second: just a click
    let peak = 0;
    for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
    last.seconds = samples.length / TARGET_RATE; last.peak = peak; last.silent = peak < 0.003;
    if (last.silent) return ''; // digital silence; Whisper would hallucinate "you" etc.
    // Quiet microphones (the Quest's is) are boosted to a healthy level instead of being rejected.
    const g = peak < 0.5 ? Math.min(0.7 / peak, 60) : 1;

    // 1) GPU worker (faster-whisper large-v3-turbo). Any failure falls through to the CPU model.
    let gpuWhy = gpuEnabled ? null : 'disabled';
    if (gpuEnabled) {
      const t0 = Date.now();
      try {
        let ok = gpu.G.state === 'ready';
        if (!ok) ok = await Promise.race([gpu.ensure(), sleep(3000).then(() => false)]); // first use while it is still starting: wait briefly, else CPU
        if (ok) {
          let body = int16;
          if (g !== 1) { body = new Int16Array(int16.length); for (let i = 0; i < int16.length; i++) { const v = int16[i] * g; body[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; } }
          const r = await gpu.transcribe(body, sampleRate);
          last.backend = 'gpu'; last.ms = Date.now() - t0;
          console.log(`[stt] gpu ${last.ms} ms`);
          return cleanText(r.text);
        }
        gpuWhy = gpu.G.lastError ?? 'worker not ready';
      } catch (err) {
        gpuWhy = err?.message ?? String(err);
        if (/ECONNREFUSED|ECONNRESET|socket hang up|EPIPE/.test(gpuWhy)) gpu.markDead(err); // worker is gone: restart it later
      }
    }

    // 2) CPU Whisper
    if (!(await cpuReady)) {
      throw new Error(`Speech recognition is unavailable (${loadError?.message ?? 'model failed to load'}${gpuWhy && gpuWhy !== 'disabled' ? `; GPU: ${gpuWhy}` : ''}). Type your request instead.`);
    }
    const t1 = Date.now();
    if (g !== 1) for (let i = 0; i < samples.length; i++) samples[i] *= g;
    const result = await asr(samples, { chunk_length_s: 30, return_timestamps: false });
    const text = Array.isArray(result) ? result.map((r) => r.text).join(' ') : result?.text ?? '';
    last.backend = 'cpu'; last.ms = Date.now() - t1;
    console.log(`[stt] cpu ${last.ms} ms${gpuWhy && gpuWhy !== 'disabled' ? ` (GPU unavailable: ${gpuWhy})` : ''}`);
    return cleanText(text);
  }

  // int16Array: mono Int16 PCM at any sample rate. Calls are serialised.
  function transcribe(int16Array, sampleRate) {
    const job = chain.then(() => run(int16Array, sampleRate));
    chain = job.catch(() => {});
    return job;
  }

  // Stops the GPU worker if (and only if) this process started it. Also done automatically on process exit.
  const shutdown = () => gpu.stop();
  return { transcribe, ready, last, shutdown, gpu: gpu.G };
}
