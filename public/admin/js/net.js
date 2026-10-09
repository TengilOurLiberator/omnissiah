// WebSocket link to the game server (same /ws the headset uses). Auto-reconnects. Request/response over `rid` for the plugin's admin_* messages.
// NOTE: this panel never sends `hello` (that would make the Omnissiah greet the first visitor); it only says `admin_hello`.

const listeners = new Map();   // type -> Set<fn>
const pending = new Map();     // rid -> { resolve, reject, timer }
let ws = null, attempts = 0, retryTimer = 0, seq = 0, helloTimer = 0;

export const net = {
  state: 'connecting',         // connecting | open | closed
  hasPlugin: null,             // null = not asked yet, true/false once admin_hello was (not) answered
  loopback: false,             // the server says this connection comes from the PC itself: writes allowed
  token: null,
  hello: null,                 // the admin_hello payload
  get canWrite() { return this.state === 'open' && this.hasPlugin === true && this.loopback && !!this.token; },
  on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn); },
  send(obj) { if (!ws || ws.readyState !== 1) return false; try { ws.send(JSON.stringify(obj)); return true; } catch { return false; } },
  // Resolves with `data`, rejects with Error(message). Writes get the token automatically.
  request(type, payload = {}, { timeout = 10000, write = false } = {}) {
    if (net.state !== 'open') return Promise.reject(new Error('Not connected to the server.'));
    if (write && !net.canWrite) return Promise.reject(new Error(net.loopback ? 'Admin token missing: reload the page.' : 'Read-only: open this panel on the PC that runs the game to make changes.'));
    const rid = `a${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(rid); reject(new Error('The server did not answer (is the admin plugin loaded?).')); }, timeout);
      pending.set(rid, { resolve, reject, timer });
      if (!net.send({ type, rid, ...(write ? { token: net.token } : {}), ...payload })) { clearTimeout(timer); pending.delete(rid); reject(new Error('Not connected to the server.')); }
    });
  },
  write(type, payload, opts) { return net.request(type, payload, { ...opts, write: true }); },
};

function emit(type, msg) { for (const fn of listeners.get(type) ?? []) { try { fn(msg); } catch (err) { console.error(`[admin] listener for ${type} failed`, err); } } }
const setState = (s) => { if (net.state !== s) { net.state = s; emit('state', s); } };

async function fetchToken() {
  try {
    const r = await fetch(`/admin-auth/token.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.token === 'string' ? j.token : null;
  } catch { return null; }
}

async function sayHello() {
  net.hasPlugin = null;
  clearTimeout(helloTimer);
  helloTimer = setTimeout(() => { if (net.hasPlugin === null) { net.hasPlugin = false; emit('plugin', false); } }, 3000);
  try {
    net.token = await fetchToken();
    const data = await net.request('admin_hello', {}, { timeout: 3000 });
    clearTimeout(helloTimer);
    net.hello = data; net.loopback = !!data.loopback; net.hasPlugin = true;
    emit('plugin', true);
  } catch {
    net.hasPlugin = false; emit('plugin', false);
  }
}

function connect() {
  clearTimeout(retryTimer);
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  setState(attempts ? 'closed' : 'connecting');
  let sock;
  try { sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); } catch { return retry(); }
  ws = sock;
  sock.onopen = () => { if (ws !== sock) return; attempts = 0; setState('open'); sayHello(); };
  sock.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'admin_reply') {
      const p = pending.get(msg.rid);
      if (!p) return;
      pending.delete(msg.rid); clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data ?? {}); else p.reject(new Error(msg.error || 'Request failed.'));
      return;
    }
    emit(msg.type, msg); emit('*', msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; net.hasPlugin = null; net.loopback = false;
    for (const [rid, p] of pending) { clearTimeout(p.timer); p.reject(new Error('Connection lost.')); pending.delete(rid); }
    setState('closed'); retry();
  };
  sock.onerror = () => { /* close follows */ };
}
function retry() {
  const delay = Math.min(6000, 400 * Math.pow(1.7, attempts++)) * (0.85 + Math.random() * 0.3);
  net.nextRetry = Date.now() + delay;
  retryTimer = setTimeout(connect, delay);
  emit('retry', delay);
}
export function start() {
  connect();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && net.state !== 'open') { attempts = 0; connect(); } });
  window.addEventListener('online', () => { if (net.state !== 'open') { attempts = 0; connect(); } });
}
