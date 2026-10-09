// STABLE CORE: the HUD. Subtitles, toasts, an objective line, banners and the quest tracker share ONE skin (warm dark walnut panels, thin brass rim, parchment text), the
// presentation manager (hud.present), a listening / thinking indicator and generation chips near the left hand, a comfort vignette and the shared UI design tokens.
//
// WHERE THINGS APPEAR (flat screen = real DOM, crisp and scaled with the window; headset = world-space canvas panels, never any DOM; hud.setMode('world'|'dom'|'auto') to force)
//   SUBTITLES   bottom centre, ONE block (>= 100 px above the bottom edge on a flat screen): the newest line only (newer replaces older), at most ~2 lines per page, long lines turn
//               pages in step with the speech. Speakers: Omnissiah = gold italic; the player = pale, in quotes; NPCs = "Name:" in their faction colour. It leaves when the speaker
//               stops (oracle:line-end), when its time is up, on Esc, and when the intro is skipped (intro:done / intro:complete with skipped).
//   TOASTS      top centre under the objective, ONE slot: a toast shows alone, the next waits (queue of 3, oldest dropped), a toast with the same key replaces the one before it,
//               2-7 s whatever the caller asked for (a toast is a glance, not a notice board).
//   OBJECTIVE   hud.objective(text | null, sub?) one persistent line at the top centre (tutorial step / current goal). null clears it. Flat screen: DOM; headset: a world panel above the view.
//   TRACKER / BANNER  drawn by core/quests.js with UI.glass and placed with hud.follow: in a headset they trail the head softly; on a flat screen the tracker is DOCKED top-right (not
//               mid-scene) and the banner sits as a ribbon above the horizon. UI.glass paints a swallowtail ribbon when the canvas is wide (w / h > 2.6), a framed card otherwise.
//   INDICATOR   A small second panel floating above the LEFT hand (desktop: low in the view, left of centre): the oracle state (listening / hearing / thinking / weaving) with a
//               pulsing dot, plus up to two progress chips for net:gen3d_status and net:audio_status. Hidden when empty or while the wrist launcher is open.
//   COMFORT VIGNETTE  A head-locked soft black ring that closes in while the rig moves fast or turns fast. hud.setComfort({ enabled: false }); strength 0.2..1.
//
// PRESENTATION  hud.present arbitrates every attention-grabbing overlay so two never share the view: card (welcome card) > banner (quest / level banners) > toast (hud.show). At most
//   one is ACTIVE; the rest queue. Banners and toasts also wait while a menu panel is open (world.menu.isOpen) and toasts while a card or banner is due or active.
//     const h = hud.present.request({ id, kind: 'card'|'banner'|'toast'|'critical', owner: ctx.path, delay = 0, maxWait, hold, speech, when,
//                                      start(h), end(reason), drop(), refresh() })    -> handle { state, end(reason), cancel() }
//     start(h) runs when the overlay may appear (draw it); call h.end() when it is done (or give hold = seconds and the manager ends it);
//     end(reason) is called when it stops ('done'|'timeout'|'preempted'|'cancelled'); drop() when it waited longer than maxWait.
//     hud.present.cancelOwner(owner) removes everything an owner has queued or active (call it from a module's dispose: hot reload safe).
//     hud.present.pending(kind) / .busy(kind) / .active() / .quiet(kind) for gating decisions (e.g. quests wait for the welcome card).
//   Speech subtitles (say / npc / player) are not overlays: they are the story and never wait.
// UI TOKENS  hud.ui (also `export const UI`): palette, type scale, plate / glass / ribbon painters. menu.js, quests.js and this file draw from it.
//
// Events consumed: net:speak {text, audio}  net:transcript {text}  net:npc_reply {id, text, name?, faction?}  net:notice {level, text}  net:gen3d_status  net:audio_status
//   oracle:state   oracle:line {text, duration} / oracle:line-end {text} (from sys/voice.js: keep a subtitle exactly while its audio plays)   intro:done|intro:complete {skipped}
// API: show(text, seconds = 3, kind = 'toast'|'notice'|'error'|'critical', key?)  objective(text|null, sub?)  say(text, hasAudio)  player(text)  npc(name, faction, text)
//      clear() (subtitles + toasts)  dismiss()  update(dt)  setGaze(bool) gaze  setComfort({ enabled, strength }) getComfort()  follow(object3D, { yaw, pitch, distance, stiffness, dock })
//      setMode(m) mode  debug() (state snapshot for tests)  present ui mesh aux       window.game.hud is set on the first frame.

// ---------------------------------------------------------------------------------------------- shared design tokens
export const UI = {
  // humanist, no downloads: Candara / Segoe UI on Windows, the system face elsewhere
  font: 'Candara, "Segoe UI", "Gill Sans MT", "Gill Sans", Optima, "Trebuchet MS", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif',
  emojiFont: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
  // dark walnut panels, brass rims, parchment text
  color: {
    bg0: '#1c130c', bg1: '#2e2014', glassTop: 'rgba(62,44,29,0.95)', glassBottom: 'rgba(34,23,14,0.95)', plate: 'rgba(40,28,18,0.86)',
    edge: 'rgba(205,160,88,0.55)', rail: 'rgba(18,10,4,0.40)',
    text: '#f6ead2', dim: '#d2bd96', faint: '#a28f6c',
    gold: '#f2c969', gold2: '#d49b3c', goldEdge: '#b98a3c', goldDark: '#2a1a06', goldSoft: 'rgba(242,201,105,0.18)',
    accent: '#e0b062', good: '#a3d58c', bad: '#ec8a76', warn: '#ecb865', info: '#a9d6cb', violet: '#d3b0dc', player: '#d4e4ec',
    fill: 'rgba(255,236,200,0.075)', fillHot: 'rgba(242,201,105,0.18)', fillDown: 'rgba(242,201,105,0.34)', line: 'rgba(255,236,200,0.14)',
    paper: '#f4e6c6', paper2: '#e8d4a8', ink: '#3a2714', brass: '#c99a4e', brassLight: '#f0d089', brassDark: '#8a6226',
  },
  faction: { enemy: '#f19a86', friendly: '#a9dc98', neutral: '#eedfb0' },
  // logical px on menu surfaces (1.2 mm each: 13 px = 15.6 mm = about 1.6 degrees at 55 cm, readable at 25 px/degree)
  type: { micro: 12, small: 13, body: 14, label: 15, title: 18, hero: 24 },
  radius: { sm: 12, md: 18, lg: 24 },
  // rounded rectangle path
  rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  },
  // brass rim colour ramp (top-left light, middle dark, bottom-right light)
  rim(g, w, h) {
    const c = UI.color, gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, c.brassLight); gr.addColorStop(0.5, c.brassDark); gr.addColorStop(1, c.brass);
    return gr;
  },
  // one framed walnut panel: soft shadow, vertical gradient, warm top light, brass rim, inner hairline. o: { shadow = 0 (blur px), rim = 3, top, bottom }
  plate(g, x, y, w, h, r, o = {}) {
    const c = UI.color, rr = UI.rrect;
    g.save();
    if (o.shadow) { g.shadowColor = 'rgba(16,8,2,0.5)'; g.shadowBlur = o.shadow; g.shadowOffsetY = Math.round(o.shadow * 0.28); }
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, o.top ?? c.glassTop); gr.addColorStop(1, o.bottom ?? c.glassBottom);
    rr(g, x, y, w, h, r); g.fillStyle = gr; g.fill();
    g.restore();
    const hl = g.createLinearGradient(0, y, 0, y + h * 0.5);
    hl.addColorStop(0, 'rgba(255,214,150,0.13)'); hl.addColorStop(1, 'rgba(255,214,150,0)');
    rr(g, x, y, w, h, r); g.fillStyle = hl; g.fill();
    rr(g, x, y, w, h, r); g.lineWidth = o.rim ?? 3; g.strokeStyle = UI.rim(g, x + w, y + h); g.stroke();
    const ins = (o.rim ?? 3) + 3;
    rr(g, x + ins, y + ins, w - 2 * ins, h - 2 * ins, Math.max(3, r - ins)); g.lineWidth = 1; g.strokeStyle = 'rgba(240,208,137,0.24)'; g.stroke();
  },
  // swallowtail ribbon for wide banners
  ribbon(g, w, h) {
    const c = UI.color, nd = Math.min(36, h * 0.12), y0 = 12, y1 = h - 12, x0 = 6, x1 = w - 6, mid = h / 2;
    const path = (i) => { g.beginPath(); g.moveTo(x0 + i, y0 + i); g.lineTo(x1 - i, y0 + i); g.lineTo(x1 - nd - i * 0.4, mid); g.lineTo(x1 - i, y1 - i); g.lineTo(x0 + i, y1 - i); g.lineTo(x0 + nd + i * 0.4, mid); g.closePath(); };
    g.lineJoin = 'round';
    g.save(); g.shadowColor = 'rgba(16,8,2,0.5)'; g.shadowBlur = 16; g.shadowOffsetY = 5;
    const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c.glassTop); gr.addColorStop(1, c.glassBottom);
    path(0); g.fillStyle = gr; g.fill(); g.restore();
    const hl = g.createLinearGradient(0, y0, 0, mid); hl.addColorStop(0, 'rgba(255,214,150,0.15)'); hl.addColorStop(1, 'rgba(255,214,150,0)');
    path(0); g.fillStyle = hl; g.fill();
    path(0); g.lineWidth = 3.5; g.strokeStyle = UI.rim(g, w, h); g.stroke();
    path(9); g.lineWidth = 1.2; g.strokeStyle = 'rgba(240,208,137,0.30)'; g.stroke();
    for (const [px, py] of [[x0 + nd + 12, mid], [x1 - nd - 12, mid]]) { g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 6, py); g.lineTo(px, py + 6); g.lineTo(px - 6, py); g.closePath(); g.fillStyle = c.brassLight; g.globalAlpha = 0.7; g.fill(); g.globalAlpha = 1; }
  },
  // the card look shared by the quest tracker and the banners (wide canvases get the ribbon)
  glass(g, w, h, r) {
    if (w / h > 2.6) { UI.ribbon(g, w, h); return; }
    UI.plate(g, 6, 6, w - 12, h - 12, r, { shadow: 12, rim: 3.5 });
  },
};

