// core/menu.js - world.menu: the in-VR menu. A wrist launcher (raise your LEFT palm toward your face, or press left B / key M),
// seven panels (Summon, Spells, Quests, Chat, World, Settings + How to play) drawn on canvases mapped to planes, and a tiny
// retained-mode widget set so ANY creation can add its own panel. No DOM, nothing drawn while closed.
//
// AI-FACING API   const menu = ctx.world.menu; if (!menu) return {};            // always guard
//   ctx.onDispose(menu.register({ id: 'mine', title: 'My thing', icon: 'bolt', build(ui) { ... } }));   // adds a launcher button + panel
//   menu.open('summon'|'spells'|'quests'|'chat'|'world'|'settings'|'help'|<your id>)  menu.close()  menu.toggle()  menu.capturing (a hand ray is over the menu)
//   menu.isOpen / menu.panelTop (elevation of the open window's top edge): other overlays keep clear of an open panel (see hud.present in sys/hud.js).
//   The first-run welcome card asks hud.present for its turn; on a flat screen the window is sized to the viewport.
//   build(ui) is called again on every ui.refresh() (and about 4x/s while the panel is open if you give register() a sig() that returns a
//   changing value), so read live values inside get()/set() callbacks and just describe the page again. Content is 470 px wide, scrolls by itself.
//   ui.heading(text, { right? })  ui.text(str, { size = 13, color, bold, italic, align })  ui.gap(px)  ui.divider()
//   ui.row(() => { ...widgets side by side... }, { gap = 6 })   inside a row, widgets share the width (opts.flex = weight, opts.w = fixed px)
//   ui.button(label, onClick, { icon, kind: 'primary'|'danger'|'ghost', disabled, h = 38, id })   ui.chip(label, onClick, { active, icon, color })
//   ui.choice(['a','b'] | [{id,label}], () => current, (id) => set, { label })   ui.toggle(label, () => bool, (v) => set, { sub })
//   ui.slider(label, { min, max, step, get, set, fmt: (v) => 'text' })   ui.progress(label, value01, { text, color })
//   ui.tile({ title, sub, icon, color, active, badge, onClick, h = 48 })   ui.grid(items, { id, cols = 2, rows = 4, tile: (item) => tileOpts })  (paged)
//   ui.confirm(label, onConfirm, { text: 'Sure?' }) two-step danger button   ui.toast(text)   ui.refresh()   ui.state (persists per panel)   ui.close()
//   icon = a built-in name (summon bolt scroll chat globe gear help star clock skull shield paw sword house tree crate spark map plus minus
//   check back undo trash flag eye heart) or a single emoji / 1-2 letters. Colours are CSS strings or 0xRRGGBB numbers.
//   EXAMPLE
//     export default function (ctx) {
//       const menu = ctx.world.menu; let n = 0;
//       if (menu) ctx.onDispose(menu.register({ id: 'counter', title: 'Counter', icon: 'star', build(ui) {
//         ui.heading('Clicks'); ui.text(`You clicked ${n} times.`);
//         ui.row(() => { ui.button('Click me', () => { n++; ui.refresh(); }, { kind: 'primary' }); ui.button('Reset', () => { n = 0; ui.refresh(); }); });
//       } }));
//       return {};
//     }
// HOOKS for other modules: world.menu.capturing is true while a hand ray / fingertip is over a panel. This module ALSO masks that hand's
//   input.down.trigger (and squeeze while grabbing a title bar) at the input level, so spells.js / weapons.js do not fire through a panel
//   without any change; they may additionally check `if (ctx.world.menu?.capturing) return;`.
// OPERATING  controller ray + trigger, bare-hand pointing ray + index pinch, fingertip poke (index tip through the panel), desktop crosshair
//   or mouse. Squeeze (fist / middle pinch) on a title bar moves the panel. Summoned things belong to this module (session only).
// Persistence: settings, favourites, recents and the chat log live in localStorage (omni.menu.*) and are re-applied when the owning module reloads.

import { UI } from '/sys/hud.js';  // shared palette / type scale (stable core: the same module instance boot.js loaded)

const MPP = 0.0012;            // metres per logical pixel (1.2 mm; 0.5 m panel = ~417 px)
const SCALE = 2;               // canvas backing store = 2x the logical size
const MIN_UPLOAD_MS = 66;      // <= 15 texture uploads per second per surface
const FONT = UI.font;
const EMOJI_FONT = UI.emojiFont;
const LS = { settings: 'omni.menu.settings.v1', chat: 'omni.menu.chat.v1', meta: 'omni.menu.meta.v1' };

const C = UI.color;
const FACTION = { enemy: '#ff7a6b', friendly: '#7fe3a0', neutral: '#e6d9a8' };
const CAT = {
  enemies: { color: '#ff7a6b', icon: 'skull', label: 'Enemies' }, allies: { color: '#7fe3a0', icon: 'shield', label: 'Allies' },
  life: { color: '#ffd877', icon: 'paw', label: 'Life' }, weapons: { color: '#a8c4ff', icon: 'sword', label: 'Weapons' },
  structures: { color: '#e2b98a', icon: 'house', label: 'Structures' }, nature: { color: '#8fe08a', icon: 'tree', label: 'Nature' },
  props: { color: '#ffb454', icon: 'crate', label: 'Props' }, effects: { color: '#c79bff', icon: 'spark', label: 'Effects' },
  scenarios: { color: '#ffe08a', icon: 'map', label: 'Scenarios' }, custom: { color: '#9fe0ff', icon: 'star', label: 'Custom' },
};
const CAT_ORDER = ['enemies', 'allies', 'life', 'weapons', 'structures', 'nature', 'props', 'effects', 'scenarios'];

// ---------------------------------------------------------------------------------------------- small helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get(k, d) { try { const s = globalThis.localStorage?.getItem(k); return s ? JSON.parse(s) : d; } catch { return d; } },
  set(k, v) { try { globalThis.localStorage?.setItem(k, JSON.stringify(v)); } catch { /* private mode / quota */ } },
};
const css = (c) => (typeof c === 'number' ? '#' + (c & 0xffffff).toString(16).padStart(6, '0') : (c || C.text));
const font = (px, weight = 500, style = '') => `${style ? style + ' ' : ''}${weight} ${px}px ${FONT}`;
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (m) => m.toUpperCase());

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const wrapCache = new Map();
function wrapText(g, text, maxW, fnt) {
  const key = fnt + '|' + maxW + '|' + text;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  g.font = fnt;
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? line + ' ' + word : word;
      if (line && g.measureText(trial).width > maxW) { out.push(line); line = word; } else line = trial;
      while (g.measureText(line).width > maxW && line.length > 1) { // one very long word
        let n = line.length - 1;
        while (n > 1 && g.measureText(line.slice(0, n)).width > maxW) n--;
        out.push(line.slice(0, n)); line = line.slice(n);
      }
    }
    out.push(line);
  }
  if (wrapCache.size > 600) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}
function fit(g, text, maxW, fnt) { // single line with an ellipsis
  g.font = fnt;
  text = String(text);
  if (g.measureText(text).width <= maxW) return text;
  let n = text.length;
  while (n > 1 && g.measureText(text.slice(0, n) + '…').width > maxW) n--;
  return text.slice(0, n).trimEnd() + '…';
}

