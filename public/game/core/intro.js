// core/intro.js - world.intro: the first minutes. Runs once per profile (explicit 'seen' flag), skippable, never blocks play: the fractal ignites from darkness, he speaks his
// first authored lines (no AI call), names the visitor "pilgrim" and teaches by doing. With core/startzone.js present it leads the player to the spell lectern (choose a spell), the
// straw dummies (cast at one), the weapon rack (take a weapon), the waystone (the controls) and the campfire (Pell), each marked by a gold ring + light column on the ground and a
// persistent instruction (desktop: a bar at the top of the page; VR: a world toast repeated every ~9 s). No enemies are spawned there. Without startzone it falls back to the
// older route (gift, dummy, spell wheel, wrist menu, two goblins 11 m away - only for a player who has taken part).
//   world.intro.play({ replay })   start it now (also Menu > Awakening)      world.intro.skip()   leave it at once: call it when they say "skip" / "skip the intro"
//   world.intro.running / .active / .done    state. world.intro.active is true for the whole run (core/commentary.js must stay silent while it is true; it is also disabled here).
//   EVENTS on ctx.events when the opening ends, however it ended: 'intro:done' { finished, skipped, replay }  (same payload also as the older name 'intro:complete').
//   The talk step is HONEST: a player who says (or types) something is answered by the real Omnissiah and nothing is claimed; a player who is not heard within ~30 s gets a guided first wish
//   performed BY HIM ("Then watch."): a ring of rune stones rises and an oak grows, with his creation effect. It is never called the player's wish.
//   Hints always name the controls of the CURRENT device and the real microphone state (window.game.voice.micState): blocked / absent says so and teaches typing. Hands-free speech needs
//   the word "Omnissiah", so every prompt that asks for speech includes it. Skip: Esc (desktop), "Omnissiah, skip", or hold both upper face buttons (Y + B) / both little-finger pinches 2 s.
//   A player who does nothing reaches the end within ~2 minutes with no enemies (two timed-out steps in a row end the lessons). All waits that a person feels use real time (ctx.clock.t).
//   Skipping also stops his speech (voice.stopSpeech) and sends { type: 'say_cancel' } to the server (the story plugin may drop its queued lines). world.intro.debug: hint() talkHint() micInfo() runWish() key(e) waits() skipWait().
export const meta = { name: 'Intro', description: 'The awakening: a skippable, replayable opening that leads through the start zone and teaches by doing.' };

// Lines this file adds to (or replaces in) campaign/lines.js L.intro. Spoken lines avoid characters the story plugin strips.
const LX = {
  speak: 'There you are. Say my name, Omnissiah, and then anything at all. I have so few words that are not my own.',
  noVoice: 'I heard nothing. That is allowed. Then watch.',
  noMic: 'I cannot hear you, and that is allowed. Then watch.',
  wishDone: 'That was a wish. It was mine, not yours. When you are ready, say my name, and ask for your own.',
  giftQuiet: 'Come. Take this.',
  lectern: 'Walk to the lectern. Follow the gold ring. It keeps a spell for you.',
  lecternDone: 'Firebolt. Small, bright, and entirely yours.',
  dummies: 'Those are straw soldiers. They have no feelings. Cast your spell at one.',
  dummyDone: 'Good. It burns beautifully.',
  rack: 'Now the weapon rack. Take any weapon you like.',
  rackDone: 'Good. Keep it, or drop it. I will not judge.',
  waystone: 'The waystone remembers every control, so that you do not have to.',
  fire: 'Last, the fire. A traveller keeps it. Go and sit with him.',
  fireDone: 'That is Pell. He walks. He has always walked. Speak to him.',
  closeIdle: 'That is all for now. The camp is close by, and everything else is yours to ask for.',
};
const SKIP_RE = /\b(skip|stop this|enough of this|no thanks|leave me alone)\b/i;
const BAR_ID = 'omni-intro-hint';

