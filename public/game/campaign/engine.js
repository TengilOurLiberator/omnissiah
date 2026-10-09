// campaign/engine.js - the story script runner shared by core/campaign.js and core/intro.js (each makes its own engine from its own ctx).
// A script is a GENERATOR  function* (c) { yield c.say('...'); yield c.near(x, z, 8); c.next(); ... }  stepped from update(dt) in GAME time (so tests can
// run it deterministically). Whatever it yields is a WAIT (poll() -> truthy when done); a bare yield waits one tick, an array waits for all, a number is
// seconds, a function is until(fn), a generator object runs as a parallel child. Everything a script spawns, listens to or restyles belongs to its SCOPE and is
// undone by scope.dispose() (finish, abandon, failure, hot reload): fighters, library things, meshes, event listeners, sky / style / mood / music / travel.
// Nothing here keeps module-level state. Waits carry `bot` metadata so a test bot (and debug.skip) can drive any script without knowing it.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const readTime = (text) => clamp(String(text ?? '').length * 0.068 + 0.9, 1.8, 14);
export class StoryFail extends Error { constructor(reason) { super(reason); this.storyFail = true; this.reason = reason; } }

export default function createEngine(ctx, hooks = {}) {
  const THREE = ctx.THREE, events = ctx.events;
  const W = () => ctx.world;
  const tasks = new Set();
  let E = null;
  const scopes = new Set();
  const offs = [];
  let clock = 0, hpTimer = 0;
  const warn = (...a) => { try { console.warn('[story]', ...a); } catch { /* no console */ } };
  const on = (name, fn) => { const off = events.on(name, fn); offs.push(off); return off; };
  const v3 = new THREE.Vector3();

  // ------------------------------------------------------------------ waits
  const mk = (kind, o) => Object.assign({ kind, label: kind, t: 0, done: false, result: undefined, forced: false, timeout: 0 }, o);
  const immediate = (value = true) => mk('now', { poll: () => true, result: value });
  function pollWait(w, dt) {
    if (w.done) return true;
    w.t += dt;
    let r = w.forced ? (w.forceValue ?? true) : w.poll ? w.poll(dt, w) : true;
    if (r) { w.done = true; w.result = r === true ? (w.result ?? true) : r; return true; }
    if (w.timeout && w.t >= w.timeout) { w.done = true; w.timedOut = true; w.result = w.onTimeout ?? 'timeout'; return true; }
    return false;
  }
  function toWait(v, task) {
    if (v == null) return mk('tick', { poll: () => true });
    if (typeof v === 'object' && typeof v.poll === 'function') return v;
    if (Array.isArray(v)) return all(v.map((x) => toWait(x, task)));
    if (typeof v === 'number') return delay(v);
    if (typeof v === 'function') return until(v);
    if (typeof v.next === 'function' && typeof v[Symbol.iterator] === 'function') return child(v, task);
    if (typeof v.then === 'function') { const w = mk('promise', { poll: () => w.settled }); v.then((x) => { w.settled = true; w.result = x ?? true; }, () => { w.settled = true; }); return w; }
    return mk('tick', { poll: () => true });
  }
  const delay = (sec) => mk('delay', { label: `delay ${sec}s`, poll: (dt, w) => w.t >= sec });
  const until = (fn, o = {}) => mk('until', { label: o.label ?? 'until', timeout: o.timeout ?? 0, bot: o.bot, poll: () => { try { return fn(); } catch (e) { warn('until failed', e); return true; } } });
  const all = (list) => { const ws = list.map((x) => toWait(x)); return mk('all', { label: 'all', children: ws, poll: (dt) => { let ok = true; for (const w of ws) if (!pollWait(w, dt)) ok = false; return ok; } }); };
  const any = (list) => { const ws = list.map((x) => toWait(x)); return mk('any', { label: 'any', children: ws, poll: (dt) => { for (let i = 0; i < ws.length; i++) if (pollWait(ws[i], dt)) return { index: i, result: ws[i].result }; return false; } }); };
  function child(gen, task) {
    const t = startTask(gen, { name: (task?.name ?? 'task') + '/child', scope: task?.scope, parent: task, noStep: true });
    return mk('child', { label: 'child', task: t, poll: () => t.done, onCancel: () => cancel(t) });
  }

  // ------------------------------------------------------------------ tasks
  const newTask = (o = {}) => ({ name: o.name ?? 'task', scope: o.scope ?? null, gen: null, wait: null, done: false, cancelled: false, error: null, result: null, parent: o.parent ?? null, children: [], onEnd: o.onEnd ?? null });
  function startTask(gen, o = {}) {
    const t = o.task ?? newTask(o);
    t.gen = typeof gen === 'function' ? gen(o.c) : gen;
    if (t.parent) t.parent.children.push(t);
    tasks.add(t);
    if (!o.noStep) advance(t, undefined);
    else t.deferred = true;
    return t;
  }
  function advance(t, val) {
    for (let guard = 0; guard < 400 && !t.done; guard++) {
      let r;
      try { r = t.gen.next(val); } catch (e) { return finish(t, e); }
      if (r.done) return finish(t, null, r.value);
      const w = toWait(r.value, t);
      if (r.value == null) { t.wait = w; return; }                 // a bare yield: next tick
      if (pollWait(w, 0)) { val = w.result; if (E.onWait) { try { E.onWait(w, t); } catch { /* test hook */ } } continue; }
      if (E.onWait) { try { E.onWait(w, t); } catch { /* test hook */ } }
      t.wait = w; return;
    }
    if (!t.done) { warn('script loop guard hit in', t.name); t.wait = mk('tick', { poll: () => true }); }
  }
  function finish(t, err, value) {
    if (t.done) return;
    t.done = true; t.error = err; t.result = value;
    tasks.delete(t);
    for (const ch of t.children) if (!ch.done) cancel(ch);
    if (err && !err.storyFail) warn(`script "${t.name}" crashed:`, err);
    try { t.onEnd?.(t); } catch (e) { warn('onEnd failed', e); }
  }
  function cancel(t) {
    if (!t || t.done) return;
    t.cancelled = true;
    for (const ch of t.children) cancel(ch);
    try { t.wait?.onCancel?.(); t.gen.return?.(); } catch (e) { /* finally blocks may throw */ }
    finish(t, null, 'cancelled');
  }
  function failTask(t, reason) {
    if (!t || t.done) return;
    t.failing = true;
    for (const ch of t.children) cancel(ch);
    try { t.wait?.onCancel?.(); t.gen.return?.(); } catch (e) { /* finally blocks may throw */ }
    finish(t, new StoryFail(reason), 'failed');
  }
  function stepTask(t, dt) {
    if (t.done) return;
    if (t.deferred) { t.deferred = false; advance(t, undefined); return; }
    if (t.wait && pollWait(t.wait, dt)) { const v = t.wait.result; t.wait = null; advance(t, v); }
  }
  // the waits a task is blocked on right now (leaf waits, for the debug API and the test bot)
  function waitsOf(t, out = [], seen = new Set()) {
    if (seen.has(t)) return out;
    seen.add(t);
    const walk = (w) => { if (!w || w.done) return; if (w.children && (w.kind === 'all' || w.kind === 'any')) w.children.forEach(walk); else if (w.task) waitsOf(w.task, out, seen); else out.push(w); };
    walk(t.wait);
    for (const ch of t.children) if (!ch.done) waitsOf(ch, out, seen);
    return out;
  }

  // ------------------------------------------------------------------ scopes: everything a script creates
  function makeScope(name, o = {}) {
    const sc = {
      name, disposed: false, handles: [], undos: [], tickers: [], group: new THREE.Group(), hpMul: o.hpMul ?? 1, npcs: [], persons: new Set(),
      dirty: { env: false, style: false, mood: false, music: false, look: false },
      saved: { env: null, style: null, mood: null },
    };
    sc.group.name = 'story:' + name;
    ctx.root.add(sc.group);
    const w = W();
    try { sc.saved.env = w.env?.snapshot?.() ?? null; } catch { sc.saved.env = null; }
    try { sc.saved.style = w.style?.get?.() ?? null; } catch { sc.saved.style = null; }
    try { sc.saved.mood = w.oracle?.getMood?.() ?? null; } catch { sc.saved.mood = null; }
    // loot dropped where this scope's creatures died is swept up with it (never anything else a player wished for)
    sc.deaths = []; sc.wBase = new Set(w.weapons?.list?.() ?? []);
    sc.undos.push(events.on('combat:kill', (e) => { const p = e?.victim?.actor?.group?.position; if (p && sc.deaths.length < 80) sc.deaths.push([p.x, p.z]); }));
    sc.track = (h) => { if (h) sc.handles.push(h); return h; };
    sc.spawn = (entry, opts) => {
      const lib = W().library; if (!lib) return null;
      try { return sc.track(lib.spawn(ctx, entry, opts)); } catch (e) { warn('spawn failed', entry, e); return null; }
    };
    sc.on = (name2, fn) => { const off = events.on(name2, fn); sc.undos.push(off); return off; };
    sc.undo = (fn) => { sc.undos.push(fn); return fn; };
    sc.tick = (fn) => { sc.tickers.push(fn); return fn; };
    sc.add = (obj) => { sc.group.add(obj); return obj; };
    sc.dispose = () => {
      if (sc.disposed) return;
      sc.disposed = true;
      scopes.delete(sc);
      sc.tickers.length = 0;
      for (let i = sc.undos.length - 1; i >= 0; i--) { try { sc.undos[i](); } catch (e) { warn('undo failed', e); } }
      for (const h of sc.handles.splice(0)) { try { if (!h.removed) h.remove(); } catch (e) { /* already gone */ } }
      try { for (const wp of [...(W().weapons?.list?.() ?? [])]) { if (sc.wBase.has(wp) || wp.held) continue; const p = wp.body?.position; if (p && sc.deaths.some((d) => Math.hypot(d[0] - p.x, d[1] - p.z) < 24)) wp.remove(); } } catch { /* weapons reloading */ }
      sc.group.traverse((o2) => { o2.geometry?.dispose?.(); for (const m of [].concat(o2.material ?? [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose?.(); } });
      sc.group.removeFromParent();
      const w2 = W();
      try { if (sc.dirty.style && sc.saved.style) w2.style?.set?.(sc.saved.style); } catch { /* style reloading */ }
      try { if (sc.dirty.mood) w2.oracle?.setMood?.(sc.saved.mood && sc.saved.mood !== 'default' ? sc.saved.mood : null); } catch { /* ignore */ }
      try { if (sc.dirty.look) w2.oracle?.lookAt?.(null); } catch { /* ignore */ }
      try { if (sc.dirty.music) w2.audio?.setMood?.(null); } catch { /* ignore */ }
      try { if (sc.dirty.env && sc.saved.env) w2.env?.restore?.(sc.saved.env, { instant: false }); } catch { /* env reloading */ }
    };
    scopes.add(sc);
    return sc;
  }

  // ------------------------------------------------------------------ the Omnissiah speaks (scripted: no AI call; see server/plugins/story.js)
  const omni = (() => {
    let seq = 0;
    const pending = [];
    const finishLine = (p) => { p.wait.lineDone = true; };
    const startReading = (p, secs) => { p.state = 'reading'; p.deadline = p.wait.t + (secs ?? readTime(p.text)); };
    on('net:speak', (m) => {
      if (!m || typeof m.text !== 'string') return;
      const txt = norm(m.text);
      const p = pending.find((q) => q.state === 'sent' && (norm(q.text) === txt || (m.scripted != null && String(m.scripted) === String(q.id))));
      if (!p) return;
      if (m.audio) { p.state = 'playing'; p.deadline = p.wait.t + 45; } else startReading(p);
    });
    on('oracle:line', (m) => {
      const txt = norm(m?.text);
      const p = pending.find((q) => q.state === 'playing' && norm(q.text) === txt);
      if (p) p.deadline = p.wait.t + (Number(m.duration) || 6) + 4;
    });
    on('oracle:line-end', (m) => {
      const txt = norm(m?.text);
      const p = pending.find((q) => q.state === 'playing' && norm(q.text) === txt);
      if (p) finishLine(p);
    });
    on('net:say_dropped', (m) => {
      const p = pending.find((q) => q.state === 'sent' && String(q.id) === String(m?.id));
      if (!p) return;
      try { ctx.hud?.say?.(p.text, false); } catch { /* no hud */ }
      startReading(p);
    });
    function say(text, o = {}) {
      text = String(text ?? '').trim();
      const id = `s${++seq}`;
      const w = mk('say', { label: `say: ${text.slice(0, 40)}`, text, id, bot: { type: 'say', text }, timeout: o.timeout ?? 0 });
      const p = { id, text, wait: w, state: 'sent', deadline: 0 };
      w.poll = () => {
        if (w.lineDone) return true;
        if (p.state === 'sent' && w.t > 40) { try { ctx.hud?.say?.(text, false); } catch { /* none */ } startReading(p); }
        return p.state !== 'sent' && w.t >= p.deadline;
      };
      w.onCancel = () => { const i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); };
      pending.push(p);
      w.then = (res, rej) => (w.promise ??= new Promise((r) => { w.resolveP = r; })).then(res, rej);
      const origPoll = w.poll;
      w.poll = (dt, ww) => { const r = origPoll(dt, ww); if (r) { const i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); w.resolveP?.(true); } return r; };
      let sent = false;
      try { sent = !!ctx.net?.send?.({ type: 'say_as_omnissiah', id, text }); } catch { sent = false; }
      if (!sent) { try { ctx.hud?.say?.(text, false); } catch { /* none */ } startReading(p); }
      else if (!o.silent) { /* the server broadcasts 'speak': hud subtitles it by itself */ }
      return w;
    }
    return { say, get pending() { return pending.length; }, clear() { pending.length = 0; } };
  })();

  // ------------------------------------------------------------------ the chapter context `c`
  function makeC(task, scope, spec = {}) {
    const ng = spec.ng ?? 0, hard = 1 + 0.5 * ng, hpMul = 1 + 0.4 * ng;
    scope.hpMul = hpMul;
    const origin = { x: spec.origin?.x ?? 0, z: spec.origin?.z ?? 0 };
    const feet = () => ctx.player.feet;
    const dist2 = (x, z) => Math.hypot(feet().x - x, feet().z - z);
    const lib = () => W().library;
    const st = {};
    const c = {
      ctx, scope, ng, hard, origin, spec, P: () => hooks.profile?.() ?? {}, omni,
      get here() { return { x: feet().x, z: feet().z }; },
      rel: (x, z, base) => { const b = base ?? c.base ?? origin; return [b.x + x, b.z + z]; },
      base: null,
      n: (count) => Math.max(1, Math.round(count * hard)),
      log: (...a) => hooks.log?.(...a),
      flag: (k, v) => (v === undefined ? hooks.getStat?.('campaign.f.' + k) ?? 0 : hooks.setStat?.('campaign.f.' + k, v)),
      stat: (path) => hooks.getStat?.(path) ?? 0,
      bump: (path, n = 1) => hooks.setStat?.(path, (hooks.getStat?.(path) ?? 0) + n),
      // ---- quest objective
      next: (n = 1) => hooks.advance?.(n),
      tick: () => hooks.advance?.(1),
      fail(reason) { throw new StoryFail(reason || 'The labour failed.'); },
      // ---- waits
      delay, until, all, any,
      wait(fn, o) { return until(fn, o); },
      event(name, filter, o = {}) {
        const w = mk('event', { label: o.label ?? `event ${name}`, timeout: o.timeout ?? 0, bot: o.bot ?? { type: 'event', name, payload: o.payload } });
        const off = events.on(name, (e) => { if (w.done || w.hit) return; try { if (!filter || filter(e)) { w.hit = true; w.result = e ?? true; } } catch { /* filter failed */ } });
        scope.undo(off);
        w.poll = () => !!w.hit;
        w.onCancel = off;
        return w;
      },
      near(x, z, r = 6, o = {}) {
        const hold = o.hold ?? 0;
        let acc = 0;
        return mk('near', { label: o.label ?? `near ${Math.round(x)},${Math.round(z)}`, timeout: o.timeout ?? 0, bot: { type: 'near', x, z, r },
          poll: (dt) => { if (dist2(x, z) <= r) { acc += dt; return acc >= hold; } acc = 0; return false; } });
      },
      nearThing(getXZ, r = 4, o = {}) {
        const hold = o.hold ?? 0; let acc = 0;
        const w = mk('near', { label: o.label ?? 'near thing', timeout: o.timeout ?? 0, poll: (dt) => { const p = getXZ(); if (p && dist2(p.x, p.z) <= r) { acc += dt; return acc >= hold; } acc = 0; return false; } });
        w.bot = { type: 'near', get x() { return getXZ()?.x ?? 0; }, get z() { return getXZ()?.z ?? 0; }, r };
        return w;
      },
      look(getPoint, o = {}) {                                         // the player's gaze rests on a world point (the Omnissiah) for `hold` s
        const hold = o.hold ?? 1, cosMin = Math.cos((o.deg ?? 28) * Math.PI / 180); let acc = 0;
        return mk('look', { label: o.label ?? 'look', timeout: o.timeout ?? 0, bot: { type: 'look' }, poll: (dt) => {
          const p = getPoint(); if (!p) return false;
          v3.set(p.x - ctx.player.head.x, p.y - ctx.player.head.y, p.z - ctx.player.head.z).normalize();
          if (v3.dot(ctx.player.forward) >= cosMin) { acc += dt; return acc >= hold; }
          acc = 0; return false;
        } });
      },
      dead(list, o = {}) {                                               // every fighter in a handle / list is dead (or gone)
        const get = () => (typeof list === 'function' ? list() : [].concat(list ?? [])).flatMap((h) => (h && h.fighters ? h.fighters : h ? [h] : []));
        const w = mk('dead', { label: o.label ?? 'foes dead', timeout: o.timeout ?? 0, bot: { type: 'kill', get fighters() { return get().filter((f) => f.alive); } },
          poll: () => { for (const h of [].concat(typeof list === 'function' ? [] : list ?? [])) if (h && 'pending' in h && h.pending > 0) return false; const fs = get(); for (const f of fs) if (f.alive && !f.removed) return false; return true; } });
        return w;
      },
      cleared(h, o = {}) {                                               // a wave handle: all spawned and all dead
        return mk('cleared', { label: o.label ?? 'wave cleared', timeout: o.timeout ?? 0, bot: { type: 'kill', get fighters() { return (h?.fighters ?? []).filter((f) => f.alive); }, wave: h },
          poll: () => !h || h.removed || h.cleared === true });
      },
      count(h, n, o = {}) {                                              // a counted objective step: fighters of a handle falling one by one
        let seen = 0; const dead = new Set();
        return mk('count', { label: o.label ?? 'kills', bot: { type: 'kill', get fighters() { return (h?.fighters ?? []).filter((f) => f.alive); }, wave: h }, poll: () => {
          for (const f of h?.fighters ?? []) if (!f.alive && !dead.has(f) && (!o.filter || o.filter(f))) { dead.add(f); seen++; if (o.onEach) o.onEach(f, seen); }
          return seen >= n;
        } });
      },
      grab(type, o = {}) { return c.event('weapon:grab', type ? (e) => norm(e.type) === norm(type) : null, { ...o, label: 'grab', payload: { type: type ?? 'sword', hand: 'right' } }); },
      choice(options, o = {}) {                                          // stand in one of the rings: [{ id, x, z, r }] -> result = the id
        const hold = o.hold ?? 1.2; let acc = 0, last = null;
        return mk('choice', { label: o.label ?? 'choice', bot: { type: 'choice', options }, poll: (dt) => {
          let hit = null;
          for (const op of options) if (dist2(op.x, op.z) <= (op.r ?? 3)) hit = op.id;
          if (hit && hit === last) { acc += dt; if (acc >= hold) return hit; } else { acc = 0; last = hit; }
          return false;
        } });
      },
      // ---- the Omnissiah and the other voices
      say: (text, o) => omni.say(text, o),
      sayNow: (text) => { try { ctx.net?.send?.({ type: 'say_as_omnissiah', id: 'n' + Math.random().toString(36).slice(2, 7), text }); } catch { /* offline */ } },
      deaths: () => hooks.deaths?.() ?? 0,
      sayAll: function* (lines) { for (const l of lines) yield omni.say(l); },
      npcSay(person, text, o = {}) {
        const a = person?.a ?? person;
        try { a?.say?.(text, o.sec ?? Math.max(3.5, readTime(text))); } catch { /* actor gone */ }
        return mk('npcsay', { label: `npc: ${text.slice(0, 30)}`, bot: { type: 'sleep' }, poll: (dt, w) => w.t >= (o.wait ?? readTime(text)) });
      },
      voiceOf(text, o = {}) {                                            // the Other Sun: a hollow Kokoro voice from the sky
        const V = W().voices;
        const at = o.at ?? (W().oracle?.position ? { x: W().oracle.position.x * 0.5, y: 60, z: W().oracle.position.z * 0.5 } : { x: 0, y: 40, z: -80 });
        try { V?.speak?.(at, text, { voice: o.voice ?? 'am_onyx', rate: o.rate ?? 0.6, speed: o.speed ?? 0.8, emotion: 'calm', fx: { hollow: 1, drive: 0.5, reverb: 0.7, gain: 1.15 } }); } catch { /* voices reloading */ }
        try { ctx.hud?.npc?.(o.name ?? 'The First Draft', 'enemy', text, true); } catch { /* hud */ }
        return mk('voice', { label: `voice: ${text.slice(0, 30)}`, bot: { type: 'sleep' }, poll: (dt, w) => w.t >= readTime(text) + 0.4 });
      },
      toast: (text, sec = 3.5) => { try { ctx.hud?.show?.(text, sec); } catch { /* none */ } },
      note: (line, o) => { try { W().commentary?.note?.(line, o ?? {}); } catch { /* none */ } },
      // ---- the world
      spawn: (entry, opts = {}) => scope.spawn(entry, opts),
      foes(list, o = {}) {                                               // a rising ring of enemies, scaled by the lap (counts x hard, hp x hpMul)
        const l = W().library; if (!l) return null;
        const spec2 = list.map((s) => ({ name: s.name, count: s.fixed ? s.count : c.n(s.count), opts: s.opts }));
        if (ng > 0 && !o.noRemix) spec2.push({ name: 'imp', count: 1 + ng * 2 });
        const around = o.around ?? c.base ?? origin;
        try { return scope.track(l.wave(ctx, spec2, { around: { x: around.x, z: around.z }, radius: o.radius ?? 13, delay: o.delay ?? 0.45, announce: o.announce !== false })); } catch (e) { warn('wave failed', e); return null; }
      },
      person(entry, o = {}) {                                            // a library person with a name and a persona (what voices.js reads)
        const x = o.x ?? origin.x, z = o.z ?? origin.z;
        const opts = { x, z, noPush: true, ...(o.opts ?? {}) };
        if (o.npcName) opts.name = o.npcName;
        for (const k of ['faction', 'hp', 'damage', 'scale', 'yaw']) if (o[k] !== undefined) opts[k] = o[k];
        const h = scope.spawn(entry, opts);
        const a = h?.actors?.[0] ?? null;
        if (a) {
          if (o.npcName) a.npcName = o.npcName;
          if (o.persona) a.persona = o.persona;
          if (o.role) a.role = o.role;
          if (o.hold) a.wander?.(0);
          scope.npcs.push(a);
        }
        if (h?.fighters?.[0]) scope.persons.add(h.fighters[0]);
        const p = { h, a, f: h?.fighters?.[0] ?? null, name: o.npcName ?? entry, get pos() { return a?.group?.position ?? h?.position ?? null; }, get dead() { return !a || a.dead || a.removed; } };
        return p;
      },
      relic(o = {}) {                                                    // a glowing grabbable (kit.body); .grabbed turns true once someone takes it
        const k = W().kit; if (!k?.body) return null;
        const g = new THREE.Group();
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), new THREE.MeshBasicMaterial({ color: o.color ?? 0xffe9a0 }));
        const halo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshBasicMaterial({ color: o.halo ?? 0xffb830, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
        g.add(core, halo); g.userData.noShadow = g.userData.noOutline = true; core.userData.noShadow = halo.userData.noShadow = true;
        const y = (o.y ?? ctx.groundAt(o.x, o.z) + 0.8);
        let body = null;
        try { body = k.body(ctx, g, { radius: 0.2, mass: 0.4, bounce: 0.35, friction: 0.7, grabbable: true, grabRange: 6, position: new THREE.Vector3(o.x, y, o.z) }); } catch (e) { warn('relic failed', e); return null; }
        const r = { body, mesh: g, grabbed: false, get pos() { return body.position; }, remove() { try { body.remove?.(); } catch { /* gone */ } g.removeFromParent(); } };
        body.onGrab?.(() => { r.grabbed = true; o.onGrab?.(r); events.emit('story:relic', { id: o.id }); });
        scope.track(r);
        return r;
      },
      mark(x, z, o = {}) {                                               // a pulsing ground ring that says "here"
        const r = o.r ?? 2.5;
        const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 40), new THREE.MeshBasicMaterial({ color: o.color ?? 0x7fe3ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        m.rotation.x = -Math.PI / 2; m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; m.renderOrder = 5;
        const o2 = { mesh: m, x, z, lit: false, set(nx, nz) { o2.x = nx; o2.z = nz; }, remove() { m.removeFromParent(); } };
        scope.add(m);
        let ph = Math.random() * 6;
        scope.tick((dt) => { ph += dt * 2.4; m.position.set(o2.x, ctx.groundAt(o2.x, o2.z) + 0.08, o2.z); m.material.opacity = (o2.lit ? 0.9 : 0.45) + 0.2 * Math.sin(ph); if (o2.color !== undefined) m.material.color.setHex(o2.color); });
        return o2;
      },
      // ---- staging (all undone with the scope)
      ground: (x, z) => ctx.groundAt(x, z),
      travel: (place, o = {}) => travelTo(scope, place, o),
      home: () => goHome(scope),
      teleport(x, z) { try { W().player?.teleport?.(x, z); } catch { /* none */ } if (!W().player?.teleport) { ctx.player.feet.x = x; ctx.player.feet.z = z; } },
      // walk up to a person (hold ~1 s inside radius), then let them speak each line
      talkTo: function* (person, lines, o = {}) {
        yield c.nearThing(() => person.pos, o.r ?? 3.8, { hold: o.hold ?? 0.8, label: `meet ${person.name}` });
        for (const l of [].concat(lines)) yield c.npcSay(person, l);
      },
      // a standing check: when fn() turns true the whole script fails gently with `reason`
      guard(fn, reason) { scope.tick(() => { if (!task.done && !task.failing) { let bad = false; try { bad = fn(); } catch { bad = false; } if (bad) failTask(task, reason); } }); },
      // mercy: resolves 'kill' when the person dies, 'spare' when the player speaks to them (voices:reply) or stands beside them
      mercy(person, o = {}) {
        let replied = false, acc = 0;
        const a = person.a;
        scope.on('voices:reply', (e) => { if (e && e.actor === a) replied = true; });
        return mk('mercy', { label: `mercy ${person.name}`, bot: { type: 'mercy', person, spare: () => { replied = true; } }, poll: (dt) => {
          if (person.dead) return 'kill';
          if (replied) return 'spare';
          const p = person.pos;
          if (p && dist2(p.x, p.z) <= (o.r ?? 3.4)) { acc += dt; if (acc >= (o.hold ?? 4)) return 'spare'; } else acc = 0;
          return false;
        } });
      },
      par(...gens) { const ts = gens.map((g) => startTask(g, { name: task.name + '/par', scope, parent: task, c })); return mk('par', { label: 'par', poll: () => ts.every((t) => t.done), onCancel: () => ts.forEach(cancel) }); },
      race(...gens) { const ts = gens.map((g) => startTask(g, { name: task.name + '/race', scope, parent: task, c })); return mk('race', { label: 'race', poll: () => { const i = ts.findIndex((t) => t.done); if (i < 0) return false; ts.forEach(cancel); return { index: i }; }, onCancel: () => ts.forEach(cancel) }); },
      sub: (genFn) => child(genFn(c), task),
    };
    c.task = task;
    c.stage = stageFor(scope, task, c);
    return c;
  }

  // ------------------------------------------------------------------ staging
  function stageFor(scope, task, c) {
    const w = () => W();
    const mood = (name) => { try { if (w().oracle?.setMood?.(name)) scope.dirty.mood = true; } catch { /* ignore */ } };
    const S = {
      mood,
      flare: (color = 0xffd877, strength = 1) => { try { w().oracle?.flare?.(color, strength); } catch { /* ignore */ } },
      beam: (x, z, o = {}) => { try { w().oracle?.beamTo?.([x, ctx.groundAt(x, z), z], { color: o.color ?? 0xffd877, duration: o.duration ?? 1.8 }); } catch { /* ignore */ } },
      beamPlayer: (o) => S.beam(ctx.player.feet.x, ctx.player.feet.z, o),
      lookAt: (x, y, z) => { try { if (w().oracle?.lookAt?.(x == null ? null : [x, y ?? 0, z])) scope.dirty.look = true; } catch { /* ignore */ } },
      pulse: (s = 1) => { try { w().oracle?.pulse?.(s); } catch { /* ignore */ } },
      time(t, sec = 2.5) { try { scope.dirty.env = true; w().env?.setTransition?.(sec); w().env?.setTimeOfDay?.(t); } catch { /* ignore */ } },
      sky(o = {}, sec = 2.5) {
        try {
          scope.dirty.env = true; const e = w().env; e?.setTransition?.(sec);
          if (o.zenith !== undefined || o.horizon !== undefined) e?.setSkyColors?.({ zenith: o.zenith ?? 0x101030, horizon: o.horizon ?? 0x403050, mid: o.mid });
          if (o.fog !== undefined) e?.setFog?.(o.fog, o.fogDensity);
          if (o.stars !== undefined) e?.setStars?.(o.stars);
          if (o.aurora !== undefined) e?.setAurora?.(o.aurora);
        } catch { /* ignore */ }
      },
      style(patch) { try { const s = w().style; if (!s) return; scope.dirty.style = true; typeof patch === 'string' ? s.preset?.(patch) : s.set?.(patch); } catch { /* ignore */ } },
      music(name) { try { if (w().audio?.setMood?.(name)) scope.dirty.music = true; else scope.dirty.music = true; } catch { /* ignore */ } },
      sfx: (name, at) => { try { return w().audio?.sfx?.(name, at ? { at } : undefined); } catch { return false; } },
      stinger: (name = 'music-victory') => { try { w().audio?.stinger?.(name); } catch { /* ignore */ } },
      effect(name, o = {}) { return scope.spawn(name, o); },              // a library weather / effect entry, removed with the scope
      glitch(sec = 1.1) {                                                 // the sky stutters: style presets flicker and the palette inverts, then everything is put back
        let snapEnv = null, phase = -1, t0 = 0; const steps = [['neon', 0.0], ['noir', 0.16], ['flat', 0.3], ['neon', 0.46], ['noir', 0.62]];
        try { snapEnv = w().env?.snapshot?.() ?? null; } catch { /* ignore */ }
        scope.dirty.style = true; scope.dirty.env = true;
        S.sfx('teleport');
        try { w().env?.setTransition?.(0); w().env?.setSkyColors?.({ zenith: 0xff2090, horizon: 0x20ffd0 }); } catch { /* ignore */ }
        const wt = mk('glitch', { label: 'glitch', bot: { type: 'sleep' }, poll: (dt, ww) => {
          const t = ww.t;
          for (let i = steps.length - 1; i >= 0; i--) if (t >= steps[i][1] * sec && phase < i) { phase = i; try { w().style?.preset?.(steps[i][0]); } catch { /* ignore */ } }
          if (t >= sec) {
            try { if (scope.saved.style) w().style?.set?.(scope.saved.style); if (snapEnv) w().env?.restore?.(snapEnv, { instant: true }); w().env?.setTransition?.(1.5); } catch { /* ignore */ }
            return true;
          }
          return false;
        } });
        wt.onCancel = () => { try { if (scope.saved.style) w().style?.set?.(scope.saved.style); if (snapEnv) w().env?.restore?.(snapEnv, { instant: true }); } catch { /* ignore */ } };
        return wt;
      },
      eclipse(level, sec = 4) {                                           // the Other Sun slides over the Omnissiah; the world drains of colour. 0 = gone, 1 = totality
        scope.dirty.env = true; scope.dirty.style = true;
        const e = w().env;
        try {
          e?.setTransition?.(sec);
          if (level > 0) {
            const k = clamp(level, 0, 1);
            e?.setTimeOfDay?.(Math.max(0.02, 0.5 - 0.48 * k));
            e?.setSkyColors?.({ zenith: new THREE.Color(0x120a2e).lerp(new THREE.Color(0x020006), k), horizon: new THREE.Color(0x6a3a58).lerp(new THREE.Color(0x2a0a18), k) });
            e?.setStars?.(1 - 0.9 * k); e?.setFog?.(new THREE.Color(0x2a1020).lerp(new THREE.Color(0x07020a), k), 0.0046 + 0.006 * k);
            w().style?.set?.({ saturation: -0.75 * k });
          } else { e?.setTimeOfDay?.(0.5); w().style?.set?.({ saturation: scope.saved.style?.saturation ?? 0 }); }
        } catch { /* ignore */ }
        if (ctx.input?.passthrough) { mood(level > 0.5 ? 'ominous' : null); return; }
        if (!scope.disc && level > 0) {
          const grp = new THREE.Group();
          const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
          const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.5, 48), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
          const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.12, 48), new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
          for (const m of [sphere, ring, ring2]) { m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; m.frustumCulled = false; }
          sphere.renderOrder = 1; ring.renderOrder = 2; ring2.renderOrder = 3;
          grp.add(sphere, ring, ring2); scope.add(grp);
          scope.disc = { grp, ring, level: 0, target: level, rate: 1 / Math.max(0.5, sec) };
          scope.tick((dt) => discTick(scope, dt));
        }
        if (scope.disc) { scope.disc.target = level; scope.disc.rate = 1 / Math.max(0.5, sec); }
        mood(level > 0.5 ? 'ominous' : level > 0 ? 'ominous' : null);
      },
    };
    return S;
  }
  const _cam = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function discTick(scope, dt) {
    const d = scope.disc; const o = W().oracle; if (!d || !o) return;
    d.level += clamp(d.target - d.level, -dt * d.rate, dt * d.rate);
    const L = d.level;
    if (L <= 0.001 && d.target <= 0) { d.grp.visible = false; return; }
    d.grp.visible = true;
    ctx.camera.getWorldPosition(_cam);
    _dir.copy(o.position).sub(_cam); const dist = _dir.length(); _dir.divideScalar(dist || 1);
    const R = (o.radius ?? 76) * 0.86 * 0.9;                           // same angular size as the Omnissiah, 10% nearer
    _right.crossVectors(_dir, _up).normalize();
    const slide = (1 - L) * R * 2.8;
    d.grp.position.copy(_cam).addScaledVector(_dir, dist * 0.9).addScaledVector(_right, slide);
    d.grp.scale.setScalar(R);
    d.grp.lookAt(_cam);
    d.ring.material.opacity = 0.25 + 0.4 * L;
  }
  function travelTo(scope, place, o = {}) {
    const T = W().travel;
    if (!T || ctx.input?.passthrough) return immediate(false);
    let h = null;
    try { h = T.go(place, o.spec); } catch (e) { warn('travel failed', e); return immediate(false); }
    scope.undo(() => { try { if (T.away || T.current) T.home?.({ instant: true }); } catch { /* ignore */ } });
    return mk('travel', { label: `travel ${place}`, timeout: o.timeout ?? 150, bot: { type: 'sleep' }, poll: () => { if (!h || h.state === undefined) return true; if (h.state === 'failed') return 'failed'; return h.state === 'arrived'; } });
  }
  function goHome(scope) {
    const T = W().travel;
    if (!T || ctx.input?.passthrough) return immediate(false);
    let h = null;
    try { if (T.away || T.current) h = T.home?.(); } catch (e) { warn('home failed', e); }
    return mk('home', { label: 'travel home', timeout: 60, bot: { type: 'sleep' }, poll: () => !T.away && (!h || h.state === undefined || h.state === 'arrived' || h.state === 'failed') });
  }

  // ------------------------------------------------------------------ per-frame
  function update(dt) {
    dt = Math.min(dt, 0.1);
    clock += dt;
    hpTimer += dt;
    for (const sc of [...scopes]) for (const fn of sc.tickers) { try { fn(dt, clock); } catch (e) { warn('ticker failed', e); } }
    for (const t of [...tasks]) stepTask(t, dt);
    if (hpTimer > 0.5) {
      hpTimer = 0;
      for (const sc of scopes) {
        if (sc.hpMul === 1) continue;
        for (const h of sc.handles) {
          let fs = null; try { fs = h.fighters; } catch { fs = null; }
          if (!fs) continue;
          for (const f of fs) if (f && !f._storyHp && f.faction === 'enemy' && f.damage && typeof f.damage.maxHp === 'number') { f._storyHp = true; try { f.damage.maxHp *= sc.hpMul; f.damage.hp *= sc.hpMul; } catch { /* read-only build */ } }
        }
      }
    }
  }
  function dispose() {
    for (const t of [...tasks]) cancel(t);
    for (const sc of [...scopes]) sc.dispose();
    for (const off of offs.splice(0)) { try { off(); } catch { /* ignore */ } }
    omni.clear();
  }

  E = {
    update, dispose, omni, makeScope, makeC, startTask, cancel, failTask, waitsOf, pollWait, mk, immediate, tasks, scopes, readTime,
    run(genFn, o = {}) {
      const scope = o.scope ?? makeScope(o.name ?? 'script', { hpMul: 1 });
      const task = newTask({ name: o.name ?? 'script', scope, onEnd: o.onEnd });
      const c = makeC(task, scope, o.spec ?? {});
      task.c = c;
      return startTask(genFn, { task, c });
    },
    get clock() { return clock; },
  };
  return E;
}