// ---------------------------------------------------------------------------------------------- vector icons
// Each icon draws into a box of half-size r centred on (x, y); the caller set strokeStyle / fillStyle / lineWidth.
const dot = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const line = (g, ...p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
const poly = (g, pts, fill) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); fill ? g.fill() : g.stroke(); };
const ICON = {
  summon(g, x, y, r) {
    const k = r * 0.26;
    g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x + k, y - k, x + r, y); g.quadraticCurveTo(x + k, y + k, x, y + r);
    g.quadraticCurveTo(x - k, y + k, x - r, y); g.quadraticCurveTo(x - k, y - k, x, y - r); g.closePath(); g.fill();
    dot(g, x + r * 0.72, y - r * 0.72, r * 0.15); dot(g, x - r * 0.78, y + r * 0.66, r * 0.11);
  },
  bolt(g, x, y, r) { poly(g, [x + r * 0.25, y - r, x - r * 0.55, y + r * 0.1, x - r * 0.02, y + r * 0.1, x - r * 0.3, y + r, x + r * 0.6, y - r * 0.2, x + r * 0.05, y - r * 0.2], true); },
  scroll(g, x, y, r) {
    rr(g, x - r * 0.62, y - r * 0.85, r * 1.24, r * 1.7, r * 0.2); g.stroke();
    line(g, x - r * 0.3, y - r * 0.4, x + r * 0.3, y - r * 0.4); line(g, x - r * 0.3, y, x + r * 0.3, y); line(g, x - r * 0.3, y + r * 0.4, x + r * 0.1, y + r * 0.4);
  },
  chat(g, x, y, r) {
    rr(g, x - r * 0.95, y - r * 0.75, r * 1.9, r * 1.3, r * 0.35); g.stroke();
    poly(g, [x - r * 0.35, y + r * 0.5, x - r * 0.55, y + r * 0.98, x + r * 0.1, y + r * 0.5], true);
    dot(g, x - r * 0.4, y - r * 0.1, r * 0.1); dot(g, x, y - r * 0.1, r * 0.1); dot(g, x + r * 0.4, y - r * 0.1, r * 0.1);
  },
  globe(g, x, y, r) {
    g.beginPath(); g.arc(x, y, r * 0.9, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(x, y, r * 0.42, r * 0.9, 0, 0, Math.PI * 2); g.stroke();
    line(g, x - r * 0.9, y, x + r * 0.9, y); line(g, x - r * 0.72, y - r * 0.45, x + r * 0.72, y - r * 0.45); line(g, x - r * 0.72, y + r * 0.45, x + r * 0.72, y + r * 0.45);
  },
  gear(g, x, y, r) {
    const n = 8; g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a0 = (i / (n * 2)) * Math.PI * 2 - Math.PI / (n * 2) * 0.5, rad = i % 2 ? r * 0.68 : r * 0.95;
      const a1 = a0 + (Math.PI * 2 / (n * 2)) * 0.62;
      g.lineTo(x + Math.cos(a0) * rad, y + Math.sin(a0) * rad); g.lineTo(x + Math.cos(a1) * rad, y + Math.sin(a1) * rad);
    }
    g.closePath(); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.stroke();
  },
  help(g, x, y, r) { g.font = font(r * 1.7, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', x, y + r * 0.06); },
  close(g, x, y, r) { line(g, x - r * 0.6, y - r * 0.6, x + r * 0.6, y + r * 0.6); line(g, x + r * 0.6, y - r * 0.6, x - r * 0.6, y + r * 0.6); },
  plus(g, x, y, r) { line(g, x - r * 0.7, y, x + r * 0.7, y); line(g, x, y - r * 0.7, x, y + r * 0.7); },
  minus(g, x, y, r) { line(g, x - r * 0.7, y, x + r * 0.7, y); },
  check(g, x, y, r) { line(g, x - r * 0.7, y + r * 0.05, x - r * 0.2, y + r * 0.55, x + r * 0.75, y - r * 0.5); },
  back(g, x, y, r) { line(g, x + r * 0.5, y - r * 0.75, x - r * 0.4, y, x + r * 0.5, y + r * 0.75); },
  next(g, x, y, r) { line(g, x - r * 0.5, y - r * 0.75, x + r * 0.4, y, x - r * 0.5, y + r * 0.75); },
  up(g, x, y, r) { line(g, x - r * 0.75, y + r * 0.4, x, y - r * 0.45, x + r * 0.75, y + r * 0.4); },
  down(g, x, y, r) { line(g, x - r * 0.75, y - r * 0.4, x, y + r * 0.45, x + r * 0.75, y - r * 0.4); },
  star(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.42 : r; g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    g.closePath(); g.fill();
  },
  heart(g, x, y, r) {
    g.beginPath(); g.moveTo(x, y + r * 0.85);
    g.bezierCurveTo(x - r * 1.3, y, x - r * 0.9, y - r * 0.95, x, y - r * 0.35);
    g.bezierCurveTo(x + r * 0.9, y - r * 0.95, x + r * 1.3, y, x, y + r * 0.85); g.fill();
  },
  clock(g, x, y, r) { g.beginPath(); g.arc(x, y, r * 0.9, 0, Math.PI * 2); g.stroke(); line(g, x, y - r * 0.55, x, y, x + r * 0.4, y + r * 0.25); },
  eye(g, x, y, r) {
    g.beginPath(); g.moveTo(x - r, y); g.quadraticCurveTo(x, y - r * 1.1, x + r, y); g.quadraticCurveTo(x, y + r * 1.1, x - r, y); g.stroke(); dot(g, x, y, r * 0.3);
  },
  skull(g, x, y, r) {
    g.beginPath(); g.arc(x, y - r * 0.12, r * 0.78, Math.PI * 0.95, Math.PI * 0.05); g.lineTo(x + r * 0.45, y + r * 0.85); g.lineTo(x - r * 0.45, y + r * 0.85); g.closePath(); g.stroke();
    dot(g, x - r * 0.3, y - r * 0.1, r * 0.2); dot(g, x + r * 0.3, y - r * 0.1, r * 0.2); line(g, x - r * 0.15, y + r * 0.85, x - r * 0.15, y + r * 0.5); line(g, x + r * 0.15, y + r * 0.85, x + r * 0.15, y + r * 0.5);
  },
  shield(g, x, y, r) {
    g.beginPath(); g.moveTo(x - r * 0.8, y - r * 0.8); g.lineTo(x + r * 0.8, y - r * 0.8); g.lineTo(x + r * 0.8, y + r * 0.1);
    g.quadraticCurveTo(x + r * 0.7, y + r * 0.7, x, y + r); g.quadraticCurveTo(x - r * 0.7, y + r * 0.7, x - r * 0.8, y + r * 0.1); g.closePath(); g.stroke(); line(g, x, y - r * 0.8, x, y + r * 0.85);
  },
  paw(g, x, y, r) {
    dot(g, x, y + r * 0.3, r * 0.45); dot(g, x - r * 0.65, y - r * 0.15, r * 0.2); dot(g, x - r * 0.25, y - r * 0.65, r * 0.2); dot(g, x + r * 0.25, y - r * 0.65, r * 0.2); dot(g, x + r * 0.65, y - r * 0.15, r * 0.2);
  },
  sword(g, x, y, r) {
    g.save(); g.lineWidth *= 1.5; line(g, x - r * 0.15, y + r * 0.15, x + r * 0.78, y - r * 0.78); g.restore();
    poly(g, [x + r * 0.62, y - r * 1.0, x + r * 1.0, y - r * 1.0, x + r * 1.0, y - r * 0.62], true);
    line(g, x - r * 0.62, y - r * 0.12, x + r * 0.12, y + r * 0.62);
    line(g, x - r * 0.4, y + r * 0.4, x - r * 0.78, y + r * 0.78); dot(g, x - r * 0.86, y + r * 0.86, r * 0.13);
  },  house(g, x, y, r) { poly(g, [x - r * 0.9, y + r * 0.8, x - r * 0.9, y - r * 0.1, x, y - r * 0.9, x + r * 0.9, y - r * 0.1, x + r * 0.9, y + r * 0.8]); line(g, x - r * 0.25, y + r * 0.8, x - r * 0.25, y + r * 0.25, x + r * 0.25, y + r * 0.25, x + r * 0.25, y + r * 0.8); },
  tree(g, x, y, r) { poly(g, [x, y - r, x + r * 0.7, y + r * 0.3, x - r * 0.7, y + r * 0.3]); line(g, x, y + r * 0.3, x, y + r * 0.95); line(g, x - r * 0.3, y - r * 0.1, x + r * 0.3, y - r * 0.1); },
  crate(g, x, y, r) { rr(g, x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6, r * 0.12); g.stroke(); line(g, x - r * 0.8, y - r * 0.8, x + r * 0.8, y + r * 0.8); line(g, x + r * 0.8, y - r * 0.8, x - r * 0.8, y + r * 0.8); },
  spark(g, x, y, r) {
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2, l0 = r * 0.3, l1 = r * (i % 2 ? 0.7 : 0.98); line(g, x + Math.cos(a) * l0, y + Math.sin(a) * l0, x + Math.cos(a) * l1, y + Math.sin(a) * l1); }
    dot(g, x, y, r * 0.16);
  },  map(g, x, y, r) { poly(g, [x - r * 0.95, y - r * 0.6, x - r * 0.3, y - r * 0.85, x + r * 0.3, y - r * 0.6, x + r * 0.95, y - r * 0.85, x + r * 0.95, y + r * 0.6, x + r * 0.3, y + r * 0.85, x - r * 0.3, y + r * 0.6, x - r * 0.95, y + r * 0.85]); line(g, x - r * 0.3, y - r * 0.85, x - r * 0.3, y + r * 0.6); line(g, x + r * 0.3, y - r * 0.6, x + r * 0.3, y + r * 0.85); },
  flag(g, x, y, r) { line(g, x - r * 0.65, y + r * 0.95, x - r * 0.65, y - r * 0.95); poly(g, [x - r * 0.65, y - r * 0.9, x + r * 0.8, y - r * 0.5, x - r * 0.65, y + r * 0.0], true); },
  undo(g, x, y, r) { g.beginPath(); g.arc(x + r * 0.05, y + r * 0.1, r * 0.7, Math.PI * 1.15, Math.PI * 0.6, false); g.stroke(); poly(g, [x - r * 0.95, y - r * 0.25, x - r * 0.1, y - r * 0.85, x - r * 0.15, y + r * 0.2], true); },
  trash(g, x, y, r) { line(g, x - r * 0.85, y - r * 0.55, x + r * 0.85, y - r * 0.55); line(g, x - r * 0.3, y - r * 0.55, x - r * 0.3, y - r * 0.9, x + r * 0.3, y - r * 0.9, x + r * 0.3, y - r * 0.55); poly(g, [x - r * 0.65, y - r * 0.3, x - r * 0.5, y + r * 0.9, x + r * 0.5, y + r * 0.9, x + r * 0.65, y - r * 0.3]); },
  mic(g, x, y, r) { rr(g, x - r * 0.3, y - r * 0.9, r * 0.6, r * 1.1, r * 0.3); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.55, 0, Math.PI); g.stroke(); line(g, x, y + r * 0.55, x, y + r * 0.9); },
};
function drawIcon(g, name, x, y, r, color) {
  g.save();
  g.strokeStyle = g.fillStyle = css(color);
  g.lineWidth = Math.max(1.5, r * 0.16); g.lineCap = g.lineJoin = 'round';
  const fn = ICON[name];
  if (fn) fn(g, x, y, r);
  else if (name) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const s = String(name);
    const emoji = s.length > 2 || /[^\u0000-⹿]/.test(s);
    g.font = emoji ? `${Math.round(r * 1.5)}px ${EMOJI_FONT}` : font(Math.round(r * 1.25), 700);
    g.fillText(s, x, y + r * 0.06);
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------- canvas surface (one plane, one draw call)
function createSurface(THREE, o) {
  const { id, mpp = MPP, order = 9000, draw } = o;
  let w = o.w, h = o.h;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * SCALE); canvas.height = Math.round(h * SCALE);
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false, toneMapped: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * mpp, h * mpp), mat);
  mesh.name = 'menu:' + id; mesh.renderOrder = order; mesh.userData.noShadow = true; mesh.userData.noOutline = true;
  const group = new THREE.Group();
  group.name = 'menu-group:' + id; group.visible = false;
  group.add(mesh);
  const inv = new THREE.Matrix4();
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  const surf = {
    id, group, mesh, mat, tex, canvas, g, inv, mpp, hoverKey: null, pressKey: null, dirty: 'full', lastUpload: -1e9, uploads: 0, draws: 0,
    get w() { return w; }, get h() { return h; },
    get visible() { return group.visible; },
    resize(nw, nh) {
      w = nw; h = nh; canvas.width = Math.round(w * SCALE); canvas.height = Math.round(h * SCALE);
      mesh.geometry.dispose(); mesh.geometry = new THREE.PlaneGeometry(w * mpp, h * mpp); surf.dirty = 'full';
    },
    invalidate(r) {
      if (!r || surf.dirty === 'full') { surf.dirty = 'full'; return; }
      const x0 = Math.max(0, Math.floor(r.x) - 3), y0 = Math.max(0, Math.floor(r.y) - 3);
      const x1 = Math.min(w, Math.ceil(r.x + r.w) + 3), y1 = Math.min(h, Math.ceil(r.y + r.h) + 3);
      const d = surf.dirty;
      surf.dirty = d ? { x: Math.min(d.x, x0), y: Math.min(d.y, y0), w: Math.max(d.x + d.w, x1) - Math.min(d.x, x0), h: Math.max(d.y + d.h, y1) - Math.min(d.y, y0) } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    // Redraws what is dirty (clipped to the dirty rectangle) and uploads, at most 15 times a second.
    flush(nowMs, force) {
      if (!surf.dirty || !group.visible) return false;
      if (!force && nowMs - surf.lastUpload < MIN_UPLOAD_MS) return false;
      const r = surf.dirty === 'full' ? null : surf.dirty;
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      g.save();
      g.beginPath();
      if (r) g.rect(r.x, r.y, r.w, r.h); else g.rect(0, 0, w, h);
      g.clip();
      g.clearRect(r ? r.x : 0, r ? r.y : 0, r ? r.w : w, r ? r.h : h);
      try { draw(g, r); } catch (err) { console.warn('[menu] draw failed', id, err); }
      g.restore();
      tex.needsUpdate = true; surf.dirty = null; surf.lastUpload = nowMs; surf.uploads++; surf.draws++;
      return true;
    },
    updatePose() { group.updateMatrixWorld(true); inv.copy(mesh.matrixWorld).invert(); },
    // Ray (origin o, direction d, world) against the plane -> distance t (or -1); writes px/py (logical px) into out.
    rayHit(ro, rd, out, margin = 0) {
      _o.copy(ro).applyMatrix4(inv); _d.copy(rd).transformDirection(inv);
      if (_d.z >= -1e-4 || _o.z < -0.002) return -1;
      const t = -_o.z / _d.z;
      const px = (_o.x + _d.x * t) / mpp + w / 2, py = h / 2 - (_o.y + _d.y * t) / mpp;
      if (px < -margin || px > w + margin || py < -margin || py > h + margin) return -1;
      out.x = px; out.y = py; out.t = t;
      return t;
    },
    // World point -> panel px, plus signed depth in metres (positive = in front of the face).
    pointLocal(p, out) {
      _o.copy(p).applyMatrix4(inv);
      out.x = _o.x / mpp + w / 2; out.y = h / 2 - _o.y / mpp; out.z = _o.z;
      return out;
    },
    dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
  return surf;
}

// ---------------------------------------------------------------------------------------------- widget painting
const INERT = new Set(['text', 'heading', 'divider', 'none', 'lines0']);
const isInteractive = (wd) => !INERT.has(wd.type) && !wd.disabled && !wd.static;

function plate(g, x, y, w, h, r, hot, down, tone) {
  const inset = down ? 1.5 : 0;
  rr(g, x + inset, y + inset, w - inset * 2, h - inset * 2, r);
  g.fillStyle = down ? C.fillDown : hot ? C.fillHot : (tone || C.fill);
  g.fill();
  g.lineWidth = hot || down ? 1.6 : 1;
  g.strokeStyle = hot || down ? C.gold : C.line;
  g.stroke();
}

const DRAW = {
  heading(g, wd) {
    g.font = font(12, 700); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = C.gold; g.fillText(wd.label.toUpperCase().split('').join(' '), wd.x, wd.y + 10);
    const tw = g.measureText(wd.label.toUpperCase().split('').join(' ')).width;
    g.fillStyle = C.line; g.fillRect(wd.x + tw + 10, wd.y + 10, Math.max(0, wd.w - tw - 10 - (wd.right ? g.measureText(wd.right).width + 10 : 0)), 1);
    if (wd.right) { g.font = font(12, 500); g.textAlign = 'right'; g.fillStyle = C.dim; g.fillText(wd.right, wd.x + wd.w, wd.y + 10); }
  },
  text(g, wd) {
    g.font = wd.fnt; g.fillStyle = css(wd.color); g.textBaseline = 'middle';
    g.textAlign = wd.align === 'center' ? 'center' : wd.align === 'right' ? 'right' : 'left';
    const x = wd.align === 'center' ? wd.x + wd.w / 2 : wd.align === 'right' ? wd.x + wd.w : wd.x;
    for (let i = 0; i < wd.lines.length; i++) g.fillText(wd.lines[i], x, wd.y + wd.lh * (i + 0.5) + 1);
  },
  divider(g, wd) { g.fillStyle = C.line; g.fillRect(wd.x, wd.y + 4, wd.w, 1); },
  none() {},
  button(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    const k = wd.kind;
    if (k === 'primary' && !wd.disabled) {
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, down ? '#e0b24e' : hot ? '#fff0b8' : '#ffe08a'); gr.addColorStop(1, down ? '#b9822a' : hot ? '#f0b94d' : '#e0a73f');
      rr(g, x, y, w, h, 12); g.fillStyle = gr; g.fill();
      if (hot) { g.lineWidth = 2; g.strokeStyle = '#fff6d6'; g.stroke(); }
    } else if (k === 'danger') {
      rr(g, x, y, w, h, 12); g.fillStyle = down ? 'rgba(255,122,107,0.5)' : hot ? 'rgba(255,122,107,0.32)' : 'rgba(255,122,107,0.16)'; g.fill();
      g.lineWidth = hot ? 1.8 : 1; g.strokeStyle = hot ? '#ffb0a5' : 'rgba(255,122,107,0.55)'; g.stroke();
    } else {
      plate(g, x, y, w, h, 12, hot && !wd.disabled, down && !wd.disabled, k === 'ghost' ? 'rgba(255,255,255,0.025)' : null);
    }
    const col = wd.disabled ? C.faint : k === 'primary' ? C.goldDark : k === 'danger' ? (hot ? '#fff' : '#ffb0a5') : hot ? C.gold : C.text;
    g.textBaseline = 'middle';
    g.font = font(14, 600);
    const lw = wd.label ? g.measureText(fit(g, wd.label, w - (wd.icon ? 52 : 20), font(14, 600))).width : 0;
    const iw = wd.icon ? 18 : 0, gapw = wd.icon && wd.label ? 7 : 0;
    let cx = x + w / 2 - (lw + iw + gapw) / 2;
    if (wd.icon) { drawIcon(g, wd.icon, cx + 9, y + h / 2, 9, col); cx += iw + gapw; }
    if (wd.label) { g.fillStyle = col; g.textAlign = 'left'; g.font = font(14, 600); g.fillText(fit(g, wd.label, w - (wd.icon ? 52 : 20), font(14, 600)), cx, y + h / 2 + 1); }
  },
  chip(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    const col = wd.color ? css(wd.color) : C.gold;
    rr(g, x + (down ? 1 : 0), y + (down ? 1 : 0), w - (down ? 2 : 0), h - (down ? 2 : 0), Math.min(14, h / 2));
    g.fillStyle = down ? C.fillDown : wd.active ? 'rgba(255,216,119,0.2)' : hot ? C.fillHot : C.fill; g.fill();
    g.lineWidth = wd.active || hot ? 1.8 : 1; g.strokeStyle = wd.active ? col : hot ? C.gold : C.line; g.stroke();
    const tc = wd.active ? col : hot ? C.gold : C.dim;
    g.textBaseline = 'middle';
    if (wd.icon && !wd.label) { drawIcon(g, wd.icon, x + w / 2, y + h / 2, Math.min(w, h) * 0.3, tc); return; }
    const fnt = font(13, wd.active ? 700 : 600);
    const txt = fit(g, wd.label, w - (wd.icon ? 40 : 14), fnt);
    g.font = fnt; const tw = g.measureText(txt).width, iw = wd.icon ? 16 + 5 : 0;
    let cx = x + w / 2 - (tw + iw) / 2;
    if (wd.icon) { drawIcon(g, wd.icon, cx + 8, y + h / 2, 8, tc); cx += iw; }
    g.fillStyle = tc; g.textAlign = 'left'; g.fillText(txt, cx, y + h / 2 + 1);
  },
  tab(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    rr(g, x, y, w, h, 12);
    g.fillStyle = wd.active ? 'rgba(255,216,119,0.17)' : down ? C.fillDown : hot ? C.fillHot : 'rgba(255,255,255,0.03)'; g.fill();
    if (hot && !wd.active) { g.lineWidth = 1.4; g.strokeStyle = C.gold; g.stroke(); }
    if (wd.active) { rr(g, x + 1, y + 9, 3.5, h - 18, 2); g.fillStyle = C.gold; g.fill(); }
    drawIcon(g, wd.icon, x + w / 2 + 1, y + h / 2, 11.5, wd.active ? C.gold : hot ? '#fff1c4' : C.dim);
  },
  iconbtn(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    rr(g, x, y, w, h, h / 2);
    g.fillStyle = down ? 'rgba(255,122,107,0.55)' : hot ? 'rgba(255,122,107,0.35)' : 'rgba(255,255,255,0.07)'; g.fill();
    drawIcon(g, wd.icon, x + w / 2, y + h / 2, 7, hot ? '#fff' : C.dim);
  },
  toggle(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    plate(g, x, y, w, h, 12, hot, down);
    const on = !!wd.get();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = font(14, 600); g.fillStyle = hot ? C.gold : C.text;
    g.fillText(fit(g, wd.label, w - 90, font(14, 600)), x + 14, y + (wd.sub ? h * 0.36 : h / 2) + 1);
    if (wd.sub) { g.font = font(12, 500); g.fillStyle = C.dim; g.fillText(fit(g, wd.sub, w - 90, font(12, 500)), x + 14, y + h * 0.7); }
    const sw = 42, sh = 22, sx = x + w - sw - 14, sy = y + h / 2 - sh / 2;
    rr(g, sx, sy, sw, sh, sh / 2); g.fillStyle = on ? C.gold2 : 'rgba(255,255,255,0.14)'; g.fill();
    dot2(g, sx + (on ? sw - sh / 2 : sh / 2), sy + sh / 2, sh / 2 - 3, on ? '#fff6d6' : '#aab0dc');
  },
  slider(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    plate(g, x, y, w, h, 12, hot && !down, false);
    const v = wd.cur ?? wd.get();
    const t = clamp((v - wd.min) / (wd.max - wd.min || 1), 0, 1);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = font(14, 600); g.fillStyle = hot ? C.gold : C.text;
    g.fillText(fit(g, wd.label, w - 120, font(14, 600)), x + 14, y + 15);
    g.textAlign = 'right'; g.font = font(13, 700); g.fillStyle = C.gold;
    g.fillText(wd.fmt ? wd.fmt(v) : String(Math.round(v * 100) / 100), x + w - 14, y + 15);
    const tx = x + 16, tw = w - 32, ty = y + h - 15;
    rr(g, tx, ty - 3, tw, 6, 3); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fill();
    rr(g, tx, ty - 3, Math.max(6, tw * t), 6, 3); g.fillStyle = C.gold2; g.fill();
    dot2(g, tx + tw * t, ty, down ? 10 : hot ? 9 : 8, down ? '#fff' : '#fff0c0', true);
  },
  progress(g, wd) {
    const { x, y, w } = wd;
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = font(13, 600); g.fillStyle = C.text;
    g.fillText(fit(g, wd.label, w - 110, font(13, 600)), x, y + 9);
    g.textAlign = 'right'; g.font = font(12, 600); g.fillStyle = C.dim; g.fillText(wd.text ?? '', x + w, y + 9);
    rr(g, x, y + 22, w, 8, 4); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
    const t = clamp(wd.value, 0, 1);
    if (t > 0) { rr(g, x, y + 22, Math.max(8, w * t), 8, 4); g.fillStyle = css(wd.color || C.gold2); g.fill(); }
  },
  tile(g, wd, hot, down) {
    const { x, y, w, h } = wd;
    const col = css(wd.color || C.gold);
    rr(g, x + (down ? 1 : 0), y + (down ? 1 : 0), w - (down ? 2 : 0), h - (down ? 2 : 0), 12);
    g.fillStyle = down ? C.fillDown : wd.active ? 'rgba(255,216,119,0.16)' : hot ? C.fillHot : C.fill; g.fill();
    g.lineWidth = hot || wd.active ? 1.8 : 1; g.strokeStyle = wd.active ? col : hot ? C.gold : C.line; g.stroke();
    const d = Math.min(h - 14, 34), cx = x + 10 + d / 2, cy = y + h / 2;
    g.beginPath(); g.arc(cx, cy, d / 2, 0, Math.PI * 2); g.fillStyle = 'rgba(8,9,30,0.55)'; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = col; g.stroke();
    if (wd.icon) drawIcon(g, wd.icon, cx, cy, d * 0.31, col);
    const tx = x + 10 + d + 9, mw = w - (tx - x) - (wd.badge ? 26 : 10);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = font(14, 600); g.fillStyle = hot ? C.gold : C.text;
    if (wd.wrap && wd.sub) {
      g.fillText(fit(g, wd.title, mw, font(15, 700)), tx, y + 17);
      const ls = wrapText(g, wd.sub, mw, font(12.5, 500)).slice(0, 3);
      g.font = font(12.5, 500); g.fillStyle = C.dim;
      ls.forEach((l, i) => g.fillText(l, tx, y + 36 + i * 16));
    } else {
      g.fillText(fit(g, wd.title, mw, font(14, 600)), tx, y + (wd.sub ? h * 0.35 : h / 2) + 1);
      if (wd.sub) { g.font = font(12, 500); g.fillStyle = C.dim; g.fillText(fit(g, wd.sub, mw, font(12, 500)), tx, y + h * 0.71); }
    }
    if (wd.badge) drawIcon(g, wd.badge, x + w - 17, y + 16, 7, C.gold);
  },
  lines(g, wd) {
    const { x, y, w, h } = wd;
    rr(g, x, y, w, h, 12); g.fillStyle = 'rgba(4,5,20,0.45)'; g.fill(); g.lineWidth = 1; g.strokeStyle = C.line; g.stroke();
    g.save(); rr(g, x + 1, y + 1, w - 2, h - 2, 11); g.clip();
    const sc = wd.holder.scroll;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const L of wd.lines) {
      if (L.y + L.h < sc - 2 || L.y > sc + h + 2) continue;
      const yy = y + 8 + L.y - sc;
      if (L.k === 'hdr') {
        g.font = font(12, 700); g.fillStyle = L.color; g.fillText(L.name, x + 12, yy + L.h / 2);
        const nw = g.measureText(L.name).width;
        g.font = font(11, 500); g.fillStyle = C.faint; g.fillText(L.time, x + 12 + nw + 8, yy + L.h / 2);
      } else { g.font = font(13, 500, L.italic ? 'italic' : ''); g.fillStyle = L.color; g.fillText(L.text, x + 12, yy + L.h / 2); }
    }
    g.restore();
    if (wd.total > h) { // scrollbar
      const th = Math.max(24, (h - 12) * (h / wd.total)), ty = y + 6 + ((h - 12 - th) * sc) / Math.max(1, wd.total - h);
      rr(g, x + w - 7, ty, 4, th, 2); g.fillStyle = 'rgba(255,216,119,0.55)'; g.fill();
    }
  },
};
function dot2(g, x, y, r, color, ring) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  if (ring) { g.lineWidth = 1.5; g.strokeStyle = C.gold2; g.stroke(); }
}