// ---------------------------------------------------------------------------------------------- presentation manager
const PRIO = { critical: 4, card: 3, banner: 2, toast: 1 };
// maxWait: seconds a queued overlay may wait before it is dropped; gap: calm seconds after it ends; panel: waits while a menu panel is open;
// after: kinds that must not be due or active; preemptible: a card or critical may cut it short
const KIND = {
  critical: { maxWait: 3, gap: 0.2, panel: false, after: [], preemptible: false },
  card: { maxWait: Infinity, gap: 0.8, panel: false, after: [], preemptible: false },
  banner: { maxWait: 180, gap: 0.9, panel: true, after: ['card'], preemptible: false },
  toast: { maxWait: 8, gap: 0.35, panel: true, after: ['card', 'banner'], preemptible: true },
};
const QUEUE_CAP = { toast: 3, banner: 6, card: 4, critical: 2 };

export function createPresenter({ panelOpen = () => false, speaking = () => false } = {}) {
  let t = 0, seq = 0, active = null, gapUntil = 0;
  const queue = [];

  function finish(item, reason) { // an item leaves (queued or active)
    if (item.state === 'done') return;
    const was = item.state;
    item.state = 'done';
    if (was === 'active') { active = null; gapUntil = t + item.gap; }
    const i = queue.indexOf(item); if (i >= 0) queue.splice(i, 1);
    try {
      if (was === 'active') item.end?.(reason);
      else if (reason === 'timeout') item.drop?.();
    } catch (err) { console.error('[present] handler failed', err); }
  }
  const due = (item) => t >= item.notBefore - 0.0001;

  function blockedBy(item) {
    if (t < item.notBefore - 0.0001) return true;
    if (item.when) { let ok = true; try { ok = !!item.when(); } catch { ok = true; } if (!ok) return true; }
    if (item.panel && panelOpen()) return true;
    if (item.speech && t < item.notBefore + item.speechWait && speaking()) return true;
    for (let k = 0; k < item.after.length; k++) {
      const kind = item.after[k];
      if (active && active.kind === kind) return true;
      for (let i = 0; i < queue.length; i++) { const q = queue[i]; if (q !== item && q.kind === kind && due(q)) return true; }
    }
    return false;
  }

  function request(spec = {}) {
    const kind = PRIO[spec.kind] ? spec.kind : 'toast';
    const d = KIND[kind];
    const id = String(spec.id ?? kind + ':' + (++seq));
    const owner = spec.owner ?? null;
    // the same overlay asked for again: refresh it instead of stacking
    if (active && active.id === id && active.owner === owner) {
      active.holdUntil = spec.hold > 0 ? t + spec.hold : active.holdUntil;
      try { spec.refresh?.(); active.refresh = spec.refresh ?? active.refresh; } catch (err) { console.error('[present] refresh failed', err); }
      return active.handle;
    }
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id && queue[i].owner === owner) { queue[i].state = 'done'; queue.splice(i, 1); }
    const item = {
      id, kind, owner, prio: PRIO[kind], seq: ++seq, born: t, state: 'queued',
      notBefore: t + Math.max(0, +spec.delay || 0),
      expireAt: t + Math.max(0, +spec.delay || 0) + (spec.maxWait ?? d.maxWait),
      hold: spec.hold > 0 ? spec.hold : Infinity, holdUntil: Infinity, gap: spec.gap ?? d.gap,
      panel: spec.panel ?? d.panel, after: spec.after ?? d.after, preemptible: spec.preemptible ?? d.preemptible,
      speech: !!spec.speech, speechWait: spec.speechWait ?? 12,
      when: spec.when, start: spec.start, end: spec.end, drop: spec.drop, refresh: spec.refresh, startedAt: -1,
    };
    item.handle = {
      id, kind,
      get state() { return item.state; },
      end(reason = 'done') { finish(item, reason); },
      cancel() { finish(item, 'cancelled'); },
    };
    queue.push(item);
    const cap = QUEUE_CAP[kind];
    let n = 0; for (const q of queue) if (q.kind === kind) n++;
    while (n > cap) { const old = queue.find((q) => q.kind === kind); if (!old || old === item) break; old.state = 'done'; queue.splice(queue.indexOf(old), 1); try { old.drop?.(); } catch { /* ignore */ } n--; }
    pump();
    return item.handle;
  }

  function begin(item) {
    const i = queue.indexOf(item); if (i >= 0) queue.splice(i, 1);
    item.state = 'active'; item.startedAt = t; active = item;
    if (item.hold !== Infinity) item.holdUntil = t + item.hold;
    try { item.start?.(item.handle); } catch (err) { console.error('[present] start failed', err); finish(item, 'cancelled'); }
  }

  function pump() {
    // expire what waited too long
    for (let i = queue.length - 1; i >= 0; i--) { const q = queue[i]; if (t > q.expireAt) finish(q, 'timeout'); }
    let best = null;
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (blockedBy(q)) continue;
      if (!best || q.prio > best.prio || (q.prio === best.prio && q.seq < best.seq)) best = q;
    }
    if (!best) return;
    if (active) {
      if (best.prio > active.prio && active.preemptible && best.prio >= PRIO.card) { finish(active, 'preempted'); begin(best); }
      return;
    }
    if (t >= gapUntil || best.prio >= PRIO.critical) begin(best);
  }

  function update(dt) {
    t += Math.min(Math.max(dt || 0, 0), 0.5);
    if (active && t >= active.holdUntil) finish(active, 'timeout');
    pump();
  }

  const count = (kind) => { let n = 0; for (let i = 0; i < queue.length; i++) if (queue[i].kind === kind) n++; return n; };
  return {
    request, update,
    end(id, reason = 'done') { if (active && active.id === id) finish(active, reason); else for (const q of queue.slice()) if (q.id === id) finish(q, 'cancelled'); },
    cancel(id) { this.end(id, 'cancelled'); },
    cancelOwner(owner) {
      if (owner == null) return;
      if (active && active.owner === owner) finish(active, 'cancelled');
      for (const q of queue.slice()) if (q.owner === owner) finish(q, 'cancelled');
    },
    clear(kind) { if (active && (!kind || active.kind === kind)) finish(active, 'cancelled'); for (const q of queue.slice()) if (!kind || q.kind === kind) finish(q, 'cancelled'); },
    // queued (not yet shown) overlays of a kind
    pending(kind) { return kind ? count(kind) : queue.length; },
    // an overlay of this kind is queued or on screen
    busy(kind) { return (active && (!kind || active.kind === kind) ? 1 : 0) + count(kind) > 0; },
    // nothing of this kind (or of higher rank) is queued or active
    quiet(kind) { const p = PRIO[kind] ?? 0; if (active && active.prio >= p) return false; for (const q of queue) if (q.prio >= p) return false; return true; },
    active() { return active ? { id: active.id, kind: active.kind, owner: active.owner, since: t - active.startedAt } : null; },
    get time() { return t; },
    get size() { return queue.length + (active ? 1 : 0); },
  };
}

