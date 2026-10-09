// Settings: the Omnissiah's voice, the server's environment (read-only), and "drop a picture to blast it".
import { h, icon, clear, fmtBytes, toast, copyText, emptyState } from '../dom.js';

const ENV_HELP = {
  ORACLE_EFFORT: ['Thinking effort', 'low, medium or high. Lower is faster and cheaper; higher makes better code.'],
  ORACLE_MODEL: ['Model', 'Which Claude model plays the Omnissiah. Unset = the Claude Code default.'],
  TTS_VOICE: ['Fallback voice', 'The Windows (SAPI) voice used when the real voice engine is not warm yet.'],
  PORT: ['HTTPS port', 'What the headset connects to (default 8443).'],
  LOCAL_PORT: ['Local HTTP port', 'This page and the flat desktop game (default 8080, this PC only).'],
  COMMENTARY: ['Unprompted remarks (at start)', '"off" = he only speaks when spoken to. Use the switch above to change it while running.'],
  ORACLE_REPAIR: ['Automatic repair', '"off" = broken code is not fed back to him to fix; it is undone instead.'],
};
const DOCS = [
  ['README.md', 'Play, controls, settings (environment variables)'], ['docs/CONTRACT.md', 'Module API, WebSocket protocol, plugin API'], ['docs/PERFORMANCE.md', 'Budgets and how to read a headset report'],
  ['docs/ADMIN.md', 'This control panel: protocol and security model'], ['server/voice/README.md', 'Voices and how they are made'], ['server/audio/README.md', 'Generated sound effects and music'], ['server/blast/README.md', 'Blast: a picture becomes a world'],
];
const MAX_BYTES = 12 * 1024 * 1024, CHUNK = 512 * 1024;

