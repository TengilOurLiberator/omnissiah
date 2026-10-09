// Game directory service: module listing, watcher with syntax checking, snapshots and undo.
// See docs/CONTRACT.md ("Server internals").
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEBOUNCE_MS = 400;
const QUIET_AFTER_UNDO_MS = 1000;
const KEEP_SNAPSHOTS = 30;

const toPosix = (p) => p.split(path.sep).join('/');
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function walkFiles(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else if (e.isFile()) out.push(toPosix(path.relative(base, full)));
  }
  return out;
}

function hashDir(dir) {
  const h = crypto.createHash('sha1');
  for (const rel of walkFiles(dir)) {
    h.update(rel + '\0');
    try { h.update(fs.readFileSync(path.join(dir, rel))); } catch { /* vanished */ }
    h.update('\0');
  }
  return h.digest('hex');
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '');
}
const STAMP_LEN = 18; // 'YYYYMMDD-HHMMSSmmm'

function sanitizeLabel(label) {
  const s = String(label ?? '').replace(/[^\p{L}\p{N} _.-]+/gu, '_').replace(/\s+/g, ' ').slice(0, 50).replace(/[\s.]+$/, '').replace(/^[\s.]+/, '');
  return s || 'snapshot'; // Windows forbids trailing spaces/dots in directory names
}

