// STABLE CORE: WebSocket link to the server (see docs/CONTRACT.md, "WebSocket protocol").
//
// Every server message { type, ... } becomes events.emit('net:' + type, msg).
// Also: 'net:open' (after the hello went out) and 'net:close'.
// A 'status' message additionally emits 'oracle:state' with msg.state (after 'net:status').

const MIN_DELAY_MS = 400;
const MAX_DELAY_MS = 8000;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024; // drop mic frames rather than let the socket back up

export function createNet({ events }) {
  let ws = null;
  let isOpen = false;
  let attempts = 0;
  let timer = 0;
  let nextTryAt = 0;
  let countdown = 0;
  let oracleState = 'idle';

  const clientKind = () =>
    navigator.xr && /OculusBrowser|Quest|Mobile|Android/i.test(navigator.userAgent) ? 'quest' : 'desktop';

  // ------------------------------------------------------------ #status line
  // The pill at the bottom left of the page: a short word and a coloured dot (data-state: ok | busy | off | wait; see index.html).
  const STATE_WORDS = { listening: 'Listening', transcribing: 'Hearing you', thinking: 'Thinking', coding: 'Weaving', speaking: 'Speaking' };
  function paintStatus(text, state) {
    const el = document.getElementById('status');
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    if (el.dataset.state !== state) el.dataset.state = state;
  }
  function refreshStatus() {
    if (isOpen) {
      if (oracleState && oracleState !== 'idle') paintStatus(STATE_WORDS[oracleState] ?? oracleState, 'busy');
      else paintStatus('Connected', 'ok');
    } else if (timer) {
      const s = Math.max(0, Math.ceil((nextTryAt - Date.now()) / 1000));
      paintStatus(`Offline, retrying in ${s} s`, 'off');
    } else {
      paintStatus('Connecting…', 'wait');
    }
  }
  events.on('oracle:state', (s) => { oracleState = s; refreshStatus(); });

  // ------------------------------------------------------------ connection
  function url() {
    const scheme = location.protocol === 'http:' ? 'ws' : 'wss';
    return `${scheme}://${location.host}/ws`;
  }

  function scheduleReconnect() {
    if (timer) return;
    const base = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * Math.pow(1.7, attempts));
    const delay = base * (0.85 + Math.random() * 0.3);
    attempts++;
    nextTryAt = Date.now() + delay;
    timer = setTimeout(() => { timer = 0; clearInterval(countdown); countdown = 0; connect(); }, delay);
    clearInterval(countdown);
    countdown = setInterval(refreshStatus, 1000);
    refreshStatus();
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    if (timer) { clearTimeout(timer); timer = 0; clearInterval(countdown); countdown = 0; }
    refreshStatus();
    let sock;
    try {
      sock = new WebSocket(url());
    } catch (err) {
      console.warn('[net] could not create WebSocket', err);
      scheduleReconnect();
      return;
    }
    sock.binaryType = 'arraybuffer';
    ws = sock;

    sock.onopen = () => {
      if (ws !== sock) return;
      isOpen = true;
      attempts = 0;
      try { sock.send(JSON.stringify({ type: 'hello', client: clientKind() })); } catch { /* closing */ }
      refreshStatus();
      events.emit('net:open', {});
    };

    sock.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return; // server never sends binary; ignore
      let msg;
      try { msg = JSON.parse(ev.data); } catch { console.warn('[net] bad JSON from server'); return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'open' || msg.type === 'close') return; // reserved for our own events
      events.emit('net:' + msg.type, msg);
      if (msg.type === 'status' && typeof msg.state === 'string') events.emit('oracle:state', msg.state);
    };

    sock.onerror = () => { /* onclose follows */ };

    sock.onclose = () => {
      if (ws !== sock) return;
      const wasOpen = isOpen;
      isOpen = false;
      ws = null;
      if (wasOpen) events.emit('net:close', {});
      scheduleReconnect();
    };
  }

  // Quest suspends the browser when the headset is taken off; reconnect as soon as we are back.
  const kick = () => {
    if (isOpen || (ws && ws.readyState === WebSocket.CONNECTING)) return;
    attempts = 0;
    connect();
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  window.addEventListener('online', kick);

  connect();

  return {
    get connected() { return isOpen; },
    send(obj) {
      if (!isOpen || !ws) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    },
    sendBinary(data) {
      if (!isOpen || !ws || ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
      try { ws.send(data); return true; } catch { return false; }
    },
  };
}
