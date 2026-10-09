// Aggregates a run's per-wish result.json files into a table + statistics.
//   node server/eval/report.mjs <run> [<run2> ...] [--md]    (writes server/eval/results/<run>.md and <run>.json)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CACHE } from './lib.mjs';
import { WISHES } from './wishes.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const LIMIT_RE = /session limit|usage limit|rate limit|limited right now|overloaded|quota/i;
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pctl = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const pc = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : '-');

export function loadRun(run) {
  const dir = path.join(CACHE, run);
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const w of WISHES) {
    const f = path.join(dir, w.id, 'result.json');
    if (!fs.existsSync(f)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(f, 'utf8'));
      r.invalid = r.invalid || ((r.sends || []).some((s) => LIMIT_RE.test(s)) && !r.cost?.usd ? 'limit' : null);
      out.push(r);
    } catch { /* skip */ }
  }
  return out;
}

export function summarise(run, rs) {
  const valid = rs.filter((r) => !r.invalid && r.verdict);
  const byCat = {};
  for (const r of valid) { (byCat[r.cat] ??= []).push(r); }
  const creation = valid.filter((r) => r.grade && ([...(r.grade.added || []), ...(r.grade.changed || [])].length));
  const tWork = creation.map((r) => r.time?.lastWriteS);
  const tTotal = valid.map((r) => r.time?.totalS);
  const sum = {
    run, wishes: rs.length, valid: valid.length, invalid: rs.length - valid.length,
    pass: valid.filter((r) => r.verdict.pass).length,
    functional: valid.filter((r) => r.verdict.functional).length,
    firstTryClean: valid.filter((r) => r.firstPass && !r.firstPass.problems?.length).length,
    mechanism: { ideal: valid.filter((r) => r.verdict.mechanism === 'ideal').length, acceptable: valid.filter((r) => r.verdict.mechanism === 'acceptable').length, wrong: valid.filter((r) => r.verdict.mechanism === 'wrong').length, none: valid.filter((r) => r.verdict.mechanism === 'none').length },
    speechOk: valid.filter((r) => r.speech?.ok).length,
    heraldOk: valid.filter((r) => r.speech?.heraldOk).length,
    repairs: valid.reduce((a, r) => a + (r.repairs || 0), 0),
    undone: valid.filter((r) => r.undone).length,
    timeToWorking: { n: tWork.filter((x) => x != null).length, median: median(tWork), p95: pctl(tWork, 0.95) },
    totalTime: { median: median(tTotal), p95: pctl(tTotal, 0.95) },
    firstSpeech: { median: median(valid.map((r) => r.time?.firstSpeechS)), p95: pctl(valid.map((r) => r.time?.firstSpeechS), 0.95) },
    cost: { total: +valid.reduce((a, r) => a + (r.cost?.usd || 0), 0).toFixed(2), medianPerWish: median(valid.map((r) => r.cost?.usd)), outTokensMedian: median(valid.map((r) => r.cost?.out)) },
    byCat: Object.fromEntries(Object.entries(byCat).map(([c, l]) => [c, { n: l.length, pass: l.filter((r) => r.verdict.pass).length, functional: l.filter((r) => r.verdict.functional).length }])),
    failures: valid.filter((r) => !r.verdict.pass).map((r) => ({ id: r.id, cat: r.cat, say: r.say, fails: r.verdict.fails, mech: r.verdict.mechanismsUsed, mechVerdict: r.verdict.mechanism, speech: r.speech?.issues })),
    speechIssues: valid.filter((r) => r.speech?.issues?.length).map((r) => ({ id: r.id, issues: r.speech.issues })),
    reads: Object.entries(valid.flatMap((r) => r.reads || []).reduce((m, f) => m.set(f, (m.get(f) || 0) + 1), new Map())).sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
  return sum;
}

export function table(rs) {
  const rows = ['| id | cat | verdict | mechanism | files | t work s | total s | $ | repairs | notes |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rs) {
    if (r.invalid) { rows.push(`| ${r.id} | ${r.cat} | invalid (${r.invalid}) | | | | | | | |`); continue; }
    const v = r.verdict || {};
    const files = [...(r.grade?.added || []).map((f) => '+' + f.replace('creations/', '')), ...(r.grade?.changed || []).map((f) => '~' + f.replace('creations/', ''))].join(' ');
    rows.push(`| ${r.id} | ${r.cat} | ${v.pass ? 'PASS' : v.functional ? 'weak' : 'FAIL'} | ${(v.mechanismsUsed || []).join('+') || '-'} (${v.mechanism}) | ${files || '-'} | ${r.time?.lastWriteS ?? '-'} | ${r.time?.totalS ?? '-'} | ${r.cost?.usd ?? '-'} | ${r.repairs || 0} | ${(v.fails || []).join('; ').replace(/\|/g, '/').slice(0, 140)}${r.speech?.issues?.length ? ' [speech: ' + r.speech.issues.join(',') + ']' : ''} |`);
  }
  return rows.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const outDir = path.join(ROOT, 'server', 'eval', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  for (const run of args) {
    const rs = loadRun(run);
    const s = summarise(run, rs);
    fs.writeFileSync(path.join(outDir, `${run}.json`), JSON.stringify(s, null, 1));
    fs.writeFileSync(path.join(outDir, `${run}.md`), `# ${run}\n\n` + '```\n' + JSON.stringify({ ...s, failures: undefined, speechIssues: undefined, byCat: undefined }, null, 1) + '\n```\n\nBy category:\n\n' + Object.entries(s.byCat).map(([c, v]) => `- ${c}: ${v.pass}/${v.n} pass, ${v.functional}/${v.n} functional`).join('\n') + '\n\n' + table(rs) + '\n');
    console.log(`${run}: ${s.pass}/${s.valid} pass (${s.invalid} invalid), functional ${s.functional}/${s.valid}; mechanism ideal ${s.mechanism.ideal} acceptable ${s.mechanism.acceptable} wrong ${s.mechanism.wrong} none ${s.mechanism.none}; speech ok ${s.speechOk}/${s.valid}; herald decision ok ${s.heraldOk}/${s.valid}`);
    console.log(`  time to working: median ${s.timeToWorking.median}s p95 ${s.timeToWorking.p95}s (n=${s.timeToWorking.n}); total median ${s.totalTime.median}s p95 ${s.totalTime.p95}s; first speech median ${s.firstSpeech.median}s p95 ${s.firstSpeech.p95}s; cost $${s.cost.total}`);
    console.log('  by category: ' + Object.entries(s.byCat).map(([c, v]) => `${c} ${v.pass}/${v.n}`).join(', '));
    if (process.argv.includes('--md')) console.log('\n' + table(rs));
  }
}
