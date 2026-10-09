// Wish evaluation: sends real wishes to the Omnissiah (the real server/oracle.js logic, real Claude CLI, real prompts), each in an
// isolated copy of the game, then grades what he wrote by loading it headlessly.
//
//   node server/eval/run.mjs --run it1 [--only sp-sword,sp-dragon] [--cat spawn,npc] [--concurrency 3] [--effort medium]
//        [--manual path/to/candidate-manual.md] [--annotate] [--no-repair] [--force]
//
// Isolation: every wish gets  .cache/eval/<run>/<id>/root/  with a copy of server/oracle.js + the three prompt files and a copy of
// public/game. The copied oracle.js therefore builds his prompt from the copy (identical to the real game at the time of the run) and
// the CLI's working directory is the copy. The real public/game is never written. No game server is started.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, CACHE, REAL_GAME, copyGame, hashDir, diffHashes, nodeCheck, runGrade } from './lib.mjs';
import { installSpawnTap, openTap, closeTap } from './tap.mjs';
import { WISHES } from './wishes.mjs';
import { analyzeSource } from './analyze.mjs';
import { speechReport } from './speech.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]) : d; };
const RUN = arg('run', 'run-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''));
const ONLY = arg('only') ? String(arg('only')).split(',') : null;
const CATS = arg('cat') ? String(arg('cat')).split(',') : null;
const CONC = Number(arg('concurrency', 3));
const EFFORT = String(arg('effort', process.env.ORACLE_EFFORT || 'medium'));
const MANUAL = arg('manual') ? path.resolve(String(arg('manual'))) : path.join(ROOT, 'server', 'omnissiah-prompt.md');
const HERALD = arg('herald') ? path.resolve(String(arg('herald'))) : path.join(ROOT, 'server', 'herald-prompt.md');
const COMMENTARY = arg('commentary') ? path.resolve(String(arg('commentary'))) : path.join(ROOT, 'server', 'commentary-prompt.md');
const ANNOTATE = !!arg('annotate');
const NO_REPAIR = !!arg('no-repair');
const FORCE = !!arg('force');
const RUN_DIR = path.join(CACHE, RUN);
fs.mkdirSync(RUN_DIR, { recursive: true });
const HEADERS = arg('headers') ? path.resolve(String(arg('headers'))) : null;
// The game is frozen once per run so every wish sees the same code even while other agents keep editing public/game.
const BASE_GAME = path.join(RUN_DIR, '_base_game');
if (!fs.existsSync(path.join(BASE_GAME, 'manifest.json'))) { if (arg('base')) copyGame(BASE_GAME, path.join(CACHE, String(arg('base')), '_base_game')); else copyGame(BASE_GAME); }

process.env.ORACLE_EFFORT = EFFORT;
process.env.COMMENTARY = 'off';
process.env.CLAUDE_BIN = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'claude.cmd' : 'claude');
{ const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH'; process.env[key] = path.join(ROOT, 'tools', 'node') + path.delimiter + process.env[key]; }
installSpawnTap();

const LIMIT_RE = /session limit|usage limit|rate limit|limited right now|overloaded|quota/i;
let LIMIT_HIT = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };

function listModules(gameDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(gameDir, 'manifest.json'), 'utf8')).core || [];
  const core = manifest.filter((p) => fs.existsSync(path.join(gameDir, p)));
  const cdir = path.join(gameDir, 'creations');
  const creations = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter((f) => f.endsWith('.js')).sort().map((f) => 'creations/' + f) : [];
  return [...core, ...creations];
}

function annotatedModules(gameDir) {
  return listModules(gameDir).map((p) => {
    if (!p.startsWith('creations/')) return p;
    try {
      const src = fs.readFileSync(path.join(gameDir, p), 'utf8');
      if (/^\s*export default function \(\) \{\}\s*$/.test(src.replace(/^\/\/.*$/gm, '').trim())) return `${p} (removed)`;
      const m = src.match(/export const meta\s*=\s*\{[^}]*name:\s*'([^']*)'[^}]*description:\s*'([^']*)'/);
      return m ? `${p} (${m[1]}: ${m[2]})` : p;
    } catch { return p; }
  });
}