export default function mount(root, app) {
  const { net } = app;
  let voice = null;
  const voiceBox = h('div', { class: 'stack' });
  const envBox = h('div');
  const commentBox = h('div', { class: 'stack' });
  const dropBox = h('div', { class: 'stack' });
  const inputsBox = h('div');

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'), h('p', null, 'How the Omnissiah sounds, how the server was started, and a way to turn any picture into a place to stand in.'))),
    h('div', { class: 'grid2 even' },
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('mic', 15), 'The Omnissiah\'s voice'), voiceBox),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('note', 15), 'Unprompted commentary'), commentBox),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('settings', 15), 'Server environment'), envBox)),
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('blast', 15), 'Blast a picture'), dropBox, inputsBox),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Read more'),
          h('div', { class: 'list' }, DOCS.map(([file, what]) => h('div', { class: 'item' }, h('div', { class: 'item-main' }, h('div', { class: 'item-title mono' }, file), h('div', { class: 'item-sub' }, what)),
            h('button', { class: 'icon-btn', type: 'button', title: 'Copy the full path', 'aria-label': `Copy path of ${file}`, on: { click: async () => toast((await copyText(`D:\\omnissiah\\${file.replace(/\//g, '\\')}`)) ? 'Path copied' : 'Copy failed', 'ok') } }, icon('copy', 16))))),
          h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'These are files in the game folder; the web server does not publish them.')))));

  // ---------------------------------------------------------------- voice
  function paintVoice() {
    clear(voiceBox);
    if (!voice) { voiceBox.append(emptyState('Waiting for the voice plugin…', net.state === 'open' ? 'If this stays, the voice plugin is not loaded and the Windows fallback voice is used.' : 'Not connected.')); return; }
    voiceBox.append(h('div', { class: 'row wrap small' }, h('span', { class: `badge ${voice.worker === 'ready' ? 'ok' : voice.worker === 'error' ? 'bad' : 'warn'}` }, `voice engine: ${voice.worker ?? 'unknown'}`), voice.hot ? h('span', { class: 'badge ok' }, 'warm') : h('span', { class: 'badge' }, 'cold: the first line may use the fallback voice')),
      h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Voice of the Omnissiah' }, (voice.voices ?? []).map((v) => {
        const on = v.id === voice.current;
        return h('div', { class: 'voice-opt needs-write', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabIndex: 0, on: { click: () => choose(v.id), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(v.id); } } } },
          h('span', { class: 'radio' }, ''), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, v.label), h('div', { class: 'small dim' }, v.desc)),
          h('button', { class: 'btn sm', type: 'button', 'aria-label': `Preview ${v.label}`, on: { click: (e) => { e.stopPropagation(); net.send({ type: 'voice_preview', voice: v.id }); toast('Previewing: it plays wherever the game is open.'); } } }, icon('play', 12), 'Preview'));
      })),
      h('p', { class: 'tiny faint' }, 'The choice is saved by the server and used for every line he speaks, in the headset and on the desktop.'));
  }
  function choose(id) { if (!net.canWrite) return toast('Read-only here: change the voice from the game PC.', 'error'); if (voice?.current === id) return; net.send({ type: 'voice_set', voice: id, preview: false }); voice = { ...voice, current: id }; paintVoice(); }
  net.on('voice_info', (m) => { voice = m; paintVoice(); });
  net.on('state', (s) => { if (s === 'open') net.send({ type: 'voice_get' }); else { voice = null; paintVoice(); } });
  if (net.state === 'open') net.send({ type: 'voice_get' });

  // ---------------------------------------------------------------- commentary (spends the player's Claude usage)
  let commentary = null;
  function paintComment() {
    clear(commentBox);
    if (commentary === null) return commentBox.append(h('p', { class: 'dim small' }, net.hasPlugin === false ? 'Needs the admin plugin.' : 'Waiting for the server…'));
    const on = commentary.on;
    commentBox.append(
      h('div', { class: 'row' },
        h('button', { class: 'switch needs-write', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': 'Unprompted commentary', on: { click: toggleComment } }, h('i')),
        h('div', null, h('div', { style: { fontWeight: 600 } }, on ? 'On: he comments on what the player does' : 'Off: he only speaks when spoken to'),
          h('div', { class: 'small dim' }, commentary.env ? `The server started with COMMENTARY=${commentary.env}.` : 'The server started without a COMMENTARY setting.'))),
      h('div', { class: 'banner warn', style: { marginTop: 0 } }, icon('bolt', 15), h('span', null, 'Every remark is an extra Claude run, so it spends your plan\'s usage while you play. Turn it off to save it. Takes effect at once and is remembered after a restart.')));
  }
  async function toggleComment() {
    try { const r = await net.write('admin_commentary', { on: !commentary.on }); commentary = { ...commentary, on: r.commentary }; paintComment(); toast(`Commentary ${r.commentary ? 'on' : 'off'}.`, 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  async function loadComment() {
    if (net.hasPlugin !== true) { commentary = null; return paintComment(); }
    try { const s = await net.request('admin_status', {}, { timeout: 4000 }); commentary = { on: s.commentary, env: s.commentaryEnv }; } catch { /* keep */ }
    paintComment();
  }
  net.on('admin_event', (m) => { if (m.kind === 'changed' && m.what === 'commentary') loadComment(); });

  // ---------------------------------------------------------------- environment
  function paintEnv() {
    clear(envBox);
    const hello = net.hello;
    if (!hello) return envBox.append(emptyState('Nothing to show', net.hasPlugin === false ? 'The admin plugin is not loaded.' : 'Waiting for the server…'));
    envBox.append(
      h('table', { class: 'tbl' }, h('tbody', null, Object.entries(ENV_HELP).map(([k, [label, help]]) => {
        const v = hello.env?.[k];
        return h('tr', null, h('td', null, h('div', null, label), h('div', { class: 'tiny faint' }, help)), h('td', { class: 'mono nowrap' }, v === null || v === undefined ? h('span', { class: 'faint' }, 'default') : h('span', { class: 'gold' }, v)));
      }))),
      h('div', { class: 'label', style: { margin: '14px 0 6px' } }, 'Server plugins found'),
      h('div', { class: 'chips' }, (hello.plugins ?? []).map((p) => h('span', { class: 'badge info' }, p))),
      h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'Set these before running start.bat. The panel only shows them; a running server cannot change its own environment. Every wish and remark uses your Claude plan\'s usage.'));
  }
  net.on('plugin', () => { paintEnv(); paintDrop(); loadInputs(); loadComment(); });

  // ---------------------------------------------------------------- blast: drop a picture
  let state = { phase: 'idle', file: null, preview: null, progress: 0, saved: null, blast: null, error: null };
  const hasBlast = () => !!net.hello?.plugins?.includes('blast');
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, 'aria-label': 'Choose a picture to blast', on: { change: () => { const f = fileInput.files?.[0]; fileInput.value = ''; if (f) pick(f); } } });
  function paintDrop() {
    clear(dropBox);
    const readonly = net.hasPlugin === true && !net.loopback;
    const zone = h('div', { class: `dropzone${state.phase === 'uploading' ? ' over' : ''}`, role: 'button', tabIndex: 0, 'aria-label': 'Drop a picture here, or press Enter to choose one',
      on: { click: () => state.phase !== 'uploading' && fileInput.click(), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
        dragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, dragleave: () => zone.classList.remove('over'),
        drop: (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer?.files?.[0]; if (f) pick(f); } } },
      state.preview ? h('img', { src: state.preview, alt: 'Chosen picture' }) : icon('upload', 34),
      h('strong', null, state.file ? state.file.name : 'Drop a picture here to blast it'),
      h('span', { class: 'small' }, state.file ? `${fmtBytes(state.file.size)}` : 'PNG, JPG or WebP, up to 12 MB. One place, seen at eye level, works best.'));
    dropBox.append(zone, fileInput);
    if (readonly) dropBox.append(h('p', { class: 'small', style: { color: 'var(--warn)' } }, 'Read-only here: uploading is only allowed from the game PC.'));
    if (state.phase === 'uploading') dropBox.append(h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Upload progress', 'aria-valuenow': Math.round(state.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${state.progress * 100}%` } })));
    if (state.error) dropBox.append(h('div', { class: 'banner bad', style: { marginTop: 0 } }, state.error));
    if (state.saved) {
      dropBox.append(h('div', { class: 'row wrap' }, h('span', { class: 'badge ok' }, `saved as ${state.saved.path}`),
        hasBlast() ? h('button', { class: 'btn primary needs-write', type: 'button', disabled: state.blast && state.blast.state === 'running', on: { click: () => blastIt(state.saved.name) } }, icon('blast', 16), 'Blast it') : h('span', { class: 'small dim' }, 'The blast plugin is not installed on this server, so the picture just waits in the input folder.')));
    }
    if (state.blast) {
      const b = state.blast, pct = b.progress?.total ? b.progress.done / b.progress.total : 0;
      dropBox.append(h('div', { class: 'stack' }, h('div', { class: 'row small' }, h('span', { class: `badge ${b.state === 'done' ? 'ok' : b.state === 'error' ? 'bad' : 'gold'}` }, b.state === 'done' ? 'finished' : b.state === 'error' ? 'failed' : b.stage ?? 'working'), h('span', { class: 'dim' }, b.message ?? '')),
        b.state === 'running' ? h('div', { class: 'meter cyan', role: 'progressbar', 'aria-label': 'Blast progress', 'aria-valuenow': Math.round(pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${Math.max(4, pct * 100)}%` } })) : null,
        b.state === 'done' && b.slug ? h('a', { class: 'btn sm', href: `#assets/blasts/${encodeURIComponent(b.slug)}` }, icon('eye', 14), 'See the result') : null,
        h('p', { class: 'tiny faint' }, 'A blast takes many minutes: it makes a picture, studies it, builds the objects and the place. You can leave this page; progress also shows on the Live tab.')));
    }
  }
  function pick(f) {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type) && !/\.(png|jpe?g|webp)$/i.test(f.name)) return toast('Only PNG, JPG or WebP pictures.', 'error');
    if (f.size > MAX_BYTES) return toast(`That picture is ${fmtBytes(f.size)}; the limit is 12 MB.`, 'error');
    if (f.size < 12) return toast('That file is empty.', 'error');
    if (state.preview) URL.revokeObjectURL(state.preview);
    state = { phase: 'uploading', file: f, preview: URL.createObjectURL(f), progress: 0, saved: null, blast: null, error: null };
    paintDrop(); upload(f);
  }
  const readB64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(blob); });
  async function upload(f) {
    try {
      await net.write('admin_upload_start', { name: f.name, size: f.size });
      for (let off = 0, seq = 0; off < f.size; off += CHUNK, seq++) {
        await net.write('admin_upload_chunk', { seq, data: await readB64(f.slice(off, off + CHUNK)) }, { timeout: 30000 });
        state.progress = Math.min(1, (off + CHUNK) / f.size); paintDrop();
      }
      const r = await net.write('admin_upload_end');
      state = { ...state, phase: 'saved', saved: r, progress: 1 }; paintDrop(); loadInputs();
      toast(`Saved to ${r.path}`, 'ok');
    } catch (e) { state = { ...state, phase: 'idle', error: e.message }; paintDrop(); }
  }
  function blastIt(name) {
    const id = `adm-${Date.now().toString(36)}`;
    if (!net.send({ type: 'blast', id, image: name, options: {} })) return toast('Not connected.', 'error');
    state = { ...state, blast: { id, state: 'running', stage: 'starting', message: 'Sent to the server' } }; paintDrop();
    toast('Blast started. It takes a while.', 'ok');
  }
  net.on('blast_status', (m) => {
    if (!state.blast || m.id !== state.blast.id) return;
    state = { ...state, blast: { ...state.blast, ...m, state: m.state === 'done' || m.stage === 'done' ? 'done' : m.state === 'error' ? 'error' : 'running' } }; paintDrop();
  });

  async function loadInputs() {
    clear(inputsBox);
    if (net.hasPlugin !== true) return;
    try {
      const d = await net.request('admin_inputs');
      if (!d.files.length) return;
      inputsBox.append(h('hr', { class: 'sep' }), h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Pictures already in the input folder'),
        h('div', { class: 'list' }, d.files.map((f) => h('div', { class: 'item' }, h('div', { class: 'item-main' }, h('div', { class: 'item-title mono' }, f.name), h('div', { class: 'item-sub tiny' }, fmtBytes(f.size))),
          hasBlast() ? h('button', { class: 'btn sm needs-write', type: 'button', on: { click: () => { state = { ...state, saved: { name: f.name, path: f.path }, phase: 'saved', error: null }; blastIt(f.name); } } }, 'Blast it') : null))));
    } catch { /* plugin gone */ }
  }

  paintVoice(); paintEnv(); paintDrop(); paintComment(); if (net.hasPlugin) loadComment();
  return { show() { if (net.state === 'open') net.send({ type: 'voice_get' }); paintEnv(); paintDrop(); loadInputs(); loadComment(); } };
}