// ---------------------------------------------------------------------------------------------- the HUD
const PLANE_W = 1.4;
const DISTANCE = 1.3;
const BASE_PITCH_VR = -0.2;   // radians below the lagged look direction (about 0.26 m under the eyes at 1.3 m)
const RAISE_PITCH = 0.3;      // plane centre this far above the panel's top edge while a panel is open (text block ends up just above it)
const MAX_PITCH = 0.66;       // never lift the plane higher than this (about 38 degrees)
const RENDER_ORDER = 9999;

const SUB_W = 1024, SUB_H = 256;
const MAX_ITEMS = 8;
const PAGE_CHARS = 96;        // a subtitle page: about two lines on a flat screen, three in a headset
const FADE_IN = 0.25;
const FADE_OUT = 0.6;
const PENDING_LIFE = 40;      // an audio subtitle waits at most this long for oracle:line-end
const LOG_LINES = 5;
const LOG_TTL_MS = 25000;
const TOAST_MIN = 1.8, TOAST_MAX = 7;

const FONT_FAMILY = UI.font;
const C = UI.color;
const FACTION_COLOR = UI.faction;
const STATES = {
  listening: { text: 'Listening', color: '#a9d8cc' },
  transcribing: { text: 'Hearing you', color: '#e8d6a2' },
  thinking: { text: 'Thinking', color: '#dcc3e4' },
  coding: { text: 'Weaving', color: '#f2c969' },
};
const STATE_IDS = { listening: 1, transcribing: 2, thinking: 3, coding: 4 };