// ---------------------------------------------------------------------------------------------- retained-mode page builder (the `ui` object)
function createBuilder(W, g, hooks) {
  const widgets = [];
  const seen = {};
  const GAP = 6;
  let y = 0, row = null;
  const state = hooks.state;
  state.pages ??= {}; state.armed ??= {};

  function add(type, o, layout) {
    const id = o.id ?? o.label ?? o.title ?? type;
    const k = type + '|' + id;
    seen[k] = (seen[k] || 0) + 1;
    const wd = { type, key: k + '|' + seen[k], x: 0, y: 0, w: 0, h: o.h ?? 0, ...o, _layout: layout };
    wd.fixedW = o.w; wd.w = 0;
    if (row) row.items.push(wd);
    else { wd.x = 0; wd.y = y; wd.w = W; if (layout) layout(wd, W); widgets.push(wd); y += wd.h + GAP; }
    return wd;
  }
  const textLayout = (wd, w) => {
    wd.lines = wrapText(g, wd.label, w, wd.fnt); wd.lh = Math.round(wd.size * 1.38); wd.h = wd.lines.length * wd.lh + (wd.pad ?? 0);
  };
  const fixedH = (h) => (wd) => { wd.h = wd.h || h; };

  const ui = {
    w: W, state, ctx: hooks.ctx,
    refresh: () => hooks.refresh(),
    close: () => hooks.close(),
    toast: (t) => hooks.toast(t),
    gap(n = 8) { if (!row) y += n; },
    divider() { add('divider', { h: 9 }); },
    heading(label, o = {}) { add('heading', { label: String(label), right: o.right, id: label }, fixedH(22)); },
    text(label, o = {}) {
      const size = o.size ?? 13;
      add('text', { label: String(label ?? ''), size, color: o.color ?? C.text, align: o.align, pad: o.pad, id: String(label).slice(0, 24), w: o.w,
        fnt: font(size, o.bold ? 700 : 500, o.italic ? 'italic' : ''), flex: o.flex }, textLayout);
    },
    spacer(flex = 1) { add('none', { flex, id: 'sp' }, fixedH(1)); },
    row(fn, o = {}) {
      if (row) { fn(); return; }
      row = { items: [], gap: o.gap ?? 6 };
      try { fn(); } finally { /* keep the page usable even if a callback throws */ }
      const r = row; row = null;
      if (!r.items.length) return;
      let fixed = 0, flex = 0;
      for (const wd of r.items) { if (wd.fixedW) fixed += wd.fixedW; else flex += wd.flex ?? 1; }
      const avail = W - r.gap * (r.items.length - 1) - fixed;
      let x = 0, h = 0;
      for (const wd of r.items) {
        wd.w = wd.fixedW ?? Math.floor((avail * (wd.flex ?? 1)) / (flex || 1));
        wd.x = x; x += wd.w + r.gap;
        if (wd._layout) wd._layout(wd, wd.w);
        h = Math.max(h, wd.h);
      }
      for (const wd of r.items) {
        wd.y = y;
        if (wd.type !== 'text' && wd.type !== 'none') wd.h = h; else if (wd.type === 'text') wd.y = y + Math.max(0, Math.floor((h - wd.h) / 2));
        widgets.push(wd);
      }
      y += h + GAP;
    },
    button(label, onClick, o = {}) { return add('button', { label: String(label), onClick, kind: o.kind, icon: o.icon, disabled: o.disabled, h: o.h ?? 38, w: o.w, flex: o.flex, id: o.id, hint: o.hint }, fixedH(38)); },
    chip(label, onClick, o = {}) { return add('chip', { label: String(label ?? ''), onClick, active: o.active, icon: o.icon, color: o.color, disabled: o.disabled, h: o.h ?? 32, w: o.w, flex: o.flex, id: o.id ?? label ?? o.icon, hint: o.hint }, fixedH(32)); },
    tile(o) { return add('tile', { ...o, title: String(o.title ?? ''), h: o.h ?? 48, id: o.id ?? o.title, flex: o.flex }, fixedH(48)); },
    toggle(label, get, set, o = {}) { return add('toggle', { label, get, onClick: () => { set(!get()); hooks.dirtyWidget?.(); }, sub: o.sub, h: o.sub ? 48 : 38, disabled: o.disabled, flex: o.flex, w: o.w, id: label }, fixedH(38)); },
    slider(label, o) {
      return add('slider', { label, min: o.min ?? 0, max: o.max ?? 1, step: o.step ?? 0.01, get: o.get, set: o.set, fmt: o.fmt, h: 46, id: label, slider: true, disabled: o.disabled, flex: o.flex, w: o.w, cur: undefined }, fixedH(46));
    },
    progress(label, value, o = {}) { return add('progress', { label: String(label), value: +value || 0, text: o.text, color: o.color, h: 34, id: label }, fixedH(34)); },
    choice(options, get, set, o = {}) {
      const opts = options.map((v) => (typeof v === 'object' ? v : { id: v, label: titleCase(v) }));
      const cur = get();
      const build = () => {
        for (const op of opts) ui.chip(op.label, () => { set(op.id); hooks.refresh(); }, { active: String(op.id) === String(cur), flex: 1, id: (o.label ?? '') + op.id, disabled: o.disabled, icon: op.icon });
      };
      if (o.label && opts.length <= 4) {
        ui.row(() => { ui.text(o.label, { w: 128, bold: true, size: 14 }); build(); }, { gap: 6 });
      } else {
        if (o.label) ui.text(o.label, { bold: true, size: 14, color: C.text, pad: 2 });
        ui.row(build, { gap: 5 });
      }
    },
    // two-step danger button: first press arms it for 4 s, second press runs it
    confirm(label, onConfirm, o = {}) {
      const id = o.id ?? label;
      const armed = (state.armed[id] ?? 0) > hooks.now();
      if (!armed) { ui.button(label, () => { state.armed[id] = hooks.now() + 4000; hooks.refresh(); hooks.later(4100); }, { kind: o.kind ?? 'danger', icon: o.icon, id, flex: o.flex, w: o.w }); return; }
      ui.row(() => {
        ui.text(o.text ?? 'Are you sure?', { bold: true, color: C.warn, size: 13, flex: 1.2 });
        ui.button('Yes', () => { state.armed[id] = 0; hooks.refresh(); onConfirm(); }, { kind: 'danger', id: id + '-yes', flex: 1 });
        ui.button('Cancel', () => { state.armed[id] = 0; hooks.refresh(); }, { kind: 'ghost', id: id + '-no', flex: 1 });
      });
    },
    paginate(n, o = {}) {
      const per = o.per ?? 8, id = o.id ?? 'pg';
      const pages = Math.max(1, Math.ceil(n / per));
      const page = clamp(state.pages[id] ?? 0, 0, pages - 1);
      state.pages[id] = page;
      return { id, page, pages, per, from: page * per, to: Math.min(n, (page + 1) * per), go(d) { state.pages[id] = clamp(page + d, 0, pages - 1); hooks.refresh(); } };
    },
    pager(pg) {
      ui.chip('', () => pg.go(-1), { icon: 'back', w: 38, disabled: pg.page <= 0, id: pg.id + '-prev' });
      ui.text(`${pg.page + 1} / ${pg.pages}`, { w: 52, align: 'center', color: C.dim, bold: true, id: pg.id + '-lbl' });
      ui.chip('', () => pg.go(1), { icon: 'next', w: 38, disabled: pg.page >= pg.pages - 1, id: pg.id + '-next' });
    },
    grid(items, o = {}) {
      const cols = o.cols ?? 2, gap = o.gap ?? 6;
      for (let i = 0; i < items.length; i += cols) {
        ui.row(() => {
          for (let c = 0; c < cols; c++) {
            const it = items[i + c];
            if (it === undefined) { ui.spacer(1); continue; }
            const t = o.tile(it);
            ui.tile({ ...t, flex: 1, h: t.h ?? o.itemH ?? 48, id: t.id ?? String(i + c) + (t.title ?? '') });
          }
        }, { gap });
      }
    },
    lines(lines, o) { // custom scrolling text view (chat history)
      return add('lines', { lines, total: o.total, h: o.h, holder: o.holder, id: 'lines' }, fixedH(o.h));
    },
  };
  return { ui, widgets, get height() { return Math.max(0, y - GAP); } };
}

// ---------------------------------------------------------------------------------------------- the panel window (title bar, tab rail, scrolling page)
const WIN = { w: 560, h: 420, titleH: 40 };
const ORACLE_STATE = { listening: ['Listening', C.info], transcribing: ['Hearing you', '#b8c4ff'], thinking: ['Thinking', '#d9c4ff'], coding: ['Weaving', '#ffc86b'] };
const TAB = { x: 9, y: 52, w: 44, h: 44, step: 50 };
const GUTTER = 12;

function createWindow(THREE, env) {
  const surf = createSurface(THREE, { id: 'window', w: WIN.w, h: WIN.h, order: 9010, draw });
  let panelId = null, def = null, page = { widgets: [], h: 0 }, scroll = 0, chrome = [], toast = null, card = false, lastSig;
  let sigAt = 0, laterAt = 0, rebuildAt = 0, pendingRebuild = false;
  const rect = { x: 68, y: 48, w: 480, h: 360 };
  const win = { surf, rect };

  function layoutRect() {
    card = !!def?.card;
    if (card) { rect.x = 24; rect.y = 48; rect.w = 512; rect.h = 358; } else { rect.x = 68; rect.y = 48; rect.w = 480; rect.h = 360; }
  }
  function buildChrome() {
    chrome = [];
    chrome.push({ type: 'iconbtn', key: 'close', x: WIN.w - 40, y: 6, w: 28, h: 28, icon: 'close', hint: 'Close', onClick: () => env.close() });
    if (card) return;
    const tabs = env.panels().filter((p) => !p.card);
    const step = Math.min(TAB.step, Math.floor((WIN.h - TAB.y - 14) / Math.max(1, tabs.length)));
    tabs.forEach((p, i) => chrome.push({ type: 'tab', key: 'tab:' + p.id, x: TAB.x, y: TAB.y + i * step, w: TAB.w, h: Math.min(TAB.h, step - 3), icon: p.icon, active: p.id === panelId, hint: p.title, onClick: () => env.open(p.id) }));
  }
  function rebuild() {
    if (!def) return;
    pendingRebuild = false; rebuildAt = env.now();
    const state = env.stateFor(def.id);
    const hooks = {
      state, ctx: env.ctx, now: env.now, refresh: () => { pendingRebuild = true; }, close: env.close, toast: win.toast,
      later: (ms) => { laterAt = env.now() + ms; },
    };
    const b = createBuilder(rect.w - GUTTER, surf.g, hooks);
    try { def.build(b.ui); } catch (err) {
      console.warn('[menu] panel build failed', def.id, err);
      b.ui.text('This panel failed to build: ' + (err?.message ?? err), { color: C.bad });
    }
    page = { widgets: b.widgets, h: b.height };
    scroll = clamp(scroll, 0, Math.max(0, page.h - rect.h));
    for (const wd of page.widgets) {
      if (wd.type !== 'lines') continue;
      const max = Math.max(0, wd.total - wd.h + 16);
      wd.holder.scroll = wd.holder.stick !== false ? max : Math.min(wd.holder.scroll ?? 0, max);
    }
    surf.invalidate();
  }
  win.show = (id) => {
    const d = env.panelDef(id);
    if (!d) return false;
    const same = panelId === id;
    panelId = id; def = d; layoutRect(); buildChrome();
    if (!same) { scroll = 0; surf.hoverKey = surf.pressKey = null; }
    lastSig = d.sig ? safeSig(d) : undefined;
    rebuild();
    return true;
  };
  const safeSig = (d) => { try { return String(d.sig()); } catch { return ''; } };
  win.refreshChrome = () => { if (def) { buildChrome(); surf.invalidate(); } };
  win.rebuild = rebuild;
  win.requestRebuild = () => { pendingRebuild = true; };
  Object.defineProperty(win, 'panelId', { get: () => panelId });
  win.toast = (text) => { toast = { text: String(text), until: env.now() + 2600 }; surf.invalidate({ x: 60, y: WIN.h - 60, w: WIN.w - 120, h: 52 }); };

  // called every frame while the window is visible
  let pulseAt = 0;
  win.tick = (now) => {
    if (toast && now > toast.until) { toast = null; surf.invalidate({ x: 60, y: WIN.h - 60, w: WIN.w - 120, h: 52 }); }
    if (env.oracleState?.() && now - pulseAt > 140) { pulseAt = now; surf.invalidate({ x: WIN.w - 250, y: 4, w: 200, h: WIN.titleH - 2 }); } // the state dot pulses
    if (laterAt && now > laterAt) { laterAt = 0; pendingRebuild = true; }
    if (def?.sig && now - sigAt > 250) {
      sigAt = now;
      const s = safeSig(def);
      if (s !== lastSig) { lastSig = s; pendingRebuild = true; }
    }
    if (pendingRebuild && now - rebuildAt > 50) rebuild();
  };

  const inside = (wd, x, y) => x >= wd.x && x <= wd.x + wd.w && y >= wd.y && y <= wd.y + wd.h;
  win.pick = (px, py) => {
    for (let i = chrome.length - 1; i >= 0; i--) if (inside(chrome[i], px, py)) return chrome[i];
    if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) {
      const lx = px - rect.x, ly = py - rect.y + scroll;
      for (let i = page.widgets.length - 1; i >= 0; i--) {
        const wd = page.widgets[i];
        if ((isInteractive(wd) || wd.type === 'lines') && inside(wd, lx, ly)) return wd;
      }
    }
    return null;
  };
  win.isTitle = (px, py) => py < WIN.titleH + 4 && px > 0 && px < WIN.w;
  win.rectOf = (wd) => (wd.type === 'tab' || wd.type === 'iconbtn' ? wd : { x: wd.x + rect.x, y: wd.y + rect.y - scroll, w: wd.w, h: wd.h });
  win.invalidateWidget = (wd) => { if (wd) surf.invalidate(win.rectOf(wd)); };
  win.canScroll = (wd) => (wd?.type === 'lines' ? wd.total > wd.h : page.h > rect.h);
  win.scrollBy = (dy, wd) => {
    if (wd?.type === 'lines' && wd.total > wd.h) {
      const s = clamp(wd.holder.scroll + dy, 0, wd.total - wd.h + 16);
      wd.holder.stick = s >= wd.total - wd.h + 12;
      if (s !== wd.holder.scroll) { wd.holder.scroll = s; win.invalidateWidget(wd); }
      return;
    }
    const s = clamp(scroll + dy, 0, Math.max(0, page.h - rect.h));
    if (s !== scroll) { scroll = s; surf.invalidate(rect); }
  };
  win.setScroll = (v) => { scroll = clamp(v, 0, Math.max(0, page.h - rect.h)); surf.invalidate(rect); };
  Object.defineProperty(win, 'scroll', { get: () => scroll });
  Object.defineProperty(win, 'pageHeight', { get: () => page.h });
  Object.defineProperty(win, 'widgets', { get: () => page.widgets });
  Object.defineProperty(win, 'chrome', { get: () => chrome });

  // sliders follow the pointer while pressed
  win.dragSlider = (wd, px) => {
    const lx = px - rect.x - wd.x - 16, t = clamp(lx / (wd.w - 32), 0, 1);
    let v = wd.min + t * (wd.max - wd.min);
    if (wd.step) v = Math.round(v / wd.step) * wd.step;
    v = clamp(+v.toFixed(6), wd.min, wd.max);
    if (v !== wd.cur) { wd.cur = v; try { wd.set(v); } catch (err) { console.warn('[menu] slider set failed', err); } win.invalidateWidget(wd); return true; }
    return false;
  };
  win.click = (wd) => {
    if (!wd || wd.disabled) return;
    try { wd.onClick?.(); } catch (err) { console.warn('[menu] click failed', wd.key, err); win.toast('Something went wrong: ' + (err?.message ?? err)); }
    if (wd.type !== 'tab' && wd.type !== 'iconbtn' && panelId) rebuild();
  };

  function draw(g, r) {
    const { w: W, h: H } = WIN;
    const hover = surf.hoverKey, press = surf.pressKey;
    // glass body
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(28,32,88,0.97)'); bg.addColorStop(1, 'rgba(10,12,38,0.97)');
    rr(g, 1.5, 1.5, W - 3, H - 3, 24); g.fillStyle = bg; g.fill();
    g.lineWidth = 2; g.strokeStyle = C.edge; g.stroke();
    // title band + gold hairline
    rr(g, 3, 3, W - 6, WIN.titleH, 20); g.fillStyle = 'rgba(255,255,255,0.045)'; g.fill();
    const hair = g.createLinearGradient(0, 0, W, 0);
    hair.addColorStop(0, 'rgba(255,216,119,0)'); hair.addColorStop(0.5, 'rgba(255,216,119,0.65)'); hair.addColorStop(1, 'rgba(255,216,119,0)');
    g.fillStyle = hair; g.fillRect(24, WIN.titleH + 4, W - 48, 1.5);
    if (!card) { rr(g, 5, 46, 54, H - 52, 17); g.fillStyle = C.rail; g.fill(); }
    // title
    const title = def?.title ?? '';
    drawIcon(g, def?.icon ?? 'star', 30, 22, 11, C.gold);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = font(17, 700); g.fillStyle = C.text; g.fillText(title, 52, 22);
    const tw = g.measureText(title).width;
    const hot = hover && (chrome.find((c) => c.key === hover) ?? page.widgets.find((c) => c.key === hover) ?? null);
    // the Omnissiah's state (listening / hearing / thinking / weaving) lives in the title bar while a panel is open: the world-space indicator steps aside
    const os = ORACLE_STATE[env.oracleState?.()];
    let pillW = 0;
    if (os) {
      g.font = font(13, 700);
      pillW = g.measureText(os[0]).width + 42;
      const px = WIN.w - 50 - pillW, pulse = 0.5 + 0.5 * Math.sin(env.now() / 190);
      rr(g, px, 9, pillW, 26, 13); g.fillStyle = 'rgba(10,12,34,0.85)'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = os[1]; g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
      g.fillStyle = os[1]; g.globalAlpha = 0.35 + pulse * 0.4; dot(g, px + 16, 22, 6 + pulse * 1.6); g.globalAlpha = 1; dot(g, px + 16, 22, 4);
      g.fillStyle = C.text; g.textAlign = 'left'; g.fillText(os[0], px + 28, 23);
    }
    if (hot?.hint) { g.font = font(13, 500, 'italic'); g.fillStyle = C.gold; g.textAlign = 'left'; g.fillText(fit(g, '→ ' + hot.hint, WIN.w - 60 - (52 + tw + 16) - (pillW ? pillW + 8 : 0), font(13, 500, 'italic')), 52 + tw + 16, 23); }
    else if (!os) { g.fillStyle = 'rgba(255,255,255,0.22)'; for (let i = -1; i <= 1; i++) dot(g, WIN.w / 2 + 120 + i * 9, 20, 2.2); }
    for (const wd of chrome) if (!r || overlaps(r, wd)) DRAW[wd.type](g, wd, hover === wd.key, press === wd.key);
    // page
    g.save();
    rr(g, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 8); g.clip();
    g.translate(rect.x, rect.y - scroll);
    for (const wd of page.widgets) {
      if (wd.y + wd.h < scroll - 4 || wd.y > scroll + rect.h + 4) continue;
      g.globalAlpha = wd.disabled && wd.type !== 'button' ? 0.4 : 1;
      DRAW[wd.type]?.(g, wd, hover === wd.key, press === wd.key);
    }
    g.globalAlpha = 1;
    g.restore();
    if (page.h > rect.h) { // scrollbar
      const tx = rect.x + rect.w - 5, th = Math.max(26, rect.h * (rect.h / page.h)), ty = rect.y + ((rect.h - th) * scroll) / Math.max(1, page.h - rect.h);
      rr(g, tx, rect.y, 4, rect.h, 2); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fill();
      rr(g, tx, ty, 4, th, 2); g.fillStyle = 'rgba(255,216,119,0.7)'; g.fill();
    }
    if (toast) {
      g.font = font(14, 600); const w = g.measureText(toast.text).width + 36, x = WIN.w / 2 - w / 2, y = WIN.h - 52;
      rr(g, x, y, w, 34, 17); g.fillStyle = 'rgba(8,9,30,0.96)'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.gold; g.stroke();
      g.fillStyle = C.gold; g.textAlign = 'center'; g.fillText(toast.text, WIN.w / 2, y + 18);
    }
  }
  const overlaps = (r, wd) => !(wd.x > r.x + r.w || wd.x + wd.w < r.x || wd.y > r.y + r.h || wd.y + wd.h < r.y);
  return win;
}