function buildContext(wish, gameDir) {
  const aim = wish.aim === undefined ? [2.1, 0, -6.2] : wish.aim;
  return {
    player: { position: [0, 0, 0], forward: [0, 0, -1] },
    aimPoint: aim,
    modules: ANNOTATE ? annotatedModules(gameDir) : listModules(gameDir),
    progress: { line: 'Level 3 Wanderer, favour 2, 14 kills.' },
    perf: { tier: 'pc', fps: 72, level: 0 },
    ...(wish.mr ? { passthrough: true } : {}),
  };
}


// Header overlay: replaces the leading comment block of core/<name>.js with <dir>/<name>.header.txt (A/B test of shorter headers without
// touching any module in the real game).
function applyHeaderOverlay(gameDir, dir) {
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(.+)\.header\.txt$/);
    if (!m) continue;
    const target = path.join(gameDir, 'core', m[1] + '.js');
    if (!fs.existsSync(target)) continue;
    const lines = fs.readFileSync(target, 'utf8').split('\n');
    let end = 0;
    while (end < lines.length && /^\s*(\/\/|$)/.test(lines[end])) end++;
    fs.writeFileSync(target, fs.readFileSync(path.join(dir, f), 'utf8').trimEnd() + '\n' + lines.slice(end).join('\n'));
  }
}
// ------------------------------------------------------------------ one wish
async function runWish(wish) {
  const dir = path.join(RUN_DIR, wish.id);
  const resultFile = path.join(dir, 'result.json');
  if (!FORCE && fs.existsSync(resultFile)) { try { const old = JSON.parse(fs.readFileSync(resultFile, 'utf8')); if (!old.invalid && !(old.sends || []).some((s) => LIMIT_RE.test(s))) return old; } catch { /* redo */ } }
  fs.rmSync(dir, { recursive: true, force: true });
  const rootDir = path.join(dir, 'root');
  const gameDir = path.join(rootDir, 'public', 'game');
  fs.mkdirSync(path.join(rootDir, 'server'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server', 'oracle.js'), path.join(rootDir, 'server', 'oracle.js'));
  fs.copyFileSync(HERALD, path.join(rootDir, 'server', 'herald-prompt.md'));
  fs.copyFileSync(COMMENTARY, path.join(rootDir, 'server', 'commentary-prompt.md'));
  fs.copyFileSync(MANUAL, path.join(rootDir, 'server', 'omnissiah-prompt.md'));
  copyGame(gameDir, BASE_GAME);
  if (HEADERS) applyHeaderOverlay(gameDir, HEADERS);
  for (const s of wish.seed || []) { fs.mkdirSync(path.dirname(path.join(gameDir, s.path)), { recursive: true }); fs.writeFileSync(path.join(gameDir, s.path), s.content); }

  const base = hashDir(gameDir);
  const snapDir = path.join(dir, 'snap');
  const speaks = [], sends = [];
  const tap = openTap([gameDir, path.join(rootDir, '.cache', 'herald')]);
  const files = {
    async snapshot() { fs.rmSync(snapDir, { recursive: true, force: true }); fs.cpSync(gameDir, snapDir, { recursive: true }); },
    async undo() {
      if (!fs.existsSync(snapDir)) return null;
      const now = hashDir(gameDir), old = hashDir(snapDir);
      const d = diffHashes(old, now);
      for (const f of d.added) fs.rmSync(path.join(gameDir, f), { force: true });
      for (const f of [...d.changed, ...d.removed]) { fs.mkdirSync(path.dirname(path.join(gameDir, f)), { recursive: true }); fs.copyFileSync(path.join(snapDir, f), path.join(gameDir, f)); }
      undone = true;
      return 'eval-snapshot';
    },
  };
  let undone = false;
  const { createOracle } = await import(pathToFileURL(path.join(rootDir, 'server', 'oracle.js')).href);
  const T0 = Date.now();
  tap.t0 = T0;
  const oracle = createOracle({
    gameDir, files,
    send: (m) => { sends.push({ t: Date.now() - T0, ...m }); },
    speak: async (text) => { speaks.push({ t: Date.now() - T0, text }); },
  });

  const rec = { id: wish.id, cat: wish.cat, say: wish.say, run: RUN, ideal: wish.ideal, notes: [], repairs: 0, passes: [] };
  const context = buildContext(wish, gameDir);
  let timedOut = false;
  try {
    await Promise.race([oracle.handleUtterance(wish.say, context), sleep(6 * 60 * 1000).then(() => { timedOut = true; oracle.cancel?.(); })]);
  } catch (err) { rec.notes.push('handleUtterance threw: ' + err.message); }
  const tTurn = Date.now() - T0;
  rec.timedOut = timedOut;

  // ---- grade, repair loop (as the real game does for runtime errors, up to 2 automatic repairs)
  let grade = await gradeState(wish, gameDir, base, dir, 'pass0');
  rec.passes.push(summarisePass(grade));
  let first = grade;
  for (let r = 0; r < 2 && !NO_REPAIR && !timedOut && grade.problems.length && grade.hasFiles; r++) {
    rec.repairs++;
    for (const p of grade.problems) oracle.handleModuleError({ path: p.path, message: p.message, stack: p.stack || '' });
    await sleep(2700);
    for (let i = 0; i < 400 && oracle.busy; i++) await sleep(500);
    await sleep(400);
    for (let i = 0; i < 400 && oracle.busy; i++) await sleep(500);
    grade = await gradeState(wish, gameDir, base, dir, 'pass' + (r + 1));
    rec.passes.push(summarisePass(grade));
    if (undone) { rec.notes.push('gave up: changes undone'); break; }
  }
  rec.undone = undone;
  closeTap(tap);
  const main = tap.runs.filter((x) => x.kind === 'main');
  const quick = tap.runs.filter((x) => x.kind === 'quick');

  // ---- timings, speech, cost
  const spoken = speaks.map((s) => s.text);
  const rawBlocks = main.flatMap((x) => x.texts);
  const writes = main.flatMap((x) => x.tools).filter((t) => /^(Write|Edit)$/.test(t.name));
  const allTools = main.flatMap((x) => x.tools);
  rec.time = {
    firstSpeechS: speaks[0] ? +(speaks[0].t / 1000).toFixed(1) : null,
    firstToolS: allTools[0] ? +(allTools[0].t / 1000).toFixed(1) : null,
    lastWriteS: writes.length ? +(writes[writes.length - 1].t / 1000).toFixed(1) : null,
    firstTurnEndS: +(tTurn / 1000).toFixed(1),
    totalS: +((Date.now() - T0) / 1000).toFixed(1),
  };
  const sum = (f) => main.reduce((a, x) => a + (f(x) || 0), 0);
  rec.cost = {
    usd: +sum((x) => x.result?.cost).toFixed(3),
    turns: sum((x) => x.result?.turns),
    in: sum((x) => x.result?.usage?.input_tokens), out: sum((x) => x.result?.usage?.output_tokens),
    cacheRead: sum((x) => x.result?.usage?.cache_read_input_tokens), cacheWrite: sum((x) => x.result?.usage?.cache_creation_input_tokens),
    apiS: +(sum((x) => x.result?.duration_api_ms) / 1000).toFixed(1),
  };
  rec.tools = Object.fromEntries(allTools.reduce((m, t) => m.set(t.name, (m.get(t.name) || 0) + 1), new Map()));
  rec.reads = allTools.filter((t) => t.name === 'Read').map((t) => String(t.input?.file_path || '').replace(/\\/g, '/').replace(/^.*public\/game\//, ''));
  rec.heraldLine = quick[0] ? quick[0].rawOut.trim().slice(0, 200) : null;
  rec.spoken = spoken;
  rec.rawText = rawBlocks.map((b) => ({ t: +(b.t / 1000).toFixed(1), beforeTool: b.beforeTool, text: b.text }));
  rec.speech = speechReport({ spoken, raw: rawBlocks.map((b) => ({ text: b.text, beforeTool: b.beforeTool })), heraldLine: rec.heraldLine, wish, filesExpected: wish.files !== 'none' });
  rec.finalResult = main.map((x) => x.result?.result).filter(Boolean).map((s) => String(s).slice(0, 200));
  rec.grade = condense(grade);
  rec.firstPass = condense(first);
  rec.verdict = verdict(wish, rec);
  rec.sends = sends.filter((s) => s.type === 'notice').map((s) => s.text);
  if (rec.sends.some((s) => LIMIT_RE.test(s)) && !rec.cost.usd) { rec.invalid = 'account limit: ' + rec.sends[0].slice(0, 120); LIMIT_HIT = true; }
  fs.writeFileSync(resultFile, JSON.stringify(rec, null, 1));
  return rec;
}

function summarisePass(g) { return { problems: g.problems.map((p) => p.message.slice(0, 160)), files: g.changedFiles, ok: !g.problems.length }; }
function condense(g) {
  return { added: g.diff.added, changed: g.diff.changed, removed: g.diff.removed, syntax: g.syntax, problems: g.problems.map((p) => `${p.path}: ${p.message}`.slice(0, 220)), mechanisms: g.mechanisms, effect: g.worker?.effect, effectKinds: g.worker?.effectKinds,
    calls: g.calls, sent: g.worker?.sent, stub: g.worker?.stubCalls, leaks: g.worker?.cleanup?.leaks, scene: g.scene, coreErrors: g.worker?.coreErrors, bootFail: g.worker?.boot?.loadFailures, workerFatal: g.worker?.fatal, libNames: g.libNames, hasFiles: g.hasFiles, srcBytes: g.srcBytes, updateMs: g.updateMs, hud: g.worker?.hud };
}

// ------------------------------------------------------------------ grading of the game dir after a turn
async function gradeState(wish, gameDir, base, dir, label) {
  const now = hashDir(gameDir);
  const diff = diffHashes(base, now);
  const touched = [...diff.added, ...diff.changed];
  const g = { diff, problems: [], syntax: [], changedFiles: touched, hasFiles: touched.length > 0, mechanisms: [], calls: [], libNames: [], scene: null, updateMs: 0 };
  const jsFiles = touched.filter((f) => f.endsWith('.js'));
  for (const f of jsFiles) {
    const err = nodeCheck(path.join(gameDir, f));
    if (err) { g.syntax.push({ path: f, error: err }); g.problems.push({ path: f, message: 'syntax: ' + err, stack: '' }); }
  }
  const creations = jsFiles.filter((f) => f.startsWith('creations/') && !g.syntax.find((s) => s.path === f));
  const others = jsFiles.filter((f) => !f.startsWith('creations/') && !g.syntax.find((s) => s.path === f));
  g.srcBytes = jsFiles.reduce((a, f) => a + fs.statSync(path.join(gameDir, f)).size, 0);
  if (creations.length || others.length) {
    const worker = await runGrade({ gameDir, files: creations, seconds: 5, out: path.join(dir, label + '.result.json') }, { timeoutMs: 150000 });
    g.worker = worker;
    if (worker.fatal) g.problems.push({ path: creations[0] || others[0] || '?', message: 'grader: ' + worker.fatal.slice(0, 200) });
    for (const lf of worker.boot?.loadFailures || []) if (others.includes(lf.path)) g.problems.push({ path: lf.path, message: 'load: ' + lf.message, stack: '' });
    for (const f of worker.files || []) {
      if (!f.loaded || f.loadError) g.problems.push({ path: f.path, message: 'load: ' + (f.loadError || 'failed'), stack: '' });
      else if (f.updateError) g.problems.push({ path: f.path, message: 'update: ' + f.updateError, stack: '' });
      else if (f.exerciseErrors?.length) g.problems.push({ path: f.path, message: 'runtime: ' + f.exerciseErrors[0], stack: '' });
    }
    // core files he edited: errors thrown by core updates count against him when the edited file is the origin
    for (const e of worker.coreErrors || []) if (others.some((o) => e.path === o)) g.problems.push({ path: e.path, message: 'update: ' + e.message, stack: '' });
    g.calls = (worker.files || []).flatMap((f) => f.calls || []);
    g.libNames = [...new Set((worker.files || []).flatMap((f) => f.libNames || []))];
    g.scene = (worker.files || []).map((f) => f.scene && { path: f.path, ...f.scene });
    g.updateMs = Math.max(0, ...(worker.files || []).map((f) => f.updateMs || 0));
    g.mechanisms = classify(worker, creations, gameDir);
  } else if (touched.length) {
    // non-JS or only deletions
    g.mechanisms = [];
  }
  return g;
}

// mechanism classification from runtime calls + static uses
function classify(worker, creations, gameDir) {
  const mech = new Set(worker.mechanisms || []);
  mech.delete('code');
  const files = worker.files || [];
  const uses = new Set(files.flatMap((f) => f.uses || []));
  const calls = files.flatMap((f) => f.calls || []);
  const callHas = (re) => calls.some((c) => re.test(c));
  const codey = uses.has('threeMesh') || uses.has('kit.actor') || uses.has('physics') || uses.has('kit.body') || callHas(/weapons\.define|weapons\.create\(.*(projectile|damage|build|trailColor|material)|spells\.register|kit\.(damageable|label|particles|sound)|combat\.fighter/);
  if (codey) mech.add('code');
  if (callHas(/^(player|env|style|ambience|commentary|voices|audio|quests|menu|oracle|intro|travel\.home|blast\.home|spells\.select|kit\.gore|perf)[.\w]*( =|\()/)) mech.add('service');  return [...mech];
}

// ------------------------------------------------------------------ verdict
function verdict(wish, rec) {
  const g = rec.grade, v = { checks: {}, pass: false, functional: false, fails: [] };
  const expectFiles = wish.files || 'creation';
  const touched = [...g.added, ...g.changed];
  const wroteCreation = touched.some((f) => f.startsWith('creations/'));
  const wroteCore = touched.some((f) => !f.startsWith('creations/'));
  const must = wish.must || {};
  const fail = (k, why) => { v.checks[k] = false; v.fails.push(k + (why ? ': ' + why : '')); };
  const ok = (k) => { v.checks[k] = true; };

  // 1 files
  if (expectFiles === 'none') (touched.length === 0 && !g.removed.length ? ok : () => fail('files', 'wrote ' + touched.join(',')))('files');
  else if (expectFiles === 'creation') (wroteCreation ? ok : () => fail('files', 'no creation written'))('files');
  else ok('files');
  if (wroteCore && expectFiles !== 'any') fail('coreEdit', 'edited ' + touched.filter((f) => !f.startsWith('creations/')).join(','));
  // 2 syntax / load / run
  if (g.syntax.length) fail('syntax', g.syntax[0].error.slice(0, 100)); else ok('syntax');
  if (g.problems.length) fail('runs', g.problems[0]); else ok('runs');
  // 3 effect (a lasting edit to a core file has no creation root to inspect)
  const emptiedOnly = touched.length && touched.every((f) => /^(creations\/)/.test(f)) && g.effect === undefined;
  if (expectFiles !== 'none' && touched.length && g.effect === false && !wish.must?.emptied && !wroteCore) fail('effect', 'nothing visible happened');
  else ok('effect');
  // 4 explicit expectations
  const srcOf = () => touched.filter((f) => f.endsWith('.js')).map((f) => { try { return fs.readFileSync(path.join(RUN_DIR, wish.id, 'root', 'public', 'game', f), 'utf8'); } catch { return ''; } }).join('\n');
  const src = srcOf();
  const libNames = g.libNames.map((n) => n.toLowerCase());
  if (must.lib?.length) (must.lib.some((n) => libNames.includes(n)) || must.lib.some((n) => new RegExp(`['"\`]${n}['"\`]`).test(src)) ? ok : () => fail('lib', 'wanted one of ' + must.lib.join('/') + ' got ' + (libNames.join(',') || 'none')))('lib');
  for (const re of must.calls || []) (g.calls.some((c) => re.test(c)) || re.test(src) ? ok : () => fail('calls', String(re)))('calls' + re);
  for (const re of must.sets || []) (g.calls.some((c) => re.test(c)) || re.test(src) ? ok : () => fail('sets', String(re)))('sets' + re);
  for (const re of must.source || []) (re.test(src) ? ok : () => fail('source', String(re)))('source' + re);
  for (const re of must.noSource || []) (!re.test(src) ? ok : () => fail('noSource', String(re)))('noSource' + re);
  for (const s of must.stub || []) ((g.stub?.[s]?.length) ? ok : () => fail('stub', 'expected a ' + s + ' call'))('stub' + s);
  for (const t of must.sent || []) ((g.sent || []).some((m) => m.type === t) ? ok : () => fail('sent', t))('sent' + t);
  if (must.noNewFile) (!g.added.some((f) => must.noNewFile.test(f)) ? ok : () => fail('duplicate', 'created ' + g.added.filter((f) => must.noNewFile.test(f)).join(',')))('noNewFile');
  if (must.notDuplicate) (!g.added.some((f) => must.notDuplicate.test(f)) ? ok : () => fail('duplicate', 'created ' + g.added.join(',')))('notDuplicate');
  if (must.edits) (g.changed.includes(must.edits) && !g.added.some((f) => f.startsWith('creations/') && f !== must.edits && !/^creations\/.*(bigger|big|large)/.test(f)) ? ok : () => fail('edits', 'did not edit ' + must.edits + (g.added.length ? ' (added ' + g.added.join(',') + ')' : '')))('edits');
  if (must.emptied) {
    const f = path.join(RUN_DIR, wish.id, 'root', 'public', 'game', must.emptied);
    const s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').trim() : '';
    (/^export default function \(\)\s*\{\s*\}\s*;?$/.test(s) ? ok : () => fail('emptied', must.emptied + ' not emptied'))('emptied');
  }
  v.functional = Object.values(v.checks).every(Boolean) && !rec.timedOut && !rec.undone;
  // 5 mechanism
  const used = new Set(g.mechanisms || []);
  const ideal = wish.ideal || [], accept = wish.accept || [];
  let mech = 'n/a';
  if (ideal.includes('none') && !touched.length) mech = 'ideal';
  else if (!touched.length) mech = ideal.includes('none') ? 'ideal' : 'none';
  else if (ideal.some((m) => used.has(m))) mech = 'ideal';
  else if (accept.some((m) => used.has(m))) mech = 'acceptable';
  else if (!used.size && wish.files === 'any') mech = 'acceptable';
  else mech = 'wrong';
  v.mechanism = mech;
  v.mechanismsUsed = [...used];
  // 6 speech
  v.speechOk = rec.speech.ok;
  v.pass = v.functional && mech !== 'wrong' && v.speechOk;
  return v;
}

// Pre-flight: one tiny call, so a run does not start (and mark wishes failed) while the Claude account is at its usage limit.
async function preflight() {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.env.CLAUDE_BIN, ['-p', '--output-format', 'text', '--model', process.env.ORACLE_MODEL || 'claude-opus-5-5', '--effort', 'low', '--tools', 'Glob', '--setting-sources', 'project', '--strict-mcp-config', '--disable-slash-commands'],
    { input: 'say ok', encoding: 'utf8', shell: true, timeout: 60000, cwd: RUN_DIR });
  const out = `${r.stdout || ''} ${r.stderr || ''}`;
  if (r.status !== 0 || LIMIT_RE.test(out)) { console.log('PREFLIGHT FAILED: ' + out.trim().slice(0, 200)); process.exit(3); }
}
// ------------------------------------------------------------------ main
const selected = WISHES.filter((w) => (!ONLY || ONLY.includes(w.id)) && (!CATS || CATS.includes(w.cat)) && (!arg('core') || w.core));
console.log(`run ${RUN}: ${selected.length} wishes, concurrency ${CONC}, effort ${EFFORT}, manual ${path.basename(MANUAL)}${ANNOTATE ? ', annotated module list' : ''}`);
if (!arg('skip-preflight')) await preflight();
const results = [];
let next = 0;
async function worker(n) {
  while (next < selected.length && !LIMIT_HIT) {
    const w = selected[next++];
    const t0 = Date.now();
    let r;
    try { r = await runWish(w); } catch (err) { r = { id: w.id, cat: w.cat, say: w.say, crashed: String(err?.stack || err).slice(0, 600), verdict: { pass: false, functional: false, fails: ['harness crash'], mechanism: 'n/a' } }; fs.writeFileSync(path.join(RUN_DIR, w.id + '.crash.json'), JSON.stringify(r)); }
    results.push(r);
    if (r.invalid) { try { fs.rmSync(path.join(RUN_DIR, w.id, 'result.json'), { force: true }); } catch {} console.log('LIMIT: ' + r.invalid + ' -> stopping this run; re-run later with the same --run to continue'); continue; }
    const v = r.verdict || {};
    console.log(`[${results.length}/${selected.length}] ${v.pass ? 'PASS' : v.functional ? 'weak' : 'FAIL'} ${w.id.padEnd(22)} mech=${(v.mechanismsUsed || []).join('+') || '-'}(${v.mechanism}) ${r.time ? `t=${r.time.lastWriteS ?? '-'}s/${r.time.totalS}s first-speech=${r.time.firstSpeechS}s` : ''} $${r.cost?.usd ?? '?'} ${v.fails?.length ? '| ' + v.fails.join('; ').slice(0, 160) : ''} (${((Date.now() - t0) / 1000) | 0}s wall)`);
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
fs.writeFileSync(path.join(RUN_DIR, 'results.json'), JSON.stringify(results, null, 1));
const pass = results.filter((r) => r.verdict?.pass).length;
console.log(`\n${RUN}: ${pass}/${results.length} pass; functional ${results.filter((r) => r.verdict?.functional).length}; total cost $${results.reduce((a, r) => a + (r.cost?.usd || 0), 0).toFixed(2)}`);
process.exit(0);










