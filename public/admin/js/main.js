// Omnissiah control panel shell: header, navigation, hash router, lazy tab modules.
import { net, start } from './net.js';
import { h, icon, clear, toast, fmtAgo } from './dom.js';

const TABS = [
  { id: 'live', title: 'Live session', short: 'Live', icon: 'live', load: () => import('./tabs/live.js') },
  { id: 'creations', title: 'Creations', short: 'Creations', icon: 'creations', load: () => import('./tabs/creations.js') },
  { id: 'library', title: 'Library & spawn', short: 'Library', icon: 'library', load: () => import('./tabs/library.js') },
  { id: 'cheat', title: 'Cheat sheet', short: 'Cheat sheet', icon: 'sheet', load: () => import('./tabs/cheat.js') },
  { id: 'assets', title: 'Generated assets', short: 'Assets', icon: 'assets', load: () => import('./tabs/assets.js') },
  { id: 'player', title: 'Player & progress', short: 'Player', icon: 'player', load: () => import('./tabs/player.js') },
  { id: 'settings', title: 'Settings', short: 'Settings', icon: 'settings', load: () => import('./tabs/settings.js') },
  { id: 'perf', title: 'Performance', short: 'Performance', icon: 'perf', load: () => import('./tabs/perf.js') },
  { id: 'help', title: 'Help', short: 'Help', icon: 'help', load: () => import('./tabs/help.js') },
];

// Shared across tabs: the oracle state, a place to park a wish typed elsewhere, navigation.
export const app = {
  net,
  oracle: { state: null, at: 0 },
  go(hash) { location.hash = hash.startsWith('#') ? hash : `#${hash}`; },
  pendingWish: '',
  wish(text) { app.pendingWish = text; app.go('live'); },
};

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const instances = new Map();   // tab id -> { el, api }
let current = null;

// ------------------------------------------------------------------ header status
const orb = h('span', { class: 'dot idle' });
const oracleLabel = h('span', { text: 'waiting' });
const connDot = h('span', { class: 'dot off' });
const connLabel = h('span', { text: 'connecting' });
const modeBadge = h('span', { class: 'badge', hidden: true });
document.getElementById('status').append(
  h('span', { class: 'pill', title: 'What the Omnissiah is doing right now', 'aria-live': 'polite' }, orb, h('span', { class: 'dim' }, 'Omnissiah'), oracleLabel),
  h('span', { class: 'pill', title: 'Link between this page and the game server' }, connDot, connLabel),
  modeBadge,
);
const banner = document.getElementById('banner');

function paintOracle() {
  const s = app.oracle.state;
  orb.className = `dot ${s ?? 'idle'}`;
  oracleLabel.textContent = s ?? (net.state === 'open' ? 'idle' : 'unknown');
}
net.on('status', (m) => { if (typeof m.state === 'string') { app.oracle = { state: m.state, at: Date.now() }; paintOracle(); } });

