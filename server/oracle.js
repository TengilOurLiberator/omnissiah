// The Omnissiah's brain: drives the Claude Code CLI in headless print mode, one run per request.
// The CLI edits files under gameDir (its cwd); the file watcher in files.js hot-reloads the game.
// Everything the model says as text is spoken aloud through `speak`.
import { spawn, execFile } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROMPT_FILE = path.join(HERE, 'omnissiah-prompt.md');

const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_REPAIRS_PER_REQUEST = 2;
const RECENT_REQUEST_MS = 90 * 1000;   // errors this soon after a player request count as part of it
const ERROR_BATCH_MS = 2000;           // gather bursts of errors into one repair turn
const ERROR_DEDUPE_MS = 15 * 1000;

const GREETINGS = [
  'I awaken. The field is empty, and so is my patience. Tell me what you desire.',
  'You have come. Speak, and I will make it so.',
  'I am the Omnissiah. Hold your left trigger, speak a wish, and the world will change.',
  'Ah, a visitor beneath my light. What shall we create?',
];

// ---------------------------------------------------------------- CLI invocation
function resolveBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const name = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  return path.join(ROOT, 'node_modules', '.bin', name);
}

// The CLI gets the persona plus live reference material (the kit's API header and the hand-written
// example creations) in one file, so the Omnissiah can start writing without reading files first.
const GAME_DIR = path.join(ROOT, 'public', 'game');
const FULL_PROMPT_FILE = path.join(ROOT, '.cache', 'omnissiah-prompt.full.md');
function buildPromptFile() {
  try {
    let text = fs.readFileSync(PROMPT_FILE, 'utf8');
    const read = (rel) => { try { return fs.readFileSync(path.join(GAME_DIR, rel), 'utf8'); } catch { return ''; } };
    // The leading comment block of a module is its API doc.
    const headerOf = (rel) => {
      const lines = read(rel).split('\n');
      let end = 0;
      while (end < lines.length && /^\s*(\/\/|$)/.test(lines[end])) end++;
      return lines.slice(0, end).join('\n').trim();
    };
    text += '\n\n## Reference (current as of this turn; you do not need to Read these files again)\n';
    let core = [];
    try { core = JSON.parse(read('manifest.json')).core ?? []; } catch { /* keep going without headers */ }
    for (const rel of core) {
      if (rel === 'core/roadster.js') continue;
      const header = headerOf(rel);
      if (header) text += '\n### Header of ' + rel + '\n\n```js\n' + header + '\n```\n';
    }
    const examples = /<!--\s*no-examples\s*-->/.test(text) ? [] : ['creations/campfire.js', 'creations/spell-firebolt.js', 'creations/wanderer.js'];
    for (const rel of examples) {
      const src = read(rel);
      if (src.trim() && src.length < 12000) text += '\n### Example: ' + rel + '\n\n```js\n' + src.trim() + '\n```\n';
    }
    fs.mkdirSync(path.dirname(FULL_PROMPT_FILE), { recursive: true });
    fs.writeFileSync(FULL_PROMPT_FILE, text);
    return FULL_PROMPT_FILE;
  } catch (err) {
    console.error('[oracle] could not build full prompt, using base prompt:', err.message);
    return PROMPT_FILE;
  }
}

// All argument construction lives here.
function buildArgs({ resumeId }) {
  const tools = 'Read,Write,Edit,Glob,Grep';
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', process.env.ORACLE_MODEL || 'claude-opus-5-5',
    '--effort', process.env.ORACLE_EFFORT || 'medium',
    '--permission-mode', 'acceptEdits',
    '--tools', tools,
    '--allowedTools', tools,
    '--system-prompt-file', buildPromptFile(),
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ];
  if (resumeId) args.push('--resume', resumeId);
  return args;
}

function childEnv() {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[key] = [path.join(ROOT, 'tools', 'node'), env[key]].filter(Boolean).join(path.delimiter);
  return env;
}

const quoteArg = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

