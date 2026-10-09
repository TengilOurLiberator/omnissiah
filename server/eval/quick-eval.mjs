// Small evals for the two one-line prompts that run beside the main Omnissiah turn.
//   node server/eval/quick-eval.mjs herald     --prompt <file> --name h1 [--model claude-...] [--concurrency 4]
//   node server/eval/quick-eval.mjs commentary --prompt <file> --name c1 [--model claude-...]
// Uses the real oracle.js code path (oracle.quick -> the same CLI flags, 12 s timeout) from a private copy of oracle.js.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, CACHE } from './lib.mjs';
import { HERALD_SET } from './herald-set.mjs';
import { SESSIONS } from './digest-set.mjs';
import { checkLine } from './speech.mjs';

const argv = process.argv.slice(2);
const kind = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const NAME = arg('name', kind + '-' + Date.now());
const PROMPT = path.resolve(arg('prompt', path.join(ROOT, 'server', kind === 'herald' ? 'herald-prompt.md' : 'commentary-prompt.md')));
const CONC = Number(arg('concurrency', 4));
if (arg('model')) process.env.ORACLE_MODEL = arg('model');
process.env.CLAUDE_BIN = path.join(ROOT, 'node_modules', '.bin', 'claude.cmd');
{ const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH'; process.env[key] = path.join(ROOT, 'tools', 'node') + path.delimiter + process.env[key]; }

const dir = path.join(CACHE, 'quick', NAME);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'server', 'oracle.js'), path.join(dir, 'server', 'oracle.js'));
fs.copyFileSync(PROMPT, path.join(dir, 'server', 'prompt.md'));
const { createOracle } = await import(pathToFileURL(path.join(dir, 'server', 'oracle.js')).href);
const oracle = createOracle({ gameDir: dir, files: {}, send() {}, speak: async () => {} });
const promptFile = path.join(dir, 'server', 'prompt.md');
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const report = { name: NAME, kind, prompt: path.basename(PROMPT), model: process.env.ORACLE_MODEL || 'default', rows: [] };

if (kind === 'herald') {
  const rows = await pool(HERALD_SET, CONC, async (u) => {
    const t0 = Date.now();
    const line = await oracle.quick(u.say, promptFile);
    const ms = Date.now() - t0;
    const failed = !line && ms > 11500; // a timeout looks like PASS; flag it
    const decision = line ? 'announce' : 'pass';
    const issues = line ? checkLine(line) : [];
    if (line && words(line) > 12) issues.push(`over-12-words(${words(line)})`);
    if (/[?]/.test(line)) issues.push('question');
    if (/^(sure|okay|of course|certainly|i can|i will help)/i.test(line)) issues.push('assistant-tone');
    console.log(`${decision === u.expect ? 'ok  ' : 'MISS'} ${String(ms).padStart(5)}ms ${u.say.padEnd(50)} -> ${line || (failed ? '(timeout)' : 'PASS')}`);
    return { say: u.say, expect: u.expect, decision, line, ms, timeout: failed, issues };
  });
  report.rows = rows;
  const ok = rows.filter((r) => r.decision === r.expect).length;
  const ann = rows.filter((r) => r.expect === 'announce'), pas = rows.filter((r) => r.expect === 'pass');
  const lines = rows.filter((r) => r.line);
  const firstWords = new Set(lines.map((r) => r.line.split(/\s+/).slice(0, 2).join(' ').toLowerCase()));
  report.summary = {
    accuracy: `${ok}/${rows.length}`,
    announceRecall: `${ann.filter((r) => r.decision === 'announce').length}/${ann.length}`,
    passPrecision: `${pas.filter((r) => r.decision === 'pass').length}/${pas.length}`,
    lengthWords: { median: median(lines.map((r) => words(r.line))), max: Math.max(0, ...lines.map((r) => words(r.line))) },
    issues: rows.flatMap((r) => r.issues.map((i) => `${r.say}: ${i}`)),
    distinctOpenings: `${firstWords.size}/${lines.length}`,
    latencyMs: { median: median(rows.map((r) => r.ms)), p95: pct(rows.map((r) => r.ms), 0.95) },
    timeouts: rows.filter((r) => r.timeout).length,
  };
} else {
  const sessions = await pool(SESSIONS, SESSIONS.length, async (digests, si) => {
    const recent = [], rows = [];
    for (const d of digests) {
      const seen = d.lines.slice(0, 6).map((l) => `- ${String(l).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
      const said = recent.map((r) => `- ${r}`).join('\n') || '- (none yet)';
      const t0 = Date.now();
      const line = await oracle.quick(`Observations:\n${seen}\n\nYour recent remarks (do not repeat these):\n${said}`, promptFile);
      const ms = Date.now() - t0;
      if (line) { recent.push(line); if (recent.length > 8) recent.shift(); }
      const issues = line ? checkLine(line) : [];
      if (line && words(line) > 18) issues.push(`over-18-words(${words(line)})`);
      if (/\?/.test(line) || /\b(would you like|let me|try (to|using)|you should|do you want)\b/i.test(line)) issues.push('asks-or-instructs');
      console.log(`s${si + 1} ${d.dull ? 'dull' : '    '} ${String(ms).padStart(5)}ms ${line || 'PASS'}   <= ${d.lines[0].slice(0, 60)}`);
      rows.push({ session: si + 1, lines: d.lines, dull: !!d.dull, line, ms, issues });
    }
    return rows;
  });
  report.rows = sessions.flat();
  const rows = report.rows, lines = rows.filter((r) => r.line);
  const dull = rows.filter((r) => r.dull), live = rows.filter((r) => !r.dull);
  const allWords = lines.flatMap((r) => r.line.toLowerCase().match(/[a-z']{4,}/g) || []);
  const freq = new Map(); for (const w of allWords) freq.set(w, (freq.get(w) || 0) + 1);
  const dupPairs = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = new Set(lines[i].line.toLowerCase().match(/[a-z']{4,}/g) || []), b = new Set(lines[j].line.toLowerCase().match(/[a-z']{4,}/g) || []);
    const inter = [...a].filter((x) => b.has(x)).length; if (inter / Math.max(1, Math.min(a.size, b.size)) > 0.6) dupPairs.push([lines[i].line, lines[j].line]);
  }
  const first3 = lines.map((r) => r.line.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
  report.summary = {
    passOnDull: `${dull.filter((r) => !r.line).length}/${dull.length}`,
    remarkOnLive: `${live.filter((r) => r.line).length}/${live.length}`,
    lengthWords: { median: median(lines.map((r) => words(r.line))), max: Math.max(0, ...lines.map((r) => words(r.line))) },
    issues: rows.flatMap((r) => r.issues.map((i) => `${r.line}: ${i}`)),
    nearDuplicates: dupPairs.length, distinctOpenings: `${new Set(first3).size}/${lines.length}`,
    topRepeatedWords: [...freq.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8),
    latencyMs: { median: median(rows.map((r) => r.ms)), p95: pct(rows.map((r) => r.ms), 0.95) },
  };
}
console.log('\n' + JSON.stringify(report.summary, null, 1));
const outDir = path.join(ROOT, 'server', 'eval', 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${kind}-${NAME}.json`), JSON.stringify(report, null, 1));
process.exit(0);
