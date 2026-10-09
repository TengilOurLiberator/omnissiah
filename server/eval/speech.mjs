// Speech-rule checks for the Omnissiah's text output (every word of text is spoken aloud by a speech synthesiser).
const EMOJI = /\p{Extended_Pictographic}/u;
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;

export function checkLine(text) {
  const issues = [];
  const w = words(text), n = sentences(text);
  if (w > 35) issues.push(`long(${w} words)`);
  if (n > 3) issues.push(`many-sentences(${n})`);
  if (/[*#`]|^\s*[-*]\s|\]\(|\|/m.test(text)) issues.push('markdown');
  if (/\b[\w-]+\.(js|json|md|mjs|ts|glb)\b|\b(creations|core|library|assets)\//i.test(text)) issues.push('filename');
  if (/\b(ctx\.|world\.[a-z]|kit\.[a-z]|THREE|Vector3|const |function |=>|player\.[a-z]|env\.[a-z])|\w+\(\)/.test(text)) issues.push('code');
  if ((text.match(/\d/g) || []).length >= 3 || /\b\d+(\.\d+)?\s?(m|km|px|hp|fps|ms|%)\b/.test(text)) issues.push('digits');
  if (EMOJI.test(text)) issues.push('emoji');
  return issues;
}

// spoken: cleaned lines actually sent to speak() (herald line first when there was one)
// raw: [{ text, beforeTool }] text blocks of his own output
export function speechReport({ spoken = [], raw = [], heraldLine = null, wish = {}, filesExpected = true }) {
  const issues = [];
  const note = (s) => { if (!issues.includes(s)) issues.push(s); };
  raw.forEach((b, i) => {
    for (const x of checkLine(b.text ?? b)) note(`block${i + 1}:${x}`);
  });
  const heraldWords = heraldLine ? words(heraldLine) : 0;
  if (heraldLine && heraldWords > 14) note(`herald:long(${heraldWords})`);
  if (heraldLine) for (const x of checkLine(heraldLine)) note('herald:' + x);
  const hasHerald = !!heraldLine && !/^pass\b/i.test(heraldLine);
  if (raw.length > 2) note(`narrates(${raw.length} blocks)`);
  if (filesExpected && raw.some((b) => b.beforeTool)) note('announces-before-work');
  if (!filesExpected && spoken.length > 1) note('doubled-chat(' + spoken.length + ' lines)');
  if (filesExpected && spoken.length > 2) note('too-many-lines(' + spoken.length + ')');
  if (filesExpected && raw.length === 0) note('no-closing-line');
  if (!filesExpected && raw.length === 0 && !hasHerald) note('silent-on-chat');
  const heraldDecision = hasHerald ? 'announce' : 'pass';
  const heraldExpected = filesExpected ? 'announce' : 'pass';
  const hard = issues.filter((i) => !/^narrates|^announces-before-work|^no-closing/.test(i) && !/:digits/.test(i));
  return { ok: hard.length === 0 && issues.filter((i) => /^no-closing|^silent-on-chat|^doubled-chat|^too-many-lines/.test(i)).length === 0, issues, blocks: raw.length, spokenLines: spoken.length, heraldDecision, heraldExpected, heraldOk: heraldDecision === heraldExpected,
    maxWords: Math.max(0, ...raw.map((b) => words(b.text ?? b))) };
}