// indicator panel
const AUX_W = 512, AUX_H = 256, AUX_PW = 0.3, AUX_PH = 0.15;
const GEN_STAGES = { // state -> progress fraction when it starts, and the next stage's start
  gen3d: { queued: [0.06, 0.2], imagining: [0.2, 0.55], sculpting: [0.55, 0.95], done: [1, 1] },
  audio: { queued: [0.08, 0.3], generating: [0.3, 0.92], done: [1, 1] },
};
// flat-screen docks for panels that ride on hud.follow (by object name): a fraction of the window width, margins in px
const DOCKS = {
  'quest-tracker': { x: 'right', y: 'top', mx: 16, my: 62, frac: 0.3, min: 320, max: 600 },
  'quest-banner': { x: 'center', y: 'top', mx: 0, my: 100, frac: 0.42, min: 460, max: 860 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => 1 - (1 - t) * (1 - t);

// a long line is shown in pages of about two lines, split at sentences, so the player reads at the speaker's pace
function splitPages(text, max = PAGE_CHARS) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return [t];
  const sent = t.match(/[^.!?…]+(?:[.!?…]+["”')\]]*|$)\s*/g) || [t];
  const out = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let s of sent) {
    s = s.trim();
    if (!s) continue;
    if (s.length > max) {
      flush();
      let line = '';
      for (const w of s.split(' ')) { if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; }
      cur = line;
      continue;
    }
    if (cur && (cur + ' ' + s).length > max) flush();
    cur = cur ? cur + ' ' + s : s;
  }
  flush();
  return out.length ? out : [t];
}

// The flat-screen HUD: plain DOM, styled here so the HUD works wherever hud.js is loaded (the page's own CSS only supplies :root colours).
const DOM_CSS = `
.omni-hud{position:fixed;inset:0;z-index:7;pointer-events:none;color:#f6ead2;font-family:${UI.font}}
.omni-box{box-sizing:border-box;border-radius:14px;border:1px solid rgba(205,160,88,.78);background:linear-gradient(180deg,rgba(62,44,29,.96),rgba(34,23,14,.96));
  box-shadow:0 8px 24px rgba(18,9,2,.42),inset 0 1px 0 rgba(255,222,160,.16),inset 0 0 0 3px rgba(22,13,5,.38)}
.omni-obj,.omni-toast,.omni-sub{position:absolute;left:50%;opacity:0;transition:opacity .4s ease,transform .4s ease;text-align:center;overflow-wrap:anywhere}
.omni-obj{top:14px;max-width:min(780px,calc(100vw - 200px));padding:9px 24px 10px;transform:translate(-50%,-8px)}
.omni-obj.on{opacity:1;transform:translate(-50%,0)}
.omni-obj .main{font:600 17px/1.35 ${UI.font};letter-spacing:.01em}
.omni-obj .sub{font:500 13px/1.3 ${UI.font};color:#d2bd96;margin-top:3px}
.omni-obj .sub:empty{display:none}
.omni-toast{top:86px;max-width:clamp(300px,calc(100vw - 860px),560px);padding:8px 22px 9px;font:600 16px/1.38 ${UI.font};transform:translate(-50%,-10px)}
.omni-toast.on{opacity:1;transform:translate(-50%,0)}
.omni-toast.error{background:linear-gradient(180deg,rgba(92,38,28,.96),rgba(54,21,15,.96));border-color:rgba(236,138,118,.8)}
.omni-toast.pulse{animation:omni-pulse .35s ease}
.omni-sub{bottom:104px;width:max-content;max-width:clamp(340px,calc(100vw - 780px),700px);padding:10px 26px 12px;transform:translate(-50%,10px);
  font:500 clamp(17px,1.45vw,25px)/1.42 ${UI.font};text-shadow:0 1px 2px rgba(10,5,0,.6)}
.omni-sub.on{opacity:1;transform:translate(-50%,0)}
.omni-sub .lead{font-weight:700;margin-right:.4em}
.omni-sub.oracle .txt{color:#f4cf7a;font-style:italic;font-weight:600}
.omni-sub.player .txt{color:#d4e4ec}
@keyframes omni-pulse{0%{transform:translate(-50%,0) scale(1)}40%{transform:translate(-50%,0) scale(1.04)}100%{transform:translate(-50%,0) scale(1)}}
@media (max-width:1179px){.omni-sub{max-width:calc(100vw - 48px)}.omni-toast{max-width:calc(100vw - 48px)}}
@media (prefers-reduced-motion:reduce){.omni-obj,.omni-toast,.omni-sub{transition:none}.omni-toast.pulse{animation:none}}
`;

export function createHud({ THREE, camera, events }) {
  const game = () => globalThis.window?.game;
  const menuApi = () => game()?.world?.menu;
  const doc = typeof document !== 'undefined' ? document : null;

  // lives in the scene (not on the camera) so panels can lag behind the head
  let sceneRoot = camera;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent;

  function makeCanvasPanel(w, h, planeW, order, name, linear = true) {
    const cv = doc.createElement('canvas');
    cv.width = w; cv.height = h;
    const gg = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeW * h / w), mat);
    mesh.name = name; mesh.renderOrder = order; mesh.frustumCulled = false; mesh.visible = false;
    mesh.userData.noShadow = mesh.userData.noOutline = true;
    return { cv, g: gg, tex, mat, mesh, w, h };
  }

  // ---- subtitle panel (headset): one canvas, drawn when the page changes; fading is the material's opacity
  const sub = makeCanvasPanel(SUB_W, SUB_H, PLANE_W, RENDER_ORDER, 'hud');
  const canvas = sub.cv, g = sub.g, texture = sub.tex, material = sub.mat, mesh = sub.mesh;
  sceneRoot.add(mesh);
  // ---- toast and objective panels (headset), made on first use
  let toastP = null, objP = null, toastFol = null, objFol = null;
  function worldPanels() {
    if (toastP || !doc) return;
    toastP = makeCanvasPanel(1024, 176, 1.0, RENDER_ORDER - 1, 'hud-toast');
    objP = makeCanvasPanel(1024, 144, 1.0, RENDER_ORDER - 2, 'hud-objective');
    toastFol = follow(toastP.mesh, { pitch: 0.2, distance: 1.3, stiffness: 14 });
    objFol = follow(objP.mesh, { pitch: 0.4, distance: 1.3, stiffness: 10 });
  }

  // ---- presentation manager (the oracle's own subtitle is "speaking" for the card's purposes)
  let speakingNow = false;
  const present = createPresenter({
    panelOpen: () => !!menuApi()?.isOpen,
    speaking: () => speakingNow,
  });

  // ---- indicator panel (left hand)
  const auxP = makeCanvasPanel(AUX_W, AUX_H, AUX_PW, RENDER_ORDER + 1, 'hud-indicator');
  const aux = auxP.mesh, auxTex = auxP.tex, ag = auxP.g;
  sceneRoot.add(aux);

  // ---- comfort vignette (camera child)
  const vigCanvas = doc.createElement('canvas');
  vigCanvas.width = vigCanvas.height = 256;
  {
    const vg = vigCanvas.getContext('2d');
    const gr = vg.createRadialGradient(128, 128, 256 * 0.17, 128, 128, 256 * 0.5);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    vg.fillStyle = gr; vg.fillRect(0, 0, 256, 256);
  }
  const vigTex = new THREE.CanvasTexture(vigCanvas);
  vigTex.colorSpace = THREE.SRGBColorSpace; vigTex.generateMipmaps = false;
  const vigMat = new THREE.MeshBasicMaterial({ map: vigTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false, opacity: 0 });
  const vig = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), vigMat);
  vig.name = 'comfort-vignette'; vig.position.set(0, 0, -0.3); vig.renderOrder = RENDER_ORDER - 5; vig.frustumCulled = false; vig.visible = false;
  vig.userData.noShadow = vig.userData.noOutline = true;
  camera.add(vig);

  let now = 0;
  let nextId = 1;
  let items = [];           // subtitle lines still alive (the newest is shown; a pending audio line waits here for its turn)
  let cur = null;           // the subtitle on screen
  let stateKey = '';
  let subSig = NaN, subWasFlat = null;

  // ------------------------------------------------------------ view mode: DOM on a flat screen, world panels in a headset
  let mode = 'auto';
  const isFlat = () => (mode === 'dom' ? true : mode === 'world' ? false : !game()?.input?.presenting);

  // ------------------------------------------------------------ DOM layer
  let dom = null, domBroken = false;
  function ensureDom() {
    if (dom || domBroken || !doc || !doc.body) return dom;
    try {
      if (!doc.getElementById('omni-hud-css')) { const st = doc.createElement('style'); st.id = 'omni-hud-css'; st.textContent = DOM_CSS; (doc.head || doc.body).appendChild(st); }
      const root = doc.createElement('div'); root.id = 'omni-hud'; root.className = 'omni-hud';
      const mk = (cls, live) => { const el = doc.createElement('div'); el.className = 'omni-box ' + cls; if (live) { el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); } root.appendChild(el); return el; };
      const obj = mk('omni-obj', true), toast = mk('omni-toast', true), subEl = mk('omni-sub oracle', false);
      const objMain = doc.createElement('div'), objSub = doc.createElement('div');
      objMain.className = 'main'; objSub.className = 'sub'; obj.appendChild(objMain); obj.appendChild(objSub);
      const lead = doc.createElement('span'), txt = doc.createElement('span');
      lead.className = 'lead'; txt.className = 'txt'; subEl.appendChild(lead); subEl.appendChild(txt);
      doc.body.appendChild(root);
      dom = { root, obj, objMain, objSub, toast, sub: subEl, lead, txt, subOn: false, toastOn: false, objOn: false };
    } catch (err) { domBroken = true; dom = null; }
    return dom;
  }
  const setOn = (el, on) => { if (on) el.classList.add('on'); else el.classList.remove('on'); };

  // ------------------------------------------------------------ text layout (world panels)
  function wrapPx(text, font, maxW) {
    g.font = font;
    const out = [];
    for (const para of String(text).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = '';
      for (const word of words) {
        const trial = line ? `${line} ${word}` : word;
        if (line && g.measureText(trial).width > maxW) { out.push(line); line = word; } else line = trial;
      }
      while (g.measureText(line).width > maxW && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && g.measureText(line.slice(0, n)).width > maxW) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
      if (line) out.push(line);
    }
    return out.length ? out : [''];
  }
  // one framed text block on a panel canvas: lines centred; anchor 'bottom' sits at the foot of the canvas, 'middle' in the middle
  function paintBlock(p, lines, o) {
    const gg = p.g;
    gg.clearRect(0, 0, p.w, p.h);
    gg.font = o.font;
    let widest = 0;
    for (const l of lines) widest = Math.max(widest, gg.measureText(l).width);
    const bw = Math.min(p.w - 24, widest + o.padX * 2), bh = lines.length * o.lh + o.padY * 2;
    const x = (p.w - bw) / 2, y = o.anchor === 'bottom' ? p.h - 20 - bh : (p.h - bh) / 2;
    UI.plate(gg, x, y, bw, bh, o.r ?? 20, { shadow: 12, rim: 3, top: o.top, bottom: o.bottom });
    gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.font = o.font;
    for (let i = 0; i < lines.length; i++) {
      const ly = y + o.padY + o.lh * (i + 0.5) + 1;
      if (o.lead && i === 0 && lines[0].startsWith(o.lead)) {
        const rest = lines[0].slice(o.lead.length);
        gg.font = o.leadFont ?? o.font; const lw = gg.measureText(o.lead).width;
        gg.font = o.font; const rw = gg.measureText(rest).width;
        const x0 = p.w / 2 - (lw + rw) / 2;
        gg.textAlign = 'left';
        gg.font = o.leadFont ?? o.font; gg.fillStyle = o.leadColor; gg.fillText(o.lead, x0, ly);
        gg.font = o.font; gg.fillStyle = o.color; gg.fillText(rest, x0 + lw, ly);
        gg.textAlign = 'center';
      } else { gg.fillStyle = o.color; gg.fillText(lines[i], p.w / 2, ly); }
    }
    p.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ subtitles
  function addItem(text, kind, seconds, extra) {
    text = String(text ?? '').trim();
    if (!text) return null;
    // an identical repeat just refreshes the line on screen instead of stacking
    if (cur && cur.kind === kind && cur.text === text && !cur.pending && cur.lead === (extra?.lead ?? '') && now < cur.born + cur.life) {
      cur.born = now; cur.life = seconds; cur.t0 = now; cur.span = Math.max(1.5, seconds * 0.8);
      return cur;
    }
    const shown = kind === 'player' ? `“${text}”` : text;
    const pages = splitPages(shown);
    const total = pages.reduce((n, p) => n + p.length, 0);
    let acc = 0;
    const cum = pages.map((p) => (acc += p.length) / total);
    const it = {
      id: nextId++, text, kind, lead: '', leadColor: C.text, pages, cum,
      born: now, life: seconds,
      t0: now, span: Math.max(1.5, seconds * 0.8), // paging clock
      pending: false,
      ...extra,
    };
    items.push(it);
    if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS);
    cur = it;                       // the newest line replaces whatever was showing
    return it;
  }
  const pageOf = (it) => {
    if (it.pages.length === 1) return 0;
    const p = (now - it.t0) / it.span;
    if (p <= 0) return 0;
    for (let i = 0; i < it.cum.length; i++) if (p < it.cum[i]) return i;
    return it.pages.length - 1;
  };
  function dropSubtitles() { items.length = 0; cur = null; }

  function renderSubDom(it, page) {
    const d = ensureDom(); if (!d) return;
    d.sub.className = 'omni-box omni-sub ' + it.kind + (d.subOn ? ' on' : '');
    const lead = page === 0 && it.lead ? it.lead.trim() : '';
    d.lead.textContent = lead;
    d.lead.style.color = it.leadColor;
    d.lead.style.display = lead ? '' : 'none';
    d.txt.textContent = (page > 0 ? '… ' : '') + it.pages[page] + (page < it.pages.length - 1 ? ' …' : '');
  }
  function renderSubWorld(it, page) {
    const kindFont = it.kind === 'oracle' ? `italic 600 36px ${FONT_FAMILY}` : it.kind === 'player' ? `500 34px ${FONT_FAMILY}` : `500 35px ${FONT_FAMILY}`;
    const color = it.kind === 'oracle' ? C.gold : it.kind === 'player' ? C.player : C.text;
    const lead = page === 0 && it.lead ? it.lead : '';
    let t = (page > 0 ? '… ' : '') + it.pages[page] + (page < it.pages.length - 1 ? ' …' : '');
    const lines = wrapPx(lead + t, kindFont, SUB_W - 150).slice(0, 3);
    paintBlock(sub, lines, { font: kindFont, lh: 46, padX: 34, padY: 18, color, anchor: 'bottom', r: 26, lead, leadColor: it.leadColor, leadFont: `700 35px ${FONT_FAMILY}` });
  }

  // ------------------------------------------------------------ toasts (one slot) and the objective line
  let toastCur = null, toastSig = NaN, toastA = 0, toastOn = false, toastSeq = 0;
  let objText = '', objSubText = '', objSig = NaN, objA = 0;
  function setToast(text, style) { toastCur = { text, style, id: ++toastSeq }; toastOn = true; }
  function toastEnd() { toastOn = false; }
  function objective(text, subText) {
    const t = text == null ? '' : String(text).trim();
    objText = t; objSubText = t && subText ? String(subText).trim() : '';
  }

  function renderToastDom(first) {
    const d = ensureDom(); if (!d || !toastCur) return;
    d.toast.className = 'omni-box omni-toast' + (toastCur.style === 'error' ? ' error' : '') + (d.toastOn ? ' on' : '');
    d.toast.textContent = toastCur.text;
    if (!first) { d.toast.classList.remove('pulse'); void d.toast.offsetWidth; d.toast.classList.add('pulse'); }
  }

  function syncDom(flat) {
    const d = ensureDom(); if (!d) return;
    d.root.style.display = flat ? '' : 'none';
    if (!flat) return;
    // subtitle
    const vis = !!cur && now < cur.born + cur.life - FADE_OUT;
    const page = cur ? pageOf(cur) : 0;
    const sig = cur ? cur.id * 16 + page : -1;
    if (sig !== subSig) { subSig = sig; if (cur) renderSubDom(cur, page); }
    if (vis !== d.subOn) { d.subOn = vis; setOn(d.sub, vis); }
    // toast
    const tsig = toastCur ? toastCur.id : -1;
    if (tsig !== toastSig) { const first = toastSig !== toastSig || toastSig === -1 || !d.toastOn; toastSig = tsig; renderToastDom(first); }
    if (toastOn !== d.toastOn) { d.toastOn = toastOn; setOn(d.toast, toastOn); }
    // objective
    const osig = objText + '\n' + objSubText;
    if (osig !== objSig) { objSig = osig; d.objMain.textContent = objText; d.objSub.textContent = objSubText; }
    const oOn = !!objText;
    if (oOn !== d.objOn) { d.objOn = oOn; setOn(d.obj, oOn); }
  }

  // headset: world panels
  let toastDrawn = -1, objDrawn = '';
  function syncWorld(dt) {
    // subtitle
    const a = cur ? Math.max(0, Math.min((now - cur.born) / FADE_IN, (cur.born + cur.life - now) / FADE_OUT, 1)) : 0;
    if (cur && a > 0.02) {
      const page = pageOf(cur), sig = cur.id * 16 + page;
      if (sig !== subSig) { subSig = sig; renderSubWorld(cur, page); }
      mesh.visible = true;
      followHead(dt);
      const M = menuApi(), top = M && M.isOpen ? M.panelTop : null;
      const crowded = gazeOn && (typeof top !== 'number' || top + RAISE_PITCH > MAX_PITCH + 0.02);
      opacity += ((crowded ? 0.35 : 1) - opacity) * (1 - Math.exp(-dt * 7));
      material.opacity = a * opacity;
    } else if (mesh.visible) { mesh.visible = false; subSig = NaN; }
    // toast + objective share the head-following machinery; hidden while a panel is open
    worldPanels();
    if (!toastP) return;
    const panelOpen = !!menuApi()?.isOpen;
    toastA += ((toastOn && !panelOpen ? 1 : 0) - toastA) * (1 - Math.exp(-dt * (toastOn ? 12 : 6)));
    if (toastCur && toastA > 0.02) {
      if (toastDrawn !== toastCur.id) {
        toastDrawn = toastCur.id;
        const f = `600 40px ${FONT_FAMILY}`, lines = wrapPx(toastCur.text, f, 780).slice(0, 2), err = toastCur.style === 'error';
        paintBlock(toastP, lines, { font: f, lh: 48, padX: 36, padY: 18, color: err ? '#ffd2c6' : C.text, r: 24, top: err ? 'rgba(98,40,30,0.96)' : undefined, bottom: err ? 'rgba(56,22,16,0.96)' : undefined });
      }
      toastP.mesh.visible = true; toastP.mat.opacity = toastA;
    } else if (toastP.mesh.visible) toastP.mesh.visible = false;
    const oWant = objText && !panelOpen ? 1 : 0;
    objA += (oWant - objA) * (1 - Math.exp(-dt * 8));
    if (objText && objA > 0.02) {
      const key = objText + '\n' + objSubText;
      if (objDrawn !== key) {
        objDrawn = key;
        const f = `600 40px ${FONT_FAMILY}`, lines = wrapPx(objText, f, 800).slice(0, 2);
        paintBlock(objP, lines, { font: f, lh: 48, padX: 34, padY: 16, color: C.text, r: 24 });
      }
      objP.mesh.visible = true; objP.mat.opacity = objA;
    } else if (objP.mesh.visible) objP.mesh.visible = false;
  }

  // ------------------------------------------------------------ desktop log mirror
  const logEl = () => (doc ? doc.getElementById('log') : null);
  function mirror(prefix, text, color) {
    const el = logEl();
    if (!el) return;
    const d = doc.createElement('div');
    d.textContent = prefix + text;
    if (color) d.style.color = color;
    el.appendChild(d);
    while (el.childElementCount > LOG_LINES) el.firstElementChild.remove();
    setTimeout(() => d.remove(), LOG_TTL_MS);
  }

  // ------------------------------------------------------------ public API
  const estimateSpeech = (text) => Math.max(2.5, text.length * 0.066);

  // A toast goes through the presentation manager: it appears when no card / banner is up and no menu panel is open, one at a time, in one fixed slot.
  // kind: 'toast' (default) | 'notice' | 'error' (red) | 'critical' (shows at once, over a panel too). key: a toast with the same key replaces the one before it.
  // The time on screen is the caller's seconds, kept between 1.8 and 7 s, and never less than a reading time for the text.
  function show(text, seconds = 3, kind = 'toast', key) {
    text = String(text ?? '').trim();
    if (!text) return null;
    const style = kind === 'critical' || kind === 'error' ? 'error' : 'toast';
    const sec = clamp(Math.max(Number(seconds) || 3, 1.2 + 0.045 * text.length), TOAST_MIN, style === 'error' ? 6 : TOAST_MAX);
    if (style === 'error') mirror('! ', text, '#f2a08c'); // the page log keeps conversation and errors, not every toast
    const show1 = () => setToast(text, style);
    return present.request({
      id: 'toast:' + (key != null ? String(key) : style + ':' + text), kind: kind === 'critical' ? 'critical' : 'toast', owner: 'hud', hold: sec, maxWait: 10,
      start: show1, refresh: show1, end: toastEnd,
    });
  }
  function say(text, hasAudio) {
    const est = estimateSpeech(String(text ?? ''));
    const it = addItem(text, 'oracle', hasAudio ? PENDING_LIFE : est + 1.4, hasAudio ? { pending: true, t0: Infinity, span: est } : { span: est });
    if (it) mirror('Omnissiah: ', String(text), '#f2c969');
    return it;
  }
  function player(text) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const it = addItem(t, 'player', 2.8 + t.length * 0.04);
    if (it) mirror('You: ', t, '#d4e4ec');
    return it;
  }
  function npc(name, faction, text, hasAudio) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const n = String(name || 'Someone');
    const est = estimateSpeech(t);
    const it = addItem(t, 'npc', est + 1.4, { lead: n + ': ', leadColor: FACTION_COLOR[faction] ?? FACTION_COLOR.neutral, span: est });
    if (it) mirror(n + ': ', t, FACTION_COLOR[faction] ?? null);
    return it;
  }
  // subtitles and toasts away (Esc, the end of a skipped intro, a scene change); the objective belongs to its caller
  function clear() { dropSubtitles(); subSig = NaN; present.clear('toast'); toastEnd(); }
  const dismiss = clear;

  events.on('net:speak', (m) => { if (m && m.text) say(m.text, !!m.audio); });
  events.on('net:transcript', (m) => { if (m) player(m.text); });
  // The speaker's name and faction come from core/voices.js, which emits voices:reply { actor } synchronously while it handles the same
  // net:npc_reply; if nobody does by the end of this dispatch the line is shown with whatever the message carries.
  let npcPending = null;
  events.on('net:npc_reply', (m) => {
    if (!m || !m.text) return;
    const entry = { m, done: false };
    npcPending = entry;
    queueMicrotask(() => { if (!entry.done) { entry.done = true; npc(m.name ?? m.npc?.name, m.faction ?? m.npc?.faction, m.text); } });
  });
  events.on('voices:reply', (e) => {
    const p = npcPending;
    if (!p || p.done || !e || !e.actor) return;
    p.done = true;
    let info = null;
    try { info = globalThis.window?.game?.world?.voices?.info?.(e.actor); } catch { info = null; }
    npc(info?.name ?? e.actor.npcName ?? p.m.name, info?.faction ?? p.m.faction, p.m.text);
  });
  events.on('net:notice', (m) => {
    if (!m || !m.text) return;
    const err = m.level === 'error';
    show(String(m.text), err ? 6 : 4.5, err ? 'error' : 'notice');
  });
  events.on('oracle:state', (s) => {
    const key = STATES[s] ? s : '';
    if (key !== stateKey) { stateKey = key; auxDirty = true; }
  });
  events.on('oracle:line', (m) => {
    if (!m) return;
    const it = items.find((i) => i.pending && i.text === String(m.text).trim());
    if (!it) return;
    const dur = Math.max(0.5, Number(m.duration) || it.span);
    it.t0 = now; it.span = dur;
    it.born = Math.min(it.born, now);
    it.life = (now - it.born) + dur + 1.4; // linger briefly after the last word
    it.pending = false;
    cur = it;                              // his voice is playing this line now: it is the one on screen
  });
  events.on('oracle:line-end', (m) => {
    if (!m) return;
    const text = String(m.text).trim();
    let it = null;
    for (let i = items.length - 1; i >= 0 && !it; i--) if (items[i].kind === 'oracle' && items[i].text === text) it = items[i]; // the line is over, however far its pages had got
    if (!it) return;
    it.pending = false;
    it.life = Math.min(it.life, (now - it.born) + 1.0);
  });
  // the intro was skipped (Esc, "skip", walking off): nothing it said may stay on screen
  const onIntroDone = (e) => { if (e && e.skipped) { clear(); objective(null); } else objective(null); };
  events.on('intro:done', onIntroDone);
  events.on('intro:complete', onIntroDone);
  // Esc dismisses whatever transient text is showing (the menu keeps Esc while it is open)
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('keydown', (e) => { if (e && e.code === 'Escape' && !menuApi()?.isOpen) clear(); }, true);
  }

  // ------------------------------------------------------------ generation progress chips
  const chips = new Map(); // id -> { kind, label, state, since, frac, until }
  const shortLabel = (s, fallback) => {
    s = String(s ?? '').replace(/\s+/g, ' ').trim();
    return s ? (s.length > 26 ? s.slice(0, 25) + '…' : s) : fallback;
  };
  function chipUpdate(kind, id, state, label) {
    if (id === undefined) return;
    const key = kind + ':' + id;
    let c = chips.get(key);
    if (!c) { c = { kind, label: shortLabel(label, kind === 'gen3d' ? 'A new 3D model' : kind === 'music' ? 'Music' : 'A sound'), state: '', since: now, frac: 0, until: Infinity, stage: kind === 'gen3d' ? GEN_STAGES.gen3d : GEN_STAGES.audio }; chips.set(key, c); }
    else if (label && c.label.startsWith('A ')) c.label = shortLabel(label, c.label);
    if (c.state !== state) { c.state = state; c.since = now; }
    if (state === 'done') c.until = now + 1.8;
    else if (state === 'error') c.until = now + 5;
    auxDirty = true;
  }
  events.on('net:gen3d_status', (m) => { if (m) chipUpdate('gen3d', m.id, m.state, m.state === 'error' ? undefined : m.prompt ?? m.name); });
  events.on('net:audio_status', (m) => { if (m) chipUpdate(m.kind === 'music' ? 'music' : 'sfx', m.id, m.state, m.prompt); });

  let auxDirty = true, auxSig = '';
  function chipFrac(c) {
    if (c.state === 'done') return 1;
    const st = c.stage[c.state] ?? [0.1, 0.4];
    const el = now - c.since;
    return st[0] + (st[1] - st[0]) * (1 - Math.exp(-el / 14));
  }
  function drawAux(sigParts) {
    ag.clearRect(0, 0, AUX_W, AUX_H);
    ag.textBaseline = 'middle'; ag.lineJoin = 'round';
    let y = 8;
    const st = STATES[stateKey];
    if (st) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 5);
      ag.font = `600 30px ${FONT_FAMILY}`;
      const w = ag.measureText(st.text).width + 74;
      UI.plate(ag, 8, y, w, 54, 27, { shadow: 8, rim: 2.4, top: 'rgba(52,37,24,0.94)', bottom: 'rgba(30,20,12,0.94)' });
      ag.beginPath(); ag.arc(38, y + 27, 9 + pulse * 2.5, 0, Math.PI * 2); ag.fillStyle = st.color; ag.globalAlpha = 0.35 + pulse * 0.4; ag.fill(); ag.globalAlpha = 1;
      ag.beginPath(); ag.arc(38, y + 27, 6, 0, Math.PI * 2); ag.fillStyle = st.color; ag.fill();
      ag.fillStyle = C.text; ag.textAlign = 'left'; ag.fillText(st.text, 60, y + 29);
      y += 64;
    }
    let n = 0;
    for (const c of chips.values()) {
      if (n >= 2) break; n++;
      const frac = chipFrac(c), err = c.state === 'error';
      const word = err ? 'failed' : c.state === 'done' ? 'ready' : c.state;
      UI.plate(ag, 8, y, 420, 58, 16, { shadow: 8, rim: 2.2, top: err ? 'rgba(88,36,26,0.94)' : 'rgba(52,37,24,0.94)', bottom: err ? 'rgba(52,20,14,0.94)' : 'rgba(30,20,12,0.94)' });
      ag.font = `600 23px ${FONT_FAMILY}`; ag.textAlign = 'left'; ag.fillStyle = err ? '#ffc4b6' : C.text;
      const tag = c.kind === 'gen3d' ? '◈ ' : c.kind === 'music' ? '♫ ' : '♪ ';
      ag.fillText(tag + c.label, 24, y + 19);
      ag.font = `500 19px ${FONT_FAMILY}`; ag.fillStyle = err ? '#f2a08c' : C.dim; ag.textAlign = 'right'; ag.fillText(word, 412, y + 19);
      UI.rrect(ag, 24, y + 37, 388, 9, 4.5); ag.fillStyle = 'rgba(255,236,200,0.16)'; ag.fill();
      if (!err) { UI.rrect(ag, 24, y + 37, Math.max(9, 388 * frac), 9, 4.5); ag.fillStyle = c.state === 'done' ? C.good : C.gold2; ag.fill(); }
      y += 66;
    }
    auxTex.needsUpdate = true;
    auxSig = sigParts;
  }

  // ------------------------------------------------------------ lazy follow / placement of the headset subtitle
  let yaw = 0, pitch = 0, vYaw = 0, vPitch = 0, placed = false, opacity = 1, gazeOn = false, raise = 0, raisedPitch = 0;
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _vp = new THREE.Vector3();
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

  function followHead(dt) {
    camera.getWorldPosition(_p);
    camera.getWorldDirection(_d);
    const vr = !!game()?.input?.presenting;
    const yT = Math.atan2(_d.x, _d.z), pT = Math.asin(clamp(_d.y, -1, 1)) * (vr ? 0.6 : 1);
    if (!placed) { yaw = yT; pitch = pT; vYaw = vPitch = 0; placed = true; }
    const steps = Math.max(1, Math.ceil(dt / 0.016)), h = dt / steps, k = vr ? 36 : 200, c = 2 * Math.sqrt(k);
    for (let i = 0; i < steps; i++) { // critically damped spring toward the look direction
      vYaw += (k * angDiff(yT, yaw) - c * vYaw) * h; yaw += vYaw * h;
      vPitch += (k * (pT - pitch) - c * vPitch) * h; pitch += vPitch * h;
    }
    const lag = angDiff(yT, yaw);
    if (Math.abs(lag) > 1.15) { yaw = yT - Math.sign(lag) * 1.15; vYaw = 0; } // never lose it entirely
    let pp = clamp(pitch + BASE_PITCH_VR, -1.0, 0.5);
    // a menu panel is open and in view (see stepRaise): the text rides just above it instead of lying across it
    if (raise > 0.001) pp += (Math.max(pp, raisedPitch) - pp) * raise;
    pp = clamp(pp, -1.0, MAX_PITCH);
    const cp = Math.cos(pp);
    mesh.position.set(_p.x + Math.sin(yaw) * cp * DISTANCE, _p.y + Math.sin(pp) * DISTANCE, _p.z + Math.cos(yaw) * cp * DISTANCE);
    // a narrow window (phone, split screen, the 'world' test mode) would crop the lines: shrink the plane to the view's width
    let sc = 1;
    if (!vr) {
      const hf = 2 * Math.atan(Math.tan((camera.fov || 70) * Math.PI / 360) * (camera.aspect || 1.78));
      sc = clamp(hf * 0.94 / (2 * Math.atan(PLANE_W / 2 / DISTANCE)), 0.4, 1);
    }
    if (mesh.scale.x !== sc) mesh.scale.setScalar(sc);
    mesh.updateMatrixWorld();
    mesh.lookAt(_p.x, _p.y, _p.z);
  }

  // runs every frame (also while nothing is shown) so the lift is never stale when the next line appears
  function stepRaise(dt) {
    const M = menuApi(), top = M && M.isOpen ? M.panelTop : null;
    const want = gazeOn && typeof top === 'number' ? 1 : 0;
    raise += (want - raise) * (1 - Math.exp(-dt * 7));
    if (want) raisedPitch = clamp(top + RAISE_PITCH, -0.4, MAX_PITCH);
    else if (raise < 0.002) raise = 0;
  }

  // ------------------------------------------------------------ generic lazy anchor for head-relative panels (quest tracker, banners)
  // hud.follow(object, { yaw, pitch, distance, stiffness, dock }) -> { stop(), set(o), object }. The object is moved into the scene and sits
  // `distance` m from the head, yaw radians to the LEFT (negative = right) and pitch radians above (negative = below) the look direction. In
  // a headset it trails the head on a soft spring (a glance does not drag it); on a flat screen it is locked to the view (no keystone or roll).
  // dock (flat screens only; panels named in DOCKS get one by default): { x: 'left'|'right'|'center', y: 'top'|'bottom', mx, my (px margins), frac, min, max }
  // pins the panel to a screen corner at a width of frac of the window (min..max px) instead of floating at yaw / pitch.
  const followers = [];
  function follow(object, o = {}) {
    const f = { object, yaw: o.yaw ?? 0, pitch: o.pitch ?? 0, dist: o.distance ?? 1.2, k: o.stiffness ?? 16, ay: 0, vy: 0, ap: 0, vp: 0, placed: false, dock: o.dock ?? null };
    sceneRoot.add(object);
    followers.push(f);
    return {
      object,
      set(n = {}) { if (n.yaw !== undefined) f.yaw = n.yaw; if (n.pitch !== undefined) f.pitch = n.pitch; if (n.distance !== undefined) f.dist = n.distance; if (n.dock !== undefined) f.dock = n.dock; },
      stop() { const i = followers.indexOf(f); if (i >= 0) followers.splice(i, 1); object.removeFromParent(); },
    };
  }
  function updateFollowers(dt) {
    if (!followers.length) return;
    camera.getWorldPosition(_p);
    camera.getWorldDirection(_d);
    const yT = Math.atan2(_d.x, _d.z), pT = Math.asin(clamp(_d.y, -1, 1));
    const vr = !!game()?.input?.presenting;
    for (let n = 0; n < followers.length; n++) {
      const f = followers[n];
      if (!f.placed || !vr) { f.ay = yT; f.ap = pT; f.vy = f.vp = 0; f.placed = true; }
      else {
        const steps = Math.max(1, Math.ceil(dt / 0.016)), h = dt / steps, c = 2 * Math.sqrt(f.k);
        for (let i = 0; i < steps; i++) {
          f.vy += (f.k * angDiff(yT, f.ay) - c * f.vy) * h; f.ay += f.vy * h;
          f.vp += (f.k * (pT * 0.5 - f.ap) - c * f.vp) * h; f.ap += f.vp * h;
        }
        const lag = angDiff(yT, f.ay);
        if (Math.abs(lag) > 1.0) { f.ay = yT - Math.sign(lag) * 1.0; f.vy = 0; }
      }
      if (vr) {
        const yy = f.ay + f.yaw, pp = clamp(f.ap + f.pitch, -1.2, 1.2), cp = Math.cos(pp);
        f.object.position.set(_p.x + Math.sin(yy) * cp * f.dist, _p.y + Math.sin(pp) * f.dist, _p.z + Math.cos(yy) * cp * f.dist);
        f.object.updateMatrixWorld(); f.object.lookAt(_p.x, _p.y, _p.z); // faces the head, upright in the world
        continue;
      }
      camera.getWorldQuaternion(_q);
      const dk = f.dock ?? DOCKS[f.object.name];
      if (dk) { // pinned to a corner of the window at a fixed share of its width
        const W = Math.max(320, globalThis.innerWidth || 1280), H = Math.max(240, globalThis.innerHeight || 720);
        const gp = f.object.geometry && f.object.geometry.parameters;
        const ow = (gp?.width ?? 0.5) * Math.abs(f.object.scale.x), oh = (gp?.height ?? 0.25) * Math.abs(f.object.scale.y);
        const th = Math.tan(((camera.fov || 70) * Math.PI) / 360), tw = th * (camera.aspect || W / H);
        const wpx = clamp(dk.frac * W, dk.min, Math.min(dk.max, W * 0.46)), hpx = wpx * oh / ow;
        const dist = (ow / (2 * tw)) * (W / wpx);
        const cxp = dk.x === 'center' ? W / 2 : dk.x === 'left' ? dk.mx + wpx / 2 : W - dk.mx - wpx / 2;
        const cyp = dk.y === 'bottom' ? H - dk.my - hpx / 2 : dk.my + hpx / 2;
        _vp.set((cxp / W * 2 - 1) * dist * tw, (1 - cyp / H * 2) * dist * th, -dist).applyQuaternion(_q).add(_p);
        f.object.position.copy(_vp);
      } else {
        const yy = f.ay + f.yaw, pp = clamp(f.ap + f.pitch, -1.2, 1.2), cp = Math.cos(pp);
        f.object.position.set(_p.x + Math.sin(yy) * cp * f.dist, _p.y + Math.sin(pp) * f.dist, _p.z + Math.cos(yy) * cp * f.dist);
      }
      f.object.quaternion.copy(_q); f.object.updateMatrixWorld(); // flat screen: parallel to the screen
    }
  }

  // ------------------------------------------------------------ indicator placement (near the left hand)
  const auxPos = new THREE.Vector3();
  let auxPlaced = false;
  function placeAux(dt) {
    const G = game(), L = G?.input?.left;
    camera.getWorldPosition(_p);
    if (L && L.connected && G.input.presenting) {
      if (L.tracked) _a.copy(L.fingers.wrist); else _a.copy(L.position);
      _d.set(_p.x - _a.x, 0, _p.z - _a.z);
      if (_d.lengthSq() > 1e-4) _d.normalize().multiplyScalar(0.07);
      _a.add(_d); _a.y += 0.085;
    } else if (G?.input?.presenting) { // headset, no hand tracked yet: lower left, held in front of the body
      _a.set(-0.3, -0.36, -0.8); camera.localToWorld(_a);
    } else { // desktop: low in the view, left of centre, below an open panel
      _a.set(-0.3, -0.4, -0.9); camera.localToWorld(_a);
    }
    if (!auxPlaced) { auxPos.copy(_a); auxPlaced = true; } else auxPos.lerp(_a, 1 - Math.exp(-14 * dt));
    aux.position.copy(auxPos);
    aux.updateMatrixWorld();
    aux.lookAt(_p.x, _p.y, _p.z);
    // the panel's anchor is its left edge, so it grows away from the hand
    aux.translateX(AUX_PW * 0.5 - 0.04);
  }

  // ------------------------------------------------------------ comfort vignette
  const comfort = { enabled: true, strength: 0.6 };
  let vigAmt = 0, lastRx = NaN, lastRz = NaN, lastRy = NaN, pulse = 0;
  function updateVignette(dt) {
    const rig = camera.parent;
    if (!rig || !comfort.enabled) { if (vig.visible) { vig.visible = false; vigMat.opacity = 0; vigAmt = 0; } lastRx = NaN; return; }
    const rp = rig.position, ry = rig.rotation.y;
    let target = 0;
    if (lastRx === lastRx && dt > 0) {
      const dx = rp.x - lastRx, dz = rp.z - lastRz, dist = Math.hypot(dx, dz);
      const dyaw = Math.abs(angDiff(ry, lastRy));
      if (dist < 2.5) { const speed = dist / dt; target = clamp((speed - 3.0) / 4, 0, 1); }
      if (dyaw > 0.2) pulse = Math.max(pulse, 0.7);      // a snap turn
      else if (dyaw / dt > 1.2) target = Math.max(target, clamp((dyaw / dt - 1.2) / 2, 0, 1)); // a smooth turn
    }
    lastRx = rp.x; lastRz = rp.z; lastRy = ry;
    pulse = Math.max(0, pulse - dt * 2.6);
    target = Math.max(target, pulse);
    vigAmt += (target - vigAmt) * (1 - Math.exp(-dt * (target > vigAmt ? 9 : 3.2)));
    if (vigAmt < 0.02) { if (vig.visible) { vig.visible = false; vigMat.opacity = 0; } return; }
    vig.visible = true;
    vigMat.opacity = clamp(vigAmt * comfort.strength * 1.4, 0, 1);
    vig.scale.setScalar(1.2 - 0.45 * vigAmt * comfort.strength);
  }

  function setGaze(v) { gazeOn = !!v; }
  function setComfort(o = {}) {
    if (typeof o.enabled === 'boolean') comfort.enabled = o.enabled;
    if (typeof o.strength === 'number') comfort.strength = clamp(o.strength, 0.1, 1);
  }
  function setMode(m) { mode = m === 'world' || m === 'dom' ? m : 'auto'; subSig = NaN; toastSig = NaN; toastDrawn = -1; objSig = NaN; objDrawn = ''; }

  // ------------------------------------------------------------ per-frame
  let published = false;
  function update(dt) {
    dt = Math.min(dt || 0, 0.25);
    now += dt;
    if (!published) { const G = game(); if (G) { published = true; if (!G.hud) G.hud = api; } }
    updateVignette(dt);

    // expire subtitle lines in place (no per-frame allocation); is the Omnissiah's own line on screen? (a welcome card waits for it to finish)
    speakingNow = false;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (now >= it.born + it.life) { items.splice(i, 1); if (cur === it) cur = null; continue; }
      if (it.kind === 'oracle' && (it.pending || now < it.born + it.life - FADE_OUT)) speakingNow = true;
    }
    present.update(dt);
    if (toastOn && present.pending('toast') > 0) { const A = present.active(); if (A && A.kind === 'toast' && A.since >= 2.2) present.end(A.id, 'done'); } // a queue is waiting: the toast on screen has had its glance
    stepRaise(dt);
    // drop finished chips
    if (chips.size) for (const [k, c] of chips) if (now > c.until) { chips.delete(k); auxDirty = true; }

    const flat = isFlat();
    if (subWasFlat !== flat) { subWasFlat = flat; subSig = NaN; toastSig = NaN; toastDrawn = -1; objSig = NaN; objDrawn = ''; if (flat) { mesh.visible = false; if (toastP) { toastP.mesh.visible = false; objP.mesh.visible = false; } } else if (dom) dom.root.style.display = 'none'; }
    if (flat) syncDom(true); else syncWorld(dt);
    updateFollowers(dt);

    // ---- indicator
    // Hidden while the wrist launcher is open, and while a panel is open unless it is docked at a tracked hand (the panel shows the state in its
    // own title bar; progress chips return when it closes).
    const M = menuApi(), G = game();
    const docked = !!(G?.input?.presenting && G.input.left?.connected);
    if (!STATES[stateKey] && !chips.size) {
      if (aux.visible) aux.visible = false;
      auxDirty = false;
    } else if (M?.launcherOpen || (M?.isOpen && !docked)) {
      aux.visible = false;
    } else {
      let sig = STATE_IDS[stateKey] ?? 0;
      for (const c of chips.values()) sig = (Math.imul(sig, 31) + Math.round(chipFrac(c) * 20) * 7 + c.state.length * 3 + c.label.length) | 0;
      sig += ':' + (stateKey ? Math.floor(now * 8) : 0); // the listening pulse animates
      if (auxDirty || sig !== auxSig || !aux.visible) { drawAux(sig); auxDirty = false; }
      if (!aux.visible) { auxPlaced = false; aux.visible = true; }
      aux.scale.setScalar(docked ? 1 : 1.3);      // away from the hand it floats further off: a little larger keeps the chips readable
      placeAux(dt);
    }
  }

  function debug() {
    return {
      mode, flat: isFlat(), time: +now.toFixed(2),
      subtitle: cur ? { text: cur.text, kind: cur.kind, page: pageOf(cur), pages: cur.pages.length, left: +(cur.born + cur.life - now).toFixed(2) } : null,
      items: items.length,
      toast: toastCur && toastOn ? { text: toastCur.text, style: toastCur.style } : null,
      toasts: { pending: present.pending('toast'), active: present.active() },
      objective: objText || null,
      dom: dom ? { sub: dom.subOn, toast: dom.toastOn, obj: dom.objOn } : null,
      world: { sub: mesh.visible, toast: !!toastP?.mesh.visible, obj: !!objP?.mesh.visible },
    };
  }

  const api = {
    show, say, player, npc, objective, clear, dismiss, update, mesh, aux, setGaze, get gaze() { return gazeOn; }, setComfort, getComfort: () => ({ ...comfort }), follow, present, ui: UI,
    setMode, get mode() { return mode; }, get objectiveText() { return objText; }, debug,
  };
  return api;
}