let retryTick = 0;
function paintConn() {
  clearInterval(retryTick);
  const s = net.state;
  connDot.className = `dot ${s === 'open' ? 'ok' : s === 'closed' ? 'bad' : 'warn'}`;
  if (s === 'open') connLabel.textContent = 'connected';
  else if (s === 'closed') {
    const upd = () => { connLabel.textContent = `offline, retrying in ${Math.max(0, Math.ceil(((net.nextRetry ?? Date.now()) - Date.now()) / 1000))}s`; };
    upd(); retryTick = setInterval(upd, 500);
  } else connLabel.textContent = 'connecting';
  paintMode(); paintOracle();
}
function paintMode() {
  let text = '', cls = 'ok', tip = '';
  if (net.state === 'open' && net.hasPlugin === true) {
    if (net.loopback) { text = 'Full control'; cls = 'ok'; tip = 'You are on the PC that runs the game: changes are allowed.'; }
    else { text = 'Read-only'; cls = 'warn'; tip = 'You are on another device: you can look, but only the PC itself can change things.'; }
  } else if (net.state === 'open' && net.hasPlugin === false) { text = 'Admin plugin missing'; cls = 'bad'; tip = 'server/plugins/admin.js is not loaded: restart the server.'; }
  modeBadge.hidden = !text; modeBadge.textContent = text; modeBadge.className = `badge ${cls}`; modeBadge.title = tip;
  const lock = !net.canWrite;
  document.body.classList.toggle('readonly', lock && net.state === 'open' && net.hasPlugin === true);
  clear(banner);
  if (net.state !== 'open' && net.state !== 'connecting') banner.append(h('div', { class: 'banner bad' }, icon('power', 16), h('span', null, 'The server is not reachable. This page keeps trying and will pick up where it left off when the game server is back.')));
  else if (net.state === 'open' && net.hasPlugin === false) banner.append(h('div', { class: 'banner warn' }, icon('lock', 16), h('span', null, 'The admin plugin is not loaded on this server (server/plugins/admin.js), so only live viewing and the voice setting work. Restart the game server to enable the rest.')));
  else if (net.state === 'open' && net.hasPlugin === true && !net.loopback) banner.append(h('div', { class: 'banner info' }, icon('eye', 16), h('span', null, 'Read-only view: this device is not the game PC. Open http://localhost:8080/admin/ on the PC to change things.')));
}
net.on('state', paintConn); net.on('retry', paintConn); net.on('plugin', paintMode);

// ------------------------------------------------------------------ nav + router
for (const t of TABS) {
  const a = h('a', { href: `#${t.id}`, class: 'nav-item', data: { tab: t.id } }, icon(t.icon, 18), h('span', { class: 'nav-label' }, t.short));
  nav.append(a);
}
function setActiveNav(id) {
  for (const a of nav.querySelectorAll('.nav-item')) {
    const on = a.dataset.tab === id;
    a.classList.toggle('active', on);
    if (on) { a.setAttribute('aria-current', 'page'); a.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } else a.removeAttribute('aria-current');
  }
}

async function route() {
  const [id = 'live', ...rest] = location.hash.replace(/^#/, '').split('/').map(decodeURIComponent);
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  if (current && current !== tab.id) { instances.get(current)?.el.setAttribute('hidden', ''); instances.get(current)?.api?.hide?.(); }
  current = tab.id;
  setActiveNav(tab.id);
  document.title = `${tab.title} · Omnissiah control panel`;
  let inst = instances.get(tab.id);
  if (!inst) {
    const el = h('div', { class: 'tab', id: `tab-${tab.id}`, 'aria-label': tab.title });
    inst = { el, api: null };
    instances.set(tab.id, inst);
    main.append(el);
    el.append(h('div', { class: 'loading' }, 'Loading…'));
    try {
      const mod = await tab.load();
      clear(el);
      inst.api = (await mod.default(el, app)) ?? {};
    } catch (err) {
      console.error(`[admin] tab ${tab.id} failed to load`, err);
      clear(el); el.append(h('div', { class: 'card' }, h('h2', { class: 'card-title' }, 'This tab failed to load'), h('p', { class: 'dim' }, String(err?.message ?? err))));
    }
  }
  if (current !== tab.id) return; // navigated away while loading
  inst.el.removeAttribute('hidden');
  inst.api?.show?.(rest);
  if (!rest.length) main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

// The Live tab collects the transcript from the very first message, so it is created at once (hidden if another tab was requested).
start();
paintConn();
route();
if (current !== 'live') {
  const el = h('div', { class: 'tab', id: 'tab-live', hidden: true });
  instances.set('live', { el, api: null });
  main.prepend(el);
  TABS[0].load().then(async (mod) => { instances.get('live').api = (await mod.default(el, app)) ?? {}; });
}
setInterval(() => { for (const el of document.querySelectorAll('[data-ago]')) el.textContent = fmtAgo(Number(el.dataset.ago)); }, 15000);
window.addEventListener('unhandledrejection', (e) => { console.warn('[admin] unhandled', e.reason); });
export { toast };
