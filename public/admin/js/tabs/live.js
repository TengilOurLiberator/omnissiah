// Live session: connection, the Omnissiah's state, a transcript, wishes as the player, undo / forget, say-as-Omnissiah.
import { h, icon, clear, fmtClock, fmtAgo, fmtDuration, toast, confirmDialog } from '../dom.js';

const MAX_LINES = 500;
const WHO = { player: 'Player', omni: 'Omnissiah', npc: 'NPC', notice: 'Notice', system: 'System', error: 'Error' };
const STATE_TEXT = {
  idle: 'Waiting for a wish', listening: 'Listening to the player', transcribing: 'Understanding the speech', thinking: 'Thinking',
  coding: 'Writing the game code', speaking: 'Speaking',
};

export default function mount(root, app) {
  const { net } = app;
  const lines = [];
  const recent = [];                       // dedupe: the same text arrives as `transcript` and as a panel event
  let lastStatus = null, lastCtx = null, statusAt = 0;

  // ---------------------------------------------------------------- structure
  const feed = h('div', { class: 'feed', role: 'log', 'aria-live': 'off', 'aria-label': 'Conversation transcript', tabIndex: 0, data: { f: 'all' } });
  const jump = h('button', { class: 'btn sm primary jump', type: 'button', hidden: true, on: { click: () => scrollEnd(true) } }, 'New lines below');
  const filters = [['all', 'All'], ['player', 'Player'], ['omni', 'Omnissiah'], ['npc', 'NPCs'], ['sys', 'System']];
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter the transcript' }, filters.map(([id, label]) =>
    h('button', { type: 'button', 'aria-pressed': id === 'all' ? 'true' : 'false', on: { click: (e) => { feed.dataset.f = id; for (const b of seg.children) b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); } } }, label)));
  const wishBox = h('input', { class: 'input', type: 'text', placeholder: 'Make a wish as the player, e.g. "summon three goblins"', maxLength: 600, autocomplete: 'off', 'aria-label': 'Wish to send as the player',
    on: { keydown: (e) => { if (e.key === 'Enter' && !e.isComposing) sendWish(); } } });
  const sendBtn = h('button', { class: 'btn primary', type: 'button', on: { click: sendWish } }, icon('bolt', 16), 'Send wish');

  const orb = h('div', { class: 'orb', 'data-state': 'unknown', 'aria-hidden': 'true' });
  const stateText = h('div', { class: 'orb-state', text: 'Unknown' });
  const stateSub = h('div', { class: 'dim small', text: 'No status received yet' });
  const kv = h('dl', { class: 'kv small' });
  const ctxBox = h('div', { class: 'context' });

  const hearBox = h('div', { class: 'stack' });
  const logPre = h('pre', { class: 'raw', tabIndex: 0, 'aria-label': 'Recent speech and client log lines', style: { maxHeight: '220px' } }, 'Nothing logged yet.');
  const logLines = [];
  const sayBox = h('textarea', { class: 'input', rows: 3, maxLength: 500, placeholder: 'Words for the Omnissiah to speak aloud (he will say exactly this)', 'aria-label': 'Text for the Omnissiah to speak' });
  const sayBtn = h('button', { class: 'btn needs-write', type: 'button', on: { click: say } }, icon('mic', 16), 'Speak as the Omnissiah');

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Live session'), h('p', null, 'Watch the conversation, make wishes without putting on the headset, and steer the Omnissiah.'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'col' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Conversation'), h('span', { class: 'right' }, seg)),
          feed, jump,
          h('div', { class: 'composer' }, wishBox, sendBtn),
          h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'Sent exactly as if the player had typed it. Everyone connected, including the headset, hears the answer.'))),
      h('div', { class: 'col' },
        h('section', { class: 'card' },
          h('h2', { class: 'card-title' }, 'The Omnissiah'),
          h('div', { class: 'orb-row' }, orb, h('div', null, stateText, stateSub)),
          ctxBox),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('mic', 15), 'Hearing'), hearBox,
          h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'small dim', style: { cursor: 'pointer' } }, 'Server log: speech and game-client lines'), h('div', { style: { marginTop: '8px' } }, logPre))),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Session'), kv),
        h('section', { class: 'card' },
          h('h2', { class: 'card-title' }, 'Steer'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', type: 'button', on: { click: undo } }, icon('undo', 16), 'Undo last change'),
            h('button', { class: 'btn', type: 'button', on: { click: forget } }, icon('restore', 16), 'Forget conversation')),
          h('p', { class: 'tiny faint', style: { margin: '8px 0 14px' } }, 'Undo restores the game code from before his last wish. Forget makes him start the conversation from scratch.'),
          h('div', { class: 'field' }, h('label', null, 'Say as the Omnissiah'), sayBox),
          h('div', { class: 'row', style: { marginTop: '8px' } }, sayBtn, h('span', { class: 'tiny faint' }, 'Spoken in his current voice.'))))));

  // ---------------------------------------------------------------- transcript
  const atEnd = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
  function scrollEnd(force) { if (force || atEnd()) { feed.scrollTop = feed.scrollHeight; jump.hidden = true; } else jump.hidden = false; }
  feed.addEventListener('scroll', () => { if (atEnd()) jump.hidden = true; });

  function addLine(kind, text, who, t = Date.now()) {
    text = String(text ?? '').trim();
    if (!text) return;
    const key = `${kind}|${text}`;
    const now = Date.now();
    if (kind === 'player') {
      const dupe = recent.find((r) => r.key === key && now - r.t < 6000);
      if (dupe) return;
      recent.push({ key, t: now }); if (recent.length > 12) recent.shift();
    }
    const stick = atEnd();
    const cls = kind === 'notice' || kind === 'system' ? `${kind} sys` : kind === 'error' ? 'error sys' : kind;
    const el = h('div', { class: `line ${cls}` }, h('span', { class: 'line-time' }, fmtClock(t)), h('span', { class: 'line-who' }, who ?? WHO[kind]), h('span', { class: 'line-text' }, text));
    feed.append(el); lines.push(el);
    while (lines.length > MAX_LINES) lines.shift().remove();
    if (stick) scrollEnd(true); else jump.hidden = false;
  }

  // ---------------------------------------------------------------- server messages
  net.on('transcript', (m) => addLine('player', m.text, 'Player'));
  net.on('admin_event', (m) => {
    if (m.kind === 'player') { lastCtx = m.lastContext ?? lastCtx; paintCtx(); addLine('player', m.text, m.source === 'panel' ? 'Panel' : m.npc ? `To ${String(m.npc).slice(0, 10)}` : 'Player', m.t); }
  });
  net.on('speak', (m) => addLine('omni', m.text));
  net.on('npc_reply', (m) => addLine('npc', m.text, m.name ? String(m.name).slice(0, 14) : 'NPC'));
  net.on('notice', (m) => addLine(m.level === 'error' ? 'error' : 'notice', m.text));
  net.on('reload', (m) => addLine('system', `Game code reloaded (${Array.isArray(m.modules) ? m.modules.length : '?'} modules).`));
  net.on('module_error', (m) => addLine('error', `${m.path ?? 'a module'}: ${m.message ?? 'failed'}`, 'Module'));
  net.on('gen3d_status', (m) => { if (m.state === 'done' || m.state === 'error') addLine(m.state === 'error' ? 'error' : 'system', `3D model ${m.state === 'done' ? 'ready' : 'failed'}${m.message ? `: ${m.message}` : ''}`, 'Model'); });
  net.on('place_status', (m) => { if (m.state === 'done' || m.state === 'error') addLine(m.state === 'error' ? 'error' : 'system', `Place ${m.state === 'done' ? 'ready' : 'failed'}${m.slug ? ` (${m.slug})` : ''}${m.state === 'error' && m.message ? `: ${m.message}` : ''}`, 'Place'); });
  net.on('blast_status', (m) => { if (m.state === 'done' || m.state === 'error') addLine(m.state === 'error' ? 'error' : 'system', `Blast ${m.stage ?? ''} ${m.state}${m.message ? `: ${m.message}` : ''}`, 'Blast'); });
  net.on('audio_status', (m) => { if (m.state === 'error') addLine('error', `Audio ${m.kind ?? ''} failed${m.message ? `: ${m.message}` : ''}`, 'Audio'); });
  net.on('status', (m) => { lastStatus = m.state; statusAt = Date.now(); paintState(); });
  net.on('state', (s) => { addLine('system', s === 'open' ? 'Connected to the server.' : 'Connection to the server lost; retrying.'); if (s !== 'open') { lastStatus = null; paintState(); } else poll(); });
  net.on('plugin', () => { paintKv(); poll(); });

  // ---------------------------------------------------------------- status panels
  function paintState() {
    const s = net.state === 'open' ? (lastStatus ?? app.oracle.state ?? 'idle') : null;
    orb.dataset.state = s ?? 'unknown';
    stateText.textContent = s ? (s === 'idle' ? 'Idle' : s) : 'Offline';
    stateSub.textContent = s ? (STATE_TEXT[s] ?? 'Working') : 'The server is not reachable';
  }
  function paintCtx() {
    clear(ctxBox);
    const p = lastCtx?.player?.position;
    const cell = (label, value) => h('div', null, h('b', null, label), h('span', null, value));
    ctxBox.append(
      cell('Player at', Array.isArray(p) ? p.map((n) => Number(n).toFixed(1)).join(', ') : 'not reported'),
      cell('Aiming at', Array.isArray(lastCtx?.aimPoint) ? lastCtx.aimPoint.map((n) => Number(n).toFixed(1)).join(', ') : 'nothing'),
      cell('Modules', lastCtx?.modules != null ? String(lastCtx.modules) : '-'));
  }
  let lastStatusData = null;
  function paintKv() {
    clear(kv);
    const st = lastStatusData;
    const row = (k, v) => kv.append(h('dt', null, k), h('dd', null, v));
    row('Server link', net.state === 'open' ? 'connected' : net.state);
    row('Admin plugin', net.hasPlugin === true ? 'loaded' : net.hasPlugin === false ? 'not loaded' : 'checking');
    row('Permissions', net.hasPlugin ? (net.loopback ? 'can make changes' : 'read-only (not the game PC)') : '-');
    row('Panels open', st ? String(st.panels) : '-');
    if (st && Array.isArray(st.clients)) row('Game clients', st.clients.length ? st.clients.map((c) => `${c.kind ?? 'client'}${c.address ? ` (${c.address})` : ''}`).join(', ') : 'none connected');
    else row('Game activity', lastCtx?.t ? `heard ${fmtAgo(lastCtx.t)}` : 'nothing heard yet');
    if (st) row('Server busy', st.busy ? 'working on a wish' : 'no');
    if (net.hello?.node) row('Server', `Node ${net.hello.node.replace(/^v/, '')}, up ${fmtDuration((Date.now() - net.hello.startedAt) / 1000)}`);
  }
  let heard = null;
  function paintHearing() {
    clear(hearBox);
    const st = lastStatusData?.stt, last = st?.last;
    if (net.hasPlugin !== true) return hearBox.append(h('p', { class: 'dim small' }, 'Needs the admin plugin on the server.'));
    if (!st) hearBox.append(h('p', { class: 'dim small' }, 'The server did not report a speech-recognition service.'));
    else {
      const g = st.gpu, gpuOk = g?.state === 'ready';
      hearBox.append(h('div', { class: 'row wrap small' },
        h('span', { class: `badge ${gpuOk ? 'ok' : g?.state === 'error' ? 'bad' : 'warn'}`, title: g?.lastError ?? '' }, g ? `GPU worker: ${g.state}` : 'GPU worker: off'),
        last && last.backend !== 'none' ? h('span', { class: 'badge info' }, `last: ${last.backend.toUpperCase()}, ${last.ms} ms`) : h('span', { class: 'badge' }, 'nothing transcribed yet'),
        st.envBackend ? h('span', { class: 'badge' }, `STT_BACKEND=${st.envBackend}`) : null),
        g?.lastError && !gpuOk ? h('p', { class: 'tiny', style: { color: 'var(--warn)' } }, `GPU worker: ${g.lastError}. The CPU model answers instead (slower).`) : null);
    }
    const hd = heard ?? lastStatusData?.heard;
    hearBox.append(h('div', { class: 'label' }, 'He last heard'),
      hd ? h('blockquote', { style: { margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--gold)', background: 'rgba(4,5,24,.5)', borderRadius: '0 8px 8px 0' } }, hd.empty ? h('i', { class: 'dim' }, hd.text) : `“${hd.text}”`) : h('p', { class: 'dim small' }, 'Nothing since the server started.'),
      hd ? h('div', { class: 'tiny faint' }, `${hd.seconds.toFixed(1)} s of audio, loudness peak ${hd.peak.toFixed(3)}, ${fmtAgo(hd.t)}${hd.empty && hd.peak < 0.003 ? ' · silence: the microphone gave no signal' : ''}`) : null);
  }
  const fmtLog = (e) => `${fmtClock(e.t)} [${e.tag}] ${e.line}`;
  function paintLog() { logPre.textContent = logLines.length ? logLines.map(fmtLog).join('\n') : 'Nothing logged yet.'; logPre.scrollTop = logPre.scrollHeight; }
  net.on('admin_event', (m) => {
    if (m.kind === 'heard') { heard = m.heard; paintHearing(); }
    if (m.kind === 'log') { logLines.push(m.entry); if (logLines.length > 60) logLines.shift(); paintLog(); }
  });
  async function poll() {
    if (net.state !== 'open' || net.hasPlugin !== true) { paintKv(); paintHearing(); return; }
    try { lastStatusData = await net.request('admin_status', {}, { timeout: 4000 }); if (lastStatusData.lastContext) lastCtx = lastStatusData.lastContext; } catch { /* next time */ }
    paintKv(); paintCtx(); paintHearing();
  }
  async function loadLogs() { try { const d = await net.request('admin_logs', {}, { timeout: 4000 }); logLines.length = 0; logLines.push(...d.lines.slice(-60)); if (d.heard) heard = d.heard; paintLog(); paintHearing(); } catch { /* none */ } }
  net.on('plugin', loadLogs);
  const timer = setInterval(() => { if (!document.hidden) poll(); }, 6000);

  // ---------------------------------------------------------------- actions
  async function currentModules() { try { const r = await fetch('/api/modules', { cache: 'no-store' }); return (await r.json()).modules.map((m) => m.path); } catch { return []; } }
  async function sendWish() {
    const text = wishBox.value.trim();
    if (!text) return;
    if (net.state !== 'open') return toast('Not connected to the server yet.', 'error');
    const fresh = lastCtx && Date.now() - lastCtx.t < 10 * 60 * 1000;
    const context = { player: fresh && lastCtx.player ? lastCtx.player : { position: [0, 0, 0], forward: [0, 0, -1] }, aimPoint: fresh ? lastCtx.aimPoint ?? null : null, modules: await currentModules(), admin: true };
    if (net.send({ type: 'utterance_text', text, context })) { wishBox.value = ''; addLine('system', 'Wish sent from the control panel.', 'Panel'); } else toast('Could not send: connection lost.', 'error');
  }
  async function undo() {
    if (!(await confirmDialog({ title: 'Undo the last change?', text: 'The game code goes back to how it was before the Omnissiah\'s last wish.', detail: 'Everything currently in the game reloads. You can undo repeatedly to walk further back.', confirm: 'Undo it' }))) return;
    if (!net.send({ type: 'command', name: 'undo' })) toast('Not connected.', 'error');
  }
  async function forget() {
    if (!(await confirmDialog({ title: 'Make him forget the conversation?', text: 'The Omnissiah starts fresh and will not remember what you asked before. Game objects stay as they are.', confirm: 'Forget', danger: true }))) return;
    if (!net.send({ type: 'command', name: 'reset' })) toast('Not connected.', 'error');
  }
  async function say() {
    const text = sayBox.value.trim();
    if (!text) return;
    try { await net.write('admin_say', { text }); sayBox.value = ''; } catch (err) { toast(err.message, 'error'); }
  }

  paintState(); paintCtx(); paintKv(); paintHearing();
  addLine('system', 'Control panel opened. Lines appear here as they happen.');
  return {
    show() {
      if (app.pendingWish) { wishBox.value = app.pendingWish; app.pendingWish = ''; wishBox.focus(); }
      scrollEnd(true); poll();
    },
    hide() { /* the transcript keeps collecting */ },
    destroy() { clearInterval(timer); },
  };
}