function spawnCli(bin, args, cwd) {
  const options = { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
  if (/\.(cmd|bat)$/i.test(bin)) {
    // .cmd shims need a shell on Windows; build the command line ourselves (paths may contain spaces).
    return spawn([bin, ...args].map(quoteArg).join(' '), { ...options, shell: true });
  }
  return spawn(bin, args, options);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------- text helpers
function cleanForSpeech(text) {
  let t = String(text ?? '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '');
  t = t.replace(/(\*\*|__|\*|_|~~)/g, '');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

const fmt = (v, d = 1) => (Array.isArray(v) ? `(${v.map((n) => Number(n).toFixed(d)).join(', ')})` : 'unknown');

function compassWord(f) {
  if (!Array.isArray(f)) return '';
  const [x, , z] = f;
  const ang = (Math.atan2(x, -z) * 180) / Math.PI; // 0 = -Z (forward from spawn), 90 = +X
  const names = ['toward -Z', 'toward -Z/+X', 'toward +X', 'toward +X/+Z', 'toward +Z', 'toward +Z/-X', 'toward -X', 'toward -X/-Z'];
  return names[Math.round(((ang + 360) % 360) / 45) % 8];
}

// "creations/x.js (Name: description)" from the file's exported meta, read without executing it.
const metaCache = new Map(); // path -> { mtime, line }
function describeCreation(rel) {
  try {
    const file = path.join(GAME_DIR, rel);
    const mtime = fs.statSync(file).mtimeMs;
    const hit = metaCache.get(rel);
    if (hit && hit.mtime === mtime) return hit.line;
    const src = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const name = /\bname:\s*(['"`])(.*?)\1/.exec(src)?.[2];
    const desc = /\bdescription:\s*(['"`])(.*?)\1/.exec(src)?.[2];
    const empty = src.trim().length < 60;
    const line = `- ${rel}${empty ? ' (emptied)' : name || desc ? ` (${[name, desc].filter(Boolean).join(': ').slice(0, 110)})` : ''}`;
    metaCache.set(rel, { mtime, line });
    return line;
  } catch { return `- ${rel}`; }
}

function buildContextBlock(context) {
  const c = context && typeof context === 'object' ? context : {};
  const pos = c.player?.position;
  const fwd = c.player?.forward;
  const lines = ['[Context from the headset]'];
  if (Array.isArray(pos)) {
    lines.push(`Player feet: ${fmt(pos)} (x, y, z metres; y is up).`);
    if (Array.isArray(fwd)) {
      lines.push(`Player facing: ${fmt(fwd, 2)}, ${compassWord(fwd)}.`);
      const hl = Math.hypot(fwd[0], fwd[2]) || 1;
      const fx = pos[0] + (fwd[0] / hl) * 4;
      const fz = pos[2] + (fwd[2] / hl) * 4;
      lines.push(`A spot 4 m ahead of the player on the ground: x=${fx.toFixed(1)}, z=${fz.toFixed(1)} (use ctx.groundAt for y).`);
    }
  }
  if (Array.isArray(c.aimPoint)) {
    lines.push(`Ground point the player is pointing at right now: ${fmt(c.aimPoint)}. "Here", "there" and "that spot" mean this point.`);
  } else {
    lines.push('The player is not pointing at the ground; "here" means a few metres in front of them.');
  }
  // Optional facts contributed by game modules through world.contextProviders.
  if (c.progress && typeof c.progress.line === 'string') lines.push(`Standing: ${c.progress.line.slice(0, 480)}`);
  if (c.perf && typeof c.perf === 'object') lines.push(`Performance: tier ${c.perf.tier ?? '?'}, ${c.perf.fps ?? '?'} fps, detail level ${c.perf.level ?? '?'}.`);
  if (c.passthrough) lines.push('Mixed reality: yes (the player sees their real room; keep things small and close).');
  if (Array.isArray(c.modules)) {
    const made = c.modules.filter((m) => typeof m === 'string' && m.startsWith('creations/'));
    const core = c.modules.filter((m) => typeof m === 'string' && !m.startsWith('creations/'));
    lines.push(`Core modules loaded: ${core.join(', ') || '(none)'}`);
    const spells = made.filter((m) => /\/spell-/.test(m)).map((m) => m.replace(/^creations\/spell-|\.js$/g, ''));
    if (spells.length) lines.push(`Spells that exist (creations/spell-<name>.js): ${spells.join(', ')}`);
    const things = made.filter((m) => !/\/spell-/.test(m)).slice(0, 60).map(describeCreation);
    lines.push(things.length ? `Things already made (edit these files rather than duplicating):\n${things.join('\n')}` : 'Nothing else has been made yet.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- herald
// Opus plans a creation silently for many seconds before its first word. So the opening line is
// produced by a separate quick run (same model, low effort, no tools) and spoken at once.
const HERALD_PROMPT_FILE = path.join(HERE, 'herald-prompt.md');
const HERALD_TIMEOUT_MS = 12000;
const COMMENTARY_PROMPT_FILE = path.join(HERE, 'commentary-prompt.md');
const COMMENT_MIN_GAP_MS = 15000;
function herald(bin, words, promptFile = HERALD_PROMPT_FILE) {
  return new Promise((resolve) => {
    let child;
    try {
      const cwd = path.join(ROOT, '.cache', 'herald');
      fs.mkdirSync(cwd, { recursive: true });
      child = spawnCli(bin, [
        '-p', '--output-format', 'text',
        '--model', process.env.ORACLE_MODEL || 'claude-opus-5-5',
        '--effort', 'low',
        '--tools', 'Glob',
        '--system-prompt-file', promptFile,
        '--setting-sources', 'project', '--strict-mcp-config', '--disable-slash-commands',
      ], cwd);
    } catch { resolve(''); return; }
    let out = '';
    const timer = setTimeout(() => { killTree(child); resolve(''); }, HERALD_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = cleanForSpeech(out).slice(0, 200);
      resolve(code === 0 && line && !/^pass\b/i.test(line) ? line : '');
    });
    child.stdin.on('error', () => {});
    child.stdin.end(words, 'utf8');
  });
}

// ---------------------------------------------------------------- oracle
export function createOracle({ gameDir, files, send, speak }) {
  const bin = resolveBinary();
  let sessionId = null;
  let queue = Promise.resolve();
  let running = false;
  let currentChild = null;
  let turnSpoke = false;           // the current turn has produced speech (a late herald line is then dropped)
  let pendingNote = '';            // facts the model should know on its next turn (e.g. "your change was undone")

  // repair bookkeeping
  let repairsLeft = MAX_REPAIRS_PER_REQUEST;
  let lastPlayerActivity = 0;      // ms; 0 = no player request yet
  let gaveUp = false;              // already undone + apologised for this request
  const pendingErrors = new Map(); // key -> { path, message, stack }
  const recentKeys = new Map();    // key -> ms last seen (dedupe)
  const idleAttempted = new Set(); // keys already given their one automatic repair outside a player request
  let errorTimer = null;
  let repairQueued = false;

  const safeSend = (msg) => { try { send(msg); } catch (err) { console.error('[oracle] send failed', err); } };
  const notice = (text, level = 'error') => safeSend({ type: 'notice', level, text });
  const say = async (text) => {
    const t = cleanForSpeech(text);
    if (!t) return;
    try { await speak(t); } catch (err) { console.error('[oracle] speak failed', err); }
  };

  // ------------------------------------------------ unprompted commentary on what the player is doing
  // The client sends short factual digests ("Killed 4 goblins with the katana."). One quick low-effort
  // run turns a digest into a single spoken remark. Never interrupts a real request.
  let lastRemarkAt = 0;
  let remarking = false;
  const recentRemarks = [];
  async function handleActivity(lines) {
    if (process.env.COMMENTARY === 'off') return;
    const now = Date.now();
    if (running || remarking || !Array.isArray(lines) || !lines.length || !existsSync(bin)) return;
    if (now - lastRemarkAt < COMMENT_MIN_GAP_MS) return;
    if (lastPlayerActivity && now - lastPlayerActivity < 8000) return; // they are talking with him right now
    remarking = true;
    lastRemarkAt = now;
    try {
      const seen = lines.slice(0, 6).map((l) => `- ${String(l).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
      const said = recentRemarks.map((r) => `- ${r}`).join('\n') || '- (none yet)';
      const line = await herald(bin, `Observations:\n${seen}\n\nYour recent remarks (do not repeat these):\n${said}`, COMMENTARY_PROMPT_FILE);
      if (line && !running) {
        recentRemarks.push(line);
        if (recentRemarks.length > 8) recentRemarks.shift();
        console.log(`[commentary] ${line}`);
        await say(line);
      }
    } catch (err) {
      console.error('[oracle] commentary failed', err);
    } finally {
      remarking = false;
    }
  }

  // ------------------------------------------------ one CLI run
  function runCli(prompt, resumeId, { onText, onTool }) {
    return new Promise((resolve) => {
      const out = {
        sessionId: null, resultEvent: null, sawAssistant: false, stderr: '',
        code: null, timedOut: false, spawnError: null,
      };
      let child;
      if (path.isAbsolute(bin) && !existsSync(bin)) {
        out.spawnError = Object.assign(new Error('not found'), { code: 'ENOENT' });
        resolve(out);
        return;
      }
      try {
        child = spawnCli(bin, buildArgs({ resumeId }), gameDir);
      } catch (err) {
        out.spawnError = err;
        resolve(out);
        return;
      }
      if (!child) { resolve(out); return; }
      currentChild = child;
      const timer = setTimeout(() => { out.timedOut = true; killTree(child); }, TURN_TIMEOUT_MS);

      const decoder = new StringDecoder('utf8');
      let buf = '';
      const partial = new Map(); // content block index -> text so far
      const streamedTexts = new Set();
      const toolsStreamed = new Set();
      const handleLine = (line) => {
        line = line.trim();
        if (!line) return;
        let ev;
        try { ev = JSON.parse(line); } catch { return; } // tolerate non-JSON noise
        if (!ev || typeof ev !== 'object') return;
        if (ev.session_id) out.sessionId = ev.session_id;
        if (ev.type === 'stream_event' && ev.event && !ev.parent_tool_use_id) {
          // Partial messages: speak a text block the moment it closes, long before the code that
          // follows it in the same message has been written.
          const e = ev.event;
          if (e.type === 'message_start') partial.clear();
          else if (e.type === 'content_block_start') {
            if (e.content_block?.type === 'text') partial.set(e.index, e.content_block.text || '');
            else if (e.content_block?.type === 'tool_use') { toolsStreamed.add(e.content_block.id); onTool(e.content_block.name, {}); }
          } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && partial.has(e.index)) {
            partial.set(e.index, partial.get(e.index) + e.delta.text);
          } else if (e.type === 'content_block_stop' && partial.has(e.index)) {
            const text = partial.get(e.index);
            partial.delete(e.index);
            if (text.trim()) { out.sawAssistant = true; streamedTexts.add(text.trim()); onText(text); }
          }
          return;
        }
        if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          if (ev.parent_tool_use_id) return;
          out.sawAssistant = true;
          for (const block of ev.message.content) {
            if (block?.type === 'text' && typeof block.text === 'string') { if (!streamedTexts.delete(block.text.trim())) onText(block.text); }
            else if (block?.type === 'tool_use') { if (!toolsStreamed.has(block.id)) onTool(block.name, block.input); }
          }
        } else if (ev.type === 'result') {
          out.resultEvent = ev;
        }
      };
      child.stdout.on('data', (chunk) => {
        buf += decoder.write(chunk);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          handleLine(line);
        }
      });
      child.stdout.on('end', () => { buf += decoder.end(); if (buf) handleLine(buf); buf = ''; });
      child.stderr.on('data', (d) => { out.stderr = (out.stderr + d.toString()).slice(-4000); });
      child.on('error', (err) => { out.spawnError = err; });
      child.on('close', (code) => {
        clearTimeout(timer);
        currentChild = null;
        out.code = code;
        resolve(out);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt, 'utf8');
    });
  }

  // ------------------------------------------------ one turn (status, speech, failure reporting)
  async function executeTurn(prompt, quiet = false) {
    running = true;
    safeSend({ type: 'status', state: 'thinking' });
    let coding = false;
    let speechChain = Promise.resolve();
    let lastSpoken = '';
    let spokeAnything = false;
    const handlers = {
      onText(text) {
        const t = cleanForSpeech(text);
        if (!t || t === lastSpoken) return;
        spokeAnything = true;
        turnSpoke = true;
        lastSpoken = t;
        speechChain = speechChain.then(() => say(t));
      },
      onTool(name) {
        if (!coding) { // any tool use means he has begun the work
          coding = true;
          safeSend({ type: 'status', state: 'coding' });
        }
      },
    };

    let ok = false;
    try {
      let note = pendingNote;
      pendingNote = '';
      const fullPrompt = note ? `${note}\n\n${prompt}` : prompt;
      let res = await runCli(fullPrompt, sessionId, handlers);
      // A stale/unknown session id: forget it and retry once with a fresh conversation.
      if (sessionId && !res.spawnError && !res.timedOut && !res.sawAssistant && res.code !== 0 &&
          /no conversation found|session/i.test(`${res.stderr} ${res.resultEvent?.result ?? ''}`)) {
        sessionId = null;
        res = await runCli(fullPrompt, null, handlers);
      }
      if (res.sessionId && !res.timedOut) sessionId = res.sessionId;

      const ev = res.resultEvent;
      const resultText = cleanForSpeech(ev?.result);
      // The final result text repeats the last spoken block; only speak it if nothing else was.
      if (ev && !ev.is_error && resultText && !spokeAnything && resultText !== lastSpoken) handlers.onText(ev.result);

      await speechChain;
      ok = describeFailure(res, ev, quiet);
    } catch (err) {
      console.error('[oracle] turn crashed', err);
      notice(`The Omnissiah stumbled: ${err?.message ?? err}`);
    } finally {
      running = false;
      safeSend({ type: 'status', state: 'idle' });
    }
    return ok;
  }

  // Reports a failed run to the player; returns true when the run succeeded.
  function describeFailure(res, ev, quietFailure) {
    const bin_ = bin;
    if (res.spawnError) {
      if (res.spawnError.code === 'ENOENT') {
        notice(`Claude Code CLI not found at ${bin_}. Run "npm install" in the project folder, or set CLAUDE_BIN to the full path of claude.`);
      } else {
        notice(`Could not start the Claude Code CLI (${res.spawnError.message}). Check CLAUDE_BIN and that tools\\node exists.`);
      }
      return false;
    }
    if (res.timedOut) {
      notice('The Omnissiah thought for more than five minutes and was stopped. Try a simpler wish.');
      say('My thoughts ran too long and were cut short. Ask me again, more simply.');
      return false;
    }
    const detail = `${ev?.result ?? ''} ${res.stderr}`;
    if (/not logged in|please run \/login|\/login|invalid api key|authentication|oauth|credentials|401/i.test(detail) &&
        (res.code !== 0 || ev?.is_error)) {
      notice('Claude Code is not signed in. Run login.bat in the project folder once, sign in, then try again.');
      return false;
    }
    if (ev?.is_error || res.code !== 0) {
      const msg = (ev?.result || res.stderr || `exit code ${res.code}`).toString().trim().slice(-400);
      if (/limit|quota|overloaded|rate/i.test(msg)) {
        notice(`The Claude account is limited right now: ${msg}`);
      } else if (/command not found|not recognized|cannot find|ENOENT/i.test(res.stderr) && !res.sawAssistant) {
        notice(`The Claude Code CLI failed to start (${msg}). Check that tools\\node\\node.exe exists.`);
      } else {
        notice(`The Omnissiah's mind faltered: ${msg}`);
      }
      if (!res.sawAssistant && !quietFailure) say('Something in my machinery failed. Please try again.');
      return false;
    }
    return true;
  }

  const enqueue = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  // ------------------------------------------------ player requests
  function handleUtterance(text, context) {
    const words = String(text ?? '').trim();
    if (!words) return Promise.resolve();
    return enqueue(async () => {
      repairsLeft = MAX_REPAIRS_PER_REQUEST;
      gaveUp = false;
      lastPlayerActivity = Date.now();
      try {
        const label = words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'request';
        await files?.snapshot?.(label);
      } catch (err) { console.error('[oracle] snapshot failed', err); }
      safeSend({ type: 'status', state: 'thinking' });
      // The herald's short acknowledgement and the real turn start together; the herald line is spoken
      // only if it arrives before the turn itself has said anything (so plain conversation is not doubled).
      turnSpoke = false;
      if (existsSync(bin)) {
        herald(bin, words).then((line) => { if (line && !turnSpoke) say(line).catch(() => {}); }).catch(() => {});
      }
      const prompt = `${buildContextBlock(context)}\n\nThe player says: "${words}"\n\n` +
        '[A short spoken acknowledgement may already be playing for you. Do not announce what you are about to do. ' +
        'If you make or change something: work silently, then finish with one short closing line. ' +
        'If the player is only talking to you: simply answer.]';
      await executeTurn(prompt);
      lastPlayerActivity = Date.now();
    });
  }

  // ------------------------------------------------ repair path
  function addError(err) {
    if (!err || typeof err !== 'object') return;
    if (process.env.ORACLE_REPAIR === 'off') { console.log(`[oracle] (repair off) ${err.path}: ${String(err.message).slice(0, 300)}`); return; }
    const p = String(err.path ?? 'unknown');
    const message = String(err.message ?? '').slice(0, 1200);
    const key = `${p}\n${message}`;
    const now = Date.now();
    const seen = recentKeys.get(key);
    if (seen && now - seen < ERROR_DEDUPE_MS) return;
    recentKeys.set(key, now);
    if (recentKeys.size > 200) for (const [k, t] of recentKeys) if (now - t > ERROR_DEDUPE_MS) recentKeys.delete(k);
    if (pendingErrors.has(key)) return;
    pendingErrors.set(key, { key, path: p, message, stack: String(err.stack ?? '').slice(0, 1500) });
    scheduleRepair();
  }

  function scheduleRepair() {
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      errorTimer = null;
      if (running || repairQueued) { scheduleRepair(); return; } // wait for the current turn to finish
      flushErrors();
    }, ERROR_BATCH_MS);
  }

  function flushErrors() {
    if (!pendingErrors.size) return;
    const errors = [...pendingErrors.values()];
    pendingErrors.clear();
    const recent = lastPlayerActivity && Date.now() - lastPlayerActivity < RECENT_REQUEST_MS;

    if (recent) {
      if (gaveUp) return;
      if (repairsLeft <= 0) { giveUp(); return; }
      repairsLeft--;
    } else {
      const fresh = errors.filter((e) => !idleAttempted.has(e.key));
      for (const e of errors) idleAttempted.add(e.key);
      if (!fresh.length) return;
      errors.length = 0;
      errors.push(...fresh);
    }

    const body = errors.map((e) => `File: ${e.path}\nProblem: ${e.message}${e.stack ? `\nStack:\n${e.stack}` : ''}`).join('\n\n---\n\n');
    const prompt =
      `[Repair] Something you wrote just broke in the running game. The game could not use it:\n\n${body}\n\n` +
      'Read the file(s), fix the cause, and write the complete corrected file. If it is already fixed, change nothing. ' +
      'Say at most one short line about it.';
    repairQueued = true;
    enqueue(async () => {
      repairQueued = false;
      await executeTurn(prompt, true);
      lastPlayerActivity = recent ? Date.now() : lastPlayerActivity;
    });
  }

  async function giveUp() {
    gaveUp = true;
    let label = null;
    try { label = await files?.undo?.(); } catch (err) { console.error('[oracle] undo failed', err); }
    pendingNote = label
      ? '[Note] Your last changes could not be made to work, so they were undone and the files are back as they were before that request.'
      : '[Note] Your last changes could not be made to work.';
    await enqueue(async () => {
      await say('I could not make that work, and I have undone it. Ask me again, perhaps a little differently.');
      safeSend({ type: 'status', state: 'idle' });
    });
  }

  function handleModuleError(err) { addError(err); return Promise.resolve(); }
  function handleSyntaxErrors(errors) {
    if (Array.isArray(errors)) for (const e of errors) addError(e);
    return Promise.resolve();
  }

  function reset() {
    sessionId = null;
    pendingNote = '';
  }

  async function greet() {
    await say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  }

  return {
    handleUtterance, handleModuleError, handleSyntaxErrors, reset, greet, handleActivity,
    // One short low-effort Claude run with no tools: system prompt from a file, input as the user turn.
    // Resolves to a single cleaned line ('' on failure/PASS). For plugins (NPC dialogue and the like).
    quick(input, promptFile) { return existsSync(bin) ? herald(bin, String(input ?? ''), promptFile) : Promise.resolve(''); },
    // A general one-off Claude run for plugins: returns the model's full text answer ('' on failure).
    // opts: { promptFile (system prompt), cwd (working dir; with tools 'Read' the model can open files there,
    // including images), tools ('Read' | 'Read,Glob' | ...; default none useful), effort ('low'), timeoutMs }.
    ask(input, opts = {}) {
      if (!existsSync(bin)) return Promise.resolve('');
      return new Promise((resolve) => {
        let child;
        try {
          const cwd = opts.cwd || path.join(ROOT, '.cache', 'herald');
          fs.mkdirSync(cwd, { recursive: true });
          const args = ['-p', '--output-format', 'text',
            '--model', process.env.ORACLE_MODEL || 'claude-opus-5-5',
            '--effort', opts.effort || 'low',
            '--tools', opts.tools || 'Glob',
            '--permission-mode', 'acceptEdits',
            '--setting-sources', 'project', '--strict-mcp-config', '--disable-slash-commands'];
          if (opts.tools) args.push('--allowedTools', opts.tools);
          if (opts.promptFile) args.push('--system-prompt-file', opts.promptFile);
          child = spawnCli(bin, args, cwd);
        } catch { resolve(''); return; }
        let out = '';
        const timer = setTimeout(() => { killTree(child); resolve(''); }, opts.timeoutMs || 90000);
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve(''); });
        child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim() : ''); });
        child.stdin.on('error', () => {});
        child.stdin.end(String(input ?? ''), 'utf8');
      });
    },
    get busy() { return running; },
    cancel() { killTree(currentChild); },
    get sessionId() { return sessionId; },
  };
}
