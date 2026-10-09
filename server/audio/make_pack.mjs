// Generates the starter sound pack from pack_spec.mjs through the local audio worker (starts it when needed).
//   D:\omnissiah\tools\node\node.exe server\audio\make_pack.mjs [--only a,b,slash-*] [--force] [--out <dir>] [--no-json]
// Output: public/assets/generated/audio/pack/<name>-<n>.ogg, public/assets/generated/audio/pack.json (merged on partial runs),
// server/audio/pack_report.json (objective stats per file: duration, loudness, centroid, warnings, timings).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAudio } from './service.js';
import { SPEC } from './pack_spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);
const only = (opt('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const matchOnly = (name) => !only.length || only.some((p) => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));
const packDir = path.resolve(opt('out') ?? path.join(ROOT, 'public', 'assets', 'generated', 'audio', 'pack'));
const defaultOut = !opt('out');
const packJson = path.join(ROOT, 'public', 'assets', 'generated', 'audio', 'pack.json');
const reportFile = path.join(HERE, 'pack_report.json');

const svc = createAudio({ root: ROOT, log: (...a) => console.log('  [svc]', ...a) });
const seedFor = (name, i) => (crypto.createHash('sha1').update(`${name}#${i}`).digest().readUInt32BE(0) & 0x7fffffff);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const report = readJson(reportFile, {});
const pack = defaultOut ? readJson(packJson, {}) : {};
const urlOf = (file) => `/assets/generated/audio/pack/${file}`;

const todo = SPEC.filter((e) => matchOnly(e.name));
console.log(`pack: ${SPEC.length} names in the spec, generating ${todo.length} (force=${flag('force')}) into ${packDir}`);
let made = 0, skipped = 0, failed = 0;
const t0 = Date.now();
try {
  for (const e of todo) {
    const files = [];
    const durations = [];
    for (let i = 0; i < e.variants; i++) {
      const file = `${e.name}-${i}.ogg`;
      const dest = path.join(packDir, file);
      if (fs.existsSync(dest) && !flag('force') && report[file]) { skipped++; files.push(file); durations.push(report[file].duration); continue; }
      const prompt = e.prompts[i % e.prompts.length];
      const music = e.kind === 'music' || e.kind === 'stinger';
      const spec = {
        kind: music ? 'music' : 'sfx', prompt, seconds: e.seconds, loop: e.kind === 'loop' || e.kind === 'music',
        seed: seedFor(e.name, i) + (Number(opt('seed-offset')) || 0), single: !!e.single, bpm: e.bpm, candidates: Number(opt('candidates')) || (e.kind === 'loop' ? 2 : 3), expect: e.expect ?? (e.kind === 'loop' ? { centroid: [0, 9000] } : undefined),
      };
      const t = Date.now();
      try {
        let st, lastErr;
        for (let k = 0; k < 3 && !st; k++) { try { st = await svc.generateFile(spec, dest); } catch (e) { lastErr = e; console.log('  retry after:', e.message.slice(0, 80)); await new Promise((r) => setTimeout(r, 4000)); } }
        if (!st) throw lastErr;
        report[file] = {
          name: e.name, kind: e.kind, prompt, seconds: e.seconds, duration: st.duration, bytes: st.bytes, peak_db: st.final?.peak_db, rms_db: st.final?.rms_db,
          centroid_hz: st.final?.centroid_hz, rolloff85_hz: st.final?.rolloff85_hz, raw_peak_db: st.raw?.peak_db, raw_max_gap_s: st.raw?.max_gap_s, loop_seam: st.loop_seam,
          warnings: st.warnings ?? [], seed: st.seed, gen_seconds: st.gen_seconds, total_seconds: st.total_seconds,
        };
        files.push(file); durations.push(st.duration); made++;
        console.log(`${e.name}#${i} ${st.duration}s ${st.bytes}B rms ${st.final?.rms_db} cen ${st.final?.centroid_hz} ${st.warnings?.length ? 'WARN ' + st.warnings.join('; ') : 'ok'} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
      } catch (err) {
        failed++;
        console.log(`${e.name}#${i} FAILED: ${err.message}`);
      }
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
    }
    if (defaultOut && files.length < e.variants) {
      // a variant the model could not make: drop its stale file, keep the name playable with the variants that worked
      for (let i = 0; i < e.variants; i++) { const f = `-${i}.ogg`; if (!files.includes(f)) { try { fs.rmSync(path.join(packDir, f)); } catch { /* none */ } delete report[f]; } }
    }
    if (defaultOut && files.length >= 1) {
      pack[e.name] = { url: urlOf(files[0]), variants: files.map(urlOf), volume: e.volume, kind: e.kind, durations };
      if (e.bpm) pack[e.name].bpm = e.bpm;
      if (e.kind === 'oneshot' && e.single) pack[e.name].single = true;
      fs.mkdirSync(path.dirname(packJson), { recursive: true });
      fs.writeFileSync(packJson, JSON.stringify(pack, null, 1));
    }
  }
} finally {
  console.log(`done: ${made} generated, ${skipped} kept, ${failed} failed in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await svc.shutdown();
}
