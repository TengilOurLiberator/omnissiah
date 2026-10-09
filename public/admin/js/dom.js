// Tiny DOM helpers. Everything user-controlled (wishes, file contents, prompts) goes in through text nodes: nothing here ever parses HTML
// from data. The only innerHTML use is icon() with the static markup below.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'data') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && !k.startsWith('aria') && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---- icons (static, trusted markup)
const ICONS = {
  live: '<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>',
  creations: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  library: '<path d="M5 4h4v16H5zM11 4h4v16h-4z"/><path d="m17 5 3.5 1-3.5 14-3.5-1z"/>',
  assets: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4 3 2.5 3-3 5 4.5"/>',
  player: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.6-5.6 7-5.6s6.2 1.8 7 5.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  perf: '<path d="M4 19V5M4 19h16"/><path d="m7 15 3.5-4 3 2.5L19 7"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.7M12 16.8v.2"/>',
  cog: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1.4 2.6a7 7 0 0 1 2 .8l2.8-.9 1.2 2.3-2 2.1a7 7 0 0 1 0 2.2l2 2.1-1.2 2.3-2.8-.9a7 7 0 0 1-2 .8L12 21.2l-1.4-2.6a7 7 0 0 1-2-.8l-2.8.9-1.2-2.3 2-2.1a7 7 0 0 1 0-2.2l-2-2.1 1.2-2.3 2.8.9a7 7 0 0 1 2-.8z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="m6 6 12 12M18 6 6 18"/>',
  power: '<path d="M12 3v8M7 6.5a7.5 7.5 0 1 0 10 0"/>', restore: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>', upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19.5h14"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>', mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>', globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
  blast: '<path d="m12 2.5 1.8 5.2 5.2-1.8-1.8 5.2 5.3 1.8-5.3 1.8 1.8 5.2-5.2-1.8L12 21.5l-1.8-5.3-5.2 1.8 1.8-5.2L1.5 11l5.3-1.8-1.8-5.2 5.2 1.8z" transform="translate(0 0) scale(.92) translate(1 1)"/>',
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  sheet: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name] ?? ICONS.cube; // static markup from ICONS only
  s.classList.add('ico');
  return s;
}

// ---- formatting
export const pad2 = (n) => String(n).padStart(2, '0');
export const fmtClock = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
export const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
export function fmtAgo(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  return hh ? `${hh} h ${mm} min` : mm ? `${mm} min` : `${sec} s`;
}
export const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '-');
export const prettify = (id) => String(id).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0', left: '-999px' }, 'aria-hidden': 'true' });
  document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* blocked */ }
  ta.remove(); return ok;
}

// ---- toasts
export function toast(text, kind = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast ${kind}` }, text);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6500 : 3200);
  while (box.children.length > 5) box.firstChild.remove();
}

// ---- modal dialogs (native <dialog>: focus trap + Escape for free)
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: `modal${wide ? ' wide' : ''}`, 'aria-label': title });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', on: { click: () => dlg.close() } }, icon('x', 16));
  dlg.append(h('header', { class: 'modal-head' }, h('h2', null, title), closeBtn), h('div', { class: 'modal-body' }, body));
  if (actions.length) dlg.append(h('footer', { class: 'modal-foot' }, actions));
  dlg.addEventListener('close', () => { try { onClose?.(); } finally { dlg.remove(); } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
export function confirmDialog({ title, text, confirm = 'Confirm', danger = false, detail }) {
  return new Promise((resolve) => {
    let answer = false;
    const yes = h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, type: 'button', on: { click: () => { answer = true; dlg.close(); } } }, confirm);
    const no = h('button', { class: 'btn ghost', type: 'button', autofocus: true, on: { click: () => dlg.close() } }, 'Cancel');
    const dlg = modal({ title, body: [h('p', null, text), detail ? h('p', { class: 'dim small' }, detail) : null], actions: [no, yes], onClose: () => resolve(answer) });
    no.focus();
  });
}

export function emptyState(title, text, extra) {
  return h('div', { class: 'empty' }, h('strong', null, title), text ? h('span', null, text) : null, extra);
}
export function card(title, ...kids) {
  return h('section', { class: 'card' }, title ? h('h2', { class: 'card-title' }, title) : null, ...kids);
}
