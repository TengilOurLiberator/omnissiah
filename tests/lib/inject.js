// Injected into every document before any page script (Page.addScriptToEvaluateOnNewDocument).
// 1. Wraps WebSocket.send: records every client->server message and DROPS the ones that would start model workers or the
//    Claude CLI (QA must never trigger generation). Dropped messages are listed in window.__qa.blocked.
// 2. Fakes pointer lock so the desktop mouse emulation works headlessly (__qa.lock(true/false)).
// 3. Owns requestAnimationFrame: 'real' mode = normal; 'fast' mode = frames are driven back-to-back with a virtual clock
//    (fixed step), so SwiftShader's slow rendering does not slow game time. __qa.setRender(false) turns renderer.render into a
//    no-op (game logic still runs); __qa.measure() does one real render and returns draw calls / triangles.
(() => {
  if (window.__qa) return;
  const qa = window.__qa = { sent: [], blocked: [], recv: [], reloads: 0, frames: 0, lockOn: false, t0: performance.now(), gameTime: 0, mode: 'real', stepMs: 1000 / 72, render: true };
  const params = new URLSearchParams(location.search);
  // say_as_omnissiah would make the server voice a scripted line (Chatterbox on the GPU): drop it and answer the way the server does
  // when it refuses a line ('say_dropped'), so the story engine reads the line itself for readTime() seconds of game time.
  const BLOCK = new Set(['hello', 'gen3d', 'sfx', 'music', 'place', 'blast', 'npc_say', 'say_as_omnissiah', 'voice_warm', 'voice_preview', 'voice_set', 'utterance_text', 'utterance_audio_start', 'utterance_audio_end']);
  // Per-page state of the profile, chosen by the harness through the URL: qaintro=new (wipe localStorage: a brand-new player),
  // seen (wipe it, then mark the awakening as seen: a returning player), keep (leave it alone, e.g. a reload mid-scenario).
  try {
    const qi = params.get('qaintro');
    if (qi === 'new' || qi === 'seen') { localStorage.clear(); if (qi === 'seen') localStorage.setItem('omnissiah.intro.v1', '1'); }
  } catch { /* opaque origin (about:blank) */ }
  // Mock navigator.xr (qaxr=yes: immersive-vr supported, requestSession rejects; pending: requestSession never answers; no: unsupported).
  {
    const xm = params.get('qaxr');
    if (xm) {
      const x = new EventTarget(); qa.xr = { mode: xm, calls: [] };
      x.isSessionSupported = async (m) => xm !== 'no' && m === 'immersive-vr';
      x.requestSession = (m) => { qa.xr.calls.push(m); return xm === 'pending' ? new Promise(() => {}) : Promise.reject(new DOMException('qa mock: no headset', 'NotSupportedError')); };
      try { Object.defineProperty(navigator, 'xr', { configurable: true, get: () => x }); } catch (e) { console.error('[qa] xr mock failed', e); }
    }
  }
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === 'string') {
      let m = null; try { m = JSON.parse(data); } catch { /* not json */ }
      const type = m && m.type;
      const rec = { t: Math.round(performance.now() - qa.t0), type, size: data.length, preview: data.slice(0, 240) };
      if (type === 'say_as_omnissiah') { qa.said = (qa.said || 0) + 1; setTimeout(() => { try { window.game.events.emit('net:say_dropped', { id: m.id, reason: 'qa' }); } catch { /* not booted */ } }, 0); return; }
      if (type && BLOCK.has(type)) { qa.blocked.push(rec); return; }
      qa.sent.push(rec);
    }
    return origSend.call(this, data);
  };
  qa.lock = (on) => { qa.lockOn = !!on; };
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return qa.lockOn ? document.querySelector('canvas') : null; } });
  Element.prototype.requestPointerLock = function () { /* headless: harness sets __qa.lock */ };

  // ---- animation frame scheduler
  const realRAF = window.requestAnimationFrame.bind(window);
  let lastPassed = 0, offset = 0, lastGame = 0;
  const mc = new MessageChannel(); let queue = [];
  // The awakening's darkness (the Omnissiah hidden for the first ~3 game s) is over within ~50 ms of real time on the fast clock: record it here, per frame, instead of asking from outside.
  qa.introWatch = { started: false, hidden: false, startedGame: null };
  const watchIntro = () => {
    const g = window.game, w = g && g.world, i = w && w.intro;
    if (!i || !i.running) return;
    const W = qa.introWatch; if (!W.started) { W.started = true; W.startedGame = qa.gameTime; }
    if (!W.hidden) { const o = g.scene.getObjectByName('module:core/oracle.js'); if (o && o.visible === false) W.hidden = true; }
  };
  const deliver = (cb, ts) => {
    if (ts !== lastGame) { qa.frames++; qa.gameTime += Math.min(Math.max((ts - lastGame) / 1000, 0), 0.1); lastGame = ts; } // count animation frames, not callbacks
    try { cb(ts); } catch (e) { console.error('[qa] rAF callback threw', e); }
    try { watchIntro(); } catch { /* not booted */ }
  };
  let burst = 0;
  mc.port1.onmessage = () => {
    const q = queue; queue = [];
    lastPassed += qa.stepMs; // ONE virtual time step per batch: every rAF consumer in the batch sees the same timestamp (dt = stepMs)
    for (const cb of q) deliver(cb, lastPassed);
  };
  const kick = () => { if (++burst % 8 === 0) setTimeout(() => mc.port2.postMessage(0), 0); else mc.port2.postMessage(0); };
  let lastRaw = -1;
  const realCb = (cb) => (raw) => { if (raw !== lastRaw) { lastRaw = raw; lastPassed = Math.max(raw + offset, lastPassed + 0.01); } deliver(cb, lastPassed); };
  window.requestAnimationFrame = (cb) => {
    if (qa.mode === 'fast') { queue.push(cb); if (queue.length === 1) kick(); return 1; }
    return realRAF(realCb(cb));
  };
  qa.setMode = (mode) => {
    if (mode === qa.mode) return;
    if (mode === 'real') offset = lastPassed - performance.now();
    qa.mode = mode;
    if (mode === 'real' && queue.length) { const q = queue; queue = []; for (const cb of q) realRAF(realCb(cb)); }
  };
  const fastMode = params.get('qafast') === '1';
  if (fastMode) qa.mode = 'fast';
  // when boot.js publishes window.game (before the first frame and before any module loads): switch rendering off in fast mode,
  // and wrap events.on so live listener counts per event are known (qa.listeners)
  qa.listeners = {};
  {
    let g;
    Object.defineProperty(window, 'game', { configurable: true, get() { return g; }, set(v) {
      g = v; Object.defineProperty(window, 'game', { value: v, writable: true, configurable: true });
      try { if (fastMode) qa.setRender(false); } catch (e) { console.error('[qa] setRender', e); }
      try {
        const ev = v.events, orig = ev.on.bind(ev);
        orig('net:save_data', (m) => { try { (qa.saveData ||= []).push({ key: m.key, has: !!m.data, recovered: !!m.recovered, intro: m.data && m.data.stats && m.data.stats.campaign ? m.data.stats.campaign.intro : undefined, t: Math.round(qa.gameTime) }); } catch { /* ignore */ } });
        ev.on = (name, fn) => { qa.listeners[name] = (qa.listeners[name] || 0) + 1; const off = orig(name, fn); let done = false; return () => { if (!done) { done = true; qa.listeners[name]--; } off(); }; };
      } catch (e) { console.error('[qa] events wrap', e); }
    } });
  }
  // ---- render control (needs window.game)
  // resolve after s seconds of GAME time (dt clamped like the game's clock), with a real-time cap
  qa.wait = (s, capMs = 120000) => new Promise((res) => { const g0 = qa.gameTime, t0 = performance.now(); const iv = setInterval(() => { if (qa.gameTime - g0 >= s || performance.now() - t0 > capMs) { clearInterval(iv); res(qa.gameTime - g0); } }, 4); });
  qa.waitFrames = (n, capMs = 60000) => new Promise((res) => { const f0 = qa.frames, t0 = performance.now(); const iv = setInterval(() => { if (qa.frames - f0 >= n || performance.now() - t0 > capMs) { clearInterval(iv); res(qa.frames - f0); } }, 4); });
  qa.setRender = (on) => {
    const r = window.game && window.game.renderer; if (!r) return false;
    if (!qa.origRender) qa.origRender = r.render.bind(r);
    qa.render = !!on;
    r.render = on ? qa.origRender : () => {};
    return true;
  };
  qa.measure = () => {
    const g = window.game, r = g.renderer; const f = qa.origRender || r.render.bind(r);
    const prevAuto = r.info.autoReset; r.info.autoReset = false; r.info.reset();
    f(g.scene, g.camera);
    const i = r.info; const out = { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, lines: i.render.lines };
    r.info.autoReset = prevAuto; r.info.reset();
    return out;
  };
  // compile every material currently in the scene (finds broken shaders without drawing)
  qa.compile = () => { const g = window.game; try { g.renderer.compile(g.scene, g.camera); return true; } catch (e) { return String(e); } };
  window.addEventListener('unhandledrejection', (e) => { (qa.rejections ||= []).push(String(e.reason && (e.reason.stack || e.reason.message || e.reason)).slice(0, 800)); });
})();






