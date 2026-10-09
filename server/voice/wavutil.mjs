// Minimal WAV helpers (Node, no dependencies): read PCM16/PCM24/float32 WAV -> Float32Array mono, write float32 -> PCM16 WAV.
import fs from 'node:fs';

export function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (start + size > buf.length) size = buf.length - start;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(start), ch: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    else if (id === 'data') { data = buf.subarray(start, start + size); break; }
    pos = start + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('bad WAV');
  const bps = fmt.bits / 8, frames = Math.floor(data.length / (bps * fmt.ch));
  const out = new Float32Array(frames);
  const ext = fmt.tag === 0xfffe; // WAVE_FORMAT_EXTENSIBLE: sample format is in the sub-format; assume PCM unless 32-bit float
  const isFloat = fmt.tag === 3 || (ext && fmt.bits === 32 && false);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bps;
      s += isFloat ? data.readFloatLE(o) : bps === 2 ? data.readInt16LE(o) / 32768 : bps === 3 ? data.readIntLE(o, 3) / 8388608 : bps === 4 ? data.readInt32LE(o) / 2147483648 : (data[o] - 128) / 128;
    }
    out[i] = s / fmt.ch;
  }
  return { samples: out, rate: fmt.rate, seconds: frames / fmt.rate };
}

export function readWav(file) { return parseWav(fs.readFileSync(file)); }

export function encodeWav(samples, rate) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2); }
  return buf;
}

export function writeWav(file, samples, rate) { fs.writeFileSync(file, encodeWav(samples, rate)); }

export function resample(x, from, to) {
  if (from === to) return x;
  const ratio = from / to, n = Math.floor(x.length / ratio), out = new Float32Array(n);
  if (ratio > 1) { // box average = crude low-pass
    for (let i = 0; i < n; i++) {
      const a = i * ratio, b = Math.min(x.length, (i + 1) * ratio);
      let sum = 0, w = 0;
      for (let k = Math.floor(a); k < b; k++) { const wt = Math.min(b, k + 1) - Math.max(a, k); if (wt > 0) { sum += x[k] * wt; w += wt; } }
      out[i] = w ? sum / w : 0;
    }
  } else {
    for (let i = 0; i < n; i++) { const p = i * ratio, k = Math.floor(p), f = p - k; out[i] = x[k] * (1 - f) + x[Math.min(x.length - 1, k + 1)] * f; }
  }
  return out;
}