// ---------------------------------------------------------------------------------------------- the wrist launcher (round icon buttons)
const LB = { size: 50, gap: 10, pad: 16, top: 30, cols: 4, mpp: 0.001 };
function createLauncher(THREE, env) {
  let orbs = [], rows = 2, label = '';
  const width = LB.pad * 2 + LB.cols * LB.size + (LB.cols - 1) * LB.gap;
  const height = (n) => LB.top + n * LB.size + (n - 1) * LB.gap + LB.pad;
  const surf = createSurface(THREE, { id: 'launcher', w: width, h: height(2), mpp: LB.mpp, order: 9020, draw });
  const L = { surf };
  L.layout = () => {
    const list = env.panels().filter((p) => !p.card && p.launcher !== false);
    rows = Math.max(1, Math.ceil(list.length / LB.cols));
    if (surf.h !== height(rows)) surf.resize(width, height(rows)); else surf.invalidate();
    orbs = list.map((p, i) => {
      const row = Math.floor(i / LB.cols), inRow = Math.min(LB.cols, list.length - row * LB.cols), col = i % LB.cols;
      const x0 = (width - (inRow * LB.size + (inRow - 1) * LB.gap)) / 2;
      return { type: 'orb', key: 'orb:' + p.id, id: p.id, x: x0 + col * (LB.size + LB.gap), y: LB.top + row * (LB.size + LB.gap), w: LB.size, h: LB.size, icon: p.icon, hint: p.title, onClick: () => env.open(p.id) };
    });
  };
  L.pick = (px, py) => {
    for (const o of orbs) { const dx = px - (o.x + o.w / 2), dy = py - (o.y + o.h / 2); if (dx * dx + dy * dy <= (o.w / 2 + 3) ** 2) return o; }
    return null;
  };
  L.click = (wd) => { if (wd) wd.onClick(); };
  L.isTitle = () => false;
  L.canScroll = () => false;
  L.scrollBy = () => {};
  L.rectOf = (wd) => wd;
  L.invalidateWidget = (wd) => { if (wd) surf.invalidate(wd); };
  L.tick = () => {};
  Object.defineProperty(L, 'orbs', { get: () => orbs });
  function draw(g) {
    const W = surf.w, H = surf.h;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(28,32,88,0.95)'); bg.addColorStop(1, 'rgba(10,12,38,0.95)');
    rr(g, 1.5, 1.5, W - 3, H - 3, 24); g.fillStyle = bg; g.fill(); g.lineWidth = 2; g.strokeStyle = C.edge; g.stroke();
    const hot = orbs.find((o) => o.key === surf.hoverKey);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (hot) { g.font = font(14, 700); g.fillStyle = C.gold; g.fillText(hot.hint, W / 2, 17); }
    else { g.font = font(11, 700); g.fillStyle = C.faint; g.fillText('M E N U', W / 2, 17); }
    for (const o of orbs) {
      const isHot = surf.hoverKey === o.key, isDown = surf.pressKey === o.key, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const rad = o.w / 2 * (isDown ? 0.92 : isHot ? 1.07 : 1);
      g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fillStyle = isDown ? 'rgba(255,216,119,0.4)' : isHot ? 'rgba(255,216,119,0.2)' : 'rgba(255,255,255,0.075)'; g.fill();
      g.lineWidth = isHot ? 2.4 : 1.2; g.strokeStyle = isHot ? C.gold : 'rgba(255,255,255,0.2)'; g.stroke();
      drawIcon(g, o.icon, cx, cy, rad * 0.46, isHot ? '#fff1c4' : o.id === env.currentPanel() ? C.gold : C.text);
      if (o.id === env.currentPanel()) { g.fillStyle = C.gold; dot(g, cx, cy + rad + 4.5, 2.2); }
    }
  }
  return L;
}

// ================================================================================================================================
export const meta = { name: 'Menu', description: 'In-VR wrist launcher and panels: summon, spells, quests, conversation, world, settings.' };

