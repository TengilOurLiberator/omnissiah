// Shared helpers for the evaluation harness.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const NODE = path.join(ROOT, 'tools', 'node', 'node.exe');
export const REAL_GAME = path.join(ROOT, 'public', 'game');
export const CACHE = path.join(ROOT, '.cache', 'eval');

export function copyGame(dest, src = REAL_GAME) {
  // other agents edit public/game while we copy it: retry when a file vanishes or is renamed mid-copy
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      return;
    } catch (err) { lastErr = err; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); }
  }
  throw lastErr;
}

export function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

export function hashDir(dir) {
  const map = {};
  for (const rel of listFiles(dir)) map[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, rel))).digest('hex');
  return map;
}

export function diffHashes(a, b) {
  const added = [], changed = [], removed = [];
  for (const k of Object.keys(b)) { if (!(k in a)) added.push(k); else if (a[k] !== b[k]) changed.push(k); }
  for (const k of Object.keys(a)) if (!(k in b)) removed.push(k);
  return { added, changed, removed };
}

export function nodeCheck(file) {
  const r = spawnSync(NODE, ['--check', file], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || r.stdout || 'syntax error').split('\n').slice(0, 6).join(' | ');
}

// Run the headless grader as a child process; resolves to its parsed result.
export function runGrade(job, { timeoutMs = 120000 } = {}) {
  const jobFile = job.out ? job.out.replace(/\.result\.json$/, '') + '.job.json' : path.join(CACHE, 'job-' + Date.now() + '.json');
  job.out ||= jobFile.replace(/\.job\.json$/, '.result.json');
  job.timeoutMs ||= timeoutMs - 5000;
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify(job));
  return new Promise((resolve) => {
    const child = spawn(NODE, ['--import', pathToFileURL(path.join(HERE, 'register.mjs')).href, path.join(HERE, 'grade-worker.mjs'), jobFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', () => {
      clearTimeout(timer);
      try { const r = JSON.parse(fs.readFileSync(job.out, 'utf8')); r.stderr = err.trim().split('\n').slice(-3).join(' | '); resolve(r); }
      catch (e) { resolve({ ok: false, fatal: 'grader produced no result: ' + err.slice(-600), files: [] }); }
    });
  });
}