export function createFiles({ gameDir, onChange, snapshotsDir = path.join(PROJECT_ROOT, '.snapshots') }) {
  gameDir = path.resolve(gameDir);
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const errors = new Map(); // rel path -> message, for files that currently fail their check
  const pending = new Set();
  let timer = null;
  let working = Promise.resolve();
  let quietUntil = 0;
  let restoring = false;
  let lastSignature = '';
  let watcher = null;

  // ------------------------------------------------------------ syntax checking
  function checkFile(rel) {
    const abs = path.join(gameDir, rel);
    if (rel.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(abs, 'utf8')); return Promise.resolve(null); } catch (err) {
        return Promise.resolve(`${rel}: invalid JSON: ${err.message}`);
      }
    }
    return new Promise((resolve) => {
      execFile(process.execPath, ['--check', abs], { timeout: 15000, windowsHide: true, maxBuffer: 1 << 20 }, (err, _out, stderr) => {
        if (!err) return resolve(null);
        // A check that was killed for taking too long (busy machine) says nothing about the file: treat it as fine.
        if (err.killed || err.signal || (!String(stderr || '').trim() && typeof err.code !== 'number')) return resolve(null);
        let msg = String(stderr || err.message || 'syntax check failed');
        const cut = msg.search(/^Node\.js v/m);
        if (cut >= 0) msg = msg.slice(0, cut);
        let real = abs;
        try { real = fs.realpathSync(abs); } catch { /* deleted meanwhile */ }
        msg = msg.split(real).join(rel).split(abs).join(rel).split(abs.replace(/\\/g, '/')).join(rel)
          .replace(/file:\/\/\/[^\s:]*[\\/]/g, '');
        msg = msg.replace(/\r/g, '').split('\n').filter((l) => !/^\s+at /.test(l)).join('\n').replace(/\n{3,}/g, '\n\n');
        resolve(msg.trim().slice(0, 1200) || `${rel}: syntax error`);
      });
    });
  }

  // Checks every .js/.json under gameDir; refreshes the error map; returns [{ path, message }].
  async function checkAll() {
    errors.clear();
    for (const rel of walkFiles(gameDir)) {
      if (!/\.(js|json)$/.test(rel)) continue;
      const msg = await checkFile(rel);
      if (msg) errors.set(rel, msg);
    }
    lastSignature = signature();
    return currentErrors();
  }
  const currentErrors = () => [...errors].map(([p, message]) => ({ path: p, message }));

  // ------------------------------------------------------------ listing
  function listModules() {
    const out = [];
    const seen = new Set();
    const add = (rel) => {
      rel = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
      if (!rel || rel.includes('..') || seen.has(rel) || errors.has(rel)) return;
      seen.add(rel);
      try {
        const st = fs.statSync(path.join(gameDir, rel));
        if (st.isFile()) out.push({ path: rel, version: Math.floor(st.mtimeMs) });
      } catch { /* missing: skip */ }
    };
    let core = [];
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(gameDir, 'manifest.json'), 'utf8'));
      if (Array.isArray(manifest.core)) core = manifest.core.filter((p) => typeof p === 'string');
    } catch { /* no manifest */ }
    core.forEach(add);
    try {
      fs.readdirSync(path.join(gameDir, 'creations'))
        .filter((f) => f.endsWith('.js'))
        .sort()
        .forEach((f) => add(`creations/${f}`));
    } catch { /* no creations dir yet */ }
    return out;
  }
  const signature = () => JSON.stringify(listModules());

  // ------------------------------------------------------------ watcher
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { working = working.then(processBatch).catch((err) => console.error('[files] batch failed:', err)); }, DEBOUNCE_MS);
  }

  function onFsEvent(_type, filename) {
    if (restoring || Date.now() < quietUntil || !filename) return;
    const rel = toPosix(String(filename));
    if (/(^|\/)\./.test(rel)) return; // dotfiles, editor temp dirs
    if (/\.(js|json)$/.test(rel)) pending.add(rel);
    else if (!/\.[^/]+$/.test(rel) && !fs.existsSync(path.join(gameDir, rel))) pending.add(rel); // a removed directory
    else return;
    schedule();
  }

  async function processBatch() {
    if (restoring) return;
    const changed = [...pending];
    pending.clear();
    if (!changed.length) return;
    const batchErrors = [];
    for (const rel of changed) {
      if (!/\.(js|json)$/.test(rel)) continue;
      const abs = path.join(gameDir, rel);
      let ok = false;
      try { ok = fs.statSync(abs).isFile(); } catch { /* deleted */ }
      if (!ok) { errors.delete(rel); continue; }
      const msg = await checkFile(rel);
      if (msg) { errors.set(rel, msg); batchErrors.push({ path: rel, message: msg }); } else errors.delete(rel);
    }
    for (const rel of [...errors.keys()]) if (!fs.existsSync(path.join(gameDir, rel))) errors.delete(rel);
    if (restoring || Date.now() < quietUntil) return; // an undo started while we were checking
    const sig = signature();
    if (!batchErrors.length && sig === lastSignature) return;
    lastSignature = sig;
    try { onChange?.({ modules: JSON.parse(sig), syntaxErrors: batchErrors }); } catch (err) { console.error('[files] onChange failed:', err); }
  }

  function startWatching() {
    try {
      watcher = fs.watch(gameDir, { recursive: true }, onFsEvent);
      watcher.on('error', (err) => console.error('[files] watcher error:', err.message));
    } catch (err) {
      console.error('[files] could not watch game dir:', err.message);
    }
  }
  startWatching();

  // ------------------------------------------------------------ snapshots
  function snapshotNames() {
    try {
      return fs.readdirSync(snapshotsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{8}-\d{9}-/.test(e.name))
        .map((e) => e.name)
        .sort();
    } catch { return []; }
  }

  // Copies gameDir to .snapshots/<timestamp>-<label>/. Skips (returning the existing name) when
  // the game is byte-identical to the newest snapshot, so "undo" always has something to undo.
  function snapshot(label = 'snapshot') {
    const names = snapshotNames();
    const latest = names[names.length - 1];
    if (latest && hashDir(path.join(snapshotsDir, latest)) === hashDir(gameDir)) return latest;
    let name = `${stamp()}-${sanitizeLabel(label)}`;
    for (let i = 2; fs.existsSync(path.join(snapshotsDir, name)); i++) name = `${stamp()}-${sanitizeLabel(label)}-${i}`;
    fs.cpSync(gameDir, path.join(snapshotsDir, name), { recursive: true });
    const all = snapshotNames();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) {
      try { fs.rmSync(path.join(snapshotsDir, old), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return name;
  }

  // Restores the newest snapshot that differs from the current game and consumes it (so repeated
  // undo walks further back). Returns its label, or null. Does NOT fire onChange: the caller
  // broadcasts the reload (listModules() is already up to date when this resolves).
  async function undo() {
    await working;
    const currentHash = hashDir(gameDir);
    const names = snapshotNames();
    let target = null;
    while (names.length) {
      const name = names.pop();
      const dir = path.join(snapshotsDir, name);
      const same = hashDir(dir) === currentHash;
      if (!same) { target = name; break; }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } // no-op snapshot
    }
    if (!target) return null;

    restoring = true;
    clearTimeout(timer);
    pending.clear();
    try {
      const src = path.join(snapshotsDir, target);
      for (const e of fs.readdirSync(gameDir)) fs.rmSync(path.join(gameDir, e), { recursive: true, force: true });
      fs.cpSync(src, gameDir, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
      await checkAll();
    } finally {
      quietUntil = Date.now() + QUIET_AFTER_UNDO_MS; // swallow the watcher echo of our own writes
      pending.clear();
      restoring = false;
    }
    lastSignature = signature();
    return target.slice(STAMP_LEN + 1) || 'snapshot';
  }

  function close() { clearTimeout(timer); watcher?.close(); }

  return { listModules, snapshot, undo, checkAll, close };
}