export default function (ctx) {
  const { THREE, world, input, events, camera, player } = ctx;
  const S = ctx.state;                                             // survives hot reload
  S.settings ??= store.get(LS.settings, {});
  S.meta ??= Object.assign({ welcomed: false, fav: [], recent: [], lastPreset: null }, store.get(LS.meta, {}));
  S.chat ??= store.get(LS.chat, []);
  S.panelState ??= {};
  S.registry ??= {};                                               // panels registered by other modules
  S.aim ??= new THREE.Vector3(0, 0, -4);
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const r2 = (n) => Math.round(n * 100) / 100;
  const tmpVecs = Array.from({ length: 8 }, () => new THREE.Vector3());
  const [v0, v1, v2, v3, v4] = tmpVecs;
  let disposed = false;
  const mine = [];                                                 // things this menu summoned: { name, handle, weapon }
  const saveMeta = () => store.set(LS.meta, S.meta);

  // ------------------------------------------------------------------------------------------ feedback (sound + haptics)
  let snd = null, lastTickAt = 0;
  const sound = () => { if (!snd && world.kit?.sound) { try { snd = world.kit.sound(ctx, { volume: 0.7 }); } catch { snd = null; } } return snd; };
  function feedback(kind, handName) {
    const t = nowMs();
    const hand = handName ? input[handName] : null;
    if (kind === 'hover') {
      if (t - lastTickAt < 55) return;
      lastTickAt = t;
      try { sound()?.tone({ freq: 2300, dur: 0.022, vol: 0.05, type: 'sine' }); } catch { /* audio not ready */ }
      hand?.pulse?.(0.12, 14);
    } else if (kind === 'click') {
      let done = false;
      try { if (world.audio?.sfx) { const r = world.audio.sfx('ui-tick', { volume: 0.5 }); done = r !== false; } } catch { done = false; }
      if (!done) { try { const s = sound(); s?.tone({ freq: 1500, freqEnd: 900, dur: 0.07, vol: 0.12, type: 'triangle' }); } catch { /* ignore */ } }
      hand?.pulse?.(0.45, 32);
    } else if (kind === 'open') {
      try { sound()?.chord?.([660, 990], { dur: 0.16, vol: 0.07, stagger: 0.05 }); } catch { /* ignore */ }
      hand?.pulse?.(0.3, 40);
    }
  }

  // ------------------------------------------------------------------------------------------ settings (persisted, re-applied on load / module reload)
  const findVoice = () => { const g = globalThis.window?.game; return g?.voice ?? g?.world?.voice ?? world.voice ?? null; };
  const SETTINGS = {
    gore: { owner: 'core/kit.js', def: 'full', read: () => world.kit?.gore?.level, apply: (v) => { if (world.kit?.gore) world.kit.gore.level = v; } },
    commentary: {
      owner: 'core/commentary.js', def: 'normal',
      read: () => { const c = world.commentary; return c ? (c.enabled ? c.frequency : 'off') : undefined; },
      apply: (v) => {
        const c = world.commentary; if (!c) return;
        if (v === 'off') { if (c.setEnabled) c.setEnabled(false); else c.enabled = false; } else { if (c.setEnabled) c.setEnabled(true); else c.enabled = true; c.frequency = v; }
      },
    },
    volVoices: { owner: 'core/voices.js', def: 1, read: () => world.voices?.volume, apply: (v) => { if (world.voices) world.voices.volume = v; } },
    volSfx: { owner: 'core/audio.js', def: 1, read: () => world.audio?.sfxVolume, apply: (v) => { if (world.audio) world.audio.sfxVolume = v; } },
    volMusic: { owner: 'core/audio.js', def: 1, read: () => world.audio?.musicVolume, apply: (v) => { if (world.audio) world.audio.musicVolume = v; } },
    volAmbience: { owner: 'core/ambience.js', def: 1, read: () => world.ambience?.getVolume?.(), apply: (v) => world.ambience?.setVolume?.(v) },
    volMaster: { owner: null, def: 1, read: () => ctx.audio?.listener?.getMasterVolume?.(), apply: (v) => ctx.audio?.listener?.setMasterVolume?.(v) },
    turn: { owner: 'core/player.js', def: 'snap', read: () => (world.player ? (S.settings.turn ?? 'snap') : undefined), apply: (v) => { if (world.player) world.player.snapEnabled = v === 'snap'; } },
    snapAngle: { owner: 'core/player.js', def: 30, read: () => world.player?.snapAngle, apply: (v) => { if (world.player) world.player.snapAngle = v; } },
    speed: { owner: 'core/player.js', def: 4, read: () => world.player?.speed, apply: (v) => { if (world.player) world.player.speed = v; } },
    vignette: { owner: null, def: true, read: () => S.settings.vignette, apply: (v) => ctx.hud.setComfort?.({ enabled: !!v }) },
    vignetteStrength: { owner: null, def: 0.6, read: () => S.settings.vignetteStrength, apply: (v) => ctx.hud.setComfort?.({ strength: v }) },
    perf: { owner: 'core/perf.js', def: 'auto', read: () => world.perf?.mode, apply: (v) => { if (world.perf) world.perf.mode = v; } },
    physicsDebug: { owner: 'core/physics.js', def: false, read: () => S.settings.physicsDebug, apply: (v) => { const P = world.physics; if (P) { if (typeof P.debug === 'function') P.debug(!!v); else P.debug = !!v; } } },
    voiceStyle: { owner: null, def: null, read: () => { const v = findVoice(); return v?.getStyle?.() ?? v?.style; }, apply: (v) => { const x = findVoice(); if (x?.setStyle && v != null) x.setStyle(v); } },
  };
  function setSetting(id, v) {
    const d = SETTINGS[id]; if (!d) return;
    S.settings[id] = v; store.set(LS.settings, S.settings);
    try { d.apply(v); } catch (err) { console.warn('[menu] could not apply', id, err); }
  }
  function getSetting(id) {
    const d = SETTINGS[id];
    let v; try { v = d.read(); } catch { v = undefined; }
    return v ?? S.settings[id] ?? d.def;
  }
  function applySettings(path) {
    for (const id in S.settings) {
      const d = SETTINGS[id];
      if (!d || (path && (!d.owner || !(path === d.owner || path.endsWith('/' + d.owner.replace(/^core\//, '')))))) continue;
      try { d.apply(S.settings[id]); } catch (err) { console.warn('[menu] re-apply failed', id, err); }
    }
  }
  const hasVoiceStyles = () => { const v = findVoice(); return !!(v && typeof v.setStyle === 'function'); };
  const voiceStyles = () => { const v = findVoice(); let s = typeof v?.styles === 'function' ? v.styles() : v?.styles; if (s && !Array.isArray(s)) s = Object.keys(s); return Array.isArray(s) && s.length ? s : null; };

  // ------------------------------------------------------------------------------------------ conversation log
  let chatSaveT = 0;
  function log(who, name, text, extra = {}) {
    text = String(text ?? '').trim();
    if (!text) return;
    S.chat.push({ t: Date.now(), who, name, text, faction: extra.faction, level: extra.level });
    if (S.chat.length > 200) S.chat.splice(0, S.chat.length - 200);
    clearTimeout(chatSaveT);
    chatSaveT = setTimeout(() => store.set(LS.chat, S.chat), 1500);
  }
  function npcName(m) {
    const v = world.voices;
    return m?.name ?? m?.npc?.name ?? v?.nameOf?.(m?.id) ?? v?.npcs?.get?.(m?.id)?.name ?? 'Someone';
  }
  ctx.on('net:transcript', (m) => log('you', 'You', m?.text));
  ctx.on('net:speak', (m) => log('omni', 'Omnissiah', m?.text));
  // core/voices.js knows who is speaking: it emits voices:reply { actor } synchronously while handling the same net:npc_reply
  let npcPending = null;
  ctx.on('net:npc_reply', (m) => {
    const entry = { m, done: false };
    npcPending = entry;
    queueMicrotask(() => { if (!entry.done) { entry.done = true; log('npc', npcName(m), m?.text, { faction: m?.faction ?? m?.npc?.faction }); } });
  });
  ctx.on('voices:reply', (e) => {
    const p = npcPending;
    if (!p || p.done || !e?.actor) return;
    p.done = true;
    let info = null; try { info = world.voices?.info?.(e.actor); } catch { info = null; }
    log('npc', info?.name ?? e.actor.npcName ?? npcName(p.m), p.m?.text, { faction: info?.faction ?? p.m?.faction });
  });
  ctx.on('net:notice', (m) => log('note', m?.level === 'error' ? 'Error' : 'Notice', m?.text, { level: m?.level }));
  ctx.onDispose(() => { clearTimeout(chatSaveT); store.set(LS.chat, S.chat); store.set(LS.meta, S.meta); });

  function buildContext() {
    const aim = ctx.aimPoint?.();
    const out = { player: { position: player.feet.toArray().map(r2), forward: player.forward.toArray().map(r2) }, aimPoint: aim ? aim.toArray().map(r2) : null, modules: [] };
    try { out.modules = [...(globalThis.window?.game?.modules?.keys?.() ?? [])]; } catch { /* ignore */ }
    const providers = world.contextProviders;
    if (providers) for (const k in providers) { try { const v = providers[k]?.(); if (v != null) out[k] = v; } catch { /* a broken provider must not block this */ } }
    return out;
  }
  function say(text) { // utterance to the Omnissiah, as if typed
    if (!ctx.net?.send({ type: 'utterance_text', text, context: buildContext() })) { toast('Not connected to the Omnissiah.'); return false; }
    log('you', 'You', text);
    return true;
  }

  // ------------------------------------------------------------------------------------------ panel registry
  let win, launcher;
  const toast = (t) => { if (win?.surf.visible) win.toast(t); else ctx.hud?.show?.(t, 2.5); };
  const builtin = [
    { id: 'summon', title: 'Summon', icon: 'summon', build: buildSummon, sig: () => mine.length + '|' + S.meta.fav.length },
    { id: 'spells', title: 'Spells & Weapons', icon: 'bolt', build: buildSpells, sig: () => (world.spells?.current?.()?.id ?? '') + '|' + (world.weapons?.held?.left?.type ?? '') + (world.weapons?.held?.right?.type ?? '') },
    { id: 'quests', title: 'Quests', icon: 'scroll', build: buildQuests, sig: () => questSig() },
    { id: 'chat', title: 'Conversation', icon: 'chat', build: buildChat, sig: () => S.chat.length },
    { id: 'world', title: 'World', icon: 'globe', build: buildWorld, sig: () => weather.size + '|' + (world.oracle?.getMood?.() ?? '') },
    { id: 'settings', title: 'Settings', icon: 'gear', build: buildSettings },
    { id: 'help', title: 'How to play', icon: 'help', build: buildHelp },
    { id: 'welcome', title: 'Welcome, seeker', icon: 'summon', card: true, build: buildWelcome },
  ];
  const allPanels = () => builtin.concat(Object.values(S.registry).filter(Boolean));
  const panelDef = (id) => allPanels().find((p) => p.id === id) ?? null;
  const ALIASES = { library: 'summon', spawn: 'summon', creatures: 'summon', weapons: 'spells', spell: 'spells', magic: 'spells', quest: 'quests', story: 'quests', conversation: 'chat', history: 'chat', look: 'world', weather: 'world', travel: 'world', options: 'settings', config: 'settings', controls: 'help', howto: 'help' };
  function resolvePanel(name) {
    const n = String(name ?? '').toLowerCase().trim();
    const direct = allPanels().find((p) => p.id.toLowerCase() === n || p.title.toLowerCase() === n);
    return (direct ?? panelDef(ALIASES[n]))?.id ?? null;
  }

  // ------------------------------------------------------------------------------------------ summon (library browser)
  let libCache = { n: -1, list: [] };
  function libEntries() {
    const lib = world.library; if (!lib) return [];
    const n = lib.count?.() ?? -1;
    if (libCache.n !== n || !libCache.list.length) libCache = { n, list: lib.list().map((e) => ({ ...e, category: e.category || 'custom' })) };
    return libCache.list;
  }
  const isFav = (name) => S.meta.fav.includes(name);
  function toggleFav(name) { const i = S.meta.fav.indexOf(name); if (i >= 0) S.meta.fav.splice(i, 1); else S.meta.fav.unshift(name); saveMeta(); }
  function pushRecent(name) { S.meta.recent = [name, ...S.meta.recent.filter((n) => n !== name)].slice(0, 24); saveMeta(); }
  const shortDesc = (d) => String(d ?? '').split(/[;.]\s/)[0].replace(/\s*\([^)]*\)\s*$/, '');

  function summon(name, count, spread) {
    const lib = world.library;
    if (!lib) { toast('The library is not available.'); return null; }
    const p = S.aim;
    let h = null;
    try { h = lib.spawn(ctx, name, { position: { x: p.x, z: p.z }, x: p.x, z: p.z, count, spread: count > 1 ? spread : 0 }); } catch (err) { console.warn('[menu] summon failed', err); }
    if (!h) { toast(`Could not summon "${titleCase(name)}".`); return null; }
    mine.push({ name, handle: h, count, spread, at: p.clone() });
    pushRecent(name);
    feedback('open');
    toast(`Summoned ${count > 1 ? count + ' x ' : ''}${titleCase(name)}`);
    return h;
  }
  function clearMine() {
    const n = mine.length;
    for (const m of mine.splice(0)) { try { (m.handle?.remove ?? m.weapon?.remove)?.call(m.handle ?? m.weapon); } catch { /* already gone */ } }
    toast(n ? `Cleared ${n} summoned ${n === 1 ? 'thing' : 'things'}.` : 'Nothing to clear.');
  }
  function keepIt(name, count, spread) {
    const at = S.aim;
    if (say(`Make permanent: ${count > 1 ? count + ' x ' : ''}${name}, summoned from the library at (${r2(at.x)}, ${r2(at.z)})${count > 1 ? ` spread over ${spread} m` : ''}. Add it as a permanent creation so it stays after the session.`)) {
      toast('Asked the Omnissiah to make it permanent.');
    }
  }

  function buildSummon(ui) {
    const lib = world.library, st = ui.state;
    if (!lib) { ui.text('The library is not available right now (it may be reloading). Try again in a moment.', { color: C.warn }); return; }
    const entries = libEntries();
    const byName = new Map(entries.map((e) => [e.name, e]));
    st.cat ??= 'enemies'; st.count ??= 1; st.spread ??= 3;
    if (st.sel && !byName.has(st.sel)) st.sel = null;
    if (st.sel) { buildSummonDetail(ui, byName.get(st.sel)); return; }

    const cats = CAT_ORDER.filter((c) => entries.some((e) => e.category === c));
    for (const e of entries) if (!cats.includes(e.category)) cats.push(e.category);
    ui.row(() => {
      ui.chip('', () => { st.cat = 'fav'; }, { icon: 'star', active: st.cat === 'fav', color: '#ffd877', flex: 1, id: 'fav', hint: 'Favourites & recent' });
      for (const c of cats) ui.chip('', () => { st.cat = c; }, { icon: (CAT[c] ?? CAT.custom).icon, active: st.cat === c, color: (CAT[c] ?? CAT.custom).color, flex: 1, id: c, hint: (CAT[c] ?? { label: titleCase(c) }).label });
    }, { gap: 4 });
    const favs = [...new Set([...S.meta.fav, ...S.meta.recent])].map((n) => byName.get(n)).filter(Boolean);
    const list = st.cat === 'fav' ? favs : entries.filter((e) => e.category === st.cat);
    const meta = st.cat === 'fav' ? { label: 'Favourites & recent', color: '#ffd877' } : (CAT[st.cat] ?? { label: titleCase(st.cat), color: C.gold });
    const pg = ui.paginate(list.length, { id: 'sum-' + st.cat, per: 8 });
    ui.row(() => { ui.text(`${meta.label}  ·  ${list.length}`, { bold: true, size: 14, color: meta.color, flex: 1 }); ui.pager(pg); });
    if (!list.length) ui.text('Nothing here yet. Open an entry and press the star to keep it close, or summon something to fill your recent row.', { color: C.dim, size: 13 });
    ui.grid(list.slice(pg.from, pg.to), {
      cols: 2, itemH: 48,
      tile: (e) => ({ title: titleCase(e.name), sub: shortDesc(e.description), icon: (CAT[e.category] ?? CAT.custom).icon, color: (CAT[e.category] ?? CAT.custom).color, badge: isFav(e.name) ? 'star' : undefined, id: e.name, onClick: () => { st.sel = e.name; st.count = 1; st.spread = 3; ui.refresh(); } }),
    });
    ui.gap(2);
    ui.row(() => {
      ui.text(mine.length ? mine.length + ' summoned \u00b7 they last this session only.' : 'Summoned things last this session only.', { size: 12, color: C.faint, flex: 1 });
      ui.button('Clear what I summoned', clearMine, { icon: 'trash', kind: 'ghost', w: 222, h: 32, disabled: !mine.length });
    });
  }
  function buildSummonDetail(ui, e) {
    const st = ui.state, cat = CAT[e.category] ?? CAT.custom;
    ui.row(() => {
      ui.button('Back', () => { st.sel = null; }, { icon: 'back', w: 96, kind: 'ghost', h: 36 });
      ui.text(titleCase(e.name), { size: 20, bold: true, color: cat.color, flex: 1 });
      ui.chip('', () => toggleFav(e.name), { icon: 'star', active: isFav(e.name), w: 46, h: 36, color: '#ffd877', id: 'favtoggle', hint: isFav(e.name) ? 'Remove favourite' : 'Add favourite' });
    });
    ui.text(shortDesc(e.description) + '.', { size: 14 });
    const opts = Array.isArray(e.options) ? e.options.join(', ') : typeof e.options === 'string' ? e.options : '';
    if (opts) ui.text('Options the Omnissiah knows: ' + opts.replace(/[()]/g, ''), { size: 12, color: C.faint });
    const stepper = (label, key, min, max, step, fmt) => ui.row(() => {
      ui.text(label, { w: 150, bold: true, size: 14 });
      ui.chip('', () => { st[key] = clamp(r2(st[key] - step), min, max); }, { icon: 'minus', w: 52, id: key + '-' });
      ui.text(fmt(st[key]), { w: 76, align: 'center', bold: true, color: C.gold, size: 17 });
      ui.chip('', () => { st[key] = clamp(r2(st[key] + step), min, max); }, { icon: 'plus', w: 52, id: key + '+' });
      ui.spacer(1);
    });
    stepper('How many', 'count', 1, 30, 1, (v) => String(v));
    stepper('Spread', 'spread', 0, 20, 1, (v) => v + ' m');
    ui.text('It appears at the glowing ring. Point your hand at the ground to choose the spot, then press the button.', { size: 12, color: C.dim });
    ui.button('Summon here', () => summon(e.name, st.count, st.spread), { kind: 'primary', icon: 'summon', h: 44 });
    ui.row(() => {
      ui.button('Keep (make permanent)', () => keepIt(e.name, st.count, st.spread), { icon: 'star', flex: 1.3, h: 34 });
      ui.button('Clear what I summoned', clearMine, { icon: 'trash', kind: 'ghost', flex: 1.2, h: 34, disabled: !mine.length });
    });
    ui.text('Summoned things last this session only. Keep asks the Omnissiah to write it into the world for good.', { size: 12, color: C.faint });
  }

  // ------------------------------------------------------------------------------------------ spells & weapons
  function buildSpells(ui) {
    const sp = world.spells, W = world.weapons;
    ui.heading('Current spell');
    if (!sp) ui.text('The spell book is not available right now.', { color: C.warn });
    else {
      const list = sp.list(), cur = sp.current();
      if (cur) ui.tile({ title: cur.name, sub: cur.description || (cur.hold ? 'Hold the trigger' : 'Press the trigger'), icon: cur.icon || cur.name.slice(0, 2), color: cur.color, h: 56, static: true, id: 'cur' });
      ui.heading('All spells', { right: `${list.length}` });
      ui.grid(list, {
        cols: 3, itemH: 44,
        tile: (s) => ({ title: s.name, icon: s.icon || s.name.slice(0, 2), color: s.color, active: cur?.id === s.id, id: s.id, h: 44, onClick: () => { sp.select(s.id); feedback('open', lastHand); toast(`${s.name}: ${s.description || ''}`.slice(0, 64)); } }),
      });
    }
    ui.heading('In your hands');
    const held = (h) => W?.held?.[h]?.type;
    ui.row(() => {
      ui.tile({ title: 'Left hand', sub: held('left') ? titleCase(held('left')) : 'Empty', icon: 'sword', color: held('left') ? C.gold : C.faint, static: true, h: 44, flex: 1, id: 'hl' });
      ui.tile({ title: 'Right hand', sub: held('right') ? titleCase(held('right')) : 'Empty', icon: 'sword', color: held('right') ? C.gold : C.faint, static: true, h: 44, flex: 1, id: 'hr' });
    });
    const types = W?.types?.() ?? [];
    ui.heading('Give me…');
    if (!W) { ui.text('Weapons are not available right now.', { color: C.warn }); return; }
    const pg = ui.paginate(types.length, { id: 'give', per: 12 });
    ui.row(() => { ui.text('Tap one and it appears in your free hand.', { size: 12, color: C.dim, flex: 1 }); ui.pager(pg); });
    ui.grid(types.slice(pg.from, pg.to), { cols: 3, itemH: 40, tile: (t) => ({ title: titleCase(t), icon: 'sword', color: CAT.weapons.color, h: 40, id: t, onClick: () => giveWeapon(t) }) });
    ui.text('Weapons you conjure vanish with this session. Use Summon > Weapons for the full catalogue.', { size: 12, color: C.faint });
  }
  let lastHand = 'right';
  function giveWeapon(type) {
    const W = world.weapons; if (!W) return;
    const other = lastHand === 'right' ? 'left' : 'right';
    const free = !W.held?.[other] && input[other].connected;
    const src = input[free ? other : lastHand];
    v0.copy(src.position).addScaledVector(src.direction, 0.12);
    let w = null;
    try { w = W.create(ctx, type, { position: v0.clone(), hand: free ? other : undefined }); } catch (err) { console.warn('[menu] weapon create failed', err); }
    if (!w) { toast(`Could not make a ${titleCase(type)}.`); return; }
    mine.push({ name: type, weapon: w });
    feedback('open', lastHand);
    toast(`${titleCase(type)} ${free ? 'placed in your ' + other + ' hand' : 'conjured at your hand'}.`);
  }

  // ------------------------------------------------------------------------------------------ quests
  function numOf(x) { return typeof x === 'number' && isFinite(x) ? x : undefined; }
  function normQuest(q, i) {
    if (typeof q === 'string') q = { title: q };
    const status = String(q.status ?? q.state ?? '').toLowerCase();
    const done = q.completed === true || q.done === true || /^(complete|completed|done|finished)$/.test(status);
    const state = done ? 'done' : /^(available|locked)$/.test(status) ? status : 'active';
    let cur = typeof q.progress === 'number' ? q.progress : undefined, goal = numOf(q.goal ?? q.target ?? q.total ?? q.count ?? q.max);
    if (q.progress && typeof q.progress === 'object') { cur = numOf(q.progress.current ?? q.progress.value ?? q.progress.done); goal = numOf(q.progress.goal ?? q.progress.target ?? q.progress.max ?? q.progress.total) ?? goal; }
    let frac = done ? 1 : cur !== undefined && goal ? cur / goal : cur !== undefined && cur <= 1 ? cur : 0;
    if (Array.isArray(q.objectives) && q.objectives.length && goal === undefined) { const d = q.objectives.filter((o) => o.done || o.completed).length; cur = d; goal = q.objectives.length; frac = done ? 1 : d / goal; }
    const rw = q.rewards ?? q.reward;
    const reward = typeof rw === 'string' ? rw : rw?.text ?? (rw?.xp ? `${rw.xp} XP${rw.title ? ' + title ' + rw.title : ''}` : q.xp ? `${q.xp} XP` : '');
    const cs = q.current && typeof q.current === 'object' ? q.current : null;
    return {
      id: q.id ?? q.key ?? i, title: q.title ?? q.name ?? String(q.id ?? 'Quest'), desc: q.description ?? q.desc ?? q.text ?? q.objective ?? q.summary ?? '',
      frac: clamp(frac, 0, 1), label: goal && !q.stepCount ? `${Math.round(cur ?? 0)} / ${goal}` : done ? 'Done' : '', done, state, reward,
      step: numOf(q.step), stepCount: numOf(q.stepCount), now: cs?.text ? `${cs.text}${cs.count > 1 ? `  (${cs.progress ?? 0}/${cs.count})` : ''}` : '', pinned: !!q.pinned,
    };
  }
  function questData() {
    const Q = world.quests; if (!Q) return null;
    let raw = []; try { raw = typeof Q.list === 'function' ? Q.list() : Q.list ?? Q.quests ?? []; } catch { raw = []; }
    if (raw && !Array.isArray(raw)) raw = Object.values(raw);
    const list = (raw ?? []).map(normQuest);
    let prof = null; try { prof = typeof Q.profile === 'function' ? Q.profile() : null; } catch { prof = null; }
    const P = prof ?? Q.player ?? Q.progression ?? Q;
    const level = numOf(typeof Q.level === 'function' ? Q.level() : P.level ?? Q.level), xp = numOf(P.xpInLevel ?? P.xp ?? Q.xp), next = numOf(P.xpNext ?? P.xpToNext ?? P.nextXp ?? Q.xpToNext);
    const title = typeof P.title === 'string' ? P.title : P.title?.name;
    return { active: list.filter((q) => q.state === 'active'), available: list.filter((q) => q.state === 'available'), done: list.filter((q) => q.state === 'done'), level, xp, next, title, favour: numOf(P.favour), regard: typeof P.regard === 'string' ? P.regard : P.regard?.name };
  }
  function questSig() {
    try { const d = questData(); return d ? d.active.map((q) => q.id + ':' + Math.round(q.frac * 100) + q.now).join(',') + '|' + d.available.length + '|' + d.done.length + '|' + d.level + '|' + d.xp : 'none'; } catch { return 'err'; }
  }
  function buildQuests(ui) {
    const d = questData();
    if (!d) {
      ui.text('Quests are not awake yet.', { size: 16, bold: true, color: C.gold });
      ui.text('When the quest keeper joins the world your journey will be tracked here. Meanwhile you can simply ask the Omnissiah: "give me a quest".', { color: C.dim });
      ui.button('Ask for a quest', () => { say('Give me a quest.'); }, { kind: 'primary', icon: 'scroll' });
      return;
    }
    if (d.level !== undefined) {
      const sub = [d.title, d.xp !== undefined ? (d.next ? `${Math.round(d.xp)} / ${Math.round(d.next)} XP` : `${Math.round(d.xp)} XP`) : null, d.regard && d.favour !== undefined ? `${d.regard} (${d.favour})` : null].filter(Boolean).join('  \u00b7  ');
      ui.tile({ title: `Level ${d.level}`, sub: sub || 'Seeker', icon: 'star', color: C.gold, static: true, h: 52, id: 'lvl' });
      if (d.xp !== undefined && d.next) ui.progress('Experience', d.xp / d.next, { text: `${Math.round(d.next - d.xp)} XP to next level` });
    }
    ui.heading('Active', { right: String(d.active.length) });
    if (!d.active.length) ui.text('No active quests. Ask the Omnissiah for one, or start one below.', { color: C.dim });
    for (const q of d.active) {
      ui.text((q.pinned ? '\u25b8 ' : '') + q.title, { bold: true, size: 15, color: C.text });
      if (q.desc) ui.text(q.desc, { size: 12, color: C.dim });
      if (q.now) ui.text('\u25b8 ' + (world.quests?.phrase?.(q.now) ?? q.now), { size: 13, color: C.gold });
      ui.progress(q.stepCount ? `Step ${Math.min(q.stepCount, (q.step ?? 0) + 1)} of ${q.stepCount}${q.reward ? '  \u00b7  Reward: ' + q.reward : ''}` : q.reward ? 'Reward: ' + q.reward : 'Progress', q.frac, { text: q.label || Math.round(q.frac * 100) + '%', color: C.gold2 });
      ui.gap(4);
    }
    if (d.available.length) {
      ui.heading('Offered to you', { right: String(d.available.length) });
      for (const q of d.available.slice(0, 8)) ui.tile({ title: q.title, sub: q.desc || (q.reward ? 'Reward: ' + q.reward : 'Tap to begin'), icon: 'flag', color: '#9fe0ff', h: 46, id: 'a' + q.id, onClick: () => { try { toast(world.quests.start?.(q.id) === false ? 'Cannot start that yet.' : `Begun: ${q.title}`); } catch (err) { toast('Cannot start: ' + (err?.message ?? err)); } } });
    }
    if (d.done.length) {
      ui.heading('Completed', { right: String(d.done.length) });
      for (const q of d.done.slice(0, 12)) ui.tile({ title: q.title, sub: q.reward ? 'Reward: ' + q.reward : 'Completed', icon: 'check', color: C.good, static: true, h: 40, id: 'd' + q.id });
    }
  }
  // ------------------------------------------------------------------------------------------ conversation
  function chatLines(width) {
    const g = win.surf.g, out = [];
    let y = 0;
    for (const e of S.chat) {
      const color = e.who === 'omni' ? C.gold : e.who === 'you' ? '#a9d6ff' : e.who === 'npc' ? (FACTION[e.faction] ?? FACTION.neutral) : e.level === 'error' ? C.bad : C.dim;
      out.push({ k: 'hdr', name: e.name, time: hhmm(e.t), color, y, h: 20 }); y += 20;
      for (const t of wrapText(g, e.text, width - 30, font(13, 500, e.who === 'omni' ? 'italic' : ''))) {
        out.push({ k: 'txt', text: t, color: e.who === 'omni' ? '#ffe9b0' : e.who === 'note' ? C.dim : C.text, italic: e.who === 'omni', y, h: 18 }); y += 18;
      }
      y += 7;
    }
    return { lines: out, total: y + 8 };
  }
  function buildChat(ui) {
    const st = ui.state; st.log ??= {};
    ui.heading('What has been said', { right: `${S.chat.length} lines` });
    if (!S.chat.length) ui.text('Nothing yet. Hold the left trigger and speak, or type in the box on the desktop page.', { color: C.dim });
    else { const { lines, total } = chatLines(ui.w); ui.lines(lines, { total, h: 232, holder: st.log }); }
    ui.row(() => {
      ui.confirm('Undo last change', () => { ctx.net.send({ type: 'command', name: 'undo' }); ctx.hud.show('Undoing the last change…', 2.5); toast('Undoing the last change…'); }, { icon: 'undo', text: 'Undo it?', flex: 1, id: 'undo', kind: 'ghost' });
    });
    ui.row(() => {
      ui.confirm('Forget conversation', () => { ctx.net.send({ type: 'command', name: 'reset' }); S.chat.length = 0; store.set(LS.chat, S.chat); ctx.hud.show('The Omnissiah forgets…', 2.5); toast('Conversation forgotten.'); }, { icon: 'trash', text: 'Forget all?', flex: 1, id: 'reset' });
    });
  }

  // ------------------------------------------------------------------------------------------ world
  const WEATHER = [['rain', 'Rain', 'spark'], ['snow', 'Snow', 'spark'], ['storm', 'Storm', 'bolt'], ['fog-bank', 'Fog', 'eye'], ['fireflies', 'Fireflies', 'star']];
  const EXCLUSIVE = new Set(['rain', 'snow', 'storm']);
  const weather = new Map();                                       // name -> library handle
  const wAlive = (n) => { const h = weather.get(n); if (h && (h.removed || h.alive === false)) { weather.delete(n); return false; } return !!h; };
  function toggleWeather(name) {
    const lib = world.library; if (!lib) { toast('The library is not available.'); return; }
    if (wAlive(name)) { try { weather.get(name).remove(); } catch { /* gone */ } weather.delete(name); return; }
    if (EXCLUSIVE.has(name)) for (const n of EXCLUSIVE) if (wAlive(n)) { try { weather.get(n).remove(); } catch { /* gone */ } weather.delete(n); }
    let h = null; try { h = lib.spawn(ctx, name, {}); } catch (err) { console.warn('[menu] weather failed', err); }
    if (h) weather.set(name, h); else toast(`Could not start ${name}.`);
  }
  const MOODS = ['default', 'serene', 'joyful', 'ominous', 'wrathful'];
  function buildWorld(ui) {
    const style = world.style, env = world.env;
    ui.heading('Look of the world');
    if (!style) ui.text('The style engine is not available right now.', { color: C.warn });
    else {
      const names = Object.keys(style.presets ?? {}).length ? Object.keys(style.presets) : ['storybook', 'flat', 'noir', 'neon', 'pastel'];
      ui.row(() => { for (const n of names.slice(0, 6)) ui.chip(titleCase(n), () => { style.preset(n); S.meta.lastPreset = n; saveMeta(); }, { active: S.meta.lastPreset === n, flex: 1, id: n }); }, { gap: 4 });
    }
    ui.heading('Time of day');
    if (env?.setTimeOfDay) ui.slider('Night → golden hour', { min: 0, max: 1, step: 0.01, get: () => env.timeOfDay ?? 0.5, set: (v) => env.setTimeOfDay(v), fmt: (v) => (v < 0.2 ? 'Deep night' : v < 0.45 ? 'Dusk' : v < 0.65 ? 'Twilight' : v < 0.85 ? 'Evening' : 'Golden hour') });
    else ui.text('The sky is not available right now.', { color: C.warn });
    ui.heading('Weather');
    ui.row(() => { for (const [n, label, icon] of WEATHER) ui.chip(label, () => toggleWeather(n), { active: wAlive(n), icon, flex: 1, id: n }); }, { gap: 4 });
    ui.heading('Omnissiah’s mood');
    if (world.oracle?.setMood) {
      const cur = world.oracle.getMood?.() ?? 'default';
      ui.row(() => { for (const m of MOODS) ui.chip(titleCase(m), () => world.oracle.setMood(m), { active: cur === m, flex: 1, id: m }); }, { gap: 4 });
    } else ui.text('The Omnissiah is not available right now.', { color: C.warn });
    if (world.travel) {
      ui.heading('Travel');
      let dest = []; try { dest = world.travel.list?.() ?? []; } catch { dest = []; }
      if (dest && !Array.isArray(dest)) dest = Object.values(dest);
      if (!dest.length) ui.text('No places discovered yet. Ask the Omnissiah to take you somewhere new.', { color: C.dim });
      const pg = ui.paginate(dest.length, { id: 'travel', per: 4 });
      if (dest.length > 4) ui.row(() => { ui.spacer(1); ui.pager(pg); });
      ui.grid(dest.slice(pg.from, pg.to), {
        cols: 2, itemH: 46,
        tile: (d) => { const name = typeof d === 'string' ? d : d.name ?? d.title ?? d.id; return { title: titleCase(String(name).slice(0, 30)), sub: typeof d === 'object' ? shortDesc(d.description ?? d.prompt ?? '') : '', icon: 'map', color: '#9fe0ff', id: String(name), onClick: () => { try { world.travel.go(typeof d === 'string' ? d : d.prompt ?? d.name ?? d.id); toast('Travelling…'); } catch (err) { toast('Cannot travel: ' + (err?.message ?? err)); } } }; },
      });
    }
    ui.heading('Danger');
    const n = world.combat?.count?.('enemy') ?? 0;
    ui.row(() => {
      ui.confirm(`Clear all enemies${world.combat ? ` (${n})` : ''}`, () => { world.combat?.clear('enemy'); toast('Enemies cleared.'); }, { icon: 'skull', text: 'Banish them all?', id: 'enemies', flex: 1 });
    });
  }

  // ------------------------------------------------------------------------------------------ settings
  let fps = 72, fpsAcc = 0, fpsN = 0;
  const pct = (v) => Math.round(v * 100) + '%';
  function buildSettings(ui) {
    const A = (id) => getSetting(id);
    ui.heading('Gameplay');
    ui.choice(['full', 'mild', 'off'], () => A('gore'), (v) => setSetting('gore', v), { label: 'Gore', disabled: !world.kit?.gore });
    ui.choice(['off', 'rare', 'normal', 'chatty'], () => A('commentary'), (v) => setSetting('commentary', v), { label: 'Commentary', disabled: !world.commentary });
    if (hasVoiceStyles() && voiceStyles()) ui.choice(voiceStyles(), () => A('voiceStyle'), (v) => setSetting('voiceStyle', v), { label: 'Omnissiah voice' });
    { const v = findVoice(); if (v && typeof v.setOpenMic === 'function') ui.toggle('Voice activation', () => !!findVoice()?.openMic, (on) => findVoice()?.setOpenMic?.(on), { sub: 'Say "Omnissiah, ..." with no button. Hold-to-talk and tap-to-talk always work.' }); }
    ui.heading('Sound');
    const vol =(label, id, avail, max = 1) => ui.slider(label, { min: 0, max, step: 0.05, get: () => A(id), set: (v) => setSetting(id, v), fmt: pct, disabled: !avail });
    vol('Game sounds (master)', 'volMaster', !!ctx.audio?.listener, 1);
    if (world.voices) vol('NPC voices', 'volVoices', true);
    if (world.audio) { vol('Sound effects', 'volSfx', true); vol('Music', 'volMusic', true); }
    if (world.ambience) vol('Ambience', 'volAmbience', true, 1.5);
    ui.heading('Comfort');
    ui.choice([{ id: 'snap', label: 'Snap turn' }, { id: 'smooth', label: 'Smooth turn' }], () => A('turn'), (v) => setSetting('turn', v), { label: 'Turning', disabled: !world.player });
    if (A('turn') === 'snap') ui.choice([15, 30, 45, 60, 90].map((a) => ({ id: a, label: a + '°' })), () => A('snapAngle'), (v) => setSetting('snapAngle', +v), { label: 'Snap angle', disabled: !world.player });
    ui.slider('Movement speed', { min: 1, max: 8, step: 0.5, get: () => A('speed'), set: (v) => setSetting('speed', v), fmt: (v) => v.toFixed(1) + ' m/s', disabled: !world.player });
    ui.toggle('Comfort vignette', () => A('vignette'), (v) => setSetting('vignette', v), { sub: 'Darkens the edges of your view while moving fast', disabled: !ctx.hud.setComfort });
    if (A('vignette')) ui.slider('Vignette strength', { min: 0.2, max: 1, step: 0.05, get: () => A('vignetteStrength'), set: (v) => setSetting('vignetteStrength', v), fmt: pct });
    ui.heading('Performance');
    if (world.perf) ui.choice(['auto', 'quality', 'performance'], () => A('perf'), (v) => setSetting('perf', v), { label: 'Mode' });
    ui.text(`Quality tier: ${ctx.quality?.tier ?? '?'}   ·   ${Math.round(fps)} fps${world.perf?.stats ? '   ·   ' + formatStats(typeof world.perf.stats === 'function' ? world.perf.stats() : world.perf.stats) : ''}`, { color: C.dim, size: 13 });
    if (world.physics) ui.toggle('Physics debug', () => !!A('physicsDebug'), (v) => setSetting('physicsDebug', v), { sub: 'Draw colliders and bodies' });
    ui.heading('Hands & reality');
    ui.text('Dominant hand: RIGHT casts spells and fires weapons, LEFT talks and opens this menu. Swapping hands is not supported yet.', { size: 12, color: C.dim });
    ui.text(input.passthrough ? 'Mixed reality is ON: the menu floats in your room.' : 'Mixed reality: use the ENTER MIXED REALITY button on the start page to see your room behind the world. The menu works there too.', { size: 12, color: C.dim });
    ui.heading('Help');
    ui.row(() => {
      ui.button('How to play', () => open('help'), { icon: 'help', flex: 1 });
      ui.button('Welcome card', () => open('welcome'), { icon: 'summon', flex: 1, kind: 'ghost' });
    });
    ui.text('Omnissiah · a fractal machine-god that listens, weaves and answers. Menu v1.', { size: 12, color: C.faint });
  }
  function formatStats(s) {
    try {
      if (typeof s === 'string') return s;
      if (s?.calls !== undefined) return `${s.calls} draws \u00b7 p95 ${(+s.p95).toFixed(1)} ms${s.level ? ' \u00b7 level ' + s.level : ''}`;
      return s?.frameMs !== undefined ? s.frameMs.toFixed(1) + ' ms' : '';
    } catch { return ''; }
  }

  // ------------------------------------------------------------------------------------------ how to play + welcome
  const CONTROLS = [
    ['Talk (hold)', 'Hold LEFT trigger', 'Pinch left index finger and thumb', 'Hold T'],
    ['Talk (tap)', 'Tap X (left). Tap again cancels', 'Hands-free only', 'Tap N'],
    ['Talk (hands-free)', 'Say "Omnissiah, ..."', 'Say "Omnissiah, ..."', 'Say "Omnissiah, ..."'],
    ['Wrist menu', 'Left B (Y) button', 'Raise left palm to your face', 'M'],
    ['Cast / use / fire', 'Right trigger', 'Pinch right index finger', 'Left mouse (mouse looks)'],
    ['Spell wheel', 'Hold right A', 'Pinch right ring finger', 'Hold E'],
    ['Move / sprint', 'Left stick (press = sprint)', 'Pinch left ring finger: walk where you point', 'W A S D, Shift sprints'],
    ['Turn / jump', 'Right stick / right B', 'Pinch right pinky: turn, then jump', 'Space or Q jumps'],
    ['Grab / throw', 'Grips (squeeze), let go to throw', 'Make a fist, open hand to throw', 'G or right mouse'],
    ['Enter VR', 'ENTER VR button on the start page', 'ENTER VR button on the start page', 'V'],
    ['Press menu buttons', 'Point and pull trigger, or touch with the controller tip', 'Point and pinch, or poke with your index finger', 'Crosshair + click'],
  ];
  function buildHelp(ui) {
    ui.text('The Omnissiah hears you. Speak, and it answers and builds. Everything below also works without the menu.', { size: 13, color: C.dim });
    ui.row(() => { ui.text('', { w: 108 }); ui.text('CONTROLLERS', { flex: 1, size: 11, bold: true, color: C.gold }); ui.text('BARE HANDS', { flex: 1, size: 11, bold: true, color: C.gold }); ui.text('DESKTOP', { w: 96, size: 11, bold: true, color: C.gold }); });
    for (const [a, b, c, d] of CONTROLS) {
      ui.divider();
      ui.row(() => { ui.text(a, { w: 108, bold: true, size: 12 }); ui.text(b, { flex: 1, size: 12, color: C.text }); ui.text(c, { flex: 1, size: 12, color: C.text }); ui.text(d, { w: 96, size: 12, color: C.dim }); });
    }
    ui.gap(6);
    ui.button('Show the welcome card', () => open('welcome'), { icon: 'summon', kind: 'ghost' });
  }
  // the card speaks about the controls the player actually has in hand
  const device = () => (input.left?.tracked || input.right?.tracked ? 'hands' : input.presenting ? 'controllers' : 'desktop');
  const WELCOME = {
    talk: { desktop: 'Hold T and speak, or type in the box at the bottom of the page. Ask for anything.', controllers: 'Hold the LEFT trigger and speak. Ask for anything.', hands: 'Pinch your left index finger and thumb, hold, and speak. Ask for anything.' },
    menu: { desktop: 'Press M for this menu: summon things, choose spells, change the world.', controllers: 'Press Y (left B), or raise your left palm to your face, to summon, cast and tune.', hands: 'Raise your left palm to your face to summon, cast and tune.' },
    wheel: { desktop: 'Mouse casts. Hold E for the spell wheel, point at a spell, let go.', controllers: 'Right trigger casts. Hold right A, point at a spell, let go.', hands: 'Pinch your right index finger to cast. Pinch your right ring finger for the spell wheel.' },
  };
  function buildWelcome(ui) {
    const dv = device();
    ui.text('Three things to know', { size: 22, bold: true, color: C.gold, align: 'center', pad: 4 });
    ui.tile({ title: 'Talk to the Omnissiah', sub: WELCOME.talk[dv], icon: 'mic', color: C.gold, static: true, wrap: true, h: 76, id: 'w1' });
    ui.tile({ title: 'Wrist menu', sub: WELCOME.menu[dv], icon: 'gear', color: '#9fe0ff', static: true, wrap: true, h: 76, id: 'w2' });
    ui.tile({ title: 'Spells', sub: WELCOME.wheel[dv], icon: 'bolt', color: '#c79bff', static: true, wrap: true, h: 76, id: 'w3' });
    ui.gap(6);
    ui.row(() => {
      ui.button('Got it', () => { S.meta.welcomed = true; saveMeta(); close(); }, { kind: 'primary', icon: 'check', flex: 1, h: 50 });
      ui.button('How to play', () => { S.meta.welcomed = true; saveMeta(); open('help'); }, { icon: 'help', flex: 1, h: 50 });
    });
  }

  // ============================================================================================================================
  // surfaces, placement, open / close
  // ============================================================================================================================
  const env = {
    ctx, now: nowMs, panels: () => allPanels(), panelDef, stateFor: (id) => (S.panelState[id] ??= {}),
    close: () => close(), open: (id) => open(id, { keep: true }), currentPanel: () => (win?.surf.visible ? win.panelId : null),
    oracleState: () => oState,
  };
  let oState = '';
  ctx.on('oracle:state', (s) => { const k = ORACLE_STATE[s] ? s : ''; if (k !== oState) { oState = k; if (win?.surf.visible) win.surf.invalidate({ x: 0, y: 0, w: WIN.w, h: WIN.titleH + 8 }); } });
  win = createWindow(THREE, env);
  launcher = createLauncher(THREE, env);
  launcher.layout();
  ctx.root.add(win.surf.group, launcher.surf.group);
  win.surf.group.rotation.order = 'YXZ'; launcher.surf.group.rotation.order = 'YXZ';

  // cursor dot where a hand ray / fingertip meets a panel (one mesh, one draw)
  const cursorTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
    g.beginPath(); g.arc(32, 32, 8, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const cursor = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.02), new THREE.MeshBasicMaterial({
    map: cursorTex, transparent: true, depthTest: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0xffffff,
  }));
  cursor.renderOrder = 9030; cursor.visible = false; cursor.userData.noShadow = cursor.userData.noOutline = true; cursor.name = 'menu:cursor';
  ctx.root.add(cursor);

  // ghost ring: where "Summon here" will put things
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0xffd877, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide,
  }));
  ring.renderOrder = 9005; ring.visible = false; ring.userData.noShadow = ring.userData.noOutline = true; ring.name = 'menu:ghost-ring';
  ctx.root.add(ring);

  let following = false, autoOpened = false, uptime = 0, welcomeAt = 5, launcherIdle = 0, panelTopV = 0;
  const targets = [{ name: 'launcher', obj: launcher, exclude: 'left' }, { name: 'window', obj: win, exclude: null }];
  const winGroup = win.surf.group, lnGroup = launcher.surf.group;

  // Where the window floats. In a headset: 55 cm ahead, a quarter metre below the eyes, tilted up to meet the gaze (comfortable to read
  // while the hands work it). On a flat screen: centred in the view along the look direction, at the distance that makes it fill about
  // 62% of the viewport height and no more than 80% of its width, so every tab, row and button is visible at 1280x720 and at 800x600.
  const DEG = Math.PI / 180;
  function deskDistance() {
    const cam = ctx.camera, fov = (cam.fov || 70) * DEG, aspect = cam.aspect || 1.78;
    const hf = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const dv = (WIN.h * MPP * 0.5) / Math.tan(0.62 * fov / 2), dh = (WIN.w * MPP * 0.5) / Math.tan(0.8 * hf / 2);
    return clamp(Math.max(dv, dh), 0.45, 1.6);
  }
  function windowSpot(out) {
    const head = player.head, f = player.forward;
    if (!input.presenting) {
      const hz = Math.hypot(f.x, f.z), pit = clamp(Math.atan2(f.y, hz), -0.3, 0.3), d = deskDistance(), cp = Math.cos(pit);
      if (hz < 1e-3) v1.set(0, 0, -1); else v1.set(f.x / hz, 0, f.z / hz);
      return out.set(head.x + v1.x * cp * d, head.y + Math.sin(pit) * d, head.z + v1.z * cp * d);
    }
    v1.set(f.x, 0, f.z); if (v1.lengthSq() < 1e-4) v1.set(0, 0, -1); else v1.normalize();
    // the welcome card is a message to be read, not a tool for the hands: a little further and higher, nearer the gaze
    const d = winCard ? 0.72 : 0.55, dy = winCard ? 0.1 : 0.25;
    return out.set(head.x + v1.x * d, head.y - dy, head.z + v1.z * d);
  }
  function faceHead(group, pitchToo) {
    const head = player.head, p = group.position;
    const dx = head.x - p.x, dy = head.y - p.y, dz = head.z - p.z;
    group.rotation.y = Math.atan2(dx, dz);
    group.rotation.x = pitchToo ? clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.9, 0.9) : 0;
  }
  let winCard = false;
  function placeWindow(card) {
    winCard = !!card;
    windowSpot(winGroup.position);
    if (input.presenting) { win.surf.mesh.rotation.x = winCard ? -0.12 : -Math.min(0.5, 0.85 * Math.atan2(0.25, 0.55)); faceHead(winGroup, false); }
    else { win.surf.mesh.rotation.x = 0; faceHead(winGroup, true); }
    win.surf.updatePose();
    following = false;
  }
  const windowIsHandy = () => { // already open somewhere the player can use?
    const head = player.head, p = winGroup.position, dx = p.x - head.x, dz = p.z - head.z, d = Math.hypot(dx, dz);
    if (d > 1.6 || d < 0.2) return false;
    return (dx * player.forward.x + dz * player.forward.z) / d > 0.2;
  };

  function showLauncher() {
    if (cardHandle && cardHandle.state === 'queued') { S.meta.welcomed = true; saveMeta(); cardHandle.cancel(); cardHandle = null; } // they found the menu on their own
    launcher.layout();
    lnGroup.visible = true; launcherIdle = 0;
    poseLauncher(1);
    launcher.surf.hoverKey = launcher.surf.pressKey = null;
    launcher.surf.invalidate(); launcher.surf.flush(nowMs(), true);
    feedback('open', 'left');
    if (!input.presenting) { try { document.exitPointerLock?.(); } catch { /* ignore */ } }
  }
  function hideLauncher() {
    if (!lnGroup.visible) return;
    lnGroup.visible = false;
    releasePointers(launcher);
  }
  // The welcome card is an overlay like any other: it asks the presentation manager (sys/hud.js) for its turn, which holds it back until
  // the Omnissiah's greeting has been read and nothing else is on screen. A player who opens the menu themselves first does not need it.
  let cardHandle = null;
  function requestWelcome() {
    const P = ctx.hud?.present;
    const go = () => { cardHandle = null; open('welcome', { auto: true, place: true }); cardHandle = P ? cardRef : null; };
    let cardRef = null;
    if (!P) { go(); return; }
    cardRef = P.request({ id: 'welcome', kind: 'card', owner: ctx.path, speech: true, delay: 0.3, start: go, drop: () => { welcomeAt = uptime + 20; } });
    cardHandle = cardRef;
  }
  const endCard = () => { const h = cardHandle; cardHandle = null; if (h) h.end(); };
  ctx.onDispose(() => { try { ctx.hud?.present?.cancelOwner(ctx.path); } catch { /* hud gone */ } });

  function open(name, o = {}) {
    if (disposed) return false;
    if (name == null || name === '') { if (!lnGroup.visible) showLauncher(); return true; }
    const id = resolvePanel(name) ?? 'summon';
    if (!o.auto && id !== 'welcome' && cardHandle && cardHandle.state === 'queued') { S.meta.welcomed = true; saveMeta(); cardHandle.cancel(); cardHandle = null; } // they found the menu on their own
    if (id !== 'welcome' && winGroup.visible && win.panelId === 'welcome') endCard();
    const wasVisible = winGroup.visible;
    if (!wasVisible || (!o.keep && !windowIsHandy()) || o.place) placeWindow(id === 'welcome');
    winGroup.visible = true;
    autoOpened = !!o.auto;
    win.show(id);
    hideLauncher();
    win.surf.invalidate(); win.surf.updatePose(); win.surf.flush(nowMs(), true);
    if (!wasVisible) { feedback('open', lastHand); if (!input.presenting) { try { document.exitPointerLock?.(); } catch { /* ignore */ } } }
    if (id === 'summon') seedAim();
    return true;
  }
  function close() {
    const was = winGroup.visible;
    if (was && autoOpened && win.panelId === 'welcome' && !S.meta.welcomed) { S.meta.welcomed = true; saveMeta(); }
    winGroup.visible = false; autoOpened = false; ring.visible = false; following = false;
    releasePointers(win);
    endCard();
    return was;
  }
  function closeAuto() { autoOpened = false; welcomeAt = uptime + 25; close(); } // a fight started: hide it without marking the card as seen
  function toggle() {
    if (winGroup.visible) { close(); return false; }
    if (lnGroup.visible) { hideLauncher(); return false; }
    showLauncher(); return true;
  }
  function seedAim() {
    const a = ctx.aimPoint?.(60);
    if (a) S.aim.copy(a);
    else { v1.set(player.forward.x, 0, player.forward.z).normalize().multiplyScalar(4).add(player.head); S.aim.set(v1.x, ctx.groundAt(v1.x, v1.z), v1.z); }
  }
  function register(spec) {
    if (!spec || typeof spec.build !== 'function') throw new Error('menu.register needs { id, title, build(ui) }');
    const id = String(spec.id ?? spec.title ?? 'panel').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const entry = { ...spec, id, title: String(spec.title ?? titleCase(id)), icon: spec.icon ?? 'star' };
    S.registry[id] = entry;
    launcher.layout(); if (winGroup.visible) win.refreshChrome();
    return () => { if (S.registry[id] === entry) { delete S.registry[id]; launcher.layout(); if (winGroup.visible) { if (win.panelId === id) win.show('summon'); else win.refreshChrome(); } } };
  }

  // ============================================================================================================================
  // input: masking (the trigger never reaches spells / weapons while a hand is on a panel) and pointers
  // ============================================================================================================================
  const raw = { left: { trigger: false, squeeze: false }, right: { trigger: false, squeeze: false } };
  const cap = { left: { trigger: false, squeeze: false }, right: { trigger: false, squeeze: false } };
  let capFlag = false;
  for (const name of ['left', 'right']) {
    const d = input[name].down;
    for (const k of ['trigger', 'squeeze']) {
      raw[name][k] = !!d[k];
      Object.defineProperty(d, k, { configurable: true, enumerable: true, get: () => raw[name][k] && !cap[name][k], set: (v) => { raw[name][k] = !!v; } });
    }
  }
  ctx.onDispose(() => {
    for (const name of ['left', 'right']) {
      const d = input[name].down;
      for (const k of ['trigger', 'squeeze']) Object.defineProperty(d, k, { configurable: true, enumerable: true, writable: true, value: raw[name][k] });
    }
  });

  const desk = { x: 0, y: 0, valid: false, down: false, lastMove: -1e9 };
  const mkPtr = (name) => ({
    name, hand: input[name], mode: 'none', T: null, px: 0, py: 0, t: 0, wd: null, rawTrig: false, prevRaw: false, startedOn: false, down: false, wasDown: false,
    pressWd: null, pressT: null, pressPy: 0, lastPy: 0, scrolling: false, touchArmed: false, touchDown: false, prevSq: false, trigPass: false, sqPass: false, grabbing: false, gDist: 0, gOff: new THREE.Vector3(), activeAt: -1e9,
  });
  const ptr = { left: mkPtr('left'), right: mkPtr('right') };
  const hit = { x: 0, y: 0, t: 0 }, loc = { x: 0, y: 0, z: 0 }, hitB = { x: 0, y: 0, t: 0 };
  const rayO = new THREE.Vector3(), rayD = new THREE.Vector3();

  function rayPose(P) {
    if (input.presenting) {
      if (!P.hand.connected) return false;
      rayO.copy(P.hand.position); rayD.copy(P.hand.direction);
      return true;
    }
    if (P.name !== 'right') return false;
    camera.getWorldPosition(rayO);
    if (globalThis.document?.pointerLockElement || !desk.valid) camera.getWorldDirection(rayD);
    else { rayD.set(desk.x, desk.y, 0.5).unproject(camera).sub(rayO).normalize(); }
    return true;
  }
  function tipPos(P, out) {
    if (!input.presenting || !P.hand.connected) return false;
    if (P.hand.tracked) out.copy(P.hand.fingers.index); else out.copy(P.hand.position).addScaledVector(P.hand.direction, 0.07);
    return true;
  }
  const inBox = (T, l, m) => l.x >= -m && l.x <= T.obj.surf.w + m && l.y >= -m && l.y <= T.obj.surf.h + m;

  function setHover(P, T, wd) {
    const old = P.wd;
    if (old === wd && P.T === T) return;
    if (P.T && old && P.T.obj.surf.hoverKey === old.key) { P.T.obj.surf.hoverKey = null; P.T.obj.invalidateWidget(old); }
    P.wd = wd; P.T = T;
    if (T && wd) { T.obj.surf.hoverKey = wd.key; T.obj.invalidateWidget(wd); feedback('hover', P.name); launcherIdle = 0; }
    else if (T && !wd && T.obj.surf.hoverKey) { T.obj.surf.hoverKey = null; T.obj.surf.invalidate(); }
  }
  function releasePointers(obj) { // a surface went away
    for (const n of ['left', 'right']) {
      const P = ptr[n];
      if (P.T?.obj === obj || P.pressT?.obj === obj) { P.mode = 'none'; P.T = null; P.wd = null; P.pressWd = null; P.pressT = null; P.down = false; P.grabbing = false; P.touchDown = false; P.touchArmed = false; P.scrolling = false; }
    }
    obj.surf.hoverKey = obj.surf.pressKey = null;
  }

  function stepPointer(P, dt) {
    const hand = P.hand, name = P.name;
    P.wasDown = P.down; P.prevRaw = P.rawTrig;
    P.rawTrig = (!input.presenting && !globalThis.document?.pointerLockElement && name === 'right') ? desk.down : raw[name].trigger;
    const sq = raw[name].squeeze;
    // -- find what the hand is on
    let mode = 'none', T = null, bestT = 1e9, got = false;
    const havePose = rayPose(P);
    const haveTip = tipPos(P, v2);
    for (const cand of targets) {
      const surf = cand.obj.surf;
      if (!surf.visible || cand.exclude === name) continue;
      if (haveTip) {
        surf.pointLocal(v2, loc);
        const near = P.mode === 'touch' && P.T === cand ? 0.12 : 0.09;
        if (loc.z > -0.07 && loc.z < near && inBox(cand, loc, 6)) { if (mode !== 'touch' || Math.abs(loc.z) < bestT) { mode = 'touch'; got = true; T = cand; bestT = Math.abs(loc.z); hit.x = loc.x; hit.y = loc.y; hit.t = loc.z; } continue; }
      }
      if (mode !== 'touch' && havePose) {
        const t = surf.rayHit(rayO, rayD, hitB, 12);
        if (t > 0.05 && t < bestT) { mode = 'ray'; got = true; T = cand; bestT = t; hit.x = hitB.x; hit.y = hitB.y; hit.t = t; }
      }
    }
    // -- press state
    if (!P.rawTrig) { P.startedOn = false; P.trigPass = false; }
    else if (!P.prevRaw) { P.startedOn = mode === 'ray'; P.trigPass = mode === 'none'; }
    if (!sq) P.sqPass = false; else if (!P.prevSq) P.sqPass = mode === 'none';
    const rayHeld = P.rawTrig && P.startedOn;
    if (mode === 'none' && rayHeld && P.pressT) { mode = 'ray'; T = P.pressT; } // dragged off the panel while holding: stay in the gesture
    else if (mode === 'touch') {
      const z = hit.t;
      if (!P.touchArmed) { if (z > 0.03) P.touchArmed = true; }
      else if (!P.touchDown && z < 0.006) P.touchDown = true;
      else if (P.touchDown && z > 0.026) P.touchDown = false;
      if (z < -0.045 && !P.touchDown) P.touchArmed = false;
    } else { P.touchArmed = false; P.touchDown = false; }
    if (mode === 'touch' || mode === 'ray') {
      if (got) { P.px = clamp(hit.x, 0, T.obj.surf.w); P.py = clamp(hit.y, 0, T.obj.surf.h); P.t = hit.t; }
    }
    const prevMode = P.mode; P.mode = mode;
    P.down = mode === 'touch' ? P.touchDown : mode === 'ray' ? rayHeld : false;

    // -- masks
    cap[name].trigger = (mode !== 'none' || rayHeld) && !P.trigPass;
    cap[name].squeeze = (mode !== 'none' || P.grabbing) && !P.sqPass;

    if (mode === 'none') {
      if (P.T) setHover(P, null, null);
      if (P.pressWd) { P.pressT?.obj.invalidateWidget(P.pressWd); if (P.pressT) P.pressT.obj.surf.pressKey = null; P.pressWd = null; }
      if (P.grabbing && !sq) P.grabbing = false;
      P.prevSq = sq;
      return;
    }
    P.activeAt = nowMs();
    lastHand = name;
    launcherIdle = 0;

    // -- window move (squeeze on the title bar)
    if (P.grabbing) {
      if (!sq) P.grabbing = false;
      else if (havePose) {
        v3.copy(rayO).addScaledVector(rayD, P.gDist).add(P.gOff);
        winGroup.position.lerp(v3, 1 - Math.exp(-22 * dt));
        faceHead(winGroup, false);
      }
    }
    const wd = P.grabbing ? null : T.obj.pick(P.px, P.py);
    if (!P.grabbing && sq && !P.prevSq && T.name === 'window' && T.obj.isTitle(P.px, P.py) && !wd && havePose) {
      P.grabbing = true; P.gDist = P.t;
      v3.copy(rayO).addScaledVector(rayD, P.t);
      P.gOff.copy(winGroup.position).sub(v3);
      following = false;
      feedback('click', name);
    }
    P.prevSq = sq;
    setHover(P, T, wd);

    // -- press / drag / release
    const surf = T.obj.surf;
    if (P.down && !P.wasDown) {
      P.pressWd = wd; P.pressT = T; P.pressPy = P.py; P.lastPy = P.py; P.scrolling = false;
      surf.pressKey = wd?.key ?? null;
      if (wd) { T.obj.invalidateWidget(wd); hand.pulse?.(0.2, 18); }
      if (wd?.slider) T.obj.dragSlider(wd, P.px);
    } else if (P.down && P.pressT) {
      const pw = P.pressWd;
      if (pw?.slider) T.obj.dragSlider(pw, P.px);
      else {
        if (!P.scrolling && Math.abs(P.py - P.pressPy) > 10 && T.obj.canScroll(pw ?? wd)) { P.scrolling = true; if (surf.pressKey) { const o = pw; surf.pressKey = null; if (o) T.obj.invalidateWidget(o); } }
        if (P.scrolling) T.obj.scrollBy(P.lastPy - P.py, pw ?? wd);
      }
      P.lastPy = P.py;
    } else if (!P.down && P.wasDown && P.pressT) {
      const pw = P.pressWd, TT = P.pressT;
      TT.obj.surf.pressKey = null;
      if (pw) TT.obj.invalidateWidget(pw);
      if (!P.scrolling && pw && wd && wd.key === pw.key && !pw.slider && TT === T) { feedback('click', name); TT.obj.click(wd); }
      else if (pw?.slider) { feedback('click', name); if (TT.name === 'window' && win.panelId) win.rebuild(); }
      P.pressWd = null; P.pressT = null; P.scrolling = false;
    }
    // thumbstick scroll
    const sy = input.right.stick.y;
    if (mode !== 'none' && Math.abs(sy) > 0.35 && name === 'right') T.obj.scrollBy(sy * 700 * dt, wd);
  }

  // ------------------------------------------------------------------------------------------ gestures / placement per frame
  let palmHold = 0, palmLatched = false, lastGaze = false;
  const lnPos = new THREE.Vector3();
  function palmUp(dt) {
    const L = input.left;
    if (input.presenting && L.connected && !L.tracked && L.pressed('b')) { toggle(); return false; }
    if (!L.tracked || !L.connected || !input.presenting) { palmHold = 0; palmLatched = false; return false; }
    const F = L.fingers, head = player.head;
    v0.copy(head).sub(F.palm); const d = v0.length();
    const ok = d > 0.15 && d < 0.72 && F.palmNormal.dot(v0.multiplyScalar(1 / d)) > 0.55 && F.palm.y > head.y - 0.7 && F.gesture !== 'fist' && F.gesture !== 'pinch';
    if (!ok) { palmHold = 0; palmLatched = false; return false; }
    palmHold += dt;
    if (palmHold > 0.4 && !palmLatched) { palmLatched = true; if (winGroup.visible) close(); else toggle(); }
    return true;
  }
  function poseLauncher(snap, dt = 0.016) {
    const L = input.left, head = player.head;
    if (L.tracked && L.connected) { const F = L.fingers; v4.copy(F.wrist).addScaledVector(F.palmNormal, 0.1); v4.y += 0.06; }
    else { v4.copy(L.position); v0.copy(head).sub(v4); v0.y = 0; if (v0.lengthSq() > 1e-4) v0.normalize().multiplyScalar(0.06); v4.add(v0); v4.y += 0.13; }
    if (snap) lnPos.copy(v4); else lnPos.lerp(v4, 1 - Math.exp(-20 * dt));
    lnGroup.position.copy(lnPos);
    faceHead(lnGroup, true);
    launcher.surf.updatePose();
  }

  const shownSurfaces = [launcher.surf, win.surf];
  function gazeTest() {
    let g = false;
    for (const s of shownSurfaces) {
      if (!s.visible) continue;
      s.mesh.getWorldPosition(v0); v0.sub(player.head).normalize();
      if (v0.dot(player.forward) > 0.86) { g = true; break; }
    }
    if (g !== lastGaze) { lastGaze = g; ctx.hud?.setGaze?.(g); }
    return g;
  }
  function combatNear() {
    const c = world.combat; if (!c || !c.fighters) return false;
    for (const f of c.fighters) {
      if (f.faction !== 'enemy' || !f.alive) continue;
      const p = f.actor?.group?.position ?? f.actor?.position ?? f.actor?.object?.position;
      if (!p) continue;
      if (Math.hypot(p.x - player.head.x, p.z - player.head.z) < 22) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------ desktop mouse / keys
  const dom = ctx.renderer?.domElement;
  const onMove = (e) => {
    if (input.presenting || !dom) return;
    const r = dom.getBoundingClientRect();
    desk.x = ((e.clientX - r.left) / r.width) * 2 - 1; desk.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    desk.valid = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; desk.lastMove = nowMs();
  };
  const onDown = (e) => {
    if (input.presenting || globalThis.document?.pointerLockElement || e.button !== 0) return;
    if (ptr.right.mode !== 'none') { desk.down = true; e.stopImmediatePropagation(); e.preventDefault(); }
  };
  const onUp = () => { desk.down = false; };
  const onWheel = (e) => {
    if (input.presenting || ptr.right.mode === 'none') return;
    ptr.right.T?.obj.scrollBy(e.deltaY * 0.6, ptr.right.wd); e.preventDefault();
  };
  const typing = () => /^(INPUT|TEXTAREA)$/.test(globalThis.document?.activeElement?.tagName ?? '');
  const onKey = (e) => {
    if (typing()) return;
    if (e.code === 'KeyM' && !e.repeat) { toggle(); }
    else if (e.code === 'Escape' && (winGroup.visible || lnGroup.visible)) { close(); hideLauncher(); }
  };
  if (globalThis.window?.addEventListener) {
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', onKey);
    const onResize = () => { if (winGroup.visible && !input.presenting) placeWindow(winCard); };   // the window is sized to the viewport on a flat screen
    window.addEventListener('resize', onResize);
    ctx.onDispose(() => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mousedown', onDown, true); window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('wheel', onWheel, true); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
    });
  }

  // ------------------------------------------------------------------------------------------ events
  ctx.on('module:loaded', (e) => {
    applySettings(e?.path);
    if (winGroup.visible) win.requestRebuild();
  });
  ctx.on('xr:start', () => {
    if (winGroup.visible) placeWindow(win.panelId === 'welcome');
    if (lnGroup.visible) hideLauncher();
    if (!S.meta.welcomed) welcomeAt = uptime + 2.5;
  });
  ctx.on('xr:end', () => { if (winGroup.visible) placeWindow(win.panelId === 'welcome'); });
  for (const ev of ['spell:select', 'weapon:grab', 'quest:started', 'quest:progress', 'quest:completed']) ctx.on(ev, () => { if (winGroup.visible) win.requestRebuild(); });
  ctx.on('player:hurt', () => { if (autoOpened && winGroup.visible) closeAuto(); });
  applySettings();

  // ============================================================================================================================
  // per frame
  // ============================================================================================================================
  let ringT = 0, combatT = 0, errCount = 0;
  // A throwing frame must never leave a hand's trigger masked: clear the masks, keep going, and only give up after 30 failures in a row.
  function update(dt) {
    try { step(dt); errCount = 0; } catch (err) {
      cap.left.trigger = cap.left.squeeze = cap.right.trigger = cap.right.squeeze = false; capFlag = false;
      if (++errCount === 1) console.warn('[menu] frame failed', err);
      if (errCount >= 30) { close(); hideLauncher(); throw err; }
    }
  }
  function step(dt) {
    uptime += dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    const palm = palmUp(dt);

    // smooth turning (the player module only knows snap turning)
    const P = world.player;
    if (P && S.settings.turn === 'smooth' && input.presenting && P.enabled !== false && !world.spells?.stickBusy?.()) {
      if (P.snapEnabled !== false) P.snapEnabled = false;
      const x = input.right.stick.x;
      if (Math.abs(x) > 0.2 && !ptr.right.hand.down.stickPress) {
        const ang = -x * 1.9 * dt, head = player.head, c = Math.cos(ang), s = Math.sin(ang), rig = ctx.rig;
        const dx = rig.position.x - head.x, dz = rig.position.z - head.z;
        rig.position.x = head.x + dx * c + dz * s; rig.position.z = head.z - dx * s + dz * c; rig.rotation.y += ang;
      }
    }

    const winOn = winGroup.visible, lnOn = lnGroup.visible;
    if (!winOn && !lnOn) {
      if (capFlag) { cap.left.trigger = cap.left.squeeze = cap.right.trigger = cap.right.squeeze = false; capFlag = false; }
      if (lastGaze) { lastGaze = false; ctx.hud?.setGaze?.(false); }
      if (cursor.visible) cursor.visible = false;
      // The awakening (core/intro.js) is the richer first-run tutorial: while it plays the card stays away, and once it has run the card is not needed.
      const I = world.intro;
      if (I && !S.meta.welcomed) {
        if (I.running) { if (cardHandle && cardHandle.state === 'queued') { cardHandle.cancel(); cardHandle = null; } welcomeAt = Math.max(welcomeAt === Infinity ? 0 : welcomeAt, uptime + 5); }
        else if (I.done) { S.meta.welcomed = true; saveMeta(); if (cardHandle && cardHandle.state === 'queued') { cardHandle.cancel(); cardHandle = null; } }
      }
      if (cardHandle && cardHandle.state === 'queued' && combatNear()) { cardHandle.cancel(); cardHandle = null; welcomeAt = uptime + 25; }
      if (!S.meta.welcomed && uptime >= welcomeAt && !combatNear()) { welcomeAt = Infinity; requestWelcome(); }
      return;
    }
    const tNow = nowMs();

    // poses
    if (lnOn) {
      poseLauncher(0, dt);
      launcherIdle += dt;
      if (palm) launcherIdle = 0;
      if (launcherIdle > 6) hideLauncher();
    }
    if (winOn) {
      if (!ptr.left.grabbing && !ptr.right.grabbing) {
        const dx = winGroup.position.x - player.head.x, dz = winGroup.position.z - player.head.z;
        if (!following && dx * dx + dz * dz > 4) following = true; // walked more than 2 m away: catch up
        if (following) {
          windowSpot(v3); winGroup.position.lerp(v3, 1 - Math.exp(-4 * dt));
          if (winGroup.position.distanceToSquared(v3) < 0.01) following = false;
        }
        faceHead(winGroup, !input.presenting);
      }
      win.surf.updatePose();
      // elevation of the window's top edge as seen from the head: the subtitles ride just above it (sys/hud.js)
      win.surf.mesh.localToWorld(v0.set(0, WIN.h * MPP * 0.5, 0));
      panelTopV = Math.atan2(v0.y - player.head.y, Math.hypot(v0.x - player.head.x, v0.z - player.head.z));
    }

    // pointers
    for (const n of ['left', 'right']) stepPointer(ptr[n], dt);
    capFlag = cap.left.trigger || cap.right.trigger;

    // cursor on the surface of the most recently active pointer
    const A = ptr.right.activeAt >= ptr.left.activeAt ? ptr.right : ptr.left;
    if (A.mode !== 'none' && A.T) {
      const s = A.T.obj.surf;
      cursor.position.set((A.px - s.w / 2) * s.mpp, (s.h / 2 - A.py) * s.mpp, 0.0035);
      s.mesh.localToWorld(cursor.position);
      s.mesh.getWorldQuaternion(cursor.quaternion);
      const hot = !!A.wd, press = A.down;
      cursor.scale.setScalar(press ? 0.7 : hot ? 1.5 : 1);
      cursor.material.color.setHex(press ? 0xffffff : hot ? 0xffd877 : 0xb9c3ff);
      cursor.visible = true;
    } else cursor.visible = false;

    if (winOn) win.tick(tNow);
    if (lnOn) launcher.tick(tNow);
    if (winOn) win.surf.flush(tNow);
    if (lnOn) launcher.surf.flush(tNow);

    gazeTest();

    // ghost ring while a Summon detail card is open
    const sumSt = S.panelState.summon;
    const wantRing = winOn && win.panelId === 'summon' && !!sumSt?.sel;
    if (wantRing) {
      ringT -= dt;
      if (ringT <= 0) {
        ringT = 0.05;
        const H = ptr.right.mode === 'none' && input.right.connected ? input.right : !input.right.connected ? null : (ptr.left.mode === 'none' && input.left.connected && input.presenting ? input.left : null);
        if (H) { const a = ctx.aimPoint?.(60, H); if (a) S.aim.copy(a); }
        const rad = Math.max(0.5, (sumSt.count ?? 1) > 1 ? sumSt.spread ?? 3 : 0.5);
        ring.position.set(S.aim.x, ctx.groundAt(S.aim.x, S.aim.z) + 0.06, S.aim.z);
        ring.scale.setScalar(rad);
        ring.material.opacity = 0.55 + 0.3 * Math.sin(tNow / 220);
      }
      ring.visible = true;
    } else if (ring.visible) ring.visible = false;

    // never auto-open into a fight
    if (autoOpened && winOn) {
      combatT -= dt;
      if (combatT <= 0) { combatT = 0.5; if (combatNear()) closeAuto(); }
    }
  }

  const api = {
    version: 1,
    open, close, toggle, register,
    unregister: (id) => { delete S.registry[id]; launcher.layout(); },
    get capturing() { return capFlag; },
    get isOpen() { return winGroup.visible; },
    get panelTop() { return winGroup.visible ? panelTopV : null; },   // elevation (rad) of the open window's top edge, seen from the head
    get launcherOpen() { return lnGroup.visible; },
    get panel() { return winGroup.visible ? win.panelId : null; },
    get gaze() { return lastGaze; },
    panels: () => allPanels().filter((p) => !p.card).map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    summoned: () => mine.length, clearSummoned: clearMine,
    // introspection for tests and tooling
    _t: { win, launcher, ptr, targets, raw, cap, cursor, ring, S, setSetting, getSetting, SETTINGS, summon, mine, log, chatLines, placeWindow, poseLauncher, showLauncher, hideLauncher, stepPointer, update, fpsRef: () => fps },
  };
  ctx.provide('menu', api);
  ctx.onDispose(() => {
    disposed = true;
    for (const m of mine.splice(0)) { try { (m.handle ?? m.weapon)?.remove?.(); } catch { /* gone */ } }
    for (const w of weather.values()) { try { w.remove(); } catch { /* gone */ } }
    win.surf.dispose(); launcher.surf.dispose(); cursor.geometry.dispose(); cursor.material.dispose(); cursorTex.dispose(); ring.geometry.dispose(); ring.material.dispose();
    ctx.hud?.setGaze?.(false);
  });
  if (S.reopen) { const id = S.reopen; S.reopen = null; open(id, { place: true }); }
  ctx.onDispose(() => { S.reopen = winGroup.visible ? win.panelId : null; });
  return { update };
}