export default async function (ctx) {
  const THREE = ctx.THREE, world = ctx.world;
  // never two intros: a second instance (a stray test hook, a double load) must see the first and stay completely inert
  if (world.intro) { try { console.warn('[intro] another instance is live; this one stays inert'); } catch { /* no console */ } return {}; }
  const S = ctx.state;
  const warn = (...a) => { try { console.warn('[intro]', ...a); } catch { /* no console */ } };
  const q = (() => { try { return new URL(import.meta.url).search; } catch { return ''; } })();
  const [engineMod, linesMod] = await Promise.all([import(`../campaign/engine.js${q}`), import(`../campaign/lines.js${q}`)]);
  if (world.intro) { try { console.warn('[intro] another instance appeared while loading; this one stays inert'); } catch { /* no console */ } return {}; }
  const K = linesMod.default, LI = { ...K.L.intro, ...LX };
  // the shared generated-model loader (lib/gen.js, cached for the page): world.gen if the lead provides it, else the module
  let genMod = null;
  import('/game/lib/gen.js').then((m) => { genMod = m.gen ?? null; }, () => { genMod = null; });
  const getGen = () => world.gen ?? genMod;
  const Q = () => world.quests;
  const ready = () => !!(Q() && Q().ready);
  const getStat = (p) => (ready() ? Q().stat(p) : 0);
  const setStat = (p, v) => { if (!ready()) return; const c = Q().stat(p); if (c !== v) Q().stat(p, v - c); };
  // Once per profile: the quests profile is the truth (stat campaign.intro: 1 = finished, 2 = skipped); localStorage is the fallback when the profile is not reachable.
  const LSK = 'omnissiah.intro.v1';
  const lsGet = () => { try { return Number(globalThis.localStorage?.getItem(LSK)) || 0; } catch { return 0; } };
  const lsSet = (v) => { try { globalThis.localStorage?.setItem(LSK, String(v)); } catch { /* private window */ } };
  const introFlag = () => Math.max(ready() ? getStat('campaign.intro') : 0, lsGet());
  const setIntroFlag = (v) => { lsSet(v); setStat('campaign.intro', v); };
  // (a tab closed mid-run must not leave automatic labours off for good: a marker says WE switched them off)
  const AOK = 'omnissiah.intro.autooff';
  const autoOffMarker = (set) => { try { if (set === undefined) return globalThis.localStorage?.getItem(AOK) === '1'; if (set) globalThis.localStorage?.setItem(AOK, '1'); else globalThis.localStorage?.removeItem(AOK); } catch { /* none */ } return false; };
  const autoWas = () => { try { const j = JSON.parse(globalThis.localStorage.getItem('omnissiah.profile.v1')); return j?.settings?.auto !== false; } catch { return true; } };
  const engine = engineMod.default(ctx, { profile: () => ({}), getStat, setStat, log: warn, advance: () => false, deaths: () => 0 });
  let run = null, disposed = false, skipHold = 0, startedAt = -1, afterTalk = false, home = null, wished = false;
  let skipReq = null, typedN = 0, lastUnlock = -1e9, idleStreak = 0, engaged = 0, inputSeen = false, startFeet = null, startFwd = null, heardEver = false, actN = 0;
  const fading = [];                                     // gen handles sinking back into the ground after the run

  // ------------------------------------------------------------------ input mode, microphone, the hint bar
  const device = () => (ctx.input.left?.tracked || ctx.input.right?.tracked ? 'hands' : ctx.input.presenting ? 'controllers' : 'desktop');
  const doc = typeof document !== 'undefined' && document && document.body ? document : null;
  try { doc?.getElementById?.(BAR_ID)?.remove?.(); } catch { /* none */ }
  // microphone: 'ready' | 'off' (not asked yet) | 'pending' (permission prompt) | 'blocked' | 'none' (no getUserMedia) | 'unknown'
  let permState = 'unknown';
  try {
    if (typeof navigator !== 'undefined') navigator.permissions?.query?.({ name: 'microphone' }).then((p) => { const f = () => { permState = p.state; }; f(); p.onchange = f; }, () => {});
  } catch { /* unsupported */ }
  const voiceSvc = () => globalThis.game?.voice ?? globalThis.window?.game?.voice ?? null;
  function micInfo() {
    const v = voiceSvc();
    const hasApi = typeof navigator === 'undefined' ? true : !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    let state = 'unknown';
    if (!hasApi) state = 'none';
    else if (v && typeof v.micState === 'string') state = v.micState === 'unhealthy' ? 'pending' : v.micState;
    if (state !== 'ready' && permState === 'denied') state = 'blocked';
    if ((state === 'unknown' || state === 'off') && permState === 'granted') state = 'ready';
    return { state, openMic: v ? v.openMic !== false : true };
  }
  const micDead = () => { const s = micInfo().state; return s === 'blocked' || s === 'none'; };

  const SKIP_HINT = {
    desktop: 'Press Esc to skip this - or say "Omnissiah, skip"',
    controllers: 'Say "Omnissiah, skip" - or hold the Y and B buttons together for 2 seconds - to skip this',
    hands: 'Say "Omnissiah, skip" - or pinch both little fingers for 2 seconds - to skip this',
  };
  const HINT = {
    look: { controllers: 'Look up at the glowing sun in the sky', hands: 'Look up at the glowing sun in the sky', desktop: 'Click the view, then move the mouse up until the glowing sun is in the middle' },
    move: { controllers: 'Walk with the LEFT thumbstick, a few steps', hands: 'Take a few steps in the room, or point your left hand and pinch your ring finger to walk', desktop: 'Walk a few steps with W A S D' },
    grab: { controllers: 'Reach out and SQUEEZE the grip button to take it', hands: 'Reach out and make a FIST around it', desktop: 'Point the mouse at it and RIGHT-CLICK to take it' },
    rack: { controllers: 'Reach a weapon on the rack and SQUEEZE the grip button', hands: 'Reach a weapon on the rack and make a FIST around it', desktop: 'Look at a weapon on the rack and RIGHT-CLICK to take it' },
    hit: { controllers: 'Swing the weapon at the dummy. Damage grows with speed', hands: 'Swing the weapon at the dummy', desktop: 'Click to swing at the dummy' },
    wheel: { controllers: 'Hold A, point at a spell, release', hands: 'Hold a RIGHT ring-finger pinch, point at a spell, release', desktop: 'Hold E, move the mouse to a spell, release' },
    cast: { controllers: 'Free your right hand (drop the weapon with B or swap hands), then pull the RIGHT TRIGGER', hands: 'Open your right hand to drop the weapon, then pinch your right index finger', desktop: 'Click the left mouse button' },
    castDummy: { controllers: 'Point at a straw dummy and pull the RIGHT TRIGGER', hands: 'Point at a straw dummy and pinch your right index finger', desktop: 'Aim at a straw dummy and click the left mouse button' },
    menu: { controllers: 'Raise your LEFT palm toward your face, or press left B (Y)', hands: 'Raise your LEFT palm toward your face', desktop: 'Press M' },
  };
  const hint = (k) => HINT[k][device()];
  // the talk prompt for the current device AND the real microphone state
  function talkHint() {
    const d = device(), m = micInfo(), hello = 'Say "Omnissiah, hello"';
    const typeIt = d === 'desktop' ? ' - or just type in the box below and press Enter' : '';
    if (m.state === 'none') return d === 'desktop' ? 'No microphone here (it needs https or localhost). Just type in the box below and press Enter'
      : 'No microphone is available. Allow it in the browser settings, then say "Omnissiah, hello"';
    if (m.state === 'blocked') return d === 'desktop' ? 'The microphone is blocked. Allow it in the address bar (the lock icon) - or just type in the box below and press Enter'
      : 'The microphone is blocked. Allow it in the browser\'s site settings, then say "Omnissiah, hello"';
    if (m.state === 'pending') return `Allow the microphone ${d === 'desktop' ? 'in the address bar' : 'when asked'}, then say "Omnissiah, hello"${typeIt}`;
    if (m.state === 'off' && d === 'desktop') return `Click the page once to switch the microphone on, then say "Omnissiah, hello"${typeIt}`;
    if (d === 'desktop') return m.openMic ? `${hello} - or hold T and speak${typeIt.replace(' - or just', ' - or')}` : `Hold T and speak - or tap N and speak${typeIt.replace(' - or just', ' - or')}`;
    if (d === 'controllers') return m.openMic ? `${hello} - or tap X and speak - or hold the left trigger` : 'Tap X and speak - or hold the left trigger and speak';
    return m.openMic ? `${hello} - or pinch your left index finger and thumb, hold, and speak` : 'Pinch your left index finger and thumb, hold, and speak';
  }
  // the spoken re-prompt: the right control for the device, always with his name
  function talkSay() {
    const d = device(), st = micInfo().state;
    if (st === 'blocked' || st === 'none') return d === 'desktop' ? 'I cannot hear you. Allow the microphone in the address bar, or type to me in the box below.' : 'I cannot hear you. Allow the microphone in the browser settings.';
    if (d === 'desktop') return 'Say my name first: Omnissiah. Then hello. Or hold the T key and speak. Or type in the box below.';
    if (d === 'controllers') return 'Say my name first: Omnissiah. Then hello. Or tap the X button and speak.';
    return 'Say my name first: Omnissiah. Then hello. Or pinch your left finger and thumb, hold it, and speak.';
  }
  function talkSay2() {
    const d = device(), st = micInfo().state;
    if (st === 'blocked' || st === 'none') return d === 'desktop' ? 'Type hello in the box below. I can hear that.' : 'The microphone is blocked, so I cannot hear you yet.';
    if (d === 'desktop') return 'Type hello in the box below, or say Omnissiah, hello.';
    if (d === 'controllers') return 'Tap the X button, then say Omnissiah, hello.';
    return 'Pinch your left finger and thumb, then say Omnissiah, hello.';
  }
  const _fw = new THREE.Vector3();
  function whereIs(p) {
    const f = ctx.player.forward, fe = ctx.player.feet;
    const hf = Math.atan2(f.x, -f.z), ht = Math.atan2(p.x - fe.x, -(p.z - fe.z));
    let d = ht - hf; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const deg = (d * 180) / Math.PI, a = Math.abs(deg), side = deg > 0 ? 'right' : 'left';
    return { m: Math.round(Math.hypot(p.x - fe.x, p.z - fe.z)), w: a < 25 ? 'straight ahead' : a < 75 ? `ahead on your ${side}` : a < 125 ? `on your ${side}` : 'behind you' };
  }

  // The hint bar: one persistent instruction for the current wait. Desktop: a DOM bar at the top of the page (never in the way of the chat box or the "?" button).
  // VR: the same text as a world toast, re-shown every ~9 s so it is always there.
  const bar = { el: null, main: null, sub: null, fn: null, shown: '', lastToast: -99, accT: 0, broken: false };
  function barEl() {
    if (bar.el || bar.broken || !doc) return bar.el;
    try {
      const el = doc.createElement('div');
      el.id = BAR_ID; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      Object.assign(el.style, { position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'min(760px, calc(100vw - 160px))', boxSizing: 'border-box',
        padding: '10px 18px 9px', borderRadius: '12px', background: 'rgba(13,15,44,.9)', border: '1px solid rgba(255,216,119,.6)', boxShadow: '0 6px 24px rgba(0,0,0,.5)', color: '#fff',
        font: '600 17px/1.35 "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif', textAlign: 'center', textShadow: '0 1px 2px #000', zIndex: '7', pointerEvents: 'none', display: 'none' });
      const main = doc.createElement('div'), sub = doc.createElement('div');
      Object.assign(sub.style, { font: '500 13px/1.3 "Segoe UI", system-ui, Roboto, Arial, sans-serif', color: '#a4abdc', marginTop: '3px', textShadow: 'none' });
      el.appendChild(main); el.appendChild(sub); doc.body.appendChild(el);
      bar.el = el; bar.main = main; bar.sub = sub;
    } catch { bar.broken = true; bar.el = null; }
    return bar.el;
  }
  const barSet = (fn) => { bar.fn = fn; bar.accT = 9; };
  function barUpdate(dt) {
    bar.accT += dt;
    if (bar.accT < 0.2) return;
    bar.accT = 0;
    let text = '';
    if (bar.fn && run && !run.done) { try { text = String(bar.fn() ?? ''); } catch { text = ''; } }
    const d = device();
    if (d === 'desktop' && barEl()) {
      if (!text) { if (bar.shown !== '') { bar.el.style.display = 'none'; bar.shown = ''; } return; }
      if (text !== bar.shown) { bar.main.textContent = text; bar.sub.textContent = SKIP_HINT.desktop; bar.shown = text; }
      bar.el.style.display = 'block';
    } else {
      if (bar.el && bar.el.style.display !== 'none') bar.el.style.display = 'none';
      if (!text) { bar.shown = ''; return; }
      if (text !== bar.shown || engine.clock - bar.lastToast > 9) { bar.shown = text; bar.lastToast = engine.clock; try { ctx.hud?.show?.(text, 11); } catch { /* none */ } }
    }
  }
  function barClear() { bar.fn = null; bar.shown = ''; try { if (bar.el) bar.el.style.display = 'none'; } catch { /* none */ } }
  function barDispose() { barClear(); try { bar.el?.remove?.(); } catch { /* none */ } bar.el = null; }

  // ------------------------------------------------------------------ keys: Esc skips, Enter in the chat box counts as speaking to him
  const onKey = (e) => {
    if (!e) return;
    if (run && !run.done) { inputSeen = true; actN++; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const t = e.target;
      if (t && t.id === 'chat') { const v = String(t.value ?? '').trim(); if (v) { typedN++; if (run && !run.done) heardEver = true; if (SKIP_RE.test(v)) skipReq = 'typed'; } }
      return;
    }
    if (e.code === 'Escape' && run && !run.done) {
      const t = e.target;
      const typing = t && /^(INPUT|TEXTAREA)$/.test(t.tagName ?? '') && String(t.value ?? '').length > 0;
      if (typing || world.menu?.isOpen || performance.now() - lastUnlock < 900) return;   // Esc also frees the mouse and closes the menu: not a skip then
      skipReq = 'esc';
    }
  };
  // has the player done anything at all since the run began? (a key, a click, a step, a turn of the head)
  const acted = () => {
    if (inputSeen) return true;
    const fe = ctx.player.feet, f = ctx.player.forward;
    if (startFeet && Math.hypot(fe.x - startFeet.x, fe.z - startFeet.z) > 1.5) return true;
    if (startFwd && f.x * startFwd.x + f.y * startFwd.y + f.z * startFwd.z < 0.985) return true;
    return false;
  };
  const onPointer = () => { if (run && !run.done) { inputSeen = true; actN++; } };
  let lockToast = false;
  const onLock = () => { try { if (!doc.pointerLockElement) { lastUnlock = performance.now(); if (run && !run.done && !lockToast) { lockToast = true; ctx.hud?.show?.('Mouse freed: click the view to look around again. (Esc once more skips the awakening.)', 5); } } } catch { /* none */ } };
  try { globalThis.addEventListener?.('keydown', onKey, true); globalThis.addEventListener?.('pointerdown', onPointer, true); } catch { /* no window */ }
  try { doc?.addEventListener?.('pointerlockchange', onLock); } catch { /* none */ }
  ctx.onDispose(() => { try { globalThis.removeEventListener?.('keydown', onKey, true); globalThis.removeEventListener?.('pointerdown', onPointer, true); doc?.removeEventListener?.('pointerlockchange', onLock); } catch { /* none */ } });
  ctx.onDispose(() => barDispose());

  const state = (S.state ??= { settled: false });
  ctx.on('modules:synced', () => { state.settled = true; });
  for (const ev of ['spell:cast', 'weapon:grab', 'weapon:hit']) ctx.on(ev, () => { if (run && !run.done) actN++; });   // an active player is never timed out

  // crash recovery: if a previous run died with the Omnissiah hidden or commentary off, put them back
  const oracleRoot = () => ctx.scene.getObjectByName('module:core/oracle.js') ?? null;
  const showOracle = () => { const r = oracleRoot(); if (r) r.visible = true; S.hid = false; };
  if (S.hid) showOracle();
  if (S.prevCommentary !== undefined) { try { world.commentary?.setEnabled?.(S.prevCommentary); } catch { /* ignore */ } S.prevCommentary = undefined; }

  // ------------------------------------------------------------------ the start zone
  // time: ctx.clock.t is real elapsed seconds (boot.js), unlike the engine clock which is capped per frame: waits that a person feels (patience, line caps, pauses) use it, so a slow device does not stretch them
  const nowS = () => (ctx.clock && Number.isFinite(ctx.clock.t) ? ctx.clock.t : performance.now() / 1000);
  const wdelay = (sec) => { const t0 = nowS(); return engine.mk('delay', { label: `delay ${sec}s`, poll: () => nowS() - t0 >= sec }); };
  const SZ = () => { const s = world.startzone; return s && s.active !== false && s.anchors ? s : null; };
  const anchor = (name) => SZ()?.anchors?.[name] ?? null;
  const flatDir = () => { const f = ctx.player.forward; const l = Math.hypot(f.x, f.z) || 1; return { x: f.x / l, z: f.z / l }; };
  const flat = (d) => { const f = flatDir(); return { x: ctx.player.feet.x + f.x * d, z: ctx.player.feet.z + f.z * d }; };
  const gy = (x, z) => { try { const y = ctx.groundAt(x, z); return Number.isFinite(y) ? y : 0; } catch { return 0; } };
  const isWater = (x, z) => { try { return !!world.env?.isWater?.(x, z); } catch { return false; } };
  // a free spot for the guided wish, IN VIEW (within ~50 degrees of where the player faces) and clear of the start zone's stations
  function wishSite() {
    const f = flatDir(), fe = ctx.player.feet, sz = SZ();
    const pts = sz ? Object.values(sz.anchors).filter((p) => p && Number.isFinite(p.x)) : [];
    pts.push({ x: 0, z: 0 });
    let best = null, bestScore = -1e9;
    for (const dist of [11, 14, 17]) {
      for (const a of [0, 0.35, -0.35, 0.7, -0.7, 0.9, -0.9]) {
        const c = Math.cos(a), s = Math.sin(a), x = fe.x + (f.x * c - f.z * s) * dist, z = fe.z + (f.x * s + f.z * c) * dist;
        if (isWater(x, z) || isWater(x + 4, z) || isWater(x - 4, z) || isWater(x, z + 4) || isWater(x, z - 4)) continue;
        let m = 99; for (const p of pts) m = Math.min(m, Math.hypot(p.x - x, p.z - z));
        const score = Math.min(m, 8) * 1.0 - Math.abs(a) * 1.5 - (dist - 11) * 0.12;
        if (score > bestScore) { bestScore = score; best = { x, z }; }
      }
    }
    return best ?? { x: fe.x + f.x * 12, z: fe.z + f.z * 12 };
  }
  // ------------------------------------------------------------------ the script
  function* script(c) {
    const O = world.oracle;
    const toast = (k, s = 7) => c.toast(hint(k), s);
    // his scripted lines never hold the lesson for longer than reading time + a little (no TTS audio must not stall the opening for 40 s)
    const say = (text) => {
      try { voiceSvc()?.stopSpeech?.(); ctx.hud?.clear?.(); } catch { /* none */ }          // never a backlog: what is still playing or on screen from the last line goes
      const w = c.say(text), cap = 3 + String(text).length * 0.07, t0 = nowS();
      const w2 = engine.mk('say', { label: w.label, bot: w.bot, poll: (dt) => engine.pollWait(w, dt) || nowS() - t0 >= cap });
      w2.onCancel = w.onCancel;
      return w2;
    };
    const patience = (base) => (idleStreak >= 2 ? Math.min(base, 7) : idleStreak >= 1 ? Math.min(base, 20) : base);
    let intro1 = true;                                    // the opening line of the bar, until the first lesson starts
    const baseBar = () => (intro1 && device() === 'desktop' ? 'The awakening begins. Watch the sky.' : '');
    // one wait with a persistent hint, spoken re-prompts and a patient timeout. Result: 'timeout' or the inner wait's result.
    const waitFor = (inner, o = {}) => {
      let k = 0, idleT = 0, last = nowS(), seenAct = actN, px = ctx.player.feet.x, pz = ctx.player.feet.z; const says = o.says ?? [];
      if (o.hint) barSet(o.hint);
      const clear = () => { if (o.hint && bar.fn === o.hint) barSet(baseBar); };
      const w = engine.mk('prompted', { label: inner.label, bot: inner.bot, poll: (dt, ww) => {
        if (engine.pollWait(inner, dt)) { clear(); return inner.result ?? true; }
        const now = nowS(), d = Math.min(1, Math.max(0, now - last)); last = now;
        if (!(o.hold && o.hold())) idleT += d;
        const fe = ctx.player.feet; if (actN !== seenAct || Math.hypot(fe.x - px, fe.z - pz) > 0.3) { seenAct = actN; px = fe.x; pz = fe.z; idleT = Math.min(idleT, 0); }   // any input or movement: the patience starts over
        while (k < says.length && idleT >= says[k].after) { const s = says[k++]; try { c.sayNow(typeof s.text === 'function' ? s.text() : s.text); } catch { /* none */ } }
        if (idleT >= patience(o.patience ?? 30)) { clear(); try { c.toast('Moving on.', 2.5); } catch { /* none */ } return 'timeout'; }
        return false;
      } });
      w.onCancel = () => { clear(); try { inner.onCancel?.(); } catch { /* none */ } };
      return w;
    };
    // a counted wait: updates idle/engaged so a player who does nothing is not dragged through every lesson
    function* step(inner, o) {
      const r = yield waitFor(inner, o);
      if (r === 'timeout') idleStreak++; else { idleStreak = 0; engaged++; }
      return r;
    }
    // the guide: a thin glowing ring on the ground and a soft pillar of light (billboard, fades at both ends) at a LIVE point. Soft textures, additive gold, no solid shapes.
    const softTex = (w, h, fn) => {
      try {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g2 = cv.getContext('2d'), img = g2.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = Math.max(0, Math.min(1, fn(x / (w - 1), y / (h - 1)))), i = (y * w + x) * 4; img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255); }
        g2.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
      } catch { return null; }
    };
    let pillarTex = null, ringTex = null;
    function beacon(getPos, color = 0xffd877) {
      pillarTex ??= softTex(32, 256, (u, v) => { const x = u * 2 - 1, t = 1 - v; return 0.85 * Math.exp(-x * x * 5) * Math.min(1, t / 0.06) * Math.pow(Math.max(0, 1 - t), 1.4); });
      ringTex ??= softTex(128, 128, (u, v) => { const r = Math.hypot(u * 2 - 1, v * 2 - 1), d = (r - 0.84) / 0.055; return Math.exp(-d * d) * 0.95 + (r < 0.84 ? 0.2 * Math.exp(-(((r - 0.84) / 0.3) ** 2)) : 0); });
      const grp = new THREE.Group(); grp.name = 'intro-beacon';
      const mat = (map, o) => new THREE.MeshBasicMaterial({ color, map, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, ...o });
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mat(ringTex, { opacity: 0.8 })); ring.rotation.x = -Math.PI / 2;
      const pillar = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 14), mat(pillarTex, { opacity: 0.55 }));
      for (const m of [ring, pillar]) { m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; m.renderOrder = 6; m.frustumCulled = false; }
      grp.add(ring, pillar); c.scope.add(grp);
      let ph = 0, dead = false;
      c.scope.tick((dt) => {
        if (dead) return;
        const p = getPos(); if (!p) { grp.visible = false; return; }
        grp.visible = true; ph += dt;
        const y = gy(p.x, p.z), h = ctx.player.head;
        ring.position.set(p.x, y + 0.08, p.z); ring.scale.setScalar(1 + 0.08 * Math.sin(ph * 3)); ring.material.opacity = 0.7 + 0.2 * Math.sin(ph * 3);
        pillar.position.set(p.x, y + 7, p.z); pillar.rotation.y = Math.atan2(h.x - p.x, h.z - p.z);
        pillar.material.opacity = 0.55 * Math.min(1, Math.hypot(h.x - p.x, h.z - p.z) / 5);
      });
      return { remove() { dead = true; grp.removeFromParent(); grp.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } };
    }    const dirHint = (baseFn, getPos) => () => {
      const base = typeof baseFn === 'function' ? baseFn() : baseFn;
      const p = getPos(); if (!p) return base;
      const w = whereIs(p);
      if (w.m <= 4) return base;
      return device() === 'desktop' ? `${base} - the gold ring, ${w.m} m ${w.w}` : `${base} - the gold ring, ${w.w}`;
    };

    const wBase = new Set(world.weapons?.list?.() ?? []);
    try {
      try { world.commentary?.enabled !== undefined && (S.prevCommentary = world.commentary.enabled); world.commentary?.setEnabled?.(false); } catch { /* none */ }
      S.prevAuto = autoOffMarker() ? true : autoWas(); try { Q()?.setAuto?.(false); autoOffMarker(true); } catch { /* none */ }
      try { S.prevTracker = Q()?.trackerVisible?.(); Q()?.trackerVisible?.(false); } catch { /* none */ }
      const tidy = () => { try { if (world.menu?.isOpen || world.menu?.launcherOpen) world.menu.close(); } catch { /* ignore */ } };   // the welcome card must not sit in front of him
      tidy();
      barSet(baseBar);
      if (device() !== 'desktop') c.toast('The awakening begins. ' + SKIP_HINT[device()], 8);
      try { const g = getGen(); g?.preload?.(ctx, ['sz-runestone-tall', 'sz-tree-oak', 'sz-offering-pedestal']); } catch { /* optional */ }
      // 0. darkness and stars
      const hidden = oracleRoot();
      if (hidden) { hidden.visible = false; S.hid = true; }
      c.stage.time(0, 0); c.stage.music('night');
      yield wdelay(3);
      // 1. the fractal ignites
      showOracle();
      try { O?.wake?.(); } catch { /* ignore */ }
      c.stage.mood('joyful'); c.stage.flare(0xfff0c0, 2.2); c.stage.pulse(1); c.stage.sfx('omni-awaken');
      c.stage.time(0.5, 7); c.stage.music('sacred');
      yield wdelay(1.2);
      yield say(LI.ignite);
      yield say(LI.hello);
      // 2. look at him (desktop: the camera is eased up a little first, so he is in frame)
      if (device() === 'desktop' && ctx.camera && ctx.camera.rotation.x < 0.12) {
        const cam = ctx.camera; let last = cam.rotation.x, tt = 0;
        c.scope.tick((dt) => { tt += dt; if (tt > 2.4) return; if (Math.abs(cam.rotation.x - last) > 0.03) { tt = 99; return; } last = cam.rotation.x += (0.26 - cam.rotation.x) * Math.min(1, dt * 2.2); });
      }
      intro1 = false;
      // (looking is neutral: on a flat screen the default view already has him in frame, so it proves nothing about the player; only not looking at all counts as idle)
      { const r = yield waitFor(c.look(() => O?.position ?? null, { hold: 1.2, deg: device() === 'desktop' ? 42 : 32, label: 'look at the Omnissiah' }), { hint: () => hint('look'), says: [{ after: 9, text: LI.lookHint }], patience: 18 }); if (r === 'timeout') idleStreak++; }
      c.stage.flare(0xffd877, 1); c.stage.sfx('omni-approve'); tidy();

      // 3. talk to him. Honest: nothing is claimed unless something really happened.
      yield say(LI.speak);
      startFeet = { x: ctx.player.feet.x, z: ctx.player.feet.z }; const pf = ctx.player.forward; startFwd = { x: pf.x, y: pf.y, z: pf.z };   // from here on, moving or turning counts as taking part
      // (he may already have been spoken to - people answer a greeting at once - so anything heard since the run began counts)
      let heard = heardEver, stateNow = 'idle', lastBusy = engine.clock;
      c.scope.on('net:transcript', () => { heard = true; lastBusy = engine.clock; });
      c.scope.on('oracle:state', (s) => { stateNow = s; if (s === 'transcribing' || s === 'thinking' || s === 'coding') heard = true; });
      c.scope.tick(() => { if (heardEver) heard = true; if (stateNow !== 'idle' || !heard) lastBusy = engine.clock; });
      const talkInner = c.until(() => heard, { label: 'say something to the Omnissiah', bot: { type: 'event', name: 'net:transcript', payload: { text: 'hello' } } });
      const talkRes = yield* step(talkInner, { hint: talkHint, says: [{ after: 13, text: talkSay }, { after: 24, text: talkSay2 }], hold: () => stateNow === 'listening', patience: 30 });
      if (heard) {
        afterTalk = true; heard = true;
        yield c.until(() => engine.clock - lastBusy > 2.5 && !voiceSvc()?.speaking, { label: 'his answer ends', timeout: 25 });
        c.stage.flare(0xffd877, 1.2); c.stage.pulse(1); c.stage.sfx('omni-approve');
      } else {
        // nothing was heard: he performs a first wish himself and says plainly that it is his
        yield say(micDead() ? LI.noMic : LI.noVoice);
        yield* guidedWish(c, say);
        yield say(LI.wishDone);
      }
      void talkRes;

      if (idleStreak >= 2 || (!heard && !acted())) {
        // a player who has done nothing: end the lessons quietly (no stations, no enemies)
        yield say(LI.closeIdle);
      } else if (SZ()) {
        yield* szRoute(c, { waitFor, step, beacon, dirHint, baseBar, say });
      } else {
        yield* classicRoute(c, { waitFor, step, toast, tidy, say });
      }
      setIntroFlag(1);
    } finally {
      // loot the goblins dropped and anything else that appeared (never the gift, never what is held, nothing after a wish)
      if (!wished) { try { for (const w of [...(world.weapons?.list?.() ?? [])]) if (!wBase.has(w) && w !== S.gift && !w.held) w.remove(); } catch { /* weapons reloading */ } }
      barClear();
      showOracle();
      try { Q()?.setAuto?.(S.prevAuto !== false); autoOffMarker(false); } catch { /* none */ }
      try { if (S.prevTracker !== undefined) Q()?.trackerVisible?.(S.prevTracker); } catch { /* none */ }
      S.prevTracker = undefined;
      try { if (S.prevCommentary !== undefined) world.commentary?.setEnabled?.(S.prevCommentary); } catch { /* none */ }
      S.prevCommentary = undefined;
    }
  }

  // The guided first wish: a ring of rune stones rises around an oak that grows, with his creation effect. Real new art (lib/gen.js); light pillars if the models cannot load.
  function* guidedWish(c, say) {
    const O = world.oracle, site = wishSite(), g = getGen();
    const y0 = gy(site.x, site.z);
    c.stage.mood('joyful'); c.stage.flare(0xffd877, 2.4); c.stage.pulse(1); c.stage.sfx('omni-create', { x: site.x, y: y0, z: site.z });
    try { O?.creation?.([site.x, y0, site.z]); } catch { /* ignore */ }
    c.stage.beam(site.x, site.z, { color: 0xffd877, duration: 3 });
    const items = [];                                       // { h, kind, t0, dur, size, x, z }
    const N = 6, R = 4.8;
    if (g?.spawn) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + 0.3, x = site.x + Math.cos(a) * R, z = site.z + Math.sin(a) * R, size = 2.5 + (i % 3) * 0.35;
        try { const h = g.spawn(ctx, 'sz-runestone-tall', { x, z, yaw: -a + Math.PI / 2, size, solid: false }); if (h) { const it = { h, kind: 'stone', t0: 0.5 + i * 0.35, dur: 1.8, size, x, z }; items.push(it); fading.push(it); h.object.position.y = gy(x, z) - size * 1.15; h.object.visible = false; } } catch (e) { warn('stone failed', e); }
      }
      try { const h = g.spawn(ctx, 'sz-tree-oak', { x: site.x, z: site.z, size: 7, solid: false }); if (h) { const it = { h, kind: 'oak', t0: 1.6, dur: 3.6, size: 7, x: site.x, z: site.z }; items.push(it); fading.push(it); h.object.scale.setScalar(0.01); h.object.visible = false; } } catch (e) { warn('oak failed', e); }
    }
    // light pillars (always): they stay a while and fade; also the whole effect if the models are missing
    const pil = [], pm = (op) => new THREE.MeshBasicMaterial({ color: 0xffc050, transparent: true, opacity: op, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.3, m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.32, 9, 12, 1, true), pm(0));
      m.position.set(site.x + Math.cos(a) * R, gy(site.x + Math.cos(a) * R, site.z + Math.sin(a) * R) + 4.5, site.z + Math.sin(a) * R);
      m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; m.frustumCulled = false; m.renderOrder = 6; c.scope.add(m); pil.push(m);
    }
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), pm(0)); shock.rotation.x = -Math.PI / 2; shock.position.set(site.x, y0 + 0.12, site.z); shock.userData.noShadow = shock.userData.noOutline = shock.userData.noCull = true; shock.frustumCulled = false; shock.renderOrder = 6; c.scope.add(shock);
    let beamed = 0; const tw0 = nowS();
    c.scope.tick(() => {
      const t = nowS() - tw0;
      const e = (k) => k * k * (3 - 2 * k);
      for (const it of items) {
        const k = Math.max(0, Math.min(1, (t - it.t0) / it.dur)); if (k <= 0) continue;
        const o = it.h.object; o.visible = true;
        if (it.kind === 'stone') o.position.y = gy(it.x, it.z) - 0.03 - it.size * 1.15 * (1 - e(k));
        else o.scale.setScalar(Math.max(0.01, it.size * e(k)));
      }
      pil.forEach((m, i) => { const k = (t - 0.2 - i * 0.3) / 1.2; m.material.opacity = k <= 0 ? 0 : 0.3 * Math.min(1, k) * Math.max(0, Math.min(1, (9 - t) / 3)); });
      const sk = Math.min(1, t / 1.8); shock.scale.setScalar(1 + sk * R * 1.9); shock.material.opacity = 0.8 * (1 - sk) * (t < 1.8 ? 1 : 0);
      if (beamed < N && t > 0.6 + beamed * 0.45) { const a = (beamed / N) * Math.PI * 2 + 0.3; if (beamed < 3) c.stage.beam(site.x + Math.cos(a) * R, site.z + Math.sin(a) * R, { color: 0xffd877, duration: 1.2 }); beamed++; }
    });
    yield wdelay(5.2);
    // the models stay for the rest of the lesson and sink back when it ends (fading holds them; onEnd hands them to the sinker)
    c.stage.sfx('pickup');
  }

  // ------------------------------------------------------------------ route A: the start zone
  function* szRoute(c, H) {
    const { waitFor, step, beacon, dirHint, say } = H;
    const stop = () => idleStreak >= 2 && !acted();
    // a lesson at a station: speak, mark it, wait (hint with live direction + distance), tidy up
    function* station(o) {
      const pos = () => anchor(o.anchor);
      if (!pos()) return false;
      // a station the player is already standing at (the lectern is a couple of metres from the spawn point): say so, no walk
      const fe = ctx.player.feet, here = !!o.r && Math.hypot(pos().x - fe.x, pos().z - fe.z) <= o.r;
      yield say(here && o.sayHere ? o.sayHere : o.say);
      if (here && o.wait) { yield wdelay(0.8); engaged++; idleStreak = 0; c.stage.sfx('pickup'); o.done?.(); return true; }
      const b = beacon(pos);
      const r = yield* step(o.wait(), { hint: dirHint(o.hint, pos), says: o.says, patience: o.patience ?? 28 });
      b.remove();
      if (r !== 'timeout' && o.done) { c.stage.sfx('pickup'); c.stage.flare(0xffd877, 0.8); o.done(); }
      return r !== 'timeout';
    }
    const sel = () => { try { world.spells?.select?.('firebolt'); } catch { /* ignore */ } };
    // 1. the spell lectern
    if (!stop()) {
      const ok = yield* station({ anchor: 'lectern', say: LI.lectern, hint: () => 'Walk to the spell lectern',
        r: 1.8, sayHere: 'This is the lectern, right beside you. It keeps a spell for you.',
        wait: () => c.nearThing(() => anchor('lectern'), 1.8, { hold: 0.3, label: 'walk to the lectern' }), patience: 30,
        done: () => { sel(); c.toast('Firebolt chosen. Hold E (spell wheel) to change it later.', 5); } });
      if (ok) yield say(LI.lecternDone);
    }
    // 2. the straw dummies: cast at one
    if (!stop() && anchor('dummies')) {
      sel();
      yield* station({ anchor: 'dummies', say: LI.dummies, hint: () => hint('castDummy'), says: [{ after: 14, text: 'Point at a dummy and cast. It cannot be unkind to you.' }],
        wait: () => c.event('startzone:dummy-hit', null, { label: 'cast at a straw dummy', payload: { index: 0, hits: 1 } }), patience: 30 });
    }
    // 3. the weapon rack
    if (!stop() && anchor('rack')) {
      const ok = yield* station({ anchor: 'rack', say: LI.rack, hint: () => hint('rack'), says: [{ after: 14, text: 'Reach for a weapon. The hilt is the part you hold.' }],
        wait: () => { const w = c.any([c.event('startzone:weapon', null, { label: 'take a weapon from the rack', payload: { type: 'sword' } }), c.event('weapon:grab', null, { label: 'grab a weapon', payload: { type: 'sword', hand: 'right' } })]); w.label = 'take a weapon from the rack'; return w; }, patience: 30 });
      if (ok) yield say(LI.rackDone);
    }
    // 4. the waystone: the controls
    if (!stop() && anchor('waystone')) {
      yield* station({ anchor: 'waystone', say: LI.waystone, hint: () => 'Walk to the waystone and read the controls',
        r: 2.2, wait: () => c.nearThing(() => anchor('waystone'), 2.2, { hold: 0.3, label: 'walk to the waystone' }), patience: 24,
        done: () => { /* the board itself shows the controls for this device: nothing to dump on top of it */ } });
    }
    // 5. who he is (only for a player who took part), then the fire and Pell
    const took = engaged >= 3;
    if (took) {
      c.stage.mood('serene'); yield say(LI.p1);
      c.stage.mood('joyful'); yield say(LI.p2);
      c.stage.mood('ominous'); c.stage.flare(0xff40a0, 1.4);
      yield say(LI.p3);
      c.stage.mood('joyful');
    }
    setIntroFlag(1);
    if (anchor('campfire') && !stop()) {
      // hand over to the first labour: Pell appears at the fire (quest-owned; stays after the lesson)
      try { Q()?.start?.('sz-pell', { quiet: true }); } catch { /* optional */ }
      const ok = yield* station({ anchor: 'campfire', say: LI.fire, hint: () => 'Walk to the campfire. Pell is waiting there', patience: 30, r: 2.2,
        wait: () => c.nearThing(() => anchor('campfire'), 2.2, { hold: 0.3, label: 'walk to the campfire' }) });
      if (ok) yield say(LI.fireDone);
    } else yield say(LI.close);
  }

  // ------------------------------------------------------------------ route B: no start zone (the older lesson)
  function* classicRoute(c, H) {
    const { waitFor, step, toast, tidy, say } = H;
    const withBlade = [];
    // move: a few steps, so the body knows the field is real
    { const p0 = { x: ctx.player.feet.x, z: ctx.player.feet.z };
      yield* step(c.until(() => Math.hypot(ctx.player.feet.x - p0.x, ctx.player.feet.z - p0.z) > 2.5, { label: 'walk a few steps', bot: { type: 'walk', dist: 3 } }), { hint: () => hint('move'), patience: 20 });
      c.stage.sfx('pickup'); }
    if (idleStreak >= 2) { yield say(LI.closeIdle); return; }
    // a gift rises from the ground (a pedestal from the generated set)
    tidy();
    yield say(afterTalk ? LI.gift : LI.giftQuiet);
    const spot = flat(2.8), g = getGen();
    let pedestal = null;
    try { pedestal = g?.spawn?.(ctx, 'sz-offering-pedestal', { x: spot.x, z: spot.z, size: 1.2, solid: false }) ?? null; } catch { pedestal = null; }
    c.stage.beam(spot.x, spot.z, { color: 0xffd877, duration: 2.6 }); c.stage.sfx('omni-create', { x: spot.x, y: 0, z: spot.z });
    const g0 = gy(spot.x, spot.z);
    if (pedestal) { pedestal.object.position.y = g0 - 1.4; let rise = 0; c.scope.tick((dt) => { rise = Math.min(1, rise + dt / 2.4); pedestal.object.position.y = g0 - 0.03 - 1.4 * (1 - rise * rise * (3 - 2 * rise)); }); c.scope.undo(() => pedestal.remove()); }
    yield wdelay(2.6);
    const sword = world.weapons?.create?.(ctx, 'sword', { position: new THREE.Vector3(spot.x, g0 + 1.15, spot.z) });
    let gotIt = false;
    const g9 = sword?.body?.gravity ?? 9.8;
    if (sword) { S.gift = sword; sword.body.gravity = 0; const hy = g0 + 1.15; const ring = c.mark(spot.x, spot.z, { r: 1.5, color: 0xffd877 }); c.scope.on('weapon:grab', () => ring.remove()); c.scope.tick((dt, t) => { if (!gotIt && !sword.held) { try { sword.body.position.set(spot.x, hy + Math.sin(t * 2) * 0.05, spot.z); sword.body.velocity.set(0, 0, 0); } catch { /* removed */ } } }); }
    c.scope.on('weapon:grab', () => { gotIt = true; try { if (sword) sword.body.gravity = g9; } catch { /* gone */ } });
    c.scope.undo(() => { try { if (sword && sword.body) sword.body.gravity = g9; } catch { /* gone */ } });
    c.stage.flare(0xffd877, 1.2); c.stage.sfx('pickup');
    yield* step(c.event('weapon:grab', null, { label: 'take the gift', bot: { type: 'event', name: 'weapon:grab', payload: { type: 'sword', hand: 'right' } } }), { hint: () => hint('grab'), says: [{ after: 14, text: LI.giftHint }], patience: 30 });
    void withBlade;
    if (idleStreak >= 2) { yield say(LI.closeIdle); return; }
    // the training dummy (off to the right, so the pedestal never hides it)
    c.scope.tick((() => { let t = 0; return (dt) => { t += dt; if (pedestal && !pedestal.removed && t > 2.5) { pedestal.object.position.y -= dt * 1.4; if (t > 4.2) pedestal.remove(); } }; })());
    yield say(LI.dummy);
    const dsp = flat(6.5); { const f = flatDir(); dsp.x += f.z * 2.6 * -1; dsp.z += -f.x * 2.6 * -1; }
    c.spawn('training-dummy', { x: dsp.x, z: dsp.z, noPush: true });
    let hits = 0;
    c.scope.on('weapon:hit', () => { hits++; });
    yield* step(c.until(() => hits >= 2, { label: 'strike the dummy twice', bot: { type: 'event', name: 'weapon:hit', payload: { type: 'sword', amount: 12 }, times: 2 } }), { hint: () => hint('hit'), says: [{ after: 16, text: LI.hitHint }], patience: 30 });
    c.stage.sfx('pickup');
    if (idleStreak >= 2) { yield say(LI.closeIdle); return; }
    // a first spell: the wheel
    yield say(LI.wheel);
    let picked = false, mine = true;
    c.scope.on('spell:select', () => { if (!mine) picked = true; });
    try { world.spells?.select?.('firebolt'); } catch { /* ignore */ }
    mine = false;
    yield* step(c.until(() => picked, { label: 'choose a spell on the wheel', bot: { type: 'event', name: 'spell:select', payload: { id: 'firebolt' } } }), { hint: () => hint('wheel'), patience: 30 });
    yield say(LI.cast);
    yield* step(c.event('spell:cast', null, { label: 'cast the spell', bot: { type: 'event', name: 'spell:cast', payload: { id: 'firebolt' } } }), { hint: () => hint('cast'), patience: 30 });
    // the wrist menu
    try { world.menu?.close?.(); } catch { /* ignore */ }
    yield say(LI.menu);
    const menu = () => world.menu;
    yield* step(c.until(() => !!(menu()?.isOpen || menu()?.launcherOpen) || !menu(), { label: 'open the wrist menu', bot: { type: 'menu' } }), { hint: () => hint('menu'), patience: 24 });
    yield wdelay(3);
    try { world.menu?.close?.(); } catch { /* ignore */ }
    // a small threat, with an ally at your side - only for a player who has taken part
    if (engaged >= 3 && idleStreak < 2) {
      c.stage.music('tension'); c.stage.mood('wrathful');
      yield say(LI.goblins);
      const gp = flat(11);
      const foes = c.foes([{ name: 'goblin', count: 2, fixed: true }], { around: gp, radius: 7, noRemix: true });
      yield say(LI.ally);
      const side = flat(2.2);
      c.spawn('knight', { x: side.x + 1.6, z: side.z, noPush: true, name: 'Sir Pip', faction: 'friendly' });
      yield c.cleared(foes, { timeout: 120 });
      c.stage.music('calm'); c.stage.stinger(); c.stage.mood('joyful'); c.stage.flare(0xffd877, 2); c.stage.sfx('omni-approve');
      c.spawn('confetti-burst', {});
      yield say(LI.victory);
      c.stage.mood('serene'); yield say(LI.p1);
      c.stage.mood('joyful'); yield say(LI.p2);
      c.stage.mood('ominous'); c.stage.flare(0xff40a0, 1.4);
      yield say(LI.p3);
    }
    let offered = false;
    try { offered = !!world.campaign?.start?.('ch1')?.ok; } catch (e) { warn('could not offer the first labour', e); }
    yield say(offered ? LI.offer : LI.close);
  }

  // ------------------------------------------------------------------ control
  function play(opts = {}) {
    if (disposed) return false;
    if (run && !run.done) return false;
    if (!ready()) return false;
    if (ctx.input?.passthrough) { try { ctx.hud?.show?.('The awakening needs the open field; leave mixed reality first.', 4); } catch { /* none */ } return false; }
    afterTalk = false; wished = false; idleStreak = 0; engaged = 0; skipReq = null; inputSeen = false; heardEver = false; lockToast = false; home = { x: ctx.player.feet.x, z: ctx.player.feet.z };
    startFeet = null; startFwd = null;
    const scope = engine.makeScope('intro');
    const t = engine.run(script, { name: 'intro', scope, spec: {}, onEnd: (task) => onEnd(task, scope, opts) });
    run = t;
    startedAt = engine.clock;
    return true;
  }
  // however it ended (finished, skipped, rescued), the player is told how to find the controls again; the welcome card never shows once the intro has run
  function helpToast() {
    const d = device();
    const cheat = d === 'desktop' ? 'Controls: W A S D walk, mouse look, E spells, G grab, T or N talk (or type below), M menu, V for VR.'
      : d === 'hands' ? 'Controls: pinch left to talk, raise your left palm for the menu.' : 'Controls: left stick walk, X or left trigger talk, A spells, grip grab, left B (Y) menu.';
    try { ctx.hud?.show?.(cheat + ' The menu has How to play.', 12); } catch { /* none */ }
  }
  function onEnd(task, scope, opts) {
    try { scope.dispose(); } catch (e) { warn(e); }
    barClear();
    showOracle();
    if (disposed) return;
    for (const it of fading.splice(0)) sink.push({ it, t: 0 });     // what he raised sinks back into the earth
    helpToast();
    const info = { finished: !task.cancelled && !task.error, skipped: !!task.cancelled, replay: !!opts?.replay };
    try { ctx.events.emit('intro:done', info); ctx.events.emit('intro:complete', info); } catch (e) { warn(e); }
    if (task.cancelled) { if (!introFlag()) setIntroFlag(2); return; }
    if (task.error) { warn('the awakening faltered:', task.error); setIntroFlag(introFlag() || 2); }
    Q()?.saveNow?.();
  }
  const sink = [];
  function stepSink(dt) {
    for (let i = sink.length - 1; i >= 0; i--) {
      const s = sink[i]; s.t += dt;
      const o = s.it.h?.object;
      if (!o || s.it.h.removed) { sink.splice(i, 1); continue; }
      if (s.t < 4) continue;                                  // a few seconds to look at what he made
      const k = (s.t - 4) / 3;
      if (s.it.kind === 'stone') o.position.y -= dt * s.it.size * 0.38; else o.scale.setScalar(Math.max(0.01, s.it.size * (1 - k)));
      if (k >= 1) { try { s.it.h.remove(); } catch { /* gone */ } sink.splice(i, 1); }
    }
  }
  function skip(why) {
    if (!run || run.done) return false;
    engine.cancel(run);
    try { voiceSvc()?.stopSpeech?.(); } catch { /* none */ }                  // what he was saying stops with the lesson
    try { ctx.net?.send?.({ type: 'say_cancel' }); } catch { /* the server may not know it yet: ignored */ }   // (asks the story plugin to drop lines still queued)
    try { ctx.hud?.show?.(why === 'esc' ? 'Skipped. Menu > Awakening plays it again.' : why ? 'The awakening is set aside. Menu > Awakening plays it again.' : 'Skipped. Menu > Awakening plays it again.', 5); } catch { /* none */ }
    return true;
  }
  // skipping without ceremony: say "skip", wish for something after the greeting, press Esc, or simply walk away. Never nag, never trap.
  ctx.on('net:transcript', (m) => { if (!run || run.done) return; heardEver = true; if (SKIP_RE.test(m?.text ?? '')) skip('said'); });
  ctx.on('oracle:state', (s) => { if (run && !run.done && (s === 'transcribing' || s === 'thinking' || s === 'coding')) heardEver = true; });
  ctx.on('module:loaded', (e) => { if (run && !run.done && afterTalk && /^creations\//.test(e?.path ?? '')) { wished = true; skip('wish'); } });
  let unregister = null;
  function registerPanel() {
    const menu = world.menu; if (!menu?.register || unregister) return;
    try {
      unregister = menu.register({ id: 'intro', title: 'Awakening', icon: 'star', sig: () => `${run && !run.done ? 1 : 0}${introFlag()}`, build(ui) {
        ui.heading('The awakening');
        ui.text('The short opening in which the Omnissiah wakes and teaches you the basics. It never blocks play: press Esc or say "Omnissiah, skip" at any time.', { size: 13 });
        if (run && !run.done) ui.button('Skip it now', () => { skip(); ui.refresh(); }, { kind: 'danger' });
        else ui.button('Play it again', () => { play({ replay: true }); ui.close?.(); }, { kind: 'primary', icon: 'star' });
      } });
    } catch (e) { warn('panel registration failed', e); unregister = null; }
  }
  ctx.on('module:loaded', (e) => { if (e?.path === 'core/menu.js') { unregister = null; registerPanel(); } });
  ctx.onDispose(() => { try { unregister?.(); } catch { /* ignore */ } });
  // The player must never be left in the dark: if a run is alive but its engine has stopped ticking (module update disabled, tab torn, an exception escaping),
  // end it cleanly after a few seconds of real time. This timer does not depend on this module's update().
  let lastClock = -1, lastWall = performance.now(), watchdogOn = true;
  function rescue(why) {
    if (!run || run.done) return;
    warn('the awakening stopped moving (' + why + '): ending it and restoring the world');
    try { engine.cancel(run); } catch (e) { warn(e); }
    showOracle();
    barClear();
    if (!introFlag()) setIntroFlag(2);
    try { ctx.hud?.show?.('The awakening faltered and was put away. Menu > Awakening plays it again.', 6); } catch { /* none */ }
  }
  const wd = setInterval(() => {
    const now = performance.now();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { lastWall = now; return; }
    if (engine.clock !== lastClock) { lastClock = engine.clock; lastWall = now; return; }
    if (watchdogOn && run && !run.done && now - lastWall > 6000) rescue('stalled clock');
  }, 1000);
  ctx.onDispose(() => clearInterval(wd));
  const api = {
    play, skip, get running() { return !disposed && !!run && !run.done; }, get active() { return !disposed && !!run && !run.done; }, get done() { return introFlag() > 0; },
    debug: { watchdog(b) { watchdogOn = !!b; lastWall = performance.now(); }, engine, get run() { return run; }, waiting: () => (run ? engine.waitsOf(run).map((w) => ({ kind: w.kind, label: w.label, bot: w.bot, t: w.t })) : []), waits: () => (run ? engine.waitsOf(run) : []),
      skipWait() { let n = 0; if (run) for (const w of engine.waitsOf(run)) { w.forced = true; n++; } return n; }, killFoes() { let n = 0; for (const f of [...(world.combat?.fighters ?? [])]) if (f.faction === 'enemy' && f.alive) { f.hp = 0; try { world.kit?.hit?.(f.actor.group.position, 1.6, 99999, { from: 'player' }); } catch { /* ignore */ } n++; } return n; },
      runWish() { const scope = engine.makeScope('wishdebug'); return engine.run(function* (c) { yield* guidedWish(c, (t) => c.delay(1)); yield wdelay(30); }, { name: 'wishdebug', scope, spec: {} }); },
      hint: () => { try { return bar.fn ? String(bar.fn() ?? '') : ''; } catch { return ''; } }, talkHint, talkSay, talkSay2, micInfo, key: onKey, get idle() { return idleStreak; }, get engaged() { return engaged; }, get fading() { return fading.length + sink.length; },
      reset() { setIntroFlag(0); } },
  };
  ctx.provide('intro', api);

  ctx.onDispose(() => {
    disposed = true;
    try { engine.dispose(); } catch (e) { warn(e); }
    showOracle();
    for (const it of fading.splice(0)) { try { it.h.remove(); } catch { /* gone */ } }
    for (const s of sink.splice(0)) { try { s.it.h.remove(); } catch { /* gone */ } }
    try { if (S.gift && !S.gift.held) S.gift.remove(); } catch { /* gone */ }
    S.gift = null;
  });

  // ------------------------------------------------------------------ automatic start (until the 'seen' flag is set) and the skip gesture
  let waitT = 0;
  return {
    update(dt) {
      dt = Math.min(dt, 0.1);
      engine.update(dt);
      stepSink(dt);
      barUpdate(dt);
      if (skipReq && run && !run.done) { const why = skipReq; skipReq = null; skip(why); } else if (skipReq && !run) skipReq = null;
      const L = ctx.input.left, R = ctx.input.right;
      if (run && !run.done && L.down?.b && R.down?.b) { skipHold += dt; if (skipHold >= 2) { skipHold = 0; skip(); } } else skipHold = 0;
      if (run && !run.done && home && Math.hypot(ctx.player.feet.x - home.x, ctx.player.feet.z - home.z) > (SZ() ? 70 : 40)) skip('walked');
      if (!unregister && world.menu) registerPanel();
      if (run && !run.done && !engine.tasks.has(run)) { rescue('no live task'); return; }
      if (!run && !state.markerChecked && ready()) { state.markerChecked = true; if (autoOffMarker()) { try { Q().setAuto(true); } catch { /* none */ } autoOffMarker(false); } }   // a previous run died with automatic labours off
      if (run || !ready() || !state.settled) return;
      waitT += dt;
      if (waitT < 0.6 || state.autoChecked) return;
      state.autoChecked = true;
      if (introFlag() === 0 && !ctx.input?.passthrough) play({ auto: true });   // an explicit 'seen' flag, not 'new profile': everyone gets it once
    },
    dispose() { /* released through onDispose */ },
  };
}
