// QA sandbox: a private copy of the game CODE (server/, public/game, public/sys, boot.js, index.html) under
// .cache/qa/sandbox, so that (a) QA never touches the real saves/ folder, (b) the hook module and hot-reload rewrites never
// reach the real game or its running server, (c) a run tests one stable snapshot (file mtimes are preserved by robocopy).
// Big read-only things are junctions to the real ones: node_modules, tools, public/assets, .cache/models.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './server.mjs';

export const SANDBOX = path.join(ROOT, '.cache', 'qa', 'sandbox');
const sh = (cmd, args, ok = [0]) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); } catch (e) { if (!ok.includes(e.status)) throw e; } };
const junction = (link, target) => {
  try { fs.rmSync(link, { recursive: false, force: true }); } catch { /* ignore */ }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'junction');
};
const robo = (src, dst, extra = []) => sh('robocopy', [src, dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1', ...extra], [0, 1, 2, 3, 4, 5, 6, 7]);

export function createSandbox() {
  // remove old junction targets safely (rmSync on a junction removes only the link)
  fs.mkdirSync(SANDBOX, { recursive: true });
  robo(path.join(ROOT, 'server'), path.join(SANDBOX, 'server'), ['/XD', '__pycache__']);
  robo(path.join(ROOT, 'public', 'game'), path.join(SANDBOX, 'public', 'game'));
  robo(path.join(ROOT, 'public', 'sys'), path.join(SANDBOX, 'public', 'sys'));
  if (fs.existsSync(path.join(ROOT, 'public', 'admin'))) robo(path.join(ROOT, 'public', 'admin'), path.join(SANDBOX, 'public', 'admin'));
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) { const src = path.join(ROOT, 'public', f); if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(SANDBOX, 'public', f)); } // boot.js, index.html, favicon ...
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(SANDBOX, 'package.json'));
  junction(path.join(SANDBOX, 'public', 'assets'), path.join(ROOT, 'public', 'assets'));
  junction(path.join(SANDBOX, 'node_modules'), path.join(ROOT, 'node_modules'));
  junction(path.join(SANDBOX, 'tools'), path.join(ROOT, 'tools'));
  junction(path.join(SANDBOX, 'input'), path.join(ROOT, 'input'));
  fs.mkdirSync(path.join(SANDBOX, '.cache'), { recursive: true });
  junction(path.join(SANDBOX, '.cache', 'models'), path.join(ROOT, '.cache', 'models'));
  fs.mkdirSync(path.join(SANDBOX, 'saves'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SANDBOX, 'saves'))) fs.rmSync(path.join(SANDBOX, 'saves', f), { force: true });
  return SANDBOX;
}
export function destroySandbox() {
  // unlink junctions first (never recurse through them), then delete the copies
  for (const l of [['public', 'assets'], ['node_modules'], ['tools'], ['input'], ['.cache', 'models']]) { try { fs.rmSync(path.join(SANDBOX, ...l), { recursive: false, force: true }); } catch { /* ignore */ } }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ }
}
// ---- sandbox manifest (scenarios that test modules the live manifest does not list yet). The server reads manifest.json on every
// /api/modules request, so write it BEFORE navigating (run.mjs navigates to about:blank between scenarios) and restore it afterwards.
const manifestFile = () => path.join(SANDBOX, 'public', 'game', 'manifest.json');
export function readManifest() { return JSON.parse(fs.readFileSync(manifestFile(), 'utf8')); }
// enable: [[afterPath, newPath], ...]  - adds newPath right after afterPath (or at the end) when the file exists on disk and is not listed yet.
// Returns { enabled: [paths added], absent: [paths whose file does not exist], core: [final list] }.
export function enableModules(enable) {
  const orig = path.join(SANDBOX, 'manifest.orig.json');
  if (!fs.existsSync(orig)) fs.copyFileSync(manifestFile(), orig);
  const man = JSON.parse(fs.readFileSync(orig, 'utf8'));
  const enabled = [], absent = [];
  for (const [after, mod] of enable) {
    if (man.core.includes(mod)) continue;
    if (!fs.existsSync(path.join(SANDBOX, 'public', 'game', mod))) { absent.push(mod); continue; }
    const i = man.core.indexOf(after);
    if (i >= 0) man.core.splice(i + 1, 0, mod); else man.core.push(mod);
    enabled.push(mod);
  }
  fs.writeFileSync(manifestFile() + '.tmp', JSON.stringify(man, null, 2));
  fs.renameSync(manifestFile() + '.tmp', manifestFile());
  return { enabled, absent, core: man.core };
}
export function restoreManifest() {
  const orig = path.join(SANDBOX, 'manifest.orig.json');
  if (!fs.existsSync(orig)) return;
  fs.copyFileSync(orig, manifestFile());
  fs.rmSync(orig, { force: true });
}
// The server drops a module from /api/modules when its `node --check` fails OR TIMES OUT (server/files.js: 15 s, no retry). Under heavy CPU load
// (hot reload rewrites every module in a row) that silently removes healthy modules from the game for the rest of the run. Healing = rewrite the
// file (same bytes, new mtime) so the watcher checks it again. Returns the paths that had been dropped and whether they came back.
export async function healModules(port = 9080, timeoutMs = 120000) {
  const gameDir = path.join(SANDBOX, 'public', 'game');
  const expected = [];
  try { for (const p of readManifest().core) if (fs.existsSync(path.join(gameDir, p))) expected.push(p); } catch { /* no manifest */ }
  try { for (const f of fs.readdirSync(path.join(gameDir, 'creations')).filter((f) => f.endsWith('.js'))) expected.push('creations/' + f); } catch { /* none */ }
  const listed = async () => { try { return new Set((await (await fetch(`http://127.0.0.1:${port}/api/modules`)).json()).modules.map((m) => m.path)); } catch { return null; } };
  let have = await listed(); if (!have) return { dropped: [], healed: true, error: 'server not answering' };
  const dropped = expected.filter((p) => !have.has(p));
  if (!dropped.length) return { dropped: [], healed: true };
  const t0 = Date.now();
  for (const p of dropped) { const f = path.join(gameDir, p); try { fs.writeFileSync(f, fs.readFileSync(f)); } catch { /* ignore */ } await new Promise((r) => setTimeout(r, 400)); }
  let still = dropped, lastTouch = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500)); have = await listed();
    if (have) { still = dropped.filter((p) => !have.has(p)); if (!still.length) break; }
    if (Date.now() - lastTouch > 20000) { lastTouch = Date.now(); for (const p of still) { const f = path.join(gameDir, p); try { fs.writeFileSync(f, fs.readFileSync(f)); } catch { /* ignore */ } } }
  }
  return { dropped, healed: still.length === 0, still };
}
export const savesDir = () => path.join(SANDBOX, 'saves');
export function wipeSaves() { for (const f of fs.readdirSync(savesDir())) { try { fs.rmSync(path.join(savesDir(), f), { force: true }); } catch { /* ignore */ } } }
// A "new player" must really be new: the server answers save_get from disk or from a write that is still pending (400 ms debounce), a file can be briefly locked
// (EBUSY/EPERM: the plain wipe swallows that and the old profile survives: seen as "intro already done" in scenarios 11/13). Wipe, wait for late writes, wipe again, verify.
export async function wipeSavesHard() {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 20; i++) { wipeSaves(); if (!fs.readdirSync(savesDir()).length) break; await new Promise((r) => setTimeout(r, 250)); }
    await new Promise((r) => setTimeout(r, 700));
  }
  wipeSaves();
  return fs.readdirSync(savesDir()).length === 0;
}
export function readSave(key = 'profile') { try { return JSON.parse(fs.readFileSync(path.join(savesDir(), `${key}.json`), 'utf8')); } catch { return null; } }

